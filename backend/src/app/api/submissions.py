from logging import getLogger
from secrets import token_urlsafe
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.pagination import paginate
from app.core.database import get_session
from app.core.events import apublish_submission_event
from app.core.security import get_current_user
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User
from app.schemas.pagination import PaginatedResponse
from app.schemas.submission import (
    ProviderComparisonEntry,
    ProviderComparisonRead,
    ShareResultRead,
    SubmissionCreate,
    SubmissionRead,
    SubmissionUpdate,
)

logger = getLogger(__name__)

router = APIRouter()


def dispatch_evaluation(submission_id: UUID, api_key: str | None = None) -> bool:
    """Enqueue the background evaluation task.

    ``api_key`` is an optional per-run LLM key forwarded straight to the
    worker — never persisted on the submission and never logged.

    Returns ``True`` when the task was accepted by the broker. When the
    broker or the task module is unavailable the failure is logged and
    ``False`` returned so callers can surface the error instead of leaving
    the submission stuck in ``pending`` forever.
    """
    try:
        from app.tasks.evaluate import evaluate_submission

        evaluate_submission.delay(str(submission_id), api_key=api_key)
        return True
    except Exception:
        logger.exception("Failed to dispatch evaluation for submission %s", submission_id)
        return False


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
        language=challenge.language,
    )
    db.add(submission)
    await db.commit()

    if not dispatch_evaluation(submission.id, api_key=payload.api_key):
        submission.status = "failed"
        await db.commit()
        await apublish_submission_event(
            submission.id, "failed", error="evaluation dispatch unavailable"
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Evaluation service is unavailable. Please try again later.",
        )

    return await _get_own_submission(db, submission.id, current_user)


@router.get("", response_model=PaginatedResponse[SubmissionRead])
async def list_submissions(
    page: int = Query(default=1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        max_length=20,
        description="Filter by submission status",
    ),
    challenge_id: UUID | None = Query(default=None, description="Filter by challenge"),
    provider: str | None = Query(default=None, max_length=50, description="Filter by LLM provider"),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PaginatedResponse[SubmissionRead]:
    """List the current user's submissions, newest first, with pagination."""
    filters = [Submission.user_id == current_user.id]
    if status_filter:
        filters.append(Submission.status == status_filter)
    if challenge_id:
        filters.append(Submission.challenge_id == challenge_id)
    if provider:
        filters.append(Submission.provider == provider)

    base = (
        select(Submission)
        .options(selectinload(Submission.evaluation_result))
        .where(*filters)
        .order_by(Submission.created_at.desc())
    )

    orm_items, total, pages = await paginate(db, base, page=page, page_size=page_size)
    items = [SubmissionRead.model_validate(item) for item in orm_items]

    return PaginatedResponse[SubmissionRead](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )


@router.get("/comparison", response_model=ProviderComparisonRead)
async def get_provider_comparison(
    challenge_id: UUID = Query(..., description="Challenge to compare providers for"),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ProviderComparisonRead:
    """Aggregate the current user's completed evaluations per provider.

    Lets a challenge page show a side-by-side leaderboard of how each LLM
    provider performed (average score, pass rate, and latency across runs).
    Only the caller's own completed submissions are included.
    """
    rows = (
        await db.execute(
            select(Submission, EvaluationResult)
            .join(EvaluationResult, EvaluationResult.submission_id == Submission.id)
            .where(
                Submission.user_id == current_user.id,
                Submission.challenge_id == challenge_id,
                Submission.status == "completed",
            )
        )
    ).all()

    by_provider: dict[str, list[Submission, EvaluationResult]] = {}
    for submission, result in rows:
        provider = submission.provider or "demo"
        by_provider.setdefault(provider, []).append((submission, result))

    entries: list[ProviderComparisonEntry] = []
    for provider, runs in by_provider.items():
        score = sum(r.score for _, r in runs) / len(runs)
        passed = sum(r.passed_tests for _, r in runs) / len(runs)
        total = sum(r.total_tests for _, r in runs) / len(runs)
        durations = [
            elapsed
            for _, r in runs
            if isinstance((elapsed := r.metrics.get("duration_ms")), (int, float))
        ]
        duration_ms = sum(durations) / len(durations) if durations else 0.0
        last_run_at = max((s.created_at for s, _ in runs))
        entries.append(
            ProviderComparisonEntry(
                provider=provider,
                runs=len(runs),
                score=round(score, 1),
                passed_tests=round(passed, 1),
                total_tests=round(total, 1),
                duration_ms=round(duration_ms, 1),
                last_run_at=last_run_at,
            )
        )

    # Best average score first, then most runs — deterministic for the UI.
    entries.sort(key=lambda e: (-e.score, -e.runs, e.provider))
    return ProviderComparisonRead(challenge_id=challenge_id, entries=entries)


@router.get("/{submission_id}", response_model=SubmissionRead)
async def get_submission(
    submission_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Submission:
    """Get a single submission (owner only)."""
    return await _get_own_submission(db, submission_id, current_user)


@router.post("/{submission_id}/share", response_model=ShareResultRead)
async def share_submission_result(
    submission_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ShareResultRead:
    """Publish a public share link for a completed evaluation (owner only).

    Idempotent: re-sharing an already-shared report returns the same token.
    """
    submission = await _get_own_submission(db, submission_id, current_user)
    result = submission.evaluation_result
    if result is None or submission.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only completed evaluations can be shared",
        )

    if not result.share_token:
        result.share_token = token_urlsafe(16)
        await db.commit()
    return ShareResultRead(share_token=result.share_token)


@router.delete("/{submission_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_submission_share(
    submission_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    """Revoke a public share link (owner only)."""
    submission = await _get_own_submission(db, submission_id, current_user)
    result = submission.evaluation_result
    if result is not None and result.share_token:
        result.share_token = None
        await db.commit()


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
    await apublish_submission_event(submission.id, payload.status)

    return await _get_own_submission(db, submission_id, current_user)
