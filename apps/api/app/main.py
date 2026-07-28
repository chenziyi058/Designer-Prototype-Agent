from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, engine, get_db
from .generator import affected_modules
from .models import AgentRun, GeneratedArtifact, ProjectSpecRecord
from .orchestrator import PrototypeEngineerOrchestrator
from .providers import ProviderError, get_provider
from .schemas import MessageCreate, ProjectCreate, ProjectSpec
from .service import ProjectService

Base.metadata.create_all(engine)
app = FastAPI(
    title="Designer Prototype Agent API", version="0.1.0",
    description="ProjectSpec-first smart hardware prototyping workflow.",
)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins.split(","),
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


def service(db: Session = Depends(get_db)) -> ProjectService:
    return ProjectService(db)


def orchestrator() -> PrototypeEngineerOrchestrator:
    return PrototypeEngineerOrchestrator(get_provider())


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
    return {
        "status": "ok",
        "provider": settings.model_provider,
        "deepseek_configured": bool(settings.deepseek_api_key),
        "models": {
            "default": settings.deepseek_default_model,
            "reasoning": settings.model_for("reasoning"),
            "coding": settings.model_for("coding"),
        } if settings.model_provider == "deepseek" else {},
        "capabilities": {
            "persistent_projects": True,
            "deepseek": (
                settings.model_provider == "deepseek"
                and bool(settings.deepseek_api_key)
            ),
            "hosted_static_validation": True,
            "python_execution": True,
            "platformio_execution": True,
            "local_executor_available": True,
        },
    }


@app.post("/api/projects", status_code=201)
async def create_project(
    data: ProjectCreate,
    svc: ProjectService = Depends(service),
    agent: PrototypeEngineerOrchestrator = Depends(orchestrator),
) -> dict:
    try:
        spec, output = await agent.interpret_requirements(data)
        project = svc.create(data, spec)
        svc.record_agent_run(
            project.id,
            task_name="解析需求并创建 ProjectSpec",
            provider=output.provider,
            model=output.model,
            skill="Requirement Interpreter",
            input_summary=data.description[:500],
            result_summary=output.content,
            generated_files=["01_requirements/project-spec.json"],
            token_usage=output.usage,
            requires_confirmation=output.requires_confirmation,
        )
        return {
            **project_view(project),
            "agent": {
                "provider": output.provider,
                "model": output.model,
                "summary": output.content,
                "requires_confirmation": output.requires_confirmation,
            },
        }
    except ProviderError as error:
        raise HTTPException(502, f"DeepSeek 需求解析失败: {error}") from error


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
    try:
        return svc.spec(project_id).model_dump(mode="json")
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


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
    try:
        record = svc.restore_spec(project_id, version)
        return {"version": record.version, "reason": record.reason}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@app.post("/api/projects/{project_id}/messages")
async def add_message(
    project_id: str,
    data: MessageCreate,
    svc: ProjectService = Depends(service),
    agent: PrototypeEngineerOrchestrator = Depends(orchestrator),
) -> dict:
    try:
        modules = affected_modules(data.content)
        result = await agent.process_project_message(
            svc.spec(project_id), data.content, modules, data.apply_change
        )
        spec_version = svc.get(project_id).current_spec_version
        if result.updated_spec is not None:
            record = svc.update_spec(
                project_id,
                result.updated_spec,
                f"用户消息：{data.content[:240]}",
                result.affected_modules,
            )
            spec_version = record.version
        output = result.output
        response = svc.save_message_pair(
            project_id, data, output.content, result.affected_modules,
            output.provider, output.model
        )
        svc.record_agent_run(
            project_id,
            task_name="分析项目消息",
            provider=output.provider,
            model=output.model,
            skill="Requirement Clarifier / Impact Analyzer",
            input_summary=data.content,
            result_summary=output.content[:1000],
            token_usage=output.usage,
            requires_confirmation=output.requires_confirmation,
        )
        return {
            **response,
            "spec_updated": result.updated_spec is not None,
            "spec_version": spec_version,
        }
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ProviderError as error:
        raise HTTPException(502, f"DeepSeek 对话失败: {error}") from error


@app.get("/api/projects/{project_id}/messages")
def messages(project_id: str, svc: ProjectService = Depends(service)) -> list[dict]:
    return [{"id": x.id, "role": x.role, "content": x.content, "metadata": x.metadata_json, "created_at": x.created_at} for x in svc.messages(project_id)]


@app.post("/api/projects/{project_id}/generate/{module}")
async def generate(
    module: str,
    project_id: str,
    svc: ProjectService = Depends(service),
    agent: PrototypeEngineerOrchestrator = Depends(orchestrator),
) -> dict:
    supported = {"architecture", "hardware", "bom", "protocol", "firmware", "python", "ui", "tests", "docs", "all"}
    if module not in supported:
        raise HTTPException(404, "不支持的生成模块")
    try:
        project = svc.get(project_id)
        artifacts = svc.generate_all(project)
        output = await agent.generate_module_analysis(svc.spec(project_id), module)
        agent_artifact = svc.write_agent_artifact(project_id, module, output.content)
        svc.record_agent_run(
            project_id,
            task_name=f"生成 {module}",
            provider=output.provider,
            model=output.model,
            skill=f"{module.title()} Generator",
            input_summary=f"ProjectSpec v{project.current_spec_version}",
            result_summary=output.content[:1000],
            generated_files=[
                *(item.relative_path for item in artifacts),
                agent_artifact.relative_path,
            ],
            token_usage=output.usage,
            requires_confirmation=output.requires_confirmation,
        )
        return {
            "status": "GENERATED",
            "module": module,
            "artifact_count": len(artifacts) + 1,
            "agent_artifact": agent_artifact.relative_path,
            "source_spec_version": project.current_spec_version,
            "provider": output.provider,
            "model": output.model,
            "requires_confirmation": output.requires_confirmation,
        }
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ProviderError as error:
        svc.record_agent_run(
            project_id,
            task_name=f"生成 {module}",
            provider=settings.model_provider,
            model=settings.model_for("coding" if module in {"firmware", "python", "protocol"} else "reasoning"),
            skill=f"{module.title()} Generator",
            input_summary="模型调用失败",
            error=str(error),
            requires_confirmation=True,
        )
        raise HTTPException(502, f"DeepSeek 模块生成失败: {error}") from error


@app.post("/api/agent/test")
async def test_agent_connection(
    agent: PrototypeEngineerOrchestrator = Depends(orchestrator),
) -> dict:
    if settings.model_provider != "deepseek":
        raise HTTPException(409, "当前 MODEL_PROVIDER 不是 deepseek")
    try:
        output = await agent.test_connection()
        return {
            "status": "connected",
            "provider": output.provider,
            "model": output.model,
            "response": output.content,
            "usage": output.usage,
        }
    except ProviderError as error:
        raise HTTPException(502, f"DeepSeek 连接测试失败: {error}") from error


@app.get("/api/projects/{project_id}/agent-runs")
def agent_runs(project_id: str, svc: ProjectService = Depends(service)) -> list[dict]:
    svc.get(project_id)
    rows = svc.db.query(AgentRun).filter(
        AgentRun.project_id == project_id
    ).order_by(AgentRun.created_at.desc()).all()
    return [
        {
            "id": row.id,
            "task_name": row.task_name,
            "provider": row.provider,
            "model": row.model_name,
            "skill": row.skill_name,
            "result_summary": row.result_summary,
            "generated_files": row.generated_files,
            "error": row.error,
            "token_usage": row.token_usage,
            "requires_confirmation": row.requires_confirmation,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@app.post("/api/projects/{project_id}/validate/{target}")
def validate(target: str, project_id: str, svc: ProjectService = Depends(service)) -> dict:
    try:
        if target == "hardware":
            return svc.validate_hardware(project_id)
        if target == "protocol":
            return svc.validate_protocol_workspace(project_id)
        if target == "code":
            return svc.validate_code_workspace(project_id)
        raise HTTPException(404, "不支持的验证目标")
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/api/projects/{project_id}/artifacts")
def artifacts(project_id: str, svc: ProjectService = Depends(service)) -> list[dict]:
    rows = svc.artifacts(project_id)
    return [{"id": x.id, "kind": x.kind, "path": x.relative_path, "status": x.status, "source_spec_version": x.source_spec_version} for x in rows]


@app.get("/api/projects/{project_id}/artifacts/{artifact_id}")
def artifact(project_id: str, artifact_id: str, svc: ProjectService = Depends(service)) -> FileResponse:
    try:
        return FileResponse(svc.artifact_path(project_id, artifact_id))
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/api/projects/{project_id}/artifacts/{artifact_id}/content")
def artifact_content(
    project_id: str, artifact_id: str, svc: ProjectService = Depends(service)
) -> dict:
    try:
        path = svc.artifact_path(project_id, artifact_id)
        if path.stat().st_size > 1_000_000:
            raise HTTPException(413, "文件过大，请下载后查看")
        return {
            "path": path.name,
            "content": path.read_text(encoding="utf-8", errors="replace"),
        }
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/api/projects/{project_id}/export")
def export(project_id: str, svc: ProjectService = Depends(service)) -> FileResponse:
    try:
        path = svc.export(project_id)
        return FileResponse(path, filename=path.name, media_type="application/zip")
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/api/projects/{project_id}/validations")
def validation_history(project_id: str, svc: ProjectService = Depends(service)) -> list[dict]:
    return [
        {
            "id": row.id,
            "validator": row.validator,
            "status": row.status,
            "report": row.report,
            "created_at": row.created_at,
        }
        for row in svc.validations(project_id)
    ]
