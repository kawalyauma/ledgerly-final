from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .models import Purpose, Register


@dataclass(frozen=True)
class LanguageMove:
    key: str
    family: str
    text: str
    purposes: frozenset[Purpose]
    registers: frozenset[Register]
    tags: frozenset[str]
    weight: float = 1.0


ALL_PURPOSES = frozenset(Purpose)
ALL_REGISTERS = frozenset(Register)


def _m(
    key: str,
    family: str,
    text: str,
    *,
    purposes: Iterable[Purpose] = ALL_PURPOSES,
    registers: Iterable[Register] = ALL_REGISTERS,
    tags: Iterable[str] = (),
    weight: float = 1.0,
) -> LanguageMove:
    return LanguageMove(
        key=key,
        family=family,
        text=text,
        purposes=frozenset(purposes),
        registers=frozenset(registers),
        tags=frozenset(tags),
        weight=weight,
    )


MOVES: tuple[LanguageMove, ...] = (
    _m("open-01", "opening", "The clearest pattern in the records is", tags=["evidence", "direct"]),
    _m("open-02", "opening", "What stands out most is", tags=["evidence", "executive"]),
    _m("open-03", "opening", "Looking across the relevant records", tags=["evidence", "cross-domain"]),
    _m("open-04", "opening", "The strongest signal is", tags=["evidence", "priority"]),
    _m("open-05", "opening", "The data becomes more informative when the records are considered together", tags=["evidence", "synthesis"]),
    _m("open-06", "opening", "The first point the records make clear is", tags=["evidence"]),
    _m("open-07", "opening", "The result is better understood by separating the main signals", tags=["analysis", "decomposition"]),
    _m("open-08", "opening", "The evidence is strongest around", tags=["analysis", "confidence"]),
    _m("open-09", "opening", "The immediate management signal is", registers=[Register.executive], tags=["management"]),
    _m("open-10", "opening", "The account activity is most clearly explained by", registers=[Register.finance], tags=["finance"]),
    _m("open-11", "opening", "The instructional evidence points first to", registers=[Register.teacher], tags=["academic", "instruction"]),
    _m("open-12", "opening", "A direct reading of the records shows", tags=["plain", "evidence"]),

    _m("fact-01", "fact", "The records show that", tags=["fact"]),
    _m("fact-02", "fact", "The verified figures indicate that", tags=["fact", "quantitative"]),
    _m("fact-03", "fact", "The source records place", tags=["fact"]),
    _m("fact-04", "fact", "The measured result is", tags=["fact", "quantitative"]),
    _m("fact-05", "fact", "The recorded position is", tags=["fact"]),
    _m("fact-06", "fact", "The period data shows", tags=["fact", "period"]),
    _m("fact-07", "fact", "The attendance history shows", tags=["attendance"]),
    _m("fact-08", "fact", "The assessment history shows", tags=["academic"]),
    _m("fact-09", "fact", "The transaction history shows", registers=[Register.finance], tags=["finance"]),
    _m("fact-10", "fact", "The staff record shows", tags=["staff"]),
    _m("fact-11", "fact", "The class-level evidence shows", tags=["class"]),
    _m("fact-12", "fact", "The operational record confirms", tags=["operations"]),

    _m("compare-01", "comparison", "Compared with", purposes=[Purpose.analysis, Purpose.account_for, Purpose.report, Purpose.comparison], tags=["comparison"]),
    _m("compare-02", "comparison", "Against the previous period", tags=["comparison", "period"]),
    _m("compare-03", "comparison", "Relative to the baseline", tags=["comparison", "baseline"]),
    _m("compare-04", "comparison", "Against the relevant peer group", tags=["comparison", "peer"]),
    _m("compare-05", "comparison", "When the two periods are aligned", tags=["comparison", "period"]),
    _m("compare-06", "comparison", "The difference becomes clearer when set against", tags=["comparison"]),
    _m("compare-07", "comparison", "The more informative comparison is", tags=["comparison", "analysis"]),
    _m("compare-08", "comparison", "The gap is most visible against", tags=["comparison", "gap"]),
    _m("compare-09", "comparison", "On a like-for-like comparison", tags=["comparison", "quality"]),
    _m("compare-10", "comparison", "The current value differs materially from", tags=["comparison", "quantitative"]),

    _m("trend-01", "trend", "Across the period", tags=["trend"]),
    _m("trend-02", "trend", "The sequence of records shows", tags=["trend", "sequence"]),
    _m("trend-03", "trend", "The direction of travel is", tags=["trend"]),
    _m("trend-04", "trend", "The latest result continues", tags=["trend", "continuation"]),
    _m("trend-05", "trend", "The latest result breaks with", tags=["trend", "reversal"]),
    _m("trend-06", "trend", "The decline is concentrated in", tags=["trend", "decrease"]),
    _m("trend-07", "trend", "The improvement is concentrated in", tags=["trend", "increase"]),
    _m("trend-08", "trend", "The longer view shows", tags=["trend", "longitudinal"]),
    _m("trend-09", "trend", "The short-term pattern differs from the longer trend", tags=["trend", "contrast"]),
    _m("trend-10", "trend", "The change is persistent rather than isolated", tags=["trend", "persistence"]),

    _m("interpret-01", "interpretation", "Taken together, these signals are consistent with", tags=["interpretation"]),
    _m("interpret-02", "interpretation", "The most defensible interpretation is", tags=["interpretation", "cautious"]),
    _m("interpret-03", "interpretation", "A cautious reading of the evidence is", tags=["interpretation", "cautious"]),
    _m("interpret-04", "interpretation", "The result appears to be driven more by", tags=["interpretation", "driver"]),
    _m("interpret-05", "interpretation", "The records support a narrower explanation around", tags=["interpretation", "specificity"]),
    _m("interpret-06", "interpretation", "The combined picture suggests", tags=["interpretation", "synthesis"]),
    _m("interpret-07", "interpretation", "The evidence weighs more heavily toward", tags=["interpretation", "weight"]),
    _m("interpret-08", "interpretation", "The practical reading is", tags=["interpretation", "practical"]),
    _m("interpret-09", "interpretation", "The pattern matters operationally because", tags=["interpretation", "operations"]),
    _m("interpret-10", "interpretation", "The evidence separates two issues", tags=["interpretation", "decomposition"]),

    _m("guard-01", "causal_guard", "This is an association in the available records, not proof of causation.", purposes=[Purpose.analysis, Purpose.account_for, Purpose.comparison], tags=["causal", "safety"]),
    _m("guard-02", "causal_guard", "The records show that these changes occurred together; they do not establish that one alone caused the other.", purposes=[Purpose.analysis, Purpose.account_for], tags=["causal", "safety"]),
    _m("guard-03", "causal_guard", "The evidence supports a contribution, not a single-cause explanation.", purposes=[Purpose.account_for], tags=["causal", "safety"]),
    _m("guard-04", "causal_guard", "The available records narrow the explanation without eliminating every alternative.", purposes=[Purpose.account_for], tags=["causal", "uncertainty"]),
    _m("guard-05", "causal_guard", "The timing strengthens the explanation but does not, by itself, prove cause.", purposes=[Purpose.account_for], tags=["causal", "temporal"]),
    _m("guard-06", "causal_guard", "The records identify a plausible contributor; they do not establish inevitability.", purposes=[Purpose.account_for], tags=["causal", "safety"]),
    _m("guard-07", "causal_guard", "The data supports a relationship, while the mechanism remains unverified.", purposes=[Purpose.analysis, Purpose.account_for], tags=["causal", "safety"]),
    _m("guard-08", "causal_guard", "The result may have several contributors; the data only supports those visible in the records.", purposes=[Purpose.account_for], tags=["causal", "multi-factor"]),

    _m("limit-01", "limitation", "The evidence is incomplete on", tags=["limitation"]),
    _m("limit-02", "limitation", "There is not enough verified data to determine", tags=["limitation"]),
    _m("limit-03", "limitation", "The records do not currently show", tags=["limitation"]),
    _m("limit-04", "limitation", "A remaining uncertainty is", tags=["limitation", "uncertainty"]),
    _m("limit-05", "limitation", "The conclusion should be qualified because", tags=["limitation", "qualification"]),
    _m("limit-06", "limitation", "The analysis cannot safely infer", tags=["limitation", "safety"]),
    _m("limit-07", "limitation", "A stronger conclusion would require", tags=["limitation", "evidence"]),
    _m("limit-08", "limitation", "The available evidence stops short of establishing", tags=["limitation", "causal"]),

    _m("counter-01", "counter", "Not every signal points in the same direction.", purposes=[Purpose.analysis, Purpose.account_for], tags=["counter"]),
    _m("counter-02", "counter", "One part of the record weakens a simple explanation", purposes=[Purpose.account_for], tags=["counter"]),
    _m("counter-03", "counter", "The evidence is mixed in one important respect", purposes=[Purpose.analysis, Purpose.account_for], tags=["counter"]),
    _m("counter-04", "counter", "A balancing observation is", purposes=[Purpose.analysis, Purpose.account_for], tags=["counter"]),
    _m("counter-05", "counter", "The broader record prevents an overly simple conclusion", purposes=[Purpose.account_for], tags=["counter"]),
    _m("counter-06", "counter", "An important exception is", purposes=[Purpose.analysis, Purpose.account_for], tags=["counter"]),

    _m("recommend-01", "recommendation", "A practical next step would be to", purposes=[Purpose.analysis, Purpose.account_for, Purpose.recommendation, Purpose.report], tags=["action"]),
    _m("recommend-02", "recommendation", "The evidence supports following up by", tags=["action", "evidence"]),
    _m("recommend-03", "recommendation", "The most targeted response would be to", tags=["action", "targeted"]),
    _m("recommend-04", "recommendation", "Before making a larger intervention", tags=["action", "cautious"]),
    _m("recommend-05", "recommendation", "The fastest way to reduce uncertainty is to", tags=["action", "uncertainty"]),
    _m("recommend-06", "recommendation", "A proportionate management response is to", registers=[Register.executive, Register.school_professional], tags=["action", "management"]),
    _m("recommend-07", "recommendation", "A useful instructional follow-up is to", registers=[Register.teacher], tags=["action", "instruction"]),
    _m("recommend-08", "recommendation", "A financially focused follow-up is to", registers=[Register.finance], tags=["action", "finance"]),

    _m("conclude-01", "conclusion", "Overall", tags=["conclusion"]),
    _m("conclude-02", "conclusion", "The most defensible conclusion is", tags=["conclusion", "cautious"]),
    _m("conclude-03", "conclusion", "The records support a clear but qualified conclusion", tags=["conclusion", "qualification"]),
    _m("conclude-04", "conclusion", "On balance", tags=["conclusion"]),
    _m("conclude-05", "conclusion", "The strongest conclusion the records support is", tags=["conclusion", "evidence"]),
    _m("conclude-06", "conclusion", "The practical conclusion is", tags=["conclusion", "practical"]),
    _m("conclude-07", "conclusion", "The evidence converges on", tags=["conclusion", "synthesis"]),
    _m("conclude-08", "conclusion", "The final picture is", tags=["conclusion"]),

    _m("transition-add-01", "transition_add", "In addition", tags=["transition"]),
    _m("transition-add-02", "transition_add", "Alongside this", tags=["transition"]),
    _m("transition-add-03", "transition_add", "A second signal is", tags=["transition"]),
    _m("transition-add-04", "transition_add", "Beyond the first finding", tags=["transition"]),
    _m("transition-contrast-01", "transition_contrast", "However", tags=["transition", "contrast"]),
    _m("transition-contrast-02", "transition_contrast", "That said", tags=["transition", "contrast"]),
    _m("transition-contrast-03", "transition_contrast", "At the same time", tags=["transition", "contrast"]),
    _m("transition-contrast-04", "transition_contrast", "This should be balanced against", tags=["transition", "contrast"]),
    _m("transition-effect-01", "transition_effect", "Operationally, this means", tags=["transition", "effect"]),
    _m("transition-effect-02", "transition_effect", "The practical effect is", tags=["transition", "effect"]),
    _m("transition-effect-03", "transition_effect", "The implication is", tags=["transition", "effect"]),
    _m("transition-effect-04", "transition_effect", "For the school, this means", tags=["transition", "effect"]),
)


SECTION_TITLES: dict[str, tuple[str, ...]] = {
    "overview": (
        "What the records show", "The central pattern", "What stands out", "Evidence overview",
        "The picture in the data", "Main finding", "What changed", "The strongest evidence",
    ),
    "comparison": (
        "How it compares", "Compared with the baseline", "Where the gap appears",
        "Current versus previous", "Benchmark comparison", "The meaningful difference",
    ),
    "explanation": (
        "What helps explain the result", "Evidence behind the outcome", "Observed contributors",
        "How the evidence fits together", "Factors supported by the records", "A measured explanation",
    ),
    "counter": (
        "Where the pattern is weaker", "Counter-evidence", "Important exceptions",
        "Why the conclusion needs qualification", "Balancing evidence",
    ),
    "limits": (
        "What the records cannot establish", "Evidence gaps", "What remains uncertain",
        "Where confidence is lower", "What still needs verification",
    ),
    "action": (
        "Practical follow-up", "What to do next", "Targeted next steps",
        "Recommended follow-up", "Where to focus next", "Follow-up priorities",
    ),
    "conclusion": (
        "Bottom line", "What the analysis supports", "The clearest conclusion",
        "Evidence-based conclusion", "What can be said with confidence",
    ),
}


REGISTER_RULES: dict[Register, tuple[str, ...]] = {
    Register.executive: (
        "Lead with material findings and business significance.",
        "Quantify meaningful differences.",
        "Keep caveats explicit but concise.",
        "Avoid academic jargon and unnecessary chronology.",
    ),
    Register.school_professional: (
        "Use natural school-management language.",
        "Refer to learners, classes, teachers and periods precisely.",
        "Avoid blame unless the records directly establish responsibility.",
        "Keep recommendations operational and proportionate.",
    ),
    Register.finance: (
        "Distinguish balances, flows, accruals, cash and reversals.",
        "Use amounts, accounts and periods precisely.",
        "Separate accounting movement from operational explanation.",
        "Never infer fraud, intent or misappropriation without direct evidence.",
    ),
    Register.teacher: (
        "Use practical instructional language.",
        "Connect findings to teaching, assessment and learner evidence carefully.",
        "Avoid ranking or blaming teachers from weak proxies.",
        "Prefer actionable classroom implications.",
    ),
    Register.plain: (
        "Use familiar words and short explanations.",
        "Explain technical terms once.",
        "Prefer direct sentences and concrete examples.",
    ),
    Register.technical: (
        "State methodology, denominators and data limitations.",
        "Preserve identifiers or field names only where they help verification.",
        "Separate observation, derivation and inference.",
    ),
}


BANNED_BOILERPLATE: tuple[str, ...] = (
    "it is important to note that",
    "it should be noted that",
    "based on the data provided",
    "based on the information provided",
    "this comprehensive analysis",
    "delve into",
    "multifaceted",
    "holistic approach",
    "leverage insights",
    "actionable insights",
    "as an ai",
    "i hope this helps",
    "in conclusion, it can be said that",
    "overall performance was good",
    "needs improvement",
)


DOMAIN_RULES: dict[str, tuple[str, ...]] = {
    "attendance": (
        "Separate present, absent, late and excused where available.",
        "State the denominator used for percentages.",
        "Do not treat excused absence as misconduct.",
    ),
    "academics": (
        "Compare equivalent assessments where possible.",
        "Separate subject-specific weakness from broad performance decline.",
        "Do not infer intelligence, effort or teacher quality from marks alone.",
    ),
    "fees": (
        "Separate billed, paid, outstanding and overdue amounts.",
        "Do not infer inability or unwillingness to pay from a balance.",
        "Account for reversals and allocation changes when available.",
    ),
    "finance": (
        "Distinguish period movement from closing balance.",
        "Explain material account drivers before minor ones.",
        "Do not infer fraud or wrongdoing from unusual movement alone.",
    ),
    "staff": (
        "Distinguish attendance, leave, workload and performance evidence.",
        "Do not infer competence from a single proxy.",
    ),
    "operations": (
        "Separate school-wide patterns from isolated exceptions.",
        "Prioritise issues by impact and evidence strength.",
    ),
}


def language_stats() -> dict[str, int]:
    families = {move.family for move in MOVES}
    return {
        "moves": len(MOVES),
        "families": len(families),
        "section_titles": sum(len(values) for values in SECTION_TITLES.values()),
        "registers": len(REGISTER_RULES),
        "domain_rule_groups": len(DOMAIN_RULES),
        "banned_boilerplate": len(BANNED_BOILERPLATE),
    }
