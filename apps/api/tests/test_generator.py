import json

from app.generator import affected_modules, generate_workspace, smart_ring_spec


def test_artifact_generation(tmp_path):
    files = generate_workspace(smart_ring_spec(), tmp_path, "智能指环原始描述")
    root = files[0].parents[1]
    required = [
        "01_requirements/project-spec.json", "02_architecture/state-machine.md",
        "03_hardware/bom.csv", "04_firmware/src/main.cpp",
        "05_python/data_collection/collect.py", "07_protocol/protocol.schema.json",
        "08_testing/first-power-on-checklist.md", "README.md",
    ]
    assert all((root / path).exists() for path in required)
    report = json.loads((root / "09_reports/validation-report.json").read_text())
    assert report["compile"] == "NOT_RUN"


def test_impact_analysis():
    modules = affected_modules("将主控改成 Raspberry Pi")
    assert "GPIO" in modules and "BOM" in modules
