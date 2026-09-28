import logging

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.database import get_session
from app.core.redis import get_redis

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health(
    db: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> dict[str, str]:
    """Return service status including database and Redis connectivity."""
    status: dict[str, str] = {"status": "ok"}

    # Check database
    try:
        await db.execute(text("SELECT 1"))
        status["db"] = "ok"
    except Exception:
        logger.exception("Database health check failed")
        status["db"] = "error"

    # Check Redis
    try:
        await redis.ping()
        status["redis"] = "ok"
    except Exception:
        logger.exception("Redis health check failed")
        status["redis"] = "error"

    # Check Celery worker responsiveness (uses the sync Redis backend, so it
    # is safe to call from the API event loop).
    try:
        # in-memory ping with a short timeout so a dead broker/worker does
        # not hang the health endpoint
        replies = celery_app.control.ping(timeout=1)
        if replies:
            status["celery"] = "ok"
        else:
            status["celery"] = "unreachable"
    except Exception:
        logger.exception("Celery health check failed")
        status["celery"] = "unreachable"

    # Overall status is degraded if any component is down
    if status.get("db") == "error" or status.get("redis") == "error":
        status["status"] = "degraded"
    elif status.get("celery") != "ok":
        status["status"] = "degraded"

    return status
