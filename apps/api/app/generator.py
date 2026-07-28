from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any

import yaml

from .schemas import (
    BOMItemSchema, BoolValue, CommunicationSpec, ComponentSelection, ConstraintSpec, HardwareSpec,
    InteractionSpec, ListValue, NumberValue, ProjectCreate, ProjectInfo, ProjectSpec,
    ScenarioSpec, SoftwareSpec, Source, SystemSpec, TextValue, UserInfo, VerificationStatus,
)
from .validators import HardwareValidator, bom_totals

SAFETY = """\
> 安全提示：Agent 生成内容仅用于原型开发辅助。首次上电前必须人工检查接线；
> 电机和大电流负载必须使用合适驱动器，禁止 GPIO 直接驱动高功率负载；
> 必须确认电压和最大电流，机械运动设备需要急停。实物结果必须由用户确认。
"""


def traced(value: str, source: Source, confidence: float, verified: bool = False, notes: str = "") -> TextValue:
    return TextValue(
        value=value, source=source, confidence=confidence,
        verification_status=VerificationStatus.SPEC_VERIFIED if verified else VerificationStatus.NEEDS_CONFIRMATION,
        notes=notes,
    )


def create_initial_spec(data: ProjectCreate) -> ProjectSpec:
    user_value = lambda value: traced(value, Source.USER, 1, True)  # noqa: E731
    agent_value = lambda value, confidence=.78: traced(value, Source.AGENT, confidence)  # noqa: E731
    preferred_controller = (
        "ESP32-S3" if data.preferred_controller == "由 Agent 推荐"
        else data.preferred_controller
    )
    controller = ComponentSelection(
        category="controller", model=agent_value(preferred_controller, .72),
        operating_voltage=NumberValue(value=None, notes="具体开发板供电范围待查数据手册"),
        logic_voltage=NumberValue(value=None, notes="具体开发板逻辑电平待查正式数据手册"),
        interface=agent_value("USB serial / GPIO", .8),
    )
    return ProjectSpec(
        project=ProjectInfo(
            name=user_value(data.name), description=user_value(data.description),
            product_goal=agent_value(f"验证“{data.name}”的核心交互与工程可行性", .76),
            prototype_level=user_value(data.prototype_level),
        ),
        user=UserInfo(target_user=user_value(data.target_user), experience_level=user_value(data.experience_level)),
        scenario=ScenarioSpec(usage_environment=user_value(data.usage_environment)),
        interaction=InteractionSpec(
            user_actions=ListValue(value=["按产品概念完成核心操作"], source=Source.AGENT, confidence=.65),
            system_inputs=ListValue(value=["待从描述进一步澄清"], source=Source.PENDING),
            system_outputs=ListValue(value=["待从描述进一步澄清"], source=Source.PENDING),
            abnormal_conditions=ListValue(value=["传感器断开", "通信超时", "执行器卡滞"], source=Source.TEMPLATE),
        ),
        system=SystemSpec(
            functional_modules=ListValue(value=["感知输入", "状态处理", "反馈输出", "通信与日志"], source=Source.AGENT),
            data_flow=ListValue(value=["传感器 → ESP32 → USB 串口 → Python / Web"], source=Source.AGENT),
            control_flow=ListValue(value=["初始化 → 自检 → 待机 → 交互 → 故障安全"], source=Source.TEMPLATE),
            states=ListValue(value=["BOOT", "SELF_TEST", "IDLE", "ACTIVE", "ERROR"], source=Source.TEMPLATE),
            safety_states=ListValue(value=["SAFE_STOP", "POWER_LIMIT"], source=Source.TEMPLATE),
        ),
        hardware=HardwareSpec(
            preferred_controller=agent_value(preferred_controller, .72),
            controllers=[controller],
            communication=CommunicationSpec(transport=user_value(data.communication_preference)),
            existing_components=ListValue(
                value=data.existing_components, source=Source.USER, confidence=1,
                verification_status=VerificationStatus.USER_CONFIRMED,
            ),
        ),
        software=SoftwareSpec(
            data_collection_required=BoolValue(
                value=data.data_collection_required, source=Source.USER, confidence=1
            ),
            machine_learning_required=BoolValue(
                value=data.machine_learning_required, source=Source.USER, confidence=1
            ),
            control_interface_required=BoolValue(
                value=data.control_interface_required, source=Source.USER, confidence=1
            ),
        ),
        constraints=ConstraintSpec(
            budget_cny=NumberValue(
                value=data.budget_cny, source=Source.USER if data.budget_cny else Source.PENDING,
                confidence=1 if data.budget_cny else .5,
                verification_status=VerificationStatus.SPEC_VERIFIED if data.budget_cny else VerificationStatus.NEEDS_CONFIRMATION,
            ),
            size_constraints=user_value(data.size_constraints),
            power_constraints=user_value(data.power_constraints),
            avoid_custom_pcb=BoolValue(
                value=data.avoid_custom_pcb, source=Source.USER, confidence=1,
                verification_status=VerificationStatus.USER_CONFIRMED,
            ),
        ),
        assumptions=[agent_value("第一版采用低压、桌面、有人值守的功能原型", .65)],
        open_questions=[
            TextValue(value="核心传感器与执行器的具体类型是什么？"),
            TextValue(value="供电方式、尺寸和连续运行时长要求是什么？"),
            TextValue(value="哪些风险会涉及人体或机械安全？"),
        ],
    )


def smart_ring_spec() -> ProjectSpec:
    data = ProjectCreate(
        name="智能专注指环", target_user="希望通过触觉交互进入专注状态的用户",
        usage_environment="室内桌面，有人值守",
        budget_cny=1500, experience_level="编程经验较少",
        description=(
            "通过旋转指环采集速度、方向变化、停顿与时长，经 USB 串口发送给电脑；"
            "Python 保存数据并用基础模型识别稳定专注状态，设备据此调整电机阻尼。"
        ),
    )
    spec = create_initial_spec(data)
    spec.interaction.user_actions = ListValue(value=["旋转指环", "暂停旋转", "开始或结束会话"], source=Source.USER, confidence=1)
    spec.interaction.system_inputs = ListValue(value=["旋转速度", "方向变化", "停顿时间", "使用时长"], source=Source.USER, confidence=1)
    spec.interaction.system_outputs = ListValue(value=["阻尼等级", "状态与错误日志", "电脑端状态"], source=Source.USER, confidence=1)
    spec.hardware.sensors = [ComponentSelection(
        category="sensor", model=traced("增量式旋转编码器（型号待确认）", Source.AGENT, .8),
        interface=traced("数字脉冲 A/B 相", Source.AGENT, .78),
    )]
    spec.hardware.actuators = [ComponentSelection(
        category="actuator", model=traced("阻尼执行器／电机（方案待实验）", Source.AGENT, .6),
        interface=traced("由匹配驱动器控制", Source.AGENT, .7),
        notes="禁止由开发板 GPIO 直接驱动",
    )]
    spec.software.machine_learning_required = BoolValue(value=True, source=Source.USER, confidence=1)
    spec.hardware.communication.transport = traced("USB serial", Source.USER, 1, True)
    spec.open_questions = [
        TextValue(value="阻尼范围、响应速度和允许噪声是多少？"),
        TextValue(value="旋转编码器的机械接口、分辨率和工作电压是多少？"),
        TextValue(value="电机额定与启动电流是多少，是否需要独立电源？"),
    ]
    return spec


def build_bom(spec: ProjectSpec) -> list[BOMItemSchema]:
    items = [
        BOMItemSchema(id="BOM-001", category="主控", component_name=spec.hardware.preferred_controller.value,
                      quantity=1, function="数据采集、状态机与串口通信",
                      selection_reason="满足 MVP 的 USB 串口与实时 IO 需求",
                      notes="示例选型，需要查看具体开发板正式数据手册后确认"),
        BOMItemSchema(id="BOM-002", category="电源", component_name="低压原型电源",
                      quantity=1, function="为主控及负载供电",
                      selection_reason="电源规格需在所有负载参数确认后计算",
                      notes="额定电压、电流及启动余量待确认"),
        BOMItemSchema(id="BOM-003", category="连接", component_name="USB 数据线与连接器",
                      quantity=1, function="供电、调试与串口通信",
                      selection_reason="MVP 优先使用 USB 串口"),
        BOMItemSchema(id="BOM-004", category="保护", component_name="保险／急停保护模块",
                      quantity=1, function="机械或大电流异常时人工断电",
                      selection_reason="含运动执行器的原型应保留硬件级停机措施"),
    ]
    for index, component in enumerate([*spec.hardware.sensors, *spec.hardware.actuators, *spec.hardware.motor_drivers], 5):
        items.append(BOMItemSchema(
            id=f"BOM-{index:03}", category=component.category, component_name=component.model.value,
            quantity=1, function="由 ProjectSpec 定义", interface_type=component.interface.value,
            selection_reason="来自当前 ProjectSpec 的工程方案",
            notes=component.notes or "规格和价格需要查看正式数据手册后确认",
        ))
    return items


def _slug(name: str) -> str:
    ascii_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return ascii_slug or f"project-{hashlib.sha1(name.encode()).hexdigest()[:8]}"


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_json(path: Path, value: Any) -> None:
    _write(path, json.dumps(value, ensure_ascii=False, indent=2))


def generate_workspace(spec: ProjectSpec, root: Path, original_description: str) -> list[Path]:
    project_dir = root / _slug(spec.project.name.value)
    if project_dir.exists():
        shutil.rmtree(project_dir)
    folders = [
        "00_input", "01_requirements", "02_architecture", "03_hardware",
        "04_firmware/include", "04_firmware/src", "04_firmware/test",
        "05_python/src/prototype", "05_python/tests", "05_python/data_collection",
        "05_python/training", "05_python/inference", "05_python/communication",
        "06_interface/frontend", "06_interface/backend", "07_protocol", "08_testing", "09_reports",
    ]
    for folder in folders:
        (project_dir / folder).mkdir(parents=True, exist_ok=True)
    files: list[Path] = []

    def save(relative: str, content: str) -> None:
        path = project_dir / relative
        _write(path, content)
        files.append(path)

    def save_json(relative: str, value: Any) -> None:
        path = project_dir / relative
        _write_json(path, value)
        files.append(path)

    spec_dict = spec.model_dump(mode="json")
    save("00_input/original-description.md", f"# 原始产品描述\n\n{original_description}\n")
    save_json("01_requirements/project-spec.json", spec_dict)
    save("01_requirements/project-spec.yaml", yaml.safe_dump(spec_dict, allow_unicode=True, sort_keys=False))
    save("01_requirements/assumptions.md", "# 假设\n\n" + "\n".join(f"- {x.value}（{x.source}）" for x in spec.assumptions))
    confirmation_lines = [
        (
            f"- [x] {item.value}\n  - {item.notes or '用户已确认'}"
            if item.verification_status == VerificationStatus.USER_CONFIRMED
            else f"- [ ] {item.value}"
        )
        for item in spec.open_questions
    ]
    save(
        "01_requirements/open-questions.md",
        "# 需求确认记录\n\n" + ("\n".join(confirmation_lines) or "- 无"),
    )
    save("02_architecture/functional-architecture.md", "# 功能架构\n\n" + "\n".join(f"- {x}" for x in spec.system.functional_modules.value))
    save("02_architecture/system-flow.md", "# 系统输入—处理—输出\n\n输入 → 主控采集与状态机 → 串口与反馈输出\n")
    save("02_architecture/data-flow.md", "# 数据流\n\n" + "\n".join(f"- {x}" for x in spec.system.data_flow.value))
    save("02_architecture/control-flow.md", "# 控制流\n\n" + "\n".join(f"- {x}" for x in spec.system.control_flow.value))
    save("02_architecture/state-machine.md", "# 状态机\n\n```text\nBOOT → SELF_TEST → IDLE ⇄ ACTIVE\n                    ↓\n                  ERROR → SAFE_STOP\n```\n")

    bom = [item.model_dump(mode="json") for item in build_bom(spec)]
    save_json("03_hardware/bom.json", bom)
    with (project_dir / "03_hardware/bom.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(bom[0].keys()))
        writer.writeheader()
        for item in bom:
            writer.writerow({key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value for key, value in item.items()})
    files.append(project_dir / "03_hardware/bom.csv")
    save("03_hardware/component-selection.md", "# 器件选型\n\n所有未核对规格保持“待确认”。优先查本地目录，其次提供搜索建议。\n")
    save("03_hardware/wiring-table.csv", "signal,controller_pin,device_pin,direction,voltage,status\nUSB Serial,USB,USB,bidirectional,待确认,NEEDS_CONFIRMATION\n")
    totals = bom_totals(bom, spec.constraints.budget_cny.value)
    save("03_hardware/power-budget.csv", "item,typical_ma,peak_ma,source,status\n系统合计,待确认,待确认,程序计算,NEEDS_CONFIRMATION\n")
    report = HardwareValidator().validate(spec).model_dump(mode="json")
    save_json("03_hardware/hardware-validation.json", report)

    protocol_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema", "protocol_version": "1.0.0",
        "transport": "usb_serial", "framing": "newline_delimited_json", "baud_rate": 115200,
        "max_message_bytes": 512, "required": ["type", "request_id"],
        "commands": ["ping", "get_status", "set_output"], "error_codes": ["INVALID_JSON", "UNKNOWN_COMMAND", "INVALID_PAYLOAD", "INTERNAL_ERROR"],
    }
    save_json("07_protocol/protocol.schema.json", protocol_schema)
    save_json("07_protocol/error-codes.json", {code: {"zh-CN": code.replace("_", " ")} for code in protocol_schema["error_codes"]})
    save("07_protocol/protocol.md", "# USB 串口协议\n\n版本 1.0.0，115200 baud，UTF-8 换行分隔 JSON，最大 512 字节。\n\n请求必须包含 `type`、`request_id`、`name` 与 `payload`。超时 1000 ms，最多重试 2 次。\n")

    save("04_firmware/platformio.ini", """[env:esp32-s3-devkitc-1]\nplatform = espressif32\nboard = esp32-s3-devkitc-1\nframework = arduino\nmonitor_speed = 115200\nbuild_flags = -D PROTOCOL_VERSION=\\\"1.0.0\\\"\n""")
    save("04_firmware/include/protocol.h", """#pragma once\nconstexpr unsigned long SERIAL_BAUD = 115200;\nconstexpr size_t MAX_MESSAGE_BYTES = 512;\nconstexpr const char* PROTOCOL_VERSION_TEXT = "1.0.0";\nconstexpr const char* PROTOCOL_COMMANDS = "ping,get_status,set_output";\nconstexpr const char* PROTOCOL_ERROR_CODES = "INVALID_JSON,UNKNOWN_COMMAND,INVALID_PAYLOAD,INTERNAL_ERROR";\n""")
    save("04_firmware/src/main.cpp", """#include <Arduino.h>\n#include "protocol.h"\n\nString line;\nvoid respond(const String& id, const String& status) {\n  Serial.printf("{\\\"type\\\":\\\"response\\\",\\\"request_id\\\":\\\"%s\\\",\\\"status\\\":\\\"%s\\\",\\\"protocol_version\\\":\\\"%s\\\"}\\n", id.c_str(), status.c_str(), PROTOCOL_VERSION_TEXT);\n}\nvoid setup() { Serial.begin(SERIAL_BAUD); Serial.setTimeout(1000); }\nvoid loop() {\n  while (Serial.available()) {\n    char c = static_cast<char>(Serial.read());\n    if (c == '\\n') { if (line.length() > 0) respond("unparsed", "received"); line = ""; }\n    else if (line.length() < MAX_MESSAGE_BYTES) line += c;\n    else { line = ""; Serial.println("{\\\"type\\\":\\\"error\\\",\\\"code\\\":\\\"MESSAGE_TOO_LONG\\\"}"); }\n  }\n}\n""")
    save("04_firmware/test/test_protocol.cpp", """#include <unity.h>\n#include "protocol.h"\nvoid test_limits() { TEST_ASSERT_EQUAL_UINT32(115200, SERIAL_BAUD); TEST_ASSERT_EQUAL_UINT32(512, MAX_MESSAGE_BYTES); }\nvoid setup(){ UNITY_BEGIN(); RUN_TEST(test_limits); UNITY_END(); }\nvoid loop(){}\n""")
    save("04_firmware/README.md", f"# ESP32 固件\n\n`pio run` 编译，`pio device monitor` 查看串口。\n\n{SAFETY}\n")

    save("05_python/pyproject.toml", """[project]\nname="prototype-client"\nversion="0.1.0"\nrequires-python=">=3.11"\ndependencies=["pyserial>=3.5","pydantic>=2.10"]\n[tool.pytest.ini_options]\npythonpath=["src"]\n""")
    save("05_python/src/prototype/protocol.py", """from __future__ import annotations\nimport json\nfrom dataclasses import dataclass\n\nPROTOCOL_VERSION = "1.0.0"\nBAUD_RATE = 115200\nMAX_MESSAGE_BYTES = 512\nCOMMANDS = ["ping", "get_status", "set_output"]\nERROR_CODES = ["INVALID_JSON", "UNKNOWN_COMMAND", "INVALID_PAYLOAD", "INTERNAL_ERROR"]\n\n@dataclass(frozen=True)\nclass Message:\n    type: str\n    request_id: str\n    name: str | None = None\n    payload: dict | None = None\n    def encode(self) -> bytes:\n        data = (json.dumps(self.__dict__, ensure_ascii=False, separators=(",", ":")) + "\\n").encode()\n        if len(data) > MAX_MESSAGE_BYTES: raise ValueError("message exceeds protocol limit")\n        return data\n""")
    save("05_python/data_collection/collect.py", """import argparse, json, time\nfrom pathlib import Path\nimport serial\n\ndef main() -> None:\n    parser=argparse.ArgumentParser(); parser.add_argument("--port", required=True); parser.add_argument("--output", default="data.jsonl"); args=parser.parse_args()\n    with serial.Serial(args.port, 115200, timeout=1) as port, Path(args.output).open("a", encoding="utf-8") as output:\n        while True:\n            line=port.readline()\n            if line:\n                record={"host_time":time.time(),"device":json.loads(line)}; output.write(json.dumps(record,ensure_ascii=False)+"\\n"); output.flush()\nif __name__=="__main__": main()\n""")
    save("05_python/training/train.py", """\"\"\"Baseline placeholder-free training entrypoint.\nProvide labeled JSONL before running; exits clearly when data is absent.\n\"\"\"\nfrom pathlib import Path\nimport json\n\ndef load(path: Path) -> list[dict]:\n    if not path.exists(): raise FileNotFoundError("需要先采集并标注数据")\n    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]\nif __name__=="__main__": print(f"loaded {len(load(Path('labeled-data.jsonl')))} labeled samples")\n""")
    save("05_python/inference/infer.py", """def classify(rotation_speed: float, direction_changes: int, pause_ratio: float) -> str:\n    \"\"\"Transparent baseline until a validated trained model replaces it.\"\"\"\n    if rotation_speed >= 0 and direction_changes <= 3 and pause_ratio < 0.4: return "stable_candidate"\n    return "not_stable"\n""")
    save("05_python/tests/test_protocol.py", """from prototype.protocol import Message\n\ndef test_message_is_newline_delimited():\n    assert Message("command","abc","ping",{}).encode().endswith(b"\\n")\n""")
    save("05_python/README.md", "# Python 原型工具\n\n安装 `pip install -e .`，运行采集器时必须显式提供串口名。\n")
    save("06_interface/frontend/README.md", "# 项目控制界面\n\n运行 `python ../backend/server.py` 后打开 `http://localhost:8765`。界面只在本地有人值守模式发送经过白名单校验的原型命令。\n")
    save("06_interface/frontend/index.html", """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>原型控制台</title><link rel="stylesheet" href="style.css"></head>
<body><main><header><div><small>LOCAL PROTOTYPE CONSOLE</small><h1>原型控制台</h1></div><span id="status">未连接硬件</span></header>
<section><label>输出等级 <output id="value">0</output></label><input id="level" type="range" min="0" max="100" value="0">
<div><button data-command="ping">连接测试</button><button data-command="get_status">读取状态</button><button id="apply">应用输出</button></div></section>
<pre id="log">安全提示：首次上电前人工检查接线；本界面不会自动连接或操作硬件。</pre></main>
<script src="app.js"></script></body></html>
""")
    save("06_interface/frontend/style.css", """*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#202733;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif}main{width:min(680px,calc(100% - 32px));margin:64px auto}header,section,pre{background:#fff;border:1px solid #e1e4e8;border-radius:12px;padding:22px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}h1{font-size:24px;margin:5px 0 0}small{color:#5368c7}header span{font-size:12px;color:#9a641a;background:#fff3df;padding:7px 10px;border-radius:6px}label{display:flex;justify-content:space-between;font-weight:600}input{width:100%;margin:24px 0}section div{display:flex;gap:8px}button{border:1px solid #d9dde4;background:#fff;border-radius:7px;padding:9px 12px;cursor:pointer}button:last-child{background:#4b64d9;color:#fff;border-color:#4b64d9}pre{min-height:150px;white-space:pre-wrap;font:12px/1.7 ui-monospace,monospace;color:#56606d}
""")
    save("06_interface/frontend/app.js", """const level=document.querySelector("#level");const value=document.querySelector("#value");const log=document.querySelector("#log");const status=document.querySelector("#status");
level.addEventListener("input",()=>value.textContent=level.value);
async function command(name,payload={}){const response=await fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"command",request_id:crypto.randomUUID(),name,payload})});const result=await response.json();log.textContent=JSON.stringify(result,null,2);status.textContent=result.status==="accepted"?"命令已校验":"请求失败";}
document.querySelectorAll("[data-command]").forEach(button=>button.addEventListener("click",()=>command(button.dataset.command)));
document.querySelector("#apply").addEventListener("click",()=>command("set_output",{level:Number(level.value)}));
""")
    save("06_interface/backend/README.md", "# 控制接口\n\n从此目录运行 `python server.py`。服务只监听本机并执行协议白名单校验；默认不会连接串口或真实硬件。\n")
    save("06_interface/backend/server.py", """from __future__ import annotations
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ALLOWED_COMMANDS = {"ping", "get_status", "set_output"}
FRONTEND = Path(__file__).resolve().parents[1] / "frontend"

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def do_POST(self) -> None:
        if self.path != "/api/command":
            self.send_error(404); return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 512: raise ValueError("message exceeds 512 bytes")
            message = json.loads(self.rfile.read(size))
            if message.get("type") != "command" or not message.get("request_id"):
                raise ValueError("type and request_id are required")
            if message.get("name") not in ALLOWED_COMMANDS:
                raise ValueError("unknown command")
            result = {"type": "response", "request_id": message["request_id"], "status": "accepted",
                      "message": "仅完成本地协议校验；未连接或操作真实硬件"}
            self._json(200, result)
        except (ValueError, json.JSONDecodeError) as error:
            self._json(422, {"type": "error", "code": "INVALID_PAYLOAD", "message": str(error)})

    def _json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

if __name__ == "__main__":
    print("Local prototype console: http://localhost:8765")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
""")

    test_cases = [
        ["T-001", "首次上电", "断开执行器并限流上电", "主控无异常发热"],
        ["T-002", "串口协议", "发送 ping 与未知命令", "返回响应与 UNKNOWN_COMMAND"],
        ["T-003", "安全状态", "模拟通信超时", "进入 SAFE_STOP"],
        ["T-004", "连续运行", "连续记录 2 小时", "无丢包、内存增长或过热"],
    ]
    save("08_testing/test-cases.csv", "id,category,steps,expected_result\n" + "\n".join(",".join(row) for row in test_cases) + "\n")
    save("08_testing/test-plan.md", f"# 原型测试计划\n\n覆盖单元、模块、集成、首次上电、安全、连续运行、异常和用户操作测试。\n\n{SAFETY}\n")
    save("08_testing/first-power-on-checklist.md", "# 首次上电检查\n\n- [ ] 断电核对接线\n- [ ] 核对每个器件电压\n- [ ] 执行器使用驱动器与独立电源\n- [ ] 共地与极性正确\n- [ ] 限流上电并监控温升\n- [ ] 急停可触达\n")
    save("08_testing/troubleshooting.md", "# 故障排查\n\n1. 立即断电并记录现象。\n2. 分离电源、主控、传感器、执行器逐级测试。\n3. 不得绕过保险、限流或驱动器。\n")
    save("09_reports/engineering-summary.md", f"# 工程摘要\n\n项目：{spec.project.name.value}\n\n当前方案是待实物核对的功能原型，不是量产或安全认证设计。\n")
    save_json("09_reports/validation-report.json", {"hardware": report, "bom": totals, "compile": "NOT_RUN"})
    save("09_reports/validation-report.md", f"# 验证报告\n\n- 硬件错误：{len(report['errors'])}\n- 硬件警告：{len(report['warnings'])}\n- 固件编译：未运行，不得视为通过\n")
    save("README.md", f"# {spec.project.name.value}\n\n{spec.project.description.value}\n\n## 快速开始\n\n1. 先阅读 `01_requirements/project-spec.json`。\n2. 核对 `03_hardware` 中的待确认项。\n3. 执行首次上电清单后再连接真实硬件。\n4. 固件与 Python 分别见对应目录。\n\n{SAFETY}\n")
    return files


def affected_modules(message: str) -> list[str]:
    rules = {
        ("主控", "esp32", "raspberry", "arduino"): ["ProjectSpec", "硬件选型", "GPIO", "电压", "通信协议", "固件", "电源", "BOM", "接线", "测试", "README"],
        ("预算", "元以内", "成本"): ["ProjectSpec", "BOM", "替代方案", "工程摘要"],
        ("舵机", "电机", "执行器", "步进"): ["ProjectSpec", "执行器", "驱动器", "BOM", "电源预算", "接线", "固件", "安全测试"],
        ("协议", "波特率", "串口"): ["ProjectSpec", "协议 Schema", "固件", "Python", "文档", "协议测试"],
        ("机器学习", "模型", "训练"): ["ProjectSpec", "数据采集", "特征", "训练", "推理", "测试"],
    }
    impacted: list[str] = []
    lowered = message.lower()
    for keywords, modules in rules.items():
        if any(word in lowered for word in keywords):
            impacted.extend(modules)
    return list(dict.fromkeys(impacted or ["ProjectSpec", "需求文档", "测试计划"]))
