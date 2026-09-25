"""OAuth2 client support (authorization-code flow).

Currently supports GitHub; the provider registry is intentionally small and
data-driven so other providers (Google, GitLab, ...) can be added by
registering a client class in ``PROVIDER_CLIENTS``.

State nonces are signed JWTs (reusing the app's JWT secret) so the callback
can trust that the ``state`` parameter was issued by us, which prevents
login-CSRF attacks.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.config import settings

#: Providers the platform can authenticate with (OAuth2 authorization-code flow).
SUPPORTED_OAUTH_PROVIDERS = frozenset({"github"})

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_USER_URL = "https://api.github.com/user"
GITHUB_API_EMAILS_URL = "https://api.github.com/user/emails"

_GITHUB_SCOPE = "read:user user:email"
_USERNAME_RE = re.compile(r"[^a-zA-Z0-9_]")


class OAuthProviderError(Exception):
    """Raised when the OAuth provider rejects the flow (bad code, etc.)."""


def sign_oauth_state(provider: str, nonce: str) -> str:
    """Sign an OAuth state nonce so the callback can verify it was ours."""
    now = datetime.now(UTC)
    payload = {
        "oauth_provider": provider,
        "nonce": nonce,
        "iat": now,
        "exp": now + timedelta(minutes=settings.oauth_state_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_oauth_state(state: str, provider: str) -> None:
    """Verify a signed OAuth state for the expected provider.

    Raises ``OAuthProviderError`` when the state is missing, malformed,
    expired, or was issued for a different provider.
    """
    try:
        payload = jwt.decode(
            state,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError as exc:
        raise OAuthProviderError("Invalid or expired OAuth state") from exc
    if payload.get("oauth_provider") != provider:
        raise OAuthProviderError("OAuth state was issued for another provider")


def build_github_authorize_url(state: str) -> str:
    """Build the GitHub authorization URL with the signed state attached."""
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.oauth_callback_url,
        "scope": _GITHUB_SCOPE,
        "state": state,
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


def sanitize_username(login: str, fallback: str) -> str:
    """Turn a provider login into a platform username (``[a-zA-Z0-9_]``)."""
    cleaned = _USERNAME_RE.sub("_", login or "").strip("_")
    return (cleaned or fallback)[:50]


class GithubOAuthClient:
    """Minimal GitHub OAuth2 client (authorization-code flow).

    ``transport`` is injectable for tests (``httpx.MockTransport``); it is
    reused across the token exchange and profile/email lookups so a single
    mock can serve the whole conversation.
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.client_id = settings.github_client_id
        self.client_secret = settings.github_client_secret
        self._transport = transport

    async def authorize_user(self, code: str) -> dict[str, Any]:
        """Exchange an authorization code and return the user profile.

        Returns a dict with at least ``id``, ``login``, and ``email`` (the
        primary verified address, falling back to the public profile email).
        """
        if not self.client_id or not self.client_secret:
            raise OAuthProviderError("GitHub OAuth is not configured")

        transport = self._transport or httpx.AsyncHTTPTransport()
        headers = {"Accept": "application/json"}
        async with httpx.AsyncClient(transport=transport, timeout=10) as client:
            token_resp = await client.post(
                GITHUB_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                },
                headers=headers,
            )
            try:
                token_data = token_resp.json()
            except ValueError as exc:  # non-JSON body (e.g. error page)
                raise OAuthProviderError("GitHub token exchange failed") from exc
            access_token = token_data.get("access_token")
            if not access_token:
                detail = (
                    token_data.get("error_description")
                    or token_data.get("error")
                    or "GitHub token exchange failed"
                )
                raise OAuthProviderError(str(detail))

            api_headers = {
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
            user_resp = await client.get(GITHUB_API_USER_URL, headers=api_headers)
            user_resp.raise_for_status()
            profile = user_resp.json()

            if not profile.get("email"):
                emails_resp = await client.get(GITHUB_API_EMAILS_URL, headers=api_headers)
                emails_resp.raise_for_status()
                primary = next(
                    (
                        item
                        for item in emails_resp.json()
                        if item.get("primary") and item.get("verified")
                    ),
                    None,
                )
                profile["email"] = (primary or {}).get("email")

        return profile
