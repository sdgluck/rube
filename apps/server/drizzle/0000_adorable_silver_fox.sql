CREATE TABLE `collections` (
	`plex_rating_key` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`section_title` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`child_count` integer DEFAULT 0 NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`added_at` integer,
	`thumb` text DEFAULT '' NOT NULL,
	`smart` integer DEFAULT 0 NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_collections_section` ON `collections` (`section_id`);--> statement-breakpoint
CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_timestamp` ON `events` (`timestamp`);--> statement-breakpoint
CREATE TABLE `health_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_health_checks_service_timestamp` ON `health_checks` (`service`,`timestamp`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`log` text DEFAULT '' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_job_runs_job_status_started` ON `job_runs` (`job_id`,`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`schedule` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`config` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_items` (
	`rating_key` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`section_title` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`thumb` text,
	`type` text NOT NULL,
	`added_at` integer,
	`video_resolution` text,
	`video_codec` text,
	`audio_codec` text,
	`audio_channels` integer,
	`container` text,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_items_section_type` ON `media_items` (`section_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_media_items_type` ON `media_items` (`type`);--> statement-breakpoint
CREATE INDEX `idx_media_items_title` ON `media_items` (`title`);--> statement-breakpoint
CREATE INDEX `idx_media_items_video_resolution` ON `media_items` (`video_resolution`);--> statement-breakpoint
CREATE INDEX `idx_media_items_video_codec` ON `media_items` (`video_codec`);--> statement-breakpoint
CREATE INDEX `idx_media_items_audio_codec` ON `media_items` (`audio_codec`);--> statement-breakpoint
CREATE INDEX `idx_media_items_audio_channels` ON `media_items` (`audio_channels`);--> statement-breakpoint
CREATE INDEX `idx_media_items_container` ON `media_items` (`container`);--> statement-breakpoint
CREATE TABLE `omdb_cache` (
	`imdb_id` text PRIMARY KEY NOT NULL,
	`imdb_rating` text,
	`rt_rating` text,
	`response` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `overlay_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`position` text NOT NULL,
	`overlay_type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_overlay_configs_section` ON `overlay_configs` (`section_id`);--> statement-breakpoint
CREATE TABLE `overlay_originals` (
	`rating_key` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`original_poster_url` text NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_overlay_originals_section` ON `overlay_originals` (`section_id`);--> statement-breakpoint
CREATE TABLE `plex_sections` (
	`key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plex_users` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text,
	`label` text NOT NULL,
	`collection_count` integer DEFAULT 0 NOT NULL,
	`last_watched_title` text,
	`last_watched_at` integer,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_plex_users_username` ON `plex_users` (`username`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`last_collection_rating_key` text
);
--> statement-breakpoint
CREATE TABLE `stats_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stress_test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`max_sessions` integer,
	`steps` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`log` text DEFAULT '' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
