# GeoTIFF Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a GeoTIFF of any size and projection, view it with smooth zoom/pan, run any project model across the whole map with per-class counts, label evaluation zones, score runs (P/R/F1, count error), and export every box with native-CRS and WGS84 coordinates.

**Architecture:** A new backend package `app/maps/` uses rasterio (GDAL) to convert the source into a display raster (8-bit RGB tiled GeoTIFF with internal overviews and mask), serves 256 px tiles from it with bounded windowed reads, and runs detection window-by-window through the existing provider/tiling code with a strip-bounded NMS merge. The frontend adds a Maps screen built on OpenLayers in the map's native pixel grid, with vector layers for runs, labels, zones and score overlays.

**Tech Stack:** rasterio 1.4.4 + pyproj 3.7.2 (backend), FastAPI, SQLAlchemy + Alembic, the existing JobRunner; `ol` (OpenLayers) + `proj4` (frontend), React 18, openapi-fetch; pytest, vitest, Playwright against the Prism mock.

**Spec:** `docs/superpowers/specs/2026-09-22-geotiff-maps-design.md`

## Global Constraints

- `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts` is regenerated (`pnpm -C contract generate`) and committed in the same change, never hand-edited.
- The full raster is never loaded into memory. Every raster read is a bounded window, or a decimated read with its longest side at or under 2048 px.
- Import, detection and export are background jobs with progress and cancel (`map_import`, `map_detect`, `map_export`).
- The app must start even when startup work fails. New sweeps go in `project_opened`, each step on its own.
- The ML stack pins in `backend/requirements.txt` are not touched. Only `rasterio==1.4.4` and `pyproj==3.7.2` are added.
- The backend runs from the main checkout's shared interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`. Worktrees have no venv of their own; see the start-task note and the shared-venv ADR. Every Python command below uses that path, written `$PY`.
- Tile size is 256 px. Detections query cap: 5 000 boxes per response. Density grid: at most 256 × 256 cells. Stats and mask reads: longest side at most 2048 px.
- GSD scaling is applied only when `|1 − map_gsd/target_gsd| > 0.15`.
- The default scoring IoU is 0.5. A box counts toward a zone when its centre lies inside the zone polygon.
- Coordinates: map pixel (px, py) has its origin at the top-left, with y pointing down. In OpenLayers it is (px, −py).
- UI uses only the `frontend/src/ui/` primitives and tokens (`node scripts/check-tokens.mjs` must pass). The design system is DESIGN.md "Site office". Load the design skills before UI tasks 11–14.
- Stage by path, never `git add -A`. Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Deviations from the spec, decided while planning (recorded here so reviewers don't flag them)

1. **Display raster instead of a COG.** The display raster is a *tiled GeoTIFF with internal overviews and an internal mask* (`map.tif`), not a GDAL `COG`-driver file. GDAL's COG driver is CreateCopy-only, so it can't be written window by window with progress and cancel. For local reads the tiled-plus-overviews layout gives the same performance.
2. **Model GSD.** Models carry no GSD metadata today. `target_gsd_cm` is an optional run parameter. The New Run dialog prefills it from the most recent run of the same model on any map, else the map's own GSD (which means "no scaling").
3. **Map runs have no `status` column.** Their state is the state of their job (`job_id`), like `QueryRun`. An interrupted run's job is swept to `failed` by the existing orphan sweep, and the run offers **Resume**. Only `GeoMap.status` needs a new sweep.
4. **Tile responses.** Tiles are served without an extension. A fully valid tile is `image/jpeg`; a tile that contains masked pixels is `image/png` with alpha. 204 means the tile is empty.
5. **Export folder name.** Map exports reuse the existing `exports/<stamp>/` partial-folder mechanism. Files inside are named `map-<slug>-*.{geojson,gpkg,csv,json}`.
6. **Scoring runs on request.** Scoring is computed on request (`GET /map-runs/{id}/score`) and cached. The UI requests it whenever labels exist, so "scored automatically when the run finishes" is satisfied from the operator's side.
7. **e2e tests use the Prism mock.** The Playwright suite runs against the Prism mock (as all e2e tests here do). The real-backend path is covered by pytest plus the Task 15 walkthrough on the running app.

## File map

**Backend: new package `backend/app/maps/`**

| File | Responsibility |
| --- | --- |
| `__init__.py` | empty |
| `gdal_env.py` | point `GDAL_DATA` and `PROJ_DATA` at bundled data when frozen |
| `selftest.py` | `kestrel-backend.exe geo-selftest`: a frozen-bundle smoke check for rasterio and pyproj |
| `raster.py` | rasterio wrappers: `inspect_raster`, `compute_stretch`, `write_display_raster`, `read_rgb`, `low_res_mask`, `write_preview` |
| `georef.py` | `Georef`: pixel → native → WGS84, bounds, GSD, box corners |
| `tiles.py` | tile pyramid maths, `render_tile`, LRU cache |
| `windows.py` | detection window planning under GSD scaling, masked fraction, `StripMerger` |
| `scoring.py` | pure matcher: TP/FP/FN, P/R/F1, count error, per class, per zone |
| `geo_out.py` | GeoJSON, CSV and `summary.json` writers |
| `gpkg.py` | minimal GeoPackage writer (sqlite3) |
| `schemas.py` | pydantic models mirroring the contract |
| `service.py` | maps, runs, zones, labels: CRUD and bounded queries |
| `jobs_import.py` | `map_import` |
| `jobs_detect.py` | `map_detect` |
| `jobs_export.py` | `map_export` |
| `startup.py` | `sweep_interrupted_imports` |
| `router.py` | every map route |

**Backend: modified files**

- `app/db/models.py` gets 5 tables; `app/db/migrations/versions/0004_maps.py` is new.
- `app/projects/service.py` gets `maps_dir`; `app/main.py` gets the sweep step; `app/api.py` gets the router; `app/__main__.py` gets gdal env and `geo-selftest`.
- `kestrel_backend.spec`, `scripts/smoke_frozen.ps1`, `requirements.txt` and `requirements-lock.txt`.

**Backend tests (new)**

- `tests/geotiffs.py`: fixture builders.
- `tests/test_gdal_env.py`, `test_maps_raster.py`, `test_maps_georef.py`, `test_maps_tiles.py`, `test_maps_import.py`, `test_maps_windows.py`, `test_maps_detect.py`, `test_maps_scoring.py`, `test_maps_labels.py`, `test_maps_export.py`, `test_maps_startup.py`.

**Contract**

- `contract/openapi.yaml`: tag `maps`, 25 operations, and the schemas; `JobType` gains `map_import`, `map_detect` and `map_export`.
- `contract/client/schema.d.ts` is regenerated; `contract/client/index.ts` gets `mapTileUrl` and `mapPreviewUrl` plus type aliases.

**Frontend (new)**

- `src/api/maps.ts` (+test)
- `src/maps/grid.ts` (+test): tile grid and pixel ↔ OpenLayers.
- `src/maps/coords.ts` (+test): geotransform and proj4 readout.
- `src/maps/labelHistory.ts` (+test): undo/redo.
- `src/maps/scoreView.ts` (+test)
- `src/maps/MapView.tsx`: the OpenLayers wrapper.
- `src/maps/styles.ts`
- `src/maps/MapList.tsx`, `ImportMapDialog.tsx`, `NewRunDialog.tsx`, `ResultsPanel.tsx`, `LabelPanel.tsx`, `ScorePanel.tsx`, `ExportMapDialog.tsx`.
- `src/screens/MapsScreen.tsx` (+test)
- `e2e/maps.spec.ts`

**Frontend (modified)**

- `package.json`: `ol` and `proj4`.
- `src/routes.tsx`, `src/app/Sidebar.tsx`, `src/app/Header.tsx`.
- `src/ui/Icon.tsx` (`map` icon).
- The five `Record<Job["type"], …>` maps: `Header.tsx`, `HomeScreen.tsx`, `JobCard.tsx`, `jobLabels.ts`, `useJobToasts.ts`.
- `src/test/fixtures.ts`.

**Docs**

- `vault/decisions/2026-09-22-rasterio-in-the-frozen-sidecar.md`
- `docs/progress.md`
- `docs/usability/2026-09-22-maps-walkthrough.md`

## Budget and execution DAG

**Budget**

- **Background jobs:** `map_import` (per 2048 px block, then overviews), `map_detect` (per window, resumable from `maps/<id>/runs/<run>/windows/*.json`), `map_export`.
- **Bounded synchronous reads:**
  - one tile is one windowed read;
  - detections query ≤ 5 000;
  - density ≤ 256² cells;
  - score over zone-contained boxes only;
  - labels list ≤ 20 000 per map (labels exist only where a person labeled them).

**DAG** (a unit starts when all its dependencies are merged into the task branch)

| Task | Depends on | Batch |
| --- | --- | --- |
| 1 Freeze spike (rasterio, pyproj, gdal env, selftest, ADR) | none | B1 |
| 2 Contract + stubs + job types | none | B1 |
| 3 DB tables + migration + import sweep | none | B1 |
| 6 Windows + StripMerger (pure) | none | B1 |
| 4 raster.py + georef.py + fixtures | 1 | B2 |
| 5 Import job, map CRUD, preview, tiles | 2, 3, 4 | B3 |
| 8 Zones, labels, seed, scoring | 2, 3 | B3 |
| 10 Frontend api + grid + coords | 2 | B3 |
| 7 Detect job, runs API, estimate, detections, density | 5, 6 | B4 |
| 11 Maps screen, MapView tiles, import, nav | 10 | B4 |
| 9 Export job | 4, 7, 8 | B5 |
| 12 Run layers, new run, results panel, compare | 11 | B5 |
| 13 Label mode | 12, 8 | B6 |
| 14 Score overlay, error stepping, export dialog | 12, 9 | B6 |
| 15 e2e, docs, walkthrough, gates, merge | all | B7 |

- **Critical path:** 1 → 4 → 5 → 7 → 9 → 14 → 15.
- **Executing in one worktree:** tasks in a batch are independent in *code*, but they share `tests/test_contract.py::EXPECTED_STUBS` and the router file. Run them sequentially in batch order, or in separate worktrees rebased in batch order.

---
### Task 1: Freeze spike — rasterio and pyproj inside the sidecar (P0)

This task removes the one design risk: if rasterio can't be frozen, stop and report before any
other task. It is Task 1 because everything else depends on the answer.

**Files:**
- Modify: `backend/requirements.txt`, `backend/requirements-lock.txt`
- Create: `backend/app/maps/__init__.py` (empty), `backend/app/maps/gdal_env.py`, `backend/app/maps/selftest.py`
- Modify: `backend/app/__main__.py`
- Modify: `backend/kestrel_backend.spec`
- Modify: `backend/scripts/smoke_frozen.ps1`
- Test: `backend/tests/test_gdal_env.py`, `backend/tests/test_geo_selftest.py`
- Create: `vault/decisions/2026-09-22-rasterio-in-the-frozen-sidecar.md`

**Interfaces:**
- Produces:
  - `configure_gdal_env(base: Path | None = None, environ: MutableMapping[str, str] | None = None) -> dict[str, str]`
  - `selftest.main() -> int`: prints `geo ok <epsg> <lon> <lat>` and returns 0.
  - `python -m app geo-selftest` and `kestrel-backend.exe geo-selftest` run it.

- [ ] **Step 1: Install the two libraries into the shared venv**

This is additive: it adds `rasterio`, `pyproj`, `affine`, `attrs`, `click-plugins` and `cligj`
to the main checkout's venv and moves nothing else. Tell the operator before running it.

Run: `uv pip install --python E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe rasterio==1.4.4 pyproj==3.7.2`
Expected: `+ rasterio==1.4.4`, `+ pyproj==3.7.2`, `+ affine==3.0.1`, `+ attrs==26.1.0`, `+ click-plugins==1.1.1.2`, `+ cligj==0.7.2`, and no numpy change.

- [ ] **Step 2: Record them in the requirements files**

Append this to `backend/requirements.txt` after the `onnxruntime` line:

```
# maps (spec 2026-09-22-geotiff-maps): GDAL/PROJ come bundled in these wheels
rasterio==1.4.4
pyproj==3.7.2
```

Insert these lines into `backend/requirements-lock.txt` in alphabetical order. The file is
sorted, so each line goes where its name sorts:

```
affine==3.0.1
attrs==26.1.0
click-plugins==1.1.1.2
cligj==0.7.2
pyproj==3.7.2
rasterio==1.4.4
```

- [ ] **Step 3: Write the failing test for `configure_gdal_env`**

`backend/tests/test_gdal_env.py`:

```python
"""GDAL/PROJ data folders in the frozen build (ADR 2026-09-22 rasterio in the frozen sidecar)."""

from pathlib import Path

from app.maps.gdal_env import configure_gdal_env


def _bundle(tmp_path: Path) -> Path:
    (tmp_path / "rasterio" / "gdal_data").mkdir(parents=True)
    (tmp_path / "rasterio" / "proj_data").mkdir(parents=True)
    return tmp_path


def test_sets_both_folders_from_the_bundle(tmp_path):
    base = _bundle(tmp_path)
    env: dict[str, str] = {}
    applied = configure_gdal_env(base, env)
    assert env["GDAL_DATA"] == str(base / "rasterio" / "gdal_data")
    assert env["PROJ_DATA"] == str(base / "rasterio" / "proj_data")
    assert env["PROJ_LIB"] == env["PROJ_DATA"]  # PROJ < 9.1 reads PROJ_LIB
    assert applied == env


def test_never_overrides_an_operator_value(tmp_path):
    base = _bundle(tmp_path)
    env = {"GDAL_DATA": "C:/mine"}
    configure_gdal_env(base, env)
    assert env["GDAL_DATA"] == "C:/mine"


def test_missing_folders_are_skipped(tmp_path):
    env: dict[str, str] = {}
    assert configure_gdal_env(tmp_path, env) == {}
    assert env == {}


def test_not_frozen_is_a_no_op(monkeypatch):
    monkeypatch.delattr("sys.frozen", raising=False)
    env: dict[str, str] = {}
    assert configure_gdal_env(None, env) == {}
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_gdal_env.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.maps'`.

- [ ] **Step 5: Implement `gdal_env.py`**

Create `backend/app/maps/__init__.py` as an empty file, then `backend/app/maps/gdal_env.py`:

```python
"""Point GDAL and PROJ at the data folders the frozen bundle carries.

rasterio's Windows wheels ship `gdal_data/` and `proj_data/` inside the package. In a PyInstaller
build they land under `_MEIPASS/rasterio/`, where GDAL does not look on its own, and a missing
PROJ database turns every reprojection into "proj_create: no database context specified".
An operator-set value always wins: a GIS workstation may point these at its own install on purpose.
"""

from __future__ import annotations

import os
import sys
from collections.abc import MutableMapping
from pathlib import Path


def _bundle_base() -> Path | None:
    if not getattr(sys, "frozen", False):
        return None
    return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))


def configure_gdal_env(
    base: Path | None = None, environ: MutableMapping[str, str] | None = None
) -> dict[str, str]:
    """Set GDAL_DATA, PROJ_DATA and PROJ_LIB from the bundle; returns what was set."""
    env = os.environ if environ is None else environ
    base = base if base is not None else _bundle_base()
    if base is None:
        return {}
    wanted = {
        "GDAL_DATA": base / "rasterio" / "gdal_data",
        "PROJ_DATA": base / "rasterio" / "proj_data",
        "PROJ_LIB": base / "rasterio" / "proj_data",
    }
    applied: dict[str, str] = {}
    for key, folder in wanted.items():
        if key in env or not folder.is_dir():
            continue
        env[key] = str(folder)
        applied[key] = str(folder)
    return applied
```

- [ ] **Step 6: Run it to confirm it passes**

Run: `cd backend; $PY -m pytest tests/test_gdal_env.py -q`
Expected: `4 passed`.

- [ ] **Step 7: Write the failing selftest test**

`backend/tests/test_geo_selftest.py`:

```python
from app.maps import selftest


def test_selftest_writes_reads_and_reprojects(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("TEMP", str(tmp_path))
    assert selftest.main() == 0
    line = capsys.readouterr().out.strip().splitlines()[-1]
    assert line.startswith("geo ok 32633 ")
    lon, lat = (float(v) for v in line.split()[3:5])
    assert 14.9 < lon < 15.1 and 44.9 < lat < 45.1  # UTM 33N near (500000, 4983000)
```

- [ ] **Step 8: Implement `selftest.py`**

`backend/app/maps/selftest.py`:

```python
"""`kestrel-backend.exe geo-selftest`: proves the frozen bundle carries a working GDAL and PROJ.

It writes a small georeferenced tiled GeoTIFF with JPEG compression, an internal mask and
overviews (the exact layout `map_import` writes), reads a decimated window back, and reprojects
one point from UTM 33N to WGS84. Each step exercises a different piece of native code the
PyInstaller spec has to collect.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np


def main() -> int:
    import rasterio
    from pyproj import Transformer
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.windows import Window

    with tempfile.TemporaryDirectory(prefix="kestrel-geo-") as tmp:
        path = Path(tmp) / "selftest.tif"
        profile = dict(
            driver="GTiff", width=1024, height=1024, count=3, dtype="uint8", crs="EPSG:32633",
            transform=from_origin(500000, 4983000, 0.05, 0.05), tiled=True, blockxsize=512,
            blockysize=512, compress="JPEG", photometric="YCBCR",
        )
        data = np.random.default_rng(0).integers(0, 255, (3, 1024, 1024), dtype=np.uint8)
        with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
            with rasterio.open(path, "w", **profile) as dst:
                dst.write(data)
                dst.write_mask(np.full((1024, 1024), 255, np.uint8))
            with rasterio.open(path, "r+") as dst:
                dst.build_overviews([2, 4], Resampling.average)
        with rasterio.open(path) as src:
            small = src.read([1, 2, 3], window=Window(0, 0, 1024, 1024), out_shape=(3, 64, 64))
            assert small.shape == (3, 64, 64)
            epsg = src.crs.to_epsg()
            x, y = src.transform * (512, 512)
    lon, lat = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform(x, y)
    print(f"geo ok {epsg} {lon:.6f} {lat:.6f}", flush=True)
    return 0
```

- [ ] **Step 9: Wire it into the entry point**

In `backend/app/__main__.py`, replace the body of `run` after `freeze_support()`:

```python
    freeze_support()
    from app.maps.gdal_env import configure_gdal_env

    configure_gdal_env()  # before anything imports rasterio; a no-op outside the frozen build
    if len(argv) > 1 and argv[1] == "worker":
        from app.training.worker import main as worker_main

        return worker_main(argv[2:])
    if len(argv) > 1 and argv[1] == "geo-selftest":
        from app.maps.selftest import main as geo_selftest

        return geo_selftest()
    from app.main import main

    main()
    return 0
```

Also extend the module docstring's first line to: `` `python -m app` serves the API, `python -m app worker ...` trains, `python -m app geo-selftest` checks GDAL/PROJ. ``

- [ ] **Step 10: Run the selftest and the entry-point tests**

Run: `cd backend; $PY -m pytest tests/test_geo_selftest.py tests/test_gdal_env.py -q; $PY -m app geo-selftest`
Expected: `5 passed`, then a line `geo ok 32633 15.000… 44.99…`. The point is pixel (512, 512)
at 5 cm, which is 25.6 m east of the 15° E central meridian and about 45° N.

- [ ] **Step 11: Collect rasterio and pyproj in the PyInstaller spec**

In `backend/kestrel_backend.spec`:

- Add to the `hiddenimports` list:
  ```python
        # maps: rasterio's Cython modules import each other at runtime; PyInstaller misses these
        "rasterio._shim",
        "rasterio.sample",
        "rasterio.vrt",
        "rasterio._features",
        "rasterio.crs",
        "pyproj.database",
  ```
- Change `datas` to add:
  ```python
    + collect_data_files("rasterio")  # gdal_data/ and proj_data/ (ADR 2026-09-22)
    + collect_data_files("pyproj")  # proj_dir/share/proj/proj.db
  ```
- Change `binaries` to add:
  ```python
    + collect_dynamic_libs("rasterio")  # rasterio.libs/: GDAL, PROJ, GEOS, libjpeg ...
    + collect_dynamic_libs("pyproj")
  ```

- [ ] **Step 12: Add the geo step to the frozen smoke**

In `backend/scripts/smoke_frozen.ps1`, straight after the `$exe`/`$Source` checks and before the
server starts, add:

```powershell
# rasterio/pyproj inside the bundle (ADR 2026-09-22): one GeoTIFF write/read and one reprojection.
$geo = & $exe geo-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $geo -notmatch "geo ok 32633") { throw "geo selftest failed: $geo" }
Write-Host ($geo.Trim().Split("`n")[-1])
Complete-Step "geo"
```

Update the `.DESCRIPTION` block's printed-lines sentence to include `` `geo ok 32633 <lon> <lat>` ``.

- [ ] **Step 13: Build the frozen sidecar and run the smoke (background, 10–25 min)**

Run in the background: `powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\build.ps1`
Then: `powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1`
Expected: `geo ok 32633 15.000… 44.99…` followed by the existing `health ok … worker ok` lines.

If the geo step fails, fix the spec using the error:

- a missing DLL → `collect_dynamic_libs`;
- `no database context` → the `PROJ_DATA` path;
- a missing module → `hiddenimports`.

Retry at most three times. If it still fails, STOP and report to the operator with the exact
error: the display design depends on this.

Record the bundle size difference from the frozen bundle size in the build output, before and
after.

- [ ] **Step 14: Write the ADR**

`vault/decisions/2026-09-22-rasterio-in-the-frozen-sidecar.md`:

```markdown
---
type: decision
date: 2026-09-22
status: accepted
tags: [adr, packaging, maps, gdal]
related: ["[[2026-09-22-geotiff-maps-design]]"]
---

# rasterio (GDAL + PROJ) inside the frozen sidecar

**Context.** GeoTIFF maps need GDAL (read any GeoTIFF, write tiled overviews) and PROJ (any CRS
to WGS84). Both are native. The sidecar is a PyInstaller one-folder build that must carry every
DLL and data file itself.

**Decision.** Use the rasterio 1.4.4 and pyproj 3.7.2 wheels, which bundle GDAL, PROJ and their
data. The spec collects `rasterio`/`pyproj` dynamic libs and data files plus six hidden imports.
`app/maps/gdal_env.py` sets `GDAL_DATA`/`PROJ_DATA`/`PROJ_LIB` to `_MEIPASS/rasterio/...` when
frozen, never over an operator value. `kestrel-backend.exe geo-selftest` is the permanent check,
and `smoke_frozen.ps1` runs it first.

**Trap.** A frozen build *starts* fine without the data folders. It fails only at the first
reprojection ("no database context"), which is deep inside an export job. The selftest makes
that fail at build time instead.

**Evidence.** <fill in: build date, bundle size before/after, selftest output line>
```

Fill in the Evidence line with the real numbers from Step 13 before committing.

- [ ] **Step 15: Lint and commit**

Run: `cd backend; $PY -m ruff check .; $PY -m ruff format --check .`
Expected: clean.

```bash
git add backend/requirements.txt backend/requirements-lock.txt backend/app/maps/__init__.py backend/app/maps/gdal_env.py backend/app/maps/selftest.py backend/app/__main__.py backend/kestrel_backend.spec backend/scripts/smoke_frozen.ps1 backend/tests/test_gdal_env.py backend/tests/test_geo_selftest.py vault/decisions/2026-09-22-rasterio-in-the-frozen-sidecar.md
git commit -m "build(maps): rasterio + pyproj in the frozen sidecar, geo-selftest in the smoke

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: Contract for every map operation, 501 stubs, new job types

The whole contract is written up front, so later tasks never edit `openapi.yaml` in parallel.
Every operation is routed immediately as a 501 stub (the existing `app/stubs.py` pattern), and
each later task removes its operations from `EXPECTED_STUBS`.

**Files:**
- Modify: `contract/openapi.yaml`
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts`
- Create: `backend/app/maps/router.py`
- Modify: `backend/app/api.py`, `backend/tests/test_contract.py`
- Modify: `frontend/src/app/Header.tsx`, `frontend/src/screens/HomeScreen.tsx`, `frontend/src/jobs/JobCard.tsx`, `frontend/src/jobs/jobLabels.ts`, `frontend/src/ui/useJobToasts.ts`, `frontend/src/ui/Icon.tsx`

**Interfaces:**
- Produces:
  - **operationIds:** `listMaps`, `createMap`, `getMap`, `deleteMap`, `getMapPreview`, `getMapTile`, `listMapRuns`, `estimateMapRun`, `createMapRun`, `getMapRun`, `deleteMapRun`, `resumeMapRun`, `listMapDetections`, `getMapDensity`, `getMapRunScore`, `listMapZones`, `createMapZone`, `updateMapZone`, `deleteMapZone`, `listMapLabels`, `createMapLabel`, `updateMapLabel`, `deleteMapLabel`, `seedMapLabels`, `createMapExport`.
  - **Schemas:** listed in Step 1.
  - **Client helpers:** `mapTileUrl(baseUrl, token, projectId, mapId)` returns a template containing `{z}/{x}/{y}`; `mapPreviewUrl(baseUrl, token, projectId, mapId)`.
  - **Stub names in `STUBS`** (Step 4); later tasks delete their entries from `STUBS` and `EXPECTED_STUBS`.

- [ ] **Step 1: Add the schemas to `contract/openapi.yaml`**

- Add `- name: maps` to the `tags:` list.
- Under `components.parameters`, add:

```yaml
    mapId:
      name: mapId
      in: path
      required: true
      schema: { type: string }
    zoneId:
      name: zoneId
      in: path
      required: true
      schema: { type: string }
    labelId:
      name: labelId
      in: path
      required: true
      schema: { type: string }
```

- Change `JobType` to: `enum: [import, dataset, train, infer, export, results_export, map_import, map_detect, map_export]`
- Under `components.schemas` (after `CostEstimate`), add:

```yaml
    GeoMapStatus:
      type: string
      enum: [importing, ready, failed]
    TileGrid:
      type: object
      description: 256 px tiles in the map's pixel grid. At zoom z one tile pixel covers 2^(max_zoom - z) map pixels.
      required: [tile_size, max_zoom]
      properties:
        tile_size: { type: integer, enum: [256] }
        max_zoom: { type: integer, minimum: 0 }
    GeoMap:
      type: object
      required: [id, name, status, error, source_path, source_size, width, height, band_count, dtype, crs_wkt, epsg, proj4, geotransform, bounds_native, bounds_wgs84, gsd_cm, tile_grid, labels_version, job_id, created_at]
      properties:
        id: { type: string }
        name: { type: string }
        status: { $ref: "#/components/schemas/GeoMapStatus" }
        error: { type: [string, "null"] }
        source_path: { type: string, description: the original file; never copied or modified }
        source_size: { type: integer }
        width: { type: integer }
        height: { type: integer }
        band_count: { type: integer }
        dtype: { type: string }
        crs_wkt: { type: [string, "null"], description: null when the file has no coordinates }
        epsg: { type: [integer, "null"] }
        proj4: { type: [string, "null"], description: for the client-side coordinate readout }
        geotransform:
          type: [array, "null"]
          description: GDAL order (x0, px_w, row_rot, y0, col_rot, px_h)
          items: { type: number }
          minItems: 6
          maxItems: 6
        bounds_native:
          type: [array, "null"]
          description: minx, miny, maxx, maxy in the map CRS
          items: { type: number }
          minItems: 4
          maxItems: 4
        bounds_wgs84:
          type: [array, "null"]
          description: west, south, east, north
          items: { type: number }
          minItems: 4
          maxItems: 4
        gsd_cm: { type: [number, "null"], description: ground size of one pixel in centimetres }
        tile_grid: { $ref: "#/components/schemas/TileGrid" }
        labels_version: { type: integer }
        job_id: { type: [string, "null"] }
        created_at: { type: string, format: date-time }
      example:
        id: "a0000000-6666-4000-8000-000000000001"
        name: "Site north ortho"
        status: ready
        error: null
        source_path: "D:/orthos/site-north.tif"
        source_size: 3221225472
        width: 80000
        height: 60000
        band_count: 4
        dtype: uint8
        crs_wkt: "PROJCS[\"WGS 84 / UTM zone 33N\"]"
        epsg: 32633
        proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs"
        geotransform: [500000, 0.03, 0, 4983000, 0, -0.03]
        bounds_native: [500000, 4981200, 502400, 4983000]
        bounds_wgs84: [15.0, 44.98, 15.03, 45.0]
        gsd_cm: 3.0
        tile_grid: { tile_size: 256, max_zoom: 9 }
        labels_version: 3
        job_id: "j0000000-4444-4000-8000-000000000001"
        created_at: "2026-09-22T10:00:00Z"
    GeoMapCreate:
      type: object
      required: [path]
      properties:
        path: { type: string, minLength: 1, description: absolute path of a .tif/.tiff file }
        name: { type: string, minLength: 1, maxLength: 200 }
    GeoMapWithJob:
      type: object
      required: [map, job]
      properties:
        map: { $ref: "#/components/schemas/GeoMap" }
        job: { $ref: "#/components/schemas/Job" }
    GeoMapList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/GeoMap" }
    MapRunCreate:
      type: object
      required: [map_id, kind]
      properties:
        map_id: { type: string }
        kind: { $ref: "#/components/schemas/QueryRunKind" }
        model_id: { type: string, description: required for local_model }
        provider: { $ref: "#/components/schemas/ProviderName" }
        query: { type: string, minLength: 1, description: required for cloud_provider }
        tile_size: { type: integer, minimum: 256, maximum: 4096, default: 1280 }
        overlap: { type: number, minimum: 0, maximum: 0.5, default: 0.2 }
        nms_iou: { type: number, minimum: 0, maximum: 1, default: 0.5 }
        conf: { type: number, minimum: 0, maximum: 1, default: 0.25 }
        target_gsd_cm:
          type: [number, "null"]
          exclusiveMinimum: 0
          description: the model's training GSD; windows are resampled to it when it differs from the map's by more than 15 %
      example: { map_id: "a0000000-6666-4000-8000-000000000001", kind: local_model, model_id: "m0000000-2222-4000-8000-000000000001", tile_size: 1280, overlap: 0.2, nms_iou: 0.5, conf: 0.25, target_gsd_cm: 2.0 }
    MapRun:
      type: object
      required: [id, map_id, kind, model_id, provider, model_name, query, tile_size, overlap, nms_iou, conf, target_gsd_cm, job_id, state, counts, detection_count, created_at]
      properties:
        id: { type: string }
        map_id: { type: string }
        kind: { $ref: "#/components/schemas/QueryRunKind" }
        model_id: { type: [string, "null"] }
        provider: { type: [string, "null"] }
        model_name: { type: [string, "null"] }
        query: { type: string }
        tile_size: { type: integer }
        overlap: { type: number }
        nms_iou: { type: number }
        conf: { type: number }
        target_gsd_cm: { type: [number, "null"] }
        job_id: { type: [string, "null"] }
        state:
          description: the state of the run's latest job; null before one exists
          oneOf:
            - { $ref: "#/components/schemas/JobState" }
            - { type: "null" }
        counts:
          type: object
          description: detections per class id, filled when the run finishes
          additionalProperties: { type: integer }
        detection_count: { type: integer }
        created_at: { type: string, format: date-time }
      example:
        id: "r0000000-7777-4000-8000-000000000001"
        map_id: "a0000000-6666-4000-8000-000000000001"
        kind: local_model
        model_id: "m0000000-2222-4000-8000-000000000001"
        provider: null
        model_name: "machinery-v3"
        query: ""
        tile_size: 1280
        overlap: 0.2
        nms_iou: 0.5
        conf: 0.25
        target_gsd_cm: 2.0
        job_id: "j0000000-4444-4000-8000-000000000001"
        state: succeeded
        counts: { "c1a2b3c4-0000-4000-8000-000000000001": 42, "c1a2b3c4-0000-4000-8000-000000000004": 17 }
        detection_count: 59
        created_at: "2026-09-22T11:00:00Z"
    MapRunWithJob:
      type: object
      required: [run, job]
      properties:
        run: { $ref: "#/components/schemas/MapRun" }
        job: { $ref: "#/components/schemas/Job" }
    MapRunList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/MapRun" }
    MapRunEstimate:
      type: object
      required: [windows, skipped_windows, requests, scale, cost_per_request, estimated_cost]
      properties:
        windows: { type: integer }
        skipped_windows: { type: integer, description: windows at least 99 % nodata, never sent to the model }
        requests: { type: integer }
        scale: { type: number, description: map pixels are resampled by this factor before detection (1 = none) }
        cost_per_request: { type: number }
        estimated_cost: { type: number }
      example: { windows: 8900, skipped_windows: 2100, requests: 6800, scale: 1.5, cost_per_request: 0, estimated_cost: 0 }
    MapDetection:
      type: object
      required: [id, class_id, confidence, x, y, w, h, angle]
      properties:
        id: { type: string }
        class_id: { type: string }
        confidence: { type: number }
        x: { type: number, description: full-resolution map pixels }
        y: { type: number }
        w: { type: number }
        h: { type: number }
        angle: { type: [number, "null"] }
    MapDetectionPage:
      type: object
      required: [items, truncated]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/MapDetection" }
        truncated: { type: boolean, description: more than 5000 boxes matched; the client should switch to density }
      example:
        items: [{ id: "d0000000-1111-4000-8000-000000000001", class_id: "c1a2b3c4-0000-4000-8000-000000000001", confidence: 0.91, x: 1200, y: 800, w: 180, h: 120, angle: null }]
        truncated: false
    MapDensityCell:
      type: object
      required: [gx, gy, class_id, count]
      properties:
        gx: { type: integer }
        gy: { type: integer }
        class_id: { type: string }
        count: { type: integer }
    MapDensity:
      type: object
      required: [cell_size, cells]
      properties:
        cell_size: { type: number, description: cell edge in map pixels; cell (gx, gy) starts at (gx*cell_size, gy*cell_size) }
        cells:
          type: array
          items: { $ref: "#/components/schemas/MapDensityCell" }
    MapPoint:
      type: array
      items: { type: number }
      minItems: 2
      maxItems: 2
    MapZone:
      type: object
      required: [id, map_id, name, polygon]
      properties:
        id: { type: string }
        map_id: { type: string }
        name: { type: string }
        polygon:
          type: array
          items: { $ref: "#/components/schemas/MapPoint" }
          minItems: 3
      example: { id: "z0000000-9999-4000-8000-000000000001", map_id: "a0000000-6666-4000-8000-000000000001", name: "Zone 1", polygon: [[1000, 1000], [6000, 1000], [6000, 5000], [1000, 5000]] }
    MapZoneCreate:
      type: object
      required: [name, polygon]
      properties:
        name: { type: string, minLength: 1, maxLength: 100 }
        polygon:
          type: array
          items: { $ref: "#/components/schemas/MapPoint" }
          minItems: 3
          maxItems: 1000
    MapZoneUpdate:
      type: object
      properties:
        name: { type: string, minLength: 1, maxLength: 100 }
        polygon:
          type: array
          items: { $ref: "#/components/schemas/MapPoint" }
          minItems: 3
          maxItems: 1000
    MapZoneList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/MapZone" }
    MapLabel:
      type: object
      required: [id, map_id, class_id, x, y, w, h, angle, source, created_at, updated_at]
      properties:
        id: { type: string }
        map_id: { type: string }
        class_id: { type: string }
        x: { type: number }
        y: { type: number }
        w: { type: number }
        h: { type: number }
        angle: { type: [number, "null"] }
        source: { type: string, description: "`manual`, or `from_run:<run id>` until a person edits it" }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
      example: { id: "l0000000-1212-4000-8000-000000000001", map_id: "a0000000-6666-4000-8000-000000000001", class_id: "c1a2b3c4-0000-4000-8000-000000000001", x: 1210, y: 805, w: 175, h: 118, angle: null, source: manual, created_at: "2026-09-22T12:00:00Z", updated_at: "2026-09-22T12:00:00Z" }
    MapLabelCreate:
      type: object
      required: [class_id, x, y, w, h]
      properties:
        class_id: { type: string }
        x: { type: number, minimum: 0 }
        y: { type: number, minimum: 0 }
        w: { type: number, exclusiveMinimum: 0 }
        h: { type: number, exclusiveMinimum: 0 }
    MapLabelUpdate:
      type: object
      properties:
        class_id: { type: string }
        x: { type: number, minimum: 0 }
        y: { type: number, minimum: 0 }
        w: { type: number, exclusiveMinimum: 0 }
        h: { type: number, exclusiveMinimum: 0 }
    MapLabelList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/MapLabel" }
    MapLabelSeed:
      type: object
      required: [run_id, zone_id]
      properties:
        run_id: { type: string }
        zone_id: { type: string }
        min_conf: { type: number, minimum: 0, maximum: 1, default: 0.25 }
    MapLabelSeedResult:
      type: object
      required: [created]
      properties:
        created: { type: integer }
    MapScoreRow:
      type: object
      required: [class_id, tp, fp, fn, precision, recall, f1, predicted, actual, count_error, count_error_pct]
      properties:
        class_id: { type: [string, "null"], description: null on the overall row }
        tp: { type: integer }
        fp: { type: integer }
        fn: { type: integer }
        precision: { type: [number, "null"] }
        recall: { type: [number, "null"] }
        f1: { type: [number, "null"] }
        predicted: { type: integer }
        actual: { type: integer }
        count_error: { type: integer, description: predicted minus actual }
        count_error_pct: { type: [number, "null"] }
    MapScoreZoneRow:
      allOf:
        - { $ref: "#/components/schemas/MapScoreRow" }
        - type: object
          required: [zone_id]
          properties:
            zone_id: { type: string }
    MapScoreMatch:
      type: object
      description: one scored box; its geometry is included so the client can step to any mistake without loading that part of the map first
      required: [kind, id, match, zone_id, class_id, x, y, w, h]
      properties:
        kind: { type: string, enum: [detection, label] }
        id: { type: string }
        match: { type: string, enum: [tp, fp, fn] }
        zone_id: { type: string }
        class_id: { type: string }
        x: { type: number }
        y: { type: number }
        w: { type: number }
        h: { type: number }
    MapScore:
      type: object
      required: [run_id, iou, labels_version, has_zones, overall, per_class, per_zone, matches]
      properties:
        run_id: { type: string }
        iou: { type: number }
        labels_version: { type: integer }
        has_zones: { type: boolean }
        overall: { $ref: "#/components/schemas/MapScoreRow" }
        per_class:
          type: array
          items: { $ref: "#/components/schemas/MapScoreRow" }
        per_zone:
          type: array
          items: { $ref: "#/components/schemas/MapScoreZoneRow" }
        matches:
          type: array
          items: { $ref: "#/components/schemas/MapScoreMatch" }
      example:
        run_id: "r0000000-7777-4000-8000-000000000001"
        iou: 0.5
        labels_version: 3
        has_zones: true
        overall: { class_id: null, tp: 18, fp: 2, fn: 3, precision: 0.9, recall: 0.857, f1: 0.878, predicted: 20, actual: 21, count_error: -1, count_error_pct: -4.76 }
        per_class: [{ class_id: "c1a2b3c4-0000-4000-8000-000000000001", tp: 18, fp: 2, fn: 3, precision: 0.9, recall: 0.857, f1: 0.878, predicted: 20, actual: 21, count_error: -1, count_error_pct: -4.76 }]
        per_zone: []
        matches:
          - { kind: detection, id: "d0000000-1111-4000-8000-000000000001", match: tp, zone_id: "z0000000-9999-4000-8000-000000000001", class_id: "c1a2b3c4-0000-4000-8000-000000000001", x: 1200, y: 1200, w: 180, h: 120 }
          - { kind: detection, id: "d0000000-1111-4000-8000-000000000002", match: fp, zone_id: "z0000000-9999-4000-8000-000000000001", class_id: "c1a2b3c4-0000-4000-8000-000000000001", x: 3000, y: 2400, w: 170, h: 110 }
          - { kind: label, id: "l0000000-1212-4000-8000-000000000001", match: fn, zone_id: "z0000000-9999-4000-8000-000000000001", class_id: "c1a2b3c4-0000-4000-8000-000000000004", x: 4100, y: 3300, w: 200, h: 140 }
    MapExportFormat:
      type: string
      enum: [geojson, gpkg, csv]
    MapExportContent:
      type: string
      enum: [run, labels, run_score]
    MapExportRequest:
      type: object
      required: [map_id, content, formats]
      properties:
        map_id: { type: string }
        content: { $ref: "#/components/schemas/MapExportContent" }
        run_id: { type: string, description: required for run and run_score }
        formats:
          type: array
          items: { $ref: "#/components/schemas/MapExportFormat" }
          minItems: 1
          uniqueItems: true
```

- [ ] **Step 2: Add the paths to `contract/openapi.yaml`**

Add these under `paths:`, after the query-run paths. Every operation has `tags: [maps]` and ends
with `default: { $ref: "#/components/responses/Error" }`.

```yaml
  /api/v1/projects/{projectId}/maps:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [maps]
      operationId: listMaps
      summary: Every map in the project, newest first.
      responses:
        "200":
          description: maps
          content:
            application/json:
              schema: { $ref: "#/components/schemas/GeoMapList" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [maps]
      operationId: createMap
      summary: Import a GeoTIFF (a `map_import` job). The source file is only read. A file without coordinates imports with `crs_wkt` null.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/GeoMapCreate" }
      responses:
        "202":
          description: map created in `importing`, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/GeoMapWithJob" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
    get:
      tags: [maps]
      operationId: getMap
      responses:
        "200":
          description: the map
          content:
            application/json:
              schema: { $ref: "#/components/schemas/GeoMap" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [maps]
      operationId: deleteMap
      summary: Delete the map, its runs, zones and labels, and its folder under `maps/`. 409 while one of its jobs is queued or running.
      responses:
        "204": { description: deleted }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/preview:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
    get:
      tags: [maps]
      operationId: getMapPreview
      summary: About 1024 px long-side JPEG of the whole map.
      responses:
        "200":
          description: JPEG bytes
          content:
            image/jpeg:
              schema: { type: string, format: binary }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/tiles/{z}/{x}/{y}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
      - { name: z, in: path, required: true, schema: { type: integer, minimum: 0, maximum: 30 } }
      - { name: x, in: path, required: true, schema: { type: integer, minimum: 0 } }
      - { name: y, in: path, required: true, schema: { type: integer, minimum: 0 } }
    get:
      tags: [maps]
      operationId: getMapTile
      summary: One 256 px tile of the map's pixel grid; one bounded read. PNG with alpha when the tile holds nodata.
      responses:
        "200":
          description: tile image
          content:
            image/jpeg:
              schema: { type: string, format: binary }
            image/png:
              schema: { type: string, format: binary }
        "204": { description: the tile is outside the map or entirely nodata }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/runs:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
    get:
      tags: [maps]
      operationId: listMapRuns
      responses:
        "200":
          description: the map's runs, newest first
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapRunList" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-runs/estimate:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [maps]
      operationId: estimateMapRun
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapRunCreate" }
      responses:
        "200":
          description: windows, skipped windows and cost
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapRunEstimate" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-runs:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [maps]
      operationId: createMapRun
      summary: Detect across the whole map (a `map_detect` job).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapRunCreate" }
      responses:
        "202":
          description: run created, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapRunWithJob" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-runs/{runId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/runId"
    get:
      tags: [maps]
      operationId: getMapRun
      responses:
        "200":
          description: the run
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapRun" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [maps]
      operationId: deleteMapRun
      summary: Delete the run and its detections. 409 while its job is queued or running.
      responses:
        "204": { description: deleted }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-runs/{runId}/resume:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/runId"
    post:
      tags: [maps]
      operationId: resumeMapRun
      summary: Start a new job for the run; finished windows are reused.
      responses:
        "202":
          description: job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-runs/{runId}/detections:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/runId"
    get:
      tags: [maps]
      operationId: listMapDetections
      summary: Boxes intersecting `bbox` (map pixels), at most 5000.
      parameters:
        - { name: bbox, in: query, required: false, schema: { type: string, pattern: "^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$" }, description: "x0,y0,x1,y1" }
        - { name: min_conf, in: query, required: false, schema: { type: number, minimum: 0, maximum: 1 } }
        - { name: class_id, in: query, required: false, schema: { type: string } }
      responses:
        "200":
          description: boxes
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapDetectionPage" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-runs/{runId}/density:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/runId"
    get:
      tags: [maps]
      operationId: getMapDensity
      summary: Detection counts per class on a grid over the whole map; for zoomed-out views.
      parameters:
        - { name: cells, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 256, default: 128 } }
        - { name: min_conf, in: query, required: false, schema: { type: number, minimum: 0, maximum: 1 } }
      responses:
        "200":
          description: grid counts
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapDensity" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-runs/{runId}/score:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/runId"
    get:
      tags: [maps]
      operationId: getMapRunScore
      summary: The run scored against the map's labels inside its zones.
      parameters:
        - { name: iou, in: query, required: false, schema: { type: number, minimum: 0.05, maximum: 0.95, default: 0.5 } }
      responses:
        "200":
          description: score
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapScore" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/zones:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
    get:
      tags: [maps]
      operationId: listMapZones
      responses:
        "200":
          description: zones
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapZoneList" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [maps]
      operationId: createMapZone
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapZoneCreate" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapZone" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/zones/{zoneId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
      - $ref: "#/components/parameters/zoneId"
    patch:
      tags: [maps]
      operationId: updateMapZone
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapZoneUpdate" }
      responses:
        "200":
          description: updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapZone" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [maps]
      operationId: deleteMapZone
      responses:
        "204": { description: deleted }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/labels:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
    get:
      tags: [maps]
      operationId: listMapLabels
      summary: Every ground-truth box on the map (at most 20000).
      responses:
        "200":
          description: labels
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapLabelList" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [maps]
      operationId: createMapLabel
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapLabelCreate" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapLabel" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/labels/{labelId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
      - $ref: "#/components/parameters/labelId"
    patch:
      tags: [maps]
      operationId: updateMapLabel
      summary: Edit a label; its `source` becomes `manual`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapLabelUpdate" }
      responses:
        "200":
          description: updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapLabel" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [maps]
      operationId: deleteMapLabel
      responses:
        "204": { description: deleted }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/maps/{mapId}/labels/seed:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/mapId"
    post:
      tags: [maps]
      operationId: seedMapLabels
      summary: Copy a run's detections whose centre is inside a zone into labels (`source` `from_run:<id>`).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapLabelSeed" }
      responses:
        "200":
          description: labels created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MapLabelSeedResult" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/map-exports:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [maps]
      operationId: createMapExport
      summary: Write GeoJSON (WGS84), GeoPackage (map CRS) and/or CSV (both) to `exports/<stamp>/` (a `map_export` job).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MapExportRequest" }
      responses:
        "202":
          description: job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 3: Lint and regenerate the client**

Run: `pnpm -C contract lint; pnpm -C contract generate`
Expected: Spectral reports no errors (warnings no worse than on `main`), and `client/schema.d.ts`
is rewritten.

- [ ] **Step 4: Route every operation as a 501 stub**

`backend/app/maps/router.py`:

```python
"""GeoTIFF maps: import, tiles, runs, zones, labels, scoring, export (spec 2026-09-22-geotiff-maps).

Operations not built yet are 501 stubs; each task that lands one removes it from STUBS.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["maps"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/maps", "listMaps"),
    ("POST", "/maps", "createMap"),
    ("GET", "/maps/{mapId}", "getMap"),
    ("DELETE", "/maps/{mapId}", "deleteMap"),
    ("GET", "/maps/{mapId}/preview", "getMapPreview"),
    ("GET", "/maps/{mapId}/tiles/{z}/{x}/{y}", "getMapTile"),
    ("GET", "/maps/{mapId}/runs", "listMapRuns"),
    ("POST", "/map-runs/estimate", "estimateMapRun"),
    ("POST", "/map-runs", "createMapRun"),
    ("GET", "/map-runs/{runId}", "getMapRun"),
    ("DELETE", "/map-runs/{runId}", "deleteMapRun"),
    ("POST", "/map-runs/{runId}/resume", "resumeMapRun"),
    ("GET", "/map-runs/{runId}/detections", "listMapDetections"),
    ("GET", "/map-runs/{runId}/density", "getMapDensity"),
    ("GET", "/map-runs/{runId}/score", "getMapRunScore"),
    ("GET", "/maps/{mapId}/zones", "listMapZones"),
    ("POST", "/maps/{mapId}/zones", "createMapZone"),
    ("PATCH", "/maps/{mapId}/zones/{zoneId}", "updateMapZone"),
    ("DELETE", "/maps/{mapId}/zones/{zoneId}", "deleteMapZone"),
    ("GET", "/maps/{mapId}/labels", "listMapLabels"),
    ("POST", "/maps/{mapId}/labels", "createMapLabel"),
    ("POST", "/maps/{mapId}/labels/seed", "seedMapLabels"),
    ("PATCH", "/maps/{mapId}/labels/{labelId}", "updateMapLabel"),
    ("DELETE", "/maps/{mapId}/labels/{labelId}", "deleteMapLabel"),
    ("POST", "/map-exports", "createMapExport"),
]

add_stubs(router, STUBS)
```

The `/maps/{mapId}/labels/seed` stub sits before `/maps/{mapId}/labels/{labelId}` on purpose:
Starlette matches in order, and a POST to `.../labels/seed` must never be read as label id `seed`.
Every later task keeps this order when it replaces stubs with real routes: define the real routes
*before* calling `add_stubs` for the remainder.

In `backend/app/api.py`, add `from app.maps.router import router as maps_router` and append
`maps_router` to the tuple after `exports_router`.

In `backend/tests/test_contract.py`, replace the `EXPECTED_STUBS` line and the comment above it:

```python
# Operations still served by 501 stubs: the GeoTIFF maps plan lands them task by task, and each
# task removes its operation ids here. Anything else answering 501 fails `test_responses_conform`.
EXPECTED_STUBS: set[str] = {
    "listMaps", "createMap", "getMap", "deleteMap", "getMapPreview", "getMapTile", "listMapRuns",
    "estimateMapRun", "createMapRun", "getMapRun", "deleteMapRun", "resumeMapRun",
    "listMapDetections", "getMapDensity", "getMapRunScore", "listMapZones", "createMapZone",
    "updateMapZone", "deleteMapZone", "listMapLabels", "createMapLabel", "seedMapLabels",
    "updateMapLabel", "deleteMapLabel", "createMapExport",
}
```

- [ ] **Step 5: Run the contract tests**

Run: `cd backend; $PY -m pytest tests/test_contract.py -q -x`
Expected: PASS. Every new path is routed, and the stubs answer 501 in the error envelope.

- [ ] **Step 6: Client helpers**

In `contract/client/index.ts`:

- After `export type AppEvent = Schemas["Event"];`, add:

```ts
export type GeoMap = Schemas["GeoMap"];
export type MapRun = Schemas["MapRun"];
export type MapRunCreate = Schemas["MapRunCreate"];
export type MapDetection = Schemas["MapDetection"];
export type MapZone = Schemas["MapZone"];
export type MapLabel = Schemas["MapLabel"];
export type MapScore = Schemas["MapScore"];
```

- At the end of the file, add:

```ts
/** OpenLayers tile URL template for a map: `{z}`, `{x}` and `{y}` are left for the source to fill. */
export function mapTileUrl(baseUrl: string, token: string, projectId: string, mapId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/maps/${mapId}/tiles/{z}/{x}/{y}?${q}`;
}

export function mapPreviewUrl(baseUrl: string, token: string, projectId: string, mapId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/maps/${mapId}/preview?${q}`;
}
```

- [ ] **Step 7: Give the frontend's job-type maps the three new types, plus a `map` icon**

`pnpm -C frontend build` now fails, because every `Record<Job["type"], …>` is missing keys.
Add these entries:

- `src/app/Header.tsx` `TYPE_VERB`: `map_import: "Importing a map", map_detect: "Detecting on a map", map_export: "Exporting map results",`
- `src/screens/HomeScreen.tsx` `TYPE_VERB`: the same three strings.
- `src/jobs/JobCard.tsx` `TYPE_ICON`: `map_import: "map", map_detect: "detect", map_export: "download",`
- `src/jobs/jobLabels.ts` `TYPE_LABEL`: `map_import: "Map import", map_detect: "Map detection", map_export: "Map export",`. In the same file, the `switch (job.type)` that returns a job's "open" link (it has `case "results_export": return null;`) needs these cases too:
  ```ts
      case "map_import":
      case "map_detect":
      case "map_export":
        return { label: "Open maps", to: `${p}/maps` };
  ```
- `src/ui/useJobToasts.ts` `TYPE_NAME`: `map_import: "Map import", map_detect: "Map detection", map_export: "Map export",`
- `src/ui/Icon.tsx`: add `| "map"` to the `IconName` union, and add this to `PATHS`:
  `map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",`

- [ ] **Step 8: Run the frontend gates**

Run: `pnpm -C frontend lint; pnpm -C frontend test; pnpm -C frontend build; pnpm -C contract check`
Expected: all pass. `contract check` shows no diff after the commit below, so run it again after
committing.

- [ ] **Step 9: Commit**

```bash
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/app/maps/router.py backend/app/api.py backend/tests/test_contract.py frontend/src/app/Header.tsx frontend/src/screens/HomeScreen.tsx frontend/src/jobs/JobCard.tsx frontend/src/jobs/jobLabels.ts frontend/src/ui/useJobToasts.ts frontend/src/ui/Icon.tsx
git commit -m "feat(contract): GeoTIFF maps operations, routed as 501 stubs; map job types

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Map tables, migration 0004, interrupted-import sweep

**Files:**
- Modify: `backend/app/db/models.py`
- Create: `backend/app/db/migrations/versions/0004_maps.py`
- Modify: `backend/app/projects/service.py` (`maps_dir`)
- Create: `backend/app/maps/startup.py`
- Modify: `backend/app/main.py` (`project_opened`)
- Test: `backend/tests/test_maps_startup.py`, and extend `backend/tests/test_db.py`

**Interfaces:**
- Produces:
  - ORM classes `GeoMap`, `MapRun`, `MapDetection`, `MapZone`, `MapLabel` (fields below);
  - `ProjectHandle.maps_dir -> Path` (`<project>/maps`);
  - `map_dir(handle, map_id) -> Path` and `map_raster_path(handle, map_id) -> Path` (`maps/<id>/map.tif`) in `app/maps/startup.py`;
  - `sweep_interrupted_imports(handle, runner) -> list[str]` (ids marked failed);
  - `INTERRUPTED_IMPORT = "import interrupted by application restart; import the file again"`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_maps_startup.py`:

```python
"""An import a crash left in `importing` becomes `failed`, and the app still opens (spec 3)."""

from app.db.models import GeoMap
from app.maps.startup import INTERRUPTED_IMPORT, map_dir, map_raster_path, sweep_interrupted_imports


class _Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id):
        return job_id in self.live


def _add_map(handle, status, job_id):
    with handle.session() as s:
        row = GeoMap(
            name="m", status=status, source_path="x.tif", source_size=1, source_sha256="",
            width=10, height=10, band_count=3, dtype="uint8", job_id=job_id,
        )
        s.add(row)
        s.flush()
        return row.id


def test_orphaned_import_is_failed(handle):
    stuck = _add_map(handle, "importing", "job-dead")
    ready = _add_map(handle, "ready", "job-old")
    assert sweep_interrupted_imports(handle, _Runner()) == [stuck]
    with handle.session() as s:
        assert s.get(GeoMap, stuck).status == "failed"
        assert s.get(GeoMap, stuck).error == INTERRUPTED_IMPORT
        assert s.get(GeoMap, ready).status == "ready"


def test_import_this_process_owns_is_left_alone(handle):
    live = _add_map(handle, "importing", "job-live")
    assert sweep_interrupted_imports(handle, _Runner(live={"job-live"})) == []
    with handle.session() as s:
        assert s.get(GeoMap, live).status == "importing"


def test_paths(handle):
    assert map_dir(handle, "abc") == handle.folder / "maps" / "abc"
    assert map_raster_path(handle, "abc") == handle.folder / "maps" / "abc" / "map.tif"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_startup.py -q`
Expected: FAIL with `ImportError: cannot import name 'GeoMap'`.

- [ ] **Step 3: Add the ORM classes**

Append to `backend/app/db/models.py`:

```python
class GeoMap(Base):
    """A georeferenced raster the operator imported (spec 2026-09-22-geotiff-maps section 3)."""

    __tablename__ = "geo_map"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="importing")  # importing | ready | failed
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    source_path: Mapped[str] = mapped_column(String)  # absolute; only ever read
    source_size: Mapped[int] = mapped_column(Integer)
    source_sha256: Mapped[str] = mapped_column(String, default="")
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    band_count: Mapped[int] = mapped_column(Integer, default=0)
    dtype: Mapped[str] = mapped_column(String, default="")
    crs_wkt: Mapped[str | None] = mapped_column(String, nullable=True)
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    proj4: Mapped[str | None] = mapped_column(String, nullable=True)
    geotransform: Mapped[list | None] = mapped_column(JSON, nullable=True)  # GDAL order, 6 floats
    bounds_native: Mapped[list | None] = mapped_column(JSON, nullable=True)
    bounds_wgs84: Mapped[list | None] = mapped_column(JSON, nullable=True)
    gsd_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    stretch: Mapped[dict] = mapped_column(JSON, default=dict)
    labels_version: Mapped[int] = mapped_column(Integer, default=0)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class MapRun(Base):
    __tablename__ = "map_run"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("geo_map.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String)  # local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query: Mapped[str] = mapped_column(String, default="")
    tile_size: Mapped[int] = mapped_column(Integer, default=1280)
    overlap: Mapped[float] = mapped_column(Float, default=0.2)
    nms_iou: Mapped[float] = mapped_column(Float, default=0.5)
    conf: Mapped[float] = mapped_column(Float, default=0.25)
    target_gsd_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    counts: Mapped[dict] = mapped_column(JSON, default=dict)  # {class_id: n}
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_map_run_map", "map_id"),)


class MapDetection(Base):
    __tablename__ = "map_detection"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("map_run.id", ondelete="CASCADE"))
    class_id: Mapped[str] = mapped_column(String(36))
    confidence: Mapped[float] = mapped_column(Float)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    angle: Mapped[float | None] = mapped_column(Float, nullable=True)  # reserved for OBB wave 2
    __table_args__ = (Index("ix_map_detection_run_xy", "run_id", "x", "y"),)


class MapZone(Base):
    __tablename__ = "map_zone"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("geo_map.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    polygon: Mapped[list] = mapped_column(JSON)  # [[x, y], ...] in map pixels
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_map_zone_map", "map_id"),)


class MapLabel(Base):
    __tablename__ = "map_label"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("geo_map.id", ondelete="CASCADE"))
    class_id: Mapped[str] = mapped_column(String(36))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String, default="manual")  # manual | from_run:<id>
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_map_label_map", "map_id"),)
```

- [ ] **Step 4: Write the migration**

`backend/app/db/migrations/versions/0004_maps.py`:

```python
"""geotiff maps

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-22 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only new tables: nothing existing is rewritten, so this cannot fail on user data.
    op.create_table(
        "geo_map",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("source_path", sa.String(), nullable=False),
        sa.Column("source_size", sa.Integer(), nullable=False),
        sa.Column("source_sha256", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("band_count", sa.Integer(), nullable=False),
        sa.Column("dtype", sa.String(), nullable=False),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("proj4", sa.String(), nullable=True),
        sa.Column("geotransform", sa.JSON(), nullable=True),
        sa.Column("bounds_native", sa.JSON(), nullable=True),
        sa.Column("bounds_wgs84", sa.JSON(), nullable=True),
        sa.Column("gsd_cm", sa.Float(), nullable=True),
        sa.Column("stretch", sa.JSON(), nullable=False),
        sa.Column("labels_version", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "map_run",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("model_id", sa.String(36), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("model_name", sa.String(), nullable=True),
        sa.Column("query", sa.String(), nullable=False),
        sa.Column("tile_size", sa.Integer(), nullable=False),
        sa.Column("overlap", sa.Float(), nullable=False),
        sa.Column("nms_iou", sa.Float(), nullable=False),
        sa.Column("conf", sa.Float(), nullable=False),
        sa.Column("target_gsd_cm", sa.Float(), nullable=True),
        sa.Column("counts", sa.JSON(), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_map_run_map", "map_run", ["map_id"])
    op.create_table(
        "map_detection",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("map_run.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.String(36), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("angle", sa.Float(), nullable=True),
    )
    op.create_index("ix_map_detection_run_xy", "map_detection", ["run_id", "x", "y"])
    op.create_table(
        "map_zone",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("polygon", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_map_zone_map", "map_zone", ["map_id"])
    op.create_table(
        "map_label",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.String(36), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("angle", sa.Float(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_map_label_map", "map_label", ["map_id"])


def downgrade() -> None:
    for table in ("map_label", "map_zone", "map_detection", "map_run", "geo_map"):
        op.drop_table(table)
```

- [ ] **Step 5: Add the folder, the sweep and its wiring**

In `backend/app/projects/service.py` `ProjectHandle`, after `exports_dir`, add:
`maps_dir = property(lambda s: s.folder / "maps")`

`backend/app/maps/startup.py`:

```python
"""Where a map lives on disk, and the sweep for imports a crash cut short (spec section 3)."""

import logging
from pathlib import Path

from sqlalchemy import select

from app.db.models import GeoMap
from app.projects.service import ProjectHandle

INTERRUPTED_IMPORT = "import interrupted by application restart; import the file again"
log = logging.getLogger(__name__)


def map_dir(handle: ProjectHandle, map_id: str) -> Path:
    return handle.maps_dir / map_id


def map_raster_path(handle: ProjectHandle, map_id: str) -> Path:
    """The display raster: 8-bit RGB, 512 px blocks, internal overviews and mask."""
    return map_dir(handle, map_id) / "map.tif"


def sweep_interrupted_imports(handle: ProjectHandle, runner) -> list[str]:
    """Mark `importing` maps whose job this process does not hold as `failed`; returns their ids."""
    swept: list[str] = []
    with handle.session() as s:
        for row in s.execute(select(GeoMap).where(GeoMap.status == "importing")).scalars():
            if row.job_id and runner.is_live(row.job_id):
                continue
            row.status, row.error = "failed", INTERRUPTED_IMPORT
            swept.append(row.id)
    if swept:
        log.info("marked %d interrupted map import(s) failed in project %s", len(swept), handle.id)
    return swept
```

In `backend/app/main.py` `project_opened`:

- Add `from app.maps import startup as maps_startup` next to the other local imports.
- Add this tuple after the partial-export sweep:
  `("interrupted map import sweep", lambda: maps_startup.sweep_interrupted_imports(handle, runner)),`

- [ ] **Step 6: Add a migration round-trip test**

Append to `backend/tests/test_db.py` (it already opens project databases; reuse its imports):

```python
def test_maps_tables_exist_after_upgrade(tmp_path):
    from sqlalchemy import inspect

    from app.db.session import open_project_db

    engine = open_project_db(tmp_path)
    names = set(inspect(engine).get_table_names())
    assert {"geo_map", "map_run", "map_detection", "map_zone", "map_label"} <= names
```

- [ ] **Step 7: Run the tests**

Run: `cd backend; $PY -m pytest tests/test_maps_startup.py tests/test_db.py tests/test_job_startup.py -q`
Expected: all pass.

- [ ] **Step 8: Lint and commit**

Run: `cd backend; $PY -m ruff check .; $PY -m ruff format --check .`

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0004_maps.py backend/app/projects/service.py backend/app/maps/startup.py backend/app/main.py backend/tests/test_maps_startup.py backend/tests/test_db.py
git commit -m "feat(maps): map tables (migration 0004) and the interrupted-import sweep

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Raster and georeferencing modules, plus GeoTIFF test fixtures

**Files:**
- Create: `backend/tests/geotiffs.py` (fixture builders, imported by later test modules)
- Create: `backend/app/maps/raster.py`, `backend/app/maps/georef.py`
- Test: `backend/tests/test_maps_raster.py`, `backend/tests/test_maps_georef.py`

**Interfaces:**
- Consumes: rasterio and pyproj from Task 1.
- Produces:
  - `tests/geotiffs.py`: `make_geotiff(path, width, height, *, count=3, dtype="uint8", crs="EPSG:32633", pixel=0.03, origin=(500000.0, 4983000.0), rotation=0.0, nodata=None, alpha_border=0.0, seed=0) -> Path`. Pass `crs=None` for a plain TIFF with no coordinates.
  - `raster.RasterInfo(width, height, band_count, dtype, crs_wkt, epsg, proj4, geotransform)`.
  - `raster.inspect_raster(path) -> RasterInfo`.
  - `raster.Stretch(bands, lo, hi)` with `.to_dict()` and `Stretch.from_dict(d)`.
  - `raster.compute_stretch(src) -> Stretch`.
  - `raster.apply_stretch(data, stretch) -> np.ndarray[uint8]`.
  - `raster.overview_factors(width, height) -> list[int]`.
  - `raster.write_display_raster(src_path, dst_path, stretch, *, progress, check_cancelled, block=2048) -> None`.
  - `raster.read_rgb(src, x, y, w, h, out_w, out_h) -> tuple[np.ndarray (out_h,out_w,3) uint8, np.ndarray (out_h,out_w) bool]`.
  - `raster.low_res_mask(src, max_side=2048) -> tuple[np.ndarray bool, float]`, where the float is mask pixels per map pixel.
  - `raster.write_preview(src, dst_path, max_side=1024) -> None`.
  - `georef.Georef(geotransform, crs_wkt)` with these methods:
    - `.pixel_to_native(px, py)`
    - `.native_to_wgs84(xs, ys)`
    - `.pixel_to_wgs84(px, py)`
    - `.bounds_native(w, h)`
    - `.bounds_wgs84(w, h)`
    - `.gsd_cm(w, h)`
    - `.metres_per_pixel(w, h)`
  - `georef.box_corners(x, y, w, h, angle=None) -> list[tuple[float, float]]`: 4 corners, top-left first, clockwise.

- [ ] **Step 1: Write the fixture builders**

`backend/tests/geotiffs.py`:

```python
"""Small synthetic GeoTIFFs, generated at test time (nothing binary is committed)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import ColorInterp


def make_geotiff(
    path: Path,
    width: int,
    height: int,
    *,
    count: int = 3,
    dtype: str = "uint8",
    crs: str | None = "EPSG:32633",
    pixel: float = 0.03,
    origin: tuple[float, float] = (500000.0, 4983000.0),
    rotation: float = 0.0,
    nodata: float | None = None,
    alpha_border: float = 0.0,
    seed: int = 0,
) -> Path:
    """Seeded noise. `alpha_border` masks that fraction of the width on each side through a 4th
    alpha band; `nodata` zeroes the same border and declares it nodata instead."""
    rng = np.random.default_rng(seed)
    top = 255 if dtype == "uint8" else 4000
    data = rng.integers(1, top, size=(count, height, width)).astype(dtype)
    border = int(width * alpha_border)
    if nodata is not None and border:
        data[:, :, :border] = nodata
        data[:, :, width - border :] = nodata
    transform = (
        Affine.translation(*origin) * Affine.rotation(rotation) * Affine.scale(pixel, -pixel)
        if crs
        else Affine.identity()
    )
    bands = count + (1 if alpha_border and nodata is None else 0)
    profile = dict(driver="GTiff", width=width, height=height, count=bands, dtype=dtype, transform=transform)
    if crs:
        profile["crs"] = crs
    if nodata is not None:
        profile["nodata"] = nodata
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, indexes=list(range(1, count + 1)))
        if bands > count:
            alpha = np.full((height, width), top, dtype=dtype)
            alpha[:, :border] = 0
            alpha[:, width - border :] = 0
            dst.write(alpha, bands)
            dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
    return path
```

- [ ] **Step 2: Write the failing georef tests**

`backend/tests/test_maps_georef.py`:

```python
import math

import pytest
from pyproj import CRS, Transformer
from rasterio.transform import Affine

from app.maps.georef import Georef, box_corners

UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)


def test_pixel_to_native_uses_the_affine():
    g = Georef(GT, UTM33)
    assert g.pixel_to_native(0, 0) == pytest.approx((500000.0, 4983000.0))
    assert g.pixel_to_native(100, 200) == pytest.approx((500003.0, 4982994.0))


def test_wgs84_matches_an_independent_transformer():
    g = Georef(GT, UTM33)
    ref = Transformer.from_crs("EPSG:32633", "EPSG:4326", always_xy=True)
    lon, lat = g.pixel_to_wgs84(1000, 2000)
    assert (lon, lat) == pytest.approx(ref.transform(500030.0, 4982940.0), abs=1e-9)
    assert lon == pytest.approx(15.000384, abs=1e-5)  # just east of the 15° central meridian


def test_rotated_geotransform():
    t = Affine.translation(500000, 4983000) * Affine.rotation(30) * Affine.scale(0.03, -0.03)
    g = Georef(t.to_gdal(), UTM33)
    x, y = g.pixel_to_native(100, 0)
    assert x == pytest.approx(500000 + 3 * math.cos(math.radians(30)))
    assert y == pytest.approx(4983000 + 3 * math.sin(math.radians(30)))
    assert g.gsd_cm(1000, 1000) == pytest.approx(3.0)


def test_gsd_projected_and_geographic():
    assert Georef(GT, UTM33).gsd_cm(100, 100) == pytest.approx(3.0)
    geo = Georef((15.0, 1e-6, 0.0, 45.0, 0.0, -1e-6), CRS.from_epsg(4326).to_wkt())
    assert geo.gsd_cm(100, 100) == pytest.approx(9.33, abs=0.05)


def test_bounds():
    g = Georef(GT, UTM33)
    assert g.bounds_native(1000, 500) == pytest.approx([500000, 4982985, 500030, 4983000])
    west, south, east, north = g.bounds_wgs84(1000, 500)
    assert west < east and south < north and 14.99 < west < 15.01


def test_box_corners_axis_aligned_and_rotated():
    assert box_corners(10, 20, 4, 2) == [(10, 20), (14, 20), (14, 22), (10, 22)]
    rotated = box_corners(0, 0, 2, 2, angle=90)
    assert [tuple(round(v, 9) for v in p) for p in rotated] == [(2, 0), (2, 2), (0, 2), (0, 0)]
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_georef.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.maps.georef'`.

- [ ] **Step 4: Implement `georef.py`**

`backend/app/maps/georef.py`:

```python
"""Map pixels to the map's CRS and to WGS84 (spec sections 9 and 3).

Pixel (px, py) has its origin at the top-left corner of the top-left pixel, y down, exactly as the
GDAL geotransform expects, so a box stored in map pixels converts through the full affine,
rotation terms included.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from affine import Affine
from pyproj import CRS, Transformer

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON_EQUATOR = 111_320.0
EDGE_SAMPLES = 21  # points per edge when projecting the bounds: edges curve in WGS84


class Georef:
    def __init__(self, geotransform: Sequence[float], crs_wkt: str):
        self.affine = Affine.from_gdal(*geotransform)
        self.crs = CRS.from_wkt(crs_wkt)
        self._to_wgs84 = Transformer.from_crs(self.crs, CRS.from_epsg(4326), always_xy=True)

    def pixel_to_native(self, px: float, py: float) -> tuple[float, float]:
        x, y = self.affine * (px, py)
        return float(x), float(y)

    def native_to_wgs84(self, xs, ys):
        return self._to_wgs84.transform(xs, ys)

    def pixel_to_wgs84(self, px: float, py: float) -> tuple[float, float]:
        lon, lat = self.native_to_wgs84(*self.pixel_to_native(px, py))
        return float(lon), float(lat)

    def _edge_pixels(self, width: int, height: int) -> list[tuple[float, float]]:
        pts: list[tuple[float, float]] = []
        for i in range(EDGE_SAMPLES):
            t = i / (EDGE_SAMPLES - 1)
            pts += [(t * width, 0), (t * width, height), (0, t * height), (width, t * height)]
        return pts

    def bounds_native(self, width: int, height: int) -> list[float]:
        xs, ys = zip(*(self.pixel_to_native(px, py) for px, py in self._edge_pixels(width, height)), strict=True)
        return [min(xs), min(ys), max(xs), max(ys)]

    def bounds_wgs84(self, width: int, height: int) -> list[float]:
        native = [self.pixel_to_native(px, py) for px, py in self._edge_pixels(width, height)]
        lons, lats = self.native_to_wgs84([p[0] for p in native], [p[1] for p in native])
        return [float(min(lons)), float(min(lats)), float(max(lons)), float(max(lats))]

    def metres_per_pixel(self, width: int, height: int) -> float:
        a = self.affine
        area = abs(a.a * a.e - a.b * a.d)  # one pixel's area in CRS units squared
        if self.crs.is_geographic:
            _, lat = self.pixel_to_native(width / 2, height / 2)
            m_lon = M_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat))
            return math.sqrt(area * m_lon * M_PER_DEG_LAT)
        factor = self.crs.axis_info[0].unit_conversion_factor if self.crs.axis_info else 1.0
        return math.sqrt(area) * factor

    def gsd_cm(self, width: int, height: int) -> float:
        return self.metres_per_pixel(width, height) * 100.0


def box_corners(x: float, y: float, w: float, h: float, angle: float | None = None) -> list[tuple[float, float]]:
    """The box's corners in map pixels: top-left first, clockwise; rotated about the centre."""
    corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    if not angle:
        return corners
    cx, cy = x + w / 2, y + h / 2
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return [(cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c) for px, py in corners]
```

- [ ] **Step 5: Run the georef tests**

Run: `cd backend; $PY -m pytest tests/test_maps_georef.py -q`
Expected: `6 passed`.

If the `lon` literal in `test_wgs84_matches_an_independent_transformer` is off, print the
reference value and correct the literal. The independent-transformer assertion is the real
check; do not change it.

- [ ] **Step 6: Write the failing raster tests**

`backend/tests/test_maps_raster.py`:

```python
import numpy as np
import pytest
import rasterio
from geotiffs import make_geotiff

from app.jobs.cancellation import JobCancelled
from app.maps import raster


def _noop(*_a, **_k):
    return None


def test_inspect_utm(tmp_path):
    info = raster.inspect_raster(make_geotiff(tmp_path / "a.tif", 300, 200))
    assert (info.width, info.height, info.band_count, info.dtype) == (300, 200, 3, "uint8")
    assert info.epsg == 32633 and "+proj=utm" in info.proj4
    assert info.geotransform == pytest.approx((500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03))


def test_inspect_without_coordinates(tmp_path):
    info = raster.inspect_raster(make_geotiff(tmp_path / "plain.tif", 64, 64, crs=None))
    assert info.crs_wkt is None and info.epsg is None and info.geotransform is None


def test_inspect_rejects_a_non_raster(tmp_path):
    bad = tmp_path / "bad.tif"
    bad.write_text("not a tiff")
    with pytest.raises(raster.RasterError, match="not a readable raster"):
        raster.inspect_raster(bad)


def test_stretch_uint8_is_identity_and_uint16_uses_percentiles(tmp_path):
    with rasterio.open(make_geotiff(tmp_path / "a.tif", 64, 64)) as src:
        s = raster.compute_stretch(src)
    assert s.bands == (1, 2, 3) and s.lo == (0.0, 0.0, 0.0) and s.hi == (255.0, 255.0, 255.0)
    with rasterio.open(make_geotiff(tmp_path / "b.tif", 64, 64, count=4, dtype="uint16")) as src:
        s16 = raster.compute_stretch(src)
    assert s16.bands == (1, 2, 3)
    assert all(0 < lo < hi < 4000 for lo, hi in zip(s16.lo, s16.hi, strict=True))
    assert raster.Stretch.from_dict(s16.to_dict()) == s16


def test_apply_stretch_clips_to_uint8():
    s = raster.Stretch((1, 2, 3), (100.0, 100.0, 100.0), (200.0, 200.0, 200.0))
    data = np.array([[[50, 150, 250]]] * 3, dtype=np.uint16)
    assert raster.apply_stretch(data, s)[0, 0].tolist() == [0, 127, 255]


def test_overview_factors():
    assert raster.overview_factors(200, 100) == []
    assert raster.overview_factors(2048, 1000) == [2, 4, 8]


def test_write_display_raster_is_tiled_with_overviews_and_mask(tmp_path):
    src = make_geotiff(tmp_path / "a.tif", 2100, 1100, alpha_border=0.1)
    dst = tmp_path / "out" / "map.tif"
    dst.parent.mkdir()
    seen = []
    with rasterio.open(src) as s:
        stretch = raster.compute_stretch(s)
    raster.write_display_raster(src, dst, stretch, progress=lambda f, m: seen.append(f), check_cancelled=_noop)
    with rasterio.open(dst) as out:
        assert (out.width, out.height, out.count, out.dtypes[0]) == (2100, 1100, 3, "uint8")
        assert out.block_shapes[0] == (512, 512)
        assert out.overviews(1) == [2, 4, 8]
        assert out.crs.to_epsg() == 32633
        rgb, valid = raster.read_rgb(out, 0, 0, 2100, 1100, 210, 110)
    assert rgb.shape == (110, 210, 3) and valid.shape == (110, 210)
    assert not valid[:, :15].any() and valid[:, 30:180].all()  # the 10 % alpha border is masked
    assert seen and seen == sorted(seen)
    assert not (tmp_path / "out" / "map.tif.partial").exists()


def test_write_display_raster_cancel_leaves_nothing(tmp_path):
    src = make_geotiff(tmp_path / "a.tif", 2100, 1100)
    dst = tmp_path / "map.tif"

    def cancel():
        raise JobCancelled()

    with rasterio.open(src) as s:
        stretch = raster.compute_stretch(s)
    with pytest.raises(JobCancelled):
        raster.write_display_raster(src, dst, stretch, progress=_noop, check_cancelled=cancel)
    assert not dst.exists() and not (tmp_path / "map.tif.partial").exists()


def test_low_res_mask_is_bounded(tmp_path):
    with rasterio.open(make_geotiff(tmp_path / "a.tif", 3000, 1000, alpha_border=0.1)) as src:
        mask, scale = raster.low_res_mask(src, max_side=300)
    assert mask.shape == (100, 300) and scale == pytest.approx(0.1)
    assert not mask[:, :25].any() and mask[:, 40:260].all()


def test_preview(tmp_path):
    from PIL import Image

    with rasterio.open(make_geotiff(tmp_path / "a.tif", 3000, 1000)) as src:
        raster.write_preview(src, tmp_path / "p.jpg", max_side=300)
    with Image.open(tmp_path / "p.jpg") as im:
        assert im.size == (300, 100)
```

Add `backend/tests/conftest.py`'s folder to the import path for `geotiffs`: pytest already puts
`tests/` on `sys.path` (see how `local_paths` and `fakes` are imported), so no change is needed.

- [ ] **Step 7: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_raster.py -q`
Expected: FAIL with `ImportError: cannot import name 'raster'`.

- [ ] **Step 8: Implement `raster.py`**

`backend/app/maps/raster.py`:

```python
"""Everything that touches raster pixels, through rasterio (spec sections 4, 5 and 6).

Every read here is bounded: a window, or a decimated read of the whole extent whose longest side
is capped. GDAL serves decimated reads from the overviews, so their cost does not grow with the map.
"""

from __future__ import annotations

import os
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image as PILImage
from rasterio.enums import ColorInterp, Resampling
from rasterio.errors import NotGeoreferencedWarning, RasterioIOError
from rasterio.windows import Window

BLOCK = 512  # internal tile size of the display raster; JPEG-in-TIFF needs a multiple of 16
MIN_OVERVIEW_SIDE = 256
STATS_SIDE = 1024
PERCENTILES = (2.0, 98.0)
JPEG_QUALITY = 90


class RasterError(Exception):
    """The file cannot be used as a map; the message is written for the operator."""


@dataclass(frozen=True)
class RasterInfo:
    width: int
    height: int
    band_count: int
    dtype: str
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    geotransform: tuple[float, ...] | None


@dataclass(frozen=True)
class Stretch:
    bands: tuple[int, int, int]
    lo: tuple[float, float, float]
    hi: tuple[float, float, float]

    def to_dict(self) -> dict:
        return {"bands": list(self.bands), "lo": list(self.lo), "hi": list(self.hi)}

    @classmethod
    def from_dict(cls, d: dict) -> Stretch:
        return cls(tuple(d["bands"]), tuple(float(v) for v in d["lo"]), tuple(float(v) for v in d["hi"]))


def inspect_raster(path: Path) -> RasterInfo:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            with rasterio.open(path) as src:
                georeferenced = src.crs is not None and not src.transform.is_identity
                crs_wkt = src.crs.to_wkt() if georeferenced else None
                epsg = src.crs.to_epsg() if georeferenced else None
                geotransform = tuple(src.transform.to_gdal()) if georeferenced else None
                info = (src.width, src.height, src.count, src.dtypes[0])
    except RasterioIOError as e:
        raise RasterError(f"{Path(path).name} is not a readable raster ({e})") from None
    proj4 = None
    if crs_wkt:
        from pyproj import CRS

        proj4 = CRS.from_wkt(crs_wkt).to_proj4()
    return RasterInfo(*info, crs_wkt=crs_wkt, epsg=epsg, proj4=proj4, geotransform=geotransform)


def _rgb_bands(src) -> tuple[int, int, int]:
    interp = list(src.colorinterp)
    wanted = [ColorInterp.red, ColorInterp.green, ColorInterp.blue]
    if all(c in interp for c in wanted):
        return tuple(interp.index(c) + 1 for c in wanted)
    if src.count >= 3:
        return (1, 2, 3)
    return (1, 1, 1)


def _decimated_shape(src, max_side: int) -> tuple[int, int, float]:
    scale = min(1.0, max_side / max(src.width, src.height))
    return max(1, round(src.height * scale)), max(1, round(src.width * scale)), scale


def compute_stretch(src) -> Stretch:
    """8-bit sources pass through; anything else maps its 2nd-98th percentile per band to 0-255."""
    bands = _rgb_bands(src)
    if all(src.dtypes[b - 1] == "uint8" for b in bands):
        return Stretch(bands, (0.0, 0.0, 0.0), (255.0, 255.0, 255.0))
    h, w, _ = _decimated_shape(src, STATS_SIDE)
    unique = sorted(set(bands))
    data = src.read(unique, out_shape=(len(unique), h, w), resampling=Resampling.nearest)
    valid = src.dataset_mask(out_shape=(h, w)) > 0
    per_band: dict[int, tuple[float, float]] = {}
    for i, b in enumerate(unique):
        values = data[i][valid] if valid.any() else data[i].ravel()
        lo, hi = np.percentile(values, PERCENTILES)
        per_band[b] = (float(lo), float(hi) if hi > lo else float(lo) + 1.0)
    return Stretch(bands, tuple(per_band[b][0] for b in bands), tuple(per_band[b][1] for b in bands))


def apply_stretch(data: np.ndarray, stretch: Stretch) -> np.ndarray:
    """(3, h, w) of any dtype to (3, h, w) uint8."""
    lo = np.array(stretch.lo, dtype=np.float32).reshape(3, 1, 1)
    hi = np.array(stretch.hi, dtype=np.float32).reshape(3, 1, 1)
    scaled = (data.astype(np.float32) - lo) * (255.0 / (hi - lo))
    return np.clip(scaled, 0, 255).astype(np.uint8)


def overview_factors(width: int, height: int) -> list[int]:
    factors, f = [], 2
    while max(width, height) / f >= MIN_OVERVIEW_SIDE:
        factors.append(f)
        f *= 2
    return factors


def write_display_raster(
    src_path: Path,
    dst_path: Path,
    stretch: Stretch,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
    block: int = 2048,
) -> None:
    """The display raster, block by block: 8-bit RGB, JPEG/YCbCr in 512 px tiles, internal mask,
    internal overviews. Written to `<dst>.partial` and renamed only when complete."""
    assert block % BLOCK == 0, "blocks must align with the internal tiles, or JPEG tiles are re-encoded"
    partial = dst_path.with_name(dst_path.name + ".partial")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True), rasterio.open(src_path) as src:
                profile = dict(
                    driver="GTiff", width=src.width, height=src.height, count=3, dtype="uint8",
                    tiled=True, blockxsize=BLOCK, blockysize=BLOCK, compress="JPEG",
                    photometric="YCBCR", jpeg_quality=JPEG_QUALITY, bigtiff="IF_SAFER",
                )
                if src.crs is not None and not src.transform.is_identity:
                    profile.update(crs=src.crs, transform=src.transform)
                cells = [(r, c) for r in range(0, src.height, block) for c in range(0, src.width, block)]
                with rasterio.open(partial, "w", **profile) as dst:
                    for i, (row, col) in enumerate(cells, start=1):
                        check_cancelled()
                        win = Window(col, row, min(block, src.width - col), min(block, src.height - row))
                        data = src.read(list(stretch.bands), window=win)
                        dst.write(apply_stretch(data, stretch), window=win)
                        dst.write_mask(src.dataset_mask(window=win), window=win)
                        progress(0.85 * i / len(cells), f"block {i} / {len(cells)}")
            factors = overview_factors(profile["width"], profile["height"])
            if factors:
                progress(0.87, "building zoom levels")
                check_cancelled()
                env = dict(
                    GDAL_TIFF_INTERNAL_MASK=True, COMPRESS_OVERVIEW="JPEG", PHOTOMETRIC_OVERVIEW="YCBCR",
                    INTERLEAVE_OVERVIEW="PIXEL", JPEG_QUALITY_OVERVIEW=JPEG_QUALITY,
                )
                with rasterio.Env(**env), rasterio.open(partial, "r+") as dst:
                    dst.build_overviews(factors, Resampling.average)
        os.replace(partial, dst_path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def read_rgb(src, x: int, y: int, w: int, h: int, out_w: int, out_h: int) -> tuple[np.ndarray, np.ndarray]:
    """One window of the display raster as (out_h, out_w, 3) uint8 plus a validity mask."""
    win = Window(x, y, w, h)
    data = src.read([1, 2, 3], window=win, out_shape=(3, out_h, out_w), resampling=Resampling.bilinear)
    valid = src.dataset_mask(window=win, out_shape=(out_h, out_w)) > 0
    return np.moveaxis(data, 0, -1), valid


def low_res_mask(src, max_side: int = 2048) -> tuple[np.ndarray, float]:
    h, w, scale = _decimated_shape(src, max_side)
    return src.dataset_mask(out_shape=(h, w)) > 0, scale


def write_preview(src, dst_path: Path, max_side: int = 1024) -> None:
    h, w, _ = _decimated_shape(src, max_side)
    rgb, valid = read_rgb(src, 0, 0, src.width, src.height, w, h)
    rgb = rgb.copy()
    rgb[~valid] = 128
    PILImage.fromarray(rgb, "RGB").save(dst_path, "JPEG", quality=85)
```

- [ ] **Step 9: Run the raster tests**

Run: `cd backend; $PY -m pytest tests/test_maps_raster.py -q`
Expected: all pass.

If `out.block_shapes` reports `(512, 512)` for the mask band but a different value for the data,
the profile is wrong: fix it, don't relax the test. If the alpha fixture is not detected as a
mask, check `src.dataset_mask()` on the source in a REPL. It must honour an alpha band, so the
fixture's `colorinterp` must say alpha.

- [ ] **Step 10: Lint and commit**

Run: `cd backend; $PY -m ruff check .; $PY -m ruff format --check .`

```bash
git add backend/tests/geotiffs.py backend/app/maps/raster.py backend/app/maps/georef.py backend/tests/test_maps_raster.py backend/tests/test_maps_georef.py
git commit -m "feat(maps): raster reads/writes and georeferencing, with synthetic GeoTIFF fixtures

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: Import job, map CRUD, preview and tiles

**Files:**
- Create: `backend/app/maps/schemas.py`, `backend/app/maps/service.py`, `backend/app/maps/tiles.py`, `backend/app/maps/jobs_import.py`
- Modify: `backend/app/maps/router.py`, `backend/tests/test_contract.py`
- Test: `backend/tests/test_maps_tiles.py`, `backend/tests/test_maps_import.py`

**Interfaces:**
- Consumes: Task 3 (`GeoMap`, `map_dir`, `map_raster_path`) and Task 4 (`raster.*`, `Georef`, `make_geotiff`).
- Produces:
  - `tiles.TILE = 256`
  - `tiles.max_zoom(width, height) -> int`
  - `tiles.tile_window(z, x, y, width, height, mz) -> TileWindow | None`
  - `tiles.render_tile(src, width, height, z, x, y) -> tuple[bytes, str] | None` (bytes and media type)
  - `tiles.TILE_CACHE: TileCache` with `get(key)`, `put(key, value)` and `drop_map(map_id)`
  - `service.create_map(handle, body) -> GeoMap`
  - `service.list_maps(handle) -> list[GeoMap]`
  - `service.get_map(handle, map_id) -> GeoMap` (404 if unknown)
  - `service.require_ready(handle, map_id) -> GeoMap` (409 unless `ready`)
  - `service.set_map_job(handle, map_id, job_id) -> GeoMap`
  - `service.delete_map(handle, map_id, is_live: Callable[[str], bool]) -> None`
  - `service.bump_labels_version(s, map_id) -> None` (used by Task 8)
  - `schemas.GeoMapOut.from_row(row)`, `schemas.GeoMapCreate`, `schemas.GeoMapWithJob`, `schemas.GeoMapList`
  - job type `map_import` with params `{"map_id": str}`
  - event `maps.changed` with payload `{"map_ids": [id]}`

- [ ] **Step 1: Write the failing tile-maths tests**

`backend/tests/test_maps_tiles.py`:

```python
import io

import numpy as np
import rasterio
from geotiffs import make_geotiff
from PIL import Image

from app.maps import raster, tiles


def _display(tmp_path, w, h, **kw):
    src = make_geotiff(tmp_path / "src.tif", w, h, **kw)
    dst = tmp_path / "map.tif"
    with rasterio.open(src) as s:
        stretch = raster.compute_stretch(s)
    raster.write_display_raster(src, dst, stretch, progress=lambda *a: None, check_cancelled=lambda: None)
    return dst


def test_max_zoom():
    assert tiles.max_zoom(200, 100) == 0
    assert tiles.max_zoom(257, 10) == 1
    assert tiles.max_zoom(80000, 60000) == 9


def test_tile_window():
    mz = tiles.max_zoom(1000, 600)  # 2
    assert tiles.tile_window(2, 0, 0, 1000, 600, mz) == tiles.TileWindow(0, 0, 256, 256, 256, 256)
    edge = tiles.tile_window(2, 3, 2, 1000, 600, mz)  # x0 768, y0 512
    assert edge == tiles.TileWindow(768, 512, 232, 88, 232, 88)
    assert tiles.tile_window(0, 0, 0, 1000, 600, mz) == tiles.TileWindow(0, 0, 1000, 600, 250, 150)
    assert tiles.tile_window(2, 4, 0, 1000, 600, mz) is None  # past the right edge
    assert tiles.tile_window(3, 0, 0, 1000, 600, mz) is None  # deeper than full resolution


def test_full_resolution_tile_matches_a_direct_read(tmp_path):
    path = _display(tmp_path, 1000, 600)
    with rasterio.open(path) as src:
        body, media = tiles.render_tile(src, 1000, 600, 2, 1, 1)
        direct, _ = raster.read_rgb(src, 256, 256, 256, 256, 256, 256)
    assert media == "image/jpeg"
    decoded = np.asarray(Image.open(io.BytesIO(body)).convert("RGB")).astype(int)
    assert np.abs(decoded - direct.astype(int)).mean() < 8  # JPEG on JPEG, same pixels


def test_edge_and_masked_tiles_are_png_and_empty_ones_are_none(tmp_path):
    path = _display(tmp_path, 1000, 600, alpha_border=0.3)
    with rasterio.open(path) as src:
        # x 512-768 by y 512-600: valid up to x 700, masked border after, raster ends at y 600
        body, media = tiles.render_tile(src, 1000, 600, 2, 2, 2)
        assert media == "image/png"
        im = Image.open(io.BytesIO(body))
        assert im.mode == "RGBA" and im.size == (256, 256)
        assert im.getpixel((250, 250))[3] == 0  # outside the raster: transparent
        assert tiles.render_tile(src, 1000, 600, 2, 0, 0) is None  # inside the masked border


def test_reads_are_bounded(tmp_path, monkeypatch):
    path = _display(tmp_path, 3000, 2000)
    shapes = []
    real = raster.read_rgb

    def spy(src, x, y, w, h, out_w, out_h):
        shapes.append((out_w, out_h))
        return real(src, x, y, w, h, out_w, out_h)

    monkeypatch.setattr(tiles.raster, "read_rgb", spy)
    with rasterio.open(path) as src:
        for z in range(tiles.max_zoom(3000, 2000) + 1):
            tiles.render_tile(src, 3000, 2000, z, 0, 0)
    assert shapes and all(w <= 256 and h <= 256 for w, h in shapes)


def test_cache_is_lru_and_drops_a_map():
    cache = tiles.TileCache(max_items=2)
    cache.put(("p", "m1", 0, 0, 0), (b"a", "image/jpeg"))
    cache.put(("p", "m2", 0, 0, 0), (b"b", "image/jpeg"))
    cache.get(("p", "m1", 0, 0, 0))
    cache.put(("p", "m3", 0, 0, 0), (b"c", "image/jpeg"))
    assert cache.get(("p", "m2", 0, 0, 0)) is None
    cache.drop_map("m1")
    assert cache.get(("p", "m1", 0, 0, 0)) is None
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_tiles.py -q`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Implement `tiles.py`**

`backend/app/maps/tiles.py`:

```python
"""256 px tiles in the map's pixel grid (spec section 5).

At zoom z one tile pixel covers 2^(max_zoom - z) map pixels; z = max_zoom is full resolution and
z = 0 fits the whole map in one tile. Each tile is one windowed read whose output is at most
256 x 256, which GDAL serves from the matching overview, so a tile costs the same on any map.
"""

from __future__ import annotations

import io
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np
from PIL import Image as PILImage

from app.maps import raster

TILE = 256
JPEG_QUALITY = 85
CACHE_ITEMS = 512


@dataclass(frozen=True)
class TileWindow:
    x: int
    y: int
    w: int
    h: int
    out_w: int
    out_h: int


def max_zoom(width: int, height: int) -> int:
    return max(0, math.ceil(math.log2(max(width, height) / TILE))) if max(width, height) > TILE else 0


def tile_window(z: int, x: int, y: int, width: int, height: int, mz: int) -> TileWindow | None:
    if z > mz:
        return None
    res = 2 ** (mz - z)
    size = TILE * res
    x0, y0 = x * size, y * size
    if x0 >= width or y0 >= height:
        return None
    w, h = min(size, width - x0), min(size, height - y0)
    return TileWindow(x0, y0, w, h, max(1, round(w / res)), max(1, round(h / res)))


def render_tile(src, width: int, height: int, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    win = tile_window(z, x, y, width, height, max_zoom(width, height))
    if win is None:
        return None
    rgb, valid = raster.read_rgb(src, win.x, win.y, win.w, win.h, win.out_w, win.out_h)
    if not valid.any():
        return None
    buf = io.BytesIO()
    if valid.all() and (win.out_w, win.out_h) == (TILE, TILE):
        PILImage.fromarray(rgb, "RGB").save(buf, "JPEG", quality=JPEG_QUALITY)
        return buf.getvalue(), "image/jpeg"
    canvas = np.zeros((TILE, TILE, 4), dtype=np.uint8)
    canvas[: win.out_h, : win.out_w, :3] = rgb
    canvas[: win.out_h, : win.out_w, 3] = np.where(valid, 255, 0)
    PILImage.fromarray(canvas, "RGBA").save(buf, "PNG", optimize=False)
    return buf.getvalue(), "image/png"


class TileCache:
    """Recently served tiles; a map's display raster never changes, so entries never go stale."""

    def __init__(self, max_items: int = CACHE_ITEMS):
        self.max_items = max_items
        self._items: OrderedDict[tuple, tuple[bytes, str] | None] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple):
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, key: tuple, value) -> None:
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)

    def drop_map(self, map_id: str) -> None:
        with self._lock:
            for key in [k for k in self._items if k[1] == map_id]:
                del self._items[key]


TILE_CACHE = TileCache()
```

`get` returns `None` both on a miss and for a cached empty tile. The router caches only non-empty
tiles, so the ambiguity never matters.

- [ ] **Step 4: Run the tile tests**

Run: `cd backend; $PY -m pytest tests/test_maps_tiles.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Write the failing import/API tests**

`backend/tests/test_maps_import.py`:

```python
"""Import a GeoTIFF through the API, then read its metadata, preview and tiles (spec 4 and 5)."""

import pytest
from geotiffs import make_geotiff

BASE = "/api/v1/projects"


@pytest.fixture
def import_map(client, wait_job):
    def _import(project_id, path, **body):
        r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path), **body})
        assert r.status_code == 202, r.text
        job = wait_job(project_id, r.json()["job"]["id"])
        return r.json()["map"]["id"], job

    return _import


def test_import_utm_map(client, project_id, import_map, tmp_path, handle):
    src = make_geotiff(tmp_path / "site.tif", 1200, 700)
    map_id, job = import_map(project_id, src, name="Site")
    assert job["state"] == "succeeded", job
    m = client.get(f"{BASE}/{project_id}/maps/{map_id}").json()
    assert m["status"] == "ready" and m["name"] == "Site"
    assert (m["width"], m["height"], m["epsg"]) == (1200, 700, 32633)
    assert m["gsd_cm"] == pytest.approx(3.0)
    assert m["tile_grid"] == {"tile_size": 256, "max_zoom": 3}
    assert m["bounds_native"] == pytest.approx([500000, 4982979, 500036, 4983000])
    assert (handle.folder / "maps" / map_id / "map.tif").is_file()
    assert src.is_file()  # the source is only ever read
    items = client.get(f"{BASE}/{project_id}/maps").json()["items"]
    assert [i["id"] for i in items] == [map_id]


def test_preview_and_tiles(client, project_id, import_map, tmp_path):
    map_id, _ = import_map(project_id, make_geotiff(tmp_path / "a.tif", 1200, 700))
    r = client.get(f"{BASE}/{project_id}/maps/{map_id}/preview")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    t = client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/3/0/0")
    assert t.status_code == 200 and t.headers["content-type"] == "image/jpeg"
    assert "immutable" in t.headers["cache-control"]
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/3/40/40").status_code == 204
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/0/0/0").headers["content-type"] == "image/png"


def test_map_without_coordinates(client, project_id, import_map, tmp_path):
    map_id, job = import_map(project_id, make_geotiff(tmp_path / "plain.tif", 300, 300, crs=None))
    assert job["state"] == "succeeded"
    m = client.get(f"{BASE}/{project_id}/maps/{map_id}").json()
    assert m["crs_wkt"] is None and m["gsd_cm"] is None and m["bounds_wgs84"] is None


def test_unreadable_file_fails_the_map_with_a_reason(client, project_id, import_map, tmp_path, handle):
    bad = tmp_path / "bad.tif"
    bad.write_text("nope")
    map_id, job = import_map(project_id, bad)
    assert job["state"] == "failed" and "not a readable raster" in job["error"]
    m = client.get(f"{BASE}/{project_id}/maps/{map_id}").json()
    assert m["status"] == "failed" and "not a readable raster" in m["error"]
    assert not (handle.folder / "maps" / map_id).exists()


def test_missing_or_wrong_file_is_422(client, project_id, tmp_path):
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(tmp_path / "nope.tif")})
    assert r.status_code == 422
    (tmp_path / "x.png").write_bytes(b"x")
    assert client.post(f"{BASE}/{project_id}/maps", json={"path": str(tmp_path / "x.png")}).status_code == 422


def test_tiles_of_a_map_that_is_not_ready_are_409(client, project_id, handle):
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name="m", status="importing", source_path="x", source_size=1, width=10, height=10)
        s.add(row)
        s.flush()
        map_id = row.id
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/0/0/0").status_code == 409


def test_delete_removes_the_folder(client, project_id, import_map, tmp_path, handle):
    map_id, _ = import_map(project_id, make_geotiff(tmp_path / "a.tif", 300, 300))
    assert client.delete(f"{BASE}/{project_id}/maps/{map_id}").status_code == 204
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}").status_code == 404
    assert not (handle.folder / "maps" / map_id).exists()
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_import.py -q`
Expected: FAIL. The routes answer 501.

- [ ] **Step 7: Implement the schemas for maps**

`backend/app/maps/schemas.py` (Tasks 7, 8 and 9 append to this file):

```python
"""Pydantic models for GeoTIFF maps, matching contract/openapi.yaml exactly."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.db.models import GeoMap
from app.jobs.schemas import JobOut
from app.maps.tiles import TILE, max_zoom


class TileGrid(BaseModel):
    tile_size: Literal[256] = TILE
    max_zoom: int


class GeoMapOut(BaseModel):
    id: str
    name: str
    status: Literal["importing", "ready", "failed"]
    error: str | None
    source_path: str
    source_size: int
    width: int
    height: int
    band_count: int
    dtype: str
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    geotransform: list[float] | None
    bounds_native: list[float] | None
    bounds_wgs84: list[float] | None
    gsd_cm: float | None
    tile_grid: TileGrid
    labels_version: int
    job_id: str | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: GeoMap) -> GeoMapOut:
        return cls(
            id=row.id, name=row.name, status=row.status, error=row.error, source_path=row.source_path,
            source_size=row.source_size, width=row.width, height=row.height, band_count=row.band_count,
            dtype=row.dtype, crs_wkt=row.crs_wkt, epsg=row.epsg, proj4=row.proj4,
            geotransform=row.geotransform, bounds_native=row.bounds_native, bounds_wgs84=row.bounds_wgs84,
            gsd_cm=row.gsd_cm, tile_grid=TileGrid(max_zoom=max_zoom(row.width, row.height)),
            labels_version=row.labels_version, job_id=row.job_id, created_at=row.created_at,
        )


class GeoMapCreate(BaseModel):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class GeoMapWithJob(BaseModel):
    map: GeoMapOut
    job: JobOut


class GeoMapList(BaseModel):
    items: list[GeoMapOut]
```

- [ ] **Step 8: Implement the service's map functions**

`backend/app/maps/service.py` (Tasks 7 and 8 append to this file):

```python
"""Maps, runs, zones and labels: rows and bounded queries (spec 2026-09-22-geotiff-maps)."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GeoMap, MapRun
from app.errors import AppError, not_found
from app.maps.schemas import GeoMapCreate
from app.maps.startup import map_dir
from app.maps.tiles import TILE_CACHE
from app.projects.service import ProjectHandle

MAP_SUFFIXES = {".tif", ".tiff"}


def create_map(handle: ProjectHandle, body: GeoMapCreate) -> GeoMap:
    path = Path(body.path)
    if path.suffix.lower() not in MAP_SUFFIXES:
        raise AppError("validation_error", "a map must be a .tif or .tiff file", 422)
    if not path.is_file():
        raise AppError("validation_error", f"no file at {path}", 422)
    with handle.session() as s:
        row = GeoMap(
            name=body.name or path.stem, status="importing", source_path=str(path.resolve()),
            source_size=path.stat().st_size,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def list_maps(handle: ProjectHandle) -> list[GeoMap]:
    with handle.session() as s:
        rows = list(s.execute(select(GeoMap).order_by(GeoMap.created_at.desc())).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def _get(s: Session, map_id: str) -> GeoMap:
    row = s.get(GeoMap, map_id)
    if row is None:
        raise not_found("map", map_id)
    return row


def get_map(handle: ProjectHandle, map_id: str) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        s.expunge(row)
    return row


def require_ready(handle: ProjectHandle, map_id: str) -> GeoMap:
    row = get_map(handle, map_id)
    if row.status != "ready":
        raise AppError("conflict", f"map {row.name} is {row.status}, not ready", 409)
    return row


def set_map_job(handle: ProjectHandle, map_id: str, job_id: str) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def bump_labels_version(s: Session, map_id: str) -> None:
    _get(s, map_id).labels_version += 1


def delete_map(handle: ProjectHandle, map_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = _get(s, map_id)
        job_ids = [row.job_id] + [r.job_id for r in s.execute(select(MapRun).where(MapRun.map_id == map_id)).scalars()]
        if any(j and is_live(j) for j in job_ids):
            raise AppError("conflict", "the map has a job queued or running; cancel it first", 409)
        s.delete(row)  # runs, detections, zones and labels go with it (ON DELETE CASCADE)
    TILE_CACHE.drop_map(map_id)
    shutil.rmtree(map_dir(handle, map_id), ignore_errors=True)
```

`PRAGMA foreign_keys=ON` is set per connection in `open_project_db`, so the SQLite cascade applies.

- [ ] **Step 9: Implement the import job**

`backend/app/maps/jobs_import.py`:

```python
"""The `map_import` job (spec section 4): inspect, stretch, write the display raster, preview."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import rasterio

from app.db.models import GeoMap
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.maps import raster
from app.maps.georef import Georef
from app.maps.startup import map_dir, map_raster_path
from app.maps.tiles import TILE_CACHE

HASH_CHUNK = 64 * 1024 * 1024
HASH_SHARE = 0.05  # of the progress bar; the display raster takes the rest


def _sha256(ctx: JobContext, path: Path) -> str:
    digest, size, done = hashlib.sha256(), path.stat().st_size, 0
    with path.open("rb") as f:
        while chunk := f.read(HASH_CHUNK):
            ctx.check_cancelled()
            digest.update(chunk)
            done += len(chunk)
            ctx.progress(HASH_SHARE * done / max(size, 1), "reading the file")
    return digest.hexdigest()


def _fail(ctx: JobContext, map_id: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(GeoMap, map_id)
        if row is not None:
            row.status, row.error = "failed", message
    shutil.rmtree(map_dir(ctx.project, map_id), ignore_errors=True)
    ctx.publish("maps.changed", {"map_ids": [map_id]})


@register_job_type("map_import")
def run_map_import(ctx: JobContext) -> dict:
    map_id = ctx.params["map_id"]
    with ctx.project.session() as s:
        source = Path(s.get(GeoMap, map_id).source_path)
    folder = map_dir(ctx.project, map_id)
    try:
        info = raster.inspect_raster(source)
        sha = _sha256(ctx, source)
        with rasterio.open(source) as src:
            stretch = raster.compute_stretch(src)
        folder.mkdir(parents=True, exist_ok=True)
        dst = map_raster_path(ctx.project, map_id)
        raster.write_display_raster(
            source, dst, stretch,
            progress=lambda f, m: ctx.progress(HASH_SHARE + (0.97 - HASH_SHARE) * f, m),
            check_cancelled=ctx.check_cancelled,
        )
        with rasterio.open(dst) as d:
            raster.write_preview(d, folder / "preview.jpg")
        geo = Georef(info.geotransform, info.crs_wkt) if info.crs_wkt else None
        (folder / "source.json").write_text(
            json.dumps({"path": str(source), "size": source.stat().st_size, "sha256": sha, "info": info.__dict__}, indent=2),
            "utf-8",
        )
    except JobCancelled:
        _fail(ctx, map_id, "import cancelled")
        raise
    except raster.RasterError as e:
        _fail(ctx, map_id, str(e))
        raise JobFailure(str(e)) from None
    except Exception as e:
        _fail(ctx, map_id, f"import failed: {type(e).__name__}: {e}")
        raise
    with ctx.project.session() as s:
        row = s.get(GeoMap, map_id)
        row.width, row.height, row.band_count, row.dtype = info.width, info.height, info.band_count, info.dtype
        row.crs_wkt, row.epsg, row.proj4 = info.crs_wkt, info.epsg, info.proj4
        row.geotransform = list(info.geotransform) if info.geotransform else None
        row.bounds_native = geo.bounds_native(info.width, info.height) if geo else None
        row.bounds_wgs84 = geo.bounds_wgs84(info.width, info.height) if geo else None
        row.gsd_cm = geo.gsd_cm(info.width, info.height) if geo else None
        row.source_sha256, row.stretch = sha, stretch.to_dict()
        row.status, row.error = "ready", None
    TILE_CACHE.drop_map(map_id)
    ctx.publish("maps.changed", {"map_ids": [map_id]})
    ctx.progress(1.0, f"{info.width} x {info.height} px ready")
    return {"map_id": map_id, "width": info.width, "height": info.height, "epsg": info.epsg}
```

- [ ] **Step 10: Replace the six stubs with real routes**

In `backend/app/maps/router.py`, keep the module docstring and replace the rest with:

```python
from fastapi import APIRouter, Depends, Request, Response
from fastapi import Path as PathParam

import rasterio

from app.jobs.schemas import JobOut
from app.maps import service
from app.maps.jobs_import import run_map_import  # noqa: F401 - registers `map_import`
from app.maps.schemas import GeoMapCreate, GeoMapList, GeoMapOut, GeoMapWithJob
from app.maps.startup import map_dir, map_raster_path
from app.maps.tiles import TILE_CACHE, render_tile
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["maps"])
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}


@router.get("/maps", response_model=GeoMapList)
def list_maps(handle: ProjectHandle = Depends(get_project)) -> GeoMapList:
    return GeoMapList(items=[GeoMapOut.from_row(r) for r in service.list_maps(handle)])


@router.post("/maps", response_model=GeoMapWithJob, status_code=202)
def create_map(body: GeoMapCreate, request: Request, handle: ProjectHandle = Depends(get_project)) -> GeoMapWithJob:
    row = service.create_map(handle, body)
    job = request.app.state.jobs.submit(handle, "map_import", {"map_id": row.id, "name": row.name})
    row = service.set_map_job(handle, row.id, job.id)
    return GeoMapWithJob(map=GeoMapOut.from_row(row), job=JobOut.from_row(job, handle.id))


@router.get("/maps/{mapId}", response_model=GeoMapOut)
def get_map(mapId: str, handle: ProjectHandle = Depends(get_project)) -> GeoMapOut:  # noqa: N803
    return GeoMapOut.from_row(service.get_map(handle, mapId))


@router.delete("/maps/{mapId}", status_code=204)
def delete_map(mapId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_map(handle, mapId, request.app.state.jobs.is_live)
    return Response(status_code=204)


@router.get("/maps/{mapId}/preview", response_class=Response)
def get_map_preview(mapId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.require_ready(handle, mapId)
    body = (map_dir(handle, mapId) / "preview.jpg").read_bytes()
    return Response(body, media_type="image/jpeg", headers=IMMUTABLE)


@router.get("/maps/{mapId}/tiles/{z}/{x}/{y}", response_class=Response)
def get_map_tile(
    mapId: str,  # noqa: N803
    z: int = PathParam(ge=0, le=30),
    x: int = PathParam(ge=0),
    y: int = PathParam(ge=0),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    key = (handle.id, mapId, z, x, y)
    hit = TILE_CACHE.get(key)
    if hit is None:
        row = service.require_ready(handle, mapId)
        with rasterio.open(map_raster_path(handle, mapId)) as src:
            hit = render_tile(src, row.width, row.height, z, x, y)
        if hit is None:
            return Response(status_code=204, headers=IMMUTABLE)
        TILE_CACHE.put(key, hit)
    body, media = hit
    return Response(body, media_type=media, headers=IMMUTABLE)


STUBS: list[tuple[str, str, str]] = [
    ("GET", "/maps/{mapId}/runs", "listMapRuns"),
    ("POST", "/map-runs/estimate", "estimateMapRun"),
    ("POST", "/map-runs", "createMapRun"),
    ("GET", "/map-runs/{runId}", "getMapRun"),
    ("DELETE", "/map-runs/{runId}", "deleteMapRun"),
    ("POST", "/map-runs/{runId}/resume", "resumeMapRun"),
    ("GET", "/map-runs/{runId}/detections", "listMapDetections"),
    ("GET", "/map-runs/{runId}/density", "getMapDensity"),
    ("GET", "/map-runs/{runId}/score", "getMapRunScore"),
    ("GET", "/maps/{mapId}/zones", "listMapZones"),
    ("POST", "/maps/{mapId}/zones", "createMapZone"),
    ("PATCH", "/maps/{mapId}/zones/{zoneId}", "updateMapZone"),
    ("DELETE", "/maps/{mapId}/zones/{zoneId}", "deleteMapZone"),
    ("GET", "/maps/{mapId}/labels", "listMapLabels"),
    ("POST", "/maps/{mapId}/labels", "createMapLabel"),
    ("POST", "/maps/{mapId}/labels/seed", "seedMapLabels"),
    ("PATCH", "/maps/{mapId}/labels/{labelId}", "updateMapLabel"),
    ("DELETE", "/maps/{mapId}/labels/{labelId}", "deleteMapLabel"),
    ("POST", "/map-exports", "createMapExport"),
]

add_stubs(router, STUBS)
```

The tile route checks the cache before `require_ready`. A cached tile exists only for a map that
was ready, and the cache is dropped on delete, so this is safe. It also keeps a hot tile off the DB.

Remove `listMaps`, `createMap`, `getMap`, `deleteMap`, `getMapPreview` and `getMapTile` from
`EXPECTED_STUBS` in `backend/tests/test_contract.py`.

- [ ] **Step 11: Run the tests**

Run: `cd backend; $PY -m pytest tests/test_maps_import.py tests/test_maps_tiles.py tests/test_contract.py -q`
Expected: all pass.

The contract test sends generated bodies to `POST /maps`. Generated paths never exist, so it gets
422, which conforms. If schemathesis generates a path that points at a real folder, that is 422
too, because the suffix check comes first.

- [ ] **Step 12: Lint, full backend suite, commit**

Run: `cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest -q`

```bash
git add backend/app/maps/schemas.py backend/app/maps/service.py backend/app/maps/tiles.py backend/app/maps/jobs_import.py backend/app/maps/router.py backend/tests/test_maps_tiles.py backend/tests/test_maps_import.py backend/tests/test_contract.py
git commit -m "feat(maps): map_import job, map CRUD, preview and bounded 256 px tiles

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Detection windows under GSD scaling, nodata skip, strip-bounded merge (pure)

**Files:**
- Create: `backend/app/maps/windows.py`
- Test: `backend/tests/test_maps_windows.py`

**Interfaces:**
- Consumes: `app.providers.base.Detection`, `TilingSpec`; `app.providers.tiling.make_tiles`, `nms_per_class`.
- Produces:
  - `GSD_TOLERANCE = 0.15`, `SKIP_MASKED = 0.99`
  - `MapWindow(index, x, y, w, h, out_w, out_h)`: map-pixel window, and the size sent to the model
  - `gsd_scale(map_gsd_cm: float | None, target_gsd_cm: float | None) -> float` (model px per map px; 1.0 = none)
  - `plan_windows(width, height, tile_size, overlap, scale) -> list[MapWindow]` (row-major)
  - `strips(windows) -> list[list[MapWindow]]`
  - `to_map(det: Detection, win: MapWindow) -> Detection`
  - `masked_fraction(mask: np.ndarray, mask_scale: float, win: MapWindow) -> float`
  - `StripMerger(nms_iou)` with `.add_strip(top: float, dets) -> list[Detection]` (final) and `.finish() -> list[Detection]`
  - `drop_cut_boxes(dets, win, width, height, overlap_px) -> list[Detection]`. `dets` are in map pixels and `overlap_px` is in model pixels. It drops boxes cut by an *interior* window edge whose visible part is shorter than the overlap, because the neighbouring window sees that object whole.

**Why `drop_cut_boxes` exists (not in the spec, found while planning).** Take a machine that
straddles a window seam. Window A returns a sliver of it; window B returns it whole. The sliver's
IoU with the whole box is roughly the sliver's share of the area, often under 0.5, so NMS keeps
both boxes and the machine is **counted twice**. Counts are the headline number, so this matters.
When the visible part is shorter than the overlap, the neighbour is guaranteed to contain the whole
object, so dropping the cut copy loses nothing. Larger objects are never dropped.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_maps_windows.py`:

```python
import numpy as np
import pytest

from app.maps.windows import (
    MapWindow,
    StripMerger,
    drop_cut_boxes,
    gsd_scale,
    masked_fraction,
    plan_windows,
    strips,
    to_map,
)
from app.providers.base import Detection


def det(x, y, w=50, h=40, conf=0.9, label="excavator"):
    return Detection(label=label, x=x, y=y, w=w, h=h, confidence=conf)


def test_gsd_scale():
    assert gsd_scale(None, 2.0) == 1.0
    assert gsd_scale(3.0, None) == 1.0
    assert gsd_scale(3.0, 2.9) == 1.0  # within 15 %
    assert gsd_scale(3.0, 2.0) == pytest.approx(1.5)  # map coarser than training: upsample
    assert gsd_scale(1.0, 2.0) == pytest.approx(0.5)


def test_unscaled_windows_cover_the_map_exactly():
    wins = plan_windows(3000, 2000, 1280, 0.2, 1.0)
    assert wins[0] == MapWindow(0, 0, 0, 1280, 1280, 1280, 1280)
    assert max(w.x + w.w for w in wins) == 3000 and max(w.y + w.h for w in wins) == 2000
    assert all(w.out_w == w.w and w.out_h == w.h for w in wins)
    assert [w.index for w in wins] == list(range(len(wins)))


def test_scaled_windows_read_more_map_pixels_per_model_pixel():
    wins = plan_windows(4000, 2000, 1280, 0.2, 0.5)
    first = wins[0]
    assert (first.out_w, first.out_h) == (1280, 1000)  # virtual map is 2000 x 1000
    assert (first.w, first.h) == (2560, 2000)
    assert max(w.x + w.w for w in wins) == 4000


def test_strips_group_by_row():
    wins = plan_windows(3000, 2000, 1280, 0.2, 1.0)
    rows = strips(wins)
    assert len(rows) == 2 and all(len({w.y for w in r}) == 1 for r in rows)


def test_to_map_scales_and_offsets():
    win = MapWindow(3, 1000, 500, 2560, 2560, 1280, 1280)
    d = to_map(det(10, 20, 30, 40), win)
    assert (d.x, d.y, d.w, d.h) == (1020, 540, 60, 80)


def test_masked_fraction():
    mask = np.ones((100, 200), dtype=bool)
    mask[:, :100] = False  # left half nodata
    scale = 0.1  # mask px per map px: the map is 2000 x 1000
    assert masked_fraction(mask, scale, MapWindow(0, 0, 0, 500, 500, 500, 500)) == 1.0
    assert masked_fraction(mask, scale, MapWindow(0, 1000, 0, 500, 500, 500, 500)) == 0.0
    assert masked_fraction(mask, scale, MapWindow(0, 750, 0, 500, 500, 500, 500)) == pytest.approx(0.5)


def test_merger_joins_a_box_split_by_a_horizontal_seam():
    m = StripMerger(0.5)
    out = m.add_strip(0, [det(1000, 100, conf=0.9), det(1005, 102, conf=0.8)])
    assert out == []
    assert len(m.finish()) == 1


def test_merger_joins_a_box_split_by_a_strip_boundary():
    m = StripMerger(0.5)
    m.add_strip(0, [det(100, 1010)])
    m.add_strip(1024, [det(102, 1012, conf=0.7)])
    kept = m.finish()
    assert len(kept) == 1 and kept[0].confidence == 0.9


def test_merger_releases_boxes_that_later_strips_cannot_touch():
    m = StripMerger(0.5)
    m.add_strip(0, [det(100, 100), det(100, 1000)])
    released = m.add_strip(1024, [det(500, 1100)])
    assert [d.y for d in released] == [100]  # ends at 140 < 1024: final
    assert sorted(d.y for d in m.finish()) == [1000, 1100]


def test_drop_cut_boxes_only_on_interior_edges_and_only_small_slivers():
    win = MapWindow(1, 1024, 0, 1280, 1280, 1280, 1280)  # a middle window of a 4000 x 1280 map
    cut_left = det(1024, 100, w=30)  # touches the interior left edge, 30 px < 256 overlap: dropped
    cut_right_big = det(1900, 100, w=404)  # touches the right edge (2304) but is 404 px: kept
    inside = det(1500, 100)
    at_map_top = det(1500, 0)  # y = 0 is the map's own edge, not a seam: kept
    kept = drop_cut_boxes([cut_left, cut_right_big, inside, at_map_top], win, 4000, 1280, 256)
    assert kept == [cut_right_big, inside, at_map_top]


def test_merger_keeps_different_classes_apart():
    m = StripMerger(0.5)
    m.add_strip(0, [det(100, 100, label="excavator"), det(100, 100, label="dump_truck", conf=0.8)])
    assert len(m.finish()) == 2
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_windows.py -q`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `windows.py`**

`backend/app/maps/windows.py`:

```python
"""Where the detector looks on a map, and how its boxes are merged (spec section 6).

Windows are planned on a *virtual* map scaled to the model's training GSD, using the same
`make_tiles` as query runs, and mapped back to map pixels, so the read size and the model input
size can differ. Merging is per strip: a box that ends above the current strip's top can no longer
overlap anything still to come, so it is released and memory stays bounded by about two strips.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import groupby

import numpy as np

from app.providers.base import Detection, TilingSpec
from app.providers.tiling import make_tiles, nms_per_class

GSD_TOLERANCE = 0.15
SKIP_MASKED = 0.99


@dataclass(frozen=True)
class MapWindow:
    index: int
    x: int
    y: int
    w: int
    h: int
    out_w: int
    out_h: int


def gsd_scale(map_gsd_cm: float | None, target_gsd_cm: float | None) -> float:
    if not map_gsd_cm or not target_gsd_cm:
        return 1.0
    scale = map_gsd_cm / target_gsd_cm
    return 1.0 if abs(1.0 - scale) <= GSD_TOLERANCE else scale


def plan_windows(width: int, height: int, tile_size: int, overlap: float, scale: float) -> list[MapWindow]:
    vw, vh = max(1, round(width * scale)), max(1, round(height * scale))
    out: list[MapWindow] = []
    for t in make_tiles(vw, vh, TilingSpec(True, tile_size, overlap, 0.5)):
        x, y = int(t.x / scale), int(t.y / scale)
        x1 = width if t.x + t.w >= vw else min(width, math.ceil((t.x + t.w) / scale))
        y1 = height if t.y + t.h >= vh else min(height, math.ceil((t.y + t.h) / scale))
        out.append(MapWindow(t.index, x, y, x1 - x, y1 - y, t.w, t.h))
    return out


def strips(windows: list[MapWindow]) -> list[list[MapWindow]]:
    return [list(group) for _, group in groupby(windows, key=lambda w: w.y)]


def to_map(det: Detection, win: MapWindow) -> Detection:
    sx, sy = win.w / win.out_w, win.h / win.out_h
    return Detection(
        label=det.label, x=win.x + det.x * sx, y=win.y + det.y * sy, w=det.w * sx, h=det.h * sy,
        confidence=det.confidence, raw_ref=det.raw_ref,
    )


def masked_fraction(mask: np.ndarray, mask_scale: float, win: MapWindow) -> float:
    """Share of the window that is nodata, looked up in a low-resolution validity mask."""
    y0, x0 = int(win.y * mask_scale), int(win.x * mask_scale)
    y1 = max(y0 + 1, math.ceil((win.y + win.h) * mask_scale))
    x1 = max(x0 + 1, math.ceil((win.x + win.w) * mask_scale))
    sub = mask[y0:y1, x0:x1]
    return 1.0 - float(sub.mean()) if sub.size else 1.0


EDGE_MARGIN = 2.0  # model pixels: a box within this of a window edge is cut by it


def drop_cut_boxes(
    dets: list[Detection], win: MapWindow, width: int, height: int, overlap_px: int
) -> list[Detection]:
    """Drop boxes cut by an interior window edge when the neighbour must hold the whole object.

    A sliver at a seam and the neighbour's full box rarely reach the NMS IoU, so without this a
    machine on a seam counts twice. The neighbour window starts `overlap` before this one ends, so
    an object whose visible part is shorter than the overlap lies entirely inside the neighbour.
    """
    sx, sy = win.w / win.out_w, win.h / win.out_h
    mx, my = EDGE_MARGIN * sx, EDGE_MARGIN * sy
    ox, oy = overlap_px * sx, overlap_px * sy
    left, top, right, bottom = win.x, win.y, win.x + win.w, win.y + win.h
    kept = []
    for d in dets:
        cut = (
            (left > 0 and d.x <= left + mx and d.w < ox)
            or (right < width and d.x + d.w >= right - mx and d.w < ox)
            or (top > 0 and d.y <= top + my and d.h < oy)
            or (bottom < height and d.y + d.h >= bottom - my and d.h < oy)
        )
        if not cut:
            kept.append(d)
    return kept


class StripMerger:
    def __init__(self, nms_iou: float):
        self.nms_iou = nms_iou
        self.pending: list[Detection] = []

    def add_strip(self, top: float, dets: list[Detection]) -> list[Detection]:
        """Merge a new strip's boxes; returns the boxes that are now final."""
        final = [d for d in self.pending if d.y + d.h <= top]
        rest = [d for d in self.pending if d.y + d.h > top]
        self.pending = nms_per_class(rest + list(dets), self.nms_iou)
        return final

    def finish(self) -> list[Detection]:
        out, self.pending = self.pending, []
        return out
```

- [ ] **Step 4: Run the tests**

Run: `cd backend; $PY -m pytest tests/test_maps_windows.py -q`
Expected: `11 passed`.

In `test_scaled_windows_read_more_map_pixels_per_model_pixel`, the virtual map is 2000 × 1000,
so the first tile is `1280 × 1000` (`make_tiles` caps the short axis at the image height).
That is why `out_h` is 1000.

- [ ] **Step 5: Lint and commit**

```bash
git add backend/app/maps/windows.py backend/tests/test_maps_windows.py
git commit -m "feat(maps): detection windows with GSD scaling, nodata lookup, strip-bounded merge

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: `map_detect` job, runs API, estimate, detections and density queries

**Files:**
- Create: `backend/app/maps/jobs_detect.py`
- Modify: `backend/app/maps/schemas.py`, `backend/app/maps/service.py`, `backend/app/maps/router.py`, `backend/tests/test_contract.py`
- Modify: `backend/tests/geotiffs.py` (add `make_squares_geotiff`)
- Test: `backend/tests/test_maps_detect.py`

**Interfaces:**
- Consumes:
  - Task 5: `service.require_ready`, `map_raster_path`, `map_dir`.
  - Task 6: all of `windows.*`.
  - From `app.inference`: `service._validate`, `service._cost_per_request`, `service.class_ids_by_name`, `service.class_names`; `jobs._call_with_retries`, `jobs._rate_limiter`, `jobs._wiring`, `jobs._write_atomic`. All are duck-typed on `kind`, `model_id`, `provider`, `query` and `conf`, which `MapRun`/`MapRunCreate` carry under the same names.
- Produces:
  - Schemas: `MapRunCreate`, `MapRunOut.from_row(row, state, detection_count)`, `MapRunWithJob`, `MapRunList`, `MapRunEstimate`, `MapDetectionOut`, `MapDetectionPage`, `MapDensityCell`, `MapDensity`.
  - `service.create_run(handle, keys, config, body) -> MapRun`
  - `service.estimate_run(handle, config, body) -> dict`
  - `service.list_runs(handle, map_id) -> list[tuple[MapRun, str | None, int]]`
  - `service.get_run(handle, run_id) -> tuple[MapRun, str | None, int]`
  - `service.set_run_job(handle, run_id, job_id)`
  - `service.resume_run(handle, run_id, submit) -> Job`
  - `service.delete_run(handle, run_id, is_live)`
  - `service.detections_in(handle, run_id, bbox, min_conf, class_id) -> tuple[list[MapDetection], bool]`
  - `service.density(handle, run_id, cells, min_conf) -> tuple[float, list[dict]]`
  - `service.MAX_DETECTIONS = 5000`
  - `jobs_detect.windows_dir(handle, run) -> Path`
  - job type `map_detect` with params `{"map_run_id": str}`
  - event `map_runs.changed` with payload `{"map_id", "run_ids"}`

- [ ] **Step 1: Add the squares fixture**

Append to `backend/tests/geotiffs.py`:

```python
def make_squares_geotiff(
    path: Path,
    width: int,
    height: int,
    squares: list[tuple[int, int, int]],
    *,
    pixel: float = 0.03,
    nodata_left: int = 0,
) -> Path:
    """Dark ground (30) with bright squares (250) at (x, y, side): a scene a fake detector can
    actually "see", so window seams, scaling and nodata skipping are tested end to end."""
    data = np.full((3, height, width), 30, dtype=np.uint8)
    for x, y, side in squares:
        data[:, y : y + side, x : x + side] = 250
    transform = Affine.translation(500000.0, 4983000.0) * Affine.scale(pixel, -pixel)
    profile = dict(driver="GTiff", width=width, height=height, count=4, dtype="uint8",
                   transform=transform, crs="EPSG:32633")
    alpha = np.full((height, width), 255, dtype=np.uint8)
    alpha[:, :nodata_left] = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, indexes=[1, 2, 3])
        dst.write(alpha, 4)
        dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
    return path
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_maps_detect.py`:

```python
"""Detection across a whole map: windows, seams, nodata, GSD scaling, resume, queries (spec 6)."""

import cv2
import numpy as np
import pytest
from geotiffs import make_squares_geotiff

from app.db.models import MapDetection
from app.providers.base import Detection, ProviderError, TileResult

BASE = "/api/v1/projects"
SQUARES = [(200, 200, 60), (1250, 400, 60), (2500, 1000, 60), (2600, 300, 60)]  # 2nd sits on a seam


class SquareProvider:
    """Finds bright squares: one `excavator` per connected blob of pixels above 200."""

    name = "fake"

    def __init__(self, fail_windows=()):
        self.calls: list[int] = []
        self.fail_windows = set(fail_windows)

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        self.calls.append(tile.index)
        if tile.index in self.fail_windows:
            raise ProviderError("window is cursed", retryable=False)
        crop = np.asarray(image.crop((tile.x, tile.y, tile.x + tile.w, tile.y + tile.h)))[..., 0] > 200
        n, _, stats, _ = cv2.connectedComponentsWithStats(crop.astype(np.uint8))
        dets = [
            Detection("excavator", float(x + tile.x), float(y + tile.y), float(w), float(h), 0.9)
            for x, y, w, h, area in stats[1:n]
            if area >= 20
        ]
        return TileResult(tile=tile, detections=dets)


@pytest.fixture
def use_provider(monkeypatch):
    def _use(provider):
        monkeypatch.setattr("app.maps.jobs_detect.get_provider", lambda *a, **k: provider)
        return provider

    return _use


@pytest.fixture
def with_key(app):
    app.state.keys.set("anthropic", "sk-fake-key")


@pytest.fixture
def squares_map(client, project_id, wait_job, tmp_path):
    def _make(**kw):
        path = make_squares_geotiff(tmp_path / "sq.tif", 3000, 1500, SQUARES, **kw)
        r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path)})
        assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
        return r.json()["map"]["id"]

    return _make


def run_body(map_id, **over):
    return {"map_id": map_id, "kind": "cloud_provider", "provider": "anthropic", "query": "excavators", **over}


def start(client, project_id, wait_job, body):
    r = client.post(f"{BASE}/{project_id}/map-runs", json=body)
    assert r.status_code == 202, r.text
    return r.json()["run"]["id"], wait_job(project_id, r.json()["job"]["id"])


def test_every_square_is_counted_once_even_on_a_seam(client, project_id, wait_job, squares_map, use_provider, with_key, class_ids):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, job = start(client, project_id, wait_job, run_body(map_id))
    assert job["state"] == "succeeded", job
    run = client.get(f"{BASE}/{project_id}/map-runs/{run_id}").json()
    assert run["state"] == "succeeded" and run["detection_count"] == 4
    assert run["counts"] == {class_ids["excavator"]: 4}
    boxes = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/detections").json()["items"]
    seam = [b for b in boxes if 1200 < b["x"] < 1300]
    assert len(seam) == 1 and seam[0]["w"] == pytest.approx(60, abs=4)


def test_nodata_windows_are_never_sent(client, project_id, wait_job, squares_map, use_provider, with_key):
    map_id = squares_map(nodata_left=1500)
    est = client.post(f"{BASE}/{project_id}/map-runs/estimate", json=run_body(map_id)).json()
    assert est["skipped_windows"] >= 2 and est["requests"] == est["windows"] - est["skipped_windows"]
    assert est["estimated_cost"] == pytest.approx(0.02 * est["requests"])
    provider = use_provider(SquareProvider())
    start(client, project_id, wait_job, run_body(map_id))
    assert len(provider.calls) == est["requests"]


def test_gsd_scaling_keeps_boxes_in_map_pixels(client, project_id, wait_job, squares_map, use_provider, with_key):
    map_id = squares_map()  # 3 cm per pixel
    use_provider(SquareProvider())
    est = client.post(f"{BASE}/{project_id}/map-runs/estimate", json=run_body(map_id, target_gsd_cm=6.0)).json()
    assert est["scale"] == pytest.approx(0.5)
    run_id, _ = start(client, project_id, wait_job, run_body(map_id, target_gsd_cm=6.0))
    boxes = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/detections").json()["items"]
    assert len(boxes) == 4 and all(b["w"] == pytest.approx(60, abs=6) for b in boxes)


def test_resume_only_repeats_failed_windows(client, project_id, wait_job, squares_map, use_provider, with_key):
    map_id = squares_map()
    use_provider(SquareProvider(fail_windows={1}))
    run_id, job = start(client, project_id, wait_job, run_body(map_id))
    assert job["state"] == "succeeded" and job["result"]["failed_windows"] == 1
    second = use_provider(SquareProvider())
    r = client.post(f"{BASE}/{project_id}/map-runs/{run_id}/resume")
    assert r.status_code == 202
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    assert second.calls == [1]
    assert client.get(f"{BASE}/{project_id}/map-runs/{run_id}").json()["detection_count"] == 4


def test_bbox_query_and_truncation(client, project_id, wait_job, squares_map, use_provider, with_key, monkeypatch):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, _ = start(client, project_id, wait_job, run_body(map_id))
    url = f"{BASE}/{project_id}/map-runs/{run_id}/detections"
    assert len(client.get(url, params={"bbox": "0,0,1000,1000"}).json()["items"]) == 1
    assert client.get(url, params={"min_conf": 0.95}).json()["items"] == []
    assert client.get(url, params={"bbox": "a,b,c,d"}).status_code == 422
    monkeypatch.setattr("app.maps.service.MAX_DETECTIONS", 2)
    page = client.get(url).json()
    assert len(page["items"]) == 2 and page["truncated"] is True


def test_density_grid(client, project_id, wait_job, squares_map, use_provider, with_key, class_ids):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, _ = start(client, project_id, wait_job, run_body(map_id))
    d = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/density", params={"cells": 10}).json()
    assert d["cell_size"] == pytest.approx(300)
    assert sum(c["count"] for c in d["cells"]) == 4
    assert {(c["gx"], c["gy"]) for c in d["cells"]} == {(0, 0), (4, 1), (8, 3), (8, 1)}


def test_runs_list_and_delete(client, project_id, wait_job, squares_map, use_provider, with_key, handle):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, _ = start(client, project_id, wait_job, run_body(map_id))
    items = client.get(f"{BASE}/{project_id}/maps/{map_id}/runs").json()["items"]
    assert [i["id"] for i in items] == [run_id]
    assert client.delete(f"{BASE}/{project_id}/map-runs/{run_id}").status_code == 204
    with handle.session() as s:
        assert s.query(MapDetection).count() == 0


def test_run_on_a_map_that_is_not_ready_is_409(client, project_id, handle, with_key):
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name="m", status="importing", source_path="x", source_size=1)
        s.add(row)
        s.flush()
        map_id = row.id
    assert client.post(f"{BASE}/{project_id}/map-runs", json=run_body(map_id)).status_code == 409
```

`class_ids` is the fixture from `test_query_runs.py`. Copy it into this module (or move it into
`conftest.py` and remove the duplicate from `test_query_runs.py`):

```python
@pytest.fixture
def class_ids(project) -> dict:
    return {c["name"]: c["id"] for c in project["classes"]}
```

The density cells are expected at square centres: (230, 230) → (0, 0); (1280, 430) → (4, 1);
(2530, 1030) → (8, 3); (2630, 330) → (8, 1), with a 300 px cell (max side 3000 / 10).

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_detect.py -q`
Expected: FAIL. The run routes are 501 stubs.

- [ ] **Step 4: Append the run schemas**

Append to `backend/app/maps/schemas.py`. Add the imports at the top: `from app.db.models import MapDetection, MapRun`, `from app.inference.schemas import QueryRunKind`, `from app.providers.schemas import ProviderName`.

```python
class MapRunCreate(BaseModel):
    map_id: str
    kind: QueryRunKind
    model_id: str | None = None
    provider: ProviderName | None = None
    query: str | None = Field(default=None, min_length=1)
    tile_size: int = Field(default=1280, ge=256, le=4096)
    overlap: float = Field(default=0.2, ge=0, le=0.5)
    nms_iou: float = Field(default=0.5, ge=0, le=1)
    conf: float = Field(default=0.25, ge=0, le=1)
    target_gsd_cm: float | None = Field(default=None, gt=0)


class MapRunOut(BaseModel):
    id: str
    map_id: str
    kind: QueryRunKind
    model_id: str | None
    provider: str | None
    model_name: str | None
    query: str
    tile_size: int
    overlap: float
    nms_iou: float
    conf: float
    target_gsd_cm: float | None
    job_id: str | None
    state: Literal["queued", "running", "succeeded", "failed", "cancelled"] | None
    counts: dict[str, int]
    detection_count: int
    created_at: datetime

    @classmethod
    def from_row(cls, row: MapRun, state: str | None, detection_count: int) -> MapRunOut:
        return cls(
            id=row.id, map_id=row.map_id, kind=row.kind, model_id=row.model_id, provider=row.provider,
            model_name=row.model_name, query=row.query or "", tile_size=row.tile_size, overlap=row.overlap,
            nms_iou=row.nms_iou, conf=row.conf, target_gsd_cm=row.target_gsd_cm, job_id=row.job_id,
            state=state, counts=row.counts or {}, detection_count=detection_count, created_at=row.created_at,
        )


class MapRunWithJob(BaseModel):
    run: MapRunOut
    job: JobOut


class MapRunList(BaseModel):
    items: list[MapRunOut]


class MapRunEstimate(BaseModel):
    windows: int
    skipped_windows: int
    requests: int
    scale: float
    cost_per_request: float
    estimated_cost: float


class MapDetectionOut(BaseModel):
    id: str
    class_id: str
    confidence: float
    x: float
    y: float
    w: float
    h: float
    angle: float | None

    @classmethod
    def from_row(cls, r: MapDetection) -> MapDetectionOut:
        return cls(id=r.id, class_id=r.class_id, confidence=r.confidence, x=r.x, y=r.y, w=r.w, h=r.h, angle=r.angle)


class MapDetectionPage(BaseModel):
    items: list[MapDetectionOut]
    truncated: bool


class MapDensityCell(BaseModel):
    gx: int
    gy: int
    class_id: str
    count: int


class MapDensity(BaseModel):
    cell_size: float
    cells: list[MapDensityCell]
```

- [ ] **Step 5: Append the run functions to the service**

Append to `backend/app/maps/service.py`, and extend its imports:

- `import threading`
- `import rasterio`
- `from sqlalchemy import Integer, cast, delete, func`
- `from app.db.models import Job, MapDetection`
- `from app.inference.service import _cost_per_request, _validate`
- `from app.maps import raster`
- `from app.maps.schemas import MapRunCreate`
- `from app.maps.startup import map_raster_path`
- `from app.maps.windows import SKIP_MASKED, gsd_scale, masked_fraction, plan_windows`

```python
MAX_DETECTIONS = 5000
BUSY = ("queued", "running")
_RESUME_LOCK = threading.Lock()


def create_run(handle: ProjectHandle, keys, config, body: MapRunCreate) -> MapRun:
    require_ready(handle, body.map_id)
    model_name = _validate(handle, config, body, check_key=True, keys=keys)
    with handle.session() as s:
        row = MapRun(
            map_id=body.map_id, kind=body.kind,
            model_id=body.model_id if body.kind == "local_model" else None,
            provider=body.provider if body.kind == "cloud_provider" else None,
            model_name=model_name, query=(body.query or "").strip(), tile_size=body.tile_size,
            overlap=body.overlap, nms_iou=body.nms_iou, conf=body.conf, target_gsd_cm=body.target_gsd_cm,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def estimate_run(handle: ProjectHandle, config, body: MapRunCreate) -> dict:
    gmap = require_ready(handle, body.map_id)
    _validate(handle, config, body, check_key=False, keys=None)
    scale = gsd_scale(gmap.gsd_cm, body.target_gsd_cm)
    wins = plan_windows(gmap.width, gmap.height, body.tile_size, body.overlap, scale)
    with rasterio.open(map_raster_path(handle, gmap.id)) as src:
        mask, mscale = raster.low_res_mask(src)
    skipped = sum(1 for w in wins if masked_fraction(mask, mscale, w) >= SKIP_MASKED)
    per_request = _cost_per_request(config, body)
    requests = len(wins) - skipped
    return {
        "windows": len(wins), "skipped_windows": skipped, "requests": requests, "scale": scale,
        "cost_per_request": per_request, "estimated_cost": round(requests * per_request, 6),
    }


def _run(s: Session, run_id: str) -> MapRun:
    row = s.get(MapRun, run_id)
    if row is None:
        raise not_found("map run", run_id)
    return row


def _state_and_count(s: Session, row: MapRun) -> tuple[str | None, int]:
    job = s.get(Job, row.job_id) if row.job_id else None
    count = s.execute(select(func.count()).select_from(MapDetection).where(MapDetection.run_id == row.id)).scalar_one()
    return (job.state if job else None), count


def get_run(handle: ProjectHandle, run_id: str) -> tuple[MapRun, str | None, int]:
    with handle.session() as s:
        row = _run(s, run_id)
        state, count = _state_and_count(s, row)
        s.expunge(row)
    return row, state, count


def list_runs(handle: ProjectHandle, map_id: str) -> list[tuple[MapRun, str | None, int]]:
    with handle.session() as s:
        _get(s, map_id)
        out = []
        for row in s.execute(select(MapRun).where(MapRun.map_id == map_id).order_by(MapRun.created_at.desc())).scalars():
            state, count = _state_and_count(s, row)
            s.expunge(row)
            out.append((row, state, count))
    return out


def set_run_job(handle: ProjectHandle, run_id: str, job_id: str) -> MapRun:
    with handle.session() as s:
        row = _run(s, run_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def resume_run(handle: ProjectHandle, run_id: str, submit: Callable[[MapRun], Job]) -> Job:
    with _RESUME_LOCK:
        with handle.session() as s:
            row = _run(s, run_id)
            job = s.get(Job, row.job_id) if row.job_id else None
            if job is not None and job.state in BUSY:
                raise AppError("conflict", f"map run {run_id} is still {job.state}; cancel it first", 409)
            s.expunge(row)
        job = submit(row)
        set_run_job(handle, run_id, job.id)
        return job


def delete_run(handle: ProjectHandle, run_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = _run(s, run_id)
        if row.job_id and is_live(row.job_id):
            raise AppError("conflict", "the run's job is queued or running; cancel it first", 409)
        map_id = row.map_id
        s.execute(delete(MapDetection).where(MapDetection.run_id == run_id))
        s.delete(row)
    shutil.rmtree(map_dir(handle, map_id) / "runs" / run_id, ignore_errors=True)


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox.split(","))
    except ValueError:
        raise AppError("validation_error", "bbox must be x0,y0,x1,y1", 422) from None
    return x0, y0, x1, y1


def detections_in(
    handle: ProjectHandle, run_id: str, bbox: str | None, min_conf: float | None, class_id: str | None
) -> tuple[list[MapDetection], bool]:
    box = _parse_bbox(bbox)
    q = select(MapDetection).where(MapDetection.run_id == run_id)
    if box:
        x0, y0, x1, y1 = box
        q = q.where(MapDetection.x < x1, MapDetection.x + MapDetection.w > x0,
                    MapDetection.y < y1, MapDetection.y + MapDetection.h > y0)
    if min_conf is not None:
        q = q.where(MapDetection.confidence >= min_conf)
    if class_id:
        q = q.where(MapDetection.class_id == class_id)
    with handle.session() as s:
        _run(s, run_id)
        rows = list(s.execute(q.limit(MAX_DETECTIONS + 1)).scalars())
        for r in rows:
            s.expunge(r)
    return rows[:MAX_DETECTIONS], len(rows) > MAX_DETECTIONS


def density(handle: ProjectHandle, run_id: str, cells: int, min_conf: float | None) -> tuple[float, list[dict]]:
    with handle.session() as s:
        run = _run(s, run_id)
        gmap = _get(s, run.map_id)
        cell = max(gmap.width, gmap.height) / cells
        gx = cast((MapDetection.x + MapDetection.w / 2) / cell, Integer).label("gx")
        gy = cast((MapDetection.y + MapDetection.h / 2) / cell, Integer).label("gy")
        q = select(gx, gy, MapDetection.class_id, func.count()).where(MapDetection.run_id == run_id)
        if min_conf is not None:
            q = q.where(MapDetection.confidence >= min_conf)
        rows = s.execute(q.group_by(gx, gy, MapDetection.class_id)).all()
    return cell, [{"gx": a, "gy": b, "class_id": c, "count": n} for a, b, c, n in rows]
```

- [ ] **Step 6: Implement the detect job**

`backend/app/maps/jobs_detect.py`:

```python
"""The `map_detect` job (spec section 6): window by window, resumable, strip-bounded merge.

Each window's result is checkpointed to `maps/<map>/runs/<run>/windows/<index>.json` in map pixels,
so a resume (a new job for the same run) calls the provider only for windows still missing or
failed. Detections are rebuilt from the checkpoints on every job, so a resume never doubles them.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict
from pathlib import Path

import rasterio
from PIL import Image as PILImage
from sqlalchemy import delete, func, select

from app.db.models import GeoMap, MapDetection, MapRun
from app.errors import not_found
from app.inference.jobs import _call_with_retries, _rate_limiter, _wiring, _write_atomic
from app.inference.service import class_ids_by_name, class_names
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.maps import raster
from app.maps.startup import map_dir, map_raster_path
from app.maps.windows import (
    SKIP_MASKED, MapWindow, StripMerger, drop_cut_boxes, gsd_scale, masked_fraction, plan_windows, strips, to_map,
)
from app.providers.base import Detection, Tile
from app.providers.factory import get_provider
from app.training import registry


def windows_dir(handle, run: MapRun) -> Path:
    return map_dir(handle, run.map_id) / "runs" / run.id / "windows"


def _load(ctx: JobContext) -> tuple[MapRun, GeoMap, list[str], dict[str, str]]:
    run_id = ctx.params["map_run_id"]
    with ctx.project.session() as s:
        run = s.get(MapRun, run_id)
        if run is None:
            raise not_found("map run", run_id)
        gmap = s.get(GeoMap, run.map_id)
        names, by_name = class_names(ctx.project, s), class_ids_by_name(ctx.project, s)
        s.expunge(run)
        s.expunge(gmap)
    return run, gmap, names, by_name


def _provider(ctx: JobContext, run: MapRun, names: list[str]):
    if run.kind == "cloud_provider":
        return get_provider(
            "cloud_provider", handle=ctx.project, keys=_wiring(ctx, "keys"),
            config=_wiring(ctx, "provider_config").get(run.provider), provider_name=run.provider,
            project_class_names=names, imgsz=run.tile_size,
        )
    return get_provider(
        "local_model", handle=ctx.project, keys=None, config=None,
        model_row=registry.get_model(ctx.project, run.model_id), project_class_names=names,
        imgsz=run.tile_size, cancelled=ctx.cancelled,
    )


def _window_result(ctx, run, provider, names, src, mask, mscale, win: MapWindow, gmap: GeoMap) -> tuple[dict, bool]:
    path = windows_dir(ctx.project, run) / f"{win.index}.json"
    if path.exists():
        payload = json.loads(path.read_text("utf-8"))
        if not payload.get("failed"):
            return payload, True
    if masked_fraction(mask, mscale, win) >= SKIP_MASKED:
        payload = {"window": asdict(win), "skipped": True, "failed": False, "error": None, "detections": []}
        _write_atomic(path, payload)
        return payload, False
    limiter = _rate_limiter(ctx, run)
    if limiter is not None:
        limiter.acquire()
    rgb, _ = raster.read_rgb(src, win.x, win.y, win.w, win.h, win.out_w, win.out_h)
    image = PILImage.fromarray(rgb, "RGB")
    tile = Tile(index=win.index, x=0, y=0, w=win.out_w, h=win.out_h)
    raw_ref = path.relative_to(ctx.project.folder).as_posix()
    result, error = _call_with_retries(ctx, provider, image, tile, run, names, raw_ref)
    dets = [to_map(d, win) for d in (result.detections if result else [])]
    overlap_px = round(run.tile_size * run.overlap)
    dets = drop_cut_boxes(dets, win, gmap.width, gmap.height, overlap_px)
    payload = {
        "window": asdict(win), "skipped": False, "failed": result is None, "error": error,
        "detections": [asdict(d) for d in dets], "raw": result.raw if result else None,
    }
    _write_atomic(path, payload)
    return payload, False


def _insert(ctx: JobContext, run_id: str, dets: list[Detection], by_name: dict[str, str]) -> int:
    rows = [
        MapDetection(run_id=run_id, class_id=by_name[d.label], confidence=d.confidence, x=d.x, y=d.y, w=d.w, h=d.h)
        for d in dets
        if d.label in by_name
    ]
    if rows:
        with ctx.project.session() as s:
            s.add_all(rows)
    return len(rows)


@register_job_type("map_detect")
def run_map_detect(ctx: JobContext) -> dict:
    run, gmap, names, by_name = _load(ctx)
    provider = _provider(ctx, run, names)
    scale = gsd_scale(gmap.gsd_cm, run.target_gsd_cm)
    wins = plan_windows(gmap.width, gmap.height, run.tile_size, run.overlap, scale)
    with ctx.project.session() as s:
        s.execute(delete(MapDetection).where(MapDetection.run_id == run.id))
    totals = {"windows": len(wins), "skipped_windows": 0, "cached_windows": 0, "failed_windows": 0, "detections": 0}
    merger = StripMerger(run.nms_iou)
    done = 0
    with rasterio.open(map_raster_path(ctx.project, gmap.id)) as src:
        mask, mscale = raster.low_res_mask(src)
        for strip in strips(wins):
            strip_dets: list[Detection] = []
            for win in strip:
                ctx.check_cancelled()
                payload, cached = _window_result(ctx, run, provider, names, src, mask, mscale, win, gmap)
                totals["cached_windows"] += cached
                totals["skipped_windows"] += payload.get("skipped", False)
                totals["failed_windows"] += payload.get("failed", False)
                strip_dets += [
                    Detection(**{k: v for k, v in d.items() if k in Detection.__dataclass_fields__})
                    for d in payload["detections"]
                    if d["confidence"] >= run.conf
                ]
                done += 1
                pending = totals["detections"] + len(merger.pending) + len(strip_dets)
                ctx.progress(done / len(wins), f"window {done} / {len(wins)} · {pending} detections")
            totals["detections"] += _insert(ctx, run.id, merger.add_strip(strip[0].y, strip_dets), by_name)
        totals["detections"] += _insert(ctx, run.id, merger.finish(), by_name)
    with ctx.project.session() as s:
        counts = dict(
            s.execute(
                select(MapDetection.class_id, func.count()).where(MapDetection.run_id == run.id).group_by(MapDetection.class_id)
            ).all()
        )
        s.get(MapRun, run.id).counts = counts
    ctx.publish("map_runs.changed", {"map_id": gmap.id, "run_ids": [run.id]})
    if run.kind == "local_model" and not totals["failed_windows"]:
        shutil.rmtree(windows_dir(ctx.project, run).parent, ignore_errors=True)  # repeatable for free
    ctx.log.info("map run %s finished: %s", run.id, totals)
    return {"map_run_id": run.id, **totals}
```

- [ ] **Step 7: Add the run routes**

In `backend/app/maps/router.py`:

- Add the imports:
  - `from fastapi import Query`
  - `from app.maps.jobs_detect import run_map_detect  # noqa: F401 - registers map_detect`
  - `from app.maps.schemas import MapDensity, MapDensityCell, MapDetectionOut, MapDetectionPage, MapRunCreate, MapRunEstimate, MapRunList, MapRunOut, MapRunWithJob`
  - `from app.training.schemas import JobRef`
- Add the routes below, before `STUBS`.
- Delete these entries from `STUBS`, and from `EXPECTED_STUBS` in `test_contract.py`: `listMapRuns`, `estimateMapRun`, `createMapRun`, `getMapRun`, `deleteMapRun`, `resumeMapRun`, `listMapDetections`, `getMapDensity`.

```python
def _submit_detect(request: Request, handle: ProjectHandle, run_id: str):
    return request.app.state.jobs.submit(handle, "map_detect", {"map_run_id": run_id})


@router.get("/maps/{mapId}/runs", response_model=MapRunList)
def list_map_runs(mapId: str, handle: ProjectHandle = Depends(get_project)) -> MapRunList:  # noqa: N803
    return MapRunList(items=[MapRunOut.from_row(r, st, n) for r, st, n in service.list_runs(handle, mapId)])


@router.post("/map-runs/estimate", response_model=MapRunEstimate)
def estimate_map_run(body: MapRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)) -> MapRunEstimate:
    return MapRunEstimate(**service.estimate_run(handle, request.app.state.provider_config, body))


@router.post("/map-runs", response_model=MapRunWithJob, status_code=202)
def create_map_run(body: MapRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)) -> MapRunWithJob:
    run = service.create_run(handle, request.app.state.keys, request.app.state.provider_config, body)
    job = _submit_detect(request, handle, run.id)
    run = service.set_run_job(handle, run.id, job.id)
    return MapRunWithJob(run=MapRunOut.from_row(run, job.state, 0), job=JobOut.from_row(job, handle.id))


@router.get("/map-runs/{runId}", response_model=MapRunOut)
def get_map_run(runId: str, handle: ProjectHandle = Depends(get_project)) -> MapRunOut:  # noqa: N803
    return MapRunOut.from_row(*service.get_run(handle, runId))


@router.delete("/map-runs/{runId}", status_code=204)
def delete_map_run(runId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_run(handle, runId, request.app.state.jobs.is_live)
    return Response(status_code=204)


@router.post("/map-runs/{runId}/resume", response_model=JobRef, status_code=202)
def resume_map_run(runId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:  # noqa: N803
    job = service.resume_run(handle, runId, lambda run: _submit_detect(request, handle, run.id))
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get("/map-runs/{runId}/detections", response_model=MapDetectionPage)
def list_map_detections(
    runId: str,  # noqa: N803
    bbox: str | None = None,
    min_conf: float | None = Query(None, ge=0, le=1),
    class_id: str | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> MapDetectionPage:
    rows, truncated = service.detections_in(handle, runId, bbox, min_conf, class_id)
    return MapDetectionPage(items=[MapDetectionOut.from_row(r) for r in rows], truncated=truncated)


@router.get("/map-runs/{runId}/density", response_model=MapDensity)
def get_map_density(
    runId: str,  # noqa: N803
    cells: int = Query(128, ge=1, le=256),
    min_conf: float | None = Query(None, ge=0, le=1),
    handle: ProjectHandle = Depends(get_project),
) -> MapDensity:
    cell, rows = service.density(handle, runId, cells, min_conf)
    return MapDensity(cell_size=cell, cells=[MapDensityCell(**r) for r in rows])
```

- [ ] **Step 8: Run the tests**

Run: `cd backend; $PY -m pytest tests/test_maps_detect.py tests/test_contract.py tests/test_query_runs.py -q`
Expected: all pass. `test_query_runs.py` is included because `_validate` and the inference job
helpers are shared.

The squares fixture goes through JPEG compression, so blob edges can soften. The `area >= 20`
filter and the ±4 px tolerance absorb that. If the seam test counts 2, print the two boxes:

- a sliver of about 30 px means `drop_cut_boxes` is not being applied;
- two near-equal boxes mean NMS is not merging them, so check that `strip[0].y` is passed as `top`.

- [ ] **Step 9: Lint, full suite, commit**

Run: `cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest -q`

```bash
git add backend/app/maps/jobs_detect.py backend/app/maps/schemas.py backend/app/maps/service.py backend/app/maps/router.py backend/tests/geotiffs.py backend/tests/test_maps_detect.py backend/tests/test_contract.py
git commit -m "feat(maps): map_detect job with resumable windows; runs, estimate, detections, density

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 8: Zones, labels, seed-from-run and scoring

**Files:**
- Create: `backend/app/maps/scoring.py`
- Modify: `backend/app/maps/schemas.py`, `backend/app/maps/service.py`, `backend/app/maps/router.py`, `backend/tests/test_contract.py`
- Test: `backend/tests/test_maps_scoring.py` (pure), `backend/tests/test_maps_labels.py` (API)

**Interfaces:**
- Consumes: Task 3 tables; Task 5 `service._get`, `bump_labels_version`; Task 7 `service._run`.
- Produces:
  - `scoring.ScoreBox(id, class_id, x, y, w, h, confidence=None)`
  - `scoring.Zone(id, polygon)`
  - `scoring.point_in_polygon(x, y, polygon) -> bool`
  - `scoring.zone_of(box, zones) -> str | None`
  - `scoring.score(detections, labels, zones, iou_threshold) -> dict`, shaped like `MapScore` minus `run_id` and `labels_version`
  - Schemas: `MapZoneOut`, `MapZoneCreate`, `MapZoneUpdate`, `MapZoneList`, `MapLabelOut`, `MapLabelCreate`, `MapLabelUpdate`, `MapLabelList`, `MapLabelSeed`, `MapLabelSeedResult`, `MapScoreOut` (a dict passthrough model)
  - Service functions:
    - `list_zones`, `create_zone`, `update_zone`, `delete_zone`
    - `list_labels`, `create_label`, `update_label`, `delete_label`
    - `seed_labels(handle, map_id, body) -> int`
    - `score_run(handle, run_id, iou) -> dict`
    - `MAX_LABELS = 20000`
  - event `map_labels.changed` with payload `{"map_id"}`

- [ ] **Step 1: Write the failing scoring tests**

`backend/tests/test_maps_scoring.py`:

```python
import pytest

from app.maps.scoring import ScoreBox, Zone, point_in_polygon, score, zone_of

EXC, TRK = "exc", "trk"
Z = [Zone("z1", [(0, 0), (1000, 0), (1000, 1000), (0, 1000)])]


def d(id, cls, x, y, conf=0.9, w=100, h=100):
    return ScoreBox(id, cls, x, y, w, h, conf)


def lab(id, cls, x, y, w=100, h=100):
    return ScoreBox(id, cls, x, y, w, h)


def test_point_in_polygon():
    tri = [(0, 0), (10, 0), (0, 10)]
    assert point_in_polygon(2, 2, tri) and not point_in_polygon(8, 8, tri)


def test_zone_uses_the_box_centre():
    assert zone_of(lab("a", EXC, 950, 100), Z) is None  # centre at x 1000 is on the edge: outside
    assert zone_of(lab("b", EXC, 940, 100), Z) == "z1"


def test_perfect_run():
    s = score([d("d1", EXC, 100, 100)], [lab("l1", EXC, 105, 100)], Z, 0.5)
    o = s["overall"]
    assert (o["tp"], o["fp"], o["fn"], o["precision"], o["recall"], o["f1"]) == (1, 0, 0, 1.0, 1.0, 1.0)
    assert (o["predicted"], o["actual"], o["count_error"], o["count_error_pct"]) == (1, 1, 0, 0.0)
    assert {(m["kind"], m["match"]) for m in s["matches"]} == {("detection", "tp"), ("label", "tp")}


def test_all_false_positives_and_all_missed():
    s = score([d("d1", EXC, 100, 100)], [lab("l1", EXC, 600, 600)], Z, 0.5)
    o = s["overall"]
    assert (o["tp"], o["fp"], o["fn"], o["precision"], o["recall"]) == (0, 1, 1, 0.0, 0.0)
    assert o["f1"] is None or o["f1"] == 0.0


def test_empty_run_has_undefined_precision():
    o = score([], [lab("l1", EXC, 100, 100)], Z, 0.5)["overall"]
    assert o["precision"] is None and o["recall"] == 0.0 and o["count_error"] == -1
    assert o["count_error_pct"] == pytest.approx(-100.0)


def test_class_confusion_is_one_fp_and_one_fn():
    s = score([d("d1", TRK, 100, 100)], [lab("l1", EXC, 100, 100)], Z, 0.5)
    rows = {r["class_id"]: r for r in s["per_class"]}
    assert rows[TRK]["fp"] == 1 and rows[EXC]["fn"] == 1


def test_highest_confidence_claims_the_label_first():
    dets = [d("low", EXC, 110, 100, conf=0.5), d("high", EXC, 100, 100, conf=0.95)]
    s = score(dets, [lab("l1", EXC, 100, 100)], Z, 0.5)
    by_id = {m["id"]: m["match"] for m in s["matches"] if m["kind"] == "detection"}
    assert by_id == {"high": "tp", "low": "fp"}


def test_iou_threshold_edge():
    # 100x100 boxes offset by 50 px on x: IoU = 5000 / 15000 = 0.333
    pair = ([d("d1", EXC, 150, 100)], [lab("l1", EXC, 100, 100)])
    assert score(*pair, Z, 0.33)["overall"]["tp"] == 1
    assert score(*pair, Z, 0.34)["overall"]["tp"] == 0


def test_boxes_outside_every_zone_do_not_count_and_zones_break_down():
    zones = Z + [Zone("z2", [(2000, 0), (3000, 0), (3000, 1000), (2000, 1000)])]
    dets = [d("in1", EXC, 100, 100), d("in2", EXC, 2100, 100), d("out", EXC, 5000, 5000)]
    labels = [lab("l1", EXC, 100, 100), lab("l2", EXC, 2500, 500)]
    s = score(dets, labels, zones, 0.5)
    assert s["overall"]["predicted"] == 2 and s["overall"]["actual"] == 2
    zrows = {r["zone_id"]: r for r in s["per_zone"]}
    assert zrows["z1"]["tp"] == 1 and zrows["z2"]["fp"] == 1 and zrows["z2"]["fn"] == 1
    assert "out" not in {m["id"] for m in s["matches"]}


def test_no_zones_scores_nothing():
    s = score([d("d1", EXC, 1, 1)], [lab("l1", EXC, 1, 1)], [], 0.5)
    assert s["has_zones"] is False and s["overall"]["predicted"] == 0
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_scoring.py -q`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `scoring.py`**

`backend/app/maps/scoring.py`:

```python
"""A run scored against ground truth inside evaluation zones (spec section 8).

Only boxes whose centre lies inside a zone count: a zone is the operator's promise that every
machine in it is labelled. Matching is greedy per class, highest confidence first, each detection
taking the unmatched label it overlaps most (IoU at least the threshold). Unmatched detections are
false positives, unmatched labels are misses.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScoreBox:
    id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float
    confidence: float | None = None


@dataclass(frozen=True)
class Zone:
    id: str
    polygon: list[tuple[float, float]]


def point_in_polygon(x: float, y: float, polygon) -> bool:
    """Ray casting; a point exactly on the right or bottom edge is outside."""
    inside = False
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def zone_of(box: ScoreBox, zones: list[Zone]) -> str | None:
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    return next((z.id for z in zones if point_in_polygon(cx, cy, z.polygon)), None)


def _iou(a: ScoreBox, b: ScoreBox) -> float:
    ix = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
    iy = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    if ix <= 0 or iy <= 0:
        return 0.0
    inter = ix * iy
    return inter / (a.w * a.h + b.w * b.h - inter)


def _row(tp: int, fp: int, fn: int, class_id: str | None = None) -> dict:
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else (0.0 if precision == 0 or recall == 0 else None)
    predicted, actual = tp + fp, tp + fn
    return {
        "class_id": class_id, "tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall, "f1": f1,
        "predicted": predicted, "actual": actual, "count_error": predicted - actual,
        "count_error_pct": (predicted - actual) / actual * 100 if actual else None,
    }


def score(detections: list[ScoreBox], labels: list[ScoreBox], zones: list[Zone], iou_threshold: float) -> dict:
    dets = [(b, z) for b in detections if (z := zone_of(b, zones))]
    labs = [(b, z) for b in labels if (z := zone_of(b, zones))]
    matches: list[dict] = []
    taken: set[str] = set()
    for det, zone in sorted(dets, key=lambda p: -(p[0].confidence or 0.0)):
        best, best_iou = None, iou_threshold
        for lab, _ in labs:
            if lab.class_id != det.class_id or lab.id in taken:
                continue
            v = _iou(det, lab)
            if v >= best_iou:
                best, best_iou = lab, v
        if best is not None:
            taken.add(best.id)
        matches.append({"kind": "detection", "id": det.id, "match": "tp" if best else "fp", "zone_id": zone,
                        "class_id": det.class_id, "x": det.x, "y": det.y, "w": det.w, "h": det.h})
    for lab, zone in labs:
        matches.append({"kind": "label", "id": lab.id, "match": "tp" if lab.id in taken else "fn", "zone_id": zone,
                        "class_id": lab.class_id, "x": lab.x, "y": lab.y, "w": lab.w, "h": lab.h})

    def tally(pred) -> tuple[int, int, int]:
        sel = [m for m in matches if pred(m)]
        tp = sum(1 for m in sel if m["kind"] == "detection" and m["match"] == "tp")
        return tp, sum(1 for m in sel if m["match"] == "fp"), sum(1 for m in sel if m["match"] == "fn")

    classes = sorted({m["class_id"] for m in matches})
    return {
        "iou": iou_threshold,
        "has_zones": bool(zones),
        "overall": _row(*tally(lambda m: True)),
        "per_class": [_row(*tally(lambda m, c=c: m["class_id"] == c), class_id=c) for c in classes],
        "per_zone": [{**_row(*tally(lambda m, z=z: m["zone_id"] == z.id)), "zone_id": z.id} for z in zones],
        "matches": [{k: m[k] for k in ("kind", "id", "match", "zone_id", "class_id", "x", "y", "w", "h")} for m in matches],
    }
```

Both halves of a TP pair are tagged `tp` in `matches`, but only detections count toward `tp` in
`tally`, so a pair counts once. FP comes only from detections, FN only from labels.

- [ ] **Step 4: Run the scoring tests**

Run: `cd backend; $PY -m pytest tests/test_maps_scoring.py -q`
Expected: `10 passed`.

`test_all_false_positives_and_all_missed` expects `f1` to be `0.0`: precision and recall are both
0.0, and the `_row` expression gives 0.0 in that case. The test accepts `None` or `0.0`; keep the
implementation at 0.0.

- [ ] **Step 5: Write the failing labels/zones API tests**

`backend/tests/test_maps_labels.py`:

```python
"""Zones, labels, seeding from a run, and a run's score through the API (spec section 8)."""

import pytest
from geotiffs import make_squares_geotiff
from test_maps_detect import SQUARES, SquareProvider, run_body, start  # reuse the detect fixtures' helpers

BASE = "/api/v1/projects"
ZONE = [[0, 0], [1500, 0], [1500, 1500], [0, 1500]]  # holds squares 1 and 2 of SQUARES


@pytest.fixture
def ready_map(client, project_id, wait_job, tmp_path):
    path = make_squares_geotiff(tmp_path / "sq.tif", 3000, 1500, SQUARES)
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path)})
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    return r.json()["map"]["id"]


@pytest.fixture
def run_id(client, project_id, wait_job, ready_map, monkeypatch, app):
    app.state.keys.set("anthropic", "sk-fake-key")
    monkeypatch.setattr("app.maps.jobs_detect.get_provider", lambda *a, **k: SquareProvider())
    rid, _ = start(client, project_id, wait_job, run_body(ready_map))
    return rid


def test_zone_crud_bumps_labels_version(client, project_id, ready_map):
    url = f"{BASE}/{project_id}/maps/{ready_map}"
    v0 = client.get(url).json()["labels_version"]
    z = client.post(f"{url}/zones", json={"name": "Zone 1", "polygon": ZONE})
    assert z.status_code == 201
    zid = z.json()["id"]
    assert client.patch(f"{url}/zones/{zid}", json={"name": "North"}).json()["name"] == "North"
    assert [i["name"] for i in client.get(f"{url}/zones").json()["items"]] == ["North"]
    assert client.delete(f"{url}/zones/{zid}").status_code == 204
    assert client.get(url).json()["labels_version"] == v0 + 3


def test_label_crud_and_unknown_class(client, project_id, ready_map, project):
    url = f"{BASE}/{project_id}/maps/{ready_map}/labels"
    cls = project["classes"][0]["id"]
    lab = client.post(url, json={"class_id": cls, "x": 200, "y": 200, "w": 60, "h": 60})
    assert lab.status_code == 201 and lab.json()["source"] == "manual"
    lid = lab.json()["id"]
    assert client.patch(f"{url}/{lid}", json={"w": 70}).json()["w"] == 70
    assert client.post(url, json={"class_id": "nope", "x": 1, "y": 1, "w": 1, "h": 1}).status_code == 422
    assert client.post(url, json={"class_id": cls, "x": 2990, "y": 1, "w": 50, "h": 5}).status_code == 422  # off the map
    assert client.delete(f"{url}/{lid}").status_code == 204
    assert client.get(url).json()["items"] == []


def test_seed_then_edit_then_score(client, project_id, ready_map, run_id, project):
    url = f"{BASE}/{project_id}/maps/{ready_map}"
    zid = client.post(f"{url}/zones", json={"name": "Z", "polygon": ZONE}).json()["id"]
    r = client.post(f"{url}/labels/seed", json={"run_id": run_id, "zone_id": zid})
    assert r.status_code == 200 and r.json()["created"] == 2
    labels = client.get(f"{url}/labels").json()["items"]
    assert {lab["source"] for lab in labels} == {f"from_run:{run_id}"}
    edited = client.patch(f"{url}/labels/{labels[0]['id']}", json={"x": labels[0]["x"] + 1}).json()
    assert edited["source"] == "manual"

    s = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").json()
    assert s["has_zones"] and s["overall"]["tp"] == 2 and s["overall"]["fp"] == 0 and s["overall"]["fn"] == 0
    # a label the run never found: one miss, recall 2/3
    cls = project["classes"][0]["id"]
    client.post(f"{url}/labels", json={"class_id": cls, "x": 800, "y": 800, "w": 60, "h": 60})
    s2 = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").json()
    assert s2["overall"]["fn"] == 1 and s2["overall"]["recall"] == pytest.approx(2 / 3)
    assert s2["labels_version"] > s["labels_version"]


def test_score_without_zones(client, project_id, run_id):
    s = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").json()
    assert s["has_zones"] is False and s["overall"]["predicted"] == 0
```

`test_maps_detect.py` has no `__init__` import issues: `tests/` is on `sys.path`, and pytest
imports modules by basename (see how `local_paths` is imported). Importing its helpers also
imports its fixtures into this namespace, which is harmless.

- [ ] **Step 6: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_labels.py -q`
Expected: FAIL (501).

- [ ] **Step 7: Append the zone, label and score schemas**

Append to `backend/app/maps/schemas.py` (and add `from app.db.models import MapLabel, MapZone`):

```python
Point = list[float]


class MapZoneOut(BaseModel):
    id: str
    map_id: str
    name: str
    polygon: list[Point]

    @classmethod
    def from_row(cls, r: MapZone) -> MapZoneOut:
        return cls(id=r.id, map_id=r.map_id, name=r.name, polygon=r.polygon)


class MapZoneCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    polygon: list[Point] = Field(min_length=3, max_length=1000)


class MapZoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    polygon: list[Point] | None = Field(default=None, min_length=3, max_length=1000)


class MapZoneList(BaseModel):
    items: list[MapZoneOut]


class MapLabelOut(BaseModel):
    id: str
    map_id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float
    angle: float | None
    source: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, r: MapLabel) -> MapLabelOut:
        return cls(
            id=r.id, map_id=r.map_id, class_id=r.class_id, x=r.x, y=r.y, w=r.w, h=r.h, angle=r.angle,
            source=r.source, created_at=r.created_at, updated_at=r.updated_at,
        )


class MapLabelCreate(BaseModel):
    class_id: str
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class MapLabelUpdate(BaseModel):
    class_id: str | None = None
    x: float | None = Field(default=None, ge=0)
    y: float | None = Field(default=None, ge=0)
    w: float | None = Field(default=None, gt=0)
    h: float | None = Field(default=None, gt=0)


class MapLabelList(BaseModel):
    items: list[MapLabelOut]


class MapLabelSeed(BaseModel):
    run_id: str
    zone_id: str
    min_conf: float = Field(default=0.25, ge=0, le=1)


class MapLabelSeedResult(BaseModel):
    created: int
```

Each `Point` is validated to length 2 in the service, not in pydantic: an odd-length point is a
422 with a clear message.

- [ ] **Step 8: Append the zone, label, seed and score service functions**

Append to `backend/app/maps/service.py`. Extend the imports with `from collections import OrderedDict`, `from app.db.models import MapLabel, MapZone`, `from app.inference.service import class_ids_by_name`, `from app.maps import scoring`, and the new schemas.

```python
MAX_LABELS = 20000
_SCORE_CACHE: OrderedDict[tuple, dict] = OrderedDict()
_SCORE_CACHE_ITEMS = 64
_SCORE_LOCK = threading.Lock()


def _check_polygon(polygon: list[list[float]]) -> list[list[float]]:
    if any(len(p) != 2 for p in polygon):
        raise AppError("validation_error", "each polygon point is [x, y]", 422)
    return [[float(x), float(y)] for x, y in polygon]


def _zone(s: Session, map_id: str, zone_id: str) -> MapZone:
    row = s.get(MapZone, zone_id)
    if row is None or row.map_id != map_id:
        raise not_found("zone", zone_id)
    return row


def list_zones(handle: ProjectHandle, map_id: str) -> list[MapZone]:
    with handle.session() as s:
        _get(s, map_id)
        rows = list(s.execute(select(MapZone).where(MapZone.map_id == map_id).order_by(MapZone.created_at)).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def create_zone(handle: ProjectHandle, map_id: str, body: MapZoneCreate) -> MapZone:
    with handle.session() as s:
        _get(s, map_id)
        row = MapZone(map_id=map_id, name=body.name, polygon=_check_polygon(body.polygon))
        s.add(row)
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def update_zone(handle: ProjectHandle, map_id: str, zone_id: str, body: MapZoneUpdate) -> MapZone:
    with handle.session() as s:
        row = _zone(s, map_id, zone_id)
        if body.name is not None:
            row.name = body.name
        if body.polygon is not None:
            row.polygon = _check_polygon(body.polygon)
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def delete_zone(handle: ProjectHandle, map_id: str, zone_id: str) -> None:
    with handle.session() as s:
        s.delete(_zone(s, map_id, zone_id))
        bump_labels_version(s, map_id)


def _label(s: Session, map_id: str, label_id: str) -> MapLabel:
    row = s.get(MapLabel, label_id)
    if row is None or row.map_id != map_id:
        raise not_found("label", label_id)
    return row


def _check_box(s: Session, handle: ProjectHandle, gmap: GeoMap, class_id: str, x, y, w, h) -> None:
    if class_id not in set(class_ids_by_name(handle, s).values()):
        raise AppError("validation_error", f"unknown class {class_id}", 422)
    if x + w > gmap.width or y + h > gmap.height:
        raise AppError("validation_error", "the box leaves the map", 422)


def list_labels(handle: ProjectHandle, map_id: str) -> list[MapLabel]:
    with handle.session() as s:
        _get(s, map_id)
        rows = list(s.execute(select(MapLabel).where(MapLabel.map_id == map_id).limit(MAX_LABELS)).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def create_label(handle: ProjectHandle, map_id: str, body: MapLabelCreate) -> MapLabel:
    with handle.session() as s:
        gmap = _get(s, map_id)
        _check_box(s, handle, gmap, body.class_id, body.x, body.y, body.w, body.h)
        row = MapLabel(map_id=map_id, class_id=body.class_id, x=body.x, y=body.y, w=body.w, h=body.h, source="manual")
        s.add(row)
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def update_label(handle: ProjectHandle, map_id: str, label_id: str, body: MapLabelUpdate) -> MapLabel:
    with handle.session() as s:
        gmap = _get(s, map_id)
        row = _label(s, map_id, label_id)
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(row, field, value)
        _check_box(s, handle, gmap, row.class_id, row.x, row.y, row.w, row.h)
        row.source = "manual"  # a person looked at it
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def delete_label(handle: ProjectHandle, map_id: str, label_id: str) -> None:
    with handle.session() as s:
        s.delete(_label(s, map_id, label_id))
        bump_labels_version(s, map_id)


def seed_labels(handle: ProjectHandle, map_id: str, body: MapLabelSeed) -> int:
    with handle.session() as s:
        _get(s, map_id)
        zone = _zone(s, map_id, body.zone_id)
        run = _run(s, body.run_id)
        if run.map_id != map_id:
            raise AppError("validation_error", "the run belongs to another map", 422)
        area = [scoring.Zone(zone.id, [tuple(p) for p in zone.polygon])]
        rows = []
        dets = s.execute(
            select(MapDetection).where(MapDetection.run_id == run.id, MapDetection.confidence >= body.min_conf)
        ).scalars()
        for d in dets:
            box = scoring.ScoreBox(d.id, d.class_id, d.x, d.y, d.w, d.h)
            if scoring.zone_of(box, area):
                rows.append(MapLabel(map_id=map_id, class_id=d.class_id, x=d.x, y=d.y, w=d.w, h=d.h,
                                     source=f"from_run:{run.id}"))
        s.add_all(rows)
        bump_labels_version(s, map_id)
    return len(rows)


def score_run(handle: ProjectHandle, run_id: str, iou: float) -> dict:
    with handle.session() as s:
        run = _run(s, run_id)
        gmap = _get(s, run.map_id)
        key = (handle.id, run_id, gmap.labels_version, round(iou, 4), run.job_id)
        with _SCORE_LOCK:
            if key in _SCORE_CACHE:
                return _SCORE_CACHE[key]
        zones = [scoring.Zone(z.id, [tuple(p) for p in z.polygon])
                 for z in s.execute(select(MapZone).where(MapZone.map_id == gmap.id)).scalars()]
        dets = [scoring.ScoreBox(d.id, d.class_id, d.x, d.y, d.w, d.h, d.confidence)
                for d in s.execute(select(MapDetection).where(MapDetection.run_id == run_id,
                                                              MapDetection.confidence >= run.conf)).scalars()]
        labels = [scoring.ScoreBox(lab.id, lab.class_id, lab.x, lab.y, lab.w, lab.h)
                  for lab in s.execute(select(MapLabel).where(MapLabel.map_id == gmap.id)).scalars()]
        version = gmap.labels_version
    result = {"run_id": run_id, "labels_version": version, **scoring.score(dets, labels, zones, iou)}
    with _SCORE_LOCK:
        _SCORE_CACHE[key] = result
        while len(_SCORE_CACHE) > _SCORE_CACHE_ITEMS:
            _SCORE_CACHE.popitem(last=False)
    return result
```

The cache key includes `run.job_id`, so a resumed run (new job, new detections) is re-scored.
Loading every detection of the run would be unbounded for the score only if zones covered the
whole map. Scoring reads `(x, y, w, h, class, conf)` rows, not pixels, so tens of thousands of
rows is still fast. Narrowing with a SQL bounding box per zone is a later optimisation if a
profile shows the need; it is out of scope here.

- [ ] **Step 9: Add the routes**

In `backend/app/maps/router.py`:

- Import the new schemas.
- Add the routes below **before** `STUBS`. `seed` is declared before `/labels/{labelId}`.
- Delete from `STUBS`, and from `EXPECTED_STUBS`: `getMapRunScore`, `listMapZones`, `createMapZone`, `updateMapZone`, `deleteMapZone`, `listMapLabels`, `createMapLabel`, `seedMapLabels`, `updateMapLabel`, `deleteMapLabel`.

```python
def _labels_changed(request: Request, handle: ProjectHandle, map_id: str) -> None:
    request.app.state.events.publish(
        {"type": "map_labels.changed", "project_id": handle.id, "job_id": None, "progress": None,
         "message": "", "payload": {"map_id": map_id}}
    )


@router.get("/map-runs/{runId}/score", response_model=MapScoreOut)
def get_map_run_score(
    runId: str,  # noqa: N803
    iou: float = Query(0.5, ge=0.05, le=0.95),
    handle: ProjectHandle = Depends(get_project),
) -> MapScoreOut:
    return MapScoreOut(**service.score_run(handle, runId, iou))


@router.get("/maps/{mapId}/zones", response_model=MapZoneList)
def list_map_zones(mapId: str, handle: ProjectHandle = Depends(get_project)) -> MapZoneList:  # noqa: N803
    return MapZoneList(items=[MapZoneOut.from_row(z) for z in service.list_zones(handle, mapId)])


@router.post("/maps/{mapId}/zones", response_model=MapZoneOut, status_code=201)
def create_map_zone(mapId: str, body: MapZoneCreate, request: Request, handle: ProjectHandle = Depends(get_project)) -> MapZoneOut:  # noqa: N803
    row = service.create_zone(handle, mapId, body)
    _labels_changed(request, handle, mapId)
    return MapZoneOut.from_row(row)


@router.patch("/maps/{mapId}/zones/{zoneId}", response_model=MapZoneOut)
def update_map_zone(mapId: str, zoneId: str, body: MapZoneUpdate, request: Request, handle: ProjectHandle = Depends(get_project)) -> MapZoneOut:  # noqa: N803
    row = service.update_zone(handle, mapId, zoneId, body)
    _labels_changed(request, handle, mapId)
    return MapZoneOut.from_row(row)


@router.delete("/maps/{mapId}/zones/{zoneId}", status_code=204)
def delete_map_zone(mapId: str, zoneId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_zone(handle, mapId, zoneId)
    _labels_changed(request, handle, mapId)
    return Response(status_code=204)


@router.get("/maps/{mapId}/labels", response_model=MapLabelList)
def list_map_labels(mapId: str, handle: ProjectHandle = Depends(get_project)) -> MapLabelList:  # noqa: N803
    return MapLabelList(items=[MapLabelOut.from_row(r) for r in service.list_labels(handle, mapId)])


@router.post("/maps/{mapId}/labels", response_model=MapLabelOut, status_code=201)
def create_map_label(mapId: str, body: MapLabelCreate, request: Request, handle: ProjectHandle = Depends(get_project)) -> MapLabelOut:  # noqa: N803
    row = service.create_label(handle, mapId, body)
    _labels_changed(request, handle, mapId)
    return MapLabelOut.from_row(row)


@router.post("/maps/{mapId}/labels/seed", response_model=MapLabelSeedResult)
def seed_map_labels(mapId: str, body: MapLabelSeed, request: Request, handle: ProjectHandle = Depends(get_project)) -> MapLabelSeedResult:  # noqa: N803
    created = service.seed_labels(handle, mapId, body)
    _labels_changed(request, handle, mapId)
    return MapLabelSeedResult(created=created)


@router.patch("/maps/{mapId}/labels/{labelId}", response_model=MapLabelOut)
def update_map_label(mapId: str, labelId: str, body: MapLabelUpdate, request: Request, handle: ProjectHandle = Depends(get_project)) -> MapLabelOut:  # noqa: N803
    row = service.update_label(handle, mapId, labelId, body)
    _labels_changed(request, handle, mapId)
    return MapLabelOut.from_row(row)


@router.delete("/maps/{mapId}/labels/{labelId}", status_code=204)
def delete_map_label(mapId: str, labelId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_label(handle, mapId, labelId)
    _labels_changed(request, handle, mapId)
    return Response(status_code=204)
```

Add `MapScoreOut` to `schemas.py`. It must validate against the contract, so it is typed:

```python
class MapScoreRow(BaseModel):
    class_id: str | None
    tp: int
    fp: int
    fn: int
    precision: float | None
    recall: float | None
    f1: float | None
    predicted: int
    actual: int
    count_error: int
    count_error_pct: float | None


class MapScoreZoneRow(MapScoreRow):
    zone_id: str


class MapScoreMatch(BaseModel):
    kind: Literal["detection", "label"]
    id: str
    match: Literal["tp", "fp", "fn"]
    zone_id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float


class MapScoreOut(BaseModel):
    run_id: str
    iou: float
    labels_version: int
    has_zones: bool
    overall: MapScoreRow
    per_class: list[MapScoreRow]
    per_zone: list[MapScoreZoneRow]
    matches: list[MapScoreMatch]
```

Check that the events envelope keys in `_labels_changed` match what `EventBus.publish` expects:
compare with `JobContext.publish` in `app/jobs/runner.py`, which uses the same seven keys. If
`app/events_util.py` has a helper for request-scoped events (it does, for `boxes.changed`: see
`publish_image_ids_event`), prefer adding a sibling helper there over the inline dict.

- [ ] **Step 10: Run the tests**

Run: `cd backend; $PY -m pytest tests/test_maps_scoring.py tests/test_maps_labels.py tests/test_contract.py -q`
Expected: all pass.

- [ ] **Step 11: Lint, full suite, commit**

Run: `cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest -q`

```bash
git add backend/app/maps/scoring.py backend/app/maps/schemas.py backend/app/maps/service.py backend/app/maps/router.py backend/tests/test_maps_scoring.py backend/tests/test_maps_labels.py backend/tests/test_contract.py
git commit -m "feat(maps): evaluation zones, labels, seed-from-run and zone-scoped scoring

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 9: `map_export`: GeoJSON (WGS84), GeoPackage (map CRS), CSV (both), summary

**Files:**
- Create: `backend/app/maps/geo_out.py`, `backend/app/maps/gpkg.py`, `backend/app/maps/jobs_export.py`
- Modify: `backend/app/maps/schemas.py`, `backend/app/maps/router.py`, `backend/tests/test_contract.py`
- Test: `backend/tests/test_maps_export.py`

**Interfaces:**
- Consumes:
  - Task 4 `Georef`, `box_corners`;
  - Task 7 `service.get_run`;
  - Task 8 `service.score_run`, `list_zones`, `list_labels`;
  - from `app.exports.job`: `_reserve_partial_folder`, `_promote`, `_now_local`.
- Produces:
  - `geo_out.ExportBox(kind, id, class_name, confidence, match, source, x, y, w, h, angle)`
  - `geo_out.CSV_COLUMNS: list[str]`
  - `geo_out.write_csv(path, boxes, georef, epsg) -> None`
  - `geo_out.write_geojson(path, boxes, zones, georef) -> None`
  - `geo_out.write_summary(path, summary: dict) -> None`
  - `gpkg.Layer(name, columns, features)`
  - `gpkg.write_gpkg(path, layers, *, srs_id, srs_name, organization, organization_id, wkt) -> None`
  - `schemas.MapExportRequest`
  - `service.validate_export(handle, body) -> GeoMap`
  - job type `map_export`; its result is `{"folder", "files", "box_count"}`, the same keys as `results_export`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_maps_export.py`:

```python
"""Coordinates out of a map: CSV, GeoJSON, GeoPackage, summary (spec section 9)."""

import csv
import json
import sqlite3
import struct

import pytest
from geotiffs import make_geotiff
from pyproj import CRS, Transformer

from app.maps import geo_out, gpkg
from app.maps.georef import Georef

UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)
BOX = geo_out.ExportBox("detection", "d1", "excavator", 0.9, "tp", "", 1000.0, 2000.0, 100.0, 50.0, None)
REF = Transformer.from_crs("EPSG:32633", "EPSG:4326", always_xy=True)


def test_csv_has_native_and_wgs84_corners(tmp_path):
    geo_out.write_csv(tmp_path / "b.csv", [BOX], Georef(GT, UTM33), 32633)
    row = next(csv.DictReader((tmp_path / "b.csv").open(encoding="utf-8")))
    assert list(row) == geo_out.CSV_COLUMNS
    cx, cy = 500000 + 1050 * 0.03, 4983000 - 2025 * 0.03
    assert float(row["cx"]) == pytest.approx(cx) and float(row["cy"]) == pytest.approx(cy)
    assert float(row["x1"]) == pytest.approx(500030.0) and float(row["y1"]) == pytest.approx(4982940.0)
    lon, lat = REF.transform(cx, cy)
    assert float(row["clon"]) == pytest.approx(lon, abs=1e-9) and float(row["clat"]) == pytest.approx(lat, abs=1e-9)
    assert row["epsg"] == "32633"
    assert float(row["width_m"]) == pytest.approx(3.0) and float(row["area_m2"]) == pytest.approx(4.5)


def test_csv_without_coordinates_keeps_pixels_only(tmp_path):
    geo_out.write_csv(tmp_path / "b.csv", [BOX], None, None)
    row = next(csv.DictReader((tmp_path / "b.csv").open(encoding="utf-8")))
    assert row["px_x"] == "1000.0" and row["cx"] == "" and row["clon"] == ""


def test_geojson_is_wgs84_closed_polygons(tmp_path):
    zone = ("z1", "Zone 1", [[0, 0], [100, 0], [100, 100]])
    geo_out.write_geojson(tmp_path / "b.geojson", [BOX], [zone], Georef(GT, UTM33))
    fc = json.loads((tmp_path / "b.geojson").read_text("utf-8"))
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) == 2
    ring = fc["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 5
    assert ring[0] == pytest.approx(list(REF.transform(500030.0, 4982940.0)), abs=1e-9)
    assert fc["features"][0]["properties"] == {
        "kind": "detection", "id": "d1", "class": "excavator", "confidence": 0.9, "match": "tp", "source": "",
    }
    assert fc["features"][1]["properties"]["kind"] == "zone"


def _blob(con, table):
    return con.execute(f"SELECT geom FROM {table}").fetchone()[0]


def test_geopackage_structure_and_geometry(tmp_path):
    ring = [(1.0, 2.0), (3.0, 2.0), (3.0, 4.0), (1.0, 4.0)]
    layer = gpkg.Layer("detections", [("class", "TEXT"), ("confidence", "REAL")], [(ring, {"class": "excavator", "confidence": 0.9})])
    path = tmp_path / "x.gpkg"
    gpkg.write_gpkg(path, [layer], srs_id=32633, srs_name="WGS 84 / UTM zone 33N", organization="EPSG", organization_id=32633, wkt=UTM33)
    con = sqlite3.connect(path)
    assert con.execute("PRAGMA application_id").fetchone()[0] == 0x47504B47
    assert con.execute("SELECT srs_id FROM gpkg_contents WHERE table_name='detections'").fetchone()[0] == 32633
    assert con.execute("SELECT min_x, max_y FROM gpkg_contents").fetchone() == (1.0, 4.0)
    assert con.execute("SELECT geometry_type_name FROM gpkg_geometry_columns").fetchone()[0] == "POLYGON"
    blob = _blob(con, "detections")
    assert blob[:2] == b"GP" and blob[3] == 0b011  # little endian, xy envelope
    assert struct.unpack("<i", blob[4:8])[0] == 32633
    assert struct.unpack("<4d", blob[8:40]) == (1.0, 3.0, 2.0, 4.0)
    wkb = blob[40:]
    assert wkb[0] == 1 and struct.unpack("<III", wkb[1:13]) == (3, 1, 5)  # polygon, 1 ring, 5 points
    assert struct.unpack("<2d", wkb[13:29]) == (1.0, 2.0)
    assert con.execute("SELECT class, confidence FROM detections").fetchone() == ("excavator", 0.9)


BASE = "/api/v1/projects"


def test_export_job_writes_every_format(client, project_id, wait_job, tmp_path, handle, project):
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(make_geotiff(tmp_path / "a.tif", 3000, 3000))})
    map_id = r.json()["map"]["id"]
    wait_job(project_id, r.json()["job"]["id"])
    cls = project["classes"][0]["id"]
    client.post(f"{BASE}/{project_id}/maps/{map_id}/zones", json={"name": "Z", "polygon": [[0, 0], [3000, 0], [3000, 3000]]})
    client.post(f"{BASE}/{project_id}/maps/{map_id}/labels", json={"class_id": cls, "x": 1000, "y": 2000, "w": 100, "h": 50})
    body = {"map_id": map_id, "content": "labels", "formats": ["geojson", "gpkg", "csv"]}
    r = client.post(f"{BASE}/{project_id}/map-exports", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    folder = handle.folder / job["result"]["folder"]
    names = sorted(p.name for p in folder.iterdir())
    assert names == ["map-a-labels.csv", "map-a-labels.geojson", "map-a-labels.gpkg", "map-a-summary.json"]
    assert job["result"]["box_count"] == 1
    summary = json.loads((folder / "map-a-summary.json").read_text("utf-8"))
    assert summary["map"]["epsg"] == 32633 and summary["counts"] == {"excavator": 1}


def test_geo_formats_need_coordinates(client, project_id, wait_job, tmp_path):
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(make_geotiff(tmp_path / "p.tif", 300, 300, crs=None))})
    map_id = r.json()["map"]["id"]
    wait_job(project_id, r.json()["job"]["id"])
    bad = client.post(f"{BASE}/{project_id}/map-exports", json={"map_id": map_id, "content": "labels", "formats": ["geojson"]})
    assert bad.status_code == 422 and "no coordinates" in bad.json()["error"]["message"]
    ok = client.post(f"{BASE}/{project_id}/map-exports", json={"map_id": map_id, "content": "labels", "formats": ["csv"]})
    assert ok.status_code == 202


def test_run_content_needs_a_run_of_this_map(client, project_id, wait_job, tmp_path):
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(make_geotiff(tmp_path / "a.tif", 300, 300))})
    map_id = r.json()["map"]["id"]
    wait_job(project_id, r.json()["job"]["id"])
    bad = client.post(f"{BASE}/{project_id}/map-exports", json={"map_id": map_id, "content": "run", "formats": ["csv"]})
    assert bad.status_code == 422
```

The GeoJSON properties test pins the exact property set. When the box's `confidence` is None (a
label), the property is `null`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend; $PY -m pytest tests/test_maps_export.py -q`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Implement `gpkg.py`**

`backend/app/maps/gpkg.py`:

```python
"""A minimal OGC GeoPackage 1.3 writer: polygon layers with attributes, through sqlite3 only.

Enough for QGIS, ArcGIS and Civil 3D to open the layers in the map's own CRS, without adding
fiona or pyogrio (and their GDAL vector drivers) to the frozen bundle. Geometry is a GeoPackage
binary header (magic, version, flags, srs id, xy envelope) followed by little-endian WKB.
"""

from __future__ import annotations

import sqlite3
import struct
from dataclasses import dataclass, field
from pathlib import Path

APPLICATION_ID = 0x47504B47  # "GPKG"
USER_VERSION = 10300
FLAGS = 0b011  # bit 0: little endian; bits 1-3 = 1: envelope is [minx, maxx, miny, maxy]
WGS84_WKT = (
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'
)


@dataclass
class Layer:
    name: str
    columns: list[tuple[str, str]]  # (name, SQLite type)
    features: list[tuple[list[tuple[float, float]], dict]] = field(default_factory=list)


def _geometry(ring: list[tuple[float, float]], srs_id: int) -> bytes:
    closed = list(ring) + [ring[0]] if ring[0] != ring[-1] else list(ring)
    xs, ys = [p[0] for p in closed], [p[1] for p in closed]
    header = b"GP" + bytes([0, FLAGS]) + struct.pack("<i", srs_id) + struct.pack("<4d", min(xs), max(xs), min(ys), max(ys))
    wkb = struct.pack("<BIII", 1, 3, 1, len(closed)) + b"".join(struct.pack("<2d", x, y) for x, y in closed)
    return header + wkb


def write_gpkg(
    path: Path, layers: list[Layer], *, srs_id: int, srs_name: str, organization: str, organization_id: int, wkt: str
) -> None:
    path.unlink(missing_ok=True)
    con = sqlite3.connect(path)
    try:
        con.execute(f"PRAGMA application_id = {APPLICATION_ID}")
        con.execute(f"PRAGMA user_version = {USER_VERSION}")
        con.executescript(
            """
            CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY,
              organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL,
              description TEXT);
            CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
              identifier TEXT UNIQUE, description TEXT DEFAULT '',
              last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER,
              CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
            CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL,
              geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL,
              CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
            """
        )
        srs_rows = [
            ("Undefined cartesian SRS", -1, "NONE", -1, "undefined"),
            ("Undefined geographic SRS", 0, "NONE", 0, "undefined"),
            ("WGS 84 geodetic", 4326, "EPSG", 4326, WGS84_WKT),
        ]
        if srs_id not in (-1, 0, 4326):
            srs_rows.append((srs_name, srs_id, organization, organization_id, wkt))
        con.executemany(
            "INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition) VALUES (?,?,?,?,?)",
            srs_rows,
        )
        for layer in layers:
            cols = "".join(f', "{name}" {kind}' for name, kind in layer.columns)
            con.execute(f'CREATE TABLE "{layer.name}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POLYGON{cols})')
            placeholders = ",".join("?" * (len(layer.columns) + 1))
            names = ",".join(["geom"] + [f'"{n}"' for n, _ in layer.columns])
            con.executemany(
                f'INSERT INTO "{layer.name}" ({names}) VALUES ({placeholders})',
                [[_geometry(ring, srs_id)] + [props.get(n) for n, _ in layer.columns] for ring, props in layer.features],
            )
            pts = [p for ring, _ in layer.features for p in ring]
            env = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)) if pts else (None,) * 4
            con.execute(
                "INSERT INTO gpkg_contents (table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id) VALUES (?,?,?,?,?,?,?,?)",
                (layer.name, "features", layer.name, *env, srs_id),
            )
            con.execute(
                "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POLYGON', ?, 0, 0)", (layer.name, srs_id)
            )
        con.commit()
    finally:
        con.close()
```

- [ ] **Step 4: Implement `geo_out.py`**

`backend/app/maps/geo_out.py`:

```python
"""CSV, GeoJSON and summary writers for map boxes (spec section 9).

Every box converts through its four real corners, so a rotated box (OBB wave 2) needs no
special case. CSV carries both the map's CRS and WGS84; GeoJSON is WGS84 only, as RFC 7946 says.
"""

from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path

from app.maps.georef import Georef, box_corners

CSV_COLUMNS = [
    "kind", "id", "class", "confidence", "match", "source", "px_x", "px_y", "px_w", "px_h", "epsg",
    "x1", "y1", "x2", "y2", "x3", "y3", "x4", "y4", "cx", "cy",
    "lon1", "lat1", "lon2", "lat2", "lon3", "lat3", "lon4", "lat4", "clon", "clat",
    "width_m", "height_m", "area_m2",
]


@dataclass(frozen=True)
class ExportBox:
    kind: str  # detection | label
    id: str
    class_name: str
    confidence: float | None
    match: str  # tp | fp | fn | "" when unscored or outside every zone
    source: str
    x: float
    y: float
    w: float
    h: float
    angle: float | None


def _native(georef: Georef, box: ExportBox) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    corners = [georef.pixel_to_native(px, py) for px, py in box_corners(box.x, box.y, box.w, box.h, box.angle)]
    centre = georef.pixel_to_native(box.x + box.w / 2, box.y + box.h / 2)
    return corners, centre


def write_csv(path: Path, boxes: list[ExportBox], georef: Georef | None, epsg: int | None) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for b in boxes:
            row = {k: "" for k in CSV_COLUMNS}
            row.update({
                "kind": b.kind, "id": b.id, "class": b.class_name,
                "confidence": "" if b.confidence is None else b.confidence, "match": b.match, "source": b.source,
                "px_x": b.x, "px_y": b.y, "px_w": b.w, "px_h": b.h,
            })
            if georef is not None:
                corners, (cx, cy) = _native(georef, b)
                lons, lats = georef.native_to_wgs84([p[0] for p in corners] + [cx], [p[1] for p in corners] + [cy])
                for i, (x, y) in enumerate(corners, start=1):
                    row[f"x{i}"], row[f"y{i}"] = x, y
                    row[f"lon{i}"], row[f"lat{i}"] = lons[i - 1], lats[i - 1]
                row.update({"epsg": epsg or "", "cx": cx, "cy": cy, "clon": lons[4], "clat": lats[4]})
                w_m = math.dist(corners[0], corners[1])
                h_m = math.dist(corners[1], corners[2])
                if georef.crs.is_geographic:  # corner distances are in degrees: use the GSD instead
                    mpp = georef.metres_per_pixel(1, 1)
                    w_m, h_m = b.w * mpp, b.h * mpp
                row.update({"width_m": w_m, "height_m": h_m, "area_m2": w_m * h_m})
            writer.writerow(row)


def write_geojson(path: Path, boxes: list[ExportBox], zones: list[tuple[str, str, list]], georef: Georef) -> None:
    features = []
    for b in boxes:
        corners, _ = _native(georef, b)
        lons, lats = georef.native_to_wgs84([p[0] for p in corners], [p[1] for p in corners])
        ring = [[lo, la] for lo, la in zip(lons, lats, strict=True)]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]},
            "properties": {"kind": b.kind, "id": b.id, "class": b.class_name, "confidence": b.confidence,
                           "match": b.match, "source": b.source},
        })
    for zone_id, name, polygon in zones:
        native = [georef.pixel_to_native(px, py) for px, py in polygon]
        lons, lats = georef.native_to_wgs84([p[0] for p in native], [p[1] for p in native])
        ring = [[lo, la] for lo, la in zip(lons, lats, strict=True)]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]},
            "properties": {"kind": "zone", "id": zone_id, "name": name},
        })
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), "utf-8")


def write_summary(path: Path, summary: dict) -> None:
    path.write_text(json.dumps(summary, indent=2, default=str), "utf-8")
```

- [ ] **Step 5: Implement the job, the request schema and the validation**

Append to `backend/app/maps/schemas.py`:

```python
class MapExportRequest(BaseModel):
    map_id: str
    content: Literal["run", "labels", "run_score"]
    run_id: str | None = None
    formats: list[Literal["geojson", "gpkg", "csv"]] = Field(min_length=1)
```

Uniqueness of `formats` is enforced in `validate_export`, below.

Append to `backend/app/maps/service.py`:

```python
def validate_export(handle: ProjectHandle, body) -> GeoMap:
    gmap = require_ready(handle, body.map_id)
    if len(set(body.formats)) != len(body.formats):
        raise AppError("validation_error", "each format may be listed once", 422)
    if body.content in ("run", "run_score"):
        if not body.run_id:
            raise AppError("validation_error", "a run export needs run_id", 422)
        run, _, _ = get_run(handle, body.run_id)
        if run.map_id != gmap.id:
            raise AppError("validation_error", "the run belongs to another map", 422)
    if gmap.crs_wkt is None and set(body.formats) - {"csv"}:
        raise AppError("validation_error", "this map has no coordinates: only the pixel CSV can be exported", 422)
    return gmap
```

`backend/app/maps/jobs_export.py`:

```python
"""The `map_export` job (spec section 9): boxes with coordinates into `exports/<stamp>/`."""

from __future__ import annotations

import re
import shutil

from pyproj import CRS
from sqlalchemy import select

from app.db.models import MapDetection, MapRun
from app.exports.job import _now_local, _promote, _reserve_partial_folder
from app.inference.service import class_ids_by_name
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.maps import geo_out, gpkg, service
from app.maps.geo_out import ExportBox
from app.maps.georef import Georef, box_corners


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "map"


def _boxes(ctx: JobContext, gmap, content: str, run_id: str | None) -> tuple[list[ExportBox], dict | None]:
    with ctx.project.session() as s:
        names = {v: k for k, v in class_ids_by_name(ctx.project, s).items()}
    score = service.score_run(ctx.project, run_id, 0.5) if content == "run_score" else None
    match = {(m["kind"], m["id"]): m["match"] for m in (score or {}).get("matches", [])}
    out: list[ExportBox] = []
    if content in ("run", "run_score"):
        with ctx.project.session() as s:
            conf = s.get(MapRun, run_id).conf
            for d in s.execute(select(MapDetection).where(MapDetection.run_id == run_id, MapDetection.confidence >= conf)).scalars():
                out.append(ExportBox("detection", d.id, names.get(d.class_id, d.class_id), d.confidence,
                                     match.get(("detection", d.id), ""), "", d.x, d.y, d.w, d.h, d.angle))
    if content in ("labels", "run_score"):
        for lab in service.list_labels(ctx.project, gmap.id):
            out.append(ExportBox("label", lab.id, names.get(lab.class_id, lab.class_id), None,
                                 match.get(("label", lab.id), ""), lab.source, lab.x, lab.y, lab.w, lab.h, lab.angle))
    return out, score


@register_job_type("map_export")
def run_map_export(ctx: JobContext) -> dict:
    p = ctx.params
    gmap = service.get_map(ctx.project, p["map_id"])
    boxes, score = _boxes(ctx, gmap, p["content"], p.get("run_id"))
    georef = Georef(gmap.geotransform, gmap.crs_wkt) if gmap.crs_wkt else None
    zones = [(z.id, z.name, z.polygon) for z in service.list_zones(ctx.project, gmap.id)]
    stem = f"map-{_slug(gmap.name)}"
    part = {"run": "detections", "labels": "labels", "run_score": "scored"}[p["content"]]
    base = ctx.project.exports_dir
    base.mkdir(parents=True, exist_ok=True)
    now = _now_local()
    partial, stamp, n = _reserve_partial_folder(base, now)
    files: list[str] = []
    try:
        for i, fmt in enumerate(p["formats"]):
            ctx.check_cancelled()
            if fmt == "csv":
                name = f"{stem}-{part}.csv"
                geo_out.write_csv(partial / name, boxes, georef, gmap.epsg)
            elif fmt == "geojson":
                name = f"{stem}-{part}.geojson"
                geo_out.write_geojson(partial / name, boxes, zones, georef)
            else:
                name = f"{stem}-{part}.gpkg"
                _write_gpkg(partial / name, boxes, zones, georef, gmap)
            files.append(name)
            ctx.progress((i + 1) / (len(p["formats"]) + 1), f"{name} written")
        counts: dict[str, int] = {}
        for b in boxes:
            counts[b.class_name] = counts.get(b.class_name, 0) + 1
        summary_name = f"{stem}-summary.json"
        geo_out.write_summary(partial / summary_name, {
            "exported_at": now.isoformat(),
            "map": {k: getattr(gmap, k) for k in ("id", "name", "source_path", "width", "height", "epsg", "gsd_cm", "bounds_wgs84")},
            "content": p["content"], "run_id": p.get("run_id"), "counts": counts,
            "score": {k: score[k] for k in ("iou", "overall", "per_class", "per_zone")} if score else None,
        })
        files.append(summary_name)
        final = _promote(base, partial, stamp, n)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    folder = "/".join(final.relative_to(ctx.project.folder).parts)
    return {"folder": folder, "files": files, "box_count": len(boxes)}


def _write_gpkg(path, boxes, zones, georef: Georef, gmap) -> None:
    def ring(b: ExportBox):
        return [georef.pixel_to_native(px, py) for px, py in box_corners(b.x, b.y, b.w, b.h, b.angle)]

    cols = [("box_id", "TEXT"), ("class", "TEXT"), ("confidence", "REAL"), ("match", "TEXT"), ("source", "TEXT")]
    props = lambda b: {"box_id": b.id, "class": b.class_name, "confidence": b.confidence, "match": b.match, "source": b.source}  # noqa: E731
    layers = [
        gpkg.Layer("detections", cols, [(ring(b), props(b)) for b in boxes if b.kind == "detection"]),
        gpkg.Layer("labels", cols, [(ring(b), props(b)) for b in boxes if b.kind == "label"]),
        gpkg.Layer("zones", [("zone_id", "TEXT"), ("name", "TEXT")],
                   [([georef.pixel_to_native(x, y) for x, y in poly], {"zone_id": zid, "name": name}) for zid, name, poly in zones]),
    ]
    layers = [layer for layer in layers if layer.features]
    crs = CRS.from_wkt(gmap.crs_wkt)
    srs_id = gmap.epsg or 100000
    gpkg.write_gpkg(
        path, layers, srs_id=srs_id, srs_name=crs.name, organization="EPSG" if gmap.epsg else "kestrel",
        organization_id=srs_id, wkt=crs.to_wkt("WKT1_GDAL"),
    )
```

Add the route to `router.py` (import `run_map_export` for registration, `MapExportRequest`, and
`JobRef` if not already imported):

```python
@router.post("/map-exports", response_model=JobRef, status_code=202)
def create_map_export(body: MapExportRequest, request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    gmap = service.validate_export(handle, body)
    job = request.app.state.jobs.submit(handle, "map_export", {**body.model_dump(), "name": gmap.name})
    return JobRef(job=JobOut.from_row(job, handle.id))
```

Delete `("POST", "/map-exports", "createMapExport")` from `STUBS`. `STUBS` is now empty, so remove
the `add_stubs` import and call too. Set `EXPECTED_STUBS: set[str] = set()` in `test_contract.py`,
and restore the original comment ("…there are none left: any 501 now fails").

- [ ] **Step 6: Run the tests**

Run: `cd backend; $PY -m pytest tests/test_maps_export.py tests/test_contract.py -q`
Expected: all pass.

Then do one manual GIS check, which carries the risk this whole format choice was about. Open
the exported `.gpkg` from `test_export_job_writes_every_format` (run it with `--basetemp` pointed
at a folder you keep) in QGIS if it is installed, or with
`& "$env:ProgramFiles\QGIS*\bin\ogrinfo.exe" -al <file>`. The labels layer must list in
EPSG:32633. Record the result in the ledger in Task 15. If neither tool is available, say so in
the ledger rather than claiming it.

- [ ] **Step 7: Lint, full suite, commit**

Run: `cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest -q`

```bash
git add backend/app/maps/geo_out.py backend/app/maps/gpkg.py backend/app/maps/jobs_export.py backend/app/maps/schemas.py backend/app/maps/service.py backend/app/maps/router.py backend/tests/test_maps_export.py backend/tests/test_contract.py
git commit -m "feat(maps): map_export - GeoJSON (WGS84), GeoPackage (map CRS), CSV (both), summary

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 10: Frontend dependencies, maps API module, pixel grid and coordinate helpers

**Files:**
- Modify: `frontend/package.json` (`ol`, `proj4`, `@types/proj4`)
- Create: `frontend/src/api/maps.ts`, `frontend/src/api/maps.test.ts`
- Create: `frontend/src/maps/grid.ts`, `frontend/src/maps/grid.test.ts`
- Create: `frontend/src/maps/coords.ts`, `frontend/src/maps/coords.test.ts`
- Modify: `frontend/src/test/fixtures.ts` (map examples)

**Interfaces:**
- Consumes: Task 2 contract types and `mapTileUrl`/`mapPreviewUrl`.
- Produces:
  - `api/maps.ts`:
    - `listMaps(api, p)`, `createMap(api, p, body)`, `fetchMap(api, p, id)`, `deleteMap(api, p, id)`
    - `listMapRuns(api, p, mapId)`, `estimateMapRun(api, p, body)`, `createMapRun(api, p, body)`, `fetchMapRun(api, p, runId)`, `resumeMapRun(api, p, runId)`, `deleteMapRun(api, p, runId)`
    - `fetchDetections(api, p, runId, bbox, minConf)`, `fetchDensity(api, p, runId, cells, minConf)`, `fetchScore(api, p, runId, iou)`
    - `listZones`, `createZone`, `updateZone`, `deleteZone`
    - `listLabels`, `createLabel`, `updateLabel`, `deleteLabel`, `seedLabels`
    - `createMapExport(api, p, body)`
  - Types: `MapDetectionPage`, `MapDensity`, `MapRunEstimate`, `MapExportRequest`, `MapLabelCreate`, `MapLabelUpdate`, `MapZoneCreate`.
  - `grid.ts`:
    - `TILE = 256`
    - `resolutions(maxZoom): number[]`
    - `olExtent(m): [number, number, number, number]`
    - `toOl(px, py): [number, number]`, `fromOl(c): [number, number]`
    - `boxRing(x, y, w, h): number[][]`
    - `bboxParam(extent, m): string | null`
    - `scaleBar(resolution, gsdCm, maxPx = 120): { px: number; label: string } | null`
  - `coords.ts`:
    - `pixelToNative(gt, px, py): [number, number]`
    - `formatLonLat(lon, lat): string`, `formatNative(x, y, epsg): string`
    - `makeReadout(m): (px, py) => Readout`, where `Readout = { pixel: string; native: string | null; wgs84: string | null }`
  - `fixtures.ts`: `MAP_ID`, `MAP_RUN_ID`, `exampleGeoMap`, `exampleMapRun`, `exampleMapScore`, `exampleZone`, `exampleLabel`.

- [ ] **Step 1: Add the dependencies**

Run: `pnpm -C frontend add ol@^10 proj4@^2.15; pnpm -C frontend add -D @types/proj4@^2.5`
Expected: `package.json` and `pnpm-lock.yaml` are updated. `ol` ships its own types.

- [ ] **Step 2: Write the failing grid and coords tests**

`frontend/src/maps/grid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bboxParam, boxRing, fromOl, olExtent, resolutions, scaleBar, toOl } from "./grid";

describe("pixel grid", () => {
  it("halves the resolution per zoom level down to full resolution", () => {
    expect(resolutions(3)).toEqual([8, 4, 2, 1]);
    expect(resolutions(0)).toEqual([1]);
  });

  it("puts the map below the origin with y flipped", () => {
    expect(olExtent({ width: 1000, height: 600 })).toEqual([0, -600, 1000, 0]);
    expect(toOl(10, 20)).toEqual([10, -20]);
    expect(fromOl([10, -20])).toEqual([10, 20]);
  });

  it("builds a closed ring for a box", () => {
    expect(boxRing(10, 20, 4, 2)).toEqual([
      [10, -20],
      [14, -20],
      [14, -22],
      [10, -22],
      [10, -20],
    ]);
  });

  it("turns a view extent into a clamped bbox in map pixels", () => {
    expect(bboxParam([-50, -700, 400, 10], { width: 1000, height: 600 })).toBe("0,0,400,600");
    expect(bboxParam([2000, -100, 3000, 0], { width: 1000, height: 600 })).toBeNull();
  });

  it("picks a round scale-bar length", () => {
    // 1 map px per screen px at 3 cm/px: 120 screen px = 3.6 m, rounds down to 2 m = 66.7 px
    expect(scaleBar(1, 3)).toEqual({ px: 67, label: "2 m" });
    expect(scaleBar(64, 3)).toEqual({ px: 104, label: "200 m" });
    expect(scaleBar(1024, 3)).toEqual({ px: 65, label: "2 km" });
    expect(scaleBar(1, null)).toBeNull();
  });
});
```

`frontend/src/maps/coords.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleGeoMap } from "@/test/fixtures";
import { formatLonLat, formatNative, makeReadout, pixelToNative } from "./coords";

describe("coordinates", () => {
  it("applies the full geotransform, rotation terms included", () => {
    expect(pixelToNative([500000, 0.03, 0, 4983000, 0, -0.03], 100, 200)).toEqual([500003, 4982994]);
    const [x, y] = pixelToNative([0, 1, 0.5, 0, 0.25, -1], 10, 10);
    expect([x, y]).toEqual([15, -7.5]);
  });

  it("formats hemispheres and projected coordinates", () => {
    expect(formatLonLat(15.0001234, 44.9876543)).toBe("44.987654° N, 15.000123° E");
    expect(formatLonLat(-3.5, -12.25)).toBe("12.250000° S, 3.500000° W");
    expect(formatNative(500003.457, 4982994.1, 32633)).toBe("500003.46, 4982994.10 · EPSG:32633");
  });

  it("reads out pixel, native and WGS84 for a UTM map", () => {
    const readout = makeReadout(exampleGeoMap)(1000, 2000);
    expect(readout.pixel).toBe("1000, 2000 px");
    expect(readout.native).toBe("500030.00, 4982940.00 · EPSG:32633");
    // northing 4982940 m on the 15° E meridian is about 44.9999° N (45° N is at about 4982950 m)
    expect(readout.wgs84).toMatch(/^44\.99\d{4}° N, 15\.000\d{3}° E$/);
  });

  it("reads out pixels only when the map has no coordinates", () => {
    const readout = makeReadout({ ...exampleGeoMap, geotransform: null, proj4: null, epsg: null })(5, 6);
    expect(readout).toEqual({ pixel: "5, 6 px", native: null, wgs84: null });
  });
});
```

- [ ] **Step 3: Add the map fixtures**

In `frontend/src/test/fixtures.ts`:

- Extend the `@contract/client` import with `type GeoMap, type MapRun, type MapScore, type MapZone, type MapLabel`.
- Append:

```ts
export const MAP_ID = "a0000000-6666-4000-8000-000000000001";
export const MAP_RUN_ID = "r0000000-7777-4000-8000-000000000001";

export const exampleGeoMap: GeoMap = {
  id: MAP_ID,
  name: "Site north ortho",
  status: "ready",
  error: null,
  source_path: "D:/orthos/site-north.tif",
  source_size: 3221225472,
  width: 80000,
  height: 60000,
  band_count: 4,
  dtype: "uint8",
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 33N"]',
  epsg: 32633,
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  geotransform: [500000, 0.03, 0, 4983000, 0, -0.03],
  bounds_native: [500000, 4981200, 502400, 4983000],
  bounds_wgs84: [15.0, 44.98, 15.03, 45.0],
  gsd_cm: 3,
  tile_grid: { tile_size: 256, max_zoom: 9 },
  labels_version: 3,
  job_id: JOB_ID,
  created_at: "2026-09-22T10:00:00Z",
};

export const exampleMapRun: MapRun = {
  id: MAP_RUN_ID,
  map_id: MAP_ID,
  kind: "local_model",
  model_id: MODEL_ID,
  provider: null,
  model_name: "machinery-v3",
  query: "",
  tile_size: 1280,
  overlap: 0.2,
  nms_iou: 0.5,
  conf: 0.25,
  target_gsd_cm: 2,
  job_id: JOB_ID,
  state: "succeeded",
  counts: { [CLASS_ID(1)]: 42, [CLASS_ID(4)]: 17 },
  detection_count: 59,
  created_at: "2026-09-22T11:00:00Z",
};

export const exampleZone: MapZone = {
  id: "z0000000-9999-4000-8000-000000000001",
  map_id: MAP_ID,
  name: "Zone 1",
  polygon: [
    [1000, 1000],
    [6000, 1000],
    [6000, 5000],
    [1000, 5000],
  ],
};

export const exampleLabel: MapLabel = {
  id: "l0000000-1212-4000-8000-000000000001",
  map_id: MAP_ID,
  class_id: CLASS_ID(1),
  x: 1210,
  y: 1205,
  w: 175,
  h: 118,
  angle: null,
  source: "manual",
  created_at: "2026-09-22T12:00:00Z",
  updated_at: "2026-09-22T12:00:00Z",
};

const scoreRow = (class_id: string | null) => ({
  class_id,
  tp: 18,
  fp: 2,
  fn: 3,
  precision: 0.9,
  recall: 0.857,
  f1: 0.878,
  predicted: 20,
  actual: 21,
  count_error: -1,
  count_error_pct: -4.76,
});

export const exampleMapScore: MapScore = {
  run_id: MAP_RUN_ID,
  iou: 0.5,
  labels_version: 3,
  has_zones: true,
  overall: scoreRow(null),
  per_class: [scoreRow(CLASS_ID(1))],
  per_zone: [{ ...scoreRow(null), zone_id: exampleZone.id }],
  matches: [
    { kind: "detection", id: "d1", match: "tp", zone_id: exampleZone.id, class_id: CLASS_ID(1), x: 1200, y: 1200, w: 180, h: 120 },
    { kind: "detection", id: "d2", match: "fp", zone_id: exampleZone.id, class_id: CLASS_ID(1), x: 3000, y: 2400, w: 170, h: 110 },
    { kind: "label", id: exampleLabel.id, match: "fn", zone_id: exampleZone.id, class_id: CLASS_ID(4), x: 4100, y: 3300, w: 200, h: 140 },
  ],
};
```

`JOB_ID` and `MODEL_ID` already exist in fixtures. If `JOB_ID` is not exported under that name,
use the id `runningJob` uses.

- [ ] **Step 4: Run them to confirm they fail**

Run: `pnpm -C frontend test -- src/maps`
Expected: FAIL. The modules do not exist.

- [ ] **Step 5: Implement `grid.ts`**

`frontend/src/maps/grid.ts`:

```ts
/**
 * The map's pixel grid as OpenLayers sees it (spec section 7). Map pixel (px, py) has y down;
 * OpenLayers wants y up, so a map lives at (px, -py), below the origin. At zoom z one tile pixel
 * covers 2^(maxZoom - z) map pixels, exactly as the backend's tile endpoint computes it.
 */
export const TILE = 256;

export type Extent = [number, number, number, number];

export function resolutions(maxZoom: number): number[] {
  return Array.from({ length: maxZoom + 1 }, (_, z) => 2 ** (maxZoom - z));
}

export function olExtent(m: { width: number; height: number }): Extent {
  return [0, -m.height, m.width, 0];
}

export function toOl(px: number, py: number): [number, number] {
  return [px, -py];
}

export function fromOl(c: number[]): [number, number] {
  return [c[0], -c[1]];
}

export function boxRing(x: number, y: number, w: number, h: number): number[][] {
  return [toOl(x, y), toOl(x + w, y), toOl(x + w, y + h), toOl(x, y + h), toOl(x, y)];
}

/** `x0,y0,x1,y1` in map pixels for the detections query; null when the view misses the map. */
export function bboxParam(extent: Extent, m: { width: number; height: number }): string | null {
  const x0 = Math.max(0, Math.floor(extent[0]));
  const x1 = Math.min(m.width, Math.ceil(extent[2]));
  const y0 = Math.max(0, Math.floor(-extent[3]));
  const y1 = Math.min(m.height, Math.ceil(-extent[1]));
  if (x0 >= x1 || y0 >= y1) return null;
  return `${x0},${y0},${x1},${y1}`;
}

const STEPS = [1, 2, 5];

/** The longest round length (1/2/5 x 10^n metres) that fits in `maxPx` screen pixels. */
export function scaleBar(
  resolution: number,
  gsdCm: number | null,
  maxPx = 120,
): { px: number; label: string } | null {
  if (!gsdCm) return null;
  const metresPerScreenPx = (resolution * gsdCm) / 100;
  const maxMetres = maxPx * metresPerScreenPx;
  const exp = Math.floor(Math.log10(maxMetres));
  let metres = 10 ** exp;
  for (const s of STEPS) if (s * 10 ** exp <= maxMetres) metres = s * 10 ** exp;
  const px = Math.round(metres / metresPerScreenPx);
  const label = metres >= 1000 ? `${metres / 1000} km` : metres >= 1 ? `${metres} m` : `${Math.round(metres * 100)} cm`;
  return { px, label };
}
```

Check against the test values. At resolution 64 and 3 cm: 1.92 m per screen px, so the max is
230.4 m and the chosen length is 200 m, giving 104 px. At resolution 1024: 30.72 m per px, max
3686 m, chosen 2 km, 65 px. The test values match.

- [ ] **Step 6: Implement `coords.ts`**

`frontend/src/maps/coords.ts`:

```ts
import proj4 from "proj4";
import type { GeoMap } from "@contract/client";

export interface Readout {
  pixel: string;
  native: string | null;
  wgs84: string | null;
}

/** GDAL geotransform: x = gt0 + px*gt1 + py*gt2, y = gt3 + px*gt4 + py*gt5. */
export function pixelToNative(gt: number[], px: number, py: number): [number, number] {
  return [gt[0] + px * gt[1] + py * gt[2], gt[3] + px * gt[4] + py * gt[5]];
}

export function formatLonLat(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
}

export function formatNative(x: number, y: number, epsg: number | null): string {
  return `${x.toFixed(2)}, ${y.toFixed(2)}${epsg ? ` · EPSG:${epsg}` : ""}`;
}

/** A cursor readout for one map; the projection is built once, not per mouse move. */
export function makeReadout(m: Pick<GeoMap, "geotransform" | "proj4" | "epsg">): (px: number, py: number) => Readout {
  const gt = m.geotransform;
  const toWgs84 = m.proj4 ? proj4(m.proj4, "EPSG:4326") : null;
  return (px, py) => {
    const pixel = `${Math.round(px)}, ${Math.round(py)} px`;
    if (!gt) return { pixel, native: null, wgs84: null };
    const [x, y] = pixelToNative(gt, px, py);
    const wgs84 = toWgs84 ? formatLonLat(...(toWgs84.forward([x, y]) as [number, number])) : null;
    return { pixel, native: formatNative(x, y, m.epsg), wgs84 };
  };
}
```

- [ ] **Step 7: Implement `api/maps.ts`**

`frontend/src/api/maps.ts`:

```ts
import type {
  ApiClient,
  GeoMap,
  Job,
  MapLabel,
  MapRun,
  MapRunCreate,
  MapScore,
  MapZone,
  components,
} from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type GeoMapWithJob = S["GeoMapWithJob"];
export type MapRunWithJob = S["MapRunWithJob"];
export type MapRunEstimate = S["MapRunEstimate"];
export type MapDetectionPage = S["MapDetectionPage"];
export type MapDensity = S["MapDensity"];
export type MapZoneCreate = S["MapZoneCreate"];
export type MapLabelCreate = S["MapLabelCreate"];
export type MapLabelUpdate = S["MapLabelUpdate"];
export type MapExportRequest = S["MapExportRequest"];

const P = "/api/v1/projects/{projectId}" as const;

export async function listMaps(api: ApiClient, projectId: string): Promise<GeoMap[]> {
  return (await unwrap(api.GET(`${P}/maps`, { params: { path: { projectId } } }))).items;
}

export function createMap(api: ApiClient, projectId: string, body: S["GeoMapCreate"]): Promise<GeoMapWithJob> {
  return unwrap(api.POST(`${P}/maps`, { params: { path: { projectId } }, body }));
}

export function fetchMap(api: ApiClient, projectId: string, mapId: string): Promise<GeoMap> {
  return unwrap(api.GET(`${P}/maps/{mapId}`, { params: { path: { projectId, mapId } } }));
}

export async function deleteMap(api: ApiClient, projectId: string, mapId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/maps/{mapId}`, { params: { path: { projectId, mapId } } }));
}

export async function listMapRuns(api: ApiClient, projectId: string, mapId: string): Promise<MapRun[]> {
  return (await unwrap(api.GET(`${P}/maps/{mapId}/runs`, { params: { path: { projectId, mapId } } }))).items;
}

export function estimateMapRun(api: ApiClient, projectId: string, body: MapRunCreate): Promise<MapRunEstimate> {
  return unwrap(api.POST(`${P}/map-runs/estimate`, { params: { path: { projectId } }, body }));
}

export function createMapRun(api: ApiClient, projectId: string, body: MapRunCreate): Promise<MapRunWithJob> {
  return unwrap(api.POST(`${P}/map-runs`, { params: { path: { projectId } }, body }));
}

export function fetchMapRun(api: ApiClient, projectId: string, runId: string): Promise<MapRun> {
  return unwrap(api.GET(`${P}/map-runs/{runId}`, { params: { path: { projectId, runId } } }));
}

export async function resumeMapRun(api: ApiClient, projectId: string, runId: string): Promise<Job> {
  return (await unwrap(api.POST(`${P}/map-runs/{runId}/resume`, { params: { path: { projectId, runId } } }))).job;
}

export async function deleteMapRun(api: ApiClient, projectId: string, runId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/map-runs/{runId}`, { params: { path: { projectId, runId } } }));
}

export function fetchDetections(
  api: ApiClient,
  projectId: string,
  runId: string,
  bbox: string | null,
  minConf: number,
): Promise<MapDetectionPage> {
  const query = bbox ? { bbox, min_conf: minConf } : { min_conf: minConf };
  return unwrap(api.GET(`${P}/map-runs/{runId}/detections`, { params: { path: { projectId, runId }, query } }));
}

export function fetchDensity(
  api: ApiClient,
  projectId: string,
  runId: string,
  cells: number,
  minConf: number,
): Promise<MapDensity> {
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/density`, {
      params: { path: { projectId, runId }, query: { cells, min_conf: minConf } },
    }),
  );
}

export function fetchScore(api: ApiClient, projectId: string, runId: string, iou = 0.5): Promise<MapScore> {
  return unwrap(api.GET(`${P}/map-runs/{runId}/score`, { params: { path: { projectId, runId }, query: { iou } } }));
}

export async function listZones(api: ApiClient, projectId: string, mapId: string): Promise<MapZone[]> {
  return (await unwrap(api.GET(`${P}/maps/{mapId}/zones`, { params: { path: { projectId, mapId } } }))).items;
}

export function createZone(api: ApiClient, projectId: string, mapId: string, body: MapZoneCreate): Promise<MapZone> {
  return unwrap(api.POST(`${P}/maps/{mapId}/zones`, { params: { path: { projectId, mapId } }, body }));
}

export function updateZone(
  api: ApiClient,
  projectId: string,
  mapId: string,
  zoneId: string,
  body: S["MapZoneUpdate"],
): Promise<MapZone> {
  return unwrap(api.PATCH(`${P}/maps/{mapId}/zones/{zoneId}`, { params: { path: { projectId, mapId, zoneId } }, body }));
}

export async function deleteZone(api: ApiClient, projectId: string, mapId: string, zoneId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/maps/{mapId}/zones/{zoneId}`, { params: { path: { projectId, mapId, zoneId } } }));
}

export async function listLabels(api: ApiClient, projectId: string, mapId: string): Promise<MapLabel[]> {
  return (await unwrap(api.GET(`${P}/maps/{mapId}/labels`, { params: { path: { projectId, mapId } } }))).items;
}

export function createLabel(api: ApiClient, projectId: string, mapId: string, body: MapLabelCreate): Promise<MapLabel> {
  return unwrap(api.POST(`${P}/maps/{mapId}/labels`, { params: { path: { projectId, mapId } }, body }));
}

export function updateLabel(
  api: ApiClient,
  projectId: string,
  mapId: string,
  labelId: string,
  body: MapLabelUpdate,
): Promise<MapLabel> {
  return unwrap(
    api.PATCH(`${P}/maps/{mapId}/labels/{labelId}`, { params: { path: { projectId, mapId, labelId } }, body }),
  );
}

export async function deleteLabel(api: ApiClient, projectId: string, mapId: string, labelId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/maps/{mapId}/labels/{labelId}`, { params: { path: { projectId, mapId, labelId } } }));
}

export async function seedLabels(
  api: ApiClient,
  projectId: string,
  mapId: string,
  body: S["MapLabelSeed"],
): Promise<number> {
  return (await unwrap(api.POST(`${P}/maps/{mapId}/labels/seed`, { params: { path: { projectId, mapId } }, body })))
    .created;
}

export async function createMapExport(api: ApiClient, projectId: string, body: MapExportRequest): Promise<Job> {
  return (await unwrap(api.POST(`${P}/map-exports`, { params: { path: { projectId } }, body }))).job;
}
```

If openapi-fetch's path typing rejects the template-literal `${P}/…` form, write the full literal
path string in each call, as `queryRuns.ts` does. Don't cast.

- [ ] **Step 8: Write the API test**

`frontend/src/api/maps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  exampleGeoMap,
  exampleLabel,
  exampleMapRun,
  exampleMapScore,
  fakeClient,
  MAP_ID,
  MAP_RUN_ID,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import {
  createLabel,
  createMap,
  createMapExport,
  fetchDetections,
  fetchScore,
  listMapRuns,
  listMaps,
  seedLabels,
  updateLabel,
} from "./maps";

describe("maps api", () => {
  it("lists, imports, and reads runs, detections and scores", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
      { method: "POST", path: /\/maps$/, status: 202, body: { map: exampleGeoMap, job: runningJob } },
      { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun] } },
      { method: "GET", path: /\/detections$/, body: { items: [], truncated: true } },
      { method: "GET", path: /\/score$/, body: exampleMapScore },
    ]);
    expect(await listMaps(api, PROJECT_ID)).toEqual([exampleGeoMap]);
    await createMap(api, PROJECT_ID, { path: "D:/o.tif" });
    expect(requests[1]).toMatchObject({ url: `/api/v1/projects/${PROJECT_ID}/maps`, body: { path: "D:/o.tif" } });
    expect(await listMapRuns(api, PROJECT_ID, MAP_ID)).toEqual([exampleMapRun]);
    expect((await fetchDetections(api, PROJECT_ID, MAP_RUN_ID, "0,0,10,10", 0.3)).truncated).toBe(true);
    expect(requests[3].url).toContain("bbox=0%2C0%2C10%2C10");
    expect(requests[3].url).toContain("min_conf=0.3");
    expect((await fetchScore(api, PROJECT_ID, MAP_RUN_ID)).overall.tp).toBe(18);
  });

  it("creates, edits and seeds labels, and starts an export", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/labels\/seed$/, body: { created: 12 } },
      { method: "POST", path: /\/labels$/, status: 201, body: exampleLabel },
      { method: "PATCH", path: /\/labels\/[^/]+$/, body: { ...exampleLabel, w: 180 } },
      { method: "POST", path: /\/map-exports$/, status: 202, body: { job: runningJob } },
    ]);
    expect(await seedLabels(api, PROJECT_ID, MAP_ID, { run_id: MAP_RUN_ID, zone_id: "z" })).toBe(12);
    await createLabel(api, PROJECT_ID, MAP_ID, { class_id: "c", x: 1, y: 2, w: 3, h: 4 });
    expect((await updateLabel(api, PROJECT_ID, MAP_ID, exampleLabel.id, { w: 180 })).w).toBe(180);
    const job = await createMapExport(api, PROJECT_ID, { map_id: MAP_ID, content: "labels", formats: ["csv"] });
    expect(job.id).toBe(runningJob.id);
    expect(requests.map((r) => r.method)).toEqual(["POST", "POST", "PATCH", "POST"]);
  });
});
```

`fakeClient` records `url` as path plus query. Check the `RecordedRequest` shape in
`fixtures.ts`: if it stores `path` and `search` separately, assert on those fields instead.

- [ ] **Step 9: Run the tests and gates**

Run: `pnpm -C frontend test -- src/maps src/api/maps; pnpm -C frontend lint; pnpm -C frontend build`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/api/maps.ts frontend/src/api/maps.test.ts frontend/src/maps/grid.ts frontend/src/maps/grid.test.ts frontend/src/maps/coords.ts frontend/src/maps/coords.test.ts frontend/src/test/fixtures.ts
git commit -m "feat(maps-ui): maps API module, pixel grid and coordinate readout helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 11: Maps screen: map list, import dialog, OpenLayers tile view, readout, scale bar, navigation

**Before starting:** load the design skills (`impeccable`, `emil-design-eng`), and read `DESIGN.md`
and `frontend/src/ui/`. The Maps screen is a work surface: the map gets the space, and the rails
are dense and quiet. Controls on the map canvas use the existing `IconButton`, not OpenLayers'
default controls.

**Files:**
- Create: `frontend/src/maps/styles.ts`, `frontend/src/maps/MapView.tsx`, `frontend/src/maps/MapList.tsx`, `frontend/src/maps/ImportMapDialog.tsx`, `frontend/src/maps/MapOverlay.tsx`
- Create: `frontend/src/screens/MapsScreen.tsx`, `frontend/src/screens/MapsScreen.test.tsx`
- Modify: `frontend/src/routes.tsx`, `frontend/src/app/Sidebar.tsx`, `frontend/src/app/Header.tsx`

**Interfaces:**
- Consumes: Task 10 (`api/maps.ts`, `grid.ts`, `coords.ts`, fixtures) and `mapTileUrl`/`mapPreviewUrl`.
- Produces:
  - `styles.tokenColour(name: string, alpha = 1): string`, which reads the `--<name>` "r g b" CSS variables
  - `MapView` with props `{ geoMap, tileUrl, onReady(map | null), onPointer(px, py), onViewChange({ extent, resolution }) }`; it renders the base map only, and later tasks add layers to the `ol/Map` it hands to `onReady`
  - `MapOverlay` with props `{ map: OlMap | null, geoMap, readout: Readout | null, resolution }`: zoom in/out/fit buttons, readout bar, scale bar
  - `MapsScreen` at routes `p/:projectId/maps` and `p/:projectId/maps/:mapId`
  - Right-panel slot: `MapsScreen` renders `<aside data-testid="map-panel">`, which Tasks 12–14 fill

- [ ] **Step 1: Write the failing screen test**

`frontend/src/screens/MapsScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { exampleGeoMap, exampleProject, fakeClient, MAP_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { MapsScreen } from "./MapsScreen";

// OpenLayers needs a real canvas; the screen's own behaviour is what is under test here.
vi.mock("@/maps/MapView", () => ({
  MapView: ({ geoMap }: { geoMap: { name: string } }) => <div data-testid="map-view">{geoMap.name}</div>,
}));

const base = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
  { method: "GET", path: /\/maps\/[^/]+$/, body: exampleGeoMap },
  { method: "GET", path: /\/runs$/, body: { items: [] } },
  { method: "GET", path: /\/zones$/, body: { items: [] } },
  { method: "GET", path: /\/labels$/, body: { items: [] } },
];

describe("MapsScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("teaches the empty state", async () => {
    const { api } = fakeClient([...base.slice(0, 1), { method: "GET", path: /\/maps$/, body: { items: [] } }]);
    renderWithProviders(<MapsScreen />, { api, route: `/p/${PROJECT_ID}/maps`, path: "/p/:projectId/maps" });
    expect(await screen.findByText("Import a GeoTIFF map")).toBeInTheDocument();
  });

  it("lists maps and opens one with its coordinate facts", async () => {
    const { api } = fakeClient(base);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    expect(await screen.findByTestId("map-view")).toHaveTextContent("Site north ortho");
    const panel = screen.getByTestId("map-panel");
    expect(panel).toHaveTextContent("EPSG:32633");
    expect(panel).toHaveTextContent("3.0 cm / px");
    expect(panel).toHaveTextContent("80 000 × 60 000 px");
  });

  it("imports a file by path and tracks the job", async () => {
    const { api, requests } = fakeClient([
      ...base,
      { method: "POST", path: /\/maps$/, status: 202, body: { map: { ...exampleGeoMap, status: "importing" }, job: { ...runningJob, type: "map_import" } } },
    ]);
    renderWithProviders(<MapsScreen />, { api, route: `/p/${PROJECT_ID}/maps`, path: "/p/:projectId/maps" });
    fireEvent.click(await screen.findByRole("button", { name: "Import map" }));
    fireEvent.change(screen.getByLabelText("GeoTIFF file"), { target: { value: "D:/orthos/new.tif" } });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.body?.path === "D:/orthos/new.tif")).toBe(true));
    expect(useJobsStore.getState().jobs[runningJob.id]?.type).toBe("map_import");
  });

  it("says why geo export is unavailable for a map without coordinates", async () => {
    const plain = { ...exampleGeoMap, crs_wkt: null, epsg: null, proj4: null, geotransform: null, gsd_cm: null };
    const { api } = fakeClient([base[0], { method: "GET", path: /\/maps$/, body: { items: [plain] } }, { method: "GET", path: /\/maps\/[^/]+$/, body: plain }, ...base.slice(3)]);
    renderWithProviders(<MapsScreen />, { api, route: `/p/${PROJECT_ID}/maps/${MAP_ID}`, path: "/p/:projectId/maps/:mapId" });
    // the list row says "No coordinates" too; the panel's explanation is what matters here
    expect(await within(screen.getByTestId("map-panel")).findByText(/No coordinates in this file/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm -C frontend test -- src/screens/MapsScreen`
Expected: FAIL. `MapsScreen` does not exist.

- [ ] **Step 3: Implement the canvas colour helper**

`frontend/src/maps/styles.ts`:

```ts
/**
 * OpenLayers draws on a canvas, which cannot use Tailwind classes; it reads the same design tokens
 * (`--ok: 174 209 177` in index.css) so the map follows the theme like the rest of the app.
 */
export function tokenColour(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const [r, g, b] = raw.split(/\s+/).map(Number);
  return Number.isFinite(r) ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgba(128, 128, 128, ${alpha})`;
}

/** A class colour (project hex) with alpha, for fills. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
```

- [ ] **Step 4: Implement `MapView`**

`frontend/src/maps/MapView.tsx`:

```tsx
import { useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import TileImage from "ol/source/TileImage";
import TileGrid from "ol/tilegrid/TileGrid";
import Projection from "ol/proj/Projection";
import type { GeoMap } from "@contract/client";
import { fromOl, olExtent, resolutions, TILE, type Extent } from "./grid";

const OVERZOOM = [0.5, 0.25]; // past full resolution: pixels get bigger, never blurrier than the source

export interface MapViewProps {
  geoMap: GeoMap;
  /** `mapTileUrl(...)`: a template with `{z}`, `{x}` and `{y}`. */
  tileUrl: string;
  onReady?: (map: OlMap | null) => void;
  onPointer?: (px: number, py: number) => void;
  onViewChange?: (v: { extent: Extent; resolution: number }) => void;
}

/**
 * The map's own pixel grid in OpenLayers: no reprojection on screen, so boxes stay in the same
 * pixels the backend stores. Only the base tiles live here; run, label, zone and score layers are
 * added to the `ol/Map` handed to `onReady` by the hooks that own them.
 */
export function MapView({ geoMap, tileUrl, onReady, onPointer, onViewChange }: MapViewProps) {
  const target = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onPointer, onViewChange });
  useEffect(() => {
    callbacks.current = { onReady, onPointer, onViewChange };
  });

  useEffect(() => {
    if (!target.current) return;
    const extent = olExtent(geoMap);
    const projection = new Projection({ code: `kestrel-map-${geoMap.id}`, units: "pixels", extent });
    const res = resolutions(geoMap.tile_grid.max_zoom);
    const source = new TileImage({
      projection,
      tileGrid: new TileGrid({ extent, origin: [0, 0], resolutions: res, tileSize: TILE }),
      tileUrlFunction: (c) =>
        c ? tileUrl.replace("{z}", String(c[0])).replace("{x}", String(c[1])).replace("{y}", String(c[2])) : undefined,
      transition: 0,
      interpolate: true,
    });
    const map = new OlMap({
      target: target.current,
      layers: [new TileLayer({ source, preload: 1 })],
      controls: [],
      view: new View({ projection, extent, resolutions: [...res, ...OVERZOOM], constrainOnlyCenter: true, showFullExtent: true }),
    });
    map.getView().fit(extent, { padding: [24, 24, 24, 24] });
    const onMove = (e: { coordinate: number[] }) => callbacks.current.onPointer?.(...fromOl(e.coordinate));
    const onEnd = () => {
      const view = map.getView();
      const resolution = view.getResolution() ?? res[0];
      callbacks.current.onViewChange?.({ extent: view.calculateExtent(map.getSize()) as Extent, resolution });
    };
    map.on("pointermove", onMove);
    map.on("moveend", onEnd);
    callbacks.current.onReady?.(map);
    return () => {
      callbacks.current.onReady?.(null);
      map.setTarget(undefined);
      map.dispose();
    };
  }, [geoMap.id, geoMap.width, geoMap.height, geoMap.tile_grid.max_zoom, tileUrl]);

  return <div ref={target} className="absolute inset-0 bg-canvas" data-testid="map-view" />;
}
```

If `bg-canvas` is not a Tailwind colour in `tailwind.config`, add `canvas: rgb("canvas")` next
to the other tokens. That is a token addition, not a raw colour.

- [ ] **Step 5: Implement the overlay (zoom, readout, scale bar)**

`frontend/src/maps/MapOverlay.tsx`:

```tsx
import type OlMap from "ol/Map";
import type { GeoMap } from "@contract/client";
import { IconButton } from "@/ui";
import type { Readout } from "./coords";
import { olExtent, scaleBar } from "./grid";

const ZOOM_MS = 180;

export function MapOverlay({
  map,
  geoMap,
  readout,
  resolution,
}: {
  map: OlMap | null;
  geoMap: GeoMap;
  readout: Readout | null;
  resolution: number;
}) {
  const zoom = (delta: number) => {
    const view = map?.getView();
    if (view) view.animate({ zoom: (view.getZoom() ?? 0) + delta, duration: ZOOM_MS });
  };
  const bar = scaleBar(resolution, geoMap.gsd_cm);
  return (
    <>
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-md border border-line bg-panel p-1 shadow-sm">
        <IconButton icon="plus" label="Zoom in" size="sm" onClick={() => zoom(1)} />
        <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => zoom(-1)} />
        <IconButton icon="fit" label="Fit the whole map" size="sm" onClick={() => map?.getView().fit(olExtent(geoMap), { duration: ZOOM_MS })} />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-line bg-panel/90 px-3 py-1.5 text-xs tabular-nums text-muted">
        {bar && (
          <span className="flex items-center gap-2" data-testid="scale-bar">
            <span className="h-1.5 border-x border-b border-ink" style={{ width: bar.px }} />
            <span className="text-ink">{bar.label}</span>
          </span>
        )}
        <span>{readout?.pixel ?? "—"}</span>
        {readout?.native && <span>{readout.native}</span>}
        {readout?.wgs84 && <span className="text-ink">{readout.wgs84}</span>}
        <span className="ml-auto">{geoMap.gsd_cm ? `${(resolution * geoMap.gsd_cm).toFixed(1)} cm / screen px` : `${resolution} px / screen px`}</span>
      </div>
    </>
  );
}
```

If `minus` is not in `IconName`, add it to `Icon.tsx`: `minus: "M5 12h14",`.

- [ ] **Step 6: Implement the map list and the import dialog**

`frontend/src/maps/MapList.tsx`:

```tsx
import { Link } from "react-router-dom";
import { mapPreviewUrl, type GeoMap } from "@contract/client";
import { useBackend } from "@/api/client";
import { useJobsStore } from "@/store/jobs";
import { Pill, Progress, cx, focusRing, transition } from "@/ui";

export function MapList({ projectId, maps, activeId }: { projectId: string; maps: GeoMap[]; activeId?: string }) {
  const { baseUrl, token } = useBackend();
  const jobs = useJobsStore((s) => s.jobs);
  return (
    <ul className="flex flex-col gap-1" aria-label="Maps">
      {maps.map((m) => {
        const job = m.job_id ? jobs[m.job_id] : undefined;
        return (
          <li key={m.id}>
            <Link
              to={`/p/${projectId}/maps/${m.id}`}
              aria-current={m.id === activeId ? "page" : undefined}
              className={cx(
                "flex gap-2.5 rounded-md p-2",
                transition,
                focusRing,
                m.id === activeId ? "bg-accent-soft" : "hover:bg-hover/5",
              )}
            >
              <span className="h-12 w-16 shrink-0 overflow-hidden rounded bg-well">
                {m.status === "ready" && (
                  <img src={mapPreviewUrl(baseUrl, token, projectId, m.id)} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium text-ink">{m.name}</span>
                {m.status === "importing" ? (
                  <Progress value={job?.progress} running label={`Importing ${m.name}`} thin />
                ) : m.status === "failed" ? (
                  <Pill tone="danger">Import failed</Pill>
                ) : (
                  <span className="truncate text-xs text-muted">
                    {m.epsg ? `EPSG:${m.epsg}` : "No coordinates"} · {m.gsd_cm ? `${m.gsd_cm.toFixed(1)} cm / px` : `${m.width} × ${m.height} px`}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

`frontend/src/maps/ImportMapDialog.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createMap } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Button, Dialog, Field, Input } from "@/ui";

export function ImportMapDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: (m: GeoMap) => void;
}) {
  const api = useApi();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: [{ name: "GeoTIFF", extensions: ["tif", "tiff"] }] });
    if (typeof picked === "string") setPath(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) return setError("Choose the GeoTIFF to import.");
    setBusy(true);
    setError(null);
    try {
      const r = await createMap(api, projectId, { path: path.trim(), ...(name.trim() ? { name: name.trim() } : {}) });
      useJobsStore.getState().upsert(r.job);
      onStarted(r.map);
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Import map"
      description="Pick an orthomosaic GeoTIFF of any size. The file itself is only read: the project keeps a zoomable copy next to it. Big maps take a few minutes and import in the background."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="import" loading={busy}>
            Start import
          </Button>
        </>
      }
    >
      <Field label="GeoTIFF file" htmlFor="map-path" error={error}>
        <div className="flex gap-2">
          <Input id="map-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\orthos\site.tif" />
          <Button onClick={() => void browse()}>Browse</Button>
        </div>
      </Field>
      <Field label="Name" htmlFor="map-name" hint="Defaults to the file name.">
        <Input id="map-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Dialog>
  );
}
```

- [ ] **Step 7: Implement the screen**

`frontend/src/screens/MapsScreen.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type OlMap from "ol/Map";
import { mapTileUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { listMaps } from "@/api/maps";
import { useProject } from "@/api/project";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { MapList } from "@/maps/MapList";
import { MapOverlay } from "@/maps/MapOverlay";
import { MapView } from "@/maps/MapView";
import { makeReadout, type Readout } from "@/maps/coords";
import { Alert, Button, EmptyState } from "@/ui";

const nf = new Intl.NumberFormat("en-GB").format;
const px = (n: number) => nf(n).replace(/,/g, " ");

function MapFacts({ m }: { m: GeoMap }) {
  const rows: [string, string][] = [
    ["Size", `${px(m.width)} × ${px(m.height)} px`],
    ["Ground resolution", m.gsd_cm ? `${m.gsd_cm.toFixed(1)} cm / px` : "unknown"],
    ["Coordinate system", m.epsg ? `EPSG:${m.epsg}` : m.crs_wkt ? "custom (see export)" : "none"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MapsScreen() {
  const { projectId = "", mapId } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const { baseUrl, token } = useBackend();
  useProject(projectId);
  const [maps, setMaps] = useState<GeoMap[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [olMap, setOlMap] = useState<OlMap | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [resolution, setResolution] = useState(1);

  const reload = useCallback(() => {
    void listMaps(api, projectId).then(setMaps);
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("map_import", reload);

  const active = maps?.find((m) => m.id === mapId) ?? null;
  const read = useMemo(() => (active ? makeReadout(active) : null), [active]);
  const tileUrl = active ? mapTileUrl(baseUrl, token, projectId, active.id) : "";

  if (maps && maps.length === 0 && !importing) {
    return (
      <EmptyState
        icon="map"
        title="Import a GeoTIFF map"
        action={
          <Button variant="primary" icon="import" onClick={() => setImporting(true)}>
            Import map
          </Button>
        }
      >
        Bring in an orthomosaic, run your models across the whole site and count every machine on it.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Maps</h1>
          <Button size="sm" icon="import" onClick={() => setImporting(true)}>
            Import map
          </Button>
        </div>
        {maps && <MapList projectId={projectId} maps={maps} activeId={mapId} />}
      </section>
      <section className="relative min-w-0 flex-1">
        {active?.status === "ready" ? (
          <>
            <MapView
              geoMap={active}
              tileUrl={tileUrl}
              onReady={setOlMap}
              onPointer={(x, y) => setReadout(read ? read(x, y) : null)}
              onViewChange={(v) => setResolution(v.resolution)}
            />
            <MapOverlay map={olMap} geoMap={active} readout={readout} resolution={resolution} />
          </>
        ) : (
          <EmptyState icon="map" title={active ? `${active.name} is ${active.status}` : "Choose a map"}>
            {active?.error ?? "Pick a map on the left, or import one."}
          </EmptyState>
        )}
      </section>
      <aside data-testid="map-panel" className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4">
        {active && (
          <>
            <h2 className="truncate text-base font-semibold">{active.name}</h2>
            <MapFacts m={active} />
            {!active.crs_wkt && (
              <Alert tone="warn">
                No coordinates in this file: you can view, detect, label and score, and export boxes in
                pixels, but not as GIS layers.
              </Alert>
            )}
          </>
        )}
      </aside>
      {importing && (
        <ImportMapDialog
          projectId={projectId}
          onClose={() => setImporting(false)}
          onStarted={(m) => {
            setImporting(false);
            reload();
            navigate(`/p/${projectId}/maps/${m.id}`);
          }}
        />
      )}
    </div>
  );
}
```

Check `Alert`'s prop name for its tone in `src/ui/Alert.tsx` (`tone` with an `AlertTone` union);
use the warning tone that exists there.

- [ ] **Step 8: Wire the routes and the navigation**

- In `frontend/src/routes.tsx`, import `MapsScreen` and add
  `{ path: "p/:projectId/maps", element: <MapsScreen /> }` and
  `{ path: "p/:projectId/maps/:mapId", element: <MapsScreen /> }` after the `query` route.
- In `frontend/src/app/Sidebar.tsx`, after the Models `PlainEntry`, add:

```tsx
          <PlainEntry to={`/p/${projectId}/maps`} icon="map" compact={compact}>
            Maps
          </PlainEntry>
```

- In `frontend/src/app/Header.tsx` `SCREEN`, add `maps: "Maps",`.

If `Sidebar.test.tsx` or `Shell.test.tsx` count navigation entries, update the expected list
with "Maps".

- [ ] **Step 9: Run the tests and gates**

Run: `pnpm -C frontend test; pnpm -C frontend lint; pnpm -C frontend build`
Expected: all pass. `lint` includes `check-tokens.mjs`.

- [ ] **Step 10: See it working in the real app**

Invoke the `run` skill, or start `scripts\dev.ps1 -Mode backend` from the worktree. Then:

1. Import a real orthomosaic, or a generated 20 000 × 20 000 fixture made with
   `make_geotiff` in a Python REPL.
2. Open it.
3. Check that tiles load at every zoom level, with no gaps or offsets between tile rows.

A vertical flip or offset rows mean the tile-coordinate sign is wrong: OpenLayers must request
`y` starting at 0 at the top of the map. Check the readout against a known point, then take a
screenshot for the ledger.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/maps/styles.ts frontend/src/maps/MapView.tsx frontend/src/maps/MapOverlay.tsx frontend/src/maps/MapList.tsx frontend/src/maps/ImportMapDialog.tsx frontend/src/screens/MapsScreen.tsx frontend/src/screens/MapsScreen.test.tsx frontend/src/routes.tsx frontend/src/app/Sidebar.tsx frontend/src/app/Header.tsx frontend/src/ui/Icon.tsx frontend/tailwind.config.ts
git commit -m "feat(maps-ui): Maps screen with OpenLayers pixel-grid tiles, import, readout, scale bar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Stage `frontend/tailwind.config.*` only if Step 4 changed it; use the file's real extension.

---
### Task 12: Runs on the map: New Run dialog, runs list, box layers, counts, filters, compare

**Before starting:** the design skills stay loaded from Task 11.

**Files:**
- Create: `frontend/src/maps/runModel.ts`, `frontend/src/maps/runModel.test.ts` (pure)
- Create: `frontend/src/maps/runLayer.ts` (OpenLayers hook)
- Create: `frontend/src/maps/NewRunDialog.tsx`, `frontend/src/maps/NewRunDialog.test.tsx`
- Create: `frontend/src/maps/RunList.tsx`
- Create: `frontend/src/maps/ResultsPanel.tsx`, `frontend/src/maps/ResultsPanel.test.tsx`
- Modify: `frontend/src/screens/MapsScreen.tsx`, `frontend/src/screens/MapsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 10 `fetchDetections`, `fetchDensity`, `listMapRuns`, `estimateMapRun`, `createMapRun`, `resumeMapRun`, `deleteMapRun`; Task 11 `MapView.onReady`, `styles.*`.
- Produces:
  - `runModel.ts`:
    - `MAX_COMPARE = 2`
    - `defaultTargetGsd(runs: MapRun[], modelId: string | null, mapGsd: number | null): number | null`
    - `countsFromDensity(d: MapDensity): Record<string, number>`
    - `toggleCompare(selected: string[], runId: string): string[]`
    - `runTitle(run: MapRun): string`
    - `validateRunForm(form, providers): string | null`
  - `runLayer.ts`:
    - `RunLayerSpec = { runId; dashed; minConf; hidden: ReadonlySet<string>; colours: Record<string, string>; matchOf?: (id: string) => "tp" | "fp" | "fn" | undefined; load(bbox, minConf); density(minConf); onViewCounts?(counts: Record<string, number>, truncated: boolean) }`
    - `useRunLayer(map: OlMap | null, geoMap: GeoMap, spec: RunLayerSpec | null): { focus(id: string): void }`
  - `ResultsPanel` with props `{ runs: MapRun[]; selected: string[]; classes: ClassDef[]; wholeMap: Record<string, Record<string, number>>; inView: Record<string, Record<string, number>>; inViewTruncated: boolean; scope; onScope; minConf; onMinConf; hidden; onToggleClass }`
  - `runModel.boxFacts(geoMap, box, classes, confidence) -> { title: string; readout: Readout; size: string | null }` (the box popover's lines; see Step 7 item 8)
  - `RunList` with props `{ projectId; runs; selected; onToggle(runId); onChanged() }`
  - `NewRunDialog` with props `{ projectId; geoMap; runs; onClose; onStarted(run) }`

- [ ] **Step 1: Write the failing pure tests**

`frontend/src/maps/runModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleMapRun } from "@/test/fixtures";
import { countsFromDensity, defaultTargetGsd, runTitle, toggleCompare, validateRunForm } from "./runModel";

describe("run model", () => {
  it("prefills the training GSD from the model's last run, else the map's own", () => {
    const older = { ...exampleMapRun, id: "old", target_gsd_cm: 1.5, created_at: "2026-09-20T00:00:00Z" };
    expect(defaultTargetGsd([exampleMapRun, older], exampleMapRun.model_id, 3)).toBe(2);
    expect(defaultTargetGsd([exampleMapRun], "other-model", 3)).toBe(3);
    expect(defaultTargetGsd([], null, null)).toBeNull();
  });

  it("sums density cells per class", () => {
    const d = { cell_size: 10, cells: [
      { gx: 0, gy: 0, class_id: "a", count: 2 },
      { gx: 1, gy: 0, class_id: "a", count: 3 },
      { gx: 0, gy: 1, class_id: "b", count: 1 },
    ] };
    expect(countsFromDensity(d)).toEqual({ a: 5, b: 1 });
  });

  it("compares at most two runs, newest pick replacing the oldest", () => {
    expect(toggleCompare([], "a")).toEqual(["a"]);
    expect(toggleCompare(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleCompare(["a", "b"], "c")).toEqual(["b", "c"]);
    expect(toggleCompare(["a", "b"], "a")).toEqual(["b"]);
  });

  it("names a run by its model and date", () => {
    // local time: the day and hour depend on the runner's zone, the shape does not
    expect(runTitle(exampleMapRun)).toMatch(/^machinery-v3 · \d{1,2} Sep \d{2}:\d{2}$/);
  });

  it("needs a model, or a provider with a key and a query", () => {
    const providers = [{ name: "anthropic" as const, has_key: false, model_name: "m", requests_per_minute: 1, cost_per_request: 0 }];
    expect(validateRunForm({ kind: "local_model", modelId: "" }, providers)).toBe("Choose a model.");
    expect(validateRunForm({ kind: "cloud_provider", provider: "anthropic", query: "trucks" }, providers)).toBe(
      "Add an API key for this provider in App settings first.",
    );
    expect(validateRunForm({ kind: "cloud_provider", provider: "anthropic", query: " " }, [{ ...providers[0], has_key: true }])).toBe(
      "Describe what to find, e.g. \"excavators\".",
    );
    expect(validateRunForm({ kind: "local_model", modelId: "m1" }, providers)).toBeNull();
  });
});
```

`runTitle` uses fixed month abbreviations, not `Intl`, because ICU versions differ on "Sep"
versus "Sept". It formats in local time, so the test checks the shape, not the hour.

- [ ] **Step 2: Run it to confirm it fails, then implement `runModel.ts`**

Run: `pnpm -C frontend test -- src/maps/runModel` (FAIL: module missing).

`frontend/src/maps/runModel.ts`:

```ts
import type { MapRun, Provider, ProviderName } from "@contract/client";
import type { MapDensity } from "@/api/maps";

export const MAX_COMPARE = 2;

export function defaultTargetGsd(runs: MapRun[], modelId: string | null, mapGsd: number | null): number | null {
  const last = runs
    .filter((r) => r.model_id === modelId && r.target_gsd_cm)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return last?.target_gsd_cm ?? mapGsd;
}

export function countsFromDensity(d: MapDensity): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of d.cells) out[c.class_id] = (out[c.class_id] ?? 0) + c.count;
  return out;
}

export function toggleCompare(selected: string[], runId: string): string[] {
  if (selected.includes(runId)) return selected.filter((id) => id !== runId);
  return [...selected, runId].slice(-MAX_COMPARE);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

export function runTitle(run: MapRun): string {
  const d = new Date(run.created_at);
  const when = `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${run.model_name ?? run.provider ?? "Run"} · ${when}`;
}

export type RunForm =
  | { kind: "local_model"; modelId: string }
  | { kind: "cloud_provider"; provider: ProviderName; query: string };

export function validateRunForm(form: RunForm, providers: Provider[]): string | null {
  if (form.kind === "local_model") return form.modelId ? null : "Choose a model.";
  if (!providers.find((p) => p.name === form.provider)?.has_key) {
    return "Add an API key for this provider in App settings first.";
  }
  return form.query.trim() ? null : 'Describe what to find, e.g. "excavators".';
}
```

Run it again. Expected: PASS.

- [ ] **Step 3: Implement the run layer hook**

`frontend/src/maps/runLayer.ts`:

```ts
import { useEffect, useRef } from "react";
import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { bbox as bboxStrategy } from "ol/loadingstrategy";
import { Circle, Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import type { GeoMap } from "@contract/client";
import type { MapDensity, MapDetectionPage } from "@/api/maps";
import { bboxParam, boxRing, toOl, type Extent } from "./grid";
import { tokenColour, withAlpha } from "./styles";

export type Match = "tp" | "fp" | "fn";

export interface RunLayerSpec {
  runId: string;
  dashed: boolean;
  minConf: number;
  hidden: ReadonlySet<string>;
  colours: Record<string, string>;
  matchOf?: (id: string) => Match | undefined;
  load: (bbox: string, minConf: number) => Promise<MapDetectionPage>;
  density: (minConf: number) => Promise<MapDensity>;
  onViewCounts?: (counts: Record<string, number>, truncated: boolean) => void;
}

const DENSITY_CELLS = 128;
const MATCH_TOKEN: Record<Match, string> = { tp: "ok", fp: "danger", fn: "warn" };

function boxStyle(spec: RunLayerSpec, f: FeatureLike): Style | undefined {
  const classId = f.get("classId") as string;
  if (spec.hidden.has(classId)) return undefined;
  const match = spec.matchOf?.(String(f.getId()));
  const colour = match ? tokenColour(MATCH_TOKEN[match]) : (spec.colours[classId] ?? tokenColour("accent"));
  return new Style({
    stroke: new Stroke({ color: colour, width: 2, lineDash: spec.dashed ? [6, 4] : undefined }),
    fill: new Fill({ color: match ? tokenColour(MATCH_TOKEN[match], 0.12) : withAlpha(spec.colours[classId] ?? "#e5af64", 0.08) }),
  });
}

function dotStyle(spec: RunLayerSpec, f: FeatureLike): Style | undefined {
  const classId = f.get("classId") as string;
  if (spec.hidden.has(classId)) return undefined;
  const n = f.get("count") as number;
  return new Style({
    image: new Circle({
      radius: 3 + Math.sqrt(n) * 2,
      fill: new Fill({ color: withAlpha(spec.colours[classId] ?? "#e5af64", 0.55) }),
      stroke: new Stroke({ color: tokenColour("inverse", 0.6), width: 1 }),
    }),
  });
}

/**
 * One run as two layers: boxes, fetched per view extent (at most 5000 per request), and, when a
 * view holds more than that, density dots for the whole map instead. Nothing is loaded for areas
 * the operator never looks at.
 */
export function useRunLayer(map: OlMap | null, geoMap: GeoMap, spec: RunLayerSpec | null): { focus(id: string): void } {
  const specRef = useRef(spec);
  const layers = useRef<{ boxes: VectorLayer<VectorSource>; dots: VectorLayer<VectorSource> } | null>(null);
  useEffect(() => {
    specRef.current = spec;
    layers.current?.boxes.changed();
    layers.current?.dots.changed();
  });

  const runId = spec?.runId;
  const minConf = spec?.minConf;
  useEffect(() => {
    if (!map || !runId || minConf === undefined) return;
    let truncated = false;
    const boxes = new VectorSource({
      strategy: bboxStrategy,
      loader: (extent, _res, _proj, success, failure) => {
        const bbox = bboxParam(extent as Extent, geoMap);
        const s = specRef.current;
        if (!bbox || !s) return success?.([]);
        s.load(bbox, minConf)
          .then((page) => {
            truncated = page.truncated;
            const feats = page.items.map((d) => {
              const f = new Feature(new Polygon([boxRing(d.x, d.y, d.w, d.h)]));
              f.setId(d.id);
              f.setProperties({ classId: d.class_id, confidence: d.confidence, kind: "detection" });
              return f;
            });
            boxes.addFeatures(feats);
            boxLayer.setVisible(!truncated);
            dotLayer.setVisible(truncated);
            success?.(feats);
            report();
          })
          .catch(() => {
            boxes.removeLoadedExtent(extent);
            failure?.();
          });
      },
    });
    const dots = new VectorSource();
    const boxLayer = new VectorLayer({ source: boxes, style: (f) => boxStyle(specRef.current!, f), zIndex: 10 });
    const dotLayer = new VectorLayer({ source: dots, style: (f) => dotStyle(specRef.current!, f), zIndex: 11, visible: false });
    void specRef.current?.density(minConf).then((d) => {
      dots.addFeatures(
        d.cells.map((c) => {
          const f = new Feature(new Point(toOl((c.gx + 0.5) * d.cell_size, (c.gy + 0.5) * d.cell_size)));
          f.setProperties({ classId: c.class_id, count: c.count });
          return f;
        }),
      );
    });
    function report() {
      const s = specRef.current;
      if (!s?.onViewCounts || !map) return;
      const extent = map.getView().calculateExtent(map.getSize());
      const counts: Record<string, number> = {};
      for (const f of boxes.getFeaturesInExtent(extent)) {
        const c = f.get("classId") as string;
        counts[c] = (counts[c] ?? 0) + 1;
      }
      s.onViewCounts(counts, truncated);
    }
    map.addLayer(boxLayer);
    map.addLayer(dotLayer);
    map.on("moveend", report);
    layers.current = { boxes: boxLayer, dots: dotLayer };
    return () => {
      map.un("moveend", report);
      map.removeLayer(boxLayer);
      map.removeLayer(dotLayer);
      layers.current = null;
    };
  }, [map, geoMap, runId, minConf]);

  return {
    focus(id: string) {
      const f = layers.current?.boxes.getSource()?.getFeatureById(id);
      const geom = f?.getGeometry();
      if (map && geom) map.getView().fit(geom.getExtent(), { maxZoom: map.getView().getMaxZoom() - 2, duration: 250, padding: [80, 80, 80, 80] });
    },
  };
}
```

"In view" counts are exact only while the view is not truncated. `ResultsPanel` shows them only
when `truncated` is false, and says "zoom in to count what is in view" otherwise.

- [ ] **Step 4: Write the failing panel and dialog tests**

`frontend/src/maps/ResultsPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CLASS_ID, exampleClasses, exampleMapRun } from "@/test/fixtures";
import { ResultsPanel } from "./ResultsPanel";

const other = { ...exampleMapRun, id: "r2", model_name: "machinery-v4" };

function renderPanel(over = {}) {
  const props = {
    runs: [exampleMapRun, other],
    selected: [exampleMapRun.id],
    classes: exampleClasses,
    wholeMap: { [exampleMapRun.id]: { [CLASS_ID(1)]: 42, [CLASS_ID(4)]: 17 }, r2: { [CLASS_ID(1)]: 40 } },
    inView: { [exampleMapRun.id]: { [CLASS_ID(1)]: 3 } },
    inViewTruncated: false,
    scope: "map" as const,
    onScope: vi.fn(),
    minConf: 0.25,
    onMinConf: vi.fn(),
    hidden: new Set<string>(),
    onToggleClass: vi.fn(),
    ...over,
  };
  render(<ResultsPanel {...props} />);
  return props;
}

describe("ResultsPanel", () => {
  it("counts per class for the whole map, with a total", () => {
    renderPanel();
    expect(screen.getByRole("row", { name: /excavator/ })).toHaveTextContent("42");
    expect(screen.getByRole("row", { name: /dump_truck/ })).toHaveTextContent("17");
    expect(screen.getByRole("row", { name: /Total/ })).toHaveTextContent("59");
  });

  it("puts two runs side by side", () => {
    renderPanel({ selected: [exampleMapRun.id, "r2"] });
    const row = screen.getByRole("row", { name: /excavator/ });
    expect(row).toHaveTextContent("42");
    expect(row).toHaveTextContent("40");
    expect(screen.getByRole("columnheader", { name: /machinery-v4/ })).toBeInTheDocument();
  });

  it("shows in-view counts, or says to zoom in when the view is truncated", () => {
    renderPanel({ scope: "view" });
    expect(screen.getByRole("row", { name: /excavator/ })).toHaveTextContent("3");
    renderPanel({ scope: "view", inViewTruncated: true });
    expect(screen.getByText("Zoom in to count what is in view.")).toBeInTheDocument();
  });

  it("hides a class and changes the confidence", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show excavator" }));
    expect(p.onToggleClass).toHaveBeenCalledWith(CLASS_ID(1));
    fireEvent.change(screen.getByLabelText("Minimum confidence"), { target: { value: "0.5" } });
    expect(p.onMinConf).toHaveBeenCalledWith(0.5);
  });
});
```

`frontend/src/maps/NewRunDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleGeoMap, exampleMapRun, exampleModel, exampleProviders, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { NewRunDialog } from "./NewRunDialog";

describe("NewRunDialog", () => {
  it("prefills the GSD, shows the estimate and starts a local run", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "POST", path: /\/map-runs\/estimate$/, body: { windows: 8900, skipped_windows: 2100, requests: 6800, scale: 1.5, cost_per_request: 0, estimated_cost: 0 } },
      { method: "POST", path: /\/map-runs$/, status: 202, body: { run: exampleMapRun, job: { ...runningJob, type: "map_detect" } } },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(
      <NewRunDialog projectId={PROJECT_ID} geoMap={exampleGeoMap} runs={[{ ...exampleMapRun, model_id: exampleModel.id }]} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    expect(await screen.findByLabelText("Model trained at (cm / px)")).toHaveValue(2);
    expect(await screen.findByText("6 800 windows to check · 2 100 empty skipped · scaled ×1.5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start detection" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/map-runs"));
    expect(post?.body).toMatchObject({ map_id: exampleGeoMap.id, kind: "local_model", model_id: exampleModel.id, target_gsd_cm: 2 });
  });
});
```

`exampleModel` and `exampleProviders` already exist in fixtures (QueryScreen uses them). If
`fetchAllModels` pages with a different response shape, copy the models route from
`QueryScreen.test.tsx` verbatim.

- [ ] **Step 5: Implement `ResultsPanel`**

`frontend/src/maps/ResultsPanel.tsx`:

```tsx
import type { ClassDef, MapRun } from "@contract/client";
import { Checkbox, Field, Segmented } from "@/ui";
import { runTitle } from "./runModel";

export type CountScope = "map" | "view";

export interface ResultsPanelProps {
  runs: MapRun[];
  selected: string[];
  classes: ClassDef[];
  wholeMap: Record<string, Record<string, number>>;
  inView: Record<string, Record<string, number>>;
  inViewTruncated: boolean;
  scope: CountScope;
  onScope: (s: CountScope) => void;
  minConf: number;
  onMinConf: (v: number) => void;
  hidden: ReadonlySet<string>;
  onToggleClass: (classId: string) => void;
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

export function ResultsPanel(p: ResultsPanelProps) {
  const shown = p.selected.map((id) => p.runs.find((r) => r.id === id)).filter((r): r is MapRun => !!r);
  const source = p.scope === "map" ? p.wholeMap : p.inView;
  const total = (runId: string) => Object.values(source[runId] ?? {}).reduce((a, b) => a + b, 0);
  return (
    <section className="flex flex-col gap-3" aria-label="Detection results">
      <Segmented
        label="Count"
        size="sm"
        value={p.scope}
        onChange={p.onScope}
        options={[
          { value: "map", label: "Whole map" },
          { value: "view", label: "In view" },
        ]}
      />
      {p.scope === "view" && p.inViewTruncated ? (
        <p className="text-sm text-muted">Zoom in to count what is in view.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Class</th>
              {shown.map((r, i) => (
                <th key={r.id} className="py-1 text-right font-medium" title={runTitle(r)}>
                  {i === 1 ? "┅ " : "─ "}
                  {r.model_name ?? r.provider}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.classes.map((c) => (
              <tr key={c.id} aria-label={c.name} className="border-t border-line">
                <td className="py-1.5">
                  <label className="flex items-center gap-2">
                    <Checkbox checked={!p.hidden.has(c.id)} onChange={() => p.onToggleClass(c.id)} aria-label={`Show ${c.name}`} />
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.colour }} aria-hidden="true" />
                    <span className="truncate">{c.name}</span>
                  </label>
                </td>
                {shown.map((r) => (
                  <td key={r.id} className="py-1.5 text-right text-ink">
                    {fmt(source[r.id]?.[c.id] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
            <tr aria-label="Total" className="border-t border-line-strong font-semibold">
              <td className="py-1.5">Total</td>
              {shown.map((r) => (
                <td key={r.id} className="py-1.5 text-right">
                  {fmt(total(r.id))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      <Field label="Minimum confidence" htmlFor="min-conf" hint={`Showing boxes at ${Math.round(p.minConf * 100)} % or more.`}>
        <input
          id="min-conf"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.minConf}
          onChange={(e) => p.onMinConf(Number(e.target.value))}
          className="accent-accent"
        />
      </Field>
    </section>
  );
}
```

Check `Checkbox`'s props in `src/ui/Checkbox.tsx`. If it takes `checked`/`onChange` with a
different signature (for example `onCheckedChange`), adapt the call. Don't wrap it.

- [ ] **Step 6: Implement `NewRunDialog` and `RunList`**

`frontend/src/maps/NewRunDialog.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import type { GeoMap, MapRun, ProviderName } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createMapRun, estimateMapRun, type MapRunEstimate } from "@/api/maps";
import { useProviders } from "@/api/providers";
import { useModels } from "@/models/useModels";
import { useJobsStore } from "@/store/jobs";
import { Button, Dialog, Field, Input, Segmented, Select } from "@/ui";
import { defaultTargetGsd, validateRunForm } from "./runModel";

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

export function NewRunDialog({
  projectId,
  geoMap,
  runs,
  onClose,
  onStarted,
}: {
  projectId: string;
  geoMap: GeoMap;
  runs: MapRun[];
  onClose: () => void;
  onStarted: (run: MapRun) => void;
}) {
  const api = useApi();
  const registry = useModels(projectId);
  const providers = useProviders();
  const [kind, setKind] = useState<"local_model" | "cloud_provider">("local_model");
  const [modelId, setModelId] = useState("");
  const [provider, setProvider] = useState<ProviderName>("anthropic");
  const [query, setQuery] = useState("");
  const [gsd, setGsd] = useState<string>("");
  const [conf, setConf] = useState("0.25");
  const [estimate, setEstimate] = useState<MapRunEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveModel = modelId || registry.models[0]?.id || "";
  useEffect(() => {
    const d = defaultTargetGsd(runs, kind === "local_model" ? effectiveModel : null, geoMap.gsd_cm);
    setGsd(d ? String(d) : "");
  }, [runs, kind, effectiveModel, geoMap.gsd_cm]);

  const body = {
    map_id: geoMap.id,
    kind,
    ...(kind === "local_model" ? { model_id: effectiveModel } : { provider, query: query.trim() || undefined }),
    conf: Number(conf),
    target_gsd_cm: gsd ? Number(gsd) : null,
  };
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    if (kind === "local_model" && !effectiveModel) return;
    let cancelled = false;
    estimateMapRun(api, projectId, JSON.parse(bodyKey))
      .then((e) => !cancelled && setEstimate(e))
      .catch(() => !cancelled && setEstimate(null));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, bodyKey, kind, effectiveModel]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const form = kind === "local_model" ? { kind, modelId: effectiveModel } : { kind, provider, query };
    const problem = validateRunForm(form, providers.providers);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const r = await createMapRun(api, projectId, body);
      useJobsStore.getState().upsert(r.job);
      onStarted(r.run);
    } catch (err) {
      setError(messageOf(err, "could not start the run"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      width="lg"
      title="Detect on this map"
      description="Runs the model across the whole map in windows and counts every class. Empty (nodata) areas are skipped."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="detect" loading={busy}>
            Start detection
          </Button>
        </>
      }
    >
      <Segmented
        label="Detector"
        value={kind}
        onChange={setKind}
        options={[
          { value: "local_model", label: "Local model" },
          { value: "cloud_provider", label: "Cloud provider" },
        ]}
      />
      {kind === "local_model" ? (
        <Field label="Model" htmlFor="run-model">
          <Select id="run-model" value={effectiveModel} onChange={(e) => setModelId(e.target.value)}>
            {registry.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="Provider" htmlFor="run-provider">
            <Select id="run-provider" value={provider} onChange={(e) => setProvider(e.target.value as ProviderName)}>
              {providers.providers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What to find" htmlFor="run-query">
            <Input id="run-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="excavators" />
          </Field>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Model trained at (cm / px)"
          htmlFor="run-gsd"
          hint={geoMap.gsd_cm ? `This map is ${geoMap.gsd_cm.toFixed(1)} cm / px. Different by over 15 % means the map is rescaled.` : "The map has no ground resolution; no rescaling."}
        >
          <Input id="run-gsd" type="number" step="0.1" min="0.1" value={gsd} onChange={(e) => setGsd(e.target.value)} />
        </Field>
        <Field label="Confidence" htmlFor="run-conf">
          <Input id="run-conf" type="number" step="0.05" min="0" max="1" value={conf} onChange={(e) => setConf(e.target.value)} />
        </Field>
      </div>
      {estimate && (
        <p className="text-sm text-muted" aria-live="polite">
          {`${fmt(estimate.requests)} windows to check · ${fmt(estimate.skipped_windows)} empty skipped${estimate.scale !== 1 ? ` · scaled ×${estimate.scale}` : ""}`}
          {estimate.estimated_cost > 0 && ` · about $${estimate.estimated_cost.toFixed(2)}`}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
```

`frontend/src/maps/RunList.tsx`:

```tsx
import type { MapRun } from "@contract/client";
import { useApi } from "@/api/client";
import { deleteMapRun, resumeMapRun } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Checkbox, IconButton, Pill, Progress, type PillTone } from "@/ui";
import { runTitle } from "./runModel";

const TONE: Record<string, PillTone> = { succeeded: "ok", failed: "danger", cancelled: "neutral", running: "accent", queued: "neutral" };

export function RunList({
  projectId,
  runs,
  selected,
  onToggle,
  onChanged,
}: {
  projectId: string;
  runs: MapRun[];
  selected: string[];
  onToggle: (runId: string) => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const jobs = useJobsStore((s) => s.jobs);
  if (!runs.length) return <p className="text-sm text-muted">No runs on this map yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Runs">
      {runs.map((r) => {
        const job = r.job_id ? jobs[r.job_id] : undefined;
        const state = job?.state ?? r.state ?? "queued";
        const done = state === "succeeded";
        return (
          <li key={r.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={selected.includes(r.id)} disabled={!done} onChange={() => onToggle(r.id)} aria-label={`Show ${runTitle(r)}`} />
              <span className="min-w-0 flex-1 truncate text-sm">{runTitle(r)}</span>
              <Pill tone={TONE[state] ?? "neutral"}>{done ? `${r.detection_count}` : state}</Pill>
            </div>
            {(state === "running" || state === "queued") && <Progress value={job?.progress} running label={`Detecting: ${runTitle(r)}`} thin />}
            {(state === "failed" || state === "cancelled") && (
              <div className="flex gap-1">
                <IconButton icon="refresh" size="sm" label="Resume run" onClick={() => void resumeMapRun(api, projectId, r.id).then((j) => { useJobsStore.getState().upsert(j); onChanged(); })} />
                <IconButton icon="trash" size="sm" label="Delete run" onClick={() => void deleteMapRun(api, projectId, r.id).then(onChanged)} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 7: Wire it into `MapsScreen`**

Changes to `frontend/src/screens/MapsScreen.tsx`:

1. **State:**
   - `runs: MapRun[]`
   - `selected: string[]` (max 2)
   - `minConf` (default 0.25)
   - `hidden: Set<string>`
   - `scope: CountScope`
   - `wholeMap`, `inView`: records keyed by run id
   - `inViewTruncated`
   - `newRun: boolean`
2. **Loading:**
   - When `active` changes, `listMapRuns`, then `setRuns`.
   - `useOnJobsFinished("map_detect", reloadRuns)`.
   - When a newly selected run finishes, select it automatically if fewer than two are selected.
3. **Whole-map counts:** for each selected run, `fetchDensity(api, projectId, runId, 1, minConf)` then `countsFromDensity`. One cell gives the exact whole-map count at the current confidence.
4. **Layers:** call `useRunLayer` twice, for `selected[0]` (solid) and `selected[1]` (dashed; spec `null` when absent):
   - `colours` come from `project.classes` (`useProject` returns `project`).
   - `load = (bbox, c) => fetchDetections(api, projectId, runId, bbox, c)`
   - `density = (c) => fetchDensity(api, projectId, runId, 128, c)`
   - `onViewCounts = (counts, t) => { setInView((v) => ({ ...v, [runId]: counts })); setInViewTruncated(t); }`
5. **Left rail**, under the map list when a map is active: a "Runs" heading, a `New run` button (disabled unless `active.status === "ready"`), and `RunList`.
6. **Right panel**, under `MapFacts`: `ResultsPanel` when `selected.length > 0`; otherwise the hint text "Tick a finished run to see its boxes and counts."
7. `NewRunDialog` when `newRun`. `onStarted` closes it and reloads the runs.
8. **Box popover (spec section 7).** On `olMap.on("singleclick", e)`, take the first feature with a
   `classId` under the pointer (`olMap.forEachFeatureAtPixel(e.pixel, (f) => f.get("classId") ? f : undefined)`)
   and show a small absolutely positioned card at `e.pixel` containing:
   - the class name and confidence (`Math.round(conf * 100)` %);
   - the centre readout from `makeReadout(active)(cx, cy)`, which gives pixel, native and WGS84;
   - the size in metres, `w × gsd_cm / 100` by `h × gsd_cm / 100`, when `gsd_cm` is known.

   The box geometry comes from `fromOl` on the feature extent (`boxFromExtent` arrives in Task 13;
   here use `fromOl` on the extent's corners). Escape or a click elsewhere closes it. The panel and
   the popover use the same `Readout` strings, so the screen shows one coordinate format.

   Test it in `MapsScreen.test.tsx` only through the pure part: export a `boxFacts(geoMap, box, classes, confidence)`
   helper from `runModel.ts` that returns the lines shown. Assert, for the UTM example map and the
   box `{ x: 1000, y: 2000, w: 100, h: 50 }`, that it gives `"3.0 × 1.5 m"` and a native centre of
   `"500031.50, 4982939.25 · EPSG:32633"`.

Extend `MapsScreen.test.tsx`:

- Serve `/runs` with `{ items: [exampleMapRun] }`.
- Serve `/density` with `{ cell_size: 80000, cells: [{ gx: 0, gy: 0, class_id: CLASS_ID(1), count: 42 }] }`.
- Tick the run's checkbox (`Show machinery-v3 · …`).
- Assert the panel shows "42" in the excavator row, and that a `/density` request carried `cells=1`.

- [ ] **Step 8: Run the tests and gates**

Run: `pnpm -C frontend test; pnpm -C frontend lint; pnpm -C frontend build`
Expected: all pass.

- [ ] **Step 9: See it working**

Run the app against the backend as in Task 11. Run a real model on a real map, or use the
squares fixture with a cloud key.

- Boxes appear in the right place at every zoom.
- Zooming out past the 5000-box cap switches to dots.
- The whole-map count equals the run's `detection_count` at the run's confidence.
- Two runs compare as solid and dashed outlines.

Take a screenshot for the ledger.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/maps/runModel.ts frontend/src/maps/runModel.test.ts frontend/src/maps/runLayer.ts frontend/src/maps/NewRunDialog.tsx frontend/src/maps/NewRunDialog.test.tsx frontend/src/maps/RunList.tsx frontend/src/maps/ResultsPanel.tsx frontend/src/maps/ResultsPanel.test.tsx frontend/src/screens/MapsScreen.tsx frontend/src/screens/MapsScreen.test.tsx
git commit -m "feat(maps-ui): map runs - new run dialog, viewport box layers, density, counts, compare

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 13: Label mode: zones, boxes, hotkeys, undo/redo, seed-from-run

**Files:**
- Create: `frontend/src/maps/labelModel.ts`, `frontend/src/maps/labelModel.test.ts` (pure: history, point-in-polygon, warnings)
- Create: `frontend/src/maps/labelLayers.ts` (OpenLayers hook: layers and interactions)
- Create: `frontend/src/maps/LabelPanel.tsx`, `frontend/src/maps/LabelPanel.test.tsx`
- Modify: `frontend/src/screens/MapsScreen.tsx`, `frontend/src/screens/MapsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 10 zone/label/seed API; Task 12 `runTitle`; Task 11 `styles`.
- Produces:
  - `labelModel.ts`:
    - `type Box = { x: number; y: number; w: number; h: number }`
    - `type LabelCommand = { kind: "create"; id: string; body: MapLabelCreate } | { kind: "update"; id: string; before: MapLabelUpdate; after: MapLabelUpdate } | { kind: "delete"; id: string; body: MapLabelCreate }`
    - `interface LabelApi { create(body): Promise<string>; update(id, body): Promise<void>; remove(id): Promise<void> }`
    - `class LabelHistory` with `record(cmd)`, `undo(api): Promise<boolean>`, `redo(api): Promise<boolean>`, `canUndo`, `canRedo`
    - `pointInPolygon(x, y, poly: number[][]): boolean`
    - `outsideZones(labels: MapLabel[], zones: MapZone[]): Set<string>`
    - `boxFromExtent(e: Extent): Box` (map pixels, clamped to ≥ 1 px)
  - `labelLayers.ts`:
    - `type Tool = "pan" | "zone-rect" | "zone-poly" | "box"`
    - `useLabelLayers(map, geoMap, opts: { labels; zones; colours; tool; activeClassId; selectedId; warnIds: Set<string>; matchOf?; onBox(box); onZone(polygon: number[][]); onEdit(id, box); onSelect(id | null) })`
  - `LabelPanel` with props `{ tool; onTool; classes; activeClassId; onClass; zones; labels; warnCount; seededCount; runs; onSeed(runId, zoneId, minConf); onRenameZone(id, name); onDeleteZone(id); canUndo; canRedo; onUndo; onRedo }`

- [ ] **Step 1: Write the failing pure tests**

`frontend/src/maps/labelModel.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { exampleLabel, exampleZone } from "@/test/fixtures";
import { boxFromExtent, LabelHistory, outsideZones, pointInPolygon, type LabelApi } from "./labelModel";

function fakeApi(): LabelApi & { calls: string[] } {
  let n = 0;
  const calls: string[] = [];
  return {
    calls,
    create: vi.fn(async () => {
      calls.push("create");
      return `new-${++n}`;
    }),
    update: vi.fn(async (id: string) => {
      calls.push(`update ${id}`);
    }),
    remove: vi.fn(async (id: string) => {
      calls.push(`remove ${id}`);
    }),
  };
}

const body = { class_id: "c", x: 1, y: 2, w: 3, h: 4 };

describe("label history", () => {
  it("undoes a create by deleting, and redo re-creates under a new id that later steps follow", async () => {
    const h = new LabelHistory();
    const api = fakeApi();
    h.record({ kind: "create", id: "a", body });
    h.record({ kind: "update", id: "a", before: { x: 1 }, after: { x: 9 } });
    expect(await h.undo(api)).toBe(true); // update back
    expect(await h.undo(api)).toBe(true); // create -> remove
    expect(api.calls).toEqual(["update a", "remove a"]);
    await h.redo(api); // create again -> new-1
    await h.redo(api); // the update now targets new-1
    expect(api.calls.slice(2)).toEqual(["create", "update new-1"]);
    expect(h.canRedo).toBe(false);
  });

  it("undoes a delete by re-creating, and a new edit clears redo", async () => {
    const h = new LabelHistory();
    const api = fakeApi();
    h.record({ kind: "delete", id: "a", body });
    await h.undo(api);
    expect(api.calls).toEqual(["create"]);
    h.record({ kind: "create", id: "b", body });
    expect(h.canRedo).toBe(false);
    expect(await new LabelHistory().undo(api)).toBe(false);
  });
});

describe("zones and boxes", () => {
  it("tests points against polygons", () => {
    expect(pointInPolygon(2, 2, [[0, 0], [10, 0], [0, 10]])).toBe(true);
    expect(pointInPolygon(8, 8, [[0, 0], [10, 0], [0, 10]])).toBe(false);
  });

  it("flags labels whose centre is outside every zone", () => {
    const inside = exampleLabel; // centre (1297.5, 1264) is inside the 1000..6000 x 1000..5000 zone
    const outside = { ...exampleLabel, id: "far", x: 9000, y: 9000 };
    expect(outsideZones([inside, outside], [exampleZone])).toEqual(new Set(["far"]));
    expect(outsideZones([inside], [])).toEqual(new Set([inside.id])); // no zones: nothing counts
  });

  it("turns an OpenLayers extent into a map-pixel box", () => {
    expect(boxFromExtent([10, -40, 50, -20])).toEqual({ x: 10, y: 20, w: 40, h: 20 });
    expect(boxFromExtent([10, -20, 10.2, -20])).toEqual({ x: 10, y: 20, w: 1, h: 1 });
  });
});
```

Run: `pnpm -C frontend test -- src/maps/labelModel`
Expected: FAIL (the module is missing).

- [ ] **Step 2: Implement `labelModel.ts`**

`frontend/src/maps/labelModel.ts`:

```ts
import type { MapLabel, MapZone } from "@contract/client";
import type { MapLabelCreate, MapLabelUpdate } from "@/api/maps";
import type { Extent } from "./grid";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LabelCommand =
  | { kind: "create"; id: string; body: MapLabelCreate }
  | { kind: "update"; id: string; before: MapLabelUpdate; after: MapLabelUpdate }
  | { kind: "delete"; id: string; body: MapLabelCreate };

export interface LabelApi {
  create(body: MapLabelCreate): Promise<string>;
  update(id: string, body: MapLabelUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Undo/redo over label edits that are already saved: every step is an API call, so nothing is
 * ever held unsaved. Re-creating a label gives it a new id; later steps that named the old id are
 * remapped so a redo chain keeps working.
 */
export class LabelHistory {
  private past: LabelCommand[] = [];
  private future: LabelCommand[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  record(cmd: LabelCommand): void {
    this.past.push(cmd);
    this.future = [];
  }

  private remap(oldId: string, newId: string): void {
    for (const c of [...this.past, ...this.future]) if (c.id === oldId) c.id = newId;
  }

  async undo(api: LabelApi): Promise<boolean> {
    const cmd = this.past.pop();
    if (!cmd) return false;
    if (cmd.kind === "create") await api.remove(cmd.id);
    else if (cmd.kind === "update") await api.update(cmd.id, cmd.before);
    else this.remap(cmd.id, await api.create(cmd.body));
    this.future.push(cmd);
    return true;
  }

  async redo(api: LabelApi): Promise<boolean> {
    const cmd = this.future.pop();
    if (!cmd) return false;
    if (cmd.kind === "create") this.remap(cmd.id, await api.create(cmd.body));
    else if (cmd.kind === "update") await api.update(cmd.id, cmd.after);
    else await api.remove(cmd.id);
    this.past.push(cmd);
    return true;
  }
}

export function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function outsideZones(labels: MapLabel[], zones: MapZone[]): Set<string> {
  const out = new Set<string>();
  for (const l of labels) {
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    if (!zones.some((z) => pointInPolygon(cx, cy, z.polygon))) out.add(l.id);
  }
  return out;
}

export function boxFromExtent(e: Extent): Box {
  const x = Math.round(e[0]);
  const y = Math.round(-e[3]);
  return { x, y, w: Math.max(1, Math.round(e[2]) - x), h: Math.max(1, Math.round(-e[1]) - y) };
}
```

Run: `pnpm -C frontend test -- src/maps/labelModel`
Expected: PASS.

- [ ] **Step 3: Implement the label layers hook**

`frontend/src/maps/labelLayers.ts`:

```ts
import { useEffect, useRef } from "react";
import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Draw, { createBox } from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Translate from "ol/interaction/Translate";
import { click } from "ol/events/condition";
import { Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import type { GeoMap, MapLabel, MapZone } from "@contract/client";
import { boxRing, fromOl, toOl, type Extent } from "./grid";
import { boxFromExtent, type Box } from "./labelModel";
import type { Match } from "./runLayer";
import { tokenColour } from "./styles";

export type Tool = "pan" | "zone-rect" | "zone-poly" | "box";

export interface LabelLayerOptions {
  labels: MapLabel[];
  zones: MapZone[];
  colours: Record<string, string>;
  tool: Tool;
  selectedId: string | null;
  warnIds: ReadonlySet<string>;
  matchOf?: (id: string) => Match | undefined;
  onBox: (box: Box) => void;
  onZone: (polygon: number[][]) => void;
  onEdit: (id: string, box: Box) => void;
  onSelect: (id: string | null) => void;
}

const MATCH_TOKEN: Record<Match, string> = { tp: "ok", fp: "danger", fn: "warn" };

/**
 * Ground truth on the map: zones (hatched outlines) and labels (solid ink outlines with the class
 * colour inside), plus the drawing and editing interactions for the current tool. Boxes stay
 * rectangles: an edited geometry is snapped back to its extent before it is saved.
 */
export function useLabelLayers(map: OlMap | null, geoMap: GeoMap, opts: LabelLayerOptions): void {
  const o = useRef(opts);
  const sources = useRef<{ labels: VectorSource; zones: VectorSource } | null>(null);
  useEffect(() => {
    o.current = opts;
  });

  useEffect(() => {
    if (!map) return;
    const labels = new VectorSource();
    const zones = new VectorSource();
    const zoneLayer = new VectorLayer({
      source: zones,
      zIndex: 5,
      style: new Style({
        stroke: new Stroke({ color: tokenColour("accent"), width: 2, lineDash: [10, 6] }),
        fill: new Fill({ color: tokenColour("accent", 0.06) }),
      }),
    });
    const labelLayer = new VectorLayer({
      source: labels,
      zIndex: 20,
      style: (f: FeatureLike) => {
        const id = String(f.getId());
        const match = o.current.matchOf?.(id);
        const selected = id === o.current.selectedId;
        const warn = o.current.warnIds.has(id);
        return [
          new Style({
            stroke: new Stroke({
              color: match ? tokenColour(MATCH_TOKEN[match]) : tokenColour("ink"),
              width: selected ? 3 : 2,
              lineDash: match === "fn" ? [4, 4] : undefined,
            }),
          }),
          new Style({
            stroke: new Stroke({ color: warn ? tokenColour("warn") : (o.current.colours[f.get("classId")] ?? tokenColour("accent")), width: 1 }),
          }),
        ];
      },
    });
    map.addLayer(zoneLayer);
    map.addLayer(labelLayer);
    sources.current = { labels, zones };
    return () => {
      map.removeLayer(zoneLayer);
      map.removeLayer(labelLayer);
      sources.current = null;
    };
  }, [map]);

  // Mirror the data into the sources whenever it changes.
  useEffect(() => {
    const s = sources.current;
    if (!s) return;
    s.labels.clear();
    s.labels.addFeatures(
      opts.labels.map((l) => {
        const f = new Feature(new Polygon([boxRing(l.x, l.y, l.w, l.h)]));
        f.setId(l.id);
        f.set("classId", l.class_id);
        return f;
      }),
    );
    s.zones.clear();
    s.zones.addFeatures(
      opts.zones.map((z) => {
        const f = new Feature(new Polygon([[...z.polygon.map(([x, y]) => toOl(x, y)), toOl(z.polygon[0][0], z.polygon[0][1])]]));
        f.setId(z.id);
        return f;
      }),
    );
  }, [opts.labels, opts.zones, map]);

  useEffect(() => {
    sources.current?.labels.changed();
  }, [opts.selectedId, opts.warnIds, opts.matchOf, opts.colours]);

  // Interactions for the current tool.
  useEffect(() => {
    const s = sources.current;
    if (!map || !s) return;
    const added: (Draw | Modify | Select | Translate)[] = [];
    if (opts.tool === "box" || opts.tool === "zone-rect") {
      const draw = new Draw({ source: new VectorSource(), type: "Circle", geometryFunction: createBox() });
      draw.on("drawend", (e) => {
        const box = boxFromExtent(e.feature.getGeometry()!.getExtent() as Extent);
        if (o.current.tool === "box") o.current.onBox(box);
        else o.current.onZone([[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]);
      });
      added.push(draw);
    } else if (opts.tool === "zone-poly") {
      const draw = new Draw({ source: new VectorSource(), type: "Polygon" });
      draw.on("drawend", (e) => {
        const ring = (e.feature.getGeometry() as Polygon).getCoordinates()[0].slice(0, -1);
        o.current.onZone(ring.map((c) => fromOl(c).map(Math.round)));
      });
      added.push(draw);
    } else {
      const select = new Select({ layers: (l) => l.getSource() === s.labels, condition: click, style: null });
      select.on("select", (e) => o.current.onSelect(e.selected[0] ? String(e.selected[0].getId()) : null));
      const features = select.getFeatures();
      const modify = new Modify({ features });
      const translate = new Translate({ features });
      const save = (fs: Feature[]) => {
        for (const f of fs) {
          const box = boxFromExtent(f.getGeometry()!.getExtent() as Extent);
          f.setGeometry(new Polygon([boxRing(box.x, box.y, box.w, box.h)]));  // snap back to a rectangle
          o.current.onEdit(String(f.getId()), box);
        }
      };
      modify.on("modifyend", (e) => save(e.features.getArray() as Feature[]));
      translate.on("translateend", (e) => save(e.features.getArray() as Feature[]));
      added.push(select, modify, translate);
    }
    added.forEach((i) => map.addInteraction(i));
    return () => added.forEach((i) => map.removeInteraction(i));
  }, [map, opts.tool]);
}
```

- [ ] **Step 4: Write the failing panel test, then implement `LabelPanel`**

`frontend/src/maps/LabelPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CLASS_ID, exampleClasses, exampleLabel, exampleMapRun, exampleZone } from "@/test/fixtures";
import { LabelPanel } from "./LabelPanel";

function renderPanel(over = {}) {
  const props = {
    tool: "pan" as const,
    onTool: vi.fn(),
    classes: exampleClasses,
    activeClassId: CLASS_ID(1),
    onClass: vi.fn(),
    zones: [exampleZone],
    labels: [exampleLabel],
    warnCount: 2,
    seededCount: 5,
    runs: [exampleMapRun],
    onSeed: vi.fn(),
    onRenameZone: vi.fn(),
    onDeleteZone: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...over,
  };
  render(<LabelPanel {...props} />);
  return props;
}

describe("LabelPanel", () => {
  it("switches tools and classes", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Box" }));
    expect(p.onTool).toHaveBeenCalledWith("box");
    fireEvent.click(screen.getByRole("button", { name: /dump_truck/ }));
    expect(p.onClass).toHaveBeenCalledWith(CLASS_ID(4));
  });

  it("warns about labels outside zones and unchecked seeds", () => {
    renderPanel();
    expect(screen.getByText("2 labels are outside every zone and will not count.")).toBeInTheDocument();
    expect(screen.getByText("5 seeded from a run, not yet checked.")).toBeInTheDocument();
  });

  it("seeds a zone from a run", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Copy detections into labels" }));
    expect(p.onSeed).toHaveBeenCalledWith(exampleMapRun.id, exampleZone.id, 0.25);
  });

  it("asks for a zone first when there is none", () => {
    renderPanel({ zones: [] });
    expect(screen.getByText(/Draw a zone around an area you will label completely/)).toBeInTheDocument();
  });
});
```

`frontend/src/maps/LabelPanel.tsx`:

```tsx
import { useState } from "react";
import type { ClassDef, MapLabel, MapRun, MapZone } from "@contract/client";
import { Alert, Button, Field, IconButton, Input, Kbd, Segmented, Select, cx } from "@/ui";
import type { Tool } from "./labelLayers";
import { runTitle } from "./runModel";

export interface LabelPanelProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  classes: ClassDef[];
  activeClassId: string;
  onClass: (id: string) => void;
  zones: MapZone[];
  labels: MapLabel[];
  warnCount: number;
  seededCount: number;
  runs: MapRun[];
  onSeed: (runId: string, zoneId: string, minConf: number) => void;
  onRenameZone: (id: string, name: string) => void;
  onDeleteZone: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function LabelPanel(p: LabelPanelProps) {
  const finished = p.runs.filter((r) => r.state === "succeeded");
  const [runId, setRunId] = useState(finished[0]?.id ?? "");
  const [zoneId, setZoneId] = useState(p.zones[0]?.id ?? "");
  const seedRun = runId || finished[0]?.id || "";
  const seedZone = zoneId || p.zones[0]?.id || "";
  return (
    <section className="flex flex-col gap-4" aria-label="Labels">
      <div className="flex items-center gap-2">
        <Segmented
          label="Tool"
          size="sm"
          value={p.tool}
          onChange={p.onTool}
          options={[
            { value: "pan", label: "Select" },
            { value: "zone-rect", label: "Zone ▭" },
            { value: "zone-poly", label: "Zone ⬠" },
            { value: "box", label: "Box" },
          ]}
        />
        <IconButton icon="undo" size="sm" label="Undo" disabled={!p.canUndo} onClick={p.onUndo} />
        <IconButton icon="redo" size="sm" label="Redo" disabled={!p.canRedo} onClick={p.onRedo} />
      </div>
      {p.zones.length === 0 && (
        <Alert tone="info">
          Draw a zone around an area you will label completely. Only boxes inside zones are scored, so a
          small zone labelled fully beats a big one labelled halfway.
        </Alert>
      )}
      <ul className="flex flex-col gap-0.5" aria-label="Classes">
        {p.classes.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => p.onClass(c.id)}
              aria-pressed={c.id === p.activeClassId}
              className={cx("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm", c.id === p.activeClassId ? "bg-accent-soft text-accent-ink" : "hover:bg-hover/5")}
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.colour }} aria-hidden="true" />
              <span className="flex-1 truncate">{c.name}</span>
              {c.hotkey && <Kbd>{c.hotkey}</Kbd>}
            </button>
          </li>
        ))}
      </ul>
      {p.warnCount > 0 && <p className="text-sm text-warn">{p.warnCount} labels are outside every zone and will not count.</p>}
      {p.seededCount > 0 && <p className="text-sm text-muted">{p.seededCount} seeded from a run, not yet checked.</p>}
      {p.zones.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Zones">
          {p.zones.map((z) => (
            <li key={z.id} className="flex items-center gap-1">
              <Input dense aria-label="Zone name" defaultValue={z.name} onBlur={(e) => e.target.value.trim() && e.target.value !== z.name && p.onRenameZone(z.id, e.target.value.trim())} />
              <IconButton icon="trash" size="sm" label={`Delete ${z.name}`} onClick={() => p.onDeleteZone(z.id)} />
            </li>
          ))}
        </ul>
      )}
      {finished.length > 0 && p.zones.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <p className="text-sm font-medium">Start from a run</p>
          <Field label="Run" htmlFor="seed-run">
            <Select id="seed-run" value={seedRun} onChange={(e) => setRunId(e.target.value)}>
              {finished.map((r) => (
                <option key={r.id} value={r.id}>
                  {runTitle(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zone" htmlFor="seed-zone">
            <Select id="seed-zone" value={seedZone} onChange={(e) => setZoneId(e.target.value)}>
              {p.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" onClick={() => p.onSeed(seedRun, seedZone, 0.25)}>
            Copy detections into labels
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">
        <Kbd>1</Kbd>–<Kbd>9</Kbd> class · <Kbd>B</Kbd> box · <Kbd>Z</Kbd> zone · <Kbd>Del</Kbd> delete · <Kbd>Ctrl Z</Kbd> undo · <Kbd>Esc</Kbd> select
      </p>
    </section>
  );
}
```

Check `Alert` tones and `Input`'s `dense` prop in `src/ui/`. Both exist per the Input signature,
but confirm the tone union before using `"info"`.

Run: `pnpm -C frontend test -- src/maps/LabelPanel`
Expected: PASS.

- [ ] **Step 5: Wire label mode into `MapsScreen`**

1. **Right panel:** a `Segmented` with the tabs "Results" / "Labels" (Task 14 adds "Score"), held in `tab` state.
2. **State:**
   - `zones`, `labels`: loaded with `listZones` and `listLabels` when the map changes, and reloaded on `map_labels.changed` events (subscribe the way `useJobToasts` or the events hook does), or simply after each local edit;
   - `tool` (default `"pan"`);
   - `activeClassId` (the first class);
   - `selectedId`;
   - `history` (`useRef(new LabelHistory())`) plus a `version` counter to re-render `canUndo`/`canRedo`.
3. **The `LabelApi` adapter:**
   - `create`: `createLabel(...)` returns `.id`, and the local labels are reloaded;
   - `update`: `updateLabel`;
   - `remove`: `deleteLabel`.
4. **`useLabelLayers(olMap, active, {...})`**, always mounted so labels show in every tab. When the tab isn't "Labels", pass `tool: "pan"`. Callbacks:
   - `onBox`: `createLabel` with `activeClassId`, then `history.record({ kind: "create", id, body })`;
   - `onZone`: `createZone` named `Zone ${zones.length + 1}`;
   - `onEdit`: `updateLabel`, then record `{ kind: "update", id, before: <old box>, after: <new box> }`;
   - `onSelect`: `setSelectedId`.
5. **Hotkeys**, a `keydown` listener on `window` while the Labels tab is open, ignored when `e.target` is an input, select or textarea:
   - digits → the class with that hotkey;
   - `b` → the box tool; `z` → the rectangle zone tool; `Escape` → the select tool;
   - `Delete`/`Backspace` with a selection → `deleteLabel`, then record a `delete`;
   - `Ctrl+Z` → undo; `Ctrl+Shift+Z` or `Ctrl+Y` → redo.
6. **Derived values:**
   - `warnIds = useMemo(() => outsideZones(labels, zones), [labels, zones])`
   - `seededCount = labels.filter((l) => l.source.startsWith("from_run:")).length`

Extend `MapsScreen.test.tsx`:

- Serve `/zones` with `[exampleZone]` and `/labels` with `[exampleLabel]`.
- Click the "Labels" tab and assert the zone name input shows "Zone 1".
- Fire `keydown` with `key: "4"` and assert that the dump_truck button has `aria-pressed="true"`.

- [ ] **Step 6: Run the tests and gates**

Run: `pnpm -C frontend test; pnpm -C frontend lint; pnpm -C frontend build`
Expected: all pass.

- [ ] **Step 7: See it working**

On the real app:

1. Draw a rectangle zone and a polygon zone.
2. Draw three boxes with different classes via hotkeys.
3. Move one box and resize another. It must stay a rectangle.
4. Delete one, undo twice, redo once.
5. Seed a zone from a run.

Check after each step (by reloading the screen) that the server matches what the map shows.
Take a screenshot for the ledger.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/maps/labelModel.ts frontend/src/maps/labelModel.test.ts frontend/src/maps/labelLayers.ts frontend/src/maps/LabelPanel.tsx frontend/src/maps/LabelPanel.test.tsx frontend/src/screens/MapsScreen.tsx frontend/src/screens/MapsScreen.test.tsx
git commit -m "feat(maps-ui): label mode - zones, boxes, hotkeys, undo/redo, seed from a run

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 14: Score panel and overlay, stepping through mistakes, export dialog

**Files:**
- Create: `frontend/src/maps/scoreView.ts`, `frontend/src/maps/scoreView.test.ts` (pure)
- Create: `frontend/src/maps/ScorePanel.tsx`, `frontend/src/maps/ScorePanel.test.tsx`
- Create: `frontend/src/maps/ExportMapDialog.tsx`, `frontend/src/maps/ExportMapDialog.test.tsx`
- Modify: `frontend/src/jobs/jobLabels.ts` (map exports reuse the results-export folder helpers)
- Modify: `frontend/src/screens/MapsScreen.tsx`, `frontend/src/screens/MapsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 10 `fetchScore`, `createMapExport`; Task 12 `RunLayerSpec.matchOf`, `runTitle`; Task 13 `LabelLayerOptions.matchOf`.
- Produces:
  - `scoreView.ts`:
    - `matchLookup(score: MapScore | null, kind: "detection" | "label"): ((id: string) => Match | undefined) | undefined`
    - `mistakes(score: MapScore): MapScore["matches"]` (FP and FN only, sorted by zone, then by y, then by x)
    - `pct(v: number | null): string`
    - `signed(n: number): string`
  - `ScorePanel` with props `{ runs; scores: Record<string, MapScore | null>; classes; overlay; onOverlay; onStep(match) }`
  - `ExportMapDialog` with props `{ projectId; geoMap; runs; selectedRunId; onClose }`

- [ ] **Step 1: Write the failing pure tests**

`frontend/src/maps/scoreView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleLabel, exampleMapScore } from "@/test/fixtures";
import { matchLookup, mistakes, pct, signed } from "./scoreView";

describe("score view", () => {
  it("looks up a box's match by kind", () => {
    const det = matchLookup(exampleMapScore, "detection")!;
    expect(det("d1")).toBe("tp");
    expect(det("d2")).toBe("fp");
    expect(det(exampleLabel.id)).toBeUndefined();
    expect(matchLookup(exampleMapScore, "label")!(exampleLabel.id)).toBe("fn");
    expect(matchLookup(null, "label")).toBeUndefined();
  });

  it("lists only the mistakes, in reading order", () => {
    expect(mistakes(exampleMapScore).map((m) => m.id)).toEqual(["d2", exampleLabel.id]);
  });

  it("formats percentages and signed counts", () => {
    expect(pct(0.857)).toBe("85.7 %");
    expect(pct(null)).toBe("—");
    expect(signed(-1)).toBe("−1");
    expect(signed(3)).toBe("+3");
    expect(signed(0)).toBe("0");
  });
});
```

Run: `pnpm -C frontend test -- src/maps/scoreView`
Expected: FAIL (the module is missing).

- [ ] **Step 2: Implement `scoreView.ts`**

`frontend/src/maps/scoreView.ts`:

```ts
import type { MapScore } from "@contract/client";
import type { Match } from "./runLayer";

type Kind = "detection" | "label";

export function matchLookup(score: MapScore | null, kind: Kind): ((id: string) => Match | undefined) | undefined {
  if (!score) return undefined;
  const byId = new Map(score.matches.filter((m) => m.kind === kind).map((m) => [m.id, m.match as Match]));
  return (id) => byId.get(id);
}

export function mistakes(score: MapScore): MapScore["matches"] {
  return score.matches
    .filter((m) => m.match !== "tp")
    .sort((a, b) => a.zone_id.localeCompare(b.zone_id) || a.y - b.y || a.x - b.x);
}

export function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)} %`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}
```

Run: `pnpm -C frontend test -- src/maps/scoreView`
Expected: PASS.

- [ ] **Step 3: Write the failing ScorePanel test**

`frontend/src/maps/ScorePanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleClasses, exampleMapRun, exampleMapScore } from "@/test/fixtures";
import { ScorePanel } from "./ScorePanel";

const second = { ...exampleMapRun, id: "r2", model_name: "machinery-v4" };

describe("ScorePanel", () => {
  it("shows precision, recall, F1 and count error for each selected run", () => {
    render(
      <ScorePanel
        runs={[exampleMapRun, second]}
        scores={{ [exampleMapRun.id]: exampleMapScore, r2: { ...exampleMapScore, overall: { ...exampleMapScore.overall, recall: 0.93 } } }}
        classes={exampleClasses}
        overlay
        onOverlay={() => {}}
        onStep={() => {}}
      />,
    );
    expect(screen.getByRole("row", { name: "Precision" })).toHaveTextContent("90.0 %");
    expect(screen.getByRole("row", { name: "Recall" })).toHaveTextContent("85.7 %");
    expect(screen.getByRole("row", { name: "Recall" })).toHaveTextContent("93.0 %");
    expect(screen.getByRole("row", { name: "Count error" })).toHaveTextContent("−1");
  });

  it("steps through mistakes", () => {
    const onStep = vi.fn();
    render(<ScorePanel runs={[exampleMapRun]} scores={{ [exampleMapRun.id]: exampleMapScore }} classes={exampleClasses} overlay onOverlay={() => {}} onStep={onStep} />);
    expect(screen.getByText("2 mistakes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next mistake" }));
    expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ id: "d2", match: "fp" }));
    expect(screen.getByText("1 of 2 · false alarm: excavator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next mistake" }));
    expect(screen.getByText("2 of 2 · missed: dump_truck")).toBeInTheDocument();
  });

  it("explains that scoring needs zones", () => {
    render(<ScorePanel runs={[exampleMapRun]} scores={{ [exampleMapRun.id]: { ...exampleMapScore, has_zones: false } }} classes={exampleClasses} overlay={false} onOverlay={() => {}} onStep={() => {}} />);
    expect(screen.getByText(/Label a zone to score this run/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Implement `ScorePanel`**

`frontend/src/maps/ScorePanel.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { ClassDef, MapRun, MapScore } from "@contract/client";
import { EmptyState, IconButton, Switch } from "@/ui";
import { runTitle } from "./runModel";
import { mistakes, pct, signed } from "./scoreView";

type Row = MapScore["overall"];
type MatchRow = MapScore["matches"][number];

const METRICS: [string, (r: Row) => string][] = [
  ["Precision", (r) => pct(r.precision)],
  ["Recall", (r) => pct(r.recall)],
  ["F1", (r) => pct(r.f1)],
  ["Found / true", (r) => `${r.predicted} / ${r.actual}`],
  ["Count error", (r) => signed(r.count_error)],
];

export function ScorePanel({
  runs,
  scores,
  classes,
  overlay,
  onOverlay,
  onStep,
}: {
  runs: MapRun[];
  scores: Record<string, MapScore | null>;
  classes: ClassDef[];
  overlay: boolean;
  onOverlay: (on: boolean) => void;
  onStep: (m: MatchRow) => void;
}) {
  const shown = runs.filter((r) => scores[r.id]);
  const first = shown[0] ? scores[shown[0].id]! : null;
  const list = useMemo(() => (first ? mistakes(first) : []), [first]);
  const [at, setAt] = useState(-1);
  const name = (id: string) => classes.find((c) => c.id === id)?.name ?? "unknown class";

  if (!first) return <p className="text-sm text-muted">Tick a finished run to score it.</p>;
  if (!first.has_zones) {
    return (
      <EmptyState icon="label" title="Label a zone to score this run">
        Draw a zone on the Labels tab and label every machine inside it; the run is then scored inside it.
      </EmptyState>
    );
  }
  const step = (delta: number) => {
    if (!list.length) return;
    const next = (at + delta + list.length) % list.length;
    setAt(next);
    onStep(list[next]);
  };
  const current = at >= 0 ? list[at] : null;
  return (
    <section className="flex flex-col gap-4" aria-label="Score">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 font-medium">IoU ≥ {first.iou}</th>
            {shown.map((r) => (
              <th key={r.id} className="py-1 text-right font-medium" title={runTitle(r)}>
                {r.model_name ?? r.provider}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map(([label, fmt]) => (
            <tr key={label} aria-label={label} className="border-t border-line">
              <td className="py-1.5 text-muted">{label}</td>
              {shown.map((r) => (
                <td key={r.id} className="py-1.5 text-right text-ink">
                  {fmt(scores[r.id]!.overall)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Per class</summary>
        <table className="mt-2 w-full tabular-nums">
          <tbody>
            {first.per_class.map((r) => (
              <tr key={r.class_id} className="border-t border-line">
                <td className="py-1">{name(r.class_id ?? "")}</td>
                <td className="py-1 text-right">{pct(r.precision)}</td>
                <td className="py-1 text-right">{pct(r.recall)}</td>
                <td className="py-1 text-right">{signed(r.count_error)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <Switch checked={overlay} onChange={onOverlay} label="Colour boxes by result (green right, red false alarm, amber missed)" />
      <div className="flex items-center gap-2">
        <IconButton icon="arrow-left" size="sm" label="Previous mistake" disabled={!list.length} onClick={() => step(-1)} />
        <IconButton icon="chevron-right" size="sm" label="Next mistake" disabled={!list.length} onClick={() => step(1)} />
        <span className="text-sm text-muted">
          {current
            ? `${at + 1} of ${list.length} · ${current.match === "fp" ? "false alarm" : "missed"}: ${name(current.class_id)}`
            : `${list.length} mistakes`}
        </span>
      </div>
    </section>
  );
}
```

Check the `Switch` props in `src/ui/Switch.tsx` (`checked`, `onChange`, `label` or children) and
adapt the call.

Run: `pnpm -C frontend test -- src/maps/ScorePanel`
Expected: PASS.

- [ ] **Step 5: Write the failing export dialog test, then implement it**

`frontend/src/maps/ExportMapDialog.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleGeoMap, exampleMapRun, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ExportMapDialog } from "./ExportMapDialog";

describe("ExportMapDialog", () => {
  it("exports a scored run in every format", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/map-exports$/, status: 202, body: { job: { ...runningJob, type: "map_export" } } }]);
    renderWithProviders(<ExportMapDialog projectId={PROJECT_ID} geoMap={exampleGeoMap} runs={[exampleMapRun]} selectedRunId={exampleMapRun.id} onClose={() => {}} />, { api });
    fireEvent.click(screen.getByRole("radio", { name: "Run scored against labels" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ map_id: exampleGeoMap.id, content: "run_score", run_id: exampleMapRun.id, formats: ["geojson", "gpkg", "csv"] });
    expect(useJobsStore.getState().jobs[runningJob.id]?.type).toBe("map_export");
  });

  it("offers only the pixel CSV for a map without coordinates", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<ExportMapDialog projectId={PROJECT_ID} geoMap={{ ...exampleGeoMap, crs_wkt: null }} runs={[]} selectedRunId={null} onClose={() => {}} />, { api });
    expect(screen.getByRole("checkbox", { name: /GeoJSON/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /CSV/ })).toBeChecked();
    expect(screen.getByText(/no coordinates/i)).toBeInTheDocument();
  });
});
```

`frontend/src/maps/ExportMapDialog.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import type { GeoMap, MapRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createMapExport, type MapExportRequest } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Button, Checkbox, Dialog, Field, Segmented, Select, toast } from "@/ui";
import { runTitle } from "./runModel";

type Content = MapExportRequest["content"];
type Format = MapExportRequest["formats"][number];

const FORMATS: { value: Format; label: string; hint: string; geo: boolean }[] = [
  { value: "geojson", label: "GeoJSON", hint: "WGS84 polygons, for web maps and most GIS tools", geo: true },
  { value: "gpkg", label: "GeoPackage", hint: "layers in the map's own coordinate system, for QGIS, ArcGIS, Civil 3D", geo: true },
  { value: "csv", label: "CSV", hint: "one row per box: corners and centre in the map's system and in lat/lon", geo: false },
];

export function ExportMapDialog({
  projectId,
  geoMap,
  runs,
  selectedRunId,
  onClose,
}: {
  projectId: string;
  geoMap: GeoMap;
  runs: MapRun[];
  selectedRunId: string | null;
  onClose: () => void;
}) {
  const api = useApi();
  const geo = !!geoMap.crs_wkt;
  const finished = runs.filter((r) => r.state === "succeeded");
  const [content, setContent] = useState<Content>(finished.length ? "run" : "labels");
  const [runId, setRunId] = useState(selectedRunId ?? finished[0]?.id ?? "");
  const [formats, setFormats] = useState<Format[]>(geo ? ["geojson", "gpkg", "csv"] : ["csv"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!formats.length) return setError("Choose at least one format.");
    setBusy(true);
    try {
      const body: MapExportRequest = { map_id: geoMap.id, content, ...(content !== "labels" ? { run_id: runId } : {}), formats: FORMATS.map((f) => f.value).filter((f) => formats.includes(f)) };
      const job = await createMapExport(api, projectId, body);
      useJobsStore.getState().upsert(job);
      toast("Export started: the folder opens from the jobs panel when it is done.");
      onClose();
    } catch (err) {
      setError(messageOf(err, "could not start the export"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Export boxes with coordinates"
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="download" loading={busy}>
            Export
          </Button>
        </>
      }
    >
      <Segmented
        label="What to export"
        value={content}
        onChange={setContent}
        options={[
          ...(finished.length ? [{ value: "run" as const, label: "Run detections" }, { value: "run_score" as const, label: "Run scored against labels" }] : []),
          { value: "labels" as const, label: "Labels" },
        ]}
      />
      {content !== "labels" && (
        <Field label="Run" htmlFor="export-run">
          <Select id="export-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
            {finished.map((r) => (
              <option key={r.id} value={r.id}>
                {runTitle(r)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">Formats</legend>
        {FORMATS.map((f) => (
          <label key={f.value} className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={formats.includes(f.value)}
              disabled={f.geo && !geo}
              onChange={() => setFormats((cur) => (cur.includes(f.value) ? cur.filter((x) => x !== f.value) : [...cur, f.value]))}
              aria-label={f.label}
            />
            <span>
              <span className="text-ink">{f.label}</span> <span className="text-muted">— {f.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {!geo && <p className="text-sm text-muted">This map has no coordinates, so only the CSV with pixel positions can be exported.</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
```

Run: `pnpm -C frontend test -- src/maps/ExportMapDialog`
Expected: PASS.

- [ ] **Step 6: Let map exports use the export folder helpers**

In `frontend/src/jobs/jobLabels.ts`, in `resultsExportFiles` and `resultsExportFolder`, change
`job.type === "results_export"` to `(job.type === "results_export" || job.type === "map_export")`.
Leave `resultsExportSummary` alone: it counts images, which a map export does not have.

Add a test to the existing `jobLabels` tests: a succeeded `map_export` job with
`result: { folder: "exports/2026-09-22_120000", files: ["map-a-labels.csv"], box_count: 1 }`
returns that folder and those files.

- [ ] **Step 7: Wire the Score tab, overlay, stepping and export into `MapsScreen`**

1. **Tabs:** add "Score" as the third right-panel tab.
2. **Scores:** hold `scores: Record<runId, MapScore | null>`.
   - For each selected run, `fetchScore(api, projectId, runId)`.
   - Refetch when `labels`/`zones` change (use `active.labels_version` after reloading the map, or a local counter bumped on every label or zone edit) and when a `map_detect` job finishes.
3. **Overlay** (`overlay` state, default on in the Score tab):
   - pass `matchOf: overlay ? matchLookup(scores[selected[0]], "detection") : undefined` into the first run's `RunLayerSpec`;
   - pass `matchOf: overlay ? matchLookup(scores[selected[0]], "label") : undefined` into `useLabelLayers`.
4. **`onStep(m)`:** `olMap.getView().fit(boundingExtent([toOl(m.x, m.y), toOl(m.x + m.w, m.y + m.h)]), { padding: [120, 120, 120, 120], maxZoom: <full-resolution zoom>, duration: 250 })`.
   - `boundingExtent` comes from `ol/extent`.
   - Full-resolution zoom is `active.tile_grid.max_zoom`: index `max_zoom` in the view's `resolutions` array is resolution 1.
5. **Export:** an `Export` button (icon `download`) in the right panel header opens `ExportMapDialog` with `selectedRunId={selected[0] ?? null}`.

Extend `MapsScreen.test.tsx`:

- Serve `/score` with `exampleMapScore`.
- Tick the run and open the Score tab.
- Assert "90.0 %" is shown.
- Click "Export" and assert the dialog title "Export boxes with coordinates" is visible.

- [ ] **Step 8: Run the tests and gates**

Run: `pnpm -C frontend test; pnpm -C frontend lint; pnpm -C frontend build`
Expected: all pass.

- [ ] **Step 9: See it working**

On the real app, with a labelled zone and two runs:

1. Scores appear side by side.
2. The overlay colours match what you see: a box with no label under it is red.
3. Next/Previous centre each mistake.
4. Export all three formats.
5. Open the `.gpkg` in QGIS (or `ogrinfo`) and check the boxes sit on the machines over a basemap
   or the source GeoTIFF.
6. Open the `.geojson` at geojson.io, **only if the operator agrees to uploading site
   coordinates**. Otherwise open it in QGIS.
7. Open the CSV in Excel.

Take screenshots and record the QGIS result for the ledger.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/maps/scoreView.ts frontend/src/maps/scoreView.test.ts frontend/src/maps/ScorePanel.tsx frontend/src/maps/ScorePanel.test.tsx frontend/src/maps/ExportMapDialog.tsx frontend/src/maps/ExportMapDialog.test.tsx frontend/src/jobs/jobLabels.ts frontend/src/jobs/jobLabels.test.ts frontend/src/screens/MapsScreen.tsx frontend/src/screens/MapsScreen.test.tsx
git commit -m "feat(maps-ui): score panel and overlay, mistake stepping, export with coordinates

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

`jobLabels.test.ts` may be named differently. Stage whichever file holds the `jobLabels` tests.

---
### Task 15: End-to-end test, docs, full gate, merge, operator walkthrough

**Files:**
- Create: `frontend/e2e/maps.spec.ts`
- Modify: `docs/progress.md`
- Create: `docs/usability/2026-09-22-maps-walkthrough.md`

- [ ] **Step 1: Write the e2e test (Prism mock + route overrides)**

`frontend/e2e/maps.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP = "a0000000-6666-4000-8000-000000000001";
const RUN = "r0000000-7777-4000-8000-000000000001";
const EXC = "c1a2b3c4-0000-4000-8000-000000000001";
// 1x1 grey PNG; OpenLayers stretches it over the tile, which is all this test needs.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const CORS = { "Access-Control-Allow-Origin": "*" };

const map = {
  id: MAP, name: "Site north ortho", status: "ready", error: null, source_path: "D:/orthos/site-north.tif",
  source_size: 3221225472, width: 8000, height: 6000, band_count: 3, dtype: "uint8",
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 33N"]', epsg: 32633,
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  geotransform: [500000, 0.03, 0, 4983000, 0, -0.03], bounds_native: [500000, 4982820, 500240, 4983000],
  bounds_wgs84: [15.0, 44.99, 15.003, 45.0], gsd_cm: 3, tile_grid: { tile_size: 256, max_zoom: 5 },
  labels_version: 0, job_id: null, created_at: "2026-09-22T10:00:00Z",
};
const run = {
  id: RUN, map_id: MAP, kind: "local_model", model_id: "m0000000-2222-4000-8000-000000000001", provider: null,
  model_name: "machinery-v3", query: "", tile_size: 1280, overlap: 0.2, nms_iou: 0.5, conf: 0.25, target_gsd_cm: 2,
  job_id: null, state: "succeeded", counts: { [EXC]: 42 }, detection_count: 42, created_at: "2026-09-22T11:00:00Z",
};
const row = (class_id: string | null) => ({
  class_id, tp: 18, fp: 2, fn: 3, precision: 0.9, recall: 0.857, f1: 0.878, predicted: 20, actual: 21, count_error: -1, count_error_pct: -4.76,
});
const score = {
  run_id: RUN, iou: 0.5, labels_version: 1, has_zones: true, overall: row(null), per_class: [row(EXC)], per_zone: [],
  matches: [{ kind: "detection", id: "d2", match: "fp", zone_id: "z1", class_id: EXC, x: 3000, y: 2400, w: 170, h: 110 }],
};

async function json(page: Page, pattern: (u: URL) => boolean, body: unknown, status = 200) {
  await page.route(pattern, (route) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) }),
  );
}

test("opens a map, counts a run, draws a zone, scores and exports", async ({ page }) => {
  const zonePosts: unknown[] = [];
  const exportPosts: unknown[] = [];
  await page.route((u) => u.pathname.includes(`/maps/${MAP}/tiles/`), (r) =>
    r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await page.route((u) => u.pathname.endsWith(`/maps/${MAP}/preview`), (r) =>
    r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await json(page, (u) => u.pathname === `/api/v1/projects/${P}/maps`, { items: [map] });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/runs`), { items: [run] });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/labels`), { items: [] });
  await json(page, (u) => u.pathname.endsWith("/density"), { cell_size: 8000, cells: [{ gx: 0, gy: 0, class_id: EXC, count: 42 }] });
  await json(page, (u) => u.pathname.endsWith("/detections"), {
    items: [{ id: "d1", class_id: EXC, confidence: 0.9, x: 1000, y: 1000, w: 180, h: 120, angle: null }], truncated: false,
  });
  await json(page, (u) => u.pathname.endsWith("/score"), score);
  await page.route((u) => u.pathname.endsWith(`/maps/${MAP}/zones`), async (r) => {
    if (r.request().method() === "POST") {
      zonePosts.push(r.request().postDataJSON());
      return r.fulfill({ status: 201, contentType: "application/json", headers: CORS, body: JSON.stringify({ id: "z1", map_id: MAP, name: "Zone 1", polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }) });
    }
    return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ items: [] }) });
  });
  await page.route((u) => u.pathname.endsWith("/map-exports"), (r) => {
    exportPosts.push(r.request().postDataJSON());
    return r.fulfill({ status: 202, contentType: "application/json", headers: CORS, body: JSON.stringify({ job: { id: "j0000000-4444-4000-8000-000000000001", project_id: P, type: "map_export", state: "queued", progress: 0, message: "", log_path: "", params: {}, result: null, error: null, created_at: "2026-09-22T12:00:00Z", started_at: null, finished_at: null } }) });
  });

  const firstTile = page.waitForRequest((r) => r.url().includes(`/maps/${MAP}/tiles/`));
  await page.goto(`/p/${P}/maps/${MAP}`);
  await firstTile;
  await expect(page.getByTestId("map-panel")).toContainText("EPSG:32633");

  const canvas = page.getByTestId("map-view");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/° N, .*° E/)).toBeVisible();

  await page.getByRole("checkbox", { name: /Show machinery-v3/ }).check();
  await expect(page.getByRole("row", { name: /excavator/ })).toContainText("42");

  await page.getByRole("radio", { name: "Labels" }).click();
  await page.getByRole("radio", { name: "Zone ▭" }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 220, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => zonePosts.length).toBe(1);
  expect((zonePosts[0] as { polygon: number[][] }).polygon).toHaveLength(4);

  await page.getByRole("radio", { name: "Score" }).click();
  await expect(page.getByRole("row", { name: "Precision" })).toContainText("90.0 %");

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Export" }).click();
  await expect.poll(() => exportPosts.length).toBe(1);
  expect(exportPosts[0]).toMatchObject({ map_id: MAP, content: "run", formats: ["geojson", "gpkg", "csv"] });
});
```

OpenLayers' `createBox` draw completes on a click-move-click sequence as well as on
press-drag-release. If the drag does not finish a zone in headless Chromium, replace the
down/move/up sequence with `page.mouse.click(a)`, `page.mouse.move(b)`, `page.mouse.click(b)`.
Do not add a timeout.

The project, models and providers requests fall through to Prism's contract examples, like every
other e2e spec here.

Run: `pnpm -C frontend e2e -- maps.spec.ts` (or `scripts\finish-task.ps1`, which picks free ports)
Expected: PASS.

- [ ] **Step 2: Run the whole gate**

```
pnpm -C contract check
cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
cargo test --manifest-path frontend/src-tauri/Cargo.toml   # only if binaries/kestrel-backend-*.exe exists
```

Every line must pass. Paste the tail of each into the ledger entry in Step 4. Follow
`superpowers:verification-before-completion`: no "should pass".

- [ ] **Step 3: Write the usability walkthrough**

`docs/usability/2026-09-22-maps-walkthrough.md`. Frontmatter: `type: usability`, `date: 2026-09-22`.
It is the operator's numbered "how to test this", and each step states what they should see:

1. Open a project, then **Maps** in the left rail, then **Import map**. Pick an orthomosaic `.tif`
   (use a real multi-GB one). The map appears in the list with a progress bar and becomes
   clickable when done. The source file is untouched.
2. Click the map. It fills the centre.
   - Scroll to zoom from the whole site down to a single machine. Tiles load within about a second
     per view, with no seams.
   - The bottom bar shows pixel, map (EPSG) and lat/lon coordinates under the cursor, and the scale
     bar tracks the zoom.
3. Under **Runs**, click **New run**. Pick a model and check the "Model trained at" GSD. The line
   under it shows windows to check, empty windows skipped, and the scale factor. Click **Start
   detection**. The run shows progress ("window n / N · k detections"); cancel and **Resume** work.
4. Tick the finished run.
   - Boxes appear on the machines.
   - The Results table shows counts per class for the whole map; switch to **In view** to count the
     visible area.
   - Move the confidence slider: boxes and counts follow.
   - Zoom far out: boxes turn into density dots.
5. Tick a second run. The two show as solid and dashed outlines, with counts side by side.
6. **Labels** tab:
   - Draw a zone (▭ or ⬠) around an area you will label completely.
   - **Copy detections into labels** from a run, then fix them: `1`–`9` class, `B` box, drag to
     move or resize, `Del` delete, `Ctrl+Z`/`Ctrl+Y`.
   - The "seeded, not yet checked" count falls as you edit.
7. **Score** tab:
   - Precision, recall, F1 and count error for each ticked run.
   - Colour boxes by result: green is correct, red a false alarm, amber dashed a miss.
   - **Next mistake** flies to each error.
8. **Export**: choose **Run scored against labels** with all three formats. When the job finishes,
   open the folder from the jobs panel.
   - Open the `.gpkg` in QGIS: the layers land on the machines in the map's CRS.
   - Open the `.csv` in Excel: every box has four corners in the map's CRS and in lat/lon.
9. Import a plain TIFF without coordinates. It still views, detects, labels and scores; export
   offers the pixel CSV only and says why.

- [ ] **Step 4: Add the ledger entry**

In `docs/progress.md`, add at the top of `## Log`, following the format of the neighbouring
entries:

```markdown
### 2026-09-22 — GeoTIFF maps (spec 2026-09-22-geotiff-maps, plan of the same date)

- Import, tiles, detection, labels, scoring and export: merged at <merge sha>.
- Gate: <paste each gate line's result>.
- Frozen sidecar: geo-selftest `<line>`; bundle size <before> → <after> (ADR 2026-09-22 rasterio).
- Real map: <file name, size, px, EPSG> imported in <time>; zoom checked at every level; screenshots in `docs/evidence/maps/`.
- Detection: <model> on <map>: <counts>; seam duplicates checked visually: <result>.
- GIS check: `.gpkg` opened in <QGIS version / ogrinfo> — <result>; or "no GIS tool on this machine, not verified".
- Deviations from the spec: see the plan's "Deviations" list (display raster, model GSD, run state, tile media types, export names, on-demand scoring, mock e2e) plus the seam cut-box filter and match geometry in the score response.
```

Save the screenshots under `docs/evidence/maps/`.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/maps.spec.ts docs/progress.md docs/usability/2026-09-22-maps-walkthrough.md docs/evidence/maps
git commit -m "test(maps): e2e flow; docs: maps walkthrough and ledger entry

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```


- [ ] **Step 6: Finish the task**

Use `superpowers:finishing-a-development-branch`, then run `scripts\finish-task.ps1`. It runs the
gate, merges `task/geotiff-maps` to `main`, removes the worktree and deletes the branch. Follow the
worktree-removal memory: links are removed as links, never `rm -rf` on the worktree.

After the merge, confirm with the operator before dispatching the CI `sidecar-smoke` workflow
(north-star §5), because packaging changed. Then run `/wrapup` for the vault session note and
north-star bump.

Give the operator the walkthrough from Step 3 as the numbered "how to test this".
