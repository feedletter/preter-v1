from fastapi import FastAPI

from app.admin import setup_admin
from app.config import settings
from app.routers import auth, health, ws

app = FastAPI(title="Preter Backend", version="0.1.0")

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(ws.router)

if settings.database_url:
    # DATABASE_URL이 없는 환경(예: 일부 테스트)에서는 어드민을 건너뛴다.
    setup_admin(app)


@app.get("/")
async def root():
    return {"service": "preter-backend", "environment": settings.environment}
