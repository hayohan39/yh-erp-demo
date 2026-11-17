"""스케쥴링 확장: 기준정보, 상자 스케쥴링(공정 간트), 배차 스케쥴링."""
from __future__ import annotations

import math
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api._util import item_names, partner_names
from app.db import get_db
from app.models import CostRate, Equipment, ProductionResult, SalesOrder, WorkOrder
from app.seed_extra import REGION
from app.services import costing, scheduling, shipping

router = APIRouter(prefix="/api/scheduling", tags=["스케쥴링"])
PROCESS_KO = {"CORRUGATE": "골판지기", "PRINT": "인쇄", "CONVERT": "가공"}


@router.get("/settings")
def settings_(db: Session = Depends(get_db)):
    """스케쥴링 기준정보: 원단 폭 조합·설비 능력·배차 적재 기준."""
    rates = {c.key: c.value for c in db.scalars(select(CostRate))}
    return {
        "corrugator": {"roll_widths": scheduling.ROLL_WIDTHS_MM, "min_trim_mm": scheduling.MIN_TRIM_MM,
                       "max_ups": scheduling.MAX_UPS, "take_up": scheduling.TAKE_UP},
        "equipment": [{"code": e.code, "name": e.name, "process": PROCESS_KO.get(e.process),
                       "capacity_per_hour": e.capacity_per_hour, "legacy_system": e.legacy_system}
                      for e in db.scalars(select(Equipment).order_by(Equipment.id))],
        "setup_minutes": rates.get("setup_minutes", 5),
        "dispatch": {"pallet_sheets": rates.get("pallet_sheets", 1000), "truck_11t": rates.get("truck_11t_pallets", 16),
                     "truck_5t": rates.get("truck_5t_pallets", 10)},
        "regions": REGION,
        "auto_order": "가용재고(현재고 + 발주잔 − 미투입 소요) < 안전재고면 발주 단위(10톤)로 올려 발주",
    }


@router.get("/gantt")
def gantt(db: Session = Depends(get_db)):
    """상자 스케쥴링: 설비별 작업 순서를 공장 시간(분)으로 펼친 간트.

    완료 공정은 실제 가동 시간, 진행·대기 공정은 설비 능력 기준 예상 시간으로 배치한다.
    같은 생산지시의 다음 공정은 앞 공정이 끝난 뒤에만 시작한다.
    """
    rt = costing.rates(db)
    eqs = {e.code: e for e in db.scalars(select(Equipment))}
    names = item_names(db)
    actual = {(r.wo_no, r.process): r.run_minutes for r in db.scalars(select(ProductionResult))}
    wos = list(db.scalars(select(WorkOrder).options(selectinload(WorkOrder.routes))
                          .order_by(WorkOrder.id.desc()).limit(24)))[::-1]
    eq_free: dict[str, float] = defaultdict(float)
    bars = []
    for w in wos:
        t = 0.0
        for r in w.routes:
            e = eqs.get(r.equipment_code)
            est = w.qty / e.capacity_per_hour * 60 + rt["setup"] if e else 30
            dur = actual.get((w.wo_no, r.process)) or est
            start = max(t, eq_free[r.equipment_code])
            end = start + dur
            eq_free[r.equipment_code] = end
            t = end
            bars.append({"wo_no": w.wo_no, "item_name": names.get(w.item_code), "qty": w.qty, "process": r.process,
                         "equipment_code": r.equipment_code, "start": round(start, 1), "end": round(end, 1),
                         "status": r.status})
    lanes = [{"code": e.code, "name": e.name, "process": PROCESS_KO.get(e.process),
              "busy": round(sum(b["end"] - b["start"] for b in bars if b["equipment_code"] == e.code), 1)}
             for e in sorted(eqs.values(), key=lambda x: ["CORRUGATE", "PRINT", "CONVERT"].index(x.process))]
    span = max((b["end"] for b in bars), default=0)
    return {"lanes": lanes, "bars": bars, "span": round(span, 1)}


def _dispatch_plan(db: Session) -> list[dict]:
    rt = costing.rates(db)
    rates = {c.key: c.value for c in db.scalars(select(CostRate))}
    cap11, cap5 = int(rates.get("truck_11t_pallets", 16)), int(rates.get("truck_5t_pallets", 10))
    partners = partner_names(db)
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    q = (select(SalesOrder).options(selectinload(SalesOrder.lines))
         .where(SalesOrder.status.in_(("PLANNED", "IN_PROD", "PRODUCED"))).order_by(SalesOrder.due_date))
    for o in db.scalars(q):
        qty = sum(shipping.shippable_qty(db, o).values()) if o.status == "PRODUCED" else sum(ln.qty for ln in o.lines)
        if qty <= 0:
            continue
        region = REGION.get(o.customer_code, "기타")
        groups[(region, o.due_date.isoformat())].append({
            "order_no": o.order_no, "customer_name": partners.get(o.customer_code), "qty": qty,
            "pallets": max(1, math.ceil(qty / rt["pallet_sheets"])), "status": o.status,
            "ready": o.status == "PRODUCED"})
    trucks = []
    for (region, due), orders in sorted(groups.items(), key=lambda g: (g[0][1], g[0][0])):
        parts = []  # 한 차에 다 안 실리는 큰 수주는 11톤 만차 단위로 나눈다
        for od in orders:
            left, n = od["pallets"], 0
            while left > 0:
                take = min(left, cap11)
                n += 1
                qty = round(od["qty"] * take / od["pallets"])
                parts.append(od | {"pallets": take, "qty": qty,
                                   "split": f"{n}/{math.ceil(od['pallets'] / cap11)}" if od["pallets"] > cap11 else None})
                left -= take
        bins: list[dict] = []
        for od in sorted(parts, key=lambda x: -x["pallets"]):  # first-fit decreasing
            b = next((b for b in bins if b["pallets"] + od["pallets"] <= cap11), None)
            if not b:
                b = {"orders": [], "pallets": 0}
                bins.append(b)
            b["orders"].append(od)
            b["pallets"] += od["pallets"]
        for b in bins:
            cap = cap5 if b["pallets"] <= cap5 else cap11
            qty = sum(o["qty"] for o in b["orders"])
            trucks.append({"truck_no": len(trucks) + 1, "region": region, "due_date": due,
                           "truck_type": "5톤" if cap == cap5 else "11톤", "capacity": cap, "pallets": b["pallets"],
                           "load_rate": min(b["pallets"] / cap, 1), "orders": b["orders"],
                           "est_freight": round(rt["freight_base"] * (0.7 if cap == cap5 else 1) + rt["freight_sheet"] * qty),
                           "all_ready": all(o["ready"] for o in b["orders"])})
    return trucks


@router.get("/dispatch-plan")
def dispatch_plan(db: Session = Depends(get_db)):
    """배차 스케쥴링: 납기·지역별로 수주를 묶어 차량(5톤/11톤)에 파렛트를 적재하는 계획."""
    return _dispatch_plan(db)


class DispatchIn(BaseModel):
    order_nos: list[str]


@router.post("/dispatch-plan/execute")
def dispatch_execute(body: DispatchIn, db: Session = Depends(get_db)):
    """계획한 차량의 수주를 한꺼번에 출하요청 → 로지스팟 배차요청."""
    done, errors = [], []
    for no in body.order_nos:
        try:
            done.append(shipping.request_shipment(db, no).shipment_no)
        except ValueError as e:
            errors.append(f"{no}: {e}")
    if not done:
        raise HTTPException(400, "; ".join(errors) or "출하요청할 수주가 없습니다")
    return {"shipments": done, "errors": errors}
