import type { GameStatus, SteamProfile } from '../../shared/types';
import { drizzle } from 'drizzle-orm/d1';
import { and, gte, inArray, sql } from 'drizzle-orm';
import { steamProfiles } from '../../db/schema';
import pLimit from 'p-limit';

const PROFILE_CONCURRENCY = 6;
const MAX_STEAM_PROFILES_PER_REQUEST = 100;
const PROFILE_TTL_SECONDS = 60 * 60 * 24;        // 24 hours
const GAME_STATUS_STALE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_RETRIES = 3;
const SQUAD44_APPID = 736220;
const BASE_URL_PLAYERS = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';
const BASE_URL_GAMES = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

// --- Internal helpers ---

type SteamPlayer = { steamid: string; personaname: string; profileurl: string; avatarfull: string; loccountrycode?: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function dbRowToProfile(row: typeof steamProfiles.$inferSelect): SteamProfile {
  return {
    steamId: row.steamId,
    name: row.name,
    avatar: row.avatar,
    profileUrl: row.profileUrl,
    countryCode: row.countryCode,
    squad44Status: row.squad44Status ? JSON.parse(row.squad44Status) as GameStatus : null,
    updatedAt: row.updatedAt,
  };
}

async function persistProfiles(profiles: SteamProfile[], env: Env): Promise<void> {
  await Promise.all([
    upsertSteamProfiles(profiles, env),
    Promise.all(profiles.map(p => env.STEAM_PROFILE_CACHE.put(p.steamId, JSON.stringify(p), { expirationTtl: PROFILE_TTL_SECONDS }))),
  ]);
}

async function resolveFromKV(steamIds: string[], kv: KVNamespace): Promise<{ resolved: SteamProfile[]; remaining: string[] }> {
  const maps = await Promise.all(chunk(steamIds, MAX_STEAM_PROFILES_PER_REQUEST).map(c => kv.get(c, { type: 'json' })));
  const merged = new Map<string, SteamProfile | null>();
  for (const map of maps) for (const [k, v] of map) merged.set(k, v as SteamProfile | null);

  const resolved: SteamProfile[] = [];
  const remaining: string[] = [];
  for (const id of steamIds) {
    const profile = merged.get(id);
    if (profile) resolved.push(profile);
    else remaining.push(id);
  }
  return { resolved, remaining };
}

async function resolveFromDB(steamIds: string[], env: Env): Promise<{ resolved: SteamProfile[]; remaining: string[] }> {
  const now = Math.floor(Date.now() / 1000);
  const db = drizzle(env.DB);
  const rows = await db.select().from(steamProfiles).where(
    and(inArray(steamProfiles.steamId, steamIds), gte(steamProfiles.updatedAt, now - PROFILE_TTL_SECONDS))
  );
  const resolved = rows.map(dbRowToProfile);
  const foundIds = new Set(rows.map(r => r.steamId));
  void persistProfiles(resolved, env);
  return { resolved, remaining: steamIds.filter(id => !foundIds.has(id)) };
}

async function fetchPlayerChunk(ids: string[], apiKey: string): Promise<SteamPlayer[]> {
  const url = new URL(BASE_URL_PLAYERS);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', ids.join(','));

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn(`fetchPlayerChunk attempt ${attempt + 1} failed: HTTP ${res.status}`); continue; }
      const data: { response: { players: SteamPlayer[] } } = await res.json();
      return data.response.players;
    } catch (e) {
      console.warn(`fetchPlayerChunk attempt ${attempt + 1} threw:`, e);
    }
  }
  console.error('Failed to fetch chunk after all retries:', ids);
  return [];
}

async function fetchSteamProfiles(steamIds: string[], env: Env): Promise<SteamProfile[]> {
  const now = Math.floor(Date.now() / 1000);
  const limit = pLimit(PROFILE_CONCURRENCY);
  const batches = await Promise.all(
    chunk(steamIds, MAX_STEAM_PROFILES_PER_REQUEST).map(c => limit(() => fetchPlayerChunk(c, env.STEAM_API_KEY)))
  );
  const profiles: SteamProfile[] = batches.flat().map(player => ({
    steamId: player.steamid,
    name: player.personaname,
    avatar: player.avatarfull,
    profileUrl: player.profileurl,
    countryCode: player.loccountrycode ?? null,
    squad44Status: null,
    updatedAt: now,
  }));
  await persistProfiles(profiles, env);
  return profiles;
}

const UPSERT_BATCH_SIZE = 10;

async function upsertSteamProfiles(profiles: SteamProfile[], env: Env): Promise<void> {
  if (profiles.length === 0) return;
  const db = drizzle(env.DB);
  for (const batch of chunk(profiles, UPSERT_BATCH_SIZE)) {
    await db.insert(steamProfiles)
      .values(batch.map(p => ({
        steamId: p.steamId,
        name: p.name,
        avatar: p.avatar,
        profileUrl: p.profileUrl,
        countryCode: p.countryCode,
        squad44Status: p.squad44Status ? JSON.stringify(p.squad44Status) : null,
        updatedAt: p.updatedAt,
      })))
      .onConflictDoUpdate({
        target: steamProfiles.steamId,
        set: {
          name: sql`excluded.${sql.raw(steamProfiles.name.name)}`,
          avatar: sql`excluded.${sql.raw(steamProfiles.avatar.name)}`,
          profileUrl: sql`excluded.${sql.raw(steamProfiles.profileUrl.name)}`,
          countryCode: sql`excluded.${sql.raw(steamProfiles.countryCode.name)}`,
          squad44Status: sql`COALESCE(excluded.${sql.raw(steamProfiles.squad44Status.name)}, CASE WHEN ${steamProfiles.updatedAt} > (unixepoch() - ${GAME_STATUS_STALE_SECONDS}) THEN ${steamProfiles.squad44Status} ELSE NULL END)`,
          updatedAt: sql`excluded.${sql.raw(steamProfiles.updatedAt.name)}`,
        },
      });
  }
}

async function fetchGamesHours(steamIds: string[], appids: number[], env: Env, concurrency: number): Promise<Record<string, (GameStatus | null)[]>> {
  const limit = pLimit(concurrency);
  const entries = await Promise.all(
    steamIds.map(steamId => limit(async () => {
      try {
        const input = encodeURIComponent(JSON.stringify({ steamid: steamId, appids_filter: appids, include_appinfo: false }));
        const url = `${BASE_URL_GAMES}?key=${env.STEAM_API_KEY}&format=json&input_json=${input}`;
        const res = await fetch(url);
        if (!res.ok) return [steamId, appids.map(() => null)] as const;
        const data: { response: { games?: GameStatus[] } } = await res.json();
        const fetchedMap = new Map((data.response.games ?? []).map(g => [g.appid, g]));
        return [steamId, appids.map(id => fetchedMap.get(id) ?? null)] as const;
      } catch {
        return [steamId, appids.map(() => null)] as const;
      }
    }))
  );
  return Object.fromEntries(entries);
}

async function scheduleGameStatusRefresh(steamIds: string[], env: Env): Promise<void> {
  if (steamIds.length === 0) return;
  const unique = [...new Set(steamIds)];
  const locks = await Promise.all(unique.map(id => env.STEAM_PROFILE_CACHE.get(`refreshing:${id}`)));
  const toEnqueue = unique.filter((_, i) => locks[i] === null);
  if (toEnqueue.length === 0) return;
  await Promise.all(toEnqueue.map(id => env.STEAM_PROFILE_CACHE.put(`refreshing:${id}`, '1', { expirationTtl: 60 })));
  for (const batch of chunk(toEnqueue, 100)) {
    await env.GAME_STATUS_QUEUE.sendBatch(batch.map(steamId => ({ body: { steamId } })));
  }
}

// --- Public API ---

export async function getSteamProfiles(steamIds: string[], env: Env): Promise<SteamProfile[]> {
  const { resolved: fromKV, remaining: afterKV } = await resolveFromKV(steamIds, env.STEAM_PROFILE_CACHE);

  let fromDB: SteamProfile[] = [];
  let afterDB = afterKV;
  if (afterKV.length > 0) ({ resolved: fromDB, remaining: afterDB } = await resolveFromDB(afterKV, env));

  let fetched: SteamProfile[] = [];
  if (afterDB.length > 0) fetched = await fetchSteamProfiles(afterDB, env);

  const profileMap = new Map([...fromKV, ...fromDB, ...fetched].map(p => [p.steamId, p]));
  return steamIds.flatMap(id => { const p = profileMap.get(id); return p ? [p] : []; });
}

export async function getGameStatusNow(steamIds: string[], env: Env): Promise<Record<string, GameStatus | null>> {
  const profiles = await getSteamProfiles(steamIds, env);
  const result: Record<string, GameStatus | null> = {};
  const needsFetch: string[] = [];

  for (const p of profiles) {
    if (p.squad44Status !== null) result[p.steamId] = p.squad44Status;
    else needsFetch.push(p.steamId);
  }

  if (needsFetch.length > 0) {
    const statusMap = await fetchGamesHours(needsFetch, [SQUAD44_APPID], env, 6);
    const now = Math.floor(Date.now() / 1000);
    const needsFetchSet = new Set(needsFetch);
    const updated = profiles
      .filter(p => needsFetchSet.has(p.steamId))
      .map(p => ({ ...p, squad44Status: statusMap[p.steamId]?.[0] ?? null, updatedAt: now }));

    await persistProfiles(updated, env);
    for (const p of updated) result[p.steamId] = p.squad44Status;
  }

  for (const id of steamIds) if (!(id in result)) result[id] = null;
  return result;
}

export async function getGameStatusQueued(steamIds: string[], env: Env): Promise<Record<string, GameStatus | null>> {
  const profiles = await getSteamProfiles(steamIds, env);
  const result: Record<string, GameStatus | null> = {};
  const needsRefresh: string[] = [];

  for (const p of profiles) {
    result[p.steamId] = p.squad44Status;
    if (p.squad44Status === null) needsRefresh.push(p.steamId);
  }

  await scheduleGameStatusRefresh(needsRefresh, env);
  for (const id of steamIds) if (!(id in result)) result[id] = null;
  return result;
}

export async function executeGameStatusRefresh(steamIds: string[], env: Env): Promise<void> {
  if (steamIds.length === 0) return;
  const db = drizzle(env.DB);
  const rows = await db.select().from(steamProfiles).where(inArray(steamProfiles.steamId, steamIds));
  const profileMap = new Map(rows.map(r => [r.steamId, dbRowToProfile(r)]));
  const statusMap = await fetchGamesHours(steamIds, [SQUAD44_APPID], env, 5);
  const now = Math.floor(Date.now() / 1000);

  const updated: SteamProfile[] = [];
  for (const steamId of steamIds) {
    const profile = profileMap.get(steamId);
    if (!profile) continue;
    updated.push({ ...profile, squad44Status: statusMap[steamId]?.[0] ?? null, updatedAt: now });
  }

  await persistProfiles(updated, env);
  await Promise.all(steamIds.map(id => env.STEAM_PROFILE_CACHE.delete(`refreshing:${id}`)));
}
