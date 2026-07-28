CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_name" text NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"skill_name" text NOT NULL,
	"input_summary" text NOT NULL,
	"result_summary" text NOT NULL,
	"generated_files" text DEFAULT '[]' NOT NULL,
	"error" text,
	"token_usage" text DEFAULT '{}' NOT NULL,
	"requires_confirmation" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'GENERATED' NOT NULL,
	"source_spec_version" integer NOT NULL,
	"checksum" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"reason" text NOT NULL,
	"affected_modules" text NOT NULL,
	"is_current" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"current_stage" text DEFAULT 'requirements' NOT NULL,
	"current_spec_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"validator" text NOT NULL,
	"status" text NOT NULL,
	"report" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validations" ADD CONSTRAINT "validations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_project_created_at_idx" ON "agent_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_project_path_idx" ON "artifacts" USING btree ("project_id","path");--> statement-breakpoint
CREATE INDEX "messages_project_created_at_idx" ON "messages" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_versions_project_version_idx" ON "project_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "project_versions_current_idx" ON "project_versions" USING btree ("project_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_slug_idx" ON "projects" USING btree ("owner","slug");--> statement-breakpoint
CREATE INDEX "projects_owner_updated_at_idx" ON "projects" USING btree ("owner","updated_at");--> statement-breakpoint
CREATE INDEX "validations_project_created_at_idx" ON "validations" USING btree ("project_id","created_at");