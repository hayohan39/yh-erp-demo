from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._types import now, pk


class WorkOrder(Base):
    """생산지시. 수주 라인 1개 = 생산지시 1개."""

    __tablename__ = "work_order"

    id: Mapped[int] = pk()
    wo_no: Mapped[str] = mapped_column(String(20), unique=True)
    plan_id: Mapped[int] = mapped_column(Integer, index=True)
    order_id: Mapped[int] = mapped_column(Integer, index=True)
    order_line_id: Mapped[int] = mapped_column(Integer)
    item_code: Mapped[str] = mapped_column(String(20))
    board_spec_code: Mapped[str] = mapped_column(String(30))
    qty: Mapped[int] = mapped_column(Integer)
    good_qty: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="ISSUED")  # ISSUED/IN_PROD/DONE
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    routes: Mapped[list["WorkOrderRoute"]] = relationship(
        back_populates="wo", cascade="all, delete-orphan", order_by="WorkOrderRoute.seq"
    )


class WorkOrderRoute(Base):
    """생산지시의 공정 순서: 골판지기 → (인쇄) → 가공."""

    __tablename__ = "work_order_route"

    id: Mapped[int] = pk()
    wo_id: Mapped[int] = mapped_column(ForeignKey("work_order.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    process: Mapped[str] = mapped_column(String(12))
    equipment_code: Mapped[str] = mapped_column(String(20))
    input_qty: Mapped[int] = mapped_column(Integer, default=0)
    good_qty: Mapped[int] = mapped_column(Integer, default=0)
    defect_qty: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="WAIT")  # WAIT/RUN/DONE
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    wo: Mapped[WorkOrder] = relationship(back_populates="routes")


class ProductionResult(Base):
    """설비 실적 이력 (설비 I/F 수신 원본 단위)."""

    __tablename__ = "production_result"

    id: Mapped[int] = pk()
    wo_no: Mapped[str] = mapped_column(String(20), index=True)
    process: Mapped[str] = mapped_column(String(12))
    equipment_code: Mapped[str] = mapped_column(String(20))
    good_qty: Mapped[int] = mapped_column(Integer)
    defect_qty: Mapped[int] = mapped_column(Integer)
    run_minutes: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class PaperUsage(Base):
    """원지 투입 (PMS 수신, 롤 단위). 원가 계산의 재료비 근거."""

    __tablename__ = "paper_usage"

    id: Mapped[int] = pk()
    wo_no: Mapped[str] = mapped_column(String(20), index=True)
    roll_no: Mapped[str] = mapped_column(String(30))
    paper_code: Mapped[str] = mapped_column(String(20))
    used_kg: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ProductStock(Base):
    __tablename__ = "product_stock"

    id: Mapped[int] = pk()
    item_code: Mapped[str] = mapped_column(String(20), unique=True)
    qty: Mapped[int] = mapped_column(Integer, default=0)
