CREATE TABLE `presence` (
	`user_id` text PRIMARY KEY NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`last_seen` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
