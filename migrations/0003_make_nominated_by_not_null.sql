PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_candidates` (
	`steam_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL,
	`nominated_by` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_candidates`("steam_id", "name", "avatar", "nominated_by") SELECT "steam_id", "name", "avatar", "nominated_by" FROM `candidates`;--> statement-breakpoint
DROP TABLE `candidates`;--> statement-breakpoint
ALTER TABLE `__new_candidates` RENAME TO `candidates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;