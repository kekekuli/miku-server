import { createMiddleware } from 'hono/factory';
import type { LogEvent } from '../types';

export const openobserve = createMiddleware<{
  Bindings: Env;
  Variables: { logEvent: LogEvent };
}>(async (c, next) => {
  c.set('logEvent', (stream, fields) => {
    if (!c.env.OPENOBSERVE_URL || !c.env.OPENOBSERVE_TOKEN) return;

    c.executionCtx.waitUntil(
      fetch(`${c.env.OPENOBSERVE_URL}/api/default/${stream}/_json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${c.env.OPENOBSERVE_TOKEN}`,
        },
        body: JSON.stringify([{ _timestamp: Date.now() * 1000, ...fields }]),
      }),
    );
  });

  await next();
});
