from pydantic import BaseModel

from app.schemas.user import UserRead


class TokenResponse(BaseModel):
    """JWT access token plus the authenticated user."""

    access_token: str
    token_type: str = "bearer"
    user: UserRead
