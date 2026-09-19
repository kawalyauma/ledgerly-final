from __future__ import annotations

from .models import KnowledgeSearchHit
from .store import KnowledgeStore


class KnowledgeRetriever:
    def __init__(self,store:KnowledgeStore)->None:
        self.store=store

    def search(
        self,
        *,
        organization_id:str,
        query:str,
        limit:int=6,
        include_global:bool=True,
        source_types:list[str]|None=None,
    )->list[KnowledgeSearchHit]:
        return self.store.search(
            organization_id=organization_id,query=query,limit=limit,
            include_global=include_global,source_types=source_types,
        )
