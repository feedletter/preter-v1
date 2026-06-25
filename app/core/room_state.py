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

from fastapi import WebSocket

from app.core.gemini_session import GeminiLiveSession

logger = logging.getLogger(__name__)

# PRD 5.3: 3초 무음이면 서버가 발화 턴을 강제로 마감한다.
SILENCE_TIMEOUT_SECONDS = 3.0


@dataclass
class Participant:
    user_id: str
    websocket: WebSocket
    display_name: str
    language: str
    role: str  # "host" | "member" | "guest"


@dataclass
class ActiveTurn:
    speaker_id: str
    sessions: dict[str, GeminiLiveSession] = field(default_factory=dict)  # target_lang -> session
    relay_tasks: list[asyncio.Task] = field(default_factory=list)
    watchdog_task: asyncio.Task | None = None
    last_audio_at: float = field(default_factory=time.monotonic)
    finalized: bool = False
    original_broadcast_done: bool = False


class RoomState:
    """미팅룸 1개에 대응하는 실시간 통역 상태(참가자 + Floor control)."""

    def __init__(
        self,
        room_id: str,
        project_instructions: str | None,
        rag_keywords: str | None,
        status: str = "waiting",
    ):
        self.room_id = room_id
        self.status = status
        self.participants: dict[str, Participant] = {}
        self.active_turn: ActiveTurn | None = None
        self._lock = asyncio.Lock()
        self._system_instruction = _build_system_instruction(project_instructions, rag_keywords)

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

    async def set_status(self, status: str) -> None:
        """호스트 PATCH /rooms/{id}/start 등 상태 전이 시 대기 중인 참가자에게 브로드캐스트."""
        self.status = status
        await self.broadcast(self.room_state_payload())

    def room_state_payload(self) -> dict:
        return {
            "type": "ROOM_STATE_UPDATE",
            "status": self.status,
            "users": [
                {
                    "userId": p.user_id,
                    "displayName": p.display_name,
                    "language": p.language,
                    "role": p.role,
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
        speaker_language = speaker.language if speaker else None

        # 동일 언어 청자에게는 통역 없이 원본 PCM을 그대로 전달(bypass).
        for other in list(self.participants.values()):
            if other.user_id == user_id or other.language != speaker_language:
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

        listener_languages = {
            p.language for p in self.participants.values() if p.user_id != speaker_id
        }
        foreign_languages = listener_languages - {speaker.language}
        # 외국어 청자가 없어도 원문 자막(SUBTITLE_ORIGINAL) 추출용으로 세션 1개는 항상 띄운다.
        target_languages = foreign_languages or {speaker.language}

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

        turn = ActiveTurn(speaker_id=speaker_id, sessions=sessions)
        self.active_turn = turn

        for target_lang, session in sessions.items():
            is_origin_only = target_lang == speaker.language
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

                if content.input_transcription and content.input_transcription.text and not turn.original_broadcast_done:
                    await self.broadcast(
                        {
                            "type": "SUBTITLE_ORIGINAL",
                            "speakerId": turn.speaker_id,
                            "text": content.input_transcription.text,
                            "isFinal": False,
                        }
                    )

                if not is_origin_only and content.output_transcription and content.output_transcription.text:
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
            if participant.user_id == exclude_user_id or participant.language != language:
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
    ) -> RoomState:
        async with self._lock:
            room = self._rooms.get(room_id)
            if room is None:
                room = RoomState(room_id, project_instructions, rag_keywords, status=status)
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
