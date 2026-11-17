from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._types import now, pk


class Shipment(Base):
    """출하. 출하요청 → 로지스팟 배차(DISPATCHED) → 상차·출발(SHIPPED)."""

    __tablename__ = "shipment"

    id: Mapped[int] = pk()
    shipment_no: Mapped[str] = mapped_column(String(20), unique=True)
    order_id: Mapped[int] = mapped_column(Integer, index=True)
    customer_code: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(12), default="REQUESTED")  # REQUESTED/DISPATCHED/SHIPPED
    carrier_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    carrier_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vehicle_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    driver_name: Mapped[str | None] = mapped_column(String(20), nullable=True)
    driver_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    freight_amount: Mapped[float] = mapped_column(Float, default=0)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list["ShipmentLine"]] = relationship(back_populates="shipment", cascade="all, delete-orphan")


class ShipmentLine(Base):
    __tablename__ = "shipment_line"

    id: Mapped[int] = pk()
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipment.id"), index=True)
    item_code: Mapped[str] = mapped_column(String(20))
    qty: Mapped[int] = mapped_column(Integer)

    shipment: Mapped[Shipment] = relationship(back_populates="lines")


class TaxInvoice(Base):
    """매출 마감 + 전자세금계산서(위아고). REQUESTED → ISSUED(국세청 승인번호 수신)."""

    __tablename__ = "tax_invoice"

    id: Mapped[int] = pk()
    invoice_no: Mapped[str] = mapped_column(String(20), unique=True)
    order_id: Mapped[int] = mapped_column(Integer, index=True)
    customer_code: Mapped[str] = mapped_column(String(20))
    supply_amount: Mapped[float] = mapped_column(Float)
    vat_amount: Mapped[float] = mapped_column(Float)
    total_amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(10), default="REQUESTED")
    nts_approval_no: Mapped[str | None] = mapped_column(String(30), nullable=True)
    voucher_exported: Mapped[int] = mapped_column(Integer, default=0)  # 더존 전표 내보내기 여부
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
