#!/usr/bin/env python3
"""Run ONE row of the #235 verification campaign against a live stack.

Stdlib only, deliberately: the operator runs this with a bare ``python3`` on
the host, so it must not depend on the backend venv or on the app being
importable. It speaks the public HTTP API the same way the frontend does.

One invocation runs exactly one case and then exits. That is the pacing rule
from the issue — "one run at a time, waits between runs; no scripted
hammering" — so there is intentionally no ``--all`` flag. A ``--min-interval``
guard refuses to start too soon after the previous recorded run.

Usage:
    python3 scripts/verification-campaign/run_case.py --list
    python3 scripts/verification-campaign/run_case.py --case demo-python-strong
    python3 scripts/verification-campaign/run_case.py --case fallback-tinyllama

Results accumulate in ``docs/verification/evidence.jsonl`` (one JSON object per
case, last run wins) and ``docs/verification/REPORT.md`` is regenerated from it,
so the evidence is a reviewable, committable diff rather than terminal scroll.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
CASES_PATH = Path(__file__).resolve().parent / "cases.json"
EVIDENCE_DIR = REPO_ROOT / "docs" / "verification"
LEDGER_PATH = EVIDENCE_DIR / "evidence.jsonl"
REPORT_PATH = EVIDENCE_DIR / "REPORT.md"

#: Score bands the issue asks rows 1-3 to prove. Scores are 0-100 (the API
#: returns ``round(passed / total * 100, 1)``), so "high" starts at 80.
DEFAULT_MIN_INTERVAL = 60.0
TERMINAL_STATUSES = {"completed", "failed"}


class CampaignError(RuntimeError):
    """Anything that stops the campaign from producing evidence."""


# --- pure helpers (unit-tested; no network, no clock, no filesystem) ---------


def load_cases(path: Path = CASES_PATH) -> list[dict[str, Any]]:
    """Load and validate the case matrix.

    Validating here rather than trusting the file means a typo in a fixture
    fails at the start of a run instead of after an operator has already
    submitted to a real provider and waited for it.
    """
    try:
        raw = json.loads(Path(path).read_text())
    except FileNotFoundError as exc:
        raise CampaignError(f"no case matrix at {path}") from exc
    except json.JSONDecodeError as exc:
        raise CampaignError(f"{path} is not valid JSON: {exc}") from exc

    cases = raw.get("cases") if isinstance(raw, dict) else raw
    if not isinstance(cases, list) or not cases:
        raise CampaignError(f"{path} has no 'cases' list")

    required = ("id", "row", "provider", "language", "challenge", "expect", "proves")
    seen: set[str] = set()
    rows: set[int] = set()
    for case in cases:
        missing = [key for key in required if key not in case]
        if missing:
            raise CampaignError(f"case {case.get('id', '?')!r} is missing {missing}")
        if case["id"] in seen:
            raise CampaignError(f"duplicate case id {case['id']!r}")
        seen.add(case["id"])
        if case["row"] in rows:
            raise CampaignError(f"two cases claim row {case['row']}")
        rows.add(case["row"])

        challenge = case["challenge"]
        for key in ("title", "description", "prompt", "test_code"):
            if not str(challenge.get(key, "")).strip():
                raise CampaignError(f"case {case['id']!r} has an empty challenge.{key}")
        expect = case["expect"]
        if expect.get("kind") not in {"score_band", "fallback", "completed"}:
            raise CampaignError(f"case {case['id']!r} has an unknown expect.kind")
        if expect["kind"] == "score_band" and not (
            "equals" in expect or "min" in expect or "max" in expect
        ):
            raise CampaignError(f"case {case['id']!r} has an empty score band")
        if expect["kind"] == "completed" and (
            "equals" in expect or "min" in expect or "max" in expect
        ):
            # evaluate_completed ignores a band, so accepting one would let a
            # case assert a score in the file while proving nothing in the run.
            raise CampaignError(
                f"case {case['id']!r} mixes a completed expectation with a "
                "score band; the score is informational for that kind"
            )
    return cases


#: Backends that mean code was really executed. ``docker`` is the sandbox
#: container. The plain-subprocess fallback (:func:`evaluate_code` in backend
#: ``services/evaluation.py``) runs real code too but records *no* ``backend``
#: key, and that omission is locked by
#: ``backend/tests/test_evaluation.py::test_falls_back_when_docker_unavailable``.
#: So an absent backend is a known path, not a missing fact -- see
#: ``evaluate_completed`` for why the row can still prove execution without it.
KNOWN_EXECUTION_BACKENDS = frozenset({"docker", "subprocess"})


def score_in_band(score: float | None, expect: dict[str, Any]) -> bool:
    """Is ``score`` inside the case's band? ``None`` never is."""
    if score is None:
        return False
    if "equals" in expect:
        return float(score) == float(expect["equals"])
    if "min" in expect and score < float(expect["min"]):
        return False
    if "max" in expect and score > float(expect["max"]):
        return False
    return True


def extract_observation(payload: dict[str, Any]) -> dict[str, Any]:
    """Reduce a submission-detail payload to the facts the campaign records.

    Kept separate from the HTTP call so the evidence rules can be tested
    against hand-written payloads, including the shapes that only appear when
    something has gone wrong.
    """
    result = payload.get("evaluation_result") or {}
    metrics = result.get("metrics") or {}
    observation = {
        "submission_id": payload.get("id"),
        "challenge_id": payload.get("challenge_id"),
        "status": payload.get("status"),
        "phase": payload.get("phase"),
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "language": payload.get("language"),
        "score": result.get("score", payload.get("score")),
        "passed": result.get("passed_tests"),
        "total": result.get("total_tests"),
        # Which evaluator actually ran the code. Without this the evidence
        # cannot distinguish "scored 0 because the solution was wrong" from
        # "scored 0 because nothing was ever executed".
        "backend": metrics.get("backend"),
        "attempts": len(payload.get("attempts") or []),
        "fallback_used": bool(metrics.get("fallback_used")),
        "fallback_provider": metrics.get("fallback_provider"),
        "fallback_model": metrics.get("fallback_model"),
        "primary_error": metrics.get("primary_error"),
        "error": metrics.get("error"),
        "logs_summary": result.get("logs_summary") or "",
        "logs_tail": "\n".join((result.get("logs") or "").splitlines()[-25:]),
    }
    return observation


def evaluate_case(case: dict[str, Any], observation: dict[str, Any]) -> tuple[bool, str]:
    """Does the observation satisfy the case? Returns (ok, human reason)."""
    status = observation.get("status")
    expect = case["expect"]

    if status != "completed":
        reason = observation.get("error") or f"status={status!r}"
        return False, f"run did not complete ({reason})"

    if expect["kind"] == "fallback":
        if not observation.get("fallback_used"):
            return False, "no fallback provenance in metrics (expected fallback_used)"
        provider = observation.get("fallback_provider") or "unknown"
        return True, f"fell back to {provider}"

    if expect["kind"] == "completed":
        return evaluate_completed(observation)

    score = observation.get("score")
    if not score_in_band(score, expect):
        return False, f"score {score} outside expected band {expect}"
    passed, total = observation.get("passed"), observation.get("total")
    return True, f"score {score} in band {expect} ({passed}/{total} tests)"


def _is_number(value: Any) -> bool:
    """A real number, not ``True``/``None`` -- ``isinstance(True, int)`` is True."""
    return not isinstance(value, bool) and isinstance(value, (int, float))


def evaluate_completed(observation: dict[str, Any]) -> tuple[bool, str]:
    """Did the pipeline actually run? Deliberately makes no claim on the score.

    A 1.1B local model is not expected to pass a test suite, so a low score is
    a legitimate result here and the row still passes. What the row does require
    is proof that code was really executed, and on both real execution paths
    that proof is ``total_tests > 0``: the counts come from parsing the test
    runner's own output, so a suite that never started reports 0 *and* an
    ``error`` (collection error, ``executable missing``, or ``timeout``). A
    0-100 band cannot express any of that -- it passes when nothing happened.

    ``metrics.backend`` is a corroborating signal, not a requirement: only the
    Docker path records it. When it is present it must be a known backend, so a
    typo or a new value surfaces as a failure rather than passing unnoticed.
    """
    error = observation.get("error")
    if error:
        return False, f"run recorded an error ({error})"

    total = observation.get("total")
    if not _is_number(total) or total <= 0:
        return False, f"no tests were collected (total_tests={total!r})"

    backend = observation.get("backend")
    if backend is not None and backend not in KNOWN_EXECUTION_BACKENDS:
        return False, f"unknown execution backend recorded (backend={backend!r})"

    score = observation.get("score")
    if not _is_number(score) or not 0 <= float(score) <= 100:
        return False, f"score {score!r} is not a recorded 0-100 value"

    where = f"the {backend} backend" if backend else "the unlabelled subprocess path"
    passed = observation.get("passed")
    return True, (
        f"pipeline completed on {where}, score {score} "
        f"({passed}/{total} tests) — score is informational for this row"
    )


def pacing_refusal(
    last_run_epoch: float | None, now: float, min_interval: float
) -> str | None:
    """Refuse a run that starts too soon after the previous one.

    The campaign is meant to be watched, one run at a time. Encoding the wait
    in the tool is what keeps a copy-pasted loop from turning into hammering
    the provider and the sandbox.
    """
    if last_run_epoch is None or min_interval <= 0:
        return None
    elapsed = now - last_run_epoch
    if elapsed >= min_interval:
        return None
    wait = min_interval - elapsed
    return (
        f"refusing to start: last run was {elapsed:.0f}s ago and the campaign "
        f"requires {min_interval:.0f}s between runs — wait {wait:.0f}s "
        f"(override deliberately with --min-interval 0 if you are re-running "
        f"after a failure)"
    )


def upsert_ledger(entries: list[dict[str, Any]], entry: dict[str, Any]) -> list[dict[str, Any]]:
    """Replace this case's entry, keeping one row per case and row order."""
    kept = [e for e in entries if e.get("case_id") != entry.get("case_id")]
    kept.append(entry)
    return sorted(kept, key=lambda e: (e.get("row", 0), e.get("case_id", "")))


def _fmt(value: Any, dash: str = "—") -> str:
    if value is None or value == "":
        return dash
    return str(value)


def render_report(cases: list[dict[str, Any]], entries: list[dict[str, Any]]) -> str:
    """Regenerate the whole report from the ledger.

    Generated rather than appended to, so a re-run cannot leave a stale row
    and the file stays a clean diff against the previous evidence.
    """
    by_id = {e.get("case_id"): e for e in entries}
    lines = [
        "# Verification campaign — #235",
        "",
        "Generated by `scripts/verification-campaign/run_case.py`. Do not edit by hand:",
        "re-run a case to refresh its row, or delete `evidence.jsonl` to start over.",
        "",
        "| Row | Case | Provider | Lang | Status | Score | Tests | Fallback | Verdict |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for case in sorted(cases, key=lambda c: c["row"]):
        entry = by_id.get(case["id"])
        if entry is None:
            lines.append(
                f"| {case['row']} | `{case['id']}` | {case['provider']} | "
                f"{case['language']} | not run | — | — | — | — |"
            )
            continue
        observation = entry.get("observation", {})
        verdict = entry.get("verdict")
        mark = "PASS" if verdict == "pass" else "FAIL"
        fallback = "yes" if observation.get("fallback_used") else "—"
        tests = (
            f"{observation.get('passed')}/{observation.get('total')}"
            if observation.get("total") is not None
            else "—"
        )
        lines.append(
            f"| {case['row']} | `{case['id']}` | {case['provider']} | "
            f"{case['language']} | {observation.get('status', '—')} | "
            f"{_fmt(observation.get('score'))} | {tests} | {fallback} | {mark} |"
        )

    lines += ["", "## Cases", ""]
    for case in sorted(cases, key=lambda c: c["row"]):
        entry = by_id.get(case["id"])
        observation = (entry or {}).get("observation", {})
        lines += [
            f"### Row {case['row']} — {case['title']}",
            "",
            f"- **Case:** `{case['id']}`",
            f"- **Proves:** {case['proves']}",
            f"- **Precondition:** {case.get('precondition', '—')}",
            f"- **Expectation:** `{json.dumps(case['expect'])}`",
        ]
        if entry is None:
            lines += ["- **Result:** not run", ""]
            continue
        lines += [
            f"- **Result:** {'PASS' if entry.get('verdict') == 'pass' else 'FAIL'} — "
            f"{entry.get('reason', '')}",
            f"- **Submission:** `{_fmt(observation.get('submission_id'))}`",
            f"- **Challenge:** `{_fmt(observation.get('challenge_id'))}`",
            f"- **Provider / model:** {_fmt(observation.get('provider'))} / "
            f"{_fmt(observation.get('model'))}",
            f"- **Attempts:** {_fmt(observation.get('attempts'))}",
            f"- **Run at:** {_fmt(entry.get('run_at'))}",
        ]
        if observation.get("fallback_used"):
            lines.append(
                f"- **Fallback:** {_fmt(observation.get('fallback_provider'))} / "
                f"{_fmt(observation.get('fallback_model'))} "
                f"(primary error: {_fmt(observation.get('primary_error'))})"
            )
        summary = observation.get("logs_summary")
        if summary:
            lines += ["", f"> {summary.strip()}", ""]
        tail = observation.get("logs_tail")
        if tail:
            lines += ["", "<details><summary>log tail</summary>", "", "```", tail, "```", "", "</details>", ""]
        if not summary and not tail:
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def load_ledger(path: Path = LEDGER_PATH) -> list[dict[str, Any]]:
    if not Path(path).exists():
        return []
    entries = []
    for lineno, line in enumerate(Path(path).read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise CampaignError(f"{path}:{lineno} is not valid JSON: {exc}") from exc
    return entries


def write_evidence(
    entry: dict[str, Any], cases: list[dict[str, Any]], ledger: Path = LEDGER_PATH
) -> None:
    """Persist one case's evidence and regenerate the report.

    The report lives beside whichever ledger was written, so ``--ledger`` can
    be pointed at a scratch file for a rehearsal without overwriting the
    committed evidence.
    """
    ledger = Path(ledger)
    ledger.parent.mkdir(parents=True, exist_ok=True)
    entries = upsert_ledger(load_ledger(ledger), entry)
    ledger.write_text("".join(json.dumps(e, sort_keys=True) + "\n" for e in entries))
    report = ledger.parent / "REPORT.md"
    report.write_text(render_report(cases, entries))
    print(f"\nevidence written to {ledger} and {report}")


# --- HTTP (the only part that talks to the network) -------------------------


def request_json(
    url: str,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """One JSON request. Raises CampaignError with the body on any failure."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise CampaignError(f"{method} {url} -> HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise CampaignError(
            f"{method} {url} -> {exc.reason}. Is the stack up (`make dev-up`, "
            f"or `make infra-up` plus a local uvicorn/celery)?"
        ) from exc
    except TimeoutError as exc:
        raise CampaignError(f"{method} {url} -> timed out after {timeout}s") from exc
    return json.loads(raw) if raw else {}


def authenticate(api_base: str, identifier: str | None, password: str | None) -> str:
    """Log in when given credentials, otherwise register a throwaway user.

    The campaign creates real challenges and submissions, so it needs a real
    user. Registering keeps the harness usable with no setup; pass
    ``--identifier``/``--password`` to reuse an existing account instead.
    """
    if identifier and password:
        payload = request_json(f"{api_base}/api/auth/login", "POST",
                               {"identifier": identifier, "password": password})
        return payload["access_token"]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    payload = request_json(
        f"{api_base}/api/auth/register",
        "POST",
        {
            "email": f"verify-{stamp}@example.invalid",
            "username": f"verify{stamp}"[:60],
            "password": f"Verify-{stamp}-pw",
        },
    )
    return payload["access_token"]


def poll_until_terminal(
    api_base: str, submission_id: str, token: str, poll_seconds: float, max_wait: float
) -> dict[str, Any]:
    """Poll the submission until it is terminal. Returns the final payload.

    Polls the REST endpoint rather than opening a websocket because the whole
    point is to capture what a *user* would end up with, and a run that never
    leaves ``pending`` must be reported as a defect, not hidden by a timeout
    that raises.
    """
    deadline = time.monotonic() + max_wait
    last = {}
    while time.monotonic() < deadline:
        last = request_json(f"{api_base}/api/submissions/{submission_id}", token=token)
        if last.get("status") in TERMINAL_STATUSES:
            return last
        phase = last.get("phase") or last.get("status")
        print(f"    … {phase} (waiting)", file=sys.stderr, flush=True)
        time.sleep(poll_seconds)
    # Not terminal: still record it. A stuck status is a finding.
    return last


# --- orchestration ----------------------------------------------------------


def run_case(
    case: dict[str, Any],
    api_base: str,
    identifier: str | None,
    password: str | None,
    poll_seconds: float,
    max_wait: float,
    ledger: Path = LEDGER_PATH,
    now: float | None = None,
) -> dict[str, Any]:
    """Run one case end to end and return its ledger entry."""
    print(f"Row {case['row']}: {case['title']}")
    print(f"  precondition: {case.get('precondition', '—')}")
    print(f"  proving: {case['proves']}")

    api_key = case.get("api_key")
    key_env = case.get("api_key_env")
    if key_env and not api_key:
        api_key = os.environ.get(key_env) or None
        if not api_key:
            raise CampaignError(
                f"case {case['id']!r} needs ${key_env} in the environment. Export it "
                f"in the shell that starts the worker too — the agent must not read .env."
            )

    token = authenticate(api_base, identifier, password)
    print("  authenticated")

    challenge = request_json(
        f"{api_base}/api/challenges",
        "POST",
        {
            "title": case["challenge"]["title"],
            "description": case["challenge"]["description"],
            "prompt": case["challenge"]["prompt"],
            "test_code": case["challenge"]["test_code"],
            "language": case["language"],
            "difficulty": case.get("difficulty", "medium"),
        },
        token=token,
    )
    print(f"  challenge {challenge['id']}")

    payload: dict[str, Any] = {
        "challenge_id": challenge["id"],
        "provider": case["provider"],
    }
    if case.get("model"):
        payload["model"] = case["model"]
    if api_key:
        payload["api_key"] = api_key

    submission = request_json(f"{api_base}/api/submissions", "POST", payload, token=token)
    print(f"  submission {submission['id']} submitted — watching it")

    detail = poll_until_terminal(
        api_base, submission["id"], token, poll_seconds, max_wait
    )
    observation = extract_observation(detail)
    ok, reason = evaluate_case(case, observation)
    print(f"  {'PASS' if ok else 'FAIL'}: {reason}")

    return {
        "case_id": case["id"],
        "row": case["row"],
        "verdict": "pass" if ok else "fail",
        "reason": reason,
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "observation": observation,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run one #235 verification case against a live stack."
    )
    parser.add_argument("--case", help="case id (see --list)")
    parser.add_argument("--list", action="store_true", help="list cases and exit")
    parser.add_argument("--api-base", default=os.environ.get("VERIFY_API_BASE", "http://localhost:8000"))
    parser.add_argument("--identifier", help="existing account to log in as")
    parser.add_argument("--password", help="password for --identifier")
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    parser.add_argument("--max-wait", type=float, default=600.0)
    parser.add_argument(
        "--min-interval",
        type=float,
        default=DEFAULT_MIN_INTERVAL,
        help="refuse to start within this many seconds of the last recorded run",
    )
    parser.add_argument("--ledger", type=Path, default=LEDGER_PATH)
    args = parser.parse_args(argv)

    try:
        cases = load_cases()
        if args.list or not args.case:
            if not args.list:
                parser.error("pass --case <id> or --list")
            for case in sorted(cases, key=lambda c: c["row"]):
                print(f"{case['row']}. {case['id']:22} {case['provider']:6} "
                      f"{case['language']:11} {case['title']}")
            return 0

        case = next((c for c in cases if c["id"] == args.case), None)
        if case is None:
            raise CampaignError(
                f"unknown case {args.case!r}; run with --list to see the matrix"
            )

        last = None
        for entry in reversed(load_ledger(args.ledger)):
            if entry.get("run_at"):
                try:
                    last = datetime.fromisoformat(entry["run_at"]).timestamp()
                except ValueError:
                    last = None
                break
        refusal = pacing_refusal(last, time.time(), args.min_interval)
        if refusal:
            print(refusal, file=sys.stderr)
            return 2

        entry = run_case(
            case,
            api_base=args.api_base.rstrip("/"),
            identifier=args.identifier,
            password=args.password,
            poll_seconds=args.poll_seconds,
            max_wait=args.max_wait,
            ledger=args.ledger,
        )
        write_evidence(entry, cases, args.ledger)
        return 0 if entry["verdict"] == "pass" else 1
    except CampaignError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
