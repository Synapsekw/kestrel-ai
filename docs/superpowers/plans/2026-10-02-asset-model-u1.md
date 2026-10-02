# Asset model U1 — spec, shapes, validation, GLB builder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure-Python model spec and a deterministic builder that turns it into named, metre-scale meshes and a GLB with per-node extras.

**Architecture:** `spec.py` holds the pydantic spec, with each shape's params validated by a per-shape model. `shapes.py` builds one shape as a `trimesh.Trimesh` in a local frame (+Y axis, base at y = 0, millimetres). `placement.py` computes each part's 4×4 transform in the asset frame (including shell- and head-mounted parts). `build.py` assembles meshes in metres, and writes a GLB plus a JSON-chunk patch for extras. `validate.py` returns errors and warnings. Nothing here touches the database or the network.

**Tech Stack:** Python 3.11, pydantic 2, numpy, trimesh, mapbox-earcut, shapely (existing), pytest.

**Spec:** `docs/superpowers/specs/2026-10-02-asset-model-builder-design.md` §6. Index and Global Constraints: `docs/superpowers/plans/2026-10-02-asset-model-builder.md` — every constraint there applies here.

**Worktree:** `scripts\start-task.ps1 -Name am-u1`. This unit adds packages (`trimesh`, `mapbox-earcut`): overlay venv in the worktree while developing, then install only those pins into the shared venv with `--no-deps` at landing.

---

### Task 1: Dependencies and packaging

**Files:**
- Modify: `backend/requirements.txt` (add `trimesh` and `mapbox-earcut` after `shapely`)
- Modify: `backend/requirements-lock.txt` (exact pins)
- Modify: `backend/kestrel_backend.spec`
- Test: `backend/tests/test_asset_model_deps.py`

**Interfaces:**
- Produces: `import trimesh` and `trimesh.creation.extrude_polygon` work in the shared venv and the frozen build.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_model_deps.py
"""trimesh and its polygon triangulator are importable (U1 Task 1)."""

from shapely.geometry import Polygon


def test_trimesh_extrudes_a_polygon():
    import trimesh

    mesh = trimesh.creation.extrude_polygon(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]), 2.0)
    assert mesh.is_watertight
    assert abs(mesh.volume - 2.0) < 1e-9
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$PY -m pytest tests/test_asset_model_deps.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'trimesh'`

- [ ] **Step 3: Create the overlay venv and install**

```powershell
cd .claude\worktrees\am-u1\backend
uv venv .venv-overlay --python 3.11 --system-site-packages
.\.venv-overlay\Scripts\python.exe -m pip install "trimesh==4.*" "mapbox-earcut==1.*"
.\.venv-overlay\Scripts\python.exe -m pip show trimesh mapbox-earcut   # note exact versions
```

Add to `backend/requirements.txt` after `shapely`:

```
trimesh            # asset model builder: meshes and GLB export (spec 2026-10-02 §6.4)
mapbox-earcut      # trimesh polygon triangulation for `extrusion` parts
```

Add the exact versions shown by `pip show` to `backend/requirements-lock.txt`, alphabetically: `trimesh==<x.y.z>` and `mapbox-earcut==<x.y.z>`.

In `backend/kestrel_backend.spec`, extend `hiddenimports` and `datas`:

```python
    # trimesh imports its exporters and creation helpers lazily by name (asset models, 2026-10-02).
    + collect_submodules("trimesh")
```

```python
    # trimesh ships JSON templates under trimesh/resources/ that the glTF exporter reads.
    + collect_data_files("trimesh")
```

- [ ] **Step 4: Run the test in the overlay venv to verify it passes**

Run: `.\.venv-overlay\Scripts\python.exe -m pytest tests/test_asset_model_deps.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/requirements-lock.txt backend/kestrel_backend.spec backend/tests/test_asset_model_deps.py
git commit -m "build(asset-models): add trimesh and mapbox-earcut

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The spec models (`spec.py`)

**Files:**
- Create: `backend/app/asset_models/__init__.py` (docstring only)
- Create: `backend/app/asset_models/spec.py`
- Test: `backend/tests/test_asset_model_spec.py`

**Interfaces:**
- Produces:
  - `AssetSpec(asset: AssetInfo, parts: list[Part])`
  - `Part(id, name, group, shape, params: dict, placement: Placement, material, source: Source, confidence)`, with `Part.typed_params() -> BaseModel`
  - `SHAPE_PARAMS: dict[str, type[BaseModel]]`
  - `SHELL_HOSTS = {"cylinder", "cone"}`, `HEAD_HOSTS = {"head_torispherical", "head_ellipsoidal", "head_hemispherical", "flat_plate"}`
  - `MAX_PARTS = 2000`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_spec.py
"""The model spec (spec 2026-10-02 §6.1-6.2)."""

import pytest
from pydantic import ValidationError

from app.asset_models.spec import SHAPE_PARAMS, AssetSpec, Part


def shell(**over):
    base = {
        "id": "shell_course_1", "name": "Shell course 1", "group": "Shell", "shape": "cylinder",
        "params": {"id": 4000, "thickness": 8, "height": 3000},
        "placement": {"origin_mm": [0, 0, 0]},
        "material": "paint",
        "source": {"kind": "drawing", "id": "d1", "region": [0.1, 0.1, 0.4, 0.3]},
        "confidence": "high",
    }
    base.update(over)
    return base


def test_minimal_spec_parses_with_defaults():
    spec = AssetSpec.model_validate({"asset": {}, "parts": [shell()]})
    part = spec.parts[0]
    assert part.placement.axis == [0.0, 1.0, 0.0]
    assert part.typed_params().height == 3000


def test_every_vocabulary_shape_has_a_params_model():
    assert set(SHAPE_PARAMS) == {
        "cylinder", "cone", "head_torispherical", "head_ellipsoidal", "head_hemispherical",
        "flat_plate", "box", "nozzle", "pipe_run", "lathe", "extrusion", "sweep",
    }


@pytest.mark.parametrize("params", [
    {"id": 4000, "thickness": 8},                       # height missing
    {"id": 4000, "thickness": 8, "height": -1},        # non-positive
    {"id": 4000, "thickness": 8, "height": 10, "x": 1},  # unknown key
])
def test_bad_params_are_rejected(params):
    with pytest.raises(ValidationError):
        AssetSpec.model_validate({"asset": {}, "parts": [shell(params=params)]})


def test_unknown_shape_is_rejected():
    with pytest.raises(ValidationError):
        Part.model_validate(shell(shape="torus"))


def test_region_must_be_inside_unit_square():
    with pytest.raises(ValidationError):
        Part.model_validate(shell(source={"kind": "drawing", "id": "d1", "region": [0, 0, 1.2, 1]}))


def test_shell_mounted_placement_needs_bearing_and_elevation():
    nozzle = shell(id="N1", group="Nozzle", shape="nozzle",
                   params={"dn": 50, "od": 60.3, "projection": 200, "flange_od": 165, "flange_t": 20},
                   placement={"host": "shell_course_1", "bearing_deg": 90})
    with pytest.raises(ValidationError, match="elevation_mm"):
        Part.model_validate(nozzle)


def test_spec_round_trips_through_json():
    spec = AssetSpec.model_validate({"asset": {"tag": "710-D-130335"}, "parts": [shell()]})
    again = AssetSpec.model_validate_json(spec.model_dump_json())
    assert again == spec
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_spec.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.asset_models'`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/__init__.py
"""Asset models: a part-by-part model of an inspected asset, built from drawings, clouds and photos
(spec 2026-10-02-asset-model-builder)."""
```

```python
# backend/app/asset_models/spec.py
"""The model spec (spec 2026-10-02 §6.1-6.2): the single source of truth for an asset model.

Millimetres and degrees. Asset frame: Y up, X plant north, Z plant east; bearing θ points along
(cos θ, 0, sin θ). Each shape's params are validated by its own model in SHAPE_PARAMS, so adding a
shape is one params model plus one builder in `shapes.py`.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_PARTS = 2000

Pos = Annotated[float, Field(gt=0)]
NonNeg = Annotated[float, Field(ge=0)]
Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]
Pt2 = Annotated[list[float], Field(min_length=2, max_length=2)]
Unit = Annotated[float, Field(ge=0, le=1)]

Group = Literal["Shell", "Head", "Bottom", "Nozzle", "Manway", "Support", "Access", "Internal", "Lining", "Other"]
Material = Literal["paint", "steel", "rubber", "concrete", "grating", "galvanised", "glass", "other"]
Confidence = Literal["high", "medium", "low"]
Facing = Literal["up", "down"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CylinderParams(_Strict):
    id: Pos
    thickness: Pos
    height: Pos
    sweep_deg: float = Field(360, gt=0, le=360)


class ConeParams(_Strict):
    d_bottom: Pos
    d_top: NonNeg
    thickness: Pos
    height: Pos


class TorisphericalParams(_Strict):
    id: Pos
    thickness: Pos
    crown_r: Pos
    knuckle_r: Pos
    facing: Facing = "up"


class EllipsoidalParams(_Strict):
    id: Pos
    thickness: Pos
    ratio: float = Field(2.0, gt=0)
    facing: Facing = "up"


class HemisphericalParams(_Strict):
    id: Pos
    thickness: Pos
    facing: Facing = "up"


class FlatPlateParams(_Strict):
    d: Pos | None = None
    w: Pos | None = None
    l: Pos | None = None  # noqa: E741 - the drawing's own name for the length
    thickness: Pos
    slope: float | None = Field(None, description="1:n; positive is cone-up, negative cone-down")

    @model_validator(mode="after")
    def _one_outline(self):
        if (self.d is None) == (self.w is None or self.l is None):
            raise ValueError("give either d, or both w and l")
        if self.slope is not None and (self.d is None or self.slope == 0):
            raise ValueError("slope needs a round plate (d) and a non-zero 1:n")
        return self


class BoxParams(_Strict):
    w: Pos
    l: Pos  # noqa: E741
    h: Pos


class NozzleParams(_Strict):
    dn: Pos
    od: Pos
    projection: Pos
    flange_od: Pos
    flange_t: Pos
    blind: bool = False


class PipeRunParams(_Strict):
    od: Pos
    points_mm: Annotated[list[Vec3], Field(min_length=2, max_length=200)]


class LatheParams(_Strict):
    profile_mm: Annotated[list[Pt2], Field(min_length=3, max_length=500)]
    sweep_deg: float = Field(360, gt=0, le=360)


class ExtrusionParams(_Strict):
    outline_mm: Annotated[list[Pt2], Field(min_length=3, max_length=500)]
    height: Pos


class SweepParams(_Strict):
    section: Literal["circle", "rect"]
    r: Pos | None = None
    w: Pos | None = None
    h: Pos | None = None
    path_mm: Annotated[list[Vec3], Field(min_length=2, max_length=500)]

    @model_validator(mode="after")
    def _section_size(self):
        if self.section == "circle" and self.r is None:
            raise ValueError("a circle section needs r")
        if self.section == "rect" and (self.w is None or self.h is None):
            raise ValueError("a rect section needs w and h")
        return self


SHAPE_PARAMS: dict[str, type[BaseModel]] = {
    "cylinder": CylinderParams,
    "cone": ConeParams,
    "head_torispherical": TorisphericalParams,
    "head_ellipsoidal": EllipsoidalParams,
    "head_hemispherical": HemisphericalParams,
    "flat_plate": FlatPlateParams,
    "box": BoxParams,
    "nozzle": NozzleParams,
    "pipe_run": PipeRunParams,
    "lathe": LatheParams,
    "extrusion": ExtrusionParams,
    "sweep": SweepParams,
}
Shape = Literal[
    "cylinder", "cone", "head_torispherical", "head_ellipsoidal", "head_hemispherical", "flat_plate",
    "box", "nozzle", "pipe_run", "lathe", "extrusion", "sweep",
]
SHELL_HOSTS = frozenset({"cylinder", "cone"})
HEAD_HOSTS = frozenset({"head_torispherical", "head_ellipsoidal", "head_hemispherical", "flat_plate"})


class Placement(_Strict):
    origin_mm: Vec3 = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    axis: Vec3 = Field(default_factory=lambda: [0.0, 1.0, 0.0])
    host: str | None = None
    bearing_deg: float | None = None
    elevation_mm: float | None = None
    e_mm: float | None = None
    n_mm: float | None = None

    @model_validator(mode="after")
    def _mounting(self):
        if sum(abs(c) for c in self.axis) == 0:
            raise ValueError("axis must not be zero")
        if self.host is None:
            return self
        shell = self.bearing_deg is not None or self.elevation_mm is not None
        head = self.e_mm is not None or self.n_mm is not None
        if shell == head:
            raise ValueError("a hosted part needs bearing_deg and elevation_mm, or e_mm and n_mm")
        if shell and (self.bearing_deg is None or self.elevation_mm is None):
            raise ValueError("a shell-mounted part needs both bearing_deg and elevation_mm")
        if head and (self.e_mm is None or self.n_mm is None):
            raise ValueError("a head-mounted part needs both e_mm and n_mm")
        return self


class Source(_Strict):
    kind: Literal["drawing", "cloud", "photo", "assumed"]
    id: str | None = None
    region: Annotated[list[Unit], Field(min_length=4, max_length=4)] | None = None
    note: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def _region_order(self):
        if self.region is not None:
            x0, y0, x1, y1 = self.region
            if x1 <= x0 or y1 <= y0:
                raise ValueError("region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0")
        if self.kind != "assumed" and not self.id:
            raise ValueError("a drawing, cloud or photo source needs its id")
        return self


class Part(_Strict):
    id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_.\-]{1,64}$")]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    group: Group
    shape: Shape
    params: dict[str, Any]
    placement: Placement = Field(default_factory=Placement)
    material: Material = "steel"
    source: Source
    confidence: Confidence = "medium"
    note: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def _params_match_shape(self):
        SHAPE_PARAMS[self.shape].model_validate(self.params)
        return self

    def typed_params(self) -> BaseModel:
        return SHAPE_PARAMS[self.shape].model_validate(self.params)


class AssetInfo(_Strict):
    tag: str | None = Field(None, max_length=80)
    type: str | None = Field(None, max_length=80)
    name: str | None = Field(None, max_length=120)
    frame_note: str | None = Field(None, max_length=500)
    plant_to_true_north_deg: float | None = None
    attributes: dict[str, str] = Field(default_factory=dict)


class AssetSpec(_Strict):
    asset: AssetInfo = Field(default_factory=AssetInfo)
    parts: Annotated[list[Part], Field(max_length=MAX_PARTS)] = Field(default_factory=list)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_spec.py -v`
Expected: PASS (8 tests, counting the parametrised cases)

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/__init__.py backend/app/asset_models/spec.py backend/tests/test_asset_model_spec.py
git commit -m "feat(asset-models): model spec with per-shape params

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shape builders (`shapes.py`)

**Files:**
- Create: `backend/app/asset_models/shapes.py`
- Test: `backend/tests/test_asset_model_shapes.py`

**Interfaces:**
- Consumes: the params models from Task 2.
- Produces:
  - `build_shape(shape: str, params: BaseModel) -> trimesh.Trimesh`: local frame, millimetres, axis +Y, base at y = 0. A `nozzle` points along +Y from y = 0.
  - `head_height(params) -> float` (mm, inner crown height above the tangent line)
  - `head_surface_y(params, r_mm) -> float` (outer surface height at radius r, for head-mounted parts)
  - `segments_for(radius_mm) -> int`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_shapes.py
"""Shape builders: bounds and volumes against hand-computed values (spec §6.2)."""

import math

import pytest

from app.asset_models import spec as s
from app.asset_models.shapes import build_shape, head_height, head_surface_y, segments_for

REL = 0.01  # tessellation keeps volumes within 1 %


def vol_annulus(ri, ro, h, sweep=360):
    return math.pi * (ro**2 - ri**2) * h * sweep / 360


def test_cylinder_shell_volume_and_bounds():
    m = build_shape("cylinder", s.CylinderParams(id=4000, thickness=8, height=3000))
    assert m.is_watertight
    assert m.volume == pytest.approx(vol_annulus(2000, 2008, 3000), rel=REL)
    lo, hi = m.bounds
    assert lo[1] == pytest.approx(0) and hi[1] == pytest.approx(3000)
    assert hi[0] == pytest.approx(2008, rel=1e-3)


def test_partial_sweep_halves_the_volume():
    full = build_shape("cylinder", s.CylinderParams(id=1000, thickness=10, height=100))
    half = build_shape("cylinder", s.CylinderParams(id=1000, thickness=10, height=100, sweep_deg=180))
    assert half.volume == pytest.approx(full.volume / 2, rel=REL)


def test_cone_frustum_volume():
    m = build_shape("cone", s.ConeParams(d_bottom=2000, d_top=1000, thickness=10, height=1000))
    # outer frustum minus inner frustum, inner radii reduced by the wall thickness
    def frustum(r1, r2, h):
        return math.pi * h * (r1**2 + r1 * r2 + r2**2) / 3
    expected = frustum(1000, 500, 1000) - frustum(990, 490, 1000)
    assert m.volume == pytest.approx(expected, rel=0.03)


def test_torispherical_head_height_matches_hcl_tank():
    p = s.TorisphericalParams(id=4000, thickness=8, crown_r=4000, knuckle_r=400)
    # crown centre 3224.9 mm below the tangent line -> crown height R - 3224.9 = 775.1 mm
    assert head_height(p) == pytest.approx(775.1, abs=0.5)
    m = build_shape("head_torispherical", p)
    assert m.is_watertight
    assert m.bounds[1][1] == pytest.approx(775.1 + 8, abs=2)
    assert head_surface_y(p, 0) == pytest.approx(775.1 + 8, abs=1)
    assert head_surface_y(p, 2008) == pytest.approx(0, abs=1)


def test_head_facing_down_mirrors():
    up = build_shape("head_ellipsoidal", s.EllipsoidalParams(id=2000, thickness=10))
    down = build_shape("head_ellipsoidal", s.EllipsoidalParams(id=2000, thickness=10, facing="down"))
    assert down.bounds[0][1] == pytest.approx(-up.bounds[1][1], abs=1e-6)
    assert down.volume == pytest.approx(up.volume, rel=1e-6)


def test_ellipsoidal_2_to_1_height_is_quarter_diameter():
    assert head_height(s.EllipsoidalParams(id=2000, thickness=10)) == pytest.approx(500)


def test_hemispherical_volume():
    m = build_shape("head_hemispherical", s.HemisphericalParams(id=1000, thickness=10))
    expected = 2 / 3 * math.pi * (510**3 - 500**3)
    assert m.volume == pytest.approx(expected, rel=REL)


def test_flat_plate_round_and_sloped():
    flat = build_shape("flat_plate", s.FlatPlateParams(d=4116, thickness=10))
    assert flat.volume == pytest.approx(math.pi * 2058**2 * 10, rel=REL)
    cone_up = build_shape("flat_plate", s.FlatPlateParams(d=4116, thickness=10, slope=120))
    assert cone_up.bounds[1][1] == pytest.approx(2058 / 120 + 10, abs=0.5)


def test_box_is_centred_on_axis_with_base_at_zero():
    m = build_shape("box", s.BoxParams(w=200, l=400, h=100))
    assert m.volume == pytest.approx(200 * 400 * 100)
    lo, hi = m.bounds
    assert lo.tolist() == pytest.approx([-100, 0, -200]) and hi.tolist() == pytest.approx([100, 100, 200])


def test_nozzle_runs_along_y_with_flange_at_the_end():
    m = build_shape("nozzle", s.NozzleParams(dn=50, od=60.3, projection=200, flange_od=165, flange_t=20))
    lo, hi = m.bounds
    assert lo[1] == pytest.approx(0) and hi[1] == pytest.approx(200)
    assert hi[0] == pytest.approx(82.5, rel=1e-2)


def test_pipe_run_spans_its_points():
    m = build_shape("pipe_run", s.PipeRunParams(od=84, points_mm=[[0, 0, 0], [0, 7000, 0], [500, 7000, 0]]))
    lo, hi = m.bounds
    assert hi[1] == pytest.approx(7042, abs=1)
    assert hi[0] == pytest.approx(542, abs=1)


def test_lathe_and_extrusion_and_sweep():
    lathe = build_shape("lathe", s.LatheParams(profile_mm=[[0, 0], [100, 0], [100, 50], [0, 50]]))
    assert lathe.volume == pytest.approx(math.pi * 100**2 * 50, rel=REL)
    ext = build_shape("extrusion", s.ExtrusionParams(outline_mm=[[0, 0], [100, 0], [100, 10], [0, 10]], height=500))
    assert ext.volume == pytest.approx(100 * 10 * 500)
    assert ext.bounds[1][1] == pytest.approx(500)
    sw = build_shape("sweep", s.SweepParams(section="circle", r=10, path_mm=[[0, 0, 0], [0, 0, 1000]]))
    assert sw.volume == pytest.approx(math.pi * 100 * 1000, rel=0.02)


def test_segment_count_follows_chord_tolerance():
    assert segments_for(5) == 16
    assert segments_for(2000) > segments_for(200)
    assert segments_for(1e6) == 256
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_shapes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.asset_models.shapes'`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/shapes.py
"""One mesh per shape (spec 2026-10-02 §6.2), in a local frame: millimetres, axis +Y, base at y = 0.

Rotationally symmetric shapes are a closed (r, y) profile revolved about Y, so they come out
watertight. Segment counts follow a 2 mm chord tolerance, capped, so a large shell stays light.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from shapely.geometry import Point, Polygon

from app.asset_models import spec as s

CHORD_TOL_MM = 2.0
MIN_SEG, MAX_SEG = 16, 256
HEAD_STEPS = 48  # profile samples along a head's meridian
# trimesh.creation.revolve spins about Z; this turns its +Z into our +Y (and its +Y into -Z).
_Z_TO_Y = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])


def segments_for(radius_mm: float) -> int:
    if radius_mm <= CHORD_TOL_MM:
        return MIN_SEG
    n = math.ceil(math.pi / math.acos(1 - CHORD_TOL_MM / radius_mm))
    return max(MIN_SEG, min(MAX_SEG, n))


def _revolve(profile_ry: list[tuple[float, float]], sweep_deg: float = 360.0) -> trimesh.Trimesh:
    """Revolve a closed (r, y) polygon about Y. The polygon is given open; it is closed here."""
    pts = np.asarray(profile_ry, dtype=float)
    if not np.allclose(pts[0], pts[-1]):
        pts = np.vstack([pts, pts[:1]])
    r_max = float(pts[:, 0].max())
    sections = max(4, round(segments_for(r_max) * sweep_deg / 360))
    angle = None if sweep_deg >= 360 else math.radians(sweep_deg)
    mesh = trimesh.creation.revolve(pts, angle=angle, sections=sections)
    mesh.apply_transform(_Z_TO_Y)
    mesh.fix_normals()
    return mesh


# ------------------------------------------------------------------ head profiles (inner surface)
def _head_profile(p) -> tuple[list[tuple[float, float]], float]:
    """(r, y) samples of a head's inner meridian from the axis (r = 0) to the tangent line (y = 0),
    and the crown height. The outer surface uses the same function on the thickened head."""
    a = p.id / 2
    if isinstance(p, s.TorisphericalParams):
        R, r = p.crown_r, p.knuckle_r
        ka = a - r  # knuckle centre radius
        yc = -math.sqrt(max((R - r) ** 2 - ka**2, 0.0))  # crown centre height
        sin_alpha = ka / (R - r)
        r_split = R * sin_alpha
        def y(x):
            if x <= r_split:
                return yc + math.sqrt(max(R**2 - x**2, 0.0))
            return math.sqrt(max(r**2 - (x - ka) ** 2, 0.0))
        h = yc + R
    elif isinstance(p, s.EllipsoidalParams):
        h = a / p.ratio
        def y(x):
            return h * math.sqrt(max(1 - (x / a) ** 2, 0.0))
    else:  # hemispherical
        h = a
        def y(x):
            return math.sqrt(max(a**2 - x**2, 0.0))
    xs = [a * math.sin(t) for t in np.linspace(0, math.pi / 2, HEAD_STEPS)]
    return [(x, y(x)) for x in xs], h


def _thickened(p):
    """The same head grown outward by its thickness (exact offset for spheres and tori)."""
    t = p.thickness
    if isinstance(p, s.TorisphericalParams):
        return p.model_copy(update={"id": p.id + 2 * t, "crown_r": p.crown_r + t, "knuckle_r": p.knuckle_r + t})
    if isinstance(p, s.EllipsoidalParams):
        # keep the outer height = inner height + t
        a_out = p.id / 2 + t
        h_out = p.id / 2 / p.ratio + t
        return p.model_copy(update={"id": 2 * a_out, "ratio": a_out / h_out})
    return p.model_copy(update={"id": p.id + 2 * t})


def head_height(p) -> float:
    return _head_profile(p)[1]


def head_surface_y(p, r_mm: float) -> float:
    """Outer surface height above the tangent line at radius r (for head-mounted parts)."""
    if isinstance(p, s.FlatPlateParams):
        rise = (p.d / 2 - min(r_mm, p.d / 2)) / p.slope if p.slope else 0.0
        return rise + p.thickness
    outer, _ = _head_profile(_thickened(p))
    rs = np.array([q[0] for q in outer])
    ys = np.array([q[1] for q in outer])
    y = float(np.interp(min(r_mm, rs[-1]), rs, ys))
    return -y if p.facing == "down" else y


def _head(p) -> trimesh.Trimesh:
    inner, _ = _head_profile(p)
    outer, _ = _head_profile(_thickened(p))
    # closed meridian: outer from axis to rim, then inner from rim back to axis
    poly = [(0.0, outer[0][1])] + outer[1:] + list(reversed(inner[1:])) + [(0.0, inner[0][1])]
    mesh = _revolve(poly)
    if p.facing == "down":
        mesh.apply_transform(np.diag([1, -1, 1, 1]))
        mesh.invert()
    return mesh


# ------------------------------------------------------------------ builders
def _cylinder(p: s.CylinderParams):
    ri, ro = p.id / 2, p.id / 2 + p.thickness
    return _revolve([(ri, 0), (ro, 0), (ro, p.height), (ri, p.height)], p.sweep_deg)


def _cone(p: s.ConeParams):
    rb, rt, t = p.d_bottom / 2, p.d_top / 2, p.thickness
    return _revolve([(max(rb - t, 0), 0), (rb, 0), (rt, p.height), (max(rt - t, 0), p.height)])


def _flat_plate(p: s.FlatPlateParams):
    if p.d is None:
        return _box(s.BoxParams(w=p.w, l=p.l, h=p.thickness))
    R = p.d / 2
    rise = R / p.slope if p.slope else 0.0  # cone-up: the centre is higher than the rim
    return _revolve([(0, rise), (R, 0), (R, p.thickness), (0, rise + p.thickness)])


def _box(p: s.BoxParams):
    m = trimesh.creation.box(extents=[p.w, p.h, p.l])
    m.apply_translation([0, p.h / 2, 0])
    return m


def _nozzle(p: s.NozzleParams):
    wall = max(3.0, p.od * 0.05)
    ro, ri = p.od / 2, max(p.od / 2 - wall, 0.5)
    neck_h = p.projection - p.flange_t
    pieces = [_revolve([(ri, 0), (ro, 0), (ro, neck_h), (ri, neck_h)])]
    fo = p.flange_od / 2
    inner = 0.0 if p.blind else ri
    pieces.append(_revolve([(inner, neck_h), (fo, neck_h), (fo, p.projection), (inner, p.projection)]))
    return trimesh.util.concatenate(pieces)


def _pipe_run(p: s.PipeRunParams):
    r = p.od / 2
    pts = np.asarray(p.points_mm, dtype=float)
    seg = segments_for(r)
    pieces = [
        trimesh.creation.cylinder(radius=r, segment=[a, b], sections=seg)
        for a, b in zip(pts[:-1], pts[1:])
        if np.linalg.norm(b - a) > 1e-6
    ]
    for q in pts:  # joints and ends
        ball = trimesh.creation.icosphere(subdivisions=2, radius=r)
        ball.apply_translation(q)
        pieces.append(ball)
    return trimesh.util.concatenate(pieces)


def _lathe(p: s.LatheParams):
    return _revolve([tuple(q) for q in p.profile_mm], p.sweep_deg)


def _extrusion(p: s.ExtrusionParams):
    # outline is in plan (x north, z east); extrude_polygon builds along +Z from a polygon in XY
    m = trimesh.creation.extrude_polygon(Polygon(p.outline_mm), p.height)
    m.apply_transform(_Z_TO_Y)
    return m


def _sweep(p: s.SweepParams):
    if p.section == "circle":
        section = Point(0, 0).buffer(p.r, quad_segs=max(4, segments_for(p.r) // 4))
    else:
        section = Polygon([(-p.w / 2, -p.h / 2), (p.w / 2, -p.h / 2), (p.w / 2, p.h / 2), (-p.w / 2, p.h / 2)])
    return trimesh.creation.sweep_polygon(section, np.asarray(p.path_mm, dtype=float))


_BUILDERS = {
    "cylinder": _cylinder,
    "cone": _cone,
    "head_torispherical": _head,
    "head_ellipsoidal": _head,
    "head_hemispherical": _head,
    "flat_plate": _flat_plate,
    "box": _box,
    "nozzle": _nozzle,
    "pipe_run": _pipe_run,
    "lathe": _lathe,
    "extrusion": _extrusion,
    "sweep": _sweep,
}


def build_shape(shape: str, params) -> trimesh.Trimesh:
    return _BUILDERS[shape](params)
```

Two notes for the implementer:
- If `trimesh.creation.revolve` or `sweep_polygon` in the pinned trimesh has a different keyword (check with `inspect.signature`), adapt the call. Don't change the tests: they pin the geometry, not the call.
- `_extrusion`'s outline is in plan, and the tests pin the volume and the +Y height only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_shapes.py -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/shapes.py backend/tests/test_asset_model_shapes.py
git commit -m "feat(asset-models): shape builders for the spec vocabulary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Placement and validation (`placement.py`, `validate.py`)

**Files:**
- Create: `backend/app/asset_models/placement.py`
- Create: `backend/app/asset_models/validate.py`
- Test: `backend/tests/test_asset_model_placement.py`, `backend/tests/test_asset_model_validate.py`

**Interfaces:**
- Consumes: `AssetSpec`, `Part`, `SHELL_HOSTS`, `HEAD_HOSTS` (Task 2); `head_surface_y`, `build_shape` (Task 3).
- Produces:
  - `bearing_dir(bearing_deg) -> np.ndarray` (unit (3,))
  - `part_transform(part: Part, parts_by_id: dict[str, Part]) -> np.ndarray` (4×4, millimetres)
  - `PlacementError(Exception)`
  - `validate(spec: AssetSpec) -> Report`, with `Report.errors: list[Issue]`, `Report.warnings: list[Issue]`, `Report.ok: bool`, and `Issue(code: str, part_id: str | None, message: str)`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_placement.py
"""Placement in the asset frame (spec §6.2): bearing 0 = +X (plant north), 90 = +Z (plant east)."""

import numpy as np
import pytest

from app.asset_models.placement import PlacementError, bearing_dir, part_transform
from app.asset_models.spec import Part


def P(**kw):
    base = {"name": kw.get("id", "p"), "group": "Other", "material": "steel",
            "source": {"kind": "assumed"}}
    base.update(kw)
    return Part.model_validate(base)


SHELL = P(id="shell", group="Shell", shape="cylinder", params={"id": 4000, "thickness": 8, "height": 3000})
HEAD = P(id="roof", group="Head", shape="head_torispherical",
         params={"id": 4000, "thickness": 8, "crown_r": 4000, "knuckle_r": 400},
         placement={"origin_mm": [0, 8000, 0]})


def apply(T, p):
    return (T @ np.r_[p, 1.0])[:3]


def test_bearings():
    assert bearing_dir(0) == pytest.approx([1, 0, 0])
    assert bearing_dir(90) == pytest.approx([0, 0, 1], abs=1e-12)


def test_free_part_is_translated_and_aimed_along_its_axis():
    p = P(id="b", shape="box", params={"w": 10, "l": 10, "h": 100},
          placement={"origin_mm": [5, 6, 7], "axis": [1, 0, 0]})
    T = part_transform(p, {})
    assert apply(T, [0, 0, 0]) == pytest.approx([5, 6, 7])
    assert apply(T, [0, 100, 0]) == pytest.approx([105, 6, 7])


def test_shell_nozzle_sits_on_the_outer_wall_pointing_out():
    n = P(id="N7", group="Nozzle", shape="nozzle",
          params={"dn": 80, "od": 88.9, "projection": 200, "flange_od": 200, "flange_t": 20},
          placement={"host": "shell", "bearing_deg": 90, "elevation_mm": 1500})
    T = part_transform(n, {"shell": SHELL})
    assert apply(T, [0, 0, 0]) == pytest.approx([0, 1500, 2008], abs=1e-6)
    assert apply(T, [0, 200, 0]) == pytest.approx([0, 1500, 2208], abs=1e-6)


def test_head_nozzle_sits_on_the_head_surface_pointing_up():
    n = P(id="N9", group="Nozzle", shape="nozzle",
          params={"dn": 100, "od": 114.3, "projection": 150, "flange_od": 230, "flange_t": 22},
          placement={"host": "roof", "e_mm": 0, "n_mm": 0})
    T = part_transform(n, {"roof": HEAD})
    base = apply(T, [0, 0, 0])
    assert base == pytest.approx([0, 8000 + 775.1 + 8, 0], abs=1.5)
    assert apply(T, [0, 150, 0])[1] == pytest.approx(base[1] + 150)


def test_unknown_host_and_wrong_host_kind_raise():
    n = P(id="N1", shape="nozzle", params={"dn": 50, "od": 60, "projection": 100, "flange_od": 150, "flange_t": 18},
          placement={"host": "nope", "bearing_deg": 0, "elevation_mm": 100})
    with pytest.raises(PlacementError, match="nope"):
        part_transform(n, {})
    box = P(id="bx", shape="box", params={"w": 1, "l": 1, "h": 1})
    with pytest.raises(PlacementError, match="not a shell"):
        part_transform(n.model_copy(update={"placement": n.placement.model_copy(update={"host": "bx"})}), {"bx": box})
```

```python
# backend/tests/test_asset_model_validate.py
"""Spec validation (spec §6.3): errors block the GLB, warnings don't."""

from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate


def part(pid, **kw):
    base = {"id": pid, "name": pid, "group": "Shell", "shape": "cylinder",
            "params": {"id": 4000, "thickness": 8, "height": 3000}, "source": {"kind": "drawing", "id": "d1"}}
    base.update(kw)
    return base


def codes(issues):
    return sorted(i.code for i in issues)


def test_clean_spec_is_ok():
    r = validate(AssetSpec.model_validate({"parts": [part("s1")]}))
    assert r.ok and r.errors == [] and r.warnings == []


def test_duplicate_ids_and_missing_host_are_errors():
    spec = AssetSpec.model_validate({"parts": [
        part("s1"), part("s1"),
        part("N1", group="Nozzle", shape="nozzle",
             params={"dn": 50, "od": 60, "projection": 100, "flange_od": 150, "flange_t": 18},
             placement={"host": "ghost", "bearing_deg": 0, "elevation_mm": 100}),
    ]})
    r = validate(spec)
    assert not r.ok
    assert codes(r.errors) == ["duplicate_id", "host_missing"]


def test_thickness_not_below_radius_is_an_error():
    r = validate(AssetSpec.model_validate({"parts": [part("s1", params={"id": 10, "thickness": 6, "height": 10})]}))
    assert codes(r.errors) == ["bad_geometry"]


def test_overlap_and_assumed_high_confidence_are_warnings():
    spec = AssetSpec.model_validate({"parts": [
        part("s1"), part("s2"),
        part("x", group="Other", shape="box", params={"w": 1, "l": 1, "h": 1},
             source={"kind": "assumed"}, confidence="high", placement={"origin_mm": [9000, 0, 0]}),
    ]})
    r = validate(spec)
    assert r.ok
    assert codes(r.warnings) == ["assumed_high_confidence", "overlap"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_placement.py tests/test_asset_model_validate.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/placement.py
"""Part transforms in the asset frame (spec 2026-10-02 §6.2). Millimetres.

A free part is moved to `origin_mm` with its local +Y turned onto `axis`. A shell-mounted part sits
on its host's outer wall at (bearing, elevation), pointing radially out. A head-mounted part sits on
the head's outer surface at plant (e, n), pointing along the head's facing.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh

from app.asset_models.shapes import head_surface_y
from app.asset_models.spec import HEAD_HOSTS, SHELL_HOSTS, Part

UP = np.array([0.0, 1.0, 0.0])


class PlacementError(Exception):
    pass


def bearing_dir(bearing_deg: float) -> np.ndarray:
    a = math.radians(bearing_deg)
    return np.array([math.cos(a), 0.0, math.sin(a)])


def _aim(axis, origin) -> np.ndarray:
    axis = np.asarray(axis, dtype=float)
    axis = axis / np.linalg.norm(axis)
    T = np.eye(4)
    if not np.allclose(axis, UP):
        if np.allclose(axis, -UP):
            T = trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0])
        else:
            T = trimesh.geometry.align_vectors(UP, axis)
    T[:3, 3] = origin
    return T


def _shell_radius(host: Part, y_local: float) -> float:
    p = host.typed_params()
    if host.shape == "cylinder":
        return p.id / 2 + p.thickness
    t = min(max(y_local / p.height, 0.0), 1.0)  # cone: outer radius by height
    return p.d_bottom / 2 + (p.d_top / 2 - p.d_bottom / 2) * t


def part_transform(part: Part, parts_by_id: dict[str, Part]) -> np.ndarray:
    pl = part.placement
    if pl.host is None:
        return _aim(pl.axis, pl.origin_mm)
    host = parts_by_id.get(pl.host)
    if host is None:
        raise PlacementError(f"host {pl.host!r} is not a part of this model")
    hy = host.placement.origin_mm[1]
    if pl.bearing_deg is not None:
        if host.shape not in SHELL_HOSTS:
            raise PlacementError(f"host {pl.host!r} is not a shell (cylinder or cone)")
        d = bearing_dir(pl.bearing_deg)
        r = _shell_radius(host, pl.elevation_mm - hy)
        centre = np.array([host.placement.origin_mm[0], 0.0, host.placement.origin_mm[2]])
        origin = centre + d * r + np.array([0.0, pl.elevation_mm, 0.0])
        return _aim(d, origin)
    if host.shape not in HEAD_HOSTS:
        raise PlacementError(f"host {pl.host!r} is not a head or plate")
    hp = host.typed_params()
    r = math.hypot(pl.e_mm, pl.n_mm)
    y = hy + head_surface_y(hp, r)
    origin = np.array([host.placement.origin_mm[0] + pl.n_mm, y, host.placement.origin_mm[2] + pl.e_mm])
    facing_down = getattr(hp, "facing", "up") == "down"
    return _aim(-UP if facing_down else UP, origin)
```

```python
# backend/app/asset_models/validate.py
"""Spec validation (spec 2026-10-02 §6.3). Errors block the GLB; warnings are shown, not enforced."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from app.asset_models.placement import PlacementError, part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.spec import AssetSpec

OVERLAP_SHARE = 0.5
OFF_SURFACE_MM = 20.0


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
        if counts[part.id] == 1:
            mesh = build_shape(part.shape, part.typed_params())
            mesh.apply_transform(T)
            boxes[part.id] = (mesh.bounds[0], mesh.bounds[1])
        if part.source.kind == "assumed" and part.confidence == "high":
            report.warnings.append(Issue("assumed_high_confidence", part.id, "an assumed part is marked high confidence"))
    ids = sorted(boxes)
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            share = _overlap_share(boxes[a], boxes[b])
            if share > OVERLAP_SHARE:
                report.warnings.append(Issue("overlap", a, f"{a!r} and {b!r} overlap by {share:.0%} (a duplicate?)"))
    return report


def _overlap_share(a, b) -> float:
    lo = np.maximum(a[0], b[0])
    hi = np.minimum(a[1], b[1])
    if np.any(hi <= lo):
        return 0.0
    inter = float(np.prod(hi - lo))
    smaller = min(float(np.prod(a[1] - a[0])), float(np.prod(b[1] - b[0])))
    return inter / smaller if smaller > 0 else 0.0
```

The overlap check is O(n²) in parts. At `MAX_PARTS` = 2000 that's 2 million box tests in numpy-free Python: about 2 s. That's acceptable for a validation that runs on writes. If profiling shows otherwise, sort by min-x and sweep.

The "nozzle base > 20 mm off its host surface" warning (spec §6.3) can't trigger with this placement: hosted parts are always placed exactly on the surface. It only applies to free parts that the agent puts near a wall by hand, which `compare_to_cloud` covers better. The spec (§13) already records it as dropped.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_placement.py tests/test_asset_model_validate.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/placement.py backend/app/asset_models/validate.py backend/tests/test_asset_model_placement.py backend/tests/test_asset_model_validate.py
git commit -m "feat(asset-models): part placement in the asset frame and spec validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: GLB builder (`build.py`)

**Files:**
- Create: `backend/app/asset_models/build.py`
- Test: `backend/tests/test_asset_model_build.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `build_meshes(spec: AssetSpec) -> dict[str, trimesh.Trimesh]`: metres, asset frame, keyed by part id, in spec order. Raises `SpecInvalid(report)` when `validate(spec)` has errors.
  - `build_glb(spec: AssetSpec) -> tuple[bytes, dict]`: GLB bytes and `meta`.
  - `inject_node_extras(glb: bytes, extras_by_node: dict[str, dict]) -> bytes`
  - `class SpecInvalid(Exception)`, with `.report: Report`
  - `meta = {"bounds_m": [[x,y,z],[x,y,z]], "top_m": float, "triangles": int, "parts": [{"id","name","group","triangles"}]}`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_build.py
"""Spec -> meshes (metres) -> GLB with per-node extras (spec §6.4)."""

import io
import json
import struct

import pytest
import trimesh

from app.asset_models.build import SpecInvalid, build_glb, build_meshes, inject_node_extras
from app.asset_models.spec import AssetSpec

SPEC = AssetSpec.model_validate({
    "asset": {"tag": "T-1"},
    "parts": [
        {"id": "shell", "name": "Shell", "group": "Shell", "shape": "cylinder", "material": "paint",
         "params": {"id": 4000, "thickness": 8, "height": 8000}, "source": {"kind": "drawing", "id": "d"}},
        {"id": "N7", "name": "Nozzle N7", "group": "Nozzle", "shape": "nozzle", "material": "steel",
         "params": {"dn": 80, "od": 88.9, "projection": 200, "flange_od": 200, "flange_t": 20},
         "placement": {"host": "shell", "bearing_deg": 270, "elevation_mm": 7780},
         "source": {"kind": "drawing", "id": "d"}},
    ],
})


def glb_json(glb: bytes) -> dict:
    magic, _version, _length = struct.unpack_from("<4sII", glb, 0)
    assert magic == b"glTF"
    clen, ctype = struct.unpack_from("<I4s", glb, 12)
    assert ctype == b"JSON"
    return json.loads(glb[20 : 20 + clen])


def test_meshes_are_in_metres_in_the_asset_frame():
    meshes = build_meshes(SPEC)
    assert list(meshes) == ["shell", "N7"]
    assert meshes["shell"].bounds[1][1] == pytest.approx(8.0)
    n7 = meshes["N7"].bounds
    assert n7[0][2] == pytest.approx(-2.208, abs=1e-3)   # bearing 270 = -Z (plant west)
    assert n7[1][1] == pytest.approx(7.78 + 0.1, abs=1e-3)


def test_invalid_spec_raises_with_the_report():
    bad = SPEC.model_copy(update={"parts": [SPEC.parts[1]]})  # nozzle without its host
    with pytest.raises(SpecInvalid) as e:
        build_meshes(bad)
    assert e.value.report.errors[0].code == "host_missing"


def test_glb_has_one_named_node_per_part_with_extras():
    glb, meta = build_glb(SPEC)
    doc = glb_json(glb)
    nodes = {n["name"]: n for n in doc["nodes"] if "name" in n}
    assert set(nodes) >= {"shell", "N7"}
    assert nodes["N7"]["extras"] == {"name": "Nozzle N7", "group": "Nozzle", "shape": "nozzle",
                                     "params": SPEC.parts[1].params}
    assert meta["top_m"] == pytest.approx(8.0)
    assert [p["id"] for p in meta["parts"]] == ["shell", "N7"]
    assert meta["triangles"] == sum(p["triangles"] for p in meta["parts"])


def test_glb_loads_back_in_trimesh():
    glb, _ = build_glb(SPEC)
    scene = trimesh.load(io.BytesIO(glb), file_type="glb")
    assert len(scene.geometry) == 2


def test_build_is_deterministic():
    assert build_glb(SPEC)[0] == build_glb(SPEC)[0]


def test_inject_keeps_the_binary_chunk_and_4_byte_alignment():
    glb, _ = build_glb(SPEC)
    out = inject_node_extras(glb, {"shell": {"k": "v" * 7}})
    assert len(out) % 4 == 0
    assert struct.unpack_from("<I", out, 8)[0] == len(out)
    shell = next(n for n in glb_json(out)["nodes"] if n.get("name") == "shell")
    assert shell["extras"] == {"k": "v" * 7}
    assert out.endswith(glb[-64:])  # the BIN chunk's tail is untouched
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_build.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.asset_models.build'`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/build.py
"""Spec -> meshes (metres, asset frame) -> GLB (spec 2026-10-02 §6.4). Pure and deterministic.

One glTF node per part, named by part id. trimesh's exporter does not write per-node extras, so
`inject_node_extras` patches the GLB's JSON chunk afterwards.
"""

from __future__ import annotations

import json
import struct

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

from app.asset_models.placement import part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import Report, validate

MM = 0.001


class SpecInvalid(Exception):
    def __init__(self, report: Report):
        super().__init__("the model spec has errors")
        self.report = report


def _lin(c: float) -> float:
    # colours are authored in sRGB; glTF baseColorFactor is linear
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _mat(name, rgb, metal, rough):
    return PBRMaterial(name=name, baseColorFactor=[*[_lin(c) for c in rgb], 1.0], metallicFactor=metal,
                       roughnessFactor=rough, doubleSided=True)


MATERIALS = {
    "paint": _mat("Paint", [0.78, 0.79, 0.80], 0.1, 0.6),
    "steel": _mat("Steel", [0.62, 0.64, 0.66], 0.6, 0.4),
    "rubber": _mat("Rubber", [0.17, 0.17, 0.18], 0.0, 0.8),
    "concrete": _mat("Concrete", [0.60, 0.59, 0.56], 0.0, 0.9),
    "grating": _mat("Grating", [0.45, 0.47, 0.50], 0.5, 0.5),
    "galvanised": _mat("Galvanised", [0.70, 0.72, 0.74], 0.7, 0.35),
    "glass": _mat("Glass", [0.75, 0.85, 0.90], 0.0, 0.1),
    "other": _mat("Other", [0.55, 0.55, 0.58], 0.2, 0.6),
}


def build_meshes(spec: AssetSpec) -> dict[str, trimesh.Trimesh]:
    report = validate(spec)
    if not report.ok:
        raise SpecInvalid(report)
    by_id = {p.id: p for p in spec.parts}
    out: dict[str, trimesh.Trimesh] = {}
    for part in spec.parts:
        mesh = build_shape(part.shape, part.typed_params())
        mesh.apply_transform(part_transform(part, by_id))
        mesh.apply_scale(MM)
        out[part.id] = mesh
    return out


def build_glb(spec: AssetSpec) -> tuple[bytes, dict]:
    meshes = build_meshes(spec)
    scene = trimesh.Scene()
    parts_meta = []
    for part in spec.parts:
        mesh = meshes[part.id].copy()
        mesh.visual = trimesh.visual.TextureVisuals(material=MATERIALS[part.material])
        scene.add_geometry(mesh, node_name=part.id, geom_name=part.id)
        parts_meta.append({"id": part.id, "name": part.name, "group": part.group, "triangles": int(len(mesh.faces))})
    glb = scene.export(file_type="glb")
    extras = {p.id: {"name": p.name, "group": p.group, "shape": p.shape, "params": p.params} for p in spec.parts}
    glb = inject_node_extras(glb, extras)
    if meshes:
        lo = np.min([m.bounds[0] for m in meshes.values()], axis=0)
        hi = np.max([m.bounds[1] for m in meshes.values()], axis=0)
    else:
        lo = hi = np.zeros(3)
    meta = {
        "bounds_m": [np.round(lo, 4).tolist(), np.round(hi, 4).tolist()],
        "top_m": round(float(hi[1]), 4),
        "triangles": sum(p["triangles"] for p in parts_meta),
        "parts": parts_meta,
    }
    return glb, meta


def inject_node_extras(glb: bytes, extras_by_node: dict[str, dict]) -> bytes:
    magic, version, _ = struct.unpack_from("<4sII", glb, 0)
    if magic != b"glTF":
        raise ValueError("not a GLB")
    clen, ctype = struct.unpack_from("<I4s", glb, 12)
    if ctype != b"JSON":
        raise ValueError("the first GLB chunk is not JSON")
    doc = json.loads(glb[20 : 20 + clen])
    for node in doc.get("nodes", []):
        extra = extras_by_node.get(node.get("name"))
        if extra is not None:
            node["extras"] = extra
    body = json.dumps(doc, separators=(",", ":"), sort_keys=True).encode("utf-8")
    body += b" " * (-len(body) % 4)
    rest = glb[20 + clen :]
    total = 12 + 8 + len(body) + len(rest)
    return struct.pack("<4sII", magic, version, total) + struct.pack("<I4s", len(body), b"JSON") + body + rest
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_build.py -v`
Expected: PASS (6 tests). If `test_build_is_deterministic` fails because trimesh embeds a timestamp or random UUID, strip it in `inject_node_extras` (e.g. drop `asset.generator` extras) and say so in the commit message. Never weaken the test.

- [ ] **Step 5: Run the whole U1 suite plus ruff**

Run: `$PY -m pytest tests/test_asset_model_*.py -v; $PY -m ruff check app/asset_models tests; $PY -m ruff format --check app/asset_models tests`
Expected: all pass, ruff clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/build.py backend/tests/test_asset_model_build.py
git commit -m "feat(asset-models): GLB builder with per-node extras

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Frozen-build self-test and landing

**Files:**
- Create: `backend/app/asset_models/selftest.py`
- Modify: `backend/app/__main__.py` (add the `asset-models-selftest` branch next to `drawings-selftest`, and name it in the module docstring)
- Modify: `backend/scripts/smoke_frozen.ps1` (a step after "drawings")
- Test: `backend/tests/test_asset_model_selftest.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_model_selftest.py
from app.asset_models.selftest import main


def test_selftest_builds_a_glb(capsys):
    assert main() == 0
    assert capsys.readouterr().out.strip().startswith("asset-models ok ")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$PY -m pytest tests/test_asset_model_selftest.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/selftest.py
"""`kestrel-backend.exe asset-models-selftest`: proves the frozen bundle carries trimesh's revolve,
extrusion (mapbox-earcut) and GLB exporter. Builds a two-part spec and prints its triangle count."""

from __future__ import annotations


def main() -> int:
    from app.asset_models.build import build_glb
    from app.asset_models.spec import AssetSpec

    spec = AssetSpec.model_validate({"parts": [
        {"id": "s", "name": "s", "group": "Shell", "shape": "cylinder",
         "params": {"id": 1000, "thickness": 10, "height": 1000}, "source": {"kind": "assumed"}},
        {"id": "e", "name": "e", "group": "Other", "shape": "extrusion",
         "params": {"outline_mm": [[0, 0], [100, 0], [100, 10]], "height": 50}, "source": {"kind": "assumed"}},
    ]})
    glb, meta = build_glb(spec)
    print(f"asset-models ok {meta['triangles']} {len(glb)}")
    return 0
```

In `backend/app/__main__.py`, next to the other self-tests:

```python
    if len(argv) > 1 and argv[1] == "asset-models-selftest":
        from app.asset_models.selftest import main as asset_models_selftest

        return asset_models_selftest()
```

In `backend/scripts/smoke_frozen.ps1`, after the "drawings" step:

```powershell
# trimesh + mapbox-earcut + the GLB exporter inside the bundle (plan 2026-10-02-asset-model-u1 Task 6).
$am = & $exe asset-models-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $am -notmatch "asset-models ok \d+ \d+") { throw "asset-models selftest failed: $am" }
Write-Host ($am.Trim().Split("`n")[-1])
Complete-Step "asset-models"
```

- [ ] **Step 4: Run the test, then build and smoke the frozen sidecar**

Run: `$PY -m pytest tests/test_asset_model_selftest.py -v`, then:

```powershell
backend\scripts\build.ps1
backend\scripts\smoke_frozen.ps1
```

Expected: the test passes, and the smoke prints `asset-models ok <n> <bytes>`. If the frozen app reports a missing `trimesh` module or resource, add it to `kestrel_backend.spec` with a comment, then rebuild and re-smoke.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/selftest.py backend/app/__main__.py backend/scripts/smoke_frozen.ps1 backend/tests/test_asset_model_selftest.py
git commit -m "test(asset-models): frozen-bundle self-test for trimesh and GLB export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Install the new pins into the shared venv (additive)**

```powershell
& $PY -m pip list --format=freeze > $env:TEMP\before.txt
& $PY -m pip install --no-deps "trimesh==<pinned>" "mapbox-earcut==<pinned>"
& $PY -m pip list --format=freeze > $env:TEMP\after.txt
Compare-Object (Get-Content $env:TEMP\before.txt) (Get-Content $env:TEMP\after.txt)
```

Expected: exactly the two new packages appear. Use the versions pinned in `requirements-lock.txt` in Task 1.

- [ ] **Step 7: Gate and merge**

Run `scripts\finish-task.ps1` from the worktree. Expected: the gate passes, the branch fast-forwards into `main`, and the worktree and branch are removed. If finish-task fails on PowerShell 5.1 (memory: nested-unit-controllers), run the gate commands by hand, then merge with `git merge --ff-only task/am-u1` from the main checkout, remove the worktree junction-safely, and delete the branch.
