import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from app.core import auth_service
from app.core.supabase_client import get_client

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
bearer_scheme = HTTPBearer()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")  # PRD 3.1.2: RFC 5322 형식 검사


def _fetch_user_summary(user_id: str) -> dict:
    client = get_client()
    profile = (
        client.table("users")
        .select("name, email, is_onboarded")
        .eq("id", user_id)
        .single()
        .execute()
    )
    plan_row = client.table("user_plans").select("plan").eq("user_id", user_id).single().execute()
    return {
        "id": user_id,
        "name": profile.data["name"] if profile.data else None,
        "email": profile.data["email"] if profile.data else None,
        "plan": plan_row.data["plan"] if plan_row.data else None,
        "is_onboarded": profile.data["is_onboarded"] if profile.data else False,
    }


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_must_match_rfc(cls, value: str) -> str:
        if not EMAIL_RE.match(value):
            raise ValueError("invalid email format")
        return value


class SignupRequest(BaseModel):
    # Step 2
    primary_language: str
    name: str
    email: str
    password: str
    # 가입 시점 디바이스 로캘로 결정된 앱 UI 언어 (통역 언어인 primary_language와 별개).
    # 프론트가 안 보내면 DB 컬럼 기본값('ko')으로 남는다.
    app_language: str | None = None
    # Step 3 (선택)
    phone: str | None = None
    country_code: str = "+82"
    company_email: str | None = None
    position: str | None = None
    company_name: str | None = None

    @field_validator("email")
    @classmethod
    def email_must_match_rfc(cls, value: str) -> str:
        if not EMAIL_RE.match(value):
            raise ValueError("invalid email format")
        return value

    @field_validator("password")
    @classmethod
    def password_min_length(cls, value: str) -> str:
        # PRD 3.1.2: 8자 이상. (영문+숫자+특수 8자↑ 정책은 프론트 단계 검증과 함께 추후 강화)
        if len(value) < 8:
            raise ValueError("password must be at least 8 characters")
        return value


class EmailAvailabilityResponse(BaseModel):
    available: bool


class SnsLoginRequest(BaseModel):
    provider: str  # 'google' | 'apple'
    id_token: str
    nonce: str | None = None

    @field_validator("provider")
    @classmethod
    def provider_must_be_supported(cls, value: str) -> str:
        if value not in ("google", "apple"):
            raise ValueError("unsupported provider")
        return value


class SnsCompleteRequest(BaseModel):
    primary_language: str
    name: str
    app_language: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: dict


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    try:
        result = auth_service.sign_in(body.email, body.password)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_CREDENTIALS"})

    user_summary = await asyncio.to_thread(_fetch_user_summary, result["user"]["id"])
    return TokenResponse(
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        user=user_summary,
    )


@router.get("/check-email", response_model=EmailAvailabilityResponse)
async def check_email(email: str):
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail={"error": "INVALID_EMAIL_FORMAT"})

    available = await asyncio.to_thread(_check_email_available, email)
    return EmailAvailabilityResponse(available=available)


def _check_email_available(email: str) -> bool:
    existing = get_client().table("users").select("id").eq("email", email).execute()
    return len(existing.data) == 0


@router.post("/signup", response_model=TokenResponse)
async def signup(body: SignupRequest):
    try:
        result = auth_service.sign_up(body.email, body.password, name=body.name)
    except auth_service.AuthError as exc:
        if exc.code == "EMAIL_ALREADY_EXISTS":
            raise HTTPException(status_code=409, detail={"error": "EMAIL_ALREADY_EXISTS"})
        raise HTTPException(status_code=400, detail={"error": exc.code})

    user_id = result["user"]["id"]
    user_summary = await asyncio.to_thread(_finish_signup_profile, user_id, body)
    return TokenResponse(
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        user=user_summary,
    )


def _finish_signup_profile(user_id: str, body: SignupRequest) -> dict:
    update_fields = {
        "primary_language": body.primary_language,
        "phone": body.phone,
        "country_code": body.country_code,
        "company_email": body.company_email,
        "position": body.position,
        "company_name": body.company_name,
        "is_onboarded": True,
    }
    if body.app_language:
        update_fields["app_language"] = body.app_language

    get_client().table("users").update(update_fields).eq("id", user_id).execute()

    return _fetch_user_summary(user_id)


@router.post("/sns", response_model=TokenResponse)
async def sns_login(body: SnsLoginRequest):
    try:
        result = auth_service.sign_in_with_id_token(body.provider, body.id_token, body.nonce)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "SNS_LOGIN_FAILED"})

    user_summary = await asyncio.to_thread(_fetch_user_summary, result["user"]["id"])
    return TokenResponse(
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        user=user_summary,
    )


@router.post("/sns/complete", response_model=TokenResponse)
async def sns_complete(
    body: SnsCompleteRequest, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
):
    try:
        user = auth_service.get_user(credentials.credentials)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN"})

    user_id = user["id"]
    user_summary = await asyncio.to_thread(_finish_sns_signup_profile, user_id, body)
    return TokenResponse(
        access_token=credentials.credentials,
        refresh_token="",
        user=user_summary,
    )


def _finish_sns_signup_profile(user_id: str, body: SnsCompleteRequest) -> dict:
    update_fields = {
        "primary_language": body.primary_language,
        "name": body.name,
        "is_onboarded": True,
    }
    if body.app_language:
        update_fields["app_language"] = body.app_language

    get_client().table("users").update(update_fields).eq("id", user_id).execute()

    return _fetch_user_summary(user_id)


class MeResponse(BaseModel):
    user: dict


@router.get("/me", response_model=MeResponse)
async def me(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    # 웹 OAuth 플로우(Supabase가 클라이언트에 직접 토큰을 발급)로 로그인한 뒤,
    # 그 토큰이 유효한지 확인하고 is_onboarded 등 프로필 상태를 조회하는 용도.
    try:
        user = auth_service.get_user(credentials.credentials)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN"})

    user_summary = await asyncio.to_thread(_fetch_user_summary, user["id"])
    return MeResponse(user=user_summary)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    try:
        result = auth_service.refresh_session(body.refresh_token)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_REFRESH_TOKEN"})

    user_summary = await asyncio.to_thread(_fetch_user_summary, result["user"]["id"])
    return TokenResponse(
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        user=user_summary,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    try:
        auth_service.sign_out(credentials.credentials)
    except auth_service.AuthError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN"})
