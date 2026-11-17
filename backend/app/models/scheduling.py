from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._types import now, pk


class SchedulePlan(Base):
    """골판지기 원단 스케쥴 (폭 조합 결과). 확정하면 생산지시가 만들어진다."""

    __tablename__ = "schedule_plan"

    id: Mapped[int] = pk()
    plan_no: Mapped[str] = mapped_column(String(20), unique=True)
    status: Mapped[str] = mapped_column(String(10), default="DRAFT")  # DRAFT / CONFIRMED
    order_count: Mapped[int] = mapped_column(Integer)
    area_m2: Mapped[float] = mapped_column(Float)
    trim_rate: Mapped[float] = mapped_column(Float)
    manual_area_m2: Mapped[float] = mapped_column(Float)
    manual_trim_rate: Mapped[float] = mapped_column(Float)
    saved_paper_kg: Mapped[float] = mapped_column(Float)
    saved_amount: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    runs: Mapped[list["CorrugatorRun"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="CorrugatorRun.seq"
    )


class CorrugatorRun(Base):
    __tablename__ = "corrugator_run"

    id: Mapped[int] = pk()
    plan_id: Mapped[int] = mapped_column(ForeignKey("schedule_plan.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    board_spec_code: Mapped[str] = mapped_column(String(30))
    roll_width: Mapped[int] = mapped_column(Integer)
    cuts: Mapped[int] = mapped_column(Integer)
    cut_length: Mapped[int] = mapped_column(Integer)
    trim_mm: Mapped[int] = mapped_column(Integer)
    length_m: Mapped[float] = mapped_column(Float)
    trim_rate: Mapped[float] = mapped_column(Float)

    plan: Mapped[SchedulePlan] = relationship(back_populates="runs")
    slots: Mapped[list["RunSlot"]] = relationship(cascade="all, delete-orphan", order_by="RunSlot.id")


class RunSlot(Base):
    """한 런에서 폭 방향으로 나란히 놓인 품목."""

    __tablename__ = "run_slot"

    id: Mapped[int] = pk()
    run_id: Mapped[int] = mapped_column(ForeignKey("corrugator_run.id"), index=True)
    order_line_id: Mapped[int] = mapped_column(Integer)
    item_code: Mapped[str] = mapped_column(String(20))
    ups: Mapped[int] = mapped_column(Integer)
    blank_w: Mapped[int] = mapped_column(Integer)
    blank_l: Mapped[int] = mapped_column(Integer)
    sheets: Mapped[int] = mapped_column(Integer)
