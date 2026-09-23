"""SQLite tables for one project (spec section 4). UUID string primary keys, JSON for lists and dicts."""

from datetime import date, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Index, Integer, String
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
    # "train" | "detect": set at creation, never changed (spec 2026-09-23 section 5.1).
    kind: Mapped[str] = mapped_column(String, default="train", server_default="train")


class ModelAdoption(Base):
    """Old project `model` id -> app-wide library model id (spec 2026-09-23 section 6)."""

    __tablename__ = "model_adoption"
    old_model_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    library_model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String)  # "adopted" | "missing" | "failed"
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


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
    # Degrees about the box centre; x/y/w/h always describe the unrotated box (spec 3.1).
    angle: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
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


class GeoMap(Base):
    """A georeferenced raster the operator imported (spec 2026-09-22-geotiff-maps section 3)."""

    __tablename__ = "geo_map"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="importing")  # importing | ready | failed
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    source_path: Mapped[str] = mapped_column(String)  # absolute; only ever read
    source_size: Mapped[int] = mapped_column(Integer)
    source_sha256: Mapped[str] = mapped_column(String, default="")
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    band_count: Mapped[int] = mapped_column(Integer, default=0)
    dtype: Mapped[str] = mapped_column(String, default="")
    crs_wkt: Mapped[str | None] = mapped_column(String, nullable=True)
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    proj4: Mapped[str | None] = mapped_column(String, nullable=True)
    geotransform: Mapped[list | None] = mapped_column(JSON, nullable=True)  # GDAL order, 6 floats
    bounds_native: Mapped[list | None] = mapped_column(JSON, nullable=True)
    bounds_wgs84: Mapped[list | None] = mapped_column(JSON, nullable=True)
    gsd_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    # When the imagery was flown, not when the file was imported. Null until known.
    captured_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    stretch: Mapped[dict] = mapped_column(JSON, default=dict)
    labels_version: Mapped[int] = mapped_column(Integer, default=0)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class MapRun(Base):
    __tablename__ = "map_run"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("geo_map.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String)  # local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query: Mapped[str] = mapped_column(String, default="")
    tile_size: Mapped[int] = mapped_column(Integer, default=1280)
    overlap: Mapped[float] = mapped_column(Float, default=0.2)
    nms_iou: Mapped[float] = mapped_column(Float, default=0.5)
    conf: Mapped[float] = mapped_column(Float, default=0.25)
    target_gsd_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    counts: Mapped[dict] = mapped_column(JSON, default=dict)  # {class_id: n}
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_map_run_map", "map_id"),)


class MapDetection(Base):
    __tablename__ = "map_detection"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("map_run.id", ondelete="CASCADE"))
    class_id: Mapped[str] = mapped_column(String(36))
    confidence: Mapped[float] = mapped_column(Float)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    angle: Mapped[float | None] = mapped_column(Float, nullable=True)  # reserved for OBB wave 2
    __table_args__ = (Index("ix_map_detection_run_xy", "run_id", "x", "y"),)


class MapZone(Base):
    __tablename__ = "map_zone"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("geo_map.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    polygon: Mapped[list] = mapped_column(JSON)  # [[x, y], ...] in map pixels
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_map_zone_map", "map_id"),)


class MapLabel(Base):
    __tablename__ = "map_label"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("geo_map.id", ondelete="CASCADE"))
    class_id: Mapped[str] = mapped_column(String(36))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String, default="manual")  # manual | from_run:<id>
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_map_label_map", "map_id"),)


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


class AgentTurn(Base):
    __tablename__ = "agent_turn"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    state: Mapped[str] = mapped_column(String)  # running | awaiting_approval | succeeded | failed | cancelled
    provider: Mapped[str] = mapped_column(String)
    model_name: Mapped[str] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # sanitized: never an SDK string or a key
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class AgentItem(Base):
    __tablename__ = "agent_item"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    seq: Mapped[int] = mapped_column(Integer)  # monotonic per project, unique
    turn_id: Mapped[str] = mapped_column(String(36), ForeignKey("agent_turn.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String)  # user | assistant | tool
    text: Mapped[str] = mapped_column(String, default="")  # message text; empty for tool items
    tool_name: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_input: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tool_status: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # running|ok|error|denied|awaiting_approval
    tool_summary: Mapped[str | None] = mapped_column(String, nullable=True)  # short human-readable outcome
    tool_result: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # internal: text sent back to the model
    result_image_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    job_ids: Mapped[list] = mapped_column(JSON, default=list)
    approval: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {title, detail, estimated_cost}
    navigate: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {screen, image_id}
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    # internal: raw provider blocks for exact replay (Anthropic thinking blocks, OpenAI reasoning items)
    provider_payload: Mapped[Any] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        Index("ix_agent_item_seq", "seq", unique=True),
        Index("ix_agent_item_turn", "turn_id"),
    )
