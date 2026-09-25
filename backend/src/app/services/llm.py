import os

from app.config import settings
from app.services.llm_providers import LLMProvider, MockProvider
from app.services.llm_providers.anthropic_provider import AnthropicProvider
from app.services.llm_providers.openai_provider import OpenAIProvider

_PROVIDERS = {"demo": MockProvider, "openai": OpenAIProvider, "anthropic": AnthropicProvider}

#: Providers that need an API key to generate code, mapped to the environment
#: variable the worker falls back to when no per-run key is supplied. Mirrors
#: ``KEY_REQUIRED_PROVIDERS`` in app/schemas/submission.py (validation) and the
#: requiresKey list in frontend/src/pages/ChallengeDetail.tsx — keep in sync.
KEYED_PROVIDERS = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


def get_llm_provider(name: str | None = None, api_key: str | None = None) -> LLMProvider:
    """Return an LLM provider by name (falling back to configured default).

    ``demo`` is the free, network-independent provider. ``openai`` and
    ``anthropic`` require an API key — provided per-call via ``api_key`` or
    via the OPENAI_API_KEY / ANTHROPIC_API_KEY environment variables — and
    raise ``ValueError`` when the key is missing so callers can surface a
    clear failure.
    """
    provider_name = (name or settings.llm_provider or "demo").lower()
    if provider_name not in _PROVIDERS:
        raise ValueError(
            f"Unknown LLM provider '{provider_name}' — available: {sorted(_PROVIDERS)}"
        )

    if provider_name == "openai":
        key = api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise ValueError("OpenAI API key missing — provide an api_key or set OPENAI_API_KEY")
        return OpenAIProvider(api_key=key)

    if provider_name == "anthropic":
        key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ValueError(
                "Anthropic API key missing — provide an api_key or set ANTHROPIC_API_KEY"
            )
        return AnthropicProvider(api_key=key)

    return MockProvider()
