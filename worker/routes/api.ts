import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { candidates } from '../../db/schema';
import { getSteamProfile } from '../lib/steam';
import { requireAuth } from './auth';
import type { Variables } from '../types';
import votesRoute from './votes';

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.get('/me', requireAuth, async c => {
  const profile = await getSteamProfile(c.get('steamid'), c.env);
  return c.json(profile);
});

api.route('/votes', votesRoute);

api.post('/candidates', requireAuth, async c => {
  const steamid = c.get('steamid');
  const body = await c.req.json<{ steamId?: string }>().catch((): { steamId?: string } => ({}));
  const targetId = body.steamId ?? steamid;

  const profile = await getSteamProfile(targetId, c.env);
  const db = drizzle(c.env.DB);

  await db.insert(candidates)
    .values({ steamId: profile.steamId, name: profile.name, avatar: profile.avatar })
    .onConflictDoNothing();

  return c.json({ steamId: profile.steamId, name: profile.name, avatar: profile.avatar }, 201);
});

export default api;
