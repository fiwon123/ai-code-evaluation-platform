from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.pagination import paginate
from app.core.database import get_session
from app.core.security import require_admin
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User
from app.schemas.challenge import ChallengeRead
from app.schemas.pagination import PaginatedResponse
from app.schemas.submission import AdminSubmissionRead, SubmissionRead
from app.schemas.user import (
    AdminUserUpdate,
    DailySubmissionStat,
    ErrorTypeStat,
    LanguageStat,
    PlatformStats,
    ProviderStat,
    StatusCount,
    TopChallengeStat,
    UserRead,
)

router = APIRouter()


async def _get_user_or_404(db: AsyncSession, user_id: UUID) -> User:
    """Fetch a user by id or raise 404."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user


def _bucket_error(error: str | None) -> str:
    """Group a failure message into a coarse error type for admin stats.

    Preserves the two structured errors produced by the evaluation engine
    (``timeout``, ``executable missing``) and folds everything else into a
    small set of high-signal buckets — auth/quotas surface frequently with
    LLM providers, and anything unrecognized falls back to a generic bucket.
    """
    if not error:
        return "unknown"
    lowered = error.lower()
    if "timeout" in lowered:
        return "timeout"
    if "executable missing" in lowered:
        return "executable missing"
    if "429" in lowered or "rate limit" in lowered:
        return "rate limited"
    if "api key" in lowered or "401" in lowered or "unauthorized" in lowered:
        return "auth failure"
    return "evaluation error"


@router.get("/users", response_model=PaginatedResponse[UserRead])
async def list_users(
    page: int = Query(default=1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    search: str | None = Query(
        default=None, max_length=255, description="Search email or username"
    ),
    db: AsyncSession = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> PaginatedResponse[UserRead]:
    """List all users with optional search and pagination (admin only)."""
    base = select(User).order_by(User.created_at.desc())
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        base = base.where(or_(User.email.ilike(pattern), User.username.ilike(pattern)))

    orm_items, total, pages = await paginate(db, base, page=page, page_size=page_size)
    items = [UserRead.model_validate(item) for item in orm_items]

    return PaginatedResponse[UserRead](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: UUID,
    payload: AdminUserUpdate,
    db: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> User:
    """Update a user's role (is_admin) or status (is_active) — admin only."""
    user = await _get_user_or_404(db, user_id)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No fields to update",
        )

    # Self-protection: an admin must never be able to lock themselves out by
    # demoting or disabling their own account.
    if user.id == admin.id and (
        updates.get("is_admin") is False or updates.get("is_active") is False
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot demote or disable your own account",
        )

    for field, value in updates.items():
        setattr(user, field, value)

    await db.commit()
    await db.refresh(user)
    return user


@router.post("/users/{user_id}/deactivate", response_model=UserRead)
async def deactivate_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> User:
    """Deactivate a user account (admin only)."""
    user = await _get_user_or_404(db, user_id)
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account",
        )
    user.is_active = False
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/users/{user_id}/reactivate", response_model=UserRead)
async def reactivate_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> User:
    """Restore a deactivated user account — re-enables login (admin only)."""
    user = await _get_user_or_404(db, user_id)
    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is already active",
        )
    user.is_active = True
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> None:
    """Permanently delete a user and their data (admin only).

    Cascades to the user's challenges, submissions, and evaluation results.
    """
    user = await _get_user_or_404(db, user_id)
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )

    await db.delete(user)
    await db.commit()


@router.get("/challenges", response_model=PaginatedResponse[ChallengeRead])
async def list_challenges(
    page: int = Query(default=1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    search: str | None = Query(
        default=None, max_length=255, description="Search title/description"
    ),
    db: AsyncSession = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> PaginatedResponse[ChallengeRead]:
    """List every challenge on the platform (admin only)."""
    base = select(Challenge).order_by(Challenge.created_at.desc())
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        base = base.where(
            or_(
                Challenge.title.ilike(pattern),
                Challenge.description.ilike(pattern),
            )
        )

    orm_items, total, pages = await paginate(db, base, page=page, page_size=page_size)
    items = [ChallengeRead.model_validate(item) for item in orm_items]

    return PaginatedResponse[ChallengeRead](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )


@router.delete("/challenges/{challenge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_challenge(
    challenge_id: UUID,
    db: AsyncSession = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> None:
    """Delete any challenge on the platform (admin only)."""
    challenge = await db.get(Challenge, challenge_id)
    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Challenge not found",
        )

    await db.delete(challenge)
    await db.commit()


@router.get("/submissions", response_model=PaginatedResponse[AdminSubmissionRead])
async def list_submissions(
    page: int = Query(default=1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        max_length=20,
        description="Filter by submission status",
    ),
    db: AsyncSession = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> PaginatedResponse[AdminSubmissionRead]:
    """List every submission on the platform (admin only).

    Each row also carries the submitting user's username and the challenge
    title so the admin table stays readable without extra lookups.
    """
    base = (
        select(Submission)
        .options(selectinload(Submission.evaluation_result))
        .order_by(Submission.created_at.desc())
    )
    if status_filter:
        base = base.where(Submission.status == status_filter)

    orm_items, total, pages = await paginate(db, base, page=page, page_size=page_size)

    # Resolve display names for the page in batched lookups, keeping the
    # paged select itself free of joins (so paginate's subquery stays simple).
    user_ids = {item.user_id for item in orm_items}
    challenge_ids = {item.challenge_id for item in orm_items}
    user_rows = await db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
    challenge_rows = await db.execute(
        select(Challenge.id, Challenge.title).where(Challenge.id.in_(challenge_ids))
    )
    usernames = {row[0]: row[1] for row in user_rows}
    titles = {row[0]: row[1] for row in challenge_rows}

    items = []
    for item in orm_items:
        base_data = SubmissionRead.model_validate(item).model_dump()
        items.append(
            AdminSubmissionRead(
                **base_data,
                username=usernames.get(item.user_id, "unknown"),
                challenge_title=titles.get(item.challenge_id, "unknown"),
            )
        )

    return PaginatedResponse[AdminSubmissionRead](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )


@router.get("/stats", response_model=PlatformStats)
async def platform_stats(
    db: AsyncSession = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> PlatformStats:
    """Platform-wide aggregate statistics (admin only)."""
    users_result = await db.execute(select(func.count()).select_from(User))
    challenges_result = await db.execute(select(func.count()).select_from(Challenge))
    submissions_result = await db.execute(select(func.count()).select_from(Submission))
    completed_result = await db.execute(
        select(func.count()).select_from(Submission).where(Submission.status == "completed")
    )
    failed_result = await db.execute(
        select(func.count()).select_from(Submission).where(Submission.status == "failed")
    )
    pending_result = await db.execute(
        select(func.count())
        .select_from(Submission)
        .where(Submission.status.in_(["pending", "processing"]))
    )
    avg_result = await db.execute(
        select(func.avg(Submission.score)).where(Submission.status == "completed")
    )

    # --- Breakdown groups (chart data for the dashboard) ---------------------
    # Counts per status (all six SubmissionStatus values, zero-filled).
    status_rows = (
        await db.execute(
            select(Submission.status, func.count())
            .group_by(Submission.status)
            .where(Submission.status.is_not(None))
        )
    ).all()
    status_counts = {row[0]: row[1] for row in status_rows}
    submissions_by_status = [
        StatusCount(status=s, count=status_counts.get(s, 0))
        for s in ("pending", "processing", "completed", "failed")
    ]

    # Per-language aggregates (null language groups under "").
    lang_rows = (
        await db.execute(
            select(
                func.coalesce(Submission.language, ""),
                func.count(),
                func.avg(Submission.score).filter(Submission.status == "completed"),
            )
            .group_by(Submission.language)
            .order_by(func.count().desc())
        )
    ).all()
    submissions_by_language = [
        LanguageStat(
            language=row[0] or "unknown",
            count=row[1],
            avg_score=row[2],
        )
        for row in lang_rows
    ]

    # Per-provider aggregates: total runs, average completed score, and the
    # share of completed runs that passed every test (score == 100).
    provider_rows = (
        await db.execute(
            select(
                func.coalesce(Submission.provider, ""),
                func.count(),
                func.avg(Submission.score).filter(Submission.status == "completed"),
                func.sum(
                    case(
                        (
                            (Submission.status == "completed") & (Submission.score == 100),
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(case((Submission.status == "completed", 1), else_=0)),
            )
            .group_by(Submission.provider)
            .order_by(func.count().desc())
        )
    ).all()
    submissions_by_provider = [
        ProviderStat(
            provider=row[0] or "unknown",
            count=row[1],
            avg_score=row[2],
            pass_rate=round(row[3] / row[4], 4) if row[4] else 0.0,
        )
        for row in provider_rows
    ]

    # Failed submissions grouped by error type. The structured error lives in
    # each failed submission's evaluation result metrics; failures that never
    # produced a result (e.g. challenge not found) count under "unknown".
    failed_total = (
        await db.execute(
            select(func.count()).select_from(Submission).where(Submission.status == "failed")
        )
    ).scalar_one()
    error_rows = (
        await db.execute(
            select(EvaluationResult.metrics)
            .join(Submission, Submission.id == EvaluationResult.submission_id)
            .where(Submission.status == "failed")
        )
    ).scalars()
    buckets: dict[str, int] = {}
    for metrics in error_rows:
        error = metrics.get("error") if isinstance(metrics, dict) else None
        bucket = _bucket_error(error)
        buckets[bucket] = buckets.get(bucket, 0) + 1
    with_result = sum(buckets.values())
    if failed_total > with_result:
        buckets["unknown"] = buckets.get("unknown", 0) + (failed_total - with_result)
    submissions_by_error_type = [
        ErrorTypeStat(error_type=error_type, count=count)
        for error_type, count in sorted(buckets.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    # Top challenges by run count, with their average completed score.
    top_rows = (
        await db.execute(
            select(
                Submission.challenge_id,
                Challenge.title,
                func.count().label("runs"),
                func.avg(Submission.score).filter(Submission.status == "completed"),
            )
            .join(Challenge, Challenge.id == Submission.challenge_id)
            .group_by(Submission.challenge_id, Challenge.title)
            .order_by(func.count().desc(), Challenge.title)
            .limit(5)
        )
    ).all()
    top_challenges = [
        TopChallengeStat(
            challenge_id=row[0],
            title=row[1],
            runs=row[2],
            avg_score=row[3],
        )
        for row in top_rows
    ]

    # Activity for the last 14 calendar days (UTC), bucketed in Python so the
    # query stays portable across Postgres and sqlite (no date_trunc).
    since = (datetime.now(UTC) - timedelta(days=13)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    recent_rows = (
        await db.execute(
            select(Submission.created_at)
            .where(Submission.created_at >= since)
            .order_by(Submission.created_at)
        )
    ).scalars()
    daily_counts: dict[str, int] = {}
    for created_at in recent_rows:
        day = created_at.astimezone(UTC).date().isoformat() if created_at else None
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + 1
    submissions_last_14_days: list[DailySubmissionStat] = []
    for offset in range(14):
        day = (since + timedelta(days=offset)).date().isoformat()
        submissions_last_14_days.append(
            DailySubmissionStat(date=day, count=daily_counts.get(day, 0))
        )

    return PlatformStats(
        total_users=users_result.scalar_one(),
        total_challenges=challenges_result.scalar_one(),
        total_submissions=submissions_result.scalar_one(),
        completed_submissions=completed_result.scalar_one(),
        failed_submissions=failed_result.scalar_one(),
        pending_submissions=pending_result.scalar_one(),
        average_score=avg_result.scalar_one(),
        submissions_by_status=submissions_by_status,
        submissions_by_language=submissions_by_language,
        submissions_by_provider=submissions_by_provider,
        submissions_by_error_type=submissions_by_error_type,
        top_challenges=top_challenges,
        submissions_last_14_days=submissions_last_14_days,
    )
