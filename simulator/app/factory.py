"""설비 시뮬레이터: 골게터 POP → 오토콘 → 인쇄 5호기 → 에볼/썬라이즈, 그리고 PMS·MES 보고.

ERP가 보낸 생산지시(IF-MES-01)를 받아 설비별로 순서대로(설비당 한 번에 하나) 생산하고,
실제 레거시처럼 각 시스템 이름으로 실적을 ERP에 보낸다. 시간은 배속에 따라 압축된다
(1배속: 생산 1분 = 1초).
"""
import asyncio
import math
import random
from typing import Any

from app.main import _erp_get, send_envelope, state

EQUIPMENT_IF = {
    "CORRUGATE": ("IF-EQ-02", "골게터 POP"),
    "PRINT": ("IF-EQ-06", "인쇄 5호기"),
    "CONVERT": ("IF-EQ-04", "에볼/썬라이즈"),
}
DEFECT_TYPES = {
    "CORRUGATE": ["접착 불량", "휨(warp)", "골 눌림"],
    "PRINT": ["인쇄 번짐", "색상 편차", "인쇄 위치 틀어짐"],
    "CONVERT": ["접합 불량", "타발 불량", "치수 불량"],
}
TAKE_UP = {"A": 1.55, "B": 1.35, "C": 1.45, "E": 1.25, "BA": 2.9}

_locks: dict[str, asyncio.Lock] = {}
_master: dict[str, Any] = {}
_rng = random.Random(77)


async def _load_master() -> dict[str, Any]:
    if not _master:
        _master["items"] = {i["code"]: i for i in await _erp_get("/api/master/items")}
        _master["equipment"] = {e["code"]: e for e in await _erp_get("/api/master/equipment")}
        _master["specs"] = {b["code"]: b for b in await _erp_get("/api/master/board-specs")}
        _master["papers"] = {p["code"]: p for p in await _erp_get("/api/master/paper-grades")}
    return _master


async def _sleep_minutes(minutes: float) -> None:
    await asyncio.sleep(max(minutes / state.speed, 0.3))


def _paper_rolls(m: dict[str, Any], item: dict[str, Any], sheets: int, wo_no: str) -> list[dict[str, Any]]:
    spec = m["specs"][item["board_spec_code"]]
    bw = item["width_mm"] + item["height_mm"] + 10
    bl = 2 * (item["length_mm"] + item["width_mm"]) + 40
    area = bw * bl / 1e6 * sheets * 1.04  # 트림·손지 4% 가정
    layers = [(spec["outer_liner"], 1.0), (spec["medium"], TAKE_UP.get(spec["flute"], 1.4)), (spec["inner_liner"], 1.0)]
    rolls = []
    for i, (code, factor) in enumerate(layers, start=1):
        kg = area * m["papers"][code]["basis_weight"] * factor / 1000
        rolls.append({"roll_no": f"R{wo_no[-6:]}-{i}", "paper_code": code, "used_kg": round(kg, 1)})
    return rolls


async def run_work_order(wo: dict[str, Any]) -> None:
    m = await _load_master()
    item = m["items"][wo["item_code"]]
    qty = int(wo["qty"])
    for route in wo["routes"]:
        proc, eq_code = route["process"], route["equipment_code"]
        eq = m["equipment"][eq_code]
        lock = _locks.setdefault(eq_code, asyncio.Lock())
        if_id, source = EQUIPMENT_IF[proc]
        async with lock:
            state.wo_state[wo["wo_no"]] = proc
            await send_envelope(if_id, source, {"event": "START", "wo_no": wo["wo_no"], "process": proc,
                                                "equipment_code": eq_code})
            minutes = qty / eq["capacity_per_hour"] * 60 + 5  # 셋업 5분
            await _sleep_minutes(minutes)
            rate = eq["base_defect_rate"] * _rng.uniform(0.5, 1.3)  # 평상시엔 알림 기준(3%) 아래
            if proc == "PRINT" and state.defect_spike:
                rate = _rng.uniform(0.06, 0.09)
                state.defect_spike = False  # 다음 인쇄 작업 1건에만 적용
            bad = math.ceil(qty * rate)
            good = qty - bad
            if proc == "CORRUGATE":
                await send_envelope("IF-PMS-01", "PMS",
                                    {"wo_no": wo["wo_no"], "rolls": _paper_rolls(m, item, qty, wo["wo_no"])})
            await send_envelope(if_id, source, {
                "event": "END", "wo_no": wo["wo_no"], "process": proc, "equipment_code": eq_code, "good_qty": good,
                "defect_qty": bad, "defect_type": _rng.choice(DEFECT_TYPES[proc]), "run_minutes": round(minutes, 1),
            })
        state.wo_state[wo["wo_no"]] = "QUEUED"
        if proc == "CORRUGATE":  # 오토콘 컨베이어로 원단 이송
            await _sleep_minutes(3)
            await send_envelope("IF-EXT-04", "오토콘", {"wo_no": wo["wo_no"], "sheets": good})
        qty = good
    await send_envelope("IF-MES-02", "MES", {"wo_no": wo["wo_no"], "good_qty": qty})
    state.wo_state[wo["wo_no"]] = "DONE"
