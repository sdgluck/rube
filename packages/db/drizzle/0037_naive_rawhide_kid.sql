CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`page` text NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_saved_views_page_name` ON `saved_views` (`page`,`name`);