import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { accounts, accountSessions, authStates } from '../../db/schema';
import {
  createSession,
  findAccountBySteamId,
  hashPassword,
  normalizeUsername,
  parseCookie,
  resolveAuthToken,
  revokeSession,
  validatePassword,
  validateUsername,
  verifyPassword,
} from '../lib/accountAuth';
import { getSteamProfiles } from '../lib/steam';
import type { Variables } from '../types';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const AUTH_STATE_TTL_SECONDS = 10 * 60;
const LOGIN_FAILURE_TTL_SECONDS = 15 * 60;
const MAX_LOGIN_FAILURES = 8;
const ACCOUNT_STREAM = 'account_activities';

const cookieAttrs = (url: URL, remembered = false) =>
  `Path=/; SameSite=Lax; HttpOnly${url.protocol === 'https:' ? '; Secure' : ''}${remembered ? '; Max-Age=2592000' : ''}`;

const clearCookie = (url: URL) => `token=; Max-Age=0; ${cookieAttrs(url)}`;

function tokenFromRequest(request: Request): string | undefined {
  return parseCookie(request.headers.get('Cookie') ?? '')['token'];
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return !!origin && origin === new URL(request.url).origin;
}

async function loginFailureKey(request: Request, usernameNormalized: string): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}\u0000${usernameNormalized}`));
  return `auth:fail:${new Uint8Array(digest).toHex()}`;
}

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const session = await resolveAuthToken(tokenFromRequest(c.req.raw), c.env);
  if (!session?.steamId) return c.text('请先登录 Steam', 401);
  c.set('steamid', session.steamId);
  await next();
});

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

auth.get('/steam', async c => {
  const url = new URL(c.req.url);
  const origin = url.origin;
  const requestedIntent = c.req.query('intent');
  const intent = requestedIntent === 'signup' || requestedIntent === 'link' ? requestedIntent : 'login';
  const current = intent === 'link' ? await resolveAuthToken(tokenFromRequest(c.req.raw), c.env) : null;
  if (intent === 'link' && !current?.accountId) return c.json({ error: '请先使用用户名登录' }, 401);
  const remembered = c.req.query('remember') === 'true';
  const state = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const db = drizzle(c.env.DB);
  await db.delete(authStates).where(lte(authStates.expiresAt, now));
  await db.insert(authStates).values({
    id: state,
    intent,
    accountId: current?.accountId ?? null,
    remembered,
    createdAt: now,
    expiresAt: now + AUTH_STATE_TTL_SECONDS,
  });
  const callback = new URL('/auth/steam/callback', origin);
  callback.searchParams.set('state', state);
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': callback.toString(),
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return c.redirect(`${STEAM_OPENID_URL}?${params.toString()}`, 302);
});

auth.get('/steam/callback', async c => {
  const url = new URL(c.req.url);
  const origin = url.origin;
  const stateId = c.req.query('state');
  if (!stateId) return c.redirect(`${origin}/?authError=steam`, 302);

  const now = Math.floor(Date.now() / 1000);
  const db = drizzle(c.env.DB);
  const [state] = await db.select().from(authStates)
    .where(and(eq(authStates.id, stateId), gt(authStates.expiresAt, now))).limit(1);
  if (!state) return c.redirect(`${origin}/?authError=expired`, 302);
  await db.delete(authStates).where(eq(authStates.id, stateId));

  const isValid = await verifySteam(url);
  if (!isValid) return c.redirect(`${origin}/?authError=steam`, 302);
  const claimedId = c.req.query('openid.claimed_id') ?? '';
  const steamId = claimedId.match(/\/(\d+)$/)?.[1];
  if (!steamId) return c.redirect(`${origin}/?authError=steam`, 302);

  try {
    const [profile] = await getSteamProfiles([steamId], c.env, { skipGameStatus: true });
    if (!profile) throw new Error('Steam profile not found');
    if (state.intent === 'link') {
      if (!state.accountId) throw new Error('Missing account link state');
      const existing = await findAccountBySteamId(steamId, c.env);
      if (existing && existing.id !== state.accountId) throw new Error('Steam account is already linked');
      const [targetAccount] = await db.select().from(accounts).where(eq(accounts.id, state.accountId)).limit(1);
      if (!targetAccount || targetAccount.steamId) throw new Error('Identity already has a Steam account');
      await db.batch([
        db.update(accounts).set({ steamId, updatedAt: now }).where(eq(accounts.id, state.accountId)),
        db.update(accountSessions).set({ revokedAt: now })
          .where(and(eq(accountSessions.accountId, state.accountId), isNull(accountSessions.revokedAt))),
      ]);
      const session = await createSession(c.env, { accountId: state.accountId, steamId }, 'steam', state.remembered);
      c.var.logEvent(ACCOUNT_STREAM, { action: 'steam_linked', steamId, accountId: state.accountId });
      return new Response(null, {
        status: 302,
        headers: { Location: origin, 'Set-Cookie': `token=${session.token}; ${cookieAttrs(url, state.remembered)}` },
      });
    }
    const account = await findAccountBySteamId(steamId, c.env);
    const session = await createSession(c.env, { accountId: account?.id ?? null, steamId }, 'steam', state.remembered);
    c.var.logEvent(ACCOUNT_STREAM, {
      action: 'steam_login_succeeded', steamId, accountId: account?.id ?? null,
      remembered: state.remembered, intent: state.intent,
    });
    const location = state.intent === 'signup' && !account ? `${origin}/signup` : origin;
    return new Response(null, {
      status: 302,
      headers: { Location: location, 'Set-Cookie': `token=${session.token}; ${cookieAttrs(url, state.remembered)}` },
    });
  } catch (error) {
    c.var.logEvent(ACCOUNT_STREAM, {
      action: 'steam_login_failed', steamId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return c.redirect(`${origin}/?authError=steam`, 302);
  }
});

auth.post('/identity/login', async c => {
  if (!isSameOrigin(c.req.raw)) return c.json({ error: '请求来源无效，请刷新页面后重试' }, 403);
  const body = await c.req.json<{ username?: string; password?: string; remember?: boolean }>()
    .catch((): { username?: string; password?: string; remember?: boolean } => ({}));
  const normalized = normalizeUsername(body.username ?? '');
  const password = body.password ?? '';
  const failureKey = await loginFailureKey(c.req.raw, normalized);
  const failures = Number(await c.env.STEAM_PROFILE_CACHE.get(failureKey) ?? 0);
  if (failures >= MAX_LOGIN_FAILURES) {
    c.var.logEvent(ACCOUNT_STREAM, { action: 'identity_login_rate_limited', usernameNormalized: normalized });
    return c.json({ error: '登录尝试次数过多，请稍后再试' }, 429);
  }
  const db = drizzle(c.env.DB);
  const [account] = await db.select().from(accounts).where(eq(accounts.usernameNormalized, normalized)).limit(1);
  const valid = account
    ? await verifyPassword(password, account.passwordHash, account.passwordSalt, account.passwordHashVersion)
    : await verifyPassword(password, 'invalid', 'AAAAAAAAAAAAAAAAAAAAAA', 1);
  if (!account || !valid) {
    await c.env.STEAM_PROFILE_CACHE.put(failureKey, String(failures + 1), { expirationTtl: LOGIN_FAILURE_TTL_SECONDS });
    c.var.logEvent(ACCOUNT_STREAM, { action: 'identity_login_failed', usernameNormalized: normalized });
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const remembered = body.remember === true;
  await c.env.STEAM_PROFILE_CACHE.delete(failureKey);
  const session = await createSession(c.env, { accountId: account.id, steamId: account.steamId }, 'identity', remembered);
  await db.update(accounts).set({ lastLoginAt: Math.floor(Date.now() / 1000) }).where(eq(accounts.id, account.id));
  c.var.logEvent(ACCOUNT_STREAM, {
    action: 'identity_login_succeeded', accountId: account.id, steamId: account.steamId, remembered,
  });
  return c.json({ ok: true }, 200, {
    'Set-Cookie': `token=${session.token}; ${cookieAttrs(new URL(c.req.url), remembered)}`,
  });
});

auth.post('/identity', async c => {
  if (!isSameOrigin(c.req.raw)) return c.json({ error: '请求来源无效，请刷新页面后重试' }, 403);
  const current = await resolveAuthToken(tokenFromRequest(c.req.raw), c.env);
  if (!current?.steamId) return c.json({ error: '请先完成 Steam 验证' }, 401);
  if (current.accountId || await findAccountBySteamId(current.steamId, c.env)) {
    return c.json({ error: '该 Steam 账号已绑定用户名' }, 409);
  }

  const body = await c.req.json<{ username?: string; password?: string }>()
    .catch((): { username?: string; password?: string } => ({}));
  const username = body.username?.trim() ?? '';
  const password = body.password ?? '';
  const usernameError = validateUsername(username);
  if (usernameError) return c.json({ error: usernameError }, 400);
  const passwordError = validatePassword(password);
  if (passwordError) return c.json({ error: passwordError }, 400);

  let passwordRecord: Awaited<ReturnType<typeof hashPassword>>;
  try {
    passwordRecord = await hashPassword(password);
  } catch (error) {
    c.var.logEvent(ACCOUNT_STREAM, {
      action: 'identity_creation_failed',
      steamId: current.steamId,
      stage: 'password_hash',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return c.json({ error: '密码处理失败，请稍后重试' }, 500);
  }
  const accountId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const db = drizzle(c.env.DB);
  try {
    await db.insert(accounts).values({
      id: accountId,
      username,
      usernameNormalized: normalizeUsername(username),
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt,
      passwordHashVersion: passwordRecord.version,
      steamId: current.steamId,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  } catch {
    return c.json({ error: '用户名已被占用，或该 Steam 账号已完成绑定' }, 409);
  }

  await revokeSession(current.sessionId, c.env);
  const session = await createSession(c.env, { accountId, steamId: current.steamId }, 'steam', current.remembered);
  c.var.logEvent(ACCOUNT_STREAM, {
    action: 'identity_created', accountId, steamId: current.steamId, username,
  });
  return c.json({ ok: true }, 201, {
    'Set-Cookie': `token=${session.token}; ${cookieAttrs(new URL(c.req.url), current.remembered)}`,
  });
});

auth.delete('/steam-link', async c => {
  if (!isSameOrigin(c.req.raw)) return c.json({ error: '请求来源无效，请刷新页面后重试' }, 403);
  const current = await resolveAuthToken(tokenFromRequest(c.req.raw), c.env);
  if (!current?.accountId || !current.steamId) return c.json({ error: '当前账户没有可解绑的 Steam 账号' }, 401);
  const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}));
  const db = drizzle(c.env.DB);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, current.accountId)).limit(1);
  if (!account || !await verifyPassword(
    body.password ?? '', account.passwordHash, account.passwordSalt,
    account.passwordHashVersion,
  )) {
    return c.json({ error: '密码错误' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.update(accounts).set({ steamId: null, updatedAt: now }).where(eq(accounts.id, account.id)),
    db.update(accountSessions).set({ revokedAt: now })
      .where(and(eq(accountSessions.accountId, account.id), isNull(accountSessions.revokedAt))),
  ]);
  const session = await createSession(c.env, { accountId: account.id, steamId: null }, 'identity', current.remembered);
  c.var.logEvent(ACCOUNT_STREAM, { action: 'steam_unlinked', accountId: account.id, steamId: current.steamId });
  return c.json({ ok: true }, 200, {
    'Set-Cookie': `token=${session.token}; ${cookieAttrs(new URL(c.req.url), current.remembered)}`,
  });
});

auth.post('/logout', async c => {
  if (!isSameOrigin(c.req.raw)) return c.json({ error: '请求来源无效，请刷新页面后重试' }, 403);
  const current = await resolveAuthToken(tokenFromRequest(c.req.raw), c.env);
  await revokeSession(current?.sessionId ?? null, c.env);
  if (current) c.var.logEvent(ACCOUNT_STREAM, {
    action: 'session_revoked', accountId: current.accountId, steamId: current.steamId,
  });
  return c.body(null, 204, { 'Set-Cookie': clearCookie(new URL(c.req.url)) });
});

// Kept temporarily for bookmarked links; new UI uses POST.
auth.get('/logout', async c => {
  const url = new URL(c.req.url);
  const current = await resolveAuthToken(tokenFromRequest(c.req.raw), c.env);
  await revokeSession(current?.sessionId ?? null, c.env);
  return new Response(null, {
    status: 302,
    headers: { Location: url.origin, 'Set-Cookie': clearCookie(url) },
  });
});

async function verifySteam(url: URL): Promise<boolean> {
  const verifyParams = new URLSearchParams(Object.fromEntries(url.searchParams));
  verifyParams.set('openid.mode', 'check_authentication');
  const verifyResponse = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString(),
  });
  return (await verifyResponse.text()).includes('is_valid:true');
}

export default auth;
