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
                           postgres (:5432) · redis (:6379)
                           eval-sandbox image (isolated test containers)
```

opencode (the AI coding agent) can run **on the host** or **inside the `dev`
container** (`scripts/open-in-sandbox.sh`). Both see the same files.

## Start / stop

```bash
make dev-up        # START: build (once) + dev + celery + postgres + redis + sandbox
                   # foreground with combined logs — Ctrl+C stops it
make dev-log       # tail dev + celery logs without stopping
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
scripts/open-in-sandbox.sh        # shell inside the dev container
cd /workspace && opencode         # the AI coding agent, isolated in the sandbox
```

Inside the sandbox the agent has node 22, uv (+ baked `/opt/backend-venv`), gh
(host creds), your opencode config, and git identity — plus `make check` and
the running stack at `:8000` / `:5173`. One-shot mode without a shell:

```bash
scripts/open-in-sandbox.sh 'uv run pytest'
```

> Trusted-agent model: the dev container shares the workspace bind-mount and
> the Docker socket with the host by design. Isolation covers the agent's
> runtime (filesystem, toolchain, CPU/mem caps), not repo/Docker access.

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
| Working tree owned by root (from an old sandbox) | `sudo chown -R "$USER": "$(pwd)"` |
| Docker unavailable | Backend falls back to subprocess execution (`DOCKER_ENABLED=false`) |