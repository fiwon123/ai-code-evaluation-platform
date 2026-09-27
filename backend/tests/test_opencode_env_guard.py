"""Regression guard for the opencode `.env` read guard (issue #260).

opencode runs both on the host and inside the `dev` container, and both
bind-mount the workspace, so the repo's `.env` is an ordinary readable file —
the `Read` tool and a plain `cat` would hand a live API key to the model.
`AGENTS.md` forbids that in prose; `opencode.json` is what enforces it.

opencode resolves a permission pattern with `*` = zero-or-more of any character
and all other characters literal, and **the last matching rule wins** (see
https://opencode.ai/docs/permissions/). Both facts are load-bearing here:

* the boundary in `"* .env"` is a *space* and in `"*/.env"` a *slash*, which is
  what keeps `grep -rn "\\.env" DEVELOPMENT.md` (`.env` as regex text, not a
  path) out of the deny set while `cat .env` lands in it;
* the `.env.example` allows must come *after* the `.env.*` denies, otherwise
  the example file the docs depend on becomes unreadable.

`_resolve` below re-implements that resolution so the expectations are
executable rather than prose.
"""

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_FILE = REPO_ROOT / "opencode.json"


def _config() -> dict:
    return json.loads(CONFIG_FILE.read_text())


def _resolve(rules: dict, subject: str) -> str:
    """Return the action opencode picks for `subject` under `rules`.

    Mirrors opencode's matching: the pattern is anchored at both ends, `*`
    becomes `.*`, and a later matching rule overrides an earlier one.
    """
    action = "allow"
    for pattern, candidate in rules.items():
        rx = "^" + re.escape(pattern).replace(r"\*", ".*").replace(r"\?", ".") + "$"
        if re.match(rx, subject):
            action = candidate
    return action


def _bash(command: str) -> str:
    return _resolve(_config()["permission"]["bash"], command)


def _read(path: str) -> str:
    return _resolve(_config()["permission"]["read"], f"/sandbox/ai-code-evaluation-platform/{path}")


# --- the guard: secrets are unreachable ---------------------------------

SECRET_FILE_COMMANDS = [
    "cat .env",
    "cat ./.env",
    "cat backend/.env",
    "cat /sandbox/ai-code-evaluation-platform/.env",
    "head -n1 .env",
    "tail -5 backend/.env.local",
    "nl .env",
    "less .env",
    "more .env",
    "grep GROQ .env",
    "rg GROQ .env",
    "sed -n 1,5p .env",
    "awk '{print $1}' .env",
    # a real secret file whose name merely starts with the example's
    "cat .env.example.local",
    "cat backend/.env.example.local",
    "cat .env.production",
    "cat .envrc",
    # `.env` in a pipeline, and inside a nested shell string
    "cat .env | head",
    "docker compose exec dev cat .env",
    "docker compose exec dev sh -c 'cat .env'",
    # heredoc / redirect forms name no path in argv at all
    "cat < .env",
    "cat << EOF .env",
]

ENV_DUMP_COMMANDS = [
    "printenv",
    "printenv GROQ_API_KEY",
    "env",
    "env GROQ=x",
    "docker compose config",
    "docker compose config --services",
    "docker inspect dev",
]

SECRET_READ_PATHS = [
    ".env",
    "backend/.env",
    ".env.local",
    ".env.production",
    ".envrc",
]


@pytest.mark.parametrize("command", SECRET_FILE_COMMANDS + ENV_DUMP_COMMANDS)
def test_secret_reads_are_denied(command: str) -> None:
    assert _bash(command) == "deny", f"{command!r} can print a secret"


@pytest.mark.parametrize("path", SECRET_READ_PATHS)
def test_read_tool_cannot_open_secret_files(path: str) -> None:
    assert _read(path) == "deny", f"Read {path!r} can hand a secret to the model"


# --- the escape hatch: `.env.example` must stay usable ------------------

@pytest.mark.parametrize(
    "command",
    [
        "cat .env.example",
        "cat backend/.env.example",
        "cat .env.example | head",
        "head -20 backend/.env.example",
        "grep KEY backend/.env.example",
        "rg GROQ backend/.env.example",
        "sed -n 1,5p backend/.env.example",
    ],
)
def test_example_file_stays_readable(command: str) -> None:
    assert _bash(command) == "allow", f"{command!r} must stay readable"


def test_read_tool_can_open_the_example() -> None:
    assert _read("backend/.env.example") == "allow"


def test_example_file_exists_to_read() -> None:
    assert (REPO_ROOT / "backend" / ".env.example").is_file()


# --- no collateral damage to docs work or the dev loop ------------------

NOT_DENIED_COMMANDS = [
    "cat AGENTS.md",
    "cat DEVELOPMENT.md",
    "cat docker-compose.yml",
    "cat Makefile",
    # `.env` as regex text, not as a path: docs edits must not be blocked
    'grep -rn "\\.env" DEVELOPMENT.md',
    "rg -n 'env' backend/src",
    "git status --short",
    "uv run pytest -q",
    "make check",
    "docker compose ps",
    "docker compose logs celery",
    "ls -a",
    # presence-only checks are the supported way to confirm a key arrived
    'test -n "$GROQ_API_KEY" && echo set',
    'docker compose exec celery sh -c \'test -n "$GROQ_API_KEY" && echo set\'',
]


@pytest.mark.parametrize("command", NOT_DENIED_COMMANDS)
def test_ordinary_workflow_is_not_denied(command: str) -> None:
    assert _bash(command) != "deny", f"{command!r} is blocked but must not be"


@pytest.mark.parametrize(
    "path", ["AGENTS.md", "DEVELOPMENT.md", "docker-compose.yml", "Makefile"]
)
def test_read_tool_still_opens_ordinary_files(path: str) -> None:
    assert _read(path) == "allow"


# --- the config itself --------------------------------------------------

def test_no_duplicate_pattern_keys() -> None:
    """Duplicate keys are legal JSON but the last one silently wins."""
    for tool, rules in _config()["permission"].items():
        if isinstance(rules, dict):
            seen: list[str] = []
            duplicated = {p for p in rules if p in seen or seen.append(p)}  # type: ignore[func-returns-value]
            assert not duplicated, f"{tool}: duplicate patterns {sorted(duplicated)}"


def test_env_rules_come_before_the_example_allows() -> None:
    """opencode takes the LAST matching rule, so order is the mechanism."""
    for tool in ("bash", "read"):
        rules = list(_config()["permission"][tool].items())
        denies = [i for i, (_, action) in enumerate(rules) if action == "deny"]
        allows = [
            i
            for i, (pattern, action) in enumerate(rules)
            if action == "allow" and "example" in pattern
        ]
        assert denies and allows, f"{tool}: expected both deny and example-allow rules"
        assert max(denies) < min(allows), (
            f"{tool}: an example allow precedes a deny, so `.env` would be readable"
        )


def test_permission_block_is_valid_json() -> None:
    """opencode hard-fails to start on invalid config, so parse it in CI too."""
    assert isinstance(_config()["permission"], dict)
