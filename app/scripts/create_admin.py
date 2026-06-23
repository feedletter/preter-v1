"""최초 어드민 계정 생성/승격 스크립트.

Supabase Auth에 계정이 없으면 새로 만들고, 있으면 그 계정을 그대로 쓴다.
어느 경우든 public.users.is_admin을 true로 올린다.

사용법:
    python -m app.scripts.create_admin admin@preter.me <비밀번호>
"""

import sys

from app.core import auth_service
from app.core.supabase_client import get_client


def create_admin(email: str, password: str, name: str = "Admin") -> None:
    try:
        result = auth_service.sign_up(email, password, name=name)
        user_id = result["user"]["id"]
        print(f"새 계정 생성: {email}")
    except auth_service.AuthError as exc:
        if exc.code != "EMAIL_ALREADY_EXISTS":
            raise
        result = auth_service.sign_in(email, password)
        user_id = result["user"]["id"]
        print(f"기존 계정 로그인: {email}")

    get_client().table("users").update({"is_admin": True, "is_onboarded": True}).eq(
        "id", user_id
    ).execute()
    print(f"is_admin=true로 설정 완료 (user_id={user_id})")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python -m app.scripts.create_admin <email> <password> [name]")
        sys.exit(1)

    email = sys.argv[1]
    password = sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else "Admin"
    create_admin(email, password, name)
