"""Main 화면 미팅 리스트 — Preter Main PRD 7.1.

project_id/project_name은 PRD가 참조하는 Projects 기능이 아직 없어 항상 null로
내려준다 (스키마 추가 시 조인만 붙이면 됨).
"""

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.supabase_client import get_client
from app.routers.rooms import _require_user_id

router = APIRouter(prefix="/api/v1/meetings", tags=["meetings"])
bearer_scheme = HTTPBearer()


class MeetingResponse(BaseModel):
    id: str
    title: str | None
    status: str
    scheduled_at: str | None
    started_at: str | None
    ended_at: str | None
    language: str
    project_id: str | None = None
    project_name: str | None = None


class UpcomingMeetingsResponse(BaseModel):
    meetings: list[MeetingResponse]
    total: int


@router.get("/upcoming", response_model=UpcomingMeetingsResponse)
async def list_upcoming_meetings(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)
    client = get_client()

    # Host로 만든 미팅 + Member로 참가 중인 미팅을 합쳐서 보여준다.
    hosted = (
        client.table("meeting_rooms")
        .select("id, title, status, scheduled_at, started_at, ended_at, primary_language")
        .eq("host_user_id", user_id)
        .in_("status", ["waiting", "active"])
        .is_("deleted_at", "null")
        .execute()
    )

    member_rooms = (
        client.table("meeting_participants")
        .select("room_id")
        .eq("user_id", user_id)
        .eq("role", "member")
        .execute()
    )
    member_room_ids = [row["room_id"] for row in member_rooms.data]

    rows = list(hosted.data)
    if member_room_ids:
        joined = (
            client.table("meeting_rooms")
            .select("id, title, status, scheduled_at, started_at, ended_at, primary_language")
            .in_("id", member_room_ids)
            .in_("status", ["waiting", "active"])
            .is_("deleted_at", "null")
            .execute()
        )
        seen_ids = {row["id"] for row in rows}
        rows.extend(row for row in joined.data if row["id"] not in seen_ids)

    def sort_key(row: dict):
        return row["scheduled_at"] or row["started_at"] or ""

    rows.sort(key=sort_key)

    meetings = [
        MeetingResponse(
            id=row["id"],
            title=row["title"],
            status=row["status"],
            scheduled_at=row["scheduled_at"],
            started_at=row["started_at"],
            ended_at=row["ended_at"],
            language=row["primary_language"],
        )
        for row in rows
    ]
    return UpcomingMeetingsResponse(meetings=meetings, total=len(meetings))
