from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import PROJECT_ROOT
from .routers.devices import router as devices_router
from .routers.groups import router as groups_router
from .routers.moods import router as moods_router
from .routers.schedules import router as schedules_router
from .services.discovery import start_background_discovery, stop_background_discovery
from .services.scheduler_runtime import MOOD_SCHEDULER


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    start_background_discovery()
    MOOD_SCHEDULER.start()
    try:
        yield
    finally:
        MOOD_SCHEDULER.stop()
        stop_background_discovery()


app = FastAPI(lifespan=lifespan)

app.include_router(devices_router, prefix="/api", tags=["devices"])
app.include_router(groups_router, prefix="/api", tags=["groups"])
app.include_router(moods_router, prefix="/api", tags=["moods"])
app.include_router(schedules_router, prefix="/api", tags=["schedules"])


FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
