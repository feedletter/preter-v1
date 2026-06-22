import asyncio
import logging
import time

from google import genai
from google.genai import types

from app.config import settings
from app.core import session_repository

logger = logging.getLogger(__name__)

# CLAUDE.md: 통역 전용 모델 사용. input_token_limit이 16K로 작아
# 영업자료 등 컨텍스트는 요약/축소해서 system_instruction에 주입해야 함.
LIVE_MODEL = "gemini-3.5-live-translate-preview"

# Cloud Run 타임아웃이 60분이라, 55분 시점에 클라이언트가 선제적으로
# 새 WebSocket을 열고 세션을 이어받도록 한다 (CLAUDE.md 확정 사항).
PROACTIVE_RECONNECT_SECONDS = 55 * 60

# Gemini가 GoAway를 60초 전에 보내주므로, 그 안에 재연결을 트리거한다.
GOAWAY_RECONNECT_BUFFER_SECONDS = 60


class GeminiLiveSession:
    """클라이언트 WebSocket 하나에 대응하는 Gemini Live API 세션 래퍼.

    Session Resumption 핸들을 들고 있다가 끊기면(10분 주기, GoAway, 55분 선제
    재연결 등) 동일 핸들로 재연결해 통역 컨텍스트를 이어간다.
    """

    def __init__(
        self,
        session_id: str,
        user_id: str,
        target_language_code: str,
        system_instruction: str | None = None,
        resumption_handle: str | None = None,
    ):
        self._client = genai.Client(api_key=settings.google_api_key)
        self._session_id = session_id
        self._user_id = user_id
        self._target_language_code = target_language_code
        self._system_instruction = system_instruction
        self._resumption_handle = resumption_handle
        self._session_cm = None
        self._session = None
        self._connected_at: float = 0.0
        self.goaway_deadline: float | None = None

    def _build_config(self) -> types.LiveConnectConfig:
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=self._system_instruction,
            translation_config=types.TranslationConfig(
                target_language_code=self._target_language_code,
            ),
            session_resumption=types.SessionResumptionConfig(
                handle=self._resumption_handle,
            ),
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=80000,
                sliding_window=types.SlidingWindow(),
            ),
        )

    async def connect(self):
        config = self._build_config()
        self._session_cm = self._client.aio.live.connect(model=LIVE_MODEL, config=config)
        self._session = await self._session_cm.__aenter__()
        self._connected_at = time.monotonic()
        self.goaway_deadline = None
        logger.info("Gemini Live 연결 성공 (resumption_handle=%s)", self._resumption_handle)
        return self._session

    async def reconnect(self):
        await self.close()
        return await self.connect()

    async def close(self):
        if self._session_cm is not None:
            try:
                await self._session_cm.__aexit__(None, None, None)
            except Exception:
                logger.exception("Gemini 세션 종료 중 에러")
        self._session = None
        self._session_cm = None

    def seconds_until_proactive_reconnect(self) -> float:
        elapsed = time.monotonic() - self._connected_at
        return max(0.0, PROACTIVE_RECONNECT_SECONDS - elapsed)

    async def send_audio(self, pcm_chunk: bytes):
        await self._session.send_realtime_input(
            audio=types.Blob(data=pcm_chunk, mime_type="audio/pcm;rate=16000"),
        )

    async def send_audio_stream_end(self):
        await self._session.send_realtime_input(audio_stream_end=True)

    async def receive(self):
        """Gemini로부터 메시지를 받으면서 resumption 핸들/GoAway를 추적한다."""
        async for message in self._session.receive():
            update = message.session_resumption_update
            if update and update.resumable and update.new_handle:
                self._resumption_handle = update.new_handle
                logger.debug("Session resumption handle 갱신됨")
                await asyncio.to_thread(
                    session_repository.upsert,
                    self._session_id,
                    self._user_id,
                    self._target_language_code,
                    self._resumption_handle,
                )

            go_away = message.go_away
            if go_away is not None:
                time_left = go_away.time_left.total_seconds() if go_away.time_left else GOAWAY_RECONNECT_BUFFER_SECONDS
                self.goaway_deadline = time.monotonic() + max(0.0, time_left - 5)
                logger.warning("GoAway 수신, %s초 후 재연결 필요", time_left)

            yield message
