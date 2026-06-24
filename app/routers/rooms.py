"""미팅룸 생성/검증 — Host(Supabase Auth) 전용 + 코드 검증은 비인증.

PRD: Preter Guest Entry v1.0.0, 7.1/7.3.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core import auth_service
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


class CreateRoomRequest(BaseModel):
    title: str | None = None
    password: str | None = None
    max_participants: int = 10
    primary_language: str = "ko"
    scheduled_at: str | None = None


class RoomResponse(BaseModel):
    id: str
    room_code: str
    title: str | None
    status: str
    max_participants: int


class ValidateRoomResponse(BaseModel):
    valid: bool
    has_password: bool
    status: str
    scheduled_at: str | None
    participant_count: int
    max_participants: int


class ParticipantResponse(BaseModel):
    id: str
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


@router.post("", response_model=RoomResponse)
async def create_room(
    body: CreateRoomRequest, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    host_user_id = _require_user_id(credentials)

    from app.core.guest_auth import hash_password

    room_code = _generate_unique_room_code()
    row = {
        "host_user_id": host_user_id,
        "room_code": room_code,
        "title": body.title,
        "password_hash": hash_password(body.password) if body.password else None,
        "max_participants": body.max_participants,
        "primary_language": body.primary_language,
        "scheduled_at": body.scheduled_at,
    }
    result = get_client().table("meeting_rooms").insert(row).execute()
    room = result.data[0]

    # Host 본인도 참가자 테이블에 기록 (PRD 3.4 participants roles)
    get_client().table("meeting_participants").insert(
        {
            "room_id": room["id"],
            "user_id": host_user_id,
            "display_name": "Host",
            "role": "host",
            "language": body.primary_language,
        }
    ).execute()

    return RoomResponse(
        id=room["id"],
        room_code=room["room_code"],
        title=room["title"],
        status=room["status"],
        max_participants=room["max_participants"],
    )


@router.delete("/{room_id}", status_code=204)
async def end_room(room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    host_user_id = _require_user_id(credentials)
    _require_room_host(room_id, host_user_id)

    from datetime import datetime, timezone

    get_client().table("meeting_rooms").update(
        {"status": "ended", "ended_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", room_id).execute()


@router.get("/{room_id}/participants", response_model=list[ParticipantResponse])
async def list_participants(
    room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    host_user_id = _require_user_id(credentials)
    _require_room_host(room_id, host_user_id)

    result = (
        get_client()
        .table("meeting_participants")
        .select("id, display_name, role, language, audio_enabled, joined_at, left_at, is_kicked")
        .eq("room_id", room_id)
        .order("joined_at")
        .execute()
    )
    return [ParticipantResponse(**row) for row in result.data]


@router.delete("/{room_id}/participants/{participant_id}", status_code=204)
async def kick_participant(
    room_id: str,
    participant_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    host_user_id = _require_user_id(credentials)
    _require_room_host(room_id, host_user_id)

    from datetime import datetime, timezone

    client = get_client()
    participant = (
        client.table("meeting_participants")
        .select("id, role")
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


@router.get("/{code}/validate", response_model=ValidateRoomResponse)
async def validate_room(code: str):
    client = get_client()
    room = (
        client.table("meeting_rooms")
        .select("id, status, password_hash, scheduled_at, max_participants")
        .eq("room_code", code)
        .is_("deleted_at", "null")
        .execute()
    )
    if not room.data:
        raise HTTPException(status_code=404, detail={"error": "ROOM_NOT_FOUND"})

    room_row = room.data[0]
    if room_row["status"] == "ended":
        raise HTTPException(status_code=410, detail={"error": "ROOM_EXPIRED"})

    participant_count = (
        client.table("meeting_participants")
        .select("id", count="exact")
        .eq("room_id", room_row["id"])
        .is_("left_at", "null")
        .execute()
    )

    return ValidateRoomResponse(
        valid=True,
        has_password=bool(room_row["password_hash"]),
        status=room_row["status"],
        scheduled_at=room_row["scheduled_at"],
        participant_count=participant_count.count or 0,
        max_participants=room_row["max_participants"],
    )
