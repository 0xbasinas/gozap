CREATE TABLE `scim_tombstone` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scim_tombstone_idx` ON `scim_tombstone` (`organization_id`,`email_hash`);