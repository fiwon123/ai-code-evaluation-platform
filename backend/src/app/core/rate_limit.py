"""Request rate limiting for API endpoints.

A fixed-window counter backed by Redis. ``enforce_rate_limit`` is a FastAPI
dependency applied to the ``/api`` router and raises HTTP 429 when a client
exceeds its allowed request rate. Authenticated clients (valid JWT) get a
higher limit than anonymous clients. The limiter fails open: if Redis is
unreachable the request is allowed through.
"""

from __future__ import annotations

import logging
import time
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from redis.asyncio import Redis

from app.config import settings
from app.core.redis import get_redis
from app.core.security import decode_access_token

logger = logging.getLogger(__name__)


class RateLimiter:
    """Fixed-window rate limiter backed by Redis."""

    def __init__(self, redis: Redis, window_seconds: int = 60) -> None:
        self._redis = redis
        self.window_seconds = window_seconds

    async def is_allowed(self, key: str, limit: int) -> bool:
        """Increment the counter for ``key`` and return whether the request is allowed."""
        bucket = int(time.time() // self.window_seconds)
        redis_key = f"rate_limit:{key}:{bucket}"
        try:
            count = await self._redis.incr(redis_key)
            if count == 1:
                await self._redis.expire(redis_key, self.window_seconds)
            return int(count) <= limit
        except Exception:  # noqa: BLE001 - limiter must never block traffic
            logger.exception("Rate limiter unavailable — allowing request for %s", key)
            return True


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


def _extract_user_id(request: Request) -> str | None:
    """Return the JWT subject when a valid Bearer token is present."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[len("Bearer ") :].strip()
    try:
        subject = decode_access_token(token)
        UUID(subject)
        return subject
    except Exception:  # noqa: BLE001 - invalid token means anonymous
        return None


async def enforce_rate_limit(
    request: Request,
    redis: Redis = Depends(get_redis),
) -> None:
    """FastAPI dependency applied to /api routes; raises 429 when over limit."""
    if not settings.rate_limit_enabled:
        return
    if request.url.path.startswith("/api/ws/"):
        return

    user_id = _extract_user_id(request)
    if user_id is not None:
        key = f"user:{user_id}"
        limit = settings.rate_limit_authenticated_limit
    else:
        key = f"ip:{_client_ip(request)}"
        limit = settings.rate_limit_anonymous_limit

    limiter = RateLimiter(redis, settings.rate_limit_window_seconds)
    if not await limiter.is_allowed(key, limit):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later.",
            headers={"Retry-After": str(settings.rate_limit_window_seconds)},
        )
