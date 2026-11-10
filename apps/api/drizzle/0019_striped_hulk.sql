CREATE TABLE `scim_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scim_connection_org_idx` ON `scim_connection` (`organization_id`);--> statement-breakpoint
CREATE TABLE `scim_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`hash` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `scim_connection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scim_credential_hash_idx` ON `scim_credential` (`hash`);--> statement-breakpoint
CREATE INDEX `scim_credential_connection_idx` ON `scim_credential` (`connection_id`);--> statement-breakpoint
CREATE TABLE `scim_group` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`display_name` text NOT NULL,
	`display_name_lower` text NOT NULL,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `scim_connection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scim_group_name_idx` ON `scim_group` (`connection_id`,`display_name_lower`);--> statement-breakpoint
CREATE UNIQUE INDEX `scim_group_external_idx` ON `scim_group` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `scim_group_member` (
	`group_id` text NOT NULL,
	`scim_user_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `scim_user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `scim_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scim_user_id`) REFERENCES `scim_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scim_group_member_user_idx` ON `scim_group_member` (`scim_user_id`);--> statement-breakpoint
CREATE TABLE `scim_user` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_account` integer NOT NULL,
	`user_name` text NOT NULL,
	`user_name_lower` text NOT NULL,
	`external_id` text,
	`active` integer NOT NULL,
	`email_values` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `scim_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scim_user_name_idx` ON `scim_user` (`connection_id`,`user_name_lower`);--> statement-breakpoint
CREATE UNIQUE INDEX `scim_user_external_idx` ON `scim_user` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `scim_user_user_idx` ON `scim_user` (`user_id`);