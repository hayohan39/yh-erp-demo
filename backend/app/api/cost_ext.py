"""원가분석 확장: 표준원가(품목별), 원가분석(거래처·품목 손익)."""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api._util import partner_names
from app.db import get_db
from app.models import ItemBox, PriceHistory, SalesOrder
from app.services import costing, events

router = APIRouter(prefix="/api/cost", tags=["원가분석"])


def _std_rows(db: Session) -> list[dict]:
    rt = costing.rates(db)
    names = partner_names(db)
    out = []
    for i in db.scalars(select(ItemBox).order_by(ItemBox.code)):
        q = costing.quote(db, i.length_mm, i.width_mm, i.height_mm, i.board_spec_code, i.print_colors, rt["std_lot"])
        unit = q["unit_cost"]
        out.append({"code": i.code, "name": i.name, "customer_name": names.get(i.customer_code),
                    "board_spec": i.board_spec_code, "print_colors": i.print_colors, "unit_price": i.unit_price,
                    "std_cost": i.std_cost, "recalc": round(unit, -1), "diff": round(unit, -1) - i.std_cost,
                    "margin": 1 - i.std_cost / i.unit_price if i.unit_price else None,
                    "rows": [{"label": r["label"], "unit": round(r["amount"] / rt["std_lot"], 1)} for r in q["rows"]]})
    return out


@router.get("/standard")
def standard(db: Session = Depends(get_db)):
    """품목별 표준원가: 등록값과 현재 원가 기준(원지 단가·가공비·운반비)으로 다시 계산한 값."""
    return {"lot": costing.rates(db)["std_lot"], "rows": _std_rows(db)}


@router.post("/standard/recalc")
def recalc(db: Session = Depends(get_db)):
    changed = 0
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    for r in _std_rows(db):
        if r["diff"]:
            db.add(PriceHistory(kind="STD", code=r["code"], old_price=r["std_cost"], new_price=r["recalc"],
                                reason="표준원가 재계산"))
            items[r["code"]].std_cost = r["recalc"]
            changed += 1
    db.commit()
    events.publish("master", {"kind": "std_cost", "changed": changed})
    return {"changed": changed}


@router.get("/analysis")
def analysis(db: Session = Depends(get_db)):
    """원가분석: 수주별 실제원가를 거래처·품목으로 모아 간접비 배부 후 손익을 본다."""
    rt = costing.rates(db)
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    names = partner_names(db)
    orders = {o.order_no: o for o in db.scalars(select(SalesOrder).options(selectinload(SalesOrder.lines)))}
    by_c: dict[str, dict] = defaultdict(lambda: {"sales": 0.0, "cost": 0.0, "std": 0.0, "orders": 0})
    by_i: dict[str, dict] = defaultdict(lambda: {"sales": 0.0, "cost": 0.0, "qty": 0})
    rows_mix: dict[str, float] = defaultdict(float)
    for c in costing.cost_list(db):
        if not c["sales"]:
            continue
        a = by_c[c["customer_code"]]
        a["sales"] += c["sales"]
        a["cost"] += c["act_cost"]
        a["std"] += c["std_cost"]
        a["orders"] += 1
        for r in c["rows"]:
            rows_mix[r["label"]] += r["act"] if r["act"] is not None else r["std"]
        o = orders.get(c["order_no"])
        if not o:
            continue
        total_amt = sum(ln.amount for ln in o.lines) or 1
        for ln in o.lines:  # 수주 원가를 라인 금액 비율로 품목에 배분
            share = ln.amount / total_amt
            b = by_i[ln.item_code]
            b["sales"] += c["sales"] * share
            b["cost"] += c["act_cost"] * share
            b["qty"] += ln.qty

    def fin(d: dict) -> dict:
        overhead = d["cost"] * rt["overhead"]
        profit = d["sales"] - d["cost"] - overhead
        return d | {"sales": round(d["sales"]), "cost": round(d["cost"]), "overhead": round(overhead),
                    "profit": round(profit), "margin": profit / d["sales"] if d["sales"] else None}

    customers = [fin(v) | {"code": k, "name": names.get(k, k)} for k, v in by_c.items()]
    item_rows = [fin(v) | {"code": k, "name": items[k].name if k in items else k} for k, v in by_i.items()]
    total = fin({"sales": sum(c["sales"] for c in by_c.values()), "cost": sum(c["cost"] for c in by_c.values())})
    mix_total = sum(rows_mix.values()) or 1
    return {
        "overhead_rate": rt["overhead"], "total": total,
        "customers": sorted(customers, key=lambda x: -x["sales"]),
        "items": sorted(item_rows, key=lambda x: (x["margin"] if x["margin"] is not None else 9)),
        "mix": [{"label": k, "amount": round(v), "share": v / mix_total} for k, v in rows_mix.items()],
    }
