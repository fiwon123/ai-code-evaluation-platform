from math import ceil
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import get_current_user
from app.models.challenge import Challenge
from app.models.user import User
from app.schemas.challenge import ChallengeCreate, ChallengeRead, ChallengeUpdate
from app.schemas.pagination import PaginatedResponse

router = APIRouter()


async def _get_challenge_or_404(db: AsyncSession, challenge_id: UUID) -> Challenge:
    """Fetch a challenge by id or raise 404."""
    result = await db.execute(select(Challenge).where(Challenge.id == challenge_id))
    challenge = result.scalar_one_or_none()
    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Challenge not found",
        )
    return challenge


@router.get("", response_model=PaginatedResponse[ChallengeRead])
async def list_challenges(
    page: int = Query(default=1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    search: str | None = Query(
        default=None, max_length=255, description="Search title/description"
    ),
    language: str | None = Query(
        default=None, max_length=50, description="Filter by language"
    ),
    owner_id: UUID | None = Query(
        default=None, description="Filter by owner (public challenges)"
    ),
    db: AsyncSession = Depends(get_session),
) -> PaginatedResponse[ChallengeRead]:
    """List all challenges (public) with search, filter, and pagination."""
    filters = []
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                Challenge.title.ilike(pattern),
                Challenge.description.ilike(pattern),
            )
        )
    if language:
        filters.append(Challenge.language == language)
    if owner_id:
        filters.append(Challenge.user_id == owner_id)

    base = select(Challenge)
    if filters:
        base = base.where(*filters)

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar_one()

    items_result = await db.execute(
        base.order_by(Challenge.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    orm_items = list(items_result.scalars().all())
    items = [ChallengeRead.model_validate(item) for item in orm_items]

    return PaginatedResponse[ChallengeRead](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=ceil(total / page_size) if total else 0,
    )


@router.post("", response_model=ChallengeRead, status_code=status.HTTP_201_CREATED)
async def create_challenge(
    payload: ChallengeCreate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Challenge:
    """Create a new challenge owned by the authenticated user."""
    challenge = Challenge(
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        prompt=payload.prompt,
        test_code=payload.test_code,
        language=payload.language,
    )
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)
    return challenge


@router.get("/{challenge_id}", response_model=ChallengeRead)
async def get_challenge(
    challenge_id: UUID,
    db: AsyncSession = Depends(get_session),
) -> Challenge:
    """Fetch a single challenge (public)."""
    return await _get_challenge_or_404(db, challenge_id)


@router.patch("/{challenge_id}", response_model=ChallengeRead)
async def update_challenge(
    challenge_id: UUID,
    payload: ChallengeUpdate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Challenge:
    """Update a challenge (owner only)."""
    challenge = await _get_challenge_or_404(db, challenge_id)
    if challenge.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to modify this challenge",
        )

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No fields to update",
        )
    for field, value in updates.items():
        setattr(challenge, field, value)

    await db.commit()
    await db.refresh(challenge)
    return challenge


@router.delete("/{challenge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_challenge(
    challenge_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a challenge (owner only)."""
    challenge = await _get_challenge_or_404(db, challenge_id)
    if challenge.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to delete this challenge",
        )

    await db.delete(challenge)
    await db.commit()
