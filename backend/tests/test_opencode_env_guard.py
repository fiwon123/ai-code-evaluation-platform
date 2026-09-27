"""Regression guard for the opencode `.env` read guard (issues #260, #262).

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
  the example file the docs depend on becomes unreadable;
* **agent rules are merged after the global ones and take precedence**, also
  resolved by order (https://opencode.ai/docs/agents/#permissions). So an agent
  that declares its own `bash` block gets that block appended *wholesale* after
  the global one, and the agent's own catch-all `"*"` therefore outranks every
  global deny. That is the #262 bug: the global `"* .env": "deny"` was present
  and correct, and `cat .env` still printed the secret, because `build`'s
  trailing `"*": "ask"` won and `make dev-agent` runs opencode with `--auto`
  (auto-approve), which turns `ask` into a yes. Explicit `deny` is the only
  thing `--auto` cannot override.

So the guard has to be asserted against the **effective** rules of every agent,
not against the global block alone. `_effective_bash` below reproduces that
merge. The two structural tests (`test_env_denies_follow_the_catch_all`,
`test_env_denies_precede_example_allows`) assert the ordering *directly*, so
they hold even if `_resolve`'s re-implementation of the matcher ever drifts
from the real one.
"""

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_FILE = REPO_ROOT / "opencode.json"

# A repo-root `.env` is the file the whole guard exists to protect, so the
# read-side subjects are anchored to the real checkout rather than a hardcoded
# sandbox path.
REPO_PATH = f"{REPO_ROOT}/"


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
    return _resolve(_config()["permission"]["read"], f"{REPO_PATH}{path}")


# --- the merge that #262 was invisible to ---------------------------------


def _agent_bash(agent: str) -> dict:
    """The agent's own `bash` rules, or `{}` when it declares none."""
    block = _config()["agent"].get(agent, {}).get("permission", {}).get("bash")
    return block if isinstance(block, dict) else {}


def _agents() -> dict[str, dict]:
    return {
        name: agent.get("permission", {}).get("bash")
        for name, agent in _config()["agent"].items()
    }


def _merge(global_rules: dict, agent_rules: dict) -> dict:
    """Append `agent_rules` after `global_rules`; the agent's rules win.

    Appending wholesale — not `dict.update` — is the point. `update` keeps a
    duplicated key at its *first* position, which would model agent rules as
    losing to the global catch-all and hide the very bug this file exists to
    catch: an agent whose block has a catch-all but no guard of its own is
    shadowed in reality, and only this ordering reproduces that.
    """
    merged: dict[str, str] = dict(global_rules)
    for pattern, action in agent_rules.items():
        merged.pop(pattern, None)
        merged[pattern] = action
    return merged


def _effective_bash(agent: str) -> dict:
    """The `bash` rules that actually govern `agent`."""
    return _merge(_config()["permission"]["bash"], _agent_bash(agent))


def _agent_bash_action(agent: str, command: str) -> str:
    return _resolve(_effective_bash(agent), command)


def _shell_capable_agents() -> set[str]:
    """Agents whose `bash` block is not a blanket `deny`.

    These are the agents that must carry the env guard themselves: an agent
    pinned to `"*": "deny"` already refuses every command, so demanding a
    redundant copy there would only add noise. Derived from the config rather
    than hardcoded, so renaming or adding an agent cannot quietly drop it.
    """
    return {
        name
        for name, rules in _agents().items()
        if isinstance(rules, dict) and rules.get("*") != "deny"
    }


def _env_deny_indexes(rules: dict) -> list[int]:
    return [i for i, (p, a) in enumerate(rules.items()) if a == "deny" and ".env" in p]


def _example_allow_indexes(rules: dict) -> list[int]:
    return [
        i for i, (p, a) in enumerate(rules.items()) if a == "allow" and "example" in p
    ]


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


# --- the same guard, per agent (#262) -------------------------------------
#
# The global block above is necessary but NOT sufficient: it is what #260
# asserted, and it was green while `cat .env` printed the secret. Every agent
# that can run a command gets its own effective rule set, so that is what gets
# asserted.


@pytest.mark.parametrize("agent", sorted(_config()["agent"]))
def test_merge_model_reproduces_agent_precedence(agent: str) -> None:
    """The merge model itself must be falsifiable, or #262 is undetectable.

    A synthetic agent with a catch-all and *no* guard of its own is the exact
    #262 shape: reality lets that catch-all outrank the global deny, and this
    model has to agree or the whole per-agent section is theatre. It is also
    the mutation that `dict.update` survives, so pinning it here is what stops
    someone "simplifying" the merge into a version that cannot see the bug.
    """
    shadowed = _merge(
        {"*": "ask", "* .env": "deny"},
        {"*": "ask", "git status*": "allow"},
    )
    assert _resolve(shadowed, "cat .env") == "ask", (
        "the merge model must let an agent's catch-all outrank the global deny; "
        "if this fails, every per-agent assertion below is measuring the wrong thing"
    )

    guarded = _merge({"*": "ask", "* .env": "deny"}, {"*": "ask", "* .env": "deny"})
    assert _resolve(guarded, "cat .env") == "deny"

    # The real config's agents must all be reachable through the model, so a
    # rename cannot quietly fall out of the sweep.
    assert agent in _config()["agent"]
    assert _effective_bash(agent), f"agent {agent!r} resolved to no bash rules"


AGENT_SECRET_COMMANDS = [
    "cat .env",
    "cat backend/.env",
    "cat .envrc",
    "cat .env | head",
    "docker compose exec dev sh -c 'cat .env'",
    "cat < .env",
    "printenv",
    "printenv GROQ_API_KEY",
    "docker compose config",
    "docker inspect dev",
]


def test_every_agent_denies_secret_reads() -> None:
    """Swept in-body, not parametrised, on purpose.

    An `@pytest.mark.parametrize("agent", [])` collects zero cases and reports
    success, and a vacuity check that reads the *config* cannot see the
    difference — the parametrised version of this test survived exactly that
    mutation. Looping here makes "inspected nothing" a counted assertion.
    """
    agents = sorted(_config()["agent"])
    assert len(agents) >= 4, f"expected the project's agents, found {agents}"
    assert "build" in agents, "the build agent is the one that runs bash"

    checked = 0
    for agent in agents:
        for command in AGENT_SECRET_COMMANDS:
            assert _agent_bash_action(agent, command) == "deny", (
                f"agent {agent!r} can run {command!r}, which prints a secret"
            )
            checked += 1
    assert checked == len(agents) * len(AGENT_SECRET_COMMANDS) > 0, (
        f"swept {checked} cases, expected {len(agents) * len(AGENT_SECRET_COMMANDS)}"
    )


def test_shell_capable_agents_carry_the_env_guard() -> None:
    """Every non-blanket-denied agent must repeat the guard in its own block.

    This is the #262 invariant stated structurally: a global-only guard is
    shadowed by the agent's own catch-all, so the guard has to be repeated
    where it can win.
    """
    capable = _shell_capable_agents()
    assert len(capable) >= 3, f"expected the shell-capable agents, got {capable}"
    # Both kinds must exist, so the sweep spans agents that carry the guard and
    # agents that are exempt from carrying it but still swept behaviourally.
    assert capable < set(_config()["agent"]), (
        f"expected some blanket-denied agents too, got {sorted(_config()['agent'])}"
    )
    for agent in sorted(capable):
        denies = _env_deny_indexes(_agent_bash(agent))
        assert denies, f"agent {agent!r} can run bash but carries no .env deny"


@pytest.mark.parametrize("agent", sorted(_shell_capable_agents()))
def test_env_denies_follow_the_catch_all(agent: str) -> None:
    """Order is the mechanism, so assert the order and not only the outcome.

    Matcher-independent on purpose: this holds even if `_resolve` stops
    agreeing with the real opencode matcher.
    """
    rules = _agent_bash(agent)
    assert "*" in rules, f"agent {agent!r} has no catch-all to order against"
    catch_all = list(rules).index("*")
    denies = _env_deny_indexes(rules)
    assert denies, f"agent {agent!r} declares no .env deny to place"
    assert min(denies) > catch_all, (
        f"agent {agent!r}: a .env deny sits at {min(denies)}, before the catch-all "
        f"at {catch_all}, so the catch-all outranks it and the guard is dead"
    )


@pytest.mark.parametrize("agent", sorted(_shell_capable_agents()))
def test_env_denies_precede_example_allows(agent: str) -> None:
    """`.env.example` must stay readable: its allows come after the denies."""
    rules = _agent_bash(agent)
    denies = _env_deny_indexes(rules)
    allows = _example_allow_indexes(rules)
    assert denies and allows, f"agent {agent!r}: expected both kinds of rule"
    assert max(denies) < min(allows), (
        f"agent {agent!r}: an example allow precedes a deny, so `.env` would be "
        "readable"
    )


# --- the escape hatch: `.env.example` must stay usable ------------------

EXAMPLE_COMMANDS = [
    "cat .env.example",
    "cat backend/.env.example",
    "cat .env.example | head",
    "head -20 backend/.env.example",
    "grep KEY backend/.env.example",
    "rg GROQ backend/.env.example",
    "sed -n 1,5p backend/.env.example",
]


@pytest.mark.parametrize("command", EXAMPLE_COMMANDS)
def test_example_file_stays_readable(command: str) -> None:
    assert _bash(command) == "allow", f"{command!r} must stay readable"


def test_read_tool_can_open_the_example() -> None:
    assert _read("backend/.env.example") == "allow"


def test_example_file_exists_to_read() -> None:
    assert (REPO_ROOT / "backend" / ".env.example").is_file()


@pytest.mark.parametrize("agent", sorted(_shell_capable_agents()))
@pytest.mark.parametrize("command", EXAMPLE_COMMANDS)
def test_every_shell_capable_agent_can_read_the_example(
    agent: str, command: str
) -> None:
    assert _agent_bash_action(agent, command) == "allow", (
        f"agent {agent!r} can no longer run {command!r}"
    )


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
    "agent", sorted(_shell_capable_agents())
)
@pytest.mark.parametrize("command", NOT_DENIED_COMMANDS)
def test_ordinary_workflow_is_not_denied_for_any_agent(
    agent: str, command: str
) -> None:
    assert _agent_bash_action(agent, command) != "deny", (
        f"agent {agent!r} cannot run {command!r}, which the dev loop needs"
    )


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


def test_no_duplicate_pattern_keys_in_any_agent() -> None:
    """Same hazard, one level down — where #262 actually lived."""
    for agent, rules in _agents().items():
        if not isinstance(rules, dict):
            continue
        seen: list[str] = []
        duplicated = {p for p in rules if p in seen or seen.append(p)}  # type: ignore[func-returns-value]
        assert not duplicated, f"agent {agent}: duplicate patterns {sorted(duplicated)}"


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


def test_agent_bash_blocks_do_not_mention_the_catch_all_after_the_guard() -> None:
    """Guard the exact #262 shape: a second catch-all would re-shadow the guard.

    A catch-all re-added after the env denies (an easy, innocent-looking edit —
    "let this agent run everything") silently outranks them again.
    """
    for agent in sorted(_shell_capable_agents()):
        rules = _agent_bash(agent)
        assert list(rules).count("*") == 1, (
            f"agent {agent!r} declares the catch-all {list(rules).count('*')} times; "
            "one placed after the guard re-shadows it"
        )
        assert list(rules).index("*") == 0, (
            f"agent {agent!r} has its catch-all at {list(rules).index('*')}, not first"
        )
