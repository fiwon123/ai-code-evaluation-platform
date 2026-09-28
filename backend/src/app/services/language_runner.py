"""Per-language test-runner abstraction for the evaluation pipeline.

Each supported language maps to a :class:`LanguageRunner` describing the
filenames written into the workdir, the command executed (identical on the
host and inside the Docker sandbox, since the sandbox sets ``/code`` as the
working directory), extra files required by the runtime (e.g. ``go.mod``),
environment variables, and an output parser that reduces runner logs to
``(passed, total)`` counts.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.config import settings

Parser = Callable[[str], tuple[int, int]]
#: Detail parsers additionally reduce the runner output to one row per test:
#: ``(passed, total, [{name, passed, message}])``.
ParserDetail = Callable[[str], tuple[int, int, list[dict[str, Any]]]]
#: Error counters report how many *runner errors* the output recorded. An error
#: is not a test case, so the count travels beside the totals instead of inside
#: them — see :func:`parse_pytest_errors`.
ParserCount = Callable[[str], int]

# --- output parsers ---------------------------------------------------------

_PYTEST_PASSED_RE = re.compile(r"(\d+) passed")
_PYTEST_FAILED_RE = re.compile(r"(\d+) failed")
#: pytest's trailing counts line lists errors among the outcomes: ``1 error in
#: 0.27s`` (collection aborted), ``1 passed, 1 error in 0.51s`` (a teardown
#: blew up). The lookahead keeps a test *named* after errors ("1 error
#: handling test") and traceback prose out of the count.
_PYTEST_ERRORS_RE = re.compile(r"(?<!\w)(\d+) errors?(?=\s+in\s|,|\.|$)", re.MULTILINE)
# pytest -rA prints one "short test summary info" line per outcome:
#   PASSED test_solution.py::test_two_sum
#   FAILED test_solution.py::test_edge_case - assert 1 == 2
#   ERROR test_solution.py::test_crash - fixture 'db' errored
# The required ``::`` is what keeps a module-level collection error
# ("ERROR test_solution.py") out of the breakdown: that line names a file, not
# a selected test, so it cannot become a per-test row.
_PYTEST_SUMMARY_RE = re.compile(
    r"^(?P<status>PASSED|FAILED|ERROR)\s+(?P<nodeid>\S+?::\S+?)(?:\s+-\s+(?P<message>.*))?$",
    re.MULTILINE,
)


def parse_pytest(output: str) -> tuple[int, int]:
    """Parse pytest's summary line into ``(passed, total)`` counts.

    ``total`` counts **test cases**, so it is ``passed + failed`` and nothing
    else. pytest also reports *errors* — most importantly a collection error,
    where the test module could not be imported, so pytest aborted before
    selecting a single test:

    .. code-block:: text

        ERROR test_solution.py
        !!!!!! Interrupted: 1 error during collection !!!!!!
        1 error in 0.27s

    Counting that error as a test reported "0 of 1 tests passed" for a run where
    **zero** tests existed, inventing a denominator the user then reads as
    "one of my tests failed". Errors are therefore counted separately by
    :func:`parse_pytest_errors` and never widen ``total``.
    """
    passed_match = _PYTEST_PASSED_RE.search(output)
    failed_match = _PYTEST_FAILED_RE.search(output)
    passed = int(passed_match.group(1)) if passed_match else 0
    failed = int(failed_match.group(1)) if failed_match else 0
    return passed, passed + failed


def parse_pytest_errors(output: str) -> int:
    """Count the runner errors pytest reported (collection, setup, teardown).

    Distinct from :func:`parse_pytest`'s ``total`` on purpose: an error is a
    failure to *run* a test, not a test that ran and failed. Note the
    ``-rA`` detail parser still counts a ``ERROR test_x.py::test_y`` row as a
    failed test case — there the test was selected and simply never completed,
    which is a different thing from a module that never imported.
    """
    match = _PYTEST_ERRORS_RE.search(output)
    return int(match.group(1)) if match else 0


def parse_pytest_detail(output: str) -> tuple[int, int, list[dict[str, Any]]]:
    """Detailed pytest parsing from the ``-rA`` summary block.

    Each test contributes one row (name from the node id, pass/fail status,
    and the first line of the failure/error message when present). When the
    summary block is missing (crashed runner, very old pytest) this falls
    back to the aggregate counts with no per-test detail.
    """
    details: list[dict[str, Any]] = []
    for match in _PYTEST_SUMMARY_RE.finditer(output):
        status = match.group("status")
        name = match.group("nodeid").split("::")[-1]
        message = (match.group("message") or "").strip()
        details.append(
            {
                "name": name,
                "passed": status == "PASSED",
                "message": message or None,
            }
        )
    if not details:
        passed, total = parse_pytest(output)
        return passed, total, []
    return sum(1 for d in details if d["passed"]), len(details), details


_NODE_PASS_RE = re.compile(r"^# pass (\d+)", re.MULTILINE)
_NODE_FAIL_RE = re.compile(r"^# fail (\d+)", re.MULTILINE)
#: Node's TAP stream names every test: ``ok 1 - finds pair`` / ``not ok 2 - x``.
_NODE_TAP_RE = re.compile(r"^(?P<ok>ok|not ok)\s+\d+\s+-\s+(?P<name>.+?)\s*$", re.MULTILINE)


def parse_node(output: str) -> tuple[int, int]:
    """Parse Node's TAP summary (``# pass`` / ``# fail`` / ``# tests``).

    Node's test runner (``node --test``, ``tsx --test``) prints a summary
    ending in ``# pass N`` and ``# fail N`` lines. When the runner crashes
    before the summary, nothing matched and the evaluation reports no tests.
    """
    passed_match = _NODE_PASS_RE.search(output)
    failed_match = _NODE_FAIL_RE.search(output)
    passed = int(passed_match.group(1)) if passed_match else 0
    failed = int(failed_match.group(1)) if failed_match else 0
    return passed, passed + failed


def parse_node_detail(output: str) -> tuple[int, int, list[dict[str, Any]]]:
    """Detailed Node/tsx parsing from the per-test TAP lines."""
    details = [
        {
            "name": match.group("name"),
            "passed": match.group("ok") == "ok",
            "message": None,
        }
        for match in _NODE_TAP_RE.finditer(output)
    ]
    if not details:
        passed, total = parse_node(output)
        return passed, total, []
    return sum(1 for d in details if d["passed"]), len(details), details


_JUNIT_PASS_RE = re.compile(r"(\d+) tests successful")
_JUNIT_FAIL_RE = re.compile(r"(\d+) tests failed")
#: JUnit Platform console tree marks each case with a glyph after the name
#: (``├─ testTwoSum() ✔`` / ``✘`` optionally followed by a failure summary).
_JUNIT_PASS_GLYPHS = frozenset("✔✓")
_JUNIT_GLYPH_RE = re.compile(
    r"(?P<name>\w+\(\))\s*[✔✘✓✗✖✕](?:[ \t]+(?P<message>.+))?$",
    re.MULTILINE,
)
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def parse_junit(output: str) -> tuple[int, int]:
    """Parse the JUnit Platform console summary line(s)."""
    passed_match = _JUNIT_PASS_RE.search(output)
    failed_match = _JUNIT_FAIL_RE.search(output)
    passed = int(passed_match.group(1)) if passed_match else 0
    failed = int(failed_match.group(1)) if failed_match else 0
    return passed, passed + failed


def parse_junit_detail(output: str) -> tuple[int, int, list[dict[str, Any]]]:
    """Detailed JUnit parsing from the console tree.

    Best effort: the console paints the tree with ANSI codes and Unicode
    glyphs, which degrade to plain ``?`` in non-TTY output — so when no test
    row matches we fall back to the aggregate counts with no detail.
    """
    plain = _ANSI_RE.sub("", output)
    details: list[dict[str, Any]] = []
    for match in _JUNIT_GLYPH_RE.finditer(plain):
        message = (match.group("message") or "").strip()
        details.append(
            {
                "name": match.group("name"),
                "passed": match.group(0)[-1] in _JUNIT_PASS_GLYPHS,
                "message": message or None,
            }
        )
    if not details:
        passed, total = parse_junit(output)
        return passed, total, []
    return sum(1 for d in details if d["passed"]), len(details), details


_GO_PASS_RE = re.compile(r"^--- PASS:", re.MULTILINE)
_GO_FAIL_RE = re.compile(r"^--- FAIL:", re.MULTILINE)
#: ``go test -v`` prints ``--- PASS: TestTwoSum (0.00s)`` / ``--- FAIL: ...``.
_GO_DETAIL_RE = re.compile(
    r"^--- (?P<status>PASS|FAIL): (?P<name>\w+)(?: \((?P<time>.*)\))?\s*$",
    re.MULTILINE,
)


def parse_go(output: str) -> tuple[int, int]:
    """Count top-level ``--- PASS:`` / ``--- FAIL:`` lines from ``go test -v``.

    Nested subtests are indented and therefore excluded from the count so a
    single top-level test contributes exactly one entry.
    """
    passed = len(_GO_PASS_RE.findall(output))
    failed = len(_GO_FAIL_RE.findall(output))
    return passed, passed + failed


def parse_go_detail(output: str) -> tuple[int, int, list[dict[str, Any]]]:
    """Detailed Go parsing from ``go test -v`` result lines."""
    details: list[dict[str, Any]] = []
    for match in _GO_DETAIL_RE.finditer(output):
        name = match.group("name")
        # Guard: skip the synthetic "--- PASS: PASS" echo lines newer Go emits.
        if name in {"PASS", "FAIL"}:
            continue
        details.append(
            {
                "name": name,
                "passed": match.group("status") == "PASS",
                "message": None,
            }
        )
    if not details:
        passed, total = parse_go(output)
        return passed, total, []
    return sum(1 for d in details if d["passed"]), len(details), details


# --- shared PASS/FAIL protocol (C, C++, Rust, PHP, Ruby, Perl, Kotlin, Lua) --
#
# New runtimes do not have a uniform TAP/JUnit summary, so their test
# harnesses share one contract: every test prints exactly one line
# ``PASS: <name>`` or ``FAIL: <name>`` (optionally followed by `` - msg``)
# and the process exits non-zero when any test failed. The parsers below
# count those lines, so the (passed, total) and per-test detail views stay
# identical across all eight languages.
_PASS_FAIL_RE = re.compile(
    r"^(?P<status>PASS|FAIL):\s+(?P<name>.+?)(?:\s+-\s+(?P<message>.*))?$",
    re.MULTILINE,
)


def parse_pass_fail(output: str) -> tuple[int, int]:
    """Count ``PASS:`` / ``FAIL:`` lines from a harness run."""
    matches = list(_PASS_FAIL_RE.finditer(output))
    passed = sum(1 for m in matches if m.group("status") == "PASS")
    return passed, len(matches)


def parse_pass_fail_detail(output: str) -> tuple[int, int, list[dict[str, Any]]]:
    """Detailed PASS/FAIL parsing: one row per printed test line."""
    details = [
        {
            "name": match.group("name"),
            "passed": match.group("status") == "PASS",
            "message": (match.group("message") or "").strip() or None,
        }
        for match in _PASS_FAIL_RE.finditer(output)
    ]
    if not details:
        passed, total = parse_pass_fail(output)
        return passed, total, []
    return sum(1 for d in details if d["passed"]), len(details), details


# --- runner registry --------------------------------------------------------

# -rA: after the run pytest prints a "short test summary info" block naming
# every test with its outcome (PASSED/FAILED/ERROR) — required for the
# per-test breakdown.
_PYTEST_FLAGS = ["-q", "--no-header", "--tb=short", "-p", "no:cacheprovider", "-rA"]

GO_MOD = "module evaluation\n\ngo 1.21\n"

_JUNIT_JAR = "/opt/junit/junit-platform-console-standalone.jar"


@dataclass(frozen=True)
class LanguageRunner:
    """Everything needed to run a test suite for one language."""

    language: str
    solution_filename: str
    test_filename: str
    #: argv executed with cwd = workdir (host) or /code (Docker sandbox).
    command: list[str]
    parse: Parser = parse_pytest
    #: Optional detail parser producing one row per test case
    #: (``(passed, total, [{name, passed, message}])``). When set it is
    #: preferred over :attr:`parse` because it also yields the breakdown.
    parse_detail: ParserDetail | None = None
    #: Optional counter of runner *errors* (as opposed to test cases), used to
    #: explain a run that reported no test at all. Set only by runners whose
    #: output distinguishes the two — pytest does, because a collection error
    #: aborts before any test is selected.
    detect_errors: ParserCount | None = None
    #: Timeout in seconds; compilation-heavy runtimes get a longer budget so
    #: slow javac/go build steps do not trip the default 30s limit.
    timeout: int = settings.evaluation_timeout
    #: Extra files written next to the solution/tests (e.g. go.mod).
    extra_files: dict[str, str] = field(default_factory=dict)
    #: Extra environment variables for the subprocess/container.
    env: dict[str, str] = field(default_factory=dict)


PYTHON_RUNNER = LanguageRunner(
    language="python",
    solution_filename="solution.py",
    test_filename="test_solution.py",
    command=["pytest", "test_solution.py", *_PYTEST_FLAGS],
    parse=parse_pytest,
    parse_detail=parse_pytest_detail,
    detect_errors=parse_pytest_errors,
)

JAVASCRIPT_RUNNER = LanguageRunner(
    language="javascript",
    solution_filename="solution.js",
    test_filename="test_solution.js",
    command=["node", "--test", "test_solution.js"],
    parse=parse_node,
    parse_detail=parse_node_detail,
)

TYPESCRIPT_RUNNER = LanguageRunner(
    language="typescript",
    solution_filename="solution.ts",
    test_filename="test_solution.ts",
    command=["tsx", "--test", "test_solution.ts"],
    parse=parse_node,
    parse_detail=parse_node_detail,
)

# Java needs a compile step before the JUnit console launcher can run. The
# sandbox root filesystem is read-only, so class files go to /tmp (tmpfs).
_JAVA_COMPILE_AND_RUN = (
    "mkdir -p /tmp/classes && "
    f"javac -d /tmp/classes -cp {_JUNIT_JAR} Solution.java SolutionTest.java && "
    f"java -jar {_JUNIT_JAR} execute --class-path /tmp/classes --scan-class-path"
)

JAVA_RUNNER = LanguageRunner(
    language="java",
    solution_filename="Solution.java",
    test_filename="SolutionTest.java",
    command=["sh", "-c", _JAVA_COMPILE_AND_RUN],
    parse=parse_junit,
    parse_detail=parse_junit_detail,
    # javac + JUnit startup add seconds; give compilation headroom.
    timeout=settings.evaluation_timeout + 30,
)

GO_RUNNER = LanguageRunner(
    language="go",
    solution_filename="solution.go",
    # Go requires test files to end in `_test.go`.
    test_filename="solution_test.go",
    command=["go", "test", "-v", "."],
    parse=parse_go,
    parse_detail=parse_go_detail,
    extra_files={"go.mod": GO_MOD},
    # First-run compilation of the stdlib into the tmpfs cache is slow.
    timeout=settings.evaluation_timeout + 60,
    # Air-gapped runtimes: no module downloads, caches moved to tmpfs (/tmp).
    env={
        "GOCACHE": "/tmp/go-build",
        "GOPATH": "/tmp/go",
        "GOMODCACHE": "/tmp/go/pkg/mod",
        "GOPROXY": "off",
        "GOFLAGS": "-mod=mod",
    },
)

# --- new runtimes (shared PASS/FAIL protocol) -------------------------------
#
# Compiled languages write the test binary/jar into a fresh mktemp dir so
# concurrent host-side evaluations never clobber a shared artifact (inside
# Docker /tmp is per-container tmpfs, so it is harmless there too).
_COMPILE_BUDGET = settings.evaluation_timeout + 30

C_RUNNER = LanguageRunner(
    language="c",
    solution_filename="solution.c",
    test_filename="test_solution.c",
    command=[
        "sh",
        "-c",
        "d=$(mktemp -d) && "
        'gcc -std=c11 -Wall solution.c test_solution.c -o "$d/tests" && '
        '"$d/tests"; rc=$?; rm -rf "$d"; exit $rc',
    ],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
    timeout=_COMPILE_BUDGET,
)

CPP_RUNNER = LanguageRunner(
    language="cpp",
    solution_filename="solution.cpp",
    test_filename="test_solution.cpp",
    command=[
        "sh",
        "-c",
        "d=$(mktemp -d) && "
        'g++ -std=c++17 -Wall solution.cpp test_solution.cpp -o "$d/tests" && '
        '"$d/tests"; rc=$?; rm -rf "$d"; exit $rc',
    ],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
    timeout=_COMPILE_BUDGET,
)

# The test file is the crate root and pulls the solution in with `mod
# solution;` (module resolution finds solution.rs beside the crate root).
RUST_RUNNER = LanguageRunner(
    language="rust",
    solution_filename="solution.rs",
    test_filename="test_solution.rs",
    command=[
        "sh",
        "-c",
        "d=$(mktemp -d) && "
        'rustc --edition 2021 -O test_solution.rs -o "$d/tests" && '
        '"$d/tests"; rc=$?; rm -rf "$d"; exit $rc',
    ],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
    timeout=_COMPILE_BUDGET,
)

# Interpreted runtimes: the test file loads the solution (require/dofile)
# and runs in the same process.
PHP_RUNNER = LanguageRunner(
    language="php",
    solution_filename="solution.php",
    test_filename="test_solution.php",
    command=["php", "test_solution.php"],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
)

RUBY_RUNNER = LanguageRunner(
    language="ruby",
    solution_filename="solution.rb",
    test_filename="test_solution.rb",
    command=["ruby", "test_solution.rb"],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
)

PERL_RUNNER = LanguageRunner(
    language="perl",
    solution_filename="solution.pl",
    test_filename="test_solution.pl",
    command=["perl", "test_solution.pl"],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
)

LUA_RUNNER = LanguageRunner(
    language="lua",
    solution_filename="solution.lua",
    test_filename="test_solution.lua",
    # `lua5.4` (not `lua`) — the Debian package installs the versioned binary.
    command=["lua5.4", "test_solution.lua"],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
)

KOTLIN_RUNNER = LanguageRunner(
    language="kotlin",
    solution_filename="solution.kt",
    test_filename="test_solution.kt",
    command=[
        "sh",
        "-c",
        "d=$(mktemp -d) && "
        'kotlinc solution.kt test_solution.kt -include-runtime -d "$d/tests.jar" && '
        'java -jar "$d/tests.jar"; rc=$?; rm -rf "$d"; exit $rc',
    ],
    parse=parse_pass_fail,
    parse_detail=parse_pass_fail_detail,
    timeout=_COMPILE_BUDGET,
)

_RUNNERS: dict[str, LanguageRunner] = {
    runner.language: runner
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
    )
}

#: Languages the evaluation engine can execute.
SUPPORTED_RUNNER_LANGUAGES = frozenset(_RUNNERS)


def get_runner(language: str) -> LanguageRunner:
    """Return the :class:`LanguageRunner` for ``language``.

    Raises :class:`ValueError` for unsupported languages so callers can
    surface a clean, actionable failure.
    """
    try:
        return _RUNNERS[language]
    except KeyError:
        raise ValueError(
            f"Language '{language}' is not supported — supported: {sorted(_RUNNERS)}"
        ) from None
