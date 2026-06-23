from app.core import auth_service


class AuthError(Exception):
    pass


def verify_token(token: str) -> dict:
    """Supabase Auth가 발급한 access token을 검증하고 클레임을 반환한다.

    유저별 데이터 격리는 Supabase RLS가 DB 레벨에서 처리하므로,
    여기서는 토큰 유효성과 유저 ID(sub)만 확인한다.
    """
    if not token:
        raise AuthError("missing token")

    try:
        user = auth_service.get_user(token)
    except auth_service.AuthError as exc:
        raise AuthError(f"invalid token: {exc}") from exc

    return {"sub": user["id"], "email": user["email"]}
