"""Review profiles (spec 2026-10-02-asset-findings §7, decision A6).

Ported from the asset-inspection kit's `profiles/*.yaml`: only the review settings, never the class
lists (catalogue types stay the source of classes). `resolve` turns a profile and an asset height
into the `asset_model.review` copy (spec §5.1), with zones in metres, top first.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

COMPASS: tuple[str, ...] = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
DEFAULT_PATCH_GRID = 48  # kit project.run(grid=48)
DEFAULT_FRUSTUM = (0.05, 0.125)  # kit engine.js focusFrustum default
#: Kit `job.profile` names (hyphenated) to Kestrel profile ids.
KIT_PROFILE_IDS = {
    "stack": "stack",
    "building-facade": "building_facade",
    "tank": "tank",
    "telecom-tower": "telecom_tower",
    "ohtl-tower": "ohtl_tower",
}

FindingUnit = Literal["photo", "region"]
PlacementMode = Literal["patch", "point", "mixed"]


class UnknownProfile(ValueError):
    def __init__(self, profile_id: str) -> None:
        super().__init__(f"unknown review profile {profile_id!r}")
        self.profile_id = profile_id


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Sides(_Model):
    type: Literal["compass", "faces"] = "compass"
    labels: list[str] = Field(default_factory=list)
    basis: Literal["position", "normal"] = "position"
    title: str
    noun: str = "side"

    @model_validator(mode="before")
    @classmethod
    def _compass_labels(cls, data: Any) -> Any:
        """Compass labels are always the eight points; only faces carry their own labels."""
        if isinstance(data, dict) and data.get("type", "compass") == "compass":
            return {**data, "labels": list(COMPASS)}
        return data

    @model_validator(mode="after")
    def _face_labels(self) -> Sides:
        if self.type == "faces" and len(self.labels) < 2:
            raise ValueError("faces sides need at least two labels")
        return self


class Focus(_Model):
    frustum: tuple[float, float] = DEFAULT_FRUSTUM
    oblique_deg: float = 0.0


class ReportOptions(_Model):
    pages: Literal["finding", "defect"] = "finding"
    min_severity: int = Field(default=1, ge=1, le=3)


class ComponentRule(_Model):
    match: str  # a regular expression over the GLB node name, case-insensitive
    label: str


class Limit(_Model):
    title: str
    text: str


class ProfileZone(_Model):
    id: str
    label: str
    from_frac: float = Field(ge=0, le=1)
    to_frac: float = Field(ge=0, le=1)


class Profile(_Model):
    id: str
    name: str
    asset_noun: str
    finding_noun: str
    assessment_title: str
    finding_unit: FindingUnit
    placement: PlacementMode
    patch_grid: int = DEFAULT_PATCH_GRID
    cluster_m: float | None = None  # None: max(0.75, 0.02 H)
    zones: list[ProfileZone]  # top first
    sides: Sides
    focus: Focus = Focus()
    report: ReportOptions = ReportOptions()
    component_map: list[ComponentRule] = Field(default_factory=list)
    facts: list[str]
    limits: list[Limit]
    breakdowns: list[str]
    footer_disclaimer: str


class ReviewZone(_Model):
    id: str
    label: str
    min_m: float | None = None  # None: open below
    max_m: float | None = None  # None: open above


def _zone_key(z: ReviewZone) -> tuple[float, float]:
    top = math.inf if z.max_m is None else z.max_m
    bottom = -math.inf if z.min_m is None else z.min_m
    return (-top, -bottom)


class ReviewConfig(_Model):
    """`asset_model.review` (spec §5.1): a resolved, editable copy of a profile."""

    profile_id: str
    name: str
    asset_noun: str
    finding_noun: str
    assessment_title: str
    finding_unit: FindingUnit
    placement: PlacementMode
    patch_grid: int = Field(ge=2, le=128)
    cluster_m: float = Field(gt=0)
    zones: list[ReviewZone]
    sides: Sides
    focus: Focus
    report: ReportOptions
    component_map: list[ComponentRule]
    facts: list[str]
    limits: list[Limit]
    breakdowns: list[str]
    footer_disclaimer: str

    @field_validator("zones")
    @classmethod
    def _top_first(cls, v: list[ReviewZone]) -> list[ReviewZone]:
        return sorted(v, key=_zone_key)


def _limits(visual: str, draft: str, approx: str) -> list[Limit]:
    """The kit's three report limits, in its order."""
    return [
        Limit(title="Visual only", text=visual),
        Limit(title="Draft, unvalidated", text=draft),
        Limit(title="Approximate positions", text=approx),
    ]


_STACK = Profile(
    id="stack",
    name="Stack, chimney or flare",
    asset_noun="stack",
    finding_noun="candidate corrosion",
    assessment_title="Visual corrosion inspection report",
    finding_unit="photo",
    placement="patch",
    zones=[
        ProfileZone(id="head", label="Top / head", from_frac=0.92, to_frac=1.0),
        ProfileZone(id="shaft", label="Shaft / access", from_frac=0.19, to_frac=0.92),
        ProfileZone(id="base", label="Base / inlet", from_frac=0.0, to_frac=0.19),
    ],
    sides=Sides(type="compass", title="Side of the stack (approximate bearing)"),
    facts="severity height zone component side coverage photo captured position camera".split(),
    limits=_limits(
        "Grades describe what corrosion looks like in the photo. They do not measure metal loss, "
        "pitting depth or fitness for service.",
        "Fine or low-contrast corrosion can be missed, and similar-looking coatings or deposits can be "
        "marked.",
        "The model and camera poses are estimated from photos and GPS. Positions guide the eye; they are "
        "not surveyed locations.",
    ),
    breakdowns=["zone", "component"],
    footer_disclaimer="Draft visual assessment. Not an engineering or fitness-for-service assessment.",
)

_BUILDING_FACADE = Profile(
    id="building_facade",
    name="Building facade",
    asset_noun="building",
    finding_noun="facade defects",
    assessment_title="Facade visual inspection report",
    finding_unit="region",
    placement="mixed",
    patch_grid=14,
    cluster_m=1.5,
    zones=[
        ProfileZone(id="roof", label="Roof and crown", from_frac=0.88, to_frac=1.0),
        ProfileZone(id="upper", label="Upper floors", from_frac=0.55, to_frac=0.88),
        ProfileZone(id="middle", label="Middle floors", from_frac=0.3, to_frac=0.55),
        ProfileZone(id="lower", label="Lower floors", from_frac=0.16, to_frac=0.3),
        ProfileZone(id="podium", label="Podium", from_frac=0.0, to_frac=0.16),
    ],
    sides=Sides(
        type="faces",
        basis="normal",
        labels=["North elevation", "East elevation", "South elevation", "West elevation"],
        title="Elevation (direction the facade faces)",
        noun="elevation",
    ),
    focus=Focus(frustum=(0.14, 0.26), oblique_deg=28.0),
    report=ReportOptions(pages="defect", min_severity=2),
    facts="severity class defect height zone component side photo captured".split(),
    limits=_limits(
        "Findings describe what is visible in the photos. Sealant adhesion, fixings, water tightness "
        "and glass stress are not tested.",
        "Fine cracks, sealant gaps and low-contrast defects can be missed, and reflections can look "
        "like defects. Confirm on site before repair planning.",
        "Floors, elevations and positions come from GPS, gimbal angles and a reconstructed 3D model; "
        "they are not surveyed locations.",
    ),
    breakdowns=["side", "class", "zone"],
    footer_disclaimer="Draft visual facade assessment. Not a facade engineering or structural assessment.",
)

_TANK = Profile(
    id="tank",
    name="Tank, silo or vessel",
    asset_noun="tank",
    finding_noun="defects",
    assessment_title="Tank visual inspection report",
    finding_unit="region",
    placement="patch",
    zones=[
        ProfileZone(id="roof", label="Roof", from_frac=0.9, to_frac=1.0),
        ProfileZone(id="shell", label="Shell courses", from_frac=0.1, to_frac=0.9),
        ProfileZone(id="bottom", label="Bottom course / foundation", from_frac=0.0, to_frac=0.1),
    ],
    sides=Sides(type="compass", title="Side of the tank (approximate bearing)"),
    facts="severity class defect height zone component side coverage photo captured position camera".split(),
    limits=_limits(
        "Findings describe the visible surface. Wall thickness, pitting depth and fitness for service "
        "are not measured.",
        "Findings under insulation or low-contrast coatings can be missed. Confirm before repair planning.",
        "Heights and bearings come from estimated camera poses and the 3D model; they are not surveyed.",
    ),
    breakdowns=["class", "zone", "component"],
    footer_disclaimer="Visual inspection. Not an API 653 / fitness-for-service assessment.",
)

_TELECOM_TOWER = Profile(
    id="telecom_tower",
    name="Telecom tower or mast",
    asset_noun="tower",
    finding_noun="defects",
    assessment_title="Tower visual inspection report",
    finding_unit="region",
    placement="point",
    zones=[
        ProfileZone(id="antenna", label="Antenna zone", from_frac=0.8, to_frac=1.0),
        ProfileZone(id="body", label="Tower body", from_frac=0.1, to_frac=0.8),
        ProfileZone(id="base", label="Base / foundation", from_frac=0.0, to_frac=0.1),
    ],
    sides=Sides(type="compass", title="Side of the tower (approximate bearing)"),
    facts="severity class defect height zone component side photo captured position camera".split(),
    limits=_limits(
        "Findings describe what is visible in the photos. Torque, section loss and structural capacity "
        "are not measured.",
        "Small or hidden defects can be missed. Every critical finding needs confirmation on site.",
        "Heights and faces come from estimated camera poses and the 3D model. They guide a climber; they "
        "are not surveyed.",
    ),
    breakdowns=["class", "zone", "component"],
    footer_disclaimer="Visual inspection. Not a structural or load-capacity assessment.",
)

_OHTL_TOWER = Profile(
    id="ohtl_tower",
    name="Transmission tower (OHTL)",
    asset_noun="tower",
    finding_noun="defects",
    assessment_title="Transmission tower visual inspection report",
    finding_unit="region",
    placement="point",
    zones=[
        ProfileZone(id="peak", label="Peak and earthwire", from_frac=0.88, to_frac=1.0),
        ProfileZone(id="arms", label="Crossarms and insulators", from_frac=0.55, to_frac=0.88),
        ProfileZone(id="body", label="Tower body", from_frac=0.12, to_frac=0.55),
        ProfileZone(id="legs", label="Legs and foundation", from_frac=0.0, to_frac=0.12),
    ],
    sides=Sides(
        type="faces",
        labels=["Line ahead", "Right face", "Line back", "Left face"],
        title="Face (relative to the line)",
        noun="face",
    ),
    facts="severity class defect height zone component side photo captured position camera".split(),
    limits=_limits(
        "Findings describe what is visible in the photos. Electrical condition, clearances and loading "
        "are not measured.",
        "Hairline cracks and hidden damage can be missed. Confirm critical findings before switching or "
        "climbing.",
        "Heights and faces come from estimated camera poses and the 3D model. They guide a line crew; "
        "they are not surveyed.",
    ),
    breakdowns=["class", "zone", "component"],
    footer_disclaimer="Visual inspection. Not an electrical or structural assessment.",
)

#: The five built-ins (spec §7), by id.
PROFILES: dict[str, Profile] = {
    p.id: p for p in (_STACK, _BUILDING_FACADE, _TANK, _TELECOM_TOWER, _OHTL_TOWER)
}


def _deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    """Kit `config.deep_merge`: dicts merge key by key, everything else replaces."""
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _metre_zones(zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Zones in metres, from either `min_m`/`max_m` or the kit's `job.asset.zones` `min`/`max`."""
    out = []
    for z in zones:
        lo = z.get("min_m", z.get("min"))
        hi = z.get("max_m", z.get("max"))
        out.append(
            {
                "id": z["id"],
                "label": z["label"],
                "min_m": None if lo is None else float(lo),
                "max_m": None if hi is None else float(hi),
            }
        )
    return out


def _mm(v: float) -> float:
    return round(v, 3)


def resolve(profile_id: str, height_m: float, overrides: dict[str, Any] | None = None) -> ReviewConfig:
    """The review copy for an asset `height_m` tall. `overrides` is merged over the profile (kit
    `deep_merge` rules); `overrides["zones"]`, when given, replaces the zones and is in metres."""
    try:
        p = PROFILES[profile_id]
    except KeyError:
        raise UnknownProfile(profile_id) from None
    if not height_m > 0:
        raise ValueError("height_m must be positive")
    base = p.model_dump(mode="json", exclude={"id", "zones", "cluster_m"})
    base["profile_id"] = p.id
    base["cluster_m"] = p.cluster_m if p.cluster_m is not None else _mm(max(0.75, 0.02 * height_m))
    base["zones"] = [
        {
            "id": z.id,
            "label": z.label,
            "min_m": None if z.from_frac <= 0 else _mm(z.from_frac * height_m),
            "max_m": None if z.to_frac >= 1 else _mm(z.to_frac * height_m),
        }
        for z in p.zones
    ]
    over = copy.deepcopy(overrides or {})
    if "zones" in over:
        over["zones"] = _metre_zones(over["zones"])
    return ReviewConfig.model_validate(_deep_merge(base, over))


def profile_id_for_kit(name: str) -> str:
    """A kit profile name (`building-facade`) as a Kestrel id (`building_facade`)."""
    try:
        return KIT_PROFILE_IDS[name]
    except KeyError:
        raise UnknownProfile(name) from None
