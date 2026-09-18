from __future__ import annotations

import hashlib
import re
from collections import Counter
from typing import Any

from .library import DOMAIN_RULES, REGISTER_RULES
from .models import (
    DiscoursePlan,
    EvidenceBundle,
    Purpose,
    Register,
    ResponseRequest,
    SectionPlan,
)
from .retrieval import LanguageRetriever
from .semantic import numeric_facts
from .strategies import select_strategy


DOMAIN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("attendance", re.compile(r"\b(attendan|absen|present|late|punctual)")),
    ("academics", re.compile(r"\b(academic|mark|grade|result|exam|assessment|subject|lesson|scheme|performance)")),
    ("fees", re.compile(r"\b(fee|arrear|billing|school fees|payment balance)")),
    ("finance", re.compile(r"\b(bank|cash|budget|journal|ledger|revenue|expense|receiv|payable|account|tax|asset|payroll)")),
    ("staff", re.compile(r"\b(staff|teacher|employee|workload|leave)")),
    ("operations", re.compile(r"\b(operational|school health|management|department|inventory|books|communication)")),
)


def infer_domain(request: ResponseRequest, evidence: EvidenceBundle) -> str:
    text = " ".join(
        [
            request.request,
            request.context.topic,
            request.context.category,
            " ".join(f"{fact.subject} {fact.predicate} {' '.join(fact.tags)}" for fact in evidence.facts[:250]),
        ]
    ).lower()
    scored: list[tuple[int, str]] = []
    for domain, pattern in DOMAIN_PATTERNS:
        scored.append((len(pattern.findall(text)), domain))
    scored.sort(reverse=True)
    return scored[0][1] if scored and scored[0][0] > 0 else "operations"


def infer_register(request: ResponseRequest, domain: str) -> Register:
    if request.register:
        return request.register
    audience = f"{request.context.audience} {request.context.actor}".lower()
    if "teacher" in audience or domain == "academics":
        return Register.teacher
    if any(word in audience for word in ("headteacher", "director", "manager", "administrator", "owner")):
        return Register.executive
    if domain in {"finance", "fees"}:
        return Register.finance
    if any(word in request.request.lower() for word in ("technical", "api", "developer", "schema", "json")):
        return Register.technical
    return Register.school_professional


def _fact_priority(fact: Any) -> int:
    text = f"{fact.predicate} {' '.join(fact.tags)}".lower()
    score = 50
    if any(word in text for word in ("average", "balance", "attendance", "total", "change", "division", "aggregate", "amount", "rate")):
        score += 20
    if isinstance(fact.value, (int, float)):
        score += 10
    if fact.period:
        score += 5
    return score


class DiscoursePlanner:
    def __init__(self, retriever: LanguageRetriever | None = None) -> None:
        self.retriever = retriever or LanguageRetriever()

    def build(self, request: ResponseRequest, evidence: EvidenceBundle) -> DiscoursePlan:
        domain = infer_domain(request, evidence)
        register = infer_register(request, domain)
        seed = request.request_id or hashlib.sha1(request.request.encode("utf-8")).hexdigest()[:12]
        facts = sorted(evidence.facts, key=_fact_priority, reverse=True)
        numeric = numeric_facts(facts)
        relationships = evidence.relationships
        has_comparison = bool(
            re.search(r"\b(compare|versus|vs\.?|previous|last|baseline|peer|change|difference|trend)\b", request.request.lower())
            or len({fact.period for fact in facts if fact.period}) > 1
        )
        has_explanation = request.purpose == Purpose.account_for or bool(
            re.search(r"\b(why|account for|explain|reason|cause|contribut)\b", request.request.lower())
        )
        causal_guard = has_explanation and not any(rel.causal and rel.confidence.value in {"direct", "strong"} for rel in relationships)
        include_limits = bool(evidence.limitations) or causal_guard
        include_recommendations = request.purpose in {
            Purpose.analysis, Purpose.account_for, Purpose.recommendation, Purpose.warning
        } and request.detail != "brief"
        strategy = select_strategy(
            request.purpose,
            seed=seed,
            has_comparison=has_comparison,
            has_relationships=bool(relationships),
            has_limits=include_limits,
            deep=request.detail == "deep",
        )

        sections: list[SectionPlan] = []
        top_fact_ids = [fact.fact_id for fact in facts[:12]]
        sections.append(
            SectionPlan(
                section_id="overview",
                goal="Establish the most material verified pattern before discussing explanations.",
                title_hint=self.retriever.section_title("overview", seed, " ".join(request.context.recent_responses)),
                fact_ids=top_fact_ids[:6],
                moves=["orient", "fact", "interpretation"],
                priority=100,
            )
        )
        if has_comparison and len(numeric) >= 2:
            sections.append(
                SectionPlan(
                    section_id="comparison",
                    goal="Make the most decision-relevant comparison explicit and quantify it where safe.",
                    title_hint=self.retriever.section_title("comparison", seed + "comparison"),
                    fact_ids=[fact.fact_id for fact in numeric[:10]],
                    moves=["comparison", "trend", "fact"],
                    priority=90,
                )
            )
        if has_explanation:
            sections.append(
                SectionPlan(
                    section_id="explanation",
                    goal="Explain the outcome using observed contributors while considering alternative explanations.",
                    title_hint=self.retriever.section_title("explanation", seed + "explanation"),
                    fact_ids=top_fact_ids[:10],
                    moves=["interpretation", "counterevidence", "causal-guard"],
                    must_qualify=causal_guard,
                    priority=85,
                )
            )
        if relationships and request.detail == "deep":
            sections.append(
                SectionPlan(
                    section_id="relationships",
                    goal="Explain material relationships without overstating causality.",
                    title_hint="How the signals relate",
                    fact_ids=top_fact_ids[:8],
                    moves=["fact", "relationship", "interpretation"],
                    must_qualify=causal_guard,
                    priority=75,
                )
            )
        if include_limits:
            sections.append(
                SectionPlan(
                    section_id="limits",
                    goal="State material evidence gaps and prevent unsupported inference.",
                    title_hint=self.retriever.section_title("limits", seed + "limits"),
                    fact_ids=[],
                    moves=["limitation"],
                    must_qualify=True,
                    priority=60,
                )
            )
        if include_recommendations:
            sections.append(
                SectionPlan(
                    section_id="action",
                    goal="Offer targeted follow-up tied directly to the evidence and remaining uncertainty.",
                    title_hint=self.retriever.section_title("action", seed + "action"),
                    fact_ids=top_fact_ids[:6],
                    moves=["recommendation", "next-step"],
                    priority=50,
                )
            )

        order_index = {section_id: index for index, section_id in enumerate(strategy.section_order)}
        sections.sort(key=lambda section: (order_index.get(section.section_id, 999), -section.priority))

        rules = list(REGISTER_RULES[register])
        rules.extend(DOMAIN_RULES.get(domain, ()))
        rules.extend(strategy.notes)
        rules.append("Response strategy emphasis: " + ", ".join(strategy.emphasis) + ".")
        if causal_guard:
            rules.append("Do not convert association or timing into a causal claim.")
        if request.purpose == Purpose.report:
            rules.append("Narrative should interpret the table, not repeat every row.")
        if request.purpose == Purpose.account_for:
            rules.append("Consider counter-evidence and alternative explanations before the conclusion.")

        thesis = self._thesis_hint(request, facts)
        return DiscoursePlan(
            purpose=request.purpose,
            register=register,
            strategy_id=strategy.strategy_id,
            thesis=thesis,
            sections=sections,
            include_table=request.purpose in {Purpose.report, Purpose.comparison} and len(facts) >= 8,
            include_bullets=request.detail != "deep",
            include_limitations=include_limits,
            include_recommendations=include_recommendations,
            causal_guard_required=causal_guard,
            style_seed=seed,
            editorial_rules=rules,
        )

    @staticmethod
    def _thesis_hint(request: ResponseRequest, facts: list[Any]) -> str:
        if not facts:
            return "The response should be explicit that the available evidence is insufficient for a strong factual conclusion."
        subjects = Counter(fact.subject for fact in facts if fact.subject and fact.subject not in {"report", "result"})
        subject = subjects.most_common(1)[0][0] if subjects else request.context.entity_label or "the records"
        return f"Lead with the most material verified pattern concerning {subject}, then qualify the explanation to the available evidence."
