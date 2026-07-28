import type { D1Database } from "@cloudflare/workers-types";
import { D1DatabaseAdapter } from "./d1-database";
import { resolveRequestOwner } from "./identity";
import {
  createModelProvider,
  type ModelEnvironment,
} from "./model-provider";
import type { RuntimeEnvironment } from "./types";

export interface CloudflareBindings extends ModelEnvironment {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

const runtimeCache = new WeakMap<object, RuntimeEnvironment>();

export function createCloudflareRuntime(
  bindings: CloudflareBindings,
): RuntimeEnvironment {
  const cached = runtimeCache.get(bindings.DB);
  if (cached) return cached;

  const model = createModelProvider(bindings);
  const runtime: RuntimeEnvironment = {
    deploymentPlatform: "cloudflare",
    database: new D1DatabaseAdapter(bindings.DB),
    assets: {
      strategy: "database",
      maxArtifactBytes: 1_000_000,
      maxArchiveBytes: 10_000_000,
    },
    model,
    capabilities: {
      persistent_projects: true,
      deepseek: model.configured,
      hosted_static_validation: true,
      python_execution: false,
      platformio_execution: false,
      local_executor_available: false,
      physical_hardware_execution: false,
    },
    resolveOwner: resolveRequestOwner,
  };
  runtimeCache.set(bindings.DB, runtime);
  return runtime;
}
