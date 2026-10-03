# backend/app/asset_models/score.py
"""Score a generated plant register against a reference one (spec 2026-10-03 §13, unit K1).

Offline and pure: two registers (CSV rows as dicts) and optional land outlines in, numbers out. Tags
match after normalising case, whitespace and dashes. Positions are plant metres. Nothing here
touches the database or the network.

CLI: python -m app.asset_models.score <gen.csv> <ref.csv> [--gen-land x.json --ref-land y.json]
     [--gen-spec spec.json] [--json out.json]
"""

from __future__ import annotations

import csv
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

TYPE_FAMILY: dict[str, str] = {
    **dict.fromkeys(
        [
            "trestle", "jetty_platform", "dolphin", "pipe_rack", "pipe_sleeper", "catwalk", "walkway",
            "stair_tower", "overbridge", "platform", "gangway",
        ],
        "structure",
    ),
    **dict.fromkeys(
        [
            "tank_lng", "vessel_v", "vessel_h", "storage_tank_small", "pump", "pump_group", "compressor",
            "heater", "vaporizer_orv", "vaporizer_scv", "stack", "flare", "loading_arm", "crane", "monitor",
            "generator", "transformer", "package", "nav_aid",
        ],
        "equipment",
    ),
    **dict.fromkeys(["building", "substation", "analyzer_house", "shelter", "gate"], "building"),
    **dict.fromkeys(
        ["road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"],
        "civil",
    ),
    "other": "fallback",
    "composite": "fallback",
}  # fmt: skip
FALLBACK_TYPES = frozenset({"other", "composite"})
POS_TOL_LARGE_M = 2.0
POS_TOL_SMALL_M = 5.0
LARGE_FOOTPRINT_M = 5.0
_DASHES = "-" + "".join(chr(c) for c in range(0x2010, 0x2016)) + chr(0x2212)  # hyphens, en/em dashes, minus
_SEP = re.compile(r"[\s" + re.escape(_DASHES) + "]+")


@dataclass(frozen=True)
class Required:
    """A must-have: a tag; or one reference node, or every reference row of a type, each matched by a
    generated row of the same type within `radius_m`."""

    key: str
    tag: str | None = None
    node: str | None = None
    type: str | None = None
    radius_m: float = 0.0


KIPIC_REQUIRED: tuple[Required, ...] = (
    *(Required(f"20-T-000{k}", tag=f"20-T-000{k}") for k in range(1, 9)),
    Required("jetty_head_1", node="jetty1-loading-platform", type="jetty_platform", radius_m=25.0),
    Required("jetty_head_2", node="jetty2-loading-platform", type="jetty_platform", radius_m=25.0),
    Required("trestles", type="trestle", radius_m=60.0),
    Required("dolphins", type="dolphin", radius_m=10.0),
)


@dataclass
class ScoreReport:
    tagged_ref: int
    tagged_found: int
    type_match: int
    recall: float
    type_accuracy: float
    pos_err_p50_m: float
    pos_err_p95_m: float
    within_tol: float
    by_area: dict[str, dict]
    missing: list[str]
    extra: list[str]
    required_present: dict[str, bool]
    landmask_hausdorff_m: float | None


def normalise_tag(tag: object) -> str:
    """'20 – t – 0001' and '20-T-0001' are the same tag: case, whitespace and dashes do not count."""
    if tag is None:
        return ""
    return _SEP.sub("", str(tag)).upper()


def types_match(gen_type: str, ref_type: str) -> bool:
    """Equal types match. A fallback type (other/composite) on either side matches anything; `package`
    matches any equipment type (spec §13: type-family match accepted for package/other)."""
    if gen_type == ref_type:
        return True
    if gen_type in FALLBACK_TYPES or ref_type in FALLBACK_TYPES:
        return True
    if "package" in (gen_type, ref_type):
        other = ref_type if gen_type == "package" else gen_type
        return TYPE_FAMILY.get(other) == "equipment"
    return False


def read_register(path: Path) -> list[dict]:
    with Path(path).open(encoding="utf-8-sig", newline="") as f:
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def _num(v: object) -> float | None:
    try:
        x = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _en(row: dict) -> tuple[float, float] | None:
    e, n = _num(row.get("plant_E")), _num(row.get("plant_N"))
    return None if e is None or n is None else (e, n)


def tolerance_m(gen_row: dict) -> float:
    """2 m for an item whose footprint is over 5 m, else 5 m; 5 m when the size is unknown."""
    size = _num(gen_row.get("footprint_m"))
    return POS_TOL_LARGE_M if size is not None and size > LARGE_FOOTPRINT_M else POS_TOL_SMALL_M


def _area(row: dict) -> str:
    return (row.get("area") or "").strip() or "(none)"


def score(
    gen: list[dict], ref: list[dict], *, gen_land: list | None = None, ref_land: list | None = None
) -> ScoreReport:
    gen_by_tag: dict[str, dict] = {}
    for row in gen:
        t = normalise_tag(row.get("tag"))
        if t and t not in gen_by_tag:
            gen_by_tag[t] = row
    ref_tagged = [r for r in ref if normalise_tag(r.get("tag"))]
    ref_tags: set[str] = set()
    areas: dict[str, dict] = {}
    found = type_ok = within = 0
    errs: list[float] = []
    missing: list[str] = []
    for r in ref_tagged:
        t = normalise_tag(r["tag"])
        ref_tags.add(t)
        a = areas.setdefault(_area(r), {"ref": 0, "found": 0, "type_match": 0, "positioned": 0, "within": 0})
        a["ref"] += 1
        g = gen_by_tag.get(t)
        if g is None:
            missing.append(r["tag"])
            continue
        found += 1
        a["found"] += 1
        if types_match(str(g.get("type") or ""), str(r.get("type") or "")):
            type_ok += 1
            a["type_match"] += 1
        pg, pr = _en(g), _en(r)
        if pg is not None and pr is not None:
            err = math.hypot(pg[0] - pr[0], pg[1] - pr[1])
            errs.append(err)
            a["positioned"] += 1
            if err <= tolerance_m(g):
                within += 1
                a["within"] += 1
    for a in areas.values():
        a["recall"] = a["found"] / a["ref"]
        a["type_accuracy"] = a["type_match"] / a["ref"]
    n = len(ref_tagged)
    return ScoreReport(
        tagged_ref=n,
        tagged_found=found,
        type_match=type_ok,
        recall=found / n if n else 0.0,
        type_accuracy=type_ok / n if n else 0.0,
        pos_err_p50_m=float(np.percentile(errs, 50)) if errs else math.nan,
        pos_err_p95_m=float(np.percentile(errs, 95)) if errs else math.nan,
        within_tol=within / len(errs) if errs else 0.0,
        by_area=dict(sorted(areas.items())),
        missing=sorted(missing),
        extra=sorted(g["tag"] for t, g in gen_by_tag.items() if t not in ref_tags),
        required_present=required_present(gen, ref),
        landmask_hausdorff_m=None,  # the land outline arrives in the next task
    )


def required_present(
    gen: list[dict], ref: list[dict], required: Iterable[Required] = KIPIC_REQUIRED
) -> dict[str, bool]:
    """Each requirement whose reference rows exist in `ref`, as present or not. A requirement the
    reference does not contain is left out (the scorer stays usable on any plant)."""
    gen_tags = {normalise_tag(r.get("tag")) for r in gen} - {""}
    ref_tags = {normalise_tag(r.get("tag")) for r in ref} - {""}
    by_type: dict[str, list[tuple[float, float]]] = {}
    for r in gen:
        p = _en(r)
        if p is not None:
            by_type.setdefault(str(r.get("type") or ""), []).append(p)

    def near(type_: str, p: tuple[float, float], radius: float) -> bool:
        return any(math.hypot(q[0] - p[0], q[1] - p[1]) <= radius for q in by_type.get(type_, []))

    out: dict[str, bool] = {}
    for req in required:
        if req.tag is not None:
            t = normalise_tag(req.tag)
            if t in ref_tags:
                out[req.key] = t in gen_tags
            continue
        rows = [
            r for r in ref if r.get("type") == req.type and (req.node is None or r.get("node") == req.node)
        ]
        pts = [p for p in (_en(r) for r in rows) if p is not None]
        if pts:
            out[req.key] = all(near(req.type or "", p, req.radius_m) for p in pts)
    return out
