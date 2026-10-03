# Plant model G1: cloud check (C1) and scorer (K1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file holds **two independent units**: Part C (C1) and Part K (K1). Each is built in its own worktree and merged on its own. A Part C task never touches a Part K file, and the reverse.

**Goal:**
- **C1:** the plant cloud check of spec §8.2.4 as a pure backend module: one bounded cloud sample for the plant extent, a cloud-z to plant-EL datum fit, per-item heights and flags, and unregistered-cluster candidates, applied to items without ever moving them.
- **K1:** the scorer that compares a generated register with Cowork's KIPIC register (recall, type accuracy, position error, by-area recall, must-haves, land outline), its CLI, the KIPIC landmask fixture, and the skeleton of the live Al-Zour acceptance test.

**Architecture:**
- C1 adds `backend/app/asset_models/cloudcheck.py`. It streams the LAS/LAZ once (M1's `look/cloud.py` pattern, `source_of`), keeps a float32 sample in the site CRS, buckets it on a 10 m grid, and works per item in plant metres through F0's `PlantGrid`. The `cloud_check` tool that calls it is R1's.
- K1 adds `backend/app/asset_models/score.py`: plain functions over CSV rows (dicts), shapely for the land outline, no database. The live test drives the real API on a copy of the project.

**Tech Stack:** Python 3.11, numpy 2.4, scipy 1.17 (`signal.correlate`, `ndimage`), shapely 2.1 (pinned in `requirements.txt`), laspy 2.7, pyproj 3.7, pytest. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§8.2.4, §13, §15), read with the index `docs/superpowers/plans/2026-10-03-plant-model.md` (Global Constraints, Binding interfaces "cloud check" and "scorer", Review Focus 2).

| Unit | Worktree / branch | Cut after | Merge position |
| --- | --- | --- | --- |
| C1 | `.claude/worktrees/pm-c1` on `task/pm-c1` | F0 merged on `main` | Batch 2, any order with B1–B3, A1, I1, S1, K1. It must merge before R1's `cloud_check` tool task (R1 waits on `WAITING: C1`). |
| K1 | `.claude/worktrees/pm-k1` on `task/pm-k1` | F0 merged on `main` | Batch 2, any order. Needed by L1 only. |

e2e ports (coordinator log): C1 `E2E_WEB_PORT=5370`, `E2E_MOCK_PORT=5371`; K1 `5380` / `5381`.

## Global Constraints

Copied from the index; every task's requirements include them.

- `contract/openapi.yaml` is the source of truth; F0 owns it. No unit here edits the contract.
- API keys only ever come from `KeyStore.get(provider)` at the moment of a model call. Never in a log, job message, step summary, error, file or commit. (The live test reads `ANTHROPIC_API_KEY` from its own environment and hands it to the test app's key store, as `test_asset_model_live.py` does; it never writes it anywhere.)
- Logs carry tool names, states, durations and counts only. Never prompts, model output, tool payloads or SDK exception text.
- Background jobs: `asset_model_run` (plant mode ≤ 4 h, cancellable, resumable) and "the cloud sample (inside the run)". No route blocks on cloud sampling.
- Bounded reads: "plant cloud sample ≤ 20 000 000 points, float32, built in one streamed laspy pass of ≤ 2 M-point chunks, cancellable; per-item cloud work ≤ 200 000 points."
- Frames: spec item coordinates are plant metres `[E, N]`, elevations plant EL in metres. Site CRS from plant: `[X, Y] = origin_crs + R(plant_north_deg) · [E, N]`, `R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]]`, `origin_crs = (244338.089, 3179515.690)`, `θ = 17.9991` for Al-Zour.
- D5: the drawing decides plan position, the cloud decides height. A disagreement over the tolerance becomes a flag on the item and is never a silent move.
- Index Review Focus 2: a cloud in a different CRS, or a local-frame cloud, is skipped with a run note (no heights). It is never projected silently.
- No new Python packages; never install into the shared venv.
- Stage files by path; never `git add -A`; never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identity "Danijel Jovanovic" / info@synapse-solutions.ai.
- Backend interpreter `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`. Full suites only in the unit's final gate.

## Review Focus

Five inputs most likely to bite the operator that the happy paths do not reach. Each is pinned by a named test in the owning task.

1. **A cloud in another CRS, or with none** (index Review Focus 2). The check skips it with a note, no heights, no flags, and never reprojects; the items come back untouched. C1 Task C4 `test_check_skips_cloud_in_other_crs`; Task C2 `test_cloud_in_frame_reads_the_cloud_row`; Task C6 `test_apply_check_leaves_a_skipped_cloud_alone`.
2. **A cloud far bigger than the plant** (Al-Zour's source cloud is several GB). Memory is bounded by the chunk and the cap, never by the file. C1 Task C2 `test_sample_memory_is_bounded_by_the_chunk_not_the_file`, `test_sample_is_bounded_float32_single_pass`.
3. **An item with a degenerate footprint** (a zero-length line from a misread leader). The check skips that one item and carries on. C1 Task C4 `test_check_survives_a_degenerate_footprint`.
4. **No drawing elevations at all** (every height indicative). The datum falls back to the items' base elevations, or is absent; the check still flags but invents no heights. C1 Task C3 `test_fit_datum_falls_back_to_base_elevations`; Task C4 `test_check_without_a_datum_flags_but_gives_no_heights`.
5. **Generated tags written differently from the drawing** (case, spaces, en dashes), and generated rows without coordinates. They still count as found; unpositioned rows do not distort the position numbers. K1 Task K2 `test_tags_normalise_case_spaces_and_dashes`; Task K3 `test_rows_without_coordinates_count_as_found_not_positioned`.

## Rulings

Where the spec or index leaves room, this plan decides:

**C1**
1. **`PlantSample` precision.** float32 cannot hold UTM metres to the centimetre (3.2 M m has a 0.25 m float32 step). `xyz[:, :2]` is therefore site x, y **relative to `origin`** (the bbox's min corner); `site_xy()` returns absolute float64. Additive fields: `crs_wkt`, `origin`, `total`, plus `save()`/`load()` so a resumed R1 run does not read the cloud again.
2. **`CheckResult.note: str | None`** (additive) carries the skip reason (other CRS, no CRS, no points) and the no-datum notice. R1 shows it as the run note Review Focus 2 asks for.
3. **`cancel: Callable[[], bool]`.** A true return raises `JobCancelled` before the next chunk. M1's raising `ctx.check_cancelled` also works when wrapped: `cancel=lambda: ctx.check_cancelled() or False`.
4. **Decimation** is a stride `k = ceil(header_point_count / max_points)` over file order, applied before the box filter. The kept count never exceeds `max_points`; a plant covering part of a cloud keeps fewer points, not more memory.
5. **Same CRS** only when both EPSG codes are equal, or both sides resolve (EPSG or WKT) to equal pyproj CRSs. Unknown on either side is "not the same". `cloud_in_frame()` lets R1 ask before it spends a pass on a cloud it would skip.
6. **Datum fit.** Per drawing-elevation item: `base_el − p10(cloud z)` of the points within 5 m outside its footprint; median. A tilt (`plant EL = z + offset + tilt · [x − origin_x, y − origin_y]`) only when 6+ such items span 200 m+ and a plane cuts the RMS to under 0.7× the constant fit's. With fewer than 3 usable drawing items: the median `base_el` of every item that has one, against the sample's 5th z percentile (the plant's grade against the cloud's ground; the datum EL itself is not grade, Al-Zour's grade is EL 104.5 on datum 100). Fewer than 3 base elevations: `None`.
7. **Heights.** Ground = 10th percentile of the points in the footprint's window (bounds grown 5 m) outside the footprint. Top = 98th percentile of the points inside the footprint and over 0.3 m above ground, with at least 10 of them. `height_mismatch` compares top EL only: over 0.5 m, value = cloud − drawing.
8. **Coverage and `missing_in_cloud`.** Coverage = share of window cells (2 m, or the item cell if larger) holding any point. Occupancy = share of footprint cells holding an above-ground point. `missing_in_cloud` when coverage ≥ 0.5 and occupancy < 0.1.
9. **`plan_offset`.** FFT cross-correlation (`scipy.signal.correlate`) of the above-ground occupancy against the footprint mask, over ±4 m of lag. The offset is the smallest shift reaching the best score, reported when the best covers ≥ 20 % of the footprint cells; flagged over 1 m, with the shift in the note. The cell grows with item size (≤ 10 000 cells per window), so very long items get a coarser lag.
10. **Types with no body above grade** (`road, paved, laydown, parking, trench, channel, basin, revetment, fence, pipe_sleeper`) get coverage and ground only, no flags.
11. **Candidates.** A plant-frame grid (1 m cells; coarser when the sample is sparse, about 4 points per cell; at most 16 M cells). Ground per 10 × 10-cell block = 10th percentile of the cell minimums, gaps filled from the nearest block, then a 3 × 3-block minimum filter. A cell is occupied with ≥ 2 points over 1 m above ground. Footprints grown 2 m are excluded. 8-connected clusters whose plant E and N extents are both ≥ 3 m are kept, largest first, at most 200, ids `cand-001…`. `pts` = convex hull in plant `[E, N]`; `top_el` = 98th percentile of the cell maxima plus the datum offset (raw cloud z without a datum, which the note says).
12. **`apply_check`** replaces earlier cloud flags (`plan_offset`, `height_mismatch`, `missing_in_cloud`) with this check's, and keeps every other flag. Where `height_source` is `indicative` and both cloud heights exist, it sets `base_el`, `top_el` and `height_source = "cloud"`. It never changes a footprint, id, tag, type or position. Items the check did not see come back unchanged.
13. **The `cloud_check` tool is R1's** (index: "R1 … (tool wraps C1)"). C1 provides `summarise(result, limit=300)` as its bounded JSON reply.

**K1**

14. **Tag normalisation** removes whitespace and dash characters (ASCII hyphen, the Unicode hyphens and dashes 0x2010–0x2015, the minus sign 0x2212) and upper-cases. `/` and `~` are kept (`70-S-0001A/B`).
15. **Type match:** equal types; or `other`/`composite` on either side (the honest fallback matches anything); or `package` on either side against any equipment-family type. The family table is static in `score.py` (spec §6), so the scorer does not depend on B1–B3 having merged.
16. **`recall` and `type_accuracy` are over all tagged reference rows** (404). The acceptance line "≥ 95 % of the 404 tagged items found with a matching type" is `type_accuracy ≥ 0.95`.
17. **Position.** `within_tol` is over found pairs where both rows have plant E/N. Tolerance 2 m when the generated item's footprint (longest extent) is over 5 m, else 5 m; unknown size → 5 m. Sizes come from the version's spec through `with_footprint_sizes` (row `node` = item id, else the tag). The CLI gains `--gen-spec` for this (additive to the binding CLI).
18. **Must-haves** (`required_present`): `20-T-0001`…`20-T-0008` by tag; `jetty_head_1`/`jetty_head_2` = Cowork nodes `jetty1-loading-platform` / `jetty2-loading-platform`, each matched by a generated `jetty_platform` within 25 m; `trestles` = every Cowork trestle row has a generated `trestle` within 60 m (segmentation may differ); `dolphins` = every Cowork dolphin has a generated `dolphin` within 10 m. A key whose reference rows are absent is left out, so the scorer works on any plant.
19. **Landmask frame.** Cowork's `landmask.json` is in the viewer's scene frame: its `P(E, N)` is `(E − 1300, EL − 100, −(N − 450))` and the rings are `[x, z]`, so `E = x + 1300`, `N = 450 − z`. K1 converts it once into the plant-frame fixture `kipic_landmask.json` (`land` and `main` rings). The test pins it: all 8 tanks fall on land, both jetty heads off it.
20. **Land outline distance** = Hausdorff between the boundaries of the two land unions clipped to the plant extent (reference positions + 100 m), segmentized at 2 m. One side empty → infinity (null in JSON); no land given → `None`.
21. **Live test.** It copies `project.db` (sqlite backup, WAL folded in) and `drawings/`, `maps/`, `pointclouds/` without `octree/` and `.work/`; raw data is read in place through the rows' absolute paths. It skips unless the five sheets (T0003, T0005–T0008) are imported; importing them is L1's job. Pass lines: run `finished`; `type_accuracy ≥ 0.95`; `within_tol ≥ 0.95`; every must-have; Hausdorff ≤ 10 m; tokens ≤ 40 M; ≤ 4 h. Evidence: `register.csv`, `score.json`, `score.md`, `run.json` (state, usage, packages; no prompts, no keys).

## Deviations

- Spec §8.2.4 says the cloud is read "through the octree level for the plant extent". No server-side octree reader exists (M1 `look/cloud.py` header), and the index's bounded-read line specifies a streamed laspy pass. C1 follows the index.
- Binding `PlantSample` and `CheckResult` gain the additive fields of rulings 1 and 2; binding signatures are otherwise kept exactly. Extra public helpers: `same_crs`, `cloud_in_frame`, `plant_bbox_site`, `summarise` (C1); `normalise_tag`, `types_match`, `tolerance_m`, `required_present`, `extent`, `landmask_hausdorff`, `read_land`, `land_from_environment`, `footprint_size_m`, `with_footprint_sizes`, `report_dict`, `report_markdown`, `main` (K1).

---

# Part C: unit C1, cloud check

**Unit:** C1. **Worktree:** `.claude/worktrees/pm-c1`, branch `task/pm-c1`. **Cut after:** F0. **Merge position:** batch 2, before R1's `cloud_check` task.

**Interfaces provided** (`backend/app/asset_models/cloudcheck.py`):

```python
MAX_POINTS = 20_000_000; CHUNK = 2_000_000; ITEM_CAP = 200_000; HEIGHT_TOL_M = 0.5; PLAN_TOL_M = 1.0
@dataclass
class PlantSample:
    xyz: np.ndarray                      # (n, 3) float32: site x, y relative to origin; cloud z
    cloud_id: str
    crs_epsg: int | None
    bbox: tuple[float, float, float, float]   # site CRS, absolute
    crs_wkt: str | None = None
    origin: tuple[float, float] = (0.0, 0.0)
    total: int = 0                       # the source header's point count
    def site_xy(self, idx=slice(None)) -> np.ndarray          # (k, 2) float64 absolute site x, y
    def save(self, path: Path) -> None
    @classmethod
    def load(cls, path: Path) -> PlantSample
@dataclass
class ItemCheck: item_id: str; ground_el: float | None; top_el: float | None; coverage: float; offset_m: float | None; flags: list[ItemFlag]
@dataclass
class Candidate: id: str; pts: list[tuple[float, float]]; top_el: float; size_m: tuple[float, float]
@dataclass
class CheckResult: datum: CloudDatum | None; items: dict[str, ItemCheck]; candidates: list[Candidate]; note: str | None = None
def sample_plant_cloud(handle, cloud_id: str, bbox_site: tuple[float, float, float, float], *, max_points: int = MAX_POINTS, cancel: Callable[[], bool] | None = None, progress: Callable[[int, int], None] | None = None) -> PlantSample
def fit_datum(sample: PlantSample, grid: PlantGrid, items: list[Item]) -> CloudDatum | None
def check_items(sample: PlantSample, grid: PlantGrid, items: list[Item], datum: CloudDatum | None) -> CheckResult
def apply_check(items: list[Item], result: CheckResult) -> list[Item]
def same_crs(epsg: int | None, wkt: str | None, crs: SiteCrs) -> bool
def cloud_in_frame(handle, cloud_id: str, frame: SiteFrame) -> bool
def plant_bbox_site(grid: PlantGrid, items: list[Item], margin_m: float = 50.0) -> tuple[float, float, float, float] | None
def summarise(result: CheckResult, *, limit: int = 300) -> dict
```

How R1's `cloud_check` tool is expected to call it (R1 owns the tool; this is the recipe, not C1 code):

```python
if not cloudcheck.cloud_in_frame(handle, cloud_id, spec.site):
    return {"note": cloudcheck.SKIP_OTHER_CRS}              # Review Focus 2: no pass, no heights
box = cloudcheck.plant_bbox_site(grid, spec.items)            # None without items: nothing to check
sample = cloudcheck.sample_plant_cloud(handle, cloud_id, box, cancel=lambda: ctx.check_cancelled() or False,
                                       progress=lambda d, t: ctx.progress(...))
sample.save(run_dir / f"plant_{cloud_id}.npz")              # resume reads it back with PlantSample.load
datum = spec.site.cloud_z_to_el or cloudcheck.fit_datum(sample, grid, spec.items)
result = cloudcheck.check_items(sample, grid, spec.items, datum)
spec.items = cloudcheck.apply_check(spec.items, result)
reply = cloudcheck.summarise(result)
```

**Interfaces consumed:**
- F0, `app.asset_models.spec`: `SiteFrame` (`crs`, `origin_crs`, `plant_north_deg`, `datum`), `SiteCrs` (`epsg`, `wkt`), `CloudDatum(cloud_id, offset_m, tilt)`, `Item` (`id`, `type`, `footprint`, `base_el`, `top_el`, `height_source`, `flags`), `ItemFlag(code, value, note)`.
- F0, `app.asset_models.siteframe`: `PlantGrid(frame)` with `.frame`, `.plant_to_site(e, n)`, `.site_to_plant(x, y)` (arrays in, tuple of arrays out); `footprint_polygon(fp) -> (k, 2)`; `footprint_ref(fp) -> (e, n)`.
- `main`: `app.asset_models.look.cloud.source_of(handle, cloud_id) -> Path` (raises `LookError` with a fixed sentence); `app.asset_models.look.LookError`; `app.pointclouds.rows.get_cloud(handle, cloud_id)` (row with `epsg`, `crs_wkt`); `app.jobs.cancellation.JobCancelled`.
- Tests: `tests/pointclouds.py` `insert_cloud(handle, **fields)`, `make_las(path, n, *, points=..., epsg=..., rgb=...)`; the `handle` fixture in `tests/conftest.py`.

**Budget:**
- Background job: none new. `sample_plant_cloud` runs inside R1's `asset_model_run` job: one streamed laspy pass in `CHUNK` (2 M) point chunks, `cancel` checked before every chunk, `progress(done, total)` after every chunk.
- Bounded reads: ≤ 20 M points kept, float32 (≤ 240 MB) plus the bucket index (int32 order, ≤ 80 MB; a transient int64 key while it is built). Per item ≤ `ITEM_CAP` (200 k) points. Candidate grid ≤ 16 M cells. The full file is never in memory. `check_items` never reads the disk.

**Shared-file touches:** none. New files only: `backend/app/asset_models/cloudcheck.py`, `backend/tests/plant_cloud.py`, `backend/tests/test_plant_cloudcheck.py`.

**Tests:** `backend/tests/test_plant_cloudcheck.py` (new, 30 tests, synthetic clouds only); helper `backend/tests/plant_cloud.py` (new).

**Execution DAG:** C1 → C2 → C3 → C4 → C5 → C6 → C7. Every task edits `cloudcheck.py` and its test file, so there is no parallel batch inside the unit; the chain is the critical path. The unit as a whole runs in parallel with the other batch-2 units.

**Gate (Task C7), PowerShell from the worktree root:**

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT = "5370"; $env:E2E_MOCK_PORT = "5371"; pnpm -C frontend e2e
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```

---

### Task C1: Align with merged F0

**Files:**
- Create: `backend/tests/plant_cloud.py`
- Create: `backend/tests/test_plant_cloudcheck.py`

**Interfaces:**
- Consumes: F0's `SiteFrame`, `Item`, `PlantGrid`, `footprint_polygon` (names above).
- Produces: the synthetic scene every later C task uses: `pc.grid()`, `pc.standard_scene() -> (pts (n, 3) plant E, N, cloud z; items)`, `pc.to_site(grid, pts)`, `pc.to_sample(grid, pts, *, epsg=32639, wkt=None, cloud_id="c1") -> PlantSample` (it imports `cloudcheck` lazily, so it is usable from Task C2), `pc.ground`, `pc.tank`, `pc.box`, `pc.item`, `pc.circle`, `pc.rect`, constants `GROUND_Z = -20`, `EL_OFFSET = 124.5`, `GROUND_EL = 104.5`, `FRAME`, `EXTENT`.

- [ ] **Step 1: Read F0's real code**

Read `backend/app/asset_models/spec.py` and `backend/app/asset_models/siteframe.py` on the merged `main`. Check each assumption this plan makes, and where F0 differs, change the **plan's code** (every later task) to F0's names. Keep every assertion.

| Assumption | Used in |
| --- | --- |
| `PlantGrid` keeps its frame as `grid.frame` | C3–C6 (`grid.frame`), tests |
| `plant_to_site` / `site_to_plant` take numpy arrays and return a tuple of two arrays | everywhere |
| `footprint_polygon(fp)` returns an open `(k, 2)` ndarray in plant `[E, N]`; a `rect` at `rot_deg = 0` has its `along` side on plant north | C2–C5, the scene |
| `footprint_ref(fp)` returns `(e, n)` floats | C3 |
| `Item.model_validate` takes a dict footprint (`{"kind": "rect", ...}`) and `source={"kind": "assumed"}` | `plant_cloud.item` |
| `SiteFrame` takes `source={"kind": "assumed"}` and `datum={"label", "el_m"}` | `plant_cloud.FRAME` |
| `ItemFlag(code, value, note)`; `CloudDatum(cloud_id, offset_m, tilt)` with `tilt: tuple[float, float] | None` | C2–C6 |

If F0's site `Source` has no `assumed` kind, use its equivalent in `FRAME` and `item()`, and note it in the ledger.

- [ ] **Step 2: Write the synthetic-scene helper**

Create `backend/tests/plant_cloud.py`:

```python
# backend/tests/plant_cloud.py
"""Synthetic plant clouds for the cloud check (C1): flat ground, tanks and boxes, built in plant
metres and handed over in site CRS. Ground is cloud z -20; plant EL = cloud z + 124.5."""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import Item, SiteFrame

if TYPE_CHECKING:
    from app.asset_models.cloudcheck import PlantSample

GROUND_Z = -20.0
EL_OFFSET = 124.5
GROUND_EL = GROUND_Z + EL_OFFSET  # 104.5
FRAME = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}
EXTENT = (1290.0, 500.0, 1420.0, 610.0)  # plant E0, N0, E1, N1 of the synthetic ground


def grid(frame: dict = FRAME) -> PlantGrid:
    return PlantGrid(SiteFrame.model_validate(frame))


def ground(e0, n0, e1, n1, *, step=0.5, z=GROUND_Z, holes=()) -> np.ndarray:
    """A flat ground grid (1 cm noise). `holes`: circles (e, n, r) and boxes (e0, n0, e1, n1) left
    empty, because a scanner never sees the ground under a tank."""
    e, n = np.meshgrid(np.arange(e0, e1, step) + step / 4, np.arange(n0, n1, step) + step / 4)
    e, n = e.ravel(), n.ravel()
    keep = np.ones(len(e), bool)
    for hole in holes:
        if len(hole) == 3:
            keep &= np.hypot(e - hole[0], n - hole[1]) > hole[2]
        else:
            keep &= ~((e >= hole[0]) & (e <= hole[2]) & (n >= hole[1]) & (n <= hole[3]))
    rng = np.random.default_rng(1)
    return np.column_stack([e[keep], n[keep], z + rng.normal(0, 0.01, int(keep.sum()))])


def tank(ce, cn, d, height, *, step=0.5, z0=GROUND_Z) -> np.ndarray:
    """A flat-roofed vertical cylinder: roof disc plus wall rings."""
    r = d / 2
    e, n = np.meshgrid(np.arange(ce - r, ce + r, step), np.arange(cn - r, cn + r, step))
    e, n = e.ravel(), n.ravel()
    inside = np.hypot(e - ce, n - cn) <= r - 0.1
    roof = np.column_stack([e[inside], n[inside], np.full(int(inside.sum()), z0 + height)])
    k = int(2 * np.pi * r / step)
    a, zz = np.meshgrid(np.arange(k) * 2 * np.pi / k, np.arange(z0 + step, z0 + height, step))
    wall = np.column_stack(
        [ce + (r - 0.05) * np.cos(a).ravel(), cn + (r - 0.05) * np.sin(a).ravel(), zz.ravel()]
    )
    return np.vstack([roof, wall])


def box(e0, n0, e1, n1, height, *, step=0.5, z0=GROUND_Z) -> np.ndarray:
    """The top surface of a box (what an aerial scan mostly sees)."""
    e, n = np.meshgrid(np.arange(e0, e1, step) + step / 4, np.arange(n0, n1, step) + step / 4)
    return np.column_stack([e.ravel(), n.ravel(), np.full(e.size, z0 + height)])


def item(id_, type_, footprint, *, base=None, top=None, source="indicative", tag=None) -> Item:
    return Item.model_validate(
        {
            "id": id_,
            "tag": tag,
            "name": id_,
            "type": type_,
            "footprint": footprint,
            "base_el": base,
            "top_el": top,
            "height_source": source,
            "source": {"kind": "assumed"},
        }
    )


def circle(e, n, d) -> dict:
    return {"kind": "circle", "center": [e, n], "d": d}


def rect(e, n, along, across, rot=0.0) -> dict:
    return {"kind": "rect", "center": [e, n], "size": [along, across], "rot_deg": rot}


def standard_scene() -> tuple[np.ndarray, list[Item]]:
    """Known tanks, a missing item, an offset item and one unregistered cluster (spec §13, C1)."""
    holes = [
        (1320.0, 540.0, 10.0),
        (1360.0, 540.0, 10.0),
        (1400.0, 580.0, 10.0),
        (1359.0, 574.0, 1367.0, 586.0),
        (1397.0, 517.0, 1403.0, 523.0),
        (1404.0, 599.0, 1406.0, 601.0),
    ]
    pts = np.vstack(
        [
            ground(*EXTENT, holes=holes),
            tank(1320, 540, 20, 30),  # tank-a: drawing heights that match (top EL 134.5)
            tank(1360, 540, 20, 25),  # tank-b: indicative; the cloud gives top EL 129.5
            tank(1400, 580, 20, 27.5),  # tank-c: drawing top EL 134.5, cloud 132.0
            box(1359, 574, 1367, 586, 4),  # pkg-offset: built 3 m east of where it is drawn
            box(1397, 517, 1403, 523, 5),  # an unregistered 6 x 6 m cluster, top EL 109.5
            box(1404, 599, 1406, 601, 3),  # 2 x 2 m: too small to be a candidate
        ]
    )
    items = [
        item(
            "tank-a",
            "tank_lng",
            circle(1320, 540, 20),
            base=GROUND_EL,
            top=134.5,
            source="drawing",
            tag="T-1",
        ),
        item("tank-b", "tank_lng", circle(1360, 540, 20), tag="T-2"),
        item(
            "tank-c",
            "tank_lng",
            circle(1400, 580, 20),
            base=GROUND_EL,
            top=134.5,
            source="drawing",
            tag="T-3",
        ),
        item("pad-missing", "package", rect(1320, 585, 10, 10)),
        item("pkg-offset", "package", rect(1360, 580, 12, 8), base=GROUND_EL, top=108.5, source="drawing"),
    ]
    return pts, items


def to_site(g: PlantGrid, pts: np.ndarray) -> np.ndarray:
    x, y = g.plant_to_site(pts[:, 0], pts[:, 1])
    return np.column_stack([x, y, pts[:, 2]])


def to_sample(
    g: PlantGrid, pts: np.ndarray, *, epsg: int | None = 32639, wkt=None, cloud_id="c1"
) -> PlantSample:
    from app.asset_models.cloudcheck import PlantSample

    site = to_site(g, pts)
    lo = site[:, :2].min(axis=0) - 1.0
    hi = site[:, :2].max(axis=0) + 1.0
    xyz = np.column_stack([site[:, 0] - lo[0], site[:, 1] - lo[1], site[:, 2]]).astype(np.float32)
    return PlantSample(
        xyz=xyz,
        cloud_id=cloud_id,
        crs_epsg=epsg,
        bbox=(float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])),
        crs_wkt=wkt,
        origin=(float(lo[0]), float(lo[1])),
        total=len(xyz),
    )
```

- [ ] **Step 3: Write the alignment tests**

Create `backend/tests/test_plant_cloudcheck.py`:

```python
# backend/tests/test_plant_cloudcheck.py
"""The plant cloud check (spec 2026-10-03 §8.2.4, §13 C1; index Review Focus 2)."""

import numpy as np
import plant_cloud as pc
import pytest

from app.asset_models.siteframe import footprint_polygon


# ---------------------------------------------------------------- F0 alignment


def test_f0_grid_matches_the_kipic_register():
    g = pc.grid()
    assert g.frame.crs.epsg == 32639
    x, y = g.plant_to_site(np.array([1301.1]), np.array([555.4]))  # 20-T-0001 in Cowork's register
    assert (float(x[0]), float(y[0])) == pytest.approx((245747.13, 3179641.87), abs=0.05)
    e, n = g.site_to_plant(x, y)
    assert (float(e[0]), float(n[0])) == pytest.approx((1301.1, 555.4), abs=1e-6)


def test_f0_footprints_match_the_scene_assumptions():
    _, items = pc.standard_scene()
    by = {it.id: it for it in items}
    ring = footprint_polygon(by["pkg-offset"].footprint)  # rect: along = plant north at rot 0
    assert ring.min(axis=0) == pytest.approx([1356, 574], abs=1e-6)
    assert ring.max(axis=0) == pytest.approx([1364, 586], abs=1e-6)
    ring = footprint_polygon(by["tank-a"].footprint)
    assert ring.min(axis=0) == pytest.approx([1310, 530], abs=0.1)
    assert ring.max(axis=0) == pytest.approx([1330, 550], abs=0.1)
```

- [ ] **Step 4: Run them**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: `2 passed`. A failure here means an assumption in Step 1 is wrong: fix the helper (or the plan's later code), never the expected numbers. `(245747.13, 3179641.87)` is 20-T-0001's `utm39_E/N` in Cowork's register, the same rows F0's golden vectors come from.

- [ ] **Step 5: Commit**

```
git add backend/tests/plant_cloud.py backend/tests/test_plant_cloudcheck.py
git commit -m "test(asset-models): synthetic plant scene aligned with F0 (C1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C2: The plant cloud sample and the CRS rule

**Files:**
- Create: `backend/app/asset_models/cloudcheck.py`
- Modify: `backend/tests/test_plant_cloudcheck.py` (replace the whole file)

**Interfaces:**
- Consumes: `source_of`, `rows.get_cloud`, `JobCancelled`, F0 names; `pc.*` from Task C1.
- Produces: `PlantSample` (without `index()` yet), `ItemCheck`, `Candidate`, `CheckResult`, every constant, `same_crs`, `cloud_in_frame`, `_skip_note(sample, frame) -> str | None`, `plant_bbox_site`, `sample_plant_cloud`, `SKIP_OTHER_CRS`, `SKIP_NO_CRS`, `NO_POINTS`, `NO_DATUM`.

- [ ] **Step 1: Write the failing tests**

Replace `backend/tests/test_plant_cloudcheck.py` with:

```python
# backend/tests/test_plant_cloudcheck.py
"""The plant cloud check (spec 2026-10-03 §8.2.4, §13 C1; index Review Focus 2)."""

import tracemalloc

import numpy as np
import plant_cloud as pc
import pytest
from pointclouds import insert_cloud, make_las

from app.asset_models import cloudcheck as cc
from app.asset_models.look import LookError
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import SiteFrame
from app.jobs.cancellation import JobCancelled


@pytest.fixture
def make_cloud(handle):
    """A ready point_cloud row for a LAS on disk; `epsg=None` stores no CRS."""

    def _make(path, epsg=32639):
        from pyproj import CRS

        st = path.stat()
        return insert_cloud(
            handle,
            source_path=str(path),
            source_size=st.st_size,
            source_mtime=st.st_mtime,
            epsg=epsg,
            crs_wkt=CRS.from_epsg(epsg).to_wkt() if epsg else None,
        )

    return _make


@pytest.fixture(scope="module")
def scene():
    return pc.standard_scene()


def _site_box(g, pts, pad=1.0):
    site = pc.to_site(g, pts)
    return (
        float(site[:, 0].min() - pad),
        float(site[:, 1].min() - pad),
        float(site[:, 0].max() + pad),
        float(site[:, 1].max() + pad),
    )


# ---------------------------------------------------------------- F0 alignment


def test_f0_grid_matches_the_kipic_register():
    g = pc.grid()
    assert g.frame.crs.epsg == 32639
    x, y = g.plant_to_site(np.array([1301.1]), np.array([555.4]))  # 20-T-0001 in Cowork's register
    assert (float(x[0]), float(y[0])) == pytest.approx((245747.13, 3179641.87), abs=0.05)
    e, n = g.site_to_plant(x, y)
    assert (float(e[0]), float(n[0])) == pytest.approx((1301.1, 555.4), abs=1e-6)


def test_f0_footprints_match_the_scene_assumptions():
    _, items = pc.standard_scene()
    by = {it.id: it for it in items}
    ring = footprint_polygon(by["pkg-offset"].footprint)  # rect: along = plant north at rot 0
    assert ring.min(axis=0) == pytest.approx([1356, 574], abs=1e-6)
    assert ring.max(axis=0) == pytest.approx([1364, 586], abs=1e-6)
    ring = footprint_polygon(by["tank-a"].footprint)
    assert ring.min(axis=0) == pytest.approx([1310, 530], abs=0.1)
    assert ring.max(axis=0) == pytest.approx([1330, 550], abs=0.1)


# ---------------------------------------------------------------- sample


def test_chunk_and_cap_are_the_index_bounds():
    assert cc.CHUNK <= 2_000_000
    assert cc.MAX_POINTS == 20_000_000
    assert cc.ITEM_CAP == 200_000


def test_sample_is_bounded_float32_single_pass(scene, tmp_path, handle, make_cloud, monkeypatch):
    import laspy

    pts, _ = scene
    g = pc.grid()
    las = make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts))
    cid = make_cloud(las)
    opened = []
    real_open = laspy.open
    monkeypatch.setattr(laspy, "open", lambda *a, **k: opened.append(1) or real_open(*a, **k))
    calls = []
    s = cc.sample_plant_cloud(
        handle, cid, _site_box(g, pts), max_points=30_000, progress=lambda d, t: calls.append((d, t))
    )
    assert len(opened) == 1
    assert s.xyz.dtype == np.float32 and s.xyz.shape[1] == 3
    assert 25_000 <= len(s.xyz) <= 30_000  # every 3rd of 77 k points
    assert s.total == len(pts) and s.crs_epsg == 32639 and s.cloud_id == cid
    assert calls[-1] == (len(pts), len(pts))
    xy = s.site_xy()
    assert np.allclose(np.sort(xy[:, 0])[[0, -1]], np.sort(pc.to_site(g, pts)[:, 0])[[0, -1]], atol=2.0)


def test_sample_keeps_only_the_box(scene, tmp_path, handle, make_cloud):
    pts, items = scene
    g = pc.grid()
    cid = make_cloud(make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts)))
    box = cc.plant_bbox_site(g, items[:1], margin_m=0.0)  # tank-a only
    s = cc.sample_plant_cloud(handle, cid, box)
    xy = s.site_xy()
    assert len(xy) and (xy[:, 0] >= box[0]).all() and (xy[:, 0] <= box[2]).all()
    assert (xy[:, 1] >= box[1]).all() and (xy[:, 1] <= box[3]).all()
    assert len(xy) < len(pts) / 3


def test_sample_honours_cancel(scene, tmp_path, handle, make_cloud):
    pts, _ = scene
    g = pc.grid()
    cid = make_cloud(make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts)))
    with pytest.raises(JobCancelled):
        cc.sample_plant_cloud(handle, cid, _site_box(g, pts), cancel=lambda: True)


def test_sample_memory_is_bounded_by_the_chunk_not_the_file(tmp_path, handle, make_cloud, monkeypatch):
    rng = np.random.default_rng(0)
    n = 1_200_000  # a 41 MB LAS: reading it whole would trace far over the bound below
    big = np.column_stack(
        [rng.uniform(244000, 245000, n), rng.uniform(3179000, 3180000, n), rng.uniform(-20, 10, n)]
    )
    cid = make_cloud(make_las(tmp_path / "big.las", 0, points=big, rgb=False))
    del big
    monkeypatch.setattr(cc, "CHUNK", 100_000)
    tracemalloc.start()
    try:
        s = cc.sample_plant_cloud(handle, cid, (244000, 3179000, 245000, 3180000), max_points=60_000)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert len(s.xyz) == 60_000
    assert peak < 25_000_000


def test_sample_round_trips_through_npz(scene, tmp_path):
    pts, _ = scene
    for epsg in (32639, None):
        s = pc.to_sample(pc.grid(), pts, epsg=epsg)
        s.save(tmp_path / "s.npz")
        t = cc.PlantSample.load(tmp_path / "s.npz")
        assert np.array_equal(s.xyz, t.xyz) and t.xyz.dtype == np.float32
        assert (t.bbox, t.origin) == (s.bbox, s.origin)
        assert (t.cloud_id, t.crs_epsg, t.crs_wkt, t.total) == (s.cloud_id, s.crs_epsg, s.crs_wkt, s.total)


def test_sample_of_an_unknown_cloud_is_a_look_error(handle):
    with pytest.raises(LookError):
        cc.sample_plant_cloud(handle, "no-such-cloud", (0, 0, 1, 1))


def test_plant_bbox_covers_every_footprint(scene):
    _, items = scene
    g = pc.grid()
    x0, y0, x1, y1 = cc.plant_bbox_site(g, items, margin_m=10.0)
    for it in items:
        ring = footprint_polygon(it.footprint)
        x, y = g.plant_to_site(ring[:, 0], ring[:, 1])
        assert x.min() >= x0 + 10 - 1e-6 and x.max() <= x1 - 10 + 1e-6
        assert y.min() >= y0 + 10 - 1e-6 and y.max() <= y1 - 10 + 1e-6
    assert cc.plant_bbox_site(g, []) is None


# ---------------------------------------------------------------- CRS


def test_same_crs_never_guesses():
    site = SiteFrame.model_validate(
        {"crs": {"epsg": 32639}, "origin_crs": [0, 0], "plant_north_deg": 0, "source": {"kind": "assumed"}}
    ).crs
    assert cc.same_crs(32639, None, site)
    assert not cc.same_crs(32640, None, site)
    assert not cc.same_crs(None, None, site)
    from pyproj import CRS

    assert cc.same_crs(None, CRS.from_epsg(32639).to_wkt(), site)


def test_cloud_in_frame_reads_the_cloud_row(tmp_path, handle, make_cloud):
    las = make_las(tmp_path / "a.las", 100)
    frame = pc.grid().frame
    assert cc.cloud_in_frame(handle, make_cloud(las, epsg=32639), frame)
    assert not cc.cloud_in_frame(handle, make_cloud(las, epsg=32640), frame)
    assert not cc.cloud_in_frame(handle, make_cloud(las, epsg=None), frame)
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: collection error, `ModuleNotFoundError: No module named 'app.asset_models.cloudcheck'`.

- [ ] **Step 3: Write the module**

Create `backend/app/asset_models/cloudcheck.py`:

```python
# backend/app/asset_models/cloudcheck.py
"""The plant cloud check (spec 2026-10-03 §8.2.4): one bounded cloud sample, a datum fit, per-item
heights and flags, and unregistered candidates. App code only; the AI reviews the outcome.

D5: the drawing decides plan position, the cloud decides height. Nothing here moves an item: a
disagreement becomes a flag. A cloud in another CRS, or with none, is skipped with a note and is
never reprojected.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pyproj import CRS
from pyproj.exceptions import CRSError

from app.asset_models.siteframe import PlantGrid, footprint_polygon
from app.asset_models.spec import CloudDatum, Item, ItemFlag, SiteCrs, SiteFrame
from app.jobs.cancellation import JobCancelled

MAX_POINTS = 20_000_000  # plant sample cap (index: bounded reads)
CHUNK = 2_000_000  # laspy chunk; read at call time so tests can shrink it
ITEM_CAP = 200_000  # per-item cloud work cap
HEIGHT_TOL_M = 0.5
PLAN_TOL_M = 1.0
ABOVE_ITEM_M = 0.3  # a point this far above the local ground counts as "something there"
ABOVE_CAND_M = 1.0  # stricter for candidates, which have no footprint to anchor them
RING_M = 5.0  # ground ring around a footprint
SEARCH_M = 4.0  # best-fit shift search radius
WINDOW_CELLS = 10_000  # raster cells per item window (the cell grows for big items)
COVER_CELL_M = 2.0
COVER_MIN = 0.5
OCCUPANCY_MAX = 0.1
CAND_MIN_M = 3.0
CAND_CELL_M = 1.0
CAND_PTS_PER_CELL = 4.0  # a sparse sample gets bigger cells, so 2 hits per occupied cell stay likely
CAND_BLOCK = 10  # ground blocks of 10 x 10 candidate cells
CAND_EXCLUDE_M = 2.0  # footprints grow this much before clusters are tested against them
CAND_LIMIT = 200
CAND_MAX_GRID = 16_000_000
CLOUD_CODES = frozenset({"plan_offset", "height_mismatch", "missing_in_cloud"})
# Types with no body above grade: only coverage is reported for them.
NO_BODY_TYPES = frozenset(
    {
        "road",
        "paved",
        "laydown",
        "parking",
        "trench",
        "channel",
        "basin",
        "revetment",
        "fence",
        "pipe_sleeper",
    }
)
SKIP_OTHER_CRS = (
    "The point cloud is in a different coordinate system from the site, so the cloud check skipped it: "
    "no heights and no flags. It was not reprojected."
)
SKIP_NO_CRS = (
    "The point cloud or the site has no coordinate system, so the cloud check skipped it: no heights and "
    "no flags."
)
NO_POINTS = "The point cloud has no points inside the plant extent."
NO_DATUM = "No cloud datum could be fitted: item heights are not given and candidate tops are cloud z."


@dataclass
class PlantSample:
    """A bounded plant-extent sample. `xyz` is float32: site x, y relative to `origin` (float32 cannot
    hold UTM metres to the centimetre), and the cloud's own z."""

    xyz: np.ndarray
    cloud_id: str
    crs_epsg: int | None
    bbox: tuple[float, float, float, float]
    crs_wkt: str | None = None
    origin: tuple[float, float] = (0.0, 0.0)
    total: int = 0

    def site_xy(self, idx=slice(None)) -> np.ndarray:
        return self.xyz[idx, :2].astype(np.float64) + np.asarray(self.origin, dtype=np.float64)

    def save(self, path: Path) -> None:
        """An .npz the run keeps, so a resumed run does not read the cloud again."""
        tmp = path.with_name(path.name + ".tmp.npz")
        np.savez(
            tmp,
            xyz=self.xyz,
            bbox=np.asarray(self.bbox, dtype=np.float64),
            origin=np.asarray(self.origin, dtype=np.float64),
            total=np.array([self.total]),
            epsg=np.array([-1 if self.crs_epsg is None else int(self.crs_epsg)]),
            text=np.array([self.cloud_id, self.crs_wkt or ""]),
        )
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> PlantSample:
        with np.load(path) as d:
            epsg = int(d["epsg"][0])
            cloud_id, wkt = (str(v) for v in d["text"])
            return cls(
                xyz=d["xyz"],
                cloud_id=cloud_id,
                crs_epsg=None if epsg < 0 else epsg,
                bbox=tuple(float(v) for v in d["bbox"]),
                crs_wkt=wkt or None,
                origin=tuple(float(v) for v in d["origin"]),
                total=int(d["total"][0]),
            )


@dataclass
class ItemCheck:
    item_id: str
    ground_el: float | None
    top_el: float | None
    coverage: float
    offset_m: float | None
    flags: list[ItemFlag]


@dataclass
class Candidate:
    id: str
    pts: list[tuple[float, float]]
    top_el: float
    size_m: tuple[float, float]


@dataclass
class CheckResult:
    datum: CloudDatum | None
    items: dict[str, ItemCheck]
    candidates: list[Candidate]
    note: str | None = None


# ---------------------------------------------------------------- CRS


def same_crs(epsg: int | None, wkt: str | None, crs: SiteCrs) -> bool:
    """True only when the cloud's CRS is the site's. Unknown on either side is never the same."""
    if epsg is not None and crs.epsg is not None:
        return int(epsg) == int(crs.epsg)
    try:
        a = CRS.from_wkt(wkt) if wkt else (CRS.from_epsg(epsg) if epsg is not None else None)
        b = CRS.from_wkt(crs.wkt) if crs.wkt else (CRS.from_epsg(crs.epsg) if crs.epsg is not None else None)
    except CRSError:
        return False
    return a is not None and b is not None and a.equals(b, ignore_axis_order=True)


def cloud_in_frame(handle, cloud_id: str, frame: SiteFrame) -> bool:
    """Whether a cloud can be checked against this site frame at all (R1 asks before sampling)."""
    from app.pointclouds import rows

    row = rows.get_cloud(handle, cloud_id)
    return same_crs(row.epsg, row.crs_wkt, frame.crs)


def _skip_note(sample: PlantSample, frame: SiteFrame) -> str | None:
    if same_crs(sample.crs_epsg, sample.crs_wkt, frame.crs):
        return None
    known_cloud = sample.crs_epsg is not None or bool(sample.crs_wkt)
    known_site = frame.crs.epsg is not None or bool(frame.crs.wkt)
    return SKIP_OTHER_CRS if known_cloud and known_site else SKIP_NO_CRS


# ---------------------------------------------------------------- sample


def plant_bbox_site(
    grid: PlantGrid, items: list[Item], margin_m: float = 50.0
) -> tuple[float, float, float, float] | None:
    """The site-CRS box around every item footprint, grown by `margin_m`; None without a usable item."""
    rings = []
    for it in items:
        try:
            ring = np.asarray(footprint_polygon(it.footprint), dtype=np.float64)
        except (ValueError, ArithmeticError):
            continue
        if len(ring) and np.isfinite(ring).all():
            rings.append(ring)
    if not rings:
        return None
    pts = np.concatenate(rings)
    x, y = grid.plant_to_site(pts[:, 0], pts[:, 1])
    return (
        float(x.min() - margin_m),
        float(y.min() - margin_m),
        float(x.max() + margin_m),
        float(y.max() + margin_m),
    )


def sample_plant_cloud(
    handle,
    cloud_id: str,
    bbox_site: tuple[float, float, float, float],
    *,
    max_points: int = MAX_POINTS,
    cancel: Callable[[], bool] | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> PlantSample:
    """One streamed laspy pass in <= CHUNK-point chunks. Uniform decimation (every k-th point, k from
    the header count) keeps at most `max_points` before the box filter, so memory is bounded by the
    cap, not the file. Raises LookError (fixed sentence) for a missing, unready or changed cloud and
    JobCancelled when `cancel()` turns true."""
    import laspy

    from app.asset_models.look.cloud import source_of
    from app.pointclouds import rows

    source = source_of(handle, cloud_id)
    row = rows.get_cloud(handle, cloud_id)
    x0, y0, x1, y1 = (float(v) for v in bbox_site)
    if not all(math.isfinite(v) for v in (x0, y0, x1, y1)) or x1 <= x0 or y1 <= y0:
        raise ValueError("bbox_site must be (xmin, ymin, xmax, ymax) with max > min")
    cap = max(1, min(int(max_points), MAX_POINTS))
    parts: list[np.ndarray] = []
    with laspy.open(str(source)) as reader:
        total = int(reader.header.point_count)
        stride = max(1, math.ceil(total / cap))
        done = 0
        for chunk in reader.chunk_iterator(CHUNK):
            if cancel is not None and cancel():
                raise JobCancelled()
            n = len(chunk)
            sel = np.arange((-done) % stride, n, stride)
            if len(sel):
                x = np.asarray(chunk.x)[sel]
                y = np.asarray(chunk.y)[sel]
                z = np.asarray(chunk.z)[sel]
                keep = (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
                if keep.any():
                    parts.append(np.column_stack([x[keep] - x0, y[keep] - y0, z[keep]]).astype(np.float32))
            done += n
            if progress is not None:
                progress(done, total)
    xyz = np.concatenate(parts) if parts else np.zeros((0, 3), np.float32)
    if progress is not None:
        progress(total, total)
    return PlantSample(
        xyz=xyz,
        cloud_id=cloud_id,
        crs_epsg=row.epsg,
        bbox=(x0, y0, x1, y1),
        crs_wkt=row.crs_wkt,
        origin=(x0, y0),
        total=total,
    )
```

- [ ] **Step 4: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: `12 passed`. `test_sample_memory_is_bounded_by_the_chunk_not_the_file` traced about 8 MB peak in planning against a 25 MB bound; with the 2 M chunk the same read peaks near 60 MB, so the bound does catch a whole-file read.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/cloudcheck.py backend/tests/test_plant_cloudcheck.py
git commit -m "feat(asset-models): bounded plant cloud sample and CRS rule (C1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C3: Bucket index, item windows and the datum fit

**Files:**
- Modify: `backend/app/asset_models/cloudcheck.py` (import block, `PlantSample`, append a section)
- Modify: `backend/tests/test_plant_cloudcheck.py` (append)

**Interfaces:**
- Consumes: Task C2's `PlantSample`, `_skip_note`, constants.
- Produces: `PlantSample.index() -> _Index`; `_Index(xy).query(x0, y0, x1, y1) -> np.ndarray` (indices, coordinates relative to the sample origin); `_poly(item) -> shapely geometry | None`; `_Local(poly, window, e, n, z, inside, ref_site)`; `_local(sample, grid, item, margin) -> _Local | None`; `_el_offset(datum, frame, x, y) -> float`; `fit_datum`; `_fit_offsets(a, frame, cloud_id) -> CloudDatum`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_plant_cloudcheck.py`:

```python
# ---------------------------------------------------------------- datum


def test_fit_datum_from_drawing_elevations(scene):
    pts, items = scene
    g = pc.grid()
    datum = cc.fit_datum(pc.to_sample(g, pts), g, items)
    assert datum.cloud_id == "c1" and datum.tilt is None
    assert datum.offset_m == pytest.approx(pc.EL_OFFSET, abs=0.05)


def test_fit_datum_fits_a_tilt_over_a_wide_site():
    g = pc.grid()
    items = [
        pc.item(f"d{k}", "package", pc.rect(e, n, 10, 10), base=pc.GROUND_EL, source="drawing")
        for k, (e, n) in enumerate(
            [(1000, 300), (1150, 300), (1300, 300), (1000, 550), (1150, 550), (1300, 550)]
        )
    ]
    pts = pc.ground(950, 250, 1350, 600, step=2.0)
    x, _ = g.plant_to_site(pts[:, 0], pts[:, 1])
    pts[:, 2] = -20.0 - 0.002 * (x - g.frame.origin_crs[0])  # the cloud sinks 2 mm per metre east
    d = cc.fit_datum(pc.to_sample(g, pts), g, items)
    assert d.tilt is not None
    assert d.tilt[0] == pytest.approx(0.002, abs=2e-4) and abs(d.tilt[1]) < 2e-4
    xs = np.array([x.min(), x.max()])
    el = -20.0 - 0.002 * (xs - g.frame.origin_crs[0]) + [cc._el_offset(d, g.frame, v, 0.0) for v in xs]
    assert np.allclose(el, pc.GROUND_EL, atol=0.05)


def test_fit_datum_falls_back_to_base_elevations(scene):
    pts, items = scene
    g = pc.grid()
    two_drawn = [
        it.model_copy(update={"height_source": "indicative"}) if it.id == "tank-c" else it for it in items
    ]
    with_bases = [
        it.model_copy(update={"base_el": pc.GROUND_EL}) if it.base_el is None else it for it in two_drawn
    ]
    sample = pc.to_sample(g, pts)
    assert cc.fit_datum(sample, g, with_bases).offset_m == pytest.approx(pc.EL_OFFSET, abs=0.05)
    assert cc.fit_datum(sample, g, items[:2]) is None  # one drawn base, one without: under 3 usable
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q -k datum`

Expected: 3 failed, `AttributeError: module 'app.asset_models.cloudcheck' has no attribute 'fit_datum'`.

- [ ] **Step 3: Implement**

In `backend/app/asset_models/cloudcheck.py`, replace the import block (from `from __future__ import annotations` down to `from app.jobs.cancellation import JobCancelled`) with:

```python
from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from pyproj import CRS
from pyproj.exceptions import CRSError

from app.asset_models.siteframe import PlantGrid, footprint_polygon, footprint_ref
from app.asset_models.spec import CloudDatum, Item, ItemFlag, SiteCrs, SiteFrame
from app.jobs.cancellation import JobCancelled
```

Replace the whole `PlantSample` class with (it gains the cached `_index` field and `index()`):

```python
@dataclass
class PlantSample:
    """A bounded plant-extent sample. `xyz` is float32: site x, y relative to `origin` (float32 cannot
    hold UTM metres to the centimetre), and the cloud's own z."""

    xyz: np.ndarray
    cloud_id: str
    crs_epsg: int | None
    bbox: tuple[float, float, float, float]
    crs_wkt: str | None = None
    origin: tuple[float, float] = (0.0, 0.0)
    total: int = 0
    _index: _Index | None = field(default=None, repr=False, compare=False)

    def site_xy(self, idx=slice(None)) -> np.ndarray:
        return self.xyz[idx, :2].astype(np.float64) + np.asarray(self.origin, dtype=np.float64)

    def save(self, path: Path) -> None:
        """An .npz the run keeps, so a resumed run does not read the cloud again."""
        tmp = path.with_name(path.name + ".tmp.npz")
        np.savez(
            tmp,
            xyz=self.xyz,
            bbox=np.asarray(self.bbox, dtype=np.float64),
            origin=np.asarray(self.origin, dtype=np.float64),
            total=np.array([self.total]),
            epsg=np.array([-1 if self.crs_epsg is None else int(self.crs_epsg)]),
            text=np.array([self.cloud_id, self.crs_wkt or ""]),
        )
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> PlantSample:
        with np.load(path) as d:
            epsg = int(d["epsg"][0])
            cloud_id, wkt = (str(v) for v in d["text"])
            return cls(
                xyz=d["xyz"],
                cloud_id=cloud_id,
                crs_epsg=None if epsg < 0 else epsg,
                bbox=tuple(float(v) for v in d["bbox"]),
                crs_wkt=wkt or None,
                origin=tuple(float(v) for v in d["origin"]),
                total=int(d["total"][0]),
            )

    def index(self) -> _Index:
        if self._index is None:
            self._index = _Index(self.xyz[:, :2])
        return self._index
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- spatial index and item windows


class _Index:
    """Sample points bucketed on a 10 m site grid, so a box query never scans the whole sample."""

    CELL = 10.0

    def __init__(self, xy: np.ndarray):
        self.n = len(xy)
        if self.n == 0:
            self.nx = self.ny = 0
            return
        self.lo = xy.min(axis=0).astype(np.float64)
        ix = ((xy[:, 0] - np.float32(self.lo[0])) / np.float32(self.CELL)).astype(np.int64)
        iy = ((xy[:, 1] - np.float32(self.lo[1])) / np.float32(self.CELL)).astype(np.int64)
        self.nx, self.ny = int(ix.max()) + 1, int(iy.max()) + 1
        key = iy * self.nx + ix
        del ix, iy
        self.order = np.argsort(key, kind="stable").astype(np.int32 if self.n < 2**31 else np.int64)
        self.starts = np.concatenate([[0], np.cumsum(np.bincount(key, minlength=self.nx * self.ny))])

    def query(self, x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
        """Indices of points in the cells overlapping the box (coordinates relative to the sample)."""
        if self.n == 0:
            return np.zeros(0, np.int64)
        i0 = math.floor((x0 - self.lo[0]) / self.CELL)
        i1 = math.floor((x1 - self.lo[0]) / self.CELL)
        j0 = math.floor((y0 - self.lo[1]) / self.CELL)
        j1 = math.floor((y1 - self.lo[1]) / self.CELL)
        if i1 < 0 or j1 < 0 or i0 >= self.nx or j0 >= self.ny:
            return np.zeros(0, np.int64)
        i0, i1 = max(i0, 0), min(i1, self.nx - 1)
        j0, j1 = max(j0, 0), min(j1, self.ny - 1)
        parts = [
            self.order[self.starts[j * self.nx + i0] : self.starts[j * self.nx + i1 + 1]]
            for j in range(j0, j1 + 1)
        ]
        return np.concatenate(parts).astype(np.int64) if parts else np.zeros(0, np.int64)


def _poly(item: Item):
    ring = np.asarray(footprint_polygon(item.footprint), dtype=np.float64)
    if len(ring) < 3 or not np.isfinite(ring).all():
        return None
    poly = shapely.make_valid(shapely.Polygon(ring))
    if poly.is_empty or poly.area < 0.01:
        return None
    return poly


@dataclass
class _Local:
    poly: object
    window: tuple[float, float, float, float]  # plant [E, N] box: footprint bounds grown by the margin
    e: np.ndarray
    n: np.ndarray
    z: np.ndarray
    inside: np.ndarray
    ref_site: tuple[float, float]


def _local(sample: PlantSample, grid: PlantGrid, item: Item, margin: float) -> _Local | None:
    poly = _poly(item)
    if poly is None:
        return None
    a0, b0, a1, b1 = poly.bounds
    win = (a0 - margin, b0 - margin, a1 + margin, b1 + margin)
    cx, cy = grid.plant_to_site(
        np.array([win[0], win[2], win[2], win[0]]), np.array([win[1], win[1], win[3], win[3]])
    )
    ox, oy = sample.origin
    idx = sample.index().query(cx.min() - ox, cy.min() - oy, cx.max() - ox, cy.max() - oy)
    if len(idx) > ITEM_CAP:
        idx = idx[:: math.ceil(len(idx) / ITEM_CAP)]
    xy = sample.site_xy(idx)
    e, n = grid.site_to_plant(xy[:, 0], xy[:, 1])
    e, n = np.asarray(e, dtype=np.float64), np.asarray(n, dtype=np.float64)
    z = sample.xyz[idx, 2].astype(np.float64)
    keep = (e >= win[0]) & (e <= win[2]) & (n >= win[1]) & (n <= win[3])
    e, n, z = e[keep], n[keep], z[keep]
    inside = shapely.contains_xy(poly, e, n) if len(e) else np.zeros(0, bool)
    re_, rn = footprint_ref(item.footprint)
    rx, ry = grid.plant_to_site(np.array([re_]), np.array([rn]))
    return _Local(poly, win, e, n, z, inside, (float(rx[0]), float(ry[0])))


def _el_offset(datum: CloudDatum, frame: SiteFrame, x: float, y: float) -> float:
    """plant EL = cloud z + this, at site (x, y)."""
    off = float(datum.offset_m)
    if datum.tilt is not None:
        off += datum.tilt[0] * (x - frame.origin_crs[0]) + datum.tilt[1] * (y - frame.origin_crs[1])
    return off


# ---------------------------------------------------------------- datum


def fit_datum(sample: PlantSample, grid: PlantGrid, items: list[Item]) -> CloudDatum | None:
    """plant EL = cloud z + offset_m (+ tilt . [x - origin_x, y - origin_y]).

    From the ground ring around items with drawing base elevations (median; a tilt when 6+ of them
    span 200 m+ and a plane explains the spread clearly better). With fewer than 3 such items, the
    median base_el of every item that has one, against the sample's 5th z percentile. Else None.
    """
    frame = grid.frame
    if _skip_note(sample, frame) is not None or len(sample.xyz) == 0:
        return None
    pairs: list[tuple[float, float, float]] = []
    for it in items:
        if it.height_source != "drawing" or it.base_el is None:
            continue
        try:
            loc = _local(sample, grid, it, RING_M)
        except (ValueError, ArithmeticError, shapely.errors.ShapelyError):
            continue
        if loc is None:
            continue
        outside = loc.z[~loc.inside]
        if len(outside) < 20:
            continue
        pairs.append((loc.ref_site[0], loc.ref_site[1], it.base_el - float(np.percentile(outside, 10))))
    if len(pairs) >= 3:
        return _fit_offsets(np.asarray(pairs), frame, sample.cloud_id)
    bases = [it.base_el for it in items if it.base_el is not None]
    if len(bases) >= 3:
        ground_z = float(np.percentile(sample.xyz[:, 2], 5))
        return CloudDatum(cloud_id=sample.cloud_id, offset_m=round(float(np.median(bases)) - ground_z, 3))
    return None


def _fit_offsets(a: np.ndarray, frame: SiteFrame, cloud_id: str) -> CloudDatum:
    off = a[:, 2]
    med = float(np.median(off))
    if len(a) >= 6 and math.hypot(np.ptp(a[:, 0]), np.ptp(a[:, 1])) >= 200.0:
        A = np.column_stack([np.ones(len(a)), a[:, 0] - frame.origin_crs[0], a[:, 1] - frame.origin_crs[1]])
        sol = np.linalg.lstsq(A, off, rcond=None)[0]
        r_plane = float(np.sqrt(np.mean((off - A @ sol) ** 2)))
        r_const = float(np.sqrt(np.mean((off - med) ** 2)))
        if r_const > 0.05 and r_plane < 0.7 * r_const:
            return CloudDatum(
                cloud_id=cloud_id,
                offset_m=round(float(sol[0]), 3),
                tilt=(round(float(sol[1]), 7), round(float(sol[2]), 7)),
            )
    return CloudDatum(cloud_id=cloud_id, offset_m=round(med, 3))
```

- [ ] **Step 4: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: `15 passed`. Planning measured `offset_m = 124.512` on the scene (the ground has 1 cm noise) and a tilt of `(0.002, 0.0)` on the wide site.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/cloudcheck.py backend/tests/test_plant_cloudcheck.py
git commit -m "feat(asset-models): cloud datum fit from drawing elevations (C1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C4: Per-item heights and flags

**Files:**
- Modify: `backend/app/asset_models/cloudcheck.py` (import block, append a section)
- Modify: `backend/tests/test_plant_cloudcheck.py` (append)

**Interfaces:**
- Consumes: `_local`, `_el_offset`, `fit_datum` (Task C3).
- Produces: `_raster(loc, cell, pick=None) -> (hit, mask)`; `_best_shift(occ, mask, cell) -> (dE, dN) | None`; `_check_one(sample, grid, item, datum) -> ItemCheck | None`; `check_items` (candidates empty until Task C5).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_plant_cloudcheck.py` (the `checked` fixture is module-scoped, so the scene is checked once):

```python
@pytest.fixture(scope="module")
def checked(scene):
    pts, items = scene
    g = pc.grid()
    sample = pc.to_sample(g, pts)
    datum = cc.fit_datum(sample, g, items)
    return items, datum, cc.check_items(sample, g, items, datum)


def test_check_skips_cloud_in_other_crs(scene):
    pts, items = scene
    g = pc.grid()
    for epsg, wording in ((32640, "different coordinate system"), (None, "no coordinate system")):
        sample = pc.to_sample(g, pts, epsg=epsg)
        assert cc.fit_datum(sample, g, items) is None
        result = cc.check_items(sample, g, items, None)
        assert result.items == {} and result.candidates == [] and result.datum is None
        assert wording in result.note


# ---------------------------------------------------------------- per item


def test_known_tanks_get_cloud_heights(checked):
    _, _, r = checked
    a, b = r.items["tank-a"], r.items["tank-b"]
    assert a.ground_el == pytest.approx(pc.GROUND_EL, abs=0.05) and a.top_el == pytest.approx(134.5, abs=0.05)
    assert b.top_el == pytest.approx(129.5, abs=0.05)
    assert a.flags == [] and b.flags == []
    assert a.coverage > 0.9 and a.offset_m == 0.0


def test_drawing_height_that_disagrees_is_flagged(checked):
    _, _, r = checked
    (flag,) = r.items["tank-c"].flags
    assert flag.code == "height_mismatch" and flag.value == pytest.approx(-2.5, abs=0.05)


def test_scanned_but_empty_footprint_is_missing_in_cloud(checked):
    _, _, r = checked
    pad = r.items["pad-missing"]
    assert [f.code for f in pad.flags] == ["missing_in_cloud"]
    assert pad.top_el is None and pad.coverage >= 0.5


def test_offset_item_is_flagged_with_the_shift(checked):
    _, _, r = checked
    chk = r.items["pkg-offset"]
    (flag,) = chk.flags
    assert flag.code == "plan_offset" and flag.value == pytest.approx(3.0, abs=0.5)
    assert "+3.0 m east" in flag.note
    assert chk.top_el == pytest.approx(108.5, abs=0.05)


def test_check_without_a_datum_flags_but_gives_no_heights(scene):
    pts, items = scene
    g = pc.grid()
    r = cc.check_items(pc.to_sample(g, pts), g, items, None)
    assert "No cloud datum" in r.note
    assert all(c.top_el is None and c.ground_el is None for c in r.items.values())
    assert [f.code for f in r.items["pad-missing"].flags] == ["missing_in_cloud"]
    assert [f.code for f in r.items["pkg-offset"].flags] == ["plan_offset"]


def test_check_survives_a_degenerate_footprint(scene):
    pts, items = scene
    g = pc.grid()
    bad = pc.item("bad", "trestle", {"kind": "line", "pts": [[1330, 600], [1330, 600]], "width": 4})
    r = cc.check_items(pc.to_sample(g, pts), g, [*items, bad], None)
    assert "bad" not in r.items and len(r.items) == len(items)


def test_flat_types_get_coverage_only(scene):
    pts, _ = scene
    g = pc.grid()
    road = pc.item("rd", "road", {"kind": "line", "pts": [[1300, 600], [1330, 600]], "width": 6})
    r = cc.check_items(pc.to_sample(g, pts), g, [road], None)
    assert r.items["rd"].flags == [] and r.items["rd"].coverage > 0.5


def test_per_item_points_are_capped(scene, monkeypatch):
    pts, items = scene
    g = pc.grid()
    monkeypatch.setattr(cc, "ITEM_CAP", 1_000)
    seen = []
    real = cc._local

    def spy(*a, **k):
        loc = real(*a, **k)
        seen.append(len(loc.z))
        return loc

    monkeypatch.setattr(cc, "_local", spy)
    sample = pc.to_sample(g, pts)
    r = cc.check_items(sample, g, items, cc.fit_datum(sample, g, items))
    assert seen and max(seen) <= 1_000
    assert r.items["tank-b"].top_el == pytest.approx(129.5, abs=0.1)
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: 5 failed and 4 errors (the four tests that use the `checked` fixture error in its setup), all `AttributeError: module 'app.asset_models.cloudcheck' has no attribute 'check_items'`.

- [ ] **Step 3: Implement**

In `backend/app/asset_models/cloudcheck.py`, replace the import block with:

```python
from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from pyproj import CRS
from pyproj.exceptions import CRSError
from scipy import signal

from app.asset_models.siteframe import PlantGrid, footprint_polygon, footprint_ref
from app.asset_models.spec import CloudDatum, Item, ItemFlag, SiteCrs, SiteFrame
from app.jobs.cancellation import JobCancelled
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- per item


def _raster(loc: _Local, cell: float, pick: np.ndarray | None = None):
    """(hit grid of the picked points, footprint mask of cell centres) on the window at `cell` metres."""
    e0, n0, e1, n1 = loc.window
    w = max(1, math.ceil((e1 - e0) / cell))
    h = max(1, math.ceil((n1 - n0) / cell))
    hit = np.zeros((h, w), bool)
    sel = np.ones(len(loc.e), bool) if pick is None else pick
    cols = np.clip(((loc.e[sel] - e0) / cell).astype(np.int64), 0, w - 1)
    rows_ = np.clip(((loc.n[sel] - n0) / cell).astype(np.int64), 0, h - 1)
    hit[rows_, cols] = True
    ce, cn = np.meshgrid(e0 + (np.arange(w) + 0.5) * cell, n0 + (np.arange(h) + 0.5) * cell)
    mask = shapely.contains_xy(loc.poly, ce, cn)
    return hit, mask


def _best_shift(occ: np.ndarray, mask: np.ndarray, cell: float) -> tuple[float, float] | None:
    """The (dE, dN) shift of the footprint mask that best covers the occupied cells, within SEARCH_M.
    Ties go to the smallest shift. None when too little of the cloud matches any shift."""
    m = int(mask.sum())
    if m == 0 or int(occ.sum()) < 4:
        return None
    h, w = mask.shape
    s = min(max(1, math.ceil(SEARCH_M / cell)), h - 1, w - 1)
    if s < 1:
        return None
    corr = signal.correlate(occ.astype(np.float32), mask.astype(np.float32), mode="full", method="fft")
    sub = corr[h - 1 - s : h + s, w - 1 - s : w + s]
    best = float(sub.max())
    if best < max(4.0, 0.2 * m):
        return None
    dy, dx = np.mgrid[-s : s + 1, -s : s + 1]
    norms = np.hypot(dy, dx).astype(np.float64)
    norms[sub < best - 0.5] = np.inf
    k = np.unravel_index(int(np.argmin(norms)), norms.shape)
    return float(dx[k] * cell), float(dy[k] * cell)


def _check_one(
    sample: PlantSample, grid: PlantGrid, item: Item, datum: CloudDatum | None
) -> ItemCheck | None:
    loc = _local(sample, grid, item, max(RING_M, SEARCH_M))
    if loc is None:
        return None
    if len(loc.z) == 0:
        return ItemCheck(item.id, None, None, 0.0, None, [])
    e0, n0, e1, n1 = loc.window
    cell = max(0.5, math.sqrt((e1 - e0) * (n1 - n0) / WINDOW_CELLS))
    cover_cell = max(cell, COVER_CELL_M)
    any_hit, _ = _raster(loc, cover_cell)
    coverage = round(float(any_hit.mean()), 3)
    outside = loc.z[~loc.inside]
    ground_z = float(np.percentile(outside, 10)) if len(outside) >= 20 else None
    el_off = _el_offset(datum, grid.frame, *loc.ref_site) if datum is not None else None
    ground_el = round(ground_z + el_off, 2) if ground_z is not None and el_off is not None else None
    if item.type in NO_BODY_TYPES or ground_z is None:
        return ItemCheck(item.id, ground_el, None, coverage, None, [])
    above = loc.z > ground_z + ABOVE_ITEM_M
    in_above = above & loc.inside
    top_z = float(np.percentile(loc.z[in_above], 98)) if int(in_above.sum()) >= 10 else None
    top_el = round(top_z + el_off, 2) if top_z is not None and el_off is not None else None
    hit2, mask2 = _raster(loc, cover_cell, in_above)
    cells = int(mask2.sum())
    occupancy = float((hit2 & mask2).sum()) / cells if cells else (1.0 if int(in_above.sum()) >= 3 else 0.0)
    flags: list[ItemFlag] = []
    offset_m = None
    if coverage >= COVER_MIN and occupancy < OCCUPANCY_MAX:
        flags.append(
            ItemFlag(
                code="missing_in_cloud",
                value=round(occupancy, 3),
                note="The scan covers this footprint but nothing stands above the ground in it.",
            )
        )
    else:
        occ, mask = _raster(loc, cell, above)
        shift = _best_shift(occ, mask, cell)
        if shift is not None:
            de, dn = shift
            offset_m = round(math.hypot(de, dn), 2)
            if offset_m > PLAN_TOL_M:
                flags.append(
                    ItemFlag(
                        code="plan_offset",
                        value=offset_m,
                        note=f"The cloud fits best {de:+.1f} m east, {dn:+.1f} m north of the drawn "
                        "position. The position is kept as drawn.",
                    )
                )
    if (
        item.height_source == "drawing"
        and item.top_el is not None
        and top_el is not None
        and abs(top_el - item.top_el) > HEIGHT_TOL_M
    ):
        flags.append(
            ItemFlag(
                code="height_mismatch",
                value=round(top_el - item.top_el, 2),
                note=f"Cloud top EL {top_el:.2f} against drawing top EL {item.top_el:.2f}.",
            )
        )
    return ItemCheck(item.id, ground_el, top_el, coverage, offset_m, flags)


def check_items(
    sample: PlantSample, grid: PlantGrid, items: list[Item], datum: CloudDatum | None
) -> CheckResult:
    frame = grid.frame
    skip = _skip_note(sample, frame)
    if skip is not None:
        return CheckResult(None, {}, [], note=skip)
    if datum is not None and datum.cloud_id != sample.cloud_id:
        datum = None
    if len(sample.xyz) == 0:
        return CheckResult(datum, {}, [], note=NO_POINTS)
    out: dict[str, ItemCheck] = {}
    for it in items:
        try:
            chk = _check_one(sample, grid, it, datum)
        except (ValueError, ArithmeticError, shapely.errors.ShapelyError):
            chk = None  # one unreadable footprint never stops the check (the validator reports it)
        if chk is not None:
            out[it.id] = chk
    cands: list[Candidate] = []  # unregistered candidates arrive in the next task
    return CheckResult(datum, out, cands, note=None if datum is not None else NO_DATUM)
```

- [ ] **Step 4: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: `24 passed`. Planning measured on the scene: tank-a top EL 134.51; tank-b 129.51; tank-c `height_mismatch` −2.49; pad-missing `missing_in_cloud` (occupancy 0.0, coverage 1.0); pkg-offset `plan_offset` 3.0 ("+3.0 m east, +0.0 m north").

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/cloudcheck.py backend/tests/test_plant_cloudcheck.py
git commit -m "feat(asset-models): per-item cloud heights and flags, other-CRS skip (C1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C5: Unregistered candidates

**Files:**
- Modify: `backend/app/asset_models/cloudcheck.py` (import block, one line in `check_items`, append a section)
- Modify: `backend/tests/test_plant_cloudcheck.py` (append)

**Interfaces:**
- Consumes: `_poly`, `_el_offset`, `check_items` (Tasks C3, C4).
- Produces: `_cells(...)`, `_footprint_mask(...)`, `_candidates(sample, grid, items, datum) -> list[Candidate]`; `check_items` now fills `candidates`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_plant_cloudcheck.py`:

```python
# ---------------------------------------------------------------- candidates


def test_unregistered_cluster_is_the_one_candidate(checked):
    _, _, r = checked
    (cand,) = r.candidates  # the 2 x 2 m box and the offset item's sliver are not candidates
    assert cand.id == "cand-001"
    e = np.mean([p[0] for p in cand.pts])
    n = np.mean([p[1] for p in cand.pts])
    assert abs(e - 1400) < 1.5 and abs(n - 520) < 1.5
    assert all(4.5 <= s <= 9.0 for s in cand.size_m)
    assert cand.top_el == pytest.approx(109.5, abs=0.1)


def test_candidates_survive_a_sparse_sample(scene, tmp_path, handle, make_cloud):
    pts, items = scene
    g = pc.grid()
    cid = make_cloud(make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts)))
    s = cc.sample_plant_cloud(handle, cid, _site_box(g, pts), max_points=30_000)
    r = cc.check_items(s, g, items, cc.fit_datum(s, g, items))
    assert len(r.candidates) == 1
    assert [f.code for f in r.items["tank-c"].flags] == ["height_mismatch"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q -k candidate`

Expected: 2 failed: `ValueError: not enough values to unpack (expected 1, got 0)` and `assert 0 == 1`.

- [ ] **Step 3: Implement**

In `backend/app/asset_models/cloudcheck.py`, replace the import block with:

```python
from __future__ import annotations

import math
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from pyproj import CRS
from pyproj.exceptions import CRSError
from scipy import ndimage, signal

from app.asset_models.siteframe import PlantGrid, footprint_polygon, footprint_ref
from app.asset_models.spec import CloudDatum, Item, ItemFlag, SiteCrs, SiteFrame
from app.jobs.cancellation import JobCancelled
```

In `check_items`, replace the line

```python
    cands: list[Candidate] = []  # unregistered candidates arrive in the next task
```

with

```python
    cands = _candidates(sample, grid, items, datum)
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- unregistered candidates


def _cells(sample: PlantSample, grid: PlantGrid, e0: float, n0: float, cell: float, w: int, h: int):
    """(flat cell index, z) per point, in CHUNK-sized slices of the sample."""
    for s in range(0, len(sample.xyz), CHUNK):
        sl = slice(s, s + CHUNK)
        xy = sample.site_xy(sl)
        e, n = grid.site_to_plant(xy[:, 0], xy[:, 1])
        c = np.floor((np.asarray(e) - e0) / cell).astype(np.int64)
        r = np.floor((np.asarray(n) - n0) / cell).astype(np.int64)
        ok = (c >= 0) & (c < w) & (r >= 0) & (r < h)
        yield r[ok] * w + c[ok], sample.xyz[sl, 2][ok]


def _footprint_mask(items: list[Item], e0: float, n0: float, cell: float, h: int, w: int) -> np.ndarray:
    m = np.zeros((h, w), bool)
    for it in items:
        try:
            poly = _poly(it)
        except (ValueError, ArithmeticError, shapely.errors.ShapelyError):
            continue
        if poly is None:
            continue
        grown = poly.buffer(CAND_EXCLUDE_M)
        a0, b0, a1, b1 = grown.bounds
        c0, c1 = max(0, int((a0 - e0) // cell)), min(w - 1, int((a1 - e0) // cell))
        r0, r1 = max(0, int((b0 - n0) // cell)), min(h - 1, int((b1 - n0) // cell))
        if c1 < c0 or r1 < r0:
            continue
        ce, cn = np.meshgrid(
            e0 + (np.arange(c0, c1 + 1) + 0.5) * cell, n0 + (np.arange(r0, r1 + 1) + 0.5) * cell
        )
        m[r0 : r1 + 1, c0 : c1 + 1] |= shapely.contains_xy(grown, ce, cn)
    return m


def _candidates(
    sample: PlantSample, grid: PlantGrid, items: list[Item], datum: CloudDatum | None
) -> list[Candidate]:
    """Connected above-ground cell clusters at least CAND_MIN_M x CAND_MIN_M that no footprint covers."""
    x0, y0, x1, y1 = sample.bbox
    ce, cn = grid.site_to_plant(np.array([x0, x1, x1, x0]), np.array([y0, y0, y1, y1]))
    e0, n0 = float(np.min(ce)), float(np.min(cn))
    span_e, span_n = float(np.max(ce)) - e0, float(np.max(cn)) - n0
    area = max((x1 - x0) * (y1 - y0), 1.0)
    cell = max(CAND_CELL_M, math.sqrt(CAND_PTS_PER_CELL / max(len(sample.xyz) / area, 1e-9)))
    if (span_e / cell) * (span_n / cell) > CAND_MAX_GRID:
        cell = math.sqrt(span_e * span_n / CAND_MAX_GRID)
    w, h = int(span_e // cell) + 1, int(span_n // cell) + 1
    cmin = np.full(h * w, np.inf, np.float32)
    for k, z in _cells(sample, grid, e0, n0, cell, w, h):
        np.minimum.at(cmin, k, z)
    b = CAND_BLOCK
    hb, wb = -(-h // b), -(-w // b)
    pad = np.full((hb * b, wb * b), np.nan, np.float32)
    pad[:h, :w] = np.where(np.isfinite(cmin), cmin, np.nan).reshape(h, w)
    blocks = pad.reshape(hb, b, wb, b).transpose(0, 2, 1, 3).reshape(hb, wb, b * b)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-empty blocks give NaN, filled below
        gb = np.nanpercentile(blocks, 10, axis=2)
    holes = np.isnan(gb)
    if holes.all():
        return []
    if holes.any():
        near = ndimage.distance_transform_edt(holes, return_distances=False, return_indices=True)
        gb = gb[tuple(near)]
    gb = ndimage.minimum_filter(gb, size=3, mode="nearest")
    ground = np.repeat(np.repeat(gb, b, axis=0), b, axis=1)[:h, :w].ravel()
    cnt = np.zeros(h * w, np.int64)
    cmax = np.full(h * w, -np.inf, np.float32)
    for k, z in _cells(sample, grid, e0, n0, cell, w, h):
        up = z > ground[k] + ABOVE_CAND_M
        cnt += np.bincount(k[up], minlength=h * w)
        np.maximum.at(cmax, k[up], z[up])
    occ = (cnt >= 2).reshape(h, w) & ~_footprint_mask(items, e0, n0, cell, h, w)
    lab, _ = ndimage.label(occ, structure=np.ones((3, 3), bool))
    cmax = cmax.reshape(h, w)
    found: list[tuple[int, Candidate]] = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        size_n = (sl[0].stop - sl[0].start) * cell
        size_e = (sl[1].stop - sl[1].start) * cell
        if size_e < CAND_MIN_M - 1e-9 or size_n < CAND_MIN_M - 1e-9:
            continue
        rr, cc = np.nonzero(lab[sl] == i)
        rr, cc = rr + sl[0].start, cc + sl[1].start
        e = e0 + cc * cell
        n = n0 + rr * cell
        corners = np.concatenate(
            [np.column_stack([e + de, n + dn]) for de in (0.0, cell) for dn in (0.0, cell)]
        )
        hull = shapely.MultiPoint(corners).convex_hull
        ring = list(hull.exterior.coords)[:-1] if hull.geom_type == "Polygon" else list(hull.coords)
        top_z = float(np.percentile(cmax[rr, cc], 98))
        if datum is not None:
            sx, sy = grid.plant_to_site(np.array([e.mean() + cell / 2]), np.array([n.mean() + cell / 2]))
            top_z += _el_offset(datum, grid.frame, float(sx[0]), float(sy[0]))
        found.append(
            (
                len(rr),
                Candidate(
                    id="",
                    pts=[(round(float(a), 2), round(float(c), 2)) for a, c in ring[:500]],
                    top_el=round(top_z, 2),
                    size_m=(round(size_e, 1), round(size_n, 1)),
                ),
            )
        )
    found.sort(key=lambda t: -t[0])
    out = [c for _, c in found[:CAND_LIMIT]]
    for k, c in enumerate(out, start=1):
        c.id = f"cand-{k:03d}"
    return out
```

- [ ] **Step 4: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: `26 passed`. Planning measured one candidate of 6.6 × 6.6 m, top EL 109.51, on the full scene, and 5.7 × 7.6 m on the every-third-point sample (the cell grows to keep about 4 points per cell).

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/cloudcheck.py backend/tests/test_plant_cloudcheck.py
git commit -m "feat(asset-models): unregistered above-ground candidates (C1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C6: Apply the check and summarise it

**Files:**
- Modify: `backend/app/asset_models/cloudcheck.py` (import block, append a section)
- Modify: `backend/tests/test_plant_cloudcheck.py` (append)

**Interfaces:**
- Consumes: `CheckResult`, `ItemCheck`, `CLOUD_CODES` (Task C2); `check_items` (Task C5).
- Produces: `apply_check(items, result) -> list[Item]`; `summarise(result, *, limit=300) -> dict` with keys `datum, note, checked, flag_counts, items[{id, ground_el, top_el, coverage, offset_m, flags[{code, value}]}], truncated, candidates[{id, size_m, top_el, pts (≤ 64)}] (≤ 50), candidates_total`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_plant_cloudcheck.py`:

```python
# ---------------------------------------------------------------- apply and summarise


def test_apply_check_leaves_a_skipped_cloud_alone(scene):
    pts, items = scene
    g = pc.grid()
    result = cc.check_items(pc.to_sample(g, pts, epsg=32640), g, items, None)
    assert cc.apply_check(items, result) == items  # never projected, never touched


def test_apply_check_fills_indicative_heights_and_never_moves(checked):
    items, _, r = checked
    out = cc.apply_check(items, r)
    by = {it.id: it for it in out}
    assert [it.id for it in out] == [it.id for it in items]
    for before in items:
        after = by[before.id]
        assert after.footprint == before.footprint
    assert by["tank-b"].height_source == "cloud"
    assert by["tank-b"].base_el == pytest.approx(pc.GROUND_EL, abs=0.05)
    assert by["tank-b"].top_el == pytest.approx(129.5, abs=0.05)
    assert by["tank-c"].height_source == "drawing" and by["tank-c"].top_el == 134.5
    assert [f.code for f in by["tank-c"].flags] == ["height_mismatch"]
    assert by["pad-missing"].height_source == "indicative" and by["pad-missing"].top_el is None


def test_apply_check_replaces_stale_cloud_flags(checked):
    items, _, r = checked
    old = [{"code": "plan_offset", "value": 9.0}, {"code": "builder_fallback"}]
    stale = [
        type(it).model_validate({**it.model_dump(), "flags": old}) if it.id == "tank-a" else it
        for it in items
    ]
    out = {it.id: it for it in cc.apply_check(stale, r)}
    assert [f.code for f in out["tank-a"].flags] == ["builder_fallback"]


def test_summarise_is_bounded_and_flagged_first(checked):
    _, _, r = checked
    s = cc.summarise(r, limit=2)
    assert s["checked"] == 5 and s["truncated"] is True and len(s["items"]) == 2
    assert all(row["flags"] for row in s["items"])
    assert s["flag_counts"] == {"height_mismatch": 1, "missing_in_cloud": 1, "plan_offset": 1}
    assert s["candidates_total"] == 1 and s["datum"]["offset_m"] == pytest.approx(pc.EL_OFFSET, abs=0.05)
    import json

    json.dumps(s, allow_nan=False)
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q -k "apply or summarise"`

Expected: 4 failed, `AttributeError: module 'app.asset_models.cloudcheck' has no attribute 'apply_check'` (and `summarise`).

- [ ] **Step 3: Implement**

In `backend/app/asset_models/cloudcheck.py`, replace the import block with:

```python
from __future__ import annotations

import math
import warnings
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from pyproj import CRS
from pyproj.exceptions import CRSError
from scipy import ndimage, signal

from app.asset_models.siteframe import PlantGrid, footprint_polygon, footprint_ref
from app.asset_models.spec import CloudDatum, Item, ItemFlag, SiteCrs, SiteFrame
from app.jobs.cancellation import JobCancelled
```

Append to the end of the file:

```python
# ---------------------------------------------------------------- applying and reporting


def apply_check(items: list[Item], result: CheckResult) -> list[Item]:
    """Heights where the item's are indicative become cloud heights; cloud flags are replaced by this
    check's. Footprints, ids and every other field are never changed (D5)."""
    out: list[Item] = []
    for it in items:
        chk = result.items.get(it.id)
        if chk is None:
            out.append(it)
            continue
        update: dict = {"flags": [f for f in it.flags if f.code not in CLOUD_CODES] + list(chk.flags)}
        if (
            it.height_source == "indicative"
            and chk.ground_el is not None
            and chk.top_el is not None
            and chk.top_el > chk.ground_el
        ):
            update.update(base_el=chk.ground_el, top_el=chk.top_el, height_source="cloud")
        out.append(it.model_copy(update=update))
    return out


def summarise(result: CheckResult, *, limit: int = 300) -> dict:
    """A bounded, JSON-ready digest for the run (the cloud_check tool's reply): flagged items first."""
    counts = Counter(f.code for c in result.items.values() for f in c.flags)
    rows = sorted(result.items.values(), key=lambda c: (not c.flags, c.item_id))
    return {
        "datum": None if result.datum is None else result.datum.model_dump(),
        "note": result.note,
        "checked": len(result.items),
        "flag_counts": dict(sorted(counts.items())),
        "items": [
            {
                "id": c.item_id,
                "ground_el": c.ground_el,
                "top_el": c.top_el,
                "coverage": c.coverage,
                "offset_m": c.offset_m,
                "flags": [{"code": f.code, "value": f.value} for f in c.flags],
            }
            for c in rows[:limit]
        ],
        "truncated": len(rows) > limit,
        "candidates": [
            {"id": c.id, "size_m": list(c.size_m), "top_el": c.top_el, "pts": [list(p) for p in c.pts[:64]]}
            for c in result.candidates[:50]
        ],
        "candidates_total": len(result.candidates),
    }
```

- [ ] **Step 4: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_cloudcheck.py -q`

Expected: `30 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/cloudcheck.py backend/tests/test_plant_cloudcheck.py
git commit -m "feat(asset-models): apply the cloud check without moving items (C1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C7: Gate and hand-over

**Files:** none changed unless the gate finds something.

- [ ] **Step 1: Catch up with `main`**

```
git fetch
git rebase main
```

If F0 or another unit changed `spec.py` or `siteframe.py` since Task C1, rerun Task C1 Step 1's checks and `tests/test_plant_cloudcheck.py`.

- [ ] **Step 2: Run the full gate**

Run the gate block from this part's header (PowerShell, worktree root). Expected: every line green. `ruff check` and `ruff format --check` print no findings for `cloudcheck.py`, `plant_cloud.py` and `test_plant_cloudcheck.py` (planning ran both on these exact files). The backend suite gains 30 tests.

- [ ] **Step 3: Hand-over line**

Put this in the ledger and the hand-off message: "Not user-observable: C1 adds a backend module that the plant run (R1) calls. Nothing changes in the app until R1's `cloud_check` tool merges."

No merge, push, installer or `/wrapup` in this unit; the coordinator merges.

---

# Part K: unit K1, scorer and live acceptance skeleton

**Unit:** K1. **Worktree:** `.claude/worktrees/pm-k1`, branch `task/pm-k1`. **Cut after:** F0. **Merge position:** batch 2, any order; L1 consumes it.

**Interfaces provided** (`backend/app/asset_models/score.py`):

```python
TYPE_FAMILY: dict[str, str]          # 45 catalogue types + other/composite → family
@dataclass(frozen=True)
class Required: key: str; tag: str | None = None; node: str | None = None; type: str | None = None; radius_m: float = 0.0
KIPIC_REQUIRED: tuple[Required, ...]
@dataclass
class ScoreReport: tagged_ref: int; tagged_found: int; type_match: int; recall: float; type_accuracy: float; pos_err_p50_m: float; pos_err_p95_m: float; within_tol: float; by_area: dict[str, dict]; missing: list[str]; extra: list[str]; required_present: dict[str, bool]; landmask_hausdorff_m: float | None
def read_register(path: Path) -> list[dict]
def score(gen: list[dict], ref: list[dict], *, gen_land: list | None = None, ref_land: list | None = None) -> ScoreReport
def normalise_tag(tag: object) -> str
def types_match(gen_type: str, ref_type: str) -> bool
def tolerance_m(gen_row: dict) -> float
def required_present(gen: list[dict], ref: list[dict], required: Iterable[Required] = KIPIC_REQUIRED) -> dict[str, bool]
def extent(ref: list[dict], margin_m: float = 100.0) -> tuple[float, float, float, float] | None
def landmask_hausdorff(gen_land: list, ref_land: list, box: tuple[float, float, float, float] | None) -> float
def read_land(path: Path) -> list[list[list[float]]]
def land_from_environment(environment: list[dict]) -> list[list[list[float]]]
def footprint_size_m(fp: dict) -> float | None
def with_footprint_sizes(rows: list[dict], spec: dict) -> list[dict]
def report_dict(rep: ScoreReport) -> dict          # NaN / inf → None
def report_markdown(rep: ScoreReport) -> str
def main(argv: list[str] | None = None) -> int
# CLI: python -m app.asset_models.score <gen.csv> <ref.csv> [--gen-land x.json --ref-land y.json] [--gen-spec spec.json] [--json out.json]
```

`by_area[area]` = `{ref, found, type_match, positioned, within, recall, type_accuracy}`; an empty area is `"(none)"`.

Test helpers (`backend/tests/plant_live_helpers.py`): `copy_project_state(src: Path, dst: Path) -> Path`; `pick_sources(drawings, clouds, sheets=SHEETS, limit=50) -> tuple[list[dict], list[str]]`; `SHEETS = ("T0003", "T0005", "T0006", "T0007", "T0008")`.

**Interfaces consumed:**
- F0: `backend/tests/data/plant/kipic_register.csv` (Cowork's 885-row register, read-only).
- The live test only (skipped in the gate), through HTTP: `openProject` (`POST /api/v1/projects/open`), `listDrawings`, `listPointClouds`, `createAssetModel` with F0's `kind: "plant"`, `startAssetModelRun` with F0's `mode: "plant"` (R1 implements it; 202), `getAssetModelRun` (F0's `usage_by_stage`, `packages`), `getAssetModelVersion`, `getAssetModelCsv` (A1; polled until 200).

**Budget:**
- Background jobs: none new. The scorer is offline: two CSVs (≤ 20 000 rows each) and two small land files in memory. The live test starts R1's `asset_model_run` plant job and waits up to 4.5 h.
- Bounded reads: the live test copies only the project database and the Kestrel folders `drawings/`, `maps/`, `pointclouds/` without octrees; the multi-GB raw folders (`Ortho/`, `Point_Cloud/`, photos) are read in place by the run, never copied or loaded whole.

**Shared-file touches:** none. New files: `backend/app/asset_models/score.py`, `backend/tests/data/plant/kipic_landmask.json`, `backend/tests/plant_live_helpers.py`, `backend/tests/test_plant_score.py`, `backend/tests/test_plant_live_helpers.py`, `backend/tests/test_plant_live.py`. `backend/tests/data/plant/kipic_register.csv` is F0's and is only read. The evidence folder `docs/evidence/2026-10-03-plant-model-g1/` is written by the live test at run time, not in this unit.

**Tests:** `test_plant_score.py` (new, 16 tests), `test_plant_live_helpers.py` (new, 2 tests), `test_plant_live.py` (new, 1 test, marker `live`, deselected by `addopts`).

**Execution DAG:** K1 → K2 → K3 → K4 → K5 → K6 → K7. K2–K5 all edit `score.py` and `test_plant_score.py`; K6 uses K5's report helpers. No parallel batch inside the unit; the chain is the critical path.

**Gate (Task K7), PowerShell from the worktree root:**

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT = "5380"; $env:E2E_MOCK_PORT = "5381"; pnpm -C frontend e2e
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```

---

### Task K1: Align with merged F0

**Files:** none created; findings go in the ledger. If a check fails, adapt this plan's later code, never the assertions.

- [ ] **Step 1: The register fixture**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -c "import csv; r=list(csv.DictReader(open('tests/data/plant/kipic_register.csv', encoding='utf-8-sig'))); print(len(r), sum(1 for x in r if x['tag']), list(r[0])[:3])"`

Expected: `885 404 ['node', 'tag', 'name']`. If F0 did not add the file, copy it from `E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic\KIPIC_AlZour_Asset_Register.csv` to `backend/tests/data/plant/kipic_register.csv`, add it in Task K2's commit, and log a ruling: K1 added F0's fixture.

- [ ] **Step 2: The data folder is tracked**

Run: `git check-ignore -v backend/tests/data/plant/kipic_landmask.json backend/tests/data/plant/kipic_register.csv`

Expected: no output (neither path is ignored). F0 git-ignores only the Cowork GLB there. If a pattern matches, narrow it in K4's commit only if it is K1's own pattern; otherwise stop and report to the coordinator.

- [ ] **Step 3: The contract names the live test uses**

Run: `Select-String -Path contract/openapi.yaml -Pattern "getAssetModelCsv|plant_package|usage_by_stage" | Select-Object -First 8`

Then read `createAssetModel`'s request schema in `contract/openapi.yaml`.

Expected: `getAssetModelCsv`, a run `mode` enum that holds `plant`, `usage_by_stage`, and a `kind` property on the create body. If `createAssetModel`'s body has no `kind`, drop `"kind": "plant"` from Task K6's create call (the run's `mode` decides). If any name differs, use F0's name in Task K6.

- [ ] **Step 4: Record**

Write the three results in the unit ledger. No commit in this task unless Step 1 copied the register (then it rides in Task K2's commit).

---

### Task K2: Registers, tags and type families

**Files:**
- Create: `backend/app/asset_models/score.py`
- Create: `backend/tests/test_plant_score.py`

**Interfaces:**
- Produces: `TYPE_FAMILY`, `FALLBACK_TYPES`, `normalise_tag`, `types_match`, `read_register`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_plant_score.py`:

```python
# backend/tests/test_plant_score.py
"""The plant register scorer against Cowork's KIPIC register (spec 2026-10-03 §13, K1)."""

from pathlib import Path

import pytest

from app.asset_models import score as sc

DATA = Path(__file__).parent / "data" / "plant"
REGISTER = DATA / "kipic_register.csv"


@pytest.fixture(scope="module")
def ref() -> list[dict]:
    return sc.read_register(REGISTER)


def _tagged(rows):
    return [r for r in rows if r["tag"]]


def test_fixture_is_the_cowork_register(ref):
    assert len(ref) == 885
    assert len(_tagged(ref)) == 404
    assert list(ref[0])[:17] == [
        "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N",
        "base_EL", "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes",
    ]  # fmt: skip
    assert {r["type"] for r in ref} <= set(sc.TYPE_FAMILY)


def test_tags_normalise_case_spaces_and_dashes():
    assert sc.normalise_tag("20-T-0001") == sc.normalise_tag(" 20 – t – 0001 ") == "20T0001"
    assert sc.normalise_tag("70-S-0001A/B") == "70S0001A/B"
    assert sc.normalise_tag(None) == sc.normalise_tag("  ") == ""


def test_type_match_rules():
    assert sc.types_match("pump", "pump")
    assert sc.types_match("package", "pump") and sc.types_match("compressor", "package")
    assert not sc.types_match("package", "building")
    assert sc.types_match("other", "building") and sc.types_match("trestle", "other")
    assert sc.types_match("composite", "tank_lng")
    assert not sc.types_match("fence", "pump")
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: collection error, `ImportError: cannot import name 'score' from 'app.asset_models'`.

- [ ] **Step 3: Write the module**

Create `backend/app/asset_models/score.py`:

```python
# backend/app/asset_models/score.py
"""Score a generated plant register against a reference one (spec 2026-10-03 §13, unit K1).

Offline and pure: two registers (CSV rows as dicts) and optional land outlines in, numbers out. Tags
match after normalising case, whitespace and dashes. Positions are plant metres. Nothing here
touches the database or the network.

CLI: python -m app.asset_models.score <gen.csv> <ref.csv> [--gen-land x.json --ref-land y.json]
     [--gen-spec spec.json] [--json out.json]
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

TYPE_FAMILY: dict[str, str] = {
    **dict.fromkeys(
        [
            "trestle", "jetty_platform", "dolphin", "pipe_rack", "pipe_sleeper", "catwalk", "walkway",
            "stair_tower", "overbridge", "platform", "gangway",
        ],
        "structure",
    ),
    **dict.fromkeys(
        [
            "tank_lng", "vessel_v", "vessel_h", "storage_tank_small", "pump", "pump_group", "compressor",
            "heater", "vaporizer_orv", "vaporizer_scv", "stack", "flare", "loading_arm", "crane", "monitor",
            "generator", "transformer", "package", "nav_aid",
        ],
        "equipment",
    ),
    **dict.fromkeys(["building", "substation", "analyzer_house", "shelter", "gate"], "building"),
    **dict.fromkeys(
        ["road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"],
        "civil",
    ),
    "other": "fallback",
    "composite": "fallback",
}  # fmt: skip
FALLBACK_TYPES = frozenset({"other", "composite"})
_DASHES = "-" + "".join(chr(c) for c in range(0x2010, 0x2016)) + chr(0x2212)  # hyphens, en/em dashes, minus
_SEP = re.compile(r"[\s" + re.escape(_DASHES) + "]+")


def normalise_tag(tag: object) -> str:
    """'20 – t – 0001' and '20-T-0001' are the same tag: case, whitespace and dashes do not count."""
    if tag is None:
        return ""
    return _SEP.sub("", str(tag)).upper()


def types_match(gen_type: str, ref_type: str) -> bool:
    """Equal types match. A fallback type (other/composite) on either side matches anything; `package`
    matches any equipment type (spec §13: type-family match accepted for package/other)."""
    if gen_type == ref_type:
        return True
    if gen_type in FALLBACK_TYPES or ref_type in FALLBACK_TYPES:
        return True
    if "package" in (gen_type, ref_type):
        other = ref_type if gen_type == "package" else gen_type
        return TYPE_FAMILY.get(other) == "equipment"
    return False


def read_register(path: Path) -> list[dict]:
    with Path(path).open(encoding="utf-8-sig", newline="") as f:
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]
```

- [ ] **Step 4: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: `3 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/score.py backend/tests/test_plant_score.py
git commit -m "feat(asset-models): plant register reader, tag and type matching (K1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `backend/tests/data/plant/kipic_register.csv` to the `git add` only if Task K1 Step 1 copied it.)

---

### Task K3: Recall, type accuracy, position error and must-haves

**Files:**
- Modify: `backend/app/asset_models/score.py` (import block, two inserts, append)
- Modify: `backend/tests/test_plant_score.py` (header, append)

**Interfaces:**
- Consumes: Task K2's functions.
- Produces: `ScoreReport`, `Required`, `KIPIC_REQUIRED`, `tolerance_m`, `required_present`, `score` (with `landmask_hausdorff_m=None` until Task K4).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_plant_score.py`, replace everything above `def test_fixture_is_the_cowork_register` with:

```python
# backend/tests/test_plant_score.py
"""The plant register scorer against Cowork's KIPIC register (spec 2026-10-03 §13, K1)."""

import copy
from pathlib import Path

import pytest

from app.asset_models import score as sc

DATA = Path(__file__).parent / "data" / "plant"
REGISTER = DATA / "kipic_register.csv"


@pytest.fixture(scope="module")
def ref() -> list[dict]:
    return sc.read_register(REGISTER)


def _tagged(rows):
    return [r for r in rows if r["tag"]]
```

Append to the end of the file:

```python
def test_cowork_against_itself_is_100_percent(ref):
    rep = sc.score(ref, ref)
    assert (rep.tagged_ref, rep.tagged_found, rep.type_match) == (404, 404, 404)
    assert rep.recall == rep.type_accuracy == rep.within_tol == 1.0
    assert rep.pos_err_p50_m == rep.pos_err_p95_m == 0.0
    assert rep.missing == [] and rep.extra == []
    assert len(rep.required_present) == 12 and all(rep.required_present.values())
    assert rep.landmask_hausdorff_m is None
    assert all(a["recall"] == 1.0 for a in rep.by_area.values())


def _shift(row, de, dn=0.0):
    row["plant_E"] = f"{float(row['plant_E']) + de:.2f}"
    row["plant_N"] = f"{float(row['plant_N']) + dn:.2f}"


def test_perturbed_copy_gives_the_expected_numbers(ref):
    gen = copy.deepcopy(ref)
    pool = [r for r in _tagged(gen) if not r["tag"].startswith("20-T-") and r["plant_E"]]
    dropped = pool[:10]
    retyped = [r for r in pool[10:] if sc.TYPE_FAMILY[r["type"]] == "equipment" and r["type"] != "package"][
        :5
    ]
    as_package = [r for r in pool[10:] if r["type"] in ("pump", "vessel_v") and r not in retyped][:3]
    as_other = [r for r in pool[10:] if r["type"] == "building"][:2]
    rest = [r for r in pool[10:] if r not in retyped + as_package + as_other]
    near, far, restyled = rest[:20], rest[20:30], rest[30:60]
    for r in retyped:
        r["type"] = "fence"
    for r in as_package:
        r["type"] = "package"
    for r in as_other:
        r["type"] = "other"
    for r in near:
        _shift(r, 3.0)  # within the 5 m tolerance (no footprint sizes)
    for r in far:
        _shift(r, 6.0)
    for r in restyled:
        r["tag"] = " " + r["tag"].lower().replace("-", " – ") + " "
    drop_tags = {r["tag"] for r in dropped}
    gen = [r for r in gen if r["tag"] not in drop_tags and r["tag"] != "20-T-0003"]
    gen += [
        {"node": "x1", "tag": "99-X-0001", "type": "pump", "plant_E": "1", "plant_N": "1"},
        {"node": "x2", "tag": "99-X-0002", "type": "pump", "plant_E": "", "plant_N": ""},
    ]
    rep = sc.score(gen, ref)
    assert rep.tagged_found == 404 - 11
    assert rep.recall == pytest.approx(393 / 404)
    assert rep.type_match == 393 - 5
    assert rep.type_accuracy == pytest.approx(388 / 404)
    assert rep.missing == sorted(drop_tags | {"20-T-0003"})
    assert rep.extra == ["99-X-0001", "99-X-0002"]
    positioned = sum(1 for r in _tagged(ref) if r["plant_E"] and r["tag"] not in drop_tags | {"20-T-0003"})
    assert rep.within_tol == pytest.approx((positioned - 10) / positioned)
    assert rep.pos_err_p50_m == 0.0
    assert rep.pos_err_p95_m == pytest.approx(3.0, abs=0.01)
    assert rep.required_present["20-T-0003"] is False
    assert all(v for k, v in rep.required_present.items() if k != "20-T-0003")
    area = dropped[0]["area"] or "(none)"
    lost = sum(1 for r in dropped if (r["area"] or "(none)") == area)
    assert rep.by_area[area]["found"] == rep.by_area[area]["ref"] - lost


def test_rows_without_coordinates_count_as_found_not_positioned(ref):
    gen = copy.deepcopy(ref)
    for r in _tagged(gen)[:5]:
        r["plant_E"] = r["plant_N"] = ""
    rep = sc.score(gen, ref)
    assert rep.tagged_found == 404 and rep.within_tol == 1.0


def test_footprint_size_sets_the_2_m_tolerance():
    assert sc.tolerance_m({}) == 5.0
    assert sc.tolerance_m({"footprint_m": 4.0}) == 5.0
    assert sc.tolerance_m({"footprint_m": 90.0}) == 2.0
    gen = [{"tag": "A-1", "type": "pump", "plant_E": "0", "plant_N": "3", "footprint_m": 12.0}]
    rep = sc.score(gen, [{"tag": "A-1", "type": "pump", "plant_E": "0", "plant_N": "0"}])
    assert rep.within_tol == 0.0 and rep.pos_err_p50_m == 3.0


def test_required_present_tracks_jetties_trestles_and_dolphins(ref):
    gen = copy.deepcopy(ref)
    head = next(r for r in gen if r["node"] == "jetty1-loading-platform")
    _shift(head, 40.0)
    dolphin = next(r for r in gen if r["type"] == "dolphin")
    _shift(dolphin, 0.0, 30.0)
    gen = [r for r in gen if r["node"] != "trestle-shore"]
    req = sc.required_present(gen, ref)
    assert req["jetty_head_1"] is False and req["jetty_head_2"] is True
    assert req["dolphins"] is False and req["trestles"] is False
    assert all(req[f"20-T-000{k}"] for k in range(1, 9))


def test_required_present_skips_what_the_reference_lacks():
    ref = [{"node": "a", "tag": "P-1", "type": "pump", "plant_E": "0", "plant_N": "0"}]
    assert sc.required_present(ref, ref) == {}
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: 6 failed, `AttributeError: module 'app.asset_models.score' has no attribute 'score'` (and `tolerance_m`, `required_present`).

- [ ] **Step 3: Implement**

In `backend/app/asset_models/score.py`, replace the import block (from `from __future__ import annotations` to `from pathlib import Path`) with:

```python
from __future__ import annotations

import csv
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
```

Insert directly above the `_DASHES = ` line:

```python
POS_TOL_LARGE_M = 2.0
POS_TOL_SMALL_M = 5.0
LARGE_FOOTPRINT_M = 5.0
```

Insert directly above `def normalise_tag`:

```python
@dataclass(frozen=True)
class Required:
    """A must-have: a tag; or one reference node, or every reference row of a type, each matched by a
    generated row of the same type within `radius_m`."""

    key: str
    tag: str | None = None
    node: str | None = None
    type: str | None = None
    radius_m: float = 0.0


KIPIC_REQUIRED: tuple[Required, ...] = (
    *(Required(f"20-T-000{k}", tag=f"20-T-000{k}") for k in range(1, 9)),
    Required("jetty_head_1", node="jetty1-loading-platform", type="jetty_platform", radius_m=25.0),
    Required("jetty_head_2", node="jetty2-loading-platform", type="jetty_platform", radius_m=25.0),
    Required("trestles", type="trestle", radius_m=60.0),
    Required("dolphins", type="dolphin", radius_m=10.0),
)


@dataclass
class ScoreReport:
    tagged_ref: int
    tagged_found: int
    type_match: int
    recall: float
    type_accuracy: float
    pos_err_p50_m: float
    pos_err_p95_m: float
    within_tol: float
    by_area: dict[str, dict]
    missing: list[str]
    extra: list[str]
    required_present: dict[str, bool]
    landmask_hausdorff_m: float | None
```

Append to the end of the file:

```python
def _num(v: object) -> float | None:
    try:
        x = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _en(row: dict) -> tuple[float, float] | None:
    e, n = _num(row.get("plant_E")), _num(row.get("plant_N"))
    return None if e is None or n is None else (e, n)


def tolerance_m(gen_row: dict) -> float:
    """2 m for an item whose footprint is over 5 m, else 5 m; 5 m when the size is unknown."""
    size = _num(gen_row.get("footprint_m"))
    return POS_TOL_LARGE_M if size is not None and size > LARGE_FOOTPRINT_M else POS_TOL_SMALL_M


def _area(row: dict) -> str:
    return (row.get("area") or "").strip() or "(none)"


def score(
    gen: list[dict], ref: list[dict], *, gen_land: list | None = None, ref_land: list | None = None
) -> ScoreReport:
    gen_by_tag: dict[str, dict] = {}
    for row in gen:
        t = normalise_tag(row.get("tag"))
        if t and t not in gen_by_tag:
            gen_by_tag[t] = row
    ref_tagged = [r for r in ref if normalise_tag(r.get("tag"))]
    ref_tags: set[str] = set()
    areas: dict[str, dict] = {}
    found = type_ok = within = 0
    errs: list[float] = []
    missing: list[str] = []
    for r in ref_tagged:
        t = normalise_tag(r["tag"])
        ref_tags.add(t)
        a = areas.setdefault(_area(r), {"ref": 0, "found": 0, "type_match": 0, "positioned": 0, "within": 0})
        a["ref"] += 1
        g = gen_by_tag.get(t)
        if g is None:
            missing.append(r["tag"])
            continue
        found += 1
        a["found"] += 1
        if types_match(str(g.get("type") or ""), str(r.get("type") or "")):
            type_ok += 1
            a["type_match"] += 1
        pg, pr = _en(g), _en(r)
        if pg is not None and pr is not None:
            err = math.hypot(pg[0] - pr[0], pg[1] - pr[1])
            errs.append(err)
            a["positioned"] += 1
            if err <= tolerance_m(g):
                within += 1
                a["within"] += 1
    for a in areas.values():
        a["recall"] = a["found"] / a["ref"]
        a["type_accuracy"] = a["type_match"] / a["ref"]
    n = len(ref_tagged)
    return ScoreReport(
        tagged_ref=n,
        tagged_found=found,
        type_match=type_ok,
        recall=found / n if n else 0.0,
        type_accuracy=type_ok / n if n else 0.0,
        pos_err_p50_m=float(np.percentile(errs, 50)) if errs else math.nan,
        pos_err_p95_m=float(np.percentile(errs, 95)) if errs else math.nan,
        within_tol=within / len(errs) if errs else 0.0,
        by_area=dict(sorted(areas.items())),
        missing=sorted(missing),
        extra=sorted(g["tag"] for t, g in gen_by_tag.items() if t not in ref_tags),
        required_present=required_present(gen, ref),
        landmask_hausdorff_m=None,  # the land outline arrives in the next task
    )


def required_present(
    gen: list[dict], ref: list[dict], required: Iterable[Required] = KIPIC_REQUIRED
) -> dict[str, bool]:
    """Each requirement whose reference rows exist in `ref`, as present or not. A requirement the
    reference does not contain is left out (the scorer stays usable on any plant)."""
    gen_tags = {normalise_tag(r.get("tag")) for r in gen} - {""}
    ref_tags = {normalise_tag(r.get("tag")) for r in ref} - {""}
    by_type: dict[str, list[tuple[float, float]]] = {}
    for r in gen:
        p = _en(r)
        if p is not None:
            by_type.setdefault(str(r.get("type") or ""), []).append(p)

    def near(type_: str, p: tuple[float, float], radius: float) -> bool:
        return any(math.hypot(q[0] - p[0], q[1] - p[1]) <= radius for q in by_type.get(type_, []))

    out: dict[str, bool] = {}
    for req in required:
        if req.tag is not None:
            t = normalise_tag(req.tag)
            if t in ref_tags:
                out[req.key] = t in gen_tags
            continue
        rows = [
            r for r in ref if r.get("type") == req.type and (req.node is None or r.get("node") == req.node)
        ]
        pts = [p for p in (_en(r) for r in rows) if p is not None]
        if pts:
            out[req.key] = all(near(req.type or "", p, req.radius_m) for p in pts)
    return out
```

- [ ] **Step 4: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: `9 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/score.py backend/tests/test_plant_score.py
git commit -m "feat(asset-models): plant scorer recall, type, position and must-haves (K1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task K4: The land outline and the KIPIC landmask fixture

**Files:**
- Create: `backend/tests/data/plant/kipic_landmask.json`
- Modify: `backend/app/asset_models/score.py` (import block, one insert, one replace, append)
- Modify: `backend/tests/test_plant_score.py` (header, append)

**Interfaces:**
- Consumes: Task K3's `score`, `_en`.
- Produces: `extent`, `landmask_hausdorff`, `read_land`, `land_from_environment`; `score` now fills `landmask_hausdorff_m` when both land sets are given.

- [ ] **Step 1: Make the fixture**

Cowork's `landmask.json` is in the viewer's scene frame (Ruling 19). Convert it once (from the worktree root):

```
& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -c "import json; raw=json.load(open(r'E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic\landmask.json', encoding='utf-8')); conv=lambda ring: [[round(x + 1300.0, 3), round(450.0 - z, 3)] for x, z in ring]; out={'frame': 'plant_EN', 'source': 'Cowork viewer landmask.json (scene x = E - 1300, z = 450 - N), converted to plant [E, N]', 'land': [conv(r) for r in raw['land']], 'main': [conv(r) for r in raw['main']]}; open('backend/tests/data/plant/kipic_landmask.json', 'w', encoding='utf-8').write(json.dumps(out, separators=(',', ':')) + chr(10))"
```

Expected: a 1.6 kB file whose `land` ring has 78 points and `main` ring 7. The source file is read-only reference data; only the converted copy is committed.

- [ ] **Step 2: Write the failing tests**

In `backend/tests/test_plant_score.py`, replace everything above `def test_fixture_is_the_cowork_register` with:

```python
# backend/tests/test_plant_score.py
"""The plant register scorer against Cowork's KIPIC register (spec 2026-10-03 §13, K1)."""

import copy
import math
from pathlib import Path

import pytest

from app.asset_models import score as sc

DATA = Path(__file__).parent / "data" / "plant"
REGISTER = DATA / "kipic_register.csv"
LANDMASK = DATA / "kipic_landmask.json"


@pytest.fixture(scope="module")
def ref() -> list[dict]:
    return sc.read_register(REGISTER)


def _tagged(rows):
    return [r for r in rows if r["tag"]]
```

Append to the end of the file:

```python
def test_cowork_land_against_itself_is_zero(ref):
    land = sc.read_land(LANDMASK)
    assert sc.score(ref, ref, gen_land=land, ref_land=land).landmask_hausdorff_m == 0.0


def test_landmask_fixture_is_in_plant_coordinates(ref):
    import shapely

    land = shapely.unary_union([shapely.Polygon(p) for p in sc.read_land(LANDMASK)])
    tanks = [r for r in ref if r["type"] == "tank_lng"]
    assert len(tanks) == 8
    assert all(land.contains(shapely.Point(float(r["plant_E"]), float(r["plant_N"]))) for r in tanks)
    heads = [r for r in ref if r["node"].endswith("-loading-platform")]
    assert len(heads) == 2
    assert not any(land.contains(shapely.Point(float(r["plant_E"]), float(r["plant_N"]))) for r in heads)


def test_landmask_hausdorff_measures_a_shift(ref):
    land = sc.read_land(LANDMASK)
    moved = [[[e + 8.0, n] for e, n in ring] for ring in land]
    box = sc.extent(ref)
    assert 7.0 <= sc.landmask_hausdorff(moved, land, box) <= 8.6
    assert sc.landmask_hausdorff([], land, box) == math.inf
    assert sc.landmask_hausdorff([], [], box) == 0.0
    assert sc.score(ref, ref).landmask_hausdorff_m is None


def test_land_from_a_spec_environment():
    env = [
        {"id": "l1", "kind": "land", "pts": [[0, 0], [10, 0], [10, 10]], "el": 104.5},
        {"id": "s1", "kind": "sea", "pts": [[0, 0], [5, 0], [5, 5]], "el": 100.0},
    ]
    assert sc.land_from_environment(env) == [[[0, 0], [10, 0], [10, 10]]]
```

- [ ] **Step 3: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: 4 failed, `AttributeError: module 'app.asset_models.score' has no attribute 'read_land'` (and `land_from_environment`).

- [ ] **Step 4: Implement**

In `backend/app/asset_models/score.py`, replace the import block with:

```python
from __future__ import annotations

import csv
import json
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely
```

Insert directly above the `_DASHES = ` line:

```python
EXTENT_MARGIN_M = 100.0
LAND_SEGMENT_M = 2.0
```

In `score()`, replace the line

```python
        landmask_hausdorff_m=None,  # the land outline arrives in the next task
```

with

```python
        landmask_hausdorff_m=landmask_hausdorff(gen_land, ref_land, extent(ref))
        if gen_land is not None and ref_land is not None
        else None,
```

Append to the end of the file:

```python
def extent(ref: list[dict], margin_m: float = EXTENT_MARGIN_M) -> tuple[float, float, float, float] | None:
    """The plant extent: the reference register's positions, grown by `margin_m`."""
    pts = np.array([p for p in (_en(r) for r in ref) if p is not None])
    if not len(pts):
        return None
    lo, hi = pts.min(axis=0) - margin_m, pts.max(axis=0) + margin_m
    return float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])


def _land(polys: list) -> shapely.Geometry:
    shapes = [shapely.make_valid(shapely.Polygon(p)) for p in polys if len(p) >= 3]
    return shapely.unary_union(shapes) if shapes else shapely.Polygon()


def landmask_hausdorff(
    gen_land: list, ref_land: list, box: tuple[float, float, float, float] | None
) -> float:
    """Hausdorff distance (m) between the two land outlines inside the plant extent. Both empty: 0;
    one empty: infinity."""
    a, b = _land(gen_land), _land(ref_land)
    if box is not None:
        clip = shapely.box(*box)
        a, b = a.intersection(clip), b.intersection(clip)
    if a.is_empty and b.is_empty:
        return 0.0
    if a.is_empty or b.is_empty:
        return math.inf
    la = shapely.segmentize(a.boundary, LAND_SEGMENT_M)
    lb = shapely.segmentize(b.boundary, LAND_SEGMENT_M)
    return float(shapely.hausdorff_distance(la, lb))


def read_land(path: Path) -> list[list[list[float]]]:
    """Land rings in plant [E, N] from a landmask file ({"land": [...], "main": [...]}), a spec JSON
    (its `environment` features of kind `land`), or a bare list of rings."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if "environment" in data:
        return land_from_environment(data["environment"])
    return [*data.get("land", []), *data.get("main", [])]


def land_from_environment(environment: list[dict]) -> list[list[list[float]]]:
    return [f["pts"] for f in environment if f.get("kind") == "land" and len(f.get("pts", [])) >= 3]
```

- [ ] **Step 5: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: `13 passed`.

- [ ] **Step 6: Commit**

```
git add backend/app/asset_models/score.py backend/tests/test_plant_score.py backend/tests/data/plant/kipic_landmask.json
git commit -m "feat(asset-models): land outline distance and the KIPIC landmask fixture (K1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task K5: Footprint sizes, the report and the CLI

**Files:**
- Modify: `backend/app/asset_models/score.py` (import block, append)
- Modify: `backend/tests/test_plant_score.py` (header, append)

**Interfaces:**
- Consumes: everything above.
- Produces: `footprint_size_m`, `with_footprint_sizes`, `report_dict`, `report_markdown`, `main`; `python -m app.asset_models.score`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_plant_score.py`, replace everything above `def test_fixture_is_the_cowork_register` with:

```python
# backend/tests/test_plant_score.py
"""The plant register scorer against Cowork's KIPIC register (spec 2026-10-03 §13, K1)."""

import copy
import json
import math
from pathlib import Path

import pytest

from app.asset_models import score as sc

DATA = Path(__file__).parent / "data" / "plant"
REGISTER = DATA / "kipic_register.csv"
LANDMASK = DATA / "kipic_landmask.json"


@pytest.fixture(scope="module")
def ref() -> list[dict]:
    return sc.read_register(REGISTER)


def _tagged(rows):
    return [r for r in rows if r["tag"]]
```

Append to the end of the file:

```python
def test_footprint_sizes_come_from_the_spec():
    spec = {
        "items": [
            {"id": "tank-1", "tag": "20-T-0001", "footprint": {"kind": "circle", "center": [0, 0], "d": 90}},
            {"id": "p1", "tag": None, "footprint": {"kind": "rect", "center": [0, 0], "size": [3, 2]}},
            {"id": "r1", "footprint": {"kind": "line", "pts": [[0, 0], [30, 40]], "width": 6}},
        ]
    }
    rows = [{"node": "tank-1", "tag": "20-T-0001"}, {"node": "p1", "tag": ""}, {"node": "zz", "tag": ""}]
    sized = sc.with_footprint_sizes(rows, spec)
    assert [r.get("footprint_m") for r in sized] == [90.0, 3.0, None]
    assert sc.footprint_size_m(spec["items"][2]["footprint"]) == 46.0


def test_report_json_has_no_nan_and_markdown_names_the_measures():
    rep = sc.score([], [{"tag": "A-1", "type": "pump", "plant_E": "", "plant_N": ""}])
    d = sc.report_dict(rep)
    assert d["pos_err_p50_m"] is None
    json.dumps(d, allow_nan=False)
    md = sc.report_markdown(rep)
    assert "Tagged items found | 0 of 1" in md and "A-1" in md


def test_cli_writes_json_and_prints_markdown(ref, tmp_path, capsys):
    out = tmp_path / "score.json"
    assert sc.main([str(REGISTER), str(REGISTER), "--ref-land", str(LANDMASK), "--gen-land", str(LANDMASK),
                    "--json", str(out)]) == 0  # fmt: skip
    d = json.loads(out.read_text(encoding="utf-8"))
    assert d["recall"] == 1.0 and d["landmask_hausdorff_m"] == 0.0
    assert "# Plant model score" in capsys.readouterr().out
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: 3 failed, `AttributeError: module 'app.asset_models.score' has no attribute 'with_footprint_sizes'` (and `report_dict`, `main`).

- [ ] **Step 3: Implement**

In `backend/app/asset_models/score.py`, replace the import block with:

```python
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import shapely
```

Append to the end of the file:

```python
def footprint_size_m(fp: dict) -> float | None:
    """The longest side of a spec footprint's extent, metres."""
    kind = fp.get("kind")
    if kind == "rect":
        return float(max(fp["size"]))
    if kind == "circle":
        return float(fp["d"])
    if kind in ("polygon", "line") and fp.get("pts"):
        ext = float(np.ptp(np.asarray(fp["pts"], dtype=float), axis=0).max())
        return ext + (float(fp.get("width") or 0.0) if kind == "line" else 0.0)
    return None


def with_footprint_sizes(rows: list[dict], spec: dict) -> list[dict]:
    """Copies of the generated rows with `footprint_m` from the spec's items (by node = item id, else
    by tag), so `tolerance_m` can use the 2 m rule."""
    by_id: dict[str, float] = {}
    by_tag: dict[str, float] = {}
    for it in spec.get("items", []):
        size = footprint_size_m(it.get("footprint") or {})
        if size is None:
            continue
        by_id[str(it.get("id"))] = size
        if normalise_tag(it.get("tag")):
            by_tag[normalise_tag(it.get("tag"))] = size
    out = []
    for r in rows:
        size = by_id.get(str(r.get("node")), by_tag.get(normalise_tag(r.get("tag"))))
        out.append({**r, "footprint_m": size} if size is not None else dict(r))
    return out


def _finite(v):
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: _finite(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_finite(x) for x in v]
    return v


def report_dict(rep: ScoreReport) -> dict:
    """JSON-ready: NaN and infinity become null."""
    return _finite(asdict(rep))


def _pct(x: float) -> str:
    return f"{100 * x:.1f} %"


def _m(x: float | None) -> str:
    return "n/a" if x is None or not math.isfinite(x) else f"{x:.2f} m"


def report_markdown(rep: ScoreReport) -> str:
    lines = [
        "# Plant model score",
        "",
        "| Measure | Value |",
        "| --- | --- |",
        f"| Tagged items found | {rep.tagged_found} of {rep.tagged_ref} ({_pct(rep.recall)}) |",
        f"| Found with a matching type | {rep.type_match} ({_pct(rep.type_accuracy)}) |",
        f"| Position error p50 / p95 | {_m(rep.pos_err_p50_m)} / {_m(rep.pos_err_p95_m)} |",
        f"| Within position tolerance | {_pct(rep.within_tol)} |",
        f"| Land outline Hausdorff | {_m(rep.landmask_hausdorff_m)} |",
        "",
        "## By area",
        "",
        "| Area | Reference | Found | Type match | Recall |",
        "| --- | --- | --- | --- | --- |",
        *(
            f"| {k} | {a['ref']} | {a['found']} | {a['type_match']} | {_pct(a['recall'])} |"
            for k, a in rep.by_area.items()
        ),
        "",
        "## Must-haves",
        "",
        *(f"- {k}: {'present' if v else 'MISSING'}" for k, v in rep.required_present.items()),
        "",
        f"## Missing tags ({len(rep.missing)})",
        "",
        ", ".join(rep.missing[:200]) or "none",
        "",
        f"## Extra tags ({len(rep.extra)})",
        "",
        ", ".join(rep.extra[:200]) or "none",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.asset_models.score", description=__doc__.splitlines()[0])
    p.add_argument("gen", type=Path, help="generated register CSV")
    p.add_argument("ref", type=Path, help="reference register CSV")
    p.add_argument("--gen-land", type=Path, help="generated land: a landmask or spec JSON")
    p.add_argument("--ref-land", type=Path, help="reference land: a landmask JSON")
    p.add_argument("--gen-spec", type=Path, help="the generated version's spec JSON (footprint sizes)")
    p.add_argument("--json", type=Path, help="write the report as JSON here")
    a = p.parse_args(argv)
    gen = read_register(a.gen)
    if a.gen_spec:
        gen = with_footprint_sizes(gen, json.loads(a.gen_spec.read_text(encoding="utf-8")))
    rep = score(
        gen,
        read_register(a.ref),
        gen_land=read_land(a.gen_land) if a.gen_land else None,
        ref_land=read_land(a.ref_land) if a.ref_land else None,
    )
    sys.stdout.write(report_markdown(rep))
    if a.json:
        a.json.write_text(json.dumps(report_dict(rep), indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests and the CLI**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_score.py -q`

Expected: `16 passed`.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m app.asset_models.score tests/data/plant/kipic_register.csv tests/data/plant/kipic_register.csv --ref-land tests/data/plant/kipic_landmask.json --gen-land tests/data/plant/kipic_landmask.json`

Expected: the Markdown report, with `| Tagged items found | 404 of 404 (100.0 %) |`, `| Land outline Hausdorff | 0.00 m |`, and every must-have `present`.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/score.py backend/tests/test_plant_score.py
git commit -m "feat(asset-models): scorer report and CLI (K1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task K6: The live acceptance test skeleton

**Files:**
- Create: `backend/tests/plant_live_helpers.py`
- Create: `backend/tests/test_plant_live_helpers.py`
- Create: `backend/tests/test_plant_live.py`

**Interfaces:**
- Consumes: Task K5's `read_register`, `with_footprint_sizes`, `land_from_environment`, `read_land`, `score`, `report_dict`, `report_markdown`; the conftest fixtures `client`, `app`, `wait_job`; the contract operations listed in this part's header.
- Produces: `copy_project_state`, `pick_sources`, `SHEETS`; the `live` test `test_al_zour_plant_acceptance`.

- [ ] **Step 1: Write the failing helper tests**

Create `backend/tests/test_plant_live_helpers.py`:

```python
# backend/tests/test_plant_live_helpers.py
"""The live acceptance test's helpers, run in the gate (no key, no project folder needed)."""

import sqlite3

from plant_live_helpers import copy_project_state, pick_sources


def test_copy_takes_the_database_and_kestrel_folders_only(tmp_path):
    src = tmp_path / "LNG Terminal"
    src.mkdir()
    db = sqlite3.connect(src / "project.db")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE t (v INTEGER)")
    db.execute("INSERT INTO t VALUES (7)")
    db.commit()  # left open: the row may still sit in the WAL, as in a live project
    for rel in ("pointclouds/c1/octree/octree.bin", "pointclouds/c1/.work/x", "pointclouds/c1/meta.json",
                "maps/m1/tiles/0.png", "drawings/d1/page.png", "Ortho/big.tif"):  # fmt: skip
        (src / rel).parent.mkdir(parents=True, exist_ok=True)
        (src / rel).write_bytes(b"x")
    dst = copy_project_state(src, tmp_path / "copy")
    db.close()
    copied = sqlite3.connect(dst / "project.db")
    assert copied.execute("SELECT v FROM t").fetchall() == [(7,)]
    copied.close()
    assert (dst / "pointclouds/c1/meta.json").exists()
    assert (dst / "maps/m1/tiles/0.png").exists() and (dst / "drawings/d1/page.png").exists()
    assert not (dst / "pointclouds/c1/octree").exists() and not (dst / "pointclouds/c1/.work").exists()
    assert not (dst / "Ortho").exists()


def test_pick_sources_needs_every_sheet():
    drawings = [
        {"id": "d1", "name": "P0058LNG-00-40-0-T0005 — p1", "status": "ready"},
        {"id": "d2", "name": "P0058LNG-00-40-0-T0003 — p1", "status": "ready"},
        {"id": "d3", "name": "P0058LNG-00-40-0-T0006 — p1", "status": "failed"},
        {"id": "d4", "name": "Something else", "status": "ready"},
    ]
    clouds = [{"id": "c1", "status": "ready"}, {"id": "c2", "status": "importing"}]
    sources, missing = pick_sources(drawings, clouds)
    assert sources == [
        {"type": "point_cloud", "id": "c1"},
        {"type": "drawing", "id": "d2"},
        {"type": "drawing", "id": "d1"},
    ]
    assert missing == ["T0006", "T0007", "T0008"]
    many = [{"id": f"d{k}", "name": f"T0003 — p{k:02d}", "status": "ready"} for k in range(60)]
    sources, missing = pick_sources(many, clouds, sheets=("T0003",))
    assert len(sources) == 50 and missing == []
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_live_helpers.py -q`

Expected: collection error, `ModuleNotFoundError: No module named 'plant_live_helpers'`.

- [ ] **Step 3: Write the helpers**

Create `backend/tests/plant_live_helpers.py`:

```python
# backend/tests/plant_live_helpers.py
"""Helpers for the Al-Zour live acceptance test (K1): copy a project's Kestrel state and pick the
run's sources. Plain functions, so the gate can test them without a key."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

# Kestrel-managed folders the plant run reads. Raw data (Drawings/, Point_Cloud/, Ortho/, ...) is not
# copied: the rows hold absolute paths and the run only ever reads those files.
KESTREL_DIRS = ("drawings", "maps", "pointclouds")
SKIP_DIRS = frozenset({"octree", ".work"})  # display copies and scratch the run never reads
SHEETS = ("T0003", "T0005", "T0006", "T0007", "T0008")  # the overall and the four area plot plans


def copy_project_state(src: Path, dst: Path) -> Path:
    """A consistent copy of `src`'s database (sqlite backup: the WAL is folded in) plus the Kestrel
    folders, minus octrees and work folders. The source is opened read-only and never written."""
    dst.mkdir(parents=True, exist_ok=True)
    a = sqlite3.connect((src / "project.db").resolve().as_uri() + "?mode=ro", uri=True)
    b = sqlite3.connect(dst / "project.db")
    try:
        a.backup(b)
    finally:
        b.close()
        a.close()
    for name in KESTREL_DIRS:
        if (src / name).is_dir():
            shutil.copytree(
                src / name, dst / name, ignore=lambda _d, names: [n for n in names if n in SKIP_DIRS]
            )
    return dst


def pick_sources(
    drawings: list[dict], clouds: list[dict], sheets: tuple[str, ...] = SHEETS, limit: int = 50
) -> tuple[list[dict], list[str]]:
    """(run sources, sheets with no ready drawing page). Ready clouds first, then every ready page whose
    name carries one of the sheet numbers, by name, up to the contract's 50 sources."""
    pages = sorted(
        (d for d in drawings if d.get("status") == "ready" and any(s in d["name"] for s in sheets)),
        key=lambda d: d["name"],
    )
    missing = [s for s in sheets if not any(s in d["name"] for d in pages)]
    out = [{"type": "point_cloud", "id": c["id"]} for c in clouds if c.get("status") == "ready"][:limit]
    out += [{"type": "drawing", "id": d["id"]} for d in pages][: limit - len(out)]
    return out, missing
```

- [ ] **Step 4: Run the helper tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_live_helpers.py -q`

Expected: `2 passed`.

- [ ] **Step 5: Write the live test**

Create `backend/tests/test_plant_live.py` (apply Task K1 Step 3's findings to the create and run calls):

```python
# backend/tests/test_plant_live.py
"""G1 acceptance on Al-Zour (spec 2026-10-03 §13). Outside the gate (marker `live`): needs
ANTHROPIC_API_KEY and the LNG Terminal project folder (KESTREL_LNG_PROJECT, default
E:\\Asset Inspections\\LNG Terminal) with the five plot plans imported, all pages. It runs one plant
run on a copy of the project's Kestrel state, scores the register against Cowork's, and writes the
evidence to docs/evidence/2026-10-03-plant-model-g1/. The original project is only ever read."""

import json
import os
import time
from pathlib import Path

import pytest
from plant_live_helpers import copy_project_state, pick_sources

from app.asset_models import score as sc

pytestmark = pytest.mark.live
PROJECT = Path(os.environ.get("KESTREL_LNG_PROJECT", r"E:\Asset Inspections\LNG Terminal"))
DATA = Path(__file__).parent / "data" / "plant"
EVIDENCE = Path(__file__).resolve().parents[2] / "docs" / "evidence" / "2026-10-03-plant-model-g1"
RUN_TIMEOUT_S = 4 * 3600 + 1800  # the run's own 4 h limit plus merge, check and build
CSV_TIMEOUT_S = 900
MAX_TOKENS = 40_000_000
MAX_SECONDS = 4 * 3600
RUN_FIELDS = (
    "state",
    "stop_reason",
    "summary",
    "open_questions",
    "usage",
    "usage_by_stage",
    "packages",
    "version",
    "started_at",
    "ended_at",
)


def _wait_csv(client, url: str) -> str:
    """The version's register CSV, once the GLB job has written it."""
    deadline = time.monotonic() + CSV_TIMEOUT_S
    while time.monotonic() < deadline:
        r = client.get(url)
        if r.status_code == 200:
            return r.text
        time.sleep(5)
    raise AssertionError(f"no register CSV within {CSV_TIMEOUT_S} s")


def test_al_zour_plant_acceptance(client, app, wait_job, tmp_path):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not (PROJECT / "project.db").exists():
        pytest.skip("needs ANTHROPIC_API_KEY and the LNG Terminal project folder (KESTREL_LNG_PROJECT)")
    copy = copy_project_state(PROJECT, tmp_path / "LNG Terminal copy")
    opened = client.post("/api/v1/projects/open", json={"folder": str(copy)})
    assert opened.status_code == 200, opened.text
    pid = opened.json()["id"]
    app.state.keys.set("anthropic", key)
    drawings = client.get(f"/api/v1/projects/{pid}/drawings").json()["items"]
    clouds = client.get(f"/api/v1/projects/{pid}/pointclouds").json()["items"]
    sources, missing = pick_sources(drawings, clouds)
    if missing:
        pytest.skip(f"import these plot plans (all pages) into the project first: {', '.join(missing)}")
    base = f"/api/v1/projects/{pid}/asset-models"
    made = client.post(base, json={"name": "Al-Zour LNG plant (acceptance)", "kind": "plant"})
    assert made.status_code == 201, made.text
    mid = made.json()["id"]
    started = time.monotonic()
    r = client.post(f"{base}/{mid}/runs", json={"mode": "plant", "provider": "anthropic", "sources": sources})
    assert r.status_code == 202, r.text
    body = r.json()
    wait_job(pid, body["job"]["id"], timeout=RUN_TIMEOUT_S)
    seconds = time.monotonic() - started
    run = client.get(f"{base}/{mid}/runs/{body['run']['id']}").json()
    assert run["version"] is not None, run["summary"]
    version = run["version"]
    csv_text = _wait_csv(client, f"{base}/{mid}/versions/{version}/csv")
    spec = client.get(f"{base}/{mid}/versions/{version}").json()["spec"]

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "register.csv").write_text(csv_text, encoding="utf-8")
    gen = sc.with_footprint_sizes(sc.read_register(EVIDENCE / "register.csv"), spec)
    rep = sc.score(
        gen,
        sc.read_register(DATA / "kipic_register.csv"),
        gen_land=sc.land_from_environment(spec.get("environment", [])),
        ref_land=sc.read_land(DATA / "kipic_landmask.json"),
    )
    tokens = run["usage"]["input_tokens"] + run["usage"]["output_tokens"]
    (EVIDENCE / "score.json").write_text(json.dumps(sc.report_dict(rep), indent=2), encoding="utf-8")
    (EVIDENCE / "score.md").write_text(sc.report_markdown(rep), encoding="utf-8")
    facts = {k: run.get(k) for k in RUN_FIELDS} | {"seconds": round(seconds), "tokens": tokens}
    (EVIDENCE / "run.json").write_text(json.dumps(facts, indent=2), encoding="utf-8")

    assert run["state"] == "finished", run["summary"]
    assert rep.type_accuracy >= 0.95, sc.report_markdown(rep)
    assert rep.within_tol >= 0.95, sc.report_markdown(rep)
    assert all(rep.required_present.values()), rep.required_present
    assert rep.landmask_hausdorff_m is not None and rep.landmask_hausdorff_m <= 10.0
    assert tokens <= MAX_TOKENS and seconds <= MAX_SECONDS
```

- [ ] **Step 6: Check it is collected and deselected in the gate**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_live.py -q`

Expected: `1 deselected` (the `addopts` in `pyproject.toml` excludes `live`).

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_plant_live.py -q -m live` with `ANTHROPIC_API_KEY` unset in that shell.

Expected: `1 skipped` ("needs ANTHROPIC_API_KEY and the LNG Terminal project folder"). Do not run it with a key: that is L1's job and costs real money.

- [ ] **Step 7: Commit**

```
git add backend/tests/plant_live_helpers.py backend/tests/test_plant_live_helpers.py backend/tests/test_plant_live.py
git commit -m "test(asset-models): Al-Zour live acceptance skeleton and its helpers (K1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task K7: Gate and hand-over

**Files:** none changed unless the gate finds something.

- [ ] **Step 1: Catch up with `main`**

```
git fetch
git rebase main
```

If F0's contract changed since Task K1, redo Task K1 Step 3 and adjust `test_plant_live.py`.

- [ ] **Step 2: Run the full gate**

Run the gate block from this part's header. Expected: every line green; the backend suite gains 18 tests and deselects one more `live` test.

- [ ] **Step 3: Operator walkthrough**

Put this in the ledger and the hand-off message:

1. In PowerShell, go to `E:\Dev\Yolo\app\backend` (after the merge) and run `.\.venv\Scripts\python.exe -m app.asset_models.score tests\data\plant\kipic_register.csv tests\data\plant\kipic_register.csv --ref-land tests\data\plant\kipic_landmask.json --gen-land tests\data\plant\kipic_landmask.json`. Expected: a table with "Tagged items found | 404 of 404 (100.0 %)", "Land outline Hausdorff | 0.00 m", and all twelve must-haves "present".
2. Make a copy without tank 20-T-0003: `Get-Content tests\data\plant\kipic_register.csv -Encoding UTF8 | ConvertFrom-Csv | Where-Object { $_.tag -ne '20-T-0003' } | Export-Csv $HOME\Desktop\gen.csv -NoTypeInformation -Encoding UTF8`.
3. Run step 1 again with `$HOME\Desktop\gen.csv` as the first file. Expected: "403 of 404 (99.8 %)", "20-T-0003: MISSING", and `20-T-0003` under "Missing tags".
4. Add `--json $HOME\Desktop\score.json` to the command. Expected: a JSON file with the same numbers, `null` where a value is not a number.
5. The live Al-Zour acceptance (`pytest -m live tests\test_plant_live.py`) is run by the coordinator in L1, once the plot plans are imported. It takes up to 4.5 h, uses real tokens, and writes `docs\evidence\2026-10-03-plant-model-g1\`.

No merge, push, installer or `/wrapup` in this unit; the coordinator merges.

---

## Self-review

**Spec coverage:**

| Requirement | Where |
| --- | --- |
| §8.2.4: sample ≤ 20 M, float32, one streamed pass, ≤ 2 M chunks, cancellable | C2 (`sample_plant_cloud`, memory, cancel and single-pass tests) |
| §8.2.4: fit `cloud_z_to_el` once from ground around drawing-elevation items | C3 (`fit_datum`, tilt, fallback) |
| §8.2.4: ground and top percentiles in the footprint; heights for indicative; `height_mismatch` > 0.5 m | C4, C6 (`apply_check`) |
| §8.2.4: `missing_in_cloud` when scanned but empty | C4 |
| §8.2.4: `plan_offset` > 1 m from the best-fit shift; position kept (D5) | C4 (flag), C6 (`apply_check` never moves) |
| §8.2.4: unregistered clusters over 3 m × 3 m with no item | C5 |
| §8.2.4: per-item ≤ 200 k points | C4 `test_per_item_points_are_capped` |
| Index Review Focus 2: other-CRS cloud skipped with a note, never projected | C4 `test_check_skips_cloud_in_other_crs`, C2 `cloud_in_frame`, C6 skipped-cloud test |
| §13 C1: synthetic cloud with known tanks, a missing item, an offset item, an unregistered cluster | C1 `standard_scene`, C4–C5 tests |
| §13 K1: Cowork against itself is 100 %; a perturbed copy gives the expected numbers | K3 |
| §13 acceptance: 95 % with matching type (family match for package/other), 2 m / 5 m position, 8 tanks, jetty heads, trestles, dolphins, landmask ≤ 10 m, budget | K3 (type, position, must-haves), K4 (landmask), K6 (live pass lines) |
| §13 fixtures: `kipic_register.csv` (F0), `kipic_landmask.json` | K1 (check), K4 (convert) |
| §13 evidence to `docs/evidence/2026-10-03-plant-model-g1/` | K6 live test |
| Binding interfaces "cloud check" and "scorer" | Part C and Part K headers; deviations listed |

**Placeholders:** none. Every code block is the complete code. While planning, all of it ran in a scratch copy of the backend against stand-ins for F0's `spec.py` and `siteframe.py`, written from the index's binding interfaces: each C task's state (C1 2, C2 12, C3 15, C4 24, C5 26, C6 30 tests passed), each K task's state (K2 3, K3 9, K4 13, K5 16 passed), the live helpers (2 passed), and `ruff check` plus `ruff format --check` with `backend/pyproject.toml` on every file at every stage. The only untested piece is F0's real code, which Tasks C1 and K1 check first.

**Type consistency:** `PlantSample`, `ItemCheck`, `Candidate`, `CheckResult`, `CloudDatum` and `ScoreReport` are used with the same fields in every task; `grid.frame` is the one F0 name to confirm (Task C1).
