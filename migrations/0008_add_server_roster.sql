CREATE TABLE `server_roster` (
	`game_server_id` text PRIMARY KEY NOT NULL,
	`players` text NOT NULL,
	`player_count` integer NOT NULL,
	`connecting_count` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`parse_ok` integer NOT NULL
);
