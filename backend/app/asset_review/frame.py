"""The asset frame (spec 2026-10-02-asset-findings §5.1 and decision A7).

Metres, Y up, X plant north, Z plant east, origin at the base centre on the ground datum. A plant
bearing is atan2(z, x) in degrees, clockwise from plant north, in [0, 360). `north_offset_deg` is the
true bearing of plant north, so a true bearing is the plant bearing plus the offset.
`line_azimuth_deg` is a true bearing too.
"""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field, field_validator

Vec3 = tuple[float, float, float]


def norm_deg(deg: float) -> float:
    """Wrap to [0, 360). `+ 0.0` turns -0.0 into 0.0 so JSON never carries a negative zero."""
    out = math.fmod(deg, 360.0)
    if out < 0:
        out += 360.0
    if out >= 360.0:
        out = 0.0
    return out + 0.0


def plant_bearing(x: float, z: float) -> float:
    """Bearing of (x, z) clockwise from plant north (+X) towards plant east (+Z)."""
    return norm_deg(math.degrees(math.atan2(z, x)))


def true_to_plant(north_m: float, east_m: float, north_offset_deg: float) -> tuple[float, float]:
    """A true north/east offset in metres as plant (x, z); plant +X points at true `north_offset_deg`."""
    a = math.radians(north_offset_deg)
    return (north_m * math.cos(a) + east_m * math.sin(a), east_m * math.cos(a) - north_m * math.sin(a))


class Origin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    ground_alt_m: float


class Preset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    target: Vec3
    camera: Vec3


class Frame(BaseModel):
    """`asset_model.frame` (spec §5.1). Every field but `height_m` has a default."""

    model_config = ConfigDict(extra="forbid")
    origin: Origin | None = None
    north_offset_deg: float = 0.0
    height_m: float = Field(gt=0)
    datum_label: str = "Ground"
    datum_note: str = ""
    line_azimuth_deg: float | None = None
    silhouette: list[tuple[float, float]] = Field(default_factory=list)  # [(y, r)], ascending y
    levels: list[float] = Field(default_factory=list)
    presets: list[Preset] = Field(default_factory=list)

    @field_validator("north_offset_deg")
    @classmethod
    def _wrap_offset(cls, v: float) -> float:
        return norm_deg(v)

    @field_validator("line_azimuth_deg")
    @classmethod
    def _wrap_line(cls, v: float | None) -> float | None:
        return None if v is None else norm_deg(v)

    @field_validator("silhouette")
    @classmethod
    def _silhouette(cls, v: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if any(r < 0 for _, r in v):
            raise ValueError("a silhouette radius is negative")
        return sorted(v, key=lambda p: p[0])

    @field_validator("levels")
    @classmethod
    def _levels(cls, v: list[float]) -> list[float]:
        return sorted(v)


def true_bearing(plant_deg: float, frame: Frame) -> float:
    return norm_deg(plant_deg + frame.north_offset_deg)
