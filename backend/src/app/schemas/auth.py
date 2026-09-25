from pydantic import BaseModel, Field

from app.schemas.user import UserRead


class TokenResponse(BaseModel):
    """JWT access token plus the authenticated user."""

    access_token: str
    token_type: str = "bearer"
    user: UserRead


class OAuthAuthorizeResponse(BaseModel):
    """OAuth authorize step — the provider URL the browser should be sent to."""

    authorization_url: str
    state: str


class ChangePasswordRequest(BaseModel):
    """Payload for changing the current user's password."""

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=72)  # bcrypt limit is 72 bytes
