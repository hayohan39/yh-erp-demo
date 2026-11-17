from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Equipment, ItemBox, SalesOrder, WorkOrder

router = APIRouter(prefix="/api/production", tags=["생산관리"])


def _wo(w: WorkOrder, order_no: str, item_name: str) -> dict:
    return {
        "wo_no": w.wo_no, "order_no": order_no, "item_code": w.item_code, "item_name": item_name,
        "board_spec": w.board_spec_code, "qty": w.qty, "good_qty": w.good_qty, "status": w.status,
        "created_at": w.created_at, "completed_at": w.completed_at,
        "routes": [{"seq": r.seq, "process": r.process, "equipment_code": r.equipment_code, "status": r.status,
                    "good_qty": r.good_qty, "defect_qty": r.defect_qty} for r in w.routes],
    }


@router.get("/work-orders")
def work_orders(db: Session = Depends(get_db)):
    orders = {o.id: o.order_no for o in db.scalars(select(SalesOrder))}
    items = {i.code: i.name for i in db.scalars(select(ItemBox))}
    q = select(WorkOrder).options(selectinload(WorkOrder.routes)).order_by(WorkOrder.id.desc())
    return [_wo(w, orders.get(w.order_id, ""), items.get(w.item_code, "")) for w in db.scalars(q)]


@router.get("/board")
def board(db: Session = Depends(get_db)):
    """공정 진도 보드: 설비별 대기·진행·완료 생산지시."""
    items = {i.code: i.name for i in db.scalars(select(ItemBox))}
    wos = list(db.scalars(select(WorkOrder).options(selectinload(WorkOrder.routes)).order_by(WorkOrder.id)))
    out = []
    for eq in db.scalars(select(Equipment).order_by(Equipment.id)):
        cols: dict[str, list] = {"WAIT": [], "RUN": [], "DONE": []}
        for w in wos:
            for r in w.routes:
                if r.equipment_code != eq.code:
                    continue
                cols[r.status].append({"wo_no": w.wo_no, "item_name": items.get(w.item_code, w.item_code),
                                     "qty": w.qty, "good_qty": r.good_qty, "defect_qty": r.defect_qty})
        out.append({"equipment_code": eq.code, "name": eq.name, "process": eq.process,
                    "legacy_system": eq.legacy_system, **{k.lower(): v for k, v in cols.items()}})
    return out
