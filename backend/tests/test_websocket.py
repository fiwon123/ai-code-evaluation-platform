import asyncio
import json
from collections.abc import Generator
from unittest.mock import AsyncMock

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
