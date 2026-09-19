from __future__ import annotations

from dataclasses import dataclass
from random import Random

from .models import Purpose
from .retrieval import stable_seed


@dataclass(frozen=True)
class ResponseStrategy:
    strategy_id: str
    purposes: frozenset[Purpose]
    section_order: tuple[str, ...]
    emphasis: tuple[str, ...]
    notes: tuple[str, ...]


STRATEGIES: tuple[ResponseStrategy, ...] = (
    ResponseStrategy(
        "evidence-first",
        frozenset({Purpose.analysis, Purpose.report, Purpose.summary}),
        ("overview", "comparison", "relationships", "limits", "action"),
        ("direct evidence", "material comparisons", "bounded implications"),
        ("Open with the strongest observed fact.", "Move from observation to interpretation."),
    ),
    ResponseStrategy(
        "contrast-first",
        frozenset({Purpose.analysis, Purpose.comparison, Purpose.report}),
        ("comparison", "overview", "relationships", "limits", "action"),
        ("difference", "baseline", "magnitude"),
        ("Lead with the contrast that best answers the request.",),
    ),
    ResponseStrategy(
        "trend-first",
        frozenset({Purpose.analysis, Purpose.report, Purpose.comparison}),
        ("comparison", "overview", "limits", "action"),
        ("direction", "period movement", "persistence"),
        ("Frame the result through change over time rather than a static snapshot.",),
    ),
    ResponseStrategy(
        "exception-first",
        frozenset({Purpose.analysis, Purpose.report, Purpose.warning}),
        ("overview", "comparison", "limits", "action"),
        ("exceptions", "outliers", "operational priority"),
        ("Lead with material exceptions and explain the wider context afterwards.",),
    ),
    ResponseStrategy(
        "management-first",
        frozenset({Purpose.analysis, Purpose.report, Purpose.recommendation, Purpose.warning}),
        ("overview", "action", "comparison", "limits"),
        ("decision relevance", "priority", "follow-up"),
        ("Make the management implication visible early without overstating the evidence.",),
    ),
    ResponseStrategy(
        "diagnostic",
        frozenset({Purpose.analysis, Purpose.account_for}),
        ("overview", "explanation", "comparison", "relationships", "limits", "action"),
        ("contributors", "evidence strength", "gaps"),
        ("Separate the observed outcome from the factors that may help explain it.",),
    ),
    ResponseStrategy(
        "competing-explanations",
        frozenset({Purpose.account_for}),
        ("overview", "explanation", "relationships", "comparison", "limits", "action"),
        ("strongest explanation", "counter-evidence", "alternatives"),
        ("Do not settle on the first plausible explanation.", "State what weakens a simple causal story."),
    ),
    ResponseStrategy(
        "chronological-explanation",
        frozenset({Purpose.account_for, Purpose.analysis}),
        ("comparison", "overview", "explanation", "limits", "action"),
        ("sequence", "before-and-after", "timing"),
        ("Use chronology only where periods are actually recorded.",),
    ),
    ResponseStrategy(
        "baseline-explanation",
        frozenset({Purpose.account_for, Purpose.comparison}),
        ("comparison", "explanation", "overview", "limits", "action"),
        ("baseline", "deviation", "contributors"),
        ("Explain the outcome in relation to a relevant baseline or previous period.",),
    ),
    ResponseStrategy(
        "counterevidence-led",
        frozenset({Purpose.account_for, Purpose.analysis}),
        ("overview", "relationships", "explanation", "limits", "action"),
        ("mixed evidence", "exceptions", "qualification"),
        ("Make contradictions visible before reaching a conclusion.",),
    ),
    ResponseStrategy(
        "executive-brief",
        frozenset({Purpose.summary, Purpose.report, Purpose.analysis}),
        ("overview", "comparison", "action", "limits"),
        ("materiality", "decision", "brevity"),
        ("Keep secondary evidence behind the main conclusion.",),
    ),
    ResponseStrategy(
        "narrative-report",
        frozenset({Purpose.report, Purpose.analysis}),
        ("overview", "comparison", "relationships", "action", "limits"),
        ("coherent narrative", "supporting detail", "implication"),
        ("Write as a connected report rather than a list of metrics.",),
    ),
    ResponseStrategy(
        "audit-style",
        frozenset({Purpose.report, Purpose.warning, Purpose.analysis}),
        ("overview", "comparison", "limits", "action"),
        ("traceability", "exceptions", "control"),
        ("Separate verified observation, risk implication and recommended control.",),
    ),
    ResponseStrategy(
        "recommendation-led",
        frozenset({Purpose.recommendation, Purpose.warning}),
        ("overview", "action", "limits", "comparison"),
        ("action", "evidence basis", "risk"),
        ("Tie every recommendation back to a verified signal.",),
    ),
    ResponseStrategy(
        "plain-explanation",
        frozenset({Purpose.general, Purpose.summary, Purpose.account_for}),
        ("overview", "explanation", "limits"),
        ("clarity", "plain language", "bounded conclusion"),
        ("Prefer direct explanation over formal report structure.",),
    ),
    ResponseStrategy(
        "technical-evidence",
        frozenset({Purpose.analysis, Purpose.report, Purpose.comparison}),
        ("overview", "comparison", "relationships", "limits"),
        ("method", "denominators", "traceability"),
        ("Expose calculation logic and evidence limits where they affect interpretation.",),
    ),
)


def available_strategies(purpose: Purpose) -> list[ResponseStrategy]:
    return [strategy for strategy in STRATEGIES if purpose in strategy.purposes]


def select_strategy(
    purpose: Purpose,
    *,
    seed: str,
    has_comparison: bool,
    has_relationships: bool,
    has_limits: bool,
    deep: bool,
) -> ResponseStrategy:
    candidates = available_strategies(purpose) or available_strategies(Purpose.analysis)
    weighted: list[ResponseStrategy] = []
    for strategy in candidates:
        weight = 2
        if has_comparison and strategy.section_order and strategy.section_order[0] == "comparison":
            weight += 3
        if has_relationships and "relationships" in strategy.section_order:
            weight += 2
        if has_limits and "limits" in strategy.section_order:
            weight += 1
        if deep and len(strategy.section_order) >= 5:
            weight += 2
        weighted.extend([strategy] * weight)
    return Random(stable_seed(seed, purpose.value, "strategy")).choice(weighted)
