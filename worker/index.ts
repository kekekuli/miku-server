import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { count, desc, eq } from 'drizzle-orm';
import auth from './routes/auth';
import api from './routes/api';
import admin from './routes/admin';
import { executeGameStatusRefresh, getGameStatusQueued } from './lib/steam';
import { candidates, votes } from '../db/schema';

const app = new Hono<{ Bindings: Env }>();

app.route('/auth', auth);
app.route('/api', api);
app.route('/admin', admin);

app.all('*', c => {
  const { pathname } = new URL(c.req.url);
  const target = pathname.includes('.') ? c.req.raw : new Request(new URL('/', c.req.url), c.req.raw);
  return c.env.ASSETS.fetch(target);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const db = drizzle(env.DB);
    const rows = await db
      .select({ steamId: candidates.steamId, voteCount: count(votes.voterId) })
      .from(candidates)
      .leftJoin(votes, eq(votes.candidateId, candidates.steamId))
      .groupBy(candidates.steamId)
      .orderBy(desc(count(votes.voterId)))
      .limit(20);
    await getGameStatusQueued(rows.map(r => r.steamId), env);
  },
  async queue(batch: MessageBatch<{ steamId: string }>, env: Env): Promise<void> {
    const steamIds = [...new Set(batch.messages.map(m => m.body.steamId))];
    await executeGameStatusRefresh(steamIds, env);
    batch.ackAll();
  },
};
