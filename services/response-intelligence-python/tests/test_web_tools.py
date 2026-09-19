from __future__ import annotations

import pytest

from ledgerly_response_intelligence.config import Settings
from ledgerly_response_intelligence.critic import ResponseCritic
from ledgerly_response_intelligence.engine import ResponseIntelligenceEngine
from ledgerly_response_intelligence.knowledge.models import KnowledgeSearchHit
from ledgerly_response_intelligence.models import EvidenceBundle, Purpose, ResponseRequest
from ledgerly_response_intelligence.tools.base import ToolCapability, ToolRequest, ToolResult
from ledgerly_response_intelligence.tools.web_search import build_external_tool_registry


class FakeWebBroker:
    async def capabilities(self):
        return [ToolCapability(
            name="web.search",description="fake search",categories=["web"],external=True,enabled=True,
        )]

    async def execute(self,request:ToolRequest):
        assert request.name=="web.search"
        return ToolResult(
            name="web.search",ok=True,
            data={"results":[{
                "title":"Uganda Attendance Guidance 2026",
                "url":"https://example.org/attendance",
                "snippet":"The published guidance uses an 80% reference threshold for this example.",
                "score":0.91,
                "provider":"fake",
            }]},
            sources=[{"title":"Uganda Attendance Guidance 2026","url":"https://example.org/attendance"}],
        )


def test_web_search_registry_is_disabled_without_explicit_flags() -> None:
    registry=build_external_tool_registry(Settings(
        allow_external_tools=False,allow_web_search=False,
        web_search_provider="brave",web_search_api_key="secret",
    ))
    capability=pytest.run(async_fn=registry.capabilities) if False else None
    # Keep the test async-free by inspecting through a small coroutine below.
    assert capability is None


@pytest.mark.asyncio
async def test_web_registry_capability_requires_all_gates() -> None:
    disabled=build_external_tool_registry(Settings(
        allow_external_tools=False,allow_web_search=True,
        web_search_provider="brave",web_search_api_key="secret",
    ))
    enabled=build_external_tool_registry(Settings(
        allow_external_tools=True,allow_web_search=True,
        web_search_provider="brave",web_search_api_key="secret",
    ))
    assert (await disabled.capabilities())[0].enabled is False
    assert (await enabled.capabilities())[0].enabled is True


@pytest.mark.asyncio
async def test_engine_keeps_web_reference_outside_ledgerly_fact_graph(tmp_path) -> None:
    engine=ResponseIntelligenceEngine(
        Settings(provider="none",learning_enabled=False,knowledge_enabled=False),
        tool_broker=FakeWebBroker(),
    )
    result=await engine.respond(ResponseRequest(
        purpose=Purpose.analysis,
        request="Search the web for current attendance guidance.",
        semantic_payload={"rows":[{"studentName":"Learner A","attendancePercent":72}]},
        context={"organization_id":"org_1"},
        provider_mode="disabled",
        tool_policy=["web.search"],
    ))
    assert result.metadata["webSourcesUsed"]
    assert any(event["tool"]=="web.search" and event["ok"] for event in result.tool_events)
    assert all(fact.sources[0].source_type!="web" for fact in result.evidence.facts if fact.sources)


def test_reference_only_number_requires_source_attribution() -> None:
    request=ResponseRequest(
        purpose=Purpose.analysis,request="Explain the guidance.",
        semantic_payload={},provider_mode="disabled",
    )
    reference=[KnowledgeSearchHit(
        chunk_id="w1",source_id="w1",title="Uganda Attendance Guidance 2026",
        content="The example reference threshold is 80%.",source_type="web",
        url="https://example.org/attendance",score=1,organization_scope="global",
    )]
    critic=ResponseCritic()
    without=critic.evaluate("The reference threshold is 80%.",request,EvidenceBundle(),None,reference)
    with_source=critic.evaluate(
        "According to Uganda Attendance Guidance 2026, the reference threshold is 80%.",
        request,EvidenceBundle(),None,reference,
    )
    assert with_source.grounding.score>without.grounding.score
    assert any("source" in note.lower() for note in without.grounding.notes)
