import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_models_metrics_endpoint() -> None:
    response = client.get("/api/models/metrics")

    assert response.status_code == 200
    payload = response.json()
    assert "metrics" in payload
    assert "dataset_source" in payload
    assert payload["metrics"]["test_r2"] <= 1.0


def test_prediction_volume_endpoint() -> None:
    payload = {
        "date_time": "2018-01-01T12:00:00",
        "holiday": "False",
        "temp": 35.0,
        "rain_1h": 0.0,
        "snow_1h": 0.0,
        "clouds_all": 40,
        "weather_main": "Clouds",
        "weather_description": "scattered clouds",
    }

    response = client.post("/api/predictions/volume", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert "predicted_traffic_volume" in data
    assert float(data["predicted_traffic_volume"]) >= 0
    assert "model_version" in data
