from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, token_to_jti
from app.core.ratelimit import check_rate
from app.core.security import create_access_token, hash_password, verify_password
from app.models.session import UserSession
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordIn,
    ForgotPasswordVerifyIn,
    LoginIn,
    MessageOut,
    OTPChallengeOut,
    RegisterIn,
    ResendOTPIn,
    TokenOut,
    UserOut,
    VerifyOTPIn,
)
from app.services.audit_service import log_action
from app.services.otp_service import check_otp, create_otp_for_user, send_otp_email, verify_otp

router = APIRouter(prefix="/auth", tags=["auth"])


async def create_session_token(user: User, request: Request, db: AsyncSession) -> TokenOut:
    token = create_access_token(user.id)
    jti = token_to_jti(token)
    expires_at = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    db.add(
        UserSession(
            user_id=user.id,
            token_jti=jti,
            user_agent=request.headers.get("user-agent", "")[:255],
            ip_address=request.client.host if request.client else "",
            expires_at=expires_at,
        )
    )
    await db.commit()
    return TokenOut(
        access_token=token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


async def issue_otp_challenge(
    db: AsyncSession,
    user: User,
    purpose: str,
    base_message: str,
) -> OTPChallengeOut:
    code = await create_otp_for_user(db, user.id, purpose)
    delivery_mode = send_otp_email(user.email, user.name, code)
    detail = "Verification code is shown directly in the web popup."
    if delivery_mode not in {"console", "console_fallback"}:
        detail = f"Verification code also sent via {delivery_mode}."
    return OTPChallengeOut(
        message=base_message,
        email=user.email,
        purpose=purpose,
        otp_expires_minutes=settings.OTP_EXPIRE_MINUTES,
        dev_code=code,
        detail=detail,
    )


@router.post("/register", response_model=OTPChallengeOut, status_code=201)
async def register(payload: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "register", limit=5, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    existing = result.scalars().first()
    if existing:
        if existing.is_verified:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered")
        if not existing.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")
        existing.name = payload.name.strip()
        existing.password_hash = hash_password(payload.password)
        existing.is_verified = False
        await db.commit()
        await log_action(db, "register_existing", existing.id, request, {"email": existing.email})
        return await issue_otp_challenge(
            db,
            existing,
            "register",
            "Registration draft saved. Enter the popup code to finish creating your account.",
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

    await log_action(db, "register", user.id, request, {"email": user.email})
    return await issue_otp_challenge(
        db,
        user,
        "register",
        "Registration started. Enter the popup code to activate your account.",
    )


@router.post("/verify-otp", response_model=TokenOut)
async def verify_otp_endpoint(payload: VerifyOTPIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "verify-otp", limit=10, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    ok, msg = await verify_otp(db, user.id, payload.code.strip(), "register")
    if not ok:
        await log_action(db, "verify_otp_failed", user.id, request, {"reason": msg})
        raise HTTPException(status.HTTP_400_BAD_REQUEST, msg)

    user.is_verified = True
    await db.commit()
    await log_action(db, "verify_otp_success", user.id, request)
    return await create_session_token(user, request, db)


@router.post("/resend-otp", response_model=OTPChallengeOut)
async def resend_otp(payload: ResendOTPIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "resend-otp", limit=10, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if user.is_verified:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Account is already verified")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    challenge = await issue_otp_challenge(
        db,
        user,
        "register",
        "A new popup code is ready for registration verification.",
    )
    await log_action(db, "resend_otp", user.id, request, {"email": user.email})
    return challenge


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
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please complete verification before signing in")

    await log_action(db, "login_success", user.id, request)
    return await create_session_token(user, request, db)


@router.post("/forgot-password/request", response_model=OTPChallengeOut)
async def request_forgot_password_otp(
    payload: ResendOTPIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    check_rate(request, "forgot-password-request", limit=10, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    challenge = await issue_otp_challenge(
        db,
        user,
        "reset",
        "Reset code generated. Enter the popup code to save your new password.",
    )
    await log_action(db, "forgot_password_request", user.id, request, {"email": user.email})
    return challenge


@router.post("/forgot-password/verify", response_model=MessageOut)
async def verify_forgot_password_otp(
    payload: ForgotPasswordVerifyIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    check_rate(request, "forgot-password-verify", limit=10, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    ok, msg = await check_otp(db, user.id, payload.code.strip(), "reset", consume=False)
    if not ok:
        await log_action(db, "forgot_password_precheck_failed", user.id, request, {"reason": msg})
        raise HTTPException(status.HTTP_400_BAD_REQUEST, msg)

    await log_action(db, "forgot_password_precheck_success", user.id, request, {"email": user.email})
    return MessageOut(message="Identity verified. You can now set a new password.")


@router.post("/forgot-password", response_model=MessageOut)
async def forgot_password(payload: ForgotPasswordIn, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate(request, "forgot-password", limit=10, window_seconds=60)

    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    ok, msg = await verify_otp(db, user.id, payload.code.strip(), "reset")
    if not ok:
        await log_action(db, "forgot_password_verify_failed", user.id, request, {"reason": msg})
        raise HTTPException(status.HTTP_400_BAD_REQUEST, msg)

    user.password_hash = hash_password(payload.new_password)
    user.is_verified = True
    await db.execute(
        update(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked == False)  # noqa
        .values(revoked=True)
    )
    await db.commit()

    await log_action(db, "forgot_password_reset", user.id, request, {"email": user.email})
    return MessageOut(message="Password updated. Please sign in with your new password.")


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
