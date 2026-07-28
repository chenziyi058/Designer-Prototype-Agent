import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type {
  DatabaseAdapter,
  DatabaseHealth,
  PreparedDatabaseStatement,
} from "./types";

type NeonDatabase = ReturnType<typeof drizzle>;
type QueryResult = { rows?: unknown[] } | unknown[];

function bindQuery(query: string, values: unknown[]) {
  const parts = query.split("?");
  if (parts.length - 1 !== values.length) {
    throw new Error(
      `SQL 参数数量不匹配：需要 ${parts.length - 1} 个，收到 ${values.length} 个`,
    );
  }
  const statement = sql.empty();
  statement.append(sql.raw(parts[0]));
  values.forEach((value, index) => {
    statement.append(sql`${value}`);
    statement.append(sql.raw(parts[index + 1]));
  });
  return statement;
}

function rowsFrom(result: QueryResult) {
  return Array.isArray(result) ? result : result.rows || [];
}

class NeonPreparedStatementAdapter implements PreparedDatabaseStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: NeonDatabase,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  statement(): SQL {
    return bindQuery(this.query, this.values);
  }

  batchItem() {
    return this.database.execute(this.statement());
  }

  async all<T>() {
    const result = (await this.batchItem()) as QueryResult;
    return { results: rowsFrom(result) as T[] };
  }

  async first<T>() {
    const result = await this.all<T>();
    return result.results[0] || null;
  }

  async run() {
    return await this.batchItem();
  }
}

export class NeonDatabaseAdapter implements DatabaseAdapter {
  readonly kind = "postgresql" as const;
  readonly persistent = true;
  private readonly database: NeonDatabase;
  private initialization?: Promise<void>;

  constructor(databaseUrl: string) {
    this.database = drizzle(databaseUrl);
  }

  prepare(query: string) {
    return new NeonPreparedStatementAdapter(this.database, query);
  }

  async batch(statements: PreparedDatabaseStatement[]) {
    if (!statements.length) return [];
    const items = statements.map((statement) => {
      if (!(statement instanceof NeonPreparedStatementAdapter)) {
        throw new Error("PostgreSQL batch 收到了不兼容的数据库语句");
      }
      return statement.batchItem();
    });
    const batch = this.database.batch as unknown as (
      queries: readonly [unknown, ...unknown[]],
    ) => Promise<unknown[]>;
    return await batch.call(
      this.database,
      items as [unknown, ...unknown[]],
    );
  }

  async initialize() {
    this.initialization ??= (async () => {
      const result = await this.database.execute(sql`
        SELECT to_regclass('public.projects') AS table_name
      `);
      const rows = rowsFrom(result as QueryResult) as Array<{
        table_name: string | null;
      }>;
      if (!rows[0]?.table_name) {
        throw new Error(
          "PostgreSQL 尚未初始化，请先运行 pnpm db:migrate:postgres",
        );
      }
    })();
    return await this.initialization;
  }

  async healthCheck(): Promise<DatabaseHealth> {
    try {
      await this.database.execute(sql`SELECT 1 AS ok`);
      await this.initialize();
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

export class UnavailableDatabaseAdapter implements DatabaseAdapter {
  readonly kind = "unavailable" as const;
  readonly persistent = false;

  constructor(
    private readonly detail = "未配置 DATABASE_URL",
  ) {}

  prepare(): PreparedDatabaseStatement {
    throw new Error(this.detail);
  }

  async batch(): Promise<unknown[]> {
    throw new Error(this.detail);
  }

  async initialize() {
    throw new Error(this.detail);
  }

  async healthCheck(): Promise<DatabaseHealth> {
    return {
      ok: false,
      adapter: this.kind,
      persistent: false,
      detail: this.detail,
    };
  }
}
