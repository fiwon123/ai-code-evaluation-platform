## Testing Requirements

### General

- Tests are mandatory for new features and bug fixes
- Write tests before or alongside implementation
- Mock external services — never call real APIs in tests
- Aim for critical path coverage, not 100% line coverage

### Backend

- **Framework**: pytest (Python)
- **Location**: `backend/tests/`
- **Run**: `cd backend && uv run pytest`

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

### Linting

```bash
# Backend
cd backend && uv run ruff check src/ tests/

# Frontend
cd frontend && npm run lint
```

### Before Committing

1. Run backend tests: `cd backend && uv run pytest`
2. Run backend lint: `cd backend && uv run ruff check src/ tests/`
3. Run frontend lint: `cd frontend && npm run lint`
4. Run frontend build: `cd frontend && npm run build`
5. Verify no regressions
