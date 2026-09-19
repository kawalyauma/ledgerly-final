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


@pytest.mark.asyncio
async def test_engine_captures_and_reuses_approved_learning_example(tmp_path) -> None:
    settings=Settings(
        provider="none",training_db_path=str(tmp_path/"training.sqlite3"),
        training_auto_candidate_quality=0.0,learning_enabled=True,learning_retrieval_enabled=True,
    )
    engine=ResponseIntelligenceEngine(settings)
    request=ResponseRequest(
        purpose=Purpose.analysis,request="Analyse P6 attendance.",
        semantic_payload={"rows":[{"className":"P6","attendancePercent":72}]},
        context={"organization_id":"org_1","audience":"Director of Studies"},
        provider_mode="disabled",
    )
    first=await engine.respond(request)
    example_id=str(first.metadata["trainingExampleId"])
    assert example_id
    assert engine.training_store is not None
    engine.training_store.set_status(example_id,"approved")
    second=await engine.respond(request)
    assert example_id in second.metadata["learnedExamplesUsed"]
    assert int(second.metadata["styleProfileExamples"])>=1
