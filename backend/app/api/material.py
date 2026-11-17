"""자재관리: 원지 소요, 자동발주, 발주·입고, 구매(매입), 부자재, 경비."""
from __future__ import annotations

import math
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api._util import partner_names, row, stock_item_names, warehouse_names
from app.db import get_db
from app.interfaces import gateway
from app.models import (
    Expense, PaperGrade, PaperPolicy, PaperRequirement, PurchaseOrder, SchedulePlan, StockMove, SubMaterial,
    WorkOrder,
)
from app.models._types import now
from app.services import events, inventory
from app.services.planning import _next_no

router = APIRouter(prefix="/api/material", tags=["자재관리"])


def _pending_plans(db: Session) -> set[str]:
    """골판지기 투입이 끝나지 않은 스케쥴(원지 소요가 아직 남은 계획)."""
    plans = {p.id: p.plan_no for p in db.scalars(select(SchedulePlan).where(SchedulePlan.status == "CONFIRMED"))}
    pending = set()
    for w in db.scalars(select(WorkOrder).options(selectinload(WorkOrder.routes))):
        if w.plan_id in plans and any(r.process == "CORRUGATE" and r.status != "DONE" for r in w.routes):
            pending.add(plans[w.plan_id])
    return pending


@router.get("/requirements")
def requirements(db: Session = Depends(get_db)):
    """원지 소요관리: 스케쥴별 골게터 소요량(IF-PMS-02 송신분)과 투입 실적."""
    names = stock_item_names(db)["PAPER"]
    pending = _pending_plans(db)
    used: dict[tuple[str, str], float] = {}
    plan_of_wo = {}
    plan_ids = {p.id: p.plan_no for p in db.scalars(select(SchedulePlan))}
    for w in db.scalars(select(WorkOrder)):
        plan_of_wo[w.wo_no] = plan_ids.get(w.plan_id)
    for m in db.scalars(select(StockMove).where(StockMove.kind == "PAPER", StockMove.move_type == "OUT")):
        p = plan_of_wo.get(m.ref_no or "")
        if p:
            used[(p, m.item_code)] = used.get((p, m.item_code), 0) + m.qty
    plans: dict[str, dict] = {}
    for r in db.scalars(select(PaperRequirement).order_by(PaperRequirement.id.desc())):
        p = plans.setdefault(r.plan_no, {"plan_no": r.plan_no, "created_at": r.created_at,
                                         "status": "투입중" if r.plan_no in pending else "투입완료", "lines": [],
                                         "total_kg": 0.0, "used_kg": 0.0})
        u = round(used.get((r.plan_no, r.paper_code), 0), 1)
        p["lines"].append({"paper_code": r.paper_code, "paper_name": names.get(r.paper_code, r.paper_code),
                           "kg": r.kg, "used_kg": u})
        p["total_kg"] += r.kg
        p["used_kg"] += u
    return list(plans.values())


def _recommend(db: Session) -> list[dict]:
    names = stock_item_names(db)
    partners = partner_names(db)
    pending = _pending_plans(db)
    need: dict[str, float] = {}
    for r in db.scalars(select(PaperRequirement).where(PaperRequirement.plan_no.in_(pending))):
        need[r.paper_code] = need.get(r.paper_code, 0) + r.kg
    open_po: dict[tuple[str, str], float] = {}
    for po in db.scalars(select(PurchaseOrder).where(PurchaseOrder.status == "ORDERED")):
        open_po[(po.kind, po.item_code)] = open_po.get((po.kind, po.item_code), 0) + po.qty
    prices = {g.code: g.price_per_kg for g in db.scalars(select(PaperGrade))}
    out = []
    for p in db.scalars(select(PaperPolicy).order_by(PaperPolicy.paper_code)):
        stock = inventory.total(db, "PAPER", p.paper_code)
        po = open_po.get(("PAPER", p.paper_code), 0)
        req = need.get(p.paper_code, 0)
        avail = stock + po - req
        rec = math.ceil((p.safety_kg - avail) / p.lot_kg) * p.lot_kg if avail < p.safety_kg else 0
        out.append({"kind": "PAPER", "item_code": p.paper_code, "item_name": names["PAPER"].get(p.paper_code),
                    "unit": "kg", "stock": round(stock), "open_po": round(po), "requirement": round(req),
                    "available": round(avail), "safety": p.safety_kg, "lot": p.lot_kg, "recommend": rec,
                    "supplier_code": p.supplier_code, "supplier_name": partners.get(p.supplier_code),
                    "lead_days": p.lead_days, "unit_price": prices.get(p.paper_code, 0)})
    for s in db.scalars(select(SubMaterial).order_by(SubMaterial.code)):
        stock = inventory.total(db, "SUB", s.code)
        po = open_po.get(("SUB", s.code), 0)
        avail = stock + po
        rec = math.ceil(s.safety_qty * 2 - avail) if avail < s.safety_qty else 0
        out.append({"kind": "SUB", "item_code": s.code, "item_name": s.name, "unit": s.unit, "stock": round(stock, 1),
                    "open_po": po, "requirement": 0, "available": round(avail, 1), "safety": s.safety_qty,
                    "lot": None, "recommend": rec, "supplier_code": s.supplier_code,
                    "supplier_name": partners.get(s.supplier_code), "lead_days": 3, "unit_price": s.unit_price})
    return out


@router.get("/auto-order")
def auto_order_preview(db: Session = Depends(get_db)):
    """원지 자동발주 추천: 가용재고(현재고 + 발주잔 − 미투입 소요) < 안전재고 → 발주 단위로 올림."""
    return _recommend(db)


def _create_po(db: Session, kind: str, item_code: str, qty: float, supplier: str, price: float, lead: int,
               auto: bool, wh: str | None = None) -> PurchaseOrder:
    po = PurchaseOrder(po_no=_next_no(db, PurchaseOrder, PurchaseOrder.po_no, "PO"), kind=kind, item_code=item_code,
                       supplier_code=supplier, qty=qty, unit_price=price, amount=round(qty * price),
                       warehouse_code=wh or inventory.DEFAULT_WH[kind], auto=int(auto),
                       due_date=date.today() + timedelta(days=lead))
    db.add(po)
    db.flush()
    return po


@router.post("/auto-order")
def auto_order(db: Session = Depends(get_db)):
    created = [
        _create_po(db, r["kind"], r["item_code"], r["recommend"], r["supplier_code"], r["unit_price"], r["lead_days"],
                   True).po_no
        for r in _recommend(db) if r["recommend"] > 0
    ]
    if not created:
        raise HTTPException(400, "발주가 필요한 품목이 없습니다 (모두 안전재고 이상)")
    db.commit()
    events.publish("purchase", {"count": len(created)})
    return {"purchase_orders": created}


def _po_dict(po: PurchaseOrder, names, partners, whs) -> dict:
    return row(po) | {"item_name": names[po.kind].get(po.item_code, po.item_code),
                      "supplier_name": partners.get(po.supplier_code, po.supplier_code),
                      "warehouse_name": whs.get(po.warehouse_code, po.warehouse_code),
                      "unit": "kg" if po.kind == "PAPER" else ""}


@router.get("/purchase-orders")
def purchase_orders(status: str | None = None, db: Session = Depends(get_db)):
    names, partners, whs = stock_item_names(db), partner_names(db), warehouse_names(db)
    units = {s.code: s.unit for s in db.scalars(select(SubMaterial))}
    q = select(PurchaseOrder).order_by(PurchaseOrder.id.desc())
    if status:
        q = q.where(PurchaseOrder.status == status)
    out = []
    for po in db.scalars(q):
        d = _po_dict(po, names, partners, whs)
        d["unit"] = d["unit"] or units.get(po.item_code, "")
        out.append(d)
    return out


class PoIn(BaseModel):
    kind: str
    item_code: str
    qty: float = Field(gt=0)
    warehouse_code: str | None = None


@router.post("/purchase-orders")
def create_po(body: PoIn, db: Session = Depends(get_db)):
    if body.kind == "PAPER":
        pol = db.scalar(select(PaperPolicy).where(PaperPolicy.paper_code == body.item_code))
        g = db.scalar(select(PaperGrade).where(PaperGrade.code == body.item_code))
        if not pol or not g:
            raise HTTPException(400, "원지 코드 없음")
        po = _create_po(db, "PAPER", g.code, body.qty, pol.supplier_code, g.price_per_kg, pol.lead_days, False,
                        body.warehouse_code)
    elif body.kind == "SUB":
        s = db.scalar(select(SubMaterial).where(SubMaterial.code == body.item_code))
        if not s:
            raise HTTPException(400, "부자재 코드 없음")
        po = _create_po(db, "SUB", s.code, body.qty, s.supplier_code, s.unit_price, 3, False, body.warehouse_code)
    else:
        raise HTTPException(400, "kind = PAPER / SUB")
    db.commit()
    events.publish("purchase", {"po_no": po.po_no})
    return {"po_no": po.po_no}


@router.post("/purchase-orders/{po_no}/receive")
def receive_po(po_no: str, db: Session = Depends(get_db)):
    """입고 처리: 재고 입고 + 매입 확정. 원지는 PMS에 입고 정보를 보낸다(IF-PMS-02)."""
    po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == po_no))
    if not po:
        raise HTTPException(404)
    if po.status != "ORDERED":
        raise HTTPException(400, "이미 입고된 발주입니다")
    inventory.move(db, po.kind, "IN", po.item_code, po.qty, to_wh=po.warehouse_code, ref_no=po.po_no,
                   reason="발주 입고")
    po.status = "RECEIVED"
    po.received_at = now()
    db.commit()
    if po.kind == "PAPER":
        rolls = max(1, round(po.qty / 1200))
        gateway.send(db, "IF-PMS-02", {"event": "원지입고", "po_no": po.po_no, "paper_code": po.item_code,
                                       "kg": po.qty, "rolls": rolls, "warehouse": po.warehouse_code,
                                       "roll_nos": [f"{po.po_no[-6:]}-{i:02d}" for i in range(1, min(rolls, 30) + 1)]})
    events.publish("purchase", {"po_no": po.po_no, "status": po.status})
    return {"po_no": po.po_no, "status": po.status}


@router.get("/purchases")
def purchases(db: Session = Depends(get_db)):
    """구매관리: 입고 완료 = 매입 확정. 공급사·월별 매입 합계."""
    names, partners, whs = stock_item_names(db), partner_names(db), warehouse_names(db)
    rows = [_po_dict(po, names, partners, whs) for po in db.scalars(
        select(PurchaseOrder).where(PurchaseOrder.status == "RECEIVED").order_by(PurchaseOrder.id.desc()))]
    by_sup: dict[str, dict] = {}
    for r in rows:
        s = by_sup.setdefault(r["supplier_code"], {"supplier_name": r["supplier_name"], "count": 0, "amount": 0.0,
                                                   "vat": 0.0})
        s["count"] += 1
        s["amount"] += r["amount"]
        s["vat"] += round(r["amount"] * 0.1)
    return {"rows": rows, "by_supplier": list(by_sup.values())}


@router.get("/sub-materials")
def sub_materials(db: Session = Depends(get_db)):
    """부자재: 현재고·안전재고·최근 30일 사용량·남은 일수."""
    partners = partner_names(db)
    since = now() - timedelta(days=30)
    use = dict(db.execute(select(StockMove.item_code, func.sum(StockMove.qty)).where(
        StockMove.kind == "SUB", StockMove.move_type == "OUT", StockMove.created_at >= since)
        .group_by(StockMove.item_code)).all())
    out = []
    for s in db.scalars(select(SubMaterial).order_by(SubMaterial.code)):
        stock = inventory.total(db, "SUB", s.code)
        used = float(use.get(s.code) or 0)
        out.append(row(s) | {"supplier_name": partners.get(s.supplier_code), "stock": round(stock, 1),
                             "used_30d": round(used, 1), "short": stock < s.safety_qty,
                             "process_name": {"CORRUGATE": "골판지기", "PRINT": "인쇄", "CONVERT": "가공"}.get(
                                 s.usage_process, s.usage_process)})
    return out


@router.get("/expenses")
def expenses(db: Session = Depends(get_db)):
    rows = [row(e) for e in db.scalars(select(Expense).order_by(Expense.exp_date.desc(), Expense.id.desc()))]
    by_month: dict[str, dict[str, float]] = {}
    for r in rows:
        ym = r["exp_date"].strftime("%Y-%m")
        m = by_month.setdefault(ym, {})
        m[r["category"]] = m.get(r["category"], 0) + r["amount"]
    return {"rows": rows, "by_month": [{"ym": k, **v, "total": sum(v.values())} for k, v in sorted(by_month.items())]}


class ExpenseIn(BaseModel):
    exp_date: date
    category: str
    dept: str
    amount: float = Field(gt=0)
    memo: str | None = None


@router.post("/expenses")
def add_expense(body: ExpenseIn, db: Session = Depends(get_db)):
    p = f"EX{body.exp_date:%y%m}"
    n = db.scalar(select(func.count()).select_from(Expense).where(Expense.exp_no.like(f"{p}%"))) or 0
    e = Expense(exp_no=f"{p}{n + 101:03d}", **body.model_dump())
    db.add(e)
    db.commit()
    return {"exp_no": e.exp_no}
