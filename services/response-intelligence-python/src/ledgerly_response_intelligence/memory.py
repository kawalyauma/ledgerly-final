from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable


WORD_RE = re.compile(r"[a-z0-9]+")


def fingerprint(text: str) -> str:
    normalized = " ".join(WORD_RE.findall(text.lower()))[:8000]
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def shingles(text: str, size: int = 4) -> set[tuple[str, ...]]:
    words = WORD_RE.findall(text.lower())
    if len(words) < size:
        return {tuple(words)} if words else set()
    return {tuple(words[index : index + size]) for index in range(len(words) - size + 1)}


def similarity(left: str, right: str, size: int = 4) -> float:
    a, b = shingles(left, size), shingles(right, size)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def max_recent_similarity(text: str, recent: Iterable[str]) -> float:
    return max((similarity(text, item) for item in recent if item.strip()), default=0.0)
