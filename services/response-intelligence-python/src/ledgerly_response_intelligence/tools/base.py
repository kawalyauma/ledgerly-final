from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel, Field


class ToolCapability(BaseModel):
    name: str
    description: str
    categories: list[str] = Field(default_factory=list)
    external: bool = False
    enabled: bool = False


class ToolRequest(BaseModel):
    name: str
    query: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolResult(BaseModel):
    name: str
    ok: bool
    data: Any = None
    sources: list[dict[str, Any]] = Field(default_factory=list)
    error: str = ""


class ToolBroker(Protocol):
    async def capabilities(self) -> list[ToolCapability]:
        ...

    async def execute(self, request: ToolRequest) -> ToolResult:
        ...
