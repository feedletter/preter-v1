from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    port: int = 8000

    google_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    gcs_bucket_name: str = ""
    gcp_project_id: str = ""

    # sqladmin이 PostgREST가 아니라 Postgres에 직접 붙기 위한 연결 문자열.
    # Supabase 대시보드 Project Settings > Database > Connection string (URI)에서 발급.
    database_url: str = ""
    admin_session_secret: str = "dev-only-change-me"

    # Guest는 Supabase Auth 계정이 없어 별도 RS256 서명 JWT로 신원을 증명한다.
    guest_jwt_private_key: str = ""
    guest_jwt_public_key: str = ""

    # 미팅 요약 이메일 발송 (Resend)
    resend_api_key: str = ""
    resend_from_email: str = "Preter <no-reply@preter.me>"

    class Config:
        env_file = ".env"


settings = Settings()
