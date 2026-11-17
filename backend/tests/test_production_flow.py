from tests.test_interface import _order_env


def _send(client, if_id, source, payload, mid):
    r = client.post("/api/if/inbound", json={"if_id": if_id, "message_id": mid, "source": source, "payload": payload})
    assert r.status_code == 200, r.text
    return r.json()


def test_order_to_production_flow(client):
    env = _order_env()
    env["payload"]["lines"] = [{"item_code": "BX0001", "qty": 1000}, {"item_code": "BX0002", "qty": 2000}]
    _send(client, **{"if_id": "IF-OMS-01", "source": "OMS", "payload": env["payload"], "mid": "o1"})

    plan = client.post("/api/scheduling/plans").json()
    assert plan["status"] == "DRAFT" and plan["runs"]
    assert plan["trim_rate"] <= plan["manual_trim_rate"]

    conf = client.post(f"/api/scheduling/plans/{plan['plan_no']}/confirm").json()
    assert len(conf["work_orders"]) == 2
    out_ifs = {m["if_id"] for m in client.get("/api/if/messages").json() if m["direction"] == "OUT"}
    assert {"IF-MES-01", "IF-EQ-01", "IF-EXT-03", "IF-PMS-02", "IF-EQ-03"} <= out_ifs
    assert client.get("/api/sales/orders").json()[0]["status"] == "PLANNED"

    wos = client.get("/api/production/work-orders").json()
    n = 0
    for wo in wos:
        qty = wo["qty"]
        _send(client, "IF-PMS-01", "PMS", {"wo_no": wo["wo_no"], "rolls": [
            {"roll_no": "R1", "paper_code": "KA180", "used_kg": 100}]}, f"p{n}")
        for r in wo["routes"]:
            n += 1
            if_id = {"CORRUGATE": "IF-EQ-02", "PRINT": "IF-EQ-06", "CONVERT": "IF-EQ-04"}[r["process"]]
            bad = qty // 10 if r["process"] == "PRINT" else qty // 200  # 인쇄 10% 불량 → 알림
            res = _send(client, if_id, r["equipment_code"], {
                "wo_no": wo["wo_no"], "process": r["process"], "event": "END", "good_qty": qty - bad, "defect_qty": bad,
                "defect_type": "인쇄 번짐", "run_minutes": 30}, f"e{n}")
            assert res["status"] == "PROCESSED", res
            qty -= bad
        assert client.get("/api/sales/orders").json()[0]["status"] == "IN_PROD"
        _send(client, "IF-MES-02", "MES", {"wo_no": wo["wo_no"]}, f"m{n}")

    assert client.get("/api/sales/orders").json()[0]["status"] == "PRODUCED"
    board = {b["equipment_code"]: b for b in client.get("/api/production/board").json()}
    assert len(board["EV01"]["done"]) == 2
    summary = client.get("/api/dashboard/summary").json()
    assert summary["production"]["work_orders_done"] == 2
    assert summary["scheduling"]["saved_amount"] >= 0

    defects = client.get("/api/quality/defects").json()
    printed = [w for w in wos if any(r["process"] == "PRINT" for r in w["routes"])]
    assert len(defects) == len(printed)
    if defects:
        d = defects[0]
        r = client.post(f"/api/quality/defects/{d['defect_no']}/action",
                        json={"cause": "잉크 점도", "action_text": "점도 재조정"}).json()
        assert r["status"] == "CLOSED"

    progress = [m for m in client.get("/api/if/messages", params={"if_id": "IF-OMS-02"}).json()]
    assert len(progress) == 3  # 수주확정, 생산중, 생산완료


def test_cannot_confirm_twice(client):
    client.post("/api/if/inbound", json=_order_env())
    plan = client.post("/api/scheduling/plans").json()
    client.post(f"/api/scheduling/plans/{plan['plan_no']}/confirm")
    assert client.post(f"/api/scheduling/plans/{plan['plan_no']}/confirm").status_code == 400
    assert client.post("/api/scheduling/plans").status_code == 400  # 대기 수주 없음


def test_equipment_start_event_marks_running(client):
    client.post("/api/if/inbound", json=_order_env())
    plan = client.post("/api/scheduling/plans").json()
    wo_no = client.post(f"/api/scheduling/plans/{plan['plan_no']}/confirm").json()["work_orders"][0]
    board = {b["equipment_code"]: b for b in client.get("/api/production/board").json()}
    assert [c["wo_no"] for c in board["CG01"]["wait"]] == [wo_no]
    _send(client, "IF-EQ-02", "골게터 POP", {"event": "START", "wo_no": wo_no, "process": "CORRUGATE"}, "s1")
    board = {b["equipment_code"]: b for b in client.get("/api/production/board").json()}
    assert [c["wo_no"] for c in board["CG01"]["run"]] == [wo_no]
    assert client.get("/api/sales/orders").json()[0]["status"] == "IN_PROD"
    fac = client.get("/api/monitor/factory").json()
    cg = next(m for m in fac["machines"] if m["code"] == "CG01")
    assert cg["status"] == "RUN" and cg["current"]["wo_no"] == wo_no and cg["current"]["expected_minutes"] > 0
    assert len(fac["papers"]) == 8 and fac["work_orders"]["in_prod"] == 1
    ifs = {r["if_id"]: r for r in client.get("/api/monitor/interfaces").json()}
    assert len(ifs) == 18 and ifs["IF-OMS-01"]["total"] == 1 and ifs["IF-EQ-02"]["total"] == 1


def test_factory_after_full_flow(client):
    test_order_to_production_flow(client)
    fac = client.get("/api/monitor/factory").json()
    assert all(m["status"] == "IDLE" for m in fac["machines"])
    assert fac["paper_used_kg"] > 0 and fac["products"]["total_qty"] > 0
    assert any(p["stock_kg"] < p["opening_kg"] for p in fac["papers"])


def test_facility_monitor(client):
    d = client.get("/api/monitor/facility").json()
    codes = {f["code"] for f in d["facilities"]}
    assert {"BOILER", "STARCH", "AIR", "ELEC", "WASTE", "WATER", "ROLL_WH", "FG_WH", "SAFETY"} == codes
    assert d["load"] == 0 and d["energy"]["power_kw"] > 0
    for f in d["facilities"]:
        assert f["status"] in ("OK", "WARN") and f["metrics"]
