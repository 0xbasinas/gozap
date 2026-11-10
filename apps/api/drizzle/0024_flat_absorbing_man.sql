CREATE TABLE `todo` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text,
	`title` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `todo_team_created_idx` ON `todo` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `todo_user_created_idx` ON `todo` (`user_id`,`created_at`);