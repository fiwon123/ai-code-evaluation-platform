import pytest

from app.services.language_runner import (
    C_RUNNER,
    CPP_RUNNER,
    GO_RUNNER,
    JAVA_RUNNER,
    JAVASCRIPT_RUNNER,
    KOTLIN_RUNNER,
    LUA_RUNNER,
    PERL_RUNNER,
    PHP_RUNNER,
    PYTHON_RUNNER,
    RUBY_RUNNER,
    RUST_RUNNER,
    TYPESCRIPT_RUNNER,
    get_runner,
    parse_go,
    parse_go_detail,
    parse_junit,
    parse_junit_detail,
    parse_node,
    parse_node_detail,
    parse_pass_fail,
    parse_pass_fail_detail,
    parse_pytest,
    parse_pytest_detail,
    parse_pytest_errors,
)
from app.services.languages import EXECUTABLE_LANGUAGES


class TestRegistry:
    def test_all_supported_languages_present(self):
        for language in EXECUTABLE_LANGUAGES:
            assert get_runner(language) is not None

    def test_get_runner_returns_singleton_instances(self):
        assert get_runner("python") is PYTHON_RUNNER
        assert get_runner("javascript") is JAVASCRIPT_RUNNER
        assert get_runner("typescript") is TYPESCRIPT_RUNNER
        assert get_runner("java") is JAVA_RUNNER
        assert get_runner("go") is GO_RUNNER
        assert get_runner("c") is C_RUNNER
        assert get_runner("cpp") is CPP_RUNNER
        assert get_runner("rust") is RUST_RUNNER
        assert get_runner("php") is PHP_RUNNER
        assert get_runner("ruby") is RUBY_RUNNER
        assert get_runner("perl") is PERL_RUNNER
        assert get_runner("kotlin") is KOTLIN_RUNNER
        assert get_runner("lua") is LUA_RUNNER

    def test_unsupported_language_raises(self):
        with pytest.raises(ValueError, match="not supported"):
            get_runner("csharp")

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
        assert (C_RUNNER.solution_filename, C_RUNNER.test_filename) == (
            "solution.c",
            "test_solution.c",
        )
        assert (CPP_RUNNER.solution_filename, CPP_RUNNER.test_filename) == (
            "solution.cpp",
            "test_solution.cpp",
        )
        assert (RUST_RUNNER.solution_filename, RUST_RUNNER.test_filename) == (
            "solution.rs",
            "test_solution.rs",
        )
        assert (PHP_RUNNER.solution_filename, PHP_RUNNER.test_filename) == (
            "solution.php",
            "test_solution.php",
        )
        assert (RUBY_RUNNER.solution_filename, RUBY_RUNNER.test_filename) == (
            "solution.rb",
            "test_solution.rb",
        )
        assert (PERL_RUNNER.solution_filename, PERL_RUNNER.test_filename) == (
            "solution.pl",
            "test_solution.pl",
        )
        assert (LUA_RUNNER.solution_filename, LUA_RUNNER.test_filename) == (
            "solution.lua",
            "test_solution.lua",
        )
        assert (KOTLIN_RUNNER.solution_filename, KOTLIN_RUNNER.test_filename) == (
            "solution.kt",
            "test_solution.kt",
        )


class TestCommands:
    def test_python_uses_pytest_with_relative_path(self):
        assert PYTHON_RUNNER.command[0] == "pytest"
        assert "test_solution.py" in PYTHON_RUNNER.command

    def test_python_requests_per_test_summary(self):
        # -rA makes pytest print a PASSED/FAILED line per test, which the
        # detail parser needs for the per-test breakdown.
        assert "-rA" in PYTHON_RUNNER.command

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

    def test_compiled_runners_build_into_mktemp(self):
        for runner in (C_RUNNER, CPP_RUNNER, RUST_RUNNER, KOTLIN_RUNNER):
            assert runner.command[:2] == ["sh", "-c"]
            script = runner.command[2]
            assert "mktemp -d" in script
            assert "rm -rf" in script
            assert "exit $rc" in script

    def test_c_compiles_with_gcc(self):
        script = C_RUNNER.command[2]
        assert "gcc -std=c11 -Wall solution.c test_solution.c" in script

    def test_cpp_compiles_with_gpp(self):
        script = CPP_RUNNER.command[2]
        assert "g++ -std=c++17 -Wall solution.cpp test_solution.cpp" in script

    def test_rust_compiles_crate_root(self):
        script = RUST_RUNNER.command[2]
        assert "rustc --edition 2021 -O test_solution.rs" in script

    def test_kotlin_compiles_then_runs_jar(self):
        script = KOTLIN_RUNNER.command[2]
        assert "kotlinc solution.kt test_solution.kt -include-runtime" in script
        assert 'java -jar "$d/tests.jar"' in script

    def test_interpreted_runners_invoke_the_runtime(self):
        assert PHP_RUNNER.command == ["php", "test_solution.php"]
        assert RUBY_RUNNER.command == ["ruby", "test_solution.rb"]
        assert PERL_RUNNER.command == ["perl", "test_solution.pl"]
        assert LUA_RUNNER.command == ["lua5.4", "test_solution.lua"]


class TestTimeouts:
    def test_python_uses_global_default(self):
        assert PYTHON_RUNNER.timeout == 30

    def test_javascript_and_typescript_share_python_default(self):
        assert JAVASCRIPT_RUNNER.timeout == 30
        assert TYPESCRIPT_RUNNER.timeout == 30

    def test_java_gets_compilation_headroom(self):
        assert JAVA_RUNNER.timeout > PYTHON_RUNNER.timeout

    def test_go_gets_compilation_headroom(self):
        assert GO_RUNNER.timeout > PYTHON_RUNNER.timeout

    def test_new_compiled_runners_get_compilation_headroom(self):
        for runner in (C_RUNNER, CPP_RUNNER, RUST_RUNNER, KOTLIN_RUNNER):
            assert runner.timeout > PYTHON_RUNNER.timeout
            assert runner.timeout == GO_RUNNER.timeout - 30  # shared _COMPILE_BUDGET

    def test_new_interpreted_runners_share_python_default(self):
        for runner in (PHP_RUNNER, RUBY_RUNNER, PERL_RUNNER, LUA_RUNNER):
            assert runner.timeout == PYTHON_RUNNER.timeout


class TestExtraFiles:
    def test_go_ships_go_mod(self):
        assert "go.mod" in GO_RUNNER.extra_files
        assert GO_RUNNER.extra_files["go.mod"].startswith("module evaluation")

    def test_python_has_no_extra_files(self):
        assert PYTHON_RUNNER.extra_files == {}

    def test_python_runner_detects_errors(self):
        # Without this hook a collection error would be indistinguishable from
        # an empty suite, and the run would report a bare 0 of 0.
        assert PYTHON_RUNNER.detect_errors is parse_pytest_errors


class TestParsers:
    def test_parse_pytest_all_passed(self):
        assert parse_pytest("3 passed in 0.05s") == (3, 3)

    def test_parse_pytest_mixed(self):
        assert parse_pytest("2 passed, 1 failed in 0.05s") == (2, 3)

    def test_parse_pytest_collection_error_is_not_a_test(self):
        # A module that fails to import aborts collection: pytest selects zero
        # tests, so the honest count is 0 of 0. Folding the "1 error" in here
        # is what made the platform tell a user one of their tests ran and
        # failed when nothing ran at all (issue #255).
        output = (
            "ERROR test_solution.py\n"
            "!!!! Interrupted: 1 error during collection !!!!\n"
            "1 error in 0.27s"
        )
        assert parse_pytest(output) == (0, 0)

    def test_parse_pytest_errors_counts_them_separately(self):
        output = "ERROR test_solution.py\n1 error in 0.27s"
        assert parse_pytest_errors(output) == 1

    def test_parse_pytest_errors_ignores_non_outcome_text(self):
        # An error word in a test name, in traceback prose, or in a real
        # failure must not be counted as a runner error.
        assert parse_pytest_errors("2 passed in 0.05s\n1 error handling test skipped") == 0
        assert parse_pytest_errors("E   ImportError: 1 error while importing") == 0
        assert parse_pytest_errors("no tests ran in 0.01s") == 0

    def test_parse_pytest_teardown_error_does_not_widen_total(self):
        # A teardown error alongside a real outcome: the counts line decides.
        assert parse_pytest("1 passed, 1 error in 0.51s") == (1, 1)
        assert parse_pytest_errors("1 passed, 1 error in 0.51s") == 1

    def test_parse_pytest_real_failures_still_count(self):
        assert parse_pytest("1 failed, 2 passed in 0.05s") == (2, 3)

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

    def test_parse_pass_fail_counts_lines(self):
        output = "PASS: two_sum basic\nFAIL: valid_parentheses mismatched\nPASS: lcp"
        assert parse_pass_fail(output) == (2, 3)

    def test_parse_pass_fail_all_pass(self):
        assert parse_pass_fail("PASS: a\nPASS: b") == (2, 2)

    def test_parse_pass_fail_empty_output(self):
        assert parse_pass_fail("") == (0, 0)

    def test_parse_pass_fail_ignores_non_protocol_lines(self):
        output = "compiling...\nPASS: a\ngcc: warning: none\n"
        assert parse_pass_fail(output) == (1, 1)


class TestDetailParsers:
    """Per-test-case breakdown parsers (WP1: report deep-dive)."""

    def test_pytest_detail_mixed_output(self):
        output = (
            "FF.\n"
            "FAILED test_solution.py::test_edge_case - assert 1 == 2\n"
            "PASSED test_solution.py::test_two_sum\n"
        )
        passed, total, details = parse_pytest_detail(output)
        assert (passed, total) == (1, 2)
        assert details == [
            {
                "name": "test_edge_case",
                "passed": False,
                "message": "assert 1 == 2",
            },
            {"name": "test_two_sum", "passed": True, "message": None},
        ]

    def test_pytest_detail_all_passed(self):
        output = (
            "...\n"
            "PASSED test_solution.py::test_a\n"
            "PASSED test_solution.py::test_b\n"
            "PASSED test_solution.py::test_c\n"
        )
        passed, total, details = parse_pytest_detail(output)
        assert (passed, total) == (3, 3)
        assert all(d["passed"] for d in details)
        assert [d["name"] for d in details] == ["test_a", "test_b", "test_c"]

    def test_pytest_detail_counts_error_as_failed(self):
        output = "E\nERROR test_solution.py::test_crash - Exception: boom\n"
        passed, total, details = parse_pytest_detail(output)
        assert (passed, total) == (0, 1)
        assert details[0]["passed"] is False
        assert details[0]["message"] == "Exception: boom"

    def test_pytest_detail_falls_back_to_counts_without_summary(self):
        # Crashed/truncated output: counts still parse, no per-test detail.
        output = "1 passed, 1 failed in 0.05s"
        assert parse_pytest_detail(output) == (1, 2, [])

    def test_node_detail_mixed_output(self):
        output = (
            "TAP version 13\n"
            "# Subtest: finds pair\n"
            "ok 1 - finds pair\n"
            "# Subtest: no pair\n"
            "ok 2 - no pair\n"
            "# Subtest: fails\n"
            "not ok 3 - fails\n"
            "1..3\n"
            "# pass 2\n# fail 1\n"
        )
        passed, total, details = parse_node_detail(output)
        assert (passed, total) == (2, 3)
        assert [d["name"] for d in details] == ["finds pair", "no pair", "fails"]
        assert [d["passed"] for d in details] == [True, True, False]

    def test_node_detail_falls_back_to_counts(self):
        assert parse_node_detail("# pass 2\n# fail 1\n# tests 3") == (2, 3, [])

    def test_junit_detail_tree_glyphs(self):
        output = (
            "JUnit Jupiter ?\n"
            "  ?  ??  SolutionTest ?\n"
            "  ?    ??  testTwoSum() ✔\n"
            "  ?    ??  testEdge() ✘ expected:<6> but was:<5>\n"
            "4 tests successful\n1 tests failed\n"
        )
        passed, total, details = parse_junit_detail(output)
        assert (passed, total) == (1, 2)
        assert [d["name"] for d in details] == ["testTwoSum()", "testEdge()"]
        assert details[0]["passed"] is True
        assert details[1]["passed"] is False
        assert details[1]["message"] == "expected:<6> but was:<5>"

    def test_junit_detail_strips_ansi_around_glyphs(self):
        output = (
            "testTwoSum()\x1b[0m \x1b[32m✔\x1b[0m\n"
            "testEdge()\x1b[0m \x1b[31m✘\x1b[0m nope\n"
            "1 tests successful\n1 tests failed\n"
        )
        passed, total, details = parse_junit_detail(output)
        assert (passed, total) == (1, 2)
        assert [d["passed"] for d in details] == [True, False]
        assert details[1]["message"] == "nope"

    def test_junit_detail_falls_back_to_counts(self):
        assert parse_junit_detail("5 tests successful\n0 tests failed") == (5, 5, [])

    def test_go_detail_mixed_output(self):
        output = (
            "=== RUN   TestTwoSum\n"
            "--- PASS: TestTwoSum (0.00s)\n"
            "=== RUN   TestMissing\n"
            "--- FAIL: TestMissing (0.00s)\n"
        )
        passed, total, details = parse_go_detail(output)
        assert (passed, total) == (1, 2)
        assert [d["name"] for d in details] == ["TestTwoSum", "TestMissing"]
        assert [d["passed"] for d in details] == [True, False]

    def test_go_detail_excludes_synthetic_pass_lines(self):
        output = "--- PASS: TestTwoSum (0.00s)\n--- PASS: PASS\n--- FAIL: FAIL\n"
        passed, total, details = parse_go_detail(output)
        assert (passed, total) == (1, 1)
        assert [d["name"] for d in details] == ["TestTwoSum"]

    def test_go_detail_falls_back_to_counts(self):
        assert parse_go_detail("ok  \texample 0.001s") == (0, 0, [])

    def test_pass_fail_detail_mixed_output(self):
        output = "PASS: two_sum basic\nFAIL: two_sum no solution - expected [] got [0]\n"
        passed, total, details = parse_pass_fail_detail(output)
        assert (passed, total) == (1, 2)
        assert [d["name"] for d in details] == ["two_sum basic", "two_sum no solution"]
        assert [d["passed"] for d in details] == [True, False]
        assert details[1]["message"] == "expected [] got [0]"

    def test_pass_fail_detail_all_pass(self):
        passed, total, details = parse_pass_fail_detail("PASS: a\nPASS: b\n")
        assert (passed, total) == (2, 2)
        assert all(d["passed"] for d in details)
        assert all(d["message"] is None for d in details)

    def test_pass_fail_detail_falls_back_to_counts(self):
        assert parse_pass_fail_detail("") == (0, 0, [])

    def test_every_runner_has_a_detail_parser_wired(self):
        for runner in (
            PYTHON_RUNNER,
            JAVASCRIPT_RUNNER,
            TYPESCRIPT_RUNNER,
            JAVA_RUNNER,
            GO_RUNNER,
            C_RUNNER,
            CPP_RUNNER,
            RUST_RUNNER,
            PHP_RUNNER,
            RUBY_RUNNER,
            PERL_RUNNER,
            LUA_RUNNER,
            KOTLIN_RUNNER,
        ):
            assert runner.parse_detail is not None, runner.language
