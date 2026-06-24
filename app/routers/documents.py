"""LeftSide PRD 8.2 — 미팅 자료 목록 + 업로드 (P2: 새 미팅 자료)."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.exceptions import DefaultCredentialsError
from pydantic import BaseModel

from app.core.storage import StorageError, upload_document
from app.core.supabase_client import get_client
from app.routers.rooms import _require_user_id

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


class DocumentResponse(BaseModel):
    id: str
    title: str
    file_url: str
    created_at: str


class DocumentsListResponse(BaseModel):
    documents: list[DocumentResponse]


@router.get("", response_model=DocumentsListResponse)
async def list_documents(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    user_id = _require_user_id(credentials)

    rows = (
        get_client()
        .table("documents")
        .select("id, title, file_url, created_at")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )

    return DocumentsListResponse(documents=[DocumentResponse(**row) for row in rows.data])


@router.post("", response_model=DocumentResponse, status_code=201)
async def create_document(
    title: str = Form(...),
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    user_id = _require_user_id(credentials)

    title = title.strip()
    if not title:
        raise HTTPException(status_code=422, detail={"error": "INVALID_TITLE"})

    content_type = file.content_type or ""
    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(status_code=415, detail={"error": "UNSUPPORTED_FILE_TYPE"})

    content = await file.read()
    try:
        file_url = upload_document(user_id, file.filename or "document", content, content_type)
    except StorageError:
        raise HTTPException(status_code=413, detail={"error": "FILE_TOO_LARGE"})
    except DefaultCredentialsError:
        raise HTTPException(status_code=503, detail={"error": "STORAGE_UNAVAILABLE"})

    row = {"user_id": user_id, "title": title, "file_url": file_url}
    result = get_client().table("documents").insert(row).execute()
    return DocumentResponse(**result.data[0])
