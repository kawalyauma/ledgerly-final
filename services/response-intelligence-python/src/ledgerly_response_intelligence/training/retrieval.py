from __future__ import annotations

import math
import re
from collections import Counter

from .models import RetrievalExample, StyleProfile
from .store import TrainingStore


TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def _weighted_overlap(query: list[str], document: list[str]) -> float:
    if not query or not document:
        return 0.0
    q=Counter(query);d=Counter(document)
    overlap=sum(min(q[token],d[token]) for token in q)
    coverage=overlap/max(sum(q.values()),1)
    precision=overlap/max(sum(d.values()),1)
    return 0.72*coverage+0.28*precision


class TrainingRetriever:
    """Retrieve approved examples as style/reasoning demonstrations.

    Retrieved examples are never factual sources for the current request. They are
    demonstrations of how similar evidence was communicated.
    """

    def __init__(self,store:TrainingStore)->None:
        self.store=store

    def retrieve(
        self,
        *,
        organization_id:str,
        request:str,
        purpose:str,
        register:str="",
        strategy_id:str="",
        limit:int=4,
        include_global:bool=True,
    )->list[RetrievalExample]:
        candidates=self.store.list_examples(
            organization_id=organization_id,status="approved",limit=800,include_global=include_global
        )
        query=_tokens(request)
        ranked:list[RetrievalExample]=[]
        for item in candidates:
            score=_weighted_overlap(query,_tokens(item.request+" "+" ".join(item.tags)))
            if item.purpose.value==purpose:score+=0.22
            if register and item.register and item.register.value==register:score+=0.10
            if strategy_id and item.strategy_id==strategy_id:score+=0.08
            if item.organization_id==organization_id and organization_id:score+=0.12
            score+=min(max(item.quality_overall-0.75,0),0.25)
            if score<0.12:continue
            ranked.append(RetrievalExample(
                example_id=item.example_id,request=item.request,response_text=item.response_text,
                purpose=item.purpose.value,register=item.register.value if item.register else "",
                strategy_id=item.strategy_id,score=score,
            ))
        ranked.sort(key=lambda item:(-item.score,item.example_id))
        return ranked[:max(0,min(limit,12))]

    def style_profile(self,organization_id:str)->StyleProfile:
        return self.store.style_profile(organization_id)
