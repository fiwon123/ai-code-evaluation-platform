from logging import getLogger
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_session
from app.core.security import get_current_user
from app.models.challenge import Challenge
from app.models.submission import Submission
from app.models.user import User
from app.schemas.submission import SubmissionCreate, SubmissionRead, SubmissionUpdate

logger = getLogger(__name__)

router = APIRouter()


def dispatch_evaluation(submission_id: UUID) -> None:
    """Enqueue the background evaluation task.

    The task module may not be importable in early iterations or when the
    Celery broker is unavailable — degrade to a logged warning so the
    submission is still created and returned as pending.
    """
    try:
        from app.tasks.evaluate import evaluate_submission

        evaluate_submission.delay(str(submission_id))
    except Exception:
        logger.exception(
            "Failed to dispatch evaluation for submission %s", submission_id
        )


async def _get_own_submission(
    db: AsyncSession,
    submission_id: UUID,
    user: User,
) -> Submission:
    """Fetch a submission by id and user, with its evaluation result."""
    result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.evaluation_result))
        .where(Submission.id == submission_id, Submission.user_id == user.id)
    )
    submission = result.scalar_one_or_none()
    if submission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found",
        )
    return submission


@router.post("", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
async def create_submission(
    payload: SubmissionCreate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Submission:
    """Create a submission for a challenge and enqueue its evaluation."""
    challenge = await db.get(Challenge, payload.challenge_id)
    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Challenge not found",
        )

    submission = Submission(
        user_id=current_user.id,
        challenge_id=payload.challenge_id,
        status="pending",
        provider=payload.provider,
    )
    db.add(submission)
    await db.commit()

    dispatch_evaluation(submission.id)

    return await _get_own_submission(db, submission.id, current_user)


@router.get("", response_model=list[SubmissionRead])
async def list_submissions(
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[Submission]:
    """List the current user's submissions, newest first."""
    result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.evaluation_result))
        .where(Submission.user_id == current_user.id)
        .order_by(Submission.created_at.desc())
    )
    return list(result.scalars().all())


@router.get("/{submission_id}", response_model=SubmissionRead)
async def get_submission(
    submission_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Submission:
    """Get a single submission (owner only)."""
    return await _get_own_submission(db, submission_id, current_user)


@router.patch("/{submission_id}", response_model=SubmissionRead)
async def update_submission_status(
    submission_id: UUID,
    payload: SubmissionUpdate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Submission:
    """Update a submission's status (owner only, internal transitions)."""
    submission = await _get_own_submission(db, submission_id, current_user)

    submission.status = payload.status
    await db.commit()

    return await _get_own_submission(db, submission_id, current_user)
