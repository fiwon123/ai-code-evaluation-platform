"""Auto-repair loop: feedback, chaining, stop conditions, idempotency.

Covers the second and later attempts of a submission. The single-attempt path
(phase transitions, duplicate races, error handling) lives in
``test_evaluate_task.py``, which pins the budget to 1.
"""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.core.database import Base
from app.models.challenge import Challenge
from app.models.evaluation_attempt import EvaluationAttempt
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User
from app.services.evaluation import EvaluationOutcome
from app.tasks.evaluate import _run_submission_evaluation

#: The seeded challenge's suite, used to assert it is not sent to the provider.
TEST_SOURCE_MARKER = "test_no_solution"


def _make_sync_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)()


def _seed(session):
    user = User(email="repair@example.com", username="repairuser", hashed_password="x")
    session.add(user)
    session.flush()
    challenge = Challenge(
        user_id=user.id,
        title="Two Sum",
        description="find indices",
        prompt="Write a function two_sum(nums, target)",
        test_code=(
            "from solution import two_sum\n\n"
            "def test_basic():\n"
            f"    assert two_sum([2, 7, 11, 15], 9) == [0, 1]\n"
            f"def {TEST_SOURCE_MARKER}():\n"
            "    assert two_sum([1, 2, 3], 99) == []\n"
        ),
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
    session.add_all([challenge, submission])
    session.commit()
    return submission.id


def _failing(
    passed: int = 1,
    total: int = 2,
    message: str = "assert None == [0, 1]",
    leaked: str = "",
):
    """An outcome whose tests ran and failed — repairable.

    ``leaked`` appends a secret to every persisted field, standing in for a
    runner that echoes the submitted request into stdout.
    """
    suffix = f" request: Authorization: Bearer {leaked}" if leaked else ""
    return EvaluationOutcome(
        passed=passed,
        total=total,
        score=round(passed / total * 100, 1),
        logs=f"FAILED {TEST_SOURCE_MARKER} - {message}{suffix}",
        test_results=[
            {"name": "test_basic", "passed": True, "message": ""},
            {"name": TEST_SOURCE_MARKER, "passed": False, "message": message},
        ],
        metrics={"returncode": 1, "stderr": f"bearer {leaked}"} if leaked else {"returncode": 1},
    )


def _passing():
    return EvaluationOutcome(
        passed=2,
        total=2,
        score=100.0,
        logs="2 passed",
        test_results=[
            {"name": "test_basic", "passed": True, "message": ""},
            {"name": TEST_SOURCE_MARKER, "passed": True, "message": ""},
        ],
        metrics={"returncode": 0},
    )


class _Harness:
    """Records what the worker asked the provider for, attempt by attempt."""

    def __init__(self, outcomes, monkeypatch, settings_overrides=None):
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []
        self.dispatched: list[dict] = []
        for key, value in (settings_overrides or {}).items():
            monkeypatch.setattr(settings, key, value)
        monkeypatch.setattr(
            "app.tasks.evaluate.get_llm_provider",
            lambda name, api_key=None, model=None: self,
        )
        monkeypatch.setattr("app.tasks.evaluate.evaluate_code", self._evaluate)
        monkeypatch.setattr("app.tasks.evaluate.evaluate_submission.apply_async", self._apply_async)

    # --- stand-ins for the Celery/provider seams -----------------------
    def generate_code(self, prompt, language="python", feedback=None):
        self.calls.append({"prompt": prompt, "language": language, "feedback": feedback})
        return (
            f"# generated for attempt {len(self.calls)}\ndef two_sum(nums, target):\n    return []"
        )

    def _evaluate(self, **kwargs):
        return self.outcomes[min(len(self.calls) - 1, len(self.outcomes) - 1)]

    def _apply_async(self, args=None, kwargs=None):
        self.dispatched.append({"args": args, "kwargs": kwargs or {}})

    # --- assertions helpers --------------------------------------------
    @property
    def next_attempt(self):
        """Attempt number the worker queued, or None if it stopped."""
        if not self.dispatched:
            return None
        return self.dispatched[-1]["kwargs"]["attempt"]


@pytest.fixture
def harness_factory(monkeypatch):
    def build(outcomes, **settings_overrides):
        return _Harness(outcomes, monkeypatch, settings_overrides)

    return build


def _result(session, submission_id):
    """The submission's single final result row (PK is not the submission id)."""
    return session.scalar(
        select(EvaluationResult).where(EvaluationResult.submission_id == submission_id)
    )


def _attempts(session, submission_id):
    return list(
        session.scalars(
            select(EvaluationAttempt)
            .where(EvaluationAttempt.submission_id == submission_id)
            .order_by(EvaluationAttempt.attempt_number)
        )
    )


class TestRepairChain:
    def test_first_attempt_failure_queues_a_repair(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_failing()], evaluation_max_attempts=3)

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "processing"
        assert result["repairing"] is True
        assert harness.next_attempt == 2
        # No result yet — the run is not terminal.
        assert _result(session, submission_id) is None
        session.refresh(session.get(Submission, submission_id))
        submission = session.get(Submission, submission_id)
        assert submission.status == "processing"
        assert submission.phase == "repairing"
        assert len(_attempts(session, submission_id)) == 1

    def test_repair_receives_the_failure_as_feedback(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_failing(), _passing()], evaluation_max_attempts=3)

        _run_submission_evaluation(session, submission_id)
        _run_submission_evaluation(session, submission_id, attempt=2)

        repair_call = harness.calls[1]
        assert repair_call["feedback"] is not None
        # The previous code and the assertion message are both present...
        assert "def two_sum" in repair_call["feedback"]
        assert "assert None == [0, 1]" in repair_call["feedback"]
        # ...but the suite that produced the failure is not.
        assert f"def {TEST_SOURCE_MARKER}" not in repair_call["feedback"]
        # The original prompt still leads the request.
        assert repair_call["prompt"] == "Write a function two_sum(nums, target)"

    def test_first_attempt_gets_no_feedback(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_passing()], evaluation_max_attempts=3)

        _run_submission_evaluation(session, submission_id)

        assert harness.calls[0]["feedback"] is None

    def test_passing_on_the_repair_completes_with_that_score(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory([_failing(), _passing()], evaluation_max_attempts=3)

        _run_submission_evaluation(session, submission_id)
        result = _run_submission_evaluation(session, submission_id, attempt=2)

        assert result["status"] == "completed"
        assert result["score"] == 100.0
        assert result["attempt"] == 2
        stored = _result(session, submission_id)
        assert stored.score == 100.0
        assert stored.passed_tests == 2
        # Both attempts are kept, so the failed first attempt stays inspectable.
        rows = _attempts(session, submission_id)
        assert [row.attempt_number for row in rows] == [1, 2]
        assert rows[0].score == 50.0
        assert rows[1].score == 100.0

    def test_exhausting_the_budget_settles_on_the_last_attempt(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory(
            [_failing(passed=0, total=2, message="still wrong")],
            evaluation_max_attempts=3,
        )

        _run_submission_evaluation(session, submission_id)
        _run_submission_evaluation(session, submission_id, attempt=2)
        result = _run_submission_evaluation(session, submission_id, attempt=3)

        assert result["status"] == "completed"
        assert result["attempt"] == 3
        # Nothing queued past the budget.
        assert harness.next_attempt == 3
        assert len(harness.dispatched) == 2
        assert len(_attempts(session, submission_id)) == 3
        submission = session.get(Submission, submission_id)
        assert submission.status == "completed"
        assert submission.phase is None

    def test_single_attempt_budget_never_repairs(self, harness_factory):
        """``EVALUATION_MAX_ATTEMPTS=1`` reproduces the pre-repair behaviour."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_failing()], evaluation_max_attempts=1)

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "completed"
        assert result["score"] == 50.0
        assert harness.dispatched == []
        assert len(_attempts(session, submission_id)) == 1

    def test_zero_budget_is_clamped_to_one(self, harness_factory):
        """A misconfigured 0 must not divide by zero or skip the evaluation."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_failing()], evaluation_max_attempts=0)

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "completed"
        assert harness.dispatched == []

    def test_timeout_is_repairable(self, harness_factory):
        """A timeout is a defect the model can plausibly correct."""
        session = _make_sync_session()
        submission_id = _seed(session)
        timed_out = EvaluationOutcome(
            logs="Evaluation timed out after 30s",
            metrics={"error": "timeout", "duration_ms": 30_000},
        )
        harness = harness_factory([timed_out, _passing()], evaluation_max_attempts=3)

        result = _run_submission_evaluation(session, submission_id)
        assert result["repairing"] is True
        assert harness.next_attempt == 2
        rows = _attempts(session, submission_id)
        assert "timed out" in rows[0].logs_summary


class TestIdempotency:
    def test_duplicate_attempt_dispatch_does_no_work(self, harness_factory):
        """A re-sent message must not re-bill the provider or duplicate history."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_failing()], evaluation_max_attempts=3)

        first = _run_submission_evaluation(session, submission_id)
        calls_after_first = len(harness.calls)
        second = _run_submission_evaluation(session, submission_id)

        assert first["repairing"] is True
        assert second["duplicate"] is True
        # No second provider call and no second attempt row.
        assert len(harness.calls) == calls_after_first
        assert len(_attempts(session, submission_id)) == 1

    def test_recovery_resend_of_attempt_one_does_not_restart_the_chain(self, harness_factory):
        """The recovery sweep re-sends the original message mid-chain."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_failing(), _passing()], evaluation_max_attempts=3)

        _run_submission_evaluation(session, submission_id)
        resend = _run_submission_evaluation(session, submission_id)  # attempt 1 again

        assert resend["duplicate"] is True
        assert len(harness.calls) == 1
        # The queued attempt 2 still runs to completion.
        final = _run_submission_evaluation(session, submission_id, attempt=2)
        assert final["status"] == "completed"
        assert [r.attempt_number for r in _attempts(session, submission_id)] == [1, 2]

    def test_dispatch_after_result_exists_is_a_noop(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_passing()], evaluation_max_attempts=3)

        _run_submission_evaluation(session, submission_id)
        late = _run_submission_evaluation(session, submission_id, attempt=2)

        assert late["duplicate"] is True
        assert len(harness.calls) == 1

    def test_started_at_is_not_reset_by_a_repair(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory([_failing(), _passing()], evaluation_max_attempts=3)

        _run_submission_evaluation(session, submission_id)
        session.expire_all()
        first_started = session.get(Submission, submission_id).started_at
        _run_submission_evaluation(session, submission_id, attempt=2)
        session.expire_all()
        assert session.get(Submission, submission_id).started_at == first_started


class TestRepairFailures:
    def test_generation_error_is_terminal_and_not_repaired(self, harness_factory, monkeypatch):
        """A provider error is not a test failure — a retry cannot fix it."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_passing()], evaluation_max_attempts=3)

        def boom(self, prompt, language="python", feedback=None):
            raise RuntimeError("provider exploded")

        monkeypatch.setattr(harness, "generate_code", boom, raising=False)

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "failed"
        assert harness.dispatched == []
        stored = _result(session, submission_id)
        assert "provider exploded" in stored.logs
        # The failed attempt is still recorded, so history is complete.
        assert len(_attempts(session, submission_id)) == 1

    def test_broker_refusal_settles_on_the_last_attempt(self, harness_factory, monkeypatch):
        """A repair that cannot be queued must not strand the row at processing."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory([_failing()], evaluation_max_attempts=3)

        def refuse(args=None, kwargs=None):
            raise RuntimeError("broker down")

        monkeypatch.setattr("app.tasks.evaluate.evaluate_submission.apply_async", refuse)

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "completed"
        assert result["repair_dispatch_failed"] is True
        assert result["score"] == 50.0
        submission = session.get(Submission, submission_id)
        assert submission.status == "completed"
        assert submission.phase is None
        assert _result(session, submission_id) is not None

    def test_api_key_travels_with_the_repair_but_is_never_stored(
        self, harness_factory, monkeypatch
    ):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory([_failing(), _passing()], evaluation_max_attempts=3)
        key = "sk-secret-value-42"

        _run_submission_evaluation(session, submission_id, api_key=key)
        _run_submission_evaluation(session, submission_id, api_key=key, attempt=2)

        # Forwarded to the broker so attempt 2 can call the same provider
        # (asserted in test_repair_receives_the_same_api_key); ...
        # ...and absent from everything the run persisted.
        session.expire_all()
        submission = session.get(Submission, submission_id)
        result = _result(session, submission_id)
        stored = " ".join(
            [
                submission.code or "",
                result.logs,
                result.logs_summary,
                str(result.metrics),
            ]
            + [row.logs + row.logs_summary for row in _attempts(session, submission_id)]
        )
        assert key not in stored

    def test_api_key_is_redacted_from_a_stored_error(self, harness_factory, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory([_passing()], evaluation_max_attempts=3)
        key = "sk-secret-value-42"

        def leak(self, prompt, language="python", feedback=None):
            raise RuntimeError(f"auth failed with {key}")

        monkeypatch.setattr(
            "app.tasks.evaluate.get_llm_provider",
            lambda name, api_key=None, model=None: type("P", (), {"generate_code": leak})(),
        )

        _run_submission_evaluation(session, submission_id, api_key=key)

        stored = _result(session, submission_id)
        assert key not in stored.logs
        assert key not in stored.logs_summary
        assert key not in str(stored.metrics)
        assert "***" in stored.logs

    def test_repair_receives_the_same_api_key(self, harness_factory, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_failing(), _passing()], evaluation_max_attempts=3)

        _run_submission_evaluation(session, submission_id, api_key="sk-abc")

        assert harness.dispatched[0]["args"][1] == "sk-abc"


class TestFinalResultRedaction:
    """The report renders the final row, so it is redacted on its own path.

    The attempt row and the result row are written by different functions; a
    key echoed into stdout must not survive into either.
    """

    def test_api_key_is_stripped_from_the_final_result(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        secret = "sk-secret-value"
        harness_factory([_failing(leaked=secret)], evaluation_max_attempts=1)

        _run_submission_evaluation(session, submission_id, api_key=secret)

        stored = _result(session, submission_id)
        assert secret not in stored.logs
        assert secret not in stored.logs_summary
        assert secret not in str(stored.metrics)
        assert "***" in stored.logs


class TestPersistedDetail:
    def test_test_results_are_persisted_on_the_result(self, harness_factory):
        """Regression: the worker parsed per-test detail and never wrote it."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory([_passing()], evaluation_max_attempts=1)

        _run_submission_evaluation(session, submission_id)

        stored = _result(session, submission_id)
        assert stored.test_results is not None
        assert {row["name"] for row in stored.test_results} == {
            "test_basic",
            TEST_SOURCE_MARKER,
        }

    def test_attempt_rows_carry_code_logs_summary_and_detail(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory([_failing()], evaluation_max_attempts=1)

        _run_submission_evaluation(session, submission_id)

        row = _attempts(session, submission_id)[0]
        assert row.attempt_number == 1
        assert "def two_sum" in row.code
        assert row.passed_tests == 1
        assert row.total_tests == 2
        assert row.score == 50.0
        assert "assert None == [0, 1]" in row.logs
        assert "1 of 2 tests passed" in row.logs_summary
        assert row.metrics["returncode"] == 1
        assert len(row.test_results) == 2

    def test_final_result_summary_matches_the_last_attempt(self, harness_factory):
        session = _make_sync_session()
        submission_id = _seed(session)
        harness_factory(
            [_failing(message="first problem"), _failing(message="second problem")],
            evaluation_max_attempts=2,
        )

        _run_submission_evaluation(session, submission_id)
        _run_submission_evaluation(session, submission_id, attempt=2)

        stored = _result(session, submission_id)
        last = _attempts(session, submission_id)[-1]
        assert stored.logs_summary == last.logs_summary
        assert "second problem" in stored.logs_summary

    def test_earlier_attempt_is_kept_when_a_repair_regresses(self, harness_factory):
        """A worse repair must not erase the better earlier attempt."""
        session = _make_sync_session()
        submission_id = _seed(session)
        better = _failing(passed=1, total=2, message="almost")
        worse = _failing(passed=0, total=2, message="worse now")
        harness_factory([better, worse], evaluation_max_attempts=2)

        _run_submission_evaluation(session, submission_id)
        _run_submission_evaluation(session, submission_id, attempt=2)

        rows = _attempts(session, submission_id)
        assert rows[0].score == 50.0
        assert rows[1].score == 0.0
        # The result describes the last attempt, which is what was evaluated.
        assert _result(session, submission_id).score == 0.0


class TestUnknownInputs:
    def test_repair_attempt_without_history_returns_no_feedback(self, harness_factory):
        """Defensive: a queued attempt whose predecessor row is gone."""
        session = _make_sync_session()
        submission_id = _seed(session)
        harness = harness_factory([_passing()], evaluation_max_attempts=3)

        result = _run_submission_evaluation(session, submission_id, attempt=2)

        assert result["status"] == "completed"
        assert harness.calls[0]["feedback"] is None

    def test_unknown_submission(self):
        session = _make_sync_session()
        assert _run_submission_evaluation(session, uuid4())["status"] == "not_found"
