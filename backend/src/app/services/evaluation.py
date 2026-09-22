"""Run pytest test suites against generated code in an isolated sandbox.

Execution happens inside an air-gapped Docker container (``eval-sandbox``
image) whenever Docker sandboxing is enabled and a daemon is reachable.
``docker_enabled`` is a hard switch: when it is on, evaluations that reach
Docker never silently fall back to host execution — untrusted code must stay
sandboxed. A plain subprocess path remains for environments without Docker
(CI, local dev without a daemon), controlled by the same flag.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import settings


@dataclass
class EvaluationOutcome:
    """Result of executing a test suite against generated code."""

    passed: int = 0
    total: int = 0
    score: float = 0.0
    logs: str = ""
    metrics: dict[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        """True when the evaluation ran to completion (tests executed)."""
        return self.total > 0

    @property
    def passed_all(self) -> bool:
        return self.total > 0 and self.passed == self.total


_PASSED_RE = re.compile(r"(\d+) passed")
_FAILED_RE = re.compile(r"(\d+) failed")
_ERRORED_RE = re.compile(r"(\d+) error")
_NO_TESTS_RE = re.compile(r"no tests ran")


def parse_summary(output: str) -> tuple[int, int]:
    """Parse pytest's summary line into (passed, total) counts."""
    passed_match = _PASSED_RE.search(output)
    failed_match = _FAILED_RE.search(output)
    errored_match = _ERRORED_RE.search(output)
    passed = int(passed_match.group(1)) if passed_match else 0
    failed = int(failed_match.group(1)) if failed_match else 0
    errored = int(errored_match.group(1)) if errored_match else 0
    total = passed + failed + errored
    return passed, total


def run_pytest(
    workdir: Path,
    timeout: int = 30,
) -> subprocess.CompletedProcess:
    """Execute pytest in ``workdir``. Separated for testability."""
    return subprocess.run(
        ["pytest", "test_solution.py", "-q", "--no-header", "--tb=short"],
        cwd=workdir,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def evaluate_code(
    code: str,
    test_code: str,
    language: str = "python",
    workdir: Path | None = None,
    timeout: int | None = None,
) -> EvaluationOutcome:
    """Execute a test suite against generated code.

    Uses the Docker sandbox when ``settings.docker_enabled`` is on and a
    daemon is reachable; otherwise falls back to a plain subprocess in a
    temporary directory (workdir is created/reused and cleaned up).
    """
    if timeout is None:
        timeout = settings.evaluation_timeout

    if settings.docker_enabled and language == "python":
        from app.services.docker_sandbox import DockerSandbox

        sandbox = DockerSandbox(timeout=timeout)
        if sandbox.is_available():
            return sandbox.run(code=code, test_code=test_code, timeout=timeout)

    return _evaluate_code_subprocess(code, test_code, language, workdir, timeout)


def _evaluate_code_subprocess(
    code: str,
    test_code: str,
    language: str = "python",
    workdir: Path | None = None,
    timeout: int = 30,
) -> EvaluationOutcome:
    """Subprocess fallback: run pytest in a temp dir with a hard timeout.

    When ``workdir`` is None a fresh, unique temporary directory is created
    under ``settings.evaluation_dir`` so concurrent evaluations never share
    (and clobber) a single directory. The working directory is removed after
    the run.
    """
    started = time.monotonic()

    if language != "python":
        return EvaluationOutcome(
            metrics={
                "language": language,
                "error": f"Language '{language}' not supported",
                "duration_ms": 0,
            }
        )

    evaluation_dir = Path(settings.evaluation_dir)
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    workdir = workdir or Path(tempfile.mkdtemp(prefix="eval-", dir=evaluation_dir))
    workdir.mkdir(parents=True, exist_ok=True)

    solution_file = workdir / "solution.py"
    test_file = workdir / "test_solution.py"
    solution_file.write_text(code)
    test_file.write_text(test_code)

    try:
        result = run_pytest(workdir, timeout=timeout)
    except subprocess.TimeoutExpired:
        return EvaluationOutcome(
            logs=f"Evaluation timed out after {timeout}s",
            metrics={"error": "timeout", "duration_ms": int((time.monotonic() - started) * 1000)},
        )
    except FileNotFoundError:
        elapsed = int((time.monotonic() - started) * 1000)
        return EvaluationOutcome(
            logs="pytest executable not found",
            metrics={"error": "pytest missing", "duration_ms": elapsed},
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    output = result.stdout + result.stderr
    passed, total = parse_summary(output)
    score = round((passed / total) * 100, 1) if total else 0.0

    return EvaluationOutcome(
        passed=passed,
        total=total,
        score=score,
        logs=output,
        metrics={
            "language": language,
            "returncode": result.returncode,
            "duration_ms": int((time.monotonic() - started) * 1000),
        },
    )
