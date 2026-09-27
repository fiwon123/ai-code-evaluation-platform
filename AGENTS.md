# AGENTS.md

### Product

## Project Objective

AI Code Evaluation Platform — A platform that accepts coding challenges, executes AI-generated code in isolated Docker containers, runs automated test suites, and produces evaluation results.

### Problem

As AI coding assistants generate increasing amounts of code, developers and organizations need a reliable way to automatically verify correctness, identify failures, and compare the quality of generated solutions. Manual review is slow, inconsistent, and doesn't scale.

### Goal

Build a platform where users can submit coding prompts, generate code using multiple LLM providers, execute code safely in isolated Docker containers, run automated test suites, collect logs and metrics, and produce evaluation scores to assess code quality.

### Main Technology

- Frontend: React 19, TypeScript, Vite, Oxlint
- Backend: Python 3.14, FastAPI
- Database: PostgreSQL
- ORM: SQLAlchemy
- Storage: Local filesystem (`/tmp/evaluations/`) for temporary code files
- Queue and cache: Redis
- Background jobs: Celery (with Redis broker)
- Authentication: JWT tokens (OAuth2 planned for future)
- AI: Multiple LLM providers (OpenAI, Anthropic, local models)
- Development: Docker + Compose (dev sandbox) with host-native Makefile loop
- Kubernetes (optional): Kind + Kustomize (default) + Helm (expansion) + DevSpace (dev loop)

### Supported Languages (Multi-Language Evaluation)

The sandbox image (`backend/Dockerfile.sandbox`) ships five runtimes; generated
code and its test harness run in an air-gapped, resource-limited container:

| Language   | Test runner                    | Entry file       |
|------------|--------------------------------|------------------|
| Python     | pytest                         | solution.py      |
| JavaScript | node --test                    | solution.js      |
| TypeScript | tsx --test                     | solution.ts      |
| Java       | javac + JUnit Platform console | Solution.java    |
| Go         | go test -v                     | solution.go     |

- The container gets no network access at runtime (`GOPROXY` disabled, module
  cache redirected to tmpfs).
- Docker sandbox is safely bypassed with a subprocess fallback when Docker is
  unavailable (see backend `services/docker_sandbox.py`).

### Core Architecture

```text
User → Frontend (React)
  ↓
FastAPI Backend
  ↓
PostgreSQL (users, challenges, submissions, results)
  ↓
Redis Queue (Celery tasks)
  ↓
Background Worker
  ↓
LLM API (OpenAI/Anthropic/etc.)
  ↓
Generated Code
  ↓
Docker Sandbox (isolated execution)
  ↓
Pytest (test runner)
  ↓
Evaluation Result (score, logs, metrics)
```

## Project Structure

```
backend/       # FastAPI app, Celery workers, evaluation logic
frontend/      # React 19, Vite 8, TypeScript
docker-compose.yml  # Dev sandbox + infra (dev, celery, postgres, redis, sandbox)
Dockerfile     # Dev image (python:3.14-slim + gh + uv + Node 22)
dev-entrypoint.sh  # Starts uvicorn + vite in the dev sandbox
k8s/           # Kind config + Kustomize base/overlays + Helm chart (optional)
scripts/       # k8s-setup.sh / k8s-deploy.sh / k8s-dev.sh / k8s-teardown.sh / setup-host-tools.sh
devspace.yaml  # Kubernetes inner dev loop (optional)
```

## Development Commands

### Backend

```bash
cd backend
uv sync              # Install dependencies
uv run uvicorn app.main:app --reload   # Start dev server
uv run alembic upgrade head            # Run database migrations
```

### Frontend

```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Lint code
```

### Dev Sandbox (Docker Compose)

The primary dev path is a lightweight Docker "dev sandbox" (no VS Code Dev
Containers): `docker compose up dev` runs uvicorn + vite in a prebuilt
container with the source bind-mounted; `celery` runs the evaluation worker;
`postgres`/`redis`/`sandbox` provide infra. Dependency-free host-native
targets (`make dev-*`) remain the fastest alternative. See `DEVELOPMENT.md`
for the daily-loop cheatsheet (up/down, AI-in-sandbox, manual coding).

```bash
make infra-up               # postgres + redis + sandbox image (compose, detached)
make dev-up                 # build image + run dev sandbox + celery in the foreground (logs)
make dev-down               # stop dev container + celery
make dev-log                # tail dev + celery logs
docker compose run --rm --entrypoint zsh dev   # interactive shell inside the sandbox (zsh default)
scripts/open-in-sandbox.sh  # shell in the sandbox with opencode (sandboxed agent)
make check                  # full local gate (host toolchain)
make test-e2e               # Playwright e2e (Chromium is baked into the dev image)
```

### Sandboxed AI agent (opencode inside the dev sandbox)

By default opencode runs on the **host** (this agent). For an isolated coding
environment — without Dev Containers — run opencode **inside** the `dev`
container: it inherits the container runtime (filesystem, baked toolchain,
resource caps) while sharing the workspace bind mount.

```bash
make dev-up                         # dev image mounts the host opencode binary
scripts/open-in-sandbox.sh          # → interactive zsh in the dev container ([SANDBOX] badge)
cd /sandbox/ai-code-evaluation-platform && opencode     # the AI coding agent, sandboxed
```

The dev image mounts (all read-only): the host opencode binary
(`${HOME}/.opencode/bin/opencode` → `/usr/local/bin/opencode`), opencode
config (`${HOME}/.config/opencode`) and git identity (`${HOME}/.gitconfig`);
`make dev-up` pre-creates the config paths and errors if opencode is missing.

**Ownership**: `dev`, `celery` and `beat` run as the **host user** (`user:` +
`group_add:` in `docker-compose.yml`, fed by `HOST_UID`/`HOST_GID`/`DOCKER_GID`
exported from the `Makefile`; the image bakes a matching `devuser` via
`USER_ID`/`GROUP_ID` build args). Files an agent or service writes into the
bind-mounted workspace therefore keep the host's ownership — never `root:root`,
which would leave the host user unable to edit them. Start the stack with the
Makefile so those variables are passed; a bare `docker compose up` falls back to
1000:1000. `make dev-build` rebuilds **all three** workspace images (they share
the Dockerfile but each has its own image). See DEVELOPMENT.md → "File
ownership".

**Trusted-agent model by design**: the dev container also mounts the workspace
and the Docker socket, so an agent running inside it can write the repo and
spawn eval-sandbox containers. That is the same trust granted to opencode on
the host. For stricter confinement (agent without Docker control) use a
dedicated service; for kernel-level isolation (microVM, e.g. E2B/sbx) treat it
as a separate future experiment.

### Kubernetes (optional — requires Docker on the host)

```bash
make k8s-setup               # Kind cluster + build/load images
make k8s-deploy OVERLAY=dev  # kustomize build | kubectl apply (dev/staging/production)
make k8s-dev                 # DevSpace inner dev loop (sync + ports + terminals)
make k8s-status              # Nodes + pods
make k8s-teardown            # Delete the Kind cluster
```

- Kustomize is the DEFAULT manifest strategy (`k8s/base` + `k8s/overlays`);
  Helm (`k8s/helm/ai-eval-platform/`) is the expansion path.
- The Kubernetes toolchain (kind, kubectl, kustomize, helm, devspace) is
  installed best-effort on the host by `scripts/setup-host-tools.sh`
  (`make tools-k8s`).
- Docker Compose remains the primary local path; K8s is optional.

## Runtime Environment

The AI agent (opencode) runs **on the host**, not inside a container. The
VSCode/opencode CLI connects to the host workspace directly.

### Host prerequisites

- **Python 3.14** + **uv** (backend) — `backend/.venv`; `make check`
- **Node.js 22** + **npm** (frontend) — `frontend/node_modules`
- **Docker + Compose** for infra and the dev sandbox; the host user must be
  in the `docker` group so evaluations can spawn sandbox containers via the
  mounted Docker socket
- **gh CLI** authenticated on the host (`~/.config/gh`, shared read-only
  with the dev sandbox)

**How the sandbox gets a token.** `gh` reads its credential from the
environment (`GH_TOKEN`, then `GITHUB_TOKEN`) *before* the credential store,
and `gh auth login` writes to the store rather than the environment. So an
operator who logged in but never exported a token forwarded nothing, and a
stale token lingering in a shell profile shadowed the fresh one — both ended in
401s from inside the container. `scripts/resolve-gh-token.sh` closes both: it
probes each candidate (exported `GH_TOKEN`, exported `GITHUB_TOKEN`, then the
store) with a real authenticated call and prints one only once it is proven
good. The Makefile and `scripts/open-in-sandbox.sh` call it and forward
**nothing** when there is no working token, so `gh` inside the sandbox falls
back to the read-only `~/.config/gh` mount — which beats a guaranteed 401.
Each `gh` call is capped (default 5s, `GH_TOKEN_PROBE_TIMEOUT`) because the
Makefile runs the resolver in a `$(shell ...)` at parse time, so an unbounded
probe would block *every* target, `make help` included.
Locked by `backend/tests/test_dev_sandbox_gh_token.py`.

### What the agent CAN do

- Run backend commands (uv, python, pytest, ruff)
- Run frontend commands (npm, npx, node)
- Run git and GitHub CLI commands
- Run Docker/Compose commands for infra and the dev sandbox (host socket)

### What the agent CANNOT do

- Create containers for *evaluations* directly here only if the sandbox is
  not reachable — evaluations are spawned by the Celery worker via the host
  Docker socket (subprocess fallback exists when Docker is disabled)
- Run K8s workflows (`make k8s-*`) end-to-end unless the K8s toolchain is
  on PATH (see `scripts/setup-host-tools.sh`)

### Service ports

- Backend API: `localhost:8000`
- Frontend Dev: `localhost:5173`
- Database: `localhost:5432`
- Cache: `localhost:6379`

### Authentication

- **gh CLI**: Authenticated on the host via `scripts/setup-host-tools.sh`
  (or `gh auth login`). The dev sandbox mounts `~/.config/gh` read-only.
- **opencode**: Uses API keys configured in `opencode.json` or environment variables

## Environment Variables

**Two `.env` files, two different readers** — putting a variable in the wrong one
fails silently:
- `<repo-root>/.env` (next to `docker-compose.yml`) — read by **Docker Compose on
  the host** at `make dev-up`. Holds the provider keys (`GROQ_API_KEY`,
  `GEMINI_API_KEY`), `LLM_FALLBACK_*`, `OLLAMA_BASE_URL`, `GH_TOKEN`. Compose
  only interpolates the names `docker-compose.yml` references (`${VAR:-}`), so
  only those values reach the containers. Restart the stack after editing.
- `backend/.env` — read by pydantic `Settings` for app settings only
  (`ENVIRONMENT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY`, `DOCKER_*`).
  `app/services/llm.py` reads provider keys with `os.getenv`, which
  pydantic-settings does **not** populate from this file.

Both are gitignored. See `backend/.env.example` and DEVELOPMENT.md →
"Which `.env` gets which variable".

Backend settings read from `backend/.env` (gitignored):
- `DATABASE_URL`: Database connection
- `REDIS_URL`: Redis connection
- `JWT_SECRET_KEY`: JWT signing key (required)
- `LLM_API_KEYS`: JSON object with provider API keys
- Per-provider keys, read by the worker and the dev sandbox: `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`. Never committed; a
  provider without its key fails with "API key missing" instead of falling
  back to a different vendor.
- `OLLAMA_BASE_URL`: Ollama endpoint (default `http://localhost:11434` inside
  the container; compose sets `http://host.docker.internal:11434` because a
  container's localhost is the container, not the host)
- `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL`: opt-in generation fallback.
  When the primary provider raises (rate limit, quota, network), the worker
  retries once with this provider/model and records the provenance in the
  result metrics. Empty (the default) disables the retry, so behaviour is
  unchanged. Intended pairing: `LLM_FALLBACK_PROVIDER=ollama` with
  `LLM_FALLBACK_MODEL=tinyllama` (small enough for a CPU-only host)
- Other service-specific variables

## Key Conventions

- Linting: Ruff for backend, Oxlint for frontend
- Testing: pytest for backend, Vitest for frontend
- Browser tests: Playwright in `frontend/e2e/` via `make test-e2e` — needs a
  real rendered browser, so it is **not** part of `make check`. Chromium is baked
  into the dev image (above `USER devuser`, `/ms-playwright`, since apt needs
  root), so the target works inside the sandbox and `make dev-build` is required
  only after an image that predates the bake. Locked by
  `backend/tests/test_dev_sandbox_playwright.py` (version sync, layer order, a
  real launch as the runtime user, Makefile wiring). See DEVELOPMENT.md →
  "Browser tests".
- CI: GitHub Actions runs lint + build + test on `dev` → `main` PRs only — never on feature branch PRs or push to `dev`
- Local testing: run `make check` before pushing feature branches
- Auth: JWT tokens (OAuth2 planned for future)
- Database: UUID primary keys for all tables
- Migrations: Alembic
- Background jobs: Celery with Redis broker

### Admin Role

- `User.is_admin` (bool) gates admin-only API routes and the `/admin` frontend.
- Backend: `require_admin` dependency on `app.api.admin` router — routes under `/api/admin/*` (users, challenges, submissions, stats).
- Frontend: `AdminRoute` wrapper + admin nav in `Layout`; `adminApi` in `src/services/api.ts`.

### Error Handling (frontend)

- API errors are normalized with `extractError` / `extractFieldErrors` helpers in `src/utils/errors.ts` (returns a human-readable message from `ApiError.detail` (Pydantic `{ detail }`) or falls back to the HTTP status; keeps the app resilient when the backend shape varies).
- `ApiError` (in `src/services/api.ts`) carries `status`, `detail`, and field-level `validationErrors` parsed from Pydantic 422 responses.
- Flash toasts use the shared notification pattern; 401s from non-credential endpoints trigger a session redirect via `handleUnauthorized` (login/register surface inline errors).

## Environment and Secret-File Rules

- The environment files are `<repo-root>/.env` and `backend/.env` (see
  Environment Variables above for which variables belong in each).
- Never access either without explicit permission.
- Never open, read, print, summarize, quote, or send the contents of `.env`, `.env.*`, or any other environment/secret file unless the user explicitly gives permission in the current conversation. `backend/.env.example` is the one exception: it holds placeholders and is safe to read.
- Never run commands that reveal environment values (e.g., `cat .env`, `printenv`, `env`, `docker compose config`, `docker inspect …`). `docker compose config` looks like a harmless inspection command but renders the *interpolated* values, keys included.
- To confirm a variable is set, check for presence, never print it:
  `docker compose exec celery sh -c 'test -n "$GROQ_API_KEY" && echo set'`
- Never display, repeat, log, store, or include secret values in responses, code changes, or commits.
- `opencode.json` enforces the above at the tool level (deny `Read` of `.env`/
  `.env.*`, deny `cat`/`head`/`tail`/`printenv`/`env`/`docker compose config`/
  `docker inspect` of them, allow `*.env.example`). It is the backstop, not the
  permission: bash rules are pattern-based, so an allowed interpreter
  (`uv run python -c …`) can still reach a file, and a repo-wide
  `grep -rn GROQ_API_KEY .` ignores `.gitignore`. Prefer the Grep tool
  (gitignore-aware) and locked-down patterns. Locked by
  `backend/tests/test_opencode_env_guard.py`.

If the user explicitly permits reading environment configuration:

1. Read only non-secret variables.
2. Do not read or reveal variables whose names contain: `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASS`, `CREDENTIAL`, `AUTH`, `PRIVATE`, `CERT`, `COOKIE`, `WEBHOOK`, `DATABASE_URL`, `CONNECTION_STRING`.
3. Do not reveal the values of ambiguous variables. Ask for permission before reading them.
4. You may read safe configuration variables such as: `NODE_ENV`, `ENVIRONMENT`, `PORT`, `HOST`, `API_URL`, `DEBUG`.
5. If a file contains both safe and secret variables, read only the explicitly approved safe variables.
6. Never include secret values in the final answer. Refer to them only by variable name.
7. Prefer checking whether a variable exists rather than printing its value.

## Development Workflow

### Git Workflow

- Branch from `dev` (not `main`)
- Never push directly to `dev` or `main`
- Branch naming: `<type>/<issue-number>-<slug>` (e.g., `feat/42-evaluation-api`)
- Branch types: `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, `ci/`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`
- All testing is local for feature branches — CI only runs on `dev` → `main` PRs
- Do NOT merge pull requests unless explicitly instructed
- Do NOT automatically create release PRs or merge to main — user must explicitly request
- Always return to `dev` branch after completing any merge
- Every change is tracked on GitHub: **issue → branch → PR → merge**

### Linking

- Every branch includes the issue number: `feat/42-evaluation-api`
- Every PR references its issue: `Closes #<number>`
- Every issue is assigned to a milestone before work begins
- Every PR is assigned to a milestone when created
- No orphaned branches, PRs, or issues

### Branch Strategy

```text
main          ← release merges (CI runs here — dev→main PRs only)
  └── dev     ← integration branch (all feature branches merge here)
        ├── feat/42-evaluation-api
        ├── fix/17-docker-timeout
        └── refactor/31-schema-validation
```

- Feature branches: `feat/<issue>-<slug>` → merge to `dev`
- Release: `dev` → `main` (PR triggers CI — user must explicitly request)
- Hotfixes: `fix/<issue>-<slug>` → merge to `dev`, cherry-pick to `main` if urgent

### Milestones

- Every issue MUST be assigned to a milestone before work begins
- Milestones represent releases or sprint iterations
- Use `gh issue edit <number> --milestone "<milestone-name>"`
- Track milestone progress on the GitHub Milestones page

### Agents

Agent definitions live in `opencode.json` and `.opencode/agents/`:

- **build** (primary): Full development work with all tools enabled
- **plan** (primary): Analysis and planning without making changes — restricted to read-only subagents (explore, reviewer only)
- **backend** (subagent): Implements FastAPI routes, services, Celery workers, and evaluation logic
- **frontend** (subagent): Implements React UI components, pages, hooks, and client-side behavior
- **reviewer** (subagent): Reviews code for bugs, security, and regressions

### Skills

- Load relevant skills when working on specific domains (e.g., Docker, Celery, LLM integration)

### Session Memory (progress file)

- At the START of every new chat: read `.opencode/progress.md` (if it exists) and
  resume from its "Next action" — this is how long-running work survives between
  sessions. If the file references an issue/branch/PR, continue that work unless
  the user says otherwise.
- During work: update the file after each milestone (issue created, branch
  renamed, code done, tests run, PR opened, merged).
- Keep it small: prune completed detail to one line; cap at ~80–100 lines;
  never store secrets/tokens/credentials; it is gitignored and must never be
  committed.

### Rules for Agents

All workflow rules that agents must follow are documented in this file. When configuring a project, ensure AGENTS.md contains:

- branch strategy and naming conventions;
- CI strategy (which PRs trigger CI, local testing requirements);
- milestone and issue conventions;
- development commands (test, lint, build, format);
- environment and secret-file rules;
- any project-specific constraints or permissions.
