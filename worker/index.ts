import type { SteamProfile } from '../shared/types';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

type Handler = (request: Request, env: Env) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

const routes: Route[] = [
  { method: 'GET', path: '/auth/steam', handler: handleSteamLogin },
  { method: 'GET', path: '/auth/steam/callback', handler: handleSteamCallback },
  { method: 'GET', path: '/auth/logout', handler: handleLogout },
  { method: 'GET', path: '/api/me', handler: getMe },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = routes.find(r => r.method === request.method && r.path === url.pathname);

    if (route) return route.handler(request, env);
    return env.ASSETS.fetch(request);
  },
};

function handleSteamLogin(request: Request): Response {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/auth/steam/callback`,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  return Response.redirect(`${STEAM_OPENID_URL}?${params.toString()}`, 302);
}

async function handleSteamCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const isValid = await verifySteam(url);
  if (!isValid) {
    return Response.redirect(origin, 302);
  }
  const claimedId = url.searchParams.get('openid.claimed_id') ?? '';
  const steamId = claimedId.match(/\/(\d+)$/)?.[1];
  if (!steamId) {
    throw new Error('Invalid SteamID');
  }

  try {
    console.log(steamId, env);
    const profile = await getSteamProfile(steamId, env);
    const token = await issueJWT(profile, env.JWT_SECRET, env.JWT_EXPIRES_IN);
    return new Response(null, {
      status: 302,
      headers: {
        Location: origin,
        'Set-Cookie': `token=${token}; Path=/; SameSite=Lax; Secure; HttpOnly`,
      },
    })

  } catch {
    //TODO: use something like dialog
    return Response.redirect(origin, 302);
  }
}

function handleLogout(request: Request): Response {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: origin,
      'Set-Cookie': 'token=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly',
    },
  });
}

async function getMe(request: Request, env: Env): Promise<Response> {
  const token = parseCookie(request.headers.get('Cookie') ?? '')['token'];
  if (!token) return new Response('Unauthorized', { status: 401 });

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return new Response('Unauthorized', { status: 401 });

  const profile = await getSteamProfile(payload.steamid, env);
  return Response.json(profile);
}

function parseCookie(cookie: string): Record<string, string> {
  return Object.fromEntries(
    cookie.split(';').flatMap(part => {
      const [key, ...rest] = part.trim().split('=');
      return key ? [[key, rest.join('=')]] : [];
    })
  );
}

async function verifyJWT(token: string, secret: string): Promise<{ steamid: string; exp: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const b64decode = (str: string) =>
    Uint8Array.fromBase64(str, { alphabet: 'base64url' });

  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64decode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!isValid) return null;

  const decoded = JSON.parse(new TextDecoder().decode(b64decode(payload))) as { steamid: string; exp: number };
  if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

  return decoded;
}

async function issueJWT(profile: SteamProfile, secret: string, expiresIn: string): Promise<string> {
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiresIn: ${expiresIn}`);
  const exp = Math.floor(Date.now() / 1000) + parseInt(match[1]) * units[match[2]];

  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadBytes = encoder.encode(JSON.stringify({ steamid: profile.steamId, exp }))
  const headerB64Url = headerBytes.toBase64({ alphabet: 'base64url', omitPadding: true })
  const payloadB64Url = payloadBytes.toBase64({ alphabet: 'base64url', omitPadding: true })

  const data = `${headerB64Url}.${payloadB64Url}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const signature = new Uint8Array(sig).toBase64({ alphabet: 'base64url', omitPadding: true });
  return `${data}.${signature}`;
}

async function verifySteam(url: URL): Promise<boolean> {
  const params = Object.fromEntries(url.searchParams);

  // Verify the response with Steam
  const verifyParams = new URLSearchParams(params);
  verifyParams.set('openid.mode', 'check_authentication');

  const verifyResponse = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString(),
  });

  const verifyText = await verifyResponse.text();

  return verifyText.includes('is_valid:true');
}

async function getSteamProfile(validSteamId: string, env: Env): Promise<SteamProfile> {
  const cached = await env.STEAM_PROFILE_CACHE.get(validSteamId);
  if (cached) return JSON.parse(cached) as SteamProfile;

  const profileUrl = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  profileUrl.searchParams.set('key', env.STEAM_API_KEY);
  profileUrl.searchParams.set('steamids', validSteamId);

  const profileResponse = await fetch(profileUrl);

  if (!profileResponse.ok) {
    throw new Error('Failed to fetch Steam profile');
  }

  const profileData: { response: { players: { steamid: string; personaname: string; profileurl: string; avatarfull: string; loccountrycode?: string }[] } } = await profileResponse.json();
  const player = profileData.response.players[0];

  if (!player) {
    throw new Error('Steam profile not found');
  }

  const [squad44Hours] = await fetchGamesHours(validSteamId, env.STEAM_API_KEY, [{ appid: 736220 }]);

  const profile: SteamProfile = {
    steamId: player.steamid,
    name: player.personaname,
    avatar: player.avatarfull,
    profileUrl: player.profileurl,
    countryCode: player.loccountrycode ?? null,
    squad44Hours: squad44Hours ?? null,
  };
  await env.STEAM_PROFILE_CACHE.put(validSteamId, JSON.stringify(profile), { expirationTtl: 60 * 60 });

  return profile;
}

async function fetchGamesHours(steamId: string, apiKey: string, games: GameIdentify[]): Promise<(number | null)[]> {
  try {
    const input = encodeURIComponent(JSON.stringify({ steamid: steamId, appids_filter: games.map(g => g.appid), include_appinfo: false }));
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&format=json&input_json=${input}`;

    const response = await fetch(url);
    if (!response.ok) return games.map(() => null);

    const data: { response: { games?: { appid: number; playtime_forever: number }[] } } = await response.json();
    const fetched = data.response.games ?? [];

    return games.map(g => {
      const game = fetched.find(r => r.appid === g.appid);
      return game ? Math.round((game.playtime_forever / 60) * 10) / 10 : null;
    });
  } catch {
    return games.map(() => null);
  }
}

interface GameIdentify {
  appid: number;
}
