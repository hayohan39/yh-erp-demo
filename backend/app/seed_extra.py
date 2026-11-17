"""시스템 구성도 하위 기능용 가상 기준정보·이력 적재.

기존 데모 DB(이미 기준정보가 있는 DB)에도 '데모 초기화' 없이 들어가도록 창고 테이블이 비어 있을 때만 실행한다.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Claim, CommonCode, CostRate, DevCost, Expense, ItemBox, ItemSpec, MonthlyStat, PalletMove, PaperGrade,
    PaperPolicy, Partner, SubMaterial, Tooling, Warehouse,
)
from app.models._types import now
from app.services import inventory

WAREHOUSES = [
    ("RP1A", "1공장 원지창고 A동", "1공장", "PAPER"),
    ("RP1B", "1공장 원지 야적장 B동", "1공장", "PAPER"),
    ("RP2", "2공장 원지창고", "2공장", "PAPER"),
    ("FG1", "1공장 제품창고", "1공장", "PRODUCT"),
    ("FG1S", "1공장 출하대기장", "1공장", "PRODUCT"),
    ("FG2", "2공장 제품창고", "2공장", "PRODUCT"),
    ("SB1", "1공장 부자재창고", "1공장", "SUB"),
    ("SB2", "2공장 부자재창고", "2공장", "SUB"),
]

EXTRA_PARTNERS = [
    ("S004", "대한전분", "SUPPLIER"), ("S005", "한국컬러잉크", "SUPPLIER"), ("S006", "동방포장자재", "SUPPLIER"),
    ("O001", "대성톰슨", "OUTSOURCE"), ("O002", "미래코팅", "OUTSOURCE"), ("O003", "한솔패키지(상품)", "OUTSOURCE"),
]

COST_RATES = [
    # group, key, label, value, unit, note
    ("PROCESS", "rate_CORRUGATE", "골판지기 가공비", 4000, "원/분", "인건비·감가상각·스팀·동력 포함"),
    ("PROCESS", "rate_PRINT", "인쇄 가공비", 2500, "원/분", "인쇄 5호기, 잉크 제외"),
    ("PROCESS", "rate_CONVERT", "가공(접합·결속) 가공비", 1800, "원/분", "에볼/썬라이즈"),
    ("FREIGHT", "freight_base", "운반비 기본료", 80000, "원/건", "11톤 1대 기준 상차 1건"),
    ("FREIGHT", "freight_per_sheet", "운반비 매당 단가", 1.5, "원/매", "거리·중량 평균"),
    ("FREIGHT", "pallet_sheets", "파렛트당 적재 매수", 1000, "매", "접힌 상태 평균"),
    ("FREIGHT", "truck_11t_pallets", "11톤 적재 파렛트", 16, "PLT", ""),
    ("FREIGHT", "truck_5t_pallets", "5톤 적재 파렛트", 10, "PLT", ""),
    ("COST", "setup_minutes", "공정별 셋업 시간", 5, "분", "작업 전환 1회"),
    ("COST", "std_loss", "표준 원지 손실률", 0.03, "비율", "트림·손지"),
    ("COST", "overhead_rate", "간접비 배부율", 0.08, "비율", "제조원가 대비, 원가분석 손익에 반영"),
    ("COST", "target_margin", "목표 이익률", 0.15, "비율", "견적 제안 단가 기준"),
    ("COST", "std_lot", "표준원가 기준 수량", 5000, "매", "품목 표준원가 계산 로트"),
]

SUB_MATERIALS = [
    ("SM01", "옥수수 전분풀", "kg", 650, 1500, 9.0, "CORRUGATE", "S004"),
    ("SM02", "수성 잉크(청)", "kg", 7800, 120, 0.35, "PRINT", "S005"),
    ("SM03", "수성 잉크(흑)", "kg", 7200, 120, 0.35, "PRINT", "S005"),
    ("SM04", "핫멜트 접착제", "kg", 5200, 200, 0.6, "CONVERT", "S006"),
    ("SM05", "PP 밴드", "롤", 18000, 40, 0.08, "CONVERT", "S006"),
    ("SM06", "스트레치 필름", "롤", 15000, 30, 0.05, "CONVERT", "S006"),
]

EXTRA_CODES = {
    "CLAIM_TYPE": ["PRINT:인쇄 불량", "SIZE:치수 불량", "STRENGTH:강도 부족", "QTY:수량 부족", "DAMAGE:운송 파손"],
    "EXPENSE_CAT": ["POWER:전력비", "GAS:가스(스팀)비", "REPAIR:수선비", "SUPPLY:소모품비", "WATER:용수비",
                    "WASTE:폐기물처리비"],
    "DEFECT_TYPE": ["GLUE:접착 불량", "WARP:휨(warp)", "FLUTE:골 눌림", "INK:인쇄 번짐", "COLOR:색상 편차",
                    "DIE:타발 불량"],
    "FLUTE": ["A:A골(5mm)", "B:B골(3mm)", "C:C골(4mm)", "E:E골(1.5mm)", "BA:BA 이중골"],
    "BOX_STYLE": ["RSC:A형(RSC)", "B:B형", "DIE:다이컷", "TRAY:트레이형"],
    "SITE": ["P1:1공장(본사)", "P2:2공장"],
}

BCT = {"A": 330, "B": 250, "C": 300, "E": 180, "BA": 520}
REGION = {"C001": "경기 남부", "C002": "경기 남부", "C003": "충청", "C004": "전라", "C005": "경기 북부",
          "C006": "서울", "C007": "충청", "C008": "경상"}


def _months_back(n: int) -> list[str]:
    d = date.today().replace(day=1)
    out = []
    for _ in range(n):
        out.append(d.strftime("%Y-%m"))
        d = (d - timedelta(days=1)).replace(day=1)
    return list(reversed(out))


def _seed_monthly(db: Session, rng: random.Random) -> None:
    """2025-01 ~ 이번 달(진행분) 월 실적. 9월(추석 선물세트)·12~1월 성수기, 2026년 +6% 성장."""
    customers = [p.code for p in db.scalars(select(Partner).where(Partner.partner_type == "CUSTOMER"))]
    cust_w = [0.2, 0.17, 0.14, 0.08, 0.13, 0.11, 0.09, 0.08][: len(customers)]
    season = {1: 1.05, 2: 0.88, 3: 0.95, 4: 0.97, 5: 1.0, 6: 0.96, 7: 0.93, 8: 1.08, 9: 1.22, 10: 1.0, 11: 1.02,
              12: 1.12}
    months = [m for m in _months_back(30) if m >= "2025-01"]
    this_month = months[-1]
    last_sales: dict[str, float] = {}
    for ym in months:
        y, mo = int(ym[:4]), int(ym[5:])
        growth = 1.0 if y == 2025 else 1.06
        f = season[mo] * growth * rng.uniform(0.95, 1.05)
        if ym == this_month:  # 진행 중인 달: 데모 시작 시점까지의 기준 실적
            f *= min(date.today().day / 30, 1) * 0.95
        sales = 2_350_000_000 * f
        orders = sales * rng.uniform(0.98, 1.06)
        sheets = sales / rng.uniform(560, 610)
        paper_kg = sheets * rng.uniform(0.33, 0.36)
        paper_amt = paper_kg * rng.uniform(655, 690) * (1.0 if y == 2025 else 1.03)
        freight = sales * rng.uniform(0.036, 0.042)
        rows = {
            ("sales_amt", ""): sales, ("orders_amt", ""): orders, ("orders_cnt", ""): orders / 6_800_000,
            ("prod_qty", ""): sheets, ("defect_rate", ""): rng.uniform(0.014, 0.022),
            ("paper_kg", ""): paper_kg, ("paper_amt", ""): paper_amt, ("freight_amt", ""): freight,
        }
        for c, w in zip(customers, cust_w):
            jitter = rng.uniform(0.85, 1.15)
            rows[("sales_amt", c)] = sales * w * jitter
            if ym == months[-2]:
                last_sales[c] = sales * w * jitter
            rows[("orders_amt", c)] = orders * w * jitter
        for code, w in (("S001", 0.45), ("S002", 0.35), ("S003", 0.2)):
            rows[("paper_amt", code)] = paper_amt * w
            rows[("paper_kg", code)] = paper_kg * w
        for code, w in (("T001", 0.58), ("T002", 0.42)):
            rows[("freight_amt", code)] = freight * w
        for proc, w in (("CORRUGATE", 1.03), ("PRINT", 0.62), ("CONVERT", 1.0)):
            rows[("prod_qty", proc)] = sheets * w
        for (metric, dim), v in rows.items():
            db.add(MonthlyStat(ym=ym, metric=metric, dim=dim, value=round(v, 4 if metric == "defect_rate" else 0)))
    # 기초 미수금(거래처별): 지난달 매출의 약 1.6개월치
    for c in customers:
        base = last_sales.get(c, 0)
        db.add(MonthlyStat(ym="OPEN", metric="ar", dim=c, value=round(base * 1.1 * 1.6, -3)))


def seed_extra(db: Session) -> None:
    if db.scalar(select(Warehouse).limit(1)):
        return
    rng = random.Random(20261117)
    today = date.today()

    for code, name, site, kind in WAREHOUSES:
        db.add(Warehouse(code=code, name=name, site=site, kind=kind))
    existing = {p.code for p in db.scalars(select(Partner))}
    for code, name, ptype in EXTRA_PARTNERS:
        if code not in existing:
            db.add(Partner(code=code, name=name, partner_type=ptype,
                           biz_no=f"{rng.randint(100, 899)}-{rng.randint(10, 99)}-{rng.randint(10000, 99999)}"))
    for sort, (group, key, label, value, unit, note) in enumerate(COST_RATES):
        db.add(CostRate(group_code=group, key=key, label=label, value=value, unit=unit, sort_order=sort, note=note))
    have_codes = {(c.group_code, c.code) for c in db.scalars(select(CommonCode))}
    for group, items in EXTRA_CODES.items():
        for sort, item in enumerate(items):
            code, name = item.split(":")
            if (group, code) not in have_codes:
                db.add(CommonCode(group_code=group, code=code, name=name, sort_order=sort))
    db.flush()

    # 원지 재고·자동발주 기준. 화이트 라이너·강화 골심지는 안전재고 아래로 시작(자동발주 시연)
    suppliers = ["S001", "S002", "S003"]
    for n, g in enumerate(db.scalars(select(PaperGrade).order_by(PaperGrade.id))):
        safety = 15000 if g.paper_kind == "LINER" else 12000
        low = g.code in ("WK180", "M180")
        db.add(PaperPolicy(paper_code=g.code, safety_kg=safety, lot_kg=10000, supplier_code=suppliers[n % 3],
                           lead_days=2 + n % 3))
        for wh, qty in (("RP1A", rng.randint(5, 8) * 1000 if low else rng.randint(24, 42) * 1000),
                        ("RP1B", 0 if low else rng.randint(4, 12) * 1000),
                        ("RP2", rng.randint(1, 3) * 1000 if low else rng.randint(8, 18) * 1000)):
            if qty:
                inventory.move(db, "PAPER", "IN", g.code, qty, to_wh=wh, reason="기초 재고", publish=False)

    for code, name, unit, price, safety, usage, proc, sup in SUB_MATERIALS:
        db.add(SubMaterial(code=code, name=name, unit=unit, unit_price=price, safety_qty=safety, usage_per_k=usage,
                           usage_process=proc, supplier_code=sup))
        qty = safety * rng.uniform(0.8, 3.0)
        inventory.move(db, "SUB", "IN", code, round(qty), to_wh="SB1", reason="기초 재고", publish=False)
        inventory.move(db, "SUB", "IN", code, round(safety * 0.4), to_wh="SB2", reason="기초 재고", publish=False)

    # 제품 여유재고(수주전용 시연용): 거래처별 대표 품목 일부
    items = list(db.scalars(select(ItemBox).order_by(ItemBox.code)))
    for it in items[::5]:
        wh = rng.choice(["FG1", "FG1", "FG2"])
        inventory.move(db, "PRODUCT", "IN", it.code, rng.choice([1500, 2000, 3000, 4000]), to_wh=wh,
                       reason="기초 재고(여유)", publish=False)

    # 시방·조판·목형
    for it in items:
        flute = it.board_spec_code.split("-")[0]
        size = (it.length_mm + it.width_mm) / 700
        db.add(ItemSpec(item_code=it.code, rev=rng.choice([1, 1, 2, 3]),
                        bct_kgf=round(BCT.get(flute, 260) * (0.8 + 0.4 * size), -1),
                        burst_kgf=round(rng.uniform(9, 16) + (4 if flute == "BA" else 0), 1),
                        moisture_max=12.0,
                        print_note=f"{it.print_colors}도 인쇄, 색상 견본 대비 ΔE 3 이내" if it.print_colors else "무지(인쇄 없음)",
                        pack_note=f"파렛트 1단 {rng.choice([20, 25, 30])}매 × {rng.choice([8, 10, 12])}단, PP밴드 2줄"))
        if it.print_colors:
            life = 300000
            db.add(Tooling(code=f"PL-{it.code}", kind="PLATE", item_code=it.code, location=f"조판실 랙 A-{rng.randint(1, 40):02d}",
                           shots=int(life * rng.choice([0.1, 0.3, 0.5, 0.7, 0.86, 0.93]) * rng.uniform(0.94, 1.0)), life_shots=life,
                           made_at=today - timedelta(days=rng.randint(30, 700))))
        if it.box_style in ("다이컷", "트레이형"):
            life = 500000
            db.add(Tooling(code=f"DC-{it.code}", kind="DIE", item_code=it.code, location=f"목형 보관대 D-{rng.randint(1, 20):02d}",
                           shots=int(life * rng.choice([0.2, 0.4, 0.6, 0.88]) * rng.uniform(0.94, 1.0)), life_shots=life,
                           made_at=today - timedelta(days=rng.randint(60, 900))))

    customers = [p for p in db.scalars(select(Partner).where(Partner.partner_type == "CUSTOMER").order_by(Partner.code))]
    for n, (cat, amt, bill, st) in enumerate([("샘플", 450000, "자사부담", "완료"), ("목형", 1200000, "고객청구", "완료"),
                                               ("수지판", 680000, "고객청구", "진행"), ("디자인", 900000, "자사부담", "진행"),
                                               ("목형", 1500000, "고객청구", "진행"), ("샘플", 300000, "자사부담", "완료")],
                                              start=1):
        c = customers[n % len(customers)]
        db.add(DevCost(dev_no=f"DV{today:%y%m}{n:03d}", customer_code=c.code,
                       item_name=f"{c.name} 신규 {rng.choice(['선물세트', '트레이', '택배', '디스플레이'])} 박스",
                       category=cat, amount=amt, bill_type=bill, status=st,
                       created_at=now() - timedelta(days=rng.randint(3, 60))))

    for n, (ctype, st, qty, amt, desc) in enumerate([
        ("인쇄 불량", "CLOSED", 300, 180000, "로고 색상이 견본보다 흐림"),
        ("강도 부족", "INVESTIGATING", 0, 0, "적재 3단에서 하단 박스 눌림 발생"),
        ("운송 파손", "RECEIVED", 120, 0, "하차 중 파렛트 전도로 모서리 파손"),
        ("치수 불량", "CLOSED", 500, 0, "내경 폭 3mm 작음 → 재작업 후 재납품"),
    ], start=1):
        c = customers[(n * 3) % len(customers)]
        it = next((i for i in items if i.customer_code == c.code), items[0])
        closed = st == "CLOSED"
        db.add(Claim(claim_no=f"CL{today:%y%m}{n:03d}", order_no=None, customer_code=c.code, item_code=it.code,
                     claim_type=ctype, qty=qty, amount=amt, status=st, description=desc,
                     cause="인쇄 잉크 점도 관리 미흡" if n == 1 else ("조립 시 스코어 위치 오차" if n == 4 else None),
                     action_text="잉크 점도 2시간 간격 점검, 초품 색상 승인 강화" if n == 1 else (
                         "목형 스코어 칼 교체, 초품 치수 검사 추가" if n == 4 else None),
                     created_at=now() - timedelta(days=rng.randint(2, 40)),
                     closed_at=now() - timedelta(days=1) if closed else None))
    # 파렛트 기초 잔량(거래처 보유)
    for c in customers:
        db.add(PalletMove(partner_code=c.code, out_qty=rng.randint(20, 90), in_qty=0, memo="기초 잔량"))

    cats = [("전력비", 165_000_000), ("가스(스팀)비", 98_000_000), ("수선비", 24_000_000), ("소모품비", 12_000_000),
            ("용수비", 4_500_000), ("폐기물처리비", 7_800_000)]
    depts = {"전력비": "생산팀", "가스(스팀)비": "생산팀", "수선비": "설비팀", "소모품비": "관리팀", "용수비": "관리팀",
             "폐기물처리비": "환경안전팀"}
    n = 1
    for ym in _months_back(6):
        y, mo = int(ym[:4]), int(ym[5:])
        d = date(y, mo, min(25, today.day if ym == today.strftime("%Y-%m") else 25))
        for cat, base in cats:
            db.add(Expense(exp_no=f"EX{y % 100:02d}{mo:02d}{n:03d}", exp_date=d, category=cat, dept=depts[cat],
                           amount=round(base * rng.uniform(0.88, 1.12), -3), memo=f"{mo}월 {cat}"))
            n += 1

    _seed_monthly(db, rng)
    db.commit()

