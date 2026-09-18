from __future__ import annotations

import hashlib
import math
import re
import statistics
from collections import defaultdict
from typing import Iterable

from .models import (
    Confidence,
    EvidenceBundle,
    Fact,
    Insight,
    InsightKind,
    ReasoningResult,
    ResponseRequest,
)


PERIOD_CURRENT = re.compile(r"\b(current|this|latest|present)\b", re.I)
PERIOD_PREVIOUS = re.compile(r"\b(previous|last|prior|earlier)\b", re.I)
BASE_WORDS = re.compile(r"\b(current|this|latest|present|previous|last|prior|earlier)\b", re.I)


def _id(*parts: object) -> str:
    raw = "|".join(str(part) for part in parts)
    return "ins_" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _numeric(fact: Fact) -> bool:
    return isinstance(fact.value, (int, float)) and not isinstance(fact.value, bool)


def _base_predicate(predicate: str) -> str:
    return " ".join(BASE_WORDS.sub("", predicate.lower()).split())


def _fmt(value: float, unit: str | None) -> str:
    rendered = f"{value:,.2f}".rstrip("0").rstrip(".")
    return rendered + ("%" if unit == "%" else f" {unit}" if unit and unit != "minor" else " minor units" if unit == "minor" else "")


def _confidence_for_pair(left: Fact, right: Fact) -> Confidence:
    direct = left.confidence == Confidence.direct and right.confidence == Confidence.direct
    return Confidence.strong if direct else Confidence.moderate


class ReasoningEngine:
    """Derive bounded, auditable insights from verified facts.

    This engine never creates causal claims. It only derives arithmetic comparisons,
    distributional exceptions and evidence gaps that can be traced back to fact IDs.
    """

    def derive(self, request: ResponseRequest, evidence: EvidenceBundle) -> ReasoningResult:
        insights: list[Insight] = []
        insights.extend(self._current_previous_changes(evidence.facts))
        insights.extend(self._period_changes(evidence.facts))
        insights.extend(self._distribution_outliers(evidence.facts))
        insights.extend(self._relationships(evidence))
        gaps = [item.description for item in evidence.limitations if item.description]
        for gap in gaps[:20]:
            insights.append(
                Insight(
                    insight_id=_id("gap", gap),
                    kind=InsightKind.evidence_gap,
                    statement=gap,
                    confidence=Confidence.direct,
                    causal=False,
                    tags=["gap"],
                )
            )

        # Remove semantically duplicate statements while preserving strongest first.
        by_statement: dict[str, Insight] = {}
        rank = {
            Confidence.direct: 5,
            Confidence.strong: 4,
            Confidence.moderate: 3,
            Confidence.limited: 2,
            Confidence.conflicting: 1,
            Confidence.unknown: 0,
        }
        for insight in insights:
            key = re.sub(r"\s+", " ", insight.statement.strip().lower())
            existing = by_statement.get(key)
            if not existing or rank[insight.confidence] > rank[existing.confidence]:
                by_statement[key] = insight
        unique = list(by_statement.values())

        def score(item: Insight) -> tuple[float, int]:
            magnitude = abs(item.magnitude or 0.0)
            priority = {
                InsightKind.change: 6,
                InsightKind.comparison: 5,
                InsightKind.outlier: 4,
                InsightKind.relationship: 3,
                InsightKind.evidence_gap: 2,
                InsightKind.observation: 1,
                InsightKind.concentration: 1,
            }[item.kind]
            return (priority + min(magnitude / 10.0, 3.0), rank[item.confidence])

        unique.sort(key=score, reverse=True)
        cautions: list[str] = []
        if request.purpose.value == "account-for" and not any(
            relationship.causal and relationship.confidence in {Confidence.direct, Confidence.strong}
            for relationship in evidence.relationships
        ):
            cautions.append(
                "No strong causal relationship is recorded; contributors must be described as associations or plausible explanations."
            )
        if any(fact.unit == "minor" for fact in evidence.facts):
            cautions.append(
                "Values marked as minor units must not be silently converted to human currency without explicit scale metadata."
            )
        if not evidence.facts:
            cautions.append("No verified facts are available for substantive analysis.")

        return ReasoningResult(
            insights=unique[:100],
            strongest_insight_ids=[item.insight_id for item in unique[:12]],
            cautions=cautions,
            data_gaps=gaps[:50],
            metadata={
                "factCount": len(evidence.facts),
                "relationshipCount": len(evidence.relationships),
                "derivedInsightCount": len(unique),
                "causalClaimsDerived": 0,
            },
        )

    def _current_previous_changes(self, facts: Iterable[Fact]) -> list[Insight]:
        groups: dict[tuple[str, str], dict[str, Fact]] = defaultdict(dict)
        for fact in facts:
            if not _numeric(fact):
                continue
            predicate = fact.predicate
            base = _base_predicate(predicate)
            if not base:
                continue
            if PERIOD_CURRENT.search(predicate):
                groups[(fact.subject, base)]["current"] = fact
            elif PERIOD_PREVIOUS.search(predicate):
                groups[(fact.subject, base)]["previous"] = fact

        result: list[Insight] = []
        for (subject, base), pair in groups.items():
            current, previous = pair.get("current"), pair.get("previous")
            if not current or not previous or current.unit != previous.unit:
                continue
            delta = float(current.value) - float(previous.value)
            direction = "increased" if delta > 0 else "decreased" if delta < 0 else "was unchanged"
            statement = (
                f"{subject}'s {base} {direction} from {_fmt(float(previous.value), previous.unit)} "
                f"to {_fmt(float(current.value), current.unit)}"
            )
            if delta:
                statement += f", a change of {_fmt(abs(delta), current.unit)}."
            else:
                statement += "."
            result.append(
                Insight(
                    insight_id=_id(subject, base, current.fact_id, previous.fact_id),
                    kind=InsightKind.change,
                    statement=statement,
                    fact_ids=[previous.fact_id, current.fact_id],
                    magnitude=delta,
                    unit=current.unit,
                    confidence=_confidence_for_pair(previous, current),
                    causal=False,
                    tags=["current-vs-previous", base],
                )
            )
        return result

    def _period_changes(self, facts: Iterable[Fact]) -> list[Insight]:
        groups: dict[tuple[str, str, str | None], list[Fact]] = defaultdict(list)
        for fact in facts:
            if _numeric(fact) and fact.period:
                groups[(fact.subject, fact.predicate.lower(), fact.unit)].append(fact)
        result: list[Insight] = []
        for (subject, predicate, unit), items in groups.items():
            if len(items) != 2:
                continue
            left, right = items[0], items[1]
            if left.value == right.value:
                continue
            delta = float(right.value) - float(left.value)
            statement = (
                f"For {subject}, {predicate} differs by {_fmt(abs(delta), unit)} between "
                f"{left.period} ({_fmt(float(left.value), unit)}) and {right.period} ({_fmt(float(right.value), unit)})."
            )
            result.append(
                Insight(
                    insight_id=_id(subject, predicate, left.fact_id, right.fact_id),
                    kind=InsightKind.comparison,
                    statement=statement,
                    fact_ids=[left.fact_id, right.fact_id],
                    magnitude=delta,
                    unit=unit,
                    confidence=_confidence_for_pair(left, right),
                    causal=False,
                    tags=["period-comparison", predicate],
                )
            )
        return result

    def _distribution_outliers(self, facts: Iterable[Fact]) -> list[Insight]:
        groups: dict[tuple[str, str | None], list[Fact]] = defaultdict(list)
        for fact in facts:
            if _numeric(fact):
                groups[(fact.predicate.lower(), fact.unit)].append(fact)
        result: list[Insight] = []
        for (predicate, unit), items in groups.items():
            if len(items) < 5:
                continue
            values = [float(item.value) for item in items]
            mean = statistics.fmean(values)
            stdev = statistics.pstdev(values)
            if stdev <= 0:
                continue
            for item in items:
                z = (float(item.value) - mean) / stdev
                if abs(z) < 1.75:
                    continue
                direction = "above" if z > 0 else "below"
                statement = (
                    f"{item.subject}'s {predicate} ({_fmt(float(item.value), unit)}) is materially {direction} "
                    f"the group mean of {_fmt(mean, unit)}."
                )
                result.append(
                    Insight(
                        insight_id=_id("outlier", item.fact_id, predicate),
                        kind=InsightKind.outlier,
                        statement=statement,
                        fact_ids=[item.fact_id],
                        magnitude=z,
                        unit="standard deviations",
                        confidence=Confidence.moderate,
                        causal=False,
                        tags=["distribution", "outlier", predicate],
                    )
                )
        return result

    def _relationships(self, evidence: EvidenceBundle) -> list[Insight]:
        result: list[Insight] = []
        for relationship in evidence.relationships:
            if not relationship.description:
                continue
            result.append(
                Insight(
                    insight_id=_id("relationship", relationship.description),
                    kind=InsightKind.relationship,
                    statement=relationship.description,
                    fact_ids=[item for item in [relationship.left_fact_id, relationship.right_fact_id] if item],
                    confidence=relationship.confidence,
                    causal=relationship.causal,
                    tags=["relationship", relationship.relation],
                )
            )
        return result
