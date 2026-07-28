"use client";

import {
  AlertTriangle, ArrowRight, Bot, Box, Check, ChevronRight, CircleDollarSign,
  Clipboard, ClipboardCheck, Code2, Cpu, Download, FileCode2, FileText,
  FolderOpen, GitBranch, Home, Layers3, LoaderCircle, Menu, PackageSearch,
  Plus, Send, Settings2, ShieldCheck, Sparkles, TestTube2,
  Unplug, X,
} from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type Tone = "done" | "active" | "waiting" | "neutral" | "danger";
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
};
type ProjectForm = {
  name: string;
  description: string;
  target_user: string;
  usage_environment: string;
  budget_cny?: number;
  experience_level: string;
  preferred_controller: string;
  communication_preference: string;
  existing_components: string[];
  size_constraints: string;
  power_constraints: string;
  prototype_level: string;
  avoid_custom_pcb: boolean;
  data_collection_required: boolean;
  machine_learning_required: boolean;
  control_interface_required: boolean;
};

type Capabilities = {
  persistent_projects: boolean;
  deepseek: boolean;
  hosted_static_validation: boolean;
  python_execution: boolean;
  platformio_execution: boolean;
  local_executor_available: boolean;
};

const API_URL = "";
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...(init.headers ?? {}) }
      : init?.headers,
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

export default function HomePage() {
  const [active, setActive] = useState("项目概览");
  const [agentOpen, setAgentOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
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
  const [preview, setPreview] = useState("");

  const loadProject = useCallback(async (projectId: string) => {
    setBusy("正在加载项目");
    setError("");
    try {
      const [projectData, specData, artifactData, messageData, runData, validationData, versionData] =
        await Promise.all([
          request<ProjectSummary>(`/api/projects/${projectId}`),
          request<ProjectSpec>(`/api/projects/${projectId}/spec`),
          request<Artifact[]>(`/api/projects/${projectId}/artifacts`),
          request<Array<{ role: string; content: string; metadata?: { affected_modules?: string[] } }>>(`/api/projects/${projectId}/messages`),
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

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const filteredArtifacts = useMemo(() => {
    const config = moduleConfig[active];
    if (!config) return artifacts;
    return artifacts.filter((item) =>
      config.prefixes.some((prefix) =>
        prefix.endsWith("/") ? item.path.startsWith(prefix) : item.path.startsWith(prefix),
      ),
    );
  }, [active, artifacts]);

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
    setProvider(result.agent.provider === "deepseek" ? `DeepSeek · ${result.agent.model}` : "Mock 模式");
    await loadProject(result.id);
    setMessages([{ role: "agent", text: result.agent.summary }]);
    setCreateOpen(false);
    setActive("项目概览");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    if (!project) {
      setCreateOpen(true);
      return;
    }
    const content = message.trim();
    setMessages((items) => [...items, { role: "user", text: content }]);
    setMessage("");
    setBusy("DeepSeek 正在分析并更新 ProjectSpec");
    try {
      const result = await request<{
        reply: string;
        affected_modules: string[];
        provider: string;
        model: string;
        spec_updated: boolean;
        spec_version: number;
      }>(`/api/projects/${project.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, apply_change: true }),
      });
      setProvider(result.provider === "deepseek" ? `DeepSeek · ${result.model}` : "Mock 模式");
      setMessages((items) => [...items, {
        role: "agent",
        text: result.reply,
        affected: result.affected_modules,
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
      setActive("验证记录");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败");
    } finally {
      setBusy("");
    }
  }

  async function restoreVersion(version: number) {
    if (!project || busy) return;
    setBusy(`正在从 ProjectSpec v${version} 创建恢复版本`);
    setError("");
    try {
      await request(`/api/projects/${project.id}/spec/versions/${version}/restore`, {
        method: "POST",
      });
      await refreshCurrent();
      setActive("需求");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "版本恢复失败");
    } finally {
      setBusy("");
    }
  }

  function exportProject() {
    if (project) window.location.assign(`${API_URL}/api/projects/${project.id}/export`);
  }

  const validationTarget = ["硬件方案", "BOM", "接线"].includes(active)
    ? "hardware"
    : active === "通信协议" ? "protocol"
    : ["固件代码", "Python 程序"].includes(active) ? "code" : undefined;

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Box size={18} /></span>
          <div><strong>智能产品原型工程师</strong><small>Designer Prototype Agent</small></div>
        </div>
        <div className="actions">
          <Badge tone={provider.startsWith("DeepSeek") ? "done" : "neutral"}>{provider}</Badge>
          <button className="button secondary compact agent-toggle" aria-label="打开或关闭 Agent" onClick={() => setAgentOpen(!agentOpen)}><Bot size={16} /> Agent</button>
          <button className="button primary compact" onClick={() => setCreateOpen(true)}><Plus size={16} /> 新建项目</button>
          <button className="icon mobile" onClick={() => setMobileNav(!mobileNav)} aria-label="导航"><Menu size={20} /></button>
        </div>
      </header>

      {error && <div className="global-error"><AlertTriangle size={15} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}
      {busy && <div className="busybar"><LoaderCircle size={14} className="spin" />{busy}</div>}

      <div className={`workspace ${agentOpen ? "" : "no-agent"}`}>
        <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <div className="project-switcher">
            <span>{project?.name.slice(0, 1) ?? "项"}</span>
            <div>
              <select
                aria-label="选择项目"
                value={project?.id ?? ""}
                onChange={(event) => void loadProject(event.target.value)}
              >
                {!project && <option value="">尚未创建项目</option>}
                {projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
              <small>{project ? `ProjectSpec v${project.current_spec_version}` : "请创建项目"}</small>
            </div>
            <ChevronRight size={15} />
          </div>
          <nav>{nav.map(([label, Icon]) => (
            <button
              key={label}
              className={active === label ? "selected" : ""}
              onClick={() => { setActive(label); setMobileNav(false); }}
            >
              <Icon size={17} />{label}
              {label === "验证记录" && validations.length > 0 && <em>{validations.length}</em>}
            </button>
          ))}</nav>
          <div className="safety">
            <ShieldCheck size={18} />
            <div><strong>原型安全边界</strong><p>首次上电前必须人工检查接线。Agent 不能替代专业电气安全评审。</p></div>
          </div>
        </aside>

        <section className="content">
          {!project || !spec ? (
            <EmptyHome loading={Boolean(busy)} onCreate={() => setCreateOpen(true)} />
          ) : active === "项目概览" ? (
            <Overview
              project={project}
              spec={spec}
              artifacts={artifacts}
              validations={validations}
              setActive={setActive}
              exportProject={exportProject}
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
              onGenerate={moduleConfig[active]?.module ? () => void generateCurrent(moduleConfig[active].module!) : undefined}
              onValidate={validationTarget ? () => void validateCurrent(validationTarget) : undefined}
              projectId={project.id}
              spec={active === "需求" ? spec : undefined}
              versions={active === "需求" ? versions : undefined}
              onRestore={restoreVersion}
              disabled={Boolean(busy)}
            />
          )}
        </section>

        {agentOpen && (
          <aside className="agent">
            <div className="agent-head">
              <div><span><Bot size={17} /></span><div><strong>Prototype Engineer</strong><small>● {provider}</small></div></div>
              <button className="icon" aria-label="关闭 Agent" onClick={() => setAgentOpen((open) => !open)}><X size={18} /></button>
            </div>
            <div className="context"><GitBranch size={15} />{project ? `已连接 ProjectSpec v${project.current_spec_version}` : "创建项目后连接上下文"}</div>
            <div className="chat">
              {messages.length === 0 && <div className="message assistant"><span><Bot size={14} /></span><p>告诉我需要修改的产品要求，或询问当前工程方案。我会先分析影响，再更新 ProjectSpec。</p></div>}
              {messages.map((item, index) => (
                <div key={`${item.role}-${index}`}>
                  <div className={`message ${item.role === "agent" ? "assistant" : "user"}`}>
                    {item.role === "agent" && <span><Bot size={14} /></span>}
                    <p>{item.text}</p>
                  </div>
                  {item.affected && item.affected.length > 0 && (
                    <div className="impact"><small>受影响模块</small><div>{item.affected.map((value) => <em key={value}>{value}</em>)}</div></div>
                  )}
                </div>
              ))}
            </div>
            <form className="composer" onSubmit={send}>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="例如：预算降到 1000 元以内…" />
              <div><small>{busy ? "Agent 正在工作…" : "发送后自动记录 ProjectSpec 新版本"}</small><button aria-label="发送消息" disabled={Boolean(busy)}><Send size={16} /></button></div>
            </form>
          </aside>
        )}
      </div>

      {createOpen && <CreateModal close={() => setCreateOpen(false)} onCreate={createProject} />}
    </main>
  );
}

function EmptyHome({ loading, onCreate }: { loading: boolean; onCreate: () => void }) {
  return <div className="empty home-empty">
    <span>{loading ? <LoaderCircle className="spin" /> : <Box />}</span>
    <h2>{loading ? "正在连接工程工作台" : "创建第一个智能产品原型"}</h2>
    <p>用纯文字描述产品目标、交互、技术偏好与现实约束。DeepSeek 会先形成可追踪的 ProjectSpec，再生成工程资产。</p>
    {!loading && <button className="button primary" onClick={onCreate}><Plus size={16} /> 新建项目</button>}
  </div>;
}

function Overview({
  project, spec, artifacts, validations, setActive, exportProject,
}: {
  project: ProjectSummary;
  spec: ProjectSpec;
  artifacts: Artifact[];
  validations: Validation[];
  setActive: (value: string) => void;
  exportProject: () => void;
}) {
  const questions = spec.open_questions ?? [];
  const latestValidations = validations.filter(
    (item, index) => validations.findIndex((entry) => entry.validator === item.validator) === index,
  );
  const failed = latestValidations.filter((item) => item.status === "FAILED").length;
  const budget = spec.constraints.budget_cny.value;
  const stale = artifacts.filter((item) => item.status === "NEEDS_CONFIRMATION").length;
  const phases: [string, Tone, string][] = [
    ["需求分析", "done", `v${project.current_spec_version}`],
    ["系统架构", artifacts.some((x) => x.path.startsWith("02_")) ? "done" : "neutral", "工程资产"],
    ["硬件方案", questions.length ? "waiting" : "active", questions.length ? "待确认" : "进行中"],
    ["软件生成", artifacts.some((x) => x.path.startsWith("04_")) ? "done" : "neutral", "代码资产"],
    ["工程验证", failed ? "danger" : latestValidations.length ? "done" : "neutral", latestValidations.length ? `${latestValidations.length} 类` : "未开始"],
    ["实物测试", "neutral", "用户执行"],
  ];
  return <>
    <PageHead
      title={project.name}
      kicker={`● ProjectSpec v${project.current_spec_version}`}
      description={spec.project.product_goal.value}
    >
      <button className="button secondary" onClick={exportProject}><Download size={16} /> 导出工程包</button>
      <button className="button primary" onClick={() => setActive("需求")}>继续开发 <ArrowRight size={16} /></button>
    </PageHead>
    <section className="card phase-card">
      <Title kicker="开发路径" title="从需求到实物验证" extra={<small>{artifacts.length} 个文件</small>} />
      <div className="phases">{phases.map(([name, tone, detail], index) => (
        <div className={`phase ${tone}`} key={name}>
          <div><span>{tone === "done" ? <Check size={13} /> : index + 1}</span>{index < 5 && <i />}</div>
          <strong>{name}</strong><small>{detail}</small>
        </div>
      ))}</div>
    </section>
    <div className="metrics">
      <Metric icon={<Sparkles />} tone="blue" label="下一步建议" value={questions[0]?.value ?? "运行工程验证"} />
      <Metric icon={<AlertTriangle />} tone="amber" label="待确认与风险" value={`${questions.length + stale} 项待处理`} />
      <Metric icon={<CircleDollarSign />} tone="green" label="BOM 预算" value={budget ? `¥${budget.toLocaleString()} 上限` : "待确认"} />
      <Metric icon={<Code2 />} tone="violet" label="验证状态" value={failed ? `${failed} 项失败` : latestValidations.length ? "最新检查已通过" : "尚未运行"} />
    </div>
    <div className="columns">
      <section className="card panel">
        <Title kicker="ProjectSpec" title="需求事实源" extra={<button className="link" onClick={() => setActive("需求")}>查看全部 <ChevronRight size={14} /></button>} />
        <div className="facts">
          <Fact label="主控" traced={spec.hardware.preferred_controller} />
          <Fact label="通信" traced={spec.hardware.communication.transport} />
          <Fact label="预算" traced={{ ...spec.constraints.budget_cny, value: budget ? `¥${budget}` : "待确认" }} />
          <Fact label="机器学习" traced={{ ...spec.software.machine_learning_required, value: spec.software.machine_learning_required.value ? "需要" : "不需要" }} />
        </div>
      </section>
      <section className="card panel">
        <Title kicker="澄清队列" title="优先处理" extra={<Badge tone={questions.length ? "danger" : "done"}>{questions.length} 项</Badge>} />
        <div className="risks">
          {questions.slice(0, 4).map((item) => <Risk key={item.value} icon={<AlertTriangle />} title={item.value} text={item.notes || "需要用户确认"} />)}
          {questions.length === 0 && <Risk icon={<Check />} title="没有未回答的关键问题" text="可以继续生成和验证工程资产。" />}
        </div>
      </section>
    </div>
  </>;
}

function Fact({ label, traced }: { label: string; traced: Traced<unknown> }) {
  return <div><span>{label}</span><strong>{String(traced.value)}</strong><Badge tone={statusTone(traced.verification_status)}>{statusText[traced.verification_status] ?? traced.source}</Badge></div>;
}

function ModuleView({
  title, description, artifacts, selected, preview, onOpen, onGenerate, onValidate,
  projectId, spec, disabled,
  versions, onRestore,
}: {
  title: string;
  description: string;
  artifacts: Artifact[];
  selected: Artifact | null;
  preview: string;
  onOpen: (item: Artifact) => void;
  onGenerate?: () => void;
  onValidate?: () => void;
  projectId: string;
  spec?: ProjectSpec;
  versions?: SpecVersion[];
  onRestore?: (version: number) => void;
  disabled: boolean;
}) {
  return <>
    <PageHead title={title} kicker="工程模块" description={description}>
      {onValidate && <button className="button secondary" disabled={disabled} onClick={onValidate}><ClipboardCheck size={16} /> 执行验证</button>}
      {onGenerate && <button className="button primary" disabled={disabled} onClick={onGenerate}><Sparkles size={16} /> 使用 DeepSeek 生成</button>}
    </PageHead>
    {spec && <SpecSummary spec={spec} versions={versions ?? []} onRestore={onRestore} disabled={disabled} />}
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

function SpecSummary({
  spec, versions, onRestore, disabled,
}: {
  spec: ProjectSpec;
  versions: SpecVersion[];
  onRestore?: (version: number) => void;
  disabled: boolean;
}) {
  const cards: Array<[string, string, Traced<unknown>]> = [
    ["产品目标", String(spec.project.product_goal.value), spec.project.product_goal],
    ["目标用户", String(spec.user.target_user.value), spec.user.target_user],
    ["使用环境", String(spec.scenario.usage_environment.value), spec.scenario.usage_environment],
    ["主控偏好", String(spec.hardware.preferred_controller.value), spec.hardware.preferred_controller],
    ["预算", spec.constraints.budget_cny.value ? `¥${spec.constraints.budget_cny.value}` : "待确认", spec.constraints.budget_cny],
    ["原型等级", String(spec.project.prototype_level.value), spec.project.prototype_level],
  ];
  return <>
    <div className="spec-grid">{cards.map(([label, value, traced]) => (
      <article className="trace-card" key={label}>
        <div><small>{label}</small><Badge tone={statusTone(traced.verification_status)}>{statusText[traced.verification_status] ?? "待确认"}</Badge></div>
        <strong>{value}</strong>
        <p>来源：{traced.source} · 置信度 {Math.round(traced.confidence * 100)}%</p>
      </article>
    ))}</div>
    <section className="card question-list">
      <Title kicker="Open questions" title="关键待确认问题" extra={<Badge tone="waiting">{spec.open_questions.length} 项</Badge>} />
      {spec.open_questions.map((item) => <div key={item.value}><AlertTriangle size={15} /><span>{item.value}</span></div>)}
      {spec.open_questions.length === 0 && <p>当前没有关键待确认问题。</p>}
    </section>
    <section className="card version-list">
      <Title kicker="Version history" title="ProjectSpec 版本" extra={<small>{versions.length} 个版本</small>} />
      {versions.map((item) => <div key={item.version}>
        <div><strong>v{item.version} · {item.reason}</strong><small>{item.affected_modules.join("、")}</small></div>
        {item.is_current
          ? <Badge tone="done">当前版本</Badge>
          : <button className="button secondary compact" disabled={disabled} onClick={() => onRestore?.(item.version)}>恢复此版本</button>}
      </div>)}
    </section>
  </>;
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
          <details key={item.id}>
            <summary><div><strong>{item.validator}</strong><small>{new Date(item.created_at).toLocaleString("zh-CN")}</small></div><Badge tone={statusTone(item.status)}>{statusText[item.status] ?? item.status}</Badge></summary>
            <pre>{JSON.stringify(item.report, null, 2)}</pre>
          </details>
        ))}
      </section>
      <section className="card audit-list">
        <Title kicker="Agent runs" title="Agent 运行记录" extra={<small>{runs.length} 次</small>} />
        {runs.length === 0 && <p className="muted-empty">还没有 Agent 运行记录。</p>}
        {runs.map((run) => (
          <details key={run.id}>
            <summary><div><strong>{run.task_name}</strong><small>{run.provider} · {run.model || run.skill}</small></div><Badge tone={run.error ? "danger" : run.requires_confirmation ? "waiting" : "done"}>{run.error ? "失败" : run.requires_confirmation ? "待确认" : "完成"}</Badge></summary>
            <p>{run.error || run.result_summary || "任务已完成"}</p>
            <small>Token：{run.token_usage.total_tokens ?? 0} · 文件：{run.generated_files.length}</small>
          </details>
        ))}
      </section>
    </div>
  </>;
}

function PageHead({ title, kicker, description, children }: { title: string; kicker: string; description: string; children?: ReactNode }) {
  return <div className="page-head"><div><div className="kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div><div className="actions">{children}</div></div>;
}
function Title({ kicker, title, extra }: { kicker: string; title: string; extra: ReactNode }) {
  return <div className="title-row"><div><span className="kicker">{kicker}</span><h2>{title}</h2></div>{extra}</div>;
}
function Metric({ icon, tone, label, value }: { icon: ReactNode; tone: string; label: string; value: string }) {
  return <article className="metric"><span className={tone}>{icon}</span><div><small>{label}</small><strong title={value}>{value}</strong></div><ChevronRight size={17} /></article>;
}
function Risk({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="risk">{icon}<div><strong>{title}</strong><small>{text}</small></div></div>;
}
function Field({ label, placeholder, area = false, value, onChange }: { label: string; placeholder: string; area?: boolean; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span>{area ? <textarea placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /> : <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function CreateModal({ close, onCreate }: { close: () => void; onCreate: (data: ProjectForm) => Promise<void> }) {
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

  return <div className="backdrop"><div className="modal-box">
    <header><div><span className="kicker">新建项目 · {step}/5</span><h2>{titles[step - 1]}</h2></div><button className="icon" aria-label="关闭新建项目" onClick={close}><X size={20} /></button></header>
    <div className="steps">{[1, 2, 3, 4, 5].map((value) => <i className={value <= step ? "filled" : ""} key={value} />)}</div>
    <div className="form-body">
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
        <div className="field-row modal-row"><label className="field"><span>通信偏好</span><select value={communication} onChange={(event) => setCommunication(event.target.value)}><option>USB 串口</option><option>Wi-Fi</option><option>BLE</option></select></label></div>
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
        <label className="field"><span>期望原型完成度</span><select value={prototypeLevel} onChange={(event) => setPrototypeLevel(event.target.value)}><option>概念验证</option><option>功能原型</option><option>外观与功能联合原型</option></select></label>
        <label className="check"><input type="checkbox" checked={avoidPcb} onChange={(event) => setAvoidPcb(event.target.checked)} /> 第一版避免定制 PCB</label>
      </>}
      {step === 5 && <div className="confirm"><span><Check size={22} /></span><h3>准备创建 ProjectSpec</h3><p>{name} · {controller} · {communication} · 预算 {budget ? `¥${budget}` : "待确认"}。创建后 DeepSeek 将解析需求，所有未知工程参数继续标记为待确认。</p><div><em><Check size={14} />结构化需求</em><em><Check size={14} />来源标记</em><em><Check size={14} />关键澄清问题</em></div></div>}
      {error && <p className="form-error">{error}</p>}
    </div>
    <footer><button className="button secondary" disabled={step === 1 || creating} onClick={() => setStep(Math.max(1, step - 1))}>上一步</button>{step < 5 ? <button className="button primary" onClick={next}>下一步 <ArrowRight size={16} /></button> : <button className="button primary" disabled={creating} onClick={() => void submit()}>{creating ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{creating ? "DeepSeek 正在解析…" : "创建并解析需求"}</button>}</footer>
  </div></div>;
}
