---
type: report
date: 2026-09-24
tags: [evidence, surfaces, design]
---

# Design surfaces — acceptance evidence

Machine: Intel Core i7-13700K (24 threads), 64 GB RAM (63.8 GiB), Windows 11 Pro 10.0.26200; project
and design files on a Samsung SSD 9100 PRO (NVMe, C:), code on a Samsung SSD 860 QVO (E:). Chimney
project: `chimney.las` (LAS 1.2, point format 3, 21 697 184 points, EPSG:32639, 737.7 MB), DSM
`0c7c97cc-6587-4c25-8248-ee35200e5e06` (`median`), cell 0.5 m, 1374 × 1404.

**How it was run (ruled headless).** The real backend from the `task/design-surfaces` worktree
(`backend\.venv\Scripts\python.exe -m app`) on port 8791 with `APP_DATA_DIR` in a scratch folder — not
the operator's `%APPDATA%\kestrel-ai` — and `KESTREL_POTREECONVERTER` pointing at a verified
PotreeConverter 2.1.5 folder. Every step went through the HTTP API the UI calls: `createProject`
(kind `detect`) → `createPointCloud` (import 10.05 s) → `createSurface` (build 9.87 s) →
`design_acceptance.py` on that `surface.tif` (41 s; 120 744 vertices on a 344 × 351 lattice,
153 466 TIN faces, 50 857 contour lines) → per file `createDesignInspection` → `createDesignPreview`
(→ the suggestion's `options_patch` for `site-enz.xml`) → `createDesignSurface`, and
`createVolumeMeasurement` for step 5. Durations are job `started_at` → `finished_at`. The backend log
has no traceback and no 5xx. Raw responses (WKT and scratch paths trimmed): `acceptance-raw.json`;
preview images: `preview-*.png`.

| Step (spec §15.4) | File | Overlap | Median dz | Method | Result |
| --- | --- | --- | --- | --- | --- |
| 1 LandXML N E Z | site-nez.xml | 98.4 % (cloud surface covered 93.4 %) | +0.005 m (P5 −3.19, P95 +3.25) | tin | PASS (≥ 95 %, \|dz\| < 0.2 m). 153 466 triangles; inspect 0.86 s, preview 0.57 s, build 0.87 s; 1372 × 1401 on the DSM lattice. Only note: `crs_from_file` (info) |
| 2 LandXML E N Z → Apply swap | site-enz.xml | 0.0 % / 98.4 % | +0.005 m (after) | tin | PASS. Before: `no_overlap` (warn), suggestion `swap_xy` "With easting/northing swapped, 67 % of the design lies on the cloud surface." Applying `{"swap_xy": true}` gives the same preview as step 1; imported with `swap_xy: true`, no warnings to accept |
| 3a DXF 3D faces | site-3dface.dxf | 98.4 % (93.4 %) | +0.005 m (P5 −3.19, P95 +3.25) | tin | PASS. One layer DESIGN_TIN, 153 466 `3dface`; `crs_assumed` (info: the DSM's EPSG:32639); inspect 10.42 s, preview 0.76 s, build 1.16 s |
| 3b DXF contours (trimmed) | site-contours.dxf | 88.2 % (94.7 %) | +0.067 m (P5 −3.17, P95 +3.28) | delaunay | PASS on dz; long edges removed: 3 559 triangles, max edge 6.1 m (automatic, 6.12 m); 35 zero-area triangles skipped; 688 838 points from 50 857 `polyline_3d` → 1 304 783 triangles. Inspect 39.33 s, preview 5.06 s, build 12.91 s. Overlap is below step 1's 95 % because the triangulation bridges the DSM's interior no-data areas (peeling works from the hull inward, so enclosed gaps stay — visible in `preview-site-contours.png`); the design area is 346 577 m² against 306 299 m² for the TIN |
| 4 DEM in EPSG:32638 | site-dem-32638.tif | 100 % (84.1 %) | −0.012 m (P5 −4.26, P95 +4.12) | dem_resample | PASS. Source CRS EPSG:32638 "GeoTIFF CRS"; re-gridded onto the DSM lattice (aligned to `0c7c97cc…`, 0.5 m, 1516 × 1545 — the zone-38 footprint is rotated, so its bounding box is larger); inspect 0.11 s, preview 0.28 s, build 2.17 s |
| 5 S2 volume against each design | — | — | — | — | PASS: all five `ready` (each 0.07–0.09 s). 40 × 40 m square centred on the chimney top (243 526.25 E, 3 178 276.75 N, z 184.33 m), top = DSM, base = design; area 1 620 m². Cut / fill: nez 5 964.7 / 5 943.6 m³ (net −21.1); enz 5 964.7 / 5 943.6 (net −21.1); 3dface 5 965.0 / 5 943.4 (net −21.6); contours 5 740.6 / 5 953.4 (net +212.8); dem 4 919.5 / 4 924.5 (net +5.0). Only warning: `no_stable_area` |

Other walkthrough checks, same run:

- **Wrong foot (walkthrough step 10).** `site-nez.xml` read as international foot: `no_overlap` (warn),
  `foot_ambiguity` (warn: "survey vs international foot moves this design by up to 1.94 m"),
  `units_mismatch_crs` (info), and the suggestion "Read in Metre, 67 % of the design lies on the cloud
  surface." Cancelling (`deleteDesignInspection`) answered 204 and the inspection then 404 — nothing
  imported.
- **DWG (step 11).** A `.dwg` file → 422 `validation_error`, `details.reason = "dwg"`, message "DWG files
  can't be read. Open the drawing in your CAD program (or the free ODA File Converter) and save it as
  DXF, then import the DXF."
- **Delete.** A design used by a measurement → 409 `conflict` ("… is used by Chimney vs …; delete those
  first"); a fresh unused design (a second DEM import) → 204 and its `surfaces/<id>/` folder is gone.

| Timing (spec §16.11) | Target | Measured |
| --- | --- | --- |
| Inspect 1 M points / 2 M faces | < 60 s | 7.90 s (`perf-1m.xml`, 105 MB: 1 000 000 points, 1 996 002 faces) — PASS |
| Build onto 5 000 × 5 000 | < 60 s | 8.38 s (no target, cell 0.2 m → 4996 × 4996, `tin`; the preview before it 4.56 s) — PASS |

The generator's 1 000 × 1 000 lattice at 1 m spans 999 m, so the 0.2 m grid is 4996 × 4996 rather than
5 000 × 5 000 (0.2 % fewer cells).

Measured constants: `QHULL_BYTES_PER_POINT` 700 (Task 5: ~684 B/point measured, rounded up — 2.3 %
headroom), `DXF_RAM_FACTOR` 12 (Task 8, asserted by `test_the_ram_factor_holds_on_a_20_mb_dxf`).

## Findings

- **The suggestion under-reports its overlap on this site (low; follow-up, not fixed here).** Both
  suggestions above say "67 %", while the preview after applying the swap measures 98.4 %.
  `validate._suggestions` scores each hypothesis on up to 20 000 of the file's *vertices* sampled
  against the target overview, not on the footprint's cells as the preview's `overlap_fraction` (spec
  §10: "Recomputed on the footprint's bbox and mask"). `design_acceptance.py` writes every lattice vertex,
  including the ~33 % that sit on DSM no-data cells and belong to no face, so those count as misses.
  Repro: steps 1–2 above; `POST /design-inspections` on `site-enz.xml`, preview with the detected options
  and the DSM as target → `suggestions[0].overlap_fraction` 0.671; apply the patch → `overlap_fraction`
  0.984. The suggestion still clears the ≥ 50 % / +30-point gate and Apply fixes the placement, so step 2
  passes; a design whose orphan vertices push the score under 50 % would get no suggestion.
- **A ready design surface can't be deleted from the Volumes screen.** S2's surface list offers Delete
  only on failed rows (volumes spec §9); the API deletes a ready one. Noted in the walkthrough (step 14).
