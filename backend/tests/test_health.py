import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "FlowWatch"
    assert payload["version"] == "0.1.0"


def test_traffic_segments_have_hyderabad_coordinates() -> None:
    response = client.get("/api/traffic/segments")

    assert response.status_code == 200
    segments = response.json()
    assert len(segments) == 4
    for segment in segments:
        latitude, longitude = segment["coordinates"]
        assert 17.0 <= latitude <= 18.0
        assert 78.0 <= longitude <= 79.0
