"""Tests for the IPv6-preferring provider transport (issue #270).

Every case runs against a `httpx.MockTransport`, so the address-family decision
is asserted directly instead of inferred from a live provider. That matters
because the resolver-level alternative (`/etc/gai.conf`) cannot be tested from
inside the dev container at all — see `app/services/http_transport.py`.
"""

import contextlib
import socket

import httpx
import pytest

from app.services.http_transport import (
    DEFAULT_IPV6_CONNECT_TIMEOUT,
    PreferIPv6Transport,
    _resolve_ipv6,
)
from app.services.llm import get_llm_provider

AAAA = "2a06:98c1:3105::6812:26ec"


def _fake_getaddrinfo(answers):
    """A getaddrinfo returning ``answers`` for AF_INET6 and nothing otherwise.

    Mirrors glibc closely enough for the transport's purposes: AF_INET6 yields
    6-tuples, AF_INET the 5-tuples the stdlib uses.
    """

    def resolver(host, port, family=0, type=0, proto=0, flags=0):
        if family != socket.AF_INET6:
            return []
        found = answers.get(host)
        if not found:
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        if family == socket.AF_INET6:
            return [
                (socket.AF_INET6, socket.SOCK_STREAM, 6, "", (addr, port, 0, 0)) for addr in found
            ]
        return []  # pragma: no cover

    return resolver


@pytest.fixture
def no_ipv6(monkeypatch):
    """Default: no AAAA record anywhere, so the request must pass through."""
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo({}))


@pytest.fixture
def with_ipv6(monkeypatch):
    answers = {"api.groq.com": [AAAA], "münchen.example.com": [AAAA]}
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo(answers))


def _client(transport, **kwargs):
    return httpx.Client(transport=transport, **kwargs)


class TestPrefersIPv6:
    def test_dials_the_ipv6_address(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200, json={"ok": True})

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            response = client.get("https://api.groq.com/openai/v1/models")

        assert response.status_code == 200
        assert seen[0].url.host == AAAA

    def test_keeps_host_header_and_sni_as_the_name(self, with_ipv6):
        """The socket dials the literal; the server must still see the name.

        Without both of these the request is either unroutable (URL host only) or
        fails certificate verification, since the default SSL context verifies
        against the same server_hostname it sends as SNI.

        The request is built with a Host header that is deliberately *not* the
        name. httpx derives Host from the URL when a client builds a request, so
        simply inheriting the original headers would satisfy a weaker version of
        this assertion while proving nothing about the rewrite.
        """
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Host": "stale.example"},
            )

        assert seen[0].url.host == AAAA
        assert seen[0].headers["Host"] == "api.groq.com"
        assert seen[0].extensions["sni_hostname"] == "api.groq.com"

    def test_host_header_carries_a_non_default_port(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        transport = PreferIPv6Transport(httpx.MockTransport(handler))
        with _client(transport) as client:
            client.get("http://api.groq.com:11434/v1/models")

        assert seen[0].headers["Host"] == "api.groq.com:11434"
        assert seen[0].url.port == 11434

    def test_response_reports_the_name_that_was_asked_for(self, with_ipv6):
        """Callers log/inspect `response.request.url`; it must not leak the literal."""
        transport = PreferIPv6Transport(httpx.MockTransport(lambda r: httpx.Response(200)))
        with _client(transport) as client:
            response = client.get("https://api.groq.com/openai/v1/models")

        assert response.request.url.host == "api.groq.com"


class TestFallsBackToIPv4:
    def test_connect_error_falls_back_to_the_original_request(self, with_ipv6):
        """A host whose IPv6 is unroutable must still be reached over IPv4.

        The fallback reuses the same body, which is why the transport needs a
        re-readable one — true for every provider here, which POSTs `json=`.
        """
        seen = []

        def handler(request):
            seen.append(request)
            if request.url.host == AAAA:
                raise httpx.ConnectError("no route to host")
            return httpx.Response(200, json={"ok": True})

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            response = client.post("https://api.groq.com/chat/completions", json={"model": "m"})

        assert response.status_code == 200
        assert [r.url.host for r in seen] == [AAAA, "api.groq.com"]
        # The IPv4 attempt must look like an ordinary request: an SNI override
        # left over from the IPv6 attempt would be sent to a different host.
        assert "sni_hostname" not in seen[1].extensions

    def test_connect_timeout_falls_back(self, with_ipv6):
        """A blackholed IPv6 SYN never raises, it times out — that must fall back too."""
        seen = []

        def handler(request):
            seen.append(request)
            if request.url.host == AAAA:
                raise httpx.ConnectTimeout("timed out")
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            response = client.get("https://api.groq.com/openai/v1/models")

        assert response.status_code == 200
        assert len(seen) == 2

    def test_body_survives_the_fallback(self, with_ipv6):
        bodies = []

        def handler(request):
            bodies.append(request.content)
            if request.url.host == AAAA:
                raise httpx.ConnectError("no route to host")
            return httpx.Response(200)

        payload = {"model": "openai/gpt-oss-20b", "messages": [{"role": "user"}]}
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.post("https://api.groq.com/chat/completions", json=payload)

        # The IPv4 attempt must carry the real body, not a drained stream.
        assert bodies[1] == bodies[0]
        assert b"gpt-oss-20b" in bodies[1]


class TestConnectBudget:
    """The speculative IPv6 attempt must not inherit the provider's whole
    timeout (#276). The hosted providers use 60s and Ollama 300s, so an
    unbounded attempt is a doubled worst case on every call, forever."""

    @staticmethod
    def _timeout_ext(**kw):
        base = {"connect": 60.0, "read": 60.0, "write": 60.0, "pool": 60.0}
        base.update(kw)
        return {"timeout": base}

    def test_ipv6_attempt_connect_is_capped(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        req = httpx.Request(
            "POST", "https://api.groq.com/chat/completions", json={"m": 1},
            extensions=self._timeout_ext(),
        )
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.send(req)

        assert seen[0].extensions["timeout"]["connect"] == DEFAULT_IPV6_CONNECT_TIMEOUT
        assert DEFAULT_IPV6_CONNECT_TIMEOUT < 60.0

    def test_only_connect_is_capped(self, with_ipv6):
        """A slow *read* is a slow server, not a broken family."""
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        req = httpx.Request(
            "POST", "https://api.groq.com/chat/completions", json={"m": 1},
            extensions=self._timeout_ext(),
        )
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.send(req)

        assert seen[0].extensions["timeout"] == {
            "connect": DEFAULT_IPV6_CONNECT_TIMEOUT,
            "read": 60.0,
            "write": 60.0,
            "pool": 60.0,
        }

    def test_cap_applies_when_no_timeout_is_configured(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        req = httpx.Request("GET", "https://api.groq.com/openai/v1/models")
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.send(req)

        assert seen[0].extensions["timeout"]["connect"] == DEFAULT_IPV6_CONNECT_TIMEOUT

    def test_a_tighter_connect_timeout_is_not_raised(self, with_ipv6):
        """The cap is a ceiling, not a floor: 0.5s must survive as 0.5s."""
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        req = httpx.Request(
            "GET", "https://api.groq.com/openai/v1/models",
            extensions=self._timeout_ext(connect=0.5),
        )
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.send(req)

        assert seen[0].extensions["timeout"]["connect"] == 0.5

    def test_cap_can_be_disabled(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        transport = PreferIPv6Transport(
            httpx.MockTransport(handler), ipv6_connect_timeout=None
        )
        req = httpx.Request(
            "GET", "https://api.groq.com/openai/v1/models",
            extensions=self._timeout_ext(),
        )
        with _client(transport) as client:
            client.send(req)

        assert seen[0].extensions["timeout"]["connect"] == 60.0

    def test_ipv4_only_request_is_never_capped(self, no_ipv6):
        """With no AAAA there is no attempt to bound, so nothing is rewritten."""
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        req = httpx.Request(
            "GET", "https://api.groq.com/openai/v1/models",
            extensions=self._timeout_ext(),
        )
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.send(req)

        assert seen[0].extensions["timeout"]["connect"] == 60.0

    def test_fallback_still_fires_with_the_cap_applied(self, with_ipv6):
        """The cap must not change *when* the fallback happens, only its cost."""
        seen = []

        def handler(request):
            seen.append(request)
            if request.url.host == AAAA:
                raise httpx.ConnectTimeout("timed out")
            return httpx.Response(200)

        req = httpx.Request(
            "GET", "https://api.groq.com/openai/v1/models",
            extensions=self._timeout_ext(),
        )
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            response = client.send(req)

        assert response.status_code == 200
        assert [r.url.host for r in seen] == [AAAA, "api.groq.com"]
        # The attempt is bounded...
        assert seen[0].extensions["timeout"]["connect"] == DEFAULT_IPV6_CONNECT_TIMEOUT
        # ...but the request that actually matters keeps the caller's budget.
        assert seen[1].extensions["timeout"]["connect"] == 60.0

    def test_fallback_fires_on_connect_error_too(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            if request.url.host == AAAA:
                raise httpx.ConnectError("no route to host")
            return httpx.Response(200)

        req = httpx.Request(
            "GET", "https://api.groq.com/openai/v1/models",
            extensions=self._timeout_ext(),
        )
        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            response = client.send(req)

        assert response.status_code == 200
        assert len(seen) == 2


class TestIDNHosts:
    """An IDN host must go on the wire in its IDNA form (#277). httpx keeps
    ``url.host`` as decoded unicode, which is neither a valid Host header nor a
    name any certificate carries."""

    def test_host_header_and_sni_are_punycode(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://münchen.example.com/v1/models")

        assert seen[0].headers["Host"] == "xn--mnchen-3ya.example.com"
        assert seen[0].extensions["sni_hostname"] == "xn--mnchen-3ya.example.com"

    def test_header_is_ascii_encodable(self, with_ipv6):
        """The regression itself: a non-ASCII header value cannot go on the wire.

        ``httpx.Headers`` encodes eagerly on dict construction but *not* on item
        assignment, so the old code failed here only at send time.
        """
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://münchen.example.com/v1/models")

        # This is what raised before the fix.
        assert httpx.Headers({"Host": seen[0].headers["Host"]})
        seen[0].headers["Host"].encode("ascii")
        seen[0].extensions["sni_hostname"].encode("ascii")

    def test_idn_host_with_a_non_default_port(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://münchen.example.com:8443/v1/models")

        assert seen[0].headers["Host"] == "xn--mnchen-3ya.example.com:8443"

    def test_sni_never_carries_a_port(self, with_ipv6):
        """SNI and certificate matching take a name, not a name:port."""
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://münchen.example.com:8443/v1/models")

        assert seen[0].extensions["sni_hostname"] == "xn--mnchen-3ya.example.com"

    def test_plain_host_is_unaffected(self, with_ipv6):
        """netloc is a no-op for ASCII names, so this cannot be a regression."""
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://api.groq.com:11434/v1/models")

        assert seen[0].headers["Host"] == "api.groq.com:11434"
        assert seen[0].extensions["sni_hostname"] == "api.groq.com"

    def test_plan_returns_a_request_or_none(self, with_ipv6, no_ipv6):
        """`_plan` no longer returns a tuple; the second element was dead."""
        from app.services.http_transport import _plan

        req = httpx.Request("GET", "https://api.groq.com/v1")
        # no_ipv6 is active last, so this one resolves nothing.
        assert _plan(req, ipv6_connect_timeout=None) is None

    def test_plan_returns_a_request_not_a_tuple(self, with_ipv6):
        from app.services.http_transport import _plan

        planned = _plan(
            httpx.Request("GET", "https://api.groq.com/v1"),
            ipv6_connect_timeout=None,
        )
        assert isinstance(planned, httpx.Request)


class TestLeavesRequestsAlone:
    def test_host_without_aaaa_is_untouched(self, no_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://api.groq.com/openai/v1/models")

        assert seen[0].url.host == "api.groq.com"
        assert "sni_hostname" not in seen[0].extensions

    def test_ipv4_literal_host_is_untouched(self, with_ipv6):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://104.18.38.236/openai/v1/models")

        assert seen[0].url.host == "104.18.38.236"

    def test_ipv6_literal_host_is_untouched(self, with_ipv6):
        """An address literal needs no resolution and must not be re-resolved."""
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get(f"https://[{AAAA}]/openai/v1/models")

        assert seen[0].url.host == AAAA

    def test_scoped_aaaa_is_skipped(self, monkeypatch):
        """A link-local answer cannot go in a URL, so it must not be used."""
        monkeypatch.setattr(
            socket,
            "getaddrinfo",
            _fake_getaddrinfo({"router.local": ["fe80::1%eth0"]}),
        )
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with _client(PreferIPv6Transport(httpx.MockTransport(handler))) as client:
            client.get("https://router.local/x")

        assert seen[0].url.host == "router.local"


class TestResolveIPv6:
    def test_returns_none_when_the_name_has_no_aaaa(self, no_ipv6):
        assert _resolve_ipv6("api.groq.com", 443) is None

    def test_returns_none_on_gaierror(self, monkeypatch):
        def boom(*args, **kwargs):
            raise socket.gaierror(socket.EAI_AGAIN, "temporary failure")

        monkeypatch.setattr(socket, "getaddrinfo", boom)
        assert _resolve_ipv6("api.groq.com", 443) is None

    def test_returns_the_first_usable_address(self, with_ipv6):
        assert _resolve_ipv6("api.groq.com", 443) == AAAA


class TestFactoryWiring:
    def test_no_transport_by_default(self):
        # The dev stack exports LLM_PREFER_IPV6=true, so the *resolved* setting
        # is not the default under test here. Pin it off explicitly; the declared
        # library default is asserted separately in
        # test_provider_host_reachability.py::test_the_platform_default_is_off.
        with _prefer_ipv6(False):
            provider = get_llm_provider("groq", api_key="k")
        assert isinstance(provider._client._transport, httpx.HTTPTransport)
        assert not isinstance(provider._client._transport, PreferIPv6Transport)

    def test_transport_injected_when_enabled(self):
        # Rebind the setting the way a worker configured at start-up would.
        with _prefer_ipv6():
            provider = get_llm_provider("groq", api_key="k")
        assert isinstance(provider._client._transport, PreferIPv6Transport)

    def test_every_networked_provider_accepts_it(self):
        """A provider that cannot take the transport would fail at construction."""
        with _prefer_ipv6():
            for name, key in (
                ("openai", "k"),
                ("anthropic", "k"),
                ("gemini", "k"),
                ("groq", "k"),
                ("ollama", None),
            ):
                provider = get_llm_provider(name, api_key=key)
                assert isinstance(provider._client._transport, PreferIPv6Transport), name

    def test_demo_provider_is_unaffected(self):
        with _prefer_ipv6():
            assert get_llm_provider("demo").__class__.__name__ == "MockProvider"


@contextlib.contextmanager
def _prefer_ipv6(value: bool = True):
    """Temporarily set ``llm_prefer_ipv6`` on the shared settings object.

    Both directions are needed. The dev stack exports the variable, so a test
    asserting the *off* behaviour has to pin it off rather than assume it.
    """
    from app.config import settings

    previous = settings.llm_prefer_ipv6
    settings.llm_prefer_ipv6 = value
    try:
        yield
    finally:
        settings.llm_prefer_ipv6 = previous
