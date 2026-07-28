import type {
  ModelCompletion,
  ModelCompletionOptions,
  ModelMessage,
  ModelProvider,
  ModelRole,
} from "./types";

export type ModelEnvironment = {
  MODEL_PROVIDER?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_DEFAULT_MODEL?: string;
  DEEPSEEK_REASONING_MODEL?: string;
  DEEPSEEK_CODING_MODEL?: string;
  DEEPSEEK_REASONING_EFFORT?: string;
  MODEL_TIMEOUT_SECONDS?: string;
  MODEL_MAX_RETRIES?: string;
  MODEL_TEMPERATURE?: string;
};

export class ModelProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
  }
}

class MockModelProvider implements ModelProvider {
  readonly kind = "mock" as const;
  readonly configured = false;

  modelFor() {
    return "deterministic-fallback";
  }

  async complete(): Promise<ModelCompletion> {
    throw new ModelProviderError("当前使用 Mock Provider，未启用外部模型调用", 503);
  }
}

class DeepSeekModelProvider implements ModelProvider {
  readonly kind = "deepseek" as const;
  readonly configured = true;

  constructor(
    private readonly apiKey: string,
    private readonly environment: ModelEnvironment,
  ) {}

  modelFor(role: ModelRole) {
    const fallback =
      this.environment.DEEPSEEK_DEFAULT_MODEL?.trim() || "deepseek-chat";
    if (role === "reasoning") {
      return this.environment.DEEPSEEK_REASONING_MODEL?.trim() || fallback;
    }
    if (role === "coding") {
      return this.environment.DEEPSEEK_CODING_MODEL?.trim() || fallback;
    }
    return fallback;
  }

  async complete(
    messages: ModelMessage[],
    options: ModelCompletionOptions,
  ): Promise<ModelCompletion> {
    const role = options.role;
    const model = this.modelFor(role);
    const retries = Math.max(
      0,
      Math.min(2, Number(this.environment.MODEL_MAX_RETRIES || 2)),
    );
    const timeoutSeconds = Math.max(
      10,
      Math.min(120, Number(this.environment.MODEL_TIMEOUT_SECONDS || 120)),
    );
    let lastError = "未知错误";

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      try {
        const body: Record<string, unknown> = {
          model,
          messages,
          max_tokens: Math.max(
            32,
            Math.min(4000, options.maxTokens || 1200),
          ),
        };
        if (role === "default") {
          body.temperature = Number(
            this.environment.MODEL_TEMPERATURE || 0.2,
          );
        }
        if (options.jsonMode) {
          body.response_format = { type: "json_object" };
        }

        const response = await fetch(
          `${(this.environment.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          throw new Error(`HTTP ${response.status}: ${detail}`);
        }
        const result = (await response.json()) as {
          model?: string;
          choices: Array<{ message: { content: string } }>;
          usage?: Record<string, unknown>;
        };
        return {
          content: result.choices[0]?.message?.content || "",
          model: result.model || model,
          usage: result.usage || {},
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < retries) {
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * 2 ** attempt),
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw new ModelProviderError(`DeepSeek 请求失败：${lastError}`);
  }
}

export function createModelProvider(
  environment: ModelEnvironment,
): ModelProvider {
  const explicitProvider = environment.MODEL_PROVIDER?.trim().toLowerCase();
  const shouldUseDeepSeek =
    explicitProvider === "deepseek" ||
    (!explicitProvider && Boolean(environment.DEEPSEEK_API_KEY));
  if (!shouldUseDeepSeek || !environment.DEEPSEEK_API_KEY?.trim()) {
    return new MockModelProvider();
  }
  return new DeepSeekModelProvider(
    environment.DEEPSEEK_API_KEY.trim(),
    environment,
  );
}
