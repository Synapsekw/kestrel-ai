# backend/app/asset_models/look/cloud.py
"""A per-run cloud sample (<= 2 M points, one streamed pass) and the slices/fits the agent reads.

No server-side octree reader exists (the octree only serves byte ranges to the viewer), so each run
streams the source LAS/LAZ once in 2 M-point chunks, keeps a random share, and saves an .npz the
tools then query. Coordinates are the cloud's own metres, Z up.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.look import LookError

MAX_SAMPLE = 2_000_000
CHUNK = 2_000_000
SEED = 3
AXES = {"x": 0, "y": 1, "z": 2}


@dataclass
class CloudSample:
    offset: np.ndarray
    xyz: np.ndarray
    total: int

    def points(self) -> np.ndarray:
        return self.xyz.astype(np.float64) + self.offset

    def save(self, path: Path) -> None:
        tmp = path.with_name(path.name + ".tmp.npz")
        np.savez(tmp, offset=self.offset, xyz=self.xyz, total=np.array([self.total]))
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> CloudSample:
        with np.load(path) as d:
            return cls(d["offset"], d["xyz"], int(d["total"][0]))


def source_of(handle, cloud_id: str) -> Path:
    from app.errors import AppError
    from app.jobs.cancellation import JobFailure
    from app.pointclouds import export, rows

    try:
        cloud = rows.require_ready(handle, cloud_id)
        return export.check_source(cloud)
    except (AppError, JobFailure) as e:
        raise LookError(f"That point cloud can't be read: {getattr(e, 'message', str(e))}") from None


def sample_cloud(
    source: Path, *, max_points: int = MAX_SAMPLE, progress=lambda d, t: None, check_cancelled=lambda: None
) -> CloudSample:
    import laspy

    rng = np.random.default_rng(SEED)
    parts: list[np.ndarray] = []
    with laspy.open(str(source)) as reader:
        total = int(reader.header.point_count)
        offset = np.asarray(reader.header.mins, dtype=np.float64)
        keep = min(1.0, max_points / max(total, 1))
        done = 0
        for chunk in reader.chunk_iterator(CHUNK):
            check_cancelled()
            n = len(chunk)
            mask = rng.random(n) < keep
            if mask.any():
                xyz = np.column_stack(
                    [np.asarray(chunk.x)[mask], np.asarray(chunk.y)[mask], np.asarray(chunk.z)[mask]]
                )
                parts.append((xyz - offset).astype(np.float32))
            done += n
            progress(done, total)
    xyz = np.concatenate(parts) if parts else np.zeros((0, 3), np.float32)
    if len(xyz) > max_points:
        xyz = xyz[np.sort(rng.choice(len(xyz), max_points, replace=False))]
    progress(total, total)
    return CloudSample(offset, xyz, total)


def _in_box(pts: np.ndarray, region) -> np.ndarray:
    if region is None:
        return pts
    lo, hi = np.asarray(region[:3]), np.asarray(region[3:])
    return pts[np.all((pts >= lo) & (pts <= hi), axis=1)]


def _cap(pts: np.ndarray, n: int) -> np.ndarray:
    if len(pts) <= n:
        return pts
    rng = np.random.default_rng(SEED)
    return pts[np.sort(rng.choice(len(pts), n, replace=False))]


@dataclass(frozen=True)
class SliceResult:
    png: bytes
    points: list[list[float]]
    in_slab: int
    note: str = ""


def _nice_step(span: float) -> float:
    raw = span / 6
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    return next(m * mag for m in (1, 2, 5, 10) if m * mag >= raw)


def cloud_slice(
    sample: CloudSample,
    axis: str,
    at_m: float,
    thickness_m: float,
    *,
    max_points: int = 5000,
    image_px: int = 1024,
) -> SliceResult:
    k = AXES[axis]
    pts = sample.points()
    slab = pts[np.abs(pts[:, k] - at_m) <= thickness_m / 2]
    if len(slab) == 0:
        blank = Image.new("RGB", (256, 64), (20, 26, 36))
        buf = io.BytesIO()
        blank.save(buf, "PNG")
        return SliceResult(
            buf.getvalue(), [], 0, "no points in that slab - check at_m against the cloud's bounds"
        )
    a, b = [i for i in range(3) if i != k]
    u, v = slab[:, a], slab[:, b]
    span = max(float(np.ptp(u)), float(np.ptp(v))) or 1.0
    size = min(image_px, 1024)
    margin = 48
    scale = (size - 2 * margin) / span
    img = Image.new("RGB", (size, size), (20, 26, 36))
    draw = ImageDraw.Draw(img)
    px = margin + (u - u.min()) * scale
    py = size - margin - (v - v.min()) * scale
    for x, y in zip(px[:200_000], py[:200_000], strict=False):
        draw.point((float(x), float(y)), fill=(120, 200, 255))
    font = ImageFont.load_default()
    step = _nice_step(span)
    names = "xyz"
    for t in np.arange(math.ceil(u.min() / step) * step, u.max() + 1e-9, step):
        x = margin + (t - u.min()) * scale
        draw.line([(x, size - margin), (x, size - margin + 5)], fill=(200, 200, 200))
        draw.text((x, size - margin + 8), f"{t:.2f}", fill=(200, 200, 200), font=font, anchor="mt")
    for t in np.arange(math.ceil(v.min() / step) * step, v.max() + 1e-9, step):
        y = size - margin - (t - v.min()) * scale
        draw.line([(margin - 5, y), (margin, y)], fill=(200, 200, 200))
        draw.text((margin - 8, y), f"{t:.2f}", fill=(200, 200, 200), font=font, anchor="rm")
    draw.text(
        (margin, 8),
        f"slice {names[k]} = {at_m:.3f} m +/- {thickness_m / 2:.3f} m; "
        f"horizontal {names[a]}, vertical {names[b]}",
        fill=(230, 230, 230),
        font=font,
    )
    buf = io.BytesIO()
    img.save(buf, "PNG")
    out = _cap(slab, max_points)
    return SliceResult(buf.getvalue(), np.round(out, 3).tolist(), int(len(slab)))


def _kasa(xy: np.ndarray) -> tuple[np.ndarray, float]:
    A = np.column_stack([2 * xy, np.ones(len(xy))])
    sol = np.linalg.lstsq(A, (xy**2).sum(1), rcond=None)[0]
    c = sol[:2]
    return c, float(math.sqrt(max(sol[2] + c @ c, 0.0)))


def _ransac_circle(xy: np.ndarray, thr: float = 0.02, iters: int = 500):
    # Work about the centroid: absolute UTM coordinates (~4e6 m) squared lose all precision in float64.
    shift = xy.mean(0)
    c, r, rms, share = _ransac_circle_local(xy - shift, thr, iters)
    return c + shift, r, rms, share


def _ransac_circle_local(xy: np.ndarray, thr: float, iters: int):
    rng = np.random.default_rng(SEED)
    best = None
    for _ in range(iters):
        s = xy[rng.choice(len(xy), 3, replace=False)]
        try:
            c, r = _kasa(s)
        except np.linalg.LinAlgError:
            continue
        inl = np.abs(np.linalg.norm(xy - c, axis=1) - r) < thr
        if best is None or inl.sum() > best.sum():
            best = inl
    c, r = _kasa(xy[best])
    resid = np.linalg.norm(xy[best] - c, axis=1) - r
    return c, r, float(np.sqrt((resid**2).mean())), float(best.mean())


def cloud_fit(sample: CloudSample, kind: str, region, *, max_points: int = 200_000) -> dict:
    pts = _cap(_in_box(sample.points(), region), max_points)
    if len(pts) < 3 or (kind == "cylinder_vertical" and len(pts) < 30):
        return {"kind": kind, "n": int(len(pts)), "note": "too few points in that region to fit"}
    if kind == "plane":
        centroid = pts.mean(0)
        _, _, vt = np.linalg.svd(pts - centroid, full_matrices=False)
        normal = vt[2]
        resid = (pts - centroid) @ normal
        return {
            "kind": kind,
            "n": int(len(pts)),
            "normal": np.round(normal, 5).tolist(),
            "point": np.round(centroid, 4).tolist(),
            "rms_m": float(np.sqrt((resid**2).mean())),
            "note": "",
        }
    if kind == "circle":
        c, r, rms, share = _ransac_circle(pts[:, :2])
        return {
            "kind": kind,
            "n": int(len(pts)),
            "center": np.round(c, 4).tolist(),
            "radius": round(r, 4),
            "rms_m": round(rms, 5),
            "inlier_share": round(share, 4),
            "note": "fitted in plan (x, y)",
        }
    # cylinder_vertical: circle centres per 0.5 m slab, then a line through them
    z = pts[:, 2]
    zs, cs, rs = [], [], []
    for z0 in np.arange(z.min(), z.max(), 0.5):
        sl = pts[(z >= z0) & (z < z0 + 0.5)]
        if len(sl) >= 30:
            c, r, _, share = _ransac_circle(sl[:, :2], iters=200)
            if share > 0.5:
                zs.append(z0 + 0.25)
                cs.append(c)
                rs.append(r)
    if len(zs) < 2:
        return {"kind": kind, "n": int(len(pts)), "note": "too few points per height band to fit a cylinder"}
    zs, cs = np.array(zs), np.array(cs)
    slope = np.polyfit(zs, cs, 1)[0]
    base = cs.mean(0) - slope * (zs.mean() - z.min())
    return {
        "kind": kind,
        "n": int(len(pts)),
        "axis_point": np.round([*base, z.min()], 4).tolist(),
        "tilt_per_m": np.round(slope, 5).tolist(),
        "radius": round(float(np.median(rs)), 4),
        "radius_spread_m": round(float(np.ptp(rs)), 4),
        "bands": int(len(zs)),
        "note": "",
    }
