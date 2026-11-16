from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._types import now, pk


class SalesOrder(Base):
    """수주. OMS에서 IF-OMS-01로 받은 주문이 여기로 들어온다."""

    __tablename__ = "sales_order"

    id: Mapped[int] = pk()
    order_no: Mapped[str] = mapped_column(String(20), unique=True)
    oms_order_no: Mapped[str] = mapped_column(String(30), unique=True)
    customer_code: Mapped[str] = mapped_column(String(20), index=True)
    order_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(15), default="RECEIVED")
    total_amount: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    lines: Mapped[list["SalesOrderLine"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="SalesOrderLine.line_no"
    )


class SalesOrderLine(Base):
    __tablename__ = "sales_order_line"

    id: Mapped[int] = pk()
    order_id: Mapped[int] = mapped_column(ForeignKey("sales_order.id"), index=True)
    line_no: Mapped[int] = mapped_column(Integer)
    item_code: Mapped[str] = mapped_column(String(20))
    qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Float)
    amount: Mapped[float] = mapped_column(Float)

    order: Mapped[SalesOrder] = relationship(back_populates="lines")
