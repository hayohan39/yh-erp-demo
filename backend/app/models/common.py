from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models._types import now, pk


class IfMessage(Base):
    """레거시 I/F 송수신 이력. 모든 메시지는 공통 봉투로 기록된다."""

    __tablename__ = "if_message"

    id: Mapped[int] = pk()
    message_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    if_id: Mapped[str] = mapped_column(String(20), index=True)
    direction: Mapped[str] = mapped_column(String(3))  # IN / OUT
    source: Mapped[str] = mapped_column(String(30))
    target: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(12), index=True)  # RECEIVED/PROCESSED/SENT/FAILED
    payload: Mapped[str] = mapped_column(Text)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CommonCode(Base):
    __tablename__ = "common_code"
    __table_args__ = (UniqueConstraint("group_code", "code"),)

    id: Mapped[int] = pk()
    group_code: Mapped[str] = mapped_column(String(30))
    code: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
