import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { candidates, votes } from '../../db/schema';
import { parseCookie, verifyJWT } from '../lib/jwt';
import { getAdminPermissions, listRconGameServers, getGameServerById } from '../lib/strapi';
import { sendRconCommand } from '../lib/rcon';
import type { AdminVariables } from '../types';

type AdminEnv = { Bindings: Env; Variables: AdminVariables };

const requireAdmin = createMiddleware<AdminEnv>(async (c, next) => {
  const token = parseCookie(c.req.header('Cookie') ?? '')['token'];
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const permissions = await getAdminPermissions(payload.steamid, c.env);
  if (!permissions) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  c.set('steamid', payload.steamid);
  c.set('adminPermissions', permissions);
  await next();
});

const requirePermission = (perm: string) =>
  createMiddleware<AdminEnv>(async (c, next) => {
    if (!(perm in c.get('adminPermissions'))) return c.json({ error: 'Forbidden' }, 403);
    await next();
  });

const admin = new Hono<AdminEnv>();

admin.use('*', requireAdmin);

admin.get('/me', async c => {
  const features: Record<string, true> = {};
  const servers = await listRconGameServers(c.env);
  if (servers.length > 0) features.rcon = true;
  if (c.env.OPENOBSERVE_URL && c.env.OPENOBSERVE_TOKEN) features.openobserve = true;
  return c.json({ permissions: c.get('adminPermissions'), features });
});

admin.get('/game-servers', requirePermission('canRcon'), async c => {
  const servers = await listRconGameServers(c.env);
  return c.json(servers);
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

export default admin;
