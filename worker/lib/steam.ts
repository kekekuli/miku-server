import type { GameStatus, SteamProfile } from '../../shared/types';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { steamProfiles, steamGameStatus } from '../../db/schema';
import pLimit from 'p-limit';

// KV operations (cacheProfiles, cacheGameStatus, lock get/put/delete) run with full Promise.all
// concurrency — no pLimit — to minimise latency. Cloudflare caps total subrequests per request
// (1,000 free / 10,000 paid), not concurrency, and typical player counts stay well below that.
// Only external Steam API fetches are throttled (PROFILE_CONCURRENCY) to avoid rate-limiting.
const PROFILE_CONCURRENCY = 6;
const MAX_STEAM_PROFILES_PER_REQUEST = 100;
const PROFILE_TTL_SECONDS = 60 * 60 * 24 * 7;          // 7 days
const GAME_STATUS_TTL_SECONDS = 60 * 60 * 24;           // 24 hours
const GAME_STATUS_STALE_SECONDS = PROFILE_TTL_SECONDS;  // same window as profile TTL
const PROFILE_KV_PREFIX = 'profile:';
const GAME_STATUS_KV_PREFIX = 'gs:';
const UPSERT_BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const SQUAD44_APPID = 736220;
const BASE_URL_PLAYERS = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';
const BASE_URL_GAMES = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

// --- Internal helpers ---

type SteamPlayer = { steamid: string; personaname: string; profileurl: string; avatarfull: string; loccountrycode?: string };
type ProfileRow = typeof steamProfiles.$inferSelect;
type GameStatusRow = typeof steamGameStatus.$inferSelect;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function toGameStatus(row: GameStatusRow): GameStatus {
  return {
    appid: row.appId,
    playtime_forever: row.playtimeForever,
    ...(row.playtime2Weeks !== null && { playtime_2weeks: row.playtime2Weeks }),
  };
}

function dbRowToProfile(profileRow: ProfileRow, gameStatusRow?: GameStatusRow | null): SteamProfile {
  return {
    steamId: profileRow.steamId,
    name: profileRow.name,
    avatar: profileRow.avatar,
    profileUrl: profileRow.profileUrl,
    countryCode: profileRow.countryCode,
    updatedAt: profileRow.updatedAt,
    squad44Status: gameStatusRow ? toGameStatus(gameStatusRow) : null,
  };
}

// KV-only writes — used by resolveFromDB to repopulate cache without touching DB.
async function cacheProfiles(profiles: SteamProfile[], kv: KVNamespace): Promise<void> {
  if (profiles.length === 0) return;
  await Promise.all(profiles.map(({ squad44Status: _, ...profileData }) =>
    kv.put(`${PROFILE_KV_PREFIX}${profileData.steamId}`, JSON.stringify(profileData), { expirationTtl: PROFILE_TTL_SECONDS })
  ));
}

async function cacheGameStatus(rows: GameStatusRow[], kv: KVNamespace): Promise<void> {
  if (rows.length === 0) return;
  await Promise.all(rows.map(r =>
    kv.put(`${GAME_STATUS_KV_PREFIX}${r.steamId}`, JSON.stringify(toGameStatus(r)), { expirationTtl: GAME_STATUS_TTL_SECONDS })
  ));
}

// DB + KV writes — used when data is freshly fetched and must be persisted.
async function syncProfile(profiles: SteamProfile[], env: Env): Promise<void> {
  if (profiles.length === 0) return;
  const db = drizzle(env.DB);

  await Promise.all([
    (async () => {
      for (const batch of chunk(profiles, UPSERT_BATCH_SIZE)) {
        await db.insert(steamProfiles)
          .values(batch.map(p => ({
            steamId: p.steamId,
            name: p.name,
            avatar: p.avatar,
            profileUrl: p.profileUrl,
            countryCode: p.countryCode,
            updatedAt: p.updatedAt,
          })))
          .onConflictDoUpdate({
            target: steamProfiles.steamId,
            set: {
              name: sql`excluded.${sql.raw(steamProfiles.name.name)}`,
              avatar: sql`excluded.${sql.raw(steamProfiles.avatar.name)}`,
              profileUrl: sql`excluded.${sql.raw(steamProfiles.profileUrl.name)}`,
              countryCode: sql`excluded.${sql.raw(steamProfiles.countryCode.name)}`,
              updatedAt: sql`excluded.${sql.raw(steamProfiles.updatedAt.name)}`,
            },
          });
      }
    })(),
    cacheProfiles(profiles, env.STEAM_PROFILE_CACHE),
  ]);
}

async function syncGameStatus(rows: GameStatusRow[], env: Env): Promise<void> {
  if (rows.length === 0) return;
  const db = drizzle(env.DB);

  await Promise.all([
    (async () => {
      for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        await db.insert(steamGameStatus)
          .values(batch)
          .onConflictDoUpdate({
            target: [steamGameStatus.steamId, steamGameStatus.appId],
            set: {
              playtimeForever: sql`excluded.${sql.raw(steamGameStatus.playtimeForever.name)}`,
              playtime2Weeks: sql`excluded.${sql.raw(steamGameStatus.playtime2Weeks.name)}`,
              updatedAt: sql`excluded.${sql.raw(steamGameStatus.updatedAt.name)}`,
            },
          });
      }
    })(),
    cacheGameStatus(rows, env.STEAM_PROFILE_CACHE),
  ]);
}

async function resolveFromKV(steamIds: string[], kv: KVNamespace): Promise<{ resolved: SteamProfile[]; remaining: string[] }> {
  if (steamIds.length === 0) return { resolved: [], remaining: [] };
  const profileKeys = steamIds.map(id => `${PROFILE_KV_PREFIX}${id}`);
  const gameStatusKeys = steamIds.map(id => `${GAME_STATUS_KV_PREFIX}${id}`);

  // in latest KV API(2026.6.8), kv.get() support pass in arrays
  const [profileMaps, gameStatusMaps] = await Promise.all([
    Promise.all(chunk(profileKeys, MAX_STEAM_PROFILES_PER_REQUEST).map(c => kv.get(c, { type: 'json' }))),
    Promise.all(chunk(gameStatusKeys, MAX_STEAM_PROFILES_PER_REQUEST).map(c => kv.get(c, { type: 'json' }))),
  ]);

  const profileMap = new Map<string, Omit<SteamProfile, 'squad44Status'> | null>();
  for (const map of profileMaps) for (const [k, v] of map) profileMap.set(k, v as Omit<SteamProfile, 'squad44Status'> | null);
  const gameStatusMap = new Map<string, GameStatus | null>();
  for (const map of gameStatusMaps) for (const [k, v] of map) gameStatusMap.set(k, v as GameStatus | null);

  const resolved: SteamProfile[] = [];
  const remaining: string[] = [];
  for (const id of steamIds) {
    const profile = profileMap.get(`${PROFILE_KV_PREFIX}${id}`);
    if (profile) resolved.push({ ...profile, squad44Status: gameStatusMap.get(`${GAME_STATUS_KV_PREFIX}${id}`) ?? null });
    else remaining.push(id);
  }
  return { resolved, remaining };
}

const SQLITE_MAX_VARIABLES = 999;

async function resolveFromDB(steamIds: string[], env: Env): Promise<{ resolved: SteamProfile[]; remaining: string[] }> {
  if (steamIds.length === 0) return { resolved: [], remaining: [] };
  const now = Math.floor(Date.now() / 1000);
  const db = drizzle(env.DB);

  // Chunk to stay within SQLite's 999-variable IN clause limit.
  const allRows = (await Promise.all(
    chunk(steamIds, SQLITE_MAX_VARIABLES).map(ids =>
      db.select()
        .from(steamProfiles)
        .leftJoin(
          steamGameStatus,
          and(
            eq(steamGameStatus.steamId, steamProfiles.steamId),
            eq(steamGameStatus.appId, SQUAD44_APPID),
            gte(steamGameStatus.updatedAt, now - GAME_STATUS_STALE_SECONDS),
          )
        )
        .where(and(
          inArray(steamProfiles.steamId, ids),
          gte(steamProfiles.updatedAt, now - PROFILE_TTL_SECONDS),
        ))
    )
  )).flat();

  const resolved = allRows.map(r => dbRowToProfile(r.steam_profiles, r.steam_game_status));
  const foundIds = new Set(allRows.map(r => r.steam_profiles.steamId));
  const gameStatusRows = allRows.flatMap(r => r.steam_game_status ? [r.steam_game_status] : []);
  // KV-only: data already exists in DB, no need to re-upsert.
  await Promise.all([cacheProfiles(resolved, env.STEAM_PROFILE_CACHE), cacheGameStatus(gameStatusRows, env.STEAM_PROFILE_CACHE)]);
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
  await syncProfile(profiles, env);
  return profiles;
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
  // Note: there is a TOCTOU race between the lock get and put — two concurrent requests can both
  // see null and enqueue the same ID. KV has no atomic compare-and-set; fixing this would require
  // Durable Objects. The queue handler must be idempotent to handle duplicate messages safely.
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
    const rows: GameStatusRow[] = needsFetch.flatMap(id => {
      const gs = statusMap[id]?.[0];
      if (!gs) return [];
      return [{ steamId: id, appId: SQUAD44_APPID, playtimeForever: gs.playtime_forever, playtime2Weeks: gs.playtime_2weeks ?? null, updatedAt: now }];
    });
    await syncGameStatus(rows, env);
    for (const r of rows) result[r.steamId] = toGameStatus(r);
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
  const statusMap = await fetchGamesHours(steamIds, [SQUAD44_APPID], env, 5);
  const now = Math.floor(Date.now() / 1000);
  const rows: GameStatusRow[] = steamIds.flatMap(id => {
    const gs = statusMap[id]?.[0];
    if (!gs) return [];
    return [{ steamId: id, appId: SQUAD44_APPID, playtimeForever: gs.playtime_forever, playtime2Weeks: gs.playtime_2weeks ?? null, updatedAt: now }];
  });

  await Promise.all([
    syncGameStatus(rows, env),
    Promise.all(steamIds.map(id => env.STEAM_PROFILE_CACHE.delete(`refreshing:${id}`))),
  ]);
}
