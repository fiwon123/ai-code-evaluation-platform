from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User
from app.services.evaluation import EvaluationOutcome
from app.tasks.evaluate import _run_submission_evaluation
from tests.conftest import fake_provider as _fake_provider


def _always_fails(exc: Exception):
    """A ``generate_code`` stand-in that always fails with ``exc``.

    Named rather than a lambda so a test reads as "this provider is down"
    instead of a generator-expression trick.
    """

    def generate_code(self, prompt, language="python", feedback=None):
        raise exc

    return generate_code


def _stored_result(session, submission_id):
    """The submission's result row, re-read so metrics are the persisted ones."""
    session.expire_all()
    submission = session.get(Submission, submission_id)
    return session.get(EvaluationResult, submission.evaluation_result.id)


def _make_sync_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)()


def _seed(session) -> UUID:
    user = User(email="eval@example.com", username="evaluser", hashed_password="x")
    session.add(user)
    session.flush()  # materialize user.id before FK references
    challenge = Challenge(
        user_id=user.id,
        title="Two Sum",
        description="find indices",
        prompt=(
            "Write a function two_sum(nums, target) returning indices of "
            "the two numbers that sum to target"
        ),
        test_code=(
            "from solution import two_sum\n\n"
            "def test_basic():\n"
            "    assert two_sum([2, 7, 11, 15], 9) == [0, 1]\n"
            "\n"
            "def test_no_solution():\n"
            "    assert two_sum([1, 2, 3], 99) == []\n"
        ),
        language="python",
    )
    session.add(challenge)
    session.flush()  # materialize challenge.id before submission FK
    submission = Submission(
        user_id=user.id,
        challenge_id=challenge.id,
        status="pending",
        provider="demo",
    )
    session.add_all([user, challenge, submission])
    session.commit()
    return submission.id


@pytest.fixture(autouse=True)
def _single_attempt(monkeypatch):
    """Keep these tests on the single-attempt path.

    They cover phase transitions, duplicate races and error handling — not the
    repair loop (see tests/test_repair_task.py). Pinning the budget to 1 keeps
    a failing run terminal in one attempt, which is what they assert against.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "evaluation_max_attempts", 1)


class TestSubmissionEvaluation:
    def test_full_success_flow(self):
        session = _make_sync_session()
        submission_id = _seed(session)

        result = _run_submission_evaluation(session, submission_id)

        session.expire_all()
        submission = session.get(Submission, submission_id)
        assert result["status"] == "completed"
        assert result["passed"] == 2
        assert result["total"] == 2
        assert result["score"] == 100.0
        assert submission.status == "completed"
        assert submission.score == 100.0
        assert submission.code is not None
        assert "def two_sum" in submission.code
        # Terminal rows clear the pipeline phase but keep started_at.
        assert submission.phase is None
        assert submission.started_at is not None
        evaluation = session.get(EvaluationResult, submission.evaluation_result.id)
        assert evaluation.passed_tests == 2
        assert evaluation.total_tests == 2
        assert "duration_ms" in evaluation.metrics

    def test_phase_is_generating_then_testing(self, monkeypatch):
        """The worker records generator vs test-execution phase mid-run."""
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(engine, expire_on_commit=False)
        session = session_factory()
        submission_id = _seed(session)
        observed: list[str | None] = []

        def fake_generate(self, prompt, language="python", feedback=None):
            # Runs right after the task commits phase="generating" — read the
            # row from a second session over the same engine.
            with session_factory() as other:
                observed.append(other.get(Submission, submission_id).phase)
            return "def two_sum(nums, target):\n    return []\n"

        def fake_evaluate(**kwargs):
            # Runs right after the task commits phase="testing".
            with session_factory() as other:
                observed.append(other.get(Submission, submission_id).phase)
            return EvaluationOutcome(
                passed=0, total=2, score=0.0, logs="ran", metrics={"duration_ms": 5}
            )

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(generate_code=fake_generate),
        )
        monkeypatch.setattr("app.tasks.evaluate.evaluate_code", fake_evaluate)

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "completed"
        assert observed == ["generating", "testing"]
        session.expire_all()
        final = session.get(Submission, submission_id)
        assert final.phase is None
        assert final.started_at is not None

    def test_failure_clears_phase(self, monkeypatch):
        """A failure during the testing phase resets the phase to None."""
        session = _make_sync_session()
        submission_id = _seed(session)

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(
                {
                    "generate_code": (
                        lambda self, prompt, language="python", feedback=None: "x = 1"
                    ),
                },
            )(),
        )

        def boom(**kwargs):
            raise RuntimeError("sandbox exploded")

        monkeypatch.setattr("app.tasks.evaluate.evaluate_code", boom)
        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "failed"
        session.expire_all()
        final = session.get(Submission, submission_id)
        assert final.phase is None
        assert final.started_at is not None

    def test_unknown_submission(self):
        session = _make_sync_session()
        result = _run_submission_evaluation(session, uuid4())
        assert result["status"] == "not_found"

    def test_duplicate_dispatch_skips_when_result_exists(self, monkeypatch):
        """A completed submission re-dispatched by recovery is a no-op."""
        session = _make_sync_session()
        submission_id = _seed(session)
        assert _run_submission_evaluation(session, submission_id)["status"] == "completed"

        calls = []

        def fake_get(name, api_key=None, model=None):
            calls.append(name)
            return _fake_provider(
                generate_code=lambda self, prompt, language="python", feedback=None: ""
            )

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)
        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "completed"
        assert result["duplicate"] is True
        assert calls == []  # provider never invoked — nothing to evaluate

    def test_duplicate_success_commit_race_is_noop(self, monkeypatch):
        """If a concurrent run writes the result first, this run backs off."""
        session = _make_sync_session()
        submission_id = _seed(session)

        def fake_generate(self, prompt, language="python", feedback=None):
            # Simulate the duplicate run winning: a result already exists.
            session.add(
                EvaluationResult(
                    submission_id=submission_id,
                    passed_tests=2,
                    total_tests=2,
                    score=100.0,
                    logs="winner",
                    metrics={},
                )
            )
            session.commit()
            return "def two_sum(nums, target):\n    return []\n"

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(generate_code=fake_generate),
        )
        monkeypatch.setattr(
            "app.tasks.evaluate.evaluate_code",
            lambda **kwargs: EvaluationOutcome(
                passed=0, total=2, score=0.0, logs="loser", metrics={}
            ),
        )

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "completed"
        assert result["duplicate"] is True
        session.expire_all()
        fresh = session.get(Submission, submission_id)
        assert fresh.status == "completed"
        # The winner's result survived; the loser's did not overwrite it.
        assert session.get(EvaluationResult, fresh.evaluation_result.id).logs == "winner"

    def test_duplicate_settle_publishes_completed_event(self, monkeypatch):
        """The silent duplicate-settle path still tells WS clients about it."""
        session = _make_sync_session()
        submission_id = _seed(session)
        published: list[tuple[object, str]] = []

        def fake_publish(submission_id, event_type, **fields):
            published.append((submission_id, event_type, fields))

        monkeypatch.setattr("app.tasks.evaluate.publish_submission_event", fake_publish)

        def fake_generate(self, prompt, language="python", feedback=None):
            # The winning duplicate already recorded its result mid-run.
            session.add(
                EvaluationResult(
                    submission_id=submission_id,
                    passed_tests=2,
                    total_tests=2,
                    score=100.0,
                    logs="winner",
                    metrics={},
                )
            )
            session.commit()
            return "def two_sum(nums, target):\n    return []\n"

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(generate_code=fake_generate),
        )
        monkeypatch.setattr(
            "app.tasks.evaluate.evaluate_code",
            lambda **kwargs: EvaluationOutcome(
                passed=0, total=2, score=0.0, logs="loser", metrics={}
            ),
        )

        result = _run_submission_evaluation(session, submission_id)

        assert result["duplicate"] is True
        # A completed event must be published for the settled row.
        assert any(event == "completed" for _, event, _ in published)
        session.expire_all()
        fresh = session.get(Submission, submission_id)
        assert fresh.status == "completed"
        assert fresh.phase is None

    def test_duplicate_failure_commit_race_is_noop(self, monkeypatch):
        """Failure path also backs off when a duplicate already wrote a result."""
        session = _make_sync_session()
        submission_id = _seed(session)

        def boom(self, prompt, language="python", feedback=None):
            session.add(
                EvaluationResult(
                    submission_id=submission_id,
                    passed_tests=2,
                    total_tests=2,
                    score=100.0,
                    logs="winner",
                    metrics={},
                )
            )
            session.commit()
            raise RuntimeError("LLM down")

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(generate_code=boom),
        )

        result = _run_submission_evaluation(session, submission_id)

        assert result["status"] == "failed"
        assert result["duplicate"] is True
        session.expire_all()
        fresh = session.get(Submission, submission_id)
        # Row-level outcome is whatever the winner recorded — no crash, no
        # orphaned processing state.
        assert fresh.status == "completed"

    def test_failed_generation_marks_failed(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)

        def boom(self, prompt, language="python", feedback=None):
            raise RuntimeError("LLM down")

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(generate_code=boom),
        )
        result = _run_submission_evaluation(session, submission_id)

        session.expire_all()
        submission = session.get(Submission, submission_id)
        assert submission.status == "failed"
        assert submission.score == 0.0
        assert result["status"] == "failed"
        assert "LLM down" in result["error"]
        evaluation = session.get(EvaluationResult, submission.evaluation_result.id)
        assert "LLM down" in evaluation.logs

    def test_api_key_forwarded_to_provider(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)
        captured: dict[str, str] = {}

        correct_code = (
            "def two_sum(nums, target):\n"
            "    seen = {}\n"
            "    for i, n in enumerate(nums):\n"
            "        if target - n in seen:\n"
            "            return [seen[target - n], i]\n"
            "        seen[n] = i\n"
            "    return []\n"
        )

        def fake_get(name, api_key=None, model=None):
            captured["api_key"] = api_key
            return _fake_provider(
                generate_code=lambda self, prompt, language="python", feedback=None: correct_code
            )

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)
        result = _run_submission_evaluation(session, submission_id, api_key="sk-task")

        assert captured["api_key"] == "sk-task"
        assert result["status"] == "completed"

    def test_api_key_redacted_from_failure_logs(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)

        def boom(self, prompt, language="python", feedback=None):
            raise RuntimeError("upstream rejected sk-secret-key")

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(generate_code=boom),
        )
        result = _run_submission_evaluation(session, submission_id, api_key="sk-secret-key")

        session.expire_all()
        submission = session.get(Submission, submission_id)
        evaluation = session.get(EvaluationResult, submission.evaluation_result.id)
        assert "sk-secret-key" not in result["error"]
        assert "***" in result["error"]
        assert "sk-secret-key" not in evaluation.logs
        assert "***" in evaluation.logs
        assert "sk-secret-key" not in evaluation.metrics["error"]

    def test_missing_challenge_marks_failed(self):
        session = _make_sync_session()
        user = User(email="x@example.com", username="xuser", hashed_password="x")
        session.add(user)
        session.flush()  # materialize user.id before FK reference
        orphan = Submission(
            user_id=user.id,
            challenge_id=uuid4(),
            status="pending",
            provider="demo",
        )
        session.add(orphan)
        session.commit()

        result = _run_submission_evaluation(session, orphan.id)
        assert result["status"] == "failed"
        assert "challenge not found" in result["error"]

        session.expire_all()
        fresh = session.get(Submission, orphan.id)
        assert fresh.status == "failed"

    def test_sandbox_failure_marks_failed(self, monkeypatch):
        """A broken sandbox must fail the submission — never run untrusted code on the host."""
        from app.config import settings
        from app.services.docker_sandbox import DockerSandboxError

        monkeypatch.setattr(settings, "docker_enabled", True)

        class BrokenSandbox:
            def __init__(self, *args, **kwargs):
                pass

            def is_available(self):
                return True

            def run(self, *args, **kwargs):
                raise DockerSandboxError("sandbox image missing")

        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", BrokenSandbox)

        session = _make_sync_session()
        submission_id = _seed(session)

        result = _run_submission_evaluation(session, submission_id)

        session.expire_all()
        submission = session.get(Submission, submission_id)
        assert submission.status == "failed"
        assert submission.score == 0.0
        assert result["status"] == "failed"
        assert "sandbox image missing" in result["error"]
        evaluation = session.get(EvaluationResult, submission.evaluation_result.id)
        assert "sandbox image missing" in evaluation.logs


class TestFallbackProvenance:
    """The report must say which provider actually produced the code.

    A run served by the fallback carries another model's work, so the metrics
    row is the only place the UI learns about it. These cover the task wiring
    (the fallback service itself is tested in ``test_llm_fallback.py``).
    """

    def test_normal_run_records_no_fallback_metrics(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)

        _run_submission_evaluation(session, submission_id)

        result = _stored_result(session, submission_id)
        assert "fallback_used" not in result.metrics
        assert "primary_error" not in result.metrics

    def test_fallback_run_records_provenance_on_the_result(self, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "llm_fallback_provider", "ollama")
        monkeypatch.setattr(settings, "llm_fallback_model", "tinyllama")

        used: list[str] = []

        def fake_get(name, api_key=None, model=None):
            used.append(name)

            def generate_code(self, prompt, language="python", feedback=None):
                if name == "groq":
                    raise RuntimeError("429 rate_limit_exceeded")
                return "def two_sum(nums, target):\n    return [0, 1]\n"

            return _fake_provider(generate_code=generate_code)

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)
        monkeypatch.setattr(
            "app.tasks.evaluate.evaluate_code",
            lambda **kwargs: EvaluationOutcome(
                passed=2, total=2, score=100.0, logs="ok", metrics={"duration_ms": 7}
            ),
        )

        session = _make_sync_session()
        submission_id = _seed(session)
        submission = session.get(Submission, submission_id)
        submission.provider = "groq"
        session.commit()

        outcome = _run_submission_evaluation(session, submission_id)

        assert outcome["status"] == "completed"
        assert used == ["groq", "ollama"]
        result = _stored_result(session, submission_id)
        assert result.metrics["fallback_used"] is True
        assert result.metrics["fallback_provider"] == "ollama"
        assert result.metrics["fallback_model"] == "tinyllama"
        assert "429" in result.metrics["primary_error"]
        # The sandbox's own metrics survive alongside the provenance.
        assert result.metrics["duration_ms"] == 7

    def test_the_per_run_key_is_not_handed_to_the_fallback(self, monkeypatch):
        """The primary's key must never be sent to a different vendor."""
        from app.config import settings

        monkeypatch.setattr(settings, "llm_fallback_provider", "ollama")
        monkeypatch.setattr(settings, "llm_fallback_model", "tinyllama")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        keys: list[tuple[str, str | None]] = []

        def fake_get(name, api_key=None, model=None):
            keys.append((name, api_key))
            if name == "groq":
                return _fake_provider(generate_code=_always_fails(RuntimeError("boom")))
            return _fake_provider(
                generate_code=lambda self, p, language="python", feedback=None: "x = 1"
            )

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        session = _make_sync_session()
        submission_id = _seed(session)
        submission = session.get(Submission, submission_id)
        submission.provider = "groq"
        session.commit()

        _run_submission_evaluation(session, submission_id, api_key="sk-primary-secret")

        assert keys == [("groq", "sk-primary-secret"), ("ollama", None)]

    def test_both_providers_failing_still_fails_the_submission(self, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "llm_fallback_provider", "ollama")
        monkeypatch.setattr(settings, "llm_fallback_model", "tinyllama")

        def fake_get(name, api_key=None, model=None):
            return _fake_provider(generate_code=_always_fails(RuntimeError(f"{name} is down")))

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        session = _make_sync_session()
        submission_id = _seed(session)
        submission = session.get(Submission, submission_id)
        submission.provider = "groq"
        session.commit()

        outcome = _run_submission_evaluation(session, submission_id)

        assert outcome["status"] == "failed"
        # The message names both, so the operator can see which one to fix.
        assert "groq is down" in outcome["error"]
        assert "ollama is down" in outcome["error"]
        session.expire_all()
        assert session.get(Submission, submission_id).status == "failed"


    def test_a_soft_time_limit_is_named_in_the_result_metrics(self, monkeypatch):
        """A run killed by the task budget must not look like a provider outage.

        The soft limit arrives as an ordinary ``Exception`` and is caught by the
        broad handler, so before #272 it was recorded as a bare
        ``SoftTimeLimitExceeded()`` -- indistinguishable from a provider that
        failed to answer, which is the wrong bug to go looking for.
        """
        from billiard.exceptions import SoftTimeLimitExceeded

        def fake_get(name, api_key=None, model=None):
            return _fake_provider(
                generate_code=_always_fails(SoftTimeLimitExceeded(390,))
            )

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        session = _make_sync_session()
        submission_id = _seed(session)

        outcome = _run_submission_evaluation(session, submission_id)

        assert outcome["status"] == "failed"
        session.expire_all()
        result = session.query(EvaluationResult).filter_by(submission_id=submission_id).one()
        assert result.metrics["error_kind"] == "task_soft_time_limit"
        # The human message is still there for the UI; the kind is for matching.
        assert "SoftTimeLimitExceeded" in result.metrics["error"]

    def test_an_ordinary_provider_error_carries_no_error_kind(self, monkeypatch):
        """Only classified failures get the key, so it never renders as a null."""
        def fake_get(name, api_key=None, model=None):
            return _fake_provider(generate_code=_always_fails(RuntimeError("403 denied")))

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        session = _make_sync_session()
        submission_id = _seed(session)

        _run_submission_evaluation(session, submission_id)

        session.expire_all()
        result = session.query(EvaluationResult).filter_by(submission_id=submission_id).one()
        assert "error_kind" not in result.metrics
        assert "403 denied" in result.metrics["error"]


class _SteppedClock:
    """Monotonic stand-in that jumps by a fixed step on every read.

    Bound to the task module's ``time`` (not the stdlib module) so the test can
    assert exact durations without sleeping: two reads — the start mark and the
    one after generation returns — always yield ``step_ms``.
    """

    def __init__(self, step_ms: int = 250) -> None:
        self._step = step_ms / 1000
        self._now = 0.0
        self.reads = 0

    def monotonic(self) -> float:
        self.reads += 1
        self._now += self._step
        return self._now

    def burn(self, steps: int) -> None:
        """Simulate time passing (a sandbox run, a slow provider)."""
        for _ in range(steps):
            self.monotonic()


def _bind_clock(monkeypatch, step_ms: int = 250) -> _SteppedClock:
    clock = _SteppedClock(step_ms)
    monkeypatch.setattr("app.tasks.evaluate.time", clock)
    return clock


class TestGenerationMetrics:
    """Every attempt records how long generation took, and which attempt it was.

    ``duration_ms`` covers the whole run (queue wait included), so it cannot
    separate a slow provider from a slow sandbox. A run that never reached the
    sandbox is exactly the one that needs the answer, so the metric is recorded
    on the failure path too.
    """

    def test_success_records_generation_time_and_attempt(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)
        clock = _bind_clock(monkeypatch)

        def fake_evaluate(**kwargs):
            # The sandbox burns clock too — those reads must not reach the
            # generation metric.
            clock.burn(4)
            return EvaluationOutcome(
                passed=2, total=2, score=100.0, logs="ok", metrics={"duration_ms": 7}
            )

        monkeypatch.setattr("app.tasks.evaluate.evaluate_code", fake_evaluate)

        _run_submission_evaluation(session, submission_id)

        result = _stored_result(session, submission_id)
        assert result.metrics["generation_ms"] == 250
        assert result.metrics["attempt"] == 1
        # The sandbox's own metrics are untouched alongside the new ones.
        assert result.metrics["duration_ms"] == 7

    def test_generation_failure_records_the_time_it_took_to_fail(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)
        clock = _bind_clock(monkeypatch)

        def boom(self, prompt, language="python", feedback=None):
            clock.burn(3)  # a provider that stalled before giving up
            raise RuntimeError("provider read timeout")

        monkeypatch.setattr(
            "app.services.llm_fallback.get_llm_provider",
            lambda name, api_key=None, model=None: _fake_provider(generate_code=boom),
        )

        outcome = _run_submission_evaluation(session, submission_id)

        assert outcome["status"] == "failed"
        result = _stored_result(session, submission_id)
        assert "provider read timeout" in result.metrics["error"]
        # Start mark + 3 stalled steps + the read after the raise = 4 steps.
        assert result.metrics["generation_ms"] == 1000
        assert result.metrics["attempt"] == 1

    def test_sandbox_failure_keeps_the_generation_time(self, monkeypatch):
        """Generation already returned, so its duration is known and usable."""
        session = _make_sync_session()
        submission_id = _seed(session)
        clock = _bind_clock(monkeypatch)

        def fake_evaluate(**kwargs):
            clock.burn(6)  # a slow, then broken, sandbox
            raise RuntimeError("sandbox image missing")

        monkeypatch.setattr("app.tasks.evaluate.evaluate_code", fake_evaluate)

        outcome = _run_submission_evaluation(session, submission_id)

        assert outcome["status"] == "failed"
        result = _stored_result(session, submission_id)
        assert "sandbox image missing" in result.metrics["error"]
        # Two reads only: the sandbox's time is not added to generation.
        assert result.metrics["generation_ms"] == 250
        assert result.metrics["attempt"] == 1

    def test_a_repair_attempt_records_its_own_number(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)
        _bind_clock(monkeypatch)

        monkeypatch.setattr(
            "app.tasks.evaluate.evaluate_code",
            lambda **kwargs: EvaluationOutcome(
                passed=2, total=2, score=100.0, logs="ok", metrics={"duration_ms": 9}
            ),
        )

        # Attempt 2 is a repair; the metric must say 2, not "the first one".
        _run_submission_evaluation(session, submission_id, attempt=2)

        result = _stored_result(session, submission_id)
        assert result.metrics["attempt"] == 2
