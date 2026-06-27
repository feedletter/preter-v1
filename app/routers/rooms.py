"""미팅룸 생성/검증 — Host(Supabase Auth) 전용 + 코드 검증은 비인증.

PRD: Preter Guest Entry v1.0.0, 7.1/7.3.
"""

import asyncio
import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core import auth_service
from app.core.meeting_summary import finalize_meeting
from app.core.room_state import room_manager
from app.core.supabase_client import get_client

router = APIRouter(prefix="/api/v1/rooms", tags=["rooms"])
bearer_scheme = HTTPBearer()


def _require_user_id(credentials: HTTPAuthorizationCredentials) -> str:
    try:
        user = auth_service.get_user(credentials.credentials)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN"})
    return user["id"]


def _generate_unique_room_code() -> str:
    client = get_client()
    for _ in range(10):
        code = f"{secrets.randbelow(1_000_000):06d}"
        existing = (
            client.table("meeting_rooms")
            .select("id")
            .eq("room_code", code)
            .is_("deleted_at", "null")
            .execute()
        )
        if not existing.data:
            return code
    raise RuntimeError("room_code 생성 재시도 초과 — 사용 가능한 6자리 코드가 부족함")


class RoomResponse(BaseModel):
    id: str
    room_code: str
    title: str | None
    status: str
    max_participants: int


class DraftRoomResponse(BaseModel):
    id: str
    room_code: str
    status: str


# Create Meeting PRD 6.1 — 폼 확정 시 draft_id로 같은 row를 채워 넣는다.
class ConfirmRoomRequest(BaseModel):
    draft_id: str
    title: str
    scheduled_at: str
    project_id: str | None = None
    document_id: str | None = None
    password: str | None = None


class ConfirmRoomResponse(BaseModel):
    id: str
    room_code: str
    title: str
    scheduled_at: str
    status: str
    project_id: str | None
    document_id: str | None


class ValidateRoomResponse(BaseModel):
    valid: bool
    room_id: str
    title: str | None
    has_password: bool
    status: str
    scheduled_at: str | None
    participant_count: int
    max_participants: int


# Member Join MeetingRoom PRD 6.1 — 로그인 멤버가 코드로 기존 미팅에 합류한다.
class MemberJoinRequest(BaseModel):
    project_id: str | None = None
    document_id: str | None = None
    password: str | None = None
    audio_enabled: bool = True


class MemberJoinResponse(BaseModel):
    status: str
    room_id: str
    title: str | None
    scheduled_at: str | None = None
    started_at: str | None = None


class RegisterParticipantRequest(BaseModel):
    role: str = "member"
    language: str
    audio_enabled: bool = True


class RegisterParticipantResponse(BaseModel):
    id: str


class RoomDetailResponse(BaseModel):
    id: str
    room_code: str
    title: str | None
    password: str | None
    status: str
    max_participants: int


class ParticipantResponse(BaseModel):
    id: str
    user_id: str | None
    guest_session_id: str | None
    display_name: str
    role: str
    language: str
    audio_enabled: bool
    joined_at: str
    left_at: str | None
    is_kicked: bool


def _require_room_host(room_id: str, host_user_id: str) -> dict:
    room = (
        get_client()
        .table("meeting_rooms")
        .select("id, host_user_id")
        .eq("id", room_id)
        .single()
        .execute()
    )
    if not room.data or room.data["host_user_id"] != host_user_id:
        raise HTTPException(status_code=404, detail={"error": "ROOM_NOT_FOUND"})
    return room.data


@router.post("/draft", response_model=DraftRoomResponse)
async def create_draft_room(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """Create Meeting PRD 2.2 — 화면 진입 즉시 6자리 코드를 임시 발급.

    미확정 상태로 30분간 유지되며, 확정(POST /rooms) 또는 취소(DELETE /rooms/draft/{id})
    되지 않으면 만료 처리된다 (expires_at 기준, 별도 cleanup 작업에서 정리).
    """
    host_user_id = _require_user_id(credentials)
    room = await asyncio.to_thread(_create_draft_room_row, host_user_id)
    return DraftRoomResponse(id=room["id"], room_code=room["room_code"], status=room["status"])


def _create_draft_room_row(host_user_id: str) -> dict:
    from datetime import datetime, timedelta, timezone

    room_code = _generate_unique_room_code()
    row = {
        "host_user_id": host_user_id,
        "room_code": room_code,
        "status": "draft",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
    }
    result = get_client().table("meeting_rooms").insert(row).execute()
    return result.data[0]


@router.delete("/draft/{room_id}", status_code=204)
async def cancel_draft_room(
    room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    host_user_id = _require_user_id(credentials)
    await asyncio.to_thread(_cancel_draft_room_row, room_id, host_user_id)


def _cancel_draft_room_row(room_id: str, host_user_id: str) -> None:
    room = (
        get_client()
        .table("meeting_rooms")
        .select("id, host_user_id, status")
        .eq("id", room_id)
        .single()
        .execute()
    )
    if not room.data or room.data["host_user_id"] != host_user_id or room.data["status"] != "draft":
        raise HTTPException(status_code=404, detail={"error": "DRAFT_NOT_FOUND"})

    from datetime import datetime, timezone

    get_client().table("meeting_rooms").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", room_id).execute()


@router.post("", response_model=ConfirmRoomResponse)
async def create_room(
    body: ConfirmRoomRequest, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    """Create Meeting PRD 6.1 — draft 미팅룸을 실제 입력값으로 확정한다."""
    host_user_id = _require_user_id(credentials)
    room = await asyncio.to_thread(_confirm_room_row, body, host_user_id)

    return ConfirmRoomResponse(
        id=room["id"],
        room_code=room["room_code"],
        title=room["title"],
        scheduled_at=room["scheduled_at"],
        status=room["status"],
        project_id=room["project_id"],
        document_id=room["document_id"],
    )


def _confirm_room_row(body: ConfirmRoomRequest, host_user_id: str) -> dict:
    from datetime import datetime, timedelta, timezone

    _require_room_host(body.draft_id, host_user_id)

    row = {
        "title": body.title,
        "scheduled_at": body.scheduled_at,
        "project_id": body.project_id,
        "document_id": body.document_id,
        # 최대 6자리 숫자라 경우의 수가 적어 해시의 실익이 낮고, 호스트가 참가자
        # 사이드바에서 다시 조회해 보여줘야 해서 평문으로 저장한다 (Jay 확인).
        "password": body.password or None,
        "status": "waiting",
        # expires_at은 NOT NULL 컬럼 — draft의 30분 임시 만료를 확정 시 24시간으로 되돌린다.
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
    }
    result = (
        get_client().table("meeting_rooms").update(row).eq("id", body.draft_id).execute()
    )
    return result.data[0]


@router.patch("/{room_id}/start", response_model=RoomResponse)
async def start_room(room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """Create Meeting PRD 3.3.3 — 이어폰 확인 후 즉시 입장 시작."""
    host_user_id = _require_user_id(credentials)
    room = await asyncio.to_thread(_start_room_row, room_id, host_user_id)

    # Guest Live Session PRD 1.3/3.2 — waiting 상태로 먼저 입장해 대기 중인 게스트에게
    # 호스트 시작을 즉시 알려 MUTED로 자동 전환시킨다.
    live_room = room_manager.get(room_id)
    if live_room is not None:
        await live_room.set_status("active", started_at=room["started_at"])

    return RoomResponse(
        id=room["id"],
        room_code=room["room_code"],
        title=room["title"],
        status=room["status"],
        max_participants=room["max_participants"],
    )


def _start_room_row(room_id: str, host_user_id: str) -> dict:
    from datetime import datetime, timezone

    _require_room_host(room_id, host_user_id)

    result = (
        get_client()
        .table("meeting_rooms")
        .update({"status": "active", "started_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", room_id)
        .execute()
    )
    room = result.data[0]

    existing_participant = (
        get_client()
        .table("meeting_participants")
        .select("id")
        .eq("room_id", room_id)
        .eq("user_id", host_user_id)
        .execute()
    )
    if not existing_participant.data:
        # 멤버 등록(_register_participant_row)과 동일하게 users.name을 실제 표시 이름으로
        # 쓴다 — 이전엔 "Host"를 그대로 박아서 talk pill/사이드바에 호스트 실명 대신
        # 리터럴 "Host"가 보이는 버그가 있었다.
        profile = get_client().table("users").select("name").eq("id", host_user_id).execute()
        host_display_name = (profile.data[0]["name"] if profile.data else None) or "Host"
        get_client().table("meeting_participants").insert(
            {
                "room_id": room_id,
                "user_id": host_user_id,
                "display_name": host_display_name,
                "role": "host",
                "language": room["primary_language"],
            }
        ).execute()

    return room


@router.delete("/{room_id}/end", status_code=204)
async def end_room(room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """Host Live Session PRD 8.1 — 호스트가 미팅을 종료한다."""
    host_user_id = _require_user_id(credentials)
    live_room = room_manager.get(room_id)
    host_name = await asyncio.to_thread(
        _end_room_row, room_id, host_user_id, live_room is not None
    )

    if live_room is not None:
        await live_room.end_room(host_name)
        blocks = live_room.pop_session_buffer()
        # After Meeting PRD 6-3/8-1 — speaker_blocks 적재 + AI 요약 생성은 응답을 막지
        # 않게 fire-and-forget으로 띄운다(요약 생성은 수 초~수십 초 걸릴 수 있음).
        asyncio.create_task(finalize_meeting(room_id, blocks))


def _end_room_row(room_id: str, host_user_id: str, need_host_name: bool) -> str | None:
    from datetime import datetime, timezone

    _require_room_host(room_id, host_user_id)

    get_client().table("meeting_rooms").update(
        {"status": "ended", "ended_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", room_id).execute()

    if not need_host_name:
        return None

    host_participant = (
        get_client()
        .table("meeting_participants")
        .select("display_name")
        .eq("room_id", room_id)
        .eq("user_id", host_user_id)
        .execute()
    )
    return host_participant.data[0]["display_name"] if host_participant.data else "Host"


@router.get("/{room_id}", response_model=RoomDetailResponse)
async def get_room_detail(room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """Host Live Session PRD 9.4 — 참가자 사이드바에서 미팅 코드/비밀번호를 다시 조회."""
    host_user_id = _require_user_id(credentials)
    data = await asyncio.to_thread(_get_room_detail_row, room_id, host_user_id)
    return RoomDetailResponse(**data)


def _get_room_detail_row(room_id: str, host_user_id: str) -> dict:
    _require_room_host(room_id, host_user_id)

    result = (
        get_client()
        .table("meeting_rooms")
        .select("id, room_code, title, password, status, max_participants")
        .eq("id", room_id)
        .single()
        .execute()
    )
    return result.data


@router.get("/{room_id}/participants", response_model=list[ParticipantResponse])
async def list_participants(
    room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    host_user_id = _require_user_id(credentials)
    rows = await asyncio.to_thread(_list_participants_rows, room_id, host_user_id)
    return [ParticipantResponse(**row) for row in rows]


def _list_participants_rows(room_id: str, host_user_id: str) -> list[dict]:
    _require_room_host(room_id, host_user_id)

    result = (
        get_client()
        .table("meeting_participants")
        .select(
            "id, user_id, guest_session_id, display_name, role, language, "
            "audio_enabled, joined_at, left_at, is_kicked"
        )
        .eq("room_id", room_id)
        .order("joined_at")
        .execute()
    )
    return result.data


@router.delete("/{room_id}/participants/{participant_id}", status_code=204)
async def kick_participant(
    room_id: str,
    participant_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    host_user_id = _require_user_id(credentials)
    kicked_user_id = await asyncio.to_thread(
        _kick_participant_row, room_id, participant_id, host_user_id
    )

    # Host Live Session PRD 9.3 — 강퇴 당한 유저의 WebSocket을 즉시 강제 종료한다.
    live_room = room_manager.get(room_id)
    if live_room is not None and kicked_user_id:
        await live_room.force_disconnect(str(kicked_user_id), {"type": "PARTICIPANT_KICKED"})


def _kick_participant_row(room_id: str, participant_id: str, host_user_id: str) -> str | None:
    from datetime import datetime, timezone

    _require_room_host(room_id, host_user_id)

    client = get_client()
    participant = (
        client.table("meeting_participants")
        .select("id, role, user_id, guest_session_id")
        .eq("id", participant_id)
        .eq("room_id", room_id)
        .execute()
    )
    if not participant.data:
        raise HTTPException(status_code=404, detail={"error": "PARTICIPANT_NOT_FOUND"})
    if participant.data[0]["role"] == "host":
        raise HTTPException(status_code=400, detail={"error": "CANNOT_KICK_HOST"})

    client.table("meeting_participants").update(
        {"is_kicked": True, "left_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", participant_id).execute()

    return participant.data[0]["user_id"] or participant.data[0]["guest_session_id"]


def _load_room_by_code(code: str) -> dict:
    room = (
        get_client()
        .table("meeting_rooms")
        .select("id, title, status, password, scheduled_at, started_at, max_participants")
        .eq("room_code", code)
        .is_("deleted_at", "null")
        .execute()
    )
    if not room.data:
        raise HTTPException(status_code=404, detail={"error": "ROOM_NOT_FOUND"})
    room_row = room.data[0]
    if room_row["status"] == "ended":
        raise HTTPException(status_code=410, detail={"error": "ROOM_EXPIRED"})
    return room_row


@router.get("/{code}/validate", response_model=ValidateRoomResponse)
async def validate_room(code: str):
    data = await asyncio.to_thread(_validate_room_data, code)
    return ValidateRoomResponse(**data)


def _validate_room_data(code: str) -> dict:
    room_row = _load_room_by_code(code)
    client = get_client()

    participant_count = (
        client.table("meeting_participants")
        .select("id", count="exact")
        .eq("room_id", room_row["id"])
        .is_("left_at", "null")
        .execute()
    )

    return {
        "valid": True,
        "room_id": room_row["id"],
        "title": room_row["title"],
        "has_password": bool(room_row["password"]),
        "status": room_row["status"],
        "scheduled_at": room_row["scheduled_at"],
        "participant_count": participant_count.count or 0,
        "max_participants": room_row["max_participants"],
    }


@router.post("/{code}/join", response_model=MemberJoinResponse)
async def join_room_as_member(
    code: str, body: MemberJoinRequest, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    """Member Join MeetingRoom PRD 6.1 — 로그인 멤버가 코드로 기존 미팅을 조회/합류한다.

    참가자 등록(meeting_participants insert)은 여기서 하지 않는다 — active 분기는
    이어폰 확인 후 POST /{room_id}/participants에서, waiting 분기는 호스트가 나중에
    미팅을 시작할 때(해당 시점 재진입) 등록된다 (Create PRD §3.2/6.1과 동일한 지연 등록 패턴).
    """
    _require_user_id(credentials)
    room_row = await asyncio.to_thread(_join_room_as_member_row, code, body)

    if room_row["status"] == "waiting":
        return MemberJoinResponse(
            status="waiting",
            room_id=room_row["id"],
            title=room_row["title"],
            scheduled_at=room_row["scheduled_at"],
        )

    return MemberJoinResponse(
        status="active",
        room_id=room_row["id"],
        title=room_row["title"],
        started_at=room_row.get("started_at"),
    )


def _join_room_as_member_row(code: str, body: MemberJoinRequest) -> dict:
    client = get_client()
    room_row = _load_room_by_code(code)

    current_count = (
        client.table("meeting_participants")
        .select("id", count="exact")
        .eq("room_id", room_row["id"])
        .is_("left_at", "null")
        .execute()
    )
    if (current_count.count or 0) >= room_row["max_participants"]:
        raise HTTPException(status_code=409, detail={"error": "ROOM_FULL"})

    if room_row["password"]:
        if not body.password or body.password != room_row["password"]:
            raise HTTPException(status_code=401, detail={"error": "WRONG_PASSWORD"})

    return room_row


@router.post("/{room_id}/participants", response_model=RegisterParticipantResponse)
async def register_participant(
    room_id: str,
    body: RegisterParticipantRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Member Join MeetingRoom PRD 4.3 — 이어폰 확인 후 멤버를 참가자로 등록한다."""
    user_id = _require_user_id(credentials)
    participant_id = await asyncio.to_thread(_register_participant_row, room_id, body, user_id)
    return RegisterParticipantResponse(id=participant_id)


def _register_participant_row(room_id: str, body: RegisterParticipantRequest, user_id: str) -> str:
    client = get_client()

    room = client.table("meeting_rooms").select("id, status").eq("id", room_id).execute()
    if not room.data:
        raise HTTPException(status_code=404, detail={"error": "ROOM_NOT_FOUND"})
    if room.data[0]["status"] == "ended":
        raise HTTPException(status_code=410, detail={"error": "ROOM_ENDED"})

    existing = (
        client.table("meeting_participants")
        .select("id")
        .eq("room_id", room_id)
        .eq("user_id", user_id)
        .execute()
    )
    if existing.data:
        client.table("meeting_participants").update(
            {"left_at": None, "audio_enabled": body.audio_enabled, "language": body.language}
        ).eq("id", existing.data[0]["id"]).execute()
        return existing.data[0]["id"]

    profile = client.table("users").select("name").eq("id", user_id).execute()
    display_name = (profile.data[0]["name"] if profile.data else None) or "Member"

    result = (
        client.table("meeting_participants")
        .insert(
            {
                "room_id": room_id,
                "user_id": user_id,
                "display_name": display_name,
                "role": "member",
                "language": body.language,
                "audio_enabled": body.audio_enabled,
            }
        )
        .execute()
    )
    return result.data[0]["id"]


@router.post("/{room_id}/leave", status_code=204)
async def leave_room_as_member(
    room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    """Member Join MeetingRoom PRD §5 — 멤버 본인 퇴장(미팅 종료 권한 없음)."""
    user_id = _require_user_id(credentials)
    await asyncio.to_thread(_leave_room_as_member_row, room_id, user_id)


def _leave_room_as_member_row(room_id: str, user_id: str) -> None:
    from datetime import datetime, timezone

    get_client().table("meeting_participants").update(
        {"left_at": datetime.now(timezone.utc).isoformat()}
    ).eq("room_id", room_id).eq("user_id", user_id).execute()
