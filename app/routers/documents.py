"""Doc Detail PRD — 빈 자료 생성 후 채팅형 AI 분석 플로우.

LeftSide PRD 8.2의 기존 "파일 1개 즉시 업로드" 플로우를 대체한다:
빈 "제목없음" 자료를 만들고, 이후 메시지(파일/텍스트) 단위로 Claude 분석을 돌린다.
"""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.exceptions import DefaultCredentialsError
from pydantic import BaseModel

from app.core.storage import StorageError, upload_document
from app.core.supabase_client import get_client
from app.routers.rooms import _require_user_id
from app.services.document_ai import analyze_file_message, analyze_text_message

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])
bearer_scheme = HTTPBearer()

ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpeg",
    "image/jpg",
    "image/png",
}

DEFAULT_TITLE = "제목없음"


class DocumentResponse(BaseModel):
    id: str
    title: str
    file_url: str | None
    created_at: str


class DocumentsListResponse(BaseModel):
    documents: list[DocumentResponse]


class DocumentDetailResponse(BaseModel):
    id: str
    title: str
    created_at: str
    message_count: int
    context_count: int


class UpdateDocumentRequest(BaseModel):
    title: str


class DocumentMessageResponse(BaseModel):
    id: str
    document_id: str
    type: str
    content: str | None
    file_url: str | None
    file_name: str | None
    status: str
    analysis_result: dict | None
    created_at: str


class DocumentMessagesResponse(BaseModel):
    messages: list[DocumentMessageResponse]


class SendTextMessageRequest(BaseModel):
    content: str


class MessageStatusResponse(BaseModel):
    id: str
    status: str
    analysis_result: dict | None


class DocumentContextResponse(BaseModel):
    id: str
    message_id: str | None
    analysis_points: list
    technical_terms: list | None
    language_hint: str | None
    priority: str | None
    created_at: str


class DocumentContextsResponse(BaseModel):
    contexts: list[DocumentContextResponse]


def _require_document(document_id: str, user_id: str) -> dict:
    result = (
        get_client()
        .table("documents")
        .select("id, user_id, title, created_at")
        .eq("id", document_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not result.data or result.data[0]["user_id"] != user_id:
        raise HTTPException(status_code=404, detail={"error": "DOCUMENT_NOT_FOUND"})
    return result.data[0]


@router.get("", response_model=DocumentsListResponse)
async def list_documents(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    rows = await asyncio.to_thread(_fetch_documents_list, user_id)
    return DocumentsListResponse(documents=[DocumentResponse(**row) for row in rows])


def _fetch_documents_list(user_id: str) -> list[dict]:
    rows = (
        get_client()
        .table("documents")
        .select("id, title, file_url, created_at")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    return rows.data


@router.post("", response_model=DocumentResponse, status_code=201)
async def create_document(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    """Doc Detail PRD Table 33 — 파일 없이 "제목없음" 빈 자료를 생성하고 Doc Detail로 이동."""
    user_id = _require_user_id(credentials)
    row = await asyncio.to_thread(_create_document_row, user_id)
    return DocumentResponse(**row)


def _create_document_row(user_id: str) -> dict:
    row = {"user_id": user_id, "title": DEFAULT_TITLE, "file_url": None}
    result = get_client().table("documents").insert(row).execute()
    return result.data[0]


@router.get("/{document_id}", response_model=DocumentDetailResponse)
async def get_document(document_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    data = await asyncio.to_thread(_fetch_document_detail, document_id, user_id)
    return DocumentDetailResponse(**data)


def _fetch_document_detail(document_id: str, user_id: str) -> dict:
    doc = _require_document(document_id, user_id)

    client = get_client()
    messages = (
        client.table("document_messages").select("id", count="exact").eq("document_id", document_id).execute()
    )
    contexts = (
        client.table("document_contexts").select("id", count="exact").eq("document_id", document_id).execute()
    )

    return {
        "id": doc["id"],
        "title": doc["title"],
        "created_at": doc["created_at"],
        "message_count": messages.count or 0,
        "context_count": contexts.count or 0,
    }


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: str,
    body: UpdateDocumentRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)

    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail={"error": "INVALID_TITLE"})

    row = await asyncio.to_thread(_update_document_row, document_id, user_id, title)
    return DocumentResponse(**row)


def _update_document_row(document_id: str, user_id: str, title: str) -> dict:
    _require_document(document_id, user_id)
    result = get_client().table("documents").update({"title": title}).eq("id", document_id).execute()
    return result.data[0]


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)
    await asyncio.to_thread(_delete_document_row, document_id, user_id)


def _delete_document_row(document_id: str, user_id: str) -> None:
    _require_document(document_id, user_id)

    client = get_client()
    client.table("project_documents").delete().eq("document_id", document_id).execute()
    client.table("documents").update({"deleted_at": datetime.now(timezone.utc).isoformat()}).eq(
        "id", document_id
    ).execute()


@router.get("/{document_id}/messages", response_model=DocumentMessagesResponse)
async def list_document_messages(
    document_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)
    rows = await asyncio.to_thread(_fetch_document_messages_rows, document_id, user_id)
    return DocumentMessagesResponse(messages=[DocumentMessageResponse(**row) for row in rows])


def _fetch_document_messages_rows(document_id: str, user_id: str) -> list[dict]:
    _require_document(document_id, user_id)

    rows = (
        get_client()
        .table("document_messages")
        .select("*")
        .eq("document_id", document_id)
        .order("created_at")
        .execute()
    )
    return rows.data


@router.post("/{document_id}/messages", response_model=DocumentMessageResponse, status_code=201)
async def send_file_message(
    document_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """파일 첨부 메시지 — multipart. 텍스트 메시지는 send_text_message로 별도 처리."""
    user_id = _require_user_id(credentials)
    await asyncio.to_thread(_require_document, document_id, user_id)

    content_type = file.content_type or ""
    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(status_code=415, detail={"error": "UNSUPPORTED_FILE_TYPE"})

    content = await file.read()
    try:
        file_url = upload_document(user_id, file.filename or "file", content, content_type)
    except StorageError:
        raise HTTPException(status_code=413, detail={"error": "FILE_TOO_LARGE"})
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail={"error": "STORAGE_UNAVAILABLE"})

    message = await asyncio.to_thread(_insert_file_message_row, document_id, file_url, file.filename)

    background_tasks.add_task(
        analyze_file_message, document_id, message["id"], content, file.filename or "file", content_type
    )

    return DocumentMessageResponse(**message)


def _insert_file_message_row(document_id: str, file_url: str, file_name: str | None) -> dict:
    row = {
        "document_id": document_id,
        "type": "file",
        "file_url": file_url,
        "file_name": file_name,
        "status": "processing",
    }
    result = get_client().table("document_messages").insert(row).execute()
    return result.data[0]


@router.post("/{document_id}/messages/text", response_model=DocumentMessageResponse, status_code=201)
async def send_text_message(
    document_id: str,
    body: SendTextMessageRequest,
    background_tasks: BackgroundTasks,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)

    text = body.content.strip()
    if not text:
        raise HTTPException(status_code=422, detail={"error": "EMPTY_CONTENT"})

    message = await asyncio.to_thread(_insert_text_message_row, document_id, user_id, text)

    background_tasks.add_task(analyze_text_message, document_id, message["id"], text)

    return DocumentMessageResponse(**message)


def _insert_text_message_row(document_id: str, user_id: str, text: str) -> dict:
    _require_document(document_id, user_id)

    row = {"document_id": document_id, "type": "text", "content": text, "status": "processing"}
    result = get_client().table("document_messages").insert(row).execute()
    return result.data[0]


@router.get("/{document_id}/messages/{message_id}/status", response_model=MessageStatusResponse)
async def get_message_status(
    document_id: str, message_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    user_id = _require_user_id(credentials)
    row = await asyncio.to_thread(_fetch_message_status_row, document_id, message_id, user_id)
    return MessageStatusResponse(**row)


def _fetch_message_status_row(document_id: str, message_id: str, user_id: str) -> dict:
    _require_document(document_id, user_id)

    result = (
        get_client()
        .table("document_messages")
        .select("id, status, analysis_result")
        .eq("id", message_id)
        .eq("document_id", document_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail={"error": "MESSAGE_NOT_FOUND"})
    return result.data[0]


@router.get("/{document_id}/context", response_model=DocumentContextsResponse)
async def get_document_context(
    document_id: str, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    """Doc Detail PRD — "학습된 자료 보기" 바텀시트. 최신 업데이트순."""
    user_id = _require_user_id(credentials)
    rows = await asyncio.to_thread(_fetch_document_context_rows, document_id, user_id)
    return DocumentContextsResponse(contexts=[DocumentContextResponse(**row) for row in rows])


def _fetch_document_context_rows(document_id: str, user_id: str) -> list[dict]:
    _require_document(document_id, user_id)

    rows = (
        get_client()
        .table("document_contexts")
        .select("*")
        .eq("document_id", document_id)
        .order("created_at", desc=True)
        .execute()
    )
    return rows.data
