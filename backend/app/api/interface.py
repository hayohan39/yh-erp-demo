from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.interfaces import gateway
from app.interfaces.catalog import IF_CATALOG
from app.models import IfMessage

router = APIRouter(prefix="/api/if", tags=["I/F 게이트웨이"])


@router.get("/catalog")
def catalog(db: Session = Depends(get_db)):
    """I/F 18종과 각 I/F의 상태별 건수 (I/F 모니터 상단 표)."""
    rows = db.execute(
        select(IfMessage.if_id, IfMessage.status, func.count()).group_by(IfMessage.if_id, IfMessage.status)
    ).all()
    counts: dict[str, dict[str, int]] = {}
    for if_id, status, cnt in rows:
        counts.setdefault(if_id, {})[status] = cnt
    return [{**d.__dict__, "counts": counts.get(d.if_id, {})} for d in IF_CATALOG]


@router.post("/inbound")
def inbound(env: gateway.Envelope, db: Session = Depends(get_db)):
    """레거시(데모에서는 시뮬레이터) → ERP 수신 엔드포인트."""
    try:
        msg, duplicate, result = gateway.receive(db, env)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "message_id": msg.message_id,
        "status": msg.status,
        "duplicate": duplicate,
        "error": msg.error_msg,
        "result": result,
    }


@router.get("/messages")
def list_messages(
    if_id: str | None = None,
    status: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    q = select(IfMessage).order_by(IfMessage.id.desc()).limit(min(limit, 1000))
    if if_id:
        q = q.where(IfMessage.if_id == if_id)
    if status:
        q = q.where(IfMessage.status == status)
    return [gateway.message_to_dict(m) for m in db.scalars(q)]


@router.get("/messages/{msg_id}")
def get_message(msg_id: int, db: Session = Depends(get_db)):
    m = db.get(IfMessage, msg_id)
    if not m:
        raise HTTPException(404)
    return gateway.message_to_dict(m, with_payload=True)


@router.post("/messages/{msg_id}/retry")
def retry_message(msg_id: int, db: Session = Depends(get_db)):
    m = db.get(IfMessage, msg_id)
    if not m:
        raise HTTPException(404)
    if m.status not in ("FAILED",):
        raise HTTPException(400, "실패 건만 재처리할 수 있습니다")
    gateway.retry(db, m)
    return gateway.message_to_dict(m)
