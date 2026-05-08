import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { count, eq } from 'drizzle-orm';
import { candidates, votes } from '../../db/schema';
import { parseCookie, verifyJWT } from '../lib/jwt';
import { requireAuth } from './auth';
import type { Variables } from '../types';

const votesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

votesRoute.get('/', async c => {
  let myId: string | null = null;
  const token = parseCookie(c.req.header('Cookie') ?? '')['token'];
  if (token) {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (payload) myId = payload.steamid;
  }

  const db = drizzle(c.env.DB);
  const allCandidates = await db.select().from(candidates);
  const voteCounts = await db
    .select({ candidateId: votes.candidateId, count: count() })
    .from(votes)
    .groupBy(votes.candidateId);

  const myVoteRow = myId
    ? await db.select().from(votes).where(eq(votes.voterId, myId)).get()
    : null;

  const countMap = Object.fromEntries(voteCounts.map(v => [v.candidateId, v.count]));
  const results = allCandidates
    .map(candidate => ({ candidate, voteCount: countMap[candidate.steamId] ?? 0 }))
    .sort((a, b) => b.voteCount - a.voteCount);

  return c.json({ results, myVote: myVoteRow?.candidateId ?? null });
});

votesRoute.post('/', requireAuth, async c => {
  const steamid = c.get('steamid');
  const { candidateId } = await c.req.json<{ candidateId: string }>();

  if (steamid === candidateId) return c.text('Cannot vote for yourself', 400);

  const db = drizzle(c.env.DB);
  const candidate = await db.select().from(candidates).where(eq(candidates.steamId, candidateId)).get();
  if (!candidate) return c.text('Candidate not found', 404);

  await db.insert(votes)
    .values({ voterId: steamid, candidateId })
    .onConflictDoUpdate({ target: votes.voterId, set: { candidateId } });

  return c.body(null, 204);
});

votesRoute.delete('/', requireAuth, async c => {
  const db = drizzle(c.env.DB);
  await db.delete(votes).where(eq(votes.voterId, c.get('steamid')));
  return c.body(null, 204);
});

export default votesRoute;
