from ledgerly_response_intelligence.models import GenerationConfig
from ledgerly_response_intelligence.providers.anthropic import AnthropicProvider
from ledgerly_response_intelligence.providers.factory import build_delegated_provider
from ledgerly_response_intelligence.providers.openai_compatible import OpenAICompatibleProvider
from ledgerly_response_intelligence.providers.responses import ResponsesProvider


def test_delegates_openai_responses_style() -> None:
    provider = build_delegated_provider(
        GenerationConfig(
            provider="openai",
            api_style="responses",
            base_url="https://api.openai.com/v1",
            api_key="secret-key",
            model="gpt-example",
        )
    )
    assert isinstance(provider, ResponsesProvider)


def test_delegates_anthropic_style() -> None:
    provider = build_delegated_provider(
        GenerationConfig(
            provider="anthropic",
            api_style="anthropic",
            base_url="https://api.anthropic.com/v1",
            api_key="secret-key",
            model="claude-example",
        )
    )
    assert isinstance(provider, AnthropicProvider)


def test_delegates_openai_compatible_without_key_for_local_model() -> None:
    provider = build_delegated_provider(
        GenerationConfig(
            provider="ollama",
            api_style="chat-completions",
            base_url="http://127.0.0.1:11434/v1",
            api_key="",
            model="qwen3:14b",
        )
    )
    assert isinstance(provider, OpenAICompatibleProvider)


def test_anthropic_without_key_is_not_accepted() -> None:
    provider = build_delegated_provider(
        GenerationConfig(
            provider="anthropic",
            api_style="anthropic",
            base_url="https://api.anthropic.com/v1",
            api_key="",
            model="claude-example",
        )
    )
    assert provider is None
