import logging
import time
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


engine = _make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def wait_for_db(retries: int) -> None:
    """Oracle 컨테이너는 첫 기동에 수십 초가 걸리므로 연결될 때까지 기다린다."""
    probe = "SELECT 1 FROM DUAL" if engine.dialect.name == "oracle" else "SELECT 1"
    for attempt in range(1, retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text(probe))
            return
        except Exception as exc:  # noqa: BLE001
            log.warning("DB 연결 대기 중 (%s/%s): %s", attempt, retries, exc)
            time.sleep(5)
    raise RuntimeError("DB에 연결할 수 없습니다")
