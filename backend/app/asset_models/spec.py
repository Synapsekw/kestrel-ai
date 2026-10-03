"""The model spec (spec 2026-10-02 §6.1-6.2): the single source of truth for an asset model.

Millimetres and degrees. Asset frame: Y up, X plant north, Z plant east; bearing θ points along
(cos θ, 0, sin θ). Each shape's params are validated by its own model in SHAPE_PARAMS, so adding a
shape is one params model plus one builder in `shapes.py`.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_PARTS = 2000

Pos = Annotated[float, Field(gt=0)]
NonNeg = Annotated[float, Field(ge=0)]
Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]
Pt2 = Annotated[list[float], Field(min_length=2, max_length=2)]
Unit = Annotated[float, Field(ge=0, le=1)]

Group = Literal[
    "Shell", "Head", "Bottom", "Nozzle", "Manway", "Support", "Access", "Internal", "Lining", "Other"
]
Material = Literal["paint", "steel", "rubber", "concrete", "grating", "galvanised", "glass", "other"]
Confidence = Literal["high", "medium", "low"]
Facing = Literal["up", "down"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CylinderParams(_Strict):
    id: Pos
    thickness: Pos
    height: Pos
    sweep_deg: float = Field(360, gt=0, le=360)


class ConeParams(_Strict):
    d_bottom: Pos
    d_top: NonNeg
    thickness: Pos
    height: Pos


class TorisphericalParams(_Strict):
    id: Pos
    thickness: Pos
    crown_r: Pos
    knuckle_r: Pos
    facing: Facing = "up"


class EllipsoidalParams(_Strict):
    id: Pos
    thickness: Pos
    ratio: float = Field(2.0, gt=0)
    facing: Facing = "up"


class HemisphericalParams(_Strict):
    id: Pos
    thickness: Pos
    facing: Facing = "up"


class FlatPlateParams(_Strict):
    d: Pos | None = None
    w: Pos | None = None
    l: Pos | None = None  # noqa: E741 - the drawing's own name for the length
    thickness: Pos
    slope: float | None = Field(None, description="1:n; positive is cone-up, negative cone-down")

    @model_validator(mode="after")
    def _one_outline(self):
        round_plate = self.d is not None and self.w is None and self.l is None
        rect_plate = self.d is None and self.w is not None and self.l is not None
        if not (round_plate or rect_plate):
            raise ValueError("give either d, or both w and l")
        if self.slope is not None and (self.d is None or self.slope == 0):
            raise ValueError("slope needs a round plate (d) and a non-zero 1:n")
        return self


class BoxParams(_Strict):
    w: Pos
    l: Pos  # noqa: E741
    h: Pos


class NozzleParams(_Strict):
    dn: Pos
    od: Pos
    projection: Pos
    flange_od: Pos
    flange_t: Pos
    blind: bool = False


class PipeRunParams(_Strict):
    od: Pos
    points_mm: Annotated[list[Vec3], Field(min_length=2, max_length=200)]


class LatheParams(_Strict):
    profile_mm: Annotated[list[Pt2], Field(min_length=3, max_length=500)]
    sweep_deg: float = Field(360, gt=0, le=360)


class ExtrusionParams(_Strict):
    outline_mm: Annotated[list[Pt2], Field(min_length=3, max_length=500)]
    height: Pos


class SweepParams(_Strict):
    section: Literal["circle", "rect"]
    r: Pos | None = None
    w: Pos | None = None
    h: Pos | None = None
    path_mm: Annotated[list[Vec3], Field(min_length=2, max_length=500)]

    @model_validator(mode="after")
    def _section_size(self):
        if self.section == "circle" and self.r is None:
            raise ValueError("a circle section needs r")
        if self.section == "rect" and (self.w is None or self.h is None):
            raise ValueError("a rect section needs w and h")
        return self


SHAPE_PARAMS: dict[str, type[BaseModel]] = {
    "cylinder": CylinderParams,
    "cone": ConeParams,
    "head_torispherical": TorisphericalParams,
    "head_ellipsoidal": EllipsoidalParams,
    "head_hemispherical": HemisphericalParams,
    "flat_plate": FlatPlateParams,
    "box": BoxParams,
    "nozzle": NozzleParams,
    "pipe_run": PipeRunParams,
    "lathe": LatheParams,
    "extrusion": ExtrusionParams,
    "sweep": SweepParams,
}
Shape = Literal[
    "cylinder",
    "cone",
    "head_torispherical",
    "head_ellipsoidal",
    "head_hemispherical",
    "flat_plate",
    "box",
    "nozzle",
    "pipe_run",
    "lathe",
    "extrusion",
    "sweep",
]
SHELL_HOSTS = frozenset({"cylinder", "cone"})
HEAD_HOSTS = frozenset({"head_torispherical", "head_ellipsoidal", "head_hemispherical", "flat_plate"})


class Placement(_Strict):
    origin_mm: Vec3 = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    axis: Vec3 = Field(default_factory=lambda: [0.0, 1.0, 0.0])
    host: str | None = None
    bearing_deg: float | None = None
    elevation_mm: float | None = None
    e_mm: float | None = None
    n_mm: float | None = None

    @model_validator(mode="after")
    def _mounting(self):
        if sum(abs(c) for c in self.axis) == 0:
            raise ValueError("axis must not be zero")
        if self.host is None:
            if any(v is not None for v in (self.bearing_deg, self.elevation_mm, self.e_mm, self.n_mm)):
                raise ValueError("bearing_deg, elevation_mm, e_mm and n_mm need a host")
            return self
        shell = self.bearing_deg is not None or self.elevation_mm is not None
        head = self.e_mm is not None or self.n_mm is not None
        if shell == head:
            raise ValueError("a hosted part needs bearing_deg and elevation_mm, or e_mm and n_mm")
        if shell and (self.bearing_deg is None or self.elevation_mm is None):
            raise ValueError("a shell-mounted part needs both bearing_deg and elevation_mm")
        if head and (self.e_mm is None or self.n_mm is None):
            raise ValueError("a head-mounted part needs both e_mm and n_mm")
        return self


class Source(_Strict):
    kind: Literal["drawing", "cloud", "photo", "assumed", "operator"]
    id: str | None = None
    page: int | None = Field(None, ge=1, le=10_000)
    region: Annotated[list[Unit], Field(min_length=4, max_length=4)] | None = None
    note: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def _region_order(self):
        if self.region is not None:
            x0, y0, x1, y1 = self.region
            if x1 <= x0 or y1 <= y0:
                raise ValueError("region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0")
        if self.kind not in ("assumed", "operator") and not self.id:
            raise ValueError("a drawing, cloud or photo source needs its id")
        return self


class Part(_Strict):
    id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_.\-]{1,64}$")]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    group: Group
    shape: Shape
    params: dict[str, Any]
    placement: Placement = Field(default_factory=Placement)
    material: Material = "steel"
    source: Source
    confidence: Confidence = "medium"
    note: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def _params_match_shape(self):
        SHAPE_PARAMS[self.shape].model_validate(self.params)
        return self

    def typed_params(self) -> BaseModel:
        return SHAPE_PARAMS[self.shape].model_validate(self.params)


class AssetInfo(_Strict):
    tag: str | None = Field(None, max_length=80)
    type: str | None = Field(None, max_length=80)
    name: str | None = Field(None, max_length=120)
    frame_note: str | None = Field(None, max_length=500)
    plant_to_true_north_deg: float | None = None
    attributes: dict[str, str] = Field(default_factory=dict)


# ----- plant (spec 2026-10-03-plant-model-generator §5; plan 2026-10-03-plant-model-f0 Task 2) -----
# Plant metres: [E, N] in the drawing's plant grid, elevations as plant EL. M1 parts stay millimetres.

MAX_ITEMS = 20_000
MAX_ENV = 2_000

ItemId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_.\-]{1,64}$")]
HeightSource = Literal["drawing", "cloud", "indicative"]
EnvKind = Literal["land", "sea", "road", "paved", "laydown", "slope", "revetment"]
FlagCode = Literal[
    "plan_offset",
    "height_mismatch",
    "missing_in_cloud",
    "unregistered",
    "builder_fallback",
    "straddles_package",
]


class SiteCrs(_Strict):
    epsg: int | None = Field(None, ge=1024, le=999_999)
    wkt: str | None = Field(None, max_length=20_000)


class Datum(_Strict):
    label: str = Field("EL", min_length=1, max_length=40)
    el_m: float = 0.0


class CloudDatum(_Strict):
    """plant EL = cloud z + offset_m (+ tilt · [dx, dy])."""

    cloud_id: str = Field(min_length=1, max_length=64)
    offset_m: float
    tilt: tuple[float, float] | None = None


class SiteFrame(_Strict):
    """The plant grid: [X, Y] = origin_crs + R(plant_north_deg)·[E, N], with R(θ) = [[cos θ, sin θ],
    [-sin θ, cos θ]] (siteframe.PlantGrid). Its contract schema is PlantFrame, because the map
    workspace's SiteFrame is another schema."""

    crs: SiteCrs
    origin_crs: tuple[float, float]
    plant_north_deg: float = Field(ge=-360, le=360)
    datum: Datum = Field(default_factory=Datum)
    cloud_z_to_el: CloudDatum | None = None
    source: Source


class RectFootprint(_Strict):
    """size = (along, across); the along axis points rot_deg clockwise from plant north."""

    kind: Literal["rect"]
    center: Pt2
    size: tuple[Pos, Pos]
    rot_deg: float = 0


class CircleFootprint(_Strict):
    kind: Literal["circle"]
    center: Pt2
    d: Pos


class PolygonFootprint(_Strict):
    kind: Literal["polygon"]
    pts: Annotated[list[Pt2], Field(min_length=3, max_length=500)]


class LineFootprint(_Strict):
    kind: Literal["line"]
    pts: Annotated[list[Pt2], Field(min_length=2, max_length=500)]
    width: Pos


Footprint = Annotated[
    RectFootprint | CircleFootprint | PolygonFootprint | LineFootprint, Field(discriminator="kind")
]


class ItemFlag(_Strict):
    code: FlagCode
    value: float | None = None
    note: str | None = Field(None, max_length=300)


class Item(_Strict):
    """One plant item. `type` is a builder type, checked by validate() against the registry, not by
    this schema (spec §15). `parts` are M1 parts in item-local millimetres: origin at the footprint's
    reference point (siteframe.footprint_ref) at base_el, Y up, X plant north, Z plant east."""

    id: ItemId
    tag: str | None = Field(None, max_length=80)
    name: Annotated[str, Field(min_length=1, max_length=200)]
    type: Annotated[str, Field(min_length=1, max_length=64)]
    area: str | None = Field(None, max_length=80)
    footprint: Footprint
    base_el: float | None = None
    top_el: float | None = None
    levels: Annotated[list[float], Field(max_length=50)] = Field(default_factory=list)
    params: dict[str, Any] = Field(default_factory=dict)
    height_source: HeightSource = "indicative"
    source: Source
    confidence: Confidence = "medium"
    flags: Annotated[list[ItemFlag], Field(max_length=20)] = Field(default_factory=list)
    parts: Annotated[list[Part], Field(max_length=MAX_PARTS)] = Field(default_factory=list)
    notes: str | None = Field(None, max_length=1000)


class EnvFeature(_Strict):
    id: ItemId
    kind: EnvKind
    pts: Annotated[list[Pt2], Field(min_length=3, max_length=5000)]
    el: float
    source: Source
    confidence: Confidence = "medium"


class AssetSpec(_Strict):
    asset: AssetInfo = Field(default_factory=AssetInfo)
    parts: Annotated[list[Part], Field(max_length=MAX_PARTS)] = Field(default_factory=list)
    site: SiteFrame | None = None
    items: Annotated[list[Item], Field(max_length=MAX_ITEMS)] = Field(default_factory=list)
    environment: Annotated[list[EnvFeature], Field(max_length=MAX_ENV)] = Field(default_factory=list)
