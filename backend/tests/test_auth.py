def _login(client, u="admin", p="admin1234"):
    r = client.post("/api/auth/login", json={"username": u, "password": p})
    return r


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_default_admin_login_and_me(client):
    r = _login(client)
    assert r.status_code == 200
    tok = r.json()["token"]
    me = client.get("/api/auth/me", headers=_h(tok)).json()
    assert me["username"] == "admin" and me["role"] == "ADMIN"
    assert _login(client, p="wrong").status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_admin_registers_user_and_user_survives_reset(client):
    tok = _login(client).json()["token"]
    r = client.post("/api/users", headers=_h(tok),
                    json={"username": "kim", "password": "pw1234", "name": "김영업", "department": "영업팀"})
    assert r.status_code == 200, r.text
    assert client.post("/api/users", headers=_h(tok),
                       json={"username": "KIM", "password": "pw1234", "name": "중복"}).status_code == 409
    client.post("/api/admin/reset")  # 데모 초기화에도 계정은 남는다
    r = _login(client, "kim", "pw1234")
    assert r.status_code == 200
    utok = r.json()["token"]
    # 일반 사용자는 사용자 관리 불가
    assert client.get("/api/users", headers=_h(utok)).status_code == 403
    # 본인 비밀번호 변경
    assert client.post("/api/auth/password", headers=_h(utok),
                       json={"current_password": "pw1234", "new_password": "new5678"}).status_code == 200
    assert _login(client, "kim", "new5678").status_code == 200
    # 사용 중지 → 로그인 불가, 삭제
    uid = r.json()["user"]["id"]
    assert client.patch(f"/api/users/{uid}", headers=_h(tok), json={"active": False}).status_code == 200
    assert _login(client, "kim", "new5678").status_code == 403
    assert client.delete(f"/api/users/{uid}", headers=_h(tok)).status_code == 200


def test_last_admin_protected(client):
    tok = _login(client).json()["token"]
    me = client.get("/api/auth/me", headers=_h(tok)).json()
    assert client.delete(f"/api/users/{me['id']}", headers=_h(tok)).status_code == 400
    assert client.patch(f"/api/users/{me['id']}", headers=_h(tok), json={"role": "USER"}).status_code == 400
