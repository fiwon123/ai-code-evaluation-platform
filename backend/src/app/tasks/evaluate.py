"""Celery task that generates code via an LLM provider and runs the test suite."""

from __future__ import annotations

import logging
import traceback
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.config import settings
from app.core.celery_app import celery_app
from app.core.database import sync_session
from app.core.events import publish_submission_event
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.services.evaluation import evaluate_code
from app.services.llm import get_llm_provider

logger = logging.getLogger(__name__)


def _redact(message: str, api_key: str | None) -> str:
    """Strip a per-run API key out of an error message before it is logged."""
    if api_key:
        return message.replace(api_key, "***")
    return message


def _run_submission_evaluation(
    session: Session,
    submission_id: UUID,
    api_key: str | None = None,
) -> dict[str, object]:
    """Orchestrate generation + test execution for a submission (sync)."""
    submission = session.get(Submission, submission_id)
    if submission is None:
        return {"status": "not_found", "submission_id": str(submission_id)}

    challenge = session.get(Challenge, submission.challenge_id)
    if challenge is None:
        submission.status = "failed"
        session.commit()
        publish_submission_event(submission.id, "failed", error="challenge not found")
        return {"status": "failed", "error": "challenge not found"}

    submission.status = "processing"
    session.commit()
    publish_submission_event(submission.id, "processing")

    provider_name = submission.provider or "demo"
    workdir = Path(settings.evaluation_dir) / str(submission.id)

    try:
        provider = get_llm_provider(provider_name, api_key=api_key)
        code = provider.generate_code(challenge.prompt, challenge.language)
        submission.code = code
        session.commit()
        publish_submission_event(submission.id, "code_generated")

        outcome = evaluate_code(
            code=code,
            test_code=challenge.test_code,
            language=challenge.language,
            workdir=workdir,
            # No explicit timeout: evaluate_code applies the per-language
            # budget (java/go get extra headroom for compilation).
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
        result = EvaluationResult(
            submission_id=submission.id,
            passed_tests=0,
            total_tests=0,
            score=0.0,
            logs=f"Evaluation error: {message}",
            metrics={"error": message},
        )
        session.add(result)
        submission.status = "failed"
        submission.score = 0.0
        session.commit()
        publish_submission_event(submission.id, "failed", error=message)
        return {"status": "failed", "error": message}

    result = EvaluationResult(
        submission_id=submission.id,
        passed_tests=outcome.passed,
        total_tests=outcome.total,
        score=outcome.score,
        logs=outcome.logs,
        metrics=outcome.metrics,
    )
    session.add(result)
    submission.status = "completed"
    submission.score = outcome.score
    session.commit()
    publish_submission_event(submission.id, "completed", score=outcome.score)

    return {
        "status": "completed",
        "passed": outcome.passed,
        "total": outcome.total,
        "score": outcome.score,
    }


@celery_app.task(name="app.tasks.evaluate.evaluate_submission")
def evaluate_submission(submission_id: str, api_key: str | None = None) -> dict:
    """Celery entry point — dispatch a submission for evaluation."""
    with sync_session() as session:
        return _run_submission_evaluation(session, UUID(submission_id), api_key=api_key)
