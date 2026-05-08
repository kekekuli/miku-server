import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { SteamProfile } from './App';

interface SteamPlayerResponse {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatarfull: string;
  loccountrycode?: string;
  squad44Hours?: number | null;
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  endpoints: builder => ({
    getMe: builder.query<SteamProfile, void>({
      query: () => 'api/me',
      transformResponse: (raw: SteamPlayerResponse): SteamProfile => ({
        steamId: raw.steamid,
        name: raw.personaname,
        avatar: raw.avatarfull,
        profileUrl: raw.profileurl,
        countryCode: raw.loccountrycode ?? null,
        squad44Hours: raw.squad44Hours ?? null,
      }),
    }),
  }),
});

export const { useGetMeQuery } = api;
