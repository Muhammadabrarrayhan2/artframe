import random
import string
import smtplib
import urllib.error
import urllib.request
import json
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.config import settings
from app.models.otp import OTPCode


def get_email_provider() -> str:
    if not settings.EMAIL_ENABLED:
        return "console"

    provider = settings.EMAIL_PROVIDER.strip().lower()
    if provider == "sendgrid":
        return "sendgrid"
    return "smtp"


def is_email_delivery_ready() -> bool:
    provider = get_email_provider()
    if provider == "console":
        return False
    if provider == "sendgrid":
        return bool(settings.SENDGRID_API_KEY.strip()) and bool(settings.EMAIL_FROM.strip())
    return (
        bool(settings.SMTP_HOST.strip())
        and bool(settings.SMTP_USER.strip())
        and bool(settings.SMTP_PASSWORD.strip())
    )


def get_email_delivery_label() -> str:
    provider = get_email_provider()
    if provider == "console":
        return "ON (console)"
    if is_email_delivery_ready():
        return provider.upper()
    return f"{provider.upper()} (missing config)"


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


def send_otp_email(to_email: str, name: str, code: str) -> str:
    """
    Sends OTP via SMTP if configured, otherwise prints it to console.
    Returns the delivery mode so callers can describe what happened.
    """
    subject = f"[{settings.APP_NAME}] Your verification code"
    body = (
        f"Hi {name},\n\n"
        f"Your {settings.APP_NAME} verification code is: {code}\n"
        f"It expires in {settings.OTP_EXPIRE_MINUTES} minutes.\n\n"
        f"If you didn't request this, you can safely ignore it.\n"
    )

    provider = get_email_provider()
    delivery_ready = is_email_delivery_ready()

    if not delivery_ready:
        print("\n" + "=" * 60)
        print(f"  [DEV EMAIL] To: {to_email}")
        print(f"  Subject: {subject}")
        print(f"  --- Body ---")
        print(body)
        print("=" * 60 + "\n")
        return "console"

    try:
        if provider == "sendgrid":
            payload = {
                "personalizations": [{"to": [{"email": to_email}], "subject": subject}],
                "from": {
                    "email": settings.EMAIL_FROM,
                    "name": settings.EMAIL_FROM_NAME,
                },
                "content": [{"type": "text/plain", "value": body}],
            }
            req = urllib.request.Request(
                settings.SENDGRID_API_BASE_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {settings.SENDGRID_API_KEY}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status not in (200, 202):
                    raise RuntimeError(f"Unexpected SendGrid status: {response.status}")
            return "sendgrid"

        msg = EmailMessage()
        msg["From"] = formataddr((settings.EMAIL_FROM_NAME, settings.EMAIL_FROM))
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.set_content(body)

        smtp_cls = smtplib.SMTP_SSL if settings.SMTP_USE_SSL else smtplib.SMTP
        with smtp_cls(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
            if settings.SMTP_USE_TLS and not settings.SMTP_USE_SSL:
                server.ehlo()
                server.starttls()
                server.ehlo()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        return "smtp"
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"[WARN] SendGrid send failed: {e.code} {e.reason}. Response: {error_body}. Falling back to console.")
    except Exception as e:
        provider_name = "SendGrid" if provider == "sendgrid" else "SMTP"
        print(f"[WARN] {provider_name} send failed: {e}. Falling back to console.")
        print("\n" + "=" * 60)
        print(f"  [FALLBACK EMAIL] To: {to_email}")
        print(f"  Subject: {subject}")
        print(f"  --- Body ---")
        print(body)
        print("=" * 60 + "\n")
        return "console_fallback"

    print("\n" + "=" * 60)
    print(f"  [FALLBACK EMAIL] To: {to_email}")
    print(f"  Subject: {subject}")
    print(f"  --- Body ---")
    print(body)
    print("=" * 60 + "\n")
    return "console_fallback"
