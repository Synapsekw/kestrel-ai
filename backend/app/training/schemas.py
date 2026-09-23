"""Request and response models for `/projects/{projectId}/models` (contract: Model, ModelPage, ...)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.db.models import Model
from app.jobs.schemas import JobOut

ARTIFACT_KEYS = ("results_csv", "confusion_matrix", "pr_curve")


class ClassMetrics(BaseModel):
    class_name: str
    map50: float
    map50_95: float
    precision: float
    recall: float


class ModelMetrics(BaseModel):
    map50: float
    map50_95: float
    precision: float
    recall: float
    per_class: list[ClassMetrics] = Field(default_factory=list)


class ModelOut(BaseModel):
    id: str
    name: str
    kind: Literal["imported", "trained"]
    weights_path: str
    base_weights: str | None
    dataset_id: str | None
    hyperparameters: dict[str, Any]
    metrics: ModelMetrics | None
    class_names: list[str]
    class_aliases: dict[str, str]
    exports: dict[str, str]
    artifacts: dict[str, str]
    run_id: str | None
    train_gsd_cm: float | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: Model) -> "ModelOut":
        artifacts = {k: v for k, v in (row.artifacts or {}).items() if k in ARTIFACT_KEYS and v}
        return cls(
            id=row.id,
            name=row.name,
            kind=row.kind,
            weights_path=row.weights_path,
            base_weights=row.base_weights,
            dataset_id=row.dataset_id,
            hyperparameters=row.hyperparameters or {},
            metrics=ModelMetrics(**row.metrics) if row.metrics else None,
            class_names=list(row.class_names or []),
            class_aliases=dict(row.class_aliases or {}),
            exports=dict(row.exports or {}),
            artifacts=artifacts,
            run_id=row.run_id,
            train_gsd_cm=row.train_gsd_cm,
            created_at=row.created_at,
        )


class ModelGsdEstimate(BaseModel):
    train_gsd_cm: float
    image_gsd_cm: float
    median_alt_m: float
    focal_mm: float
    sensor_width_mm: float
    sensor_source: Literal["focal_plane", "crop_factor"]
    sample_size: int
    imgsz: int
    median_object_m: float
    per_class_m: dict[str, float]
    plausible: bool


class ModelPatch(BaseModel):
    train_gsd_cm: float | None = Field(default=None, gt=0)


class ModelPage(BaseModel):
    items: list[ModelOut]
    next_cursor: str | None


class ModelImport(BaseModel):
    name: str = Field(min_length=1)
    weights_path: str = Field(min_length=1)
    class_aliases: dict[str, str] = Field(default_factory=dict)


class TrainRequest(BaseModel):
    name: str = Field(min_length=1)
    dataset_id: str
    base_model_id: str
    epochs: int = Field(50, ge=1, le=1000)
    imgsz: int = Field(1280, ge=320, le=4096)
    batch: int | None = None
    patience: int = Field(50, ge=0)
    augmentation: Literal["default", "aerial"] = "default"
    device: str = "0"


class StarterModelOut(BaseModel):
    key: str
    family: str
    task: Literal["detect"] = "detect"
    name: str
    description: str
    size_mb: float
    available: bool


class StarterModelPage(BaseModel):
    items: list[StarterModelOut]
    next_cursor: str | None


class StarterModelImport(BaseModel):
    key: str
    name: str | None = Field(None, min_length=1)

    @field_validator("key")
    @classmethod
    def known_starter(cls, value: str) -> str:
        from app.training.starter import STARTER_KEYS

        if value not in STARTER_KEYS:
            raise ValueError("Choose a supported detection starter model.")
        return value


class ExportRequest(BaseModel):
    format: Literal["onnx", "engine"]
    imgsz: int = Field(1280, ge=320, le=4096)
    half: bool = False


class JobRef(BaseModel):
    job: JobOut
