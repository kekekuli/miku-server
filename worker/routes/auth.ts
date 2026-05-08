import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { parseCookie, verifyJWT, issueJWT } from '../lib/jwt';
import { getSteamProfile } from '../lib/steam';
import type { Variables } from '../types';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const token = parseCookie(c.req.header('Cookie') ?? '')['token'];
  if (!token) return c.text('Unauthorized', 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.text('Unauthorized', 401);

  c.set('steamid', payload.steamid);
  await next();
});

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

auth.get('/steam', c => {
  const url = new URL(c.req.url);
  const origin = `${url.protocol}//${url.host}`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/auth/steam/callback`,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return c.redirect(`${STEAM_OPENID_URL}?${params.toString()}`, 302);
});

auth.get('/steam/callback', async c => {
  const url = new URL(c.req.url);
  const origin = `${url.protocol}//${url.host}`;

  const isValid = await verifySteam(url);
  if (!isValid) return c.redirect(origin, 302);

  const claimedId = c.req.query('openid.claimed_id') ?? '';
  const steamId = claimedId.match(/\/(\d+)$/)?.[1];
  if (!steamId) return c.redirect(origin, 302);

  try {
    const profile = await getSteamProfile(steamId, c.env);
    const token = await issueJWT(profile, c.env.JWT_SECRET, c.env.JWT_EXPIRES_IN);
    return new Response(null, {
      status: 302,
      headers: {
        Location: origin,
        'Set-Cookie': `token=${token}; Path=/; SameSite=Lax; Secure; HttpOnly`,
      },
    });
  } catch {
    return c.redirect(origin, 302);
  }
});

auth.get('/logout', c => {
  const url = new URL(c.req.url);
  const origin = `${url.protocol}//${url.host}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: origin,
      'Set-Cookie': 'token=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly',
    },
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
