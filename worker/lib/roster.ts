import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { serverRoster } from '../../db/schema';
import { sendRconCommand } from './rcon';
import { parseListPlayers } from './listPlayers';
import { getActiveGameServer } from './strapi';
import { getSteamProfiles } from './steam';
import type { DisplayPlayer, ParsedPlayer, RosterResponse } from '../../shared/types';

// Bounds how many unknown players one poll may resolve. See the diff in pollRoster.
const MAX_NEW_PROFILES_PER_POLL = 10;

/**
 * The roster poll schedule. Must match `triggers.crons` in wrangler.jsonc exactly —
 * Cloudflare identifies which schedule fired by this string.
 *
 * Cron runs in UTC; 04:00–15:59 UTC is 12:00–23:59 CST, the hours the server is used.
 */
export const ROSTER_CRON = '* 4-15 * * *';

const ROSTER_WINDOW_START_UTC = 4;
const ROSTER_WINDOW_END_UTC = 16; // exclusive

/**
 * Whether the roster is being actively polled right now.
 *
 * Outside this window nothing refreshes the snapshot, so it can be many hours old.
 * Anything that gates on "who is currently on the server" must check this first
 * rather than trusting a stale roster.
 */
export function isWithinRosterWindow(now: Date = new Date()): boolean {
  const hour = now.getUTCHours();
  return hour >= ROSTER_WINDOW_START_UTC && hour < ROSTER_WINDOW_END_UTC;
}

/**
 * Polls the active game server's roster and stores it in D1.
 *
 * Called from the cron trigger, which Cloudflare invokes once globally per firing —
 * not once per colo. That is what keeps this to a single RCON connection per tick no
 * matter how many people are using the site. Read paths never call RCON; they read
 * the row this writes, so viewer count is fully decoupled from the game server.
 */
export async function pollRoster(env: Env): Promise<void> {
  const gameServer = await getActiveGameServer(env);
  if (!gameServer) {
    console.warn('pollRoster: no game server has isActive=true in Strapi');
    return;
  }
  if (!gameServer.rconHost || !gameServer.rconPort || !gameServer.rconPassword) {
    console.warn(`pollRoster: RCON not configured for ${gameServer.documentId}`);
    return;
  }

  const raw = await sendRconCommand(
    gameServer.rconHost,
    gameServer.rconPort,
    gameServer.rconPassword,
    'ListPlayers',
  );

  const result = parseListPlayers(raw);

  // A failed parse must not overwrite a good roster with an empty one — keep the last
  // known-good list and only flag it as unparsed, so the UI can show staleness.
  if (!result.ok) {
    console.warn(`pollRoster: ListPlayers had no recognisable section header (${raw.length} chars): ${raw.slice(0, 200)}`);
    await drizzle(env.DB)
      .update(serverRoster)
      .set({ parseOk: false })
      .where(eq(serverRoster.gameServerId, gameServer.documentId));
    return;
  }

  // parseListPlayers already routes null-SteamID entries into `connecting`, so this
  // only narrows the type rather than dropping anything.
  const parsed: ParsedPlayer[] = result.active.flatMap(p => p.steamId ? [{ steamId: p.steamId, name: p.name }] : []);

  const db = drizzle(env.DB);
  const [prevRow] = await db
    .select()
    .from(serverRoster)
    .where(eq(serverRoster.gameServerId, gameServer.documentId))
    .limit(1);
  const prevMap = new Map((prevRow?.players ?? []).map(p => [p.steamId, p]));

  // Only players we have never successfully attempted need a profile lookup. Everyone
  // else reuses the Steam data already stored, so a steady-state poll does no KV reads
  // at all. Capped per poll so a burst of unknown players (first deploy, map change,
  // KV cache expiry) cannot spend a large slice of the 1,000/day KV write budget in
  // one go — the remainder is picked up by subsequent polls a minute later.
  const needLookup = parsed
    .filter(p => !prevMap.get(p.steamId)?.profileTried)
    .map(p => p.steamId)
    .slice(0, MAX_NEW_PROFILES_PER_POLL);

  const profiles = needLookup.length > 0
    ? await getSteamProfiles(needLookup, env, { skipGameStatus: true }).catch((err: unknown) => {
      console.warn('roster profile lookup failed:', err);
      return [];
    })
    : [];
  const profileMap = new Map(profiles.map(p => [p.steamId, p]));
  const attempted = new Set(needLookup);

  const players: DisplayPlayer[] = parsed.map(p => {
    const prev = prevMap.get(p.steamId);
    // Already resolved: keep the Steam data, but take the in-game name from this poll
    // since players can rename mid-session.
    if (prev?.profileTried) return { ...prev, name: p.name };

    const profile = profileMap.get(p.steamId);
    return {
      steamId: p.steamId,
      name: p.name,
      steamName: profile?.name ?? null,
      avatar: profile?.avatar ?? null,
      // False here means "deferred by the cap", so the next poll retries. True with
      // null values means the lookup genuinely failed and must not be retried.
      profileTried: attempted.has(p.steamId),
    };
  });

  const row = {
    gameServerId: gameServer.documentId,
    players,
    playerCount: players.length,
    connectingCount: result.connecting,
    fetchedAt: Date.now(),
    parseOk: true,
  };

  await db
    .insert(serverRoster)
    .values(row)
    .onConflictDoUpdate({ target: serverRoster.gameServerId, set: row });

  const pending = parsed.length - players.filter(p => p.profileTried).length;
  console.log(`pollRoster: ${gameServer.documentId} -> ${players.length} players, ${result.connecting} connecting, ${needLookup.length} looked up, ${pending} pending`);
}

/** Reads the stored roster. Never contacts the game server. */
export async function getRoster(env: Env): Promise<RosterResponse | null> {
  const gameServer = await getActiveGameServer(env);
  if (!gameServer) {
    console.warn('getRoster: no game server has isActive=true in Strapi');
    return null;
  }

  const [row] = await drizzle(env.DB)
    .select()
    .from(serverRoster)
    .where(eq(serverRoster.gameServerId, gameServer.documentId))
    .limit(1);

  if (!row) {
    console.warn(`getRoster: no roster row for ${gameServer.documentId} — has the cron run yet?`);
    return null;
  }

  // The row already holds the 展示态 — the cron joined the Steam data in. Nothing to
  // resolve here, so a page view costs one D1 row read and touches no KV.
  return {
    players: row.players,
    playerCount: row.playerCount,
    connectingCount: row.connectingCount,
    fetchedAt: row.fetchedAt,
    ageSeconds: Math.max(0, Math.round((Date.now() - row.fetchedAt) / 1000)),
    parseOk: row.parseOk,
  };
}
