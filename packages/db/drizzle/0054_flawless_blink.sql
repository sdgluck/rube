CREATE TABLE `watchlist_items` (
	`guid` text PRIMARY KEY NOT NULL,
	`rating_key` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`year` integer,
	`external_id` text DEFAULT '' NOT NULL,
	`added_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`requested_at` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_watchlist_items_status` ON `watchlist_items` (`status`);--> statement-breakpoint
CREATE INDEX `idx_watchlist_items_first_seen` ON `watchlist_items` (`first_seen_at`);