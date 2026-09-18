from ledgerly_response_intelligence.models import Purpose, ResponseRequest
from ledgerly_response_intelligence.planner import DiscoursePlanner
from ledgerly_response_intelligence.semantic import normalize_semantic_payload


def test_account_for_plan_includes_explanation_and_causal_guard() -> None:
    request = ResponseRequest(
        purpose=Purpose.account_for,
        request="Account for Mukisa Abraham's decline compared with last term.",
        semantic_payload={},
        detail="deep",
    )
    evidence = normalize_semantic_payload(
        {
            "rows": [
                {
                    "studentName": "Mukisa Abraham",
                    "currentAverage": 49,
                    "previousAverage": 68,
                    "attendancePercent": 72,
                }
            ]
        }
    )
    plan = DiscoursePlanner().build(request, evidence)
    ids = {section.section_id for section in plan.sections}
    assert "overview" in ids
    assert "comparison" in ids
    assert "explanation" in ids
    assert "limits" in ids
    assert plan.causal_guard_required is True


def test_finance_register_is_selected_for_fee_analysis() -> None:
    request = ResponseRequest(
        purpose=Purpose.analysis,
        request="Analyse fees arrears and outstanding balances.",
        semantic_payload={},
    )
    evidence = normalize_semantic_payload({"rows": [{"studentName": "A", "balance": 1000}]})
    plan = DiscoursePlanner().build(request, evidence)
    assert plan.register.value == "finance"
