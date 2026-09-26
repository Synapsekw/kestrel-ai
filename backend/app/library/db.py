"""The library database (`library.db`): library models, datasets built across projects, training
runs, and a `job` table for library jobs.

`library.db` is its own SQLite file with its own Alembic history. Its `job` table has exactly the
columns of `app.db.models.Job`, so the existing Job ORM class and the JobRunner work against a
library session unchanged (the library handle is shaped like a project handle). Revision 0002
(foundation F §12.1) adds `library_model.class_map` and the Models section's four tables.
"""

from datetime import datetime

from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.base import UTCDateTime, new_id, utcnow


class LibraryBase(DeclarativeBase):
    pass


class LibraryModel(LibraryBase):
    __tablename__ = "library_model"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    notes: Mapped[str] = mapped_column(String, default="")
    supplier: Mapped[str | None] = mapped_column(String, nullable=True)
    task: Mapped[str] = mapped_column(String, default="detect")  # detect | obb | segment
    format: Mapped[str] = mapped_column(String, default="pt")  # pt | onnx
    origin: Mapped[str] = mapped_column(String)  # trained | imported | starter
    # Relative to the library root, posix: "models/<slug>-<id8>/weights.pt".
    weights_path: Mapped[str] = mapped_column(String)
    class_names: Mapped[list] = mapped_column(JSON, default=list)
    class_aliases: Mapped[dict] = mapped_column(JSON, default=dict)
    # {model class name: catalogue type id | None}; None ignores the class. App-wide (F10).
    class_map: Mapped[dict] = mapped_column(JSON, default=dict)
    provenance: Mapped[dict] = mapped_column(JSON, default=dict)
    hyperparameters: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Relative to the model's own folder, as the contract words it: {"onnx": "exports/weights.onnx"}.
    exports: Mapped[dict] = mapped_column(JSON, default=dict)
    artifacts: Mapped[dict] = mapped_column(JSON, default=dict)
    train_gsd_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        Index("ix_library_model_sha256", "sha256", unique=True),
        Index("ix_library_model_created", "created_at"),
    )


class LibraryDataset(LibraryBase):
    """A training dataset built across projects (`origin: built`) or registered from one project's
    materialised folder by the migration (`origin: legacy`)."""

    __tablename__ = "dataset"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    task: Mapped[str] = mapped_column(String, default="detect")  # detect | obb | segment
    origin: Mapped[str] = mapped_column(String, default="built")  # built | legacy
    # {project_ids, type_ids, captured_from, captured_to, reviewed_only}; None for a legacy dataset.
    filter: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Frozen [{type_id, name}]: the list order is the class index order of the export.
    classes: Mapped[list] = mapped_column(JSON, default=list)
    split_method: Mapped[str] = mapped_column(String, default="by_group")  # by_group | by_tile | random
    split_params: Mapped[dict] = mapped_column(JSON, default=dict)  # {val_fraction, seed}
    state: Mapped[str] = mapped_column(String, default="resolving")  # resolving | ready | failed
    counts: Mapped[dict] = mapped_column(JSON, default=dict)  # {images, train, val, per_class}
    # Relative to the library root, posix: "datasets/<slug>-<id8>". None until an export is built.
    export_path: Mapped[str | None] = mapped_column(String, nullable=True)
    export_state: Mapped[str] = mapped_column(String, default="none")  # none | building | ready | failed
    export_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    legacy_path: Mapped[str | None] = mapped_column(String, nullable=True)  # absolute
    legacy_dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # project Dataset.id
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # the dataset_build job
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        Index("ix_dataset_name", "name", unique=True),
        Index("ix_dataset_created", "created_at"),
        Index("ix_dataset_legacy_path", "legacy_path", unique=True),
    )


class LibraryDatasetSource(LibraryBase):
    """One project a dataset drew from, as it was when the dataset was resolved (provenance)."""

    __tablename__ = "dataset_source"
    dataset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dataset.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_folder: Mapped[str] = mapped_column(String)
    project_name: Mapped[str] = mapped_column(String)
    image_count: Mapped[int] = mapped_column(Integer, default=0)


class LibraryDatasetItem(LibraryBase):
    """One image of a dataset, referenced (never copied) with its frozen labels."""

    __tablename__ = "dataset_item"
    dataset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dataset.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    image_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    split: Mapped[str] = mapped_column(String)  # train | val
    labels: Mapped[list] = mapped_column(JSON, default=list)  # [{type_id, x, y, w, h, angle}]


class TrainingRun(LibraryBase):
    """One `train` job's history. `dataset_id` has no foreign key: a run outlives its dataset."""

    __tablename__ = "training_run"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    dataset_id: Mapped[str] = mapped_column(String(36))
    base_model_id: Mapped[str] = mapped_column(String(36))
    params: Mapped[dict] = mapped_column(JSON, default=dict)  # the TrainRequest
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # queued | running | succeeded | failed | cancelled
    state: Mapped[str] = mapped_column(String, default="queued")
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (Index("ix_training_run_created", "created_at"),)
