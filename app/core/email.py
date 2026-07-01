"""미팅 요약 이메일 발송 (Resend).

RESEND_API_KEY가 비어있으면(.env 미설정) 발송을 건너뛰고 로그만 남긴다 —
로컬 개발 중 이메일 키 없이도 나머지 플로우를 막지 않기 위함.
"""

import logging

import resend

from app.config import settings

logger = logging.getLogger(__name__)


class EmailError(Exception):
    pass


def send_meeting_summary_email(
    to_email: str,
    room_title: str | None,
    summary_text: str | None,
    action_items: list,
) -> bool:
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY가 설정되지 않아 요약 이메일 발송을 건너뜀: %s", to_email)
        return False

    resend.api_key = settings.resend_api_key

    items_html = "".join(f"<li>{item}</li>" for item in action_items) if action_items else ""
    html = f"""
    <h2>{room_title or '미팅'} 요약</h2>
    <p>{summary_text or '요약 내용이 아직 준비되지 않았어요.'}</p>
    {f"<h3>액션 아이템</h3><ul>{items_html}</ul>" if items_html else ""}
    """

    try:
        resend.Emails.send(
            {
                "from": settings.resend_from_email,
                "to": [to_email],
                "subject": f"[Preter] {room_title or '미팅'} 요약",
                "html": html,
            }
        )
    except Exception as exc:
        raise EmailError(str(exc)) from exc

    return True
