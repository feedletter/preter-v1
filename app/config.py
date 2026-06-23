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

    class Config:
        env_file = ".env"


settings = Settings()
