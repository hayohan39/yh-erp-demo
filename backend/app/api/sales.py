from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Partner, SalesOrder

router = APIRouter(prefix="/api/sales", tags=["영업관리"])


def _order(o: SalesOrder, names: dict[str, str], lines: bool = False) -> dict:
    d = {
        "id": o.id,
        "order_no": o.order_no,
        "oms_order_no": o.oms_order_no,
        "customer_code": o.customer_code,
        "customer_name": names.get(o.customer_code, o.customer_code),
        "order_date": o.order_date,
        "due_date": o.due_date,
        "status": o.status,
        "total_amount": o.total_amount,
        "line_count": len(o.lines),
    }
    if lines:
        d["lines"] = [
            {"line_no": ln.line_no, "item_code": ln.item_code, "qty": ln.qty,
             "unit_price": ln.unit_price, "amount": ln.amount}
            for ln in o.lines
        ]
    return d


def _names(db: Session) -> dict[str, str]:
    return {p.code: p.name for p in db.scalars(select(Partner))}


@router.get("/orders")
def orders(db: Session = Depends(get_db)):
    names = _names(db)
    q = select(SalesOrder).options(selectinload(SalesOrder.lines)).order_by(SalesOrder.id.desc())
    return [_order(o, names) for o in db.scalars(q)]


@router.get("/orders/{order_no}")
def order_detail(order_no: str, db: Session = Depends(get_db)):
    o = db.scalar(
        select(SalesOrder).options(selectinload(SalesOrder.lines)).where(SalesOrder.order_no == order_no)
    )
    if not o:
        raise HTTPException(404)
    return _order(o, _names(db), lines=True)
