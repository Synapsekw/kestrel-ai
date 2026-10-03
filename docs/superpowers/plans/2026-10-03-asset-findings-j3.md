# Asset findings J3: `asset_place`: back-projection, patch files, placements API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sighting on a posed photo lands on its asset model as a pin, a textured patch, or an honest `none`. The `asset_place` background job writes the hit point, normal and part onto `finding_sighting`, writes the patch files (`.bin`, `.png`, `.lbl`, `index.json`), and then queues `asset_group`. The placements API serves the paged index and the patch binaries with an ETag.

**Architecture:**
- **`backend/app/asset_review/raycast.py`** is a numpy first-hit ray caster (Moller-Trumbore with an exact two-level cull). `rtree` is not installed, so trimesh's ray engine cannot run. The coordinator ruled that no rtree or embree dependency is added.
- **`backend/app/asset_review/place.py`** is pure. It ports kit `project.py`:
  - `camera_rays`, `cast`;
  - point placement: the median of a 5 x 5 grid, with the normal turned toward the camera;
  - patch placement: a grid, quads, the long-edge drop, the lift toward the camera, UVs;
  - the mixed rule;
  - textures and label grids;
  - the binary patch format, plus `write_patch` and `index.json`.
- **`backend/app/asset_review/jobs_place.py`** is the job. It reads 64 sightings at a time, ordered by photo, and loads the mesh once through J1's `load_version_mesh`. It reads a photo only when a texture needs it, at preview size through `app.datasets.images.image_file`. It writes results 64 at a time and then calls J4's `submit_group`.
- **`backend/app/asset_review/routes_placements.py`** and **`placement_schemas.py`** hold the four GETs and the compute POST. They replace C0's five 501 stubs.

**Tech Stack:** FastAPI, SQLAlchemy, numpy, Pillow, trimesh (loading only, through J1), pytest. No new dependency.

**Spec sections covered:** §5.6 (the sighting placement columns J3 writes), §5.7 (derived files), §6.3 (`asset_place`), §8 (`GET /placements`, `GET /placements/{sightingId}/{mesh|texture|labels}`, `POST /placements/compute`), §11 (budget: DAMAC under 5 min), §12 (placement on the synthetic tower).

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs (merged to `main` first):**
- C0: the contract, and the five J3 stubs in `backend/app/asset_review/stubs.py`.
- D1: `ImagePose`, `FindingSighting` with J4's N1 columns (`asset_model_id`, nullable `finding_id`), `AssetModel.frame` and `review`.
- P1: `Frame`, `ReviewConfig` (with `component_map`), `derive`, `component_name`, and `tests/fixtures/synthetic_tower.py`.
- J1: `app.asset_review.meshes.load_glb_mesh`, `load_version_mesh`, and `mesh.metadata["node_names"]`.
- J2: `app.asset_review.poses.PoseIn`.
- J4: `app.findings.sightings.add_sighting` and `app.asset_review.jobs_group.submit_group`.

**Worktree:** `scripts\start-task.ps1 -Name af-j3`. Every backend command runs from `E:\Dev\Yolo\app\.claude\worktrees\af-j3\backend` with `$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"`. There is no overlay venv, because J3 adds no package.

---

## Budget and execution DAG

**Background job:** `asset_place` is the only long work. No route casts a ray, loads a mesh or reads a photo. `POST /placements/compute` only queues the job.

**Bounded reads:**
- The mesh is held once per process (J1's single-slot cache by GLB sha256).
- The job reads sightings 64 at a time, as plain values, and writes them 64 at a time.
- One photo is in memory at a time. It is read at 2,048 px through `image_file(handle, id, 2048)`, never the original, and only for a sighting whose texture needs it (a polygon or rotated box on a patch profile).
- One sighting's rays go into one `cast` call. That call holds at most `PAIR_BUDGET` (1,000,000) ray-triangle pairs at once, about 100 MB of float64 temporaries.
- The placements index is keyset-paged at 2,000 rows at most. `index.json` is one small file read per page.
- A binary GET streams one file (`FileResponse`).

**Expected cost** (measured while planning on this PC, numpy only):
- Synthetic tower, 10,680 faces: one sighting with a 48 x 48 grid takes about 10 ms. Two hundred mixed sightings take 1.5 s, textures included.
- A 1.31M-face, 655k-vertex mesh (EBSM is 711k vertices): one call takes 0.14 s for 25 rays, 0.30 s for 196 rays and 0.35 s for 4,608 rays. The O(V + F) projection dominates. EBSM's 78 patch sightings therefore take about 30 s.
- DAMAC: 1,441 sightings with grid 14 on its reconstructed facade GLB. That is about 40 ms per sighting at 100k faces, plus about 40 ms per patch texture (715 patches), so about 1.5 min. That is well inside the spec's 5 min.
- The numpy caster matched embree hit for hit on 368,640 tower rays (0 mismatches).
- Task 6 pins these figures in two `perf` tests.

**Units and order:**

| Task | Builds | Needs |
| --- | --- | --- |
| 1 | `raycast.py`; the tower fixture uses it | none |
| 2 | `place.py`: rays, `cast`, pins, `none` (Review Focus `test_ray_miss_is_none_not_error`) | 1 |
| 3 | `place.py`: patches, mixed rule, textures, label grids, file format, `index.json` | 2 |
| 4 | Accuracy on the synthetic tower (0.25 m, side and zone) | 3 |
| 5 | The `asset_place` job | 3 |
| 6 | The placements API, stub removal, perf tests | 5 |
| 7 | Gate and land | all |

- **Parallel:** Task 4 and Task 5 can run in parallel after Task 3, because they touch different files.
- **Critical path:** 1, 2, 3, 5, 6, 7.

---

### Task 1: The numpy ray caster

**Files:**
- Create: `backend/app/asset_review/raycast.py`
- Modify: `backend/tests/fixtures/synthetic_tower.py` (P1's `_first_hit` delegates to it)
- Test: `backend/tests/test_asset_review_raycast.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `app.asset_review.raycast.first_hits(vertices: np.ndarray, faces: np.ndarray, origins: np.ndarray, directions: np.ndarray) -> tuple[np.ndarray, np.ndarray]`. It returns `(t, face)`, each of length n: `t = inf` and `face = -1` on a miss; `t` is measured in direction lengths. Constants: `RAYS_PER_TILE`, `PAIR_BUDGET`, `MIN_FORWARD`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_review_raycast.py
"""The numpy first-hit ray caster (plan 2026-10-03-asset-findings-j3 Task 1). The tiled, culled path
must give exactly what testing every triangle gives."""

import numpy as np
import pytest
import trimesh

from app.asset_review import raycast


def brute(vertices, faces, origins, directions):
    t = np.full(len(origins), np.inf)
    f = np.full(len(origins), -1, dtype=np.int64)
    raycast._blocks(
        np.asarray(vertices, float),
        np.asarray(faces, np.int64),
        np.arange(len(faces)),
        np.asarray(origins, float),
        np.asarray(directions, float),
        np.arange(len(origins)),
        t,
        f,
    )
    return t, f


def scene() -> trimesh.Trimesh:
    """A sphere, a box behind it and a floor: occlusion, misses and shared edges."""
    parts = [trimesh.creation.icosphere(subdivisions=3, radius=2.0), trimesh.creation.box(extents=[1, 6, 6])]
    parts[1].apply_translation([-6.0, 0, 0])
    floor = trimesh.creation.box(extents=[30, 0.2, 30])
    floor.apply_translation([0, -3.0, 0])
    return trimesh.util.concatenate([*parts, floor])


def camera_grid(origin, target, n=40, spread=0.35):
    o = np.asarray(origin, float)
    f = np.asarray(target, float) - o
    f /= np.linalg.norm(f)
    r = np.cross(f, [0.0, 1.0, 0.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    a, b = np.meshgrid(np.linspace(-spread, spread, n), np.linspace(-spread, spread, n))
    d = f[None] + a.ravel()[:, None] * r[None] + b.ravel()[:, None] * u[None]
    return np.repeat(o[None], len(d), 0), d


@pytest.mark.parametrize("origin", [(12.0, 1.0, 0.5), (0.5, 9.0, 7.0), (-12.0, 2.0, -3.0)])
def test_the_culled_cast_equals_testing_every_triangle(origin):
    mesh = scene()
    o, d = camera_grid(origin, (0.0, 0.0, 0.0))
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, o, d)
    bt, bf = brute(mesh.vertices, mesh.faces, o, d)
    assert np.array_equal(face, bf)
    assert np.allclose(t[np.isfinite(bt)], bt[np.isfinite(bt)])
    assert (face >= 0).any() and (face < 0).any()  # the grid sees both the scene and the sky


def test_the_hit_is_the_nearest_surface_along_the_ray():
    mesh = trimesh.creation.box(extents=[2, 2, 2])  # faces at x = +-1
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, np.array([[5.0, 0.1, 0.2]]), np.array([[-2.0, 0, 0]]))
    assert t[0] == pytest.approx(2.0)  # 4 m at 2 m per unit of direction
    assert face[0] >= 0


def test_a_ray_pointing_away_misses():
    mesh = trimesh.creation.box(extents=[2, 2, 2])
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, np.array([[5.0, 0, 0]]), np.array([[1.0, 0, 0]]))
    assert np.isinf(t[0]) and face[0] == -1


def test_a_triangle_crossing_the_camera_plane_is_still_found():
    """The floor runs under and behind the camera: its projection is unbounded, so it is kept."""
    floor = trimesh.Trimesh([[-50, 0, -50], [50, 0, -50], [50, 0, 50], [-50, 0, 50]], [[0, 1, 2], [0, 2, 3]])
    o, d = camera_grid((0.0, 2.0, 0.0), (10.0, 0.0, 0.0), n=10, spread=0.1)
    t, face = raycast.first_hits(floor.vertices, floor.faces, o, d)
    assert (face >= 0).all()
    hits = o + d * t[:, None]
    assert np.allclose(hits[:, 1], 0.0)


def test_rays_from_different_origins_fall_back_to_every_triangle():
    mesh = scene()
    o = np.array([[12.0, 0, 0], [0, 12.0, 0], [0, 0, 12.0]])
    d = -o
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, o, d)
    bt, bf = brute(mesh.vertices, mesh.faces, o, d)
    assert np.array_equal(face, bf) and np.allclose(t, bt)


def test_no_rays_or_no_faces_return_empty_misses():
    t, face = raycast.first_hits(np.zeros((0, 3)), np.zeros((0, 3), int), np.zeros((2, 3)), np.ones((2, 3)))
    assert np.isinf(t).all() and (face == -1).all()
    t, face = raycast.first_hits(np.zeros((3, 3)), np.array([[0, 1, 2]]), np.zeros((0, 3)), np.zeros((0, 3)))
    assert len(t) == 0 and len(face) == 0
```

- [ ] **Step 2: Run it to see it fail**

Run: `& $PY -m pytest tests/test_asset_review_raycast.py -q`
Expected: collection error, `ImportError: cannot import name 'raycast' from 'app.asset_review'`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_review/raycast.py
"""First-hit ray casting in numpy (spec 2026-10-02-asset-findings §6.3), with no rtree or embree.

trimesh's ray engine needs `rtree`, which is not installed and is not added (plan J3, coordinator
ruling), so placement casts its own rays. Every ray of one call shares one origin (a camera) and
points into one narrow cone (a sighting's box). That makes a cheap two-level cull exact:

1. Project the mesh's vertices onto a plane in front of the origin (`x = d.r / d.f`, `y = d.u / d.f`
   along the rays' mean direction `f`). A ray can only hit a triangle when its projection falls
   inside the triangle's projected bounds. Triangles wholly behind the origin are dropped; one that
   crosses the origin's plane is kept for every ray.
2. Split the rays' projected rectangle into tiles of about `RAYS_PER_TILE` rays, and test each
   tile's rays against only the candidates whose bounds overlap that tile (Moller-Trumbore,
   vectorised, at most `PAIR_BUDGET` ray-triangle pairs at a time).

Cost per call: one pass over the vertices and faces (O(V + F): about 0.14 s for 1.3M faces), plus
the tile tests, which scale with the rays times the triangles near them, not with the mesh. Rays
with different origins, or a cone wider than `MIN_FORWARD` allows, fall back to testing every
triangle in blocks.
"""

from __future__ import annotations

import math

import numpy as np

RAYS_PER_TILE = 16
PAIR_BUDGET = 1_000_000  # ray x triangle pairs per Moller-Trumbore block (about 100 MB of float64)
MIN_FORWARD = 0.1  # every ray within about 84 degrees of the cone axis, or the fallback runs
EPS_DET = 1e-12
EPS_T = 1e-9


def first_hits(
    vertices: np.ndarray, faces: np.ndarray, origins: np.ndarray, directions: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """The nearest hit of each ray: `(t, face)` arrays of length n; `t = inf`, `face = -1` on a miss.
    `directions` need not be unit length; `t` is in units of each direction's length."""
    n = len(origins)
    t_best = np.full(n, np.inf)
    f_best = np.full(n, -1, dtype=np.int64)
    if n == 0 or len(faces) == 0:
        return t_best, f_best
    vertices = np.asarray(vertices, dtype=float)
    faces = np.asarray(faces, dtype=np.int64)
    origins = np.asarray(origins, dtype=float)
    directions = np.asarray(directions, dtype=float)
    every = np.arange(len(faces))
    o = origins[0]
    axis = directions.sum(axis=0)
    norm = np.linalg.norm(axis)
    if not np.allclose(origins, o) or norm == 0:
        _blocks(vertices, faces, every, origins, directions, np.arange(n), t_best, f_best)
        return t_best, f_best
    f = axis / norm
    unit = directions / np.linalg.norm(directions, axis=1)[:, None]
    fwd = unit @ f
    if fwd.min() < MIN_FORWARD:
        _blocks(vertices, faces, every, origins, directions, np.arange(n), t_best, f_best)
        return t_best, f_best
    helper = np.array([0.0, 1.0, 0.0]) if abs(f[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    r = np.cross(f, helper)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    rx, ry = (unit @ r) / fwd, (unit @ u) / fwd

    rel = vertices - o
    depth = rel @ f
    front = depth > EPS_T
    safe = np.where(front, depth, 1.0)
    vx, vy = (rel @ r) / safe, (rel @ u) / safe
    fd = front[faces]
    any_front = fd.any(axis=1)
    straddle = any_front & ~fd.all(axis=1)
    fx, fy = vx[faces], vy[faces]
    x0, x1 = fx.min(axis=1), fx.max(axis=1)
    y0, y1 = fy.min(axis=1), fy.max(axis=1)
    x0[straddle], y0[straddle] = -np.inf, -np.inf
    x1[straddle], y1[straddle] = np.inf, np.inf
    overlap = (x1 >= rx.min()) & (x0 <= rx.max()) & (y1 >= ry.min()) & (y0 <= ry.max())
    cand = np.nonzero(any_front & overlap)[0]
    if cand.size == 0:
        return t_best, f_best
    cx0, cx1, cy0, cy1 = x0[cand], x1[cand], y0[cand], y1[cand]

    tiles = max(1, int(math.ceil(math.sqrt(n / RAYS_PER_TILE))))
    ex = np.linspace(rx.min(), rx.max(), tiles + 1)
    ey = np.linspace(ry.min(), ry.max(), tiles + 1)
    ix = np.clip(np.searchsorted(ex, rx, side="right") - 1, 0, tiles - 1)
    iy = np.clip(np.searchsorted(ey, ry, side="right") - 1, 0, tiles - 1)
    tile = iy * tiles + ix
    for k in np.unique(tile):
        rays = np.nonzero(tile == k)[0]
        lo_x, hi_x = rx[rays].min(), rx[rays].max()
        lo_y, hi_y = ry[rays].min(), ry[rays].max()
        near = cand[(cx1 >= lo_x) & (cx0 <= hi_x) & (cy1 >= lo_y) & (cy0 <= hi_y)]
        if near.size:
            _blocks(vertices, faces, near, origins, directions, rays, t_best, f_best)
    return t_best, f_best


def _blocks(vertices, faces, tri_ids, origins, directions, ray_ids, t_best, f_best) -> None:
    """Moller-Trumbore of `ray_ids` against `tri_ids`, in blocks of at most PAIR_BUDGET pairs;
    updates `t_best`/`f_best` in place where a block finds a nearer hit."""
    step = max(1, PAIR_BUDGET // max(1, len(ray_ids)))
    o = origins[ray_ids][:, None, :]
    d = directions[ray_ids][:, None, :]
    for start in range(0, len(tri_ids), step):
        ids = tri_ids[start : start + step]
        v = vertices[faces[ids]]  # (k, 3, 3)
        v0 = v[:, 0][None]
        e1 = (v[:, 1] - v[:, 0])[None]
        e2 = (v[:, 2] - v[:, 0])[None]
        p = np.cross(d, e2)
        det = np.einsum("ijk,ijk->ij", e1, p)
        ok = np.abs(det) > EPS_DET
        inv = np.divide(1.0, det, out=np.zeros_like(det), where=ok)
        s = o - v0
        uu = np.einsum("ijk,ijk->ij", s, p) * inv
        q = np.cross(s, e1)
        vv = np.einsum("ijk,ijk->ij", d, q) * inv
        t = np.einsum("ijk,ijk->ij", e2, q) * inv
        hit = ok & (uu >= 0) & (vv >= 0) & (uu + vv <= 1) & (t > EPS_T)
        t = np.where(hit, t, np.inf)
        j = t.argmin(axis=1)
        tj = t[np.arange(len(ray_ids)), j]
        better = tj < t_best[ray_ids]
        t_best[ray_ids[better]] = tj[better]
        f_best[ray_ids[better]] = ids[j[better]]
```

- [ ] **Step 4: Point P1's tower fixture at the shared caster**

P1's fixture has its own private Moller-Trumbore, `_first_hit(tris, origin, direction) -> float`. Keep its signature and replace its body, so the repo has one ray caster. In `backend/tests/fixtures/synthetic_tower.py`, add `from app.asset_review.raycast import first_hits` to the imports. Then replace the whole `_first_hit` function with:

```python
def _first_hit(tris: np.ndarray, origin: np.ndarray, direction: np.ndarray) -> float:
    """Distance along a unit ray to the nearest triangle, or inf (`app.asset_review.raycast`)."""
    t, _ = first_hits(
        tris.reshape(-1, 3), np.arange(len(tris) * 3).reshape(-1, 3), origin[None, :], direction[None, :]
    )
    return float(t[0])
```

- [ ] **Step 5: Run the tests to see them pass**

```powershell
& $PY -m pytest tests/test_asset_review_raycast.py tests/test_synthetic_tower.py -q
```

Expected: every test passes. In particular, `test_synthetic_tower.py` still finds the truth sighting counts `{"D1": 7, "D2": 9, "D3": 8, "D4": 6, "D5": 8, "D6": 8}`. The same visibility means the same counts.

- [ ] **Step 6: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/raycast.py tests/test_asset_review_raycast.py tests/fixtures/synthetic_tower.py
& $PY -m ruff format --check app/asset_review/raycast.py tests/test_asset_review_raycast.py tests/fixtures/synthetic_tower.py
git add backend/app/asset_review/raycast.py backend/tests/test_asset_review_raycast.py backend/tests/fixtures/synthetic_tower.py
git commit -m "feat(asset-review): numpy first-hit ray caster with an exact frustum and tile cull (J3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rays, pins and misses

**Files:**
- Create: `backend/app/asset_review/place.py`
- Test: `backend/tests/test_asset_place.py`

**Interfaces:**
- Consumes:
  - `raycast.first_hits` (Task 1);
  - `derive`, `Derived`, `component_name` from `app.asset_review.derive` (P1);
  - `Frame` (P1), `resolve` and `ReviewConfig` (P1);
  - `PoseIn` (J2): attributes `position`, `target`, `up`, `hfov_deg`, `vfov_deg`;
  - `aabb_of` and `corners_of` from `app.geometry`.
- Produces (in `app.asset_review.place`):
  - `SightingShape(x, y, w, h, angle=0.0, kind="box", points=None)` with `from_box(box)`, `bbox(image_size)`, `outline()` and `area()`.
  - `Placement(kind, center, normal, part, coverage, patch, derived)` and `PatchData` (filled by Task 3).
  - `camera_rays(pose, px, py, image_size) -> (origins, directions, forward)`. `px` and `py` are continuous pixels of the **stored** image: NDC is `px / W * 2 - 1` and `1 - py / H * 2`.
  - `cast(mesh, origins, directions) -> (hits (n, 3) with NaN, face (n,) with -1)`.
  - `wants_patch(shape, placement) -> bool`.
  - `place_sighting(mesh, face_node, pose, shape, image_size, review, photo, colour, *, frame) -> Placement`. After this task it places pins and misses only. Task 3 adds patches.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_place.py
"""asset_place geometry on hand-made scenes (plan 2026-10-03-asset-findings-j3 Tasks 2 and 3).

The scene: a camera at (0, 10, 0) looking along plant north (+X) at a 20 x 20 m wall at x = 10; a
1000 x 500 photo with a 60 degree horizontal field of view. Right in the photo is plant east (+Z)."""

import math

import numpy as np
import pytest
import trimesh

from app.asset_review import place
from app.asset_review.frame import Frame
from app.asset_review.place import SightingShape, camera_rays, place_sighting
from app.asset_review.poses import PoseIn
from app.asset_review.profiles import resolve

SIZE = (1000, 500)
HFOV = 60.0
VFOV = 2 * math.degrees(math.atan(math.tan(math.radians(HFOV / 2)) * SIZE[1] / SIZE[0]))
ORANGE = "#ff7a2d"
FRAME = Frame(height_m=20.0)


def pose(target=(10.0, 10.0, 0.0)) -> PoseIn:
    return PoseIn(
        position=[0.0, 10.0, 0.0],
        target=list(target),
        up=[0.0, 1.0, 0.0],
        hfov_deg=HFOV,
        vfov_deg=VFOV,
        source="manual",
        accuracy_m=None,
    )


def wall(x=10.0, z0=-10.0, z1=10.0, y0=0.0, y1=20.0, flip=False) -> trimesh.Trimesh:
    v = np.array([[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], float)
    faces = np.array([[0, 1, 2], [0, 2, 3]])
    return trimesh.Trimesh(v, faces[:, ::-1] if flip else faces, process=False)


def review(placement="point", grid=4):
    return resolve("stack", FRAME.height_m).model_copy(update={"placement": placement, "patch_grid": grid})


def run(mesh, shape, rv=None, photo=None, p=None):
    return place_sighting(
        mesh, np.zeros(len(mesh.faces), np.int32), p or pose(), shape, SIZE, rv or review(), photo, ORANGE, frame=FRAME
    )


def test_camera_rays_centre_is_forward_and_edges_match_the_fov():
    origins, dirs, fwd = camera_rays(pose(), np.array([500.0, 1000.0, 500.0]), np.array([250.0, 250.0, 0.0]), SIZE)
    assert np.allclose(origins, [[0, 10, 0]] * 3)
    assert np.allclose(fwd, [1, 0, 0])
    assert np.allclose(dirs[0], [1, 0, 0])
    assert np.allclose(dirs[1], [math.cos(math.radians(30)), 0, math.sin(math.radians(30))])  # right edge is +Z
    half_v = math.radians(VFOV / 2)
    assert np.allclose(dirs[2], [math.cos(half_v), math.sin(half_v), 0])  # the top edge


def test_ndc_comes_from_the_stored_image_size():
    a = camera_rays(pose(), np.array([250.0]), np.array([100.0]), (1000, 500))[1]
    b = camera_rays(pose(), np.array([1000.0]), np.array([400.0]), (4000, 2000))[1]
    assert np.allclose(a, b)


@pytest.mark.parametrize("flip", [False, True])
def test_a_pin_lands_on_the_wall_with_the_normal_toward_the_camera(flip):
    p = run(wall(flip=flip), SightingShape(450, 200, 100, 100))
    assert p.kind == "point" and p.patch is None
    assert p.center[0] == pytest.approx(10.0)
    assert abs(p.center[1] - 10.0) < 0.5 and abs(p.center[2]) < 0.5
    assert p.normal == pytest.approx((-1.0, 0.0, 0.0))
    assert p.part is None  # a hand-made mesh has no node names
    assert p.coverage == pytest.approx(100 * 100 / (1000 * 500))
    assert p.derived.height_m == pytest.approx(p.center[1])


def test_ray_miss_is_none_not_error():
    """Review Focus 2: a camera that looks away from the model places nothing, and says so."""
    p = run(wall(), SightingShape(450, 200, 100, 100), p=pose(target=(-10.0, 10.0, 0.0)))
    assert p.kind == "none"
    assert (p.center, p.normal, p.part, p.patch, p.derived) == (None, None, None, None, None)
    assert p.coverage == pytest.approx(0.02)


def test_a_point_annotation_is_one_ray_through_its_pixel():
    p = run(wall(), SightingShape(500, 250, 0, 0, kind="point"))
    assert p.center == pytest.approx((10.0, 10.0, 0.0))
    assert p.coverage == 0.0


def test_a_rotated_box_is_cast_over_its_envelope():
    shape = SightingShape(450, 200, 100, 60, angle=30, kind="rbox")
    x0, y0, x1, y1 = shape.bbox(SIZE)
    assert x0 < 450 and x1 > 550 and y0 < 200 and y1 > 260
    assert run(wall(), shape).kind == "point"


def test_every_ray_of_a_sighting_is_one_cast(monkeypatch):
    calls = []
    real = place.cast
    monkeypatch.setattr(place, "cast", lambda mesh, o, d: calls.append(len(o)) or real(mesh, o, d))
    run(wall(), SightingShape(450, 200, 100, 100))
    assert calls == [25]
```

- [ ] **Step 2: Run it to see it fail**

Run: `& $PY -m pytest tests/test_asset_place.py -q`
Expected: collection error, `ImportError: cannot import name 'place' from 'app.asset_review'`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_review/place.py
"""Back-projection of sightings onto an asset model (spec 2026-10-02-asset-findings §6.3).

A port of the kit's `project.py`. A photo with a pose is a pinhole camera. A sighting's box, in the
stored image's pixels (`image.width` x `image.height`), becomes a fan of rays into the mesh:

- point: the median-distance hit of a 5 x 5 grid in the central half of the box, with the hit
  face's normal turned toward the camera (a pin);
- patch: a `patch_grid` ray grid over the box. Adjacent hits make quads; a quad with an edge over
  4 times the median step is dropped (it spans a depth jump); the surface is lifted toward the
  camera by H * 0.00025. UVs map back to the box crop, textured with the polygon in its severity
  colour over the photo (a tinted box when there is no polygon);
- mixed: a polygon gives a patch, a box gives a pin;
- none: no ray hits. Never a fake position.

Every ray of one sighting goes to the mesh in one `cast` (`app.asset_review.raycast`).
Pure: no database, and no files except `write_patch` and `write_index`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from PIL import Image as PILImage

from app.asset_review import raycast
from app.asset_review.derive import Derived, component_name, derive
from app.geometry import aabb_of, corners_of

PREVIEW_SIDE = 2048  # photos are read at this long side, never the original (Global Constraints)
POINT_GRID = 5
DEFAULT_PATCH_GRID = 48  # the kit's default when a profile sets none


@dataclass(frozen=True)
class SightingShape:
    """The annotation behind a sighting, in the stored image's pixels. `x, y, w, h` are the
    unrotated box (top-left, size); a polygon keeps its envelope with `angle = 0`; a point has
    `w = h = 0` (app/imagery/shapes.py)."""

    x: float
    y: float
    w: float
    h: float
    angle: float = 0.0
    kind: str = "box"  # box | rbox | polygon | point
    points: tuple[tuple[float, float], ...] | None = None

    @classmethod
    def from_box(cls, box) -> SightingShape:
        pts = tuple((float(p[0]), float(p[1])) for p in box.points) if box.points else None
        return cls(
            float(box.x), float(box.y), float(box.w), float(box.h), float(box.angle or 0.0), box.shape, pts
        )

    def bbox(self, image_size: tuple[int, int]) -> tuple[float, float, float, float]:
        """The axis-aligned envelope `(x0, y0, x1, y1)`, clamped to the image."""
        W, H = image_size
        ax, ay, aw, ah = aabb_of(self.x, self.y, self.w, self.h, self.angle)
        x0, y0 = min(max(ax, 0.0), W), min(max(ay, 0.0), H)
        return x0, y0, min(max(ax + aw, x0), W), min(max(ay + ah, y0), H)

    def outline(self) -> list[tuple[float, float]] | None:
        """The region to fill in a texture: the polygon, or a rotated box's corners. None for an
        upright box or a point (they get the tinted box)."""
        if self.kind == "polygon" and self.points:
            return list(self.points)
        if self.kind == "rbox" or (self.kind == "box" and self.angle):
            return corners_of(self.x, self.y, self.w, self.h, self.angle)
        return None

    def area(self) -> float:
        if self.kind == "polygon" and self.points and len(self.points) >= 3:
            xs = np.array([p[0] for p in self.points])
            ys = np.array([p[1] for p in self.points])
            return float(abs(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1))) / 2)
        return float(self.w * self.h)


@dataclass
class PatchData:
    positions: np.ndarray  # (n, 3) float32, asset frame, n = 3 x triangles
    uvs: np.ndarray  # (n, 2) float32, u right, v up (v = 1 is the top of the crop)
    texture: PILImage.Image  # RGBA, at most TEXTURE_MAX a side
    labels: np.ndarray  # (h, w) uint8, 1 = the finding, row 0 = the top of the crop
    crop: tuple[float, float, float, float]  # x0, y0, x1, y1 in the stored image's pixels
    direction: tuple[float, float, float]  # unit, between the normal and the camera
    size: tuple[float, float]  # horizontal and vertical extent, m


@dataclass
class Placement:
    kind: str  # point | patch | none
    center: tuple[float, float, float] | None = None
    normal: tuple[float, float, float] | None = None
    part: str | None = None
    coverage: float | None = None
    patch: PatchData | None = None
    derived: Derived | None = None


def camera_rays(pose, px, py, image_size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rays through image points. `px, py` are continuous pixel coordinates of the stored image
    (0 at the left/top edge, W/H at the right/bottom edge), so NDC is `px / W * 2 - 1` and
    `1 - py / H * 2`. Direction = f + x tan(hfov/2) r + y tan(vfov/2) u. Returns (origins,
    unit directions, forward)."""
    W, H = image_size
    C = np.asarray(pose.position, float)
    f = np.asarray(pose.target, float) - C
    f /= np.linalg.norm(f)
    r = np.cross(f, np.asarray(pose.up if pose.up is not None else (0.0, 1.0, 0.0), float))
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    x = np.asarray(px, float) / W * 2 - 1
    y = 1 - np.asarray(py, float) / H * 2
    th = math.tan(math.radians(pose.hfov_deg / 2))
    tv = math.tan(math.radians(pose.vfov_deg / 2))
    d = f[None, :] + x[:, None] * th * r[None, :] + y[:, None] * tv * u[None, :]
    d /= np.linalg.norm(d, axis=1)[:, None]
    return np.repeat(C[None, :], len(d), 0), d, f


def cast(mesh, origins: np.ndarray, directions: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """First hits: (n, 3) points with NaN for a miss, and (n,) face indices with -1 for a miss
    (`app.asset_review.raycast`, numpy only)."""
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, origins, directions)
    hits = np.full((len(origins), 3), np.nan)
    hit = face >= 0
    hits[hit] = origins[hit] + directions[hit] * t[hit, None]
    return hits, face


def wants_patch(shape: SightingShape, placement: str) -> bool:
    """The mixed rule: a polygon gives a patch, anything else a pin. A point is always a pin."""
    if shape.kind == "point" or placement not in ("patch", "mixed"):
        return False
    return placement == "patch" or shape.kind == "polygon"


def _central_grid(bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, np.ndarray]:
    """POINT_GRID x POINT_GRID image points over the central half of the box."""
    x0, y0, x1, y1 = bbox
    gx, gy = np.meshgrid(
        np.linspace(x0 + (x1 - x0) * 0.25, x1 - (x1 - x0) * 0.25, POINT_GRID),
        np.linspace(y0 + (y1 - y0) * 0.25, y1 - (y1 - y0) * 0.25, POINT_GRID),
    )
    return gx.ravel(), gy.ravel()


def _pin(mesh, hits: np.ndarray, tri: np.ndarray, origins: np.ndarray, fwd: np.ndarray):
    """The median-distance hit, its face and that face's normal turned toward the camera; None
    when no ray hit."""
    ok = ~np.isnan(hits[:, 0])
    if not ok.any():
        return None
    dist = np.linalg.norm(hits[ok] - origins[ok], axis=1)
    k = int(np.argsort(dist)[len(dist) // 2])
    t = int(tri[ok][k])
    n = np.asarray(mesh.face_normals[t], float).copy()
    if np.dot(n, -fwd) < 0:
        n = -n
    return hits[ok][k], t, n


def _common(mesh, pin, face_node, review, frame, coverage: float) -> dict:
    """Centre, normal, the hit node's component (`mesh.metadata["node_names"]`, J1), coverage and
    the derived height, bearing, side and zone."""
    c, t, n = pin
    name = mesh.metadata.get("node_names", {}).get(int(face_node[t]))
    center = (float(c[0]), float(c[1]), float(c[2]))
    normal = (float(n[0]), float(n[1]), float(n[2]))
    return {
        "center": center,
        "normal": normal,
        "part": component_name(name, review.component_map),
        "coverage": coverage,
        "derived": derive(center, normal, review, frame),
    }


def place_sighting(
    mesh,
    face_node: np.ndarray,
    pose,
    shape: SightingShape,
    image_size: tuple[int, int],
    review,
    photo: PILImage.Image | None,
    colour: str,
    *,
    frame,
) -> Placement:
    """One sighting onto the mesh (module docstring). Pins and misses; Task 3 adds patches."""
    W, H = image_size
    bbox = shape.bbox(image_size)
    coverage = shape.area() / (W * H)
    px, py = _central_grid(bbox)
    origins, dirs, fwd = camera_rays(pose, px, py, image_size)
    hits, tri = cast(mesh, origins, dirs)
    pin = _pin(mesh, hits, tri, origins, fwd)
    if pin is None:
        return Placement(kind="none", coverage=coverage)
    return Placement(kind="point", **_common(mesh, pin, face_node, review, frame, coverage))
```

- [ ] **Step 4: Run it to see it pass**

Run: `& $PY -m pytest tests/test_asset_place.py -q`
Expected: `9 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/place.py tests/test_asset_place.py
& $PY -m ruff format --check app/asset_review/place.py tests/test_asset_place.py
git add backend/app/asset_review/place.py backend/tests/test_asset_place.py
git commit -m "feat(asset-review): camera rays, pins and honest misses for asset_place (J3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Patches, textures and the patch files

**Files:**
- Modify: `backend/app/asset_review/place.py`
- Test: `backend/tests/test_asset_place.py` (append)

**Interfaces:**
- Consumes: Task 2.
- Produces (in `app.asset_review.place`):
  - `place_sighting` places patches. Its signature does not change.
  - `patch_texture(shape, image_size, photo, colour) -> (PIL RGBA, uint8 labels)`.
  - `encode_patch(positions, uvs) -> bytes` and `decode_patch(bytes) -> (positions, uvs)`.
  - `encode_labels(labels) -> bytes` and `decode_labels(bytes) -> labels`.
  - `write_patch(dir, sighting_id, patch) -> str`, which returns the `.bin` path.
  - `index_entry(patch) -> dict`, `read_index(dir) -> dict` and `write_index(dir, asset_model_id, version, items)`.
  - Constants: `OFFSET_FRACTION`, `EDGE_FACTOR`, `TEXTURE_MAX = 512`, `LABEL_MAX = 128`, `TINT_ALPHA`, `FILL_ALPHA`, `PATCH_FORMAT = 1` (the `index.json` format).
- **File formats (binding; exactly what U1's parser reads).** All files are little-endian, with no magic bytes.
  - `<sighting>.bin` (4 + 20 n bytes):
    1. uint32: vertex count n, a multiple of 3 (triangles, not indexed);
    2. n x 3 float32 positions (x, y, z in the asset frame, metres);
    3. n x 2 float32 uvs (u to the right, v up, so v = 1 is the top row of the texture).
  - `<sighting>.lbl` (4 + w h bytes):
    1. uint16: width w;
    2. uint16: height h;
    3. w x h uint8 values, 0 or 1, row-major. Row 0 is the top of the crop, so a hit at uv (u, v) reads row `floor((1 - v) h)` and column `floor(u w)`.
  - `<sighting>.png`: RGBA, at most 512 px a side, with the same orientation as the label grid.
  - `index.json`: `{"format": 1, "asset_model_id", "version", "items": {sighting_id: {"vertex_count", "texture_size": [w, h], "label_size": [w, h], "crop": [x0, y0, x1, y1], "direction": [x, y, z], "size": [horizontal_m, vertical_m]}}}`.

- [ ] **Step 1: Append the failing tests**

Add `import json` and `import struct` to the imports of `backend/tests/test_asset_place.py` (keep them sorted), add `from PIL import Image as PILImage` after the trimesh import, and append:

```python
POLY = SightingShape(400, 200, 200, 100, kind="polygon", points=((400, 200), (600, 200), (600, 300)))
BOX = SightingShape(400, 200, 200, 100)


def test_a_patch_is_lifted_toward_the_camera_with_uvs_over_the_crop():
    p = run(wall(), BOX, rv=review("patch", 4))
    assert p.kind == "patch"
    pos, uv = p.patch.positions, p.patch.uvs
    assert pos.dtype == np.float32 and pos.shape == (18, 3)  # a 4 x 2 grid: 3 quads, 2 triangles each
    assert np.allclose(pos[:, 0], 10.0 - FRAME.height_m * place.OFFSET_FRACTION)
    assert uv.min() == 0.0 and uv.max() == 1.0
    assert np.allclose(uv[:6], [[0, 1], [1 / 3, 1], [1 / 3, 0], [0, 1], [1 / 3, 0], [0, 0]])
    assert p.patch.crop == (400, 200, 600, 300)
    assert p.patch.direction == pytest.approx((-1.0, 0.0, 0.0))
    width = 2 * 10 * math.tan(math.radians(30)) * 0.2  # the box spans a fifth of the photo's width
    assert p.patch.size[0] == pytest.approx(width, rel=1e-4)


def test_a_patch_drops_quads_that_span_a_depth_jump():
    step = trimesh.util.concatenate([wall(10.0, -10.0, 0.0), wall(30.0, 0.0, 10.0)])
    p = run(step, SightingShape(450, 200, 100, 100), rv=review("patch", 8))
    tris = p.patch.positions.reshape(-1, 3, 3)
    assert len(tris) == 2 * 7 * 6  # 7 x 7 quads, one column of 7 across the step dropped
    assert np.linalg.norm(tris - np.roll(tris, -1, axis=1), axis=2).max() < 1.0


def test_a_patch_with_no_surviving_quad_is_none():
    """A 0.2 m strip: the pin grid's centre column hits, no two neighbouring patch rays do. The kit
    leaves such a patch unmapped, and so do we."""
    p = run(wall(10.0, -0.1, 0.1), BOX, rv=review("patch", 4))
    assert p.kind == "none" and p.center is None and p.patch is None


def test_mixed_gives_a_polygon_a_patch_and_a_box_a_pin():
    assert run(wall(), POLY, rv=review("mixed", 4)).kind == "patch"
    assert run(wall(), BOX, rv=review("mixed", 4)).kind == "point"
    assert run(wall(), SightingShape(500, 250, 0, 0, kind="point"), rv=review("patch", 4)).kind == "point"
    assert run(wall(), POLY, rv=review("point", 4)).kind == "point"


def test_a_polygon_texture_is_the_colour_over_the_photo_inside_and_clear_outside():
    photo = PILImage.new("RGB", (2000, 1000), (0, 0, 255))  # a preview twice the stored size
    p = run(wall(), POLY, rv=review("mixed", 4), photo=photo)
    tex = np.asarray(p.patch.texture)
    assert p.patch.texture.mode == "RGBA" and tex.shape == (100, 200, 4)
    inside = (np.array([0, 0, 255]) * (1 - place.FILL_MIX) + np.array([255, 122, 45]) * place.FILL_MIX).astype(
        np.uint8
    )
    assert tex[5, -5, :3].tolist() == inside.tolist() and tex[5, -5, 3] == place.FILL_ALPHA
    assert tex[-5, 5].tolist() == [0, 0, 0, 0]
    labels = p.patch.labels
    assert labels.shape == (64, 128) and labels[1, -2] == 1 and labels[-2, 1] == 0
    assert set(np.unique(labels).tolist()) == {0, 1}


def test_a_box_patch_is_a_tinted_box_with_a_solid_border():
    p = run(wall(), BOX, rv=review("patch", 4))
    tex = np.asarray(p.patch.texture)
    assert tex[50, 100].tolist() == [255, 122, 45, place.TINT_ALPHA]
    assert tex[0, 100, 3] == 255 and tex[50, 0, 3] == 255
    assert (p.patch.labels == 1).all()


def test_a_rotated_box_patch_fills_only_its_corners():
    p = run(wall(), SightingShape(450, 200, 100, 60, angle=30, kind="rbox"), rv=review("patch", 4))
    tex = np.asarray(p.patch.texture)
    assert tex[0, 0, 3] == 0 and tex[tex.shape[0] // 2, tex.shape[1] // 2, 3] == place.FILL_ALPHA


def test_texture_and_labels_are_bounded():
    tex, labels = place.patch_texture(SightingShape(0, 0, 4000, 3000), (4000, 3000), None, ORANGE)
    assert tex.size == (512, 384)  # the crop at preview size (2048 x 1536), fitted into 512
    assert labels.shape == (96, 128)


def test_write_patch_files_and_their_byte_layout(tmp_path):
    p = run(wall(), BOX, rv=review("patch", 4))
    assert place.write_patch(tmp_path, "s1", p.patch) == str(tmp_path / "s1.bin")
    assert sorted(f.name for f in tmp_path.iterdir()) == ["s1.bin", "s1.lbl", "s1.png"]
    data = (tmp_path / "s1.bin").read_bytes()
    assert struct.unpack_from("<I", data, 0) == (18,)
    assert len(data) == 4 + 18 * 12 + 18 * 8
    assert np.array_equal(np.frombuffer(data, "<f4", 54, 4).reshape(18, 3), p.patch.positions)
    assert np.array_equal(np.frombuffer(data, "<f4", 36, 4 + 18 * 12).reshape(18, 2), p.patch.uvs)
    pos, uv = place.decode_patch(data)
    assert np.array_equal(pos, p.patch.positions) and np.array_equal(uv, p.patch.uvs)
    lbl = (tmp_path / "s1.lbl").read_bytes()
    assert struct.unpack_from("<HH", lbl, 0) == (128, 64) and len(lbl) == 4 + 128 * 64
    assert np.array_equal(place.decode_labels(lbl), p.patch.labels)
    with PILImage.open(tmp_path / "s1.png") as im:
        assert im.mode == "RGBA" and im.size == (200, 100)
    with pytest.raises(ValueError):
        place.decode_patch(data[:-4])


def test_the_index_round_trips_and_a_broken_one_reads_empty(tmp_path):
    p = run(wall(), BOX, rv=review("patch", 4))
    place.write_index(tmp_path, "m1", 3, {"s1": place.index_entry(p.patch)})
    body = json.loads((tmp_path / "index.json").read_text("utf-8"))
    assert (body["format"], body["asset_model_id"], body["version"]) == (1, "m1", 3)
    entry = place.read_index(tmp_path)["s1"]
    assert entry["vertex_count"] == 18 and entry["texture_size"] == [200, 100] and entry["label_size"] == [128, 64]
    assert entry["size"] == pytest.approx([2.3094, 1.1547], abs=1e-4)
    (tmp_path / "index.json").write_text("{not json", "utf-8")
    assert place.read_index(tmp_path) == {}
    assert place.read_index(tmp_path / "absent") == {}


def test_a_patch_sighting_is_still_one_cast(monkeypatch):
    calls = []
    real = place.cast
    monkeypatch.setattr(place, "cast", lambda mesh, o, d: calls.append(len(o)) or real(mesh, o, d))
    run(wall(), BOX, rv=review("patch", 4))
    assert calls == [25 + 4 * 2]
```

- [ ] **Step 2: Run them to see them fail**

Run: `& $PY -m pytest tests/test_asset_place.py -q`
Expected: the 11 new tests fail: the patch tests get `kind == "point"`, and the file tests fail with `AttributeError: module 'app.asset_review.place' has no attribute 'patch_texture'` (or `write_patch`, `OFFSET_FRACTION`, and so on). The 9 Task 2 tests still pass.

- [ ] **Step 3: Implement**

In `backend/app/asset_review/place.py`, replace the import block (from `import math` to the `from app.geometry` line) with:

```python
import io
import json
import math
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image as PILImage
from PIL import ImageDraw

from app.asset_review import raycast
from app.asset_review.derive import Derived, component_name, derive
from app.geometry import aabb_of, corners_of
```

Below `DEFAULT_PATCH_GRID`, add:

```python
EDGE_FACTOR = 4.0
OFFSET_FRACTION = 0.00025  # of the asset height, toward the camera
TEXTURE_MAX = 512
LABEL_MAX = 128
FILL_MIX = 0.55  # share of the severity colour over the photo inside the polygon
FILL_ALPHA = 230
TINT_ALPHA = 110  # the kit's tinted box
PATCH_FORMAT = 1  # the index.json format
INDEX_NAME = "index.json"
```

Add these two helpers directly after `_central_grid`:

```python
def _grid_size(grid: int, bbox: tuple[float, float, float, float]) -> tuple[int, int]:
    """The kit's patch grid: `grid` columns, and rows by the box's aspect, from 2 to 2 x grid."""
    x0, y0, x1, y1 = bbox
    gh = max(2, int(round(grid * (y1 - y0) / max(1.0, x1 - x0))))
    return grid, min(gh, grid * 2)


def _patch_grid(bbox: tuple[float, float, float, float], gw: int, gh: int) -> tuple[np.ndarray, np.ndarray]:
    """gw x gh image points over the whole box, row-major from the top-left corner."""
    x0, y0, x1, y1 = bbox
    U, V = np.meshgrid(np.linspace(0, 1, gw), np.linspace(0, 1, gh))
    return (x0 + U * (x1 - x0)).ravel(), (y0 + V * (y1 - y0)).ravel()
```

Replace the whole `place_sighting` function with:

```python
def place_sighting(
    mesh,
    face_node: np.ndarray,
    pose,
    shape: SightingShape,
    image_size: tuple[int, int],
    review,
    photo: PILImage.Image | None,
    colour: str,
    *,
    frame,
) -> Placement:
    """One sighting onto the mesh (module docstring). `photo` is the preview-size photo (only read
    for a polygon patch); `colour` is the severity colour as `#rrggbb`. Every ray of the sighting,
    the pin grid and the patch grid, goes to the mesh in one `cast`."""
    W, H = image_size
    bbox = shape.bbox(image_size)
    coverage = shape.area() / (W * H)
    px, py = _central_grid(bbox)
    patch = wants_patch(shape, review.placement)
    gw = gh = 0
    if patch:
        gw, gh = _grid_size(int(review.patch_grid or DEFAULT_PATCH_GRID), bbox)
        qx, qy = _patch_grid(bbox, gw, gh)
        px, py = np.concatenate([px, qx]), np.concatenate([py, qy])
    origins, dirs, fwd = camera_rays(pose, px, py, image_size)
    hits, tri = cast(mesh, origins, dirs)
    n0 = POINT_GRID * POINT_GRID
    pin = _pin(mesh, hits[:n0], tri[:n0], origins[:n0], fwd)
    if pin is None:
        return Placement(kind="none", coverage=coverage)
    common = _common(mesh, pin, face_node, review, frame, coverage)
    if not patch:
        return Placement(kind="point", **common)
    data = _patch(hits[n0:].reshape(gh, gw, 3), gw, gh, fwd, pin[2], frame.height_m)
    if data is None:  # the kit leaves a patch with no surviving quad unmapped
        return Placement(kind="none", coverage=coverage)
    positions, uvs, direction, size = data
    texture, labels = patch_texture(shape, image_size, photo, colour)
    return Placement(
        kind="patch", patch=PatchData(positions, uvs, texture, labels, bbox, direction, size), **common
    )
```

Append to the end of the module:

```python
def _patch(P3: np.ndarray, gw: int, gh: int, fwd: np.ndarray, n: np.ndarray, height_m: float):
    """Quads from adjacent grid hits (kit `project.run`), as triangles; None when none survive."""
    steps = np.linalg.norm(np.diff(P3, axis=1), axis=2)
    steps = steps[np.isfinite(steps)]
    if steps.size == 0:
        return None
    thr = max(float(np.median(steps)) * EDGE_FACTOR, 1e-3)
    q = np.stack([P3[:-1, :-1], P3[:-1, 1:], P3[1:, 1:], P3[1:, :-1]], axis=2)  # (gh-1, gw-1, 4, 3)
    finite = np.isfinite(q).all(axis=(2, 3))
    with np.errstate(invalid="ignore"):
        edges = np.linalg.norm(q - np.roll(q, -1, axis=2), axis=3).max(axis=2)
        keep = finite & (edges <= thr)
    if not keep.any():
        return None
    us, vs = np.linspace(0, 1, gw), np.linspace(0, 1, gh)
    j, i = np.nonzero(keep)  # row-major: the kit's loop order
    quv = np.stack(
        [
            np.stack([us[i], 1 - vs[j]], axis=1),
            np.stack([us[i + 1], 1 - vs[j]], axis=1),
            np.stack([us[i + 1], 1 - vs[j + 1]], axis=1),
            np.stack([us[i], 1 - vs[j + 1]], axis=1),
        ],
        axis=1,
    )  # (k, 4, 2)
    order = [0, 1, 2, 0, 2, 3]  # two triangles per quad
    off = -fwd * height_m * OFFSET_FRACTION
    positions = (q[keep][:, order, :] + off).reshape(-1, 3).astype(np.float32)
    uvs = quv[:, order, :].reshape(-1, 2).astype(np.float32)
    ext = positions.max(0) - positions.min(0)
    d = n - fwd
    direction = tuple(float(v) for v in d / np.linalg.norm(d))
    size = (float(np.hypot(ext[0], ext[2])), float(ext[1]))
    return positions, uvs, direction, size


def _rgb(colour: str) -> tuple[int, int, int]:
    h = colour.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _fit(w: float, h: float, limit: int) -> tuple[int, int]:
    s = min(1.0, limit / max(w, h, 1.0))
    return max(1, int(round(w * s))), max(1, int(round(h * s)))


def _mask(outline, bbox, size: tuple[int, int]) -> np.ndarray:
    x0, y0, x1, y1 = bbox
    w, h = size
    sx, sy = w / max(x1 - x0, 1e-9), h / max(y1 - y0, 1e-9)
    im = PILImage.new("L", size, 0)
    ImageDraw.Draw(im).polygon([((px - x0) * sx, (py - y0) * sy) for px, py in outline], fill=1)
    return np.asarray(im, dtype=np.uint8)


def patch_texture(
    shape: SightingShape, image_size: tuple[int, int], photo: PILImage.Image | None, colour: str
) -> tuple[PILImage.Image, np.ndarray]:
    """The texture (RGBA, at most 512 px) and label grid (uint8, at most 128 px) for the box crop.

    With an outline: inside it, the photo crop with the colour mixed over it (plain colour without
    a photo), alpha 230; outside, transparent. Without one: the kit's tinted box, alpha 110, with a
    solid border. Sizes follow the crop at preview resolution, so a small box is never blown up."""
    W, H = image_size
    bbox = x0, y0, x1, y1 = shape.bbox(image_size)
    s = min(1.0, PREVIEW_SIDE / max(W, H))
    cw, ch = max(1.0, (x1 - x0) * s), max(1.0, (y1 - y0) * s)
    tw, th = _fit(cw, ch, TEXTURE_MAX)
    lw, lh = _fit(cw, ch, LABEL_MAX)
    rgb = np.array(_rgb(colour), np.float32)
    outline = shape.outline()
    if outline is None:
        a = np.zeros((th, tw, 4), np.uint8)
        a[..., :3] = rgb.astype(np.uint8)
        a[..., 3] = TINT_ALPHA
        bw = max(2, min(tw, th) // 20)
        a[:bw, :, 3] = a[-bw:, :, 3] = a[:, :bw, 3] = a[:, -bw:, 3] = 255
        return PILImage.fromarray(a, "RGBA"), np.ones((lh, lw), np.uint8)
    inside = _mask(outline, bbox, (tw, th))
    if photo is not None:
        px, py = photo.width / W, photo.height / H
        crop = photo.crop((x0 * px, y0 * py, x1 * px, y1 * py)).convert("RGB")
        base = np.asarray(crop.resize((tw, th), PILImage.BILINEAR), np.float32)
    else:
        base = np.broadcast_to(rgb, (th, tw, 3))
    fill = base * (1 - FILL_MIX) + rgb * FILL_MIX
    a = np.zeros((th, tw, 4), np.uint8)
    a[..., :3] = np.where(inside[..., None] == 1, fill, 0).astype(np.uint8)
    a[..., 3] = inside * FILL_ALPHA
    return PILImage.fromarray(a, "RGBA"), _mask(outline, bbox, (lw, lh))


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def encode_patch(positions: np.ndarray, uvs: np.ndarray) -> bytes:
    """`<sighting>.bin` (U1's format), little-endian: uint32 vertex count n, then n x 3 float32
    positions, then n x 2 float32 uvs. 4 + 20 n bytes."""
    n = int(len(positions))
    if len(uvs) != n:
        raise ValueError("a patch needs one uv per vertex")
    return (
        struct.pack("<I", n)
        + np.ascontiguousarray(positions, "<f4").tobytes()
        + np.ascontiguousarray(uvs, "<f4").tobytes()
    )


def decode_patch(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    (n,) = struct.unpack_from("<I", data, 0)
    if len(data) != 4 + 20 * n:
        raise ValueError("not a Kestrel patch file")
    pos = np.frombuffer(data, "<f4", n * 3, 4).reshape(n, 3)
    uv = np.frombuffer(data, "<f4", n * 2, 4 + 12 * n).reshape(n, 2)
    return pos, uv


def encode_labels(labels: np.ndarray) -> bytes:
    """`<sighting>.lbl` (U1's format), little-endian: uint16 width, uint16 height, then width x
    height uint8 (0 or 1), row-major, row 0 = the top of the crop (uv v = 1). 4 + w h bytes."""
    h, w = labels.shape
    return struct.pack("<HH", w, h) + np.ascontiguousarray(labels, np.uint8).tobytes()


def decode_labels(data: bytes) -> np.ndarray:
    w, h = struct.unpack_from("<HH", data, 0)
    if len(data) != 4 + w * h:
        raise ValueError("not a Kestrel label file")
    return np.frombuffer(data, np.uint8, w * h, 4).reshape(h, w)


def write_patch(dir: Path, sighting_id: str, patch: PatchData) -> str:
    """Write `<sighting>.bin`, `.png` and `.lbl` into `dir`, each atomically; returns the `.bin`
    path. The `.bin` goes last: when it is there, all three are."""
    d = Path(dir)
    d.mkdir(parents=True, exist_ok=True)
    png = io.BytesIO()
    patch.texture.save(png, "PNG")
    _atomic_write(d / f"{sighting_id}.png", png.getvalue())
    _atomic_write(d / f"{sighting_id}.lbl", encode_labels(patch.labels))
    bin_path = d / f"{sighting_id}.bin"
    _atomic_write(bin_path, encode_patch(patch.positions, patch.uvs))
    return str(bin_path)


def index_entry(patch: PatchData) -> dict:
    return {
        "vertex_count": int(len(patch.positions)),
        "texture_size": [patch.texture.width, patch.texture.height],
        "label_size": [int(patch.labels.shape[1]), int(patch.labels.shape[0])],
        "crop": [round(v, 2) for v in patch.crop],
        "direction": [round(v, 5) for v in patch.direction],
        "size": [round(v, 4) for v in patch.size],
    }


def read_index(dir: Path) -> dict:
    """`index.json`'s `items` (sighting id -> entry); {} when absent or unreadable (it is derived)."""
    try:
        data = json.loads((Path(dir) / INDEX_NAME).read_text("utf-8"))
        return dict(data.get("items") or {})
    except (OSError, ValueError, AttributeError):
        return {}


def write_index(dir: Path, asset_model_id: str, version: int, items: dict) -> None:
    body = {"format": PATCH_FORMAT, "asset_model_id": asset_model_id, "version": int(version), "items": items}
    _atomic_write(Path(dir) / INDEX_NAME, json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
```

- [ ] **Step 4: Run them to see them pass**

Run: `& $PY -m pytest tests/test_asset_place.py -q`
Expected: `20 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/place.py tests/test_asset_place.py
& $PY -m ruff format --check app/asset_review/place.py tests/test_asset_place.py
git add backend/app/asset_review/place.py backend/tests/test_asset_place.py
git commit -m "feat(asset-review): patch placement, textures, label grids and the patch file format (J3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Accuracy on the synthetic tower

**Files:**
- Create: `backend/tests/asset_place_helpers.py` (shared by Tasks 4 to 6)
- Test: `backend/tests/test_asset_place_tower.py`

**Interfaces:**
- Consumes:
  - `make_tower` (P1): `Tower.glb_path`, `frame`, `poses` (dicts with `position`, `target`, `up`, `hfov`, `vfov`), `truth` (`TruthFinding.id`, `center`, `radius`), `image_size`;
  - `meshes.load_glb_mesh` (J1);
  - `resolve`, `derive` (P1); `PoseIn` (J2); `place` (Tasks 2 and 3).
- Produces (test helpers):
  - `pose_in(p: dict) -> PoseIn`;
  - `TruthSighting(pose_index, truth_id, shape)`;
  - `project_truth(tower, mesh, box_m=0.2) -> list[TruthSighting]`;
  - `diamond(shape) -> SightingShape`.

**Why this test is shaped this way (a spec reading, recorded in Index notes).** Spec §12 says "every truth finding is placed within 0.25 m of its truth point". A truth point is the centre of a defect's geometry, for example the 0.4 m bird nest. A pin lands on the surface the camera sees, so a single sighting sits up to the defect's own radius away from that centre: 0.38 to 0.49 m for the nest. A finding is seen from several sides. While planning, the component-wise median of each truth finding's pins came within 0.177 m of the truth centre for all six defects (D1 0.145, D2 0.177, D3 0.140, D4 0.062, D5 0.045, D6 0.040), and its side and zone matched. The test asserts exactly that. The boxes are 0.2 m, the size a careful annotator draws around the visible defect, not the kit's radius boxes.

- [ ] **Step 1: Write the helpers**

```python
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


def add_photo(handle, model_id: str, name: str, pose: dict | None, *, size=(1600, 1067), seed: int = 0) -> str:
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


def add_sighting(handle, model_id: str, type_id: str, image_id: str, shape: SightingShape, severity: int = 2) -> str:
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
```

- [ ] **Step 2: Write the test**

```python
# backend/tests/test_asset_place_tower.py
"""Placement accuracy on the kit's synthetic tower (spec 2026-10-02-asset-findings §12): every truth
finding placed within 0.25 m of its truth point, on the right side and in the right zone."""

from collections import defaultdict

import numpy as np
import pytest
from asset_place_helpers import pose_in, project_truth
from fixtures.synthetic_tower import make_tower

from app.asset_review.derive import derive
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.place import place_sighting
from app.asset_review.profiles import resolve


@pytest.fixture(scope="module")
def tower(tmp_path_factory):
    return make_tower(tmp_path_factory.mktemp("tower"), photos=False)


def test_every_truth_finding_is_placed_within_a_quarter_metre(tower):
    mesh, face_node = load_glb_mesh(tower.glb_path)
    review = resolve("telecom_tower", tower.frame.height_m)
    sightings = project_truth(tower, mesh)
    by_truth = defaultdict(list)
    for ts in sightings:
        p = place_sighting(
            mesh,
            face_node,
            pose_in(tower.poses[ts.pose_index]),
            ts.shape,
            tower.image_size,
            review,
            None,
            "#ff7a2d",
            frame=tower.frame,
        )
        assert p.kind == "point", (ts.truth_id, ts.pose_index)
        by_truth[ts.truth_id].append(p)
    assert set(by_truth) == {t.id for t in tower.truth}
    for t in tower.truth:
        median = np.median(np.array([p.center for p in by_truth[t.id]]), axis=0)
        assert np.linalg.norm(median - np.asarray(t.center)) <= 0.25, t.id
        got = derive(tuple(float(v) for v in median), None, review, tower.frame)
        want = derive(tuple(t.center), None, review, tower.frame)
        assert (got.side, got.zone) == (want.side, want.zone), t.id


def test_the_hit_node_names_the_component(tower):
    """D2 is a splice plate on leg 2: every pin on it names the leg (J1's node names)."""
    mesh, face_node = load_glb_mesh(tower.glb_path)
    review = resolve("telecom_tower", tower.frame.height_m)
    parts = {
        place_sighting(
            mesh,
            face_node,
            pose_in(tower.poses[ts.pose_index]),
            ts.shape,
            tower.image_size,
            review,
            None,
            "#ff7a2d",
            frame=tower.frame,
        ).part
        for ts in project_truth(tower, mesh)
        if ts.truth_id == "D2"
    }
    assert parts == {"Leg"}
```

- [ ] **Step 3: Run it**

Run: `& $PY -m pytest tests/test_asset_place_tower.py -q`
Expected: `2 passed`. The test drives code that Tasks 2 and 3 already built, so it passes on first run. Check the TDD inversion: temporarily change `camera_rays` to `y = 1 - np.asarray(py, float) / H * 2` with `+ 0.1` added. Then `test_every_truth_finding_is_placed_within_a_quarter_metre` must fail. Revert the change.

- [ ] **Step 4: Lint and commit**

```powershell
& $PY -m ruff check tests/asset_place_helpers.py tests/test_asset_place_tower.py
& $PY -m ruff format --check tests/asset_place_helpers.py tests/test_asset_place_tower.py
git add backend/tests/asset_place_helpers.py backend/tests/test_asset_place_tower.py
git commit -m "test(asset-review): placement accuracy on the synthetic tower, 0.25 m, side and zone (J3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The `asset_place` job

**Files:**
- Create: `backend/app/asset_review/jobs_place.py`
- Test: `backend/tests/test_asset_place_job.py`

**Interfaces:**
- Consumes:
  - `load_version_mesh` (J1), which raises `AppError` 409 `not_ready`;
  - `Frame`, `ReviewConfig` (P1); `PoseIn` (J2);
  - `jobs_group.submit_group(handle, runner, asset_model_id)` (J4), which raises 409 `job_running`;
  - `app.datasets.images.image_file(handle, image_id, max_side)` (existing; the photo read at preview size);
  - `app.catalogue.service.get_scale` and `app.catalogue.handle.DEFAULT_SCALE` (existing; severity colours);
  - ORM `AssetModel`, `ImagePose`, `FindingSighting`, `Finding`, `Box`, `Image`, `Job`.
- Produces (in `app.asset_review.jobs_place`):
  - the job type `asset_place`, with params `{asset_model_id, only_dirty}` and result `{asset_model_id, version, placed, unplaced, point, patch, none, no_pose, group_job_id}`. `placed` = `point + patch` and `unplaced` = `none + no_pose`; these are the two keys U2's toast reads;
  - `run_place(ctx) -> dict`;
  - `submit(handle, runner, asset_model_id, only_dirty) -> Job` (404 for an unknown model; 409 `job_running`);
  - `placements_dir(handle, asset_model_id, version) -> Path`;
  - `severity_colours(catalogue) -> dict[int, str]`.
- What J3 writes: only `finding_sighting.placement`, `cx` to `nz`, `part`, `coverage`, `patch_path` and `placed_version` (J4 N3). It never writes a finding's derived columns; `asset_group` does that after it runs.
- A sighting whose photo has no pose for this model stays `pending` with `placed_version = null`. `only_dirty` places it once the pose exists.
- `only_dirty` selects `placement = 'pending'` (J4 N3: new sightings and box geometry edits). It also selects a sighting placed on another version (staleness).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_place_job.py
"""The asset_place job (plan 2026-10-03-asset-findings-j3 Task 5): rows, files, photo reads, dirty
runs, cancel, and the hand-off to asset_group. The synthetic tower, seeded straight into a project."""

import json
import logging
import time
from types import SimpleNamespace

import numpy as np
import pytest
from asset_place_helpers import add_photo, add_sighting, diamond, project_truth, seed_model
from fixtures.synthetic_tower import make_tower
from PIL import Image as PILImage

from app.asset_review import jobs_place, place
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.profiles import resolve
from app.db.models import AssetModel, FindingSighting
from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure


class FakeRunner:
    def __init__(self, fail: bool = False):
        self.catalogue, self.submitted, self.fail = None, [], fail

    def submit(self, handle, type, params):
        if self.fail:
            raise AppError("job_running", "already grouping", 409)
        self.submitted.append((type, params))
        return SimpleNamespace(id=f"job-{len(self.submitted)}")


class Ctx:
    def __init__(self, handle, params, *, runner=None, cancel_after=None):
        self.project, self.params, self.job_id = handle, params, "job-place"
        self.runner = runner or FakeRunner()
        self.log = logging.getLogger("test.asset_place")
        self.published, self.progress_calls = [], []
        self.cancel_after, self.checks = cancel_after, 0

    def progress(self, fraction, message=""):
        self.progress_calls.append((fraction, message))

    def publish(self, type, payload):
        self.published.append((type, payload))

    def check_cancelled(self):
        self.checks += 1
        if self.cancel_after is not None and self.checks > self.cancel_after:
            raise JobCancelled()


@pytest.fixture(scope="module")
def tower(tmp_path_factory):
    return make_tower(tmp_path_factory.mktemp("tower"), photos=False)


@pytest.fixture(scope="module")
def truth(tower):
    mesh, _ = load_glb_mesh(tower.glb_path)
    return project_truth(tower, mesh)


def seed(handle, tower, items, type_id, profile="telecom_tower", polygons=()):
    """A model, one photo per pose used, and one sighting per item; items whose index is in
    `polygons` are drawn as diamonds."""
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve(profile, tower.frame.height_m))
    photos, sids = {}, []
    for k, ts in enumerate(items):
        if ts.pose_index not in photos:
            photos[ts.pose_index] = add_photo(
                handle, mid, f"p{ts.pose_index:03d}.jpg", tower.poses[ts.pose_index], seed=ts.pose_index
            )
        shape = diamond(ts.shape) if k in polygons else ts.shape
        sids.append(add_sighting(handle, mid, type_id, photos[ts.pose_index], shape))
    return mid, sids


def row(handle, sid):
    with handle.session() as s:
        r = s.get(FindingSighting, sid)
        s.expunge(r)
        return r


def test_the_job_places_pins_and_hands_over_to_grouping(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:6], crack["id"])
    ctx = Ctx(handle, {"asset_model_id": mid, "only_dirty": False})
    result = jobs_place.run_place(ctx)
    assert (result["point"], result["patch"], result["none"], result["no_pose"]) == (6, 0, 0, 0)
    assert (result["placed"], result["unplaced"]) == (6, 0)
    assert result["version"] == 1 and result["group_job_id"] == "job-1"
    centres = {t.id: np.asarray(t.center) for t in tower.truth}
    for ts, sid in zip(truth[:6], sids, strict=True):
        r = row(handle, sid)
        assert r.placement == "point" and r.placed_version == 1 and r.patch_path is None
        assert np.linalg.norm(np.array([r.cx, r.cy, r.cz]) - centres[ts.truth_id]) < 1.0
        assert np.linalg.norm([r.nx, r.ny, r.nz]) == pytest.approx(1.0, abs=1e-6)
        assert r.part and r.coverage > 0
    assert ctx.runner.submitted == [("asset_group", {"asset_model_id": mid})]
    assert ("asset_models.changed", {"asset_model_ids": [mid]}) in ctx.published


def test_job_ray_miss_marks_none_and_succeeds(handle, tower, truth, crack):
    """Review Focus 2 at job level: a photo looking away from the tower gives `none`, never a fake
    hit, and the job still succeeds for the others."""
    mid, _ = seed(handle, tower, truth[:2], crack["id"])
    away = {"position": [60.0, 10.0, 0.0], "target": [90.0, 10.0, 0.0], "up": [0, 1, 0], "hfov": 60.0, "vfov": 45.0}
    image = add_photo(handle, mid, "away.jpg", away)
    miss = add_sighting(handle, mid, crack["id"], image, place.SightingShape(700, 400, 200, 200))
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["none"] == 1 and result["point"] == 2
    r = row(handle, miss)
    assert r.placement == "none" and r.placed_version == 1
    assert (r.cx, r.cy, r.cz, r.nx, r.part, r.patch_path) == (None,) * 6


def test_a_photo_without_a_pose_leaves_its_sighting_pending(handle, tower, truth, crack):
    mid, _ = seed(handle, tower, truth[:1], crack["id"])
    bare = add_photo(handle, mid, "bare.jpg", None)
    sid = add_sighting(handle, mid, crack["id"], bare, place.SightingShape(700, 400, 200, 200))
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["no_pose"] == 1 and result["point"] == 1
    assert (result["placed"], result["unplaced"]) == (1, 1)
    r = row(handle, sid)
    assert r.placement == "pending" and r.placed_version is None


def test_the_job_writes_patch_files_and_the_index(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:3], crack["id"], profile="building_facade", polygons={0})
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["patch"] == 1 and result["point"] == 2
    sid = sids[0]
    r = row(handle, sid)
    assert r.placement == "patch" and r.patch_path == f"asset_models/{mid}/placements/v1/{sid}.bin"
    folder = handle.folder / f"asset_models/{mid}/placements/v1"
    pos, uv = place.decode_patch((folder / f"{sid}.bin").read_bytes())
    assert len(pos) > 0 and len(pos) == len(uv) and len(pos) % 3 == 0
    with PILImage.open(folder / f"{sid}.png") as im:
        assert im.mode == "RGBA" and max(im.size) <= place.TEXTURE_MAX
    assert max(place.decode_labels((folder / f"{sid}.lbl").read_bytes()).shape) <= place.LABEL_MAX
    index = json.loads((folder / "index.json").read_text("utf-8"))
    assert index["version"] == 1 and set(index["items"]) == {sid} and len(index["items"][sid]["size"]) == 2


def test_each_photo_is_read_once_at_preview_size(handle, tower, truth, crack, monkeypatch):
    first = truth[0]
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("building_facade", tower.frame.height_m))
    image = add_photo(handle, mid, "p.jpg", tower.poses[first.pose_index])
    for shape in (diamond(first.shape), diamond(first.shape), first.shape):
        add_sighting(handle, mid, crack["id"], image, shape)
    calls = []
    real = jobs_place.images.image_file
    monkeypatch.setattr(
        jobs_place.images, "image_file", lambda h, i, max_side: calls.append((i, max_side)) or real(h, i, max_side)
    )
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["patch"] == 2 and result["point"] == 1
    assert calls == [(image, 2048)]


def test_only_dirty_places_only_what_changed(handle, tower, truth, crack, monkeypatch):
    mid, sids = seed(handle, tower, truth[:4], crack["id"])
    jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    with handle.session() as s:
        s.get(FindingSighting, sids[2]).placement = "pending"  # J4 does this on a box edit
    calls = []
    real = place.place_sighting
    monkeypatch.setattr(place, "place_sighting", lambda *a, **k: calls.append(1) or real(*a, **k))
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid, "only_dirty": True}))
    assert len(calls) == 1 and result["point"] == 1
    assert row(handle, sids[2]).placement == "point"


def test_a_cancel_keeps_the_sightings_already_placed(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:5], crack["id"])
    with pytest.raises(JobCancelled):
        jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}, cancel_after=3))
    rows = [row(handle, sid) for sid in sids]
    assert sum(r.placed_version == 1 for r in rows) == 3
    assert sum(r.placement == "pending" for r in rows) == 2
    assert jobs_place.run_place(Ctx(handle, {"asset_model_id": mid, "only_dirty": True}))["point"] == 2


def test_the_job_fails_plainly_without_a_review_profile(handle, tower):
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("telecom_tower", tower.frame.height_m))
    with handle.session() as s:
        s.get(AssetModel, mid).review = None
    with pytest.raises(JobFailure, match="review profile"):
        jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))


def test_a_full_run_prunes_stale_patch_files_and_old_versions(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:2], crack["id"], profile="building_facade", polygons={0})
    root = handle.folder / f"asset_models/{mid}/placements"
    (root / "v0").mkdir(parents=True)
    (root / "v0" / "old.bin").write_bytes(b"x")
    (root / "v1").mkdir(parents=True, exist_ok=True)
    (root / "v1" / "ghost.png").write_bytes(b"x")
    jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert not (root / "v0").exists() and not (root / "v1" / "ghost.png").exists()
    assert (root / "v1" / f"{sids[0]}.bin").is_file()


def test_a_group_job_that_cannot_be_queued_does_not_fail_placement(handle, tower, truth, crack):
    mid, _ = seed(handle, tower, truth[:1], crack["id"])
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}, runner=FakeRunner(fail=True)))
    assert result["point"] == 1 and result["group_job_id"] is None


def test_progress_is_throttled(handle, tower, truth, crack):
    mid, _ = seed(handle, tower, truth[:8], crack["id"])
    ctx = Ctx(handle, {"asset_model_id": mid})
    started = time.monotonic()
    jobs_place.run_place(ctx)
    elapsed = time.monotonic() - started
    assert len(ctx.progress_calls) <= 3 + int(elapsed / jobs_place.PROGRESS_EVERY_S)
    assert ctx.progress_calls[0][0] == 0 and ctx.progress_calls[-1][0] == 1
```

- [ ] **Step 2: Run it to see it fail**

Run: `& $PY -m pytest tests/test_asset_place_job.py -q`
Expected: collection error, `ImportError: cannot import name 'jobs_place' from 'app.asset_review'`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_review/jobs_place.py
"""`asset_place` (spec 2026-10-02-asset-findings §6.3): back-project an asset model's sightings onto
its current version, then queue `asset_group`.

Bounded: the mesh is loaded once (J1 caches it per GLB). Sightings are read 64 at a time, ordered
by photo, so one preview-size photo (2,048 px, `app.datasets.images.image_file`) is in memory at a
time, and only for a sighting that needs a texture. Results are written 64 at a time; a cancel keeps
what was written, and `only_dirty` picks up the rest. A sighting whose photo has no pose stays
`pending`. J3 writes only the sighting's placement columns, never the finding's (J4 N3).
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from PIL import Image as PILImage
from sqlalchemy import or_, select

from app.asset_models import store
from app.asset_review import place
from app.asset_review.frame import Frame
from app.asset_review.jobs_group import submit_group
from app.asset_review.meshes import load_version_mesh
from app.asset_review.poses import PoseIn
from app.asset_review.profiles import ReviewConfig
from app.catalogue.handle import DEFAULT_SCALE
from app.datasets import images
from app.db.models import AssetModel, Box, Finding, FindingSighting, Image, ImagePose, Job
from app.errors import AppError, not_found
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

JOB_TYPE = "asset_place"
LIVE_STATES = ("queued", "running")
CHUNK = 64
PROGRESS_EVERY_S = 0.25
UNGRADED_COLOUR = "#9aa0a6"


def placements_dir(handle, asset_model_id: str, version: int) -> Path:
    """`asset_models/<id>/placements/v<n>/` (spec §5.7)."""
    return store.model_dir(handle, asset_model_id) / "placements" / f"v{int(version)}"


def severity_colours(catalogue) -> dict[int, str]:
    """Level -> `#rrggbb` from the catalogue's scale; D4's defaults when it is unavailable."""
    if catalogue is not None:
        try:
            from app.catalogue.service import get_scale

            return {lv.level: lv.colour for lv in get_scale(catalogue)}
        except Exception:  # the colours are cosmetic: never fail a placement over them
            pass
    return {lv: colour for lv, _, colour in DEFAULT_SCALE}


def _live(handle, asset_model_id: str) -> str | None:
    with handle.session() as s:
        for job_id, params in s.execute(
            select(Job.id, Job.params).where(Job.type == JOB_TYPE, Job.state.in_(LIVE_STATES))
        ):
            if (params or {}).get("asset_model_id") == asset_model_id:
                return job_id
    return None


def submit(handle, runner, asset_model_id: str, only_dirty: bool) -> Job:
    """Queue a placement run: 404 for an unknown model, 409 `job_running` while one is live for it."""
    with handle.session() as s:
        if s.get(AssetModel, asset_model_id) is None:
            raise not_found("asset model", asset_model_id)
    live = _live(handle, asset_model_id)
    if live is not None:
        raise AppError(
            "job_running", "Findings are already being placed on this model.", 409, {"job_id": live}
        )
    return runner.submit(handle, JOB_TYPE, {"asset_model_id": asset_model_id, "only_dirty": bool(only_dirty)})


def _sighting_ids(s, asset_model_id: str, version: int, only_dirty: bool) -> list[str]:
    q = select(FindingSighting.id).where(FindingSighting.asset_model_id == asset_model_id)
    if only_dirty:
        q = q.where(
            or_(
                FindingSighting.placement == "pending",
                FindingSighting.placed_version.is_(None),
                FindingSighting.placed_version != version,
            )
        )
    return list(s.scalars(q.order_by(FindingSighting.image_id, FindingSighting.id)))


def _load_chunk(s, ids: list[str], asset_model_id: str) -> list[dict]:
    """Plain values for one chunk, in the given order: the session closes before any ray is cast."""
    rows = s.execute(
        select(FindingSighting, Box, Image, ImagePose, Finding.severity)
        .join(Box, Box.id == FindingSighting.annotation_id)
        .join(Image, Image.id == FindingSighting.image_id)
        .outerjoin(Finding, Finding.id == FindingSighting.finding_id)
        .outerjoin(
            ImagePose,
            (ImagePose.image_id == FindingSighting.image_id) & (ImagePose.asset_model_id == asset_model_id),
        )
        .where(FindingSighting.id.in_(ids))
    ).all()
    by_id = {}
    for sg, box, image, pose, finding_severity in rows:
        by_id[sg.id] = {
            "id": sg.id,
            "image_id": image.id,
            "size": (int(image.width), int(image.height)),
            "shape": place.SightingShape.from_box(box),
            "severity": sg.severity if sg.severity is not None else finding_severity,
            "pose": None
            if pose is None
            else PoseIn(
                position=list(pose.position),
                target=list(pose.target),
                up=list(pose.up),
                hfov_deg=float(pose.hfov_deg),
                vfov_deg=float(pose.vfov_deg),
                source=pose.source,
                accuracy_m=pose.accuracy_m,
            ),
        }
    return [by_id[i] for i in ids if i in by_id]


class _Photo:
    """The one photo in memory: the current image's preview, read only when a texture needs it."""

    def __init__(self, handle, log):
        self.handle, self.log = handle, log
        self.image_id: str | None = None
        self.image: PILImage.Image | None = None

    def get(self, image_id: str) -> PILImage.Image | None:
        if image_id != self.image_id:
            self.image_id, self.image = image_id, None
            try:
                with PILImage.open(images.image_file(self.handle, image_id, place.PREVIEW_SIDE)) as im:
                    self.image = im.convert("RGB")
            except (AppError, OSError) as e:  # a missing photo gives a plain-colour texture, not a failure
                self.log.warning("photo %s unreadable for a patch texture: %s", image_id, e)
        return self.image


def _write(handle, results: list[tuple[str, dict]]) -> None:
    if not results:
        return
    with handle.session() as s:
        for sid, fields in results:
            r = s.get(FindingSighting, sid)
            if r is None:  # its box was deleted while the job ran
                continue
            for k, v in fields.items():
                setattr(r, k, v)
    results.clear()


def _cleared(placement: str, version: int | None) -> dict:
    return {
        "placement": placement,
        "cx": None,
        "cy": None,
        "cz": None,
        "nx": None,
        "ny": None,
        "nz": None,
        "part": None,
        "patch_path": None,
        "placed_version": version,
    }


def _remove_files(folder: Path, sid: str) -> None:
    for ext in (".bin", ".png", ".lbl"):
        (folder / f"{sid}{ext}").unlink(missing_ok=True)


@register_job_type(JOB_TYPE)
def run_place(ctx) -> dict:
    handle = ctx.project
    mid = ctx.params["asset_model_id"]
    only_dirty = bool(ctx.params.get("only_dirty", False))
    with handle.session() as s:
        model = s.get(AssetModel, mid)
        if model is None:
            raise JobFailure("The asset model no longer exists.")
        if model.current_version is None:
            raise JobFailure("The asset model has no version to place findings on.")
        if model.frame is None or model.review is None:
            raise JobFailure("Set the asset model's frame and review profile before placing findings.")
        version = int(model.current_version)
        frame = Frame.model_validate(model.frame)
        review = ReviewConfig.model_validate(model.review)
        ids = _sighting_ids(s, mid, version, only_dirty)
    ctx.progress(0, f"Placing {len(ids):,} sightings")
    counts = {"point": 0, "patch": 0, "none": 0, "no_pose": 0}
    folder = placements_dir(handle, mid, version)
    folder.mkdir(parents=True, exist_ok=True)
    index = place.read_index(folder)
    seen: set[str] = set()
    try:
        if ids:
            _place_all(ctx, handle, mid, version, ids, frame, review, folder, index, seen, counts)
    finally:
        place.write_index(folder, mid, version, index)  # a cancel keeps the patches already written
    if not only_dirty:  # every sighting of the model was visited: drop what no longer exists
        index = {k: v for k, v in index.items() if k in seen}
        place.write_index(folder, mid, version, index)
        _prune(folder, index)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    group_job_id = None
    try:
        group_job_id = submit_group(handle, ctx.runner, mid).id
    except AppError as e:  # a grouping already live, say: placing still succeeded
        ctx.log.warning("could not queue asset_group: %s", e)
    ctx.progress(
        1, f"Placed {counts['patch']:,} patches and {counts['point']:,} pins; {counts['none']:,} did not hit"
    )
    placed, unplaced = counts["point"] + counts["patch"], counts["none"] + counts["no_pose"]
    return {
        "asset_model_id": mid,
        "version": version,
        "placed": placed,
        "unplaced": unplaced,
        **counts,
        "group_job_id": group_job_id,
    }


def _place_all(ctx, handle, mid, version, ids, frame, review, folder, index, seen, counts) -> None:
    try:
        mesh, face_node = load_version_mesh(handle, mid, version)
    except AppError as e:
        raise JobFailure("The model's 3D file is not ready. Import or build it, then try again.") from e
    colours = severity_colours(getattr(ctx.runner, "catalogue", None))
    photo = _Photo(handle, ctx.log)
    pending: list[tuple[str, dict]] = []
    last = 0.0
    done = 0
    try:
        for start in range(0, len(ids), CHUNK):
            with handle.session() as s:
                rows = _load_chunk(s, ids[start : start + CHUNK], mid)
            for r in rows:
                ctx.check_cancelled()
                sid = r["id"]
                seen.add(sid)
                if r["pose"] is None:  # stays dirty: `only_dirty` places it once the photo has a pose
                    counts["no_pose"] += 1
                    fields = _cleared("pending", None)
                else:
                    shape = r["shape"]
                    needs_photo = place.wants_patch(shape, review.placement) and shape.outline() is not None
                    result = place.place_sighting(
                        mesh,
                        face_node,
                        r["pose"],
                        shape,
                        r["size"],
                        review,
                        photo.get(r["image_id"]) if needs_photo else None,
                        colours.get(r["severity"], UNGRADED_COLOUR),
                        frame=frame,
                    )
                    counts[result.kind] += 1
                    fields = _cleared(result.kind, version)
                    fields["coverage"] = result.coverage
                    if result.center is not None:
                        fields.update(zip(("cx", "cy", "cz"), result.center, strict=True))
                        fields.update(zip(("nx", "ny", "nz"), result.normal, strict=True))
                        fields["part"] = result.part
                    if result.patch is not None:
                        path = Path(place.write_patch(folder, sid, result.patch))
                        fields["patch_path"] = path.relative_to(handle.folder).as_posix()
                        index[sid] = place.index_entry(result.patch)
                if fields["patch_path"] is None:
                    index.pop(sid, None)
                    _remove_files(folder, sid)
                pending.append((sid, fields))
                done += 1
                if len(pending) >= CHUNK:
                    _write(handle, pending)
                now = time.monotonic()
                if now - last >= PROGRESS_EVERY_S:
                    last = now
                    ctx.progress(done / len(ids), f"Placed {done:,} of {len(ids):,} sightings")
    finally:
        _write(handle, pending)  # a cancel or a failure keeps every sighting already placed


def _prune(folder: Path, index: dict) -> None:
    """After a full run: patch files of sightings that are no longer patches, and other versions'
    folders (derived files, safe to delete, spec §5.7)."""
    for p in folder.iterdir():
        if p.suffix in (".bin", ".png", ".lbl") and p.stem not in index:
            p.unlink(missing_ok=True)
    for other in folder.parent.iterdir():
        if other.is_dir() and other != folder and other.name.startswith("v"):
            shutil.rmtree(other, ignore_errors=True)
```

- [ ] **Step 4: Run it to see it pass**

Run: `& $PY -m pytest tests/test_asset_place_job.py -q`
Expected: `11 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/jobs_place.py tests/test_asset_place_job.py
& $PY -m ruff format --check app/asset_review/jobs_place.py tests/test_asset_place_job.py
git add backend/app/asset_review/jobs_place.py backend/tests/test_asset_place_job.py
git commit -m "feat(asset-review): the asset_place job, bounded per sighting, then asset_group (J3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The placements API, the stubs and the timing budget

**Files:**
- Create: `backend/app/asset_review/placement_schemas.py`
- Create: `backend/app/asset_review/routes_placements.py`
- Modify: `backend/app/asset_review/stubs.py` (delete J3's five tuples)
- Modify: `backend/app/api.py` (route the new module)
- Modify: `backend/tests/test_contract.py`, only if it names J3's operations by hand
- Test: `backend/tests/test_asset_placements_api.py`, `backend/tests/test_asset_place_perf.py`

**Interfaces:**
- Consumes: `jobs_place.submit`, `placements_dir`, `place.read_index` (Tasks 3 and 5); `JobRef` (`app.training.schemas`); `JobOut` (`app.jobs.schemas`).
- Produces, over HTTP, under `/api/v1/projects/{projectId}/asset-models/{assetModelId}`:

| Method | Path | operationId | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/placements?after&limit` | `listPlacements` | 200 `PlacementList {version, items, next}` | 404 unknown model; 422 `limit` outside 1 to 2,000 |
| GET | `/placements/{sightingId}/mesh` | `getPlacementMesh` | 200 `application/octet-stream` (the `.bin`), `ETag`; 304 on `If-None-Match` | 404 when it is not a current patch on this model |
| GET | `/placements/{sightingId}/texture` | `getPlacementTexture` | 200 `image/png`, `ETag`; 304 | 404 |
| GET | `/placements/{sightingId}/labels` | `getPlacementLabels` | 200 `application/octet-stream` (the `.lbl`), `ETag`; 304 | 404 |
| POST | `/placements/compute` body `{only_dirty?: boolean}` | `computePlacements` | 202 `JobRef` | 404; 409 `job_running` |

- A `Placement` has these fields:
  - `sighting_id`;
  - `finding_id` (string or null, because a sighting may be ungrouped);
  - `kind` (`point` or `patch`);
  - `center` and `normal` (3 numbers each);
  - `size` (`[horizontal_m, vertical_m]`, or null for a pin);
  - `severity` (the sighting's own grade, else its finding's; may be null);
  - `patch_url` (the mesh path, or null).
- Only sightings placed on the model's **current** version are listed, ordered by `sighting_id`. `after` is the last `sighting_id` of the previous page, and `next` is null on the last page.
- The ETag is `"<sightingId>-<mtime_ns hex>-<size hex>"`. It changes whenever the job rewrites the file.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_placements_api.py
"""The placements API (spec 2026-10-02-asset-findings §8; plan J3 Task 6)."""

import pytest
from asset_place_helpers import add_photo, add_sighting, diamond, project_truth, seed_model
from fixtures.synthetic_tower import make_tower
from test_asset_place_job import Ctx

from app.asset_review import jobs_place, place
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.profiles import resolve
from app.db.models import Job

API = "/api/v1/projects"


@pytest.fixture(scope="module")
def tower(tmp_path_factory):
    return make_tower(tmp_path_factory.mktemp("tower"), photos=False)


@pytest.fixture(scope="module")
def truth(tower):
    mesh, _ = load_glb_mesh(tower.glb_path)
    return project_truth(tower, mesh)


def seeded(handle, tower, items, type_id, polygons=()):
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("building_facade", tower.frame.height_m))
    photos, sids = {}, []
    for k, ts in enumerate(items):
        if ts.pose_index not in photos:
            photos[ts.pose_index] = add_photo(handle, mid, f"q{ts.pose_index:03d}.jpg", tower.poses[ts.pose_index])
        shape = diamond(ts.shape) if k in polygons else ts.shape
        sids.append(add_sighting(handle, mid, type_id, photos[ts.pose_index], shape))
    return mid, sids


@pytest.fixture
def placed(handle, tower, truth, crack):
    mid, sids = seeded(handle, tower, truth[:5], crack["id"], polygons={0})
    jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    return mid, sids


def test_placements_page_with_the_version(client, project_id, placed):
    mid, sids = placed
    url = f"{API}/{project_id}/asset-models/{mid}/placements"
    first = client.get(url, params={"limit": 2}).json()
    assert first["version"] == 1 and len(first["items"]) == 2
    assert first["next"] == first["items"][-1]["sighting_id"]
    second = client.get(url, params={"limit": 2, "after": first["next"]}).json()
    rest = client.get(url, params={"after": second["next"]}).json()
    assert rest["next"] is None
    items = first["items"] + second["items"] + rest["items"]
    assert sorted(i["sighting_id"] for i in items) == sorted(sids)
    patch = next(i for i in items if i["kind"] == "patch")
    assert patch["sighting_id"] == sids[0] and len(patch["size"]) == 2
    assert patch["patch_url"].endswith(f"/asset-models/{mid}/placements/{sids[0]}/mesh")
    pin = next(i for i in items if i["kind"] == "point")
    assert pin["size"] is None and pin["patch_url"] is None and pin["severity"] == 2
    assert len(pin["center"]) == 3 and len(pin["normal"]) == 3 and pin["finding_id"] is None
    assert client.get(url, params={"limit": 2001}).status_code == 422


def test_patch_binaries_carry_an_etag_and_answer_304(client, project_id, placed):
    mid, sids = placed
    base = f"{API}/{project_id}/asset-models/{mid}/placements/{sids[0]}"
    mesh = client.get(f"{base}/mesh")
    assert mesh.status_code == 200 and mesh.headers["content-type"] == "application/octet-stream"
    pos, uv = place.decode_patch(mesh.content)
    assert len(pos) == len(uv) > 0
    etag = mesh.headers["etag"]
    again = client.get(f"{base}/mesh", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.headers["etag"] == etag
    tex = client.get(f"{base}/texture")
    assert tex.headers["content-type"] == "image/png" and tex.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert place.decode_labels(client.get(f"{base}/labels").content).max() == 1


def test_binaries_are_404_for_a_pin_an_unknown_sighting_or_model(client, project_id, placed):
    mid, sids = placed
    root = f"{API}/{project_id}/asset-models/{mid}/placements"
    assert client.get(f"{root}/{sids[1]}/mesh").status_code == 404  # a pin has no patch
    assert client.get(f"{root}/nope/texture").status_code == 404
    assert client.get(f"{API}/{project_id}/asset-models/nope/placements").status_code == 404


def test_compute_queues_the_job_and_refuses_a_second(client, project_id, handle, tower, truth, crack, wait_job):
    mid, _ = seeded(handle, tower, truth[:2], crack["id"])
    url = f"{API}/{project_id}/asset-models/{mid}/placements/compute"
    r = client.post(url, json={"only_dirty": False})
    assert r.status_code == 202 and r.json()["job"]["type"] == "asset_place"
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded" and job["result"]["point"] == 2
    with handle.session() as s:
        s.add(Job(type="asset_place", state="running", params={"asset_model_id": mid}))
    busy = client.post(url, json={})
    assert busy.status_code == 409 and busy.json()["code"] == "job_running"
    assert client.post(f"{API}/{project_id}/asset-models/nope/placements/compute", json={}).status_code == 404
```

```python
# backend/tests/test_asset_place_perf.py
"""Timing budgets for asset_place (spec 2026-10-02-asset-findings §11: DAMAC's 1,441 sightings in
under 5 minutes). Run on an idle machine: `pytest -m perf tests/test_asset_place_perf.py`."""

import time

import numpy as np
import pytest
import trimesh
from asset_place_helpers import add_photo, add_sighting, diamond, project_truth, seed_model
from fixtures.synthetic_tower import make_tower
from test_asset_place_job import Ctx

from app.asset_review import jobs_place, raycast
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.profiles import resolve

pytestmark = pytest.mark.perf


def test_200_tower_sightings_place_in_under_30_seconds(handle, tmp_path, crack):
    """Half polygons (patches, grid 14, textures over the photo), half boxes (pins): 0.15 s a
    sighting at most, under the 0.2 s a sighting that DAMAC's 5 minutes allow."""
    tower = make_tower(tmp_path / "tower", photos=False)
    mesh, _ = load_glb_mesh(tower.glb_path)
    truth = project_truth(tower, mesh)
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("building_facade", tower.frame.height_m))
    photos = {}
    for k in range(200):
        ts = truth[k % len(truth)]
        if ts.pose_index not in photos:
            photos[ts.pose_index] = add_photo(handle, mid, f"p{ts.pose_index:03d}.jpg", tower.poses[ts.pose_index])
        add_sighting(handle, mid, crack["id"], photos[ts.pose_index], diamond(ts.shape) if k % 2 == 0 else ts.shape)
    started = time.perf_counter()
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    elapsed = time.perf_counter() - started
    assert result["patch"] + result["point"] + result["none"] == 200
    assert elapsed < 30.0, f"{elapsed:.1f} s for 200 sightings"


def test_ebsm_scale_mesh_casts_78_patch_grids_in_under_60_seconds():
    """EBSM's GLB has 711k vertices; this sphere has 655k vertices and 1.31M faces. Its 78 sightings
    are stack patches with grid 48 (48 x 96 rays): about 0.35 s each while planning."""
    sphere = trimesh.creation.icosphere(subdivisions=8, radius=10.0)
    o = np.array([40.0, 0.0, 0.0])
    a, b = np.meshgrid(np.linspace(-0.1, 0.1, 48), np.linspace(-0.2, 0.2, 96))
    started = time.perf_counter()
    for k in range(78):
        tilt = (k % 13 - 6) * 0.02
        d = np.stack([-np.ones(a.size), b.ravel() + tilt, a.ravel()], axis=1)
        t, face = raycast.first_hits(sphere.vertices, sphere.faces, np.repeat(o[None], len(d), 0), d)
        assert (face >= 0).all()
    elapsed = time.perf_counter() - started
    assert elapsed < 60.0, f"{elapsed:.1f} s for 78 EBSM-sized casts"
```

- [ ] **Step 2: Run them to see them fail**

Run: `& $PY -m pytest tests/test_asset_placements_api.py -q`
Expected: failures. `listPlacements` and the binary GETs answer 501 `not_implemented` (C0's stubs), so `test_placements_page_with_the_version` fails on `KeyError: 'version'`, and the compute test gets 501, not 202.

- [ ] **Step 3: Implement the schemas and routes**

```python
# backend/app/asset_review/placement_schemas.py
"""Placements (spec 2026-10-02-asset-findings §8): the contract's `Placement`, `PlacementList` and
the compute body."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class PlacementOut(BaseModel):
    sighting_id: str
    finding_id: str | None
    kind: Literal["point", "patch"]
    center: list[float]
    normal: list[float]
    size: list[float] | None
    severity: int | None
    patch_url: str | None


class PlacementList(BaseModel):
    version: int | None
    items: list[PlacementOut]
    next: str | None


class ComputePlacementsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    only_dirty: bool = False
```

```python
# backend/app/asset_review/routes_placements.py
"""Placements on an asset model (spec 2026-10-02-asset-findings §8): the keyset-paged index for the
current version, the three binaries of one patch (with an ETag), and the compute job."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.asset_review import jobs_place, place
from app.asset_review.placement_schemas import ComputePlacementsIn, PlacementList, PlacementOut
from app.db.models import AssetModel, Finding, FindingSighting
from app.errors import not_found
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])
P = "/asset-models/{assetModelId}/placements"
MAX_PAGE = 2000
BINARY_HEADERS = {"Cache-Control": "private, no-cache"}
KINDS = {
    "mesh": (".bin", "application/octet-stream"),
    "texture": (".png", "image/png"),
    "labels": (".lbl", "application/octet-stream"),
}


def _model(s, asset_model_id: str) -> AssetModel:
    row = s.get(AssetModel, asset_model_id)
    if row is None:
        raise not_found("asset model", asset_model_id)
    return row


@router.get(P, response_model=PlacementList)
def list_placements(
    assetModelId: str,  # noqa: N803
    after: str | None = None,
    limit: int = Query(MAX_PAGE, ge=1, le=MAX_PAGE),
    handle: ProjectHandle = Depends(get_project),
) -> PlacementList:
    with handle.session() as s:
        version = _model(s, assetModelId).current_version
        if version is None:
            return PlacementList(version=None, items=[], next=None)
        q = (
            select(FindingSighting, func.coalesce(FindingSighting.severity, Finding.severity))
            .outerjoin(Finding, Finding.id == FindingSighting.finding_id)
            .where(
                FindingSighting.asset_model_id == assetModelId,
                FindingSighting.placed_version == version,
                FindingSighting.placement.in_(("point", "patch")),
            )
            .order_by(FindingSighting.id)
        )
        if after:
            q = q.where(FindingSighting.id > after)
        rows = s.execute(q.limit(limit + 1)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    index = place.read_index(jobs_place.placements_dir(handle, assetModelId, version))
    base = f"/api/v1/projects/{handle.id}{P.replace('{assetModelId}', assetModelId)}"
    items = []
    for sg, severity in rows:
        entry = index.get(sg.id) if sg.placement == "patch" else None
        items.append(
            PlacementOut(
                sighting_id=sg.id,
                finding_id=sg.finding_id,
                kind=sg.placement,
                center=[sg.cx, sg.cy, sg.cz],
                normal=[sg.nx, sg.ny, sg.nz],
                size=entry["size"] if entry else None,
                severity=severity,
                patch_url=f"{base}/{sg.id}/mesh" if sg.placement == "patch" and sg.patch_path else None,
            )
        )
    return PlacementList(version=version, items=items, next=rows[-1][0].id if more and rows else None)


def _patch_file(handle: ProjectHandle, asset_model_id: str, sighting_id: str, suffix: str) -> Path:
    """The file of a patch placed on the model's current version; 404 for anything else."""
    with handle.session() as s:
        version = _model(s, asset_model_id).current_version
        row = s.execute(
            select(FindingSighting).where(
                FindingSighting.id == sighting_id, FindingSighting.asset_model_id == asset_model_id
            )
        ).scalar_one_or_none()
        if row is None or row.placement != "patch" or not row.patch_path or row.placed_version != version:
            raise not_found("placement", sighting_id)
        rel = row.patch_path
    path = (handle.folder / rel).with_suffix(suffix)
    if not path.is_file():
        raise not_found("placement", sighting_id)
    return path


def _binary(request: Request, path: Path, media_type: str, sighting_id: str) -> Response:
    st = path.stat()
    etag = f'"{sighting_id}-{st.st_mtime_ns:x}-{st.st_size:x}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, **BINARY_HEADERS})
    return FileResponse(path, media_type=media_type, headers={"ETag": etag, **BINARY_HEADERS})


def _route(kind: str):
    suffix, media_type = KINDS[kind]

    def get_binary(
        assetModelId: str,  # noqa: N803
        sightingId: str,  # noqa: N803
        request: Request,
        handle: ProjectHandle = Depends(get_project),
    ) -> Response:
        return _binary(request, _patch_file(handle, assetModelId, sightingId, suffix), media_type, sightingId)

    get_binary.__name__ = f"get_placement_{kind}"
    return get_binary


for _kind in KINDS:
    router.add_api_route(
        P + "/{sightingId}/" + _kind, _route(_kind), methods=["GET"], response_class=Response
    )


@router.post(P + "/compute", response_model=JobRef, status_code=202)
def compute_placements(
    assetModelId: str,  # noqa: N803
    request: Request,
    body: ComputePlacementsIn | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    only_dirty = bool(body.only_dirty) if body is not None else False
    job = jobs_place.submit(handle, request.app.state.jobs, assetModelId, only_dirty)  # 409 job_running
    return JobRef(job=JobOut.from_row(job, handle.id))
```

- [ ] **Step 4: Remove the stubs and route the module**

1. In `backend/app/asset_review/stubs.py`, delete the five tuples whose operationIds are `listPlacements`, `getPlacementMesh`, `getPlacementTexture`, `getPlacementLabels` and `computePlacements`. If C0 grouped them in a `J3_STUBS` list, leave the list empty with its comment, as `app/workspace/stubs.py` does.
2. `tests/test_contract.py` derives `EXPECTED_STUBS` from `stubs.py`, so normally nothing changes there. If it names any of the five by hand, or lists them in `BACKEND_PENDING`, delete those entries.
3. In `backend/app/api.py`, in the guarded `for _module in (...)` tuple that loads `"app.asset_models.router"`, add this line next to J1's `"app.asset_review.routes_glb"` and above C0's `"app.asset_review.stubs"` entry:

   ```python
       "app.asset_review.routes_placements",  # asset findings J3: placements and asset_place
   ```

Check that nothing is left:

```powershell
Select-String -Path app/asset_review/stubs.py -Pattern "Placement"
```

Expected: no output.

- [ ] **Step 5: Run the tests to see them pass**

```powershell
& $PY -m pytest tests/test_asset_placements_api.py tests/test_contract.py tests/test_packaging_spec.py -q
& $PY -m pytest -m perf tests/test_asset_place_perf.py -q
```

Expected:
- First command: every test passes. `test_contract.py` passes because the five operations are now routed for real and conform to the contract. `test_packaging_spec.py` passes because the new module is found by `collect_submodules("app")`.
- Second command: `2 passed`. Record both elapsed times in the task ledger. While planning they were about 1.5 s and 30 s.

- [ ] **Step 6: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review app/api.py tests/test_asset_placements_api.py tests/test_asset_place_perf.py tests/test_contract.py
& $PY -m ruff format --check app/asset_review app/api.py tests/test_asset_placements_api.py tests/test_asset_place_perf.py tests/test_contract.py
git add backend/app/asset_review/placement_schemas.py backend/app/asset_review/routes_placements.py backend/app/asset_review/stubs.py backend/app/api.py backend/tests/test_asset_placements_api.py backend/tests/test_asset_place_perf.py
git add backend/tests/test_contract.py  # only if Step 4 changed it
git commit -m "feat(asset-review): placements API with paged index, ETag binaries and compute (J3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Gate and land

**Files:** none new.

- [ ] **Step 1: Rebase onto `main`** (J1, J2, J4 and P1 must be there):

```powershell
git fetch; git rebase main
```

- [ ] **Step 2: Run the full gate** (AGENTS.md):

```powershell
pnpm -C contract check
cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. J3 touches no frontend file, but the gate runs whole. `cargo test` runs only when `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists; it is skipped, not failed, otherwise. J3 adds no package and changes no packaging, so `build.ps1` and `smoke_frozen.ps1` are not required.

- [ ] **Step 3: Land.** Merge `task/af-j3` into `main` by hand (memory note: `finish-task.ps1` fails on PS 5.1). Run the gate on `main`, remove the worktree with the junction-safe procedure, and delete the branch.

- [ ] **Step 4: Operator note.** This change is not user-observable until U2 adds the Compute button. To try it now, POST `/api/v1/projects/<id>/asset-models/<modelId>/placements/compute` on a project with posed photos and asset sightings. Then GET `/placements`, which lists the pins and patches of the current version.

---

## Index notes

1. **No `rtree` and no embree (coordinator ruling).** `rtree` is not installed, so `trimesh`'s `mesh.ray.intersects_id` raises `ModuleNotFoundError`. The index Tech Stack line "trimesh (rtree; embree when present) ... (all present)" is therefore wrong. J3 casts with `app.asset_review.raycast.first_hits`, a numpy Moller-Trumbore with an exact projection-and-tile cull. While planning it matched embree on 368,640 tower rays with no mismatch. Task 1 also points P1's fixture `_first_hit` at it, so the repo has one caster.
2. **`place_sighting` gains a keyword `frame: Frame`.** The index signature lacks it, but the lift toward the camera needs `frame.height_m` and `derive` needs the frame. The full signature is `place_sighting(mesh, face_node, pose, shape, image_size, review, photo, colour, *, frame) -> Placement`. Component names come from `mesh.metadata["node_names"]` (J1) through P1's `derive.component_name`, so no node-name argument is needed. `Placement` also carries `derived` (P1's `Derived`) for J5 and for tests.
3. **`SightingShape` and `PatchData`** are defined here (the index named `SightingShape` without fields): `SightingShape(x, y, w, h, angle, kind, points)` and `SightingShape.from_box(box)`.
4. **Photos are read through `app.datasets.images.image_file(handle, image_id, 2048)`.** That is where the preview helper lives; it is not in `app.imagery`. It caches a 2,048 px JPEG under `cache/resized/`.
5. **Grouping hand-off** uses J4's `app.asset_review.jobs_group.submit_group(handle, runner, asset_model_id)`. A 409 (a grouping already live) is logged and returned as `group_job_id: null`; it does not fail the placement job. J3 writes no finding column (J4 N3).
6. **`Placement` contract shape assumed from C0:** `{sighting_id, finding_id: string | null, kind: point | patch, center: number[3], normal: number[3], size: number[2] | null, severity: int | null, patch_url: string | null}` and `PlacementList {version: int | null, items, next: string | null}`. `finding_id` is nullable because J4 N1 makes sightings ungrouped until `asset_group` runs. If C0's schema differs, conform `placement_schemas.py` to C0; the contract is the truth.
7. **NDC uses continuous pixels** (`px / W * 2 - 1`), where the kit used pixel indices (`(px + 0.5) / W`). Kestrel boxes are continuous coordinates, and the 0.5 px shift is far below the recompute acceptance bands.
8. **A patch with no surviving quad is `none`,** as in the kit, even though its pin grid hit. This keeps J5's recompute counts comparable with the kit's replay.
9. **Patch file format is U1's**, with no magic bytes: `.bin` = uint32 n, then n x 3 float32 positions, then n x 2 float32 uvs; `.lbl` = uint16 w, uint16 h, then w x h uint8 with row 0 at the top. Task 3 defines and tests exactly that.
10. **Job result keys:** the result carries `placed` and `unplaced`, which U2's toasts read, plus `point`, `patch`, `none`, `no_pose`, `version` and `group_job_id`.
11. **No cached acceleration structure.** The coordinator asked for one cached next to J1's mesh, keyed by the GLB sha256. J3's cull depends on the camera: each call projects the vertices from its own origin. A per-mesh structure would therefore add nothing to it. The arrays it reads (`mesh.vertices` float64, `mesh.faces` int64) are J1's cached mesh's own, converted without a copy. That keeps one mesh per process, as J1 holds it. If a later profile shows the O(V + F) projection dominating (EBSM: about 0.14 s a call), the next step is a per-mesh BVH of face bounds stored in `mesh.metadata["raycast"]`. It would live and die with J1's cache entry, so it shares the sha256 key without a second cache.

## Spec gaps found while planning

- **§12 "every truth finding within 0.25 m of its truth point".** A truth point is the centre of the defect's geometry. A pin lands on the visible surface, up to the defect's radius away: 0.38 to 0.49 m for the 0.4 m nest. Per sighting, the bound cannot hold. Per finding, the component-wise median of its pins holds with margin (0.177 m worst). Task 4 asserts it per finding, with 0.2 m annotation boxes, and also checks side and zone. X's end-to-end step uses grouped findings, whose anchor is the representative sighting. If X also wants 0.25 m there, the representative rule (J4) should prefer the sighting nearest the group's median rather than the largest coverage.
- **§5.6 gives `finding_sighting` no size column.** The placement index's `size` (and `direction`, `crop`) therefore live in `index.json`, which is derived and safe to delete. When it is deleted, `size` reads null until the next run.

## Self-review

- **Spec coverage for J3:**
  - §6.3 rays and pinhole: `camera_rays`;
  - first-hit casting: `raycast`;
  - point placement (5 x 5 central half, median, normal flipped): `_pin`;
  - patch grid, quads, 4 x median edge drop, H x 0.00025 lift, UVs to the crop: `_patch`;
  - polygon texture in the severity colour over the photo, tinted bordered box: `patch_texture`;
  - mixed rule: `wants_patch`; none on a miss: `place_sighting`;
  - part through `component_map` or the tidied node name: `_common`; height, bearing, side and zone: `derive`;
  - bounded: 2,048 px photo, one at a time, mesh once, 64-row chunks;
  - §5.7 files (`.bin`, `.png` at most 512, `.lbl` at most 128, `index.json`, rebuilt and pruned);
  - §8 list (keyset, version, at most 2,000), three binaries with ETag, compute (202, 409);
  - §11 budget: perf tests and a DAMAC estimate; §12 tower accuracy.
- **Review Focus:** `test_ray_miss_is_none_not_error` is in Task 2 (`tests/test_asset_place.py`). Its job-level twin, `test_job_ray_miss_marks_none_and_succeeds`, is in Task 5.
- **Stubs:** Task 6 removes J3's five.
- **Gate:** Task 7 runs the full AGENTS.md gate.
- **Placeholders and naming:** no TBD or TODO. Every name used is defined in this plan or cited from P1, J1, J2 or J4's plans with their exact signatures.
