CREATE TABLE `sharing_restriction_backups` (
	`sharing_id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`username` text NOT NULL,
	`filter_movies` text DEFAULT '' NOT NULL,
	`filter_television` text DEFAULT '' NOT NULL,
	`captured_at` integer NOT NULL
);
