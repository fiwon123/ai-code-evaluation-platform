"""Celery task that generates code via an LLM provider and runs the test suite."""

from __future__ import annotations

import logging
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.database import sync_session
from app.core.events import publish_submission_event
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.services.evaluation import evaluate_code
from app.services.llm import get_llm_provider

logger = logging.getLogger(__name__)


def _run_submission_evaluation(session: Session, submission_id: UUID) -> dict:
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
    workdir = Path("/tmp/evaluations") / str(submission.id)

    try:
        provider = get_llm_provider(provider_name)
        code = provider.generate_code(challenge.prompt, challenge.language)
        submission.code = code
        session.commit()
        publish_submission_event(submission.id, "code_generated")

        outcome = evaluate_code(
            code=code,
            test_code=challenge.test_code,
            language=challenge.language,
            workdir=workdir,
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001 - worker must never crash silently
        logger.exception("Evaluation failed for submission %s", submission.id)
        result = EvaluationResult(
            submission_id=submission.id,
            passed_tests=0,
            total_tests=0,
            score=0.0,
            logs=f"Evaluation error: {exc}",
            metrics={"error": str(exc)},
        )
        session.add(result)
        submission.status = "failed"
        submission.score = 0.0
        session.commit()
        publish_submission_event(submission.id, "failed", error=str(exc))
        return {"status": "failed", "error": str(exc)}

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
def evaluate_submission(submission_id: str) -> dict:
    """Celery entry point — dispatch a submission for evaluation."""
    with sync_session() as session:
        return _run_submission_evaluation(session, UUID(submission_id))
