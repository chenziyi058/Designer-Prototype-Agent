export type ModelRole = "default" | "reasoning" | "coding";

export type ModelMessage = {
  role: string;
  content: string;
};

export type ModelCompletion = {
  content: string;
  model: string;
  usage: Record<string, unknown>;
};

export type ModelCompletionOptions = {
  role: ModelRole;
  jsonMode?: boolean;
  maxTokens?: number;
};

export interface ModelProvider {
  readonly kind: "mock" | "deepseek";
  readonly configured: boolean;
  modelFor(role: ModelRole): string;
  complete(
    messages: ModelMessage[],
    options: ModelCompletionOptions,
  ): Promise<ModelCompletion>;
}

export interface PreparedDatabaseStatement {
  bind(...values: unknown[]): PreparedDatabaseStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export type DatabaseHealth = {
  ok: boolean;
  adapter: "d1" | "postgresql" | "unavailable";
  persistent: boolean;
  detail?: string;
};

export interface DatabaseAdapter {
  readonly kind: DatabaseHealth["adapter"];
  readonly persistent: boolean;
  prepare(query: string): PreparedDatabaseStatement;
  batch(statements: PreparedDatabaseStatement[]): Promise<unknown[]>;
  initialize(): Promise<void>;
  healthCheck(): Promise<DatabaseHealth>;
}

export interface AssetStorageAdapter {
  readonly strategy: "database";
  readonly maxArtifactBytes: number;
  readonly maxArchiveBytes: number;
}

export type ExecutionCapabilities = {
  persistent_projects: boolean;
  deepseek: boolean;
  hosted_static_validation: true;
  python_execution: false;
  platformio_execution: false;
  local_executor_available: false;
  physical_hardware_execution: false;
};

export interface RuntimeEnvironment {
  readonly deploymentPlatform: "cloudflare" | "vercel";
  readonly database: DatabaseAdapter;
  readonly assets: AssetStorageAdapter;
  readonly model: ModelProvider;
  readonly capabilities: ExecutionCapabilities;
  resolveOwner(request: Request): string;
}
