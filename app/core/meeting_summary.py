"""After Meeting PRD 6-3/8-1/8-2 — 미팅 종료 후 speaker_blocks 영속화 + AI 요약 생성.

미팅 중 누적된 발화 블록(app/core/room_state.py의 메모리 버퍼)을 종료 시점에 한 번에
bulk INSERT하고, base_lang(호스트 기준 언어) 1회로 Claude 요약을 생성해 meeting_notes에
저장한다. 다른 언어 사용자가 조회할 때는 즉석 번역 후 캐싱한다(8-2 "방법 B").
"""

import asyncio
import json
import logging
import re

import anthropic

from app.config import settings
from app.core import ai_usage
from app.core.room_state import SUPPORTED_LANGUAGES
from app.core.supabase_client import get_client

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"

SUMMARY_SYSTEM_PROMPT = """당신은 B2B 비즈니스 미팅 요약 전문가입니다.
아래 미팅 대화록을 분석해 JSON 형식으로만 응답하세요.
응답 언어는 반드시 {base_lang}으로 작성하세요.

응답 JSON 스키마:
{{
  "one_liner": "string",
  "decisions": ["string"],
  "action_items": [{{"assignee":"string","content":"string","due":"string"}}],
  "follow_up_schedule": [{{"date":"string","title":"string","note":"string"}}]
}}"""

TRANSLATE_SYSTEM_PROMPT = """다음 JSON의 모든 문자열 값을 {target_lang}으로 번역하세요.
키 이름과 JSON 구조는 그대로 유지하고, 번역된 JSON만 응답하세요(마크다운 코드펜스 금지)."""

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)


def _strip_code_fence(text: str) -> str:
    match = _CODE_FENCE_RE.match(text.strip())
    return match.group(1).strip() if match else text.strip()


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


async def finalize_meeting(meeting_room_id: str, blocks: list[dict]) -> None:
    """end_room() 호출자가 fire-and-forget으로 띄우는 종료 후 처리 전체."""
    try:
        if blocks:
            await asyncio.to_thread(_insert_speaker_blocks, meeting_room_id, blocks)
        await asyncio.to_thread(_generate_summary, meeting_room_id, blocks)
    except Exception:
        logger.exception("미팅 종료 후처리 실패: meeting_room_id=%s", meeting_room_id)
        await asyncio.to_thread(_mark_error, meeting_room_id)


def _insert_speaker_blocks(meeting_room_id: str, blocks: list[dict]) -> None:
    rows = [{**block, "meeting_room_id": meeting_room_id} for block in blocks]
    get_client().table("speaker_blocks").insert(rows).execute()


def _mark_error(meeting_room_id: str) -> None:
    get_client().table("meeting_notes").upsert(
        {"meeting_room_id": meeting_room_id, "status": "error", "base_lang": "en"},
        on_conflict="meeting_room_id",
    ).execute()


def _resolve_base_lang(meeting_room_id: str) -> str:
    """기준 언어 = 호스트의 primary_language. 미설정 시 'en' 폴백(PRD 8-2)."""
    room = (
        get_client()
        .table("meeting_rooms")
        .select("host_user_id")
        .eq("id", meeting_room_id)
        .single()
        .execute()
    )
    host_user_id = room.data["host_user_id"]
    user = (
        get_client().table("users").select("primary_language").eq("id", host_user_id).single().execute()
    )
    return user.data.get("primary_language") or "en"


def _build_transcript(blocks: list[dict], base_lang: str) -> str:
    lines = []
    for block in sorted(blocks, key=lambda b: b["sequence"]):
        if block["original_language"] == base_lang:
            text = block["original_text"]
        else:
            text = block["translations"].get(base_lang) or block["original_text"]
        lines.append(f"[{block['speaker_name']}] {text}")
    return "\n".join(lines)


def _generate_summary(meeting_room_id: str, blocks: list[dict]) -> None:
    base_lang = _resolve_base_lang(meeting_room_id)

    if not blocks:
        # speaker_blocks 0건 — 요약할 대화 자체가 없는 경우. 빈 요약으로 completed 처리.
        get_client().table("meeting_notes").upsert(
            {
                "meeting_room_id": meeting_room_id,
                "status": "completed",
                "base_lang": base_lang,
                "one_liner": {base_lang: ""},
                "decisions": {base_lang: []},
                "action_items": {base_lang: []},
                "follow_up_schedule": {base_lang: []},
                "translated_langs": [base_lang],
            },
            on_conflict="meeting_room_id",
        ).execute()
        return

    transcript = _build_transcript(blocks, base_lang)
    client = _client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=SUMMARY_SYSTEM_PROMPT.format(base_lang=base_lang),
        messages=[{"role": "user", "content": transcript}],
    )
    ai_usage.log_usage(
        provider="anthropic",
        model=MODEL,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        context="meeting_summary:generate",
    )
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        parsed = json.loads(_strip_code_fence(text))
    except (json.JSONDecodeError, ValueError):
        logger.warning("meeting_summary: JSON 파싱 실패: %s", text[:200])
        get_client().table("meeting_notes").upsert(
            {"meeting_room_id": meeting_room_id, "status": "error", "base_lang": base_lang},
            on_conflict="meeting_room_id",
        ).execute()
        return

    get_client().table("meeting_notes").upsert(
        {
            "meeting_room_id": meeting_room_id,
            "status": "completed",
            "base_lang": base_lang,
            "one_liner": {base_lang: parsed.get("one_liner", "")},
            "decisions": {base_lang: parsed.get("decisions", [])},
            "action_items": {base_lang: parsed.get("action_items", [])},
            "follow_up_schedule": {base_lang: parsed.get("follow_up_schedule", [])},
            "translated_langs": [base_lang],
            "raw_prompt_tokens": response.usage.input_tokens,
        },
        on_conflict="meeting_room_id",
    ).execute()


def ensure_translated(meeting_notes: dict, target_lang: str) -> dict:
    """PRD 8-2 방법 B — 요청 언어가 base_lang과 다르면 즉석 번역 후 캐싱(meeting_notes JSONB에 추가).

    호출자(API 라우터)가 이미 가져온 meeting_notes row를 넘기면, 캐시 적중 시 그대로
    반환하고 미적중 시 번역 호출 + DB upsert까지 수행한 뒤 갱신된 dict를 반환한다.
    """
    if target_lang not in SUPPORTED_LANGUAGES:
        target_lang = meeting_notes["base_lang"]
    if target_lang in (meeting_notes.get("translated_langs") or []):
        return meeting_notes

    base_lang = meeting_notes["base_lang"]
    source = {
        "one_liner": meeting_notes["one_liner"].get(base_lang, ""),
        "decisions": meeting_notes["decisions"].get(base_lang, []),
        "action_items": meeting_notes["action_items"].get(base_lang, []),
        "follow_up_schedule": meeting_notes["follow_up_schedule"].get(base_lang, []),
    }
    client = _client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=TRANSLATE_SYSTEM_PROMPT.format(target_lang=target_lang),
        messages=[{"role": "user", "content": json.dumps(source, ensure_ascii=False)}],
    )
    ai_usage.log_usage(
        provider="anthropic",
        model=MODEL,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        context="meeting_summary:translate",
    )
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        translated = json.loads(_strip_code_fence(text))
    except (json.JSONDecodeError, ValueError):
        logger.warning("meeting_summary: 즉석 번역 JSON 파싱 실패: %s", text[:200])
        return meeting_notes

    meeting_notes["one_liner"][target_lang] = translated.get("one_liner", "")
    meeting_notes["decisions"][target_lang] = translated.get("decisions", [])
    meeting_notes["action_items"][target_lang] = translated.get("action_items", [])
    meeting_notes["follow_up_schedule"][target_lang] = translated.get("follow_up_schedule", [])
    meeting_notes["translated_langs"] = [*(meeting_notes.get("translated_langs") or []), target_lang]

    get_client().table("meeting_notes").update(
        {
            "one_liner": meeting_notes["one_liner"],
            "decisions": meeting_notes["decisions"],
            "action_items": meeting_notes["action_items"],
            "follow_up_schedule": meeting_notes["follow_up_schedule"],
            "translated_langs": meeting_notes["translated_langs"],
        }
    ).eq("meeting_room_id", meeting_notes["meeting_room_id"]).execute()
    return meeting_notes
