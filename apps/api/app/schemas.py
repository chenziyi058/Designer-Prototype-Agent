from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Generic, TypeVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

T = TypeVar("T")


class Source(StrEnum):
    USER = "user_provided"
    AGENT = "agent_recommendation"
    CATALOG = "component_catalog"
    TEMPLATE = "template_default"
    CALCULATED = "program_calculated"
    PENDING = "pending_confirmation"


class VerificationStatus(StrEnum):
    DRAFT = "DRAFT"
    GENERATED = "GENERATED"
    NEEDS_CONFIRMATION = "NEEDS_CONFIRMATION"
    SPEC_VERIFIED = "SPEC_VERIFIED"
    CODE_VALIDATED = "CODE_VALIDATED"
    COMPILE_PASSED = "COMPILE_PASSED"
    HARDWARE_PENDING = "HARDWARE_PENDING"
    USER_CONFIRMED = "USER_CONFIRMED"
    FAILED = "FAILED"


class TracedValue(BaseModel, Generic[T]):
    value: T
    source: Source = Source.PENDING
    confidence: float = Field(default=0.5, ge=0, le=1)
    verification_status: VerificationStatus = VerificationStatus.NEEDS_CONFIRMATION
    notes: str = ""


TextValue = TracedValue[str]
BoolValue = TracedValue[bool]
NumberValue = TracedValue[float | None]
ListValue = TracedValue[list[str]]


def pending_text(value: str = "待确认", notes: str = "") -> TextValue:
    return TextValue(value=value, notes=notes)


class ProjectInfo(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: TextValue
    description: TextValue
    product_goal: TextValue
    prototype_level: TextValue = Field(default_factory=lambda: pending_text("功能原型"))
    status: VerificationStatus = VerificationStatus.DRAFT
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class UserInfo(BaseModel):
    target_user: TextValue = Field(default_factory=pending_text)
    experience_level: TextValue = Field(default_factory=lambda: pending_text("初学者"))
    preferred_language: TextValue = Field(
        default_factory=lambda: TextValue(
            value="zh-CN", source=Source.TEMPLATE, confidence=1,
            verification_status=VerificationStatus.SPEC_VERIFIED,
        )
    )


class ScenarioSpec(BaseModel):
    usage_environment: TextValue = Field(default_factory=pending_text)
    usage_process: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    frequency: TextValue = Field(default_factory=pending_text)
    environmental_constraints: ListValue = Field(default_factory=lambda: ListValue(value=[]))


class InteractionSpec(BaseModel):
    user_actions: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    system_inputs: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    system_outputs: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    feedback_methods: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    abnormal_conditions: ListValue = Field(default_factory=lambda: ListValue(value=[]))


class SystemSpec(BaseModel):
    functional_modules: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    data_flow: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    control_flow: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    states: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    safety_states: ListValue = Field(default_factory=lambda: ListValue(value=[]))


class ComponentSelection(BaseModel):
    category: str
    model: TextValue
    operating_voltage: NumberValue = Field(default_factory=lambda: NumberValue(value=None))
    logic_voltage: NumberValue = Field(default_factory=lambda: NumberValue(value=None))
    max_current_ma: NumberValue = Field(default_factory=lambda: NumberValue(value=None))
    interface: TextValue = Field(default_factory=pending_text)
    pins: dict[str, int] = Field(default_factory=dict)
    i2c_address: str | None = None
    notes: str = ""


class CommunicationSpec(BaseModel):
    transport: TextValue = Field(default_factory=lambda: pending_text("USB serial"))
    baud_rate: TracedValue[int] = Field(
        default_factory=lambda: TracedValue(
            value=115200, source=Source.TEMPLATE, confidence=1,
            verification_status=VerificationStatus.SPEC_VERIFIED,
        )
    )
    protocol_version: str = "1.0.0"


class PowerSupplySpec(BaseModel):
    voltage: NumberValue = Field(default_factory=lambda: NumberValue(value=None))
    rated_current_ma: NumberValue = Field(default_factory=lambda: NumberValue(value=None))
    source_type: TextValue = Field(default_factory=pending_text)


class HardwareSpec(BaseModel):
    preferred_controller: TextValue = Field(default_factory=pending_text)
    controllers: list[ComponentSelection] = Field(default_factory=list)
    sensors: list[ComponentSelection] = Field(default_factory=list)
    actuators: list[ComponentSelection] = Field(default_factory=list)
    motor_drivers: list[ComponentSelection] = Field(default_factory=list)
    communication: CommunicationSpec = Field(default_factory=CommunicationSpec)
    power_supply: PowerSupplySpec = Field(default_factory=PowerSupplySpec)
    existing_components: ListValue = Field(default_factory=lambda: ListValue(value=[]))


class SoftwareSpec(BaseModel):
    firmware_platform: TextValue = Field(default_factory=lambda: pending_text("PlatformIO / Arduino"))
    computer_language: ListValue = Field(
        default_factory=lambda: ListValue(value=["Python", "TypeScript", "C++"], source=Source.TEMPLATE)
    )
    data_collection_required: BoolValue = Field(default_factory=lambda: BoolValue(value=False))
    machine_learning_required: BoolValue = Field(default_factory=lambda: BoolValue(value=False))
    control_interface_required: BoolValue = Field(default_factory=lambda: BoolValue(value=True))


class ConstraintSpec(BaseModel):
    budget_cny: NumberValue = Field(default_factory=lambda: NumberValue(value=None))
    size_constraints: TextValue = Field(default_factory=pending_text)
    power_constraints: TextValue = Field(default_factory=pending_text)
    avoid_custom_pcb: BoolValue = Field(default_factory=lambda: BoolValue(value=True))
    preferred_components: ListValue = Field(default_factory=lambda: ListValue(value=[]))
    forbidden_components: ListValue = Field(default_factory=lambda: ListValue(value=[]))


class VerificationSummary(BaseModel):
    requirement_status: VerificationStatus = VerificationStatus.DRAFT
    hardware_status: VerificationStatus = VerificationStatus.DRAFT
    firmware_status: VerificationStatus = VerificationStatus.DRAFT
    software_status: VerificationStatus = VerificationStatus.DRAFT
    physical_test_status: VerificationStatus = VerificationStatus.HARDWARE_PENDING


class ProjectSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str = "1.0.0"
    project: ProjectInfo
    user: UserInfo = Field(default_factory=UserInfo)
    scenario: ScenarioSpec = Field(default_factory=ScenarioSpec)
    interaction: InteractionSpec = Field(default_factory=InteractionSpec)
    system: SystemSpec = Field(default_factory=SystemSpec)
    hardware: HardwareSpec = Field(default_factory=HardwareSpec)
    software: SoftwareSpec = Field(default_factory=SoftwareSpec)
    constraints: ConstraintSpec = Field(default_factory=ConstraintSpec)
    assumptions: list[TextValue] = Field(default_factory=list)
    open_questions: list[TextValue] = Field(default_factory=list)
    verification: VerificationSummary = Field(default_factory=VerificationSummary)

    @field_validator("schema_version")
    @classmethod
    def supported_schema(cls, value: str) -> str:
        if value != "1.0.0":
            raise ValueError("unsupported ProjectSpec schema version")
        return value


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=10, max_length=6000)
    target_user: str = "待确认"
    usage_environment: str = "待确认"
    budget_cny: float | None = Field(default=None, gt=0)
    experience_level: str = "初学者"
    preferred_controller: str = "由 Agent 推荐"
    communication_preference: str = "USB 串口"
    existing_components: list[str] = Field(default_factory=list)
    size_constraints: str = "待确认"
    power_constraints: str = "待确认"
    prototype_level: str = "功能原型"
    avoid_custom_pcb: bool = True
    data_collection_required: bool = True
    machine_learning_required: bool = False
    control_interface_required: bool = True


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    apply_change: bool = True


class ComponentCandidate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    category: str = Field(min_length=2, max_length=80)
    fit_reason: str = Field(min_length=4, max_length=600)
    tradeoffs: str = Field(min_length=4, max_length=600)
    verification_required: list[str] = Field(min_length=1, max_length=8)
    recommended: bool = False


class ComponentRecommendationSet(BaseModel):
    question: str
    candidates: list[ComponentCandidate] = Field(min_length=3, max_length=3)
    disclaimer: str = (
        "候选仅用于方案比较；型号、引脚、电压、电流、接口和兼容性必须查看正式数据手册并进行实物测试。"
    )

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "question": "旋转输入元件应该选择什么型号？",
            "candidates": [
                {
                    "name": "候选 A（具体型号待数据手册核对）",
                    "category": "旋转输入",
                    "fit_reason": "适合低成本桌面功能原型。",
                    "tradeoffs": "耐久性与分辨率需要取舍。",
                    "verification_required": ["工作电压", "机械尺寸", "接口与引脚"],
                    "recommended": True,
                },
                {
                    "name": "候选 B（具体型号待数据手册核对）",
                    "category": "旋转输入",
                    "fit_reason": "适合需要绝对角度的原型。",
                    "tradeoffs": "软件与成本复杂度可能更高。",
                    "verification_required": ["通信接口", "供电范围", "采样速率"],
                    "recommended": False,
                },
                {
                    "name": "候选 C（具体型号待数据手册核对）",
                    "category": "旋转输入",
                    "fit_reason": "适合非接触式验证。",
                    "tradeoffs": "机械安装和磁体配合需要验证。",
                    "verification_required": ["安装公差", "电气接口", "环境适应性"],
                    "recommended": False,
                },
            ],
            "disclaimer": "候选均为 Agent 推荐，选择前必须核对正式数据手册。",
        }],
    })


class RequirementChange(BaseModel):
    """A deliberately bounded model-facing change set for ProjectSpec updates."""

    reply: str
    should_update_spec: bool = False
    product_goal: str | None = None
    target_user: str | None = None
    usage_environment: str | None = None
    budget_cny: float | None = Field(default=None, gt=0)
    preferred_controller: str | None = None
    data_collection_required: bool | None = None
    machine_learning_required: bool | None = None
    control_interface_required: bool | None = None
    add_open_questions: list[str] = Field(default_factory=list)
    resolved_open_questions: list[str] = Field(default_factory=list)
    affected_modules: list[str] = Field(default_factory=list)
    requires_confirmation: bool = True


class RequirementExtraction(BaseModel):
    """Small, model-facing schema merged into the canonical ProjectSpec by code."""

    product_goal: str
    target_user: str
    usage_environment: str
    usage_process: list[str] = Field(default_factory=list)
    user_actions: list[str] = Field(default_factory=list)
    system_inputs: list[str] = Field(default_factory=list)
    system_outputs: list[str] = Field(default_factory=list)
    feedback_methods: list[str] = Field(default_factory=list)
    abnormal_conditions: list[str] = Field(default_factory=list)
    functional_modules: list[str] = Field(default_factory=list)
    data_flow: list[str] = Field(default_factory=list)
    control_flow: list[str] = Field(default_factory=list)
    states: list[str] = Field(default_factory=list)
    safety_states: list[str] = Field(default_factory=list)
    preferred_controller: str = "待确认"
    data_collection_required: bool = False
    machine_learning_required: bool = False
    control_interface_required: bool = True
    assumptions: list[str] = Field(default_factory=list)
    must_confirm_questions: list[str] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)


class BOMItemSchema(BaseModel):
    id: str
    category: str
    component_name: str
    manufacturer: str = "待确认"
    model: str = "待确认"
    quantity: int = Field(ge=1)
    function: str
    key_specifications: dict[str, Any] = Field(default_factory=dict)
    operating_voltage: str = "待确认"
    current_requirement: str = "待确认"
    interface_type: str = "待确认"
    selection_reason: str
    estimated_unit_price_cny: float | None = None
    estimated_total_price_cny: float | None = None
    alternative_models: list[str] = Field(default_factory=list)
    datasheet_url: str | None = None
    source: Source = Source.PENDING
    verification_status: VerificationStatus = VerificationStatus.NEEDS_CONFIRMATION
    notes: str = ""


class ValidationIssue(BaseModel):
    level: str
    code: str
    title: str
    detail: str
    affected_items: list[str] = Field(default_factory=list)
    recommendation: str = ""


class ValidationReport(BaseModel):
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    errors: list[ValidationIssue] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)
    recommendations: list[ValidationIssue] = Field(default_factory=list)
    passed: list[ValidationIssue] = Field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return not self.errors
