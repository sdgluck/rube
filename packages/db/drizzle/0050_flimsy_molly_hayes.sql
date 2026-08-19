CREATE TABLE `migration_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`diagnostics` text DEFAULT '[]' NOT NULL,
	`section_map` text DEFAULT '{}' NOT NULL,
	`plan_cache` text
);
--> statement-breakpoint
CREATE INDEX `idx_migration_imports_provider` ON `migration_imports` (`provider_id`,`created_at`);