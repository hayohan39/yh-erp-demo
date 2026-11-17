"""재고 원장: 원지(kg)·제품(매)·부자재를 창고별로 관리하고 모든 변동을 stock_move에 남긴다.

제품은 기존 product_stock(품목별 합계)도 함께 맞춘다. 출하·수주전용 로직은 합계를 기준으로 한다.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ProductStock, StockBalance, StockMove, Warehouse
from app.services import events

KINDS = {"PAPER": "원지", "PRODUCT": "제품", "SUB": "부자재"}
UNITS = {"PAPER": "kg", "PRODUCT": "매"}
DEFAULT_WH = {"PAPER": "RP1A", "PRODUCT": "FG1", "SUB": "SB1"}
MOVE_TYPES = {"IN": "입고", "OUT": "출고", "TRANSFER": "이동", "ADJUST": "조정"}


def _balance(db: Session, kind: str, item_code: str, wh: str) -> StockBalance:
    b = db.scalar(select(StockBalance).where(StockBalance.kind == kind, StockBalance.item_code == item_code,
                                             StockBalance.warehouse_code == wh))
    if not b:
        b = StockBalance(kind=kind, item_code=item_code, warehouse_code=wh, qty=0)
        db.add(b)
        db.flush()
    return b


def _move_no(db: Session) -> str:
    p = f"MV{date.today():%y%m%d}"
    n = db.scalar(select(func.count()).select_from(StockMove).where(StockMove.move_no.like(f"{p}%"))) or 0
    return f"{p}{n + 1:04d}"


def _sync_product_total(db: Session, item_code: str, delta: float) -> None:
    s = db.scalar(select(ProductStock).where(ProductStock.item_code == item_code))
    if not s:
        s = ProductStock(item_code=item_code, qty=0)
        db.add(s)
    s.qty = int(round((s.qty or 0) + delta))


def warehouse(db: Session, code: str) -> Warehouse:
    wh = db.scalar(select(Warehouse).where(Warehouse.code == code))
    if not wh:
        raise ValueError(f"창고 없음: {code}")
    return wh


def move(db: Session, kind: str, move_type: str, item_code: str, qty: float, *, from_wh: str | None = None,
         to_wh: str | None = None, ref_no: str | None = None, reason: str | None = None,
         publish: bool = True) -> StockMove:
    """재고 변동 1건. ADJUST의 qty는 증감(+/-), 나머지는 양수. 커밋은 호출한 쪽이 한다."""
    if kind not in KINDS or move_type not in MOVE_TYPES:
        raise ValueError("재고 구분 오류")
    if move_type != "ADJUST" and qty <= 0:
        raise ValueError("수량은 0보다 커야 합니다")
    if move_type == "IN":
        to_wh = to_wh or DEFAULT_WH[kind]
        _balance(db, kind, item_code, to_wh).qty += qty
    elif move_type == "OUT":
        if not from_wh:  # 지정이 없으면 재고가 가장 많은 창고에서 출고
            from_wh = db.scalar(select(StockBalance.warehouse_code).where(
                StockBalance.kind == kind, StockBalance.item_code == item_code).order_by(StockBalance.qty.desc())
                .limit(1)) or DEFAULT_WH[kind]
        _balance(db, kind, item_code, from_wh).qty -= qty
    elif move_type == "TRANSFER":
        if not from_wh or not to_wh or from_wh == to_wh:
            raise ValueError("보내는 창고와 받는 창고를 다르게 지정하세요")
        a, b = warehouse(db, from_wh), warehouse(db, to_wh)
        if a.kind != kind or b.kind != kind:
            raise ValueError(f"{KINDS[kind]} 창고끼리만 이동할 수 있습니다")
        src = _balance(db, kind, item_code, from_wh)
        if src.qty < qty:
            raise ValueError(f"{a.name} 재고 부족 (현재 {src.qty:,.0f})")
        src.qty -= qty
        _balance(db, kind, item_code, to_wh).qty += qty
    else:  # ADJUST
        wh = to_wh or from_wh or DEFAULT_WH[kind]
        bal = _balance(db, kind, item_code, wh)
        if bal.qty + qty < 0:
            raise ValueError(f"조정 후 재고가 음수가 됩니다 (현재 {bal.qty:,.0f})")
        bal.qty += qty
        to_wh = wh
    if kind == "PRODUCT" and move_type != "TRANSFER":
        _sync_product_total(db, item_code, qty if move_type in ("IN", "ADJUST") else -qty)
    m = StockMove(move_no=_move_no(db), kind=kind, move_type=move_type, item_code=item_code, from_wh=from_wh,
                  to_wh=to_wh if move_type != "OUT" else None, qty=qty, ref_no=ref_no, reason=reason)
    db.add(m)
    db.flush()
    if publish:
        events.publish("stock", {"kind": kind, "move_type": move_type, "item_code": item_code, "qty": qty})
    return m


def total(db: Session, kind: str, item_code: str) -> float:
    return float(db.scalar(select(func.coalesce(func.sum(StockBalance.qty), 0)).where(
        StockBalance.kind == kind, StockBalance.item_code == item_code)) or 0)
