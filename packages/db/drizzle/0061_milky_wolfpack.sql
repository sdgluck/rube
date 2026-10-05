CREATE TABLE `llm_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`feature` text NOT NULL,
	`rule_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`duration_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_llm_usage_at` ON `llm_usage` (`at`);