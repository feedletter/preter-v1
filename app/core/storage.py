"""GCS 업로드 — 현재는 프로필 아바타 전용.

로컬 개발 환경에는 보통 GCP 서비스 계정 자격증명이 없으므로, Cloud Run에 붙는
어태치드 서비스 계정(Application Default Credentials)에 의존한다. 로컬에서
실제 업로드를 테스트하려면 `gcloud auth application-default login`이 필요하다.
"""

from datetime import datetime, timezone
from functools import lru_cache

from google.api_core.exceptions import NotFound
from google.cloud import storage

from app.config import settings

AVATAR_MAX_BYTES = 5 * 1024 * 1024  # PRD 9.4: 5MB 초과 시 업로드 거부
DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
BUSINESS_CARD_MAX_BYTES = 10 * 1024 * 1024


class StorageError(Exception):
    pass


@lru_cache
def _get_bucket() -> storage.Bucket:
    client = storage.Client(project=settings.gcp_project_id or None)
    return client.bucket(settings.gcs_bucket_name)


def upload_avatar(user_id: str, content: bytes, content_type: str) -> str:
    if len(content) > AVATAR_MAX_BYTES:
        raise StorageError("FILE_TOO_LARGE")

    timestamp = int(datetime.now(timezone.utc).timestamp())
    extension = "jpg" if content_type in ("image/jpeg", "image/jpg") else "png"
    blob_path = f"avatars/{user_id}/{timestamp}.{extension}"

    bucket = _get_bucket()
    blob = bucket.blob(blob_path)
    blob.upload_from_string(content, content_type=content_type)
    # 버킷이 Uniform bucket-level access라 객체별 ACL(make_public)은 거부된다 —
    # 공개 읽기는 버킷 IAM(allUsers: objectViewer)에서 한 번에 처리한다.

    # PRD 9.4: 캐시 무효화를 위해 ?v={timestamp} 쿼리를 붙인다.
    return f"{blob.public_url}?v={timestamp}"


def upload_document(user_id: str, filename: str, content: bytes, content_type: str) -> str:
    if len(content) > DOCUMENT_MAX_BYTES:
        raise StorageError("FILE_TOO_LARGE")

    timestamp = int(datetime.now(timezone.utc).timestamp())
    safe_name = filename.replace("/", "_")
    blob_path = f"documents/{user_id}/{timestamp}_{safe_name}"

    bucket = _get_bucket()
    blob = bucket.blob(blob_path)
    blob.upload_from_string(content, content_type=content_type)
    # 버킷이 Uniform bucket-level access라 객체별 ACL(make_public)은 거부된다 —
    # 공개 읽기는 버킷 IAM(allUsers: objectViewer)에서 한 번에 처리한다.

    return blob.public_url


def upload_business_card(session_token: str, content: bytes, content_type: str) -> str:
    # 가입 전(미인증) 상태라 user_id가 없어, 클라이언트 식별용 session_token으로 경로를 잡는다.
    if len(content) > BUSINESS_CARD_MAX_BYTES:
        raise StorageError("FILE_TOO_LARGE")

    timestamp = int(datetime.now(timezone.utc).timestamp())
    extension = "jpg" if content_type in ("image/jpeg", "image/jpg") else "png"
    blob_path = f"business-cards/{session_token}/{timestamp}.{extension}"

    bucket = _get_bucket()
    blob = bucket.blob(blob_path)
    blob.upload_from_string(content, content_type=content_type)

    return blob.public_url


def delete_avatar(avatar_url: str) -> None:
    # avatar_url 형식: https://storage.googleapis.com/{bucket}/avatars/{user_id}/{ts}.{ext}?v=...
    path = avatar_url.split("?")[0]
    marker = f"{settings.gcs_bucket_name}/"
    if marker not in path:
        return
    blob_path = path.split(marker, 1)[1]

    bucket = _get_bucket()
    blob = bucket.blob(blob_path)
    try:
        blob.delete()
    except NotFound:
        pass
