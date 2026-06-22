from fastapi import FastAPI

from app.config import settings
from app.routers import health, ws

app = FastAPI(title="Preter Backend", version="0.1.0")

app.include_router(health.router)
app.include_router(ws.router)


@app.get("/")
async def root():
    return {"service": "preter-backend", "environment": settings.environment}
