"""OAuth2 (GitHub) flow tests — mocked GitHub HTTP, real in-memory DB."""

import uuid

import httpx
import pytest
from httpx import AsyncClient, MockTransport

from app.services.oauth import GithubOAuthClient, sign_oauth_state

AUTHORIZE_URL = "/api/auth/oauth/github/authorize"
CALLBACK_URL = "/api/auth/oauth/github/callback"

GITHUB_ID = 12345678
GITHUB_LOGIN = "octocat"

PROFILE = {
    "id": GITHUB_ID,
    "login": GITHUB_LOGIN,
    "name": "Octo Cat",
    "email": "octocat@example.com",
    "avatar_url": "https://avatars.githubusercontent.com/u/12345678",
}


class FakeGithubClient:
    """Pretends to be GithubOAuthClient with a configurable profile."""

    def __init__(self, profile: dict | None = None, error: str | None = None) -> None:
        self._profile = profile if profile is not None else PROFILE
        self._error = error

    async def authorize_user(self, code: str) -> dict:
        if self._error:
            from app.services.oauth import OAuthProviderError

            raise OAuthProviderError(self._error)
        return self._profile


async def _enable_github(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "github_client_id", "test-client-id")
    monkeypatch.setattr(settings, "github_client_secret", "test-client-secret")
    monkeypatch.setattr(settings, "oauth_callback_url", "http://localhost:5173/auth/callback")


def _sign_state() -> str:
    return sign_oauth_state("github", uuid.uuid4().hex)


@pytest.mark.asyncio
async def test_authorize_returns_github_url(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    response = await db_client.get(AUTHORIZE_URL)
    assert response.status_code == 200
    body = response.json()
    assert "github.com/login/oauth/authorize" in body["authorization_url"]
    assert "client_id=test-client-id" in body["authorization_url"]
    assert "redirect_uri=" in body["authorization_url"]
    assert body["state"]


@pytest.mark.asyncio
async def test_authorize_unsupported_provider(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    response = await db_client.get("/api/auth/oauth/gitlab/authorize")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_authorize_not_configured(db_client: AsyncClient) -> None:
    """503 when the server has no GitHub credentials configured."""
    response = await db_client.get(AUTHORIZE_URL)
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_callback_provisions_new_user(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(oauth_module, "GithubOAuthClient", lambda: FakeGithubClient())

    response = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "octocat@example.com"
    assert body["user"]["username"] == "octocat"
    assert "hashed_password" not in body["user"]

    # Second login returns the SAME account (no duplicate provisioning).
    again = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert again.status_code == 200
    assert again.json()["user"]["id"] == body["user"]["id"]


@pytest.mark.asyncio
async def test_callback_links_to_existing_oauth_identity(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A changed email still resolves to the same user via oauth_id."""
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(oauth_module, "GithubOAuthClient", lambda: FakeGithubClient())
    first = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert first.status_code == 200

    # Same GitHub id, different email profile this time.
    monkeypatch.setattr(
        oauth_module,
        "GithubOAuthClient",
        lambda: FakeGithubClient(profile={**PROFILE, "email": "new-email@example.com"}),
    )
    second = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert second.status_code == 200
    assert second.json()["user"]["id"] == first.json()["user"]["id"]


@pytest.mark.asyncio
async def test_callback_email_conflict_with_password_account(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    # A password account already owns the GitHub email.
    register = await db_client.post(
        "/api/auth/register",
        json={
            "email": "octocat@example.com",
            "username": "password_user",
            "password": "password123",
        },
    )
    assert register.status_code == 201

    monkeypatch.setattr(oauth_module, "GithubOAuthClient", lambda: FakeGithubClient())
    response = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_callback_rejects_bad_state(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(oauth_module, "GithubOAuthClient", lambda: FakeGithubClient())
    response = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": "tampered"})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_callback_rejects_state_for_other_provider(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(oauth_module, "GithubOAuthClient", lambda: FakeGithubClient())
    other_state = sign_oauth_state("gitlab", uuid.uuid4().hex)
    response = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": other_state})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_callback_rejects_bad_code(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(
        oauth_module,
        "GithubOAuthClient",
        lambda: FakeGithubClient(error="bad_verification_code"),
    )
    response = await db_client.get(CALLBACK_URL, params={"code": "bad", "state": _sign_state()})
    assert response.status_code == 400
    assert "GitHub authorization failed" in response.json()["detail"]


@pytest.mark.asyncio
async def test_callback_not_configured(db_client: AsyncClient) -> None:
    response = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_oauth_user_cannot_use_password_login(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(oauth_module, "GithubOAuthClient", lambda: FakeGithubClient())
    created = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert created.status_code == 200

    login = await db_client.post(
        "/api/auth/login",
        json={"identifier": "octocat@example.com", "password": "whatever"},
    )
    assert login.status_code == 401


@pytest.mark.asyncio
async def test_oauth_user_cannot_change_password(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(oauth_module, "GithubOAuthClient", lambda: FakeGithubClient())
    created = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert created.status_code == 200

    response = await db_client.post(
        "/api/auth/change-password",
        json={"current_password": "whatever", "new_password": "newpassword456"},
        headers={"Authorization": f"Bearer {created.json()['access_token']}"},
    )
    assert response.status_code == 400
    assert "OAuth login" in response.json()["detail"]


@pytest.mark.asyncio
async def test_callback_private_email_falls_back_to_noreply(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(
        oauth_module,
        "GithubOAuthClient",
        lambda: FakeGithubClient(profile={**PROFILE, "email": None}),
    )
    response = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert response.status_code == 200
    assert response.json()["user"]["email"] == f"{GITHUB_ID}@users.noreply.github.com"


@pytest.mark.asyncio
async def test_sanitize_username_with_invalid_chars(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _enable_github(monkeypatch)
    import app.api.oauth as oauth_module

    monkeypatch.setattr(
        oauth_module,
        "GithubOAuthClient",
        lambda: FakeGithubClient(profile={**PROFILE, "login": "octo-cat-2"}),
    )
    response = await db_client.get(CALLBACK_URL, params={"code": "abc123", "state": _sign_state()})
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "octo_cat_2"


# --- GithubOAuthClient unit tests (real HTTP logic, mocked transport) ---


def _mock_client(profile: dict, emails: list[dict] | None = None) -> GithubOAuthClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/login/oauth/access_token":
            return httpx.Response(200, json={"access_token": "gho_test_token"})
        if request.url.path == "/user/emails":
            return httpx.Response(200, json=emails or [])
        if request.url.path == "/user":
            return httpx.Response(200, json=profile)
        return httpx.Response(404, json={"message": "not found"})

    return GithubOAuthClient(transport=MockTransport(handler))


@pytest.mark.asyncio
async def test_github_client_exchanges_code_and_fetches_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "github_client_id", "cid")
    monkeypatch.setattr(settings, "github_client_secret", "csecret")

    client = _mock_client({**PROFILE, "email": "octocat@example.com"})
    profile = await client.authorize_user("the-code")
    assert profile["login"] == "octocat"
    assert profile["email"] == "octocat@example.com"


@pytest.mark.asyncio
async def test_github_client_uses_primary_email_when_public_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "github_client_id", "cid")
    monkeypatch.setattr(settings, "github_client_secret", "csecret")

    client = _mock_client(
        {**PROFILE, "email": None},
        emails=[
            {"email": "side@example.com", "primary": False, "verified": True},
            {"email": "primary@example.com", "primary": True, "verified": True},
        ],
    )
    profile = await client.authorize_user("the-code")
    assert profile["email"] == "primary@example.com"


@pytest.mark.asyncio
async def test_github_client_rejects_bad_code(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.oauth import OAuthProviderError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "error": "bad_verification_code",
                "error_description": "The code passed is incorrect",
            },
        )

    from app.config import settings
    from app.services.oauth import GithubOAuthClient

    monkeypatch.setattr(settings, "github_client_id", "cid")
    monkeypatch.setattr(settings, "github_client_secret", "csecret")

    client = GithubOAuthClient(transport=MockTransport(handler))
    with pytest.raises(OAuthProviderError, match="incorrect"):
        await client.authorize_user("bad")


@pytest.mark.asyncio
async def test_github_client_rejects_missing_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import settings
    from app.services.oauth import GithubOAuthClient, OAuthProviderError

    monkeypatch.setattr(settings, "github_client_id", "")
    monkeypatch.setattr(settings, "github_client_secret", "")
    client = GithubOAuthClient()
    with pytest.raises(OAuthProviderError, match="not configured"):
        await client.authorize_user("code")
