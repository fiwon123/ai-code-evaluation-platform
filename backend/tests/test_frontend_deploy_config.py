"""Regression guard for the production frontend deployment config (issue #185).

The built SPA is served by nginx and reverse-proxies the API, so two contracts
live in text files that no unit test would otherwise exercise:

1. ``frontend/nginx.conf`` must forward WebSocket upgrades (``/api/ws/...`` is
   proxied by the same ``location /api/`` block) and must emit a
   Content-Security-Policy — the API deliberately omits one
   (``backend/src/app/core/security_headers.py``) because the SPA server knows
   the real asset/API origins.
2. ``frontend/Dockerfile``'s ``VITE_API_URL`` default must stay compatible with
   the URL joining in ``frontend/src/services/apiUrl.ts``. A naive
   ``${base}${path}`` concat silently produced ``/api/api/...`` for the
   path-prefix form, so every request in the built image 404'd.

These assertions are text-based on purpose (same rationale as
``test_dev_sandbox_ownership.py``): they pin a cross-file contract without
running nginx or re-implementing a config parser.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
NGINX_CONF = REPO_ROOT / "frontend" / "nginx.conf"
FRONTEND_DOCKERFILE = REPO_ROOT / "frontend" / "Dockerfile"
API_TS = REPO_ROOT / "frontend" / "src" / "services" / "api.ts"
API_URL_TS = REPO_ROOT / "frontend" / "src" / "services" / "apiUrl.ts"
SOCKET_HOOK = REPO_ROOT / "frontend" / "src" / "hooks" / "useSubmissionSocket.ts"

# Directives the policy must carry. `style-src 'unsafe-inline'` is load-bearing:
# React writes inline style attributes, so dropping it blank-styles the app.
REQUIRED_CSP_DIRECTIVES = (
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    # Same-origin REST + the /api/ws subscription socket.
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
)


def _nginx() -> str:
    return NGINX_CONF.read_text()


def _api_proxy_block() -> str:
    """Return the `location /api/` block from nginx.conf."""
    text = _nginx()
    start = text.index("location /api/")
    end = text.index("}", start)
    return text[start:end]


class TestNginxWebSocketUpgrade:
    def test_upgrade_map_is_declared_outside_the_server_block(self):
        # `map` is only valid in the http context. This file is included from
        # nginx.conf's http block, so it must precede (not sit inside) `server`.
        text = _nginx()
        assert "map $http_upgrade $connection_upgrade" in text, (
            "websocket upgrades need the map that turns $http_upgrade into a "
            "Connection header value"
        )
        assert text.index("map $http_upgrade") < text.index("server {"), (
            "the map directive must be declared at file top level (http context), "
            "above the server block"
        )

    def test_upgrade_map_maps_empty_upgrade_to_close(self):
        text = _nginx()
        block = text[
            text.index("map $http_upgrade $connection_upgrade") : text.index("server {")
        ]
        assert "default upgrade;" in block
        assert re.search(r"''\s+close;", block), (
            "requests without an Upgrade header must be forwarded as a plain "
            "connection, not upgraded"
        )

    def test_api_location_forwards_upgrade_headers(self):
        block = _api_proxy_block()
        assert "proxy_http_version 1.1;" in block, (
            "websocket upgrades require HTTP/1.1 to the upstream"
        )
        assert "proxy_set_header Upgrade $http_upgrade;" in block
        assert "proxy_set_header Connection $connection_upgrade;" in block


class TestNginxContentSecurityPolicy:
    def test_policy_is_emitted(self):
        assert "Content-Security-Policy" in _nginx(), (
            "the API intentionally omits CSP; the SPA server must emit it"
        )

    def test_policy_carries_the_required_directives(self):
        text = _nginx()
        policy = re.search(r'add_header\s+Content-Security-Policy\s+"([^"]+)"', text)
        assert policy is not None, "CSP must be set through an add_header directive"
        for directive in REQUIRED_CSP_DIRECTIVES:
            assert directive in policy.group(1), f"CSP is missing: {directive}"

    def test_policy_is_applied_always(self):
        # `always` keeps the header on error pages served by the SPA fallback.
        assert re.search(
            r'add_header\s+Content-Security-Policy\s+"[^"]+"\s+always;', _nginx()
        )

    def test_policy_is_not_shadowed_by_a_location_level_add_header(self):
        # nginx only inherits add_header from an outer level when the inner
        # level declares none of its own, so a policy placed inside (or after)
        # `location /assets/` — which sets Cache-Control — would never reach the
        # document response.
        text = _nginx()
        csp_index = text.index("Content-Security-Policy")
        assets_index = text.index("location /assets/")
        assert csp_index < assets_index, (
            "declare the CSP at server level, above `location /assets/`, so the "
            "document response inherits it"
        )


class TestFrontendApiUrlContract:
    def test_dockerfile_default_is_the_path_prefix_form(self):
        text = FRONTEND_DOCKERFILE.read_text()
        assert "ARG VITE_API_URL=/api" in text, (
            "the image bakes the same-origin path prefix; the client must handle "
            "that form without duplicating /api (issue #185)"
        )

    def test_dockerfile_documents_the_contract(self):
        text = FRONTEND_DOCKERFILE.read_text()
        assert "VITE_WS_URL" in text, "the socket-base override should be documented"

    def test_requests_go_through_the_prefix_safe_join(self):
        api_text = API_TS.read_text()
        assert "fetch(apiUrl(path)" in api_text, (
            "requests must be built by the prefix-safe helper, not a bare "
            "template concat that yields /api/api/..."
        )
        assert not re.search(r"fetch\(`\$\{API_BASE\}", api_text)

    def test_socket_url_goes_through_the_prefix_safe_join(self):
        hook_text = SOCKET_HOOK.read_text()
        assert "webSocketBase(" in hook_text
        assert "joinApiUrl(" in hook_text, (
            "the socket path must not repeat the /api prefix when the base "
            "already carries it"
        )

    def test_helper_handles_every_base_form(self):
        helper = API_URL_TS.read_text()
        for case in ("ABSOLUTE_BASE_RE", "ORIGIN_RE"):
            assert case in helper, f"{case} handling missing from apiUrl.ts"
        assert "?? " in helper, (
            "an explicitly empty VITE_API_URL means same-origin; `||` would "
            "silently fall back to the dev origin"
        )
