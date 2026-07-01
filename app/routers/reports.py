"""Profile & Settings PRD 6장 / 8.2 — 앱 문제 신고."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from app.core.supabase_client import get_client
from app.routers.rooms import _require_user_id

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])
bearer_scheme = HTTPBearer()


class DeviceInfo(BaseModel):
    platform: str | None = None
    os_version: str | None = None


class CreateReportRequest(BaseModel):
    category: str
    body: str
    device_info: DeviceInfo | None = None
    app_version: str | None = None

    @field_validator("category")
    @classmethod
    def category_must_be_supported(cls, value: str) -> str:
        if value not in ("audio", "connection", "ui", "other"):
            raise ValueError("unsupported category")
        return value


class CreateReportResponse(BaseModel):
    id: str
    created_at: str


@router.post("", response_model=CreateReportResponse, status_code=201)
async def create_report(
    body: CreateReportRequest, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)

    if len(body.body.strip()) < 10:
        raise HTTPException(status_code=400, detail={"error": "BODY_TOO_SHORT"})

    created = await asyncio.to_thread(_insert_report_row, user_id, body)
    return CreateReportResponse(id=created["id"], created_at=created["created_at"])


def _insert_report_row(user_id: str, body: CreateReportRequest) -> dict:
    row = {
        "user_id": user_id,
        "category": body.category,
        "body": body.body.strip(),
        "device_info": body.device_info.model_dump() if body.device_info else None,
        "app_version": body.app_version,
    }
    result = get_client().table("reports").insert(row).execute()
    return result.data[0]
