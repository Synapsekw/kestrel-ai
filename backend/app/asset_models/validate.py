"""Spec validation (spec 2026-10-02 §6.3; plant items: spec 2026-10-03-plant-model-generator §5).

Errors block the GLB, except the item problems the GLB survives (FALLBACK_CODES): such an item is
built as `other` with a `builder_fallback` flag (spec §6, "one bad item never fails the GLB"), so
they are reported and never blocking. Warnings are shown, not enforced. A spec with more than
ASYNC_VALIDATE_ITEMS items and environment features is validated in the GLB job, not the request.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np
from pydantic import ValidationError
from shapely import STRtree
from shapely.geometry import Polygon

from app.asset_models.placement import PlacementError, part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.spec import AssetSpec

OVERLAP_SHARE = 0.5
RESERVED_ID = "world"  # trimesh names the GLB root node "world"
ASYNC_VALIDATE_ITEMS = 200
FALLBACK_CODES = frozenset({"invalid_params", "bad_footprint"})
MAX_LISTED = 500  # issues kept in a version's meta["validation"]


@dataclass(frozen=True)
class Issue:
    code: str
    part_id: str | None  # a part id, an item id, an environment id, or "<item id>/<part id>"
    message: str


@dataclass
class Report:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)

    @property
    def blocking(self) -> list[Issue]:
        return [e for e in self.errors if e.code not in FALLBACK_CODES]

    @property
    def ok(self) -> bool:
        return not self.blocking


def is_large(spec: AssetSpec) -> bool:
    """True when the spec is validated in the GLB job instead of the request (spec §5 "Size")."""
    return len(spec.items) + len(spec.environment) > ASYNC_VALIDATE_ITEMS


def as_dicts(issues: list[Issue]) -> list[dict]:
    return [{"code": i.code, "part_id": i.part_id, "message": i.message} for i in issues]


def validation_meta(report: Report) -> dict:
    """What the GLB job stores in a large version's meta["validation"] (the detail route reads it)."""
    return {
        "errors": as_dicts(report.errors[:MAX_LISTED]),
        "error_count": len(report.errors),
        "warnings": as_dicts(report.warnings[:MAX_LISTED]),
        "warning_count": len(report.warnings),
    }


def _geometry_error(part) -> str | None:
    p = part.typed_params()
    if part.shape == "cylinder" and p.thickness >= p.id / 2:
        return "thickness must be less than the radius"
    if part.shape == "cone" and p.thickness >= p.d_bottom / 2:
        return "thickness must be less than the bottom radius"
    if part.shape == "nozzle" and (p.flange_t >= p.projection or p.flange_od <= p.od):
        return "the flange must be thinner than the projection and wider than the pipe"
    if part.shape == "head_torispherical" and not (p.knuckle_r < p.crown_r and p.knuckle_r < p.id / 2):
        return "the knuckle radius must be smaller than the crown radius and the shell radius"
    return None


def validate(spec: AssetSpec) -> Report:
    report = Report()
    _check_parts(spec.parts, report)
    if spec.items or spec.environment:
        _check_plant(spec, report)
    return report


def _check_parts(parts, report: Report, prefix: str | None = None) -> None:
    def pid(part_id: str) -> str:
        return f"{prefix}/{part_id}" if prefix else part_id

    counts = Counter(p.id for p in parts)
    for part_id, n in sorted(counts.items()):
        if n > 1:
            report.errors.append(Issue("duplicate_id", pid(part_id), f"{n} parts share the id {part_id!r}"))
    by_id = {p.id: p for p in parts}
    boxes: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for part in parts:
        if part.id == RESERVED_ID:
            report.errors.append(
                Issue("reserved_id", pid(part.id), f"{RESERVED_ID!r} is reserved; pick another id")
            )
            continue
        if part.placement.host == part.id:
            report.errors.append(Issue("host_self", pid(part.id), "a part cannot be its own host"))
            continue
        msg = _geometry_error(part)
        if msg:
            report.errors.append(Issue("bad_geometry", pid(part.id), msg))
            continue
        try:
            T = part_transform(part, by_id)
        except PlacementError as e:
            code = "host_missing" if "is not a part" in str(e) else "host_wrong_kind"
            report.errors.append(Issue(code, pid(part.id), str(e)))
            continue
        except Exception:
            report.errors.append(Issue("bad_geometry", pid(part.id), "could not build this part's geometry"))
            continue
        try:
            mesh = build_shape(part.shape, part.typed_params())
            mesh.apply_transform(T)
            lo, hi = np.asarray(mesh.bounds[0]), np.asarray(mesh.bounds[1])
            if len(mesh.faces) == 0 or not (np.isfinite(lo).all() and np.isfinite(hi).all()):
                raise ValueError("empty or non-finite mesh")
        except Exception:
            report.errors.append(Issue("bad_geometry", pid(part.id), "could not build this part's geometry"))
            continue
        if counts[part.id] == 1:
            boxes[part.id] = (lo, hi)
        if part.source.kind == "assumed" and part.confidence == "high":
            report.warnings.append(
                Issue("assumed_high_confidence", pid(part.id), "an assumed part is marked high confidence")
            )
    ids = sorted(boxes)
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            share = _overlap_share(boxes[a], boxes[b])
            if share > OVERLAP_SHARE:
                report.warnings.append(
                    Issue("overlap", pid(a), f"{a!r} and {b!r} overlap by {share:.0%} (a duplicate?)")
                )


def _overlap_share(a, b) -> float:
    lo = np.maximum(a[0], b[0])
    hi = np.minimum(a[1], b[1])
    if np.any(hi <= lo):
        return 0.0
    inter = float(np.prod(hi - lo))
    # against the LARGER box: near-identical boxes score ~1, a small part inside a big host scores low
    larger = max(float(np.prod(a[1] - a[0])), float(np.prod(b[1] - b[0])))
    return inter / larger if larger > 0 else 0.0


def _outline(fp) -> Polygon | None:
    """The footprint as a valid polygon with area, or None (a crossing outline, a line of no length)."""
    from app.asset_models.siteframe import footprint_polygon

    try:
        poly = Polygon(footprint_polygon(fp))
    except Exception:
        return None
    return poly if poly.is_valid and poly.area > 1e-6 else None


def _params_message(exc: ValidationError) -> str:
    parts = [
        f"{'.'.join(str(x) for x in e['loc']) or 'params'}: {e['msg']}"
        for e in exc.errors(include_input=False, include_url=False, include_context=False)
    ]
    return ("params " + "; ".join(parts))[:300]


def _check_plant(spec: AssetSpec, report: Report) -> None:
    from app.asset_models.builders.base import PLANNED_TYPES, REGISTRY, load_all

    load_all()
    counts = Counter(i.id for i in spec.items)
    for item_id, n in sorted(counts.items()):
        if n > 1:
            report.errors.append(Issue("duplicate_item_id", item_id, f"{n} items share the id {item_id!r}"))
    outlines: dict[str, list[tuple[str, Polygon]]] = defaultdict(list)
    for item in spec.items:
        if item.id == RESERVED_ID:
            report.errors.append(
                Issue("reserved_id", item.id, f"{RESERVED_ID!r} is reserved; pick another id")
            )
        d = REGISTRY.get(item.type)
        if d is None and item.type in PLANNED_TYPES:
            report.warnings.append(
                Issue("builder_missing", item.id, f"no builder for {item.type!r} yet; it builds as other")
            )
        elif d is None:
            report.errors.append(Issue("unknown_type", item.id, f"{item.type!r} is not a builder type"))
        else:
            try:
                d.params.model_validate(item.params)
            except ValidationError as exc:
                report.errors.append(Issue("invalid_params", item.id, _params_message(exc)))
        if item.base_el is not None and item.top_el is not None and item.top_el < item.base_el:
            report.errors.append(Issue("bad_heights", item.id, "top_el is below base_el"))
        poly = _outline(item.footprint)
        if poly is None:
            report.errors.append(
                Issue("bad_footprint", item.id, "the footprint crosses itself or has no area")
            )
        elif counts[item.id] == 1:
            outlines[item.type].append((item.id, poly))
        if item.parts:
            _check_parts(item.parts, report, prefix=item.id)
        if item.tag and item.confidence == "high" and item.source.kind == "assumed":
            report.warnings.append(
                Issue(
                    "assumed_high_confidence", item.id, "a tagged item from an assumed source is marked high"
                )
            )
        if item.flags:
            codes = ", ".join(sorted({f.code for f in item.flags}))
            report.warnings.append(Issue("item_flags", item.id, f"flagged: {codes}"))
    for type_ in sorted(outlines):
        _item_overlaps(outlines[type_], report)
    env_counts = Counter(f.id for f in spec.environment)
    for env_id, n in sorted(env_counts.items()):
        if n > 1:
            report.errors.append(
                Issue("duplicate_env_id", env_id, f"{n} environment features share the id {env_id!r}")
            )
    for feature in spec.environment:
        if feature.id == RESERVED_ID:
            report.errors.append(
                Issue("reserved_id", feature.id, f"{RESERVED_ID!r} is reserved; pick another id")
            )
        poly = Polygon(feature.pts)
        if not poly.is_valid or poly.area <= 1e-6:
            report.errors.append(
                Issue("bad_footprint", feature.id, "the outline crosses itself or has no area")
            )


def _item_overlaps(polys: list[tuple[str, Polygon]], report: Report) -> None:
    """Same-type items whose footprints overlap by more than OVERLAP_SHARE of the larger (a duplicate?)."""
    tree = STRtree([p for _, p in polys])
    for i, (a, pa) in enumerate(polys):
        for j in sorted(int(k) for k in tree.query(pa)):
            if j <= i:
                continue
            b, pb = polys[j]
            share = pa.intersection(pb).area / max(pa.area, pb.area)
            if share > OVERLAP_SHARE:
                report.warnings.append(
                    Issue("overlap", a, f"{a!r} and {b!r} overlap by {share:.0%} (a duplicate?)")
                )
