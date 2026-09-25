from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.core.database import Base

CHALLENGES_URL = "/api/challenges"


@pytest_asyncio.fixture
async def rate_limit_db_client() -> AsyncGenerator[tuple[AsyncClient, AsyncMock]]:
    """SQLite-backed client with a shared mock Redis for rate-limit tests."""
    from app.core.database import get_session
    from app.core.redis import get_redis
    from app.main import create_app

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    redis = AsyncMock()
    redis.expire = AsyncMock(return_value=True)

    app = create_app()

    async def override_get_session() -> AsyncGenerator[AsyncSession]:
        async with session_factory() as session:
            yield session

    async def override_get_redis() -> AsyncMock:
        return redis

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_redis] = override_get_redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac, redis

    await engine.dispose()


def make_counting_incr() -> tuple[AsyncMock, dict[str, int]]:
    """Return an AsyncMock incr that counts per-key, plus the shared counter."""
    counts: dict[str, int] = {}

    async def incr(key: str) -> int:
        counts[key] = counts.get(key, 0) + 1
        return counts[key]

    return AsyncMock(side_effect=incr), counts


@pytest.mark.asyncio
async def test_rate_limit_allows_requests_under_threshold(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
) -> None:
    ac, redis = rate_limit_db_client
    redis.incr = AsyncMock(return_value=1)

    response = await ac.get(CHALLENGES_URL)
    assert response.status_code == 200
    redis.expire.assert_awaited()


@pytest.mark.asyncio
async def test_rate_limit_blocks_anonymous_after_threshold(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ac, redis = rate_limit_db_client
    monkeypatch.setattr(settings, "rate_limit_anonymous_limit", 2)
    redis.incr, counts = make_counting_incr()

    first = await ac.get(CHALLENGES_URL)
    second = await ac.get(CHALLENGES_URL)
    third = await ac.get(CHALLENGES_URL)

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert counts and any(v >= 3 for v in counts.values())


@pytest.mark.asyncio
async def test_rate_limit_429_includes_retry_after_header(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ac, redis = rate_limit_db_client
    monkeypatch.setattr(settings, "rate_limit_anonymous_limit", 1)
    redis.incr, _ = make_counting_incr()

    await ac.get(CHALLENGES_URL)
    blocked = await ac.get(CHALLENGES_URL)

    assert blocked.status_code == 429
    assert blocked.headers.get("retry-after") == str(settings.rate_limit_window_seconds)


@pytest.mark.asyncio
async def test_rate_limit_uses_authenticated_limit(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ac, redis = rate_limit_db_client
    monkeypatch.setattr(settings, "rate_limit_anonymous_limit", 1)
    monkeypatch.setattr(settings, "rate_limit_authenticated_limit", 2)
    redis.incr, _ = make_counting_incr()

    register = await ac.post(
        "/api/auth/register",
        json={
            "email": "alice@example.com",
            "username": "alice_rate",
            "password": "password123",
        },
    )
    assert register.status_code == 201
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Anonymous path is capped at 1 (registration already consumed it)...
    anonymous = await ac.get(CHALLENGES_URL)
    assert anonymous.status_code == 429

    # Authenticated path allows its own limit of 2.
    authed_1 = await ac.get(CHALLENGES_URL, headers=headers)
    authed_2 = await ac.get(CHALLENGES_URL, headers=headers)
    authed_3 = await ac.get(CHALLENGES_URL, headers=headers)

    assert authed_1.status_code == 200
    assert authed_2.status_code == 200
    assert authed_3.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_can_be_disabled(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ac, redis = rate_limit_db_client
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    redis.incr, _ = make_counting_incr()

    # Whatever the counters say, requests proceed when limiting is off.
    response = await ac.get(CHALLENGES_URL)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_rate_limiter_fails_open_when_redis_errors(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ac, redis = rate_limit_db_client
    monkeypatch.setattr(settings, "rate_limit_anonymous_limit", 1)

    async def broken_incr(key: str) -> None:
        raise RuntimeError("redis down")

    redis.incr = AsyncMock(side_effect=broken_incr)

    response = await ac.get(CHALLENGES_URL)
    assert response.status_code == 200
