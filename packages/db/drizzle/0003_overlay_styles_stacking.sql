CREATE TABLE `overlay_configs_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` text NOT NULL,
	`position` text NOT NULL,
	`overlay_type` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`style` text,
	`rule` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `overlay_configs_new` (`section_id`, `position`, `overlay_type`, `order`, `style`, `rule`, `created_at`)
SELECT `section_id`, `position`, `overlay_type`, 0, NULL, NULL, `created_at` FROM `overlay_configs`;
--> statement-breakpoint
DROP TABLE `overlay_configs`;
--> statement-breakpoint
ALTER TABLE `overlay_configs_new` RENAME TO `overlay_configs`;
--> statement-breakpoint
CREATE INDEX `idx_overlay_configs_section` ON `overlay_configs` (`section_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_overlay_configs_section_position_order` ON `overlay_configs` (`section_id`, `position`, `order`);
--> statement-breakpoint
CREATE TABLE `overlay_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`built_in` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
