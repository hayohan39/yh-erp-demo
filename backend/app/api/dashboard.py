from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Defect, IfMessage, ProductionResult, SalesOrder, SchedulePlan, WorkOrder

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
    return {
        "month": month_start.strftime("%Y-%m"),
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
