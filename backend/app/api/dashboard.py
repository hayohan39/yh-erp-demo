from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Equipment, IfMessage, SalesOrder

router = APIRouter(prefix="/api/dashboard", tags=["경영정보"])


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    """경영 대시보드 KPI. 생산·매출·원가는 해당 모듈이 붙으면 채운다."""
    month_start = date.today().replace(day=1)
    order_cnt, order_amt = db.execute(
        select(func.count(), func.coalesce(func.sum(SalesOrder.total_amount), 0)).where(
            SalesOrder.order_date >= month_start
        )
    ).one()
    if_rows = db.execute(select(IfMessage.status, func.count()).group_by(IfMessage.status)).all()
    return {
        "month": month_start.strftime("%Y-%m"),
        "orders": {"count": order_cnt, "amount": float(order_amt)},
        "interfaces": {status: cnt for status, cnt in if_rows},
        "equipment_count": db.scalar(select(func.count()).select_from(Equipment)),
    }
