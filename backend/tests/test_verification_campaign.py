"""Tests for the #235 verification campaign harness.

Two jobs:

1. Lock the harness's own decision logic — the part that decides whether a run
   counts as evidence — so a run cannot silently pass or fail for the wrong
   reason.
2. Execute the campaign's ``demo`` fixtures through the *real* evaluation
   pipeline (:func:`evaluate_code`, with the demo provider), and assert the
   counts the cases promise. This is the test that stops the fixtures rotting:
   if someone changes the demo provider's canned solution, the runner, or an
   output parser, the campaign's expected scores break loudly here instead of
   producing a false PASS on the operator's next live run.

Rows that need a runtime this host does not have are skipped with the reason
named, so a skip is never mistaken for a pass.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CAMPAIGN_DIR = REPO_ROOT / "scripts" / "verification-campaign"
CASES_PATH = CAMPAIGN_DIR / "cases.json"


def _load_runner():
    """Import the standalone script by path.

    It is deliberately stdlib-only and lives outside the ``app`` package (the
    operator runs it with a bare ``python3``), so it is loaded by file rather
    than imported normally.
    """
    spec = importlib.util.spec_from_file_location(
        "verification_run_case", CAMPAIGN_DIR / "run_case.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


runner = _load_runner()
CASES = runner.load_cases(CASES_PATH)
CASE_BY_ID = {case["id"]: case for case in CASES}


# --- the matrix -------------------------------------------------------------


def test_matrix_covers_every_row_of_the_issue():
    assert sorted(case["row"] for case in CASES) == [1, 2, 3, 4, 5, 6, 7]


def test_rows_one_to_three_are_the_keyless_baseline():
    baseline = [c for c in CASES if c["row"] <= 3]
    assert [c["provider"] for c in baseline] == ["demo", "demo", "demo"]
    assert all(c["api_key"] is None and c["api_key_env"] is None for c in baseline)


def test_rows_four_to_six_are_groq_across_languages():
    groq = [c for c in CASES if 4 <= c["row"] <= 6]
    assert [c["language"] for c in groq] == ["python", "javascript", "typescript"]
    for case in groq:
        assert case["provider"] == "groq"
        # The key must come from the operator's environment, never the repo.
        assert case["api_key_env"] == "GROQ_API_KEY"
        assert case["api_key"] is None


def test_fallback_row_forces_the_primary_to_fail():
    case = CASE_BY_ID["fallback-tinyllama"]
    assert case["expect"]["kind"] == "fallback"
    assert case["provider"] == "groq"
    # An intentionally invalid key is the mechanism, so it must be present and
    # must not look like a real credential.
    assert case["api_key"] and "invalid" in case["api_key"]
    assert "LLM_FALLBACK_PROVIDER=ollama" in case["precondition"]


def test_every_case_states_what_it_proves():
    for case in CASES:
        assert len(case["proves"]) > 40, f"{case['id']} does not say what it proves"


def test_no_fixture_embeds_something_that_looks_like_a_secret():
    for case in CASES:
        blob = json.dumps(case)
        assert "gsk_" not in blob and "sk-" not in blob, case["id"]


def test_case_file_passes_the_runner_s_own_validation():
    # load_cases validates ids, rows, prompts, test code and expectations.
    assert [c["id"] for c in runner.load_cases(CASES_PATH)] == [c["id"] for c in CASES]


def test_validation_rejects_a_matrix_with_a_broken_case(tmp_path):
    broken = json.loads(CASES_PATH.read_text())
    broken["cases"][0]["challenge"]["test_code"] = "   "
    path = tmp_path / "cases.json"
    path.write_text(json.dumps(broken))
    with pytest.raises(runner.CampaignError, match="test_code"):
        runner.load_cases(path)


# --- score bands ------------------------------------------------------------


@pytest.mark.parametrize(
    ("score", "expect", "expected"),
    [
        (100.0, {"min": 80.0, "max": 100.0}, True),
        (80.0, {"min": 80.0, "max": 100.0}, True),
        (79.9, {"min": 80.0, "max": 100.0}, False),
        (75.0, {"min": 20.0, "max": 80.0}, True),
        (0.0, {"min": 20.0, "max": 80.0}, False),
        (100.0, {"equals": 0.0}, False),
        (0.0, {"equals": 0.0}, True),
        # A run that never produced a score must never satisfy a band.
        (None, {"min": 0.0}, False),
    ],
)
def test_score_in_band(score, expect, expected):
    assert runner.score_in_band(score, expect) is expected


# --- observation extraction -------------------------------------------------


def _detail(**overrides) -> dict[str, Any]:
    payload = {
        "id": "sub-1",
        "challenge_id": "chal-1",
        "status": "completed",
        "phase": None,
        "provider": "demo",
        "model": "mock-coder",
        "language": "python",
        "attempts": [{"attempt_number": 1}],
        "evaluation_result": {
            "passed_tests": 3,
            "total_tests": 3,
            "score": 100.0,
            "logs": "line one\nline two\n3 passed",
            "logs_summary": "All 3 tests passed.",
            "metrics": {},
        },
    }
    payload.update(overrides)
    return payload


def test_extract_observation_summarises_a_passing_run():
    observation = runner.extract_observation(_detail())
    assert observation["score"] == 100.0
    assert observation["passed"] == 3
    assert observation["total"] == 3
    assert observation["attempts"] == 1
    assert observation["fallback_used"] is False
    assert observation["logs_summary"] == "All 3 tests passed."


def test_extract_observation_surfaces_fallback_provenance():
    detail = _detail()
    detail["evaluation_result"]["metrics"] = {
        "fallback_used": True,
        "fallback_provider": "ollama",
        "fallback_model": "tinyllama",
        "primary_error": "401 Unauthorized",
    }
    observation = runner.extract_observation(detail)
    assert observation["fallback_used"] is True
    assert observation["fallback_provider"] == "ollama"
    assert observation["primary_error"] == "401 Unauthorized"


def test_extract_observation_tolerates_a_run_with_no_result():
    # A pending or crashed run has no evaluation_result at all; extraction must
    # not raise, because that is exactly when the harness needs to report.
    observation = runner.extract_observation(_detail(status="pending", evaluation_result=None))
    assert observation["status"] == "pending"
    assert observation["score"] is None
    assert observation["logs_tail"] == ""


def test_logs_tail_is_bounded():
    detail = _detail()
    detail["evaluation_result"]["logs"] = "\n".join(f"line {i}" for i in range(500))
    observation = runner.extract_observation(detail)
    assert len(observation["logs_tail"].splitlines()) == 25
    assert observation["logs_tail"].endswith("line 499")


# --- verdicts ---------------------------------------------------------------


def test_a_completed_run_in_band_passes():
    ok, reason = runner.evaluate_case(
        CASE_BY_ID["demo-python-strong"], runner.extract_observation(_detail())
    )
    assert ok is True
    assert "100.0" in reason


def test_a_failed_run_never_passes_regardless_of_score():
    detail = _detail(status="failed")
    detail["evaluation_result"]["metrics"] = {"error": "Evaluation error: boom"}
    ok, reason = runner.evaluate_case(
        CASE_BY_ID["demo-python-strong"], runner.extract_observation(detail)
    )
    assert ok is False
    assert "boom" in reason


def test_a_stuck_run_is_reported_rather_than_hidden():
    ok, reason = runner.evaluate_case(
        CASE_BY_ID["demo-python-strong"], runner.extract_observation(_detail(status="processing"))
    )
    assert ok is False
    assert "did not complete" in reason


def test_fallback_case_needs_provenance_not_a_good_score():
    # A fallback run that scored 0 still passes row 7 — the row tests
    # provenance. Without provenance it fails even at 100.
    without = _detail()
    without["evaluation_result"]["score"] = 0.0
    ok, reason = runner.evaluate_case(
        CASE_BY_ID["fallback-tinyllama"], runner.extract_observation(without)
    )
    assert ok is False
    assert "provenance" in reason

    detail = _detail()
    detail["evaluation_result"]["score"] = 0.0
    detail["evaluation_result"]["metrics"] = {
        "fallback_used": True,
        "fallback_provider": "ollama",
    }
    ok, reason = runner.evaluate_case(
        CASE_BY_ID["fallback-tinyllama"], runner.extract_observation(detail)
    )
    assert ok is True
    assert "ollama" in reason


# --- pacing -----------------------------------------------------------------


def test_pacing_allows_the_first_run():
    assert runner.pacing_refusal(None, 1000.0, 60.0) is None


def test_pacing_refuses_a_run_that_is_too_soon():
    refusal = runner.pacing_refusal(1000.0, 1019.0, 60.0)
    assert refusal is not None
    assert "41s" in refusal


def test_pacing_allows_a_run_after_the_interval():
    assert runner.pacing_refusal(1000.0, 1060.0, 60.0) is None


def test_pacing_can_be_deliberately_overridden():
    assert runner.pacing_refusal(1000.0, 1001.0, 0.0) is None


def test_pacing_ignores_an_unparseable_ledger_timestamp():
    # A corrupt timestamp must not lock the campaign forever.
    assert runner.pacing_refusal(None, 1000.0, 60.0) is None


# --- ledger and report ------------------------------------------------------


def test_upsert_ledger_keeps_one_row_per_case_in_row_order():
    entries = [
        {"case_id": "b", "row": 2},
        {"case_id": "a", "row": 1},
    ]
    updated = runner.upsert_ledger(entries, {"case_id": "b", "row": 2, "verdict": "pass"})
    assert [e["case_id"] for e in updated] == ["a", "b"]
    assert updated[1]["verdict"] == "pass"


def test_report_marks_unrun_cases_and_passes_ran_ones():
    report = runner.render_report(
        CASES,
        [
            {
                "case_id": "demo-python-strong",
                "row": 1,
                "verdict": "pass",
                "reason": "score 100.0 in band",
                "run_at": "2026-01-01T00:00:00+00:00",
                "observation": runner.extract_observation(_detail()),
            }
        ],
    )
    assert (
        "| 1 | `demo-python-strong` | demo | python | completed | 100.0 | 3/3 | — | PASS |"
        in report
    )
    assert "not run" in report
    # Every case still gets a section, so a missing row is never a missing doc.
    for case in CASES:
        assert f"`{case['id']}`" in report


def test_report_is_regenerated_not_appended():
    entry = {
        "case_id": "demo-python-strong",
        "row": 1,
        "verdict": "pass",
        "reason": "ok",
        "run_at": "2026-01-01T00:00:00+00:00",
        "observation": runner.extract_observation(_detail()),
    }
    first = runner.render_report(CASES, [entry])
    second = runner.render_report(CASES, [entry])
    assert first == second
    assert first.count("### Row 1 —") == 1


def test_load_ledger_rejects_corrupt_lines(tmp_path):
    path = tmp_path / "evidence.jsonl"
    path.write_text('{"case_id": "a"}\nnot json\n')
    with pytest.raises(runner.CampaignError, match="not valid JSON"):
        runner.load_ledger(path)


def test_committed_evidence_matches_the_current_matrix():
    """The committed ledger must not describe cases that no longer exist.

    Keeps the committed evidence honest when the matrix is edited.
    """
    ledger_path = REPO_ROOT / "docs" / "verification" / "evidence.jsonl"
    if not ledger_path.exists():
        pytest.skip("no evidence recorded yet")
    for entry in runner.load_ledger(ledger_path):
        assert entry["case_id"] in CASE_BY_ID, entry["case_id"]
        assert entry["row"] == CASE_BY_ID[entry["case_id"]]["row"]


# --- the fixtures, executed for real ----------------------------------------

#: Runtime executables the campaign fixtures need, per language.
_RUNTIME = {
    "python": "pytest",
    "javascript": "node",
    "typescript": "tsx",
    "go": "go",
    "java": "javac",
}

#: Rows 1-3 are the deterministic baseline: same fixtures, same expected counts
#: on every machine, so they can be asserted outright.
_DEMO_EXPECTED = {
    "demo-python-strong": (3, 3, 100.0),
    "demo-python-mid": (3, 4, 75.0),
    "demo-python-zero": (0, 1, 0.0),
}


@pytest.mark.parametrize("case_id", sorted(_DEMO_EXPECTED))
def test_demo_fixtures_produce_the_score_the_case_promises(case_id, tmp_path):
    """Run rows 1-3 through the real pipeline and assert their evidence.

    The count, not just the band: a band would let 2-of-4 pass as "mid" and the
    campaign would quietly stop proving what it claims. The demo provider is
    deterministic, so these numbers are fixed.
    """
    case = CASE_BY_ID[case_id]
    language = case["language"]
    if not shutil.which(_RUNTIME[language]):
        pytest.skip(f"{language}: {_RUNTIME[language]} is not on this host")

    from app.services.evaluation import evaluate_code
    from app.services.llm_providers.mock_provider import MockProvider

    code = MockProvider().generate_code(
        case["challenge"]["prompt"], language=language
    )
    outcome = evaluate_code(
        code, case["challenge"]["test_code"], language=language, workdir=tmp_path
    )
    expected_passed, expected_total, expected_score = _DEMO_EXPECTED[case_id]
    assert (outcome.passed, outcome.total) == (expected_passed, expected_total), outcome.logs
    assert outcome.score == expected_score
    # And the harness's own verdict agrees with the runner it just exercised.
    observation = runner.extract_observation(
        {
            "id": "synthetic",
            "challenge_id": "synthetic",
            "status": "completed",
            "provider": "demo",
            "model": "mock-coder",
            "language": language,
            "attempts": [],
            "evaluation_result": {
                "passed_tests": outcome.passed,
                "total_tests": outcome.total,
                "score": outcome.score,
                "logs": outcome.logs,
                "metrics": outcome.metrics,
            },
        }
    )
    ok, reason = runner.evaluate_case(case, observation)
    assert ok, reason


def test_javascript_fixture_agrees_with_the_demo_provider(tmp_path):
    """Row 5's fixture is Groq-only but shaped like the demo JS solutions.

    Asserting the shape here means the ``node --test`` spec is known-good
    before a real provider is ever asked to satisfy it — otherwise a spec bug
    and a model bug are indistinguishable in the evidence.
    """
    if not shutil.which("node"):
        pytest.skip("node is not on this host")
    from app.services.evaluation import evaluate_code
    from app.services.llm_providers.mock_provider import MockProvider

    case = CASE_BY_ID["groq-javascript"]
    code = MockProvider().generate_code(case["challenge"]["prompt"], language="javascript")
    outcome = evaluate_code(
        code, case["challenge"]["test_code"], language="javascript", workdir=tmp_path
    )
    assert (outcome.passed, outcome.total) == (3, 3), outcome.logs


def test_typescript_fixture_is_flagged_as_unverified():
    """Row 6 could not be executed when it was written; keep that honest.

    The precondition in the matrix says so, and this test stops the claim from
    quietly disappearing.
    """
    case = CASE_BY_ID["groq-typescript"]
    assert "could not be executed" in case["precondition"]
