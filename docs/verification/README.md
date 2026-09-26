# Verification campaign (#235)

Real end-to-end evidence that the platform works, gathered by actually using it
instead of by asserting against mocks in a unit test.

- **Matrix:** `scripts/verification-campaign/cases.json` — one entry per row of
  the issue, each with the prompt, the tests, the precondition and the expected
  outcome.
- **Runner:** `scripts/verification-campaign/run_case.py` — runs **one** case per
  invocation against the public HTTP API, then records the evidence.
- **Evidence:** `evidence.jsonl` (one JSON object per case, last run wins) and
  this directory's `REPORT.md`, which is **generated** from the ledger. Do not
  hand-edit `REPORT.md`; re-run a case to refresh its row.

## Why one case per invocation

The issue requires the campaign to be paced manually — one run at a time, waits
in between, no scripted hammering. So there is deliberately no `--all` flag, and
a `--min-interval` guard (default 60s, recorded in the ledger) refuses to start
a run too soon after the previous one. Overriding it is possible but has to be
typed deliberately.

## Running it

The runner is stdlib-only, so a bare `python3` is enough:

```bash
# what is in the matrix, and what each row needs
python3 scripts/verification-campaign/run_case.py --list

# the keyless baseline — no key, no network, no Ollama
python3 scripts/verification-campaign/run_case.py --case demo-python-strong
python3 scripts/verification-campaign/run_case.py --case demo-python-mid
python3 scripts/verification-campaign/run_case.py --case demo-python-zero

# real providers — export the key in the shell that runs *this* process …
export GROQ_API_KEY=…
# … and in the environment that runs the celery worker, which is what actually
# calls the provider. The agent never reads .env.
python3 scripts/verification-campaign/run_case.py --case groq-python
python3 scripts/verification-campaign/run_case.py --case groq-javascript
python3 scripts/verification-campaign/run_case.py --case groq-typescript

# the fallback drill — the submission key is deliberately invalid, because a
# working primary is what this row is trying to break
python3 scripts/verification-campaign/run_case.py --case fallback-tinyllama
```

Useful flags: `--api-base` (default `http://localhost:8000`), `--identifier` /
`--password` to reuse an account instead of registering a throwaway one,
`--poll-seconds`, `--max-wait`, `--min-interval`, and `--ledger` to rehearse into
a scratch file without touching the committed evidence.

A run that does not match its expectation exits non-zero, which makes the matrix
usable in a terminal loop or a CI job once the stack is available.

## What each row proves

| Row | Case | Proves |
| --- | --- | --- |
| 1 | `demo-python-strong` | A correct answer reaches the top of the scale. |
| 2 | `demo-python-mid` | Scoring is proportional, not pass/fail. |
| 3 | `demo-python-zero` | A wrong answer scores 0 and the run terminates. |
| 4 | `groq-python` | A real provider's code is actually run and scored. |
| 5 | `groq-javascript` | The `node --test` runner and its parser work. |
| 6 | `groq-typescript` | The `tsx --test` runner and its TAP parser work. |
| 7 | `fallback-tinyllama` | A failed primary falls back, and provenance reaches the result. |

Rows 1-3 use the deterministic `demo` provider, so their expected counts are
fixed and are asserted in `backend/tests/test_verification_campaign.py` by
running the fixtures through the real `evaluate_code`. That test is what stops
the fixtures from rotting: change the demo provider's canned solution, a runner
command, or an output parser, and it fails here rather than producing a false
PASS on somebody's next live run.

## Legs that cannot be exercised yet

Recorded here rather than quietly omitted, per the issue's acceptance criteria.
The provider catalog the running stack exposes is pre-#233 — it lists
`mock-coder`, the OpenAI/Anthropic/Gemini models and the Ollama models, but no
Groq model — so the Groq rows need #240 in the running stack first, plus an
operator-supplied `GROQ_API_KEY`. Row 7 additionally needs the worker running
with `LLM_FALLBACK_PROVIDER=ollama` / `LLM_FALLBACK_MODEL=tinyllama` and host
Ollama reachable from celery. Row 6's fixture is the one spec that could not be
executed while it was written (no `tsx` on the authoring host), so its first run
is a spec check as well as a score check; its precondition in the matrix says so.
