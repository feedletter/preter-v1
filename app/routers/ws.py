import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core import session_repository, session_store
from app.core.auth import AuthError, verify_token
from app.core.gemini_session import GeminiLiveSession

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
