import { createMiddleware } from 'hono/factory';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cookie-authenticated mutations must come from this site's browser origin.
 * SameSite=Lax is retained as a second layer; this explicit check also protects if
 * cookie policy changes later. Non-browser API clients must send the expected Origin.
 */
export const requireSameOrigin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const expected = new URL(c.req.url).origin;
  if (c.req.header('Origin') !== expected) return c.json({ error: '请求来源无效，请刷新页面后重试' }, 403);
  await next();
});
