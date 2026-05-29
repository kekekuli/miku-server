INSERT INTO `steam_profiles` (`steam_id`, `name`, `avatar`, `profile_url`, `updated_at`)
SELECT `steam_id`, `name`, `avatar`, 'https://steamcommunity.com/profiles/' || `steam_id`, 0
FROM `candidates`;
