import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { serverRoster } from '../../db/schema';
import { sendRconCommand } from './rcon';
import { parseListPlayers } from './listPlayers';
import { getActiveGameServer } from './strapi';
import { getSteamProfiles } from './steam';
import type { RosterResponse } from '../../shared/types';

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
  const players = result.active.flatMap(p => p.steamId ? [{ steamId: p.steamId, name: p.name }] : []);
  const row = {
    gameServerId: gameServer.documentId,
    players,
    playerCount: players.length,
    connectingCount: result.connecting,
    fetchedAt: Date.now(),
    parseOk: true,
  };

  await drizzle(env.DB)
    .insert(serverRoster)
    .values(row)
    .onConflictDoUpdate({ target: serverRoster.gameServerId, set: row });

  console.log(`pollRoster: ${gameServer.documentId} -> ${players.length} players, ${result.connecting} connecting`);

  // Warm the profile cache so the read path is a cache hit rather than a Steam API
  // round-trip. Deliberately after the roster write and non-fatal: a Steam outage
  // must not cost us the roster, which is the part that can only be read once.
  if (players.length > 0) {
    try {
      await getSteamProfiles(players.map(p => p.steamId), env);
    } catch (err) {
      console.warn('roster profile warm failed:', err);
    }
  }
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

  // Steam profiles are best-effort: getSteamProfiles drops IDs it cannot resolve
  // (private profile, Steam API down, brand-new player). Those players still appear,
  // identified by their SteamID and the in-game name RCON gave us.
  const profiles = row.players.length > 0
    ? await getSteamProfiles(row.players.map(p => p.steamId), env).catch((err: unknown) => {
      console.warn('roster profile lookup failed:', err);
      return [];
    })
    : [];
  const profileMap = new Map(profiles.map(p => [p.steamId, p]));

  return {
    players: row.players.map(p => {
      const profile = profileMap.get(p.steamId);
      return {
        steamId: p.steamId,
        name: p.name,
        steamName: profile?.name ?? null,
        avatar: profile?.avatar ?? null,
      };
    }),
    playerCount: row.playerCount,
    connectingCount: row.connectingCount,
    fetchedAt: row.fetchedAt,
    ageSeconds: Math.max(0, Math.round((Date.now() - row.fetchedAt) / 1000)),
    parseOk: row.parseOk,
  };
}
