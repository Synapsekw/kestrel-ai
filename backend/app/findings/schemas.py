"""Pydantic shapes of the finding schemas in contract/openapi.yaml."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.db.models import Activity, Finding

Status = Literal["open", "reviewed", "closed"]
AnchorKind = Literal["image", "map", "cloud"]


class BoxGeometry(BaseModel):
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    angle: float = 0.0


class Geometry(BaseModel):
    type: Literal["Point", "Polygon"]
    coordinates: list[Any]


class ImageAnchorIn(BaseModel):
    kind: Literal["image"]
    image_id: str
    annotation_id: str | None = None
    box: BoxGeometry | None = None

    @model_validator(mode="after")
    def _one_source(self):
        if (self.annotation_id is None) == (self.box is None):
            raise ValueError("an image anchor carries annotation_id or box: exactly one of them")
        return self


class MapAnchorIn(BaseModel):
    kind: Literal["map"]
    map_id: str
    geometry: Geometry


class CloudAnchorIn(BaseModel):
    kind: Literal["cloud"]
    cloud_id: str
    x: float
    y: float
    z: float
    uncertainty_m: float | None = Field(None, ge=0)


FindingAnchorIn = Annotated[ImageAnchorIn | MapAnchorIn | CloudAnchorIn, Field(discriminator="kind")]


class FindingCreate(BaseModel):
    type_id: str
    anchor: FindingAnchorIn
    severity: int | None = Field(None, ge=1, le=9)  # absent: the type's default; null: no severity
    note: str = Field("", max_length=20000)
    status: Status = "open"
    lon: float | None = None  # WGS84; a map anchor sends its centroid, else it is projected
    lat: float | None = None


class FindingAnchorPatch(BaseModel):
    geometry: Geometry = Field(default=None)
    x: float = Field(default=None)
    y: float = Field(default=None)
    z: float = Field(default=None)
    uncertainty_m: float | None = Field(None, ge=0)


class FindingPatch(BaseModel):
    type_id: str = Field(default=None)
    severity: int | None = Field(None, ge=1, le=9)
    status: Status = Field(default=None)
    note: str = Field(default=None, max_length=20000)
    anchor: FindingAnchorPatch = Field(default=None)


class FindingBulkSet(BaseModel):
    status: Status = Field(default=None)
    severity: int | None = Field(None, ge=1, le=9)
    type_id: str = Field(default=None)

    @model_validator(mode="after")
    def _something_to_set(self):
        if not self.model_fields_set:  # the contract's minProperties: 1
            raise ValueError("set names at least one of status, severity and type_id")
        return self


class FindingBulk(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)
    set: FindingBulkSet


class FindingBulkSkip(BaseModel):
    id: str
    code: str


class FindingBulkResult(BaseModel):
    updated: int
    skipped: list[FindingBulkSkip]


def anchor_of(r: Finding) -> dict[str, Any]:
    if r.anchor_kind == "image":
        return {"kind": "image", "image_id": r.image_id, "annotation_id": r.annotation_id}
    if r.anchor_kind == "map":
        return {"kind": "map", "map_id": r.map_id, "geometry": r.geometry}
    if r.anchor_kind == "asset":
        point = [r.ax, r.ay, r.az] if r.ax is not None else None
        normal = [r.an_x, r.an_y, r.an_z] if None not in (r.an_x, r.an_y, r.an_z) else None
        return {
            "kind": "asset",
            "asset_model_id": r.asset_model_id,
            "asset_version": r.asset_version,
            "point": point,
            "normal": normal,
        }
    return {
        "kind": "cloud",
        "cloud_id": r.cloud_id,
        "x": r.x,
        "y": r.y,
        "z": r.z,
        "uncertainty_m": r.uncertainty_m,
    }


class FindingRepresentative(BaseModel):
    image_id: str
    annotation_id: str


def representative_of(r: Finding) -> FindingRepresentative | None:
    """The sighting a finding is shown by (spec 2026-10-02-asset-findings §8). An image finding is
    its own one implicit sighting (§4 A2); map and cloud findings have none. D1 adds the asset
    branch (the representative `finding_sighting`)."""
    if r.anchor_kind == "image":
        return FindingRepresentative(image_id=r.image_id, annotation_id=r.annotation_id)
    return None


class FindingOut(BaseModel):
    id: str
    number: int
    type_id: str
    severity: int | None
    status: Status
    note: str
    created_by: str
    confidence: float | None
    anchor: dict[str, Any]
    lon: float | None
    lat: float | None
    data_type: str
    data_id: str
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None
    closed_at: datetime | None
    # Asset findings (spec 2026-10-02-asset-findings §8): read from migration 0016's columns. An
    # image, map or cloud finding has them null and one implicit sighting (§4 A2).
    asset_model_id: str | None
    height_m: float | None
    bearing_deg: float | None
    side: str | None
    zone: str | None
    component: str | None
    placement: Literal["point", "patch", "none"] | None
    sighting_count: int
    representative: FindingRepresentative | None

    @classmethod
    def from_row(cls, r: Finding) -> "FindingOut":
        return cls(
            id=r.id,
            number=r.number,
            type_id=r.type_id,
            severity=r.severity,
            status=r.status,
            note=r.note,
            created_by=r.created_by,
            confidence=r.confidence,
            anchor=anchor_of(r),
            lon=r.lon,
            lat=r.lat,
            data_type=r.data_type,
            data_id=r.data_id,
            created_at=r.created_at,
            updated_at=r.updated_at,
            reviewed_at=r.reviewed_at,
            closed_at=r.closed_at,
            asset_model_id=r.asset_model_id,
            height_m=r.height_m,
            bearing_deg=r.bearing_deg,
            side=r.side,
            zone=r.zone,
            component=r.component,
            placement=r.placement,
            sighting_count=r.sighting_count if r.anchor_kind == "asset" else 1,
            representative=representative_of(r),
        )


class FindingDetail(FindingOut):
    attachment_count: int
    comment_count: int


class FindingPage(BaseModel):
    items: list[FindingOut]
    next_cursor: str | None = None


class TypeCount(BaseModel):
    type_id: str
    n: int


class TrendDay(BaseModel):
    day: date
    open: int
    closed: int
    open_by_severity: dict[str, int]  # {"<level>": n}


class StatusCounts(BaseModel):
    open: int
    reviewed: int
    closed: int


class FindingSummary(BaseModel):
    by_status: StatusCounts
    open_by_severity: dict[str, int]  # {"<level>": n}, every level of the scale
    open_no_severity: int
    by_type: list[TypeCount]
    trend: list[TrendDay]


class ActivityOut(BaseModel):
    id: str
    at: datetime
    kind: str
    subject_id: str | None
    summary: str
    payload: dict[str, Any]

    @classmethod
    def from_row(cls, a: Activity) -> "ActivityOut":
        return cls(
            id=a.id, at=a.at, kind=a.kind, subject_id=a.subject_id, summary=a.summary, payload=a.payload or {}
        )


class ActivityPage(BaseModel):
    items: list[ActivityOut]
    next_cursor: str | None = None


class FindingCommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class FindingCommentOut(BaseModel):
    id: str
    finding_id: str
    author: str
    text: str
    created_at: datetime
    edited_at: datetime | None


class FindingCommentPage(BaseModel):
    items: list[FindingCommentOut]
    next_cursor: str | None = None


class FindingAttachmentIn(BaseModel):
    path: str = Field(min_length=1)


class FindingAttachmentOut(BaseModel):
    id: str
    finding_id: str
    path: str
    original_name: str
    width: int
    height: int
    bytes: int
    created_at: datetime


class FindingAttachmentList(BaseModel):
    items: list[FindingAttachmentOut]
