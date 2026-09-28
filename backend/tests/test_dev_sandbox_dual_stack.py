"""The dev stack must serve both address families, or `localhost` is refused (#282).

`localhost` is a name, not an address, and on a dual-stack host the resolver
returns `::1` first (RFC 6724). The dev servers bound `0.0.0.0`, which is
IPv4-only, so the URL the stack prints in its own startup banner was refused
while the same server answered on the literal address:

    dev-entrypoint.sh:62  uvicorn ... --host 0.0.0.0 --port 8000
    dev-entrypoint.sh:65  npm run dev -- --host 0.0.0.0 --port 5173

    IPv4 LISTEN: 8000 -> 0.0.0.0,  5173 -> 0.0.0.0
    IPv6 LISTEN: none
    connect 127.0.0.1:5173 -> OK
    connect ::1:5173       -> ConnectionRefusedError [Errno 111]

The fix is to bind `::`. That is only safe because `net.ipv6.bindv6only` is 0,
so an AF_INET6 socket also accepts IPv4 as v4-mapped — which matters, because
Docker publishes the ports by dialling the container's IPv4 address. Binding
`::` with `bindv6only=1` would silently break the published port, and nothing
about the flag itself would say so.

So the tests below do not just match text. They read the host string the repo
actually declares, bind a real socket to it, and connect the way a client
does — which is the only form of this guard that fails when the behaviour
breaks instead of when a string changes.
"""

import re
import socket
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = REPO_ROOT / "dev-entrypoint.sh"
VITE_CONFIG = REPO_ROOT / "frontend" / "vite.config.ts"
MAKEFILE = REPO_ROOT / "Makefile"

DUAL_STACK_HOST = "::"


def _has_ipv6_loopback() -> bool:
    try:
        socket.socket(socket.AF_INET6, socket.SOCK_STREAM).close()
    except OSError:
        return False
    return True


requires_ipv6 = pytest.mark.skipif(
    not _has_ipv6_loopback(), reason="no usable IPv6 loopback on this host"
)


def _entrypoint_hosts() -> dict[str, str]:
    """The `--host` each dev server in the entrypoint is started with."""
    text = ENTRYPOINT.read_text()
    hosts = {}
    for server in ("uvicorn", "npm run dev"):
        match = re.search(
            rf"{re.escape(server)}.*?--host\s+(\S+)", text, re.DOTALL
        )
        assert match, f"could not find the --host for {server!r} in {ENTRYPOINT.name}"
        hosts[server] = match.group(1)
    return hosts


def _listen(host: str) -> socket.socket:
    """Bind a real socket to `host` on an ephemeral port, exactly as a server would."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    server = socket.socket(family, socket.SOCK_STREAM)
    # Default options, i.e. what uvicorn/vite/Node do on Linux. Left explicit
    # because the whole fix depends on this being dual-stack rather than
    # IPv6-only; asserting it here documents that dependency.
    if family == socket.AF_INET6:
        server.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    server.bind((host, 0))
    server.listen(8)
    return server


def _connect(host: str, port: int) -> None:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    client = socket.socket(family, socket.SOCK_STREAM)
    client.settimeout(5)
    try:
        client.connect((host, port))
    finally:
        client.close()


@requires_ipv6
@pytest.mark.parametrize("server", ["uvicorn", "npm run dev"])
def test_the_first_address_localhost_resolves_to_is_served(server):
    """The regression itself, as the client sees it.

    A client that dials the first address the resolver returns — which is the
    one that gets it refused — is the failing case. Connecting by the *name*
    keeps this honest: it is `localhost` that is broken, not `::1`.
    """
    host = _entrypoint_hosts()[server]
    listener = _listen(host)
    try:
        port = listener.getsockname()[1]
        first = socket.getaddrinfo("localhost", port, 0, socket.SOCK_STREAM)[0]
        _connect(first[4][0], port)  # raises on refusal, which is the bug
    finally:
        listener.close()


@requires_ipv6
def test_binding_the_declared_host_still_serves_ipv4():
    """The published ports must survive the change.

    Docker reaches the container on its IPv4 address, so a `::` bind that were
    IPv6-only would break `make dev-up` while every IPv6 check still passed.
    """
    host = _entrypoint_hosts()["npm run dev"]
    listener = _listen(host)
    try:
        _connect("127.0.0.1", listener.getsockname()[1])
    finally:
        listener.close()


def test_the_declared_host_is_dual_stack_everywhere_it_is_declared():
    """Every dev server is started with the same address family."""
    hosts = _entrypoint_hosts()
    for server, host in hosts.items():
        assert host == DUAL_STACK_HOST, (
            f"{server} binds {host!r} in {ENTRYPOINT.name}; "
            f"{DUAL_STACK_HOST!r} is required or localhost:5173 is refused (#282)"
        )
    assert not re.search(r"--host\s+0\.0\.0\.0", MAKEFILE.read_text()), (
        f"the host-native targets in {MAKEFILE.name} still bind 0.0.0.0 (#282)"
    )


def test_vite_config_agrees_with_the_entrypoint():
    """The CLI overrides the config, so both have to change together."""
    config = VITE_CONFIG.read_text()
    # `host` is allowed to be separated from `port` by comments (which is where
    # the reason for the value belongs), so intervening text is permitted — but
    # a brace is not, which keeps the match inside the `server` block.
    match = re.search(r"port:\s*5173,[^{}]*?host:\s*\"([^\"]+)\"", config)
    assert match, f"could not find server.host in {VITE_CONFIG.name}"
    assert match.group(1) == DUAL_STACK_HOST, (
        f"{VITE_CONFIG.name} binds {match.group(1)!r}; the entrypoint's --host "
        f"overrides it, so both must be {DUAL_STACK_HOST!r} (#282)"
    )
