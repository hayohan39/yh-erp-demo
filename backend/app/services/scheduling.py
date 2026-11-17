"""골판지기 원단 폭 조합(트림 최소화) 스케쥴러.

골판지기는 한 번에 한 가지 원단(골·원지 조합)만 생산하므로 원단 규격별로 묶은 뒤,
원지 폭(deckle) 안에 최대 2개 품목을 여러 장(ups)씩 나란히 배치해 남는 폭(트림)을 최소화한다.
비교 기준인 '수작업 계획'은 품목마다 단독으로 가장 맞는 원지 폭을 고르는 방식이다.

설명 가능한 그리디 휴리스틱으로 시작하고, 필요하면 OR-Tools(정수계획)로 교체할 수 있게
입력·출력을 순수 데이터로 분리했다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

ROLL_WIDTHS_MM = [1600, 1800, 2000, 2200, 2400]
MIN_TRIM_MM = 30  # 양쪽 귀 자르기 최소 폭
MAX_UPS = 6

# 골 종류별 골심지 사용 배수(take-up factor)
TAKE_UP = {"A": 1.55, "B": 1.35, "C": 1.45, "E": 1.25, "BA": 2.9}


def blank_size(length: int, width: int, height: int) -> tuple[int, int]:
    """A형(RSC) 상자 전개 크기 (폭, 길이) mm. 폭 방향이 골판지기의 폭 방향."""
    return width + height + 10, 2 * (length + width) + 40


@dataclass
class Demand:
    key: int  # 수주 라인 ID
    item_code: str
    board_spec: str
    blank_w: int  # mm, 골판지기 폭 방향
    blank_l: int  # mm, 진행 방향
    sheets: int


@dataclass
class Slot:
    key: int
    item_code: str
    ups: int
    blank_w: int
    blank_l: int
    sheets: int = 0


@dataclass
class Run:
    board_spec: str
    roll_width: int
    slots: list[Slot]
    cuts: int
    cut_length: int  # 한 컷의 진행 방향 길이(mm) = 배치된 품목 중 긴 쪽

    @property
    def used_width(self) -> int:
        return sum(s.ups * s.blank_w for s in self.slots)

    @property
    def trim_mm(self) -> int:
        return self.roll_width - self.used_width

    @property
    def length_m(self) -> float:
        return self.cuts * self.cut_length / 1000

    @property
    def area_m2(self) -> float:
        return self.roll_width / 1000 * self.length_m

    @property
    def trim_area_m2(self) -> float:
        """폭 방향 트림 + 길이가 짧은 품목 쪽에 생기는 길이 방향 손실."""
        side = self.trim_mm / 1000 * self.length_m
        length_loss = sum(
            s.ups * s.blank_w / 1000 * (self.cut_length - s.blank_l) / 1000 * self.cuts for s in self.slots
        )
        return side + length_loss


@dataclass
class PlanResult:
    runs: list[Run] = field(default_factory=list)

    @property
    def area_m2(self) -> float:
        return sum(r.area_m2 for r in self.runs)

    @property
    def trim_area_m2(self) -> float:
        return sum(r.trim_area_m2 for r in self.runs)

    @property
    def trim_rate(self) -> float:
        return self.trim_area_m2 / self.area_m2 if self.area_m2 else 0.0


def _best_single(w: int) -> tuple[int, int] | None:
    """한 품목만 놓을 때 트림률이 가장 낮은 (원지 폭, ups)."""
    best = None
    for roll in ROLL_WIDTHS_MM:
        for ups in range(1, MAX_UPS + 1):
            if ups * w + MIN_TRIM_MM > roll:
                break
            rate = (roll - ups * w) / roll
            if best is None or rate < best[0]:
                best = (rate, roll, ups)
    return (best[1], best[2]) if best else None


def manual_plan(demands: list[Demand]) -> PlanResult:
    """비교 기준: 품목별 단독 생산(수작업 계획 가정)."""
    res = PlanResult()
    for d in demands:
        fit = _best_single(d.blank_w)
        if not fit:
            continue
        roll, ups = fit
        cuts = math.ceil(d.sheets / ups)
        res.runs.append(Run(d.board_spec, roll, [Slot(d.key, d.item_code, ups, d.blank_w, d.blank_l, cuts * ups)], cuts, d.blank_l))
    return res


def optimize(demands: list[Demand]) -> PlanResult:
    """원단 규격별로 2품목 조합까지 탐색하는 그리디 폭 조합."""
    res = PlanResult()
    groups: dict[str, list[Demand]] = {}
    for d in demands:
        groups.setdefault(d.board_spec, []).append(d)

    for spec, items in sorted(groups.items()):
        remaining = {d.key: d.sheets for d in items}
        by_key = {d.key: d for d in items}
        while any(v > 0 for v in remaining.values()):
            open_items = [by_key[k] for k, v in remaining.items() if v > 0]
            # 남은 면적이 가장 큰 품목을 기준으로 짝을 찾는다
            a = max(open_items, key=lambda d: remaining[d.key] * d.blank_w * d.blank_l)
            best: tuple[float, int, int, Demand | None, int] | None = None
            for roll in ROLL_WIDTHS_MM:
                for ua in range(1, MAX_UPS + 1):
                    wa = ua * a.blank_w
                    if wa + MIN_TRIM_MM > roll:
                        break
                    cands: list[tuple[Demand | None, int]] = [(None, 0)]
                    for b in open_items:
                        if b.key == a.key:
                            continue
                        for ub in range(1, MAX_UPS + 1):
                            if wa + ub * b.blank_w + MIN_TRIM_MM > roll:
                                break
                            cands.append((b, ub))
                    for b, ub in cands:
                        used = wa + (ub * b.blank_w if b else 0)
                        rate = (roll - used) / roll
                        # 짝 품목은 기준 품목보다 먼저 끝나지 않을수록(같이 소진될수록) 좋다
                        if b:
                            cuts_a = remaining[a.key] / ua
                            cuts_b = remaining[b.key] / ub
                            balance = min(cuts_a, cuts_b) / max(cuts_a, cuts_b)
                            rate += (1 - balance) * 0.02
                            # 길이가 다른 품목을 붙이면 짧은 쪽에 손실이 생긴다
                            long_l = max(a.blank_l, b.blank_l)
                            loss = (wa * (long_l - a.blank_l) + ub * b.blank_w * (long_l - b.blank_l)) / long_l
                            rate += loss / roll
                        if best is None or rate < best[0]:
                            best = (rate, roll, ua, b, ub)
            if best is None:  # 원지 폭보다 큰 품목: 계획 불가
                remaining[a.key] = 0
                continue
            _, roll, ua, b, ub = best
            cuts = math.ceil(remaining[a.key] / ua)
            if b:
                cuts = min(cuts, math.ceil(remaining[b.key] / ub))
            slots = [Slot(a.key, a.item_code, ua, a.blank_w, a.blank_l, min(cuts * ua, remaining[a.key]))]
            remaining[a.key] = max(0, remaining[a.key] - cuts * ua)
            cut_len = a.blank_l
            if b:
                slots.append(Slot(b.key, b.item_code, ub, b.blank_w, b.blank_l, min(cuts * ub, remaining[b.key])))
                remaining[b.key] = max(0, remaining[b.key] - cuts * ub)
                cut_len = max(a.blank_l, b.blank_l)
            prev = res.runs[-1] if res.runs else None
            sig = [(s.key, s.ups) for s in slots]
            if prev and prev.board_spec == spec and prev.roll_width == roll and [(s.key, s.ups) for s in prev.slots] == sig:
                prev.cuts += cuts  # 같은 배치가 이어지면 한 런으로 합친다
                for ps, s in zip(prev.slots, slots):
                    ps.sheets += s.sheets
            else:
                res.runs.append(Run(spec, roll, slots, cuts, cut_len))
    return res
