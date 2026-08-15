CREATE TABLE `collection_artwork` (
	`rule_id` text NOT NULL,
	`collection_name` text NOT NULL,
	`input_hash` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`summary_source` text DEFAULT '' NOT NULL,
	`summary_config_hash` text DEFAULT '' NOT NULL,
	`summary_locked_at` integer,
	`poster_uploaded_at` integer,
	`prior_thumb` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collection_artwork_pk` ON `collection_artwork` (`rule_id`,`collection_name`);