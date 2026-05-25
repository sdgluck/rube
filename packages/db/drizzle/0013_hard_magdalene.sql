CREATE TABLE `user_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`opted_in` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
