"""회원가입 전(미인증) 명함 스캔 — Card Intro 화면에서 호출.

가입 전이라 user_id가 없으므로, 서버가 발급한 session_token으로만 business_cards
행을 식별한다. 프론트는 이 토큰을 들고 다닐 필요가 없다 — 파싱 결과를 응답으로 바로
받아서 회원가입 폼에 채우고, 그 이후로는 이 행을 다시 조회하지 않는다(1시간 후 만료).
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core import ocr, storage
from app.core.supabase_client import get_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/business-cards", tags=["business-cards"])

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/heic"}


class BusinessCardScanResponse(BaseModel):
    name: str | None
    company_email: str | None
    phone: str | None
    company_name: str | None
    position: str | None
    confidence: float | None


@router.post("", response_model=BusinessCardScanResponse)
async def scan_business_card(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail={"error": "UNSUPPORTED_FILE_TYPE"})

    content = await file.read()
    session_token = uuid.uuid4().hex

    try:
        parsed = ocr.parse_business_card(content)
    except ocr.OcrError:
        logger.exception("명함 OCR 실패")
        raise HTTPException(status_code=502, detail={"error": "OCR_FAILED"})

    try:
        image_url = storage.upload_business_card(session_token, content, file.content_type)
    except storage.StorageError as exc:
        if str(exc) == "FILE_TOO_LARGE":
            raise HTTPException(status_code=413, detail={"error": "FILE_TOO_LARGE"})
        raise HTTPException(status_code=500, detail={"error": "UPLOAD_FAILED"})

    await asyncio.to_thread(
        _insert_business_card_row, session_token, parsed, image_url
    )

    return BusinessCardScanResponse(
        name=parsed.name,
        company_email=parsed.company_email,
        phone=parsed.phone,
        company_name=parsed.company_name,
        position=parsed.position,
        confidence=parsed.confidence,
    )


def _insert_business_card_row(session_token: str, parsed, image_url: str) -> None:
    get_client().table("business_cards").insert(
        {
            "session_token": session_token,
            "raw_text": parsed.raw_text,
            "name": parsed.name,
            "company_email": parsed.company_email,
            "phone": parsed.phone,
            "company_name": parsed.company_name,
            "position": parsed.position,
            "image_url": image_url,
            "ocr_provider": "gcv",
            "confidence": parsed.confidence,
        }
    ).execute()
