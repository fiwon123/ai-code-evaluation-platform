.PHONY: run test test-backend test-frontend lint format typecheck check clean dev-backend dev-frontend install

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
	cd frontend && npm run dev

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
