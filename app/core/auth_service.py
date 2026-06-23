"""Supabase Auth(GoTrue) 호출을 한 곳에 모아두는 모듈.

인증 엔진을 commodity로 취급하는 CLAUDE.md 원칙에 따라, 다른 비즈니스 로직은
이 모듈을 통해서만 인증을 다루고 Supabase SDK를 직접 호출하지 않는다.
나중에 인증 제공자를 바꾸게 되면 이 파일만 교체하면 된다.
"""

from supabase import AuthApiError

from app.core.supabase_client import get_client


class AuthError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def sign_up(email: str, password: str, name: str | None = None) -> dict:
    try:
        res = get_client().auth.sign_up(
            {
                "email": email,
                "password": password,
                "options": {"data": {"name": name}} if name else {},
            }
        )
    except AuthApiError as exc:
        if "already registered" in str(exc).lower() or "already exists" in str(exc).lower():
            raise AuthError("EMAIL_ALREADY_EXISTS", str(exc)) from exc
        raise AuthError("SIGNUP_FAILED", str(exc)) from exc

    return _session_to_dict(res)


def sign_in(email: str, password: str) -> dict:
    try:
        res = get_client().auth.sign_in_with_password({"email": email, "password": password})
    except AuthApiError as exc:
        raise AuthError("INVALID_CREDENTIALS", str(exc)) from exc

    return _session_to_dict(res)


def sign_in_with_id_token(provider: str, id_token: str, nonce: str | None = None) -> dict:
    """Google/Apple 네이티브 SDK가 발급한 ID 토큰으로 Supabase 세션을 발급한다."""
    payload: dict = {"provider": provider, "token": id_token}
    if nonce:
        payload["nonce"] = nonce
    try:
        res = get_client().auth.sign_in_with_id_token(payload)
    except AuthApiError as exc:
        raise AuthError("SNS_LOGIN_FAILED", str(exc)) from exc

    return _session_to_dict(res)


def refresh_session(refresh_token: str) -> dict:
    try:
        res = get_client().auth.refresh_session(refresh_token)
    except AuthApiError as exc:
        raise AuthError("INVALID_REFRESH_TOKEN", str(exc)) from exc

    return _session_to_dict(res)


def sign_out(access_token: str) -> None:
    """service_role 키로 특정 유저의 토큰을 무효화한다 (admin API 사용)."""
    try:
        get_client().auth.admin.sign_out(access_token)
    except AuthApiError as exc:
        raise AuthError("SIGNOUT_FAILED", str(exc)) from exc


def get_user(access_token: str) -> dict:
    """access token을 검증하고 유저 정보를 반환한다 (WebSocket 인증 등에서 사용)."""
    try:
        res = get_client().auth.get_user(access_token)
    except AuthApiError as exc:
        raise AuthError("INVALID_TOKEN", str(exc)) from exc

    if res.user is None:
        raise AuthError("INVALID_TOKEN", "user not found for token")

    return {"id": res.user.id, "email": res.user.email}


def _session_to_dict(res) -> dict:
    return {
        "access_token": res.session.access_token,
        "refresh_token": res.session.refresh_token,
        "user": {
            "id": res.user.id,
            "email": res.user.email,
        },
    }
