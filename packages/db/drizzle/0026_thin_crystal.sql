CREATE TABLE `cleanup_candidates` (
	`rule_id` text NOT NULL,
	`rating_key` text NOT NULL,
	`section_id` text NOT NULL,
	`title` text NOT NULL,
	`streak` integer DEFAULT 1 NOT NULL,
	`first_matched_at` integer NOT NULL,
	`last_matched_at` integer NOT NULL,
	`actioned_at` integer,
	`action` text DEFAULT '' NOT NULL,
	`held_until` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cleanup_candidates_pk` ON `cleanup_candidates` (`rule_id`,`rating_key`);--> statement-breakpoint
CREATE INDEX `idx_cleanup_candidates_rule_streak` ON `cleanup_candidates` (`rule_id`,`streak`);--> statement-breakpoint
CREATE INDEX `idx_cleanup_candidates_actioned` ON `cleanup_candidates` (`actioned_at`,`streak`);