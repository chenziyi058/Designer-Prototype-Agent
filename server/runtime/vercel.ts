import { resolveRequestOwner } from "./identity";
import { createModelProvider } from "./model-provider";
import {
  NeonDatabaseAdapter,
  UnavailableDatabaseAdapter,
} from "./neon-database";
import type { RuntimeEnvironment } from "./types";

let runtime: RuntimeEnvironment | undefined;

export function getVercelRuntime(): RuntimeEnvironment {
  if (runtime) return runtime;

  const model = createModelProvider({
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_DEFAULT_MODEL: process.env.DEEPSEEK_DEFAULT_MODEL,
    DEEPSEEK_REASONING_MODEL: process.env.DEEPSEEK_REASONING_MODEL,
    DEEPSEEK_CODING_MODEL: process.env.DEEPSEEK_CODING_MODEL,
    DEEPSEEK_REASONING_EFFORT: process.env.DEEPSEEK_REASONING_EFFORT,
    MODEL_TIMEOUT_SECONDS: process.env.MODEL_TIMEOUT_SECONDS,
    MODEL_MAX_RETRIES: process.env.MODEL_MAX_RETRIES,
    MODEL_TEMPERATURE: process.env.MODEL_TEMPERATURE,
  });
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const isPostgresUrl = /^postgres(?:ql)?:\/\//i.test(databaseUrl || "");
  const database = isPostgresUrl
    ? new NeonDatabaseAdapter(databaseUrl!)
    : new UnavailableDatabaseAdapter(
        databaseUrl
          ? "Vercel 的 DATABASE_URL 必须是 PostgreSQL 连接串，不能使用 SQLite"
          : "Vercel 运行时未配置 DATABASE_URL；项目持久化功能不可用",
      );

  runtime = {
    deploymentPlatform: "vercel",
    database,
    assets: {
      strategy: "database",
      maxArtifactBytes: 1_000_000,
      maxArchiveBytes: 4_500_000,
    },
    model,
    capabilities: {
      persistent_projects: database.persistent,
      deepseek: model.configured,
      hosted_static_validation: true,
      python_execution: false,
      platformio_execution: false,
      local_executor_available: false,
      physical_hardware_execution: false,
    },
    resolveOwner: resolveRequestOwner,
  };
  return runtime;
}
