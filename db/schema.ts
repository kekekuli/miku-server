import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

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

export const candidates = sqliteTable('candidates', {
  steamId: text('steam_id').primaryKey().references(() => steamProfiles.steamId),
  nominatedBy: text('nominated_by').notNull().references(() => steamProfiles.steamId),
});

export const votes = sqliteTable('votes', {
  voterId: text('voter_id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => candidates.steamId),
});
