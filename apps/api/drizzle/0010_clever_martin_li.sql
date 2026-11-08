CREATE TABLE `data_request` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`received_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `data_request_subject_idx` ON `data_request` (`subject_id`,`received_at`);