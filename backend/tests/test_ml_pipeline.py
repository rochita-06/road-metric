import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ml.training import evaluate_pipeline, load_model_artifact, prepare_training_frame


def test_missing_model_artifact_fails_without_training_or_writing(tmp_path: Path) -> None:
    artifact_path = tmp_path / "missing" / "traffic_model.joblib"

    with pytest.raises(FileNotFoundError, match="runtime startup never trains"):
        load_model_artifact(artifact_path)

    assert not artifact_path.exists()
    assert not artifact_path.parent.exists()


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
