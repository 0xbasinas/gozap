DROP INDEX `apikey_key_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `apikey_key_idx` ON `apikey` (`key`);