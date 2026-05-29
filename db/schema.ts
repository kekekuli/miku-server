import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const steamProfiles = sqliteTable('steam_profiles', {
  steamId: text('steam_id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  profileUrl: text('profile_url').notNull(),
  countryCode: text('country_code'),
  squad44Status: text('squad44_status'), // JSON encoded GameStatus | null
  updatedAt: integer('updated_at').notNull(),
});

export const candidates = sqliteTable('candidates', {
  steamId: text('steam_id').primaryKey().references(() => steamProfiles.steamId),
  nominatedBy: text('nominated_by').notNull().references(() => steamProfiles.steamId),
});

export const votes = sqliteTable('votes', {
  voterId: text('voter_id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => candidates.steamId),
});
