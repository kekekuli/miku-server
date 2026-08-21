CREATE TABLE `account_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`account_id` text,
	`steam_id` text,
	`auth_method` text NOT NULL,
	`remembered` integer NOT NULL,
	`created_at` integer NOT NULL,
	`authenticated_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`steam_id`) REFERENCES `steam_profiles`(`steam_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_sessions_token_hash_unique` ON `account_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_sessions_account_id_idx` ON `account_sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `account_sessions_steam_id_idx` ON `account_sessions` (`steam_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash_version` integer NOT NULL,
	`steam_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer,
	FOREIGN KEY (`steam_id`) REFERENCES `steam_profiles`(`steam_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_normalized_unique` ON `accounts` (`username_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_steam_id_unique` ON `accounts` (`steam_id`);--> statement-breakpoint
CREATE TABLE `auth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`intent` text NOT NULL,
	`remembered` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
