from uuid import UUID, uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.challenge import Challenge
from app.models.evaluation_result import EvaluationResult
from app.models.submission import Submission
from app.models.user import User
from app.tasks.evaluate import _run_submission_evaluation


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
        evaluation = session.get(EvaluationResult, submission.evaluation_result.id)
        assert evaluation.passed_tests == 2
        assert evaluation.total_tests == 2
        assert "duration_ms" in evaluation.metrics

    def test_unknown_submission(self):
        session = _make_sync_session()
        result = _run_submission_evaluation(session, uuid4())
        assert result["status"] == "not_found"

    def test_failed_generation_marks_failed(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)

        def boom(self, prompt, language="python"):
            raise RuntimeError("LLM down")

        monkeypatch.setattr(
            "app.tasks.evaluate.get_llm_provider",
            lambda name, api_key=None: type("P", (), {"generate_code": boom})(),
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

        def fake_get(name, api_key=None):
            captured["api_key"] = api_key
            return type(
                "P",
                (),
                {"generate_code": lambda self, prompt, language="python": correct_code},
            )()

        monkeypatch.setattr("app.tasks.evaluate.get_llm_provider", fake_get)
        result = _run_submission_evaluation(session, submission_id, api_key="sk-task")

        assert captured["api_key"] == "sk-task"
        assert result["status"] == "completed"

    def test_api_key_redacted_from_failure_logs(self, monkeypatch):
        session = _make_sync_session()
        submission_id = _seed(session)

        def boom(self, prompt, language="python"):
            raise RuntimeError("upstream rejected sk-secret-key")

        monkeypatch.setattr(
            "app.tasks.evaluate.get_llm_provider",
            lambda name, api_key=None: type("P", (), {"generate_code": boom})(),
        )
        result = _run_submission_evaluation(
            session, submission_id, api_key="sk-secret-key"
        )

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
