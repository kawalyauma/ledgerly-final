from fastapi.testclient import TestClient

from ledgerly_response_intelligence.api import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "ledgerly-response-intelligence"


def test_plan_endpoint() -> None:
    response = client.post(
        "/v1/plan",
        json={
            "purpose": "analysis",
            "request": "Analyse attendance.",
            "provider_mode": "disabled",
            "semantic_payload": {"rows": [{"studentName": "Amina", "attendancePercent": 82}]},
        },
    )
    assert response.status_code == 200
    assert response.json()["sections"]


def test_respond_endpoint() -> None:
    response = client.post(
        "/v1/respond",
        json={
            "purpose": "report",
            "request": "Report the current fee balance.",
            "provider_mode": "disabled",
            "semantic_payload": {"rows": [{"studentName": "Amina", "balance": 120000}]},
        },
    )
    assert response.status_code == 200
    assert "120,000" in response.json()["text"]


def test_reason_endpoint() -> None:
    response = client.post(
        "/v1/reason",
        json={
            "purpose": "analysis",
            "request": "Compare the current and previous average.",
            "provider_mode": "disabled",
            "semantic_payload": {
                "rows": [
                    {
                        "studentName": "Amina",
                        "currentAverage": 60,
                        "previousAverage": 75,
                    }
                ]
            },
        },
    )
    assert response.status_code == 200
    assert any(item["kind"] == "change" for item in response.json()["insights"])
