"""Main 화면 미팅 리스트 — Preter Main PRD 7.1.

project_id/project_name은 PRD가 참조하는 Projects 기능이 아직 없어 항상 null로
내려준다 (스키마 추가 시 조인만 붙이면 됨).
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.meeting_summary import ensure_translated
from app.core.supabase_client import get_client
from app.routers.rooms import _require_user_id

router = APIRouter(prefix="/api/v1/meetings", tags=["meetings"])
bearer_scheme = HTTPBearer()


class MeetingResponse(BaseModel):
    id: str
    room_code: str
    title: str | None
    status: str
    scheduled_at: str | None
    started_at: str | None
    ended_at: str | None
    language: str
    is_host: bool
    project_id: str | None = None
    project_name: str | None = None


class UpcomingMeetingsResponse(BaseModel):
    meetings: list[MeetingResponse]
    total: int


class RecentMeetingResponse(BaseModel):
    id: str
    title: str | None
    started_at: str | None
    duration_min: int | None
    project_id: str | None
    project_name: str | None


class RecentMeetingsResponse(BaseModel):
    meetings: list[RecentMeetingResponse]


@router.get("/recent", response_model=RecentMeetingsResponse)
async def list_recent_meetings(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """LeftSide PRD 8.1 — 미팅 탭 최근 미팅 목록 (started_at DESC)."""
    user_id = _require_user_id(credentials)
    # supabase-py는 동기 블로킹 호출이라 to_thread로 워커 스레드에 위임 (위 list_upcoming_meetings 주석 참조).
    rows = await asyncio.to_thread(_fetch_recent_rows, user_id)

    meetings = []
    for row in rows:
        duration_min = None
        if row["started_at"] and row["ended_at"]:
            from datetime import datetime

            started = datetime.fromisoformat(row["started_at"])
            ended = datetime.fromisoformat(row["ended_at"])
            duration_min = max(0, int((ended - started).total_seconds() // 60))

        project = row.get("projects")
        meetings.append(
            RecentMeetingResponse(
                id=row["id"],
                title=row["title"],
                started_at=row["started_at"],
                duration_min=duration_min,
                project_id=row["project_id"],
                project_name=project["name"] if project else None,
            )
        )

    return RecentMeetingsResponse(meetings=meetings)


def _fetch_recent_rows(user_id: str) -> list[dict]:
    client = get_client()

    rows = (
        client.table("meeting_rooms")
        .select("id, title, started_at, ended_at, project_id, projects(name)")
        .eq("host_user_id", user_id)
        .not_.is_("started_at", "null")
        .is_("deleted_at", "null")
        .order("started_at", desc=True)
        .execute()
    )
    return rows.data


@router.get("/upcoming", response_model=UpcomingMeetingsResponse)
async def list_upcoming_meetings(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)
    # supabase-py 클라이언트는 동기(블로킹) HTTP 호출이라, async 핸들러 안에서 그대로
    # await 없이 실행하면 이 요청의 네트워크 왕복 동안 프로세스의 이벤트 루프 전체가
    # 멈춘다 — Cloud Run이 --max-instances=1로 고정돼 있어(CLAUDE.md) 이 한 번의 블로킹이
    # 같은 시점에 도착한 /auth/me, /users/me, /users/me/plan 같은 다른 요청까지 줄세운다.
    # 메인 화면이 느리다고 느껴진 원인 중 하나라 to_thread로 워커 스레드에 위임한다.
    rows = await asyncio.to_thread(_fetch_upcoming_rows, user_id)

    meetings = [
        MeetingResponse(
            id=row["id"],
            room_code=row["room_code"],
            title=row["title"],
            status=row["status"],
            scheduled_at=row["scheduled_at"],
            started_at=row["started_at"],
            ended_at=row["ended_at"],
            language=row["primary_language"],
            is_host=row["is_host"],
        )
        for row in rows
    ]
    return UpcomingMeetingsResponse(meetings=meetings, total=len(meetings))


def _fetch_upcoming_rows(user_id: str) -> list[dict]:
    client = get_client()

    # Host로 만든 미팅 + Member로 참가 중인 미팅을 합쳐서 보여준다.
    hosted = (
        client.table("meeting_rooms")
        .select("id, room_code, title, status, scheduled_at, started_at, ended_at, primary_language")
        .eq("host_user_id", user_id)
        .in_("status", ["waiting", "active"])
        .is_("deleted_at", "null")
        .execute()
    )
    hosted_ids = {row["id"] for row in hosted.data}

    # 강퇴당한 미팅은 더 이상 이 사람이 참여한 미팅으로 취급하지 않는다 — 메인 화면
    # 목록에서도 사라져야 하므로 is_kicked=True인 참가 row는 제외한다.
    member_rooms = (
        client.table("meeting_participants")
        .select("room_id")
        .eq("user_id", user_id)
        .eq("role", "member")
        .eq("is_kicked", False)
        .execute()
    )
    member_room_ids = [row["room_id"] for row in member_rooms.data]

    rows = [{**row, "is_host": True} for row in hosted.data]
    if member_room_ids:
        joined = (
            client.table("meeting_rooms")
            .select("id, room_code, title, status, scheduled_at, started_at, ended_at, primary_language")
            .in_("id", member_room_ids)
            .in_("status", ["waiting", "active"])
            .is_("deleted_at", "null")
            .execute()
        )
        seen_ids = {row["id"] for row in rows}
        rows.extend({**row, "is_host": row["id"] in hosted_ids} for row in joined.data if row["id"] not in seen_ids)

    def sort_key(row: dict):
        return row["scheduled_at"] or row["started_at"] or ""

    rows.sort(key=sort_key)
    return rows


# ---- After Meeting PRD 6장 ------------------------------------------------


class SummaryContentResponse(BaseModel):
    one_liner: str
    decisions: list
    action_items: list
    follow_up_schedule: list


class MeetingSummaryResponse(BaseModel):
    meeting_room_id: str
    title: str | None
    started_at: str | None
    ended_at: str | None
    duration_minutes: int | None
    project_name: str | None
    participants: list[str]
    notes_status: str
    requester_preferred_language: str
    summary: SummaryContentResponse | None = None


def _require_meeting_access(room_id: str, user_id: str) -> dict:
    """403/404 처리 — 미팅 자체가 없으면 404, 참가자가 아니면 403(PRD 9장)."""
    room = (
        get_client()
        .table("meeting_rooms")
        .select("id, title, started_at, ended_at, status, host_user_id, project_id, projects(name)")
        .eq("id", room_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not room.data:
        raise HTTPException(status_code=404, detail={"error": "ROOM_NOT_FOUND"})
    room_row = room.data[0]

    if room_row["host_user_id"] == user_id:
        return room_row

    # 강퇴당한 사람은 이 미팅에 참여했던 것으로 취급하지 않는다 — After Meeting
    # 요약/발화기록도 더 이상 보여주면 안 되므로 is_kicked 행은 참가자로 인정하지 않는다.
    participant = (
        get_client()
        .table("meeting_participants")
        .select("id")
        .eq("room_id", room_id)
        .eq("user_id", user_id)
        .eq("is_kicked", False)
        .execute()
    )
    if not participant.data:
        raise HTTPException(status_code=403, detail={"error": "NOT_A_PARTICIPANT"})
    return room_row


@router.get("/{meeting_room_id}/summary", response_model=MeetingSummaryResponse)
async def get_meeting_summary(
    meeting_room_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)
    data = await asyncio.to_thread(_fetch_summary_data, meeting_room_id, user_id)
    return MeetingSummaryResponse(**data)


def _fetch_summary_data(meeting_room_id: str, user_id: str) -> dict:
    client = get_client()
    room_row = _require_meeting_access(meeting_room_id, user_id)

    duration_minutes = None
    if room_row["started_at"] and room_row["ended_at"]:
        from datetime import datetime

        started = datetime.fromisoformat(room_row["started_at"])
        ended = datetime.fromisoformat(room_row["ended_at"])
        duration_minutes = max(0, round((ended - started).total_seconds() / 60))

    participants = (
        client.table("meeting_participants").select("display_name").eq("room_id", meeting_room_id).execute()
    )
    participant_names = [p["display_name"] for p in participants.data]

    requester = client.table("users").select("primary_language").eq("id", user_id).single().execute()
    requester_lang = requester.data.get("primary_language") or "en"

    notes = client.table("meeting_notes").select("*").eq("meeting_room_id", meeting_room_id).execute()
    project = room_row.get("projects")

    base = {
        "meeting_room_id": meeting_room_id,
        "title": room_row["title"],
        "started_at": room_row["started_at"],
        "ended_at": room_row["ended_at"],
        "duration_minutes": duration_minutes,
        "project_name": project["name"] if project else None,
        "participants": participant_names,
        "requester_preferred_language": requester_lang,
    }

    if not notes.data:
        return {**base, "notes_status": "pending", "summary": None}

    note_row = notes.data[0]
    if note_row["status"] != "completed":
        return {**base, "notes_status": note_row["status"], "summary": None}

    note_row = ensure_translated(note_row, requester_lang)
    summary = SummaryContentResponse(
        one_liner=note_row["one_liner"].get(requester_lang, ""),
        decisions=note_row["decisions"].get(requester_lang, []),
        action_items=note_row["action_items"].get(requester_lang, []),
        follow_up_schedule=note_row["follow_up_schedule"].get(requester_lang, []),
    )
    return {**base, "notes_status": "completed", "summary": summary}


class SpeakerBlockResponse(BaseModel):
    id: str
    speaker_user_id: str | None
    speaker_name: str
    country_code: str | None
    original_language: str
    original_text: str
    translations: dict
    started_at: str
    ended_at: str
    sequence: int


class SpeakerBlocksResponse(BaseModel):
    meeting_room_id: str
    requester_preferred_language: str
    has_more: bool
    next_before_sequence: int | None
    speaker_blocks: list[SpeakerBlockResponse]


@router.get("/{meeting_room_id}/speaker-blocks", response_model=SpeakerBlocksResponse)
async def get_speaker_blocks(
    meeting_room_id: str,
    limit: int = Query(30, ge=1, le=30),
    before_sequence: int | None = Query(None),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)
    data = await asyncio.to_thread(_fetch_speaker_blocks, meeting_room_id, user_id, limit, before_sequence)
    return SpeakerBlocksResponse(**data)


def _fetch_speaker_blocks(
    meeting_room_id: str, user_id: str, limit: int, before_sequence: int | None
) -> dict:
    client = get_client()
    _require_meeting_access(meeting_room_id, user_id)

    requester = client.table("users").select("primary_language").eq("id", user_id).single().execute()
    requester_lang = requester.data.get("primary_language") or "en"

    # 커서 기반(sequence) 페이지네이션 — offset 방식 금지(PRD 10장, 풀스캔 방지).
    # limit+1개를 가져와 31번째가 있으면 has_more=true로 판단한다.
    query = (
        client.table("speaker_blocks")
        .select("*")
        .eq("meeting_room_id", meeting_room_id)
        .order("sequence", desc=True)
        .limit(limit + 1)
    )
    if before_sequence is not None:
        query = query.lt("sequence", before_sequence)
    rows = query.execute().data

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_before_sequence = min((r["sequence"] for r in rows), default=None) if has_more else None

    return {
        "meeting_room_id": meeting_room_id,
        "requester_preferred_language": requester_lang,
        "has_more": has_more,
        "next_before_sequence": next_before_sequence,
        "speaker_blocks": rows,
    }
