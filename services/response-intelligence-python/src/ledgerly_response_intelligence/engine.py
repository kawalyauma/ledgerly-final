from __future__ import annotations

import logging
from typing import Any

from .config import Settings
from .critic import ResponseCritic
from .knowledge.models import KnowledgeSearchHit
from .knowledge.retrieval import KnowledgeRetriever
from .knowledge.store import KnowledgeStore
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
from .providers.factory import build_delegated_provider, build_local_adapter_provider, build_provider
from .reasoning import ReasoningEngine
from .realization import (
    DeterministicRealizer,
    build_generation_prompt,
    clean_response,
)
from .semantic import merge_evidence
from .tools.base import ToolBroker, ToolRequest
from .tools.web_search import build_external_tool_registry
from .training.models import AdapterRecord, RetrievalExample, StyleProfile
from .training.retrieval import TrainingRetriever
from .training.store import TrainingStore


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
        self.tool_broker = tool_broker or build_external_tool_registry(settings)
        self.planner = DiscoursePlanner()
        self.reasoner = ReasoningEngine()
        self.realizer = DeterministicRealizer()
        self.critic = ResponseCritic()
        self.training_store = (
            TrainingStore(
                settings.training_db_path,
                privacy_mode=settings.training_privacy_mode,
                min_sft_examples=settings.training_min_sft_examples,
                min_preference_examples=settings.training_min_preference_examples,
            )
            if settings.learning_enabled
            else None
        )
        self.training_retriever = (
            TrainingRetriever(self.training_store)
            if self.training_store is not None and settings.learning_retrieval_enabled
            else None
        )
        self.knowledge_store = KnowledgeStore(settings.knowledge_db_path) if settings.knowledge_enabled else None
        self.knowledge_retriever = (
            KnowledgeRetriever(self.knowledge_store)
            if self.knowledge_store is not None and settings.knowledge_retrieval_enabled
            else None
        )

    async def respond(self, request: ResponseRequest) -> ResponseResult:
        evidence = merge_evidence(request.evidence, request.semantic_payload)
        reasoning = self.reasoner.derive(request, evidence)
        plan = self.planner.build(request, evidence)
        tool_events: list[dict[str, Any]] = []
        learned_examples: list[RetrievalExample] = []
        style_profile: StyleProfile | None = None
        reference_knowledge: list[KnowledgeSearchHit] = []
        if self.training_retriever is not None and request.context.organization_id:
            style_profile = self.training_retriever.style_profile(request.context.organization_id)
            learned_examples = self.training_retriever.retrieve(
                organization_id=request.context.organization_id,
                request=request.request,
                purpose=request.purpose.value,
                register=plan.register.value,
                strategy_id=plan.strategy_id,
                limit=self.settings.training_retrieval_limit,
                include_global=True,
            )
            if style_profile.approved_examples>=5 and style_profile.preferred_strategy:
                plan=self.planner.apply_strategy_preference(plan,style_profile.preferred_strategy)
            for rule in style_profile.rules:
                if rule not in plan.editorial_rules:
                    plan.editorial_rules.append(rule)

        if (
            self.knowledge_retriever is not None
            and request.context.organization_id
            and self.settings.knowledge_retrieval_limit>0
        ):
            query=" ".join(
                item for item in [
                    request.request,
                    request.context.topic,
                    request.context.category,
                    request.context.entity_type,
                ] if item
            ).strip()
            if query:
                reference_knowledge=self._trim_knowledge(
                    self.knowledge_retriever.search(
                        organization_id=request.context.organization_id,
                        query=query,
                        limit=self.settings.knowledge_retrieval_limit,
                        include_global=self.settings.knowledge_include_global,
                    ),
                    self.settings.knowledge_max_context_chars,
                )
                if reference_knowledge:
                    tool_events.append({
                        "tool":"knowledge.search",
                        "available":True,
                        "enabled":True,
                        "external":False,
                        "results":len(reference_knowledge),
                        "sources":[item.source_id for item in reference_knowledge],
                    })

        # External retrieval is deliberately policy-gated. Live web results remain
        # supplemental references and never enter the deterministic Ledgerly fact graph.
        if request.tool_policy:
            external_events,external_refs=await self._execute_reference_tools(request)
            tool_events.extend(external_events)
            reference_knowledge=self._trim_knowledge(
                [*reference_knowledge,*external_refs],
                self.settings.knowledge_max_context_chars,
            )

        delegated_provider = build_delegated_provider(request.generation)
        active_adapter: AdapterRecord | None = None
        local_adapter_provider: GenerationProvider | None = None
        if (
            self.settings.training_prefer_active_adapter
            and self.training_store is not None
            and request.context.organization_id
        ):
            active_adapter = self.training_store.active_adapter(request.context.organization_id)
            if active_adapter is not None:
                local_adapter_provider = build_local_adapter_provider(
                    base_model=active_adapter.base_model,
                    adapter_path=active_adapter.path,
                    device_map=self.settings.local_adapter_device_map,
                    temperature=self.settings.local_adapter_temperature,
                )

        provider_candidates: list[GenerationProvider] = []
        for candidate in [local_adapter_provider, delegated_provider, self.provider]:
            if candidate is not None and all(candidate is not item for item in provider_candidates):
                provider_candidates.append(candidate)
        active_provider: GenerationProvider | None = provider_candidates[0] if provider_candidates else None
        use_provider = request.provider_mode != "disabled" and bool(provider_candidates)
        if request.provider_mode == "required" and not use_provider:
            raise RuntimeError("A generation provider is required for this request but none is configured.")

        draft = self.realizer.realize(request, evidence, plan, reasoning)
        provider_name = "deterministic"
        model = ""
        revision_count = 0

        if use_provider:
            system, prompt = build_generation_prompt(
                request,evidence,plan,reasoning=reasoning,
                learned_examples=learned_examples,style_profile=style_profile,reference_knowledge=reference_knowledge,
            )
            last_error: Exception | None = None
            generated = False
            for candidate in provider_candidates:
                try:
                    response = await candidate.generate(
                        system=system,prompt=prompt,max_tokens=self._token_budget(request.max_words),
                    )
                    if response.text.strip():
                        draft=clean_response(response.text)
                        provider_name=response.provider
                        model=response.model
                        active_provider=candidate
                        generated=True
                        break
                except Exception as exc:  # noqa: BLE001
                    last_error=exc
                    logger.warning("Response provider %s failed; trying fallback: %s",getattr(candidate,"name","unknown"),exc)
            if request.provider_mode=="required" and not generated:
                raise RuntimeError(f"All configured generation providers failed: {last_error}")
            if not generated:
                active_provider=None
                use_provider=False

        quality = self.critic.evaluate(draft, request, evidence, reasoning, reference_knowledge)
        if use_provider:
            draft, quality, revision_count = await self._revise_until_acceptable(
                request=request,
                evidence=evidence,
                plan=plan,
                reasoning=reasoning,
                draft=draft,
                quality=quality,
                provider=active_provider,
                learned_examples=learned_examples,
                style_profile=style_profile,
                reference_knowledge=reference_knowledge,
            )

        # If provider output still contains unsupported factual claims, deterministic output
        # is safer than returning fluent hallucination.
        if quality.grounding.score < 0.9 or quality.causality.score < 0.7:
            fallback = self.realizer.realize(request, evidence, plan, reasoning)
            fallback_quality = self.critic.evaluate(fallback, request, evidence, reasoning, reference_knowledge)
            if fallback_quality.grounding.score >= quality.grounding.score:
                draft = fallback
                quality = fallback_quality
                provider_name = "deterministic-safety-fallback"
                model = ""

        draft = self._limit_words(clean_response(draft), request.max_words)
        quality = self.critic.evaluate(draft, request, evidence, reasoning)
        final_fingerprint = fingerprint(draft)
        training_example_id = ""
        if (
            self.training_store is not None
            and request.context.organization_id
            and quality.overall >= self.settings.training_auto_candidate_quality
        ):
            try:
                candidate = self.training_store.capture_candidate(
                    organization_id=request.context.organization_id,
                    purpose=request.purpose,
                    request=request.request,
                    semantic_payload=request.semantic_payload,
                    response_text=draft,
                    register=plan.register,
                    strategy_id=plan.strategy_id,
                    quality_overall=quality.overall,
                    tags=[
                        item for item in [
                            request.context.category,
                            request.context.topic,
                            request.context.entity_type,
                            "auto-candidate",
                        ] if item
                    ],
                    entity_label=request.context.entity_label,
                    response_fingerprint=final_fingerprint,
                )
                training_example_id = candidate.example_id
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not capture response training candidate: %s", exc)

        return ResponseResult(
            request_id=request.request_id,
            text=draft,
            plan=plan,
            quality=quality,
            evidence=evidence,
            reasoning=reasoning,
            provider=provider_name,
            model=model,
            revision_count=revision_count,
            response_fingerprint=final_fingerprint,
            tool_events=tool_events,
            metadata={
                "providerConfigured": bool(provider_candidates),
                "providerDelegated": delegated_provider is not None,
                "activeAdapterId": active_adapter.adapter_id if active_adapter else "",
                "activeAdapterPreferred": self.settings.training_prefer_active_adapter,
                "providerFallbacks": [getattr(item,"name","unknown") for item in provider_candidates],
                "externalToolsEnabled": self.settings.allow_external_tools,
                "webSearchEnabled": self.settings.allow_web_search,
                "factCount": len(evidence.facts),
                "relationshipCount": len(evidence.relationships),
                "limitationCount": len(evidence.limitations),
                "learningEnabled": self.training_store is not None,
                "learnedExamplesUsed": [item.example_id for item in learned_examples],
                "styleProfileExamples": style_profile.approved_examples if style_profile else 0,
                "trainingExampleId": training_example_id,
                "knowledgeRetrievalEnabled": self.knowledge_retriever is not None,
                "knowledgeSourcesUsed": [
                    {
                        "sourceId":item.source_id,
                        "title":item.title,
                        "sourceType":item.source_type,
                        "url":item.url,
                        "scope":item.organization_scope,
                        "score":item.score,
                    }
                    for item in reference_knowledge if item.source_type!="web"
                ],
                "webSourcesUsed": [
                    {
                        "sourceId":item.source_id,
                        "title":item.title,
                        "url":item.url,
                        "score":item.score,
                    }
                    for item in reference_knowledge if item.source_type=="web"
                ],
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
        reasoning = self.reasoner.derive(synthetic, evidence)
        return self.critic.evaluate(request.text, synthetic, evidence, reasoning)

    async def _revise_until_acceptable(
        self,
        *,
        request: ResponseRequest,
        evidence: EvidenceBundle,
        plan: Any,
        reasoning: Any,
        draft: str,
        quality: QualityReport,
        provider: GenerationProvider | None,
        learned_examples: list[RetrievalExample],
        style_profile: StyleProfile | None,
        reference_knowledge: list[KnowledgeSearchHit],
    ) -> tuple[str, QualityReport, int]:
        if provider is None:
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
                reasoning=reasoning,
                learned_examples=learned_examples,
                style_profile=style_profile,
                reference_knowledge=reference_knowledge,
                previous_draft=current,
                revision_instructions=current_quality.revision_instructions,
            )
            try:
                response = await provider.generate(
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
            candidate_quality = self.critic.evaluate(candidate, request, evidence, reasoning, reference_knowledge)
            if candidate_quality.overall >= current_quality.overall or (
                candidate_quality.grounding.score > current_quality.grounding.score
            ):
                current = candidate
                current_quality = candidate_quality
            else:
                break
        return current, current_quality, revisions

    async def _execute_reference_tools(
        self,
        request:ResponseRequest,
    )->tuple[list[dict[str,Any]],list[KnowledgeSearchHit]]:
        capabilities={item.name:item for item in await self.tool_broker.capabilities()}
        events:list[dict[str,Any]]=[]
        references:list[KnowledgeSearchHit]=[]
        for name in request.tool_policy:
            capability=capabilities.get(name)
            if not capability:
                events.append({"tool":name,"available":False,"enabled":False,"external":False})
                continue
            if not capability.enabled:
                events.append({
                    "tool":name,"available":True,"enabled":False,"external":capability.external,
                    "error":"Tool is not enabled.",
                })
                continue
            try:
                result=await self.tool_broker.execute(ToolRequest(
                    name=name,query=request.request,
                    arguments={"limit":self.settings.web_search_max_results},
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("External reference tool %s failed: %s",name,exc)
                events.append({
                    "tool":name,"available":True,"enabled":True,"external":capability.external,
                    "ok":False,"error":str(exc),
                })
                continue
            event={
                "tool":name,"available":True,"enabled":True,"external":capability.external,
                "ok":result.ok,"error":result.error,"sources":result.sources,
            }
            raw_results=(result.data or {}).get("results",[]) if isinstance(result.data,dict) else []
            if isinstance(raw_results,list):
                event["results"]=len(raw_results)
                for index,item in enumerate(raw_results[:self.settings.web_search_max_results]):
                    if not isinstance(item,dict):
                        continue
                    url=str(item.get("url") or "")
                    title=str(item.get("title") or url or "Web result")
                    snippet=str(item.get("snippet") or item.get("content") or "").strip()
                    if not snippet:
                        continue
                    references.append(KnowledgeSearchHit(
                        chunk_id="web_"+fingerprint(url+"|"+snippet)[:20],
                        source_id="web_"+fingerprint(url)[:20],
                        title=title,
                        content=snippet,
                        source_type="web",
                        url=url,
                        published_at=str(item.get("age") or item.get("published_at") or ""),
                        score=float(item.get("score") or 0.55),
                        organization_scope="global",
                        tags=["live-web",str(item.get("provider") or "web")],
                    ))
            events.append(event)
        return events,references

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
    def _trim_knowledge(items:list[KnowledgeSearchHit],max_chars:int)->list[KnowledgeSearchHit]:
        kept:list[KnowledgeSearchHit]=[]
        used=0
        for item in items:
            if used>=max_chars:
                break
            remaining=max_chars-used
            if len(item.content)>remaining:
                if remaining<300:
                    break
                item=item.model_copy(update={"content":item.content[:remaining].rstrip()+"…"})
            kept.append(item)
            used+=len(item.content)
        return kept

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
