import subprocess
from pathlib import Path
from unittest.mock import patch

from app.services.evaluation import (
    EvaluationOutcome,
    _parse_summary,
    evaluate_code,
    run_pytest,
)

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
        passed, total = _parse_summary("3 passed in 0.05s")
        assert (passed, total) == (3, 3)

    def test_passed_and_failed(self):
        passed, total = _parse_summary("== 2 passed, 1 failed in 0.05s ==")
        assert (passed, total) == (2, 3)

    def test_errored(self):
        passed, total = _parse_summary("== 1 error in 0.05s ==")
        assert (passed, total) == (0, 1)

    def test_no_tests(self):
        passed, total = _parse_summary("no tests ran")
        assert (passed, total) == (0, 0)


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
        with patch("app.services.evaluation.run_pytest", return_value=fake):
            outcome = evaluate_code(
                code="x = 1",
                test_code="def test_a(): assert True",
                workdir=tmp_path,
            )
        assert outcome.passed == 2
        assert outcome.total == 3
        assert outcome.score == 66.7
        assert not outcome.passed_all

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

    def test_unsupported_language(self, tmp_path):
        outcome = evaluate_code(
            code="console.log(1)",
            test_code="test",
            language="javascript",
            workdir=tmp_path,
        )
        assert "not supported" in outcome.metrics["error"]
        assert outcome.total == 0

    def test_no_tests_defined(self, tmp_path):
        outcome = evaluate_code(
            code=TWO_SUM_CODE,
            test_code="",
            workdir=tmp_path,
        )
        assert outcome.total == 0
        assert outcome.score == 0.0
        assert not outcome.success


class TestRunPytest:
    def test_missing_pytest_reports_cleanly(self, tmp_path):
        with patch("app.services.evaluation.subprocess.run", side_effect=FileNotFoundError):
            outcome = evaluate_code(
                code=TWO_SUM_CODE,
                test_code=TWO_SUM_TESTS,
                workdir=tmp_path,
            )
        assert "pytest executable not found" in outcome.logs
        assert outcome.metrics["error"] == "pytest missing"

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
