import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { candidates } from '../../db/schema';
import { getLazySteamProfiles } from '../lib/steam';
import { requireAuth } from './auth';
import type { Variables } from '../types';
import votesRoute from './votes';

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.get('/me', requireAuth, async c => {
  const [lazy] = await getLazySteamProfiles([c.get('steamid')], c.env);
  if (!lazy.profile.squad44Status) {
    const gameStatus = await lazy.refreshSync();
    if (gameStatus) lazy.profile.squad44Status = gameStatus;
  }
  return c.json(lazy?.profile);
});

api.get('/game-status/:steamId', async c => {
  const { steamId } = c.req.param();
  const [lazy] = await getLazySteamProfiles([steamId], c.env);
  if (!lazy) return c.json(null, 404);
  const gameStatus = await lazy.refreshSync();
  return c.json(gameStatus);
});

api.route('/votes', votesRoute);

api.post('/candidates', requireAuth, async c => {
  const steamid = c.get('steamid');
  const body = await c.req.json<{ steamId?: string }>().catch((): { steamId?: string } => ({}));
  const targetId = body.steamId ?? steamid;

  const [lazy] = await getLazySteamProfiles([targetId], c.env);
  const profile = lazy?.profile;
  if (!profile) return c.text('Steam profile not found', 404);

  const db = drizzle(c.env.DB);
  const existing = await db.select().from(candidates).where(eq(candidates.steamId, profile.steamId)).get();

  if (existing) return c.text('重复的候选人', 409);
  await db.insert(candidates).values({ steamId: profile.steamId, nominatedBy: steamid });
  return c.json({ steamId: profile.steamId, name: profile.name, avatar: profile.avatar }, 201);
});

export default api;
