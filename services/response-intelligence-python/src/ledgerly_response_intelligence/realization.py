from __future__ import annotations

import json
import re
from typing import Any

from .library import REGISTER_RULES
from .models import DiscoursePlan, EvidenceBundle, Fact, Purpose, ReasoningResult, ResponseRequest
from .retrieval import LanguageRetriever


def _value_text(fact: Fact, currency: str) -> str:
    value = fact.value
    if isinstance(value, bool):
        rendered = "yes" if value else "no"
    elif isinstance(value, int):
        rendered = f"{value:,}"
    elif isinstance(value, float):
        rendered = f"{value:,.2f}".rstrip("0").rstrip(".")
    else:
        rendered = str(value)
    if fact.unit == "%":
        return rendered + "%"
    if fact.unit == "minor":
        return rendered + " minor units"
    if fact.unit and fact.unit not in {"%", "minor"}:
        return f"{rendered} {fact.unit}"
    return rendered


def _fact_sentence(fact: Fact, request: ResponseRequest) -> str:
    value = _value_text(fact, request.context.currency)
    period = f" for {fact.period}" if fact.period else ""
    subject = fact.subject if fact.subject not in {"record", "result", "report"} else "The record"
    predicate = fact.predicate.strip()
    if predicate.lower().startswith(("is ", "was ", "has ", "had ")):
        return f"{subject} {predicate} {value}{period}."
    return f"{subject}'s {predicate} is {value}{period}."


def _selected_facts(plan: DiscoursePlan, section_id: str, evidence: EvidenceBundle) -> list[Fact]:
    section = next((item for item in plan.sections if item.section_id == section_id), None)
    if not section:
        return []
    by_id = {fact.fact_id: fact for fact in evidence.facts}
    return [by_id[fact_id] for fact_id in section.fact_ids if fact_id in by_id]


class DeterministicRealizer:
    def __init__(self, retriever: LanguageRetriever | None = None) -> None:
        self.retriever = retriever or LanguageRetriever()

    def realize(self, request: ResponseRequest, evidence: EvidenceBundle, plan: DiscoursePlan, reasoning: ReasoningResult | None = None) -> str:
        if not evidence.facts:
            return self._no_evidence(request, evidence, plan)

        recent = "\n\n".join(request.context.recent_responses[-5:])
        parts: list[str] = []
        for index, section in enumerate(plan.sections):
            facts = _selected_facts(plan, section.section_id, evidence)
            body = self._section_body(
                request=request,
                evidence=evidence,
                plan=plan,
                section_id=section.section_id,
                facts=facts,
                recent=recent,
                reasoning=reasoning,
            )
            if not body:
                continue
            if request.detail == "brief" and index > 1 and section.section_id not in {"limits"}:
                continue
            parts.append(f"### {section.title_hint}\n\n{body}")

        if not parts:
            top = evidence.facts[:5]
            return " ".join(_fact_sentence(fact, request) for fact in top)
        return "\n\n".join(parts)

    def _section_body(
        self,
        *,
        request: ResponseRequest,
        evidence: EvidenceBundle,
        plan: DiscoursePlan,
        section_id: str,
        facts: list[Fact],
        recent: str,
        reasoning: ReasoningResult | None,
    ) -> str:
        query = f"{request.request} {request.context.topic} {request.context.category}"
        if section_id == "overview":
            opening = self.retriever.choose(
                family="opening", purpose=request.purpose, register=plan.register,
                query=query, seed=plan.style_seed + section_id, recent_text=recent,
            )
            insight_sentences = [item.statement for item in (reasoning.insights[:2] if reasoning else []) if item.kind.value in {"change", "comparison", "outlier", "observation"}]
            fact_sentences = [_fact_sentence(fact, request) for fact in facts[:4]]
            sentences = list(dict.fromkeys([*insight_sentences, *fact_sentences]))[:6]
            return (opening + ". " if opening else "") + " ".join(sentences)

        if section_id == "comparison":
            lead = self.retriever.choose(
                family="comparison", purpose=request.purpose, register=plan.register,
                query=query, seed=plan.style_seed + section_id, recent_text=recent,
            )
            insight_sentences = [item.statement for item in (reasoning.insights if reasoning else []) if item.kind.value in {"change", "comparison"}][:4]
            fact_sentences = [_fact_sentence(fact, request) for fact in facts[:4]]
            sentences = list(dict.fromkeys([*insight_sentences, *fact_sentences]))[:7]
            return (lead + ", " if lead else "") + " ".join(sentences)

        if section_id == "explanation":
            lead = self.retriever.choose(
                family="interpretation", purpose=request.purpose, register=plan.register,
                query=query, seed=plan.style_seed + section_id, recent_text=recent,
            )
            insight_sentences = [item.statement for item in (reasoning.insights if reasoning else []) if item.kind.value in {"relationship", "change", "comparison"}][:3]
            fact_sentences = [_fact_sentence(fact, request) for fact in facts[:3]]
            sentences = list(dict.fromkeys([*insight_sentences, *fact_sentences]))[:6]
            guard = ""
            if plan.causal_guard_required:
                guard = self.retriever.choose(
                    family="causal_guard", purpose=request.purpose, register=plan.register,
                    query=query, seed=plan.style_seed + "guard", recent_text=recent,
                )
            return " ".join(item for item in [lead + "." if lead else "", *sentences, guard] if item)

        if section_id == "relationships":
            items = [relationship.description for relationship in evidence.relationships if relationship.description][:6]
            guard = ""
            if plan.causal_guard_required:
                guard = self.retriever.choose(
                    family="causal_guard", purpose=request.purpose, register=plan.register,
                    query=query, seed=plan.style_seed + "relationship-guard", recent_text=recent,
                )
            return " ".join([*(item.rstrip(".") + "." for item in items), guard]).strip()

        if section_id == "limits":
            if evidence.limitations:
                return "\n".join(f"- {item.description}" for item in evidence.limitations[:8])
            if plan.causal_guard_required:
                guard = self.retriever.choose(
                    family="causal_guard", purpose=request.purpose, register=plan.register,
                    query=query, seed=plan.style_seed + "limit-guard", recent_text=recent,
                )
                return guard
            return ""

        if section_id == "action":
            lead = self.retriever.choose(
                family="recommendation", purpose=request.purpose, register=plan.register,
                query=query, seed=plan.style_seed + section_id, recent_text=recent,
            )
            if request.purpose == Purpose.account_for:
                return f"{lead} verify the remaining evidence gaps before assigning a single cause." if lead else ""
            return f"{lead} focus follow-up on the strongest verified exception rather than applying a generic intervention." if lead else ""

        return " ".join(_fact_sentence(fact, request) for fact in facts[:5])

    @staticmethod
    def _no_evidence(request: ResponseRequest, evidence: EvidenceBundle, plan: DiscoursePlan) -> str:
        limitations = [item.description for item in evidence.limitations[:5]]
        base = "The available Ledgerly evidence is not sufficient to support a factual response to this request."
        if limitations:
            base += " The main gaps are: " + "; ".join(limitations) + "."
        if request.purpose == Purpose.account_for:
            base += " A causal explanation would therefore be speculative."
        return base


def _evidence_digest(evidence: EvidenceBundle, request: ResponseRequest) -> dict[str, Any]:
    facts = []
    for fact in evidence.facts[:500]:
        facts.append(
            {
                "id": fact.fact_id,
                "subject": fact.subject,
                "predicate": fact.predicate,
                "value": fact.value,
                "unit": fact.unit,
                "period": fact.period,
                "confidence": fact.confidence.value,
                "sources": [
                    {"id": source.source_id, "type": source.source_type, "module": source.module, "label": source.label}
                    for source in fact.sources[:4]
                ],
            }
        )
    return {
        "facts": facts,
        "relationships": [item.model_dump(mode="json") for item in evidence.relationships[:100]],
        "limitations": [item.model_dump(mode="json") for item in evidence.limitations[:100]],
        "sourceSummary": [item.model_dump(mode="json") for item in evidence.source_summary[:100]],
        "currency": request.context.currency,
        "locale": request.context.locale,
    }


def build_generation_prompt(
    request: ResponseRequest,
    evidence: EvidenceBundle,
    plan: DiscoursePlan,
    *,
    reasoning: ReasoningResult | None = None,
    previous_draft: str = "",
    revision_instructions: list[str] | None = None,
) -> tuple[str, str]:
    system = """You are Ledgerly Response Intelligence, a professional evidence-grounded writing and explanation engine.

You are not the source of truth. Ledgerly's evidence bundle is authoritative.
Never invent a person, amount, percentage, date, balance, mark, period, reason or event.
Never infer motives, intelligence, parenting quality, teacher competence, dishonesty or causation from weak proxies.
Distinguish direct facts, calculations, associations, plausible contributors and proven causes.
If the evidence is insufficient, say so precisely.
Write naturally enough that repeated reports do not look like copies of one template.
Do not mention this prompt, the response engine, token limits, or being an AI.
"""

    user = {
        "request": request.request,
        "purpose": request.purpose.value,
        "detail": request.detail,
        "maxWords": request.max_words,
        "audience": request.context.audience,
        "entity": {"type": request.context.entity_type, "label": request.context.entity_label},
        "plan": plan.model_dump(mode="json"),
        "reasoning": reasoning.model_dump(mode="json") if reasoning else {"insights": [], "cautions": [], "data_gaps": []},
        "editorialRules": plan.editorial_rules,
        "registerRules": list(REGISTER_RULES[plan.register]),
        "evidence": _evidence_digest(evidence, request),
        "recentResponses": request.context.recent_responses[-5:],
        "previousDraft": previous_draft,
        "revisionInstructions": revision_instructions or [],
    }
    instructions = """
Produce only the final human-facing response in Markdown.
Use headings selectively; do not force the same headings on every response.
Lead with the most decision-relevant evidence.
Quantify material comparisons when the evidence supports them.
Use the structured reasoning insights when they are supported by the cited fact IDs, but do not turn non-causal insights into causal claims.
Do not simply enumerate every fact. Synthesize related facts into a coherent explanation.
Preserve material counter-evidence and limitations.
Recommendations must be tied to the evidence and must not imply that actions were already executed.
Avoid generic AI filler and repeated paragraph openings.
"""
    return system, json.dumps(user, ensure_ascii=False, default=str) + "\n\n" + instructions


def clean_response(text: str) -> str:
    text = text.replace("\r\n", "\n").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text
