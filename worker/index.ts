const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const origin = `${url.protocol}//${url.host}`;

    if (url.pathname === '/auth/steam') {
      return handleSteamLogin(origin);
    }

    if (url.pathname === '/auth/steam/callback') {
      return handleSteamCallback(request, env, origin);
    }

    return env.ASSETS.fetch(request);
  },
};

function handleSteamLogin(origin: string): Response {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/auth/steam/callback`,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  return Response.redirect(`${STEAM_OPENID_URL}?${params}`, 302);
}

async function handleSteamCallback(request: Request, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const isValid = await verifySteam(url);
  if (!isValid) {
    return Response.redirect(origin, 302);
  }
  const profile = await getSteamProfile(url, env.STEAM_API_KEY);
  if ('error' in profile) {
    return Response.redirect(origin, 302);
  }
  const token = await signJWT(profile, env.JWT_SECRET, env.JWT_EXPIRES_IN);
}

async function signJWT(profile: SteamPlayer, secret: string, expiresIn: string): Promise<string> {
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiresIn: ${expiresIn}`);
  const exp = Math.floor(Date.now() / 1000) + parseInt(match[1]) * units[match[2]];

  const b64url = (str: string) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ ...profile, exp }));
  const data = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const signature = b64url(String.fromCharCode(...new Uint8Array(sig)));

  return `${data}.${signature}`;
}

async function verifySteam(url: URL): Promise<Boolean> {
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

async function getSteamProfile(url: URL, apiKey: string): Promise<SteamPlayer | { error: string }> {
  const params = Object.fromEntries(url.searchParams);

  // Extract SteamID from the claimed_id URL
  const claimedId = params['openid.claimed_id'] ?? '';
  const steamId = claimedId.split('/').pop();

  if (!steamId || !/^\d+$/.test(steamId)) {
    return { error: 'Invalid SteamID' };
  }

  // Fetch Steam profile
  const profileUrl = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  profileUrl.searchParams.set('key', apiKey);
  profileUrl.searchParams.set('steamids', steamId);

  const profileResponse = await fetch(profileUrl);

  if (!profileResponse.ok) {
    return { error: 'Failed to fetch Steam profile' };
  }

  const profileData = await profileResponse.json() as { response: { players: SteamPlayer[] } };
  const player = profileData.response.players[0];

  if (!player) {
    return { error: 'Steam profile not found' };
  }

  const [squad44Hours] = await fetchGamesHours(steamId, apiKey, [{ appid: 736220 }]);

  return {
    ...player,
    squad44Hours,
  };
}

async function fetchGamesHours(steamId: string, apiKey: string, games: GameIdentify[]): Promise<(number | null)[]> {
  try {
    const input = encodeURIComponent(JSON.stringify({ steamid: steamId, appids_filter: games.map(g => g.appid), include_appinfo: false }));
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&format=json&input_json=${input}`;

    const response = await fetch(url);
    if (!response.ok) return games.map(() => null);

    const data = await response.json() as { response: { games?: { appid: number; playtime_forever: number }[] } };
    const fetched = data.response.games ?? [];

    return games.map(g => {
      const game = fetched.find(r => r.appid === g.appid);
      return game ? Math.round((game.playtime_forever / 60) * 10) / 10 : null;
    });
  } catch {
    return games.map(() => null);
  }
}

interface SteamPlayer {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatarfull: string;
  loccountrycode?: string;
  squad44Hours?: number | null;
}

interface GameIdentify {
  appid: number;
}
