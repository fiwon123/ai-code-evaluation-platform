from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# EmailStr requires email-validator; use a plain str with a regex instead to
# avoid adding a dependency for now.


class UserCreate(BaseModel):
    """Payload for registering a new user."""

    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(min_length=8, max_length=72)  # bcrypt limit is 72 bytes


class LoginRequest(BaseModel):
    """Payload for logging in — identifier is an email or username."""

    identifier: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class UserRead(BaseModel):
    """Public user representation."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    username: str
    is_admin: bool = False
    is_active: bool = True
    created_at: datetime


class AdminUserUpdate(BaseModel):
    """Admin payload for updating a user's role or status."""

    is_admin: bool | None = None
    is_active: bool | None = None


class PlatformStats(BaseModel):
    """Platform-wide statistics for the admin dashboard."""

    total_users: int
    total_challenges: int
    total_submissions: int
    completed_submissions: int
    failed_submissions: int
    pending_submissions: int
    average_score: float | None = None
