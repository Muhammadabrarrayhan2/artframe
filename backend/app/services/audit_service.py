from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Request
from app.models.audit import AuditLog


async def log_action(
    db: AsyncSession,
    action: str,
    user_id: int | None = None,
    request: Request | None = None,
    meta: dict | None = None,
) -> None:
    ip = ""
    ua = ""
    if request is not None:
        ip = request.client.host if request.client else ""
        ua = request.headers.get("user-agent", "")[:255]
    entry = AuditLog(
        user_id=user_id,
        action=action,
        ip_address=ip,
        user_agent=ua,
        meta=meta or {},
    )
    db.add(entry)
    await db.commit()
