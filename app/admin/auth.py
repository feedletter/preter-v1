"""어드민 로그인 백엔드.

Supabase Auth(GoTrue)를 그대로 재사용한다 — 별도 어드민 계정 시스템을 만들지 않고,
일반 회원 로그인과 같은 인증을 거친 뒤 public.users.is_admin 플래그로 운영자만
들여보낸다. Django의 is_staff와 같은 역할.
"""

from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request

from app.core import auth_service
from app.core.supabase_client import get_client


class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        email = str(form.get("username", ""))
        password = str(form.get("password", ""))

        try:
            result = auth_service.sign_in(email, password)
        except auth_service.AuthError:
            return False

        user_id = result["user"]["id"]
        profile = (
            get_client().table("users").select("is_admin").eq("id", user_id).single().execute()
        )
        if not profile.data or not profile.data.get("is_admin"):
            return False

        request.session.update(
            {
                "access_token": result["access_token"],
                "user_id": user_id,
            }
        )
        return True

    async def logout(self, request: Request) -> bool:
        access_token = request.session.get("access_token")
        if access_token:
            try:
                auth_service.sign_out(access_token)
            except auth_service.AuthError:
                pass
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        access_token = request.session.get("access_token")
        if not access_token:
            return False

        try:
            auth_service.get_user(access_token)
        except auth_service.AuthError:
            return False
        return True
