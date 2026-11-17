import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401 - 테이블 등록
from app.api import dashboard, interface, master, production, quality, sales, scheduling, system
from app.config import settings
from app.db import Base, SessionLocal, engine, wait_for_db
from app.interfaces import handlers  # noqa: F401 - I/F 핸들러 등록
from app.seed import seed
from app.services import events

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    events.bind_loop(asyncio.get_running_loop())
    await asyncio.to_thread(wait_for_db, settings.db_connect_retries)
    Base.metadata.create_all(engine)
    if settings.seed_on_startup:
        with SessionLocal() as db:
            seed(db)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (system.router, interface.router, master.router, sales.router, scheduling.router, production.router,
          quality.router, dashboard.router):
    app.include_router(r)
