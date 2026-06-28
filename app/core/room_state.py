"""Host Live Session PRD — 미팅룸 1개의 멀티 참가자 통역 상태.

PRD 5-B(Floor Control)에 따라 먼저 talk 블록을 띄운 참가자가 해당 발화 턴이
끝날 때까지 floor를 독점한다. 발화자의 오디오는 청자들의 언어별로 Gemini Live
세션을 1개씩 띄워 통역하고, 발화자와 같은 언어를 쓰는 청자에게는 원본 PCM을
그대로(bypass) 전달한다.
"""

import asyncio
import base64
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import WebSocket

from app.core.gemini_session import GeminiLiveSession

logger = logging.getLogger(__name__)

# PRD 5.3: 3초 무음이면 서버가 발화 턴을 강제로 마감한다.
SILENCE_TIMEOUT_SECONDS = 3.0

# After Meeting PRD 7-2 — 지원 언어 전체 집합. 세션에 참가 안 한 언어는 translations에서 null.
SUPPORTED_LANGUAGES = ("ko", "en", "ja", "zh")

# country_code는 사용자 국적을 별도로 받는 입력이 없어(가입 시 언어만 선택) 발화 언어로
# 근사한다 — 정확한 국적 데이터가 추가되면 이 매핑을 대체할 것.
LANGUAGE_TO_COUNTRY = {"ko": "KR", "en": "US", "ja": "JP", "zh": "CN"}

# 프로필의 통역 언어 선택지(language-setting-sheet.tsx ALL_LANGUAGES)는 'sg'(싱가포르
# 영어)를 5번째 옵션으로 노출하지만, Gemini Live에는 별도 언어 코드가 없고 SUPPORTED_LANGUAGES
# 에도 'sg'가 없다 — 정규화 없이 그대로 쓰면 영어 화자/싱가포르 영어 화자가 같은 방을
# 써도 같은 언어로 인식되지 않아 (1) bypass가 안 되고 (2) Gemini에 잘못된 target_lang="sg"가
# 그대로 전달돼 통역이 깨진다("영어가 영어로 다시 번역되는 느낌" 버그의 원인). 화자/청자
# 언어를 비교하거나 Gemini target_lang으로 쓰기 전에는 항상 이 매핑을 거친다.
_LANGUAGE_ALIASES = {"sg": "en"}


def _normalize_language(language: str | None) -> str | None:
    if language is None:
        return None
    return _LANGUAGE_ALIASES.get(language, language)


@dataclass
class Participant:
    user_id: str
    websocket: WebSocket
    display_name: str
    language: str
    role: str  # "host" | "member" | "guest"
    avatar_url: str | None = None


@dataclass
class ActiveTurn:
    speaker_id: str
    sessions: dict[str, GeminiLiveSession] = field(default_factory=dict)  # target_lang -> session
    relay_tasks: list[asyncio.Task] = field(default_factory=list)
    watchdog_task: asyncio.Task | None = None
    last_audio_at: float = field(default_factory=time.monotonic)
    finalized: bool = False
    # After Meeting PRD 8-1 — 원문 자막은 세션 여러 개 중 정확히 하나(primary_lang)의
    # input_audio_transcription만 채택한다. 모든 세션에서 채택하면 N-1개로 중복된다.
    primary_lang: str | None = None
    original_text: str = ""
    translations: dict[str, str] = field(default_factory=dict)  # target_lang -> 누적 통역 텍스트
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class RoomState:
    """미팅룸 1개에 대응하는 실시간 통역 상태(참가자 + Floor control)."""

    def __init__(
        self,
        room_id: str,
        project_instructions: str | None,
        rag_keywords: str | None,
        status: str = "waiting",
        started_at: str | None = None,
    ):
        self.room_id = room_id
        self.status = status
        # 클라이언트마다 본인 화면 진입/시작 시각부터 따로 타이머를 돌리면 호스트/참가자
        # 헤더 시계가 서로 다르게 보인다 — 미팅의 실제 시작 시각(meeting_rooms.started_at)을
        # ROOM_STATE_UPDATE에 함께 실어 전원이 같은 기준시로 경과 시간을 계산하게 한다.
        self.started_at = started_at
        self.participants: dict[str, Participant] = {}
        self.active_turn: ActiveTurn | None = None
        self._lock = asyncio.Lock()
        self._system_instruction = _build_system_instruction(project_instructions, rag_keywords)
        # After Meeting PRD 8-1 — talk 단위로 확정된 발화 블록을 미팅 종료까지 메모리에
        # 누적한다(미팅 중 DB 쓰기 없음). 종료 시점에 호출자가 pop_session_buffer()로
        # 한 번에 가져가 bulk INSERT한다.
        self._session_buffer: list[dict] = []
        self._block_sequence = 0

    # ---- 참가자 관리 -----------------------------------------------------

    async def add_participant(self, participant: Participant) -> None:
        self.participants[participant.user_id] = participant
        await self.broadcast(self.room_state_payload())

    async def remove_participant(self, user_id: str) -> Participant | None:
        participant = self.participants.pop(user_id, None)
        if participant is None:
            return None
        if self.active_turn is not None and self.active_turn.speaker_id == user_id:
            await self._finalize_turn(self.active_turn)
        await self.broadcast(self.room_state_payload())
        return participant

    def is_empty(self) -> bool:
        return not self.participants

    async def set_status(self, status: str, started_at: str | None = None) -> None:
        """호스트 PATCH /rooms/{id}/start 등 상태 전이 시 대기 중인 참가자에게 브로드캐스트."""
        self.status = status
        if started_at is not None:
            self.started_at = started_at
        await self.broadcast(self.room_state_payload())

    def room_state_payload(self) -> dict:
        return {
            "type": "ROOM_STATE_UPDATE",
            "status": self.status,
            "startedAt": self.started_at,
            "users": [
                {
                    "userId": p.user_id,
                    "displayName": p.display_name,
                    "language": p.language,
                    "role": p.role,
                    "avatarUrl": p.avatar_url,
                }
                for p in self.participants.values()
            ],
            "activeSpeakerId": self.active_turn.speaker_id if self.active_turn else None,
        }

    # ---- 메시지 전송 -------------------------------------------------------

    async def broadcast(self, payload: dict, exclude_user_id: str | None = None) -> None:
        for participant in list(self.participants.values()):
            if participant.user_id == exclude_user_id:
                continue
            await self._send_json(participant, payload)

    async def send_to(self, user_id: str, payload: dict) -> None:
        participant = self.participants.get(user_id)
        if participant is None:
            return
        await self._send_json(participant, payload)

    async def _send_json(self, participant: Participant, payload: dict) -> None:
        try:
            await participant.websocket.send_json(payload)
        except Exception:
            logger.exception("WS 전송 실패: room_id=%s user_id=%s", self.room_id, participant.user_id)

    async def force_disconnect(self, user_id: str, payload: dict) -> None:
        """강퇴 등으로 특정 참가자의 연결을 서버에서 강제로 끊는다."""
        participant = self.participants.get(user_id)
        if participant is None:
            return
        await self._send_json(participant, payload)
        try:
            await participant.websocket.close()
        except Exception:
            logger.exception("강제 종료 실패: room_id=%s user_id=%s", self.room_id, user_id)

    # ---- Floor control / 오디오 파이프라인 ---------------------------------

    async def handle_audio_chunk(self, user_id: str, chunk: bytes) -> None:
        async with self._lock:
            if self.active_turn is None:
                await self._start_turn(user_id)
            elif self.active_turn.speaker_id != user_id:
                speaker = self.participants.get(self.active_turn.speaker_id)
                await self.send_to(
                    user_id,
                    {
                        "type": "FLOOR_OCCUPIED",
                        "activeSpeakerName": speaker.display_name if speaker else "",
                    },
                )
                return

        turn = self.active_turn
        if turn is None or turn.speaker_id != user_id:
            return

        turn.last_audio_at = time.monotonic()
        speaker = self.participants.get(user_id)
        speaker_language = _normalize_language(speaker.language if speaker else None)

        # 동일 언어 청자에게는 통역 없이 원본 PCM을 그대로 전달(bypass).
        for other in list(self.participants.values()):
            if other.user_id == user_id or _normalize_language(other.language) != speaker_language:
                continue
            try:
                await other.websocket.send_bytes(chunk)
            except Exception:
                logger.exception("bypass 오디오 전송 실패: user_id=%s", other.user_id)

        # Gemini Live 세션 송신은 ~10분마다 끊기는 WS 위에서 동작하므로 실패할 수 있다
        # (CLAUDE.md 확정 사항). 여기서 예외가 새면 room_session의 while 루프가 그대로
        # 죽으면서 클라이언트 WS까지 ws_error로 끊기고, 이후 마이크가 영구히 먹통이
        # 되므로(아무도 재연결을 안 함) 세션 단위로만 격리해서 죽인다.
        dead_langs: list[str] = []
        for target_lang, session in turn.sessions.items():
            try:
                await session.send_audio(chunk)
            except Exception:
                logger.exception(
                    "Gemini 세션 송신 실패, 해당 언어 세션만 종료: room_id=%s target_lang=%s",
                    self.room_id,
                    target_lang,
                )
                dead_langs.append(target_lang)
        for target_lang in dead_langs:
            session = turn.sessions.pop(target_lang, None)
            if session is not None:
                try:
                    await session.close()
                except Exception:
                    logger.exception("죽은 세션 정리 실패: room_id=%s target_lang=%s", self.room_id, target_lang)
        if not turn.sessions and not turn.finalized:
            await self._finalize_turn(turn)

    async def _start_turn(self, speaker_id: str) -> None:
        speaker = self.participants.get(speaker_id)
        if speaker is None:
            return

        speaker_language = _normalize_language(speaker.language)
        listener_languages = {
            _normalize_language(p.language) for p in self.participants.values() if p.user_id != speaker_id
        }
        foreign_languages = listener_languages - {speaker_language}
        # 외국어 청자가 없어도 원문 자막(SUBTITLE_ORIGINAL) 추출용으로 세션 1개는 항상 띄운다.
        target_languages = foreign_languages or {speaker_language}

        sessions: dict[str, GeminiLiveSession] = {}
        for target_lang in target_languages:
            session = GeminiLiveSession(
                session_id=f"room:{self.room_id}:{speaker_id}:{target_lang}:{time.monotonic_ns()}",
                user_id=speaker_id,
                target_language_code=target_lang,
                system_instruction=self._system_instruction,
                persist_resumption=False,
                enable_transcription=True,
            )
            try:
                await session.connect()
            except Exception:
                logger.exception("Gemini Live 연결 실패: room_id=%s target_lang=%s", self.room_id, target_lang)
                continue
            sessions[target_lang] = session

        if not sessions:
            return

        # 원문 자막/저장용 입력 transcription은 세션 하나만 채택한다 — 발화자 본인 언어로
        # 띄운 세션(있으면)을 우선하고, 없으면(전원 외국어 청자) 첫 번째 세션으로 대체.
        primary_lang = speaker_language if speaker_language in sessions else next(iter(sessions))

        turn = ActiveTurn(speaker_id=speaker_id, sessions=sessions, primary_lang=primary_lang)
        self.active_turn = turn

        for target_lang, session in sessions.items():
            is_origin_only = target_lang == speaker_language
            task = asyncio.create_task(self._relay_session(turn, target_lang, session, is_origin_only))
            turn.relay_tasks.append(task)

        turn.watchdog_task = asyncio.create_task(self._silence_watchdog(turn))
        await self.broadcast(self.room_state_payload())

    async def _relay_session(
        self,
        turn: ActiveTurn,
        target_lang: str,
        session: GeminiLiveSession,
        is_origin_only: bool,
    ) -> None:
        try:
            async for message in session.receive():
                content = message.server_content
                if content is None:
                    continue

                if target_lang == turn.primary_lang and content.input_transcription and content.input_transcription.text:
                    turn.original_text += content.input_transcription.text
                    await self.broadcast(
                        {
                            "type": "SUBTITLE_ORIGINAL",
                            "speakerId": turn.speaker_id,
                            "text": content.input_transcription.text,
                            "isFinal": False,
                        }
                    )

                if not is_origin_only and content.output_transcription and content.output_transcription.text:
                    turn.translations[target_lang] = (
                        turn.translations.get(target_lang, "") + content.output_transcription.text
                    )
                    await self._send_to_language(
                        target_lang,
                        turn.speaker_id,
                        {
                            "type": "SUBTITLE_TRANSLATED",
                            "speakerId": turn.speaker_id,
                            "targetLanguage": target_lang,
                            "text": content.output_transcription.text,
                            "isFinal": False,
                        },
                    )

                if not is_origin_only and content.model_turn:
                    for part in content.model_turn.parts:
                        if part.inline_data and part.inline_data.data:
                            await self._send_audio_to_language(target_lang, turn.speaker_id, part.inline_data.data)

                if content.interrupted:
                    await self.broadcast({"type": "INTERRUPTED", "speakerId": turn.speaker_id})

                if content.turn_complete:
                    await self._finalize_turn(turn)
                    return
        except Exception:
            logger.exception("세션 릴레이 오류: room_id=%s target_lang=%s", self.room_id, target_lang)
            await self._finalize_turn(turn)

    async def _send_to_language(self, language: str, exclude_user_id: str, payload: dict) -> None:
        for participant in list(self.participants.values()):
            if participant.user_id == exclude_user_id or _normalize_language(participant.language) != language:
                continue
            await self._send_json(participant, payload)

    async def _send_audio_to_language(self, language: str, exclude_user_id: str, data: bytes) -> None:
        payload = {
            "type": "AUDIO_TRANSLATED",
            "speakerId": exclude_user_id,
            "targetLanguage": language,
            "data": base64.b64encode(data).decode("ascii"),
        }
        await self._send_to_language(language, exclude_user_id, payload)

    async def _silence_watchdog(self, turn: ActiveTurn) -> None:
        try:
            while True:
                await asyncio.sleep(1)
                if turn.finalized:
                    return
                if time.monotonic() - turn.last_audio_at >= SILENCE_TIMEOUT_SECONDS:
                    for session in turn.sessions.values():
                        try:
                            await session.send_audio_stream_end()
                        except Exception:
                            logger.exception("audio_stream_end 실패: room_id=%s", self.room_id)
                    await self._finalize_turn(turn)
                    return
        except asyncio.CancelledError:
            pass

    async def _finalize_turn(self, turn: ActiveTurn) -> None:
        async with self._lock:
            if turn.finalized:
                return
            turn.finalized = True
            if self.active_turn is turn:
                self.active_turn = None

        if turn.watchdog_task is not None:
            turn.watchdog_task.cancel()
        for task in turn.relay_tasks:
            task.cancel()
        for session in turn.sessions.values():
            try:
                await session.close()
            except Exception:
                logger.exception("세션 종료 실패: room_id=%s", self.room_id)

        await self.broadcast({"type": "TURN_COMPLETE", "speakerId": turn.speaker_id})
        await self.broadcast(self.room_state_payload())
        self._record_speaker_block(turn)

    def _record_speaker_block(self, turn: ActiveTurn) -> None:
        # talk 단위 저장 — 빈 발화(원문 텍스트 없음, 예: 마이크 잡음만 들어온 경우)는
        # 스킵한다. PRD가 명시한 "단어/문장 단위 분절 금지"는 이미 위 누적 로직으로 보장됨.
        if not turn.original_text.strip():
            return
        speaker = self.participants.get(turn.speaker_id)
        if speaker is None:
            return

        speaker_language = _normalize_language(speaker.language)
        translations = {lang: None for lang in SUPPORTED_LANGUAGES}
        # 화자 본인 언어는 통역이 아니라 원문 그대로 동일 키에 복사(PRD 7-2).
        translations[speaker_language] = turn.original_text
        for lang, text in turn.translations.items():
            translations[lang] = text

        self._block_sequence += 1
        self._session_buffer.append(
            {
                "speaker_user_id": speaker.user_id if speaker.role != "guest" else None,
                "speaker_name": speaker.display_name,
                "country_code": LANGUAGE_TO_COUNTRY.get(speaker_language),
                "original_language": speaker_language,
                "original_text": turn.original_text,
                "translations": translations,
                "started_at": turn.started_at.isoformat(),
                "ended_at": datetime.now(timezone.utc).isoformat(),
                "sequence": self._block_sequence,
            }
        )

    def pop_session_buffer(self) -> list[dict]:
        """미팅 종료 시 호출자가 누적된 발화 블록을 가져가고 비운다."""
        blocks = self._session_buffer
        self._session_buffer = []
        return blocks

    async def end_room(self, ended_by_display_name: str) -> None:
        """호스트가 미팅을 종료할 때 — 진행 중인 턴을 정리하고 ROOM_ENDED를 알린다."""
        if self.active_turn is not None:
            await self._finalize_turn(self.active_turn)
        await self.broadcast({"type": "ROOM_ENDED", "endedBy": ended_by_display_name})


def _build_system_instruction(project_instructions: str | None, rag_keywords: str | None) -> str | None:
    base = (
        "You are Preter, an elite real-time simultaneous interpreter. "
        "Mirror the speaker's emotional tone and pacing faithfully, with dynamic tempo."
    )
    if not project_instructions and not rag_keywords:
        return base

    lines = [
        base,
        "",
        "[Meeting Context — Correction Reference Only]",
        "Use the following only when the speech is unclear or contains technical terms/proper "
        "nouns you cannot recognize confidently. Do not insert or reinterpret this information "
        "directly into the interpretation.",
    ]
    if project_instructions:
        lines.append(f"- Instructions: {project_instructions}")
    if rag_keywords:
        lines.append(f"- Key terms: {rag_keywords}")
    return "\n".join(lines)


class RoomManager:
    """room_id -> RoomState 매핑. 서버 프로세스 메모리에 보관 (CLAUDE.md: Redis 미사용 단계)."""

    def __init__(self):
        self._rooms: dict[str, RoomState] = {}
        self._lock = asyncio.Lock()

    async def get_or_create(
        self,
        room_id: str,
        project_instructions: str | None,
        rag_keywords: str | None,
        status: str = "waiting",
        started_at: str | None = None,
    ) -> RoomState:
        async with self._lock:
            room = self._rooms.get(room_id)
            if room is None:
                room = RoomState(room_id, project_instructions, rag_keywords, status=status, started_at=started_at)
                self._rooms[room_id] = room
            return room

    def get(self, room_id: str) -> RoomState | None:
        return self._rooms.get(room_id)

    async def remove_if_empty(self, room_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(room_id)
            if room is not None and room.is_empty():
                del self._rooms[room_id]


room_manager = RoomManager()
