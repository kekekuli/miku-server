import { sendRconCommand } from './rcon';
import { getRoster } from './roster';
import { getActiveGameServer } from './strapi';
import { getSteamProfiles } from './steam';

export const RCON_BROADCAST_QUEUE = 'rcon-broadcast';

/** Announce that `requesterId` wants to swap with `targetId`. */
export interface ClaimBroadcastMessage {
  requesterId: string;
  targetId: string;
}

const SITE_URL = 'miku-server.org';

/**
 * Sends queued claim announcements to the game server.
 *
 * Consumed with `max_concurrency: 1`, so only one invocation of this runs at a time
 * account-wide. Combined with the sequential loop below, that means RCON never sees
 * more than one connection from this path no matter how many players click at once —
 * which is the reason claims go through a queue rather than being sent inline from
 * the request handler.
 */
export async function handleClaimBroadcasts(messages: ClaimBroadcastMessage[], env: Env): Promise<void> {
  if (messages.length === 0) return;

  const gameServer = await getActiveGameServer(env);
  if (!gameServer?.rconHost || !gameServer.rconPort || !gameServer.rconPassword) {
    console.warn('handleClaimBroadcasts: RCON not configured, dropping announcements');
    return;
  }

  // In-game names, not Steam persona names: the audience is people looking at the
  // server scoreboard, who recognise each other by in-game name.
  const roster = await getRoster(env);
  const nameById = new Map((roster?.players ?? []).map(p => [p.steamId, p.name]));

  // Anyone not on the roster has nothing to announce to — skip before spending RCON.
  const deliverable = messages.filter(m => nameById.has(m.targetId));
  if (deliverable.length === 0) return;

  // The requester may be absent from the roster (stale snapshot, or claiming from
  // outside the server), so fall back to their Steam name for display only.
  const unknownRequesters = [...new Set(
    deliverable.map(m => m.requesterId).filter(id => !nameById.has(id)),
  )];
  if (unknownRequesters.length > 0) {
    const profiles = await getSteamProfiles(unknownRequesters, env, { skipGameStatus: true })
      .catch((err: unknown) => {
        console.warn('handleClaimBroadcasts: requester profile lookup failed:', err);
        return [];
      });
    for (const p of profiles) nameById.set(p.steamId, p.name);
  }

  // Sequential on purpose. Promise.all here would defeat max_concurrency by opening
  // one RCON connection per message within a single invocation.
  for (const msg of deliverable) {
    const requester = nameById.get(msg.requesterId) ?? msg.requesterId;
    const target = nameById.get(msg.targetId)!;
    const text = `[自助跳边] ${requester} 正在认领 ${target}，请前往 ${SITE_URL} 确认（5分钟内有效）`;

    try {
      await sendRconCommand(gameServer.rconHost, gameServer.rconPort, gameServer.rconPassword, `AdminBroadcast ${text}`);
    } catch (err) {
      // Never throw: the batch is configured with max_retries 0, and letting one bad
      // announcement fail the batch would drop the others alongside it.
      console.warn(`handleClaimBroadcasts: broadcast failed for ${msg.requesterId} -> ${msg.targetId}:`, err);
    }
  }
}
