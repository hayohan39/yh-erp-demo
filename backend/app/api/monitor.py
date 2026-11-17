"""실시간 모니터링 맵(공장 맵·I/F 흐름 맵)용 상태 조회."""
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.interfaces.catalog import IF_CATALOG
from app.models import Defect, Equipment, IfMessage, ItemBox, PaperGrade, PaperUsage, ProductStock, WorkOrder
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
