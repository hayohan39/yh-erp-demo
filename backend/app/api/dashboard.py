from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Defect, IfMessage, Partner, ProductionResult, SalesOrder, SchedulePlan, Shipment, TaxInvoice, WorkOrder
from app.services import costing

router = APIRouter(prefix="/api/dashboard", tags=["경영정보"])


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    """경영 대시보드 KPI. 출하·매출·원가는 해당 모듈이 붙으면 채운다."""
    month_start = date.today().replace(day=1)
    order_cnt, order_amt = db.execute(
        select(func.count(), func.coalesce(func.sum(SalesOrder.total_amount), 0)).where(
            SalesOrder.order_date >= month_start
        )
    ).one()
    status_rows = db.execute(select(SalesOrder.status, func.count()).group_by(SalesOrder.status)).all()
    if_rows = db.execute(select(IfMessage.status, func.count()).group_by(IfMessage.status)).all()
    # 최종 공정(가공) 양품을 생산량으로 본다
    good, _ = db.execute(
        select(func.coalesce(func.sum(ProductionResult.good_qty), 0),
               func.coalesce(func.sum(ProductionResult.defect_qty), 0))
        .where(ProductionResult.process == "CONVERT")
    ).one()
    all_good, all_bad = db.execute(
        select(func.coalesce(func.sum(ProductionResult.good_qty), 0),
               func.coalesce(func.sum(ProductionResult.defect_qty), 0))
    ).one()
    saved = db.execute(
        select(func.coalesce(func.sum(SchedulePlan.saved_amount), 0),
               func.coalesce(func.sum(SchedulePlan.saved_paper_kg), 0))
        .where(SchedulePlan.status == "CONFIRMED")
    ).one()
    inv_supply, inv_cnt = db.execute(
        select(func.coalesce(func.sum(TaxInvoice.supply_amount), 0), func.count())
        .where(TaxInvoice.status == "ISSUED")).one()
    shipped = db.execute(select(func.count(), func.coalesce(func.sum(Shipment.freight_amount), 0))
                         .where(Shipment.status == "SHIPPED")).one()
    costs = [c for c in costing.cost_list(db) if c["sales"]]
    sales_sum = sum(c["sales"] for c in costs)
    return {
        "month": month_start.strftime("%Y-%m"),
        "sales": {"invoiced_amount": float(inv_supply), "invoices": inv_cnt},
        "shipping": {"shipped": shipped[0], "freight": float(shipped[1]),
                     "in_progress": db.scalar(select(func.count()).select_from(Shipment)
                                              .where(Shipment.status != "SHIPPED"))},
        "cost": {
            "orders": len(costs),
            "cost_rate": sum(c["act_cost"] for c in costs) / sales_sum if sales_sum else None,
            "profit": sum(c["profit"] for c in costs),
            "variance": sum(c["variance"] for c in costs),
        },
        "orders": {"count": order_cnt, "amount": float(order_amt)},
        "order_status": {s: c for s, c in status_rows},
        "production": {
            "good_qty": int(good),
            "defect_rate": float(all_bad) / float(all_good + all_bad) if all_good + all_bad else 0,
            "work_orders_open": db.scalar(select(func.count()).select_from(WorkOrder).where(WorkOrder.status != "DONE")),
            "work_orders_done": db.scalar(select(func.count()).select_from(WorkOrder).where(WorkOrder.status == "DONE")),
        },
        "scheduling": {"saved_amount": float(saved[0]), "saved_paper_kg": float(saved[1])},
        "defects_open": db.scalar(select(func.count()).select_from(Defect).where(Defect.status == "OPEN")),
        "interfaces": {status: cnt for status, cnt in if_rows},
    }


# 시뮬레이터 창의 테스트 사이클: 수주 상태 → 단계. 단계 키는 프런트(SimulatorDock)와 맞춘다.
CYCLE_STAGE = {
    "RECEIVED": "order", "PLANNED": "production", "IN_PROD": "production", "PRODUCED": "ship_request",
    "SHIPPING": "delivery", "SHIPPED": "close", "INVOICING": "invoice", "CLOSED": "done",
}


@router.get("/cycle")
def cycle(order_no: str | None = None, db: Session = Depends(get_db)):
    """시뮬레이터 창: 단계별 수주 건수, 추적할 수 있는 최근 수주, 추적 수주의 진행 상세."""
    stages: dict[str, int] = {}
    for s, c in db.execute(select(SalesOrder.status, func.count()).group_by(SalesOrder.status)).all():
        k = CYCLE_STAGE.get(s)
        if k:
            stages[k] = stages.get(k, 0) + c
    partners = {p.code: p.name for p in db.scalars(select(Partner))}

    def brief(o: SalesOrder) -> dict:
        return {"order_no": o.order_no, "customer_name": partners.get(o.customer_code, o.customer_code),
                "status": o.status, "stage": CYCLE_STAGE.get(o.status), "total_amount": o.total_amount,
                "created_at": o.created_at}

    open_q = select(SalesOrder).where(SalesOrder.status != "CLOSED").order_by(SalesOrder.id.desc()).limit(30)
    done_q = select(SalesOrder).where(SalesOrder.status == "CLOSED").order_by(SalesOrder.id.desc()).limit(5)
    orders = [brief(o) for o in db.scalars(open_q)] + [brief(o) for o in db.scalars(done_q)]

    focus = None
    o = db.scalar(select(SalesOrder).where(SalesOrder.order_no == order_no)) if order_no else None
    if o:
        wos = list(db.scalars(select(WorkOrder).where(WorkOrder.order_id == o.id)))
        sh = db.scalar(select(Shipment).where(Shipment.order_id == o.id).order_by(Shipment.id.desc()))
        inv = db.scalar(select(TaxInvoice).where(TaxInvoice.order_id == o.id).order_by(TaxInvoice.id.desc()))
        focus = {
            **brief(o),
            "qty": sum(ln.qty for ln in o.lines), "due_date": o.due_date,
            "work_orders": {"total": len(wos), "done": sum(w.status == "DONE" for w in wos),
                            "in_prod": sum(w.status == "IN_PROD" for w in wos)},
            "shipment": sh and {"shipment_no": sh.shipment_no, "status": sh.status, "vehicle_no": sh.vehicle_no,
                                "carrier_name": sh.carrier_name},
            "invoice": inv and {"invoice_no": inv.invoice_no, "status": inv.status,
                                "nts_approval_no": inv.nts_approval_no, "total_amount": inv.total_amount},
        }
    return {
        "stages": stages,
        "orders": orders,
        "focus": focus,
        "defects_open": db.scalar(select(func.count()).select_from(Defect).where(Defect.status == "OPEN")),
    }
