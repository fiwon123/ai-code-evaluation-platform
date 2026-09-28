# DEVELOPMENT.md — Daily-Loop Cheatsheet

The dev environment is a lightweight Docker "dev sandbox" (no VS Code Dev
Containers). The workspace is a single shared source of truth: an bind-mount
between the host and the `dev` container — you, the AI agent, and the running
app all see the same files. This cheatsheet covers the daily loop. Full
architecture and conventions live in `AGENTS.md` / `PROJECT_CONTEXT.md`.

## Architecture at a glance

```
You (host editor)  ──edit──▶  workspace (bind mount)
                                   │  hot reload (uvicorn --reload + vite HMR)
                                   ▼
docker compose up dev  ──▶  dev (uvicorn :8000 + vite :5173)
                            celery (evaluation worker)
                            beat (periodic stale-submission recovery sweep)
                            postgres (:5432) · redis (:6379)
                            eval-sandbox image (isolated test containers)
```

opencode (the AI coding agent) can run **on the host** or **inside the `dev`
container** (`scripts/open-in-sandbox.sh`). Both see the same files.

## File ownership (dev/celery/beat run as *you*)

The workspace is a bind mount, so anything the containers write lands on your
host with the container's UID. To keep that ownership *yours*, the `dev`,
`celery` and `beat` services run as the host user:

- The `Makefile` exports `HOST_UID`/`HOST_GID` (from `id -u`/`id -g`) and
  `DOCKER_GID` (the group of `/var/run/docker.sock`).
- `docker-compose.yml` passes them to each service as `user:` + `group_add:`,
  and to the image build as `USER_ID`/`GROUP_ID` so the baked `devuser` matches.
- `group_add` is what keeps Docker working: the evaluation worker drives the
  socket to spawn isolated eval-sandbox containers, and the sandboxed agent
  can run `docker` too.

Practical consequences: no more `sudo chown` after a heavy sandbox session, no
"locked" files in your editor, and git inside the sandbox works without a
`safe.directory` workaround. Start the stack with the Makefile (`make dev-up`)
so those variables are picked up — a bare `docker compose up` falls back to
1000:1000 and group 0, which is only correct on a 1000:1000 host. (Standalone
`scripts/open-in-sandbox.sh` exports the same values itself before it starts
the stack.) First run after upgrading an existing checkout, run this once to
clean up what earlier root-running containers left behind:
`sudo chown -R "$USER": "$(pwd)"`

Two things the identity wiring depends on, so don't "optimize" them away:

- `make dev-build` rebuilds **all three** workspace images (`dev`, `celery`,
  `beat`) — they share the Dockerfile but each has its own image, so building
  only `dev` leaves the worker running a pre-fix image with a root-owned venv.
- The image's `/tmp/uv-cache` and `/tmp/npm-cache` are world-writable (`1777`)
  because the non-root user must be able to `uv sync` / `npm ci` on a fresh
  workspace (no `node_modules` yet).

## Start / stop

```bash
make dev-up        # START: dev + celery + beat + postgres + redis + sandbox
                   # foreground with combined logs — Ctrl+C stops it
make dev-log       # tail dev + celery + beat logs without stopping
make dev-restart   # stop + start in one step (data kept, ends in foreground logs)
make dev-down      # STOP: tear down the stack (postgres data volume kept)
make dev-up        # RESTART: fast, no rebuild, data still there
make infra-up      # infra only (postgres/redis/eval-sandbox image) for host-native loop
make infra-down    # stop infra only

docker compose down -v    # ONLY to wipe the database + Redis too
```

- Ports: backend API `:8000`, frontend `:5173`, postgres `:5432`, redis `:6379`.
- `make dev-up` requires the opencode binary (`${HOME}/.opencode/bin/opencode`);
  install with `curl -fsSL https://opencode.ai/install | bash` or
  `scripts/setup-host-tools.sh`. It pre-creates `~/.config/opencode` and
  `~/.gitconfig` (mounted read-only into the container).

## Code with AI — sandboxed

```bash
scripts/open-in-sandbox.sh        # shell inside the dev container (zsh default)
cd /sandbox/ai-code-evaluation-platform && opencode     # the AI coding agent, isolated in the sandbox
```

Inside the sandbox the agent has node 22, uv (+ baked `/opt/backend-venv`), gh
(host creds), your opencode config, and git identity — plus `make check` and
the running stack at `:8000` / `:5173`. One-shot mode without a shell:

```bash
scripts/open-in-sandbox.sh 'uv run pytest'
```

**One-word shortcut** — from a second terminal while `make dev-up` streams logs
in the first, or standalone (it starts the stack if needed):

```bash
make opencode      # → opencode TUI running INSIDE the dev container
make shell         # → interactive zsh in the container (shows [SANDBOX] badge)
make help          # → list every target with its one-line description
make dev-build     # → rebuild the dev, celery and beat images after Dockerfile/pyproject/uv.lock changes
```

`make opencode` defaults to auto-approving permission prompts (`OPENCODE_ARGS=--auto`,
the trusted-agent model). Override per invocation, e.g.:

```bash
make opencode OPENCODE_ARGS=""                      # bare TUI (permission prompts)
make opencode OPENCODE_ARGS="--auto -m provider/model"
make opencode OPENCODE_ARGS="run 'task' --auto"     # one-shot non-interactive
```

> Trusted-agent model: the dev container shares the workspace bind-mount and
> the Docker socket with the host by design. Interactive shells inside the container show a `[SANDBOX]`
> prompt badge (zsh is the default shell) and the terminal title starts with
> `[SANDBOX] ai-code-evaluation-platform`, so it's clearly distinguishable from
> your host terminal — including while the opencode TUI is running (the title is
> set before launch and `OPENCODE_DISABLE_TERMINAL_TITLE=true` keeps it).
> Isolation covers the agent's runtime (filesystem, toolchain, CPU/mem caps),
> not repo/Docker access.

## Code with AI — on the host

```bash
cd <repo> && opencode
```

The host runs the full checkout with Docker access (default agent mode).
Use plan mode to discuss, build mode to implement. The agent creates the
issue → branch → PR and runs `make check` before pushing; you review and say
"merge".

## Code yourself (host editor, side-by-side)

- Edit `backend/src` or `frontend/src` in your editor → hot reload applies
  instantly (uvicorn `--reload` + vite HMR).
- Git/GitHub from the host as usual — or inside the sandbox (`gh` + git
  identity are mounted).
- Parallel work: you take one feature, the AI another — each on its own
  `feat/N-slug` branch → PR to `dev`. Never push to `dev`/`main` directly.
- Take over from the AI anytime; you share the same files and git history.

## Key commands

```bash
# Backend (host) — the sandbox uses the same baked venv
cd backend && uv sync                      # install deps
uv run uvicorn app.main:app --reload       # (dev-entrypoint already does this)
uv run alembic upgrade head                # migrations (automatic on dev-up)
uv run pytest                              # backend tests
uv run ruff check src/ tests/              # backend lint

# Example challenges are auto-seeded on backend startup (SEED_EXAMPLES=true).
# Re-run manually at any time (idempotent, system-owned rows only):
make seed-examples                         # cd backend && uv run python -m app.seed_examples

# Frontend (host)
cd frontend && npm install
npm run dev                                # (dev-entrypoint already does this)
npm run lint                               # oxlint
npm run build                              # type check + production build

# Playwright e2e (real Chromium — see "Browser tests" below)
make test-e2e                              # 6 specs, desktop + Pixel 7 profiles

# Visual sweep (real Chromium — see "Visual sweep" below)
make visual-sweep                          # 344 frames + manifest + contact sheets

# Full gate
make check                                 # backend lint+tests, frontend lint+build+tests
```

## Browser tests (`make test-e2e`)

`frontend/e2e/` is a 6-spec Playwright suite that needs a **rendered** browser:
the contrast spec measures WCAG ratios from painted pixels and the WebSocket
spec drives a live page. Everything is mocked at the network layer
(`e2e/data.ts`), so no backend is needed — Playwright reuses the Vite server on
:5173 if one is up and starts its own otherwise.

Chromium is **baked into the dev image** (`Dockerfile`, above `USER devuser`,
because its system libraries come from apt and the runtime user has no sudo).
That is the only place it can be installed: a container started from an older
image has no browser and cannot get one.

```bash
make dev-build                             # only needed after an image that predates the bake
make test-e2e                              # inside the sandbox: browser already there
```

Three things about it are deliberate, and each has a test in
`backend/tests/test_dev_sandbox_playwright.py`:

- **The image launches Chromium at build time, twice** — once as root, once as
  the runtime user. `playwright install` reports success for a download that
  cannot start (a missing shared library looks exactly like a good install), so
  the only real check is starting it.
- **`PLAYWRIGHT_VERSION` must equal the resolved `@playwright/test`** in
  `frontend/package-lock.json`. Browsers are revision-locked, so drift shows up
  only at runtime, as "Executable doesn't exist".
- **The suite runs Chromium unsandboxed** (`chromiumSandbox: false`): Docker's
  default seccomp profile blocks the user namespace its sandbox needs, and the
  alternative — `seccomp: unconfined` on the `dev` service — would strip
  filtering from uvicorn, vite, the worker and the sandboxed agent. Set
  `CHROMIUM_SANDBOX=1` to opt back in on a host that allows user namespaces.

It is deliberately **not** part of `make check`: the gate stays lint + vitest +
build so it stays fast. Run it before shipping UI changes.

## Visual sweep (`make visual-sweep`)

The screenshot matrix: every `App.tsx` route in both themes at desktop and
Pixel 7, at top/middle/bottom scroll, plus the declared interaction states and
a motion pass. Needs the same baked Chromium as `make test-e2e` and the same
`make dev-build` if your image predates the bake.

```bash
make visual-sweep                 # inside the sandbox: ~3 min, ~70 MB, 344 frames
VISUAL_SWEEP_KEEP=4 make visual-sweep   # keep more runs; the default prunes to 3
```

It builds the app and serves it with `vite preview` on :4173 — **never** the dev
server, whose HMR CSS can leave a stale module in a capture. Everything is
mocked at the network layer, so no backend is needed.

Output is per-run and gitignored:

```text
frontend/visual-sweeps/<run>/
├── light|dark/<viewport>/<route>/   PNG frames
├── states/ motion/                  declared states, motion filmstrips
├── contact-sheet/                   one captioned 4x3 sheet per route/theme/viewport
└── manifest.json                    browser version + executable path, commit, counts
```

Contact sheets are the review surface: each thumbnail is captioned with its
frame path, so a sheet is evidence rather than a picture of something.

**The run also measures the page.** Alongside each frame, 11 layout and
accessibility rules run against the same rendered DOM at the instant the frame was
shot (`e2e/visual/helpers/audit.ts`) — horizontal overflow, clipped text, content
left at opacity 0, unlabelled controls, images without `alt`, heading structure,
focus rings, touch-target size, sub-12px text. Results land in
`visual-sweeps/<run>/findings.json`, one entry per defect with the frames it was
seen in, and the rule table beside them so the file reads without a legend.

Those numbers are review input, not a gate: the sweep never fails on a finding.
The rules are locked by `e2e/visual/audit.lock.visual.ts`, which builds a page
that breaks each rule in one specific way and asserts it fires *about the element
it was aimed at*, plus pages that must produce nothing at all. Without that lock a
rule that silently stopped matching would make the report shorter, not the run
red — and "no findings" is what a broken audit looks like.

**Write the report to `docs/visual-sweep/REPORT.md` (committed), not beside the
frames.**
The frames are gitignored on purpose (70 MB per run), so a report left in the run
directory dies with the machine and its findings are never reviewed. The
manifest's provenance line — browser version, executable path, commit — belongs
at the top of the report so a finding can be traced to a browser and a tree.

Four things about this sweep are deliberate, and each is locked:

| Property | How it is held |
|---|---|
| Runs **this project's** browser | `provenance.lock.visual.ts` — a realpath under `/ms-playwright`; a `channel:`/CDP launch resolves outside it and the run aborts |
| Runs the **production build** | the config's `webServer` is `vite preview`; the guard asserts the origin is :4173 |
| No network egress | every request to an origin other than :4173 is aborted, per capture |
| Static/state frames are reproducible | `determinism.lock.visual.ts` — the same capture twice must be byte-identical, which wall-clock sampling can never be |

Static and state frames are captured with `prefers-reduced-motion: reduce`:
Home's hero types a prompt and cycles a status chip on timers that never finish,
so "at rest" is the app's own reduced-motion rendering rather than an arbitrary
freeze. Motion filmstrips keep motion on and are explicitly **not**
byte-reproducible — a transition sampled at 30% is a frame of a moving page.

Like `make test-e2e`, the sweep is **not** in `make check`: it needs the sandbox
browser, and the gate must stay fast. `*.visual.ts` is collected by neither the
vitest gate nor the normal Playwright config.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Stack up but no hot reload | `make dev-down && make dev-up` (entrypoint restarts uvicorn/vite) |
| DB in a bad state / want fresh data | `docker compose down -v && make dev-up` (wipes postgres + redis) |
| Eval sandbox image outdated | `docker compose build sandbox` (or `make infra-up`) |
| `make dev-up` errors "opencode not found" | Install opencode (see above) — only required for the sandboxed-agent mounts |
| `uv`/`npm` fails with "Permission denied" on `/tmp/uv-cache` or `/tmp/npm-cache` | The image predates the cache-ownership fix (#183) — `make dev-build` (rebuilds dev + celery + beat) |
| `celery`/`beat` seem to ignore an image/Dockerfile change | They have their own images: `make dev-build` rebuilds all three, then `make dev-restart` |
| Working tree owned by root (files "locked" in the editor, from an older root-running sandbox) | `sudo chown -R "$USER": "$(pwd)"` — **one-time** cleanup; a working tree that keeps drifting back to root means the stack was started without the Makefile (`docker compose up` directly) — use `make dev-up`, which passes `HOST_UID`/`HOST_GID` |
| `dev` container logs "UID … has no passwd entry" | The image was built for a different UID than the one you're running as — `make dev-build` to rebuild it for your UID |
| Evaluations fall back to unsandboxed execution / `celery` logs a Docker socket permission error | The host Docker socket group wasn't passed through — start the stack via the Makefile so `DOCKER_GID` is picked up (`make -n dev-up`). On macOS/rootless/remote daemons set it explicitly: `make dev-up DOCKER_GID=$(stat -f %g /var/run/docker.sock)` |
| Docker unavailable | Backend falls back to subprocess execution (`DOCKER_ENABLED=false`) |
| `make test-e2e` says "No Playwright browser found" | The image predates the Chromium bake — `make dev-build` (then `make dev-restart` if the stack is already up). On a host-native checkout, `cd frontend && npx playwright install chromium` |
| e2e fails with "Execution context was destroyed" or a form stuck on its own page | The Vite dev server pushed a full page reload into the run — `make dev-log` shows `[vite] (client) page reload` at the failure time. It only kills whichever tests were mid-navigation, so re-run; editing `frontend/src` while the suite runs causes it deliberately |
| Ollama fallback leg fails with a DNS error | `host.docker.internal` is not mapped — the compose services that call a local model need `extra_hosts: host.docker.internal:host-gateway` (#233) |
| Fallback never engages | `LLM_FALLBACK_PROVIDER` is empty (that is the off switch) — and remember `make dev-down && make dev-up` to re-read the repo-root `.env` into the worker |
| Worker says "API key missing" for a provider you configured | The key is in `backend/.env`, but compose interpolates `${GROQ_API_KEY:-}` / `${GEMINI_API_KEY:-}` from the **repo-root** `.env` and the worker reads it with `os.getenv` — move the key (see "Which `.env` gets which variable") and `make dev-restart` |
| Groq submissions fail with `403` from the worker, but `curl https://api.groq.com/openai/v1/models` on the **host** returns `401` | Groq's edge answers `403` to the same request over **IPv4** and `401` over **IPv6** — `401` means the request reached auth, so the key is fine and the worker is simply on the address family that gets rejected. Compare on the host: `curl -4` → 403, `curl -6` → 401. The compose network is dual-stack for this reason (`networks.default.enable_ipv6`); if a compose change or an older `docker-compose.yml` dropped it, `make dev-restart` to recreate the network (`down` removes it, so a plain container restart is not enough) (#270) |
| A network change in `docker-compose.yml` appears to do nothing | `docker compose restart` reuses the existing network. A change to `networks:` needs the network recreated — `make dev-restart` runs `down` then `up`, which does it while keeping the data volumes |
| Submissions stuck "pending" for hours | The recovery sweep (Celery beat) must be running: `docker compose ps` should show `beat` healthy. Stale `pending` rows are re-dispatched after 10 min and **abandoned (failed) 60 min after creation** (`PENDING_MAX_MINUTES` in `backend/src/app/tasks/recover.py`). The Profile/SubmissionDetail UI shows "stuck"/"waiting over 10 minutes" in the meantime. |

## Local model fallback (optional, for real-model testing)

A provider failure — rate limit, exhausted quota, mistyped key, an Ollama server
that isn't running — burns the whole submission for a score of 0 without ever
reaching the sandbox. Set the fallback in the **repo-root `.env`** (the file
next to `docker-compose.yml`) and the worker retries the
generation **once** with a second provider; the report then names which model
actually wrote the code:

```bash
# <repo-root>/.env (gitignored) — the free, CPU-only pairing
GROQ_API_KEY=gsk_...                 # free tier, no credit card
LLM_FALLBACK_PROVIDER=ollama
LLM_FALLBACK_MODEL=tinyllama
```

### Which `.env` gets which variable

Two files, two readers, and picking the wrong one fails silently:

| File | Read by | Holds |
|------|---------|-------|
| `<repo-root>/.env` | Docker Compose, on the host, at `make dev-up` | **Provider keys** (`GROQ_API_KEY`, `GEMINI_API_KEY`), `LLM_FALLBACK_*`, `OLLAMA_BASE_URL`, `GH_TOKEN` |
| `backend/.env` | pydantic `Settings` (`app/config.py`) | App settings only: `ENVIRONMENT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY`, `DOCKER_*`, `OLLAMA_*` |

Compose interpolates `${GROQ_API_KEY:-}` from the repo-root file, and
`app/services/llm.py` reads the key with `os.getenv` — which pydantic-settings
never populates from `backend/.env`. A key in the wrong file therefore just
yields "API key missing". See `backend/.env.example`.

Compose only interpolates the names `docker-compose.yml` actually references, so
only those values cross into the containers; anything else in the file stays on
the host. Values are read when the container starts, so **restart after
editing**: `make dev-restart`.

Neither file is readable by the agent: `opencode.json` denies `Read` of
`.env`/`.env.*` and denies `cat`/`head`/`tail`/`printenv`/`env`/
`docker compose config`/`docker inspect` of them, so
`backend/.env.example` stays readable while a live key cannot leak into a
transcript. Confirm a key arrived with a presence check, never a print:

```bash
docker compose exec celery sh -c 'test -n "$GROQ_API_KEY" && echo set'
```

- **Opt-in.** Empty `LLM_FALLBACK_PROVIDER` (the default) re-raises the
  provider's own error untouched, so an unconfigured stack behaves exactly as
  before.
- **Generation only.** A sandbox failure is the *model's* problem and goes to the
  repair loop instead; the fallback never sees it.
- **No key hand-off.** The retry is made with `api_key=None`, so the primary's
  key is never sent to a second vendor. A keyed fallback reads its own
  `KEYED_PROVIDERS` environment variable.
- **Host Ollama.** Ollama runs on the *host*, but the worker's localhost is the
  container — compose sets `OLLAMA_BASE_URL=http://host.docker.internal:11434`
  and maps that name with `extra_hosts: host.docker.internal:host-gateway`. A
  **loopback-bound server is unreachable from the container**: on Linux the
  service must bind `0.0.0.0`, not the default `127.0.0.1`:
  ```bash
  sudo systemctl edit ollama
  # [Service]
  # Environment="OLLAMA_HOST=0.0.0.0:11434"
  sudo systemctl daemon-reload && sudo systemctl restart ollama
  ```
  (On Docker Desktop the host gateway already reaches loopback, so plain
  `ollama serve` is enough. If `firewalld` is active on a Fedora/RHEL host and
  the container still cannot connect, add the bridge to the trusted zone.)

  Pick the model for the box, not for the leaderboard. Sizes are Q4_K_M, so RAM
  is roughly the download size plus overhead:

  | Model | Size | On a weak CPU |
  |-------|------|---------------|
  | `tinyllama` | ~640 MB | Fastest. Answers reliably, rarely writes passing code — a fallback, not a tester. |
  | `qwen2.5-coder:0.5b` | ~400 MB | Lightest option that still knows Python. |
  | `qwen2.5-coder:1.5b` | ~1 GB | **Best quality-per-CPU-second.** Minutes per solution on a weak host. |
  | `qwen2.5-coder:7b` | ~4.7 GB | Needs patience and RAM; fine on a desktop, painful on a laptop. |

  Generation runs on the host with no CPU/RAM cap, so a slow model costs
  wall-clock rather than correctness. Two settings bound it:

  - `OLLAMA_TIMEOUT` (default 300s) is far above the hosted providers' 60s, so
    the client does not hang up mid-answer on a slow CPU. Raise it for a 7B,
    lower it to fail fast against a dead server. The sandbox's 30s cap is a
    separate budget for *running the tests*.
  - `OLLAMA_NUM_THREADS` (unset by default) caps the threads one generation may
    use, so a burst stays off the rest of a weak machine — at the cost of
    proportionally slower answers, which the timeout then has to accommodate.
    This is enforced **by the platform**, as Ollama's `num_thread` request
    option: Ollama itself has no `OLLAMA_NUM_THREADS` variable and silently
    ignores one you export. For a server outside this codebase, the equivalent
    levers are `PARAMETER num_thread N` in a Modelfile or `taskset -c 0-1`.

  `OLLAMA_MAX_PARALLEL=1` and `OLLAMA_KEEP_ALIVE=0` are genuine Ollama variables
  worth setting on a small host — one generation at a time, and unload the model
  after each request instead of leaving it resident for the default 5m.
- Prove the retry without spending quota: point a submission at Groq with a
  deliberately wrong key. The report shows the fallback provider, its model,
  and the primary's error (with the key redacted).

## Recovery sweep (Celery beat)

A submission can strand in `pending`/`processing` (lost broker message, expired
task, killed worker). The **beat** service runs `recover_stuck_submissions`
every minute to self-heal: stale `pending` rows are re-dispatched (bounded by a
60-minute kill switch — older rows are marked `failed`), stale `processing`
rows are marked `failed`. On Kubernetes the beat Deployment ships in the base
manifests (`k8s/base/beat.yaml`); do not scale it above 1 replica (double
dispatch risk).