ALTER TABLE `media_items` ADD `file_size` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `bitrate` integer;--> statement-breakpoint
CREATE INDEX `idx_media_items_file_size` ON `media_items` (`file_size`);