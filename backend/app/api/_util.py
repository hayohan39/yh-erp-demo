from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ItemBox, PaperGrade, Partner, SubMaterial, Warehouse


def row(obj: Any) -> dict[str, Any]:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def partner_names(db: Session) -> dict[str, str]:
    return {p.code: p.name for p in db.scalars(select(Partner))}


def item_names(db: Session) -> dict[str, str]:
    return {i.code: i.name for i in db.scalars(select(ItemBox))}


def stock_item_names(db: Session) -> dict[str, dict[str, str]]:
    """재고 구분별 품목명·단위."""
    return {
        "PAPER": {g.code: g.name for g in db.scalars(select(PaperGrade))},
        "PRODUCT": item_names(db),
        "SUB": {s.code: s.name for s in db.scalars(select(SubMaterial))},
    }


def warehouse_names(db: Session) -> dict[str, str]:
    return {w.code: w.name for w in db.scalars(select(Warehouse))}
