from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass
from random import Random

from .library import LanguageMove, MOVES, SECTION_TITLES
from .models import Purpose, Register


TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokens(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def stable_seed(*parts: str) -> int:
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=False)


@dataclass(frozen=True)
class RankedMove:
    move: LanguageMove
    score: float


class LanguageRetriever:
    def __init__(self, moves: tuple[LanguageMove, ...] = MOVES) -> None:
        self.moves = moves
        docs = [set(tokens(move.text + " " + " ".join(move.tags))) for move in moves]
        df: Counter[str] = Counter()
        for doc in docs:
            df.update(doc)
        n = max(len(docs), 1)
        self.idf = {term: math.log((n + 1) / (freq + 1)) + 1.0 for term, freq in df.items()}

    def rank(
        self,
        *,
        family: str,
        purpose: Purpose,
        register: Register,
        query: str,
        tags: set[str] | None = None,
        recent_text: str = "",
    ) -> list[RankedMove]:
        wanted = set(tokens(query))
        wanted_tags = tags or set()
        recent = recent_text.lower()
        ranked: list[RankedMove] = []
        for move in self.moves:
            if move.family != family or purpose not in move.purposes or register not in move.registers:
                continue
            doc = set(tokens(move.text + " " + " ".join(move.tags)))
            lexical = sum(self.idf.get(term, 1.0) for term in wanted & doc)
            tag_score = len(wanted_tags & set(move.tags)) * 2.5
            recent_penalty = 8.0 if move.text.lower() in recent else 0.0
            score = move.weight + lexical + tag_score - recent_penalty
            ranked.append(RankedMove(move=move, score=score))
        return sorted(ranked, key=lambda item: (-item.score, item.move.key))

    def choose(
        self,
        *,
        family: str,
        purpose: Purpose,
        register: Register,
        query: str,
        seed: str,
        tags: set[str] | None = None,
        recent_text: str = "",
        top_k: int = 6,
    ) -> str:
        ranked = self.rank(
            family=family,
            purpose=purpose,
            register=register,
            query=query,
            tags=tags,
            recent_text=recent_text,
        )
        if not ranked:
            return ""
        pool = ranked[: max(1, min(top_k, len(ranked)))]
        rng = Random(stable_seed(seed, family, query))
        weights = [max(item.score, 0.1) for item in pool]
        return rng.choices(pool, weights=weights, k=1)[0].move.text

    def section_title(self, family: str, seed: str, recent_text: str = "") -> str:
        values = list(SECTION_TITLES.get(family, SECTION_TITLES["overview"]))
        unused = [item for item in values if item.lower() not in recent_text.lower()] or values
        return Random(stable_seed(seed, "section", family)).choice(unused)
