# Asset model U2 — rasterizer and cloud comparison

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent see its model (`render`) and measure it against a scan (`compare`) with pure numpy. No GPU, no window, the same pixels every time.

**Architecture:** `raster.py` renders orthographic views by **area-weighted surface splatting**:
- Every triangle gets a number of samples proportional to its projected pixel area, from a fixed-seed RNG.
- A z-buffer keeps the nearest sample per pixel, shaded flat from the triangle normal.
- Part outlines come from id and depth discontinuities.
- Labels are drawn with Pillow.

This is vectorised end to end, with no Python loop over triangles. `compare.py` finds each cloud point's distance to the nearest model surface:
- A KD-tree over dense surface samples gives 8 candidate triangles per point.
- An exact vectorised point-triangle distance picks the nearest of those.
- Results are reported per part (median and p95 in mm) over inliers within 250 mm.

It also holds the cloud→asset-frame transform the agent supplies.

**Tech Stack:** numpy, scipy (`cKDTree`), Pillow, trimesh (meshes from U1).

**Spec:** `docs/superpowers/specs/2026-10-02-asset-model-builder-design.md` §7.3, §7.4. Index and Global Constraints: `docs/superpowers/plans/2026-10-02-asset-model-builder.md`.

**Needs:** U1 merged (`app.asset_models.build.build_meshes`). **Worktree:** `scripts\start-task.ps1 -Name am-u2`.

---

### Task 1: Cloud→asset transform and point-triangle distance

**Files:**
- Create: `backend/app/asset_models/compare.py` (first half)
- Test: `backend/tests/test_asset_model_compare.py`

**Interfaces:**
- Produces:
  - `CloudTransform(origin: tuple[float, float, float], yaw_deg: float)`: a frozen dataclass. `origin` is the asset origin in cloud coordinates; `yaw_deg` is the bearing of plant north, clockwise from the cloud's +Y.
  - `cloud_to_asset(xyz: np.ndarray, t: CloudTransform) -> np.ndarray`: (N,3) cloud (E, N, U) metres to asset (X north, Y up, Z east) metres
  - `closest_points(p, a, b, c) -> np.ndarray`: (M,3) each, the closest point on triangle abc to p

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_compare.py
"""Cloud->asset transform, point-triangle distance and per-part comparison (spec §7.3)."""

import numpy as np
import pytest

from app.asset_models.compare import CloudTransform, closest_points, cloud_to_asset


def test_transform_yaw_zero_maps_cloud_north_to_asset_x():
    t = CloudTransform(origin=(100.0, 200.0, 5.0), yaw_deg=0)
    out = cloud_to_asset(np.array([[100.0, 201.0, 5.0], [101.0, 200.0, 7.0]]), t)
    assert out[0] == pytest.approx([1, 0, 0])   # 1 m cloud-north -> asset X
    assert out[1] == pytest.approx([0, 2, 1])   # 1 m cloud-east, 2 m up -> asset Z, Y


def test_transform_yaw_ninety_means_plant_north_is_cloud_east():
    t = CloudTransform(origin=(0.0, 0.0, 0.0), yaw_deg=90)
    out = cloud_to_asset(np.array([[1.0, 0.0, 0.0], [0.0, -1.0, 0.0]]), t)
    assert out[0] == pytest.approx([1, 0, 0], abs=1e-12)
    assert out[1] == pytest.approx([0, 0, 1], abs=1e-12)


@pytest.mark.parametrize("p,expected", [
    ([0.2, 0.2, 1.0], [0.2, 0.2, 0.0]),    # face interior
    ([-1.0, -1.0, 0.0], [0.0, 0.0, 0.0]),  # vertex a
    ([2.0, -1.0, 0.0], [1.0, 0.0, 0.0]),   # vertex b
    ([0.5, -1.0, 0.0], [0.5, 0.0, 0.0]),   # edge ab
    ([1.0, 1.0, 0.0], [0.5, 0.5, 0.0]),    # edge bc
    ([-1.0, 0.5, 0.0], [0.0, 0.5, 0.0]),   # edge ac
])
def test_closest_point_regions(p, expected):
    a, b, c = np.array([[0, 0, 0.0]]), np.array([[1, 0, 0.0]]), np.array([[0, 1, 0.0]])
    got = closest_points(np.array([p], float), a, b, c)
    assert got[0] == pytest.approx(expected)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_compare.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/compare.py
"""Model vs. scan (spec 2026-10-02 §7.3 `compare_to_cloud`). Metres in, millimetres out.

The agent supplies where the asset origin is in the cloud and which way plant north points (M3
replaces this with registration). Distances are exact point-to-triangle distances over 8 candidate
triangles per point, found through a KD-tree of dense surface samples.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class CloudTransform:
    origin: tuple[float, float, float]
    yaw_deg: float  # bearing of plant north, clockwise from the cloud's +Y


def cloud_to_asset(xyz: np.ndarray, t: CloudTransform) -> np.ndarray:
    d = np.asarray(xyz, dtype=float) - np.asarray(t.origin, dtype=float)
    s, c = math.sin(math.radians(t.yaw_deg)), math.cos(math.radians(t.yaw_deg))
    north = d[:, 0] * s + d[:, 1] * c
    east = d[:, 0] * c - d[:, 1] * s
    return np.column_stack([north, d[:, 2], east])


def _dot(u, v):
    return np.einsum("ij,ij->i", u, v)


def closest_points(p, a, b, c) -> np.ndarray:
    """Ericson, Real-Time Collision Detection 5.1.5, vectorised over rows."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = _dot(ab, ap), _dot(ac, ap)
    bp = p - b
    d3, d4 = _dot(ab, bp), _dot(ac, bp)
    cp = p - c
    d5, d6 = _dot(ab, cp), _dot(ac, cp)
    vc = d1 * d4 - d3 * d2
    vb = d5 * d2 - d1 * d6
    va = d3 * d6 - d5 * d4
    out = np.empty_like(p, dtype=float)
    done = np.zeros(len(p), dtype=bool)

    def take(mask, value):
        nonlocal done
        m = mask & ~done
        out[m] = value[m]
        done |= m

    with np.errstate(divide="ignore", invalid="ignore"):
        take((d1 <= 0) & (d2 <= 0), a)
        take((d3 >= 0) & (d4 <= d3), b)
        take((vc <= 0) & (d1 >= 0) & (d3 <= 0), a + (d1 / (d1 - d3))[:, None] * ab)
        take((d6 >= 0) & (d5 <= d6), c)
        take((vb <= 0) & (d2 >= 0) & (d6 <= 0), a + (d2 / (d2 - d6))[:, None] * ac)
        take((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0),
             b + ((d4 - d3) / ((d4 - d3) + (d5 - d6)))[:, None] * (c - b))
        denom = 1.0 / (va + vb + vc)
        take(np.ones(len(p), bool), a + ab * (vb * denom)[:, None] + ac * (vc * denom)[:, None])
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_compare.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/compare.py backend/tests/test_asset_model_compare.py
git commit -m "feat(asset-models): cloud-to-asset transform and point-triangle distance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Per-part comparison

**Files:**
- Modify: `backend/app/asset_models/compare.py` (second half)
- Test: `backend/tests/test_asset_model_compare.py` (extend)

**Interfaces:**
- Consumes: `build_meshes(spec) -> dict[str, trimesh.Trimesh]` (U1).
- Produces:
  - `compare(meshes: dict[str, trimesh.Trimesh], points: np.ndarray, *, max_points=200_000, inlier_m=0.25) -> Comparison`
  - `Comparison(overall: PartStat, parts: list[PartStat], inlier_share: float, points_used: int)`
  - `PartStat(id: str, n: int, median_mm: float | None, p95_mm: float | None)`
  - `Comparison.as_dict() -> dict` (JSON-safe, rounded to 0.1 mm)

- [ ] **Step 1: Write the failing tests (append)**

```python
import trimesh  # noqa: E402

from app.asset_models.compare import compare  # noqa: E402


def ring_points(radius, n=4000, y0=0.5, y1=2.5, seed=0):
    rng = np.random.default_rng(seed)
    a = rng.uniform(0, 2 * np.pi, n)
    y = rng.uniform(y0, y1, n)
    return np.column_stack([radius * np.cos(a), y, radius * np.sin(a)])


def tube(r_out, h=3.0):
    m = trimesh.creation.annulus(r_min=r_out - 0.01, r_max=r_out, height=h, sections=256)
    m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    m.apply_translation([0, h / 2, 0])
    return m


def test_offset_cloud_reports_the_offset():
    result = compare({"shell": tube(2.0)}, ring_points(2.010))
    shell = result.parts[0]
    assert shell.id == "shell"
    assert shell.median_mm == pytest.approx(10.0, abs=1.0)
    assert result.inlier_share == pytest.approx(1.0)


def test_points_are_attributed_to_the_nearest_part_and_outliers_dropped():
    inner = tube(1.0)
    pts = np.vstack([ring_points(2.005, 1000), ring_points(1.003, 1000, seed=1), [[0.0, 50.0, 0.0]]])
    result = compare({"shell": tube(2.0), "pipe": inner}, pts)
    by = {p.id: p for p in result.parts}
    assert by["shell"].n == 1000 and by["pipe"].n == 1000
    assert by["pipe"].median_mm == pytest.approx(3.0, abs=1.0)
    assert result.inlier_share == pytest.approx(2000 / 2001)


def test_too_many_points_are_subsampled_deterministically():
    pts = ring_points(2.0, 50_000)
    a = compare({"shell": tube(2.0)}, pts, max_points=5_000)
    b = compare({"shell": tube(2.0)}, pts, max_points=5_000)
    assert a.points_used == 5_000
    assert a.as_dict() == b.as_dict()


def test_part_with_no_points_has_no_stats():
    result = compare({"shell": tube(2.0), "far": tube(0.2)}, ring_points(2.0, 500))
    far = next(p for p in result.parts if p.id == "far")
    assert far.n == 0 and far.median_mm is None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_compare.py -v`
Expected: the 4 new tests FAIL with `ImportError: cannot import name 'compare'`

- [ ] **Step 3: Implement (append to `compare.py`)**

```python
from scipy.spatial import cKDTree  # noqa: E402

SURFACE_SAMPLES = 400_000
CANDIDATES = 8
SEED = 7


@dataclass(frozen=True)
class PartStat:
    id: str
    n: int
    median_mm: float | None
    p95_mm: float | None


@dataclass(frozen=True)
class Comparison:
    overall: PartStat
    parts: list[PartStat]
    inlier_share: float
    points_used: int

    def as_dict(self) -> dict:
        def stat(s: PartStat) -> dict:
            r = (lambda v: None if v is None else round(v, 1))
            return {"id": s.id, "n": s.n, "median_mm": r(s.median_mm), "p95_mm": r(s.p95_mm)}
        return {"overall": stat(self.overall), "parts": [stat(p) for p in self.parts],
                "inlier_share": round(self.inlier_share, 4), "points_used": self.points_used}


def _stat(pid: str, d_m: np.ndarray) -> PartStat:
    if len(d_m) == 0:
        return PartStat(pid, 0, None, None)
    mm = d_m * 1000.0
    return PartStat(pid, int(len(mm)), float(np.median(mm)), float(np.percentile(mm, 95)))


def compare(meshes, points, *, max_points: int = 200_000, inlier_m: float = 0.25) -> Comparison:
    rng = np.random.default_rng(SEED)
    pts = np.asarray(points, dtype=float)
    if len(pts) > max_points:
        pts = pts[np.sort(rng.choice(len(pts), max_points, replace=False))]
    ids = list(meshes)
    tris = np.concatenate([meshes[i].triangles for i in ids])          # (T,3,3)
    owner = np.concatenate([np.full(len(meshes[i].faces), k) for k, i in enumerate(ids)])
    area = np.concatenate([meshes[i].area_faces for i in ids])
    n_samples = SURFACE_SAMPLES
    tri_of = rng.choice(len(tris), n_samples, p=area / area.sum())
    u, v = rng.random(n_samples), rng.random(n_samples)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    t = tris[tri_of]
    samples = t[:, 0] + u[:, None] * (t[:, 1] - t[:, 0]) + v[:, None] * (t[:, 2] - t[:, 0])
    _, nn = cKDTree(samples).query(pts, k=CANDIDATES)
    cand = tri_of[nn]                                                    # (N,k) triangle ids
    p_rep = np.repeat(pts, CANDIDATES, axis=0)
    flat = cand.ravel()
    cp = closest_points(p_rep, tris[flat, 0], tris[flat, 1], tris[flat, 2])
    dist = np.linalg.norm(cp - p_rep, axis=1).reshape(-1, CANDIDATES)
    best = dist.argmin(axis=1)
    d = dist[np.arange(len(pts)), best]
    part = owner[cand[np.arange(len(pts)), best]]
    inlier = d <= inlier_m
    stats = [_stat(pid, d[inlier & (part == k)]) for k, pid in enumerate(ids)]
    share = float(inlier.mean()) if len(pts) else 0.0
    return Comparison(_stat("overall", d[inlier]), stats, share, int(len(pts)))
```

Memory note: with 200 000 points × 8 candidates, the temporaries are about 1.6 M × 3 float64 ≈ 40 MB per array. That's acceptable and bounded by `max_points`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_compare.py -v`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/compare.py backend/tests/test_asset_model_compare.py
git commit -m "feat(asset-models): per-part model-to-cloud deviation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rasterizer (`raster.py`)

**Files:**
- Create: `backend/app/asset_models/raster.py`
- Create: `backend/tests/data/asset_models/` (golden PNGs written in Step 4)
- Test: `backend/tests/test_asset_model_raster.py`

**Interfaces:**
- Consumes: `build_meshes` (U1), `bearing_dir` (U1 `placement.py`).
- Produces:
  - `View(kind: Literal["iso","front","side","top","section","custom"], bearing_deg: float | None = None, direction: tuple[float,float,float] | None = None)`
  - `render(meshes: dict[str, trimesh.Trimesh], view: View, *, size: int = 1024, labels: bool = False, groups: dict[str, str] | None = None, highlight: set[str] | None = None) -> PIL.Image.Image` (RGB, `size`×`size`)
  - `MAX_SIZE = 1024`
  - `grid(images: list[Image.Image], titles: list[str]) -> Image.Image` (2×2 or 1×n contact sheet, longest side ≤ 1600)
- View conventions: `front` looks north (+X), `side` looks east (+Z), `top` looks down (−Y) with plant north up the image, `iso` looks along (1, −0.8, 1) normalised, `section` looks along `bearing_dir(b)` and drops geometry in front of the vertical plane through the asset axis, `custom` looks along `direction`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_raster.py
"""Software rasterizer (spec §7.4): deterministic, bounded, readable."""

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.asset_models.build import build_meshes
from app.asset_models.raster import MAX_SIZE, View, grid, render
from app.asset_models.spec import AssetSpec

GOLDEN = Path(__file__).parent / "data" / "asset_models"
SPEC = AssetSpec.model_validate({"parts": [
    {"id": "shell", "name": "Shell", "group": "Shell", "shape": "cylinder",
     "params": {"id": 4000, "thickness": 8, "height": 8000}, "source": {"kind": "assumed"}},
    {"id": "roof", "name": "Roof", "group": "Head", "shape": "head_torispherical",
     "params": {"id": 4000, "thickness": 8, "crown_r": 4000, "knuckle_r": 400},
     "placement": {"origin_mm": [0, 8000, 0]}, "source": {"kind": "assumed"}},
    {"id": "N7", "name": "N7", "group": "Nozzle", "shape": "nozzle",
     "params": {"dn": 300, "od": 323.9, "projection": 400, "flange_od": 485, "flange_t": 40},
     "placement": {"host": "shell", "bearing_deg": 90, "elevation_mm": 4000}, "source": {"kind": "assumed"}},
]})
GROUPS = {p.id: p.group for p in SPEC.parts}


@pytest.fixture(scope="module")
def meshes():
    return build_meshes(SPEC)


def arr(img):
    return np.asarray(img, dtype=np.int16)


def test_render_is_deterministic(meshes):
    a = render(meshes, View("iso"), size=256, groups=GROUPS)
    b = render(meshes, View("iso"), size=256, groups=GROUPS)
    assert a.size == (256, 256) and a.mode == "RGB"
    assert np.array_equal(arr(a), arr(b))


def test_size_is_capped(meshes):
    assert render(meshes, View("top"), size=5000, groups=GROUPS).size == (MAX_SIZE, MAX_SIZE)


def test_front_view_is_taller_than_wide(meshes):
    img = arr(render(meshes, View("front"), size=256, groups=GROUPS))
    bg = img[0, 0]
    fg = np.any(img != bg, axis=2)
    rows, cols = np.where(fg)
    assert (rows.max() - rows.min()) > 1.5 * (cols.max() - cols.min())


def test_nozzle_at_bearing_90_shows_on_the_right_in_front_view(meshes):
    # looking north, east (+Z) is to the right
    with_n = arr(render(meshes, View("front"), size=256, groups=GROUPS))
    without = arr(render({k: v for k, v in meshes.items() if k != "N7"}, View("front"), size=256, groups=GROUPS))
    diff_cols = np.where(np.any(with_n != without, axis=2))[1]
    assert diff_cols.mean() > 128


def test_section_removes_the_near_half(meshes):
    full = arr(render(meshes, View("front"), size=256, groups=GROUPS))
    cut = arr(render(meshes, View("section", bearing_deg=0), size=256, groups=GROUPS))
    assert not np.array_equal(full, cut)


def test_labels_change_pixels(meshes):
    plain = arr(render(meshes, View("iso"), size=256, groups=GROUPS))
    labelled = arr(render(meshes, View("iso"), size=256, groups=GROUPS, labels=True))
    assert np.any(plain != labelled)


@pytest.mark.parametrize("kind", ["iso", "front", "top"])
def test_matches_golden(meshes, kind):
    img = render(meshes, View(kind), size=256, groups=GROUPS)
    golden = Image.open(GOLDEN / f"tank_{kind}.png").convert("RGB")
    diff = np.abs(arr(img) - arr(golden))
    assert (diff > 40).mean() < 0.01  # under 1 % of pixels differ visibly


def test_grid_contact_sheet(meshes):
    imgs = [render(meshes, View(k), size=512, groups=GROUPS) for k in ("iso", "front", "side", "top")]
    sheet = grid(imgs, ["iso", "front", "side", "top"])
    assert max(sheet.size) <= 1600
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_raster.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/raster.py
"""Software rasterizer for the agent's self-check (spec 2026-10-02 §7.4).

Orthographic, area-weighted surface splatting into a z-buffer: each triangle gets samples in
proportion to its projected pixel area (fixed-seed RNG), the nearest sample per pixel wins and is
shaded flat from its triangle normal. Outlines mark part-id and depth jumps. No GPU, no window.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.placement import bearing_dir

MAX_SIZE = 1024
SAMPLES_PER_PX = 2.5
MAX_SAMPLES = 6_000_000
MARGIN = 0.06
SEED = 11
BG = (20, 26, 36)
OUTLINE = (12, 14, 18)
GROUP_RGB = {
    "Shell": (196, 200, 206), "Head": (176, 186, 200), "Bottom": (150, 150, 158),
    "Nozzle": (230, 160, 70), "Manway": (230, 120, 70), "Support": (120, 150, 190),
    "Access": (120, 190, 140), "Internal": (190, 120, 200), "Lining": (70, 72, 78), "Other": (160, 160, 160),
}
HIGHLIGHT = (255, 90, 90)


@dataclass(frozen=True)
class View:
    kind: Literal["iso", "front", "side", "top", "section", "custom"]
    bearing_deg: float | None = None
    direction: tuple[float, float, float] | None = None


def _basis(view: View) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """forward (into the screen), right, up — all unit vectors in the asset frame."""
    up_world = np.array([0.0, 1.0, 0.0])
    if view.kind == "top":
        f, up = np.array([0.0, -1.0, 0.0]), np.array([1.0, 0.0, 0.0])  # plant north up the image
    else:
        if view.kind == "front":
            f = np.array([1.0, 0.0, 0.0])
        elif view.kind == "side":
            f = np.array([0.0, 0.0, 1.0])
        elif view.kind == "iso":
            f = np.array([1.0, -0.8, 1.0])
        elif view.kind == "section":
            f = bearing_dir(view.bearing_deg or 0.0)
        else:
            f = np.asarray(view.direction, dtype=float)
        f = f / np.linalg.norm(f)
        up = up_world - f * (up_world @ f)
        if np.linalg.norm(up) < 1e-6:
            up = np.array([1.0, 0.0, 0.0])
    up = up / np.linalg.norm(up)
    right = np.cross(f, up)
    return f, right / np.linalg.norm(right), up


def render(meshes, view: View, *, size: int = 1024, labels: bool = False, groups=None, highlight=None) -> Image.Image:
    size = int(min(max(size, 64), MAX_SIZE))
    groups = groups or {}
    highlight = highlight or set()
    ids = list(meshes)
    if not ids:
        return Image.new("RGB", (size, size), BG)
    tris = np.concatenate([meshes[i].triangles for i in ids])
    owner = np.concatenate([np.full(len(meshes[i].faces), k, dtype=np.int32) for k, i in enumerate(ids)])
    normals = np.concatenate([meshes[i].face_normals for i in ids])
    f, right, up = _basis(view)
    if view.kind == "section":  # keep what lies beyond the vertical plane through the axis
        keep = (tris.mean(axis=1) @ f) >= 0
        tris, owner, normals = tris[keep], owner[keep], normals[keep]
    sx, sy, sd = tris @ right, tris @ up, tris @ f            # (T,3) each
    lo = np.array([sx.min(), sy.min()])
    hi = np.array([sx.max(), sy.max()])
    span = float(max(hi - lo)) or 1.0
    scale = size * (1 - 2 * MARGIN) / span
    off = (size - (hi - lo) * scale) / 2
    px = (sx - lo[0]) * scale + off[0]
    py = size - ((sy - lo[1]) * scale + off[1])               # image y grows downward
    area = 0.5 * np.abs((px[:, 1] - px[:, 0]) * (py[:, 2] - py[:, 0]) - (px[:, 2] - px[:, 0]) * (py[:, 1] - py[:, 0]))
    counts = np.maximum(1, np.ceil(area * SAMPLES_PER_PX)).astype(np.int64)
    if counts.sum() > MAX_SAMPLES:
        counts = np.maximum(1, (counts * (MAX_SAMPLES / counts.sum())).astype(np.int64))
    tri_of = np.repeat(np.arange(len(tris)), counts)
    rng = np.random.default_rng(SEED)
    u, v = rng.random(len(tri_of)), rng.random(len(tri_of))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    w = 1 - u - v

    def interp(q):
        return w * q[tri_of, 0] + u * q[tri_of, 1] + v * q[tri_of, 2]

    ix = np.clip(interp(px).astype(np.int64), 0, size - 1)
    iy = np.clip(interp(py).astype(np.int64), 0, size - 1)
    depth = interp(sd)
    pix = iy * size + ix
    order = np.lexsort((depth, pix))                           # by pixel, then nearest first
    pix_sorted = pix[order]
    first = np.ones(len(order), dtype=bool)
    first[1:] = pix_sorted[1:] != pix_sorted[:-1]
    win = order[first]
    wp = pix[win]
    shade = 0.35 + 0.65 * np.abs(normals[tri_of[win]] @ f)
    base = np.array([GROUP_RGB.get(groups.get(i, "Other"), GROUP_RGB["Other"]) for i in ids], dtype=float)
    part = owner[tri_of[win]]
    rgb = base[part] * shade[:, None]
    for k, pid in enumerate(ids):
        if pid in highlight:
            rgb[part == k] = HIGHLIGHT
    img = np.empty((size * size, 3), dtype=np.uint8)
    img[:] = BG
    img[wp] = np.clip(rgb, 0, 255).astype(np.uint8)
    idmap = np.full(size * size, -1, dtype=np.int32)
    idmap[wp] = part
    dmap = np.full(size * size, np.inf)
    dmap[wp] = depth[win]
    img, idmap, dmap = img.reshape(size, size, 3), idmap.reshape(size, size), dmap.reshape(size, size)
    edge = np.zeros((size, size), dtype=bool)
    jump = span * 0.01
    for a, b in (((slice(None), slice(1, None)), (slice(None), slice(None, -1))),
                 ((slice(1, None), slice(None)), (slice(None, -1), slice(None)))):
        id_change = idmap[a] != idmap[b]
        with np.errstate(invalid="ignore"):
            depth_jump = np.abs(dmap[a] - dmap[b]) > jump
        e = id_change | depth_jump
        edge[a] |= e & (idmap[a] >= 0)
    img[edge] = OUTLINE
    out = Image.fromarray(img, "RGB")
    if labels:
        draw = ImageDraw.Draw(out)
        font = ImageFont.load_default()
        for k, pid in enumerate(ids):
            ys, xs = np.nonzero(idmap == k)
            if len(xs) > 30:
                draw.text((int(xs.mean()), int(ys.mean())), pid, fill=(255, 255, 255), font=font,
                          stroke_width=2, stroke_fill=(0, 0, 0), anchor="mm")
    return out


def grid(images: list[Image.Image], titles: list[str]) -> Image.Image:
    n = len(images)
    cols = 2 if n == 4 else n
    rows = math.ceil(n / cols)
    cell = min(800, 1600 // cols)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 20)), BG)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for k, (img, title) in enumerate(zip(images, titles)):
        r, c = divmod(k, cols)
        sheet.paste(img.resize((cell, cell)), (c * cell, r * (cell + 20) + 20))
        draw.text((c * cell + 6, r * (cell + 20) + 4), title, fill=(230, 230, 230), font=font)
    return sheet
```

- [ ] **Step 4: Write the golden images once, look at them, then run the tests**

```powershell
$PY -c "from pathlib import Path; from tests.test_asset_model_raster import SPEC, GROUPS; from app.asset_models.build import build_meshes; from app.asset_models.raster import View, render; m = build_meshes(SPEC); d = Path('tests/data/asset_models'); d.mkdir(parents=True, exist_ok=True); [render(m, View(k), size=256, groups=GROUPS).save(d / f'tank_{k}.png') for k in ('iso','front','top')]"
```

**Open the three PNGs and check them by eye.**
- iso shows a cylinder with a dished roof and a nozzle.
- front shows a tall rectangle with a domed top and the nozzle on the right.
- top shows a circle with the nozzle pointing right (east).

If one is wrong, fix `raster.py` and regenerate. Never commit a golden you haven't looked at.

Run: `$PY -m pytest tests/test_asset_model_raster.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Timing check (not in the gate)**

Run: `$PY -c "import time; from tests.test_asset_model_raster import SPEC, GROUPS; from app.asset_models.build import build_meshes; from app.asset_models.raster import View, render; m = build_meshes(SPEC); t=time.perf_counter(); render(m, View('iso'), size=1024, groups=GROUPS); print(round(time.perf_counter()-t, 2), 's')"`
Expected: under 1 s for this model on the operator's machine (spec §7.4). Record the figure in the commit message. If it's over 2 s, lower `SAMPLES_PER_PX` to 1.5 and regenerate the goldens.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/raster.py backend/tests/test_asset_model_raster.py backend/tests/data/asset_models/tank_iso.png backend/tests/data/asset_models/tank_front.png backend/tests/data/asset_models/tank_top.png
git commit -m "feat(asset-models): numpy software rasterizer for agent self-check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Land

- [ ] **Step 1:** Run `$PY -m ruff check app/asset_models tests; $PY -m ruff format --check app/asset_models tests; $PY -m pytest tests/test_asset_model_*.py -q`. Expected: clean.
- [ ] **Step 2:** Run `scripts\finish-task.ps1` (or, if it fails on PowerShell 5.1, the gate by hand plus `git merge --ff-only task/am-u2` from main and junction-safe worktree removal).
