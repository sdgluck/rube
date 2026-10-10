CREATE TABLE `problem_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`fingerprint` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`dismissed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_problem_dismissals_unique` ON `problem_dismissals` (`kind`,`subject`);--> statement-breakpoint
CREATE TABLE `show_checks` (
	`instance_id` text NOT NULL,
	`arr_id` integer NOT NULL,
	`plex_rating_key` text NOT NULL,
	`title` text NOT NULL,
	`signature` text,
	`checked_at` integer NOT NULL,
	`ordering` text,
	`ordering_evidence` text,
	`missing_episodes` text,
	`plex_folder` text,
	`fixed_at` integer,
	`error` text,
	PRIMARY KEY(`instance_id`, `arr_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_show_checks_plex_rating_key` ON `show_checks` (`plex_rating_key`);--> statement-breakpoint
ALTER TABLE `media_items` ADD `agent_guid` text;