import type { GameStatus, SteamProfile } from '../../shared/types';
import { drizzle } from 'drizzle-orm/d1';
import { and, gte, inArray, sql } from 'drizzle-orm';
import { steamProfiles } from '../../db/schema';
import pLimit from 'p-limit';

const MAX_STEAM_PROFILES_PER_REQUEST = 100;
const PROFILE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const MAX_RETRIES = 3;
const SQUAD44_APPID = 736220;
const BASE_URL_PLAYERS = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';
const BASE_URL_GAMES = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

type SteamPlayer = { steamid: string; personaname: string; profileurl: string; avatarfull: string; loccountrycode?: string };

async function fetchChunk(chunk: string[], apiKey: string): Promise<SteamPlayer[]> {
  const url = new URL(BASE_URL_PLAYERS);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', chunk.join(','));

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`fetchChunk attempt ${attempt + 1} failed: HTTP ${response.status}`);
        continue;
      }
      const data: { response: { players: SteamPlayer[] } } = await response.json();
      return data.response.players;
    } catch (e) {
      console.warn(`fetchChunk attempt ${attempt + 1} threw:`, e);
    }
  }
  console.error('Failed to fetch chunk after all retries:\n', chunk);
  return [];
}

function chunkSteamIds(steamIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < steamIds.length; i += MAX_STEAM_PROFILES_PER_REQUEST) chunks.push(steamIds.slice(i, i + MAX_STEAM_PROFILES_PER_REQUEST));
  return chunks;
}

function playersToProfiles(players: SteamPlayer[], statusMap: Record<string, GameStatus | null> = {}): SteamProfile[] {
  const now = Math.floor(Date.now() / 1000);
  return players.map(player => ({
    steamId: player.steamid,
    name: player.personaname,
    avatar: player.avatarfull,
    profileUrl: player.profileurl,
    countryCode: player.loccountrycode ?? null,
    squad44Status: statusMap[player.steamid] ?? null,
    updatedAt: now,
  }));
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

async function setKVProfiles(profiles: SteamProfile[], kv: KVNamespace): Promise<void> {
  await Promise.all(profiles.map(p => kv.put(p.steamId, JSON.stringify(p), { expirationTtl: PROFILE_TTL_SECONDS })));
}

async function resolveFromKV(steamIds: string[], kv: KVNamespace): Promise<{ resolved: SteamProfile[], remaining: string[] }> {
  const chunks = chunkSteamIds(steamIds);
  const maps = await Promise.all(chunks.map(chunk => kv.get(chunk, { type: 'json' })));
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

async function resolveFromDB(steamIds: string[], env: Env): Promise<{ resolved: SteamProfile[], remaining: string[] }> {
  const now = Math.floor(Date.now() / 1000);
  const db = drizzle(env.DB);
  const rows = await db.select().from(steamProfiles).where(
    and(inArray(steamProfiles.steamId, steamIds), gte(steamProfiles.updatedAt, now - PROFILE_TTL_SECONDS))
  );
  const resolved = rows.map(dbRowToProfile);
  const foundIds = new Set(rows.map(r => r.steamId));
  void setKVProfiles(resolved, env.STEAM_PROFILE_CACHE); // fire-and-forget KV warming
  return {
    resolved,
    remaining: steamIds.filter(id => !foundIds.has(id)),
  };
}

async function getSteamProfilesWithConcurrency(steamIds: string[], concurrency: number, env: Env): Promise<SteamProfile[]> {
  const limit = pLimit(concurrency);
  const batches = await Promise.all(chunkSteamIds(steamIds).map(chunk => limit(() => fetchChunk(chunk, env.STEAM_API_KEY))));
  const fetched = playersToProfiles(batches.flat());
  await upsertSteamProfiles(fetched, env);
  await setKVProfiles(fetched, env.STEAM_PROFILE_CACHE);

  return fetched;
}

export type LazyProfile = {
  profile: SteamProfile;
  /** Enqueues a background Steam game-hours fetch; returns the current (possibly stale) value immediately. */
  refresh: () => Promise<GameStatus | null>;
  /** Fetches Steam game-hours synchronously and returns the fresh value. */
  refreshSync: () => Promise<GameStatus | null>;
  needsGameStatusRefresh: boolean;
};

// lazy for game status fetching. Game status fetching is cost much. BUt fetching the basic info is not
export async function getLazySteamProfiles(steamIds: string[], env: Env, concurrency: number = 6): Promise<LazyProfile[]> {
  const { resolved: fromKV, remaining: afterKV } = await resolveFromKV(steamIds, env.STEAM_PROFILE_CACHE);

  let fromDB: SteamProfile[] = [];
  let afterDB: string[] = afterKV;
  if (afterKV.length > 0) {
    ({ resolved: fromDB, remaining: afterDB } = await resolveFromDB(afterKV, env));
  }

  let fetched: SteamProfile[] = [];
  if (afterDB.length > 0) {
    fetched = await getSteamProfilesWithConcurrency(afterDB, concurrency, env);
  }

  const freshlyFetchedIds = new Set(fetched.map(p => p.steamId));
  const profileMap = new Map([...fromKV, ...fromDB, ...fetched].map(p => [p.steamId, p]));

  return steamIds.flatMap(id => {
    const profile = profileMap.get(id);
    if (!profile) return [];
    const needsGameStatus = freshlyFetchedIds.has(id) || profile.squad44Status === null;

    const refreshSync = async (): Promise<GameStatus | null> => {
      if (!needsGameStatus) return profile.squad44Status;
      const statusMap = await fetchGamesHours([id], [SQUAD44_APPID], env.STEAM_API_KEY, 1);
      const gameStatus = statusMap[id]?.[0] ?? null;
      const updated = { ...profile, squad44Status: gameStatus, updatedAt: Math.floor(Date.now() / 1000) };
      await upsertSteamProfiles([updated], env);
      await setKVProfiles([updated], env.STEAM_PROFILE_CACHE);
      return gameStatus;
    };

    const refresh = async (): Promise<GameStatus | null> => {
      if (!needsGameStatus) return profile.squad44Status;
      await enqueueGameStatusRefresh([id], env.GAME_STATUS_QUEUE, env.STEAM_PROFILE_CACHE);
      return profile.squad44Status;
    };

    return [{ profile, refresh, refreshSync, needsGameStatusRefresh: needsGameStatus }];
  });
}

export async function enqueueGameStatusRefresh(steamIds: string[], queue: Queue<{ steamId: string }>, kv: KVNamespace): Promise<void> {
  if (steamIds.length === 0) return;
  const unique = [...new Set(steamIds)];

  const lockKeys = unique.map(id => `refreshing:${id}`);
  const locks = await Promise.all(lockKeys.map(k => kv.get(k)));
  const toEnqueue = unique.filter((_, i) => locks[i] === null);
  if (toEnqueue.length === 0) return;

  await Promise.all(toEnqueue.map(id => kv.put(`refreshing:${id}`, '1', { expirationTtl: 600 })));
  for (let i = 0; i < toEnqueue.length; i += 100) {
    await queue.sendBatch(toEnqueue.slice(i, i + 100).map(steamId => ({ body: { steamId } })));
  }
}

export async function processGameStatusRefreshBatch(steamIds: string[], env: Env): Promise<void> {
  if (steamIds.length === 0) return;
  const db = drizzle(env.DB);
  const rows = await db.select().from(steamProfiles).where(inArray(steamProfiles.steamId, steamIds));
  const profileMap = new Map(rows.map(r => [r.steamId, dbRowToProfile(r)]));

  const statusMap = await fetchGamesHours(steamIds, [SQUAD44_APPID], env.STEAM_API_KEY, 5);

  const now = Math.floor(Date.now() / 1000);
  const updated: SteamProfile[] = [];
  for (const steamId of steamIds) {
    const profile = profileMap.get(steamId);
    if (!profile) continue;
    updated.push({ ...profile, squad44Status: statusMap[steamId]?.[0] ?? null, updatedAt: now });
  }

  await upsertSteamProfiles(updated, env);
  await setKVProfiles(updated, env.STEAM_PROFILE_CACHE);
  await Promise.all(steamIds.map(id => env.STEAM_PROFILE_CACHE.delete(`refreshing:${id}`)));
}

export async function getSteamProfile(steamId: string, env: Env): Promise<SteamProfile> {
  const [lazy] = await getLazySteamProfiles([steamId], env, 1);
  if (!lazy) throw new Error(`Steam profile not found: ${steamId}`);
  return lazy.profile;
}

// D1 限制 100 个 bound parameters，7 列 × 10 行 = 70，留有余量
const UPSERT_BATCH_SIZE = 10;

async function upsertSteamProfiles(profiles: SteamProfile[], env: Env): Promise<void> {
  if (profiles.length === 0) return;
  const db = drizzle(env.DB);
  for (let i = 0; i < profiles.length; i += UPSERT_BATCH_SIZE) {
    await db.insert(steamProfiles)
      .values(profiles.slice(i, i + UPSERT_BATCH_SIZE).map(p => ({
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
          squad44Status: sql`COALESCE(excluded.${sql.raw(steamProfiles.squad44Status.name)}, ${steamProfiles.squad44Status})`,
          updatedAt: sql`excluded.${sql.raw(steamProfiles.updatedAt.name)}`,
        },
      });
  }
}

async function fetchGamesHours(steamIds: string[], appids: number[], apiKey: string, concurrency: number): Promise<Record<string, (GameStatus | null)[]>> {
  const limit = pLimit(concurrency);
  const entries = await Promise.all(
    steamIds.map(steamId => limit(async () => {
      try {
        const input = encodeURIComponent(JSON.stringify({ steamid: steamId, appids_filter: appids, include_appinfo: false }));
        const url = `${BASE_URL_GAMES}?key=${apiKey}&format=json&input_json=${input}`;
        const response = await fetch(url);
        if (!response.ok) return [steamId, appids.map(() => null)] as const;
        const data: { response: { games?: GameStatus[] } } = await response.json();
        const fetchedMap = new Map((data.response.games ?? []).map(g => [g.appid, g]));
        return [steamId, appids.map(id => fetchedMap.get(id) ?? null)] as const;
      } catch {
        return [steamId, appids.map(() => null)] as const;
      }
    }))
  );
  return Object.fromEntries(entries);
}
