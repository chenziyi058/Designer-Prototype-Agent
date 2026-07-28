import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("DRAFT"),
  currentStage: text("current_stage").notNull().default("requirements"),
  currentSpecVersion: integer("current_spec_version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("projects_owner_slug_idx").on(table.owner, table.slug),
]);

export const projectVersions = sqliteTable("project_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  reason: text("reason").notNull(),
  affectedModules: text("affected_modules").notNull(),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("project_versions_project_version_idx").on(table.projectId, table.version),
]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  taskName: text("task_name").notNull(),
  provider: text("provider").notNull(),
  modelName: text("model_name").notNull(),
  skillName: text("skill_name").notNull(),
  inputSummary: text("input_summary").notNull(),
  resultSummary: text("result_summary").notNull(),
  generatedFiles: text("generated_files").notNull().default("[]"),
  error: text("error"),
  tokenUsage: text("token_usage").notNull().default("{}"),
  requiresConfirmation: integer("requires_confirmation", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(),
  path: text("path").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("GENERATED"),
  sourceSpecVersion: integer("source_spec_version").notNull(),
  checksum: text("checksum").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("artifacts_project_path_idx").on(table.projectId, table.path),
]);

export const validations = sqliteTable("validations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  validator: text("validator").notNull(),
  status: text("status").notNull(),
  report: text("report").notNull(),
  createdAt: text("created_at").notNull(),
});
