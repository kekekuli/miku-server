import type { InferSelectModel } from 'drizzle-orm';
import type { candidates, votes } from '../db/schema';

export interface GameStatus {
  appid: number;
  playtime_forever: number;
  playtime_2weeks?: number;
}

export interface SteamProfile {
  steamId: string;
  name: string;
  avatar: string;
  profileUrl: string;
  countryCode: string | null;
  squad44Status: GameStatus | null;
}

export type VoteCandidate = InferSelectModel<typeof candidates>;
export type Vote = InferSelectModel<typeof votes>;

export interface VoteResult {
  candidate: VoteCandidate;
  voteCount: number;
}

export interface VotesResponse {
  results: VoteResult[];
  myVote: string | null;
}

