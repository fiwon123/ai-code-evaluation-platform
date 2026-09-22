"""Run test suites against generated code in an isolated sandbox.

Execution happens inside an air-gapped Docker container (``eval-sandbox``
image) whenever Docker sandboxing is enabled and a daemon is reachable.
``docker_enabled`` is a hard switch: when it is on, evaluations that reach
Docker never silently fall back to host execution — untrusted code must stay
sandboxed. A plain subprocess path remains for environments without Docker
(CI, local dev without a daemon), controlled by the same flag.

Language-specific details (filenames, commands, environment, output parsing)
live in :mod:`app.services.language_runner` and are shared by both the Docker
sandbox and the subprocess fallback so behaviour stays identical.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import settings
from app.services.language_runner import LanguageRunner, parse_pytest


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


def parse_summary(output: str) -> tuple[int, int]:
    """Parse pytest's summary line into (passed, total) counts."""
    return parse_pytest(output)


def run_tests(
    workdir: Path,
    runner: LanguageRunner | None = None,
    timeout: int = 30,
) -> subprocess.CompletedProcess:
    """Execute the runner's test command in ``workdir``.

    Separated for testability; ``runner`` defaults to the Python runner so
    existing callers keep working.
    """
    if runner is None:
        from app.services.language_runner import PYTHON_RUNNER

        runner = PYTHON_RUNNER
    # Lay the runner's env over the current process env so PATH and friends
    # are preserved (subprocess.run(env=...) replaces the whole environment).
    env = dict(os.environ)
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.update(runner.env)
    return subprocess.run(
        runner.command,
        cwd=workdir,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )


def run_pytest(
    workdir: Path,
    timeout: int = 30,
) -> subprocess.CompletedProcess:
    """Execute pytest in ``workdir``. Kept for backward compatibility."""
    from app.services.language_runner import PYTHON_RUNNER

    return run_tests(workdir, runner=PYTHON_RUNNER, timeout=timeout)


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

    Raises :class:`ValueError` when ``language`` is not supported by the
    evaluation engine.
    """
    from app.services.language_runner import get_runner

    runner = get_runner(language)

    if timeout is None:
        # Per-language budget: compilation-heavy runtimes (java/go) get a
        # longer window than the global evaluation_timeout default.
        timeout = runner.timeout or settings.evaluation_timeout

    if settings.docker_enabled:
        from app.services.docker_sandbox import DockerSandbox

        sandbox = DockerSandbox(timeout=timeout)
        if sandbox.is_available():
            return sandbox.run(
                code=code,
                test_code=test_code,
                language=language,
                timeout=timeout,
            )

    return _evaluate_code_subprocess(code, test_code, runner, workdir, timeout)


def _evaluate_code_subprocess(
    code: str,
    test_code: str,
    runner: LanguageRunner,
    workdir: Path | None = None,
    timeout: int = 30,
) -> EvaluationOutcome:
    """Subprocess fallback: run the language test suite in a temp dir.

    When ``workdir`` is None a fresh, unique temporary directory is created
    under ``settings.evaluation_dir`` so concurrent evaluations never share
    (and clobber) a single directory. The working directory is removed after
    the run.
    """
    started = time.monotonic()

    evaluation_dir = Path(settings.evaluation_dir)
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    workdir = workdir or Path(tempfile.mkdtemp(prefix="eval-", dir=evaluation_dir))
    workdir.mkdir(parents=True, exist_ok=True)

    solution_file = workdir / runner.solution_filename
    test_file = workdir / runner.test_filename
    solution_file.write_text(code)
    test_file.write_text(test_code)
    for name, content in runner.extra_files.items():
        (workdir / name).write_text(content)

    try:
        result = run_tests(workdir, runner=runner, timeout=timeout)
    except subprocess.TimeoutExpired:
        return EvaluationOutcome(
            logs=f"Evaluation timed out after {timeout}s",
            metrics={
                "language": runner.language,
                "error": "timeout",
                "duration_ms": int((time.monotonic() - started) * 1000),
            },
        )
    except FileNotFoundError:
        elapsed = int((time.monotonic() - started) * 1000)
        return EvaluationOutcome(
            logs=f"'{runner.command[0]}' executable not found",
            metrics={
                "language": runner.language,
                "error": "executable missing",
                "duration_ms": elapsed,
            },
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    output = result.stdout + result.stderr
    passed, total = runner.parse(output)
    score = round((passed / total) * 100, 1) if total else 0.0

    return EvaluationOutcome(
        passed=passed,
        total=total,
        score=score,
        logs=output,
        metrics={
            "language": runner.language,
            "returncode": result.returncode,
            "duration_ms": int((time.monotonic() - started) * 1000),
        },
    )
