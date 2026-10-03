# backend/tests/asset_place_helpers.py
"""Helpers for the asset_place tests (plan 2026-10-03-asset-findings-j3): truth sightings projected
into the synthetic tower's poses, and a model, photos, poses and sightings seeded into a project."""

from __future__ import annotations

import hashlib
import math
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from PIL import Image as PILImage

from app.asset_models import store
from app.asset_review.place import SightingShape, cast
from app.asset_review.poses import PoseIn
from app.db.models import AssetModel, AssetModelVersion, Image, ImagePose, Source


def pose_in(p: dict) -> PoseIn:
    return PoseIn(
        position=list(p["position"]),
        target=list(p["target"]),
        up=list(p.get("up") or [0.0, 1.0, 0.0]),
        hfov_deg=float(p["hfov"]),
        vfov_deg=float(p["vfov"]),
        source="kit",
        accuracy_m=None,
    )


@dataclass(frozen=True)
class TruthSighting:
    pose_index: int
    truth_id: str
    shape: SightingShape


def project_truth(tower, mesh, box_m: float = 0.2) -> list[TruthSighting]:
    """Every truth defect each camera sees, as a `box_m` box around its projected centre.

    The visibility rule is kit `detect_truth.py`'s: the centre is in front of the camera and inside
    97 % of the frame, and the first surface on the ray to it is within 1.1 radius of it. Boxes
    are in continuous pixels of the tower's photo size, clipped to the photo."""
    W, H = tower.image_size
    out = []
    for i, p in enumerate(tower.poses):
        C = np.asarray(p["position"], float)
        f = np.asarray(p["target"], float) - C
        f /= np.linalg.norm(f)
        r = np.cross(f, np.asarray(p.get("up") or [0.0, 1.0, 0.0], float))
        r /= np.linalg.norm(r)
        u = np.cross(r, f)
        th, tv = math.tan(math.radians(p["hfov"] / 2)), math.tan(math.radians(p["vfov"] / 2))
        for t in tower.truth:
            X = np.asarray(t.center, float) - C
            z = float(X @ f)
            if z <= 0:
                continue
            x, y = float(X @ r) / z / th, float(X @ u) / z / tv
            if abs(x) > 0.97 or abs(y) > 0.97:
                continue
            dist = float(np.linalg.norm(X))
            hit, _ = cast(mesh, C[None, :], (X / dist)[None, :])
            if np.isnan(hit[0, 0]) or np.linalg.norm(hit[0] - C) < dist - t.radius * 1.1:
                continue
            px, py = (x + 1) / 2 * W, (1 - y) / 2 * H
            rad = box_m / z / tv * H / 2
            x0, y0 = max(0.0, px - rad), max(0.0, py - rad)
            x1, y1 = min(float(W), px + rad), min(float(H), py + rad)
            out.append(TruthSighting(i, t.id, SightingShape(x0, y0, x1 - x0, y1 - y0)))
    return out


def diamond(shape: SightingShape) -> SightingShape:
    """A polygon sighting: the diamond inscribed in the box."""
    x, y, w, h = shape.x, shape.y, shape.w, shape.h
    pts = ((x + w / 2, y), (x + w, y + h / 2), (x + w / 2, y + h), (x, y + h / 2))
    return SightingShape(x, y, w, h, kind="polygon", points=pts)


def seed_model(handle, glb_path, frame, review) -> str:
    """An asset model whose version 1 is `glb_path`, imported as is (spec §5.2), with a frame and a
    resolved review profile."""
    data = Path(glb_path).read_bytes()
    with handle.session() as s:
        m = AssetModel(
            name="Tower",
            status="ready",
            current_version=1,
            frame=frame.model_dump(mode="json"),
            review=review.model_dump(mode="json"),
        )
        s.add(m)
        s.flush()
        mid = m.id
    dest = store.version_glb_path(handle, mid, 1)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(glb_path, dest)
    with handle.session() as s:
        s.add(
            AssetModelVersion(
                model_id=mid,
                version=1,
                spec={},
                kind="imported",
                glb_status="ready",
                source_ids=[],
                part_count=0,
                meta={
                    "source_name": "model.glb",
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "bytes": len(data),
                    "frame_conversion": "none",
                },
            )
        )
    return mid


def add_photo(
    handle, model_id: str, name: str, pose: dict | None, *, size=(1600, 1067), seed: int = 0
) -> str:
    """A noise JPEG in the project folder, its image row and, when `pose` is given, its pose on the
    model (a kit `cameras.json` dict)."""
    rel = f"images/{name}"
    path = handle.folder / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    PILImage.fromarray(rng.integers(0, 255, size=(size[1], size[0], 3), dtype=np.uint8)).save(path, "JPEG")
    with handle.session() as s:
        src = Source(folder=str(path.parent), site="Tower")
        s.add(src)
        s.flush()
        image = Image(path=rel, width=size[0], height=size[1], source_id=src.id, original_name=name)
        s.add(image)
        s.flush()
        if pose is not None:
            s.add(
                ImagePose(
                    image_id=image.id,
                    asset_model_id=model_id,
                    position=list(pose["position"]),
                    target=list(pose["target"]),
                    up=list(pose.get("up") or [0.0, 1.0, 0.0]),
                    hfov_deg=float(pose["hfov"]),
                    vfov_deg=float(pose["vfov"]),
                    source="kit",
                    accuracy_m=None,
                    sequence=None,
                    updated_at=datetime.now(UTC),
                )
            )
        return image.id


def add_sighting(
    handle, model_id: str, type_id: str, image_id: str, shape: SightingShape, severity: int = 2
) -> str:
    """An ungrouped `pending` sighting through J4's `add_sighting` (its box drawn by the
    annotation service)."""
    from app.findings.sightings import add_sighting as add

    with handle.session() as s:
        common = {"asset_model_id": model_id, "finding_id": None, "image_id": image_id, "type_id": type_id}
        if shape.kind == "polygon":
            row = add(s, handle, **common, points=[list(p) for p in shape.points], severity=severity)
        else:
            box = {"x": shape.x, "y": shape.y, "w": shape.w, "h": shape.h, "angle": shape.angle}
            row = add(s, handle, **common, box=box, severity=severity)
        return row.id
