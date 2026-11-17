import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import engine, get_db
from app.seed import reset_all
from app.services import events

router = APIRouter(prefix="/api", tags=["시스템"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    probe = "SELECT 1 FROM DUAL" if engine.dialect.name == "oracle" else "SELECT 1"
    db.execute(text(probe))
    return {"status": "ok", "app": settings.app_name, "db": engine.dialect.name}


@router.post("/admin/reset")
def reset(db: Session = Depends(get_db)):
    """데모 초기화 버튼: 모든 데이터를 지우고 기준정보를 다시 적재."""
    reset_all(db)
    events.publish("reset", {})
    return {"status": "reset"}


@router.get("/events")
async def stream(request: Request):
    """SSE: I/F 수신, 수주 등록 등 실시간 이벤트."""
    q = events.subscribe()

    async def gen():
        try:
            yield "event: hello\ndata: {}\n\n"
            while not await request.is_disconnected():
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            events.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
