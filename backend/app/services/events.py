"""SSE로 화면에 실시간 이벤트를 밀어주는 단순 인메모리 브로커 (단일 프로세스 데모용)."""
import asyncio
import json
from typing import Any

_subscribers: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def publish(event: str, data: dict[str, Any]) -> None:
    """동기 핸들러(스레드풀)에서도 호출할 수 있게 이벤트 루프로 넘긴다."""
    msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
    for q in list(_subscribers):
        if _loop is None:
            continue
        _loop.call_soon_threadsafe(_put_nowait, q, msg)


def _put_nowait(q: asyncio.Queue, msg: str) -> None:
    try:
        q.put_nowait(msg)
    except asyncio.QueueFull:
        pass
