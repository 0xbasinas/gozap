CREATE TABLE `account_deletion` (
	`user_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	`scheduled_for` integer NOT NULL,
	`cancel_token_hash` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_deletion_due_idx` ON `account_deletion` (`scheduled_for`);