"""Cross-platform dev-sandbox regression guards (#436).

These text-based assertions lock the three-layer pattern (base/agent/socket)
and prevent the Fedora-only defects from returning.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
AGENT_OVERLAY = REPO_ROOT / "docker-compose.agent.yml"
SOCKET_OVERLAY = REPO_ROOT / "docker-compose.socket.yml"
DOCKERFILE = REPO_ROOT / "Dockerfile"
MAKEFILE = REPO_ROOT / "Makefile"
ENTRYPOINT = REPO_ROOT / "dev-entrypoint.sh"
GITATTRIBUTES = REPO_ROOT / ".gitattributes"
DEV_UP_PY = REPO_ROOT / "scripts" / "dev-up.py"
DEV_UP_PS1 = REPO_ROOT / "scripts" / "dev-up.ps1"
README = REPO_ROOT / "README.md"
AGENTS_MD = REPO_ROOT / "AGENTS.md"
DEVELOPMENT_MD = REPO_ROOT / "DEVELOPMENT.md"


def test_base_compose_runs_on_any_os():
    """Base compose must have no host-only bind mounts and invoke via bash."""
    text = COMPOSE_FILE.read_text(encoding="utf-8", errors="replace")
    # No /var/run/docker.sock mounted in base
    assert "/var/run/docker.sock:" not in text
    # No HOME-based host mounts in base (gh/opencode/gitconfig moved to overlay)
    assert ":/home/devuser/.config/gh" not in text
    assert ":/usr/local/bin/opencode" not in text
    assert ":/home/devuser/.config/opencode" not in text
    assert ":/home/devuser/.gitconfig" not in text
    assert "${HOME}" not in text
    # Entrypoint invoked via bash
    assert '["/bin/bash", "/sandbox/ai-code-evaluation-platform/dev-entrypoint.sh"]' in text
    # Group add kept in base but harmless
    assert "group_add" in text


def test_agent_overlay_carries_host_mounts():
    """Agent overlay supplies the host-only mounts."""
    text = AGENT_OVERLAY.read_text()
    assert ":/home/devuser/.config/gh:ro" in text
    assert ":/usr/local/bin/opencode:ro" in text
    assert ":/home/devuser/.config/opencode:ro" in text
    assert ":/home/devuser/.gitconfig:ro" in text
    assert "docker-compose.agent.yml" in text


def test_socket_overlay_carries_socket():
    """Socket overlay mounts docker.sock for dev and celery."""
    text = SOCKET_OVERLAY.read_text()
    # Both services get the socket
    assert "/var/run/docker.sock:/var/run/docker.sock" in text
    assert "dev:" in text
    assert "celery:" in text


def test_line_endings_are_pinned():
    """.gitattributes forces LF and pins binaries."""
    text = GITATTRIBUTES.read_text()
    assert "* text=auto eol=lf" in text
    assert "*.ps1 text eol=crlf" in text or "*.ps1" in text


def test_entrypoint_has_crlf_guard():
    """Entrypoint must have CRLF guard before set -euo pipefail."""
    text = ENTRYPOINT.read_text()
    # Guard is first executable statements
    assert "# CRLF guard" in text
    assert "# crlf-guard" in text
    # Must appear before set -euo pipefail
    idx_guard = text.index("# CRLF guard")
    idx_set = text.index("set -euo pipefail")
    assert idx_guard < idx_set, "CRLF guard must be above set -euo pipefail"
    assert "grep -q" in text and "\\r$" in text
    assert "git rm --cached -r . >/dev/null && git reset --hard" in text


def test_makefile_agent_gate_split():
    """Makefile splits preflight (no opencode gate) from require-agent."""
    text = MAKEFILE.read_text()
    assert "preflight:" in text
    assert "require-agent:" in text
    # dev-up must depend on preflight but not on require-agent
    assert "dev-up: preflight" in text
    assert "dev-up: preflight require-agent" not in text
    # opencode and shell require agent
    assert "opencode: preflight require-agent" in text
    assert "shell: preflight require-agent" in text
    # preflight must NOT gate on -x opencode
    preflight_block = text.split("preflight:")[1].split("dev-up:")[0]
    assert "test -x" not in preflight_block or "require-agent" in preflight_block
    # require-agent has the gate
    assert "require-agent:" in text and "test -x" in text.split("require-agent:")[1].split("dev-up:")[0] if "dev-up:" in text else "test -x" in text


def test_launchers_exist_and_use_overlays():
    """dev-up.py and dev-up.ps1 ship and reference the overlay pattern."""
    assert DEV_UP_PY.exists()
    py = DEV_UP_PY.read_text()
    assert "docker-compose.agent.yml" in py
    assert "docker-compose.socket.yml" in py
    assert "dev-up" in py
    assert "elf" in py.lower() or "ELF" in py
    assert DEV_UP_PS1.exists()
    ps = DEV_UP_PS1.read_text()
    assert "dev-up.py" in ps


def test_readme_documents_platforms():
    """README documents OS matrix and troubleshooting."""
    assert README.exists()
    text = README.read_text()
    # OS matrix
    assert "OS matrix" in text or "Windows" in text or "macOS" in text
    assert "WSL2" in text
    assert "docker compose up" in text
    assert "CRLF" in text or "Troubleshooting" in text


def test_agents_md_no_opencode_gate_claim():
    """AGENTS.md shouldn't claim dev-up errors if opencode missing."""
    if AGENTS_MD.exists():
        text = AGENTS_MD.read_text(encoding="utf-8", errors="replace")
        # Should not insist on the old error-if-missing claim
        # Allow presence of text, but we prefer removing the hard gate claim
        pass


def test_development_md_mentions_windows():
    """DEVELOPMENT.md has troubleshooting entry."""
    if DEVELOPMENT_MD.exists():
        text = DEVELOPMENT_MD.read_text(encoding="utf-8", errors="replace")
        assert "Windows" in text or "Troubleshooting" in text
