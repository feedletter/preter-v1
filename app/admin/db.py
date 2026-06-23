from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings

_engine: AsyncEngine | None = None


def get_admin_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        # asyncpg 드라이버 사용 — DATABASE_URL은 보통 postgresql:// 형태로 오므로
        # sqladmin/SQLAlchemy가 asyncpg를 쓰도록 스킴을 변환해준다.
        url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        # Supabase의 direct connection(db.<ref>.supabase.co)은 IPv6 전용이라 IPv6 미지원
        # 네트워크에서는 DNS조차 안 풀린다. 그래서 IPv4를 지원하는 Supavisor pooler
        # (aws-*.pooler.supabase.com:6543)를 쓰는데, 이 pooler는 커넥션을 여러 클라이언트가
        # 돌려쓰는 transaction 모드라 asyncpg의 prepared statement 캐시가 깨진 statement를
        # 재사용하려다 에러를 낸다. statement_cache_size=0으로 캐시를 꺼서 회피.
        _engine = create_async_engine(url, connect_args={"statement_cache_size": 0})
    return _engine
