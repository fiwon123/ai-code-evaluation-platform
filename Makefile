.PHONY: run test test-backend test-frontend lint format typecheck check clean dev-backend dev-frontend dev-celery dev-all install

# Install all dependencies
install:
	cd backend && uv sync
	cd frontend && npm install

# Run the application
run:
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Development servers
dev-backend:
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev -- --host 0.0.0.0

dev-celery:
	cd backend && uv run celery -A app.core.celery_app:celery_app worker --loglevel=info

# Start all development services in the background
dev-all:
	@echo "Starting development services..."
	@cd backend && nohup uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
	@cd backend && nohup uv run celery -A app.core.celery_app:celery_app worker --loglevel=info > /tmp/celery.log 2>&1 &
	@cd frontend && nohup npm run dev -- --host 0.0.0.0 > /tmp/frontend.log 2>&1 &
	@sleep 2
	@echo "  Backend:  http://localhost:8000  (logs: /tmp/backend.log)"
	@echo "  Frontend: http://localhost:5173  (logs: /tmp/frontend.log)"
	@echo "  Celery:   running                (logs: /tmp/celery.log)"

# Testing
test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && npm test

# Linting
lint:
	cd backend && uv run ruff check src/ tests/
	cd frontend && npm run lint

lint-fix:
	cd backend && uv run ruff check --fix src/ tests/

# Formatting
format:
	cd backend && uv run ruff format src/ tests/

# Type checking
typecheck:
	cd frontend && npm run build

# All checks
check: lint typecheck test

# Clean
clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	cd frontend && npm run clean 2>/dev/null || true
