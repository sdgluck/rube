CREATE TABLE `rule_collection_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` text NOT NULL,
	`section_key` text NOT NULL,
	`collection_name` text NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rule_members_unique` ON `rule_collection_members` (`rule_id`,`section_key`,`collection_name`);--> statement-breakpoint
CREATE TABLE `rule_run_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`section_key` text NOT NULL,
	`section_title` text NOT NULL,
	`collection_name` text NOT NULL,
	`collection_rating_key` text,
	`item_rating_key` text NOT NULL,
	`item_title` text NOT NULL,
	`change` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rule_run_changes_run` ON `rule_run_changes` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_rule_run_changes_rule_at` ON `rule_run_changes` (`rule_id`,`at`);