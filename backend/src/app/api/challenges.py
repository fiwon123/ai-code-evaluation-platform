from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.pagination import paginate
from app.core.database import get_session
from app.core.security import get_current_user
from app.models.challenge import Challenge
from app.models.user import User
from app.schemas.challenge import (
    DIFFICULTIES,
    ChallengeCreate,
    ChallengeRead,
    ChallengeUpdate,
)
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
    language: str | None = Query(default=None, max_length=50, description="Filter by language"),
    difficulty: str | None = Query(default=None, description="Filter by difficulty"),
    sort: str = Query(
        default="newest",
        description="Sort order: 'newest' (default) or 'title'",
    ),
    owner_id: UUID | None = Query(default=None, description="Filter by owner (public challenges)"),
    db: AsyncSession = Depends(get_session),
) -> PaginatedResponse[ChallengeRead]:
    """List all challenges (public) with search, filter, sort, and pagination."""
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
    if difficulty:
        if difficulty not in DIFFICULTIES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Unsupported difficulty '{difficulty}' — supported: {sorted(DIFFICULTIES)}",
            )
        filters.append(Challenge.difficulty == difficulty)
    if owner_id:
        filters.append(Challenge.user_id == owner_id)

    base = select(Challenge)
    if filters:
        base = base.where(*filters)
    if sort == "title":
        base = base.order_by(Challenge.title.asc(), Challenge.created_at.desc())
    else:
        base = base.order_by(Challenge.created_at.desc(), Challenge.id.asc())

    orm_items, total, pages = await paginate(db, base, page=page, page_size=page_size)
    items = [ChallengeRead.model_validate(item) for item in orm_items]

    return PaginatedResponse[ChallengeRead](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
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
        difficulty=payload.difficulty,
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
