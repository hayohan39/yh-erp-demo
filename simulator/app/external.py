"""외부 서비스 시뮬레이터: 로지스팟(배차), 위아고(전자세금계산서). 결과는 같은 I/F ID의 콜백으로 ERP에 보낸다."""
import random
from datetime import date
from typing import Any

from app.factory import _sleep_minutes
from app.main import send_envelope

_rng = random.Random(2026)
CARRIERS = [("T001", "바른물류"), ("T002", "이음운송")]
DRIVERS = ["김정훈", "박성민", "이재원", "최동현", "정우진"]
_seq = {"nts": 0}


async def logispot_dispatch(p: dict[str, Any]) -> None:
    """배차 요청 → (15분) 차량 배정 → (25분) 상차 완료·출발."""
    await _sleep_minutes(15)
    code, name = _rng.choice(CARRIERS)
    qty = int(p.get("total_qty") or 0)
    await send_envelope("IF-EXT-02", "로지스팟", {
        "event": "DISPATCHED", "shipment_no": p["shipment_no"], "carrier_code": code, "carrier_name": name,
        "vehicle_no": f"{_rng.choice(['경기', '인천', '충남'])}{_rng.randint(80, 99)}바{_rng.randint(1000, 9999)}",
        "driver_name": _rng.choice(DRIVERS), "driver_phone": f"010-{_rng.randint(2000, 9999)}-{_rng.randint(1000, 9999)}",
        "vehicle_type": "5톤 윙바디" if qty > 6000 else "2.5톤 카고",
        "freight_amount": round((80000 + qty * 1.5) * _rng.uniform(0.92, 1.15), -3),
    })
    await _sleep_minutes(25)
    await send_envelope("IF-EXT-02", "로지스팟", {"event": "SHIPPED", "shipment_no": p["shipment_no"]})


async def weago_issue(p: dict[str, Any]) -> None:
    """발행 요청 → (3분) 국세청 전송·승인번호 회신."""
    await _sleep_minutes(3)
    _seq["nts"] += 1
    approval = f"{date.today():%Y%m%d}-4100{_rng.randint(1000, 9999)}-{_seq['nts']:08d}"
    await send_envelope("IF-EXT-01", "위아고", {"invoice_no": p["invoice_no"], "nts_approval_no": approval,
                                              "result": "국세청 전송 완료"})
