import uuid
from datetime import UTC

import pytest
from httpx import AsyncClient

SUBMISSIONS_URL = "/api/submissions"
CHALLENGES_URL = "/api/challenges"


async def register_user(client: AsyncClient) -> tuple[str, dict]:
    """Register a user and return (token, user)."""
    payload = {
        "email": f"{uuid.uuid4().hex[:10]}@example.com",
        "username": f"user_{uuid.uuid4().hex[:8]}",
        "password": "password123",
    }
    response = await client.post("/api/auth/register", json=payload)
    assert response.status_code == 201
    body = response.json()
    return body["access_token"], body["user"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def create_challenge(client: AsyncClient, token: str, **overrides) -> dict:
    payload = {
        "title": "Two Sum",
        "description": "Find two numbers that add up to a target.",
        "prompt": "Write two_sum(nums, target).",
        "test_code": "def test_two_sum():\n    assert two_sum([2, 7, 11, 15], 9) == [0, 1]",
        **overrides,
    }
    response = await client.post(
        CHALLENGES_URL,
        json=payload,
        headers=auth(token),
    )
    assert response.status_code == 201
    return response.json()


async def create_submission(
    client: AsyncClient, token: str, challenge_id: str, **overrides
) -> dict:
    response = await client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge_id, **overrides},
        headers=auth(token),
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_create_submission_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": str(uuid.uuid4())},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_submission_unknown_challenge(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": str(uuid.uuid4())},
        headers=auth(token),
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_submission_success(db_client: AsyncClient) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(db_client, token, challenge["id"])

    assert submission["status"] == "pending"
    assert submission["user_id"] == user["id"]
    assert submission["challenge_id"] == challenge["id"]
    assert submission["provider"] is None
    assert submission["code"] is None
    assert submission["evaluation_result"] is None


@pytest.mark.asyncio
async def test_create_submission_with_provider(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(db_client, token, challenge["id"], provider="demo")

    assert submission["provider"] == "demo"


@pytest.mark.asyncio
async def test_create_submission_requires_api_key_for_openai(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge["id"], "provider": "openai"},
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "API key is required" in response.text


@pytest.mark.asyncio
async def test_create_submission_requires_api_key_for_anthropic(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge["id"], "provider": "anthropic"},
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "API key is required" in response.text


@pytest.mark.asyncio
async def test_create_submission_requires_api_key_for_gemini(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge["id"], "provider": "gemini"},
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "API key is required" in response.text


@pytest.mark.asyncio
async def test_create_submission_accepts_gemini_with_api_key(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import submissions as submissions_module

    monkeypatch.setattr(
        submissions_module,
        "dispatch_evaluation",
        lambda submission_id, api_key=None: True,
    )
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={
            "challenge_id": challenge["id"],
            "provider": "gemini",
            "api_key": "sk-gem-123",
        },
        headers=auth(token),
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_submission_accepts_ollama_without_api_key(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import submissions as submissions_module

    monkeypatch.setattr(
        submissions_module,
        "dispatch_evaluation",
        lambda submission_id, api_key=None: True,
    )
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge["id"], "provider": "ollama"},
        headers=auth(token),
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_submission_forwards_api_key_to_dispatcher(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import submissions as submissions_module

    captured: dict[str, str] = {}
    monkeypatch.setattr(
        submissions_module,
        "dispatch_evaluation",
        lambda submission_id, api_key=None: (
            captured.setdefault("api_key", api_key),
            True,
        )[1],
    )
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={
            "challenge_id": challenge["id"],
            "provider": "openai",
            "api_key": "sk-secret-123",
        },
        headers=auth(token),
    )
    assert response.status_code == 201
    assert captured["api_key"] == "sk-secret-123"
    # The key must never be persisted or echoed back to the client.
    body = response.json()
    assert "api_key" not in body


@pytest.mark.asyncio
async def test_create_submission_does_not_return_api_key_for_demo(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(
        db_client, token, challenge["id"], provider="demo", api_key="sk-ignored"
    )

    assert "api_key" not in submission


@pytest.mark.asyncio
async def test_create_submission_resolves_provider_default_model(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(db_client, token, challenge["id"], provider="demo")

    assert submission["model"] == "mock-coder"


@pytest.mark.asyncio
async def test_create_submission_stores_explicit_model(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(
        db_client, token, challenge["id"], provider="demo", model="mock-coder"
    )

    assert submission["model"] == "mock-coder"


@pytest.mark.asyncio
async def test_create_submission_rejects_unknown_model(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge["id"], "provider": "demo", "model": "not-a-model"},
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "not available" in response.text


@pytest.mark.asyncio
async def test_create_submission_rejects_model_from_other_provider(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    # gpt-4o-mini belongs to openai, not demo.
    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge["id"], "provider": "demo", "model": "gpt-4o-mini"},
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "not available" in response.text


@pytest.mark.asyncio
async def test_create_submission_accepts_keyed_provider_model(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import submissions as submissions_module

    monkeypatch.setattr(
        submissions_module,
        "dispatch_evaluation",
        lambda submission_id, api_key=None: True,
    )
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(
        db_client,
        token,
        challenge["id"],
        provider="openai",
        api_key="sk-test-123",
        model="gpt-4o",
    )

    assert submission["model"] == "gpt-4o"


@pytest.mark.asyncio
async def test_create_submission_inherits_challenge_language(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token, language="go")

    submission = await create_submission(db_client, token, challenge["id"])

    assert submission["language"] == "go"


@pytest.mark.asyncio
async def test_create_submission_defaults_language_to_none(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token, language="python")

    submission = await create_submission(db_client, token, challenge["id"])

    assert submission["language"] == "python"


@pytest.mark.asyncio
async def test_create_submission_dispatch_failure_returns_503(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import submissions as submissions_module

    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    # Simulate a dead Celery broker: dispatcher reports failure.
    monkeypatch.setattr(
        submissions_module,
        "dispatch_evaluation",
        lambda submission_id, api_key=None: False,
    )

    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge["id"]},
        headers=auth(token),
    )
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]

    # The submission is recorded so the user can see what happened.
    listing = (await db_client.get(SUBMISSIONS_URL, headers=auth(token))).json()
    assert listing["total"] == 1
    assert listing["items"][0]["status"] == "failed"


@pytest.mark.asyncio
async def test_list_submissions_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.get(SUBMISSIONS_URL)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_submissions_empty(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get(SUBMISSIONS_URL, headers=auth(token))
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["pages"] == 0


@pytest.mark.asyncio
async def test_list_submissions_shows_own_only(db_client: AsyncClient) -> None:
    token_a, _ = await register_user(db_client)
    challenge_a = await create_challenge(db_client, token_a)
    await create_submission(db_client, token_a, challenge_a["id"])

    token_b, _ = await register_user(db_client)
    response_b = await db_client.get(SUBMISSIONS_URL, headers=auth(token_b))
    assert response_b.status_code == 200
    assert response_b.json()["items"] == []

    response_a = await db_client.get(SUBMISSIONS_URL, headers=auth(token_a))
    assert response_a.status_code == 200
    assert len(response_a.json()["items"]) == 1


@pytest.mark.asyncio
async def test_list_submissions_pagination(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    for _ in range(5):
        await create_submission(db_client, token, challenge["id"])

    page1 = (
        await db_client.get(
            SUBMISSIONS_URL, params={"page": 1, "page_size": 2}, headers=auth(token)
        )
    ).json()
    page2 = (
        await db_client.get(
            SUBMISSIONS_URL, params={"page": 2, "page_size": 2}, headers=auth(token)
        )
    ).json()
    page3 = (
        await db_client.get(
            SUBMISSIONS_URL, params={"page": 3, "page_size": 2}, headers=auth(token)
        )
    ).json()

    for page in (page1, page2, page3):
        assert page["page_size"] == 2

    assert page1["total"] == page2["total"] == page3["total"] == 5
    assert len(page1["items"]) == 2
    assert len(page2["items"]) == 2
    assert len(page3["items"]) == 1
    assert page1["pages"] == page2["pages"] == page3["pages"] == 3

    ids1 = {s["id"] for s in page1["items"]}
    ids2 = {s["id"] for s in page2["items"]}
    ids3 = {s["id"] for s in page3["items"]}
    assert ids1.isdisjoint(ids2)
    assert ids1.isdisjoint(ids3)
    assert ids2.isdisjoint(ids3)
    assert len(ids1 | ids2 | ids3) == 5


@pytest.mark.asyncio
async def test_list_submissions_filter_status(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    await create_submission(db_client, token, challenge["id"])
    pending = await create_submission(db_client, token, challenge["id"])
    await db_client.patch(
        f"{SUBMISSIONS_URL}/{pending['id']}",
        json={"status": "completed"},
        headers=auth(token),
    )

    response = await db_client.get(
        SUBMISSIONS_URL, params={"status": "completed"}, headers=auth(token)
    )
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_list_submissions_filter_challenge(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge_a = await create_challenge(db_client, token, title="Alpha")
    challenge_b = await create_challenge(db_client, token, title="Beta")
    await create_submission(db_client, token, challenge_a["id"])
    await create_submission(db_client, token, challenge_b["id"])

    response = await db_client.get(
        SUBMISSIONS_URL,
        params={"challenge_id": challenge_a["id"]},
        headers=auth(token),
    )
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["challenge_id"] == challenge_a["id"]


@pytest.mark.asyncio
async def test_get_submission_owner(db_client: AsyncClient) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    response = await db_client.get(f"{SUBMISSIONS_URL}/{submission['id']}", headers=auth(token))
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == submission["id"]
    assert body["user_id"] == user["id"]


@pytest.mark.asyncio
async def test_get_submission_forbidden_for_other_user(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    other_token, _ = await register_user(db_client)
    response = await db_client.get(
        f"{SUBMISSIONS_URL}/{submission['id']}", headers=auth(other_token)
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_submission_not_found(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get(f"{SUBMISSIONS_URL}/{uuid.uuid4()}", headers=auth(token))
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_submission_status(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "processing"},
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "processing"


@pytest.mark.asyncio
async def test_update_submission_status_illegal_transition(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    # pending → processing is legal…
    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "processing"},
        headers=auth(token),
    )
    assert response.status_code == 200

    # …but processing → pending and completed → processing are not.
    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "pending"},
        headers=auth(token),
    )
    assert response.status_code == 409
    assert "Illegal status transition" in response.json()["detail"]

    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "completed"},
        headers=auth(token),
    )
    assert response.status_code == 200

    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "processing"},
        headers=auth(token),
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_update_submission_status_invalid(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "bogus"},
        headers=auth(token),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_submission_status_forbidden_for_other_user(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    other_token, _ = await register_user(db_client)
    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "completed"},
        headers=auth(other_token),
    )
    assert response.status_code == 404


# --- provider comparison -----------------------------------------------------


async def _insert_completed_run(
    session_factory,
    user_id: uuid.UUID,
    challenge_id: uuid.UUID,
    *,
    provider: str,
    score: float,
    passed: int,
    total: int,
    duration_ms: int,
    created_at: str | None = None,
) -> None:
    """Persist a completed submission + evaluation result directly (worker is
    mocked in API tests, so real evaluation rows never appear otherwise)."""
    from datetime import datetime

    from app.models.evaluation_result import EvaluationResult
    from app.models.submission import Submission

    async with session_factory() as session:
        submission = Submission(
            user_id=user_id,
            challenge_id=challenge_id,
            status="completed",
            provider=provider,
            language="python",
            code="x",
            created_at=(
                datetime.fromisoformat(created_at).replace(tzinfo=UTC) if created_at else None
            ),
        )
        session.add(submission)
        await session.flush()
        session.add(
            EvaluationResult(
                submission_id=submission.id,
                passed_tests=passed,
                total_tests=total,
                score=score,
                metrics={"duration_ms": duration_ms},
            )
        )
        await session.commit()


@pytest.mark.asyncio
async def test_provider_comparison_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.get(
        f"{SUBMISSIONS_URL}/comparison",
        params={"challenge_id": str(uuid.uuid4())},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_provider_comparison_requires_challenge_id(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get(f"{SUBMISSIONS_URL}/comparison", headers=auth(token))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_provider_comparison_aggregates_own_runs(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    challenge_id = uuid.UUID(challenge["id"])
    own_id = uuid.UUID(user["id"])

    # demo: two completed runs (100+50)/2 = 75, pass (2+1)/2 = 1.5, dur 1000ms
    await _insert_completed_run(
        db_sessionmaker,
        own_id,
        challenge_id,
        provider="demo",
        score=100.0,
        passed=2,
        total=2,
        duration_ms=1200,
    )
    await _insert_completed_run(
        db_sessionmaker,
        own_id,
        challenge_id,
        provider="demo",
        score=50.0,
        passed=1,
        total=2,
        duration_ms=800,
    )
    # anthropic: one completed run — should rank above demo (90 > 75)
    await _insert_completed_run(
        db_sessionmaker,
        own_id,
        challenge_id,
        provider="anthropic",
        score=90.0,
        passed=2,
        total=2,
        duration_ms=600,
    )
    # pending demo run must be ignored
    from app.models.submission import Submission

    async with db_sessionmaker() as session:
        session.add(
            Submission(
                user_id=own_id,
                challenge_id=challenge_id,
                status="pending",
                provider="demo",
                language="python",
            )
        )
        await session.commit()

    # another user's completed run on the same challenge must be excluded
    other_token, other_user = await register_user(db_client)
    await _insert_completed_run(
        db_sessionmaker,
        uuid.UUID(other_user["id"]),
        challenge_id,
        provider="demo",
        score=10.0,
        passed=0,
        total=2,
        duration_ms=500,
    )

    response = await db_client.get(
        f"{SUBMISSIONS_URL}/comparison",
        params={"challenge_id": challenge["id"]},
        headers=auth(token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["challenge_id"] == challenge["id"]

    by_provider = {entry["provider"]: entry for entry in body["entries"]}
    assert set(by_provider) == {"demo", "anthropic"}
    assert by_provider["demo"]["runs"] == 2
    assert by_provider["demo"]["score"] == 75.0
    assert by_provider["demo"]["passed_tests"] == 1.5
    assert by_provider["demo"]["total_tests"] == 2.0
    assert by_provider["demo"]["duration_ms"] == 1000.0
    assert by_provider["anthropic"]["runs"] == 1
    assert by_provider["anthropic"]["score"] == 90.0
    # Sorted best average score first.
    assert [entry["provider"] for entry in body["entries"]] == [
        "anthropic",
        "demo",
    ]


@pytest.mark.asyncio
async def test_provider_comparison_empty_when_no_runs(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    response = await db_client.get(
        f"{SUBMISSIONS_URL}/comparison",
        params={"challenge_id": challenge["id"]},
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json()["entries"] == []


@pytest.mark.asyncio
async def test_submission_stats_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.get(f"{SUBMISSIONS_URL}/stats")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_submission_stats_empty(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get(f"{SUBMISSIONS_URL}/stats", headers=auth(token))
    assert response.status_code == 200
    assert response.json() == {"items": []}


@pytest.mark.asyncio
async def test_submission_stats_aggregates_per_challenge(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    uid = uuid.UUID(user["id"])
    cid = uuid.UUID(challenge["id"])

    # Two completed runs (100 + 50) → avg 75, best 100.
    await _insert_completed_run(
        db_sessionmaker,
        uid,
        cid,
        provider="demo",
        score=100.0,
        passed=2,
        total=2,
        duration_ms=100,
    )
    await _insert_completed_run(
        db_sessionmaker,
        uid,
        cid,
        provider="demo",
        score=50.0,
        passed=1,
        total=2,
        duration_ms=100,
    )
    # One failed run through the API.
    submission = await create_submission(db_client, token, challenge["id"])
    await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "failed"},
        headers=auth(token),
    )

    response = await db_client.get(f"{SUBMISSIONS_URL}/stats", headers=auth(token))
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["challenge_title"] == "Two Sum"
    assert item["language"] == "python"
    assert item["total_runs"] == 3
    assert item["completed_runs"] == 2
    assert item["failed_runs"] == 1
    assert item["avg_score"] == 75.0
    assert item["best_score"] == 100.0


@pytest.mark.asyncio
async def test_submission_stats_excludes_other_users(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    uid = uuid.UUID(user["id"])
    cid = uuid.UUID(challenge["id"])
    await _insert_completed_run(
        db_sessionmaker,
        uid,
        cid,
        provider="demo",
        score=90.0,
        passed=2,
        total=2,
        duration_ms=100,
    )

    other_token, other = await register_user(db_client)
    await _insert_completed_run(
        db_sessionmaker,
        uuid.UUID(other["id"]),
        cid,
        provider="demo",
        score=10.0,
        passed=0,
        total=2,
        duration_ms=100,
    )

    response = await db_client.get(f"{SUBMISSIONS_URL}/stats", headers=auth(other_token))
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["avg_score"] == 10.0
    assert items[0]["best_score"] == 10.0


@pytest.mark.asyncio
async def test_submission_stats_groups_by_challenge(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    token, user = await register_user(db_client)
    first = await create_challenge(db_client, token, title="First")
    second = await create_challenge(db_client, token, title="Second")
    uid = uuid.UUID(user["id"])
    await _insert_completed_run(
        db_sessionmaker,
        uid,
        uuid.UUID(first["id"]),
        provider="demo",
        score=80.0,
        passed=2,
        total=2,
        duration_ms=100,
    )
    await _insert_completed_run(
        db_sessionmaker,
        uid,
        uuid.UUID(second["id"]),
        provider="demo",
        score=40.0,
        passed=1,
        total=3,
        duration_ms=100,
    )

    response = await db_client.get(f"{SUBMISSIONS_URL}/stats", headers=auth(token))
    items = response.json()["items"]
    assert len(items) == 2
    titles = {item["challenge_title"]: item for item in items}
    assert titles["First"]["avg_score"] == 80.0
    assert titles["Second"]["best_score"] == 40.0
