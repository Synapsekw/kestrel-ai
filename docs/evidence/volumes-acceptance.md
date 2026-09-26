---
type: evidence
date: 2026-09-25
tags: [evidence, volumes, acceptance]
---

# Volumes (S2) acceptance: module-level measurements

Spec `docs/superpowers/specs/2026-09-23-volumes-design.md` §1 "Done means"; plan
`docs/superpowers/plans/2026-09-24-volumes.md`; task-17 brief Steps 1, 3, 4, 5;
`.superpowers/sdd/2026-09-24-volumes/acceptance-results.md` (the full run report, kept for detail).

The controller ruled a **module-level** run because S1's point-cloud import UI is not on `main`
yet. The builds call `app.surfaces.build.build_surface` and the measurements call
`app.volumes.engine.measure` directly — no app, no job runner, no database. `build_one.py` does the
same work `jobs_build.run_surface_build` does: the work dir is `<surface>/.build`, `shutil.rmtree`
runs in a `finally`, and the parameters are the API defaults exactly as `service.resolve_params`
sets them for an empty request (median, auto cell, fill gaps 1.0 m, despike 1.0 m, no Z clip, drop
noise classes). Each build ran in a fresh subprocess, one at a time. Peak memory is
`psutil.Process().memory_info().peak_wset` of that process, read at the end of the build.

## Environment

| Item | Value |
| --- | --- |
| CPU | 13th Gen Intel Core i7-13700K, 16 physical / 24 logical cores, 3.4 GHz base |
| RAM | 63.8 GiB |
| OS | Windows 11 Pro 10.0.26200 |
| Python / libs | 3.11.15; laspy 2.7.0, rasterio 1.4.4, numpy 2.4.6 (overlay venv, contract recipe; `test_dependency_pins.py` 11 passed) |
| Code | `task/volumes` @ `51816d1` (acceptance run), evidence written from `.claude/worktrees/volumes-t17` @ `94c4e8b` |
| Data | session-scratchpad copies of `chimney.las` (21 697 184 pts, EPSG:32639, scale 0.001) and `big9.las` (195 274 656 pts, 3×3 tiling of the chimney cloud, brief's `tile9.py`); the NAS source was not touched |
| +0.100 m copy | brief's `raise_z.py`: printed "raised by 0.1 m", 737 705 337 bytes, 1.9 s |

## A. Build time and memory (Done-means 1, 7)

| Metric | chimney.las (21.7 M pts) | big9.las (195.3 M pts) | chimney +0.100 m (21.7 M pts) |
| --- | --- | --- | --- |
| build_s | 8.92 | 83.82 | 9.08 |
| wall clock | 8.94 s | 83.97 s | 9.09 s |
| peak working set | 625.0 MiB | 1 817.8 MiB | 623.7 MiB |
| density_per_m2 | 24.0 | 24.0 | 24.0 |
| spacing_m | 0.2041 | 0.2041 | 0.2041 |
| auto_cell / cell | true / 0.5 m | true / 0.5 m | true / 0.5 m |
| grid (w × h) | 1374 × 1404 | 4320 × 4409 | 1374 × 1404 |
| cells_valid | 1 111 095 | 10 000 666 | 1 111 095 |
| cells_despiked | 41 874 | 376 345 | 41 873 |
| cells_filled | 63 760 | 574 425 | 63 759 |
| points_dropped (noise/withheld/z_clip) | 0/0/0 | 0/0/0 | 0/0/0 |
| `.build` folder gone afterwards | yes | yes | yes |

| Criterion | Target | Measured | Result |
| --- | --- | --- | --- |
| chimney build_s | ≤ 60 s | 8.92 s | PASS |
| chimney peak memory | ≤ 2 GB | 625 MiB | PASS |
| big9 build_s | ≤ 600 s | 83.82 s | PASS (§16 fallback — `ThreadPoolExecutor(4)` — not needed) |
| big9 peak memory | ≤ 2 GB (acceptance) / 1.5 GB (target) | 1 818 MiB | **PASS on acceptance** (11 % under 2 GiB), **over the 1.5 GB target** |
| big9 `.build` removed | gone | gone | PASS |

**Parked follow-up — memory growth with site size.** Memory is meant to be bounded by the block
size, but peak working set grew 2.9× (625 MiB → 1 818 MiB) when the site grew 9×, though a single
block should set the ceiling regardless of overall extent. The 256 MiB spill buffer and the 16 M-point
reduce cap don't explain that growth on their own. Suspects: the pass-1 `(uint32, float32)` sort
copy per 2 M-point chunk, the pass-0 count grid, or the `_finish_pass` neighbour set. This stays a
follow-up to profile (`build.py` bin/spill buffers) before larger sites are accepted, not a release
blocker — it passes the ≤ 2 GB acceptance bound with an 11 % margin, it just misses the tighter
1.5 GB target.

## B. A mound, toe-plane, toe-surface and flat bases (Done-means 2)

Polygon (native EPSG:32639, 40 × 40 m centred on the stack body, edge on ground and low plant):
`[[243503.0, 3178235.0], [243543.0, 3178235.0], [243543.0, 3178275.0], [243503.0, 3178275.0], [243503.0, 3178235.0]]`.
Flat level: the surface's bilinear Z at the picked bare-ground point (243505.25, 3178237.25) =
**−44.004 m**.

| Base | Fill m³ | Cut m³ | Net m³ | ± total m³ | Area / measured / nodata m² | Base fit | Warnings | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| toe_plane | 65 077.3 | 1 295.9 | 63 781.3 | 5 012.0 | 1600 / 1600 / 0 | 320 samples, 31 rejected, edge 100 %, RMS 3.13 m | `base_fit_poor` (3.13 m RMS) | PASS (warning fires correctly on a plane toe over cluttered plant ground) |
| toe_surface | 62 262.6 | 2 641.2 | 59 621.3 | 327.8 | 1600 / 1600 / 0 | 320 samples, 110 rejected, RMS 0.014 m | none | PASS |
| flat @ −44.004 | 67 299.8 | 94.4 | 67 205.4 | 15.0 | 1600 / 1600 / 0 | edge RMS 8.55 m vs. the level (reported only) | none | PASS |

Criterion: the measurement runs end to end with fill, cut, net, ±, areas and warnings, and the
warning fires where it should. **PASS.** Machine masking (the second half of Done-means 2) needs a
detection run over an imported map, which needs S1's import UI — it stays an operator step.

## C. The +0.100 m copy (Done-means 4)

Top = the copy's surface, base = the original surface; `same_lattice(top, base)` = true, identical
geotransform (243194.0, 0.5, 0, 3178617.0, 0, −0.5). Measurement polygon: the same 40 × 40 m square
as §B. Stable polygon (bare ground ~100 m west of the stack, std < 0.2 m):
`[[243404.0, 3178257.0], [243434.0, 3178257.0], [243434.0, 3178277.0], [243404.0, 3178277.0], [243404.0, 3178257.0]]`.

| Run | Fill m³ | Cut m³ | Net m³ | ± total m³ | Alignment | Warnings |
| --- | --- | --- | --- | --- | --- | --- |
| no shift | 160.000 | 0 | 160.000 | 159.998 | n 2400, median_dz +0.0999985 m, MAD 0, σ 0, tilt ≈ 0 | `alignment_offset`: "surveys differ by +0.100 m on stable ground; apply the shift?" |
| shift applied (0.0999985 m) | 0.00311 | 0.00065 | 0.00246 | 0.00048 | as above | none |

Whole-lattice check: over 1 111 095 cells valid in both surfaces, dZ median 0.1000004, p01 0.0999985,
p99 0.1000061 — 99.9999 % of cells within 1 mm of 0.100 m.

| Criterion | Target | Measured | Result |
| --- | --- | --- | --- |
| stable-area median dZ | +0.100 ± 0.005 m | +0.0999985 m | PASS |
| `alignment_offset` fires without the shift | fires | fires (warn) | PASS |
| with the shift, \|net\| ≤ `uncertainty.total_m3` | \|net\| ≤ U | 0.00246 m³ vs. U 0.00048 m³ | **FAIL by the letter** — see the ruling below |

### Controller ruling: the shifted-net check

The leftover net of 0.00246 m³ over 1 600 m² (a mean of 1.5 µm per cell) is a float32 storage
artefact, not a volume error. Surfaces are stored as float32; the precision of a float32 height
depends on its magnitude — about 4 µm at |z| ≈ 44 m (the stable area, on the ground) and about
15 µm at |z| ≈ 170 m (the stack top). So the per-cell dZ comes out as 0.0999985 on the ground and
0.1000061 on the stack top, leaving µm residuals after the shift is applied. The synthetic copy is a
*perfect* shift, so the stable-area MAD is exactly 0, which makes σ = 0, the alignment uncertainty
term 0, and the total ± falls back to the tiny cell-size term — an unusually small denominator for
comparison. On any real second survey, σ would be at least millimetre-scale and U would cover this
residual easily.

The controller's ruling (`.superpowers/sdd/2026-09-24-volumes/progress.md`): **the shifted-net check
counts as a pass in substance** — 0.0025 m³ over 1 600 m² is float32 height quantisation
(1.5 µm/cell), and a real survey pair always has a non-zero stable-area spread. No sigma floor was
added to the engine to force a literal pass on the synthetic case, because that would change the
uncertainty maths and require bumping `ENGINE_VERSION` for a demo-only artefact. Cost if wrong: a
synthetic-copy demonstration shows net 0.00 m³ against ± 0.00 m³ and reads as a literal miss to
someone who does not read this note. No code was changed for this ruling.

## Pass/fail summary

| Done-means | Criterion | Result |
| --- | --- | --- |
| 1 | chimney (21.7 M pts) builds in ≤ 60 s | PASS (8.92 s) |
| 7 | chimney build peak memory ≤ 2 GB | PASS (625 MiB) |
| 1/7 | big9 (195 M pts) builds in ≤ 600 s, peak ≤ 2 GB, `.build` cleaned up | PASS (83.82 s, 1 818 MiB, cleaned) — memory over the 1.5 GB target, see the parked follow-up |
| 2 | a stockpile measures end to end (fill, cut, net, ±, areas, warnings) with all three base kinds | PASS |
| 2 | machine masking on a detection run | operator/S1-pending |
| 3 | a machine footprint patches/excludes the measured area | operator/S1-pending |
| 4 | +0.100 m copy: stable-area median dZ, `alignment_offset` fires | PASS |
| 4 | +0.100 m copy: shifted net within ± U | FAIL by the letter, ruled a pass in substance (float32 µm residue on a synthetic perfect shift) |
| 5 | CloudCompare cross-check | operator-pending (CloudCompare not installed on the build machine) |
| 6 | QGIS / PDF / XLSX export review | operator-pending |

## Commands

Run from `<worktree>\backend` with `$env:PYTHONPATH = (Get-Location).Path`; `$sp` = the session
scratchpad; scripts in `$sp\s2-accept\`.

```powershell
.\.venv\Scripts\python.exe "$sp\s2-accept\raise_z.py" "$sp\spike-data\chimney.las" "$sp\s2-accept\chimney-plus100mm.las"
.\.venv\Scripts\python.exe "$sp\s2-accept\build_one.py" "$sp\spike-data\chimney.las" "$sp\s2-accept\out" chimney
.\.venv\Scripts\python.exe "$sp\s2-accept\build_one.py" "$sp\s2-accept\chimney-plus100mm.las" "$sp\s2-accept\out" plus100
.\.venv\Scripts\python.exe "$sp\s2-accept\build_one.py" "$sp\spike-data\big\big9.las" "$sp\s2-accept\out" big9
.\.venv\Scripts\python.exe "$sp\s2-accept\explore.py"  "$sp\s2-accept\out\chimney\surface.tif"
.\.venv\Scripts\python.exe "$sp\s2-accept\explore2.py" "$sp\s2-accept\out\chimney\surface.tif" 243526.25 3178276.75 40
.\.venv\Scripts\python.exe "$sp\s2-accept\measure_all.py" "$sp\s2-accept\out"
```

Raw results kept: `$sp\s2-accept\out\build-{chimney,plus100,big9}.json`,
`$sp\s2-accept\out\measure-results.json`. Large intermediates (the +0.100 m LAS copy, the surface
GeoTIFFs, the diff GeoTIFF) were deleted after the run.

## Not covered here (operator steps, pending S1's import UI)

Done-means 2's machine masking and Done-means 3 need a detection run over an imported map.
Done-means 5 is the CloudCompare cross-check (`docs/evidence/volumes-crosscheck.md`; CloudCompare is
not installed). Done-means 6 is the QGIS / PDF / XLSX review. Importing the three test clouds
(chimney, +0.100 m copy, big9) through the Point clouds screen waits on S1's import UI landing on
`main`.
