"""Provider-registry invariants that span modules.

A provider has to be registered in several places for the product to work, and
every one of them was previously maintained by hand with only a comment asking
for care:

* ``app/services/llm.py`` — the class registry (``_PROVIDERS``) and the
  key → env-var map (``KEYED_PROVIDERS``);
* ``app/schemas/submission.py`` — ``KEY_REQUIRED_PROVIDERS``, which rejects a
  keyless submission for a keyed provider;
* ``frontend/src/pages/ChallengeDetail.tsx`` — the ``PROVIDERS`` array whose
  ``requiresKey`` flag drives the API-key field;
* ``app/services/llm_models.py`` — the model catalog a submission's model id is
  validated against.

Adding a provider to one list and forgetting another fails in ways that are only
visible at runtime: an unknown-provider ``ValueError`` from the worker, a 422
for a model that the UI happily offered, or a keyed provider whose UI never asks
for a key (so the run dies on a missing key instead). These tests read the
shipped files and compare them, so a forgotten edit fails CI instead.

The frontend array is parsed from source rather than imported: it is a literal
in a `.tsx` file that imports CSS modules and the API client, neither of which
belongs in a backend test.
"""

import json
import re
from pathlib import Path

import pytest

from app.schemas.submission import KEY_REQUIRED_PROVIDERS
from app.services.llm import _PROVIDERS, KEYED_PROVIDERS
from app.services.llm_models import MODELS_BY_PROVIDER, PROVIDER_DEFAULTS

FRONTEND_PROVIDERS = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "ChallengeDetail.tsx"
)

#: Providers that must never ask for a key: the demo provider is in-process and
#: Ollama is a local service. A regression here would put a pointless required
#: field in front of every local-model user.
KEYLESS_PROVIDERS = {"demo", "ollama"}

#: Fields every PROVIDERS entry must declare. Missing one fails the parse rather
#: than yielding an entry with a silent `None`, which would compare as a
#: mismatch against the backend instead of as a broken file.
FRONTEND_FIELDS = ("value", "name", "description", "requiresKey")


def _bracket_span(source: str, opener: str) -> str:
    """The balanced ``[...]``/``{...}`` block starting at the first ``opener``."""
    start = source.index(opener)
    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    pytest.fail(f"unbalanced {opener!r} literal")  # pragma: no cover


def _frontend_provider_entries() -> dict[str, dict[str, object]]:
    """Parse the ``PROVIDERS`` literal out of ChallengeDetail.tsx.

    The array is a JavaScript object literal (unquoted keys, ``true``), so
    Python's ``ast``/``json`` cannot read it. Each entry is therefore matched
    field by field, and every field in :data:`FRONTEND_FIELDS` must be present.
    """
    source = FRONTEND_PROVIDERS.read_text()
    match = re.search(r"const PROVIDERS = \[", source)
    assert match, "PROVIDERS array not found in ChallengeDetail.tsx"

    entries: dict[str, dict[str, object]] = {}
    for block in re.findall(r"\{[^{}]*\}", _bracket_span(source[match.start() :], "[")):
        entry: dict[str, object] = {}
        for field in FRONTEND_FIELDS:
            found = re.search(rf"\b{field}:\s*(\"[^\"]*\"|true|false)", block)
            assert found, f"provider entry is missing a '{field}': {block.strip()}"
            raw = found.group(1)
            entry[field] = raw[1:-1] if raw.startswith('"') else raw == "true"
        entries[str(entry["value"])] = entry
    assert entries, "no providers parsed from ChallengeDetail.tsx"
    return entries


class TestRegistryCoverage:
    def test_every_registered_class_is_in_the_catalog(self):
        # A provider with no catalog has no default and rejects every model id
        # a submission could carry.
        assert set(_PROVIDERS) == set(MODELS_BY_PROVIDER)

    def test_every_catalog_provider_can_be_constructed(self):
        assert set(MODELS_BY_PROVIDER) <= set(_PROVIDERS)

    def test_defaults_cover_every_provider(self):
        assert set(PROVIDER_DEFAULTS) == set(_PROVIDERS)


class TestKeyedProviderSync:
    def test_keyed_maps_match_validation_set(self):
        assert set(KEYED_PROVIDERS) == set(KEY_REQUIRED_PROVIDERS)

    def test_env_vars_are_namespaced_and_upper_snake(self):
        for provider, env_var in KEYED_PROVIDERS.items():
            assert env_var == env_var.upper(), f"{provider}: {env_var} is not upper case"
            assert re.fullmatch(r"[A-Z][A-Z0-9_]*", env_var), f"{provider}: {env_var}"
            assert "_API_KEY" in env_var, f"{provider}: {env_var} should name an API key"

    def test_keyless_providers_stay_keyless(self):
        assert set(_PROVIDERS) - set(KEYED_PROVIDERS) == KEYLESS_PROVIDERS


class TestFrontendProviderSync:
    def test_frontend_list_matches_the_backend_registry(self):
        assert set(_frontend_provider_entries()) == set(_PROVIDERS)

    def test_requires_key_flags_match_keyed_providers(self):
        entries = _frontend_provider_entries()
        for provider, entry in entries.items():
            assert bool(entry["requiresKey"]) is (provider in KEYED_PROVIDERS), (
                f"{provider}: the UI asks for a key: {entry['requiresKey']}, but the "
                f"backend treats it as keyed: {provider in KEYED_PROVIDERS}"
            )

    def test_every_frontend_entry_has_a_label_and_description(self):
        for provider, entry in _frontend_provider_entries().items():
            assert entry["name"], f"{provider} has no display name"
            assert entry["description"], f"{provider} has no description"

    def test_parsed_entries_match_the_source_shape(self):
        # Guards the hand-rolled parser above: the entries it returns must be
        # plain JSON-serializable data with exactly the declared fields, so a
        # change in how the file is written shows up here and not as a
        # confusing comparison failure further down.
        entries = _frontend_provider_entries()
        assert json.loads(json.dumps(entries)) == entries
        for provider, entry in entries.items():
            assert set(entry) == set(FRONTEND_FIELDS), provider
            assert isinstance(provider, str) and provider


class TestCatalogAcceptsItsOwnProviders:
    @pytest.mark.parametrize("provider", sorted(_PROVIDERS))
    def test_default_model_validates_against_its_provider(self, provider: str) -> None:
        from app.services.llm_models import model_belongs_to_provider

        assert model_belongs_to_provider(PROVIDER_DEFAULTS[provider], provider)

    def test_a_model_cannot_be_offered_under_the_wrong_provider(self):
        from app.services.llm_models import model_belongs_to_provider

        assert not model_belongs_to_provider("llama-3.1-8b-instant", "openai")
