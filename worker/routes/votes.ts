import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { count, eq, inArray } from 'drizzle-orm';
import { candidates, votes } from '../../db/schema';
import { parseCookie, verifyJWT } from '../lib/jwt';
import { requireAuth } from './auth';
import { getSteamProfile } from '../lib/steam';
import type { Variables } from '../types';
import type { GameStatus } from '../../shared/types';

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
  const candidateMap = Object.fromEntries(allCandidates.map(c => [c.steamId, c]));

  async function resolveVoterInfo(steamId: string) {
    const known = candidateMap[steamId];
    if (known) return { steamId, name: known.name, avatar: known.avatar, profileUrl: `https://steamcommunity.com/profiles/${steamId}` };
    try {
      const p = await getSteamProfile(steamId, c.env);
      return { steamId, name: p.name, avatar: p.avatar, profileUrl: p.profileUrl };
    } catch {
      return { steamId, name: steamId, avatar: '', profileUrl: `https://steamcommunity.com/profiles/${steamId}` };
    }
  }

  const results = await Promise.all(
    allCandidates.map(async candidate => {
      let profileUrl = `https://steamcommunity.com/profiles/${candidate.steamId}`;
      let squad44Status: GameStatus | null = null;
      try {
        const profile = await getSteamProfile(candidate.steamId, c.env);
        profileUrl = profile.profileUrl;
        squad44Status = profile.squad44Status;
      } catch { /* use defaults if profile fetch fails */ }
      const nominatedByProfile = await resolveVoterInfo(candidate.nominatedBy);
      return { candidate, voteCount: countMap[candidate.steamId] ?? 0, profileUrl, squad44Status, nominatedByProfile };
    })
  );

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

  // Resolve names/avatars from candidates table first, then fall back to Steam API
  const knownCandidates = await db.select().from(candidates).where(inArray(candidates.steamId, voterIds));
  const knownMap = Object.fromEntries(knownCandidates.map(c => [c.steamId, c]));

  const voters = await Promise.all(
    voterIds.map(async steamId => {
      const known = knownMap[steamId];
      if (known) {
        return {
          steamId,
          name: known.name,
          avatar: known.avatar,
          profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
        };
      }
      try {
        const profile = await getSteamProfile(steamId, c.env);
        return { steamId, name: profile.name, avatar: profile.avatar, profileUrl: profile.profileUrl };
      } catch {
        return { steamId, name: steamId, avatar: '', profileUrl: `https://steamcommunity.com/profiles/${steamId}` };
      }
    })
  );

  return c.json(voters);
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
