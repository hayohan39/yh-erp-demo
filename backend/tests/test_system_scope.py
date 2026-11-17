"""시스템 구성도 하위 기능(재고·자재·영업·출하·생산·품질·경영정보·스케쥴링·원가) 흐름 검증."""
from tests import test_production_flow as pf
from tests import test_shipping_settlement as ss
from tests.test_interface import _order_env

GETS = [
    "/api/master/codes", "/api/master/cost-rates", "/api/master/prices", "/api/master/price-history",
    "/api/master/warehouses", "/api/master/sub-materials",
    "/api/inventory/balances?kind=PAPER", "/api/inventory/balances?kind=PRODUCT", "/api/inventory/balances?kind=SUB",
    "/api/inventory/moves", "/api/material/requirements", "/api/material/auto-order", "/api/material/purchase-orders",
    "/api/material/purchases", "/api/material/sub-materials", "/api/material/expenses",
    "/api/sales/customers", "/api/sales/allocation", "/api/sales/ledger", "/api/sales/receivables", "/api/sales/claims",
    "/api/shipping/pallets", "/api/shipping/freight",
    "/api/production/results", "/api/production/work-log", "/api/production/processes", "/api/production/outsource",
    "/api/quality/specs", "/api/quality/certs", "/api/quality/dev-costs", "/api/quality/tooling",
    "/api/mis/summary", "/api/mis/series?metric=sales_amt", "/api/mis/series?metric=defect_rate&period=year",
    "/api/mis/series?metric=prod_qty", "/api/mis/series?metric=paper_amt", "/api/mis/series?metric=freight_amt",
    "/api/mis/series?metric=orders_amt&period=year",
    "/api/scheduling/settings", "/api/scheduling/gantt", "/api/scheduling/dispatch-plan",
    "/api/cost/standard", "/api/cost/analysis",
]


def test_all_screens_respond_after_full_flow(client):
    ss.test_ship_close_invoice_voucher_cost(client)
    for url in GETS:
        r = client.get(url)
        assert r.status_code == 200, (url, r.text)

    # 재고: 생산 입고·출하 출고·원지 투입이 원장에 남는다
    moves = client.get("/api/inventory/moves").json()
    kinds = {(m["kind"], m["move_type"]) for m in moves}
    assert {("PRODUCT", "IN"), ("PRODUCT", "OUT"), ("PAPER", "OUT"), ("SUB", "OUT")} <= kinds
    # 원지 소요(IF-PMS-02 송신분)가 기록된다
    assert client.get("/api/material/requirements").json()[0]["total_kg"] > 0
    # 출하 → 성적서·파렛트
    certs = client.get("/api/quality/certs").json()
    assert certs and certs[0]["verdict"] == "합격"
    pal = client.get("/api/shipping/pallets").json()
    assert any(m["ref_no"] for m in pal["moves"])
    # 조판 타수 증가
    assert any(t["shots"] > 0 for t in client.get("/api/quality/tooling").json())
    # 수금: 발행된 세금계산서 일부 입금
    ar = client.get("/api/sales/receivables").json()["customers"]
    c = next(c for c in ar if c["invoices"])
    inv = c["invoices"][0]
    assert client.post("/api/sales/receipts", json={"customer_code": c["customer_code"], "invoice_no": inv["invoice_no"],
                                                    "amount": inv["total"] + 1000}).status_code == 400
    assert client.post("/api/sales/receipts", json={"customer_code": c["customer_code"], "invoice_no": inv["invoice_no"],
                                                    "amount": inv["total"]}).status_code == 200
    ar2 = {x["customer_code"]: x for x in client.get("/api/sales/receivables").json()["customers"]}
    assert ar2[c["customer_code"]]["balance"] == c["balance"] - inv["total"]
    # 경영정보: 이번 달 매출에 발행분이 더해진다
    s = client.get("/api/mis/series?metric=sales_amt").json()
    assert s["live_current"] > 0
    assert len(s["points"]) == 13 and s["breakdown"]
    # 원가분석
    a = client.get("/api/cost/analysis").json()
    assert a["customers"] and a["total"]["sales"] > 0


def test_auto_order_and_receive(client):
    rec = client.get("/api/material/auto-order").json()
    need = [r for r in rec if r["recommend"] > 0 and r["kind"] == "PAPER"]
    assert need, "시드에서 안전재고 미달 원지가 있어야 함"
    pos = client.post("/api/material/auto-order").json()["purchase_orders"]
    assert len(pos) >= len(need)
    assert all(r["recommend"] == 0 for r in client.get("/api/material/auto-order").json())
    po = next(p for p in client.get("/api/material/purchase-orders").json() if p["kind"] == "PAPER")
    before = client.get("/api/inventory/balances?kind=PAPER").json()
    tot = {r["item_code"]: r["total"] for r in before["rows"]}
    assert client.post(f"/api/material/purchase-orders/{po['po_no']}/receive").status_code == 200
    assert client.post(f"/api/material/purchase-orders/{po['po_no']}/receive").status_code == 400
    after = {r["item_code"]: r["total"] for r in client.get("/api/inventory/balances?kind=PAPER").json()["rows"]}
    assert after[po["item_code"]] == tot[po["item_code"]] + po["qty"]
    pms = [m for m in client.get("/api/if/messages", params={"if_id": "IF-PMS-02"}).json()]
    assert pms and client.get("/api/material/purchases").json()["by_supplier"]


def test_transfer_and_adjust(client):
    bal = client.get("/api/inventory/balances?kind=PAPER").json()
    r = next(r for r in bal["rows"] if r["by_wh"].get("RP1A", 0) > 1000)
    ok = client.post("/api/inventory/transfer", json={"kind": "PAPER", "item_code": r["item_code"], "from_wh": "RP1A",
                                                      "to_wh": "RP2", "qty": 1000}).json()
    assert ok["label"] == "사업장 이동"
    assert client.post("/api/inventory/transfer", json={"kind": "PAPER", "item_code": r["item_code"], "from_wh": "RP1A",
                                                        "to_wh": "FG1", "qty": 1}).status_code == 400
    assert client.post("/api/inventory/transfer", json={"kind": "PAPER", "item_code": r["item_code"], "from_wh": "RP1A",
                                                        "to_wh": "RP1B", "qty": 1e9}).status_code == 400
    adj = client.post("/api/inventory/adjust", json={"kind": "PAPER", "item_code": r["item_code"],
                                                     "warehouse_code": "RP2", "actual_qty": 0}).json()
    assert adj["delta"] < 0
    after = client.get("/api/inventory/balances?kind=PAPER").json()
    row = next(x for x in after["rows"] if x["item_code"] == r["item_code"])
    assert row["by_wh"]["RP2"] == 0


def test_stock_allocation_skips_production(client):
    free = client.get("/api/sales/allocation").json()["free_stock"]
    item = free[0]
    env = _order_env()
    env["payload"]["lines"] = [{"item_code": item["item_code"], "qty": min(item["qty"], 1000)}]
    pf._send(client, "IF-OMS-01", "OMS", env["payload"], "alloc1")
    cand = client.get("/api/sales/allocation").json()["candidates"]
    assert cand[0]["coverable"]
    r = client.post("/api/sales/allocation", json={"order_no": cand[0]["order_no"]})
    assert r.status_code == 200 and r.json()["status"] == "PRODUCED"
    ready = client.get("/api/shipping/ready").json()
    assert ready[0]["total_qty"] == min(item["qty"], 1000)
    plan = client.get("/api/scheduling/dispatch-plan").json()
    assert plan and plan[0]["all_ready"]
    sh = client.post("/api/scheduling/dispatch-plan/execute", json={"order_nos": [cand[0]["order_no"]]}).json()
    assert sh["shipments"]


def test_claims_prices_rates_outsource(client):
    claim = client.post("/api/sales/claims", json={"customer_code": "C001", "claim_type": "인쇄 불량", "qty": 10,
                                                   "description": "번짐"}).json()["claim_no"]
    assert client.post(f"/api/sales/claims/{claim}/step", json={"status": "CLOSED"}).status_code == 400
    assert client.post(f"/api/sales/claims/{claim}/step", json={"status": "CLOSED", "action_text": "재납품",
                                                                "amount": 50000}).json()["status"] == "CLOSED"
    assert client.put("/api/master/prices/item/BX0001", json={"price": 999, "reason": "인상"}).status_code == 200
    assert client.get("/api/master/price-history").json()[0]["new_price"] == 999
    assert client.put("/api/master/cost-rates/std_loss", json={"value": 3}).status_code == 400
    assert client.put("/api/master/cost-rates/rate_PRINT", json={"value": 3000}).status_code == 200
    assert client.post("/api/cost/standard/recalc").json()["changed"] > 0
    oo = client.post("/api/production/outsource", json={"kind": "PURCHASE", "vendor_code": "O003",
                                                        "item_code": "BX0002", "process_name": "완제품 매입",
                                                        "qty": 500, "unit_price": 700}).json()["oo_no"]
    before = sum(r["total"] for r in client.get("/api/inventory/balances?kind=PRODUCT").json()["rows"])
    client.post(f"/api/production/outsource/{oo}/receive")
    after = sum(r["total"] for r in client.get("/api/inventory/balances?kind=PRODUCT").json()["rows"])
    assert after == before + 500
    assert client.post("/api/shipping/pallets/return", json={"partner_code": "C001", "qty": 99999}).status_code == 400
    assert client.post("/api/material/expenses", json={"exp_date": "2026-11-17", "category": "수선비", "dept": "설비팀",
                                                       "amount": 1000000}).status_code == 200
