# Plant model B3: building, civil and environment builders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fifteen app-code builders (building, substation, analyzer_house, shelter, gate, road, paved, laydown, parking, trench, channel, basin, wall, fence, revetment) plus the environment meshes (land, sea, road, paved, laydown, slope, revetment) that turn a plant spec's items and environment features into trimesh geometry at or above the Cowork detail level.

**Architecture:**
- Three family modules in F0's builder package, `backend/app/asset_models/builders/`:
  - `civil.py` holds the ten civil builders and the B3 footprint and mesh helpers. Those are outline from footprint, prism, surface, bar, stations, instancing and defaults recording.
  - `building.py` holds the five building-family builders. It imports the helpers from `civil.py`.
  - `environment.py` holds `build_env` and `build_environment`. Environment meshes are in the scene frame.
- Builders register through F0's `@builder` decorator. They are pure, deterministic functions from `(Item, BuildCtx)` to `list[MeshNode]`.
- Repeated parts are `Instanced`: fence posts, gate posts and pickets, shelter columns, road dashes and parking stall lines.
- Tests pin each builder for:
  - bounds, triangle ranges and instance counts;
  - concave footprints and defaults recording;
  - determinism and golden raster renders (M1's `raster.render`);
  - the Cowork realism floor, using a committed per-node fixture extracted from the Cowork GLB.

**Tech Stack:** Python 3.11, trimesh 4.12.2 (`extrude_polygon`, `triangulate_polygon(engine="earcut")`, mapbox-earcut 1.0.3, already in the frozen bundle per `selftest.py`), shapely 2.1.2 (`make_valid`, `orient`, `buffer`, `minimum_rotated_rectangle`), numpy, pydantic v2, pytest, Pillow. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§5 EnvFeature, §6 builder catalogue and realism floor, §7 budget, §13 B1–B3 gate tests, §15 amendments). Index: `docs/superpowers/plans/2026-10-03-plant-model.md` (Global Constraints and Binding interfaces are law).

**Unit:** B3.
- Worktree `.claude/worktrees/pm-b3`, branch `task/pm-b3`.
- **Cut after F0** (merged on `main`).
- **Merge position:** batch 2, any order among B1/B2/B3/A1/I1/C1/K1/S1. B3 touches no file another unit owns, so it never conflicts on merge. A1's `other` fallback covers B3 types until B3 lands.

## Global Constraints

Copied from the index. Every task's requirements include these.

- `contract/openapi.yaml` is the source of truth; B3 makes **no contract change** (item `type` is a free string; the catalogue route publishes `catalogue()` live).
- **Builders are pure:** no DB, no I/O, deterministic for the same item. A builder may raise. `build_item` (F0) catches the error and falls back to `other` with a `builder_fallback` flag. One bad item never fails the GLB.
- **Item-local frame:**
  - metres, Y up from `base_el`, x = plant north, z = plant east;
  - origin at `footprint_ref`;
  - builders rotate by `rot_deg` themselves (B3 does this through `footprint_polygon`).
- **Scene/GLB frame:** metres, `x = plant_N`, `y = EL - datum.el_m`, `z = plant_E`.
- Materials come only from Cowork's 34-name `PALETTE`.
- Repeated elements (posts, columns, pickets, dashes, stall lines) are **instanced** (`Instanced(mesh, transforms (N,4,4))`).
- **No meshopt compression in G1** (§15). Instancing is the size lever.
- **Budget:**
  - a 2 000-item plant builds in under 2 minutes and under 1.5 GB of RAM (A1's job);
  - Al-Zour triangles are at most 1.5 × Cowork's (spec §7).
- Never install anything into the shared venv. No unit adds Python packages.
- Interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`.
- Stage files by path; never `git add -A`; never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identity "Danijel Jovanovic" / info@synapse-solutions.ai.
- Full suites run only in the unit's final gate.

## Interfaces consumed (F0, exact names from the index)

```python
# app/asset_models/spec.py
class Item(_Strict): id; tag; name; type; area; footprint: Footprint; base_el: float | None; top_el: float | None; levels; params: dict[str, Any]; height_source; source; confidence; flags; parts; notes
class RectFootprint: kind="rect"; center: Pt2; size: tuple[Pos, Pos]; rot_deg: float = 0   # size = (along, across); along at rot_deg clockwise from plant north
class CircleFootprint: kind="circle"; center: Pt2; d: Pos
class PolygonFootprint: kind="polygon"; pts: list[Pt2]          # 3..500, plant [E, N]
class LineFootprint: kind="line"; pts: list[Pt2]; width: Pos    # 2..500
class ItemFlag: code: FlagCode; value; note
EnvKind = Literal["land", "sea", "road", "paved", "laydown", "slope", "revetment"]
class EnvFeature(_Strict): id: ItemId; kind: EnvKind; pts: list[Pt2]; el: float; source: Source; confidence = "medium"
class SiteFrame(_Strict): crs: SiteCrs; origin_crs: tuple[float, float]; plant_north_deg: float; datum: Datum = Datum(); cloud_z_to_el: CloudDatum | None = None; source: Source

# app/asset_models/siteframe.py
class PlantGrid: __init__(frame: SiteFrame); plant_to_scene(e, n, el) -> np.ndarray  # (..., 3): x=N, y=EL-datum, z=E
def footprint_ref(fp: Footprint) -> tuple[float, float]
def footprint_polygon(fp: Footprint) -> np.ndarray   # (k, 2) plant [E, N], closed ring not repeated

# app/asset_models/builders/base.py
@dataclass(frozen=True) class Instanced: mesh: trimesh.Trimesh; transforms: np.ndarray   # (N, 4, 4)
@dataclass class MeshNode: name: str; material: str; geometry: trimesh.Trimesh | Instanced; extras: dict = field(default_factory=dict)
@dataclass(frozen=True) class BuildCtx: grid: PlantGrid | None; lod: float = 1.0
    def local(self, item, e, n) -> np.ndarray           # plant [E,N] → item-local [x, z]
    def height(self, item, default_m) -> tuple[float, float, bool]   # (base_el, top_el, defaulted)
REGISTRY: dict[str, BuilderDef]     # BuilderDef(type, family, params, fn, doc, default_height_m)
def builder(type, *, family, params, doc, default_height_m) -> Callable
def build_item(item, ctx) -> tuple[list[MeshNode], list[ItemFlag]]

# app/asset_models/builders/__init__.py
def load_all() -> None              # imports builders.structure, .equipment, .building, .civil, .environment if present

# app/asset_models/builders/palette.py
PALETTE: dict[str, tuple[tuple[float, float, float, float], float, float]]

# app/asset_models/raster.py (M1, on main)
@dataclass(frozen=True) class View: kind; bearing_deg=None; direction=None
def render(meshes: dict[str, trimesh.Trimesh], view, *, size=1024, labels=False, groups=None, highlight=None) -> PIL.Image
```

F0's `builders/geom.py` helpers (`extrude`, `box`, `beam`, …) are **not** used. B3's own `prism`/`bar` pin the frame and winding with their own tests (see Rulings).

## Interfaces provided

```python
# app/asset_models/builders/civil.py  (registered types: road, paved, laydown, parking, trench, channel, basin, wall, fence, revetment; family "civil")
MAX_INSTANCES: int = 5000
LIFT: dict[str, float]      # surface top above base_el per flat material: Asphalt .15, Paving .12, Laydown .10, Rock_Armour .06, Slope .08
SLAB_T: float = 0.4
class B3Params(BaseModel)   # extra="forbid", allow_inf_nan=False; base of every B3 params model
def clean_line(pts) -> np.ndarray
def is_closed(pts) -> bool
def largest_polygon(geom) -> shapely.Polygon
def local_line(item: Item, ctx: BuildCtx) -> np.ndarray          # (k, 2) item-local x, z
def outline(item: Item, ctx: BuildCtx) -> shapely.Polygon        # item-local x, z; line footprints buffered by width
def prism(poly, y0: float, y1: float) -> trimesh.Trimesh
def surface(poly, y: float) -> trimesh.Trimesh
def flat_slab(poly, material: str) -> trimesh.Trimesh
def yaw(dx: float, dz: float) -> np.ndarray                      # 4x4
def bar(p0, p1, y0: float, y1: float, t: float) -> trimesh.Trimesh
def unit_box(w: float, h: float, d: float) -> trimesh.Trimesh
def xform(x, y, z, dx=1.0, dz=0.0) -> np.ndarray
def stations(pts, spacing: float, lod: float) -> np.ndarray      # (n, 4): x, z, dx, dz
def dashes(pts, dash: float, gap: float, lod: float) -> np.ndarray
def instanced(mesh, rows, y: float = 0.0) -> Instanced
def merge(meshes) -> trimesh.Trimesh
def axes(poly) -> tuple[np.ndarray, np.ndarray, np.ndarray, float, float]
def defaults_of(p: BaseModel, height_defaulted: bool = False) -> list[str]
def record(nodes: list[MeshNode], p: BaseModel, height_defaulted: bool = False) -> list[MeshNode]
# params: RoadParams, SurfaceParams, ParkingParams, WallParams, FenceParams, TrenchParams, ChannelParams, BasinParams

# app/asset_models/builders/building.py  (registered types: building, substation, analyzer_house, shelter, gate; family "building")
# params: HouseParams, SubstationParams, AnalyzerHouseParams, ShelterParams, GateParams
def house(poly, h: float, p: HouseParams, lod: float) -> list[MeshNode]

# app/asset_models/builders/environment.py
LAND_DEPTH_M = 8.0; SEA_TOE_M = 2.5; ARMOUR_RUN = 1.1
def build_env(feature: EnvFeature, ctx: BuildCtx, *, sea_el: float | None = None) -> list[MeshNode]   # never raises
def build_environment(features: list[EnvFeature], ctx: BuildCtx) -> list[MeshNode]                  # what A1 should call
```

**Conventions A1 relies on:**
- **Defaults.** A defaulted value is recorded on the **first** node of an item: `nodes[0].extras["defaults"]` is the sorted list of param names that were not given. `"height"` is appended last when `ctx.height` defaulted. A1 writes it to the CSV `notes`.
- **Child node names.** Item child names are short and unique per item: `walls`, `roof`, `glazing`, `doors`, `hvac`, `plinth`, `slab`, `columns`, `beams`, `posts`, `frame`, `pickets`, `rails`, `mesh`, `surface`, `markings`, `stalls`, `wall`, `coping`, `floor`, `body`, `cover`, `water`.
- **Environment nodes:**
  - The node name is the feature id. A land feature also has `<id>-edge`, its armour skirt.
  - The meshes are in the **scene frame**. A1 adds them under `environment/` with an identity transform.
  - `extras` is `{"env": kind, "id": feature.id}`. The sea node carries `{"env": "sea"}` and material `"Sea"`; the Site 3D view swaps it for its water shader.

## Budget

- **Background jobs:** none of B3's own. Builders run inside A1's `asset_model_glb` job; they never run on a request path.
- **Bounded work:**
  - Instances per node are capped at `MAX_INSTANCES = 5000`. Spacing grows past the cap, so a 100 km fence still makes at most 5 001 posts.
  - Builders read only the item they are given. They do no I/O and never touch an image set or a point cloud.
  - Measured on the Cowork fixture (266 B3 nodes): 0.75 s to build, 52 k triangles against Cowork's 40.6 k (1.29×, under the 1.5× cap).
- **The fixture script** reads the Cowork GLB's JSON chunk and position accessors once. It is a one-off developer step, not app code.

## Execution DAG

```
T1 align F0 ─ T2 Cowork fixture ─ T3 civil helpers ─┬─ T4 flat surfaces ─┐
                                                    ├─ T5 wall/fence ────┤
                                                    ├─ T6 trench/basin ──┼─ T10 realism + determinism ─ T11 gate
                                                    ├─ T7 houses ─ T8 shelter/gate ┤
                                                    └─ T9 environment ───┘
```

- **Independent after T3:** T4, T5, T6, T7→T8 and T9. They touch disjoint sections of `civil.py`, `building.py` and `environment.py`, but T4–T6 all append to `civil.py` and `test_builders_civil.py`. Run them in sequence in one worktree; parallel is fine only with care over the shared files.
- **Critical path:** T1 → T2 → T3 → T7 → T8 → T10 → T11.

## Shared-file touches

None. Every file B3 adds is its own:
- `builders/civil.py`, `builders/building.py`, `builders/environment.py`;
- `scripts/extract_cowork_b3.py`;
- `tests/plant_b3_helpers.py`, `tests/test_builders_{civil,building,environment}.py`;
- `tests/data/plant/cowork_nodes/b3_nodes.json`, `tests/data/plant/golden/b3/*.png`.

F0 owns `builders/__init__.py` (whose `load_all()` already imports `building`, `civil` and `environment` when present), `base.py` and `palette.py`. B3 does not edit them. If T1 finds `load_all()` missing a B3 module name, that is an F0 defect: log it as a ruling and hand it off. Do not edit `__init__.py`.

## Tests

Added:
- `backend/tests/plant_b3_helpers.py` (a helper module, imported as `from plant_b3_helpers import ...`, the same pattern as `drawings_helpers.py`);
- `backend/tests/test_builders_civil.py`;
- `backend/tests/test_builders_building.py`;
- `backend/tests/test_builders_environment.py`.

Data:
- `backend/tests/data/plant/cowork_nodes/b3_nodes.json`;
- 16 PNGs under `backend/tests/data/plant/golden/b3/`.

No existing test changes.

## Rulings

1. **Defaults recording.** The index says defaults are recorded but names no mechanism. B3 writes `nodes[0].extras["defaults"]` (see Interfaces provided).
   - If F0's `build_item` already records defaults, T1 keeps the B3 assertions and points `record()` at F0's mechanism.
2. **Environment frame.** Environment meshes are in the scene frame, not item-local, because an EnvFeature has no footprint ref. With `ctx.grid` they use `grid.plant_to_scene`. Without one, x = N, y = EL, z = E (datum 0).
3. **`build_env` takes a keyword-only `sea_el`.** The binding signature `build_env(feature, ctx)` still works. `build_environment(features, ctx)` passes the lowest sea feature's `el`, so land skirts reach `SEA_TOE_M` = 2.5 m below the water. Cowork's skirt toe is at −9 against a sea at −6.44.
   - Without a sea, the skirt drops `LAND_DEPTH_M` = 8 m.
   - The skirt runs 1.1 m out per metre of drop, as Cowork's does (10 m out over 9 m).
   - A1 should call `build_environment`. This goes to the coordinator for A1.
4. **Environment kinds are not in `REGISTRY`.** Their names collide with the civil types. `catalogue()` therefore lists item types only.
5. **Environment `pts` is always a polygon ring** (at least 3 distinct points). An environment road is its outline, not a centreline.
   - A degenerate feature (fewer than 3 distinct points, collinear, or no area) returns `[]`. There is no flag channel for environment features, and a broken feature never fails the GLB.
6. **Flat items ignore height.** These are road, paved, laydown, parking and revetment, all `default_height_m = 0`. Each is a 0.4 m slab whose top sits a per-material lift above `base_el`, so overlapping surfaces never z-fight: Asphalt +0.15, Paving +0.12, Laydown +0.10, Rock_Armour +0.06, Slope +0.08. This matches Cowork's −0.3…+0.2 slabs.
7. **Self-intersecting footprints are repaired.** `make_valid` runs and the largest polygon is kept, so the item still builds. `validate()` (F0/A1) still reports the polygon as an error.
   - A zero-length line, or a polygon with no area, raises inside the builder, so it falls back to `other`.
8. **Revetment item** = a flat rock-armour slab, as in Cowork. The sloped shore belongs to the environment `land` skirt.
9. **Trench, channel and basin:** `base_el` is the invert (the bottom) and `top_el` is grade. This matches Cowork (basin 30-TC-03: base 97, h 3).
   - A basin's walls stand `kerb_h` (0.3 m) above grade.
   - A channel narrower than two wall thicknesses becomes one solid body with no water.
10. **A fence on a polygon, rect or circle footprint** follows the outline ring. **A gate on a non-line footprint** spans its long axis.
11. **B3's shared helpers live in `civil.py`** ("families may add helpers in their own module only"). `building.py` and `environment.py` import them. Nothing else should.
12. **Cowork fixture.** It is committed as derived data only: per-node footprint, `base_el`, `top_el`, triangle count, materials and extent, plus the land and mainland rings converted to plant E/N. No Cowork meshes are committed. This is the same class of data as K1's committed `kipic_register.csv`.
    - Cowork `obb` footprints become 4-point polygons. The rotation sense is picked to match the mesh extent.
    - Ids are slugged to `^[A-Za-z0-9_.\-]{1,64}$`.
13. **Realism floor metric.**
    - Every Cowork B3 node builds without fallback, and its material set is a subset of ours.
    - For each type, our summed triangle count is at least 0.8 × Cowork's.
    - The B3 family total is at most 1.5 × Cowork's. Measured: 1.29×.
    - Environment meshes are judged on materials and geometry, not triangles. Cowork's rock skirt carries 3–4 k triangles of relief; ours is a clean slope.
14. **Above-Cowork detail by default:**
    - parking stall lines (Cowork has a bare slab);
    - a door on every house;
    - an HVAC unit on analyzer houses;
    - braces and pickets on gates;
    - a coping on walls.
    Road centre dashes are off by default, as in Cowork. `markings: true` turns them on.
15. **Shelter column grid.** The grid follows the footprint's minimum rotated rectangle, and only columns inside the footprint are kept. Eaves and cross beams span the rectangle, because shelters are rectangular in practice: all 12 Cowork shelters are rects.
16. **House roof stack on low buildings.** When `h` is smaller than plinth + roof + parapet + 0.5 m, the three are scaled down together so the walls keep 0.5 m. The builder does not fail.
17. **LOD.**
    - Instance spacing divides by `ctx.lod`. This covers fence posts, pickets, shelter bays and dashes. Parking stall count multiplies by `lod`.
    - Glazing is dropped below `lod` 0.5.

## Deviations (code or index vs spec)

- Spec §6 says `BuildCtx` gives "the palette, the level of detail and a triangle budget". The index's `BuildCtx` has `grid` and `lod` only. B3 follows the index, imports `PALETTE` directly, and caps instances with `MAX_INSTANCES`.
- Spec §6/§13 call the Cowork fixtures "reference renders … at `backend/tests/data/plant/cowork_nodes/`". B3 commits per-node stats and footprints there (`b3_nodes.json`) plus its own golden renders under `golden/b3/`, not Cowork renders: rendering Cowork's meshes would require committing them.
- Spec §5 says item `parts` live in "the item's local mm frame". That is F0/A1's concern. B3 builders ignore `item.parts` (A1 places them).

## Review Focus

The five inputs most likely to bite the operator that no happy-path test reaches. Each line names the test that pins it.

1. **Concave footprints.** L, U and notched buildings, yards, basins and coastlines must not fill their notches. Pinned by `test_prism_of_a_concave_outline_is_closed_and_exact` and `test_flat_surfaces_cover_a_concave_footprint` (civil), `test_concave_building_keeps_its_notch` (building), and `test_concave_land_is_not_filled_in` (environment).
2. **Digitised lines with repeated or closing points.** A fence drawn as a closed ring with first point = last, or with doubled clicks, must give one post per station, no doubled corner and no NaN transform. Pinned by `test_closed_fence_ring_does_not_double_the_corner_post` and `test_fence_with_repeated_points_builds_without_nan` (civil).
3. **Broken geometry in one item.** A zero-length road falls back with a flag rather than raising. A bow-tie polygon builds after repair. An environment feature with too few points yields nothing. Pinned by `test_zero_length_road_falls_back_instead_of_raising` and `test_bow_tie_paved_area_still_builds` (civil), and `test_degenerate_features_yield_nothing_instead_of_raising` (environment).
4. **Low or tiny structures from indicative heights.** A 1 m "building", a gate line shorter than its posts, or a shelter too low for its roof must shrink or fall back, never produce inverted geometry. Pinned by `test_a_low_building_shrinks_its_roof_stack_instead_of_failing`, `test_a_gate_shorter_than_its_posts_falls_back` and `test_too_low_shelter_falls_back` (building).
5. **Very long linear items.** A site-perimeter fence or a 10 km road must stay inside the instance cap and the family triangle budget. Pinned by `test_stations_open_closed_lod_and_cap` (civil) and `test_realism_floor_and_family_budget_against_cowork` (civil).

---

### Task 1: Align with merged F0

**Files:**
- Create: `backend/tests/plant_b3_helpers.py`
- Create: `backend/tests/test_builders_civil.py`
- Read (do not edit): `backend/app/asset_models/builders/__init__.py`, `base.py`, `palette.py`, `geom.py`; `backend/app/asset_models/siteframe.py`; `backend/app/asset_models/spec.py`

**Interfaces:**
- Consumes: every F0 name in "Interfaces consumed" above.
- Produces: the test helpers every later task uses: `make_item`, `build_ok`, `by_name`, `tri_count`, `expand`, `bounds`, `materials`, `same_geometry`, `assert_golden`, `cowork`, `cowork_item`, `CTX`.

- [ ] **Step 1: Check out the worktree and read F0's real code**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b3
git rev-parse --abbrev-ref HEAD   # expect task/pm-b3
git log --oneline -1 main
```

Read the files listed above. Check each assumption in this table against F0's code. Where the code differs, adapt **only** the B3 call sites named in the right-hand column, and keep every assertion.

| Assumption (index) | Check in F0 code | If it differs |
| --- | --- | --- |
| `BuildCtx.local(item, e, n)` returns an array reshapeable to `(k, 2)` of `[x = N − ref_N, z = E − ref_E]` | `base.py` | In `civil.local_line` and `civil.outline` (Task 3), replace `.reshape(-1, 2)` with the conversion that yields `(k, 2)` |
| `BuildCtx.height(item, default)` returns `(base_el, top_el, defaulted)`, and `top_el = base_el + default` when `item.top_el is None` | `base.py` | In `test_f0_interfaces_b3_relies_on`, keep the `(100.0, 103.0, True)` expectation for `base_el=100`. If F0 returns something else for that input, stop and report to the coordinator |
| `footprint_polygon(rect)` is a `(4, 2)` ring, not closed | `siteframe.py` | `civil.outline` already drops a repeated closing point via `clean_line` plus `Polygon`; no change |
| `build_item` returns `flags` containing `ItemFlag(code="builder_fallback")` when the builder raises | `base.py` | Tests only read `flags`; no change |
| F0 records defaulted params itself | grep `defaults` in `base.py` | If yes, make `civil.record` write the same key F0 uses, and keep the tests' `extras["defaults"]` assertions by reading that key |
| `load_all()` exists in `app.asset_models.builders` and imports `building`, `civil`, `environment` | `__init__.py` | If missing, import the three modules explicitly in `plant_b3_helpers.py` and log an F0 defect under Rulings |
| `PlantGrid(frame: SiteFrame)`, `SiteFrame` in `spec.py` | `siteframe.py`, `spec.py` | Adjust the `FRAME` construction in Task 9 only |
| `PALETTE` holds the 34 Cowork names | `palette.py` | No change; the test below pins the 18 B3 uses |

- [ ] **Step 2: Write the test helpers**

Create `backend/tests/plant_b3_helpers.py`:

```python
"""Shared helpers for the B3 builder tests (building, civil, environment)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

from app.asset_models.builders import load_all
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, build_item
from app.asset_models.raster import View, render
from app.asset_models.spec import Item

load_all()
DATA = Path(__file__).parent / "data" / "plant"
GOLDEN = DATA / "golden" / "b3"
COWORK = DATA / "cowork_nodes" / "b3_nodes.json"
REGEN = os.environ.get("KESTREL_REGEN_GOLDEN") == "1"
CTX = BuildCtx(grid=None)
# raster.render colours by M1 part group; map our materials onto distinct ones for the goldens
MAT_GROUP = {
    "Glass": "Nozzle",
    "Building_Roof": "Head",
    "Shelter_Roof": "Head",
    "Steel_Dark": "Lining",
    "Steel_Structure": "Support",
    "Fence": "Access",
    "Grating": "Access",
    "Water_Pit": "Internal",
    "Concrete_Dark": "Bottom",
    "Paving": "Manway",
}


def make_item(
    type_: str,
    footprint: dict,
    *,
    base_el: float = 100.0,
    top_el: float | None = None,
    params: dict | None = None,
    id_: str = "it-1",
) -> Item:
    return Item.model_validate(
        {
            "id": id_,
            "name": id_,
            "type": type_,
            "footprint": footprint,
            "base_el": base_el,
            "top_el": top_el,
            "params": params or {},
            "source": {"kind": "assumed"},
        }
    )


def build_ok(item: Item, ctx: BuildCtx = CTX) -> list[MeshNode]:
    """Build through the registry and insist the builder itself succeeded (no fallback)."""
    nodes, flags = build_item(item, ctx)
    assert not [f for f in flags if f.code == "builder_fallback"], flags
    assert nodes
    return nodes


def by_name(nodes: list[MeshNode]) -> dict[str, MeshNode]:
    return {n.name: n for n in nodes}


def tri_count(nodes: list[MeshNode]) -> int:
    total = 0
    for n in nodes:
        g = n.geometry
        total += len(g.mesh.faces) * len(g.transforms) if isinstance(g, Instanced) else len(g.faces)
    return total


def expand(nodes: list[MeshNode]) -> dict[str, trimesh.Trimesh]:
    out = {}
    for n in nodes:
        g = n.geometry
        if isinstance(g, Instanced):
            out[n.name] = trimesh.util.concatenate([g.mesh.copy().apply_transform(t) for t in g.transforms])
        else:
            out[n.name] = g
    return out


def bounds(nodes: list[MeshNode]) -> np.ndarray:
    b = np.array([m.bounds for m in expand(nodes).values()])
    return np.array([b[:, 0].min(axis=0), b[:, 1].max(axis=0)])


def materials(nodes: list[MeshNode]) -> set[str]:
    return {n.material for n in nodes}


def same_geometry(a: list[MeshNode], b: list[MeshNode]) -> bool:
    if [(n.name, n.material) for n in a] != [(n.name, n.material) for n in b]:
        return False
    for x, y in zip(a, b, strict=True):
        gx, gy = x.geometry, y.geometry
        if isinstance(gx, Instanced):
            if not (
                np.array_equal(gx.transforms, gy.transforms)
                and np.array_equal(gx.mesh.vertices, gy.mesh.vertices)
            ):
                return False
        elif not (np.array_equal(gx.vertices, gy.vertices) and np.array_equal(gx.faces, gy.faces)):
            return False
    return True


def assert_golden(nodes: list[MeshNode], name: str, view: str = "iso") -> None:
    """Render with the M1 rasterizer and compare with the committed PNG (KESTREL_REGEN_GOLDEN=1 rewrites)."""
    groups = {n.name: MAT_GROUP.get(n.material, "Shell") for n in nodes}
    img = render(expand(nodes), View(view), size=256, groups=groups)
    path = GOLDEN / f"{name}_{view}.png"
    if REGEN:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
    assert path.exists(), f"missing golden {path.name}; run with KESTREL_REGEN_GOLDEN=1 and look at it"
    golden = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    diff = np.abs(np.asarray(img, dtype=np.int16) - golden)
    assert (diff > 40).mean() < 0.01  # under 1 % of pixels differ visibly


def cowork() -> dict:
    return json.loads(COWORK.read_text())


def cowork_item(node: dict) -> Item:
    return make_item(
        node["type"], node["footprint"], base_el=node["base_el"], top_el=node["top_el"], id_=node["id"]
    )
```

- [ ] **Step 3: Write the F0 alignment test**

Create `backend/tests/test_builders_civil.py`. Later tasks append to it and add names to its import block. Keep the import block sorted; `ruff check --fix` sorts it.

```python
"""Civil builders (plant model spec 2026-10-03 §6, unit B3): road, paved, laydown, parking, trench,
channel, basin, wall, fence, revetment, and the B3 footprint helpers in `builders/civil.py`."""

from __future__ import annotations

import numpy as np
import pytest
from plant_b3_helpers import CTX, make_item

from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon, footprint_ref

E0, N0 = 500.0, 300.0
RECT = {"kind": "rect", "center": [E0, N0], "size": [20.0, 10.0], "rot_deg": 0}  # 20 along north
L_POLY = {
    "kind": "polygon",
    "pts": [
        [E0, N0],
        [E0 + 30, N0],
        [E0 + 30, N0 + 10],
        [E0 + 10, N0 + 10],
        [E0 + 10, N0 + 25],
        [E0, N0 + 25],
    ],
}  # concave, area 450
ROAD = {"kind": "line", "pts": [[E0, N0], [E0 + 100, N0], [E0 + 100, N0 + 50]], "width": 8.0}
FENCE_30 = {"kind": "line", "pts": [[E0, N0], [E0 + 30, N0]], "width": 0.1}
FENCE_RING = {
    "kind": "line",
    "pts": [[E0, N0], [E0 + 10, N0], [E0 + 10, N0 + 20], [E0, N0 + 20], [E0, N0]],
    "width": 0.1,
}
CIVIL = ["road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"]
B3_MATERIALS = {
    "Concrete",
    "Concrete_Dark",
    "Steel_Structure",
    "Steel_Dark",
    "Grating",
    "Building_Wall",
    "Building_Roof",
    "Shelter_Roof",
    "Glass",
    "Ground",
    "Asphalt",
    "Paving",
    "Laydown",
    "Rock_Armour",
    "Slope",
    "Water_Pit",
    "Sea",
    "Fence",
}
SAMPLE = {  # one representative item per civil type, for determinism and goldens
    "road": (ROAD, None, {"markings": True}),
    "paved": (L_POLY, None, {}),
    "laydown": (RECT, None, {}),
    "parking": ({"kind": "rect", "center": [E0, N0], "size": [60.0, 5.5], "rot_deg": 0}, None, {}),
    "trench": (
        {"kind": "line", "pts": [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 10]], "width": 1.2},
        101.0,
        {},
    ),
    "channel": (
        {"kind": "line", "pts": [[E0, N0], [E0 + 10, N0], [E0 + 10, N0 - 18]], "width": 1.9},
        102.0,
        {},
    ),
    "basin": (L_POLY, 103.0, {}),
    "wall": ({"kind": "line", "pts": [[E0, N0], [E0 + 40, N0], [E0 + 40, N0 + 30]], "width": 0.7}, 103.0, {}),
    "fence": (FENCE_RING, 102.5, {}),
    "revetment": (
        {
            "kind": "polygon",
            "pts": [
                [E0, N0],
                [E0 + 80, N0],
                [E0 + 120, N0 + 20],
                [E0 + 120, N0 + 26],
                [E0 + 78, N0 + 6],
                [E0, N0 + 6],
            ],
        },
        None,
        {},
    ),
}


def sample(type_: str):
    fp, top, params = SAMPLE[type_]
    return make_item(type_, fp, top_el=top, params=params)


# ------------------------------------------------------------------ F0 interfaces B3 relies on
def test_f0_interfaces_b3_relies_on():
    item = make_item("paved", RECT)
    e, n = footprint_ref(item.footprint)
    assert (e, n) == pytest.approx((E0, N0))
    loc = np.asarray(CTX.local(item, np.array([E0 + 1.0]), np.array([N0 + 2.0]))).reshape(-1, 2)
    assert loc[0] == pytest.approx([2.0, 1.0])  # x = north, z = east
    ring = np.asarray(footprint_polygon(item.footprint))
    assert ring.shape == (4, 2)
    base, top, defaulted = CTX.height(make_item("wall", RECT, top_el=None), 3.0)
    assert (base, top, defaulted) == (100.0, 103.0, True)
    assert B3_MATERIALS <= set(PALETTE)
```

- [ ] **Step 4: Run it**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b3\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Expected: `1 passed`. This test pins F0. If it fails, apply the table in Step 1 before going on; do not weaken it.

- [ ] **Step 5: Commit**

```powershell
git add backend/tests/plant_b3_helpers.py backend/tests/test_builders_civil.py
git commit -m "test(plant-b3): helpers and F0 interface pin for the B3 builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cowork reference fixture

**Files:**
- Create: `backend/scripts/extract_cowork_b3.py`
- Create (generated): `backend/tests/data/plant/cowork_nodes/b3_nodes.json`
- Modify: `backend/tests/test_builders_civil.py` (append)

**Interfaces:**
- Consumes: the Cowork GLB and `landmask.json` in `E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic\` (git-ignored, read-only).
- Produces: `b3_nodes.json` with this shape:
  ```
  {source,
   nodes: [{id, type, footprint (spec Footprint dict), base_el, top_el|null, tris, materials[], extent[3]}],
   terrain: {Sea|Land_Platform|Mainland: {tris, materials, y_min, y_max}},
   landmask: {land: [[[E, N], …]], main: [[[E, N], …]]}}
  ```

- [ ] **Step 1: Write the failing test** (append to `test_builders_civil.py`; add `import math` and `cowork, cowork_item` to the imports)

```python
def test_cowork_fixture_footprints_are_valid():
    nodes = cowork()["nodes"]
    assert len(nodes) == 266
    for node in nodes:
        poly = footprint_polygon(cowork_item(node).footprint)
        assert np.isfinite(np.asarray(poly)).all()
        assert not math.isnan(node["base_el"])
```

- [ ] **Step 2: Run it to see it fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py::test_cowork_fixture_footprints_are_valid -v
```

Expected: FAIL with `FileNotFoundError` (`b3_nodes.json`).

- [ ] **Step 3: Write the extraction script**

Create `backend/scripts/extract_cowork_b3.py`:

```python
"""Extract the Cowork reference nodes for the B3 builder families (plant model spec §6 realism floor).

Usage (from backend/):
    .venv/Scripts/python.exe scripts/extract_cowork_b3.py <KIPIC_AlZour_LNG_Plant.glb> <landmask.json>

Writes tests/data/plant/cowork_nodes/b3_nodes.json: for every Cowork node of a B3 type that has a
mesh, its footprint in the plant spec's Footprint form, base_el, h, triangle count, materials and
mesh extent; plus the land/mainland rings (plant E/N) and the Cowork terrain stats. Reads only the
GLB's JSON chunk and index accessor counts; the GLB itself stays out of git.
"""

from __future__ import annotations

import json
import math
import re
import struct
import sys
from pathlib import Path

import numpy as np

B3_TYPES = [
    "building",
    "substation",
    "analyzer_house",
    "shelter",
    "gate",
    "road",
    "paved",
    "laydown",
    "parking",
    "trench",
    "channel",
    "basin",
    "wall",
    "fence",
    "revetment",
]
OUT = Path(__file__).resolve().parents[1] / "tests" / "data" / "plant" / "cowork_nodes" / "b3_nodes.json"
# Cowork scene frame: x = plant E - 1300, y = EL - 100, z = -(plant N - 450)
CX, CZ = 1300.0, 450.0


def _read(glb_path: Path):
    b = glb_path.read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    gltf = json.loads(b[20 : 20 + n])
    return b, 20 + n + 8, gltf


def _positions(b, off, g, acc_i):
    a = g["accessors"][acc_i]
    bv = g["bufferViews"][a["bufferView"]]
    start = off + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(b, dtype="<f4", count=a["count"] * 3, offset=start).reshape(-1, 3)


def _footprint(fp: dict, ext_en: tuple[float, float]) -> dict:
    t = fp["t"]
    if t == "poly":
        return {"kind": "polygon", "pts": [[round(e, 3), round(n, 3)] for e, n in fp["pts"]]}
    if t == "rect":
        return {
            "kind": "rect",
            "center": [round((fp["E0"] + fp["E1"]) / 2, 3), round((fp["N0"] + fp["N1"]) / 2, 3)],
            "size": [round(fp["N1"] - fp["N0"], 3), round(fp["E1"] - fp["E0"], 3)],
            "rot_deg": 0,
        }
    if t == "circ":
        return {"kind": "circle", "center": [fp["E"], fp["N"]], "d": round(2 * fp["R"], 3)}
    if t == "line":
        return {
            "kind": "line",
            "pts": [[round(e, 3), round(n, 3)] for e, n in fp["pts"]],
            "width": fp.get("w") or 0.2,
        }
    if t == "obb":  # L along an axis at `rot` from plant east; pick the sense that matches the mesh
        best = None
        for sense in (1.0, -1.0):
            r = math.radians(sense * fp["rot"])
            a = np.array([math.cos(r), math.sin(r)])
            c = np.array([-a[1], a[0]])
            ctr = np.array([fp["E"], fp["N"]])
            pts = [
                ctr + sa * a * fp["L"] / 2 + sc * c * fp["W"] / 2
                for sa, sc in ((-1, -1), (1, -1), (1, 1), (-1, 1))
            ]
            ext = np.ptp(np.array(pts), axis=0)
            err = abs(ext[0] - ext_en[0]) + abs(ext[1] - ext_en[1])
            if best is None or err < best[0]:
                best = (err, pts)
        return {"kind": "polygon", "pts": [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in best[1]]}
    raise ValueError(f"unknown Cowork footprint {t!r}")


def main(glb_path: str, landmask_path: str) -> int:
    b, off, g = _read(Path(glb_path))
    mats = [m["name"] for m in g["materials"]]
    nodes = []
    terrain = {}
    for node in g["nodes"]:
        ex = node.get("extras", {})
        if "mesh" not in node:
            continue
        prims = g["meshes"][node["mesh"]]["primitives"]
        tris = sum(g["accessors"][p["indices"]]["count"] // 3 for p in prims)
        pos = np.vstack([_positions(b, off, g, p["attributes"]["POSITION"]) for p in prims])
        ext = np.ptp(pos, axis=0)
        used = sorted({mats[p["material"]] for p in prims})
        if node.get("name") in ("Sea", "Land_Platform", "Mainland"):
            terrain[node["name"]] = {
                "tris": tris,
                "materials": used,
                "y_min": float(pos[:, 1].min()),
                "y_max": float(pos[:, 1].max()),
            }
            continue
        if ex.get("type") not in B3_TYPES or "footprint" not in ex:
            continue
        h = float(ex.get("h") or 0.0)
        base = float(ex["base_el"])
        nodes.append(
            {
                "id": re.sub(r"[^A-Za-z0-9_.-]", "-", ex["id"])[:64],
                "type": ex["type"],
                "footprint": _footprint(ex["footprint"], (float(ext[0]), float(ext[2]))),
                "base_el": base,
                "top_el": round(base + h, 3) if h > 0 else None,
                "tris": tris,
                "materials": used,
                "extent": [round(float(x), 2) for x in ext],
            }
        )
    lm = json.loads(Path(landmask_path).read_text())
    rings = {
        k: [[[round(x + CX, 3), round(CZ - z, 3)] for x, z in ring] for ring in lm[k]]
        for k in ("land", "main")
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "Cowork KIPIC_AlZour_LNG_Plant.glb (B3 types) + landmask.json",
                "nodes": nodes,
                "terrain": terrain,
                "landmask": rings,
            },
            indent=1,
        )
    )
    print(f"wrote {len(nodes)} nodes to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]))
```

- [ ] **Step 4: Run it and confirm the output is tracked by git**

```powershell
$K = "E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic"
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe scripts/extract_cowork_b3.py "$K\KIPIC_AlZour_LNG_Plant.glb" "$K\landmask.json"
git check-ignore -v tests/data/plant/cowork_nodes/b3_nodes.json   # expect no output (not ignored)
```

Expected: `wrote 266 nodes to ...b3_nodes.json` (about 160 KB). By type: road 71, paved 42, laydown 28, trench 23, fence 21, building 13, basin 13, shelter 12, parking 11, wall 11, revetment 7, gate 6, substation 4, analyzer_house 3, channel 1.

`terrain` holds:
- `Sea`: 12 tris, `[Sea]`;
- `Land_Platform`: 4102 tris, `[Ground, Rock_Armour]`, y −9…0;
- `Mainland`: 3140 tris, `[Ground_Mainland, Rock_Armour]`.

If `git check-ignore` prints a rule, a `.gitignore` line covers `tests/data/plant/`. Stop and report it to the coordinator. Do not edit `.gitignore`.

- [ ] **Step 5: Run the test to see it pass**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Expected: `2 passed`.

- [ ] **Step 6: Commit**

```powershell
git add backend/scripts/extract_cowork_b3.py backend/tests/data/plant/cowork_nodes/b3_nodes.json backend/tests/test_builders_civil.py
git commit -m "test(plant-b3): Cowork reference nodes for the building, civil and terrain realism floor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Civil module scaffold and the B3 geometry helpers

**Files:**
- Create: `backend/app/asset_models/builders/civil.py`
- Modify: `backend/tests/test_builders_civil.py` (append)

**Interfaces:**
- Consumes: `BuildCtx`, `Instanced`, `MeshNode` (base); `footprint_polygon` (siteframe); `Item` (spec).
- Produces (exact):
  - `clean_line`, `is_closed`, `largest_polygon`, `local_line`, `outline`;
  - `prism`, `surface`, `flat_slab`, `yaw`, `bar`, `unit_box`, `xform`;
  - `stations`, `dashes`, `instanced`, `merge`, `defaults_of`, `record`;
  - `B3Params`, `LIFT`, `SLAB_T`, `MAX_INSTANCES`, `MIN_SEG_M`.
  
  Signatures are in "Interfaces provided".

- [ ] **Step 1: Write the failing tests** (append; add `from shapely.geometry import Polygon` and `from app.asset_models.builders import civil` to the imports)

```python
# ------------------------------------------------------------------ helpers
def test_clean_line_drops_repeated_points():
    pts = civil.clean_line(np.array([[0, 0], [0, 0], [10, 0], [10, 0.0005], [20, 0]]))
    assert pts.tolist() == [[0, 0], [10, 0], [20, 0]]


def test_clean_line_rejects_non_finite():
    with pytest.raises(ValueError, match="non-finite"):
        civil.clean_line(np.array([[0, 0], [np.nan, 1]]))


def test_stations_open_closed_lod_and_cap():
    line = np.array([[0.0, 0.0], [30.0, 0.0]])
    assert len(civil.stations(line, 3.0, 1.0)) == 11  # both ends
    ring = np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 20.0], [0.0, 20.0], [0.0, 0.0]])
    assert len(civil.stations(ring, 3.0, 1.0)) == 4 + 7 + 4 + 7  # closing corner not doubled
    assert len(civil.stations(line, 3.0, 0.5)) == 6  # half the detail: 6 m spacing
    long = np.array([[0.0, 0.0], [100_000.0, 0.0]])
    assert len(civil.stations(long, 3.0, 1.0)) <= civil.MAX_INSTANCES + 1


def test_yaw_turns_x_onto_the_plan_direction():
    d = np.array([3.0, 4.0]) / 5.0
    v = civil.yaw(d[0], d[1]) @ np.array([1.0, 0.0, 0.0, 1.0])
    assert v[[0, 2]] == pytest.approx(d)
    assert v[1] == pytest.approx(0.0)


def test_prism_of_a_concave_outline_is_closed_and_exact():
    poly = Polygon([(0, 0), (10, 0), (10, 30), (0, 30), (0, 20), (5, 20), (5, 10), (0, 10)])  # notch
    m = civil.prism(civil.largest_polygon(poly), 1.0, 4.0)
    assert m.is_watertight
    assert m.volume == pytest.approx(poly.area * 3.0)
    assert m.bounds[:, 1].tolist() == pytest.approx([1.0, 4.0])


def test_surface_faces_up_and_covers_the_area():
    poly = civil.largest_polygon(Polygon([(0, 0), (10, 0), (10, 10), (5, 4), (0, 10)]))
    m = civil.surface(poly, 2.0)
    assert (m.face_normals[:, 1] > 0.99).all()
    assert m.area == pytest.approx(poly.area)


def test_largest_polygon_repairs_a_bow_tie():
    poly = civil.largest_polygon(Polygon([(0, 0), (10, 10), (10, 0), (0, 10)]))
    assert poly.is_valid and poly.area == pytest.approx(25.0)


def test_bar_spans_its_segment_and_heights():
    m = civil.bar([0.0, 0.0], [3.0, 4.0], 1.0, 2.0, 0.1)
    assert m.is_watertight
    assert m.volume == pytest.approx(5.0 * 1.0 * 0.1)
    assert m.bounds[:, 1].tolist() == pytest.approx([1.0, 2.0])


def test_outline_of_a_line_is_buffered_by_its_width_with_flat_ends():
    poly = civil.outline(make_item("road", {"kind": "line", "pts": [[E0, N0], [E0 + 10, N0]], "width": 4.0}), CTX)
    assert poly.area == pytest.approx(40.0)
    assert poly.bounds == pytest.approx((-2.0, -5.0, 2.0, 5.0))  # (x=N, z=E) around the line's centroid
```

The last test builds an Item of type `road`, which is not registered until Task 4. `outline` reads only the footprint, so the test passes now.

- [ ] **Step 2: Run them to see them fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Expected: collection error `ImportError: cannot import name 'civil'`.

- [ ] **Step 3: Write the module scaffold and helpers**

Create `backend/app/asset_models/builders/civil.py`:

```python
"""Civil builders (plant model spec 2026-10-03 §6, unit B3) and the B3 footprint helpers.

Item-local frame: metres, Y up from base_el, x = plant north, z = plant east, origin at the
footprint reference point. A 2D outline here is a shapely Polygon in (x, z). Flat items (road,
paved, laydown, parking, revetment) are thin slabs whose top sits a few centimetres above base_el;
each type has its own lift so overlapping surfaces never z-fight. Pure and deterministic.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from pydantic import BaseModel, ConfigDict
from shapely import make_valid
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient

from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import Item

MAX_INSTANCES = 5000  # per node; spacing grows past this so one long fence can't explode the GLB
MIN_SEG_M = 1e-3  # consecutive points closer than this are one point
_Y_UP = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])  # (x, y, z) -> (x, -z, y)

# top-of-surface lift above base_el and slab thickness, per flat material (metres)
LIFT = {"Asphalt": 0.15, "Paving": 0.12, "Laydown": 0.10, "Rock_Armour": 0.06, "Slope": 0.08}
SLAB_T = 0.4


class B3Params(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


# ------------------------------------------------------------------ footprint helpers
def clean_line(pts: np.ndarray) -> np.ndarray:
    """Drop consecutive points closer than MIN_SEG_M; (k, 2) in, (j, 2) out."""
    pts = np.asarray(pts, dtype=float).reshape(-1, 2)
    if not np.isfinite(pts).all():
        raise ValueError("footprint has a non-finite coordinate")
    keep = [0]
    for i in range(1, len(pts)):
        if np.hypot(*(pts[i] - pts[keep[-1]])) > MIN_SEG_M:
            keep.append(i)
    return pts[keep]


def is_closed(pts: np.ndarray) -> bool:
    return len(pts) > 2 and float(np.hypot(*(pts[0] - pts[-1]))) <= MIN_SEG_M


def largest_polygon(geom) -> Polygon:
    """The biggest polygon of a (possibly invalid) geometry, exterior counter-clockwise in (x, z)."""
    if not geom.is_valid:
        geom = make_valid(geom)
    polys = [g for g in getattr(geom, "geoms", [geom]) if isinstance(g, Polygon) and g.area > 1e-6]
    if not polys:
        raise ValueError("footprint has no area")
    best = max(polys, key=lambda p: (p.area, p.bounds))
    return orient(best, sign=1.0)


def local_line(item: Item, ctx: BuildCtx) -> np.ndarray:
    """A line footprint's points in item-local (x, z), duplicates removed."""
    fp = item.footprint
    pts = np.asarray(fp.pts, dtype=float)
    loc = np.asarray(ctx.local(item, pts[:, 0], pts[:, 1]), dtype=float).reshape(-1, 2)
    loc = clean_line(loc)
    if len(loc) < 2:
        raise ValueError("line footprint has no length")
    return loc


def outline(item: Item, ctx: BuildCtx) -> Polygon:
    """The item's plan outline in item-local (x, z). A line is buffered by its width (flat ends)."""
    fp = item.footprint
    if fp.kind == "line":
        line = LineString(local_line(item, ctx))
        return largest_polygon(
            line.buffer(fp.width / 2, cap_style="flat", join_style="mitre", mitre_limit=2.0)
        )
    ring = np.asarray(footprint_polygon(fp), dtype=float)
    loc = clean_line(np.asarray(ctx.local(item, ring[:, 0], ring[:, 1]), dtype=float).reshape(-1, 2))
    if len(loc) < 3:
        raise ValueError("footprint has fewer than 3 distinct points")
    return largest_polygon(Polygon(loc))


# ------------------------------------------------------------------ mesh helpers
def prism(poly: Polygon, y0: float, y1: float) -> trimesh.Trimesh:
    """A closed prism of the outline from y0 to y1 (y1 > y0); outward normals."""
    if not y1 > y0:
        raise ValueError("prism needs y1 > y0")
    m = trimesh.creation.extrude_polygon(poly, y1 - y0, engine="earcut")
    m.apply_transform(_Y_UP)
    m.apply_translation([0.0, y1, 0.0])
    return m


def surface(poly: Polygon, y: float) -> trimesh.Trimesh:
    """A single-sided, up-facing cap of the outline at height y (earcut; concave-safe)."""
    v2, f = trimesh.creation.triangulate_polygon(poly, engine="earcut")
    v = np.column_stack([v2[:, 0], np.full(len(v2), y), v2[:, 1]])
    m = trimesh.Trimesh(v, f, process=False)
    flip = m.face_normals[:, 1] < 0
    if flip.any():
        faces = m.faces.copy()
        faces[flip] = faces[flip][:, ::-1]
        m = trimesh.Trimesh(v, faces, process=False)
    return m


def flat_slab(poly: Polygon, material: str) -> trimesh.Trimesh:
    top = LIFT[material]
    return prism(poly, top - SLAB_T, top)


def yaw(dx: float, dz: float) -> np.ndarray:
    """4x4 rotation about +Y that turns local +x onto the plan direction (dx, dz)."""
    return trimesh.transformations.rotation_matrix(math.atan2(-dz, dx), [0, 1, 0])


def bar(p0, p1, y0: float, y1: float, t: float) -> trimesh.Trimesh:
    """A box over the plan segment p0 -> p1 (x, z), t thick across it, from y0 to y1."""
    p0, p1 = np.asarray(p0, dtype=float), np.asarray(p1, dtype=float)
    d = p1 - p0
    length = float(np.hypot(*d))
    if length <= MIN_SEG_M:
        raise ValueError("bar has no length")
    m = trimesh.creation.box(extents=(length, y1 - y0, t))
    m.apply_transform(yaw(d[0] / length, d[1] / length))
    mid = (p0 + p1) / 2
    m.apply_translation([mid[0], (y0 + y1) / 2, mid[1]])
    return m


def unit_box(w: float, h: float, d: float) -> trimesh.Trimesh:
    """A w (x) by h (y) by d (z) box with its base centred on the origin."""
    m = trimesh.creation.box(extents=(w, h, d))
    m.apply_translation([0.0, h / 2, 0.0])
    return m


def xform(x: float, y: float, z: float, dx: float = 1.0, dz: float = 0.0) -> np.ndarray:
    t = yaw(dx, dz)
    t[:3, 3] = (x, y, z)
    return t


def stations(pts: np.ndarray, spacing: float, lod: float) -> np.ndarray:
    """Evenly spaced points along a polyline, every vertex included, the closing vertex of a
    closed ring not repeated. Returns (n, 4): x, z, and the unit direction of the segment."""
    pts = clean_line(pts)
    closed = is_closed(pts)
    seglen = np.hypot(*np.diff(pts, axis=0).T)
    step = max(spacing / max(lod, 1e-3), seglen.sum() / MAX_INSTANCES)
    out = []
    for (a, b), length in zip(zip(pts[:-1], pts[1:], strict=True), seglen, strict=True):
        n = max(1, math.ceil(length / step - 1e-9))
        d = (b - a) / length
        for k in range(n):
            p = a + (b - a) * (k / n)
            out.append((p[0], p[1], d[0], d[1]))
    if not closed:
        d = (pts[-1] - pts[-2]) / seglen[-1]
        out.append((pts[-1][0], pts[-1][1], d[0], d[1]))
    return np.asarray(out, dtype=float)


def dashes(pts: np.ndarray, dash: float, gap: float, lod: float) -> np.ndarray:
    """Centres and directions (n, 4) of dashes laid along a polyline, restarting per segment."""
    out = []
    pitch = (dash + gap) / max(lod, 1e-3)
    pts = clean_line(pts)
    total = float(np.hypot(*np.diff(pts, axis=0).T).sum())
    pitch = max(pitch, total / MAX_INSTANCES)
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        length = float(np.hypot(*(b - a)))
        if length < dash:
            continue
        d = (b - a) / length
        s = dash / 2
        while s <= length - dash / 2 + 1e-9:
            p = a + d * s
            out.append((p[0], p[1], d[0], d[1]))
            s += pitch
    return np.asarray(out, dtype=float).reshape(-1, 4)


def instanced(mesh: trimesh.Trimesh, rows: np.ndarray, y: float = 0.0) -> Instanced:
    xf = np.stack([xform(r[0], y, r[1], r[2], r[3]) for r in rows]) if len(rows) else np.zeros((0, 4, 4))
    return Instanced(mesh=mesh, transforms=xf)


def merge(meshes: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    return trimesh.util.concatenate([m for m in meshes if m is not None and len(m.faces)])


def defaults_of(p: BaseModel, height_defaulted: bool = False) -> list[str]:
    names = sorted(set(type(p).model_fields) - p.model_fields_set)
    return [*names, "height"] if height_defaulted else names


def record(nodes: list[MeshNode], p: BaseModel, height_defaulted: bool = False) -> list[MeshNode]:
    """Put the defaulted param names (and "height") on the first node's extras for A1's CSV notes."""
    if nodes:
        nodes[0].extras["defaults"] = defaults_of(p, height_defaulted)
    return nodes
```

- [ ] **Step 4: Run the tests to see them pass**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Expected: `11 passed`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_models/builders/civil.py backend/tests/test_builders_civil.py
git commit -m "feat(plant-b3): footprint and mesh helpers for the building and civil builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Flat surfaces (road, paved, laydown, revetment, parking)

**Files:**
- Modify: `backend/app/asset_models/builders/civil.py` (imports; append)
- Modify: `backend/tests/test_builders_civil.py` (append)
- Create (generated): `backend/tests/data/plant/golden/b3/{road,paved,laydown,parking,revetment}_iso.png`

**Interfaces:**
- Consumes: Task 3 helpers; `builder` (base).
- Produces: registered types `road`, `paved`, `laydown`, `revetment` and `parking`; `RoadParams`, `SurfaceParams`, `ParkingParams`; `axes(poly)` (also used by `building.py` in Task 8).

- [ ] **Step 1: Write the failing tests** (append; add `assert_golden, bounds, build_ok, by_name, tri_count` from `plant_b3_helpers` and `Instanced` from `app.asset_models.builders.base` to the imports)

```python
# ------------------------------------------------------------------ flat surfaces
def test_road_is_a_slab_along_its_centreline():
    nodes = build_ok(make_item("road", ROAD))
    assert [n.name for n in nodes] == ["surface"]
    b = bounds(nodes)
    assert b[:, 1].tolist() == pytest.approx([civil.LIFT["Asphalt"] - civil.SLAB_T, civil.LIFT["Asphalt"]])
    # north: 50 + half width below the mitred corner; east: 100 + half width past the corner
    assert b[1, 0] - b[0, 0] == pytest.approx(54.0, abs=0.01)
    assert b[1, 2] - b[0, 2] == pytest.approx(104.0, abs=0.01)
    assert 12 <= tri_count(nodes) <= 60
    assert nodes[0].material == "Asphalt"


def test_road_markings_are_instanced_dashes():
    nodes = by_name(build_ok(make_item("road", ROAD, params={"markings": True})))
    dashes = nodes["markings"].geometry
    assert isinstance(dashes, Instanced)
    assert len(dashes.transforms) == 11 + 6  # 3 m dash every 9 m on the 100 m and 50 m legs
    assert nodes["markings"].material == "Paving"


@pytest.mark.parametrize(
    ("type_", "material"), [("paved", "Paving"), ("laydown", "Laydown"), ("revetment", "Rock_Armour")]
)
def test_flat_surfaces_cover_a_concave_footprint(type_, material):
    nodes = build_ok(make_item(type_, L_POLY))
    (node,) = nodes
    assert node.material == material
    top = civil.LIFT[material]
    up = node.geometry.face_normals[:, 1] > 0.99
    tops = node.geometry.triangles[up][:, :, 1]
    assert np.allclose(tops, top)
    assert node.geometry.area_faces[up].sum() == pytest.approx(450.0)  # notch not filled


def test_parking_has_stall_lines_along_its_long_side():
    nodes = by_name(build_ok(sample("parking")))
    stalls = nodes["stalls"].geometry
    assert isinstance(stalls, Instanced) and len(stalls.transforms) == 25  # 60 m / 2.5 m + 1
    deep = make_item("parking", {"kind": "rect", "center": [E0, N0], "size": [60.0, 20.0], "rot_deg": 0})
    assert len(by_name(build_ok(deep))["stalls"].geometry.transforms) == 50  # two rows
    plain = by_name(build_ok(make_item("parking", RECT, params={"markings": False})))
    assert set(plain) == {"surface"}


@pytest.mark.parametrize("type_", ["road", "paved", "laydown", "parking", "revetment"])
def test_flat_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)
```

- [ ] **Step 2: Run them to see them fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v -k "road or flat or parking"
```

Expected: FAIL. `build_item` finds no `road` in `REGISTRY` (KeyError, or F0's unknown-type fallback), so the `build_ok` assertion fails.

- [ ] **Step 3: Implement**

In `civil.py`, change the two import lines to:

```python
from pydantic import BaseModel, ConfigDict, Field
...
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, builder
```

Append:

```python
# ------------------------------------------------------------------ flat surfaces
class RoadParams(B3Params):
    markings: bool = False
    dash_m: float = Field(3.0, gt=0, le=50)
    gap_m: float = Field(6.0, gt=0, le=50)


class SurfaceParams(B3Params):
    pass


class ParkingParams(B3Params):
    markings: bool = True
    stall_w: float = Field(2.5, gt=0.5, le=10)
    stall_d: float = Field(5.0, gt=1, le=20)


@builder(
    "road",
    family="civil",
    params=RoadParams,
    default_height_m=0.0,
    doc="Road: a line footprint (centreline + width) as an asphalt slab; optional centre dashes.",
)
def build_road(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = RoadParams.model_validate(item.params)
    nodes = [MeshNode("surface", "Asphalt", flat_slab(outline(item, ctx), "Asphalt"))]
    if p.markings and item.footprint.kind == "line":
        rows = dashes(local_line(item, ctx), p.dash_m, p.gap_m, ctx.lod)
        if len(rows):
            dash = unit_box(p.dash_m, 0.02, 0.15)
            nodes.append(MeshNode("markings", "Paving", instanced(dash, rows, LIFT["Asphalt"])))
    return record(nodes, p)


def _flat(material: str):
    def fn(item: Item, ctx: BuildCtx) -> list[MeshNode]:
        p = SurfaceParams.model_validate(item.params)
        return record([MeshNode("surface", material, flat_slab(outline(item, ctx), material))], p)

    return fn


builder(
    "paved",
    family="civil",
    params=SurfaceParams,
    default_height_m=0.0,
    doc="Paved area: the footprint as a concrete paving slab.",
)(_flat("Paving"))
builder(
    "laydown",
    family="civil",
    params=SurfaceParams,
    default_height_m=0.0,
    doc="Laydown or graded pad: the footprint as a gravel slab.",
)(_flat("Laydown"))
builder(
    "revetment",
    family="civil",
    params=SurfaceParams,
    default_height_m=0.0,
    doc="Revetment or rock armour band: the footprint as a rock-armour slab.",
)(_flat("Rock_Armour"))


def axes(poly: Polygon):
    """Centre, long unit axis, short unit axis, long length, short length of the min rotated rect."""
    rect = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e0, e1 = rect[1] - rect[0], rect[2] - rect[1]
    l0, l1 = float(np.hypot(*e0)), float(np.hypot(*e1))
    if l0 >= l1:
        u, lu, v, lv = e0 / l0, l0, e1 / l1, l1
    else:
        u, lu, v, lv = e1 / l1, l1, e0 / l0, l0
    if u[0] < 0 or (abs(u[0]) < 1e-9 and u[1] < 0):  # canonical sign: deterministic across inputs
        u = -u
    v = np.array([-u[1], u[0]])
    return rect.mean(axis=0), u, v, lu, lv


@builder(
    "parking",
    family="civil",
    params=ParkingParams,
    default_height_m=0.0,
    doc="Parking: an asphalt slab with stall lines along its long side (two rows when deep).",
)
def build_parking(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = ParkingParams.model_validate(item.params)
    poly = outline(item, ctx)
    nodes = [MeshNode("surface", "Asphalt", flat_slab(poly, "Asphalt"))]
    if p.markings:
        c, u, v, lu, lv = axes(poly)
        depth = min(p.stall_d, lv - 0.5)
        if depth > 0.5:
            sides = [-1, 1] if lv >= 2 * p.stall_d + 6.0 else [-1]
            n = max(1, math.floor(lu * ctx.lod / p.stall_w))
            rows = []
            for side in sides:
                mid_v = side * (lv / 2 - 0.25 - depth / 2)
                for k in range(n + 1):
                    s = -lu / 2 + k * lu / n
                    q = c + u * s + v * mid_v
                    rows.append((q[0], q[1], v[0], v[1]))
            line = unit_box(depth, 0.02, 0.12)
            nodes.append(MeshNode("stalls", "Paving", instanced(line, np.asarray(rows), LIFT["Asphalt"])))
    return record(nodes, p)
```

- [ ] **Step 4: Write the goldens, look at them, then run the tests without regeneration**

```powershell
$env:KESTREL_REGEN_GOLDEN = "1"; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -k flat_goldens -q; Remove-Item Env:KESTREL_REGEN_GOLDEN
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Open each PNG in `tests/data/plant/golden/b3/` with the Read tool. Each is a 256 px iso view on a dark background.

| Golden | What it should show |
| --- | --- |
| road | A thin grey L-shaped strip |
| paved | An orange L shape with its notch open |
| laydown | A grey rectangle |
| parking | A long grey strip with dark cross lines |
| revetment | A thin grey bent band |

Expected: `22 passed`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_models/builders/civil.py backend/tests/test_builders_civil.py backend/tests/data/plant/golden/b3/road_iso.png backend/tests/data/plant/golden/b3/paved_iso.png backend/tests/data/plant/golden/b3/laydown_iso.png backend/tests/data/plant/golden/b3/parking_iso.png backend/tests/data/plant/golden/b3/revetment_iso.png
git commit -m "feat(plant-b3): road, paved, laydown, revetment and parking builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Walls and fences

**Files:**
- Modify: `backend/app/asset_models/builders/civil.py` (append)
- Modify: `backend/tests/test_builders_civil.py` (append)
- Create (generated): `backend/tests/data/plant/golden/b3/{wall,fence}_iso.png`

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces: registered types `wall` and `fence`; `WallParams`, `FenceParams`, `fence_like(pts, h, p, lod) -> list[MeshNode]`.

- [ ] **Step 1: Write the failing tests** (append; add `materials` from `plant_b3_helpers` and `BuildCtx` from `app.asset_models.builders.base` to the imports)

```python
# ------------------------------------------------------------------ walls and fences
def test_wall_has_height_thickness_and_coping():
    item = make_item("wall", {"kind": "line", "pts": [[E0, N0], [E0 + 40, N0]], "width": 0.7}, top_el=103.0)
    nodes = by_name(build_ok(item))
    assert nodes["wall"].geometry.is_watertight
    assert nodes["wall"].geometry.volume == pytest.approx(40 * 0.7 * 2.9, rel=1e-6)
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 3.0])
    assert nodes["coping"].material == "Concrete_Dark"


def test_fence_posts_are_instanced_along_the_line():
    nodes = by_name(build_ok(make_item("fence", FENCE_30, top_el=102.5)))
    posts = nodes["posts"].geometry
    assert isinstance(posts, Instanced) and len(posts.transforms) == 11
    assert materials(list(nodes.values())) == {"Steel_Dark", "Fence"}
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 2.5])


def test_closed_fence_ring_does_not_double_the_corner_post():
    nodes = by_name(build_ok(make_item("fence", FENCE_RING)))
    xf = nodes["posts"].geometry.transforms
    assert len(xf) == 4 + 7 + 4 + 7
    xz = np.round(xf[:, [0, 2], 3], 6)
    assert len({tuple(p) for p in xz}) == len(xz)


def test_fence_with_repeated_points_builds_without_nan():
    fp = {
        "kind": "line",
        "pts": [[E0, N0], [E0, N0], [E0 + 15, N0], [E0 + 15, N0], [E0 + 30, N0]],
        "width": 0.1,
    }
    nodes = by_name(build_ok(make_item("fence", fp)))
    xf = nodes["posts"].geometry.transforms
    assert np.isfinite(xf).all() and len(xf) == 11


def test_fence_lod_halves_the_posts():
    nodes = by_name(build_ok(make_item("fence", FENCE_30), BuildCtx(grid=None, lod=0.5)))
    assert len(nodes["posts"].geometry.transforms) == 6


def test_fence_around_a_polygon_footprint_follows_its_outline():
    nodes = by_name(build_ok(make_item("fence", RECT)))
    assert len(nodes["posts"].geometry.transforms) == 4 + 7 + 4 + 7


@pytest.mark.parametrize("type_", ["wall", "fence"])
def test_wall_fence_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)
```

- [ ] **Step 2: Run them to see them fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v -k "wall or fence"
```

Expected: FAIL, because the `wall` and `fence` types are not registered.

- [ ] **Step 3: Implement** (append to `civil.py`)

```python
# ------------------------------------------------------------------ walls and fences
class WallParams(B3Params):
    coping: bool = True


class FenceParams(B3Params):
    post_spacing: float = Field(3.0, gt=0.5, le=20)
    post: float = Field(0.08, gt=0.01, le=1)


@builder(
    "wall",
    family="civil",
    params=WallParams,
    default_height_m=3.0,
    doc="Wall: a line footprint (width = thickness) extruded to height, with a coping.",
)
def build_wall(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = WallParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 3.0)
    h = top - base
    if not h > 0:
        raise ValueError("wall needs a height")
    poly = outline(item, ctx)
    cop = min(0.1, h / 10) if p.coping else 0.0
    nodes = [MeshNode("wall", "Concrete", prism(poly, 0.0, h - cop))]
    if cop:
        cap = largest_polygon(poly.buffer(0.05, join_style="mitre", mitre_limit=2.0))
        nodes.append(MeshNode("coping", "Concrete_Dark", prism(cap, h - cop, h)))
    return record(nodes, p, defaulted)


def fence_like(pts: np.ndarray, h: float, p: FenceParams, lod: float) -> list[MeshNode]:
    rows = stations(pts, p.post_spacing, lod)
    post = unit_box(p.post, h, p.post)
    panels, rails = [], []
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        if np.hypot(*(b - a)) <= MIN_SEG_M:
            continue
        panels.append(bar(a, b, 0.05, h - 0.05, 0.02))
        rails.append(bar(a, b, h - 0.06, h - 0.01, 0.05))
    return [
        MeshNode("posts", "Steel_Dark", instanced(post, rows)),
        MeshNode("rails", "Steel_Dark", merge(rails)),
        MeshNode("mesh", "Fence", merge(panels)),
    ]


@builder(
    "fence",
    family="civil",
    params=FenceParams,
    default_height_m=2.5,
    doc="Fence: posts (instanced) at post_spacing along a line footprint, mesh panels, top rail.",
)
def build_fence(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = FenceParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 2.5)
    h = top - base
    if not h > 0.2:
        raise ValueError("fence needs a height above 0.2 m")
    if item.footprint.kind == "line":
        pts = local_line(item, ctx)
    else:
        pts = np.asarray(outline(item, ctx).exterior.coords)  # closed ring: first point repeated last
    return record(fence_like(pts, h, p, ctx.lod), p, defaulted)
```

- [ ] **Step 4: Write the goldens, look at them, run all civil tests**

```powershell
$env:KESTREL_REGEN_GOLDEN = "1"; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -k wall_fence_goldens -q; Remove-Item Env:KESTREL_REGEN_GOLDEN
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Check the goldens with the Read tool:
- `wall_iso.png` is a grey L-shaped wall with a darker coping line.
- `fence_iso.png` is a rectangular ring of green panels between dark posts.

Expected: `30 passed`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_models/builders/civil.py backend/tests/test_builders_civil.py backend/tests/data/plant/golden/b3/wall_iso.png backend/tests/data/plant/golden/b3/fence_iso.png
git commit -m "feat(plant-b3): wall and fence builders with instanced posts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Trenches, channels and basins

**Files:**
- Modify: `backend/app/asset_models/builders/civil.py` (append)
- Modify: `backend/tests/test_builders_civil.py` (append)
- Create (generated): `backend/tests/data/plant/golden/b3/{trench,channel,basin}_iso.png`

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces: registered types `trench`, `channel` and `basin`; `TrenchParams`, `ChannelParams`, `BasinParams`, `open_box(poly, h, wall_t, floor_t, wall_mat) -> tuple[list[MeshNode], Polygon | None]`.

- [ ] **Step 1: Write the failing tests** (append; add `REGISTRY` from `app.asset_models.builders.base` to the imports)

```python
# ------------------------------------------------------------------ trenches, channels, basins
def test_trench_is_an_open_u_with_its_invert_at_base():
    item = sample("trench")
    nodes = by_name(build_ok(item))
    assert set(nodes) == {"walls", "floor"}
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 1.0])
    assert nodes["walls"].geometry.is_watertight
    covered = by_name(
        build_ok(make_item("trench", item.footprint.model_dump(), top_el=101.0, params={"covered": True}))
    )
    assert covered["cover"].material == "Grating"


def test_channel_holds_water_at_half_depth():
    nodes = by_name(build_ok(sample("channel")))
    water = nodes["water"].geometry
    assert nodes["water"].material == "Water_Pit"
    assert water.bounds[:, 1].tolist() == pytest.approx([1.0, 1.0])
    assert materials(list(nodes.values())) == {"Concrete", "Water_Pit"}


def test_narrow_channel_becomes_a_solid_body():
    fp = {"kind": "line", "pts": [[E0, N0], [E0 + 10, N0]], "width": 0.3}
    nodes = by_name(build_ok(make_item("channel", fp, top_el=102.0)))
    assert set(nodes) == {"body"}


def test_basin_on_a_concave_footprint():
    nodes = by_name(build_ok(sample("basin")))
    assert nodes["walls"].geometry.is_watertight
    assert bounds([nodes["walls"]])[:, 1].tolist() == pytest.approx([0.0, 3.3])  # kerb 0.3 above grade
    assert nodes["water"].geometry.bounds[:, 1].tolist() == pytest.approx([2.4, 2.4])
    inner = civil.largest_polygon(
        Polygon(np.asarray(CTX.local(sample("basin"), *np.asarray(L_POLY["pts"]).T)))
    )
    inner = inner.buffer(-0.3, join_style="mitre", mitre_limit=2.0)
    assert nodes["water"].geometry.area == pytest.approx(inner.area)


@pytest.mark.parametrize("type_", ["trench", "channel", "basin"])
def test_open_box_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)


def test_civil_types_are_registered():
    for t in CIVIL:
        assert REGISTRY[t].family == "civil"
    assert REGISTRY["fence"].default_height_m == 2.5
```

- [ ] **Step 2: Run them to see them fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v -k "trench or channel or basin or open_box or registered"
```

Expected: FAIL (types not registered; `KeyError: 'trench'` in the registry test).

- [ ] **Step 3: Implement** (append to `civil.py`)

```python
# ------------------------------------------------------------------ trenches, channels, basins
class TrenchParams(B3Params):
    wall_t: float = Field(0.15, gt=0.02, le=2)
    floor_t: float = Field(0.15, gt=0.02, le=2)
    covered: bool = False


class ChannelParams(B3Params):
    wall_t: float = Field(0.25, gt=0.02, le=2)
    floor_t: float = Field(0.25, gt=0.02, le=2)
    water: float = Field(0.5, ge=0, le=1)  # water surface as a fraction of the depth


class BasinParams(B3Params):
    wall_t: float = Field(0.3, gt=0.02, le=2)
    floor_t: float = Field(0.3, gt=0.02, le=2)
    kerb_h: float = Field(0.3, ge=0, le=2)
    freeboard: float = Field(0.6, ge=0, le=10)


def open_box(poly: Polygon, h: float, wall_t: float, floor_t: float, wall_mat: str):
    """Walls (outline minus its inset) from 0 to h and a floor slab; returns (nodes, inner)."""
    inner = poly.buffer(-wall_t, join_style="mitre", mitre_limit=2.0)
    if inner.is_empty or inner.area < 1e-3:
        return [MeshNode("body", wall_mat, prism(poly, 0.0, h))], None
    inner = largest_polygon(inner)
    ring = poly.difference(inner)
    walls = [
        prism(g, 0.0, h) for g in getattr(ring, "geoms", [ring]) if isinstance(g, Polygon) and g.area > 1e-6
    ]
    nodes = [
        MeshNode("walls", wall_mat, merge(walls)),
        MeshNode("floor", wall_mat, prism(inner, 0.0, min(floor_t, h / 2))),
    ]
    return nodes, inner


def _depth(item: Item, ctx: BuildCtx, default: float) -> tuple[float, bool]:
    base, top, defaulted = ctx.height(item, default)
    if not top - base > 0:
        raise ValueError("needs a depth (top_el above base_el)")
    return top - base, defaulted


@builder(
    "trench",
    family="civil",
    params=TrenchParams,
    default_height_m=1.0,
    doc="Trench or ditch: an open concrete U along a line (base_el = invert), optional grating.",
)
def build_trench(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = TrenchParams.model_validate(item.params)
    h, defaulted = _depth(item, ctx, 1.0)
    nodes, inner = open_box(outline(item, ctx), h, p.wall_t, p.floor_t, "Concrete_Dark")
    if p.covered and inner is not None:
        nodes.append(MeshNode("cover", "Grating", prism(inner, h - 0.05, h)))
    return record(nodes, p, defaulted)


@builder(
    "channel",
    family="civil",
    params=ChannelParams,
    default_height_m=2.0,
    doc="Open water channel or culvert: a concrete U with a water surface at a fraction of depth.",
)
def build_channel(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = ChannelParams.model_validate(item.params)
    h, defaulted = _depth(item, ctx, 2.0)
    nodes, inner = open_box(outline(item, ctx), h, p.wall_t, p.floor_t, "Concrete")
    if inner is not None and p.water > 0:
        nodes.append(MeshNode("water", "Water_Pit", surface(inner, max(p.floor_t, h * p.water))))
    return record(nodes, p, defaulted)


@builder(
    "basin",
    family="civil",
    params=BasinParams,
    default_height_m=3.0,
    doc="Basin or pit: concrete walls with a kerb above grade, floor, and water below freeboard.",
)
def build_basin(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = BasinParams.model_validate(item.params)
    h, defaulted = _depth(item, ctx, 3.0)
    nodes, inner = open_box(outline(item, ctx), h + p.kerb_h, p.wall_t, p.floor_t, "Concrete")
    if inner is not None:
        nodes.append(MeshNode("water", "Water_Pit", surface(inner, max(p.floor_t, h - p.freeboard))))
    return record(nodes, p, defaulted)
```

- [ ] **Step 4: Write the goldens, look at them, run all civil tests**

```powershell
$env:KESTREL_REGEN_GOLDEN = "1"; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -k open_box_goldens -q; Remove-Item Env:KESTREL_REGEN_GOLDEN
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Check the goldens:
- `trench_iso.png`: a grey L-shaped open channel.
- `channel_iso.png`: a grey L-shaped U with its inner channel visible.
- `basin_iso.png`: an L-shaped concrete box with a purple water surface inside.

Expected: `38 passed`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_models/builders/civil.py backend/tests/test_builders_civil.py backend/tests/data/plant/golden/b3/trench_iso.png backend/tests/data/plant/golden/b3/channel_iso.png backend/tests/data/plant/golden/b3/basin_iso.png
git commit -m "feat(plant-b3): trench, channel and basin builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Houses (building, substation, analyzer_house)

**Files:**
- Create: `backend/app/asset_models/builders/building.py`
- Create: `backend/tests/test_builders_building.py`
- Create (generated): `backend/tests/data/plant/golden/b3/{building,substation,analyzer_house}_iso.png`

**Interfaces:**
- Consumes: `civil.B3Params`, `bar`, `largest_polygon`, `merge`, `outline`, `prism` and `record`; `builder`, `BuildCtx` and `MeshNode` (base).
- Produces: registered types `building`, `substation` and `analyzer_house` (family `building`); `HouseParams`, `SubstationParams`, `AnalyzerHouseParams`; `house(poly, h, p, lod) -> list[MeshNode]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_builders_building.py`:

```python
"""Building builders (plant model spec 2026-10-03 §6, unit B3): building, substation,
analyzer_house, shelter, gate."""

from __future__ import annotations

import numpy as np
import pytest
from plant_b3_helpers import (
    assert_golden,
    bounds,
    build_ok,
    by_name,
    make_item,
    materials,
)

from app.asset_models.builders.base import REGISTRY, BuildCtx

E0, N0 = 500.0, 300.0
RECT = {"kind": "rect", "center": [E0, N0], "size": [30.0, 20.0], "rot_deg": 0}  # 30 along north, 20 east
L_POLY = {
    "kind": "polygon",
    "pts": [
        [E0, N0],
        [E0 + 30, N0],
        [E0 + 30, N0 + 10],
        [E0 + 10, N0 + 10],
        [E0 + 10, N0 + 25],
        [E0, N0 + 25],
    ],
}  # concave, area 450
TYPES = ["building", "substation", "analyzer_house", "shelter", "gate"]
SAMPLE = {
    "building": (L_POLY, 109.0, {}),
    "substation": (RECT, 109.0, {}),
    "analyzer_house": ({"kind": "rect", "center": [E0, N0], "size": [6.0, 5.0], "rot_deg": 20}, 103.5, {}),
    "shelter": ({"kind": "rect", "center": [E0, N0], "size": [13.4, 6.6], "rot_deg": 0}, 105.0, {}),
    "gate": ({"kind": "line", "pts": [[E0, N0], [E0 + 13.5, N0 + 1.4]], "width": 0.3}, 102.5, {}),
}


def sample(type_: str):
    fp, top, params = SAMPLE[type_]
    return make_item(type_, fp, top_el=top, params=params)


# ------------------------------------------------------------------ houses
def test_building_walls_roof_parapet_glazing_and_door():
    nodes = by_name(build_ok(make_item("building", RECT, top_el=109.0)))
    assert set(nodes) == {"walls", "roof", "glazing", "doors"}
    assert nodes["walls"].geometry.is_watertight
    assert nodes["walls"].geometry.volume == pytest.approx(600 * (9.0 - 0.6 - 0.3))
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 9.0])
    assert nodes["roof"].geometry.bounds[:, 1].tolist() == pytest.approx([8.1, 9.0])  # slab + parapet
    assert len(nodes["glazing"].geometry.faces) == 4 * 2 * 12  # 4 walls x 2 storeys, one box each
    door = nodes["doors"].geometry.bounds
    assert abs(abs(door[:, 2].mean()) - 10.0) < 0.1  # on a 30 m (north-running) wall, 10 m east/west
    assert materials(list(nodes.values())) == {"Building_Wall", "Building_Roof", "Glass", "Steel_Dark"}


def test_concave_building_keeps_its_notch():
    nodes = by_name(build_ok(make_item("building", L_POLY, top_el=106.0)))
    assert nodes["walls"].geometry.volume == pytest.approx(450 * (6.0 - 0.9))


def test_substation_sits_on_a_plinth_without_glazing():
    nodes = by_name(build_ok(sample("substation")))
    assert set(nodes) == {"plinth", "walls", "roof", "doors"}
    assert nodes["plinth"].material == "Concrete"
    assert nodes["plinth"].geometry.bounds[:, 1].tolist() == pytest.approx([0.0, 1.5])
    assert nodes["walls"].geometry.bounds[0, 1] == pytest.approx(1.5)


def test_analyzer_house_roof_overhangs_and_has_no_parapet():
    item = make_item(
        "analyzer_house", {"kind": "rect", "center": [E0, N0], "size": [6.0, 5.0], "rot_deg": 0}, top_el=103.5
    )
    nodes = by_name(build_ok(item))
    walls, roof = nodes["walls"].geometry.bounds, nodes["roof"].geometry.bounds
    assert roof[1, 1] == pytest.approx(3.5)
    assert (walls[0, [0, 2]] - roof[0, [0, 2]]).tolist() == pytest.approx([0.3, 0.3])
    assert "glazing" not in nodes
    assert nodes["hvac"].material == "Equipment_Grey"


def test_a_low_building_shrinks_its_roof_stack_instead_of_failing():
    nodes = build_ok(make_item("building", RECT, top_el=101.0))
    b = bounds(nodes)
    assert b[:, 1].tolist() == pytest.approx([0.0, 1.0])
    walls = by_name(nodes)["walls"].geometry.bounds
    assert walls[1, 1] - walls[0, 1] == pytest.approx(0.5)


def test_low_lod_drops_glazing():
    nodes = by_name(build_ok(make_item("building", RECT, top_el=109.0), BuildCtx(grid=None, lod=0.4)))
    assert "glazing" not in nodes


def test_rotated_building_stays_on_its_footprint():
    item = make_item(
        "building", {"kind": "rect", "center": [E0, N0], "size": [30.0, 20.0], "rot_deg": 30}, top_el=106.0
    )
    walls = by_name(build_ok(item))["walls"].geometry
    assert walls.volume == pytest.approx(600 * 5.1)
    half = np.abs(walls.vertices[:, [0, 2]]).max(axis=0)
    assert half.max() > 15.0  # a 30 m wall at 30 degrees spans more than its half-length on an axis


def test_house_defaults_are_recorded():
    nodes = build_ok(make_item("building", RECT, top_el=None, params={"doors": 2}))
    rec = nodes[0].extras["defaults"]
    assert "doors" not in rec and "parapet_h" in rec and rec[-1] == "height"


@pytest.mark.parametrize("type_", ["building", "substation", "analyzer_house"])
def test_house_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)


def test_house_types_are_registered():
    for t in ("building", "substation", "analyzer_house"):
        assert REGISTRY[t].family == "building"
    assert REGISTRY["substation"].default_height_m == 9.0
```

- [ ] **Step 2: Run them to see them fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_building.py -v
```

Expected: FAIL. `building` is not registered, so `build_ok` asserts, and `REGISTRY["building"]` raises KeyError.

- [ ] **Step 3: Implement**

Create `backend/app/asset_models/builders/building.py`:

```python
"""Building builders (plant model spec 2026-10-03 §6, unit B3): building, substation,
analyzer_house, shelter, gate.

A house is a plinth (optional), walls, a roof slab (optionally overhanging) and a parapet ring,
with glazing bands per storey and door panels on the longest walls. Glazing and doors are thin
boxes 3 cm proud of the wall face. Same item-local frame and helpers as `civil`.
"""

from __future__ import annotations

import math

import numpy as np
from pydantic import Field
from shapely.geometry import Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.civil import (
    B3Params,
    bar,
    largest_polygon,
    merge,
    outline,
    prism,
    record,
)
from app.asset_models.spec import Item

PROUD = 0.03  # glazing and doors stand this far off the wall face
MIN_WALL_M = 0.5


class HouseParams(B3Params):
    plinth_h: float = Field(0.0, ge=0, le=5)
    roof_t: float = Field(0.3, gt=0, le=3)
    parapet_h: float = Field(0.6, ge=0, le=3)
    parapet_t: float = Field(0.25, gt=0, le=1)
    roof_overhang: float = Field(0.0, ge=0, le=5)
    storey_h: float = Field(4.0, gt=2, le=10)
    windows: bool = True
    sill_h: float = Field(1.2, ge=0, le=5)
    window_h: float = Field(0.9, gt=0, le=5)
    doors: int = Field(1, ge=0, le=8)
    door_w: float = Field(2.0, gt=0.5, le=10)
    door_h: float = Field(2.4, gt=1, le=10)
    hvac: bool = False  # a wall-hung air-conditioning unit on the shortest wall


class SubstationParams(HouseParams):
    plinth_h: float = Field(1.5, ge=0, le=5)
    windows: bool = False
    door_w: float = Field(3.0, gt=0.5, le=10)
    door_h: float = Field(3.0, gt=1, le=10)


class AnalyzerHouseParams(HouseParams):
    parapet_h: float = Field(0.0, ge=0, le=3)
    roof_overhang: float = Field(0.3, ge=0, le=5)
    windows: bool = False
    door_w: float = Field(1.0, gt=0.5, le=10)
    door_h: float = Field(2.1, gt=1, le=10)
    hvac: bool = True


def _edges(poly: Polygon):
    """(a, b, outward unit normal, length) per exterior edge; the exterior is counter-clockwise."""
    ring = np.asarray(poly.exterior.coords)
    out = []
    for a, b in zip(ring[:-1], ring[1:], strict=True):
        d = b - a
        length = float(np.hypot(*d))
        if length > 1e-6:
            out.append((a, b, np.array([d[1], -d[0]]) / length, length))
    return out


def house(poly: Polygon, h: float, p: HouseParams, lod: float) -> list[MeshNode]:
    stack = p.plinth_h + p.roof_t + p.parapet_h
    k = min(1.0, max(h - MIN_WALL_M, 0.0) / stack) if stack > 0 else 1.0
    plinth, roof_t, parapet = p.plinth_h * k, p.roof_t * k, p.parapet_h * k
    if h - plinth - roof_t - parapet <= 0:
        raise ValueError("building needs a height")
    wall_top = h - parapet - roof_t
    nodes: list[MeshNode] = []
    if plinth > 0:
        nodes.append(MeshNode("plinth", "Concrete", prism(poly, 0.0, plinth)))
    nodes.append(MeshNode("walls", "Building_Wall", prism(poly, plinth, wall_top)))
    roof_poly = poly
    if p.roof_overhang > 0:
        roof_poly = largest_polygon(poly.buffer(p.roof_overhang, join_style="mitre", mitre_limit=2.0))
    roof = [prism(roof_poly, wall_top, wall_top + roof_t)]
    if parapet > 0:
        inner = poly.buffer(-p.parapet_t, join_style="mitre", mitre_limit=2.0)
        if not inner.is_empty and inner.area > 1e-3:
            ring = poly.difference(largest_polygon(inner))
            for g in getattr(ring, "geoms", [ring]):
                if isinstance(g, Polygon) and g.area > 1e-6:
                    roof.append(prism(g, wall_top + roof_t, h))
    nodes.append(MeshNode("roof", "Building_Roof", merge(roof)))
    edges = _edges(poly)
    if p.windows and lod >= 0.5:
        storeys = max(1, math.floor((wall_top - plinth) / p.storey_h))
        bands = []
        for s in range(storeys):
            y0 = plinth + s * p.storey_h + p.sill_h
            y1 = min(y0 + p.window_h, wall_top - 0.2)
            if y1 - y0 < 0.2:
                continue
            for a, b, nrm, length in edges:
                if length < 2.0:
                    continue
                d = (b - a) / length
                off = nrm * PROUD
                bands.append(bar(a + d * 0.5 + off, b - d * 0.5 + off, y0, y1, 0.04))
        if bands:
            nodes.append(MeshNode("glazing", "Glass", merge(bands)))
    if p.doors:
        doors = []
        for a, b, nrm, length in sorted(edges, key=lambda e: (-e[3], tuple(e[0])))[: p.doors]:
            w = min(p.door_w, length - 0.4)
            dh = min(p.door_h, wall_top - plinth - 0.1)
            if w <= 0.3 or dh <= 0.5:
                continue
            mid = (a + b) / 2
            d = (b - a) / length
            off = nrm * PROUD
            doors.append(bar(mid - d * w / 2 + off, mid + d * w / 2 + off, plinth, plinth + dh, 0.05))
        if doors:
            nodes.append(MeshNode("doors", "Steel_Dark", merge(doors)))
    if p.hvac:
        a, b, nrm, length = min(edges, key=lambda e: (e[3], tuple(e[0])))
        d = (b - a) / length
        w = min(1.0, length - 0.4)
        y0 = plinth + min(1.5, max(wall_top - plinth - 1.0, 0.0))
        if w > 0.2:
            mid = (a + b) / 2 + nrm * 0.3
            unit = bar(mid - d * w / 2, mid + d * w / 2, y0, y0 + 0.8, 0.6)
            nodes.append(MeshNode("hvac", "Equipment_Grey", unit))
    return nodes


def _house_builder(params_cls: type[HouseParams], default_h: float):
    def fn(item: Item, ctx: BuildCtx) -> list[MeshNode]:
        p = params_cls.model_validate(item.params)
        base, top, defaulted = ctx.height(item, default_h)
        return record(house(outline(item, ctx), top - base, p, ctx.lod), p, defaulted)

    return fn


builder(
    "building",
    family="building",
    params=HouseParams,
    default_height_m=6.0,
    doc="Building: walls, roof slab with parapet, glazing bands per storey, doors on the longest walls.",
)(_house_builder(HouseParams, 6.0))
builder(
    "substation",
    family="building",
    params=SubstationParams,
    default_height_m=9.0,
    doc="Substation: a building on a 1.5 m cable-cellar plinth, unglazed, with equipment doors.",
)(_house_builder(SubstationParams, 9.0))
builder(
    "analyzer_house",
    family="building",
    params=AnalyzerHouseParams,
    default_height_m=3.5,
    doc="Analyzer house: a small unglazed hut with an overhanging roof and one door.",
)(_house_builder(AnalyzerHouseParams, 3.5))
```

- [ ] **Step 4: Write the goldens, look at them, run the tests**

```powershell
$env:KESTREL_REGEN_GOLDEN = "1"; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_building.py -k house_goldens -q; Remove-Item Env:KESTREL_REGEN_GOLDEN
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_building.py -v
```

Check the goldens:
- `building_iso.png`: an L-shaped block with two orange glazing bands on its visible walls and a raised parapet edge on the roof.
- `substation_iso.png`: a block on a slightly wider-looking plinth line, with one dark door panel.
- `analyzer_house_iso.png`: a small hut rotated 20°, with an overhanging roof and a grey box (HVAC) on one wall.

Expected: `12 passed`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_models/builders/building.py backend/tests/test_builders_building.py backend/tests/data/plant/golden/b3/building_iso.png backend/tests/data/plant/golden/b3/substation_iso.png backend/tests/data/plant/golden/b3/analyzer_house_iso.png
git commit -m "feat(plant-b3): building, substation and analyzer house builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Shelter and gate

**Files:**
- Modify: `backend/app/asset_models/builders/building.py` (imports; append)
- Modify: `backend/tests/test_builders_building.py` (append)
- Create (generated): `backend/tests/data/plant/golden/b3/{shelter,gate}_iso.png`

**Interfaces:**
- Consumes: `civil.axes`, `instanced`, `local_line`, `stations`, `unit_box` and `yaw`.
- Produces: registered types `shelter` and `gate`; `ShelterParams`, `GateParams`.

- [ ] **Step 1: Write the failing tests** (append; add `CTX, same_geometry, tri_count` from `plant_b3_helpers`, `Instanced, build_item` from `app.asset_models.builders.base`, `from shapely.geometry import Point` and `from app.asset_models.builders.civil import outline` to the imports)

```python
# ------------------------------------------------------------------ shelter
def test_shelter_column_grid_is_instanced():
    nodes = by_name(build_ok(sample("shelter")))
    cols = nodes["columns"].geometry
    assert isinstance(cols, Instanced) and len(cols.transforms) == 4 * 3
    assert materials(list(nodes.values())) == {"Concrete", "Steel_Structure", "Shelter_Roof"}
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 5.0])
    assert nodes["roof"].geometry.bounds[0, 1] == pytest.approx(5.0 - 0.35)


def test_shelter_on_a_concave_footprint_keeps_columns_inside():
    nodes = by_name(build_ok(make_item("shelter", L_POLY, top_el=106.0)))
    xf = nodes["columns"].geometry.transforms
    poly = outline(make_item("shelter", L_POLY), CTX).buffer(1e-6)
    assert len(xf) > 0
    assert all(poly.contains(Point(t[0, 3], t[2, 3])) for t in xf)


def test_too_low_shelter_falls_back():
    _, flags = build_item(make_item("shelter", RECT, top_el=100.8), BuildCtx(grid=None))
    assert [f.code for f in flags] == ["builder_fallback"]


# ------------------------------------------------------------------ gate
def test_gate_has_posts_two_leaves_and_pickets():
    nodes = by_name(build_ok(sample("gate")))
    assert len(nodes["posts"].geometry.transforms) == 2
    assert len(nodes["pickets"].geometry.transforms) == 2 * 13
    assert materials(list(nodes.values())) == {"Steel_Dark"}
    assert bounds(list(nodes.values()))[1, 1] == pytest.approx(2.6)  # posts stand 0.1 m proud


def test_a_gate_shorter_than_its_posts_falls_back():
    item = make_item("gate", {"kind": "line", "pts": [[E0, N0], [E0 + 0.3, N0]], "width": 0.3})
    _, flags = build_item(item, BuildCtx(grid=None))
    assert [f.code for f in flags] == ["builder_fallback"]


# ------------------------------------------------------------------ all building-family types
def test_types_are_registered_in_the_building_family():
    for t in TYPES:
        assert REGISTRY[t].family == "building"


@pytest.mark.parametrize("type_", TYPES)
def test_builds_are_deterministic(type_):
    assert same_geometry(build_ok(sample(type_)), build_ok(sample(type_)))


@pytest.mark.parametrize(
    ("type_", "lo", "hi"),
    [
        ("building", 150, 600),
        ("substation", 60, 300),
        ("analyzer_house", 40, 200),
        ("shelter", 150, 800),
        ("gate", 200, 800),
    ],
)
def test_triangle_ranges(type_, lo, hi):
    assert lo <= tri_count(build_ok(sample(type_))) <= hi


@pytest.mark.parametrize("type_", ["shelter", "gate"])
def test_shelter_gate_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)
```

Measured counts for the samples: building 244, substation 80, analyzer_house 48, shelter 252, gate 456.

- [ ] **Step 2: Run them to see them fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_building.py -v -k "shelter or gate or registered or deterministic or triangle"
```

Expected: FAIL (`shelter` and `gate` are not registered).

- [ ] **Step 3: Implement**

In `building.py`, make the imports:

```python
import math

import numpy as np
import trimesh
from pydantic import Field
from shapely.geometry import Point, Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.civil import (
    B3Params,
    axes,
    bar,
    instanced,
    largest_polygon,
    local_line,
    merge,
    outline,
    prism,
    record,
    stations,
    unit_box,
    yaw,
)
from app.asset_models.spec import Item
```

Append:

```python
# ------------------------------------------------------------------ shelter
class ShelterParams(B3Params):
    bay: float = Field(6.0, gt=1, le=30)
    column: float = Field(0.3, gt=0.05, le=2)
    roof_t: float = Field(0.35, gt=0, le=2)
    slab_t: float = Field(0.2, ge=0, le=2)
    beam_d: float = Field(0.4, gt=0, le=3)
    roof_overhang: float = Field(0.3, ge=0, le=5)


@builder(
    "shelter",
    family="building",
    params=ShelterParams,
    default_height_m=6.0,
    doc="Open shelter: slab, a column grid at bay spacing (instanced), eaves and cross beams, roof.",
)
def build_shelter(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = ShelterParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 6.0)
    h = top - base
    if h <= p.roof_t + p.slab_t + p.beam_d + 0.5:
        raise ValueError("shelter is too low for its roof")
    poly = outline(item, ctx)
    c, u, v, lu, lv = axes(poly)
    inset = p.column / 2 + 0.1
    nu = max(1, math.ceil((lu - 2 * inset) / (p.bay / max(ctx.lod, 1e-3)) - 1e-9))
    nv = max(1, math.ceil((lv - 2 * inset) / (p.bay / max(ctx.lod, 1e-3)) - 1e-9))
    us = np.linspace(-lu / 2 + inset, lu / 2 - inset, nu + 1)
    vs = np.linspace(-lv / 2 + inset, lv / 2 - inset, nv + 1)
    keep_in = poly.buffer(1e-6)
    grid = [[c + u * a + v * b for a in us] for b in vs]
    cols = [q for row in grid for q in row if keep_in.contains(Point(float(q[0]), float(q[1])))]
    under = h - p.roof_t
    col_h = under - p.slab_t
    nodes = []
    if p.slab_t > 0:
        nodes.append(MeshNode("slab", "Concrete", prism(poly, 0.0, p.slab_t)))
    if cols:
        rows = np.array([(q[0], q[1], u[0], u[1]) for q in cols])
        column = unit_box(p.column, col_h, p.column)
        nodes.append(MeshNode("columns", "Steel_Structure", instanced(column, rows, p.slab_t)))
    beams = []
    for row in grid:
        beams.append(bar(row[0], row[-1], under - p.beam_d, under, p.column))
    for j in range(len(us)):
        beams.append(bar(grid[0][j], grid[-1][j], under - p.beam_d, under, p.column))
    nodes.append(MeshNode("beams", "Steel_Structure", merge(beams)))
    roof_poly = poly
    if p.roof_overhang > 0:
        roof_poly = largest_polygon(poly.buffer(p.roof_overhang, join_style="mitre", mitre_limit=2.0))
    nodes.append(MeshNode("roof", "Shelter_Roof", prism(roof_poly, under, h)))
    return record(nodes, p, defaulted)


# ------------------------------------------------------------------ gate
class GateParams(B3Params):
    post: float = Field(0.2, gt=0.05, le=1)
    picket_spacing: float = Field(0.5, gt=0.05, le=5)
    leaf_max: float = Field(4.0, gt=0.5, le=20)  # a wider opening is split into two leaves


@builder(
    "gate",
    family="building",
    params=GateParams,
    default_height_m=2.5,
    doc="Gate: posts at the ends, leaves with top/bottom rails, a diagonal brace and pickets (instanced).",
)
def build_gate(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = GateParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 2.5)
    h = top - base
    if not h > 0.5:
        raise ValueError("gate needs a height above 0.5 m")
    if item.footprint.kind == "line":
        pts = local_line(item, ctx)
    else:
        _, u, _, lu, _ = axes(outline(item, ctx))
        c = np.zeros(2)
        pts = np.array([c - u * lu / 2, c + u * lu / 2])
    posts, frame, picket_rows = [], [], []
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        length = float(np.hypot(*(b - a)))
        if length <= p.post * 2:
            continue
        d = (b - a) / length
        posts += [(a[0], a[1], d[0], d[1]), (b[0], b[1], d[0], d[1])]
        leaves = 2 if length > p.leaf_max else 1
        lw = (length - p.post) / leaves
        for k in range(leaves):
            s0 = a + d * (p.post / 2 + k * lw + 0.05)
            s1 = a + d * (p.post / 2 + (k + 1) * lw - 0.05)
            frame += [bar(s0, s1, 0.1, 0.18, 0.06), bar(s0, s1, h - 0.18, h - 0.1, 0.06)]
            frame += [bar(s0, s0 + d * 0.06, 0.1, h - 0.1, 0.06), bar(s1 - d * 0.06, s1, 0.1, h - 0.1, 0.06)]
            frame.append(_brace(s0, s1, h))
            seg = np.array([s0, s1])
            rows = stations(seg, p.picket_spacing, ctx.lod)[1:-1]
            picket_rows += [tuple(r) for r in rows]
    if not posts:
        raise ValueError("gate line is shorter than its posts")
    uniq = list(dict.fromkeys((round(x, 6), round(z, 6), dx, dz) for x, z, dx, dz in posts))
    nodes = [
        MeshNode("posts", "Steel_Dark", instanced(unit_box(p.post, h + 0.1, p.post), np.array(uniq))),
        MeshNode("frame", "Steel_Dark", merge(frame)),
    ]
    if picket_rows:
        nodes.append(
            MeshNode(
                "pickets",
                "Steel_Dark",
                instanced(unit_box(0.03, h - 0.36, 0.03), np.array(picket_rows), 0.18),
            )
        )
    return record(nodes, p, defaulted)


def _brace(s0, s1, h):
    """A diagonal flat bar from the bottom of s0 to the top of s1 (a thin sloped box)."""
    d = s1 - s0
    length = float(np.hypot(*d))
    rise = h - 0.36
    m = trimesh.creation.box(extents=(math.hypot(length, rise), 0.06, 0.04))
    m.apply_transform(trimesh.transformations.rotation_matrix(math.atan2(rise, length), [0, 0, 1]))
    m.apply_transform(yaw(d[0] / length, d[1] / length))
    mid = (s0 + s1) / 2
    m.apply_translation([mid[0], h / 2, mid[1]])
    return m
```

- [ ] **Step 4: Write the goldens, look at them, run the tests**

```powershell
$env:KESTREL_REGEN_GOLDEN = "1"; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_building.py -k shelter_gate_goldens -q; Remove-Item Env:KESTREL_REGEN_GOLDEN
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_building.py -v
```

Check the goldens:
- `shelter_iso.png`: a flat roof on a grid of blue columns over a grey slab.
- `gate_iso.png`: a dark double gate with two end posts, rails, diagonal braces and vertical pickets.

Expected: `30 passed`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_models/builders/building.py backend/tests/test_builders_building.py backend/tests/data/plant/golden/b3/shelter_iso.png backend/tests/data/plant/golden/b3/gate_iso.png
git commit -m "feat(plant-b3): shelter and gate builders with instanced columns and pickets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Environment meshes

**Files:**
- Create: `backend/app/asset_models/builders/environment.py`
- Create: `backend/tests/test_builders_environment.py`
- Create (generated): `backend/tests/data/plant/golden/b3/env_land_top.png`

**Interfaces:**
- Consumes:
  - from `civil`: `LIFT`, `SLAB_T`, `clean_line`, `is_closed`, `largest_polygon`, `prism`, `surface`;
  - from base: `BuildCtx`, `MeshNode`;
  - `EnvFeature` and `SiteFrame` (spec), `PlantGrid` (siteframe);
  - the `landmask` rings from Task 2.
- Produces: `build_env(feature, ctx, *, sea_el=None) -> list[MeshNode]`, `build_environment(features, ctx) -> list[MeshNode]`, `LAND_DEPTH_M`, `SEA_TOE_M`, `ARMOUR_RUN`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_builders_environment.py`:

```python
"""Environment meshes (plant model spec 2026-10-03 §5 EnvFeature, unit B3): land, sea, road, paved,
laydown, slope, revetment, in the scene frame."""

from __future__ import annotations

import numpy as np
import pytest
from plant_b3_helpers import CTX, assert_golden, bounds, cowork, materials, same_geometry
from shapely.geometry import Polygon

from app.asset_models.builders import civil, environment
from app.asset_models.builders.base import BuildCtx
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import EnvFeature, SiteFrame

S = {"kind": "assumed"}
FRAME = SiteFrame.model_validate(
    {
        "crs": {"epsg": 32639},
        "origin_crs": [244338.089, 3179515.69],
        "plant_north_deg": 17.9991,
        "datum": {"label": "HPFS", "el_m": 100.0},
        "source": S,
    }
)
GRID_CTX = BuildCtx(grid=PlantGrid(FRAME))
SQUARE = [[0, 0], [200, 0], [200, 100], [0, 100]]  # E 0..200, N 0..100
U_SHAPE = [[0, 0], [90, 0], [90, 60], [60, 60], [60, 20], [30, 20], [30, 60], [0, 60]]  # area 4200


def feat(kind: str, pts, el: float = 100.0, id_: str = "f1") -> EnvFeature:
    return EnvFeature(id=id_, kind=kind, pts=pts, el=el, source=S)


def test_sea_is_a_flat_up_facing_surface_marked_for_the_water_shader():
    (node,) = environment.build_env(feat("sea", SQUARE, el=93.56), GRID_CTX)
    assert node.material == "Sea"
    assert node.extras == {"env": "sea", "id": "f1"}
    m = node.geometry
    assert np.allclose(m.vertices[:, 1], -6.44)  # EL 93.56 against datum 100
    assert (m.face_normals[:, 1] > 0.99).all()
    assert len(m.faces) == 2


def test_scene_frame_axes_without_a_grid():
    (node,) = environment.build_env(feat("sea", SQUARE, el=3.0), CTX)
    b = node.geometry.bounds
    assert b[:, 0].tolist() == pytest.approx([0, 100])  # x = plant north
    assert b[:, 2].tolist() == pytest.approx([0, 200])  # z = plant east
    assert b[:, 1].tolist() == pytest.approx([3.0, 3.0])  # no datum: y = EL


def test_land_cap_and_armour_skirt_reach_below_the_sea():
    nodes = environment.build_env(feat("land", SQUARE), GRID_CTX, sea_el=93.56)
    cap, skirt = nodes
    assert (cap.material, skirt.material) == ("Ground", "Rock_Armour")
    assert cap.extras["env"] == "land" and skirt.extras["env"] == "land"
    assert np.allclose(cap.geometry.vertices[:, 1], 0.0)
    drop = 100.0 - 93.56 + environment.SEA_TOE_M
    assert skirt.geometry.bounds[0, 1] == pytest.approx(-drop)
    run = drop * environment.ARMOUR_RUN
    assert (cap.geometry.bounds[0] - skirt.geometry.bounds[0])[[0, 2]] == pytest.approx([run, run])
    assert skirt.geometry.face_normals[:, 1].min() > 0  # every skirt face looks up and out


def test_land_without_a_sea_drops_a_fixed_depth():
    _, skirt = environment.build_env(feat("land", SQUARE), GRID_CTX)
    assert skirt.geometry.bounds[0, 1] == pytest.approx(-environment.LAND_DEPTH_M)


def test_concave_land_is_not_filled_in():
    cap, _ = environment.build_env(feat("land", U_SHAPE), GRID_CTX)
    assert cap.geometry.area == pytest.approx(4200.0)


@pytest.mark.parametrize(
    ("kind", "material"),
    [
        ("road", "Asphalt"),
        ("paved", "Paving"),
        ("laydown", "Laydown"),
        ("slope", "Slope"),
        ("revetment", "Rock_Armour"),
    ],
)
def test_surface_kinds_are_slabs_with_their_lift(kind, material):
    (node,) = environment.build_env(feat(kind, U_SHAPE, el=97.5), GRID_CTX)
    assert node.material == material and node.extras["env"] == kind
    top = -2.5 + civil.LIFT[material]
    assert node.geometry.bounds[:, 1].tolist() == pytest.approx([top - civil.SLAB_T, top])
    assert node.geometry.is_watertight


def test_degenerate_features_yield_nothing_instead_of_raising():
    assert environment.build_env(feat("road", [[0, 0], [10, 10]]), GRID_CTX) == []
    assert environment.build_env(feat("paved", [[0, 0], [0, 0], [0, 0]]), GRID_CTX) == []
    assert environment.build_env(feat("land", [[0, 0], [5, 0], [10, 0]]), GRID_CTX) == []  # collinear


def test_a_closed_ring_and_a_bow_tie_still_build():
    ring = [*SQUARE, SQUARE[0]]
    (node,) = environment.build_env(feat("paved", ring), GRID_CTX)
    assert len(node.geometry.faces) == 12
    (bow,) = environment.build_env(feat("slope", [[0, 0], [10, 10], [10, 0], [0, 10]]), GRID_CTX)
    assert bow.geometry.volume > 0


def test_build_environment_uses_the_lowest_sea_for_every_land_skirt():
    feats = [
        feat("land", SQUARE, id_="a"),
        feat("sea", SQUARE, el=95.0, id_="s1"),
        feat("sea", SQUARE, el=93.0, id_="s2"),
        feat("road", U_SHAPE, id_="r"),
    ]
    nodes = environment.build_environment(feats, GRID_CTX)
    assert [n.name for n in nodes] == ["a", "a-edge", "s1", "s2", "r"]
    assert nodes[1].geometry.bounds[0, 1] == pytest.approx(93.0 - environment.SEA_TOE_M - 100.0)


def test_al_zour_landmask_builds_land_over_its_full_outline():
    rings = cowork()["landmask"]
    feats = [
        feat("land", rings["land"][0], id_="land"),
        feat("land", rings["main"][0], el=99.2, id_="mainland"),
        feat("sea", [[-1700, 3450], [4300, 3450], [4300, -550], [-1700, -550]], el=93.56, id_="sea"),
    ]
    nodes = environment.build_environment(feats, GRID_CTX)
    by = {n.name: n for n in nodes}
    assert by["land"].geometry.area == pytest.approx(Polygon(rings["land"][0]).area, rel=1e-6)
    assert materials(nodes) == {"Ground", "Rock_Armour", "Sea"}
    assert by["sea"].extras["env"] == "sea"
    assert np.isfinite(bounds(nodes)).all()
    assert same_geometry(nodes, environment.build_environment(feats, GRID_CTX))
    assert_golden([by["land"], by["land-edge"], by["mainland"], by["mainland-edge"]], "env_land", "top")
```

- [ ] **Step 2: Run them to see them fail**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_environment.py -v
```

Expected: collection error, `ImportError: cannot import name 'environment'`.

- [ ] **Step 3: Implement**

Create `backend/app/asset_models/builders/environment.py`:

```python
"""Environment meshes (plant model spec 2026-10-03 §5 EnvFeature, unit B3).

`build_env(feature, ctx)` turns one EnvFeature into scene-frame meshes (metres, x = plant N,
y = EL - datum, z = plant E; identity placement under the GLB's `environment/` group). Land is a
ground cap at `el` with a rock-armour skirt sloping down and out to below sea level; sea is a flat,
up-facing surface the Site 3D view swaps for its water shader (extras {"env": "sea"}); the other
kinds are thin slabs. Never raises: a degenerate feature yields [].
"""

from __future__ import annotations

import numpy as np
import trimesh
from shapely.geometry import Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode
from app.asset_models.builders.civil import (
    LIFT,
    SLAB_T,
    clean_line,
    is_closed,
    largest_polygon,
    prism,
    surface,
)
from app.asset_models.spec import EnvFeature

LAND_DEPTH_M = 8.0  # skirt drop when there is no sea feature (Cowork's platform slab depth)
SEA_TOE_M = 2.5  # the skirt toe sits this far below the sea surface (Cowork: -9 vs -6.44)
ARMOUR_RUN = 1.1  # horizontal run per metre of drop on the land edge (Cowork: 10 m over 9 m)
MATERIAL = {
    "road": "Asphalt",
    "paved": "Paving",
    "laydown": "Laydown",
    "slope": "Slope",
    "revetment": "Rock_Armour",
}


def _scene_ring(feature: EnvFeature, ctx: BuildCtx) -> tuple[Polygon, float]:
    pts = clean_line(np.asarray(feature.pts, dtype=float).reshape(-1, 2))
    if is_closed(pts):
        pts = pts[:-1]
    if len(pts) < 3:
        raise ValueError("an environment feature needs 3 distinct points")
    if ctx.grid is not None:
        xyz = np.asarray(ctx.grid.plant_to_scene(pts[:, 0], pts[:, 1], np.full(len(pts), feature.el)))
        xz, y0 = xyz[:, [0, 2]], float(xyz[0, 1])
    else:
        xz, y0 = np.column_stack([pts[:, 1], pts[:, 0]]), float(feature.el)
    return largest_polygon(Polygon(xz)), y0


def _skirt(poly: Polygon, y_top: float, y_toe: float) -> trimesh.Trimesh:
    """A band from the outline at y_top, out by ARMOUR_RUN per metre of drop, down to y_toe."""
    ring = np.asarray(poly.exterior.coords)[:-1]  # counter-clockwise in (x, z)
    run = (y_top - y_toe) * ARMOUR_RUN
    nxt, prv = np.roll(ring, -1, axis=0), np.roll(ring, 1, axis=0)

    def unit(v):
        return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)

    n_out = unit(np.column_stack([(nxt - ring)[:, 1], -(nxt - ring)[:, 0]]))
    n_in = unit(np.column_stack([(ring - prv)[:, 1], -(ring - prv)[:, 0]]))
    bis = unit(n_out + n_in)
    cos_half = np.clip(np.sum(bis * n_out, axis=1), 0.35, 1.0)  # mitre limit ~2.9x
    outer = ring + bis * (run / cos_half)[:, None]
    k = len(ring)
    v = np.vstack(
        [
            np.column_stack([ring[:, 0], np.full(k, y_top), ring[:, 1]]),
            np.column_stack([outer[:, 0], np.full(k, y_toe), outer[:, 1]]),
        ]
    )
    i = np.arange(k)
    j = (i + 1) % k
    faces = np.vstack([np.column_stack([i, k + i, j]), np.column_stack([j, k + i, k + j])])
    m = trimesh.Trimesh(v, faces, process=False)
    if m.face_normals[:, 1].mean() < 0:
        m = trimesh.Trimesh(v, faces[:, ::-1], process=False)
    return m


def build_env(feature: EnvFeature, ctx: BuildCtx, *, sea_el: float | None = None) -> list[MeshNode]:
    try:
        poly, y = _scene_ring(feature, ctx)
        extras = {"env": feature.kind, "id": feature.id}
        if feature.kind == "sea":
            return [MeshNode(feature.id, "Sea", surface(poly, y), extras)]
        if feature.kind == "land":
            drop = (feature.el - sea_el + SEA_TOE_M) if sea_el is not None else LAND_DEPTH_M
            drop = max(drop, 0.5)
            return [
                MeshNode(feature.id, "Ground", surface(poly, y), extras),
                MeshNode(f"{feature.id}-edge", "Rock_Armour", _skirt(poly, y, y - drop), dict(extras)),
            ]
        mat = MATERIAL[feature.kind]
        top = y + LIFT[mat]
        return [MeshNode(feature.id, mat, prism(poly, top - SLAB_T, top), extras)]
    except Exception:  # a broken feature never fails the GLB
        return []


def build_environment(features: list[EnvFeature], ctx: BuildCtx) -> list[MeshNode]:
    """Every feature, land skirts reaching below the lowest sea feature (when there is one)."""
    seas = [f.el for f in features if f.kind == "sea"]
    sea_el = min(seas) if seas else None
    return [n for f in features for n in build_env(f, ctx, sea_el=sea_el)]
```

- [ ] **Step 4: Write the golden, look at it, run the tests**

```powershell
$env:KESTREL_REGEN_GOLDEN = "1"; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_environment.py -k al_zour -q; Remove-Item Env:KESTREL_REGEN_GOLDEN
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_environment.py -v
```

Check `env_land_top.png`. It is a top view with plant north up and east right:
- on the left (west), the mainland as a wedge-shaped quadrilateral;
- to its right, the long Al-Zour platform, with its concave south-edge notch and the small round outfall bulge;
- a thin blue armour rim around both.

Expected: `14 passed`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_models/builders/environment.py backend/tests/test_builders_environment.py backend/tests/data/plant/golden/b3/env_land_top.png
git commit -m "feat(plant-b3): environment meshes - land with armour skirt, sea surface, flat kinds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Determinism, failure paths and the Cowork realism floor

**Files:**
- Modify: `backend/tests/test_builders_civil.py` (append)

**Interfaces:**
- Consumes: every B3 builder (civil and building families) through `REGISTRY`; the Task 2 fixture.
- Produces: the realism-floor and family-budget assertions (Review Focus 3 and 5).

- [ ] **Step 1: Write the tests** (append; add `import collections`, `build_item` from `app.asset_models.builders.base` and `same_geometry` from `plant_b3_helpers` to the imports)

```python
# ------------------------------------------------------------------ defaults, determinism, failure
def test_defaults_are_recorded_on_the_first_node():
    nodes = build_ok(make_item("fence", FENCE_30, top_el=None, params={"post_spacing": 2.0}))
    assert nodes[0].extras["defaults"] == ["post", "height"]
    nodes = build_ok(make_item("road", ROAD, params={"markings": False, "dash_m": 3.0, "gap_m": 6.0}))
    assert nodes[0].extras["defaults"] == []


@pytest.mark.parametrize("type_", CIVIL)
def test_builds_are_deterministic(type_):
    assert same_geometry(build_ok(sample(type_)), build_ok(sample(type_)))


@pytest.mark.parametrize("type_", CIVIL)
def test_meshes_are_finite_and_use_palette_materials(type_):
    nodes = build_ok(sample(type_))
    assert materials(nodes) <= set(PALETTE)
    assert np.isfinite(bounds(nodes)).all()


def test_zero_length_road_falls_back_instead_of_raising():
    item = make_item("road", {"kind": "line", "pts": [[E0, N0], [E0, N0]], "width": 8.0})
    _, flags = build_item(item, CTX)
    assert [f.code for f in flags] == ["builder_fallback"]


def test_bow_tie_paved_area_still_builds():
    fp = {"kind": "polygon", "pts": [[E0, N0], [E0 + 10, N0 + 10], [E0 + 10, N0], [E0, N0 + 10]]}
    nodes = build_ok(make_item("paved", fp))
    assert tri_count(nodes) > 0


# ------------------------------------------------------------------ Cowork realism floor and budget
COWORK_TYPES = CIVIL + ["building", "substation", "analyzer_house", "shelter", "gate"]


def test_every_cowork_b3_node_builds_with_at_least_its_materials():
    missing = []
    for node in cowork()["nodes"]:
        nodes = build_ok(cowork_item(node))
        if not set(node["materials"]) <= materials(nodes):
            missing.append((node["id"], node["materials"], sorted(materials(nodes))))
    assert not missing


def test_realism_floor_and_family_budget_against_cowork():
    ours, ref = collections.Counter(), collections.Counter()
    for node in cowork()["nodes"]:
        ours[node["type"]] += tri_count(build_ok(cowork_item(node)))
        ref[node["type"]] += node["tris"]
    low = {t: (ours[t], ref[t]) for t in ref if ours[t] < 0.8 * ref[t]}
    assert not low, f"below the Cowork realism floor: {low}"
    assert sum(ours.values()) <= 1.5 * sum(ref.values())  # spec §7: at most 1.5x Cowork's triangles
    assert set(ref) == set(COWORK_TYPES)
```

If F0's `build_item` returns a non-empty `other` node list on fallback, `test_zero_length_road_falls_back_instead_of_raising` still passes, because it reads only `flags`.

- [ ] **Step 2: Run them**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_civil.py -v
```

Expected: `63 passed`. Measured per-type ratios against Cowork:

| Type | Ours / Cowork |
| --- | --- |
| building | 2.35 |
| substation | 1.90 |
| basin | 0.88 |
| shelter | 2.07 |
| parking | 18.6 |
| road | 0.95 |
| paved | 0.99 |
| laydown | 1.00 |
| wall | 1.73 |
| fence | 1.02 |
| revetment | 1.00 |
| gate | 4.75 |
| analyzer_house | 1.21 |
| trench | 3.00 |
| channel | 3.60 |

Total: 52 276 / 40 568 = 1.29×.

If a type falls below 0.8×, raise that builder's detail. Do not lower the floor.

- [ ] **Step 3: Commit**

```powershell
git add backend/tests/test_builders_civil.py
git commit -m "test(plant-b3): determinism, fallback paths and the Cowork realism floor and budget" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full gate and handover

**Files:** none changed unless the gate finds something.

- [ ] **Step 1: Lint and format the backend**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b3\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .
```

Expected: `All checks passed!` and no files that would be reformatted. If ruff reports import order, run `ruff check --fix` on the B3 files only and re-run.

- [ ] **Step 2: Run the full gate** (AGENTS.md item 4, on the unit's port range)

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b3
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT = "1433"; $env:E2E_MOCK_PORT = "4023"; pnpm -C frontend e2e; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml } else { "cargo test skipped: no frozen sidecar" }
```

Expected:
- every step green;
- pytest includes the 63 + 30 + 14 B3 tests;
- `cargo test` is skipped in a fresh worktree.

B3 changes no frontend or contract file, so the frontend and contract steps prove only that nothing regressed. If the coordinator assigns other e2e ports, use those.

- [ ] **Step 3: Confirm the worktree is clean and the branch holds only B3 files**

```powershell
git status --short          # expect nothing
git diff --stat main...HEAD # only the files under "Shared-file touches: none" above
```

- [ ] **Step 4: Report READY_TO_MERGE with the operator line**

The operator walkthrough is one line:

> Not user-observable on its own: the building, civil and environment builders are used by A1's GLB assembly and become visible when a plant model is built and opened in the Site 3D view (S1/S3). Until then nothing in the app changes.

Also relay these to the coordinator:
- A1 should call `environment.build_environment(spec.environment, ctx)`, not `build_env` per feature, so land skirts reach the sea. It should place those nodes under `environment/` with an identity transform. It should read `nodes[0].extras["defaults"]` into the CSV `notes`.
- Rulings 1–5 above, so A1 and S2 pick up the `{"env": "sea"}` marker and the frame convention.

Do not merge, push, build an installer or run `/wrapup`.
