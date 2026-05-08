import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const candidates = sqliteTable('candidates', {
  steamId: text('steam_id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
});

export const votes = sqliteTable('votes', {
  voterId: text('voter_id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => candidates.steamId),
});
