# Plant model A1: assembler (GLB, register CSV, item index, items routes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a plant `AssetSpec` (site, items, environment, M1 parts) into a GLB with a site → area → item → child node tree whose item extras are the register rows, plus the Cowork-order register CSV, the `asset_item` index and the three read routes over them, all inside the `asset_model_glb` background job.

**Architecture:**
- A new pure module `glbwriter.py` writes glTF 2.0 binary directly (node tree, extras, one mesh per node, the palette materials, `EXT_mesh_gpu_instancing`). trimesh's exporter writes neither per-node extras nor instancing, so M1's "export then patch the JSON chunk" trick would have to rewrite the BIN chunk too; writing the file ourselves is smaller and deterministic. M1's `build_glb` keeps trimesh.
- A new `assemble.py` builds every item through F0's `build_item`, places it at its footprint reference point in the D9 scene frame, writes the environment and M1 top-level parts, computes the register rows, and writes the CSV and the index.
- `jobs_glb.run_glb` dispatches plant specs (items or environment) to the assembler and M1 specs to `build_glb`. It runs the full `validate()` in the job, writes `v<n>.glb`, `v<n>.csv` and `v<n>.meta.json` atomically, indexes the items, and fills P1's `asset_model.frame` when it is null.
- A new `items.py` router replaces F0's 501 stubs for `listAssetModelItems`, `getAssetModelItem` and `getAssetModelCsv`.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2 (per-project SQLite), numpy, scipy (`Rotation`), trimesh 4.12, pyproj (through F0's `PlantGrid`), psutil (already used by the app, for the budget probe), pytest. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§5, §6, §7, §9, §10, §12, §13, §15). Index: `docs/superpowers/plans/2026-10-03-plant-model.md` (Global Constraints and Binding interfaces are law).

**Unit:** A1. Worktree `.claude/worktrees/pm-a1`, branch `task/pm-a1`. Cut from `main` after F0 has merged (F0 is itself cut after P1's migration 0016). Merge position: batch 2, any order among B1, B2, B3, I1, C1, S1 and K1; A1 must merge before S3 (S3's e2e reads the items and CSV routes).

**Commands.** Every backend command runs from `E:\Dev\Yolo\app\.claude\worktrees\pm-a1\backend` with the shared interpreter `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` (written `PY` below; in PowerShell: `$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"`, then `& $PY -m pytest ...`). Never install anything into that venv.

## Global Constraints

Copied from the index; every task's requirements include them.

- `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit. **F0 owns the contract**: A1 edits it only to fix a defect, which is logged under Rulings and handed off.
- Path parameter names match the contract literally: `projectId`, `assetModelId`, `version`, `itemId`.
- Every contract operation is routed (`backend/tests/test_contract.py`). Until A1 lands, its operations are 501 stubs in `app/asset_models/stubs_plant.py`; A1 deletes its stub lines.
- Migration 0017 is F0's and additive only. A1 adds no migration.
- **`asset_model.frame` (P1's column)** is written only by A1, only when it is null, and only through P1's `app.asset_review.frame.Frame`. Never write `silhouette`, `levels` or `presets`.
- Versions are never overwritten or deleted except with their asset model.
- Logs carry tool names, states, durations and counts only.
- **Background jobs:** `asset_model_glb` (GLB + CSV + index). No route blocks on mesh generation or on validation over 200 items.
- **Bounded reads:** items list ≤ 500 rows per page.
- Scene/GLB frame: metres, `x = plant_N`, `y = EL - datum.el_m`, `z = plant_E` (Y up, X plant north, Z plant east). Spec item coordinates are plant metres. M1 part params stay in millimetres.
- Site CRS from plant: `[X, Y] = origin_crs + R(plant_north_deg) · [E, N]`, `R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]]`.
- A builder never raises to the assembler: `build_item` catches and falls back to `other` with a `builder_fallback` flag. Builders are pure.
- **No meshopt compression in G1** (spec §15): GLBs are uncompressed; instancing is the size lever.
- CSV: Cowork's 17 columns in their order, plus `flags` and `confidence`; `utm39_*` are named `site_E`/`site_N` when the site CRS is not UTM-39 (EPSG:32639).
- Budget: a 2 000-item plant builds in under 2 minutes and under 1.5 GB of RAM.
- Stage files by path; never `git add -A`; never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identity "Danijel Jovanovic" / info@synapse-solutions.ai (pinned in the worktree).

## Review Focus

1. **A 2 000+ item register with one item whose params break its builder** (a NaN, a zero-length line, a self-intersecting polygon). The GLB still builds; the broken item's geometry is `other` (or a marker) with a `builder_fallback` flag; the validator reports the polygon; the CSV and the index still contain every item. Owner Task 6: `test_assemble_survives_broken_item` (index Review Focus #4).
2. **A builder that returns NaN vertices or numpy values in its extras.** That node is dropped, the item falls back to a marker with a flag, and the extras are cleaned rather than breaking the JSON chunk of the whole GLB. Owner Task 4: `test_non_finite_builder_output_becomes_marker`, `test_numpy_extras_are_cleaned`.
3. **The operator cancels a long GLB build.** The version is marked failed, no `.tmp` file is left, no index rows are written, and the cancel propagates as a cancel (not a failure). Owner Task 6: `test_cancel_mid_build_marks_failed_and_leaves_no_tmp`.
4. **Names that Excel would run, or that hold commas and quotes** (`=HYPERLINK(...)`, `CONTROL BUILDING, "MAIN"`). The CSV stays one row per item and never starts a cell with a formula character. Owner Task 3: `test_formula_like_text_is_neutralised`, `test_quotes_and_commas_round_trip`.
5. **A model whose frame the operator or a GLB import already set.** A plant build never overwrites it, and a frame-fill failure never fails the build. Owner Task 7: `test_existing_frame_is_left_alone`, `test_frame_failure_never_fails_the_build`.

## Interfaces provided

```python
# backend/app/asset_models/glbwriter.py  (new)
INSTANCING = "EXT_mesh_gpu_instancing"
def trs(transforms: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]   # (N,4,4) -> t (N,3), q xyzw (N,4), s (N,3), float32
class GlbWriter:
    def __init__(self, materials: list[dict]) -> None
    triangles: int; instanced_nodes: int; instances: int
    node_count: int  # property
    def add_mesh(self, mesh: trimesh.Trimesh, material: int) -> int | None      # None: empty or non-finite
    def add_node(self, name: str, *, parent: int | None = None, translation: Sequence[float] | None = None,
                 extras: dict | None = None, mesh: int | None = None, instances: np.ndarray | None = None) -> int
    def set_extras(self, node: int, extras: dict) -> None
    def to_glb(self) -> bytes

# backend/app/asset_models/assemble.py  (new; binding names from the index, plus additive keyword-only args)
CSV_COLUMNS: list[str]   # exactly the index's list
class AssembleError(Exception)
@dataclass
class Assembly: glb: bytes; meta: dict; rows: list[dict]
def assemble(spec: AssetSpec, *, lod: float = 1.0, progress: Callable[[float], None] | None = None,
             sheet_names: dict[str, str] | None = None, invalid: dict[str, str] | None = None) -> Assembly
def assemble_glb(spec, *, lod=1.0, progress=None, sheet_names=None, invalid=None) -> tuple[bytes, dict]
    # meta: bounds_m, top_m, triangles, node_count, items, environment, env_skipped, fallback_count,
    #       fallbacks (≤200 ids), markers (≤200 ids), instanced {nodes, instances}, parts
def register_rows(spec, sheet_names=None, *, extra_flags: dict[str, list[ItemFlag]] | None = None,
                  markers: set[str] | None = None) -> list[dict]
    # keys: CSV_COLUMNS (typed: floats/None, has_geometry bool, flags list[dict]) + lon, lat
def write_csv(rows: list[dict], path: Path, *, site_label: str = "utm39") -> None
def index_items(s: Session, model_id: str, version: int, rows: list[dict]) -> int
def site_label(spec) -> str          # "utm39" iff site.crs.epsg == 32639, else "site"
def group_name(area: str | None) -> str   # "Area_<area>" ("Area_..." kept), "Area_unassigned"
def item_ref(item: Item) -> tuple[float, float]           # plant (E, N), finite
def env_ref(feature: EnvFeature) -> tuple[float, float]   # plant (E, N), finite
def palette_materials() -> tuple[list[dict], dict[str, int]]
def site_extras(spec) -> dict

# backend/app/asset_models/jobs_glb.py  (extended)
def run_glb(ctx) -> dict            # dispatch; writes v<n>.glb / v<n>.csv / v<n>.meta.json; index; frame fill
def issue_item_id(issue) -> str | None
def invalid_items(report, spec) -> dict[str, str]     # item id -> first error message

# backend/app/asset_models/store.py  (extended)
def version_csv_path(handle, model_id: str, version: int) -> Path    # <model_dir>/v<n>.csv
def version_meta_path(handle, model_id: str, version: int) -> Path   # <model_dir>/v<n>.meta.json

# backend/app/asset_models/plant_frame.py  (new)
def plant_frame(spec: AssetSpec, meta: dict) -> dict | None   # a Frame dump, or None (no site / no P1)
def fill_frame(s: Session, model_id: str, spec: AssetSpec, meta: dict) -> bool   # never raises

# backend/app/asset_models/items.py  (new router)
# GET .../asset-models/{assetModelId}/versions/{version}/items          listAssetModelItems
# GET .../asset-models/{assetModelId}/versions/{version}/items/{itemId} getAssetModelItem
# GET .../asset-models/{assetModelId}/versions/{version}/csv            getAssetModelCsv

# backend/tests/plant_fixture.py  (new; for A1, S1 and S3)
SITE: dict; fixture_plant_spec() -> dict; synthetic_plant(n: int = 2000, *, types: Sequence[str] | None = None) -> dict
write_fixture() -> Path; build_fixture(out_dir: Path) -> tuple[Path, Path]
# backend/tests/data/plant/fixture_plant_spec.json  (58 items, all 46 types + composite, 3 env features)
```

**GLB conventions S1/S2/S3 rely on:** the scene has one root node (name = `spec.asset.name` or `plant`) whose extras carry the site (`crs`, `origin_crs`, `plant_north_deg`, `datum`, `cloud_z_to_el`, `frame`, `site_from_plant`). Its children are the area groups (`Area_<area>`), then `environment`, then M1 top-level parts. Item nodes are named by item id, carry the register row as extras and have only a translation. Their children are named `<item id>/<builder node name>`. Environment feature nodes are named by feature id with extras `{id, kind, el, confidence}`.

## Interfaces consumed

| From | Name | Where it is used |
| --- | --- | --- |
| F0 `app/asset_models/spec.py` | `AssetSpec.site/items/environment`, `Item`, `ItemFlag`, `EnvFeature`, `PolygonFootprint`, `SiteFrame` (`crs.epsg`, `origin_crs`, `plant_north_deg`, `datum.label/el_m`, `cloud_z_to_el.offset_m`) | Tasks 3, 4, 7 |
| F0 `app/asset_models/siteframe.py` | `PlantGrid(frame)`, `.plant_to_site`, `.site_to_lonlat`, `.plant_to_scene`, `.convergence_deg`, `footprint_ref`, `GridError` | Tasks 3, 4, 7 |
| F0 `app/asset_models/builders/` | `REGISTRY`, `BuildCtx(grid, lod)`, `.height(item, default_m) -> (base, top, defaulted)`, `MeshNode`, `Instanced`, `build_item`, `load_all`, `BuilderDef.default_height_m` | Tasks 3, 4 |
| F0 `builders/palette.py`, `builders/geom.py` | `PALETTE`, `geom.extrude(poly2d, h)` | Task 4 |
| F0 `app/asset_models/validate.py` | `validate(spec) -> Report` with item-level error codes (unknown type, bad params, self-intersecting footprint, duplicate id, too many items) | Task 6 |
| F0 `app/db/models.py` | `AssetItem` (table `asset_item`, columns of spec §9) | Tasks 6, 8 |
| F0 `app/asset_models/stubs_plant.py` | A1's stub tuples for the three operations | Task 8 |
| F0 contract | `AssetItemPage`, `AssetItemRow`, `AssetItem` schemas | Task 8 |
| P1 `app/asset_review/frame.py` | `Frame`, `Origin`; `AssetModel.frame` (migration 0016) | Task 7 (ImportError-guarded) |
| M1 | `build_glb`, `build_shape`, `part_transform`, `store.*`, `register_job_type`, `JobCancelled`, `JobFailure` | Tasks 4, 6 |
| B3 (optional) | `builders.environment.build_env(feature, ctx) -> list[MeshNode]` | Task 4 (ImportError-guarded; flat slab fallback) |

## Budget

- **Background job:** `asset_model_glb` does all the work: validation, assembly, CSV, meta, index and frame fill. It checks for cancel every 25 items and reports progress from 0.05 to 0.9 during assembly. No route builds meshes or validates more than 200 items.
- **Bounded reads:**
  - the items list is ≤ 500 rows per page, by keyset on `asset_item.id`;
  - `getAssetModelItem` reads one version's stored spec JSON (≤ 20 000 items; about 1.5 MB for Al-Zour) and validates only the one item;
  - the CSV is served as a file;
  - the index insert and the drawing-name lookup go in chunks of 500.
- **Memory:** the assembler holds the GLB being written (one BIN buffer) and one item's meshes at a time. The 2 000-item probe pins the peak working set under 1.5 GB (Task 5).

## Shared-file touches

| File | Anchor | Additive change |
| --- | --- | --- |
| `backend/app/asset_models/jobs_glb.py` (M1) | `def run_glb(ctx) -> dict:` | body replaced by the plant/M1 dispatch; new helpers `issue_item_id`, `invalid_items`, `_sheet_names`, `_cleanup`; M1 behaviour and messages kept |
| `backend/app/asset_models/store.py` (M1) | after `def version_glb_path` | `version_csv_path`, `version_meta_path` |
| `backend/app/asset_models/router.py` (M1) | `def get_asset_model_version` | stored warnings for specs over 200 items (only if F0 did not do it; Task 1 decides) |
| `backend/app/asset_models/service.py` (M1) | `def add_version` | request-path `validate` only for ≤ 200 items (only if F0 did not do it; Task 1 decides) |
| `backend/app/asset_models/stubs_plant.py` (F0) | A1's stub list | delete the three A1 tuples |
| `backend/app/api.py` | the router loop, the line `"app.asset_models.stubs_plant",` | insert `"app.asset_models.items",` directly above it |

## Tests

- **Added:**
  - `backend/tests/plant_helpers.py`
  - `backend/tests/plant_fixture.py`
  - `backend/tests/data/plant/fixture_plant_spec.json`
  - `backend/tests/test_asset_models_a1_seams.py`
  - `backend/tests/test_asset_models_glbwriter.py`
  - `backend/tests/test_asset_models_register.py`
  - `backend/tests/test_asset_models_assemble.py`
  - `backend/tests/test_plant_fixture.py`
  - `backend/tests/test_asset_models_assemble_perf.py`
  - `backend/tests/test_asset_models_plant_job.py`
  - `backend/tests/test_asset_models_plant_frame.py`
  - `backend/tests/test_asset_models_items_api.py`
- **Unchanged and must stay green:** `test_asset_models_glb_job.py`, `test_asset_models_api.py`, `test_asset_model_build.py`, `test_contract.py`.

## Execution DAG

```
T1 align ──┬─ T2 glbwriter ─┐
           └─ T3 rows+CSV ──┴─ T4 assembler ─┬─ T5 fixture + budget probe
                                              └─ T6 job + index + RF#4 ─┬─ T7 frame fill
                                                                        └─ T8 routes ─── T9 gate
```

- Independent units: T2 ∥ T3; T5 ∥ T6; T7 ∥ T8.
- **Critical path:** T1 → T2 → T4 → T6 → T8 → T9.
- T5's budget probe imports `invalid_items` from T6. If T5 runs before T6, the probe uses `invalid={}` and T6 adds the import (noted in T5).

## Rulings

1. **Own GLB writer.** The plant GLB is written by `glbwriter.py`, not by trimesh export plus a JSON patch. trimesh drops node extras and instancing, and patching instancing in would mean rewriting the BIN chunk. If F0 ruled a different writer, Task 1 records it and Task 2 follows F0.
2. **Shading:** `trimesh.graph.smooth_shade` with a 30° crease angle (boxes faceted, cylinders smooth). If shading fails, the writer falls back to faceted. Positions and normals are float32 in the item-local frame (small numbers, no precision loss); indices are uint32.
3. **Materials:** all 34 `PALETTE` entries are written, in `PALETTE` order. Each is `doubleSided`, with `alphaMode: BLEND` when alpha < 1. An unknown material name falls back to `Equipment_Grey`. The test pins Cowork's factors (`Concrete_Tank` = `[0.8, 0.79, 0.76, 1]`). If F0 stored linearised or sRGB-converted values, Task 1 makes `palette_materials` reproduce Cowork's GLB factors.
4. **Group names:** `Area_<area>`. An area already starting with `Area_` is kept as is. Items without an area go to `Area_unassigned`. The CSV `group` column is the group node name.
5. **Node names:**
   - item node = item id;
   - item children = `<item id>/<MeshNode.name>`;
   - root = `spec.asset.name` or `plant`;
   - environment group = `environment`, and its nodes are named by feature id;
   - M1 top-level parts = part id, under the root at the plant origin, as in M1.
6. **"Becomes `other`"** (index Review Focus #4) means the geometry. The register row keeps the declared `type`, because the scorer and the operator match on what the drawing says. The `builder_fallback` flag's note says `Built as other: <reason>`.
7. **Items with a `validate()` error** are built as `other` (params cleared) with that flag. If building still raises, or draws nothing, the item becomes a 1 m `Safety_Red` marker box with `has_geometry = no`.
8. **Fatal errors.** Only duplicate item ids, and a spec over the item cap, fail the job (`AssembleError` → `JobFailure`). Every other validation error is per item and non-fatal. A summary goes in `meta.validation`: counts plus ≤ 100 errors and ≤ 100 warnings.
9. **CSV format:**
   - UTF-8 without BOM, CRLF line ends (Cowork's file has both);
   - `None` → empty cell; `has_geometry` → `yes`/`no`; `flags` → `;`-joined codes;
   - plant and site coordinates rounded to 2 dp; EL and heights to 3 dp;
   - text cells starting with `=`, `+` or `@` get a leading `'`.
10. **Site label:** `utm39` exactly when `site.crs.epsg == 32639`, otherwise `site`. A spec without a site has empty site columns, headed `site_E`/`site_N`.
11. **The M1 branch also writes** `v<n>.csv` (header only, no rows) and `v<n>.meta.json`, so every version built after A1 has the same three files.
12. **Environment frame** (handed off to B3): a feature's mesh is feature-local. Origin = `footprint_ref` of the polygon of its points (vertex mean under 3 points), at `y = el`. x = north, z = east, as for items. A1's fallback (no B3 builder, or a builder failure) is a 0.2 m slab whose top is at `el`, in `ENV_MATERIAL[kind]`.
13. **Frame fill:**
    - `north_offset_deg = plant_north_deg + convergence_deg()`, where convergence is the true bearing of grid north at the origin (pyproj: -1.258° for Al-Zour, so 16.741°);
    - `origin` = lon/lat of `origin_crs`;
    - `ground_alt_m = datum.el_m - cloud_z_to_el.offset_m` when the cloud datum is fitted; otherwise 0.0, with `datum_note` saying the altitude is not fitted;
    - `height_m = max(top of bounds, 0.1)`;
    - without a CRS, `origin` is null and the offset is `plant_north_deg`.
14. **Items list:**
    - `cursor` = the last `asset_item.id`, as a decimal string;
    - `bbox` = `minE,minN,maxE,maxN` in plant metres, tested against the item's reference point;
    - `q` is a case-insensitive substring of tag, name or id; `flag` is a `FlagCode`;
    - model and version 404s come before parameter checks; a malformed cursor or bbox is 422 (`invalid_cursor` / `invalid_bbox`);
    - a version whose index is not written yet returns an empty page.
15. **`getAssetModelItem`** reads the one item from the stored spec JSON and validates only that item.
16. **`getAssetModelCsv`** is 409 `not_ready` when the version is not `ready` or has no CSV (versions built before A1).
17. **The budget probe** runs in a subprocess and reads psutil's peak working set (Windows). It is in the default suite, not behind the `perf` marker, because the budget is a gate requirement of spec §7.
18. **Specs over 200 items:** the version detail route serves their warnings from `meta.validation`, never by running `validate()` in the request. This applies only if F0 did not already do it.

## Deviations

- Spec §7's meshopt line is replaced by spec §15: no compression.
- `assemble_glb` and `register_rows` gain keyword-only arguments (`sheet_names`, `invalid`; `extra_flags`, `markers`), and a fuller `assemble()` returns the rows too. The index's signatures stay callable exactly as written.
- Spec §6 says `BuildCtx` "gives the palette and a triangle budget". The index's binding `BuildCtx` has `grid` and `lod` only, and A1 passes only those.

---

### Task 1: Align with merged F0

**Files:**
- Create: `backend/tests/test_asset_models_a1_seams.py`
- Read (no edits): `backend/app/asset_models/spec.py`, `siteframe.py`, `validate.py`, `service.py`, `router.py`, `jobs_glb.py`, `stubs_plant.py`, `builders/__init__.py`, `builders/base.py`, `builders/palette.py`, `builders/geom.py`, `builders/fallback.py`, `backend/app/db/models.py` (class `AssetItem`), `backend/app/api.py`, `contract/openapi.yaml` (schemas `AssetItemPage`, `AssetItemRow`, `AssetItem`; operations `listAssetModelItems`, `getAssetModelItem`, `getAssetModelCsv`), the F0 plan `docs/superpowers/plans/2026-10-03-plant-model-f0.md` (Rulings), `backend/app/asset_review/frame.py` (if present).

**Interfaces:**
- Consumes: everything in "Interfaces consumed".
- Produces: a seam test that pins each F0 name and convention A1 depends on, and an alignment note in the commit message listing every rename applied to Tasks 2–8.

- [ ] **Step 1: Confirm the worktree and F0 on its base**

Run: `git -C E:\Dev\Yolo\app\.claude\worktrees\pm-a1 rev-parse --abbrev-ref HEAD` → `task/pm-a1`.
Run: `git -C E:\Dev\Yolo\app\.claude\worktrees\pm-a1 log --oneline -15` → shows F0's merge commit.

- [ ] **Step 2: Write the seam test**

```python
# backend/tests/test_asset_models_a1_seams.py
"""A1's seams with F0 and P1 (plan 2026-10-03-plant-model-a1, task 1). Each assertion is a name or a
convention the assembler relies on; when F0 differs, A1's code is adapted, not these meanings."""

import inspect

import numpy as np
import pytest

from app.asset_models.builders import REGISTRY, BuildCtx, Instanced, MeshNode, build_item, geom, load_all
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import GridError, PlantGrid, footprint_ref  # noqa: F401 - the name must exist
from app.asset_models.spec import AssetSpec, EnvFeature, Item, ItemFlag, PolygonFootprint  # noqa: F401
from app.db.models import AssetItem

KIPIC_SITE = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}
COWORK_MATERIALS = [
    "Concrete_Tank", "Concrete", "Concrete_Dark", "Steel_Structure", "Steel_Dark", "Grating", "Handrail",
    "Equipment_White", "Equipment_Grey", "Insulation_Clad", "Pump_Blue", "Machine_Green", "Aluminium_Panel",
    "Pipe", "Pipe_Insulated", "Building_Wall", "Building_Roof", "Shelter_Roof", "Glass", "Ground",
    "Ground_Mainland", "Asphalt", "Paving", "Laydown", "Rock_Armour", "Slope", "Water_Pit", "Sea", "Fence",
    "Safety_Red", "Ship_Hull", "Ship_Bottom", "Ship_Deck", "Zone_Line",
]  # fmt: skip


def test_fallback_builders_are_registered():
    load_all()
    assert {"other", "composite"} <= set(REGISTRY)
    assert REGISTRY["other"].default_height_m > 0


def test_build_item_and_ctx_shapes():
    assert list(inspect.signature(build_item).parameters) == ["item", "ctx"]
    ctx = BuildCtx(grid=None, lod=0.5)
    assert ctx.lod == 0.5
    item = Item.model_validate(
        {
            "id": "a",
            "name": "A",
            "type": "other",
            "footprint": {"kind": "rect", "center": [10.0, 20.0], "size": [4.0, 2.0]},
            "base_el": 100.0,
            "source": {"kind": "assumed"},
        }
    )
    base, top, defaulted = ctx.height(item, 6.0)
    assert (base, top, defaulted) == (100.0, 106.0, True)
    nodes, flags = build_item(item, ctx)
    assert nodes and all(isinstance(n, MeshNode) for n in nodes) and isinstance(flags, list)
    assert Instanced.__dataclass_fields__.keys() >= {"mesh", "transforms"}
    assert ItemFlag(code="builder_fallback", note="x").code == "builder_fallback"


def test_palette_is_coworks_34():
    assert sorted(PALETTE) == sorted(COWORK_MATERIALS)
    rgba, metallic, roughness = PALETTE["Concrete_Tank"]
    assert len(rgba) == 4 and 0 <= metallic <= 1 and 0 <= roughness <= 1


def test_extrude_is_local_x_z_with_y_up():
    mesh = geom.extrude(np.array([[0.0, 0.0], [2.0, 0.0], [2.0, 1.0], [0.0, 1.0]]), 3.0)
    np.testing.assert_allclose(mesh.bounds, [[0, 0, 0], [2, 3, 1]], atol=1e-9)


def test_convergence_is_the_true_bearing_of_grid_north():
    from app.asset_models.spec import SiteFrame

    grid = PlantGrid(SiteFrame.model_validate(KIPIC_SITE))
    assert grid.convergence_deg() == pytest.approx(-1.2583, abs=0.01)


def test_asset_item_table():
    assert AssetItem.__tablename__ == "asset_item"
    cols = {c.name for c in AssetItem.__table__.columns}
    assert cols >= {
        "id", "model_id", "version", "node", "tag", "name", "type", "area", "plant_e", "plant_n", "site_x",
        "site_y", "lon", "lat", "base_el", "top_el", "height_source", "confidence", "flags", "source_sheet",
        "has_geometry",
    }  # fmt: skip


def test_a1_stubs_exist_until_a1_lands():
    from app.asset_models import stubs_plant

    ids = {op for _m, _p, op in stubs_plant.A1_STUBS}
    assert ids == {"listAssetModelItems", "getAssetModelItem", "getAssetModelCsv"}
```

- [ ] **Step 3: Run it**

Run: `PY -m pytest tests\test_asset_models_a1_seams.py -v`
Expected: all PASS on a correct F0. For each failure, read F0's code and apply the matching rename or convention in this plan's later tasks. Never weaken an assertion's meaning. Expected adaptations, with what to do:
- **`ctx.height` defaults the base differently** (for example `top` = `base + default` but `defaulted` only when `top_el` is None): keep the call as is. Adjust only the literal `(100.0, 106.0, True)` to F0's documented behaviour for "base given, top missing".
- **The `extrude` axes differ** (for example `(x, y)` with Z up): in Task 4 `_flat_env`, swap the columns or rotate to keep the slab item-local `(x=N, z=E)` with y up. Keep this test, rewritten to F0's real convention, and note it in the commit.
- **The convergence sign is flipped** (+1.258): in Task 7, use `plant_north_deg - grid.convergence_deg()`. Task 7's test keeps the physical value 16.741°.
- **The stub list is named differently** (for example `PLANT_A1_STUBS`): use F0's name here and in Task 8 Step 5.
- **`PALETTE` holds values other than Cowork's GLB factors:** record the transform in `palette_materials` (Task 4) so its test still gets `[0.8, 0.79, 0.76, 1]` for `Concrete_Tank`.

The step also needs these facts written down. Record each answer in the commit message:
- **Validation codes (Task 6):** F0's `validate()` item error codes. Fill `FATAL_CODES` with F0's codes for a duplicate id and for too many items. Note whether `Issue` carries `item_id` or reuses `part_id`; `issue_item_id` reads both.
- **Self-intersection code:** F0's code for a self-intersecting footprint (Task 6 RF#4 asserts it by item id, not by code).
- **Request-path validation:** whether `service.add_version` skips full validation above 200 items. If it does not, Task 6 Step 8 adds it.
- **Version detail warnings:** whether `router.get_asset_model_version` avoids `validate()` for large specs. If it does not, Task 8 Step 7 adds it.
- **Contract item shapes:** the contract's `AssetItemRow` and `AssetItem` property names. Task 8's pydantic models must match them field for field. If F0 already wrote `AssetItemRowOut` / `AssetItemPageOut` / `AssetItemOut` in `schemas.py`, Task 8 imports them instead of defining its own.
- **Item source page:** whether F0's `Item.source` accepts `page`. If it does not, Task 5 drops `"page": 1` from the fixture.
- **Undeclared statuses:** whether the contract declares 404 for all three operations, 422 for `listAssetModelItems` and 409 for `getAssetModelCsv`. If one is missing, that is a contract defect: fix it in `openapi.yaml`, regenerate `schema.d.ts` (`pnpm -C contract generate`), log a ruling, and hand it off to the coordinator in the final report.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_asset_models_a1_seams.py
git commit -m "test(asset-models): pin A1's seams with F0" -m "<alignment notes from step 3>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: GLB writer

**Files:**
- Create: `backend/app/asset_models/glbwriter.py`
- Create: `backend/tests/plant_helpers.py`
- Test: `backend/tests/test_asset_models_glbwriter.py`

**Interfaces:**
- Consumes: nothing from F0.
- Produces: `GlbWriter`, `trs`, `INSTANCING` (signatures in "Interfaces provided"); test helpers `parse(glb) -> (doc, bin)`, `accessor(doc, bin, i) -> np.ndarray`, `by_name(doc, name) -> dict`, `COWORK_MATERIALS`, `KIPIC_SITE`.

- [ ] **Step 1: Write the test helpers**

```python
# backend/tests/plant_helpers.py
"""Shared helpers for the plant assembler tests (plan 2026-10-03-plant-model-a1)."""

from __future__ import annotations

import json
import struct

import numpy as np

KIPIC_SITE = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}
COWORK_MATERIALS = [
    "Concrete_Tank", "Concrete", "Concrete_Dark", "Steel_Structure", "Steel_Dark", "Grating", "Handrail",
    "Equipment_White", "Equipment_Grey", "Insulation_Clad", "Pump_Blue", "Machine_Green", "Aluminium_Panel",
    "Pipe", "Pipe_Insulated", "Building_Wall", "Building_Roof", "Shelter_Roof", "Glass", "Ground",
    "Ground_Mainland", "Asphalt", "Paving", "Laydown", "Rock_Armour", "Slope", "Water_Pit", "Sea", "Fence",
    "Safety_Red", "Ship_Hull", "Ship_Bottom", "Ship_Deck", "Zone_Line",
]  # fmt: skip


def parse(glb: bytes) -> tuple[dict, bytes]:
    magic, version, total = struct.unpack_from("<4sII", glb, 0)
    assert magic == b"glTF" and version == 2 and total == len(glb)
    clen, ctype = struct.unpack_from("<I4s", glb, 12)
    assert ctype == b"JSON" and clen % 4 == 0
    doc = json.loads(glb[20 : 20 + clen])
    rest = glb[20 + clen :]
    binary = b""
    if rest:
        blen, btype = struct.unpack_from("<I4s", rest, 0)
        assert btype == b"BIN\x00" and blen % 4 == 0
        binary = rest[8 : 8 + blen]
    return doc, binary


def accessor(doc: dict, binary: bytes, index: int) -> np.ndarray:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    dtype = np.float32 if acc["componentType"] == 5126 else np.uint32
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[acc["type"]]
    data = np.frombuffer(binary, dtype, acc["count"] * width, view["byteOffset"])
    return data.reshape(acc["count"], width)


def by_name(doc: dict, name: str) -> dict:
    hits = [n for n in doc["nodes"] if n.get("name") == name]
    assert len(hits) == 1, f"{len(hits)} nodes named {name!r}"
    return hits[0]
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_asset_models_glbwriter.py
"""The plant GLB writer (plan 2026-10-03-plant-model-a1, task 2): node tree, extras, meshes,
materials and EXT_mesh_gpu_instancing, readable by trimesh."""

import io

import numpy as np
import pytest
import trimesh
from plant_helpers import accessor, parse
from scipy.spatial.transform import Rotation

from app.asset_models.glbwriter import INSTANCING, GlbWriter, trs

MATS = [{"name": "A", "pbrMetallicRoughness": {"baseColorFactor": [1.0, 0.0, 0.0, 1.0]}}]


def test_node_tree_extras_and_translation():
    w = GlbWriter(MATS)
    root = w.add_node("root", extras={"site": 1})
    grp = w.add_node("Area_10", parent=root)
    item = w.add_node("T-1", parent=grp, translation=(5.0, 1.0, 7.0))
    mesh = w.add_mesh(trimesh.creation.box((2.0, 2.0, 2.0)), 0)
    w.add_node("T-1/body", parent=item, mesh=mesh)
    w.set_extras(item, {"node": "T-1", "plant_E": 7.0})
    doc, _ = parse(w.to_glb())
    assert doc["scenes"][0]["nodes"] == [root]
    assert [n["name"] for n in doc["nodes"]] == ["root", "Area_10", "T-1", "T-1/body"]
    assert doc["nodes"][root]["children"] == [grp] and doc["nodes"][grp]["children"] == [item]
    assert doc["nodes"][item]["translation"] == [5.0, 1.0, 7.0]
    assert doc["nodes"][item]["extras"] == {"node": "T-1", "plant_E": 7.0}
    assert doc["nodes"][root]["extras"] == {"site": 1}
    assert doc["materials"] == MATS
    assert w.triangles == 12 and w.node_count == 4
    assert "extensionsUsed" not in doc


def test_box_is_faceted_with_bounds():
    w = GlbWriter(MATS)
    root = w.add_node("r")
    w.add_node("b", parent=root, mesh=w.add_mesh(trimesh.creation.box((2.0, 4.0, 6.0)), 0))
    doc, binary = parse(w.to_glb())
    prim = doc["meshes"][0]["primitives"][0]
    pos = doc["accessors"][prim["attributes"]["POSITION"]]
    assert pos["count"] == 24 and pos["min"] == [-1, -2, -3] and pos["max"] == [1, 2, 3]
    normals = accessor(doc, binary, prim["attributes"]["NORMAL"])
    np.testing.assert_allclose(np.abs(normals).max(axis=1), 1.0, atol=1e-6)
    assert doc["accessors"][prim["indices"]]["count"] == 36 and prim["material"] == 0


def test_cylinder_is_smooth_shaded():
    w = GlbWriter(MATS)
    cyl = trimesh.creation.cylinder(radius=5.0, height=2.0, sections=64)
    w.add_node("c", mesh=w.add_mesh(cyl, 0))
    doc, _ = parse(w.to_glb())
    prim = doc["meshes"][0]["primitives"][0]
    assert doc["accessors"][prim["attributes"]["POSITION"]]["count"] < 3 * len(cyl.faces)


def test_instancing_writes_trs_accessors():
    xf = np.repeat(np.eye(4)[None], 3, axis=0)
    xf[:, 0, 3] = [0.0, 10.0, 20.0]
    xf[2, :3, :3] = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])[:3, :3] * 2.0
    w = GlbWriter(MATS)
    root = w.add_node("r")
    node = w.add_node("piles", parent=root, mesh=w.add_mesh(trimesh.creation.box((1, 1, 1)), 0), instances=xf)
    doc, binary = parse(w.to_glb())
    assert doc["extensionsUsed"] == [INSTANCING]
    attrs = doc["nodes"][node]["extensions"][INSTANCING]["attributes"]
    assert accessor(doc, binary, attrs["TRANSLATION"])[:, 0].tolist() == [0.0, 10.0, 20.0]
    np.testing.assert_allclose(accessor(doc, binary, attrs["SCALE"])[2], [2, 2, 2], atol=1e-6)
    q = accessor(doc, binary, attrs["ROTATION"])[2]
    np.testing.assert_allclose(np.abs(q), [0, np.sqrt(0.5), 0, np.sqrt(0.5)], atol=1e-6)
    assert w.triangles == 36 and w.instanced_nodes == 1 and w.instances == 3


def test_trs_keeps_a_mirrored_instance():
    m = np.eye(4)
    m[0, 0] = -1.0
    m[:3, 3] = [1.0, 2.0, 3.0]
    t, q, s = trs(m[None])
    np.testing.assert_allclose(t[0], [1, 2, 3])
    np.testing.assert_allclose(Rotation.from_quat(q[0]).as_matrix() * s[0], m[:3, :3], atol=1e-6)


def test_empty_or_non_finite_mesh_is_skipped():
    w = GlbWriter(MATS)
    assert w.add_mesh(trimesh.Trimesh(), 0) is None
    box = trimesh.creation.box((1, 1, 1))
    bad = trimesh.Trimesh(vertices=np.full((8, 3), np.nan), faces=box.faces, process=False)
    assert w.add_mesh(bad, 0) is None


def test_nan_in_extras_refuses_to_write():
    w = GlbWriter(MATS)
    w.add_node("x", extras={"v": float("nan")})
    with pytest.raises(ValueError):
        w.to_glb()


def test_trimesh_reads_the_file():
    w = GlbWriter(MATS)
    root = w.add_node("root")
    item = w.add_node("T-1", parent=root, translation=(1.0, 0.0, 0.0))
    w.add_node("T-1/body", parent=item, mesh=w.add_mesh(trimesh.creation.box((1, 1, 1)), 0))
    scene = trimesh.load(io.BytesIO(w.to_glb()), file_type="glb")
    assert len(scene.geometry) == 1 and "T-1/body" in scene.graph.nodes


def test_no_nodes_still_a_valid_file():
    doc, binary = parse(GlbWriter(MATS).to_glb())
    assert binary == b"" and "buffers" not in doc and "nodes" not in doc
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `PY -m pytest tests\test_asset_models_glbwriter.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.asset_models.glbwriter'`.

- [ ] **Step 4: Write the writer**

```python
# backend/app/asset_models/glbwriter.py
"""A minimal glTF 2.0 binary writer for plant models (spec 2026-10-03-plant-model-generator §7, plan
A1 task 2): a node tree with extras, one mesh per node, the palette materials and
EXT_mesh_gpu_instancing. trimesh's exporter writes neither node extras nor instancing, so the plant
GLB is written here; M1's `build_glb` keeps trimesh. Pure: numpy, json and struct.
"""

from __future__ import annotations

import json
import struct
from collections.abc import Sequence

import numpy as np
import trimesh
from scipy.spatial.transform import Rotation

INSTANCING = "EXT_mesh_gpu_instancing"
GENERATOR = "kestrel plant assembler"
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
FLOAT = 5126
UINT32 = 5125
SMOOTH_ANGLE = float(np.radians(30.0))


def _pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * (-len(data) % 4)


def _faceted(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    vertices = np.asarray(mesh.vertices)[np.asarray(mesh.faces)].reshape(-1, 3)
    out = trimesh.Trimesh(vertices, np.arange(len(vertices)).reshape(-1, 3), process=False)
    out.vertex_normals = np.repeat(np.asarray(mesh.face_normals), 3, axis=0)
    return out


def _shade(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Split vertices at creases over 30 degrees: boxes come out faceted, cylinders smooth."""
    try:
        out = trimesh.graph.smooth_shade(mesh, angle=SMOOTH_ANGLE, facet_minarea=None)
        if len(out.faces) == len(mesh.faces):
            return out
    except Exception:
        pass
    return _faceted(mesh)


def trs(transforms: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(N, 4, 4) affine transforms -> translation (N, 3), rotation quaternion xyzw (N, 4), scale (N, 3).
    A mirror becomes a negative x scale. Shear is not representable and is dropped."""
    m = np.asarray(transforms, dtype=np.float64).reshape(-1, 4, 4)
    t = m[:, :3, 3]
    basis = m[:, :3, :3]
    s = np.linalg.norm(basis, axis=1)  # column norms
    s = np.where(s > 1e-12, s, 1.0)
    rot = basis / s[:, None, :]
    flip = np.linalg.det(rot) < 0
    s[flip, 0] *= -1.0
    rot[flip, :, 0] *= -1.0
    q = Rotation.from_matrix(rot).as_quat()
    return t.astype(np.float32), q.astype(np.float32), s.astype(np.float32)


class GlbWriter:
    def __init__(self, materials: list[dict]) -> None:
        self._materials = materials
        self._nodes: list[dict] = []
        self._roots: list[int] = []
        self._meshes: list[dict] = []
        self._mesh_faces: list[int] = []
        self._accessors: list[dict] = []
        self._views: list[dict] = []
        self._chunks: list[bytes] = []
        self._offset = 0
        self.triangles = 0
        self.instanced_nodes = 0
        self.instances = 0

    @property
    def node_count(self) -> int:
        return len(self._nodes)

    def _view(self, data: bytes, target: int | None) -> int:
        view = {"buffer": 0, "byteOffset": self._offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        self._views.append(view)
        self._chunks.append(data)
        self._offset += len(data)  # every element here is 4 bytes wide, so offsets stay aligned
        return len(self._views) - 1

    def _accessor(self, arr: np.ndarray, kind: str, target: int | None = None, *, minmax: bool = False) -> int:
        arr = np.ascontiguousarray(arr)
        acc = {
            "bufferView": self._view(arr.tobytes(), target),
            "componentType": UINT32 if arr.dtype == np.uint32 else FLOAT,
            "count": int(arr.shape[0]),
            "type": kind,
        }
        if minmax:
            acc["min"] = [float(v) for v in arr.min(axis=0)]
            acc["max"] = [float(v) for v in arr.max(axis=0)]
        self._accessors.append(acc)
        return len(self._accessors) - 1

    def add_mesh(self, mesh: trimesh.Trimesh, material: int) -> int | None:
        if mesh is None or len(mesh.faces) == 0 or not np.isfinite(np.asarray(mesh.vertices)).all():
            return None
        shaded = _shade(mesh)
        pos = np.asarray(shaded.vertices, dtype=np.float32)
        nrm = np.asarray(shaded.vertex_normals, dtype=np.float32)
        idx = np.asarray(shaded.faces, dtype=np.uint32).reshape(-1)
        if not (np.isfinite(pos).all() and np.isfinite(nrm).all()):
            return None
        prim = {
            "attributes": {
                "POSITION": self._accessor(pos, "VEC3", ARRAY_BUFFER, minmax=True),
                "NORMAL": self._accessor(nrm, "VEC3", ARRAY_BUFFER),
            },
            "indices": self._accessor(idx, "SCALAR", ELEMENT_ARRAY_BUFFER),
            "material": int(material),
        }
        self._meshes.append({"primitives": [prim]})
        self._mesh_faces.append(len(idx) // 3)
        return len(self._meshes) - 1

    def add_node(
        self,
        name: str,
        *,
        parent: int | None = None,
        translation: Sequence[float] | None = None,
        extras: dict | None = None,
        mesh: int | None = None,
        instances: np.ndarray | None = None,
    ) -> int:
        node: dict = {"name": name}
        if translation is not None:
            node["translation"] = [float(v) for v in translation]
        if extras:
            node["extras"] = extras
        if mesh is not None:
            node["mesh"] = mesh
            faces = self._mesh_faces[mesh]
            if instances is not None:
                t, r, s = trs(instances)
                node["extensions"] = {
                    INSTANCING: {
                        "attributes": {
                            "TRANSLATION": self._accessor(t, "VEC3"),
                            "ROTATION": self._accessor(r, "VEC4"),
                            "SCALE": self._accessor(s, "VEC3"),
                        }
                    }
                }
                self.instanced_nodes += 1
                self.instances += len(t)
                self.triangles += faces * len(t)
            else:
                self.triangles += faces
        self._nodes.append(node)
        index = len(self._nodes) - 1
        if parent is None:
            self._roots.append(index)
        else:
            self._nodes[parent].setdefault("children", []).append(index)
        return index

    def set_extras(self, node: int, extras: dict) -> None:
        self._nodes[node]["extras"] = extras

    def to_glb(self) -> bytes:
        doc: dict = {
            "asset": {"version": "2.0", "generator": GENERATOR},
            "scene": 0,
            "scenes": [{"nodes": self._roots}] if self._roots else [{}],
        }
        for key, value in (
            ("nodes", self._nodes),
            ("meshes", self._meshes),
            ("materials", self._materials),
            ("accessors", self._accessors),
            ("bufferViews", self._views),
        ):
            if value:  # glTF arrays, when present, must not be empty
                doc[key] = value
        binary = b"".join(self._chunks)
        if binary:
            doc["buffers"] = [{"byteLength": len(binary)}]
        if self.instanced_nodes:
            doc["extensionsUsed"] = [INSTANCING]
        body = _pad(json.dumps(doc, separators=(",", ":"), allow_nan=False).encode("utf-8"), b" ")
        parts = [struct.pack("<I4s", len(body), b"JSON"), body]
        if binary:
            padded = _pad(binary, b"\x00")
            parts += [struct.pack("<I4s", len(padded), b"BIN\x00"), padded]
        payload = b"".join(parts)
        return struct.pack("<4sII", b"glTF", 2, 12 + len(payload)) + payload
```

- [ ] **Step 5: Run the tests**

Run: `PY -m pytest tests\test_asset_models_glbwriter.py -v`
Expected: 9 passed.

- [ ] **Step 6: Lint**

Run: `PY -m ruff check app\asset_models\glbwriter.py tests\plant_helpers.py tests\test_asset_models_glbwriter.py` and `PY -m ruff format --check app\asset_models\glbwriter.py tests\plant_helpers.py tests\test_asset_models_glbwriter.py`
Expected: no findings. If format reports a diff, run `PY -m ruff format` on those files and re-run the tests.

- [ ] **Step 7: Commit**

```bash
git add backend/app/asset_models/glbwriter.py backend/tests/plant_helpers.py backend/tests/test_asset_models_glbwriter.py
git commit -m "feat(asset-models): glTF writer with node extras and GPU instancing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Register rows and CSV

**Files:**
- Create: `backend/app/asset_models/assemble.py` (rows and CSV part)
- Test: `backend/tests/test_asset_models_register.py`

**Interfaces:**
- Consumes: `AssetSpec`, `Item`, `ItemFlag`, `PlantGrid`, `GridError`, `footprint_ref`, `REGISTRY`, `BuildCtx.height`, `load_all` (F0).
- Produces: `CSV_COLUMNS`, `register_rows`, `write_csv`, `site_label`, `group_name`, `item_ref`, `default_height`, `grid_of`.

Row shape (typed, JSON-safe):
- `node`, `tag`, `name`, `type`, `area`, `group`: strings (`tag` and `area` may be `None`);
- `plant_E`, `plant_N`, `utm39_E`, `utm39_N`, `base_EL`, `height_m`, `top_EL`: floats or `None`;
- `height_source`: str;
- `has_geometry`: bool;
- `source_sheet`: str or `None`;
- `notes`: str or `None`;
- `flags`: `list[{"code", "value", "note"}]`;
- `confidence`: str;
- then `lon` and `lat`: floats or `None`.

The `utm39_*` keys keep that name in rows whatever the CRS; only the CSV header changes.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_models_register.py
"""Register rows and the register CSV (spec §7, plan A1 task 3)."""

import csv

import pytest
from plant_helpers import KIPIC_SITE

from app.asset_models.assemble import CSV_COLUMNS, register_rows, site_label, write_csv
from app.asset_models.builders import REGISTRY, load_all
from app.asset_models.spec import AssetSpec, ItemFlag

COWORK_17 = (
    "node,tag,name,type,area,group,plant_E,plant_N,utm39_E,utm39_N,base_EL,height_m,top_EL,"
    "height_source,has_geometry,source_sheet,notes"
).split(",")


def item(id_, **kw):
    return {
        "id": id_,
        "name": id_.upper(),
        "type": "other",
        "footprint": {"kind": "rect", "center": [2408.3, 810.4], "size": [10.0, 4.0]},
        "base_el": 104.5,
        "top_el": 110.5,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "d1"},
        **kw,
    }


def spec_of(items, site=KIPIC_SITE):
    return AssetSpec.model_validate({"site": site, "items": items})


def test_columns_are_cowork_order_plus_flags_and_confidence():
    assert CSV_COLUMNS[:17] == COWORK_17
    assert CSV_COLUMNS[17:] == ["flags", "confidence"]


def test_row_values_and_site_columns_match_cowork():
    spec = spec_of([item("10-A-0004", tag="10-A-0004", area="10")])
    [row] = register_rows(spec, {"d1": "P0058LNG-00-40-0-T0005"})
    assert list(row)[: len(CSV_COLUMNS)] == CSV_COLUMNS
    # Cowork register row 10-A-0004: plant (2408.3, 810.4) -> UTM-39 (246878.95, 3179542.26)
    assert row["utm39_E"] == pytest.approx(246878.95, abs=0.05)
    assert row["utm39_N"] == pytest.approx(3179542.26, abs=0.05)
    assert (row["plant_E"], row["plant_N"]) == (2408.3, 810.4)
    assert row["group"] == "Area_10" and row["tag"] == "10-A-0004"
    assert (row["base_EL"], row["height_m"], row["top_EL"]) == (104.5, 6.0, 110.5)
    assert row["height_source"] == "drawing" and row["confidence"] == "medium"
    assert row["source_sheet"] == "P0058LNG-00-40-0-T0005" and row["has_geometry"] is True
    assert 28.0 < row["lat"] < 29.5 and 47.5 < row["lon"] < 49.0


def test_defaulted_height_is_indicative_and_noted():
    load_all()
    d = REGISTRY["other"].default_height_m
    [row] = register_rows(spec_of([item("a", top_el=None, notes="Seen on T0005.")]))
    assert row["height_source"] == "indicative"
    assert row["height_m"] == pytest.approx(d)
    assert row["notes"] == f"Seen on T0005.; Height assumed {d:g} m (type default)."


def test_flags_merge_without_duplicate_codes():
    spec = spec_of([item("a", flags=[{"code": "height_mismatch", "value": 0.8}])])
    extra = {"a": [ItemFlag(code="builder_fallback", note="x"), ItemFlag(code="height_mismatch")]}
    [row] = register_rows(spec, extra_flags=extra, markers={"a"})
    assert [f["code"] for f in row["flags"]] == ["height_mismatch", "builder_fallback"]
    assert row["has_geometry"] is False


def test_group_names():
    rows = register_rows(spec_of([item("a", area="20"), item("b", area="Area_30_HP"), item("c")]))
    assert [r["group"] for r in rows] == ["Area_20", "Area_30_HP", "Area_unassigned"]


def test_no_site_leaves_site_columns_empty():
    [row] = register_rows(spec_of([item("a")], site=None))
    assert row["utm39_E"] is None and row["utm39_N"] is None and row["lon"] is None


def test_non_drawing_source_has_no_sheet():
    [row] = register_rows(spec_of([item("a", source={"kind": "assumed"})]), {"d1": "S"})
    assert row["source_sheet"] is None


def test_site_label():
    assert site_label(spec_of([])) == "utm39"
    assert site_label(spec_of([], site={**KIPIC_SITE, "crs": {"epsg": 2039}})) == "site"
    assert site_label(spec_of([], site=None)) == "site"


def test_write_csv_headers_cells_and_line_ends(tmp_path):
    spec = spec_of([item("a", flags=[{"code": "height_mismatch"}, {"code": "plan_offset", "value": 1.2}])])
    rows = register_rows(spec)
    p = tmp_path / "v1.csv"
    write_csv(rows, p, site_label="utm39")
    raw = p.read_bytes()
    assert raw.startswith(b"node,tag,name,type,area,group,plant_E,plant_N,utm39_E,utm39_N,")
    assert raw.count(b"\r\n") == 2 and not raw.startswith(b"\xef\xbb\xbf")
    [cells] = list(csv.DictReader(p.open(encoding="utf-8", newline="")))
    assert cells["has_geometry"] == "yes" and cells["tag"] == "" and cells["flags"] == "height_mismatch;plan_offset"
    assert cells["base_EL"] == "104.5" and cells["confidence"] == "medium"
    other = tmp_path / "v2.csv"
    write_csv(rows, other, site_label="site")
    assert other.read_text("utf-8").splitlines()[0].split(",")[8:10] == ["site_E", "site_N"]


def test_formula_like_text_is_neutralised(tmp_path):
    rows = register_rows(spec_of([item("a", name='=HYPERLINK("http://x")', notes="+1 note")]))
    p = tmp_path / "v1.csv"
    write_csv(rows, p)
    [cells] = list(csv.DictReader(p.open(encoding="utf-8", newline="")))
    assert cells["name"] == "'=HYPERLINK(\"http://x\")" and cells["notes"] == "'+1 note"


def test_quotes_and_commas_round_trip(tmp_path):
    rows = register_rows(spec_of([item("a", name='CONTROL BUILDING, "MAIN"'), item("b")]))
    p = tmp_path / "v1.csv"
    write_csv(rows, p)
    cells = list(csv.DictReader(p.open(encoding="utf-8", newline="")))
    assert [c["node"] for c in cells] == ["a", "b"] and cells[0]["name"] == 'CONTROL BUILDING, "MAIN"'


def test_empty_spec_writes_header_only(tmp_path):
    p = tmp_path / "v1.csv"
    write_csv(register_rows(spec_of([])), p)
    assert p.read_text("utf-8").splitlines() == [",".join(CSV_COLUMNS)]
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `PY -m pytest tests\test_asset_models_register.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.asset_models.assemble'`.

- [ ] **Step 3: Write the rows and CSV half of `assemble.py`**

```python
# backend/app/asset_models/assemble.py
"""Plant spec -> GLB + register CSV + `asset_item` index (spec 2026-10-03-plant-model-generator §7,
plan 2026-10-03-plant-model-a1).

Node tree: root (site extras) -> area groups -> one node per item (extras = its register row) -> the
builder's child nodes; `environment` and the M1 top-level parts hang off the root. Scene frame (D9):
metres, x = plant N, y = EL - datum, z = plant E. Item nodes sit at the footprint reference point at
base EL; builders draw in that item-local frame.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np

from app.asset_models.builders import REGISTRY, BuildCtx, load_all
from app.asset_models.siteframe import GridError, PlantGrid, footprint_ref
from app.asset_models.spec import AssetSpec, Item, ItemFlag

CSV_COLUMNS = [
    "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N", "base_EL",
    "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes", "flags", "confidence",
]  # fmt: skip
UTM39_EPSG = 32639
UNASSIGNED_GROUP = "Area_unassigned"
_FORMULA_START = ("=", "+", "@")
_TEXT_COLUMNS = frozenset({"node", "tag", "name", "type", "area", "group", "source_sheet", "notes"})


def grid_of(spec: AssetSpec) -> PlantGrid | None:
    return PlantGrid(spec.site) if spec.site is not None else None


def site_label(spec: AssetSpec) -> str:
    return "utm39" if spec.site is not None and spec.site.crs.epsg == UTM39_EPSG else "site"


def group_name(area: str | None) -> str:
    if not area:
        return UNASSIGNED_GROUP
    return area if area.startswith("Area_") else f"Area_{area}"


def default_height(type_: str) -> float:
    found = REGISTRY.get(type_) or REGISTRY["other"]
    return float(found.default_height_m)


def item_ref(item: Item) -> tuple[float, float]:
    """The footprint reference point in plant (E, N); finite even for a degenerate footprint."""
    try:
        e, n = footprint_ref(item.footprint)
        if math.isfinite(e) and math.isfinite(n):
            return float(e), float(n)
    except Exception:
        pass
    fp = item.footprint
    pts = np.asarray(fp.pts if hasattr(fp, "pts") else [fp.center], dtype=float)
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


def _r(value, digits: int) -> float | None:
    if value is None:
        return None
    value = float(value)
    return round(value, digits) if math.isfinite(value) else None


def _flags(item: Item, extra: list[ItemFlag] | None) -> list[dict]:
    out = [f.model_dump(mode="json") for f in item.flags]
    seen = {f["code"] for f in out}
    for flag in extra or ():
        if flag.code not in seen:
            out.append(flag.model_dump(mode="json"))
            seen.add(flag.code)
    return out


def _sheet(item: Item, names: dict[str, str] | None) -> str | None:
    src = item.source
    if src.kind != "drawing" or not src.id:
        return None
    return (names or {}).get(src.id, src.id)


def register_rows(
    spec: AssetSpec,
    sheet_names: dict[str, str] | None = None,
    *,
    extra_flags: dict[str, list[ItemFlag]] | None = None,
    markers: set[str] | None = None,
) -> list[dict]:
    """One register row per item, in spec order: CSV_COLUMNS (typed), then `lon`, `lat`."""
    if not spec.items:
        return []
    load_all()
    grid = grid_of(spec)
    ctx = BuildCtx(grid=grid)
    refs = np.array([item_ref(i) for i in spec.items], dtype=float)
    sx = sy = lon = lat = None
    if grid is not None:
        sx, sy = grid.plant_to_site(refs[:, 0], refs[:, 1])
        try:
            lon, lat = grid.site_to_lonlat(sx, sy)
        except GridError:
            lon = lat = None
    rows = []
    for k, item in enumerate(spec.items):
        base, top, defaulted = ctx.height(item, default_height(item.type))
        notes = item.notes
        if defaulted:
            notes = "; ".join(x for x in (notes, f"Height assumed {top - base:g} m (type default).") if x)
        rows.append(
            {
                "node": item.id,
                "tag": item.tag,
                "name": item.name,
                "type": item.type,
                "area": item.area,
                "group": group_name(item.area),
                "plant_E": _r(refs[k, 0], 2),
                "plant_N": _r(refs[k, 1], 2),
                "utm39_E": _r(sx[k], 2) if sx is not None else None,
                "utm39_N": _r(sy[k], 2) if sy is not None else None,
                "base_EL": _r(base, 3),
                "height_m": _r(top - base, 3),
                "top_EL": _r(top, 3),
                "height_source": "indicative" if defaulted else item.height_source,
                "has_geometry": item.id not in (markers or ()),
                "source_sheet": _sheet(item, sheet_names),
                "notes": notes,
                "flags": _flags(item, (extra_flags or {}).get(item.id)),
                "confidence": item.confidence,
                "lon": _r(lon[k], 8) if lon is not None else None,
                "lat": _r(lat[k], 8) if lat is not None else None,
            }
        )
    return rows


def _cell(column: str, value) -> str:
    if value is None:
        return ""
    if column == "has_geometry":
        return "yes" if value else "no"
    if column == "flags":
        return ";".join(f["code"] for f in value)
    if isinstance(value, float):
        return repr(value)
    text = str(value)
    if column in _TEXT_COLUMNS and text.startswith(_FORMULA_START):
        return "'" + text  # never hand Excel a formula read off a drawing
    return text


def write_csv(rows: list[dict], path: Path, *, site_label: str = "utm39") -> None:
    """Cowork's column order; UTF-8 without BOM and CRLF line ends, like Cowork's register."""
    header = [f"{site_label}_{c[6:]}" if c.startswith("utm39_") else c for c in CSV_COLUMNS]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for row in rows:
            writer.writerow([_cell(c, row.get(c)) for c in CSV_COLUMNS])
```

- [ ] **Step 4: Run the tests**

Run: `PY -m pytest tests\test_asset_models_register.py -v`
Expected: 12 passed.

- [ ] **Step 5: Lint**

Run: `PY -m ruff check app\asset_models\assemble.py tests\test_asset_models_register.py` and `PY -m ruff format --check app\asset_models\assemble.py tests\test_asset_models_register.py`
Expected: no findings.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/assemble.py backend/tests/test_asset_models_register.py
git commit -m "feat(asset-models): plant register rows and Cowork-order CSV" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The assembler

**Files:**
- Modify: `backend/app/asset_models/assemble.py` (imports; append the assembly half)
- Test: `backend/tests/test_asset_models_assemble.py`

**Interfaces:**
- Consumes: Task 2 `GlbWriter`; Task 3 `register_rows`, `item_ref`, `group_name`, `default_height`, `grid_of`; F0 `build_item`, `BuildCtx`, `MeshNode`, `Instanced`, `PALETTE`, `geom.extrude`, `PolygonFootprint`, `EnvFeature`; M1 `build_shape`, `part_transform`; optional B3 `builders.environment.build_env`.
- Produces: `assemble`, `assemble_glb`, `Assembly`, `AssembleError`, `palette_materials`, `site_extras`, `env_ref`, `ENV_MATERIAL`, `PART_MATERIAL`, and the module-level `_env_builder()` that tests monkeypatch.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_models_assemble.py
"""The plant assembler (spec §7, plan A1 task 4): hierarchy, extras = register rows, palette,
instancing, fallbacks, environment and M1 parts."""

import json

import numpy as np
import pytest
import trimesh
from plant_helpers import COWORK_MATERIALS, KIPIC_SITE, by_name, parse

import app.asset_models.assemble as assemble_mod
from app.asset_models.assemble import AssembleError, assemble, assemble_glb, env_ref
from app.asset_models.builders import Instanced, MeshNode
from app.asset_models.glbwriter import INSTANCING
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import AssetSpec, EnvFeature

SEA = {
    "id": "sea",
    "kind": "sea",
    "pts": [[2000.0, 200.0], [2600.0, 200.0], [2600.0, 900.0], [2000.0, 900.0]],
    "el": 93.56,
    "source": {"kind": "assumed"},
}
PART = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 4000, "thickness": 10, "height": 8000},
    "source": {"kind": "assumed"},
}


def item(id_, area=None, e=1300.0, n=555.4, **kw):
    return {
        "id": id_,
        "name": id_.upper(),
        "type": "other",
        "area": area,
        "footprint": {"kind": "rect", "center": [e, n], "size": [10.0, 6.0]},
        "base_el": 100.0,
        "top_el": 104.0,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "d1"},
        **kw,
    }


def spec_of(items, environment=(), parts=(), site=KIPIC_SITE):
    return AssetSpec.model_validate(
        {
            "asset": {"name": "Test plant"},
            "site": site,
            "items": list(items),
            "environment": list(environment),
            "parts": list(parts),
        }
    )


def box_node(name="body", material="Concrete", **kw):
    return MeshNode(name=name, material=material, geometry=trimesh.creation.box((1.0, 1.0, 1.0)), **kw)


def test_root_areas_items_environment_parts():
    spec = spec_of(
        [item("a", "10"), item("b", "20", e=1400.0), item("c", "10", e=1500.0), item("d", e=1600.0)],
        [SEA],
        [PART],
    )
    doc, _ = parse(assemble_glb(spec)[0])
    nodes = doc["nodes"]
    [root_i] = doc["scenes"][0]["nodes"]
    root = nodes[root_i]
    assert root["name"] == "Test plant"
    assert [nodes[i]["name"] for i in root["children"]] == [
        "Area_10", "Area_20", "Area_unassigned", "environment", "shell",
    ]  # fmt: skip
    area10 = nodes[root["children"][0]]
    assert [nodes[i]["name"] for i in area10["children"]] == ["a", "c"]
    a = nodes[area10["children"][0]]
    assert a["children"] and all(nodes[i]["name"].startswith("a/") for i in a["children"])
    env = nodes[root["children"][3]]
    [sea] = [nodes[i] for i in env["children"]]
    assert sea["name"] == "sea" and sea["extras"]["kind"] == "sea"
    x = root["extras"]
    assert x["crs"]["epsg"] == 32639 and x["origin_crs"] == [244338.089, 3179515.69]
    assert x["plant_north_deg"] == 17.9991 and x["datum"] == {"label": "HPFS", "el_m": 100.0}
    assert x["site_from_plant"].startswith("X = 244338.089 + E cos(17.9991)")
    assert x["frame"] == "glTF Y-up, metres. x = plant N, y = EL - 100, z = plant E"


def test_item_translation_is_the_plant_ref_in_the_scene_frame():
    spec = spec_of([item("a", "20", e=1301.1, n=555.4, base_el=102.0)])
    doc, _ = parse(assemble_glb(spec)[0])
    t = by_name(doc, "a")["translation"]
    assert t == pytest.approx([555.4, 2.0, 1301.1])
    expected = PlantGrid(spec.site).plant_to_scene(1301.1, 555.4, 102.0)
    np.testing.assert_allclose(t, np.asarray(expected).reshape(3), atol=1e-6)


def test_item_extras_are_the_register_rows():
    spec = spec_of([item("a", "10", tag="10-A-1"), item("b", "20", e=1400.0)])
    a = assemble(spec, sheet_names={"d1": "SHEET-1"})
    doc, _ = parse(a.glb)
    for row in a.rows:
        assert by_name(doc, row["node"])["extras"] == json.loads(json.dumps(row))
    assert a.rows[0]["source_sheet"] == "SHEET-1"


def test_materials_are_the_cowork_palette():
    doc, _ = parse(assemble_glb(spec_of([item("a")]))[0])
    mats = {m["name"]: m for m in doc["materials"]}
    assert len(doc["materials"]) == 34 and sorted(mats) == sorted(COWORK_MATERIALS)
    assert mats["Concrete_Tank"]["pbrMetallicRoughness"]["baseColorFactor"] == pytest.approx([0.8, 0.79, 0.76, 1])
    assert mats["Steel_Structure"]["pbrMetallicRoughness"]["metallicFactor"] == pytest.approx(0.5)
    assert mats["Fence"]["alphaMode"] == "BLEND" and "alphaMode" not in mats["Concrete"]


def test_instanced_builder_output(monkeypatch):
    xf = np.repeat(np.eye(4)[None], 5, axis=0)
    xf[:, 0, 3] = np.arange(5) * 6.0
    piles = MeshNode(name="piles", material="Concrete", geometry=Instanced(trimesh.creation.box((1, 1, 1)), xf))
    monkeypatch.setattr(assemble_mod, "build_item", lambda item, ctx: ([piles], []))
    a = assemble(spec_of([item("a")]))
    doc, _ = parse(a.glb)
    assert INSTANCING in by_name(doc, "a/piles")["extensions"] and doc["extensionsUsed"] == [INSTANCING]
    assert a.meta["instanced"] == {"nodes": 1, "instances": 5} and a.meta["triangles"] == 60
    assert a.meta["bounds_m"][1][0] == pytest.approx(555.4 + 24.5, abs=1e-3)


def test_builder_exception_becomes_a_marker(monkeypatch):
    def boom(item, ctx):
        raise RuntimeError("bad")

    monkeypatch.setattr(assemble_mod, "build_item", boom)
    a = assemble(spec_of([item("a")]))
    doc, _ = parse(a.glb)
    assert "mesh" in by_name(doc, "a/marker")
    [row] = a.rows
    assert row["has_geometry"] is False and "builder_fallback" in [f["code"] for f in row["flags"]]
    assert a.meta["markers"] == ["a"] and a.meta["fallbacks"] == ["a"] and a.meta["fallback_count"] == 1


def test_non_finite_builder_output_becomes_marker(monkeypatch):
    box = trimesh.creation.box((1, 1, 1))
    bad = trimesh.Trimesh(vertices=np.full((8, 3), np.nan), faces=box.faces, process=False)
    node = MeshNode(name="body", material="Concrete", geometry=bad)
    monkeypatch.setattr(assemble_mod, "build_item", lambda item, ctx: ([node], []))
    a = assemble(spec_of([item("a")]))
    doc, _ = parse(a.glb)
    assert "mesh" in by_name(doc, "a/marker") and not [n for n in doc["nodes"] if n["name"] == "a/body"]
    assert a.rows[0]["has_geometry"] is False


def test_numpy_extras_are_cleaned(monkeypatch):
    good = box_node(extras={"n": np.int64(3), "v": np.float32(1.5)})
    nan = box_node(name="nan", extras={"v": np.float64("nan")})
    monkeypatch.setattr(assemble_mod, "build_item", lambda item, ctx: ([good, nan], []))
    doc, _ = parse(assemble(spec_of([item("a")])).glb)
    assert by_name(doc, "a/body")["extras"] == {"n": 3, "v": 1.5}
    assert "extras" not in by_name(doc, "a/nan")


def test_invalid_item_is_built_as_other_with_a_flag(monkeypatch):
    seen = []

    def spy(item, ctx):
        seen.append(item.type)
        return [box_node()], []

    monkeypatch.setattr(assemble_mod, "build_item", spy)
    a = assemble(
        spec_of([item("a", type="pipe_rack", params={"tiers": 3})]), invalid={"a": "footprint crosses itself"}
    )
    assert seen == ["other"]
    [row] = a.rows
    assert row["type"] == "pipe_rack"
    [flag] = [f for f in row["flags"] if f["code"] == "builder_fallback"]
    assert flag["note"] == "Built as other: footprint crosses itself"


def test_duplicate_item_ids_raise():
    with pytest.raises(AssembleError, match="more than once"):
        assemble(spec_of([item("a"), item("a", e=1400.0)]))


def test_item_parts_are_children_and_composite_is_not_doubled():
    doc, _ = parse(assemble_glb(spec_of([item("a", parts=[PART])]))[0])
    assert "mesh" in by_name(doc, "a/shell")
    doc2, _ = parse(assemble_glb(spec_of([item("t", type="composite", parts=[PART])]))[0])
    assert sum(n["name"].startswith("t/") for n in doc2["nodes"]) == 1


def test_environment_falls_back_to_a_flat_slab(monkeypatch):
    monkeypatch.setattr(assemble_mod, "_env_builder", lambda: None)
    a = assemble(spec_of([], [SEA]))
    doc, _ = parse(a.glb)
    e, n = env_ref(EnvFeature.model_validate(SEA))
    assert by_name(doc, "sea")["translation"] == pytest.approx([n, 93.56 - 100.0, e])
    slab = by_name(doc, "sea/sea")
    prim = doc["meshes"][slab["mesh"]]["primitives"][0]
    assert doc["materials"][prim["material"]]["name"] == "Sea"
    pos = doc["accessors"][prim["attributes"]["POSITION"]]
    assert pos["max"][1] == pytest.approx(0.0, abs=1e-6) and pos["min"][1] == pytest.approx(-0.2, abs=1e-6)
    assert a.meta["environment"] == 1 and a.rows == []


def test_env_builder_failure_falls_back(monkeypatch):
    def broken(feature, ctx):
        raise ValueError("no")

    monkeypatch.setattr(assemble_mod, "_env_builder", lambda: broken)
    a = assemble(spec_of([], [SEA]))
    assert a.meta["environment"] == 1 and a.meta["env_skipped"] == []


def test_progress_runs_from_zero_to_one():
    seen = []
    assemble(spec_of([item(f"i{k}", e=1300.0 + 20 * k) for k in range(60)]), progress=seen.append)
    assert seen[0] == 0.0 and seen[-1] == 1.0 and seen == sorted(seen)


def test_lod_reaches_the_builders(monkeypatch):
    lods = []

    def spy(item, ctx):
        lods.append(ctx.lod)
        return [box_node()], []

    monkeypatch.setattr(assemble_mod, "build_item", spy)
    assemble(spec_of([item("a")]), lod=0.5)
    assert lods == [0.5]


def test_no_site_uses_datum_zero():
    a = assemble(spec_of([item("a", base_el=5.0, top_el=9.0)], site=None))
    doc, _ = parse(a.glb)
    assert by_name(doc, "a")["translation"] == pytest.approx([555.4, 5.0, 1300.0])
    root = doc["nodes"][doc["scenes"][0]["nodes"][0]]
    assert root["extras"]["crs"] is None and a.rows[0]["utm39_E"] is None


def test_meta_shape():
    a = assemble(spec_of([item("a")], [SEA], [PART]))
    assert set(a.meta) >= {
        "bounds_m", "top_m", "triangles", "node_count", "items", "environment", "env_skipped",
        "fallback_count", "fallbacks", "markers", "instanced", "parts",
    }  # fmt: skip
    assert a.meta["items"] == 1 and a.meta["parts"][0]["id"] == "shell" and a.meta["triangles"] > 0
    assert a.meta["top_m"] == a.meta["bounds_m"][1][1]
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `PY -m pytest tests\test_asset_models_assemble.py -v`
Expected: collection error `ImportError: cannot import name 'AssembleError' from 'app.asset_models.assemble'`.

- [ ] **Step 3: Replace the import block of `assemble.py`**

Replace the lines from `import csv` through `from app.asset_models.spec import AssetSpec, Item, ItemFlag` with:

```python
import csv
import json
import math
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh

from app.asset_models.builders import REGISTRY, BuildCtx, Instanced, MeshNode, build_item, geom, load_all
from app.asset_models.builders.palette import PALETTE
from app.asset_models.glbwriter import GlbWriter
from app.asset_models.placement import part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.siteframe import GridError, PlantGrid, footprint_ref
from app.asset_models.spec import AssetSpec, EnvFeature, Item, ItemFlag, PolygonFootprint
```

- [ ] **Step 4: Append the assembly half to `assemble.py`**

```python
MM = 0.001
FALLBACK_MATERIAL = "Equipment_Grey"
MARKER_MATERIAL = "Safety_Red"
ENV_GROUP = "environment"
ENV_SLAB_M = 0.2
ENV_MATERIAL = {
    "land": "Ground",
    "sea": "Sea",
    "road": "Asphalt",
    "paved": "Paving",
    "laydown": "Laydown",
    "slope": "Slope",
    "revetment": "Rock_Armour",
}
PART_MATERIAL = {
    "paint": "Equipment_White",
    "steel": "Steel_Structure",
    "rubber": "Steel_Dark",
    "concrete": "Concrete",
    "grating": "Grating",
    "galvanised": "Pipe",
    "glass": "Glass",
    "other": FALLBACK_MATERIAL,
}
MAX_META_IDS = 200
PROGRESS_EVERY = 25


class AssembleError(Exception):
    """A spec the assembler cannot turn into one consistent model (duplicate item ids)."""


@dataclass
class Assembly:
    glb: bytes
    meta: dict
    rows: list[dict]


def palette_materials() -> tuple[list[dict], dict[str, int]]:
    """All 34 palette materials in PALETTE order, so a material's index never depends on the spec."""
    mats: list[dict] = []
    index: dict[str, int] = {}
    for name, (rgba, metallic, roughness) in PALETTE.items():
        mat = {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": [round(float(c), 4) for c in rgba],
                "metallicFactor": float(metallic),
                "roughnessFactor": float(roughness),
            },
            "doubleSided": True,
        }
        if float(rgba[3]) < 1.0:
            mat["alphaMode"] = "BLEND"
        index[name] = len(mats)
        mats.append(mat)
    return mats, index


def site_extras(spec: AssetSpec) -> dict:
    site = spec.site
    if site is None:
        return {"crs": None, "frame": "glTF Y-up, metres. x = plant N, y = EL, z = plant E"}
    ox, oy = site.origin_crs
    th = site.plant_north_deg
    return {
        "crs": {"epsg": site.crs.epsg, "wkt": site.crs.wkt},
        "origin_crs": [ox, oy],
        "plant_north_deg": th,
        "datum": {"label": site.datum.label, "el_m": site.datum.el_m},
        "cloud_z_to_el": site.cloud_z_to_el.model_dump(mode="json") if site.cloud_z_to_el else None,
        "frame": f"glTF Y-up, metres. x = plant N, y = EL - {site.datum.el_m:g}, z = plant E",
        "site_from_plant": f"X = {ox} + E cos({th}) + N sin({th}); Y = {oy} - E sin({th}) + N cos({th})",
    }


def env_ref(feature: EnvFeature) -> tuple[float, float]:
    """The feature-local origin in plant (E, N): the polygon's footprint_ref, else the vertex mean."""
    pts = np.asarray(feature.pts, dtype=float)
    if len(pts) >= 3:
        try:
            e, n = footprint_ref(PolygonFootprint(kind="polygon", pts=[list(p) for p in feature.pts]))
            if math.isfinite(e) and math.isfinite(n):
                return float(e), float(n)
        except Exception:
            pass
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


class _Bounds:
    def __init__(self) -> None:
        self.lo = np.full(3, np.inf)
        self.hi = np.full(3, -np.inf)

    def add(self, bounds, offset) -> None:
        b = np.asarray(bounds, dtype=float) + np.asarray(offset, dtype=float)
        self.lo = np.minimum(self.lo, b[0])
        self.hi = np.maximum(self.hi, b[1])

    def add_instanced(self, bounds, xf: np.ndarray, offset) -> None:
        corners = trimesh.bounds.corners(np.asarray(bounds, dtype=float))
        pts = np.einsum("nij,kj->nki", xf[:, :3, :3], corners) + xf[:, None, :3, 3]
        flat = pts.reshape(-1, 3)
        self.add([flat.min(axis=0), flat.max(axis=0)], offset)

    def as_lists(self) -> tuple[list[float], list[float]]:
        if not (np.isfinite(self.lo).all() and np.isfinite(self.hi).all()):
            return [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
        return np.round(self.lo, 4).tolist(), np.round(self.hi, 4).tolist()


def _np_scalar(value):
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(type(value).__name__)


def _clean_extras(extras: dict | None) -> dict | None:
    """Builder extras as plain JSON, or None when they cannot be (a NaN, an unknown type)."""
    if not extras:
        return None
    try:
        return json.loads(json.dumps(extras, default=_np_scalar, allow_nan=False))
    except (TypeError, ValueError):
        return None


def _marker() -> MeshNode:
    box = trimesh.creation.box((1.0, 1.0, 1.0))
    box.apply_translation((0.0, 0.5, 0.0))
    return MeshNode(name="marker", material=MARKER_MATERIAL, geometry=box)


def _part_mesh(part, by_id) -> trimesh.Trimesh:
    mesh = build_shape(part.shape, part.typed_params())
    mesh.apply_transform(part_transform(part, by_id))
    mesh.apply_scale(MM)
    return mesh


def _item_parts(item: Item) -> list[MeshNode]:
    """An item's M1 parts (item-local mm) as extra children; `composite` draws them itself."""
    if not item.parts or item.type == "composite":
        return []
    by_id = {p.id: p for p in item.parts}
    out = []
    for part in item.parts:
        try:
            mesh = _part_mesh(part, by_id)
        except Exception:
            continue
        material = PART_MATERIAL.get(part.material, FALLBACK_MATERIAL)
        out.append(MeshNode(name=part.id, material=material, geometry=mesh, extras={"shape": part.shape}))
    return out


def _build(item: Item, ctx: BuildCtx, invalid_msg: str | None) -> tuple[list[MeshNode], list[ItemFlag]]:
    flags: list[ItemFlag] = []
    target = item
    if invalid_msg is not None:
        target = item.model_copy(update={"type": "other", "params": {}})
        flags.append(ItemFlag(code="builder_fallback", note=f"Built as other: {invalid_msg}"[:300]))
    try:
        nodes, more = build_item(target, ctx)
    except Exception:  # build_item must not raise; the assembler still never trusts that
        return [], [*flags, ItemFlag(code="builder_fallback", note="Could not be built; shown as a marker.")]
    return [*nodes, *_item_parts(item)], [*flags, *more]


def _emit(w: GlbWriter, nodes, parent: int, prefix: str, mats: dict[str, int], bounds: _Bounds, offset) -> int:
    count = 0
    for mn in nodes:
        material = mats.get(mn.material, mats[FALLBACK_MATERIAL])
        name = f"{prefix}/{mn.name}"
        extras = _clean_extras(mn.extras)
        try:
            geometry = mn.geometry
            if isinstance(geometry, Instanced):
                xf = np.asarray(geometry.transforms, dtype=float).reshape(-1, 4, 4)
                if len(xf) == 0 or not np.isfinite(xf).all():
                    continue
                mesh = w.add_mesh(geometry.mesh, material)
                if mesh is None:
                    continue
                w.add_node(name, parent=parent, extras=extras, mesh=mesh, instances=xf)
                bounds.add_instanced(geometry.mesh.bounds, xf, offset)
            else:
                mesh = w.add_mesh(geometry, material)
                if mesh is None:
                    continue
                w.add_node(name, parent=parent, extras=extras, mesh=mesh)
                bounds.add(geometry.bounds, offset)
        except Exception:
            continue
        count += 1
    return count


def _env_builder():
    """B3's environment builder when it has landed; None makes the assembler draw flat slabs."""
    try:
        from app.asset_models.builders.environment import build_env
    except ImportError:
        return None
    return build_env


def _flat_env(feature: EnvFeature, ref: tuple[float, float]) -> list[MeshNode]:
    pts = np.asarray(feature.pts, dtype=float)
    local = np.column_stack([pts[:, 1] - ref[1], pts[:, 0] - ref[0]])  # item-local [x = north, z = east]
    slab = geom.extrude(local, ENV_SLAB_M)
    slab.apply_translation((0.0, -ENV_SLAB_M, 0.0))  # top face at the feature's EL
    return [MeshNode(name=feature.kind, material=ENV_MATERIAL[feature.kind], geometry=slab)]


def _environment(w, spec, root, ctx, mats, bounds, datum, tick) -> tuple[int, list[str]]:
    if not spec.environment:
        return 0, []
    group = w.add_node(ENV_GROUP, parent=root)
    build_env = _env_builder()
    done, skipped = 0, []
    for feature in spec.environment:
        tick()
        ref = env_ref(feature)
        offset = (ref[1], feature.el - datum, ref[0])
        nodes: list[MeshNode] = []
        if build_env is not None:
            try:
                nodes = list(build_env(feature, ctx))
            except Exception:
                nodes = []
        extras = {"id": feature.id, "kind": feature.kind, "el": feature.el, "confidence": feature.confidence}
        node = w.add_node(feature.id, parent=group, translation=offset, extras=extras)
        emitted = _emit(w, nodes, node, feature.id, mats, bounds, offset) if nodes else 0
        if not emitted:
            try:
                emitted = _emit(w, _flat_env(feature, ref), node, feature.id, mats, bounds, offset)
            except Exception:
                emitted = 0
        if emitted:
            done += 1
        else:
            skipped.append(feature.id)
    return done, skipped


def _top_parts(w, spec, root, mats, bounds) -> list[dict]:
    """M1 top-level parts stay under the root, in the scene frame at the plant origin, as in M1."""
    by_id = {p.id: p for p in spec.parts}
    out = []
    for part in spec.parts:
        try:
            mesh = _part_mesh(part, by_id)
        except Exception:
            continue
        index = w.add_mesh(mesh, mats[PART_MATERIAL.get(part.material, FALLBACK_MATERIAL)])
        if index is None:
            continue
        extras = _clean_extras({"name": part.name, "group": part.group, "shape": part.shape, "params": part.params})
        w.add_node(part.id, parent=root, mesh=index, extras=extras)
        bounds.add(mesh.bounds, (0.0, 0.0, 0.0))
        out.append({"id": part.id, "name": part.name, "group": part.group, "triangles": int(len(mesh.faces))})
    return out


def assemble(
    spec: AssetSpec,
    *,
    lod: float = 1.0,
    progress: Callable[[float], None] | None = None,
    sheet_names: dict[str, str] | None = None,
    invalid: dict[str, str] | None = None,
) -> Assembly:
    """The GLB, its meta and the register rows of one plant spec. `invalid` maps item ids that
    `validate()` rejected to its message: those are built as `other` with a `builder_fallback` flag."""
    dupes = sorted(k for k, c in Counter(i.id for i in spec.items).items() if c > 1)
    if dupes:
        raise AssembleError(f"{len(dupes)} item ids are used more than once (first: {dupes[0]})")
    load_all()
    grid = grid_of(spec)
    datum = spec.site.datum.el_m if spec.site is not None else 0.0
    ctx = BuildCtx(grid=grid, lod=lod)
    mats, mat_index = palette_materials()
    w = GlbWriter(mats)
    bounds = _Bounds()
    root = w.add_node(spec.asset.name or "plant", extras=site_extras(spec))
    total = max(len(spec.items) + len(spec.environment), 1)
    step = [0]

    def tick() -> None:
        if progress is not None and step[0] % PROGRESS_EVERY == 0:
            progress(step[0] / total)
        step[0] += 1

    groups: dict[str, int] = {}
    item_nodes: dict[str, int] = {}
    extra_flags: dict[str, list[ItemFlag]] = {}
    markers: list[str] = []
    for item in spec.items:
        tick()
        group = group_name(item.area)
        if group not in groups:
            groups[group] = w.add_node(group, parent=root)
        e, n = item_ref(item)
        base, _top, _defaulted = ctx.height(item, default_height(item.type))
        offset = (n, base - datum, e)
        node = w.add_node(item.id, parent=groups[group], translation=offset)
        item_nodes[item.id] = node
        nodes, flags = _build(item, ctx, (invalid or {}).get(item.id))
        if _emit(w, nodes, node, item.id, mat_index, bounds, offset) == 0:
            _emit(w, [_marker()], node, item.id, mat_index, bounds, offset)
            markers.append(item.id)
            if not any(f.code == "builder_fallback" for f in flags):
                flags.append(ItemFlag(code="builder_fallback", note="Nothing to draw; shown as a marker."))
        if flags:
            extra_flags[item.id] = flags
    env_count, env_skipped = _environment(w, spec, root, ctx, mat_index, bounds, datum, tick)
    parts_meta = _top_parts(w, spec, root, mat_index, bounds)
    rows = register_rows(spec, sheet_names, extra_flags=extra_flags, markers=set(markers))
    for row in rows:
        w.set_extras(item_nodes[row["node"]], row)
    glb = w.to_glb()
    fallbacks = [i for i, fl in extra_flags.items() if any(f.code == "builder_fallback" for f in fl)]
    lo, hi = bounds.as_lists()
    meta = {
        "bounds_m": [lo, hi],
        "top_m": hi[1],
        "triangles": w.triangles,
        "node_count": w.node_count,
        "items": len(spec.items),
        "environment": env_count,
        "env_skipped": env_skipped[:MAX_META_IDS],
        "fallback_count": len(fallbacks),
        "fallbacks": fallbacks[:MAX_META_IDS],
        "markers": markers[:MAX_META_IDS],
        "instanced": {"nodes": w.instanced_nodes, "instances": w.instances},
        "parts": parts_meta,
    }
    if progress is not None:
        progress(1.0)
    return Assembly(glb=glb, meta=meta, rows=rows)


def assemble_glb(
    spec: AssetSpec,
    *,
    lod: float = 1.0,
    progress: Callable[[float], None] | None = None,
    sheet_names: dict[str, str] | None = None,
    invalid: dict[str, str] | None = None,
) -> tuple[bytes, dict]:
    a = assemble(spec, lod=lod, progress=progress, sheet_names=sheet_names, invalid=invalid)
    return a.glb, a.meta
```

- [ ] **Step 5: Run the tests**

Run: `PY -m pytest tests\test_asset_models_assemble.py tests\test_asset_models_register.py tests\test_asset_models_glbwriter.py -v`
Expected: all pass (18 + 12 + 9).

- [ ] **Step 6: Lint**

Run: `PY -m ruff check app\asset_models\assemble.py tests\test_asset_models_assemble.py` and `PY -m ruff format --check app\asset_models\assemble.py tests\test_asset_models_assemble.py`
Expected: no findings.

- [ ] **Step 7: Commit**

```bash
git add backend/app/asset_models/assemble.py backend/tests/test_asset_models_assemble.py
git commit -m "feat(asset-models): assemble plant GLBs (site, areas, items, environment, parts)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fixture plant spec and the 2 000-item budget probe

**Files:**
- Create: `backend/tests/plant_fixture.py`
- Create: `backend/tests/data/plant/fixture_plant_spec.json` (generated by the module)
- Test: `backend/tests/test_plant_fixture.py`, `backend/tests/test_asset_models_assemble_perf.py`

**Interfaces:**
- Consumes: Task 4 `assemble`, `write_csv`, `site_label`; F0 `validate`, `load_all`, `REGISTRY`; Task 6 `invalid_items` (the probe; see Step 7).
- Produces: `SITE`, `TYPES`, `COWORK_COUNTS`, `fixture_plant_spec()`, `synthetic_plant(n, *, types=None)`, `write_fixture()`, `build_fixture(out_dir)`, and the committed JSON. S1 and S3 load the JSON (or run `--build`) for their e2e.

- [ ] **Step 1: Write the failing fixture tests**

```python
# backend/tests/test_plant_fixture.py
"""The fixture plant (plan A1 task 5): committed JSON = the builder's output; every type once."""

import json

from plant_fixture import COWORK_COUNTS, FIXTURE, TYPES, build_fixture, fixture_plant_spec, synthetic_plant

from app.asset_models.builders import REGISTRY, load_all
from app.asset_models.jobs_glb import issue_item_id
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate


def test_committed_fixture_matches_the_builder():
    assert json.loads(FIXTURE.read_text("utf-8")) == fixture_plant_spec()


def test_fixture_is_a_valid_spec_covering_every_type():
    spec = AssetSpec.model_validate(fixture_plant_spec())
    assert 55 <= len(spec.items) <= 65
    assert {i.type for i in spec.items} == set(TYPES) | {"composite"}
    assert set(TYPES) == set(COWORK_COUNTS)
    assert {f.kind for f in spec.environment} == {"land", "sea", "road"}
    assert spec.site.crs.epsg == 32639
    assert len({i.id for i in spec.items}) == len(spec.items)


def test_fixture_errors_are_only_types_not_built_yet():
    load_all()
    spec = AssetSpec.model_validate(fixture_plant_spec())
    by_id = {i.id: i for i in spec.items}
    report = validate(spec)
    for issue in report.errors:
        assert by_id[issue_item_id(issue)].type not in REGISTRY, issue


def test_synthetic_plant_follows_coworks_mix():
    raw = synthetic_plant(2000)
    assert len(raw["items"]) == 2000 and len({i["id"] for i in raw["items"]}) == 2000
    pumps = sum(i["type"] == "pump" for i in raw["items"])
    assert abs(pumps - 2000 * 93 / 885) < 1
    only = synthetic_plant(10, types=("other", "pump"))
    assert [i["type"] for i in only["items"]].count("other") == 5
    AssetSpec.model_validate(raw)


def test_fixture_builds_a_glb_and_csv(tmp_path):
    glb, csv_path = build_fixture(tmp_path)
    assert glb.read_bytes()[:4] == b"glTF"
    lines = csv_path.read_text("utf-8").splitlines()
    assert len(lines) == 1 + len(fixture_plant_spec()["items"])
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `PY -m pytest tests\test_plant_fixture.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'plant_fixture'`. If Task 6 has not landed, the import `issue_item_id` also fails; Step 7 covers that order.

- [ ] **Step 3: Write `plant_fixture.py`**

```python
# backend/tests/plant_fixture.py
"""A small plant spec for tests and the Site 3D e2e (plan 2026-10-03-plant-model-a1, task 5), and a
synthetic plant of any size for the assembler's budget probe. Deterministic: no randomness.

From backend/: `python tests/plant_fixture.py` rewrites tests/data/plant/fixture_plant_spec.json;
`python tests/plant_fixture.py --build DIR` assembles it into DIR/fixture_plant.glb and .csv.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "data" / "plant" / "fixture_plant_spec.json"

SITE = {
    "crs": {"epsg": 32639, "wkt": None},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed", "note": "KIPIC Al-Zour plant grid, from the Cowork register"},
}

# Area -> plant (E, N) of its first item, laid out like Al-Zour's areas.
AREAS = {
    "10": (2250.0, 500.0),
    "20": (1250.0, 550.0),
    "30": (1050.0, 300.0),
    "50": (1500.0, 250.0),
    "70": (850.0, 250.0),
    "80": (650.0, 470.0),
}
ROW_WIDTH_M = 420.0
SYNTH_ROW_WIDTH_M = 1500.0
ROW_STEP_M = 140.0
GAP_M = 8.0
MARINE_BASE_EL = 93.56  # Al-Zour MSL: trestle and jetty structures stand in the sea
MARINE = frozenset({"trestle", "jetty_platform", "dolphin", "revetment"})

# type -> (footprint kind, (E extent or diameter, N extent), height m or None (flat), area, tag code)
TYPES: dict[str, tuple[str, tuple[float, float], float | None, str, str | None]] = {
    "trestle": ("line", (120.0, 13.5), 10.9, "10", None),
    "jetty_platform": ("rect", (60.0, 40.0), 10.9, "10", None),
    "dolphin": ("rect", (12.0, 12.0), 12.0, "10", None),
    "pipe_rack": ("line", (80.0, 9.0), 16.2, "30", None),
    "pipe_sleeper": ("line", (60.0, 2.0), 0.6, "30", None),
    "catwalk": ("line", (50.0, 1.5), 2.0, "10", None),
    "walkway": ("line", (30.0, 1.2), 2.0, "30", None),
    "stair_tower": ("rect", (3.0, 8.0), 16.2, "30", None),
    "overbridge": ("line", (20.0, 3.0), 6.0, "70", None),
    "platform": ("rect", (8.0, 6.0), 6.0, "30", None),
    "gangway": ("rect", (4.0, 20.0), 6.0, "10", "A"),
    "tank_lng": ("circle", (93.5, 93.5), 51.5, "20", "T"),
    "vessel_v": ("circle", (3.0, 3.0), 12.0, "30", "V"),
    "vessel_h": ("rect", (12.0, 3.5), 4.5, "30", "V"),
    "storage_tank_small": ("circle", (8.0, 8.0), 8.0, "70", "T"),
    "pump": ("rect", (3.0, 1.5), 2.0, "50", "P"),
    "pump_group": ("rect", (12.0, 6.0), 3.0, "50", "P"),
    "compressor": ("rect", (15.0, 8.0), 6.0, "30", "K"),
    "heater": ("rect", (10.0, 6.0), 12.0, "50", "H"),
    "vaporizer_orv": ("rect", (30.0, 10.0), 8.0, "50", "E"),
    "vaporizer_scv": ("rect", (12.0, 8.0), 10.0, "50", "E"),
    "stack": ("circle", (2.0, 2.0), 30.0, "70", "S"),
    "flare": ("circle", (3.0, 3.0), 90.0, "70", "F"),
    "loading_arm": ("rect", (4.0, 4.0), 18.0, "10", "L"),
    "crane": ("rect", (3.0, 3.0), 25.0, "10", "A"),
    "monitor": ("circle", (1.0, 1.0), 4.0, "10", "M"),
    "generator": ("rect", (15.5, 6.2), 4.0, "70", "G"),
    "transformer": ("rect", (5.0, 4.0), 4.0, "70", "TR"),
    "package": ("rect", (6.0, 4.0), 3.0, "70", "PK"),
    "nav_aid": ("circle", (1.5, 1.5), 8.0, "10", "N"),
    "building": ("rect", (40.0, 20.0), 8.0, "80", "B"),
    "substation": ("rect", (30.0, 15.0), 9.0, "80", "SS"),
    "analyzer_house": ("rect", (4.0, 3.0), 3.5, "30", "AH"),
    "shelter": ("rect", (67.0, 20.0), 20.6, "30", "BC"),
    "gate": ("rect", (10.0, 2.0), 3.0, "80", None),
    "road": ("line", (200.0, 7.0), None, "80", None),
    "paved": ("polygon", (40.0, 30.0), None, "70", None),
    "laydown": ("polygon", (50.0, 40.0), None, "70", None),
    "parking": ("polygon", (30.0, 15.0), None, "80", None),
    "trench": ("line", (60.0, 1.2), None, "50", None),
    "channel": ("line", (80.0, 3.0), None, "50", None),
    "basin": ("rect", (20.0, 10.0), None, "70", None),
    "wall": ("line", (50.0, 0.3), 3.0, "70", None),
    "fence": ("line", (150.0, 0.1), 2.4, "80", None),
    "revetment": ("line", (120.0, 8.0), None, "10", None),
    "other": ("polygon", (10.0, 8.0), 3.0, "70", None),
}

# Item count per type in Cowork's 885-row register (the synthetic plant's mix).
COWORK_COUNTS = {
    "package": 93, "pump": 93, "road": 71, "other": 56, "platform": 53, "paved": 42, "pipe_rack": 36,
    "pipe_sleeper": 33, "laydown": 28, "catwalk": 24, "dolphin": 24, "vessel_v": 24, "trench": 23,
    "crane": 21, "fence": 21, "heater": 15, "storage_tank_small": 14, "vessel_h": 14, "building": 13,
    "basin": 13, "walkway": 13, "stair_tower": 12, "shelter": 12, "vaporizer_orv": 12, "wall": 11,
    "parking": 11, "overbridge": 9, "loading_arm": 8, "jetty_platform": 8, "tank_lng": 8, "trestle": 7,
    "revetment": 7, "compressor": 6, "gate": 6, "generator": 5, "transformer": 5, "pump_group": 5,
    "channel": 5, "nav_aid": 4, "monitor": 4, "substation": 4, "analyzer_house": 3, "vaporizer_scv": 3,
    "stack": 3, "gangway": 2, "flare": 1,
}  # fmt: skip

FIXTURE_EXTRA = {"pump": 3, "vessel_v": 2, "tank_lng": 1, "package": 2, "road": 1, "pipe_rack": 1, "dolphin": 1}

ENVIRONMENT = [
    {
        "id": "env-land",
        "kind": "land",
        "pts": [[600.0, 200.0], [2150.0, 200.0], [2150.0, 900.0], [600.0, 900.0]],
        "el": 100.0,
        "source": {"kind": "assumed"},
        "confidence": "medium",
    },
    {
        "id": "env-sea",
        "kind": "sea",
        "pts": [[2150.0, 150.0], [2900.0, 150.0], [2900.0, 950.0], [2150.0, 950.0]],
        "el": 93.56,
        "source": {"kind": "assumed"},
        "confidence": "medium",
    },
    {
        "id": "env-ring-road",
        "kind": "road",
        "pts": [[640.0, 880.0], [2100.0, 880.0], [2100.0, 888.0], [640.0, 888.0]],
        "el": 100.0,
        "source": {"kind": "assumed"},
        "confidence": "medium",
    },
]

COMPOSITE_ITEM = {
    "id": "70-T-0099",
    "tag": "70-T-0099",
    "name": "HCL TANK",
    "type": "composite",
    "area": "70",
    "footprint": {"kind": "circle", "center": [880.0, 220.0], "d": 4.2},
    "base_el": 100.0,
    "top_el": 108.0,
    "height_source": "drawing",
    "source": {"kind": "drawing", "id": "fixture-sheet-70", "page": 1},
    "confidence": "high",
    "parts": [
        {
            "id": "shell",
            "name": "Shell",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 4000, "thickness": 10, "height": 8000},
            "source": {"kind": "assumed"},
        }
    ],
}


def _r(v: float) -> float:
    return round(float(v), 2)


def _footprint(kind: str, a: float, b: float, e: float, n: float) -> dict:
    if kind == "rect":  # size = (along, across); along = plant north at rot_deg 0
        return {"kind": "rect", "center": [_r(e + a / 2), _r(n + b / 2)], "size": [b, a], "rot_deg": 0.0}
    if kind == "circle":
        return {"kind": "circle", "center": [_r(e + a / 2), _r(n + a / 2)], "d": a}
    if kind == "line":
        return {"kind": "line", "pts": [[_r(e), _r(n + b / 2)], [_r(e + a), _r(n + b / 2)]], "width": b}
    pts = [[e, n], [e + a, n], [e + a, n + b], [e + a / 2, n + b * 1.25], [e, n + b]]
    return {"kind": "polygon", "pts": [[_r(x), _r(y)] for x, y in pts]}


def _items(counts: dict[str, int], origins: dict[str, tuple[float, float]] | None) -> list[dict]:
    tag_seq: dict[tuple[str, str], int] = {}
    type_seq: dict[str, int] = {}
    cursor: dict[str, tuple[float, int]] = {}
    items = []
    for type_, count in counts.items():
        kind, (a, b), height, area, code = TYPES[type_]
        for _ in range(count):
            key = area if origins is not None else "_"
            e0, n0 = origins[area] if origins is not None else (500.0, 0.0)
            width = ROW_WIDTH_M if origins is not None else SYNTH_ROW_WIDTH_M
            off, row = cursor.get(key, (0.0, 0))
            if off > 0 and off + a > width:
                off, row = 0.0, row + 1
            e, n = e0 + off, n0 + row * ROW_STEP_M
            cursor[key] = (off + a + GAP_M, row)
            k = type_seq[type_] = type_seq.get(type_, 0) + 1
            tag = None
            if code:
                t = tag_seq[(area, code)] = tag_seq.get((area, code), 0) + 1
                tag = f"{area}-{code}-{t:04d}"
            base = MARINE_BASE_EL if type_ in MARINE else (104.5 if area == "10" else 100.0)
            drawn = height is not None and k % 3 == 1
            items.append(
                {
                    "id": tag or f"{type_}-{k:03d}",
                    "tag": tag,
                    "name": f"{type_.replace('_', ' ').upper()} {k}",
                    "type": type_,
                    "area": area,
                    "footprint": _footprint(kind, a, b, e, n),
                    "base_el": base,
                    "top_el": _r(base + height) if drawn else None,
                    "height_source": "drawing" if drawn else "indicative",
                    "source": {"kind": "drawing", "id": f"fixture-sheet-{area}", "page": 1},
                    "confidence": "high" if drawn else "medium",
                }
            )
    return items


def _first(items: list[dict], type_: str) -> dict:
    return next(i for i in items if i["type"] == type_)


def fixture_plant_spec() -> dict:
    """58 items: every one of Cowork's 46 types at least once, a composite with an M1 part, two
    flagged items, a name with a comma and quotes, and land, sea and road environment features."""
    items = _items({t: 1 + FIXTURE_EXTRA.get(t, 0) for t in TYPES}, AREAS)
    _first(items, "pump")["flags"] = [
        {"code": "height_mismatch", "value": 0.8, "note": "Cloud top is 0.8 m above the drawing."}
    ]
    _first(items, "vessel_h")["flags"] = [
        {"code": "missing_in_cloud", "value": None, "note": "Scanned area, no points."}
    ]
    _first(items, "building")["name"] = 'CONTROL BUILDING, "MAIN"'
    items.append(json.loads(json.dumps(COMPOSITE_ITEM)))
    return {
        "asset": {"name": "Fixture plant", "type": "plant"},
        "site": json.loads(json.dumps(SITE)),
        "items": items,
        "environment": json.loads(json.dumps(ENVIRONMENT)),
    }


def _scaled(counts: dict[str, int], n: int) -> dict[str, int]:
    total = sum(counts.values())
    raw = {t: c * n / total for t, c in counts.items()}
    out = {t: int(v) for t, v in raw.items()}
    for t in sorted(raw, key=lambda t: (-(raw[t] - out[t]), t))[: n - sum(out.values())]:
        out[t] += 1
    return out


def synthetic_plant(n: int = 2000, *, types: Sequence[str] | None = None) -> dict:
    """`n` items in Cowork's type mix (or cycling `types`), on one non-overlapping grid."""
    if types:
        counts = {t: 0 for t in types}
        for k in range(n):
            counts[types[k % len(types)]] += 1
    else:
        counts = _scaled(COWORK_COUNTS, n)
    return {
        "asset": {"name": f"Synthetic plant ({n} items)", "type": "plant"},
        "site": json.loads(json.dumps(SITE)),
        "items": _items(counts, None),
        "environment": json.loads(json.dumps(ENVIRONMENT)),
    }


def write_fixture() -> Path:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(fixture_plant_spec(), indent=1) + "\n", encoding="utf-8")
    return FIXTURE


def build_fixture(out_dir: Path) -> tuple[Path, Path]:
    from app.asset_models.assemble import assemble, site_label, write_csv
    from app.asset_models.spec import AssetSpec

    spec = AssetSpec.model_validate(fixture_plant_spec())
    a = assemble(spec)
    out_dir.mkdir(parents=True, exist_ok=True)
    glb, csv_path = out_dir / "fixture_plant.glb", out_dir / "fixture_plant.csv"
    glb.write_bytes(a.glb)
    write_csv(a.rows, csv_path, site_label=site_label(spec))
    return glb, csv_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--build", type=Path, help="assemble the fixture into this folder instead")
    args = ap.parse_args(argv)
    if args.build:
        for p in build_fixture(args.build):
            print(p)
    else:
        print(write_fixture())
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/, for `app`
    raise SystemExit(main())
```

- [ ] **Step 4: Generate the committed JSON**

Run (from backend): `PY tests\plant_fixture.py`
Expected: prints `...\backend\tests\data\plant\fixture_plant_spec.json`. Open it and check that it has 58 items, the `site` block and 3 environment features.

- [ ] **Step 5: Write the budget probe test**

```python
# backend/tests/test_asset_models_assemble_perf.py
"""Spec §7 budget: a 2 000-item plant validates and assembles in under 2 minutes and 1.5 GB of RAM.
Run in a fresh interpreter so the peak working set is this build's alone (Windows `peak_wset`)."""

import json
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PROBE = r"""
import json, sys, time
sys.path.insert(0, "tests")
import psutil
from plant_fixture import synthetic_plant
from app.asset_models.assemble import assemble
from app.asset_models.jobs_glb import invalid_items
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate

spec = AssetSpec.model_validate(synthetic_plant(2000))
t0 = time.perf_counter()
report = validate(spec)
a = assemble(spec, invalid=invalid_items(report, spec))
seconds = time.perf_counter() - t0
info = psutil.Process().memory_info()
peak = getattr(info, "peak_wset", None) or info.rss
print(json.dumps({"seconds": seconds, "peak": peak, "items": a.meta["items"],
                  "triangles": a.meta["triangles"], "glb": len(a.glb), "fallbacks": a.meta["fallback_count"]}))
"""


def test_two_thousand_items_build_within_budget():
    r = subprocess.run(
        [sys.executable, "-c", PROBE], cwd=BACKEND, capture_output=True, text=True, timeout=600
    )
    assert r.returncode == 0, r.stderr[-3000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    print(out)  # shown with -s: the numbers for the report
    assert out["items"] == 2000
    assert out["seconds"] < 120, out
    assert out["peak"] < 1.5 * 1024**3, out
```

- [ ] **Step 6: Run the fixture tests and the probe**

Run: `PY -m pytest tests\test_plant_fixture.py tests\test_asset_models_assemble_perf.py -v -s`
Expected: all pass. The probe prints `seconds`, `peak` and `triangles`; put these numbers in the task report. If the budget fails, profile before changing anything. Use `PY -X importtime` and `cProfile` on the probe script, and check `validate()` first: it is F0's pairwise overlap check. A fix there is a shared-file touch on `validate.py` (pre-filter pairs by bounding boxes sorted on plant E) and is reported as such.

- [ ] **Step 7: If Task 6 has not landed yet**

`invalid_items` and `issue_item_id` come from Task 6. When running Task 5 first, temporarily replace those imports with local stand-ins. In the probe: `invalid = {}`. In `test_fixture_errors_are_only_types_not_built_yet`: `issue_item_id = lambda i: getattr(i, "item_id", None) or i.part_id`. Task 6 Step 9 restores the imports. Never commit the stand-ins if Task 6 is already on the branch.

- [ ] **Step 8: Lint and commit**

Run: `PY -m ruff check tests\plant_fixture.py tests\test_plant_fixture.py tests\test_asset_models_assemble_perf.py` and `PY -m ruff format --check tests\plant_fixture.py tests\test_plant_fixture.py tests\test_asset_models_assemble_perf.py`
Expected: no findings.

```bash
git add backend/tests/plant_fixture.py backend/tests/data/plant/fixture_plant_spec.json backend/tests/test_plant_fixture.py backend/tests/test_asset_models_assemble_perf.py
git commit -m "test(asset-models): fixture plant spec and the 2000-item assembly budget" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The GLB job: dispatch, validation in the job, files, index

**Files:**
- Modify: `backend/app/asset_models/assemble.py` (append `index_items`)
- Modify: `backend/app/asset_models/store.py` (after `version_glb_path`)
- Modify: `backend/app/asset_models/jobs_glb.py` (whole module body; M1 behaviour kept)
- Modify (only if Task 1 found it missing): `backend/app/asset_models/service.py`
- Modify: `backend/tests/plant_helpers.py` (append `Ctx`, `seed_version`, `read_csv`)
- Test: `backend/tests/test_asset_models_plant_job.py`

**Interfaces:**
- Consumes: Task 3 `write_csv`, `site_label`; Task 4 `assemble`, `AssembleError`; F0 `validate`, `AssetItem`; M1 `build_glb`, `store`, `register_job_type`, `JobCancelled`, `JobFailure`, `Drawing`.
- Produces: `index_items`, `store.version_csv_path`, `store.version_meta_path`, `jobs_glb.issue_item_id`, `jobs_glb.invalid_items`, and the `run_glb` dispatch. Task 7 adds the `fill_frame` call inside it.

- [ ] **Step 1: Extend the test helpers**

Append to `backend/tests/plant_helpers.py`:

```python
import csv  # noqa: E402 - appended helpers for the job tests

from app.db.models import AssetModel, AssetModelVersion  # noqa: E402
from app.jobs.cancellation import JobCancelled  # noqa: E402


class Ctx:
    """A stand-in job context; `cancel_after` makes the n+1-th cancel check raise."""

    def __init__(self, handle, params, cancel_after: int | None = None):
        self.project, self.params, self.job_id = handle, params, "job-glb"
        self.published: list = []
        self.messages: list = []
        self._checks = 0
        self._cancel_after = cancel_after

    def progress(self, fraction, message=""):
        self.messages.append((fraction, message))

    def publish(self, type_, payload):
        self.published.append((type_, payload))

    def check_cancelled(self):
        self._checks += 1
        if self._cancel_after is not None and self._checks > self._cancel_after:
            raise JobCancelled()


def seed_version(handle, spec: dict, *, model_id: str | None = None, version: int = 1, glb_status="pending") -> str:
    with handle.session() as s:
        if model_id is None:
            model = AssetModel(name="Plant", status="ready", current_version=version)
            s.add(model)
            s.flush()
            model_id = model.id
        s.add(
            AssetModelVersion(
                model_id=model_id,
                version=version,
                spec=spec,
                kind="manual",
                glb_status=glb_status,
                source_ids=[],
                part_count=len(spec.get("parts", [])),
            )
        )
    return model_id


def read_csv(path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))
```

Then move the three new imports to the top import block of the file (ruff's `I` rule sorts them) and drop the `noqa` comments.

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_asset_models_plant_job.py
"""The asset_model_glb job on plant specs (spec §7, §9; plan A1 task 6)."""

import json

import pytest
from plant_fixture import synthetic_plant
from plant_helpers import Ctx, parse, read_csv, seed_version
from sqlalchemy import func, select

from app.asset_models import store
from app.asset_models.jobs_glb import issue_item_id, run_glb
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate
from app.db.models import AssetItem, Drawing
from app.jobs.cancellation import JobCancelled, JobFailure

M1_SPEC = {
    "parts": [
        {
            "id": "s",
            "name": "s",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 1000, "thickness": 10, "height": 2000},
            "source": {"kind": "assumed"},
        }
    ]
}


def index_rows(handle, mid, version=1):
    with handle.session() as s:
        rows = s.scalars(
            select(AssetItem).where(AssetItem.model_id == mid, AssetItem.version == version).order_by(AssetItem.id)
        ).all()
        s.expunge_all()
        return rows


def no_tmp(handle, mid):
    return not list(store.model_dir(handle, mid).glob("*.tmp"))


def test_plant_version_writes_glb_csv_meta_and_index(handle):
    spec = synthetic_plant(5, types=("other",))
    mid = seed_version(handle, spec)
    ctx = Ctx(handle, {"model_id": mid, "version": 1})
    assert run_glb(ctx) == {"model_id": mid, "version": 1}
    doc, _ = parse(store.version_glb_path(handle, mid, 1).read_bytes())
    ids = [i["id"] for i in spec["items"]]
    assert set(ids) <= {n["name"] for n in doc["nodes"]}
    rows = read_csv(store.version_csv_path(handle, mid, 1))
    assert [r["node"] for r in rows] == ids and "utm39_E" in rows[0]
    meta = json.loads(store.version_meta_path(handle, mid, 1).read_text("utf-8"))
    with handle.session() as s:
        v = store.get_version(s, mid, 1)
        assert v.glb_status == "ready" and v.meta == meta
    idx = index_rows(handle, mid)
    assert [r.node for r in idx] == ids
    assert all(r.site_x is not None and r.lat is not None and r.has_geometry for r in idx)
    assert meta["items"] == 5 and meta["environment"] == 3 and meta["validation"]["error_count"] == 0
    assert no_tmp(handle, mid)
    assert ("asset_models.changed", {"asset_model_ids": [mid]}) in ctx.published


def test_rebuild_replaces_the_index_rows(handle):
    mid = seed_version(handle, synthetic_plant(5, types=("other",)))
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    assert len(index_rows(handle, mid)) == 5


def test_m1_spec_keeps_build_glb_and_writes_a_header_only_csv(handle):
    mid = seed_version(handle, M1_SPEC)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    lines = store.version_csv_path(handle, mid, 1).read_text("utf-8").splitlines()
    assert len(lines) == 1 and lines[0].startswith("node,tag,name,") and "site_E" in lines[0]
    with handle.session() as s:
        assert store.get_version(s, mid, 1).meta["top_m"] == pytest.approx(2.0)
    assert store.version_meta_path(handle, mid, 1).exists() and index_rows(handle, mid) == []


def test_duplicate_item_ids_fail_the_job(handle):
    spec = synthetic_plant(5, types=("other",))
    spec["items"][1]["id"] = spec["items"][0]["id"]
    mid = seed_version(handle, spec)
    with pytest.raises(JobFailure, match="could not be built"):
        run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"
    assert not store.version_glb_path(handle, mid, 1).exists() and no_tmp(handle, mid)
    assert index_rows(handle, mid) == []


def test_cancel_mid_build_marks_failed_and_leaves_no_tmp(handle):
    mid = seed_version(handle, synthetic_plant(60, types=("other",)))
    with pytest.raises(JobCancelled):
        run_glb(Ctx(handle, {"model_id": mid, "version": 1}, cancel_after=1))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"
    assert not store.version_glb_path(handle, mid, 1).exists()
    assert no_tmp(handle, mid) and index_rows(handle, mid) == []


def test_source_sheet_is_the_drawing_name(handle):
    with handle.session() as s:
        d = Drawing(name="P0058LNG-00-40-0-T0006", format="pdf", source_path="C:/x/a.pdf", source_size=1)
        s.add(d)
        s.flush()
        drawing_id = d.id
    spec = synthetic_plant(2, types=("other",))
    spec["items"][0]["source"] = {"kind": "drawing", "id": drawing_id}
    spec["items"][1]["source"] = {"kind": "drawing", "id": "gone"}
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    rows = read_csv(store.version_csv_path(handle, mid, 1))
    assert [r["source_sheet"] for r in rows] == ["P0058LNG-00-40-0-T0006", "gone"]


def test_validation_errors_are_summarised_not_fatal(handle):
    spec = synthetic_plant(3, types=("other",))
    spec["items"][0]["type"] = "no_such_type"
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    with handle.session() as s:
        meta = store.get_version(s, mid, 1).meta
    assert meta["validation"]["error_count"] >= 1 and meta["fallback_count"] >= 1
    [row] = [r for r in index_rows(handle, mid) if r.node == spec["items"][0]["id"]]
    assert row.type == "no_such_type" and "builder_fallback" in {f["code"] for f in row.flags}


def test_assemble_survives_broken_item(handle):
    """Index Review Focus #4: 2 000 items, one NaN param, one zero-length line, one bow-tie polygon."""
    spec = synthetic_plant(2000, types=("other",))
    ids = [i["id"] for i in spec["items"]]
    spec["items"][10]["type"] = "pipe_rack"
    spec["items"][10]["params"] = {"tiers": float("nan")}
    spec["items"][20]["footprint"] = {"kind": "line", "pts": [[1000.0, 500.0], [1000.0, 500.0]], "width": 2.0}
    spec["items"][30]["footprint"] = {"kind": "polygon", "pts": [[0, 0], [10, 10], [10, 0], [0, 10]]}
    report = validate(AssetSpec.model_validate(spec))
    assert ids[30] in {issue_item_id(i) for i in report.errors}  # the validator reports the bow-tie
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "ready"
        assert s.scalar(select(func.count()).select_from(AssetItem).where(AssetItem.model_id == mid)) == 2000
    by = {r.node: r for r in index_rows(handle, mid)}
    for broken in (ids[10], ids[30]):
        assert "builder_fallback" in {f["code"] for f in by[broken].flags}
    assert ids[20] in by
    csv_rows = read_csv(store.version_csv_path(handle, mid, 1))
    assert len(csv_rows) == 2000 and {ids[10], ids[20], ids[30]} <= {r["node"] for r in csv_rows}
    doc, _ = parse(store.version_glb_path(handle, mid, 1).read_bytes())
    names = {n["name"] for n in doc["nodes"]}
    assert {ids[10], ids[20], ids[30]} <= names
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `PY -m pytest tests\test_asset_models_plant_job.py -v`
Expected: collection error `ImportError: cannot import name 'issue_item_id' from 'app.asset_models.jobs_glb'`.

- [ ] **Step 4: Add the store paths**

In `backend/app/asset_models/store.py`, directly after `def version_glb_path(...)`:

```python
def version_csv_path(handle, model_id: str, version: int) -> Path:
    return model_dir(handle, model_id) / f"v{int(version)}.csv"


def version_meta_path(handle, model_id: str, version: int) -> Path:
    return model_dir(handle, model_id) / f"v{int(version)}.meta.json"
```

- [ ] **Step 5: Add `index_items` to `assemble.py`**

Add `from sqlalchemy import delete, insert`, `from sqlalchemy.orm import Session` and `from app.db.models import AssetItem` to the import block. Then append:

```python
INDEX_CHUNK = 500


def index_items(s: Session, model_id: str, version: int, rows: list[dict]) -> int:
    """Replace the version's `asset_item` rows with `rows` (spec §9). Returns the count written."""
    s.execute(delete(AssetItem).where(AssetItem.model_id == model_id, AssetItem.version == version))
    payload = [
        {
            "model_id": model_id,
            "version": version,
            "node": r["node"],
            "tag": r["tag"],
            "name": r["name"],
            "type": r["type"],
            "area": r["area"],
            "plant_e": r["plant_E"],
            "plant_n": r["plant_N"],
            "site_x": r["utm39_E"],
            "site_y": r["utm39_N"],
            "lon": r["lon"],
            "lat": r["lat"],
            "base_el": r["base_EL"],
            "top_el": r["top_EL"],
            "height_source": r["height_source"],
            "confidence": r["confidence"],
            "flags": r["flags"],
            "source_sheet": r["source_sheet"],
            "has_geometry": bool(r["has_geometry"]),
        }
        for r in rows
    ]
    for k in range(0, len(payload), INDEX_CHUNK):
        s.execute(insert(AssetItem), payload[k : k + INDEX_CHUNK])
    return len(payload)
```

- [ ] **Step 6: Rewrite `jobs_glb.py`**

```python
"""`asset_model_glb` (spec 2026-10-02 §6.4, widened by 2026-10-03-plant-model-generator §7): build one
stored version's GLB, register CSV and meta atomically. A plant spec (items or environment) is
validated here, not in the request (§5), and built by the assembler, which also feeds the
`asset_item` index; an M1 spec goes through `build_glb` and gets a header-only CSV."""

from __future__ import annotations

import dataclasses
import json
import os

from sqlalchemy import select

from app.asset_models import store
from app.asset_models.assemble import AssembleError, assemble, index_items, site_label, write_csv
from app.asset_models.build import build_glb
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate
from app.db.models import Drawing
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type

GLB_JOB = "asset_model_glb"
FATAL_CODES = frozenset({"duplicate_id", "too_many_items"})  # task 1: F0's codes for these two
MAX_ISSUES = 100
ID_CHUNK = 500


def _mark_failed(ctx) -> None:
    with ctx.project.session() as s:
        store.get_version(s, ctx.params["model_id"], int(ctx.params["version"])).glb_status = "failed"
    ctx.publish("asset_models.changed", {"asset_model_ids": [ctx.params["model_id"]]})


def _cancelled_before_start(ctx) -> None:
    _mark_failed(ctx)


def _cleanup(paths) -> None:
    for p in paths:
        p.unlink(missing_ok=True)


def issue_item_id(issue) -> str | None:
    """The item a validation issue is about (F0 may name the field `item_id` or reuse `part_id`)."""
    return getattr(issue, "item_id", None) or getattr(issue, "part_id", None)


def invalid_items(report, spec: AssetSpec) -> dict[str, str]:
    ids = {i.id for i in spec.items}
    out: dict[str, str] = {}
    for issue in report.errors:
        item_id = issue_item_id(issue)
        if item_id in ids:
            out.setdefault(item_id, issue.message)
    return out


def _sheet_names(s, spec: AssetSpec) -> dict[str, str]:
    ids = sorted({i.source.id for i in spec.items if i.source.kind == "drawing" and i.source.id})
    out: dict[str, str] = {}
    for k in range(0, len(ids), ID_CHUNK):
        rows = s.execute(select(Drawing.id, Drawing.name).where(Drawing.id.in_(ids[k : k + ID_CHUNK]))).all()
        out.update({r[0]: r[1] for r in rows})
    return out


def _plant(ctx, spec: AssetSpec, names: dict[str, str], n: int) -> tuple[bytes, dict, list[dict]]:
    report = validate(spec)
    fatal = [i for i in report.errors if i.code in FATAL_CODES]
    if fatal:
        raise AssembleError(fatal[0].message)

    def progress(fraction: float) -> None:
        ctx.check_cancelled()
        ctx.progress(0.05 + 0.85 * fraction, f"Building version {n}: items")

    a = assemble(spec, progress=progress, sheet_names=names, invalid=invalid_items(report, spec))
    a.meta["validation"] = {
        "error_count": len(report.errors),
        "warning_count": len(report.warnings),
        "errors": [dataclasses.asdict(i) for i in report.errors[:MAX_ISSUES]],
        "warnings": [dataclasses.asdict(i) for i in report.warnings[:MAX_ISSUES]],
    }
    return a.glb, a.meta, a.rows


@register_job_type(GLB_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_glb(ctx) -> dict:
    mid, n = ctx.params["model_id"], int(ctx.params["version"])
    ctx.progress(0, f"Building the 3D model for version {n}")
    paths = [
        store.version_glb_path(ctx.project, mid, n),
        store.version_csv_path(ctx.project, mid, n),
        store.version_meta_path(ctx.project, mid, n),
    ]
    tmps = [p.with_name(p.name + ".tmp") for p in paths]
    try:
        with ctx.project.session() as s:
            spec = AssetSpec.model_validate(store.get_version(s, mid, n).spec)
            names = _sheet_names(s, spec)
        if spec.items or spec.environment:
            glb, meta, rows = _plant(ctx, spec, names, n)
        else:
            glb, meta = build_glb(spec)
            rows = []
        paths[0].parent.mkdir(parents=True, exist_ok=True)
        tmps[0].write_bytes(glb)
        write_csv(rows, tmps[1], site_label=site_label(spec))
        tmps[2].write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        for tmp, path in zip(tmps, paths, strict=True):
            os.replace(tmp, path)
        with ctx.project.session() as s:
            index_items(s, mid, n, rows)
            v = store.get_version(s, mid, n)
            v.glb_status, v.meta = "ready", meta
    except JobCancelled:
        _cleanup(tmps)
        _mark_failed(ctx)
        raise
    except AssembleError as e:
        _cleanup(tmps)
        _mark_failed(ctx)
        raise JobFailure(f"The 3D model could not be built: {e}") from None
    except Exception as e:
        _cleanup(tmps)
        _mark_failed(ctx)
        raise JobFailure(f"The 3D model could not be built: {type(e).__name__}") from None
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Built version {n}: {meta['triangles']:,} triangles")
    return {"model_id": mid, "version": n}
```

Check that `FATAL_CODES` holds the codes Task 1 recorded. If F0's duplicate-id error comes from the schema rather than `validate()`, keep `AssembleError` from `assemble()` as the only guard.

- [ ] **Step 7: Run the job tests and M1's job tests**

Run: `PY -m pytest tests\test_asset_models_plant_job.py tests\test_asset_models_glb_job.py tests\test_asset_models_api.py -v`
Expected: all pass. M1's `test_failed_write_leaves_no_tmp` and `test_job_failure_marks_version_failed` still pass unchanged.

- [ ] **Step 8: Request-path validation for large specs (only if Task 1 found it missing)**

Add a test to `backend/tests/test_asset_models_plant_job.py`:

```python
def test_large_spec_version_create_skips_request_validation(client, project_id, monkeypatch):
    import app.asset_models.service as service

    def boom(_spec):
        raise AssertionError("validate ran in the request")

    monkeypatch.setattr(service, "validate", boom)
    base = f"/api/v1/projects/{project_id}/asset-models"
    mid = client.post(base, json={"name": "Plant"}).json()["id"]
    r = client.post(f"{base}/{mid}/versions", json={"spec": synthetic_plant(250, types=("other",))})
    assert r.status_code == 201, r.text
```

Then in `backend/app/asset_models/service.py`, add `LARGE_SPEC_ITEMS = 200` with the comment `# spec §5: larger specs are validated in the GLB job, never in the request`. Change the start of `add_version` to:

```python
    if len(spec.items) <= LARGE_SPEC_ITEMS:
        report = validate(spec)
        if not report.ok:
            raise AppError("invalid_spec", "The model spec has errors.", 422, {"errors": issues(report.errors)})
```

Run: `PY -m pytest tests\test_asset_models_plant_job.py::test_large_spec_version_create_skips_request_validation tests\test_asset_models_api.py -v`
Expected: PASS.

- [ ] **Step 9: Restore Task 5's imports if stand-ins were used**

If Task 5 ran with the Step 7 stand-ins, put back `from app.asset_models.jobs_glb import invalid_items` (probe) and `issue_item_id` (fixture test). Run: `PY -m pytest tests\test_plant_fixture.py tests\test_asset_models_assemble_perf.py -v`
Expected: PASS.

- [ ] **Step 10: Lint and commit**

Run: `PY -m ruff check app\asset_models tests\plant_helpers.py tests\test_asset_models_plant_job.py` and `PY -m ruff format --check app\asset_models tests\plant_helpers.py tests\test_asset_models_plant_job.py`
Expected: no findings.

```bash
git add backend/app/asset_models/assemble.py backend/app/asset_models/store.py backend/app/asset_models/jobs_glb.py backend/tests/plant_helpers.py backend/tests/test_asset_models_plant_job.py
git commit -m "feat(asset-models): plant GLB job writes the CSV, meta and item index; validates in the job" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add `backend/app/asset_models/service.py` (and the Task 5 files, if Step 9 touched them) to the `git add` when Step 8 or 9 applied.

---

### Task 7: Fill P1's frame from the plant site

**Files:**
- Create: `backend/app/asset_models/plant_frame.py`
- Modify: `backend/app/asset_models/jobs_glb.py` (one import, one call)
- Test: `backend/tests/test_asset_models_plant_frame.py`

**Interfaces:**
- Consumes: P1 `app.asset_review.frame.Frame`, `Origin`, `AssetModel.frame`; F0 `PlantGrid.site_to_lonlat`, `.convergence_deg`, `GridError`; M1 `store.get_model`; Task 6 `run_glb`.
- Produces: `plant_frame(spec, meta) -> dict | None`, `fill_frame(s, model_id, spec, meta) -> bool` (never raises).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_models_plant_frame.py
"""A plant version fills P1's asset frame when it is null (spec §9; plan A1 task 7)."""

import pytest
from plant_fixture import synthetic_plant
from plant_helpers import Ctx, seed_version

import app.asset_models.plant_frame as plant_frame_mod
from app.asset_models import store
from app.asset_models.jobs_glb import run_glb

frame_mod = pytest.importorskip("app.asset_review.frame")


def frame_of(handle, mid):
    with handle.session() as s:
        return store.get_model(s, mid).frame


def build(handle, spec):
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    return mid


def test_plant_version_fills_a_null_frame(handle):
    spec = synthetic_plant(5, types=("other",))
    spec["site"]["cloud_z_to_el"] = {"cloud_id": "c1", "offset_m": 120.45}
    f = frame_mod.Frame.model_validate(frame_of(handle, build(handle, spec)))
    assert f.origin.lat == pytest.approx(28.71769, abs=1e-4)
    assert f.origin.lon == pytest.approx(48.38271, abs=1e-4)
    assert f.north_offset_deg == pytest.approx(17.9991 - 1.25828, abs=0.01)  # plant north, true bearing
    assert f.origin.ground_alt_m == pytest.approx(100.0 - 120.45)
    assert f.datum_label == "HPFS" and f.height_m > 0
    assert f.silhouette == [] and f.levels == [] and f.presets == []


def test_unfitted_altitude_is_zero_and_noted(handle):
    f = frame_mod.Frame.model_validate(frame_of(handle, build(handle, synthetic_plant(3, types=("other",)))))
    assert f.origin.ground_alt_m == 0.0 and "not fitted" in f.datum_note


def test_existing_frame_is_left_alone(handle):
    spec = synthetic_plant(3, types=("other",))
    mid = seed_version(handle, spec)
    preset = frame_mod.Frame(height_m=5.0, datum_label="Operator").model_dump(mode="json")
    with handle.session() as s:
        store.get_model(s, mid).frame = preset
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    assert frame_of(handle, mid) == preset


def test_no_site_leaves_the_frame_null(handle):
    spec = synthetic_plant(3, types=("other",))
    spec["site"] = None
    assert frame_of(handle, build(handle, spec)) is None


def test_no_crs_has_no_origin(handle):
    spec = synthetic_plant(3, types=("other",))
    spec["site"]["crs"] = {"epsg": None, "wkt": None}
    f = frame_mod.Frame.model_validate(frame_of(handle, build(handle, spec)))
    assert f.origin is None and f.north_offset_deg == pytest.approx(17.9991)


def test_frame_failure_never_fails_the_build(handle, monkeypatch):
    def boom(_spec, _meta):
        raise RuntimeError("frame")

    monkeypatch.setattr(plant_frame_mod, "plant_frame", boom)
    mid = build(handle, synthetic_plant(3, types=("other",)))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "ready"
    assert frame_of(handle, mid) is None
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `PY -m pytest tests\test_asset_models_plant_frame.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.asset_models.plant_frame'`. If P1 is not on the base, the module is skipped: implement anyway (Step 3) and report "P1 frame fill implemented behind an ImportError guard; tests skipped: P1 absent" as a hand-off.

- [ ] **Step 3: Write `plant_frame.py`**

```python
# backend/app/asset_models/plant_frame.py
"""Fill P1's `asset_model.frame` from a plant version's site (spec 2026-10-03-plant-model-generator §9).

Only when the frame is null, only through P1's `Frame` (so it validates), and never `silhouette`,
`levels` or `presets` (J1 derives those). A failure here is logged and never fails the GLB build.
"""

from __future__ import annotations

import logging

import numpy as np

from app.asset_models import store
from app.asset_models.siteframe import GridError, PlantGrid
from app.asset_models.spec import AssetSpec

log = logging.getLogger(__name__)
MIN_HEIGHT_M = 0.1


def plant_frame(spec: AssetSpec, meta: dict) -> dict | None:
    """A `Frame` dump for this plant, or None without a site or without P1's frame module."""
    try:
        from app.asset_review.frame import Frame, Origin
    except ImportError:
        return None
    site = spec.site
    if site is None:
        return None
    grid = PlantGrid(site)
    if site.cloud_z_to_el is not None:
        alt, note = site.datum.el_m - site.cloud_z_to_el.offset_m, "Ground altitude from the cloud datum fit."
    else:
        alt, note = 0.0, "Ground altitude not fitted (no cloud datum)."
    try:
        lon, lat = grid.site_to_lonlat(np.array([site.origin_crs[0]]), np.array([site.origin_crs[1]]))
        origin = Origin(lat=float(lat[0]), lon=float(lon[0]), ground_alt_m=float(alt))
        offset = site.plant_north_deg + grid.convergence_deg()  # true bearing of plant north
    except GridError:
        origin, offset = None, site.plant_north_deg
    top = float(meta["bounds_m"][1][1])
    frame = Frame(
        origin=origin,
        north_offset_deg=offset,
        height_m=max(top, MIN_HEIGHT_M),
        datum_label=site.datum.label,
        datum_note=note,
    )
    return frame.model_dump(mode="json")


def fill_frame(s, model_id: str, spec: AssetSpec, meta: dict) -> bool:
    """Write the frame when the model has P1's column and it is null. Never raises."""
    try:
        model = store.get_model(s, model_id)
        if getattr(model, "frame", "absent") is not None:  # set already, or no P1 column
            return False
        frame = plant_frame(spec, meta)
        if frame is None:
            return False
        model.frame = frame
        return True
    except Exception:
        log.warning("plant frame fill skipped for an asset model (%s)", "error")
        return False
```

- [ ] **Step 4: Call it from the job**

In `backend/app/asset_models/jobs_glb.py`, add `from app.asset_models import plant_frame` to the imports. Inside the final `with ctx.project.session() as s:` block of `run_glb`, after `v.glb_status, v.meta = "ready", meta`, add:

```python
            if spec.site is not None:
                plant_frame.fill_frame(s, mid, spec, meta)
```

(Calling it as `plant_frame.fill_frame` keeps the module's `plant_frame` function patchable in tests.)

- [ ] **Step 5: Run the tests**

Run: `PY -m pytest tests\test_asset_models_plant_frame.py tests\test_asset_models_plant_job.py -v`
Expected: all pass (or the frame tests skip with "P1 absent", which is then reported).

- [ ] **Step 6: Lint and commit**

Run: `PY -m ruff check app\asset_models tests\test_asset_models_plant_frame.py` and `PY -m ruff format --check app\asset_models tests\test_asset_models_plant_frame.py`
Expected: no findings.

```bash
git add backend/app/asset_models/plant_frame.py backend/app/asset_models/jobs_glb.py backend/tests/test_asset_models_plant_frame.py
git commit -m "feat(asset-models): fill a null asset frame from the plant site" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Items, item and CSV routes

**Files:**
- Create: `backend/app/asset_models/items.py`
- Modify: `backend/app/asset_models/stubs_plant.py` (delete A1's tuples)
- Modify: `backend/app/api.py` (insert one module line)
- Modify (only if Task 1 found it missing): `backend/app/asset_models/router.py` (`get_asset_model_version`)
- Test: `backend/tests/test_asset_models_items_api.py`

**Interfaces:**
- Consumes: F0 `AssetItem`, `Item`, `FlagCode`, contract schemas `AssetItemPage`/`AssetItemRow`/`AssetItem`; M1 `store.get_version`, `store.INT32_MAX`, `get_project`, `AppError`, `not_found`; Task 6 `store.version_csv_path` and the index.
- Produces: operations `listAssetModelItems`, `getAssetModelItem` and `getAssetModelCsv`, live.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_models_items_api.py
"""The items, item and CSV routes (spec §10; plan A1 task 8)."""

from pathlib import Path

import pytest
import yaml
from plant_fixture import fixture_plant_spec, synthetic_plant
from plant_helpers import Ctx, seed_version

from app.asset_models.items import AssetItemRowOut
from app.asset_models.jobs_glb import run_glb

CONTRACT = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"


@pytest.fixture
def plant(handle):
    spec = fixture_plant_spec()
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    return mid, spec


def url(pid, mid, tail="", version=1):
    return f"/api/v1/projects/{pid}/asset-models/{mid}/versions/{version}{tail}"


def ids_of(client, u, **params):
    r = client.get(u, params={"limit": 500, **params})
    assert r.status_code == 200, r.text
    return [i["id"] for i in r.json()["items"]]


def test_row_fields_match_the_contract():
    doc = yaml.safe_load(CONTRACT.read_text("utf-8"))
    assert set(doc["components"]["schemas"]["AssetItemRow"]["properties"]) == set(AssetItemRowOut.model_fields)


def test_pages_follow_the_cursor_in_spec_order(client, project_id, plant):
    mid, spec = plant
    page = client.get(url(project_id, mid, "/items"), params={"limit": 20}).json()
    assert len(page["items"]) == 20 and page["next_cursor"]
    seen = [i["id"] for i in page["items"]]
    while page["next_cursor"]:
        page = client.get(url(project_id, mid, "/items"), params={"limit": 20, "cursor": page["next_cursor"]}).json()
        seen += [i["id"] for i in page["items"]]
    assert seen == [i["id"] for i in spec["items"]]


def test_limit_is_capped_at_500(client, project_id, plant):
    mid, _ = plant
    assert client.get(url(project_id, mid, "/items"), params={"limit": 501}).status_code == 422


def test_filters(client, project_id, plant):
    mid, spec = plant
    u = url(project_id, mid, "/items")
    items = spec["items"]
    tanks = [i["id"] for i in items if i["type"] == "tank_lng"]
    assert ids_of(client, u, q="20-t") == tanks
    assert ids_of(client, u, q="control building") == [i["id"] for i in items if i["type"] == "building"][:1]
    assert ids_of(client, u, type="pump") == [i["id"] for i in items if i["type"] == "pump"]
    assert ids_of(client, u, area="80") == [i["id"] for i in items if i["area"] == "80"]
    assert ids_of(client, u, flag="height_mismatch") == [next(i["id"] for i in items if i["type"] == "pump")]
    assert ids_of(client, u, bbox="1200,500,1500,700") == tanks
    assert ids_of(client, u, q="100%_") == []


def test_bad_bbox_and_cursor_are_422(client, project_id, plant):
    mid, _ = plant
    u = url(project_id, mid, "/items")
    for params, code in (
        ({"bbox": "1,2,3"}, "invalid_bbox"),
        ({"bbox": "5,0,1,1"}, "invalid_bbox"),
        ({"bbox": "a,b,c,d"}, "invalid_bbox"),
        ({"cursor": "abc"}, "invalid_cursor"),
    ):
        r = client.get(u, params=params)
        assert r.status_code == 422 and r.json()["error"]["code"] == code, params


def test_unknown_model_or_version_is_404(client, project_id, plant):
    mid, _ = plant
    assert client.get(url(project_id, "missing", "/items")).status_code == 404
    assert client.get(url(project_id, mid, "/items", version=9)).status_code == 404
    assert client.get(url(project_id, mid, "/csv", version=9)).status_code == 404


def test_rows_carry_the_index_values(client, project_id, plant):
    mid, _ = plant
    [row] = client.get(url(project_id, mid, "/items"), params={"q": "20-T-0001"}).json()["items"]
    assert row["tag"] == "20-T-0001" and row["type"] == "tank_lng" and row["area"] == "20"
    assert row["site_x"] is not None and 28 < row["lat"] < 29.5 and row["has_geometry"] in (True, False)


def test_get_item_returns_the_spec_item(client, project_id, plant):
    mid, _ = plant
    r = client.get(url(project_id, mid, "/items/20-T-0001"))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "20-T-0001" and body["footprint"]["kind"] == "circle"
    assert client.get(url(project_id, mid, "/items/nope")).status_code == 404


def test_csv_route(client, project_id, plant, handle):
    mid, spec = plant
    r = client.get(url(project_id, mid, "/csv"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.content.decode("utf-8").splitlines()
    assert lines[0].startswith("node,tag,name,type,area,group,plant_E,plant_N,utm39_E,utm39_N")
    assert len(lines) == 1 + len(spec["items"])
    seed_version(handle, spec, model_id=mid, version=2)  # pending: no files yet
    r2 = client.get(url(project_id, mid, "/csv", version=2))
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "not_ready"
    assert client.get(url(project_id, mid, "/items", version=2)).json() == {"items": [], "next_cursor": None}


def test_version_detail_of_a_large_spec_does_not_validate(client, project_id, handle, monkeypatch):
    import app.asset_models.router as router

    mid = seed_version(handle, synthetic_plant(250, types=("other",)))
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))

    def boom(_spec):
        raise AssertionError("validate ran in the request")

    monkeypatch.setattr(router, "validate", boom)
    r = client.get(f"/api/v1/projects/{project_id}/asset-models/{mid}/versions/1")
    assert r.status_code == 200 and isinstance(r.json()["warnings"], list)
```

The field names in `test_rows_carry_the_index_values` (`tag`, `type`, `area`, `site_x`, `lat`, `has_geometry`) are the provisional ones from spec §9. Rename them to the contract's `AssetItemRow` properties recorded in Task 1.

- [ ] **Step 2: Run them to make sure they fail**

Run: `PY -m pytest tests\test_asset_models_items_api.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.asset_models.items'`.

- [ ] **Step 3: Write `items.py`**

If F0 already defines the response models in `app/asset_models/schemas.py` (Task 1), import those instead of the three classes below, and keep the `of()` mapping as a helper function. Field names must equal the contract's `AssetItemRow` properties (the first test checks this).

```python
# backend/app/asset_models/items.py
"""The plant register over HTTP (spec 2026-10-03-plant-model-generator §10; plan A1 task 8): a paged,
filtered list of a version's `asset_item` index, one item from the stored spec, and the register CSV.
Bounded: ≤ 500 rows per page by keyset on `asset_item.id`; the item route validates one item only."""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_, select, text

from app.asset_models import store
from app.asset_models.spec import FlagCode, Item
from app.asset_models.store import INT32_MAX
from app.db.models import AssetItem
from app.errors import AppError, not_found
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
V = "/asset-models/{assetModelId}/versions/{version}"
MAX_PAGE = 500
DEFAULT_PAGE = 200
ITEM_ID_PATTERN = r"^[A-Za-z0-9_.\-]{1,64}$"
_FLAG_FILTER = text(
    "EXISTS (SELECT 1 FROM json_each(asset_item.flags) WHERE json_extract(json_each.value, '$.code') = :flag)"
)


class AssetItemRowOut(BaseModel):
    id: str
    tag: str | None
    name: str
    type: str
    area: str | None
    plant_e: float | None
    plant_n: float | None
    site_x: float | None
    site_y: float | None
    lon: float | None
    lat: float | None
    base_el: float | None
    top_el: float | None
    height_source: str
    confidence: str
    flags: list[dict[str, Any]]
    source_sheet: str | None
    has_geometry: bool

    @classmethod
    def of(cls, r: AssetItem) -> AssetItemRowOut:
        return cls(
            id=r.node,
            tag=r.tag,
            name=r.name,
            type=r.type,
            area=r.area,
            plant_e=r.plant_e,
            plant_n=r.plant_n,
            site_x=r.site_x,
            site_y=r.site_y,
            lon=r.lon,
            lat=r.lat,
            base_el=r.base_el,
            top_el=r.top_el,
            height_source=r.height_source,
            confidence=r.confidence,
            flags=list(r.flags or []),
            source_sheet=r.source_sheet,
            has_geometry=bool(r.has_geometry),
        )


class AssetItemPageOut(BaseModel):
    items: list[AssetItemRowOut]
    next_cursor: str | None


def _cursor(raw: str | None) -> int:
    if raw is None:
        return 0
    if not raw.isdigit() or len(raw) > 18:
        raise AppError("invalid_cursor", "The cursor is not valid; start again without one.", 422)
    return int(raw)


def _bbox(raw: str | None) -> tuple[float, float, float, float] | None:
    if raw is None:
        return None
    try:
        vals = [float(v) for v in raw.split(",")]
    except ValueError:
        vals = []
    if len(vals) != 4 or not all(math.isfinite(v) for v in vals) or vals[0] > vals[2] or vals[1] > vals[3]:
        raise AppError("invalid_bbox", "bbox must be minE,minN,maxE,maxN in plant metres.", 422)
    return vals[0], vals[1], vals[2], vals[3]


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get(V + "/items", response_model=AssetItemPageOut)
def list_asset_model_items(
    assetModelId: str,  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    q: str | None = Query(None, max_length=200),
    type_: str | None = Query(None, alias="type", max_length=80),
    area: str | None = Query(None, max_length=80),
    flag: FlagCode | None = None,
    bbox: str | None = Query(None, max_length=200),
    cursor: str | None = Query(None, max_length=32),
    limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        store.get_version(s, assetModelId, version)  # 404s before parameter checks
        after = _cursor(cursor)
        box = _bbox(bbox)
        stmt = select(AssetItem).where(
            AssetItem.model_id == assetModelId, AssetItem.version == version, AssetItem.id > after
        )
        if q:
            p = _like(q)
            stmt = stmt.where(
                or_(
                    AssetItem.tag.ilike(p, escape="\\"),
                    AssetItem.name.ilike(p, escape="\\"),
                    AssetItem.node.ilike(p, escape="\\"),
                )
            )
        if type_:
            stmt = stmt.where(AssetItem.type == type_)
        if area:
            stmt = stmt.where(AssetItem.area == area)
        if flag:
            stmt = stmt.where(_FLAG_FILTER.bindparams(flag=flag))
        if box:
            stmt = stmt.where(
                AssetItem.plant_e.between(box[0], box[2]), AssetItem.plant_n.between(box[1], box[3])
            )
        rows = s.scalars(stmt.order_by(AssetItem.id).limit(limit + 1)).all()
        more = len(rows) > limit
        rows = rows[:limit]
        return AssetItemPageOut(
            items=[AssetItemRowOut.of(r) for r in rows], next_cursor=str(rows[-1].id) if more and rows else None
        )


@router.get(V + "/items/{itemId}", response_model=Item)
def get_asset_model_item(
    assetModelId: str,  # noqa: N803
    itemId: str = Path(pattern=ITEM_ID_PATTERN),  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        raw = store.get_version(s, assetModelId, version).spec
    for entry in raw.get("items") or []:
        if isinstance(entry, dict) and entry.get("id") == itemId:
            return Item.model_validate(entry)
    raise not_found("asset item", itemId)


@router.get(V + "/csv", response_class=FileResponse)
def get_asset_model_csv(
    assetModelId: str,  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        ready = store.get_version(s, assetModelId, version).glb_status == "ready"
    path = store.version_csv_path(handle, assetModelId, version)
    if not ready or not path.exists():
        raise AppError("not_ready", "The register for this version is not built yet.", 409)
    return FileResponse(
        path,
        media_type="text/csv; charset=utf-8",
        filename=f"register-v{version}.csv",
        headers={"Cache-Control": "private, max-age=3600"},
    )
```

If the contract's `AssetItem` schema is not the bare `Item` (for example `{item, row}`), set `response_model` to F0's `AssetItemOut` and build it from the `Item` plus the matching `asset_item` row.

- [ ] **Step 4: Route it**

In `backend/app/api.py`, in the router loop, insert directly above the line `"app.asset_models.stubs_plant",`:

```python
    "app.asset_models.items",  # plant model A1: items list, item, register CSV
```

- [ ] **Step 5: Delete A1's stubs**

In `backend/app/asset_models/stubs_plant.py`, delete A1's three tuples (`listAssetModelItems`, `getAssetModelItem`, `getAssetModelCsv`). If the list is then empty, keep the empty list and the comment, as `app/pointclouds/router.py::STUBS` does. Then update `test_a1_stubs_exist_until_a1_lands` in `backend/tests/test_asset_models_a1_seams.py`:

```python
def test_a1_stubs_are_gone():
    from app.asset_models import stubs_plant

    ids = {op for _m, _p, op in stubs_plant.A1_STUBS}
    assert not ids & {"listAssetModelItems", "getAssetModelItem", "getAssetModelCsv"}
```

- [ ] **Step 6: Run the route and contract tests**

Run: `PY -m pytest tests\test_asset_models_items_api.py tests\test_asset_models_a1_seams.py tests\test_contract.py -v`
Expected: all pass, except `test_version_detail_of_a_large_spec_does_not_validate` when Task 1 found F0 had not handled it; Step 7 fixes that. If `test_contract.py::test_responses_conform` reports an undeclared status, it is the contract defect Task 1 checked for: fix `openapi.yaml`, run `pnpm -C contract generate`, and stage `contract/openapi.yaml` and `contract/client/schema.d.ts` in this task's commit. Log it as a ruling and a hand-off.

- [ ] **Step 7: Stored warnings for large specs (only if Task 1 found it missing)**

In `backend/app/asset_models/router.py`, change the body of `get_asset_model_version` to:

```python
    with handle.session() as s:
        row = store.get_version(s, assetModelId, version)
        spec = AssetSpec.model_validate(row.spec)
        if len(spec.items) > LARGE_SPEC_ITEMS:
            # spec §5: never validate a large spec in the request; the GLB job stored its warnings
            stored = ((row.meta or {}).get("validation") or {}).get("warnings") or []
            warnings = [
                SpecIssueOut(code=w["code"], part_id=w.get("item_id") or w.get("part_id"), message=w["message"])
                for w in stored
            ]
        else:
            warnings = [SpecIssueOut(**i) for i in service.issues(validate(spec).warnings)]
        base = AssetModelVersionOut.of(row).model_dump()
        return AssetModelVersionDetailOut(**base, spec=spec, warnings=warnings)
```

Add the import `from app.asset_models.service import LARGE_SPEC_ITEMS` (Task 6 Step 8 created it; if F0 has its own constant, use that). Run: `PY -m pytest tests\test_asset_models_items_api.py::test_version_detail_of_a_large_spec_does_not_validate tests\test_asset_models_api.py -v`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

Run: `PY -m ruff check app tests` and `PY -m ruff format --check app tests`
Expected: no findings.

```bash
git add backend/app/asset_models/items.py backend/app/asset_models/stubs_plant.py backend/app/api.py backend/tests/test_asset_models_items_api.py backend/tests/test_asset_models_a1_seams.py
git commit -m "feat(asset-models): plant register routes (items page, item, CSV)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add `backend/app/asset_models/router.py` when Step 7 applied, and `contract/openapi.yaml` with `contract/client/schema.d.ts` when Step 6 fixed a contract defect.

---

### Task 9: Full gate and operator walkthrough

**Files:**
- No source changes unless a gate step fails (then fix in the owning task's files and re-run).

- [ ] **Step 1: Contract**

Run (from the worktree root): `pnpm -C contract check`
Expected: exit 0 (lint and generated client in sync).

- [ ] **Step 2: Backend lint and format**

Run (from `backend`): `PY -m ruff check .` then `PY -m ruff format --check .`
Expected: `All checks passed!` and no files would be reformatted.

- [ ] **Step 3: Backend tests**

Run (from `backend`): `PY -m pytest`
Expected: all pass (the budget probe included; it prints nothing without `-s`). Record the passed/skipped counts. Skips of the frame tests mean P1 is absent: say so in the report.

- [ ] **Step 4: Frontend gates (no frontend change; run them as the gate requires)**

Run (from the worktree root): `pnpm -C frontend lint`, `pnpm -C frontend test`, `pnpm -C frontend build`, then `pnpm -C frontend e2e` on the unit's free ports (`scripts\finish-task.ps1` picks them).
Expected: all green.

- [ ] **Step 5: `cargo test` only with the frozen sidecar**

Run: `Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe`. Only if it is `True`, run `cargo test --manifest-path frontend/src-tauri/Cargo.toml`. Otherwise record "skipped: no frozen sidecar".

- [ ] **Step 6: Budget numbers**

Run (from `backend`): `PY -m pytest tests\test_asset_models_assemble_perf.py -s`
Expected: PASS. Copy the printed `seconds`, `peak` and `triangles` into the report.

- [ ] **Step 7: Operator walkthrough (put it in the final report)**

The register and GLB are not in the UI until S3. These steps let the operator check A1's output directly:
1. In a terminal at `E:\Dev\Yolo\app\.claude\worktrees\pm-a1\backend`, run `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe tests\plant_fixture.py --build C:\Temp\plant-a1`. It prints two paths.
2. Open `C:\Temp\plant-a1\fixture_plant.glb` in Windows 3D Viewer, or drag it onto https://gltf-viewer.donmccurdy.com. You should see tanks, racks, buildings and roads over a land slab and a blue sea slab. Types without a builder yet show as plain extrusions. Some items may be small red marker boxes.
3. In the viewer's scene tree, open `Fixture plant → Area_20 → 20-T-0001`. Its properties (extras) show the register row: plant E/N, utm39 E/N about 245 7xx / 3 179 6xx, base and top EL, flags.
4. Open `C:\Temp\plant-a1\fixture_plant.csv` in Excel. There is one row per item (58), with columns in Cowork's order plus `flags` and `confidence`. The row `CONTROL BUILDING, "MAIN"` stays on one line. The first pump shows `height_mismatch` in `flags`.

- [ ] **Step 8: Final commit (only if Steps 1–6 needed fixes)**

```bash
git add <the files fixed>
git commit -m "fix(asset-models): <what the gate found>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

No task merges, pushes, builds an installer or runs `/wrapup`. The report goes to the controller with:
- the gate results;
- the budget numbers;
- the hand-offs: B3 (environment frame, Ruling 12), any contract defect, and P1 absence if the frame tests skipped.
