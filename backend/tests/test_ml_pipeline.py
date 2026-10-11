import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ml.training import evaluate_pipeline, prepare_training_frame


def test_prepare_training_frame_creates_time_features() -> None:
    frame = prepare_training_frame(
        Path(__file__).resolve().parents[1] / "data" / "Metro_Interstate_Traffic_Volume.csv"
    )

    assert {"date_time", "traffic_volume", "hour", "day_of_week", "month", "weekend"}.issubset(frame.columns)
    assert frame["date_time"].notna().all()
    assert frame["traffic_volume"].notna().all()


def test_evaluate_pipeline_returns_metrics() -> None:
    frame = prepare_training_frame(
        Path(__file__).resolve().parents[1] / "data" / "Metro_Interstate_Traffic_Volume.csv"
    )

    metrics = evaluate_pipeline(frame)

    assert {"train_mae", "test_mae", "test_rmse", "test_r2"}.issubset(metrics.keys())
    assert metrics["test_mae"] >= 0
    assert metrics["test_rmse"] >= 0
    assert metrics["test_r2"] <= 1.0
