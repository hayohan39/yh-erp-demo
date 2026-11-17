"""시스템 구성도 하위 기능용 테이블: 재고·창고, 구매·발주, 수금·크레임, 품질 문서, 원가 기준, 경영정보 이력.

기존 테이블은 건드리지 않고 새 테이블만 추가한다(배포된 DB에서도 create_all로 바로 생성되도록).
"""
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models._types import now, pk


# ---------------------------------------------------------------- 기준정보
class CostRate(Base):
    """원가 기준값: 가공비(원/분)·운반비·손실률·셋업 시간 등. group = PROCESS/FREIGHT/COST."""

    __tablename__ = "cost_rate"

    id: Mapped[int] = pk()
    group_code: Mapped[str] = mapped_column(String(20))
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(60))
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(20))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)


class PriceHistory(Base):
    """단가 변경 이력: 상자 판매단가(ITEM), 원지 kg단가(PAPER), 부자재 단가(SUB)."""

    __tablename__ = "price_history"

    id: Mapped[int] = pk()
    kind: Mapped[str] = mapped_column(String(10))
    code: Mapped[str] = mapped_column(String(20), index=True)
    old_price: Mapped[float] = mapped_column(Float)
    new_price: Mapped[float] = mapped_column(Float)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------------------------------------------------------------- 재고·창고
class Warehouse(Base):
    """창고. site = 사업장(1공장/2공장), kind = PAPER/PRODUCT/SUB."""

    __tablename__ = "warehouse"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    site: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(10))


class StockBalance(Base):
    """창고별 재고. 제품은 product_stock(전체 합계)과 함께 갱신된다."""

    __tablename__ = "stock_balance"
    __table_args__ = (UniqueConstraint("kind", "item_code", "warehouse_code"),)

    id: Mapped[int] = pk()
    kind: Mapped[str] = mapped_column(String(10))  # PAPER(kg) / PRODUCT(매) / SUB(단위별)
    item_code: Mapped[str] = mapped_column(String(20), index=True)
    warehouse_code: Mapped[str] = mapped_column(String(10))
    qty: Mapped[float] = mapped_column(Float, default=0)


class StockMove(Base):
    """입출고 원장. move_type = IN(입고)/OUT(출고)/TRANSFER(이동)/ADJUST(조정)."""

    __tablename__ = "stock_move"

    id: Mapped[int] = pk()
    move_no: Mapped[str] = mapped_column(String(20), unique=True)
    kind: Mapped[str] = mapped_column(String(10), index=True)
    move_type: Mapped[str] = mapped_column(String(10))
    item_code: Mapped[str] = mapped_column(String(20))
    from_wh: Mapped[str | None] = mapped_column(String(10), nullable=True)
    to_wh: Mapped[str | None] = mapped_column(String(10), nullable=True)
    qty: Mapped[float] = mapped_column(Float)
    ref_no: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SubMaterial(Base):
    """부자재: 전분풀·잉크·밴드·스트레치 필름 등. usage_per_k = 1천 매당 사용량."""

    __tablename__ = "sub_material"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(50))
    unit: Mapped[str] = mapped_column(String(10))
    unit_price: Mapped[float] = mapped_column(Float)
    safety_qty: Mapped[float] = mapped_column(Float)
    usage_per_k: Mapped[float] = mapped_column(Float)
    usage_process: Mapped[str] = mapped_column(String(12))  # CORRUGATE / PRINT / CONVERT / SHIP
    supplier_code: Mapped[str] = mapped_column(String(20))


class PaperPolicy(Base):
    """원지 자동발주 기준: 안전재고·발주 단위(롤 묶음)·공급사·리드타임."""

    __tablename__ = "paper_policy"

    id: Mapped[int] = pk()
    paper_code: Mapped[str] = mapped_column(String(20), unique=True)
    safety_kg: Mapped[float] = mapped_column(Float)
    lot_kg: Mapped[float] = mapped_column(Float)
    supplier_code: Mapped[str] = mapped_column(String(20))
    lead_days: Mapped[int] = mapped_column(Integer)


class PaperRequirement(Base):
    """원지 소요량: 스케쥴 확정 시 계산해 PMS로 보낸 골게터 소요량(IF-PMS-02)."""

    __tablename__ = "paper_requirement"

    id: Mapped[int] = pk()
    plan_no: Mapped[str] = mapped_column(String(20), index=True)
    paper_code: Mapped[str] = mapped_column(String(20))
    kg: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class PurchaseOrder(Base):
    """원지·부자재 발주. ORDERED → RECEIVED(입고 = 매입). auto=1이면 자동발주로 생성."""

    __tablename__ = "purchase_order"

    id: Mapped[int] = pk()
    po_no: Mapped[str] = mapped_column(String(20), unique=True)
    kind: Mapped[str] = mapped_column(String(10))  # PAPER / SUB
    supplier_code: Mapped[str] = mapped_column(String(20))
    item_code: Mapped[str] = mapped_column(String(20))
    qty: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float)
    amount: Mapped[float] = mapped_column(Float)
    warehouse_code: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10), default="ORDERED")
    auto: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date] = mapped_column(Date)
    ordered_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Expense(Base):
    """경비: 전력·가스·수선·소모품 등 월 경비."""

    __tablename__ = "expense"

    id: Mapped[int] = pk()
    exp_no: Mapped[str] = mapped_column(String(20), unique=True)
    exp_date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String(20))
    dept: Mapped[str] = mapped_column(String(20))
    amount: Mapped[float] = mapped_column(Float)
    memo: Mapped[str | None] = mapped_column(String(200), nullable=True)


# ---------------------------------------------------------------- 영업
class OrderAllocation(Base):
    """수주전용: 여유 제품재고를 수주에 돌려 쓴 내역(생산 없이 출하)."""

    __tablename__ = "order_allocation"

    id: Mapped[int] = pk()
    order_id: Mapped[int] = mapped_column(Integer, index=True)
    item_code: Mapped[str] = mapped_column(String(20))
    qty: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Claim(Base):
    """고객 크레임. RECEIVED → INVESTIGATING → CLOSED(보상 금액 확정)."""

    __tablename__ = "claim"

    id: Mapped[int] = pk()
    claim_no: Mapped[str] = mapped_column(String(20), unique=True)
    order_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    customer_code: Mapped[str] = mapped_column(String(20), index=True)
    item_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    claim_type: Mapped[str] = mapped_column(String(30))
    qty: Mapped[int] = mapped_column(Integer, default=0)
    amount: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(15), default="RECEIVED")
    description: Mapped[str] = mapped_column(Text)
    cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Receipt(Base):
    """수금. invoice_no가 없으면 기초 미수금 회수."""

    __tablename__ = "receipt"

    id: Mapped[int] = pk()
    receipt_no: Mapped[str] = mapped_column(String(20), unique=True)
    customer_code: Mapped[str] = mapped_column(String(20), index=True)
    invoice_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    amount: Mapped[float] = mapped_column(Float)
    method: Mapped[str] = mapped_column(String(10))  # 계좌이체/어음/현금
    received_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class PalletMove(Base):
    """파렛트 수불: 출하 시 거래처로 나간 수량(out)과 회수 수량(in)."""

    __tablename__ = "pallet_move"

    id: Mapped[int] = pk()
    partner_code: Mapped[str] = mapped_column(String(20), index=True)
    out_qty: Mapped[int] = mapped_column(Integer, default=0)
    in_qty: Mapped[int] = mapped_column(Integer, default=0)
    ref_no: Mapped[str | None] = mapped_column(String(30), nullable=True)
    memo: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------------------------------------------------------------- 생산
class OutsourceOrder(Base):
    """외주 가공(OUTSOURCE: 톰슨·코팅 등)과 상품 매입(PURCHASE: 완제품 박스 구매)."""

    __tablename__ = "outsource_order"

    id: Mapped[int] = pk()
    oo_no: Mapped[str] = mapped_column(String(20), unique=True)
    kind: Mapped[str] = mapped_column(String(10))
    vendor_code: Mapped[str] = mapped_column(String(20))
    item_code: Mapped[str] = mapped_column(String(20))
    process_name: Mapped[str] = mapped_column(String(30))
    qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Float)
    amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(10), default="ORDERED")
    due_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ---------------------------------------------------------------- 품질
class ItemSpec(Base):
    """시방: 품목별 품질 기준(압축강도·파열강도·수분)과 인쇄·포장 조건."""

    __tablename__ = "item_spec"

    id: Mapped[int] = pk()
    item_code: Mapped[str] = mapped_column(String(20), unique=True)
    rev: Mapped[int] = mapped_column(Integer, default=1)
    bct_kgf: Mapped[float] = mapped_column(Float)
    burst_kgf: Mapped[float] = mapped_column(Float)
    moisture_max: Mapped[float] = mapped_column(Float)
    print_note: Mapped[str] = mapped_column(String(100))
    pack_note: Mapped[str] = mapped_column(String(100))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class InspectionCert(Base):
    """출하 성적서: 출하 시 시방 대비 측정값과 판정."""

    __tablename__ = "inspection_cert"

    id: Mapped[int] = pk()
    cert_no: Mapped[str] = mapped_column(String(20), unique=True)
    shipment_no: Mapped[str] = mapped_column(String(20), index=True)
    order_no: Mapped[str] = mapped_column(String(20))
    customer_code: Mapped[str] = mapped_column(String(20))
    item_code: Mapped[str] = mapped_column(String(20))
    qty: Mapped[int] = mapped_column(Integer)
    bct_kgf: Mapped[float] = mapped_column(Float)
    burst_kgf: Mapped[float] = mapped_column(Float)
    moisture: Mapped[float] = mapped_column(Float)
    verdict: Mapped[str] = mapped_column(String(10))
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class DevCost(Base):
    """개발비: 샘플·목형·동판·디자인 등 신규 품목 개발 비용과 청구 여부."""

    __tablename__ = "dev_cost"

    id: Mapped[int] = pk()
    dev_no: Mapped[str] = mapped_column(String(20), unique=True)
    customer_code: Mapped[str] = mapped_column(String(20))
    item_name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(20))
    amount: Mapped[float] = mapped_column(Float)
    bill_type: Mapped[str] = mapped_column(String(10))  # 고객청구 / 자사부담
    status: Mapped[str] = mapped_column(String(10), default="진행")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Tooling(Base):
    """조판(인쇄 수지판)·목형(다이컷 칼틀). 생산 완료 때마다 사용 타수가 올라간다."""

    __tablename__ = "tooling"

    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(20), unique=True)
    kind: Mapped[str] = mapped_column(String(10))  # PLATE / DIE
    item_code: Mapped[str] = mapped_column(String(20), index=True)
    location: Mapped[str] = mapped_column(String(30))
    shots: Mapped[int] = mapped_column(Integer, default=0)
    life_shots: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="사용")
    made_at: Mapped[date] = mapped_column(Date)


# ---------------------------------------------------------------- 경영정보
class MonthlyStat(Base):
    """월별 실적 이력(데모 이전 기간). 이번 달은 실데이터로 계산해 이어 붙인다."""

    __tablename__ = "monthly_stat"
    __table_args__ = (UniqueConstraint("ym", "metric", "dim"),)

    id: Mapped[int] = pk()
    ym: Mapped[str] = mapped_column(String(7))
    metric: Mapped[str] = mapped_column(String(20))
    dim: Mapped[str] = mapped_column(String(20), default="")
    value: Mapped[float] = mapped_column(Float)
