"""Guard the host-reachability wiring for providers (issue #233, #270).

Four separate mistakes all look the same at runtime — the generation leg dies
with a DNS or connection error long before any model is involved:

1. `OllamaProvider` ignoring `OLLAMA_BASE_URL` and using the container's own
   localhost, which is the container, not the host.
2. The compose services that call a local model lacking the
   `host.docker.internal:host-gateway` alias that makes the name resolve at all.
3. `GROQ_API_KEY` never reaching the worker, so a Groq submission fails on
   "API key missing" while the same key works in the dev sandbox.
4. The compose network being IPv4-only, so the worker cannot use the address
   family its host uses (issue #270: Groq's edge answers 403 over IPv4 and 401
   over IPv6, and a v4-only network pins every container to the rejected one).

Text-based assertions, like the other dev-sandbox infra guards: the contract
spans Makefile -> docker-compose.yml -> Dockerfile, and a YAML parser would test
the syntax rather than the wiring.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
SECRETS_FILE = REPO_ROOT / "k8s" / "base" / "secrets.yaml"

#: Services that may call a provider over the network, so each needs the host
#: gateway alias for a host-side Ollama.
PROVIDER_SERVICES = ("dev", "celery")


def _compose_text() -> str:
    return COMPOSE_FILE.read_text()


def _service_block(service: str) -> str:
    """Return the compose YAML block for `service` (2-space service indent)."""
    lines = _compose_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(f"  {service}:"))
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if re.fullmatch(r"  [A-Za-z0-9_-]+:\s*", lines[i]):
            end = i
            break
    return "\n".join(lines[start:end])


class TestHostGatewayAlias:
    def test_dev_and_celery_can_resolve_the_host_gateway(self):
        for service in PROVIDER_SERVICES:
            block = _service_block(service)
            assert "extra_hosts:" in block, f"{service} has no extra_hosts block"
            assert "host.docker.internal:host-gateway" in block, (
                f"{service} cannot resolve a host-side Ollama"
            )


class TestProviderEnvForwarding:
    def test_worker_receives_the_groq_key(self):
        celery = _service_block("celery")
        assert "GROQ_API_KEY=${GROQ_API_KEY:-}" in celery

    def test_dev_receives_the_groq_key(self):
        dev = _service_block("dev")
        assert "GROQ_API_KEY=${GROQ_API_KEY:-}" in dev

    def test_worker_receives_the_fallback_switches(self):
        celery = _service_block("celery")
        # Empty by default: with no provider set, the retry is skipped entirely.
        assert "LLM_FALLBACK_PROVIDER=${LLM_FALLBACK_PROVIDER:-}" in celery
        assert "LLM_FALLBACK_MODEL=${LLM_FALLBACK_MODEL:-}" in celery

    def test_worker_default_ollama_url_points_at_the_host_not_the_container(self):
        celery = _service_block("celery")
        # A bare "localhost" default here would silently target the container.
        assert "OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}" in celery
        assert "http://localhost:11434" not in celery


def _networks_block() -> str:
    """The compose top-level ``networks:`` block (0-space key, to EOF)."""
    lines = _compose_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("networks:"))
    return "\n".join(lines[start:])


class TestDualStackNetwork:
    """The worker needs the address family the host uses (#270).

    Groq's edge answers ``403`` to the same request over IPv4 and ``401`` over
    IPv6 — the request only *reaches* auth on v6. An IPv4-only bridge network
    therefore looks exactly like a bad API key: a valid key still fails, and
    nothing in the error message points at the network. This locks the
    dual-stack network so that regression is not rediscovered per campaign row.
    """

    def test_the_default_network_is_dual_stack(self):
        block = _networks_block()
        assert "default:" in block, "compose declares no default network to make dual-stack"
        assert "enable_ipv6: true" in block, (
            "the default network is IPv4-only, so containers cannot use IPv6"
        )

    def test_a_ula_subnet_is_pinned(self):
        # Docker cannot derive a prefix for a user-defined network: without an
        # explicit ULA subnet, `enable_ipv6: true` yields a network no container
        # can hold an address on. Asserted by value, not by a literal string, so
        # the prefix can be retuned without touching this guard.
        match = re.search(r"subnet:\s*([0-9a-fA-F:]+/[0-9]+)", _networks_block())
        assert match is not None, "no IPAM subnet configured for the IPv6 network"
        prefix = match.group(1).split(":")[0].lower()
        assert len(prefix) == 4 and prefix.startswith(("fc", "fd")), (
            f"subnet {match.group(1)} is not a ULA (fc00::/7) — containers would "
            "need a globally routable prefix, which Docker will not hand out"
        )

    def test_the_worker_is_not_pinned_to_an_ipv4_only_network(self):
        # A service-level `networks:` key replaces the default, so a future
        # "just put the worker on its own network" edit must not silently
        # reintroduce an IPv4-only path for celery.
        assert "networks:" not in _service_block("celery")
        assert "networks:" not in _service_block("dev")

    def test_the_reason_survives_because_it_is_not_measurable_from_the_worker(self):
        # The 403/401 split is a property of Groq's edge, not of this repo: the
        # comment is the only place that fact is recorded, and losing it is how
        # the next reader concludes the key is wrong and goes hunting for it.
        assert "#270" in _networks_block()
        assert "403" in _networks_block() and "401" in _networks_block()


class TestKubernetesSecrets:
    def test_groq_key_is_declared_alongside_the_other_provider_keys(self):
        secrets = SECRETS_FILE.read_text()
        for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"):
            assert key in secrets, f"{key} missing from k8s secrets"

    def test_no_provider_key_is_baked_with_a_value(self):
        # An empty value keeps the secret inert; a literal one would be a leak.
        for line in SECRETS_FILE.read_text().splitlines():
            if re.search(r"_API_KEY", line):
                assert line.rstrip().endswith('""'), f"possible hard-coded key: {line}"
