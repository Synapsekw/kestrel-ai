"""Request and response models for `/library` (contract: LibraryModel, LibraryModelPage, ...)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.library.db import LibraryModel
from app.training.schemas import ModelMetrics

ARTIFACT_KEYS = ("results_csv", "confusion_matrix", "pr_curve")
PROVENANCE_KEYS = (
    "project_id",
    "project_name",
    "project_folder",
    "dataset_id",
    "dataset_name",
    "run_id",
    "base_model_id",
    "base_model_name",
    "source_file",
)


class LibraryModelOut(BaseModel):
    id: str
    name: str
    notes: str
    supplier: str | None
    task: Literal["detect", "obb"]
    format: Literal["pt", "onnx"]
    origin: Literal["trained", "imported", "starter"]
    state: Literal["ready", "unavailable"]
    class_names: list[str]
    class_aliases: dict[str, str]
    provenance: dict[str, str | None]
    hyperparameters: dict[str, Any]
    metrics: ModelMetrics | None
    exports: dict[str, str]
    artifacts: dict[str, str]
    train_gsd_cm: float | None
    sha256: str
    created_at: datetime

    @classmethod
    def from_row(cls, row: LibraryModel, state: str) -> "LibraryModelOut":
        provenance = row.provenance or {}
        return cls(
            id=row.id,
            name=row.name,
            notes=row.notes or "",
            supplier=row.supplier,
            task=row.task,
            format=row.format,
            origin=row.origin,
            state=state,
            class_names=list(row.class_names or []),
            class_aliases=dict(row.class_aliases or {}),
            provenance={
                k: (None if provenance[k] is None else str(provenance[k]))
                for k in PROVENANCE_KEYS
                if k in provenance
            },
            hyperparameters=row.hyperparameters or {},
            metrics=ModelMetrics(**row.metrics) if row.metrics else None,
            exports=dict(row.exports or {}),
            artifacts={k: v for k, v in (row.artifacts or {}).items() if k in ARTIFACT_KEYS and v},
            train_gsd_cm=row.train_gsd_cm,
            sha256=row.sha256,
            created_at=row.created_at,
        )


class LibraryModelPage(BaseModel):
    items: list[LibraryModelOut]
    next_cursor: str | None


class LibraryModelImport(BaseModel):
    name: str = Field(min_length=1)
    weights_path: str = Field(min_length=1)
    class_aliases: dict[str, str] = Field(default_factory=dict)
    supplier: str | None = None


class LibraryModelPatch(BaseModel):
    """Every field optional; only the fields sent are changed. `name` cannot be emptied."""

    name: str | None = Field(None, min_length=1)
    notes: str | None = None
    supplier: str | None = None
    class_aliases: dict[str, str] | None = None


class ModelUsageProject(BaseModel):
    project_id: str
    name: str
    folder: str
    preannotation: bool
    query_runs: int
    map_runs: int


class ModelUsage(BaseModel):
    projects: list[ModelUsageProject]


class LibraryStatus(BaseModel):
    available: bool
    root: str
    error: str | None


class StarterAcquire(BaseModel):
    name: str | None = Field(None, min_length=1)
