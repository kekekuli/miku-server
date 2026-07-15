import { Hono } from 'hono';
import { requireAuth } from './auth';
import { sendRconCommand } from '../lib/rcon';
import { getGameStatusNow, getSteamProfiles } from '../lib/steam';
import { getActiveGameServer, type GameServer } from '../lib/strapi';
import type { Variables } from '../types';

const LOW_HOURS_THRESHOLD_MINUTES = 200 * 60;
const PENDING_TTL_SECONDS = 5 * 60;
const DAILY_TTL_SECONDS = 25 * 60 * 60;

const teamSwap = new Hono<{ Bindings: Env; Variables: Variables }>();

function todayCST(): string {
  const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + CST_OFFSET_MS).toISOString().slice(0, 10);
}

async function broadcastAndForceTeamChange(env: Env, gameServer: GameServer, changedId: string): Promise<void> {
  const [profile] = await getSteamProfiles([changedId], env);
  const name = profile?.name ?? changedId;
  // Broadcast failure is non-fatal
  await sendRconCommand(gameServer.rconHost, gameServer.rconPort, gameServer.rconPassword, `AdminBroadcast [自助跳边] 正在切换${name}的队伍`);
  const result = await sendRconCommand(gameServer.rconHost, gameServer.rconPort, gameServer.rconPassword, `AdminForceTeamChange ${changedId}`);
  if (result.trimStart().startsWith('ERROR')) throw new Error(result.trim());
}

// GET /api/team-swap — all pending requests (global) + current user's daily status
teamSwap.get('/', requireAuth, async c => {
  const myId = c.get('steamid');
  const today = todayCST();

  const [usedToday, listResult] = await Promise.all([
    c.env.STEAM_PROFILE_CACHE.get(`ts:daily:${myId}:${today}`),
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

  return c.json({ usedToday: !!usedToday, myPending, requests });
});

// POST /api/team-swap
// Body: { targetSteamId: string }
//
// All paths require mutual matching first.
// After match: check hours (low-hours → immediate, no daily limit), then check daily limits.
teamSwap.post('/', requireAuth, async c => {
  const myId = c.get('steamid');

  const body = await c.req.json<{ targetSteamId?: string }>().catch((): { targetSteamId?: string } => ({}));
  const targetId = body.targetSteamId?.trim();

  if (!targetId) return c.json({ error: 'targetSteamId is required' }, 400);
  if (targetId === myId) return c.json({ error: 'Cannot request with yourself' }, 400);

  const gameServer = await getActiveGameServer(c.env);
  if (!gameServer) {
    return c.json({ error: 'RCON is not configured' }, 503);
  }

  // Value stored is the intended targetId — null means no pending request
  const storedTargetId = await c.env.STEAM_PROFILE_CACHE.get(`ts:req:${targetId}`);

  if (storedTargetId !== null) {
    // Enforce that only the intended target can trigger the match
    if (storedTargetId !== myId) {
      return c.json({ error: '该请求不是发给你的' }, 403);
    }

    // Match found — check hours before daily limits
    const statusMap = await getGameStatusNow([myId, targetId], c.env);
    const myMinutes = statusMap[myId]?.playtime_forever ?? null;
    const targetMinutes = statusMap[targetId]?.playtime_forever ?? null;

    const myLow = myMinutes !== null && myMinutes < LOW_HOURS_THRESHOLD_MINUTES;
    const targetLow = targetMinutes !== null && targetMinutes < LOW_HOURS_THRESHOLD_MINUTES;

    if (myLow || targetLow) {
      // Low-hours path: skip daily limit, but still pick randomly
      const changedId = Math.random() < 0.5 ? myId : targetId;

      try {
        await broadcastAndForceTeamChange(c.env, gameServer, changedId);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : '换队失败' }, 500);
      }
      await Promise.all([
        c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${targetId}`),
        c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`),
      ]);
      return c.json({ status: 'changed', changedSteamId: changedId, reason: 'low_hours' });
    }

    // Both >= 200h — now check daily limits for both players
    const today = todayCST();
    const [myDailyUsed, targetDailyUsed] = await Promise.all([
      c.env.STEAM_PROFILE_CACHE.get(`ts:daily:${myId}:${today}`),
      c.env.STEAM_PROFILE_CACHE.get(`ts:daily:${targetId}:${today}`),
    ]);

    if (myDailyUsed) return c.json({ error: '你今日已使用换队请求' }, 429);
    if (targetDailyUsed) return c.json({ error: '对方今日已使用换队请求' }, 429);

    const changedId = Math.random() < 0.5 ? myId : targetId;
    try {
      await broadcastAndForceTeamChange(c.env, gameServer, changedId);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : '换队失败' }, 500);
    }

    await Promise.all([
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${targetId}`),
      c.env.STEAM_PROFILE_CACHE.delete(`ts:req:${myId}`),
      c.env.STEAM_PROFILE_CACHE.put(`ts:daily:${myId}:${today}`, '1', { expirationTtl: DAILY_TTL_SECONDS }),
      c.env.STEAM_PROFILE_CACHE.put(`ts:daily:${targetId}:${today}`, '1', { expirationTtl: DAILY_TTL_SECONDS }),
    ]);

    return c.json({ status: 'changed', changedSteamId: changedId, reason: 'matched' });
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
