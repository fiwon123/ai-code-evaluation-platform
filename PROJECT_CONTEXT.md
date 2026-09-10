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
- **Dev environment**: Docker and Dev Containers

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
backend/       # FastAPI app, Celery workers, evaluation logic
frontend/      # React 19, Vite 8, TypeScript
.devcontainer/ # Docker Compose dev environment
```

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

## Notes

- This project runs inside a Dev Container — the agent cannot run Docker commands directly
- Code execution happens in isolated Docker containers (Docker socket mounting for sandbox)
- Uses UUID primary keys for all tables
- Database migrations use Alembic
- Celery workers handle background evaluation tasks
- LLM provider is configurable per challenge/submission
- Generated code is stored temporarily in `/tmp/evaluations/` during execution
- Security: executed code runs in sandboxed Docker containers with resource limits
