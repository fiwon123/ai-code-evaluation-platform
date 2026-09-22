import pytest

from app.services.language_runner import (
    GO_RUNNER,
    JAVA_RUNNER,
    JAVASCRIPT_RUNNER,
    PYTHON_RUNNER,
    TYPESCRIPT_RUNNER,
    get_runner,
    parse_go,
    parse_junit,
    parse_node,
    parse_pytest,
)


class TestRegistry:
    def test_all_supported_languages_present(self):
        for language in ("python", "javascript", "typescript", "java", "go"):
            assert get_runner(language) is not None

    def test_get_runner_returns_singleton_instances(self):
        assert get_runner("python") is PYTHON_RUNNER
        assert get_runner("javascript") is JAVASCRIPT_RUNNER
        assert get_runner("typescript") is TYPESCRIPT_RUNNER
        assert get_runner("java") is JAVA_RUNNER
        assert get_runner("go") is GO_RUNNER

    def test_unsupported_language_raises(self):
        with pytest.raises(ValueError, match="not supported"):
            get_runner("ruby")

    def test_filenames_per_language(self):
        assert (PYTHON_RUNNER.solution_filename, PYTHON_RUNNER.test_filename) == (
            "solution.py",
            "test_solution.py",
        )
        assert (JAVASCRIPT_RUNNER.solution_filename, JAVASCRIPT_RUNNER.test_filename) == (
            "solution.js",
            "test_solution.js",
        )
        assert (TYPESCRIPT_RUNNER.solution_filename, TYPESCRIPT_RUNNER.test_filename) == (
            "solution.ts",
            "test_solution.ts",
        )
        assert (JAVA_RUNNER.solution_filename, JAVA_RUNNER.test_filename) == (
            "Solution.java",
            "SolutionTest.java",
        )
        assert (GO_RUNNER.solution_filename, GO_RUNNER.test_filename) == (
            "solution.go",
            "solution_test.go",
        )


class TestCommands:
    def test_python_uses_pytest_with_relative_path(self):
        assert PYTHON_RUNNER.command[0] == "pytest"
        assert "test_solution.py" in PYTHON_RUNNER.command

    def test_javascript_uses_node_test_runner(self):
        assert JAVASCRIPT_RUNNER.command == ["node", "--test", "test_solution.js"]

    def test_typescript_uses_tsx(self):
        assert TYPESCRIPT_RUNNER.command == ["tsx", "--test", "test_solution.ts"]

    def test_java_compiles_then_runs_junit(self):
        assert JAVA_RUNNER.command[0] == "sh"
        assert JAVA_RUNNER.command[1] == "-c"
        script = JAVA_RUNNER.command[2]
        assert "javac" in script
        assert "Solution.java" in script
        assert "junit-platform-console-standalone.jar" in script
        # Class output must land on tmpfs, not the read-only rootfs.
        assert "-d /tmp/classes" in script

    def test_go_runs_vet_and_ignores_module_cache(self):
        assert GO_RUNNER.command == ["go", "test", "-v", "."]
        assert GO_RUNNER.env["GOPROXY"] == "off"
        assert GO_RUNNER.env["GOCACHE"].startswith("/tmp/")
        assert GO_RUNNER.env["GOFLAGS"] == "-mod=mod"


class TestExtraFiles:
    def test_go_ships_go_mod(self):
        assert "go.mod" in GO_RUNNER.extra_files
        assert GO_RUNNER.extra_files["go.mod"].startswith("module evaluation")

    def test_python_has_no_extra_files(self):
        assert PYTHON_RUNNER.extra_files == {}


class TestParsers:
    def test_parse_pytest_all_passed(self):
        assert parse_pytest("3 passed in 0.05s") == (3, 3)

    def test_parse_pytest_mixed(self):
        assert parse_pytest("2 passed, 1 failed in 0.05s") == (2, 3)

    def test_parse_pytest_errors(self):
        assert parse_pytest("1 error in 0.05s") == (0, 1)

    def test_parse_node_summary(self):
        output = "# pass 2\n# fail 1\n# tests 3"
        assert parse_node(output) == (2, 3)

    def test_parse_node_all_pass(self):
        assert parse_node("# pass 4\n# fail 0") == (4, 4)

    def test_parse_node_empty_output(self):
        assert parse_node("") == (0, 0)

    def test_parse_junit_summary(self):
        output = "5 tests successful\n0 tests failed"
        assert parse_junit(output) == (5, 5)

    def test_parse_junit_with_failures(self):
        output = "3 tests successful\n2 tests failed"
        assert parse_junit(output) == (3, 5)

    def test_parse_junit_empty_output(self):
        assert parse_junit("") == (0, 0)

    def test_parse_go_counts_top_level_only(self):
        output = (
            "=== RUN   TestTwoSum\n"
            "--- PASS: TestTwoSum (0.00s)\n"
            "    --- PASS: TestTwoSum/case_1 (0.00s)\n"
            "--- FAIL: TestMissing (0.00s)\n"
            "=== RUN   TestNothing\n"
            "--- PASS: TestNothing (0.00s)\n"
        )
        # Indented subtests are excluded from the count.
        assert parse_go(output) == (2, 3)

    def test_parse_go_empty_output(self):
        assert parse_go("") == (0, 0)
