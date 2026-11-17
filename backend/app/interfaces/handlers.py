"""수신 I/F 핸들러. 모듈이 늘어나면 I/F별로 여기에 추가한다."""
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.interfaces.gateway import handles
from app.models import (
    Defect, ItemBox, PaperUsage, Partner, ProductionResult, SalesOrder, SalesOrderLine, WorkOrder,
)
from app.models._types import now
from app.services import events, inventory, ops_hooks


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


# ---------------------------------------------------------------- 생산 실적
DEFECT_ALERT_RATE = 0.03
PROCESS_NAME = {"CORRUGATE": "골판지기", "PRINT": "인쇄", "CONVERT": "가공"}


def _wo(db: Session, wo_no: str):

    wo = db.scalar(select(WorkOrder).where(WorkOrder.wo_no == wo_no))
    if not wo:
        raise ValueError(f"미등록 생산지시: {wo_no}")
    return wo


def _equipment_result(db: Session, p: dict[str, Any]) -> dict[str, Any]:
    """설비 실적·가동상태(골게터 POP·인쇄 5호기·에볼/썬라이즈 공통).

    event=START: 공정 시작(가동), event=END(기본): 실적 수신 → 공정 완료, 불량률 초과 시 불량 등록.
    """
    wo = _wo(db, p["wo_no"])
    route = next((r for r in wo.routes if r.process == p["process"]), None)
    if not route:
        raise ValueError(f"{wo.wo_no}에 {p['process']} 공정이 없습니다")
    send: list = []
    if wo.status == "ISSUED":
        wo.status = "IN_PROD"
        order = db.get(SalesOrder, wo.order_id)
        if order.status == "PLANNED":
            order.status = "IN_PROD"
            send.append(("IF-OMS-02", {"oms_order_no": order.oms_order_no, "erp_order_no": order.order_no,
                                       "status": "생산중"}))
    if p.get("event") == "START":  # 가동상태: 작업 시작
        route.status = "RUN"
        route.started_at = now()
        events.publish("production", {"wo_no": wo.wo_no, "process": route.process, "event": "START"})
        return {"wo_no": wo.wo_no, "_send": send}

    good, bad = int(p["good_qty"]), int(p["defect_qty"])
    route.input_qty, route.good_qty, route.defect_qty = good + bad, good, bad
    route.status = "DONE"
    route.ended_at = now()
    db.add(ProductionResult(wo_no=wo.wo_no, process=route.process, equipment_code=route.equipment_code,
                            good_qty=good, defect_qty=bad, run_minutes=float(p.get("run_minutes", 0))))
    rate = bad / (good + bad) if good + bad else 0
    if rate >= DEFECT_ALERT_RATE:
        n = (db.scalar(select(func.count()).select_from(Defect)) or 0) + 1
        d = Defect(defect_no=f"DF{date.today():%y%m%d}{n:03d}", wo_no=wo.wo_no, item_code=wo.item_code,
                   process=route.process, equipment_code=route.equipment_code, defect_qty=bad,
                   defect_rate=round(rate, 4), defect_type=p.get("defect_type") or "기타")
        db.add(d)
        db.flush()
        events.publish("defect", {"defect_no": d.defect_no, "wo_no": wo.wo_no,
                                  "process": PROCESS_NAME.get(route.process, route.process),
                                  "equipment_code": route.equipment_code, "defect_type": d.defect_type,
                                  "defect_rate": d.defect_rate})
    events.publish("production", {"wo_no": wo.wo_no, "process": route.process})
    return {"wo_no": wo.wo_no, "_send": send}


for _if in ("IF-EQ-02", "IF-EQ-04", "IF-EQ-06"):
    handles(_if)(_equipment_result)


@handles("IF-PMS-01")
def pms_paper_used(db: Session, p: dict[str, Any]) -> None:
    """원지 투입(롤 단위) → 원가 재료비 근거."""
    wo = _wo(db, p["wo_no"])
    for r in p["rolls"]:
        db.add(PaperUsage(wo_no=wo.wo_no, roll_no=r["roll_no"], paper_code=r["paper_code"],
                          used_kg=float(r["used_kg"])))
        inventory.move(db, "PAPER", "OUT", r["paper_code"], float(r["used_kg"]), ref_no=wo.wo_no,
                       reason=f"골게터 투입 {r['roll_no']}")


@handles("IF-EXT-04")
def autocon_transferred(db: Session, p: dict[str, Any]) -> None:
    """오토콘 원단 이송 완료 → 다음 공정 투입 가능 표시."""
    wo = _wo(db, p["wo_no"])
    nxt = next((r for r in wo.routes if r.process != "CORRUGATE" and r.status == "WAIT"), None)
    events.publish("production", {"wo_no": wo.wo_no, "process": "TRANSFER", "sheets": p.get("sheets"),
                                  "next_process": nxt.process if nxt else None})


@handles("IF-MES-02")
def mes_completed(db: Session, p: dict[str, Any]) -> dict[str, Any]:
    """MES 완료보고 → 생산지시 완료, 제품 재고 입고, 수주의 모든 지시가 끝나면 생산완료."""
    wo = _wo(db, p["wo_no"])
    if wo.status == "DONE":
        return {"wo_no": wo.wo_no}
    if any(r.status != "DONE" for r in wo.routes):
        raise ValueError(f"{wo.wo_no}: 완료되지 않은 공정이 있습니다")
    wo.good_qty = wo.routes[-1].good_qty
    wo.status = "DONE"
    wo.completed_at = now()
    if wo.good_qty > 0:
        inventory.move(db, "PRODUCT", "IN", wo.item_code, wo.good_qty, to_wh="FG1", ref_no=wo.wo_no,
                       reason="생산 입고")
    ops_hooks.on_work_order_done(db, wo)
    db.flush()
    send: list = []
    order = db.get(SalesOrder, wo.order_id)
    pending = db.scalar(select(func.count()).select_from(WorkOrder).where(
        WorkOrder.order_id == order.id, WorkOrder.status != "DONE"))
    if not pending:
        order.status = "PRODUCED"
        send.append(("IF-OMS-02", {"oms_order_no": order.oms_order_no, "erp_order_no": order.order_no,
                                   "status": "생산완료"}))
    events.publish("production", {"wo_no": wo.wo_no, "process": "DONE"})
    events.publish("sales_order", {"order_no": order.order_no, "status": order.status})
    return {"wo_no": wo.wo_no, "_send": send}
