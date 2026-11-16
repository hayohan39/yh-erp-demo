"""가상 데모 기준정보 적재. 같은 입력이면 항상 같은 데이터가 나오도록 고정 시드를 쓴다."""
import random

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import Base, engine
from app.models import BoardSpec, CommonCode, Equipment, ItemBox, PaperGrade, Partner

CUSTOMERS = [
    ("C001", "한빛식품", "식품"),
    ("C002", "새솔전자", "전자"),
    ("C003", "다온화장품", "화장품"),
    ("C004", "푸른들농산", "농산물"),
    ("C005", "가람음료", "음료"),
    ("C006", "누리생활용품", "생활용품"),
    ("C007", "온새미제약", "제약"),
    ("C008", "별빛물산", "유통"),
]
SUPPLIERS = [("S001", "청솔제지"), ("S002", "대양페이퍼"), ("S003", "한결판지")]
CARRIERS = [("T001", "바른물류"), ("T002", "이음운송")]

PAPER_GRADES = [
    ("KA180", "크라프트 라이너 180", "LINER", 180, 720),
    ("KA210", "크라프트 라이너 210", "LINER", 210, 735),
    ("SK180", "재생 라이너 180", "LINER", 180, 610),
    ("WK180", "화이트 라이너 180", "LINER", 180, 890),
    ("KLB250", "백상 라이너 250", "LINER", 250, 960),
    ("S120", "골심지 120", "MEDIUM", 120, 520),
    ("S150", "골심지 150", "MEDIUM", 150, 545),
    ("M180", "강화 골심지 180", "MEDIUM", 180, 600),
]

BOARD_SPECS = [
    ("B", "KA180", "S120", "KA180"),
    ("B", "SK180", "S120", "SK180"),
    ("C", "KA210", "S150", "KA180"),
    ("A", "KA210", "S150", "KA210"),
    ("E", "WK180", "S120", "SK180"),
    ("BA", "KA210", "M180", "KA180"),
    ("B", "WK180", "S120", "KA180"),
    ("C", "KLB250", "S150", "KA180"),
]

EQUIPMENT = [
    ("CG01", "골판지기 1호", "CORRUGATE", "골게터 POP", 9000, 0.012),
    ("EV01", "에볼/썬라이즈", "CONVERT", "에볼/썬라이즈", 6000, 0.018),
    ("PR05", "인쇄 5호기", "PRINT", "인쇄 5호기", 5000, 0.022),
]

BOX_NAMES = ["외박스", "선물세트 박스", "트레이", "내박스", "택배 박스", "칸막이 박스"]
BOX_STYLES = ["A형(RSC)", "A형(RSC)", "다이컷", "B형", "트레이형"]

CODE_GROUPS = {
    "ORDER_STATUS": ["RECEIVED:수주접수", "PLANNED:계획", "IN_PROD:생산중", "PRODUCED:생산완료",
                     "SHIPPED:출하완료", "CLOSED:마감"],
    "PROCESS": ["CORRUGATE:골판지기", "PRINT:인쇄", "CONVERT:가공"],
}


def _board_code(flute: str, o: str, m: str, i: str) -> str:
    return f"{flute}-{o}/{m}/{i}"


def seed(db: Session) -> None:
    if db.scalar(select(Partner).limit(1)):
        return
    rng = random.Random(20261201)

    for code, name, industry in CUSTOMERS:
        db.add(Partner(code=code, name=name, partner_type="CUSTOMER",
                       biz_no=f"{rng.randint(100, 899)}-{rng.randint(10, 99)}-{rng.randint(10000, 99999)}",
                       industry=industry))
    for code, name in SUPPLIERS:
        db.add(Partner(code=code, name=name, partner_type="SUPPLIER",
                       biz_no=f"{rng.randint(100, 899)}-{rng.randint(10, 99)}-{rng.randint(10000, 99999)}"))
    for code, name in CARRIERS:
        db.add(Partner(code=code, name=name, partner_type="CARRIER",
                       biz_no=f"{rng.randint(100, 899)}-{rng.randint(10, 99)}-{rng.randint(10000, 99999)}"))

    for code, name, kind, bw, price in PAPER_GRADES:
        db.add(PaperGrade(code=code, name=name, paper_kind=kind, basis_weight=bw, price_per_kg=price))

    board_codes = []
    for flute, o, m, i in BOARD_SPECS:
        bc = _board_code(flute, o, m, i)
        board_codes.append(bc)
        db.add(BoardSpec(code=bc, flute=flute, outer_liner=o, medium=m, inner_liner=i))

    for code, name, process, legacy, cap, rate in EQUIPMENT:
        db.add(Equipment(code=code, name=name, process=process, legacy_system=legacy,
                         capacity_per_hour=cap, base_defect_rate=rate))

    n = 1
    for idx, (ccode, cname, _industry) in enumerate(CUSTOMERS):
        for _ in range(4 if idx < 6 else 3):  # 6*4 + 2*3 = 30종
            length = rng.choice([250, 300, 350, 400, 450, 500, 550, 600])
            width = rng.choice([200, 250, 300, 350, 400])
            height = rng.choice([100, 150, 200, 250, 300])
            colors = rng.choice([0, 1, 2, 3, 4])
            std_cost = round(250 + (length + width) * height / 900 + colors * 35, -1)
            db.add(ItemBox(
                code=f"BX{n:04d}", name=f"{cname} {rng.choice(BOX_NAMES)} {length}x{width}x{height}",
                customer_code=ccode, box_style=rng.choice(BOX_STYLES),
                length_mm=length, width_mm=width, height_mm=height,
                board_spec_code=rng.choice(board_codes), print_colors=colors,
                unit_price=round(std_cost * rng.uniform(1.15, 1.3), -1), std_cost=std_cost,
            ))
            n += 1

    for group, items in CODE_GROUPS.items():
        for sort, item in enumerate(items):
            code, name = item.split(":")
            db.add(CommonCode(group_code=group, code=code, name=name, sort_order=sort))

    db.commit()


def reset_all(db: Session) -> None:
    """데모 초기화: 모든 테이블을 지우고 기준정보를 다시 적재한다."""
    db.close()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed(db)
