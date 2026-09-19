from ledgerly_response_intelligence.critic import ResponseCritic
from ledgerly_response_intelligence.models import Purpose, ResponseRequest
from ledgerly_response_intelligence.semantic import normalize_semantic_payload


def test_critic_rejects_unsupported_numeric_claims() -> None:
    request = ResponseRequest(purpose=Purpose.analysis, request="Analyse attendance.", semantic_payload={})
    evidence = normalize_semantic_payload({"rows": [{"studentName": "A", "attendancePercent": 72}]})
    report = ResponseCritic().evaluate("Attendance was 99%, so performance fell.", request, evidence)
    assert report.grounding.score < 0.9
    assert report.revision_required is True


def test_critic_penalises_unsupported_causality() -> None:
    request = ResponseRequest(purpose=Purpose.account_for, request="Account for the decline.", semantic_payload={})
    evidence = normalize_semantic_payload({"rows": [{"studentName": "A", "attendancePercent": 72}]})
    report = ResponseCritic().evaluate("Absence caused the learner to fail.", request, evidence)
    assert report.causality.score < 0.5


def test_critic_detects_repetitive_recent_response() -> None:
    text = "The records show attendance was 72%. The records show the class average was lower."
    request = ResponseRequest(
        purpose=Purpose.analysis,
        request="Analyse attendance.",
        semantic_payload={},
        context={"recent_responses": [text]},
    )
    evidence = normalize_semantic_payload({"rows": [{"studentName": "A", "attendancePercent": 72}]})
    report = ResponseCritic().evaluate(text, request, evidence)
    assert report.variation.score < 0.8
