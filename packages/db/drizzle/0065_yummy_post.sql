CREATE TABLE `quality_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`arr_movie_id` integer NOT NULL,
	`plex_rating_key` text,
	`title` text NOT NULL,
	`from_profile_id` integer,
	`to_profile_id` integer NOT NULL,
	`from_quality` text DEFAULT '' NOT NULL,
	`from_size` integer,
	`release_title` text DEFAULT '' NOT NULL,
	`download_id` text,
	`command_id` integer,
	`to_quality` text DEFAULT '' NOT NULL,
	`to_size` integer,
	`state` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`grabbed_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_quality_swaps_state` ON `quality_swaps` (`state`);--> statement-breakpoint
CREATE INDEX `idx_quality_swaps_movie` ON `quality_swaps` (`instance_id`,`arr_movie_id`);