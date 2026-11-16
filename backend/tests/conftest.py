import os

os.environ["DATABASE_URL"] = "sqlite:///./test-erp.db"
os.environ["LEGACY_OUTBOUND_URL"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client():
    from app.main import app

    with TestClient(app) as c:
        c.post("/api/admin/reset")
        yield c
