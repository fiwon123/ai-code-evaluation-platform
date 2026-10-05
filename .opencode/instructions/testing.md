## Testing Requirements

### General

- Tests are mandatory for new features and bug fixes
- Write tests before or alongside implementation
- Mock external services — never call real APIs in tests
- Aim for critical path coverage, not 100% line coverage

### Prerequisites

Run this **before any backend test**. Backend tests are not self-contained.

```bash
make infra-up     # postgres + redis + eval-sandbox image
```

With redis down, the failure does not look like a missing dependency — it looks
like a product bug:

```
42 failed, 840 passed, 5 skipped
...
FAILED tests/test_submissions.py::test_create_submission_success - assert 503 == 201
```

Submitting an evaluation dispatches a Celery task —
`dispatch_evaluation()` → `evaluate_submission.delay()` — and the broker **is**
Redis. `.delay()` raises when Redis is down, `dispatch_evaluation` catches it and
returns `False`, and the route answers **503**, so every test asserting a `201`
fails. `conftest.py` overrides the `get_redis` FastAPI dependency but mocks no
Celery task at all, so the broker stays real. With infra up: **885 passed,
2 skipped** (887 collected).

Other prerequisites:

| Tool | How to get it | Symptom if missing |
|------|---------------|--------------------|
| `uv` | `scripts/setup-host-tools.sh`, or `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `make check` dies immediately at the lint step with `/bin/sh: line 1: uv: command not found` and `Makefile:331: *** [lint] Error 127` |
| Node 20+ | `scripts/setup-host-tools.sh` | frontend lint/build/vitest missing |
| `make infra-up` | Docker + Compose | the 503/Redis failures above |

Use `uv run pytest`, **not** `backend/.venv/bin/pytest`. Several tests shell out
to a bare `pytest`, which only resolves when `uv run` puts `backend/.venv/bin`
on `PATH`; invoking the venv binary directly gives
`FileNotFoundError: [Errno 2] No such file or directory: 'pytest'`.

### Backend

- **Framework**: pytest (Python)
- **Location**: `backend/tests/`
- **Run**: `cd backend && uv run pytest` (needs `make infra-up` first — see
  [Prerequisites](#prerequisites))

#### Test Structure

```
backend/tests/
├── conftest.py          # Shared fixtures
├── test_<module>.py     # Module-specific tests
```

#### Conventions

- Test files: `test_<module>.py`
- Test functions: `test_<description>`
- Use fixtures from `conftest.py`
- Mock external services with `unittest.mock` or equivalent
- Mock LLM API calls — never call real providers in tests
- Mock Docker execution — use test containers or mock the Docker client

### Frontend

- **Framework**: Vitest
- **Location**: `frontend/src/**/*.test.ts(x)`
- **Run**: `cd frontend && npm test`

#### Test Structure

```
frontend/src/
├── components/
│   └── Component.test.tsx
├── pages/
│   └── Page.test.tsx
├── services/
│   └── api.test.ts
└── hooks/
    └── useHook.test.tsx
```

#### Conventions

- Test files: `<module>.test.ts(x)`
- Test functions: `it('should <description>')`
- Mock API calls with `vi.mock()`
- Use `@testing-library/react` for component tests

Frontend lint, build and Vitest need **no infra** — `make infra-up` only gates
the backend suite.

### Browser tests (Playwright, `make test-e2e`)

- **Location**: `frontend/e2e/` — 6 specs, desktop + Pixel 7 profiles
- **Run**: `make test-e2e`
- Needs a **real rendered browser**, so it is deliberately **not** part of
  `make check`: the gate stays lint + vitest + build (cheap, no browser). It is
  not optional in spirit — run it for anything touching rendered layout,
  routing or auth, and before calling responsive work done.
- Chromium is baked into the dev image **above** `USER devuser` under
  `/ms-playwright`, since apt needs root, so `make test-e2e` works inside the
  sandbox. `make dev-build` is required only after an image that predates the
  bake.
- Locked by `backend/tests/test_dev_sandbox_playwright.py`: version sync with
  `package.json`, browsers outside the bind-mounted workspace, Dockerfile install
  preceding the runtime user, a real launch as `devuser`, Playwright resolving
  that browser, the `test-e2e` target existing and running the suite, and
  `test_check_does_not_run_the_e2e_suite` pinning that `make check` stays
  browser-free. If you move Chromium or drop the `test-e2e` target, that file
  fails.

### Visual sweep (`make visual-sweep`)

Not in `make check` for the same reason — it needs the sandbox and a real
browser. Captures 344 frames plus a manifest and contact sheets.

### Linting

```bash
# Backend
cd backend && uv run ruff check src/ tests/

# Frontend
cd frontend && npm run lint
```

### Before Committing

1. Run `make infra-up` if it is not already up (backend tests fail without it)
2. Run backend tests: `cd backend && uv run pytest`
3. Run backend lint: `cd backend && uv run ruff check src/ tests/`
4. Run frontend lint: `cd frontend && npm run lint`
5. Run frontend build: `cd frontend && npm run build`
6. Run `make test-e2e` when the change touches rendered layout, routing or auth
7. Verify no regressions

Or run the whole gate in one step, which covers 1–5:

```bash
make infra-up && make check
```
