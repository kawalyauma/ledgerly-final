from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from typing import Any

from .models import Confidence, EvidenceBundle, EvidenceSource, Fact, Limitation, Relationship


_ID_KEYS = ("studentId", "staffId", "guardianId", "accountId", "classId", "subjectId", "id")
_NAME_KEYS = ("studentName", "staffName", "guardianName", "accountName", "name", "label", "title")
_PERIOD_KEYS = ("term", "period", "academicYear", "date", "asOf", "from", "to")


def _fingerprint(value: Any) -> str:
    data = json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha1(data.encode("utf-8")).hexdigest()[:12]


def _human_key(key: str) -> str:
    key = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", key)
    return key.replace("_", " ").replace("-", " ").strip()


def _subject_for(row: dict[str, Any]) -> str:
    name = next((str(row[k]).strip() for k in _NAME_KEYS if row.get(k) not in (None, "")), "")
    identifier = next((str(row[k]).strip() for k in _ID_KEYS if row.get(k) not in (None, "")), "")
    return name or identifier or "record"


def _period_for(row: dict[str, Any]) -> str | None:
    parts = [str(row[k]).strip() for k in _PERIOD_KEYS if row.get(k) not in (None, "")]
    return " · ".join(parts[:3]) or None


def _scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _unit_for(key: str, value: Any) -> str | None:
    low = key.lower()
    if low.endswith("minor"):
        return "minor"
    if "percent" in low or low.endswith("rate") or low.endswith("pct"):
        return "%"
    if "amount" in low or "balance" in low or "total" in low:
        if isinstance(value, (int, float)):
            return None
    return None


def object_rows(value: Any, *, max_depth: int = 6, max_rows: int = 2000) -> list[dict[str, Any]]:
    best: list[dict[str, Any]] = []
    seen: set[int] = set()

    def visit(node: Any, depth: int) -> None:
        nonlocal best
        if depth > max_depth:
            return
        if isinstance(node, (dict, list)):
            marker = id(node)
            if marker in seen:
                return
            seen.add(marker)
        if isinstance(node, list):
            rows = [item for item in node if isinstance(item, dict)]
            if len(rows) > len(best):
                best = rows[:max_rows]
            for item in node[:50]:
                visit(item, depth + 1)
        elif isinstance(node, dict):
            for child in node.values():
                visit(child, depth + 1)

    visit(value, 0)
    return best


def normalize_semantic_payload(payload: dict[str, Any]) -> EvidenceBundle:
    facts: list[Fact] = []
    relationships: list[Relationship] = []
    limitations: list[Limitation] = []
    sources: list[EvidenceSource] = []

    missing = payload.get("missingData") or payload.get("limitations") or payload.get("unanswered") or []
    if isinstance(missing, list):
        for item in missing:
            description = str(item).strip()
            if description:
                limitations.append(Limitation(description=description))

    source_items = payload.get("sources")
    if isinstance(source_items, list):
        for item in source_items[:100]:
            if not isinstance(item, dict):
                continue
            source = EvidenceSource(
                source_id=str(item.get("sourceId") or item.get("tool") or item.get("id") or ""),
                source_type=str(item.get("sourceType") or "ledgerly"),
                module=str(item.get("module") or ""),
                record_type=str(item.get("recordType") or ""),
                record_id=str(item.get("recordId") or ""),
                label=str(item.get("label") or item.get("purpose") or ""),
                as_of=str(item["asOf"]) if item.get("asOf") else None,
                metadata={k: v for k, v in item.items() if k not in {"result"}},
            )
            sources.append(source)

    rows = object_rows(payload)
    if not rows and isinstance(payload.get("rows"), list):
        rows = [row for row in payload["rows"] if isinstance(row, dict)][:2000]

    for row_index, row in enumerate(rows):
        subject = _subject_for(row)
        period = _period_for(row)
        row_source = EvidenceSource(
            source_id=f"row:{row_index}",
            source_type="ledgerly-row",
            label=subject,
            metadata={key: row.get(key) for key in _ID_KEYS if row.get(key) is not None},
        )
        for key, value in row.items():
            if not _scalar(value) or key in _ID_KEYS or key in _NAME_KEYS:
                continue
            if value in (None, ""):
                continue
            fact_id = f"f_{_fingerprint([row_index, key, value, period])}"
            facts.append(
                Fact(
                    fact_id=fact_id,
                    subject=subject,
                    predicate=_human_key(key),
                    value=value,
                    unit=_unit_for(key, value),
                    period=period,
                    confidence=Confidence.direct,
                    sources=[row_source],
                    tags=[_human_key(key).lower()],
                )
            )

    summary = payload.get("summary")
    if isinstance(summary, dict):
        for key, value in summary.items():
            if _scalar(value) and value not in (None, ""):
                facts.append(
                    Fact(
                        fact_id=f"f_{_fingerprint(['summary', key, value])}",
                        subject="report",
                        predicate=_human_key(key),
                        value=value,
                        confidence=Confidence.direct,
                        sources=sources[:5],
                        tags=["summary", _human_key(key).lower()],
                    )
                )

    raw_relationships = payload.get("relationships")
    if isinstance(raw_relationships, list):
        for item in raw_relationships[:100]:
            if isinstance(item, str):
                relationships.append(Relationship(relation="observed", description=item))
            elif isinstance(item, dict):
                relationships.append(
                    Relationship(
                        left_fact_id=str(item.get("leftFactId") or ""),
                        relation=str(item.get("relation") or "observed"),
                        right_fact_id=str(item.get("rightFactId") or ""),
                        description=str(item.get("description") or item.get("analysis") or ""),
                        confidence=Confidence(str(item.get("confidence") or "moderate"))
                        if str(item.get("confidence") or "moderate") in Confidence._value2member_map_
                        else Confidence.moderate,
                        causal=bool(item.get("causal", False)),
                    )
                )

    if not facts:
        scalar_payload = {k: v for k, v in payload.items() if _scalar(v) and v not in (None, "")}
        for key, value in scalar_payload.items():
            facts.append(
                Fact(
                    fact_id=f"f_{_fingerprint(['root', key, value])}",
                    subject="result",
                    predicate=_human_key(key),
                    value=value,
                    confidence=Confidence.direct,
                    sources=sources[:5],
                    tags=[_human_key(key).lower()],
                )
            )

    return EvidenceBundle(
        facts=facts[:5000],
        relationships=relationships,
        limitations=limitations,
        raw=payload,
        source_summary=sources,
    )


def merge_evidence(primary: EvidenceBundle | None, payload: dict[str, Any]) -> EvidenceBundle:
    derived = normalize_semantic_payload(payload)
    if primary is None:
        return derived
    by_id: dict[str, Fact] = {}
    for fact in [*primary.facts, *derived.facts]:
        key = fact.fact_id or f"f_{_fingerprint(fact.model_dump())}"
        by_id.setdefault(key, fact)
    return EvidenceBundle(
        facts=list(by_id.values())[:5000],
        relationships=[*primary.relationships, *derived.relationships][:500],
        limitations=[*primary.limitations, *derived.limitations][:200],
        raw=primary.raw if primary.raw is not None else derived.raw,
        source_summary=[*primary.source_summary, *derived.source_summary][:200],
    )


def numeric_facts(facts: Iterable[Fact]) -> list[Fact]:
    return [fact for fact in facts if isinstance(fact.value, (int, float)) and not isinstance(fact.value, bool)]
