CREATE TABLE `digest_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`user_id` integer DEFAULT 0 NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_digest_deliveries_unique` ON `digest_deliveries` (`period_start`,`user_id`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_digest_deliveries_sent` ON `digest_deliveries` (`sent_at`);--> statement-breakpoint
ALTER TABLE `media_items` ADD `genres` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `rating` real;--> statement-breakpoint
ALTER TABLE `media_items` ADD `content_rating` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `duration_ms` integer;