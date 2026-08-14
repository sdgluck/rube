CREATE TABLE `bandwidth_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`down_mbps` real,
	`up_mbps` real,
	`latency_ms` real,
	`jitter_ms` real,
	`endpoint` text NOT NULL,
	`pop` text,
	`bytes_down` integer DEFAULT 0 NOT NULL,
	`bytes_up` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`concurrent_kbps` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_bandwidth_tests_started` ON `bandwidth_tests` (`started_at`);