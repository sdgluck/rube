CREATE TABLE `plex_invites` (
	`id` integer PRIMARY KEY NOT NULL,
	`direction` text NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`thumb` text,
	`created_at` integer,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plex_user_shares` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`section_ids` text DEFAULT '[]' NOT NULL,
	`allow_sync` integer DEFAULT 0 NOT NULL,
	`allow_tuners` integer DEFAULT 0 NOT NULL,
	`allow_channels` integer DEFAULT 0 NOT NULL,
	`allow_camera_upload` integer DEFAULT 0 NOT NULL,
	`filter_movies` text DEFAULT '' NOT NULL,
	`filter_television` text DEFAULT '' NOT NULL,
	`filter_music` text DEFAULT '' NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `plex_users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `plex_users` ADD `thumb` text;--> statement-breakpoint
ALTER TABLE `plex_users` ADD `is_home` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plex_users` ADD `is_managed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plex_users` ADD `is_protected` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plex_users` ADD `shared_server_id` integer;--> statement-breakpoint
ALTER TABLE `plex_users` ADD `accepted` integer DEFAULT 1 NOT NULL;