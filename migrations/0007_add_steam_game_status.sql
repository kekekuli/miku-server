CREATE TABLE `steam_game_status` (
	`steam_id` text NOT NULL REFERENCES `steam_profiles`(`steam_id`),
	`app_id` integer NOT NULL,
	`playtime_forever` integer NOT NULL,
	`playtime_2weeks` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`steam_id`, `app_id`)
);

INSERT INTO `steam_game_status` (`steam_id`, `app_id`, `playtime_forever`, `playtime_2weeks`, `updated_at`)
SELECT
	`steam_id`,
	736220,
	CAST(json_extract(`squad44_status`, '$.playtime_forever') AS INTEGER),
	CAST(json_extract(`squad44_status`, '$.playtime_2weeks') AS INTEGER),
	`updated_at`
FROM `steam_profiles`
WHERE `squad44_status` IS NOT NULL
  AND json_extract(`squad44_status`, '$.playtime_forever') IS NOT NULL;

ALTER TABLE `steam_profiles` DROP COLUMN `squad44_status`;
