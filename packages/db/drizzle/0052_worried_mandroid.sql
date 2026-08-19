CREATE TABLE `managed_playlists` (
	`rating_key` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`title` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_managed_playlists_rule` ON `managed_playlists` (`rule_id`);