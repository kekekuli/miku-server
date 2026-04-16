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

  if (!verifyText.includes('is_valid:true')) {
    return json({ error: 'Steam authentication failed' }, 401);
  }

  // Extract SteamID from the claimed_id URL
  const claimedId = params['openid.claimed_id'] ?? '';
  const steamId = claimedId.split('/').pop();

  if (!steamId || !/^\d+$/.test(steamId)) {
    return json({ error: 'Could not extract SteamID' }, 400);
  }

  // Fetch Steam profile
  const profileUrl = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  profileUrl.searchParams.set('key', env.STEAM_API_KEY);
  profileUrl.searchParams.set('steamids', steamId);

  const profileResponse = await fetch(profileUrl);

  if (!profileResponse.ok) {
    return json({ error: 'Failed to fetch Steam profile' }, 502);
  }

  const profileData = await profileResponse.json() as { response: { players: SteamPlayer[] } };
  const player = profileData.response.players[0];

  if (!player) {
    return json({ error: 'Steam profile not found' }, 404);
  }

  const squad44Hours = await fetchSquad44Hours(steamId, env.STEAM_API_KEY);

  const redirectUrl = new URL('/', origin);
  redirectUrl.searchParams.set('steamId', steamId);
  redirectUrl.searchParams.set('name', player.personaname);
  redirectUrl.searchParams.set('avatar', player.avatarfull);
  redirectUrl.searchParams.set('profileUrl', player.profileurl);
  if (player.loccountrycode) {
    redirectUrl.searchParams.set('countryCode', player.loccountrycode);
  }
  if (squad44Hours !== null) {
    redirectUrl.searchParams.set('squad44Hours', squad44Hours.toString());
  }

  return Response.redirect(redirectUrl.toString(), 302);
}

async function fetchSquad44Hours(steamId: string, apiKey: string): Promise<number | null> {
  try {
    const input = encodeURIComponent(JSON.stringify({ steamid: steamId, appids_filter: [736220], include_appinfo: false }));
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&format=json&input_json=${input}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json() as { response: { games?: { appid: number; playtime_forever: number }[] } };
    const game = data.response.games?.[0];
    if (!game) return null;

    return Math.round((game.playtime_forever / 60) * 10) / 10;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface SteamPlayer {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatarfull: string;
  loccountrycode?: string;
}
