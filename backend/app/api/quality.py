from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Defect, ItemBox
from app.models._types import now
from app.services import events

router = APIRouter(prefix="/api/quality", tags=["품질관리"])


@router.get("/defects")
def defects(db: Session = Depends(get_db)):
    items = {i.code: i.name for i in db.scalars(select(ItemBox))}
    return [
        {c.name: getattr(d, c.name) for c in Defect.__table__.columns} | {"item_name": items.get(d.item_code)}
        for d in db.scalars(select(Defect).order_by(Defect.id.desc()))
    ]


class ActionIn(BaseModel):
    cause: str
    action_text: str


@router.post("/defects/{defect_no}/action")
def register_action(defect_no: str, body: ActionIn, db: Session = Depends(get_db)):
    d = db.scalar(select(Defect).where(Defect.defect_no == defect_no))
    if not d:
        raise HTTPException(404)
    d.cause, d.action_text, d.status, d.closed_at = body.cause, body.action_text, "CLOSED", now()
    db.commit()
    events.publish("defect_closed", {"defect_no": defect_no})
    return {"defect_no": defect_no, "status": d.status}
