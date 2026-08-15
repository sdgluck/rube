CREATE TABLE `bandwidth_samples` (
	`sampled_at` integer PRIMARY KEY NOT NULL,
	`kbps` integer DEFAULT 0 NOT NULL,
	`streams` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bandwidth_samples_sampled` ON `bandwidth_samples` (`sampled_at`);