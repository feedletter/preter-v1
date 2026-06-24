"""Profile & Settings PRD 8.1 — 내 프로필 조회/수정, 플랜 조회.

이름 변경(SCR-P-02)과 언어 설정(SCR-P-04/05)이 같은 PATCH 엔드포인트를 공유한다.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.exceptions import DefaultCredentialsError
from pydantic import BaseModel

from app.core import auth_service
from app.core.storage import StorageError, delete_avatar, upload_avatar
from app.core.supabase_client import get_client

router = APIRouter(prefix="/api/v1/users", tags=["users"])
bearer_scheme = HTTPBearer()

ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/heic"}


def _require_user_id(credentials: HTTPAuthorizationCredentials) -> str:
    try:
        user = auth_service.get_user(credentials.credentials)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN"})
    return user["id"]


class MeResponse(BaseModel):
    id: str
    name: str | None
    email: str | None
    primary_language: str
    app_language: str
    avatar_url: str | None
    updated_at: str


class UpdateMeRequest(BaseModel):
    name: str | None = None
    primary_language: str | None = None
    app_language: str | None = None


class PlanResponse(BaseModel):
    plan: str
    status: str
    minutes_used: int
    minutes_total: int
    period_start: str
    period_end: str


@router.get("/me", response_model=MeResponse)
async def get_me(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    row = (
        get_client()
        .table("users")
        .select("id, name, email, primary_language, app_language, avatar_url, updated_at")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})
    return MeResponse(**row.data)


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)

    if body.name is not None and (len(body.name.strip()) == 0 or len(body.name) > 20):
        raise HTTPException(status_code=422, detail={"error": "INVALID_NAME"})

    update = body.model_dump(exclude_unset=True, exclude_none=True)
    if not update:
        raise HTTPException(status_code=422, detail={"error": "NO_FIELDS_TO_UPDATE"})

    client = get_client()
    client.table("users").update(update).eq("id", user_id).execute()

    row = (
        client.table("users")
        .select("id, name, email, primary_language, app_language, avatar_url, updated_at")
        .eq("id", user_id)
        .single()
        .execute()
    )
    return MeResponse(**row.data)


@router.get("/me/plan", response_model=PlanResponse)
async def get_my_plan(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    row = (
        get_client()
        .table("user_plans")
        .select("plan, status, minutes_used, minutes_total, period_start, period_end")
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail={"error": "PLAN_NOT_FOUND"})
    return PlanResponse(**row.data)


@router.post("/me/avatar", response_model=MeResponse)
async def upload_my_avatar(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)

    content_type = file.content_type or ""
    if content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=415, detail={"error": "UNSUPPORTED_FILE_TYPE"})

    content = await file.read()

    try:
        avatar_url = upload_avatar(user_id, content, content_type)
    except StorageError:
        raise HTTPException(status_code=413, detail={"error": "FILE_TOO_LARGE"})
    except DefaultCredentialsError:
        # 로컬 개발 환경에는 보통 GCP 자격증명이 없음 (Cloud Run은 어태치드 서비스
        # 계정으로 자동 동작). gcloud auth application-default login으로 해결 가능.
        raise HTTPException(status_code=503, detail={"error": "STORAGE_UNAVAILABLE"})

    client = get_client()
    client.table("users").update({"avatar_url": avatar_url}).eq("id", user_id).execute()

    row = (
        client.table("users")
        .select("id, name, email, primary_language, app_language, avatar_url, updated_at")
        .eq("id", user_id)
        .single()
        .execute()
    )
    return MeResponse(**row.data)


@router.delete("/me/avatar", response_model=MeResponse)
async def delete_my_avatar(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    client = get_client()

    current = client.table("users").select("avatar_url").eq("id", user_id).single().execute()
    if current.data and current.data["avatar_url"]:
        try:
            delete_avatar(current.data["avatar_url"])
        except DefaultCredentialsError:
            pass

    client.table("users").update({"avatar_url": None}).eq("id", user_id).execute()

    row = (
        client.table("users")
        .select("id, name, email, primary_language, app_language, avatar_url, updated_at")
        .eq("id", user_id)
        .single()
        .execute()
    )
    return MeResponse(**row.data)
