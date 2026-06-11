import { Hono } from 'hono';
import { getSteamProfiles, getGameStatusNow, getGameStatusQueued } from '../lib/steam';
import { getFilterConditions } from '../lib/strapi';
import { evaluate } from '../lib/evaluate';
import type { EvalContext } from '../lib/evaluate';
import type { EligibilityRequest } from '../../shared/types';
import { requireAuth } from './auth';
import type { Variables } from '../types';
import votesRoute from './votes';
import teamSwapRoute from './teamswap';


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

  const results = await Promise.all(body.map(async ({ steamId, conditionKeys }) => {
    const status = statusMap[steamId];
    // getGameStatusQueued is a batch call
    // so we need make EvalContext inline to avoid open to many network request in parallel
    const context: EvalContext = {
      playtime_forever: () => Promise.resolve(status?.playtime_forever),
      playtime_2weeks: () => Promise.resolve(status?.playtime_2weeks),
    };
    const conditions = conditionKeys.flatMap(k => { const cond = conditionMap.get(k); return cond ? [cond] : []; });
    return { steamId, conditions: await evaluate(conditions, context), noGameStatus: !status };
  }));

  return c.json(results);
});

api.route('/votes', votesRoute);
api.route('/team-swap', teamSwapRoute);

export default api;
