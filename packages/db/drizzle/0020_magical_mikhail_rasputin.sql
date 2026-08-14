CREATE TABLE `playback_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`plex_session_key` text DEFAULT '' NOT NULL,
	`user_id` integer NOT NULL,
	`username` text NOT NULL,
	`rating_key` text NOT NULL,
	`grandparent_rating_key` text,
	`section_id` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`grandparent_title` text,
	`type` text NOT NULL,
	`player` text DEFAULT '' NOT NULL,
	`platform` text DEFAULT '' NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`local` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ended_at` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`watched_ms` integer DEFAULT 0 NOT NULL,
	`view_offset_ms` integer DEFAULT 0 NOT NULL,
	`completion_pct` real DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'playing' NOT NULL,
	`source` text DEFAULT 'poller' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_playback_user_started` ON `playback_sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_playback_rating_key` ON `playback_sessions` (`rating_key`);--> statement-breakpoint
CREATE INDEX `idx_playback_started` ON `playback_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_playback_open` ON `playback_sessions` (`ended_at`);--> statement-breakpoint
CREATE INDEX `idx_playback_dedupe` ON `playback_sessions` (`user_id`,`rating_key`,`started_at`);--> statement-breakpoint
CREATE TABLE `watch_state` (
	`rating_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`plays` integer DEFAULT 0 NOT NULL,
	`completed_plays` integer DEFAULT 0 NOT NULL,
	`first_played_at` integer,
	`last_played_at` integer,
	`total_watched_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_watch_state_pk` ON `watch_state` (`rating_key`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_watch_state_user_last` ON `watch_state` (`user_id`,`last_played_at`);--> statement-breakpoint
CREATE INDEX `idx_watch_state_rating_key` ON `watch_state` (`rating_key`);