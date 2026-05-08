CREATE TABLE `candidates` (
	`steam_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`voter_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`steam_id`) ON UPDATE no action ON DELETE no action
);
