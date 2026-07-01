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

# CLAUDE.md 지원 4개 언어(ko/en/ja/zh) 중 ko/en/ja는 Gemini Live translation_config의
# BCP-47 코드와 그대로 일치하지만, 중국어는 앱 내부에서 'zh'로만 다루는 반면 Gemini는
# 'zh-Hans'(간체)/'zh-Hant'(번체)만 인식한다 — 앱은 간체 중국어를 기본 지원 대상으로 본다.
# https://ai.google.dev/gemini-api/docs/live-api/live-translate#supported-languages
_APP_TO_GEMINI_LANGUAGE_CODE = {
    "zh": "zh-Hans",
}


def to_gemini_language_code(app_language_code: str) -> str:
    return _APP_TO_GEMINI_LANGUAGE_CODE.get(app_language_code, app_language_code)


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
        persist_resumption: bool = True,
        enable_transcription: bool = False,
    ):
        self._client = genai.Client(api_key=settings.google_api_key)
        self._session_id = session_id
        self._user_id = user_id
        # 호출 측은 앱 내부 언어 코드(ko/en/ja/zh)를 그대로 넘기고, 여기서 Gemini가
        # 요구하는 BCP-47 코드로 변환한다 — 호출부마다 매핑을 중복하지 않기 위함.
        self._target_language_code = to_gemini_language_code(target_language_code)
        self._system_instruction = system_instruction
        self._resumption_handle = resumption_handle
        # Host Live Session PRD: 발화 1턴마다 새로 뜨는 룸용 임시 세션은 55분 재연결
        # 대상이 아니라서 interpretation_sessions에 영구 저장할 필요가 없다.
        self._persist_resumption = persist_resumption
        self._enable_transcription = enable_transcription
        self._session_cm = None
        self._session = None
        self._connected_at: float = 0.0
        self.goaway_deadline: float | None = None

    def _build_config(self) -> types.LiveConnectConfig:
        config = types.LiveConnectConfig(
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
        if self._enable_transcription:
            # Host Live Session PRD 10.1: SUBTITLE_ORIGINAL(원문)/SUBTITLE_TRANSLATED(번역)
            # 자막을 별도 세션 없이 동일 통역 세션의 transcription 출력으로 얻는다.
            config.input_audio_transcription = types.AudioTranscriptionConfig()
            config.output_audio_transcription = types.AudioTranscriptionConfig()
        return config

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
                if self._persist_resumption:
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
