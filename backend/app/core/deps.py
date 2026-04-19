import hashlib
from datetime import datetime
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User
from app.models.session import UserSession

security_scheme = HTTPBearer(auto_error=False)


def token_to_jti(token: str) -> str:
    """Hash the token to get a stable jti for the session table."""
    return hashlib.sha256(token.encode()).hexdigest()[:64]


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not creds or not creds.credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    token = creds.credentials
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token")

    # Check session isn't revoked
    jti = token_to_jti(token)
    result = await db.execute(select(UserSession).where(UserSession.token_jti == jti))
    session_row = result.scalars().first()
    if not session_row or session_row.revoked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session has been revoked")
    if session_row.expires_at < datetime.utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    # Attach token to request for logout convenience
    request.state.token = token
    request.state.jti = jti
    return user


async def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if not creds:
        return None
    try:
        return await get_current_user(request, creds, db)
    except HTTPException:
        return None
