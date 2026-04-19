"""
Simple in-memory rate limiter keyed by (ip, action).
Sufficient for single-instance development and MVP deployments.
Swap for Redis-backed limiter in production.
"""
import time
from collections import defaultdict, deque
from fastapi import Request, HTTPException, status


# { (ip, action): deque[timestamps] }
_buckets: dict[tuple[str, str], deque] = defaultdict(deque)


def check_rate(request: Request, action: str, limit: int, window_seconds: int) -> None:
    """Raise 429 if the caller has exceeded `limit` calls to `action` in the last window."""
    ip = request.client.host if request.client else "unknown"
    key = (ip, action)
    now = time.time()
    bucket = _buckets[key]
    # Drop expired entries
    while bucket and bucket[0] < now - window_seconds:
        bucket.popleft()
    if len(bucket) >= limit:
        retry = int(window_seconds - (now - bucket[0]))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many requests. Try again in {retry}s.",
        )
    bucket.append(now)
