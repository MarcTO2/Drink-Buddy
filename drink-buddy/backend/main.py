"""
Drink Buddy - FastAPI backend (single file).

Platonic group bar-hopping in Westlands, Nairobi.
Run:  uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
import base64
import hashlib
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Field, Session, SQLModel, create_engine, select

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'drinkbuddy.db')}")

MPESA_ENV = os.getenv("MPESA_ENV", "sandbox")
MPESA_BASE = "https://sandbox.safaricom.co.ke" if MPESA_ENV == "sandbox" else "https://api.safaricom.co.ke"
MPESA_CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY", "")
MPESA_CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET", "")
MPESA_SHORTCODE = os.getenv("MPESA_SHORTCODE", "174379")
MPESA_PASSKEY = os.getenv("MPESA_PASSKEY", "")
MPESA_CALLBACK_URL = os.getenv("MPESA_CALLBACK_URL", "https://example.com/mpesa/callback")

CHECKIN_HOURS = 4
SQUAD_MIN, SQUAD_MAX = 3, 8
DEFAULT_TICKET_KES = 500

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)


def utcnow() -> datetime:
    """Timezone-aware UTC now (SQLModel stores/returns UTC)."""
    return datetime.now(timezone.utc)


def as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    return as_utc(dt).isoformat().replace("+00:00", "Z") if dt else None


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    phone: str = Field(index=True, unique=True)
    password_hash: str
    token: str = Field(index=True, unique=True)
    is_18_plus: bool
    odpc_consent: bool
    consented_at: datetime
    created_at: datetime = Field(default_factory=utcnow)


class Venue(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    area: str = "Westlands"
    address: str
    latitude: float
    longitude: float
    description: str = ""
    vetted: bool = True


class Squad(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str = ""
    venue_id: int = Field(foreign_key="venue.id", index=True)
    creator_id: int = Field(foreign_key="user.id")
    meet_at: datetime = Field(index=True)
    max_size: int = SQUAD_MAX
    ticket_kes: int = DEFAULT_TICKET_KES
    created_at: datetime = Field(default_factory=utcnow)


class SquadMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    squad_id: int = Field(foreign_key="squad.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    status: str = "pending"  # pending -> approved (after M-Pesa payment succeeds)
    joined_at: datetime = Field(default_factory=utcnow)
    approved_at: Optional[datetime] = None


class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    squad_id: int = Field(foreign_key="squad.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    body: str
    is_system: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class CheckIn(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    venue_id: int = Field(foreign_key="venue.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime = Field(index=True)


class Report(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    reporter_id: int = Field(foreign_key="user.id")
    reported_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    squad_id: Optional[int] = Field(default=None, foreign_key="squad.id")
    venue_id: Optional[int] = Field(default=None, foreign_key="venue.id")
    reason: str
    details: str = ""
    status: str = "open"
    created_at: datetime = Field(default_factory=utcnow)


class Payment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    squad_id: int = Field(foreign_key="squad.id", index=True)
    phone: str
    amount: int
    merchant_request_id: str = ""
    checkout_request_id: str = Field(index=True, unique=True)
    status: str = "pending"  # pending | success | failed | cancelled
    result_code: Optional[str] = None
    result_desc: str = ""
    mpesa_receipt: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


# --------------------------------------------------------------------------
# Seed data
# --------------------------------------------------------------------------
SEED_VENUES = [
    dict(name="The Alchemist", address="Parklands Rd, Westlands", latitude=-1.2622, longitude=36.8079,
         description="Open-air courtyard bar with food trucks, DJs and a big crowd."),
    dict(name="Bao Box", address="Westlands", latitude=-1.2655, longitude=36.8051,
         description="Bao buns, board games and craft drinks - easy first-meet spot."),
    dict(name="Shelter", address="Westlands", latitude=-1.2641, longitude=36.8038,
         description="Late-night lounge and dance floor."),
    dict(name="Mercury Lounge", address="Westlands", latitude=-1.2598, longitude=36.7905,
         description="Cocktail lounge, calmer vibe for conversation."),
]


def seed(session: Session) -> None:
    for v in SEED_VENUES:
        if not session.exec(select(Venue).where(Venue.name == v["name"])).first():
            session.add(Venue(**v))
    session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        seed(s)
    yield


app = FastAPI(title="Drink Buddy API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------------------
# Helpers / dependencies
# --------------------------------------------------------------------------
def get_session():
    with Session(engine) as session:
        yield session


def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, _ = stored.split("$", 1)
    return secrets.compare_digest(hash_password(password, salt), stored)


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif len(digits) == 9 and digits[0] in "17":
        digits = "254" + digits
    if not re.fullmatch(r"254[17]\d{8}", digits):
        raise HTTPException(400, "Phone must be a Kenyan mobile number like 2547XXXXXXXX")
    return digits


def current_user(authorization: Optional[str] = Header(None), session: Session = Depends(get_session)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    user = session.exec(select(User).where(User.token == token)).first()
    if not user:
        raise HTTPException(401, "Invalid or expired session - please log in again")
    return user


def user_out(u: User) -> dict:
    return {"id": u.id, "name": u.name, "phone": u.phone, "is_18_plus": u.is_18_plus,
            "odpc_consent": u.odpc_consent, "created_at": iso(u.created_at)}


def get_membership(session: Session, squad_id: int, user_id: int) -> Optional[SquadMember]:
    return session.exec(
        select(SquadMember).where(SquadMember.squad_id == squad_id, SquadMember.user_id == user_id)
    ).first()


def approved_count(session: Session, squad_id: int) -> int:
    return session.exec(
        select(func.count()).select_from(SquadMember)
        .where(SquadMember.squad_id == squad_id, SquadMember.status == "approved")
    ).one()


def squad_out(session: Session, squad: Squad, user: Optional[User]) -> dict:
    venue = session.get(Venue, squad.venue_id)
    approved = approved_count(session, squad.id)
    member = get_membership(session, squad.id, user.id) if user else None
    if approved >= squad.max_size:
        status = "full"
    elif approved >= SQUAD_MIN:
        status = "confirmed"
    else:
        status = "forming"
    return {
        "id": squad.id,
        "name": squad.name,
        "description": squad.description,
        "venue": {"id": venue.id, "name": venue.name, "address": venue.address} if venue else None,
        "meet_at": iso(squad.meet_at),
        "max_size": squad.max_size,
        "min_size": SQUAD_MIN,
        "approved_count": approved,
        "spots_left": max(squad.max_size - approved, 0),
        "ticket_kes": squad.ticket_kes,
        "status": status,
        "my_status": member.status if member else None,
        "is_creator": bool(user and squad.creator_id == user.id),
    }


def require_approved(session: Session, squad_id: int, user: User) -> SquadMember:
    member = get_membership(session, squad_id, user.id)
    if not member or member.status != "approved":
        raise HTTPException(403, "Group chat unlocks once your spot is confirmed via M-Pesa")
    return member


def add_system_message(session: Session, squad_id: int, body: str) -> None:
    session.add(Message(squad_id=squad_id, body=body, is_system=True))


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------
class SignupIn(BaseModel):
    name: str
    phone: str
    password: str
    is_18_plus: bool
    odpc_consent: bool


class LoginIn(BaseModel):
    phone: str
    password: str


class SquadIn(BaseModel):
    name: str
    venue_id: int
    meet_at: datetime
    max_size: int = SQUAD_MAX
    ticket_kes: int = DEFAULT_TICKET_KES
    description: str = ""


class MessageIn(BaseModel):
    body: str


class CheckInIn(BaseModel):
    venue_id: int


class ReportIn(BaseModel):
    reason: str
    details: str = ""
    reported_user_id: Optional[int] = None
    squad_id: Optional[int] = None
    venue_id: Optional[int] = None


class StkPushIn(BaseModel):
    squad_id: int
    phone: str


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
@app.get("/")
def health():
    return {"app": "Drink Buddy", "status": "ok", "mpesa_env": MPESA_ENV,
            "mpesa_configured": bool(MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET and MPESA_PASSKEY)}


@app.post("/auth/signup")
def signup(data: SignupIn, session: Session = Depends(get_session)):
    if not data.is_18_plus:
        raise HTTPException(400, "You must confirm you are 18 or older")
    if not data.odpc_consent:
        raise HTTPException(400, "Location/data consent (Kenya Data Protection Act / ODPC) is required")
    name = data.name.strip()
    if len(name) < 2:
        raise HTTPException(400, "Name is too short")
    if len(data.password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    phone = normalize_phone(data.phone)
    if session.exec(select(User).where(User.phone == phone)).first():
        raise HTTPException(409, "Phone already registered - log in instead")
    now = utcnow()
    user = User(name=name, phone=phone, password_hash=hash_password(data.password),
                token=secrets.token_urlsafe(32), is_18_plus=True, odpc_consent=True, consented_at=now)
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"token": user.token, "user": user_out(user)}


@app.post("/auth/login")
def login(data: LoginIn, session: Session = Depends(get_session)):
    phone = normalize_phone(data.phone)
    user = session.exec(select(User).where(User.phone == phone)).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Wrong phone or password")
    user.token = secrets.token_urlsafe(32)
    session.add(user)
    session.commit()
    return {"token": user.token, "user": user_out(user)}


@app.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


# --------------------------------------------------------------------------
# Venues & check-ins (4h expiry, filtered in SQL)
# --------------------------------------------------------------------------
@app.get("/venues")
def list_venues(session: Session = Depends(get_session)):
    venues = session.exec(select(Venue).where(Venue.vetted == True).order_by(Venue.name)).all()  # noqa: E712
    counts = dict(session.exec(
        select(CheckIn.venue_id, func.count(CheckIn.id))
        .where(CheckIn.expires_at > func.now())
        .group_by(CheckIn.venue_id)
    ).all())
    return [{**v.model_dump(), "active_checkins": counts.get(v.id, 0)} for v in venues]


@app.post("/checkins")
def create_checkin(data: CheckInIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    venue = session.get(Venue, data.venue_id)
    if not venue or not venue.vetted:
        raise HTTPException(404, "Venue not found")
    if not user.odpc_consent:
        raise HTTPException(403, "Location consent required for check-ins")
    now = utcnow()
    for old in session.exec(select(CheckIn).where(CheckIn.user_id == user.id, CheckIn.expires_at > func.now())).all():
        old.expires_at = now - timedelta(seconds=2)
        session.add(old)
    checkin = CheckIn(user_id=user.id, venue_id=venue.id, created_at=now,
                      expires_at=now + timedelta(hours=CHECKIN_HOURS))
    session.add(checkin)
    session.commit()
    session.refresh(checkin)
    return {"id": checkin.id, "venue": {"id": venue.id, "name": venue.name},
            "created_at": iso(checkin.created_at), "expires_at": iso(checkin.expires_at)}


@app.get("/checkins/me")
def my_checkin(user: User = Depends(current_user), session: Session = Depends(get_session)):
    c = session.exec(
        select(CheckIn).where(CheckIn.user_id == user.id, CheckIn.expires_at > func.now())
        .order_by(CheckIn.created_at.desc())
    ).first()
    if not c:
        return None
    venue = session.get(Venue, c.venue_id)
    return {"id": c.id, "venue": {"id": venue.id, "name": venue.name},
            "created_at": iso(c.created_at), "expires_at": iso(c.expires_at)}


@app.delete("/checkins/me")
def checkout(user: User = Depends(current_user), session: Session = Depends(get_session)):
    now = utcnow()
    active = session.exec(select(CheckIn).where(CheckIn.user_id == user.id, CheckIn.expires_at > func.now())).all()
    for c in active:
        c.expires_at = now - timedelta(seconds=2)
        session.add(c)
    session.commit()
    return {"checked_out": len(active)}


# --------------------------------------------------------------------------
# Squads
# --------------------------------------------------------------------------
@app.get("/squads")
def list_squads(user: User = Depends(current_user), session: Session = Depends(get_session)):
    cutoff = utcnow() - timedelta(hours=CHECKIN_HOURS)
    squads = session.exec(select(Squad).where(Squad.meet_at > cutoff).order_by(Squad.meet_at)).all()
    return [squad_out(session, s, user) for s in squads]


@app.get("/squads/mine")
def my_squads(user: User = Depends(current_user), session: Session = Depends(get_session)):
    squads = session.exec(
        select(Squad).join(SquadMember, SquadMember.squad_id == Squad.id)
        .where(SquadMember.user_id == user.id).order_by(Squad.meet_at.desc())
    ).all()
    return [squad_out(session, s, user) for s in squads]


@app.post("/squads")
def create_squad(data: SquadIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    if not (SQUAD_MIN <= data.max_size <= SQUAD_MAX):
        raise HTTPException(400, f"Squad size must be between {SQUAD_MIN} and {SQUAD_MAX}")
    if data.ticket_kes < 1 or data.ticket_kes > 10_000:
        raise HTTPException(400, "Ticket must be between 1 and 10,000 KES")
    name = data.name.strip()
    if len(name) < 3:
        raise HTTPException(400, "Squad name is too short")
    venue = session.get(Venue, data.venue_id)
    if not venue or not venue.vetted:
        raise HTTPException(400, "Pick one of the vetted Westlands venues")
    meet_at = as_utc(data.meet_at)
    if meet_at < utcnow() - timedelta(minutes=5):
        raise HTTPException(400, "Meet time must be in the future")
    squad = Squad(name=name, description=data.description.strip(), venue_id=venue.id, creator_id=user.id,
                  meet_at=meet_at, max_size=data.max_size, ticket_kes=data.ticket_kes)
    session.add(squad)
    session.commit()
    session.refresh(squad)
    session.add(SquadMember(squad_id=squad.id, user_id=user.id))
    add_system_message(session, squad.id, f"Squad created by {user.name} at {venue.name}. Pay the buy-in to lock your spot.")
    session.commit()
    return squad_out(session, squad, user)


@app.get("/squads/{squad_id}")
def get_squad(squad_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    squad = session.get(Squad, squad_id)
    if not squad:
        raise HTTPException(404, "Squad not found")
    out = squad_out(session, squad, user)
    member = get_membership(session, squad_id, user.id)
    if member and member.status == "approved":
        rows = session.exec(
            select(User).join(SquadMember, SquadMember.user_id == User.id)
            .where(SquadMember.squad_id == squad_id, SquadMember.status == "approved")
        ).all()
        out["members"] = [{"user_id": u.id, "name": u.name.split(" ")[0]} for u in rows]
    else:
        out["members"] = []
    return out


@app.post("/squads/{squad_id}/join")
def join_squad(squad_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    squad = session.get(Squad, squad_id)
    if not squad:
        raise HTTPException(404, "Squad not found")
    member = get_membership(session, squad_id, user.id)
    if member:
        return {"squad": squad_out(session, squad, user), "message": f"You're already {member.status} in this squad"}
    if approved_count(session, squad_id) >= squad.max_size:
        raise HTTPException(409, "Squad is full")
    session.add(SquadMember(squad_id=squad_id, user_id=user.id))
    session.commit()
    return {"squad": squad_out(session, squad, user), "message": "Joined - pay the buy-in via M-Pesa to confirm your spot"}


@app.get("/squads/{squad_id}/messages")
def get_messages(squad_id: int, after_id: int = 0, user: User = Depends(current_user),
                 session: Session = Depends(get_session)):
    require_approved(session, squad_id, user)
    rows = session.exec(
        select(Message, User).join(User, Message.user_id == User.id, isouter=True)
        .where(Message.squad_id == squad_id, Message.id > after_id)
        .order_by(Message.id).limit(200)
    ).all()
    return [{"id": m.id, "body": m.body, "is_system": m.is_system, "user_id": m.user_id,
             "sender": (u.name.split(" ")[0] if u else "Drink Buddy"), "mine": m.user_id == user.id,
             "created_at": iso(m.created_at)} for m, u in rows]


@app.post("/squads/{squad_id}/messages")
def post_message(squad_id: int, data: MessageIn, user: User = Depends(current_user),
                 session: Session = Depends(get_session)):
    require_approved(session, squad_id, user)
    body = data.body.strip()
    if not body:
        raise HTTPException(400, "Message is empty")
    if len(body) > 1000:
        raise HTTPException(400, "Message too long (max 1000 chars)")
    msg = Message(squad_id=squad_id, user_id=user.id, body=body)
    session.add(msg)
    session.commit()
    session.refresh(msg)
    return {"id": msg.id, "body": msg.body, "is_system": False, "user_id": user.id,
            "sender": user.name.split(" ")[0], "mine": True, "created_at": iso(msg.created_at)}


# --------------------------------------------------------------------------
# Safety reports
# --------------------------------------------------------------------------
@app.post("/reports")
def create_report(data: ReportIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    if not data.reason.strip():
        raise HTTPException(400, "Pick a reason")
    if data.reported_user_id and not session.get(User, data.reported_user_id):
        raise HTTPException(404, "Reported user not found")
    report = Report(reporter_id=user.id, reported_user_id=data.reported_user_id, squad_id=data.squad_id,
                    venue_id=data.venue_id, reason=data.reason.strip(), details=data.details.strip())
    session.add(report)
    session.commit()
    session.refresh(report)
    return {"id": report.id, "status": report.status,
            "message": "Report received. Our safety team reviews every report. "
                       "If you are in immediate danger call 999 or 112."}


# --------------------------------------------------------------------------
# M-Pesa Daraja (STK Push)
# --------------------------------------------------------------------------
_token_cache = {"token": None, "expires": 0.0}


async def daraja_token() -> str:
    if not (MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET and MPESA_PASSKEY):
        raise HTTPException(500, "M-Pesa not configured: set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET "
                                 "and MPESA_PASSKEY in backend/.env")
    if _token_cache["token"] and _token_cache["expires"] > time.time() + 60:
        return _token_cache["token"]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{MPESA_BASE}/oauth/v1/generate", params={"grant_type": "client_credentials"},
                             auth=(MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET))
    if r.status_code != 200:
        raise HTTPException(502, f"Daraja auth failed ({r.status_code}): {r.text[:300]}")
    data = r.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires"] = time.time() + int(data.get("expires_in", 3599))
    return _token_cache["token"]


def stk_password() -> tuple:
    timestamp = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y%m%d%H%M%S")  # EAT
    password = base64.b64encode(f"{MPESA_SHORTCODE}{MPESA_PASSKEY}{timestamp}".encode()).decode()
    return password, timestamp


def finalize_payment(session: Session, payment: Payment, result_code, result_desc: str,
                     receipt: Optional[str] = None) -> None:
    """Idempotently apply a final M-Pesa result. Success approves the squad member."""
    if payment.status != "pending":
        return
    code = str(result_code)
    payment.result_code = code
    payment.result_desc = result_desc or ""
    payment.updated_at = utcnow()
    if code == "0":
        payment.status = "success"
        payment.mpesa_receipt = receipt
        member = get_membership(session, payment.squad_id, payment.user_id)
        if not member:
            member = SquadMember(squad_id=payment.squad_id, user_id=payment.user_id)
        if member.status != "approved":
            member.status = "approved"
            member.approved_at = utcnow()
            session.add(member)
            user = session.get(User, payment.user_id)
            add_system_message(session, payment.squad_id, f"{user.name.split(' ')[0]} is confirmed in the squad 🎉")
    else:
        payment.status = "cancelled" if code == "1032" else "failed"
    session.add(payment)
    session.commit()


def payment_out(p: Payment) -> dict:
    return {"checkout_request_id": p.checkout_request_id, "squad_id": p.squad_id, "amount": p.amount,
            "phone": p.phone, "status": p.status, "result_code": p.result_code,
            "result_desc": p.result_desc, "mpesa_receipt": p.mpesa_receipt, "updated_at": iso(p.updated_at)}


@app.post("/mpesa/stkpush")
async def stk_push(data: StkPushIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    squad = session.get(Squad, data.squad_id)
    if not squad:
        raise HTTPException(404, "Squad not found")
    phone = normalize_phone(data.phone)
    member = get_membership(session, squad.id, user.id)
    if member and member.status == "approved":
        raise HTTPException(400, "You've already paid - your spot is confirmed")
    if approved_count(session, squad.id) >= squad.max_size:
        raise HTTPException(409, "Squad is full")
    if not member:
        session.add(SquadMember(squad_id=squad.id, user_id=user.id))
        session.commit()

    token = await daraja_token()
    password, timestamp = stk_password()
    payload = {
        "BusinessShortCode": MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(squad.ticket_kes),
        "PartyA": phone,
        "PartyB": MPESA_SHORTCODE,
        "PhoneNumber": phone,
        "CallBackURL": MPESA_CALLBACK_URL,
        "AccountReference": f"SQUAD{squad.id}"[:12],
        "TransactionDesc": "Drink Buddy squad",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{MPESA_BASE}/mpesa/stkpush/v1/processrequest", json=payload,
                              headers={"Authorization": f"Bearer {token}"})
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text}
    if r.status_code != 200 or str(body.get("ResponseCode")) != "0":
        raise HTTPException(502, f"STK push failed: {body.get('errorMessage') or body.get('ResponseDescription') or body}")

    payment = Payment(user_id=user.id, squad_id=squad.id, phone=phone, amount=int(squad.ticket_kes),
                      merchant_request_id=body.get("MerchantRequestID", ""),
                      checkout_request_id=body["CheckoutRequestID"])
    session.add(payment)
    session.commit()
    return {"checkout_request_id": payment.checkout_request_id,
            "customer_message": body.get("CustomerMessage", "Check your phone and enter your M-Pesa PIN"),
            "amount": payment.amount, "status": payment.status}


@app.post("/mpesa/callback")
async def mpesa_callback(request: Request, session: Session = Depends(get_session)):
    """Daraja posts the final STK result here (needs a public HTTPS URL, e.g. ngrok)."""
    try:
        data = await request.json()
        cb = data["Body"]["stkCallback"]
    except Exception:
        return {"ResultCode": 1, "ResultDesc": "Malformed callback"}
    payment = session.exec(select(Payment).where(Payment.checkout_request_id == cb.get("CheckoutRequestID"))).first()
    if payment:
        items = {i.get("Name"): i.get("Value") for i in cb.get("CallbackMetadata", {}).get("Item", [])}
        finalize_payment(session, payment, cb.get("ResultCode"), cb.get("ResultDesc", ""),
                         str(items["MpesaReceiptNumber"]) if items.get("MpesaReceiptNumber") else None)
    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@app.get("/mpesa/status/{checkout_request_id}")
async def mpesa_status(checkout_request_id: str, user: User = Depends(current_user),
                       session: Session = Depends(get_session)):
    """Clients poll this. If the callback hasn't arrived yet, ask Daraja directly (STK Query)."""
    payment = session.exec(select(Payment).where(Payment.checkout_request_id == checkout_request_id)).first()
    if not payment or payment.user_id != user.id:
        raise HTTPException(404, "Payment not found")
    if payment.status == "pending" and utcnow() - as_utc(payment.created_at) > timedelta(seconds=8):
        try:
            token = await daraja_token()
            password, timestamp = stk_password()
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(f"{MPESA_BASE}/mpesa/stkpushquery/v1/query",
                                      json={"BusinessShortCode": MPESA_SHORTCODE, "Password": password,
                                            "Timestamp": timestamp, "CheckoutRequestID": checkout_request_id},
                                      headers={"Authorization": f"Bearer {token}"})
            q = r.json()
            if "ResultCode" in q:
                finalize_payment(session, payment, q["ResultCode"], q.get("ResultDesc", ""))
        except (httpx.HTTPError, ValueError, HTTPException):
            pass  # still processing / rate-limited: client keeps polling
    session.refresh(payment)
    return payment_out(payment)
