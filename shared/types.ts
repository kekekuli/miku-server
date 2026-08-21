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

/**
 * Only permissions the caller actually holds appear here, so `'canFoo' in permissions`
 * and `permissions.canFoo` are equivalent — never store a `false`.
 */
export interface AdminMe {
  permissions: Record<string, true>;
}

export interface AccountMe {
  id: string;
  username: string;
  steamLinked: boolean;
}

export interface AdminAccount {
  id: string;
  username: string;
  steamId: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface SessionMe {
  authMethod: 'identity' | 'steam';
  remembered: boolean;
}

/**
 * Everything the UI needs to know about the caller, in one request.
 *
 * Anonymous visitors get a 200 with all fields null — being logged out is a valid
 * answer to "who am I", not a failure. A 401 here would make RTK Query treat the
 * cache entry as rejected and refetch it for every new subscriber.
 */
export interface SessionResponse {
  /** Optional convenient username/password identity. */
  account: AccountMe | null;
  profile: SteamProfile | null;
  /** null for anonymous visitors and for logged-in non-admins. */
  admin: AdminMe | null;
  session: SessionMe | null;
}

export interface GameServerOption {
  id: string;
  displayName: string;
  isActive: boolean;
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

/**
 * 解析态 — a player exactly as RCON `ListPlayers` reported them, nothing more.
 * Produced by parseListPlayers, lives only in memory during a poll, never persisted.
 */
export interface ParsedPlayer {
  steamId: string;
  /** In-game name from RCON — not the Steam persona name, and truncated by the server. */
  name: string;
}

/**
 * 展示态 — a parsed player joined with their Steam profile. This is what D1 stores
 * and what the API returns; the frontend renders it without further lookups.
 */
export interface DisplayPlayer extends ParsedPlayer {
  /** Steam persona name. Null when the profile could not be resolved. */
  steamName: string | null;
  /** Null when the profile could not be resolved — render a placeholder. */
  avatar: string | null;
  /**
   * Whether a profile lookup has been attempted for this player.
   *
   * Distinguishes "not looked up yet" from "looked up and failed", which look
   * identical otherwise (both have null steamName/avatar). A failed lookup must never
   * be retried — private profiles and deleted accounts would retry every poll forever
   * — but a lookup deferred by the per-poll cap must be picked up next time.
   */
  profileTried: boolean;
}

export interface RosterResponse {
  players: DisplayPlayer[];
  playerCount: number;
  connectingCount: number;
  /** Epoch ms of the last successful poll. */
  fetchedAt: number;
  /** Seconds since fetchedAt, so the UI can show staleness without clock skew. */
  ageSeconds: number;
  /** False when the last poll could not be parsed — the list may be stale or empty. */
  parseOk: boolean;
}

export interface TeamSwapRequest {
  requester: Pick<SteamProfile, 'steamId' | 'name' | 'avatar'>;
  target: Pick<SteamProfile, 'steamId' | 'name' | 'avatar'> | null;
}

/**
 * Why team swapping is refused right now.
 *
 * `outside_hours`      — outside the 12:00–24:00 CST window the roster is not polled
 * `roster_unavailable` — inside the window but the snapshot is missing or stale
 * `not_on_server`      — the player is simply not in the game
 */
export type TeamSwapBlock = 'outside_hours' | 'roster_unavailable' | 'not_on_server' | null;

export interface TeamSwapStatus {
  /** Seconds until this player may jump again. 0 means ready now. */
  cooldownSeconds: number;
  /** Under the playtime threshold: may jump solo, without a partner. */
  lowHours: boolean;
  /**
   * False when playtime could not be read — a private Steam profile, or Steam being
   * unreachable. Such players are treated as normal, never as low-hours.
   */
  hoursKnown: boolean;
  /** Why team swapping is unavailable, or null when it is available. */
  blocked: TeamSwapBlock;
  /** Ready-to-display reason for `blocked`, or null. Keeps wording server-side. */
  blockedMessage: string | null;
  /**
   * Holder of the canRcon permission, exempt from the cooldown and the in-server
   * requirement. `cooldownSeconds` and `blocked` already account for this — the flag
   * is here only so the UI can say why they differ.
   */
  isAdmin: boolean;
  myPending: boolean;
  requests: TeamSwapRequest[];
}

export type TeamSwapResult =
  | {
    status: 'changed';
    changedSteamId: string;
    reason: 'low_hours' | 'matched';
    /** Cooldown to start counting from now. 0 for low-hours players. */
    cooldownSeconds: number;
  }
  | { status: 'pending'; message: string };
