"""I/F 게이트웨이: 레거시(또는 시뮬레이터)와 ERP 사이의 유일한 통로.

- 수신: 공통 봉투를 if_message에 기록하고, message_id로 중복을 막은 뒤 핸들러를 실행한다.
- 송신: if_message에 OUT으로 기록하고 상대 시스템(데모에서는 시뮬레이터)으로 보낸다.
ERP는 상대가 시뮬레이터인지 실제 레거시인지 모른다. 본 구축 때는 송신 대상 URL만 바꾼다.
"""
import json
import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

import httpx
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.interfaces.catalog import IF_BY_ID
from app.models import IfMessage
from app.models._types import now
from app.services import events

log = logging.getLogger(__name__)


class Envelope(BaseModel):
    if_id: str
    message_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    source: str
    target: str = "ERP"
    sent_at: datetime | None = None
    payload: dict[str, Any]


Handler = Callable[[Session, dict[str, Any]], dict[str, Any] | None]
_handlers: dict[str, Handler] = {}


def handles(if_id: str):
    def deco(fn: Handler) -> Handler:
        _handlers[if_id] = fn
        return fn

    return deco


def _to_dict(m: IfMessage) -> dict[str, Any]:
    return {
        "id": m.id,
        "message_id": m.message_id,
        "if_id": m.if_id,
        "direction": m.direction,
        "source": m.source,
        "target": m.target,
        "status": m.status,
        "error_msg": m.error_msg,
        "retry_count": m.retry_count,
        "created_at": m.created_at,
        "processed_at": m.processed_at,
    }


def message_to_dict(m: IfMessage, with_payload: bool = False) -> dict[str, Any]:
    d = _to_dict(m)
    if with_payload:
        d["payload"] = json.loads(m.payload)
    return d


def _run_handler(db: Session, msg: IfMessage) -> dict[str, Any] | None:
    handler = _handlers.get(msg.if_id)
    result = None
    try:
        if handler:
            result = handler(db, json.loads(msg.payload))
        msg.status = "PROCESSED"
        msg.error_msg = None
    except Exception as exc:  # noqa: BLE001 - 실패 건은 I/F 모니터에서 재처리
        db.rollback()
        db.add(msg)
        msg.status = "FAILED"
        msg.error_msg = str(exc)[:2000]
        log.warning("I/F 처리 실패 %s %s: %s", msg.if_id, msg.message_id, exc)
    msg.processed_at = now()
    db.commit()
    events.publish("if_message", _to_dict(msg))
    # 핸들러가 요청한 후속 송신은 수신 트랜잭션이 커밋된 뒤에 보낸다.
    if msg.status == "PROCESSED" and result:
        for out_if_id, out_payload in result.pop("_send", []):
            send(db, out_if_id, out_payload)
    return result


def receive(db: Session, env: Envelope) -> tuple[IfMessage, bool, dict[str, Any] | None]:
    """수신 처리. (메시지, 중복 여부, 핸들러 결과)를 돌려준다."""
    if env.if_id not in IF_BY_ID or IF_BY_ID[env.if_id].direction != "IN":
        raise ValueError(f"수신 I/F가 아닙니다: {env.if_id}")
    existing = db.scalar(select(IfMessage).where(IfMessage.message_id == env.message_id))
    if existing:
        return existing, True, None
    msg = IfMessage(
        message_id=env.message_id,
        if_id=env.if_id,
        direction="IN",
        source=env.source,
        target=env.target,
        status="RECEIVED",
        payload=json.dumps(env.payload, ensure_ascii=False, default=str),
        sent_at=env.sent_at.replace(tzinfo=None) if env.sent_at else None,
    )
    db.add(msg)
    db.commit()
    result = _run_handler(db, msg)
    return msg, False, result


def retry(db: Session, msg: IfMessage) -> IfMessage:
    msg.retry_count += 1
    db.commit()  # 핸들러 실패 시 rollback 되어도 재시도 횟수는 남긴다
    if msg.direction == "IN":
        _run_handler(db, msg)
    else:
        _deliver(db, msg)
    return msg


def send(db: Session, if_id: str, payload: dict[str, Any]) -> IfMessage:
    """ERP → 레거시 송신."""
    d = IF_BY_ID[if_id]
    if d.direction != "OUT":
        raise ValueError(f"송신 I/F가 아닙니다: {if_id}")
    msg = IfMessage(
        message_id=uuid.uuid4().hex,
        if_id=if_id,
        direction="OUT",
        source="ERP",
        target=d.system,
        status="RECEIVED",
        payload=json.dumps(payload, ensure_ascii=False, default=str),
        sent_at=now(),
    )
    db.add(msg)
    db.commit()
    _deliver(db, msg)
    return msg


def _deliver(db: Session, msg: IfMessage) -> None:
    body = {
        "if_id": msg.if_id,
        "message_id": msg.message_id,
        "source": "ERP",
        "target": msg.target,
        "sent_at": msg.sent_at.isoformat() if msg.sent_at else None,
        "payload": json.loads(msg.payload),
    }
    if not settings.legacy_outbound_url:
        msg.status = "SENT"  # 송신 대상 미설정(테스트 등): 기록만 한다
    else:
        try:
            r = httpx.post(settings.legacy_outbound_url, json=body, timeout=5)
            r.raise_for_status()
            msg.status = "SENT"
            msg.error_msg = None
        except Exception as exc:  # noqa: BLE001
            msg.status = "FAILED"
            msg.error_msg = str(exc)[:2000]
    msg.processed_at = now()
    db.commit()
    events.publish("if_message", _to_dict(msg))
