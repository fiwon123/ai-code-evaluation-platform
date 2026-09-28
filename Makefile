.PHONY: help setup host-tools infra-up infra-down preflight dev-up dev-build dev-down dev-restart \
        dev-log dev-exec dev-agent opencode shell sandbox reset \
        test test-backend test-frontend test-e2e visual-sweep lint lint-fix format typecheck build check \
        install run dev-backend dev-frontend dev-celery dev-all seed-examples clean \
        tools-k8s k8s-setup k8s-deploy k8s-teardown k8s-dev k8s-status

help: ## Show this help
	@# The character class needs 0-9: without it every target with a digit in its
	@# name is silently absent from the help (that is why all seven k8s-* targets
	@# and test-e2e were invisible), and `make help` is how anyone finds a target.
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

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

# --- GitHub auth for the dev sandbox ------------------------------------------
# The sandboxed agent needs a working token to push branches and open PRs, and
# it has to arrive as an environment variable: docker-compose.yml forwards
# GH_TOKEN/GITHUB_TOKEN, and `gh` prefers those names over its credential store.
# Reading the token straight from the shell used to break in two ways —
#
#   1. `gh auth login` writes to the gh credential store, not the environment,
#      so an operator who logged in but never exported GH_TOKEN forwarded
#      nothing and `gh` had no credential at all;
#   2. a STALE GH_TOKEN lingering in a shell profile shadowed the fresh token
#      `gh auth login` had just written (gh checks the env name first), so
#      every call failed with 401 Bad credentials.
#
# So resolve a token that is proven to work with a real authenticated call, and
# forward NOTHING when there is none — that leaves gh inside the sandbox to
# fall back to the read-only ~/.config/gh mount, which beats a guaranteed 401.
#
# `:=` not `?=`: an exported-but-stale GH_TOKEN must be REPLACED by the
# validated value, not preserved. stderr is dropped so make output stays clean;
# scripts/resolve-gh-token.sh explains itself when run directly.
GH_TOKEN := $(shell scripts/resolve-gh-token.sh 2>/dev/null || true)
# Exported only when non-empty: an exported-but-empty GH_TOKEN is worse than
# an absent one, because compose would still interpolate a value for it.
ifneq ($(strip $(GH_TOKEN)),)
GITHUB_TOKEN := $(GH_TOKEN)
export GH_TOKEN GITHUB_TOKEN
endif

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
	cd $(BACKEND_DIR) && uv run uvicorn app.main:app --reload --host :: --port 8000

dev-backend: ## Start backend dev server on the host
	cd $(BACKEND_DIR) && uv run uvicorn app.main:app --reload --host :: --port 8000

dev-frontend: ## Start frontend dev server on the host
	cd $(FRONTEND_DIR) && npm run dev -- --host ::

dev-celery: ## Start celery worker on the host
	cd $(BACKEND_DIR) && uv run celery -A app.core.celery_app:celery_app worker --loglevel=info

dev-beat: ## Start celery beat (stale-submission recovery sweep) on the host
	cd $(BACKEND_DIR) && uv run celery -A app.core.celery_app:celery_app beat --loglevel=info

dev-all: ## Start backend + celery + beat + frontend on the host (background, /tmp/*.log)
	@echo "Starting development services..."
	@cd $(BACKEND_DIR) && nohup uv run uvicorn app.main:app --reload --host :: --port 8000 > /tmp/backend.log 2>&1 &
	@cd $(BACKEND_DIR) && nohup uv run celery -A app.core.celery_app:celery_app worker --loglevel=info > /tmp/celery.log 2>&1 &
	@cd $(BACKEND_DIR) && nohup uv run celery -A app.core.celery_app:celery_app beat --loglevel=info > /tmp/beat.log 2>&1 &
	@cd $(FRONTEND_DIR) && nohup npm run dev -- --host :: > /tmp/frontend.log 2>&1 &
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

# Playwright e2e — deliberately NOT part of `make check`: it needs a real
# rendered browser (contrast is measured from pixels), which costs an image
# rebuild and a slower gate than the rest of the suite justifies. Run it before
# shipping UI changes, not on every save.
#
# The browser is baked into the dev image (see Dockerfile), so inside the
# sandbox this just works. On a host-native checkout install it once. Specs mock
# /api via route interception, so no backend is required; Playwright reuses the
# Vite server on :5173 when one is already up and starts its own otherwise.
test-e2e: ## Run the Playwright e2e suite in a real Chromium (baked into the dev image)
	@if [ ! -d "$${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent}" ] && [ ! -d "$${HOME:-/nonexistent}/.cache/ms-playwright" ]; then \
		echo "No Playwright browser found — the e2e suite cannot start."; \
		echo "  in the dev sandbox : rebuild the image (make dev-build), Chromium is baked in"; \
		echo "  on the host        : cd $(FRONTEND_DIR) && npx playwright install chromium"; \
		exit 1; \
	fi
	cd $(FRONTEND_DIR) && npm run test:e2e

# Visual sweep — deliberately NOT part of `make check` or CI, for the same
# reason as test-e2e (it needs the baked browser) plus one of its own: it writes
# hundreds of megabytes of images that a human then has to look at. It is a
# review instrument, not a gate, so running it on every push would spend minutes
# and disk to produce output nobody reads.
#
# Run it inside the dev sandbox, where the browser and the image's fonts are the
# ones the manifest names. Captures come from the production build via
# `vite preview` on :4173, never the dev server — a long-running dev server
# serves stale CSS modules, so the stylesheet in the picture would not be the one
# in the tree.
#
# Output lands in frontend/visual-sweeps/<run>/ (gitignored) and is pruned to the
# newest VISUAL_SWEEP_KEEP runs, because a run is ~300 PNGs and the interesting
# thing about an old one is usually nothing.
VISUAL_SWEEP_KEEP ?= 3

visual-sweep: ## Screenshot every page/state/motion pass in both themes and viewports, then read them
	@if [ ! -d "$${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent}" ] && [ ! -d "$${HOME:-/nonexistent}/.cache/ms-playwright" ]; then \
		echo "No Playwright browser found — the visual sweep cannot start."; \
		echo "  in the dev sandbox : rebuild the image (make dev-build), Chromium is baked in"; \
		echo "  on the host        : cd $(FRONTEND_DIR) && npx playwright install chromium"; \
		exit 1; \
	fi
	@# The images are hundreds of megabytes per run. If the ignore rule were ever
	@# dropped or renamed, the run would still succeed and quietly fill the
	@# operator's `git status` — so ask git, and fail before writing anything.
	@git check-ignore -q $(FRONTEND_DIR)/visual-sweeps/probe || { \
		echo "$(FRONTEND_DIR)/visual-sweeps/ is not gitignored — refusing to write there."; \
		echo "Add '$(FRONTEND_DIR)/visual-sweeps/' to .gitignore and try again."; \
		exit 1; \
	}
	@echo "Pruning all but the newest $(VISUAL_SWEEP_KEEP) visual sweep run(s)…"
	@cd $(FRONTEND_DIR) && ls -1dt visual-sweeps/*/ 2>/dev/null | tail -n +$$(( $(VISUAL_SWEEP_KEEP) + 1 )) \
		| xargs -r rm -rf
	@# VISUAL_SWEEP_REQUIRE_FRAMES tells the teardown this is a full sweep, so the
	@# frame-count audits are binding. Running one lock file by hand leaves it
	@# unset and the teardown merges nothing — which is correct, not a pass.
	@# The run id is minted here and reused by the footer below. Deriving it after
	@# the fact with `ls -1t` looks equivalent and is not: a half-finished run
	@# leaves a newer directory behind, and the footer then points the reviewer at
	@# the wreckage of the run that just failed.
	@# Mint the run id and print the footer in one shell: a Make recipe line is its
	@# own shell, so a run id set on the line that runs the tests is already gone by
	@# the next one. And the footer names the id it minted rather than the newest
	@# directory, which after a failed run is the wreckage of that run.
	@run="$$(date -u +%Y%m%d-%H%M%S)"; \
		cd $(FRONTEND_DIR) && \
		VISUAL_SWEEP_RUN="$$run" VISUAL_SWEEP_REQUIRE_FRAMES=1 npm run test:visual && \
		{ \
			echo ""; \
			echo "Run:        $(FRONTEND_DIR)/visual-sweeps/$$run/"; \
			echo "Contact:    visual-sweeps/$$run/contact-sheet/  (one 4x3 sheet per route, theme and viewport)"; \
			echo "Manifest:   visual-sweeps/$$run/manifest.json  (browser version + executable path, viewport, theme, commit, counts)"; \
			echo "Next:       read the frames, then write the findings up in docs/visual-sweep/REPORT.md —"; \
			echo "            the frames are gitignored, so a report left beside them dies with the machine."; \
		}

VISUAL_JOURNEYS_KEEP ?= 5

visual-journeys: ## Film interactive flows (nav, login, create, pickers, toasts) as captioned screenshots + WebM clips, then read them
	@if [ ! -d "$${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent}" ] && [ ! -d "$${HOME:-/nonexistent}/.cache/ms-playwright" ]; then \
		echo "No Playwright browser found — the journey audit cannot start."; \
		echo "  in the dev sandbox : rebuild the image (make dev-build), Chromium is baked in"; \
		echo "  on the host        : cd $(FRONTEND_DIR) && npx playwright install chromium"; \
		exit 1; \
	fi
	@git check-ignore -q $(FRONTEND_DIR)/visual-sweeps/probe || { \
		echo "$(FRONTEND_DIR)/visual-sweeps/ is not gitignored — refusing to write there."; \
		echo "Add '$(FRONTEND_DIR)/visual-sweeps/' to .gitignore and try again."; \
		exit 1; \
	}
	@echo "Pruning all but the newest $(VISUAL_JOURNEYS_KEEP) visual run(s)…"
	@cd $(FRONTEND_DIR) && ls -1dt visual-sweeps/*/ 2>/dev/null | tail -n +$$(( $(VISUAL_JOURNEYS_KEEP) + 1 )) \
		| xargs -r rm -rf
	@# The journeys share the sweep's output contract: they are only the file
	@# `journeys.visual.ts`, gated by VISUAL_JOURNEYS=1 (without it every journey
	@# test is a skip, so `make visual-sweep` keeps its exact frames/findings).
	@# VISUAL_SWEEP_REQUIRE_FRAMES stays unset, so the teardown merges the parts and
	@# writes the manifest/findings but does not demand the sweep's 300-frame sum.
	@run="$$(date -u +%Y%m%d-%H%M%S)"; \
		cd $(FRONTEND_DIR) && \
		VISUAL_SWEEP_RUN="$$run" VISUAL_JOURNEYS=1 npm run test:visual -- journeys && \
		{ \
			echo ""; \
			echo "Run:        $(FRONTEND_DIR)/visual-sweeps/$$run/"; \
			echo "Frames:     visual-sweeps/$$run/journeys/      (one directory per journey)"; \
			echo "Clips:      journeys/<id>/<id>.webm             (equal parts screen-recording and screenshot)"; \
			echo "Manifest:   visual-sweeps/$$run/manifest.json   (browser version + executable path, viewport, theme, commit, counts)"; \
			echo "Next:       read the frames, then write the findings up in docs/ux-audit/REPORT.md —"; \
			echo "            the frames are gitignored, so a report left beside them dies with the machine."; \
		}

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