from datetime import UTC, datetime, timedelta
from unittest.mock import ANY, Mock
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User
from app.tasks.recover import (
    PENDING_MAX_MINUTES,
    PENDING_STALE_MINUTES,
    PROCESSING_STALE_MINUTES,
    _run_recovery,
)

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def _as_utc(dt: datetime) -> datetime:
    """Normalize SQLite's naive timestamps to aware UTC for comparison."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _make_sync_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)()


def _seed(
    session,
    status: str,
    updated_at: datetime | None = None,
    provider: str = "demo",
    created_at: datetime | None = None,
):
    """Seed a fresh user + challenge + submission (unique per call)."""
    user = User(
        email=f"recover-{uuid4().hex[:8]}@example.com",
        username=f"recoveruser-{uuid4().hex[:8]}",
        hashed_password="x",
    )
    session.add(user)
    session.flush()
    challenge = Challenge(
        user_id=user.id,
        title="Two Sum",
        description="find indices",
        prompt="Write a function two_sum(nums, target)",
        test_code="def test_basic():\n    assert True\n",
        language="python",
    )
    session.add(challenge)
    session.flush()
    submission = Submission(
        user_id=user.id,
        challenge_id=challenge.id,
        status=status,
        provider=provider,
        language="python",
    )
    session.add(submission)
    if created_at is not None:
        submission.created_at = created_at
    if updated_at is not None:
        submission.updated_at = updated_at
    session.commit()
    session.expire_all()
    return session.get(Submission, submission.id)


class TestRecoverStalePending:
    def test_redispatches_stale_pending(self, monkeypatch):
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
        )
        delay = Mock(return_value=None)
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 1, "failed": 0}
        delay.assert_called_once_with(str(submission.id))

        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "pending"
        # updated_at bumped so the next tick does not re-dispatch.
        assert _as_utc(fresh.updated_at) == T0

    def test_leaves_fresh_pending_alone(self, monkeypatch):
        session = _make_sync_session()
        _seed(session, "pending", updated_at=T0 - timedelta(minutes=1))
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 0}
        delay.assert_not_called()

    def test_boundary_pending_not_redispatched(self, monkeypatch):
        """Exactly-at-threshold rows are not stale yet."""
        session = _make_sync_session()
        _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES),
        )
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 0}
        delay.assert_not_called()

    def test_broker_down_keeps_row_pending(self, monkeypatch):
        """A failed dispatch must not bump updated_at — next tick retries."""
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
        )
        delay = Mock(side_effect=RuntimeError("broker unreachable"))
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 0}
        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "pending"
        assert _as_utc(fresh.updated_at) == T0 - timedelta(
            minutes=PENDING_STALE_MINUTES + 1
        )


class TestRecoverKeyedProviders:
    """Per-run API keys are never persisted — re-dispatch must not run a
    doomed task for keyed providers when no worker key is available."""

    def test_keyed_provider_without_env_key_fails_fast(self, monkeypatch):
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
            provider="openai",
        )
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 1}
        delay.assert_not_called()
        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "failed"
        assert fresh.score == 0.0
        result = session.get(EvaluationResult, fresh.evaluation_result.id)
        assert result.logs == (
            "Cannot re-dispatch: openai was submitted with a per-run API key "
            "that is not stored server-side, and OPENAI_API_KEY is not "
            "configured on the worker. Please re-submit with a new API key."
        )
        assert result.metrics["error"] == "missing_api_key"
        publish.assert_called_once_with(fresh.id, "failed", error=ANY)

    def test_anthropic_without_env_key_fails_fast(self, monkeypatch):
        session = _make_sync_session()
        _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
            provider="anthropic",
        )
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 1}
        delay.assert_not_called()

    def test_keyed_provider_with_env_key_redispatches(self, monkeypatch):
        """A configured env key means re-dispatch can actually run."""
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
            provider="openai",
        )
        monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 1, "failed": 0}
        delay.assert_called_once_with(str(submission.id))

    def test_demo_provider_redispatches_without_any_key(self, monkeypatch):
        """Non-keyed providers are unaffected by the key check."""
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
            provider="demo",
        )
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 1, "failed": 0}
        delay.assert_called_once_with(str(submission.id))


class TestRecoverStaleProcessing:
    def test_fails_stale_processing(self, monkeypatch):
        session = _make_sync_session()
        submission = _seed(
            session,
            "processing",
            updated_at=T0 - timedelta(minutes=PROCESSING_STALE_MINUTES + 1),
        )
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)
        # A stale processing row must be failed, not re-dispatched.
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 1}
        delay.assert_not_called()
        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "failed"
        assert fresh.score == 0.0
        result = session.get(EvaluationResult, fresh.evaluation_result.id)
        assert result.score == 0.0
        assert "worker likely restarted" in result.logs
        assert result.metrics["error"] == "stale_processing"
        publish.assert_called_once_with(fresh.id, "failed", error=ANY)

    def test_leaves_fresh_processing_alone(self, monkeypatch):
        session = _make_sync_session()
        _seed(session, "processing", updated_at=T0 - timedelta(minutes=2))
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 0}
        delay.assert_not_called()

    def test_boundary_processing_not_failed(self, monkeypatch):
        session = _make_sync_session()
        _seed(
            session,
            "processing",
            updated_at=T0 - timedelta(minutes=PROCESSING_STALE_MINUTES),
        )
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 0}
        publish.assert_not_called()


class TestRecoverAbandonedPending:
    """A pending row that never started within PENDING_MAX_MINUTES is failed,
    not re-dispatched forever."""

    def test_pending_past_max_age_fails_without_redispatch(self, monkeypatch):
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            created_at=T0 - timedelta(minutes=PENDING_MAX_MINUTES + 1),
            # updated_at stays fresh — recovery keeps bumping it on re-send, so
            # only created_at can correctly age out the row.
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
        )
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 1}
        delay.assert_not_called()
        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "failed"
        assert fresh.score == 0.0
        result = session.get(EvaluationResult, fresh.evaluation_result.id)
        assert result.metrics["error"] == "stale_pending"
        assert "never started" in result.logs
        publish.assert_called_once_with(fresh.id, "failed", error=ANY)

    def test_pending_past_max_age_fails_even_when_updated_at_fresh(self, monkeypatch):
        """A working re-dispatch loop keeps updated_at fresh — the ceiling must
        key off created_at or a stuck worker would never be detected."""
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            created_at=T0 - timedelta(minutes=PENDING_MAX_MINUTES + 5),
            updated_at=T0 - timedelta(seconds=30),
        )
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 1}
        delay.assert_not_called()
        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "failed"
        assert fresh.evaluation_result.metrics["error"] == "stale_pending"
        publish.assert_called_once_with(fresh.id, "failed", error=ANY)

    def test_keyed_provider_no_key_fails_before_max_age_ceiling(self, monkeypatch):
        """Precedence: a keyed provider without an env key reports the truthful
        'missing key' error rather than the generic 'never started' one."""
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            created_at=T0 - timedelta(minutes=PENDING_MAX_MINUTES + 1),
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
            provider="openai",
        )
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 1}
        delay.assert_not_called()
        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "failed"
        assert fresh.evaluation_result.metrics["error"] == "missing_api_key"
        publish.assert_called_once_with(fresh.id, "failed", error=ANY)

    def test_pending_between_stale_and_max_still_redispatches(self, monkeypatch):
        """Not yet at the ceiling — normal stale re-dispatch still applies."""
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            created_at=T0 - timedelta(minutes=PENDING_MAX_MINUTES - 30),
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
        )
        delay = Mock(return_value=None)
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 1, "failed": 0}
        delay.assert_called_once_with(str(submission.id))

    def test_abandoned_pending_with_env_key_fails_not_redispatched(self, monkeypatch):
        """A keyed provider with an env key available still gets abandoned at the
        ceiling — a key is useless when the worker never picks the task up."""
        session = _make_sync_session()
        submission = _seed(
            session,
            "pending",
            created_at=T0 - timedelta(minutes=PENDING_MAX_MINUTES + 1),
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 1),
            provider="anthropic",
        )
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 1}
        delay.assert_not_called()
        session.expire_all()
        fresh = session.get(Submission, submission.id)
        assert fresh.status == "failed"
        assert fresh.evaluation_result.metrics["error"] == "stale_pending"


class TestRecoverBeatSchedule:
    def test_beat_schedule_runs_recovery_every_minute(self):
        """The recovery sweep must stay on the beat schedule for self-healing."""
        from app.core.celery_app import celery_app

        entry = celery_app.conf.beat_schedule.get("recover-stuck-submissions")
        assert entry is not None
        assert entry["task"] == "app.tasks.recover.recover_stuck_submissions"
        assert entry["schedule"] == 60.0


class TestRecoverMixedAndEdge:
    def test_mixed_statuses_handled_independently(self, monkeypatch):
        session = _make_sync_session()
        stale_pending = _seed(
            session,
            "pending",
            updated_at=T0 - timedelta(minutes=PENDING_STALE_MINUTES + 5),
        )
        _seed(
            session,
            "processing",
            updated_at=T0 - timedelta(minutes=PROCESSING_STALE_MINUTES + 5),
        )
        fresh = _seed(session, "pending", updated_at=T0 - timedelta(seconds=30))
        _seed(session, "processing", updated_at=T0 - timedelta(seconds=30))

        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 1, "failed": 1}
        delay.assert_called_once_with(str(stale_pending.id))
        publish.assert_called_once()
        session.expire_all()
        assert session.get(Submission, fresh.id).status == "pending"

    def test_terminal_statuses_are_ignored(self, monkeypatch):
        session = _make_sync_session()
        _seed(
            session,
            "completed",
            updated_at=T0 - timedelta(days=7),
        )
        _seed(
            session,
            "failed",
            updated_at=T0 - timedelta(days=7),
        )
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 0}
        delay.assert_not_called()
        publish.assert_not_called()

    def test_empty_sweep_is_noop(self, monkeypatch):
        session = _make_sync_session()
        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)
        publish = Mock()
        monkeypatch.setattr("app.tasks.recover.publish_submission_event", publish)

        summary = _run_recovery(session, now=T0)

        assert summary == {"dispatched": 0, "failed": 0}
        delay.assert_not_called()
        publish.assert_not_called()

    def test_unknown_submission_id_does_not_crash_sweep(self, monkeypatch):
        """A submission whose id exists but has no challenge still sweeps cleanly."""
        session = _make_sync_session()
        user = User(email="orphan@example.com", username="orphanuser", hashed_password="x")
        session.add(user)
        session.flush()
        orphan = Submission(
            user_id=user.id,
            challenge_id=uuid4(),
            status="pending",
            provider="demo",
        )
        session.add(orphan)
        orphan.updated_at = T0 - timedelta(minutes=PENDING_STALE_MINUTES + 5)
        session.commit()

        delay = Mock()
        monkeypatch.setattr("app.tasks.recover.evaluate_submission.delay", delay)

        summary = _run_recovery(session, now=T0)

        # The orphan is re-dispatched; the evaluation task itself handles the
        # missing challenge (marks it failed) — the sweep must not crash on it.
        assert summary == {"dispatched": 1, "failed": 0}
        delay.assert_called_once_with(str(orphan.id))
