ALTER TABLE `rules` ADD `last_run_at` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_run_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_run_collection_count` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_run_item_count` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_run_status` text;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_run_error` text;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_test_at` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_test_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_test_collection_count` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_test_item_count` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_test_status` text;--> statement-breakpoint
ALTER TABLE `rules` ADD `last_test_error` text;