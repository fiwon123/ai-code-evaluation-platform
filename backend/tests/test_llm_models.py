import pytest
from httpx import AsyncClient

from app.services.llm_models import (
    MODELS_BY_PROVIDER,
    PROVIDER_DEFAULTS,
    all_models,
    is_known_model,
    model_belongs_to_provider,
    model_default,
)

MODELS_URL = "/api/models"


class TestCatalogInvariants:
    def test_catalog_has_at_least_twenty_models(self):
        assert len(all_models()) >= 20

    def test_model_ids_are_unique(self):
        ids = [model.id for model in all_models()]
        assert len(ids) == len(set(ids))

    def test_every_provider_has_a_default_in_its_own_catalog(self):
        assert set(PROVIDER_DEFAULTS) == set(MODELS_BY_PROVIDER)
        for provider, default in PROVIDER_DEFAULTS.items():
            assert model_belongs_to_provider(default, provider), (
                f"default '{default}' missing from {provider} catalog"
            )

    def test_every_catalog_entry_ships_label_and_description(self):
        for model in all_models():
            assert model.label, f"{model.id} missing label"
            assert model.description, f"{model.id} missing description"

    def test_models_are_grouped_under_their_provider(self):
        for provider, models in MODELS_BY_PROVIDER.items():
            assert models, f"provider '{provider}' has an empty catalog"
            for model in models:
                assert model.provider == provider


class TestCatalogHelpers:
    def test_is_known_model(self):
        assert is_known_model("gpt-4o-mini")
        assert not is_known_model("definitely-not-a-model")

    def test_model_belongs_to_provider(self):
        assert model_belongs_to_provider("gpt-4o-mini", "openai")
        assert not model_belongs_to_provider("gpt-4o-mini", "gemini")

    def test_model_default(self):
        assert model_default("openai") == "gpt-4o-mini"
        assert model_default("nope") is None


@pytest.mark.asyncio
async def test_list_models_returns_catalog_with_default_flags(client: AsyncClient) -> None:
    response = await client.get(MODELS_URL)
    assert response.status_code == 200

    models = response.json()
    assert isinstance(models, list)
    assert len(models) >= 20

    # Flat list mirrors the catalog and flags each provider's default.
    by_id = {model["id"]: model for model in models}
    assert by_id["gpt-4o-mini"]["provider"] == "openai"
    assert by_id["gpt-4o-mini"]["is_default"] is True
    assert by_id["gpt-4o"]["is_default"] is False
    assert by_id["mock-coder"]["provider"] == "demo"
    assert by_id["mock-coder"]["is_default"] is True

    # Every model carries the display fields.
    for model in models:
        assert model["label"]
        assert model["description"]
