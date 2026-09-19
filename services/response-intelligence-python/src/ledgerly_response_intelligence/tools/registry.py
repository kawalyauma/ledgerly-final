from __future__ import annotations

from collections.abc import Awaitable, Callable

from .base import ToolCapability, ToolRequest, ToolResult


Handler = Callable[[ToolRequest], Awaitable[ToolResult]]


class ToolRegistry:
    def __init__(self) -> None:
        self._capabilities: dict[str, ToolCapability] = {}
        self._handlers: dict[str, Handler] = {}

    def register(self, capability: ToolCapability, handler: Handler) -> None:
        self._capabilities[capability.name] = capability
        self._handlers[capability.name] = handler

    async def capabilities(self) -> list[ToolCapability]:
        return sorted(self._capabilities.values(), key=lambda item: item.name)

    async def execute(self, request: ToolRequest) -> ToolResult:
        capability = self._capabilities.get(request.name)
        if not capability or not capability.enabled:
            return ToolResult(name=request.name, ok=False, error="Tool is not enabled.")
        handler = self._handlers.get(request.name)
        if not handler:
            return ToolResult(name=request.name, ok=False, error="Tool has no registered handler.")
        return await handler(request)


class DisabledToolBroker:
    async def capabilities(self) -> list[ToolCapability]:
        return [
            ToolCapability(
                name="web.search",
                description="Future web search capability for external facts and recent information.",
                categories=["web", "external-knowledge"],
                external=True,
                enabled=False,
            )
        ]

    async def execute(self, request: ToolRequest) -> ToolResult:
        return ToolResult(
            name=request.name,
            ok=False,
            error="External tools are disabled. Enable and register a provider before use.",
        )
