from __future__ import annotations

import json
import re
from typing import Any


SECRET_KEYS = re.compile(r"(api.?key|secret|token|password|authorization|cookie|credential)", re.I)
PERSON_KEYS = re.compile(r"(student.?name|staff.?name|guardian.?name|teacher.?name|employee.?name|entity.?label)", re.I)
CONTACT_KEYS = re.compile(r"(email|phone|mobile|telephone)", re.I)
ID_KEYS = re.compile(r"(^id$|_id$|Id$|student.?id|staff.?id|guardian.?id|account.?id)", re.I)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(r"(?<!\d)(?:\+?256|0)?7\d{8}(?!\d)")


def redact_text(text: str, entity_label: str = "") -> str:
    value = text
    if entity_label.strip():
        value = re.sub(re.escape(entity_label.strip()), "<PERSON>", value, flags=re.I)
    value = EMAIL_RE.sub("<EMAIL>", value)
    value = PHONE_RE.sub("<PHONE>", value)
    return value


def redact_value(value: Any, *, key: str = "", entity_label: str = "", depth: int = 0) -> Any:
    if depth > 8:
        return "<TRUNCATED>"
    if SECRET_KEYS.search(key):
        return "<SECRET>"
    if PERSON_KEYS.search(key):
        return "<PERSON>"
    if CONTACT_KEYS.search(key):
        return "<CONTACT>"
    if ID_KEYS.search(key):
        return "<ID>"
    if isinstance(value, dict):
        return {
            str(child_key): redact_value(child, key=str(child_key), entity_label=entity_label, depth=depth + 1)
            for child_key, child in value.items()
        }
    if isinstance(value, list):
        return [redact_value(item, key=key, entity_label=entity_label, depth=depth + 1) for item in value[:500]]
    if isinstance(value, str):
        return redact_text(value, entity_label)
    return value


def sanitize_training_example(
    request: str,
    semantic_payload: dict[str, Any],
    response_text: str,
    *,
    entity_label: str = "",
    mode: str = "redacted",
) -> tuple[str, dict[str, Any], str]:
    if mode == "full":
        return request, semantic_payload, response_text
    redacted_request = redact_text(request, entity_label)
    redacted_response = redact_text(response_text, entity_label)
    if mode == "structure-only":
        payload = {
            "keys": sorted(str(key) for key in semantic_payload.keys()),
            "shape": _shape(semantic_payload),
        }
    else:
        payload = redact_value(semantic_payload, entity_label=entity_label)
    return redacted_request, payload, redacted_response


def _shape(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "..."
    if isinstance(value, dict):
        return {str(key): _shape(child, depth + 1) for key, child in value.items()}
    if isinstance(value, list):
        return {"type": "list", "count": len(value), "sample": _shape(value[:1], depth + 1)}
    if value is None:
        return "null"
    return type(value).__name__


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
