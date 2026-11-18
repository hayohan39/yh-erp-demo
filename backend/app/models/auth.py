"""로그인 사용자. '데모 초기화'(Base 테이블 전체 삭제)에도 계정이 지워지지 않도록 별도 메타데이터에 둔다."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Identity, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models._types import now


class AuthBase(DeclarativeBase):
    pass


class AppUser(AuthBase):
    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(Integer, Identity(start=1), primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(50))
    department: Mapped[str | None] = mapped_column(String(50), nullable=True)
    role: Mapped[str] = mapped_column(String(10), default="USER")  # ADMIN / USER
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
