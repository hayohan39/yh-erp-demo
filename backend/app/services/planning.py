"""스케쥴 생성·확정 → 생산지시 발행."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.interfaces import gateway
from app.models import (
    BoardSpec, CorrugatorRun, ItemBox, PaperGrade, RunSlot, SalesOrder, SalesOrderLine, SchedulePlan,
    WorkOrder, WorkOrderRoute,
)
from app.models._types import now
from app.services import events
from app.services.scheduling import TAKE_UP, Demand, blank_size, manual_plan, optimize


def board_paper(db: Session, spec_code: str) -> list[tuple[str, float]]:
    """원단 1m²당 원지 사용량 [(원지코드, kg)]."""
    spec = db.scalar(select(BoardSpec).where(BoardSpec.code == spec_code))
    grades = {g.code: g for g in db.scalars(select(PaperGrade))}
    factor = TAKE_UP.get(spec.flute, 1.4)
    return [
        (spec.outer_liner, grades[spec.outer_liner].basis_weight / 1000),
        (spec.medium, grades[spec.medium].basis_weight * factor / 1000),
        (spec.inner_liner, grades[spec.inner_liner].basis_weight / 1000),
    ]


def paper_cost_per_m2(db: Session, spec_code: str) -> tuple[float, float]:
    """(kg/m², 원/m²)"""
    prices = {g.code: g.price_per_kg for g in db.scalars(select(PaperGrade))}
    parts = board_paper(db, spec_code)
    return sum(kg for _, kg in parts), sum(kg * prices[c] for c, kg in parts)


def _next_no(db: Session, model, col, prefix: str) -> str:
    p = f"{prefix}{date.today():%y%m%d}"
    n = db.scalar(select(func.count()).select_from(model).where(col.like(f"{p}%"))) or 0
    return f"{p}{n + 1:03d}"


def create_plan(db: Session) -> SchedulePlan:
    """수주접수(RECEIVED) 상태인 수주로 원단 스케쥴 초안을 만든다. 기존 초안은 대체한다."""
    for old in db.scalars(select(SchedulePlan).where(SchedulePlan.status == "DRAFT")):
        db.delete(old)
    db.flush()

    orders = list(db.scalars(
        select(SalesOrder).options(selectinload(SalesOrder.lines)).where(SalesOrder.status == "RECEIVED")
    ))
    if not orders:
        raise ValueError("스케쥴링할 수주가 없습니다 (수주접수 상태 없음)")
    items = {i.code: i for i in db.scalars(select(ItemBox))}
    demands = []
    for o in orders:
        for ln in o.lines:
            it = items[ln.item_code]
            bw, bl = blank_size(it.length_mm, it.width_mm, it.height_mm)
            demands.append(Demand(ln.id, it.code, it.board_spec_code, bw, bl, ln.qty))

    opt, manual = optimize(demands), manual_plan(demands)

    # 절감액: 같은 수요를 만드는 데 필요한 원단 면적 차이 × 원단별 원지 단가
    def paper(plan) -> tuple[float, float]:
        kg = amt = 0.0
        for r in plan.runs:
            k, a = paper_cost_per_m2(db, r.board_spec)
            kg += k * r.area_m2
            amt += a * r.area_m2
        return kg, amt

    opt_kg, opt_amt = paper(opt)
    man_kg, man_amt = paper(manual)
    plan = SchedulePlan(
        plan_no=_next_no(db, SchedulePlan, SchedulePlan.plan_no, "CP"),
        order_count=len(orders),
        area_m2=round(opt.area_m2, 1), trim_rate=round(opt.trim_rate, 4),
        manual_area_m2=round(manual.area_m2, 1), manual_trim_rate=round(manual.trim_rate, 4),
        saved_paper_kg=round(man_kg - opt_kg, 1), saved_amount=round(man_amt - opt_amt, -1),
    )
    for seq, r in enumerate(opt.runs, start=1):
        run = CorrugatorRun(
            seq=seq, board_spec_code=r.board_spec, roll_width=r.roll_width, cuts=r.cuts,
            cut_length=r.cut_length, trim_mm=r.trim_mm, length_m=round(r.length_m, 1),
            trim_rate=round(r.trim_area_m2 / r.area_m2, 4) if r.area_m2 else 0,
        )
        for s in r.slots:
            run.slots.append(RunSlot(order_line_id=s.key, item_code=s.item_code, ups=s.ups,
                                     blank_w=s.blank_w, blank_l=s.blank_l, sheets=s.sheets))
        plan.runs.append(run)
    db.add(plan)
    db.commit()
    events.publish("schedule", {"plan_no": plan.plan_no})
    return plan


def confirm_plan(db: Session, plan: SchedulePlan) -> list[WorkOrder]:
    """스케쥴 확정 → 수주 라인별 생산지시 생성 → 설비·MES·PMS·오토콘에 지시 송신."""
    if plan.status != "DRAFT":
        raise ValueError("이미 확정된 스케쥴입니다")
    line_ids = {s.order_line_id for r in plan.runs for s in r.slots}
    lines = {ln.id: ln for ln in db.scalars(select(SalesOrderLine).where(SalesOrderLine.id.in_(line_ids)))}
    items = {i.code: i for i in db.scalars(select(ItemBox))}

    wos: dict[int, WorkOrder] = {}
    base = _next_no(db, WorkOrder, WorkOrder.wo_no, "WO")
    prefix, start = base[:-3], int(base[-3:])
    for n, line_id in enumerate(sorted(line_ids)):
        ln = lines[line_id]
        it = items[ln.item_code]
        wo = WorkOrder(wo_no=f"{prefix}{start + n:03d}", plan_id=plan.id, order_id=ln.order_id,
                       order_line_id=ln.id, item_code=it.code, board_spec_code=it.board_spec_code, qty=ln.qty)
        steps = [("CORRUGATE", "CG01")] + ([("PRINT", "PR05")] if it.print_colors > 0 else []) + [("CONVERT", "EV01")]
        for seq, (proc, eq) in enumerate(steps, start=1):
            wo.routes.append(WorkOrderRoute(seq=seq, process=proc, equipment_code=eq))
        db.add(wo)
        wos[line_id] = wo
    for o in db.scalars(select(SalesOrder).where(SalesOrder.id.in_({ln.order_id for ln in lines.values()}))):
        o.status = "PLANNED"
    plan.status = "CONFIRMED"
    plan.confirmed_at = now()
    db.commit()

    _send_instructions(db, plan, wos)
    events.publish("work_order", {"plan_no": plan.plan_no, "count": len(wos)})
    return list(wos.values())


def _send_instructions(db: Session, plan: SchedulePlan, wos: dict[int, WorkOrder]) -> None:
    runs: list[dict[str, Any]] = [
        {
            "seq": r.seq, "board_spec": r.board_spec_code, "roll_width": r.roll_width, "cuts": r.cuts,
            "length_m": r.length_m,
            "slots": [{"wo_no": wos[s.order_line_id].wo_no, "item_code": s.item_code, "ups": s.ups,
                       "sheets": s.sheets} for s in r.slots],
        }
        for r in plan.runs
    ]
    # 원지 소요량: 런 면적 × 원단별 원지 kg/m²
    need: dict[str, float] = {}
    for r in plan.runs:
        area = r.roll_width / 1000 * r.length_m
        for code, kg in board_paper(db, r.board_spec_code):
            need[code] = need.get(code, 0) + kg * area

    def wo_payload(wo: WorkOrder, proc: str | None = None) -> dict[str, Any]:
        return {
            "wo_no": wo.wo_no, "item_code": wo.item_code, "board_spec": wo.board_spec_code, "qty": wo.qty,
            "routes": [{"seq": rt.seq, "process": rt.process, "equipment_code": rt.equipment_code}
                       for rt in wo.routes if proc is None or rt.process == proc],
        }

    all_wos = list(wos.values())
    gateway.send(db, "IF-MES-01", {"plan_no": plan.plan_no, "work_orders": [wo_payload(w) for w in all_wos]})
    gateway.send(db, "IF-EQ-01", {"plan_no": plan.plan_no, "runs": runs})
    gateway.send(db, "IF-EXT-03", {"plan_no": plan.plan_no,
                                   "transfers": [s for r in runs for s in r["slots"]]})
    gateway.send(db, "IF-PMS-02", {"plan_no": plan.plan_no,
                                   "requirements": [{"paper_code": c, "kg": round(kg, 1)} for c, kg in need.items()]})
    print_wos = [wo_payload(w, "PRINT") for w in all_wos if any(r.process == "PRINT" for r in w.routes)]
    if print_wos:
        gateway.send(db, "IF-EQ-05", {"plan_no": plan.plan_no, "work_orders": print_wos})
    gateway.send(db, "IF-EQ-03", {"plan_no": plan.plan_no, "work_orders": [wo_payload(w, "CONVERT") for w in all_wos]})
