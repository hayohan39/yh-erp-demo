"""출하·생산·품질 확장: 파렛트, 운반비, 생산실적, 작업내역, 공정관리, 외주·매입, 시방, 성적서, 개발비, 조판·목형."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api._util import item_names, partner_names, row
from app.db import get_db
from app.models import (
    BoardSpec, DevCost, Equipment, InspectionCert, ItemBox, ItemSpec, OutsourceOrder, PalletMove, Partner,
    ProductionResult, SalesOrder, Shipment, Tooling, WorkOrder, WorkOrderRoute,
)
from app.models._types import now
from app.services import costing, events, inventory, ops_hooks
from app.services.planning import _next_no

shipping_router = APIRouter(prefix="/api/shipping", tags=["출하관리"])
production_router = APIRouter(prefix="/api/production", tags=["생산관리"])
quality_router = APIRouter(prefix="/api/quality", tags=["품질관리"])

PROCESS_KO = {"CORRUGATE": "골판지기", "PRINT": "인쇄", "CONVERT": "가공"}


# ================================================================ 출하
@shipping_router.get("/pallets")
def pallets(db: Session = Depends(get_db)):
    names = partner_names(db)
    agg: dict[str, dict] = {}
    for m in db.scalars(select(PalletMove).order_by(PalletMove.id)):
        a = agg.setdefault(m.partner_code, {"partner_code": m.partner_code, "partner_name": names.get(m.partner_code),
                                            "out_qty": 0, "in_qty": 0, "last_at": None})
        a["out_qty"] += m.out_qty
        a["in_qty"] += m.in_qty
        a["last_at"] = m.created_at
    for a in agg.values():
        a["balance"] = a["out_qty"] - a["in_qty"]
    moves = [row(m) | {"partner_name": names.get(m.partner_code)}
             for m in db.scalars(select(PalletMove).order_by(PalletMove.id.desc()).limit(100))]
    return {"partners": sorted(agg.values(), key=lambda a: -a["balance"]), "moves": moves}


class PalletIn(BaseModel):
    partner_code: str
    qty: int = Field(gt=0)
    memo: str | None = None


@shipping_router.post("/pallets/return")
def pallet_return(body: PalletIn, db: Session = Depends(get_db)):
    bal = db.execute(select(func.coalesce(func.sum(PalletMove.out_qty), 0) - func.coalesce(func.sum(PalletMove.in_qty), 0))
                     .where(PalletMove.partner_code == body.partner_code)).scalar() or 0
    if body.qty > bal:
        raise HTTPException(400, f"회수 수량이 거래처 보유 수량({bal})보다 많습니다")
    db.add(PalletMove(partner_code=body.partner_code, in_qty=body.qty, memo=body.memo or "회수"))
    db.commit()
    events.publish("pallet", {"partner_code": body.partner_code})
    return {"ok": True}


@shipping_router.get("/freight")
def freight(db: Session = Depends(get_db)):
    """운반비 관리: 출하 건별 실제 운임(로지스팟) vs 표준 운임, 운송사별 합계."""
    rt = costing.rates(db)
    names = partner_names(db)
    orders = {o.id: o.order_no for o in db.scalars(select(SalesOrder))}
    rows, by_carrier = [], {}
    for sh in db.scalars(select(Shipment).options(selectinload(Shipment.lines)).where(Shipment.freight_amount > 0)
                         .order_by(Shipment.id.desc())):
        qty = sum(ln.qty for ln in sh.lines)
        std = rt["freight_base"] + rt["freight_sheet"] * qty
        rows.append({"shipment_no": sh.shipment_no, "order_no": orders.get(sh.order_id),
                     "customer_name": names.get(sh.customer_code), "carrier_name": sh.carrier_name,
                     "vehicle_no": sh.vehicle_no, "qty": qty, "freight": sh.freight_amount, "std": round(std),
                     "diff": round(sh.freight_amount - std), "per_sheet": round(sh.freight_amount / qty, 1) if qty else None,
                     "status": sh.status, "shipped_at": sh.shipped_at})
        c = by_carrier.setdefault(sh.carrier_name or "-", {"carrier_name": sh.carrier_name or "-", "count": 0,
                                                           "freight": 0.0, "qty": 0})
        c["count"] += 1
        c["freight"] += sh.freight_amount
        c["qty"] += qty
    return {"rows": rows, "by_carrier": list(by_carrier.values()),
            "rates": {"base": rt["freight_base"], "per_sheet": rt["freight_sheet"]}}


# ================================================================ 생산
@production_router.get("/results")
def results(db: Session = Depends(get_db)):
    """생산실적: 설비 I/F로 받은 공정별 실적."""
    wos = {w.wo_no: w for w in db.scalars(select(WorkOrder))}
    orders = {o.id: o.order_no for o in db.scalars(select(SalesOrder))}
    names = item_names(db)
    eqs = {e.code: e.name for e in db.scalars(select(Equipment))}
    out = []
    for r in db.scalars(select(ProductionResult).order_by(ProductionResult.id.desc()).limit(500)):
        w = wos.get(r.wo_no)
        out.append(row(r) | {"process_name": PROCESS_KO.get(r.process, r.process),
                             "equipment_name": eqs.get(r.equipment_code), "item_code": w.item_code if w else None,
                             "item_name": names.get(w.item_code) if w else None,
                             "order_no": orders.get(w.order_id) if w else None,
                             "defect_rate": r.defect_qty / (r.good_qty + r.defect_qty) if r.good_qty + r.defect_qty else 0,
                             "per_hour": round((r.good_qty + r.defect_qty) / r.run_minutes * 60) if r.run_minutes else None})
    return out


@production_router.get("/work-log")
def work_log(db: Session = Depends(get_db)):
    """작업내역: 설비별 작업 시작·종료, 가동 시간, 양품·불량 (작업일보)."""
    names = item_names(db)
    eqs = {e.code: e for e in db.scalars(select(Equipment))}
    minutes = {(r.wo_no, r.process): r.run_minutes for r in db.scalars(select(ProductionResult))}
    rows = []
    q = (select(WorkOrderRoute, WorkOrder).join(WorkOrder, WorkOrder.id == WorkOrderRoute.wo_id)
         .where(WorkOrderRoute.status != "WAIT").order_by(WorkOrderRoute.started_at.desc()))
    for rt, wo in db.execute(q).all():
        rows.append({"wo_no": wo.wo_no, "item_name": names.get(wo.item_code), "process": rt.process,
                     "process_name": PROCESS_KO.get(rt.process), "equipment_code": rt.equipment_code,
                     "equipment_name": eqs[rt.equipment_code].name if rt.equipment_code in eqs else rt.equipment_code,
                     "status": rt.status, "started_at": rt.started_at, "ended_at": rt.ended_at,
                     "run_minutes": minutes.get((wo.wo_no, rt.process)), "input_qty": rt.input_qty,
                     "good_qty": rt.good_qty, "defect_qty": rt.defect_qty})
    summary = []
    for code, e in eqs.items():
        mine = [r for r in rows if r["equipment_code"] == code]
        run_min = sum(r["run_minutes"] or 0 for r in mine)
        summary.append({"equipment_code": code, "equipment_name": e.name, "jobs": len(mine),
                        "running": sum(1 for r in mine if r["status"] == "RUN"), "run_minutes": round(run_min, 1),
                        "good_qty": sum(r["good_qty"] for r in mine), "defect_qty": sum(r["defect_qty"] for r in mine)})
    return {"rows": rows, "summary": summary}


@production_router.get("/processes")
def processes(db: Session = Depends(get_db)):
    """공정관리: 공정 기준(설비·능력·가공비·셋업)과 공정별 재공(WIP)·실적, 품목 라우팅 유형."""
    rt = costing.rates(db)
    wos = list(db.scalars(select(WorkOrder).options(selectinload(WorkOrder.routes))))
    res = list(db.scalars(select(ProductionResult)))
    out = []
    for e in db.scalars(select(Equipment).order_by(Equipment.id)):
        routes = [r for w in wos for r in w.routes if r.process == e.process]
        mine = [r for r in res if r.process == e.process]
        good, bad = sum(r.good_qty for r in mine), sum(r.defect_qty for r in mine)
        ready = 0  # 앞 공정이 끝나 투입 가능한 대기
        for w in wos:
            for i, r in enumerate(w.routes):
                if r.process == e.process and r.status == "WAIT" and (i == 0 or w.routes[i - 1].status == "DONE"):
                    ready += 1
        out.append({"process": e.process, "process_name": PROCESS_KO.get(e.process), "equipment_code": e.code,
                    "equipment_name": e.name, "legacy_system": e.legacy_system, "capacity_per_hour": e.capacity_per_hour,
                    "rate_per_min": rt["process"].get(e.process), "setup_minutes": rt["setup"],
                    "base_defect_rate": e.base_defect_rate,
                    "wait": sum(1 for r in routes if r.status == "WAIT"), "ready": ready,
                    "run": sum(1 for r in routes if r.status == "RUN"), "done": sum(1 for r in routes if r.status == "DONE"),
                    "good_qty": good, "defect_rate": bad / (good + bad) if good + bad else None})
    items = list(db.scalars(select(ItemBox)))
    routing = [
        {"name": "무지 상자", "steps": ["골판지기", "가공(접합·결속)"], "items": sum(1 for i in items if not i.print_colors)},
        {"name": "인쇄 상자", "steps": ["골판지기", "인쇄", "가공(접합·결속)"],
         "items": sum(1 for i in items if i.print_colors and i.box_style not in ("다이컷", "트레이형"))},
        {"name": "다이컷·트레이", "steps": ["골판지기", "인쇄", "가공(타발)", "외주 톰슨(필요 시)"],
         "items": sum(1 for i in items if i.box_style in ("다이컷", "트레이형"))},
    ]
    return {"processes": out, "routing": routing}


OUTSOURCE_KIND = {"OUTSOURCE": "외주 가공", "PURCHASE": "상품 매입"}


@production_router.get("/outsource")
def outsource(db: Session = Depends(get_db)):
    partners, names = partner_names(db), item_names(db)
    return [row(o) | {"vendor_name": partners.get(o.vendor_code), "item_name": names.get(o.item_code),
                      "kind_name": OUTSOURCE_KIND.get(o.kind)}
            for o in db.scalars(select(OutsourceOrder).order_by(OutsourceOrder.id.desc()))]


class OutsourceIn(BaseModel):
    kind: str
    vendor_code: str
    item_code: str
    process_name: str
    qty: int = Field(gt=0)
    unit_price: float = Field(gt=0)
    days: int = Field(ge=0, default=3)


@production_router.post("/outsource")
def add_outsource(body: OutsourceIn, db: Session = Depends(get_db)):
    if body.kind not in OUTSOURCE_KIND:
        raise HTTPException(400, "kind = OUTSOURCE / PURCHASE")
    if not db.scalar(select(Partner).where(Partner.code == body.vendor_code)):
        raise HTTPException(400, "외주처 없음")
    o = OutsourceOrder(oo_no=_next_no(db, OutsourceOrder, OutsourceOrder.oo_no, "OS"), kind=body.kind,
                       vendor_code=body.vendor_code, item_code=body.item_code, process_name=body.process_name,
                       qty=body.qty, unit_price=body.unit_price, amount=round(body.qty * body.unit_price),
                       due_date=date.today() + timedelta(days=body.days))
    db.add(o)
    db.commit()
    events.publish("outsource", {"oo_no": o.oo_no})
    return {"oo_no": o.oo_no}


@production_router.post("/outsource/{oo_no}/receive")
def receive_outsource(oo_no: str, db: Session = Depends(get_db)):
    o = db.scalar(select(OutsourceOrder).where(OutsourceOrder.oo_no == oo_no))
    if not o:
        raise HTTPException(404)
    if o.status != "ORDERED":
        raise HTTPException(400, "이미 입고 처리됨")
    o.status = "RECEIVED"
    o.received_at = now()
    if o.kind == "PURCHASE":  # 상품 매입은 제품 재고로 입고
        inventory.move(db, "PRODUCT", "IN", o.item_code, o.qty, to_wh="FG1", ref_no=o.oo_no, reason="상품 매입 입고")
    db.commit()
    events.publish("outsource", {"oo_no": o.oo_no, "status": o.status})
    return {"oo_no": o.oo_no, "status": o.status}


# ================================================================ 품질
@quality_router.get("/specs")
def specs(db: Session = Depends(get_db)):
    partners = partner_names(db)
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    flutes = {b.code: b.flute for b in db.scalars(select(BoardSpec))}
    out = []
    for s in db.scalars(select(ItemSpec).order_by(ItemSpec.item_code)):
        it = items.get(s.item_code)
        if not it:
            continue
        out.append(row(s) | {"item_name": it.name, "customer_name": partners.get(it.customer_code),
                             "board_spec": it.board_spec_code, "flute": flutes.get(it.board_spec_code),
                             "size": f"{it.length_mm}×{it.width_mm}×{it.height_mm}", "box_style": it.box_style})
    return out


class SpecIn(BaseModel):
    bct_kgf: float = Field(gt=0)
    burst_kgf: float = Field(gt=0)
    moisture_max: float = Field(gt=0)
    print_note: str
    pack_note: str


@quality_router.put("/specs/{item_code}")
def update_spec(item_code: str, body: SpecIn, db: Session = Depends(get_db)):
    s = db.scalar(select(ItemSpec).where(ItemSpec.item_code == item_code))
    if not s:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    s.rev += 1
    s.updated_at = now()
    db.commit()
    return row(s)


@quality_router.get("/certs")
def certs(db: Session = Depends(get_db)):
    partners, names = partner_names(db), item_names(db)
    specs_ = {s.item_code: s for s in db.scalars(select(ItemSpec))}
    out = []
    for c in db.scalars(select(InspectionCert).order_by(InspectionCert.id.desc())):
        s = specs_.get(c.item_code)
        out.append(row(c) | {"customer_name": partners.get(c.customer_code), "item_name": names.get(c.item_code),
                             "bct_std": s.bct_kgf if s else None, "burst_std": s.burst_kgf if s else None,
                             "moisture_max": s.moisture_max if s else None})
    return out


@quality_router.post("/certs/{shipment_no}")
def issue_cert(shipment_no: str, db: Session = Depends(get_db)):
    sh = db.scalar(select(Shipment).options(selectinload(Shipment.lines)).where(Shipment.shipment_no == shipment_no))
    if not sh:
        raise HTTPException(404)
    made = ops_hooks.issue_certs(db, sh, db.get(SalesOrder, sh.order_id))
    if not made:
        raise HTTPException(400, "이미 성적서가 발행된 출하입니다")
    db.commit()
    return {"certs": [c.cert_no for c in made]}


@quality_router.get("/dev-costs")
def dev_costs(db: Session = Depends(get_db)):
    partners = partner_names(db)
    return [row(d) | {"customer_name": partners.get(d.customer_code)}
            for d in db.scalars(select(DevCost).order_by(DevCost.id.desc()))]


class DevIn(BaseModel):
    customer_code: str
    item_name: str = Field(min_length=1)
    category: str
    amount: float = Field(gt=0)
    bill_type: str = "고객청구"


@quality_router.post("/dev-costs")
def add_dev_cost(body: DevIn, db: Session = Depends(get_db)):
    d = DevCost(dev_no=_next_no(db, DevCost, DevCost.dev_no, "DV"), **body.model_dump())
    db.add(d)
    db.commit()
    return {"dev_no": d.dev_no}


@quality_router.post("/dev-costs/{dev_no}/done")
def finish_dev_cost(dev_no: str, db: Session = Depends(get_db)):
    d = db.scalar(select(DevCost).where(DevCost.dev_no == dev_no))
    if not d:
        raise HTTPException(404)
    d.status = "완료"
    db.commit()
    return {"dev_no": dev_no}


@quality_router.get("/tooling")
def tooling(db: Session = Depends(get_db)):
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    partners = partner_names(db)
    out = []
    for t in db.scalars(select(Tooling).order_by(Tooling.kind, Tooling.code)):
        it = items.get(t.item_code)
        out.append(row(t) | {"item_name": it.name if it else None,
                             "customer_name": partners.get(it.customer_code) if it else None,
                             "kind_name": "조판(수지판)" if t.kind == "PLATE" else "목형(칼틀)",
                             "usage": t.shots / t.life_shots if t.life_shots else 0})
    return out


@quality_router.post("/tooling/{code}/replace")
def replace_tooling(code: str, db: Session = Depends(get_db)):
    t = db.scalar(select(Tooling).where(Tooling.code == code))
    if not t:
        raise HTTPException(404)
    t.shots, t.status, t.made_at = 0, "사용", date.today()
    db.commit()
    events.publish("tooling", {"code": code})
    return row(t)
