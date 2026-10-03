# Plant model B1: structure builders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 11 structure builders of spec §6 (`trestle`, `jetty_platform`, `dolphin`, `pipe_rack`, `pipe_sleeper`, `catwalk`, `walkway`, `stair_tower`, `overbridge`, `platform`, `gangway`), each a defaulted params model, an instanced mesh builder, a catalogue doc and a default height, at or above the detail of the Cowork Al-Zour model.

**Architecture:**
- Two B1-owned modules in F0's `backend/app/asset_models/builders/` package:
  - `structure_kit.py`: private helpers. Footprint runs and outlines in the item-local frame, grid and perimeter stations, uncapped members, instancing poses, handrails, pipes as instanced unit tubes. Every call into F0's `geom` and `BuildCtx.local` goes through it, so an F0 difference is fixed in one place.
  - `structure.py`: the 11 params models and builder functions, registered with F0's `@builder(..., family="structure")`.
- Builders are pure and deterministic: item-local metres (Y up from `base_el`, x = plant north, z = plant east, origin at `footprint_ref`). Repeated members (piles, columns, posts, treads, landings, sleepers, pipes) are `Instanced`.
- No route, job, table, contract or frontend change. A1's `asset_model_glb` job calls the builders through F0's `build_item`.

**Tech Stack:** Python 3.11, pydantic v2, numpy, trimesh, shapely, scipy (`cKDTree`), Pillow, pytest. **No new packages.**

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§6 builder catalogue, §7 triangle budget, §13 B1 gate tests, §15 amendments). Index: `docs/superpowers/plans/2026-10-03-plant-model.md` (Global Constraints and Binding interfaces are law).

## Unit

| | |
| --- | --- |
| Unit | **B1**: structure builders (11 types) |
| Worktree / branch | `.claude/worktrees/pm-b1` on `task/pm-b1` |
| Cut after | F0 merged to `main` |
| Batch / merge position | Batch 2. Builders merge in any order among B1, B2, B3, A1 (index DAG). A1's `other` fallback covers the types until B1 lands. |
| Migration / contract | None. `type` is a free string in the contract; the catalogue route publishes the live registry. |

## Interfaces consumed (F0, index "Binding interfaces")

```python
# app/asset_models/builders/base.py (F0)
@dataclass(frozen=True)
class Instanced:  mesh: trimesh.Trimesh; transforms: np.ndarray          # (N, 4, 4), item-local metres
@dataclass
class MeshNode:   name: str; material: str; geometry: trimesh.Trimesh | Instanced; extras: dict = field(default_factory=dict)
@dataclass(frozen=True)
class BuildCtx:
    grid: PlantGrid | None
    lod: float = 1.0
    def local(self, item: Item, e, n) -> np.ndarray   # plant [E,N] -> item-local [x, z] (x north, z east), origin = footprint_ref
    def height(self, item: Item, default_m: float) -> tuple[float, float, bool]   # (base_el, top_el, defaulted)
@dataclass(frozen=True)
class BuilderDef: type: str; family: str; params: type[BaseModel]; fn: Callable[[Item, BuildCtx], list[MeshNode]]; doc: str; default_height_m: float
def builder(type: str, *, family: str, params: type[BaseModel], doc: str, default_height_m: float) -> Callable
# app/asset_models/builders/__init__.py (F0)
REGISTRY: dict[str, BuilderDef]
def build_item(item: Item, ctx: BuildCtx) -> tuple[list[MeshNode], list[ItemFlag]]   # validates params, catches, falls back to "other"
def catalogue() -> list[dict]          # [{type, family, doc, default_height_m, params_schema}]
def load_all() -> None                 # imports builders.structure when present (ImportError-tolerant)
# app/asset_models/builders/geom.py (F0): only these three are used
def extrude(poly2d, h) -> trimesh.Trimesh          # B1 assumes: poly2d local [x, z], prism from y = 0 to y = h
def cyl(r, h, segments=None) -> trimesh.Trimesh    # B1 assumes: axis +Y, base at y = 0
def segments_for(r, chord_err=0.02) -> int
# app/asset_models/builders/palette.py (F0)
PALETTE: dict[str, tuple[tuple[float, float, float, float], float, float]]   # Cowork's 34 names
# app/asset_models/siteframe.py (F0)
def footprint_ref(fp: Footprint) -> tuple[float, float]
def footprint_polygon(fp: Footprint) -> np.ndarray     # (k, 2) plant [E, N]
# app/asset_models/spec.py (F0)
class Item(_Strict): id; tag; name; type; area; footprint: Footprint; base_el; top_el; levels: list[float]; params: dict; height_source; source; confidence; flags; parts; notes
class RectFootprint: kind="rect"; center; size=(along, across); rot_deg   # along axis at rot_deg clockwise from plant north
class CircleFootprint / PolygonFootprint / LineFootprint (pts, width); class ItemFlag
# app/asset_models/raster.py (M1, on main): render(meshes: dict[str, Trimesh], view: View, *, size) -> PIL.Image
```

Task 1 pins every assumption above with a test (`test_builders_structure_f0.py`) before any builder is written.

## Interfaces provided

- **Registry entries** (`family="structure"`), registered on import of `app.asset_models.builders.structure`:

  | type | params model | default_height_m | node names (first node carries `extras["defaults"]`) |
  | --- | --- | --- | --- |
  | `trestle` | `TrestleParams` | 11.0 | `deck`, `piles`, `headstocks`, `bracing`, `handrail_posts`, `handrail_rails`, `rack_sleepers`, `pipes_<mm>` / `pipes_ins_<mm>` |
  | `jetty_platform` | `JettyPlatformParams` | 11.0 | `deck`, `piles`, `handrail_posts`, `handrail_rails`, [`bollards`] |
  | `dolphin` | `DolphinParams` | 11.0 | `cap`, `piles`, `fender`, `bollards` |
  | `pipe_rack` | `PipeRackParams` (uses `RackLine`) | 6.0 | `columns`, `beams`, `bracing`, `pipes_*` |
  | `overbridge` | `OverbridgeParams` | 7.0 | `columns`, `beams`, `bracing`, `pipes_*` |
  | `pipe_sleeper` | `PipeSleeperParams` | 0.6 | `sleepers`, `pipes_*` |
  | `catwalk` | `CatwalkParams` | 1.5 | `deck`, `chords`, `verticals`, `diagonals`, `handrail_posts`, `handrail_rails` |
  | `walkway` | `WalkwayParams` | 0.3 | `deck`, [`bearers`], [`handrail_posts`, `handrail_rails`] |
  | `gangway` | `GangwayParams` | 6.0 | `tower_columns`, `tower_bracing`, `tower_platform`, `handrail_posts`, `handrail_rails`, `boom`, `treads`, `counterweight` |
  | `platform` | `PlatformParams` | 4.0 | `deck`, `columns`, `beams`, `bracing`, `stair`, `stair_treads`, `handrail_posts`, `handrail_rails` |
  | `stair_tower` | `StairTowerParams` | 12.0 | `base_slab`, `columns`, `landings`, `stringers`, `treads`, `handrail_posts`, `handrail_rails` |

- `nodes[0].extras["defaults"]: list[str]`: the sorted names of the params not given, then `"height"` when `ctx.height` defaulted. This is the same convention as B3's `record()`. A1 writes it to CSV `notes`.
- **Instanced transform convention:** `T · R · S`, with `S = diag(1, L, 1)` only for pipes (a unit tube scaled to its run length). A1's `trs()` already writes a per-instance `SCALE` accessor.
- Materials used: `Concrete`, `Concrete_Dark`, `Steel_Structure`, `Steel_Dark`, `Grating`, `Handrail`, `Pipe`, `Pipe_Insulated`. All are in F0's `PALETTE`.
- `structure_kit` is **B1-private**. B2 and B3 must not import it, because helpers stay per family (index).

## Budget

- **Background jobs:** none added. Builders run per item inside A1's `asset_model_glb` job, and inside R1's in-process build.
- **Bounded:**
  - one pure call per item: no I/O, no DB, no RNG;
  - triangles scale with footprint length. A 3 km, 60-leg polyline rack or trestle builds in < 5 s and stays under 200 000 triangles (`test_a_three_km_polyline_builds_quickly`);
  - point de-duplication uses a `cKDTree`, never an O(n²) Python loop;
  - the family estimate on Cowork's reference nodes is ≤ 1.2 × Cowork's structure total (181 316 → ≤ 217 579 triangles; `test_structure_family_stays_inside_the_triangle_budget`). That keeps headroom inside spec §7's plant-wide 1.5 ×.
- **Tests never read the 26 MB Cowork GLB.** They read a 8 KB stats fixture captured once (Task 1).

## Shared-file touches

**None.** B1 adds files only:
- `backend/app/asset_models/builders/structure.py` and `structure_kit.py`;
- three test files;
- one JSON fixture;
- 11 golden PNGs.

It does not edit `builders/__init__.py`, `base.py`, `geom.py`, `palette.py`, `fallback.py`, `spec.py`, `siteframe.py`, `raster.py`, the contract, migrations or the frontend. If `load_all()` does not import `builders.structure`, that is an F0 defect: log it as a ruling and hand it off (Task 1).

## Tests

| File | What | Count |
| --- | --- | --- |
| `backend/tests/test_builders_structure_f0.py` (new, T1) | pins the F0 behaviour B1 relies on | 9 |
| `backend/tests/test_builders_structure_kit.py` (new, T2) | kit: runs, outline, stations, members, poses, tubes, handrails, pipes, grid, perimeter, LOD | 19 |
| `backend/tests/test_builders_structure.py` (new, T3–T7) | per type: bounds, realism floor, determinism, rotation, default height, defaults recorded, LOD. Per family: instancing counts, levels, lines, line footprints, fallback, Cowork triangle ranges, family budget, golden renders | 148 |
| `backend/tests/data/plant/cowork_nodes/structure.json` (new, T1) | Cowork stats per type + 19 reference nodes | — |
| `backend/tests/data/plant/structure_golden/<type>.png` (new, T7) | 11 iso renders at 256 px | — |

## Realism targets (from the Cowork GLB)

The planner read `KIPIC_AlZour_LNG_Plant.glb` (909 nodes, 867 meshes, 34 materials, no instancing; `extras.type` gives the type):
- every Cowork structure node is one mesh with one primitive per material;
- boxes are 12 triangles; piles are 12-sided capped cylinders (48 triangles, Ø 1.1 m, down to seabed y = −14);
- pipes are 16-sided open tubes (32 triangles);
- handrail posts are 12-triangle boxes at about 2 m spacing, with a single top rail.

| type | Cowork count / triangles | Cowork sub-parts (materials: what) | Reference node(s), Cowork → B1 triangles | B1 sub-parts (realism floor) |
| --- | --- | --- | --- | --- |
| trestle | 7 / 15 152 | Concrete deck slab 1.2 m; Steel_Dark piles on a ≈ 7.5 × 7.9 m grid | `trestle-jetty1-c` 1 076 → 1 586; `trestle-shore` 5 664 → 8 286 | + headstocks, bent bracing, handrails both sides, rack band (sleepers + pipes) |
| jetty_platform | 8 / 7 588 | Concrete deck 1.8 m; pile grid clipped to outline | `jetty1-loading-platform` 1 524 → 1 500; `flare-platform` 780 → 716 | + perimeter handrail, optional bollards |
| dolphin | 24 / 11 232 | Concrete cap 1.8 m; 3×3 piles; fender panel box | `jetty1-md8` 456 → 272; `jetty2-bd3` 456 → 272 | + bollards; uncapped piles (caps hidden) |
| pipe_rack | 36 / 60 076 | columns 0.35, cross beams per tier, long beams; pipes 0.36–0.6 (bare + insulated) | `rack-loop-j2-1` 1 332 → 748; `rack-flare-ko-drum` 416 → 320 | + end-bay X bracing; instanced pipes |
| pipe_sleeper | 33 / 16 588 | Concrete sleepers 0.5 wide across the band; 3 pipe sizes | `sleeper-n-a-3` 492 → 302; `orv-hdr-KL` 304 → 146 | same, instanced |
| catwalk | 24 / 6 552 | a steel plate, grating, handrail posts + rails | `catwalk-jetty1-md8-md7` 348 → 988; `…-md1-trestle` 120 → 340 | + real side trusses (chords, verticals, diagonals), both handrails |
| walkway | 13 / 1 212 | grating panels (or one slab) | `20-t-0004-walking-platform` 144 → 124; `intake-walkway-e` 12 → 40 | + bearers, optional handrails |
| stair_tower | 12 / 1 664 | 4 columns, landing grating, concrete pad, rails (elevator shafts typed stair_tower too) | `ss03-emergency-exit-stair` 320 → 388 | + switchback flights, stringers, treads, landings per level |
| overbridge | 9 / 5 552 | 4 columns, cross and long beams, 8–12 pipes along the span | `overbridge-c` 528 → 324 | + knee braces |
| platform | 53 / 55 612 | grating deck 0.3, 4–8 columns, perimeter handrail | `70-P-0007B-V-01` 276 → 492; `jetty2-manifold-structure` 708 → 812 | + edge beams, bracing, stair flight |
| gangway | 2 / 88 | one tower box + one boom tube | `10-A-0004` 44 → 556 | + braced tower, platform, boom with treads and rails, counterweight |

**Gate targets** (Task 7): every reference node lands in `[0.35 ×, max(3 × , +600)]` of its Cowork triangles. The family estimate stays at ≤ 1.2 × Cowork (prototype: 1.07 ×). Every piles/columns centre stays inside the Cowork outline (notched polygons included).

## Global Constraints

Copied from the index. These apply to every task.
- **Builders:** "A builder never raises to the assembler: `build_item` catches and falls back to `other` with a `builder_fallback` flag." "Builders are pure: no DB, no I/O, deterministic for the same item."
- **Frames:** "Item-local frame: metres, Y up from `base_el`, x = plant north, z = plant east, origin at `footprint_ref`. Builders rotate by `rot_deg` themselves." "Spec item coordinates are **plant metres**: `[E, N]` in the drawing's plant grid, elevations as plant EL in metres." `RectFootprint.size = (along, across)`; "along axis at rot_deg clockwise from plant north".
- **Instancing:** "Repeated elements (piles, columns, posts, grating bars, rack pipes) are **instanced** (`EXT_mesh_gpu_instancing`)." "No meshopt compression in G1 … Instancing is the main size lever."
- **Family modules:** "`builders/structure.py` … Each family has a `tests/test_builders_<family>.py`." "Shared geometry helpers go in `builders/geom.py`. F0 creates it … Families may add helpers in their own module only."
- **Contract:** "F0 owns the contract. No other unit edits `openapi.yaml` except to fix a defect."
- **Git and shared machine:** "Stage files by path; never `git add -A`. Never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit identity is "Danijel Jovanovic" / info@synapse-solutions.ai." "Backend interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`." "**Never install anything into the shared venv.** No unit adds Python packages."
- **Gate before READY_TO_MERGE:** `pnpm -C contract check`, `ruff check .`, `ruff format --check .`, `pytest`, `pnpm -C frontend lint`, `pnpm -C frontend test`, `pnpm -C frontend build`, `pnpm -C frontend e2e` (on the unit's port range). `cargo test` runs only when the frozen sidecar exists. Full suites run only in the unit's final gate.

## Review Focus

The index's Review Focus names no B1 line (its five owners are R1, C1, S2, A1 and S1), so there is no index test to copy. These are the five B1 failure modes most likely to bite the operator. Each has its test in the owning task.
1. **A polyline with a repeated vertex, or a zero-length line** (an agent typo). Repeated vertices inside a longer line are skipped. A line with no length makes the builder raise `ValueError`; `build_item` then falls back to `other` with `builder_fallback`. The GLB still builds.
   - T2 `test_line_footprint_gives_one_run_per_segment_and_skips_zero_length`;
   - T4 `test_zero_length_line_raises_and_build_item_falls_back`.
2. **Params that are NaN, negative or misspelled** (`{"bay_spacing_m": NaN}`, `{"pile_d_m": -1}`, `{"bogus": 1}`). They fall back with a flag and never produce a half-built mesh. T3 `test_bad_params_fall_back`.
3. **Cowork-style irregular outlines** (the 25-vertex shore trestle, the notched loading platform, a 45° platform). Piles and columns land on a grid inside the outline, never in the notch. T7 `test_triangles_in_range_of_the_cowork_node` (centres inside the outline).
4. **A 3 km trestle or rack drawn as a 60-leg polyline.** It builds in under 5 s and under 200 000 triangles. The shared corner columns are not doubled. T4 `test_a_three_km_polyline_builds_quickly` and `test_line_footprint_follows_the_polyline`.
5. **No `top_el`** (the agent read no height). The type's default height is used and `"height"` is recorded in the defaults; there is never a zero-height mesh. T3 `test_missing_top_uses_the_default_height_and_says_so` (all 11 types).

## Rulings

- **R1, defaults recording.** The index says defaults are recorded but names no mechanism. B1 follows B3's convention (`2026-10-03-plant-model-b3.md` R1): `nodes[0].extras["defaults"]` is the sorted list of param names not given, plus `"height"` last when `ctx.height` defaulted. If F0's `build_item` already records defaults, T1 points `_stamp` at F0's key and keeps the test assertions.
- **R2, what `top_el` means per type.** `top_el` is the deck or walking level (trestle, jetty, dolphin cap, catwalk, walkway, platform, landing, gangway tower) or the top of steel of the highest tier (rack, overbridge, sleeper top).
  - These may stand above it: handrails (1.1 m), pipes resting on the top tier (≤ their diameter), fenders and bollards (≤ 0.8 m), the gangway counterweight (1.0 m).
  - `base_el` is the bottom of the model: the pile base for marine items (Cowork uses MSL EL 93.56), otherwise grade or the supporting deck.
  - Tests allow exactly these overshoots (`TypeSpec.pad_y`) and the plan overshoots of stairs, fenders and base slabs (`pad_xz`).
- **R3, `levels`.** `levels` are plant EL. Values outside `(base_el, top_el]` are ignored; Cowork's rack loop has a level below its base.
  - trestle and jetty: deck top = highest level;
  - rack and overbridge: tier tops of steel;
  - platform: one deck per level;
  - stair tower: landings.
- **R4, footprint to runs.**
  - A `line` gives one run per segment; segments under 1 cm are skipped.
  - A `rect` gives one run along its **longer** side. Cowork's `orv-hdr-KL` sleeper is 5.8 N × 15.5 E, and its pipes run east.
  - A `polygon` or `circle` gives one run along the long side of its minimum rotated rectangle.
  - Decks and caps always use the exact outline.
  - Piles and columns use a grid on the run's axes, kept inside the outline shrunk by half the inset. Many-sided outlines and circles also get perimeter columns.
- **R5, rack side.** `+v` is the right-hand side walking from the line's first point to its last. Walking north, right is east (`+z`). Tier index 0 is the lowest tier.
- **R6, instanced pipes are scaled.** A pipe instance is a unit tube with `S = diag(1, L, 1)`. glTF instancing carries per-instance scale, and A1's `trs()` decomposes it. One node is made per (diameter, insulated).
- **R7, members are B1's own.** `geom.beam`'s cross-section orientation is not specified in the index. So B1 builds its own uncapped 8-triangle member: `w` is level across, `h` is in the vertical plane. A member therefore turns with the item, which the rotation test needs.
  - Vertical members (columns, posts) are instanced with a rotation about Y that faces the run.
  - `geom.box`, `geom.beam`, `geom.ring_polyline` and `geom.instanced_cyl` are not used. `geom.extrude`, `geom.cyl` and `geom.segments_for` are used through the kit.
- **R8, end caps.** Piles and members drop their end caps: they sit under decks or butt into other members. Pipes are open tubes. This keeps the family at about 1.07 × Cowork while adding bracing, handrails and trusses.
- **R9, inclined members start 0.15 m above their base** (`FOOT`), so their section never dips below `base_el`. The bounds test checks `y ≥ 0`.
- **R10, realism floor.** It is defined three ways:
  - each type's required sub-part node names (Cowork's sub-parts plus spec §6's examples);
  - the per-node triangle range;
  - the family budget.

  A ratio-to-Cowork floor alone would fail tiny Cowork items (the gangway is 44 triangles) while proving nothing about sub-parts.
- **R11, golden renders.** These are the M1 rasterizer's iso renders at 256 px, compared as in `test_asset_model_raster.py` (under 1 % of pixels differ by more than 40). They depend on F0's `geom` output, so T7 generates them on the real F0 code (`KESTREL_REGEN_GOLDEN=1`). The implementer reviews them by eye against a checklist, then commits them.
- **R12, the zero-length check lives in the builder.** The kit raises `ValueError` on a line with no length and on an outline with no area. F0's `build_item` turns that into the fallback (Review Focus 4 of the index, builder side).

## Deviations

- Spec §6 says `BuildCtx` "gives the plant → scene transform, the palette, the level of detail and a triangle budget". The index `BuildCtx` has `grid` and `lod` only, so B1 uses those. Materials are palette names. `lod` scales segment counts (floor 8) and handrail post spacing.
- Spec §13 asks for reference **meshes** from the Cowork GLB at `backend/tests/data/plant/cowork_nodes/`. B1 stores per-type **stats** there instead (`structure.json`: counts, triangles, per-material sub-parts, footprints of 19 reference nodes). Its golden renders are of B1's own builds. Reason: the 26 MB GLB is git-ignored and absent in a fresh worktree, and stats plus footprints are what the gate checks.
- Spec §13 asks for "a watertight check where the shape is closed". The closed parts (decks, caps, slabs from `geom.extrude`) are pinned by `test_geom_extrude_takes_local_xz_and_rises_in_y`. Members, tubes and handrails are open by design (R8).

## Execution DAG

```
T1 align with F0 + Cowork fixture ─ T2 kit ─ T3 piled decks ─ T4 racks ─ T5 access ─ T6 platforms ─ T7 realism + goldens ─ T8 gate
```

- **Independent units:** T4, T5 and T6 are logically independent; each adds one family section. They all append to `structure.py` and the test file, and the expected test counts are cumulative. So they run **serially** in this order: no parallel batch, and the critical path is T1 → T8.
- Each task is one subagent and one reviewer.

---
### Task 1: Align with merged F0 and capture the Cowork reference

**Files:**
- Create: `backend/tests/test_builders_structure_f0.py`
- Create: `backend/tests/data/plant/cowork_nodes/structure.json`

**Interfaces:**
- Consumes: everything in "Interfaces consumed" (F0 on `main`).
- Produces: a green F0 pin file; `structure.json` (keys `source`, `per_type{type: {count, triangles}}`, `nodes[{node, type, footprint, base_el, top_el, levels, triangles, parts}]`) used by Task 7.

- [ ] **Step 1: Confirm the worktree and that F0 is merged**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git rev-parse --abbrev-ref HEAD
Test-Path backend\app\asset_models\builders\base.py, backend\app\asset_models\builders\geom.py, backend\app\asset_models\builders\palette.py, backend\app\asset_models\siteframe.py
```
Expected: `task/pm-b1`, then `True` four times. If a file is missing, F0 has not merged. Stop and report `BLOCKED: F0`.

- [ ] **Step 2: Read F0's real code and check each assumption**

Read `backend/app/asset_models/builders/__init__.py`, `base.py`, `geom.py`, `palette.py`, `fallback.py`, `backend/app/asset_models/siteframe.py` (`footprint_ref`, `footprint_polygon`) and the `Item` / footprint classes in `backend/app/asset_models/spec.py`. Check each row of this table. Every later task's code assumes the left column. **Keep the assertions.** Change only the place named on the right.

| # | B1 assumes | If F0 differs |
| --- | --- | --- |
| 1 | `BuildCtx`, `Instanced`, `MeshNode`, `builder`, `BuilderDef` import from `app.asset_models.builders.base`; `REGISTRY`, `build_item`, `catalogue`, `load_all`, `geom` from `app.asset_models.builders` | Change the import lines in `structure_kit.py`, `structure.py` and the three test files. The names stay. |
| 2 | `load_all()` imports `app.asset_models.builders.structure` | F0 defect: log it under Rulings in the ledger and hand it off. Meanwhile add `import app.asset_models.builders.structure  # noqa: F401` after `load_all()` in the test files. Do **not** edit `__init__.py`. |
| 3 | `geom.cyl(r, h, segments)`: axis +Y, base at y = 0 | Adapt `structure_kit.pile_mesh` only (translate or rotate the result). |
| 4 | `geom.extrude(poly2d, h)`: `poly2d` is local `[x, z]`, the prism spans y 0..h | Adapt `structure_kit.slab` only (swap columns, or rotate the result). |
| 5 | `geom.segments_for(r)` grows with r | Adapt `structure_kit.segs` only. |
| 6 | `BuildCtx.local(item, e_array, n_array)` returns shape `(k, 2)` = `[N − N_ref, E − E_ref]` | Adapt `structure_kit.local_pts` only. For example, if it returns a tuple `(x, z)`, use `np.stack(ctx.local(...), axis=-1)`. |
| 7 | `BuildCtx.height(item, d)` returns `(base, base + d, True)` when `top_el` is None and `(base, top, False)` otherwise | Builders only use the triple. Adjust the literals in `test_ctx_height_returns_base_top_and_whether_it_defaulted` to F0's documented behaviour. |
| 8 | A rect at `rot_deg = 90` runs east (index: clockwise from north) | F0 defect (the index fixes it): hand it off. |
| 9 | `PALETTE` has the 8 structure materials | F0 defect: hand it off. |
| 10 | `build_item` turns a raising builder into non-empty nodes plus `builder_fallback` | F0 defect: hand it off. |
| 11 | `Item` requires `source` and has `levels`, `params`, `base_el`, `top_el` | Adapt the `item()` helpers in the test files. |
| 12 | F0 does not record defaults itself (`grep -n defaults backend/app/asset_models/builders/base.py`) | If it does, make `_stamp` (Task 3) write F0's key. Keep the tests reading `extras["defaults"]`. |

Write each difference you find into the unit ledger (`.superpowers/sdd/pm-b1/ledger.md`, section "F0 alignment"), with the adaptation you will make in Tasks 2–7.

- [ ] **Step 3: Write the F0 pin tests**

`backend/tests/test_builders_structure_f0.py`:
```python
"""What the structure family (B1) relies on from F0. If one of these fails after F0 changes, fix the
adapter in builders/structure_kit.py (local_pts, slab, pile_mesh, segs), not the builders."""

from __future__ import annotations

import numpy as np
import pytest
import trimesh
from pydantic import BaseModel

from app.asset_models.builders import REGISTRY, build_item, geom
from app.asset_models.builders.base import BuildCtx, BuilderDef, Instanced, MeshNode
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon, footprint_ref
from app.asset_models.spec import Item

CTX = BuildCtx(grid=None)
STRUCTURE_MATERIALS = {
    "Concrete", "Concrete_Dark", "Steel_Structure", "Steel_Dark",
    "Grating", "Handrail", "Pipe", "Pipe_Insulated",
}  # fmt: skip


def item(fp, base=100.0, top=None) -> Item:
    return Item.model_validate(
        {"id": "f0", "name": "f0", "type": "other", "footprint": fp, "base_el": base, "top_el": top,
         "source": {"kind": "assumed"}}
    )  # fmt: skip


def test_geom_cyl_stands_on_the_origin_along_y():
    m = geom.cyl(0.5, 3.0, 12)
    assert m.bounds[0][1] == pytest.approx(0) and m.bounds[1][1] == pytest.approx(3)
    assert np.allclose(m.bounds[:, [0, 2]], [[-0.5, -0.5], [0.5, 0.5]], atol=0.02)


def test_geom_extrude_takes_local_xz_and_rises_in_y():
    m = geom.extrude(np.array([[0.0, 0.0], [4.0, 0.0], [4.0, 2.0], [0.0, 2.0]]), 1.5)
    assert np.allclose(m.bounds, [[0, 0, 0], [4, 1.5, 2]])
    assert m.is_watertight


def test_geom_segments_for_grows_with_radius():
    assert geom.segments_for(0.05) <= geom.segments_for(0.55) <= geom.segments_for(5.0)


def test_ctx_local_is_north_then_east_from_the_footprint_ref():
    it = item({"kind": "rect", "center": [100.0, 200.0], "size": [4, 2], "rot_deg": 0})
    assert footprint_ref(it.footprint) == pytest.approx((100.0, 200.0))
    loc = np.asarray(CTX.local(it, np.array([100.0, 101.0, 99.0]), np.array([200.0, 203.0, 198.0])))
    assert loc.shape == (3, 2)
    assert np.allclose(loc, [[0, 0], [3, 1], [-2, -1]])  # [x = N - 200, z = E - 100]


def test_ctx_height_returns_base_top_and_whether_it_defaulted():
    assert CTX.height(item({"kind": "circle", "center": [0, 0], "d": 2}, 100.0, None), 6.0) == (
        100.0,
        106.0,
        True,
    )
    assert CTX.height(item({"kind": "circle", "center": [0, 0], "d": 2}, 100.0, 104.0), 6.0) == (
        100.0,
        104.0,
        False,
    )


def test_rect_footprint_turns_clockwise_from_north():
    it = item({"kind": "rect", "center": [0.0, 0.0], "size": [10.0, 2.0], "rot_deg": 90.0})
    ring = np.asarray(footprint_polygon(it.footprint))
    assert np.ptp(ring[:, 0]) == pytest.approx(10.0)  # along runs east at 90 deg
    assert np.ptp(ring[:, 1]) == pytest.approx(2.0)


def test_palette_has_the_structure_materials():
    assert STRUCTURE_MATERIALS <= set(PALETTE)


def test_meshnode_and_instanced_shapes():
    box = trimesh.creation.box((1, 1, 1))
    n = MeshNode("x", "Concrete", Instanced(box, np.tile(np.eye(4), (2, 1, 1))))
    assert n.extras == {} and n.geometry.transforms.shape == (2, 4, 4)


def test_build_item_turns_a_raising_builder_into_a_flagged_fallback(monkeypatch):
    class NoParams(BaseModel):
        pass

    def boom(item, ctx):
        raise ValueError("broken")

    monkeypatch.setitem(
        REGISTRY,
        "b1_probe",
        BuilderDef(
            type="b1_probe", family="structure", params=NoParams, fn=boom, doc="probe", default_height_m=1.0
        ),
    )
    it = item({"kind": "rect", "center": [0, 0], "size": [2, 2], "rot_deg": 0}, 100.0, 101.0)
    nodes, flags = build_item(it.model_copy(update={"type": "b1_probe"}), CTX)
    assert nodes and [f.code for f in flags] == ["builder_fallback"]
```

- [ ] **Step 4: Run them**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure_f0.py -q
```
Expected: `9 passed`. On a failure, apply the Step 2 table: either the adaptation in a later task, or a ruling plus a hand-off. Do not weaken an assertion.

- [ ] **Step 5: Write the Cowork reference fixture**

The planner extracted these from `E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic\KIPIC_AlZour_LNG_Plant.glb`:
- `per_type`: node count and summed triangles of every node whose `extras.type` is a structure type;
- `nodes`: 19 reference nodes, with their footprint converted to the index's `Footprint` shapes (Cowork `rect` `E0,N0,E1,N1` → `rect` centre and size `(N extent, E extent)`; `obb` `E,N,L,W,rot` → `rect` with `size (L, W)` and `rot_deg = rot`; `poly` → `polygon`; `line` → `line`), plus triangles and per-material sub-parts.

Write it byte for byte:

`backend/tests/data/plant/cowork_nodes/structure.json`:

```json
{
  "source": "KIPIC_AlZour_LNG_Plant.glb (Cowork artifact 'Al-Zour LNG Plant Model'), read 2026-10-03; extras.type selects the type",
  "per_type": {
    "trestle": {"count": 7, "triangles": 15152},
    "jetty_platform": {"count": 8, "triangles": 7588},
    "dolphin": {"count": 24, "triangles": 11232},
    "pipe_rack": {"count": 36, "triangles": 60076},
    "pipe_sleeper": {"count": 33, "triangles": 16588},
    "catwalk": {"count": 24, "triangles": 6552},
    "walkway": {"count": 13, "triangles": 1212},
    "stair_tower": {"count": 12, "triangles": 1664},
    "overbridge": {"count": 9, "triangles": 5552},
    "platform": {"count": 53, "triangles": 55612},
    "gangway": {"count": 2, "triangles": 88}
  },
  "nodes": [
    {"node": "trestle-jetty1-c", "type": "trestle", "footprint": {"kind": "polygon", "pts": [[2355.91, 771.43], [2353.6, 793.24], [2341.67, 792.0], [2339.05, 816.85], [2364.42, 819.51], [2369.31, 772.83]]}, "base_el": 93.56, "top_el": 104.5, "levels": [104.5], "triangles": 1076, "parts": {"Concrete": {"triangles": 20, "components": 1}, "Steel_Dark": {"triangles": 1056, "components": 22}}},
    {"node": "trestle-shore", "type": "trestle", "footprint": {"kind": "polygon", "pts": [[1923.0, 482.0], [1926.68, 481.04], [2053.3, 494.32], [2197.49, 509.48], [2316.94, 522.02], [2361.6, 526.72], [2362.24, 520.68], [2363.01, 513.29], [2318.3, 508.6], [2273.56, 503.91], [2274.81, 491.98], [2236.0, 487.89], [2234.76, 499.82], [2198.97, 496.06], [2127.36, 488.53], [2128.61, 476.59], [2103.75, 474.0], [2102.5, 485.93], [2054.75, 480.91], [1983.14, 473.39], [1984.39, 461.46], [1959.53, 458.84], [1958.29, 470.77], [1924.12, 467.19], [1923.0, 467.07]]}, "base_el": 93.56, "top_el": 104.5, "levels": [104.5], "triangles": 5664, "parts": {"Concrete": {"triangles": 96, "components": 1}, "Steel_Dark": {"triangles": 5568, "components": 116}}},
    {"node": "jetty1-loading-platform", "type": "jetty_platform", "footprint": {"kind": "polygon", "pts": [[2384.54, 818.01], [2380.38, 857.39], [2386.78, 858.06], [2386.01, 865.45], [2389.79, 865.86], [2390.01, 863.85], [2402.14, 865.13], [2402.65, 860.33], [2410.77, 861.19], [2414.96, 821.2]]}, "base_el": 93.56, "top_el": 104.5, "levels": [104.5], "triangles": 1524, "parts": {"Concrete": {"triangles": 36, "components": 1}, "Steel_Dark": {"triangles": 1488, "components": 31}}},
    {"node": "flare-platform", "type": "jetty_platform", "footprint": {"kind": "polygon", "pts": [[1973.23, 343.03], [1989.48, 359.29], [2005.73, 343.03], [1989.48, 326.78]]}, "base_el": 93.56, "top_el": 104.5, "levels": [104.5], "triangles": 780, "parts": {"Concrete": {"triangles": 12, "components": 1}, "Steel_Dark": {"triangles": 768, "components": 16}}},
    {"node": "jetty1-md8", "type": "dolphin", "footprint": {"kind": "rect", "center": [2353.33, 1054.65], "size": [6.02, 7.03], "rot_deg": 6.0}, "base_el": 93.56, "top_el": 104.5, "levels": [104.5], "triangles": 456, "parts": {"Concrete": {"triangles": 12, "components": 1}, "Steel_Dark": {"triangles": 444, "components": 10}}},
    {"node": "jetty2-bd3", "type": "dolphin", "footprint": {"kind": "rect", "center": [2466.5, 299.45], "size": [8.78, 7.01], "rot_deg": 6.0}, "base_el": 93.56, "top_el": 104.5, "levels": [104.5], "triangles": 456, "parts": {"Concrete": {"triangles": 12, "components": 1}, "Steel_Dark": {"triangles": 444, "components": 10}}},
    {"node": "rack-loop-j2-1", "type": "pipe_rack", "footprint": {"kind": "polygon", "pts": [[2379.13, 435.55], [2381.73, 410.69], [2393.66, 411.94], [2391.07, 436.83]]}, "base_el": 104.5, "top_el": 106.5, "levels": [105.5, 103.0], "triangles": 1332, "parts": {"Steel_Structure": {"triangles": 372, "components": 31}, "Pipe_Insulated": {"triangles": 320, "components": 10}, "Pipe": {"triangles": 640, "components": 20}}},
    {"node": "rack-flare-ko-drum", "type": "pipe_rack", "footprint": {"kind": "line", "pts": [[1893.0, 460.0], [1893.0, 436.5]], "width": 2.8}, "base_el": 100.0, "top_el": 106.0, "levels": [], "triangles": 416, "parts": {"Steel_Structure": {"triangles": 288, "components": 24}, "Pipe_Insulated": {"triangles": 32, "components": 1}, "Pipe": {"triangles": 96, "components": 3}}},
    {"node": "sleeper-n-a-3", "type": "pipe_sleeper", "footprint": {"kind": "line", "pts": [[1153.7, 674.45], [1203.0, 674.45]], "width": 9.5}, "base_el": 100.0, "top_el": 100.6, "levels": [], "triangles": 492, "parts": {"Concrete": {"triangles": 108, "components": 9}, "Pipe": {"triangles": 384, "components": 12}}},
    {"node": "orv-hdr-KL", "type": "pipe_sleeper", "footprint": {"kind": "rect", "center": [1044.75, 572.41], "size": [5.8, 15.5], "rot_deg": 0}, "base_el": 100.0, "top_el": 103.0, "levels": [], "triangles": 304, "parts": {"Concrete": {"triangles": 48, "components": 4}, "Pipe": {"triangles": 256, "components": 8}}},
    {"node": "catwalk-jetty1-md8-md7", "type": "catwalk", "footprint": {"kind": "line", "pts": [[2351.74, 1052.64], [2356.93, 1003.56]], "width": 1.6}, "base_el": 103.0, "top_el": 104.5, "levels": [], "triangles": 348, "parts": {"Steel_Structure": {"triangles": 12, "components": 1}, "Grating": {"triangles": 12, "components": 1}, "Handrail": {"triangles": 324, "components": 27}}},
    {"node": "catwalk-jetty1-md1-trestle", "type": "catwalk", "footprint": {"kind": "line", "pts": [[2386.76, 607.8], [2397.95, 609.0]], "width": 1.4}, "base_el": 103.0, "top_el": 104.5, "levels": [], "triangles": 120, "parts": {"Steel_Structure": {"triangles": 12, "components": 1}, "Grating": {"triangles": 12, "components": 1}, "Handrail": {"triangles": 96, "components": 8}}},
    {"node": "20-t-0004-walking-platform", "type": "walkway", "footprint": {"kind": "rect", "center": [1731.4, 561.4], "size": [53.1, 6.6], "rot_deg": -45.0}, "base_el": 100.0, "top_el": 102.0, "levels": [], "triangles": 144, "parts": {"Grating": {"triangles": 144, "components": 12}}},
    {"node": "intake-walkway-e", "type": "walkway", "footprint": {"kind": "rect", "center": [969.25, 564.55], "size": [1.9, 6.5], "rot_deg": 0}, "base_el": 100.0, "top_el": 100.3, "levels": [], "triangles": 12, "parts": {"Equipment_Grey": {"triangles": 12, "components": 1}}},
    {"node": "ss03-emergency-exit-stair", "type": "stair_tower", "footprint": {"kind": "rect", "center": [2266.9, 537.9], "size": [6.5, 2.3], "rot_deg": 6.0}, "base_el": 101.5, "top_el": 104.5, "levels": [], "triangles": 320, "parts": {"Concrete": {"triangles": 12, "components": 1}, "Steel_Structure": {"triangles": 48, "components": 4}, "Grating": {"triangles": 20, "components": 1}, "Handrail": {"triangles": 240, "components": 108}}},
    {"node": "overbridge-c", "type": "overbridge", "footprint": {"kind": "rect", "center": [1602.95, 488.8], "size": [5.6, 8.7], "rot_deg": 0}, "base_el": 100.0, "top_el": 107.0, "levels": [], "triangles": 528, "parts": {"Steel_Structure": {"triangles": 144, "components": 12}, "Pipe_Insulated": {"triangles": 128, "components": 4}, "Pipe": {"triangles": 256, "components": 8}}},
    {"node": "70-P-0007B-V-01", "type": "platform", "footprint": {"kind": "rect", "center": [871.65, 505.55], "size": [3.7, 4.1], "rot_deg": 0}, "base_el": 100.0, "top_el": 104.0, "levels": [], "triangles": 276, "parts": {"Grating": {"triangles": 12, "components": 1}, "Steel_Structure": {"triangles": 48, "components": 4}, "Handrail": {"triangles": 216, "components": 106}}},
    {"node": "jetty2-manifold-structure", "type": "platform", "footprint": {"kind": "polygon", "pts": [[2447.24, 283.36], [2466.15, 285.35], [2468.23, 265.45], [2449.36, 263.47]]}, "base_el": 104.5, "top_el": 108.5, "levels": [], "triangles": 708, "parts": {"Grating": {"triangles": 12, "components": 1}, "Steel_Structure": {"triangles": 96, "components": 8}, "Handrail": {"triangles": 600, "components": 138}}},
    {"node": "10-A-0004", "type": "gangway", "footprint": {"kind": "rect", "center": [2408.3, 810.4], "size": [11.5, 2.6], "rot_deg": 96.0}, "base_el": 104.5, "top_el": 110.5, "levels": [], "triangles": 44, "parts": {"Steel_Structure": {"triangles": 12, "components": 1}, "Handrail": {"triangles": 32, "components": 1}}}
  ]
}
```

- [ ] **Step 6: Lint and commit**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format tests/test_builders_structure_f0.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check tests/test_builders_structure_f0.py
```
Expected: the format step reports `1 file left unchanged` or reformats it; then `All checks passed!`.

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git check-ignore -v backend/tests/data/plant/cowork_nodes/structure.json   # must print nothing
git add backend/tests/test_builders_structure_f0.py
git add backend/tests/data/plant/cowork_nodes/structure.json
git commit -m "test(builders): pin the F0 builder interfaces B1 relies on; Cowork structure reference" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
If `git check-ignore` prints a rule, a `.gitignore` line (for example K1's rule for the Cowork GLB) is too wide. Do not force-add. Report it, so the rule's owner narrows it to `*.glb`.

---

### Task 2: Structure kit (footprint runs, members, handrails, pipes)

**Files:**
- Create: `backend/app/asset_models/builders/structure_kit.py`
- Test: `backend/tests/test_builders_structure_kit.py`

**Interfaces:**
- Consumes: `geom.extrude`, `geom.cyl`, `geom.segments_for`, `BuildCtx.local`, `footprint_polygon`, `Instanced`, `MeshNode` (Task 1 pinned all of them).
- Produces, used by Tasks 3–7 as `from app.asset_models.builders import structure_kit as k`:
  ```python
  UP: np.ndarray; MIN_SEG: int = 8
  @dataclass(frozen=True)
  class Run: p0: np.ndarray; p1: np.ndarray; width: float   # .length, .u (unit along), .v (unit right), .at(t, s=0.0) -> local [x, z]
  def segs(r: float, ctx: BuildCtx) -> int
  def local_pts(item: Item, ctx: BuildCtx, pts) -> np.ndarray            # (k, 2) plant [E, N] -> local [x, z]
  def outline(item: Item, ctx: BuildCtx) -> np.ndarray                   # CCW local ring (k, 2); ValueError when no area
  def runs(item: Item, ctx: BuildCtx) -> list[Run]                       # ValueError when a line has no length
  def rect_run(ring: np.ndarray) -> Run
  def stations(length: float, spacing: float, inset: float = 0.0) -> np.ndarray
  def dedupe_index(pts: np.ndarray, tol: float) -> list[int]; def dedupe(pts, tol) -> np.ndarray
  def xz(p2, y: float) -> np.ndarray; def translate(points3) -> np.ndarray; def posed(points3, u) -> np.ndarray   # (N, 4, 4)
  def along(p0, p1) -> np.ndarray                                        # unit +Y mesh onto p0 -> p1 (scale on Y)
  def uncap(m, axis) -> trimesh.Trimesh; def member(p0, p1, w, h=None) -> trimesh.Trimesh   # 8 triangles
  def pile_mesh(r, h, ctx) -> trimesh.Trimesh; def column_mesh(h, w) -> trimesh.Trimesh
  def merge(meshes) -> trimesh.Trimesh; def slab(ring, y0, y1) -> trimesh.Trimesh; def tube(r, seg) -> trimesh.Trimesh
  def handrail(path, y, *, height, spacing, closed, lod) -> list[MeshNode]   # ["handrail_posts" (Instanced)?, "handrail_rails"]
  def pipe_nodes(lines: list[tuple[float, bool, np.ndarray, np.ndarray]], ctx) -> list[MeshNode]   # "pipes_<mm>" / "pipes_ins_<mm>"
  def triangles(nodes: list[MeshNode]) -> int                           # instances counted
  def block(size) -> trimesh.Trimesh; def placed_block(center3, size, u) -> trimesh.Trimesh
  def grid_rows(ring, run, along_sp, across_sp, inset) -> list[np.ndarray]
  def perimeter_points(ring, spacing, inset) -> np.ndarray
  ```

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_builders_structure_kit.py`:
```python
"""Structure kit (B1): footprint runs, members, handrails, pipes."""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.asset_models.builders import structure_kit as k
from app.asset_models.builders.base import BuildCtx, Instanced
from app.asset_models.spec import Item

CTX = BuildCtx(grid=None)


def item(fp) -> Item:
    return Item.model_validate(
        {"id": "k", "name": "k", "type": "other", "footprint": fp, "source": {"kind": "assumed"}}
    )


def test_line_footprint_gives_one_run_per_segment_and_skips_zero_length():
    it = item({"kind": "line", "pts": [[0, 0], [0, 10], [0, 10], [10, 10]], "width": 4})
    rs = k.runs(it, CTX)
    assert [round(r.length, 6) for r in rs] == [10.0, 10.0]
    assert all(r.width == 4 for r in rs)
    assert np.allclose(rs[0].u, [1, 0])  # first leg runs north = local +x
    assert np.allclose(rs[1].u, [0, 1])  # second leg runs east = local +z


def test_zero_length_line_raises():
    with pytest.raises(ValueError, match="no length"):
        k.runs(item({"kind": "line", "pts": [[3, 3], [3, 3]], "width": 2}), CTX)


@pytest.mark.parametrize(
    ("size", "rot", "u"), [((10, 2), 0, (1, 0)), ((10, 2), 90, (0, 1)), ((2, 10), 0, (0, 1))]
)
def test_rect_run_follows_the_longer_side_clockwise_from_north(size, rot, u):
    (r,) = k.runs(item({"kind": "rect", "center": [5, 5], "size": list(size), "rot_deg": rot}), CTX)
    assert r.length == pytest.approx(10) and r.width == pytest.approx(2)
    assert np.allclose(np.abs(r.u), np.abs(u), atol=1e-9)
    assert np.allclose((r.p0 + r.p1) / 2, [0, 0], atol=1e-9)  # centred on the footprint ref


def test_polygon_run_is_its_minimum_rectangle_long_axis():
    it = item({"kind": "polygon", "pts": [[0, 0], [4, 0], [4, 20], [0, 20]]})
    (r,) = k.runs(it, CTX)
    assert r.length == pytest.approx(20) and r.width == pytest.approx(4)
    assert abs(r.u[0]) == pytest.approx(1)  # along north


def test_outline_is_counter_clockwise_and_rejects_no_area():
    ring = k.outline(item({"kind": "rect", "center": [0, 0], "size": [4, 2], "rot_deg": 0}), CTX)
    x, z = ring[:, 0], ring[:, 1]
    assert 0.5 * np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z) > 0
    with pytest.raises(ValueError):
        k.outline(item({"kind": "polygon", "pts": [[0, 0], [1, 1], [2, 2]]}), CTX)


def test_stations_never_exceed_the_spacing():
    s = k.stations(30.0, 6.0)
    assert s[0] == 0 and s[-1] == 30 and len(s) == 6
    assert np.diff(s).max() <= 6.0 + 1e-9
    assert len(k.stations(1.0, 6.0)) == 2
    s = k.stations(30.0, 6.0, inset=1.0)
    assert s[0] == 1 and s[-1] == 29


def test_member_is_8_triangles_level_across_and_deep_in_the_vertical_plane():
    m = k.member((0, 1, 0), (10, 1, 0), 0.2, 0.6)
    assert len(m.faces) == 8
    ext = m.extents
    assert ext[0] == pytest.approx(10) and ext[1] == pytest.approx(0.6) and ext[2] == pytest.approx(0.2)
    centre = m.vertices.mean(axis=0)
    assert (np.einsum("ij,ij->i", m.face_normals, m.triangles_center - centre) > 0).all()  # outward


def test_column_mesh_stands_on_the_origin():
    m = k.column_mesh(4.0, 0.3)
    assert m.bounds[0][1] == pytest.approx(0) and m.bounds[1][1] == pytest.approx(4)
    assert m.extents[0] == pytest.approx(0.3) and m.extents[2] == pytest.approx(0.3)


def test_posed_points_local_x_along_u():
    u = np.array([0.6, 0.8])
    xf = k.posed(np.array([[1.0, 2.0, 3.0]]), u)[0]
    assert np.allclose(xf[:3, :3] @ [1, 0, 0], [0.6, 0, 0.8])
    assert np.allclose(xf[:3, 3], [1, 2, 3])
    assert np.linalg.det(xf[:3, :3]) == pytest.approx(1)


def test_along_maps_the_unit_tube_onto_the_segment():
    t = k.tube(0.2, 8)
    assert len(t.faces) == 16
    xf = k.along(np.array([0.0, 1.0, 0.0]), np.array([0.0, 1.0, 12.0]))
    m = t.copy()
    m.apply_transform(xf)
    assert m.bounds[0][2] == pytest.approx(0) and m.bounds[1][2] == pytest.approx(12)
    assert m.extents[0] == pytest.approx(0.4, abs=1e-6)


def test_handrail_posts_are_instanced_at_the_spacing():
    nodes = k.handrail(
        np.array([[0.0, 0.0], [10.0, 0.0]]), 2.0, height=1.1, spacing=2.5, closed=False, lod=1.0
    )
    posts, rails = nodes
    assert posts.name == "handrail_posts" and isinstance(posts.geometry, Instanced)
    assert len(posts.geometry.transforms) == 5
    assert np.allclose(posts.geometry.transforms[:, 1, 3], 2.0)
    assert rails.name == "handrail_rails" and len(rails.geometry.faces) == 16  # top + knee rail


def test_closed_handrail_does_not_double_corner_posts():
    sq = np.array([[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]])
    posts = k.handrail(sq, 0.0, height=1.1, spacing=2.0, closed=True, lod=1.0)[0]
    assert len(posts.geometry.transforms) == 8


def test_pipe_nodes_group_by_diameter_and_insulation():
    a, b = np.zeros(3), np.array([10.0, 0, 0])
    nodes = k.pipe_nodes([(0.3, False, a, b), (0.3, False, a + 1, b + 1), (0.6, True, a, b)], CTX)
    assert [(n.name, n.material, len(n.geometry.transforms)) for n in nodes] == [
        ("pipes_300", "Pipe", 2),
        ("pipes_ins_600", "Pipe_Insulated", 1),
    ]


def test_grid_rows_stay_inside_and_keep_edge_rows():
    ring = np.array([[0.0, 0.0], [20.0, 0.0], [20.0, 8.0], [0.0, 8.0]])
    run = k.rect_run(ring)
    rows = k.grid_rows(ring, run, 7.5, 7.5, 0.6)
    pts = np.vstack(rows)
    assert len(rows) == 4 and all(len(r) == 2 for r in rows)
    assert pts[:, 0].min() >= 0.6 - 1e-9 and pts[:, 0].max() <= 19.4 + 1e-9


def test_perimeter_points_for_a_circle():
    ring = np.array(
        [[4 * math.cos(a), 4 * math.sin(a)] for a in np.linspace(0, 2 * math.pi, 48, endpoint=False)]
    )
    pts = k.perimeter_points(ring, 8.0, 0.15)
    assert len(pts) == 4  # 24.2 m round at 8 m spacing
    assert np.allclose(np.linalg.norm(pts, axis=1), 3.85, atol=0.05)


def test_lod_scales_segment_counts_with_a_floor():
    assert k.segs(0.55, BuildCtx(grid=None, lod=0.1)) == k.MIN_SEG
    assert k.segs(0.55, BuildCtx(grid=None, lod=1.0)) >= k.segs(0.55, BuildCtx(grid=None, lod=0.5))


def test_triangles_counts_instances():
    nodes = k.handrail(
        np.array([[0.0, 0.0], [10.0, 0.0]]), 0.0, height=1.1, spacing=2.5, closed=False, lod=1.0
    )
    assert k.triangles(nodes) == 5 * 8 + 16
```

- [ ] **Step 2: Run them to see them fail**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure_kit.py -q
```
Expected: collection error `ModuleNotFoundError: No module named 'app.asset_models.builders.structure_kit'`.

- [ ] **Step 3: Write the kit**

`backend/app/asset_models/builders/structure_kit.py`:
```python
"""Shared pieces for the structure builders (B1): footprint frames, members, handrails, pipes.

Item-local frame (index "Binding interfaces"): metres, Y up from base_el, x = plant north,
z = plant east, origin at footprint_ref. 2-D points here are local [x, z]. Every geom call the
structure family makes goes through this module, so a change in F0's helpers is fixed here once.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import trimesh
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient

from app.asset_models.builders import geom
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import Item

UP = np.array([0.0, 1.0, 0.0])
MIN_SEG = 8


@dataclass(frozen=True)
class Run:
    """A straight stretch of a linear structure: centreline p0 -> p1 (local [x, z]) and its width."""

    p0: np.ndarray
    p1: np.ndarray
    width: float

    @property
    def length(self) -> float:
        return float(np.linalg.norm(self.p1 - self.p0))

    @property
    def u(self) -> np.ndarray:  # unit along
        return (self.p1 - self.p0) / max(self.length, 1e-9)

    @property
    def v(self) -> np.ndarray:  # unit across; +v is the right-hand side walking p0 -> p1
        return np.array([-self.u[1], self.u[0]])

    def at(self, t: float, s: float = 0.0) -> np.ndarray:
        """Local [x, z] at distance t along and s across (+ = right)."""
        return self.p0 + self.u * t + self.v * s


def segs(r: float, ctx: BuildCtx) -> int:
    return max(MIN_SEG, round(geom.segments_for(r) * ctx.lod))


def local_pts(item: Item, ctx: BuildCtx, pts) -> np.ndarray:
    """Plant [E, N] points (k, 2) -> item-local [x, z] (k, 2), through F0's BuildCtx.local."""
    pts = np.asarray(pts, dtype=float)
    return np.asarray(ctx.local(item, pts[:, 0], pts[:, 1]), dtype=float)


def outline(item: Item, ctx: BuildCtx) -> np.ndarray:
    """The footprint as a counter-clockwise local [x, z] ring (k, 2), not closed."""
    ring = np.asarray(footprint_polygon(item.footprint), dtype=float)
    if ring.ndim != 2 or len(ring) < 3:
        raise ValueError("footprint has no area")
    poly = Polygon(local_pts(item, ctx, ring))
    if not poly.is_valid or poly.area < 1e-4:
        raise ValueError("footprint is not a simple polygon with area")
    poly = orient(poly, sign=1.0)
    return np.asarray(poly.exterior.coords, dtype=float)[:-1]


def runs(item: Item, ctx: BuildCtx) -> list[Run]:
    """Linear stretches: each segment of a line footprint; one run along the long axis otherwise.

    rect: along its longer side (size[0] at rot_deg when that is the longer one).
    polygon/circle: along the long side of the minimum rotated rectangle, through its centre.
    """
    fp = item.footprint
    if fp.kind == "line":
        loc = local_pts(item, ctx, fp.pts)
        out = [Run(loc[k], loc[k + 1], float(fp.width)) for k in range(len(loc) - 1)]
        out = [r for r in out if r.length > 0.01]
        if not out:
            raise ValueError("line footprint has no length")
        return out
    if fp.kind == "rect":
        along_m, across_m = float(fp.size[0]), float(fp.size[1])
        t = math.radians(fp.rot_deg)
        if across_m > along_m:  # ruling R4: a linear run follows the rect's longer side
            along_m, across_m, t = across_m, along_m, t + math.pi / 2
        u_plant = np.array([math.sin(t), math.cos(t)])  # [E, N] of the along axis
        c = np.asarray(fp.center, dtype=float)
        ends = np.array([c - along_m / 2 * u_plant, c + along_m / 2 * u_plant])
        loc = local_pts(item, ctx, ends)
        return [Run(loc[0], loc[1], across_m)]
    return [rect_run(outline(item, ctx))]


def rect_run(ring: np.ndarray) -> Run:
    """The minimum rotated rectangle of a ring as a run along its long side."""
    rect = np.asarray(Polygon(ring).minimum_rotated_rectangle.exterior.coords, dtype=float)[:4]
    e0, e1 = rect[1] - rect[0], rect[2] - rect[1]
    if np.linalg.norm(e1) > np.linalg.norm(e0):
        rect = np.roll(rect, -1, axis=0)
        e0, e1 = e1, rect[2] - rect[1]
    width = float(np.linalg.norm(e1))
    mid0 = (rect[0] + rect[3]) / 2
    mid1 = (rect[1] + rect[2]) / 2
    return Run(mid0, mid1, width)


def stations(length: float, spacing: float, inset: float = 0.0) -> np.ndarray:
    """Evenly spaced positions from inset to length - inset, gaps never above spacing (≥ 2 points)."""
    span = max(length - 2 * inset, 0.0)
    n = max(2, math.ceil(span / spacing - 1e-9) + 1)
    return np.linspace(inset, inset + span, n)


def dedupe_index(pts: np.ndarray, tol: float) -> list[int]:
    """Indices of the points kept, in order, when a point within tol of a kept one is dropped."""
    pts = np.asarray(pts, dtype=float)
    if len(pts) == 0:
        return []
    tree = cKDTree(pts)
    dropped = np.zeros(len(pts), dtype=bool)
    kept: list[int] = []
    for i in range(len(pts)):
        if dropped[i]:
            continue
        kept.append(i)
        for j in tree.query_ball_point(pts[i], tol - 1e-12):
            if j > i:
                dropped[j] = True
    return kept


def dedupe(pts: np.ndarray, tol: float) -> np.ndarray:
    return np.asarray(pts)[dedupe_index(np.asarray(pts), tol)]


def xz(p2: np.ndarray, y: float) -> np.ndarray:
    return np.array([p2[0], y, p2[1]], dtype=float)


def translate(points3: np.ndarray) -> np.ndarray:
    """(N, 4, 4) pure translations."""
    pts = np.atleast_2d(np.asarray(points3, dtype=float))
    out = np.tile(np.eye(4), (len(pts), 1, 1))
    out[:, :3, 3] = pts
    return out


def along(p0: np.ndarray, p1: np.ndarray) -> np.ndarray:
    """4x4 that takes a unit-length mesh along +Y from the origin onto p0 -> p1 (scale on Y only)."""
    d = np.asarray(p1, float) - np.asarray(p0, float)
    length = float(np.linalg.norm(d))
    rot = trimesh.geometry.align_vectors(UP, d / length)
    scale = np.diag([1.0, length, 1.0, 1.0])
    m = rot @ scale
    m[:3, 3] = p0
    return m


def uncap(m: trimesh.Trimesh, axis: np.ndarray) -> trimesh.Trimesh:
    """Drop the faces facing along axis (end caps nobody sees): 12 -> 8 triangles for a member."""
    a = np.asarray(axis, dtype=float)
    a = a / np.linalg.norm(a)
    keep = np.abs(m.face_normals @ a) < 0.99
    out = m.copy()
    out.update_faces(keep)
    out.remove_unreferenced_vertices()
    return out


def member(p0, p1, w: float, h: float | None = None) -> trimesh.Trimesh:
    """A rectangular member p0 -> p1 without end caps (8 triangles).

    w is the width across, level (horizontal, square to the member in plan); h is the depth in the
    vertical plane through the member. A vertical member is square to plant north (local x).
    """
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    e1 = d / np.linalg.norm(d)
    side = np.cross(UP, e1)
    ew = side / np.linalg.norm(side) if np.linalg.norm(side) > 1e-9 else np.array([1.0, 0.0, 0.0])
    eh = np.cross(e1, ew)
    hh = w if h is None else h
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    verts = np.array([p + ew * (cx * w / 2) + eh * (cz * hh / 2) for p in (p0, p1) for cx, cz in corners])
    faces = []
    for j in range(4):
        a, b = j, (j + 1) % 4
        faces += [[a, b, 4 + b], [a, 4 + b, 4 + a]]
    m = trimesh.Trimesh(verts, np.array(faces), process=False)
    mid = (p0 + p1) / 2
    out = np.einsum("ij,ij->i", m.face_normals, m.triangles_center - mid) < 0  # point every face outward
    f = m.faces.copy()
    f[out] = f[out][:, ::-1]
    return trimesh.Trimesh(verts, f, process=False)


def pile_mesh(r: float, h: float, ctx: BuildCtx) -> trimesh.Trimesh:
    """An uncapped vertical cylinder, base at the origin (the cap sits under a deck)."""
    return uncap(geom.cyl(r, h, segs(r, ctx)), UP)


def column_mesh(h: float, w: float) -> trimesh.Trimesh:
    """A square column, base at the origin, top at y = h."""
    return member((0.0, 0.0, 0.0), (0.0, h, 0.0), w)


def merge(meshes: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    return trimesh.util.concatenate([m for m in meshes if m is not None and len(m.faces)])


def slab(ring: np.ndarray, y0: float, y1: float) -> trimesh.Trimesh:
    m = geom.extrude(ring, y1 - y0)
    m.apply_translation((0.0, y0, 0.0))
    return m


def tube(r: float, seg: int) -> trimesh.Trimesh:
    """Open unit-length cylinder along +Y from the origin (2·seg triangles); pipes."""
    k = np.arange(seg) * (2 * math.pi / seg)
    ring = np.c_[r * np.cos(k), np.zeros(seg), r * np.sin(k)]
    verts = np.vstack([ring, ring + UP])
    faces = []
    for i in range(seg):
        j = (i + 1) % seg
        faces += [[i, seg + j, j], [i, seg + i, seg + j]]
    m = trimesh.Trimesh(verts, np.array(faces), process=False)
    m.fix_normals()
    return m


def handrail(path: np.ndarray, y: float, *, height: float, spacing: float, closed: bool, lod: float):
    """Posts (instanced) and top + knee rails along a local [x, z] polyline at deck level y."""
    pts = np.asarray(path, dtype=float)
    if closed:
        pts = np.vstack([pts, pts[:1]])
    post_xy: list[np.ndarray] = []
    rails: list[trimesh.Trimesh] = []
    step = spacing / max(lod, 0.25)
    post_dir: list[np.ndarray] = []
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        seg_len = float(np.linalg.norm(b - a))
        if seg_len < 1e-6:
            continue
        for t in stations(seg_len, step)[:-1] if closed else stations(seg_len, step):
            post_xy.append(a + (b - a) * (t / seg_len))
            post_dir.append((b - a) / seg_len)
        for ry in (height, height * 0.5):
            rails.append(member(xz(a, y + ry), xz(b, y + ry), 0.05))
    keep = dedupe_index(np.array(post_xy), 0.05) if post_xy else []
    post = column_mesh(height, 0.06)
    nodes = [MeshNode("handrail_rails", "Handrail", merge(rails))]
    if keep:
        xf = np.concatenate([posed(xz(post_xy[i], y)[None], post_dir[i]) for i in keep])
        nodes.insert(0, MeshNode("handrail_posts", "Handrail", Instanced(post, xf)))
    return nodes


def pipe_nodes(lines: list[tuple[float, bool, np.ndarray, np.ndarray]], ctx: BuildCtx) -> list[MeshNode]:
    """Pipes as instanced unit tubes, one node per (diameter, insulated); lines are (d, ins, p0, p1)."""
    groups: dict[tuple[float, bool], list[np.ndarray]] = {}
    for d, ins, p0, p1 in lines:
        if np.linalg.norm(np.asarray(p1) - np.asarray(p0)) > 1e-6:
            groups.setdefault((round(d, 4), ins), []).append(along(p0, p1))
    out = []
    for (d, ins), xf in sorted(groups.items()):
        name = f"pipes_{'ins_' if ins else ''}{round(d * 1000)}"
        out.append(
            MeshNode(
                name,
                "Pipe_Insulated" if ins else "Pipe",
                Instanced(tube(d / 2, segs(d / 2, ctx)), np.array(xf)),
            )
        )
    return out


def triangles(nodes: list[MeshNode]) -> int:
    n = 0
    for node in nodes:
        g = node.geometry
        n += len(g.mesh.faces) * len(g.transforms) if isinstance(g, Instanced) else len(g.faces)
    return n


def posed(points3: np.ndarray, u: np.ndarray) -> np.ndarray:
    """(N, 4, 4): rotate about Y so local +X points along u (local [x, z]), then translate."""
    c, s = float(u[0]), -float(u[1])
    rot = np.array([[c, 0.0, s, 0.0], [0.0, 1.0, 0.0, 0.0], [-s, 0.0, c, 0.0], [0.0, 0.0, 0.0, 1.0]])
    out = np.tile(rot, (len(np.atleast_2d(points3)), 1, 1))
    out[:, :3, 3] = np.atleast_2d(np.asarray(points3, dtype=float))
    return out


def block(size: tuple[float, float, float]) -> trimesh.Trimesh:
    """A box centred on the origin, extents (along X, up Y, across Z)."""
    return trimesh.creation.box(extents=size)


def placed_block(center3, size, u) -> trimesh.Trimesh:
    m = block(size)
    m.apply_transform(posed(np.asarray(center3, float)[None], u)[0])
    return m


def grid_rows(
    ring: np.ndarray, run: Run, along_sp: float, across_sp: float, inset: float
) -> list[np.ndarray]:
    """Grid points on the run's axes (rows across, one per station along), kept inside the ring.

    Points sit `inset` in from the run's rectangle; they are kept when inside the ring shrunk by
    inset / 2, so a ring that is not quite its minimum rectangle still keeps its edge rows.
    """
    poly = Polygon(ring)
    inner = poly.buffer(-inset / 2)
    if inner.is_empty:
        inner = poly
    inner = inner.buffer(1e-6)
    rows = []
    for t in stations(run.length, along_sp, inset):
        row = [run.at(t, s) for s in stations(run.width, across_sp, inset) - run.width / 2]
        row = [p for p in row if inner.contains(Point(p))]
        if row:
            rows.append(np.array(row))
    if not rows:
        rows = [np.array([run.at(run.length / 2)])]
    return rows


def perimeter_points(ring: np.ndarray, spacing: float, inset: float) -> np.ndarray:
    """Column spots round a ring shrunk by inset: its corners (rings of <= 12 vertices) plus one
    every `spacing` along it. Circles and many-sided rings get the spaced points only."""
    inner = Polygon(ring).buffer(-inset, join_style=2)
    if inner.is_empty:
        inner = Polygon(ring)
    edge = inner.exterior
    corners = np.asarray(edge.coords, dtype=float)[:-1] if len(ring) <= 12 else np.zeros((0, 2))
    n = max(3, math.ceil(edge.length / spacing - 1e-9))
    spaced = np.array([[q.x, q.y] for q in (edge.interpolate(i / n, normalized=True) for i in range(n))])
    return np.vstack([corners, spaced])
```

- [ ] **Step 4: Run the tests**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure_kit.py -q
```
Expected: `19 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/structure_kit.py tests/test_builders_structure_kit.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/structure_kit.py tests/test_builders_structure_kit.py
```
Expected: `All checks passed!`.

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git add backend/app/asset_models/builders/structure_kit.py
git add backend/tests/test_builders_structure_kit.py
git commit -m "feat(builders): structure kit (runs, members, handrails, instanced pipes)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Piled decks: `trestle`, `jetty_platform`, `dolphin` (and the test harness)

**Files:**
- Create: `backend/app/asset_models/builders/structure.py` (header, shared helpers, three builders)
- Create: `backend/tests/test_builders_structure.py` (harness, per-type invariants, piled-deck tests)

**Interfaces:**
- Consumes: the Task 2 kit; `builder`, `BuildCtx`, `Instanced`, `MeshNode`, `geom.cyl`, `Item`.
- Produces:
  - in `structure.py`: `RAIL_H = 1.1`, `FOOT = 0.15`, `DEFAULT_PIPE_D`; `_P` (strict pydantic base); `RackLine(d_m, tier=0, insulated=False, count=1)`; `_stamp(nodes, p, height_defaulted)`; `_levels(item, base, h) -> list[float]`; `_fill_lines(width, tiers, lines, fill) -> [(d, insulated, tier_y, s)]`; `_merge_rails(nodes)`; `_deck_top`, `_piled_deck`, `_deck_rail`; `TrestleParams`, `JettyPlatformParams`, `DolphinParams`; registered `trestle`, `jetty_platform`, `dolphin`;
  - in the test file: `TypeSpec`, `SPECS`, the section markers `# -- racks (task 4)`, `# -- access (task 5)`, `# -- platforms (task 6)`; helpers `line`, `rect`, `item`, `case`, `build`, `expand`, `all_vertices`, `footprint_local`, `node`, `instances`.
  - The per-type invariant tests run over `TYPES = list(SPECS)`, so each later task only adds a `SPECS[...]` entry after its marker.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_builders_structure.py`:
```python
"""Structure builders (B1): spec §6 / §13 gate tests for the 11 structure types."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pytest
import trimesh

from app.asset_models.builders import REGISTRY, build_item, load_all
from app.asset_models.builders import structure_kit as k
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import Item

load_all()

CTX = BuildCtx(grid=None)


def line(pts, width):
    return {"kind": "line", "pts": pts, "width": width}


def rect(along, across, rot=0.0, center=(0.0, 0.0)):
    return {"kind": "rect", "center": list(center), "size": [along, across], "rot_deg": rot}


@dataclass(frozen=True)
class TypeSpec:
    """A type's canonical test case (default params) and what it must satisfy."""

    footprint: dict
    base: float
    top: float
    rot: dict  # a rect version (along > across) for the rotation test
    required: set[str]  # realism floor: sub-part node names (Cowork's sub-parts + spec §6)
    pad_xz: float = 0.1  # plan reach past the footprint, m (ruling R2)
    pad_y: float = 1.2  # reach above top_el, m: handrails 1.1 m (ruling R2)
    piped: bool = False


SPECS: dict[str, TypeSpec] = {}
# -- piled decks (task 3)
SPECS["trestle"] = TypeSpec(
    line([[0, 0], [0, 40]], 12), 93.56, 104.5, rect(40, 12),
    {"deck", "piles", "headstocks", "bracing", "handrail_posts", "handrail_rails", "rack_sleepers"},
    piped=True,
)  # fmt: skip
SPECS["jetty_platform"] = TypeSpec(
    rect(30, 20), 93.56, 104.5, rect(30, 20), {"deck", "piles", "handrail_posts", "handrail_rails"}
)
SPECS["dolphin"] = TypeSpec(
    rect(7, 6), 93.56, 104.5, rect(7, 6), {"cap", "piles", "fender", "bollards"}, pad_xz=1.05, pad_y=0.8
)
# -- racks (task 4)
# -- access (task 5)
# -- platforms (task 6)
TYPES = list(SPECS)


def item(type_, footprint, base, top, *, levels=(), params=None) -> Item:
    return Item.model_validate(
        {
            "id": f"t-{type_}",
            "name": type_,
            "type": type_,
            "footprint": footprint,
            "base_el": base,
            "top_el": top,
            "levels": list(levels),
            "params": params or {},
            "source": {"kind": "assumed"},
        }
    )


def case(type_, *, footprint=None, top="spec", levels=(), params=None) -> Item:
    s = SPECS[type_]
    return item(
        type_, footprint or s.footprint, s.base, s.top if top == "spec" else top, levels=levels, params=params
    )


def build(it: Item, ctx: BuildCtx = CTX) -> list[MeshNode]:
    return REGISTRY[it.type].fn(it, ctx)


def expand(nodes: list[MeshNode]) -> dict[str, trimesh.Trimesh]:
    out = {}
    for n in nodes:
        g = n.geometry
        if isinstance(g, Instanced):
            parts = []
            for xf in g.transforms:
                m = g.mesh.copy()
                m.apply_transform(xf)
                parts.append(m)
            out[n.name] = trimesh.util.concatenate(parts)
        else:
            out[n.name] = g
    return out


def all_vertices(nodes) -> np.ndarray:
    return np.vstack([m.vertices for m in expand(nodes).values()])


def footprint_local(it: Item) -> np.ndarray:
    return k.local_pts(it, CTX, footprint_polygon(it.footprint))


def node(nodes, name) -> MeshNode:
    return next(n for n in nodes if n.name == name)


def instances(nodes, name) -> int:
    return len(node(nodes, name).geometry.transforms)


# ---------------------------------------------------------------- per-type invariants
@pytest.mark.parametrize("type_", TYPES)
def test_bounds_stay_inside_footprint_and_height(type_):
    s = SPECS[type_]
    it = case(type_)
    v = all_vertices(build(it))
    ring = footprint_local(it)
    assert v[:, 0].min() >= ring[:, 0].min() - s.pad_xz and v[:, 0].max() <= ring[:, 0].max() + s.pad_xz
    assert v[:, 2].min() >= ring[:, 1].min() - s.pad_xz and v[:, 2].max() <= ring[:, 1].max() + s.pad_xz
    h = s.top - s.base
    assert v[:, 1].min() >= -1e-6
    assert v[:, 1].max() <= h + s.pad_y + 1e-6
    assert v[:, 1].max() >= h - 1e-6  # reaches its top


@pytest.mark.parametrize("type_", TYPES)
def test_nodes_are_named_coloured_and_meet_the_realism_floor(type_):
    nodes = build(case(type_))
    names = [n.name for n in nodes]
    assert len(names) == len(set(names)), names
    assert SPECS[type_].required <= set(names), SPECS[type_].required - set(names)
    if SPECS[type_].piped:
        assert any(n.startswith("pipes_") for n in names)
    for n in nodes:
        assert n.material in PALETTE, (n.name, n.material)
        g = n.geometry
        mesh = g.mesh if isinstance(g, Instanced) else g
        assert len(mesh.faces) > 0, n.name
        assert np.isfinite(mesh.vertices).all(), n.name
        if isinstance(g, Instanced):
            assert g.transforms.shape[1:] == (4, 4) and len(g.transforms) >= 1
            assert np.isfinite(g.transforms).all()


@pytest.mark.parametrize("type_", TYPES)
def test_build_is_deterministic(type_):
    a, b = build(case(type_)), build(case(type_))
    assert [n.name for n in a] == [n.name for n in b]
    for x, y in zip(a, b, strict=True):
        if isinstance(x.geometry, Instanced):
            assert np.array_equal(x.geometry.transforms, y.geometry.transforms)
            assert np.array_equal(x.geometry.mesh.vertices, y.geometry.mesh.vertices)
        else:
            assert np.array_equal(x.geometry.vertices, y.geometry.vertices)
            assert np.array_equal(x.geometry.faces, y.geometry.faces)


@pytest.mark.parametrize("type_", TYPES)
@pytest.mark.parametrize("rot", [30.0, 90.0])
def test_rot_deg_turns_the_build_clockwise_from_north(type_, rot):
    plain = build(case(type_, footprint=SPECS[type_].rot))
    turned = build(case(type_, footprint=dict(SPECS[type_].rot, rot_deg=rot)))
    assert k.triangles(turned) == k.triangles(plain)
    v = all_vertices(turned)
    t = math.radians(rot)  # local (x = N, z = E); plant clockwise from north -> undo it
    back = np.c_[
        v[:, 0] * math.cos(t) + v[:, 2] * math.sin(t), v[:, 1], -v[:, 0] * math.sin(t) + v[:, 2] * math.cos(t)
    ]
    p = all_vertices(plain)
    # 5 cm: a cylinder's facets do not turn with the item
    assert np.allclose(back.min(axis=0), p.min(axis=0), atol=0.05)
    assert np.allclose(back.max(axis=0), p.max(axis=0), atol=0.05)


@pytest.mark.parametrize("type_", TYPES)
def test_missing_top_uses_the_default_height_and_says_so(type_):
    nodes = build(case(type_, top=None))
    assert nodes[0].extras["defaults"][-1] == "height"
    assert all_vertices(nodes)[:, 1].max() >= REGISTRY[type_].default_height_m - 1e-6


@pytest.mark.parametrize("type_", TYPES)
def test_every_param_has_a_default_and_defaults_are_recorded(type_):
    params_cls = REGISTRY[type_].params
    params_cls()  # every field has a default
    nodes = build(case(type_))
    assert nodes[0].extras["defaults"] == sorted(params_cls.model_fields)  # top given: no "height"


@pytest.mark.parametrize("type_", TYPES)
def test_lower_lod_never_adds_triangles(type_):
    it = case(type_)
    assert k.triangles(build(it, BuildCtx(grid=None, lod=0.5))) <= k.triangles(build(it))


# ---------------------------------------------------------------- piled decks (task 3)
def test_given_params_are_not_listed_as_defaults():
    defaults = build(case("trestle", params={"bay_spacing_m": 10.0}))[0].extras["defaults"]
    assert "bay_spacing_m" not in defaults and "pile_d_m" in defaults


def test_trestle_deck_top_follows_levels():
    deck = node(build(case("trestle", levels=[103.0])), "deck").geometry
    assert deck.bounds[1][1] == pytest.approx(103.0 - 93.56)


def test_trestle_pile_bents_and_rack_band():
    nodes = build(case("trestle"))
    assert instances(nodes, "piles") == 21  # 7 bents (40 m at 7.5 m) x 3 piles (12 m at 7.5 m)
    assert instances(nodes, "rack_sleepers") == 8  # every 6 m over 38 m
    no_rack = build(case("trestle", params={"rack_side": "none"}))
    assert not any(n.name.startswith("pipes_") or n.name == "rack_sleepers" for n in no_rack)


def test_trestle_rack_band_sits_on_the_chosen_side():
    right = node(build(case("trestle")), "rack_sleepers").geometry.transforms[:, 2, 3]
    left = node(build(case("trestle", params={"rack_side": "left"})), "rack_sleepers").geometry.transforms[
        :, 2, 3
    ]
    assert (right > 0).all() and (left < 0).all()  # walking north, right = east = +z


def test_dolphin_pile_group_and_fender_side():
    assert instances(build(case("dolphin")), "piles") == 9
    assert instances(build(case("dolphin", params={"piles_along": 2, "piles_across": 4})), "piles") == 8
    fender = node(build(case("dolphin", params={"fender_side": "left"})), "fender").geometry
    assert fender.bounds[0][2] < -3.0  # west face, past the 6 m cap's -3 m edge


def test_jetty_bollards_are_optional_and_instanced():
    assert "bollards" not in {n.name for n in build(case("jetty_platform"))}
    nodes = build(case("jetty_platform", params={"bollard_spacing_m": 10.0}))
    assert instances(nodes, "bollards") >= 9  # ~97 m of edge at 10 m


@pytest.mark.parametrize("params", [{"pile_d_m": -1}, {"bay_spacing_m": float("nan")}, {"bogus": 1}])
def test_bad_params_fall_back(params):
    _nodes, flags = build_item(case("trestle", params=params), CTX)
    assert [f.code for f in flags] == ["builder_fallback"]
```

- [ ] **Step 2: Run them to see them fail**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: failures with `KeyError: 'trestle'` (also `'jetty_platform'` and `'dolphin'`). `load_all()` tolerates the missing module, so the registry simply lacks the types. `test_bad_params_fall_back` may already pass through F0's fallback; that is fine.

- [ ] **Step 3: Write the header and the piled-deck builders**

`backend/app/asset_models/builders/structure.py`:
```python
"""Structure builders (B1): the 11 structure types of spec §6, at or above Cowork's detail.

Each builder: a params model (all fields defaulted), a function Item -> list[MeshNode] in the
item-local frame (metres, Y up from base_el, x north, z east), a catalogue doc, a default height.
Repeated members (piles, columns, posts, treads, sleepers, pipes) are Instanced. The first node
carries extras["defaults"]: the param names not given, plus "height" (ruling R1).
Height rule (ruling R2): top_el is the deck / walking level or the top of steel; handrails, fenders
and pipes resting on the top tier may stand above it.
"""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field
from shapely.geometry import Point, Polygon

from app.asset_models.builders import geom
from app.asset_models.builders import structure_kit as k
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, builder
from app.asset_models.spec import Item

RAIL_H = 1.1
FOOT = 0.15  # inclined members start this far above their base, so their section stays above it
DEFAULT_PIPE_D = (0.3, 0.45, 0.6, 0.36)


class _P(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class RackLine(_P):
    d_m: float = Field(gt=0, le=3.0, description="outside diameter incl. insulation, m")
    tier: int = Field(0, ge=0, le=9, description="0 = lowest tier")
    insulated: bool = False
    count: int = Field(1, ge=1, le=100)


def _stamp(nodes: list[MeshNode], p: _P, height_defaulted: bool) -> list[MeshNode]:
    """Record defaulted params on the first node (B3's convention, ruling R1): a sorted list of the
    param names not given, then "height" when ctx.height defaulted. A1 writes it to CSV notes."""
    names = sorted(set(type(p).model_fields) - p.model_fields_set)
    nodes[0].extras["defaults"] = [*names, "height"] if height_defaulted else names
    return nodes


def _levels(item: Item, base: float, h: float) -> list[float]:
    """item.levels as local y, kept inside (0, h], ascending, unique to 1 cm."""
    ys = sorted({round(lv - base, 2) for lv in item.levels if 0 < lv - base <= h + 1e-6})
    return ys


def _fill_lines(width: float, tiers: list[float], lines: list[RackLine], fill: bool):
    """[(d, insulated, tier_y, s)] pipe positions across a width; explicit lines win over the fill."""
    per_tier: dict[int, list[tuple[float, bool]]] = {}
    if lines:
        for ln in lines:
            t = min(ln.tier, len(tiers) - 1)
            per_tier.setdefault(t, []).extend([(ln.d_m, ln.insulated)] * ln.count)
    elif fill:
        n = int(min(16, max(2, width // 0.8)))
        for t in range(len(tiers)):
            per_tier[t] = [(DEFAULT_PIPE_D[i % 4], i % 3 == 2) for i in range(n)]
    out = []
    for t, pipes in per_tier.items():
        slots = (np.arange(len(pipes)) + 0.5) / len(pipes) * width - width / 2
        out += [(d, ins, tiers[t], float(s)) for (d, ins), s in zip(pipes, slots, strict=True)]
    return out


# ---------------------------------------------------------------- piled decks (trestle, jetty)
class TrestleParams(_P):
    deck_thickness_m: float = Field(1.2, gt=0, le=5)
    bay_spacing_m: float = Field(7.5, gt=1, le=60, description="pile bent spacing along the trestle")
    pile_spacing_m: float = Field(7.5, gt=1, le=30, description="pile spacing across a bent")
    pile_d_m: float = Field(1.1, gt=0.1, le=4)
    pile_inset_m: float = Field(0.6, ge=0, le=5)
    headstock: bool = True
    bracing: bool = True
    handrail: bool = True
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)
    rack_side: Literal["none", "left", "right"] = "right"
    rack_width_m: float = Field(7.5, gt=0, le=40)
    rack_pipes: int = Field(6, ge=0, le=40)


class JettyPlatformParams(_P):
    deck_thickness_m: float = Field(1.8, gt=0, le=5)
    bay_spacing_m: float = Field(7.5, gt=1, le=60)
    pile_spacing_m: float = Field(7.5, gt=1, le=30)
    pile_d_m: float = Field(1.1, gt=0.1, le=4)
    pile_inset_m: float = Field(0.6, ge=0, le=5)
    headstock: bool = False
    bracing: bool = False
    handrail: bool = True
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)
    bollard_spacing_m: float = Field(0, ge=0, le=100, description="0 = no bollards")


def _deck_top(item: Item, base: float, h: float) -> float:
    ys = _levels(item, base, h)
    return ys[-1] if ys else h


def _piled_deck(item: Item, ctx: BuildCtx, p, base: float, h: float, *, rail: Literal["sides", "perimeter"]):
    ring = k.outline(item, ctx)
    rs = k.runs(item, ctx)
    top = _deck_top(item, base, h)
    deck_bot = top - p.deck_thickness_m
    hs_d = 1.0 if p.headstock else 0.0
    pile_top = max(deck_bot - hs_d, 0.1)
    nodes = [MeshNode("deck", "Concrete", k.slab(ring, deck_bot, top))]
    bents: list[np.ndarray] = []
    for run in rs:
        bents += k.grid_rows(ring, run, p.bay_spacing_m, p.pile_spacing_m, p.pile_inset_m)
    piles = k.dedupe(np.vstack(bents), p.bay_spacing_m * 0.45)
    pile = k.pile_mesh(p.pile_d_m / 2, pile_top, ctx)
    xf = k.translate(np.c_[piles[:, 0], np.zeros(len(piles)), piles[:, 1]])
    nodes.append(MeshNode("piles", "Steel_Dark", Instanced(pile, xf)))
    if p.headstock:
        heads = [
            k.member(
                k.xz(row[0], pile_top + hs_d / 2), k.xz(row[-1], pile_top + hs_d / 2), p.pile_d_m + 0.3, hs_d
            )
            for row in bents
            if len(row) > 1
        ]
        if heads:
            nodes.append(MeshNode("headstocks", "Concrete_Dark", k.merge(heads)))
    if p.bracing:
        braces = []
        for row in bents:
            for i, (a, b) in enumerate(zip(row[:-1], row[1:], strict=True)):
                lo, hi = (a, b) if i % 2 == 0 else (b, a)
                braces.append(k.member(k.xz(lo, pile_top * 0.35), k.xz(hi, pile_top - 0.3), 0.3))
        if braces:
            nodes.append(MeshNode("bracing", "Steel_Dark", k.merge(braces)))
    if p.handrail:
        nodes += _deck_rail(ring, rs, top, p.post_spacing_m, ctx, rail)
    return nodes, ring, rs, top


def _deck_rail(ring, rs, y, spacing, ctx, rail):
    inner = np.asarray(Polygon(ring).buffer(-0.1, join_style=2).exterior.coords, dtype=float)[:-1]
    if rail == "perimeter":
        return k.handrail(inner, y, height=RAIL_H, spacing=spacing, closed=True, lod=ctx.lod)
    out = []
    axes = [r.u for r in rs]
    pts = np.vstack([inner, inner[:1]])
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        d = b - a
        n = np.linalg.norm(d)
        if n < 2.0:
            continue
        if max(abs(float(d @ u)) / n for u in axes) >= math.cos(math.radians(20)):
            out += k.handrail(np.array([a, b]), y, height=RAIL_H, spacing=spacing, closed=False, lod=ctx.lod)
    return _merge_rails(out)


def _merge_rails(nodes: list[MeshNode]) -> list[MeshNode]:
    """Fold several handrail() results into one posts node and one rails node."""
    posts = [n.geometry for n in nodes if n.name == "handrail_posts"]
    rails = [n.geometry for n in nodes if n.name == "handrail_rails"]
    out = []
    if posts:
        out.append(
            MeshNode(
                "handrail_posts",
                "Handrail",
                Instanced(posts[0].mesh, np.concatenate([g.transforms for g in posts])),
            )
        )
    if rails:
        out.append(MeshNode("handrail_rails", "Handrail", k.merge(rails)))
    return out


TRESTLE_DOC = (
    "Piled approach trestle (jetty causeway). Concrete deck slab on steel pile bents at bay spacing, "
    "concrete headstocks, bent bracing, handrail on both long sides, and a pipe-rack band of pipes on "
    "sleepers along one side. Footprint: line (centreline + deck width; one bent line per segment) or "
    "polygon/rect (deck outline; bents across its long axis). base_el = pile base used as model base "
    "(e.g. MSL or seabed); top_el or levels[-1] = deck top. Set rack_side none when there is no rack."
)


@builder("trestle", family="structure", params=TrestleParams, doc=TRESTLE_DOC, default_height_m=11.0)
def build_trestle(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = TrestleParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 11.0)
    nodes, ring, rs, top = _piled_deck(item, ctx, p, base, top_el - base, rail="sides")
    if p.rack_side != "none" and p.rack_pipes > 0:
        sign = 1.0 if p.rack_side == "right" else -1.0
        sleepers, lines = [], []
        for run in rs:
            band = min(p.rack_width_m, run.width)
            s0 = sign * (run.width / 2 - band / 2 - 0.2)
            for t in k.stations(run.length, 6.0, 1.0):
                sleepers.append((run.at(t, s0), run.u))
            for d, ins, _y, s in _fill_lines(band - 0.6, [0.0], [], True)[: p.rack_pipes]:
                y = top + 0.5 + d / 2
                lines.append((d, ins, k.xz(run.at(0, s0 + s), y), k.xz(run.at(run.length, s0 + s), y)))
        sl = k.block((0.5, 0.5, max(p.rack_width_m - 0.4, 0.5)))
        sl.apply_translation((0, 0.25, 0))
        pts = np.array([k.xz(c, top) for c, _ in sleepers])
        xf = np.concatenate([k.posed(pt[None], u) for pt, (_, u) in zip(pts, sleepers, strict=True)])
        nodes.append(MeshNode("rack_sleepers", "Concrete", Instanced(sl, xf)))
        nodes += k.pipe_nodes(lines, ctx)
    return _stamp(nodes, p, dflt)


JETTY_DOC = (
    "Jetty head / loading platform / piled deck. Concrete deck (polygon outline) on a steel pile grid "
    "clipped to the outline, handrail round the edge, optional bollards. Footprint: polygon or rect. "
    "base_el = pile base used as model base (e.g. MSL); top_el or levels[-1] = deck top. Equipment on "
    "the deck (loading arms, houses) are separate items."
)


@builder(
    "jetty_platform", family="structure", params=JettyPlatformParams, doc=JETTY_DOC, default_height_m=11.0
)
def build_jetty_platform(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = JettyPlatformParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 11.0)
    nodes, ring, _rs, top = _piled_deck(item, ctx, p, base, top_el - base, rail="perimeter")
    if p.bollard_spacing_m > 0:
        edge = Polygon(ring).buffer(-0.8, join_style=2).exterior
        n = max(2, int(edge.length // p.bollard_spacing_m))
        pts = [edge.interpolate(i / n, normalized=True) for i in range(n)]
        bol = geom.cyl(0.25, 0.7, k.segs(0.25, ctx))
        xf = k.translate(np.array([[q.x, top, q.y] for q in pts]))
        nodes.append(MeshNode("bollards", "Steel_Dark", Instanced(bol, xf)))
    return _stamp(nodes, p, dflt)


# ---------------------------------------------------------------- dolphin
class DolphinParams(_P):
    cap_thickness_m: float = Field(1.8, gt=0, le=6)
    pile_d_m: float = Field(1.1, gt=0.1, le=4)
    piles_along: int = Field(3, ge=1, le=10)
    piles_across: int = Field(3, ge=1, le=10)
    pile_inset_m: float = Field(0.8, ge=0, le=5)
    fender: bool = True
    fender_side: Literal["left", "right", "front", "back"] = "right"
    bollards: int = Field(1, ge=0, le=6, description="bollards / quick-release hooks on the cap")


DOLPHIN_DOC = (
    "Mooring or breasting dolphin: concrete cap on a pile group, a fender panel on the berth face, "
    "bollards on top. Footprint: rect (cap; size = along, across) or circle/polygon. base_el = pile base "
    "used as model base (e.g. MSL); top_el = cap top. fender_side: right/left = across the rect's along "
    "axis, front/back = its ends; set fender false for mooring dolphins."
)


@builder("dolphin", family="structure", params=DolphinParams, doc=DOLPHIN_DOC, default_height_m=11.0)
def build_dolphin(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = DolphinParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 11.0)
    h = top_el - base
    ring = k.outline(item, ctx)
    run = k.runs(item, ctx)[0]
    cap_bot = max(h - p.cap_thickness_m, 0.1)
    nodes = [MeshNode("cap", "Concrete", k.slab(ring, cap_bot, h))]
    ins = min(p.pile_inset_m, run.length / 3, run.width / 3)
    ts = (
        np.linspace(ins, run.length - ins, p.piles_along) if p.piles_along > 1 else np.array([run.length / 2])
    )
    ss = (
        np.linspace(-run.width / 2 + ins, run.width / 2 - ins, p.piles_across)
        if p.piles_across > 1
        else np.zeros(1)
    )
    poly = Polygon(ring).buffer(1e-6)
    pts = np.array([run.at(t, s) for t in ts for s in ss])
    pts = np.array([q for q in pts if poly.contains(Point(q))] or [run.at(run.length / 2)])
    pile = k.pile_mesh(p.pile_d_m / 2, cap_bot, ctx)
    nodes.append(
        MeshNode(
            "piles",
            "Steel_Dark",
            Instanced(pile, k.translate(np.c_[pts[:, 0], np.zeros(len(pts)), pts[:, 1]])),
        )
    )
    if p.fender:
        side = {
            "right": (run.length / 2, run.width / 2 + 0.7, run.u, 0.7 * run.length),
            "left": (run.length / 2, -run.width / 2 - 0.7, run.u, 0.7 * run.length),
            "front": (run.length + 0.7, 0.0, run.v, 0.7 * run.width),
            "back": (-0.7, 0.0, run.v, 0.7 * run.width),
        }[p.fender_side]
        t, s, u, span = side
        hgt = p.cap_thickness_m + 2.5
        c = k.xz(run.at(t, s), h + 0.5 - hgt / 2)
        nodes.append(MeshNode("fender", "Steel_Dark", k.placed_block(c, (span, hgt, 0.6), u)))
    if p.bollards:
        bol = geom.cyl(0.25, 0.7, k.segs(0.25, ctx))
        ts_b = (np.arange(p.bollards) + 0.5) / p.bollards * run.length
        xf = k.translate(np.array([k.xz(run.at(t, 0.0), h) for t in ts_b]))
        nodes.append(MeshNode("bollards", "Steel_Dark", Instanced(bol, xf)))
    return _stamp(nodes, p, dflt)
```

- [ ] **Step 4: Run the tests**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: `33 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/structure.py tests/test_builders_structure.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/structure.py tests/test_builders_structure.py
```
Expected: `All checks passed!`.

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git add backend/app/asset_models/builders/structure.py
git add backend/tests/test_builders_structure.py
git commit -m "feat(builders): trestle, jetty platform and dolphin structure builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Racks: `pipe_rack`, `overbridge`, `pipe_sleeper`

**Files:**
- Modify: `backend/app/asset_models/builders/structure.py` (append the racks section at the end)
- Modify: `backend/tests/test_builders_structure.py` (one import, the racks `SPECS` entries, the racks tests)

**Interfaces:**
- Consumes: `_P`, `RackLine`, `_stamp`, `_levels`, `_fill_lines`, `FOOT` (Task 3); the kit.
- Produces: `PipeRackParams`, `OverbridgeParams`, `PipeSleeperParams`; `_tiers(item, base, h, n, gap) -> list[float]`; `_rack(item, ctx, p, base, h, bent_spacing, bracing, knee=False) -> list[MeshNode]`; registered `pipe_rack`, `overbridge`, `pipe_sleeper`.

- [ ] **Step 1: Add the `time` import**

In `backend/tests/test_builders_structure.py`, replace the line `import math` with:
```python
import math
import time
```

- [ ] **Step 2: Add the racks cases**

In `backend/tests/test_builders_structure.py`, insert directly after the line `# -- racks (task 4)`:
```python
SPECS["pipe_rack"] = TypeSpec(
    line([[0, 0], [0, 30]], 6), 100.0, 106.0, rect(30, 6), {"columns", "beams", "bracing"},
    pad_y=0.65, piped=True,
)  # fmt: skip
SPECS["overbridge"] = TypeSpec(
    rect(9, 5), 100.0, 107.0, rect(9, 5), {"columns", "beams", "bracing"}, pad_y=0.65, piped=True
)
SPECS["pipe_sleeper"] = TypeSpec(
    line([[0, 0], [0, 30]], 4), 100.0, 100.6, rect(30, 4), {"sleepers"}, pad_y=0.65, piped=True
)
```

- [ ] **Step 3: Append the racks tests**

Append to the end of `backend/tests/test_builders_structure.py`:
```python
# ---------------------------------------------------------------- racks (task 4)
def _pipe_centres_y(nodes) -> set[float]:
    return {
        round(float(xf[1, 3]), 3)
        for n in nodes
        if n.name.startswith("pipes_")
        for xf in n.geometry.transforms
    }


def test_pipe_rack_bents_tiers_and_pipes():
    nodes = build(case("pipe_rack"))
    assert instances(nodes, "columns") == 12  # 6 bents over 30 m at 6 m, 2 columns each
    for n in nodes:
        if n.name.startswith("pipes_"):
            assert isinstance(n.geometry, Instanced)
    tiers = {4.0, 6.0}  # n_tiers 2, tier_gap 2 m, top of steel at 6 m
    ys = _pipe_centres_y(nodes)
    assert {min(tiers, key=lambda t: abs(t - y)) for y in ys} == tiers


def test_pipe_rack_tiers_follow_levels():
    ys = _pipe_centres_y(build(case("pipe_rack", levels=[102.0, 104.0, 106.0])))
    tiers = {2.0, 4.0, 6.0}
    assert {min(tiers, key=lambda t: abs(t - y)) for y in ys} == tiers
    assert all(any(0 < y - t <= 0.31 for t in tiers) for y in ys)  # pipe centre = tier + d / 2


def test_pipe_rack_explicit_lines_replace_the_fill():
    lines = [{"d_m": 0.8, "tier": 1, "insulated": True, "count": 3}]
    pipes = [n for n in build(case("pipe_rack", params={"lines": lines})) if n.name.startswith("pipes_")]
    assert [(n.name, n.material, len(n.geometry.transforms)) for n in pipes] == [
        ("pipes_ins_800", "Pipe_Insulated", 3)
    ]
    assert not [
        n for n in build(case("pipe_rack", params={"pipe_fill": False})) if n.name.startswith("pipes_")
    ]


def test_rack_bracing_modes():
    def bracing_faces(mode):
        nodes = build(case("pipe_rack", params={"bracing": mode}))
        hit = [n for n in nodes if n.name == "bracing"]
        return len(hit[0].geometry.faces) if hit else 0

    assert bracing_faces("end_bays") == 2 * 2 * 2 * 8  # 2 end bays x 2 column lines x X (2 members)
    assert bracing_faces("all") == 5 * 2 * 2 * 8
    assert bracing_faces("none") == 0


def test_overbridge_is_two_portals_with_pipes_along_the_span():
    nodes = build(case("overbridge"))
    assert instances(nodes, "columns") == 4
    xf = next(n for n in nodes if n.name.startswith("pipes_")).geometry.transforms[0]
    axis = xf[:3, :3] @ [0, 1, 0]
    assert abs(axis[0]) == pytest.approx(9.0, abs=1e-6)  # pipes run the 9 m span (north)


def test_sleepers_cross_the_band_at_spacing():
    nodes = build(case("pipe_sleeper"))
    assert instances(nodes, "sleepers") == 6  # 30 m at 6 m, 0.25 m in from each end
    v = expand(nodes)["sleepers"].vertices
    assert np.ptp(v[:, 2]) == pytest.approx(4.0)  # full band width across (east)


def test_rot_90_swaps_the_plan_extents():
    a = all_vertices(build(case("pipe_rack", footprint=rect(30, 6))))
    b = all_vertices(build(case("pipe_rack", footprint=rect(30, 6, rot=90))))
    ea, eb = np.ptp(a, axis=0), np.ptp(b, axis=0)
    assert ea[0] == pytest.approx(eb[2], abs=0.05) and ea[2] == pytest.approx(eb[0], abs=0.05)
    assert ea[0] > 29 and eb[2] > 29  # rot 0 runs north (x); rot 90 runs east (z)


def _dist_to_polyline(p, pts) -> float:
    best = math.inf
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        ab = b - a
        t = np.clip((p - a) @ ab / (ab @ ab), 0, 1)
        best = min(best, float(np.linalg.norm(p - (a + t * ab))))
    return best


@pytest.mark.parametrize(
    ("type_", "member"), [("pipe_rack", "columns"), ("trestle", "piles"), ("pipe_sleeper", "sleepers")]
)
def test_line_footprint_follows_the_polyline(type_, member):
    pts = [[0, 0], [0, 40], [30, 70]]
    width = SPECS[type_].footprint["width"]
    it = case(type_, footprint=line(pts, width))
    loc = k.local_pts(it, CTX, pts)
    centres = node(build(it), member).geometry.transforms[:, [0, 2], 3]
    assert all(_dist_to_polyline(c, loc) <= width / 2 + 1e-6 for c in centres)
    for leg in ((loc[0] + loc[1]) / 2, (loc[1] + loc[2]) / 2):  # both legs carry members
        assert min(np.linalg.norm(centres - leg, axis=1)) < 8.0
    if type_ == "pipe_rack":  # the shared corner column is not doubled
        d = np.linalg.norm(centres[:, None] - centres[None], axis=2) + np.eye(len(centres)) * 1e9
        assert d.min() >= 0.1


def test_zero_length_line_raises_and_build_item_falls_back():
    it = case("pipe_rack", footprint=line([[5, 5], [5, 5]], 6))
    with pytest.raises(ValueError):
        build(it)
    _nodes, flags = build_item(it, CTX)
    assert [f.code for f in flags] == ["builder_fallback"]


def test_a_three_km_polyline_builds_quickly():
    pts = [[i * 50.0, (i % 2) * 5.0] for i in range(61)]  # 3 km zig-zag, 60 legs
    for type_ in ("pipe_rack", "trestle"):
        it = case(type_, footprint=line(pts, SPECS[type_].footprint["width"]))
        t0 = time.perf_counter()
        nodes = build(it)
        assert time.perf_counter() - t0 < 5.0, type_
        assert k.triangles(nodes) < 200_000, type_
```

- [ ] **Step 4: Run them to see them fail**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: failures with `KeyError: 'pipe_rack'` (and `'overbridge'`, `'pipe_sleeper'`). The 33 Task 3 tests still pass.

- [ ] **Step 5: Append the racks builders**

Append to the end of `backend/app/asset_models/builders/structure.py`:
```python
# ---------------------------------------------------------------- racks, sleepers, overbridges
class PipeRackParams(_P):
    bent_spacing_m: float = Field(6.0, gt=1, le=30)
    columns_across: int = Field(2, ge=1, le=6)
    n_tiers: int = Field(2, ge=1, le=6, description="used when levels is empty")
    tier_gap_m: float = Field(2.0, gt=0.3, le=10)
    column_section_m: float = Field(0.35, gt=0.05, le=2)
    beam_depth_m: float = Field(0.35, gt=0.05, le=2)
    bracing: Literal["none", "end_bays", "all"] = "end_bays"
    lines: list[RackLine] = Field(default_factory=list, max_length=200)
    pipe_fill: bool = Field(True, description="draw indicative pipes when lines is empty")


def _tiers(item: Item, base: float, h: float, n: int, gap: float) -> list[float]:
    ys = _levels(item, base, h)
    if not ys:
        ys = [h - gap * i for i in range(n)]
        ys = sorted(y for y in ys if y > 0.5) or [h]
    if abs(ys[-1] - h) > 1e-6:
        ys = sorted(set(ys) | {h})
    return ys


def _rack(item, ctx, p, base, h, bent_spacing, bracing, knee=False):
    tiers = _tiers(item, base, h, p.n_tiers, p.tier_gap_m)
    c, bd = p.column_section_m, p.beam_depth_m
    cols, cross, longs, braces, lines = [], [], [], [], []
    for run in k.runs(item, ctx):
        ss = (
            np.linspace(-run.width / 2 + c / 2, run.width / 2 - c / 2, p.columns_across)
            if p.columns_across > 1
            else np.zeros(1)
        )
        ts = k.stations(run.length, bent_spacing, c / 2)
        cols += [(run.at(t, s), run.u) for t in ts for s in ss]
        for t in ts:
            for y in tiers:
                cross.append(
                    k.member(
                        k.xz(run.at(t, ss[0] - c / 2), y - bd / 2),
                        k.xz(run.at(t, ss[-1] + c / 2), y - bd / 2),
                        c,
                        bd,
                    )
                )
        for s in ss:
            for y in tiers:
                longs.append(
                    k.member(
                        k.xz(run.at(0, s), y - bd / 2),
                        k.xz(run.at(run.length, s), y - bd / 2),
                        0.25,
                        bd * 0.8,
                    )
                )
        bays = list(zip(ts[:-1], ts[1:], strict=True))
        pick = (
            bays
            if bracing == "all"
            else (sorted({bays[0], bays[-1]}) if bracing == "end_bays" and bays else [])
        )
        for t0, t1 in pick:
            for s in ss:
                braces.append(k.member(k.xz(run.at(t0, s), FOOT), k.xz(run.at(t1, s), tiers[0] - bd), 0.15))
                braces.append(k.member(k.xz(run.at(t1, s), FOOT), k.xz(run.at(t0, s), tiers[0] - bd), 0.15))
        if knee:
            for t, dt in ((ts[0], 1.0), (ts[-1], -1.0)):
                for s in ss:
                    braces.append(
                        k.member(
                            k.xz(run.at(t, s), tiers[-1] - 1.2), k.xz(run.at(t + dt, s), tiers[-1] - bd), 0.15
                        )
                    )
        for d, ins, y, s in _fill_lines(run.width - 2 * c, tiers, p.lines, p.pipe_fill):
            lines.append((d, ins, k.xz(run.at(0, s), y + d / 2), k.xz(run.at(run.length, s), y + d / 2)))
    keep = k.dedupe_index(np.array([q for q, _ in cols]), 0.1)
    col = k.column_mesh(tiers[-1], c)
    xf = np.concatenate([k.posed(k.xz(cols[i][0], 0.0)[None], cols[i][1]) for i in keep])
    nodes = [
        MeshNode("columns", "Steel_Structure", Instanced(col, xf)),
        MeshNode("beams", "Steel_Structure", k.merge(cross + longs)),
    ]
    if braces:
        nodes.append(MeshNode("bracing", "Steel_Structure", k.merge(braces)))
    nodes += k.pipe_nodes(lines, ctx)
    return nodes


RACK_DOC = (
    "Steel pipe rack: column bents at bent spacing, a cross beam per tier per bent, longitudinal beams, "
    "bracing in the end bays, and pipes along the rack (params.lines, or an indicative fill). "
    "Footprint: line (centreline + rack width; preferred), rect or polygon (long axis). base_el = grade; "
    "top_el = top of steel of the highest tier; levels = tier elevations (top of steel)."
)


@builder("pipe_rack", family="structure", params=PipeRackParams, doc=RACK_DOC, default_height_m=6.0)
def build_pipe_rack(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = PipeRackParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 6.0)
    nodes = _rack(item, ctx, p, base, top_el - base, p.bent_spacing_m, p.bracing)
    return _stamp(nodes, p, dflt)


class OverbridgeParams(_P):
    columns_across: int = Field(2, ge=2, le=4)
    n_tiers: int = Field(2, ge=1, le=4)
    tier_gap_m: float = Field(1.5, gt=0.3, le=6)
    column_section_m: float = Field(0.35, gt=0.05, le=2)
    beam_depth_m: float = Field(0.35, gt=0.05, le=2)
    lines: list[RackLine] = Field(default_factory=list, max_length=100)
    pipe_fill: bool = True


OVERBRIDGE_DOC = (
    "Pipe overbridge over a road: two portal frames at the ends of the span with knee braces, cross and "
    "longitudinal beams per tier, pipes along the span. Footprint: rect (along = span direction) or line "
    "(span centreline + width). base_el = grade; top_el = top of steel; levels = tier elevations."
)


@builder("overbridge", family="structure", params=OverbridgeParams, doc=OVERBRIDGE_DOC, default_height_m=7.0)
def build_overbridge(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = OverbridgeParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 7.0)
    nodes = _rack(item, ctx, p, base, top_el - base, 1e6, "none", knee=True)
    return _stamp(nodes, p, dflt)


class PipeSleeperParams(_P):
    sleeper_spacing_m: float = Field(6.0, gt=0.5, le=30)
    sleeper_width_m: float = Field(0.5, gt=0.1, le=3)
    lines: list[RackLine] = Field(default_factory=list, max_length=200)
    pipe_fill: bool = True


SLEEPER_DOC = (
    "Pipe sleeper band at grade: concrete sleepers across the band at spacing, pipes running along on "
    "top. Footprint: line (centreline + band width; preferred) or rect. base_el = grade; top_el = top of "
    "sleepers (pipes rest on it)."
)


@builder("pipe_sleeper", family="structure", params=PipeSleeperParams, doc=SLEEPER_DOC, default_height_m=0.6)
def build_pipe_sleeper(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = PipeSleeperParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 0.6)
    h = top_el - base
    xf, lines = [], []
    rs = k.runs(item, ctx)
    width = rs[0].width
    for run in rs:
        for t in k.stations(run.length, p.sleeper_spacing_m, p.sleeper_width_m / 2):
            xf.append(k.posed(k.xz(run.at(t), h / 2)[None], run.v)[0])
        for d, ins, _y, s in _fill_lines(run.width - 0.2, [h], p.lines, p.pipe_fill):
            lines.append((d, ins, k.xz(run.at(0, s), h + d / 2), k.xz(run.at(run.length, s), h + d / 2)))
    sl = k.block((width, h, p.sleeper_width_m))
    nodes = [MeshNode("sleepers", "Concrete", Instanced(sl, np.array(xf)))] + k.pipe_nodes(lines, ctx)
    return _stamp(nodes, p, dflt)
```

- [ ] **Step 6: Run the tests**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: `69 passed`. `test_a_three_km_polyline_builds_quickly` takes about 2 s.

- [ ] **Step 7: Lint and commit**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/structure.py tests/test_builders_structure.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/structure.py tests/test_builders_structure.py
```
Expected: `All checks passed!`.

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git add backend/app/asset_models/builders/structure.py
git add backend/tests/test_builders_structure.py
git commit -m "feat(builders): pipe rack, overbridge and pipe sleeper with instanced pipes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Access: `catwalk`, `walkway`, `gangway`

**Files:**
- Modify: `backend/app/asset_models/builders/structure.py` (append the access section)
- Modify: `backend/tests/test_builders_structure.py` (the access `SPECS` entries and tests)

**Interfaces:**
- Consumes: `_P`, `_stamp`, `_merge_rails`, `RAIL_H`, `FOOT` (Task 3); the kit.
- Produces: `CatwalkParams`, `WalkwayParams`, `GangwayParams`; registered `catwalk`, `walkway`, `gangway`.

- [ ] **Step 1: Add the access cases**

In `backend/tests/test_builders_structure.py`, insert directly after the line `# -- access (task 5)`:
```python
SPECS["catwalk"] = TypeSpec(
    line([[0, 0], [0, 20]], 1.6), 103.0, 104.5, rect(20, 1.6),
    {"deck", "chords", "verticals", "diagonals", "handrail_posts", "handrail_rails"},
)  # fmt: skip
SPECS["walkway"] = TypeSpec(
    line([[0, 0], [0, 20]], 1.2), 100.0, 100.3, rect(20, 1.2), {"deck", "bearers"}, pad_y=0.05
)
SPECS["gangway"] = TypeSpec(
    rect(12, 2.6), 104.5, 110.5, rect(12, 2.6),
    {"tower_columns", "tower_bracing", "tower_platform", "boom", "treads", "counterweight"},
)  # fmt: skip
```

- [ ] **Step 2: Append the access tests**

Append to the end of `backend/tests/test_builders_structure.py`:
```python
# ---------------------------------------------------------------- access (task 5)
def test_catwalk_trusses_and_handrails_on_both_sides():
    nodes = build(case("catwalk"))
    assert instances(nodes, "verticals") == 2 * 7  # 20 m at 3.5 m panels, both trusses
    posts = node(nodes, "handrail_posts").geometry.transforms[:, 2, 3]
    assert (posts > 0).any() and (posts < 0).any()
    assert "handrail_posts" not in {n.name for n in build(case("catwalk", params={"handrail": False}))}


def test_walkway_panels_and_optional_handrail():
    nodes = build(case("walkway"))
    assert len(node(nodes, "deck").geometry.faces) == 4 * 12  # 20 m in 4 panels of <= 6 m
    assert "handrail_posts" not in {n.name for n in nodes}
    assert "handrail_posts" in {n.name for n in build(case("walkway", params={"handrail": True}))}
    flat = build(case("walkway", top=100.05))
    assert "bearers" not in {n.name for n in flat}  # the deck lies on the surface


def test_gangway_tower_at_the_start_and_boom_sloping_down():
    nodes = build(case("gangway"))
    assert instances(nodes, "tower_columns") == 4
    cols = node(nodes, "tower_columns").geometry.transforms[:, 0, 3]
    assert cols.max() < -6 + 1.8 + 1e-6  # tower in the first 1.8 m of the 12 m footprint (x from -6)
    treads = node(nodes, "treads").geometry.transforms
    assert treads[0, 1, 3] > treads[-1, 1, 3]  # the boom slopes down away from the tower
```

- [ ] **Step 3: Run them to see them fail**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: failures with `KeyError: 'catwalk'` (and `'walkway'`, `'gangway'`). The 69 earlier tests pass.

- [ ] **Step 4: Append the access builders**

Append to the end of `backend/app/asset_models/builders/structure.py`:
```python
# ---------------------------------------------------------------- catwalk, walkway, gangway
class CatwalkParams(_P):
    panel_m: float = Field(3.5, gt=0.5, le=10, description="truss panel length")
    chord_m: float = Field(0.2, gt=0.05, le=1)
    grating_m: float = Field(0.08, gt=0.01, le=0.5)
    handrail: bool = True
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)


CATWALK_DOC = (
    "Steel truss catwalk spanning between structures (dolphins, platforms): two side trusses (chords, "
    "verticals, diagonals), cross beams, grating deck on top, handrails both sides. Footprint: line "
    "(centreline + walkway width). base_el = truss bottom chord; top_el = walking level (truss depth "
    "= top_el - base_el, default 1.5 m)."
)


@builder("catwalk", family="structure", params=CatwalkParams, doc=CATWALK_DOC, default_height_m=1.5)
def build_catwalk(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = CatwalkParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 1.5)
    h = top_el - base
    ring = k.outline(item, ctx)
    nodes = [MeshNode("deck", "Grating", k.slab(ring, h - p.grating_m, h))]
    chords, diag, verts, cross, rails = [], [], [], [], []
    yt, yb = h - p.grating_m - p.chord_m / 2, p.chord_m / 2
    for run in k.runs(item, ctx):
        ts = k.stations(run.length, p.panel_m)
        for s in (-run.width / 2 + p.chord_m / 2, run.width / 2 - p.chord_m / 2):
            for y in (yt, yb):
                chords.append(k.member(k.xz(run.at(0, s), y), k.xz(run.at(run.length, s), y), p.chord_m))
            verts += [(k.xz(run.at(t, s), yb), run.u) for t in ts]
            for i, (t0, t1) in enumerate(zip(ts[:-1], ts[1:], strict=True)):
                a, b = (yb, yt) if i % 2 == 0 else (yt, yb)
                diag.append(k.member(k.xz(run.at(t0, s), a), k.xz(run.at(t1, s), b), p.chord_m * 0.6))
        for t in ts:
            cross.append(
                k.member(
                    k.xz(run.at(t, -run.width / 2), yt), k.xz(run.at(t, run.width / 2), yt), p.chord_m * 0.8
                )
            )
        if p.handrail:
            for s in (-run.width / 2 + 0.05, run.width / 2 - 0.05):
                rails += k.handrail(
                    np.array([run.at(0, s), run.at(run.length, s)]),
                    h,
                    height=RAIL_H,
                    spacing=p.post_spacing_m,
                    closed=False,
                    lod=ctx.lod,
                )
    vert = k.column_mesh(max(yt - yb, 0.05), p.chord_m * 0.6)
    nodes += [
        MeshNode("chords", "Steel_Structure", k.merge(chords + cross)),
        MeshNode(
            "verticals",
            "Steel_Structure",
            Instanced(vert, np.concatenate([k.posed(q[None], u) for q, u in verts])),
        ),
        MeshNode("diagonals", "Steel_Structure", k.merge(diag)),
    ]
    nodes += _merge_rails(rails)
    return _stamp(nodes, p, dflt)


class WalkwayParams(_P):
    deck_thickness_m: float = Field(0.05, gt=0.01, le=0.5)
    panel_m: float = Field(6.0, gt=0.5, le=20, description="grating panel length along the walkway")
    handrail: bool = False
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)


WALKWAY_DOC = (
    "Grating walkway at grade or on a roof: grating panels on two bearers, optional handrails. "
    "Footprint: line (centreline + width), rect or polygon. base_el = the surface it stands on; top_el = "
    "walking level (default 0.3 m above)."
)


@builder("walkway", family="structure", params=WalkwayParams, doc=WALKWAY_DOC, default_height_m=0.3)
def build_walkway(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = WalkwayParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 0.3)
    h = top_el - base
    ring = k.outline(item, ctx)
    poly = Polygon(ring)
    y0 = max(h - p.deck_thickness_m, 0.0)
    panels, stools, rails = [], [], []
    for run in k.runs(item, ctx):
        ts = k.stations(run.length, p.panel_m)
        for t0, t1 in zip(ts[:-1], ts[1:], strict=True):
            strip = Polygon(
                [
                    run.at(t0 + 0.025, -run.width),
                    run.at(t1 - 0.025, -run.width),
                    run.at(t1 - 0.025, run.width),
                    run.at(t0 + 0.025, run.width),
                ]
            )
            piece = poly.intersection(strip)
            for g in getattr(piece, "geoms", [piece]):
                if isinstance(g, Polygon) and g.area > 0.01:
                    panels.append(
                        k.slab(np.asarray(g.exterior.coords)[:-1], y0, max(h, y0 + p.deck_thickness_m))
                    )
        if y0 > 0.02:
            for s in (-run.width / 2 + 0.15, run.width / 2 - 0.15):
                stools.append(
                    k.member(k.xz(run.at(0, s), y0 / 2), k.xz(run.at(run.length, s), y0 / 2), 0.1, y0)
                )
        if p.handrail:
            for s in (-run.width / 2 + 0.05, run.width / 2 - 0.05):
                rails += k.handrail(
                    np.array([run.at(0, s), run.at(run.length, s)]),
                    h,
                    height=RAIL_H,
                    spacing=p.post_spacing_m,
                    closed=False,
                    lod=ctx.lod,
                )
    if not panels:
        panels = [k.slab(ring, y0, max(h, y0 + p.deck_thickness_m))]
    nodes = [MeshNode("deck", "Grating", k.merge(panels))]
    if stools:
        nodes.append(MeshNode("bearers", "Steel_Structure", k.merge(stools)))
    nodes += _merge_rails(rails)
    return _stamp(nodes, p, dflt)


class GangwayParams(_P):
    tower_size_m: float = Field(1.8, gt=0.5, le=6)
    boom_width_m: float = Field(1.0, gt=0.4, le=3)
    boom_slope_deg: float = Field(15.0, ge=0, le=45)
    rung_spacing_m: float = Field(0.5, gt=0.2, le=2)
    counterweight: bool = True


GANGWAY_DOC = (
    "Shore gangway / gangway tower: braced steel tower with a top platform at the footprint's start, a "
    "boom (stringers, treads, handrails) sloping down along the footprint, a counterweight. Footprint: "
    "rect (along = boom direction, tower at the low-along end) or line (tower at the first point). "
    "base_el = deck the tower stands on; top_el = tower top platform."
)


@builder("gangway", family="structure", params=GangwayParams, doc=GANGWAY_DOC, default_height_m=6.0)
def build_gangway(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = GangwayParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 6.0)
    h = top_el - base
    run = k.runs(item, ctx)[0]
    ts = min(p.tower_size_m, run.length / 3, run.width)
    c = 0.2
    corners = [run.at(t, s) for t in (c / 2, ts - c / 2) for s in (-ts / 2 + c / 2, ts / 2 - c / 2)]
    nodes = [
        MeshNode(
            "tower_columns",
            "Steel_Structure",
            Instanced(k.column_mesh(h, c), k.posed(np.array([k.xz(q, 0.0) for q in corners]), run.u)),
        )
    ]
    braces = []
    order = [0, 1, 3, 2, 0]
    n_pan = max(1, round(h / 3))
    for a, b in zip(order[:-1], order[1:], strict=True):
        for j in range(n_pan):
            y0, y1 = h * j / n_pan, h * (j + 1) / n_pan
            pa, pb = (corners[a], corners[b]) if j % 2 == 0 else (corners[b], corners[a])
            braces.append(k.member(k.xz(pa, max(y0, FOOT)), k.xz(pb, y1), 0.1))
    nodes.append(MeshNode("tower_bracing", "Steel_Structure", k.merge(braces)))
    top_ring = np.array([run.at(0, -ts / 2), run.at(ts, -ts / 2), run.at(ts, ts / 2), run.at(0, ts / 2)])
    nodes.append(MeshNode("tower_platform", "Grating", k.slab(top_ring, h - 0.05, h)))
    nodes += k.handrail(top_ring, h, height=RAIL_H, spacing=2.5, closed=True, lod=ctx.lod)
    span = max(run.length - ts, 0.5)
    drop = min(span * math.tan(math.radians(p.boom_slope_deg)), max(h - 0.5, 0.0))
    t0, t1 = ts, ts + span
    y0, y1 = h, h - drop
    bw = p.boom_width_m
    boom = []
    for s in (-bw / 2, bw / 2):
        boom.append(k.member(k.xz(run.at(t0, s), y0 - 0.15), k.xz(run.at(t1, s), y1 - 0.15), 0.12, 0.3))
        boom.append(k.member(k.xz(run.at(t0, s), y0 + RAIL_H), k.xz(run.at(t1, s), y1 + RAIL_H), 0.05))
        for t in k.stations(span, 2.5):
            yy = y0 + (y1 - y0) * t / span
            boom.append(k.member(k.xz(run.at(t0 + t, s), yy), k.xz(run.at(t0 + t, s), yy + RAIL_H), 0.05))
    nodes.append(MeshNode("boom", "Steel_Structure", k.merge(boom)))
    n_r = max(2, int(span / p.rung_spacing_m))
    tr = [k.xz(run.at(t0 + span * (i + 0.5) / n_r), y0 + (y1 - y0) * (i + 0.5) / n_r) for i in range(n_r)]
    rung = k.block((0.25, 0.04, bw))
    nodes.append(MeshNode("treads", "Grating", Instanced(rung, k.posed(np.array(tr), run.u))))
    if p.counterweight:
        cw = k.placed_block(k.xz(run.at(ts * 0.25), h + 0.5), (ts * 0.4, 1.0, ts * 0.8), run.u)
        nodes.append(MeshNode("counterweight", "Steel_Dark", cw))
    return _stamp(nodes, p, dflt)
```

- [ ] **Step 5: Run the tests**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: `96 passed`.

- [ ] **Step 6: Lint and commit**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/structure.py tests/test_builders_structure.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/structure.py tests/test_builders_structure.py
```
Expected: `All checks passed!`.

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git add backend/app/asset_models/builders/structure.py
git add backend/tests/test_builders_structure.py
git commit -m "feat(builders): catwalk, walkway and gangway structure builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Platforms: `platform`, `stair_tower`

**Files:**
- Modify: `backend/app/asset_models/builders/structure.py` (append the platforms section)
- Modify: `backend/tests/test_builders_structure.py` (the platforms `SPECS` entries and tests)

**Interfaces:**
- Consumes: `_P`, `_stamp`, `_levels`, `_merge_rails`, `RAIL_H`, `FOOT` (Task 3); the kit (`grid_rows`, `perimeter_points`, `posed`, `block`).
- Produces: `PlatformParams`, `StairTowerParams`; registered `platform`, `stair_tower`. With this task all 11 types are registered.

- [ ] **Step 1: Add the platforms cases**

In `backend/tests/test_builders_structure.py`, insert directly after the line `# -- platforms (task 6)`:
```python
SPECS["platform"] = TypeSpec(
    rect(8, 6), 100.0, 104.0, rect(8, 6),
    {"deck", "columns", "beams", "bracing", "stair", "stair_treads", "handrail_posts", "handrail_rails"},
    pad_xz=1.1,
)  # fmt: skip
SPECS["stair_tower"] = TypeSpec(
    rect(6, 3), 100.0, 112.0, rect(6, 3),
    {"base_slab", "columns", "landings", "stringers", "treads", "handrail_posts", "handrail_rails"},
    pad_xz=0.35,
)  # fmt: skip
```

- [ ] **Step 2: Append the platforms tests**

Append to the end of `backend/tests/test_builders_structure.py`:
```python
# ---------------------------------------------------------------- platforms (task 6)
def test_platform_columns_deck_per_level_and_stair():
    nodes = build(case("platform"))
    assert instances(nodes, "columns") == 4
    deck = node(build(case("platform", levels=[102.0])), "deck").geometry
    assert {2.0, 4.0} <= {round(float(y), 3) for y in deck.vertices[:, 1]}
    treads = node(nodes, "stair_treads").geometry.transforms
    assert treads[:, 2, 3].max() < -3.0  # the stair stands outside the west (left) edge of the 6 m deck
    assert treads[:, 1, 3].max() == pytest.approx(4.0)
    assert "stair" not in {n.name for n in build(case("platform", params={"stair": False}))}


def test_circle_platform_gets_perimeter_columns():
    it = item("platform", {"kind": "circle", "center": [0, 0], "d": 8}, 100.0, 106.0)
    assert instances(build(it), "columns") >= 3


def test_stair_tower_flights_and_landings():
    nodes = build(case("stair_tower"))
    assert instances(nodes, "columns") == 4
    assert instances(nodes, "landings") == 4  # 12 m at <= 3.6 m per flight
    ys = sorted(node(nodes, "landings").geometry.transforms[:, 1, 3])
    assert ys == pytest.approx([2.975, 5.975, 8.975, 11.975])
    assert instances(build(case("stair_tower", levels=[104.0, 108.0])), "landings") == 3
```

- [ ] **Step 3: Run them to see them fail**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: failures with `KeyError: 'platform'` and `KeyError: 'stair_tower'`. The 96 earlier tests pass.

- [ ] **Step 4: Append the platforms builders**

Append to the end of `backend/app/asset_models/builders/structure.py`:
```python
# ---------------------------------------------------------------- platform, stair tower
class PlatformParams(_P):
    grating_m: float = Field(0.05, gt=0.01, le=0.5)
    beam_depth_m: float = Field(0.3, gt=0.05, le=2)
    column_spacing_m: float = Field(8.0, gt=1, le=30)
    column_section_m: float = Field(0.3, gt=0.05, le=2)
    bracing: bool = True
    handrail: bool = True
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)
    stair: bool = Field(True, description="a stair flight to grade outside the stair_side edge")
    stair_side: Literal["left", "right"] = "left"


PLATFORM_DOC = (
    "Elevated steel access platform (equipment, valve, manifold or tank-roof platform): grating deck at "
    "each level, edge beams, columns on a grid clipped to the outline, end-bay bracing, perimeter "
    "handrail, and a stair flight to the base outside one long edge. Footprint: polygon, rect or circle. "
    "base_el = what it stands on (grade, or a tank roof); top_el = top deck; levels = intermediate decks."
)


@builder("platform", family="structure", params=PlatformParams, doc=PLATFORM_DOC, default_height_m=4.0)
def build_platform(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = PlatformParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 4.0)
    h = top_el - base
    ring = k.outline(item, ctx)
    run = k.runs(item, ctx)[0] if item.footprint.kind == "rect" else k.rect_run(ring)
    decks = _levels(item, base, h)
    if not decks or abs(decks[-1] - h) > 1e-6:
        decks = sorted(set(decks) | {h})
    inner = np.asarray(Polygon(ring).buffer(-p.column_section_m / 2, join_style=2).exterior.coords)[:-1]
    grat, beams, rails = [], [], []
    for y in decks:
        grat.append(k.slab(ring, y - p.grating_m, y))
        ring_c = np.vstack([inner, inner[:1]])
        for a, b in zip(ring_c[:-1], ring_c[1:], strict=True):
            beams.append(
                k.member(
                    k.xz(a, y - p.grating_m - p.beam_depth_m / 2),
                    k.xz(b, y - p.grating_m - p.beam_depth_m / 2),
                    0.2,
                    p.beam_depth_m,
                )
            )
        if p.handrail:
            rails += k.handrail(
                np.asarray(Polygon(ring).buffer(-0.05, join_style=2).exterior.coords)[:-1],
                y,
                height=RAIL_H,
                spacing=p.post_spacing_m,
                closed=True,
                lod=ctx.lod,
            )
    rows = k.grid_rows(ring, run, p.column_spacing_m, p.column_spacing_m, p.column_section_m / 2)
    edge = k.perimeter_points(ring, p.column_spacing_m, p.column_section_m / 2)
    cols = k.dedupe(np.vstack([*rows, edge]), min(0.45 * p.column_spacing_m, 1.5))
    col_h = decks[-1] - p.grating_m
    nodes = [
        MeshNode("deck", "Grating", k.merge(grat)),
        MeshNode(
            "columns",
            "Steel_Structure",
            Instanced(
                k.column_mesh(col_h, p.column_section_m),
                k.posed(np.c_[cols[:, 0], np.zeros(len(cols)), cols[:, 1]], run.u),
            ),
        ),
        MeshNode("beams", "Steel_Structure", k.merge(beams)),
    ]
    if p.bracing:
        br = []
        for row in {0: rows[0], 1: rows[-1]}.values():
            for a, b in zip(row[:-1], row[1:], strict=True):
                br.append(k.member(k.xz(a, FOOT), k.xz(b, decks[0] - p.grating_m - p.beam_depth_m), 0.12))
        if br:
            nodes.append(MeshNode("bracing", "Steel_Structure", k.merge(br)))
    if p.stair and h >= 1.0:
        s = (-1.0 if p.stair_side == "left" else 1.0) * (run.width / 2 + 0.55)
        going = h / math.tan(math.radians(40))
        n = max(3, round(h / 0.2))
        t_bot, t_top = run.length - going, run.length
        strs = [
            k.member(k.xz(run.at(t_bot, s + q), FOOT), k.xz(run.at(t_top, s + q), h), 0.08, 0.25)
            for q in (-0.45, 0.45)
        ]
        srail = [
            k.member(k.xz(run.at(t_bot, s + q), RAIL_H), k.xz(run.at(t_top, s + q), h + RAIL_H), 0.05)
            for q in (-0.45, 0.45)
        ]
        tr = [k.xz(run.at(t_bot + going * (i + 0.5) / n, s), h * (i + 1) / n) for i in range(n)]
        nodes.append(MeshNode("stair", "Steel_Structure", k.merge(strs)))
        nodes.append(
            MeshNode(
                "stair_treads", "Grating", Instanced(k.block((0.25, 0.04, 0.9)), k.posed(np.array(tr), run.u))
            )
        )
        rails.append(MeshNode("handrail_rails", "Handrail", k.merge(srail)))
    nodes += _merge_rails(rails)
    return _stamp(nodes, p, dflt)


class StairTowerParams(_P):
    flight_rise_m: float = Field(3.6, gt=1, le=8, description="height between landings when levels is empty")
    landing_m: float = Field(1.4, gt=0.6, le=5)
    column_section_m: float = Field(0.25, gt=0.05, le=1)
    base_slab: bool = True


STAIR_DOC = (
    "Stair tower: four corner columns, switchback flights (stringers, treads, handrails) between landings, "
    "grating landings at each level, guarded top landing, concrete base slab. Footprint: rect (along = "
    "flight direction) or polygon. base_el = grade; top_el = top landing; levels = landing elevations."
)


@builder("stair_tower", family="structure", params=StairTowerParams, doc=STAIR_DOC, default_height_m=12.0)
def build_stair_tower(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = StairTowerParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 12.0)
    h = top_el - base
    ring = k.outline(item, ctx)
    run = k.runs(item, ctx)[0] if item.footprint.kind == "rect" else k.rect_run(ring)
    L, W, c = run.length, run.width, p.column_section_m
    lands = _levels(item, base, h)
    if not lands:
        n = max(1, math.ceil(h / p.flight_rise_m - 1e-9))
        lands = [h * (i + 1) / n for i in range(n)]
    if abs(lands[-1] - h) > 1e-6:
        lands = sorted(set(lands) | {h})
    ld = min(p.landing_m, L / 3)
    corners = [run.at(t, s) for t in (c / 2, L - c / 2) for s in (-W / 2 + c / 2, W / 2 - c / 2)]
    nodes = []
    if p.base_slab:
        pad = np.asarray(Polygon(ring).buffer(0.3, join_style=2).exterior.coords)[:-1]
        nodes.append(MeshNode("base_slab", "Concrete", k.slab(pad, 0.0, 0.2)))
    nodes.append(
        MeshNode(
            "columns",
            "Steel_Structure",
            Instanced(k.column_mesh(h, c), k.posed(np.array([k.xz(q, 0.0) for q in corners]), run.u)),
        )
    )
    land_xf, strs, rails, treads = [], [], [], []
    y_prev = 0.0
    for i, y in enumerate(lands):
        up = i % 2 == 0  # even flights climb +u on the left half, odd ones come back on the right half
        s = (-W / 4) if up else (W / 4)
        t_start = ld if up else L - ld
        going = min(L - 2 * ld, (y - y_prev) / math.tan(math.radians(35)))
        direction = 1.0 if up else -1.0
        rise = y - y_prev
        n = max(3, round(rise / 0.2))
        t_end = t_start + direction * going
        for q in (-W / 4 + 0.05, W / 4 - 0.05):
            strs.append(
                k.member(
                    k.xz(run.at(t_start, s + q), max(y_prev, FOOT)), k.xz(run.at(t_end, s + q), y), 0.08, 0.25
                )
            )
        q_out = -W / 4 + 0.05 if up else W / 4 - 0.05
        rails.append(
            k.member(
                k.xz(run.at(t_start, s + q_out), y_prev + RAIL_H),
                k.xz(run.at(t_end, s + q_out), y + RAIL_H),
                0.05,
            )
        )
        treads += [
            k.xz(run.at(t_start + direction * going * (j + 0.5) / n, s), y_prev + rise * (j + 1) / n)
            for j in range(n)
        ]
        t_land = L - ld / 2 if up else ld / 2
        land_xf.append(k.posed(k.xz(run.at(t_land), y - 0.025)[None], run.u)[0])
        y_prev = y
    nodes.append(MeshNode("landings", "Grating", Instanced(k.block((ld, 0.05, W - 0.1)), np.array(land_xf))))
    nodes.append(MeshNode("stringers", "Steel_Structure", k.merge(strs)))
    nodes.append(
        MeshNode(
            "treads",
            "Grating",
            Instanced(k.block((0.25, 0.04, W / 2 - 0.2)), k.posed(np.array(treads), run.u)),
        )
    )
    top = np.asarray(Polygon(ring).buffer(-0.05, join_style=2).exterior.coords)[:-1]
    guard = k.handrail(top, h, height=RAIL_H, spacing=2.5, closed=True, lod=ctx.lod)
    guard.append(MeshNode("handrail_rails", "Handrail", k.merge(rails)))
    nodes += _merge_rails(guard)
    return _stamp(nodes, p, dflt)
```

- [ ] **Step 5: Run the tests**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected: `115 passed`.

- [ ] **Step 6: Lint and commit**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/builders/structure.py tests/test_builders_structure.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/builders/structure.py tests/test_builders_structure.py
```
Expected: `All checks passed!`.

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git add backend/app/asset_models/builders/structure.py
git add backend/tests/test_builders_structure.py
git commit -m "feat(builders): platform and stair tower structure builders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Catalogue completeness, Cowork realism, family budget, golden renders

**Files:**
- Modify: `backend/tests/test_builders_structure.py` (imports, constants, realism and golden tests)
- Create: `backend/tests/data/plant/structure_golden/<type>.png` (11 files)

**Interfaces:**
- Consumes: all 11 builders; `catalogue()` (F0); `raster.render`, `raster.View` (M1); `structure.json` (Task 1).
- Produces: the committed goldens. Nothing new for other units.

- [ ] **Step 1: Extend the imports**

In `backend/tests/test_builders_structure.py`, make these replacements, each exactly once:
- `import math` + `import time` (two lines) → four lines: `import json`, `import math`, `import os`, `import time`;
- `from dataclasses import dataclass` → that line, then `from pathlib import Path`;
- `import trimesh` → that line, then `from PIL import Image`, then `from shapely.geometry import Point, Polygon`;
- `from app.asset_models.builders import REGISTRY, build_item, load_all` → `from app.asset_models.builders import REGISTRY, build_item, catalogue, load_all`;
- `from app.asset_models.builders.palette import PALETTE` → that line, then `from app.asset_models.raster import View, render`.

- [ ] **Step 2: Add the constants**

In `backend/tests/test_builders_structure.py`, insert directly after the line `load_all()` and the blank line that follows it:
```python
DATA = Path(__file__).parent / "data" / "plant"
GOLDEN = DATA / "structure_golden"
REF = json.loads((DATA / "cowork_nodes" / "structure.json").read_text(encoding="utf-8"))
REGEN = os.environ.get("KESTREL_REGEN_GOLDEN") == "1"
ALL_TYPES = {
    "trestle", "jetty_platform", "dolphin", "pipe_rack", "pipe_sleeper", "catwalk",
    "walkway", "stair_tower", "overbridge", "platform", "gangway",
}  # fmt: skip
```

- [ ] **Step 3: Append the realism and golden tests**

Append to the end of `backend/tests/test_builders_structure.py`:
```python
# ---------------------------------------------------------------- catalogue and realism (task 7)
def test_all_eleven_structure_types_are_registered():
    assert {t for t, d in REGISTRY.items() if d.family == "structure"} == ALL_TYPES == set(SPECS)
    for t in ALL_TYPES:
        assert len(REGISTRY[t].doc) >= 120, t
        assert REGISTRY[t].default_height_m > 0, t


def test_catalogue_publishes_structure_schemas():
    rows = {r["type"]: r for r in catalogue() if r["family"] == "structure"}
    assert set(rows) == ALL_TYPES
    assert "bay_spacing_m" in rows["trestle"]["params_schema"]["properties"]
    assert "lines" in rows["pipe_rack"]["params_schema"]["properties"]


def ref_item(n) -> Item:
    return item(n["type"], n["footprint"], n["base_el"], n["top_el"], levels=n["levels"])


@pytest.mark.parametrize("ref", REF["nodes"], ids=lambda n: n["node"])
def test_triangles_in_range_of_the_cowork_node(ref):
    it = ref_item(ref)
    nodes = build(it)
    tris, cw = k.triangles(nodes), ref["triangles"]
    assert 0.35 * cw <= tris <= max(3.0 * cw, cw + 600), (tris, cw)
    assert SPECS[ref["type"]].required <= {n.name for n in nodes}
    outline = Polygon(footprint_local(it)).buffer(0.01)  # Cowork's notched, many-sided outlines
    for name in ("piles", "columns"):
        for hit in (n for n in nodes if n.name == name):
            assert all(outline.contains(Point(p)) for p in hit.geometry.transforms[:, [0, 2], 3]), name


def test_structure_family_stays_inside_the_triangle_budget():
    ratios: dict[str, list[float]] = {}
    for ref in REF["nodes"]:
        ratios.setdefault(ref["type"], []).append(k.triangles(build(ref_item(ref))) / ref["triangles"])
    est = sum(REF["per_type"][t]["triangles"] * float(np.mean(r)) for t, r in ratios.items())
    cowork = sum(v["triangles"] for v in REF["per_type"].values())
    assert est <= 1.2 * cowork, (est, cowork)  # spec §7: plant <= 1.5 x Cowork; structures keep headroom


@pytest.mark.parametrize("type_", sorted(ALL_TYPES))
def test_matches_golden_render(type_):
    img = render(expand(build(case(type_))), View("iso"), size=256)
    path = GOLDEN / f"{type_}.png"
    if REGEN:
        GOLDEN.mkdir(parents=True, exist_ok=True)
        img.save(path)
    golden = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    diff = np.abs(np.asarray(img, dtype=np.int16) - golden)
    assert (diff > 40).mean() < 0.01  # under 1 % of pixels differ visibly
```

- [ ] **Step 4: Run them**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q
```
Expected:
- every test except `test_matches_golden_render[*]` passes (137 passed);
- the 11 golden tests fail with `FileNotFoundError: ... structure_golden\<type>.png`, because the goldens do not exist yet.

If a `test_triangles_in_range_of_the_cowork_node` case fails, F0's `segments_for` or `cyl` differs from the prototype stubs. Report the numbers. Do not widen the range: change `k.MIN_SEG` or the pile segment count in `structure_kit.segs` instead, and log it in the ledger.

- [ ] **Step 5: Generate the goldens on the real F0 code**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
$env:KESTREL_REGEN_GOLDEN = "1"
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py -q -k golden
Remove-Item Env:KESTREL_REGEN_GOLDEN
```
Expected: `11 passed`, and `tests/data/plant/structure_golden/` holds 11 PNGs.

- [ ] **Step 6: Review every golden by eye before committing**

Open each PNG with the Read tool. A golden that shows something wrong is a builder bug: fix the builder and regenerate. These must be visible:
- **trestle:** a deck slab on a row of pile bents, diagonal bracing under it, rails along both long edges, a band of pipes on sleepers along one side;
- **jetty_platform:** a thick rectangular deck on a pile grid, a rail round the edge;
- **dolphin:** a square cap on 9 piles, a fender panel on one face, a bollard on top;
- **pipe_rack:** two lines of columns, cross beams at 2 tiers, X-bracing in the two end bays, pipes along both tiers;
- **overbridge:** 4 columns as two portals, knee braces, pipes along the 9 m span;
- **pipe_sleeper:** low concrete sleepers across the band, pipes along it;
- **catwalk:** two side trusses with diagonals, a grating deck, rails on both sides;
- **walkway:** a thin grating strip (4 panels) on two bearers;
- **gangway:** a braced tower at one end with a railed top, a boom with rungs and rails sloping away, a counterweight block;
- **platform:** a grating deck on 4 columns, a rail round it, end bracing, a stair flight outside one long edge;
- **stair_tower:** 4 tall columns, switchback flights, 4 landings, a railed top, a base slab.

- [ ] **Step 7: Run the whole structure suite without regeneration**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_builders_structure.py tests/test_builders_structure_kit.py tests/test_builders_structure_f0.py -q
```
Expected: `176 passed`.

- [ ] **Step 8: Lint and commit**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1\backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format tests/test_builders_structure.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check tests/test_builders_structure.py
```
Expected: `All checks passed!`.

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
git check-ignore -v backend/tests/data/plant/structure_golden   # must print nothing
git add backend/tests/test_builders_structure.py
git add backend/tests/data/plant/structure_golden
git commit -m "test(builders): structure realism vs Cowork, family budget, golden renders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
If `git check-ignore` prints a rule, a `.gitignore` line (for example K1's rule for the Cowork GLB) is too wide. Do not force-add. Report it, so the rule's owner narrows it to `*.glb`.

---

### Task 8: Full gate and walkthrough

**Files:**
- Modify: `.superpowers/sdd/pm-b1/ledger.md` (gate evidence, walkthrough line; not committed to the product tree unless the coordinator asks)

**Interfaces:**
- Consumes: everything above.
- Produces: READY_TO_MERGE evidence for the coordinator.

- [ ] **Step 1: Run the gate (AGENTS.md item 4), on the B1 e2e ports**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pm-b1
pnpm -C contract check
cd backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest
cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT = "14231"; $env:E2E_MOCK_PORT = "14031"
pnpm -C frontend e2e
Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
if (Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```
Expected:
- every command exits 0;
- `pytest` reports no failures, and the B1 files account for 176 of the passes;
- `cargo test` runs only if the frozen sidecar exists, otherwise it is skipped (not failed).

If a non-B1 test fails, check whether it also fails on `main` before blaming B1 (the merge base is shared). Record the result in the ledger.

- [ ] **Step 2: Check the shared-file promise**

```powershell
git diff --stat main...HEAD
```
Expected: only these paths:
- `backend/app/asset_models/builders/structure.py` and `structure_kit.py`;
- the three `backend/tests/test_builders_structure*.py` files;
- `backend/tests/data/plant/cowork_nodes/structure.json`;
- `backend/tests/data/plant/structure_golden/*.png` (11).

Nothing else.

- [ ] **Step 3: Write the walkthrough line**

Add to the ledger, for the operator:

> **Not user-observable on its own.** B1 adds the 11 structure builders. The operator sees them once A1's GLB job and the Site 3D view (S1) are merged: a plant model with trestles, jetty heads, dolphins, racks, sleepers, catwalks, walkways, stair towers, overbridges, platforms and gangways. Each is drawn with piles, bracing, handrails and instanced pipes instead of grey boxes. To look now: open the 11 renders in `backend/tests/data/plant/structure_golden/`.

- [ ] **Step 4: Report READY_TO_MERGE**

Report to the coordinator:
- the branch `task/pm-b1` and its head SHA;
- the gate results;
- the F0-alignment notes from Task 1;
- any ruling added.

Do not merge, push, build an installer or run `/wrapup`.
