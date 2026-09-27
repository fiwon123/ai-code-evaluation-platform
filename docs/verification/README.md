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

# the free, keyless real-model row — needs host Ollama, needs no key and no
# egress to any hosted provider. This is the one to reach for by default.
python3 scripts/verification-campaign/run_case.py --case local-ollama-python
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
| 8 | `local-ollama-python` | The real-model path runs end to end on a free, keyless provider — and the run really executed. |

Rows 1-3 use the deterministic `demo` provider, so their expected counts are
fixed and are asserted in `backend/tests/test_verification_campaign.py` by
running the fixtures through the real `evaluate_code`. That test is what stops
the fixtures from rotting: change the demo provider's canned solution, a runner
command, or an output parser, and it fails here rather than producing a false
PASS on somebody's next live run.

## Which provider to test with

Prefer the free, repeatable option. Only reach for a hosted provider when the
thing under test *is* a hosted provider.

| Tier | Provider | Free-tier limit | Use it for |
| --- | --- | --- | --- |
| Deterministic | `demo` | none needed | the baseline rows, and the whole automated suite — LLM calls are mocked, so the suite needs no key at all |
| **Real model, repeatable** | **`ollama` / `tinyllama`** | **unlimited**, no key | **real-model testing** — no rate limit, no expiry, and no third party's WAF in the way |
| Quality / hosted integration | `groq` | 30 RPM, 6k TPM, 14.4k req/day (org-wide) | when the model has to actually be good, and for proving a keyed provider integrates end to end |

**Rejected: OpenRouter's free tier.** It is reachable (200) and has capable free
models, but the free allowance is **50 requests/day** (1,000 after a one-time $10),
failed requests still count against it, and the per-model ids churn. A test
fixture that runs a row per language per provider cannot live on 50 requests a
day, and a mid-campaign 429 would be indistinguishable from a product failure.
Together is rejected for the same reason (credit-metered, hard rate limits).

**What actually leaves the machine** when a hosted provider is used — worth
knowing before sending a challenge to a free endpoint, because it is not only the
prompt: the provider receives the system prompt and the challenge prompt, and on a
*repair retry* it also receives the previously generated code plus the test-failure
`feedback`. That feedback can carry assertion text from the **hidden tests**, so
"just a prompt" understates it. Ollama sends none of this anywhere, which is the
privacy reason to prefer it — and the reason a free endpoint that may log prompts
is the worst of the three.

Row 8 uses the `completed` expectation rather than a score band, and that is
deliberate. `tinyllama` is 1.1B and will probably fail a two-sum test suite —
a low score is a legitimate result for this row. A `0..100` band would be
theatre, because it passes even when the run silently did nothing. Instead the
row requires proof of execution: tests were collected, an execution backend was
recorded (`docker`, or `subprocess` when Docker is unavailable), no error was
recorded, and a score came back. The score is reported and not asserted.

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

**Groq is also blocked at the network level, not the key level.** From the dev
sandbox `api.groq.com` answers `403 Access denied. Please check your network
settings.` (`server: cloudflare`) for *any* path, including an unauthenticated
`GET /openai/v1/models` — so it is a pre-auth rejection, and a valid key cannot
change the outcome. General egress is fine (`api.github.com` returns 200 from
the same shell).

**Whose network matters:** the worker makes the provider call, so it is the
*container's* egress that Groq judges — not the network of whatever machine
submits the run. Reaching the API from elsewhere (a tunnel, a second machine) only
creates the submission; it cannot unblock the generation. So a host-side
`curl` that succeeds while the row fails is expected, and is not a workaround.
To unblock these rows, give the worker's egress a route Groq accepts (a proxy in
the worker's environment, or the stack running on such a network) and check it
from *inside the worker* before spending a run:

```bash
docker compose exec celery curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.groq.com/openai/v1/models   # 403 = still blocked; 401 = reached
```

**Row 8 needs host Ollama and nothing else.** The containers resolve
`host.docker.internal`, so the only missing piece is a server on the host:

```bash
OLLAMA_NUM_THREADS=2 OLLAMA_MAX_PARALLEL=1 OLLAMA_KEEP_ALIVE=0 ollama serve
ollama pull tinyllama
```

Until that is up, row 8 stays `not run` in the evidence — a fixture existing is
not a row passing.
