"""Periodic recovery for submissions stuck in ``pending``/``processing``.

A submission can be stranded without a terminal transition:

* the Celery message was lost before the volume fix (#140) — the row stays
  ``pending`` forever;
* ``task_expires`` dropped the queued message after 1h — same result;
* the worker was killed mid-run — the row stays ``processing``, only to be
  redelivered (or not) after ``visibility_timeout``;

Nothing re-dispatches or fails those rows today. This module runs on Celery
beat every minute and self-heals stale rows:

* ``pending`` with ``updated_at`` older than ``PENDING_STALE_MINUTES`` is
  re-dispatched (the evaluation task handles missing challenges itself);
* ``processing`` with ``updated_at`` older than ``PROCESSING_STALE_MINUTES``
  is marked ``failed`` with an explanatory ``EvaluationResult`` (failing
  rather than re-dispatching avoids double-running a possibly-alive
  evaluation).

Thresholds are deliberately generous: the worst realistic evaluation path is
a 60s LLM call plus a 90s Go compile/test run (~2.5 min), so 10/20 minutes
are far past any healthy execution.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.database import sync_session
from app.core.events import publish_submission_event
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.tasks.evaluate import evaluate_submission

logger = logging.getLogger(__name__)

#: A ``pending`` submission older than this is considered abandoned.
PENDING_STALE_MINUTES = 10
#: A ``processing`` submission older than this is considered abandoned.
PROCESSING_STALE_MINUTES = 20

_STALE_ERROR = "Evaluation lost before completing (worker likely restarted). Please re-submit."


def _utcnow() -> datetime:
    """Timezone-aware UTC now (single point for tests to freeze)."""
    return datetime.now(UTC)


def _mark_failed(session: Session, submission: Submission, now: datetime) -> None:
    """Terminate a stale ``processing`` submission as failed + WS event."""
    result = EvaluationResult(
        submission_id=submission.id,
        passed_tests=0,
        total_tests=0,
        score=0.0,
        logs=_STALE_ERROR,
        metrics={
            "error": "stale_processing",
            "recovered_at": now.isoformat(),
        },
    )
    session.add(result)
    submission.status = "failed"
    submission.score = 0.0
    session.commit()
    publish_submission_event(submission.id, "failed", error=_STALE_ERROR)
    logger.warning(
        "Recovered stale 'processing' submission %s -> failed (stale > %sm)",
        submission.id,
        PROCESSING_STALE_MINUTES,
    )


def _run_recovery(session: Session, now: datetime | None = None) -> dict[str, int]:
    """Re-dispatch stale ``pending`` rows and fail stale ``processing`` rows.

    Returns a summary of actions taken for observability/logging.
    """
    now = now or _utcnow()
    dispatched = 0
    failed = 0

    rows = session.scalars(
        select(Submission).where(Submission.status.in_(["pending", "processing"]))
    ).all()

    for submission in rows:
        stale_since = submission.updated_at
        if stale_since is None:
            continue
        # updated_at may come back naive (e.g. SQLite); treat naive as UTC to
        # compare against the aware cutoff.
        if stale_since.tzinfo is None:
            stale_since = stale_since.replace(tzinfo=UTC)

        age = now - stale_since

        if submission.status == "pending" and age > timedelta(
            minutes=PENDING_STALE_MINUTES
        ):
            try:
                evaluate_submission.delay(str(submission.id))
            except Exception:
                # Broker unavailable — leave the row untouched so the next
                # beat tick (60s later) retries the sweep.
                logger.exception(
                    "Failed to re-dispatch stale 'pending' submission %s",
                    submission.id,
                )
                continue
            # Bump updated_at when the task is queued again so the next beat
            # tick doesn't re-dispatch while it is still waiting in the broker.
            submission.updated_at = now
            session.commit()
            dispatched += 1
            logger.info(
                "Recovered stale 'pending' submission %s -> re-dispatched (stale > %sm)",
                submission.id,
                PENDING_STALE_MINUTES,
            )
        elif submission.status == "processing" and age > timedelta(
            minutes=PROCESSING_STALE_MINUTES
        ):
            _mark_failed(session, submission, now)
            failed += 1

    return {"dispatched": dispatched, "failed": failed}


@celery_app.task(name="app.tasks.recover.recover_stuck_submissions")
def recover_stuck_submissions() -> dict[str, int]:
    """Celery beat entrypoint — sweep for stale pending/processing rows."""
    with sync_session() as session:
        summary = _run_recovery(session)
    logger.info("Stale-submission recovery sweep: %s", summary)
    return summary
