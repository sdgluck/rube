CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);