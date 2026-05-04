CREATE TABLE `tmdb_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`tmdb_id` integer NOT NULL,
	`media_type` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tmdb_cache_fetched_at` ON `tmdb_cache` (`fetched_at`);
