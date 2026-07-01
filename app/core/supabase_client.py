from functools import lru_cache

from supabase import Client, create_client

from app.config import settings


@lru_cache
def get_client() -> Client:
    """DB 테이블 접근 전용 service_role 클라이언트 — 항상 RLS를 bypass해야 한다.

    이 인스턴스는 절대 .auth.sign_in_with_password / .auth.sign_up / .auth.get_user
    등을 호출하면 안 된다. supabase-py는 그런 호출 직후 내부 postgrest 클라이언트의
    Authorization 헤더를 해당 유저의 세션 토큰으로 바꿔버려서, 이 캐시된 인스턴스가
    이후 모든 .table() 호출까지 영구적으로 그 유저 권한(RLS 적용)으로 실행되게 만든다.
    인증 관련 호출은 반드시 get_auth_client()의 새 인스턴스를 사용할 것.
    """
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_auth_client() -> Client:
    """Supabase Auth(GoTrue) 호출 전용 — 매번 새 인스턴스.

    .auth.* 호출이 세션 상태를 클라이언트에 묻혀버리는 부작용이 있으므로, 캐시된
    get_client()와 절대 공유하지 않는다. 매 요청마다 새로 만들어 그 부작용을 그 요청
    범위로만 한정시킨다.
    """
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
