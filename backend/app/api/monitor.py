"""실시간 모니터링(설비·공장)과 시스템 구성도용 상태 조회."""
import math
import time
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.interfaces.catalog import IF_CATALOG
from app.models import (
    Defect, Equipment, IfMessage, ItemBox, PaperGrade, PaperUsage, ProductStock, WorkOrder, WorkOrderRoute,
)
from app.models._types import now

router = APIRouter(prefix="/api/monitor", tags=["실시간 모니터링"])

# 데모용 원지 기초재고(PMS, 지종별). 투입량만큼 줄어든다.
PAPER_OPENING_KG = 30000.0
SETUP_MINUTES = 5  # 시뮬레이터와 같은 셋업 시간


@router.get("/factory")
def factory(db: Session = Depends(get_db)):
    """공장 맵: 원지 창고 → 골판지기 → 오토콘 → 인쇄 → 가공 → 제품 창고."""
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    wos = list(db.scalars(select(WorkOrder).options(selectinload(WorkOrder.routes)).order_by(WorkOrder.id)))
    open_defects = defaultdict(int)
    for d in db.scalars(select(Defect).where(Defect.status != "CLOSED")):
        open_defects[d.equipment_code] += 1

    machines = []
    in_transit = 0
    for eq in db.scalars(select(Equipment).order_by(Equipment.id)):
        current = None
        queue = done = good = bad = 0
        for w in wos:
            for i, r in enumerate(w.routes):
                if r.equipment_code != eq.code:
                    continue
                if r.status == "RUN":
                    item = items.get(w.item_code)
                    current = {
                        "wo_no": w.wo_no, "item_code": w.item_code, "item_name": item.name if item else w.item_code,
                        "qty": w.routes[i - 1].good_qty if i else w.qty,
                        "started_at": r.started_at,
                        "expected_minutes": round(w.qty / eq.capacity_per_hour * 60 + SETUP_MINUTES, 1),
                        "print_colors": item.print_colors if item else 0,
                    }
                elif r.status == "WAIT":
                    queue += 1
                else:
                    done += 1
                    good += r.good_qty
                    bad += r.defect_qty
        machines.append({
            "code": eq.code, "name": eq.name, "process": eq.process, "legacy_system": eq.legacy_system,
            "status": "RUN" if current else "IDLE", "current": current, "queue": queue, "done": done,
            "good_qty": good, "defect_qty": bad,
            "defect_rate": round(bad / (good + bad), 4) if good + bad else 0, "open_defects": open_defects[eq.code],
        })
    # 골판지기는 끝났고 다음 공정은 아직 시작 전인 원단 = 컨베이어(오토콘) 위
    for w in wos:
        for prev, nxt in zip(w.routes, w.routes[1:]):
            if prev.process == "CORRUGATE" and prev.status == "DONE" and nxt.status == "WAIT":
                in_transit += 1

    used = dict(db.execute(select(PaperUsage.paper_code, func.sum(PaperUsage.used_kg))
                           .group_by(PaperUsage.paper_code)).all())
    rolls = dict(db.execute(select(PaperUsage.paper_code, func.count()).group_by(PaperUsage.paper_code)).all())
    papers = [{
        "code": p.code, "name": p.name, "kind": p.paper_kind, "used_kg": round(used.get(p.code, 0), 1),
        "rolls_used": rolls.get(p.code, 0), "stock_kg": round(PAPER_OPENING_KG - used.get(p.code, 0), 1),
        "opening_kg": PAPER_OPENING_KG,
    } for p in db.scalars(select(PaperGrade).order_by(PaperGrade.id))]

    stock = [{"item_code": s.item_code, "item_name": items[s.item_code].name if s.item_code in items else s.item_code,
              "qty": s.qty} for s in db.scalars(select(ProductStock).order_by(ProductStock.qty.desc())) if s.qty > 0]
    return {
        "server_time": now(),
        "machines": machines,
        "conveyor": {"in_transit": in_transit},
        "papers": papers,
        "paper_used_kg": round(sum(used.values()), 1),
        "products": {"total_qty": sum(s["qty"] for s in stock), "items": stock[:6]},
        "work_orders": {
            "total": len(wos), "done": sum(1 for w in wos if w.status == "DONE"),
            "in_prod": sum(1 for w in wos if w.status == "IN_PROD"),
            "issued": sum(1 for w in wos if w.status == "ISSUED"),
        },
    }


@router.get("/interfaces")
def interfaces(db: Session = Depends(get_db)):
    """I/F 흐름 맵: 시스템별·I/F별 누적 건수와 실패 건수."""
    rows = db.execute(select(IfMessage.if_id, IfMessage.status, func.count())
                      .group_by(IfMessage.if_id, IfMessage.status)).all()
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "failed": 0})
    for if_id, status, n in rows:
        counts[if_id]["total"] += n
        if status == "FAILED":
            counts[if_id]["failed"] += n
    return [{"if_id": d.if_id, "system": d.system, "direction": d.direction, "name": d.name,
             **counts[d.if_id]} for d in IF_CATALOG]


# ---------------------------------------------------------------- 공장(시설) 모니터링
# 데모용 시설 계측값. 실제 센서는 없으므로 시각(초)과 현재 설비 가동 여부로 그럴듯한 값을 만든다.
# 같은 시각엔 같은 값이 나오도록 상태를 저장하지 않는다(여러 브라우저가 봐도 동일).
def _wave(t: float, period: float, phase: float = 0.0) -> float:
    return math.sin(2 * math.pi * (t / period + phase))


def _noise(t: float, salt: int) -> float:
    """초 단위로 바뀌는 -1~1 의사난수."""
    x = math.sin((int(t) * 12.9898 + salt * 78.233)) * 43758.5453
    return (x - math.floor(x)) * 2 - 1


def _metric(key: str, label: str, value: float, unit: str, lo: float | None = None, hi: float | None = None,
            digits: int = 1) -> dict:
    return {"key": key, "label": label, "value": round(value, digits), "unit": unit, "lo": lo, "hi": hi}


def _status(metrics: list[dict]) -> str:
    for m in metrics:
        if (m["lo"] is not None and m["value"] < m["lo"]) or (m["hi"] is not None and m["value"] > m["hi"]):
            return "WARN"
    return "OK"


@router.get("/facility")
def facility(db: Session = Depends(get_db)):
    """공장 모니터링: 보일러·전분 조리·공기압축기·수배전·파지 처리·폐수·창고 환경 등 유틸리티 시설."""
    running = {code for (code,) in db.execute(
        select(WorkOrderRoute.equipment_code).where(WorkOrderRoute.status == "RUN")).all()}
    cg, pr, ev = ("CG01" in running), ("PR05" in running), ("EV01" in running)
    load = (0.55 if cg else 0) + (0.25 if pr else 0) + (0.2 if ev else 0)  # 0~1 공장 부하
    t = time.time()
    n = lambda salt, a=1.0: _noise(t, salt) * a  # noqa: E731

    # 보일러: 골판지기 열판·싱글페이서에 스팀 공급(165~185℃). 골판지기 가동 시 부하가 오른다.
    steam = 2.1 + (3.4 if cg else 0.4) + 0.25 * _wave(t, 90) + n(1, 0.08)
    boiler = [
        _metric("pressure", "스팀 압력", 10.2 + 0.35 * _wave(t, 140) - (0.3 if cg else 0) + n(2, 0.05), "bar", 9.0, 12.0),
        _metric("steam", "스팀 공급량", steam, "t/h"),
        _metric("gas", "LNG 사용량", steam * 74 + n(3, 4), "Nm³/h", digits=0),
        _metric("roll_temp", "열판 온도", (176 if cg else 128) + 3 * _wave(t, 75) + n(4, 0.6), "℃", 165 if cg else None, 190),
    ]
    # 전분 조리실: 탱크 수위는 골판지기 소모로 내려가고 주기적으로 배치 조리해 채운다(6분 주기).
    cycle = (t % 360) / 360
    level = 92 - cycle * (78 if cg else 20)
    starch = [
        _metric("level", "저장 탱크 수위", level, "%", 20, None),
        _metric("viscosity", "점도(Stein-Hall)", 42 + 2.5 * _wave(t, 200) + n(5, 0.4), "초", 35, 50),
        _metric("temp", "전분 온도", 34 + 1.2 * _wave(t, 160) + n(6, 0.2), "℃", 30, 40),
        _metric("usage", "전분 사용량", (310 if cg else 0) + n(7, 6) * (1 if cg else 0), "kg/h", digits=0),
    ]
    # 공기압축기: 7분마다 40초 정도 압력 강하(누기·피크 수요) 이벤트를 연출한다.
    dip = 0.9 if (t % 420) < 40 else 0
    air = [
        _metric("pressure", "토출 압력", 7.1 + 0.12 * _wave(t, 50) - dip + n(8, 0.03), "bar", 6.5, 7.8, 2),
        _metric("flow", "공기 유량", 18 + 22 * load + n(9, 0.6), "m³/min"),
        _metric("power", "전력", 95 + 120 * load + n(10, 3), "kW", digits=0),
        _metric("units", "가동 대수", 1 + (1 if load > 0.5 else 0) + (1 if dip else 0), "/ 3대", digits=0),
    ]
    # 수배전: 공장 전체 전력. 설비 부하 + 유틸리티 기저.
    kw = 420 + 980 * load + 30 * _wave(t, 60) + n(11, 12)
    elec = [
        _metric("power", "현재 전력", kw, "kW", None, 1600, 0),
        _metric("pf", "역률", 0.94 + 0.02 * _wave(t, 300) + n(12, 0.004), "", 0.9, None, 3),
        _metric("peak", "최대수요 대비", kw / 1800 * 100, "%", None, 85, 0),
        _metric("trafo_temp", "변압기 온도", 52 + 14 * load + n(13, 0.5), "℃", None, 80),
    ]
    # 파지 처리: 슬리터 트림·불량 원단 → 사이클론 집진 → 베일러 압축.
    trim = (620 if cg else 40) + (90 if ev else 0) + n(14, 15)
    waste = [
        _metric("trim", "파지 발생", trim, "kg/h", digits=0),
        _metric("hopper", "베일러 호퍼", 15 + (t % 600) / 600 * (75 if cg else 20), "%", None, 90, 0),
        _metric("bales", "금일 베일 수", 18 + int(t // 600) % 24, "개", digits=0),
        _metric("fan", "집진 풍량", (420 if cg else 180) + n(15, 8), "m³/min", digits=0),
    ]
    # 폐수 처리: 인쇄기 잉크 세척수.
    water = [
        _metric("ph", "방류 pH", 7.3 + 0.3 * _wave(t, 240) + n(16, 0.05), "", 5.8, 8.6, 2),
        _metric("flow", "처리량", (6.5 if pr else 1.2) + n(17, 0.2), "m³/h"),
        _metric("ss", "부유물질(SS)", 18 + 4 * _wave(t, 300) + n(18, 0.6), "mg/L", None, 30),
    ]
    # 창고 환경: 원지는 수분에 민감(상대습도 45~65% 관리).
    roll_wh = [
        _metric("temp", "온도", 17 + 1.5 * _wave(t, 900) + n(19, 0.1), "℃"),
        _metric("rh", "상대습도", 56 + 6 * _wave(t, 700, 0.2) + n(20, 0.3), "%", 45, 65),
        _metric("clamp", "클램프 지게차", 2 + (1 if cg else 0), "대 가동", digits=0),
    ]
    fg_wh = [
        _metric("temp", "온도", 18 + 1.2 * _wave(t, 800) + n(21, 0.1), "℃"),
        _metric("rh", "상대습도", 52 + 5 * _wave(t, 650) + n(22, 0.3), "%", 40, 65),
        _metric("dock", "출하 도크 사용", 1 + int(t // 300) % 3, "/ 4", digits=0),
    ]
    safety = [
        _metric("fire", "화재 감지기 이상", 0, "개", None, 0, 0),
        _metric("people", "현장 인원", 23 + (6 if cg else 0) + (3 if pr else 0) + (3 if ev else 0), "명", digits=0),
        _metric("forklift", "지게차 가동", 4 + (2 if load > 0.5 else 0), "대", digits=0),
    ]

    defs = [
        ("BOILER", "보일러실", "스팀 공급(골판지기 열판·싱글페이서)", boiler, cg),
        ("STARCH", "전분 조리실", "골판지 접착용 전분 풀 조리·공급", starch, cg),
        ("AIR", "공기압축기실", "설비 공압(피더·슬리터·스태커)", air, load > 0),
        ("ELEC", "수배전실", "22.9kV 수전·변압기", elec, True),
        ("WASTE", "파지 집진·베일러", "트림·불량 원단 회수·압축", waste, cg or ev),
        ("WATER", "폐수 처리장", "인쇄 잉크 세척수 처리", water, pr),
        ("ROLL_WH", "원지 창고", "원지 롤 보관·온습도 관리", roll_wh, True),
        ("FG_WH", "제품 창고·출하장", "팔레트 보관·상차 도크", fg_wh, True),
        ("SAFETY", "안전·출입", "화재 감지·현장 인원", safety, True),
    ]
    facilities = []
    for code, name, desc, metrics, active in defs:
        facilities.append({"code": code, "name": name, "desc": desc, "active": bool(active),
                           "status": _status(metrics), "metrics": metrics})
    return {
        "server_time": now(),
        "load": round(load, 2),
        "running": sorted(running),
        "energy": {
            "power_kw": round(kw), "steam_tph": round(steam, 1), "air_m3min": air[1]["value"],
            "gas_nm3h": boiler[2]["value"],
            # 데모 단가: 전력 140원/kWh, LNG 1,100원/Nm³
            "cost_per_hour": round(kw * 140 + boiler[2]["value"] * 1100, -2),
        },
        "facilities": facilities,
    }
