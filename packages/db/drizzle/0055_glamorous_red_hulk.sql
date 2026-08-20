CREATE TABLE `arr_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`service` text NOT NULL,
	`arr_history_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`arr_id` integer DEFAULT 0 NOT NULL,
	`parent_arr_id` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`source_title` text DEFAULT '' NOT NULL,
	`quality` text DEFAULT '' NOT NULL,
	`indexer` text DEFAULT '' NOT NULL,
	`download_id` text DEFAULT '' NOT NULL,
	`data` text,
	`date` integer NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_arr_activity_record` ON `arr_activity` (`instance_id`,`arr_history_id`);--> statement-breakpoint
CREATE INDEX `idx_arr_activity_item` ON `arr_activity` (`instance_id`,`arr_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_arr_activity_download_id` ON `arr_activity` (`download_id`);--> statement-breakpoint
CREATE INDEX `idx_arr_activity_date` ON `arr_activity` (`date`);--> statement-breakpoint
CREATE TABLE `arr_movies` (
	`instance_id` text NOT NULL,
	`arr_id` integer NOT NULL,
	`title` text NOT NULL,
	`sort_title` text DEFAULT '' NOT NULL,
	`year` integer,
	`tmdb_id` integer,
	`imdb_id` text,
	`plex_rating_key` text,
	`monitored` integer DEFAULT false NOT NULL,
	`has_file` integer DEFAULT false NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`minimum_availability` text DEFAULT '' NOT NULL,
	`quality_profile_id` integer,
	`root_folder_path` text DEFAULT '' NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`size_on_disk` integer,
	`runtime` integer,
	`certification` text DEFAULT '' NOT NULL,
	`studio` text DEFAULT '' NOT NULL,
	`genres` text,
	`tags` text,
	`file_quality` text DEFAULT '' NOT NULL,
	`file_custom_format_score` integer,
	`poster_url` text DEFAULT '' NOT NULL,
	`added_at` integer,
	`in_cinemas` integer,
	`digital_release` integer,
	`physical_release` integer,
	`synced_at` integer NOT NULL,
	`deleted_at` integer,
	PRIMARY KEY(`instance_id`, `arr_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_arr_movies_instance_live` ON `arr_movies` (`instance_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_arr_movies_tmdb_id` ON `arr_movies` (`tmdb_id`);--> statement-breakpoint
CREATE INDEX `idx_arr_movies_imdb_id` ON `arr_movies` (`imdb_id`);--> statement-breakpoint
CREATE INDEX `idx_arr_movies_plex_rating_key` ON `arr_movies` (`plex_rating_key`);--> statement-breakpoint
CREATE INDEX `idx_arr_movies_instance_missing` ON `arr_movies` (`instance_id`,`monitored`,`has_file`);--> statement-breakpoint
CREATE INDEX `idx_arr_movies_title` ON `arr_movies` (`title`);--> statement-breakpoint
CREATE TABLE `arr_quality_profiles` (
	`instance_id` text NOT NULL,
	`arr_id` integer NOT NULL,
	`name` text NOT NULL,
	`upgrade_allowed` integer DEFAULT false NOT NULL,
	`cutoff` integer,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`instance_id`, `arr_id`)
);
--> statement-breakpoint
CREATE TABLE `arr_root_folders` (
	`instance_id` text NOT NULL,
	`arr_id` integer NOT NULL,
	`path` text NOT NULL,
	`accessible` integer DEFAULT true NOT NULL,
	`free_space` integer,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`instance_id`, `arr_id`)
);
--> statement-breakpoint
CREATE TABLE `arr_series` (
	`instance_id` text NOT NULL,
	`arr_id` integer NOT NULL,
	`title` text NOT NULL,
	`sort_title` text DEFAULT '' NOT NULL,
	`year` integer,
	`tvdb_id` integer,
	`imdb_id` text,
	`tmdb_id` integer,
	`plex_rating_key` text,
	`monitored` integer DEFAULT false NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`series_type` text DEFAULT '' NOT NULL,
	`network` text DEFAULT '' NOT NULL,
	`season_folder` integer DEFAULT true NOT NULL,
	`quality_profile_id` integer,
	`root_folder_path` text DEFAULT '' NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`size_on_disk` integer,
	`runtime` integer,
	`certification` text DEFAULT '' NOT NULL,
	`genres` text,
	`tags` text,
	`episode_count` integer DEFAULT 0 NOT NULL,
	`episode_file_count` integer DEFAULT 0 NOT NULL,
	`seasons` text,
	`poster_url` text DEFAULT '' NOT NULL,
	`added_at` integer,
	`next_airing_at` integer,
	`previous_airing_at` integer,
	`synced_at` integer NOT NULL,
	`deleted_at` integer,
	PRIMARY KEY(`instance_id`, `arr_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_arr_series_instance_live` ON `arr_series` (`instance_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_arr_series_tvdb_id` ON `arr_series` (`tvdb_id`);--> statement-breakpoint
CREATE INDEX `idx_arr_series_imdb_id` ON `arr_series` (`imdb_id`);--> statement-breakpoint
CREATE INDEX `idx_arr_series_plex_rating_key` ON `arr_series` (`plex_rating_key`);--> statement-breakpoint
CREATE INDEX `idx_arr_series_instance_missing` ON `arr_series` (`instance_id`,`monitored`,`episode_file_count`);--> statement-breakpoint
CREATE INDEX `idx_arr_series_title` ON `arr_series` (`title`);--> statement-breakpoint
CREATE TABLE `arr_sync_state` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`arr_version` text DEFAULT '' NOT NULL,
	`capabilities` text,
	`last_full_sync_at` integer,
	`last_incremental_at` integer,
	`history_watermark` integer DEFAULT 0 NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`queue_count` integer DEFAULT 0 NOT NULL,
	`disk_free` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`last_error_at` integer
);
--> statement-breakpoint
CREATE TABLE `arr_tags` (
	`instance_id` text NOT NULL,
	`arr_id` integer NOT NULL,
	`label` text NOT NULL,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`instance_id`, `arr_id`)
);
--> statement-breakpoint
ALTER TABLE `media_items` ADD `guids` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `tmdb_id` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `imdb_id` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `tvdb_id` integer;--> statement-breakpoint
CREATE INDEX `idx_media_items_tmdb_id` ON `media_items` (`tmdb_id`);--> statement-breakpoint
CREATE INDEX `idx_media_items_imdb_id` ON `media_items` (`imdb_id`);--> statement-breakpoint
CREATE INDEX `idx_media_items_tvdb_id` ON `media_items` (`tvdb_id`);