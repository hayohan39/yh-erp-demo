def _order_env(message_id="m-1", oms_no="OMS-0001"):
    return {
        "if_id": "IF-OMS-01",
        "message_id": message_id,
        "source": "OMS",
        "payload": {
            "oms_order_no": oms_no,
            "customer_code": "C001",
            "due_date": "2026-12-05",
            "lines": [{"item_code": "BX0001", "qty": 1000}],
        },
    }


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_seed_data(client):
    assert len(client.get("/api/master/items").json()) == 30
    assert len(client.get("/api/master/partners", params={"partner_type": "CUSTOMER"}).json()) == 8


def test_oms_order_creates_sales_order_and_replies(client):
    r = client.post("/api/if/inbound", json=_order_env()).json()
    assert r["status"] == "PROCESSED"
    order_no = r["result"]["order_no"]

    orders = client.get("/api/sales/orders").json()
    assert orders[0]["order_no"] == order_no
    assert orders[0]["total_amount"] > 0

    msgs = client.get("/api/if/messages").json()
    assert {m["if_id"] for m in msgs} == {"IF-OMS-01", "IF-OMS-02"}
    out = next(m for m in msgs if m["if_id"] == "IF-OMS-02")
    assert out["direction"] == "OUT" and out["status"] == "SENT"


def test_duplicate_message_is_ignored(client):
    client.post("/api/if/inbound", json=_order_env())
    r = client.post("/api/if/inbound", json=_order_env()).json()
    assert r["duplicate"] is True
    assert len(client.get("/api/sales/orders").json()) == 1


def test_failed_message_can_be_retried(client):
    env = _order_env(message_id="m-bad")
    env["payload"]["customer_code"] = "C999"
    r = client.post("/api/if/inbound", json=env).json()
    assert r["status"] == "FAILED"
    assert "미등록 거래처" in r["error"]

    msg = client.get("/api/if/messages", params={"status": "FAILED"}).json()[0]
    again = client.post(f"/api/if/messages/{msg['id']}/retry").json()
    assert again["status"] == "FAILED" and again["retry_count"] == 1


def test_catalog_has_18_interfaces(client):
    cat = client.get("/api/if/catalog").json()
    assert len(cat) == 18
