CREATE TABLE `metadata_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`match_title` text NOT NULL,
	`match_year` integer,
	`match_imdb` text,
	`match_tmdb` integer,
	`rating_key` text,
	`fields` text DEFAULT '{}' NOT NULL,
	`tags` text DEFAULT '{}' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`applied_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_metadata_overrides_section` ON `metadata_overrides` (`section_id`);--> statement-breakpoint
CREATE INDEX `idx_metadata_overrides_applied` ON `metadata_overrides` (`applied_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_metadata_overrides_match` ON `metadata_overrides` (`section_id`,`match_title`,`match_year`);