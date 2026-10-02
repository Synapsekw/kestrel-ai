"""Spec validation (spec 2026-10-02 §6.3). Errors block the GLB; warnings are shown, not enforced."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from app.asset_models.placement import PlacementError, part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.spec import AssetSpec

OVERLAP_SHARE = 0.5
RESERVED_ID = "world"  # trimesh names the GLB root node "world"


@dataclass(frozen=True)
class Issue:
    code: str
    part_id: str | None
    message: str


@dataclass
class Report:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


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
    counts = Counter(p.id for p in spec.parts)
    for pid, n in sorted(counts.items()):
        if n > 1:
            report.errors.append(Issue("duplicate_id", pid, f"{n} parts share the id {pid!r}"))
    by_id = {p.id: p for p in spec.parts}
    boxes: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for part in spec.parts:
        if part.id == RESERVED_ID:
            report.errors.append(
                Issue("reserved_id", part.id, f"{RESERVED_ID!r} is reserved; pick another id")
            )
            continue
        if part.placement.host == part.id:
            report.errors.append(Issue("host_self", part.id, "a part cannot be its own host"))
            continue
        msg = _geometry_error(part)
        if msg:
            report.errors.append(Issue("bad_geometry", part.id, msg))
            continue
        try:
            T = part_transform(part, by_id)
        except PlacementError as e:
            code = "host_missing" if "is not a part" in str(e) else "host_wrong_kind"
            report.errors.append(Issue(code, part.id, str(e)))
            continue
        except Exception:
            report.errors.append(Issue("bad_geometry", part.id, "could not build this part's geometry"))
            continue
        try:
            mesh = build_shape(part.shape, part.typed_params())
            mesh.apply_transform(T)
            lo, hi = np.asarray(mesh.bounds[0]), np.asarray(mesh.bounds[1])
            if len(mesh.faces) == 0 or not (np.isfinite(lo).all() and np.isfinite(hi).all()):
                raise ValueError("empty or non-finite mesh")
        except Exception:
            report.errors.append(Issue("bad_geometry", part.id, "could not build this part's geometry"))
            continue
        if counts[part.id] == 1:
            boxes[part.id] = (lo, hi)
        if part.source.kind == "assumed" and part.confidence == "high":
            report.warnings.append(
                Issue("assumed_high_confidence", part.id, "an assumed part is marked high confidence")
            )
    ids = sorted(boxes)
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            share = _overlap_share(boxes[a], boxes[b])
            if share > OVERLAP_SHARE:
                report.warnings.append(
                    Issue("overlap", a, f"{a!r} and {b!r} overlap by {share:.0%} (a duplicate?)")
                )
    return report


def _overlap_share(a, b) -> float:
    lo = np.maximum(a[0], b[0])
    hi = np.minimum(a[1], b[1])
    if np.any(hi <= lo):
        return 0.0
    inter = float(np.prod(hi - lo))
    # against the LARGER box: near-identical boxes score ~1, a small part inside a big host scores low
    larger = max(float(np.prod(a[1] - a[0])), float(np.prod(b[1] - b[0])))
    return inter / larger if larger > 0 else 0.0
