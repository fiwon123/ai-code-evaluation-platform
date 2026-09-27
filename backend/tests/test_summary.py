"""Tests for the readable failure summary and the repair feedback block."""

from app.services.summary import (
    COLLECTION_ERROR,
    MAX_LISTED_TESTS,
    MAX_MESSAGE_CHARS,
    build_repair_feedback,
    format_failure_summary,
)


class TestFormatFailureSummary:
    def test_partial_failure_leads_with_counts_and_failed_tests(self):
        summary = format_failure_summary(
            passed=1,
            total=3,
            test_results=[
                {"name": "test_basic", "passed": True, "message": ""},
                {
                    "name": "test_no_solution",
                    "passed": False,
                    "message": "assert [] == [0, 1]",
                },
                {
                    "name": "test_duplicates",
                    "passed": False,
                    "message": "IndexError: list index out of range",
                },
            ],
            logs="raw runner dump\nmore dump",
        )

        assert "1 of 3 tests passed (score 33.3%)" in summary
        assert "Failed tests (2):" in summary
        assert "- test_no_solution: assert [] == [0, 1]" in summary
        assert "- test_duplicates: IndexError: list index out of range" in summary
        # A passing test is not listed as a failure.
        assert "- test_basic:" not in summary

    def test_full_pass_lists_what_ran(self):
        summary = format_failure_summary(
            passed=2,
            total=2,
            test_results=[
                {"name": "test_a", "passed": True, "message": ""},
                {"name": "test_b", "passed": True, "message": ""},
            ],
            logs="2 passed",
        )

        assert "All 2 tests passed." in summary
        assert "Passed tests: test_a, test_b" in summary
        assert "Failed tests" not in summary

    def test_timeout_outranks_counts(self):
        """A timed-out run has no per-test result, so a 0/0 headline would lie."""
        summary = format_failure_summary(
            passed=0,
            total=0,
            test_results=[],
            logs="Evaluation timed out after 30s",
            metrics={"error": "timeout"},
        )

        assert summary.startswith("The test run timed out")
        assert "0 of 0 tests passed" not in summary

    def test_missing_executable_is_named(self):
        summary = format_failure_summary(
            passed=0,
            total=0,
            test_results=[],
            logs="'pytest' executable not found",
            metrics={"error": "executable missing"},
        )

        assert "test runner never started" in summary
        assert "pytest" in summary

    def test_collection_error_says_the_suite_never_loaded(self):
        # "No tests reported a result." is true but useless here: it reads as an
        # empty test file when in fact the module could not be imported, and
        # the run is repairable.
        summary = format_failure_summary(
            passed=0,
            total=0,
            test_results=[],
            logs="E   ImportError: cannot import name 'two_sum'\n1 error in 0.27s",
            metrics={"error": COLLECTION_ERROR, "error_count": 1},
        )

        assert summary.startswith("The test suite failed to load")
        assert "no tests ran" in summary
        assert "1 collection error)" in summary
        assert "No tests reported a result." not in summary
        # The per-test-detail aside is noise when we know the suite never ran.
        assert "No per-test detail" not in summary
        # The log tail carries the import error, which is the actionable part.
        assert "ImportError" in summary

    def test_collection_error_count_is_pluralized(self):
        summary = format_failure_summary(
            passed=0,
            total=0,
            test_results=[],
            logs="2 errors in 0.10s",
            metrics={"error": COLLECTION_ERROR, "error_count": 2},
        )

        assert "2 collection errors)" in summary

    def test_no_detail_falls_back_to_a_log_tail(self):
        summary = format_failure_summary(
            passed=0,
            total=0,
            test_results=[],
            logs="Segmentation fault\ncore dumped",
        )

        assert "No tests reported a result." in summary
        assert "No per-test detail" in summary
        assert "core dumped" in summary

    def test_long_message_is_capped_to_the_first_line(self):
        message = "AssertionError: " + "x" * 500 + "\nsecond line should be dropped"
        summary = format_failure_summary(
            passed=0,
            total=1,
            test_results=[{"name": "test_long", "passed": False, "message": message}],
            logs="",
        )

        listed = next(line for line in summary.splitlines() if "test_long" in line)
        assert "second line" not in listed
        assert len(listed) <= len("- test_long: ") + MAX_MESSAGE_CHARS + 1

    def test_many_failures_are_summarized_not_dumped(self):
        test_results = [
            {"name": f"test_{i}", "passed": False, "message": "boom"}
            for i in range(MAX_LISTED_TESTS + 5)
        ]
        summary = format_failure_summary(
            passed=0,
            total=len(test_results),
            test_results=test_results,
            logs="",
        )

        assert f"Failed tests ({MAX_LISTED_TESTS + 5}):" in summary
        assert "…and 5 more" in summary
        assert summary.count("- test_") == MAX_LISTED_TESTS

    def test_log_tail_is_bounded(self):
        summary = format_failure_summary(
            passed=0,
            total=1,
            test_results=[{"name": "t", "passed": False, "message": "x"}],
            logs="L" * 50_000,
        )

        assert "truncated" in summary
        assert len(summary) < 5_000

    def test_test_source_never_leaks_into_the_summary(self):
        """The summary is shown to users and sent to providers — it must carry
        failure *messages*, not the suite that produced them."""
        test_code = "SECRET_ASSERT = 'the answer is 42'"
        summary = format_failure_summary(
            passed=0,
            total=1,
            test_results=[
                {
                    "name": "test_secret",
                    "passed": False,
                    "message": "assert wrong == 42",
                }
            ],
            logs="",
        )

        assert test_code not in summary
        assert "42" in summary  # the expectation itself does surface, by design


class TestBuildRepairFeedback:
    def _feedback(self, **overrides):
        kwargs = {
            "previous_code": "def two_sum(nums, target):\n    return []",
            "summary": (
                "1 of 2 tests passed (score 50.0%)\n"
                "Failed tests (1):\n- test_basic: assert None"
            ),
            "logs": "AssertionError at line 12\n" * 40,
            "language": "python",
            "attempt_number": 2,
            "max_attempts": 3,
            "log_tail_chars": 200,
        }
        kwargs.update(overrides)
        return build_repair_feedback(**kwargs)

    def test_carries_previous_code_and_failure_summary(self):
        feedback = self._feedback()

        assert "def two_sum(nums, target):" in feedback
        assert "assert None" in feedback
        assert "attempt 1 of 3" in feedback
        assert "python" in feedback

    def test_asks_for_complete_code_not_a_patch(self):
        feedback = self._feedback()

        assert "complete corrected solution" in feedback
        assert "not a patch" in feedback

    def test_log_tail_is_bounded_by_the_budget(self):
        feedback = self._feedback(log_tail_chars=200)

        assert "truncated" in feedback
        # The whole block stays well under what an unbounded dump would send.
        assert len(feedback) < 1_500

    def test_never_includes_the_test_source(self):
        """Only failure output is disclosed to the provider, not the suite."""
        feedback = self._feedback(summary="Failed: test_x", logs="assert 1 == 2")

        assert "def test_x" not in feedback
        assert "import" not in feedback
