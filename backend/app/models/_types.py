from datetime import datetime, timezone

from sqlalchemy import Identity, Integer
from sqlalchemy.orm import mapped_column


def pk():
    """PostgreSQL에서는 IDENTITY 컬럼, SQLite(테스트)에서는 일반 autoincrement로 동작."""
    return mapped_column(Integer, Identity(start=1), primary_key=True)


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
