## Description

<Describe your changes in detail>

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] CI/CD changes
- [ ] Other (please describe)

## Related Issues

Closes #<issue-number>

## Changes Made

- <change 1>
- <change 2>
- <change 3>

## Testing

> Infra is a prerequisite — `make infra-up` (postgres + redis). Without it ~42
> backend tests fail with `assert 503 == 201` / Redis connection errors, which
> reads like a product bug but is not. See README → "Running the tests locally".

- [ ] Unit tests pass (`make infra-up`, then `cd backend && uv run pytest`)
- [ ] Linting passes (`cd backend && uv run ruff check src/ tests/`)
- [ ] Frontend lint passes (`cd frontend && npm run lint`)
- [ ] Frontend build succeeds (`cd frontend && npm run build`)
- [ ] Browser tests pass (`make test-e2e`) — required for rendered layout, routing or auth changes
- [ ] Manual testing performed

## Checklist

- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
