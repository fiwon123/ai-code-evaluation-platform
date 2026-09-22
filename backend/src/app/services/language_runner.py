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

from app.config import settings

Parser = Callable[[str], tuple[int, int]]

# --- output parsers ---------------------------------------------------------

_PYTEST_PASSED_RE = re.compile(r"(\d+) passed")
_PYTEST_FAILED_RE = re.compile(r"(\d+) failed")
_PYTEST_ERRORED_RE = re.compile(r"(\d+) error")


def parse_pytest(output: str) -> tuple[int, int]:
    """Parse pytest's summary line into ``(passed, total)`` counts."""
    passed_match = _PYTEST_PASSED_RE.search(output)
    failed_match = _PYTEST_FAILED_RE.search(output)
    errored_match = _PYTEST_ERRORED_RE.search(output)
    passed = int(passed_match.group(1)) if passed_match else 0
    failed = int(failed_match.group(1)) if failed_match else 0
    errored = int(errored_match.group(1)) if errored_match else 0
    return passed, passed + failed + errored


_NODE_PASS_RE = re.compile(r"^# pass (\d+)", re.MULTILINE)
_NODE_FAIL_RE = re.compile(r"^# fail (\d+)", re.MULTILINE)


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


_JUNIT_PASS_RE = re.compile(r"(\d+) tests successful")
_JUNIT_FAIL_RE = re.compile(r"(\d+) tests failed")


def parse_junit(output: str) -> tuple[int, int]:
    """Parse the JUnit Platform console summary line(s)."""
    passed_match = _JUNIT_PASS_RE.search(output)
    failed_match = _JUNIT_FAIL_RE.search(output)
    passed = int(passed_match.group(1)) if passed_match else 0
    failed = int(failed_match.group(1)) if failed_match else 0
    return passed, passed + failed


_GO_PASS_RE = re.compile(r"^--- PASS:", re.MULTILINE)
_GO_FAIL_RE = re.compile(r"^--- FAIL:", re.MULTILINE)


def parse_go(output: str) -> tuple[int, int]:
    """Count top-level ``--- PASS:`` / ``--- FAIL:`` lines from ``go test -v``.

    Nested subtests are indented and therefore excluded from the count so a
    single top-level test contributes exactly one entry.
    """
    passed = len(_GO_PASS_RE.findall(output))
    failed = len(_GO_FAIL_RE.findall(output))
    return passed, passed + failed


# --- runner registry --------------------------------------------------------

_PYTEST_FLAGS = ["-q", "--no-header", "--tb=short", "-p", "no:cacheprovider"]

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
)

JAVASCRIPT_RUNNER = LanguageRunner(
    language="javascript",
    solution_filename="solution.js",
    test_filename="test_solution.js",
    command=["node", "--test", "test_solution.js"],
    parse=parse_node,
)

TYPESCRIPT_RUNNER = LanguageRunner(
    language="typescript",
    solution_filename="solution.ts",
    test_filename="test_solution.ts",
    command=["tsx", "--test", "test_solution.ts"],
    parse=parse_node,
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

_RUNNERS: dict[str, LanguageRunner] = {
    runner.language: runner
    for runner in (
        PYTHON_RUNNER,
        JAVASCRIPT_RUNNER,
        TYPESCRIPT_RUNNER,
        JAVA_RUNNER,
        GO_RUNNER,
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
