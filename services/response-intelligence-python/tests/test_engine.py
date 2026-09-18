import pytest

from ledgerly_response_intelligence.config import Settings
from ledgerly_response_intelligence.engine import ResponseIntelligenceEngine
from ledgerly_response_intelligence.models import Purpose, ResponseRequest


@pytest.mark.asyncio
async def test_engine_works_without_external_ai_provider() -> None:
    engine = ResponseIntelligenceEngine(Settings(provider="none"))
    result = await engine.respond(
        ResponseRequest(
            purpose=Purpose.analysis,
            request="Analyse Mukisa Abraham's attendance and academic trend.",
            semantic_payload={
                "rows": [
                    {
                        "studentName": "Mukisa Abraham",
                        "attendancePercent": 72,
                        "currentAverage": 49,
                        "previousAverage": 68,
                    }
                ],
                "missingData": ["No verified lesson-delivery record is available."],
            },
            provider_mode="disabled",
            detail="deep",
        )
    )
    assert "Mukisa Abraham" in result.text
    assert "72" in result.text
    assert result.provider == "deterministic"
    assert result.quality.grounding.score >= 0.9
    assert result.response_fingerprint


@pytest.mark.asyncio
async def test_engine_marks_web_tool_as_not_enabled() -> None:
    engine = ResponseIntelligenceEngine(Settings(provider="none"))
    result = await engine.respond(
        ResponseRequest(
            purpose=Purpose.report,
            request="Report the balance.",
            semantic_payload={"rows": [{"name": "School Fees Receivable", "balance": 1000}]},
            provider_mode="disabled",
            tool_policy=["web.search"],
        )
    )
    assert result.tool_events[0]["tool"] == "web.search"
    assert result.tool_events[0]["enabled"] is False
