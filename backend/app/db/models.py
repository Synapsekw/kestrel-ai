"""SQLite tables for one project (spec section 4). UUID string primary keys, JSON for lists and dicts."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, new_id, utcnow


class Project(Base):
    __tablename__ = "project"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    classes: Mapped[list] = mapped_column(JSON, default=list)  # [{id, name, colour, hotkey, order}]
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    preannotation_model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    import_defaults: Mapped[dict] = mapped_column(JSON, default=dict)  # ImportSettings
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Source(Base):
    __tablename__ = "source"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    folder: Mapped[str] = mapped_column(String)
    site: Mapped[str] = mapped_column(String)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)  # ImportSettings used for this source
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    imported_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Image(Base):
    __tablename__ = "image"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    path: Mapped[str] = mapped_column(String)  # relative to the project folder, forward slashes
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("source.id"))
    capture_time: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    alt: Mapped[float | None] = mapped_column(Float, nullable=True)
    phash: Mapped[str | None] = mapped_column(String(16), nullable=True)
    group_key: Mapped[str] = mapped_column(String, default="")
    marked_empty: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa.false())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        Index("ix_image_source", "source_id"),
        Index("ix_image_group", "group_key"),
        Index("ix_image_path", "path", unique=True),
    )


class Box(Base):
    __tablename__ = "box"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    image_id: Mapped[str] = mapped_column(String(36), ForeignKey("image.id", ondelete="CASCADE"))
    class_id: Mapped[str] = mapped_column(String(36))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    provenance_kind: Mapped[str] = mapped_column(String)  # person | local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    review_state: Mapped[str] = mapped_column(String, default="unreviewed")
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        Index("ix_box_image", "image_id"),
        Index("ix_box_query_run", "query_run_id"),
        Index("ix_box_review", "review_state"),
    )


class Dataset(Base):
    __tablename__ = "dataset"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, unique=True)
    classes: Mapped[list] = mapped_column(JSON, default=list)
    split_method: Mapped[str] = mapped_column(String)  # by_group | by_tile | random
    split_params: Mapped[dict] = mapped_column(JSON, default=dict)  # {val_fraction, seed}
    path: Mapped[str] = mapped_column(String)  # relative: datasets/<name>
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class DatasetImage(Base):
    __tablename__ = "dataset_image"
    dataset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dataset.id", ondelete="CASCADE"), primary_key=True
    )
    image_id: Mapped[str] = mapped_column(String(36), ForeignKey("image.id"), primary_key=True)
    split: Mapped[str] = mapped_column(String)  # train | val
    boxes: Mapped[list] = mapped_column(JSON, default=list)  # frozen [{class_id, x, y, w, h}]


class Model(Base):
    __tablename__ = "model"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # imported | trained
    weights_path: Mapped[str] = mapped_column(String)  # relative to project folder
    base_weights: Mapped[str | None] = mapped_column(String, nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    hyperparameters: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    class_names: Mapped[list] = mapped_column(JSON, default=list)
    class_aliases: Mapped[dict] = mapped_column(JSON, default=dict)  # {"truck": "dump_truck"}
    exports: Mapped[dict] = mapped_column(JSON, default=dict)  # {"onnx": "models/x.onnx"}
    artifacts: Mapped[dict] = mapped_column(JSON, default=dict)  # {results_csv, confusion_matrix, pr_curve}
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Job(Base):
    __tablename__ = "job"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String)  # import | dataset | train | infer | export
    state: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(String, default="")
    log_path: Mapped[str] = mapped_column(String, default="")  # relative: runs/<job_id>/job.log
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (Index("ix_job_state", "state"), Index("ix_job_created", "created_at"))


class QueryRun(Base):
    __tablename__ = "query_run"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)  # local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query: Mapped[str] = mapped_column(String, default="")
    image_ids: Mapped[list] = mapped_column(JSON, default=list)
    tiling: Mapped[dict] = mapped_column(JSON, default=dict)  # {enabled, tile_size, overlap, nms_iou}
    conf: Mapped[float] = mapped_column(Float, default=0.25)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    promoted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
