"""영업관리 확장: 거래처관리, 수주전용(재고 전용), 판매관리, 크레임, 수금."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api._util import item_names, partner_names, row
from app.db import get_db
from app.interfaces import gateway
from app.models import (
    Claim, MonthlyStat, OrderAllocation, Partner, Receipt, SalesOrder, Shipment, TaxInvoice,
)
from app.models._types import now
from app.seed_extra import REGION
from app.services import events, ops_hooks
from app.services.planning import _next_no

router = APIRouter(prefix="/api/sales", tags=["영업관리"])


def _opening_ar(db: Session) -> dict[str, float]:
    return {m.dim: m.value for m in db.scalars(select(MonthlyStat).where(MonthlyStat.ym == "OPEN",
                                                                         MonthlyStat.metric == "ar"))}


def _receivables(db: Session) -> dict[str, dict]:
    """거래처별 미수: 기초 미수 + 발행 세금계산서(공급가+부가세) − 수금."""
    opening = _opening_ar(db)
    paid_inv: dict[str, float] = {}
    paid_open: dict[str, float] = {}
    for r in db.scalars(select(Receipt)):
        if r.invoice_no:
            paid_inv[r.invoice_no] = paid_inv.get(r.invoice_no, 0) + r.amount
        else:
            paid_open[r.customer_code] = paid_open.get(r.customer_code, 0) + r.amount
    out: dict[str, dict] = {}
    for p in db.scalars(select(Partner).where(Partner.partner_type == "CUSTOMER").order_by(Partner.code)):
        o = opening.get(p.code, 0)
        out[p.code] = {"customer_code": p.code, "customer_name": p.name, "opening": o,
                       "opening_left": o - paid_open.get(p.code, 0), "invoices": [], "invoiced": 0.0,
                       "received": paid_open.get(p.code, 0)}
    for inv in db.scalars(select(TaxInvoice).where(TaxInvoice.status == "ISSUED").order_by(TaxInvoice.id)):
        c = out.get(inv.customer_code)
        if not c:
            continue
        paid = paid_inv.get(inv.invoice_no, 0)
        c["invoices"].append({"invoice_no": inv.invoice_no, "issued_at": inv.issued_at, "total": inv.total_amount,
                              "paid": paid, "left": inv.total_amount - paid})
        c["invoiced"] += inv.total_amount
        c["received"] += paid
    for c in out.values():
        c["balance"] = c["opening"] + c["invoiced"] - c["received"]
    return out


@router.get("/customers")
def customers(db: Session = Depends(get_db)):
    """거래처관리: 거래처별 수주·매출·미수·크레임 현황."""
    ar = _receivables(db)
    orders: dict[str, list[SalesOrder]] = {}
    for o in db.scalars(select(SalesOrder)):
        orders.setdefault(o.customer_code, []).append(o)
    claims = dict(db.execute(select(Claim.customer_code, func.count()).where(Claim.status != "CLOSED")
                             .group_by(Claim.customer_code)).all())
    ytd_sum: dict[str, float] = {}  # 올해 누적 매출(이력 + 이번 달 발행분)
    for m in db.scalars(select(MonthlyStat).where(MonthlyStat.metric == "sales_amt", MonthlyStat.dim != "",
                                                  MonthlyStat.ym.like(f"{now():%Y}-%"))):
        ytd_sum[m.dim] = ytd_sum.get(m.dim, 0) + m.value
    for inv in db.scalars(select(TaxInvoice).where(TaxInvoice.status == "ISSUED")):
        ytd_sum[inv.customer_code] = ytd_sum.get(inv.customer_code, 0) + inv.supply_amount
    out = []
    for p in db.scalars(select(Partner).where(Partner.partner_type == "CUSTOMER").order_by(Partner.code)):
        os_ = orders.get(p.code, [])
        a = ar.get(p.code, {})
        out.append({
            "code": p.code, "name": p.name, "biz_no": p.biz_no, "industry": p.industry,
            "region": REGION.get(p.code, "-"), "orders": len(os_),
            "open_orders": sum(1 for o in os_ if o.status != "CLOSED"),
            "order_amount": sum(o.total_amount for o in os_),
            "last_order": max((o.order_date for o in os_), default=None),
            "sales_ytd": round(ytd_sum.get(p.code, 0)), "receivable": round(a.get("balance", 0)),
            "open_claims": claims.get(p.code, 0),
        })
    return out


# ---------------------------------------------------------------- 수주전용
@router.get("/allocation")
def allocation(db: Session = Depends(get_db)):
    """여유 제품재고와, 재고로 바로 출하할 수 있는 접수 수주."""
    free = ops_hooks.free_product_stock(db)
    names, partners = item_names(db), partner_names(db)
    cands = []
    for o in db.scalars(select(SalesOrder).options(selectinload(SalesOrder.lines))
                        .where(SalesOrder.status == "RECEIVED").order_by(SalesOrder.id)):
        lines = [{"item_code": ln.item_code, "item_name": names.get(ln.item_code), "qty": ln.qty,
                  "free": free.get(ln.item_code, 0)} for ln in o.lines]
        cover = sum(min(ln["qty"], ln["free"]) for ln in lines)
        cands.append({"order_no": o.order_no, "customer_name": partners.get(o.customer_code), "due_date": o.due_date,
                      "lines": lines, "coverable": all(ln["free"] >= ln["qty"] for ln in lines),
                      "cover_rate": cover / sum(ln["qty"] for ln in lines) if lines else 0})
    allocs = [{"order_no": "", **row(a)} for a in db.scalars(select(OrderAllocation).order_by(OrderAllocation.id.desc()))]
    order_no = {o.id: o.order_no for o in db.scalars(select(SalesOrder))}
    for a in allocs:
        a["order_no"] = order_no.get(a["order_id"], "")
        a["item_name"] = names.get(a["item_code"])
    return {"free_stock": [{"item_code": k, "item_name": names.get(k), "qty": v} for k, v in sorted(free.items())],
            "candidates": sorted(cands, key=lambda c: -c["cover_rate"]), "history": allocs}


class AllocIn(BaseModel):
    order_no: str


@router.post("/allocation")
def allocate(body: AllocIn, db: Session = Depends(get_db)):
    o = db.scalar(select(SalesOrder).options(selectinload(SalesOrder.lines)).where(SalesOrder.order_no == body.order_no))
    if not o:
        raise HTTPException(404, "수주 없음")
    if o.status != "RECEIVED":
        raise HTTPException(400, "수주접수 상태만 재고 전용할 수 있습니다")
    free = ops_hooks.free_product_stock(db)
    short = [ln.item_code for ln in o.lines if free.get(ln.item_code, 0) < ln.qty]
    if short:
        raise HTTPException(400, f"여유재고 부족: {', '.join(short)}")
    for ln in o.lines:
        db.add(OrderAllocation(order_id=o.id, item_code=ln.item_code, qty=ln.qty))
    o.status = "PRODUCED"
    db.commit()
    events.publish("sales_order", {"order_no": o.order_no, "status": o.status})
    gateway.send(db, "IF-OMS-02", {"oms_order_no": o.oms_order_no, "erp_order_no": o.order_no,
                                   "status": "생산완료(재고 전용)"})
    return {"order_no": o.order_no, "status": o.status}


# ---------------------------------------------------------------- 판매관리
@router.get("/ledger")
def ledger(db: Session = Depends(get_db)):
    """판매 원장: 출하 → 마감 → 계산서 발행까지 판매 건별 현황."""
    partners = partner_names(db)
    out = []
    invs = {i.order_id: i for i in db.scalars(select(TaxInvoice))}
    for sh in db.scalars(select(Shipment).options(selectinload(Shipment.lines)).order_by(Shipment.id.desc())):
        o = db.get(SalesOrder, sh.order_id)
        if not o:
            continue
        price = {ln.item_code: ln.unit_price for ln in o.lines}
        supply = sum(ln.qty * price.get(ln.item_code, 0) for ln in sh.lines)
        inv = invs.get(o.id)
        out.append({"shipment_no": sh.shipment_no, "order_no": o.order_no,
                    "customer_name": partners.get(o.customer_code), "qty": sum(ln.qty for ln in sh.lines),
                    "supply_amount": round(supply), "shipped_at": sh.shipped_at, "ship_status": sh.status,
                    "invoice_no": inv.invoice_no if inv else None, "invoice_status": inv.status if inv else None,
                    "stage": "계산서 발행" if inv and inv.status == "ISSUED" else (
                        "마감 요청" if inv else ("출하 완료" if sh.status == "SHIPPED" else "출하 진행"))})
    return out


# ---------------------------------------------------------------- 수금
@router.get("/receivables")
def receivables(db: Session = Depends(get_db)):
    out = list(_receivables(db).values())
    receipts = [row(r) | {"customer_name": partner_names(db).get(r.customer_code)}
                for r in db.scalars(select(Receipt).order_by(Receipt.id.desc()))]
    return {"customers": out, "receipts": receipts}


class ReceiptIn(BaseModel):
    customer_code: str
    invoice_no: str | None = None
    amount: float = Field(gt=0)
    method: str = "계좌이체"


@router.post("/receipts")
def add_receipt(body: ReceiptIn, db: Session = Depends(get_db)):
    ar = _receivables(db).get(body.customer_code)
    if not ar:
        raise HTTPException(400, "거래처 없음")
    if body.invoice_no:
        inv = next((i for i in ar["invoices"] if i["invoice_no"] == body.invoice_no), None)
        if not inv:
            raise HTTPException(400, "해당 거래처의 발행 세금계산서가 아닙니다")
        left = inv["left"]
    else:
        left = ar["opening_left"]
    if body.amount > left + 0.5:
        raise HTTPException(400, f"미수 잔액({left:,.0f}원)보다 많습니다")
    r = Receipt(receipt_no=_next_no(db, Receipt, Receipt.receipt_no, "RC"), customer_code=body.customer_code,
                invoice_no=body.invoice_no, amount=body.amount, method=body.method)
    db.add(r)
    db.commit()
    events.publish("receipt", {"receipt_no": r.receipt_no})
    return {"receipt_no": r.receipt_no}


# ---------------------------------------------------------------- 크레임
CLAIM_STATUS = {"RECEIVED": "접수", "INVESTIGATING": "원인 조사", "CLOSED": "종결"}


@router.get("/claims")
def claims(db: Session = Depends(get_db)):
    partners, names = partner_names(db), item_names(db)
    return [row(c) | {"customer_name": partners.get(c.customer_code), "item_name": names.get(c.item_code or ""),
                      "status_name": CLAIM_STATUS.get(c.status, c.status)}
            for c in db.scalars(select(Claim).order_by(Claim.id.desc()))]


class ClaimIn(BaseModel):
    customer_code: str
    order_no: str | None = None
    item_code: str | None = None
    claim_type: str
    qty: int = Field(ge=0, default=0)
    description: str = Field(min_length=1)


@router.post("/claims")
def add_claim(body: ClaimIn, db: Session = Depends(get_db)):
    c = Claim(claim_no=_next_no(db, Claim, Claim.claim_no, "CL"), **body.model_dump())
    db.add(c)
    db.commit()
    events.publish("claim", {"claim_no": c.claim_no})
    return {"claim_no": c.claim_no}


class ClaimStepIn(BaseModel):
    status: str
    cause: str | None = None
    action_text: str | None = None
    amount: float | None = Field(default=None, ge=0)


@router.post("/claims/{claim_no}/step")
def claim_step(claim_no: str, body: ClaimStepIn, db: Session = Depends(get_db)):
    c = db.scalar(select(Claim).where(Claim.claim_no == claim_no))
    if not c:
        raise HTTPException(404)
    if body.status not in CLAIM_STATUS:
        raise HTTPException(400, "상태 오류")
    if body.status == "CLOSED" and not (body.action_text or c.action_text):
        raise HTTPException(400, "종결하려면 대책을 입력하세요")
    c.status = body.status
    c.cause = body.cause or c.cause
    c.action_text = body.action_text or c.action_text
    if body.amount is not None:
        c.amount = body.amount
    if body.status == "CLOSED":
        c.closed_at = now()
    db.commit()
    events.publish("claim", {"claim_no": c.claim_no, "status": c.status})
    return row(c)
