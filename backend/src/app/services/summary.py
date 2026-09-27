"""Readable digests of test-runner output.

A failed run produces up to 64KB of ``stdout + stderr``: tracebacks, runner
banners, progress lines. Useful for debugging, close to unreadable for a human
scanning a report, and mostly noise when handed back to an LLM.

:func:`format_failure_summary` reduces that dump to the signal — how many tests
passed, which failed, and the assertion message for each — and is stored next
to the raw logs on every attempt and on the final result.
:func:`build_repair_feedback` assembles the block sent back to the provider
when a failed attempt is retried.

Both are pure string builders (no I/O, no models) so they are cheap to unit
test and safe to call from the worker.
"""

from __future__ import annotations

from typing import Any

#: Assertion messages are single-line and often multi-hundred characters; the
#: summary is a digest, so cap each one.
MAX_MESSAGE_CHARS = 240
#: Cap the failed-test list. A run with hundreds of failures still reports the
#: count and the first few, not a wall of text.
MAX_LISTED_TESTS = 20
#: How much raw output to append when no per-test detail was parsed.
MAX_TAIL_CHARS = 1200

_MISSING_RESULT = "No per-test detail was reported by the runner."

#: ``metrics["error"]`` token for a run whose suite never loaded. Owned here
#: rather than duplicated in :mod:`app.services.evaluation`, because its
#: meaning is exactly what :func:`format_failure_summary` says about it — a
#: typo in one copy would silently produce the generic "no tests" headline.
COLLECTION_ERROR = "collection error"


def _first_line(text: Any) -> str:
    """Collapse a message to its first non-empty line, length-capped."""
    value = str(text or "").strip()
    if not value:
        return ""
    for line in value.splitlines():
        stripped = line.strip()
        if stripped:
            value = stripped
            break
    if len(value) > MAX_MESSAGE_CHARS:
        value = value[: MAX_MESSAGE_CHARS - 1].rstrip() + "…"
    return value


def _tail(text: str, limit: int) -> str:
    """Return the last ``limit`` characters of ``text``."""
    if not text:
        return ""
    text = text.rstrip()
    if len(text) <= limit:
        return text
    return "…(truncated)\n" + text[-limit:]


def format_failure_summary(
    *,
    passed: int,
    total: int,
    test_results: list[dict[str, Any]] | None,
    logs: str,
    metrics: dict[str, Any] | None = None,
) -> str:
    """Summarize a run as ``<headline>``, ``Failed tests:`` and a log tail.

    Handles the four shapes a run can take: a clean pass, a partial failure
    with parsed per-test detail, a run that never produced detail at all
    (a timeout, a missing executable, or a runner whose parser found nothing),
    and a suite that failed to load — where zero tests ran because the test
    module itself could not be imported.
    """
    metrics = metrics or {}
    error = metrics.get("error")

    if error == "timeout":
        headline = "The test run timed out — no tests reported a result."
    elif error == "executable missing":
        headline = f"The test runner never started: {logs.strip() or error}."
    elif error == COLLECTION_ERROR:
        # Distinct from the timeout case on purpose: the runner *did* start and
        # did report, and its log explains why. Saying "no tests reported a
        # result" here would read as an empty suite rather than a broken one.
        count = metrics.get("error_count")
        plural = "s" if isinstance(count, int) and count != 1 else ""
        detail = f" ({count} collection error{plural})" if isinstance(count, int) else ""
        headline = f"The test suite failed to load — no tests ran{detail}."
    elif total <= 0:
        headline = "No tests reported a result."
    elif passed == total:
        headline = f"All {total} tests passed."
    else:
        headline = f"{passed} of {total} tests passed (score {round(passed / total * 100, 1)}%)."

    parts = [headline]

    failures = [r for r in (test_results or []) if not r.get("passed", False)]
    if failures:
        parts.append("")
        parts.append(f"Failed tests ({len(failures)}):")
        for result in failures[:MAX_LISTED_TESTS]:
            name = str(result.get("name") or "<unnamed>")
            message = _first_line(result.get("message"))
            parts.append(f"- {name}: {message}" if message else f"- {name}")
        if len(failures) > MAX_LISTED_TESTS:
            parts.append(f"- …and {len(failures) - MAX_LISTED_TESTS} more")
    elif test_results and total > 0 and passed == total:
        # A full pass still lists what ran, so the summary is self-contained.
        parts.append("")
        parts.append(
            "Passed tests: " + ", ".join(str(r.get("name") or "<unnamed>") for r in test_results)
        )

    if not test_results and not error:
        parts.extend(["", _MISSING_RESULT])

    tail = _tail(logs, MAX_TAIL_CHARS)
    if tail:
        parts.extend(["", "Raw output (tail):", tail])

    return "\n".join(parts)


def build_repair_feedback(
    *,
    previous_code: str,
    summary: str,
    logs: str,
    language: str,
    attempt_number: int,
    max_attempts: int,
    log_tail_chars: int,
) -> str:
    """Build the block appended to the prompt when retrying a failed attempt.

    Carries the previous code, the readable summary, and a bounded tail of raw
    output. The summary leads so a provider that ignores the tail still gets
    the assertion messages, which is what usually identifies the defect.

    Note the deliberate omission: the challenge's *test source* is never
    included. Failure messages necessarily reveal expected values — that is
    inherent to self-repair — but shipping the whole suite to a third-party
    provider is a larger disclosure than the fix requires.
    """
    return "\n\n".join(
        part
        for part in (
            "Your previous attempt did not pass the test suite. Produce a "
            "corrected version that fixes the reported failures.",
            f"## Your previous code (attempt {attempt_number - 1} of {max_attempts})\n"
            f"```{language}\n{previous_code}\n```",
            f"## What failed\n{summary}",
            f"## Raw test output (tail)\n{_tail(logs, log_tail_chars) or '(no output captured)'}",
            "Return the complete corrected solution — not a patch, not a diff, "
            "and no explanation outside the code.",
        )
    )
