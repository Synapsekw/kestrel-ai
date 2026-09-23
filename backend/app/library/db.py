"""The library database (`library.db`): library models, plus a `job` table for library jobs.

`library.db` is its own SQLite file with its own Alembic history. Its `job` table has exactly the
columns of `app.db.models.Job`, so the existing Job ORM class and the JobRunner work against a
library session unchanged (the library handle is shaped like a project handle).
"""

from datetime import datetime

from sqlalchemy import JSON, Float, Index, String
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
    task: Mapped[str] = mapped_column(String, default="detect")  # detect | obb
    format: Mapped[str] = mapped_column(String, default="pt")  # pt | onnx
    origin: Mapped[str] = mapped_column(String)  # trained | imported | starter
    # Relative to the library root, posix: "models/<slug>-<id8>/weights.pt".
    weights_path: Mapped[str] = mapped_column(String)
    class_names: Mapped[list] = mapped_column(JSON, default=list)
    class_aliases: Mapped[dict] = mapped_column(JSON, default=dict)
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
