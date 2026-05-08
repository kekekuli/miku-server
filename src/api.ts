import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { SteamProfile } from '../shared/types';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  endpoints: builder => ({
    getMe: builder.query<SteamProfile, void>({
      query: () => 'api/me',
    }),
  }),
});

export const { useGetMeQuery } = api;
