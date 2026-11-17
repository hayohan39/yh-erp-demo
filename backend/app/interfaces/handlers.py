"""수신 I/F 핸들러. 모듈이 늘어나면 I/F별로 여기에 추가한다."""
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.interfaces.gateway import handles
from app.models import ItemBox, Partner, SalesOrder, SalesOrderLine
from app.services import events


def _next_order_no(db: Session, d: date) -> str:
    prefix = f"SO{d:%y%m%d}"
    count = db.scalar(select(func.count()).where(SalesOrder.order_no.like(f"{prefix}%"))) or 0
    return f"{prefix}{count + 1:04d}"


@handles("IF-OMS-01")
def oms_order_received(db: Session, p: dict[str, Any]) -> dict[str, Any]:
    """OMS 주문접수 → ERP 수주 등록 후 OMS에 진도(수주확정)를 회신."""
    customer = db.scalar(select(Partner).where(Partner.code == p["customer_code"]))
    if not customer:
        raise ValueError(f"미등록 거래처: {p['customer_code']}")
    if db.scalar(select(SalesOrder).where(SalesOrder.oms_order_no == p["oms_order_no"])):
        raise ValueError(f"이미 수주된 OMS 주문: {p['oms_order_no']}")

    order_date = date.fromisoformat(p.get("order_date") or date.today().isoformat())
    order = SalesOrder(
        order_no=_next_order_no(db, order_date),
        oms_order_no=p["oms_order_no"],
        customer_code=customer.code,
        order_date=order_date,
        due_date=date.fromisoformat(p["due_date"]),
        status="RECEIVED",
    )
    total = 0.0
    for i, line in enumerate(p["lines"], start=1):
        item = db.scalar(select(ItemBox).where(ItemBox.code == line["item_code"]))
        if not item:
            raise ValueError(f"미등록 품목: {line['item_code']}")
        price = float(line.get("unit_price") or item.unit_price)
        amount = price * int(line["qty"])
        total += amount
        order.lines.append(
            SalesOrderLine(line_no=i, item_code=item.code, qty=int(line["qty"]), unit_price=price, amount=amount)
        )
    order.total_amount = total
    db.add(order)
    db.flush()
    events.publish(
        "sales_order",
        {"order_no": order.order_no, "customer_code": order.customer_code, "total_amount": total},
    )
    return {
        "order_no": order.order_no,
        "_send": [
            ("IF-OMS-02", {"oms_order_no": order.oms_order_no, "erp_order_no": order.order_no, "status": "수주확정"})
        ],
    }
