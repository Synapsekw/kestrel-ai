"""Read a review kit job folder (spec 2026-10-02-asset-findings §6.5).

The folder holds `job.yaml`, `cameras.json`, `assessment.json`, and optionally `merged.json`,
`sequences.json`, `masks/<photo>.png`, `surface.json` and the GLB. The formats are the kit's own
(`kit/config.py`, `kit/records.py`, `kit/adapters/*` in the asset-inspection kit, the operator's
code). Everything here is a read. The JSON files are a few MB at most and are parsed whole;
`surface.json` (up to 20 MB) is never opened here, `kit_replay` streams it.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from PIL import Image as PILImage

from app.asset_review import profiles

KIT_PREVIEW_LONG_EDGE = 2560  # the kit's review copies (kit/cameras.py `from_exif`)
UNCLASSIFIED = "unclassified"  # the class key of a kit finding with no class
PROFILE_IDS = profiles.KIT_PROFILE_IDS
STATUS = {
    "finding": "finding",
    "none": "none",
    "uncertain": "uncertain",
    "not-assessed": "not_assessed",
    "not_assessed": "not_assessed",
    # the older review-package spellings (kit/adapters/review_package.py STATUS)
    "corrosion-candidate": "finding",
    "uncertain-only": "uncertain",
    "no-confident-finding": "none",
}
STATUSES = ("finding", "none", "uncertain", "not_assessed")
SEVERITY_WORDS = {  # spec A8
    "light": 1,
    "minor": 1,
    "moderate": 2,
    "significant": 2,
    "heavy": 3,
    "severe": 3,
    "critical": 3,
}


class KitError(ValueError):
    """A kit folder this import cannot read. The message is written for the operator."""


@dataclass(frozen=True)
class KitClass:
    id: int  # the value in the class-index masks
    key: str
    label: str
    severity: int | None
    color: str
    uncertain: bool = False


# The kit's profiles/*.yaml classes. A job's `profile.classes` replaces the list (kit deep_merge).
KIT_CLASSES: dict[str, tuple[KitClass, ...]] = {
    "stack": (
        KitClass(1, "light", "Light visual staining / surface oxidation", 1, "#fad34b"),
        KitClass(2, "moderate", "Moderate visible rust", 2, "#ff7a2d"),
        KitClass(3, "heavy", "Heavy visible deterioration", 3, "#ee3f4b"),
        KitClass(4, "uncertain", "Uncertain / heat affected", None, "#b68ef8", True),
    ),
    "building-facade": (
        KitClass(1, "glazing", "Glazing damage", 3, "#ee3f4b"),
        KitClass(2, "sealant", "Sealant or gasket failure", 2, "#ff7a2d"),
        KitClass(3, "cladding", "Cladding or coating damage", 2, "#e94b9a"),
        KitClass(4, "staining", "Staining or run-off", 1, "#c9a227"),
        KitClass(5, "soiling", "Glazing soiling (clean)", 1, "#fad34b"),
        KitClass(6, "corrosion", "Corrosion on metalwork", 2, "#b5651d"),
        KitClass(7, "balustrade", "Balustrade or handrail defect", 2, "#34a6d9"),
        KitClass(8, "object", "Loose or foreign object", 2, "#7cc46b"),
        KitClass(9, "water", "Water or damp marks", 2, "#2f7fd8"),
        KitClass(10, "thermal", "Thermal anomaly", 1, "#ff4fd8"),
        KitClass(99, "uncertain", "Uncertain", None, "#b68ef8", True),
    ),
    "tank": (
        KitClass(1, "coating", "Coating breakdown / blistering", None, "#fad34b"),
        KitClass(2, "corrosion", "Visible corrosion", None, "#ff7a2d"),
        KitClass(3, "seam", "Weld or seam staining / weeping", None, "#ee3f4b"),
        KitClass(4, "deformation", "Dent, bulge or deformation", None, "#e94b9a"),
        KitClass(5, "fitting", "Nozzle, stair, handrail or fitting damage", None, "#34a6d9"),
        KitClass(6, "insulation", "Insulation or cladding damage", None, "#7cc46b"),
        KitClass(9, "uncertain", "Uncertain, needs a closer look", None, "#b68ef8", True),
    ),
    "telecom-tower": (
        KitClass(1, "corrosion", "Corrosion on steelwork or fasteners", None, "#ff7a2d"),
        KitClass(2, "fastener", "Missing or loose fastener", None, "#ee3f4b"),
        KitClass(3, "antenna", "Antenna or mount misalignment / damage", None, "#e94b9a"),
        KitClass(4, "cable", "Cable, tray or clamp issue", None, "#34a6d9"),
        KitClass(5, "coating", "Paint / galvanising breakdown", None, "#fad34b"),
        KitClass(6, "foreign", "Bird nest or foreign object", None, "#7cc46b"),
        KitClass(7, "lighting", "Aviation light or earthing defect", None, "#9d7bea"),
        KitClass(9, "uncertain", "Uncertain, needs a closer look", None, "#b68ef8", True),
    ),
    "ohtl-tower": (
        KitClass(1, "insulator", "Insulator damage (chipped, flashover, broken shed)", None, "#ee3f4b"),
        KitClass(2, "conductor", "Conductor / jumper damage or broken strands", None, "#e94b9a"),
        KitClass(3, "hardware", "Fittings, clamps, dampers displaced or missing", None, "#ff7a2d"),
        KitClass(4, "member", "Missing, bent or damaged tower member", None, "#c0392b"),
        KitClass(5, "corrosion", "Corrosion on steelwork or bolts", None, "#fad34b"),
        KitClass(6, "nest", "Bird nest or foreign object", None, "#7cc46b"),
        KitClass(7, "vegetation", "Vegetation encroachment", None, "#2e9e6a"),
        KitClass(8, "signage", "Missing danger plate, number plate or anti-climb", None, "#34a6d9"),
        KitClass(9, "uncertain", "Uncertain, needs a closer look", None, "#b68ef8", True),
    ),
}


@dataclass(frozen=True)
class KitPhoto:
    id: str
    name: str
    source_name: str
    width: int
    height: int
    time: str | None = None
    sequence: str = "1"
    position: tuple[float, float, float] | None = None
    target: tuple[float, float, float] | None = None
    up: tuple[float, float, float] = (0.0, 1.0, 0.0)
    hfov: float | None = None
    vfov: float | None = None
    file: str | None = None


@dataclass(frozen=True)
class KitFinding:
    key: str
    photo: str
    cls: str | None
    severity: int | None
    bbox: tuple[float, float, float, float] | None  # preview px, x0 y0 x1 y1
    polygon: list[list[float]] | None  # preview px, from merged.json
    note: str = ""
    component: str | None = None
    group: str | None = None
    order: int = 0


DEFAULT_STATUS: dict[str, Any] = {
    "status": "not_assessed",
    "note": "",
    "severity": None,
    "coverage": None,
    "uncertain": None,
}


@dataclass
class Kit:
    folder: Path
    kit_profile: str
    profile_id: str
    unit: str  # region | photo
    profile_overrides: dict[str, Any]
    classes: tuple[KitClass, ...]
    asset: dict[str, Any]
    sequences: dict[str, str]
    alignment: dict[str, Any]
    photos: list[KitPhoto]
    statuses: dict[str, dict[str, Any]]
    findings: list[KitFinding]
    mask_dir: Path | None
    surface_path: Path | None
    glb_path: Path | None

    def mask_path(self, photo_id: str) -> Path | None:
        if self.mask_dir is None:
            return None
        p = self.mask_dir / f"{photo_id}.png"
        return p if p.is_file() else None

    def photo_file(self, photo: KitPhoto) -> Path | None:
        if not photo.file:
            return None
        p = Path(photo.file)
        p = p if p.is_absolute() else self.folder / p
        return p if p.is_file() else None

    def class_by_key(self, key: str) -> KitClass | None:
        return next((c for c in self.classes if c.key == key), None)

    def finding_class_ids(self) -> set[int]:
        return {c.id for c in self.classes if not c.uncertain}

    def uncertain_class_ids(self) -> set[int]:
        return {c.id for c in self.classes if c.uncertain}

    def status_of(self, photo_id: str) -> dict[str, Any]:
        return self.statuses.get(photo_id) or dict(DEFAULT_STATUS)

    def photo_unit_key(self, severity: int | None) -> str:
        """The class key a photo-unit finding maps through: the graded class of its severity,
        else the first graded class."""
        graded = [c for c in self.classes if not c.uncertain]
        for c in graded:
            if c.severity == severity:
                return c.key
        return graded[0].key if graded else UNCLASSIFIED


def number(value) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def severity_of(value) -> int | None:
    """A kit grade as 1..3 (spec A8), or None for "no grade"."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        n = int(value)
        return n if 1 <= n <= 3 else None
    word = str(value).strip().lower()
    if word.isdigit():
        return severity_of(int(word))
    return SEVERITY_WORDS.get(word)


def _text(value) -> str | None:
    if value is None:
        return None
    t = str(value).strip()
    return t or None


def _vec3(value) -> tuple[float, float, float] | None:
    try:
        x, y, z = (float(c) for c in value)
    except (TypeError, ValueError):
        return None
    return (x, y, z) if all(math.isfinite(c) for c in (x, y, z)) else None


def _bbox(value) -> tuple[float, float, float, float] | None:
    try:
        x0, y0, x1, y1 = (float(c) for c in value)
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(c) for c in (x0, y0, x1, y1)):
        return None
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def _points(value) -> list[list[float]] | None:
    try:
        pts = [[float(p[0]), float(p[1])] for p in value]
    except (TypeError, ValueError, IndexError):
        return None
    if len(pts) < 3 or not all(math.isfinite(c) for p in pts for c in p):
        return None
    return pts


def merged_key(photo: str, cls: str | None, bbox: tuple[float, float, float, float]) -> tuple:
    return (photo, cls, tuple(round(c, 1) for c in bbox))


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except FileNotFoundError:
        raise KitError("The kit folder has no job.yaml.") from None
    except (OSError, yaml.YAMLError) as e:
        raise KitError(f"job.yaml could not be read: {type(e).__name__}.") from None
    if not isinstance(data, dict):
        raise KitError("job.yaml is not a kit job file.")
    return data


def _load_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise KitError(f"The kit folder has no {label}.") from None
    except (OSError, ValueError) as e:
        raise KitError(f"{label} could not be read: {type(e).__name__}.") from None


def _list(value, label: str) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        raise KitError(f"{label} is not a list.")
    return value


def _mapping(value, label: str) -> dict:
    """A YAML or JSON section that must be a mapping; absent or empty reads as {}."""
    if value is None or value == "":
        return {}
    if not isinstance(value, dict):
        raise KitError(f"{label} is not laid out as a kit expects.")
    return value


def _class_of(c: dict) -> KitClass:
    if not isinstance(c, dict):
        raise KitError("job.yaml lists a profile class that is not an entry with an id and key.")
    try:
        return KitClass(
            int(c["id"]),
            str(c["key"]),
            str(c.get("label") or c["key"]),
            severity_of(c.get("severity")),
            str(c.get("color") or "#ff7a2d"),
            bool(c.get("uncertain")),
        )
    except (KeyError, TypeError, ValueError):
        raise KitError("job.yaml lists a profile class without an id or key.") from None


def _photo(c: dict) -> KitPhoto:
    if not isinstance(c, dict):
        raise KitError("cameras.json lists a photo that is not an entry with an id, width and height.")
    try:
        photo = KitPhoto(
            id=str(c["id"]),
            name=str(c.get("name") or ""),
            source_name=str(c.get("source_name") or c.get("name") or ""),
            width=int(c["width"]),
            height=int(c["height"]),
            time=_text(c.get("time")),
            sequence=str(c.get("sequence") or "1"),
            position=_vec3(c.get("position")),
            target=_vec3(c.get("target")),
            up=_vec3(c.get("up")) or (0.0, 1.0, 0.0),
            hfov=number(c.get("hfov")),
            vfov=number(c.get("vfov")),
            file=_text(c.get("file")),
        )
    except (KeyError, TypeError, ValueError):
        raise KitError(
            f"cameras.json has a photo without an id, width or height ({c.get('id')!r})."
        ) from None
    if photo.width <= 0 or photo.height <= 0:
        raise KitError(f"cameras.json gives photo {photo.id!r} a width or height of zero or less.")
    return photo


def _status(value) -> dict[str, Any]:
    v = value if isinstance(value, dict) else {}
    return {
        "status": STATUS.get(str(v.get("status") or ""), "not_assessed"),
        "note": str(v.get("note") or ""),
        "severity": severity_of(v.get("severity")),
        "coverage": number(v.get("coverage")),
        "uncertain": number(v.get("uncertain")),
    }


def _merged_polygons(data) -> dict[tuple, list[list[float]]]:
    out: dict[tuple, list[list[float]]] = {}
    for m in data if isinstance(data, list) else []:
        if not isinstance(m, dict) or not m.get("polygon") or m.get("space", "preview") != "preview":
            continue
        bbox, poly = _bbox(m.get("bbox")), _points(m["polygon"])
        if bbox is None or poly is None:
            continue
        cls = None if m.get("class") is None else str(m["class"])
        out[merged_key(str(m.get("image") or ""), cls, bbox)] = poly
    return out


def _finding(f: dict, i: int, polygons: dict, class_keys: dict[int, str]) -> KitFinding:
    if not isinstance(f, dict):
        raise KitError("assessment.json lists a finding that is not an entry.")
    photo = str(f.get("photo") or "")
    cls = f.get("class")
    if isinstance(cls, int) and not isinstance(cls, bool):
        cls = class_keys.get(cls)  # kit/records.py accepts a class id too
    cls = None if cls in (None, "") else str(cls)
    bbox = _bbox(f.get("bbox"))
    return KitFinding(
        key=str(f.get("id") or f"{photo}#{i}"),
        photo=photo,
        cls=cls,
        severity=severity_of(f.get("severity")),
        bbox=bbox,
        polygon=polygons.get(merged_key(photo, cls, bbox)) if bbox is not None else None,
        note=str(f.get("note") or ""),
        component=_text(f.get("component")),
        group=_text(f.get("group")),
        order=i,
    )


def _sequences(folder: Path, raw: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    side = folder / "sequences.json"
    if side.is_file():
        data = _load_json(side, "sequences.json")
        if isinstance(data, dict):
            out.update({str(k): str(v) for k, v in data.items()})
    out.update({str(k): str(v) for k, v in _mapping(raw.get("sequences"), "job.yaml sequences").items()})
    return out


def read_kit(folder: Path) -> Kit:
    folder = Path(folder)
    raw = _load_yaml(folder / "job.yaml")
    job = _mapping(raw.get("job"), "job.yaml job")
    kit_profile = str(job.get("profile") or job.get("asset_type") or "stack")
    if kit_profile not in PROFILE_IDS:
        raise KitError(f"The kit profile {kit_profile!r} has no built-in review profile in Kestrel.")
    profile_id = PROFILE_IDS[kit_profile]
    overrides = _mapping(raw.get("profile"), "job.yaml profile")
    inputs = _mapping(raw.get("inputs"), "job.yaml inputs")

    def resolve(key: str, default: str) -> Path:
        q = Path(str(inputs.get(key) or default))
        return q if q.is_absolute() else folder / q

    classes = (
        tuple(_class_of(c) for c in _list(overrides["classes"], "job.yaml profile classes"))
        if overrides.get("classes")
        else KIT_CLASSES[kit_profile]
    )
    unit = str(overrides.get("finding_unit") or profiles.PROFILES[profile_id].finding_unit)
    if unit not in ("region", "photo"):
        raise KitError(f"The kit's finding unit {unit!r} is neither region nor photo.")
    cams = _load_json(resolve("cameras", "cameras.json"), "cameras.json")
    ass = _load_json(resolve("assessment", "assessment.json"), "assessment.json")
    if not isinstance(cams, dict) or not isinstance(ass, dict):
        raise KitError("cameras.json or assessment.json is not a kit file.")
    photos = [_photo(c) for c in _list(cams.get("photos"), "cameras.json photos")]
    if len({p.id for p in photos}) != len(photos):
        raise KitError("cameras.json lists a photo id twice.")
    findings: list[KitFinding] = []
    if unit == "region":
        merged = folder / "merged.json"
        polygons = _merged_polygons(_load_json(merged, "merged.json")) if merged.is_file() else {}
        class_keys = {c.id: c.key for c in classes}
        findings = [
            _finding(f, i, polygons, class_keys)
            for i, f in enumerate(_list(ass.get("findings"), "assessment.json findings"))
        ]
    mask_dir = resolve("masks", "masks")
    surface, glb = resolve("surface", "surface.json"), resolve("model", "model.glb")
    return Kit(
        folder=folder,
        kit_profile=kit_profile,
        profile_id=profile_id,
        unit=unit,
        profile_overrides=dict(overrides),
        classes=classes,
        asset=dict(_mapping(raw.get("asset"), "job.yaml asset")),
        sequences=_sequences(folder, raw),
        alignment=dict(_mapping(cams.get("alignment"), "cameras.json alignment")),
        photos=photos,
        statuses={
            str(k): _status(v) for k, v in _mapping(ass.get("photos"), "assessment.json photos").items()
        },
        findings=findings,
        mask_dir=mask_dir if mask_dir.is_dir() else None,
        surface_path=surface if surface.is_file() else None,
        glb_path=glb if glb.is_file() else None,
    )


def preview_size(kit: Kit, photo: KitPhoto) -> tuple[int, int]:
    """The kit's preview grid for one photo: the mask's size, else the review copy's, else the
    2,560 px long-edge rule of kit/cameras.py. Headers only; no pixels are decoded."""
    for path in (kit.mask_path(photo.id), kit.photo_file(photo)):
        if path is None:
            continue
        try:
            with PILImage.open(path) as im:
                return im.size
        except OSError:
            continue
    s = min(1.0, KIT_PREVIEW_LONG_EDGE / max(photo.width, photo.height))
    return round(photo.width * s), round(photo.height * s)
