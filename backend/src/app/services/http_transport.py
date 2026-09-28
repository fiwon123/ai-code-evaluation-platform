"""Address-family selection for provider HTTP calls (issue #270).

Why this exists
---------------
A host can be blocked by a provider on one address family and not the other.
Measured on the dev host against Groq's edge, same request, same key, seconds
apart::

    IPv4 -> 403 {"error":{"message":"Access denied. Please check your network
                     settings."}}          # Groq's own block on this egress IP
    IPv6 -> 200 (live model catalogue)       # reaches auth and serves the API

That reads as a bad API key, because a 403 says nothing about the network — and
the fallback machinery then charges the failure to the wrong provider. The only
lever is *which address we dial*, because the IPv4 connection succeeds: it is
answered with an HTTP error, so no client-side retry or connect fallback can
ever reach the IPv6 address.

Why not fix it in the resolver
------------------------------
`/etc/gai.conf` is the obvious lever and does not work. It is installed in the
dev image, and glibc 2.41's own documented behaviour says it must reorder the
result: RFC 3484's policy table is sorted longest-prefix-first and the *first*
match wins, `::/0 40` outranks `::ffff:0:0/96 10`, and Rule 6 ("prefer higher
precedence") runs after the scope rules that already tie here. Measured in the
rebuilt image with the table installed, `getaddrinfo("api.groq.com", 443)`
still returned `v4 v4 v6 v6` — the un-sorted resolver order — for *every*
dual-stack name tried (groq, google, pypi, npm, openai), while a name from
`/etc/hosts` came back v6-first, which is just the order `nss_files` happens to
query in and proves nothing about sorting. The change could not be diagnosed
further from inside the container: `/etc` is not writable, `unshare` is denied,
no `strace`, and glibc reads the file via an internal libc call that cannot be
redirected. It is therefore untestable here and unproven in anger, so the
resolver is left alone and the choice is made explicitly below, where it *can*
be tested.

How it works
------------
For an http/https request whose host is a DNS name, resolve AAAA and, if there
is one, send the request to that address with:

* the URL host replaced by the IPv6 literal, so the socket dials it directly;
* the ``Host`` header left as the original name, which is what the server routes
  on;
* httpcore's ``sni_hostname`` extension set to the original name, so TLS sends
  the right SNI *and* verifies the certificate against the right name — the
  default SSL context has ``check_hostname`` on, and it checks the same
  ``server_hostname``, so verification stays fully intact.

If the IPv6 attempt cannot connect (no route, filtered, address withdrawn), the
original request is sent as-is, so a host that is IPv4-only, or whose IPv6 is
broken, keeps working. The fallback shares the request body, so the transport
requires a re-readable body — true for every provider here, which POSTs
``json=``.

The attempt is speculative, so it gets a small connect budget of its own
(``DEFAULT_IPV6_CONNECT_TIMEOUT``) while inheriting the caller's read/write
timeout untouched. Without that, a host which publishes an AAAA record but
blackholes the route pays a full provider-length connect timeout on every call,
forever — the transport is stateless and never marks such a host broken (#276).

Usage is opt-in via ``LLM_PREFER_IPV6`` (see ``app.config.llm_prefer_ipv6``):
preferring IPv6 changes which egress IP a provider sees, which is a deployment's
call, not a library's.
"""

from __future__ import annotations

import ipaddress
import socket

import httpx

#: Schemes this transport rewrites. Anything else (unix sockets, proxies) is
#: passed straight through.
_REWRITABLE_SCHEMES = ("http", "https")

#: Ports used to *resolve* a host whose URL carries no explicit port. A URL
#: without a port still needs a numeric one for getaddrinfo, so this is not the
#: same thing as the ``Host`` header -- httpx already tracks an explicit port
#: in ``url.netloc``, which is what the header uses (#277).
_DEFAULT_PORTS = {"http": 80, "https": 443}

#: Connect budget for the speculative IPv6 attempt, in seconds (#276).
#:
#: The hosted providers build their client with ``timeout=60`` and
#: ``OllamaProvider`` with ``settings.ollama_timeout`` (300s). Inheriting that
#: whole budget means a host which *publishes* an AAAA record but blackholes the
#: route -- some VPNs, mobile/CI networks, containers with a non-functional v6
#: route -- waits out a full connect timeout on every single call, and the
#: transport is stateless, so that host is never marked broken and the price is
#: paid forever.
#:
#: Worst case per call, before -> after:
#:
#:   hosted (60s connect):  120s -> 62s
#:   Ollama  (300s connect): 600s -> 302s
#:
#: Long enough that a healthy but slow v6 connect still wins the attempt; short
#: enough that a dead family is cheap to discover. Pass ``None`` to disable.
DEFAULT_IPV6_CONNECT_TIMEOUT = 2.0


def _is_ip_literal(host: str) -> bool:
    """True for an address literal, which needs no resolution and no rewrite."""
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _resolve_ipv6(host: str, port: int) -> str | None:
    """First AAAA address for ``host``, or None if it has none (or no answer).

    Scoped answers (``fe80::1%eth0``) are skipped: they cannot be put in a URL,
    and a provider reachable only by a link-local address is not a case worth
    breaking the normal path for.
    """
    try:
        infos = socket.getaddrinfo(host, port, socket.AF_INET6, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return None
    for info in infos:
        address = info[4][0]
        if "%" not in address:
            return address
    return None


def _sni_hostname(netloc: str) -> str:
    """The host part of a netloc, for SNI and certificate verification.

    Both consumers need the **IDNA-encoded** name: SNI is a DNS name carried in
    the TLS ClientHello, and a certificate carries punycode. httpx's
    ``url.host`` is the *decoded* unicode form, so using it here sends a
    non-ASCII name on the wire and asks the TLS stack to match a certificate
    against a string the certificate does not contain (#277).
    """
    host, sep, port = netloc.rpartition(":")
    if sep and port.isdigit():
        return host
    return netloc


def _plan(
    request: httpx.Request, *, ipv6_connect_timeout: float | None
) -> httpx.Request | None:
    """Build the IPv6-literal request, or None to leave ``request`` alone.

    ``ipv6_connect_timeout`` caps only the connect phase of the attempt; the
    read/write budget is inherited untouched, because a slow *read* is a slow
    server rather than a broken address family.
    """
    url = request.url
    if url.scheme not in _REWRITABLE_SCHEMES:
        return None
    host = url.host
    if not host or _is_ip_literal(host):
        return None

    port = url.port or _DEFAULT_PORTS[url.scheme]
    address = _resolve_ipv6(host, port)
    if address is None:
        return None

    # Already IDNA-encoded and port-aware, and exactly what httpx itself would
    # emit, so an IDN host needs no special case (#277).
    netloc = url.netloc.decode()
    headers = httpx.Headers(request.headers)
    headers["Host"] = netloc
    extensions = dict(request.extensions)
    extensions["sni_hostname"] = _sni_hostname(netloc)
    if ipv6_connect_timeout is not None:
        timeout = dict(extensions.get("timeout") or {})
        if timeout.get("connect", float("inf")) > ipv6_connect_timeout:
            timeout["connect"] = ipv6_connect_timeout
        extensions["timeout"] = timeout
    return request.__class__(
        request.method,
        url.copy_with(host=address),
        headers=headers,
        stream=request.stream,
        extensions=extensions,
    )


class PreferIPv6Transport(httpx.BaseTransport):
    """Dial a provider's IPv6 address when it has one, else behave normally.

    Wraps another transport (``httpx.HTTPTransport`` by default) so the
    decision is testable without a socket, and so ``close()`` reaches whatever
    is actually holding the connection pool.
    """

    def __init__(
        self,
        transport: httpx.BaseTransport | None = None,
        *,
        ipv6_connect_timeout: float | None = DEFAULT_IPV6_CONNECT_TIMEOUT,
    ) -> None:
        self._transport = transport if transport is not None else httpx.HTTPTransport()
        self._ipv6_connect_timeout = ipv6_connect_timeout

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        literal = _plan(request, ipv6_connect_timeout=self._ipv6_connect_timeout)
        if literal is None:
            return self._transport.handle_request(request)
        try:
            response = self._transport.handle_request(literal)
        except httpx.ConnectError, httpx.ConnectTimeout:
            # No usable IPv6 (no route, filtered, address gone). The host's own
            # resolution still has the IPv4 address, so let it try that. This
            # attempt carries the caller's *original* timeout, so bounding the
            # IPv6 attempt above cannot shorten the request that actually
            # matters.
            return self._transport.handle_request(request)
        # The response describes the literal address; the caller only ever
        # knows (and logs) the name it asked for.
        response.request = request
        return response

    def close(self) -> None:
        self._transport.close()
