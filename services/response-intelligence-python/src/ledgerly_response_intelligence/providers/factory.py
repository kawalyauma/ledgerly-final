from __future__ import annotations

from ..config import Settings
from ..models import GenerationConfig
from .anthropic import AnthropicProvider
from .base import GenerationProvider
from .local_peft import LocalPeftProvider
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


_LOCAL_ADAPTER_CACHE: dict[tuple[str,str,str,float],LocalPeftProvider]={}


def build_local_adapter_provider(
    *,
    base_model:str,
    adapter_path:str,
    device_map:str="auto",
    temperature:float=0.55,
)->LocalPeftProvider:
    key=(base_model,adapter_path,device_map,temperature)
    provider=_LOCAL_ADAPTER_CACHE.get(key)
    if provider is None:
        provider=LocalPeftProvider(
            base_model=base_model,adapter_path=adapter_path,
            device_map=device_map,temperature=temperature,
        )
        _LOCAL_ADAPTER_CACHE[key]=provider
    return provider
