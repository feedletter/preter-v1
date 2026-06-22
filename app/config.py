from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    port: int = 8000

    google_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    gcs_bucket_name: str = ""
    gcp_project_id: str = ""
    jwt_secret: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
