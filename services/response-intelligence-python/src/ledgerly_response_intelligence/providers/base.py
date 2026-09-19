from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field


class ProviderResponse(BaseModel):
    text: str
    provider: str
    model: str
    usage: dict[str, object] = Field(default_factory=dict)
    response_id: str = ""


class GenerationProvider(Protocol):
    name: str
    model: str

    async def generate(self, *, system: str, prompt: str, max_tokens: int = 3000) -> ProviderResponse:
        ...
