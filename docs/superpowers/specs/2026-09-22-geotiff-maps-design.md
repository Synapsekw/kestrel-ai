---
type: spec
date: 2026-09-22
status: proposed
tags: [spec, maps, geotiff, inference, evaluation, export]
related: ["[[2026-09-17-kestrel-ai-app-design]]", "[[2026-09-20-rotated-boxes-design]]", "[[2026-09-19-site-office-ui-design]]"]
---

# GeoTIFF maps: import, view, detect, label, score, export

## 1. Goal

The operator imports a georeferenced orthomosaic (a GeoTIFF of any size, in any projection), pans
and zooms it smoothly, runs any project model across the whole map, and gets a count per class
with every detection drawn on the map. They label the true machines inside one or more evaluation
zones, and each run is scored against those labels (precision, recall, F1, count error), so two
models can be compared on the same map. Every box, whether detected or labeled, exports with real
coordinates.

Done means that on a 3 GB, 80 000 px UTM orthomosaic the operator can do the following without
the app stalling or the backend's memory growing with map size:

1. Import the map.
2. Zoom from the whole site down to a single excavator.
3. Run two models and read "42 excavators, 17 dump trucks" for each.
4. Label one zone and see P/R/F1 for both runs.
5. Export a GeoPackage that opens in QGIS with the boxes on the machines.

Why it matters: drone-frame metrics say how a model does on frames. Customers deliver
orthomosaics, and orthos differ from frames in ground resolution, blending seams and nodata
borders. This feature is how models are judged on the artefact the customer actually has.

## 2. Decisions that shape everything

| Decision | Choice | Why |
| --- | --- | --- |
| Raster library | **rasterio** (BSD, bundles GDAL + PROJ) + **pyproj** | Reads every GeoTIFF variant (CRS, rotated geotransforms, 16-bit, multiband, nodata/alpha, BigTIFF) and writes COGs. Anything lighter (tifffile, PIL) has no CRS handling. |
| Display | **Backend tile pyramid + OpenLayers** (`ol`, BSD-2) | Every hard step (read, stretch, tile) is plain Python that pytest can cover. The WebView only draws 256 px JPEGs. OpenLayers supplies zoom/pan, scale bar, a vector layer that handles tens of thousands of boxes, and draw/modify interactions. |
| Rejected | geotiff.js + WebGL in the browser | 16-bit stretching would move into shaders, the WebView2 GPU paths are hard to test in CI, and it needs range-request serving plus CSP work. |
| Rejected | Leaflet + georaster-layer | Decodes the raster in JS and stalls on multi-GB files. |
| Maps vs images | **A separate entity** (`GeoMap`), not a dataset `Image` | A 3 GB ortho must never reach splits, dedupe, training or `max_side` downscaling. |
| View space | The map's **native pixel grid** | No reprojection on screen, and boxes are stored in full-resolution map pixels like `Box`. Coordinates are converted only for the readout and for export. |
| Ground truth scope | **Evaluation zones** | Labeling a whole 5 km² map is not realistic. Scoring counts only inside zones the operator declares fully labeled. |

## 3. Data model

New tables, added through the normal migration path. A failed migration logs and continues, per
the invariant.

**`GeoMap`**

| Field | Type / meaning |
| --- | --- |
| `id`, `name`, `created_at` | identity and when it was imported |
| `status` | `importing` / `ready` / `failed`, plus `error` (readable text) |
| `source_path`, `source_size`, `source_sha256` | the original file; it is never copied into the project or modified |
| `width`, `height` | full-resolution pixels |
| `band_count`, `dtype` | the source's bands and data type |
| `crs_wkt`, `epsg` | nullable; null means "no coordinates" |
| `geotransform` | 6 floats (GDAL order); nullable |
| `bounds_native`, `bounds_wgs84` | nullable |
| `gsd_cm` | ground resolution in cm per pixel; nullable |
| `stretch` | JSON: per-band min/max plus the RGB band order |

**`MapRun`**

| Field | Type / meaning |
| --- | --- |
| `id`, `map_id` | identity and the map it ran on |
| `provider`, `model_ref` | reuses the provider factory, so local YOLO and the cloud providers are both available |
| `tile_size`, `overlap`, `conf`, `nms_iou`, `target_gsd_cm` | run parameters |
| `status`, `job_id`, `created_at`, `finished_at` | lifecycle |
| `counts` | JSON `{class: n}`, cached when the run finishes |

**`MapDetection`**

| Field | Type / meaning |
| --- | --- |
| `id`, `run_id`, `class_id` | identity, run and class |
| `confidence` | detector confidence |
| `x`, `y`, `w`, `h` | full-resolution map pixels |
| `angle` | nullable, reserved for OBB wave 2 |

It has an index on `(run_id, x, y)`, so the viewer can query just the boxes in a viewport.

**`MapZone`**

| Field | Type / meaning |
| --- | --- |
| `id`, `map_id`, `name` | identity |
| `geometry` | JSON polygon in map pixels (a rectangle is a 4-point polygon) |

**`MapLabel`**

| Field | Type / meaning |
| --- | --- |
| `id`, `map_id`, `class_id` | identity and class |
| `x`, `y`, `w`, `h`, `angle` | map pixels; `angle` nullable |
| `source` | `manual` or `from_run:<id>` |
| `created_at`, `updated_at` | timestamps |

**`GeoMap.labels_version`** is an integer bumped on every zone or label change. Cached scores are
keyed on `(run_id, labels_version, iou)`.

**Storage in the project**

```
<project>/maps/<map_id>/
  source.json     # original path, size, sha256, gdalinfo-style summary
  map.cog.tif     # internal COG: 512 px tiles, overviews, JPEG (8-bit RGB) / DEFLATE (alpha)
  preview.jpg     # ~1024 px longest side, for the map list
  runs/<run_id>/windows/<index>.json   # per-window checkpoints, so runs resume
```

**Startup:** a `GeoMap` left in `importing` or a `MapRun` left in `running` by a crash is marked
`failed` ("interrupted"). The UI offers re-import or resume. This work never blocks startup.

## 4. Import (`map_import` job)

1. **Pick the file.** The operator picks a `.tif`/`.tiff` through the Tauri file dialog, and the
   frontend sends the path, as the folder import does today. `POST /maps {path, name}` creates
   the `GeoMap` (`importing`) and submits the job.
2. **Validate.** The job opens the file with rasterio.
   - If the file is unreadable, or is not a raster, the map is marked `failed` with a
     human-readable reason.
   - If it has no CRS or geotransform, it is imported anyway with "no coordinates" status: view,
     detect, label and score all work, and geo-export is disabled with an explanation.
3. **Stretch.** 8-bit RGB(A) passes through. For anything else (16-bit, float, 4+ bands), the job
   takes the 2nd–98th percentile per band from the smallest overview, or from a decimated read
   if the file has no overviews. Band order defaults to 1/2/3 as RGB. Alpha, or the nodata value,
   becomes a mask.
4. **Write the COG.** It is written window by window through GDAL's `COG` driver, with progress
   and cancel. Cancelling deletes the partial folder.
5. **Finish.** The job writes the preview, stores the metadata (CRS, geotransform, bounds in both
   CRSs, and `gsd_cm` from the geotransform, converted to metres for geographic CRSs), and sets
   the status to `ready`.

## 5. Tiles

`GET /maps/{id}/tiles/{z}/{x}/{y}.jpg` returns 256 px tiles in the map's pixel grid.

- `z` selects the overview level whose resolution matches.
- Each request is one windowed read from the COG, so its cost does not depend on map size.
- Masked pixels render as the canvas background colour.
- Tiles fully outside the raster, or fully masked, return 204.
- An LRU cache of about 512 tiles sits in memory. Responses carry
  `Cache-Control: max-age=31536000, immutable`, because a map's COG never changes; re-import
  creates a new map id.

`GET /maps/{id}/preview.jpg` returns the preview, and `GET /maps/{id}` returns the metadata,
including `tile_grid` (the resolutions per zoom level) for the OpenLayers `TileGrid`.

## 6. Detection on a map (`map_detect` job)

`POST /map-runs/estimate` returns the window count, the number skipped as nodata, and the cost for
cloud providers, following the `/query-runs/estimate` pattern. `POST /map-runs` creates the run and
submits the job. The job holds the GPU like `infer`, is cancellable, and resumes from its window
checkpoints.

1. **Scale.** `target_gsd_cm` defaults to the model's training GSD when its metadata records one.
   Otherwise the run dialog asks, prefilled with the map's GSD, which means "no scaling". If the
   target and the map's GSD differ by more than 15%, each window is read with
   `out_shape = window × gsd_map / target_gsd` (resampling: average when downscaling, bilinear
   when upscaling), and the boxes are scaled back to map pixels.
2. **Windows.** The job walks windows of `tile_size` (in target-GSD pixels) with `overlap`,
   row-major. It skips any window that is at least 99% masked, based on a cheap read from an
   overview.
3. **Detect.** Each window goes through the provider's existing `detect_tile`, and the result is
   checkpointed to `windows/<index>.json`.
4. **Merge across seams.**
   - `nms_per_class` runs within each row strip.
   - A second pass runs over the boxes in each strip-boundary band against the previous strip.
   - Memory is bounded by the boxes in two strips, never by pixels.
5. **Finish.** The job bulk-inserts `MapDetection`, stores `counts`, runs scoring if the map has
   zones (§8), and publishes `map_runs.changed`.

The progress text reads "window 1 240 / 8 900 · 312 detections".

## 7. Viewer (Maps screen)

There is a new top-level **Maps** screen. The UI is built with the `frontend/src/ui/` primitives
and DESIGN.md, and `check-tokens.mjs` must pass. OpenLayers' own CSS is scoped, and its controls
are restyled with tokens.

- **Left rail**
  - map list with preview, name, size, CRS or "no coordinates", and status;
  - Import button;
  - under the selected map, its runs (model, date, status, total count) and a "New run" button.
- **Centre:** an OpenLayers `Map`.
  - View: a pixel projection (`units: 'pixels'`, extent `[0, -h, w, 0]`), with a tile layer from
    the endpoint.
  - Controls: zoom buttons, wheel/drag/pinch, "fit map", and a scale bar using `gsd_cm`.
  - Bottom bar: cursor position in pixel, native CRS (with EPSG) and WGS84 coordinates, plus
    zoom and cm per pixel. The coordinates are converted client-side with `proj4` from the map's
    WKT.
- **Right panel, "Results" mode**
  - Pick one run, or two to compare. Each run is its own vector layer with a distinct outline
    style, in class colours.
  - Counts table per class, with a "whole map / in view" toggle. "In view" is counted client-side
    from the loaded features in the extent.
  - Confidence slider (it filters the display and the counts; it never changes the stored run) and
    per-class toggles.
- **Box loading.**
  - Boxes come from `GET /map-runs/{id}/detections?bbox=x0,y0,x1,y1&min_conf=` (bbox strategy),
    with at most 5 000 boxes per response.
  - When the zoom is below the level where a box is smaller than 4 px, the server returns
    `GET /map-runs/{id}/density?z=`, a grid of counts per class, and the layer renders density
    dots instead of boxes.
- **Clicking a box** opens a popover with class, confidence, pixel box, native and WGS84 centre,
  and size in metres.

## 8. Labeling and scoring

**Label mode** (a right-panel tab):

- **Zones:** draw a rectangle or polygon, rename, delete. Zones render as a hatched outline.
- **Boxes:** draw, move and resize, delete, reclass. Class hotkeys 1–9 use the project's existing
  hotkey assignments. Undo/redo keeps its own history for the map session. Every edit is an
  immediate API call (`POST/PATCH/DELETE /maps/{id}/labels`, `…/zones`), so nothing is held
  unsaved.
- **Seed from a run:** inside a chosen zone, copy that run's detections (at or above the current
  confidence) into labels with `source=from_run:<id>`. Editing a seeded label sets
  `source=manual`, and the panel shows "N seeded, not yet checked".
- **Warning:** a label whose centre is outside every zone gets a warning badge, because it won't
  count.

**Scoring** (`GET /map-runs/{id}/score?iou=0.5`) is synchronous: pure Python over at most a few
thousand boxes, well under a second. It is cached on `(run_id, labels_version, iou)`.

- **Eligible boxes:** only detections at or above the run's `conf`, and labels, whose centre lies
  inside a zone.
- **Matching:** greedy per class. Detections are sorted by confidence, highest first, and each one
  matches the unmatched label with the highest IoU, as long as that IoU is at least `iou`.
  Unmatched detections are FP; unmatched labels are FN.
- **Output** per class, per zone and overall:
  - TP, FP, FN, precision, recall, F1;
  - predicted count, true count, count error (absolute and %);
  - `match` status for every eligible box, used by the overlay.
- **On the map**, "Score" overlay: TP boxes solid green, FP boxes red, FN (missed labels) dashed
  amber.
- **Error list:** stepping through the FP/FN list centres the view on each error.
- **Two runs selected:** their score tables sit side by side.

## 9. Export (`map_export` job)

`POST /map-exports {map_id, content: run|labels|run+score, run_id?, formats[]}` writes to
`<project>/exports/<stamp>-map-<name>/` through the existing `.partial-` pattern.

| Format | CRS | Contents |
| --- | --- | --- |
| GeoJSON | WGS84 (RFC 7946) | One polygon feature per box; properties: id, class, confidence, match, source |
| GeoPackage | map's native CRS | Layers `detections`, `labels`, `zones`; same attributes. Opens in QGIS, ArcGIS, Civil 3D |
| CSV | both | One row per box (columns below) |
| `summary.json` | none | Map metadata, run parameters, counts, scores |

The CSV columns, one row per box:

- id, class, confidence, match;
- `px_x, px_y, px_w, px_h`;
- the corners `x1,y1 … x4,y4` and `cx, cy` in the native CRS, plus an `epsg` column;
- the same corners and centre as `lon1,lat1 … lon4,lat4, clon, clat` in WGS84;
- `width_m, height_m, area_m2`.

**Conversion:** pixel → native through the full affine, rotation terms included. Native → WGS84
through `pyproj.Transformer(always_xy=True)`. A rotated box (future OBB) transforms its four real
corners, so the same code handles both cases.

**No CRS:** only the CSV with pixel columns is offered, and the dialog says why.

GeoPackage is written with `sqlite3` plus the GPKG geometry blob encoding, so there is no `fiona`
dependency. If that proves brittle in tests, `pyogrio` is the fallback, and it needs its own
freeze check.

## 10. Packaging (spike P0, done first)

This is the one real risk. If rasterio can't be frozen, the design changes.

1. Add `rasterio` and `pyproj` to `backend/requirements.txt` and the lock file (Windows wheels
   bundle GDAL, PROJ and their data). Then check that the pinned ML stack is unaffected.
2. Update `backend/kestrel_backend.spec`: `collect_dynamic_libs("rasterio")`,
   `collect_data_files("rasterio")`, `collect_data_files("pyproj")`, and the hidden imports for
   `rasterio._shim`, `rasterio.sample`, `rasterio.vrt` and `rasterio._features`.
3. At startup, when frozen, set `GDAL_DATA` and `PROJ_DATA`/`PROJ_LIB` to the bundled folders
   before the first rasterio import.
4. Extend `backend/scripts/smoke_frozen.ps1` to use the frozen exe on a fixture GeoTIFF: open it,
   write a COG, and transform one point from UTM to WGS84.
5. Record the result as an ADR in `vault/decisions/`, and dispatch CI `sidecar-smoke`.

Frontend dependencies: `ol` and `proj4`. The CSP stays unchanged, because tiles come from
`127.0.0.1`.

## 11. Budget and execution DAG

### 11.1 Budget

- **Background jobs:** `map_import`, `map_detect`, `map_export`. All report progress and can be
  cancelled. Import and detect resume or restart cleanly.
- **Synchronous and bounded:**
  - the tile endpoint (one window);
  - the detections query (bbox, capped at 5 000);
  - density (a grid capped at 256 × 256 cells);
  - scoring (only boxes inside zones, O(n log n));
  - label and zone CRUD.
- **Never loaded whole:** the raster. The only full-extent reads come from overviews, which are
  bounded at about 1 024 px.

### 11.2 DAG

| Unit | Contents | Depends on |
| --- | --- | --- |
| **P0** | rasterio/pyproj freeze spike, ADR | none |
| **A** | Contract for all map endpoints, tables and migration, `map_import`, tiles, preview, metadata | P0 |
| **B** | Maps screen: map list, import dialog, OpenLayers viewer, coordinate readout | A |
| **C** | `map_detect` job, estimate, runs API, detections/density queries, counts | A |
| **D** | Zones and labels CRUD, `labels_version`, scoring | A |
| **E** | Viewer: run layers, compare, counts/filters, label mode, seed-from-run, score overlay, error stepping | B, C, D |
| **F** | `map_export` job plus the export UI | C, D |
| **G** | e2e, `docs/progress.md`, usability walkthrough, wrapup | E, F |

- **Parallel batches:** {P0} → {A} → {B, C, D} → {E, F} → {G}.
- **Critical path:** P0 → A → C → E → G. B and D have slack against C.

Contract changes in A are written up front for every unit, so B–F never edit `openapi.yaml` at
the same time.

## 12. Testing

**Backend (pytest).** Fixtures are small GeoTIFFs generated with rasterio at test time; nothing
binary is committed:

- 8-bit RGB in UTM 33N;
- 16-bit 4-band with nodata;
- a rotated geotransform;
- no CRS;
- EPSG:4326 (geographic, for the GSD conversion);
- RGB with a 60% alpha-masked border.

What they cover:

- **Import:** metadata, stretch values, a COG that validates (tiled, has overviews), preview, the
  failed states, cancel cleanup.
- **Tiles:** pixel parity with a direct windowed read, 204 for tiles outside the raster, and a
  spy on rasterio `read` that asserts the requested window is never larger than a tile.
- **Detection** with a fake provider that places known boxes:
  - seam merging (a box straddling two windows yields one detection);
  - nodata windows skipped;
  - GSD scaling round-trips box geometry;
  - resume after a simulated crash reprocesses no finished window.
- **Scoring**, hand-computed: perfect, all-FP, all-FN, class confusion, boxes on a zone boundary,
  and the IoU threshold edge.
- **Coordinates:** known pixel → UTM → WGS84 points checked against independent pyproj values,
  the rotated geotransform, and a GeoJSON/GPKG round-trip (reading back with sqlite3 and checking
  the geometry blob headers and SRS rows).

**Frontend (vitest):**

- tile-grid construction from the metadata;
- coordinate formatting;
- counts "in view";
- the score table;
- label edit commands and undo.

**e2e (Playwright):** import the UTM fixture, then the map renders tiles, then a run with the fake
provider, then counts appear, then draw a zone, seed and edit labels, then the score shows, then
export and the files exist.

**Contract:** Spectral lint, and `schema.d.ts` regenerated in the same change.

The gates in AGENTS.md §4 apply to every unit.

## 13. Consequences the operator should know

- Import takes a while on big maps (writing the COG is I/O-bound, roughly 1–3 minutes per GB). It
  runs in the background, and viewing starts when it finishes.
- The COG copy uses disk: about 20–40% of an 8-bit source, more for 16-bit sources.
- If the model's training GSD is unknown and not entered, a model trained at 1 cm per pixel run on
  a 3 cm per pixel ortho will under-detect. The run dialog makes this visible.
- Scores are only as good as the zones. A zone that isn't fully labeled turns true detections into
  "false positives".

## 14. Out of scope

- Turning map labels into training chips for the dataset builder. This is the natural follow-up,
  since the labels are stored in map pixels.
- mAP and PR curves.
- Mosaicking several files into one map, and editing map pixels.
- Online basemaps under the map, which would need the CSP opened.
- Rotated boxes on maps: the `angle` column is reserved for OBB wave 2.
- Shapefile or KML export (GeoPackage and GeoJSON cover every target tool).
