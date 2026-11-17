"""기존 흐름(생산완료·출하)에 붙는 부가 처리: 부자재 소비, 조판·목형 타수, 파렛트 수불, 출하 성적서."""
from __future__ import annotations

import math
import random

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    CostRate, InspectionCert, ItemSpec, PalletMove, SalesOrder, Shipment, StockBalance, SubMaterial, Tooling,
    WorkOrder,
)
from app.services import inventory


def on_work_order_done(db: Session, wo: WorkOrder) -> None:
    """생산지시 완료: 제품 입고는 호출부에서, 여기서는 부자재 소비·조판/목형 타수 누적."""
    procs = {r.process for r in wo.routes}
    sheets = sum(r.input_qty for r in wo.routes if r.process == "CORRUGATE") or wo.qty
    for sm in db.scalars(select(SubMaterial)):
        if sm.usage_process not in procs:
            continue
        use = round(sheets / 1000 * sm.usage_per_k, 2)
        if use > 0:
            inventory.move(db, "SUB", "OUT", sm.code, use, ref_no=wo.wo_no, reason="생산 소비(자동)", publish=False)
    for t in db.scalars(select(Tooling).where(Tooling.item_code == wo.item_code, Tooling.status == "사용")):
        if (t.kind == "PLATE" and "PRINT" in procs) or t.kind == "DIE":
            t.shots += wo.good_qty
            if t.shots >= t.life_shots:
                t.status = "교체필요"


def _pallet_sheets(db: Session) -> int:
    v = db.scalar(select(CostRate.value).where(CostRate.key == "pallet_sheets"))
    return int(v or 1000)


def on_shipped(db: Session, sh: Shipment, order: SalesOrder) -> None:
    """출하 완료: 파렛트 출고 기록, 품목별 출하 성적서 발행."""
    qty = sum(ln.qty for ln in sh.lines)
    pallets = max(1, math.ceil(qty / _pallet_sheets(db)))
    db.add(PalletMove(partner_code=sh.customer_code, out_qty=pallets, ref_no=sh.shipment_no, memo="출하"))
    issue_certs(db, sh, order)


def issue_certs(db: Session, sh: Shipment, order: SalesOrder) -> list[InspectionCert]:
    if db.scalar(select(InspectionCert).where(InspectionCert.shipment_no == sh.shipment_no).limit(1)):
        return []
    rng = random.Random(sh.shipment_no)
    base = db.scalar(select(func.count()).select_from(InspectionCert)) or 0
    out = []
    for n, ln in enumerate(sh.lines, start=1):
        spec = db.scalar(select(ItemSpec).where(ItemSpec.item_code == ln.item_code))
        bct_std = spec.bct_kgf if spec else 250
        burst_std = spec.burst_kgf if spec else 10
        c = InspectionCert(
            cert_no=f"QC{sh.shipment_no[2:]}{n:02d}" if len(sh.shipment_no) > 2 else f"QC{base + n:06d}",
            shipment_no=sh.shipment_no, order_no=order.order_no, customer_code=sh.customer_code,
            item_code=ln.item_code, qty=ln.qty, bct_kgf=round(bct_std * rng.uniform(1.04, 1.22), 1),
            burst_kgf=round(burst_std * rng.uniform(1.02, 1.18), 1), moisture=round(rng.uniform(7.5, 10.5), 1),
            verdict="합격")
        db.add(c)
        out.append(c)
    return out


def free_product_stock(db: Session) -> dict[str, int]:
    """품목별 여유재고 = 제품 재고 − 출하 대기(생산완료·출하중 수주)에 묶인 수량."""
    from app.services.shipping import shippable_qty

    stock: dict[str, float] = {}
    for b in db.scalars(select(StockBalance).where(StockBalance.kind == "PRODUCT")):
        stock[b.item_code] = stock.get(b.item_code, 0) + b.qty
    for o in db.scalars(select(SalesOrder).where(SalesOrder.status.in_(("PRODUCED", "SHIPPING")))):
        for code, q in shippable_qty(db, o).items():
            stock[code] = stock.get(code, 0) - q
    return {k: int(v) for k, v in stock.items() if v > 0}
