"""WebSocket endpoint that streams live updates for a submission.

The browser WebSocket API cannot set custom headers, so authentication uses a
JWT passed as a ``token`` query parameter (``?token=<jwt>``). On connect the
handler validates the token, verifies the caller owns the submission, pushes a
``snapshot`` of the current state, then subscribes to Redis pub/sub and
forwards ``update`` messages as submissions transition through the evaluation
pipeline. While idle it sends ``ping`` heartbeats to keep the socket alive.

Mid-pipeline events carry only ``{status, phase}`` — there is no output to
deliver until the run finishes. A **terminal** event additionally carries the
whole persisted ``submission`` record, so the client renders code, logs and the
evaluation result from the socket instead of waiting for a second round-trip.
The record is re-read from the database rather than taken from the event: the
worker publishes only after committing, and re-serializing keeps this endpoint
the single place that produces a client-safe submission payload.

The snapshot read uses a *fresh* short-lived database session rather than a
session spanning the whole socket lifetime: long-lived transactions can pin
stale snapshots (SQLite) and hold connections open for no reason (any DB).
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core import database
from app.core.redis import get_redis
from app.core.security import decode_access_token
from app.models.submission import Submission
from app.schemas.submission import SubmissionDetailRead

logger = logging.getLogger(__name__)

router = APIRouter()

HEARTBEAT_INTERVAL_SECONDS = 15

# Application-level close codes (4000-4999 range)
CLOSE_NOT_AUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403

#: Events the worker publishes mid-pipeline mapped to the phase they imply.
PHASE_BY_EVENT = {
    "processing": "generating",
    "code_generated": "testing",
    # A failed attempt that is being fed back to the provider. Distinct from
    # "generating" so the UI can say *repairing* rather than implying a first
    # attempt, and so the phase is meaningful while the next message waits in
    # the broker.
    "repairing": "repairing",
}
#: Terminal events — forwarded with the phase cleared.
TERMINAL_STATUSES = frozenset({"completed", "failed"})
#: Events that leave the persisted record materially changed, so the client is
#: sent that record: terminal ones finish it, and ``repairing`` adds an attempt
#: row (the failure a client needs to render the timeline).
RECORD_CARRYING_EVENTS = TERMINAL_STATUSES | {"repairing"}
#: Status events that can arrive from the PATCH endpoint directly.
STATUS_EVENTS = frozenset({"pending", "processing", "completed", "failed"})


def _map_event_to_update(payload: dict) -> dict | None:
    """Translate a pub/sub event into a client-safe ``{status, phase}`` pair.

    Returns None for events that do not map to a SubmissionStatus (the PATCH
    endpoint can publish arbitrary event types; forwarding them as ``status``
    would corrupt client state).
    """
    event_type = payload.get("type", "")
    if event_type in PHASE_BY_EVENT:
        return {"status": "processing", "phase": PHASE_BY_EVENT[event_type]}
    if event_type in TERMINAL_STATUSES:
        return {"status": event_type, "phase": None}
    if event_type in STATUS_EVENTS:
        return {"status": event_type, "phase": None}
    return None


async def _load_submission_snapshot(submission_id: UUID, user_id: UUID) -> dict | None:
    """Serialize a user's submission with its attempt history (or None)."""
    async with database.async_session() as session:
        result = await session.execute(
            select(Submission)
            .options(
                selectinload(Submission.evaluation_result),
                selectinload(Submission.attempts),
            )
            .where(Submission.id == submission_id, Submission.user_id == user_id)
        )
        submission = result.scalar_one_or_none()
        if submission is None:
            return None
        # The detail schema, not the list one: a page opened mid-repair needs
        # the attempts already recorded or its timeline starts empty.
        return SubmissionDetailRead.from_submission(submission).model_dump(mode="json")


@router.websocket("/ws/submissions/{submission_id}")
async def submission_updates(
    websocket: WebSocket,
    submission_id: UUID,
    redis: Redis = Depends(get_redis),
) -> None:
    """Stream live status updates for a single submission (owner only)."""
    await websocket.accept()

    token = websocket.query_params.get("token")
    try:
        if not token:
            raise ValueError("missing token")
        user_id = UUID(decode_access_token(token))
    except jwt.PyJWTError, ValueError, TypeError:
        await websocket.close(code=CLOSE_NOT_AUTHENTICATED)
        return

    snapshot = await _load_submission_snapshot(submission_id, user_id)
    if snapshot is None:
        await websocket.close(code=CLOSE_FORBIDDEN)
        return

    await websocket.send_text(json.dumps({"type": "snapshot", "submission": snapshot}))

    channel = f"submission:{submission_id}"
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)
    try:
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=HEARTBEAT_INTERVAL_SECONDS,
            )
            if message is None:
                # Heartbeat — also surfaces dead connections quickly.
                await websocket.send_text(json.dumps({"type": "ping"}))
                continue

            # Map a pub/sub event to a client-safe status/phase pair. The
            # worker emits ``processing``, ``code_generated``, then a terminal
            # event; forwarding the raw event type would hand clients an
            # invalid status ("code_generated" is not a SubmissionStatus).
            data = message.get("data")
            if isinstance(data, bytes):
                data = data.decode("utf-8")
            try:
                payload = json.loads(data) if isinstance(data, str) else {}
            except TypeError, json.JSONDecodeError:
                continue
            mapped = _map_event_to_update(payload)
            if mapped is None:
                # Unknown/unsupported event — drop it instead of corrupting
                # client state (the PATCH endpoint can publish arbitrary
                # strings, e.g. "code_generated" or junk).
                continue
            outgoing: dict = {
                "type": "update",
                "submission_id": str(submission_id),
                **mapped,
            }
            # A terminal event carries the persisted record, not just the
            # status. The worker publishes only after committing (see
            # ``tasks/evaluate.py``), so this read sees the stored code, logs
            # and result.
            #
            # Re-serializing here rather than having the worker stuff the
            # payload into the event keeps ONE place that produces a
            # client-safe record (the snapshot already uses it), so
            # the two cannot drift, and the worker stays ignorant of the wire
            # format. It also makes the message idempotent: it is a complete
            # record rather than a patch, so a duplicate after a reconnect — or
            # an update that races the snapshot — cannot leave a client with
            # half-merged output.
            if payload.get("type", "") in RECORD_CARRYING_EVENTS:
                record = await _load_submission_snapshot(submission_id, user_id)
                if record is not None:
                    outgoing["submission"] = record
            await websocket.send_text(json.dumps(outgoing))
    except WebSocketDisconnect:
        logger.info("Client disconnected from submission %s", submission_id)
    except Exception:  # noqa: BLE001 - a socket failure must not crash the app
        logger.exception("WebSocket error for submission %s", submission_id)
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
