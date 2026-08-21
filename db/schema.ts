import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import type { DisplayPlayer } from '../shared/types';

export const steamProfiles = sqliteTable('steam_profiles', {
  steamId: text('steam_id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  profileUrl: text('profile_url').notNull(),
  countryCode: text('country_code'),
  updatedAt: integer('updated_at').notNull(),
});

// Optional convenient login layered over Steam. An account is initially created only
// for a freshly Steam-authenticated user, but steamId becomes null if they later unlink.
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  usernameNormalized: text('username_normalized').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  passwordHashVersion: integer('password_hash_version').notNull(),
  steamId: text('steam_id').references(() => steamProfiles.steamId),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastLoginAt: integer('last_login_at'),
}, t => [
  uniqueIndex('accounts_username_normalized_unique').on(t.usernameNormalized),
  uniqueIndex('accounts_steam_id_unique').on(t.steamId),
]);

export const accountSessions = sqliteTable('account_sessions', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  steamId: text('steam_id').references(() => steamProfiles.steamId),
  authMethod: text('auth_method', { enum: ['identity', 'steam'] }).notNull(),
  remembered: integer('remembered', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull(),
  authenticatedAt: integer('authenticated_at').notNull(),
  lastUsedAt: integer('last_used_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
}, t => [
  uniqueIndex('account_sessions_token_hash_unique').on(t.tokenHash),
  index('account_sessions_account_id_idx').on(t.accountId),
  index('account_sessions_steam_id_idx').on(t.steamId),
]);

// Single-use state for the Steam OpenID redirect. D1 is used rather than KV because
// signup begins and returns immediately and therefore needs strongly consistent state.
export const authStates = sqliteTable('auth_states', {
  id: text('id').primaryKey(),
  intent: text('intent', { enum: ['login', 'signup', 'link'] }).notNull(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  remembered: integer('remembered', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const steamGameStatus = sqliteTable('steam_game_status', {
  steamId: text('steam_id').notNull().references(() => steamProfiles.steamId),
  appId: integer('app_id').notNull(),
  playtimeForever: integer('playtime_forever').notNull(),
  playtime2Weeks: integer('playtime_2weeks'),
  updatedAt: integer('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.steamId, t.appId] })]);

// One row per game server, upserted by the roster cron. The player list is stored as
// a JSON blob rather than a row per player: a row-per-player layout would need the
// previous set deleted or diffed on every poll (~98 row ops instead of 1), and the
// roster is only ever read whole, never queried by player.
//
// Stores the 展示态 (DisplayPlayer) — Steam names and avatars already joined in by the
// cron — so a page view is one row read and touches no KV at all.
export const serverRoster = sqliteTable('server_roster', {
  gameServerId: text('game_server_id').primaryKey(),
  players: text('players', { mode: 'json' }).$type<DisplayPlayer[]>().notNull(),
  playerCount: integer('player_count').notNull(),
  // Slots held by players who have not finished connecting (`SteamID: N/A`).
  connectingCount: integer('connecting_count').notNull(),
  fetchedAt: integer('fetched_at').notNull(),
  // False when ListPlayers could not be parsed. Without this an empty server and a
  // broken parser are indistinguishable, and the site would silently report 0 players.
  parseOk: integer('parse_ok', { mode: 'boolean' }).notNull(),
});

export const candidates = sqliteTable('candidates', {
  steamId: text('steam_id').primaryKey().references(() => steamProfiles.steamId),
  nominatedBy: text('nominated_by').notNull().references(() => steamProfiles.steamId),
});

export const votes = sqliteTable('votes', {
  voterId: text('voter_id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => candidates.steamId),
});
