import type { GameStatus, SteamProfile } from '../../shared/types';

export async function getSteamProfile(validSteamId: string, env: Env): Promise<SteamProfile> {
  const cached = await env.STEAM_PROFILE_CACHE.get(validSteamId);
  if (cached) return JSON.parse(cached) as SteamProfile;

  const profileUrl = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  profileUrl.searchParams.set('key', env.STEAM_API_KEY);
  profileUrl.searchParams.set('steamids', validSteamId);

  const profileResponse = await fetch(profileUrl);
  if (!profileResponse.ok) throw new Error('Failed to fetch Steam profile');

  const profileData: { response: { players: { steamid: string; personaname: string; profileurl: string; avatarfull: string; loccountrycode?: string }[] } } = await profileResponse.json();
  const player = profileData.response.players[0];
  if (!player) throw new Error('Steam profile not found');

  const [squad44Status] = await fetchGamesHours(validSteamId, env.STEAM_API_KEY, [{ appid: 736220 }]);

  const profile: SteamProfile = {
    steamId: player.steamid,
    name: player.personaname,
    avatar: player.avatarfull,
    profileUrl: player.profileurl,
    countryCode: player.loccountrycode ?? null,
    squad44Status: squad44Status ?? null,
  };

  await env.STEAM_PROFILE_CACHE.put(validSteamId, JSON.stringify(profile), { expirationTtl: 60 * 60 });
  return profile;
}

async function fetchGamesHours(steamId: string, apiKey: string, games: { appid: number }[]): Promise<(GameStatus | null)[]> {
  try {
    const input = encodeURIComponent(JSON.stringify({ steamid: steamId, appids_filter: games.map(g => g.appid), include_appinfo: false }));
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&format=json&input_json=${input}`;

    const response = await fetch(url);
    if (!response.ok) return games.map(() => null);

    const data: { response: { games?: GameStatus[] } } = await response.json();
    const fetched = data.response.games ?? [];

    return games.map(g => fetched.find(r => r.appid === g.appid) ?? null);
  } catch {
    return games.map(() => null);
  }
}
