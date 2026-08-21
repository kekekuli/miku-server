import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { count, desc, eq } from 'drizzle-orm';
import auth from './routes/auth';
import api from './routes/api';
import admin from './routes/admin';
import files from './routes/files';
import { executeGameStatusRefresh, getGameStatusQueued } from './lib/steam';
import { pollRoster, ROSTER_CRON } from './lib/roster';
import { handleClaimBroadcasts, RCON_BROADCAST_QUEUE, type ClaimBroadcastMessage } from './lib/broadcast';
import { candidates, votes } from '../db/schema';
import { openobserve } from './lib/openobserve';
import { requireSameOrigin } from './lib/csrf';
import type { Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', openobserve);
app.use('*', requireSameOrigin);
app.route('/auth', auth);
app.route('/api', api);
app.route('/admin', admin);
app.route('/files', files);

app.all('*', c => {
  const { pathname } = new URL(c.req.url);
  const target = pathname.includes('.') ? c.req.raw : new Request(new URL('/', c.req.url), c.req.raw);
  return c.env.ASSETS.fetch(target);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === ROSTER_CRON) return pollRoster(env);

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
  // Two queues share this handler, so dispatch on batch.queue before touching bodies —
  // the message shapes are unrelated.
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue === RCON_BROADCAST_QUEUE) {
      const messages = (batch as MessageBatch<ClaimBroadcastMessage>).messages.map(m => m.body);
      await handleClaimBroadcasts(messages, env);
      batch.ackAll();
      return;
    }

    const steamIds = [...new Set((batch as MessageBatch<{ steamId: string }>).messages.map(m => m.body.steamId))];
    await executeGameStatusRefresh(steamIds, env);
    batch.ackAll();
  },
};
