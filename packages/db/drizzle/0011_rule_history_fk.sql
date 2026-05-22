-- Add ON DELETE CASCADE foreign key from rule_history.rule_id to rules.id.
-- SQLite cannot ALTER an existing column to add a FK, so we do the standard
-- table-rebuild dance. Orphaned rows (rule_id not in rules) are dropped on
-- the way through.
PRAGMA foreign_keys = OFF;--> statement-breakpoint
CREATE TABLE `__new_rule_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` text NOT NULL,
	`section_key` text NOT NULL,
	`section_title` text NOT NULL,
	`run_at` integer NOT NULL,
	`collections` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_rule_history` (id, rule_id, section_key, section_title, run_at, collections)
  SELECT id, rule_id, section_key, section_title, run_at, collections
  FROM `rule_history`
  WHERE rule_id IN (SELECT id FROM `rules`);--> statement-breakpoint
DROP TABLE `rule_history`;--> statement-breakpoint
ALTER TABLE `__new_rule_history` RENAME TO `rule_history`;--> statement-breakpoint
CREATE INDEX `idx_rule_history_rule_section_run` ON `rule_history` (`rule_id`,`section_key`,`run_at`);--> statement-breakpoint
PRAGMA foreign_keys = ON;
