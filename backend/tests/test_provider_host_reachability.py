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
5. Having an IPv6 *address* and still dialling IPv4, because the image's
   /etc/gai.conf sorts IPv4 ahead of IPv6. Same 403, same false "bad key" read —
   and the one that survives the fix for (4).

Text-based assertions, like the other dev-sandbox infra guards: the contract
spans Makefile -> docker-compose.yml -> Dockerfile, and a YAML parser would test
the syntax rather than the wiring.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
SECRETS_FILE = REPO_ROOT / "k8s" / "base" / "secrets.yaml"
DOCKERFILE = REPO_ROOT / "Dockerfile"
GAI_CONF = REPO_ROOT / "docker" / "gai.conf"
SANDBOX_DOCKERFILE = REPO_ROOT / "backend" / "Dockerfile.sandbox"

#: Services that may call a provider over the network, so each needs the host
#: gateway alias for a host-side Ollama.
PROVIDER_SERVICES = ("dev", "celery")

#: glibc's built-in RFC 3484 precedence for IPv4 destinations (lowest of any
#: default class, and what IPv4 falls back to once our file replaces Debian's).
GLIBC_DEFAULT_V4_PRECEDENCE = 4

#: glibc's built-in precedence for global IPv6. Our file must beat this, or
#: declaring ::/0 would be a no-op.
GLIBC_DEFAULT_V6_PRECEDENCE = 40

#: glibc's built-in precedence for IPv6 loopback. Loopback must stay the highest
#: IPv6 class or a name resolving to ::1 alongside a global address could be
#: reordered behind it.
GLIBC_DEFAULT_V6_LOOPBACK_PRECEDENCE = 50


def _compose_text() -> str:
    return COMPOSE_FILE.read_text()


def _gai_precedence_rules() -> dict[str, int]:
    """Parse the ``precedence <prefix> <value>`` rules out of docker/gai.conf.

    Longest-prefix matching is glibc's job, so this deliberately does not
    reproduce it: it only needs to know which values the file *declares*.
    """
    rules: dict[str, int] = {}
    for line in GAI_CONF.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line.startswith("precedence "):
            continue
        parts = line.split()
        assert len(parts) == 3, f"malformed precedence rule: {line!r}"
        prefix, value = parts[1], parts[2]
        assert re.fullmatch(r"[0-9a-fA-F:]+/[0-9]+", prefix), f"bad prefix: {prefix!r}"
        assert value.isdigit(), f"precedence must be an integer: {value!r}"
        rules[prefix] = int(value)
    return rules


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

    def test_the_network_is_documented_as_needing_the_resolver_half_too(self):
        # Measured on 2026-09-28: this block was verified working (the container
        # gained a ULA address and v6 stopped failing with ENETUNREACH) and the
        # worker *still* got 403, because gai.conf sorted IPv4 first. A comment
        # claiming the network alone fixes it is what sends the next reader
        # looking for a bad key instead of at gai.conf.
        block = _networks_block()
        assert "gai.conf" in block, (
            "the compose comment must record that reachability alone left the "
            "worker on IPv4 — see TestIPv6IsActuallySelected"
        )


class TestIPv6IsActuallySelected:
    """An IPv6 address is worthless if the resolver never picks it (#270).

    ``TestDualStackNetwork`` covers reachability. This covers selection, which is
    the half that failed after the network fix shipped: the container held
    ``fd00:1157::6``, IPv6 connected fine (401 = reached auth), and the worker
    still got 403 because Debian's ``/etc/gai.conf`` ships one active rule,
    ``precedence ::ffff:0:0/96 100``, that sorts IPv4 ahead of IPv6. httpx dials
    the first address getaddrinfo returns, so the usable route went unused.

    Neither half is observable from inside the worker, so both are locked here.
    """

    def test_the_shipped_gai_conf_prefers_ipv6(self):
        rules = _gai_precedence_rules()
        # ::/0 covers every global IPv6 address. It has to outrank IPv4's
        # precedence, or the file expresses no preference and glibc's ordering
        # stands. Compared by value, not by literal string, so the numbers can be
        # retuned without touching this guard.
        ipv6 = rules.get("::/0")
        assert ipv6 is not None, (
            "docker/gai.conf does not declare ::/0, so IPv6 keeps glibc's default "
            f"precedence ({GLIBC_DEFAULT_V6_PRECEDENCE}) and nothing reorders it"
        )
        assert ipv6 > GLIBC_DEFAULT_V4_PRECEDENCE, (
            f"::/0 is {ipv6}, which does not outrank IPv4's precedence "
            f"({GLIBC_DEFAULT_V4_PRECEDENCE}) — IPv4 would still be dialled first "
            "and Groq's edge would still answer 403"
        )

    def test_the_rule_is_not_a_no_op_against_the_default(self):
        # If ::/0 were declared at glibc's own default the file would change
        # nothing, and the "fix" would look applied while behaving as before.
        rules = _gai_precedence_rules()
        assert rules["::/0"] != GLIBC_DEFAULT_V6_PRECEDENCE, (
            f"::/0 is declared at glibc's default ({GLIBC_DEFAULT_V6_PRECEDENCE}), "
            "so the rule has no effect"
        )

    def test_loopback_keeps_its_own_precedence(self):
        # Loopback is declared explicitly rather than left to the ::/0 rule. glibc
        # resolves precedence by LONGEST prefix match, so ::/0 does not capture
        # ::1 — the two values are never compared numerically, which is why 50 here
        # is correct next to 100 for ::/0. Declaring it states the intent and
        # catches a future edit that flattens loopback to the global value.
        rules = _gai_precedence_rules()
        loopback = rules.get("::1/128")
        assert loopback is not None, (
            "docker/gai.conf does not declare ::1/128, so loopback silently falls "
            "back to glibc's built-in precedence"
        )
        assert loopback == GLIBC_DEFAULT_V6_LOOPBACK_PRECEDENCE, (
            f"::1/128 is {loopback}, not glibc's built-in loopback precedence "
            f"({GLIBC_DEFAULT_V6_LOOPBACK_PRECEDENCE}) — loopback would be "
            "reordered relative to a host that resolves ::1 first"
        )

    def test_no_rule_re_raises_the_v4_mapped_prefix(self):
        # `precedence ::ffff:0:0/96 100` is the one active rule Debian ships, and
        # it is what made this container dial IPv4 first. Re-adding it (or any
        # equivalent v4-favouring rule) would silently restore the 403.
        for prefix, value in _gai_precedence_rules().items():
            if prefix == "::ffff:0:0/96":
                assert value < _gai_precedence_rules()["::/0"], (
                    f"::ffff:0:0/96 is {value}, which would again outrank ::/0 and "
                    "put IPv4 back in front"
                )

    def test_the_file_is_installed_over_the_base_images_copy(self):
        # COPY (not a RUN heredoc) so the file stays reviewable in the repo and
        # the Dockerfile cannot drift from it.
        dockerfile = DOCKERFILE.read_text()
        assert "COPY docker/gai.conf /etc/gai.conf" in dockerfile, (
            "docker/gai.conf is not installed at /etc/gai.conf, so the image keeps "
            "Debian's IPv4-first rule"
        )

    def test_the_reason_survives_because_it_is_not_measurable_from_the_worker(self):
        # Same argument as the network block: if this file loses its comments, the
        # next 403 is read as a bad key. The host cannot reproduce the failure —
        # its gai.conf is all comments, so unflagged curl already prefers v6.
        text = GAI_CONF.read_text()
        assert "#270" in text
        assert "403" in text and "401" in text

    def test_the_air_gapped_eval_sandbox_is_left_alone(self):
        # backend/Dockerfile.sandbox runs generated code and has no egress. The
        # precedence file belongs to the dev image only; giving the sandbox
        # outbound IPv6 preference would be a regression in the one place that
        # must stay isolated.
        assert "gai.conf" not in SANDBOX_DOCKERFILE.read_text(), (
            "the evaluation sandbox must not inherit the dev image's gai.conf"
        )


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
