import asyncio
import json
from collections.abc import Generator
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.websockets import WebSocketDisconnect

from app.core.database import Base
from app.core.redis import get_redis
from app.core.security import create_access_token
from app.main import create_app
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User

WS_URL = "/api/ws/submissions/{submission_id}"


@pytest.fixture
def ws_env(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Generator[dict]:
    """TestClient app backed by file SQLite with a scripted pubsub mock.

    A single file-backed engine keeps the handler's snapshot reads free of the
    cross-thread WAL staleness seen with in-memory shared pools. The pubsub is
    fully scripted — the server never needs a live Redis.
    """
    db_url = f"sqlite+aiosqlite:///{tmp_path / 'ws_test.db'}"
    app_engine = create_async_engine(db_url, poolclass=NullPool)
    app_session_factory = async_sessionmaker(
        app_engine, class_=AsyncSession, expire_on_commit=False
    )

    # The websocket handler opens a session via ``app.core.database.async_session``
    # — route that to the test factory.
    from app.core import database

    monkeypatch.setattr(database, "async_session", app_session_factory)

    async def seed() -> dict:
        async with app_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with app_session_factory() as session:
            owner = User(
                email="owner@example.com",
                username="owner_ws",
                hashed_password="x",
            )
            other = User(
                email="other@example.com",
                username="other_ws",
                hashed_password="x",
            )
            session.add_all([owner, other])
            await session.flush()
            challenge = Challenge(
                user_id=owner.id,
                title="Two Sum",
                description="d",
                prompt="p",
                test_code="",
                language="python",
            )
            session.add(challenge)
            await session.flush()
            submission = Submission(
                user_id=owner.id,
                challenge_id=challenge.id,
                status="pending",
                provider="demo",
            )
            session.add(submission)
            await session.commit()
            return {
                "owner_id": str(owner.id),
                "other_id": str(other.id),
                "submission_id": str(submission.id),
            }

    ids = asyncio.run(seed())

    # Scripted pub/sub: get_message #1 returns None (→ heartbeat ping), #2 is a
    # real payload (→ update), #3 disconnects the client (→ graceful teardown).
    def make_message() -> dict:
        return {
            "type": "message",
            "data": json.dumps({"type": "processing", "submission_id": ids["submission_id"]}),
        }

    pubsub = AsyncMock()
    pubsub.subscribe = AsyncMock(return_value=None)
    pubsub.unsubscribe = AsyncMock(return_value=None)
    pubsub.aclose = AsyncMock(return_value=None)
    pubsub.get_message = AsyncMock(
        side_effect=[
            None,
            make_message(),
            WebSocketDisconnect(),
        ]
    )
    redis = AsyncMock()
    # Real redis.asyncio.Redis.pubsub() is synchronous — model that.
    redis.pubsub = lambda: pubsub

    app = create_app()

    async def override_get_redis():
        return redis

    app.dependency_overrides[get_redis] = override_get_redis

    yield {
        "app": app,
        "submission_id": ids["submission_id"],
        "owner_id": ids["owner_id"],
        "other_id": ids["other_id"],
        "pubsub": pubsub,
        # Exposed so a test can commit the row the terminal event will read —
        # the handler only ever sees committed state.
        "session_factory": app_session_factory,
    }

    asyncio.run(app_engine.dispose())


def token_for(user_id: str) -> str:
    return create_access_token(user_id)


def connect_ws(app, submission_id: str, token: str):
    return TestClient(app).websocket_connect(f"/api/ws/submissions/{submission_id}?token={token}")


def test_websocket_rejects_missing_token(ws_env: dict) -> None:
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with connect_ws(ws_env["app"], ws_env["submission_id"], "") as websocket:
            websocket.receive_text()
    assert exc_info.value.code == 4401


def test_websocket_rejects_invalid_token(ws_env: dict) -> None:
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with connect_ws(ws_env["app"], ws_env["submission_id"], "not-a-jwt") as websocket:
            websocket.receive_text()
    assert exc_info.value.code == 4401


def test_websocket_rejects_submission_of_other_user(ws_env: dict) -> None:
    # A valid token, but the submission belongs to another user.
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with connect_ws(
            ws_env["app"],
            ws_env["submission_id"],
            token_for(ws_env["other_id"]),
        ) as websocket:
            websocket.receive_text()
    assert exc_info.value.code == 4403


def test_websocket_sends_snapshot_then_live_updates(ws_env: dict) -> None:
    app = ws_env["app"]

    with connect_ws(app, ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "snapshot"
        assert snapshot["submission"]["status"] == "pending"
        assert snapshot["submission"]["id"] == ws_env["submission_id"]

        # First get_message returns None → server sends a heartbeat ping.
        ping = ws.receive_text()
        assert json.loads(ping)["type"] == "ping"

        # Second get_message carries a payload → server forwards an update.
        update = ws.receive_json()
        assert update["type"] == "update"
        assert update["submission_id"] == ws_env["submission_id"]
        assert update["status"] == "processing"
        # The raw event maps to a client-safe phase.
        assert update["phase"] == "generating"


def test_websocket_maps_code_generated_to_phase(ws_env: dict) -> None:
    """The ephemeral ``code_generated`` event must never leak as a status."""
    app = ws_env["app"]
    pubsub = ws_env["pubsub"]

    # Re-script the pubsub: code_generated → completed → disconnect.
    def make_message(event: str) -> dict:
        return {
            "type": "message",
            "data": json.dumps({"type": event, "submission_id": ws_env["submission_id"]}),
        }

    pubsub.get_message = AsyncMock(
        side_effect=[
            make_message("code_generated"),
            make_message("completed"),
            WebSocketDisconnect(),
        ]
    )

    with connect_ws(app, ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()  # snapshot
        generated = ws.receive_json()
        assert generated["type"] == "update"
        assert generated["status"] == "processing"
        assert generated["phase"] == "testing"

        terminal = ws.receive_json()
        assert terminal["status"] == "completed"
        assert terminal["phase"] is None


def test_websocket_ignores_unknown_events(ws_env: dict) -> None:
    """Events that are not SubmissionStatuses are dropped, not forwarded."""
    app = ws_env["app"]
    pubsub = ws_env["pubsub"]

    def make_message(event: str) -> dict:
        return {
            "type": "message",
            "data": json.dumps({"type": event, "submission_id": ws_env["submission_id"]}),
        }

    pubsub.get_message = AsyncMock(
        side_effect=[
            make_message("bogus_event"),
            make_message("processing"),
            WebSocketDisconnect(),
        ]
    )

    with connect_ws(app, ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()  # snapshot
        # The bogus event is skipped; the next real one arrives cleanly.
        update = ws.receive_json()
        assert update["type"] == "update"
        assert update["status"] == "processing"
        assert update["phase"] == "generating"


def test_websocket_cleans_up_pubsub_on_disconnect(ws_env: dict) -> None:
    app = ws_env["app"]
    pubsub = ws_env["pubsub"]

    with connect_ws(app, ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()  # snapshot
        ws.close()

    assert pubsub.unsubscribe.await_count >= 1
    assert pubsub.aclose.await_count >= 1


def _finish_submission(ws_env: dict, **overrides: object) -> None:
    """Commit the terminal row the worker would have written before publishing.

    The handler re-reads the record on a terminal event, so a test has to
    persist the same state the worker persists — publish-after-commit is the
    property that makes the whole approach correct.
    """

    async def run() -> None:
        async with ws_env["session_factory"]() as session:
            # The fixture yields ids as strings; the Uuid column needs the type.
            submission = await session.get(Submission, UUID(ws_env["submission_id"]))
            fields: dict = {
                "status": "completed",
                "code": "def two_sum(nums, target):\n    return [0, 1]\n",
                "score": 100.0,
                "phase": None,
            }
            fields.update(overrides)
            for key, value in fields.items():
                setattr(submission, key, value)
            if fields["status"] == "completed":
                session.add(
                    EvaluationResult(
                        submission_id=submission.id,
                        passed_tests=2,
                        total_tests=2,
                        score=100.0,
                        logs="2 passed in 0.01s",
                        metrics={"language": "python", "duration_ms": 12},
                        test_results=[{"name": "test_two_sum", "passed": True, "message": ""}],
                    )
                )
            await session.commit()

    asyncio.run(run())


def _event(ws_env: dict, event_type: str, **fields: object) -> dict:
    return {
        "type": "message",
        "data": json.dumps(
            {"type": event_type, "submission_id": ws_env["submission_id"], **fields},
        ),
    }


def test_terminal_update_carries_the_persisted_record(ws_env: dict) -> None:
    """The whole point of #190: output arrives on the socket, not on a re-fetch."""
    _finish_submission(ws_env)
    pubsub = ws_env["pubsub"]
    pubsub.get_message = AsyncMock(
        side_effect=[_event(ws_env, "completed", score=100.0), WebSocketDisconnect()]
    )

    with connect_ws(ws_env["app"], ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()  # snapshot (pending)
        update = ws.receive_json()

    assert update["type"] == "update"
    assert update["status"] == "completed"
    assert update["phase"] is None
    record = update["submission"]
    assert record["id"] == ws_env["submission_id"]
    assert record["code"] == "def two_sum(nums, target):\n    return [0, 1]\n"
    assert record["score"] == 100.0
    result = record["evaluation_result"]
    assert result is not None
    assert result["logs"] == "2 passed in 0.01s"
    assert result["passed_tests"] == 2
    assert result["total_tests"] == 2
    assert result["metrics"] == {"language": "python", "duration_ms": 12}
    assert result["test_results"] == [
        {"name": "test_two_sum", "passed": True, "message": ""},
    ]


def test_terminal_update_uses_the_database_not_the_event_payload(ws_env: dict) -> None:
    """The record is re-read, so a lying or stale event cannot corrupt the client.

    The worker publishes ``score=`` alongside the event. If that were trusted,
    a client would render a score the database never accepted. Re-reading also
    means fields the event happens to carry (here ``error``) cannot leak into
    the submission record.
    """
    _finish_submission(ws_env, status="failed", score=0.0, code="")
    pubsub = ws_env["pubsub"]
    pubsub.get_message = AsyncMock(
        side_effect=[
            _event(ws_env, "failed", score=100.0, error="hallucinated"),
            WebSocketDisconnect(),
        ]
    )

    with connect_ws(ws_env["app"], ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()
        update = ws.receive_json()

    record = update["submission"]
    assert record["status"] == "failed"
    assert record["score"] == 0.0
    assert "error" not in record


def test_mid_pipeline_update_omits_the_record(ws_env: dict) -> None:
    """Nothing to deliver yet — keep the wire small until the run finishes."""
    pubsub = ws_env["pubsub"]
    pubsub.get_message = AsyncMock(
        side_effect=[_event(ws_env, "processing"), WebSocketDisconnect()]
    )

    with connect_ws(ws_env["app"], ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()
        update = ws.receive_json()

    assert update["status"] == "processing"
    assert update["phase"] == "generating"
    assert "submission" not in update


def test_terminal_event_before_the_result_is_committed_still_sends_the_row(ws_env: dict) -> None:
    """The one race the socket cannot win: publish-before-commit.

    The worker commits first, so this ordering does not occur in production —
    but if a future change inverted it, the client would receive a terminal
    record with no output. The frontend's REST fallback is what covers that, so
    the test pins the *shape* of the failure rather than pretending it cannot
    happen.
    """
    pubsub = ws_env["pubsub"]
    pubsub.get_message = AsyncMock(side_effect=[_event(ws_env, "completed"), WebSocketDisconnect()])

    with connect_ws(ws_env["app"], ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()
        update = ws.receive_json()

    record = update["submission"]
    assert update["status"] == "completed"
    assert record["evaluation_result"] is None  # → the page refetches over REST


def _record_attempt(ws_env: dict, attempt_number: int = 1) -> None:
    """Commit an attempt row the way the worker would before publishing."""
    from app.models.evaluation_attempt import EvaluationAttempt

    async def seed() -> None:
        async with ws_env["session_factory"]() as session:
            submission = await session.get(Submission, UUID(ws_env["submission_id"]))
            submission.status = "processing"
            submission.phase = "repairing"
            session.add(
                EvaluationAttempt(
                    submission_id=submission.id,
                    attempt_number=attempt_number,
                    code="def two_sum(nums, target):\n    return []",
                    passed_tests=1,
                    total_tests=2,
                    score=50.0,
                    logs="FAILED test_basic - assert None == [0, 1]",
                    logs_summary="1 of 2 tests passed (score 50.0%)",
                    metrics={"returncode": 1},
                    test_results=[
                        {"name": "test_basic", "passed": False, "message": "assert None"},
                    ],
                )
            )
            await session.commit()

    asyncio.run(seed())


def test_repairing_event_maps_to_the_repairing_phase(ws_env: dict) -> None:
    """The phase has to be distinguishable from a first attempt."""
    pubsub = ws_env["pubsub"]
    pubsub.get_message = AsyncMock(
        side_effect=[_event(ws_env, "repairing", attempt=1, next_attempt=2), WebSocketDisconnect()]
    )

    with connect_ws(ws_env["app"], ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()
        update = ws.receive_json()

    assert update["status"] == "processing"
    assert update["phase"] == "repairing"


def test_repairing_event_carries_the_failed_attempt(ws_env: dict) -> None:
    """A repair adds an attempt row, so the client needs the record — otherwise
    the timeline only fills in when the run finally terminates."""
    _record_attempt(ws_env)
    pubsub = ws_env["pubsub"]
    pubsub.get_message = AsyncMock(
        side_effect=[_event(ws_env, "repairing", attempt=1), WebSocketDisconnect()]
    )

    with connect_ws(ws_env["app"], ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        ws.receive_json()
        update = ws.receive_json()

    record = update["submission"]
    assert len(record["attempts"]) == 1
    assert record["attempts"][0]["attempt_number"] == 1
    assert record["attempts"][0]["score"] == 50.0
    assert "1 of 2 tests passed" in record["attempts"][0]["logs_summary"]
    assert record["max_attempts"] >= 1


def test_snapshot_includes_attempts_for_a_mid_repair_page_load(ws_env: dict) -> None:
    """A page opened between attempts must not render an empty timeline."""
    _record_attempt(ws_env)
    pubsub = ws_env["pubsub"]
    pubsub.get_message = AsyncMock(side_effect=[WebSocketDisconnect()])

    with connect_ws(ws_env["app"], ws_env["submission_id"], token_for(ws_env["owner_id"])) as ws:
        snapshot = ws.receive_json()

    record = snapshot["submission"]
    assert len(record["attempts"]) == 1
    assert record["attempts"][0]["logs_summary"]
    assert "max_attempts" in record
