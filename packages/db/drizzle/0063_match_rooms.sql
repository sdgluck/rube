CREATE TABLE `match_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`user_id` integer,
	`guest_token_hash` text,
	`name` text NOT NULL,
	`thumb` text,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`vote_rating_key` text,
	FOREIGN KEY (`room_id`) REFERENCES `match_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_match_members_room_user` ON `match_members` (`room_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_match_members_guest` ON `match_members` (`guest_token_hash`);--> statement-breakpoint
CREATE INDEX `idx_match_members_user` ON `match_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `match_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`invite_secret` text NOT NULL,
	`section_id` text NOT NULL,
	`filters` text NOT NULL,
	`seed` integer NOT NULL,
	`created_by_user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_match_rooms_code` ON `match_rooms` (`code`);--> statement-breakpoint
CREATE INDEX `idx_match_rooms_last_active` ON `match_rooms` (`last_active_at`);--> statement-breakpoint
CREATE TABLE `match_swipes` (
	`member_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`rating_key` text NOT NULL,
	`liked` integer NOT NULL,
	`swiped_at` integer NOT NULL,
	PRIMARY KEY(`member_id`, `rating_key`),
	FOREIGN KEY (`member_id`) REFERENCES `match_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_match_swipes_room_item` ON `match_swipes` (`room_id`,`rating_key`);