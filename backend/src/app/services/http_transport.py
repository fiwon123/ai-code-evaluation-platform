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

#: Ports omitted from the ``Host`` header (RFC 3986 §3.2.2). The rewritten URL
#: carries the port, the header has to agree with what the server expects.
_DEFAULT_PORTS = {"http": 80, "https": 443}


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


def _plan(request: httpx.Request) -> tuple[httpx.Request, str] | None:
    """Build the IPv6-literal request, or None to leave ``request`` alone.

    Returns the rewritten request and the ``Host`` header value it must carry.
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

    headers = httpx.Headers(request.headers)
    headers["Host"] = host if port == _DEFAULT_PORTS[url.scheme] else f"{host}:{port}"
    extensions = dict(request.extensions)
    extensions["sni_hostname"] = host
    literal = request.__class__(
        request.method,
        url.copy_with(host=address),
        headers=headers,
        stream=request.stream,
        extensions=extensions,
    )
    return literal, headers["Host"]


class PreferIPv6Transport(httpx.BaseTransport):
    """Dial a provider's IPv6 address when it has one, else behave normally.

    Wraps another transport (``httpx.HTTPTransport`` by default) so the
    decision is testable without a socket, and so ``close()`` reaches whatever
    is actually holding the connection pool.
    """

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport if transport is not None else httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        plan = _plan(request)
        if plan is None:
            return self._transport.handle_request(request)
        literal, _ = plan
        try:
            response = self._transport.handle_request(literal)
        except httpx.ConnectError, httpx.ConnectTimeout:
            # No usable IPv6 (no route, filtered, address gone). The host's own
            # resolution still has the IPv4 address, so let it try that.
            return self._transport.handle_request(request)
        # The response describes the literal address; the caller only ever
        # knows (and logs) the name it asked for.
        response.request = request
        return response

    def close(self) -> None:
        self._transport.close()
