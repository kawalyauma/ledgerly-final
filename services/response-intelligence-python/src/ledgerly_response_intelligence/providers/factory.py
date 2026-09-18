from __future__ import annotations

from ..config import Settings
from .anthropic import AnthropicProvider
from .base import GenerationProvider
from .openai_compatible import OpenAICompatibleProvider


def build_provider(settings: Settings) -> GenerationProvider | None:
    if not settings.provider_enabled:
        return None
    if settings.provider == "anthropic":
        return AnthropicProvider(
            api_key=settings.api_key,
            model=settings.model,
            timeout_seconds=settings.timeout_seconds,
            base_url=settings.base_url,
        )
    if settings.provider == "openai-compatible":
        return OpenAICompatibleProvider(
            base_url=settings.base_url,
            api_key=settings.api_key,
            model=settings.model,
            timeout_seconds=settings.timeout_seconds,
        )
    return None
