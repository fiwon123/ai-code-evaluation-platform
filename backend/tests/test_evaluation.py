import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pytest

from app.config import settings
from app.services.evaluation import (
    COLLECTION_ERROR,
    SUBPROCESS_BACKEND,
    EvaluationOutcome,
    evaluate_code,
    parse_outcome,
    parse_summary,
    run_pytest,
)
from app.services.language_runner import JAVASCRIPT_RUNNER, PYTHON_RUNNER

FE_ROOT = Path(__file__).resolve().parents[2] / "frontend"

TWO_SUM_CODE = (
    "def two_sum(nums, target):\n"
    "    seen = {}\n"
    "    for i, num in enumerate(nums):\n"
    "        complement = target - num\n"
    "        if complement in seen:\n"
    "            return [seen[complement], i]\n"
    "        seen[num] = i\n"
    "    return []\n"
)

TWO_SUM_TESTS = (
    "from solution import two_sum\n"
    "\n"
    "def test_basic():\n"
    "    assert two_sum([2, 7, 11, 15], 9) == [0, 1]\n"
    "\n"
    "def test_negative():\n"
    "    assert two_sum([-1, -2, -3, -4], -5) in ([0, 3], [1, 2])\n"
    "\n"
    "def test_no_solution():\n"
    "    assert two_sum([1, 2, 3], 99) == []\n"
)


class TestParseSummary:
    def test_all_passed(self):
        passed, total = parse_summary("3 passed in 0.05s")
        assert (passed, total) == (3, 3)

    def test_passed_and_failed(self):
        passed, total = parse_summary("== 2 passed, 1 failed in 0.05s ==")
        assert (passed, total) == (2, 3)

    def test_errored_is_not_a_test(self):
        # "1 error" is a collection failure, not a test case: pytest selected
        # nothing, so the count is 0 of 0 (issue #255).
        passed, total = parse_summary("== 1 error in 0.05s ==")
        assert (passed, total) == (0, 0)

    def test_no_tests(self):
        passed, total = parse_summary("no tests ran")
        assert (passed, total) == (0, 0)


#: Real pytest output when the test module cannot be imported (issue #255).
COLLECTION_ERROR_LOGS = (
    "E   ImportError: cannot import name 'two_sum' from 'solution' (/code/solution.py)\n"
    "=========================== short test summary info ============================\n"
    "ERROR test_solution.py\n"
    "!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!\n"
    "1 error in 0.27s"
)


class TestCollectionErrorDiagnosis:
    """A suite that never loaded is a distinct outcome from an empty one.

    ``total == 0`` alone is ambiguous (timeout, missing runner, empty file,
    broken import), so the run records *why* in ``metrics["error"]`` — the
    same channel the timeout and missing-executable paths already use.
    """

    def test_reports_no_tests_and_records_the_reason(self):
        outcome = parse_outcome(COLLECTION_ERROR_LOGS, PYTHON_RUNNER)
        assert (outcome.passed, outcome.total) == (0, 0)
        assert outcome.score == 0.0
        assert outcome.success is False
        # Not terminal: a broken import is exactly what the repair loop exists
        # to fix, so passed_all must stay False or the run would be accepted.
        assert outcome.passed_all is False
        assert outcome.test_results == []
        assert outcome.metrics["error"] == COLLECTION_ERROR
        assert outcome.metrics["error_count"] == 1

    def test_real_failures_are_not_diagnosed_as_a_collection_error(self):
        outcome = parse_outcome("1 failed, 2 passed in 0.05s", PYTHON_RUNNER)
        assert (outcome.passed, outcome.total) == (2, 3)
        assert outcome.metrics == {}

    def test_empty_suite_is_not_called_a_collection_error(self):
        # "no tests ran" means the file defined none, which is the user's
        # business — not a suite that failed to load.
        outcome = parse_outcome("no tests ran in 0.01s", PYTHON_RUNNER)
        assert (outcome.passed, outcome.total) == (0, 0)
        assert outcome.metrics == {}

    def test_other_languages_are_unaffected(self):
        # Only pytest distinguishes collection errors, so no other runner may
        # claim a diagnosis it cannot prove.
        outcome = parse_outcome(COLLECTION_ERROR_LOGS, JAVASCRIPT_RUNNER)
        assert (outcome.passed, outcome.total) == (0, 0)
        assert outcome.metrics == {}


class TestEvaluateCode:
    def test_passes_all_tests(self, tmp_path):
        outcome = evaluate_code(
            code=TWO_SUM_CODE,
            test_code=TWO_SUM_TESTS,
            workdir=tmp_path,
        )
        assert outcome.passed == 3
        assert outcome.total == 3
        assert outcome.score == 100.0
        assert outcome.success
        assert outcome.passed_all

    def test_cleans_up_workdir(self, tmp_path):
        workdir: Path = tmp_path / "eval"
        evaluate_code(
            code=TWO_SUM_CODE,
            test_code=TWO_SUM_TESTS,
            workdir=workdir,
        )
        assert not workdir.exists()

    def test_parses_counts_via_mocked_subprocess(self, tmp_path):
        fake = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="2 passed, 1 failed in 0.5s", stderr=""
        )
        with patch("app.services.evaluation.run_tests", return_value=fake):
            outcome = evaluate_code(
                code="x = 1",
                test_code="def test_a(): assert True",
                workdir=tmp_path,
            )
        assert outcome.passed == 2
        assert outcome.total == 3
        assert outcome.score == 66.7
        assert not outcome.passed_all

    def test_subprocess_path_keeps_the_collection_error_diagnosis(self, tmp_path):
        # The execution facts used to be *assigned* over the outcome's metrics,
        # which would have silently dropped the diagnosis recorded at parse
        # time — leaving the subprocess and Docker paths disagreeing.
        fake = subprocess.CompletedProcess(
            args=[], returncode=2, stdout=COLLECTION_ERROR_LOGS, stderr=""
        )
        with patch("app.services.evaluation.run_tests", return_value=fake):
            outcome = evaluate_code(
                code="def solution(*a):\n    return None\n",
                test_code="from solution import two_sum\n\ndef test_basic():\n    assert True\n",
                workdir=tmp_path,
            )
        assert (outcome.passed, outcome.total) == (0, 0)
        assert outcome.metrics["error"] == COLLECTION_ERROR
        assert outcome.metrics["error_count"] == 1
        assert outcome.metrics["returncode"] == 2
        assert outcome.metrics["language"] == "python"
        assert "duration_ms" in outcome.metrics

    def test_timeout(self, tmp_path):
        slow_tests = "import time\ndef test_slow():\n    time.sleep(5)\n"
        outcome = evaluate_code(
            code="x = 1",
            test_code=slow_tests,
            workdir=tmp_path,
            timeout=1,
        )
        assert "timed out" in outcome.logs
        assert outcome.total == 0
        assert not outcome.success

    def test_unsupported_language_raises(self, tmp_path):
        with pytest.raises(ValueError, match="not supported"):
            evaluate_code(
                code="x = 1",
                test_code="test",
                language="csharp",
                workdir=tmp_path,
            )

    def test_uses_per_language_timeout_default(self, tmp_path):
        captured = {}

        def fake_run(workdir, runner=None, timeout=30):
            captured["timeout"] = timeout
            return subprocess.CompletedProcess(
                args=[], returncode=1, stdout="2 passed in 0.5s", stderr=""
            )

        with patch("app.services.evaluation.run_tests", side_effect=fake_run):
            evaluate_code(
                code="package main",
                test_code="",
                language="go",
                workdir=tmp_path,
            )
        assert captured["timeout"] > 30  # go runner extends the default

    def test_explicit_timeout_overrides_runner_default(self, tmp_path):
        captured = {}

        def fake_run(workdir, runner=None, timeout=30):
            captured["timeout"] = timeout
            return subprocess.CompletedProcess(
                args=[], returncode=1, stdout="2 passed in 0.5s", stderr=""
            )

        with patch("app.services.evaluation.run_tests", side_effect=fake_run):
            evaluate_code(
                code="package main",
                test_code="",
                language="go",
                workdir=tmp_path,
                timeout=120,
            )
        assert captured["timeout"] == 120

    def test_no_tests_defined(self, tmp_path):
        outcome = evaluate_code(
            code=TWO_SUM_CODE,
            test_code="",
            workdir=tmp_path,
        )
        assert outcome.total == 0
        assert outcome.score == 0.0
        assert not outcome.success

    def test_workdir_is_created_when_parent_missing(self, tmp_path):
        # The subprocess path must create the configured evaluation_dir
        # (and the unique per-run workdir) when neither exists yet.
        base = tmp_path / "evaluations" / "nested"
        with patch("app.services.evaluation.settings.evaluation_dir", str(base)):
            outcome = evaluate_code(
                code=TWO_SUM_CODE,
                test_code=TWO_SUM_TESTS,
            )
        assert outcome.passed == 3
        assert base.exists()

    def test_concurrent_default_workdirs_do_not_clobber(self):
        # Without an explicit workdir each run gets its own temp dir; running
        # several in parallel must not overwrite each other's files.
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(
                    evaluate_code,
                    code=TWO_SUM_CODE,
                    test_code=TWO_SUM_TESTS,
                    timeout=10,
                )
                for _ in range(3)
            ]
            outcomes = [future.result() for future in futures]
        assert all(outcome.passed == 3 and outcome.total == 3 for outcome in outcomes)


class TestEvaluateCodeDockerPath:
    """evaluate_code() routing: Docker sandbox when enabled, else subprocess."""

    def test_uses_docker_when_enabled_and_available(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", True)

        class FakeSandbox:
            def __init__(self, *args, **kwargs):
                pass

            def is_available(self):
                return True

            def run(self, code, test_code, timeout=None, language="python"):
                return EvaluationOutcome(
                    passed=3, total=3, score=100.0, logs="", metrics={"backend": "docker"}
                )

        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", FakeSandbox)
        outcome = evaluate_code(code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path)
        assert outcome.metrics["backend"] == "docker"
        assert outcome.passed == 3

    def test_falls_back_when_docker_unavailable(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", True)

        class UnavailableSandbox:
            def __init__(self, *args, **kwargs):
                pass

            def is_available(self):
                return False

            def run(self, *args, **kwargs):
                raise AssertionError("run must not be called when unavailable")

        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", UnavailableSandbox)
        outcome = evaluate_code(code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path)
        assert outcome.passed == 3
        # The fallback names itself. This used to assert the metric was absent,
        # which codified the gap rather than describing it: a consumer asking
        # "where did this run?" got nothing, and could not tell "the fallback
        # ran" from "nothing executed" (#264).
        assert outcome.metrics["backend"] == "subprocess"

    def test_disabled_docker_uses_subprocess(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", False)

        class ShouldNotInstantiate:
            def __init__(self, *args, **kwargs):
                raise AssertionError("sandbox must not be constructed when disabled")

        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", ShouldNotInstantiate)
        outcome = evaluate_code(code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path)
        assert outcome.passed == 3

    def test_non_python_language_uses_docker(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", True)

        class FakeSandbox:
            def __init__(self, *args, **kwargs):
                self.runs = []

            def is_available(self):
                return True

            def run(self, code, test_code, timeout=None, language="python"):
                self.runs.append(language)
                return EvaluationOutcome(
                    passed=3, total=3, score=100.0, logs="", metrics={"backend": "docker"}
                )

        fake = FakeSandbox()
        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", lambda *a, **k: fake)
        outcome = evaluate_code(
            code="console.log(1)",
            test_code="",
            language="javascript",
            workdir=tmp_path,
        )
        assert outcome.metrics["backend"] == "docker"
        assert fake.runs == ["javascript"]

    def test_unsupported_language_skips_docker(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", True)
        constructed = []

        class ShouldNotConstruct:
            def __init__(self, *args, **kwargs):
                constructed.append(True)

            def is_available(self):
                return True

            def run(self, *args, **kwargs):
                raise AssertionError("run must not be called for unsupported languages")

        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", ShouldNotConstruct)
        with pytest.raises(ValueError, match="not supported"):
            evaluate_code(
                code="x = 1",
                test_code="",
                language="csharp",
                workdir=tmp_path,
            )
        assert constructed == []

    def test_sandbox_failure_propagates_when_enabled(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", True)

        class BrokenSandbox:
            def __init__(self, *args, **kwargs):
                pass

            def is_available(self):
                return True

            def run(self, *args, **kwargs):
                from app.services.docker_sandbox import DockerSandboxError

                raise DockerSandboxError("sandbox image missing")

        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", BrokenSandbox)
        from app.services.docker_sandbox import DockerSandboxError

        with patch("app.services.evaluation._evaluate_code_subprocess") as subprocess_mock:
            with pytest.raises(DockerSandboxError, match="sandbox image missing"):
                evaluate_code(code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path)
            # Sandbox guarantees untrusted code stays isolated: no host fallback.
            subprocess_mock.assert_not_called()


class TestBackendIsRecordedOnEveryPath:
    """`metrics["backend"]` must be present on *every* execution path (#264).

    The metric is the only thing that distinguishes "the subprocess fallback
    ran" from "nothing executed", and the subprocess path has three separate
    metrics dicts, so each one is asserted: a single assertion on the happy
    path would leave the timeout and missing-executable branches free to lose
    it again.
    """

    def test_success_path_records_the_backend(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", False)
        outcome = evaluate_code(code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path)
        assert outcome.metrics["backend"] == "subprocess"

    def test_timeout_branch_records_the_backend(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "docker_enabled", False)
        expired = subprocess.TimeoutExpired(cmd="pytest", timeout=30)
        with patch("app.services.evaluation.run_tests", side_effect=expired):
            outcome = evaluate_code(
                code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path
            )
        assert outcome.metrics["error"] == "timeout"
        assert outcome.metrics["backend"] == "subprocess"

    def test_missing_executable_branch_records_the_backend(self, tmp_path):
        with patch("app.services.evaluation.subprocess.run", side_effect=FileNotFoundError):
            outcome = evaluate_code(
                code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path
            )
        assert outcome.metrics["error"] == "executable missing"
        assert outcome.metrics["backend"] == "subprocess"

    def test_both_paths_name_themselves_in_the_same_vocabulary(self, monkeypatch, tmp_path):
        """The two backends are the values consumers switch on, so they are
        locked together -- a new spelling on one path would silently stop
        matching the other."""
        monkeypatch.setattr(settings, "docker_enabled", True)

        class FakeSandbox:
            def __init__(self, *args, **kwargs):
                self.image = "eval-sandbox:test"

            def is_available(self):
                return True

            def run(self, code, test_code, timeout=None, language="python"):
                return EvaluationOutcome(
                    passed=3, total=3, score=100.0, logs="", metrics={"backend": "docker"}
                )

        monkeypatch.setattr("app.services.docker_sandbox.DockerSandbox", FakeSandbox)
        docker = evaluate_code(code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path)
        monkeypatch.setattr(settings, "docker_enabled", False)
        sub = evaluate_code(code=TWO_SUM_CODE, test_code=TWO_SUM_TESTS, workdir=tmp_path)

        assert docker.metrics["backend"] == "docker"
        assert sub.metrics["backend"] == "subprocess"
        assert {docker.metrics["backend"], sub.metrics["backend"]} == {
            "docker",
            SUBPROCESS_BACKEND,
        }

    def test_the_backend_label_the_frontend_renders_exists_for_both(self):
        """Acceptance criterion 4: the UI already has the label, so the fix is
        data-side. Guarded here so a future metric rename cannot leave the
        frontend rendering a field nothing ever fills."""
        labels = Path(FE_ROOT / "src" / "utils" / "formatting.ts").read_text()
        assert "Backend" in labels


class TestRunPytest:
    def test_missing_pytest_reports_cleanly(self, tmp_path):
        with patch("app.services.evaluation.subprocess.run", side_effect=FileNotFoundError):
            outcome = evaluate_code(
                code=TWO_SUM_CODE,
                test_code=TWO_SUM_TESTS,
                workdir=tmp_path,
            )
        assert "'pytest' executable not found" in outcome.logs
        assert outcome.metrics["error"] == "executable missing"

    def test_outcome_helpers(self):
        outcome = EvaluationOutcome(passed=2, total=3)
        assert outcome.success
        assert not outcome.passed_all

    def test_run_pytest_returns_completed_process(self, tmp_path):
        # Real invocation — pytest must exist on PATH in the test environment.
        (tmp_path / "solution.py").write_text("def two_sum(nums, target):\n    return []\n")
        (tmp_path / "test_solution.py").write_text("from solution import two_sum\n")
        result = run_pytest(tmp_path, timeout=10)
        assert isinstance(result.returncode, int)


class TestEvaluateCodeRealRuntimes:
    """Real subprocess execution for runtimes present on the test host."""

    JS_SOLUTION = (
        "function twoSum(nums, target) {\n"
        "  const seen = new Map();\n"
        "  for (let i = 0; i < nums.length; i++) {\n"
        "    const complement = target - nums[i];\n"
        "    if (seen.has(complement)) return [seen.get(complement), i];\n"
        "    seen.set(nums[i], i);\n"
        "  }\n"
        "  return [];\n"
        "}\n"
        "module.exports = { twoSum };\n"
    )

    JS_TESTS = (
        "const { twoSum } = require('./solution.js');\n"
        "const test = require('node:test');\n"
        "const assert = require('node:assert');\n"
        "\n"
        "test('basic', () => {\n"
        "  assert.deepStrictEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);\n"
        "});\n"
        "test('no solution', () => {\n"
        "  assert.deepStrictEqual(twoSum([1, 2, 3], 99), []);\n"
        "});\n"
    )

    def test_javascript_end_to_end(self, tmp_path):
        if subprocess.run(["which", "node"], capture_output=True).returncode != 0:
            pytest.skip("node is not installed on this host")
        outcome = evaluate_code(
            code=self.JS_SOLUTION,
            test_code=self.JS_TESTS,
            language="javascript",
            workdir=tmp_path,
            timeout=15,
        )
        assert outcome.passed == 2
        assert outcome.total == 2
        assert outcome.score == 100.0
        assert outcome.passed_all
        assert outcome.metrics["language"] == "javascript"
