CREATE TABLE `sign_in_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`label` text NOT NULL,
	`ip_address` text,
	`new_device` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sign_in_event_user_at_idx` ON `sign_in_event` (`user_id`,`at`);