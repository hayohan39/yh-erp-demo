"""비밀번호 해시와 로그인 토큰. 외부 라이브러리 없이 표준 라이브러리(hashlib/hmac)만 쓴다."""
import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import engine, get_db
from app.models.auth import AppUser, AuthBase

DEFAULT_ADMIN = ("admin", "admin")
_SECRET = (settings.auth_secret or secrets.token_hex(32)).encode()
_ITER = 120_000


def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), _ITER).hex()
    return f"pbkdf2${_ITER}${salt}${dk}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, it, salt, dk = stored.split("$")
    except ValueError:
        return False
    calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(it)).hex()
    return hmac.compare_digest(calc, dk)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _sign(body: str) -> str:
    return _b64(hmac.new(_SECRET, body.encode(), hashlib.sha256).digest())


def issue_token(user: AppUser) -> str:
    body = _b64(json.dumps({"uid": user.id, "exp": int(time.time()) + settings.auth_token_hours * 3600}).encode())
    return f"{body}.{_sign(body)}"


def _read_token(token: str) -> int | None:
    try:
        body, sig = token.split(".")
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return int(data["uid"]) if data["exp"] > time.time() else None
    except Exception:  # noqa: BLE001
        return None


def init_auth(db: Session) -> None:
    """사용자 테이블을 만들고, 사용자가 하나도 없으면 기본 관리자(admin/admin)를 넣는다."""
    AuthBase.metadata.create_all(engine)
    if not db.scalar(select(AppUser).limit(1)):
        db.add(AppUser(username=DEFAULT_ADMIN[0], password_hash=hash_password(DEFAULT_ADMIN[1]),
                       name="시스템 관리자", department="전산팀", role="ADMIN"))
        db.commit()


def current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> AppUser:
    token = (authorization or "").removeprefix("Bearer ").strip()
    uid = _read_token(token) if token else None
    user = db.get(AppUser, uid) if uid else None
    if not user or not user.active:
        raise HTTPException(401, "로그인이 필요합니다")
    return user


def admin_user(user: AppUser = Depends(current_user)) -> AppUser:
    if user.role != "ADMIN":
        raise HTTPException(403, "관리자만 사용할 수 있습니다")
    return user
