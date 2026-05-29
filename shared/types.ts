import type { InferSelectModel } from 'drizzle-orm';
import type { steamProfiles, candidates } from '../db/schema';

export interface GameStatus {
  appid: number;
  playtime_forever: number;
  playtime_2weeks?: number;
}

export type SteamProfile = Omit<InferSelectModel<typeof steamProfiles>, 'squad44Status'> & {
  squad44Status: GameStatus | null;
};

export type VoteCandidate = InferSelectModel<typeof candidates>;

export interface VoteResult {
  candidate: VoteCandidate & { profile: SteamProfile; nominatorProfile: SteamProfile };
  voteCount: number;
}

export interface VotesResponse {
  results: VoteResult[];
  myVote: string | null;
}

export interface AdminMe {
  permissions: Record<string, true>;
  features: Record<string, true>;
}
