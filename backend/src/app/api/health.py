import logging

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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

    # Overall status is degraded if any component is down
    if status.get("db") == "error" or status.get("redis") == "error":
        status["status"] = "degraded"

    return status
