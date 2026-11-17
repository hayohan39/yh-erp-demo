"""레거시 I/F 시뮬레이터.

OMS·MES·PMS·설비·외부 시스템 역할을 대신해 공통 봉투 규격으로 ERP 게이트웨이에 데이터를 보내고,
ERP가 보낸 지시(OUT 메시지)를 받는다. 본 구축 때는 이 서비스 자리에 실제 레거시 어댑터가 들어간다.
"""
import asyncio
import logging
import random
import uuid
from collections import deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pydantic_settings import BaseSettings

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("simulator")


class Settings(BaseSettings):
    erp_url: str = "http://backend:8000"
    base_interval_sec: float = 20.0  # 1배속일 때 자동 주문 발생 간격


settings = Settings()


class SimState:
    def __init__(self) -> None:
        self.running = False
        self.speed = 1.0
        self.sent = 0
        self.failed = 0
        self.received: deque[dict[str, Any]] = deque(maxlen=200)
        self.seq = 0
        self.task: asyncio.Task | None = None
        self.rng = random.Random(1201)
        self.defect_spike = False  # 시연용: 다음 인쇄 작업 1건 불량 급증
        self.prod_tasks: set[asyncio.Task] = set()
        self.wo_state: dict[str, str] = {}  # wo_no -> QUEUED/CORRUGATE/PRINT/CONVERT/DONE


state = SimState()


async def _erp_get(path: str) -> Any:
    async with httpx.AsyncClient(base_url=settings.erp_url, timeout=10) as c:
        r = await c.get(path)
        r.raise_for_status()
        return r.json()


async def send_envelope(if_id: str, source: str, payload: dict[str, Any]) -> dict[str, Any]:
    env = {
        "if_id": if_id,
        "message_id": uuid.uuid4().hex,
        "source": source,
        "target": "ERP",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }
    try:
        async with httpx.AsyncClient(base_url=settings.erp_url, timeout=10) as c:
            r = await c.post("/api/if/inbound", json=env)
            r.raise_for_status()
            state.sent += 1
            return r.json()
    except Exception as exc:  # noqa: BLE001
        state.failed += 1
        log.warning("ERP 송신 실패 %s: %s", if_id, exc)
        raise HTTPException(502, f"ERP 송신 실패: {exc}") from exc


async def make_oms_order(large: bool = False) -> dict[str, Any]:
    items = await _erp_get("/api/master/items")
    if not items:
        raise HTTPException(409, "ERP 기준정보가 비어 있습니다")
    rng = state.rng
    customer = rng.choice(sorted({i["customer_code"] for i in items}))
    cust_items = [i for i in items if i["customer_code"] == customer]
    picks = rng.sample(cust_items, k=min(len(cust_items), 3 if large else rng.randint(1, 2)))
    state.seq += 1
    today = date.today()
    return {
        "oms_order_no": f"OMS-{today:%y%m%d}-{uuid.uuid4().hex[:6].upper()}",
        "customer_code": customer,
        "order_date": today.isoformat(),
        "due_date": (today + timedelta(days=rng.randint(3, 10))).isoformat(),
        "lines": [
            {"item_code": p["code"], "qty": rng.choice([5000, 8000, 12000]) if large else rng.choice([500, 1000, 2000, 3000])}
            for p in picks
        ],
    }


async def _loop() -> None:
    while state.running:
        try:
            await send_envelope("IF-OMS-01", "OMS", await make_oms_order())
        except Exception as exc:  # noqa: BLE001
            log.warning("자동 주문 발생 실패: %s", exc)
        await asyncio.sleep(max(settings.base_interval_sec / state.speed, 0.5))


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    state.running = False
    if state.task:
        state.task.cancel()


app = FastAPI(title="레거시 I/F 시뮬레이터", lifespan=lifespan)


@app.get("/api/sim/health")
def health():
    return {"status": "ok"}


@app.get("/api/sim/status")
def status():
    counts: dict[str, int] = {}
    for v in state.wo_state.values():
        counts[v] = counts.get(v, 0) + 1
    return {
        "running": state.running,
        "speed": state.speed,
        "sent": state.sent,
        "failed": state.failed,
        "received": len(state.received),
        "defect_spike": state.defect_spike,
        "production": counts,
    }


@app.post("/api/sim/start")
async def start():
    if not state.running:
        state.running = True
        state.task = asyncio.create_task(_loop())
    return status()


@app.post("/api/sim/stop")
async def stop():
    state.running = False
    if state.task:
        state.task.cancel()
        state.task = None
    return status()


class SpeedIn(BaseModel):
    speed: float


@app.post("/api/sim/speed")
def set_speed(body: SpeedIn):
    if not 0.1 <= body.speed <= 60:
        raise HTTPException(400, "배속은 0.1~60 사이")
    state.speed = body.speed
    return status()


@app.post("/api/sim/oms/order")
async def oms_order(large: bool = False):
    """OMS에서 주문 1건 발생 (시연 중 수동 버튼)."""
    payload = await make_oms_order(large=large)
    return {"payload": payload, "erp": await send_envelope("IF-OMS-01", "OMS", payload)}


@app.post("/api/sim/reset")
async def reset():
    """데모 초기화: 시뮬레이터 정지 후 ERP 데이터를 기준정보 상태로 되돌린다."""
    await stop()
    for t in list(state.prod_tasks):
        t.cancel()
    state.prod_tasks.clear()
    state.wo_state.clear()
    state.defect_spike = False
    async with httpx.AsyncClient(base_url=settings.erp_url, timeout=120) as c:
        (await c.post("/api/admin/reset")).raise_for_status()
    state.sent = state.failed = state.seq = 0
    state.received.clear()
    state.rng = random.Random(1201)
    return status()


@app.post("/api/sim/inbound")
async def inbound(env: dict[str, Any]):
    """ERP → 레거시 메시지 수신 (생산지시, 배차요청 등). 이후 설비·외부 시뮬레이터가 이 지시로 동작한다."""
    state.received.appendleft({**env, "received_at": datetime.now(timezone.utc).isoformat()})
    if env.get("if_id") == "IF-MES-01":
        for wo in env["payload"]["work_orders"]:
            state.wo_state[wo["wo_no"]] = "QUEUED"
            t = asyncio.create_task(factory.run_work_order(wo))
            state.prod_tasks.add(t)
            t.add_done_callback(state.prod_tasks.discard)
    ext = {"IF-EXT-02": external.logispot_dispatch, "IF-EXT-01": external.weago_issue}.get(env.get("if_id"))
    if ext:
        t = asyncio.create_task(ext(env["payload"]))
        state.prod_tasks.add(t)
        t.add_done_callback(state.prod_tasks.discard)
    return {"ack": True}


class SpikeIn(BaseModel):
    on: bool


@app.post("/api/sim/defect-spike")
def defect_spike(body: SpikeIn):
    """시연용: 다음 인쇄 작업 1건의 불량률을 높여 품질 알림 장면을 만든다."""
    state.defect_spike = body.on
    return status()


@app.get("/api/sim/received")
def received():
    return list(state.received)


from app import external, factory  # noqa: E402  - 이 모듈의 state·send_envelope를 쓰므로 마지막에 import
