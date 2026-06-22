from jose import JWTError, jwt

from app.config import settings


class AuthError(Exception):
    pass


def verify_token(token: str) -> dict:
    """JWT를 검증하고 클레임을 반환한다.

    CLAUDE.md: JWT 또는 Firebase Auth ID 토큰을 검증. 유저별 데이터 격리는
    Supabase RLS가 DB 레벨에서 처리하므로, 여기서는 토큰 유효성과 sub(유저 ID)만 확인한다.
    """
    if not token:
        raise AuthError("missing token")

    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise AuthError(f"invalid token: {exc}") from exc

    if not claims.get("sub"):
        raise AuthError("token missing sub claim")

    return claims
