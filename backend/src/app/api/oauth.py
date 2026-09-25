"""OAuth2 authentication routes (GitHub authorization-code flow).

Flow:
    browser → GET /api/auth/oauth/{provider}/authorize  (returns GitHub URL)
    browser → GitHub → redirect to /auth/callback?code=..&state=..
    frontend → GET /api/auth/oauth/{provider}/callback?code=..&state=..
             → (code exchange + profile fetch + account provisioning)
             → TokenResponse (standard JWT, same as password login)
"""

import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import _build_token_response
from app.config import settings
from app.core.database import get_session
from app.models.user import User
from app.schemas.auth import OAuthAuthorizeResponse, TokenResponse
from app.services.oauth import (
    SUPPORTED_OAUTH_PROVIDERS,
    GithubOAuthClient,
    OAuthProviderError,
    build_github_authorize_url,
    sanitize_username,
    sign_oauth_state,
    verify_oauth_state,
)

router = APIRouter()

_GITHUB_NOREPLY_EMAIL = "{}@users.noreply.github.com"


def _ensure_github_configured() -> None:
    """Raise 503 when GitHub OAuth credentials are not configured."""
    if not settings.github_client_id or not settings.github_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub OAuth is not configured on this server",
        )


async def _unique_username(db: AsyncSession, base: str) -> str:
    """Return ``base`` suffixed with a counter/hex until it's free."""
    candidate = base
    for _ in range(100):
        existing = await db.execute(select(User).where(User.username == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base[:44]}_{uuid.uuid4().hex[:5]}"
    return f"user_{uuid.uuid4().hex[:8]}"


async def _unique_email(db: AsyncSession, base: str) -> str:
    """Return ``base`` suffixed until it's free (noreply fallback collisions)."""
    candidate = base
    for _ in range(100):
        existing = await db.execute(select(User).where(User.email == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base[:240]}_{uuid.uuid4().hex[:8]}@users.noreply.github.com"
    return f"{uuid.uuid4().hex[:10]}@users.noreply.github.com"


async def _upsert_oauth_user(
    db: AsyncSession,
    provider: str,
    profile: dict,
) -> User:
    """Return the platform user for a provider profile, provisioning on first login.

    Lookup is by the provider identity (``oauth_id``) — the stable key. A
    verified provider email that matches an existing *password* account is
    rejected (409) rather than silently linked, so an attacker can't take
    over an account through a GitHub identity they control.
    """
    oauth_id = str(profile["id"])
    result = await db.execute(
        select(User).where(
            User.oauth_provider == provider,
            User.oauth_id == oauth_id,
        )
    )
    user = result.scalar_one_or_none()
    if user is not None:
        await db.commit()
        return user

    email = profile.get("email") or _GITHUB_NOREPLY_EMAIL.format(oauth_id)
    conflict = await db.execute(select(User).where(User.email == email))
    existing = conflict.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "An account with this email already exists. "
                "Log in with your password and link your GitHub account from your profile."
            ),
        )

    fallback = f"user_{uuid.uuid4().hex[:6]}"
    username = await _unique_username(db, sanitize_username(profile.get("login"), fallback))
    email = await _unique_email(db, email)

    user = User(
        email=email,
        username=username,
        hashed_password=None,
        oauth_provider=provider,
        oauth_id=oauth_id,
        avatar_url=str(profile.get("avatar_url")) if profile.get("avatar_url") else None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/{provider}/authorize", response_model=OAuthAuthorizeResponse)
async def oauth_authorize(provider: str) -> OAuthAuthorizeResponse:
    """Start the OAuth flow — returns the provider's authorization URL."""
    if provider not in SUPPORTED_OAUTH_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported OAuth provider '{provider}'",
        )
    if provider == "github":
        _ensure_github_configured()

    state = sign_oauth_state(provider, uuid.uuid4().hex)
    authorization_url = build_github_authorize_url(state)
    return OAuthAuthorizeResponse(authorization_url=authorization_url, state=state)


@router.get("/{provider}/callback", response_model=TokenResponse)
async def oauth_callback(
    provider: str,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Exchange the authorization code for a profile and issue a JWT."""
    if provider not in SUPPORTED_OAUTH_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported OAuth provider '{provider}'",
        )
    if provider == "github":
        _ensure_github_configured()

    try:
        verify_oauth_state(state, provider)
    except OAuthProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    client = GithubOAuthClient()
    try:
        profile = await client.authorize_user(code)
    except OAuthProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"GitHub authorization failed: {exc}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to reach GitHub",
        ) from exc

    user = await _upsert_oauth_user(db, provider, profile)
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account deactivated",
        )
    return await _build_token_response(user)
