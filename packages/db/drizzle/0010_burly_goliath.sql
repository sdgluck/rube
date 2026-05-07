CREATE TABLE `collection_items` (
	`collection_rating_key` text NOT NULL,
	`item_rating_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collection_items_pk` ON `collection_items` (`collection_rating_key`,`item_rating_key`);--> statement-breakpoint
CREATE INDEX `idx_collection_items_item` ON `collection_items` (`item_rating_key`);