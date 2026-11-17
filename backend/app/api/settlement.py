from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Partner, SalesOrder, Shipment, TaxInvoice
from app.services import settlement

router = APIRouter(prefix="/api/settlement", tags=["매출·정산"])


class CloseIn(BaseModel):
    order_nos: list[str] | None = None


@router.get("/closable")
def closable(db: Session = Depends(get_db)):
    """매출 마감 대상: 출하완료 수주."""
    partners = {p.code: p.name for p in db.scalars(select(Partner))}
    out = []
    for o in db.scalars(select(SalesOrder).where(SalesOrder.status == "SHIPPED").order_by(SalesOrder.id)):
        sh = db.scalar(select(Shipment).where(Shipment.order_id == o.id))
        price = {ln.item_code: ln.unit_price for ln in o.lines}
        supply = round(sum(ln.qty * price.get(ln.item_code, 0) for ln in sh.lines)) if sh else round(o.total_amount)
        out.append({"order_no": o.order_no, "customer_name": partners.get(o.customer_code, o.customer_code),
                    "shipment_no": sh.shipment_no if sh else None, "shipped_at": sh.shipped_at if sh else None,
                    "supply_amount": supply, "vat_amount": round(supply * settlement.VAT_RATE),
                    "order_amount": o.total_amount})
    return out


@router.post("/close")
def close(body: CloseIn, db: Session = Depends(get_db)):
    try:
        invs = settlement.close_sales(db, body.order_nos)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"invoices": [i.invoice_no for i in invs]}


@router.get("/invoices")
def invoices(db: Session = Depends(get_db)):
    partners = {p.code: p for p in db.scalars(select(Partner))}
    orders = {o.id: o.order_no for o in db.scalars(select(SalesOrder))}
    return [{
        "invoice_no": i.invoice_no, "order_no": orders.get(i.order_id, ""),
        "customer_name": partners[i.customer_code].name if i.customer_code in partners else i.customer_code,
        "biz_no": partners[i.customer_code].biz_no if i.customer_code in partners else "",
        "supply_amount": i.supply_amount, "vat_amount": i.vat_amount, "total_amount": i.total_amount,
        "status": i.status, "nts_approval_no": i.nts_approval_no, "voucher_exported": bool(i.voucher_exported),
        "created_at": i.created_at, "issued_at": i.issued_at,
    } for i in db.scalars(select(TaxInvoice).order_by(TaxInvoice.id.desc()))]


@router.get("/vouchers")
def vouchers(db: Session = Depends(get_db)):
    return settlement.voucher_rows(db)


@router.post("/vouchers/export")
def export(db: Session = Depends(get_db)):
    """새 전표를 더존 업로드용 CSV로 내보낸다(IF-EXT-05 기록)."""
    try:
        r = settlement.export_vouchers(db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return Response(content=r["csv"].encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{r["file_name"]}"',
                             "X-Voucher-Count": str(r["vouchers"])})
