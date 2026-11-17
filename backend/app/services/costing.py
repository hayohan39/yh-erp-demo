"""원가분석: 수주별 표준원가 vs 실제원가, 견적원가 계산.

- 재료비: 표준 = 전개 면적 × 수량 × (1 + 표준 손실률) × 원지 단가/m², 실제 = PMS 원지 투입 kg × 지종 단가
- 가공비: 공정별 분당 가공비 × 시간. 표준 = 설비 능력 기준 시간 + 셋업, 실제 = 설비 실적 시간
- 운반비: 표준 = 기본료 + 매당 단가, 실제 = 로지스팟 배차 운임
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    BoardSpec, CostRate, Equipment, ItemBox, OrderAllocation, PaperGrade, PaperUsage, Partner, ProductionResult,
    SalesOrder, Shipment, TaxInvoice, WorkOrder,
)
from app.services.planning import paper_cost_per_m2
from app.services.scheduling import blank_size

PROCESS_RATE = {"CORRUGATE": 4000, "PRINT": 2500, "CONVERT": 1800}  # 원/분 (인건비·감가상각·동력 포함)
PROCESS_KO = {"CORRUGATE": "골판지기", "PRINT": "인쇄", "CONVERT": "가공"}
SETUP_MINUTES = 5
STD_LOSS = 0.03  # 표준 원지 손실률(트림·손지)
FREIGHT_BASE, FREIGHT_PER_SHEET = 80000, 1.5
COSTED_STATUS = ("PRODUCED", "SHIPPING", "SHIPPED", "INVOICING", "CLOSED")


def _equipment(db: Session) -> dict[str, Equipment]:
    return {e.process: e for e in db.scalars(select(Equipment))}


def rates(db: Session) -> dict[str, Any]:
    """원가 기준정보(cost_rate). 값이 없으면 코드 기본값을 쓴다."""
    r = {c.key: c.value for c in db.scalars(select(CostRate))}
    return {
        "process": {p: r.get(f"rate_{p}", v) for p, v in PROCESS_RATE.items()},
        "setup": r.get("setup_minutes", SETUP_MINUTES), "loss": r.get("std_loss", STD_LOSS),
        "freight_base": r.get("freight_base", FREIGHT_BASE), "freight_sheet": r.get("freight_per_sheet", FREIGHT_PER_SHEET),
        "overhead": r.get("overhead_rate", 0.0), "margin": r.get("target_margin", 0.15),
        "std_lot": int(r.get("std_lot", 5000)), "pallet_sheets": int(r.get("pallet_sheets", 400)),
    }


def _std_process(eqs: dict[str, Equipment], qty: int, print_colors: int, rt: dict[str, Any] | None = None
                 ) -> dict[str, float]:
    rate = rt["process"] if rt else PROCESS_RATE
    setup = rt["setup"] if rt else SETUP_MINUTES
    out = {}
    for proc in ("CORRUGATE", "PRINT", "CONVERT"):
        if proc == "PRINT" and not print_colors:
            continue
        minutes = qty / eqs[proc].capacity_per_hour * 60 + setup
        out[proc] = minutes * rate[proc]
    return out


def order_cost(db: Session, order: SalesOrder) -> dict[str, Any]:
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    prices = {g.code: g.price_per_kg for g in db.scalars(select(PaperGrade))}
    eqs = _equipment(db)
    rt = rates(db)
    wos = list(db.scalars(select(WorkOrder).where(WorkOrder.order_id == order.id)))
    allocs = list(db.scalars(select(OrderAllocation).where(OrderAllocation.order_id == order.id)))
    wo_nos = [w.wo_no for w in wos]
    qty_by_item = {ln.item_code: ln.qty for ln in order.lines}

    std_mat = std_freight = 0.0
    std_proc: dict[str, float] = {}
    for code, qty in qty_by_item.items():
        it = items[code]
        bw, bl = blank_size(it.length_mm, it.width_mm, it.height_mm)
        _, won_m2 = paper_cost_per_m2(db, it.board_spec_code)
        std_mat += bw * bl / 1e6 * qty * (1 + rt["loss"]) * won_m2
        for p, v in _std_process(eqs, qty, it.print_colors, rt).items():
            std_proc[p] = std_proc.get(p, 0) + v
    total_qty = sum(qty_by_item.values())
    std_freight = rt["freight_base"] + rt["freight_sheet"] * total_qty

    usage = list(db.scalars(select(PaperUsage).where(PaperUsage.wo_no.in_(wo_nos)))) if wo_nos else []
    act_mat = sum(u.used_kg * prices.get(u.paper_code, 0) for u in usage)
    results = list(db.scalars(select(ProductionResult).where(ProductionResult.wo_no.in_(wo_nos)))) if wo_nos else []
    act_proc: dict[str, float] = {}
    defect_qty = 0
    for r in results:
        act_proc[r.process] = act_proc.get(r.process, 0) + r.run_minutes * rt["process"].get(r.process, 0)
        defect_qty += r.defect_qty
    if allocs and not wos:  # 수주전용(재고 출하): 재고의 원가는 표준원가로 본다
        act_mat, act_proc = std_mat, dict(std_proc)
    sh = db.scalar(select(Shipment).where(Shipment.order_id == order.id))
    act_freight = sh.freight_amount if sh and sh.freight_amount else None
    good_qty = sum(w.good_qty for w in wos) + sum(a.qty for a in allocs)
    inv = db.scalar(select(TaxInvoice).where(TaxInvoice.order_id == order.id))
    price = {ln.item_code: ln.unit_price for ln in order.lines}
    # 매출: 세금계산서 공급가액, 없으면 양품 × 단가(출하 예정 금액)
    sales = inv.supply_amount if inv else (sum(w.good_qty * price.get(w.item_code, 0) for w in wos)
                                           + sum(a.qty * price.get(a.item_code, 0) for a in allocs))

    std_total = std_mat + sum(std_proc.values()) + std_freight
    act_total = act_mat + sum(act_proc.values()) + (act_freight if act_freight is not None else std_freight)
    rows = [{"key": "material", "label": "재료비(원지)", "std": round(std_mat), "act": round(act_mat)}]
    for p in ("CORRUGATE", "PRINT", "CONVERT"):
        if p in std_proc or p in act_proc:
            rows.append({"key": p, "label": f"가공비·{PROCESS_KO[p]}", "std": round(std_proc.get(p, 0)),
                         "act": round(act_proc.get(p, 0))})
    rows.append({"key": "freight", "label": "운반비", "std": round(std_freight),
                 "act": round(act_freight) if act_freight is not None else None})
    for r in rows:
        r["diff"] = None if r["act"] is None else r["act"] - r["std"]
    return {
        "order_no": order.order_no, "customer_code": order.customer_code, "status": order.status,
        "order_qty": total_qty, "good_qty": good_qty, "defect_qty": defect_qty,
        "paper_kg": round(sum(u.used_kg for u in usage), 1),
        "sales": round(sales), "std_cost": round(std_total), "act_cost": round(act_total),
        "variance": round(act_total - std_total), "profit": round(sales - act_total),
        "cost_rate": round(act_total / sales, 4) if sales else None,
        "unit_cost": round(act_total / good_qty, 1) if good_qty else None,
        "freight_estimated": act_freight is None,
        "rows": rows,
    }


def cost_list(db: Session) -> list[dict[str, Any]]:
    partners = {p.code: p.name for p in db.scalars(select(Partner))}
    orders = db.scalars(select(SalesOrder).options(selectinload(SalesOrder.lines))
                        .where(SalesOrder.status.in_(COSTED_STATUS)).order_by(SalesOrder.id.desc()))
    out = []
    for o in orders:
        c = order_cost(db, o)
        c["customer_name"] = partners.get(o.customer_code, o.customer_code)
        out.append(c)
    return out


def quote(db: Session, length: int, width: int, height: int, board_spec_code: str, print_colors: int, qty: int,
          margin: float = 0.15) -> dict[str, Any]:
    """견적원가: 규격·원단·도수·수량으로 표준원가와 목표 이익률 기준 제안 단가를 계산."""
    if not db.scalar(select(BoardSpec).where(BoardSpec.code == board_spec_code)):
        raise ValueError(f"원단 규격 없음: {board_spec_code}")
    if qty <= 0:
        raise ValueError("수량은 1 이상")
    bw, bl = blank_size(length, width, height)
    kg_m2, won_m2 = paper_cost_per_m2(db, board_spec_code)
    rt = rates(db)
    area = bw * bl / 1e6
    mat = area * qty * (1 + rt["loss"]) * won_m2
    proc = _std_process(_equipment(db), qty, print_colors, rt)
    freight = rt["freight_base"] + rt["freight_sheet"] * qty
    total = mat + sum(proc.values()) + freight
    unit = total / qty
    rows = [{"label": "재료비(원지)", "amount": round(mat)}]
    rows += [{"label": f"가공비·{PROCESS_KO[p]}", "amount": round(v)} for p, v in proc.items()]
    rows.append({"label": "운반비", "amount": round(freight)})
    return {
        "blank_w": bw, "blank_l": bl, "area_m2": round(area, 4), "paper_kg": round(area * qty * (1 + rt["loss"]) * kg_m2, 1),
        "rows": rows, "total_cost": round(total), "unit_cost": round(unit, 1),
        "margin": margin, "suggested_price": round(unit / (1 - margin), -1) if margin < 1 else None,
    }
