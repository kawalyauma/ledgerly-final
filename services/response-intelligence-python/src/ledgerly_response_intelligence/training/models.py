from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from ..models import Purpose, Register


class TrainingExampleCreate(BaseModel):
    organization_id: str = ""
    purpose: Purpose = Purpose.general
    request: str = Field(min_length=1, max_length=20000)
    semantic_payload: dict[str, Any] = Field(default_factory=dict)
    response_text: str = Field(min_length=1, max_length=50000)
    register: Register | None = None
    strategy_id: str = ""
    quality_overall: float = Field(default=1.0, ge=0, le=1)
    source: Literal["manual", "response", "correction", "import"] = "manual"
    status: Literal["candidate", "approved", "rejected"] = "candidate"
    tags: list[str] = Field(default_factory=list)
    entity_label: str = ""
    response_fingerprint: str = ""


class TrainingExample(BaseModel):
    example_id: str
    organization_id: str
    purpose: Purpose
    request: str
    semantic_payload: dict[str, Any]
    response_text: str
    register: Register | None = None
    strategy_id: str = ""
    quality_overall: float = 0
    source: str = ""
    status: str = "candidate"
    tags: list[str] = Field(default_factory=list)
    response_fingerprint: str = ""
    created_at: str
    updated_at: str


class FeedbackCreate(BaseModel):
    organization_id: str = ""
    example_id: str = ""
    response_fingerprint: str
    rating: Literal[-1, 0, 1]
    comment: str = Field(default="", max_length=5000)
    correction_text: str = Field(default="", max_length=50000)
    entity_label: str = ""
    approve_original: bool = False
    trusted_reviewer: bool = False


class FeedbackRecord(BaseModel):
    feedback_id: str
    organization_id: str
    response_fingerprint: str
    rating: int
    comment: str = ""
    correction_text: str = ""
    example_id: str = ""
    trusted_reviewer: bool = False
    created_at: str


class StyleProfile(BaseModel):
    organization_id: str
    approved_examples: int = 0
    preferred_register: str = ""
    preferred_strategy: str = ""
    average_words: float = 0
    average_sentence_words: float = 0
    heading_rate: float = 0
    bullet_rate: float = 0
    concise_rate: float = 0
    rules: list[str] = Field(default_factory=list)


class RetrievalExample(BaseModel):
    example_id: str
    request: str
    response_text: str
    purpose: str
    register: str = ""
    strategy_id: str = ""
    score: float = 0


class DatasetExportRequest(BaseModel):
    organization_id: str = ""
    format: Literal["sft", "dpo"] = "sft"
    min_quality: float = Field(default=0.82, ge=0, le=1)
    include_global: bool = True
    filename: str = ""


class DatasetExportResult(BaseModel):
    format: str
    path: str
    examples: int
    organization_id: str = ""
    privacy_mode: str = "redacted"
    sha256: str = ""


class TrainingStats(BaseModel):
    organization_id: str = ""
    candidates: int = 0
    approved: int = 0
    rejected: int = 0
    feedback_positive: int = 0
    feedback_negative: int = 0
    corrections: int = 0
    training_runs: int = 0
    adapters: int = 0
    readiness: Literal["empty", "collecting", "sft-ready", "preference-ready"] = "empty"


class TrainingRunRecord(BaseModel):
    run_id: str
    organization_id: str = ""
    objective: str
    mode: str
    base_model: str
    dataset_path: str
    output_dir: str
    status: str
    config: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    completed_at: str = ""


class AdapterRecord(BaseModel):
    adapter_id: str
    organization_id: str = ""
    name: str
    base_model: str
    path: str
    active: bool = False
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class AdapterRegister(BaseModel):
    organization_id: str = ""
    name: str
    base_model: str
    path: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    activate: bool = False


class FineTuneConfig(BaseModel):
    organization_id: str = ""
    objective: Literal["sft", "dpo"] = "sft"
    base_model: str
    dataset_path: str
    output_dir: str
    mode: Literal["lora", "qlora"] = "lora"
    epochs: float = Field(default=2.0, gt=0, le=20)
    learning_rate: float = Field(default=1e-4, gt=0, le=1e-2)
    batch_size: int = Field(default=1, ge=1, le=128)
    gradient_accumulation_steps: int = Field(default=8, ge=1, le=1024)
    max_length: int = Field(default=2048, ge=256, le=32768)
    lora_r: int = Field(default=16, ge=1, le=256)
    lora_alpha: int = Field(default=32, ge=1, le=1024)
    lora_dropout: float = Field(default=0.05, ge=0, le=0.5)
    target_modules: list[str] | Literal["all-linear"] = "all-linear"
    dpo_beta: float = Field(default=0.1, gt=0, le=2)
    seed: int = 42
