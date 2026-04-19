import random
import string
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.config import settings
from app.models.otp import OTPCode


def generate_otp_code() -> str:
    return "".join(random.choices(string.digits, k=settings.OTP_LENGTH))


async def create_otp_for_user(db: AsyncSession, user_id: int, purpose: str = "register") -> str:
    # Invalidate previous OTPs for this purpose
    await db.execute(
        update(OTPCode)
        .where(OTPCode.user_id == user_id, OTPCode.purpose == purpose, OTPCode.used == False)  # noqa
        .values(used=True)
    )
    code = generate_otp_code()
    otp = OTPCode(
        user_id=user_id,
        code=code,
        purpose=purpose,
        expires_at=datetime.utcnow() + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
    )
    db.add(otp)
    await db.commit()
    return code


async def verify_otp(db: AsyncSession, user_id: int, code: str, purpose: str = "register") -> tuple[bool, str]:
    result = await db.execute(
        select(OTPCode)
        .where(
            OTPCode.user_id == user_id,
            OTPCode.purpose == purpose,
            OTPCode.used == False,  # noqa
        )
        .order_by(OTPCode.created_at.desc())
    )
    otp = result.scalars().first()
    if not otp:
        return False, "No active OTP found. Please request a new one."
    if otp.expires_at < datetime.utcnow():
        return False, "OTP has expired. Please request a new one."
    if otp.attempts >= 5:
        return False, "Too many failed attempts. Please request a new OTP."
    if otp.code != code:
        otp.attempts += 1
        await db.commit()
        return False, "Invalid OTP code."
    otp.used = True
    await db.commit()
    return True, "OTP verified."


def send_otp_email(to_email: str, name: str, code: str) -> None:
    """
    Sends OTP via SMTP if EMAIL_ENABLED, otherwise prints it to console.
    For dev, the console output is the intended flow.
    """
    subject = f"[{settings.APP_NAME}] Your verification code"
    body = (
        f"Hi {name},\n\n"
        f"Your {settings.APP_NAME} verification code is: {code}\n"
        f"It expires in {settings.OTP_EXPIRE_MINUTES} minutes.\n\n"
        f"If you didn't request this, you can safely ignore it.\n"
    )

    if not settings.EMAIL_ENABLED or not settings.SMTP_HOST or not settings.SMTP_USER:
        print("\n" + "=" * 60)
        print(f"  [DEV EMAIL] To: {to_email}")
        print(f"  Subject: {subject}")
        print(f"  --- Body ---")
        print(body)
        print("=" * 60 + "\n")
        return

    msg = EmailMessage()
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        print(f"[WARN] SMTP send failed: {e}. Falling back to console.")
        print(body)
