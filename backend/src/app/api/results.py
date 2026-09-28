from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.schemas.submission import SharedResultRead

router = APIRouter()


@router.get("/{share_token}", response_model=SharedResultRead)
async def get_shared_result(
    share_token: str,
    db: AsyncSession = Depends(get_session),
) -> SharedResultRead:
    """Public read of a shared evaluation report by its unguessable token.

    Deliberately unauthenticated: this is the link a user hands to someone
    who should not need an account (e.g. a recruiter). Unknown or revoked
    tokens are indistinguishable (404) so revoking works like a key turning.
    """
    result = (
        await db.execute(
            select(EvaluationResult, Submission, Challenge)
            .join(Submission, Submission.id == EvaluationResult.submission_id)
            .join(Challenge, Challenge.id == Submission.challenge_id)
            .where(EvaluationResult.share_token == share_token)
        )
    ).one_or_none()

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shared result not found",
        )

    evaluation, submission, challenge = result
    return SharedResultRead(
        challenge_id=challenge.id,
        challenge_title=challenge.title,
        challenge_prompt=challenge.prompt,
        language=submission.language or challenge.language,
        provider=submission.provider or "demo",
        status=submission.status,
        created_at=submission.created_at,
        code=submission.code,
        score=evaluation.score,
        passed_tests=evaluation.passed_tests,
        total_tests=evaluation.total_tests,
        logs=evaluation.logs,
        logs_summary=evaluation.logs_summary,
        metrics=evaluation.metrics,
        test_results=evaluation.test_results,
    )
