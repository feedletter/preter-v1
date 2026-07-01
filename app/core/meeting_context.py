"""Host Live Session PRD 5-C — System Instruction 보정 레이어 조회.

프로젝트 지시사항과 미팅 자료 핵심 키워드를 "재해석이 아닌 보정 참고용"으로만
모아 짧은 문자열로 만든다. 전체 문서 원문은 통역 지연을 막기 위해 절대 주입하지 않는다.
"""

import logging

from app.core.supabase_client import get_client

logger = logging.getLogger(__name__)


def fetch_meeting_context(project_id: str | None, document_id: str | None) -> tuple[str | None, str | None]:
    """(project_instructions, rag_keywords) 튜플을 반환한다. 데이터 없으면 각각 None."""
    instructions = _fetch_project_instructions(project_id) if project_id else None
    keywords = _fetch_document_keywords(document_id) if document_id else None
    return instructions, keywords


def _fetch_project_instructions(project_id: str) -> str | None:
    try:
        result = (
            get_client()
            .table("project_instructions")
            .select("content")
            .eq("project_id", project_id)
            .execute()
        )
    except Exception:
        logger.exception("project_instructions 조회 실패: project_id=%s", project_id)
        return None
    if not result.data:
        return None
    return result.data[0]["content"] or None


def _fetch_document_keywords(document_id: str) -> str | None:
    try:
        result = (
            get_client()
            .table("document_contexts")
            .select("analysis_points")
            .eq("document_id", document_id)
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
    except Exception:
        logger.exception("document_contexts 조회 실패: document_id=%s", document_id)
        return None
    if not result.data:
        return None

    points: list[str] = []
    for row in result.data:
        points.extend(row.get("analysis_points") or [])
    if not points:
        return None
    # 전체 문서 원문은 주입하지 않고, 핵심 키워드/수치만 압축해서 전달한다.
    return ", ".join(dict.fromkeys(points))[:500]
