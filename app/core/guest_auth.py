"""Guest 참가자 전용 인증 모듈.

Guest는 Preter 계정(Supabase Auth)이 없는 임시 참가자라, auth_service와
별도로 RS256으로 서명한 JWT를 발급/검증한다. payload는 PRD 6.4/7.1 명세대로
{ guest_session_id, room_id, exp } 만 담는다 — 그 이상의 개인정보는 넣지 않는다.
"""

import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

ALGORITHM = "RS256"
EXPIRES_IN = timedelta(hours=24)


class GuestAuthError(Exception):
    pass


def _private_key() -> str:
    return settings.guest_jwt_private_key.replace("\\n", "\n")


def _public_key() -> str:
    return settings.guest_jwt_public_key.replace("\\n", "\n")


def issue_guest_token(guest_session_id: uuid.UUID, room_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "guest_session_id": str(guest_session_id),
        "room_id": str(room_id),
        "iat": now,
        "exp": now + EXPIRES_IN,
    }
    return jwt.encode(payload, _private_key(), algorithm=ALGORITHM)


def verify_guest_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, _public_key(), algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise GuestAuthError(str(exc)) from exc
    return payload


def hash_password(raw_password: str) -> str:
    return bcrypt.hashpw(raw_password.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_password(raw_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(raw_password.encode(), password_hash.encode())
