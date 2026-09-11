import os

from app.config import settings
from app.services.llm_providers import LLMProvider, MockProvider
from app.services.llm_providers.anthropic_provider import AnthropicProvider
from app.services.llm_providers.openai_provider import OpenAIProvider

_PROVIDERS = {"demo": MockProvider, "openai": OpenAIProvider, "anthropic": AnthropicProvider}


def get_llm_provider(name: str | None = None) -> LLMProvider:
    """Return an LLM provider by name (falling back to configured default).

    ``demo`` is the free, network-independent provider. ``openai`` and
    ``anthropic`` require their respective API keys via environment
    variables and raise ``ValueError`` when the key is missing so callers
    can surface a clear failure.
    """
    provider_name = (name or settings.llm_provider or "demo").lower()
    if provider_name not in _PROVIDERS:
        raise ValueError(
            f"Unknown LLM provider '{provider_name}' — "
            f"available: {sorted(_PROVIDERS)}"
        )

    if provider_name == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not set")
        return OpenAIProvider(api_key=api_key)

    if provider_name == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set")
        return AnthropicProvider(api_key=api_key)

    return MockProvider()
