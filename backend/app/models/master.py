from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models._types import pk


class Partner(Base):
    """거래처: 고객(CUSTOMER), 원지 공급사(SUPPLIER), 운송사(CARRIER)."""

    __tablename__ = "partner"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    partner_type: Mapped[str] = mapped_column(String(10))
    biz_no: Mapped[str] = mapped_column(String(12))
    industry: Mapped[str | None] = mapped_column(String(30), nullable=True)


class PaperGrade(Base):
    """원지 등급: 표면지(LINER)·골심지(MEDIUM), 평량(g/m²)."""

    __tablename__ = "paper_grade"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(50))
    paper_kind: Mapped[str] = mapped_column(String(10))
    basis_weight: Mapped[int] = mapped_column(Integer)
    price_per_kg: Mapped[float] = mapped_column(Float)


class BoardSpec(Base):
    """원단 규격: 골 종류(A/B/C/E/BA 이중골)와 표면지·골심지 조합."""

    __tablename__ = "board_spec"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(30), unique=True)
    flute: Mapped[str] = mapped_column(String(4))
    outer_liner: Mapped[str] = mapped_column(String(20))
    medium: Mapped[str] = mapped_column(String(20))
    inner_liner: Mapped[str] = mapped_column(String(20))


class ItemBox(Base):
    """상자 품목 마스터."""

    __tablename__ = "item_box"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    customer_code: Mapped[str] = mapped_column(String(20), index=True)
    box_style: Mapped[str] = mapped_column(String(20))  # A형(RSC), 다이컷 등
    length_mm: Mapped[int] = mapped_column(Integer)
    width_mm: Mapped[int] = mapped_column(Integer)
    height_mm: Mapped[int] = mapped_column(Integer)
    board_spec_code: Mapped[str] = mapped_column(String(30))
    print_colors: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Float)
    std_cost: Mapped[float] = mapped_column(Float)


class Equipment(Base):
    """생산 설비: 골판지기(골게터), 인쇄기, 가공기."""

    __tablename__ = "equipment"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(50))
    process: Mapped[str] = mapped_column(String(20))
    legacy_system: Mapped[str] = mapped_column(String(30))
    capacity_per_hour: Mapped[int] = mapped_column(Integer)
    base_defect_rate: Mapped[float] = mapped_column(Float)
