CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_id` text,
	`type` text NOT NULL,
	`outcome` text NOT NULL,
	`ip_address` text,
	`label` text,
	`detail` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_event_user_at_idx` ON `audit_event` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_event_type_at_idx` ON `audit_event` (`type`,`at`);