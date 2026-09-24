import uuid

import pytest
from httpx import AsyncClient

from tests.test_submissions import auth, create_challenge, create_submission, register_user

RESULTS_URL = "/api/results"
SUBMISSIONS_URL = "/api/submissions"


async def _completed_submission(
    session_factory,
    user_id,
    challenge_id,
    *,
    provider: str = "demo",
    score: float = 90.0,
    share_token: str | None = None,
) -> str:
    """Insert a completed submission + evaluation result; returns submission id.

    Evaluation rows never appear via the API path (the worker is mocked), so
    sharing tests seed them directly — same pattern as _insert_completed_run.
    """
    from app.models.evaluation_result import EvaluationResult
    from app.models.submission import Submission

    async with session_factory() as session:
        submission = Submission(
            user_id=uuid.UUID(user_id),
            challenge_id=uuid.UUID(challenge_id),
            status="completed",
            provider=provider,
            language="python",
            code="def two_sum(nums, target):\n    return [0, 1]\n",
        )
        session.add(submission)
        await session.flush()
        session.add(
            EvaluationResult(
                submission_id=submission.id,
                passed_tests=2,
                total_tests=2,
                score=score,
                logs="2 passed in 0.01s",
                metrics={"duration_ms": 12, "language": "python"},
                test_results=[
                    {"name": "test_two_sum", "passed": True, "message": None},
                    {"name": "test_edge_case", "passed": False, "message": "boom"},
                ],
                share_token=share_token,
            )
        )
        await session.commit()
        return str(submission.id)


@pytest.mark.asyncio
async def test_share_result_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.post(f"{SUBMISSIONS_URL}/{uuid.uuid4()}/share")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_share_requires_completed_evaluation(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    response = await db_client.post(
        f"{SUBMISSIONS_URL}/{submission['id']}/share", headers=auth(token)
    )
    assert response.status_code == 400
    assert "Only completed evaluations can be shared" in response.text


@pytest.mark.asyncio
async def test_share_hides_other_users_submissions(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    other_token, _ = await register_user(db_client)
    response = await db_client.post(
        f"{SUBMISSIONS_URL}/{submission['id']}/share", headers=auth(other_token)
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_share_creates_a_token_and_is_idempotent(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission_id = await _completed_submission(db_sessionmaker, user["id"], challenge["id"])

    first = await db_client.post(f"{SUBMISSIONS_URL}/{submission_id}/share", headers=auth(token))
    assert first.status_code == 200
    share_token = first.json()["share_token"]
    assert len(share_token) >= 16

    second = await db_client.post(f"{SUBMISSIONS_URL}/{submission_id}/share", headers=auth(token))
    assert second.status_code == 200
    assert second.json()["share_token"] == share_token


@pytest.mark.asyncio
async def test_share_revoke_turns_the_key(db_client: AsyncClient, db_sessionmaker) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission_id = await _completed_submission(
        db_sessionmaker, user["id"], challenge["id"], share_token="known-share-token"
    )

    response = await db_client.delete(
        f"{SUBMISSIONS_URL}/{submission_id}/share", headers=auth(token)
    )
    assert response.status_code == 204

    public = await db_client.get(f"{RESULTS_URL}/known-share-token")
    assert public.status_code == 404


@pytest.mark.asyncio
async def test_public_result_read_returns_full_report(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission_id = await _completed_submission(
        db_sessionmaker, user["id"], challenge["id"], provider="anthropic"
    )
    await db_client.post(f"{SUBMISSIONS_URL}/{submission_id}/share", headers=auth(token))
    share_token = (
        await db_client.post(f"{SUBMISSIONS_URL}/{submission_id}/share", headers=auth(token))
    ).json()["share_token"]

    # No Authorization header — this is the recruiter view.
    response = await db_client.get(f"{RESULTS_URL}/{share_token}")
    assert response.status_code == 200
    body = response.json()
    assert body["challenge_id"] == challenge["id"]
    assert body["challenge_title"] == "Two Sum"
    assert body["challenge_prompt"] == "Write two_sum(nums, target)."
    assert body["language"] == "python"
    assert body["provider"] == "anthropic"
    assert body["status"] == "completed"
    assert body["score"] == 90.0
    assert body["passed_tests"] == 2
    assert body["total_tests"] == 2
    assert body["logs"] == "2 passed in 0.01s"
    assert body["metrics"]["duration_ms"] == 12
    assert body["code"].startswith("def two_sum")
    assert body["test_results"][0]["name"] == "test_two_sum"
    assert body["test_results"][1]["message"] == "boom"
    # The owner's identity must never leak through the public endpoint.
    assert "user" not in body


@pytest.mark.asyncio
async def test_public_result_read_unknown_token_is_404(
    db_client: AsyncClient,
) -> None:
    response = await db_client.get(f"{RESULTS_URL}/no-such-token")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_owner_sees_share_token_on_their_submission(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission_id = await _completed_submission(
        db_sessionmaker, user["id"], challenge["id"], share_token="s3cret-token"
    )

    response = await db_client.get(f"{SUBMISSIONS_URL}/{submission_id}", headers=auth(token))
    assert response.status_code == 200
    assert response.json()["evaluation_result"]["share_token"] == "s3cret-token"
