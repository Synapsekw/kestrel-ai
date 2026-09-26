"""Training, starter catalogue and export request models (contract: TrainRequest, StarterModel, ...).

Library models themselves are in `app.library.schemas`."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.jobs.schemas import JobOut


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


class ExportRequest(BaseModel):
    format: Literal["onnx", "engine"]
    imgsz: int = Field(1280, ge=320, le=4096)
    half: bool = False


class JobRef(BaseModel):
    job: JobOut


class TrainingRunOut(BaseModel):
    id: str
    name: str
    dataset_id: str
    base_model_id: str
    params: dict[str, Any]
    job_id: str | None
    state: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    model_id: str | None
    #: Null until the model registers; live curves come from the job's progress events (decision 13).
    metrics: ModelMetrics | None
    created_at: datetime
    finished_at: datetime | None


class TrainingRunPage(BaseModel):
    items: list[TrainingRunOut]
    next_cursor: str | None


class TrainingRunWithJob(BaseModel):
    training_run: TrainingRunOut
    job: JobOut
