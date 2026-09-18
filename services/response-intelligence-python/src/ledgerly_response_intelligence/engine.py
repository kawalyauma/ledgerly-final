from __future__ import annotations

import asyncio
import logging
from typing import Any

from .config import Settings
from .critic import ResponseCritic
from .memory import fingerprint
from .models import (
    EvaluationRequest,
    EvidenceBundle,
    QualityReport,
    ResponseRequest,
    ResponseResult,
)
from .planner import DiscoursePlanner
from .providers.base import GenerationProvider
from .providers.factory import build_provider
from .realization import (
    DeterministicRealizer,
    build_generation_prompt,
    clean_response,
)
from .semantic import merge_evidence
from .tools.base import ToolBroker
from .tools.registry import DisabledToolBroker


logger = logging.getLogger(__name__)


class ResponseIntelligenceEngine:
    def __init__(
        self,
        settings: Settings,
        *,
        provider: GenerationProvider | None = None,
        tool_broker: ToolBroker | None = None,
    ) -> None:
        self.settings = settings
        self.provider = provider if provider is not None else build_provider(settings)
        self.tool_broker = tool_broker or DisabledToolBroker()
        self.planner = DiscoursePlanner()
        self.realizer = DeterministicRealizer()
        self.critic = ResponseCritic()

    async def respond(self, request: ResponseRequest) -> ResponseResult:
        evidence = merge_evidence(request.evidence, request.semantic_payload)
        plan = self.planner.build(request, evidence)
        tool_events: list[dict[str, Any]] = []

        # External retrieval is deliberately policy-gated. The interface is live now so
        # web/search/document tools can be added later without changing the response engine.
        if request.tool_policy:
            tool_events = await self._tool_policy_events(request.tool_policy)

        use_provider = (
            request.provider_mode != "disabled"
            and self.provider is not None
            and self.settings.provider_enabled
        )
        if request.provider_mode == "required" and not use_provider:
            raise RuntimeError("A generation provider is required for this request but none is configured.")

        draft = self.realizer.realize(request, evidence, plan)
        provider_name = "deterministic"
        model = ""
        revision_count = 0

        if use_provider:
            try:
                system, prompt = build_generation_prompt(request, evidence, plan)
                response = await self.provider.generate(
                    system=system,
                    prompt=prompt,
                    max_tokens=self._token_budget(request.max_words),
                )
                if response.text.strip():
                    draft = clean_response(response.text)
                    provider_name = response.provider
                    model = response.model
            except Exception as exc:  # noqa: BLE001
                logger.warning("Response provider failed; using deterministic realization: %s", exc)
                if request.provider_mode == "required":
                    raise

        quality = self.critic.evaluate(draft, request, evidence)
        if use_provider:
            draft, quality, revision_count = await self._revise_until_acceptable(
                request=request,
                evidence=evidence,
                plan=plan,
                draft=draft,
                quality=quality,
            )

        # If provider output still contains unsupported factual claims, deterministic output
        # is safer than returning fluent hallucination.
        if quality.grounding.score < 0.9 or quality.causality.score < 0.7:
            fallback = self.realizer.realize(request, evidence, plan)
            fallback_quality = self.critic.evaluate(fallback, request, evidence)
            if fallback_quality.grounding.score >= quality.grounding.score:
                draft = fallback
                quality = fallback_quality
                provider_name = "deterministic-safety-fallback"
                model = ""

        draft = self._limit_words(clean_response(draft), request.max_words)
        quality = self.critic.evaluate(draft, request, evidence)

        return ResponseResult(
            request_id=request.request_id,
            text=draft,
            plan=plan,
            quality=quality,
            evidence=evidence,
            provider=provider_name,
            model=model,
            revision_count=revision_count,
            response_fingerprint=fingerprint(draft),
            tool_events=tool_events,
            metadata={
                "providerConfigured": self.settings.provider_enabled,
                "externalToolsEnabled": self.settings.allow_external_tools,
                "webSearchEnabled": self.settings.allow_web_search,
                "factCount": len(evidence.facts),
                "relationshipCount": len(evidence.relationships),
                "limitationCount": len(evidence.limitations),
            },
        )

    def evaluate(self, request: EvaluationRequest) -> QualityReport:
        evidence = merge_evidence(request.evidence, request.semantic_payload)
        synthetic = ResponseRequest(
            request=request.request or "Evaluate this response.",
            semantic_payload=request.semantic_payload,
            evidence=evidence,
            context=request.context,
            purpose=request.purpose,
            provider_mode="disabled",
        )
        return self.critic.evaluate(request.text, synthetic, evidence)

    async def _revise_until_acceptable(
        self,
        *,
        request: ResponseRequest,
        evidence: EvidenceBundle,
        plan: Any,
        draft: str,
        quality: QualityReport,
    ) -> tuple[str, QualityReport, int]:
        if not self.provider:
            return draft, quality, 0
        revisions = 0
        current = draft
        current_quality = quality
        while current_quality.revision_required and revisions < self.settings.max_revisions:
            revisions += 1
            system, prompt = build_generation_prompt(
                request,
                evidence,
                plan,
                previous_draft=current,
                revision_instructions=current_quality.revision_instructions,
            )
            try:
                response = await self.provider.generate(
                    system=system,
                    prompt=prompt,
                    max_tokens=self._token_budget(request.max_words),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Response revision failed: %s", exc)
                break
            candidate = clean_response(response.text)
            if not candidate:
                break
            candidate_quality = self.critic.evaluate(candidate, request, evidence)
            if candidate_quality.overall >= current_quality.overall or (
                candidate_quality.grounding.score > current_quality.grounding.score
            ):
                current = candidate
                current_quality = candidate_quality
            else:
                break
        return current, current_quality, revisions

    async def _tool_policy_events(self, names: list[str]) -> list[dict[str, Any]]:
        capabilities = {item.name: item for item in await self.tool_broker.capabilities()}
        events: list[dict[str, Any]] = []
        for name in names:
            capability = capabilities.get(name)
            events.append(
                {
                    "tool": name,
                    "available": bool(capability),
                    "enabled": bool(capability and capability.enabled),
                    "external": bool(capability and capability.external),
                }
            )
        return events

    @staticmethod
    def _token_budget(max_words: int) -> int:
        return min(8000, max(600, int(max_words * 1.7)))

    @staticmethod
    def _limit_words(text: str, max_words: int) -> str:
        words = text.split()
        if len(words) <= max_words:
            return text
        truncated = " ".join(words[:max_words]).rstrip(" ,;:")
        return truncated + "…"
