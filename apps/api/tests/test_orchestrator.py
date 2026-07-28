import pytest

from app.orchestrator import PrototypeEngineerOrchestrator
from app.providers import ModelProvider
from app.schemas import ProjectCreate


class FakeDeepSeekProvider(ModelProvider):
    provider_name = "deepseek"

    def __init__(self):
        self.last_model = "deepseek-v4-pro"
        self.last_usage = {"total_tokens": 123}
        self.calls: list[str] = []

    async def generate_text(self, messages, **kwargs):
        self.calls.append(f"text:{kwargs.get('role')}")
        return "已分析修改；电机电流与驱动器规格需要查看数据手册。"

    async def generate_json(self, messages, schema, **kwargs):
        self.calls.append(f"json:{kwargs.get('role')}")
        if schema.__name__ == "RequirementChange":
            return {
                "reply": "已将预算调整为 1000 元，相关工程资产需要重新生成。",
                "should_update_spec": True,
                "budget_cny": 1000,
                "affected_modules": ["ProjectSpec", "BOM", "工程摘要"],
                "requires_confirmation": True,
            }
        return {
            "product_goal": "验证旋转交互能否帮助用户形成专注节奏",
            "target_user": "需要专注辅助的桌面工作者",
            "usage_environment": "室内桌面",
            "usage_process": ["佩戴", "旋转", "获得阻尼反馈"],
            "user_actions": ["旋转指环"],
            "system_inputs": ["旋转速度", "方向变化"],
            "system_outputs": ["阻尼反馈"],
            "feedback_methods": ["触觉"],
            "abnormal_conditions": ["执行器卡滞"],
            "functional_modules": ["旋转采集", "状态识别", "阻尼控制"],
            "data_flow": ["编码器 → 主控 → Python"],
            "control_flow": ["自检 → 待机 → 交互 → 安全停机"],
            "states": ["BOOT", "IDLE", "ACTIVE", "ERROR"],
            "safety_states": ["SAFE_STOP"],
            "preferred_controller": "ESP32-S3",
            "data_collection_required": True,
            "machine_learning_required": True,
            "control_interface_required": True,
            "assumptions": ["第一版为有人值守低压原型"],
            "must_confirm_questions": ["阻尼执行器的额定和启动电流是多少？"],
            "safety_flags": ["执行器需要急停"],
        }

    async def call_tools(self, messages, tools, **kwargs):
        return {"role": "assistant", "tool_calls": []}


@pytest.mark.asyncio
async def test_deepseek_interpreter_merges_into_project_spec():
    provider = FakeDeepSeekProvider()
    agent = PrototypeEngineerOrchestrator(provider)
    spec, output = await agent.interpret_requirements(ProjectCreate(
        name="智能指环",
        description="通过旋转采集行为并根据专注状态改变阻尼的智能指环原型",
        budget_cny=1500,
        machine_learning_required=True,
    ))
    assert provider.calls == ["json:reasoning"]
    assert spec.project.product_goal.source == "agent_recommendation"
    assert spec.hardware.preferred_controller.value == "ESP32-S3"
    assert spec.software.machine_learning_required.value is True
    assert spec.software.machine_learning_required.source == "user_provided"
    assert spec.open_questions[0].value.startswith("阻尼执行器")
    assert output.provider == "deepseek"
    assert output.usage["total_tokens"] == 123


@pytest.mark.asyncio
async def test_deepseek_project_message_uses_spec_context():
    provider = FakeDeepSeekProvider()
    agent = PrototypeEngineerOrchestrator(provider)
    spec, _ = await agent.interpret_requirements(ProjectCreate(
        name="智能指环",
        description="通过旋转采集行为并根据专注状态改变阻尼的智能指环原型",
    ))
    output = await agent.answer_project_message(spec, "把舵机改为步进电机", ["BOM", "电源"])
    assert output.provider == "deepseek"
    assert "数据手册" in output.content
    assert provider.calls[-1] == "text:reasoning"


@pytest.mark.asyncio
async def test_deepseek_project_message_can_create_bounded_spec_change():
    provider = FakeDeepSeekProvider()
    agent = PrototypeEngineerOrchestrator(provider)
    spec, _ = await agent.interpret_requirements(ProjectCreate(
        name="智能指环",
        description="通过旋转采集行为并根据专注状态改变阻尼的智能指环原型",
    ))
    result = await agent.process_project_message(
        spec, "把预算改为 1000 元", ["ProjectSpec", "BOM"], True
    )
    assert result.updated_spec is not None
    assert result.updated_spec.constraints.budget_cny.value == 1000
    assert result.updated_spec.constraints.budget_cny.source == "user_provided"
    assert "已创建新的 ProjectSpec 版本" in result.output.content
