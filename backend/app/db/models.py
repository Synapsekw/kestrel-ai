"""SQLite tables for one project (spec section 4). UUID string primary keys, JSON for lists and dicts."""

from datetime import date, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, new_id, utcnow


class Project(Base):
    __tablename__ = "project"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    classes: Mapped[list] = mapped_column(JSON, default=list)  # [{id, name, colour, hotkey, order}]
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    # The high-water mark of finding numbers (spec section 8.1): allocation takes
    # max(finding_seq, max(finding.number)) + 1, so a deleted number is never handed out again.
    finding_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    preannotation_model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    import_defaults: Mapped[dict] = mapped_column(JSON, default=dict)  # ImportSettings
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # The `kind` column (migration 0007) is gone: migration 0010 drops it (spec 2026-09-26-foundation
    # section 6.1).


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
    # Detection workspace (spec 2026-09-23 section 7.1): "images" | "map" ("video" reserved).
    kind: Mapped[str] = mapped_column(String, default="images", server_default="images")
    label: Mapped[str | None] = mapped_column(String, nullable=True)  # e.g. "Flight 14 Sep"
    # The survey date. A map source mirrors GeoMap.captured_on, which stays the one truth.
    captured_on: Mapped[date | None] = mapped_column(Date, nullable=True)


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
        Index("ix_box_class", "class_id"),
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
    # The map source that owns this map (spec 2026-09-23 section 7.1); unlinked if it is deleted.
    source_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("source.id", ondelete="SET NULL"), nullable=True
    )


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
    # {class_id: n}: every detection that is not rejected (app/detect/counts.py keeps it current).
    counts: Mapped[dict] = mapped_column(JSON, default=dict)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Detection workspace (spec 2026-09-23 sections 7.2 and 9.2, plan 2 deviation 1).
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    class_map: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")  # {model class: id|None}
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa.false())
    verified_counts: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")  # {class_id: n}
    # {area_id: {class_id: {"total": n, "verified": n}}}
    area_counts: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
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
    # unreviewed | accepted | rejected | edited (spec 2026-09-23 section 8)
    review_state: Mapped[str] = mapped_column(String, default="unreviewed", server_default="unreviewed")
    # person | local_model | cloud_provider; a person-drawn detection is a row like any other
    provenance_kind: Mapped[str] = mapped_column(String, default="local_model", server_default="local_model")
    __table_args__ = (
        Index("ix_map_detection_run_xy", "run_id", "x", "y"),
        Index("ix_map_detection_run_state", "run_id", "review_state"),
    )


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
    # Detection workspace (spec 2026-09-23 sections 7.2 and 9.2); counts are photo *detections*.
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    class_map: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa.false())
    counts: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")  # {class_id: n}
    verified_counts: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")


class ModelClassMap(Base):
    """A library model's class names mapped onto this project's classes (spec 2026-09-23 section 7.3)."""

    __tablename__ = "model_class_map"
    library_model_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    mapping: Mapped[dict] = mapped_column(JSON, default=dict)  # {model_class_name: project_class_id | None}
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class SiteArea(Base):
    """A project-level area, stored in WGS84 and projected onto each map (spec 2026-09-23 section 9.3)."""

    __tablename__ = "site_area"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    polygon_wgs84: Mapped[list] = mapped_column(JSON)  # [[lon, lat], ...], at least three
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


class PointCloud(Base):
    """A LAS/LAZ point cloud and its Potree display copy (spec 2026-09-23-point-clouds section 3)."""

    __tablename__ = "point_cloud"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="importing")  # importing | ready | failed
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    source_path: Mapped[str] = mapped_column(String)  # absolute; only ever read, never kept
    source_size: Mapped[int] = mapped_column(Integer)
    source_sha256: Mapped[str | None] = mapped_column(String, nullable=True)  # streamed in the work copy
    source_mtime: Mapped[float | None] = mapped_column(Float, nullable=True)  # export refuses a change
    las_version: Mapped[str | None] = mapped_column(String, nullable=True)
    point_format: Mapped[int | None] = mapped_column(Integer, nullable=True)
    point_count: Mapped[int | None] = mapped_column(Integer, nullable=True)  # scanned, not the header's
    has_rgb: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    scale: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [sx, sy, sz]
    crs_wkt: Mapped[str | None] = mapped_column(String, nullable=True)  # horizontal; null = no coordinates
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    proj4: Mapped[str | None] = mapped_column(String, nullable=True)
    vertical_crs: Mapped[str | None] = mapped_column(String, nullable=True)  # null = heights as stored
    crs_source: Mapped[str | None] = mapped_column(String, nullable=True)  # file | assigned
    bounds_native: Mapped[list | None] = mapped_column(JSON, nullable=True)  # true bounds, 6 numbers
    bounds_repaired: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    bounds_wgs84: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [minlon, minlat, maxlon, maxlat]
    # The octree's ROOT node spacing from metadata.json, not the point spacing (the brief's spacing_m).
    octree_spacing_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    z_stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    class_counts: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {"<code>": n}
    octree_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    captured_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    map_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("geo_map.id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class CloudMeasurement(Base):
    """A saved pick-based measurement on a point cloud (spec 2026-09-23-point-clouds section 3)."""

    __tablename__ = "cloud_measurement"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    point_cloud_id: Mapped[str] = mapped_column(String(36), ForeignKey("point_cloud.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String)  # point | distance | height | vertical
    name: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    points: Mapped[list] = mapped_column(JSON)  # [{x, y, z, uncertainty_m}] in the cloud's native CRS
    results: Mapped[dict] = mapped_column(JSON, default=dict)  # computed by the server, never the client
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_cloud_measurement_cloud", "point_cloud_id"),)


class Surface(Base):
    """A gridded surface: a cloud DSM (S2) or an imported design (S3) (spec 2026-09-23-volumes section 3)."""

    __tablename__ = "surface"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # cloud_dsm | design
    status: Mapped[str] = mapped_column(String, default="building")  # building | ready | failed
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    # A surface's tif is self-contained, so it survives its cloud.
    point_cloud_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("point_cloud.id", ondelete="SET NULL"), nullable=True
    )
    design_source: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # DesignSource; null: cloud_dsm
    crs_wkt: Mapped[str | None] = mapped_column(String, nullable=True)  # null = local metres
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cell_size_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    geotransform: Mapped[list | None] = mapped_column(JSON, nullable=True)  # GDAL order, north-up
    bounds_native: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [minx, miny, maxx, maxy]
    z_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    z_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    coverage_fraction: Mapped[float | None] = mapped_column(Float, nullable=True)
    method: Mapped[str | None] = mapped_column(String, nullable=True)  # one SurfaceMethod value
    build_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # SurfaceBuildStats; null for design
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_surface_status", "status"),)


class VolumeMeasurement(Base):
    """Cut and fill over a polygon on a top surface (spec 2026-09-23-volumes section 3)."""

    __tablename__ = "volume_measurement"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    polygon_native: Mapped[list] = mapped_column(JSON)  # [[x, y], ...] in the top surface's CRS
    top_surface_id: Mapped[str] = mapped_column(String(36), ForeignKey("surface.id", ondelete="RESTRICT"))
    base: Mapped[dict] = mapped_column(JSON)  # {kind, z?, surface_id?}
    masks: Mapped[dict] = mapped_column(JSON, default=dict)
    alignment: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="calculating")  # calculating|ready|failed|stale
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    results: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # VolumeResults
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_volume_measurement_top_surface", "top_surface_id"),)


class ProjectType(Base):
    """One entry of the project type list: a catalogue type this project uses, with a snapshot of it
    so the project renders without the catalogue (spec 2026-09-26-foundation section 7.3, F2)."""

    __tablename__ = "project_type"
    type_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    # None: the catalogue hotkey applies. "": no hotkey in this project (set only to clear a clash).
    hotkey_override: Mapped[str | None] = mapped_column(String(1), nullable=True)
    name: Mapped[str] = mapped_column(String)
    colour: Mapped[str] = mapped_column(String(7))
    kind: Mapped[str] = mapped_column(String)  # defect | object
    default_severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hotkey: Mapped[str | None] = mapped_column(String(1), nullable=True)
    group: Mapped[str | None] = mapped_column(String, nullable=True)
    refreshed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_project_type_position", "position"),)


ANCHOR_CHECK = (
    "(anchor_kind = 'image' AND image_id IS NOT NULL AND annotation_id IS NOT NULL"
    " AND map_id IS NULL AND geometry IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'map' AND map_id IS NOT NULL AND geometry IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'cloud' AND cloud_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL"
    " AND z IS NOT NULL AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL"
    " AND geometry IS NULL)"
)


class Finding(Base):
    """A defect with one anchor (spec 2026-09-26-foundation section 8.1, umbrella section 3)."""

    __tablename__ = "finding"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    number: Mapped[int] = mapped_column(Integer)  # shown as F-0217 (findings/numbers.py)
    type_id: Mapped[str] = mapped_column(String(36))  # a catalogue type id
    severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")  # open | reviewed | closed
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String, default="human")  # human | model:<id>
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_kind: Mapped[str] = mapped_column(String)  # image | map | cloud
    image_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # No ON DELETE: a box delete that skips findings/annotations.py fails loudly instead of leaving
    # a finding without its geometry and the counts wrong (plan BC, Review Focus 1).
    annotation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("box.id"), nullable=True)
    map_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # none_as_null: without it SQLAlchemy stores Python None as the JSON text 'null', which the CHECK
    # would read as NOT NULL.
    geometry: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    cloud_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    z: Mapped[float | None] = mapped_column(Float, nullable=True)
    uncertainty_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_type: Mapped[str] = mapped_column(String)  # image_set | map | point_cloud
    data_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (
        CheckConstraint(ANCHOR_CHECK, name="ck_finding_anchor"),
        CheckConstraint("status IN ('open', 'reviewed', 'closed')", name="ck_finding_status"),
        Index("ux_finding_number", "number", unique=True),
        Index("ux_finding_annotation", "annotation_id", unique=True),
        Index("ix_finding_status_severity_number", "status", "severity", "number"),
        Index("ix_finding_type", "type_id"),
        Index("ix_finding_data", "data_id"),
        Index("ix_finding_updated", "updated_at"),
        Index("ix_finding_image", "anchor_kind", "image_id"),
        Index("ix_finding_location", "lon", "lat"),
    )


class FindingAttachment(Base):
    __tablename__ = "finding_attachment"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    finding_id: Mapped[str] = mapped_column(String(36), ForeignKey("finding.id", ondelete="CASCADE"))
    path: Mapped[str] = mapped_column(String)  # relative: findings/<finding_id>/<id>.<ext>
    original_name: Mapped[str] = mapped_column(String)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_finding_attachment_finding", "finding_id", "created_at"),)


class FindingComment(Base):
    __tablename__ = "finding_comment"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    finding_id: Mapped[str] = mapped_column(String(36), ForeignKey("finding.id", ondelete="CASCADE"))
    author: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    edited_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (Index("ix_finding_comment_finding", "finding_id", "created_at"),)


class FindingCount(Base):
    """Pre-aggregated finding numbers; findings/counts.py is the only writer (spec section 8.4)."""

    __tablename__ = "finding_count"
    status: Mapped[str] = mapped_column(String, primary_key=True)
    severity: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)  # -1 = none
    type_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    n: Mapped[int] = mapped_column(Integer, default=0)


class FindingDaily(Base):
    """One row per day with a finding write: the open numbers at the end of it and its closures."""

    __tablename__ = "finding_daily"
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    open: Mapped[int] = mapped_column(Integer, default=0)  # not closed: open + reviewed
    open_by_severity: Mapped[dict] = mapped_column(JSON, default=dict)  # {"1": n, ...}
    closed: Mapped[int] = mapped_column(Integer, default=0)
    # Not in the spec's column list: KPI 2 ("n closed this week" at the top level) needs it.
    closed_by_severity: Mapped[dict] = mapped_column(JSON, default=dict)  # {"4": n, "none": n}


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    kind: Mapped[str] = mapped_column(String)
    subject_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    summary: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (Index("ix_activity_at", "at"), Index("ix_activity_subject", "subject_id", "at"))


class MigrationStep(Base):
    """MG's step records (spec section 11.4); BC only creates the table."""

    __tablename__ = "migration_step"
    name: Mapped[str] = mapped_column(String, primary_key=True)
    done_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class ClassIdMap(Base):
    """MG's old class id -> catalogue type id map (spec section 11.4 step 1)."""

    __tablename__ = "class_id_map"
    old_class_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    type_id: Mapped[str] = mapped_column(String(36))
