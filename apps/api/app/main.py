from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, engine, get_db
from .models import GeneratedArtifact, ProjectSpecRecord
from .schemas import MessageCreate, ProjectCreate, ProjectSpec
from .service import ProjectService

Base.metadata.create_all(engine)
app = FastAPI(
    title="Designer Prototype Agent API", version="0.1.0",
    description="ProjectSpec-first smart hardware prototyping workflow.",
)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins.split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


def service(db: Session = Depends(get_db)) -> ProjectService:
    return ProjectService(db)


def project_view(project) -> dict:
    return {
        "id": project.id, "slug": project.slug, "name": project.name,
        "description": project.description, "status": project.status,
        "current_stage": project.current_stage,
        "current_spec_version": project.current_spec_version,
        "created_at": project.created_at, "updated_at": project.updated_at,
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "provider": settings.model_provider}


@app.post("/api/projects", status_code=201)
def create_project(data: ProjectCreate, svc: ProjectService = Depends(service)) -> dict:
    return project_view(svc.create(data))


@app.get("/api/projects")
def list_projects(svc: ProjectService = Depends(service)) -> list[dict]:
    return [project_view(item) for item in svc.list()]


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, svc: ProjectService = Depends(service)) -> dict:
    try:
        return project_view(svc.get(project_id))
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: str, data: dict, svc: ProjectService = Depends(service)) -> dict:
    project = svc.get(project_id)
    for field in ("name", "description", "status", "current_stage"):
        if field in data:
            setattr(project, field, data[field])
    svc.db.commit()
    return project_view(project)


@app.get("/api/projects/{project_id}/spec")
def get_spec(project_id: str, svc: ProjectService = Depends(service)) -> dict:
    return svc.spec(project_id).model_dump(mode="json")


@app.patch("/api/projects/{project_id}/spec")
def update_spec(project_id: str, payload: dict, svc: ProjectService = Depends(service)) -> dict:
    try:
        spec = ProjectSpec.model_validate(payload["spec"])
        record = svc.update_spec(
            project_id, spec, payload.get("reason", "用户修改"),
            payload.get("affected_modules", ["ProjectSpec"]),
        )
        return {"version": record.version, "affected_modules": record.affected_modules}
    except (KeyError, ValueError) as error:
        raise HTTPException(422, f"ProjectSpec 无效: {error}") from error


@app.get("/api/projects/{project_id}/spec/versions")
def spec_versions(project_id: str, svc: ProjectService = Depends(service)) -> list[dict]:
    svc.get(project_id)
    rows = svc.db.query(ProjectSpecRecord).filter(ProjectSpecRecord.project_id == project_id).order_by(ProjectSpecRecord.version.desc()).all()
    return [{"version": x.version, "reason": x.reason, "affected_modules": x.affected_modules, "is_current": x.is_current, "created_at": x.created_at} for x in rows]


@app.post("/api/projects/{project_id}/spec/versions/{version}/restore")
def restore_spec(project_id: str, version: int, svc: ProjectService = Depends(service)) -> dict:
    record = svc.restore_spec(project_id, version)
    return {"version": record.version, "reason": record.reason}


@app.post("/api/projects/{project_id}/messages")
def add_message(project_id: str, data: MessageCreate, svc: ProjectService = Depends(service)) -> dict:
    return svc.add_message(project_id, data)


@app.get("/api/projects/{project_id}/messages")
def messages(project_id: str, svc: ProjectService = Depends(service)) -> list[dict]:
    return [{"id": x.id, "role": x.role, "content": x.content, "metadata": x.metadata_json, "created_at": x.created_at} for x in svc.messages(project_id)]


@app.post("/api/projects/{project_id}/generate/{module}")
def generate(module: str, project_id: str, svc: ProjectService = Depends(service)) -> dict:
    supported = {"architecture", "hardware", "bom", "protocol", "firmware", "python", "ui", "tests", "docs", "all"}
    if module not in supported:
        raise HTTPException(404, "不支持的生成模块")
    project = svc.get(project_id)
    artifacts = svc.generate_all(project)
    return {"status": "GENERATED", "module": module, "artifact_count": len(artifacts), "source_spec_version": project.current_spec_version}


@app.post("/api/projects/{project_id}/validate/{target}")
def validate(target: str, project_id: str, svc: ProjectService = Depends(service)) -> dict:
    if target == "hardware":
        return svc.validate_hardware(project_id)
    if target in {"protocol", "code"}:
        return {"status": "NEEDS_CONFIRMATION", "target": target, "message": "需要在生成工作区中运行对应检查；未伪造通过状态。"}
    raise HTTPException(404, "不支持的验证目标")


@app.get("/api/projects/{project_id}/artifacts")
def artifacts(project_id: str, svc: ProjectService = Depends(service)) -> list[dict]:
    svc.get(project_id)
    rows = svc.db.query(GeneratedArtifact).filter(GeneratedArtifact.project_id == project_id).all()
    return [{"id": x.id, "kind": x.kind, "path": x.relative_path, "status": x.status, "source_spec_version": x.source_spec_version} for x in rows]


@app.get("/api/projects/{project_id}/artifacts/{artifact_id}")
def artifact(project_id: str, artifact_id: str, svc: ProjectService = Depends(service)) -> FileResponse:
    return FileResponse(svc.artifact_path(project_id, artifact_id))


@app.get("/api/projects/{project_id}/export")
def export(project_id: str, svc: ProjectService = Depends(service)) -> FileResponse:
    path = svc.export(project_id)
    return FileResponse(path, filename=path.name, media_type="application/zip")
