"""경영정보(월·년): 수주·매출·생산·원지매입·운반비 분석.

지난달까지는 월 실적 이력(monthly_stat), 이번 달은 '기준 실적 + 데모 중 실제 발생분'으로 이어 붙인다.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api._util import partner_names
from app.db import get_db
from app.models import MonthlyStat, ProductionResult, PurchaseOrder, SalesOrder, Shipment, TaxInvoice

router = APIRouter(prefix="/api/mis", tags=["경영정보"])

METRICS = {
    "orders_amt": ("수주금액", "원"), "sales_amt": ("매출액", "원"), "prod_qty": ("생산량", "매"),
    "defect_rate": ("불량률", "%"), "paper_amt": ("원지 매입액", "원"), "paper_kg": ("원지 매입량", "kg"),
    "freight_amt": ("운반비", "원"),
}
PROCESS_KO = {"CORRUGATE": "골판지기", "PRINT": "인쇄", "CONVERT": "가공"}


def _ym(d: datetime | None) -> str | None:
    return d.strftime("%Y-%m") if d else None


def _live(db: Session, metric: str) -> dict[tuple[str, str], float]:
    """데모 중 실제로 발생한 데이터의 (월, 차원)별 합계."""
    out: dict[tuple[str, str], float] = defaultdict(float)

    def add(ym, dim, v):
        if ym:
            out[(ym, "")] += v
            if dim:
                out[(ym, dim)] += v

    if metric == "orders_amt":
        for o in db.scalars(select(SalesOrder)):
            add(o.order_date.strftime("%Y-%m"), o.customer_code, o.total_amount)
    elif metric == "sales_amt":
        for i in db.scalars(select(TaxInvoice).where(TaxInvoice.status == "ISSUED")):
            add(_ym(i.issued_at), i.customer_code, i.supply_amount)
    elif metric == "prod_qty":
        for r in db.scalars(select(ProductionResult)):
            ym = _ym(r.created_at)
            if r.process == "CONVERT":
                out[(ym, "")] += r.good_qty
            out[(ym, r.process)] += r.good_qty
    elif metric in ("paper_amt", "paper_kg"):
        for po in db.scalars(select(PurchaseOrder).where(PurchaseOrder.status == "RECEIVED",
                                                         PurchaseOrder.kind == "PAPER")):
            add(_ym(po.received_at), po.supplier_code, po.amount if metric == "paper_amt" else po.qty)
    elif metric == "freight_amt":
        for s in db.scalars(select(Shipment).where(Shipment.status == "SHIPPED")):
            add(_ym(s.shipped_at), s.carrier_code, s.freight_amount)
    return out


def _combined(db: Session, metric: str) -> dict[tuple[str, str], float]:
    vals: dict[tuple[str, str], float] = defaultdict(float)
    if metric == "defect_rate":  # 생산량 가중 불량률
        hist_rate = {m.ym: m.value for m in db.scalars(select(MonthlyStat).where(
            MonthlyStat.metric == "defect_rate", MonthlyStat.dim == ""))}
        hist_qty = {m.ym: m.value for m in db.scalars(select(MonthlyStat).where(
            MonthlyStat.metric == "prod_qty", MonthlyStat.dim == ""))}
        good: dict[str, float] = defaultdict(float)
        bad: dict[str, float] = defaultdict(float)
        for r in db.scalars(select(ProductionResult)):
            ym = _ym(r.created_at)
            good[ym] += r.good_qty
            bad[ym] += r.defect_qty
        for ym in set(hist_rate) | set(good):
            hq = hist_qty.get(ym, 0)
            hb = hq * hist_rate.get(ym, 0)
            total = hq + good[ym] + bad[ym]
            vals[(ym, "")] = (hb + bad[ym]) / total if total else 0
        return vals
    for m in db.scalars(select(MonthlyStat).where(MonthlyStat.metric == metric)):
        vals[(m.ym, m.dim)] += m.value
    for k, v in _live(db, metric).items():
        vals[k] += v
    return vals


def _dim_name(db: Session, metric: str):
    names = partner_names(db)
    return (lambda d: PROCESS_KO.get(d, d)) if metric == "prod_qty" else (lambda d: names.get(d, d))


@router.get("/series")
def series(metric: str = "sales_amt", period: str = "month", db: Session = Depends(get_db)):
    if metric not in METRICS:
        raise HTTPException(400, f"metric: {', '.join(METRICS)}")
    vals = _combined(db, metric)
    now_ym = datetime.now().strftime("%Y-%m")
    months = sorted({ym for ym, _ in vals if ym and ym != "OPEN" and ym <= now_ym})
    if period == "year":
        if metric == "defect_rate":
            qty = _combined(db, "prod_qty")
            agg: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
            for ym in months:
                q = qty.get((ym, ""), 0)
                agg[ym[:4]][0] += vals.get((ym, ""), 0) * q
                agg[ym[:4]][1] += q
            points = [{"period": y, "value": a / b if b else 0} for y, (a, b) in sorted(agg.items())]
        else:
            ysum: dict[str, float] = defaultdict(float)
            for ym in months:
                ysum[ym[:4]] += vals.get((ym, ""), 0)
            points = [{"period": y, "value": v} for y, v in sorted(ysum.items())]
        for p in points:
            p["current"] = p["period"] == now_ym[:4]
        scope = [m for m in months if m.startswith(now_ym[:4])]
    else:
        points = [{"period": ym, "value": vals.get((ym, ""), 0), "current": ym == now_ym} for ym in months[-13:]]
        scope = [now_ym]
    # 차원별 구성(이번 달 또는 올해 누적)
    name = _dim_name(db, metric)
    dims: dict[str, float] = defaultdict(float)
    for (ym, dim), v in vals.items():
        if dim and ym in scope:
            dims[dim] += v
    total = sum(dims.values())
    breakdown = [{"dim": d, "name": name(d), "value": v, "share": v / total if total else 0}
                 for d, v in sorted(dims.items(), key=lambda x: -x[1])]
    cur = vals.get((now_ym, ""), 0)
    prev_ym = months[-2] if len(months) > 1 else None
    yoy_ym = f"{int(now_ym[:4]) - 1}{now_ym[4:]}"
    live_now = _live(db, metric).get((now_ym, ""), 0) if metric != "defect_rate" else None
    return {
        "metric": metric, "label": METRICS[metric][0], "unit": METRICS[metric][1], "period": period,
        "points": points, "breakdown": breakdown, "current": cur, "live_current": live_now,
        "prev": vals.get((prev_ym, ""), 0) if prev_ym else None, "yoy": vals.get((yoy_ym, ""), None),
    }


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    """경영정보 첫 화면 KPI: 주요 지표의 이번 달·전월·전년 동월."""
    out = []
    for m in ("orders_amt", "sales_amt", "prod_qty", "defect_rate", "paper_amt", "freight_amt"):
        s = series(m, "month", db)
        out.append({k: s[k] for k in ("metric", "label", "unit", "current", "prev", "yoy")}
                   | {"spark": [p["value"] for p in s["points"]]})
    return out
