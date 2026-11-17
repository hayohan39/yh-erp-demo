from tests import test_production_flow as pf

_send = pf._send


def _out(client, if_id):
    return [m for m in client.get("/api/if/messages", params={"if_id": if_id}).json() if m["direction"] == "OUT"]


def test_ship_close_invoice_voucher_cost(client):
    pf.test_order_to_production_flow(client)
    order_no = client.get("/api/sales/orders").json()[0]["order_no"]
    ready = client.get("/api/shipping/ready").json()
    assert [r["order_no"] for r in ready] == [order_no] and ready[0]["total_qty"] > 0
    stock_before = sum(s["qty"] for s in client.get("/api/shipping/stock").json())

    sh_no = client.post("/api/shipping/requests", json={"order_no": order_no}).json()["shipment_no"]
    assert client.post("/api/shipping/requests", json={"order_no": order_no}).status_code == 400
    assert len(_out(client, "IF-EXT-02")) == 1
    assert client.get("/api/sales/orders").json()[0]["status"] == "SHIPPING"

    _send(client, "IF-EXT-02", "로지스팟", {"event": "DISPATCHED", "shipment_no": sh_no, "carrier_code": "T001",
                                          "vehicle_no": "경기12가3456", "driver_name": "김기사",
                                          "driver_phone": "010-0000-0000", "freight_amount": 150000}, "d1")
    sh = client.get("/api/shipping/shipments").json()[0]
    assert sh["status"] == "DISPATCHED" and sh["carrier_name"] == "바른물류" and sh["freight_amount"] == 150000
    _send(client, "IF-EXT-02", "로지스팟", {"event": "SHIPPED", "shipment_no": sh_no}, "d2")
    assert client.get("/api/shipping/shipments").json()[0]["status"] == "SHIPPED"
    assert sum(s["qty"] for s in client.get("/api/shipping/stock").json()) == stock_before - sh["total_qty"]
    assert client.get("/api/sales/orders").json()[0]["status"] == "SHIPPED"

    closable = client.get("/api/settlement/closable").json()
    assert closable[0]["order_no"] == order_no and closable[0]["vat_amount"] == round(closable[0]["supply_amount"] * 0.1)
    inv_no = client.post("/api/settlement/close", json={}).json()["invoices"][0]
    assert len(_out(client, "IF-EXT-01")) == 1
    _send(client, "IF-EXT-01", "위아고", {"invoice_no": inv_no, "nts_approval_no": "20261117-41000000-00000001"}, "w1")
    inv = client.get("/api/settlement/invoices").json()[0]
    assert inv["status"] == "ISSUED" and inv["nts_approval_no"].startswith("2026")
    assert client.get("/api/sales/orders").json()[0]["status"] == "CLOSED"
    assert len(_out(client, "IF-OMS-03")) == 1

    r = client.post("/api/settlement/vouchers/export")
    assert r.status_code == 200 and "외상매출금" in r.text and r.headers["x-voucher-count"] == "1"
    assert len(_out(client, "IF-EXT-05")) == 1
    assert client.post("/api/settlement/vouchers/export").status_code == 400  # 새 전표 없음

    cost = client.get("/api/cost/orders").json()[0]
    assert cost["order_no"] == order_no and cost["sales"] == inv["supply_amount"]
    assert 0.3 < cost["cost_rate"] < 1.2 and not cost["freight_estimated"]
    assert {r["key"] for r in cost["rows"]} >= {"material", "CORRUGATE", "CONVERT", "freight"}
    summary = client.get("/api/dashboard/summary").json()
    assert summary["sales"]["invoiced_amount"] == inv["supply_amount"] and summary["shipping"]["shipped"] == 1


def test_quote(client):
    spec = client.get("/api/master/board-specs").json()[0]["code"]
    q = client.post("/api/cost/quote", json={"length_mm": 400, "width_mm": 300, "height_mm": 200,
                                             "board_spec_code": spec, "print_colors": 2, "qty": 5000}).json()
    assert q["blank_w"] == 510 and q["unit_cost"] > 0 and q["suggested_price"] > q["unit_cost"]
    assert any("인쇄" in r["label"] for r in q["rows"])
    assert client.post("/api/cost/quote", json={"length_mm": 1, "width_mm": 1, "height_mm": 1,
                                                "board_spec_code": "NOPE", "qty": 1}).status_code == 400


def test_callback_only_for_callback_interfaces(client):
    r = client.post("/api/if/inbound", json={"if_id": "IF-MES-01", "message_id": "x1", "source": "MES", "payload": {}})
    assert r.status_code == 400
