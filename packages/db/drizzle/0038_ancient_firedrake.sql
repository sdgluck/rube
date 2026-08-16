CREATE TABLE `metadata_originals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`rule_id` text,
	`rating_key` text NOT NULL,
	`section_id` text NOT NULL,
	`section_type` text DEFAULT 'movie' NOT NULL,
	`item_title` text DEFAULT '' NOT NULL,
	`field` text NOT NULL,
	`field_kind` text DEFAULT 'scalar' NOT NULL,
	`previous_value` text,
	`previous_locked` integer DEFAULT 0 NOT NULL,
	`new_value` text,
	`applied_at` integer NOT NULL,
	`reverted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_metadata_originals_batch` ON `metadata_originals` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_metadata_originals_item` ON `metadata_originals` (`rating_key`);--> statement-breakpoint
CREATE INDEX `idx_metadata_originals_applied` ON `metadata_originals` (`applied_at`);