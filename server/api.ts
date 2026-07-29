import {
  createProjectSpec,
  generateArtifacts,
  validateCodeArtifacts,
  validateHardware,
  validateProtocolArtifacts,
} from "./generator";
import type {
  ArtifactDraft,
  PlanningQuestion,
  ProjectCreateInput,
  ProjectPlan,
  ProjectSpec,
  RequirementChange,
  RequirementExtraction,
  Traced,
} from "./types";
import { ModelProviderError } from "./runtime/model-provider";
import type { RuntimeEnvironment } from "./runtime/types";
import { createZip } from "./zip";

type Json = Record<string, unknown>;
type ProjectRow = {
  id: string;
  owner: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  current_stage: string;
  current_spec_version: number;
  created_at: string;
  updated_at: string;
};
type ArtifactRow = {
  id: string;
  project_id: string;
  kind: string;
  path: string;
  content: string;
  status: string;
  source_spec_version: number;
  checksum: string;
  created_at: string;
  updated_at: string;
};

const SYSTEM_GUARDRAILS = `你是 Prototype Engineer Orchestrator，服务对象是缺少完整电子与软件经验的工业设计师。
ProjectSpec 是唯一需求事实来源。你可以解释、推理和提出候选方案，但不得编造器件引脚、工作电压、电流、
通信地址、价格、库存或兼容性。无法从用户输入确认的工程参数必须明确写成“待确认”“需要查看数据手册”
或“需要用户实物测试”。不要输出内部思维过程，只输出结论、证据来源、风险和下一步。涉及真实硬件时必须
保留人工接线检查、合适驱动器、限流和急停提醒。`;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const timestamp = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const providerForModel = (model: string) => model.startsWith("deterministic") ? "deterministic" : "deepseek";
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function slugify(value: string, id: string) {
  const ascii = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${ascii || "prototype"}-${id.slice(0, 8)}`;
}

function projectView(row: ProjectRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    current_stage: row.current_stage,
    current_spec_version: row.current_spec_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function all<T>(
  env: RuntimeEnvironment,
  sql: string,
  bindings: unknown[] = [],
): Promise<T[]> {
  const result = await env.database.prepare(sql).bind(...bindings).all<T>();
  return (result.results || []) as T[];
}

async function one<T>(
  env: RuntimeEnvironment,
  sql: string,
  bindings: unknown[] = [],
): Promise<T | null> {
  return await env.database.prepare(sql).bind(...bindings).first<T>();
}

async function getProject(
  env: RuntimeEnvironment,
  owner: string,
  projectId: string,
) {
  const row = await one<ProjectRow>(
    env,
    "SELECT * FROM projects WHERE id = ? AND owner = ?",
    [projectId, owner],
  );
  if (!row) throw new ApiError(404, "项目不存在");
  return row;
}

async function getSpec(
  env: RuntimeEnvironment,
  owner: string,
  projectId: string,
): Promise<ProjectSpec> {
  await getProject(env, owner, projectId);
  const row = await one<{ content: string }>(
    env,
    "SELECT content FROM project_versions WHERE project_id = ? AND is_current = 1",
    [projectId],
  );
  if (!row) throw new ApiError(404, "ProjectSpec 不存在");
  return JSON.parse(row.content) as ProjectSpec;
}

async function checksum(content: string) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function upsertArtifacts(
  env: RuntimeEnvironment,
  projectId: string,
  specVersion: number,
  drafts: ArtifactDraft[],
) {
  const oversized = drafts.find(
    (draft) =>
      new TextEncoder().encode(draft.content).length >
      env.assets.maxArtifactBytes,
  );
  if (oversized) {
    throw new ApiError(
      413,
      `生成物 ${oversized.path} 超过托管数据库的单文件限制`,
    );
  }
  const createdAt = timestamp();
  const statements = await Promise.all(drafts.map(async (draft) => {
    const pathParts = draft.path.split(".");
    const kind = pathParts.length > 1 ? pathParts.at(-1)! : "file";
    return env.database.prepare(
      `INSERT INTO artifacts
       (id, project_id, kind, path, content, status, source_spec_version, checksum, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, path) DO UPDATE SET
         kind=excluded.kind, content=excluded.content, status=excluded.status,
         source_spec_version=excluded.source_spec_version, checksum=excluded.checksum,
         updated_at=excluded.updated_at`,
    ).bind(
      uid(), projectId, kind, draft.path, draft.content, draft.status || "GENERATED",
      specVersion, await checksum(draft.content), createdAt, createdAt,
    );
  }));
  if (statements.length) await env.database.batch(statements);
}

async function recordRun(
  env: RuntimeEnvironment,
  projectId: string,
  data: {
    task: string;
    provider: string;
    model: string;
    skill: string;
    input: string;
    result?: string;
    files?: string[];
    error?: string | null;
    usage?: Json;
    requiresConfirmation?: boolean;
  },
) {
  await env.database.prepare(
    `INSERT INTO agent_runs
     (id, project_id, task_name, provider, model_name, skill_name, input_summary,
      result_summary, generated_files, error, token_usage, requires_confirmation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid(), projectId, data.task, data.provider, data.model, data.skill, data.input,
    data.result || "", JSON.stringify(data.files || []), data.error || null,
    JSON.stringify(data.usage || {}), data.requiresConfirmation ? 1 : 0, timestamp(),
  ).run();
}

function modelFor(
  env: RuntimeEnvironment,
  role: "default" | "reasoning" | "coding",
) {
  return env.model.modelFor(role);
}

async function deepSeek(
  env: RuntimeEnvironment,
  messages: Array<{ role: string; content: string }>,
  role: "default" | "reasoning" | "coding",
  jsonMode = false,
  maxTokens = 1200,
) {
  try {
    return await env.model.complete(messages, {
      role,
      jsonMode,
      maxTokens,
    });
  } catch (error) {
    if (error instanceof ModelProviderError) {
      throw new ApiError(error.status, error.message);
    }
    throw error;
  }
}

function parseModelJson<T>(content: string): T {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned) as T; } catch {
    throw new ApiError(502, "DeepSeek 返回的 JSON 不符合预期格式");
  }
}

const planningPhases: ProjectPlan["phases"] = [
  {
    id: "requirements",
    title: "澄清需求",
    description: "识别目标、用户、场景与现实约束，形成可追踪的 ProjectSpec。",
    tool: "Requirement Interpreter",
  },
  {
    id: "architecture",
    title: "规划系统",
    description: "生成模块关系、数据流、控制流与安全状态。",
    tool: "Architecture Generator",
  },
  {
    id: "hardware",
    title: "比较方案",
    description: "给出器件与技术路线候选，未知参数继续标记为待确认。",
    tool: "Hardware & BOM Advisor",
  },
  {
    id: "implementation",
    title: "生成工程",
    description: "生成协议、固件、Python、界面、测试与文档资产。",
    tool: "Engineering Generators",
  },
  {
    id: "validation",
    title: "验证与交付",
    description: "运行确定性静态检查并汇总仍需人工或实物验证的边界。",
    tool: "Deterministic Validators",
  },
];

function fallbackPlanningQuestion(
  id: string,
  field: PlanningQuestion["field"],
  question: string,
  why: string,
  values: Array<[string, string, boolean]>,
): PlanningQuestion {
  return {
    id,
    field,
    question,
    why,
    options: values.map(([value, rationale, recommended]) => ({
      label: value,
      value,
      rationale,
      recommended,
    })),
  };
}

function fallbackProjectPlan(input: { description: string; name?: string }): ProjectPlan {
  const proposedName = input.name?.trim() || input.description.trim().slice(0, 18) || "智能产品原型";
  return {
    proposed_name: proposedName,
    summary: `围绕“${input.description.trim().slice(0, 100)}”建立从需求澄清到工程验证的原型开发计划。`,
    intent: {
      label: "智能产品原型开发",
      confidence: 0.62,
      rationale: "根据用户的产品描述做出的初步意图推测，需要在创建 ProjectSpec 前确认。",
    },
    phases: planningPhases,
    ambiguities: [
      fallbackPlanningQuestion(
        "target-user",
        "target_user",
        "这个产品主要由谁使用？",
        "目标用户会影响交互复杂度、界面表达与验证方式。",
        [
          ["个人用户", "适合以单人日常使用作为第一版假设。", true],
          ["专业人员", "需要更明确的状态反馈、效率与可靠性要求。", false],
          ["团队或公共场景", "需要进一步考虑多人操作、权限与耐久性。", false],
          ["待确认", "先不把未经确认的用户类型写成事实。", false],
        ],
      ),
      fallbackPlanningQuestion(
        "usage-environment",
        "usage_environment",
        "第一版原型主要在哪种环境中验证？",
        "环境会影响供电、结构、防护、无线连接与安全边界。",
        [
          ["室内桌面", "便于低压、有人值守地完成第一轮功能验证。", true],
          ["移动或随身", "后续需要确认尺寸、重量、续航与结构约束。", false],
          ["户外或复杂环境", "需要额外确认温度、防护、供电与可靠性要求。", false],
          ["待确认", "暂时保留为待确认，不进行工程参数推断。", false],
        ],
      ),
      fallbackPlanningQuestion(
        "prototype-level",
        "prototype_level",
        "你希望第一阶段做到什么程度？",
        "完成度决定本轮应生成的资产范围和验证深度。",
        [
          ["功能原型", "优先验证核心交互与工程可行性。", true],
          ["概念验证", "先验证单一关键原理，范围最小。", false],
          ["外观与功能联合原型", "同时考虑结构外观与功能整合，工作量更高。", false],
        ],
      ),
      fallbackPlanningQuestion(
        "controller",
        "preferred_controller",
        "主控方案现在需要指定吗？",
        "未知器件不应被系统直接当成已确认型号。",
        [
          ["由 Agent 推荐", "先根据功能、接口与约束给出多个候选，再由你确认。", true],
          ["暂不指定", "在系统架构确定前保持待确认。", false],
          ["我已有主控", "创建后通过对话告诉 Agent 现有型号与来源。", false],
        ],
      ),
    ],
    assumptions: [
      "第一版按低压、有人值守的功能原型规划。",
      "未明确的电压、电流、引脚、型号、价格和兼容性均保持待确认。",
    ],
    draft: {
      name: proposedName,
      description: input.description.trim(),
      target_user: "待确认",
      usage_environment: "待确认",
      experience_level: "初学者",
      preferred_controller: "由 Agent 推荐",
      communication_preference: "由 Agent 推荐",
      prototype_level: "功能原型",
      avoid_custom_pcb: true,
      data_collection_required: true,
      machine_learning_required: false,
      control_interface_required: true,
    },
  };
}

function normalizeProjectPlan(
  input: { description: string; name?: string },
  value: Partial<ProjectPlan>,
): ProjectPlan {
  const fallback = fallbackProjectPlan(input);
  const proposedName = typeof value.proposed_name === "string" && value.proposed_name.trim()
    ? value.proposed_name.trim().slice(0, 120)
    : fallback.proposed_name;
  const ambiguities = Array.isArray(value.ambiguities)
    ? value.ambiguities.slice(0, 4).flatMap((question, index) => {
        if (!question || typeof question.question !== "string" || !Array.isArray(question.options)) return [];
        const field = question.field;
        const allowedFields: PlanningQuestion["field"][] = [
          "target_user", "usage_environment", "prototype_level",
          "preferred_controller", "communication_preference",
        ];
        if (!allowedFields.includes(field)) return [];
        const options = question.options.slice(0, 4).flatMap((option) => {
          if (!option || typeof option.value !== "string" || !option.value.trim()) return [];
          const label = typeof option.label === "string" && option.label.trim()
            ? option.label.trim().slice(0, 80)
            : option.value.trim().slice(0, 80);
          return [{
            label,
            value: label,
            rationale: typeof option.rationale === "string"
              ? option.rationale.trim().slice(0, 300)
              : "这是一个待用户确认的推测。",
            recommended: option.recommended === true,
          }];
        });
        if (options.length < 2) return [];
        if (!options.some((option) => option.recommended)) options[0].recommended = true;
        return [{
          id: typeof question.id === "string" && question.id.trim()
            ? question.id.trim().slice(0, 80)
            : `ambiguity-${index + 1}`,
          field,
          question: question.question.trim().slice(0, 240),
          why: typeof question.why === "string"
            ? question.why.trim().slice(0, 400)
            : "该信息会影响后续工程方案。",
          options,
        }];
      })
    : [];
  const draftSource = value.draft && typeof value.draft === "object" ? value.draft : {};
  return {
    proposed_name: proposedName,
    summary: typeof value.summary === "string" && value.summary.trim()
      ? value.summary.trim().slice(0, 1000)
      : fallback.summary,
    intent: {
      label: typeof value.intent?.label === "string" && value.intent.label.trim()
        ? value.intent.label.trim().slice(0, 120)
        : fallback.intent.label,
      confidence: typeof value.intent?.confidence === "number"
        ? Math.min(1, Math.max(0, value.intent.confidence))
        : fallback.intent.confidence,
      rationale: typeof value.intent?.rationale === "string" && value.intent.rationale.trim()
        ? value.intent.rationale.trim().slice(0, 500)
        : fallback.intent.rationale,
    },
    phases: planningPhases,
    ambiguities: ambiguities.length ? ambiguities : fallback.ambiguities,
    assumptions: Array.isArray(value.assumptions)
      ? value.assumptions.filter((item): item is string => typeof item === "string").slice(0, 6)
      : fallback.assumptions,
    draft: {
      ...fallback.draft,
      ...draftSource,
      name: proposedName,
      description: input.description.trim(),
    },
  };
}

async function planProject(
  env: RuntimeEnvironment,
  input: { description: string; name?: string },
) {
  const fallback = fallbackProjectPlan(input);
  if (!env.model.configured) {
    return { plan: fallback, model: "deterministic-fallback", usage: {} };
  }
  const prompt = `把用户的模糊产品想法整理为一个“确认后才执行”的智能产品原型计划。
只返回 JSON，包含 proposed_name,summary,intent,ambiguities,assumptions,draft。
intent 必须包含 label,confidence(0-1),rationale。
ambiguities 最多 4 个，每个包含 id,field,question,why,options；field 只能是
target_user,usage_environment,prototype_level,preferred_controller,communication_preference。
每个 options 提供 2-4 个推测选择，包含 label,value,rationale,recommended，恰好一个 recommended=true。
这些只是推测，不得表述为用户事实。不得编造具体器件参数、价格、库存、引脚、电压、电流或兼容性。
不要主动推荐或猜测预算数字；预算只能来自用户明确输入。
draft 使用 ProjectCreateInput 字段，只填产品层信息；未知字段写“待确认”或“由 Agent 推荐”。

用户给出的名称：${input.name?.trim() || "未指定"}
用户描述：${input.description.trim()}`;
  try {
    const output = await deepSeek(
      env,
      [{ role: "system", content: SYSTEM_GUARDRAILS }, { role: "user", content: prompt }],
      "reasoning",
      true,
      3200,
    );
    return {
      plan: normalizeProjectPlan(input, parseModelJson<Partial<ProjectPlan>>(output.content)),
      model: output.model,
      usage: output.usage,
    };
  } catch (error) {
    return {
      plan: fallback,
      model: "deterministic-fallback-after-error",
      usage: {},
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

function fallbackExtraction(input: ProjectCreateInput): RequirementExtraction {
  return {
    product_goal: `验证“${input.name}”的核心交互和工程可行性`,
    target_user: input.target_user || "待确认",
    usage_environment: input.usage_environment || "待确认",
    usage_process: [],
    user_actions: [],
    system_inputs: [],
    system_outputs: [],
    feedback_methods: [],
    abnormal_conditions: ["传感器断开", "通信超时", "执行器异常"],
    functional_modules: ["感知输入", "状态处理", "反馈输出", "通信与日志"],
    data_flow: ["输入 → 主控 → 输出／通信"],
    control_flow: ["初始化 → 自检 → 待机 → 交互 → 故障安全"],
    states: ["BOOT", "SELF_TEST", "IDLE", "ACTIVE", "ERROR"],
    safety_states: ["SAFE_STOP"],
    preferred_controller: input.preferred_controller || "待确认",
    assumptions: ["第一版采用低压、有人值守的功能原型"],
    must_confirm_questions: ["具体传感器、执行器和供电约束是什么？"],
    safety_flags: [],
  };
}

async function interpretRequirements(
  env: RuntimeEnvironment,
  input: ProjectCreateInput,
) {
  const prompt = `把以下纯文字产品概念解析为 JSON。只提取或合理推断产品层需求，不得填写未经数据手册验证的器件参数。
只返回一个 JSON 对象，必须包含这些键：
product_goal,target_user,usage_environment,usage_process,user_actions,system_inputs,system_outputs,
feedback_methods,abnormal_conditions,functional_modules,data_flow,control_flow,states,safety_states,
preferred_controller,assumptions,must_confirm_questions,safety_flags。
所有复数键必须是字符串数组。关键澄清问题最多 5 个。

项目名称：${input.name}
产品描述：${input.description}
目标用户：${input.target_user || "待确认"}
使用环境：${input.usage_environment || "待确认"}
预算：${input.budget_cny ?? "待确认"}
经验：${input.experience_level || "初学者"}
主控偏好：${input.preferred_controller || "由 Agent 推荐"}
通信偏好：${input.communication_preference || "USB 串口"}
已有硬件：${(input.existing_components || []).join("、") || "无"}
尺寸限制：${input.size_constraints || "待确认"}
供电限制：${input.power_constraints || "待确认"}`;
  if (!env.model.configured) {
    return { extraction: fallbackExtraction(input), model: "deterministic-fallback", usage: {} };
  }
  let output;
  try {
    output = await deepSeek(
      env,
      [{ role: "system", content: SYSTEM_GUARDRAILS }, { role: "user", content: prompt }],
      "default",
      true,
      1600,
    );
  } catch (error) {
    return {
      extraction: fallbackExtraction(input),
      model: "deterministic-fallback-after-error",
      usage: {},
      warning: error instanceof Error ? error.message : String(error),
    };
  }
  const parsed = parseModelJson<RequirementExtraction>(output.content);
  const extraction = { ...fallbackExtraction(input), ...parsed };
  const arrayKeys: Array<keyof RequirementExtraction> = [
    "usage_process", "user_actions", "system_inputs", "system_outputs", "feedback_methods",
    "abnormal_conditions", "functional_modules", "data_flow", "control_flow", "states",
    "safety_states", "assumptions", "must_confirm_questions", "safety_flags",
  ];
  for (const key of arrayKeys) {
    if (!Array.isArray(extraction[key])) (extraction as unknown as Json)[key] = [];
  }
  if (input.budget_cny === undefined) {
    extraction.assumptions = extraction.assumptions.filter(
      (item) => !/(?:预算|成本|价格).{0,24}\d/i.test(item),
    );
  }
  return { extraction, model: output.model, usage: output.usage };
}

type ComponentCandidate = {
  name: string;
  category: string;
  fit_reason: string;
  tradeoffs: string;
  verification_required: string[];
  recommended: boolean;
};

type ComponentRecommendationSet = {
  question: string;
  candidates: ComponentCandidate[];
  disclaimer: string;
};

const sensitiveEngineeringClaim = /(?:电压|电流|功率|逻辑电平|阈值|引脚|gpio|i²c|i2c|地址|兼容|供电能力|额定|峰值|库存|价格|直驱|直接驱动|电平转换|(?:esp32|arduino|树莓派|raspberry).{0,24}(?:支持|驱动|兼容|可用)|\d+(?:\.\d+)?\s*(?:v|ma|a|w|hz|khz|mhz|ω|ohm|%))/i;

function sanitizeRecommendationNarrative(value: string) {
  const safe = value
    .split(/[。；;]\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !sensitiveEngineeringClaim.test(sentence))
    .join("；");
  return safe || "与当前原型的适配方向可供比较；具体电气参数和兼容性需要查看正式数据手册并进行实物测试。";
}

function normalizeVerificationItem(value: string) {
  const lower = value.toLowerCase();
  if (/(电压|供电|逻辑电平|阈值)/.test(lower)) return "工作电压与逻辑电平：查看正式数据手册";
  if (/(电流|功率|温升|额定|峰值)/.test(lower)) return "持续／峰值电流、功率与温升：查看数据手册并实测";
  if (/(引脚|gpio|i²c|i2c|spi|uart|接口|协议|兼容)/.test(lower)) return "接口、引脚、协议与主控兼容性：查看双方正式数据手册";
  if (/(尺寸|安装|机械|公差)/.test(lower)) return "机械尺寸、安装方式与公差：查看图纸并进行实物测试";
  if (/(寿命|耐久|连续运行|噪声)/.test(lower)) return "寿命、耐久、连续运行与噪声：需要用户实物测试";
  return sensitiveEngineeringClaim.test(value)
    ? "具体参数：查看正式数据手册并进行实物测试"
    : value.trim().slice(0, 180);
}

async function recommendComponents(
  env: RuntimeEnvironment,
  spec: ProjectSpec,
  question: string,
) {
  if (!env.model.configured) {
    throw new ApiError(503, "站点尚未配置 DeepSeek，无法生成元件候选");
  }
  const prompt = `基于当前 ProjectSpec，为下面的待确认问题给出恰好 3 个元件或技术方案候选。
优先给出明确、常见的具体型号或产品系列，让工业设计师可以进行选择；但绝对不得编造引脚、
工作电压、电流、I²C 地址、价格、库存或兼容性。每个候选只能包含：
name（型号或系列）、category、fit_reason、tradeoffs、verification_required（字符串数组）、
recommended（布尔值）。只能有一个 recommended=true。
所有未验证参数必须放入 verification_required，明确需要查看正式数据手册或实物测试。
只返回 JSON：{"question":"...","candidates":[...],"disclaimer":"..."}。

待确认问题：${question}
当前 ProjectSpec：${JSON.stringify(spec)}`;
  const output = await deepSeek(
    env,
    [{ role: "system", content: SYSTEM_GUARDRAILS }, { role: "user", content: prompt }],
    "default",
    true,
    1800,
  );
  const parsed = parseModelJson<ComponentRecommendationSet>(output.content);
  if (!Array.isArray(parsed.candidates) || parsed.candidates.length !== 3) {
    throw new ApiError(502, "DeepSeek 未返回 3 个有效候选方案");
  }
  const candidates = parsed.candidates.map((candidate, index) => {
    if (
      !candidate || typeof candidate.name !== "string" || candidate.name.trim().length < 2
      || typeof candidate.category !== "string" || typeof candidate.fit_reason !== "string"
      || typeof candidate.tradeoffs !== "string"
      || !Array.isArray(candidate.verification_required)
    ) {
      throw new ApiError(502, `DeepSeek 返回的第 ${index + 1} 个候选不完整`);
    }
    const verification = [...new Set(candidate.verification_required
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map(normalizeVerificationItem))]
      .slice(0, 8);
    return {
      name: candidate.name.trim().slice(0, 160),
      category: candidate.category.trim().slice(0, 80),
      fit_reason: sanitizeRecommendationNarrative(candidate.fit_reason).slice(0, 600),
      tradeoffs: sanitizeRecommendationNarrative(candidate.tradeoffs).slice(0, 600),
      verification_required: verification.length
        ? verification
        : ["型号、关键参数与兼容性：查看正式数据手册并进行实物测试"],
      recommended: Boolean(candidate.recommended),
    };
  });
  const preferred = candidates.findIndex((candidate) => candidate.recommended);
  candidates.forEach((candidate, index) => {
    candidate.recommended = index === (preferred >= 0 ? preferred : 0);
  });
  return {
    recommendations: {
      question,
      candidates,
      disclaimer: typeof parsed.disclaimer === "string" && parsed.disclaimer.trim()
        ? parsed.disclaimer.trim().slice(0, 600)
        : "候选仅用于方案比较；选择前必须查看正式数据手册并进行实物测试。",
    },
    model: output.model,
    usage: output.usage,
  };
}

function affectedModules(message: string) {
  const rules: Array<[string[], string[]]> = [
    [["主控", "esp32", "raspberry", "arduino", "树莓派"], ["ProjectSpec", "硬件选型", "GPIO", "电压", "通信协议", "固件", "电源", "BOM", "接线", "测试", "README"]],
    [["预算", "元以内", "成本"], ["ProjectSpec", "BOM", "替代方案", "工程摘要"]],
    [["舵机", "电机", "执行器", "步进"], ["ProjectSpec", "执行器", "驱动器", "BOM", "电源预算", "接线", "固件", "安全测试"]],
    [["协议", "波特率", "串口"], ["ProjectSpec", "协议 Schema", "固件", "Python", "文档", "协议测试"]],
    [["机器学习", "模型", "训练"], ["ProjectSpec", "数据采集", "特征", "训练", "推理", "测试"]],
  ];
  const lower = message.toLowerCase();
  const output = rules.flatMap(([keys, modules]) => keys.some((key) => lower.includes(key)) ? modules : []);
  return [...new Set(output.length ? output : ["ProjectSpec", "需求文档", "测试计划"])];
}

function fallbackConversationIntent(message: string) {
  const lower = message.toLowerCase();
  if (/(规划|下一步|从哪里开始|先做什么)/i.test(lower)) {
    return { label: "规划项目下一步", confidence: 0.82, rationale: "消息明确要求梳理推进顺序，而不是立即执行修改。" };
  }
  if (/(生成|创建|输出|写).*(架构|硬件|bom|接线|协议|固件|python|界面|测试|文档)/i.test(lower)) {
    return { label: "生成工程资产", confidence: 0.78, rationale: "消息包含生成动作与具体工程模块。" };
  }
  if (/(验证|检查|测试|编译)/i.test(lower)) {
    return { label: "执行工程验证", confidence: 0.78, rationale: "消息包含验证、检查或测试意图。" };
  }
  if (/(改|调整|增加|删除|预算|用户|场景|主控|需要|不需要)/i.test(lower)) {
    return { label: "修改产品需求", confidence: 0.72, rationale: "消息可能改变 ProjectSpec 或派生工程资产。" };
  }
  return { label: "咨询当前方案", confidence: 0.58, rationale: "暂未识别到明确执行动作，先作为工程咨询处理。" };
}

function inferredToolCalls(message: string, shouldUpdateSpec: boolean): NonNullable<RequirementChange["suggested_tools"]> {
  const tools: NonNullable<RequirementChange["suggested_tools"]> = [];
  if (shouldUpdateSpec) {
    tools.push({
      id: "confirm-spec-change",
      label: "确认并更新 ProjectSpec",
      description: "确认后创建新的 ProjectSpec 版本，并标记受影响模块。",
      action: "confirm_spec",
      requires_confirmation: true,
    });
  }
  const moduleRules: Array<[RegExp, string, string]> = [
    [/架构|系统流程|状态机/i, "architecture", "生成系统架构"],
    [/硬件|器件|元件|选型|接线/i, "hardware", "生成硬件方案"],
    [/\bbom\b|物料|成本/i, "bom", "生成 BOM"],
    [/协议|通信/i, "protocol", "生成通信协议"],
    [/固件|platformio/i, "firmware", "生成固件代码"],
    [/python|数据采集|训练|推理/i, "python", "生成 Python 工程"],
    [/界面|控制面板|ui/i, "ui", "生成控制界面"],
    [/测试计划|测试用例|验收/i, "tests", "生成测试资产"],
    [/文档|说明书|报告/i, "docs", "生成项目文档"],
  ];
  const matchedModule = moduleRules.find(([pattern]) => pattern.test(message));
  if (matchedModule && /(生成|创建|输出|写|继续)/i.test(message)) {
    tools.push({
      id: `generate-${matchedModule[1]}`,
      label: matchedModule[2],
      description: "基于当前已确认的 ProjectSpec 生成对应工程文件，结果仍需用户确认。",
      action: "generate",
      target: matchedModule[1],
      requires_confirmation: true,
    });
  }
  if (/(验证|检查|测试|编译)/i.test(message)) {
    const target = /协议/i.test(message) ? "protocol" : /硬件|电源|引脚|接线/i.test(message) ? "hardware" : "code";
    tools.push({
      id: `validate-${target}`,
      label: target === "protocol" ? "验证通信协议" : target === "hardware" ? "验证硬件约束" : "运行代码静态验证",
      description: "执行确定性检查；云端不会伪装运行 Python、PlatformIO 或真实硬件。",
      action: "validate",
      target,
      requires_confirmation: false,
    });
  }
  if (/(规划|下一步|从哪里开始|先做什么)/i.test(message)) {
    tools.push({
      id: "open-requirements",
      label: "查看需求澄清队列",
      description: "打开当前 ProjectSpec 的待确认项，先解决会阻塞后续架构和选型的问题。",
      action: "open_section",
      target: "需求",
      requires_confirmation: false,
    });
  }
  return tools.slice(0, 3);
}

function normalizeRequirementChange(
  change: RequirementChange,
  message: string,
  modules: string[],
): RequirementChange {
  const fallbackIntent = fallbackConversationIntent(message);
  const modelSuggestions = Array.isArray(change.suggestions)
    ? change.suggestions.slice(0, 4).flatMap((item) => {
        if (!item || typeof item.value !== "string" || !item.value.trim()) return [];
        return [{
          label: typeof item.label === "string" && item.label.trim()
            ? item.label.trim().slice(0, 100)
            : item.value.trim().slice(0, 100),
          value: item.value.trim().slice(0, 500),
          rationale: typeof item.rationale === "string"
            ? item.rationale.trim().slice(0, 500)
            : "这是 Agent 对模糊意图的推测，需要用户确认。",
          recommended: item.recommended === true,
        }];
      })
    : [];
  const suggestions = modelSuggestions.length
    ? modelSuggestions
    : /(规划|下一步|从哪里开始|先做什么)/i.test(message)
      ? [
          {
            label: "先确认感知目标",
            value: "先确认产品需要感知的现象、安装位置和不可接受的采集方式；具体传感器型号稍后比较。",
            rationale: "输入定义不清会直接影响架构、器件类型、数据处理和测试方法。",
            recommended: true,
          },
          {
            label: "先确认反馈方式",
            value: "先确认提醒希望采用灯光、声音、触觉还是界面，以及哪些方式不能接受。",
            rationale: "反馈方式会影响交互、执行器、电源和安全要求。",
            recommended: false,
          },
          {
            label: "先确认使用边界",
            value: "先确认使用环境、供电条件、尺寸和是否需要随身移动。",
            rationale: "现实约束会缩小硬件和结构方案范围。",
            recommended: false,
          },
        ]
      : [];
  if (suggestions.length && !suggestions.some((item) => item.recommended)) {
    suggestions[0].recommended = true;
  }
  const inferred = inferredToolCalls(message, change.should_update_spec === true);
  const allowedActions = new Set(["confirm_spec", "generate", "validate", "open_section"]);
  const allowedGenerateTargets = new Set([
    "architecture", "hardware", "bom", "protocol", "firmware", "python", "ui", "tests", "docs",
  ]);
  const allowedValidateTargets = new Set(["hardware", "protocol", "code"]);
  const allowedSectionTargets = new Set([
    "项目概览", "需求", "系统架构", "硬件方案", "BOM", "接线", "通信协议",
    "固件代码", "Python 程序", "控制界面", "测试", "文档", "验证记录",
    ...allowedGenerateTargets,
  ]);
  const suggestedTools = Array.isArray(change.suggested_tools)
    ? change.suggested_tools.slice(0, 3).flatMap((item) => {
        if (!item || !allowedActions.has(item.action) || typeof item.label !== "string") return [];
        if (item.action === "confirm_spec" && change.should_update_spec !== true) return [];
        if (item.action === "generate" && !allowedGenerateTargets.has(item.target || "")) return [];
        if (item.action === "validate" && !allowedValidateTargets.has(item.target || "")) return [];
        if (item.action === "open_section" && !allowedSectionTargets.has(item.target || "")) return [];
        return [{
          id: typeof item.id === "string" && item.id.trim()
            ? item.id.trim().slice(0, 100)
            : `tool-${crypto.randomUUID().slice(0, 8)}`,
          label: item.label.trim().slice(0, 120),
          description: typeof item.description === "string"
            ? item.description.trim().slice(0, 500)
            : "执行前请确认该工具与当前目标一致。",
          action: item.action,
          target: typeof item.target === "string" ? item.target.trim().slice(0, 80) : undefined,
          requires_confirmation: item.requires_confirmation !== false,
        }];
      })
    : [];
  const mergedTools = [...inferred];
  for (const tool of suggestedTools) {
    if (!mergedTools.some((item) => item.action === tool.action && item.target === tool.target)) {
      mergedTools.push(tool);
    }
  }
  return {
    ...change,
    reply: typeof change.reply === "string" && change.reply.trim()
      ? change.reply.trim().slice(0, 4000)
      : "我已分析你的意图，请先核对推测和计划，再决定是否执行。",
    should_update_spec: change.should_update_spec === true,
    affected_modules: [...new Set([...(change.affected_modules || []), ...modules])],
    requires_confirmation: change.requires_confirmation !== false,
    intent: {
      label: typeof change.intent?.label === "string" && change.intent.label.trim()
        ? change.intent.label.trim().slice(0, 120)
        : fallbackIntent.label,
      confidence: typeof change.intent?.confidence === "number"
        ? Math.min(1, Math.max(0, change.intent.confidence))
        : fallbackIntent.confidence,
      rationale: typeof change.intent?.rationale === "string" && change.intent.rationale.trim()
        ? change.intent.rationale.trim().slice(0, 500)
        : fallbackIntent.rationale,
    },
    ambiguous: change.ambiguous === true || suggestions.length > 0,
    suggestions,
    suggested_tools: mergedTools.slice(0, 3),
    next_question: typeof change.next_question === "string" && change.next_question.trim()
      ? change.next_question.trim().slice(0, 500)
      : suggestions[0]?.value,
  };
}

function userTraced<T>(value: T, message: string): Traced<T> {
  return {
    value, source: "user_provided", confidence: 1, verification_status: "USER_CONFIRMED",
    notes: `来自用户项目消息：${message.slice(0, 240)}`,
  };
}

function applyChange(spec: ProjectSpec, change: RequirementChange, message: string) {
  const updated = structuredClone(spec);
  if (change.product_goal) updated.project.product_goal = userTraced(change.product_goal, message);
  if (change.target_user) updated.user.target_user = userTraced(change.target_user, message);
  if (change.usage_environment) updated.scenario.usage_environment = userTraced(change.usage_environment, message);
  if (typeof change.budget_cny === "number" && change.budget_cny > 0) {
    updated.constraints.budget_cny = userTraced<number | null>(change.budget_cny, message);
  }
  if (change.preferred_controller) {
    updated.hardware.preferred_controller = userTraced(change.preferred_controller, message);
    if (updated.hardware.controllers[0]) {
      updated.hardware.controllers[0].model = userTraced(change.preferred_controller, message);
      updated.hardware.controllers[0].pins = {};
      updated.hardware.controllers[0].operating_voltage.value = null;
      updated.hardware.controllers[0].logic_voltage.value = null;
      updated.hardware.controllers[0].max_current_ma.value = null;
    }
  }
  const booleanChanges = [
    ["data_collection_required", change.data_collection_required],
    ["machine_learning_required", change.machine_learning_required],
    ["control_interface_required", change.control_interface_required],
  ] as const;
  for (const [field, value] of booleanChanges) {
    if (typeof value === "boolean") updated.software[field] = userTraced(value, message);
  }
  const resolved = change.resolved_open_questions || [];
  updated.open_questions = updated.open_questions.filter(
    (item) => !resolved.some((key) => item.value.includes(key)),
  );
  const existing = new Set(updated.open_questions.map((item) => item.value));
  for (const question of change.add_open_questions || []) {
    if (!existing.has(question)) updated.open_questions.push({
      value: question, source: "agent_recommendation", confidence: 0.85,
      verification_status: "NEEDS_CONFIRMATION", notes: "由本次需求修改产生",
    });
  }
  updated.project.updated_at = timestamp();
  updated.project.status = "NEEDS_CONFIRMATION";
  updated.verification.requirement_status = "NEEDS_CONFIRMATION";
  return updated;
}

type RequirementConfirmation = {
  field?: string;
  value?: string | number;
  question_index?: number;
  answer?: string;
};

function applyRequirementConfirmation(spec: ProjectSpec, payload: RequirementConfirmation) {
  const updated = structuredClone(spec);
  let reason = "";
  let modules: string[] = [];

  if (payload.field) {
    const text = typeof payload.value === "string" ? payload.value.trim() : "";
    switch (payload.field) {
      case "project.product_goal":
        if (!text) throw new ApiError(422, "产品目标不能为空");
        updated.project.product_goal = userTraced(text, "需求页字段确认");
        modules = ["ProjectSpec", "系统架构", "测试", "文档"];
        reason = "确认需求字段：产品目标";
        break;
      case "user.target_user":
        if (!text) throw new ApiError(422, "目标用户不能为空");
        updated.user.target_user = userTraced(text, "需求页字段确认");
        modules = ["ProjectSpec", "系统架构", "控制界面", "测试", "文档"];
        reason = "确认需求字段：目标用户";
        break;
      case "scenario.usage_environment":
        if (!text) throw new ApiError(422, "使用环境不能为空");
        updated.scenario.usage_environment = userTraced(text, "需求页字段确认");
        modules = ["ProjectSpec", "系统架构", "硬件选型", "测试", "文档"];
        reason = "确认需求字段：使用环境";
        break;
      case "hardware.preferred_controller":
        if (!text) throw new ApiError(422, "主控偏好不能为空");
        updated.hardware.preferred_controller = userTraced(text, "需求页字段确认");
        if (updated.hardware.controllers[0]) {
          updated.hardware.controllers[0].model = userTraced(text, "需求页字段确认");
          updated.hardware.controllers[0].pins = {};
          updated.hardware.controllers[0].operating_voltage.value = null;
          updated.hardware.controllers[0].logic_voltage.value = null;
          updated.hardware.controllers[0].max_current_ma.value = null;
        }
        modules = affectedModules(`主控 ${text}`);
        reason = "确认需求字段：主控偏好";
        break;
      case "constraints.budget_cny": {
        const budget = Number(payload.value);
        if (!Number.isFinite(budget) || budget <= 0) throw new ApiError(422, "预算必须是大于零的数字");
        updated.constraints.budget_cny = userTraced<number | null>(budget, "需求页字段确认");
        modules = affectedModules(`预算 ${budget} 元`);
        reason = "确认需求字段：预算";
        break;
      }
      case "project.prototype_level":
        if (!text) throw new ApiError(422, "原型等级不能为空");
        updated.project.prototype_level = userTraced(text, "需求页字段确认");
        modules = ["ProjectSpec", "系统架构", "硬件选型", "固件", "Python", "控制界面", "测试", "文档"];
        reason = "确认需求字段：原型等级";
        break;
      default:
        throw new ApiError(422, "不支持确认该需求字段");
    }
  } else if (Number.isInteger(payload.question_index)) {
    const index = payload.question_index as number;
    const answer = payload.answer?.trim() || "";
    if (!answer) throw new ApiError(422, "确认回答不能为空");
    const question = updated.open_questions[index];
    if (!question) throw new ApiError(404, "待确认问题不存在");
    if (question.verification_status === "USER_CONFIRMED") throw new ApiError(409, "该问题已经确认");
    updated.open_questions[index] = {
      value: question.value,
      source: "user_provided",
      confidence: 1,
      verification_status: "USER_CONFIRMED",
      notes: `用户回答：${answer}`,
    };
    modules = affectedModules(`${question.value} ${answer}`);
    reason = `确认需求问题：${question.value.slice(0, 80)}`;
  } else {
    throw new ApiError(422, "必须指定待确认字段或问题");
  }

  const hasPendingQuestion = updated.open_questions.some(
    (item) => item.verification_status !== "USER_CONFIRMED",
  );
  updated.project.updated_at = timestamp();
  updated.project.status = hasPendingQuestion ? "NEEDS_CONFIRMATION" : "SPEC_VERIFIED";
  updated.verification.requirement_status = hasPendingQuestion ? "NEEDS_CONFIRMATION" : "SPEC_VERIFIED";
  return { updated, reason, modules: [...new Set(modules)] };
}

async function analyzeMessage(
  env: RuntimeEnvironment,
  spec: ProjectSpec,
  message: string,
  modules: string[],
) {
  if (!env.model.configured) {
    return {
      change: normalizeRequirementChange({
        reply: `已分析该消息，预计影响：${modules.join("、")}。站点尚未配置 DeepSeek，因此没有自动修改 ProjectSpec。`,
        should_update_spec: false,
        affected_modules: modules,
        requires_confirmation: true,
      }, message, modules),
      model: "deterministic-fallback",
      usage: {},
    };
  }
  try {
    const output = await deepSeek(
      env,
      [
        { role: "system", content: SYSTEM_GUARDRAILS },
        {
          role: "system",
          content: `只能通过给定字段提出有限的 ProjectSpec 修改。只返回 JSON：
reply,should_update_spec,product_goal,target_user,usage_environment,budget_cny,preferred_controller,
data_collection_required,machine_learning_required,control_interface_required,add_open_questions,
resolved_open_questions,affected_modules,requires_confirmation,intent,ambiguous,suggestions,suggested_tools,next_question。
intent 包含 label,confidence,rationale。遇到模糊意图时 ambiguous=true，并在 suggestions 中给出 2-4 个推测，
每项包含 label,value,rationale,recommended，恰好一个 recommended=true。
suggested_tools 只能使用 confirm_spec,generate,validate,open_section 四种 action，包含 id,label,description,
action,target,requires_confirmation。没有明确修改意图或用户明确说“不修改”时 should_update_spec=false。
不要直接声称工具已经执行，只能提出下一步工具计划。`,
        },
        {
          role: "user",
          content: `当前 ProjectSpec：${JSON.stringify(spec)}\n用户消息：${message}\n程序判断受影响模块：${modules.join("、")}`,
        },
      ],
      "default",
      true,
      1200,
    );
    return {
      change: normalizeRequirementChange(
        parseModelJson<RequirementChange>(output.content),
        message,
        modules,
      ),
      model: output.model,
      usage: output.usage,
    };
  } catch (error) {
    return {
      change: normalizeRequirementChange({
        reply: `DeepSeek 本次暂不可用，已保留消息且未修改 ProjectSpec。预计影响：${modules.join("、")}。`,
        should_update_spec: false,
        affected_modules: modules,
        requires_confirmation: true,
      }, message, modules),
      model: "deterministic-fallback-after-error",
      usage: {},
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

async function saveVersion(
  env: RuntimeEnvironment,
  project: ProjectRow,
  spec: ProjectSpec,
  reason: string,
  modules: string[],
) {
  const version = project.current_spec_version + 1;
  await env.database.batch([
    env.database.prepare("UPDATE project_versions SET is_current = 0 WHERE project_id = ?").bind(project.id),
    env.database.prepare(
      `INSERT INTO project_versions
       (id, project_id, version, content, reason, affected_modules, is_current, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(uid(), project.id, version, JSON.stringify(spec), reason, JSON.stringify(modules), timestamp()),
    env.database.prepare(
      "UPDATE projects SET current_spec_version = ?, status = ?, updated_at = ? WHERE id = ?",
    ).bind(version, spec.project.status, timestamp(), project.id),
    env.database.prepare(
      "UPDATE artifacts SET status = 'NEEDS_CONFIRMATION', updated_at = ? WHERE project_id = ?",
    ).bind(timestamp(), project.id),
  ]);
  const requirementDrafts = generateArtifacts(spec, project.description, version).filter(
    (draft) => draft.path.startsWith("01_requirements/"),
  );
  await upsertArtifacts(env, project.id, version, requirementDrafts);
  return version;
}

function moduleTask(module: string) {
  const tasks: Record<string, string> = {
    architecture: "输入—处理—输出、数据流、控制流、状态机、异常与安全状态",
    hardware: "主控、传感器、执行器、驱动、电源、通信候选和核对清单",
    bom: "BOM 完整性、预算风险、替代方向与所有待确认价格",
    protocol: "USB 串口 JSONL 协议、超时、重试、错误码和双端一致性",
    firmware: "ESP32 PlatformIO 固件结构、状态机、日志、错误处理和编译验证建议",
    python: "采集、存储、清洗、训练、推理和串口控制程序",
    ui: "项目控制界面的信息架构、安全操作和状态反馈",
    tests: "单元、模块、集成、首次上电、安全、连续运行和异常测试",
    docs: "安装、接线、运行、调试、故障排查和二次开发文档",
    all: "从需求到工程验证的总体工程分析、阻塞项和下一步",
  };
  return tasks[module];
}

const moduleArtifactPath: Record<string, string> = {
  architecture: "02_architecture/agent-analysis.md",
  hardware: "03_hardware/agent-analysis.md",
  bom: "03_hardware/agent-bom-review.md",
  protocol: "07_protocol/agent-analysis.md",
  firmware: "04_firmware/AGENT-GENERATION-NOTES.md",
  python: "05_python/AGENT-GENERATION-NOTES.md",
  ui: "06_interface/agent-analysis.md",
  tests: "08_testing/agent-test-analysis.md",
  docs: "09_reports/agent-documentation-analysis.md",
  all: "09_reports/agent-engineering-analysis.md",
};

function modelIntegrityViolations(content: string) {
  const checks: Array<[string, RegExp]> = [
    ["未经核对的电气数值", /\b\d+(?:\.\d+)?\s*(?:k?Ω|ohms?|m?A|V|W|Hz)\b/i],
    ["未经核对的引脚或地址", /\b(?:GPIO|PIN|I2C|I²C)\s*[-:#]?\s*(?:0x)?[0-9A-F]+\b/i],
    ["未经核对的价格或库存", /(?:¥|￥)\s*\d+|\d+(?:\.\d+)?\s*元|库存(?:充足|有货)|远低于.*预算/i],
    ["未经 ProjectSpec 确认的具体器件候选", /\b(?:SSD\d{3,}|ST\d{3,}|DevKitC-\d|MPU\d{3,}|BME\d{3,})\b/i],
    ["未经证据支持的兼容性断言", /(?:拥有充足|足以驱动|完全兼容|可直接连接|典型值为|典型值\s*\d)/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(content)).map(([label]) => label);
}

function safeModuleAnalysis(spec: ProjectSpec, moduleName: string, violations: string[]) {
  const confirmed = [
    `项目：${spec.project.name.value}`,
    `目标：${spec.project.product_goal.value}`,
    `原型等级：${spec.project.prototype_level.value}`,
    `主控偏好：${spec.hardware.preferred_controller.value}`,
    `通信偏好：${spec.hardware.communication.transport.value}`,
    `预算上限：${spec.constraints.budget_cny.value === null ? "待确认" : `¥${spec.constraints.budget_cny.value}`}`,
  ];
  const questions = spec.open_questions.map((item) => `- ${item.value}`).join("\n") || "- 当前没有开放问题";
  return `# ${moduleName} 工程分析

> DeepSeek 草稿已经过工程诚信检查。检测到：${violations.join("、")}。不安全的原始断言未写入工程资产。

## 当前 ProjectSpec 中的已知输入

${confirmed.map((item) => `- ${item}`).join("\n")}

以上条目仍应以各字段的 source、confidence 与 verification_status 为准。

## 待确认信息

${questions}

## 安全的下一步

1. 确认具体器件型号后查阅制造商正式数据手册。
2. 将电压、电流、引脚、地址、尺寸、价格和兼容性证据写回新的 ProjectSpec 版本。
3. 重新生成受影响模块，再执行硬件规则、协议一致性和代码检查。
4. 首次上电前人工核对接线；大电流或运动负载必须使用合适驱动与急停。

当前报告不代表 Python、PlatformIO 或实物测试已经通过。
`;
}

async function generateModuleAnalysis(
  env: RuntimeEnvironment,
  spec: ProjectSpec,
  module: string,
) {
  if (!env.model.configured) {
    return {
      content: `# ${module} 分析\n\n站点尚未配置 DeepSeek。确定性工程文件已经生成；模型分析暂不可用。\n`,
      model: "deterministic-fallback",
      usage: {},
    };
  }
  const prompt = `基于下列 ProjectSpec 完成“${module}”模块分析。
任务：${moduleTask(module)}
输出 Markdown，包含目标、已确认输入、Agent 推断、待确认信息、方案与理由、确定性检查、安全边界和下一步。
任何没有逐字出现在 ProjectSpec 中的电压、电流、功率、阻值、引脚、地址、尺寸、范围、器件能力或价格
都禁止给出具体数字，只能写“待确认，需要查看所选型号的正式数据手册”。\nProjectSpec：${JSON.stringify(spec)}`;
  let output;
  try {
    output = await deepSeek(
      env,
      [{ role: "system", content: SYSTEM_GUARDRAILS }, { role: "user", content: prompt }],
      "default",
      false,
      900,
    );
  } catch (error) {
    return {
      content: safeModuleAnalysis(
        spec,
        module,
        [`DeepSeek 暂不可用：${error instanceof Error ? error.message : String(error)}`],
      ),
      model: "deterministic-fallback-after-error",
      usage: {},
    };
  }
  const violations = modelIntegrityViolations(output.content);
  return {
    ...output,
    content: violations.length
      ? safeModuleAnalysis(spec, module, violations)
      : output.content,
  };
}

async function listArtifactRows(
  env: RuntimeEnvironment,
  projectId: string,
) {
  return await all<ArtifactRow>(
    env,
    "SELECT * FROM artifacts WHERE project_id = ? ORDER BY path",
    [projectId],
  );
}

async function readBody<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 1_000_000) throw new ApiError(413, "请求内容过大");
  try { return await request.json() as T; } catch {
    throw new ApiError(422, "请求 JSON 无效");
  }
}

function assertProjectInput(input: ProjectCreateInput) {
  if (!input.name || input.name.trim().length < 2 || input.name.length > 120) {
    throw new ApiError(422, "项目名称需要 2–120 个字符");
  }
  if (!input.description || input.description.trim().length < 10 || input.description.length > 6000) {
    throw new ApiError(422, "产品描述需要 10–6000 个字符");
  }
  if (input.budget_cny !== undefined && (!Number.isFinite(input.budget_cny) || input.budget_cny <= 0)) {
    throw new ApiError(422, "预算必须是大于零的数字");
  }
}

export async function handleApi(
  request: Request,
  env: RuntimeEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  try {
    const parts = url.pathname.split("/").filter(Boolean);
    const method = request.method.toUpperCase();

    if (
      (url.pathname === "/api/health" ||
        url.pathname === "/api/health/database") &&
      method === "GET"
    ) {
      const database = await env.database.healthCheck();
      if (url.pathname === "/api/health/database") {
        return jsonResponse(
          {
            status: database.ok ? "ok" : "unavailable",
            platform: env.deploymentPlatform,
            database,
          },
          database.ok ? 200 : 503,
        );
      }
      return jsonResponse({
        status: database.ok ? "ok" : "degraded",
        platform: env.deploymentPlatform,
        provider: env.model.kind,
        deepseek_configured: env.model.configured,
        models: env.model.configured ? {
          default: modelFor(env, "default"),
          reasoning: modelFor(env, "reasoning"),
          coding: modelFor(env, "coding"),
        } : {},
        database,
        capabilities: {
          ...env.capabilities,
          persistent_projects:
            env.capabilities.persistent_projects && database.ok,
        },
      }, database.ok ? 200 : 503);
    }

    if (url.pathname === "/api/agent/test" && method === "POST") {
      const output = await deepSeek(
        env,
        [{ role: "system", content: "只进行连接测试。" }, { role: "user", content: "只回复 DEEPSEEK_CONNECTION_OK" }],
        "default",
        false,
        32,
      );
      return jsonResponse({
        status: "connected", provider: "deepseek", model: output.model,
        response: output.content, usage: output.usage,
      });
    }

    if (url.pathname === "/api/planning" && method === "POST") {
      const payload = await readBody<{ description?: string; name?: string }>(request);
      const description = payload.description?.trim() || "";
      if (description.length < 10 || description.length > 6000) {
        throw new ApiError(422, "请用 10–6000 个字符描述你想开发的产品");
      }
      if (payload.name && payload.name.length > 120) {
        throw new ApiError(422, "项目名称不能超过 120 个字符");
      }
      const result = await planProject(env, { description, name: payload.name });
      return jsonResponse({
        ...result.plan,
        provider: providerForModel(result.model),
        model: result.model,
        warning: result.warning,
      });
    }

    try {
      await env.database.initialize();
    } catch (error) {
      throw new ApiError(
        503,
        error instanceof Error ? error.message : "数据库不可用",
      );
    }
    const owner = env.resolveOwner(request);

    if (url.pathname === "/api/projects" && method === "GET") {
      const rows = await all<ProjectRow>(
        env,
        "SELECT * FROM projects WHERE owner = ? ORDER BY updated_at DESC",
        [owner],
      );
      return jsonResponse(rows.map(projectView));
    }

    if (url.pathname === "/api/projects" && method === "POST") {
      const input = await readBody<ProjectCreateInput>(request);
      assertProjectInput(input);
      const id = uid();
      const interpreted = await interpretRequirements(env, input);
      const spec = createProjectSpec(id, input, interpreted.extraction);
      const createdAt = timestamp();
      const slug = slugify(input.name, id);
      await env.database.batch([
        env.database.prepare(
          `INSERT INTO projects
           (id, owner, slug, name, description, status, current_stage, current_spec_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'DRAFT', 'requirements', 1, ?, ?)`,
        ).bind(id, owner, slug, input.name.trim(), input.description.trim(), createdAt, createdAt),
        env.database.prepare(
          `INSERT INTO project_versions
           (id, project_id, version, content, reason, affected_modules, is_current, created_at)
           VALUES (?, ?, 1, ?, '创建项目', ?, 1, ?)`,
        ).bind(uid(), id, JSON.stringify(spec), JSON.stringify(["ProjectSpec", "需求文档"]), createdAt),
      ]);
      const drafts = generateArtifacts(spec, input.description, 1);
      await upsertArtifacts(env, id, 1, drafts);
      const interpretedBy = providerForModel(interpreted.model);
      const summary = interpretedBy === "deepseek"
        ? `DeepSeek 已解析需求并生成 ${spec.open_questions.length} 个关键澄清问题。`
        : `已使用确定性回退创建 ProjectSpec，并生成 ${spec.open_questions.length} 个关键澄清问题；DeepSeek 本次未完成解析。`;
      await recordRun(env, id, {
        task: "解析需求并创建 ProjectSpec",
        provider: interpretedBy,
        model: interpreted.model,
        skill: "Requirement Interpreter",
        input: input.description.slice(0, 500),
        result: summary,
        files: drafts.map((item) => item.path),
        usage: interpreted.usage,
        requiresConfirmation: spec.open_questions.length > 0,
      });
      return jsonResponse({
        id, slug, name: input.name, description: input.description, status: "DRAFT",
        current_stage: "requirements", current_spec_version: 1,
        created_at: createdAt, updated_at: createdAt,
        agent: {
          provider: interpretedBy,
          model: interpreted.model,
          summary,
          requires_confirmation: spec.open_questions.length > 0,
        },
      }, 201);
    }

    if (parts[0] !== "api" || parts[1] !== "projects" || !parts[2]) {
      throw new ApiError(404, "接口不存在");
    }
    const projectId = parts[2];
    const project = await getProject(env, owner, projectId);

    if (parts.length === 3 && method === "GET") return jsonResponse(projectView(project));
    if (parts.length === 3 && method === "PATCH") {
      const patch = await readBody<Json>(request);
      const name = typeof patch.name === "string" ? patch.name.slice(0, 120) : project.name;
      const status = typeof patch.status === "string" ? patch.status : project.status;
      const stage = typeof patch.current_stage === "string" ? patch.current_stage : project.current_stage;
      await env.database.prepare(
        "UPDATE projects SET name = ?, status = ?, current_stage = ?, updated_at = ? WHERE id = ?",
      ).bind(name, status, stage, timestamp(), projectId).run();
      const updated = await getProject(env, owner, projectId);
      return jsonResponse(projectView(updated));
    }
    if (parts.length === 3 && method === "DELETE") {
      await env.database.batch([
        env.database.prepare("DELETE FROM validations WHERE project_id = ?").bind(projectId),
        env.database.prepare("DELETE FROM artifacts WHERE project_id = ?").bind(projectId),
        env.database.prepare("DELETE FROM agent_runs WHERE project_id = ?").bind(projectId),
        env.database.prepare("DELETE FROM messages WHERE project_id = ?").bind(projectId),
        env.database.prepare("DELETE FROM project_versions WHERE project_id = ?").bind(projectId),
        env.database.prepare(
          "DELETE FROM projects WHERE id = ? AND owner = ?",
        ).bind(projectId, owner),
      ]);
      return new Response(null, { status: 204 });
    }

    if (parts[3] === "spec" && parts.length === 4 && method === "GET") {
      return jsonResponse(await getSpec(env, owner, projectId));
    }
    if (parts[3] === "spec" && parts.length === 4 && method === "PATCH") {
      const payload = await readBody<{ spec: ProjectSpec; reason?: string; affected_modules?: string[] }>(request);
      if (!payload.spec || payload.spec.schema_version !== "1.0.0") throw new ApiError(422, "ProjectSpec 无效");
      const version = await saveVersion(
        env, project, payload.spec, payload.reason || "用户修改",
        payload.affected_modules || ["ProjectSpec"],
      );
      return jsonResponse({ version, affected_modules: payload.affected_modules || ["ProjectSpec"] });
    }
    if (
      parts[3] === "spec" && parts[4] === "recommendations"
      && parts.length === 5 && method === "POST"
    ) {
      const payload = await readBody<{ field?: string; question_index?: number }>(request);
      const spec = await getSpec(env, owner, projectId);
      let question: string;
      let targetKey: string;
      if (payload.field === "hardware.preferred_controller") {
        question = "当前原型应该选择哪一种主控具体型号或产品系列？";
        targetKey = `field:${payload.field}`;
      } else if (Number.isInteger(payload.question_index)) {
        const index = payload.question_index as number;
        const item = spec.open_questions[index];
        if (!item) throw new ApiError(404, "待确认问题不存在");
        if (item.verification_status === "USER_CONFIRMED") throw new ApiError(409, "该问题已经确认");
        question = item.value;
        targetKey = `question:${index}`;
      } else {
        throw new ApiError(422, "必须指定可推荐的元件字段或待确认问题");
      }
      const result = await recommendComponents(env, spec, question);
      await recordRun(env, projectId, {
        task: "生成元件候选方案",
        provider: "deepseek",
        model: result.model,
        skill: "Component Candidate Recommender",
        input: question,
        result: JSON.stringify(result.recommendations).slice(0, 1000),
        usage: result.usage,
        requiresConfirmation: true,
      });
      return jsonResponse({
        ...result.recommendations,
        target_key: targetKey,
        provider: "deepseek",
        model: result.model,
        requires_confirmation: true,
      });
    }
    if (
      parts[3] === "spec" && parts[4] === "confirmations"
      && parts.length === 5 && method === "POST"
    ) {
      const payload = await readBody<RequirementConfirmation>(request);
      const spec = await getSpec(env, owner, projectId);
      const confirmation = applyRequirementConfirmation(spec, payload);
      const version = await saveVersion(
        env, project, confirmation.updated, confirmation.reason, confirmation.modules,
      );
      return jsonResponse({
        version,
        reason: confirmation.reason,
        affected_modules: confirmation.modules,
        requirement_status: confirmation.updated.verification.requirement_status,
      });
    }
    if (parts[3] === "spec" && parts[4] === "versions" && parts.length === 5 && method === "GET") {
      const rows = await all<{
        version: number; reason: string; affected_modules: string; is_current: number; created_at: string;
      }>(env, "SELECT version, reason, affected_modules, is_current, created_at FROM project_versions WHERE project_id = ? ORDER BY version DESC", [projectId]);
      return jsonResponse(rows.map((row) => ({
        version: row.version,
        reason: row.reason,
        affected_modules: parseJson<string[]>(row.affected_modules, []),
        is_current: Boolean(row.is_current),
        created_at: row.created_at,
      })));
    }
    if (
      parts[3] === "spec" && parts[4] === "versions" && parts[5]
      && parts[6] === "restore" && method === "POST"
    ) {
      const sourceVersion = Number(parts[5]);
      const source = await one<{ content: string }>(
        env,
        "SELECT content FROM project_versions WHERE project_id = ? AND version = ?",
        [projectId, sourceVersion],
      );
      if (!source) throw new ApiError(404, "指定版本不存在");
      const spec = JSON.parse(source.content) as ProjectSpec;
      spec.project.updated_at = timestamp();
      const version = await saveVersion(
        env, project, spec, `恢复自版本 v${sourceVersion}`, ["ProjectSpec", "全部派生资产"],
      );
      return jsonResponse({ version, reason: `恢复自版本 v${sourceVersion}` });
    }

    if (parts[3] === "messages" && parts.length === 4 && method === "GET") {
      const rows = await all<{ id: string; role: string; content: string; metadata: string; created_at: string }>(
        env,
        "SELECT id, role, content, metadata, created_at FROM messages WHERE project_id = ? ORDER BY created_at",
        [projectId],
      );
      return jsonResponse(rows.map((row) => ({
        id: row.id, role: row.role, content: row.content,
        metadata: parseJson<Json>(row.metadata, {}), created_at: row.created_at,
      })));
    }
    if (parts[3] === "messages" && parts.length === 4 && method === "POST") {
      const payload = await readBody<{ content: string; apply_change?: boolean }>(request);
      if (!payload.content?.trim() || payload.content.length > 4000) throw new ApiError(422, "消息长度无效");
      const spec = await getSpec(env, owner, projectId);
      const deterministicModules = affectedModules(payload.content);
      const analyzed = await analyzeMessage(env, spec, payload.content, deterministicModules);
      const modules = [...new Set([...deterministicModules, ...(analyzed.change.affected_modules || [])])];
      let version = project.current_spec_version;
      const shouldApply = analyzed.change.should_update_spec && payload.apply_change !== false;
      if (shouldApply) {
        const updated = applyChange(spec, analyzed.change, payload.content);
        version = await saveVersion(
          env, project, updated, `用户消息：${payload.content.slice(0, 240)}`, modules,
        );
      }
      const reply = analyzed.change.reply + (
        shouldApply
          ? `\n\n已创建新的 ProjectSpec 版本。受影响模块：${modules.join("、")}。`
          : analyzed.change.should_update_spec
            ? "\n\n本次只完成影响分析，尚未写入 ProjectSpec。"
            : ""
      );
      const createdAt = timestamp();
      const assistantMessageId = uid();
      const conversation = {
        intent: analyzed.change.intent,
        ambiguous: analyzed.change.ambiguous ?? false,
        suggestions: analyzed.change.suggestions || [],
        suggested_tools: analyzed.change.suggested_tools || [],
        next_question: analyzed.change.next_question,
        proposal_message: payload.content,
        proposal_pending: analyzed.change.should_update_spec && !shouldApply,
      };
      await env.database.batch([
        env.database.prepare(
          "INSERT INTO messages (id, project_id, role, content, metadata, created_at) VALUES (?, ?, 'user', ?, '{}', ?)",
        ).bind(uid(), projectId, payload.content, createdAt),
        env.database.prepare(
          "INSERT INTO messages (id, project_id, role, content, metadata, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)",
        ).bind(assistantMessageId, projectId, reply, JSON.stringify({
          affected_modules: modules,
          provider: providerForModel(analyzed.model),
          model: analyzed.model,
          conversation,
        }), timestamp()),
      ]);
      await recordRun(env, projectId, {
        task: "分析项目消息", provider: providerForModel(analyzed.model),
        model: analyzed.model, skill: "Requirement Clarifier / Impact Analyzer",
        input: payload.content, result: reply.slice(0, 1000), usage: analyzed.usage,
        requiresConfirmation: analyzed.change.requires_confirmation ?? true,
      });
      return jsonResponse({
        reply, affected_modules: modules,
        requires_confirmation: analyzed.change.requires_confirmation ?? true,
        provider: providerForModel(analyzed.model),
        model: analyzed.model,
        spec_updated: shouldApply,
        spec_version: version,
        message_id: assistantMessageId,
        conversation,
      });
    }

    if (parts[3] === "generate" && parts[4] && method === "POST") {
      const moduleName = parts[4];
      if (!moduleTask(moduleName) || !moduleArtifactPath[moduleName]) throw new ApiError(404, "不支持的生成模块");
      const spec = await getSpec(env, owner, projectId);
      const drafts = generateArtifacts(spec, project.description, project.current_spec_version);
      await upsertArtifacts(env, projectId, project.current_spec_version, drafts);
      try {
        const output = await generateModuleAnalysis(env, spec, moduleName);
        const agentDraft: ArtifactDraft = {
          path: moduleArtifactPath[moduleName],
          status: "NEEDS_CONFIRMATION",
          content: `<!-- ProjectSpec v${project.current_spec_version}; Agent generated; requires confirmation -->\n\n${output.content.trim()}\n`,
        };
        await upsertArtifacts(env, projectId, project.current_spec_version, [agentDraft]);
        const generatedBy = providerForModel(output.model);
        await recordRun(env, projectId, {
          task: `生成 ${moduleName}`, provider: generatedBy,
          model: output.model, skill: `${moduleName} Generator`,
          input: `ProjectSpec v${project.current_spec_version}`,
          result: output.content.slice(0, 1000),
          files: [...drafts.map((item) => item.path), agentDraft.path],
          usage: output.usage, requiresConfirmation: true,
        });
        return jsonResponse({
          status: "GENERATED", module: moduleName, artifact_count: drafts.length + 1,
          agent_artifact: agentDraft.path, source_spec_version: project.current_spec_version,
          provider: generatedBy,
          model: output.model, requires_confirmation: true,
        });
      } catch (error) {
        await recordRun(env, projectId, {
          task: `生成 ${moduleName}`, provider: env.model.configured ? "deepseek" : "deterministic",
          model: modelFor(env, "default"),
          skill: `${moduleName} Generator`, input: `ProjectSpec v${project.current_spec_version}`,
          error: error instanceof Error ? error.message : String(error), requiresConfirmation: true,
        });
        throw error;
      }
    }

    if (parts[3] === "agent-runs" && method === "GET") {
      const rows = await all<{
        id: string; task_name: string; provider: string; model_name: string; skill_name: string;
        result_summary: string; generated_files: string; error: string | null; token_usage: string;
        requires_confirmation: number; created_at: string;
      }>(env, "SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC", [projectId]);
      return jsonResponse(rows.map((row) => ({
        id: row.id, task_name: row.task_name, provider: row.provider, model: row.model_name,
        skill: row.skill_name, result_summary: row.result_summary,
        generated_files: parseJson<string[]>(row.generated_files, []), error: row.error,
        token_usage: parseJson<Json>(row.token_usage, {}),
        requires_confirmation: Boolean(row.requires_confirmation), created_at: row.created_at,
      })));
    }

    if (parts[3] === "artifacts" && parts.length === 4 && method === "GET") {
      const rows = await listArtifactRows(env, projectId);
      return jsonResponse(rows.map((row) => ({
        id: row.id, kind: row.kind, path: row.path, status: row.status,
        source_spec_version: row.source_spec_version,
      })));
    }
    if (
      parts[3] === "artifacts" && parts[4] &&
      parts[5] === "confirmations" && parts.length === 6 &&
      method === "POST"
    ) {
      const payload = await readBody<{ note?: string }>(request);
      const note = payload.note?.trim() || "";
      if (note.length < 2 || note.length > 1000) {
        throw new ApiError(422, "确认说明需要 2–1000 个字符");
      }
      const row = await one<ArtifactRow>(
        env,
        "SELECT * FROM artifacts WHERE id = ? AND project_id = ?",
        [parts[4], projectId],
      );
      if (!row) throw new ApiError(404, "文件不存在");
      if (row.source_spec_version !== project.current_spec_version) {
        throw new ApiError(
          409,
          `该文件来自 ProjectSpec v${row.source_spec_version}，请按当前 v${project.current_spec_version} 重新生成后再确认`,
        );
      }
      if (row.status === "USER_CONFIRMED") {
        throw new ApiError(409, "该文件已经确认");
      }
      const confirmedAt = timestamp();
      const report = {
        artifact_id: row.id,
        path: row.path,
        checksum: row.checksum,
        source_spec_version: row.source_spec_version,
        confirmation_note: note,
        confirmed_by: "user",
        scope: "content_review",
        limitations: [
          "不代表 Python 测试或 PlatformIO 编译已经执行",
          "不代表具体器件参数、接线或实物测试已经通过",
        ],
      };
      await env.database.batch([
        env.database.prepare(
          "UPDATE artifacts SET status = 'USER_CONFIRMED', updated_at = ? WHERE id = ? AND project_id = ?",
        ).bind(confirmedAt, row.id, projectId),
        env.database.prepare(
          "INSERT INTO validations (id, project_id, validator, status, report, created_at) VALUES (?, ?, ?, 'USER_CONFIRMED', ?, ?)",
        ).bind(
          uid(),
          projectId,
          `artifact-review:${row.path}`,
          JSON.stringify(report),
          confirmedAt,
        ),
        env.database.prepare(
          "UPDATE projects SET updated_at = ? WHERE id = ?",
        ).bind(confirmedAt, projectId),
      ]);
      return jsonResponse({
        id: row.id,
        kind: row.kind,
        path: row.path,
        status: "USER_CONFIRMED",
        source_spec_version: row.source_spec_version,
        confirmation: report,
      });
    }
    if (parts[3] === "artifacts" && parts[4] && parts[5] === "content" && method === "GET") {
      const row = await one<ArtifactRow>(
        env, "SELECT * FROM artifacts WHERE id = ? AND project_id = ?", [parts[4], projectId],
      );
      if (!row) throw new ApiError(404, "文件不存在");
      if (new TextEncoder().encode(row.content).length > 1_000_000) throw new ApiError(413, "文件过大");
      return jsonResponse({ path: row.path, content: row.content });
    }
    if (parts[3] === "artifacts" && parts[4] && parts.length === 5 && method === "GET") {
      const row = await one<ArtifactRow>(
        env, "SELECT * FROM artifacts WHERE id = ? AND project_id = ?", [parts[4], projectId],
      );
      if (!row) throw new ApiError(404, "文件不存在");
      return new Response(row.content, {
        headers: {
          "Content-Type": contentType(row.path),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.path.split("/").at(-1) || "artifact.txt")}`,
        },
      });
    }

    if (parts[3] === "validate" && parts[4] && method === "POST") {
      const target = parts[4];
      const spec = await getSpec(env, owner, projectId);
      const artifactRows = await listArtifactRows(env, projectId);
      let validator: string;
      let status: string;
      let report: unknown;
      if (target === "hardware") {
        validator = "hardware-rules-v1";
        report = validateHardware(spec);
        const value = report as ReturnType<typeof validateHardware>;
        status = value.errors.length ? "FAILED" : value.warnings.length ? "NEEDS_CONFIRMATION" : "SPEC_VERIFIED";
      } else if (target === "protocol") {
        validator = "protocol-consistency-v1";
        report = validateProtocolArtifacts(artifactRows);
        status = (report as ReturnType<typeof validateProtocolArtifacts>).errors.length ? "FAILED" : "CODE_VALIDATED";
      } else if (target === "code") {
        validator = "hosted-code-static-v1";
        report = validateCodeArtifacts(artifactRows);
        status = (report as ReturnType<typeof validateCodeArtifacts>).status;
      } else {
        throw new ApiError(404, "不支持的验证目标");
      }
      await env.database.prepare(
        "INSERT INTO validations (id, project_id, validator, status, report, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(uid(), projectId, validator, status, JSON.stringify(report), timestamp()).run();
      return jsonResponse(report);
    }

    if (parts[3] === "validations" && method === "GET") {
      const rows = await all<{ id: string; validator: string; status: string; report: string; created_at: string }>(
        env,
        "SELECT id, validator, status, report, created_at FROM validations WHERE project_id = ? ORDER BY created_at DESC",
        [projectId],
      );
      return jsonResponse(rows.map((row) => ({
        id: row.id, validator: row.validator, status: row.status,
        report: parseJson<Json>(row.report, {}), created_at: row.created_at,
      })));
    }

    if (parts[3] === "export" && method === "GET") {
      const rows = await listArtifactRows(env, projectId);
      const archiveInputBytes = rows.reduce(
        (total, row) =>
          total +
          new TextEncoder().encode(row.path).length +
          new TextEncoder().encode(row.content).length,
        0,
      );
      if (archiveInputBytes > env.assets.maxArchiveBytes) {
        throw new ApiError(
          413,
          "工程包超过当前托管运行时的内存 ZIP 限制；请改用对象存储导出",
        );
      }
      const archive = createZip(rows.map((row) => ({ name: row.path, content: row.content })));
      return new Response(archive.buffer as ArrayBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(project.slug)}.zip`,
          "Cache-Control": "no-store",
        },
      });
    }

    throw new ApiError(404, "接口不存在");
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse({ detail: error.message }, error.status);
    const message = error instanceof Error ? error.message : "服务器错误";
    return jsonResponse({ detail: message }, 500);
  }
}

function contentType(path: string) {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".ts")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "text/plain; charset=utf-8";
}
