CREATE TABLE `deleted_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`registry_rule_slug` text,
	`registry_pack_slug` text,
	`registry_version` integer,
	`registry_config_hash` text,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deleted_rules_deleted_at` ON `deleted_rules` (`deleted_at`);