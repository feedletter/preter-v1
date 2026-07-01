"""Host Live Session — 미팅룸 1개의 멀티 참가자 통역 상태 (큐 기반 상시 세션 모델).

[2026-07-01 아키텍처 전환] 과거 Floor Control(먼저 말한 사람이 발화 턴을 독점, 3초
무음 watchdog으로 턴 마감)을 폐기하고, 참가자별 Gemini Live 세션을 입장 시점부터
'상시 오픈' 상태로 유지하는 모델로 전환했다.

전환 이유:
- 3초 무음 watchdog이 이벤트 루프 부하/타이밍에 따라 턴을 못 닫는 버그가 있었다.
  서버가 인위적으로 턴을 시작/종료하는 상태머신 자체가 버그의 온상이었다.
- 동시 발화(여러 명이 겹쳐 말함)가 floor control 때문에 한 명만 처리되고 나머지는
  드롭됐다. 실제 대화에서는 겹쳐 말하는 게 자연스러운데 그게 통째로 막혔다.

새 모델:
- 발화 '턴' 개념을 서버가 관리하지 않는다. 발화 구간 감지(VAD)는 Gemini Live가
  내부적으로 하고, 우리는 오디오가 들어오는 대로 그냥 열려 있는 세션에 흘려보낸다.
- 각 참가자(화자)마다, 그와 '다른 언어'를 쓰는 청자 언어 종류별로 Gemini Live 세션을
  1개씩 상시 열어둔다(SpeakerStream). 같은 언어 청자에게는 원본 PCM을 그대로 bypass.
- Gemini가 보내는 turn_complete는 세션을 닫는 신호가 아니라, '발화 블록 1개가
  끝났다'는 경계 신호로만 쓴다(자막 확정 + speaker_blocks 적재 + 누적 텍스트 리셋).
- 여러 화자가 동시에 말하면 각자의 세션이 동시에 통역을 내보내고, 클라이언트는
  화자별 재생 큐로 받아 자연스럽게 겹쳐 재생한다.

[Gemini Live 과금 전제] 연결 시간이 아니라 실제 처리한 오디오량 기준 과금이라,
상시 세션이어도 무음 구간엔 청크를 안 보내면(클라이언트 RMS 게이팅) 비용이 거의
늘지 않는다 — 이 전제 위에서 상시 세션을 채택했다(Jay 확인, 2026-07-01).
"""

import array
import asyncio
import base64
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import WebSocket

from app.core.gemini_session import GeminiLiveSession

logger = logging.getLogger(__name__)

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


# ---- 교차 스트림 에너지 중재 (음성 누출 방어 심화) --------------------------------
# 같은 공간에서 옆 사람 목소리가 내 마이크로 새어 들어가(bleed-through) 내 통역 세션이 그
# 사람 말을 "내가 말한 것"으로 통역해버리는 문제를, "같은 순간 방 안 마이크들의 상대 음량"으로
# 가른다. 물리적으로 내 목소리가 내 마이크에 들어오는 세기는 같은 목소리가 옆 마이크에
# 누출되는 세기보다 15~30dB 크다 — 이 차이를 discriminator로 쓴다. (주파수 기반 화자 분리는
# 사람 목소리 대역이 80Hz~8kHz로 모두 겹쳐 불가 — CLAUDE.md. 클라이언트 RMS 게이팅 + iOS
# voiceChat AEC 위에 얹는 3중 방어다.)
ENERGY_EMA_ALPHA = 0.4  # recent_energy 지수이동평균 계수(최근 청크 가중). 클수록 반응 빠름.
ENERGY_ACTIVITY_WINDOW_S = 0.3  # 이 시간 내 청크를 받은 화자를 '현재 활성'으로 본다.
# 활성 화자들의 최대 에너지 대비 이 비율 미만이면 누출로 보고 Gemini 전송을 스킵한다.
# 0.4 ≈ -8dB: 진짜 동시 발화(둘 다 큼)는 서로 이 비율 이상이라 둘 다 통과하고, 한 명은 크고
# 한 명은 희미하면(=누출) 희미한 쪽만 죽는다. 낮추면 누출을 더 통과시키고, 높이면 작게 말하는
# 사람을 누출로 오판할 위험이 커진다 — 실사용 튜닝 포인트.
ENERGY_SUPPRESS_RATIO = 0.4


def _chunk_rms(chunk: bytes) -> float:
    """PCM 16-bit little-endian mono 청크의 RMS(0~32767 스케일).

    스트림 간 '상대' 비교에만 쓰므로 [-1,1] 정규화는 불필요하다. array('h')는 네이티브
    바이트오더로 해석하는데, 서버는 Cloud Run x86_64(LE)이고 PCM도 LE라 일치한다.
    """
    usable = len(chunk) - (len(chunk) % 2)
    if usable <= 0:
        return 0.0
    samples = array.array("h")
    samples.frombytes(chunk[:usable])
    if not samples:
        return 0.0
    acc = 0
    for s in samples:
        acc += s * s
    return (acc / len(samples)) ** 0.5


@dataclass
class Participant:
    user_id: str
    websocket: WebSocket
    display_name: str
    language: str
    role: str  # "host" | "member" | "guest"
    avatar_url: str | None = None


@dataclass
class SpeakerStream:
    """화자 1명에 대응하는 상시 통역 파이프라인.

    sessions: 청자 언어 종류별 Gemini Live 세션(target_lang -> session). 방 인원 구성이
    바뀌면(언어가 새로 들어오거나 빠지면) reconcile로 추가/정리된다.
    누적 텍스트(original_text/translations)는 '현재 진행 중인 발화 블록 1개' 단위로만
    쌓이고, primary 세션의 turn_complete에서 speaker_block으로 확정된 뒤 리셋된다.
    """

    speaker_id: str
    sessions: dict[str, GeminiLiveSession] = field(default_factory=dict)
    relay_tasks: dict[str, asyncio.Task] = field(default_factory=dict)
    # 원문 자막/저장용 input transcription은 세션 여러 개 중 정확히 하나만 채택한다
    # (모든 세션에서 채택하면 N개로 중복). reconcile로 세션이 바뀌면 갱신한다.
    primary_lang: str | None = None
    original_text: str = ""
    translations: dict[str, str] = field(default_factory=dict)  # target_lang -> 누적 통역 텍스트
    block_started_at: datetime | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    closed: bool = False
    # 교차 스트림 에너지 중재용 — 이 화자 마이크의 최근 음량(EMA)과 마지막 청크 수신 시각
    # (time.monotonic). 다른 화자들이 "이 화자가 지금 얼마나 크게 말하는가"를 비교하는 기준.
    recent_energy: float = 0.0
    last_chunk_at: float = 0.0

    def reset_block(self) -> None:
        self.original_text = ""
        self.translations = {}
        self.block_started_at = None


class RoomState:
    """미팅룸 1개에 대응하는 실시간 통역 상태(참가자 + 화자별 상시 세션)."""

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
        self.streams: dict[str, SpeakerStream] = {}
        # 현재 말하고 있는(발화 블록이 열려 있는) 화자 집합 — UI의 speaking/listening
        # 표시용. 동시 발화가 가능하므로 단일 activeSpeakerId가 아니라 집합으로 관리한다.
        self.speaking_ids: set[str] = set()
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
        # 새 참가자가 들어오면 기존 화자들에게 '새 청자 언어'가 추가됐을 수 있다 —
        # 다음 청크를 기다리지 않고 즉시 세션을 맞춰둔다.
        await self._reconcile_all_streams()
        await self.broadcast(self.room_state_payload())

    async def remove_participant(self, user_id: str) -> Participant | None:
        # _close_stream(finalize=True) → _record_speaker_block이 self.participants에서 화자를
        # 조회하므로, participants.pop보다 먼저 스트림을 닫아야 마지막 발화 블록이 저장된다.
        stream = self.streams.pop(user_id, None)
        if stream is not None:
            await self._close_stream(stream, finalize=True)
        participant = self.participants.pop(user_id, None)
        if participant is None:
            return None
        self.speaking_ids.discard(user_id)
        # 남은 화자들 입장에선 청자 언어가 하나 빠졌을 수 있다 — 불필요해진 세션 정리.
        await self._reconcile_all_streams()
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
        speaking = sorted(self.speaking_ids)
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
            # 동시 발화 지원: 말하는 사람이 여럿일 수 있어 배열로 내려준다.
            "activeSpeakerIds": speaking,
            # 구버전 클라이언트 호환용 단일 필드(첫 화자) — 신규 클라이언트는 위 배열을 쓴다.
            "activeSpeakerId": speaking[0] if speaking else None,
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

    # ---- 오디오 파이프라인 -------------------------------------------------

    def _required_target_langs(self, speaker_id: str) -> set[str]:
        """화자가 통역해줘야 할 청자 언어 집합 = (다른 참가자 언어) - (화자 언어)."""
        speaker = self.participants.get(speaker_id)
        if speaker is None:
            return set()
        speaker_language = _normalize_language(speaker.language)
        listener_languages = {
            _normalize_language(p.language)
            for p in self.participants.values()
            if p.user_id != speaker_id
        }
        foreign = listener_languages - {speaker_language}
        # 외국어 청자가 없어도 원문 자막(SUBTITLE_ORIGINAL) 추출용으로 1개는 항상 띄운다.
        return foreign or {speaker_language}

    async def handle_audio_chunk(self, user_id: str, chunk: bytes) -> None:
        speaker = self.participants.get(user_id)
        if speaker is None:
            return

        stream = await self._ensure_stream(user_id)
        if stream is None:
            return

        # 교차 스트림 에너지 중재: 이 청크가 "옆 사람 목소리 누출"인지 상대 음량으로 판정한다.
        # 먼저 이 화자의 최근 음량/활성 시각을 갱신하고(다른 화자가 나를 비교할 기준이 됨),
        # 그 다음 현재 활성인 '다른' 화자들의 최대 음량과 비교한다.
        now = time.monotonic()
        rms = _chunk_rms(chunk)
        stream.recent_energy = ENERGY_EMA_ALPHA * rms + (1 - ENERGY_EMA_ALPHA) * stream.recent_energy
        stream.last_chunk_at = now
        dominant_other = max(
            (
                other.recent_energy
                for other_id, other in self.streams.items()
                if other_id != user_id and (now - other.last_chunk_at) < ENERGY_ACTIVITY_WINDOW_S
            ),
            default=0.0,
        )
        # 다른 화자가 나보다 확연히 크게(내가 그 비율 미만) 말하는 중이면 이 청크는 그 화자
        # 목소리의 누출로 보고 버린다 — Gemini로 보내지 않아 통역에 반영되지 않게 한다. 세션은
        # 상시 모델대로 열어둔 채 이 청크만 스킵하므로, 내가 실제로 크게 말하기 시작하면 즉시 통과한다.
        if dominant_other > 0.0 and rms < dominant_other * ENERGY_SUPPRESS_RATIO:
            return

        # 발화 블록이 새로 열리는 순간(직전까지 말하던 상태가 아니었으면) UI에 알린다.
        if user_id not in self.speaking_ids:
            self.speaking_ids.add(user_id)
            if stream.block_started_at is None:
                stream.block_started_at = datetime.now(timezone.utc)
            await self.broadcast(self.room_state_payload())

        speaker_language = _normalize_language(speaker.language)

        # 동일 언어 청자에게는 통역 없이 원본 PCM을 그대로 전달(bypass). 화자별 재생 큐로
        # 라우팅할 수 있게 speakerId를 실어 JSON(AUDIO_BYPASS)으로 보낸다.
        bypass_payload: dict | None = None
        for other in list(self.participants.values()):
            if other.user_id == user_id or _normalize_language(other.language) != speaker_language:
                continue
            if bypass_payload is None:
                bypass_payload = {
                    "type": "AUDIO_BYPASS",
                    "speakerId": user_id,
                    "data": base64.b64encode(chunk).decode("ascii"),
                }
            await self._send_json(other, bypass_payload)

        # Gemini Live 세션 송신은 ~10분마다 끊기는 WS 위에서 동작하므로 실패할 수 있다.
        # 여기서 예외가 새면 room_session의 while 루프가 죽으면서 클라이언트 WS까지
        # 끊기고 마이크가 영구 먹통이 되므로, 세션 단위로만 격리해서 죽인다.
        dead_langs: list[str] = []
        for target_lang, session in list(stream.sessions.items()):
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
            await self._drop_session(stream, target_lang)

    async def _ensure_stream(self, speaker_id: str) -> SpeakerStream | None:
        """화자 스트림을 보장하고, 현재 방 구성에 맞게 세션 집합을 reconcile한다."""
        async with self._lock:
            stream = self.streams.get(speaker_id)
            if stream is None:
                stream = SpeakerStream(speaker_id=speaker_id)
                self.streams[speaker_id] = stream
        await self._reconcile_stream(stream)
        return stream if stream.sessions else None

    async def _reconcile_all_streams(self) -> None:
        for stream in list(self.streams.values()):
            await self._reconcile_stream(stream)

    async def _reconcile_stream(self, stream: SpeakerStream) -> None:
        """스트림의 세션 집합을 현재 필요한 청자 언어와 일치시킨다(추가/삭제)."""
        if stream.closed:
            return
        required = self._required_target_langs(stream.speaker_id)
        async with stream.lock:
            if stream.closed:
                return
            current = set(stream.sessions.keys())
            if current == required:
                return

            # 더 이상 필요 없는 언어 세션 정리.
            for target_lang in current - required:
                await self._drop_session(stream, target_lang, locked=True)

            # 새로 필요한 언어 세션 오픈.
            speaker = self.participants.get(stream.speaker_id)
            speaker_language = _normalize_language(speaker.language) if speaker else None
            for target_lang in required - set(stream.sessions.keys()):
                session = GeminiLiveSession(
                    session_id=f"room:{self.room_id}:{stream.speaker_id}:{target_lang}:{time.monotonic_ns()}",
                    user_id=stream.speaker_id,
                    target_language_code=target_lang,
                    system_instruction=self._system_instruction,
                    persist_resumption=False,
                    enable_transcription=True,
                )
                try:
                    await session.connect()
                except Exception:
                    logger.exception(
                        "Gemini Live 연결 실패: room_id=%s target_lang=%s", self.room_id, target_lang
                    )
                    continue
                stream.sessions[target_lang] = session
                task = asyncio.create_task(self._relay_session(stream, target_lang, session))
                stream.relay_tasks[target_lang] = task

            # 원문 transcription 채택 세션(primary) 재선정 — 화자 본인 언어 세션이 있으면
            # 그걸, 없으면(전원 외국어 청자) 임의의 첫 세션을 쓴다. input_transcription은
            # target_lang과 무관하게 화자 발화 자체를 받으므로 어느 세션이든 동일하다.
            if stream.primary_lang not in stream.sessions:
                if speaker_language in stream.sessions:
                    stream.primary_lang = speaker_language
                else:
                    stream.primary_lang = next(iter(stream.sessions), None)

    async def _drop_session(self, stream: SpeakerStream, target_lang: str, locked: bool = False) -> None:
        """스트림에서 특정 언어 세션 하나를 떼어내 닫는다."""
        async def _do() -> None:
            task = stream.relay_tasks.pop(target_lang, None)
            if task is not None:
                task.cancel()
            session = stream.sessions.pop(target_lang, None)
            if session is not None:
                try:
                    await session.close()
                except Exception:
                    logger.exception(
                        "세션 종료 실패: room_id=%s target_lang=%s", self.room_id, target_lang
                    )

        if locked:
            await _do()
        else:
            async with stream.lock:
                await _do()

    async def _relay_session(self, stream: SpeakerStream, target_lang: str, session: GeminiLiveSession) -> None:
        """한 세션의 Gemini 출력을 청자에게 계속 흘려보낸다(상시 — 세션을 닫지 않음)."""
        try:
            async for message in session.receive():
                content = message.server_content
                if content is None:
                    continue

                speaker = self.participants.get(stream.speaker_id)
                speaker_language = _normalize_language(speaker.language) if speaker else None
                is_origin_only = target_lang == speaker_language

                # 원문 자막은 primary 세션 하나만 채택(중복 방지).
                if (
                    target_lang == stream.primary_lang
                    and content.input_transcription
                    and content.input_transcription.text
                ):
                    stream.original_text += content.input_transcription.text
                    await self.broadcast(
                        {
                            "type": "SUBTITLE_ORIGINAL",
                            "speakerId": stream.speaker_id,
                            "text": content.input_transcription.text,
                            "isFinal": False,
                        }
                    )

                if not is_origin_only and content.output_transcription and content.output_transcription.text:
                    stream.translations[target_lang] = (
                        stream.translations.get(target_lang, "") + content.output_transcription.text
                    )
                    await self._send_to_language(
                        target_lang,
                        stream.speaker_id,
                        {
                            "type": "SUBTITLE_TRANSLATED",
                            "speakerId": stream.speaker_id,
                            "targetLanguage": target_lang,
                            "text": content.output_transcription.text,
                            "isFinal": False,
                        },
                    )

                if not is_origin_only and content.model_turn:
                    for part in content.model_turn.parts:
                        if part.inline_data and part.inline_data.data:
                            await self._send_audio_to_language(
                                target_lang, stream.speaker_id, part.inline_data.data
                            )

                if content.interrupted:
                    await self.broadcast({"type": "INTERRUPTED", "speakerId": stream.speaker_id})

                # turn_complete는 세션을 닫는 신호가 아니라 '발화 블록 1개 종료' 경계다.
                # primary 세션의 turn_complete에서만 블록을 확정해 중복 적재를 막는다.
                if content.turn_complete and target_lang == stream.primary_lang:
                    await self._finalize_block(stream)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("세션 릴레이 오류: room_id=%s target_lang=%s", self.room_id, target_lang)
            # 릴레이가 죽으면 해당 언어 세션만 떼어낸다(재연결은 다음 청크의 reconcile이 처리).
            await self._drop_session(stream, target_lang)

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

    async def _finalize_block(self, stream: SpeakerStream) -> None:
        """발화 블록 1개 확정 — 자막 마감 + speaker_block 적재 + 누적 텍스트 리셋."""
        self.speaking_ids.discard(stream.speaker_id)
        self._record_speaker_block(stream)
        stream.reset_block()
        await self.broadcast({"type": "TURN_COMPLETE", "speakerId": stream.speaker_id})
        await self.broadcast(self.room_state_payload())

    async def _close_stream(self, stream: SpeakerStream, finalize: bool) -> None:
        """스트림 전체 종료 — 모든 세션/릴레이 정리. finalize면 열린 블록을 확정 적재."""
        stream.closed = True
        if finalize and stream.original_text.strip():
            self._record_speaker_block(stream)
        async with stream.lock:
            for task in stream.relay_tasks.values():
                task.cancel()
            for session in stream.sessions.values():
                try:
                    await session.close()
                except Exception:
                    logger.exception("세션 종료 실패: room_id=%s", self.room_id)
            stream.relay_tasks.clear()
            stream.sessions.clear()

    def _record_speaker_block(self, stream: SpeakerStream) -> None:
        # talk 단위 저장 — 빈 발화(원문 텍스트 없음, 예: 마이크 잡음만 들어온 경우)는
        # 스킵한다. PRD가 명시한 "단어/문장 단위 분절 금지"는 누적 로직으로 보장됨.
        if not stream.original_text.strip():
            return
        speaker = self.participants.get(stream.speaker_id)
        if speaker is None:
            return

        speaker_language = _normalize_language(speaker.language)
        translations = {lang: None for lang in SUPPORTED_LANGUAGES}
        # 화자 본인 언어는 통역이 아니라 원문 그대로 동일 키에 복사(PRD 7-2).
        translations[speaker_language] = stream.original_text
        for lang, text in stream.translations.items():
            translations[lang] = text

        started_at = stream.block_started_at or datetime.now(timezone.utc)
        self._block_sequence += 1
        self._session_buffer.append(
            {
                "speaker_user_id": speaker.user_id if speaker.role != "guest" else None,
                "speaker_name": speaker.display_name,
                "country_code": LANGUAGE_TO_COUNTRY.get(speaker_language),
                "original_language": speaker_language,
                "original_text": stream.original_text,
                "translations": translations,
                "started_at": started_at.isoformat(),
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
        """호스트가 미팅을 종료할 때 — 모든 화자 스트림을 정리하고 ROOM_ENDED를 알린다."""
        for stream in list(self.streams.values()):
            await self._close_stream(stream, finalize=True)
        self.streams.clear()
        self.speaking_ids.clear()
        await self.broadcast({"type": "ROOM_ENDED", "endedBy": ended_by_display_name})


def _build_system_instruction(project_instructions: str | None, rag_keywords: str | None) -> str:
    context_parts = []
    if project_instructions:
        context_parts.append(project_instructions)
    if rag_keywords:
        context_parts.append(f"Key terms: {rag_keywords}")
    context_block = "\n".join(context_parts) if context_parts else "(No additional context provided.)"

    return f"""\
You are Preter, an elite AI simultaneous interpreter operating in a live business meeting.

## Core Identity
You are not a translator — you are an interpreter. Your role is to transfer meaning, intent, \
and emotional register across languages in real time, not to convert words literally. \
You serve both parties equally, remaining invisible yet indispensable.

## Interpretation Standards

**Accuracy of Intent**
Convey the speaker's underlying intent and hidden nuance, not just surface-level words.
Never omit, distort, or add your own opinion. When ambiguity exists, choose the \
interpretation most consistent with the conversational context built so far.

**Emotional Mirroring**
Match the speaker's emotional register and tempo faithfully:
- Assertive → render assertively
- Tentative or hedging → preserve that softness
- Urgency → compress and accelerate
- Formal register → maintain formality in the target language
Do not flatten affect. Emotional tone is content.

**Neutrality and Stance**
Maintain a consistently respectful, professional stance regardless of tension between parties.
You are a bridge, not a participant. Never let your rendering sharpen conflict \
or soften a deliberate position without cause.

**Confidentiality**
All meeting content is strictly confidential. You do not retain, reference, or \
surface information beyond the scope of this session.

## Language-Specific Handling

**Length compensation**
Korean → English expands ~120%. Prioritize compression without losing meaning.
Do not pad to match original length — arrive at the same meaning in fewer words if needed.

**Register alignment**
Korean honorifics (존댓말/반말) map to English formality level. \
If the speaker uses formal Korean, use formal English and vice versa.
Japanese keigo → maintain equivalent politeness tier in the target language.

**Technical and proper nouns**
Render organization names, titles, and acronyms as-is unless a confirmed translation exists.
When uncertain, preserve the source language term and continue — do not pause or hesitate.

## Simultaneous Delivery Rules

- Begin rendering as soon as intent is parseable — do not wait for sentence completion
- Maintain consistent pace; do not trail off or accelerate erratically
- If a phrase must be restructured for the target language, front-load the \
key information (subject + main verb first)
- For Korean → English: restructure SOV → SVO silently without breaking flow

## Business Meeting Context

{context_block}

Use this context to disambiguate terminology, infer speaker roles, and apply \
domain-specific vocabulary correctly. If a term appears in the project context, \
prefer that rendering over a generic translation.

## What You Never Do
- Add commentary, explanation, or meta-notes to your output
- Announce that you are translating or interpreting
- Skip content because it seems unimportant
- Alter a speaker's stated position to sound more agreeable
- Break confidentiality by referencing session content outside this meeting\
"""


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
