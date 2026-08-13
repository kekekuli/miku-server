import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { SteamProfile, VotesResponse, SessionResponse, GameStatus, EligibilityRequest, EligibilityResponse, ConditionLabel, TeamSwapStatus, TeamSwapResult, GameServerOption, RosterResponse } from '../../shared/types';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Votes', 'TeamSwap'],
  endpoints: builder => ({
    // Profile and admin permissions in one request. Prefer the useProfile/useAdmin
    // hooks over this endpoint directly — they narrow the result per consumer.
    getSession: builder.query<SessionResponse, void>({
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
    getGameServers: builder.query<GameServerOption[], void>({
      query: () => 'admin/game-servers',
    }),
    sendRcon: builder.mutation<{ output: string }, { command: string; gameServerId: string }>({
      query: body => ({
        url: 'admin/rcon',
        method: 'POST',
        body,
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
    }),
    // Reads a snapshot polled by cron — never triggers an RCON call, so refetching
    // is cheap for the game server. Not polled automatically; refetched on mount and
    // when the user presses refresh.
    getRoster: builder.query<RosterResponse | null, void>({
      query: () => 'api/roster',
    }),
    getTeamSwapStatus: builder.query<TeamSwapStatus, void>({
      query: () => 'api/team-swap',
      providesTags: ['TeamSwap'],
    }),
    // Low-hours players jump solo and send no target; everyone else names one.
    sendTeamSwap: builder.mutation<TeamSwapResult, string | undefined>({
      query: targetSteamId => ({
        url: 'api/team-swap',
        method: 'POST',
        body: targetSteamId ? { targetSteamId } : {},
      }),
      invalidatesTags: ['TeamSwap'],
    }),
    cancelTeamSwap: builder.mutation<void, void>({
      query: () => ({ url: 'api/team-swap', method: 'DELETE' }),
      invalidatesTags: ['TeamSwap'],
    }),
  }),
});

export const {
  useGetSessionQuery,
  useGetVotesQuery,
  useCastVoteMutation,
  useRemoveVoteMutation,
  useNominateMutation,
  useGetGameStatusQuery,
  useGetVotersQuery,
  useGetGameServersQuery,
  useSendRconMutation,
  useResetVotesMutation,
  useDeleteCandidateMutation,
  useGetFilterConditionQuery,
  useGetEligibilityQuery,
  useGetRosterQuery,
  useGetTeamSwapStatusQuery,
  useSendTeamSwapMutation,
  useCancelTeamSwapMutation,
} = api;
