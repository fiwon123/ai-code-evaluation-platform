from fastapi import APIRouter

from app.schemas.models import LLMModelInfo
from app.services.llm_models import PROVIDER_DEFAULTS, all_models

router = APIRouter()


@router.get("/models", response_model=list[LLMModelInfo])
async def list_models() -> list[LLMModelInfo]:
    """Return the LLM model catalog.

    Public and static — powers the challenge page's model selector without
    requiring authentication. The catalog is defined in
    ``app/services/llm_models.py``.
    """
    return [
        LLMModelInfo(
            id=model.id,
            provider=model.provider,
            label=model.label,
            description=model.description,
            is_default=PROVIDER_DEFAULTS.get(model.provider) == model.id,
        )
        for model in all_models()
    ]
