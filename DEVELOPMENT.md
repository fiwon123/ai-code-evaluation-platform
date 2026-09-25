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

# Full gate
make check                                 # backend lint+tests, frontend lint+build+tests
```

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
| Submissions stuck "pending" for hours | The recovery sweep (Celery beat) must be running: `docker compose ps` should show `beat` healthy. Stale `pending` rows are re-dispatched after 10 min and **abandoned (failed) 60 min after creation** (`PENDING_MAX_MINUTES` in `backend/src/app/tasks/recover.py`). The Profile/SubmissionDetail UI shows "stuck"/"waiting over 10 minutes" in the meantime. |

## Recovery sweep (Celery beat)

A submission can strand in `pending`/`processing` (lost broker message, expired
task, killed worker). The **beat** service runs `recover_stuck_submissions`
every minute to self-heal: stale `pending` rows are re-dispatched (bounded by a
60-minute kill switch — older rows are marked `failed`), stale `processing`
rows are marked `failed`. On Kubernetes the beat Deployment ships in the base
manifests (`k8s/base/beat.yaml`); do not scale it above 1 replica (double
dispatch risk).