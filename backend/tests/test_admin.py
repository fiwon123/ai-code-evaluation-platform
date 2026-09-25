import uuid

import pytest
from httpx import AsyncClient

from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register_user(client: AsyncClient, **overrides) -> tuple[str, dict]:
    """Register a user and return (token, user)."""
    payload = {
        "email": f"{uuid.uuid4().hex[:10]}@example.com",
        "username": f"user_{uuid.uuid4().hex[:8]}",
        "password": "password123",
        **overrides,
    }
    response = await client.post("/api/auth/register", json=payload)
    assert response.status_code == 201
    body = response.json()
    return body["access_token"], body["user"]


async def make_admin(db_sessionmaker, user_id: str) -> None:
    """Promote an existing user to admin directly in the DB."""
    async with db_sessionmaker() as session:
        user = await session.get(User, uuid.UUID(user_id))
        user.is_admin = True
        await session.commit()


async def register_admin(client: AsyncClient, db_sessionmaker) -> tuple[str, dict]:
    """Register a user and promote them to admin; returns (token, user)."""
    token, user = await register_user(client)
    await make_admin(db_sessionmaker, user["id"])
    return token, user


@pytest.mark.asyncio
async def test_admin_users_requires_admin(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get("/api/admin/users", headers=auth(token))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_users_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.get("/api/admin/users")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_users_as_admin(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    await register_user(db_client)

    response = await db_client.get("/api/admin/users", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    assert all("is_admin" in u for u in body["items"])
    assert all("is_active" in u for u in body["items"])


@pytest.mark.asyncio
async def test_patch_user_role_and_status(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    _, target = await register_user(db_client)

    response = await db_client.patch(
        f"/api/admin/users/{target['id']}",
        json={"is_admin": True},
        headers=auth(admin_token),
    )
    assert response.status_code == 200
    assert response.json()["is_admin"] is True
    assert response.json()["is_active"] is True


@pytest.mark.asyncio
async def test_patch_user_empty_payload_422(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    _, target = await register_user(db_client)

    response = await db_client.patch(
        f"/api/admin/users/{target['id']}",
        json={},
        headers=auth(admin_token),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_deactivate_user(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    _, target = await register_user(db_client)

    response = await db_client.post(
        f"/api/admin/users/{target['id']}/deactivate",
        headers=auth(admin_token),
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False


@pytest.mark.asyncio
async def test_deactivate_own_account_rejected(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, admin = await register_admin(db_client, db_sessionmaker)

    response = await db_client.post(
        f"/api/admin/users/{admin['id']}/deactivate",
        headers=auth(admin_token),
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_deactivated_user_cannot_login(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    _, target = await register_user(db_client)

    await db_client.post(
        f"/api/admin/users/{target['id']}/deactivate",
        headers=auth(admin_token),
    )

    response = await db_client.post(
        "/api/auth/login",
        json={"identifier": target["email"], "password": "password123"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_deactivated_user_token_no_longer_authorized(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    target_token, target = await register_user(db_client)

    await db_client.post(
        f"/api/admin/users/{target['id']}/deactivate",
        headers=auth(admin_token),
    )

    # Existing tokens are rejected once the account is deactivated.
    response = await db_client.get("/api/auth/me", headers=auth(target_token))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_list_challenges(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)

    challenge_payload = {
        "title": "Two Sum",
        "description": "d",
        "prompt": "p",
        "test_code": "def test():\n    pass",
        "language": "python",
    }
    await db_client.post("/api/challenges", json=challenge_payload, headers=auth(admin_token))

    response = await db_client.get("/api/admin/challenges", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Two Sum"


@pytest.mark.asyncio
async def test_admin_delete_challenge(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    other_token, _ = await register_user(db_client)

    challenge_payload = {
        "title": "FizzBuzz",
        "description": "d",
        "prompt": "p",
        "test_code": "def test():\n    pass",
        "language": "python",
    }
    created = await db_client.post(
        "/api/challenges", json=challenge_payload, headers=auth(other_token)
    )
    challenge_id = created.json()["id"]

    # Admin can delete a challenge they don't own.
    response = await db_client.delete(
        f"/api/admin/challenges/{challenge_id}",
        headers=auth(admin_token),
    )
    assert response.status_code == 204

    fetch = await db_client.get(f"/api/challenges/{challenge_id}")
    assert fetch.status_code == 404


@pytest.mark.asyncio
async def test_admin_delete_missing_challenge_404(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)

    response = await db_client.delete(
        f"/api/admin/challenges/{uuid.uuid4()}",
        headers=auth(admin_token),
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_list_submissions(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)

    response = await db_client.get("/api/admin/submissions", headers=auth(admin_token))
    assert response.status_code == 200
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_platform_stats(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    await register_user(db_client)

    response = await db_client.get("/api/admin/stats", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert body["total_users"] == 2
    assert body["total_challenges"] == 0
    assert body["total_submissions"] == 0
    assert body["completed_submissions"] == 0
    assert body["failed_submissions"] == 0
    assert body["average_score"] is None


@pytest.mark.asyncio
async def test_admin_stats_403_for_non_admin(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get("/api/admin/stats", headers=auth(token))
    assert response.status_code == 403


# --- User lifecycle: delete / restore (reactivate) ---------------------------


@pytest.mark.asyncio
async def test_delete_user(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    target_token, target = await register_user(db_client)

    response = await db_client.delete(
        f"/api/admin/users/{target['id']}",
        headers=auth(admin_token),
    )
    assert response.status_code == 204

    # The deleted account can neither authenticate nor keep using its token.
    login = await db_client.post(
        "/api/auth/login",
        json={"identifier": target["email"], "password": "password123"},
    )
    assert login.status_code == 401

    me = await db_client.get("/api/auth/me", headers=auth(target_token))
    assert me.status_code == 401

    # The row is gone from the admin listing.
    listing = await db_client.get("/api/admin/users", headers=auth(admin_token))
    assert all(u["id"] != target["id"] for u in listing.json()["items"])


@pytest.mark.asyncio
async def test_delete_own_account_rejected(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, admin = await register_admin(db_client, db_sessionmaker)

    response = await db_client.delete(
        f"/api/admin/users/{admin['id']}",
        headers=auth(admin_token),
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_delete_missing_user_404(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)

    response = await db_client.delete(
        f"/api/admin/users/{uuid.uuid4()}",
        headers=auth(admin_token),
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_reactivate_user_restores_login(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    _, target = await register_user(db_client)

    await db_client.post(
        f"/api/admin/users/{target['id']}/deactivate",
        headers=auth(admin_token),
    )

    response = await db_client.post(
        f"/api/admin/users/{target['id']}/reactivate",
        headers=auth(admin_token),
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is True

    login = await db_client.post(
        "/api/auth/login",
        json={"identifier": target["email"], "password": "password123"},
    )
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_reactivate_already_active_400(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    _, target = await register_user(db_client)

    response = await db_client.post(
        f"/api/admin/users/{target['id']}/reactivate",
        headers=auth(admin_token),
    )
    assert response.status_code == 400
    assert "already active" in response.json()["detail"]


@pytest.mark.asyncio
async def test_patch_user_cannot_demote_self(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, admin = await register_admin(db_client, db_sessionmaker)

    response = await db_client.patch(
        f"/api/admin/users/{admin['id']}",
        json={"is_admin": False},
        headers=auth(admin_token),
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_patch_user_cannot_disable_self(db_client: AsyncClient, db_sessionmaker) -> None:
    admin_token, admin = await register_admin(db_client, db_sessionmaker)

    response = await db_client.patch(
        f"/api/admin/users/{admin['id']}",
        json={"is_active": False},
        headers=auth(admin_token),
    )
    assert response.status_code == 400


# --- Admin submissions carry owner/challenge context -------------------------


async def create_challenge(client: AsyncClient, token: str, **overrides) -> dict:
    payload = {
        "title": "Two Sum",
        "description": "Find two numbers that add up to a target.",
        "prompt": "Write two_sum(nums, target).",
        "test_code": "def test_two_sum():\n    assert two_sum([2, 7, 11, 15], 9) == [0, 1]",
        **overrides,
    }
    response = await client.post(
        "/api/challenges",
        json=payload,
        headers=auth(token),
    )
    assert response.status_code == 201
    return response.json()


async def create_submission(
    client: AsyncClient, token: str, challenge_id: str, **overrides
) -> dict:
    response = await client.post(
        "/api/submissions",
        json={"challenge_id": challenge_id, **overrides},
        headers=auth(token),
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_admin_submissions_include_username_and_challenge_title(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    user_token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, user_token, title="FizzBuzz")
    await create_submission(db_client, user_token, challenge["id"], provider="demo")

    response = await db_client.get("/api/admin/submissions", headers=auth(admin_token))
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["username"] == user["username"]
    assert items[0]["challenge_title"] == "FizzBuzz"


# --- Richer stats: provider aggregates + error types -------------------------


@pytest.mark.asyncio
async def test_platform_stats_provider_and_error_type_breakdowns(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    admin_token, _ = await register_admin(db_client, db_sessionmaker)
    user_token, _ = await register_user(db_client, username="stat_user")
    challenge = await create_challenge(db_client, user_token)

    demo_pass = await create_submission(db_client, user_token, challenge["id"], provider="demo")
    demo_fail = await create_submission(db_client, user_token, challenge["id"], provider="demo")
    ollama_partial = await create_submission(
        db_client, user_token, challenge["id"], provider="ollama"
    )
    ollama_fail = await create_submission(db_client, user_token, challenge["id"], provider="ollama")

    # Settle the rows to terminal states the way the worker would: two
    # completed runs (one full pass, one partial) and two failed runs with
    # distinct recorded error types.
    async with db_sessionmaker() as session:
        completed_pass = await session.get(Submission, uuid.UUID(demo_pass["id"]))
        completed_pass.status = "completed"
        completed_pass.score = 100.0
        completed_partial = await session.get(Submission, uuid.UUID(ollama_partial["id"]))
        completed_partial.status = "completed"
        completed_partial.score = 50.0

        async def _fail(submission_id: str, error: str) -> None:
            submission = await session.get(Submission, uuid.UUID(submission_id))
            submission.status = "failed"
            submission.score = 0.0
            session.add(
                EvaluationResult(
                    submission_id=submission.id,
                    passed_tests=0,
                    total_tests=0,
                    score=0.0,
                    logs="",
                    metrics={"error": error},
                )
            )

        await _fail(demo_fail["id"], "timeout")
        await _fail(ollama_fail["id"], "Invalid API key")
        await session.commit()

    response = await db_client.get("/api/admin/stats", headers=auth(admin_token))
    assert response.status_code == 200
    body = response.json()

    by_provider = {p["provider"]: p for p in body["submissions_by_provider"]}
    assert by_provider["demo"]["count"] == 2
    assert by_provider["demo"]["avg_score"] == 100.0
    assert by_provider["demo"]["pass_rate"] == 1.0
    assert by_provider["ollama"]["count"] == 2
    assert by_provider["ollama"]["avg_score"] == 50.0
    assert by_provider["ollama"]["pass_rate"] == 0.0

    by_error = {e["error_type"]: e["count"] for e in body["submissions_by_error_type"]}
    assert by_error == {"auth failure": 1, "timeout": 1}
