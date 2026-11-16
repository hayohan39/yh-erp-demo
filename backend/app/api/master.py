from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import BoardSpec, CommonCode, Equipment, ItemBox, PaperGrade, Partner

router = APIRouter(prefix="/api/master", tags=["기준정보"])


def _rows(db: Session, model, *order):
    return [
        {c.name: getattr(r, c.name) for c in model.__table__.columns}
        for r in db.scalars(select(model).order_by(*order))
    ]


@router.get("/partners")
def partners(partner_type: str | None = None, db: Session = Depends(get_db)):
    rows = _rows(db, Partner, Partner.code)
    return [r for r in rows if not partner_type or r["partner_type"] == partner_type]


@router.get("/items")
def items(db: Session = Depends(get_db)):
    return _rows(db, ItemBox, ItemBox.code)


@router.get("/paper-grades")
def paper_grades(db: Session = Depends(get_db)):
    return _rows(db, PaperGrade, PaperGrade.code)


@router.get("/board-specs")
def board_specs(db: Session = Depends(get_db)):
    return _rows(db, BoardSpec, BoardSpec.code)


@router.get("/equipment")
def equipment(db: Session = Depends(get_db)):
    return _rows(db, Equipment, Equipment.code)


@router.get("/codes/{group_code}")
def codes(group_code: str, db: Session = Depends(get_db)):
    q = select(CommonCode).where(CommonCode.group_code == group_code).order_by(CommonCode.sort_order)
    return [{"code": c.code, "name": c.name} for c in db.scalars(q)]
