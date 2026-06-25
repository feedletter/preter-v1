"""Doc Detail PRD 7.3 — Claude API로 업로드 자료/텍스트를 통역 맥락으로 분석.

모델은 claude-sonnet-4-6 고정 (Haiku 분기 없음 — MVP 단계 판단, app/config.py 참고).
응답은 JSON 전용으로 강제하고, 파싱 실패 시 1회 재시도 후 status=failed 처리한다.
"""

import json
import logging
import re

import anthropic

from app.config import settings
from app.core.supabase_client import get_client

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
FILES_API_BETA = "files-api-2025-04-14"

FILE_SYSTEM_PROMPT = """당신은 한국 중소기업의 해외 바이어 미팅을 준비하는 통역 보조 AI입니다.
첨부된 영업자료/카탈로그/계약서 등 파일을 분석해서, 실시간 통역 중 참고할 핵심 정보를 추출하세요.

Respond ONLY in valid JSON format with this exact shape (no markdown code fences, no commentary):
{
  "analysis_points": ["핵심 정보 1", "핵심 정보 2", ...],
  "technical_terms": ["전문용어/고유명사 1", ...],
  "language_hint": "ko" | "en" | "ja" | "zh"
}

analysis_points에는 제품/가격/거래조건/협상 포인트 등 통역 중 바로 참고할 수 있는
짧은 문장들을 담으세요. technical_terms에는 통역 시 원문 그대로 유지해야 할 고유명사,
제품명, 기술 용어를 담으세요. language_hint는 문서의 주 언어입니다."""

TEXT_SYSTEM_PROMPT = """당신은 한국 중소기업의 해외 바이어 미팅을 준비하는 통역 보조 AI입니다.
사용자가 입력한 메모/지침 텍스트를 분석해서, 실시간 통역 중 참고할 핵심 정보를 추출하세요.

Respond ONLY in valid JSON format with this exact shape (no markdown code fences, no commentary):
{
  "analysis_points": ["핵심 정보 1", "핵심 정보 2", ...],
  "priority": "high" | "medium" | "low"
}

analysis_points에는 통역 중 바로 참고할 수 있는 짧은 문장들을 담으세요.
priority는 이 메모가 통역 중 얼마나 중요하게 다뤄져야 하는지를 나타냅니다."""


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _parse_json_with_retry(client: anthropic.Anthropic, system_prompt: str, content: list) -> dict | None:
    for attempt in range(2):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": content}],
            betas=[FILES_API_BETA],
        )
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            return json.loads(_strip_code_fence(text))
        except (json.JSONDecodeError, ValueError):
            logger.warning("document_ai: JSON 파싱 실패 (attempt %d): %s", attempt, text[:200])
            continue
    return None


_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)


def _strip_code_fence(text: str) -> str:
    """Claude가 ```json ... ``` 마크다운 코드펜스로 감싸 응답하는 경우가 있어 제거."""
    match = _CODE_FENCE_RE.match(text.strip())
    return match.group(1).strip() if match else text.strip()


def _save_result(document_id: str, message_id: str, parsed: dict | None) -> None:
    client = get_client()
    if parsed is None:
        client.table("document_messages").update({"status": "failed"}).eq("id", message_id).execute()
        return

    client.table("document_messages").update(
        {"status": "completed", "analysis_result": parsed}
    ).eq("id", message_id).execute()

    client.table("document_contexts").insert(
        {
            "document_id": document_id,
            "message_id": message_id,
            "analysis_points": parsed.get("analysis_points", []),
            "technical_terms": parsed.get("technical_terms"),
            "language_hint": parsed.get("language_hint"),
            "priority": parsed.get("priority"),
        }
    ).execute()


def analyze_file_message(document_id: str, message_id: str, file_bytes: bytes, filename: str, mime_type: str) -> None:
    """BackgroundTasks에서 호출 — 파일을 Claude Files API에 업로드 후 분석."""
    try:
        client = _client()
        is_image = mime_type.startswith("image/")

        uploaded = client.beta.files.upload(
            file=(filename, file_bytes, mime_type),
            betas=[FILES_API_BETA],
        )

        source_block = (
            {"type": "image", "source": {"type": "file", "file_id": uploaded.id}}
            if is_image
            else {"type": "document", "source": {"type": "file", "file_id": uploaded.id}}
        )
        content = [
            source_block,
            {"type": "text", "text": "이 자료를 분석해서 통역 맥락을 추출해주세요."},
        ]

        parsed = _parse_json_with_retry(client, FILE_SYSTEM_PROMPT, content)
        _save_result(document_id, message_id, parsed)
    except Exception:
        logger.exception("document_ai: 파일 분석 실패 (message_id=%s)", message_id)
        get_client().table("document_messages").update({"status": "failed"}).eq("id", message_id).execute()


def analyze_text_message(document_id: str, message_id: str, text: str) -> None:
    """BackgroundTasks에서 호출 — 텍스트 메모를 분석."""
    try:
        client = _client()
        content = [{"type": "text", "text": text}]
        parsed = _parse_json_with_retry(client, TEXT_SYSTEM_PROMPT, content)
        _save_result(document_id, message_id, parsed)
    except Exception:
        logger.exception("document_ai: 텍스트 분석 실패 (message_id=%s)", message_id)
        get_client().table("document_messages").update({"status": "failed"}).eq("id", message_id).execute()
