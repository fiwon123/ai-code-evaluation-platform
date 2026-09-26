"""Celery task that generates code via an LLM provider and runs the test suite.

A submission is evaluated in one or more *attempts*. Attempt 1 is the initial
generation; if its tests fail, the failure is fed back to the provider and a
new attempt runs, up to ``settings.evaluation_max_attempts``.

Each attempt runs in its own Celery task rather than as a loop inside one:
``task_time_limit`` is 300s, while a single attempt can spend 60s in the LLM
call and up to ~90s running tests, so three attempts would be killed mid-flight
as one task. Chaining also means a worker restart between attempts loses only
the attempt in progress — the state it needs is in the database.

What is persisted, and where:

* every attempt → ``evaluation_attempts`` (code, counts, raw logs, readable
  summary, metrics, per-test results), keyed uniquely by
  ``(submission_id, attempt_number)`` so a re-sent message cannot double-bill
  the provider or duplicate history;
* the last attempt only → ``evaluation_results``, the unique row the rest of
  the product (share, comparison, stats) already reads.

So ``Submission.code`` and ``EvaluationResult.score`` describe the final
attempt, which is the one that was actually evaluated last. A repair that
regresses will show a lower score than an earlier attempt — the timeline keeps
both.
"""

from __future__ import annotations

import logging
import traceback
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.celery_app import celery_app
from app.core.database import sync_session
from app.core.events import publish_submission_event
from app.models.challenge import Challenge
from app.models.evaluation_attempt import EvaluationAttempt
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.services.evaluation import EvaluationOutcome, evaluate_code
from app.services.llm_fallback import generate_code as generate_code_with_fallback
from app.services.summary import build_repair_feedback, format_failure_summary

logger = logging.getLogger(__name__)


def _redact(message: str, api_key: str | None) -> str:
    """Strip a per-run API key out of an error message before it is logged."""
    if api_key:
        return message.replace(api_key, "***")
    return message


def _redact_metrics(metrics: dict, api_key: str | None) -> dict:
    """Redact string values in an outcome's metrics before persisting them.

    Metrics are attacker-adjacent: an exception message captured into
    ``{"error": msg}`` can embed the request that carried the key.
    """
    if not api_key:
        return metrics
    return {
        key: _redact(value, api_key) if isinstance(value, str) else value
        for key, value in metrics.items()
    }


def _max_attempts() -> int:
    """Attempt budget, never below 1 (1 disables the repair loop)."""
    return max(1, settings.evaluation_max_attempts)


def _settle_after_duplicate(session: Session, submission_id: UUID) -> None:
    """Normalize a submission after a duplicate race discarded our transaction.

    On ``IntegrityError`` the rollback also reverts our ``status``/``score``
    flip (it lived in the doomed transaction), which can leave the row at
    ``processing`` next to the winner's result. Re-read the row and settle it
    to the terminal state the winner's result implies.
    """
    session.expire_all()
    current = session.get(Submission, submission_id)
    if (
        current is not None
        and current.evaluation_result is not None
        and current.status != "completed"
    ):
        current.status = "completed"
        current.score = current.evaluation_result.score or 0.0
        current.phase = None
        session.commit()
        # The duplicate run that won did so silently (its commit raced ours),
        # so announce the terminal state — the WS-connected page would
        # otherwise never learn the row finished.
        publish_submission_event(
            current.id, "completed", score=current.evaluation_result.score or 0.0
        )


def _attempt_already_ran(session: Session, submission_id: UUID, attempt_number: int) -> bool:
    """True when this exact attempt already has a row.

    Doubles as the duplicate guard for attempt 1: a recovery sweep re-sending
    the original message finds attempt 1 recorded and does no work, so a
    repair chain in flight is never restarted from scratch.
    """
    existing = session.scalar(
        select(EvaluationAttempt.id).where(
            EvaluationAttempt.submission_id == submission_id,
            EvaluationAttempt.attempt_number == attempt_number,
        )
    )
    return existing is not None


def _latest_attempt(session: Session, submission_id: UUID) -> EvaluationAttempt | None:
    """Return the highest-numbered recorded attempt for a submission."""
    return session.scalar(
        select(EvaluationAttempt)
        .where(EvaluationAttempt.submission_id == submission_id)
        .order_by(EvaluationAttempt.attempt_number.desc())
        .limit(1)
    )


def _build_feedback(session: Session, submission: Submission, attempt_number: int) -> str | None:
    """Assemble the repair block from the previous attempt's stored row.

    Read back out of the database rather than threaded through the task
    arguments: the feedback can be tens of kilobytes and there is no reason to
    put it in the broker payload when the attempt that produced it is already
    persisted.
    """
    if attempt_number <= 1:
        return None
    previous = _latest_attempt(session, submission.id)
    if previous is None:
        return None
    return build_repair_feedback(
        previous_code=previous.code or "",
        summary=previous.logs_summary or "",
        logs=previous.logs or "",
        language=submission.language or "python",
        attempt_number=attempt_number,
        max_attempts=_max_attempts(),
        log_tail_chars=settings.repair_log_tail_chars,
    )


def _record_attempt(
    session: Session,
    submission: Submission,
    attempt_number: int,
    code: str,
    outcome: EvaluationOutcome,
    api_key: str | None,
) -> str:
    """Persist one attempt and return its readable summary.

    The summary is derived once, here, and copied onto the final result later,
    so the report and the timeline can never disagree about what happened.
    """
    summary = _redact(
        format_failure_summary(
            passed=outcome.passed,
            total=outcome.total,
            test_results=outcome.test_results,
            logs=outcome.logs,
            metrics=outcome.metrics,
        ),
        api_key,
    )
    session.add(
        EvaluationAttempt(
            submission_id=submission.id,
            attempt_number=attempt_number,
            code=_redact(code, api_key),
            passed_tests=outcome.passed,
            total_tests=outcome.total,
            score=outcome.score,
            logs=_redact(outcome.logs, api_key),
            logs_summary=summary,
            metrics=_redact_metrics(outcome.metrics, api_key),
            test_results=outcome.test_results,
        )
    )
    return summary


def _write_final_result(
    session: Session,
    submission: Submission,
    outcome: EvaluationOutcome,
    summary: str,
    api_key: str | None = None,
) -> bool:
    """Write the terminal ``EvaluationResult`` for a finished submission.

    Returns False when a duplicate dispatch beat us to the unique row, in
    which case the caller settles the submission instead of double-writing.

    Redaction is applied here even though the attempt row already redacted its
    own copy: the final result is the row the report renders, and it is written
    on a separate code path from the attempt log.
    """
    session.add(
        EvaluationResult(
            submission_id=submission.id,
            passed_tests=outcome.passed,
            total_tests=outcome.total,
            score=outcome.score,
            logs=_redact(outcome.logs, api_key),
            logs_summary=_redact(summary, api_key),
            metrics=_redact_metrics(outcome.metrics, api_key),
            # Persisted so the report can show per-test results without
            # re-parsing the raw dump.
            test_results=outcome.test_results,
        )
    )
    submission.status = "completed"
    submission.score = outcome.score
    submission.phase = None
    try:
        session.commit()
    except IntegrityError:
        # A duplicate dispatch (recovery re-send) wrote a result first — the
        # row is already terminal; treat this run as a no-op.
        session.rollback()
        logger.warning(
            "Duplicate evaluation for submission %s — result already recorded",
            submission.id,
        )
        _settle_after_duplicate(session, submission.id)
        return False
    publish_submission_event(submission.id, "completed", score=outcome.score)
    return True


def _dispatch_next_attempt(submission_id: UUID, api_key: str | None, next_attempt: int) -> bool:
    """Queue the next attempt. Returns False if the broker refused it."""
    try:
        evaluate_submission.apply_async(
            args=[str(submission_id), api_key],
            kwargs={"attempt": next_attempt},
        )
    except Exception as exc:  # noqa: BLE001 - broker failures must not crash the worker
        logger.error(
            "Could not queue repair attempt %s for submission %s: %s",
            next_attempt,
            submission_id,
            _redact(str(exc), api_key),
        )
        return False
    return True


def _run_submission_evaluation(
    session: Session,
    submission_id: UUID,
    api_key: str | None = None,
    attempt: int = 1,
) -> dict[str, object]:
    """Run one generate-and-test attempt, chaining a repair when it fails."""
    submission = session.get(Submission, submission_id)
    if submission is None:
        return {"status": "not_found", "submission_id": str(submission_id)}

    if submission.evaluation_result is not None:
        # Duplicate dispatch (e.g. the recovery sweep re-sent the message while
        # the original run already wrote a result) — the row is terminal, so
        # there is nothing left to evaluate.
        logger.info(
            "Duplicate evaluation for submission %s — result already exists, skipping",
            submission_id,
        )
        return {
            "status": submission.status,
            "submission_id": str(submission_id),
            "duplicate": True,
        }

    if _attempt_already_ran(session, submission_id, attempt):
        logger.info(
            "Duplicate dispatch for submission %s attempt %s — already recorded, skipping",
            submission_id,
            attempt,
        )
        return {
            "status": submission.status,
            "submission_id": str(submission_id),
            "attempt": attempt,
            "duplicate": True,
        }

    challenge = session.get(Challenge, submission.challenge_id)
    if challenge is None:
        submission.status = "failed"
        session.commit()
        publish_submission_event(submission.id, "failed", error="challenge not found")
        return {"status": "failed", "error": "challenge not found"}

    if submission.started_at is None:
        # Set once for the whole run, not per attempt — the UI derives elapsed
        # time from it, and resetting it on each repair would under-report.
        submission.started_at = datetime.now(UTC)
    submission.status = "processing"
    submission.phase = "generating"
    session.commit()
    publish_submission_event(submission.id, "processing", attempt=attempt)

    provider_name = submission.provider or "demo"
    workdir = Path(settings.evaluation_dir) / str(submission.id)
    feedback = _build_feedback(session, submission, attempt)

    try:
        generation = generate_code_with_fallback(
            provider_name=provider_name,
            prompt=challenge.prompt,
            language=challenge.language,
            feedback=feedback,
            api_key=api_key,
            model=submission.model,
        )
        code = generation.code
        submission.code = code
        submission.phase = "testing"
        session.commit()
        publish_submission_event(submission.id, "code_generated", attempt=attempt)

        outcome = evaluate_code(
            code=code,
            test_code=challenge.test_code,
            language=challenge.language,
            workdir=workdir,
            # No explicit timeout: evaluate_code applies the per-language
            # budget (java/go get extra headroom for compilation).
        )
        # Provenance is added after the sandbox runs so it lands in the result's
        # metrics, where the report renders it. Empty on a normal run.
        outcome.metrics.update(generation.as_metrics())
        if generation.used_fallback:
            logger.warning(
                "Submission %s attempt %s generated by the %s fallback after %s failed: %s",
                submission.id,
                attempt,
                generation.provider,
                provider_name,
                generation.primary_error,
            )
    except Exception as exc:  # noqa: BLE001 - worker must never crash silently
        message = _redact(str(exc), api_key)
        # Log the full traceback with any per-run API key scrubbed out — the
        # raw exception could embed the key and must never reach the logs.
        logger.error(
            "Evaluation failed for submission %s:\n%s",
            submission.id,
            _redact(traceback.format_exc(), api_key),
        )
        # A provider or sandbox error is an *error*, not a test failure, so it
        # is terminal for the run: the code was never produced or the harness
        # never ran, so there is nothing a repair attempt could correct.
        error_outcome = EvaluationOutcome(
            passed=0,
            total=0,
            score=0.0,
            logs=f"Evaluation error: {message}",
            metrics={"error": message},
        )
        summary = _record_attempt(
            session, submission, attempt, submission.code or "", error_outcome, api_key
        )
        session.add(
            EvaluationResult(
                submission_id=submission.id,
                passed_tests=0,
                total_tests=0,
                score=0.0,
                logs=error_outcome.logs,
                logs_summary=summary,
                metrics=error_outcome.metrics,
                test_results=[],
            )
        )
        submission.status = "failed"
        submission.score = 0.0
        submission.phase = None
        try:
            session.commit()
        except IntegrityError:
            # A duplicate dispatch raced us and already recorded a result —
            # nothing more to write.
            session.rollback()
            logger.warning(
                "Duplicate failure record for submission %s — result already exists",
                submission.id,
            )
            _settle_after_duplicate(session, submission.id)
            return {
                "status": "failed",
                "submission_id": str(submission.id),
                "duplicate": True,
            }
        publish_submission_event(submission.id, "failed", error=message)
        return {"status": "failed", "error": message}

    summary = _record_attempt(session, submission, attempt, code, outcome, api_key)
    max_attempts = _max_attempts()

    if outcome.passed_all:
        # Tests pass — terminal. Commit the attempt row and the final result
        # together so the timeline never shows an attempt the result ignores.
        if not _write_final_result(session, submission, outcome, summary, api_key):
            return {
                "status": "completed",
                "submission_id": str(submission_id),
                "duplicate": True,
            }
        return {
            "status": "completed",
            "passed": outcome.passed,
            "total": outcome.total,
            "score": outcome.score,
            "attempt": attempt,
        }

    if attempt < max_attempts:
        # Failing tests (or a timeout / missing runner, which is a failure the
        # model can plausibly correct) with budget left: hand the failure back
        # to the provider and try again.
        submission.phase = "repairing"
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            _settle_after_duplicate(session, submission.id)
            return {
                "status": submission.status,
                "submission_id": str(submission_id),
                "duplicate": True,
            }
        publish_submission_event(
            submission.id,
            "repairing",
            attempt=attempt,
            next_attempt=attempt + 1,
            max_attempts=max_attempts,
            score=outcome.score,
        )
        if not _dispatch_next_attempt(submission.id, api_key, attempt + 1):
            # The broker refused the repair. The attempt we have is valid data,
            # so settle on it rather than leaving the row at `processing`
            # until the recovery sweep gives up on it.
            logger.warning(
                "Repair dispatch failed for submission %s — settling on attempt %s",
                submission.id,
                attempt,
            )
            if not _write_final_result(session, submission, outcome, summary, api_key):
                return {
                    "status": submission.status,
                    "submission_id": str(submission_id),
                    "duplicate": True,
                }
            return {
                "status": "completed",
                "passed": outcome.passed,
                "total": outcome.total,
                "score": outcome.score,
                "attempt": attempt,
                "repair_dispatch_failed": True,
            }
        return {
            "status": "processing",
            "submission_id": str(submission_id),
            "attempt": attempt,
            "repairing": True,
        }

    # Budget exhausted: the last attempt is the result.
    if not _write_final_result(session, submission, outcome, summary, api_key):
        return {
            "status": "completed",
            "submission_id": str(submission_id),
            "duplicate": True,
        }
    logger.info(
        "Submission %s exhausted %s repair attempts (score %s)",
        submission.id,
        max_attempts,
        outcome.score,
    )
    return {
        "status": "completed",
        "passed": outcome.passed,
        "total": outcome.total,
        "score": outcome.score,
        "attempt": attempt,
    }


@celery_app.task(name="app.tasks.evaluate.evaluate_submission")
def evaluate_submission(submission_id: str, api_key: str | None = None, attempt: int = 1) -> dict:
    """Celery entry point — run one attempt of a submission's evaluation.

    ``attempt`` 1 is the initial generation; higher values are repairs queued
    by a previous attempt. The per-run API key travels with the message (it is
    never persisted), which is why a repair attempt receives the same key the
    original dispatch did.
    """
    with sync_session() as session:
        return _run_submission_evaluation(
            session, UUID(submission_id), api_key=api_key, attempt=attempt
        )
