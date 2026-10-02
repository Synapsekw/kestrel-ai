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
    model_config = ConfigDict(extra="forbid")


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
        if (self.d is None) == (self.w is None or self.l is None):
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
    kind: Literal["drawing", "cloud", "photo", "assumed"]
    id: str | None = None
    region: Annotated[list[Unit], Field(min_length=4, max_length=4)] | None = None
    note: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def _region_order(self):
        if self.region is not None:
            x0, y0, x1, y1 = self.region
            if x1 <= x0 or y1 <= y0:
                raise ValueError("region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0")
        if self.kind != "assumed" and not self.id:
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


class AssetSpec(_Strict):
    asset: AssetInfo = Field(default_factory=AssetInfo)
    parts: Annotated[list[Part], Field(max_length=MAX_PARTS)] = Field(default_factory=list)
