from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RIE_", env_file=".env", extra="ignore")

    host: str = "0.0.0.0"
    port: int = Field(default=8091, ge=1, le=65535)
    log_level: str = "INFO"
    api_token: str = ""

    provider: Literal["none", "openai-compatible", "responses", "anthropic"] = "none"
    model: str = ""
    base_url: str = ""
    api_key: str = ""
    timeout_seconds: float = Field(default=45.0, ge=1.0, le=120.0)
    max_revisions: int = Field(default=2, ge=0, le=5)
    history_size: int = Field(default=20, ge=0, le=200)

    allow_external_tools: bool = False
    allow_web_search: bool = False

    knowledge_enabled: bool = True
    knowledge_retrieval_enabled: bool = True
    knowledge_db_path: str = "data/response-intelligence-knowledge.sqlite3"
    knowledge_retrieval_limit: int = Field(default=6, ge=0, le=30)
    knowledge_include_global: bool = True
    knowledge_max_context_chars: int = Field(default=18000, ge=1000, le=100000)

    learning_enabled: bool = True
    learning_retrieval_enabled: bool = True
    training_db_path: str = "data/response-intelligence-training.sqlite3"
    training_dataset_dir: str = "data/training-datasets"
    training_adapter_dir: str = "data/model-adapters"
    training_privacy_mode: Literal["redacted", "structure-only", "full"] = "redacted"
    training_auto_candidate_quality: float = Field(default=0.88, ge=0, le=1)
    training_retrieval_limit: int = Field(default=4, ge=0, le=12)
    training_min_sft_examples: int = Field(default=25, ge=2, le=100000)
    training_min_preference_examples: int = Field(default=20, ge=2, le=100000)
    training_prefer_active_adapter: bool = False
    local_adapter_device_map: str = "auto"
    local_adapter_temperature: float = Field(default=0.55, ge=0.0, le=2.0)

    @property
    def provider_enabled(self) -> bool:
        if self.provider == "none":
            return False
        if not self.model:
            return False
        if self.provider == "anthropic":
            return bool(self.api_key)
        return bool(self.base_url)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
