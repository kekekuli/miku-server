import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { candidates } from '../../db/schema';
import { getSteamProfiles, getGameStatusesNow } from '../lib/steam';
import { requireAuth } from './auth';
import type { Variables } from '../types';
import votesRoute from './votes';

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.get('/me', requireAuth, async c => {
  const steamid = c.get('steamid');
  const [profile] = await getSteamProfiles([steamid], c.env);
  if (!profile) return c.json(null, 404);
  if (!profile.squad44Status) {
    const statuses = await getGameStatusesNow([steamid], c.env);
    profile.squad44Status = statuses[steamid];
  }
  return c.json(profile);
});

api.get('/game-status/:steamId', async c => {
  const { steamId } = c.req.param();
  const [profile] = await getSteamProfiles([steamId], c.env);
  if (!profile) return c.json(null, 404);
  const statuses = await getGameStatusesNow([steamId], c.env);
  return c.json(statuses[steamId] ?? null);
});

api.route('/votes', votesRoute);

api.post('/candidates', requireAuth, async c => {
  const steamid = c.get('steamid');
  const body = await c.req.json<{ steamId?: string }>().catch((): { steamId?: string } => ({}));
  const targetId = body.steamId ?? steamid;

  const [profile] = await getSteamProfiles([targetId], c.env);
  if (!profile) return c.text('Steam profile not found', 404);

  const db = drizzle(c.env.DB);
  const existing = await db.select().from(candidates).where(eq(candidates.steamId, profile.steamId)).get();

  if (existing) return c.text('重复的候选人', 409);
  await db.insert(candidates).values({ steamId: profile.steamId, nominatedBy: steamid });
  return c.json({ steamId: profile.steamId, name: profile.name, avatar: profile.avatar }, 201);
});

export default api;
