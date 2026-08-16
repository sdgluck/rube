CREATE TABLE `cleanup_keep_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rating_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`username` text NOT NULL,
	`voted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cleanup_keep_votes_unique` ON `cleanup_keep_votes` (`rating_key`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_cleanup_keep_votes_item` ON `cleanup_keep_votes` (`rating_key`);