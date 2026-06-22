import logging

from app.core.supabase_client import get_client

logger = logging.getLogger(__name__)

TABLE = "interpretation_sessions"


def load(session_id: str) -> dict | None:
    """저장된 세션 컨텍스트(resumption handle 등)를 복원한다.

    CLAUDE.md: 55분 선제 재연결 시 Supabase에서 세션 컨텍스트를 복원하기 위한 용도.
    실시간 발화 경로에는 호출되지 않음 (세션 시작/재연결 시점에만 호출).
    """
    try:
        res = (
            get_client()
            .table(TABLE)
            .select("*")
            .eq("session_id", session_id)
            .limit(1)
            .execute()
        )
    except Exception:
        logger.exception("Supabase 세션 조회 실패: session_id=%s", session_id)
        return None

    rows = res.data or []
    return rows[0] if rows else None


def upsert(
    session_id: str,
    user_id: str,
    target_language_code: str,
    resumption_handle: str | None,
) -> None:
    try:
        get_client().table(TABLE).upsert(
            {
                "session_id": session_id,
                "user_id": user_id,
                "target_language_code": target_language_code,
                "resumption_handle": resumption_handle,
            },
            on_conflict="session_id",
        ).execute()
    except Exception:
        logger.exception("Supabase 세션 저장 실패: session_id=%s", session_id)


def delete(session_id: str) -> None:
    try:
        get_client().table(TABLE).delete().eq("session_id", session_id).execute()
    except Exception:
        logger.exception("Supabase 세션 삭제 실패: session_id=%s", session_id)
