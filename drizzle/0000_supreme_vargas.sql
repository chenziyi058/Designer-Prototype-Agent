CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_name` text NOT NULL,
	`provider` text NOT NULL,
	`model_name` text NOT NULL,
	`skill_name` text NOT NULL,
	`input_summary` text NOT NULL,
	`result_summary` text NOT NULL,
	`generated_files` text DEFAULT '[]' NOT NULL,
	`error` text,
	`token_usage` text DEFAULT '{}' NOT NULL,
	`requires_confirmation` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'GENERATED' NOT NULL,
	`source_spec_version` integer NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_project_path_idx` ON `artifacts` (`project_id`,`path`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`reason` text NOT NULL,
	`affected_modules` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_versions_project_version_idx` ON `project_versions` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`current_stage` text DEFAULT 'requirements' NOT NULL,
	`current_spec_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_owner_slug_idx` ON `projects` (`owner`,`slug`);--> statement-breakpoint
CREATE TABLE `validations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`validator` text NOT NULL,
	`status` text NOT NULL,
	`report` text NOT NULL,
	`created_at` text NOT NULL
);
