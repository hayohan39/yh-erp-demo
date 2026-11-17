from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import SalesOrder
from app.services import costing

router = APIRouter(prefix="/api/cost", tags=["원가분석"])


class QuoteIn(BaseModel):
    length_mm: int = Field(gt=0)
    width_mm: int = Field(gt=0)
    height_mm: int = Field(gt=0)
    board_spec_code: str
    print_colors: int = Field(ge=0, le=6, default=0)
    qty: int = Field(gt=0)
    margin: float = Field(ge=0, lt=0.9, default=0.15)


@router.get("/orders")
def orders(db: Session = Depends(get_db)):
    return costing.cost_list(db)


@router.get("/orders/{order_no}")
def order(order_no: str, db: Session = Depends(get_db)):
    o = db.scalar(select(SalesOrder).options(selectinload(SalesOrder.lines)).where(SalesOrder.order_no == order_no))
    if not o:
        raise HTTPException(404, "수주 없음")
    return costing.order_cost(db, o)


@router.post("/quote")
def quote(body: QuoteIn, db: Session = Depends(get_db)):
    try:
        return costing.quote(db, body.length_mm, body.width_mm, body.height_mm, body.board_spec_code,
                             body.print_colors, body.qty, body.margin)
    except ValueError as e:
        raise HTTPException(400, str(e))
