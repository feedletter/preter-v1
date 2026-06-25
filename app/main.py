from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.admin import setup_admin
from app.config import settings
from app.routers import auth, documents, guest, health, meetings, projects, reports, rooms, users, ws

app = FastAPI(title="Preter Backend", version="0.1.0")

# 라이브 세션 헤드리스 오디오 엔진(live-engine.html)을 HTTPS로 서빙한다.
# getUserMedia는 "보안 컨텍스트"(https/localhost)에서만 노출되는데, RN WebView가
# require()로 번들된 file:// 로컬 에셋을 로드하면 navigator.mediaDevices 자체가
# undefined가 되어 마이크 캡처가 항상 조용히 실패한다 — 그래서 백엔드가 직접 서빙한다.
app.mount("/static", StaticFiles(directory="app/static"), name="static")

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
