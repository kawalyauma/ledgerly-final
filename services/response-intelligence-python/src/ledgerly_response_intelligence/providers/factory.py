from __future__ import annotations

from ..config import Settings
from ..models import GenerationConfig
from .anthropic import AnthropicProvider
from .base import GenerationProvider
from .openai_compatible import OpenAICompatibleProvider
from .responses import ResponsesProvider


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
    if settings.provider == "responses":
        return ResponsesProvider(
            base_url=settings.base_url,
            api_key=settings.api_key,
            model=settings.model,
            timeout_seconds=settings.timeout_seconds,
        )
    if settings.provider == "openai-compatible":
        return OpenAICompatibleProvider(
            base_url=settings.base_url,
            api_key=settings.api_key,
            model=settings.model,
            timeout_seconds=settings.timeout_seconds,
        )
    return None


def build_delegated_provider(config: GenerationConfig | None) -> GenerationProvider | None:
    if config is None or not config.model or not config.base_url:
        return None
    api_key = config.api_key.get_secret_value()
    if config.api_style == "anthropic":
        if not api_key:
            return None
        return AnthropicProvider(
            api_key=api_key,
            model=config.model,
            timeout_seconds=config.timeout_seconds,
            base_url=config.base_url,
        )
    if config.api_style == "responses":
        return ResponsesProvider(
            base_url=config.base_url,
            api_key=api_key,
            model=config.model,
            timeout_seconds=config.timeout_seconds,
        )
    return OpenAICompatibleProvider(
        base_url=config.base_url,
        api_key=api_key,
        model=config.model,
        timeout_seconds=config.timeout_seconds,
    )
