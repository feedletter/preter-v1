"""LeftSide PRD 8.1/7장 — 프로젝트 목록/생성.
Project Detail PRD 7장 — 프로젝트 상세/수정/삭제, 소속 미팅, 자료 적용, 지시사항.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.supabase_client import get_client
from app.routers.rooms import _require_user_id

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])
bearer_scheme = HTTPBearer()


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: str
    meeting_count: int


class ProjectsListResponse(BaseModel):
    projects: list[ProjectResponse]


class CreateProjectRequest(BaseModel):
    name: str
    description: str | None = None


class ProjectDetailResponse(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: str
    document_count: int
    has_instructions: bool
    instruction_content: str | None


class UpdateProjectRequest(BaseModel):
    name: str


class ProjectMeetingResponse(BaseModel):
    id: str
    title: str | None
    started_at: str | None
    duration_min: int | None
    project_id: str | None
    project_name: str | None


class ProjectMeetingsResponse(BaseModel):
    meetings: list[ProjectMeetingResponse]


class ApplyDocumentRequest(BaseModel):
    document_id: str


class ApplyDocumentResponse(BaseModel):
    project_id: str
    document_id: str
    applied_at: str


class InstructionsRequest(BaseModel):
    content: str


class InstructionsResponse(BaseModel):
    project_id: str
    content: str | None
    updated_at: str | None


def _require_project(project_id: str, user_id: str) -> dict:
    result = (
        get_client()
        .table("projects")
        .select("id, user_id")
        .eq("id", project_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not result.data or result.data[0]["user_id"] != user_id:
        raise HTTPException(status_code=404, detail={"error": "PROJECT_NOT_FOUND"})
    return result.data[0]


@router.get("", response_model=ProjectsListResponse)
async def list_projects(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    client = get_client()

    rows = (
        client.table("projects")
        .select("id, name, description, created_at")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )

    projects = []
    for row in rows.data:
        count_result = (
            client.table("meeting_rooms")
            .select("id", count="exact")
            .eq("project_id", row["id"])
            .is_("deleted_at", "null")
            .execute()
        )
        projects.append(ProjectResponse(**row, meeting_count=count_result.count or 0))

    return ProjectsListResponse(projects=projects)


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    body: CreateProjectRequest, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)

    name = body.name.strip()
    if not name or len(name) > 50:
        raise HTTPException(status_code=422, detail={"error": "INVALID_NAME"})
    if body.description and len(body.description) > 200:
        raise HTTPException(status_code=422, detail={"error": "DESCRIPTION_TOO_LONG"})

    row = {"user_id": user_id, "name": name, "description": body.description}
    result = get_client().table("projects").insert(row).execute()
    created = result.data[0]
    return ProjectResponse(
        id=created["id"],
        name=created["name"],
        description=created["description"],
        created_at=created["created_at"],
        meeting_count=0,
    )


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(project_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    client = get_client()

    project = (
        client.table("projects")
        .select("id, name, description, created_at")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not project.data:
        raise HTTPException(status_code=404, detail={"error": "PROJECT_NOT_FOUND"})
    row = project.data[0]

    doc_count = (
        client.table("project_documents").select("project_id", count="exact").eq("project_id", project_id).execute()
    )
    instructions = client.table("project_instructions").select("content").eq("project_id", project_id).execute()
    instruction_content = instructions.data[0]["content"] if instructions.data else None

    return ProjectDetailResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        created_at=row["created_at"],
        document_count=doc_count.count or 0,
        has_instructions=instruction_content is not None,
        instruction_content=instruction_content,
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: UpdateProjectRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)
    _require_project(project_id, user_id)

    name = body.name.strip()
    if not name or len(name) > 50:
        raise HTTPException(status_code=422, detail={"error": "INVALID_NAME"})

    client = get_client()
    result = client.table("projects").update({"name": name}).eq("id", project_id).execute()
    updated = result.data[0]

    count_result = (
        client.table("meeting_rooms")
        .select("id", count="exact")
        .eq("project_id", project_id)
        .is_("deleted_at", "null")
        .execute()
    )
    return ProjectResponse(
        id=updated["id"],
        name=updated["name"],
        description=updated["description"],
        created_at=updated["created_at"],
        meeting_count=count_result.count or 0,
    )


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """PRD 4.3/8.1: soft delete + 소속 미팅 project_id NULL화 + 연결된 자료/지시사항 행 삭제."""
    user_id = _require_user_id(credentials)
    _require_project(project_id, user_id)

    client = get_client()
    client.table("meeting_rooms").update({"project_id": None}).eq("project_id", project_id).execute()
    client.table("project_documents").delete().eq("project_id", project_id).execute()
    client.table("project_instructions").delete().eq("project_id", project_id).execute()
    client.table("projects").update({"deleted_at": datetime.now(timezone.utc).isoformat()}).eq(
        "id", project_id
    ).execute()


@router.get("/{project_id}/meetings", response_model=ProjectMeetingsResponse)
async def list_project_meetings(
    project_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)
    _require_project(project_id, user_id)

    rows = (
        get_client()
        .table("meeting_rooms")
        .select("id, title, started_at, ended_at, project_id, projects(name)")
        .eq("project_id", project_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )

    meetings = []
    for row in rows.data:
        duration_min = None
        if row["started_at"] and row["ended_at"]:
            started = datetime.fromisoformat(row["started_at"])
            ended = datetime.fromisoformat(row["ended_at"])
            duration_min = max(0, int((ended - started).total_seconds() // 60))

        project = row.get("projects")
        meetings.append(
            ProjectMeetingResponse(
                id=row["id"],
                title=row["title"],
                started_at=row["started_at"],
                duration_min=duration_min,
                project_id=row["project_id"],
                project_name=project["name"] if project else None,
            )
        )

    return ProjectMeetingsResponse(meetings=meetings)


@router.post("/{project_id}/documents", response_model=ApplyDocumentResponse)
async def apply_project_document(
    project_id: str,
    body: ApplyDocumentRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)
    _require_project(project_id, user_id)

    client = get_client()
    document = (
        client.table("documents")
        .select("id")
        .eq("id", body.document_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not document.data:
        raise HTTPException(status_code=404, detail={"error": "DOCUMENT_NOT_FOUND"})

    # project_documents는 project_id가 PK라 upsert로 기존 연결을 교체한다 (프로젝트당 1개 자료).
    result = (
        client.table("project_documents")
        .upsert({"project_id": project_id, "document_id": body.document_id})
        .execute()
    )
    row = result.data[0]
    return ApplyDocumentResponse(
        project_id=row["project_id"], document_id=row["document_id"], applied_at=row["applied_at"]
    )


@router.get("/{project_id}/instructions", response_model=InstructionsResponse)
async def get_project_instructions(
    project_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)
    _require_project(project_id, user_id)

    result = get_client().table("project_instructions").select("project_id, content, updated_at").eq(
        "project_id", project_id
    ).execute()
    if not result.data:
        return InstructionsResponse(project_id=project_id, content=None, updated_at=None)
    row = result.data[0]
    return InstructionsResponse(project_id=row["project_id"], content=row["content"], updated_at=row["updated_at"])


@router.put("/{project_id}/instructions", response_model=InstructionsResponse)
async def put_project_instructions(
    project_id: str,
    body: InstructionsRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)
    _require_project(project_id, user_id)

    content = body.content.strip()
    if len(content) > 500:
        raise HTTPException(status_code=400, detail={"error": "CONTENT_TOO_LONG"})

    # PRD 6.4: 빈값으로 저장 시 지시사항 삭제 처리 (클라이언트가 confirm Alert 표시 후 호출).
    if not content:
        get_client().table("project_instructions").delete().eq("project_id", project_id).execute()
        return InstructionsResponse(project_id=project_id, content=None, updated_at=None)

    result = (
        get_client()
        .table("project_instructions")
        .upsert({"project_id": project_id, "content": content, "updated_at": datetime.now(timezone.utc).isoformat()})
        .execute()
    )
    row = result.data[0]
    return InstructionsResponse(project_id=row["project_id"], content=row["content"], updated_at=row["updated_at"])


@router.delete("/{project_id}/instructions", status_code=204)
async def delete_project_instructions(
    project_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)
    _require_project(project_id, user_id)
    get_client().table("project_instructions").delete().eq("project_id", project_id).execute()
