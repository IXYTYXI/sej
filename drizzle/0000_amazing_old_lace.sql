CREATE TABLE `cards` (
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`language` text NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL,
	`due` integer NOT NULL,
	`last_request` text NOT NULL,
	PRIMARY KEY(`user_id`, `word_id`)
);
--> statement-breakpoint
CREATE INDEX `cards_user_language` ON `cards` (`user_id`,`language`);--> statement-breakpoint
CREATE TABLE `review_events` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`word_id` text NOT NULL,
	`language` text NOT NULL,
	`created_at` integer NOT NULL,
	`new_word` integer NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`user_id`, `request_id`)
);
--> statement-breakpoint
CREATE INDEX `events_user_date` ON `review_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`result` text
);
--> statement-breakpoint
CREATE INDEX `exams_user_stage` ON `exams` (`user_id`,`stage_id`);--> statement-breakpoint
CREATE TABLE `learners` (
	`user_id` text PRIMARY KEY NOT NULL,
	`daily_new_limit` integer DEFAULT 10 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passes` (
	`user_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `stage_id`)
);
--> statement-breakpoint
CREATE TABLE `unlocks` (
	`user_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `stage_id`)
);
