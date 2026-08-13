import { Hono, type Context } from 'hono';
import { requireAuth } from './auth';
import { sendRconCommand } from '../lib/rcon';
import { getGameStatusNow, getSteamProfiles } from '../lib/steam';
import { getActiveGameServer, getAdminPermissions, type GameServer } from '../lib/strapi';
import type { ClaimBroadcastMessage } from '../lib/broadcast';
import { getRoster, isWithinRosterWindow } from '../lib/roster';
import type { TeamSwapBlock } from '../../shared/types';
import type { Variables } from '../types';

const LOW_HOURS_THRESHOLD_MINUTES = 200 * 60;
const PENDING_TTL_SECONDS = 5 * 60;
// Players at or above the threshold get one jump per window. The window does not
// stack — this replaces the previous once-per-day quota.
const COOLDOWN_SECONDS = 30 * 60;
// Matches PENDING_TTL_SECONDS: one in-game announcement per pending-request lifetime.
const BROADCAST_COOLDOWN_SECONDS = PENDING_TTL_SECONDS;
// How stale the roster may be and still be used to decide who is on the server.
// Generous enough to survive a few missed polls, short enough that it never gates on
// data from outside the cron's active window.
const ROSTER_TRUST_SECONDS = 5 * 60;

/**
 * Player-facing swap activity, kept out of `admin_actions` — that stream is for
 * privileged operations, this one is ordinary user behaviour and is far chattier.
 *
 * Every event is "actorId did `action`, with partnerId": the actor is always whoever
 * sent the request, and the action says which side of the pair that makes them.
 *
 *   claim   A asked B to swap. `broadcast` records whether the in-game announcement
 *           went out or was swallowed by the per-requester dedupe window.
 *   confirm B answered A's claim, so the pair swapped. `changedSteamId` is whichever
 *           of the two RCON actually moved — a coin flip.
 *   solo    C jumped alone, being under the playtime threshold. No partner.
 *   cancel  A withdrew the claim it had against B.
 */
const SWAP_STREAM = 'team_swap_activities';

interface SwapEvent {
  action: 'claim' | 'confirm' | 'solo' | 'cancel';
  actorId: string;
  partnerId: string | null;
  /** Who RCON moved. Always the actor or the partner, so it needs no name of its own. */
  changedSteamId: string | null;
  success: boolean;
  /** Claims only: whether the in-game announcement went out or was deduped away. */
  broadcast?: boolean;
  error?: string;
}

/**
 * Emits one swap event with display names resolved alongside the ids.
 *
 * Profiles come from the KV/D1 cache these flows already populate, so this is normally
 * a cache read. Name resolution is best effort on purpose: it runs after the swap has
 * already happened, and a Steam outage must not turn a successful jump into a 500.
 */
async function logSwap(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  event: SwapEvent,
): Promise<void> {
  let actorName: string | null = null;
  let partnerName: string | null = null;

  try {
    const ids = [...new Set([event.actorId, ...(event.partnerId ? [event.partnerId] : [])])];
    const profiles = await getSteamProfiles(ids, c.env, { skipGameStatus: true });
    const nameOf = (id: string | null) =>
      id === null ? null : profiles.find(p => p.steamId === id)?.name ?? null;
    actorName = nameOf(event.actorId);
    partnerName = nameOf(event.partnerId);
  } catch {
    // Fall through and log the ids alone rather than losing the event entirely.
  }

  c.var.logEvent(SWAP_STREAM, { ...event, actorName, partnerName });
}

const teamSwap = new Hono<{ Bindings: Env; Variables: Variables }>();

const cooldownKey = (steamId: string) => `ts:cd:${steamId}`;
const broadcastCooldownKey = (steamId: string) => `ts:bc:${steamId}`;

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
/**
 * Why team swapping is unavailable for this player, or null when it is available.
 *
 * Team swapping is only meaningful while the player is actually in the game, which is
 * decided from the roster snapshot. That snapshot is only refreshed inside the poll
 * window, so the window is checked first — outside it the data is hours old and would
 * wrongly reject everyone.
 */
async function checkAvailability(steamId: string, env: Env): Promise<TeamSwapBlock> {
  if (!isWithinRosterWindow()) return 'outside_hours';

  const roster = await getRoster(env);
  // Inside the window the roster should be at most a minute old. Anything older means
  // the poll is failing, and gating on it would be gating on fiction — say so rather
  // than telling players they are not on a server they are standing on.
  if (!roster || !roster.parseOk || roster.ageSeconds > ROSTER_TRUST_SECONDS) {
    return 'roster_unavailable';
  }

  return roster.players.some(p => p.steamId === steamId) ? null : 'not_on_server';
}

const BLOCK_MESSAGE: Record<NonNullable<TeamSwapBlock>, string> = {
  outside_hours: '自助跳边仅在每天 12:00–24:00 开放',
  roster_unavailable: '在线名单暂时不可用，请稍后再试',
  not_on_server: '你当前不在服务器内，请先进入服务器再发起换边',
};

/**
 * Whether this player is exempt from the cooldown and the in-server requirement.
 *
 * Gated on canRcon specifically, not merely "is an admin": anyone with that permission
 * can already issue AdminForceTeamChange straight from the admin panel, so the
 * exemption grants nothing they did not already have. Gating on admin-ness in general
 * would hand a brand new capability to, say, a vote manager.
 */
async function hasRconPrivilege(steamId: string, env: Env): Promise<boolean> {
  const permissions = await getAdminPermissions(steamId, env);
  return permissions !== null && 'canRcon' in permissions;
}

async function checkPlaytime(steamId: string, env: Env): Promise<PlaytimeCheck> {
  const statusMap = await getGameStatusNow([steamId], env);
  const minutes = statusMap[steamId]?.playtime_forever ?? null;
  if (minutes === null) return { known: false, lowHours: false };
  return { known: true, lowHours: minutes < LOW_HOURS_THRESHOLD_MINUTES };
}

/**
 * Announces the swap in game, then performs it.
 *
 * Sent inline rather than through the broadcast queue: the caller has to report
 * whether the swap actually succeeded, so AdminForceTeamChange cannot be fire and
 * forget, and there is no point serialising only half of the pair.
 *
 * The low-hours wording spells out the rule, otherwise everyone else on the server
 * sees someone swap without the usual two-party confirmation and assumes it is a bug
 * or a favour.
 */
async function broadcastAndForceTeamChange(
  env: Env,
  gameServer: GameServer,
  changedId: string,
  reason: 'low_hours' | 'matched',
): Promise<void> {
  // Prefer the in-game name, same as the claim announcements — people on the server
  // recognise each other by scoreboard name, not Steam persona.
  const roster = await getRoster(env);
  const inGameName = roster?.players.find(p => p.steamId === changedId)?.name;
  const [profile] = inGameName ? [] : await getSteamProfiles([changedId], env, { skipGameStatus: true });
  const name = inGameName ?? profile?.name ?? changedId;

  const text = reason === 'low_hours'
    ? `[自助跳边] ${name} 时长不足200小时，免认领直接跳边（30分钟冷却）`
    : `[自助跳边] 正在切换${name}的队伍`;

  // Broadcast failure is non-fatal
  await sendRconCommand(gameServer.rconHost, gameServer.rconPort, gameServer.rconPassword, `AdminBroadcast ${text}`);
  const result = await sendRconCommand(gameServer.rconHost, gameServer.rconPort, gameServer.rconPassword, `AdminForceTeamChange ${changedId}`);
  if (result.trimStart().startsWith('ERROR')) throw new Error(result.trim());
}

// GET /api/team-swap — all pending requests (global) + current user's cooldown state
teamSwap.get('/', requireAuth, async c => {
  const myId = c.get('steamid');

  const [rawCooldown, playtime, rawBlocked, isAdmin, listResult] = await Promise.all([
    getCooldownSeconds(myId, c.env),
    checkPlaytime(myId, c.env),
    checkAvailability(myId, c.env),
    hasRconPrivilege(myId, c.env),
    c.env.STEAM_PROFILE_CACHE.list({ prefix: 'ts:req:' }),
  ]);

  // Report the effective values rather than the raw ones, so the client never has to
  // reimplement the exemption rules — and can never disagree with the server about
  // them. isAdmin exists only to explain the difference in the UI.
  const cooldownSeconds = isAdmin ? 0 : rawCooldown;
  const blocked = isAdmin ? null : rawBlocked;

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

  return c.json({
    cooldownSeconds,
    lowHours: playtime.lowHours,
    hoursKnown: playtime.known,
    blocked,
    blockedMessage: blocked ? BLOCK_MESSAGE[blocked] : null,
    isAdmin,
    myPending,
    requests,
  });
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

  const isAdmin = await hasRconPrivilege(myId, c.env);

  if (!isAdmin) {
    // Nothing here works for someone who is not in the game — AdminForceTeamChange
    // would target a player the server does not have. Checked before the cooldown so
    // the message says the useful thing rather than "you are on cooldown".
    const block = await checkAvailability(myId, c.env);
    if (block) return c.json({ error: BLOCK_MESSAGE[block], blocked: block }, 409);

    // Re-checked server-side on every submit: the client's countdown is display only.
    const myCooldown = await getCooldownSeconds(myId, c.env);
    if (myCooldown > 0) {
      return c.json({ error: '你仍在冷却中', cooldownSeconds: myCooldown }, 429);
    }
  }

  // Low-hours path: no partner and no matching, but still rate limited.
  if ((await checkPlaytime(myId, c.env)).lowHours) {
    try {
      await broadcastAndForceTeamChange(c.env, gameServer, myId, 'low_hours');
    } catch (err) {
      const message = err instanceof Error ? err.message : '换队失败';
      await logSwap(c, {
        action: 'solo', actorId: myId, partnerId: null,
        changedSteamId: null, success: false, error: message,
      });
      return c.json({ error: message }, 500);
    }
    // Drop any request queued before this player crossed under the threshold, so it
    // cannot later match someone who is still waiting on it.
    await Promise.all([
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`),
      // Setting a cooldown an admin does not obey would only make the UI lie to them.
      ...(isAdmin ? [] : [startCooldown(myId, c.env)]),
    ]);
    await logSwap(c, {
      action: 'solo', actorId: myId, partnerId: null,
      changedSteamId: myId, success: true,
    });
    return c.json({ status: 'changed', changedSteamId: myId, reason: 'low_hours', cooldownSeconds: isAdmin ? 0 : COOLDOWN_SECONDS });
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

    // The exemption is symmetric: an admin on the other side of the match is not a
    // reason to refuse, and must not have a cooldown spent on them below.
    const targetIsAdmin = await hasRconPrivilege(targetId, c.env);
    if (!targetIsAdmin) {
      const targetCooldown = await getCooldownSeconds(targetId, c.env);
      if (targetCooldown > 0) {
        return c.json({ error: '对方仍在冷却中', cooldownSeconds: targetCooldown }, 429);
      }
    }

    const changedId = Math.random() < 0.5 ? myId : targetId;
    try {
      await broadcastAndForceTeamChange(c.env, gameServer, changedId, 'matched');
    } catch (err) {
      const message = err instanceof Error ? err.message : '换队失败';
      await logSwap(c, {
        action: 'confirm', actorId: myId, partnerId: targetId,
        changedSteamId: null, success: false, error: message,
      });
      return c.json({ error: message }, 500);
    }

    // Both sides spend the jump, matching the previous daily-quota behaviour — except
    // admins, who are exempt on whichever side they are on.
    await Promise.all([
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${targetId}`),
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`),
      ...(isAdmin ? [] : [startCooldown(myId, c.env)]),
      ...(targetIsAdmin ? [] : [startCooldown(targetId, c.env)]),
    ]);

    await logSwap(c, {
      action: 'confirm', actorId: myId, partnerId: targetId,
      changedSteamId: changedId, success: true,
    });
    return c.json({ status: 'changed', changedSteamId: changedId, reason: 'matched', cooldownSeconds: isAdmin ? 0 : COOLDOWN_SECONDS });
  }

  // A low-hours target jumps solo and will never send a matching request back, so
  // queueing against them could only expire unused. Say so rather than let the
  // requester wait out the full five minutes for nothing.
  if ((await checkPlaytime(targetId, c.env)).lowHours) {
    return c.json({ error: '对方游戏时长不足 200 小时，可自行跳边，无需与你匹配' }, 400);
  }

  // No match yet — queue this request, storing targetId as the value
  await c.env.STEAM_PROFILE_CACHE.put(`ts:req:${myId}`, targetId, { expirationTtl: PENDING_TTL_SECONDS });

  // Announce the claim in game so the target knows to come confirm. Rate limited per
  // requester: AdminBroadcast is a full-screen popup for everyone on the server, and
  // without this a cancel/re-claim loop would spam it. The window matches the pending
  // request TTL, so one announcement per request cycle.
  //
  // canRcon holders are exempt, for the same reason as the other exemptions: they can
  // already send AdminBroadcast straight from the admin panel, so the window stops
  // nothing and only gets in their way. No key is written for them either — nothing
  // reads it, and KV writes are the scarcest quota here.
  const broadcast = isAdmin || !(await c.env.STEAM_PROFILE_CACHE.get(broadcastCooldownKey(myId)));
  if (broadcast) {
    if (!isAdmin) {
      await c.env.STEAM_PROFILE_CACHE.put(broadcastCooldownKey(myId), '1', { expirationTtl: BROADCAST_COOLDOWN_SECONDS });
    }
    // Queued rather than sent inline so the response does not wait on RCON, and so
    // concurrent claims serialise behind the consumer's max_concurrency of 1.
    c.executionCtx.waitUntil(
      c.env.RCON_BROADCAST_QUEUE.send({ requesterId: myId, targetId } satisfies ClaimBroadcastMessage),
    );
  }

  await logSwap(c, {
    action: 'claim', actorId: myId, partnerId: targetId,
    changedSteamId: null, broadcast, success: true,
  });
  return c.json({ status: 'pending', message: '等待对方确认，请对方在5分钟内发出请求' });
});

// DELETE /api/team-swap — cancel own pending request
teamSwap.delete('/', requireAuth, async c => {
  const myId = c.get('steamid');
  // Read before deleting so the cancel names who was left waiting, which is what makes
  // a claim/cancel loop visible in the stream. Costs one extra KV read on a rare route.
  const partnerId = await c.env.STEAM_PROFILE_CACHE.get(`ts:req:${myId}`);
  await c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`);
  await logSwap(c, {
    action: 'cancel', actorId: myId, partnerId,
    changedSteamId: null, success: true,
  });
  return c.body(null, 204);
});

export default teamSwap;
