from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .generator import create_initial_spec
from .providers import ModelProvider
from .schemas import (
    BoolValue,
    ComponentRecommendationSet,
    ListValue,
    ProjectCreate,
    ProjectSpec,
    RequirementChange,
    RequirementExtraction,
    Source,
    TextValue,
    VerificationStatus,
)

SYSTEM_GUARDRAILS = """\
你是 Prototype Engineer Orchestrator，服务对象是缺少完整电子与软件经验的工业设计师。
ProjectSpec 是唯一需求事实来源。你可以解释、推理和提出候选方案，但不得编造器件引脚、
工作电压、电流、通信地址、价格、库存或兼容性。无法从用户输入确认的工程参数必须明确写成
“待确认”“需要查看数据手册”或“需要用户实物测试”。不要输出内部思维过程，只输出结论、
证据来源、风险和下一步。涉及真实硬件时必须保留人工接线检查、合适驱动器、限流和急停提醒。
"""

SENSITIVE_ENGINEERING_CLAIM = re.compile(
    r"(?:电压|电流|功率|逻辑电平|阈值|引脚|gpio|i²c|i2c|地址|兼容|供电能力|"
    r"额定|峰值|库存|价格|直驱|直接驱动|电平转换|"
    r"(?:esp32|arduino|树莓派|raspberry).{0,24}(?:支持|驱动|兼容|可用)|"
    r"\d+(?:\.\d+)?\s*(?:v|ma|a|w|hz|khz|mhz|ω|ohm|%))",
    re.IGNORECASE,
)


def sanitize_recommendation_narrative(value: str) -> str:
    safe = "；".join(
        sentence.strip()
        for sentence in re.split(r"[。；;]\s*", value)
        if sentence.strip() and not SENSITIVE_ENGINEERING_CLAIM.search(sentence)
    )
    return safe or (
        "与当前原型的适配方向可供比较；具体电气参数和兼容性需要查看正式数据手册"
        "并进行实物测试。"
    )


def normalize_verification_item(value: str) -> str:
    lowered = value.lower()
    if re.search(r"电压|供电|逻辑电平|阈值", lowered):
        return "工作电压与逻辑电平：查看正式数据手册"
    if re.search(r"电流|功率|温升|额定|峰值", lowered):
        return "持续／峰值电流、功率与温升：查看数据手册并实测"
    if re.search(r"引脚|gpio|i²c|i2c|spi|uart|接口|协议|兼容", lowered):
        return "接口、引脚、协议与主控兼容性：查看双方正式数据手册"
    if re.search(r"尺寸|安装|机械|公差", lowered):
        return "机械尺寸、安装方式与公差：查看图纸并进行实物测试"
    if re.search(r"寿命|耐久|连续运行|噪声", lowered):
        return "寿命、耐久、连续运行与噪声：需要用户实物测试"
    if SENSITIVE_ENGINEERING_CLAIM.search(value):
        return "具体参数：查看正式数据手册并进行实物测试"
    return value.strip()[:180]


@dataclass
class AgentOutput:
    content: str
    provider: str
    model: str
    usage: dict[str, Any]
    requires_confirmation: bool = False


@dataclass
class ProjectMessageResult:
    output: AgentOutput
    updated_spec: ProjectSpec | None
    affected_modules: list[str]


class PrototypeEngineerOrchestrator:
    def __init__(self, provider: ModelProvider):
        self.provider = provider

    def _output(self, content: str, requires_confirmation: bool = False) -> AgentOutput:
        return AgentOutput(
            content=content,
            provider=self.provider.provider_name,
            model=self.provider.last_model,
            usage=self.provider.last_usage,
            requires_confirmation=requires_confirmation,
        )

    async def interpret_requirements(self, data: ProjectCreate) -> tuple[ProjectSpec, AgentOutput]:
        spec = create_initial_spec(data)
        if self.provider.provider_name == "mock":
            return spec, self._output("Mock 模式：已使用确定性模板生成 ProjectSpec 初稿。", True)

        prompt = f"""\
把以下纯文字产品概念解析为结构化需求提取结果。只提取或合理推断产品层需求，不得填入未经
数据手册验证的器件参数。问题按“会阻塞系统架构或安全验证”的优先级排序，最多 5 个。

项目名称：{data.name}
产品描述：{data.description}
目标用户：{data.target_user}
使用环境：{data.usage_environment}
预算人民币：{data.budget_cny if data.budget_cny is not None else "待确认"}
用户经验：{data.experience_level}
主控偏好：{data.preferred_controller}
通信偏好：{data.communication_preference}
已有硬件：{'、'.join(data.existing_components) or '无'}
尺寸限制：{data.size_constraints}
供电限制：{data.power_constraints}
原型完成度：{data.prototype_level}
是否避免定制 PCB：{data.avoid_custom_pcb}
需要数据采集：{data.data_collection_required}
需要机器学习：{data.machine_learning_required}
需要控制界面：{data.control_interface_required}
"""
        extracted_data = await self.provider.generate_json(
            [
                {"role": "system", "content": SYSTEM_GUARDRAILS},
                {"role": "user", "content": prompt},
            ],
            RequirementExtraction,
            role="reasoning",
        )
        extracted = RequirementExtraction.model_validate(extracted_data)
        spec = self._merge_extraction(spec, extracted)
        if data.preferred_controller != "由 Agent 推荐":
            confirmed_controller = TextValue(
                value=data.preferred_controller,
                source=Source.USER,
                confidence=1,
                verification_status=VerificationStatus.USER_CONFIRMED,
                notes="用户在新建项目表单中明确指定",
            )
            spec.hardware.preferred_controller = confirmed_controller
            if spec.hardware.controllers:
                spec.hardware.controllers[0].model = confirmed_controller.model_copy(deep=True)
        spec.software.data_collection_required = BoolValue(
            value=data.data_collection_required,
            source=Source.USER,
            confidence=1,
            verification_status=VerificationStatus.USER_CONFIRMED,
        )
        spec.software.machine_learning_required = BoolValue(
            value=data.machine_learning_required,
            source=Source.USER,
            confidence=1,
            verification_status=VerificationStatus.USER_CONFIRMED,
        )
        spec.software.control_interface_required = BoolValue(
            value=data.control_interface_required,
            source=Source.USER,
            confidence=1,
            verification_status=VerificationStatus.USER_CONFIRMED,
        )
        return spec, self._output(
            f"DeepSeek 已解析需求并生成 {len(extracted.must_confirm_questions)} 个关键澄清问题。",
            bool(extracted.must_confirm_questions),
        )

    def _merge_extraction(
        self, spec: ProjectSpec, extracted: RequirementExtraction
    ) -> ProjectSpec:
        def text(value: str, confidence: float = 0.78) -> TextValue:
            return TextValue(
                value=value or "待确认",
                source=Source.AGENT,
                confidence=confidence,
                verification_status=VerificationStatus.NEEDS_CONFIRMATION,
                notes="由 DeepSeek 从用户文字提取或推断，需要用户确认",
            )

        def items(values: list[str], confidence: float = 0.75) -> ListValue:
            return ListValue(
                value=values,
                source=Source.AGENT,
                confidence=confidence,
                verification_status=VerificationStatus.NEEDS_CONFIRMATION,
                notes="由 DeepSeek 从用户文字提取或推断，需要用户确认",
            )

        spec.project.product_goal = text(extracted.product_goal)
        spec.user.target_user = text(extracted.target_user)
        spec.scenario.usage_environment = text(extracted.usage_environment)
        spec.scenario.usage_process = items(extracted.usage_process)
        spec.interaction.user_actions = items(extracted.user_actions)
        spec.interaction.system_inputs = items(extracted.system_inputs)
        spec.interaction.system_outputs = items(extracted.system_outputs)
        spec.interaction.feedback_methods = items(extracted.feedback_methods)
        spec.interaction.abnormal_conditions = items(extracted.abnormal_conditions)
        spec.system.functional_modules = items(extracted.functional_modules)
        spec.system.data_flow = items(extracted.data_flow)
        spec.system.control_flow = items(extracted.control_flow)
        spec.system.states = items(extracted.states)
        spec.system.safety_states = items(
            list(dict.fromkeys([*extracted.safety_states, *extracted.safety_flags]))
        )
        spec.hardware.preferred_controller = text(extracted.preferred_controller, 0.65)
        if spec.hardware.controllers:
            spec.hardware.controllers[0].model = text(
                extracted.preferred_controller, 0.65
            )
        spec.software.data_collection_required = BoolValue(
            value=extracted.data_collection_required,
            source=Source.AGENT,
            confidence=0.75,
        )
        spec.software.machine_learning_required = BoolValue(
            value=extracted.machine_learning_required,
            source=Source.AGENT,
            confidence=0.7,
        )
        spec.software.control_interface_required = BoolValue(
            value=extracted.control_interface_required,
            source=Source.AGENT,
            confidence=0.75,
        )
        spec.assumptions = [text(item, 0.6) for item in extracted.assumptions]
        spec.open_questions = [
            TextValue(
                value=item,
                source=Source.AGENT,
                confidence=0.9,
                verification_status=VerificationStatus.NEEDS_CONFIRMATION,
                notes="DeepSeek 识别的关键缺失信息",
            )
            for item in extracted.must_confirm_questions
        ]
        spec.project.status = VerificationStatus.NEEDS_CONFIRMATION
        spec.verification.requirement_status = VerificationStatus.NEEDS_CONFIRMATION
        return spec

    async def answer_project_message(
        self, spec: ProjectSpec, user_message: str, affected_modules: list[str]
    ) -> AgentOutput:
        if self.provider.provider_name == "mock":
            reply = (
                f"此修改预计影响 {len(affected_modules)} 个模块："
                f"{'、'.join(affected_modules)}。执行前将创建新的 ProjectSpec 版本；"
                "待确认的工程参数不会被猜测补全。"
            )
            return self._output(reply, True)

        context = json.dumps(spec.model_dump(mode="json"), ensure_ascii=False)
        reply = await self.provider.generate_text(
            [
                {"role": "system", "content": SYSTEM_GUARDRAILS},
                {
                    "role": "system",
                    "content": (
                        "以下是当前 ProjectSpec。回答必须只使用其中的信息，并指出来源和不确定性：\n"
                        + context
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"用户请求：{user_message}\n"
                        f"程序计算的受影响模块：{'、'.join(affected_modules)}\n"
                        "请说明你理解的修改、影响、不能自动确认的工程信息，以及安全的下一步。"
                        "不要声称已经修改或验证尚未执行的文件。"
                    ),
                },
            ],
            role="reasoning",
        )
        return self._output(reply, True)

    async def recommend_components(
        self, spec: ProjectSpec, question: str
    ) -> tuple[ComponentRecommendationSet, AgentOutput]:
        context = json.dumps(spec.model_dump(mode="json"), ensure_ascii=False)
        data = await self.provider.generate_json(
            [
                {"role": "system", "content": SYSTEM_GUARDRAILS},
                {
                    "role": "system",
                    "content": (
                        "你负责为工业设计原型比较元件候选。必须给出恰好 3 个可区分的候选；"
                        "优先给出明确的常见型号或产品系列，但不得编造引脚、电压、电流、地址、"
                        "价格、库存或兼容性。fit_reason 只解释与 ProjectSpec 的匹配方向；"
                        "tradeoffs 说明取舍；verification_required 列出必须查正式数据手册或"
                        "实物验证的项目。只能有一个 recommended=true。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"当前 ProjectSpec：\n{context}\n\n"
                        f"需要推荐候选的问题：{question}\n"
                        "请基于预算、使用环境、原型等级、主控偏好和已有元件进行比较。"
                    ),
                },
            ],
            ComponentRecommendationSet,
            role="reasoning",
        )
        recommendations = ComponentRecommendationSet.model_validate(data)
        for candidate in recommendations.candidates:
            candidate.fit_reason = sanitize_recommendation_narrative(candidate.fit_reason)
            candidate.tradeoffs = sanitize_recommendation_narrative(candidate.tradeoffs)
            candidate.verification_required = list(dict.fromkeys(
                normalize_verification_item(item)
                for item in candidate.verification_required
                if item.strip()
            )) or ["型号、关键参数与兼容性：查看正式数据手册并进行实物测试"]
        recommended_indexes = [
            index for index, item in enumerate(recommendations.candidates)
            if item.recommended
        ]
        if len(recommended_indexes) != 1:
            for index, item in enumerate(recommendations.candidates):
                item.recommended = index == 0
        return recommendations, self._output(
            json.dumps(recommendations.model_dump(mode="json"), ensure_ascii=False),
            True,
        )

    async def process_project_message(
        self,
        spec: ProjectSpec,
        user_message: str,
        deterministic_modules: list[str],
        apply_change: bool = True,
    ) -> ProjectMessageResult:
        """Answer a message and apply only explicitly supported requirement fields."""
        if self.provider.provider_name == "mock":
            change = self._mock_change(user_message, deterministic_modules)
        else:
            context = json.dumps(spec.model_dump(mode="json"), ensure_ascii=False)
            change_data = await self.provider.generate_json(
                [
                    {"role": "system", "content": SYSTEM_GUARDRAILS},
                    {
                        "role": "system",
                        "content": (
                            "只能通过给定 JSON 字段提出有限的 ProjectSpec 修改。"
                            "没有明确修改意图时 should_update_spec=false；"
                            "不得把未知器件参数写入修改。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"当前 ProjectSpec：\n{context}\n\n"
                            f"用户消息：{user_message}\n"
                            f"程序初步判断受影响模块：{'、'.join(deterministic_modules)}\n"
                            "reply 需要说明已做事项、影响、未确认信息和下一步。"
                        ),
                    },
                ],
                RequirementChange,
                role="reasoning",
            )
            change = RequirementChange.model_validate(change_data)

        modules = list(dict.fromkeys([
            *deterministic_modules,
            *change.affected_modules,
            *(["ProjectSpec"] if change.should_update_spec else []),
        ]))
        updated_spec = None
        applied = change.should_update_spec and apply_change
        if applied:
            updated_spec = self._apply_requirement_change(spec, change, user_message)

        reply = change.reply
        if change.should_update_spec and not apply_change:
            reply += "\n\n本次只完成影响分析，尚未写入 ProjectSpec。"
        elif applied:
            reply += f"\n\n已创建新的 ProjectSpec 版本。受影响模块：{'、'.join(modules)}。"
        return ProjectMessageResult(
            output=self._output(reply, change.requires_confirmation),
            updated_spec=updated_spec,
            affected_modules=modules,
        )

    def _mock_change(
        self, user_message: str, modules: list[str]
    ) -> RequirementChange:
        lowered = user_message.lower()
        budget_match = re.search(r"(\d+(?:\.\d+)?)\s*元", user_message)
        controller = next(
            (
                name for name in ["ESP32-S3", "ESP32", "Arduino", "Raspberry Pi", "树莓派"]
                if name.lower() in lowered
            ),
            None,
        )
        remove_ml = "删除机器学习" in user_message or "不需要机器学习" in user_message
        add_ml = ("机器学习" in user_message or "训练模型" in user_message) and not remove_ml
        should_update = bool(budget_match or controller or remove_ml or add_ml)
        return RequirementChange(
            reply=(
                f"已分析这条项目消息，预计影响：{'、'.join(modules)}。"
                if should_update else
                "已基于当前 ProjectSpec 分析该问题；待确认参数仍保持未验证状态。"
            ),
            should_update_spec=should_update,
            budget_cny=float(budget_match.group(1)) if budget_match else None,
            preferred_controller=controller,
            machine_learning_required=False if remove_ml else True if add_ml else None,
            affected_modules=modules,
            requires_confirmation=True,
        )

    def _apply_requirement_change(
        self, spec: ProjectSpec, change: RequirementChange, user_message: str
    ) -> ProjectSpec:
        updated = deepcopy(spec)

        def user_text(value: str) -> TextValue:
            return TextValue(
                value=value,
                source=Source.USER,
                confidence=1,
                verification_status=VerificationStatus.USER_CONFIRMED,
                notes=f"来自用户项目消息：{user_message[:240]}",
            )

        if change.product_goal is not None:
            updated.project.product_goal = user_text(change.product_goal)
        if change.target_user is not None:
            updated.user.target_user = user_text(change.target_user)
        if change.usage_environment is not None:
            updated.scenario.usage_environment = user_text(change.usage_environment)
        if change.budget_cny is not None:
            budget = updated.constraints.budget_cny
            budget.value = change.budget_cny
            budget.source = Source.USER
            budget.confidence = 1
            budget.verification_status = VerificationStatus.USER_CONFIRMED
            budget.notes = f"来自用户项目消息：{user_message[:240]}"
        if change.preferred_controller is not None:
            updated.hardware.preferred_controller = user_text(change.preferred_controller)
            if updated.hardware.controllers:
                updated.hardware.controllers[0].model = user_text(change.preferred_controller)
            else:
                from .schemas import ComponentSelection

                updated.hardware.controllers.append(
                    ComponentSelection(
                        category="controller",
                        model=user_text(change.preferred_controller),
                        notes="具体开发板规格与引脚需要查看数据手册",
                    )
                )
        for field in (
            "data_collection_required",
            "machine_learning_required",
            "control_interface_required",
        ):
            value = getattr(change, field)
            if value is not None:
                setattr(
                    updated.software,
                    field,
                    BoolValue(
                        value=value,
                        source=Source.USER,
                        confidence=1,
                        verification_status=VerificationStatus.USER_CONFIRMED,
                        notes=f"来自用户项目消息：{user_message[:240]}",
                    ),
                )
        if change.resolved_open_questions:
            updated.open_questions = [
                item for item in updated.open_questions
                if not any(key in item.value for key in change.resolved_open_questions)
            ]
        existing_questions = {item.value for item in updated.open_questions}
        updated.open_questions.extend(
            TextValue(
                value=item,
                source=Source.AGENT,
                confidence=0.85,
                verification_status=VerificationStatus.NEEDS_CONFIRMATION,
                notes="由本次需求修改产生",
            )
            for item in change.add_open_questions
            if item not in existing_questions
        )
        updated.project.updated_at = datetime.now(UTC)
        updated.project.status = VerificationStatus.NEEDS_CONFIRMATION
        updated.verification.requirement_status = VerificationStatus.NEEDS_CONFIRMATION
        return updated

    async def generate_module_analysis(
        self, spec: ProjectSpec, module: str
    ) -> AgentOutput:
        if self.provider.provider_name == "mock":
            return self._output(
                f"Mock 模式：{module} 使用确定性模板生成，未调用外部模型。", True
            )
        module_tasks = {
            "architecture": "形成输入—处理—输出、数据流、控制流、状态机、异常与安全状态说明",
            "hardware": "提出主控、传感器、执行器、驱动、电源和通信候选方案及核对清单",
            "bom": "审查 BOM 完整性、预算风险、替代方案与所有待确认价格",
            "protocol": "审查 USB 串口 JSONL 协议、超时、重试、错误码和双端一致性",
            "firmware": "给出 ESP32 PlatformIO 固件结构、状态机、日志、错误处理和编译验证建议",
            "python": "给出采集、存储、清洗、训练、推理和串口控制程序的工程说明",
            "ui": "给出项目专用控制界面的信息架构、操作安全与状态反馈说明",
            "tests": "生成覆盖单元、模块、集成、首次上电、安全、连续运行和异常的测试说明",
            "docs": "生成安装、接线、运行、调试、故障排查和二次开发文档说明",
            "all": "形成从需求到工程验证的总体工程分析，列出阻塞项和下一步",
        }
        prompt = f"""\
基于下列 ProjectSpec 为“{module}”模块执行专业分析。
任务：{module_tasks[module]}

输出 Markdown，包含：目标、已确认输入、Agent 推断、待确认信息、方案与理由、
确定性程序还需要执行的检查、安全边界、下一步。不得编造任何器件参数或价格。
任何没有逐字出现在 ProjectSpec 中的电压、电流、功率、阻值、引脚、地址、尺寸、范围、
器件能力或价格都禁止给出具体数字，也禁止用“典型值”“例如”绕过；只能写“待确认，
需要查看所选型号的正式数据手册”。ProjectSpec 中的预算、波特率和协议版本可以原样引用。

ProjectSpec:
{json.dumps(spec.model_dump(mode="json"), ensure_ascii=False)}
"""
        content = await self.provider.generate_text(
            [
                {"role": "system", "content": SYSTEM_GUARDRAILS},
                {"role": "user", "content": prompt},
            ],
            role="coding" if module in {"firmware", "python", "protocol"} else "reasoning",
        )
        return self._output(content, True)

    async def test_connection(self) -> AgentOutput:
        content = await self.provider.generate_text(
            [
                {"role": "system", "content": "只进行连接测试，不输出思维过程。"},
                {"role": "user", "content": "只回复 DEEPSEEK_CONNECTION_OK"},
            ],
            role="default",
        )
        return self._output(content)
