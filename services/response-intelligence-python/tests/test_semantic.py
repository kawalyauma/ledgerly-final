from ledgerly_response_intelligence.semantic import normalize_semantic_payload


def test_extracts_flat_rows_into_grounded_facts() -> None:
    evidence = normalize_semantic_payload(
        {
            "rows": [
                {
                    "studentId": "std_1",
                    "studentName": "Mukisa Abraham",
                    "attendancePercent": 72,
                    "currentAverage": 49,
                    "previousAverage": 68,
                }
            ]
        }
    )
    predicates = {fact.predicate for fact in evidence.facts}
    values = {fact.value for fact in evidence.facts}
    assert "attendance Percent" in predicates
    assert {72, 49, 68}.issubset(values)
    assert all(fact.subject == "Mukisa Abraham" for fact in evidence.facts)


def test_preserves_minor_unit_semantics() -> None:
    evidence = normalize_semantic_payload({"rows": [{"name": "Learner", "balanceMinor": 300000}]})
    fact = next(item for item in evidence.facts if item.predicate == "balance Minor")
    assert fact.unit == "minor"


def test_extracts_nested_tool_result_scalars() -> None:
    evidence = normalize_semantic_payload(
        {
            "results": [
                {
                    "tool": "fee_balance_lookup",
                    "module": "fees",
                    "result": {
                        "data": {
                            "studentName": "Amina",
                            "balance": 120000,
                            "status": "outstanding",
                        }
                    },
                }
            ]
        }
    )
    assert any(fact.value == 120000 for fact in evidence.facts)
    assert any(fact.value == "outstanding" for fact in evidence.facts)
