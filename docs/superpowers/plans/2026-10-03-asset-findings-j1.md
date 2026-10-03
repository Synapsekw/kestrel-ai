# Asset findings J1: GLB import job, frame conversions, silhouette, PATCH frame and review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An existing GLB (the DAMAC facade, the EBSM stack, the synthetic tower) becomes an `imported` asset model version in the canonical asset frame. The import computes its part list, height and radial silhouette, and fills `asset_model.frame`. The operator can then edit the frame and pick a review profile through `PATCH /asset-models/{id}`. J3 gets one cached mesh per version with a per-face node index.

**Architecture:**
- **`app/asset_review/glb.py`** reads the GLB container through its header and JSON chunk only. It parses node names, extras and accessor bounds, and writes the stored copy: a new header, a normalised JSON chunk, then the source's remaining bytes streamed through unchanged. The BIN chunk is never decoded.
- **Frame conversion is baked once, on import, as a root node matrix.** When the operator picks a conversion other than `none`, the normalised JSON gains one root node, `kestrel_frame`, whose `matrix` is the conversion. The default scene's old roots become its children. Every reader then sees canonical coordinates: three.js, trimesh and the rasterizer, with no per-reader transform. The vertex data is untouched, so this costs one JSON rewrite and one streamed copy. After import the stored `v<n>.glb` is never rewritten, as spec §5.2 requires. The normalised JSON also gives every mesh node a unique, non-reserved name, so trimesh's node names map back to glTF node indices.
- **`app/asset_review/frame_io.py`** holds:
  - `CONVERSIONS` (4x4);
  - `silhouette_from_mesh` (kit `records.py` `mesh_info`);
  - the rules for how an import and a `PATCH` change `frame` and `review`.
- **`app/asset_review/meshes.py`** turns a GLB into one concatenated `trimesh.Trimesh` with a per-face glTF node index. `load_version_mesh` caches exactly one mesh per process, keyed by the GLB's sha256.
- **`app/asset_review/glb_import.py`** holds the `asset_glb_import` job and `start_import`, which inserts the `imported` version row and queues the job. `routes_glb.py` routes `POST /asset-models/{assetModelId}/versions/import-glb`.
- **`app/asset_models/router.py`** changes in two places:
  - `PATCH` gains `frame` and `review`.
  - `restore` of an `imported` version re-imports its stored GLB, instead of building an empty spec.

**Tech Stack:** FastAPI, SQLAlchemy, pydantic v2, trimesh 4.12 (present), numpy, pytest.

**Spec sections covered:** §4 A7; §5.1 (`frame`, `review` defaults from the GLB); §5.2 (`kind = imported`, `meta`); §6.1 (`asset_glb_import`); §8 (`POST .../versions/import-glb`, `PATCH /asset-models/{id}` `frame` and `review`); §11 budget for this job; §12 "Frame conversion: a golden test per converter".

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs (merged to `main` first):**
- **C0:** the contract, the `importAssetModelGlb` stub in `backend/app/asset_review/stubs.py`, and `AssetModel.frame` / `review` in the contract.
- **D1:** the `asset_model.frame` and `asset_model.review` columns.
- **P1:** `app.asset_review.frame.Frame` and `Origin`, `app.asset_review.profiles.PROFILES` and `resolve`, and `backend/tests/fixtures/synthetic_tower.py`.

The index DAG lists only D1. P1 sits in the same batch as D1, so it is merged before batch 3 starts.

**Worktree:** `scripts\start-task.ps1 -Name af-j1`

**Budget:**
- **Background job:** `asset_glb_import`. It does the copy, the hash, the trimesh load check and the silhouette.
- **The route only:**
  - checks that the file exists;
  - checks that it is at most 2 GB;
  - reads its first 20 bytes.
- **Bounded reads:**
  - the JSON chunk, at most 64 MB;
  - the BIN chunk streamed in 1 MiB pieces and never decoded;
  - one mesh loaded by trimesh with materials skipped;
  - one mesh held per process by `load_version_mesh`.

**Execution DAG:**
- Task 1 (`frame_io`) and Task 2 (`glb`) are independent and can run in parallel.
- Task 3 (`meshes`) needs Task 2.
- Task 4 (`PATCH` frame and review) needs Task 1 only, so it can run in parallel with Tasks 2 and 3.
- Task 5 (job and route) needs Tasks 1 to 4.
- Task 6 is the gate.
- **Critical path:** Task 2, then Task 3, Task 5 and Task 6.

`$PY` below is `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`. Every backend command runs from `backend/` in the worktree.

---

### Task 1: `frame_io`: conversions, silhouette, frame and review rules

**Files:**
- Create: `backend/app/asset_review/frame_io.py`
- Test: `backend/tests/test_asset_review_frame_io.py`

**Interfaces:**
- Consumes (P1): `app.asset_review.frame.Frame`, `Origin`; `app.asset_review.profiles.PROFILES: dict[str, Profile]`, `resolve(profile_id: str, height_m: float, overrides: dict | None = None) -> ReviewConfig`.
- Produces:
  - `CONVERSIONS: dict[str, np.ndarray]`, 4x4, row-major, applied to column vectors. Keys are `none`, `x_east_minus_z_north` and `enu_z_up`, the values of C0's `AssetFrameConversion` enum.
  - `matrix_of(conversion: str) -> np.ndarray | None`: None for `none`; KeyError for an unknown key.
  - `silhouette_from_mesh(mesh: trimesh.Trimesh, bins: int = 160) -> list[tuple[float, float]]`: `[(y, r)]` rounded to 3 decimals.
  - `frame_after_import(old: dict | None, prev_meta: dict | None, height_m: float, silhouette: list[tuple[float, float]], origin: dict | None) -> dict`
  - `rescale_review(review: dict, old_h: float, new_h: float) -> dict`
  - `resolve_review(raw: dict | None, frame: dict | None) -> dict | None`: raises `AppError` 422 `unknown_profile`, `frame_required` or `invalid_review`.
  - `apply_patch(row: AssetModel, fields: dict) -> None`: `fields` holds only the `frame` and `review` keys that the PATCH body set.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_review_frame_io.py
"""Frame conversions, the kit silhouette, and how imports and PATCH change frame/review (spec §5.1, §5.2, §6.1)."""

import math

import numpy as np
import pytest
import trimesh

from app.asset_review import frame_io
from app.asset_review.frame import Frame
from app.errors import AppError

FRAME = {
    "origin": {"lat": 24.4539, "lon": 54.3773, "ground_alt_m": 5.0},
    "north_offset_deg": 0.0,
    "height_m": 42.0,
    "datum_label": "Ground",
    "datum_note": "",
    "line_azimuth_deg": None,
    "silhouette": [[0.0, 3.0], [42.0, 0.9]],
    "levels": [30.0, 36.0],
    "presets": [],
}


def _rings(rows):
    """A vertex-only mesh: rings of 8 points at (y, r) for each row."""
    v = []
    for y, r in rows:
        for k in range(8):
            t = k * math.pi / 4
            v.append([r * math.cos(t), y, r * math.sin(t)])
    return trimesh.Trimesh(vertices=np.array(v), faces=[[0, 1, 2]], process=False)


# ----- conversions: one golden test per converter (spec §12)


def test_conversion_none_is_identity():
    assert np.array_equal(frame_io.CONVERSIONS["none"], np.eye(4))
    assert frame_io.matrix_of("none") is None


def test_x_east_minus_z_north_golden():
    m = frame_io.CONVERSIONS["x_east_minus_z_north"]
    # KIPIC (x = east, y = up, z = -north) -> canonical (X north, Y up, Z east)
    assert (m @ [1, 2, 3, 1]).tolist() == [-3, 2, 1, 1]
    assert (m @ [0, 0, -1, 1]).tolist() == [1, 0, 0, 1]  # one metre north
    assert (m @ [1, 0, 0, 1]).tolist() == [0, 0, 1, 1]  # one metre east
    assert (m @ [0, 1, 0, 1]).tolist() == [0, 1, 0, 1]  # up stays up
    assert frame_io.matrix_of("x_east_minus_z_north") is m


@pytest.mark.parametrize("key", sorted(frame_io.CONVERSIONS))
def test_conversions_are_proper_rotations(key):
    r = frame_io.CONVERSIONS[key][:3, :3]
    assert np.allclose(r @ r.T, np.eye(3))
    assert np.linalg.det(r) == pytest.approx(1.0)


def test_enu_z_up_golden():
    m = frame_io.CONVERSIONS["enu_z_up"]
    # ENU (x = east, y = north, z = up) -> canonical (X north, Y up, Z east)
    assert (m @ [1, 2, 3, 1]).tolist() == [2, 3, 1, 1]
    assert (m @ [0, 1, 0, 1]).tolist() == [1, 0, 0, 1]  # one metre north
    assert (m @ [1, 0, 0, 1]).tolist() == [0, 0, 1, 1]  # one metre east
    assert (m @ [0, 0, 1, 1]).tolist() == [0, 1, 0, 1]  # up


def test_unknown_conversion_is_a_key_error():
    with pytest.raises(KeyError):
        frame_io.matrix_of("z_up")


# ----- silhouette (kit records.py mesh_info)


def test_silhouette_step_golden():
    # one ring per bin centre over [0, 10]: r = 1 below 5 m and 3 above, plus rings at y = 0 and 10 so
    # the bin edges are exactly linspace(0, 10, 161) and each ring sits in its own bin
    rows = [((b + 0.5) * 10 / 160, 1.0 if b < 80 else 3.0) for b in range(160)] + [(0.0, 1.0), (10.0, 3.0)]
    s = frame_io.silhouette_from_mesh(_rings(rows))
    assert len(s) == 160
    assert s[0] == (pytest.approx(0.031, abs=1e-3), 1.0)
    assert s[-1] == (pytest.approx(9.969, abs=1e-3), 3.0)
    # the 5-bin moving average with edge padding: (1*4+3)/5, (1*3+3*2)/5, (1*2+3*3)/5, (1+3*4)/5
    assert [r for _, r in s[77:83]] == [1.0, 1.4, 1.8, 2.2, 2.6, 3.0]
    assert s[80][0] == pytest.approx(5.031, abs=1e-3)


def test_silhouette_92nd_percentile_and_no_smoothing_under_six_bins():
    # bin 0 holds radii 1..100 at angle 0; np.percentile(range(1, 101), 92) = 92.08
    v = [[float(r), 0.0, 0.0] for r in range(1, 101)] + [[1.0, 10.0, 0.0]]
    mesh = trimesh.Trimesh(vertices=np.array(v), faces=[[0, 1, 2]], process=False)
    s = frame_io.silhouette_from_mesh(mesh)
    assert s == [(pytest.approx(0.031, abs=1e-3), 92.08), (pytest.approx(9.969, abs=1e-3), 1.0)]


def test_silhouette_starts_at_zero_when_the_mesh_floats_above_ground():
    s = frame_io.silhouette_from_mesh(_rings([(4.01, 2.0), (8.0, 2.0)]))
    # edges run from min(0, y0) = 0 to 8 in 0.05 m bins, so the first ring lands in bin 80 (centre 4.025)
    assert s[0][0] == pytest.approx(4.025, abs=1e-3) and s[-1][0] == pytest.approx(7.975, abs=1e-3)


# ----- frame after import


def test_first_import_creates_the_frame_from_the_glb():
    f = frame_io.frame_after_import(None, None, 42.05, [(0.031, 3.0), (41.9, 0.9)], None)
    frame = Frame.model_validate(f)
    assert frame.origin is None and frame.height_m == 42.05 and frame.north_offset_deg == 0.0
    assert [list(p) for p in frame.silhouette] == [[0.031, 3.0], [41.9, 0.9]]
    assert frame.levels == [] and frame.presets == []


def test_import_with_origin_sets_it():
    origin = {"lat": 1.5, "lon": 2.5, "ground_alt_m": 3.0}
    f = frame_io.frame_after_import(None, None, 10.0, [(0.0, 1.0)], origin)
    assert f["origin"]["lat"] == 1.5 and f["origin"]["ground_alt_m"] == 3.0
    kept = frame_io.frame_after_import(FRAME, None, 10.0, [(0.0, 1.0)], origin)
    assert kept["origin"]["lon"] == 54.3773 and kept["height_m"] == 42.0  # the operator's origin and height
    filled = frame_io.frame_after_import({**FRAME, "origin": None}, None, 10.0, [(0.0, 1.0)], origin)
    assert filled["origin"]["lon"] == 2.5


def test_reimport_replaces_an_untouched_silhouette_and_height():
    prev = {"height_m": 42.0, "silhouette": [[0.0, 3.0], [42.0, 0.9]]}
    f = frame_io.frame_after_import(FRAME, prev, 84.0, [(0.0, 6.0), (84.0, 1.8)], None)
    assert f["height_m"] == 84.0 and f["silhouette"] == [[0.0, 6.0], [84.0, 1.8]]
    assert f["levels"] == [30.0, 36.0]  # every other field is the operator's


def test_reimport_keeps_an_edited_frame():
    prev = {"height_m": 40.0, "silhouette": [[0.0, 3.0], [40.0, 0.9]]}  # the operator changed both since
    f = frame_io.frame_after_import(FRAME, prev, 84.0, [(0.0, 6.0)], None)
    assert f["height_m"] == 42.0 and f["silhouette"] == [[0.0, 3.0], [42.0, 0.9]]


def test_reimport_fills_an_empty_silhouette():
    f = frame_io.frame_after_import({**FRAME, "silhouette": []}, None, 50.0, [(0.0, 2.0)], None)
    assert f["silhouette"] == [[0.0, 2.0]] and f["height_m"] == 50.0


# ----- review rescale and resolve


def test_rescale_review_scales_zones_and_a_default_cluster():
    review = {
        "profile_id": "telecom_tower",
        "cluster_m": max(0.75, 0.02 * 42.0),
        "zones": [
            {"id": "antenna", "label": "Antenna zone", "min_m": 33.6, "max_m": 1e9},
            {"id": "body", "label": "Tower body", "min_m": 4.2, "max_m": 33.6},
            {"id": "base", "label": "Base", "min_m": -1e9, "max_m": 4.2},
        ],
    }
    out = frame_io.rescale_review(review, 42.0, 84.0)
    assert [(z["min_m"], z["max_m"]) for z in out["zones"]] == [(67.2, 1e9), (8.4, 67.2), (-1e9, 8.4)]
    assert out["cluster_m"] == pytest.approx(1.68)
    assert review["zones"][1]["min_m"] == 4.2  # the input is not mutated
    edited = frame_io.rescale_review({**review, "cluster_m": 2.5}, 42.0, 84.0)
    assert edited["cluster_m"] == 2.5  # an operator's cluster distance is kept


def test_resolve_review_needs_a_known_profile_and_a_frame():
    with pytest.raises(AppError) as e:
        frame_io.resolve_review({"profile_id": "no_such"}, FRAME)
    assert e.value.code == "unknown_profile" and e.value.status == 422
    with pytest.raises(AppError) as e:
        frame_io.resolve_review({"profile_id": ["stack"]}, FRAME)
    assert e.value.code == "unknown_profile"
    with pytest.raises(AppError) as e:
        frame_io.resolve_review({"profile_id": "stack"}, None)
    assert e.value.code == "frame_required"
    assert frame_io.resolve_review(None, FRAME) is None


def test_resolve_review_uses_the_frame_height():
    out = frame_io.resolve_review({"profile_id": "telecom_tower"}, FRAME)
    assert out["profile_id"] == "telecom_tower"
    body = next(z for z in out["zones"] if z["id"] == "body")
    assert body["min_m"] == pytest.approx(4.2) and body["max_m"] == pytest.approx(33.6)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_frame_io.py -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.asset_review.frame_io'`

- [ ] **Step 3: Implement `frame_io.py`**

```python
# backend/app/asset_review/frame_io.py
"""The asset frame on import and on edit (spec 2026-10-02-asset-findings §4 A7, §5.1, §5.2).

- `CONVERSIONS`: source frame -> canonical frame (metres, Y up, X plant north, Z plant east), 4x4,
  row-major, applied to column vectors. `asset_glb_import` bakes the chosen one into the stored GLB
  as a root node matrix, once.
- `silhouette_from_mesh`: the kit's `records.py` `mesh_info` (92nd percentile of vertex radius in
  160 height bins, smoothed over 5), number for number.
- `frame_after_import`, `rescale_review`, `resolve_review`, `apply_patch`: how an import and
  `PATCH /asset-models/{id}` change `asset_model.frame` and `asset_model.review`.
"""

from __future__ import annotations

import copy
from typing import Any

import numpy as np
import trimesh
from pydantic import ValidationError

from app.asset_review.frame import Frame, Origin
from app.asset_review.profiles import PROFILES, resolve
from app.errors import AppError

SILHOUETTE_BINS = 160
SILHOUETTE_PERCENTILE = 92
SILHOUETTE_SMOOTH = 5
OPEN_BOUND_M = 1e8  # a zone bound beyond this is an open end (the kit writes 1e9); never rescaled
DEFAULT_DATUM_LABEL = "Ground"

CONVERSIONS: dict[str, np.ndarray] = {
    # Already canonical.
    "none": np.eye(4),
    # KIPIC and three.js scenes: x = east, y = up, z = -north. Canonical X (north) = -z, Y = y,
    # Z (east) = x.
    "x_east_minus_z_north": np.array(
        [
            [0.0, 0.0, -1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    ),
    # Z-up ENU exports (most photogrammetry): x = east, y = north, z = up. Canonical X (north) = y,
    # Y (up) = z, Z (east) = x.
    "enu_z_up": np.array(
        [
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    ),
}


def matrix_of(conversion: str) -> np.ndarray | None:
    """The root matrix to bake for `conversion`; None when the GLB is already canonical."""
    m = CONVERSIONS[conversion]  # KeyError for an unknown key
    return None if conversion == "none" else m


def silhouette_from_mesh(mesh: trimesh.Trimesh, bins: int = SILHOUETTE_BINS) -> list[tuple[float, float]]:
    """[(y, r)] from the canonical-frame vertices: the kit's `mesh_info`, number for number."""
    v = np.asarray(mesh.vertices, dtype=float)
    if len(v) == 0:
        return []
    y0, y1 = float(v[:, 1].min()), float(v[:, 1].max())
    r = np.hypot(v[:, 0], v[:, 2])
    edges = np.linspace(min(0.0, y0), y1, bins + 1)
    idx = np.clip(np.digitize(v[:, 1], edges) - 1, 0, bins - 1)
    ys: list[float] = []
    rs: list[float] = []
    for b in range(bins):
        rb = r[idx == b]
        if len(rb):
            ys.append(float((edges[b] + edges[b + 1]) / 2))
            rs.append(float(np.percentile(rb, SILHOUETTE_PERCENTILE)))
    smooth = np.array(rs)
    if len(smooth) > SILHOUETTE_SMOOTH:
        half = SILHOUETTE_SMOOTH // 2
        kernel = np.ones(SILHOUETTE_SMOOTH) / SILHOUETTE_SMOOTH
        smooth = np.convolve(np.pad(smooth, half, mode="edge"), kernel, mode="valid")
    return [(round(y, 3), round(float(x), 3)) for y, x in zip(ys, smooth, strict=True)]


def _pairs(silhouette) -> list[list[float]]:
    return [[float(y), float(r)] for y, r in silhouette]


def frame_after_import(
    old: dict | None,
    prev_meta: dict | None,
    height_m: float,
    silhouette: list[tuple[float, float]],
    origin: dict | None,
) -> dict:
    """The model's frame after a GLB import.

    - No frame yet: one from the GLB (height, silhouette), north offset 0, no levels or presets.
    - A frame whose height and silhouette are still the previous import's (`prev_meta`), or whose
      silhouette is empty: those two follow the new GLB. Anything the operator edited stays.
    - `origin`, when the import names one, fills the frame's origin if it has none; an origin the
      operator or a kit import set is kept (C0: "sets `frame.origin` when the model has no frame yet").
    """
    if old is None:
        frame = Frame(
            origin=Origin.model_validate(origin) if origin else None,
            north_offset_deg=0.0,
            height_m=height_m,
            datum_label=DEFAULT_DATUM_LABEL,
            datum_note="",
            line_azimuth_deg=None,
            silhouette=[tuple(p) for p in _pairs(silhouette)],
            levels=[],
            presets=[],
        )
        return frame.model_dump(mode="json")
    frame = Frame.model_validate(old)
    current = _pairs(frame.silhouette)
    untouched = not current or (
        prev_meta is not None
        and prev_meta.get("silhouette") == current
        and prev_meta.get("height_m") == frame.height_m
    )
    update: dict[str, Any] = {}
    if untouched:
        update["height_m"] = height_m
        update["silhouette"] = [tuple(p) for p in _pairs(silhouette)]
    if origin and frame.origin is None:
        update["origin"] = Origin.model_validate(origin)
    return Frame.model_validate({**frame.model_dump(), **update}).model_dump(mode="json")


def rescale_review(review: dict, old_h: float, new_h: float) -> dict:
    """Zones in metres follow a height change proportionally; a cluster distance still at the
    default max(0.75, 0.02 * H) follows too. Open-ended bounds and operator values are kept."""
    out = copy.deepcopy(review)
    if not old_h or old_h <= 0 or new_h <= 0:
        return out
    k = new_h / old_h
    for zone in out.get("zones") or []:
        for key in ("min_m", "max_m"):
            v = zone.get(key)
            if isinstance(v, int | float) and abs(v) < OPEN_BOUND_M:
                zone[key] = round(v * k, 3)
    c = out.get("cluster_m")
    if isinstance(c, int | float) and abs(c - max(0.75, 0.02 * old_h)) < 1e-9:
        out["cluster_m"] = max(0.75, 0.02 * new_h)
    return out


def resolve_review(raw: dict | None, frame: dict | None) -> dict | None:
    """A PATCH `review` (a profile id, or an edited copy that also names its profile) resolved
    against the frame's height into the stored review config."""
    if raw is None:
        return None
    pid = raw.get("profile_id")
    if not isinstance(pid, str) or pid not in PROFILES:
        raise AppError("unknown_profile", f"There is no review profile {pid!r}.", 422)
    if not frame:
        raise AppError(
            "frame_required", "Set the asset frame (at least its height) before choosing a review profile.", 422
        )
    overrides = {k: v for k, v in raw.items() if k != "profile_id"} or None
    try:
        return resolve(pid, float(frame["height_m"]), overrides).model_dump(mode="json")
    except (ValidationError, ValueError, TypeError) as e:
        n = len(e.errors()) if isinstance(e, ValidationError) else 1
        raise AppError("invalid_review", "The review settings are not valid.", 422, {"error_count": n}) from None


def apply_patch(row, fields: dict) -> None:
    """Apply the `frame` and `review` keys a PATCH body set. A height change with no new review
    rescales the stored review's zones."""
    old_h = float(row.frame["height_m"]) if row.frame else None
    if "frame" in fields:
        raw = fields["frame"]
        row.frame = None if raw is None else Frame.model_validate(raw).model_dump(mode="json")
    if "review" in fields:
        row.review = resolve_review(fields["review"], row.frame)
    elif row.review and row.frame and old_h and float(row.frame["height_m"]) != old_h:
        row.review = rescale_review(row.review, old_h, float(row.frame["height_m"]))
```

- [ ] **Step 4: Run them to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_frame_io.py -q`
Expected: PASS (18 passed)

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_review/frame_io.py backend/tests/test_asset_review_frame_io.py
git commit -m "feat(asset-review): frame conversions, kit silhouette, frame and review rules (J1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `glb`: JSON-chunk parser and normalised copy

**Files:**
- Create: `backend/app/asset_review/glb.py`
- Test: `backend/tests/test_asset_review_glb.py`

**Interfaces:**
- Consumes: nothing new. The test uses `app.asset_models.build.inject_node_extras` (existing) and `fixtures.synthetic_tower.make_tower` (P1).
- Produces:
  - `GlbError(ValueError)`, whose message is written for the operator.
  - `GlbPart(node: int, name: str, group: str, extras: dict)`
  - `GlbInfo(doc: dict, json_length: int, total_length: int, parts: list[GlbPart], bounds: tuple[list[float], list[float]] | None)`
  - `read_header(f: BinaryIO) -> tuple[int, int]`, which returns `(total_length, json_length)`.
  - `parse(path: Path) -> GlbInfo`
  - `normalise(doc: dict, matrix: np.ndarray | None) -> dict`
  - `write_normalised(src: Path, dest: Path, info: GlbInfo, matrix: np.ndarray | None, *, on_chunk: Callable[[int, int], None] | None = None) -> tuple[str, str, int]`, which returns `(source_sha256, stored_sha256, stored_bytes)`.
  - Constants: `COPY_CHUNK = 1 MiB`, `MAX_JSON_BYTES = 64 MiB`, `FRAME_NODE_NAME = "kestrel_frame"`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_review_glb.py
"""The GLB container through its JSON chunk only (spec §6.1 steps 1 and 2)."""

import hashlib
import json
import struct

import numpy as np
import pytest
import trimesh
from fixtures.synthetic_tower import make_tower

from app.asset_models.build import inject_node_extras
from app.asset_review import frame_io, glb


def _glb(doc: dict, bin_bytes: bytes = b"") -> bytes:
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    out = struct.pack("<I4s", len(body), b"JSON") + body
    if bin_bytes:
        out += struct.pack("<I4s", len(bin_bytes), b"BIN\x00") + bin_bytes
    return struct.pack("<4sII", b"glTF", 2, 12 + len(out)) + out


def _scene_glb(tmp_path, names=("Leg_000", "Leg_001", "Platform_002")):
    sc = trimesh.Scene()
    for i, name in enumerate(names):
        box = trimesh.creation.box(extents=[1, 1, 1])
        box.apply_translation([i * 2.0, 0.5, 0])
        sc.add_geometry(box, node_name=name, geom_name=f"g{i}")
    data = inject_node_extras(sc.export(file_type="glb"), {"Platform_002": {"group": "Deck", "tag": "P-1"}})
    path = tmp_path / "parts.glb"
    path.write_bytes(data)
    return path


def test_parse_reads_names_groups_and_extras(tmp_path):
    info = glb.parse(_scene_glb(tmp_path))
    by_name = {p.name: p for p in info.parts}
    assert set(by_name) == {"Leg_000", "Leg_001", "Platform_002"}
    assert by_name["Leg_000"].group == "Leg" and by_name["Leg_001"].group == "Leg"
    assert by_name["Platform_002"].group == "Deck" and by_name["Platform_002"].extras["tag"] == "P-1"
    assert all(info.doc["nodes"][p.node]["name"] == p.name for p in info.parts)


def test_parse_bounds_match_trimesh_on_the_tower(tmp_path):
    tower = make_tower(tmp_path, photos=False)
    info = glb.parse(tower.glb_path)
    lo, hi = trimesh.load(str(tower.glb_path), force="scene").bounds
    assert np.allclose(info.bounds[0], lo, atol=1e-3) and np.allclose(info.bounds[1], hi, atol=1e-3)
    assert len(info.parts) > 50 and {"Leg", "Antenna"} <= {p.group for p in info.parts}


def test_parse_never_reads_the_bin_chunk(tmp_path):
    full = _scene_glb(tmp_path).read_bytes()
    _total, clen = struct.unpack_from("<II", full, 8)[0], struct.unpack_from("<I", full, 12)[0]
    cut = tmp_path / "cut.glb"
    cut.write_bytes(full[: 20 + clen])  # the BIN chunk is gone; the header still claims it
    assert len(glb.parse(cut).parts) == 3


@pytest.mark.parametrize(
    "data, message",
    [
        (b"not a glb at all, just text", "not a GLB"),
        (struct.pack("<4sII", b"glTF", 1, 20) + struct.pack("<I4s", 0, b"JSON"), "version 1"),
        (struct.pack("<4sII", b"glTF", 2, 20) + struct.pack("<I4s", 0, b"BIN\x00"), "not JSON"),
        (b"glTF", "too short"),
    ],
)
def test_parse_refuses_what_is_not_a_glb2(tmp_path, data, message):
    p = tmp_path / "bad.glb"
    p.write_bytes(data)
    with pytest.raises(glb.GlbError, match=message):
        glb.parse(p)


def test_parse_refuses_external_buffers_and_bad_json(tmp_path):
    p = tmp_path / "ext.glb"
    p.write_bytes(_glb({"asset": {"version": "2.0"}, "buffers": [{"uri": "mesh.bin", "byteLength": 4}]}))
    with pytest.raises(glb.GlbError, match="external buffer"):
        glb.parse(p)
    body = b"[1, 2]  "
    p.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(body)) + struct.pack("<I4s", len(body), b"JSON") + body)
    with pytest.raises(glb.GlbError, match="not a glTF document"):
        glb.parse(p)


def test_normalise_names_every_node_uniquely():
    doc = {
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "world", "children": [1, 2, 3]}, {"mesh": 0}, {"name": "A", "mesh": 1}, {"name": "A", "mesh": 2}],
    }
    out = glb.normalise(doc, None)
    assert [n["name"] for n in out["nodes"]] == ["world_0", "node_1", "A", "A_3"]
    assert out["scenes"] == [{"nodes": [0]}] and doc["nodes"][1] == {"mesh": 0}  # input untouched


def test_normalise_wraps_the_roots_in_the_frame_node():
    doc = {"scene": 0, "scenes": [{"nodes": [0, 1]}], "nodes": [{"name": "a", "mesh": 0}, {"name": "b", "mesh": 1}]}
    m = frame_io.CONVERSIONS["x_east_minus_z_north"]
    out = glb.normalise(doc, m)
    root = out["nodes"][-1]
    assert root["name"] == glb.FRAME_NODE_NAME and root["children"] == [0, 1]
    assert out["scenes"][0]["nodes"] == [2]
    assert np.allclose(np.array(root["matrix"]).reshape(4, 4).T, m)  # glTF matrices are column-major
    again = glb.normalise(out, m)  # a second wrap gets its own name
    assert again["nodes"][-1]["name"] == f"{glb.FRAME_NODE_NAME}_3"


def test_write_normalised_copies_the_bin_chunk_and_hashes_both_files(tmp_path):
    src = _scene_glb(tmp_path)
    info = glb.parse(src)
    dest = tmp_path / "stored.glb"
    calls = []
    src_sha, sha, size = glb.write_normalised(
        src, dest, info, frame_io.CONVERSIONS["x_east_minus_z_north"], on_chunk=lambda d, t: calls.append((d, t))
    )
    raw, stored = src.read_bytes(), dest.read_bytes()
    assert src_sha == hashlib.sha256(raw).hexdigest() and sha == hashlib.sha256(stored).hexdigest()
    assert size == len(stored) == struct.unpack_from("<I", stored, 8)[0]
    assert stored[-(len(raw) - 20 - info.json_length) :] == raw[20 + info.json_length :]  # BIN byte for byte
    assert calls and calls[-1][0] == calls[-1][1]
    lo, hi = trimesh.load(str(dest), force="scene").bounds
    expected = trimesh.load(str(src), force="scene")
    expected.apply_transform(frame_io.CONVERSIONS["x_east_minus_z_north"])
    assert np.allclose(lo, expected.bounds[0]) and np.allclose(hi, expected.bounds[1])


def test_write_normalised_refuses_a_short_file(tmp_path):
    full = _scene_glb(tmp_path).read_bytes()
    clen = struct.unpack_from("<I", full, 12)[0]
    cut = tmp_path / "cut.glb"
    cut.write_bytes(full[: 20 + clen + 8])
    with pytest.raises(glb.GlbError, match="ends before"):
        glb.write_normalised(cut, tmp_path / "out.glb", glb.parse(cut), None)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_glb.py -q`
Expected: FAIL at collection with `ImportError: cannot import name 'glb' from 'app.asset_review'`

- [ ] **Step 3: Implement `glb.py`**

```python
# backend/app/asset_review/glb.py
"""The GLB container, read and rewritten through its JSON chunk only (spec 2026-10-02-asset-findings §6.1).

A GLB is a 12-byte header, a JSON chunk, then usually one BIN chunk. Import reads the header and the
JSON chunk and never decodes the BIN chunk. It writes the stored copy as a new header, a normalised
JSON chunk (unique node names; optionally one root node carrying the frame conversion), then the
source's remaining bytes streamed through unchanged.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

import numpy as np

MAGIC = b"glTF"
JSON_TYPE = b"JSON"
MAX_JSON_BYTES = 64 * 1024 * 1024
COPY_CHUNK = 1024 * 1024
MAX_NODE_VISITS = 1_000_000  # a cyclic or absurd node graph stops the bounds walk, never hangs it
FRAME_NODE_NAME = "kestrel_frame"
RESERVED_NAMES = frozenset({"world"})  # trimesh names its own base frame "world"
_TRAILING_INDEX = re.compile(r"[_\-. ]*\d+$")


class GlbError(ValueError):
    """The file is not a GLB this importer can take; the message is written for the operator."""


@dataclass
class GlbPart:
    node: int
    name: str
    group: str
    extras: dict = field(default_factory=dict)


@dataclass
class GlbInfo:
    doc: dict
    json_length: int
    total_length: int
    parts: list[GlbPart]
    bounds: tuple[list[float], list[float]] | None


def _group_of(name: str, extras: dict) -> str:
    """`extras.group` when the exporter wrote one, else the node name without a trailing index
    (`Leg_012` -> `Leg`)."""
    g = extras.get("group")
    if isinstance(g, str) and g.strip():
        return g.strip()
    return _TRAILING_INDEX.sub("", name).strip() or name


def read_header(f: BinaryIO) -> tuple[int, int]:
    """(total_length, json_length), after checking the magic, the version and the first chunk."""
    head = f.read(20)
    if len(head) < 20:
        raise GlbError("The file is too short to be a GLB.")
    magic, version, total = struct.unpack_from("<4sII", head, 0)
    if magic != MAGIC:
        raise GlbError("The file is not a GLB (binary glTF).")
    if version != 2:
        raise GlbError(f"Only glTF 2.0 is supported; this file is version {version}.")
    clen, ctype = struct.unpack_from("<I4s", head, 12)
    if ctype != JSON_TYPE:
        raise GlbError("The GLB's first chunk is not JSON.")
    if clen > MAX_JSON_BYTES:
        raise GlbError("The GLB's JSON chunk is larger than 64 MB.")
    return total, clen


def _node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T  # column-major in glTF
    x, y, z, w = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    rot = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    m = np.eye(4)
    m[:3, :3] = rot * np.array(node.get("scale", [1.0, 1.0, 1.0]), dtype=float)
    m[:3, 3] = node.get("translation", [0.0, 0.0, 0.0])
    return m


def _bounds(doc: dict) -> tuple[list[float], list[float]] | None:
    """World AABB of the default scene from the POSITION accessors' min/max (required by glTF)."""
    nodes, meshes, accessors = doc.get("nodes", []), doc.get("meshes", []), doc.get("accessors", [])
    scenes = doc.get("scenes") or []
    si = doc.get("scene", 0)
    roots = scenes[si].get("nodes", []) if isinstance(si, int) and 0 <= si < len(scenes) else []
    lo, hi = np.full(3, math.inf), np.full(3, -math.inf)
    stack = [(i, np.eye(4)) for i in roots]
    visits = 0
    while stack and visits < MAX_NODE_VISITS:
        i, parent = stack.pop()
        visits += 1
        if not (isinstance(i, int) and 0 <= i < len(nodes)) or not isinstance(nodes[i], dict):
            continue
        node = nodes[i]
        world = parent @ _node_matrix(node)
        mi = node.get("mesh")
        if isinstance(mi, int) and 0 <= mi < len(meshes):
            for prim in meshes[mi].get("primitives", []):
                ai = prim.get("attributes", {}).get("POSITION")
                acc = accessors[ai] if isinstance(ai, int) and 0 <= ai < len(accessors) else None
                if not acc or "min" not in acc or "max" not in acc:
                    continue
                a, b = acc["min"], acc["max"]
                corners = np.array(
                    [[x, y, z, 1.0] for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])]
                )
                pts = (corners @ world.T)[:, :3]
                lo, hi = np.minimum(lo, pts.min(0)), np.maximum(hi, pts.max(0))
        stack.extend((c, world) for c in node.get("children", []))
    if not np.isfinite(lo).all():
        return None
    return [round(float(v), 4) for v in lo], [round(float(v), 4) for v in hi]


def parse(path: Path) -> GlbInfo:
    """The header and JSON chunk of `path`: nodes, names, extras and bounds. The BIN chunk is not read."""
    with open(path, "rb") as f:
        total, clen = read_header(f)
        raw = f.read(clen)
    if len(raw) < clen:
        raise GlbError("The GLB ends inside its JSON chunk.")
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise GlbError("The GLB's JSON chunk is not valid JSON.") from None
    if not isinstance(doc, dict):
        raise GlbError("The GLB's JSON chunk is not a glTF document.")
    for b in doc.get("buffers", []):
        uri = b.get("uri") if isinstance(b, dict) else None
        if isinstance(uri, str) and not uri.startswith("data:"):
            raise GlbError("The GLB points at an external buffer file; export it as a single .glb.")
    parts = []
    for i, node in enumerate(doc.get("nodes", [])):
        if isinstance(node, dict) and isinstance(node.get("mesh"), int):
            extras = node.get("extras") if isinstance(node.get("extras"), dict) else {}
            name = str(node.get("name") or f"node_{i}")
            parts.append(GlbPart(node=i, name=name, group=_group_of(name, extras), extras=extras))
    return GlbInfo(doc=doc, json_length=clen, total_length=total, parts=parts, bounds=_bounds(doc))


def normalise(doc: dict, matrix: np.ndarray | None) -> dict:
    """A copy of `doc` in which every node has a unique, non-reserved name, and, when `matrix` is
    given, the default scene's roots hang under one new node carrying it (row-major in,
    column-major out). trimesh then names its scene nodes exactly as the glTF does."""
    doc = json.loads(json.dumps(doc))
    nodes = doc.setdefault("nodes", [])
    taken: set[str] = set()
    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        name = str(node.get("name") or f"node_{i}")
        if name in taken or name in RESERVED_NAMES:
            name = f"{name}_{i}"
        taken.add(name)
        node["name"] = name
    if matrix is not None:
        scenes = doc.get("scenes") or [{"nodes": []}]
        doc["scenes"] = scenes
        si = doc.get("scene", 0)
        si = si if isinstance(si, int) and 0 <= si < len(scenes) else 0
        doc["scene"] = si
        name = FRAME_NODE_NAME if FRAME_NODE_NAME not in taken else f"{FRAME_NODE_NAME}_{len(nodes)}"
        flat = np.asarray(matrix, dtype=float).T.reshape(-1)
        nodes.append({"name": name, "matrix": [float(v) for v in flat], "children": list(scenes[si].get("nodes", []))})
        scenes[si]["nodes"] = [len(nodes) - 1]
    return doc


def write_normalised(
    src: Path,
    dest: Path,
    info: GlbInfo,
    matrix: np.ndarray | None,
    *,
    on_chunk: Callable[[int, int], None] | None = None,
) -> tuple[str, str, int]:
    """Write the stored copy. Returns (source_sha256, stored_sha256, stored_bytes). `on_chunk(done,
    total)` runs after each streamed MiB, so a job can report progress and check cancellation."""
    rest = info.total_length - 20 - info.json_length
    if rest < 0:
        raise GlbError("The GLB's header length is shorter than its JSON chunk.")
    body = json.dumps(normalise(info.doc, matrix), separators=(",", ":")).encode("utf-8")
    body += b" " * (-len(body) % 4)
    head = struct.pack("<4sII", MAGIC, 2, 20 + len(body) + rest) + struct.pack("<I4s", len(body), JSON_TYPE)
    src_hash, out_hash = hashlib.sha256(), hashlib.sha256()
    written = 0
    with open(src, "rb") as f, open(dest, "wb") as out:
        src_hash.update(f.read(20 + info.json_length))
        for piece in (head, body):
            out.write(piece)
            out_hash.update(piece)
            written += len(piece)
        done = 0
        while done < rest:
            chunk = f.read(min(COPY_CHUNK, rest - done))
            if not chunk:
                raise GlbError("The GLB ends before the length its header states.")
            src_hash.update(chunk)
            out_hash.update(chunk)
            out.write(chunk)
            done += len(chunk)
            written += len(chunk)
            if on_chunk is not None:
                on_chunk(done, rest)
    return src_hash.hexdigest(), out_hash.hexdigest(), written
```

- [ ] **Step 4: Run them to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_glb.py -q`
Expected: PASS (12 passed)

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_review/glb.py backend/tests/test_asset_review_glb.py
git commit -m "feat(asset-review): GLB JSON-chunk parser and normalised streamed copy (J1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `meshes`: one concatenated mesh per version, cached

**Files:**
- Create: `backend/app/asset_review/meshes.py`
- Test: `backend/tests/test_asset_review_meshes.py`

**Interfaces:**
- Consumes: `glb.parse` (Task 2); `app.asset_models.store.get_version`, `version_glb_path` (existing).
- Produces:
  - `scene_to_mesh(scene: trimesh.Scene, node_index: dict[str, int]) -> tuple[trimesh.Trimesh, np.ndarray]`
  - `load_glb_mesh(path: Path) -> tuple[trimesh.Trimesh, np.ndarray]`
  - `load_version_mesh(handle, asset_model_id: str, version: int) -> tuple[trimesh.Trimesh, np.ndarray]`. It raises `AppError` 409 `not_ready` when the version is not `ready` or its file is missing.

  The mesh is in the canonical frame. Its faces are in `face_node` order: `face_node[i]` is the glTF node index of face `i`, or `-1` when it cannot be resolved. `mesh.metadata["node_names"]` is `{node_index: name}`, so J3 can name the hit `part` without a database read. The cached mesh is shared, so callers treat it as read-only.
  - `clear_cache() -> None` (tests).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_review_meshes.py
"""One concatenated mesh per version with a per-face node index; one mesh cached per process."""

import hashlib
import json
import shutil
import struct

import numpy as np
import pytest
import trimesh
from fixtures.synthetic_tower import make_tower

from app.asset_models import store
from app.asset_review import glb, meshes
from app.db.models import AssetModel, AssetModelVersion
from app.errors import AppError


@pytest.fixture(autouse=True)
def _fresh_cache():
    meshes.clear_cache()
    yield
    meshes.clear_cache()


def _two_boxes(path):
    sc = trimesh.Scene()
    for i, name in enumerate(("Leg_000", "Leg_001")):
        b = trimesh.creation.box(extents=[1, 1, 1])
        b.apply_translation([i * 3.0, 0.5, 0])
        sc.add_geometry(b, node_name=name, geom_name=f"g{i}")
    path.write_bytes(sc.export(file_type="glb"))
    return path


def _seed_version(handle, src, *, status="ready", sha=True):
    with handle.session() as s:
        m = AssetModel(name="m", status="ready", current_version=1)
        s.add(m)
        s.flush()
        mid = m.id
    dest = store.version_glb_path(handle, mid, 1)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    meta = {"sha256": hashlib.sha256(dest.read_bytes()).hexdigest()} if sha else {}
    with handle.session() as s:
        s.add(
            AssetModelVersion(
                model_id=mid, version=1, spec={}, kind="imported", glb_status=status, source_ids=[], part_count=0, meta=meta
            )
        )
    return mid


def test_load_glb_mesh_maps_every_face_to_its_node(tmp_path):
    tower = make_tower(tmp_path, photos=False)
    mesh, face_node = meshes.load_glb_mesh(tower.glb_path)
    info = glb.parse(tower.glb_path)
    assert len(face_node) == len(mesh.faces) and face_node.dtype == np.int32
    assert set(np.unique(face_node).tolist()) == {p.node for p in info.parts}
    names = mesh.metadata["node_names"]
    assert {names[p.node] for p in info.parts} == {p.name for p in info.parts}
    lo, hi = trimesh.load(str(tower.glb_path), force="scene").bounds
    assert np.allclose(mesh.bounds, [lo, hi], atol=1e-6)


def test_a_multi_primitive_node_maps_to_that_node(tmp_path):
    src = _two_boxes(tmp_path / "two.glb")
    info = glb.parse(src)
    doc = info.doc
    leg0 = next(p for p in info.parts if p.name == "Leg_000")
    mesh_index = doc["nodes"][leg0.node]["mesh"]
    doc["meshes"][mesh_index]["primitives"].append(dict(doc["meshes"][mesh_index]["primitives"][0]))
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    raw = src.read_bytes()
    rest = raw[20 + info.json_length :]
    multi = tmp_path / "multi.glb"
    multi.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(body) + len(rest)) + struct.pack("<I4s", len(body), b"JSON") + body + rest
    )
    mesh, face_node = meshes.load_glb_mesh(multi)
    assert int((face_node == leg0.node).sum()) == 24  # two copies of a 12-triangle box
    assert -1 not in face_node.tolist()


def test_a_glb_without_triangles_is_refused(tmp_path):
    p = tmp_path / "empty.glb"
    body = json.dumps({"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": []}]}).encode()
    body += b" " * (-len(body) % 4)
    p.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(body)) + struct.pack("<I4s", len(body), b"JSON") + body)
    with pytest.raises(ValueError, match="no triangles"):
        meshes.load_glb_mesh(p)


def test_load_version_mesh_holds_exactly_one_mesh(handle, tmp_path):
    a = _seed_version(handle, make_tower(tmp_path, photos=False).glb_path)
    b = _seed_version(handle, _two_boxes(tmp_path / "two.glb"))
    first, _ = meshes.load_version_mesh(handle, a, 1)
    assert meshes.load_version_mesh(handle, a, 1)[0] is first  # cached by sha256
    other, _ = meshes.load_version_mesh(handle, b, 1)
    assert len(other.faces) == 24 and len(meshes._CACHE) == 1
    assert meshes.load_version_mesh(handle, a, 1)[0] is not first  # evicted, loaded again


def test_load_version_mesh_hashes_a_version_without_a_recorded_sha(handle, tmp_path):
    mid = _seed_version(handle, _two_boxes(tmp_path / "two.glb"), sha=False)
    mesh, face_node = meshes.load_version_mesh(handle, mid, 1)
    assert len(mesh.faces) == 24 and len(face_node) == 24


def test_load_version_mesh_not_ready_is_409(handle, tmp_path):
    mid = _seed_version(handle, _two_boxes(tmp_path / "two.glb"), status="pending")
    with pytest.raises(AppError) as e:
        meshes.load_version_mesh(handle, mid, 1)
    assert e.value.code == "not_ready" and e.value.status == 409
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_meshes.py -q`
Expected: FAIL at collection with `ImportError: cannot import name 'meshes' from 'app.asset_review'`

- [ ] **Step 3: Implement `meshes.py`**

```python
# backend/app/asset_review/meshes.py
"""An asset model version as one triangle mesh in the asset frame (spec 2026-10-02-asset-findings
§6.3 "the mesh is held once").

`load_version_mesh` keeps exactly one mesh per process, keyed by the GLB's sha256: J3's placement
loads the model once for a whole job, and a second model evicts the first, so memory stays bounded
to one mesh. trimesh is told to skip materials, so textures are never decoded.
"""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path

import numpy as np
import trimesh

from app.asset_models import store
from app.asset_review import glb
from app.errors import AppError

MAX_PARENT_HOPS = 64

_LOCK = threading.Lock()
_CACHE: dict[str, tuple[trimesh.Trimesh, np.ndarray]] = {}  # at most one entry


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def scene_to_mesh(scene: trimesh.Scene, node_index: dict[str, int]) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Every geometry node, transformed to world, concatenated in `scene.graph.nodes_geometry` order.
    A node trimesh created for an extra primitive is owned by its nearest named glTF ancestor."""
    parents = scene.graph.transforms.parents
    verts: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    owners: list[np.ndarray] = []
    offset = 0
    for node in scene.graph.nodes_geometry:
        transform, gname = scene.graph[node]
        geom = scene.geometry.get(gname)
        if not isinstance(geom, trimesh.Trimesh) or len(geom.faces) == 0:
            continue
        owner, hops = node, 0
        while owner not in node_index and owner in parents and hops < MAX_PARENT_HOPS:
            owner, hops = parents[owner], hops + 1
        v = trimesh.transformations.transform_points(np.asarray(geom.vertices, dtype=float), transform)
        verts.append(v)
        faces.append(np.asarray(geom.faces, dtype=np.int64) + offset)
        owners.append(np.full(len(geom.faces), node_index.get(owner, -1), dtype=np.int32))
        offset += len(v)
    if not faces:
        raise ValueError("the GLB has no triangles")
    mesh = trimesh.Trimesh(vertices=np.vstack(verts), faces=np.vstack(faces), process=False)
    mesh.metadata["node_names"] = {i: name for name, i in node_index.items()}
    return mesh, np.concatenate(owners)


def load_glb_mesh(path: Path) -> tuple[trimesh.Trimesh, np.ndarray]:
    """(mesh, face_node) for one GLB file. Raises whatever trimesh raises for a broken file."""
    info = glb.parse(path)
    node_index = {
        str(n["name"]): i for i, n in enumerate(info.doc.get("nodes", [])) if isinstance(n, dict) and n.get("name")
    }
    scene = trimesh.load(str(path), file_type="glb", force="scene", skip_materials=True)
    return scene_to_mesh(scene, node_index)


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(glb.COPY_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def load_version_mesh(handle, asset_model_id: str, version: int) -> tuple[trimesh.Trimesh, np.ndarray]:
    """The version's mesh and per-face node index, from the one-entry process cache."""
    with handle.session() as s:
        row = store.get_version(s, asset_model_id, version)
        ready, sha = row.glb_status == "ready", (row.meta or {}).get("sha256")
    path = store.version_glb_path(handle, asset_model_id, version)
    if not ready or not path.is_file():
        raise AppError("not_ready", "The 3D model for this version is not ready.", 409)
    key = sha or _file_sha256(path)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            return hit
        loaded = load_glb_mesh(path)
        _CACHE.clear()
        _CACHE[key] = loaded
        return loaded
```

- [ ] **Step 4: Run them to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_meshes.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_review/meshes.py backend/tests/test_asset_review_meshes.py
git commit -m "feat(asset-review): version mesh with per-face node index, one cached per process (J1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `PATCH /asset-models/{id}` takes `frame` and `review`

**Files:**
- Modify: `backend/app/asset_models/schemas.py` (`AssetModelOut`, `AssetModelPatch`)
- Modify: `backend/app/asset_models/router.py` (`patch_asset_model`)
- Modify: `backend/tests/test_contract.py` (`REFUSES_VALID_DATA`)
- Test: `backend/tests/test_asset_model_frame_patch.py`

**Interfaces:**
- Consumes:
  - Task 1's `frame_io.apply_patch`.
  - P1's `Frame`.
  - D1's columns.
  - C0's contract: `AssetModel.frame: AssetFrame | null`, `AssetModel.review: AssetReviewConfig | null`, and the same two optional fields on `AssetModelPatch`.
- Produces:
  - `AssetModelOut.frame: dict | None` and `.review: dict | None`.
  - `AssetModelPatch.frame: Frame | None` and `.review: dict[str, Any] | None`.
  - Errors are 422 `validation_error` for a malformed frame, and 422 `unknown_profile`, `frame_required` or `invalid_review` for a review.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_frame_patch.py
"""PATCH /asset-models/{id} with frame and review (spec §5.1, §8)."""

import pytest

BASE = "/api/v1/projects/{pid}/asset-models"
FRAME = {
    "origin": {"lat": 24.4539, "lon": 54.3773, "ground_alt_m": 5.0},
    "north_offset_deg": 12.5,
    "height_m": 42.0,
    "datum_label": "Ground",
    "datum_note": "Top of foundation slab",
    "line_azimuth_deg": None,
    "silhouette": [[0.0, 3.0], [42.0, 0.9]],
    "levels": [30.0, 36.0],
    "presets": [],
}


@pytest.fixture
def url(client, project_id):
    r = client.post(BASE.format(pid=project_id), json={"name": "Tower"})
    assert r.status_code == 201
    m = r.json()
    assert m["frame"] is None and m["review"] is None
    return f"{BASE.format(pid=project_id)}/{m['id']}"


def test_patch_frame_round_trips(client, url):
    r = client.patch(url, json={"frame": FRAME})
    assert r.status_code == 200, r.text
    got = client.get(url).json()["frame"]
    assert {k: got[k] for k in FRAME} == FRAME


def test_patch_frame_null_clears_it(client, url):
    client.patch(url, json={"frame": FRAME})
    assert client.patch(url, json={"frame": None}).json()["frame"] is None


def test_a_malformed_frame_is_422(client, url):
    r = client.patch(url, json={"frame": {**FRAME, "height_m": "tall"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.get(url).json()["frame"] is None


def test_review_resolves_the_profile_against_the_height(client, url):
    client.patch(url, json={"frame": FRAME})
    r = client.patch(url, json={"review": {"profile_id": "telecom_tower"}})
    assert r.status_code == 200, r.text
    review = r.json()["review"]
    assert review["profile_id"] == "telecom_tower"
    assert {z["id"] for z in review["zones"]} == {"antenna", "body", "base"}
    body = next(z for z in review["zones"] if z["id"] == "body")
    assert body["min_m"] == pytest.approx(4.2) and body["max_m"] == pytest.approx(33.6)


def test_review_and_frame_in_one_patch(client, url):
    r = client.patch(url, json={"frame": FRAME, "review": {"profile_id": "stack"}})
    assert r.status_code == 200 and r.json()["review"]["profile_id"] == "stack"


def test_review_refusals(client, url):
    r = client.patch(url, json={"review": {"profile_id": "stack"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "frame_required"
    client.patch(url, json={"frame": FRAME})
    r = client.patch(url, json={"review": {"profile_id": "pylon"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_profile"
    r = client.patch(url, json={"review": {"name": "no profile id"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_profile"


def test_a_height_change_rescales_the_review(client, url):
    client.patch(url, json={"frame": FRAME, "review": {"profile_id": "telecom_tower"}})
    r = client.patch(url, json={"frame": {**FRAME, "height_m": 84.0}})
    body = next(z for z in r.json()["review"]["zones"] if z["id"] == "body")
    assert body["min_m"] == pytest.approx(8.4) and body["max_m"] == pytest.approx(67.2)


def test_review_null_clears_it_and_a_rename_keeps_both(client, url):
    client.patch(url, json={"frame": FRAME, "review": {"profile_id": "stack"}})
    r = client.patch(url, json={"name": "Stack 2"})
    assert r.json()["name"] == "Stack 2" and r.json()["review"]["profile_id"] == "stack"
    assert client.patch(url, json={"review": None}).json()["review"] is None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_model_frame_patch.py -q`
Expected: FAIL. If C0 or D1 already added plain `frame` and `review` to `AssetModelOut`, the first failure is `test_patch_frame_round_trips`, with 422 because `extra="forbid"` refuses `frame`. Otherwise the fixture fails with `KeyError: 'frame'`.

- [ ] **Step 3: Implement the schemas**

In `backend/app/asset_models/schemas.py`, add `from app.asset_review.frame import Frame` to the imports. Then replace the whole `AssetModelOut` and `AssetModelPatch` classes, including any `frame` or `review` lines C0 or D1 added, with:

```python
class AssetModelOut(BaseModel):
    id: str
    name: str
    asset_type: str | None
    tag: str | None
    status: Literal["empty", "building", "ready"]
    current_version: int | None
    live_run_id: str | None
    captured_on: date | None
    frame: dict | None = None  # app.asset_review.frame.Frame, as stored (spec 2026-10-02-asset-findings §5.1)
    review: dict | None = None  # the resolved review profile (§7)
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, row) -> AssetModelOut:
        return cls.model_validate(row, from_attributes=True)


class AssetModelPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=120)
    asset_type: str | None = Field(None, max_length=80)
    tag: str | None = Field(None, max_length=80)
    captured_on: date | None = None
    frame: Frame | None = None
    # A profile id ({"profile_id": "stack"}) or an edited copy naming its profile; resolved by
    # app.asset_review.frame_io.resolve_review, which answers the 422s.
    review: dict[str, Any] | None = None

    @field_validator("name")
    @classmethod
    def _name_not_null(cls, v):
        if v is None:
            raise ValueError("name cannot be null")
        return v
```

- [ ] **Step 4: Implement the route change**

In `backend/app/asset_models/router.py`, add `from app.asset_review import frame_io` to the imports. Then replace the body of `patch_asset_model` with:

```python
    fields = body.model_dump(exclude_unset=True)
    framing = {k: fields.pop(k) for k in ("frame", "review") if k in fields}
    with handle.session() as s:
        row = store.get_model(s, assetModelId)
        for k, v in fields.items():
            setattr(row, k, v)
        frame_io.apply_patch(row, framing)
        s.flush()
        out = AssetModelOut.of(row)
    publish_asset_models_changed(request, handle, [assetModelId])
    return out
```

In `backend/tests/test_contract.py` `REFUSES_VALID_DATA`, after `"deleteAssetModel": {409},`, add:

```python
    # asset findings J1: a generated review names no built-in profile (`unknown_profile`), or the
    # model has no frame yet (`frame_required`), or an override is out of range (`invalid_review`).
    "patchAssetModel": {422},
```

Delete the `"patchAssetModel": "J1",` line that C0 put in `BACKEND_PENDING`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_model_frame_patch.py tests/test_asset_models_api.py -q`
Expected: PASS

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q -k "AssetModel"`
Expected: PASS

- [ ] **Step 6: Commit**

```powershell
git add backend/app/asset_models/schemas.py backend/app/asset_models/router.py backend/tests/test_contract.py backend/tests/test_asset_model_frame_patch.py
git commit -m "feat(asset-models): PATCH frame and review, resolved against the frame height (J1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `asset_glb_import` job, import route, restore of imported versions

**Files:**
- Create: `backend/app/asset_review/glb_import.py`, `backend/app/asset_review/glb_schemas.py`, `backend/app/asset_review/routes_glb.py`
- Modify: `backend/app/asset_models/schemas.py` (`AssetModelVersionOut.kind` gains `imported`)
- Modify: `backend/app/asset_models/router.py` (`restore_asset_model_version` re-imports an `imported` version)
- Modify: `backend/app/api.py` (one line in the guarded asset-models loop)
- Modify: `backend/app/asset_review/stubs.py` (delete the `importAssetModelGlb` tuple)
- Modify: `backend/tests/test_contract.py` (`REFUSES_VALID_DATA`)
- Test: `backend/tests/test_asset_glb_import.py`

**Interfaces:**
- Consumes:
  - Tasks 1 to 4 (the test reads `frame` from `GET /asset-models/{id}` and edits it with Task 4's `PATCH`).
  - `app.asset_models.store`, plus `service.refresh_status` (existing).
  - `app.asset_models.schemas.AssetModelVersionOut` and `AssetModelVersionWithJob`.
  - P1's `Origin`.
  - D1's `AssetModel.frame` and `AssetModel.review`.
- Produces:
  - `GLB_IMPORT_JOB = "asset_glb_import"`. The job takes params `{asset_model_id, version, path, frame_conversion, origin}` and returns `{asset_model_id, version, height_m, parts}`. C0's `JobType` description fixes params `{asset_model_id, version, path, frame_conversion}` and result `{asset_model_id, version}`; J1 adds `origin`, `height_m` and `parts`.
  - `MAX_GLB_BYTES = 2 GiB`.
  - `check_source(path: Path) -> None`, which raises 422 `glb_invalid`.
  - `start_import(handle, runner, model_id: str, *, path: Path, conversion: str, origin: dict | None, note: str | None = None, source_name: str | None = None) -> tuple[AssetModelVersion, Job]`
  - `GlbImportRequest {path: str, frame_conversion: FrameConversion = "none", origin: Origin | None, note: str | None}` and `FrameConversion = Literal["none", "x_east_minus_z_north", "enu_z_up"]`.
  - HTTP: `POST /api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/import-glb`, `importAssetModelGlb`. It answers:
    - 202 `AssetModelVersionWithJob`;
    - 404 for an unknown model;
    - 409 `job_running` while an agent run is live;
    - 422 `glb_invalid`.
  - **Version `meta` for `kind = imported`:**

    ```
    {source_name, source_sha256, sha256, bytes, node_count, frame_conversion,
     parts: [{node, id, name, group, extras}], source_bounds_m, bounds_m, top_m, base_m,
     height_m, silhouette, triangles}
    ```

    On failure, `meta` instead holds `{source_name, frame_conversion, error}`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_glb_import.py
"""asset_glb_import (spec §6.1): copy and hash, JSON parse, trimesh check, silhouette and height,
an `imported` version, the frame, restore, and the failure paths."""

import json
import re
import struct

import numpy as np
import pytest
import trimesh
from fixtures.synthetic_tower import make_tower

from app.asset_models import store
from app.asset_review import frame_io, glb, meshes
from app.asset_review.glb_import import GLB_IMPORT_JOB, start_import
from app.db.models import AssetModel, AssetModelVersion
from app.jobs.registry import cancelled_before_start_hook

BASE = "/api/v1/projects/{pid}/asset-models"
ORIGIN = {"lat": 24.4539, "lon": 54.3773, "ground_alt_m": 5.0}


@pytest.fixture(autouse=True)
def _fresh_cache():
    meshes.clear_cache()
    yield
    meshes.clear_cache()


@pytest.fixture
def base(project_id):
    return BASE.format(pid=project_id)


@pytest.fixture
def model(client, base):
    r = client.post(base, json={"name": "Tower"})
    assert r.status_code == 201, r.text
    return r.json()


def _import(client, base, model, **body):
    r = client.post(f"{base}/{model['id']}/versions/import-glb", json=body)
    assert r.status_code == 202, r.text
    return r.json()


def _broken_glb(path):
    """Valid header and JSON, but the accessor needs 3,600 bytes and the BIN chunk has 12."""
    doc = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "broken", "mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 300, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 1]}
        ],
        "bufferViews": [{"buffer": 0, "byteLength": 3600}],
        "buffers": [{"byteLength": 3600}],
    }
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    tail = struct.pack("<I4s", 12, b"BIN\x00") + bytes(12)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(body) + len(tail)) + struct.pack("<I4s", len(body), b"JSON") + body + tail
    )
    return path


def test_import_tower_creates_an_imported_version(client, base, model, project_id, wait_job, tmp_path):
    tower = make_tower(tmp_path, photos=False)
    body = _import(client, base, model, path=str(tower.glb_path))
    assert body["version"]["kind"] == "imported" and body["version"]["glb_status"] == "pending"
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"]["version"] == 1 and job["result"]["parts"] > 50
    v = client.get(f"{base}/{model['id']}/versions/1").json()
    meta = v["meta"]
    assert v["kind"] == "imported" and v["glb_status"] == "ready" and v["spec"]["parts"] == []
    assert meta["source_name"] == tower.glb_path.name and meta["frame_conversion"] == "none"
    assert re.fullmatch(r"[0-9a-f]{64}", meta["sha256"]) and re.fullmatch(r"[0-9a-f]{64}", meta["source_sha256"])
    assert v["part_count"] == len(meta["parts"]) and meta["node_count"] >= len(meta["parts"])
    assert {"Leg", "Antenna", "Platform"} <= {p["group"] for p in meta["parts"]}
    top = float(trimesh.load(str(tower.glb_path), force="scene").bounds[1][1])
    assert meta["height_m"] == pytest.approx(top, abs=1e-3) and meta["triangles"] > 1000
    glb_resp = client.get(f"{base}/{model['id']}/versions/1/glb")
    assert glb_resp.status_code == 200 and glb_resp.content[:4] == b"glTF"
    assert meta["bytes"] == len(glb_resp.content)
    m = client.get(f"{base}/{model['id']}").json()
    assert m["status"] == "ready" and m["current_version"] == 1
    assert m["frame"]["height_m"] == pytest.approx(top, abs=1e-3) and m["frame"]["origin"] is None
    assert 1 < len(m["frame"]["silhouette"]) <= 160 and m["frame"]["silhouette"] == meta["silhouette"]


def test_import_with_conversion_lands_in_the_canonical_frame(client, base, model, project_id, wait_job, handle, tmp_path):
    tower = make_tower(tmp_path, photos=False)
    kipic = trimesh.load(str(tower.glb_path), force="scene")
    canonical_bounds = kipic.bounds.copy()
    kipic.apply_transform(np.linalg.inv(frame_io.CONVERSIONS["x_east_minus_z_north"]))
    src = tmp_path / "kipic.glb"
    src.write_bytes(kipic.export(file_type="glb"))
    body = _import(client, base, model, path=str(src), frame_conversion="x_east_minus_z_north", origin=ORIGIN)
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    mesh, _ = meshes.load_version_mesh(handle, model["id"], 1)
    assert np.allclose(mesh.bounds, canonical_bounds, atol=1e-4)
    m = client.get(f"{base}/{model['id']}").json()
    assert {k: m["frame"]["origin"][k] for k in ORIGIN} == ORIGIN
    v = client.get(f"{base}/{model['id']}/versions/1").json()
    assert v["meta"]["frame_conversion"] == "x_east_minus_z_north"
    info = glb.parse(src)
    stored = store.version_glb_path(handle, model["id"], 1).read_bytes()
    raw = src.read_bytes()
    assert stored[-(len(raw) - 20 - info.json_length) :] == raw[20 + info.json_length :]  # BIN not rewritten


def test_import_refuses_what_is_not_a_glb(client, base, model, tmp_path):
    text = tmp_path / "notes.glb"
    text.write_text("hello")
    for path in (str(text), str(tmp_path / "missing.glb"), "bad\x00name.glb"):
        r = client.post(f"{base}/{model['id']}/versions/import-glb", json={"path": path})
        assert r.status_code == 422 and r.json()["error"]["code"] == "glb_invalid", r.text
    r = client.post(f"{base}/{model['id']}/versions/import-glb", json={"path": str(text), "frame_conversion": "z_up"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.get(f"{base}/{model['id']}/versions").json()["items"] == []
    assert client.post(f"{base}/missing/versions/import-glb", json={"path": str(text)}).status_code == 404


def test_import_is_refused_while_an_agent_run_is_live(client, base, model, handle, tmp_path):
    with handle.session() as s:
        s.get(AssetModel, model["id"]).live_run_id = "run-1"
    r = client.post(f"{base}/{model['id']}/versions/import-glb", json={"path": str(make_tower(tmp_path, photos=False).glb_path)})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"


def test_a_glb_trimesh_cannot_load_fails_the_version(client, base, model, project_id, wait_job, handle, tmp_path):
    body = _import(client, base, model, path=str(_broken_glb(tmp_path / "broken.glb")))
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "failed" and job["error"].startswith("The GLB could not be loaded")
    v = client.get(f"{base}/{model['id']}/versions/1").json()
    assert v["glb_status"] == "failed" and v["meta"]["error"] == job["error"]
    assert not store.version_glb_path(handle, model["id"], 1).exists()
    assert not list(store.model_dir(handle, model["id"]).glob("*.tmp"))


def test_reimport_follows_an_untouched_frame_and_keeps_an_edited_one(client, base, model, project_id, wait_job, tmp_path):
    tower = make_tower(tmp_path, photos=False)
    wait_job(project_id, _import(client, base, model, path=str(tower.glb_path))["job"]["id"])
    h1 = client.get(f"{base}/{model['id']}").json()["frame"]["height_m"]
    big = trimesh.load(str(tower.glb_path), force="scene")
    big.apply_scale(2.0)
    src = tmp_path / "big.glb"
    src.write_bytes(big.export(file_type="glb"))
    wait_job(project_id, _import(client, base, model, path=str(src))["job"]["id"])
    frame = client.get(f"{base}/{model['id']}").json()["frame"]
    assert frame["height_m"] == pytest.approx(2 * h1, abs=1e-2)
    r = client.patch(f"{base}/{model['id']}", json={"frame": {**frame, "height_m": 50.0}})  # Task 4's PATCH
    assert r.status_code == 200, r.text
    wait_job(project_id, _import(client, base, model, path=str(tower.glb_path))["job"]["id"])
    assert client.get(f"{base}/{model['id']}").json()["frame"]["height_m"] == 50.0


def test_restore_of_an_imported_version_reimports_its_glb(client, base, model, project_id, wait_job, tmp_path):
    wait_job(project_id, _import(client, base, model, path=str(make_tower(tmp_path, photos=False).glb_path))["job"]["id"])
    r = client.post(f"{base}/{model['id']}/versions/1/restore")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"]["version"] == 2 and body["version"]["kind"] == "imported"
    assert body["version"]["note"] == "Restored from version 1"
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    v1 = client.get(f"{base}/{model['id']}/versions/1").json()["meta"]
    v2 = client.get(f"{base}/{model['id']}/versions/2").json()["meta"]
    assert v2["sha256"] == v1["sha256"] and v2["source_name"] == v1["source_name"]


def test_cancelled_before_start_marks_the_version_failed(handle, tmp_path):
    from app.asset_models.service import refresh_status

    class Runner:
        def submit(self, handle, type, params):
            from app.db.models import Job

            with handle.session() as s:
                job = Job(type=type, params=params)
                s.add(job)
                s.flush()
                s.expunge(job)
            return job

    with handle.session() as s:
        m = AssetModel(name="m", status="empty")
        s.add(m)
        s.flush()
        mid = m.id
    row, job = start_import(
        handle, Runner(), mid, path=make_tower(tmp_path, photos=False).glb_path, conversion="none", origin=None
    )

    class Ctx:
        project, params, job_id = handle, job.params, job.id

        def publish(self, *_a):
            pass

    cancelled_before_start_hook(GLB_IMPORT_JOB)(Ctx())
    with handle.session() as s:
        v = store.get_version(s, mid, 1)
        assert v.glb_status == "failed" and v.kind == "imported" and v.meta["error"]
        model = s.get(AssetModel, mid)
        refresh_status(model)
        assert model.current_version == 1


def test_imported_versions_survive_the_restart_sweep_rules(handle, tmp_path):
    """A pending imported version whose job is gone is failed by the existing asset model sweep."""
    from app.asset_models import startup

    class Runner:
        def is_live(self, _job_id):
            return False

    with handle.session() as s:
        m = AssetModel(name="m", status="ready", current_version=1)
        s.add(m)
        s.flush()
        s.add(
            AssetModelVersion(
                model_id=m.id, version=1, spec={}, kind="imported", glb_status="pending", source_ids=[], part_count=0,
                glb_job_id="gone",
            )
        )
        mid = m.id
    startup.sweep_interrupted(handle, Runner())
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_glb_import.py -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.asset_review.glb_import'`

- [ ] **Step 3: Implement the request schema**

```python
# backend/app/asset_review/glb_schemas.py
"""Request shape of `importAssetModelGlb` (contract: AssetGlbImport)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.asset_review.frame import Origin

FrameConversion = Literal["none", "x_east_minus_z_north", "enu_z_up"]  # = frame_io.CONVERSIONS keys


class GlbImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=1024)
    frame_conversion: FrameConversion = "none"
    origin: Origin | None = None
    note: str | None = Field(None, max_length=500)
```

Add this guard test at the end of `backend/tests/test_asset_glb_import.py`:

```python
def test_the_request_literal_lists_every_conversion():
    from typing import get_args

    from app.asset_review.glb_schemas import FrameConversion

    assert set(get_args(FrameConversion)) == set(frame_io.CONVERSIONS)
```

- [ ] **Step 4: Implement the job and `start_import`**

```python
# backend/app/asset_review/glb_import.py
"""`asset_glb_import` (spec 2026-10-02-asset-findings §6.1): an existing GLB becomes an `imported`
asset model version, in the canonical frame, with its parts, height and silhouette.

Steps: parse the JSON chunk; stream the stored copy (normalised JSON, the conversion baked in as a
root node matrix, the BIN chunk copied byte for byte) while hashing; check trimesh loads it;
compute the silhouette and height; mark the version ready and update the model's frame. The stored
`v<n>.glb` is written once here and never rewritten. A pending version whose job dies is failed by
`app.asset_models.startup.sweep_interrupted`, like a built one.
"""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import select

from app.asset_models import store
from app.asset_models.service import refresh_status
from app.asset_review import frame_io, glb, meshes
from app.db.models import AssetModelVersion
from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type

GLB_IMPORT_JOB = "asset_glb_import"
MAX_GLB_BYTES = 2 * 1024**3
MAX_ERROR_DETAIL = 300


def check_source(path: Path) -> None:
    """The route's cheap check: an existing file of at most 2 GB that starts like a GLB 2.0."""
    try:
        if not path.is_file():
            raise AppError("glb_invalid", "The GLB file was not found.", 422)
        if path.stat().st_size > MAX_GLB_BYTES:
            raise AppError("glb_invalid", "The GLB is larger than 2 GB.", 422)
        with open(path, "rb") as f:
            glb.read_header(f)
    except glb.GlbError as e:
        raise AppError("glb_invalid", str(e), 422) from None
    except (OSError, ValueError):
        raise AppError("glb_invalid", "The GLB file could not be opened.", 422) from None


def start_import(
    handle,
    runner,
    model_id: str,
    *,
    path: Path,
    conversion: str,
    origin: dict | None,
    note: str | None = None,
    source_name: str | None = None,
):
    """Insert a pending `imported` version, point the model at it, and queue the job."""
    with handle.session() as s:
        model = store.get_model(s, model_id)
        n = store.next_version_number(s, model_id)
        row = AssetModelVersion(
            model_id=model_id,
            version=n,
            spec={},
            kind="imported",
            glb_status="pending",
            source_ids=[],
            note=note,
            part_count=0,
            meta={"source_name": source_name or path.name, "frame_conversion": conversion},
        )
        s.add(row)
        model.current_version = n
        refresh_status(model)
        s.flush()
        s.expunge(row)
    params = {
        "asset_model_id": model_id,
        "version": n,
        "path": str(path),
        "frame_conversion": conversion,
        "origin": origin,
    }
    try:
        job = runner.submit(handle, GLB_IMPORT_JOB, params)
    except Exception:
        with handle.session() as s:
            store.get_version(s, model_id, n).glb_status = "failed"
        raise
    with handle.session() as s:
        store.get_version(s, model_id, n).glb_job_id = job.id
    return row, job


def _mark_failed(ctx, message: str) -> None:
    mid, n = ctx.params["asset_model_id"], int(ctx.params["version"])
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        v.glb_status = "failed"
        v.meta = {**(v.meta or {}), "error": message}
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})


def _cancelled_before_start(ctx) -> None:
    _mark_failed(ctx, "Cancelled before it started.")


def _previous_import_meta(s, model_id: str, version: int) -> dict | None:
    prev = s.scalar(
        select(AssetModelVersion)
        .where(
            AssetModelVersion.model_id == model_id,
            AssetModelVersion.kind == "imported",
            AssetModelVersion.glb_status == "ready",
            AssetModelVersion.version < version,
        )
        .order_by(AssetModelVersion.version.desc())
        .limit(1)
    )
    return prev.meta if prev is not None else None


@register_job_type(GLB_IMPORT_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_glb_import(ctx) -> dict:
    out = store.version_glb_path(ctx.project, ctx.params["asset_model_id"], int(ctx.params["version"]))
    tmp = out.with_name(out.name + ".tmp")
    try:
        return _run(ctx, out, tmp)
    except JobCancelled:
        tmp.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
        _mark_failed(ctx, "Cancelled.")
        raise


def _fail(ctx, message: str, *paths: Path) -> JobFailure:
    for p in paths:
        p.unlink(missing_ok=True)
    _mark_failed(ctx, message)
    return JobFailure(message)


def _run(ctx, out: Path, tmp: Path) -> dict:
    p = ctx.params
    mid, n = p["asset_model_id"], int(p["version"])
    src = Path(p["path"])
    conversion = p.get("frame_conversion") or "none"
    if conversion not in frame_io.CONVERSIONS:
        raise _fail(ctx, f"Unknown frame conversion {conversion!r}.")
    ctx.progress(0, f"Reading {src.name}")
    try:
        info = glb.parse(src)
        out.parent.mkdir(parents=True, exist_ok=True)

        def on_chunk(done: int, total: int) -> None:
            ctx.check_cancelled()
            ctx.progress(0.6 * done / max(total, 1), f"Copying {src.name}")

        src_sha, sha, size = glb.write_normalised(src, tmp, info, frame_io.matrix_of(conversion), on_chunk=on_chunk)
        os.replace(tmp, out)
    except glb.GlbError as e:
        raise _fail(ctx, str(e), tmp) from None
    except OSError as e:
        raise _fail(ctx, f"The GLB could not be copied: {type(e).__name__}.", tmp) from None
    ctx.check_cancelled()
    ctx.progress(0.65, "Checking the model loads")
    try:
        mesh, _face_node = meshes.load_glb_mesh(out)
    except Exception as e:  # noqa: BLE001 - trimesh raises many types; the message is the point
        detail = (str(e).strip() or type(e).__name__)[:MAX_ERROR_DETAIL]
        raise _fail(ctx, f"The GLB could not be loaded: {detail}", out) from None
    ctx.check_cancelled()
    ctx.progress(0.85, "Measuring the height and silhouette")
    lo, hi = mesh.bounds
    height = round(float(hi[1]), 3)
    if height <= 0:
        raise _fail(
            ctx, f"The model lies below its ground datum (top at {height:g} m); check the frame conversion.", out
        )
    silhouette = frame_io.silhouette_from_mesh(mesh)
    parts = [{"node": x.node, "id": x.name, "name": x.name, "group": x.group, "extras": x.extras} for x in info.parts]
    meta = {
        "source_name": (p.get("source_name") or src.name),
        "source_sha256": src_sha,
        "sha256": sha,
        "bytes": size,
        "node_count": len(info.doc.get("nodes", [])),
        "frame_conversion": conversion,
        "parts": parts,
        "source_bounds_m": list(info.bounds) if info.bounds else None,
        "bounds_m": [[round(float(v), 4) for v in lo], [round(float(v), 4) for v in hi]],
        "top_m": height,
        "base_m": round(float(lo[1]), 3),
        "height_m": height,
        "silhouette": [list(pair) for pair in silhouette],
        "triangles": int(len(mesh.faces)),
    }
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        meta["source_name"] = (v.meta or {}).get("source_name") or meta["source_name"]
        prev_meta = _previous_import_meta(s, mid, n)
        model = store.get_model(s, mid)
        old_h = float(model.frame["height_m"]) if model.frame else None
        model.frame = frame_io.frame_after_import(model.frame, prev_meta, height, silhouette, p.get("origin"))
        new_h = float(model.frame["height_m"])
        if model.review and old_h and new_h != old_h:
            model.review = frame_io.rescale_review(model.review, old_h, new_h)
        v.glb_status, v.meta, v.part_count = "ready", meta, len(parts)
        refresh_status(model)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Imported version {n}: {len(parts):,} parts, {height:g} m tall")
    return {"asset_model_id": mid, "version": n, "height_m": height, "parts": len(parts)}
```

- [ ] **Step 5: Implement the route**

```python
# backend/app/asset_review/routes_glb.py
"""`POST /asset-models/{assetModelId}/versions/import-glb` (spec §8). The route checks the file
cheaply and queues `asset_glb_import`; it never copies or loads the GLB itself."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request

from app.asset_models import store
from app.asset_models.schemas import AssetModelVersionOut, AssetModelVersionWithJob
from app.asset_review import glb_import
from app.asset_review.glb_schemas import GlbImportRequest
from app.errors import AppError
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])


@router.post(
    "/asset-models/{assetModelId}/versions/import-glb", response_model=AssetModelVersionWithJob, status_code=202
)
def import_asset_model_glb(
    assetModelId: str,  # noqa: N803
    body: GlbImportRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> AssetModelVersionWithJob:
    with handle.session() as s:
        if store.get_model(s, assetModelId).live_run_id:
            raise AppError("job_running", "An agent run is building this model; wait for it to finish.", 409)
    source = Path(body.path)
    glb_import.check_source(source)
    row, job = glb_import.start_import(
        handle,
        request.app.state.jobs,
        assetModelId,
        path=source,
        conversion=body.frame_conversion,
        origin=body.origin.model_dump(mode="json") if body.origin else None,
        note=body.note,
    )
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelVersionWithJob(version=AssetModelVersionOut.of(row), job=JobOut.from_row(job, handle.id))
```

- [ ] **Step 6: Wire it up**

In `backend/app/asset_models/schemas.py`, in `AssetModelVersionOut`, replace the `kind` line with:

```python
    kind: Literal["agent", "manual", "draft", "imported"]
```

In `backend/app/asset_models/router.py`:
- Add `from app.asset_review import glb_import` to the imports.
- Replace the body of `restore_asset_model_version` with the following. The signature is unchanged.

```python
    with handle.session() as s:
        old = store.get_version(s, assetModelId, version)
        kind, meta, sources = old.kind, dict(old.meta or {}), list(old.source_ids)
        spec = None if kind == "imported" else AssetSpec.model_validate(old.spec)
    if kind == "imported":
        # An imported version has no spec to rebuild from: re-import its stored GLB as it is.
        stored = store.version_glb_path(handle, assetModelId, version)
        if not stored.is_file():
            raise AppError("not_ready", "The 3D model for this version is not available.", 409)
        row, job = glb_import.start_import(
            handle,
            request.app.state.jobs,
            assetModelId,
            path=stored,
            conversion="none",
            origin=None,
            note=f"Restored from version {version}",
            source_name=meta.get("source_name"),
        )
    else:
        row, job = service.add_version(
            handle,
            request.app.state.jobs,
            assetModelId,
            spec,
            kind="manual",
            note=f"Restored from version {version}",
            source_ids=sources,
        )
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelVersionWithJob(version=AssetModelVersionOut.of(row), job=JobOut.from_row(job, handle.id))
```

`start_import` takes `source_name` from its argument. The job copies it from the version row into `meta` (in `_run`, `meta["source_name"] = (v.meta or {}).get("source_name") or ...`), so the restored version keeps the original file name.

In `backend/app/api.py`, in the guarded loop that holds `"app.asset_models.runs"`, add one line directly above `"app.asset_review.stubs"` (C0's rule for owners):

```python
    "app.asset_review.routes_glb",  # asset findings J1: GLB import (spec 2026-10-02-asset-findings §6.1)
```

In `backend/app/asset_review/stubs.py`, delete the `importAssetModelGlb` tuple from `J1_STUBS`, leaving `J1_STUBS: list[tuple[str, str, str]] = []` if it was the only one. The contract test's `EXPECTED_STUBS` reads the lists through `stub_operation_ids()`, so nothing else changes there. If J1 is the last of D1 and J1 to J5 to land, also delete `app/asset_review/stubs.py`, its line in `app/api.py`, and its `EXPECTED_STUBS |=` line and import in `test_contract.py` (C0's rule).

In `backend/tests/test_contract.py` `REFUSES_VALID_DATA`, next to the `patchAssetModel` entry from Task 4, add:

```python
    # asset findings J1: a schema-valid path that is not a readable GLB 2.0 (`glb_invalid`); a model
    # with a live agent run (`job_running`).
    "importAssetModelGlb": {409, 422},
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_glb_import.py tests/test_asset_models_api.py tests/test_asset_models_glb_job.py -q`
Expected: PASS

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q -k "importAssetModelGlb or restoreAssetModelVersion or stub_list"`
Expected: PASS

- [ ] **Step 8: Commit**

```powershell
git add backend/app/asset_review/glb_import.py backend/app/asset_review/glb_schemas.py backend/app/asset_review/routes_glb.py backend/app/asset_models/schemas.py backend/app/asset_models/router.py backend/app/api.py backend/app/asset_review/stubs.py backend/tests/test_contract.py backend/tests/test_asset_glb_import.py
git commit -m "feat(asset-review): asset_glb_import job and import-glb route; restore re-imports (J1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gate, merge and walkthrough

**Files:** none new.

- [ ] **Step 1: Run the full gate in the worktree**

```powershell
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: every command exits 0. If `ruff format --check` reports files, run `ruff format` on them, re-run the tests, and commit by path. The `cargo test` step runs only when `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists in the worktree; it normally does not.

- [ ] **Step 2: Merge.** Use `scripts\finish-task.ps1` or, on PowerShell 5.1, the manual merge from the "Nested unit controllers" memory. Then remove the worktree, keeping the venv junction intact, and delete `task/af-j1`.

- [ ] **Step 3: Operator walkthrough.** J1 is backend only, but the API is user-observable through the docs page:
  1. Start the app (`pnpm -C frontend dev` with the backend sidecar), open a project and note its id.
  2. Create an asset model in the Asset models screen, or via `POST /api/v1/projects/{id}/asset-models`.
  3. In `http://127.0.0.1:<port>/docs`, call `importAssetModelGlb` with `{"path": "<a .glb on disk>", "frame_conversion": "none"}`. Expect 202 and a job in the Jobs panel that finishes "Imported version 1: N parts, H m tall".
  4. Open the asset model: version 1 shows as imported, and the 3D view loads the GLB.
  5. Call `patchAssetModel` with `{"review": {"profile_id": "stack"}}`. Expect the review to come back with zones in metres.

---

## Self-review

**Spec coverage (J1):**
- §6.1 steps:
  1. Copy and hash: `write_normalised`, streamed, with sha256 of both the source and the stored file.
  2. JSON chunk: `glb.parse` reads nodes, names, extras and bounds; the BIN chunk is never decoded.
  3. The trimesh check: `load_glb_mesh`. On failure the version is `failed` and the job error is "The GLB could not be loaded: <trimesh message>".
  4. Silhouette and height: `silhouette_from_mesh`, a kit port with golden tests.
  5. An `imported` version with the §5.2 `meta`.
- **Conversions:** one golden test each for `none`, `x_east_minus_z_north` and `enu_z_up`, plus a rotation check and an end-to-end bounds test on the tower.
- **§5.1:** `frame` defaults from the GLB, and every field stays editable through `PATCH`. `review` is resolved through P1's `resolve`.
- **Index interfaces:** `frame_io.silhouette_from_mesh`, `frame_io.CONVERSIONS` and `meshes.load_version_mesh` are produced with the index's signatures.
- **Stubs:** `importAssetModelGlb` is removed from `asset_review/stubs.py`.
- **Global Constraints:**
  - background job with progress and a cancel check per streamed MiB;
  - the restart sweep (the existing asset model sweep covers `imported` versions; tested);
  - the BIN chunk copied, never decoded;
  - customer data never committed (tests use the synthetic tower and hand-made GLBs).

## Index notes

1. **"Never rewritten" and the baked conversion.** Spec §5.2 says the GLB is "copied ... and is never rewritten". J1 writes the stored copy once, on import, with:
   - a normalised JSON chunk: unique node names, and one root node `kestrel_frame` carrying the conversion matrix when the conversion is not `none`;
   - the BIN chunk copied byte for byte.

   After that the file is never rewritten. `meta.sha256` is the stored file's hash, which `load_version_mesh` keys on. `meta.source_sha256` is the operator's original file's hash.
2. **`meta` field names.** `meta.parts[]` carries `id` as well as the spec's `{node, name, group, extras}`. It also carries `bounds_m`, `top_m` and `triangles`, as built versions do. Existing readers of version `meta` therefore work unchanged.
3. **Checked against C0's plan (`2026-10-03-asset-findings-c0.md`).** `AssetModelVersion.kind` gains `imported`; `AssetGlbImport` is `{path, frame_conversion: AssetFrameConversion, origin: AssetFrameOrigin | null, note}`; the refusal codes are 409 `job_running` and 422 `glb_invalid`; `AssetFrameConversion` is `none`, `x_east_minus_z_north`, `enu_z_up`, so J1 ships all three converters; `BACKEND_PENDING` holds `patchAssetModel: "J1"`, which Task 4 deletes. C0's `AssetModel` requires `frame` and `review`; Task 4's `AssetModelOut` serves both (null by default).
4. **P1 alignment (checked against `2026-10-03-asset-findings-p1.md` Tasks 1, 2 and 7).**
   - `Origin(lat, lon, ground_alt_m)` and `Frame` (`extra="forbid"`, every field but `height_m` defaulted) match what `frame_after_import` builds.
   - `north_offset_deg` is the true bearing of plant north; J1 only stores it.
   - `resolve` raises `UnknownProfile` for an unknown id. J1 checks `PROFILES` first, so that path answers 422 `unknown_profile`.
   - `ReviewZone.min_m`/`max_m` are `None` at open ends. `rescale_review` skips non-numbers, so `None` and the kit's ±1e9 sentinels both stay put.
   - J1 tests call `make_tower(tmp_path, photos=False)`, because the photos are not needed for the GLB.
5. **`face_node`.** It holds glTF node indices, with `-1` when unresolved. The index's "per-face node index" is read that way. Node names come from `mesh.metadata["node_names"]`.
6. **Restore.** Restoring an `imported` version re-imports its stored GLB through `asset_glb_import` (201, as before). Before this change it would have built an empty spec.
7. **No ray engine dependency.** `rtree` is not installed in `backend/.venv`, so trimesh's `mesh.ray` would fail. J1 never touches it: `load_version_mesh` only loads and concatenates. J3 chooses the ray caster.
