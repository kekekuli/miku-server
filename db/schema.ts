import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import type { RosterPlayer } from '../shared/types';

export const steamProfiles = sqliteTable('steam_profiles', {
  steamId: text('steam_id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  profileUrl: text('profile_url').notNull(),
  countryCode: text('country_code'),
  updatedAt: integer('updated_at').notNull(),
});

export const steamGameStatus = sqliteTable('steam_game_status', {
  steamId: text('steam_id').notNull().references(() => steamProfiles.steamId),
  appId: integer('app_id').notNull(),
  playtimeForever: integer('playtime_forever').notNull(),
  playtime2Weeks: integer('playtime_2weeks'),
  updatedAt: integer('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.steamId, t.appId] })]);

// One row per game server, upserted by the roster cron. The player list is stored as
// a JSON blob rather than a row per player: at 60 players x 1440 polls/day a
// row-per-player layout would write ~86k rows/day against D1's 100k/day free limit,
// while a single blob row costs 1,440.
export const serverRoster = sqliteTable('server_roster', {
  gameServerId: text('game_server_id').primaryKey(),
  players: text('players', { mode: 'json' }).$type<RosterPlayer[]>().notNull(),
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
