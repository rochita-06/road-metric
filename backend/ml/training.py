from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib import request

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

DATA_URL = "https://archive.ics.uci.edu/ml/machine-learning-databases/00492/Metro_Interstate_Traffic_Volume.csv.gz"
DEFAULT_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "Metro_Interstate_Traffic_Volume.csv"
DEFAULT_ARTIFACT_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "traffic_model.joblib"

FEATURE_COLUMNS = [
    "holiday",
    "weather_main",
    "temp",
    "rain_1h",
    "snow_1h",
    "clouds_all",
    "hour",
    "day_of_week",
    "month",
    "weekend",
]


def ensure_dataset_available(data_path: str | Path | None = None) -> Path:
    resolved_path = Path(data_path) if data_path is not None else DEFAULT_DATA_PATH
    resolved_path.parent.mkdir(parents=True, exist_ok=True)

    if not resolved_path.exists():
        request.urlretrieve(DATA_URL, resolved_path)

    if not resolved_path.exists():
        raise FileNotFoundError(f"Dataset was not found at {resolved_path}. Download it manually and place it there.")

    return resolved_path


def prepare_training_frame(data_path: str | Path | None = None) -> pd.DataFrame:
    dataset_path = ensure_dataset_available(data_path)
    frame = pd.read_csv(dataset_path, compression="gzip")
    frame = frame.copy()
    frame["date_time"] = pd.to_datetime(frame["date_time"], errors="coerce")
    frame = frame.dropna(subset=["date_time", "traffic_volume"]).copy()

    frame["holiday"] = frame["holiday"].fillna("Unknown").astype(str)
    frame["weather_main"] = frame["weather_main"].fillna("Unknown").astype(str)
    frame["weather_description"] = frame["weather_description"].fillna("Unknown").astype(str)

    frame["hour"] = frame["date_time"].dt.hour
    frame["day_of_week"] = frame["date_time"].dt.dayofweek
    frame["month"] = frame["date_time"].dt.month
    frame["weekend"] = frame["date_time"].dt.dayofweek.isin([5, 6]).astype(int)

    return frame


def build_pipeline() -> Pipeline:
    numeric_columns = ["temp", "rain_1h", "snow_1h", "clouds_all", "hour", "day_of_week", "month", "weekend"]
    categorical_columns = ["holiday", "weather_main"]

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "numeric",
                Pipeline([("imputer", SimpleImputer(strategy="median"))]),
                numeric_columns,
            ),
            (
                "categorical",
                Pipeline([
                    ("imputer", SimpleImputer(strategy="most_frequent")),
                    ("onehot", OneHotEncoder(handle_unknown="ignore")),
                ]),
                categorical_columns,
            ),
        ],
        remainder="drop",
    )

    model = RandomForestRegressor(n_estimators=300, random_state=42, n_jobs=-1)
    return Pipeline([("preprocessor", preprocessor), ("model", model)])


def split_time_series(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    ordered = frame.sort_values("date_time").reset_index(drop=True)
    train_end = int(len(ordered) * 0.7)
    test_end = int(len(ordered) * 0.85)
    train = ordered.iloc[:train_end].copy()
    test = ordered.iloc[train_end:test_end].copy()
    val = ordered.iloc[test_end:].copy()
    return train, test, val


def evaluate_pipeline(frame: pd.DataFrame) -> dict[str, float]:
    train, test, _ = split_time_series(frame)

    x_train = train[FEATURE_COLUMNS]
    y_train = train["traffic_volume"]
    x_test = test[FEATURE_COLUMNS]
    y_test = test["traffic_volume"]

    baseline_model = DummyRegressor(strategy="mean")
    baseline_model.fit(x_train, y_train)
    baseline_predictions = baseline_model.predict(x_test)

    pipeline = build_pipeline()
    pipeline.fit(x_train, y_train)
    predictions = pipeline.predict(x_test)

    metrics = {
        "train_mae": float(mean_absolute_error(y_train, pipeline.predict(x_train))),
        "test_mae": float(mean_absolute_error(y_test, predictions)),
        "test_rmse": float(np.sqrt(mean_squared_error(y_test, predictions))),
        "test_r2": float(r2_score(y_test, predictions)),
        "baseline_test_mae": float(mean_absolute_error(y_test, baseline_predictions)),
        "baseline_test_r2": float(r2_score(y_test, baseline_predictions)),
    }
    return metrics


def train_and_save_model(data_path: str | Path | None = None, artifact_path: str | Path | None = None) -> dict[str, Any]:
    dataset_path = ensure_dataset_available(data_path)
    frame = prepare_training_frame(dataset_path)
    train, test, _ = split_time_series(frame)
    x_train = train[FEATURE_COLUMNS]
    y_train = train["traffic_volume"]
    pipeline = build_pipeline()
    pipeline.fit(x_train, y_train)

    metrics = {
        "train_mae": float(mean_absolute_error(y_train, pipeline.predict(x_train))),
        "test_mae": float(mean_absolute_error(test["traffic_volume"], pipeline.predict(test[FEATURE_COLUMNS]))),
        "test_rmse": float(np.sqrt(mean_squared_error(test["traffic_volume"], pipeline.predict(test[FEATURE_COLUMNS])))),
        "test_r2": float(r2_score(test["traffic_volume"], pipeline.predict(test[FEATURE_COLUMNS]))),
    }

    artifact_file = Path(artifact_path) if artifact_path else DEFAULT_ARTIFACT_PATH
    artifact_file.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "pipeline": pipeline,
        "feature_columns": FEATURE_COLUMNS,
        "metrics": metrics,
        "source_file": str(dataset_path),
        "trained_at": pd.Timestamp.now().isoformat(),
    }
    joblib.dump(artifact, artifact_file)
    return artifact


def load_model_artifact(artifact_path: str | Path | None = None) -> dict[str, Any]:
    artifact_file = Path(artifact_path) if artifact_path else DEFAULT_ARTIFACT_PATH
    if not artifact_file.exists():
        return train_and_save_model(artifact_path=artifact_file)
    return joblib.load(artifact_file)


def predict_for_record(payload: dict[str, Any], artifact_path: str | Path | None = None) -> dict[str, Any]:
    artifact = load_model_artifact(artifact_path)
    pipeline = artifact["pipeline"]
    feature_columns = artifact["feature_columns"]

    record = pd.DataFrame([payload])
    record["date_time"] = pd.to_datetime(record["date_time"], errors="coerce")
    record = record.dropna(subset=["date_time"]).copy()
    record["holiday"] = record["holiday"].fillna("Unknown").astype(str)
    record["weather_main"] = record["weather_main"].fillna("Unknown").astype(str)
    record["weather_description"] = record["weather_description"].fillna("Unknown").astype(str)
    record["hour"] = record["date_time"].dt.hour
    record["day_of_week"] = record["date_time"].dt.dayofweek
    record["month"] = record["date_time"].dt.month
    record["weekend"] = record["date_time"].dt.dayofweek.isin([5, 6]).astype(int)

    record = record[feature_columns]
    prediction = float(pipeline.predict(record)[0])
    return {"predicted_traffic_volume": round(prediction, 2), "model_version": "random_forest_v1"}


def build_metrics_report() -> dict[str, Any]:
    dataset_path = ensure_dataset_available(DEFAULT_DATA_PATH)
    frame = prepare_training_frame(dataset_path)
    metrics = evaluate_pipeline(frame)
    return {
        "dataset_source": DATA_URL,
        "dataset_rows": int(len(frame)),
        "dataset_date_range": {
            "start": frame["date_time"].min().isoformat(),
            "end": frame["date_time"].max().isoformat(),
        },
        "metrics": metrics,
    }
