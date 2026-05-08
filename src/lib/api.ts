import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { SteamProfile, VotesResponse } from '../../shared/types';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Votes'],
  endpoints: builder => ({
    getMe: builder.query<SteamProfile, void>({
      query: () => 'api/me',
    }),
    getVotes: builder.query<VotesResponse, void>({
      query: () => 'api/votes',
      providesTags: ['Votes'],
    }),
    castVote: builder.mutation<void, string>({
      query: candidateId => ({
        url: 'api/votes',
        method: 'POST',
        body: { candidateId },
      }),
      invalidatesTags: ['Votes'],
    }),
    removeVote: builder.mutation<void, void>({
      query: () => ({ url: 'api/votes', method: 'DELETE' }),
      invalidatesTags: ['Votes'],
    }),
    nominate: builder.mutation<void, string | undefined>({
      query: steamId => ({
        url: 'api/candidates',
        method: 'POST',
        body: steamId ? { steamId } : undefined,
      }),
      invalidatesTags: ['Votes'],
    }),
  }),
});

export const {
  useGetMeQuery,
  useGetVotesQuery,
  useCastVoteMutation,
  useRemoveVoteMutation,
  useNominateMutation,
} = api;
