from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import ItemBox, Partner, ProductStock, SalesOrder, Shipment
from app.services import shipping

router = APIRouter(prefix="/api/shipping", tags=["출하관리"])


class RequestIn(BaseModel):
    order_no: str


def _maps(db: Session):
    return ({o.id: o for o in db.scalars(select(SalesOrder))}, {p.code: p.name for p in db.scalars(select(Partner))},
            {i.code: i.name for i in db.scalars(select(ItemBox))})


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    """출하요청 대기: 생산완료 수주와 출하 가능 수량."""
    _, partners, items = _maps(db)
    out = []
    for o in db.scalars(select(SalesOrder).where(SalesOrder.status == "PRODUCED").order_by(SalesOrder.id)):
        qty = shipping.shippable_qty(db, o)
        out.append({"order_no": o.order_no, "customer_name": partners.get(o.customer_code, o.customer_code),
                    "due_date": o.due_date, "total_amount": o.total_amount,
                    "items": [{"item_code": c, "item_name": items.get(c, c), "qty": q} for c, q in qty.items()],
                    "total_qty": sum(qty.values())})
    return out


@router.post("/requests")
def create_request(body: RequestIn, db: Session = Depends(get_db)):
    try:
        sh = shipping.request_shipment(db, body.order_no)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"shipment_no": sh.shipment_no}


@router.get("/shipments")
def shipments(db: Session = Depends(get_db)):
    orders, partners, items = _maps(db)
    q = select(Shipment).options(selectinload(Shipment.lines)).order_by(Shipment.id.desc())
    return [shipping.shipment_dict(db, s, orders, partners, items) for s in db.scalars(q)]


@router.get("/stock")
def stock(db: Session = Depends(get_db)):
    items = {i.code: i.name for i in db.scalars(select(ItemBox))}
    return [{"item_code": s.item_code, "item_name": items.get(s.item_code, s.item_code), "qty": s.qty}
            for s in db.scalars(select(ProductStock).order_by(ProductStock.item_code))]
