CREATE TABLE `steam_profiles` (
	`steam_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL,
	`profile_url` text NOT NULL,
	`country_code` text,
	`squad44_status` text,
	`updated_at` integer NOT NULL
);
