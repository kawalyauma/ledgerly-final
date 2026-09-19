from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class KnowledgeSourceCreate(BaseModel):
    organization_id: str = ""
    title: str = Field(min_length=1, max_length=500)
    source_type: Literal["manual", "policy", "circular", "document", "web", "research", "other"] = "document"
    content: str = Field(min_length=1, max_length=2_000_000)
    url: str = Field(default="", max_length=4000)
    author: str = Field(default="", max_length=500)
    published_at: str = ""
    approved: bool = False
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class KnowledgeSource(BaseModel):
    source_id: str
    organization_id: str = ""
    title: str
    source_type: str
    url: str = ""
    author: str = ""
    published_at: str = ""
    approved: bool = False
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunk_count: int = 0
    content_sha256: str = ""
    created_at: str
    updated_at: str


class KnowledgeChunk(BaseModel):
    chunk_id: str
    source_id: str
    organization_id: str = ""
    title: str = ""
    content: str
    position: int = 0
    token_estimate: int = 0
    source_type: str = ""
    url: str = ""
    approved: bool = False
    tags: list[str] = Field(default_factory=list)


class KnowledgeSearchHit(BaseModel):
    chunk_id: str
    source_id: str
    title: str
    content: str
    source_type: str
    url: str = ""
    published_at: str = ""
    score: float = 0
    organization_scope: Literal["organization", "global"] = "organization"
    tags: list[str] = Field(default_factory=list)


class KnowledgeSearchRequest(BaseModel):
    organization_id: str = ""
    query: str = Field(min_length=2, max_length=5000)
    limit: int = Field(default=6, ge=1, le=30)
    include_global: bool = True
    source_types: list[str] = Field(default_factory=list)


class KnowledgeStats(BaseModel):
    organization_id: str = ""
    sources: int = 0
    approved_sources: int = 0
    chunks: int = 0
    approved_chunks: int = 0
    global_sources_available: int = 0
