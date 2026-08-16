CREATE TABLE `rule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`phase` text NOT NULL,
	`trigger` text NOT NULL,
	`job_run_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`log` text DEFAULT '' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`collection_count` integer,
	`item_count` integer,
	`error` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rule_runs_rule_started` ON `rule_runs` (`rule_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_rule_runs_status_started` ON `rule_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_rule_runs_job_run` ON `rule_runs` (`job_run_id`);