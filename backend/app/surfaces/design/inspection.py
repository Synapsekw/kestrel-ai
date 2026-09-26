"""What a reader returns from `inspect_file` (spec §12 `DesignDetected`, `DesignCandidate`)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from app.surfaces.design.codes import DesignNote


@dataclass
class Detected:
    horizontal_unit: str | None
    vertical_unit: str | None
    unit_source: str
    crs_wkt: str | None = None
    epsg: int | None = None
    crs_source: str | None = None
    crs_hint: str | None = None

    def to_json(self) -> dict:
        return asdict(self)


@dataclass
class Candidate:
    id: str
    kind: str  # dem | tin_surface | dxf_layer
    name: str
    geometry: str  # faces | points | raster | none
    bounds_file: list[float]
    z_min: float | None
    z_max: float | None
    point_count: int
    face_count: int
    entity_counts: dict[str, int] = field(default_factory=dict)
    default_selected: bool = False
    notes: list[DesignNote] = field(default_factory=list)
    raster: dict | None = None

    def to_json(self) -> dict:
        return asdict(self)


@dataclass
class InspectResult:
    detected: Detected
    candidates: list[Candidate]
    internal: dict = field(default_factory=dict)  # stored in internal.json, not in the contract body


def candidate_from_meta(cid: str, kind: str, name: str, meta: dict, **fields) -> Candidate:
    """A Candidate whose counts, bounds and z range come from a CandidateWriter's meta."""
    return Candidate(
        id=cid,
        kind=kind,
        name=name,
        geometry=fields.pop("geometry", meta["geometry"]),
        bounds_file=meta["bbox"] or [0.0, 0.0, 0.0, 0.0],
        z_min=meta["z_min"],
        z_max=meta["z_max"],
        point_count=meta["point_count"],
        face_count=meta["face_count"],
        **fields,
    )
