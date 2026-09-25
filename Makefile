.PHONY: help setup host-tools infra-up infra-down preflight dev-up dev-build dev-down dev-restart \
        dev-log dev-exec dev-agent opencode shell sandbox reset \
        test test-backend test-frontend lint lint-fix format typecheck build check \
        install run dev-backend dev-frontend dev-celery dev-all seed-examples clean \
        tools-k8s k8s-setup k8s-deploy k8s-teardown k8s-dev k8s-status

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# Compose command (override-friendly; e.g. COMPOSE="docker-compose")
COMPOSE ?= docker compose
BACKEND_DIR := backend
FRONTEND_DIR := frontend

# --- Host identity for the dev sandbox ---------------------------------------
# The workspace is bind-mounted into the dev/celery/beat containers, so those
# services run as the HOST user: without this every file they write (build
# output, __pycache__, agent edits) lands on the host owned by root:root and
# shows up "locked" in the host editor.
#
# NOTE: deliberately NOT named UID — bash defines UID as a read-only shell
# variable that is *not* exported, so compose interpolation of ${UID} would
# silently fall back to its default for every user whose UID isn't 1000.
HOST_UID ?= $(shell id -u)
HOST_GID ?= $(shell id -g)
# Host Docker socket group (root:docker, 660 on Fedora/Ubuntu). Passed to
# compose as group_add so the non-root user can still drive Docker — required
# by the evaluation worker (isolated eval-sandbox containers) and by the
# sandboxed agent. `stat -c` is GNU coreutils, `stat -f` is BSD/macOS: try both
# before giving up, otherwise a macOS host silently ends up with group 0, the
# worker loses socket access and evaluations silently fall back to UNSANDBOXED
# subprocess execution. Last resort is 0 (root-owned socket / absent socket);
# override explicitly (DOCKER_GID=1234) for rootless or remote daemons.
DOCKER_GID ?= $(shell stat -c %g /var/run/docker.sock 2>/dev/null || stat -f %g /var/run/docker.sock 2>/dev/null || echo 0)
export HOST_UID HOST_GID DOCKER_GID

# --- Host-native path (fastest, no containers) -------------------------------
install: setup ## Alias for setup (kept for backwards compatibility)
setup: ## Install host-native deps (uv sync + npm install)
	cd $(BACKEND_DIR) && uv sync
	cd $(FRONTEND_DIR) && npm install

host-tools: ## Install dev tools on the host via mise (kind/kubectl/kustomize/helm/devspace)
	@command -v mise >/dev/null 2>&1 || scripts/setup-host-tools.sh --no-gh
	mise install
	@echo "Toolchain installed (see mise.toml — k8s: kind, kubectl, kustomize, helm, devspace)."

run: ## Run the backend dev server on the host
	cd $(BACKEND_DIR) && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-backend: ## Start backend dev server on the host
	cd $(BACKEND_DIR) && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend: ## Start frontend dev server on the host
	cd $(FRONTEND_DIR) && npm run dev -- --host 0.0.0.0

dev-celery: ## Start celery worker on the host
	cd $(BACKEND_DIR) && uv run celery -A app.core.celery_app:celery_app worker --loglevel=info

dev-beat: ## Start celery beat (stale-submission recovery sweep) on the host
	cd $(BACKEND_DIR) && uv run celery -A app.core.celery_app:celery_app beat --loglevel=info

dev-all: ## Start backend + celery + beat + frontend on the host (background, /tmp/*.log)
	@echo "Starting development services..."
	@cd $(BACKEND_DIR) && nohup uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
	@cd $(BACKEND_DIR) && nohup uv run celery -A app.core.celery_app:celery_app worker --loglevel=info > /tmp/celery.log 2>&1 &
	@cd $(BACKEND_DIR) && nohup uv run celery -A app.core.celery_app:celery_app beat --loglevel=info > /tmp/beat.log 2>&1 &
	@cd $(FRONTEND_DIR) && nohup npm run dev -- --host 0.0.0.0 > /tmp/frontend.log 2>&1 &
	@sleep 2
	@echo "  Backend:  http://localhost:8000  (logs: /tmp/backend.log)"
	@echo "  Frontend: http://localhost:5173  (logs: /tmp/frontend.log)"
	@echo "  Celery:   running                (logs: /tmp/celery.log)"
	@echo "  Beat:     running                (logs: /tmp/beat.log)"

seed-examples: ## Seed the curated example challenges into the DB (idempotent)
	cd $(BACKEND_DIR) && uv run python -m app.seed_examples

# --- Infrastructure only (postgres/redis/eval-sandbox image) -----------------
infra-up: ## Start postgres + redis + build the eval-sandbox image (host-native path)
	$(COMPOSE) up -d --build postgres redis sandbox

infra-down: ## Stop infra only (also stops dev/celery if running)
	$(COMPOSE) down postgres redis sandbox

# --- Isolated dev sandbox (dev + worker + infra) -----------------------------
#
# `make dev-up` starts the dev container (uvicorn + vite, hot reload) plus
# celery, postgres, redis and builds the eval-sandbox image. Rebuilds after
# Dockerfile/pyproject/uv.lock changes go through `make dev-build` (plain
# `dev-up` reuses existing images — compose auto-builds only when missing).
#
# Sandboxed AI coding agent (trusted-agent model): the dev container mounts
# the host opencode binary + config, git identity, and gh auth read-only,
# plus the host Docker socket (RW by design — see DEVELOPMENT.md). Only the
# sandbox-starting targets below require the host opencode binary; the
# host-native loop (infra-up / make check) never does.
# NOTE: not named OPENCODE — the opencode agent runtime exports an OPENCODE
# env var (=1) which would override a ?= default via make's env import.
OPENCODE_BIN ?= $(HOME)/.opencode/bin/opencode

# Default for the sandbox: auto-approve permission prompts (trusted-agent
# model — the dev container already has the workspace + docker socket).
# Override per-invocation, e.g.:
#   make opencode OPENCODE_ARGS=""                      # bare TUI (prompts back)
#   make opencode OPENCODE_ARGS="--auto -m provider/model"
#   make opencode OPENCODE_ARGS="run 'task' --auto"     # one-shot non-interactive
OPENCODE_ARGS ?= --auto

preflight: ## (internal) Require host opencode + pre-create mounted config paths
	@test -x "$(OPENCODE_BIN)" || { echo "ERROR: opencode not found at $(OPENCODE_BIN)" >&2; \
	  echo "  Install: curl -fsSL https://opencode.ai/install | bash   (or scripts/setup-host-tools.sh)" >&2; exit 1; }
	@mkdir -p "$(HOME)/.config/opencode" "$(HOME)/.config/gh" && touch "$(HOME)/.gitconfig"

dev-up: preflight ## Start the isolated dev sandbox (uvicorn + vite + worker + infra)
	$(COMPOSE) up dev

# dev-build rebuilds EVERY workspace service, not just `dev`: celery and beat
# build from the same Dockerfile into their own images, so building only `dev`
# left them on the previous (pre-fix) image — a root-owned venv and no
# devuser — which is exactly the state issue #183 removes.
dev-build: ## Rebuild the dev, celery and beat images (Dockerfile/pyproject/uv.lock changes)
	$(COMPOSE) build dev celery beat

dev-down: ## Stop the dev sandbox (keeps data volumes)
	$(COMPOSE) down

dev-restart: preflight ## Stop and restart the dev sandbox in one step (data kept, foreground logs)
	$(COMPOSE) down
	$(COMPOSE) up dev

dev-log: ## Tail dev sandbox + celery worker + beat logs
	$(COMPOSE) logs -f dev celery beat

dev-exec: ## Open a shell inside the dev sandbox
	$(COMPOSE) exec dev zsh

opencode: preflight ## Run the AI coding agent (opencode) inside the dev sandbox
	@if [ -z "$$($(COMPOSE) ps -q dev)" ]; then echo "[opencode] starting dev stack..."; $(COMPOSE) up -d dev; fi
	@echo "[sandbox] opencode is running INSIDE the dev container (terminal title: [SANDBOX] ...)"
	@if [ -t 0 ]; then $(COMPOSE) exec -it dev zsh -lc "cd /sandbox/ai-code-evaluation-platform && env OPENCODE_DISABLE_TERMINAL_TITLE=true opencode $(OPENCODE_ARGS)"; else $(COMPOSE) exec -T dev zsh -lc "cd /sandbox/ai-code-evaluation-platform && env OPENCODE_DISABLE_TERMINAL_TITLE=true opencode $(OPENCODE_ARGS)"; fi

# Alias kept for compatibility with earlier dev-sandbox docs.
dev-agent: opencode

shell: preflight ## Open an interactive zsh shell in the dev sandbox (opencode ready)
	scripts/open-in-sandbox.sh

# Alias kept for compatibility with earlier dev-sandbox docs.
sandbox: shell

reset: ## Stop everything and wipe volumes (clean slate — destructive!)
	$(COMPOSE) down -v

# --- Kubernetes (optional — requires Docker + the K8s toolchain on PATH) -----
# Docker Compose remains the primary local path. These targets wrap the
# scripts under scripts/ (the source of truth); see k8s/ for manifests.
tools-k8s: ## Host k8s toolchain from mise.toml (kind/kubectl/kustomize/helm/devspace)
	@command -v mise >/dev/null 2>&1 || scripts/setup-host-tools.sh --no-gh
	mise install
	@echo "Toolchain installed (see mise.toml — k8s: kind, kubectl, kustomize, helm, devspace)."

k8s-setup: ## Create the Kind cluster + build/load images
	scripts/k8s-setup.sh

k8s-deploy: ## Deploy manifests: make k8s-deploy [OVERLAY=dev|staging|production]
	scripts/k8s-deploy.sh $(OVERLAY)

k8s-dev: ## DevSpace inner dev loop (sync + ports + terminals)
	scripts/k8s-dev.sh

k8s-teardown: ## Delete the Kind cluster
	scripts/k8s-teardown.sh

k8s-status: ## Show nodes + pods
	@kubectl get nodes -o wide
	@kubectl get pods -A

# --- Testing -----------------------------------------------------------------
test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests (pytest)
	cd $(BACKEND_DIR) && uv run pytest

test-frontend: ## Run frontend tests (vitest)
	cd $(FRONTEND_DIR) && npm test

# --- Lint / format ------------------------------------------------------------
lint: ## Lint backend (ruff) + frontend (oxlint)
	cd $(BACKEND_DIR) && uv run ruff check src/ tests/
	cd $(FRONTEND_DIR) && npm run lint

lint-fix: ## Auto-fix lint issues (ruff --fix + oxlint --fix)
	cd $(BACKEND_DIR) && uv run ruff check --fix src/ tests/
	cd $(FRONTEND_DIR) && npm run lint:fix

format: ## Format backend code (ruff format)
	cd $(BACKEND_DIR) && uv run ruff format src/ tests/

# --- Build / typecheck ---------------------------------------------------------
typecheck: ## Frontend typecheck + build (tsc -b && vite build)
	cd $(FRONTEND_DIR) && npm run build

build: typecheck ## Build the frontend (same as make typecheck)

check: lint test build ## Full local gate: lint + tests + build

# --- Cleanup -------------------------------------------------------------------
clean: ## Remove build caches
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	cd $(FRONTEND_DIR) && npm run clean 2>/dev/null || true