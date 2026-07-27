from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uid() -> str:
    return str(uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120), default="本地演示用户")


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="DRAFT")
    current_stage: Mapped[str] = mapped_column(String(40), default="requirements")
    current_spec_version: Mapped[int] = mapped_column(Integer, default=1)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    specs: Mapped[list[ProjectSpecRecord]] = relationship(cascade="all, delete-orphan")
    artifacts: Mapped[list[GeneratedArtifact]] = relationship(cascade="all, delete-orphan")


class ProjectSpecRecord(Base, TimestampMixin):
    __tablename__ = "project_specs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(Text, default="创建项目")
    affected_modules: Mapped[list] = mapped_column(JSON, default=list)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)


class Message(Base, TimestampMixin):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class AgentRun(Base, TimestampMixin):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    task_name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(40))
    model_name: Mapped[str] = mapped_column(String(120), default="")
    skill_name: Mapped[str] = mapped_column(String(120))
    input_summary: Mapped[str] = mapped_column(Text)
    result_summary: Mapped[str] = mapped_column(Text, default="")
    generated_files: Mapped[list] = mapped_column(JSON, default=list)
    validation_result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_usage: Mapped[dict] = mapped_column(JSON, default=dict)
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)


class GeneratedArtifact(Base, TimestampMixin):
    __tablename__ = "generated_artifacts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(80))
    relative_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(40), default="GENERATED")
    source_spec_version: Mapped[int] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64), default="")


class Component(Base, TimestampMixin):
    __tablename__ = "components"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    category: Mapped[str] = mapped_column(String(80))
    manufacturer: Mapped[str] = mapped_column(String(120), default="待确认")
    model: Mapped[str] = mapped_column(String(160))
    specifications: Mapped[dict] = mapped_column(JSON, default=dict)
    datasheet_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    verification_status: Mapped[str] = mapped_column(String(40), default="NEEDS_CONFIRMATION")
    notes: Mapped[str] = mapped_column(Text, default="")


class BOMItem(Base, TimestampMixin):
    __tablename__ = "bom_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    category: Mapped[str] = mapped_column(String(80))
    component_name: Mapped[str] = mapped_column(String(160))
    model: Mapped[str] = mapped_column(String(160), default="待确认")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    estimated_unit_price_cny: Mapped[float | None] = mapped_column(Float, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class ValidationResult(Base, TimestampMixin):
    __tablename__ = "validation_results"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    validator: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(40))
    report: Mapped[dict] = mapped_column(JSON)


class TestCase(Base, TimestampMixin):
    __tablename__ = "test_cases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(80))
    steps: Mapped[list] = mapped_column(JSON, default=list)
    expected_result: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="DRAFT")


class DecisionRecord(Base, TimestampMixin):
    __tablename__ = "decision_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    reason: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    affected_modules: Mapped[list] = mapped_column(JSON, default=list)
