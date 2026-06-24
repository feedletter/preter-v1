from fastapi import FastAPI

from app.admin import setup_admin
from app.config import settings
from app.routers import auth, documents, guest, health, meetings, projects, reports, rooms, users, ws

app = FastAPI(title="Preter Backend", version="0.1.0")

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(ws.router)
app.include_router(rooms.router)
app.include_router(guest.router)
app.include_router(meetings.router)
app.include_router(users.router)
app.include_router(reports.router)
app.include_router(projects.router)
app.include_router(documents.router)

if settings.database_url:
    # DATABASE_URL이 없는 환경(예: 일부 테스트)에서는 어드민을 건너뛴다.
    setup_admin(app)


@app.get("/")
async def root():
    return {"service": "preter-backend", "environment": settings.environment}
