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

#: glibc's built-in RFC 3484 precedence for IPv4 destinations. RFC 3484 §2.1
#: says an IPv4 address is looked up as its IPv4-mapped form, so this is the
#: value that must lose to ::/0. NB 4 is the *label* for ::ffff:0:0/96 in the
#: manual's example, not a precedence — the precedence default is 10, which is
#: what a wrong constant here silently compared against.
GLIBC_DEFAULT_V4_PRECEDENCE = 10

#: glibc's built-in precedence for global IPv6 (RFC 3484 default: 40).
GLIBC_DEFAULT_V6_PRECEDENCE = 40

#: glibc's built-in precedence for IPv6 loopback (RFC 3484 default: 50). Loopback
#: must stay above global IPv6 or a name resolving to ::1 alongside a global
#: address could be reordered behind it.
GLIBC_DEFAULT_V6_LOOPBACK_PRECEDENCE = 50

#: The prefix IPv4 destinations are classified under. Its ABSENCE is the bug
#: this whole class exists to catch — see TestIPv4IsNotSilentlyTiedWithIPv6.
GLIBC_V4_MAPPED_PREFIX = "::ffff:0:0/96"


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


def _gai_label_rules() -> dict[str, int]:
    """Parse the ``label <prefix> <value>`` rules out of docker/gai.conf.

    Present because `label` and `precedence` share the same
    replaces-the-default-table behaviour, so a file that declares only labels
    would drop every precedence rule just as silently.
    """
    rules: dict[str, int] = {}
    for line in GAI_CONF.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line.startswith("label "):
            continue
        parts = line.split()
        assert len(parts) == 3, f"malformed label rule: {line!r}"
        rules[parts[1]] = int(parts[2])
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
    still got 403 because the resolver's order put IPv4 first. httpx dials the
    first address getaddrinfo returns — httpcore 1.0.9 has no Happy Eyeballs, so
    unlike curl it cannot paper over a bad order.

    Neither half is observable from inside the worker, so both are locked here.
    """

    def test_global_ipv6_outranks_ipv4(self):
        # RFC 3484 Rule 6: prefer the HIGHER precedence value, and §2.1: an IPv4
        # destination is looked up as its v4-mapped address. Compared by value
        # rather than by literal string, so the numbers can be retuned without
        # touching this guard.
        rules = _gai_precedence_rules()
        ipv6 = rules.get("::/0")
        ipv4 = rules.get(GLIBC_V4_MAPPED_PREFIX)
        assert ipv6 is not None, "docker/gai.conf does not declare ::/0"
        assert ipv4 is not None, (
            f"docker/gai.conf does not declare {GLIBC_V4_MAPPED_PREFIX}, so IPv4 "
            "matches the ::/0 catch-all and ties with IPv6"
        )
        assert ipv6 > ipv4, (
            f"::/0 is {ipv6} and {GLIBC_V4_MAPPED_PREFIX} is {ipv4}: RFC 3484 Rule 6 "
            "prefers the higher value, so IPv4 would be dialled first and Groq's "
            "edge would answer 403 again"
        )

    def test_loopback_keeps_its_own_precedence(self):
        # Loopback is declared explicitly rather than left to the ::/0 rule. glibc
        # resolves precedence by LONGEST prefix match, so ::/0 does not capture
        # ::1 — the two values are never compared numerically, which is why the
        # default 50 is correct next to 40 for ::/0. Declaring it states the
        # intent and catches a future edit that flattens loopback to the global
        # value.
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
            if prefix == GLIBC_V4_MAPPED_PREFIX:
                assert value < _gai_precedence_rules()["::/0"], (
                    f"{prefix} is {value}, which would again outrank ::/0 and put "
                    "IPv4 back in front"
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
        # its gai.conf is all comments, so glibc's own default already prefers
        # IPv6 and unflagged curl there reaches 401.
        text = GAI_CONF.read_text()
        assert "#270" in text
        assert "403" in text and "401" in text


class TestIPv4IsNotSilentlyTiedWithIPv6:
    """The override that looks applied and changes nothing (#270).

    This is the failure a campaign row caught and a text guard could not: the
    file was installed in the image, every assertion about it passed, and
    getaddrinfo still returned `v4 v4 v6 v6` with the worker on 403.

    gai.conf(5): "the presence of a single precedence line in the configuration
    file causes the default table to not be used." So the file does not *adjust*
    glibc's table, it *replaces* it — and a rule set that forgets a class leaves
    that class to be matched by whatever catch-all remains. Since ::/0 is the
    catch-all, omitting ::ffff:0:0/96 gave IPv4 the same value as IPv6. A tie is
    not a mild outcome: RFC 3484 Rule 10 resolves it by leaving the order
    unchanged, which is how a file written to prefer IPv6 ended up preferring
    whatever DNS returned first.
    """

    #: Every prefix in the RFC 3484 default table printed in `man gai.conf`. The
    #: file replaces the table wholesale, so a rule set is only meaningful if it
    #: restates the classes it relies on.
    RFC3484_DEFAULT_CLASSES = (
        "::1/128",
        "::/0",
        "2002::/16",
        "::/96",
        GLIBC_V4_MAPPED_PREFIX,
    )

    def test_the_table_is_not_a_partial_override(self):
        # Asserted as a set so the guard names what is missing instead of merely
        # counting rules — the count alone would pass for a file that declared
        # ::/0 five times over.
        declared = set(_gai_precedence_rules())
        missing = set(self.RFC3484_DEFAULT_CLASSES) - declared
        assert not missing, (
            "docker/gai.conf replaces glibc's whole default table (any single "
            f"precedence line disables it) but omits {sorted(missing)}; the "
            "remaining catch-all then decides those classes, silently"
        )

    def test_every_class_is_ordered_and_the_v4_class_loses(self):
        # Belt and braces for the same trap, expressed as the property that
        # actually matters: a strict, total order over the classes we care
        # about, with IPv4-mapped strictly below global IPv6.
        rules = _gai_precedence_rules()
        values = [rules[c] for c in ("::/0", GLIBC_V4_MAPPED_PREFIX)]
        assert values[0] != values[1], (
            f"::/0 and {GLIBC_V4_MAPPED_PREFIX} are both {values[0]}: a tie falls "
            "through to RFC 3484 Rule 10 and preserves the resolver's order, which "
            "is how IPv4 stayed first"
        )

    def test_no_label_rules_accidentally_drop_the_precedence_table(self):
        # `label` shares the replaces-the-default-table behaviour with
        # `precedence`. A label line added for readability would therefore
        # discard the precedence table just as effectively as deleting it.
        assert not _gai_label_rules(), (
            "docker/gai.conf declares label rules; any label line disables glibc's "
            "default label table and needs the full set restated alongside the "
            "precedence rules"
        )

    def test_the_no_op_failure_is_recorded_where_the_file_is_read(self):
        # A future edit that drops ::ffff:0:0/96 again would satisfy every value
        # assertion above while restoring the 403, so the reason has to be
        # legible in the file itself, not only in the commit history.
        text = GAI_CONF.read_text()
        assert GLIBC_V4_MAPPED_PREFIX in text
        assert "Rule 10" in text or "rule 10" in text, (
            "the file must record why a tie is not a mild outcome"
        )

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
