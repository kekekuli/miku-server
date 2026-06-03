import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { candidates } from '../../db/schema';
import { getSteamProfiles, getGameStatusNow, getGameStatusQueued } from '../lib/steam';
import { getFilterConditions } from '../lib/strapi';
import { evaluate } from '../lib/evaluate';
import type { EvalContext } from '../lib/evaluate';
import type { EligibilityRequest } from '../../shared/types';
import { requireAuth } from './auth';
import type { Variables } from '../types';
import votesRoute from './votes';

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.get('/me', requireAuth, async c => {
  const steamid = c.get('steamid');
  const [profile] = await getSteamProfiles([steamid], c.env);
  if (!profile) return c.json(null, 404);
  if (!profile.squad44Status) {
    const statuses = await getGameStatusNow([steamid], c.env);
    profile.squad44Status = statuses[steamid];
  }
  return c.json(profile);
});

api.get('/game-status/:steamId', async c => {
  const { steamId } = c.req.param();
  const [profile] = await getSteamProfiles([steamId], c.env);
  if (!profile) return c.json(null, 404);
  const statuses = await getGameStatusNow([steamId], c.env);
  return c.json(statuses[steamId] ?? null);
});

api.get('/filter-conditions', async c => {
  const conditions = await getFilterConditions(c.env);
  return c.json(conditions.map(({ key, label }) => ({ key, label })));
});

api.post('/eligibility', async c => {
  const body = await c.req.json<EligibilityRequest>().catch((): EligibilityRequest => []);
  if (!body.length) return c.json([]);

  const steamIds = [...new Set(body.map(r => r.steamId))];

  const [allConditions, statusMap] = await Promise.all([
    getFilterConditions(c.env),
    getGameStatusQueued(steamIds, c.env),
  ]);
  const conditionMap = new Map(allConditions.map(c => [c.key, c]));

  const results = body.map(({ steamId, conditionKeys }) => {
    const status = statusMap[steamId];
    const context: EvalContext = {
      playtime_forever: status?.playtime_forever,
      playtime_2weeks: status?.playtime_2weeks,
    };
    const conditions = conditionKeys.flatMap(k => { const c = conditionMap.get(k); return c ? [c] : []; });
    return { steamId, conditions: evaluate(conditions, context), noGameStatus: !status };
  });

  return c.json(results);
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
