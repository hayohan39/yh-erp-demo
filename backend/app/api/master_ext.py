"""기준정보 확장: 공통항목, 원가 기준(원재료비·가공비·운반비), 단가관리, 창고·부자재."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api._util import partner_names, row
from app.db import get_db
from app.models import CommonCode, CostRate, ItemBox, PaperGrade, PriceHistory, SubMaterial, Warehouse
from app.services import events

router = APIRouter(prefix="/api/master", tags=["기준정보"])

GROUP_NAMES = {
    "ORDER_STATUS": "수주 상태", "PROCESS": "공정", "CLAIM_TYPE": "크레임 유형", "EXPENSE_CAT": "경비 항목",
    "DEFECT_TYPE": "불량 유형", "FLUTE": "골 종류", "BOX_STYLE": "상자 형식", "SITE": "사업장",
}


@router.get("/codes")
def all_codes(db: Session = Depends(get_db)):
    groups: dict[str, list] = {}
    for c in db.scalars(select(CommonCode).order_by(CommonCode.group_code, CommonCode.sort_order)):
        groups.setdefault(c.group_code, []).append({"code": c.code, "name": c.name, "sort_order": c.sort_order})
    return [{"group_code": g, "group_name": GROUP_NAMES.get(g, g), "codes": v} for g, v in groups.items()]


class CodeIn(BaseModel):
    group_code: str = Field(min_length=1, max_length=30)
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=100)


@router.post("/codes")
def add_code(body: CodeIn, db: Session = Depends(get_db)):
    g = body.group_code.strip().upper()
    if db.scalar(select(CommonCode).where(CommonCode.group_code == g, CommonCode.code == body.code)):
        raise HTTPException(400, "이미 있는 코드입니다")
    n = len(list(db.scalars(select(CommonCode).where(CommonCode.group_code == g))))
    db.add(CommonCode(group_code=g, code=body.code.strip(), name=body.name.strip(), sort_order=n))
    db.commit()
    return {"ok": True}


@router.get("/cost-rates")
def cost_rates(group: str | None = None, db: Session = Depends(get_db)):
    q = select(CostRate).order_by(CostRate.sort_order)
    if group:
        q = q.where(CostRate.group_code.in_(group.split(",")))
    return [row(c) for c in db.scalars(q)]


class ValueIn(BaseModel):
    value: float = Field(ge=0)


@router.put("/cost-rates/{key}")
def set_cost_rate(key: str, body: ValueIn, db: Session = Depends(get_db)):
    c = db.scalar(select(CostRate).where(CostRate.key == key))
    if not c:
        raise HTTPException(404)
    if c.unit == "비율" and body.value >= 1:
        raise HTTPException(400, "비율은 0~1 사이로 입력하세요 (예: 3% → 0.03)")
    db.add(PriceHistory(kind="RATE", code=key, old_price=c.value, new_price=body.value, reason=c.label))
    c.value = body.value
    db.commit()
    events.publish("master", {"kind": "cost_rate", "key": key})
    return row(c)


@router.get("/prices")
def prices(db: Session = Depends(get_db)):
    """단가관리: 상자 판매단가·표준원가·마진, 원지 kg단가, 부자재 단가."""
    names = partner_names(db)
    last = {}
    for h in db.scalars(select(PriceHistory).order_by(PriceHistory.id)):
        last[(h.kind, h.code)] = h.changed_at
    items = [{
        "code": i.code, "name": i.name, "customer_name": names.get(i.customer_code, i.customer_code),
        "unit_price": i.unit_price, "std_cost": i.std_cost,
        "margin": round(1 - i.std_cost / i.unit_price, 4) if i.unit_price else None,
        "changed_at": last.get(("ITEM", i.code)),
    } for i in db.scalars(select(ItemBox).order_by(ItemBox.code))]
    papers = [{"code": g.code, "name": g.name, "paper_kind": g.paper_kind, "basis_weight": g.basis_weight,
               "price": g.price_per_kg, "changed_at": last.get(("PAPER", g.code))}
              for g in db.scalars(select(PaperGrade).order_by(PaperGrade.code))]
    subs = [{"code": s.code, "name": s.name, "unit": s.unit, "price": s.unit_price,
             "supplier_name": names.get(s.supplier_code, s.supplier_code), "changed_at": last.get(("SUB", s.code))}
            for s in db.scalars(select(SubMaterial).order_by(SubMaterial.code))]
    return {"items": items, "papers": papers, "subs": subs}


class PriceIn(BaseModel):
    price: float = Field(gt=0)
    reason: str | None = None


@router.put("/prices/{kind}/{code}")
def set_price(kind: str, code: str, body: PriceIn, db: Session = Depends(get_db)):
    model, col = {"item": (ItemBox, "unit_price"), "paper": (PaperGrade, "price_per_kg"),
                  "sub": (SubMaterial, "unit_price")}.get(kind, (None, None))
    if not model:
        raise HTTPException(404)
    obj = db.scalar(select(model).where(model.code == code))
    if not obj:
        raise HTTPException(404, "코드 없음")
    old = getattr(obj, col)
    setattr(obj, col, body.price)
    db.add(PriceHistory(kind=kind.upper(), code=code, old_price=old, new_price=body.price, reason=body.reason))
    db.commit()
    events.publish("master", {"kind": kind, "code": code})
    return {"code": code, "old": old, "new": body.price}


@router.get("/price-history")
def price_history(db: Session = Depends(get_db)):
    return [row(h) for h in db.scalars(select(PriceHistory).order_by(PriceHistory.id.desc()).limit(200))]


@router.get("/warehouses")
def warehouses(db: Session = Depends(get_db)):
    return [row(w) for w in db.scalars(select(Warehouse).order_by(Warehouse.id))]


@router.get("/sub-materials")
def sub_materials(db: Session = Depends(get_db)):
    names = partner_names(db)
    return [row(s) | {"supplier_name": names.get(s.supplier_code)} for s in db.scalars(select(SubMaterial))]
