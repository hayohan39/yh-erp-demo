"""로그인과 사용자 관리(개인 설정 화면)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models._types import now
from app.models.auth import AppUser
from app.services.auth import admin_user, current_user, hash_password, issue_token, verify_password

router = APIRouter(prefix="/api", tags=["사용자"])


def _out(u: AppUser) -> dict:
    return {"id": u.id, "username": u.username, "name": u.name, "department": u.department, "role": u.role,
            "active": u.active, "created_at": u.created_at, "last_login_at": u.last_login_at}


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(AppUser).where(AppUser.username == body.username.strip()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다")
    if not user.active:
        raise HTTPException(403, "사용이 중지된 계정입니다. 관리자에게 문의하세요")
    user.last_login_at = now()
    db.commit()
    return {"token": issue_token(user), "user": _out(user)}


@router.get("/auth/me")
def me(user: AppUser = Depends(current_user)):
    return _out(user)


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=50)


@router.put("/auth/me")
def update_me(body: ProfileIn, user: AppUser = Depends(current_user), db: Session = Depends(get_db)):
    u = db.get(AppUser, user.id)
    u.name, u.department = body.name.strip(), (body.department or "").strip() or None
    db.commit()
    return _out(u)


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=4, max_length=100)


@router.post("/auth/password")
def change_password(body: PasswordIn, user: AppUser = Depends(current_user), db: Session = Depends(get_db)):
    u = db.get(AppUser, user.id)
    if not verify_password(body.current_password, u.password_hash):
        raise HTTPException(400, "현재 비밀번호가 올바르지 않습니다")
    u.password_hash = hash_password(body.new_password)
    db.commit()
    return {"status": "ok"}


# ── 관리자: 사용자 등록·관리 ──

@router.get("/users")
def list_users(_: AppUser = Depends(admin_user), db: Session = Depends(get_db)):
    return [_out(u) for u in db.scalars(select(AppUser).order_by(AppUser.id))]


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=4, max_length=100)
    name: str = Field(min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=50)
    role: str = Field(default="USER", pattern="^(ADMIN|USER)$")


@router.post("/users")
def create_user(body: UserIn, _: AppUser = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(AppUser).where(func.lower(AppUser.username) == body.username.lower())):
        raise HTTPException(409, "이미 사용 중인 아이디입니다")
    u = AppUser(username=body.username, password_hash=hash_password(body.password), name=body.name.strip(),
                department=(body.department or "").strip() or None, role=body.role)
    db.add(u)
    db.commit()
    return _out(u)


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=50)
    role: str | None = Field(default=None, pattern="^(ADMIN|USER)$")
    active: bool | None = None
    password: str | None = Field(default=None, min_length=4, max_length=100)


def _other_admins(db: Session, uid: int) -> int:
    return db.scalar(select(func.count()).select_from(AppUser).where(
        AppUser.role == "ADMIN", AppUser.active.is_(True), AppUser.id != uid)) or 0


@router.patch("/users/{uid}")
def update_user(uid: int, body: UserPatch, me_: AppUser = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(AppUser, uid)
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    losing_admin = (body.role == "USER" or body.active is False) and u.role == "ADMIN"
    if losing_admin and _other_admins(db, uid) == 0:
        raise HTTPException(400, "관리자가 최소 1명은 있어야 합니다")
    if uid == me_.id and body.active is False:
        raise HTTPException(400, "본인 계정은 사용 중지할 수 없습니다")
    if body.name is not None:
        u.name = body.name.strip()
    if body.department is not None:
        u.department = body.department.strip() or None
    if body.role is not None:
        u.role = body.role
    if body.active is not None:
        u.active = body.active
    if body.password:
        u.password_hash = hash_password(body.password)
    db.commit()
    return _out(u)


@router.delete("/users/{uid}")
def delete_user(uid: int, me_: AppUser = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(AppUser, uid)
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if uid == me_.id:
        raise HTTPException(400, "본인 계정은 삭제할 수 없습니다")
    if u.role == "ADMIN" and _other_admins(db, uid) == 0:
        raise HTTPException(400, "관리자가 최소 1명은 있어야 합니다")
    db.delete(u)
    db.commit()
    return {"status": "deleted"}
