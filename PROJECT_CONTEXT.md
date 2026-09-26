# Project Context

## Identity

- **Project Name**: AI Code Evaluation Platform
- **One-liner**: A platform that accepts coding challenges, executes AI-generated code in isolated Docker containers, runs automated test suites, and produces evaluation results.

## Problem

As AI coding assistants generate increasing amounts of code, developers and organizations need a reliable way to automatically verify correctness, identify failures, and compare the quality of generated solutions. Manual review is slow, inconsistent, and doesn't scale.

## Goal

Build a platform where users can:
- Submit coding prompts/challenges
- Generate code using multiple LLM providers
- Execute code safely in isolated Docker containers
- Run automated test suites against the generated code
- Collect logs, metrics, and execution results
- Produce evaluation scores to assess code quality

## Stack

- **Frontend**: React 19, TypeScript, Vite, Oxlint
- **Backend**: Python 3.14, FastAPI
- **Database**: PostgreSQL
- **ORM**: SQLAlchemy
- **Storage**: Local filesystem (`/tmp/evaluations/`) for temporary code files
- **Queue/Cache**: Redis
- **Background jobs**: Celery (with Redis broker)
- **Auth**: JWT tokens (OAuth2 planned for future)
- **AI/LLM**: Multiple providers (OpenAI, Anthropic, local models)
- **Dev environment**: Docker Compose dev sandbox + host-native loop (mise toolchain)
- **Kubernetes (optional)**: Kind + Kustomize (default) + Helm (expansion) + DevSpace (dev loop)

## Supported Languages (Multi-Language Evaluation)

| Language   | Test runner                    | Entry file       |
|------------|--------------------------------|------------------|
| Python     | pytest                         | solution.py      |
| JavaScript | node --test                    | solution.js      |
| TypeScript | tsx --test                     | solution.ts      |
| Java       | javac + JUnit Platform console | Solution.java    |
| Go         | go test -v                     | solution.go     |

## Admin

- `User.is_admin` gates `/api/admin/*` routes (backend `require_admin` on `app.api.admin`) and the `/admin` frontend pages (`AdminRoute` + `adminApi`).
- Admin surface: users, challenges, submissions, platform stats.

## Architecture

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

## Directory Layout

```text
backend/          # FastAPI app, Celery workers, evaluation logic
frontend/         # React 19, Vite 8, TypeScript
docker-compose.yml # Dev sandbox stack (dev, celery, postgres, redis, sandbox)
Dockerfile        # Dev-sandbox image (deps baked: /opt/backend-venv)
dev-entrypoint.sh # Foreground uvicorn + vite entrypoint for the dev service
mise.toml         # Host toolchain single source of truth (node, uv, gh, k8s)
k8s/              # Kind config + Kustomize base/overlays + Helm chart
scripts/          # setup-host-tools.sh / open-in-sandbox.sh / k8s-setup.sh / k8s-deploy.sh / k8s-dev.sh / k8s-teardown.sh
devspace.yaml     # Kubernetes inner dev loop
```

## Error Handling (frontend)

- API errors normalized via `extractError` in `src/utils/errors.ts` (human-readable message from `{ detail }` or HTTP status).
- `ApiError` (in `src/services/api.ts`) carries `status`, `detail`, and field-level `validationErrors` from Pydantic 422 responses.
- 401 redirects apply only to non-credential endpoints; login/register surface inline messages (via `handleUnauthorized` in `src/services/api.ts`).

## Key Commands

- **Install (backend)**: `cd backend && uv sync`
- **Install (frontend)**: `cd frontend && npm install`
- **Dev server (backend)**: `cd backend && uv run uvicorn app.main:app --reload`
- **Dev server (frontend)**: `cd frontend && npm run dev`
- **Tests (backend)**: `cd backend && uv run pytest`
- **Lint (backend)**: `cd backend && uv run ruff check src/`
- **Lint (frontend)**: `cd frontend && npm run lint`
- **Type check (frontend)**: `cd frontend && npm run build`
- **Migrations**: `cd backend && uv run alembic upgrade head`
- **Format**: `cd backend && uv run ruff format src/`
- **All checks**: `make check`
- **Browser tests**: `make test-e2e` (Playwright, 6 specs in `frontend/e2e/`, desktop + Pixel 7 profiles; needs a real rendered browser so it is not in `make check`; Chromium is baked into the dev image, so run it inside the sandbox)
- **Dev sandbox**: `make dev-up` (isolated stack: uvicorn + vite + celery + postgres + redis + sandbox) / `make dev-down` / `make dev-log` / `scripts/open-in-sandbox.sh` (shell with the sandboxed opencode agent)
- **Host infra only**: `make infra-up` / `make infra-down` (for the host-native loop)
- **Host toolchain**: `scripts/setup-host-tools.sh` (gh auth + `mise install` from mise.toml)
- **K8s (optional)**: `make tools-k8s` / `make k8s-setup [OVERLAY=dev]` / `make k8s-deploy OVERLAY=dev` / `make k8s-dev` / `make k8s-status` / `make k8s-teardown`

## Notes

- Development runs either in the Docker Compose dev sandbox (`make dev-up`) or host-native (`make dev-*`, `make check`); the agent runs on the host with Docker access (no Dev Containers)
- Code execution happens in isolated Docker containers (Docker socket mounting for sandbox)
- Uses UUID primary keys for all tables
- Database migrations use Alembic
- Celery workers handle background evaluation tasks
- LLM provider is configurable per challenge/submission
- Generated code is stored temporarily in `/tmp/evaluations/` during execution
- Security: executed code runs in sandboxed Docker containers with resource limits
- The e2e suite's browser lives in the dev image (`/ms-playwright`, baked above the non-root `USER`), never in the bind-mounted workspace; `PLAYWRIGHT_VERSION` is pinned to the lockfile's `@playwright/test` because browsers are revision-locked

## Kubernetes Workflow

Local Kubernetes development uses a deliberate toolchain (v0.6.0):

- **Kind** (`k8s/kind-config.yaml`, `scripts/k8s-setup.sh` / `k8s-teardown.sh`) — lightweight local cluster; no VM needed. Host port mappings: 80/443 (ingress), 8000 (backend), 5173 (frontend).
- **Kustomize** (`k8s/base` + `k8s/overlays/{dev,staging,production}`, `scripts/k8s-deploy.sh`) — the DEFAULT manifest strategy; parameters, probes, and postgres PVC via `volumeClaimTemplates`.
- **Helm** (`k8s/helm/ai-eval-platform/`) — the expansion path for complex/HA deployments. See the chart README for the Kustomize-vs-Helm decision table.
- **DevSpace** (`devspace.yaml`, `scripts/k8s-dev.sh`) — the Kubernetes inner dev loop (file sync, port forwarding, hot reload). Requires a running Kind cluster (`make k8s-setup`).

Commands: `make k8s-setup`, `make k8s-deploy [OVERLAY=dev]`, `make k8s-dev`, `make k8s-teardown`, `make k8s-status`. Docker Compose remains the primary local path; K8s is optional.

### DevSpace vs Skaffold

**DevSpace** was chosen over Skaffold for the Kubernetes inner dev loop:

| Capability | DevSpace | Skaffold |
|------------|----------|----------|
| Bidirectional file sync (dev → cluster) | First-class (`dev.sync`) | Indirect/limited |
| Hot reload + terminal in the cluster | Built-in (`dev.terminal`, entrypoint override) | Requires manual port-forward + attach |
| DevImage (prebuilt toolchain dev overlay) | First-class (`dev.devImage`) | Not built-in |
| Deploying via raw `kubectl` / Kustomize | Native (`deployments[].kubectl.kustomize`) | Native (`kubectl` deployer) |
| Profiles / patching | Rich YAML `patches` + `vars` | Basic profiles |

Rationale: Skaffold is oriented toward *image build + deploy orchestration*;
DevSpace is oriented toward *iterating inside the cluster* (sync, ports,
terminals) — which matches this project's "edit backend/src or frontend/src,
hot-reload against a real cluster" workflow. Example: `make k8s-dev` syncs
source files into a running pod and launches `uvicorn --reload` / `vite dev`
in-cluster while forwarding 8000/5173 to localhost.

That said, Skaffold's single-command `skaffold dev` is closer to the Compose
dev loop; teams that want image-centric dev may prefer it. DevSpace is the
project default for inner-loop DX.
