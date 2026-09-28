from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = {"env_file": ".env", "extra": "ignore"}

    environment: str = "development"  # development | test | production
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/postgres"
    redis_url: str = "redis://localhost:6379"
    jwt_secret_key: str = "dev-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    cors_origins: list[str] = ["http://localhost:5173"]

    # OAuth2 (GitHub authorization-code flow)
    #: OAuth state nonces are signed with the JWT secret; no extra secret needed.
    github_client_id: str = ""
    github_client_secret: str = ""
    #: Browser redirect destination after the provider authorizes — the
    #: frontend OAuth callback route. Must match the provider app registration.
    oauth_callback_url: str = "http://localhost:5173/auth/callback"
    #: How long an OAuth state nonce stays valid (minutes).
    oauth_state_expire_minutes: int = 10

    # Evaluation pipeline
    llm_provider: str = "demo"  # default provider: demo | openai | anthropic
    evaluation_timeout: int = 30  # seconds for test execution
    evaluation_dir: str = "/tmp/evaluations"
    #: Fallback chain for code generation. When the primary provider raises
    #: (rate limit, quota, network, missing key), one retry is made with
    #: ``llm_fallback_provider``/``llm_fallback_model`` before the run is failed.
    #: Empty provider (the default) disables the fallback, so behaviour is
    #: unchanged unless an operator opts in. The intended pairing is a
    #: generous cloud provider with a small local model:
    #: ``LLM_FALLBACK_PROVIDER=ollama`` + ``LLM_FALLBACK_MODEL=tinyllama``.
    llm_fallback_provider: str = ""
    llm_fallback_model: str = ""
    #: Dial a provider's IPv6 address when its name resolves to both families,
    #: falling back to the host's own resolution if IPv6 cannot connect. Off by
    #: default: it changes which egress IP the provider sees, which is a
    #: deployment's decision. It exists because a host can be blocked on one
    #: family only — measured on the dev host, Groq answers this host's IPv4
    #: with 403 "Access denied. Please check your network settings." and serves
    #: the same request over IPv6, which reads as a bad API key rather than a
    #: network fault. `/etc/gai.conf` is not an option (it does not reorder, and
    #: cannot be tested from inside the container); see
    #: ``app/services/http_transport.py`` for the full account.
    llm_prefer_ipv6: bool = False
    #: Base URL of the Ollama server. The default suits a host-native worker;
    #: a containerized worker must point at the host, e.g.
    #: ``http://host.docker.internal:11434``.
    ollama_base_url: str = "http://localhost:11434"
    #: HTTP timeout for a single Ollama generation, in seconds. Deliberately
    #: far larger than the hosted providers' 60s: a local model runs on this
    #: machine's CPU, so a 1.5B code model emitting a few hundred tokens can take
    #: minutes on a weak host, and a timeout there reads as "Ollama is broken"
    #: rather than "the model is slow". The Docker sandbox caps (CPU/RAM/30s)
    #: apply to *running the tests*, not to generating the code, so a slow model
    #: costs wall-clock rather than correctness. Raise it for larger local
    #: models (a 7B wants far more), lower it to fail fast on a dead server.
    ollama_timeout: int = 300
    #: CPU threads Ollama may use for one local generation, sent as the generate
    #: request's ``num_thread`` option. ``None`` (the default) sends no option at
    #: all, so Ollama keeps its own auto-detected thread count and existing
    #: generation speed is unchanged. Set it to leave cores free on a weak host
    #: (e.g. ``2``) at the cost of proportionally slower generation, which
    #: ``ollama_timeout`` then has to accommodate. Ollama has no
    #: ``OLLAMA_NUM_THREADS`` variable of its own — it is silently ignored — so
    #: this is enforced on our side of the wire and works with any Ollama version.
    ollama_num_threads: int | None = None
    #: Total generate-and-test attempts per submission. Attempt 1 is the
    #: initial generation; a failing attempt is fed back to the provider and
    #: re-tested until the code passes or the budget runs out. ``1`` disables
    #: the repair loop and reproduces the single-attempt behaviour.
    evaluation_max_attempts: int = 3
    #: How much of the raw runner output to include in a repair prompt, in
    #: characters (tail of the log). Bounds prompt growth across attempts.
    repair_log_tail_chars: int = 4000

    # Docker sandbox (isolated code execution)
    docker_enabled: bool = True  # master switch; falls back to subprocess when off/unavailable
    docker_image: str = "eval-sandbox:latest"  # multi-language sandbox image (python/js/ts/java/go)
    docker_memory_limit: str = "128m"  # per-container RAM limit
    docker_cpu_limit: float = 0.5  # per-container CPU limit (fraction of a core)
    docker_timeout: int = 30  # seconds before container execution is killed
    docker_network_disabled: bool = True  # air-gapped sandboxes
    docker_readonly_rootfs: bool = True  # immutable container filesystem
    docker_max_output_bytes: int = 65536  # cap on captured logs per evaluation

    # Curated example challenges (seeded into PostgreSQL on startup)
    seed_examples: bool = True  # set SEED_EXAMPLES=false to disable auto-seeding

    # Rate limiting (fixed-window counter backed by Redis)
    rate_limit_enabled: bool = True
    rate_limit_anonymous_limit: int = 60  # requests per window for anonymous clients
    rate_limit_authenticated_limit: int = 120  # requests per window for logged-in users
    rate_limit_window_seconds: int = 60
    # Comma-separated IPs/CIDRs of proxies in front of the API (nginx, ALB,
    # Cloudflare). When set, the rate limiter trusts X-Forwarded-For from these
    # and picks the first non-proxy IP. Empty in development, where direct
    # connections mean request.client.host is the real client.
    trusted_proxies: str = ""

    @field_validator("database_url")
    @classmethod
    def ensure_psycopg_driver(cls, value: str) -> str:
        """Normalize legacy/bare postgres URLs to use the psycopg (v3) driver."""
        if value.startswith("postgresql+asyncpg://"):
            return value.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @field_validator("jwt_secret_key")
    @classmethod
    def reject_default_secret_in_production(cls, value: str, info: ValidationInfo) -> str:
        """Refuse to boot in production with the well-known dev secret."""
        if (
            info.data.get("environment") == "production"
            and value == "dev-secret-key-change-in-production"
        ):
            raise ValueError("JWT_SECRET_KEY must be changed from the default in production")
        return value


settings = Settings()
