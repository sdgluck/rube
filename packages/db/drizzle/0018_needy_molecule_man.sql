CREATE TABLE `rule_locks` (
	`rule_id` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`holder_label` text DEFAULT '' NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
