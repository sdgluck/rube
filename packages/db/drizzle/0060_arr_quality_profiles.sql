CREATE TABLE `arr_managed_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`service` text NOT NULL,
	`arr_profile_id` integer,
	`profile_name` text NOT NULL,
	`preset_id` text NOT NULL,
	`preset_version` integer NOT NULL,
	`limits` text NOT NULL,
	`applied_at` integer,
	`applied_by` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`drift` text,
	`checked_at` integer,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_arr_managed_profiles_profile` ON `arr_managed_profiles` (`instance_id`,`arr_profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_arr_managed_profiles_name` ON `arr_managed_profiles` (`instance_id`,`profile_name`);--> statement-breakpoint
CREATE TABLE `arr_settings_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`area` text NOT NULL,
	`payload` text NOT NULL,
	`touched` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_arr_settings_snapshots_instance` ON `arr_settings_snapshots` (`instance_id`,`created_at`);