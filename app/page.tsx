"use client";

import {
  AlertTriangle, ArrowRight, Bot, Check, ChevronDown, ChevronRight,
  Clipboard, ClipboardCheck, Code2, Cpu, Download, FileCode2, FileText,
  FolderOpen, GitBranch, Home, Layers3, LoaderCircle, Menu, PackageSearch,
  Lightbulb, Plus, Send, Settings2, ShieldCheck, Sparkles, TestTube2,
  Trash2, Unplug, X,
} from "lucide-react";
import { FormEvent, ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tone = "done" | "active" | "waiting" | "neutral" | "danger";
type IntroPhase = "cover" | "leaving" | "done";
type Traced<T> = {
  value: T;
  source: string;
  confidence: number;
  verification_status: string;
  notes?: string;
};
type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  status: string;
  current_stage: string;
  current_spec_version: number;
};
type ProjectSpec = {
  project: {
    name: Traced<string>;
    description: Traced<string>;
    product_goal: Traced<string>;
    prototype_level: Traced<string>;
    status: string;
  };
  user: { target_user: Traced<string>; experience_level: Traced<string> };
  scenario: {
    usage_environment: Traced<string>;
    usage_process: Traced<string[]>;
  };
  interaction: {
    user_actions: Traced<string[]>;
    system_inputs: Traced<string[]>;
    system_outputs: Traced<string[]>;
    feedback_methods: Traced<string[]>;
    abnormal_conditions: Traced<string[]>;
  };
  system: {
    functional_modules: Traced<string[]>;
    data_flow: Traced<string[]>;
    control_flow: Traced<string[]>;
    states: Traced<string[]>;
    safety_states: Traced<string[]>;
  };
  hardware: {
    preferred_controller: Traced<string>;
    sensors: Array<{ model: Traced<string> }>;
    actuators: Array<{ model: Traced<string> }>;
    communication: { transport: Traced<string>; baud_rate: Traced<number> };
  };
  software: {
    data_collection_required: Traced<boolean>;
    machine_learning_required: Traced<boolean>;
    control_interface_required: Traced<boolean>;
  };
  constraints: {
    budget_cny: Traced<number | null>;
    size_constraints: Traced<string>;
    power_constraints: Traced<string>;
    avoid_custom_pcb: Traced<boolean>;
  };
  assumptions: Traced<string>[];
  open_questions: Traced<string>[];
  verification: Record<string, string>;
};
type Artifact = {
  id: string;
  kind: string;
  path: string;
  status: string;
  source_spec_version: number;
};
type AgentRun = {
  id: string;
  task_name: string;
  provider: string;
  model: string;
  skill: string;
  result_summary: string;
  generated_files: string[];
  error?: string;
  token_usage: Record<string, number>;
  requires_confirmation: boolean;
  created_at: string;
};
type Validation = {
  id: string;
  validator: string;
  status: string;
  report: Record<string, unknown>;
  created_at: string;
};
type SpecVersion = {
  version: number;
  reason: string;
  affected_modules: string[];
  is_current: boolean;
  created_at: string;
};
type ChatMessage = {
  role: "user" | "agent";
  text: string;
  affected?: string[];
  intent?: {
    label: string;
    confidence: number;
    rationale: string;
  };
  ambiguous?: boolean;
  suggestions?: ConversationSuggestion[];
  tools?: ConversationToolCall[];
  nextQuestion?: string;
  proposalMessage?: string;
  proposalPending?: boolean;
};
type ConversationSuggestion = {
  label: string;
  value: string;
  rationale: string;
  recommended: boolean;
};
type ConversationToolCall = {
  id: string;
  label: string;
  description: string;
  action: "confirm_spec" | "generate" | "validate" | "open_section";
  target?: string;
  requires_confirmation: boolean;
};
type WorkflowStage = {
  label: string;
  tone: Tone;
  detail: string;
  destination: string;
};
type PlanningQuestion = {
  id: string;
  field:
    | "target_user"
    | "usage_environment"
    | "prototype_level"
    | "preferred_controller"
    | "communication_preference"
    | "budget_cny";
  question: string;
  why: string;
  options: ConversationSuggestion[];
};
type ProjectPlan = {
  proposed_name: string;
  summary: string;
  intent: {
    label: string;
    confidence: number;
    rationale: string;
  };
  phases: Array<{
    id: string;
    title: string;
    description: string;
    tool: string;
  }>;
  ambiguities: PlanningQuestion[];
  assumptions: string[];
  draft: Partial<ProjectForm>;
  provider: string;
  model: string;
  warning?: string;
};
type ComponentRecommendation = {
  question: string;
  candidates: Array<{
    name: string;
    category: string;
    fit_reason: string;
    tradeoffs: string;
    verification_required: string[];
    recommended: boolean;
  }>;
  disclaimer: string;
  target_key: string;
  provider: string;
  model: string;
  requires_confirmation: boolean;
};
type ProjectForm = {
  name: string;
  description: string;
  target_user?: string;
  usage_environment?: string;
  budget_cny?: number;
  experience_level?: string;
  preferred_controller?: string;
  communication_preference?: string;
  existing_components?: string[];
  size_constraints?: string;
  power_constraints?: string;
  prototype_level?: string;
  avoid_custom_pcb?: boolean;
  data_collection_required?: boolean;
  machine_learning_required?: boolean;
  control_interface_required?: boolean;
};

type Capabilities = {
  persistent_projects: boolean;
  deepseek: boolean;
  hosted_static_validation: boolean;
  python_execution: boolean;
  platformio_execution: boolean;
  local_executor_available: boolean;
  physical_hardware_execution: boolean;
};

const API_URL = "";
const OWNER_STORAGE_KEY = "dpa-owner-id";
const OWNER_COOKIE = "designer_prototype_owner";
const nav = [
  ["项目概览", Home], ["需求", FileText], ["系统架构", GitBranch], ["硬件方案", Cpu],
  ["BOM", PackageSearch], ["接线", Unplug], ["通信协议", Layers3], ["固件代码", Code2],
  ["Python 程序", FileCode2], ["控制界面", Settings2], ["测试", TestTube2],
  ["文档", FileText], ["验证记录", ClipboardCheck],
] as const;
const moduleConfig: Record<string, { module?: string; prefixes: string[]; description: string }> = {
  需求: { prefixes: ["01_requirements/"], description: "ProjectSpec 是所有工程资产的唯一需求事实来源。" },
  系统架构: { module: "architecture", prefixes: ["02_architecture/"], description: "输入、处理、输出、数据流、控制流与状态机。" },
  硬件方案: { module: "hardware", prefixes: ["03_hardware/component", "03_hardware/hardware"], description: "主控、传感器、执行器、电源与通信候选方案。" },
  BOM: { module: "bom", prefixes: ["03_hardware/bom", "03_hardware/power"], description: "BOM 与成本：结构化器件清单、成本与电源预算。" },
  接线: { module: "hardware", prefixes: ["03_hardware/wiring"], description: "接线表必须结合具体板卡数据手册人工复核。" },
  通信协议: { module: "protocol", prefixes: ["07_protocol/"], description: "固件与 Python 共用的 USB 串口 JSONL 协议。" },
  固件代码: { module: "firmware", prefixes: ["04_firmware/"], description: "ESP32 PlatformIO 固件、状态机、日志与错误处理。" },
  "Python 程序": { module: "python", prefixes: ["05_python/"], description: "数据采集、处理、训练、推理与通信工具。" },
  控制界面: { module: "ui", prefixes: ["06_interface/"], description: "项目专用的本地有人值守控制界面。" },
  测试: { module: "tests", prefixes: ["08_testing/"], description: "单元、集成、首次上电、安全和连续运行测试。" },
  文档: { module: "docs", prefixes: ["09_reports/", "README.md"], description: "安装、运行、调试、故障排查和工程报告。" },
};
const statusText: Record<string, string> = {
  DRAFT: "草稿", GENERATED: "Agent 已生成", NEEDS_CONFIRMATION: "等待确认",
  SPEC_VERIFIED: "规格已核对", CODE_VALIDATED: "代码已验证",
  COMPILE_PASSED: "编译通过", HARDWARE_PENDING: "等待实物测试",
  USER_CONFIRMED: "用户已确认", FAILED: "验证失败", NOT_RUN: "未运行",
};
const statusTone = (status: string): Tone => {
  if (["SPEC_VERIFIED", "CODE_VALIDATED", "COMPILE_PASSED", "USER_CONFIRMED"].includes(status)) return "done";
  if (status === "FAILED") return "danger";
  if (status === "GENERATED") return "active";
  if (["NEEDS_CONFIRMATION", "HARDWARE_PENDING"].includes(status)) return "waiting";
  return "neutral";
};

function buildWorkflowStages(
  project: ProjectSummary | null,
  spec: ProjectSpec | null,
  artifacts: Artifact[],
  validations: Validation[],
): WorkflowStage[] {
  const pendingQuestions = spec?.open_questions.filter(
    (item) => item.verification_status !== "USER_CONFIRMED",
  ).length ?? 0;
  const latestValidations = validations.filter(
    (item, index) => validations.findIndex((entry) => entry.validator === item.validator) === index,
  );
  const validationFailed = latestValidations.filter((item) => item.status === "FAILED").length;

  return nav.map(([label]) => {
    if (label === "项目概览") {
      return {
        label,
        tone: pendingQuestions ? "active" : "done",
        detail: pendingQuestions ? "对话推进中" : "等待下一指令",
        destination: label,
      };
    }
    if (label === "需求") {
      return {
        label,
        tone: pendingQuestions ? "waiting" : "done",
        detail: pendingQuestions
          ? `${pendingQuestions} 项待确认`
          : project ? `ProjectSpec v${project.current_spec_version}` : "尚未创建",
        destination: label,
      };
    }
    if (label === "验证记录") {
      return {
        label,
        tone: validationFailed ? "danger" : latestValidations.length ? "done" : "neutral",
        detail: validationFailed
          ? `${validationFailed} 项失败`
          : latestValidations.length ? `${latestValidations.length} 类已运行` : "尚未运行",
        destination: label,
      };
    }
    const config = moduleConfig[label];
    const related = artifacts.filter((item) =>
      config?.prefixes.some((prefix) => item.path.startsWith(prefix)),
    );
    const stale = related.some((item) => item.source_spec_version !== project?.current_spec_version);
    const awaiting = related.filter((item) =>
      ["GENERATED", "NEEDS_CONFIRMATION"].includes(item.status),
    ).length;
    const confirmed = related.filter((item) => item.status === "USER_CONFIRMED").length;
    return {
      label,
      tone: stale || awaiting ? "waiting" : confirmed && confirmed === related.length ? "done" : related.length ? "active" : "neutral",
      detail: stale
        ? "需按新版本重生成"
        : awaiting ? `${awaiting} 个文件待确认`
          : confirmed ? `${confirmed} 个文件已确认`
            : related.length ? `${related.length} 个文件已生成` : "待生成",
      destination: label,
    };
  });
}

function browserOwnerId() {
  if (typeof window === "undefined") return "";
  let ownerId = localStorage.getItem(OWNER_STORAGE_KEY);
  if (!ownerId) {
    ownerId = crypto.randomUUID();
    localStorage.setItem(OWNER_STORAGE_KEY, ownerId);
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${OWNER_COOKIE}=${encodeURIComponent(ownerId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  return ownerId;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ownerId = browserOwnerId();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(ownerId ? { "X-Designer-Owner-Id": ownerId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const detail = typeof result === "object" && result && "detail" in result
      ? String((result as { detail: unknown }).detail)
      : `请求失败（${response.status}）`;
    throw new Error(detail);
  }
  return result as T;
}

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const selector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    focusable[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(dialog!.querySelectorAll<HTMLElement>(selector));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, []);

  return dialogRef;
}

function useAnimatedPresence(visible: boolean, exitMs = 250) {
  const [mounted, setMounted] = useState(visible);

  if (visible && !mounted) {
    setMounted(true);
  }

  useEffect(() => {
    if (visible || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, mounted, visible]);

  return {
    mounted,
    closing: mounted && !visible,
  };
}

function Dropdown({
  label, value, options, onChange, disabled = false, dangerAction,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  dangerAction?: { label: string; onClick: () => void };
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const menuPresence = useAnimatedPresence(open, 190);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return <div className={`dropdown ${open ? "open" : ""}`} ref={root}>
    <button
      type="button"
      className="dropdown-trigger"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        if (event.key === "ArrowDown") setOpen(true);
      }}
    >
      <span>{selected?.label ?? "请选择"}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {menuPresence.mounted && <div className={`dropdown-menu ${menuPresence.closing ? "is-closing" : ""}`}>
      <div className="dropdown-options" role="listbox" aria-label={`${label}选项`}>
        {options.map((option) => <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={option.value === value ? "selected" : ""}
          key={option.value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
        >
          <span>{option.label}</span>
          {option.value === value && <Check size={14} />}
        </button>)}
      </div>
      {dangerAction && <button
        type="button"
        className="dropdown-danger"
        onClick={() => {
          setOpen(false);
          dangerAction.onClick();
        }}
      ><Trash2 size={13} />{dangerAction.label}</button>}
    </div>}
  </div>;
}

export default function HomePage() {
  const [active, setActive] = useState("项目概览");
  const [agentOpen, setAgentOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [spec, setSpec] = useState<ProjectSpec | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [validations, setValidations] = useState<Validation[]>([]);
  const [versions, setVersions] = useState<SpecVersion[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [provider, setProvider] = useState("正在检查模型…");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const agentPresence = useAnimatedPresence(agentOpen, 260);
  const mobileNavPresence = useAnimatedPresence(mobileNav, 230);
  const createPresence = useAnimatedPresence(createOpen, 250);
  const deletePresence = useAnimatedPresence(deleteOpen, 250);
  const [preview, setPreview] = useState("");
  const [introPhase, setIntroPhase] = useState<IntroPhase>("cover");
  const introLogoRef = useRef<HTMLDivElement>(null);
  const introTimerRef = useRef<number | null>(null);

  const loadProject = useCallback(async (projectId: string) => {
    setBusy("正在加载项目");
    setError("");
    try {
      const [projectData, specData, artifactData, messageData, runData, validationData, versionData] =
        await Promise.all([
          request<ProjectSummary>(`/api/projects/${projectId}`),
          request<ProjectSpec>(`/api/projects/${projectId}/spec`),
          request<Artifact[]>(`/api/projects/${projectId}/artifacts`),
          request<Array<{
            role: string;
            content: string;
            metadata?: {
              affected_modules?: string[];
              conversation?: {
                intent?: ChatMessage["intent"];
                ambiguous?: boolean;
                suggestions?: ConversationSuggestion[];
                suggested_tools?: ConversationToolCall[];
                next_question?: string;
                proposal_message?: string;
                proposal_pending?: boolean;
              };
            };
          }>>(`/api/projects/${projectId}/messages`),
          request<AgentRun[]>(`/api/projects/${projectId}/agent-runs`),
          request<Validation[]>(`/api/projects/${projectId}/validations`),
          request<SpecVersion[]>(`/api/projects/${projectId}/spec/versions`),
        ]);
      setProject(projectData);
      setSpec(specData);
      setArtifacts(artifactData);
      setRuns(runData);
      setValidations(validationData);
      setVersions(versionData);
      setMessages(messageData.map((item) => ({
        role: item.role === "user" ? "user" : "agent",
        text: item.content,
        affected: item.metadata?.affected_modules,
        intent: item.metadata?.conversation?.intent,
        ambiguous: item.metadata?.conversation?.ambiguous,
        suggestions: item.metadata?.conversation?.suggestions,
        tools: item.metadata?.conversation?.suggested_tools,
        nextQuestion: item.metadata?.conversation?.next_question,
        proposalMessage: item.metadata?.conversation?.proposal_message,
        proposalPending: item.metadata?.conversation?.proposal_pending,
      })));
      localStorage.setItem("dpa-current-project", projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目加载失败");
    } finally {
      setBusy("");
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const [health, projectList] = await Promise.all([
        request<{
          provider: string;
          deepseek_configured: boolean;
          models: { default?: string };
          capabilities?: Capabilities;
        }>("/api/health"),
        request<ProjectSummary[]>("/api/projects"),
      ]);
      setCapabilities(health.capabilities ?? null);
      setProvider(
        health.provider === "deepseek" && health.deepseek_configured
          ? `DeepSeek · ${health.models.default ?? "已配置"}`
          : "Mock 模式",
      );
      setProjects(projectList);
      const saved = localStorage.getItem("dpa-current-project");
      const target = projectList.find((item) => item.id === saved) ?? projectList[0];
      if (target) await loadProject(target.id);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : "无法连接工程 API"}。请刷新页面后重试。`);
    }
  }, [loadProject]);

  useEffect(() => {
    if (introPhase === "done") void loadProjects();
  }, [introPhase, loadProjects]);

  useEffect(() => () => {
    if (introTimerRef.current !== null) window.clearTimeout(introTimerRef.current);
  }, []);

  const dismissIntro = useCallback(() => {
    if (introPhase !== "cover") return;
    const logo = introLogoRef.current;
    const target = document.querySelector<HTMLElement>(".brand-symbol");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!logo || !target || prefersReducedMotion) {
      setIntroPhase("done");
      return;
    }
    const sourceRect = logo.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    logo.style.setProperty("--intro-translate-x", `${targetCenterX - sourceCenterX}px`);
    logo.style.setProperty("--intro-translate-y", `${targetCenterY - sourceCenterY}px`);
    logo.style.setProperty("--intro-scale", `${targetRect.width / sourceRect.width}`);
    setIntroPhase("leaving");
    introTimerRef.current = window.setTimeout(() => setIntroPhase("done"), 1040);
  }, [introPhase]);

  const filteredArtifacts = useMemo(() => {
    const config = moduleConfig[active];
    if (!config) return artifacts;
    return artifacts.filter((item) =>
      config.prefixes.some((prefix) =>
        prefix.endsWith("/") ? item.path.startsWith(prefix) : item.path.startsWith(prefix),
      ),
    );
  }, [active, artifacts]);
  const workflowStages = useMemo(
    () => buildWorkflowStages(project, spec, artifacts, validations),
    [project, spec, artifacts, validations],
  );

  useEffect(() => {
    if (active === "项目概览" || active === "验证记录") return;
    const first = filteredArtifacts[0];
    if (first && selectedArtifact?.id !== first.id) void openArtifact(first);
    if (!first) { setSelectedArtifact(null); setPreview(""); }
    // selectedArtifact is intentionally omitted so navigation controls the default preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, filteredArtifacts]);

  async function openArtifact(item: Artifact) {
    setSelectedArtifact(item);
    setPreview("正在加载文件…");
    try {
      const result = await request<{ content: string }>(
        `/api/projects/${project?.id}/artifacts/${item.id}/content`,
      );
      setPreview(result.content);
    } catch (reason) {
      setPreview(reason instanceof Error ? reason.message : "文件读取失败");
    }
  }

  async function refreshCurrent() {
    if (!project) return;
    const updatedProjects = await request<ProjectSummary[]>("/api/projects");
    setProjects(updatedProjects);
    await loadProject(project.id);
  }

  async function createProject(data: ProjectForm) {
    const result = await request<ProjectSummary & { agent: { provider: string; model: string; summary: string } }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
    setProjects((items) => [result, ...items]);
    setProvider(
      result.agent.provider === "deepseek"
        ? `DeepSeek · ${result.agent.model}`
        : result.agent.provider === "deterministic"
          ? "DeepSeek 暂时降级"
          : "Mock 模式",
    );
    await loadProject(result.id);
    setMessages([{ role: "agent", text: result.agent.summary }]);
    setCreateOpen(false);
    setActive("项目概览");
  }

  async function planNewProject(description: string) {
    return await request<ProjectPlan>("/api/planning", {
      method: "POST",
      body: JSON.stringify({ description }),
    });
  }

  async function deleteCurrentProject() {
    if (!project || busy) return;
    const deletedId = project.id;
    setBusy("正在删除项目及其工程记录");
    setError("");
    try {
      await request(`/api/projects/${deletedId}`, { method: "DELETE" });
      const remaining = await request<ProjectSummary[]>("/api/projects");
      setProjects(remaining);
      setDeleteOpen(false);
      setActive("项目概览");
      setSelectedArtifact(null);
      setPreview("");
      if (remaining.length > 0) {
        await loadProject(remaining[0].id);
      } else {
        setProject(null);
        setSpec(null);
        setArtifacts([]);
        setRuns([]);
        setValidations([]);
        setVersions([]);
        setMessages([]);
        localStorage.removeItem("dpa-current-project");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目删除失败");
      throw reason;
    } finally {
      setBusy("");
    }
  }

  async function sendContent(content: string, applyChange = false) {
    if (!content.trim() || busy) return;
    if (!project) {
      setCreateOpen(true);
      return;
    }
    const normalizedContent = content.trim();
    setMessages((items) => [...items, { role: "user", text: normalizedContent }]);
    setMessage("");
    setBusy(applyChange ? "DeepSeek 正在确认计划并更新 ProjectSpec" : "DeepSeek 正在识别意图并规划下一步");
    try {
      const result = await request<{
        reply: string;
        affected_modules: string[];
        provider: string;
        model: string;
        spec_updated: boolean;
        spec_version: number;
        conversation?: {
          intent?: ChatMessage["intent"];
          ambiguous?: boolean;
          suggestions?: ConversationSuggestion[];
          suggested_tools?: ConversationToolCall[];
          next_question?: string;
          proposal_message?: string;
          proposal_pending?: boolean;
        };
      }>(`/api/projects/${project.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: normalizedContent, apply_change: applyChange }),
      });
      setProvider(
        result.provider === "deepseek"
          ? `DeepSeek · ${result.model}`
          : result.provider === "deterministic"
            ? "DeepSeek 暂时降级"
            : "Mock 模式",
      );
      setMessages((items) => [...items, {
        role: "agent",
        text: result.reply,
        affected: result.affected_modules,
        intent: result.conversation?.intent,
        ambiguous: result.conversation?.ambiguous,
        suggestions: result.conversation?.suggestions,
        tools: result.conversation?.suggested_tools,
        nextQuestion: result.conversation?.next_question,
        proposalMessage: result.conversation?.proposal_message,
        proposalPending: result.conversation?.proposal_pending,
      }]);
      if (result.spec_updated) await refreshCurrent();
    } catch (reason) {
      setMessages((items) => [...items, {
        role: "agent",
        text: `请求失败：${reason instanceof Error ? reason.message : "无法连接后端"}`,
      }]);
    } finally {
      setBusy("");
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    await sendContent(message, false);
  }

  async function executeConversationTool(tool: ConversationToolCall, sourceMessage?: string) {
    if (busy) return;
    if (tool.action === "confirm_spec") {
      if (!sourceMessage) return;
      await sendContent(`确认执行上述计划：${sourceMessage}`, true);
      return;
    }
    if (tool.action === "generate" && tool.target) {
      await generateCurrent(tool.target);
      return;
    }
    if (tool.action === "validate" && ["hardware", "protocol", "code"].includes(tool.target ?? "")) {
      await validateCurrent(tool.target as "hardware" | "protocol" | "code");
      return;
    }
    if (tool.action === "open_section" && tool.target) {
      const exact = nav.find(([label]) => label === tool.target)?.[0];
      const byModule = Object.entries(moduleConfig).find(([, config]) => config.module === tool.target)?.[0];
      setActive(exact ?? byModule ?? "项目概览");
    }
  }

  async function generateCurrent(module: string) {
    if (!project || busy) return;
    setBusy(`DeepSeek 正在生成 ${active}`);
    setError("");
    try {
      await request(`/api/projects/${project.id}/generate/${module}`, { method: "POST" });
      await refreshCurrent();
      if (selectedArtifact) await openArtifact(selectedArtifact);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成失败");
    } finally {
      setBusy("");
    }
  }

  async function validateCurrent(target: "hardware" | "protocol" | "code") {
    if (!project || busy) return;
    setBusy(
      target === "code"
        ? capabilities?.python_execution
          ? "正在运行 Python 测试与 PlatformIO 编译"
          : "正在执行云端代码静态检查"
        : "正在执行确定性验证",
    );
    setError("");
    try {
      await request(`/api/projects/${project.id}/validate/${target}`, { method: "POST" });
      await refreshCurrent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败");
    } finally {
      setBusy("");
    }
  }

  async function confirmRequirement(payload: {
    field?: string;
    value?: string | number;
    question_index?: number;
    answer?: string;
  }) {
    if (!project || busy) return;
    setBusy(payload.field ? "正在确认需求字段并创建新版本" : "正在记录回答并创建新版本");
    setError("");
    try {
      await request(`/api/projects/${project.id}/spec/confirmations`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refreshCurrent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "需求确认失败");
      throw reason;
    } finally {
      setBusy("");
    }
  }

  async function recommendRequirement(payload: {
    field?: string;
    question_index?: number;
  }) {
    if (!project || busy) throw new Error("Agent 正在处理其他任务");
    setBusy("DeepSeek 正在比较 3 个候选方案");
    setError("");
    try {
      return await request<ComponentRecommendation>(
        `/api/projects/${project.id}/spec/recommendations`,
        { method: "POST", body: JSON.stringify(payload) },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "候选方案生成失败");
      throw reason;
    } finally {
      setBusy("");
    }
  }

  async function confirmArtifact(artifactId: string, note: string) {
    if (!project || busy) return;
    setBusy("正在记录工程文件人工确认");
    setError("");
    try {
      const result = await request<Artifact & { confirmation: Record<string, unknown> }>(
        `/api/projects/${project.id}/artifacts/${artifactId}/confirmations`,
        {
          method: "POST",
          body: JSON.stringify({ note }),
        },
      );
      await refreshCurrent();
      setSelectedArtifact((current) =>
        current?.id === artifactId ? { ...current, ...result } : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工程文件确认失败");
      throw reason;
    } finally {
      setBusy("");
    }
  }

  function exportProject() {
    if (project) window.location.assign(`${API_URL}/api/projects/${project.id}/export`);
  }

  const introVisible = introPhase !== "done";

  return (
    <main className={`app-root ${!project || !spec ? "initial-view" : ""} ${introVisible ? "intro-active" : ""}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <section className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div><strong>智能产品原型工程师</strong><small>Designer Prototype Agent</small></div>
          </div>
          <div className="actions">
            <div className={`model-state ${provider.startsWith("DeepSeek") ? "connected" : "neutral"}`}>
              <i aria-hidden="true" />
              <Badge tone={provider.startsWith("DeepSeek") ? "done" : "neutral"}>{provider}</Badge>
            </div>
            <button className="button secondary compact agent-toggle" aria-label="打开或关闭 Agent" onClick={() => setAgentOpen(!agentOpen)}><Bot size={16} /> Agent</button>
            <button className="button primary compact" onClick={() => setCreateOpen(true)}><Plus size={16} /> 新建项目</button>
            <button className="icon mobile" onClick={() => setMobileNav(!mobileNav)} aria-label="打开项目导航"><Menu size={20} /></button>
          </div>
        </header>

        {error && <div className="global-error" role="alert"><AlertTriangle size={15} />{error}<button aria-label="关闭错误提示" onClick={() => setError("")}><X size={14} /></button></div>}
        {busy && <div className="busybar" role="status"><LoaderCircle size={14} className="spin" />{busy}</div>}

        <div className={`workspace ${agentOpen ? "" : "no-agent"}`}>
          {mobileNavPresence.mounted && <button
            className={`mobile-nav-scrim ${mobileNavPresence.closing ? "is-closing" : ""}`}
            aria-label="关闭项目导航"
            onClick={() => setMobileNav(false)}
          />}
          <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <div className="project-switcher">
            <span>{project?.name.slice(0, 1) ?? "项"}</span>
            <div>
              <Dropdown
                label="选择项目"
                value={project?.id ?? ""}
                options={projects.length
                  ? projects.map((item) => ({ value: item.id, label: item.name }))
                  : [{ value: "", label: "尚未创建项目" }]}
                disabled={projects.length === 0}
                onChange={(value) => void loadProject(value)}
                dangerAction={project ? {
                  label: "删除当前项目",
                  onClick: () => {
                    setMobileNav(false);
                    setDeleteOpen(true);
                  },
                } : undefined}
              />
              <small>{project ? `ProjectSpec v${project.current_spec_version}` : "请创建项目"}</small>
            </div>
          </div>
          <span className="nav-caption">Project workflow</span>
          <nav>{nav.map(([label, Icon]) => {
            const stage = workflowStages.find((item) => item.label === label);
            return (
            <button
              key={label}
              className={active === label ? "selected" : ""}
              onClick={() => { setActive(label); setMobileNav(false); }}
            >
              <Icon size={17} />
              <span><strong>{label}</strong><small>{stage?.detail ?? "待开始"}</small></span>
              <i className={`workflow-state ${stage?.tone ?? "neutral"}`} aria-hidden="true" />
            </button>
          );})}</nav>
          <div className="safety">
            <ShieldCheck size={18} />
            <div><strong>原型安全边界</strong><p>首次上电前必须人工检查接线。Agent 不能替代专业电气安全评审。</p></div>
          </div>
          </aside>

          <section className="content">
          <div className="content-view" key={`${project?.id ?? "empty"}:${active}`}>
          {!project || !spec ? (
            <EmptyHome loading={Boolean(busy)} onCreate={() => setCreateOpen(true)} />
          ) : active === "项目概览" ? (
            <Overview
              project={project}
              spec={spec}
              artifacts={artifacts}
              messages={messages}
              message={message}
              busy={Boolean(busy)}
              workflowStages={workflowStages}
              onMessageChange={setMessage}
              onSend={send}
              onSuggestion={(value) => void sendContent(`我选择：${value}`, false)}
              onTool={(tool, sourceMessage) => void executeConversationTool(tool, sourceMessage)}
              onConfirmRequirement={confirmRequirement}
              onRecommendRequirement={recommendRequirement}
              onConfirmArtifact={confirmArtifact}
              setActive={setActive}
              exportProject={exportProject}
              onDelete={() => setDeleteOpen(true)}
            />
          ) : active === "验证记录" ? (
            <ValidationView validations={validations} runs={runs} capabilities={capabilities} />
          ) : (
            <ModuleView
              title={active}
              description={moduleConfig[active]?.description ?? "当前 ProjectSpec 的派生工程资产。"}
              artifacts={filteredArtifacts}
              selected={selectedArtifact}
              preview={preview}
              onOpen={openArtifact}
              projectId={project.id}
              projectSpecVersion={project.current_spec_version}
              spec={active === "需求" ? spec : undefined}
              versions={active === "需求" ? versions : undefined}
              onReturnToConversation={() => setActive("项目概览")}
            />
          )}
          </div>
          </section>

          {agentPresence.mounted && (
            <aside className={`agent ${agentPresence.closing ? "is-closing" : ""}`}>
            <div className="agent-head">
              <div><AgentOrb active={Boolean(busy)} size="small" /><div><strong>Prototype Engineer</strong><small>● {provider}</small></div></div>
              <button className="icon" aria-label="关闭 Agent" onClick={() => setAgentOpen((open) => !open)}><X size={18} /></button>
            </div>
            <div className="context"><GitBranch size={15} />{project ? `已连接 ProjectSpec v${project.current_spec_version}` : "创建项目后连接上下文"}</div>
            <ConversationThread
              messages={messages}
              compact
              busy={Boolean(busy)}
              onSuggestion={(value) => void sendContent(`我选择：${value}`, false)}
              onTool={(tool, sourceMessage) => void executeConversationTool(tool, sourceMessage)}
            />
            <ConversationComposer
              value={message}
              busy={Boolean(busy)}
              onChange={setMessage}
              onSubmit={send}
              compact
            />
            </aside>
          )}
        </div>
        <footer className="workbench-footer">
          <span><i className={provider.startsWith("DeepSeek") ? "connected" : ""} />{provider}</span>
          <span>ProjectSpec 驱动 · {capabilities?.local_executor_available ? "本地执行器可用" : "云端仅提供静态验证"}</span>
        </footer>
      </section>

      {createPresence.mounted && <PlanningCreateModal
        closing={createPresence.closing}
        close={() => setCreateOpen(false)}
        onPlan={planNewProject}
        onCreate={createProject}
      />}
      {deletePresence.mounted && project && <DeleteProjectModal
        closing={deletePresence.closing}
        project={project}
        disabled={Boolean(busy)}
        close={() => setDeleteOpen(false)}
        onDelete={deleteCurrentProject}
      />}
      {introVisible && (
        <IntroCover phase={introPhase} logoRef={introLogoRef} onEnter={dismissIntro} />
      )}
    </main>
  );
}

function IntroCover({
  phase,
  logoRef,
  onEnter,
}: {
  phase: Exclude<IntroPhase, "done">;
  logoRef: RefObject<HTMLDivElement | null>;
  onEnter: () => void;
}) {
  return <section
    className={`intro-cover ${phase}`}
    role="button"
    tabIndex={0}
    autoFocus
    aria-label="进入 Designer Prototype Agent 工作台"
    onClick={onEnter}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onEnter();
      }
    }}
  >
    <div className="intro-backdrop" aria-hidden="true" />
    <div ref={logoRef} className="intro-logo" aria-hidden="true">
      <span className="intro-logo-piece top" />
      <span className="intro-logo-piece right" />
      <span className="intro-logo-piece bottom" />
      <span className="intro-logo-piece left" />
    </div>
    <div className="intro-copy">
      <span>DESIGNER PROTOTYPE AGENT</span>
      <h1>智能产品原型工程师</h1>
      <p>以 ProjectSpec 串联需求、架构、硬件、代码与文档，让概念更快抵达可验证原型。</p>
      <small>任意点击进入工作台</small>
    </div>
    <div className="intro-authorship">
      <div className="intro-institution">
        {/* Static local identity mark keeps both hosted runtimes independent of image transforms. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/ecnu-round-mark.png"
          alt="华东师范大学校标"
        />
      </div>
      <div className="intro-credit" aria-label="Developed by ChenZiyi">
        <span>Developed by</span>
        <strong>ChenZiyi</strong>
        <small>
          Human–Computer Interaction
          <br />
          Smart Product Designer
        </small>
      </div>
    </div>
  </section>;
}

function EmptyHome({ loading, onCreate }: { loading: boolean; onCreate: () => void }) {
  return <div className="empty home-empty">
    {loading ? (
      <span><LoaderCircle className="spin" /></span>
    ) : (
      <div className="brand-symbol" role="img" aria-label="Designer Prototype Agent 标志" />
    )}
    <div className="kicker">Project workspace</div>
    <h2>{loading ? "正在连接工程工作台" : "创建第一个智能产品原型"}</h2>
    <p>用纯文字描述产品目标、交互、技术偏好与现实约束。DeepSeek 会先形成可追踪的 ProjectSpec，再生成工程资产。</p>
    {!loading && <button className="button primary" onClick={onCreate}><Plus size={16} /> 新建项目</button>}
  </div>;
}

function AgentOrb({
  active = false,
  size = "medium",
}: {
  active?: boolean;
  size?: "small" | "medium" | "large";
}) {
  return <span className={`agent-orb ${size} ${active ? "active" : ""}`} aria-hidden="true">
    <i />
    <b />
    <em />
  </span>;
}

function ConversationThread({
  messages,
  busy,
  compact = false,
  onSuggestion,
  onTool,
}: {
  messages: ChatMessage[];
  busy: boolean;
  compact?: boolean;
  onSuggestion: (value: string) => void;
  onTool: (tool: ConversationToolCall, sourceMessage?: string) => void;
}) {
  const visibleMessages = compact ? messages.slice(-5) : messages;
  return <div className={`chat conversation-thread ${compact ? "compact" : ""}`}>
    {visibleMessages.length === 0 && (
      <div className="conversation-welcome">
        <AgentOrb active={busy} size="small" />
        <div>
          <strong>先告诉我你想推进什么</strong>
          <p>我会先形成计划、识别模糊意图并提供推测选项，不会直接改写 ProjectSpec。</p>
          <div>
            {["规划下一阶段", "处理当前待确认项", "检查哪些内容还不能执行"].map((value) => (
              <button type="button" disabled={busy} key={value} onClick={() => onSuggestion(value)}>
                {value}<ArrowRight size={12} />
              </button>
            ))}
          </div>
        </div>
      </div>
    )}
    {visibleMessages.map((item, index) => {
      const tools = (item.tools ?? []).filter(
        (tool) => tool.action !== "confirm_spec" || item.proposalPending,
      );
      return <div className="conversation-turn" key={`${item.role}-${index}`}>
        <div className={`message ${item.role === "agent" ? "assistant" : "user"}`}>
          {item.role === "agent" && <AgentOrb active={busy && index === visibleMessages.length - 1} size="small" />}
          <p>{item.text}</p>
        </div>
        {item.role === "agent" && item.intent && (
          <div className="intent-card">
            <div>
              <span>意图识别</span>
              <Badge tone={item.ambiguous ? "waiting" : "active"}>
                {Math.round(item.intent.confidence * 100)}% 置信度
              </Badge>
            </div>
            <strong>{item.intent.label}</strong>
            <p>{item.intent.rationale}</p>
          </div>
        )}
        {item.role === "agent" && item.suggestions && item.suggestions.length > 0 && (
          <div className="conversation-suggestions">
            <header><Lightbulb size={14} /><strong>请选择最接近你意图的推测</strong></header>
            {item.suggestions.map((suggestion) => (
              <button
                type="button"
                disabled={busy}
                key={`${suggestion.label}-${suggestion.value}`}
                onClick={() => onSuggestion(suggestion.value)}
              >
                <span>{suggestion.recommended ? "推荐" : "备选"}</span>
                <div><strong>{suggestion.label}</strong><p>{suggestion.rationale}</p></div>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        )}
        {item.role === "agent" && tools.length > 0 && (
          <div className="tool-proposals">
            <header><Settings2 size={14} /><strong>建议调用的工具</strong></header>
            {tools.map((tool) => (
              <div key={tool.id}>
                <span>{tool.action === "confirm_spec" ? <FileText size={14} /> : tool.action === "validate" ? <ClipboardCheck size={14} /> : <Sparkles size={14} />}</span>
                <div>
                  <strong>{tool.label}</strong>
                  <p>{tool.description}</p>
                  <small>{tool.requires_confirmation ? "点击后执行，需要你的明确确认" : "确定性工具，可直接执行"}</small>
                </div>
                <button type="button" disabled={busy} onClick={() => onTool(tool, item.proposalMessage)}>
                  {tool.action === "confirm_spec" ? "确认执行" : "运行工具"}
                </button>
              </div>
            ))}
          </div>
        )}
        {item.role === "agent" && item.nextQuestion && (
          <div className="next-question"><ArrowRight size={13} /><span><strong>下一问</strong>{item.nextQuestion}</span></div>
        )}
        {item.affected && item.affected.length > 0 && (
          <div className="impact"><small>预计影响模块</small><div>{item.affected.map((value) => <em key={value}>{value}</em>)}</div></div>
        )}
      </div>;
    })}
    {busy && <div className="conversation-thinking"><LoaderCircle className="spin" size={14} />Agent 正在识别意图并编排计划…</div>}
  </div>;
}

function ConversationComposer({
  value,
  busy,
  compact = false,
  onChange,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return <form className={`composer conversation-composer ${compact ? "compact" : ""}`} onSubmit={onSubmit}>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="描述目标、提出修改，或说“帮我规划下一步”…"
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
    />
    <div>
      <small>{busy ? "Agent 正在工作…" : "Enter 发送 · Shift + Enter 换行 · 确认前不会改写 ProjectSpec"}</small>
      <button aria-label="发送消息" disabled={busy || !value.trim()}><Send size={16} /></button>
    </div>
  </form>;
}

function ConversationCheckpoint({
  question,
  artifact,
  currentSpecVersion,
  busy,
  onConfirmRequirement,
  onRecommendRequirement,
  onConfirmArtifact,
}: {
  question?: { item: Traced<string>; index: number };
  artifact?: Artifact;
  currentSpecVersion: number;
  busy: boolean;
  onConfirmRequirement: (payload: {
    question_index?: number;
    answer?: string;
  }) => Promise<void>;
  onRecommendRequirement: (payload: {
    question_index?: number;
  }) => Promise<ComponentRecommendation>;
  onConfirmArtifact: (artifactId: string, note: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [recommendation, setRecommendation] = useState<ComponentRecommendation | null>(null);
  const [loadingRecommendation, setLoadingRecommendation] = useState(false);

  if (question) {
    return <section className="conversation-checkpoint" aria-label="对话中的需求确认">
      <div className="checkpoint-head">
        <AgentOrb size="small" />
        <div>
          <span>需要你的确认 · ProjectSpec</span>
          <strong>{question.item.value}</strong>
          <p>{question.item.notes || "这项信息会影响后续选型、成本或实现方式，因此 Agent 不会自行猜测并写入需求。"}</p>
        </div>
        <Badge tone="waiting">待确认</Badge>
      </div>
      <div className="checkpoint-actions">
        <button
          type="button"
          className="button secondary compact"
          disabled={busy || loadingRecommendation}
          onClick={() => {
            setLoadingRecommendation(true);
            void onRecommendRequirement({ question_index: question.index })
              .then(setRecommendation)
              .catch(() => undefined)
              .finally(() => setLoadingRecommendation(false));
          }}
        >
          {loadingRecommendation ? <LoaderCircle className="spin" size={14} /> : <Lightbulb size={14} />}
          让 Agent 推荐 3 个候选
        </button>
        <span>或直接回复你已经确认的事实</span>
      </div>
      {recommendation && <RecommendationPanel
        data={recommendation}
        disabled={busy}
        onSelect={async (candidate) => {
          await onConfirmRequirement({
            question_index: question.index,
            answer: `选择候选：${candidate.name}。选择理由：${candidate.fit_reason}。待验证：${candidate.verification_required.join("、")}。`,
          });
        }}
      />}
      <div className="checkpoint-reply">
        <input
          aria-label={`回答问题：${question.item.value}`}
          value={answer}
          placeholder="输入已确认的信息；不确定时可以先查看 Agent 候选"
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && answer.trim() && !busy) {
              void onConfirmRequirement({
                question_index: question.index,
                answer: answer.trim(),
              });
            }
          }}
        />
        <button
          type="button"
          disabled={busy || answer.trim().length < 2}
          onClick={() => void onConfirmRequirement({
            question_index: question.index,
            answer: answer.trim(),
          })}
        ><Check size={14} />确认并推进</button>
      </div>
    </section>;
  }

  if (artifact) {
    const stale = artifact.source_spec_version !== currentSpecVersion;
    const moduleName = Object.entries(moduleConfig).find(([, config]) =>
      config.prefixes.some((prefix) => artifact.path.startsWith(prefix)),
    )?.[0] ?? "工程";
    const guidance = moduleReviewGuidance[moduleName] ?? {
      purpose: "该文件是当前 ProjectSpec 派生的工程资产。",
      checklist: ["内容是否符合 ProjectSpec", "未知信息是否保持待确认", "限制是否说明清楚"],
      boundary: "确认文件内容不代表真实硬件、代码运行或实物测试已经通过。",
      example: "已核对文件内容与当前 ProjectSpec 一致。",
    };
    return <section className="conversation-checkpoint" aria-label="对话中的工程文件确认">
      <div className="checkpoint-head">
        <AgentOrb size="small" />
        <div>
          <span>需要你的确认 · {moduleName}</span>
          <strong>{artifact.path}</strong>
          <p>{guidance.purpose}</p>
        </div>
        <Badge tone={stale ? "danger" : "waiting"}>{stale ? "版本已过期" : "待确认"}</Badge>
      </div>
      <div className="checkpoint-explanation">
        <strong>确认前请检查</strong>
        <ul>{guidance.checklist.map((item) => <li key={item}>{item}</li>)}</ul>
        <p><AlertTriangle size={13} />{guidance.boundary}</p>
      </div>
      {stale ? (
        <div className="checkpoint-blocked">该文件来自 ProjectSpec v{artifact.source_spec_version}，请先在对话中要求 Agent 按 v{currentSpecVersion} 重新生成。</div>
      ) : <>
        <label className="checkpoint-acknowledge">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>我已阅读工程文件，并理解“确认内容”不等于“验证真实工程结果”。</span>
        </label>
        <div className="checkpoint-reply">
          <input
            aria-label={`确认说明：${artifact.path}`}
            value={note}
            placeholder={`确认说明，例如：${guidance.example}`}
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            type="button"
            disabled={busy || !acknowledged || note.trim().length < 2}
            onClick={() => void onConfirmArtifact(artifact.id, note.trim())}
          ><Check size={14} />确认文件</button>
        </div>
      </>}
    </section>;
  }

  return <section className="conversation-checkpoint complete" aria-label="对话流程状态">
    <AgentOrb size="small" />
    <div>
      <strong>当前没有待处理的人工确认</strong>
      <p>你可以继续描述修改意图，或使用右侧推荐操作生成与验证下一阶段。Workflow 会随执行结果自动更新。</p>
    </div>
    <Badge tone="done">可继续</Badge>
  </section>;
}

function Overview({
  project, spec, artifacts, messages, message, busy,
  workflowStages, onMessageChange, onSend, onSuggestion, onTool,
  onConfirmRequirement, onRecommendRequirement, onConfirmArtifact,
  setActive, exportProject, onDelete,
}: {
  project: ProjectSummary;
  spec: ProjectSpec;
  artifacts: Artifact[];
  messages: ChatMessage[];
  message: string;
  busy: boolean;
  workflowStages: WorkflowStage[];
  onMessageChange: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onSuggestion: (value: string) => void;
  onTool: (tool: ConversationToolCall, sourceMessage?: string) => void;
  onConfirmRequirement: (payload: {
    field?: string;
    value?: string | number;
    question_index?: number;
    answer?: string;
  }) => Promise<void>;
  onRecommendRequirement: (payload: {
    field?: string;
    question_index?: number;
  }) => Promise<ComponentRecommendation>;
  onConfirmArtifact: (artifactId: string, note: string) => Promise<void>;
  setActive: (value: string) => void;
  exportProject: () => void;
  onDelete: () => void;
}) {
  const questionEntries = spec.open_questions
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.verification_status !== "USER_CONFIRMED");
  const staleArtifact = artifacts.find((item) =>
    ["GENERATED", "NEEDS_CONFIRMATION"].includes(item.status)
    && item.source_spec_version !== project.current_spec_version,
  );
  const pendingArtifact = artifacts.find((item) =>
    ["GENERATED", "NEEDS_CONFIRMATION"].includes(item.status)
    && item.source_spec_version === project.current_spec_version,
  );
  const nextGeneration = workflowStages.find((stage) =>
    !["项目概览", "需求", "验证记录"].includes(stage.label)
    && (stage.detail === "待生成" || stage.detail === "需按新版本重生成"),
  );
  const currentStep = questionEntries.length
    ? {
        index: 1,
        title: "澄清并确认需求",
        objective: "先消除会影响选型、预算或实现方式的关键信息缺口。",
        next: `回答：${questionEntries[0].item.value}`,
      }
    : staleArtifact
      ? {
          index: 2,
          title: `按 ProjectSpec v${project.current_spec_version} 重新生成`,
          objective: "需求版本已经变化，旧工程文件不能继续确认；先重新生成受影响模块。",
          next: `重新生成：${nextGeneration?.label ?? staleArtifact.path}`,
        }
      : pendingArtifact
      ? {
          index: 3,
          title: "审阅并确认工程文件",
          objective: "确认生成内容符合当前 ProjectSpec，同时保留尚未验证的工程边界。",
          next: `审阅：${pendingArtifact.path}`,
        }
      : nextGeneration
        ? {
            index: 2,
            title: `生成${nextGeneration.label}`,
            objective: "基于当前 ProjectSpec 生成下一组可追踪的工程资产。",
            next: `调用 ${nextGeneration.label} 生成工具`,
          }
        : {
            index: 4,
            title: "运行确定性工程验证",
            objective: "检查硬件规则、协议一致性与代码静态质量，并记录真实结果。",
            next: "选择验证范围并运行",
          };
  const nextModule = nextGeneration
    ? moduleConfig[nextGeneration.label]?.module
    : undefined;
  return <>
    <PageHead
      title={project.name}
      kicker={`● ProjectSpec v${project.current_spec_version}`}
      description={spec.project.product_goal.value}
    >
      <button className="button danger" onClick={onDelete}><Trash2 size={16} /> 删除项目</button>
      <button className="button secondary" onClick={exportProject}><Download size={16} /> 导出工程包</button>
      <button className="button primary" onClick={() => onSuggestion("请根据当前状态规划下一步")}>继续对话 <ArrowRight size={16} /></button>
    </PageHead>
    <section className="conversation-workspace">
      <header className="conversation-stage">
        <AgentOrb active={busy} size="large" />
        <div className="conversation-stage-copy">
          <span className="kicker">Current step · {currentStep.index}/4</span>
          <h2>{currentStep.title}</h2>
          <p>{currentStep.objective}</p>
          <small><ArrowRight size={12} />下一步：{currentStep.next}</small>
        </div>
        <div className="conversation-stage-progress" aria-label="项目推进流程">
          {["需求", "生成", "确认", "验证"].map((label, index) => (
            <span className={index + 1 < currentStep.index ? "done" : index + 1 === currentStep.index ? "active" : ""} key={label}>
              <i>{index + 1 < currentStep.index ? <Check size={10} /> : index + 1}</i>{label}
            </span>
          ))}
        </div>
      </header>
      <div className="conversation-grid">
        <div className="conversation-main">
          <ConversationThread
            messages={messages}
            busy={busy}
            onSuggestion={onSuggestion}
            onTool={onTool}
          />
          <ConversationCheckpoint
            key={questionEntries[0]
              ? `question-${questionEntries[0].index}`
              : staleArtifact ? `artifact-${staleArtifact.id}`
                : pendingArtifact ? `artifact-${pendingArtifact.id}` : "complete"}
            question={questionEntries[0]}
            artifact={staleArtifact ?? pendingArtifact}
            currentSpecVersion={project.current_spec_version}
            busy={busy}
            onConfirmRequirement={onConfirmRequirement}
            onRecommendRequirement={onRecommendRequirement}
            onConfirmArtifact={onConfirmArtifact}
          />
          <ConversationComposer
            value={message}
            busy={busy}
            onChange={onMessageChange}
            onSubmit={onSend}
          />
        </div>
        <div className="conversation-plan">
          <span className="kicker">Workflow 实时状态</span>
          {workflowStages.filter((stage) => ["需求", "系统架构", "硬件方案", "固件代码", "验证记录"].includes(stage.label)).map((stage, index) => (
            <button
              type="button"
              className={stage.tone}
              key={stage.label}
              onClick={() => setActive(stage.destination)}
            >
              <span>{stage.tone === "done" ? <Check size={12} /> : index + 1}</span>
              <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
              <ChevronRight size={14} />
            </button>
          ))}
          <div className="conversation-quick-tools">
            <strong>推荐操作</strong>
            <button type="button" disabled={busy} onClick={() => onSuggestion("检查当前还有哪些信息需要确认")}>
              <Lightbulb size={13} />规划下一步
            </button>
            {nextModule && <button type="button" disabled={busy} onClick={() => onTool({
              id: `guided-generate-${nextModule}`,
              label: `生成${nextGeneration?.label}`,
              description: "依据当前 ProjectSpec 生成下一模块。",
              action: "generate",
              target: nextModule,
              requires_confirmation: false,
            })}><Sparkles size={13} />生成{nextGeneration?.label}</button>}
            <button type="button" disabled={busy} onClick={() => onTool({
              id: "guided-validate-code",
              label: "运行代码验证",
              description: "运行云端确定性静态检查。",
              action: "validate",
              target: "code",
              requires_confirmation: false,
            })}><ClipboardCheck size={13} />运行静态验证</button>
          </div>
          <p><ShieldCheck size={14} />真实硬件、上电、烧录与采购不会被自动执行。</p>
        </div>
      </div>
    </section>
  </>;
}

function ModuleView({
  title, description, artifacts, selected, preview, onOpen,
  projectId, projectSpecVersion, spec, versions, onReturnToConversation,
}: {
  title: string;
  description: string;
  artifacts: Artifact[];
  selected: Artifact | null;
  preview: string;
  onOpen: (item: Artifact) => void;
  projectId: string;
  projectSpecVersion: number;
  spec?: ProjectSpec;
  versions?: SpecVersion[];
  onReturnToConversation: () => void;
}) {
  return <>
    <PageHead title={title} kicker="工程模块" description={description}>
      <button className="button primary" onClick={onReturnToConversation}><ArrowRight size={16} /> 返回对话推进</button>
    </PageHead>
    <section className="module-conversation-notice">
      <AgentOrb size="small" />
      <div>
        <strong>当前页面仅用于查看工程内容</strong>
        <p>准备、生成、修改、确认和验证操作已统一移至项目概览的对话工作台，执行结果会自动更新本页与 Workflow。</p>
      </div>
    </section>
    {spec && <SpecSummary
      spec={spec}
      versions={versions ?? []}
    />}
    {!spec && selected && <ArtifactReviewStatus
      artifact={selected}
      moduleName={title}
      currentSpecVersion={projectSpecVersion}
    />}
    <div className="artifact-layout">
      <section className="card file-list">
        <header><span><FolderOpen size={15} />工程文件</span><small>{artifacts.length} 项</small></header>
        {artifacts.length === 0 && <p className="muted-empty">还没有文件，请生成当前模块。</p>}
        {artifacts.map((item) => (
          <button className={selected?.id === item.id ? "selected" : ""} key={item.id} onClick={() => onOpen(item)}>
            <FileText size={15} /><span><strong>{item.path.split("/").at(-1)}</strong><small>{item.path}</small></span>
            <Badge tone={statusTone(item.status)}>{statusText[item.status] ?? item.status}</Badge>
          </button>
        ))}
      </section>
      <section className="code preview">
        <div>
          <span>{selected?.path ?? "选择文件进行预览"}</span>
          <div className="actions">
            <button className="button secondary compact" disabled={!selected} onClick={() => void navigator.clipboard.writeText(preview)}><Clipboard size={14} />复制</button>
            {selected && <a className="button secondary compact" href={`${API_URL}/api/projects/${projectId}/artifacts/${selected.id}`} download><Download size={14} />下载</a>}
          </div>
        </div>
        <pre>{preview || "选择左侧工程文件。支持 Markdown、JSON、YAML、CSV、Python、C++ 与 TypeScript 文本预览。"}</pre>
      </section>
    </div>
  </>;
}

const moduleReviewGuidance: Record<string, {
  purpose: string;
  checklist: string[];
  boundary: string;
  example: string;
}> = {
  系统架构: {
    purpose: "说明产品的功能模块、输入输出、数据流、控制流和状态关系，是后续硬件与软件生成的结构依据。",
    checklist: ["模块是否覆盖 ProjectSpec 的产品目标", "输入、处理和输出关系是否合理", "异常状态与安全状态是否遗漏"],
    boundary: "确认架构逻辑一致，不代表其中涉及的具体器件、通信参数或控制效果已经验证。",
    example: "已核对功能模块、数据流和安全状态，与当前 ProjectSpec 一致。",
  },
  硬件方案: {
    purpose: "记录主控、传感器、执行器、电源和通信器件的选择方向，以及仍需查阅数据手册的未知参数。",
    checklist: ["器件类别是否满足功能需求", "所有未知型号和电气参数是否保持待确认", "是否保留电源、驱动和安全边界"],
    boundary: "确认选型方向不等于确认具体型号兼容，也不代表电压、电流、引脚或库存已经核实。",
    example: "已确认器件类别和选型方向；具体型号、电气参数仍保留待确认。",
  },
  BOM: {
    purpose: "汇总原型需要的器件类别、数量、用途、成本风险和替代方向，用于采购前的工程审查。",
    checklist: ["器件是否有缺项或重复", "数量与用途是否符合当前方案", "价格、型号和供货信息是否明确标记来源与验证状态"],
    boundary: "确认 BOM 结构不代表实时价格、库存、具体型号或供应商信息已经核实，不能直接触发采购。",
    example: "已核对器件类别、数量和用途；价格与具体型号待采购前再次核实。",
  },
  接线: {
    purpose: "描述控制器与外设之间的信号关系、方向和待核对的电气连接，是人工绘制和检查实物接线的依据。",
    checklist: ["信号两端与方向是否清楚", "未确认的引脚、电压和电平是否没有被猜测", "电源、共地、驱动和急停要求是否保留"],
    boundary: "确认接线文档不代表可以直接上电；首次上电前仍必须对照具体板卡数据手册并人工逐线检查。",
    example: "已核对信号关系和方向；具体引脚、电压与实物接线仍需数据手册和人工检查。",
  },
  通信协议: {
    purpose: "定义固件与 Python 程序共同使用的消息结构、字段、命令、错误码、超时和版本约束。",
    checklist: ["Schema、固件和 Python 的字段定义是否一致", "命令、响应和错误处理是否完整", "版本、超时与重试约束是否清楚"],
    boundary: "确认协议设计不代表真实串口、网络连接、丢包恢复或设备端交互已经测试通过。",
    example: "已核对消息字段、错误码和版本约束；真实通信仍需联机测试。",
  },
  固件代码: {
    purpose: "实现主控端状态机、通信处理、日志和故障安全逻辑，是本地 PlatformIO 工程的代码草稿。",
    checklist: ["代码是否引用当前协议和 ProjectSpec 版本", "状态机与错误处理是否覆盖设计要求", "是否避免自动烧录和无人值守硬件操作"],
    boundary: "网页确认代码内容不代表 PlatformIO 编译、烧录、时序或真实硬件运行已经通过。",
    example: "已阅读状态机和协议处理逻辑；仍需在本地编译并由人工连接硬件测试。",
  },
  "Python 程序": {
    purpose: "提供数据采集、协议客户端、处理、训练和推理工具，是导出后在本机运行的程序草稿。",
    checklist: ["数据输入输出是否符合产品流程", "协议常量是否与固件一致", "本地路径、串口和数据前置条件是否说明清楚"],
    boundary: "网页确认不代表 pytest 已运行，也不代表串口、数据集、模型效果或真实设备通信已经验证。",
    example: "已核对程序结构和协议引用；本地依赖、测试与设备通信尚需实际执行。",
  },
  控制界面: {
    purpose: "描述项目专用控制台的操作、反馈、状态展示与有人值守边界，用于本地原型交互。",
    checklist: ["界面操作是否对应 ProjectSpec 的用户动作", "状态与异常反馈是否清楚", "危险操作是否保留人工确认和安全提示"],
    boundary: "确认界面设计不代表后端、真实硬件控制或用户体验测试已经完成。",
    example: "已核对主要操作、状态反馈和安全提示；真实控制链路仍未验证。",
  },
  测试: {
    purpose: "定义单元、模块、集成、首次上电、安全、异常和连续运行测试的步骤与预期结果。",
    checklist: ["测试是否覆盖关键需求和风险", "步骤、前置条件和预期结果是否可执行", "未运行项目是否仍明确标记为未运行"],
    boundary: "确认测试计划只表示认可测试设计，不代表任何测试、编译或实物验证已经执行或通过。",
    example: "已确认测试范围和步骤；所有未执行用例仍保持未运行状态。",
  },
  文档: {
    purpose: "汇总安装、运行、调试、安全边界、验证结论和项目限制，供后续开发、交流与交接使用。",
    checklist: ["内容是否对应当前 ProjectSpec 版本", "运行步骤和限制是否准确", "未验证事项、安全边界和下一步是否完整"],
    boundary: "确认文档内容不等于确认其中引用的工程结果、器件参数或实物表现已经通过验证。",
    example: "已核对文档与当前 ProjectSpec 一致，未验证事项和安全边界表述完整。",
  },
};

function ArtifactReviewStatus({
  artifact, moduleName, currentSpecVersion,
}: {
  artifact: Artifact;
  moduleName: string;
  currentSpecVersion: number;
}) {
  const confirmed = artifact.status === "USER_CONFIRMED";
  const stale = artifact.source_spec_version !== currentSpecVersion;
  const guidance = moduleReviewGuidance[moduleName] ?? {
    purpose: "该文件是当前 ProjectSpec 派生的工程资产，用于记录本模块的设计结论与待验证事项。",
    checklist: ["内容是否符合当前 ProjectSpec", "未知信息是否保持待确认", "限制与下一步是否说明清楚"],
    boundary: "确认文件内容不代表代码、器件、接线或实物测试已经通过。",
    example: "已核对文件内容与当前 ProjectSpec 一致，未验证事项保留清楚。",
  };
  return <section className={`module-review-status ${confirmed ? "confirmed" : stale ? "stale" : ""}`}>
    <ClipboardCheck size={17} />
    <div>
      <strong>{confirmed ? "该文件已由用户确认" : stale ? "该文件需要按最新需求重新生成" : "该文件仍等待人工确认"}</strong>
      <p>{artifact.path} · 来源 ProjectSpec v{artifact.source_spec_version}。{guidance.boundary}</p>
    </div>
    <Badge tone={confirmed ? "done" : stale ? "danger" : "waiting"}>
      {confirmed ? "已确认" : stale ? "版本过期" : "请回到对话处理"}
    </Badge>
  </section>;
}

function SpecSummary({ spec, versions }: { spec: ProjectSpec; versions: SpecVersion[] }) {
  const cards: Array<{ label: string; display: string; traced: Traced<unknown> }> = [
    { label: "产品目标", display: String(spec.project.product_goal.value), traced: spec.project.product_goal },
    { label: "目标用户", display: String(spec.user.target_user.value), traced: spec.user.target_user },
    { label: "使用环境", display: String(spec.scenario.usage_environment.value), traced: spec.scenario.usage_environment },
    { label: "主控偏好", display: String(spec.hardware.preferred_controller.value), traced: spec.hardware.preferred_controller },
    { label: "预算", display: spec.constraints.budget_cny.value ? `¥${spec.constraints.budget_cny.value}` : "待确认", traced: spec.constraints.budget_cny },
    { label: "原型等级", display: String(spec.project.prototype_level.value), traced: spec.project.prototype_level },
  ];
  const pendingQuestions = spec.open_questions.filter(
    (item) => item.verification_status !== "USER_CONFIRMED",
  );
  return <>
    <div className="spec-grid read-only">{cards.map((card) => (
      <article className="trace-card" key={card.label}>
        <div><small>{card.label}</small><Badge tone={statusTone(card.traced.verification_status)}>{statusText[card.traced.verification_status] ?? "待确认"}</Badge></div>
        <strong>{card.display}</strong>
        <p>来源：{card.traced.source} · 置信度 {Math.round(card.traced.confidence * 100)}%</p>
      </article>
    ))}</div>
    <section className="card question-list read-only">
      <Title kicker="Open questions" title="关键待确认问题" extra={<Badge tone={pendingQuestions.length ? "waiting" : "done"}>{pendingQuestions.length} 项</Badge>} />
      {pendingQuestions.map((item, index) => <div className="question-item" key={`${index}-${item.value}`}>
        <AlertTriangle size={15} />
        <div><strong>{item.value}</strong><small>请回到项目概览，通过对话获取候选方案并完成确认。</small></div>
      </div>)}
      {pendingQuestions.length === 0 && <p className="question-complete"><Check size={15} />关键问题均已确认。</p>}
    </section>
    <section className="card version-list read-only">
      <Title kicker="Version history" title="ProjectSpec 版本" extra={<small>{versions.length} 个版本</small>} />
      {versions.map((item) => <div key={item.version}>
        <div><strong>v{item.version} · {item.reason}</strong><small>{item.affected_modules.join("、")}</small></div>
        <Badge tone={item.is_current ? "done" : "neutral"}>{item.is_current ? "当前版本" : "历史版本"}</Badge>
      </div>)}
    </section>
  </>;
}

function RecommendationPanel({
  data, disabled, onSelect,
}: {
  data: ComponentRecommendation;
  disabled: boolean;
  onSelect: (candidate: ComponentRecommendation["candidates"][number]) => Promise<void>;
}) {
  const [selecting, setSelecting] = useState("");
  return <section className="recommendation-panel" aria-label={`候选方案：${data.question}`}>
    <header>
      <div><Lightbulb size={16} /><strong>候选方案比较</strong></div>
      <small>{data.provider === "deepseek" ? `DeepSeek · ${data.model}` : data.provider}</small>
    </header>
    <div className="candidate-grid">{data.candidates.map((candidate) => (
      <article className={candidate.recommended ? "recommended" : ""} key={candidate.name}>
        <div>
          <Badge tone={candidate.recommended ? "active" : "neutral"}>
            {candidate.recommended ? "Agent 优先推荐" : candidate.category}
          </Badge>
        </div>
        <h3>{candidate.name}</h3>
        <dl>
          <div><dt>适配理由</dt><dd>{candidate.fit_reason}</dd></div>
          <div><dt>主要取舍</dt><dd>{candidate.tradeoffs}</dd></div>
          <div><dt>选择前验证</dt><dd>{candidate.verification_required.join("、")}</dd></div>
        </dl>
        <button
          type="button"
          className={`button compact ${candidate.recommended ? "primary" : "secondary"}`}
          disabled={disabled || Boolean(selecting)}
          onClick={() => {
            setSelecting(candidate.name);
            void onSelect(candidate)
              .catch(() => undefined)
              .finally(() => setSelecting(""));
          }}
        >{selecting === candidate.name ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}选择此方案并确认</button>
      </article>
    ))}</div>
    <p><AlertTriangle size={13} />{data.disclaimer}</p>
  </section>;
}

function ValidationView({
  validations, runs, capabilities,
}: {
  validations: Validation[];
  runs: AgentRun[];
  capabilities: Capabilities | null;
}) {
  return <>
    <PageHead title="验证记录" kicker="确定性检查与运行审计" description="只展示实际执行结果；未运行的编译或实物测试不会被标记为通过。" />
    <section className="card execution-boundary">
      <ShieldCheck size={18} />
      <div>
        <strong>{capabilities?.python_execution ? "本机工程执行器已连接" : "当前为云端安全校验模式"}</strong>
        <p>
          {capabilities?.python_execution
            ? "可执行 Python 测试与 PlatformIO 编译；真实硬件仍需人工连接和测试。"
            : "云端可完成 ProjectSpec、硬件规则、协议一致性与代码静态检查；Python 测试、PlatformIO 编译及实物测试保持“未运行”，请导出工程包后在本机执行。"}
        </p>
      </div>
    </section>
    <div className="columns audit-columns">
      <section className="card audit-list">
        <Title kicker="Validation" title="工程验证" extra={<small>{validations.length} 次</small>} />
        {validations.length === 0 && <p className="muted-empty">尚未执行验证。请在硬件、协议或代码页面运行对应检查。</p>}
        {validations.map((item) => (
          <Disclosure
            key={item.id}
            label={item.validator}
            meta={new Date(item.created_at).toLocaleString("zh-CN")}
            badge={<Badge tone={statusTone(item.status)}>{statusText[item.status] ?? item.status}</Badge>}
          ><pre>{JSON.stringify(item.report, null, 2)}</pre></Disclosure>
        ))}
      </section>
      <section className="card audit-list">
        <Title kicker="Agent runs" title="Agent 运行记录" extra={<small>{runs.length} 次</small>} />
        {runs.length === 0 && <p className="muted-empty">还没有 Agent 运行记录。</p>}
        {runs.map((run) => (
          <Disclosure
            key={run.id}
            label={run.task_name}
            meta={`${run.provider} · ${run.model || run.skill}`}
            badge={<Badge tone={run.error ? "danger" : run.requires_confirmation ? "waiting" : "done"}>{run.error ? "失败" : run.requires_confirmation ? "待确认" : "完成"}</Badge>}
          >
            <p>{run.error || run.result_summary || "任务已完成"}</p>
            <small>Token：{run.token_usage.total_tokens ?? 0} · 文件：{run.generated_files.length}</small>
          </Disclosure>
        ))}
      </section>
    </div>
  </>;
}

function Disclosure({
  label, meta, badge, children,
}: {
  label: string;
  meta: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyPresence = useAnimatedPresence(open, 190);
  return <div className={`disclosure ${open ? "open" : ""}`}>
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <ChevronDown size={15} aria-hidden="true" />
      <span><strong>{label}</strong><small>{meta}</small></span>
      {badge}
    </button>
    {bodyPresence.mounted && <div className={`disclosure-body ${bodyPresence.closing ? "is-closing" : ""}`}>{children}</div>}
  </div>;
}

function PageHead({ title, kicker, description, children }: { title: string; kicker: string; description: string; children?: ReactNode }) {
  return <div className="page-head"><div><div className="kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div><div className="actions">{children}</div></div>;
}
function Title({ kicker, title, extra }: { kicker: string; title: string; extra: ReactNode }) {
  return <div className="title-row"><div><span className="kicker">{kicker}</span><h2>{title}</h2></div>{extra}</div>;
}
function Field({ label, placeholder, area = false, value, onChange }: { label: string; placeholder: string; area?: boolean; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span>{area ? <textarea placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /> : <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function DeleteProjectModal({
  project, disabled, closing, close, onDelete,
}: {
  project: ProjectSummary;
  disabled: boolean;
  closing: boolean;
  close: () => void;
  onDelete: () => Promise<void>;
}) {
  const [stage, setStage] = useState<1 | 2>(1);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const matches = confirmation.trim() === project.name;
  const dialogRef = useDialogFocus<HTMLElement>(close);

  return <div className={`backdrop ${closing ? "is-closing" : ""}`} role="presentation">
    <section ref={dialogRef} className="modal-box delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
      <header>
        <div><span className="kicker">危险操作 · 第 {stage}/2 步</span><h2 id="delete-project-title">{stage === 1 ? "确认删除项目？" : `再次确认删除“${project.name}”`}</h2></div>
        <button className="icon" aria-label="关闭删除项目" disabled={deleting} onClick={close}><X size={20} /></button>
      </header>
      <div className="delete-warning">
        <span><Trash2 size={20} /></span>
        <div>
          <strong>项目及全部工程记录将被永久删除</strong>
          <p>包括所有 ProjectSpec 版本、Agent 对话与运行记录、工程文件、验证记录。此操作无法撤销，也不会删除你已经下载的 ZIP 文件。</p>
        </div>
      </div>
      {stage === 1 ? <div className="modal-stage-content" key="delete-stage-1">
        <div className="delete-stage-copy">
          <strong>即将删除：{project.name}</strong>
          <p>请先确认你选中的是正确项目。点击下面的按钮不会立即删除，而是进入第二次名称确认。</p>
        </div>
        <footer>
          <button className="button secondary" onClick={close}>取消</button>
          <button className="button danger" disabled={disabled} onClick={() => setStage(2)}>
            继续，进行二次确认 <ArrowRight size={15} />
          </button>
        </footer>
      </div> : <div className="modal-stage-content" key="delete-stage-2">
        <label className="field delete-confirm-field">
          <span>第二次确认：请输入项目名称 <strong>{project.name}</strong></span>
          <input
            autoFocus
            aria-label="输入项目名称二次确认删除"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={project.name}
          />
        </label>
        <footer>
          <button className="button secondary" disabled={deleting} onClick={() => {
            setConfirmation("");
            setStage(1);
          }}>上一步</button>
          <button
            className="button danger"
            disabled={disabled || deleting || !matches}
            onClick={() => {
              setDeleting(true);
              void onDelete()
                .catch(() => undefined)
                .finally(() => setDeleting(false));
            }}
          >
            {deleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
            {deleting ? "正在删除…" : "确认永久删除"}
          </button>
        </footer>
      </div>}
    </section>
  </div>;
}

function PlanningCreateModal({
  closing,
  close,
  onPlan,
  onCreate,
}: {
  closing: boolean;
  close: () => void;
  onPlan: (description: string) => Promise<ProjectPlan>;
  onCreate: (data: ProjectForm) => Promise<void>;
}) {
  const [idea, setIdea] = useState("");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [projectName, setProjectName] = useState("");
  const [note, setNote] = useState("");
  const [planning, setPlanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus<HTMLDivElement>(close);

  if (advanced) {
    return <CreateModal closing={closing} close={close} onCreate={onCreate} />;
  }

  async function createPlan() {
    if (idea.trim().length < 10) {
      setError("请至少用 10 个字符描述产品目标、使用方式或希望解决的问题。");
      return;
    }
    setPlanning(true);
    setError("");
    try {
      const result = await onPlan(idea.trim());
      const defaults: Record<string, string> = {};
      result.ambiguities.forEach((question) => {
        const recommended = question.options.find((option) => option.recommended) ?? question.options[0];
        if (recommended) defaults[question.id] = recommended.value;
      });
      setSelected(defaults);
      setProjectName(result.proposed_name);
      setPlan(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent 暂时无法生成计划");
    } finally {
      setPlanning(false);
    }
  }

  async function confirmPlan() {
    if (!plan || creating) return;
    if (projectName.trim().length < 2) {
      setError("计划名称至少需要 2 个字符。");
      return;
    }
    const chosen = plan.ambiguities.flatMap((question) => {
      const value = selected[question.id];
      return value ? [{ field: question.field, value, question: question.question }] : [];
    });
    const values = Object.fromEntries(chosen.map((item) => [item.field, item.value]));
    const budget = Number(values.budget_cny);
    const description = [
      idea.trim(),
      "",
      "经用户确认的规划选择：",
      ...chosen.map((item) => `- ${item.question} ${item.value}`),
      note.trim() ? `- 用户补充：${note.trim()}` : "",
    ].filter(Boolean).join("\n");
    setCreating(true);
    setError("");
    try {
      await onCreate({
        name: projectName.trim(),
        description,
        target_user: values.target_user || undefined,
        usage_environment: values.usage_environment || undefined,
        budget_cny: Number.isFinite(budget) && budget > 0
          ? budget
          : undefined,
        experience_level: undefined,
        preferred_controller: values.preferred_controller || undefined,
        communication_preference: values.communication_preference || undefined,
        existing_components: undefined,
        size_constraints: undefined,
        power_constraints: undefined,
        prototype_level: values.prototype_level || undefined,
        avoid_custom_pcb: undefined,
        data_collection_required: undefined,
        machine_learning_required: undefined,
        control_interface_required: undefined,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目创建失败");
    } finally {
      setCreating(false);
    }
  }

  return <div className={`backdrop ${closing ? "is-closing" : ""}`}>
    <div
      ref={dialogRef}
      className={`modal-box planning-modal ${plan ? "has-plan" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="planning-project-title"
    >
      <header>
        <div>
          <span className="kicker">{plan ? "计划确认" : "对话式项目规划"}</span>
          <h2 id="planning-project-title">{plan ? "核对 Agent 的理解与推测" : "你想做一个什么产品？"}</h2>
        </div>
        <button className="icon" aria-label="关闭新建项目" onClick={close}><X size={20} /></button>
      </header>

      {!plan ? <div className="planning-dialog modal-stage-content" key="planning-dialog">
        <div className="planning-agent-message">
          <AgentOrb active={planning} size="medium" />
          <div>
            <strong>先说想法，不需要填写完整表单</strong>
            <p>我会把模糊描述整理成计划，给出推测选项和拟调用工具。确认前不会创建项目或写入 ProjectSpec。</p>
          </div>
        </div>
        <label className="planning-input">
          <span>产品想法</span>
          <textarea
            autoFocus
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            placeholder="例如：我想做一个帮助长时间伏案设计师改善坐姿的桌面装置，能感知使用状态并用柔和方式提醒，但我还不知道该选什么传感器和主控。"
          />
          <small>{idea.length}/6000 · 可以包含目标、用户、场景、交互和已有条件，也可以只说一个模糊概念。</small>
        </label>
        <div className="planning-preview-strip">
          <div><span>1</span><strong>意图识别</strong><small>理解目标与边界</small></div>
          <ChevronRight size={14} />
          <div><span>2</span><strong>计划拆解</strong><small>排列开发步骤</small></div>
          <ChevronRight size={14} />
          <div><span>3</span><strong>推测确认</strong><small>选择推荐或备选</small></div>
          <ChevronRight size={14} />
          <div><span>4</span><strong>工具编排</strong><small>确认后再执行</small></div>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div> : <div className="planning-review modal-stage-content" key="planning-review">
        <div className="planning-conversation">
          <div className="message user"><p>{idea}</p></div>
          <div className="message assistant"><AgentOrb size="small" /><p>{plan.summary}</p></div>
        </div>

        <section className="plan-intent">
          <header><span>模糊意图识别</span><Badge tone={plan.intent.confidence < 0.75 ? "waiting" : "active"}>{Math.round(plan.intent.confidence * 100)}% 置信度</Badge></header>
          <strong>{plan.intent.label}</strong>
          <p>{plan.intent.rationale}</p>
        </section>

        <section className="plan-phases">
          <header><span className="kicker">建议推进计划</span><small>{plan.phases.length} 个阶段</small></header>
          {plan.phases.map((phase, index) => (
            <div key={phase.id}>
              <span>{index + 1}</span>
              <div><strong>{phase.title}</strong><p>{phase.description}</p><small><Settings2 size={12} />{phase.tool}</small></div>
            </div>
          ))}
        </section>

        <section className="plan-ambiguities">
          <header>
            <span className="kicker">需要你选择的推测</span>
            <p>“推荐”只是 Agent 的起点建议；你的选择才会作为用户确认内容写入 ProjectSpec。</p>
          </header>
          {plan.ambiguities.map((question) => (
            <article key={question.id}>
              <div><strong>{question.question}</strong><p>{question.why}</p></div>
              <div className="plan-options">
                {question.options.map((option) => (
                  <button
                    type="button"
                    className={selected[question.id] === option.value ? "selected" : ""}
                    key={`${question.id}-${option.value}`}
                    onClick={() => setSelected((current) => ({ ...current, [question.id]: option.value }))}
                  >
                    <span>{option.recommended ? "推荐" : "备选"}</span>
                    <strong>{option.label}</strong>
                    <p>{option.rationale}</p>
                    {selected[question.id] === option.value && <Check size={15} />}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="plan-confirmation">
          <label><span>计划名称</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
          <label><span>补充或纠正 Agent 的理解（可选）</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：我已有一块开发板，但型号稍后确认；第一版不需要机器学习。" /></label>
          <div>
            <ShieldCheck size={15} />
            <p><strong>执行边界</strong>创建项目只会生成 ProjectSpec 和工程文件；不会采购、烧录、接线、上电或操作真实硬件。</p>
          </div>
        </section>
        {plan.warning && <p className="planning-warning">DeepSeek 本次不可用，当前显示的是安全的确定性规划草案：{plan.warning}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>}

      <footer>
        {!plan ? <>
          <button className="button secondary" disabled={planning} onClick={() => setAdvanced(true)}>使用高级表单</button>
          <button className="button primary" disabled={planning || idea.trim().length < 10} onClick={() => void createPlan()}>
            {planning ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
            {planning ? "Agent 正在规划…" : "让 Agent 先规划"}
          </button>
        </> : <>
          <button className="button secondary" disabled={creating} onClick={() => {
            setPlan(null);
            setSelected({});
            setError("");
          }}>修改想法</button>
          <button className="button primary" disabled={creating} onClick={() => void confirmPlan()}>
            {creating ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {creating ? "正在创建 ProjectSpec…" : "确认计划并创建项目"}
          </button>
        </>}
      </footer>
    </div>
  </div>;
}

function CreateModal({
  closing, close, onCreate,
}: {
  closing: boolean;
  close: () => void;
  onCreate: (data: ProjectForm) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [environment, setEnvironment] = useState("");
  const [actions, setActions] = useState("");
  const [sensing, setSensing] = useState("");
  const [judgement, setJudgement] = useState("");
  const [feedback, setFeedback] = useState("");
  const [abnormal, setAbnormal] = useState("");
  const [controller, setController] = useState("由 Agent 推荐");
  const [communication, setCommunication] = useState("USB 串口");
  const [dataCollection, setDataCollection] = useState(true);
  const [machineLearning, setMachineLearning] = useState(false);
  const [controlInterface, setControlInterface] = useState(true);
  const [budget, setBudget] = useState("1500");
  const [experience, setExperience] = useState("初学者");
  const [existing, setExisting] = useState("");
  const [size, setSize] = useState("待确认");
  const [power, setPower] = useState("USB 5V");
  const [prototypeLevel, setPrototypeLevel] = useState("功能原型");
  const [avoidPcb, setAvoidPcb] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const titles = ["产品目标", "交互与功能", "技术偏好", "现实约束", "确认需求"];
  const dialogRef = useDialogFocus<HTMLDivElement>(close);

  function next() {
    if (step === 1 && (name.trim().length < 2 || concept.trim().length < 10)) {
      setError("请填写至少 2 个字的项目名称和较完整的产品概念。");
      return;
    }
    setError("");
    setStep(Math.min(5, step + 1));
  }

  async function submit() {
    setCreating(true);
    setError("");
    try {
      await onCreate({
        name: name.trim(),
        description: [
          concept.trim(),
          `用户操作：${actions || "待确认"}`,
          `产品感知：${sensing || "待确认"}`,
          `判断逻辑：${judgement || "待确认"}`,
          `反馈方式：${feedback || "待确认"}`,
          `异常情况：${abnormal || "待确认"}`,
        ].join("\n"),
        target_user: targetUser || "待确认",
        usage_environment: environment || "待确认",
        budget_cny: budget ? Number(budget) : undefined,
        experience_level: experience,
        preferred_controller: controller,
        communication_preference: communication,
        existing_components: existing.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean),
        size_constraints: size || "待确认",
        power_constraints: power || "待确认",
        prototype_level: prototypeLevel,
        avoid_custom_pcb: avoidPcb,
        data_collection_required: dataCollection,
        machine_learning_required: machineLearning,
        control_interface_required: controlInterface,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目创建失败");
    } finally {
      setCreating(false);
    }
  }

  return <div className={`backdrop ${closing ? "is-closing" : ""}`}><div ref={dialogRef} className="modal-box" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
    <header><div><span className="kicker">新建项目 · {step}/5</span><h2 id="create-project-title">{titles[step - 1]}</h2></div><button className="icon" aria-label="关闭新建项目" onClick={close}><X size={20} /></button></header>
    <div className="steps">{[1, 2, 3, 4, 5].map((value) => <i className={value <= step ? "filled" : ""} key={value} />)}</div>
    <div className="form-body modal-step-content" key={step}>
      {step === 1 && <>
        <Field label="项目名称" placeholder="例如：桌面呼吸灯原型" value={name} onChange={setName} />
        <Field label="产品概念与要解决的问题" area placeholder="描述产品、目标用户与核心问题…" value={concept} onChange={setConcept} />
        <div className="field-row"><Field label="目标用户" placeholder="例如：长时间伏案的设计师" value={targetUser} onChange={setTargetUser} /><Field label="使用场景" placeholder="例如：室内桌面" value={environment} onChange={setEnvironment} /></div>
      </>}
      {step === 2 && <>
        <Field label="用户如何操作" area placeholder="按、旋转、移动或其他操作…" value={actions} onChange={setActions} />
        <div className="field-row"><Field label="产品感知什么" placeholder="传感器输入或用户数据" value={sensing} onChange={setSensing} /><Field label="如何判断" placeholder="规则、状态机或模型" value={judgement} onChange={setJudgement} /></div>
        <div className="field-row"><Field label="产品如何反馈" placeholder="灯光、声音、运动或界面" value={feedback} onChange={setFeedback} /><Field label="异常情况" placeholder="断线、卡滞、过流等" value={abnormal} onChange={setAbnormal} /></div>
      </>}
      {step === 3 && <>
        <span className="field-label">主控偏好</span>
        <div className="choices">{["由 Agent 推荐", "ESP32-S3", "Arduino", "树莓派"].map((value) => <button type="button" className={controller === value ? "picked" : ""} onClick={() => setController(value)} key={value}><Cpu size={18} />{value}{controller === value && <Check size={15} />}</button>)}</div>
        <div className="field-row modal-row"><div className="field"><span>通信偏好</span><Dropdown
          label="通信偏好"
          value={communication}
          options={["USB 串口", "Wi-Fi", "BLE"].map((value) => ({ value, label: value }))}
          onChange={setCommunication}
        /></div></div>
        <div className="toggles">
          <label>需要 Python 数据采集<input type="checkbox" checked={dataCollection} onChange={(event) => setDataCollection(event.target.checked)} /></label>
          <label>需要基础机器学习<input type="checkbox" checked={machineLearning} onChange={(event) => setMachineLearning(event.target.checked)} /></label>
          <label>需要 Web 控制界面<input type="checkbox" checked={controlInterface} onChange={(event) => setControlInterface(event.target.checked)} /></label>
        </div>
      </>}
      {step === 4 && <>
        <div className="field-row"><Field label="预算（人民币）" placeholder="1500" value={budget} onChange={setBudget} /><Field label="开发经验" placeholder="初学者" value={experience} onChange={setExperience} /></div>
        <Field label="已有硬件（逗号分隔）" placeholder="ESP32-S3 开发板、编码器" value={existing} onChange={setExisting} />
        <div className="field-row"><Field label="尺寸限制" placeholder="待确认" value={size} onChange={setSize} /><Field label="供电限制" placeholder="USB 5V" value={power} onChange={setPower} /></div>
        <div className="field"><span>期望原型完成度</span><Dropdown
          label="期望原型完成度"
          value={prototypeLevel}
          options={["概念验证", "功能原型", "外观与功能联合原型"].map((value) => ({ value, label: value }))}
          onChange={setPrototypeLevel}
        /></div>
        <label className="check"><input type="checkbox" checked={avoidPcb} onChange={(event) => setAvoidPcb(event.target.checked)} /> 第一版避免定制 PCB</label>
      </>}
      {step === 5 && <div className="confirm"><span><Check size={22} /></span><h3>准备创建 ProjectSpec</h3><p>{name} · {controller} · {communication} · 预算 {budget ? `¥${budget}` : "待确认"}。创建后 DeepSeek 将解析需求，所有未知工程参数继续标记为待确认。</p><div><em><Check size={14} />结构化需求</em><em><Check size={14} />来源标记</em><em><Check size={14} />关键澄清问题</em></div></div>}
      {error && <p className="form-error">{error}</p>}
    </div>
    <footer><button className="button secondary" disabled={step === 1 || creating} onClick={() => setStep(Math.max(1, step - 1))}>上一步</button>{step < 5 ? <button className="button primary" onClick={next}>下一步 <ArrowRight size={16} /></button> : <button className="button primary" disabled={creating} onClick={() => void submit()}>{creating ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{creating ? "DeepSeek 正在解析…" : "创建并解析需求"}</button>}</footer>
  </div></div>;
}
