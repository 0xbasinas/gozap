CREATE TABLE `feature_flag` (
	`key` text PRIMARY KEY NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`killed` integer DEFAULT false NOT NULL,
	`channels` text DEFAULT '' NOT NULL,
	`percent` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
