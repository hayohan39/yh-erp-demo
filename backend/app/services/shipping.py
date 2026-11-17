"""출하: 출하요청 → 로지스팟 배차요청(IF-EXT-02) → 배차결과·상차출발 콜백 → 재고 차감, 수주 출하완료."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.interfaces import gateway
from app.interfaces.gateway import handles
from app.models import ItemBox, OrderAllocation, Partner, ProductStock, SalesOrder, Shipment, ShipmentLine, WorkOrder
from app.models._types import now
from app.services import events, inventory, ops_hooks
from app.services.planning import _next_no


def shippable_qty(db: Session, order: SalesOrder) -> dict[str, int]:
    """수주의 품목별 출하 가능 수량 = 완료된 생산지시의 양품."""
    out: dict[str, int] = {}
    for w in db.scalars(select(WorkOrder).where(WorkOrder.order_id == order.id, WorkOrder.status == "DONE")):
        out[w.item_code] = out.get(w.item_code, 0) + w.good_qty
    for a in db.scalars(select(OrderAllocation).where(OrderAllocation.order_id == order.id)):  # 수주전용
        out[a.item_code] = out.get(a.item_code, 0) + a.qty
    return out


def request_shipment(db: Session, order_no: str) -> Shipment:
    order = db.scalar(select(SalesOrder).where(SalesOrder.order_no == order_no))
    if not order:
        raise ValueError(f"수주 없음: {order_no}")
    if order.status != "PRODUCED":
        raise ValueError(f"생산완료 상태만 출하요청할 수 있습니다 (현재 {order.status})")
    qty = shippable_qty(db, order)
    customer = db.scalar(select(Partner).where(Partner.code == order.customer_code))
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    sh = Shipment(shipment_no=_next_no(db, Shipment, Shipment.shipment_no, "SH"), order_id=order.id,
                  customer_code=order.customer_code)
    sh.lines = [ShipmentLine(item_code=c, qty=q) for c, q in qty.items()]
    db.add(sh)
    order.status = "SHIPPING"
    db.commit()
    events.publish("shipment", {"shipment_no": sh.shipment_no, "order_no": order.order_no, "status": sh.status})
    events.publish("sales_order", {"order_no": order.order_no, "status": order.status})
    gateway.send(db, "IF-EXT-02", {
        "shipment_no": sh.shipment_no, "erp_order_no": order.order_no,
        "customer_name": customer.name if customer else order.customer_code,
        "due_date": order.due_date.isoformat(),
        "items": [{"item_code": ln.item_code, "item_name": items[ln.item_code].name, "qty": ln.qty} for ln in sh.lines],
        "total_qty": sum(qty.values()),
    })
    return sh


@handles("IF-EXT-02")
def logispot_callback(db: Session, p: dict[str, Any]) -> dict[str, Any]:
    """로지스팟 콜백. event=DISPATCHED(배차 확정) / SHIPPED(상차 완료·출발)."""
    sh = db.scalar(select(Shipment).options(selectinload(Shipment.lines))
                   .where(Shipment.shipment_no == p["shipment_no"]))
    if not sh:
        raise ValueError(f"출하 없음: {p['shipment_no']}")
    order = db.get(SalesOrder, sh.order_id)
    send: list = []
    if p["event"] == "DISPATCHED":
        carrier = db.scalar(select(Partner).where(Partner.code == p.get("carrier_code")))
        sh.status = "DISPATCHED"
        sh.carrier_code = p.get("carrier_code")
        sh.carrier_name = carrier.name if carrier else p.get("carrier_name")
        sh.vehicle_no, sh.driver_name, sh.driver_phone = p.get("vehicle_no"), p.get("driver_name"), p.get("driver_phone")
        sh.freight_amount = float(p.get("freight_amount") or 0)
        sh.dispatched_at = now()
    elif p["event"] == "SHIPPED":
        if sh.status == "SHIPPED":
            return {"shipment_no": sh.shipment_no}
        for ln in sh.lines:
            stock = db.scalar(select(ProductStock).where(ProductStock.item_code == ln.item_code))
            if not stock or stock.qty < ln.qty:
                raise ValueError(f"제품 재고 부족: {ln.item_code}")
            inventory.move(db, "PRODUCT", "OUT", ln.item_code, ln.qty, ref_no=sh.shipment_no, reason="출하")
        sh.status = "SHIPPED"
        sh.shipped_at = now()
        order.status = "SHIPPED"
        ops_hooks.on_shipped(db, sh, order)
        send.append(("IF-OMS-02", {"oms_order_no": order.oms_order_no, "erp_order_no": order.order_no,
                                   "status": "출하완료", "vehicle_no": sh.vehicle_no}))
    else:
        raise ValueError(f"알 수 없는 배차 이벤트: {p['event']}")
    db.flush()
    events.publish("shipment", {"shipment_no": sh.shipment_no, "order_no": order.order_no, "status": sh.status,
                                "vehicle_no": sh.vehicle_no, "qty": sum(ln.qty for ln in sh.lines)})
    events.publish("sales_order", {"order_no": order.order_no, "status": order.status})
    return {"shipment_no": sh.shipment_no, "_send": send}


def shipment_dict(db: Session, sh: Shipment, orders: dict[int, SalesOrder], partners: dict[str, str],
                  items: dict[str, str]) -> dict[str, Any]:
    o = orders.get(sh.order_id)
    return {
        "shipment_no": sh.shipment_no, "order_no": o.order_no if o else "", "customer_code": sh.customer_code,
        "customer_name": partners.get(sh.customer_code, sh.customer_code), "status": sh.status,
        "carrier_name": sh.carrier_name, "vehicle_no": sh.vehicle_no, "driver_name": sh.driver_name,
        "driver_phone": sh.driver_phone, "freight_amount": sh.freight_amount, "requested_at": sh.requested_at,
        "dispatched_at": sh.dispatched_at, "shipped_at": sh.shipped_at,
        "lines": [{"item_code": ln.item_code, "item_name": items.get(ln.item_code, ln.item_code), "qty": ln.qty}
                  for ln in sh.lines],
        "total_qty": sum(ln.qty for ln in sh.lines),
    }
