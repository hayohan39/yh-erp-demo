"""재고 공통: 창고별 재고, 입출고 원장, 창고·사업장 이동, 재고조정(실사)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api._util import stock_item_names, warehouse_names
from app.db import get_db
from app.models import PaperPolicy, StockBalance, StockMove, SubMaterial, Warehouse
from app.services import inventory

router = APIRouter(prefix="/api/inventory", tags=["재고"])


@router.get("/balances")
def balances(kind: str = "PAPER", db: Session = Depends(get_db)):
    if kind not in inventory.KINDS:
        raise HTTPException(400, "kind = PAPER / PRODUCT / SUB")
    whs = list(db.scalars(select(Warehouse).where(Warehouse.kind == kind).order_by(Warehouse.id)))
    names = stock_item_names(db)[kind]
    safety: dict[str, float] = {}
    units: dict[str, str] = {}
    if kind == "PAPER":
        safety = {p.paper_code: p.safety_kg for p in db.scalars(select(PaperPolicy))}
    elif kind == "SUB":
        for s in db.scalars(select(SubMaterial)):
            safety[s.code], units[s.code] = s.safety_qty, s.unit
    rows: dict[str, dict] = {}
    for b in db.scalars(select(StockBalance).where(StockBalance.kind == kind)):
        r = rows.setdefault(b.item_code, {"item_code": b.item_code, "item_name": names.get(b.item_code, b.item_code),
                                          "by_wh": {}, "total": 0.0})
        r["by_wh"][b.warehouse_code] = round(b.qty, 1)
        r["total"] += b.qty
    out = []
    for code, r in sorted(rows.items()):
        if kind == "PRODUCT" and abs(r["total"]) < 0.5:
            continue
        r["total"] = round(r["total"], 1)
        r["unit"] = units.get(code, inventory.UNITS.get(kind, ""))
        r["safety"] = safety.get(code)
        r["short"] = r["safety"] is not None and r["total"] < r["safety"]
        out.append(r)
    return {"warehouses": [{"code": w.code, "name": w.name, "site": w.site} for w in whs], "rows": out}


@router.get("/moves")
def moves(kind: str | None = None, move_type: str | None = None, limit: int = 300, db: Session = Depends(get_db)):
    q = select(StockMove).order_by(StockMove.id.desc()).limit(min(limit, 1000))
    if kind:
        q = q.where(StockMove.kind == kind)
    if move_type:
        q = q.where(StockMove.move_type.in_(move_type.split(",")))
    names, whs = stock_item_names(db), warehouse_names(db)
    return [{
        "move_no": m.move_no, "kind": m.kind, "move_type": m.move_type,
        "move_type_name": inventory.MOVE_TYPES[m.move_type], "item_code": m.item_code,
        "item_name": names.get(m.kind, {}).get(m.item_code, m.item_code), "qty": m.qty,
        "from_wh": whs.get(m.from_wh or "", m.from_wh), "to_wh": whs.get(m.to_wh or "", m.to_wh),
        "ref_no": m.ref_no, "reason": m.reason, "created_at": m.created_at,
    } for m in db.scalars(q)]


class TransferIn(BaseModel):
    kind: str
    item_code: str
    from_wh: str
    to_wh: str
    qty: float = Field(gt=0)
    reason: str | None = None


@router.post("/transfer")
def transfer(body: TransferIn, db: Session = Depends(get_db)):
    try:
        a, b = inventory.warehouse(db, body.from_wh), inventory.warehouse(db, body.to_wh)
        label = "사업장 이동" if a.site != b.site else "창고 이동"
        m = inventory.move(db, body.kind, "TRANSFER", body.item_code, body.qty, from_wh=body.from_wh,
                           to_wh=body.to_wh, reason=body.reason or label)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.commit()
    return {"move_no": m.move_no, "label": label}


class AdjustIn(BaseModel):
    kind: str
    item_code: str
    warehouse_code: str
    actual_qty: float = Field(ge=0)
    reason: str = "재고 실사"


@router.post("/adjust")
def adjust(body: AdjustIn, db: Session = Depends(get_db)):
    """실사 수량을 입력하면 장부와의 차이만큼 조정한다."""
    cur = db.scalar(select(StockBalance.qty).where(
        StockBalance.kind == body.kind, StockBalance.item_code == body.item_code,
        StockBalance.warehouse_code == body.warehouse_code)) or 0
    delta = round(body.actual_qty - cur, 2)
    if delta == 0:
        raise HTTPException(400, "장부 수량과 같습니다")
    try:
        inventory.warehouse(db, body.warehouse_code)
        m = inventory.move(db, body.kind, "ADJUST", body.item_code, delta, to_wh=body.warehouse_code,
                           reason=body.reason)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.commit()
    return {"move_no": m.move_no, "delta": delta}
