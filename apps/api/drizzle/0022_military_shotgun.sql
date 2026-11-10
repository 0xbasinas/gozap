ALTER TABLE `scim_group` ADD `grants_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scim_user` ADD `granted_admin` integer DEFAULT false NOT NULL;