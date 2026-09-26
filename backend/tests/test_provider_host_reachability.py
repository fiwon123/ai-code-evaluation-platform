"""Guard the host-reachability wiring for providers (issue #233).

Three separate mistakes all look the same at runtime — the generation leg dies
with a DNS or connection error long before any model is involved:

1. `OllamaProvider` ignoring `OLLAMA_BASE_URL` and using the container's own
   localhost, which is the container, not the host.
2. The compose services that call a local model lacking the
   `host.docker.internal:host-gateway` alias that makes the name resolve at all.
3. `GROQ_API_KEY` never reaching the worker, so a Groq submission fails on
   "API key missing" while the same key works in the dev sandbox.

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
