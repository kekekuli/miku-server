import { Hono } from 'hono';
import { getSteamProfiles, getGameStatusNow, getGameStatusQueued } from '../lib/steam';
import { getFilterConditions, getAdminPermissions } from '../lib/strapi';
import { getRoster } from '../lib/roster';
import { evaluate } from '../lib/evaluate';
import type { EvalContext } from '../lib/evaluate';
import type { EligibilityRequest, AdminMe, SessionResponse } from '../../shared/types';
import { parseCookie, verifyJWT } from '../lib/jwt';
import type { Variables } from '../types';
import votesRoute from './votes';
import teamSwapRoute from './teamswap';


const api = new Hono<{ Bindings: Env; Variables: Variables }>();

const ANONYMOUS: SessionResponse = { profile: null, admin: null };

// Deliberately not behind requireAuth: an anonymous caller is answered with a 200 and
// a null profile rather than a 401. Admin permissions ride along here too, so the UI
// learns who the caller is and what they may do in a single request.
api.get('/me', async c => {
  const token = parseCookie(c.req.header('Cookie') ?? '')['token'];
  const payload = token ? await verifyJWT(token, c.env.JWT_SECRET) : null;
  if (!payload) return c.json(ANONYMOUS);

  const steamid = payload.steamid;
  // Steam and Strapi are independent, so the round trips overlap.
  const [[profile], permissions] = await Promise.all([
    getSteamProfiles([steamid], c.env),
    getAdminPermissions(steamid, c.env),
  ]);
  if (!profile) return c.json(ANONYMOUS);

  if (!profile.squad44Status) {
    const statuses = await getGameStatusNow([steamid], c.env);
    profile.squad44Status = statuses[steamid];
  }

  const admin: AdminMe | null =
    permissions && Object.keys(permissions).length > 0 ? { permissions } : null;

  return c.json({ profile, admin });
});

api.get('/game-status/:steamId', async c => {
  const { steamId } = c.req.param();
  const [profile] = await getSteamProfiles([steamId], c.env);
  if (!profile) return c.json(null, 404);
  const statuses = await getGameStatusNow([steamId], c.env);
  return c.json(statuses[steamId] ?? null);
});

// Served entirely from D1 — never triggers an RCON call, so the load on the game
// server stays flat at one ListPlayers per minute regardless of traffic.
api.get('/roster', async c => {
  const roster = await getRoster(c.env);
  if (!roster) return c.json(null, 404);
  return c.json(roster);
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
