from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.pagination import paginate
from app.core.database import get_session
from app.core.security import require_admin
from app.models.challenge import Challenge
from app.models.submission import Submission
from app.models.user import User
from app.schemas.challenge import ChallengeRead
from app.schemas.pagination import PaginatedResponse
from app.schemas.submission import SubmissionRead
from app.schemas.user import AdminUserUpdate, PlatformStats, UserRead

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


@router.get("/submissions", response_model=PaginatedResponse[SubmissionRead])
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
) -> PaginatedResponse[SubmissionRead]:
    """List every submission on the platform (admin only)."""
    base = (
        select(Submission)
        .options(selectinload(Submission.evaluation_result))
        .order_by(Submission.created_at.desc())
    )
    if status_filter:
        base = base.where(Submission.status == status_filter)

    orm_items, total, pages = await paginate(db, base, page=page, page_size=page_size)
    items = [SubmissionRead.model_validate(item) for item in orm_items]

    return PaginatedResponse[SubmissionRead](
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
        select(func.count())
        .select_from(Submission)
        .where(Submission.status == "completed")
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

    return PlatformStats(
        total_users=users_result.scalar_one(),
        total_challenges=challenges_result.scalar_one(),
        total_submissions=submissions_result.scalar_one(),
        completed_submissions=completed_result.scalar_one(),
        failed_submissions=failed_result.scalar_one(),
        pending_submissions=pending_result.scalar_one(),
        average_score=avg_result.scalar_one(),
    )
