import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import type {
  DatabaseAdapter,
  DatabaseHealth,
  PreparedDatabaseStatement,
} from "./types";

const D1_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
    current_stage TEXT NOT NULL DEFAULT 'requirements', current_spec_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_slug_idx ON projects(owner, slug)",
  `CREATE TABLE IF NOT EXISTS project_versions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL,
    reason TEXT NOT NULL, affected_modules TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS project_versions_project_version_idx ON project_versions(project_id, version)",
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_name TEXT NOT NULL, provider TEXT NOT NULL,
    model_name TEXT NOT NULL, skill_name TEXT NOT NULL, input_summary TEXT NOT NULL,
    result_summary TEXT NOT NULL, generated_files TEXT NOT NULL DEFAULT '[]', error TEXT,
    token_usage TEXT NOT NULL DEFAULT '{}', requires_confirmation INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL,
    content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'GENERATED',
    source_spec_version INTEGER NOT NULL, checksum TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS artifacts_project_path_idx ON artifacts(project_id, path)",
  `CREATE TABLE IF NOT EXISTS validations (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, validator TEXT NOT NULL, status TEXT NOT NULL,
    report TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
];

class D1PreparedStatementAdapter implements PreparedDatabaseStatement {
  constructor(private statement: D1PreparedStatement) {}

  bind(...values: unknown[]) {
    this.statement = this.statement.bind(...values);
    return this;
  }

  async all<T>() {
    const result = await this.statement.all<T>();
    return { results: (result.results || []) as T[] };
  }

  async first<T>() {
    return await this.statement.first<T>();
  }

  async run() {
    return await this.statement.run();
  }

  native() {
    return this.statement;
  }
}

export class D1DatabaseAdapter implements DatabaseAdapter {
  readonly kind = "d1" as const;
  readonly persistent = true;
  private initialization?: Promise<void>;

  constructor(private readonly database: D1Database) {}

  prepare(query: string) {
    return new D1PreparedStatementAdapter(this.database.prepare(query));
  }

  async batch(statements: PreparedDatabaseStatement[]) {
    const nativeStatements = statements.map((statement) => {
      if (!(statement instanceof D1PreparedStatementAdapter)) {
        throw new Error("D1 batch 收到了不兼容的数据库语句");
      }
      return statement.native();
    });
    return await this.database.batch(nativeStatements);
  }

  async initialize() {
    this.initialization ??= this.database
      .batch(D1_SCHEMA.map((query) => this.database.prepare(query)))
      .then(() => undefined);
    return await this.initialization;
  }

  async healthCheck(): Promise<DatabaseHealth> {
    try {
      await this.database.prepare("SELECT 1 AS ok").first();
      return { ok: true, adapter: this.kind, persistent: true };
    } catch (error) {
      return {
        ok: false,
        adapter: this.kind,
        persistent: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
