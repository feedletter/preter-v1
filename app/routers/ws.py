import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core import session_repository, session_store
from app.core.auth import AuthError, verify_token
from app.core.gemini_session import GeminiLiveSession
from app.core.guest_auth import GuestAuthError, verify_guest_token
from app.core.meeting_context import fetch_meeting_context
from app.core.room_state import Participant, room_manager
from app.core.supabase_client import get_client

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/session/{session_id}")
async def interpret_session(
    websocket: WebSocket, session_id: str, token: str, target_lang: str = "en"
):
    try:
        claims = verify_token(token)
    except AuthError as exc:
        logger.warning("WebSocket 인증 실패: %s", exc)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    user_id = claims["sub"]

    # 동일 session_id로 재연결된 경우(55분 선제 재연결 등) Supabase에서
    # resumption handle을 복원해 통역 컨텍스트를 이어간다.
    saved = await asyncio.to_thread(session_repository.load, session_id)
    resumption_handle = saved["resumption_handle"] if saved else None

    gemini = GeminiLiveSession(
        session_id=session_id,
        user_id=user_id,
        target_language_code=target_lang,
        resumption_handle=resumption_handle,
    )
    await gemini.connect()
    session_store.register(session_id, gemini)

    try:
        await asyncio.gather(
            _relay_client_to_gemini(websocket, gemini),
            _relay_gemini_to_client(websocket, gemini),
            _watch_reconnect_triggers(gemini),
        )
    except WebSocketDisconnect:
        logger.info("클라이언트 연결 종료: session_id=%s", session_id)
    finally:
        session_store.remove(session_id)
        await gemini.close()
        await asyncio.to_thread(session_repository.delete, session_id)


async def _relay_client_to_gemini(websocket: WebSocket, gemini: GeminiLiveSession):
    """클라이언트가 보낸 오디오 청크(PCM 16kHz)를 Gemini로 전달."""
    while True:
        chunk = await websocket.receive_bytes()
        await gemini.send_audio(chunk)


async def _relay_gemini_to_client(websocket: WebSocket, gemini: GeminiLiveSession):
    """Gemini가 생성한 통역 오디오를 클라이언트로 전달."""
    while True:
        async for message in gemini.receive():
            content = message.server_content
            if content and content.model_turn:
                for part in content.model_turn.parts:
                    if part.inline_data and part.inline_data.data:
                        await websocket.send_bytes(part.inline_data.data)


async def _watch_reconnect_triggers(gemini: GeminiLiveSession):
    """GoAway 알림 또는 55분 경과 시점에 선제적으로 재연결한다 (CLAUDE.md 확정 사항)."""
    while True:
        proactive_wait = gemini.seconds_until_proactive_reconnect()
        await asyncio.sleep(min(proactive_wait, 5))

        if gemini.seconds_until_proactive_reconnect() <= 0:
            logger.info("55분 경과, 선제적 재연결 수행")
            await gemini.reconnect()
            continue

        if gemini.goaway_deadline is not None:
            import time

            if time.monotonic() >= gemini.goaway_deadline:
                logger.info("GoAway 데드라인 도달, 재연결 수행")
                await gemini.reconnect()


def _load_room_row(room_id: str) -> dict | None:
    result = (
        get_client()
        .table("meeting_rooms")
        .select("id, status, project_id, document_id")
        .eq("id", room_id)
        .execute()
    )
    return result.data[0] if result.data else None


def _load_participant_row(room_id: str, user_id: str, is_guest: bool) -> dict | None:
    query = (
        get_client()
        .table("meeting_participants")
        .select("id, display_name, role, language, is_kicked")
        .eq("room_id", room_id)
    )
    query = query.eq("guest_session_id", user_id) if is_guest else query.eq("user_id", user_id)
    result = query.execute()
    return result.data[0] if result.data else None


def _authenticate_room_connection(token: str, room_id: str) -> tuple[str, bool] | None:
    """반환: (participant_식별자, is_guest) — 인증 실패 시 None."""
    try:
        claims = verify_token(token)
        return claims["sub"], False
    except AuthError:
        pass

    try:
        guest_claims = verify_guest_token(token)
    except GuestAuthError:
        return None
    if guest_claims.get("room_id") != room_id:
        return None
    return guest_claims["guest_session_id"], True


@router.websocket("/ws/room/{room_id}")
async def room_session(websocket: WebSocket, room_id: str, token: str):
    """Host Live Session PRD — 미팅룸 단위 멀티 참가자 실시간 통역 WebSocket.

    Floor control(발화 충돌 차단), 언어별 통역 팬아웃, 자막/번역 오디오 브로드캐스트는
    app/core/room_state.py의 RoomState가 전부 담당하고, 이 핸들러는 연결 생명주기와
    참가자 식별만 처리한다.
    """
    auth_result = _authenticate_room_connection(token, room_id)
    if auth_result is None:
        logger.warning("WebSocket 인증 실패: room_id=%s", room_id)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user_id, is_guest = auth_result

    room_row = await asyncio.to_thread(_load_room_row, room_id)
    if room_row is None or room_row["status"] == "ended":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    participant_row = await asyncio.to_thread(_load_participant_row, room_id, user_id, is_guest)
    if participant_row is None or participant_row["is_kicked"]:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()

    instructions, keywords = await asyncio.to_thread(
        fetch_meeting_context, room_row.get("project_id"), room_row.get("document_id")
    )
    room = await room_manager.get_or_create(room_id, instructions, keywords, status=room_row["status"])

    participant = Participant(
        user_id=user_id,
        websocket=websocket,
        display_name=participant_row["display_name"],
        language=participant_row["language"],
        role=participant_row["role"],
    )
    await room.add_participant(participant)

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            chunk = message.get("bytes")
            if chunk is not None:
                try:
                    await room.handle_audio_chunk(user_id, chunk)
                except Exception:
                    # handle_audio_chunk 내부에서 못 잡은 예외가 새면 이 while 루프가
                    # 죽으면서 클라이언트 WS가 ws_error로 끊기고, 클라이언트는 자동
                    # 재연결을 하지 않아 마이크가 영구히 먹통이 된다(증상 리포트 원인).
                    # 참가자 1명 처리 실패가 본인 소켓 전체를 끊지 않도록 격리한다.
                    logger.exception(
                        "오디오 청크 처리 실패, 연결 유지: room_id=%s user_id=%s", room_id, user_id
                    )
            # JSON 텍스트 메시지(PING heartbeat 등)는 별도 처리 없이 무시한다.
    except WebSocketDisconnect:
        logger.info("참가자 연결 종료: room_id=%s user_id=%s", room_id, user_id)
    finally:
        await room.remove_participant(user_id)
        if room.is_empty():
            # Guest Live Session PRD 7.2 — 모든 참가자 퇴장 시 방을 자동 종료한다.
            await asyncio.to_thread(_end_room_if_active, room_id)
        await room_manager.remove_if_empty(room_id)


def _end_room_if_active(room_id: str) -> None:
    from datetime import datetime, timezone

    get_client().table("meeting_rooms").update(
        {"status": "ended", "ended_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", room_id).neq("status", "ended").execute()
