export interface SteamProfile {
  steamId: string;
  name: string;
  avatar: string;
  profileUrl: string;
  countryCode: string | null;
  squad44Hours: number | null;
}
