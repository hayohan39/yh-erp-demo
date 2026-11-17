from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models._types import now, pk


class Defect(Base):
    """불량 발생. 공정 불량률이 기준을 넘으면 자동 등록되고 알림이 뜬다."""

    __tablename__ = "defect"

    id: Mapped[int] = pk()
    defect_no: Mapped[str] = mapped_column(String(20), unique=True)
    wo_no: Mapped[str] = mapped_column(String(20), index=True)
    item_code: Mapped[str] = mapped_column(String(20))
    process: Mapped[str] = mapped_column(String(12))
    equipment_code: Mapped[str] = mapped_column(String(20))
    defect_qty: Mapped[int] = mapped_column(Integer)
    defect_rate: Mapped[float] = mapped_column(Float)
    defect_type: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(10), default="OPEN")  # OPEN / CLOSED
    cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
