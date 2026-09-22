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
- Development: Docker and Dev Containers
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
.devcontainer/ # Docker Compose dev environment
k8s/           # Kind config + Kustomize base/overlays + Helm chart (optional)
scripts/       # k8s-setup.sh / k8s-deploy.sh / k8s-dev.sh / k8s-teardown.sh
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

### Docker Compose (Full Stack)

```bash
docker compose up -d         # Start all services
docker compose down          # Stop all services
docker compose logs -f       # View logs
```

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
  installed best-effort by `.devcontainer/setup.sh` on rebuild.
- Docker Compose remains the primary local path; K8s is optional.

## Runtime Environment

The AI agent (opencode) runs **inside a Dev Container**, not on a bare machine.

### Dev Container Setup

The devcontainer is configured with:
- **opencode**: Installed automatically via `.devcontainer/setup.sh` on container creation
- **gh CLI**: Installed via devcontainer feature, auto-authenticated from the host's `GITHUB_TOKEN` (forwarded via `remoteEnv`, re-run by `setup.sh` on every container start; auth config persisted in the `gh_config` Docker volume)
- **Node.js 22**: Installed via devcontainer feature
- **Python 3.14**: Installed via Dockerfile
- **uv**: Installed via Dockerfile
- **K8s tooling (best-effort)**: kind, kubectl, kustomize, helm, devspace installed by `.devcontainer/setup.sh` into `$HOME/.local/share/k8s-tools/bin`

### What the agent CAN do

- Run backend commands (uv, python, pytest, ruff)
- Run frontend commands (npm, npx, node)
- Run git and GitHub CLI commands
- Access services at forwarded ports

### What the agent CANNOT do

- Run `docker` or `docker compose` commands (not available inside the container)
- Access the Docker socket
- Modify the host filesystem (only the workspace is writable)
- Run K8s workflows (`make k8s-*`) end-to-end — kind/kubectl require Docker on the host; K8s manifests can be authored and validated (kustomize/helm/kubeconform) but not applied here

### Service ports (forwarded from host)

- Backend API: `localhost:8000`
- Frontend Dev: `localhost:5173`
- Database: `localhost:5432`
- Cache: `localhost:6379`

### Authentication

- **gh CLI**: Requires `GITHUB_TOKEN` (or `GH_TOKEN`) to be set on the host machine. The devcontainer forwards it via `remoteEnv` (`${localEnv:GITHUB_TOKEN}` / `${localEnv:GH_TOKEN}`) and `setup.sh` re-authenticates gh on every container start. Auth config is persisted in the `gh_config` Docker volume across rebuilds.
- **Security note**: The forwarded token is visible to every process inside the devcontainer and a copy is stored in plaintext in `hosts.yml` within the `gh_config` volume. Use a fine-grained, least-privilege PAT — ideally an expiring one — rather than a broad long-lived token.
- **opencode**: Uses API keys configured in `opencode.json` or environment variables

## Environment Variables

Backend reads from `.env` (gitignored):
- `DATABASE_URL`: Database connection
- `REDIS_URL`: Redis connection
- `JWT_SECRET_KEY`: JWT signing key (required)
- `LLM_API_KEYS`: JSON object with provider API keys
- Other service-specific variables

## Key Conventions

- Linting: Ruff for backend, Oxlint for frontend
- Testing: pytest for backend, Vitest for frontend
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

- The backend environment file is `.env`.
- Never access it without explicit permission.
- Never open, read, print, summarize, quote, or send the contents of `.env`, `.env.*`, or any other environment/secret file unless the user explicitly gives permission in the current conversation.
- Never run commands that reveal environment values (e.g., `cat .env`, `printenv`, `env`).
- Never display, repeat, log, store, or include secret values in responses, code changes, or commits.

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

### Rules for Agents

All workflow rules that agents must follow are documented in this file. When configuring a project, ensure AGENTS.md contains:

- branch strategy and naming conventions;
- CI strategy (which PRs trigger CI, local testing requirements);
- milestone and issue conventions;
- development commands (test, lint, build, format);
- environment and secret-file rules;
- any project-specific constraints or permissions.
