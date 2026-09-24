"""Periodic recovery for submissions stuck in ``pending``/``processing``.

A submission can be stranded without a terminal transition:

* the Celery message was lost before the volume fix (#140) — the row stays
  ``pending`` forever;
* ``task_expires`` dropped the queued message after 1h — same result;
* the worker was killed mid-run — the row stays ``processing``, only to be
  redelivered (or not) after ``visibility_timeout``;

This module runs on Celery beat every minute and self-heals stale rows:

* ``pending`` with ``updated_at`` older than ``PENDING_STALE_MINUTES`` is
  re-dispatched (the evaluation task handles missing challenges itself) —
  bounded by ``PENDING_MAX_MINUTES`` measured from ``created_at``: a row that
  never started within that window is abandoned (marked ``failed``) instead of
  being re-dispatched forever;
* ``processing`` with ``updated_at`` older than ``PROCESSING_STALE_MINUTES``
  is marked ``failed`` with an explanatory ``EvaluationResult`` (failing
  rather than re-dispatching avoids double-running a possibly-alive
  evaluation).

Re-dispatch is skipped for providers that need an API key when the worker has
no key to run them with: the per-run key is never persisted (submissions.py
forwards it straight to the task), so a re-dispatch would only fail with
"API key missing". Those rows are failed fast instead, with a message telling
the user to re-submit.

Thresholds are deliberately generous: the worst realistic evaluation path is
a 60s LLM call plus a 90s Go compile/test run (~2.5 min), so 10/20 minutes
are far past any healthy execution, and the 60-minute ``pending`` ceiling is
well past the 1h ``task_expires`` window that can silently drop a queued task.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.database import sync_session
from app.core.events import publish_submission_event
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.services.llm import KEYED_PROVIDERS
from app.tasks.evaluate import evaluate_submission

logger = logging.getLogger(__name__)

#: A ``pending`` submission older than this is considered abandoned.
PENDING_STALE_MINUTES = 10
#: Anything still ``pending`` this long after creation is abandoned: the 10-min
#: re-dispatch loop keeps the row's ``updated_at`` fresh, so a dead worker (or
#: a queue that silently lost the message) would otherwise leave it ``pending``
#: forever. 60 minutes is far past the 1h ``task_expires`` window plus margin.
PENDING_MAX_MINUTES = 60
#: A ``processing`` submission older than this is considered abandoned.
PROCESSING_STALE_MINUTES = 20

_STALE_ERROR = "Evaluation lost before completing (worker likely restarted). Please re-submit."

_ABANDONED_ERROR = (
    "Evaluation never started — the worker did not pick it up within "
    f"{PENDING_MAX_MINUTES} minutes. Please re-submit."
)

_NO_KEY_ERROR = (
    "Cannot re-dispatch: {provider} was submitted with a per-run API key that "
    "is not stored server-side, and {env_var} is not configured on the worker. "
    "Please re-submit with a new API key."
)


def _utcnow() -> datetime:
    """Timezone-aware UTC now (single point for tests to freeze)."""
    return datetime.now(UTC)


def _as_aware(dt: datetime | None) -> datetime | None:
    """Normalize a possibly-naive datetime to aware UTC for age comparisons."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _write_terminal_failure(
    session: Session,
    submission: Submission,
    logs: str,
    metrics: dict[str, object],
) -> None:
    """Record a terminal failure (EvaluationResult + status flip + WS event)."""
    result = EvaluationResult(
        submission_id=submission.id,
        passed_tests=0,
        total_tests=0,
        score=0.0,
        logs=logs,
        metrics=metrics,
    )
    session.add(result)
    submission.status = "failed"
    submission.score = 0.0
    submission.phase = None
    session.commit()
    publish_submission_event(submission.id, "failed", error=logs)


def _mark_failed(session: Session, submission: Submission, now: datetime) -> None:
    """Terminate a stale ``processing`` submission as failed + WS event."""
    _write_terminal_failure(
        session,
        submission,
        logs=_STALE_ERROR,
        metrics={
            "error": "stale_processing",
            "recovered_at": now.isoformat(),
        },
    )
    logger.warning(
        "Recovered stale 'processing' submission %s -> failed (stale > %sm)",
        submission.id,
        PROCESSING_STALE_MINUTES,
    )


def _mark_pending_abandoned(session: Session, submission: Submission, now: datetime) -> None:
    """Fail a ``pending`` row that never started within ``PENDING_MAX_MINUTES``.

    The 10-min re-dispatch loop bumps ``updated_at`` on every re-send, so a
    dead worker or silently-lost message would otherwise keep the row
    ``pending`` indefinitely. Measuring from ``created_at`` (which recovery
    never touches) gives the row a hard, generous ceiling.
    """
    _write_terminal_failure(
        session,
        submission,
        logs=_ABANDONED_ERROR,
        metrics={
            "error": "stale_pending",
            "recovered_at": now.isoformat(),
        },
    )
    logger.warning(
        "Recovered abandoned 'pending' submission %s -> failed (never started within %sm)",
        submission.id,
        PENDING_MAX_MINUTES,
    )


def _mark_no_key_failed(session: Session, submission: Submission, now: datetime) -> None:
    """Fail a stale ``pending`` row whose provider needs an unavailable key.

    The per-run API key forwarded at creation is never persisted, so a
    re-dispatch would only fail with "API key missing" — fail the row now with
    a clear message instead of dispatching a doomed task.
    """
    provider = (submission.provider or "demo").lower()
    env_var = KEYED_PROVIDERS[provider]
    message = _NO_KEY_ERROR.format(provider=provider, env_var=env_var)
    _write_terminal_failure(
        session,
        submission,
        logs=message,
        metrics={
            "error": "missing_api_key",
            "recovered_at": now.isoformat(),
            "provider": provider,
        },
    )
    logger.warning(
        "Recovered stale 'pending' submission %s -> failed (no %s available to re-dispatch %s)",
        submission.id,
        env_var,
        provider,
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
        stale_since = _as_aware(submission.updated_at)
        if stale_since is None:
            continue
        # updated_at may come back naive (e.g. SQLite); treat naive as UTC to
        # compare against the aware cutoff.
        age = now - stale_since

        if submission.status == "pending":
            provider = (submission.provider or "demo").lower()
            no_key_available = provider in KEYED_PROVIDERS and not os.getenv(
                KEYED_PROVIDERS[provider]
            )
            # Hard ceiling measured from created_at: recovery bumps updated_at
            # on every re-dispatch, so updated_at can never age out a pending
            # row by itself. If the task never started within the window, the
            # worker is gone or the message was lost — abandon the row instead
            # of re-dispatching it forever.
            created_at = _as_aware(submission.created_at)
            past_max_age = created_at is not None and now - created_at > timedelta(
                minutes=PENDING_MAX_MINUTES
            )
            if no_key_available and age > timedelta(minutes=PENDING_STALE_MINUTES):
                # No key available to actually run the evaluation — fail fast
                # with a clear message rather than dispatching a doomed task.
                # Checked before the max-age ceiling so the user gets the most
                # truthful reason (missing key beats "never started").
                _mark_no_key_failed(session, submission, now)
                failed += 1
                continue
            if past_max_age and not no_key_available:
                _mark_pending_abandoned(session, submission, now)
                failed += 1
                continue
            if age > timedelta(minutes=PENDING_STALE_MINUTES):
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
