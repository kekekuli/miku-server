import { Hono } from 'hono';
import { requireAuth } from './auth';
import { sendRconCommand } from '../lib/rcon';
import { getGameStatusNow, getSteamProfiles } from '../lib/steam';
import { getActiveGameServer, type GameServer } from '../lib/strapi';
import type { Variables } from '../types';

const LOW_HOURS_THRESHOLD_MINUTES = 200 * 60;
const PENDING_TTL_SECONDS = 5 * 60;
// Players at or above the threshold get one jump per window. The window does not
// stack — this replaces the previous once-per-day quota.
const COOLDOWN_SECONDS = 30 * 60;

const teamSwap = new Hono<{ Bindings: Env; Variables: Variables }>();

const cooldownKey = (steamId: string) => `ts:cd:${steamId}`;

/**
 * Remaining cooldown in seconds, 0 when ready.
 *
 * The unlock timestamp is stored as the value rather than relying on the KV TTL
 * alone: KV cannot report a key's remaining TTL, and the client needs an actual
 * number to count down from. expirationTtl is still set so the key self-cleans.
 */
async function getCooldownSeconds(steamId: string, env: Env): Promise<number> {
  const raw = await env.STEAM_PROFILE_CACHE.get(cooldownKey(steamId));
  if (!raw) return 0;
  return Math.max(0, Math.ceil((Number(raw) - Date.now()) / 1000));
}

async function startCooldown(steamId: string, env: Env): Promise<void> {
  await env.STEAM_PROFILE_CACHE.put(
    cooldownKey(steamId),
    String(Date.now() + COOLDOWN_SECONDS * 1000),
    { expirationTtl: COOLDOWN_SECONDS },
  );
}

interface PlaytimeCheck {
  /** False when playtime could not be read at all. */
  known: boolean;
  /** Only ever true when `known` is true. */
  lowHours: boolean;
}

/**
 * Resolves a player's playtime into the two facts the swap rules need.
 *
 * Unknown playtime — a private Steam profile, a player who does not own the game,
 * or Steam being unreachable — must NOT grant the solo-jump benefit, otherwise
 * hiding your profile would be the cheapest way to bypass the partner requirement.
 * This deliberately fails closed to the matched path.
 */
async function checkPlaytime(steamId: string, env: Env): Promise<PlaytimeCheck> {
  const statusMap = await getGameStatusNow([steamId], env);
  const minutes = statusMap[steamId]?.playtime_forever ?? null;
  if (minutes === null) return { known: false, lowHours: false };
  return { known: true, lowHours: minutes < LOW_HOURS_THRESHOLD_MINUTES };
}

async function broadcastAndForceTeamChange(env: Env, gameServer: GameServer, changedId: string): Promise<void> {
  const [profile] = await getSteamProfiles([changedId], env);
  const name = profile?.name ?? changedId;
  // Broadcast failure is non-fatal
  await sendRconCommand(gameServer.rconHost, gameServer.rconPort, gameServer.rconPassword, `AdminBroadcast [自助跳边] 正在切换${name}的队伍`);
  const result = await sendRconCommand(gameServer.rconHost, gameServer.rconPort, gameServer.rconPassword, `AdminForceTeamChange ${changedId}`);
  if (result.trimStart().startsWith('ERROR')) throw new Error(result.trim());
}

// GET /api/team-swap — all pending requests (global) + current user's cooldown state
teamSwap.get('/', requireAuth, async c => {
  const myId = c.get('steamid');

  const [cooldownSeconds, playtime, listResult] = await Promise.all([
    getCooldownSeconds(myId, c.env),
    checkPlaytime(myId, c.env),
    c.env.STEAM_PROFILE_CACHE.list({ prefix: 'ts:req:' }),
  ]);

  const reqKeys = listResult.keys.map(k => k.name);

  // Batch-fetch values (each value is the targetId stored when queuing)
  const valueMap = new Map<string, string | null>();
  if (reqKeys.length > 0) {
    const result = await c.env.STEAM_PROFILE_CACHE.get(reqKeys, { type: 'text' });
    for (const [k, v] of result) valueMap.set(k, v);
  }

  const entries = reqKeys.map(key => ({
    requesterId: key.slice('ts:req:'.length),
    targetId: valueMap.get(key) ?? undefined,
  }));

  const myPending = entries.some(e => e.requesterId === myId);

  const allIds = [...new Set(entries.flatMap(e => e.targetId ? [e.requesterId, e.targetId] : [e.requesterId]))];
  const profileMap = new Map(
    allIds.length > 0
      ? (await getSteamProfiles(allIds, c.env)).map(p => [p.steamId, p])
      : [],
  );

  const toInfo = (id: string) => {
    const p = profileMap.get(id);
    return p ? { steamId: p.steamId, name: p.name, avatar: p.avatar } : null;
  };

  const requests = entries.flatMap(e => {
    const requester = toInfo(e.requesterId);
    if (!requester) return [];
    return [{ requester, target: e.targetId ? toInfo(e.targetId) : null }];
  });

  return c.json({ cooldownSeconds, lowHours: playtime.lowHours, hoursKnown: playtime.known, myPending, requests });
});

// POST /api/team-swap
// Body: { targetSteamId?: string }
//
// The cooldown gates every caller. Past it, low-hours players jump alone and ignore
// the body; everyone else must match mutually with the named target, and that target
// must be off cooldown too. Players whose playtime cannot be read count as normal.
teamSwap.post('/', requireAuth, async c => {
  const myId = c.get('steamid');

  const gameServer = await getActiveGameServer(c.env);
  if (!gameServer) {
    return c.json({ error: 'RCON is not configured' }, 503);
  }

  // The cooldown applies to everyone, so it is checked before the paths diverge.
  // Re-checked server-side on every submit: the client's countdown is display only.
  const myCooldown = await getCooldownSeconds(myId, c.env);
  if (myCooldown > 0) {
    return c.json({ error: '你仍在冷却中', cooldownSeconds: myCooldown }, 429);
  }

  // Low-hours path: no partner and no matching, but still rate limited.
  if ((await checkPlaytime(myId, c.env)).lowHours) {
    try {
      await broadcastAndForceTeamChange(c.env, gameServer, myId);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : '换队失败' }, 500);
    }
    // Drop any request queued before this player crossed under the threshold, so it
    // cannot later match someone who is still waiting on it.
    await Promise.all([
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`),
      startCooldown(myId, c.env),
    ]);
    return c.json({ status: 'changed', changedSteamId: myId, reason: 'low_hours', cooldownSeconds: COOLDOWN_SECONDS });
  }

  const body = await c.req.json<{ targetSteamId?: string }>().catch((): { targetSteamId?: string } => ({}));
  const targetId = body.targetSteamId?.trim();

  if (!targetId) return c.json({ error: 'targetSteamId is required' }, 400);
  if (targetId === myId) return c.json({ error: 'Cannot request with yourself' }, 400);

  // Value stored is the intended targetId — null means no pending request
  const storedTargetId = await c.env.STEAM_PROFILE_CACHE.get(`ts:req:${targetId}`);

  if (storedTargetId !== null) {
    // Enforce that only the intended target can trigger the match
    if (storedTargetId !== myId) {
      return c.json({ error: '该请求不是发给你的' }, 403);
    }

    const targetCooldown = await getCooldownSeconds(targetId, c.env);
    if (targetCooldown > 0) {
      return c.json({ error: '对方仍在冷却中', cooldownSeconds: targetCooldown }, 429);
    }

    const changedId = Math.random() < 0.5 ? myId : targetId;
    try {
      await broadcastAndForceTeamChange(c.env, gameServer, changedId);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : '换队失败' }, 500);
    }

    // Both sides spend the jump, matching the previous daily-quota behaviour.
    await Promise.all([
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${targetId}`),
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`),
      startCooldown(myId, c.env),
      startCooldown(targetId, c.env),
    ]);

    return c.json({ status: 'changed', changedSteamId: changedId, reason: 'matched', cooldownSeconds: COOLDOWN_SECONDS });
  }

  // A low-hours target jumps solo and will never send a matching request back, so
  // queueing against them could only expire unused. Say so rather than let the
  // requester wait out the full five minutes for nothing.
  if ((await checkPlaytime(targetId, c.env)).lowHours) {
    return c.json({ error: '对方游戏时长不足 200 小时，可自行跳边，无需与你匹配' }, 400);
  }

  // No match yet — queue this request, storing targetId as the value
  await c.env.STEAM_PROFILE_CACHE.put(`ts:req:${myId}`, targetId, { expirationTtl: PENDING_TTL_SECONDS });
  return c.json({ status: 'pending', message: '等待对方确认，请对方在5分钟内发出请求' });
});

// DELETE /api/team-swap — cancel own pending request
teamSwap.delete('/', requireAuth, async c => {
  const myId = c.get('steamid');
  await c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`);
  return c.body(null, 204);
});

export default teamSwap;
