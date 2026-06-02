import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { count, eq } from 'drizzle-orm';
import { candidates, votes } from '../../db/schema';
import { parseCookie, verifyJWT } from '../lib/jwt';
import { requireAuth } from './auth';
import { getSteamProfiles } from '../lib/steam';
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
  const [allCandidates, voteCounts, myVoteRow] = await Promise.all([
    db.select().from(candidates),
    db.select({ candidateId: votes.candidateId, count: count() }).from(votes).groupBy(votes.candidateId),
    myId ? db.select().from(votes).where(eq(votes.voterId, myId)).get() : Promise.resolve(null),
  ]);

  const steamIds = [...new Set(allCandidates.flatMap(c => [c.steamId, c.nominatedBy]))];
  const profiles = await getSteamProfiles(steamIds, c.env);
  const profileMap = Object.fromEntries(profiles.map(p => [p.steamId, p]));
  const countMap = Object.fromEntries(voteCounts.map(v => [v.candidateId, v.count]));

  const results = allCandidates.map(candidate => ({
    candidate: {
      ...candidate,
      profile: profileMap[candidate.steamId] ?? null,
      nominatorProfile: profileMap[candidate.nominatedBy] ?? null,
    },
    voteCount: countMap[candidate.steamId] ?? 0,
  }));

  results.sort((a, b) => b.voteCount - a.voteCount);
  return c.json({ results, myVote: myVoteRow?.candidateId ?? null });
});

votesRoute.get('/:candidateId/voters', async c => {
  const { candidateId } = c.req.param();
  const db = drizzle(c.env.DB);

  const candidate = await db.select().from(candidates).where(eq(candidates.steamId, candidateId)).get();
  if (!candidate) return c.text('Candidate not found', 404);

  const voterRows = await db.select({ voterId: votes.voterId }).from(votes).where(eq(votes.candidateId, candidateId));
  const voterIds = voterRows.map(r => r.voterId);
  if (voterIds.length === 0) return c.json([]);

  const profiles = await getSteamProfiles(voterIds, c.env);
  const profileMap = Object.fromEntries(profiles.map(p => [p.steamId, p]));

  return c.json(voterIds.map(steamId => {
    const p = profileMap[steamId];
    return p
      ? { steamId, name: p.name, avatar: p.avatar, profileUrl: p.profileUrl }
      : { steamId, name: steamId, avatar: '', profileUrl: `https://steamcommunity.com/profiles/${steamId}` };
  }));
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
