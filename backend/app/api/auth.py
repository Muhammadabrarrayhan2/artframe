from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.core.config import settings
from app.core.deps import get_current_user, token_to_jti
from app.core.ratelimit import check_rate
from app.models.user import User
from app.models.session import UserSession
from app.schemas.auth import (
    RegisterIn, LoginIn, VerifyOTPIn, ResendOTPIn,
    TokenOut, UserOut, MessageOut,
)
from app.services.otp_service import create_otp_for_user, verify_otp, send_otp_email
from app.services.audit_service import log_action

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=MessageOut, status_code=201)
async def register(payload: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "register", limit=5, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    existing = result.scalars().first()
    if existing:
        if existing.is_verified:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered")
        existing.name = payload.name
        existing.password_hash = hash_password(payload.password)
        await db.commit()
        code = await create_otp_for_user(db, existing.id, "register")
        send_otp_email(existing.email, existing.name, code)
        await log_action(db, "register_resend", existing.id, request, {"email": existing.email})
        return MessageOut(
            message="Verification code sent",
            detail="An existing unverified account was refreshed. Check your inbox (or console in dev).",
        )

    user = User(
        email=payload.email.lower(),
        name=payload.name.strip(),
        password_hash=hash_password(payload.password),
        is_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    code = await create_otp_for_user(db, user.id, "register")
    send_otp_email(user.email, user.name, code)
    await log_action(db, "register", user.id, request, {"email": user.email})

    return MessageOut(
        message="Account created. Please verify your email with the OTP sent.",
        detail=f"Code expires in {settings.OTP_EXPIRE_MINUTES} minutes.",
    )


@router.post("/verify-otp", response_model=TokenOut)
async def verify_otp_endpoint(payload: VerifyOTPIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "verify-otp", limit=10, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    ok, msg = await verify_otp(db, user.id, payload.code.strip(), "register")
    if not ok:
        await log_action(db, "verify_otp_failed", user.id, request, {"reason": msg})
        raise HTTPException(status.HTTP_400_BAD_REQUEST, msg)

    user.is_verified = True
    await db.commit()

    token = create_access_token(user.id)
    jti = token_to_jti(token)
    expires_at = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    db.add(UserSession(
        user_id=user.id,
        token_jti=jti,
        user_agent=request.headers.get("user-agent", "")[:255],
        ip_address=request.client.host if request.client else "",
        expires_at=expires_at,
    ))
    await db.commit()
    await log_action(db, "verify_otp_success", user.id, request)

    return TokenOut(
        access_token=token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/resend-otp", response_model=MessageOut)
async def resend_otp(payload: ResendOTPIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "resend-otp", limit=3, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()
    if user and not user.is_verified:
        code = await create_otp_for_user(db, user.id, "register")
        send_otp_email(user.email, user.name, code)
        await log_action(db, "resend_otp", user.id, request)
    return MessageOut(message="If the account exists and is unverified, a new code has been sent.")


@router.post("/login", response_model=TokenOut)
async def login(payload: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "login", limit=10, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()

    if not user or not verify_password(payload.password, user.password_hash):
        await log_action(db, "login_failed", user.id if user else None, request, {"email": payload.email})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    if not user.is_verified:
        code = await create_otp_for_user(db, user.id, "register")
        send_otp_email(user.email, user.name, code)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Email not verified. A new verification code has been sent.",
        )

    token = create_access_token(user.id)
    jti = token_to_jti(token)
    expires_at = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    db.add(UserSession(
        user_id=user.id,
        token_jti=jti,
        user_agent=request.headers.get("user-agent", "")[:255],
        ip_address=request.client.host if request.client else "",
        expires_at=expires_at,
    ))
    await db.commit()
    await log_action(db, "login_success", user.id, request)

    return TokenOut(
        access_token=token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/logout", response_model=MessageOut)
async def logout(request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    jti = request.state.jti
    await db.execute(update(UserSession).where(UserSession.token_jti == jti).values(revoked=True))
    await db.commit()
    await log_action(db, "logout", user.id, request)
    return MessageOut(message="Logged out. Session invalidated on the server.")


@router.post("/logout-all", response_model=MessageOut)
async def logout_all(request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked == False)  # noqa
        .values(revoked=True)
    )
    await db.commit()
    await log_action(db, "logout_all", user.id, request)
    return MessageOut(message="All active sessions have been revoked.")


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
