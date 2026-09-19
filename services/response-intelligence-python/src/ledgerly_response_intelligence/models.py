from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, SecretStr, model_validator


class Purpose(str, Enum):
    analysis = "analysis"
    account_for = "account-for"
    report = "report"
    comparison = "comparison"
    summary = "summary"
    recommendation = "recommendation"
    action_preview = "action-preview"
    warning = "warning"
    general = "general"


class Register(str, Enum):
    executive = "executive"
    school_professional = "school-professional"
    finance = "finance"
    teacher = "teacher"
    plain = "plain"
    technical = "technical"


class Confidence(str, Enum):
    direct = "direct"
    strong = "strong"
    moderate = "moderate"
    limited = "limited"
    conflicting = "conflicting"
    unknown = "unknown"


class EvidenceSource(BaseModel):
    source_id: str = ""
    source_type: str = "ledgerly"
    module: str = ""
    record_type: str = ""
    record_id: str = ""
    label: str = ""
    as_of: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Fact(BaseModel):
    fact_id: str = ""
    subject: str = ""
    predicate: str = ""
    value: Any = None
    unit: str | None = None
    period: str | None = None
    confidence: Confidence = Confidence.direct
    sources: list[EvidenceSource] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class Relationship(BaseModel):
    left_fact_id: str = ""
    relation: str
    right_fact_id: str = ""
    description: str = ""
    confidence: Confidence = Confidence.moderate
    causal: bool = False


class Limitation(BaseModel):
    code: str = "missing-evidence"
    description: str
    material: bool = True


class InsightKind(str, Enum):
    change = "change"
    comparison = "comparison"
    outlier = "outlier"
    concentration = "concentration"
    relationship = "relationship"
    evidence_gap = "evidence-gap"
    observation = "observation"


class Insight(BaseModel):
    insight_id: str
    kind: InsightKind
    statement: str
    fact_ids: list[str] = Field(default_factory=list)
    magnitude: float | None = None
    unit: str | None = None
    confidence: Confidence = Confidence.moderate
    causal: bool = False
    tags: list[str] = Field(default_factory=list)


class ReasoningResult(BaseModel):
    insights: list[Insight] = Field(default_factory=list)
    strongest_insight_ids: list[str] = Field(default_factory=list)
    cautions: list[str] = Field(default_factory=list)
    data_gaps: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvidenceBundle(BaseModel):
    facts: list[Fact] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)
    limitations: list[Limitation] = Field(default_factory=list)
    raw: Any = None
    source_summary: list[EvidenceSource] = Field(default_factory=list)


class ResponseContext(BaseModel):
    organization_id: str = ""
    conversation_id: str = ""
    actor: str = ""
    audience: str = ""
    topic: str = ""
    category: str = ""
    entity_type: str = ""
    entity_label: str = ""
    recent_responses: list[str] = Field(default_factory=list)
    locale: str = "en-UG"
    currency: str = "UGX"


class GenerationConfig(BaseModel):
    """Ephemeral provider delegation from Ledgerly.

    Credentials are request-only and are never included in ResponseResult.
    """

    provider: str = ""
    api_style: Literal["responses", "chat-completions", "anthropic"] = "chat-completions"
    base_url: str = ""
    api_key: SecretStr = Field(default_factory=lambda: SecretStr(""), repr=False)
    model: str = ""
    timeout_seconds: float = Field(default=45.0, ge=1.0, le=120.0)


class ResponseRequest(BaseModel):
    request_id: str = ""
    purpose: Purpose = Purpose.general
    request: str = Field(min_length=1, max_length=20000)
    semantic_payload: dict[str, Any] = Field(default_factory=dict)
    evidence: EvidenceBundle | None = None
    context: ResponseContext = Field(default_factory=ResponseContext)
    register: Register | None = None
    detail: Literal["brief", "standard", "deep"] = "standard"
    output_format: Literal["markdown", "plain", "json"] = "markdown"
    provider_mode: Literal["auto", "required", "disabled"] = "auto"
    generation: GenerationConfig | None = None
    max_words: int = Field(default=1200, ge=80, le=5000)
    tool_policy: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_provider_mode(self) -> "ResponseRequest":
        if self.provider_mode == "required" and not self.request.strip():
            raise ValueError("request is required")
        return self


class SectionPlan(BaseModel):
    section_id: str
    goal: str
    title_hint: str = ""
    fact_ids: list[str] = Field(default_factory=list)
    moves: list[str] = Field(default_factory=list)
    must_qualify: bool = False
    priority: int = 50


class DiscoursePlan(BaseModel):
    purpose: Purpose
    register: Register
    strategy_id: str = "evidence-first"
    thesis: str = ""
    sections: list[SectionPlan] = Field(default_factory=list)
    include_table: bool = False
    include_bullets: bool = False
    include_limitations: bool = False
    include_recommendations: bool = False
    causal_guard_required: bool = False
    style_seed: str = ""
    editorial_rules: list[str] = Field(default_factory=list)


class QualityDimension(BaseModel):
    score: float = Field(ge=0, le=1)
    notes: list[str] = Field(default_factory=list)


class QualityReport(BaseModel):
    grounding: QualityDimension
    completeness: QualityDimension
    readability: QualityDimension
    naturalness: QualityDimension
    variation: QualityDimension
    causality: QualityDimension
    professionalism: QualityDimension
    overall: float = Field(ge=0, le=1)
    revision_required: bool = False
    revision_instructions: list[str] = Field(default_factory=list)


class ResponseResult(BaseModel):
    request_id: str = ""
    text: str
    plan: DiscoursePlan
    quality: QualityReport
    evidence: EvidenceBundle
    reasoning: ReasoningResult
    provider: str = "deterministic"
    model: str = ""
    revision_count: int = 0
    response_fingerprint: str = ""
    tool_events: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvaluationRequest(BaseModel):
    text: str
    request: str = ""
    semantic_payload: dict[str, Any] = Field(default_factory=dict)
    evidence: EvidenceBundle | None = None
    context: ResponseContext = Field(default_factory=ResponseContext)
    purpose: Purpose = Purpose.general
