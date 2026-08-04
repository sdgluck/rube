CREATE TABLE `prerolls` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`original_filename` text NOT NULL,
	`filename` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`fps` real DEFAULT 0 NOT NULL,
	`video_codec` text DEFAULT '' NOT NULL,
	`audio_codec` text DEFAULT '' NOT NULL,
	`container` text DEFAULT '' NOT NULL,
	`transcode_action` text DEFAULT '' NOT NULL,
	`transcode_reasons` text DEFAULT '[]' NOT NULL,
	`source_url` text,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prerolls_status` ON `prerolls` (`status`);--> statement-breakpoint
CREATE INDEX `idx_prerolls_enabled_position` ON `prerolls` (`enabled`,`position`);