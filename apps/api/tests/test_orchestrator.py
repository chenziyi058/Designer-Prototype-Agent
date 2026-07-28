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
        if schema.__name__ == "ComponentRecommendationSet":
            return {
                "question": "阻尼执行器应该选择什么？",
                "candidates": [
                    {
                        "name": "候选执行器 A",
                        "category": "阻尼执行器",
                        "fit_reason": "适合低压有人值守原型。",
                        "tradeoffs": "通常需要 5V，峰值电流约 60mA；输出能力与体积需要取舍。",
                        "verification_required": ["工作电压", "额定和启动电流"],
                        "recommended": True,
                    },
                    {
                        "name": "候选执行器 B",
                        "category": "阻尼执行器",
                        "fit_reason": "适合较平滑的阻尼控制。",
                        "tradeoffs": "驱动和控制复杂度更高。",
                        "verification_required": ["驱动器兼容性", "温升"],
                        "recommended": False,
                    },
                    {
                        "name": "候选执行器 C",
                        "category": "阻尼执行器",
                        "fit_reason": "适合快速功能验证。",
                        "tradeoffs": "噪声和寿命需要实测。",
                        "verification_required": ["机械安装", "连续运行寿命"],
                        "recommended": False,
                    },
                ],
                "disclaimer": "所有参数均需查看正式数据手册并进行实物测试。",
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
async def test_deepseek_recommends_three_candidates_without_claiming_verification():
    provider = FakeDeepSeekProvider()
    agent = PrototypeEngineerOrchestrator(provider)
    spec, _ = await agent.interpret_requirements(ProjectCreate(
        name="智能指环",
        description="通过旋转采集行为并根据专注状态改变阻尼的智能指环原型",
    ))
    recommendations, output = await agent.recommend_components(
        spec, spec.open_questions[0].value
    )
    assert len(recommendations.candidates) == 3
    assert sum(item.recommended for item in recommendations.candidates) == 1
    assert all(item.verification_required for item in recommendations.candidates)
    rendered = recommendations.model_dump_json()
    assert "5V" not in rendered
    assert "60mA" not in rendered
    assert "数据手册" in recommendations.disclaimer
    assert output.requires_confirmation is True
    assert provider.calls[-1] == "json:reasoning"


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
