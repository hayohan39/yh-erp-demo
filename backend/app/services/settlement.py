"""매출 마감·전자세금계산서·회계 전표.

출하완료 수주 마감 → 위아고 발행요청(IF-EXT-01) → 국세청 승인번호 콜백 → OMS 매출마감(IF-OMS-03), 수주 마감.
더존은 수작업 연계라 전표를 엑셀(CSV)로 내보내고 그 사실을 IF-EXT-05로 기록한다.
"""
from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.interfaces import gateway
from app.interfaces.gateway import handles
from app.models import Partner, SalesOrder, Shipment, TaxInvoice
from app.models._types import now
from app.services import events
from app.services.planning import _next_no

VAT_RATE = 0.1


def close_sales(db: Session, order_nos: list[str] | None = None) -> list[TaxInvoice]:
    """출하완료(SHIPPED) 수주를 마감하고 세금계산서 발행을 요청한다. order_nos가 없으면 전체."""
    q = select(SalesOrder).where(SalesOrder.status == "SHIPPED")
    if order_nos:
        q = q.where(SalesOrder.order_no.in_(order_nos))
    orders = list(db.scalars(q))
    if not orders:
        raise ValueError("마감할 출하완료 수주가 없습니다")
    partners = {p.code: p for p in db.scalars(select(Partner))}
    invoices = []
    for o in orders:
        sh = db.scalar(select(Shipment).where(Shipment.order_id == o.id, Shipment.status == "SHIPPED"))
        # 공급가액 = 실제 출하 수량 × 단가 (불량으로 덜 나간 수량은 청구하지 않음)
        price = {ln.item_code: ln.unit_price for ln in o.lines}
        supply = round(sum(ln.qty * price.get(ln.item_code, 0) for ln in sh.lines)) if sh else round(o.total_amount)
        vat = round(supply * VAT_RATE)
        inv = TaxInvoice(invoice_no=_next_no(db, TaxInvoice, TaxInvoice.invoice_no, "TI"), order_id=o.id,
                         customer_code=o.customer_code, supply_amount=supply, vat_amount=vat,
                         total_amount=supply + vat)
        db.add(inv)
        o.status = "INVOICING"
        db.flush()
        invoices.append((inv, o))
    db.commit()
    for inv, o in invoices:
        c = partners.get(o.customer_code)
        events.publish("sales_order", {"order_no": o.order_no, "status": o.status})
        gateway.send(db, "IF-EXT-01", {
            "invoice_no": inv.invoice_no, "erp_order_no": o.order_no, "issue_date": date.today().isoformat(),
            "supplier": {"name": "YH 패키징", "biz_no": "123-45-67890"},
            "buyer": {"name": c.name if c else o.customer_code, "biz_no": c.biz_no if c else ""},
            "supply_amount": inv.supply_amount, "vat_amount": inv.vat_amount, "total_amount": inv.total_amount,
        })
    return [inv for inv, _ in invoices]


@handles("IF-EXT-01")
def weago_callback(db: Session, p: dict[str, Any]) -> dict[str, Any]:
    """위아고 콜백: 국세청 승인번호 수신 → 발행 완료, OMS에 매출마감 통보, 수주 마감."""
    inv = db.scalar(select(TaxInvoice).where(TaxInvoice.invoice_no == p["invoice_no"]))
    if not inv:
        raise ValueError(f"세금계산서 없음: {p['invoice_no']}")
    if inv.status == "ISSUED":
        return {"invoice_no": inv.invoice_no}
    inv.status = "ISSUED"
    inv.nts_approval_no = p["nts_approval_no"]
    inv.issued_at = now()
    order = db.get(SalesOrder, inv.order_id)
    order.status = "CLOSED"
    db.flush()
    events.publish("invoice", {"invoice_no": inv.invoice_no, "order_no": order.order_no, "status": inv.status})
    events.publish("sales_order", {"order_no": order.order_no, "status": order.status})
    return {"invoice_no": inv.invoice_no, "_send": [("IF-OMS-03", {
        "oms_order_no": order.oms_order_no, "erp_order_no": order.order_no, "invoice_no": inv.invoice_no,
        "nts_approval_no": inv.nts_approval_no, "supply_amount": inv.supply_amount, "vat_amount": inv.vat_amount,
        "status": "매출마감",
    })]}


# ---------------------------------------------------------------- 더존 전표
def voucher_rows(db: Session, only_new: bool = False) -> list[dict[str, Any]]:
    """발행 완료 세금계산서 → 매출 전표(차변 외상매출금 / 대변 제품매출·부가세예수금)."""
    q = select(TaxInvoice).where(TaxInvoice.status == "ISSUED").order_by(TaxInvoice.id)
    if only_new:
        q = q.where(TaxInvoice.voucher_exported == 0)
    partners = {p.code: p.name for p in db.scalars(select(Partner))}
    rows = []
    for n, inv in enumerate(db.scalars(q), start=1):
        d = (inv.issued_at or inv.created_at).date().isoformat()
        name = partners.get(inv.customer_code, inv.customer_code)
        memo = f"{name} 제품매출 {inv.invoice_no}"
        rows += [
            {"voucher_no": n, "date": d, "side": "차변", "account_code": "10800", "account_name": "외상매출금",
             "partner": name, "debit": inv.total_amount, "credit": 0, "memo": memo, "invoice_no": inv.invoice_no},
            {"voucher_no": n, "date": d, "side": "대변", "account_code": "40100", "account_name": "제품매출",
             "partner": name, "debit": 0, "credit": inv.supply_amount, "memo": memo, "invoice_no": inv.invoice_no},
            {"voucher_no": n, "date": d, "side": "대변", "account_code": "25500", "account_name": "부가세예수금",
             "partner": name, "debit": 0, "credit": inv.vat_amount, "memo": memo, "invoice_no": inv.invoice_no},
        ]
    return rows


def voucher_csv(rows: list[dict[str, Any]]) -> str:
    """더존 일반전표 업로드 양식(CSV, 엑셀에서 바로 열리도록 BOM 포함)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["전표번호", "일자", "구분", "계정코드", "계정과목", "거래처", "차변", "대변", "적요"])
    for r in rows:
        w.writerow([r["voucher_no"], r["date"], r["side"], r["account_code"], r["account_name"], r["partner"],
                    int(r["debit"]), int(r["credit"]), r["memo"]])
    return "﻿" + buf.getvalue()


def export_vouchers(db: Session) -> dict[str, Any]:
    """아직 내보내지 않은 전표를 묶어 더존 연계(IF-EXT-05)로 기록하고 파일 내용을 돌려준다."""
    rows = voucher_rows(db, only_new=True)
    if not rows:
        raise ValueError("새로 내보낼 전표가 없습니다 (세금계산서 발행 완료 건 없음)")
    invoice_nos = sorted({r["invoice_no"] for r in rows})
    for inv in db.scalars(select(TaxInvoice).where(TaxInvoice.invoice_no.in_(invoice_nos))):
        inv.voucher_exported = 1
    db.commit()
    file_name = f"douzone_voucher_{now():%Y%m%d_%H%M%S}.csv"
    gateway.send(db, "IF-EXT-05", {
        "file_name": file_name, "vouchers": len(invoice_nos), "lines": len(rows),
        "debit_total": sum(r["debit"] for r in rows), "credit_total": sum(r["credit"] for r in rows),
    })
    events.publish("voucher", {"file_name": file_name, "vouchers": len(invoice_nos)})
    return {"file_name": file_name, "vouchers": len(invoice_nos), "csv": voucher_csv(rows)}
