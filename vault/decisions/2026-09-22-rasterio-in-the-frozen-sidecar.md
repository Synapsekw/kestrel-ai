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
data. The spec collects `rasterio`/`pyproj` dynamic libs and data files plus six hidden imports:
the plan's original six, minus `rasterio._shim` (does not exist in 1.4.4, removed), plus
`rasterio.serde` (missing, found during the spike — see Trap). `app/maps/gdal_env.py` sets
`GDAL_DATA`/`PROJ_DATA`/`PROJ_LIB` to `_MEIPASS/rasterio/...` when frozen, never over an operator
value. `kestrel-backend.exe geo-selftest` is the permanent check, and `smoke_frozen.ps1` runs it
first.

**Trap.** A frozen build *starts* fine without the data folders. It fails only at the first
reprojection ("no database context"), which is deep inside an export job. The selftest makes
that fail at build time instead.

A second trap surfaced during the spike: rasterio's `_base` Cython extension imports the pure
Python module `rasterio.serde` at init time, purely dynamically — PyInstaller's static analysis
cannot see into a compiled `.pyx`, so the first frozen build started but `geo-selftest` died with
`ModuleNotFoundError: No module named 'rasterio.serde'`. Fixed with one more hidden import
(`rasterio.serde`); the six hidden imports listed in the plan were not quite enough on their own.
Separately, `rasterio._shim` (also listed in the plan) does not exist in rasterio 1.4.4 — it was
removed or renamed upstream, and PyInstaller logged `ERROR: Hidden import 'rasterio._shim' not
found` on every build. It was never a functional gap (nothing in this rasterio version imports
it), but dead packaging config that always errors is worse than following the plan literally, so
it was removed from the spec rather than kept.

**Evidence.** Built 2026-09-23 from this worktree (`backend/scripts/build.ps1 -Venv
E:\Dev\Yolo\app\backend\.venv`). Bundle size before (main checkout, 2026-09-20, no rasterio/pyproj):
3,691,474,113 bytes (3,520.6 MiB), 14,120 files. After (this change): 3,785,991,153 bytes
(3,610.6 MiB, matching the build script's own report), 14,445 files — +94.5 MB (+90.0 MiB), +325
files. `smoke_frozen.ps1` passed end to end; its first line:
`geo ok 32633 15.000325 45.000216`, followed by `health ok`, `cuda True NVIDIA GeForce RTX 5070
Ti`, `starter ok 3`, ... `worker ok mAP50 0.0`, `export ok ... 10.1 MB`, `smoke ok`.
