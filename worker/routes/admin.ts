import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import { accounts, accountSessions, candidates, votes } from '../../db/schema';
import { hashPassword, parseCookie, resolveAuthToken, validatePassword } from '../lib/accountAuth';
import {
  getAdminPermissions,
  getGameMapById,
  getGameServerById,
  getRconCommandPresetById,
  listGameMapsPage,
  listRconCommandPresets,
  listRconGameServers,
} from '../lib/strapi';
import { sendRconCommand } from '../lib/rcon';
import type { AdminVariables } from '../types';

type AdminEnv = { Bindings: Env; Variables: AdminVariables };

interface PresetCommandBody {
  presetId?: string;
  gameServerId?: string;
  mapId?: string;
  attempt?: number;
}

const requireAdmin = createMiddleware<AdminEnv>(async (c, next) => {
  const token = parseCookie(c.req.header('Cookie') ?? '')['token'];
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = await resolveAuthToken(token, c.env);
  if (!session?.steamId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const permissions = await getAdminPermissions(session.steamId, c.env);
  if (!permissions) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  c.set('steamid', session.steamId);
  c.set('adminPermissions', permissions);
  await next();
});

const requirePermission = (perm: string) =>
  createMiddleware<AdminEnv>(async (c, next) => {
    if (!(perm in c.get('adminPermissions'))) return c.json({ error: 'Forbidden' }, 403);
    await next();
  });

const requireAnyPermission = (...permissions: string[]) =>
  createMiddleware<AdminEnv>(async (c, next) => {
    const granted = c.get('adminPermissions');
    if (!permissions.some(permission => permission in granted)) return c.json({ error: 'Forbidden' }, 403);
    await next();
  });

const admin = new Hono<AdminEnv>();

admin.use('*', requireAdmin);

// Admin permissions are reported by GET /api/me, together with the profile.

admin.get('/game-servers', requireAnyPermission('canRcon', 'canRunPresetCommands'), async c => {
  const servers = await listRconGameServers(c.env);
  return c.json(servers);
});

admin.get('/preset-commands/presets', requirePermission('canRunPresetCommands'), async c => {
  const presets = await listRconCommandPresets(c.env);
  return c.json(presets.map(preset => ({
      id: preset.documentId,
      displayName: preset.displayName,
      argumentType: preset.argumentType,
      supportsTrailingComma: preset.supportsTrailingComma,
      confirmationRequired: preset.confirmationRequired,
  })));
});

admin.get('/preset-commands/maps', requirePermission('canRunPresetCommands'), async c => {
  const page = Number(c.req.query('page') ?? 1);
  const pageSize = Number(c.req.query('pageSize') ?? 20);
  const search = (c.req.query('search') ?? '').trim().slice(0, 100);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    return c.json({ error: '分页参数无效' }, 400);
  }
  const result = await listGameMapsPage(c.env, { page, pageSize, search });
  return c.json({
    ...result,
    items: result.items.map(map => ({ id: map.documentId, displayName: map.displayName, rconName: map.rconName })),
  });
});

admin.post('/preset-commands', requirePermission('canRunPresetCommands'), async c => {
  const body = await c.req.json<PresetCommandBody>().catch((): PresetCommandBody => ({}));
  if (!body.presetId || !body.gameServerId) return c.json({ error: '请选择预设命令和游戏服务器' }, 400);
  const attempt = body.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 1000) {
    return c.json({ error: '执行次数无效' }, 400);
  }

  const [preset, gameServer] = await Promise.all([
    getRconCommandPresetById(body.presetId, c.env),
    getGameServerById(body.gameServerId, c.env),
  ]);
  if (!preset) return c.json({ error: '预设命令不存在或未启用' }, 404);
  if (!gameServer?.rconHost || !gameServer.rconPort || !gameServer.rconPassword) {
    return c.json({ error: '该服务器未配置 RCON' }, 503);
  }
  if (!/^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9_-]+)*$/.test(preset.baseCommand)) {
    return c.json({ error: '预设命令格式无效，请在 Strapi 中修正' }, 422);
  }

  let map: Awaited<ReturnType<typeof getGameMapById>> = null;
  if (preset.argumentType === 'map') {
    if (!body.mapId) return c.json({ error: '请选择地图' }, 400);
    map = await getGameMapById(body.mapId, c.env);
    if (!map) return c.json({ error: '地图不存在或未启用' }, 404);
    if (!/^[A-Za-z0-9_-]+$/.test(map.rconName)) {
      return c.json({ error: '地图 RCON 名称格式无效，请在 Strapi 中修正' }, 422);
    }
  } else if (body.mapId) {
    return c.json({ error: '该预设命令不接受地图参数' }, 400);
  }

  const trailingComma = preset.supportsTrailingComma && attempt % 2 === 0;
  const command = `${preset.baseCommand}${map ? ` ${map.rconName}` : ''}${trailingComma ? ',' : ''}`;
  const event = {
    action: 'preset_command_executed',
    steamid: c.get('steamid'),
    gameServerId: body.gameServerId,
    presetId: preset.documentId,
    presetName: preset.displayName,
    mapId: map?.documentId ?? null,
    mapName: map?.rconName ?? null,
    attempt,
    trailingComma,
    command,
  };
  try {
    const output = await sendRconCommand(
      gameServer.rconHost,
      gameServer.rconPort,
      gameServer.rconPassword,
      command,
    );
    c.var.logEvent('admin_actions', { ...event, success: true });
    return c.json({ output, command, trailingComma });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RCON command failed';
    c.var.logEvent('admin_actions', { ...event, success: false, error: message });
    return c.json({ error: message }, 500);
  }
});

admin.post('/rcon', requirePermission('canRcon'), async c => {
  const { command, gameServerId }: { command?: string; gameServerId?: string } = await c.req.json();
  if (!gameServerId) return c.json({ error: 'gameServerId is required' }, 400);

  const gameServer = await getGameServerById(gameServerId, c.env);
  if (!gameServer || !gameServer.rconHost || !gameServer.rconPort || !gameServer.rconPassword) {
    return c.json({ error: 'RCON is not configured for this server' }, 503);
  }

  if (!command?.trim()) return c.json({ error: 'Command is required' }, 400);
  if (command.length > 512) return c.json({ error: 'Command too long (max 512 chars)' }, 400);

  try {
    const output = await sendRconCommand(
      gameServer.rconHost,
      gameServer.rconPort,
      gameServer.rconPassword,
      command.trim(),
    );
    c.var.logEvent('admin_actions', { action: 'rcon_command', steamid: c.get('steamid'), command: command.trim(), gameServerId, success: true });
    return c.json({ output });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'RCON command failed';
    c.var.logEvent('admin_actions', { action: 'rcon_command', steamid: c.get('steamid'), command: command.trim(), gameServerId, success: false, error: message });
    return c.json({ error: message }, 500);
  }
});

admin.delete('/votes/reset', requirePermission('canManageVotes'), async c => {
  const db = drizzle(c.env.DB);
  await db.delete(votes);
  c.var.logEvent('admin_actions', { action: 'votes_reset', steamid: c.get('steamid') });
  return c.body(null, 204);
});

admin.delete('/candidates/:steamId', requirePermission('canManageCandidates'), async c => {
  const steamId = c.req.param('steamId');
  const db = drizzle(c.env.DB);
  await db.delete(votes).where(eq(votes.candidateId, steamId));
  await db.delete(candidates).where(eq(candidates.steamId, steamId));
  c.var.logEvent('admin_actions', { action: 'candidate_delete', steamid: c.get('steamid'), targetSteamId: steamId });
  return c.body(null, 204);
});

admin.get('/accounts', requirePermission('canManageAccounts'), async c => {
  const rows = await drizzle(c.env.DB)
    .select({
      id: accounts.id,
      username: accounts.username,
      steamId: accounts.steamId,
      createdAt: accounts.createdAt,
      lastLoginAt: accounts.lastLoginAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
    .limit(200);
  return c.json(rows);
});

admin.put('/accounts/:accountId/password', requirePermission('canManageAccounts'), async c => {
  const accountId = c.req.param('accountId');
  const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}));
  const password = body.password ?? '';
  const passwordError = validatePassword(password);
  if (passwordError) return c.json({ error: passwordError }, 400);

  const db = drizzle(c.env.DB);
  const [target] = await db.select({ id: accounts.id, username: accounts.username, steamId: accounts.steamId })
    .from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!target) return c.json({ error: '账户不存在' }, 404);

  const passwordRecord = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.update(accounts).set({
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt,
      passwordHashVersion: passwordRecord.version,
      updatedAt: now,
    }).where(eq(accounts.id, accountId)),
    db.update(accountSessions).set({ revokedAt: now }).where(eq(accountSessions.accountId, accountId)),
  ]);
  c.var.logEvent('account_activities', {
    action: 'identity_password_reset_by_admin',
    actorSteamId: c.get('steamid'),
    targetAccountId: target.id,
    targetUsername: target.username,
    targetSteamId: target.steamId,
  });
  return c.body(null, 204);
});

admin.delete('/accounts/:accountId', requirePermission('canManageAccounts'), async c => {
  const accountId = c.req.param('accountId');
  const db = drizzle(c.env.DB);
  const [target] = await db.select({ id: accounts.id, username: accounts.username, steamId: accounts.steamId })
    .from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!target) return c.json({ error: '账户不存在' }, 404);

  await db.batch([
    db.delete(accountSessions).where(eq(accountSessions.accountId, accountId)),
    db.delete(accounts).where(eq(accounts.id, accountId)),
  ]);
  c.var.logEvent('account_activities', {
    action: 'identity_deleted_by_admin',
    actorSteamId: c.get('steamid'),
    targetAccountId: target.id,
    targetUsername: target.username,
    targetSteamId: target.steamId,
  });
  return c.body(null, 204);
});

export default admin;
