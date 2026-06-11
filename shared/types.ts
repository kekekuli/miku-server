import type { InferSelectModel } from 'drizzle-orm';
import type { steamProfiles, candidates } from '../db/schema';

export interface GameStatus {
  appid: number;
  playtime_forever: number;
  playtime_2weeks?: number;
}

export type SteamProfile = InferSelectModel<typeof steamProfiles> & {
  squad44Status: GameStatus | null;
};

type VoteCandidate = InferSelectModel<typeof candidates>;

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

export interface EligibilityResult {
  key: string;
  passed: boolean;
}

export interface ConditionLabel {
  key: string;
  label: string;
}

export type EligibilityRequest = { steamId: string; conditionKeys: string[] }[];
export type EligibilityResponse = { steamId: string; conditions: EligibilityResult[]; noGameStatus: boolean }[];

export interface TeamSwapRequest {
  requester: Pick<SteamProfile, 'steamId' | 'name' | 'avatar'>;
  target: Pick<SteamProfile, 'steamId' | 'name' | 'avatar'> | null;
}

export interface TeamSwapStatus {
  usedToday: boolean;
  myPending: boolean;
  requests: TeamSwapRequest[];
}

export type TeamSwapResult =
  | { status: 'changed'; changedSteamId: string; reason: 'low_hours' | 'matched' }
  | { status: 'pending'; message: string };
