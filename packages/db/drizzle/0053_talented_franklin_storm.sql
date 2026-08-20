CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`source` text DEFAULT 'ui' NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_change_log_entity` ON `change_log` (`entity`,`entity_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_change_log_timestamp` ON `change_log` (`timestamp`);