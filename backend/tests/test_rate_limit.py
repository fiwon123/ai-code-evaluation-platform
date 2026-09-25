import time
import types
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.core import rate_limit as rate_limit_module
from app.core.database import Base

CHALLENGES_URL = "/api/challenges"

# Comfortably inside the 60s window rather than on a boundary.
PINNED_NOW = 1_000_090.0


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


class _PinnedClock:
    """Stand-in for the limiter's ``time.time()``, movable on demand."""

    def __init__(self, now: float) -> None:
        self.now = now

    def advance(self, seconds: float) -> float:
        """Move the clock forward and return the new reading."""
        self.now += seconds
        return self.now


@pytest.fixture
def pinned_clock(monkeypatch: pytest.MonkeyPatch) -> _PinnedClock:
    """Freeze the wall clock the rate limiter buckets its counters on.

    ``RateLimiter.is_allowed`` keys on ``int(time.time() // window)``, so a test
    that spends a request over quota is racing the real clock: land the two
    requests in different windows and the second one gets a fresh key, counts as
    #1, and is allowed. That is the flake in #193, and pinning the clock is the
    fix — the quota assertions then hold no matter when the suite runs.

    Only ``app.core.rate_limit``'s own ``time`` name is rebound, so the stdlib
    module (and every other component in the process) keeps a real clock.
    """
    clock = _PinnedClock(PINNED_NOW)
    monkeypatch.setattr(
        rate_limit_module, "time", types.SimpleNamespace(time=lambda: clock.now)
    )
    return clock


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
    pinned_clock: _PinnedClock,
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
    # The counter really is keyed on the pinned clock, not the wall clock.
    bucket = int(pinned_clock.now // settings.rate_limit_window_seconds)
    assert all(key.endswith(f":{bucket}") for key in counts)


@pytest.mark.parametrize(
    "now",
    [
        pytest.param(1_000_080.0, id="exactly-on-a-boundary"),
        pytest.param(1_000_080.001, id="just-after-a-boundary"),
        pytest.param(1_000_090.0, id="mid-window"),
        pytest.param(1_000_139.999, id="last-millisecond-of-window"),
    ],
)
@pytest.mark.asyncio
async def test_rate_limit_quota_holds_at_any_point_in_the_window(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
    pinned_clock: _PinnedClock,
    now: float,
) -> None:
    """The quota assertions must not depend on where the clock sits in the window.

    The original flake fired when a test happened to start a millisecond before a
    boundary, because the *next* request rolled into a fresh bucket. With the
    clock pinned, starting anywhere — including exactly on a boundary — must give
    the same answer.
    """
    ac, redis = rate_limit_db_client
    pinned_clock.now = now
    monkeypatch.setattr(settings, "rate_limit_anonymous_limit", 1)
    redis.incr, counts = make_counting_incr()

    assert (await ac.get(CHALLENGES_URL)).status_code == 200
    assert (await ac.get(CHALLENGES_URL)).status_code == 429
    assert len(counts) == 1, "a pinned clock must keep both requests in one bucket"


@pytest.mark.asyncio
async def test_rate_limit_window_rolls_over_when_the_clock_advances(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
    pinned_clock: _PinnedClock,
) -> None:
    """Crossing a window boundary really does reset the quota.

    This is the root cause of the #193 flake, pinned down deterministically: the
    limiter is a fixed window, so a real clock crossing a boundary mid-test turns
    the over-quota request back into a 200. That is correct production
    behaviour — which is exactly why the quota tests above pin the clock instead
    of asserting against a moving one.

    If this stops holding, the limiter is no longer a fixed window and the
    rationale behind ``pinned_clock`` needs revisiting.
    """
    ac, redis = rate_limit_db_client
    monkeypatch.setattr(settings, "rate_limit_anonymous_limit", 1)
    redis.incr, counts = make_counting_incr()

    # Only the limiter's clock is pinned; the process keeps a real one. Patching
    # ``time.time`` globally would freeze log timestamps, DB bookkeeping and
    # anything else that reads the clock mid-test.
    assert time.time() != pinned_clock.now

    assert (await ac.get(CHALLENGES_URL)).status_code == 200
    assert (await ac.get(CHALLENGES_URL)).status_code == 429

    # Just before the window rolls over, the quota still holds...
    window = settings.rate_limit_window_seconds
    bucket_end = (int(pinned_clock.now // window) + 1) * window
    pinned_clock.now = bucket_end - 0.001
    assert (await ac.get(CHALLENGES_URL)).status_code == 429

    # ...and a fresh window starts counting from scratch.
    pinned_clock.advance(0.002)
    assert (await ac.get(CHALLENGES_URL)).status_code == 200
    assert len(counts) == 2, "the rollover must have used a second bucket key"


@pytest.mark.asyncio
async def test_rate_limit_429_includes_retry_after_header(
    rate_limit_db_client: tuple[AsyncClient, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
    pinned_clock: _PinnedClock,
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
    pinned_clock: _PinnedClock,
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
