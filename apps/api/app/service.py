from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .generator import _slug, affected_modules, create_initial_spec, generate_workspace
from .models import GeneratedArtifact, Message, Project, ProjectSpecRecord, ValidationResult
from .schemas import MessageCreate, ProjectCreate, ProjectSpec
from .validators import HardwareValidator


def slugify(name: str, project_id: str) -> str:
    safe = "".join(char.lower() if char.isascii() and char.isalnum() else "-" for char in name)
    safe = "-".join(part for part in safe.split("-") if part)
    return (safe or "prototype") + "-" + project_id[:8]


class ProjectService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, data: ProjectCreate) -> Project:
        spec = create_initial_spec(data)
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

    def add_message(self, project_id: str, data: MessageCreate) -> dict:
        self.get(project_id)
        modules = affected_modules(data.content)
        self.db.add(Message(project_id=project_id, role="user", content=data.content))
        reply = (
            f"此修改预计影响 {len(modules)} 个模块：{'、'.join(modules)}。"
            "执行前将创建新的 ProjectSpec 版本；待确认的工程参数不会被猜测补全。"
        )
        self.db.add(Message(project_id=project_id, role="assistant", content=reply, metadata_json={"affected_modules": modules}))
        self.db.commit()
        return {"reply": reply, "affected_modules": modules, "requires_confirmation": True}

    def generate_all(self, project: Project) -> list[GeneratedArtifact]:
        spec = self.spec(project.id)
        files = generate_workspace(spec, settings.projects_root, project.description)
        self.db.query(GeneratedArtifact).filter(GeneratedArtifact.project_id == project.id).delete()
        workspace = files[0].parents[1]
        artifacts = []
        for file in files:
            content = file.read_bytes()
            artifact = GeneratedArtifact(
                project_id=project.id, kind=file.suffix.lstrip(".") or "file",
                relative_path=str(file.relative_to(workspace)),
                source_spec_version=project.current_spec_version,
                checksum=hashlib.sha256(content).hexdigest(),
            )
            self.db.add(artifact)
            artifacts.append(artifact)
        self.db.commit()
        return artifacts

    def validate_hardware(self, project_id: str) -> dict:
        report = HardwareValidator().validate(self.spec(project_id))
        self.db.add(ValidationResult(
            project_id=project_id, validator="hardware-rules-v1",
            status="FAILED" if report.errors else "NEEDS_CONFIRMATION" if report.warnings else "SPEC_VERIFIED",
            report=report.model_dump(mode="json"),
        ))
        self.db.commit()
        return report.model_dump(mode="json")

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
