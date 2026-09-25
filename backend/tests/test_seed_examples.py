"""Tests for the curated example-challenge seeder."""

from collections import Counter

from sqlalchemy import func, select

from app.core.security import hash_password
from app.models.challenge import Challenge
from app.models.user import User
from app.services.example_challenges import (
    EXAMPLE_CHALLENGES,
    EXAMPLES_EMAIL,
    EXAMPLES_USERNAME,
    SeedResult,
    seed_example_challenges,
)

SUPPORTED_LANGUAGES = {"python", "javascript", "typescript", "java", "go"}


async def _count_rows(session, model) -> int:
    result = await session.execute(select(func.count()).select_from(model))
    return result.scalar_one()


async def _find(session, model, **fields):
    result = await session.execute(select(model).filter_by(**fields))
    return result.scalars().first()


def test_catalog_shape():
    """The catalog holds 3 curated examples per supported language."""
    by_language = Counter(entry["language"] for entry in EXAMPLE_CHALLENGES)

    assert len(EXAMPLE_CHALLENGES) == 15
    assert set(by_language) == SUPPORTED_LANGUAGES
    for language in SUPPORTED_LANGUAGES:
        assert by_language[language] == 3

    for entry in EXAMPLE_CHALLENGES:
        assert entry["title"] in {
            "Two Sum",
            "Valid Parentheses",
            "Longest Common Prefix",
        }
        for field in ("description", "prompt", "test_code"):
            assert entry[field].strip(), f"missing {field!r} in {entry['title']}"


async def test_seeds_all_examples_and_system_user(db_sessionmaker):
    """First run creates the system owner plus all 15 example challenges."""
    async with db_sessionmaker() as session:
        result = await seed_example_challenges(session)

        assert result == SeedResult(created=15, updated=0)
        assert await _count_rows(session, Challenge) == 15

        owner = await _find(session, User, username=EXAMPLES_USERNAME)
        assert owner is not None
        assert owner.email == EXAMPLES_EMAIL
        assert owner.is_active is False  # never meant to log in
        assert owner.hashed_password  # bcrypt hash of a discarded random token
        assert (await _count_rows(session, User)) == 1

        # Every challenge belongs to the system owner.
        user_ids = set()
        challenges = (await session.execute(select(Challenge))).scalars().all()
        for challenge in challenges:
            user_ids.add(challenge.user_id)
            assert challenge.language in SUPPORTED_LANGUAGES
        assert user_ids == {owner.id}


async def test_seed_is_idempotent(db_sessionmaker):
    """Re-running creates nothing and refreshes nothing."""
    async with db_sessionmaker() as session:
        first = await seed_example_challenges(session)
        assert first.created == 15

    async with db_sessionmaker() as session:
        second = await seed_example_challenges(session)
        assert second == SeedResult(created=0, updated=0)
        assert await _count_rows(session, Challenge) == 15
        assert await _count_rows(session, User) == 1


async def test_upsert_refreshes_changed_catalog_fields(db_sessionmaker, monkeypatch):
    """Catalog edits propagate to existing system-owned rows on re-seed."""
    async with db_sessionmaker() as session:
        await seed_example_challenges(session)

    # Simulate a catalog edit (e.g. a prompt rewrite).
    patched = [dict(entry) for entry in EXAMPLE_CHALLENGES]
    patched[0]["prompt"] = "NEW prompt for the first example"
    patched[0]["test_code"] = "assert True  # NEW tests"
    monkeypatch.setattr("app.services.example_challenges.EXAMPLE_CHALLENGES", patched)

    async with db_sessionmaker() as session:
        result = await seed_example_challenges(session)
        assert result == SeedResult(created=0, updated=1)

        first = await _find(
            session,
            Challenge,
            language=patched[0]["language"],
            title=patched[0]["title"],
        )
        assert first.prompt == "NEW prompt for the first example"
        assert first.test_code == "assert True  # NEW tests"


async def test_never_touches_user_owned_challenges(db_sessionmaker):
    """Regular users' challenges stay untouched even with matching titles."""
    async with db_sessionmaker() as session:
        user = User(
            username="alice",
            email="alice@example.com",
            hashed_password=hash_password("super-secret-password"),
        )
        session.add(user)
        await session.flush()

        user_challenge = Challenge(
            user_id=user.id,
            title="Two Sum",
            description="alice's remix",
            prompt="alice's custom prompt",
            test_code="assert two_sum([1, 1], 2) == [0, 1]",
            language="python",
        )
        session.add(user_challenge)
        await session.commit()

        result = await seed_example_challenges(session)
        assert result.created == 15  # system rows created alongside

        # User row is untouched.
        refreshed = await session.get(Challenge, user_challenge.id)
        assert refreshed.prompt == "alice's custom prompt"

        # And the system own row exists separately with the catalog content.
        owner = await _find(session, User, username=EXAMPLES_USERNAME)
        system = await _find(
            session,
            Challenge,
            user_id=owner.id,
            language="python",
            title="Two Sum",
        )
        assert system is not None
        assert system.user_id != user.id
        assert "indices of the two numbers" in system.prompt

        assert await _count_rows(session, Challenge) == 16
        assert await _count_rows(session, User) == 2


async def test_examples_are_playable_with_demo_provider():
    """Every seeded prompt resolves to a canned demo solution (not a fallback)."""
    from app.services.llm_providers.mock_provider import (
        DEFAULT_SOLUTIONS,
        MockProvider,
    )

    provider = MockProvider()
    for entry in EXAMPLE_CHALLENGES:
        code = provider.generate_code(entry["prompt"], language=entry["language"])
        expected_fallback = DEFAULT_SOLUTIONS[entry["language"]]
        assert code != expected_fallback, (
            f"{entry['language']} example {entry['title']!r} fell back to the "
            "default solution — catalog and demo provider are out of sync"
        )


def _spy_seeder(monkeypatch, calls):
    """Replace the seeder with a spy recording its invocations."""

    async def fake_seed(session):
        calls.append(session)
        return SeedResult(created=15, updated=0)

    monkeypatch.setattr("app.services.example_challenges.seed_example_challenges", fake_seed)


def test_lifespan_seeds_when_enabled(monkeypatch):
    """Startup auto-seeding runs when SEED_EXAMPLES is on."""
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import create_app

    calls: list = []
    _spy_seeder(monkeypatch, calls)

    monkeypatch.setattr(settings, "seed_examples", True)
    with TestClient(create_app()):
        pass

    assert len(calls) == 1


def test_lifespan_skips_seeding_when_disabled(monkeypatch):
    """Startup auto-seeding is skipped when SEED_EXAMPLES is off."""
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import create_app

    calls: list = []
    _spy_seeder(monkeypatch, calls)

    monkeypatch.setattr(settings, "seed_examples", False)
    with TestClient(create_app()):
        pass

    assert calls == []


def test_lifespan_survives_seed_failure(monkeypatch):
    """A failing seeder never blocks application boot (non-fatal)."""
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import create_app

    async def broken_seed(session):
        raise RuntimeError("database unreachable")

    monkeypatch.setattr("app.services.example_challenges.seed_example_challenges", broken_seed)
    monkeypatch.setattr(settings, "seed_examples", True)
    with TestClient(create_app()):
        pass  # boot must succeed despite the failure
