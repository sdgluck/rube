CREATE TABLE `rule_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` text NOT NULL,
	`section_key` text NOT NULL,
	`section_title` text NOT NULL,
	`run_at` integer NOT NULL,
	`collections` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rule_history_rule_section_run` ON `rule_history` (`rule_id`,`section_key`,`run_at`);