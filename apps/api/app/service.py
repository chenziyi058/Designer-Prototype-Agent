from __future__ import annotations

import hashlib
import ast
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .generator import _slug, affected_modules, create_initial_spec, generate_workspace
from .models import (
    AgentRun,
    GeneratedArtifact,
    Message,
    Project,
    ProjectSpecRecord,
    ValidationResult,
)
from .schemas import MessageCreate, ProjectCreate, ProjectSpec
from .validators import HardwareValidator, validate_protocol


def slugify(name: str, project_id: str) -> str:
    safe = "".join(char.lower() if char.isascii() and char.isalnum() else "-" for char in name)
    safe = "-".join(part for part in safe.split("-") if part)
    return (safe or "prototype") + "-" + project_id[:8]


class ProjectService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, data: ProjectCreate, spec: ProjectSpec | None = None) -> Project:
        spec = spec or create_initial_spec(data)
        project = Project(
            id=spec.project.id, slug=slugify(data.name, spec.project.id),
            name=data.name, description=data.description, status="DRAFT",
        )
        project.specs.append(ProjectSpecRecord(
            version=1, content=spec.model_dump(mode="json"), reason="创建项目",
            affected_modules=["ProjectSpec", "需求文档"],
        ))
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)
        self.generate_all(project)
        return project

    def list(self) -> list[Project]:
        return list(self.db.scalars(select(Project).order_by(Project.updated_at.desc())))

    def get(self, project_id: str) -> Project:
        project = self.db.get(Project, project_id)
        if not project:
            raise LookupError("项目不存在")
        return project

    def current_spec_record(self, project_id: str) -> ProjectSpecRecord:
        record = self.db.scalar(select(ProjectSpecRecord).where(
            ProjectSpecRecord.project_id == project_id,
            ProjectSpecRecord.is_current.is_(True),
        ))
        if not record:
            raise LookupError("ProjectSpec 不存在")
        return record

    def spec(self, project_id: str) -> ProjectSpec:
        return ProjectSpec.model_validate(self.current_spec_record(project_id).content)

    def update_spec(self, project_id: str, spec: ProjectSpec, reason: str, modules: list[str]) -> ProjectSpecRecord:
        project = self.get(project_id)
        current = self.current_spec_record(project_id)
        current.is_current = False
        project.current_spec_version += 1
        record = ProjectSpecRecord(
            project_id=project_id, version=project.current_spec_version,
            content=spec.model_dump(mode="json"), reason=reason,
            affected_modules=modules, is_current=True,
        )
        self.db.add(record)
        self.db.query(GeneratedArtifact).filter(
            GeneratedArtifact.project_id == project_id
        ).update({"status": "NEEDS_CONFIRMATION"})
        self.db.commit()
        return record

    def restore_spec(self, project_id: str, version: int) -> ProjectSpecRecord:
        source = self.db.scalar(select(ProjectSpecRecord).where(
            ProjectSpecRecord.project_id == project_id, ProjectSpecRecord.version == version
        ))
        if not source:
            raise LookupError("指定版本不存在")
        return self.update_spec(
            project_id, ProjectSpec.model_validate(source.content),
            f"恢复自版本 v{version}", ["ProjectSpec", "全部派生资产"],
        )

    def save_message_pair(
        self,
        project_id: str,
        data: MessageCreate,
        reply: str,
        modules: list[str],
        provider: str,
        model: str,
    ) -> dict:
        self.get(project_id)
        self.db.add(Message(project_id=project_id, role="user", content=data.content))
        self.db.add(Message(
            project_id=project_id,
            role="assistant",
            content=reply,
            metadata_json={
                "affected_modules": modules,
                "provider": provider,
                "model": model,
            },
        ))
        self.db.commit()
        return {
            "reply": reply,
            "affected_modules": modules,
            "requires_confirmation": True,
            "provider": provider,
            "model": model,
        }

    def generate_all(self, project: Project) -> list[GeneratedArtifact]:
        spec = self.spec(project.id)
        workspace_before = settings.projects_root / _slug(spec.project.name.value)
        previous_agent_files: dict[str, tuple[bytes, int]] = {}
        for artifact in self.artifacts(project.id):
            if (
                "agent-" in artifact.relative_path.lower()
                or "agent-generation-notes.md" in artifact.relative_path.lower()
            ):
                path = workspace_before / artifact.relative_path
                if path.exists():
                    previous_agent_files[artifact.relative_path] = (
                        path.read_bytes(), artifact.source_spec_version
                    )
        files = generate_workspace(spec, settings.projects_root, project.description)
        workspace = files[0].parents[1]
        for relative_path, (content, _) in previous_agent_files.items():
            path = workspace / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            files.append(path)
        self.db.query(GeneratedArtifact).filter(GeneratedArtifact.project_id == project.id).delete()
        artifacts = []
        for file in files:
            content = file.read_bytes()
            relative_path = str(file.relative_to(workspace))
            previous = previous_agent_files.get(relative_path)
            artifact = GeneratedArtifact(
                project_id=project.id, kind=file.suffix.lstrip(".") or "file",
                relative_path=relative_path,
                status="NEEDS_CONFIRMATION" if previous else "GENERATED",
                source_spec_version=previous[1] if previous else project.current_spec_version,
                checksum=hashlib.sha256(content).hexdigest(),
            )
            self.db.add(artifact)
            artifacts.append(artifact)
        self.db.commit()
        return artifacts

    def artifacts(self, project_id: str) -> list[GeneratedArtifact]:
        self.get(project_id)
        return list(self.db.scalars(
            select(GeneratedArtifact).where(
                GeneratedArtifact.project_id == project_id
            ).order_by(GeneratedArtifact.relative_path)
        ))

    def validate_hardware(self, project_id: str) -> dict:
        report = HardwareValidator().validate(self.spec(project_id))
        self.db.add(ValidationResult(
            project_id=project_id, validator="hardware-rules-v1",
            status="FAILED" if report.errors else "NEEDS_CONFIRMATION" if report.warnings else "SPEC_VERIFIED",
            report=report.model_dump(mode="json"),
        ))
        self.db.commit()
        return report.model_dump(mode="json")

    def validate_protocol_workspace(self, project_id: str) -> dict:
        workspace = self.workspace(project_id)
        try:
            schema = json.loads(
                (workspace / "07_protocol/protocol.schema.json").read_text(encoding="utf-8")
            )
            header = (workspace / "04_firmware/include/protocol.h").read_text(encoding="utf-8")
            python_source = (
                workspace / "05_python/src/prototype/protocol.py"
            ).read_text(encoding="utf-8")
        except (OSError, json.JSONDecodeError) as error:
            raise LookupError(f"协议文件不可读: {error}") from error

        def header_number(name: str) -> int | None:
            match = re.search(rf"{name}\s*=\s*(\d+)", header)
            return int(match.group(1)) if match else None

        def header_string(name: str) -> str | None:
            match = re.search(rf'{name}\s*=\s*"([^"]*)"', header)
            return match.group(1) if match else None

        python_values: dict[str, object] = {}
        for node in ast.parse(python_source).body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
                if isinstance(target, ast.Name):
                    try:
                        python_values[target.id] = ast.literal_eval(node.value)
                    except (ValueError, TypeError):
                        continue

        firmware = {
            "protocol_version": header_string("PROTOCOL_VERSION_TEXT"),
            "baud_rate": header_number("SERIAL_BAUD"),
            "commands": (header_string("PROTOCOL_COMMANDS") or "").split(","),
            "error_codes": (header_string("PROTOCOL_ERROR_CODES") or "").split(","),
            "max_message_bytes": header_number("MAX_MESSAGE_BYTES"),
        }
        python = {
            "protocol_version": python_values.get("PROTOCOL_VERSION"),
            "baud_rate": python_values.get("BAUD_RATE"),
            "commands": python_values.get("COMMANDS"),
            "error_codes": python_values.get("ERROR_CODES"),
            "max_message_bytes": python_values.get("MAX_MESSAGE_BYTES"),
        }
        expected = {
            "protocol_version": schema.get("protocol_version"),
            "baud_rate": schema.get("baud_rate"),
            "commands": schema.get("commands"),
            "error_codes": schema.get("error_codes"),
            "max_message_bytes": schema.get("max_message_bytes"),
        }
        report = validate_protocol(expected, firmware)
        second = validate_protocol(expected, python)
        report.errors.extend(second.errors)
        report.warnings.extend(second.warnings)
        report.recommendations.extend(second.recommendations)
        report.passed.extend(second.passed)
        result = report.model_dump(mode="json")
        self._record_validation(
            project_id, "protocol-consistency-v1",
            "FAILED" if report.errors else "CODE_VALIDATED", result,
        )
        return result

    def validate_code_workspace(self, project_id: str) -> dict:
        workspace = self.workspace(project_id)
        python_root = workspace / "05_python"
        firmware_root = workspace / "04_firmware"
        compile_process = subprocess.run(
            [sys.executable, "-m", "compileall", "-q", "."],
            cwd=python_root,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        test_process = subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            cwd=python_root,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        pio_candidate = Path(sys.executable).with_name("pio")
        pio = str(pio_candidate) if pio_candidate.exists() else shutil.which("pio")
        firmware_result: dict[str, object]
        if pio:
            try:
                firmware_process = subprocess.run(
                    [pio, "run"],
                    cwd=firmware_root,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    check=False,
                )
                firmware_result = {
                    "status": "COMPILE_PASSED" if firmware_process.returncode == 0 else "FAILED",
                    "return_code": firmware_process.returncode,
                    "log": (firmware_process.stdout + firmware_process.stderr)[-12000:],
                }
            except subprocess.TimeoutExpired as error:
                firmware_result = {"status": "FAILED", "log": f"PlatformIO 编译超时: {error}"}
        else:
            firmware_result = {
                "status": "NOT_RUN",
                "log": "当前 Python 环境未找到 PlatformIO；未声称固件编译通过。",
            }

        python_ok = compile_process.returncode == 0 and test_process.returncode == 0
        firmware_status = str(firmware_result["status"])
        overall = (
            "FAILED" if not python_ok or firmware_status == "FAILED"
            else "COMPILE_PASSED" if firmware_status == "COMPILE_PASSED"
            else "NEEDS_CONFIRMATION"
        )
        result = {
            "status": overall,
            "python": {
                "status": "CODE_VALIDATED" if python_ok else "FAILED",
                "compile_return_code": compile_process.returncode,
                "test_return_code": test_process.returncode,
                "log": (
                    compile_process.stdout + compile_process.stderr
                    + test_process.stdout + test_process.stderr
                )[-12000:],
            },
            "firmware": firmware_result,
        }
        log_path = workspace / "09_reports/code-validation.log"
        log_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        self._register_artifact(project_id, log_path)
        self._record_validation(project_id, "generated-code-v1", overall, result)
        return result

    def _record_validation(
        self, project_id: str, validator: str, status: str, report: dict
    ) -> None:
        self.db.add(ValidationResult(
            project_id=project_id, validator=validator, status=status, report=report
        ))
        self.db.commit()

    def _register_artifact(self, project_id: str, path: Path) -> GeneratedArtifact:
        project = self.get(project_id)
        workspace = self.workspace(project_id)
        relative_path = str(path.relative_to(workspace))
        artifact = self.db.scalar(select(GeneratedArtifact).where(
            GeneratedArtifact.project_id == project_id,
            GeneratedArtifact.relative_path == relative_path,
        ))
        content = path.read_bytes()
        if artifact is None:
            artifact = GeneratedArtifact(
                project_id=project_id,
                kind=path.suffix.lstrip(".") or "file",
                relative_path=relative_path,
                source_spec_version=project.current_spec_version,
            )
            self.db.add(artifact)
        artifact.checksum = hashlib.sha256(content).hexdigest()
        artifact.status = "GENERATED"
        artifact.source_spec_version = project.current_spec_version
        self.db.commit()
        return artifact

    def workspace(self, project_id: str) -> Path:
        return settings.projects_root / _slug(self.spec(project_id).project.name.value)

    def write_agent_artifact(
        self, project_id: str, module: str, content: str
    ) -> GeneratedArtifact:
        project = self.get(project_id)
        relative_paths = {
            "architecture": "02_architecture/agent-analysis.md",
            "hardware": "03_hardware/agent-analysis.md",
            "bom": "03_hardware/agent-bom-review.md",
            "protocol": "07_protocol/agent-analysis.md",
            "firmware": "04_firmware/AGENT-GENERATION-NOTES.md",
            "python": "05_python/AGENT-GENERATION-NOTES.md",
            "ui": "06_interface/agent-analysis.md",
            "tests": "08_testing/agent-test-analysis.md",
            "docs": "09_reports/agent-documentation-analysis.md",
            "all": "09_reports/agent-engineering-analysis.md",
        }
        relative_path = relative_paths[module]
        path = self.workspace(project_id) / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        rendered = (
            f"<!-- ProjectSpec v{project.current_spec_version}; Agent generated; requires confirmation -->\n\n"
            f"{content.strip()}\n"
        )
        path.write_text(rendered, encoding="utf-8")
        checksum = hashlib.sha256(rendered.encode()).hexdigest()
        artifact = self.db.scalar(select(GeneratedArtifact).where(
            GeneratedArtifact.project_id == project_id,
            GeneratedArtifact.relative_path == relative_path,
        ))
        if artifact:
            artifact.checksum = checksum
            artifact.source_spec_version = project.current_spec_version
            artifact.status = "NEEDS_CONFIRMATION"
        else:
            artifact = GeneratedArtifact(
                project_id=project_id,
                kind="md",
                relative_path=relative_path,
                status="NEEDS_CONFIRMATION",
                source_spec_version=project.current_spec_version,
                checksum=checksum,
            )
            self.db.add(artifact)
        self.db.commit()
        return artifact

    def record_agent_run(
        self,
        project_id: str,
        *,
        task_name: str,
        provider: str,
        model: str,
        skill: str,
        input_summary: str,
        result_summary: str = "",
        generated_files: list[str] | None = None,
        validation_result: dict | None = None,
        error: str | None = None,
        token_usage: dict | None = None,
        requires_confirmation: bool = False,
    ) -> AgentRun:
        run = AgentRun(
            project_id=project_id,
            task_name=task_name,
            provider=provider,
            model_name=model,
            skill_name=skill,
            input_summary=input_summary,
            result_summary=result_summary,
            generated_files=generated_files or [],
            validation_result=validation_result or {},
            error=error,
            token_usage=token_usage or {},
            requires_confirmation=requires_confirmation,
        )
        self.db.add(run)
        self.db.commit()
        return run

    def artifact_path(self, project_id: str, artifact_id: str) -> Path:
        artifact = self.db.get(GeneratedArtifact, artifact_id)
        if not artifact or artifact.project_id != project_id:
            raise LookupError("文件不存在")
        project = self.get(project_id)
        base = settings.projects_root / _slug(self.spec(project_id).project.name.value)
        if not base.exists():
            raise LookupError("项目工作区不存在")
        path = (base / artifact.relative_path).resolve()
        if base.resolve() not in path.parents:
            raise LookupError("非法文件路径")
        return path

    def export(self, project_id: str) -> Path:
        project = self.get(project_id)
        workspace = settings.projects_root / _slug(self.spec(project_id).project.name.value)
        if not workspace.exists():
            raise LookupError("项目工作区不存在")
        output = settings.projects_root / f"{project.slug}.zip"
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in workspace.rglob("*"):
                if file.is_file():
                    archive.write(file, file.relative_to(workspace))
        return output

    def messages(self, project_id: str) -> list[Message]:
        self.get(project_id)
        return list(self.db.scalars(select(Message).where(Message.project_id == project_id).order_by(Message.created_at)))

    def validations(self, project_id: str) -> list[ValidationResult]:
        self.get(project_id)
        return list(self.db.scalars(
            select(ValidationResult).where(
                ValidationResult.project_id == project_id
            ).order_by(ValidationResult.created_at.desc())
        ))
