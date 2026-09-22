"""End-to-end pipeline tests: API flow and full demo evaluation.

These tests exercise the real application stack (minus Docker and external
LLM APIs): AsyncClient against a fresh in-memory SQLite database and the
demo provider driving the subprocess evaluation path.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User
from app.tasks.evaluate import _run_submission_evaluation

TWO_SUM_TESTS = (
    "from solution import two_sum\n"
    "\n"
    "def test_basic():\n"
    "    assert two_sum([2, 7, 11, 15], 9) == [0, 1]\n"
    "\n"
    "def test_not_found():\n"
    "    assert two_sum([1, 2], 10) == []\n"
)

TWO_SUM_PROMPT = (
    "Write a function two_sum that takes a list of integers and a target "
    "and returns the indices of the two numbers that add up to the target."
)


async def _register_and_token(db_client) -> str:
    """Register a user via the API and return the access token."""
    response = await db_client.post(
        "/api/auth/register",
        json={
            "email": "alice@example.com",
            "username": "alice",
            "password": "password123",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == "alice@example.com"
    return body["access_token"]


class TestApiFlow:
    """Register -> create challenge -> submit -> verify the pending submission."""

    async def test_register_create_challenge_submit(self, db_client):
        token = await _register_and_token(db_client)
        auth = {"Authorization": f"Bearer {token}"}

        challenge_response = await db_client.post(
            "/api/challenges",
            headers=auth,
            json={
                "title": "Two Sum",
                "description": "Find the two indices that add up to the target.",
                "prompt": TWO_SUM_PROMPT,
                "test_code": TWO_SUM_TESTS,
                "language": "python",
            },
        )
        assert challenge_response.status_code == 201
        challenge_id = challenge_response.json()["id"]

        submission_response = await db_client.post(
            "/api/submissions",
            headers=auth,
            json={"challenge_id": challenge_id, "provider": "demo"},
        )
        assert submission_response.status_code == 201
        body = submission_response.json()
        assert body["status"] == "pending"
        assert body["provider"] == "demo"
        assert body["challenge_id"] == challenge_id
        assert body["evaluation_result"] is None

        # The submission is immediately visible in the owner's list.
        list_response = await db_client.get("/api/submissions", headers=auth)
        assert list_response.status_code == 200
        assert list_response.json()["total"] == 1

    async def test_challenge_requires_authentication(self, db_client):
        response = await db_client.post(
            "/api/challenges",
            json={"title": "X", "description": "Y", "prompt": "Z"},
        )
        assert response.status_code == 401


def _make_sync_session() -> tuple[Session, object]:
    """Fresh in-memory SQLite session for the sync evaluation path."""
    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return factory(), engine


class TestEvaluationPipeline:
    """Full demo evaluation: code generation + pytest execution + persistence."""

    def test_demo_provider_completes_evaluation(self):
        session, engine = _make_sync_session()
        try:
            user = User(
                email="bob@example.com",
                username="bob",
                hashed_password="hash",
            )
            session.add(user)
            session.flush()

            challenge = Challenge(
                user_id=user.id,
                title="Two Sum",
                description="Find the two indices.",
                prompt=TWO_SUM_PROMPT,
                test_code=TWO_SUM_TESTS,
                language="python",
            )
            session.add(challenge)
            session.flush()

            submission = Submission(
                user_id=user.id,
                challenge_id=challenge.id,
                status="pending",
                provider="demo",
            )
            session.add(submission)
            session.commit()

            outcome = _run_submission_evaluation(session, submission.id)

            assert outcome["status"] == "completed"
            assert outcome["total"] == 2
            assert outcome["passed"] == 2
            assert outcome["score"] == 100.0

            session.refresh(submission)
            assert submission.status == "completed"
            assert submission.score == 100.0
            assert submission.code is not None
            assert "def two_sum" in submission.code

            result = (
                session.query(EvaluationResult)
                .filter(EvaluationResult.submission_id == submission.id)
                .one()
            )
            assert result.total_tests == 2
            assert result.passed_tests == 2
            assert result.score == 100.0
            assert result.logs
        finally:
            session.close()
            engine.dispose()

    def test_missing_submission_returns_not_found(self):
        session, engine = _make_sync_session()
        try:
            from uuid import uuid4

            outcome = _run_submission_evaluation(session, uuid4())
            assert outcome["status"] == "not_found"
            assert outcome["submission_id"] is not None
        finally:
            session.close()
            engine.dispose()

    def test_missing_challenge_marks_submission_failed(self):
        session, engine = _make_sync_session()
        try:
            from uuid import uuid4

            user = User(
                email="carol@example.com",
                username="carol",
                hashed_password="hash",
            )
            session.add(user)
            session.flush()

            # A submission referencing a challenge that does not exist.
            # SQLite does not enforce the FK constraint by default.
            submission = Submission(
                user_id=user.id,
                challenge_id=uuid4(),
                status="pending",
                provider="demo",
            )
            session.add(submission)
            session.commit()

            outcome = _run_submission_evaluation(session, submission.id)

            assert outcome["status"] == "failed"
            assert outcome["error"] == "challenge not found"
            session.refresh(submission)
            assert submission.status == "failed"
        finally:
            session.close()
            engine.dispose()
