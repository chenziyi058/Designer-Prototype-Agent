import pytest
from pydantic import ValidationError

from app.generator import create_initial_spec, smart_ring_spec
from app.schemas import ProjectCreate, ProjectSpec


def test_project_spec_round_trip_and_schema():
    spec = smart_ring_spec()
    restored = ProjectSpec.model_validate_json(spec.model_dump_json())
    assert restored.project.name.value == "智能专注指环"
    assert "hardware" in ProjectSpec.model_json_schema()["properties"]


def test_project_spec_rejects_unknown_schema_version():
    payload = smart_ring_spec().model_dump(mode="json")
    payload["schema_version"] = "9.0.0"
    with pytest.raises(ValidationError):
        ProjectSpec.model_validate(payload)


def test_create_requires_meaningful_description():
    with pytest.raises(ValidationError):
        ProjectCreate(name="测试", description="太短")


def test_unknown_engineering_values_remain_pending():
    spec = create_initial_spec(ProjectCreate(name="桌面灯", description="一个可响应用户操作的桌面氛围灯原型"))
    assert spec.hardware.power_supply.voltage.value is None
    assert spec.constraints.budget_cny.value is None
