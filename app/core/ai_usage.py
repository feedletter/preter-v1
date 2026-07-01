"""AI API 호출 비용 추적 — 어드민 "일별 AI 비용" 대시보드용 로깅.

호출이 일어난 그 자리에서(예: document_ai.py) log_usage()를 호출해 1행씩 적재한다.
Gemini Live는 세션이 turn 단위로 끊겨서 토큰 집계 방식이 달라(별도 작업 필요) 일단
제외하고, 현재 비용이 발생하는 유일한 지점인 Claude(document_ai.py)만 다룬다.
"""

import logging

from app.core.supabase_client import get_client

logger = logging.getLogger(__name__)

# 1M 토큰당 USD 가격 (input, output). 모델이 늘어나면 여기에 추가.
_PRICING_PER_MILLION_TOKENS: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-6": (3.00, 15.00),
}


def _calculate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = _PRICING_PER_MILLION_TOKENS.get(model)
    if pricing is None:
        logger.warning("ai_usage: 알 수 없는 모델 가격표, cost_usd=0으로 기록: model=%s", model)
        return 0.0
    input_price, output_price = pricing
    return (input_tokens / 1_000_000) * input_price + (output_tokens / 1_000_000) * output_price


def log_usage(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    context: str | None = None,
    document_id: str | None = None,
    message_id: str | None = None,
) -> None:
    """API 호출 1번(재시도 attempt 포함)마다 호출 — 실패해도 본 흐름을 막지 않는다."""
    cost_usd = _calculate_cost_usd(model, input_tokens, output_tokens)
    try:
        get_client().table("ai_usage_logs").insert(
            {
                "provider": provider,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": cost_usd,
                "context": context,
                "document_id": document_id,
                "message_id": message_id,
            }
        ).execute()
    except Exception:
        # 비용 로깅 실패가 실제 분석 결과 저장을 막으면 안 된다 — 기록만 못 하고 넘어간다.
        logger.exception("ai_usage: 사용량 기록 실패 (provider=%s model=%s)", provider, model)
