import type {
  ArtifactDraft,
  ComponentSelection,
  ProjectCreateInput,
  ProjectSpec,
  RequirementExtraction,
  Source,
  Traced,
  VerificationStatus,
} from "./types";

const now = () => new Date().toISOString();

function traced<T>(
  value: T,
  source: Source,
  confidence: number,
  verification_status: VerificationStatus,
  notes = "",
): Traced<T> {
  return { value, source, confidence, verification_status, notes };
}

const pendingText = (value = "待确认", notes = "") =>
  traced(value, "pending_confirmation", 0.5, "NEEDS_CONFIRMATION", notes);
const pendingNumber = (notes = "") =>
  traced<number | null>(null, "pending_confirmation", 0.5, "NEEDS_CONFIRMATION", notes);
const userText = (value: string) =>
  traced(value, "user_provided", 1, "USER_CONFIRMED");
const userBool = (value: boolean) =>
  traced(value, "user_provided", 1, "USER_CONFIRMED");
const agentText = (value: string, confidence = 0.76) =>
  traced(value || "待确认", "agent_recommendation", confidence, "NEEDS_CONFIRMATION", "由 DeepSeek 从用户文字提取或推断，需要用户确认");
const agentList = (value: string[], confidence = 0.74) =>
  traced(value, "agent_recommendation", confidence, "NEEDS_CONFIRMATION", "由 DeepSeek 从用户文字提取或推断，需要用户确认");

export function createProjectSpec(
  id: string,
  input: ProjectCreateInput,
  extraction: RequirementExtraction,
): ProjectSpec {
  const timestamp = now();
  const explicitController =
    input.preferred_controller && input.preferred_controller !== "由 Agent 推荐"
      ? input.preferred_controller
      : null;
  const controllerName = explicitController || extraction.preferred_controller || "待确认";
  const controllerModel = explicitController
    ? userText(controllerName)
    : agentText(controllerName, 0.66);
  const controller: ComponentSelection = {
    category: "controller",
    model: controllerModel,
    operating_voltage: pendingNumber("具体开发板供电范围需要查看正式数据手册"),
    logic_voltage: pendingNumber("具体开发板逻辑电平需要查看正式数据手册"),
    max_current_ma: pendingNumber("需要查看正式数据手册并实测"),
    interface: pendingText("待确认", "根据具体开发板型号核对接口能力"),
    pins: {},
    i2c_address: null,
    notes: "未指定具体开发板型号前，不生成引脚和电气参数。",
  };
  const questions = [...extraction.must_confirm_questions, ...extraction.safety_flags]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 8);
  const budget = typeof input.budget_cny === "number"
    ? traced<number | null>(input.budget_cny, "user_provided", 1, "USER_CONFIRMED")
    : pendingNumber("预算由用户确认后才能计算");
  return {
    schema_version: "1.0.0",
    project: {
      id,
      name: userText(input.name),
      description: userText(input.description),
      product_goal: agentText(extraction.product_goal),
      prototype_level: userText(input.prototype_level || "功能原型"),
      status: questions.length ? "NEEDS_CONFIRMATION" : "DRAFT",
      created_at: timestamp,
      updated_at: timestamp,
    },
    user: {
      target_user: input.target_user && input.target_user !== "待确认"
        ? userText(input.target_user)
        : agentText(extraction.target_user),
      experience_level: userText(input.experience_level || "初学者"),
      preferred_language: traced("zh-CN", "template_default", 1, "SPEC_VERIFIED"),
    },
    scenario: {
      usage_environment: input.usage_environment && input.usage_environment !== "待确认"
        ? userText(input.usage_environment)
        : agentText(extraction.usage_environment),
      usage_process: agentList(extraction.usage_process),
      frequency: pendingText(),
      environmental_constraints: traced([], "pending_confirmation", 0.5, "NEEDS_CONFIRMATION"),
    },
    interaction: {
      user_actions: agentList(extraction.user_actions),
      system_inputs: agentList(extraction.system_inputs),
      system_outputs: agentList(extraction.system_outputs),
      feedback_methods: agentList(extraction.feedback_methods),
      abnormal_conditions: agentList(extraction.abnormal_conditions),
    },
    system: {
      functional_modules: agentList(extraction.functional_modules),
      data_flow: agentList(extraction.data_flow),
      control_flow: agentList(extraction.control_flow),
      states: agentList(extraction.states),
      safety_states: agentList(extraction.safety_states),
    },
    hardware: {
      preferred_controller: controllerModel,
      controllers: [controller],
      sensors: [],
      actuators: [],
      motor_drivers: [],
      communication: {
        transport: userText(input.communication_preference || "USB 串口"),
        baud_rate: traced(115200, "template_default", 1, "SPEC_VERIFIED", "协议默认值，可由版本化需求修改"),
        protocol_version: "1.0.0",
      },
      power_supply: {
        voltage: pendingNumber("根据全部负载和供电约束计算"),
        rated_current_ma: pendingNumber("需要确认负载持续与启动电流"),
        source_type: input.power_constraints && input.power_constraints !== "待确认"
          ? userText(input.power_constraints)
          : pendingText(),
      },
      existing_components: traced(input.existing_components || [], "user_provided", 1, "USER_CONFIRMED"),
    },
    software: {
      firmware_platform: traced("PlatformIO / Arduino", "template_default", 0.9, "NEEDS_CONFIRMATION"),
      computer_language: traced(["Python", "TypeScript", "C++"], "template_default", 0.9, "NEEDS_CONFIRMATION"),
      data_collection_required: userBool(input.data_collection_required ?? true),
      machine_learning_required: userBool(input.machine_learning_required ?? false),
      control_interface_required: userBool(input.control_interface_required ?? true),
    },
    constraints: {
      budget_cny: budget,
      size_constraints: input.size_constraints && input.size_constraints !== "待确认"
        ? userText(input.size_constraints)
        : pendingText(),
      power_constraints: input.power_constraints && input.power_constraints !== "待确认"
        ? userText(input.power_constraints)
        : pendingText(),
      avoid_custom_pcb: userBool(input.avoid_custom_pcb ?? true),
      preferred_components: traced([], "pending_confirmation", 0.5, "NEEDS_CONFIRMATION"),
      forbidden_components: traced([], "pending_confirmation", 0.5, "NEEDS_CONFIRMATION"),
    },
    assumptions: extraction.assumptions.map((value) => agentText(value, 0.6)),
    open_questions: questions.map((value) =>
      traced(value, "agent_recommendation", 0.88, "NEEDS_CONFIRMATION", "DeepSeek 识别的关键缺失信息")),
    verification: {
      requirement_status: questions.length ? "NEEDS_CONFIRMATION" : "DRAFT",
      hardware_status: "DRAFT",
      firmware_status: "DRAFT",
      software_status: "DRAFT",
      physical_test_status: "HARDWARE_PENDING",
    },
  };
}

type BomItem = {
  id: string;
  category: string;
  component_name: string;
  manufacturer: string;
  model: string;
  quantity: number;
  function: string;
  key_specifications: Record<string, string>;
  operating_voltage: string;
  current_requirement: string;
  interface_type: string;
  selection_reason: string;
  estimated_unit_price_cny: null;
  estimated_total_price_cny: null;
  alternative_models: string[];
  datasheet_url: null;
  source: Source;
  verification_status: VerificationStatus;
  notes: string;
};

function buildBom(spec: ProjectSpec): BomItem[] {
  const base: BomItem[] = [
    ["BOM-001", "主控", spec.hardware.preferred_controller.value, "数据采集、状态机与通信", "来自 ProjectSpec 的主控偏好"],
    ["BOM-002", "电源", "低压原型电源（规格待确认）", "为主控和负载供电", "负载参数确认后才能完成选型"],
    ["BOM-003", "连接", "USB 数据线与连接器", "供电、调试与通信", "MVP 优先使用用户指定通信方式"],
    ["BOM-004", "保护", "保险／急停保护方案（规格待确认）", "异常时人工断电", "运动或大电流负载必须保留安全措施"],
  ].map(([id, category, component, fn, reason]) => ({
    id, category, component_name: component, manufacturer: "待确认", model: "待确认",
    quantity: 1, function: fn, key_specifications: {}, operating_voltage: "待确认",
    current_requirement: "待确认", interface_type: "待确认", selection_reason: reason,
    estimated_unit_price_cny: null, estimated_total_price_cny: null,
    alternative_models: [], datasheet_url: null, source: "pending_confirmation" as Source,
    verification_status: "NEEDS_CONFIRMATION" as VerificationStatus,
    notes: "需要查看具体型号的正式数据手册；价格待查询。",
  }));
  const selected = [
    ...spec.hardware.sensors,
    ...spec.hardware.actuators,
    ...spec.hardware.motor_drivers,
  ];
  selected.forEach((component, index) => base.push({
    id: `BOM-${String(index + 5).padStart(3, "0")}`,
    category: component.category,
    component_name: component.model.value,
    manufacturer: "待确认",
    model: component.model.value,
    quantity: 1,
    function: "由 ProjectSpec 定义",
    key_specifications: {},
    operating_voltage: component.operating_voltage.value === null ? "待确认" : String(component.operating_voltage.value),
    current_requirement: component.max_current_ma.value === null ? "待确认" : String(component.max_current_ma.value),
    interface_type: component.interface.value,
    selection_reason: "来自当前 ProjectSpec",
    estimated_unit_price_cny: null,
    estimated_total_price_cny: null,
    alternative_models: [],
    datasheet_url: null,
    source: component.model.source,
    verification_status: component.model.verification_status,
    notes: component.notes || "需要查看正式数据手册并进行实物测试。",
  }));
  return base;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);
const csvEscape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const header = (specVersion: number) => `<!-- ProjectSpec v${specVersion} -->\n\n`;

export function protocolDefinition(spec: ProjectSpec) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    protocol_version: spec.hardware.communication.protocol_version,
    transport: "usb_serial",
    framing: "newline_delimited_json",
    baud_rate: spec.hardware.communication.baud_rate.value,
    max_message_bytes: 512,
    required_fields: ["type", "request_id", "name", "payload"],
    commands: ["ping", "get_status", "set_output"],
    error_codes: ["INVALID_JSON", "UNKNOWN_COMMAND", "INVALID_PAYLOAD", "INTERNAL_ERROR"],
    timeout_ms: 1000,
    max_retries: 2,
  };
}

export function generateArtifacts(
  spec: ProjectSpec,
  originalDescription: string,
  specVersion: number,
): ArtifactDraft[] {
  const bom = buildBom(spec);
  const protocol = protocolDefinition(spec);
  const safety = "Agent 生成内容仅用于低压、有人值守的原型辅助。首次上电前必须人工检查接线；电机和大电流负载必须使用合适驱动器，禁止 GPIO 直接驱动；确认电压、最大电流和启动电流；运动机构保留急停。";
  const bomCsv = [
    Object.keys(bom[0]).join(","),
    ...bom.map((item) => Object.values(item).map((value) =>
      csvEscape(typeof value === "object" ? JSON.stringify(value) : value)).join(",")),
  ].join("\n");
  const files: ArtifactDraft[] = [
    { path: "00_input/original-description.md", content: `# 原始产品描述\n\n${originalDescription}\n` },
    { path: "01_requirements/project-spec.json", content: json(spec) },
    { path: "01_requirements/project-spec.yaml", content: `# JSON 是 YAML 1.2 的有效子集\n${json(spec)}\n` },
    { path: "01_requirements/assumptions.md", content: `# 假设\n\n${spec.assumptions.map((item) => `- ${item.value}（${item.source}）`).join("\n") || "- 无"}\n` },
    { path: "01_requirements/open-questions.md", content: `# 待确认问题\n\n${spec.open_questions.map((item) => `- ${item.value}`).join("\n") || "- 无"}\n` },
    { path: "02_architecture/functional-architecture.md", content: header(specVersion) + `# 功能架构\n\n${spec.system.functional_modules.value.map((item) => `- ${item}`).join("\n") || "- 待确认"}\n` },
    { path: "02_architecture/system-flow.md", content: header(specVersion) + "# 系统输入—处理—输出\n\n用户输入／传感器 → 主控状态机 → 反馈输出／通信日志\n" },
    { path: "02_architecture/data-flow.md", content: header(specVersion) + `# 数据流\n\n${spec.system.data_flow.value.map((item) => `- ${item}`).join("\n") || "- 待确认"}\n` },
    { path: "02_architecture/control-flow.md", content: header(specVersion) + `# 控制流\n\n${spec.system.control_flow.value.map((item) => `- ${item}`).join("\n") || "- 待确认"}\n` },
    { path: "02_architecture/state-machine.md", content: header(specVersion) + `# 状态机\n\n状态：${spec.system.states.value.join(" → ") || "待确认"}\n\n安全状态：${spec.system.safety_states.value.join("、") || "待确认"}\n` },
    { path: "03_hardware/bom.json", content: json(bom) },
    { path: "03_hardware/bom.csv", content: bomCsv + "\n" },
    { path: "03_hardware/component-selection.md", content: header(specVersion) + `# 器件选型\n\n主控偏好：${spec.hardware.preferred_controller.value}\n\n所有未核对规格与价格保持“待确认”，需要查看具体型号正式数据手册。\n` },
    { path: "03_hardware/wiring-table.csv", content: "signal,controller_pin,device_pin,direction,voltage,status\nUSB Serial,USB,USB,bidirectional,待确认,NEEDS_CONFIRMATION\n" },
    { path: "03_hardware/power-budget.csv", content: "item,typical_ma,peak_ma,source,status\n系统合计,待确认,待确认,program_calculated,NEEDS_CONFIRMATION\n" },
    { path: "03_hardware/hardware-validation.json", content: json(validateHardware(spec)) },
    { path: "07_protocol/protocol.schema.json", content: json(protocol) },
    { path: "07_protocol/error-codes.json", content: json(Object.fromEntries(protocol.error_codes.map((code) => [code, { "zh-CN": "需要按协议处理" }]))) },
    { path: "07_protocol/protocol.md", content: header(specVersion) + `# USB 串口协议\n\n版本 ${protocol.protocol_version}，${protocol.baud_rate} baud，UTF-8 换行分隔 JSON，最大 ${protocol.max_message_bytes} 字节。\n\n必填字段：${protocol.required_fields.join("、")}。超时 ${protocol.timeout_ms} ms，最多重试 ${protocol.max_retries} 次。\n` },
    { path: "04_firmware/platformio.ini", content: `[env:esp32-s3-devkitc-1]\nplatform = espressif32\nboard = esp32-s3-devkitc-1\nframework = arduino\nmonitor_speed = ${protocol.baud_rate}\nbuild_flags = -D PROTOCOL_VERSION=\\\"${protocol.protocol_version}\\\"\n` },
    { path: "04_firmware/include/protocol.h", content: `#pragma once\nconstexpr unsigned long SERIAL_BAUD = ${protocol.baud_rate};\nconstexpr size_t MAX_MESSAGE_BYTES = ${protocol.max_message_bytes};\nconstexpr const char* PROTOCOL_VERSION_TEXT = "${protocol.protocol_version}";\nconstexpr const char* PROTOCOL_COMMANDS = "${protocol.commands.join(",")}";\nconstexpr const char* PROTOCOL_ERROR_CODES = "${protocol.error_codes.join(",")}";\n` },
    { path: "04_firmware/src/main.cpp", content: `#include <Arduino.h>\n#include "protocol.h"\n\nString line;\nvoid respond(const String& id, const String& status) {\n  Serial.printf("{\\"type\\":\\"response\\",\\"request_id\\":\\"%s\\",\\"status\\":\\"%s\\",\\"protocol_version\\":\\"%s\\"}\\n", id.c_str(), status.c_str(), PROTOCOL_VERSION_TEXT);\n}\nvoid setup() { Serial.begin(SERIAL_BAUD); Serial.setTimeout(1000); }\nvoid loop() {\n  while (Serial.available()) {\n    const char c = static_cast<char>(Serial.read());\n    if (c == '\\n') { if (line.length() > 0) respond("unparsed", "received"); line = ""; }\n    else if (line.length() < MAX_MESSAGE_BYTES) line += c;\n    else { line = ""; Serial.println("{\\"type\\":\\"error\\",\\"code\\":\\"INVALID_PAYLOAD\\"}"); }\n  }\n}\n` },
    { path: "04_firmware/test/test_protocol.cpp", content: `#include <unity.h>\n#include "protocol.h"\nvoid test_limits(){ TEST_ASSERT_EQUAL_UINT32(${protocol.baud_rate}, SERIAL_BAUD); TEST_ASSERT_EQUAL_UINT32(${protocol.max_message_bytes}, MAX_MESSAGE_BYTES); }\nvoid setup(){ UNITY_BEGIN(); RUN_TEST(test_limits); UNITY_END(); }\nvoid loop(){}\n` },
    { path: "04_firmware/README.md", content: header(specVersion) + `# ESP32 固件\n\n运行 \`pio run\` 编译，\`pio device monitor\` 查看串口。\n\n> ${safety}\n` },
    { path: "05_python/pyproject.toml", content: `[project]\nname="prototype-client"\nversion="0.1.0"\nrequires-python=">=3.11"\ndependencies=["pyserial>=3.5","pydantic>=2.10"]\n[tool.pytest.ini_options]\npythonpath=["src"]\n` },
    { path: "05_python/src/prototype/__init__.py", content: `"""ProjectSpec v${specVersion} prototype client."""\n` },
    { path: "05_python/src/prototype/protocol.py", content: `from __future__ import annotations\nimport json\nfrom dataclasses import dataclass\n\nPROTOCOL_VERSION = "${protocol.protocol_version}"\nBAUD_RATE = ${protocol.baud_rate}\nMAX_MESSAGE_BYTES = ${protocol.max_message_bytes}\nCOMMANDS = ${JSON.stringify(protocol.commands)}\nERROR_CODES = ${JSON.stringify(protocol.error_codes)}\n\n@dataclass(frozen=True)\nclass Message:\n    type: str\n    request_id: str\n    name: str | None = None\n    payload: dict | None = None\n    def encode(self) -> bytes:\n        data=(json.dumps(self.__dict__,ensure_ascii=False,separators=(",",":"))+"\\n").encode()\n        if len(data)>MAX_MESSAGE_BYTES: raise ValueError("message exceeds protocol limit")\n        return data\n` },
    { path: "05_python/communication/client.py", content: `from __future__ import annotations\nimport json\nimport uuid\nimport serial\nfrom prototype.protocol import BAUD_RATE, Message\n\ndef request(port_name: str, name: str, payload: dict | None = None) -> dict:\n    message=Message("command",str(uuid.uuid4()),name,payload or {})\n    with serial.Serial(port_name,BAUD_RATE,timeout=1) as port:\n        port.write(message.encode()); line=port.readline()\n    if not line: raise TimeoutError("device response timeout")\n    return json.loads(line)\n` },
    { path: "05_python/data_collection/collect.py", content: `import argparse,json,time\nfrom pathlib import Path\nimport serial\nfrom prototype.protocol import BAUD_RATE\n\ndef main()->None:\n    parser=argparse.ArgumentParser();parser.add_argument("--port",required=True);parser.add_argument("--output",default="data.jsonl");args=parser.parse_args()\n    with serial.Serial(args.port,BAUD_RATE,timeout=1) as port,Path(args.output).open("a",encoding="utf-8") as output:\n        while True:\n            line=port.readline()\n            if line: output.write(json.dumps({"host_time":time.time(),"device":json.loads(line)},ensure_ascii=False)+"\\n");output.flush()\nif __name__=="__main__":main()\n` },
    { path: "05_python/training/train.py", content: `from __future__ import annotations\nimport json\nfrom pathlib import Path\n\ndef load(path:Path)->list[dict]:\n    if not path.exists(): raise FileNotFoundError("需要先采集并标注数据")\n    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]\nif __name__=="__main__": print(f"loaded {len(load(Path('labeled-data.jsonl')))} labeled samples")\n` },
    { path: "05_python/inference/infer.py", content: `def classify(rotation_speed:float,direction_changes:int,pause_ratio:float)->str:\n    """透明规则基线；采集并验证数据后才能替换为训练模型。"""\n    if rotation_speed>=0 and direction_changes<=3 and pause_ratio<0.4:return "stable_candidate"\n    return "not_stable"\n` },
    { path: "05_python/tests/test_protocol.py", content: `from prototype.protocol import Message\n\ndef test_message_is_newline_delimited():\n    assert Message("command","abc","ping",{}).encode().endswith(b"\\n")\n` },
    { path: "05_python/README.md", content: header(specVersion) + "# Python 原型工具\n\n安装 `pip install -e .`。运行采集器时必须显式提供串口名；不会自动操作硬件。\n" },
    { path: "06_interface/frontend/index.html", content: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原型控制台</title><link rel="stylesheet" href="style.css"></head><body><main><h1>原型控制台</h1><p>ProjectSpec v${specVersion} · 本地有人值守模式</p><label>输出等级 <output id="value">0</output></label><input id="level" type="range" min="0" max="100" value="0"><button id="apply">校验命令</button><pre id="log">${safety}</pre></main><script src="app.js"></script></body></html>` },
    { path: "06_interface/frontend/style.css", content: `*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#202733;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif}main{width:min(680px,calc(100% - 32px));margin:64px auto;background:#fff;border:1px solid #e1e4e8;border-radius:12px;padding:24px}label{display:flex;justify-content:space-between}input{width:100%;margin:24px 0}button{background:#4b64d9;color:#fff;border:0;border-radius:7px;padding:10px 14px}pre{white-space:pre-wrap;background:#f6f7f9;padding:14px}` },
    { path: "06_interface/frontend/app.js", content: `const level=document.querySelector("#level"),value=document.querySelector("#value"),log=document.querySelector("#log");level.addEventListener("input",()=>value.textContent=level.value);document.querySelector("#apply").addEventListener("click",()=>{log.textContent=JSON.stringify({type:"command",request_id:crypto.randomUUID(),name:"set_output",payload:{level:Number(level.value)}},null,2)+"\\n仅完成命令校验，未连接硬件。"});` },
    { path: "06_interface/backend/server.py", content: `from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer\nfrom pathlib import Path\nFRONTEND=Path(__file__).resolve().parents[1]/"frontend"\nclass Handler(SimpleHTTPRequestHandler):\n    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(FRONTEND),**kwargs)\nif __name__=="__main__":ThreadingHTTPServer(("127.0.0.1",8765),Handler).serve_forever()\n` },
    { path: "06_interface/frontend/README.md", content: header(specVersion) + "# 项目控制界面\n\n从 backend 目录运行 `python server.py` 后打开 `http://localhost:8765`。\n" },
    { path: "06_interface/backend/README.md", content: header(specVersion) + "# 控制接口\n\n默认只提供本地静态控制台，不会自动连接、烧录或操作真实硬件。\n" },
    { path: "08_testing/test-cases.csv", content: "id,category,steps,expected_result,status\nT-001,首次上电,断开执行器并限流上电,主控无异常发热,NOT_RUN\nT-002,串口协议,发送 ping 与未知命令,返回响应与 UNKNOWN_COMMAND,NOT_RUN\nT-003,安全状态,模拟通信超时,进入 SAFE_STOP,NOT_RUN\nT-004,连续运行,连续记录并观察,无丢包或过热,NOT_RUN\n" },
    { path: "08_testing/test-plan.md", content: header(specVersion) + `# 原型测试计划\n\n覆盖单元、模块、集成、首次上电、安全、连续运行、异常和用户操作测试。\n\n> ${safety}\n` },
    { path: "08_testing/first-power-on-checklist.md", content: header(specVersion) + "# 首次上电检查\n\n- [ ] 断电核对接线\n- [ ] 核对每个器件电压\n- [ ] 执行器使用合适驱动器与电源\n- [ ] 共地与极性正确\n- [ ] 限流上电并监控温升\n- [ ] 急停可触达\n" },
    { path: "08_testing/troubleshooting.md", content: header(specVersion) + "# 故障排查\n\n1. 立即断电并记录现象。\n2. 分离电源、主控、传感器、执行器逐级测试。\n3. 不得绕过保险、限流或驱动器。\n" },
    { path: "09_reports/engineering-summary.md", content: header(specVersion) + `# 工程摘要\n\n项目：${spec.project.name.value}\n\n当前方案是待实物核对的功能原型，不是量产或安全认证设计。\n` },
    { path: "09_reports/validation-report.json", content: json({ hardware: validateHardware(spec), compile: "NOT_RUN", physical_test: "HARDWARE_PENDING" }) },
    { path: "09_reports/validation-report.md", content: header(specVersion) + "# 验证报告\n\n- 硬件规则：请查看 hardware-validation.json\n- Python 测试：未运行\n- 固件编译：未运行，不得视为通过\n- 实物测试：等待用户执行\n" },
    { path: "README.md", content: `# ${spec.project.name.value}\n\n${spec.project.description.value}\n\nProjectSpec v${specVersion}。\n\n## 快速开始\n\n1. 阅读 \`01_requirements/project-spec.json\`。\n2. 核对硬件待确认项。\n3. 执行首次上电清单后再连接真实硬件。\n4. 分别查看固件、Python 与控制界面说明。\n\n> ${safety}\n` },
  ];
  return files;
}

export function validateHardware(spec: ProjectSpec) {
  const errors: Record<string, unknown>[] = [];
  const warnings: Record<string, unknown>[] = [];
  const recommendations: Record<string, unknown>[] = [];
  const passed: Record<string, unknown>[] = [];
  const components = [
    ...spec.hardware.controllers,
    ...spec.hardware.sensors,
    ...spec.hardware.actuators,
    ...spec.hardware.motor_drivers,
  ];
  const pinUsers = new Map<number, string[]>();
  components.forEach((component) => Object.entries(component.pins).forEach(([signal, pin]) => {
    pinUsers.set(pin, [...(pinUsers.get(pin) || []), `${component.model.value}:${signal}`]);
  }));
  pinUsers.forEach((users, pin) => {
    if (users.length > 1) errors.push({
      level: "error", code: "GPIO_CONFLICT", title: `GPIO ${pin} 重复占用`,
      detail: "同一物理引脚被多个信号占用。", affected_items: users,
      recommendation: "重新分配引脚并同步固件、接线表和文档。",
    });
  });
  const addresses = new Map<string, string[]>();
  spec.hardware.sensors.forEach((component) => {
    if (component.i2c_address) addresses.set(component.i2c_address, [
      ...(addresses.get(component.i2c_address) || []), component.model.value,
    ]);
  });
  addresses.forEach((users, address) => {
    if (users.length > 1) errors.push({
      level: "error", code: "I2C_ADDRESS_CONFLICT", title: `I²C 地址 ${address} 冲突`,
      detail: "多个器件共享同一地址。", affected_items: users,
      recommendation: "修改地址、增加多路复用器或更换器件。",
    });
  });
  const motorLike = spec.hardware.actuators.filter((item) =>
    /motor|电机|servo|舵机|stepper|步进/i.test(item.model.value));
  if (motorLike.length && !spec.hardware.motor_drivers.length) errors.push({
    level: "error", code: "MOTOR_DRIVER_MISSING", title: "电机驱动器缺失",
    detail: "执行器包含电机类负载，但 ProjectSpec 未定义驱动器。",
    affected_items: motorLike.map((item) => item.model.value),
    recommendation: "根据正式数据手册中的电压、持续与启动电流选择驱动器。",
  });
  if (components.some((item) => item.max_current_ma.value === null)) warnings.push({
    level: "warning", code: "POWER_BUDGET_INCOMPLETE", title: "电源预算不完整",
    detail: "至少一个器件的电流参数仍为待确认。",
    affected_items: components.filter((item) => item.max_current_ma.value === null).map((item) => item.model.value),
    recommendation: "查阅正式数据手册并测量启动峰值电流。",
  });
  if (spec.hardware.power_supply.voltage.value === null) warnings.push({
    level: "warning", code: "POWER_VOLTAGE_UNKNOWN", title: "供电电压待确认",
    detail: "系统电源电压尚未形成可核对数值。", affected_items: [],
    recommendation: "首次上电前逐项核对电源、主控、传感器和执行器电压。",
  });
  recommendations.push({
    level: "recommendation", code: "FIRST_POWER_ON", title: "执行首次上电检查",
    detail: "断开执行器，限流上电并逐路验证。", affected_items: [],
    recommendation: "保留急停，禁止 GPIO 直接驱动高功率负载。",
  });
  if (!errors.length) passed.push({
    level: "passed", code: "NO_DETERMINISTIC_CONFLICT_FOUND", title: "未发现已知硬冲突",
    detail: "这不代表未确认参数或实物测试已经通过。", affected_items: [],
  });
  return { generated_at: now(), errors, warnings, recommendations, passed };
}

export function validateProtocolArtifacts(artifacts: Array<{ path: string; content: string }>) {
  const byPath = new Map(artifacts.map((item) => [item.path, item.content]));
  const schemaText = byPath.get("07_protocol/protocol.schema.json");
  const headerText = byPath.get("04_firmware/include/protocol.h") || "";
  const pythonText = byPath.get("05_python/src/prototype/protocol.py") || "";
  const errors: Record<string, unknown>[] = [];
  if (!schemaText) {
    errors.push({ level: "error", code: "SCHEMA_MISSING", title: "协议 Schema 缺失", detail: "无法执行一致性检查。" });
  } else {
    const schema = JSON.parse(schemaText) as ReturnType<typeof protocolDefinition>;
    const checks = [
      ["固件波特率", headerText.includes(`SERIAL_BAUD = ${schema.baud_rate}`)],
      ["固件协议版本", headerText.includes(`"${schema.protocol_version}"`)],
      ["固件最大消息长度", headerText.includes(`MAX_MESSAGE_BYTES = ${schema.max_message_bytes}`)],
      ["Python 波特率", pythonText.includes(`BAUD_RATE = ${schema.baud_rate}`)],
      ["Python 协议版本", pythonText.includes(`PROTOCOL_VERSION = "${schema.protocol_version}"`)],
      ["Python 最大消息长度", pythonText.includes(`MAX_MESSAGE_BYTES = ${schema.max_message_bytes}`)],
    ] as const;
    checks.filter(([, ok]) => !ok).forEach(([name]) => errors.push({
      level: "error", code: "PROTOCOL_MISMATCH", title: `${name}不一致`,
      detail: "Schema、固件与 Python 必须同步。", affected_items: [name],
    }));
  }
  return {
    generated_at: now(),
    errors,
    warnings: [],
    recommendations: [],
    passed: errors.length ? [] : [{
      level: "passed", code: "PROTOCOL_CONSISTENT", title: "协议静态一致性通过",
      detail: "已比较协议版本、波特率和最大消息长度；未替代真实串口测试。",
      affected_items: [],
    }],
  };
}

export function validateCodeArtifacts(artifacts: Array<{ path: string; content: string }>) {
  const required = [
    "04_firmware/platformio.ini",
    "04_firmware/src/main.cpp",
    "04_firmware/include/protocol.h",
    "05_python/pyproject.toml",
    "05_python/src/prototype/protocol.py",
    "05_python/tests/test_protocol.py",
  ];
  const paths = new Set(artifacts.map((item) => item.path));
  const missing = required.filter((path) => !paths.has(path));
  const status = missing.length ? "FAILED" : "NEEDS_CONFIRMATION";
  return {
    status,
    hosted_static_check: {
      status: missing.length ? "FAILED" : "CODE_VALIDATED",
      missing_files: missing,
      message: missing.length
        ? "生成代码缺少必需文件。"
        : "网页端已完成文件与协议静态检查。",
    },
    python: {
      status: "NOT_RUN",
      message: "托管网页不能启动 Python 进程。请下载工程包，在本地运行 pytest。",
    },
    firmware: {
      status: "NOT_RUN",
      message: "托管网页不能运行 PlatformIO。请下载工程包，在本地执行 pio run。",
    },
  };
}
