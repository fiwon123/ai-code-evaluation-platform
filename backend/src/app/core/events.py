"""Redis pub/sub helpers for live submission updates.

Both publishers fail open: if Redis is unreachable the update is dropped with
a logged warning rather than raising (the WebSocket client simply keeps its
last snapshot and the regular HTTP fallbacks still work).
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

import redis as _sync_redis

from app.config import settings
from app.core.redis import redis_client

logger = logging.getLogger(__name__)


def _channel(submission_id: UUID) -> str:
    return f"submission:{submission_id}"


def _payload(submission_id: UUID, event_type: str, **fields: object) -> str:
    body = {"type": event_type, "submission_id": str(submission_id), **fields}
    return json.dumps(body, default=str)


# Dedicated sync client for the Celery worker process. The worker does not
# share an event loop with the API process, so it cannot reuse the async
# ``redis_client``; publishing is fire-and-forget.
_sync_redis_client = _sync_redis.from_url(settings.redis_url, decode_responses=True)


def publish_submission_event(submission_id: UUID, event_type: str, **fields: object) -> None:
    """Publish a submission update event (sync, for the Celery worker)."""
    try:
        _sync_redis_client.publish(
            _channel(submission_id), _payload(submission_id, event_type, **fields)
        )
    except Exception:
        logger.exception("Failed to publish event for submission %s", submission_id)


async def apublish_submission_event(submission_id: UUID, event_type: str, **fields: object) -> None:
    """Publish a submission update event (async, for the API server)."""
    try:
        await redis_client.publish(
            _channel(submission_id),
            _payload(submission_id, event_type, **fields),
        )
    except Exception:
        logger.exception("Failed to publish event for submission %s", submission_id)
