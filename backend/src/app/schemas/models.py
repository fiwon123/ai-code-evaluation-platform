from pydantic import BaseModel


class LLMModelInfo(BaseModel):
    """A catalog entry for one selectable LLM model."""

    id: str
    provider: str
    label: str
    description: str
    #: True when this model is the provider's default (the one used when no
    #: explicit model is chosen).
    is_default: bool
