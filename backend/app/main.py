from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ml.training import load_model_artifact, prepare_training_frame, predict_for_record


class PredictionRequest(BaseModel):
    date_time: str = Field(..., description="ISO-formatted timestamp for the traffic prediction.")
    holiday: str | bool = Field(default="False")
    temp: float = Field(default=0.0)
    rain_1h: float = Field(default=0.0)
    snow_1h: float = Field(default=0.0)
    clouds_all: int = Field(default=0)
    weather_main: str = Field(default="Clear")
    weather_description: str = Field(default="clear sky")


SEGMENTS = [
    {
        "id": "A1",
        "name": "Ameerpet Junction",
        "status": "low",
        "avg_speed_kmh": 62,
        "traffic_volume": 2160,
        "queue_length": 12,
        "direction": "Northbound",
        "coordinates": [17.4375, 78.4483],
    },
    {
        "id": "A2",
        "name": "Jubilee Hills Check Post",
        "status": "moderate",
        "avg_speed_kmh": 41,
        "traffic_volume": 2940,
        "queue_length": 27,
        "direction": "Northbound",
        "coordinates": [17.4306, 78.4079],
    },
    {
        "id": "A3",
        "name": "Madhapur Main Road",
        "status": "high",
        "avg_speed_kmh": 28,
        "traffic_volume": 3380,
        "queue_length": 46,
        "direction": "Eastbound",
        "coordinates": [17.4483, 78.3905],
    },
    {
        "id": "A4",
        "name": "HITEC City Road",
        "status": "low",
        "avg_speed_kmh": 57,
        "traffic_volume": 1880,
        "queue_length": 10,
        "direction": "Westbound",
        "coordinates": [17.4435, 78.3772],
    },
]


app = FastAPI(
    title="FlowWatch API",
    description="Traffic flow and congestion monitoring backend.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    load_model_artifact()


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "FlowWatch",
        "version": "0.1.0",
    }


@app.get("/api/traffic/summary")
def traffic_summary() -> dict:
    return {
        "monitored_segments": len(SEGMENTS),
        "average_speed_kmh": round(sum(item["avg_speed_kmh"] for item in SEGMENTS) / len(SEGMENTS), 1),
        "predicted_traffic_volume": sum(item["traffic_volume"] for item in SEGMENTS),
        "alerts": 3,
        "data_source": "simulated demo",
        "timestamp": "2026-10-11T08:45:00",
    }


@app.get("/api/traffic/segments")
def traffic_segments() -> list[dict]:
    return SEGMENTS


@app.get("/api/models/metrics")
def model_metrics() -> dict:
    artifact = load_model_artifact()
    frame = prepare_training_frame()
    report = {
        "dataset_source": artifact["source_file"],
        "dataset_rows": int(len(frame)),
        "dataset_date_range": {
            "start": frame["date_time"].min().isoformat(),
            "end": frame["date_time"].max().isoformat(),
        },
        "model_version": "random_forest_v1",
        "metrics": artifact["metrics"],
    }
    return report


@app.post("/api/predictions/volume")
def predict_volume(payload: PredictionRequest) -> dict:
    converted = payload.model_dump()
    converted["holiday"] = str(converted.get("holiday", "False")).capitalize()
    converted["weather_main"] = str(converted.get("weather_main", "Clear"))
    converted["weather_description"] = str(converted.get("weather_description", "clear sky"))

    try:
        result = predict_for_record(converted)
    except Exception as exc:  # pragma: no cover - robust fallback for invalid model inputs
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

    return result


@app.get("/api/signals/recommendations")
def signal_recommendations() -> dict:
    return {
        "intersection": "Jubilee Hills Check Post",
        "cycle_length_s": 90,
        "recommendations": [
            {
                "phase": "Northbound",
                "recommended_green_s": 35,
                "reason": "Peak demand from northbound approach exceeds the average demand for the current cycle.",
            },
            {
                "phase": "Eastbound",
                "recommended_green_s": 24,
                "reason": "Moderate demand with a shorter queue and lower saturation.",
            },
            {
                "phase": "Pedestrian",
                "recommended_green_s": 12,
                "reason": "Fixed minimum pedestrian walk time within the cycle constraints.",
            },
        ],
        "assumptions": {
            "all_red_s": 4,
            "minimum_green_s": 12,
            "maximum_cycle_s": 120,
        },
        "advisory_note": "These timings are advisory and do not directly control live traffic lights.",
    }
