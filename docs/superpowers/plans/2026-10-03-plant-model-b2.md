# Plant model G1, unit B2: equipment builders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the 19 equipment-family builders (tank_lng, vessel_v, vessel_h, storage_tank_small, pump, pump_group, compressor, heater, vaporizer_orv, vaporizer_scv, stack, flare, loading_arm, crane, monitor, generator, transformer, package, nav_aid). Each one turns a plant `Item` into item-local meshes that are at least as detailed as the Cowork Al-Zour model.

**Architecture:**
- A package `backend/app/asset_models/builders/equipment/` holds:
  - a private geometry kit `_kit.py`;
  - six modules of builders: `vessels`, `tanks`, `rotating`, `power`, `process`, `jetty`.
- Each builder has:
  - a strict pydantic params model with a default for every field;
  - a catalogue doc;
  - a `default_height_m`;
  - one `@builder(...)` function registered in F0's `REGISTRY`.
- Builders are pure and deterministic. They return `MeshNode`s and use `Instanced` for repeated parts (posts, rungs, treads, panels, fins, bushings, pump units).
- The first node of every item carries `extras["defaults"]` and `extras["derived"]`, so the register notes can say what was assumed.

**Tech Stack:** Python 3.11, trimesh, numpy, shapely, pydantic v2, pytest, Pillow, plus M1's software rasterizer (`app/asset_models/raster.py`) for the golden renders. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§6, §13, §15). It is bound by the index `docs/superpowers/plans/2026-10-03-plant-model.md` (Global Constraints, Binding interfaces).

**Unit and placement:**

| Field | Value |
| --- | --- |
| Unit | B2 (equipment builders) |
| Worktree | `E:\Dev\Yolo\app\.claude\worktrees\pm-b2` |
| Branch | `task/pm-b2` |
| Cut after | F0 merged to `main` |
| Merge position | batch 2, in any order with B1, B3, A1, I1, C1, S1 and K1. A1's `other` fallback covers equipment types until B2 lands. |
| Interpreter | `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `E:\Dev\Yolo\app\.claude\worktrees\pm-b2\backend`. Never install anything. |

## Interfaces consumed (F0, exact names from the index)

```python
# app/asset_models/builders/base.py  (F0)
@dataclass(frozen=True)
class Instanced:  mesh: trimesh.Trimesh; transforms: np.ndarray           # (N, 4, 4), item-local metres
@dataclass
class MeshNode:   name: str; material: str; geometry: trimesh.Trimesh | Instanced; extras: dict = field(default_factory=dict)
@dataclass(frozen=True)
class BuildCtx:
    grid: PlantGrid | None
    lod: float = 1.0
    def local(self, item: Item, e, n) -> np.ndarray          # plant [E,N] -> item-local [x, z] (x north, z east)
    def height(self, item: Item, default_m: float) -> tuple[float, float, bool]   # (base_el, top_el, defaulted)
@dataclass(frozen=True)
class BuilderDef: type: str; family: ...; params: type[BaseModel]; fn: Callable[[Item, BuildCtx], list[MeshNode]]; doc: str; default_height_m: float
def builder(type: str, *, family: str, params: type[BaseModel], doc: str, default_height_m: float) -> Callable
# app/asset_models/builders/__init__.py  (F0)
REGISTRY: dict[str, BuilderDef]
def build_item(item: Item, ctx: BuildCtx) -> tuple[list[MeshNode], list[ItemFlag]]
def catalogue() -> list[dict]       # [{type, family, doc, default_height_m, params_schema}]
def load_all() -> None              # imports builders.equipment (ImportError-tolerant)
# app/asset_models/builders/palette.py  (F0)
PALETTE: dict[str, tuple[tuple[float, float, float, float], float, float]]   # Cowork's 34 names
# app/asset_models/builders/geom.py  (F0)
def segments_for(r, chord_err=0.02) -> int
# app/asset_models/siteframe.py  (F0)
def footprint_ref(fp: Footprint) -> tuple[float, float]
def footprint_polygon(fp: Footprint) -> np.ndarray      # (k, 2) plant [E, N]
# app/asset_models/spec.py  (F0 additions + M1)
Item, CircleFootprint, RectFootprint, PolygonFootprint, LineFootprint, ItemFlag, _Strict, Pos, NonNeg
# app/asset_models/raster.py  (M1, on main)
@dataclass(frozen=True) class View: kind: Literal["iso", "front", "side", "top", "section", "custom"]; ...
def render(meshes: dict[str, trimesh.Trimesh], view: View, *, size=1024, labels=False, groups=None, highlight=None) -> PIL.Image
```

B2 uses only `geom.segments_for` from `geom.py`. The index names the other helpers (`box`, `cyl`, `beam`, …) without pinning their axis conventions. B2 builds its own primitives in its private `_kit.py`, which the index permits: "Families may add helpers in their own module only". Task 1 pins every consumed behaviour with a probe test.

## Interfaces provided

```python
# app/asset_models/builders/equipment/  (package; importing it registers the builders)
# REGISTRY gains 19 BuilderDefs, family "equipment":
#   tank_lng 51.5 · vessel_v 8.0 · vessel_h 4.0 · storage_tank_small 8.0 · pump 2.0 · pump_group 2.5
#   compressor 6.0 · heater 5.0 · vaporizer_orv 8.0 · vaporizer_scv 6.0 · stack 15.0 · flare 50.0
#   loading_arm 18.0 · crane 8.0 · monitor 15.0 · generator 4.0 · transformer 4.0 · package 3.0 · nav_aid 6.0
#   (default_height_m)
# Params models (strict, every top-level field defaulted):
#   vessels.VesselVParams, vessels.VesselHParams, tanks.StorageTankSmallParams, tanks.TankLngParams
#   (+ tanks.RoofPlatform, tanks.RoofWalkway, tanks.COWORK_ROOF), rotating.PumpParams,
#   rotating.PumpGroupParams, rotating.CompressorParams, power.GeneratorParams,
#   power.TransformerParams, process.HeaterParams, process.OrvParams, process.ScvParams,
#   process.StackParams, process.FlareParams, process.PackageParams, jetty.LoadingArmParams,
#   jetty.CraneParams, jetty.MonitorParams, jetty.NavAidParams
# Extras on the FIRST MeshNode of every equipment item (for A1's register notes):
#   extras["defaults"]: list[str]              # params not given in item.params, sorted
#   extras["derived"]:  dict[str, float | str] # values derived from footprint/height (e.g. {"d_m": 5.9})
```

`_kit.py` is private to the equipment family. Other families must not import it.

## Global Constraints

The index's Global Constraints apply to every task. The ones this unit touches:
- **Builders are pure:** no DB, no I/O, deterministic for the same item. A builder never raises to the assembler, because `build_item` catches and falls back to `other` with a `builder_fallback` flag. B2 builders raise `ValueError` for input they cannot build.
- **Item-local frame:** metres, Y up from `base_el`, x = plant north, z = plant east, origin at `footprint_ref`. Builders rotate by `rot_deg` themselves.
- **Rect footprints:** `size = (along, across)`, along axis at `rot_deg` clockwise from plant north.
- **Materials** are Cowork palette names (`PALETTE` keys) only.
- **Repeated elements are instanced** (`Instanced`).
- **No meshopt; no new Python packages.** Never install into the shared venv.
- **Each family has a `tests/test_builders_<family>.py`:** here `backend/tests/test_builders_equipment.py`.
- **Git:** stage by path; never `git add -A`; never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identity "Danijel Jovanovic" / info@synapse-solutions.ai.
- **Full suites run only in the final gate** (Task 12). Earlier tasks run their own tests plus ruff on their own files.
- **Ruff (line length 110, rules E F I B UP):**
  - `ruff format` does not split string literals. If `ruff check` reports E501 on a doc or description string, split it into adjacent literals.
  - Every `zip` needs `strict=True` (B905).

## Budget

- **Background jobs:** none added. Builders run inside A1's `asset_model_glb` job (and in-process in R1's build step). Nothing here runs in a request.
- **Bounded per item (expanded triangles = faces × instances, at lod 1):**

  | Type | Floor (Cowork) | Ceiling |
  | --- | --- | --- |
  | tank_lng | 19 500 (0.8 × Cowork 24 596) | 32 000 |
  | vessel_v | 480 | 4 000 |
  | vessel_h | 408 | 2 000 |
  | storage_tank_small | 1 952 | 4 000 |
  | pump | 128 | 800 |
  | pump_group | 140 | 6 000 |
  | compressor | 104 | 3 000 |
  | heater | 36 | 2 000 |
  | vaporizer_orv | 252 | 4 000 |
  | vaporizer_scv | 36 | 2 000 |
  | stack | 192 | 2 500 |
  | flare | 404 | 5 000 |
  | loading_arm | 180 | 1 500 |
  | crane | 52 | 800 |
  | monitor | 92 | 1 500 |
  | generator | 36 | 1 500 |
  | transformer | 36 | 4 000 |
  | package | 36 | 800 |
  | nav_aid | 72 | 800 |

- **Al-Zour equipment estimate at the ceilings and typical sizes:** ≈ 380 k triangles. Cowork's equipment share is ≈ 263 k, so this stays within the spec's 1.5 × Cowork whole-model budget (§7) together with B1 and B3.
- **Instance counts are capped by params:**
  - pump_group `n ≤ 24`;
  - ORV `panels ≤ 60`;
  - transformer `bays ≤ 12`;
  - risers ≤ 12;
  - roof platforms ≤ 12;
  - posts, rungs and treads scale with the item's own perimeter and height.
- **Bounded reads:**
  - builders read no files;
  - the Cowork extraction script reads only the GLB's JSON chunk. It is a dev-time script and is not shipped in the app.

## Shared-file touches

- `backend/app/asset_models/builders/__init__.py` (F0): **no edit**. F0's `load_all()` imports `app.asset_models.builders.equipment`, and a package satisfies that import. If F0 created a placeholder `builders/equipment.py` module, Task 1 deletes it (`git rm`), because the package replaces it. That is the only possible touch.
- `backend/tests/data/plant/` is shared with K1 (register CSV, landmask) and B1/B3 (their own subfolders). B2 adds only:
  - `cowork_nodes/extract_equipment.py`;
  - `cowork_nodes/equipment.json`;
  - `golden/equipment/*.png`.
  
  Family-scoped names avoid merge collisions.

## Tests (files added or changed)

- Added: `backend/tests/test_builders_equipment.py` (the only test module).
- Added fixtures:
  - `backend/tests/data/plant/cowork_nodes/equipment.json` (Cowork reference stats, generated);
  - `backend/tests/data/plant/cowork_nodes/extract_equipment.py` (the generator);
  - `backend/tests/data/plant/golden/equipment/<case>_<view>.png` (golden renders, reviewed by eye).

## Execution DAG

```
T1 align with F0 ─ T2 kit ─ T3 harness + Cowork fixture ─┬─ T4 vessels ─┬─ T5 storage_tank_small ─ T6 tank_lng ─┐
                                                          │              └─ T9 heater, ORV, SCV ─ T10 stack, flare, package ─┤
                                                          ├─ T7 pump, pump_group ─ T8 compressor, generator, transformer ─────┤
                                                          └─ T11 loading_arm, crane, monitor, nav_aid ────────────────────────┴─ T12 gate
```

- **Independent units:** each task owns one or two builder modules plus its own `CASES` rows and goldens. The ordering constraints are:
  - T5 and T9 import `head_depth` from T4's `vessels.py`;
  - T6 extends T5's `tanks.py`;
  - T10 extends T9's `process.py`;
  - T8 extends T7's `rotating.py`.
- **Parallel batches:**
  - {T1}, {T2}, {T3};
  - then {T4, T7, T11};
  - then {T5, T8, T9};
  - then {T6, T10};
  - then {T12}.
  
  All of them share `equipment/__init__.py` (one import line) and `tests/test_builders_equipment.py` (a `CASES` dict with one marker comment per module). Implementers in one worktree therefore run them **sequentially** in task order. Parallel subagents would need a hand merge of those two files.
- **Critical path:** T1 → T2 → T3 → T4 → T5 → T6 → T12 (tank_lng is the largest builder).

## Rulings

1. **Package, not module.** The dispatch names `builders/equipment.py`. B2 ships `builders/equipment/` as a package (`__init__.py` + `_kit.py` + six modules), because 19 builders plus helpers is about 1 600 lines.
   - `import app.asset_models.builders.equipment` is unchanged, so F0's `load_all()` and the index's module name both hold.
2. **How defaults are recorded.** Spec §6 says "a defaulted value is recorded in the CSV notes". B2 records it on the first node of each item:
   - `extras["defaults"]`: the param names not given in `item.params`;
   - `extras["derived"]`: footprint- or height-derived values such as `d_m` and `axis_bearing_deg`.
   
   A1 builds the notes from them. If F0's `build_item` already records defaults, Task 1 keeps B2's keys anyway: they add the derived values.
3. **`tank_lng` is the whole tank.** It builds the base slab, the concrete wall and dome, the roof-edge deck and handrail, five roof platforms (pump, safety, instrument, flare, unloading) and the walking platform (walkway). It also builds a stair tower and the pipe risers.
   - Cowork splits these into `tank_structure` and untagged `platform`/`walkway` nodes. Those are folded into `tank_lng`. No 20th type is added.
   - Cowork tags the roof pumps, jib cranes and DCP package separately (`pump`, `crane`, `package`). They stay their own items and are not part of `tank_lng`.
   - The agent turns off built-in parts the drawing tags separately: `roof_platforms=[]`, `walkway=null`, `stair_tower_bearing_deg=null`, `risers_bearing_deg=null`.
4. **Default roof layout.** The default platform layout is Cowork's 20-T-0001, measured from its node footprints relative to the tank centre (1301.1, 555.4) and stored at the 93.5 m reference OD. For other diameters it scales by `OD / 93.5`.
5. **Footprint meaning per type:**
   - circle `d` is the shell or wall OD (tank_lng: the outer wall OD, the slab overhangs by `slab_overhang_m`);
   - rect is the plan envelope;
   - a polygon or line footprint uses its minimum rotated rectangle, with the long side as `along`.
6. **Orientation precedence (vessel_h and every axis-bearing builder):**
   1. an explicit param (`orient` `ns`/`ew` → 0°/90°; `slew_deg`, `aim_deg`);
   2. the rect footprint's `rot_deg`;
   3. the polygon's OBB long axis;
   4. north for a circle.
7. **Triangle counts** are expanded (faces × instances). The floor is Cowork's median for the type. `tank_lng` uses 0.8 × Cowork, because Cowork's 9 216-triangle roof rail is dense un-instanced geometry that B2 instances.
   - Ceilings come from the budget table. A builder outside its range is fixed in the builder (segments, pitches), never by widening the range.
8. **Height contract.** Every builder fills `[base_el, top_el]`: the top of its geometry is within `max(5 % H, 0.5 m)` of `top_el`. Nothing goes below `base_el`. A builder raises `ValueError` when the height cannot hold its parts, so `build_item` falls back to `other`.
9. **Realism fixtures.**
   - The Cowork GLB stays out of git. Its per-type numbers (count, triangles, sub-meshes, materials, example extents) go into `cowork_nodes/equipment.json`, written by a committed script.
   - Goldens are renders of B2's own builders, reviewed by eye. They are not Cowork renders.
10. **`pump_group`** is a row of `n` identical pumps on one plinth, with each pump part instanced. Cowork's engine-driven fire-water "pump_group" units are `n=1, driver=engine`.
11. **`vaporizer_scv.stack` defaults to off.** Cowork models the SCV stacks as separate `stack` items (`50-F-0001A-stack`).
12. **Ladder rungs** are at 0.3 m (real pitch) and stair treads at 0.2 m rise. Cages are omitted. Handrails have a top rail at 1.1 m and a knee rail at 0.55 m. Small tank roofs add a toe rail.
13. **The tank wall uses its own segment count:** `2πr / 2.75 m`, clamped 48..128, scaled by lod. It does not use `segments_for`, so tank realism does not depend on F0's chord tolerance.

## Planning smoke test

The planner assembled every code block in this plan against a minimal stand-in for F0. The stand-in followed the index's signatures, with `local` = `[N − N_ref, E − E_ref]`, `height` defaulting `top = base + default`, and `segments_for` = M1's chord rule at 0.02 m. With it, all 264 tests passed and goldens were generated.

The measured triangles at lod 1 are the reference for implementers. If the real F0 shifts these by more than about 10 %, check `segments_for` first.

| Case | Triangles |
| --- | --- |
| tank_lng | 27 912 (38 nodes) |
| vessel_v | 3 116 |
| vessel_v_drum | 604 |
| vessel_h | 940 |
| storage_tank_small | 1 994 |
| storage_tank_small_horizontal | 608 |
| pump (column) | 260 |
| pump_horizontal | 212 |
| pump_group | 852 |
| compressor | 1 332 |
| generator | 304 |
| transformer | 1 388 |
| heater | 736 |
| vaporizer_orv | 916 |
| vaporizer_scv | 864 |
| stack | 1 492 |
| flare | 2 368 |
| package (skid) | 208 |
| package_enclosure | 48 |
| package_cabinet | 36 |
| loading_arm | 444 |
| crane | 148 |
| monitor | 872 |
| nav_aid | 136 |

The only lint findings were E501 on long doc/description string literals (see the ruff note under Global Constraints).

## Deviations

- Spec §6 says "`BuildCtx` gives … the palette … and a triangle budget". The index's binding `BuildCtx` has only `grid` and `lod`. B2 follows the index: materials are palette names, and triangle budgets are enforced by the per-type test ranges above.
- Spec §6 places "reference renders of the Cowork nodes" at `cowork_nodes/`. B2 commits Cowork **numbers** (`equipment.json`) instead (ruling 9), because the Cowork GLB is client data kept out of git.

## Review Focus

The index's Review Focus names no B2 test. These five inputs are the most likely to bite the operator, and each has a test in the owning task:
1. **A rotated polygon footprint** (Cowork's 10-A-0003-G-01 generator is a 4-point polygon at about 84°). The builder must follow the long axis, not plant north.
   Test: `test_polygon_footprint_follows_long_axis` (Task 8).
2. **A tiny drum** (HP LNG pump vent drum: D 1.0 m × 1.8 m). It must build without a ladder or platform, with no negative lengths, and inside its footprint.
   Test: `test_tiny_vessel_v_has_no_ladder_or_platform` (Task 4).
3. **Unusable input:** `top_el == base_el`, a NaN param, or a height too small for a vessel's heads. `build_item` must return `other` geometry plus a `builder_fallback` flag and never raise.
   Test: `test_unusable_input_falls_back` (Task 12).
4. **An LNG tank of another diameter** (60 m). The platforms, walkway, stair tower and risers must scale and stay within the margin.
   Test: `test_tank_lng_scales_to_other_diameters` (Task 6).
5. **A crowded pump row** (`n=24` in a 3 m row). The triangles must stay bounded and every unit must stay inside the footprint.
   Test: `test_pump_group_max_units_stays_inside` (Task 7).

---

### Task 1: Align with merged F0

**Files:**
- Create: `backend/tests/test_builders_equipment.py`
- Possibly delete: `backend/app/asset_models/builders/equipment.py` (only if F0 left a placeholder)

**Interfaces:**
- Consumes: every F0 name in "Interfaces consumed".
- Produces: the test module header, `C`, `make_item`, `circle`, `rect`, `poly` (used by every later task).

- [ ] **Step 1: Read F0's real code.** Read `backend/app/asset_models/builders/__init__.py`, `base.py`, `palette.py`, `geom.py`, `fallback.py`, `backend/app/asset_models/siteframe.py` and the new classes in `backend/app/asset_models/spec.py`. Note:
  - the exact module that exports `REGISTRY`, `build_item`, `catalogue`, `load_all`, `builder`, `BuildCtx`, `MeshNode` and `Instanced`;
  - the signature of `BuildCtx.local`;
  - what `ctx.height` returns when `top_el` is null;
  - whether `builders/equipment.py` exists.

- [ ] **Step 2: Write the probe test** (`backend/tests/test_builders_equipment.py`):

```python
"""Equipment builders (unit B2, plan docs/superpowers/plans/2026-10-03-plant-model-b2.md)."""

from __future__ import annotations

import inspect

import numpy as np
import trimesh

from app.asset_models.builders import geom
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, builder
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon, footprint_ref
from app.asset_models.spec import Item

C = (1000.0, 500.0)  # plant [E, N] of every test item's reference point


def make_item(
    type_: str, footprint: dict, *, h: float | None = None, base: float = 100.0, params: dict | None = None
) -> Item:
    return Item.model_validate(
        {
            "id": f"t-{type_}",
            "name": type_,
            "type": type_,
            "footprint": footprint,
            "base_el": base,
            "top_el": None if h is None else base + h,
            "params": params or {},
            "source": {"kind": "assumed"},
        }
    )


def circle(d: float) -> dict:
    return {"kind": "circle", "center": list(C), "d": d}


def rect(along: float, across: float, rot: float = 0.0) -> dict:
    return {"kind": "rect", "center": list(C), "size": [along, across], "rot_deg": rot}


def poly(pts) -> dict:
    return {"kind": "polygon", "pts": [list(p) for p in pts]}


def test_f0_interfaces_b2_relies_on():
    # the decorator B2 registers with
    assert list(inspect.signature(builder).parameters) == [
        "type",
        "family",
        "params",
        "doc",
        "default_height_m",
    ]
    # segments_for: an int that grows with the radius
    assert isinstance(geom.segments_for(1.0), int)
    assert geom.segments_for(10.0) >= geom.segments_for(1.0) >= 3
    # BuildCtx: lod 1 by default; local() is vectorised plant [E, N] -> item-local [x north, z east]
    ctx = BuildCtx(grid=None)
    assert ctx.lod == 1.0
    it = make_item("other", rect(4.0, 2.0, 30.0), h=5.0)
    loc = np.asarray(ctx.local(it, np.array([C[0], C[0] + 1.0]), np.array([C[1] + 2.0, C[1]])), dtype=float)
    np.testing.assert_allclose(loc.reshape(-1, 2), [[2.0, 0.0], [0.0, 1.0]], atol=1e-9)
    # height(): (base_el, top_el, defaulted)
    assert ctx.height(it, 9.0) == (100.0, 105.0, False)
    assert ctx.height(make_item("other", rect(4.0, 2.0)), 9.0) == (100.0, 109.0, True)
    # polygon helpers: open ring of plant [E, N]; reference point = area centroid
    sq = poly([(C[0] - 1, C[1] - 1), (C[0] + 3, C[1] - 1), (C[0] + 3, C[1] + 1), (C[0] - 1, C[1] + 1)])
    p_it = make_item("other", sq, h=1.0)
    assert np.asarray(footprint_polygon(p_it.footprint)).shape == (4, 2)
    np.testing.assert_allclose(footprint_ref(p_it.footprint), (C[0] + 1, C[1]), atol=1e-9)
    # node containers
    assert MeshNode("a", "Concrete", trimesh.creation.box()).extras == {}
    Instanced(mesh=trimesh.creation.box(), transforms=np.eye(4)[None])
    # palette: Cowork's 34 names
    assert len(PALETTE) == 34
    assert {"Concrete_Tank", "Handrail", "Pump_Blue", "Aluminium_Panel", "Safety_Red"} <= set(PALETTE)
```

- [ ] **Step 3: Run it.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q`
  Expected: `1 passed`.
  - If a probe fails because F0 used a different name or module (for example `REGISTRY` in `base.py`, or `local` returning `(x, z)` as two arrays), change **only the import path or the adapter shape in the probe**. Keep every assertion's meaning.
  - Write the real names into this plan's "Interfaces consumed" block and the ledger. Later tasks use those names.
  - If F0's semantics differ (for example `local` swaps x and z, or `height` does not default), stop and report `BLOCKED: F0 semantics` with the failing assertion.

- [ ] **Step 4: Remove an F0 placeholder if present.** If `backend/app/asset_models/builders/equipment.py` exists, run `git rm backend/app/asset_models/builders/equipment.py`. Task 2 creates the package.

- [ ] **Step 5: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check tests/test_builders_equipment.py
git add backend/tests/test_builders_equipment.py
git commit -m "test(builders): pin the F0 interfaces the equipment family uses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Equipment geometry kit

**Files:**
- Create: `backend/app/asset_models/builders/equipment/__init__.py`
- Create: `backend/app/asset_models/builders/equipment/_kit.py`
- Modify: `backend/tests/test_builders_equipment.py` (append kit tests)

**Interfaces:**
- Consumes: `geom.segments_for`, `BuildCtx`, `Instanced`, `MeshNode`, `footprint_polygon`, `CircleFootprint`, `RectFootprint`, `Item`.
- Produces (`app.asset_models.builders.equipment._kit`, imported as `k`):
  - constants `POST_W, RAIL_W, RAIL_H, POST_PITCH, RUNG_PITCH, TREAD_RISE, DECK_T, Z_TO_Y, Y_TO_X`;
  - `segs(r, ctx, *, lo=8, hi=128) -> int`;
  - `T(x, y, z)`, `S(sx, sy, sz)`, `yaw(bearing_deg) -> (4,4)`;
  - `placed(mesh, M) -> Trimesh`;
  - `box(sx, sy, sz, *, x=0, y0=0, z=0)`;
  - `vcyl(r, h, ctx, *, x=0, y0=0, z=0, n=None)`;
  - `rod(p0, p1, r, ctx, *, n=None)`;
  - `bar(p0, p1, w, h=None)`;
  - `lathe(profile_ry, ctx, r_for_segs=None, *, n=None)`;
  - `ell_cap(r, depth, ctx, *, steps=8, n=None)`;
  - `slab(pts_xz, y0, t)`;
  - `inst(mesh, xforms) -> Instanced`;
  - `node(name, material, *meshes) -> MeshNode`;
  - `turn(nodes, M) -> list[MeshNode]`;
  - `edge_points(pts, closed, pitch)`;
  - `handrail(name, pts_xz, y_deck, *, closed=True, material="Handrail", pitch=POST_PITCH) -> list[MeshNode]` (nodes `<name>_posts`, `<name>_rails`);
  - `ring_handrail(name, r, y_deck, ctx, *, pitch=POST_PITCH, toe=False, material="Handrail")`;
  - `ladder(name, x, z, y0, y1, facing_deg, *, material="Steel_Structure")` (nodes `<name>_stiles`, `<name>_rungs`);
  - `stair_parts(p0, p1, width) -> (stringers, tread, xforms)`;
  - `stair(name, p0, p1, width) -> list[MeshNode]` (nodes `<name>_stringers`, `<name>_treads`);
  - `lattice(base_w, top_w, y0, y1, bay, leg_w, brace_w) -> list[Trimesh]`;
  - `Plan(cx, cz, along, across, bearing_deg, is_round)` with `.place() -> (4,4)`;
  - `plan_of(item, ctx) -> Plan`;
  - `height(item, ctx, default_m) -> tuple[float, bool]`;
  - `params(item, model)`;
  - `finish(nodes, item, p, derived) -> list[MeshNode]`.

- [ ] **Step 1: Write the failing kit tests.** Add to the imports of `backend/tests/test_builders_equipment.py`:

```python
import math

import pytest
from pydantic import BaseModel
```

and append:

```python
# ------------------------------------------------------------------ kit
from app.asset_models.builders.equipment import _kit as k  # noqa: E402


def test_kit_yaw_turns_north_to_the_bearing():
    v = k.yaw(90.0) @ np.array([1.0, 0.0, 0.0, 1.0])
    np.testing.assert_allclose(v[:3], [0.0, 0.0, 1.0], atol=1e-12)  # 90 deg = east = +z
    v = k.yaw(30.0) @ np.array([1.0, 0.0, 0.0, 1.0])
    np.testing.assert_allclose(v[:3], [math.cos(math.radians(30)), 0.0, math.sin(math.radians(30))], atol=1e-12)
    assert np.linalg.det(k.yaw(123.0)[:3, :3]) == pytest.approx(1.0)


def test_kit_primitives_sit_on_their_base_and_are_closed():
    ctx = BuildCtx(grid=None)
    b = k.box(2.0, 3.0, 4.0, x=1.0, y0=0.5, z=-1.0)
    np.testing.assert_allclose(b.bounds, [[0.0, 0.5, -3.0], [2.0, 3.5, 1.0]], atol=1e-9)
    c = k.vcyl(1.0, 2.0, ctx, y0=1.0)
    np.testing.assert_allclose(c.bounds[:, 1], [1.0, 3.0], atol=1e-9)
    assert c.is_watertight
    ring = k.lathe([(1.0, 0.0), (1.2, 0.0), (1.2, 0.5), (1.0, 0.5)], ctx)
    assert ring.is_watertight and ring.volume > 0
    cap = k.ell_cap(1.0, 0.5, ctx)
    np.testing.assert_allclose(cap.bounds[:, 1], [0.0, 0.5], atol=1e-6)


def test_kit_bar_and_rod_span_their_endpoints():
    ctx = BuildCtx(grid=None)
    m = k.bar((0, 0, 0), (3, 4, 0), 0.1)
    assert m.bounds[1][0] == pytest.approx(3.0, abs=0.08) and m.bounds[1][1] == pytest.approx(4.0, abs=0.08)
    with pytest.raises(ValueError, match="zero-length"):
        k.bar((1, 1, 1), (1, 1, 1), 0.1)
    r = k.rod((0, 1, 0), (5, 1, 0), 0.5, ctx)
    np.testing.assert_allclose(r.bounds[:, 0], [0.0, 5.0], atol=1e-9)


def test_kit_slab_extrudes_a_plan_polygon_upward():
    m = k.slab([(0, 0), (4, 0), (4, 2), (0, 2)], 1.0, 0.1)
    np.testing.assert_allclose(m.bounds, [[0.0, 1.0, 0.0], [4.0, 1.1, 2.0]], atol=1e-9)  # plan y -> z


def test_kit_handrail_posts_are_instanced_along_the_edges():
    nodes = k.handrail("p", [(0, 0), (3.6, 0), (3.6, 1.8), (0, 1.8)], 2.0)
    posts = next(n for n in nodes if n.name == "p_posts")
    assert isinstance(posts.geometry, Instanced)
    assert len(posts.geometry.transforms) == 2 + 1 + 2 + 1  # ceil(edge / 1.8) per edge, closed
    assert {n.name for n in nodes} == {"p_posts", "p_rails"}
    rails = next(n for n in nodes if n.name == "p_rails").geometry
    assert rails.bounds[1][1] == pytest.approx(2.0 + k.RAIL_H + k.RAIL_W / 2, abs=1e-6)


def test_kit_ladder_rungs_follow_the_pitch():
    nodes = k.ladder("l", 1.0, 0.0, 0.0, 3.0, 180.0)
    rungs = next(n for n in nodes if n.name == "l_rungs").geometry
    assert len(rungs.transforms) == len(np.arange(k.RUNG_PITCH, 3.0 - 0.05, k.RUNG_PITCH))
    assert k.ladder("l", 0, 0, 0, 0.4, 0) == []


def test_kit_stair_treads_follow_the_rise():
    nodes = k.stair("s", (0, 0, 0), (3, 2, 0), 1.0)
    treads = next(n for n in nodes if n.name == "s_treads").geometry
    assert len(treads.transforms) == math.ceil(2 / k.TREAD_RISE) - 1


def test_kit_turn_moves_meshes_and_instances_alike():
    ctx = BuildCtx(grid=None)
    nodes = [k.node("m", "Concrete", k.box(1, 1, 1, x=2)), MeshNode("i", "Grating", k.inst(k.box(1, 1, 1), [k.T(2, 0, 0)]))]
    out = k.turn(nodes, k.yaw(90.0))
    assert out[0].geometry.centroid[2] == pytest.approx(2.0)
    assert out[1].geometry.transforms[0][2, 3] == pytest.approx(2.0)
    assert nodes[0].geometry.centroid[0] == pytest.approx(2.0)  # inputs untouched
    assert ctx.lod == 1.0


def test_kit_plan_of_reads_every_footprint_kind():
    ctx = BuildCtx(grid=None)
    p = k.plan_of(make_item("other", circle(6.0), h=1), ctx)
    assert (p.along, p.across, p.bearing_deg, p.is_round) == (6.0, 6.0, 0.0, True)
    p = k.plan_of(make_item("other", rect(10.0, 4.0, 30.0), h=1), ctx)
    assert (p.along, p.across, p.bearing_deg) == (10.0, 4.0, 30.0)
    # a polygon whose long side runs N 30 deg E (clockwise from north)
    a = math.radians(30)
    u, v = np.array([math.sin(a), math.cos(a)]), np.array([math.cos(a), -math.sin(a)])  # [E, N]
    corners = [np.array(C) + su * 5 * u + sv * 2 * v for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    p = k.plan_of(make_item("other", poly(corners), h=1), ctx)
    assert p.along == pytest.approx(10.0) and p.across == pytest.approx(4.0)
    assert p.bearing_deg == pytest.approx(30.0, abs=1e-6)
    assert (p.cx, p.cz) == (pytest.approx(0.0, abs=1e-9), pytest.approx(0.0, abs=1e-9))


def test_kit_height_refuses_an_item_without_height():
    ctx = BuildCtx(grid=None)
    with pytest.raises(ValueError, match="height"):
        k.height(make_item("other", circle(1.0), h=0.0), ctx, 5.0)
    assert k.height(make_item("other", circle(1.0)), ctx, 5.0) == (5.0, True)


def test_kit_finish_records_defaults_and_derived():
    class P(BaseModel):
        a: float = 1.0
        b: float = 2.0

    it = make_item("other", circle(1.0), h=1.0, params={"a": 3.0})
    nodes = k.finish([k.node("x", "Concrete", k.box(1, 1, 1))], it, P(a=3.0), {"d_m": 1.23456, "kind": "x"})
    assert nodes[0].extras == {"defaults": ["b"], "derived": {"d_m": 1.235, "kind": "x"}}
    with pytest.raises(ValueError, match="no geometry"):
        k.finish([], it, P(), {})
```

- [ ] **Step 2: Run them to see them fail.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k kit`
  Expected: collection error `ModuleNotFoundError: No module named 'app.asset_models.builders.equipment'`.

- [ ] **Step 3: Write the package and the kit.**

`backend/app/asset_models/builders/equipment/__init__.py`:

```python
"""Equipment family (unit B2). Importing this package registers its builders in REGISTRY.

Modules are added to the import below as their builders land.
"""
```

`backend/app/asset_models/builders/equipment/_kit.py`:

```python
"""Equipment geometry kit (unit B2), private to the equipment family.

Item-local frame, metres: Y up from base_el, x = plant north, z = plant east, origin at the
footprint reference point. A bearing is clockwise from plant north, so bearing t points along
(cos t, 0, sin t), as in M1's placement. Everything here is pure and deterministic.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import trimesh
from pydantic import BaseModel
from shapely.geometry import Polygon

from app.asset_models.builders import geom
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import CircleFootprint, Item, RectFootprint

POST_W = 0.06  # handrail post section, m
RAIL_W = 0.05  # rail section, m
RAIL_H = 1.1  # top rail above the deck, m
POST_PITCH = 1.8  # post spacing on straight edges, m
RUNG_PITCH = 0.3  # ladder rung pitch, m
TREAD_RISE = 0.2  # stair riser, m
DECK_T = 0.08  # grating deck thickness, m

Z_TO_Y = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])  # +Z -> +Y
Y_TO_X = trimesh.transformations.rotation_matrix(-math.pi / 2, [0, 0, 1])  # +Y -> +X
_EXTRUDE_UP = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])  # plan y -> z, +Z -> -Y

Pt = Sequence[float]


def segs(r: float, ctx: BuildCtx, *, lo: int = 8, hi: int = 128) -> int:
    """Segments around a circle of radius r (m): F0's chord rule, scaled by the LOD, clamped."""
    n = geom.segments_for(max(float(r), 1e-3))
    return int(max(lo, min(hi, round(n * ctx.lod))))


def T(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def S(sx: float = 1.0, sy: float = 1.0, sz: float = 1.0) -> np.ndarray:
    return np.diag([sx, sy, sz, 1.0])


def yaw(bearing_deg: float) -> np.ndarray:
    """Rotation about +Y turning local +x (north) to the bearing, clockwise from north (90 = +z)."""
    a = math.radians(bearing_deg)
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, -s, s, c
    return m


def placed(mesh: trimesh.Trimesh, M: np.ndarray) -> trimesh.Trimesh:
    out = mesh.copy()
    out.apply_transform(M)  # trimesh flips the winding for a reflection
    return out


def box(sx: float, sy: float, sz: float, *, x: float = 0.0, y0: float = 0.0, z: float = 0.0) -> trimesh.Trimesh:
    """Axis-aligned box: sx along x (north), sy tall, sz along z (east); base at y0, centred on (x, z)."""
    m = trimesh.creation.box(extents=[sx, sy, sz])
    m.apply_translation([x, y0 + sy / 2, z])
    return m


def vcyl(
    r: float, h: float, ctx: BuildCtx, *, x: float = 0.0, y0: float = 0.0, z: float = 0.0, n: int | None = None
) -> trimesh.Trimesh:
    """A closed vertical cylinder standing on y0."""
    m = trimesh.creation.cylinder(radius=r, height=h, sections=n or segs(r, ctx))
    m.apply_transform(Z_TO_Y)
    m.apply_translation([x, y0 + h / 2, z])
    return m


def rod(p0: Pt, p1: Pt, r: float, ctx: BuildCtx, *, n: int | None = None) -> trimesh.Trimesh:
    """A closed cylinder between two points: pipes, arms, shells, risers."""
    return trimesh.creation.cylinder(
        radius=r, segment=[np.asarray(p0, float), np.asarray(p1, float)], sections=n or segs(r, ctx)
    )


def bar(p0: Pt, p1: Pt, w: float, h: float | None = None) -> trimesh.Trimesh:
    """A rectangular member between two points (w across, h deep; square when h is None)."""
    a, b = np.asarray(p0, float), np.asarray(p1, float)
    d = b - a
    length = float(np.linalg.norm(d))
    if length < 1e-6:
        raise ValueError("zero-length member")
    m = trimesh.creation.box(extents=[length, h or w, w])
    m.apply_transform(trimesh.geometry.align_vectors([1.0, 0.0, 0.0], d / length))
    m.apply_translation((a + b) / 2)
    return m


def lathe(
    profile_ry: Sequence[Pt], ctx: BuildCtx, r_for_segs: float | None = None, *, n: int | None = None
) -> trimesh.Trimesh:
    """Revolve a closed (r, y) profile about +Y. The profile is given open; it is closed here."""
    pts = np.asarray(profile_ry, dtype=float)
    if not np.allclose(pts[0], pts[-1]):
        pts = np.vstack([pts, pts[:1]])
    sections = n or segs(r_for_segs if r_for_segs is not None else float(pts[:, 0].max()), ctx)
    m = trimesh.creation.revolve(pts, sections=sections)
    m.apply_transform(Z_TO_Y)
    m.fix_normals()
    return m


def ell_cap(r: float, depth: float, ctx: BuildCtx, *, steps: int = 8, n: int | None = None) -> trimesh.Trimesh:
    """A solid half-ellipsoid: flat face on y = 0, crown at y = depth (2:1 head when depth = r / 2)."""
    ts = np.linspace(0.0, math.pi / 2, steps + 1)
    arc = [(r * math.cos(t), depth * math.sin(t)) for t in ts]
    return lathe([(0.0, 0.0), *arc], ctx, r, n=n)


def slab(pts_xz: Sequence[Pt], y0: float, t: float) -> trimesh.Trimesh:
    """Extrude a plan polygon (x north, z east) from y0 up by t."""
    m = trimesh.creation.extrude_polygon(Polygon([(float(p[0]), float(p[1])) for p in pts_xz]), t)
    m.apply_transform(_EXTRUDE_UP)
    m.apply_translation([0.0, y0 + t, 0.0])
    return m


def inst(mesh: trimesh.Trimesh, xforms) -> Instanced:
    x = np.asarray(xforms, dtype=float).reshape(-1, 4, 4)
    if len(x) == 0:
        raise ValueError("no instances")
    return Instanced(mesh=mesh, transforms=x)


def node(name: str, material: str, *meshes: trimesh.Trimesh) -> MeshNode:
    g = meshes[0] if len(meshes) == 1 else trimesh.util.concatenate(list(meshes))
    return MeshNode(name, material, g)


def turn(nodes: list[MeshNode], M: np.ndarray) -> list[MeshNode]:
    """Apply M to every node: meshes are transformed, instance transforms are left-multiplied."""
    out = []
    for nd in nodes:
        g = nd.geometry
        if isinstance(g, Instanced):
            g = Instanced(mesh=g.mesh, transforms=np.einsum("ij,njk->nik", M, g.transforms))
        else:
            g = placed(g, M)
        out.append(MeshNode(nd.name, nd.material, g, dict(nd.extras)))
    return out


def edge_points(pts: Sequence[Pt], closed: bool, pitch: float) -> list[np.ndarray]:
    """Points along a polyline, at most `pitch` apart, corners included."""
    ring = [np.asarray(p, dtype=float) for p in pts]
    edges = list(zip(ring, ring[1:] + ring[:1], strict=True)) if closed else list(zip(ring[:-1], ring[1:], strict=True))
    out: list[np.ndarray] = []
    for a, b in edges:
        steps = max(1, math.ceil(float(np.linalg.norm(b - a)) / pitch))
        out.extend(a + (b - a) * (i / steps) for i in range(steps))
    if not closed:
        out.append(ring[-1])
    return out


def handrail(
    name: str,
    pts_xz: Sequence[Pt],
    y_deck: float,
    *,
    closed: bool = True,
    material: str = "Handrail",
    pitch: float = POST_PITCH,
) -> list[MeshNode]:
    """Instanced posts plus top and knee rails along a plan polyline at deck level."""
    post = box(POST_W, RAIL_H, POST_W)
    xf = [T(float(p[0]), y_deck, float(p[1])) for p in edge_points(pts_xz, closed, pitch)]
    ring = [np.asarray(p, dtype=float) for p in pts_xz]
    edges = list(zip(ring, ring[1:] + ring[:1], strict=True)) if closed else list(zip(ring[:-1], ring[1:], strict=True))
    rails = [
        bar((a[0], y_deck + hh, a[1]), (b[0], y_deck + hh, b[1]), RAIL_W)
        for a, b in edges
        if float(np.linalg.norm(b - a)) > 1e-6
        for hh in (RAIL_H, RAIL_H / 2)
    ]
    return [
        MeshNode(f"{name}_posts", material, inst(post, xf)),
        MeshNode(f"{name}_rails", material, trimesh.util.concatenate(rails)),
    ]


def ring_handrail(
    name: str,
    r: float,
    y_deck: float,
    ctx: BuildCtx,
    *,
    pitch: float = POST_PITCH,
    toe: bool = False,
    material: str = "Handrail",
) -> list[MeshNode]:
    """A circular handrail of radius r: instanced posts plus revolved rails (and a toe rail)."""
    count = max(8, math.ceil(2 * math.pi * r / pitch))
    angles = np.linspace(0.0, 2 * math.pi, count, endpoint=False)
    xf = [T(r * math.cos(a), y_deck, r * math.sin(a)) for a in angles]
    heights = (RAIL_H - RAIL_W, RAIL_H / 2) + ((0.05,) if toe else ())
    half = RAIL_W / 2
    rails = [lathe([(r - half, y_deck + y), (r + half, y_deck + y), (r + half, y_deck + y + RAIL_W), (r - half, y_deck + y + RAIL_W)], ctx, r) for y in heights]
    return [
        MeshNode(f"{name}_posts", material, inst(box(POST_W, RAIL_H, POST_W), xf)),
        MeshNode(f"{name}_rails", material, trimesh.util.concatenate(rails)),
    ]


def ladder(
    name: str, x: float, z: float, y0: float, y1: float, facing_deg: float, *, material: str = "Steel_Structure"
) -> list[MeshNode]:
    """A vertical ladder at plan (x, z) from y0 to y1. facing_deg is the bearing the climber faces."""
    if y1 - y0 < 0.6:
        return []
    a = math.radians(facing_deg + 90.0)
    ux, uz = math.cos(a) * 0.225, math.sin(a) * 0.225
    stiles = trimesh.util.concatenate(
        [bar((x + s * ux, y0, z + s * uz), (x + s * ux, y1, z + s * uz), 0.06) for s in (-1, 1)]
    )
    nodes = [MeshNode(f"{name}_stiles", material, stiles)]
    ys = np.arange(y0 + RUNG_PITCH, y1 - 0.05, RUNG_PITCH)
    if len(ys):
        rung = bar((-0.225, 0.0, 0.0), (0.225, 0.0, 0.0), 0.03)
        turn_ = yaw(facing_deg + 90.0)
        nodes.append(MeshNode(f"{name}_rungs", material, inst(rung, [T(x, float(y), z) @ turn_ for y in ys])))
    return nodes


def stair_parts(p0: Pt, p1: Pt, width: float) -> tuple[trimesh.Trimesh, trimesh.Trimesh, list[np.ndarray]]:
    """A straight flight from p0 (bottom centre) to p1 (top centre): stringers, one tread mesh, tread xforms."""
    a, b = np.asarray(p0, dtype=float), np.asarray(p1, dtype=float)
    run = b - a
    flat = np.array([run[0], 0.0, run[2]])
    reach = float(np.linalg.norm(flat))
    if reach < 1e-6 or run[1] <= 0:
        raise ValueError("a stair flight needs rise and run")
    u = flat / reach
    side = np.array([-u[2], 0.0, u[0]]) * (width / 2)
    stringers = trimesh.util.concatenate([bar(a + s * side, b + s * side, 0.08, 0.25) for s in (-1, 1)])
    steps = max(2, math.ceil(run[1] / TREAD_RISE))
    turn_ = yaw(math.degrees(math.atan2(u[2], u[0])))
    xforms = [T(*(a + run * (i / steps))) @ turn_ for i in range(1, steps)]
    return stringers, box(0.25, 0.04, width), xforms


def stair(name: str, p0: Pt, p1: Pt, width: float) -> list[MeshNode]:
    stringers, tread, xforms = stair_parts(p0, p1, width)
    return [
        MeshNode(f"{name}_stringers", "Steel_Structure", stringers),
        MeshNode(f"{name}_treads", "Grating", inst(tread, xforms)),
    ]


def lattice(
    base_w: float, top_w: float, y0: float, y1: float, bay: float, leg_w: float, brace_w: float
) -> list[trimesh.Trimesh]:
    """A square tapering lattice tower: legs, X bracing on every face and a ring at every bay level."""
    nb = max(1, math.ceil((y1 - y0) / bay))
    ys = [y0 + (y1 - y0) * i / nb for i in range(nb + 1)]
    corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))

    def pt(c, y):
        half = (base_w + (top_w - base_w) * (y - y0) / (y1 - y0)) / 2
        return (c[0] * half, y, c[1] * half)

    out = []
    for i in range(nb):
        lo, hi = ys[i], ys[i + 1]
        for j, c in enumerate(corners):
            c2 = corners[(j + 1) % 4]
            out += [
                bar(pt(c, lo), pt(c, hi), leg_w),
                bar(pt(c, lo), pt(c2, hi), brace_w),
                bar(pt(c2, lo), pt(c, hi), brace_w),
                bar(pt(c, hi), pt(c2, hi), brace_w),
            ]
    return out


@dataclass(frozen=True)
class Plan:
    """An item's plan envelope in item-local metres: centre, sizes, long-axis bearing."""

    cx: float
    cz: float
    along: float
    across: float
    bearing_deg: float
    is_round: bool

    def place(self) -> np.ndarray:
        """Plan frame (centre at origin, along = +x) -> item-local."""
        return T(self.cx, 0.0, self.cz) @ yaw(self.bearing_deg)


def plan_of(item: Item, ctx: BuildCtx) -> Plan:
    fp = item.footprint
    if isinstance(fp, CircleFootprint):
        return Plan(0.0, 0.0, float(fp.d), float(fp.d), 0.0, True)
    if isinstance(fp, RectFootprint):
        return Plan(0.0, 0.0, float(fp.size[0]), float(fp.size[1]), float(fp.rot_deg) % 360.0, False)
    ring = np.asarray(footprint_polygon(fp), dtype=float)
    loc = np.asarray(ctx.local(item, ring[:, 0], ring[:, 1]), dtype=float).reshape(-1, 2)
    rect = Polygon(loc).minimum_rotated_rectangle
    c = np.asarray(rect.exterior.coords)[:4]
    e0, e1 = c[1] - c[0], c[2] - c[1]
    a, b = (e0, e1) if np.linalg.norm(e0) >= np.linalg.norm(e1) else (e1, e0)
    centre = c.mean(axis=0)
    bearing = math.degrees(math.atan2(a[1], a[0])) % 180.0
    return Plan(float(centre[0]), float(centre[1]), float(np.linalg.norm(a)), float(np.linalg.norm(b)), bearing, False)


def height(item: Item, ctx: BuildCtx, default_m: float) -> tuple[float, bool]:
    """Usable height H = top_el - base_el, and whether it was defaulted. Raises when there is none."""
    base, top, defaulted = ctx.height(item, default_m)
    h = float(top) - float(base)
    if not math.isfinite(h) or h <= 0.05:
        raise ValueError("item has no usable height")
    return h, bool(defaulted)


def params(item: Item, model: type[BaseModel]):
    return model.model_validate(item.params)


def finish(nodes: list[MeshNode], item: Item, p: BaseModel, derived: dict) -> list[MeshNode]:
    """Record the defaulted params and the derived values on the first node (A1 writes them to notes)."""
    if not nodes:
        raise ValueError("builder produced no geometry")
    given = set(item.params)
    nodes[0].extras["defaults"] = sorted(f for f in type(p).model_fields if f not in given)
    nodes[0].extras["derived"] = {
        key: (round(float(v), 3) if isinstance(v, int | float) and not isinstance(v, bool) else v)
        for key, v in sorted(derived.items())
    }
    return nodes
```

- [ ] **Step 4: Run the kit tests.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q`
  Expected: `12 passed`.
  If `test_kit_handrail_posts_are_instanced_along_the_edges` counts differ, check `edge_points`: the closed polygon has edges of 3.6, 1.8, 3.6 and 1.8 m at a 1.8 m pitch, giving 2 + 1 + 2 + 1 posts.

- [ ] **Step 5: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/__init__.py backend/app/asset_models/builders/equipment/_kit.py backend/tests/test_builders_equipment.py
git commit -m "feat(builders): equipment geometry kit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Test harness and Cowork reference fixture

**Files:**
- Create: `backend/tests/data/plant/cowork_nodes/extract_equipment.py`
- Create (generated): `backend/tests/data/plant/cowork_nodes/equipment.json`
- Modify: `backend/tests/test_builders_equipment.py` (harness and generic parametrised tests)

**Interfaces:**
- Consumes: `REGISTRY`, `build_item`, `load_all`, `PALETTE`, `raster.View`, `raster.render`, the kit.
- Produces (in the test module), used by Tasks 4–12:
  - `Case(type, footprint, h, params, margin, tris, parts, golden)`;
  - `CASES: dict[str, Case]` with one marker comment per module;
  - `FIRST`;
  - `built(cid, lod=1.0)`;
  - `make(case)`;
  - `expanded(geometry)`;
  - `tris(nodes)`;
  - `bounds(nodes)`;
  - `footprint_box(fp)`;
  - `principal_bearing(nodes, name)`;
  - `render_nodes(nodes, view)`.

- [ ] **Step 1: Write the extraction script** (`backend/tests/data/plant/cowork_nodes/extract_equipment.py`):

```python
"""Extract the Cowork reference stats for the equipment family (unit B2).

Reads the git-ignored Cowork GLB's JSON chunk and writes `equipment.json` beside this script: per
type, the node count, triangle min/median/max, sub-mesh (primitive) count, materials and one
example. tank_lng is a group node in Cowork; its reference is the group minus the separately
tagged roof pumps, cranes and package.

    python tests/data/plant/cowork_nodes/extract_equipment.py <KIPIC_AlZour_LNG_Plant.glb>
"""

from __future__ import annotations

import json
import statistics
import struct
import sys
from pathlib import Path

TYPES = [
    "tank_lng",
    "vessel_v",
    "vessel_h",
    "storage_tank_small",
    "pump",
    "pump_group",
    "compressor",
    "heater",
    "vaporizer_orv",
    "vaporizer_scv",
    "stack",
    "flare",
    "loading_arm",
    "crane",
    "monitor",
    "generator",
    "transformer",
    "package",
    "nav_aid",
]
TAGGED_ON_ROOF = {"pump", "crane", "package"}  # tagged items of their own, not part of tank_lng


def read_gltf(path: Path) -> dict:
    data = path.read_bytes()
    clen, ctype = struct.unpack_from("<I4s", data, 12)
    if ctype != b"JSON":
        raise ValueError("the first GLB chunk is not JSON")
    return json.loads(data[20 : 20 + clen])


def mesh_stats(doc: dict, node: dict) -> tuple[int, list[str], list[float]]:
    acc, mats = doc["accessors"], [m["name"] for m in doc["materials"]]
    if "mesh" not in node:
        return 0, [], [0.0, 0.0, 0.0]
    tris, names, lo, hi = 0, [], [1e18] * 3, [-1e18] * 3
    for prim in doc["meshes"][node["mesh"]]["primitives"]:
        ref = prim.get("indices", prim["attributes"]["POSITION"])
        tris += acc[ref]["count"] // 3
        names.append(mats[prim.get("material", 0)])
        pos = acc[prim["attributes"]["POSITION"]]
        lo = [min(a, b) for a, b in zip(lo, pos["min"], strict=True)]
        hi = [max(a, b) for a, b in zip(hi, pos["max"], strict=True)]
    return tris, names, [round(h - low, 2) for low, h in zip(lo, hi, strict=True)]


def main(glb: Path) -> dict:
    doc = read_gltf(glb)
    nodes = doc["nodes"]
    out: dict = {"source": f"Cowork {glb.name}, extras.type per node", "types": {}}
    for t in TYPES:
        rows = []
        for n in nodes:
            if (n.get("extras") or {}).get("type") != t:
                continue
            if t == "tank_lng":
                kids = [nodes[c] for c in n.get("children", [])]
                kids = [kd for kd in kids if (kd.get("extras") or {}).get("type") not in TAGGED_ON_ROOF]
                stats = [mesh_stats(doc, kd) for kd in kids]
                ext = max((s[2] for s in stats), key=lambda e: e[0] * e[2])
                mats = [m for s in stats for m in s[1]]
                rows.append((n["name"], sum(s[0] for s in stats), mats, ext, [kd["name"] for kd in kids]))
            elif "mesh" in n:
                tris, mats, ext = mesh_stats(doc, n)
                rows.append((n["name"], tris, mats, ext, None))
        counts = [r[1] for r in rows]
        first = rows[0]
        entry = {
            "count": len(rows),
            "tris_min": min(counts),
            "tris_median": int(statistics.median(counts)),
            "tris_max": max(counts),
            "submeshes_max": max(len(r[2]) for r in rows),
            "materials": sorted({m for r in rows for m in r[2]}),
            "example": {"node": first[0], "tris": first[1], "extents_m": first[3]},
        }
        if first[4]:
            entry["example"]["children"] = first[4]
        out["types"][t] = entry
    return out


if __name__ == "__main__":
    result = main(Path(sys.argv[1]))
    dest = Path(__file__).with_name("equipment.json")
    dest.write_text(json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {dest} ({len(result['types'])} types)")
```

- [ ] **Step 2: Generate the fixture.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe tests/data/plant/cowork_nodes/extract_equipment.py E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic\KIPIC_AlZour_LNG_Plant.glb`
  Expected: `wrote …equipment.json (19 types)`. Spot-check that the file matches what planning measured:

  | type | count | tris median | submeshes_max | materials |
  | --- | --- | --- | --- | --- |
  | tank_lng | 8 | 24596 | 19 | Concrete, Concrete_Tank, Grating, Handrail, Steel_Structure |
  | vessel_v | 23 | 480 | 2 | Concrete, Equipment_White |
  | vessel_h | 13 | 408 | 2 | Concrete, Equipment_White |
  | storage_tank_small | 13 | 1952 | 3 | Concrete, Equipment_White, Handrail |
  | pump | 91 | 128 | 3 | Concrete, Equipment_Grey, Pump_Blue, Steel_Dark |
  | pump_group | 5 | 140 | 3 | Concrete, Equipment_Grey, Pump_Blue |
  | compressor | 6 | 104 | 2 | Concrete, Machine_Green |
  | heater | 15 | 36 | 2 | Concrete, Equipment_White |
  | vaporizer_orv | 12 | 252 | 4 | Aluminium_Panel, Concrete, Concrete_Dark, Equipment_Grey |
  | vaporizer_scv | 3 | 36 | 3 | Concrete, Equipment_Grey, Machine_Green |
  | stack | 3 | 192 | 2 | Safety_Red, Steel_Dark |
  | flare | 1 | 404 | 3 | Safety_Red, Steel_Dark, Steel_Structure |
  | loading_arm | 8 | 180 | 2 | Equipment_White, Handrail |
  | crane | 16 | 52 | 1 | Handrail |
  | monitor | 4 | 92 | 2 | Grating, Safety_Red |
  | generator | 5 | 36 | 3 | Concrete, Equipment_White, Machine_Green |
  | transformer | 5 | 36 | 3 | Concrete, Steel_Dark, Steel_Structure |
  | package | 91 | 36 | 3 | Concrete, Equipment_Grey, Equipment_White, Safety_Red |
  | nav_aid | 4 | 72 | 2 | Handrail, Safety_Red |

  If the GLB is not at that path, look for it under `backend/tests/data/plant/` (K1 may fetch it there). Never commit the GLB.

- [ ] **Step 3: Write the harness and the generic tests.** Add to the imports:

```python
import functools
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image
from shapely.geometry import Polygon

from app.asset_models.builders import REGISTRY, build_item, load_all
from app.asset_models.raster import View, render
```

and append:

```python
# ------------------------------------------------------------------ harness
load_all()
DATA = Path(__file__).parent / "data" / "plant"
GOLDEN = DATA / "golden" / "equipment"
COWORK = json.loads((DATA / "cowork_nodes" / "equipment.json").read_text(encoding="utf-8"))["types"]
UPDATE = os.environ.get("KESTREL_UPDATE_GOLDENS") == "1"
CTX = BuildCtx(grid=None)
RASTER_GROUP = {  # palette material -> M1 raster colour group, for readable goldens
    "Concrete": "Bottom",
    "Concrete_Tank": "Bottom",
    "Concrete_Dark": "Lining",
    "Steel_Dark": "Lining",
    "Steel_Structure": "Support",
    "Pump_Blue": "Support",
    "Grating": "Access",
    "Machine_Green": "Access",
    "Handrail": "Nozzle",
    "Safety_Red": "Manway",
    "Pipe": "Internal",
    "Pipe_Insulated": "Internal",
}


@dataclass(frozen=True)
class Case:
    type: str
    footprint: dict
    h: float
    params: dict = field(default_factory=dict)
    margin: float = 0.3  # m allowed outside the footprint's local bounding box
    tris: tuple[int, int] = (1, 4000)
    parts: frozenset[str] = frozenset()  # node names that must be present
    golden: tuple[str, ...] = ("iso",)


CASES: dict[str, Case] = {
    # --- vessels (Task 4)
    # --- tanks (Tasks 5, 6)
    # --- rotating (Tasks 7, 8)
    # --- power (Task 8)
    # --- process (Tasks 9, 10)
    # --- jetty (Task 11)
}
FIRST: dict[str, str] = {}
for _cid, _case in CASES.items():
    FIRST.setdefault(_case.type, _cid)
IDS = list(CASES)
TYPES_BUILT = sorted(FIRST)


def make(c: Case) -> Item:
    return make_item(c.type, c.footprint, h=c.h, params=c.params)


@functools.cache
def built(cid: str, lod: float = 1.0) -> tuple:
    c = CASES[cid]
    return tuple(REGISTRY[c.type].fn(make(c), BuildCtx(grid=None, lod=lod)))


def expanded(g) -> trimesh.Trimesh:
    if isinstance(g, Instanced):
        return trimesh.util.concatenate([g.mesh.copy().apply_transform(t) for t in g.transforms])
    return g


def tris(nodes) -> int:
    return sum(
        len(n.geometry.mesh.faces) * len(n.geometry.transforms)
        if isinstance(n.geometry, Instanced)
        else len(n.geometry.faces)
        for n in nodes
    )


def bounds(nodes) -> tuple[np.ndarray, np.ndarray]:
    b = np.array([expanded(n.geometry).bounds for n in nodes])
    return b[:, 0].min(axis=0), b[:, 1].max(axis=0)


def footprint_box(fp: dict) -> tuple[tuple[float, float], tuple[float, float]]:
    """The footprint's bounding box in item-local [x north, z east], origin at footprint_ref."""
    if fp["kind"] == "circle":
        r = fp["d"] / 2
        return (-r, -r), (r, r)
    if fp["kind"] == "rect":
        a = math.radians(fp["rot_deg"])
        u, v = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
        al, ac = fp["size"]
        pts = [su * al / 2 * u + sv * ac / 2 * v for su in (-1, 1) for sv in (-1, 1)]
    else:
        en = np.asarray(fp["pts"], dtype=float)
        ref = Polygon(en).centroid
        pts = [np.array([n_ - ref.y, e_ - ref.x]) for e_, n_ in en]
    p = np.array(pts)
    return tuple(p.min(axis=0)), tuple(p.max(axis=0))


def principal_bearing(nodes, name: str) -> float:
    """Plan bearing (0..180, clockwise from north) of a node's long axis."""
    v = expanded(next(n for n in nodes if n.name == name).geometry).vertices
    xz = v[:, [0, 2]] - v[:, [0, 2]].mean(axis=0)
    _, vec = np.linalg.eigh(np.cov(xz.T))
    a = vec[:, -1]
    return math.degrees(math.atan2(a[1], a[0])) % 180.0


def render_nodes(nodes, view: str) -> Image.Image:
    meshes = {n.name: expanded(n.geometry) for n in nodes}
    groups = {n.name: RASTER_GROUP.get(n.material, "Shell") for n in nodes}
    return render(meshes, View(view), size=256, groups=groups)


def test_harness_types_are_cowork_types():
    assert set(FIRST) <= set(COWORK)


@pytest.mark.parametrize("cid", IDS)
def test_builds_clean_nodes(cid):
    nodes = built(cid)
    assert nodes
    names = [n.name for n in nodes]
    assert len(set(names)) == len(names), "node names repeat"
    for n in nodes:
        assert n.material in PALETTE, (n.name, n.material)
        m = expanded(n.geometry)
        assert len(m.faces) > 0 and np.isfinite(m.vertices).all(), n.name
    missing = CASES[cid].parts - set(names)
    assert not missing, missing


@pytest.mark.parametrize("cid", IDS)
def test_bounds(cid):
    c = CASES[cid]
    lo, hi = bounds(built(cid))
    (x0, z0), (x1, z1) = footprint_box(c.footprint)
    assert lo[0] >= x0 - c.margin and hi[0] <= x1 + c.margin, (lo, hi, (x0, x1))
    assert lo[2] >= z0 - c.margin and hi[2] <= z1 + c.margin, (lo, hi, (z0, z1))
    assert lo[1] >= -0.01
    assert abs(hi[1] - c.h) <= max(0.05 * c.h, 0.5), (hi[1], c.h)


@pytest.mark.parametrize("cid", IDS)
def test_triangle_range(cid):
    lo, hi = CASES[cid].tris
    assert lo <= tris(built(cid)) <= hi, tris(built(cid))


@pytest.mark.parametrize("type_", TYPES_BUILT)
def test_realism_floor_vs_cowork(type_):
    nodes = built(FIRST[type_])
    ref = COWORK[type_]
    floor = int(0.8 * ref["tris_median"]) if type_ == "tank_lng" else ref["tris_median"]
    assert tris(nodes) >= floor
    assert len(nodes) >= ref["submeshes_max"]
    assert len({n.material for n in nodes}) >= min(len(ref["materials"]), 2)


@pytest.mark.parametrize("type_", TYPES_BUILT)
def test_registered_with_catalogue_fields(type_):
    d = REGISTRY[type_]
    assert d.family == "equipment"
    assert d.default_height_m > 0
    assert 40 <= len(d.doc) <= 600
    d.params.model_validate({})  # every top-level param has a default
    assert d.params.model_json_schema()["properties"]


@pytest.mark.parametrize("type_", TYPES_BUILT)
def test_defaults_recorded(type_):
    c = CASES[FIRST[type_]]
    nodes = built(FIRST[type_])
    fields = REGISTRY[type_].params.model_fields
    assert nodes[0].extras["defaults"] == sorted(f for f in fields if f not in c.params)
    assert nodes[0].extras["derived"], "derived values missing"


@pytest.mark.parametrize("cid", IDS)
def test_deterministic(cid):
    c = CASES[cid]
    a = REGISTRY[c.type].fn(make(c), CTX)
    b = REGISTRY[c.type].fn(make(c), CTX)
    assert [n.name for n in a] == [n.name for n in b]
    for x, y in zip(a, b, strict=True):
        gx, gy = x.geometry, y.geometry
        if isinstance(gx, Instanced):
            assert np.array_equal(gx.transforms, gy.transforms)
            gx, gy = gx.mesh, gy.mesh
        assert np.array_equal(gx.vertices, gy.vertices) and np.array_equal(gx.faces, gy.faces)


@pytest.mark.parametrize("cid", IDS)
def test_build_item_uses_the_builder(cid):
    nodes, flags = build_item(make(CASES[cid]), CTX)
    assert not [f for f in flags if f.code == "builder_fallback"]
    assert CASES[cid].parts <= {n.name for n in nodes}


@pytest.mark.parametrize(("cid", "view"), [(cid, v) for cid, c in CASES.items() for v in c.golden])
def test_golden_render(cid, view):
    img = render_nodes(built(cid), view)
    path = GOLDEN / f"{cid}_{view}.png"
    if UPDATE:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
        return
    assert path.exists(), f"missing golden {path.name}: run with KESTREL_UPDATE_GOLDENS=1 and review it"
    golden = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    diff = np.abs(np.asarray(img, dtype=np.int16) - golden)
    assert (diff > 40).mean() < 0.01  # under 1 % of pixels differ visibly
```

- [ ] **Step 4: Run the harness.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q`
  Expected: the kit and probe tests pass, `test_harness_types_are_cowork_types` passes, and the parametrised tests are reported as skipped ("got empty parameter set").

- [ ] **Step 5: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format tests/test_builders_equipment.py tests/data/plant/cowork_nodes/extract_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check tests/test_builders_equipment.py tests/data/plant/cowork_nodes/extract_equipment.py
git add backend/tests/test_builders_equipment.py backend/tests/data/plant/cowork_nodes/extract_equipment.py backend/tests/data/plant/cowork_nodes/equipment.json
git commit -m "test(builders): equipment harness and Cowork reference stats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: vessel_v and vessel_h

**Files:**
- Create: `backend/app/asset_models/builders/equipment/vessels.py`
- Modify: `backend/app/asset_models/builders/equipment/__init__.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): `backend/tests/data/plant/golden/equipment/vessel_v_iso.png`, `vessel_h_iso.png`, `vessel_h_top.png`

**Interfaces:**
- Consumes: the kit (`k.*`), `builder`, `_Strict`, `Pos`, `NonNeg`.
- Produces: `vessels.VesselVParams`, `vessels.VesselHParams`, registered builders `vessel_v` and `vessel_h`.
- **Node names:**
  - vessel_v: `plinth`, `shell`, `head_top`, `head_bottom`, optional `skirt`, `nozzles`, `platform_deck`, `platform_posts`, `platform_rails`, `ladder_stiles`, `ladder_rungs`.
  - vessel_h: `shell`, `head_a`, `head_b`, `piers`, `saddles`, optional `nozzles`, `manway`.
- **Derived values:**
  - vessel_v: `d_m`, `skirt_h_m`, `shell_len_m`;
  - vessel_h: `d_m`, `saddle_h_m`, `length_m`, `axis_bearing_deg`.

- [ ] **Step 1: Add the cases and the specific tests.** Under `# --- vessels (Task 4)` in `CASES`:

```python
    "vessel_v": Case(  # Cowork 30-V-0001 recondenser: D 5.9, 25 m
        "vessel_v",
        circle(5.9),
        25.0,
        margin=1.2,
        tris=(480, 4000),
        parts=frozenset({"plinth", "shell", "head_top", "head_bottom", "skirt", "nozzles", "ladder_rungs"}),
    ),
    "vessel_v_drum": Case(  # Cowork 30-V-0002A vent drum on PF 104.5: D ~1.0, 1.8 m
        "vessel_v", circle(1.0), 1.8, margin=0.4, tris=(100, 4000), golden=()
    ),
    "vessel_h": Case(  # Cowork 10-V-0001 jetty KO drum: L 17.4, W 3.86, rot 96
        "vessel_h",
        rect(17.4, 3.86, 96.0),
        3.86,
        margin=0.5,
        tris=(408, 2000),
        parts=frozenset({"shell", "head_a", "head_b", "saddles", "piers"}),
        golden=("iso", "top"),
    ),
```

Append the specific tests:

```python
# ------------------------------------------------------------------ vessels
def test_tiny_vessel_v_has_no_ladder_or_platform():  # Review Focus 2
    names = {n.name for n in built("vessel_v_drum")}
    assert not any(n.startswith(("ladder", "platform")) for n in names)
    assert {"shell", "head_top", "head_bottom"} <= names


def test_tall_vessel_v_gets_ladder_and_platform_by_default():
    names = {n.name for n in built("vessel_v")}
    assert {"ladder_rungs", "platform_deck", "platform_posts"} <= names


@pytest.mark.parametrize(
    ("footprint", "orient", "expected"),
    [
        (rect(17.4, 3.86, 0.0), None, 0.0),
        (rect(17.4, 3.86, 30.0), None, 30.0),
        (rect(17.4, 3.86, 0.0), "ew", 90.0),
        (rect(3.86, 17.4, 0.0), "ns", 0.0),
        (circle(6.0), "ew", 90.0),
    ],
)
def test_vessel_h_orientation(footprint, orient, expected):
    params = {"orient": orient} if orient else {}
    nodes = REGISTRY["vessel_h"].fn(make_item("vessel_h", footprint, h=3.0, params=params), CTX)
    got = principal_bearing(nodes, "shell")
    assert min(abs(got - expected), 180 - abs(got - expected)) < 0.5
    assert nodes[0].extras["derived"]["axis_bearing_deg"] == pytest.approx(expected % 360)


def test_vessel_v_lod_lowers_triangles():
    assert tris(built("vessel_v", 0.25)) < tris(built("vessel_v"))


def test_vessel_v_heads_too_tall_for_height_raise():
    with pytest.raises(ValueError, match="height"):
        REGISTRY["vessel_v"].fn(make_item("vessel_v", circle(6.0), h=2.0), CTX)
```

- [ ] **Step 2: Run them to see them fail.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k vessel`
  Expected: FAIL with `KeyError: 'vessel_v'` (not registered).

- [ ] **Step 3: Write `vessels.py`:**

```python
"""Vessels: vessel_v and vessel_h (unit B2)."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item, NonNeg, Pos, _Strict

HEAD_STEPS = 8
PLINTH_H = 0.3
NOZZLE_ROOM = 0.3  # vessel_h: space above the shell for top nozzles
H_VV, H_VH = 8.0, 4.0


def head_depth(kind: str, d: float) -> float:
    return {"ellipsoidal": d / 4, "hemispherical": d / 2, "flat": 0.05}[kind]


def shell_material(insulated: bool) -> str:
    return "Insulation_Clad" if insulated else "Equipment_White"


class VesselVParams(_Strict):
    d_m: Pos | None = Field(None, description="Shell OD, m. Default: the footprint diameter (or short side).")
    head: Literal["ellipsoidal", "hemispherical", "flat"] = "ellipsoidal"
    skirt_h_m: NonNeg | None = Field(None, description="Skirt height above the plinth, m. Default min(0.15 H, 3).")
    insulated: bool = False
    ladder: bool | None = Field(None, description="Ladder to the top. Default: when H >= 5 m.")
    top_platform: bool | None = Field(None, description="Ring platform at the top tangent. Default: H >= 8 m.")
    nozzles: int = Field(3, ge=0, le=12)


class VesselHParams(_Strict):
    orient: Literal["ns", "ew"] | None = Field(None, description="Axis N-S or E-W; overrides the footprint axis.")
    d_m: Pos | None = Field(None, description="Shell OD, m. Default: footprint short side, limited by height.")
    head: Literal["ellipsoidal", "hemispherical"] = "ellipsoidal"
    saddle_h_m: NonNeg | None = Field(None, description="Grade to shell bottom, m. Default H - d - 0.3 (>= 0.3).")
    insulated: bool = False
    nozzles: int = Field(3, ge=0, le=12)


DOC_VV = (
    "Vertical pressure vessel or drum: concrete plinth, skirt, shell, two heads (2:1 ellipsoidal by default), "
    "shell nozzles, and on tall vessels a ladder and a ring platform at the top tangent line. Footprint: circle "
    "= shell OD. base_el = grade or platform, top_el = top of the top head."
)
DOC_VH = (
    "Horizontal drum or vessel: shell, two heads, two steel saddles on concrete piers, top nozzles and a "
    "manway. Footprint: rect along the vessel axis (overall length incl. heads x shell OD); orient 'ns'/'ew' "
    "overrides. top_el = top of the shell (or nozzles)."
)


@builder("vessel_v", family="equipment", params=VesselVParams, doc=DOC_VV, default_height_m=H_VV)
def build_vessel_v(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, VesselVParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_VV)
    d = p.d_m or min(plan.along, plan.across)
    r = d / 2
    hd = head_depth(p.head, d)
    sk = p.skirt_h_m if p.skirt_h_m is not None else min(0.15 * H, 3.0)
    shell_len = H - PLINTH_H - sk - 2 * hd
    if shell_len < 0.1:  # a squat drum: give up the skirt first
        sk = max(0.0, H - PLINTH_H - 2 * hd - 0.1)
        shell_len = H - PLINTH_H - sk - 2 * hd
    if shell_len < 0.05:
        raise ValueError("vessel_v: height too small for the heads")
    y_bt = PLINTH_H + sk + hd
    y_tt = y_bt + shell_len
    mat = shell_material(p.insulated)
    cap = k.ell_cap(r, hd, ctx, steps=HEAD_STEPS)
    nodes = [
        k.node("plinth", "Concrete", k.vcyl(r + 0.3, PLINTH_H, ctx, n=8)),
        k.node("shell", mat, k.vcyl(r, shell_len, ctx, y0=y_bt)),
        k.node("head_top", mat, k.placed(cap, k.T(0, y_tt, 0))),
        k.node("head_bottom", mat, k.placed(cap, k.T(0, y_bt, 0) @ k.S(1, -1, 1))),
    ]
    if sk > 0.05:
        nodes.append(k.node("skirt", "Steel_Dark", k.vcyl(r * 0.98, sk + hd, ctx, y0=PLINTH_H)))
    noz = []
    rn = max(0.05, 0.06 * d)
    for i in range(p.nozzles):
        a = math.radians(360.0 * i / p.nozzles + 30.0)
        y = y_bt + shell_len * (0.2 + 0.6 * ((i * 0.618) % 1.0))
        ux, uz = math.cos(a), math.sin(a)
        noz.append(k.rod((ux * r * 0.9, y, uz * r * 0.9), (ux * (r + 0.3), y, uz * (r + 0.3)), rn, ctx))
    if noz:
        nodes.append(k.node("nozzles", "Pipe", *noz))
    want_ladder = p.ladder if p.ladder is not None else H >= 5.0
    want_platform = p.top_platform if p.top_platform is not None else H >= 8.0
    y_pf = min(y_tt, H - k.RAIL_H)
    if want_platform:
        deck = k.lathe([(r, y_pf - k.DECK_T), (r + 1.0, y_pf - k.DECK_T), (r + 1.0, y_pf), (r, y_pf)], ctx, r + 1.0)
        nodes.append(k.node("platform_deck", "Grating", deck))
        nodes += k.ring_handrail("platform", r + 0.95, y_pf, ctx)
    if want_ladder:
        a = math.radians(200.0)
        top = y_pf if want_platform else y_tt
        nodes += k.ladder("ladder", math.cos(a) * (r + 0.4), math.sin(a) * (r + 0.4), PLINTH_H, top, 20.0)
    nodes = k.turn(nodes, plan.place())
    return k.finish(nodes, item, p, {"d_m": d, "skirt_h_m": sk, "shell_len_m": shell_len})


def _axis(plan: k.Plan, orient: str | None) -> tuple[float, float, float]:
    """(axis bearing, overall length, width) for a horizontal vessel."""
    long_, short = max(plan.along, plan.across), min(plan.along, plan.across)
    if orient == "ns":
        return 0.0, long_, short
    if orient == "ew":
        return 90.0, long_, short
    if plan.is_round:
        return 0.0, plan.along, plan.along / 3
    return plan.bearing_deg, plan.along, plan.across


@builder("vessel_h", family="equipment", params=VesselHParams, doc=DOC_VH, default_height_m=H_VH)
def build_vessel_h(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, VesselHParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_VH)
    bearing, L, W = _axis(plan, p.orient)
    room = NOZZLE_ROOM if p.nozzles else 0.0
    d = p.d_m or min(W, H)
    sh = p.saddle_h_m if p.saddle_h_m is not None else max(0.3, H - d - room)
    if sh + d + room > H + 1e-9:
        d = H - sh - room
    if d < 0.1:
        raise ValueError("vessel_h: height too small for the shell")
    r, hd = d / 2, head_depth(p.head, d)
    shell_len = L - 2 * hd
    if shell_len < 0.1:
        raise ValueError("vessel_h: footprint too short for the heads")
    yc = sh + r
    x0, x1 = -shell_len / 2, shell_len / 2
    mat = shell_material(p.insulated)
    cap = k.ell_cap(r, hd, ctx, steps=HEAD_STEPS)
    xs = (-0.3 * shell_len, 0.3 * shell_len)
    ph = min(0.6, 0.5 * sh)
    st = max(0.2, 0.05 * d)
    nodes = [
        k.node("shell", mat, k.rod((x0, yc, 0), (x1, yc, 0), r, ctx)),
        k.node("head_a", mat, k.placed(cap, k.T(x1, yc, 0) @ k.Y_TO_X)),
        k.node("head_b", mat, k.placed(cap, k.T(x0, yc, 0) @ k.S(-1, 1, 1) @ k.Y_TO_X)),
        k.node("piers", "Concrete", *[k.box(3 * st, max(ph, 0.05), d, x=x) for x in xs]),
        k.node("saddles", "Steel_Structure", *[k.box(st, yc - ph, 0.85 * d, x=x, y0=ph) for x in xs]),
    ]
    rn = max(0.05, 0.06 * d)
    if p.nozzles and H - (yc + r) > 0.05:
        noz = [
            k.rod((x0 + shell_len * (i + 0.5) / p.nozzles, yc + 0.9 * r, 0), (x0 + shell_len * (i + 0.5) / p.nozzles, H, 0), rn, ctx)
            for i in range(p.nozzles)
        ]
        nodes.append(k.node("nozzles", "Pipe", *noz))
    rm = max(0.3, 0.12 * d)
    if rm < 0.8 * r:
        nodes.append(k.node("manway", "Steel_Dark", k.rod((x1 + 0.6 * hd, yc, 0), (x1 + hd + 0.3, yc, 0), rm, ctx)))
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz) @ k.yaw(bearing))
    derived = {"d_m": d, "saddle_h_m": sh, "length_m": L, "axis_bearing_deg": bearing % 360.0}
    return k.finish(nodes, item, p, derived)
```

Then register the module in `equipment/__init__.py` (replace the docstring-only file body):

```python
"""Equipment family (unit B2). Importing this package registers its builders in REGISTRY."""

from app.asset_models.builders.equipment import vessels  # noqa: F401  (registers on import)
```

- [ ] **Step 4: Run the vessel tests.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k "vessel and not golden"`
  Expected: all pass.
  - If `test_triangle_range[vessel_v]` is over 4 000, lower `HEAD_STEPS` to 6.
  - If `test_bounds[vessel_h]` fails on the margin, check that the manway reaches only `L/2 + 0.3`.

- [ ] **Step 5: Generate and review the goldens.**

```powershell
$env:KESTREL_UPDATE_GOLDENS = '1'; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k "golden and vessel"; Remove-Item Env:KESTREL_UPDATE_GOLDENS
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k vessel
```

Expected: the second run passes everything. Open `vessel_v_iso.png`, `vessel_h_iso.png` and `vessel_h_top.png` and confirm:
- the vertical vessel shows a skirt, two heads, nozzles, a ladder and a top ring platform;
- the horizontal drum shows two heads on two saddles;
- the top view's long axis runs about 96° (almost east-west, image up = north).

Do not commit a golden that looks wrong.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/__init__.py backend/app/asset_models/builders/equipment/vessels.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/vessel_v_iso.png backend/tests/data/plant/golden/equipment/vessel_h_iso.png backend/tests/data/plant/golden/equipment/vessel_h_top.png
git commit -m "feat(builders): vessel_v and vessel_h" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: storage_tank_small

**Files:**
- Create: `backend/app/asset_models/builders/equipment/tanks.py`
- Modify: `backend/app/asset_models/builders/equipment/__init__.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): goldens `storage_tank_small_iso.png`, `storage_tank_small_horizontal_iso.png`

**Interfaces:**
- Consumes: the kit; `vessels.head_depth`.
- Produces: `tanks.StorageTankSmallParams`, builder `storage_tank_small`.
- **Node names:**
  - vertical form: `foundation`, `shell`, `roof`, `roof_posts`, `roof_rails`, `ladder_stiles`, `ladder_rungs`;
  - horizontal form: `bund`, `saddles`, `shell`, `heads`, `nozzles`.
- **Derived values:** `form`, `d_m`, `shell_h_m` or `shell_len_m`.

- [ ] **Step 1: Add the cases and tests.** Under `# --- tanks (Tasks 5, 6)`:

```python
    "storage_tank_small": Case(  # Cowork 70-T-0002 fire water tank: R 5.3, 10 m
        "storage_tank_small",
        circle(10.6),
        10.0,
        margin=0.7,
        tris=(1952, 4000),
        parts=frozenset({"foundation", "shell", "roof", "roof_posts", "roof_rails", "ladder_rungs"}),
    ),
    "storage_tank_small_horizontal": Case(  # Cowork 20-A-0009-V-01 diesel tank skid: 5.8 x 3.8, 3 m
        "storage_tank_small",
        rect(5.8, 3.8),
        3.0,
        margin=0.3,
        tris=(200, 4000),
        parts=frozenset({"bund", "saddles", "shell", "heads"}),
    ),
```

```python
# ------------------------------------------------------------------ tanks
def test_storage_tank_small_form_follows_the_footprint():
    assert built("storage_tank_small")[0].extras["derived"]["form"] == "vertical"
    assert built("storage_tank_small_horizontal")[0].extras["derived"]["form"] == "horizontal"


def test_storage_tank_small_roof_posts_are_instanced():
    posts = next(n for n in built("storage_tank_small") if n.name == "roof_posts").geometry
    assert isinstance(posts, Instanced) and len(posts.transforms) >= 20


def test_storage_tank_small_lod_lowers_triangles():
    assert tris(built("storage_tank_small", 0.25)) < tris(built("storage_tank_small"))
```

- [ ] **Step 2: Run to see it fail.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k storage`
  Expected: FAIL with `KeyError: 'storage_tank_small'`.

- [ ] **Step 3: Write `tanks.py`** (Task 6 extends the same file):

```python
"""Tanks: storage_tank_small and tank_lng (unit B2)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.builders.equipment.vessels import head_depth
from app.asset_models.spec import Item, NonNeg, _Strict

H_STS = 8.0
FOUND_H = 0.3
TANK_POST_PITCH = 1.0  # small tank roof rail; dense like Cowork's


class StorageTankSmallParams(_Strict):
    form: Literal["auto", "vertical", "horizontal"] = Field(
        "auto", description="auto: circle footprint -> vertical tank, otherwise a horizontal tank in a bund"
    )
    roof: Literal["cone", "dome", "flat"] = "cone"
    roof_slope: float = Field(0.2, gt=0, le=1, description="Cone roof rise per run")
    handrail: bool = True
    ladder: bool = True
    bund_h_m: NonNeg = Field(0.6, description="Horizontal form: concrete bund wall height, m (0 = none)")


DOC_STS = (
    "Small storage tank. Vertical form (circle footprint = shell OD): concrete ring foundation, shell, cone/dome/"
    "flat roof, roof-edge handrail and a ladder. Horizontal form (rect footprint): cylindrical tank on two "
    "saddles inside a low concrete bund. top_el = roof crown or handrail top."
)


@builder("storage_tank_small", family="equipment", params=StorageTankSmallParams, doc=DOC_STS, default_height_m=H_STS)
def build_storage_tank_small(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, StorageTankSmallParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_STS)
    form = p.form if p.form != "auto" else ("vertical" if plan.is_round else "horizontal")
    if form == "vertical":
        nodes, derived = _vertical(p, plan, H, ctx)
    else:
        nodes, derived = _horizontal(p, plan, H, ctx)
    return k.finish(k.turn(nodes, plan.place()), item, p, {"form": form, **derived})


def _vertical(p: StorageTankSmallParams, plan: k.Plan, H: float, ctx: BuildCtx):
    r = min(plan.along, plan.across) / 2
    rise = {"cone": min(r * p.roof_slope, 0.25 * H), "dome": min(0.3 * r, 0.25 * H), "flat": 0.0}[p.roof]
    rail = k.RAIL_H if p.handrail else 0.0
    y_s = H - max(rise, rail, 0.05)
    if y_s - FOUND_H < 0.3:
        raise ValueError("storage_tank_small: height too small for the shell")
    if p.roof == "cone":
        roof = k.lathe([(0.0, y_s), (r + 0.05, y_s), (0.0, y_s + rise)], ctx, r)
    elif p.roof == "dome":
        roof = k.placed(k.ell_cap(r + 0.05, rise, ctx, steps=6), k.T(0, y_s, 0))
    else:
        roof = k.vcyl(r + 0.05, 0.05, ctx, y0=y_s)
    nodes = [
        k.node("foundation", "Concrete", k.vcyl(r + 0.4, FOUND_H, ctx)),
        k.node("shell", "Equipment_White", k.vcyl(r, y_s - FOUND_H, ctx, y0=FOUND_H)),
        k.node("roof", "Equipment_White", roof),
    ]
    if p.handrail:
        nodes += k.ring_handrail("roof", r - 0.15, y_s, ctx, pitch=TANK_POST_PITCH, toe=True)
    if p.ladder:
        nodes += k.ladder("ladder", -(r + 0.4), 0.0, FOUND_H, y_s, 0.0)
    return nodes, {"d_m": 2 * r, "shell_h_m": y_s - FOUND_H}


def _horizontal(p: StorageTankSmallParams, plan: k.Plan, H: float, ctx: BuildCtx):
    L, W = plan.along, plan.across
    d = min(W - 0.6, H - 0.5)
    if d < 0.2:
        raise ValueError("storage_tank_small: footprint or height too small for a horizontal tank")
    r, hd = d / 2, head_depth("ellipsoidal", d)
    yc = H - r
    shell_len = L - 1.0 - 2 * hd
    if shell_len < 0.2:
        raise ValueError("storage_tank_small: footprint too short for a horizontal tank")
    x0, x1 = -shell_len / 2, shell_len / 2
    cap = k.ell_cap(r, hd, ctx, steps=6)
    nodes = []
    if p.bund_h_m > 0:
        b = p.bund_h_m
        nodes.append(
            k.node(
                "bund",
                "Concrete",
                k.box(L, b, 0.2, z=-(W / 2 - 0.1)),
                k.box(L, b, 0.2, z=W / 2 - 0.1),
                k.box(0.2, b, W - 0.4, x=-(L / 2 - 0.1)),
                k.box(0.2, b, W - 0.4, x=L / 2 - 0.1),
            )
        )
    nodes += [
        k.node("saddles", "Concrete", *[k.box(0.4, yc, 0.8 * d, x=x) for x in (-0.3 * shell_len, 0.3 * shell_len)]),
        k.node("shell", "Equipment_White", k.rod((x0, yc, 0), (x1, yc, 0), r, ctx)),
        k.node(
            "heads",
            "Equipment_White",
            k.placed(cap, k.T(x1, yc, 0) @ k.Y_TO_X),
            k.placed(cap, k.T(x0, yc, 0) @ k.S(-1, 1, 1) @ k.Y_TO_X),
        ),
    ]
    if H - (yc + r) <= 0.05:  # vent nozzle sits inside the shell's top band
        nodes.append(k.node("nozzles", "Pipe", k.rod((0.2 * shell_len, yc + 0.7 * r, 0), (0.2 * shell_len, H, 0), max(0.04, 0.05 * d), ctx)))
    return nodes, {"d_m": d, "shell_len_m": shell_len}
```

Extend the `__init__.py` import line to `from app.asset_models.builders.equipment import tanks, vessels  # noqa: F401  (registers on import)`.

- [ ] **Step 4: Run.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k "storage and not golden"`
  Expected: all pass. If `test_triangle_range[storage_tank_small]` is under the Cowork floor of 1 952, lower `TANK_POST_PITCH` to 0.8. Do not lower the floor.

- [ ] **Step 5: Goldens.** Same commands as Task 4 Step 5 with `-k "golden and storage"`. Review:
  - the vertical tank shows a foundation ring, a cone roof, a roof rail and a ladder;
  - the horizontal tank shows a bund, two saddles and a capsule.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/__init__.py backend/app/asset_models/builders/equipment/tanks.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/storage_tank_small_iso.png backend/tests/data/plant/golden/equipment/storage_tank_small_horizontal_iso.png
git commit -m "feat(builders): storage_tank_small" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: tank_lng

**Files:**
- Modify: `backend/app/asset_models/builders/equipment/tanks.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): goldens `tank_lng_iso.png`, `tank_lng_top.png`

**Interfaces:**
- Consumes: the kit.
- Produces: `tanks.TankLngParams`, `tanks.RoofPlatform`, `tanks.RoofWalkway`, `tanks.COWORK_ROOF`, `tanks.REF_OD = 93.5`, builder `tank_lng`.
- **Node names:**
  - tank body: `slab`, `wall_dome`, `roof_edge_deck`, `roof_edge_posts`, `roof_edge_rails`;
  - each roof platform: `platform_<kind>_deck`, `platform_<kind>_legs`, `platform_<kind>_posts`, `platform_<kind>_rails` (a repeated kind gets `_<i>` appended);
  - walkway: `walkway_deck`, `walkway_posts`, `walkway_rails`;
  - stair tower: `stair_tower_columns`, `stair_tower_landings`, `stair_tower_stringers`, `stair_tower_treads`, `stair_tower_bracing`, `stair_tower_bridge`, `stair_tower_top_posts`, `stair_tower_top_rails`;
  - risers: `risers`, `riser_supports`.
- **Derived values:** `od_m`, `wall_top_m`, `dome_rise_m`, `scale`.

**Cowork reference (20-T-0001, measured from node footprints, tank centre plant (1301.1, 555.4), wall OD 93.5, wall top EL 141.0, dome top EL 151.5, base slab 96.5):**

| platform | shape | bearing ° | centre r (m) | radial depth (m) | tangential width (m) / span | deck above wall top (m) |
| --- | --- | --- | --- | --- | --- | --- |
| pump | rect | 134.0 | 34.4 | 35.1 | 34.7 | 9.3 |
| safety | arc | 347.0 | 39.5 | 4.0 | 110° | 6.7 |
| instrument | rect | 95.0 | 41.0 | 8.4 | 18.8 | 4.7 |
| flare | rect | 222.0 | 45.0 | 8.9 | 15.2 | 3.4 |
| unloading | rect | 188.0 | 38.5 | 22.4 | 37.6 | 7.2 |
| walking (walkway) | path | 311° r 36 → 134° r 17 | — | — | 1.5 wide | follows dome + 0.6 |

Cowork's pump and unloading platforms are irregular polygons. B2 models them as rects sized to Cowork's plan extents, not to its centroid-radial bounding box: Cowork's unloading platform spans plant N −50.0 … −28.8 and E −23.3 … +14.3 from the tank centre. That keeps every rect corner within 6 m of the slab edge, which is the bounds margin.

- [ ] **Step 1: Add the cases and tests.** Under the tanks marker, after the storage cases:

```python
    "tank_lng": Case(  # Cowork 20-T-0001: wall OD 93.5, base EL 100, dome top EL 151.5
        "tank_lng",
        circle(93.5),
        51.5,
        margin=6.0,
        tris=(19500, 32000),
        parts=frozenset(
            {
                "slab",
                "wall_dome",
                "roof_edge_deck",
                "roof_edge_posts",
                "roof_edge_rails",
                "platform_pump_deck",
                "platform_safety_deck",
                "platform_instrument_deck",
                "platform_flare_deck",
                "platform_unloading_deck",
                "walkway_deck",
                "stair_tower_columns",
                "stair_tower_treads",
                "risers",
            }
        ),
        golden=("iso", "top"),
    ),
```

```python
def test_tank_lng_roof_posts_are_instanced_round_the_edge():
    posts = next(n for n in built("tank_lng") if n.name == "roof_edge_posts").geometry
    assert isinstance(posts, Instanced)
    assert len(posts.transforms) == max(8, math.ceil(2 * math.pi * (93.5 / 2 - 0.1) / k.POST_PITCH))


def test_tank_lng_parts_can_be_switched_off():
    params = {"roof_platforms": [], "walkway": None, "stair_tower_bearing_deg": None, "risers_bearing_deg": None}
    nodes = REGISTRY["tank_lng"].fn(make_item("tank_lng", circle(93.5), h=51.5, params=params), CTX)
    names = {n.name for n in nodes}
    assert not any(n.startswith(("platform_", "walkway", "stair_tower", "riser")) for n in names)
    assert {"slab", "wall_dome", "roof_edge_posts"} <= names


def test_tank_lng_platform_sits_at_its_bearing():
    deck = next(n for n in built("tank_lng") if n.name == "platform_pump_deck").geometry
    x, _, z = deck.centroid
    assert math.degrees(math.atan2(z, x)) % 360 == pytest.approx(134.0, abs=2.0)


def test_tank_lng_scales_to_other_diameters():  # Review Focus 4
    nodes = REGISTRY["tank_lng"].fn(make_item("tank_lng", circle(60.0), h=35.0), CTX)
    lo, hi = bounds(nodes)
    assert max(abs(lo[0]), abs(hi[0]), abs(lo[2]), abs(hi[2])) <= 30.0 + 6.0
    assert abs(hi[1] - 35.0) <= max(0.05 * 35.0, 0.5)
    names = {n.name for n in nodes}
    assert {f"platform_{kd}_deck" for kd in ("pump", "safety", "instrument", "flare", "unloading")} <= names
    assert nodes[0].extras["derived"]["scale"] == pytest.approx(60.0 / 93.5, abs=1e-3)


def test_tank_lng_lod_lowers_triangles():
    assert tris(built("tank_lng", 0.25)) < tris(built("tank_lng"))
```

- [ ] **Step 2: Run to see it fail.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k tank_lng`
  Expected: FAIL with `KeyError: 'tank_lng'`.

- [ ] **Step 3: Extend `tanks.py`.** Add to its imports:

```python
import math
from collections import Counter
from dataclasses import dataclass

import numpy as np
import trimesh
from shapely.geometry import Point, Polygon

from app.asset_models.spec import Pos
```

and append:

```python
H_LNG = 51.5
REF_OD = 93.5  # Cowork 20-T-0001 outer wall OD; default layouts are stored at this size
DOME_RISE_RATIO = 10.5 / 93.5


class RoofPlatform(_Strict):
    kind: Literal["pump", "safety", "instrument", "flare", "unloading"]
    shape: Literal["rect", "arc"] = "rect"
    bearing_deg: float
    r_m: Pos = Field(description="Centre (rect) or mid (arc) radius from the tank axis, at the 93.5 m reference")
    depth_m: Pos = Field(description="Radial size, m, at the reference")
    width_m: Pos = Field(1.0, description="Tangential size, m, at the reference (rect)")
    span_deg: float = Field(60.0, gt=0, le=180, description="Angular span (arc)")
    deck_above_wall_m: NonNeg = Field(description="Deck height above the wall top, m, at the reference")


class RoofWalkway(_Strict):
    from_bearing_deg: float = 311.0
    from_r_m: NonNeg = 36.0
    to_bearing_deg: float = 134.0
    to_r_m: NonNeg = 17.0
    width_m: Pos = 1.5


COWORK_ROOF: tuple[RoofPlatform, ...] = (
    RoofPlatform(kind="pump", bearing_deg=134.0, r_m=34.4, depth_m=35.1, width_m=34.7, deck_above_wall_m=9.3),
    RoofPlatform(kind="safety", shape="arc", bearing_deg=347.0, r_m=39.5, depth_m=4.0, span_deg=110.0, deck_above_wall_m=6.7),
    RoofPlatform(kind="instrument", bearing_deg=95.0, r_m=41.0, depth_m=8.4, width_m=18.8, deck_above_wall_m=4.7),
    RoofPlatform(kind="flare", bearing_deg=222.0, r_m=45.0, depth_m=8.9, width_m=15.2, deck_above_wall_m=3.4),
    RoofPlatform(kind="unloading", bearing_deg=188.0, r_m=38.5, depth_m=22.4, width_m=37.6, deck_above_wall_m=7.2),
)


class TankLngParams(_Strict):
    dome_rise_m: Pos | None = Field(None, description="Dome rise above the wall top. Default 0.1123 x OD (Cowork).")
    slab_overhang_m: NonNeg = Field(1.5, description="Base slab radius beyond the wall, m")
    slab_t_m: Pos = 1.0
    wall_t_m: Pos = 0.8
    roof_handrail: bool = True
    roof_platforms: list[RoofPlatform] | None = Field(
        None,
        max_length=12,
        description="None = Cowork's five roof platforms scaled to the OD; [] = none (the drawing tags them as items)",
    )
    walkway: RoofWalkway | None = Field(default_factory=RoofWalkway, description="Walking platform over the dome")
    stair_tower_bearing_deg: float | None = Field(115.0, description="Stair tower at grade outside the wall; null = none")
    risers_bearing_deg: float | None = Field(128.0, description="Pipe risers up the wall; null = none")
    riser_od_m: list[Pos] = Field(default_factory=lambda: [0.9, 0.75, 0.6, 0.6, 0.45], max_length=12)


DOC_LNG = (
    "Full-containment LNG tank: base slab, concrete outer wall and dome, roof-edge deck and handrail, roof "
    "platforms (pump, safety, instrument, flare, unloading) and the walking platform, a stair tower and pipe "
    "risers. Footprint: circle = outer wall OD. top_el = dome crown. Roof pumps, jib cranes and the DCP "
    "package are their own items. Switch off parts the drawing tags separately."
)


@dataclass(frozen=True)
class _Dome:
    ro: float
    hw: float
    rise: float

    @property
    def rs(self) -> float:
        return (self.ro**2 + self.rise**2) / (2 * self.rise)

    def y(self, r: float) -> float:
        """Outer roof surface height above base at radius r (the wall top beyond the wall)."""
        if r >= self.ro:
            return self.hw
        return self.hw + self.rise - self.rs + math.sqrt(self.rs**2 - r**2)


def _wall_dome(ro: float, ri: float, y0: float, hw: float, rise: float, ctx: BuildCtx) -> trimesh.Trimesh:
    dome = _Dome(ro, hw, rise)
    t = min(0.5, rise / 4)
    rs, rsi = dome.rs, dome.rs - t
    yc = hw + rise - rs
    m = max(6, round(24 * ctx.lod))
    phi_o, phi_i = math.asin(ro / rs), math.asin(ri / rsi)
    outer = [(rs * math.sin(f), yc + rs * math.cos(f)) for f in np.linspace(phi_o, 0.0, m + 1)]
    inner = [(rsi * math.sin(f), yc + rsi * math.cos(f)) for f in np.linspace(0.0, phi_i, m + 1)]
    n = int(min(128, max(48, round(2 * math.pi * ro / 2.75 * ctx.lod))))
    return k.lathe([(ri, y0), (ro, y0), *outer, *inner], ctx, ro, n=n)


def _polar(bearing_deg: float, r: float) -> np.ndarray:
    a = math.radians(bearing_deg)
    return np.array([r * math.cos(a), r * math.sin(a)])


def _roof_platform(name: str, pf: RoofPlatform, scale: float, dome: _Dome, H: float) -> list[MeshNode]:
    rc, depth = pf.r_m * scale, pf.depth_m * scale
    if pf.shape == "arc":
        steps = max(4, math.ceil(pf.span_deg / 5))
        angs = np.radians(np.linspace(-pf.span_deg / 2, pf.span_deg / 2, steps + 1))
        r_out, r_in = rc + depth / 2, max(rc - depth / 2, 0.5)
        pts = [(r_out * math.cos(a), r_out * math.sin(a)) for a in angs]
        pts += [(r_in * math.cos(a), r_in * math.sin(a)) for a in angs[::-1]]
    else:
        w = pf.width_m * scale
        r_in = max(rc - depth / 2, 0.0)
        pts = [(rc - depth / 2, -w / 2), (rc + depth / 2, -w / 2), (rc + depth / 2, w / 2), (rc - depth / 2, w / 2)]
    deck_y = max(dome.hw + pf.deck_above_wall_m * scale, dome.y(r_in) + 0.3)
    deck_y = min(deck_y, H - k.RAIL_H - k.DECK_T)
    poly = Polygon(pts)
    minx, miny, maxx, maxy = poly.bounds
    cand = [(float(x), float(z)) for x, z in pts]
    cand += [
        (float(x), float(z))
        for x in np.arange(minx + 3.0, maxx, 6.0)
        for z in np.arange(miny + 3.0, maxy, 6.0)
        if poly.contains(Point(x, z))
    ]
    legs = []
    for x, z in cand:
        r = math.hypot(x, z)
        if r > dome.ro - 0.3:
            continue  # cantilevered over the wall edge
        ys = dome.y(r)
        if deck_y - ys > 0.1:
            legs.append(k.T(x, ys, z) @ k.S(1.0, deck_y - ys, 1.0))
    nodes = [k.node(f"{name}_deck", "Grating", k.slab(pts, deck_y, k.DECK_T))]
    if legs:
        nodes.append(MeshNode(f"{name}_legs", "Steel_Structure", k.inst(k.box(0.2, 1.0, 0.2), legs)))
    nodes += k.handrail(name, pts, deck_y + k.DECK_T)
    return k.turn(nodes, k.yaw(pf.bearing_deg))


def _walkway(w: RoofWalkway, scale: float, dome: _Dome, H: float) -> list[MeshNode]:
    a, b = _polar(w.from_bearing_deg, w.from_r_m * scale), _polar(w.to_bearing_deg, w.to_r_m * scale)
    span = float(np.linalg.norm(b - a))
    if span < 1.0:
        return []
    count = max(2, math.ceil(span / 3.0))
    pts = [a + (b - a) * i / count for i in range(count + 1)]
    ys = [min(dome.y(float(np.hypot(*q))) + 0.6, H - k.RAIL_H - k.DECK_T) for q in pts]
    deck = [
        k.bar((p0[0], y0, p0[1]), (p1[0], y1, p1[1]), w.width_m, k.DECK_T)
        for p0, p1, y0, y1 in zip(pts[:-1], pts[1:], ys[:-1], ys[1:], strict=True)
    ]
    u = (b - a) / span
    side = np.array([-u[1], u[0]]) * (w.width_m / 2)
    xf, rails = [], []
    for s in (-1, 1):
        prev = None
        for q, y in zip(pts, ys, strict=True):
            c = q + s * side
            xf.append(k.T(c[0], y + k.DECK_T / 2, c[1]))
            if prev is not None:
                rails.append(k.bar((prev[0][0], prev[1] + k.RAIL_H, prev[0][1]), (c[0], y + k.RAIL_H, c[1]), k.RAIL_W))
            prev = (c, y)
    return [
        k.node("walkway_deck", "Grating", *deck),
        MeshNode("walkway_posts", "Handrail", k.inst(k.box(k.POST_W, k.RAIL_H, k.POST_W), xf)),
        k.node("walkway_rails", "Handrail", *rails),
    ]


def _stair_tower(ro: float, hw: float) -> list[MeshNode]:
    """A switchback stair tower at grade just outside the wall (built at bearing 0), bridged to the roof edge."""
    x0, dx, dz = ro + 1.0, 4.0, 8.0
    xc = x0 + dx / 2
    count = max(1, math.ceil(hw / 3.6))
    lv = [0.15 + (hw - 0.15) * i / count for i in range(count + 1)]  # first flight starts on a 0.15 m pad
    corners = [(x0, -dz / 2), (x0 + dx, -dz / 2), (x0 + dx, dz / 2), (x0, dz / 2)]
    nodes = [
        MeshNode(
            "stair_tower_columns",
            "Steel_Structure",
            k.inst(k.box(0.25, 1.0, 0.25), [k.T(x, 0, z) @ k.S(1, hw + k.RAIL_H, 1) for x, z in corners]),
        ),
        MeshNode(
            "stair_tower_landings",
            "Grating",
            k.inst(k.box(dx, 0.06, 1.5), [k.T(xc, y, s * (dz / 2 - 0.75)) for y in lv[1:] for s in (-1, 1)]),
        ),
    ]
    stringers, xforms, tread = [], [], None
    for i in range(count):
        s = 1 if i % 2 == 0 else -1
        lane = xc - dx / 4 if i % 2 == 0 else xc + dx / 4
        st, tread, xf = k.stair_parts((lane, lv[i], -s * (dz / 2 - 1.5)), (lane, lv[i + 1], s * (dz / 2 - 1.5)), dx / 2 - 0.2)
        stringers.append(st)
        xforms += xf
    nodes.append(k.node("stair_tower_stringers", "Steel_Structure", *stringers))
    nodes.append(MeshNode("stair_tower_treads", "Grating", k.inst(tread, xforms)))
    braces = []
    for i in range(count):
        braces.append(k.bar((x0 + dx, lv[i], -dz / 2), (x0 + dx, lv[i + 1], dz / 2), 0.12))
        braces.append(k.bar((x0 + dx, lv[i], dz / 2), (x0 + dx, lv[i + 1], -dz / 2), 0.12))
    nodes.append(k.node("stair_tower_bracing", "Steel_Structure", *braces))
    nodes.append(k.node("stair_tower_bridge", "Grating", k.box(x0 - (ro - 1.2), k.DECK_T, 1.5, x=(x0 + ro - 1.2) / 2, y0=hw)))
    nodes += k.handrail("stair_tower_top", corners, hw + 0.06)
    return nodes


def _risers(ro: float, y0: float, hw: float, ods: list[float], ctx: BuildCtx) -> list[MeshNode]:
    """Pipe risers up the outer wall face (built at bearing 0) and over the wall top."""
    pipes, z = [], -(len(ods) - 1) * 0.6
    zs = []
    for od in ods:
        x, y_top = ro + 0.3 + od / 2, hw + 1.0 + od / 2
        pipes.append(k.rod((x, y0, z), (x, y_top, z), od / 2, ctx))
        pipes.append(k.rod((x, y_top, z), (ro - 1.0, y_top, z), od / 2, ctx))
        zs.append(z)
        z += 1.2
    supports = [k.bar((ro + 0.3, y, zs[0] - 0.6), (ro + 0.3, y, zs[-1] + 0.6), 0.15) for y in np.arange(y0 + 3.0, hw, 6.0)]
    nodes = [k.node("risers", "Pipe_Insulated", *pipes)]
    if supports:
        nodes.append(k.node("riser_supports", "Steel_Structure", *supports))
    return nodes


@builder("tank_lng", family="equipment", params=TankLngParams, doc=DOC_LNG, default_height_m=H_LNG)
def build_tank_lng(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, TankLngParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_LNG)
    od = min(plan.along, plan.across)
    ro = od / 2
    ri = ro - p.wall_t_m
    if ri <= 0:
        raise ValueError("tank_lng: wall thicker than the radius")
    rise = p.dome_rise_m if p.dome_rise_m is not None else DOME_RISE_RATIO * od
    hw = H - rise
    if hw < p.slab_t_m + 2.0:
        raise ValueError("tank_lng: height too small for the wall and dome")
    dome = _Dome(ro, hw, rise)
    scale = od / REF_OD
    rs = ro + p.slab_overhang_m
    nodes = [
        k.node("slab", "Concrete", k.lathe([(0.0, 0.0), (rs, 0.0), (rs, p.slab_t_m), (0.0, p.slab_t_m)], ctx, ro)),
        k.node("wall_dome", "Concrete_Tank", _wall_dome(ro, ri, p.slab_t_m, hw, rise, ctx)),
    ]
    if p.roof_handrail:
        edge = k.lathe([(ro - 1.2, hw), (ro, hw), (ro, hw + k.DECK_T), (ro - 1.2, hw + k.DECK_T)], ctx, ro)
        nodes.append(k.node("roof_edge_deck", "Grating", edge))
        nodes += k.ring_handrail("roof_edge", ro - 0.1, hw + k.DECK_T, ctx)
    platforms = COWORK_ROOF if p.roof_platforms is None else tuple(p.roof_platforms)
    kinds = Counter(pf.kind for pf in platforms)
    for i, pf in enumerate(platforms):
        name = f"platform_{pf.kind}" if kinds[pf.kind] == 1 else f"platform_{pf.kind}_{i}"
        nodes += _roof_platform(name, pf, scale, dome, H)
    if p.walkway is not None:
        nodes += _walkway(p.walkway, scale, dome, H)
    if p.stair_tower_bearing_deg is not None:
        nodes += k.turn(_stair_tower(ro, hw), k.yaw(p.stair_tower_bearing_deg))
    if p.risers_bearing_deg is not None and p.riser_od_m:
        nodes += k.turn(_risers(ro, p.slab_t_m, hw, list(p.riser_od_m), ctx), k.yaw(p.risers_bearing_deg))
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz))
    return k.finish(nodes, item, p, {"od_m": od, "wall_top_m": hw, "dome_rise_m": rise, "scale": scale})
```

- [ ] **Step 4: Run.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k "tank_lng and not golden"`
  Expected: all pass.
  - Planning estimate: about 28 k triangles, with the wall and dome about 11 k, the roof edge about 4.5 k, the platforms about 7 k, the stair about 3.7 k and the walkway plus risers about 1.6 k.
  - If it is over 32 000, raise the stair tower's level height from 3.6 to 4.2 m first.
  - If it is under 19 500, check that `_wall_dome` uses `n` from the 2.75 m rule.

- [ ] **Step 5: Goldens** (`-k "golden and tank_lng"`, as in Task 4 Step 5). Review `tank_lng_iso.png`: a domed concrete tank on a slab with platforms on the roof, a sloped walkway across the dome, a stair tower on the east-south-east side and risers beside it. Review `tank_lng_top.png`: the pump platform is south-east (image up = north, right = east) and the safety arc is to the north.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/tanks.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/tank_lng_iso.png backend/tests/data/plant/golden/equipment/tank_lng_top.png
git commit -m "feat(builders): tank_lng with roof platforms, walkway, stair tower and risers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: pump and pump_group

**Files:**
- Create: `backend/app/asset_models/builders/equipment/rotating.py`
- Modify: `backend/app/asset_models/builders/equipment/__init__.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): goldens `pump_iso.png`, `pump_horizontal_iso.png`, `pump_group_iso.png`

**Interfaces:**
- Consumes: the kit.
- Produces:
  - `rotating.PumpParams`, `rotating.PumpGroupParams`;
  - `rotating.pump_unit(kind, driver, L, W, H, ctx, *, plinth=True) -> list[MeshNode]` (all geometries are `Trimesh`; unit frame centred, shaft along +x, base y=0, top H);
  - builders `pump` and `pump_group`.
- **Node names:**
  - column pump: `plinth`?, `baseplate`, `pump_head`, `motor_stool`, `motor`;
  - horizontal pump: `plinth`?, `baseplate`, `casing`, `discharge`?, `coupling_guard`, then `motor` + `motor_feet`? or `engine` + `radiator`;
  - vertical_inline pump: `plinth`?, `baseplate`, `casing`, `motor`;
  - pump_group: `plinth` plus each unit node instanced.
- **Derived values:**
  - pump: `kind`, `along_m`, `across_m`;
  - pump_group: `n`, `pitch_m`.

- [ ] **Step 1: Cases and tests.** Under `# --- rotating (Tasks 7, 8)`:

```python
    "pump": Case(  # Cowork 20-P-0001A LP LNG pump head on the tank roof: R 0.9, 2 m
        "pump",
        circle(1.8),
        2.0,
        tris=(128, 800),
        parts=frozenset({"baseplate", "pump_head", "motor"}),
    ),
    "pump_horizontal": Case(
        "pump",
        rect(2.4, 0.9, 30.0),
        1.2,
        tris=(128, 800),
        parts=frozenset({"plinth", "baseplate", "casing", "discharge", "coupling_guard", "motor"}),
    ),
    "pump_group": Case(  # Cowork 70-P-0005B fire sea water pump row: 3.2 x 7.7, 3 m
        "pump_group",
        rect(7.7, 3.2),
        3.0,
        tris=(140, 6000),
        parts=frozenset({"plinth", "casing", "motor"}),
    ),
```

```python
# ------------------------------------------------------------------ rotating
def test_pump_kind_follows_the_footprint():
    assert built("pump")[0].extras["derived"]["kind"] == "column"
    assert built("pump_horizontal")[0].extras["derived"]["kind"] == "horizontal"


def test_pump_horizontal_shaft_follows_rot_deg():
    assert principal_bearing(built("pump_horizontal"), "motor") == pytest.approx(30.0, abs=1.0)


def test_pump_group_instances_one_unit_per_pump():
    nodes = built("pump_group")
    casing = next(n for n in nodes if n.name == "casing").geometry
    assert isinstance(casing, Instanced) and len(casing.transforms) == 3  # floor(7.7 / 2.5)
    assert nodes[0].extras["derived"]["n"] == 3


def test_pump_group_max_units_stays_inside():  # Review Focus 5
    it = make_item("pump_group", rect(3.0, 2.0), h=2.5, params={"n": 24})
    nodes = REGISTRY["pump_group"].fn(it, CTX)
    lo, hi = bounds(nodes)
    assert lo[0] >= -1.5 - 0.05 and hi[0] <= 1.5 + 0.05
    assert lo[2] >= -1.0 - 0.05 and hi[2] <= 1.0 + 0.05
    assert tris(nodes) <= 24 * 800


def test_pump_engine_driver_has_engine_and_radiator():
    it = make_item("pump", rect(3.5, 1.2), h=1.8, params={"driver": "engine"})
    names = {n.name for n in REGISTRY["pump"].fn(it, CTX)}
    assert {"engine", "radiator"} <= names and "motor" not in names
```

- [ ] **Step 2: Run to see it fail.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k pump`
  Expected: FAIL with `KeyError: 'pump'`.

- [ ] **Step 3: Write `rotating.py`:**

```python
"""Rotating equipment: pump, pump_group, compressor (unit B2)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item, Pos, _Strict

H_PUMP, H_GROUP = 2.0, 2.5
UNIT_PLINTH = 0.15


class PumpParams(_Strict):
    kind: Literal["auto", "horizontal", "vertical_inline", "column"] = Field(
        "auto", description="auto: circle footprint -> column (can / tank-roof pump head), otherwise horizontal"
    )
    driver: Literal["motor", "engine"] = "motor"
    plinth: bool = True


class PumpGroupParams(_Strict):
    n: int | None = Field(None, ge=1, le=24, description="Pumps in the row. Default floor(along / pitch).")
    pitch_m: Pos | None = Field(None, description="Centre spacing along the row. Default 2.5 m, or along / n.")
    kind: Literal["horizontal", "vertical_inline", "column"] = "horizontal"
    driver: Literal["motor", "engine"] = "motor"


DOC_PUMP = (
    "Pump. horizontal: plinth, baseplate, volute casing with suction and discharge, coupling guard, motor (or "
    "diesel engine + radiator) along the footprint's long axis. column: vertical can/roof pump head with motor "
    "on top (circle footprint). vertical_inline: inline body with motor above. top_el = discharge or motor top."
)
DOC_GROUP = (
    "Row of identical pumps on one concrete plinth, laid along the footprint's long axis, each pump's shaft "
    "across the row. Give n (or pitch_m), kind and driver; Cowork's fire-water diesel units are n=1, "
    "driver=engine."
)


def _column(d: float, H: float, y: float, ctx: BuildCtx) -> list[MeshNode]:
    avail = H - y - 0.1
    if avail < 0.3:
        raise ValueError("pump: height too small")
    yb = y + 0.1
    head_h, stool_h, motor_h = 0.45 * avail, 0.1 * avail, 0.37 * avail
    y_stool, y_motor = yb + head_h, yb + head_h + stool_h
    y_cap = y_motor + motor_h
    rh = 0.32 * d
    ym = yb + 0.5 * head_h
    return [
        k.node("baseplate", "Steel_Dark", k.vcyl(0.5 * d, 0.1, ctx, y0=y)),
        k.node("pump_head", "Pump_Blue", k.vcyl(rh, head_h, ctx, y0=yb), k.rod((0, ym, 0), (0.5 * d, ym, 0), 0.35 * rh, ctx)),
        k.node("motor_stool", "Steel_Dark", k.vcyl(0.22 * d, stool_h, ctx, y0=y_stool)),
        k.node(
            "motor",
            "Equipment_Grey",
            k.vcyl(0.28 * d, motor_h, ctx, y0=y_motor),
            k.lathe([(0.0, y_cap), (0.2 * d, y_cap), (0.0, H)], ctx, 0.2 * d),
        ),
    ]


def _inline(L: float, W: float, H: float, y: float, ctx: BuildCtx) -> list[MeshNode]:
    avail = H - y - 0.1
    if avail < 0.3:
        raise ValueError("pump: height too small")
    yb = y + 0.1
    rb = min(0.3 * W, 0.3 * L, 0.2 * avail)
    body_h, motor_h = 0.35 * avail, 0.5 * avail
    ym = yb + body_h
    yn = yb + 0.4 * body_h
    return [
        k.node("baseplate", "Steel_Dark", k.box(0.8 * L, 0.1, 0.8 * W, y0=y)),
        k.node("casing", "Pump_Blue", k.vcyl(rb, body_h, ctx, y0=yb), k.rod((-0.5 * L, yn, 0), (0.5 * L, yn, 0), 0.4 * rb, ctx)),
        k.node(
            "motor",
            "Equipment_Grey",
            k.vcyl(0.8 * rb, motor_h, ctx, y0=ym),
            k.lathe([(0.0, ym + motor_h), (0.6 * rb, ym + motor_h), (0.0, H)], ctx, 0.6 * rb),
        ),
    ]


def _horizontal(driver: str, L: float, W: float, H: float, y: float, ctx: BuildCtx) -> list[MeshNode]:
    nodes = [k.node("baseplate", "Steel_Dark", k.box(0.95 * L, 0.1, 0.85 * W, y0=y))]
    y += 0.1
    avail = H - y
    if avail < 0.2:
        raise ValueError("pump: height too small")
    rv = min(0.45 * W, 0.3 * avail)
    yc = y + rv
    rm = min(0.4 * W, 0.9 * rv)
    nodes.append(
        k.node(
            "casing",
            "Pump_Blue",
            k.rod((0.2 * L, yc, 0), (0.36 * L, yc, 0), rv, ctx),
            k.rod((0.36 * L, yc, 0), (0.5 * L, yc, 0), 0.45 * rv, ctx),
        )
    )
    if H - (yc + 0.8 * rv) > 0.05:
        nodes.append(k.node("discharge", "Pump_Blue", k.rod((0.28 * L, yc + 0.8 * rv, 0), (0.28 * L, H, 0), 0.35 * rv, ctx)))
    nodes.append(k.node("coupling_guard", "Equipment_Grey", k.box(0.17 * L, 1.2 * rm, 1.1 * rm, x=0.03 * L, y0=yc - 0.6 * rm)))
    if driver == "engine":
        eh = min(2.2 * rm, avail)
        nodes.append(k.node("engine", "Machine_Green", k.box(0.4 * L, eh, 0.8 * W, x=-0.25 * L, y0=y)))
        nodes.append(k.node("radiator", "Equipment_White", k.box(0.05 * L, eh, 0.8 * W, x=-0.475 * L, y0=y)))
    else:
        nodes.append(
            k.node(
                "motor",
                "Equipment_Grey",
                k.rod((-0.45 * L, yc, 0), (-0.05 * L, yc, 0), rm, ctx),
                k.rod((-0.5 * L, yc, 0), (-0.45 * L, yc, 0), 0.85 * rm, ctx),
            )
        )
        if yc - rm - y > 0.02:
            nodes.append(k.node("motor_feet", "Steel_Dark", k.box(0.3 * L, yc - rm - y, 1.2 * rm, x=-0.25 * L, y0=y)))
    return nodes


def pump_unit(kind: str, driver: str, L: float, W: float, H: float, ctx: BuildCtx, *, plinth: bool = True) -> list[MeshNode]:
    """One pump in its own frame: centred on the origin, shaft along +x, base at y = 0, top at H."""
    nodes: list[MeshNode] = []
    y = 0.0
    if plinth:
        nodes.append(k.node("plinth", "Concrete", k.box(L, UNIT_PLINTH, W)))
        y = UNIT_PLINTH
    if kind == "column":
        return nodes + _column(min(L, W), H, y, ctx)
    if kind == "vertical_inline":
        return nodes + _inline(L, W, H, y, ctx)
    return nodes + _horizontal(driver, L, W, H, y, ctx)


@builder("pump", family="equipment", params=PumpParams, doc=DOC_PUMP, default_height_m=H_PUMP)
def build_pump(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, PumpParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_PUMP)
    kind = p.kind if p.kind != "auto" else ("column" if plan.is_round else "horizontal")
    nodes = pump_unit(kind, p.driver, plan.along, plan.across, H, ctx, plinth=p.plinth)
    return k.finish(k.turn(nodes, plan.place()), item, p, {"kind": kind, "along_m": plan.along, "across_m": plan.across})


@builder("pump_group", family="equipment", params=PumpGroupParams, doc=DOC_GROUP, default_height_m=H_GROUP)
def build_pump_group(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, PumpGroupParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_GROUP)
    if H <= 0.5:
        raise ValueError("pump_group: height too small")
    row, deep = plan.along, plan.across
    if p.n is not None:
        n = p.n
        pitch = p.pitch_m or row / n
    else:
        pitch = p.pitch_m or 2.5
        n = max(1, int(row // pitch))
    n = min(n, 24)
    if n * pitch > row + 1e-6:
        pitch = row / n
    if p.kind == "column":
        size = 0.8 * min(pitch, deep)
        unit = pump_unit("column", p.driver, size, size, H - 0.2, ctx, plinth=False)
    else:
        unit = pump_unit(p.kind, p.driver, 0.85 * deep, 0.8 * pitch, H - 0.2, ctx, plinth=False)
    xf = [k.T((i - (n - 1) / 2) * pitch, 0.2, 0.0) @ k.yaw(90.0) for i in range(n)]
    nodes = [k.node("plinth", "Concrete", k.box(row, 0.2, deep))]
    nodes += [MeshNode(u.name, u.material, k.inst(u.geometry, xf)) for u in unit]
    return k.finish(k.turn(nodes, plan.place()), item, p, {"n": n, "pitch_m": pitch})
```

Extend `__init__.py`: `from app.asset_models.builders.equipment import rotating, tanks, vessels  # noqa: F401  (registers on import)`.

- [ ] **Step 4: Run.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k "pump and not golden"`
  Expected: all pass.

- [ ] **Step 5: Goldens** (`-k "golden and pump"`). Review:
  - the column pump head with its motor on top;
  - the horizontal pump with motor, guard, volute and discharge;
  - three pumps on one plinth.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/__init__.py backend/app/asset_models/builders/equipment/rotating.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/pump_iso.png backend/tests/data/plant/golden/equipment/pump_horizontal_iso.png backend/tests/data/plant/golden/equipment/pump_group_iso.png
git commit -m "feat(builders): pump and pump_group" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: compressor, generator, transformer

**Files:**
- Modify: `backend/app/asset_models/builders/equipment/rotating.py` (compressor)
- Create: `backend/app/asset_models/builders/equipment/power.py` (generator, transformer)
- Modify: `backend/app/asset_models/builders/equipment/__init__.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): goldens `compressor_iso.png`, `generator_iso.png`, `generator_polygon_top.png`, `transformer_iso.png`

**Interfaces:**
- Consumes: the kit.
- Produces: `rotating.CompressorParams`, `power.GeneratorParams`, `power.TransformerParams`, builders `compressor`, `generator`, `transformer`.
- **Node names:**
  - compressor:
    - always `plinth`;
    - reciprocating: `crankcase`, `cylinders`, `bottles`, `pulsation_piping`?, `motor`, `flywheel`, `lube_oil_console`;
    - centrifugal: `casing`, `gearbox`, `motor`, `nozzles`;
    - optional `floor_deck`, `floor_legs`, `floor_posts`, `floor_rails`, `enclosure_columns`, `enclosure_roof`.
  - generator: `plinth`, `fuel_base`, `enclosure`, `radiator`, `radiator_louvres`, `doors`, `exhaust`?
  - transformer: `plinths`, `tanks`, `radiator_fins`, `bushings`, `conservators`, `gantries`, `firewalls`?
- **Derived values:**
  - compressor: `kind`, `along_m`, `across_m`;
  - generator: `enclosure_h_m`, `axis_bearing_deg`;
  - transformer: `bays`, `bay_pitch_m`.

- [ ] **Step 1: Cases and tests.** Under the rotating marker, after the pump cases:

```python
    "compressor": Case(  # Cowork 40-K-0001D BOG compressor with operating floor PF 103.8
        "compressor",
        rect(11.4, 11.2),
        8.5,
        params={"operating_floor_m": 3.8},
        tris=(104, 3000),
        parts=frozenset({"plinth", "crankcase", "cylinders", "bottles", "motor", "lube_oil_console", "floor_deck"}),
    ),
```

Under `# --- power (Task 8)`:

```python
    "generator": Case(  # Cowork 70-A-0012-G-01 containerised genset: 16.75 x 4.3, 4 m
        "generator",
        rect(16.75, 4.3, 90.0),
        4.0,
        tris=(36, 1500),
        parts=frozenset({"plinth", "fuel_base", "enclosure", "radiator", "radiator_louvres", "exhaust"}),
    ),
    "generator_polygon": Case(  # Cowork 10-A-0003-G-01: a rotated 4-point polygon
        "generator",
        poly([(992.0, 502.28), (992.64, 496.11), (1008.06, 497.74), (1007.42, 503.88)]),
        4.0,
        tris=(36, 1500),
        golden=("top",),
    ),
    "transformer": Case(  # Cowork 70-SS-01-tx-n1: 4 walled bays, 24.5 x 10.9, 4 m
        "transformer",
        rect(24.5, 10.9, 90.0),
        4.0,
        tris=(36, 4000),
        parts=frozenset({"plinths", "tanks", "radiator_fins", "bushings", "conservators", "firewalls"}),
    ),
```

```python
def test_polygon_footprint_follows_long_axis():  # Review Focus 1
    pts = CASES["generator_polygon"].footprint["pts"]
    de, dn = pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]  # the long side, plant [E, N]
    expected = math.degrees(math.atan2(de, dn)) % 180.0
    got = principal_bearing(built("generator_polygon"), "enclosure")
    assert min(abs(got - expected), 180 - abs(got - expected)) < 2.0


def test_transformer_bays_fins_and_walls_are_instanced():
    nodes = {n.name: n.geometry for n in built("transformer")}
    assert len(nodes["radiator_fins"].transforms) == 4 * 12  # round(24.5 / 6) bays x 12 fins
    assert len(nodes["firewalls"].transforms) == 5
    assert len(nodes["tanks"].transforms) == 4


def test_generator_doors_are_instanced():
    doors = next(n for n in built("generator") if n.name == "doors").geometry
    assert len(doors.transforms) == 6


def test_compressor_centrifugal_and_enclosure():
    it = make_item("compressor", rect(8.0, 4.0), h=5.0, params={"kind": "centrifugal", "enclosure": True})
    names = {n.name for n in REGISTRY["compressor"].fn(it, CTX)}
    assert {"casing", "gearbox", "motor", "nozzles", "enclosure_columns", "enclosure_roof"} <= names
```

- [ ] **Step 2: Run to see it fail.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k "compressor or generator or transformer or polygon_footprint"`
  Expected: FAIL with `KeyError`.

- [ ] **Step 3a: Append the compressor to `rotating.py`.** Add `import math` and `import numpy as np` to the imports, and `NonNeg` to the spec import. Then:

```python
H_COMP = 6.0


class CompressorParams(_Strict):
    kind: Literal["reciprocating", "centrifugal"] = "reciprocating"
    throws: int = Field(4, ge=1, le=8, description="Reciprocating cylinders, half on each side of the crankcase")
    operating_floor_m: NonNeg | None = Field(
        None, description="Grating operating floor height above base, m (Cowork BOG compressors: 3.8). None = none."
    )
    enclosure: bool = False


DOC_COMP = (
    "Compressor package on a concrete block, crank along the footprint's long axis. reciprocating: crankcase, "
    "opposed cylinders, pulsation bottles, motor and flywheel, lube oil console. centrifugal: casing, gearbox, "
    "motor, nozzles. Optional grating operating floor with handrail, and an open enclosure roof."
)


def _recip(throws: int, L: float, W: float, y: float, top: float, ctx: BuildCtx) -> list[MeshNode]:
    avail = top - y
    rc = min(0.09 * W, 0.12 * avail)
    yc = y + max(0.2 * avail, rc + 0.1)
    rb = min(0.06 * W, 0.08 * avail)
    yb = top - rb
    per_side = math.ceil(throws / 2)
    xs = np.linspace(-0.2 * L, 0.2 * L, per_side) if per_side > 1 else np.array([0.0])
    sides = (1, -1) if throws > 1 else (1,)
    cyl, ties = [], []
    for i in range(throws):
        s = 1 if i % 2 == 0 else -1
        x = float(xs[i // 2])
        cyl.append(k.rod((x, yc, s * 0.125 * W), (x, yc, s * 0.42 * W), rc, ctx))
        if yb - 0.8 * rb > yc + 0.8 * rc:
            ties.append(k.rod((x, yc + 0.8 * rc, s * 0.33 * W), (x, yb - 0.8 * rb, s * 0.33 * W), 0.3 * rc, ctx))
    rm = min(0.15 * W, 0.2 * avail)
    nodes = [
        k.node("crankcase", "Machine_Green", k.box(0.55 * L, 0.3 * avail, 0.25 * W, y0=y)),
        k.node("cylinders", "Machine_Green", *cyl),
        k.node("bottles", "Equipment_Grey", *[k.rod((-0.3 * L, yb, s * 0.33 * W), (0.3 * L, yb, s * 0.33 * W), rb, ctx) for s in sides]),
        k.node("motor", "Equipment_Grey", k.rod((-0.47 * L, y + rm, 0), (-0.32 * L, y + rm, 0), rm, ctx)),
        k.node("flywheel", "Steel_Dark", k.rod((-0.32 * L, y + rm, 0), (-0.29 * L, y + rm, 0), min(1.2 * rm, avail / 2 - 0.01), ctx)),
        k.node("lube_oil_console", "Equipment_Grey", k.box(0.12 * L, 0.25 * avail, 0.2 * W, x=0.4 * L, z=0.3 * W, y0=y)),
    ]
    if ties:
        nodes.append(k.node("pulsation_piping", "Pipe", *ties))
    return nodes


def _centrifugal(L: float, W: float, y: float, top: float, ctx: BuildCtx) -> list[MeshNode]:
    avail = top - y
    rc = min(0.3 * W, 0.3 * avail)
    yc = y + rc
    return [
        k.node("casing", "Machine_Green", k.rod((0.05 * L, yc, 0), (0.4 * L, yc, 0), rc, ctx)),
        k.node("gearbox", "Equipment_Grey", k.box(0.15 * L, 1.6 * rc, 0.5 * W, x=-0.05 * L, y0=y)),
        k.node("motor", "Equipment_Grey", k.rod((-0.45 * L, yc, 0), (-0.15 * L, yc, 0), 0.8 * rc, ctx)),
        k.node("nozzles", "Pipe", *[k.rod((x, yc + 0.8 * rc, 0), (x, top, 0), 0.25 * rc, ctx) for x in (0.15 * L, 0.3 * L)]),
    ]


def _floor(L: float, W: float, f: float) -> list[MeshNode]:
    s = min(1.2, 0.2 * W, 0.2 * L)
    deck = [
        k.box(L, k.DECK_T, s, z=-(W / 2 - s / 2), y0=f),
        k.box(L, k.DECK_T, s, z=W / 2 - s / 2, y0=f),
        k.box(s, k.DECK_T, W - 2 * s, x=-(L / 2 - s / 2), y0=f),
        k.box(s, k.DECK_T, W - 2 * s, x=L / 2 - s / 2, y0=f),
    ]
    inset = [(-(L / 2 - s / 2), -(W / 2 - s / 2)), (L / 2 - s / 2, -(W / 2 - s / 2)), (L / 2 - s / 2, W / 2 - s / 2), (-(L / 2 - s / 2), W / 2 - s / 2)]
    legs = [k.T(float(p[0]), 0.0, float(p[1])) @ k.S(1.0, f, 1.0) for p in k.edge_points(inset, True, 4.0)]
    edge = [(-(L / 2 - 0.05), -(W / 2 - 0.05)), (L / 2 - 0.05, -(W / 2 - 0.05)), (L / 2 - 0.05, W / 2 - 0.05), (-(L / 2 - 0.05), W / 2 - 0.05)]
    return [
        k.node("floor_deck", "Grating", *deck),
        MeshNode("floor_legs", "Steel_Structure", k.inst(k.box(0.2, 1.0, 0.2), legs)),
        *k.handrail("floor", edge, f + k.DECK_T),
    ]


@builder("compressor", family="equipment", params=CompressorParams, doc=DOC_COMP, default_height_m=H_COMP)
def build_compressor(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, CompressorParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_COMP)
    if H < 1.5:
        raise ValueError("compressor: height too small")
    L, W = plan.along, plan.across
    y = 0.5
    top = H - 0.35 if p.enclosure else H
    nodes = [k.node("plinth", "Concrete", k.box(L, y, W))]
    nodes += _recip(p.throws, L, W, y, top, ctx) if p.kind == "reciprocating" else _centrifugal(L, W, y, top, ctx)
    f = p.operating_floor_m
    if f is not None and 0.5 < f < top - k.RAIL_H - 0.1:
        nodes += _floor(L, W, f)
    if p.enclosure:
        cols = [k.T(sx * (L / 2 - 0.15), 0.0, sz * (W / 2 - 0.15)) for sx in (-1, 1) for sz in (-1, 1)]
        nodes.append(MeshNode("enclosure_columns", "Steel_Structure", k.inst(k.box(0.25, H - 0.3, 0.25), cols)))
        nodes.append(k.node("enclosure_roof", "Shelter_Roof", k.box(L, 0.3, W, y0=H - 0.3)))
    return k.finish(k.turn(nodes, plan.place()), item, p, {"kind": p.kind, "along_m": L, "across_m": W})
```

- [ ] **Step 3b: Write `power.py`:**

```python
"""Power equipment: generator and transformer (unit B2)."""

from __future__ import annotations

from typing import Literal

import trimesh
from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item, _Strict

H_GEN, H_TX = 4.0, 4.0


class GeneratorParams(_Strict):
    radiator_end: Literal["start", "end"] = Field(
        "end", description="Radiator at the start (-along) or end (+along) of the long axis"
    )
    exhaust: bool = True


class TransformerParams(_Strict):
    bays: int | None = Field(None, ge=1, le=12, description="Transformer bays along the long axis. Default round(along / 6).")
    firewalls: bool = True


DOC_GEN = (
    "Containerised diesel generator: concrete plinth, fuel base tank, acoustic enclosure with doors, radiator "
    "end with louvres, exhaust silencer and stack, along the footprint's long axis. top_el = stack top."
)
DOC_TX = (
    "Transformer bays along the footprint's long axis: per bay a plinth, main tank, radiator fins, HV bushings, "
    "conservator and a cable gantry; concrete fire walls between and at the ends of the bays."
)


@builder("generator", family="equipment", params=GeneratorParams, doc=DOC_GEN, default_height_m=H_GEN)
def build_generator(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, GeneratorParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_GEN)
    if H < 1.5:
        raise ValueError("generator: height too small")
    L, W = plan.along, plan.across
    s = 1.0 if p.radiator_end == "end" else -1.0
    ex = min(1.2, 0.25 * (H - 0.6)) if p.exhaust else 0.0
    he = H - 0.6 - ex
    louvres = max(3, int(he / 0.25))
    door = k.box(0.9, min(2.1, 0.8 * he), 0.03)
    door_xf = [k.T(-s * 0.1 * L + o * L, 0.6, sz * 0.451 * W) for o in (-0.25, 0.0, 0.25) for sz in (-1, 1)]
    nodes = [
        k.node("plinth", "Concrete", k.box(L, 0.2, W)),
        k.node("fuel_base", "Steel_Dark", k.box(0.95 * L, 0.4, 0.9 * W, y0=0.2)),
        k.node("enclosure", "Machine_Green", k.box(0.76 * L, he, 0.9 * W, x=-s * 0.1 * L, y0=0.6)),
        k.node("radiator", "Equipment_White", k.box(0.18 * L, he, 0.9 * W, x=s * 0.37 * L, y0=0.6)),
        MeshNode(
            "radiator_louvres",
            "Steel_Dark",
            k.inst(k.box(0.04, 0.05, 0.8 * W), [k.T(s * 0.465 * L, 0.6 + (j + 0.5) * he / louvres, 0) for j in range(louvres)]),
        ),
        MeshNode("doors", "Steel_Dark", k.inst(door, door_xf)),
    ]
    if p.exhaust:
        rs = 0.3 * ex
        ys = 0.6 + he + rs
        nodes.append(
            k.node(
                "exhaust",
                "Steel_Dark",
                k.rod((-s * 0.3 * L, ys, 0), (-s * 0.05 * L, ys, 0), rs, ctx),
                k.rod((-s * 0.05 * L, ys, 0), (-s * 0.05 * L, H, 0), 0.4 * rs, ctx),
            )
        )
    return k.finish(k.turn(nodes, plan.place()), item, p, {"enclosure_h_m": he, "axis_bearing_deg": plan.bearing_deg})


@builder("transformer", family="equipment", params=TransformerParams, doc=DOC_TX, default_height_m=H_TX)
def build_transformer(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, TransformerParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_TX)
    if H < 1.0:
        raise ValueError("transformer: height too small")
    L, W = plan.along, plan.across
    bays = p.bays or max(1, round(L / 6.0))
    pb = L / bays
    xs = [(i - (bays - 1) / 2) * pb for i in range(bays)]
    th = 0.5 * H
    yt = 0.3 + th

    def per_bay(mesh: trimesh.Trimesh):
        return k.inst(mesh, [k.T(x, 0.0, 0.0) for x in xs])

    gantry = trimesh.util.concatenate(
        [k.bar((-0.3 * pb, 0.3, z), (-0.3 * pb, H - 0.075, z), 0.15) for z in (-0.3 * W, 0.3 * W)]
        + [k.bar((-0.3 * pb, H - 0.075, -0.3 * W), (-0.3 * pb, H - 0.075, 0.3 * W), 0.15)]
    )
    yc = yt + 0.15 * H
    fins = [
        k.T(x - 0.15 * pb + j * 0.06 * pb, 0.3 + 0.05 * H, s * 0.225 * W)
        for x in xs
        for s in (-1, 1)
        for j in range(6)
    ]
    bushings = [k.T(x, yt, z * W) for x in xs for z in (-0.1, 0.0, 0.1)]
    nodes = [
        MeshNode("plinths", "Concrete", per_bay(k.box(0.85 * pb, 0.3, 0.8 * W))),
        MeshNode("tanks", "Steel_Dark", per_bay(k.box(0.4 * pb, th, 0.35 * W, y0=0.3))),
        MeshNode("radiator_fins", "Steel_Dark", k.inst(k.box(0.04, 0.4 * H, 0.1 * W), fins)),
        MeshNode("bushings", "Equipment_White", k.inst(k.vcyl(0.08, 0.18 * H, ctx), bushings)),
        MeshNode(
            "conservators",
            "Steel_Dark",
            per_bay(k.rod((0.12 * pb, yc, -0.15 * W), (0.12 * pb, yc, 0.15 * W), min(0.06 * H, 0.1 * pb), ctx)),
        ),
        MeshNode("gantries", "Steel_Structure", per_bay(gantry)),
    ]
    if p.firewalls:
        walls = [k.T(min(max(-L / 2 + j * pb, -L / 2 + 0.125), L / 2 - 0.125), 0.0, 0.0) for j in range(bays + 1)]
        nodes.append(MeshNode("firewalls", "Concrete", k.inst(k.box(0.25, H, 0.9 * W), walls)))
    return k.finish(k.turn(nodes, plan.place()), item, p, {"bays": bays, "bay_pitch_m": pb})
```

Extend `__init__.py`: `from app.asset_models.builders.equipment import power, rotating, tanks, vessels  # noqa: F401  (registers on import)`.

- [ ] **Step 4: Run.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q -k "(compressor or generator or transformer or polygon_footprint) and not golden"`
  Expected: all pass.

- [ ] **Step 5: Goldens** (`-k "golden and (compressor or generator or transformer)"`). Review:
  - the compressor shows opposed cylinders, bottles and the floor ring with handrail;
  - the genset shows its green enclosure, white radiator end and stack;
  - `generator_polygon_top` shows the long axis about 84° (almost east-west);
  - the transformer shows four bays separated by five walls.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/__init__.py backend/app/asset_models/builders/equipment/rotating.py backend/app/asset_models/builders/equipment/power.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/compressor_iso.png backend/tests/data/plant/golden/equipment/generator_iso.png backend/tests/data/plant/golden/equipment/generator_polygon_top.png backend/tests/data/plant/golden/equipment/transformer_iso.png
git commit -m "feat(builders): compressor, generator and transformer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: heater, vaporizer_orv, vaporizer_scv

**Files:**
- Create: `backend/app/asset_models/builders/equipment/process.py`
- Modify: `backend/app/asset_models/builders/equipment/__init__.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): goldens `heater_iso.png`, `vaporizer_orv_iso.png`, `vaporizer_scv_iso.png`

**Interfaces:**
- Consumes: the kit; `vessels.head_depth`.
- Produces: `process.HeaterParams`, `process.OrvParams`, `process.ScvParams`, builders `heater`, `vaporizer_orv`, `vaporizer_scv`.
- **Node names:**
  - heater:
    - always `pad`;
    - water_bath: `skid`, `skid_cross`, `bath_shell`, `bath_heads`, `burner`, then `stack` or `nozzles`;
    - fired_box: `radiant_box`, `convection`, `stack`?, `ladder_*`.
  - ORV: `pad`, `trough`, `panels`, `distribution_troughs`, `headers`, `top_walkway`, `top_walkway_posts`, `top_walkway_rails`, `stair_stringers`, `stair_treads`.
  - SCV: `pad`, `water_bath`, `blower`, `air_duct`, `bath_top_posts`, `bath_top_rails`, `ladder_*`, `stack`?
- **Derived values:**
  - heater: `kind`, `bath_d_m`?;
  - ORV: `panels`;
  - SCV: `bath_h_m`.

- [ ] **Step 1: Cases and tests.** Under `# --- process (Tasks 9, 10)`:

```python
    "heater": Case(  # Cowork 50-F-0002A NG trim heater, water bath: 16 x 8.5 (E-W), 5 m
        "heater",
        rect(16.0, 8.5, 90.0),
        5.0,
        tris=(36, 2000),
        parts=frozenset({"pad", "skid", "bath_shell", "bath_heads", "burner", "stack"}),
    ),
    "vaporizer_orv": Case(  # Cowork 50-E-0001A open rack vaporizer: 16.1 x 10.2 (E-W), 8 m
        "vaporizer_orv",
        rect(16.1, 10.2, 90.0),
        8.0,
        tris=(252, 4000),
        parts=frozenset({"pad", "trough", "panels", "distribution_troughs", "headers", "top_walkway", "stair_treads"}),
    ),
    "vaporizer_scv": Case(  # Cowork 50-F-0001A submerged combustion vaporizer: 28.4 x 9.2 (E-W), 6 m
        "vaporizer_scv",
        rect(28.4, 9.2, 90.0),
        6.0,
        tris=(36, 2000),
        parts=frozenset({"pad", "water_bath", "blower", "air_duct", "bath_top_posts"}),
    ),
```

```python
# ------------------------------------------------------------------ process
def test_orv_panels_are_instanced_across_the_rack():
    panels = next(n for n in built("vaporizer_orv") if n.name == "panels").geometry
    assert isinstance(panels, Instanced) and len(panels.transforms) == 23  # round(0.85 * 16.1 / 0.6)


def test_scv_stack_is_off_by_default_and_on_by_param():
    assert "stack" not in {n.name for n in built("vaporizer_scv")}
    it = make_item("vaporizer_scv", rect(28.4, 9.2, 90.0), h=15.0, params={"stack": True})
    assert "stack" in {n.name for n in REGISTRY["vaporizer_scv"].fn(it, CTX)}


def test_fired_heater_builds():
    it = make_item("heater", rect(10.0, 6.0), h=12.0, params={"kind": "fired_box"})
    names = {n.name for n in REGISTRY["heater"].fn(it, CTX)}
    assert {"pad", "radiant_box", "convection", "stack", "ladder_rungs"} <= names
```

- [ ] **Step 2: Run to see it fail** (`-k "heater or orv or scv"`). Expected: `KeyError`.

- [ ] **Step 3: Write `process.py`** (Task 10 appends to it):

```python
"""Process equipment: heater, vaporizer_orv, vaporizer_scv, stack, flare, package (unit B2)."""

from __future__ import annotations

from typing import Literal

import numpy as np
from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.builders.equipment.vessels import head_depth
from app.asset_models.spec import Item, _Strict

H_HEATER, H_ORV, H_SCV = 5.0, 8.0, 6.0


class HeaterParams(_Strict):
    kind: Literal["water_bath", "fired_box"] = "water_bath"
    stack: bool = True


class OrvParams(_Strict):
    panels: int | None = Field(None, ge=1, le=60, description="Panels along the rack. Default round(0.85 along / 0.6).")
    stairs: bool = True


class ScvParams(_Strict):
    stack: bool = Field(False, description="Build the exhaust stack here; Cowork tags it as its own stack item.")
    blower_end: Literal["start", "end"] = "start"


DOC_HEATER = (
    "Heater along the footprint's long axis. water_bath: skid on a pad, horizontal bath shell with heads, burner "
    "box and stack (or coil nozzles). fired_box: radiant box, convection section, stack and a ladder."
)
DOC_ORV = (
    "Open rack vaporizer: concrete pad and sea-water trough, a bank of aluminium heat-exchange panels across the "
    "long axis, top distribution troughs, LNG inlet and NG outlet headers, a side stair and a top walkway."
)
DOC_SCV = (
    "Submerged combustion vaporizer: pad, water bath tank with handrailed top and ladder, combustion air blower "
    "and duct at one end. The exhaust stack is usually its own `stack` item (stack=false)."
)


@builder("heater", family="equipment", params=HeaterParams, doc=DOC_HEATER, default_height_m=H_HEATER)
def build_heater(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, HeaterParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_HEATER)
    if H < 1.0:
        raise ValueError("heater: height too small")
    L, W = plan.along, plan.across
    nodes = [k.node("pad", "Concrete", k.box(L, 0.2, W))]
    derived: dict = {"kind": p.kind}
    if p.kind == "water_bath":
        rails = [k.box(0.95 * L, 0.25, 0.15, z=s * 0.3 * W, y0=0.2) for s in (-1, 1)]
        xs = np.arange(-0.45 * L, 0.45 * L + 1e-6, 2.0)
        nodes.append(k.node("skid", "Steel_Structure", *rails))
        nodes.append(MeshNode("skid_cross", "Steel_Structure", k.inst(k.box(0.15, 0.25, 0.65 * W), [k.T(float(x), 0.2, 0) for x in xs])))
        y = 0.45
        d = min(0.8 * W, 0.7 * (H - y), H - y - (0.0 if p.stack else 0.4))
        if d < 0.2:
            raise ValueError("heater: height too small for the bath")
        r, hd = d / 2, head_depth("ellipsoidal", d)
        yc = y + r
        x0, x1 = -0.38 * L + hd, 0.42 * L - hd
        if x1 - x0 < 0.2:
            raise ValueError("heater: footprint too short for the bath")
        cap = k.ell_cap(r, hd, ctx, steps=6)
        nodes += [
            k.node("bath_shell", "Equipment_White", k.rod((x0, yc, 0), (x1, yc, 0), r, ctx)),
            k.node(
                "bath_heads",
                "Equipment_White",
                k.placed(cap, k.T(x1, yc, 0) @ k.Y_TO_X),
                k.placed(cap, k.T(x0, yc, 0) @ k.S(-1, 1, 1) @ k.Y_TO_X),
            ),
            k.node("burner", "Equipment_Grey", k.box(0.08 * L, 0.6 * d, 0.6 * W, x=-0.45 * L, y0=y)),
        ]
        if p.stack:
            nodes.append(k.node("stack", "Steel_Dark", k.rod((-0.3 * L, yc + 0.8 * r, 0), (-0.3 * L, H, 0), max(0.15, 0.08 * d), ctx)))
        else:
            nodes.append(
                k.node("nozzles", "Pipe", *[k.rod((x, yc + 0.8 * r, 0), (x, H, 0), max(0.05, 0.05 * d), ctx) for x in (0.15 * L, 0.3 * L)])
            )
        derived["bath_d_m"] = d
    else:
        y = 0.2
        hr = 0.55 * (H - y) if p.stack else 0.75 * (H - y)
        hc = 0.2 * (H - y) if p.stack else H - y - hr
        nodes += [
            k.node("radiant_box", "Equipment_White", k.box(0.9 * L, hr, 0.9 * W, y0=y)),
            k.node("convection", "Equipment_Grey", k.box(0.4 * L, hc, 0.6 * W, y0=y + hr)),
        ]
        if p.stack:
            nodes.append(k.node("stack", "Steel_Dark", k.vcyl(max(0.2, 0.06 * min(L, W)), H - y - hr - hc, ctx, y0=y + hr + hc)))
        nodes += k.ladder("ladder", 0.0, -0.47 * W, y, y + hr, 90.0)
    return k.finish(k.turn(nodes, plan.place()), item, p, derived)


@builder("vaporizer_orv", family="equipment", params=OrvParams, doc=DOC_ORV, default_height_m=H_ORV)
def build_vaporizer_orv(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, OrvParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_ORV)
    L, W = plan.along, plan.across
    yw = H - k.RAIL_H - k.DECK_T
    ph = yw - 0.5 - 1.1
    if ph < 0.5:
        raise ValueError("vaporizer_orv: height too small")
    n = p.panels or min(60, max(1, round(0.85 * L / 0.6)))
    xs = [-0.425 * L + (j + 0.5) * 0.85 * L / n for j in range(n)]
    zw = -(W / 2 - 0.5)
    nodes = [
        k.node("pad", "Concrete", k.box(L, 0.3, W)),
        k.node("trough", "Concrete_Dark", k.box(0.92 * L, 0.8, 0.85 * W, y0=0.3)),
        MeshNode("panels", "Aluminium_Panel", k.inst(k.box(0.06, ph, 0.7 * W), [k.T(x, 1.1, 0) for x in xs])),
        k.node("distribution_troughs", "Concrete_Dark", *[k.box(0.85 * L, 0.4, 0.08 * W, z=s * 0.38 * W, y0=1.1 + ph) for s in (-1, 1)]),
        k.node(
            "headers",
            "Equipment_Grey",
            k.rod((-0.46 * L, 1.0, 0), (0.46 * L, 1.0, 0), max(0.1, 0.03 * W), ctx),
            k.rod((-0.46 * L, 1.3 + ph, 0), (0.46 * L, 1.3 + ph, 0), max(0.15, 0.04 * W), ctx),
        ),
    ]
    x_w0 = -0.46 * L
    if p.stairs:
        rise = yw - 0.3
        run = min(rise, 0.55 * L)
        x_bot = -0.48 * L
        nodes += k.stair("stair", (x_bot, 0.3, zw), (x_bot + run, yw, zw), 0.9)
        x_w0 = x_bot + run
    nodes.append(k.node("top_walkway", "Grating", k.box(0.46 * L - x_w0, k.DECK_T, 1.0, x=(x_w0 + 0.46 * L) / 2, z=zw, y0=yw)))
    nodes += k.handrail("top_walkway", [(x_w0, -W / 2 + 0.03), (0.46 * L, -W / 2 + 0.03)], yw + k.DECK_T, closed=False)
    return k.finish(k.turn(nodes, plan.place()), item, p, {"panels": n})


@builder("vaporizer_scv", family="equipment", params=ScvParams, doc=DOC_SCV, default_height_m=H_SCV)
def build_vaporizer_scv(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, ScvParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_SCV)
    if H < 2.0:
        raise ValueError("vaporizer_scv: height too small")
    L, W = plan.along, plan.across
    s = -1.0 if p.blower_end == "start" else 1.0
    y = 0.3
    bh = 0.55 * (H - y) if p.stack else H - y - k.RAIL_H - 0.02
    xb = -s * 0.12 * L
    rb = min(0.12 * W, 0.2 * (H - y), 0.06 * L)
    xbl = s * 0.38 * L
    edge = xb + s * 0.35 * L
    nodes = [
        k.node("pad", "Concrete", k.box(L, y, W)),
        k.node("water_bath", "Equipment_Grey", k.box(0.7 * L, bh, 0.85 * W, x=xb, y0=y)),
        k.node(
            "blower",
            "Machine_Green",
            k.rod((xbl, y + rb, -0.25 * W), (xbl, y + rb, 0.05 * W), rb, ctx),
            k.rod((xbl, y + rb, 0.05 * W), (xbl, y + rb, 0.3 * W), 0.6 * rb, ctx),
        ),
        k.node("air_duct", "Equipment_Grey", k.bar((xbl, y + 2 * rb, -0.1 * W), (edge, y + 0.9 * bh, -0.1 * W), 0.6 * rb)),
    ]
    corners = [(xb - 0.35 * L, -0.425 * W), (xb + 0.35 * L, -0.425 * W), (xb + 0.35 * L, 0.425 * W), (xb - 0.35 * L, 0.425 * W)]
    nodes += k.handrail("bath_top", corners, y + bh)
    xl = xb - s * (0.35 * L + 0.25)
    nodes += k.ladder("ladder", xl, 0.0, y, y + bh, 180.0 if xl > xb else 0.0)
    if p.stack:
        nodes.append(k.node("stack", "Steel_Dark", k.vcyl(max(0.3, 0.1 * W), H - y - bh, ctx, x=xb - s * 0.2 * L, y0=y + bh)))
    return k.finish(k.turn(nodes, plan.place()), item, p, {"bath_h_m": bh})
```

Extend `__init__.py`: `from app.asset_models.builders.equipment import power, process, rotating, tanks, vessels  # noqa: F401  (registers on import)`.

- [ ] **Step 4: Run** (`-k "(heater or orv or scv) and not golden"`). Expected: all pass.

- [ ] **Step 5: Goldens** (`-k "golden and (heater or vaporizer)"`). Review:
  - the heater is a white bath on a skid with a dark stack;
  - the ORV shows a row of tall panels, troughs on top and a stair up the side;
  - the SCV shows a grey bath box with a green blower and duct.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/__init__.py backend/app/asset_models/builders/equipment/process.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/heater_iso.png backend/tests/data/plant/golden/equipment/vaporizer_orv_iso.png backend/tests/data/plant/golden/equipment/vaporizer_scv_iso.png
git commit -m "feat(builders): heater, open rack and submerged combustion vaporizers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: stack, flare, package

**Files:**
- Modify: `backend/app/asset_models/builders/equipment/process.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): goldens `stack_iso.png`, `flare_iso.png`, `package_iso.png`, `package_enclosure_iso.png`

**Interfaces:**
- Consumes: the kit.
- Produces: `process.StackParams`, `process.FlareParams`, `process.PackageParams`, `process.PACKAGE_COLOUR`, builders `stack`, `flare`, `package`.
- **Node names:**
  - stack: `plinth`, `base_ring`, `shell`, `bands`?, `platform_deck`, `platform_posts`, `platform_rails`, `ladder_*`.
  - flare:
    - always `foundation`, `riser`, `seal`, `tip`;
    - derrick: `derrick`, `leg_footings`, `platform_<i>_deck|posts|rails`;
    - guyed: `guys`, `guy_anchors`, `tip_platform_*`;
    - self: `tip_platform_*`.
  - package:
    - skid: `skid_frame`, `skid_cross`?, `skid_vessel`, `skid_module`, `piping`;
    - enclosure: `pad`, `enclosure`, `roof`, `door`;
    - cabinet: `plinth`, `cabinet`, `canopy`.
- **Derived values:**
  - stack: `d_m`, `top_d_m`;
  - flare: `riser_d_m`, `tip_d_m`, `derrick_base_m`?;
  - package: `style`.

- [ ] **Step 1: Cases and tests.** Under the process marker, after the Task 9 rows:

```python
    "stack": Case(  # Cowork 50-F-0001A-stack: D 3.22, 15 m
        "stack",
        circle(3.22),
        15.0,
        margin=1.2,
        tris=(192, 2500),
        parts=frozenset({"shell", "bands", "platform_deck", "ladder_rungs"}),
    ),
    "flare": Case(  # Cowork 60-A-0001 flare package: circle R 2.25, 50 m on the flare platform
        "flare",
        circle(4.5),
        50.0,
        margin=3.0,
        tris=(404, 5000),
        parts=frozenset({"foundation", "riser", "seal", "tip", "derrick", "leg_footings", "platform_0_deck"}),
    ),
    "package": Case(  # Cowork 20-DCP-001 dry chemical skid: 5.9 x 2.5, 2 m
        "package",
        rect(5.9, 2.5),
        2.0,
        tris=(36, 800),
        parts=frozenset({"skid_frame", "skid_vessel", "skid_module", "piping"}),
    ),
    "package_enclosure": Case(
        "package",
        rect(6.0, 4.0, 45.0),
        3.5,
        params={"colour": "red"},
        tris=(36, 800),
        parts=frozenset({"pad", "enclosure", "roof", "door"}),
    ),
    "package_cabinet": Case(
        "package", rect(1.5, 1.0), 2.0, tris=(36, 800), parts=frozenset({"plinth", "cabinet", "canopy"}), golden=()
    ),
```

```python
def test_package_style_auto_and_colour():
    assert built("package")[0].extras["derived"]["style"] == "skid"
    assert built("package_enclosure")[0].extras["derived"]["style"] == "enclosure"
    assert built("package_cabinet")[0].extras["derived"]["style"] == "cabinet"
    assert next(n for n in built("package_enclosure") if n.name == "enclosure").material == "Safety_Red"


@pytest.mark.parametrize("support", ["guyed", "self"])
def test_flare_other_supports_build(support):
    it = make_item("flare", circle(4.5), h=50.0, params={"support": support})
    names = {n.name for n in REGISTRY["flare"].fn(it, CTX)}
    assert {"riser", "tip", "tip_platform_deck"} <= names
    assert ("guys" in names) == (support == "guyed")


def test_stack_lod_lowers_triangles():
    assert tris(built("stack", 0.25)) < tris(built("stack"))
```

- [ ] **Step 2: Run to see it fail** (`-k "stack or flare or package"`). Expected: `KeyError`.

- [ ] **Step 3: Append to `process.py`.** Add `import math` to its imports and `Pos` to the spec import. Then:

```python
H_STACK, H_FLARE, H_PACKAGE = 15.0, 50.0, 3.0
PACKAGE_COLOUR = {
    "grey": "Equipment_Grey",
    "white": "Equipment_White",
    "red": "Safety_Red",
    "green": "Machine_Green",
    "blue": "Pump_Blue",
}


class StackParams(_Strict):
    top_d_ratio: float = Field(0.8, gt=0, le=1, description="Top OD / base OD")
    bands: int = Field(2, ge=0, le=6, description="Red aviation bands at the top")
    platform: bool | None = Field(None, description="Sampling platform at 0.75 H. Default: H >= 15 m.")
    ladder: bool | None = Field(None, description="Ladder. Default: H >= 6 m.")


class FlareParams(_Strict):
    support: Literal["derrick", "guyed", "self"] = "derrick"
    riser_d_m: Pos | None = Field(None, description="Riser OD. Default 0.3 x footprint d, at most 1.5 m.")
    tip_d_m: Pos | None = Field(None, description="Flare tip OD. Default 1.3 x riser.")
    derrick_base_m: Pos | None = Field(None, description="Derrick base width. Default max(footprint d, 0.16 H).")
    platforms: int = Field(2, ge=0, le=6, description="Derrick platforms; the top one sits just under the tip")


class PackageParams(_Strict):
    style: Literal["auto", "skid", "enclosure", "cabinet"] = Field(
        "auto", description="auto: plan area < 4 m2 -> cabinet; height <= 2.5 m -> skid; else enclosure"
    )
    colour: Literal["grey", "white", "red", "green", "blue"] = Field(
        "grey", description="Main body colour; red for fire and safety packages"
    )


DOC_STACK = (
    "Free-standing stack or chimney: plinth, base ring, tapered steel shell, red aviation bands, a sampling "
    "platform with handrail and a ladder. Footprint: circle = base OD. top_el = stack top."
)
DOC_FLARE = (
    "Elevated flare: riser with molecular seal and red flare tip, supported by a 4-leg lattice derrick with "
    "platforms (default), guy wires, or self-supported. Footprint: circle = flare base. top_el = tip top."
)
DOC_PACKAGE = (
    "Generic packaged unit. skid: steel skid with a small vessel, a module box and piping. enclosure: walled "
    "box with roof and door on a pad. cabinet: a small cabinet with a canopy. Use colour red for fire/safety."
)


@builder("stack", family="equipment", params=StackParams, doc=DOC_STACK, default_height_m=H_STACK)
def build_stack(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, StackParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_STACK)
    if H < 2.0:
        raise ValueError("stack: height too small")
    r0 = min(plan.along, plan.across) / 2
    rt = r0 * p.top_d_ratio

    def r_at(y: float) -> float:
        return r0 + (rt - r0) * (y - 0.45) / (H - 0.45)

    nodes = [
        k.node("plinth", "Concrete", k.vcyl(r0 + 0.3, 0.3, ctx, n=8)),
        k.node("base_ring", "Steel_Dark", k.vcyl(r0 * 1.1, 0.15, ctx, y0=0.3)),
        k.node("shell", "Steel_Dark", k.lathe([(0.0, 0.45), (r0, 0.45), (rt, H), (0.0, H)], ctx, r0)),
    ]
    bh = min(0.05 * H, 1.5)
    bands = []
    for i in range(p.bands):
        yt = H - i * 2 * bh
        yb = yt - bh
        if yb <= 0.45:
            break
        bands.append(k.lathe([(0.0, yb), (r_at(yb) + 0.02, yb), (r_at(yt) + 0.02, yt), (0.0, yt)], ctx, r0))
    if bands:
        nodes.append(k.node("bands", "Safety_Red", *bands))
    want_platform = p.platform if p.platform is not None else H >= 15.0
    want_ladder = p.ladder if p.ladder is not None else H >= 6.0
    yp = min(0.75 * H, H - k.RAIL_H - 0.1)
    if want_platform:
        rp = r_at(yp)
        deck = k.lathe([(rp, yp - k.DECK_T), (rp + 1.0, yp - k.DECK_T), (rp + 1.0, yp), (rp, yp)], ctx, rp + 1.0)
        nodes.append(k.node("platform_deck", "Grating", deck))
        nodes += k.ring_handrail("platform", rp + 0.95, yp, ctx)
    if want_ladder:
        nodes += k.ladder("ladder", -(r0 + 0.4), 0.0, 0.45, yp if want_platform else H - 0.5, 0.0)
    return k.finish(k.turn(nodes, plan.place()), item, p, {"d_m": 2 * r0, "top_d_m": 2 * rt})


@builder("flare", family="equipment", params=FlareParams, doc=DOC_FLARE, default_height_m=H_FLARE)
def build_flare(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, FlareParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_FLARE)
    d = min(plan.along, plan.across)
    rd = p.riser_d_m or min(1.5, 0.3 * d)
    td = p.tip_d_m or 1.3 * rd
    tip_h = max(2.0, 2.0 * td)
    y_tip = H - tip_h
    if y_tip < 3.0:
        raise ValueError("flare: height too small")
    riser_r = rd / 2 * (1.3 if p.support == "self" else 1.0)
    nodes = [
        k.node("foundation", "Concrete", k.vcyl(d / 2, 0.3, ctx)),
        k.node("riser", "Steel_Dark", k.vcyl(riser_r, y_tip - 0.3, ctx, y0=0.3)),
        k.node("seal", "Steel_Dark", k.vcyl(min(0.9 * rd, d / 2 - 0.05), min(6.0, 0.12 * H), ctx, y0=0.3)),
        k.node("tip", "Safety_Red", k.lathe([(0.0, y_tip), (td / 2, y_tip), (td / 2, H), (0.0, H)], ctx, td / 2)),
    ]
    derived: dict = {"riser_d_m": rd, "tip_d_m": td}
    if p.support == "derrick":
        b = p.derrick_base_m or max(d, 0.16 * H)
        tw = max(rd + 1.0, 0.25 * b)
        hd = y_tip - 1.0

        def half(y: float) -> float:
            return b / 2 + (tw / 2 - b / 2) * min(y, hd) / hd

        corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))
        legs_y0 = 0.4  # legs stand on the 0.4 m footings
        nodes.append(k.node("derrick", "Steel_Structure", *k.lattice(b, tw, legs_y0, hd, 0.8 * b, 0.3, 0.12)))
        nodes.append(MeshNode("leg_footings", "Concrete", k.inst(k.box(1.2, 0.4, 1.2), [k.T(c[0] * b / 2, 0, c[1] * b / 2) for c in corners])))
        levels = ([y_tip - 0.3] + [hd * j / p.platforms for j in range(1, p.platforms)]) if p.platforms else []
        for i, yl in enumerate(levels):
            hw = half(yl) + 0.6
            sq = [(hw, hw), (hw, -hw), (-hw, -hw), (-hw, hw)]
            nodes.append(k.node(f"platform_{i}_deck", "Grating", k.slab(sq, yl - k.DECK_T, k.DECK_T)))
            nodes += k.handrail(f"platform_{i}", sq, yl)
        derived["derrick_base_m"] = b
    else:
        yl = y_tip - 0.3
        deck = k.lathe([(riser_r, yl - k.DECK_T), (riser_r + 1.0, yl - k.DECK_T), (riser_r + 1.0, yl), (riser_r, yl)], ctx, riser_r + 1.0)
        nodes.append(k.node("tip_platform_deck", "Grating", deck))
        nodes += k.ring_handrail("tip_platform", riser_r + 0.95, yl, ctx)
        if p.support == "guyed":
            anchors = [(0.5 * H * math.cos(a), 0.5 * H * math.sin(a)) for a in np.radians([0.0, 120.0, 240.0])]
            nodes.append(k.node("guys", "Steel_Structure", *[k.bar((0, 0.7 * H, 0), (ax, 0.3, az), 0.05) for ax, az in anchors]))
            nodes.append(MeshNode("guy_anchors", "Concrete", k.inst(k.box(1.0, 0.6, 1.0), [k.T(ax, 0, az) for ax, az in anchors])))
    return k.finish(k.turn(nodes, plan.place()), item, p, derived)


@builder("package", family="equipment", params=PackageParams, doc=DOC_PACKAGE, default_height_m=H_PACKAGE)
def build_package(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, PackageParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_PACKAGE)
    if H < 0.5:
        raise ValueError("package: height too small")
    L, W = plan.along, plan.across
    style = p.style
    if style == "auto":
        style = "cabinet" if L * W < 4.0 else ("skid" if H <= 2.5 else "enclosure")
    mat = PACKAGE_COLOUR[p.colour]
    if style == "skid":
        fr = 0.2
        frame = [k.box(L, fr, 0.15, z=s * (W / 2 - 0.075)) for s in (-1, 1)]
        frame += [k.box(0.15, fr, W - 0.3, x=s * (L / 2 - 0.075)) for s in (-1, 1)]
        nodes = [k.node("skid_frame", "Steel_Structure", *frame)]
        xs = np.arange(-L / 2 + 1.5, L / 2 - 0.5, 1.5)
        if len(xs):
            nodes.append(MeshNode("skid_cross", "Steel_Structure", k.inst(k.box(0.12, fr, W - 0.3), [k.T(float(x), 0, 0) for x in xs])))
        d = min(0.5 * W, 0.6 * (H - fr))
        r = d / 2
        yc = fr + r + 0.05
        yp = min(yc + r + 0.25, H - 0.05)
        rp = max(0.03, 0.05 * d)
        nodes += [
            k.node("skid_vessel", mat, k.rod((-0.42 * L, yc, 0), (0.02 * L, yc, 0), r, ctx)),
            k.node("skid_module", mat, k.box(0.36 * L, H - fr, 0.7 * W, x=0.26 * L, y0=fr)),
            k.node(
                "piping",
                "Pipe",
                k.rod((-0.2 * L, yc + 0.8 * r, 0.15 * W), (-0.2 * L, yp, 0.15 * W), rp, ctx),
                k.rod((-0.2 * L, yp, 0.15 * W), (0.08 * L, yp, 0.15 * W), rp, ctx),
            ),
        ]
    elif style == "enclosure":
        nodes = [
            k.node("pad", "Concrete", k.box(L, 0.15, W)),
            k.node("enclosure", mat, k.box(0.96 * L, H - 0.4, 0.96 * W, y0=0.15)),
            k.node("roof", "Equipment_White", k.box(L, 0.25, W, y0=H - 0.25)),
            k.node("door", "Steel_Dark", k.box(0.03, min(2.1, 0.8 * (H - 0.4)), min(1.0, 0.4 * W), x=0.48 * L + 0.015, y0=0.15)),
        ]
    else:
        nodes = [
            k.node("plinth", "Concrete", k.box(L, 0.1, W)),
            k.node("cabinet", mat, k.box(0.9 * L, H - 0.2, 0.9 * W, y0=0.1)),
            k.node("canopy", "Equipment_White", k.box(L, 0.1, W, y0=H - 0.1)),
        ]
    return k.finish(k.turn(nodes, plan.place()), item, p, {"style": style})
```

- [ ] **Step 4: Run** (`-k "(stack or flare or package) and not golden"`). Expected: all pass. If the flare is over 5 000 triangles, raise the derrick bay from `0.8 * b` to `1.0 * b`.

- [ ] **Step 5: Goldens** (`-k "golden and (stack or flare or package)"`). Review:
  - the banded stack with its platform;
  - the derrick-supported flare with a red tip and two platforms;
  - the skid package;
  - the red enclosure turned 45°.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/process.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/stack_iso.png backend/tests/data/plant/golden/equipment/flare_iso.png backend/tests/data/plant/golden/equipment/package_iso.png backend/tests/data/plant/golden/equipment/package_enclosure_iso.png
git commit -m "feat(builders): stack, flare and package" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: loading_arm, crane, monitor, nav_aid

**Files:**
- Create: `backend/app/asset_models/builders/equipment/jetty.py`
- Modify: `backend/app/asset_models/builders/equipment/__init__.py`
- Modify: `backend/tests/test_builders_equipment.py`
- Create (generated): goldens `loading_arm_iso.png`, `crane_iso.png`, `monitor_iso.png`, `nav_aid_iso.png`

**Interfaces:**
- Consumes: the kit.
- Produces: `jetty.LoadingArmParams`, `jetty.CraneParams`, `jetty.MonitorParams`, `jetty.NavAidParams`, builders `loading_arm`, `crane`, `monitor`, `nav_aid`.
- **Node names:**
  - loading_arm: `base`, `riser`, `slew_bearing`, `inner_arm`, `outer_arm`, `swivels`, `counterweight`, `pantograph`.
  - crane:
    - jib: `base`, `mast`, `jib`, `knee_brace`, `hoist`, `hook`;
    - pedestal: `pedestal`, `slew_ring`, `cab`, `boom`, `luffing_rope`, `hook`.
  - monitor: `tower`, `platform`, `platform_posts`, `platform_rails`, `monitor`, `ladder_*`.
  - nav_aid:
    - always `base`, `mast`;
    - light/beacon: `lantern`, `cap`, then `solar_panel` (light) or `daymark` (beacon);
    - horn: `horn`, `junction_box`.
- **Derived values:**
  - loading_arm: `inner_m`, `outer_m`, `reach_m`;
  - crane: `reach_m`;
  - monitor: `platform_el_m`;
  - nav_aid: `kind`.

- [ ] **Step 1: Cases and tests.** Under `# --- jetty (Task 11)`:

```python
    "loading_arm": Case(  # Cowork 10-Z-0001A LNG unloading arm: riser D ~1.06, stowed ~18 m
        "loading_arm",
        circle(1.06),
        18.0,
        margin=12.6,
        tris=(180, 1500),
        parts=frozenset({"riser", "inner_arm", "outer_arm", "counterweight", "swivels", "pantograph"}),
    ),
    "crane": Case(  # Cowork 20-A-0011 jib crane on the pump platform: 8 m, reach ~7
        "crane",
        circle(1.2),
        8.0,
        margin=7.2,
        tris=(52, 800),
        parts=frozenset({"mast", "jib", "hoist", "hook"}),
    ),
    "monitor": Case(  # Cowork 10-RCM-001 elevated water monitor: 15 m tower
        "monitor",
        circle(0.8),
        15.0,
        margin=1.3,
        tris=(92, 1500),
        parts=frozenset({"tower", "platform", "monitor", "ladder_rungs"}),
    ),
    "nav_aid": Case(  # Cowork 10-NA-11V01 navigation light mast: 6 m
        "nav_aid",
        circle(0.8),
        6.0,
        tris=(72, 800),
        parts=frozenset({"base", "mast", "lantern", "cap"}),
    ),
```

```python
# ------------------------------------------------------------------ jetty
def test_loading_arm_reaches_toward_its_slew_bearing():
    for slew in (90.0, 200.0):  # not 0: atan2 of a -0.0 z wraps to ~360
        it = make_item("loading_arm", circle(1.06), h=18.0, params={"slew_deg": slew})
        arm = next(n for n in REGISTRY["loading_arm"].fn(it, CTX) if n.name == "outer_arm").geometry
        x, _, z = arm.centroid
        assert math.degrees(math.atan2(z, x)) % 360 == pytest.approx(slew, abs=1.0)


def test_crane_jib_points_along_slew_and_pedestal_builds():
    it = make_item("crane", circle(1.2), h=8.0, params={"slew_deg": 270.0})
    jib = next(n for n in REGISTRY["crane"].fn(it, CTX) if n.name == "jib").geometry
    assert jib.centroid[2] < -2.0  # 270 deg = west = -z
    ped = make_item("crane", circle(2.0), h=12.0, params={"kind": "pedestal", "reach_m": 15.0})
    names = {n.name for n in REGISTRY["crane"].fn(ped, CTX)}
    assert {"pedestal", "cab", "boom", "luffing_rope"} <= names


@pytest.mark.parametrize("kind", ["horn", "beacon"])
def test_nav_aid_kinds_build(kind):
    it = make_item("nav_aid", circle(0.6), h=4.0, params={"kind": kind, "colour": "green"})
    nodes = REGISTRY["nav_aid"].fn(it, CTX)
    names = {n.name for n in nodes}
    assert ("horn" in names) == (kind == "horn") and ("daymark" in names) == (kind == "beacon")
    lo, hi = bounds(nodes)
    assert abs(hi[1] - 4.0) <= 0.5
```

- [ ] **Step 2: Run to see it fail** (`-k "loading_arm or crane or monitor or nav_aid"`). Expected: `KeyError`.

- [ ] **Step 3: Write `jetty.py`:**

```python
"""Jetty and safety equipment: loading_arm, crane, monitor, nav_aid (unit B2)."""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item, Pos, _Strict

H_ARM, H_CRANE, H_MON, H_NAV = 18.0, 8.0, 15.0, 6.0
LIGHT = {"red": "Safety_Red", "green": "Machine_Green", "white": "Equipment_White", "yellow": "Handrail"}


class LoadingArmParams(_Strict):
    slew_deg: float = Field(90.0, description="Bearing the arms reach toward (the berth face); default east")
    riser_frac: float = Field(0.45, gt=0.1, lt=0.9, description="Riser height / H")
    inner_up_deg: float = Field(65.0, ge=10, le=90, description="Inner arm elevation (stowed ~65)")
    outer_down_deg: float = Field(75.0, ge=0, le=90, description="Outer arm angle below horizontal")
    pipe_d_m: Pos | None = Field(None, description="Arm pipe OD. Default 0.5 x footprint d, at most 0.6 m.")


class CraneParams(_Strict):
    kind: Literal["jib", "pedestal"] = "jib"
    reach_m: Pos = Field(7.0, description="Jib or boom reach from the mast axis, m")
    slew_deg: float = Field(0.0, description="Bearing the jib or boom points to (stowed)")
    boom_up_deg: float = Field(45.0, ge=0, le=85, description="Pedestal crane boom elevation")


class MonitorParams(_Strict):
    tower: Literal["column", "lattice"] = "column"
    platform_m: Pos = Field(2.0, description="Square platform side at the top, m")
    aim_deg: float = Field(90.0, description="Bearing the monitor nozzle points to")


class NavAidParams(_Strict):
    kind: Literal["light", "horn", "beacon"] = "light"
    colour: Literal["red", "green", "white", "yellow"] = "red"


DOC_ARM = (
    "Marine loading arm: riser on a base plate, slewing bearing, inner arm, outer arm hanging to the coupler, "
    "swivels, counterweight and pantograph, stowed toward slew_deg (the berth). Footprint: circle = riser base."
)
DOC_CRANE = (
    "Crane. jib: pillar jib crane (mast, horizontal jib with knee brace, hoist and hook) - the tank-roof and "
    "platform cranes. pedestal: pedestal crane with cab and luffed boom. Footprint: circle = mast base."
)
DOC_MON = (
    "Elevated fire water monitor: red column or lattice tower, grating platform with handrail, monitor nozzle "
    "aimed at aim_deg and a ladder. Footprint: circle = tower base. top_el = monitor top."
)
DOC_NAV = (
    "Navigation aid on a mast: light (lantern, cap, solar panel), horn (fog horn and junction box) or beacon "
    "(lantern plus daymark board). Footprint: circle = mast base. colour sets the lantern/horn colour."
)


@builder("loading_arm", family="equipment", params=LoadingArmParams, doc=DOC_ARM, default_height_m=H_ARM)
def build_loading_arm(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, LoadingArmParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_ARM)
    d0 = min(plan.along, plan.across)
    rr = d0 / 2
    rp = (p.pipe_d_m or min(0.6, 0.5 * d0)) / 2
    yr = p.riser_frac * H
    ti, to = math.radians(p.inner_up_deg), math.radians(p.outer_down_deg)
    p0 = np.array([0.0, yr + 0.6, 0.0])
    li = (H - 0.1 - rp - p0[1]) / max(math.sin(ti), 1e-3)
    if li < 0.5:
        raise ValueError("loading_arm: height too small for the inner arm")
    li = min(li, 0.6 * H)
    di = np.array([math.cos(ti), math.sin(ti), 0.0])
    p1 = p0 + li * di
    lo = 1.15 * li
    if math.sin(to) > 1e-3:
        lo = min(lo, (p1[1] - 0.5) / math.sin(to))
    p2 = p1 + lo * np.array([math.cos(to), -math.sin(to), 0.0])
    pc = p0 - 0.3 * li * di
    pc[1] = max(pc[1], 0.7)
    across = np.array([0.0, 0.0, 2.2 * rp])
    coupler = min(1.0, p2[1] - 0.1)
    nodes = [
        k.node("base", "Steel_Dark", k.vcyl(rr * 1.4, 0.15, ctx)),
        k.node("riser", "Equipment_White", k.vcyl(rr, yr - 0.15, ctx, y0=0.15)),
        k.node("slew_bearing", "Steel_Dark", k.vcyl(rr * 1.2, 0.3, ctx, y0=yr), k.vcyl(rr * 0.8, 0.3, ctx, y0=yr + 0.3)),
        k.node("inner_arm", "Equipment_White", k.rod(p0, p1, rp, ctx), k.rod(p0, pc, 0.8 * rp, ctx)),
        k.node("outer_arm", "Equipment_White", k.rod(p1, p2, rp, ctx)),
        k.node(
            "swivels",
            "Steel_Dark",
            k.rod(p0 - across, p0 + across, 1.4 * rp, ctx),
            k.rod(p1 - across, p1 + across, 1.4 * rp, ctx),
            *([k.rod(p2, p2 - np.array([0.0, coupler, 0.0]), 1.2 * rp, ctx)] if coupler > 0.05 else []),
        ),
        k.node("counterweight", "Steel_Dark", k.box(1.2, 1.2, 1.0, x=float(pc[0]), y0=float(pc[1]) - 0.6)),
        k.node("pantograph", "Handrail", k.bar(pc + np.array([0.0, 0.6, 0.0]), p1, 0.08)),
    ]
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz) @ k.yaw(p.slew_deg))
    return k.finish(nodes, item, p, {"inner_m": li, "outer_m": lo, "reach_m": float(p2[0])})


@builder("crane", family="equipment", params=CraneParams, doc=DOC_CRANE, default_height_m=H_CRANE)
def build_crane(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, CraneParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_CRANE)
    if H < 2.5:
        raise ValueError("crane: height too small")
    d = min(plan.along, plan.across)
    reach = p.reach_m
    if p.kind == "jib":
        rm = max(0.15, 0.3 * d)
        yj = H - 0.25
        xh = 0.7 * reach
        nodes = [
            k.node("base", "Steel_Dark", k.vcyl(min(1.6 * rm, d / 2), 0.1, ctx)),
            k.node("mast", "Handrail", k.vcyl(rm, H - 0.1, ctx, y0=0.1)),
            k.node("jib", "Handrail", k.bar((0, yj, 0), (reach, yj, 0), 0.25, 0.4)),
            k.node("knee_brace", "Handrail", k.bar((0, max(0.5, yj - 1.2), 0), (0.35 * reach, yj - 0.2, 0), 0.1)),
            k.node("hoist", "Steel_Dark", k.box(0.6, 0.4, 0.5, x=xh, y0=yj - 0.6)),
            k.node(
                "hook",
                "Steel_Dark",
                k.bar((xh, yj - 0.6, 0), (xh, max(0.5, yj - 2.5), 0), 0.03),
                k.box(0.25, 0.25, 0.25, x=xh, y0=max(0.25, yj - 2.75)),
            ),
        ]
    else:
        rm = max(0.4, 0.35 * d)
        hp = 0.55 * H
        cab_h = max(0.5, min(2.0, H - hp - 0.4))
        b0 = np.array([0.4 * rm, hp + 0.8, 0.0])
        b = math.radians(p.boom_up_deg)
        lb = reach / math.cos(b)
        if b0[1] + lb * math.sin(b) > H - 0.2 and math.sin(b) > 1e-3:
            lb = (H - 0.2 - b0[1]) / math.sin(b)
            reach = lb * math.cos(b)
        tip = b0 + lb * np.array([math.cos(b), math.sin(b), 0.0])
        a_top = np.array([-0.2, min(H, hp + 3.0), 0.0])
        nodes = [
            k.node("pedestal", "Handrail", k.vcyl(rm, hp, ctx)),
            k.node("slew_ring", "Steel_Dark", k.vcyl(1.15 * rm, 0.3, ctx, y0=hp)),
            k.node("cab", "Equipment_White", k.box(1.6, cab_h, 1.4, x=-0.5, y0=hp + 0.3)),
            k.node("boom", "Handrail", k.bar(b0, tip, 0.4)),
            k.node("luffing_rope", "Steel_Dark", k.bar(a_top, tip, 0.04)),
            k.node("hook", "Steel_Dark", k.bar(tip, tip - np.array([0.0, min(2.0, tip[1] - 0.3), 0.0]), 0.03)),
        ]
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz) @ k.yaw(p.slew_deg))
    return k.finish(nodes, item, p, {"reach_m": reach})


@builder("monitor", family="equipment", params=MonitorParams, doc=DOC_MON, default_height_m=H_MON)
def build_monitor(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, MonitorParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_MON)
    d = min(plan.along, plan.across)
    yp = H - k.RAIL_H - k.DECK_T
    if yp < 1.0:
        raise ValueError("monitor: height too small")
    rt = max(0.25, d / 2)
    if p.tower == "column":
        tower = [k.vcyl(rt, yp, ctx)]
    else:
        tower = k.lattice(max(d, 1.2), 0.8, 0.1, yp, 3.0, 0.15, 0.08)  # legs from 0.1 m so no bar dips below grade
    pm = p.platform_m
    sq = [(pm / 2, pm / 2), (pm / 2, -pm / 2), (-pm / 2, -pm / 2), (-pm / 2, pm / 2)]
    a, pitch = math.radians(p.aim_deg), math.radians(15.0)
    base = np.array([0.0, yp + 0.9, 0.0])
    tip = base + 1.2 * np.array([math.cos(a) * math.cos(pitch), math.sin(pitch), math.sin(a) * math.cos(pitch)])
    la = math.radians(p.aim_deg + 180.0)
    nodes = [
        k.node("tower", "Safety_Red", *tower),
        k.node("platform", "Grating", k.box(pm, k.DECK_T, pm, y0=yp)),
        *k.handrail("platform", sq, yp + k.DECK_T),
        k.node("monitor", "Safety_Red", k.vcyl(0.12, 0.82, ctx, y0=yp + k.DECK_T), k.rod(base, tip, 0.08, ctx)),
        *k.ladder("ladder", math.cos(la) * (rt + 0.4), math.sin(la) * (rt + 0.4), 0.0, yp, p.aim_deg),
    ]
    return k.finish(k.turn(nodes, plan.place()), item, p, {"platform_el_m": yp})


def _light_head(ym: float, H: float, lamp: str, ctx: BuildCtx) -> list[MeshNode]:
    return [
        k.node("lantern", lamp, k.vcyl(0.2, 0.45, ctx, y0=ym)),
        k.node("cap", "Steel_Dark", k.lathe([(0.0, ym + 0.45), (0.22, ym + 0.45), (0.0, H)], ctx, 0.22)),
    ]


@builder("nav_aid", family="equipment", params=NavAidParams, doc=DOC_NAV, default_height_m=H_NAV)
def build_nav_aid(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, NavAidParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_NAV)
    if H < 1.0:
        raise ValueError("nav_aid: height too small")
    lamp = LIGHT[p.colour]
    nodes = [k.node("base", "Steel_Dark", k.vcyl(0.3, 0.05, ctx, n=8))]
    if p.kind == "horn":
        horn = k.placed(k.lathe([(0.0, 0.0), (0.06, 0.0), (0.25, 0.6), (0.0, 0.6)], ctx, 0.25), k.T(0.1, H - 0.45, 0) @ k.Y_TO_X)
        nodes += [
            k.node("mast", "Handrail", k.vcyl(0.08, H - 0.05, ctx, y0=0.05)),
            k.node("horn", lamp, horn),
            k.node("junction_box", "Steel_Dark", k.box(0.25, 0.3, 0.2, x=-0.15, y0=H - 1.0)),
        ]
    else:
        ym = H - 0.6
        nodes.append(k.node("mast", "Handrail", k.vcyl(0.08, ym - 0.05, ctx, y0=0.05)))
        nodes += _light_head(ym, H, lamp, ctx)
        if p.kind == "beacon":
            nodes.append(k.node("daymark", lamp, k.box(0.03, min(1.0, ym - 0.3), 1.0, x=0.1, y0=max(0.3, ym - 1.1))))
        else:
            nodes.append(
                k.node(
                    "solar_panel",
                    "Steel_Dark",
                    k.box(0.4, 0.03, 0.5, x=-0.3, y0=ym - 0.5),
                    k.bar((-0.05, ym - 0.48, 0), (-0.12, ym - 0.48, 0), 0.04),
                )
            )
    return k.finish(k.turn(nodes, plan.place()), item, p, {"kind": p.kind})
```

Final `__init__.py`:

```python
"""Equipment family (unit B2). Importing this package registers its builders in REGISTRY."""

from app.asset_models.builders.equipment import jetty, power, process, rotating, tanks, vessels  # noqa: F401  (registers)
```

- [ ] **Step 4: Run** (`-k "(loading_arm or crane or monitor or nav_aid) and not golden"`). Expected: all pass.
  - If `test_bounds[loading_arm]` fails on the height, check that the inner arm apex is `H - 0.1 - rp` plus the swivel radius. Lower the apex by `0.4 * rp` rather than widening the tolerance.

- [ ] **Step 5: Goldens** (`-k "golden and (loading_arm or crane or monitor or nav_aid)"`). Review:
  - the arm reaches east with its outer arm hanging;
  - the crane jib points north;
  - the red monitor tower has its platform;
  - the light mast has its lantern.

- [ ] **Step 6: Lint and commit.**

```powershell
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/equipment tests/test_builders_equipment.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/equipment tests/test_builders_equipment.py
git add backend/app/asset_models/builders/equipment/__init__.py backend/app/asset_models/builders/equipment/jetty.py backend/tests/test_builders_equipment.py backend/tests/data/plant/golden/equipment/loading_arm_iso.png backend/tests/data/plant/golden/equipment/crane_iso.png backend/tests/data/plant/golden/equipment/monitor_iso.png backend/tests/data/plant/golden/equipment/nav_aid_iso.png
git commit -m "feat(builders): loading_arm, crane, monitor and nav_aid" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Catalogue completeness, fallback, full gate, walkthrough

**Files:**
- Modify: `backend/tests/test_builders_equipment.py`

**Interfaces:**
- Consumes: `catalogue()`, `build_item`, everything above.
- Produces: none (tests and gate only).

- [ ] **Step 1: Write the final tests.** Change the harness import to `from app.asset_models.builders import REGISTRY, build_item, catalogue, load_all` and append:

```python
# ------------------------------------------------------------------ whole family
EQUIPMENT = {
    "tank_lng", "vessel_v", "vessel_h", "storage_tank_small", "pump", "pump_group", "compressor", "heater",
    "vaporizer_orv", "vaporizer_scv", "stack", "flare", "loading_arm", "crane", "monitor", "generator",
    "transformer", "package", "nav_aid",
}


def test_all_19_equipment_types_are_registered_and_have_cases():
    assert {t for t, d in REGISTRY.items() if d.family == "equipment"} == EQUIPMENT
    assert set(FIRST) == EQUIPMENT == set(COWORK)


def test_catalogue_publishes_the_equipment_family():
    rows = [r for r in catalogue() if r["family"] == "equipment"]
    assert {r["type"] for r in rows} == EQUIPMENT
    for r in rows:
        assert r["doc"] and r["default_height_m"] > 0 and r["params_schema"]["properties"]


@pytest.mark.parametrize(
    ("type_", "footprint", "h", "params"),
    [
        ("vessel_v", circle(6.0), 0.0, {}),  # top_el == base_el
        ("vessel_v", circle(6.0), 2.0, {}),  # too short for the heads
        ("pump", rect(2.0, 1.0), 1.5, {"plinth": float("nan")}),  # schema failure
        ("tank_lng", circle(93.5), 51.5, {"wall_t_m": 60.0}),  # wall thicker than the radius
        ("transformer", rect(10.0, 4.0), 4.0, {"bays": 0}),  # out of range
    ],
)
def test_unusable_input_falls_back(type_, footprint, h, params):  # Review Focus 3
    nodes, flags = build_item(make_item(type_, footprint, h=h, params=params), CTX)
    assert [f for f in flags if f.code == "builder_fallback"]
    assert nodes
```

If F0's `Item` validation itself rejects `top_el == base_el` (index: `top_el < base_el` is a validate() error, so equality should pass the schema), change that row to `h=0.01`. The builder still refuses it (`H <= 0.05`).

- [ ] **Step 2: Run the whole module.**
  Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_equipment.py -q`
  Expected: all pass (about 260 tests), with no golden missing.

- [ ] **Step 3: Run the full gate** from `E:\Dev\Yolo\app\.claude\worktrees\pm-b2`:

```powershell
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```

Expected: every command exits 0.
- B2 changes no contract or frontend file, so a failure in those steps is pre-existing on `main`. Report it with the command and the first error, and do not fix it here.
- `pnpm -C frontend e2e` runs on the unit's own free ports (`scripts\finish-task.ps1` picks them). On PowerShell 5.1, run the steps by hand as listed above.

- [ ] **Step 4: Commit.**

```powershell
git add backend/tests/test_builders_equipment.py
git commit -m "test(builders): equipment family completeness and fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Operator walkthrough** (put these lines in the hand-off report):
  1. In the B2 worktree, start the backend dev server (`cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8765`) and open `http://127.0.0.1:8765/api/v1/asset-models/catalogue`. There are 19 entries with `"family": "equipment"`, each with a doc, a default height and a params schema (for example `tank_lng` lists `roof_platforms`, `stair_tower_bearing_deg` and `risers_bearing_deg`).
  2. Open `backend/tests/data/plant/golden/equipment/` in Explorer and page through the PNGs. Each type should read as itself at a glance:
     - the LNG tank with its roof platforms, walkway, stair tower and risers;
     - vessels with heads, skirts and saddles;
     - pumps, the ORV panel rack and the derrick flare.
  3. The equipment shows up in a real plant GLB only once A1 (the assembler) and S1 (the Site 3D view) are merged. Until then, a plant spec with equipment items builds through A1's `other` fallback.

---

## Self-review (planner)

- **Spec coverage:**
  - §6 equipment list: 19 types in Tasks 4–11, checked by `test_all_19_equipment_types_are_registered_and_have_cases`.
  - The realism examples:
    - tank_lng (wall, dome, the six roof platforms incl. walking, stair tower, risers): Task 6;
    - vessel_h (shell, two heads, saddles) and vessel_v (shell, heads, skirt): Task 4;
    - loading_arm (riser, inner and outer arm, counterweight): Task 11.
  - Instancing: posts, rungs, treads, legs, panels, fins, bushings, firewalls, pump units, doors and louvres.
  - Fallback rule: Task 12.
  - §13 B-unit gates: bounds, triangle range, watertight where closed (kit primitives), instancing counts, defaults recorded, golden render.
  - Dispatch extras: determinism (`test_deterministic`), orientation (`test_vessel_h_orientation`, polygon OBB), Cowork realism floor (`test_realism_floor_vs_cowork`).
- **Placeholders:** none. Every code step carries the code. Tuning notes name the exact constant to change.
- **Type consistency:**
  - `k.Plan.is_round` is used by vessels, tanks and rotating;
  - `pump_unit(kind, driver, L, W, H, ctx, *, plinth)` is consistent between pump and pump_group;
  - `head_depth` is imported from `vessels` by `tanks` and `process`;
  - case IDs match golden filenames (`<cid>_<view>.png`).
