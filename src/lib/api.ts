import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { SteamProfile, VotesResponse, AdminMe, GameStatus, EligibilityRequest, EligibilityResponse, ConditionLabel } from '../../shared/types';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Votes', 'AdminMe'],
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
        url: 'api/votes/candidates',
        method: 'POST',
        body: steamId ? { steamId } : undefined,
      }),
      invalidatesTags: ['Votes'],
    }),
    getGameStatus: builder.query<GameStatus | null, string>({
      query: steamId => `api/game-status/${steamId}`,
    }),
    getVoters: builder.query<SteamProfile[], string>({
      query: candidateId => `api/votes/${candidateId}/voters`,
      providesTags: ['Votes'],
    }),
    getAdminMe: builder.query<AdminMe, void>({
      query: () => 'admin/me',
      providesTags: ['AdminMe'],
    }),
    sendRcon: builder.mutation<{ output: string }, string>({
      query: command => ({
        url: 'admin/rcon',
        method: 'POST',
        body: { command },
      }),
    }),
    resetVotes: builder.mutation<void, void>({
      query: () => ({ url: 'admin/votes/reset', method: 'DELETE' }),
      invalidatesTags: ['Votes'],
    }),
    deleteCandidate: builder.mutation<void, string>({
      query: steamId => ({ url: `admin/candidates/${steamId}`, method: 'DELETE' }),
      invalidatesTags: ['Votes'],
    }),
    getFilterCondition: builder.query<ConditionLabel[], void>({
      query: () => 'api/filter-conditions',
    }),
    getEligibility: builder.query<EligibilityResponse, EligibilityRequest>({
      query: body => ({
        url: 'api/eligibility',
        method: 'POST',
        body
      })
    })
  }),
});

export const {
  useGetMeQuery,
  useGetVotesQuery,
  useCastVoteMutation,
  useRemoveVoteMutation,
  useNominateMutation,
  useGetGameStatusQuery,
  useGetVotersQuery,
  useGetAdminMeQuery,
  useSendRconMutation,
  useResetVotesMutation,
  useDeleteCandidateMutation,
  useGetFilterConditionQuery,
  useGetEligibilityQuery,
} = api;
