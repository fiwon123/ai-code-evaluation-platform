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

| Row | Case | Proves | Needs a key? |
| --- | --- | --- | --- |
| 1 | `demo-python-strong` | A correct answer reaches the top of the scale. | no |
| 2 | `demo-python-mid` | Scoring is proportional, not pass/fail. | no |
| 3 | `demo-python-zero` | A wrong answer scores 0 and the run terminates. | no |
| 4 | `groq-python` | A real provider's code is actually run and scored. | **yes** |
| 5 | `groq-javascript` | A *hosted* provider integrates end to end on JavaScript. | **yes** |
| 6 | `groq-typescript` | A *hosted* provider integrates end to end on TypeScript. | **yes** |
| 7 | `fallback-tinyllama` | A failed primary falls back, and provenance reaches the result. | no (the key is deliberately invalid) |
| 8 | `local-ollama-python` | The real-model path runs end to end on a free, keyless provider — and the run really executed. | no |
| 9 | `local-ollama-javascript` | The `node --test` runner and its parser work on real generated code. | no |
| 10 | `local-ollama-typescript` | The `tsx --test` runner and its TAP parser work on real generated code. | no |

Rows 1-3 use the deterministic `demo` provider, so their expected counts are
fixed and are asserted in `backend/tests/test_verification_campaign.py` by
running the fixtures through the real `evaluate_code`. That test is what stops
the fixtures from rotting: change the demo provider's canned solution, a runner
command, or an output parser, and it fails here rather than producing a false
PASS on somebody's next live run.

### Which claims actually need a hosted provider

Only three rows are genuinely gated on somebody else's API, and the distinction
matters when a provider is having a bad day.

Rows 9 and 10 exist because rows 5 and 6 used to carry the `node --test` and
`tsx --test` claims on the Groq provider. Those are claims about **our** runner
and **our** output parsers, so a third party's WAF was deciding whether we could
prove our own code works. Rows 9 and 10 assert the same claims on the local
provider, with the *same test files* as their Groq twins — the only difference
between a passing row 9 and a passing row 5 is which provider wrote the code.
Rows 5 and 6 are still worth running, but for the narrower claim now written in
the table: that a *keyed* provider integrates end to end on that language.

Row 7's key is intentionally invalid, so it never needed a working one either.
What it needs is the fallback leg *configured*; see the last section.

The practical consequence: the entire "our execution path works" story — all five
languages' runners, the parsers, the sandbox, the scoring — is provable with no
API key at all. The rows that remain blocked are the ones whose subject *is* a
third party's API.

## Which provider to test with

Prefer the free, repeatable option. Only reach for a hosted provider when the
thing under test *is* a hosted provider.

| Tier | Provider | Free-tier limit | Use it for |
| --- | --- | --- | --- |
| Deterministic | `demo` | none needed | the baseline rows, and the whole automated suite — LLM calls are mocked, so the suite needs no key at all |
| **Real model, repeatable** | **`ollama` / `qwen2.5-coder:1.5b`** | **unlimited**, no key | **real-model testing** — no rate limit, no expiry, and no third party's WAF in the way |
| Quality / hosted integration | `groq` | 30 RPM, 6k TPM; daily quota is model- and plan-dependent (14.4k req/day is an upper figure, not a guarantee) | when the model has to actually be good, and for proving a keyed provider integrates end to end |

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

Rows 8-10 use the `completed` expectation rather than a score band, and that is
deliberate. `qwen2.5-coder:1.5b` is code-tuned and the best
quality-per-CPU-second in the local family, but it is still a 1.5B model and may
well fail a two-sum test suite — a low score is a legitimate result for these
rows. A `0..100` band would be theatre, because it passes even when the run
silently did nothing. Instead each row requires proof of execution: tests were
collected, no error was recorded, and a numeric score came back.
`metrics.backend` corroborates a Docker run when it is present; the subprocess
fallback records no such key, so its absence is not treated as failure (see
#264). The score is reported and not asserted.

## Legs that cannot be exercised yet

Recorded here rather than quietly omitted, per the issue's acceptance criteria.

**Rows 4, 5 and 6 are blocked by a pre-auth 403 from Groq's edge.** The catalog
is no longer the obstacle — the running stack exposes `llama-3.1-8b-instant`,
`llama-3.3-70b-versatile` and `qwen/qwen3-32b`, so the submissions are accepted
and the failure happens at generation time. From the dev sandbox `api.groq.com`
answers `403 Access denied. Please check your network settings.`
(`server: cloudflare`) for *any* path, including an unauthenticated
`GET /openai/v1/models` — a pre-auth rejection, so a valid key cannot change the
outcome. General egress is fine (`api.github.com` returns 200 from the same
shell).

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

**Row 7 is blocked by one config line, not by code.** Its key is intentionally
invalid and the primary is *supposed* to fail, so no working key is needed. What
is missing is the fallback leg being switched on in the worker:

```bash
# in the repo-root .env (read by compose, which forwards it to celery)
LLM_FALLBACK_PROVIDER=ollama
LLM_FALLBACK_MODEL=tinyllama
make dev-restart          # the worker reads these into a settings singleton at start
```

The worker has to be restarted for this: `celery worker` runs without `--reload`,
and the fallback is read from the process environment into a module-level
`Settings` once, at import. A `403` reaches the fallback correctly — the failure
observed in a live run arrived **unwrapped**, which is the signature of an empty
`llm_fallback_provider` re-raising the original exception, and not of a 403 that
the fallback refused to handle. `TestBlockedPrimaryFallsBack` in
`backend/tests/test_llm_fallback.py` now pins that distinction: a real `GroqProvider`
over a mock transport is refused with a real `403`, a real `OllamaProvider` answers,
and the metrics carry the provenance. If that test ever fails, the bug is in the
fallback; if row 7 keeps failing with an unwrapped 403, the bug is the config.

**Rows 8, 9 and 10 need host Ollama and nothing else.** The containers resolve
`host.docker.internal`, so the only missing piece is a server on the host. On
Linux it must bind `0.0.0.0`, since the default `127.0.0.1` is not reachable from
a container:

```bash
sudo systemctl edit ollama        # [Service] Environment="OLLAMA_HOST=0.0.0.0:11434"
sudo systemctl daemon-reload && sudo systemctl restart ollama
ollama pull qwen2.5-coder:1.5b    # ~1 GB; `tinyllama` too, for row 7's fallback
```

`OLLAMA_MAX_PARALLEL=1` and `OLLAMA_KEEP_ALIVE=0` are real Ollama variables worth
setting on a small host — one generation at a time, and unload the model after
each request rather than leaving it resident for the default 5m. `OLLAMA_NUM_THREADS`
is **not**: Ollama has no such variable and silently ignores it, which is why it is
now applied by the platform as the generate request's `num_thread` option
instead (see #266). A previous version of this file recommended it; it did
nothing.

All three local rows need #266 merged before they can run at all, because the
model has to be in the provider catalog or the submission is rejected. It is
merged, and they are recorded in the evidence.

On the size of a local run — **and read this before trusting a red row.**

A local row's wall-clock is dominated by the *host's* spare CPU, not by the
model. Measured on a calm host through the provider class the worker itself uses,
`qwen2.5-coder:1.5b` returned a full solution in 20.6s (Python), 9.6s
(JavaScript) and 6.5s (TypeScript). Under load it is a different machine: from the
campaign's own successful runs, generation of ~50-80 tokens took **27s, 44s, 56s
and 58s** — roughly 1-2 tokens/second, against the tens of tokens/second the same
model does when the host is idle. `loadavg` on the 6-core host was between 6 and
13 for most of a session.

The consequence is that a 60-second generation cap is a **coin flip** on this
host, not a comfortable margin. A single calm-host sample is not evidence that
the cap is adequate; it is evidence about one sample.

Row 10 is recorded as `fail` for exactly this reason, and the reason is
reproducible in the evidence rather than guessed at:

- every failure took **exactly 60.00s** between submission and result, and
  recorded `{"error": "timed out"}`;
- that string is `str(httpx.ReadTimeout)` — verified directly, not assumed. The
  sandbox path uses the `docker` SDK, whose timeout reads `Read timed out.`, so
  the only httpx client in the worker's evaluation path is the Ollama provider;
- the submissions never reached a test runner, so no runner or parser was
  implicated, and the same row passed earlier on an idle host.

So the row is not evidence that the `tsx` runner is broken, and it is not
evidence that the runner works either — it is evidence that the generation cap
was undersized for this host. #266 fixed the cap (300s default) and that is
merged; the worker picks it up on restart. **If row 10 is red and the host was
busy, restart the worker and re-run it before believing the row.**

`EVALUATION_MAX_ATTEMPTS=1` — advised when these rows were written, back when a
7B was assumed — is not the lever for any of this. The lever is spare CPU: check
`loadavg` first, and prefer `OLLAMA_NUM_THREADS` (see #266) so one generation does
not grab every core on a machine that is already busy.

