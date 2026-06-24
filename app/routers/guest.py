"""Guest 참가 — 계정 없이 미팅 코드만으로 참가하는 플로우.

PRD: Preter Guest Entry v1.0.0, 4장(예외처리) / 7.1/7.2.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core import guest_auth
from app.core.email import EmailError, send_meeting_summary_email
from app.core.supabase_client import get_client

router = APIRouter(prefix="/api/v1/guest", tags=["guest"])
bearer_scheme = HTTPBearer()


class JoinRequest(BaseModel):
    room_code: str
    display_name: str
    password: str | None = None
    email: str | None = None
    language: str = "ko"
    audio_enabled: bool = True


class JoinResponse(BaseModel):
    guest_session_token: str
    room_id: str
    room_title: str | None
    participants: int
    expires_at: str


def _active_participant_count(room_id: str) -> int:
    result = (
        get_client()
        .table("meeting_participants")
        .select("id", count="exact")
        .eq("room_id", room_id)
        .is_("left_at", "null")
        .execute()
    )
    return result.count or 0


@router.post("/join", response_model=JoinResponse)
async def join(body: JoinRequest):
    client = get_client()

    room = (
        client.table("meeting_rooms")
        .select("id, title, status, password_hash, scheduled_at, ended_at, max_participants")
        .eq("room_code", body.room_code)
        .is_("deleted_at", "null")
        .execute()
    )
    if not room.data:
        raise HTTPException(status_code=404, detail={"error": "ROOM_NOT_FOUND"})
    room_row = room.data[0]

    # PRD 4.2 순서: 종료 → 시작 전 → 정원 초과 → 비밀번호
    if room_row["status"] == "ended" or room_row["ended_at"]:
        raise HTTPException(
            status_code=410, detail={"error": "ROOM_ENDED", "ended_at": room_row["ended_at"]}
        )

    if room_row["scheduled_at"]:
        scheduled_at = datetime.fromisoformat(room_row["scheduled_at"])
        if datetime.now(timezone.utc) < scheduled_at:
            raise HTTPException(
                status_code=425,
                detail={"error": "ROOM_NOT_STARTED", "scheduled_at": room_row["scheduled_at"]},
            )

    current_count = _active_participant_count(room_row["id"])
    if current_count >= room_row["max_participants"]:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "ROOM_FULL",
                "current": current_count,
                "max": room_row["max_participants"],
            },
        )

    if room_row["password_hash"]:
        if not body.password or not guest_auth.verify_password(
            body.password, room_row["password_hash"]
        ):
            raise HTTPException(status_code=401, detail={"error": "WRONG_PASSWORD"})

    session_row = (
        client.table("guest_sessions")
        .insert(
            {
                "session_token": "",  # 발급 직후 id를 알아야 토큰을 만들 수 있어 임시값 → 아래서 갱신
                "room_id": room_row["id"],
                "display_name": body.display_name,
                "email": body.email,
                "language": body.language,
                "audio_enabled": body.audio_enabled,
            }
        )
        .execute()
    )
    session = session_row.data[0]

    token = guest_auth.issue_guest_token(session["id"], room_row["id"])
    client.table("guest_sessions").update({"session_token": token}).eq("id", session["id"]).execute()

    client.table("meeting_participants").insert(
        {
            "room_id": room_row["id"],
            "guest_session_id": session["id"],
            "display_name": body.display_name,
            "role": "guest",
            "language": body.language,
            "audio_enabled": body.audio_enabled,
        }
    ).execute()

    return JoinResponse(
        guest_session_token=token,
        room_id=room_row["id"],
        room_title=room_row["title"],
        participants=current_count + 1,
        expires_at=session["expires_at"],
    )


def _require_guest_session(credentials: HTTPAuthorizationCredentials) -> dict:
    try:
        return guest_auth.verify_guest_token(credentials.credentials)
    except guest_auth.GuestAuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_GUEST_TOKEN"})


@router.post("/leave", status_code=204)
async def leave(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    payload = _require_guest_session(credentials)
    client = get_client()
    client.table("meeting_participants").update(
        {"left_at": datetime.now(timezone.utc).isoformat()}
    ).eq("guest_session_id", payload["guest_session_id"]).execute()


class SummaryResponse(BaseModel):
    status: str
    summary_text: str | None
    action_items: list
    script_url: str | None
    completed_at: str | None


def _get_summary_for_guest(payload: dict) -> dict:
    client = get_client()
    summary = (
        client.table("meeting_summaries")
        .select("status, summary_text, action_items, script_url, completed_at")
        .eq("room_id", payload["room_id"])
        .is_("deleted_at", "null")
        .execute()
    )
    if not summary.data:
        raise HTTPException(status_code=404, detail={"error": "SUMMARY_NOT_FOUND"})
    return summary.data[0]


@router.get("/summary/{room_id}", response_model=SummaryResponse)
async def get_summary(
    room_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    payload = _require_guest_session(credentials)
    if payload["room_id"] != room_id:
        raise HTTPException(status_code=403, detail={"error": "ROOM_MISMATCH"})

    row = _get_summary_for_guest(payload)
    return SummaryResponse(**row)


@router.post("/summary/resend", status_code=204)
async def resend_summary(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    payload = _require_guest_session(credentials)
    client = get_client()

    session = (
        client.table("guest_sessions")
        .select("email, room_id")
        .eq("id", payload["guest_session_id"])
        .single()
        .execute()
    )
    if not session.data or not session.data["email"]:
        raise HTTPException(status_code=400, detail={"error": "EMAIL_NOT_SET"})

    summary_row = _get_summary_for_guest(payload)
    room = (
        client.table("meeting_rooms").select("title").eq("id", session.data["room_id"]).single().execute()
    )

    try:
        sent = send_meeting_summary_email(
            to_email=session.data["email"],
            room_title=room.data["title"] if room.data else None,
            summary_text=summary_row["summary_text"],
            action_items=summary_row["action_items"] or [],
        )
    except EmailError:
        raise HTTPException(status_code=502, detail={"error": "EMAIL_SEND_FAILED"})

    if sent:
        client.table("guest_sessions").update({"summary_sent": True}).eq(
            "id", payload["guest_session_id"]
        ).execute()
