from pathlib import Path

import pytest
from httpx import AsyncClient

from app.services import llm_models
from app.services.llm_models import (
    MODELS_BY_PROVIDER,
    PROVIDER_DEFAULTS,
    all_models,
    is_known_model,
    model_belongs_to_provider,
    model_default,
)

MODELS_URL = "/api/models"


#: Groq model ids this catalog listed that upstream has since retired. They
#: answer 404 "model not found" while still validating here, so nothing local
#: flags them: the failure only appears as a zero score on a campaign row.
#: Re-probe `GET https://api.groq.com/openai/v1/models` before removing any of
#: these — a retired id cannot be distinguished from a typo by reading the list.
#: Verified against the live catalog on 2026-09-28 (issue #270).
RETIRED_GROQ_MODELS = (
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "qwen/qwen3-32b",
)


class TestRetiredModelIds:
    """Ids that were real once and now 404 upstream must not come back.

    The catalog cannot check this itself — it has no network — so the retired
    list is pinned here. A model id is a promise about a third party's catalog,
    and the only way to keep it honest is to re-probe that catalog by hand.
    """

    @pytest.mark.parametrize("model_id", RETIRED_GROQ_MODELS)
    def test_a_retired_groq_model_is_not_offered(self, model_id: str) -> None:
        assert not is_known_model(model_id), (
            f"{model_id} was retired by Groq and answers 404; offering it in the "
            "UI turns every such submission into a silent zero score"
        )

    def test_the_retired_list_covers_every_groq_id_we_ever_shipped(self):
        # If a retired id is dropped from the list above, the test above goes
        # quiet and the regression becomes invisible again — so the list has to
        # account for the ids named in the catalog's own comment.
        comment = Path(llm_models.__file__).read_text()
        for model_id in RETIRED_GROQ_MODELS:
            assert model_id in comment, (
                f"{model_id} is pinned as retired but no longer documented in "
                "llm_models.py — re-probe the live catalog, then update both"
            )


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
