const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const REALM = 'https://miku-server.org';
const RETURN_TO = 'https://miku-server.org/auth/steam/callback';

export interface Env {
	STEAM_API_KEY: string;
	ASSETS: Fetcher;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/auth/steam') {
			return handleSteamLogin();
		}

		if (url.pathname === '/auth/steam/callback') {
			return handleSteamCallback(request, env);
		}

		return env.ASSETS.fetch(request);
	},
};

function handleSteamLogin(): Response {
	const params = new URLSearchParams({
		'openid.ns': 'http://specs.openid.net/auth/2.0',
		'openid.mode': 'checkid_setup',
		'openid.return_to': RETURN_TO,
		'openid.realm': REALM,
		'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
		'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
	});

	return Response.redirect(`${STEAM_OPENID_URL}?${params}`, 302);
}

async function handleSteamCallback(request: Request, env: Env): Promise<Response> {
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

	const redirectUrl = new URL('/', REALM);
	redirectUrl.searchParams.set('steamId', steamId);
	redirectUrl.searchParams.set('name', player.personaname);
	redirectUrl.searchParams.set('avatar', player.avatarfull);
	redirectUrl.searchParams.set('profileUrl', player.profileurl);
	if (player.loccountrycode) {
		redirectUrl.searchParams.set('countryCode', player.loccountrycode);
	}

	return Response.redirect(redirectUrl.toString(), 302);
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
