from __future__ import annotations

import re
import statistics
from collections import Counter
from typing import Any

from .library import BANNED_BOILERPLATE
from .memory import max_recent_similarity
from .models import (
    EvidenceBundle,
    Purpose,
    QualityDimension,
    QualityReport,
    ResponseRequest,
)


NUMBER_RE = re.compile(r"(?<![\w])(?:UGX\s*)?[-+]?\d[\d,]*(?:\.\d+)?%?", re.I)
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")
CAUSAL_RE = re.compile(
    r"\b(caused?|because of|resulted? in|led to|responsible for|due to|therefore caused|made .* fail)\b",
    re.I,
)
QUALIFIER_RE = re.compile(
    r"\b(association|associated|contributor|contributed|consistent with|does not establish|not proof|"
    r"cannot establish|may|appears|suggests|plausible|available records)\b",
    re.I,
)


def _normalize_number(value: Any) -> set[str]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return set()
    values = {str(value), f"{value:g}"}
    if isinstance(value, int):
        values.add(f"{value:,}")
    return values


def evidence_numbers(evidence: EvidenceBundle) -> set[str]:
    numbers: set[str] = set()
    for fact in evidence.facts:
        numbers.update(_normalize_number(fact.value))
        if fact.unit == "%" and isinstance(fact.value, (int, float)):
            numbers.add(f"{fact.value:g}%")
    return {item.replace(",", "").replace("UGX", "").strip() for item in numbers if item}


def text_numbers(text: str) -> set[str]:
    found: set[str] = set()
    for match in NUMBER_RE.findall(text):
        normalized = match.upper().replace("UGX", "").replace(",", "").strip()
        found.add(normalized)
    return found


def _dimension(score: float, *notes: str) -> QualityDimension:
    return QualityDimension(score=max(0.0, min(1.0, score)), notes=[note for note in notes if note])


def _repeated_sentence_starts(text: str) -> tuple[int, list[str]]:
    sentences = [item.strip() for item in SENTENCE_RE.split(text) if len(item.strip()) > 8]
    starts = [" ".join(re.findall(r"[A-Za-z]+", sentence.lower())[:3]) for sentence in sentences]
    counts = Counter(start for start in starts if start)
    repeated = [start for start, count in counts.items() if count >= 3]
    return sum(counts[start] - 2 for start in repeated), repeated


def _readability(text: str) -> QualityDimension:
    sentences = [item.strip() for item in SENTENCE_RE.split(text) if item.strip()]
    if not sentences:
        return _dimension(0.0, "No readable sentences were produced.")
    lengths = [len(re.findall(r"\b\w+\b", sentence)) for sentence in sentences]
    median = statistics.median(lengths)
    very_long = sum(length > 38 for length in lengths)
    very_short = sum(length < 4 for length in lengths)
    score = 1.0
    if median > 30:
        score -= 0.2
    if very_long:
        score -= min(0.35, very_long * 0.07)
    if very_short > len(sentences) // 3:
        score -= 0.15
    notes: list[str] = []
    if very_long:
        notes.append(f"{very_long} sentences are unusually long.")
    if median > 30:
        notes.append("Median sentence length is too high.")
    return _dimension(score, *notes)


def _grounding(text: str, evidence: EvidenceBundle) -> QualityDimension:
    allowed = evidence_numbers(evidence)
    used = text_numbers(text)
    unsupported = sorted(number for number in used if number not in allowed and not number.startswith("0."))
    # Harmless numbered headings such as "1." are not usually factual claims.
    unsupported = [number for number in unsupported if not (number.isdigit() and 1 <= int(number) <= 12)]
    if not used:
        return _dimension(0.9 if evidence.facts else 1.0)
    ratio = 1.0 - (len(unsupported) / max(len(used), 1))
    notes = [f"Unsupported numeric claim detected: {number}" for number in unsupported[:8]]
    return _dimension(ratio, *notes)


def _completeness(text: str, evidence: EvidenceBundle, request: ResponseRequest) -> QualityDimension:
    if not evidence.facts:
        mentions_gap = bool(re.search(r"\b(insufficient|not enough|no verified|missing|cannot determine|records do not)\b", text, re.I))
        return _dimension(1.0 if mentions_gap else 0.4, "Evidence is empty; the answer must make that limitation explicit." if not mentions_gap else "")
    top = evidence.facts[: min(12, len(evidence.facts))]
    hits = 0
    lower = text.lower()
    for fact in top:
        candidates = [str(fact.subject).lower(), str(fact.predicate).lower()]
        if isinstance(fact.value, (str, int, float)):
            candidates.append(str(fact.value).lower().replace(",", ""))
        if any(candidate and candidate in lower.replace(",", "") for candidate in candidates):
            hits += 1
    baseline = hits / max(len(top), 1)
    if request.detail == "brief":
        baseline = min(1.0, baseline + 0.2)
    return _dimension(baseline)


def _naturalness(text: str) -> QualityDimension:
    lower = text.lower()
    banned = [phrase for phrase in BANNED_BOILERPLATE if phrase in lower]
    repeated_count, starts = _repeated_sentence_starts(text)
    score = 1.0 - min(0.55, len(banned) * 0.12) - min(0.35, repeated_count * 0.08)
    notes = [f"Model-like boilerplate: {phrase}" for phrase in banned[:5]]
    if starts:
        notes.append("Repeated sentence openings: " + ", ".join(starts[:4]))
    return _dimension(score, *notes)


def _variation(text: str, request: ResponseRequest) -> QualityDimension:
    similarity = max_recent_similarity(text, request.context.recent_responses)
    score = 1.0
    notes: list[str] = []
    if similarity > 0.55:
        score = max(0.0, 1.0 - similarity)
        notes.append(f"Response is too similar to recent output ({similarity:.0%} 4-gram overlap).")
    elif similarity > 0.35:
        score = 0.72
        notes.append(f"Response resembles recent output ({similarity:.0%} 4-gram overlap).")
    return _dimension(score, *notes)


def _causality(text: str, evidence: EvidenceBundle, request: ResponseRequest) -> QualityDimension:
    causal_claim = bool(CAUSAL_RE.search(text))
    strong_causal_evidence = any(
        relationship.causal and relationship.confidence.value in {"direct", "strong"}
        for relationship in evidence.relationships
    )
    qualified = bool(QUALIFIER_RE.search(text))
    if causal_claim and not strong_causal_evidence and not qualified:
        return _dimension(
            0.15,
            "The draft makes a causal claim that is not supported by strong causal evidence.",
        )
    if request.purpose == Purpose.account_for and not strong_causal_evidence and not qualified:
        return _dimension(
            0.55,
            "Account-for responses should explicitly distinguish contributors from proven causes.",
        )
    return _dimension(1.0)


def _professionalism(text: str) -> QualityDimension:
    notes: list[str] = []
    score = 1.0
    if re.search(r"\b(obviously|clearly lazy|bad parent|bad teacher|stupid|hopeless|definitely their fault)\b", text, re.I):
        score -= 0.7
        notes.append("Loaded or blaming language is not appropriate.")
    if text.count("!") >= 3:
        score -= 0.15
        notes.append("Excessive exclamation marks reduce professional tone.")
    if re.search(r"\bI think\b|\bI feel\b", text, re.I):
        score -= 0.1
        notes.append("Prefer evidence-based statements to first-person opinion.")
    return _dimension(score, *notes)


class ResponseCritic:
    def evaluate(self, text: str, request: ResponseRequest, evidence: EvidenceBundle) -> QualityReport:
        dimensions = {
            "grounding": _grounding(text, evidence),
            "completeness": _completeness(text, evidence, request),
            "readability": _readability(text),
            "naturalness": _naturalness(text),
            "variation": _variation(text, request),
            "causality": _causality(text, evidence, request),
            "professionalism": _professionalism(text),
        }
        weights = {
            "grounding": 0.24,
            "completeness": 0.16,
            "readability": 0.12,
            "naturalness": 0.14,
            "variation": 0.10,
            "causality": 0.14,
            "professionalism": 0.10,
        }
        overall = sum(dimensions[name].score * weights[name] for name in weights)
        instructions: list[str] = []
        for name, dimension in dimensions.items():
            if dimension.score < 0.72:
                instructions.extend(dimension.notes or [f"Improve {name}."])
        revision_required = (
            overall < 0.82
            or dimensions["grounding"].score < 0.9
            or dimensions["causality"].score < 0.85
            or dimensions["professionalism"].score < 0.8
        )
        return QualityReport(
            **dimensions,
            overall=max(0.0, min(1.0, overall)),
            revision_required=revision_required,
            revision_instructions=instructions[:20],
        )
