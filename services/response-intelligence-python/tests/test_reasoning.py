from ledgerly_response_intelligence.models import Purpose, ResponseRequest
from ledgerly_response_intelligence.reasoning import ReasoningEngine
from ledgerly_response_intelligence.semantic import normalize_semantic_payload


def test_derives_current_previous_change_without_causal_claim() -> None:
    evidence = normalize_semantic_payload(
        {
            "rows": [
                {
                    "studentName": "Mukisa Abraham",
                    "currentAverage": 49,
                    "previousAverage": 68,
                }
            ]
        }
    )
    request = ResponseRequest(
        purpose=Purpose.account_for,
        request="Account for Mukisa Abraham's decline.",
        semantic_payload={},
    )
    result = ReasoningEngine().derive(request, evidence)
    change = next(item for item in result.insights if item.kind.value == "change")
    assert "68" in change.statement
    assert "49" in change.statement
    assert change.causal is False
    assert result.metadata["causalClaimsDerived"] == 0


def test_derives_outlier_only_with_enough_comparable_records() -> None:
    rows = [{"studentName": f"Learner {i}", "attendancePercent": value} for i, value in enumerate([90, 91, 89, 92, 45, 90])]
    evidence = normalize_semantic_payload({"rows": rows})
    request = ResponseRequest(purpose=Purpose.analysis, request="Analyse attendance exceptions.", semantic_payload={})
    result = ReasoningEngine().derive(request, evidence)
    assert any(item.kind.value == "outlier" and "Learner 4" in item.statement for item in result.insights)
