CREATE TABLE `__new_votes` (`voter_id` text PRIMARY KEY NOT NULL, `candidate_id` text NOT NULL);
INSERT INTO `__new_votes` SELECT * FROM `votes`;
DROP TABLE `votes`;
ALTER TABLE `__new_votes` RENAME TO `votes`;
CREATE TABLE `__new_candidates` (
	`steam_id` text PRIMARY KEY NOT NULL,
	`nominated_by` text NOT NULL,
	FOREIGN KEY (`steam_id`) REFERENCES `steam_profiles`(`steam_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nominated_by`) REFERENCES `steam_profiles`(`steam_id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_candidates`(`steam_id`, `nominated_by`) SELECT `steam_id`, `nominated_by` FROM `candidates`;
DROP TABLE `candidates`;
ALTER TABLE `__new_candidates` RENAME TO `candidates`;
CREATE TABLE `__new_votes` (`voter_id` text PRIMARY KEY NOT NULL, `candidate_id` text NOT NULL, FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`steam_id`) ON UPDATE no action ON DELETE no action);
INSERT INTO `__new_votes` SELECT * FROM `votes`;
DROP TABLE `votes`;
ALTER TABLE `__new_votes` RENAME TO `votes`;
