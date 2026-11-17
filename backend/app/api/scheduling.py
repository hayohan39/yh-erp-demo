from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import CorrugatorRun, Partner, SalesOrder, SalesOrderLine, SchedulePlan
from app.services import planning

router = APIRouter(prefix="/api/scheduling", tags=["스케쥴링"])


def _plan(db: Session, p: SchedulePlan) -> dict:
    line_ids = {s.order_line_id for r in p.runs for s in r.slots}
    lines = {ln.id: ln for ln in db.scalars(select(SalesOrderLine).where(SalesOrderLine.id.in_(line_ids)))}
    orders = {o.id: o for o in db.scalars(select(SalesOrder).where(
        SalesOrder.id.in_({ln.order_id for ln in lines.values()})))}
    names = {pt.code: pt.name for pt in db.scalars(select(Partner))}

    def slot(s):
        o = orders[lines[s.order_line_id].order_id]
        return {"item_code": s.item_code, "ups": s.ups, "blank_w": s.blank_w, "blank_l": s.blank_l,
                "sheets": s.sheets, "order_no": o.order_no, "customer_name": names.get(o.customer_code)}

    return {
        "plan_no": p.plan_no, "status": p.status, "order_count": p.order_count,
        "area_m2": p.area_m2, "trim_rate": p.trim_rate,
        "manual_area_m2": p.manual_area_m2, "manual_trim_rate": p.manual_trim_rate,
        "saved_paper_kg": p.saved_paper_kg, "saved_amount": p.saved_amount,
        "created_at": p.created_at, "confirmed_at": p.confirmed_at,
        "runs": [
            {"seq": r.seq, "board_spec": r.board_spec_code, "roll_width": r.roll_width, "cuts": r.cuts,
             "length_m": r.length_m, "trim_mm": r.trim_mm, "trim_rate": r.trim_rate,
             "slots": [slot(s) for s in r.slots]}
            for r in p.runs
        ],
    }


def _load(db: Session, plan_no: str | None = None) -> SchedulePlan | None:
    q = select(SchedulePlan).options(selectinload(SchedulePlan.runs).selectinload(CorrugatorRun.slots))
    q = q.where(SchedulePlan.plan_no == plan_no) if plan_no else q.order_by(SchedulePlan.id.desc()).limit(1)
    return db.scalar(q)


@router.get("/pending-orders")
def pending(db: Session = Depends(get_db)):
    """스케쥴링 대기 수주 (수주접수 상태)."""
    q = select(SalesOrder).options(selectinload(SalesOrder.lines)).where(SalesOrder.status == "RECEIVED")
    return [{"order_no": o.order_no, "customer_code": o.customer_code, "due_date": o.due_date,
             "lines": len(o.lines), "qty": sum(ln.qty for ln in o.lines)} for o in db.scalars(q)]


@router.post("/plans")
def create(db: Session = Depends(get_db)):
    try:
        p = planning.create_plan(db)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _plan(db, _load(db, p.plan_no))


@router.get("/plans/latest")
def latest(db: Session = Depends(get_db)):
    p = _load(db)
    return _plan(db, p) if p else None


@router.post("/plans/{plan_no}/confirm")
def confirm(plan_no: str, db: Session = Depends(get_db)):
    p = _load(db, plan_no)
    if not p:
        raise HTTPException(404)
    try:
        wos = planning.confirm_plan(db, p)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"plan_no": plan_no, "work_orders": [w.wo_no for w in wos]}
