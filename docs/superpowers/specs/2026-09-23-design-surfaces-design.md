---
type: spec
date: 2026-09-23
status: proposed
tags: [spec, surfaces, design, landxml, dxf, dem, volumes, earthworks]
related: ["[[2026-09-22-geotiff-maps-design]]", "[[2026-09-23-point-clouds-design]]", "[[2026-09-23-volumes-design]]", "[[2026-09-23-survey-timeline-design]]"]
---

# Design surfaces: DEM GeoTIFF, LandXML and DXF into a Surface

## 1. Goal

The operator imports the design they quote earthworks against. This can be a DEM GeoTIFF, a
LandXML TIN, or a DXF with a triangulated surface or contours and spot heights. The app turns it
into a `Surface` (`kind = design`) on the same grid as the site's cloud DSM, so the volumes engine
(S2) uses it as a volume base without changes. Before anything is written, the app shows where the
design sits relative to the cloud surface and how far apart the heights are. A wrong CRS, a wrong
unit or swapped easting and northing gets caught at this point, instead of turning up as a
nonsense volume in a client's report.

Done means that, on the real chimney-stack cloud (EPSG:32639) and its S2 DSM, the operator can do
the following:

1. Import a LandXML TIN of the site, stored as "northing easting elevation", with a
   `<CoordinateSystem epsgCode="32639">`. The preview shows ≥ 95 % overlap and the median height
   difference against the DSM. The design surface then lands cell-aligned on the DSM grid.
2. Import a DXF of 3D contour polylines and spot heights. They are triangulated, and the
   triangles that would fill the concave notches of the hull are trimmed away. The operator
   selects the layers after seeing each layer's entity counts and a thumbnail.
3. Import a DXF whose surface is made of `3DFACE`s, and another made of `POLYFACE`/`MESH`. The
   faces are used as a TIN directly.
4. Import a DEM GeoTIFF in a different CRS (UTM 38N) in feet heights. It is re-gridded onto the
   DSM grid in metres. A DEM that already conforms is copied instead of re-gridded.
5. Open a file with easting and northing swapped, or in feet read as metres. The preview says "no
   overlap" and offers a one-click fix ("with easting/northing swapped the design covers 97 % of
   the cloud surface"). Nothing is imported until the operator imports a clean preview or
   explicitly accepts the warnings.
6. Run S2's "volume against a design surface" on the result with no conversion step.
7. On a worst case, all of the following hold:
   - a 2 M-point / 4 M-face LandXML (~350 MB of XML) imports;
   - an 8 M-vertex contour DXF imports;
   - a 2 × 2 km design is written at 10 cm (400 M cells, under S2's `MAX_CELLS` ceiling of 500 M
     that every surface shares);
   - memory is bounded by the TIN arrays plus a fixed working set, and never by the XML size or
     the site area.

Why it matters: "against a design surface" is one of the three volume bases the operator quotes,
and it is paid work. Design files come from other people's CAD systems, with no CRS, ambiguous
feet and axis orders that vary by exporter. The most common real failure is a design placed in
the wrong spot or at the wrong scale, so the import's main job is to catch that before a number
is quoted.

## 2. Decisions that shape everything

| Decision | Choice | Why |
| --- | --- | --- |
| Job shape | **One job type, `design_import`, with three phases**: `inspect` (streamed parse into a geometry cache, candidates, thumbnails), `preview` (the full pipeline on a coarse grid, plus validation), and `build` (the full pipeline on the real grid). | The brief fixes one job type. All three phases take time that grows with the file (a 350 MB LandXML takes tens of seconds to parse), so none of them may be a synchronous request. `preview` and `build` share one code path and differ only in the grid, so the preview shows what the build will produce. |
| Rejected | Synchronous inspect or check endpoints | They block on big files, which breaks the background-job invariant. |
| Rejected | Separate `design_inspect`/`design_preview` job types | The brief's JobType list is fixed. The Jobs panel tells the phases apart through the job message instead ("Reading design file", "Previewing design", "Importing design surface"). |
| Parse once | `inspect` writes each candidate's geometry to a **flat binary cache** (`float64` vertices, `int32` faces, `int64` polyline offsets). `preview` and `build` memory-map it. | Changing units, CRS or layers never re-parses the file. The cache also freezes the file content at inspection time, and its `sha256` is recorded. |
| Inspection state | **Files** under `<project>/cache/design-inspections/<id>/`, with no DB table | The state lasts only as long as the dialog. It is swept on project open (§4.4). The F0 migration stays within the brief's tables. |
| Output grid | Always `grid.aligned_grid(footprint_bounds, cell, crs_wkt, epsg)` (S2 §4): the origin sits on integer multiples of the cell size, and the extent is the design's footprint grown outward to whole cells. When a target cloud surface is chosen, the output adopts the **target's CRS and cell size**; since the target was built by `aligned_grid` too, `same_lattice(design, target)` is true. With no target, the output CRS is the source CRS (which must be projected, in metres) and the operator gives a cell size (default 0.25 m). | S2 reads both surfaces with an integer-offset read (`resample_onto` case R1) and never interpolates. Cells align exactly, which the volume maths wants. |
| Rejected | Keeping the design's own grid and CRS, and letting S2 resample | Puts reprojection in S2's hot path and makes cut/fill depend on the resampling. |
| Reprojection | TINs: **vertices** are transformed with pyproj (`always_xy`) before rasterising. DEMs: `WarpedVRT` into the output grid, one window at a time. | Moving vertices is exact at the vertices. At design scale, the bend of a straight edge under a UTM→UTM transform is sub-millimetre. |
| TIN rasteriser | **A numpy barycentric scan of our own**, one for every TIN (LandXML faces, DXF faces, Delaunay output). Triangles are binned to the output's write windows (`grid.read_windows`: BLOCK-aligned, ≤ 2048²); each triangle reaches every window it overlaps. | One tested implementation. It works on arbitrary, possibly imperfect TINs, and memory is bounded by the block size. |
| Rejected | matplotlib `LinearTriInterpolator` | Needs a valid triangulation (it raises on folded or duplicate input) and a whole-grid query. |
| Rejected | scipy `LinearNDInterpolator` | Handles its own Delaunay only. |
| Rejected | `gdal_grid` | rasterio does not ship the GDAL Python bindings. |
| Points and contours | `scipy.spatial.Delaunay` on deduplicated XY, with polylines **densified** to 2 × the output cell, plus a **boundary-peeling maximum-edge rule** | Densifying makes Delaunay nearly respect the contour lines (a conforming approximation). Peeling removes the long triangles that fill the hull and its concavities, and leaves large interior triangles on flat ground alone. |
| Rejected | Constrained Delaunay via `triangle` | Shewchuk's licence forbids commercial use. |
| Rejected | CGAL | GPL/LGPL, and a heavy freeze. |
| Rejected | A global edge-length cut | It punches holes in flat interior areas. |
| DXF reader | **ezdxf** `ezdxf.recover.readfile` (whole document; binary DXF too). `INSERT`s are expanded with `virtual_entities()`, nested blocks included. A RAM admission check runs first. | Design DXFs are typically 1–200 MB. `recover` tolerates the malformed files CAD exporters produce. |
| Rejected | `ezdxf.addons.iterdxf` | Reads ASCII DXF only and cannot expand `INSERT`. |
| LandXML reader | stdlib `xml.etree.ElementTree.iterparse`, matching elements by **local name** (any namespace: LandXML 1.0/1.1/1.2/2.0), clearing each element as it is read | Memory stays flat regardless of file size. No new dependency (lxml rejected). Python 3.11's bundled expat carries the billion-laughs protection, and ElementTree never resolves external entities. |
| Units | An explicit enum: `millimetre`, `centimetre`, `metre`, `international_foot` (0.3048), `us_survey_foot` (1200/3937). Horizontal and vertical units are chosen separately. | The two feet differ by 2 ppm, which at State Plane coordinates is a shift of about a metre. A plain "feet" choice would hide that. |
| XY scaling | `XY_out_crs_units = XY_file × (unit_to_m(horizontal_unit) / unit_to_m(crs_axis_unit))`, applied only when the source CRS is projected; a factor of exactly 1 when the units match. | Covers a DXF drawn in mm with a metric CRS, and international feet with a ftUS CRS, with no special cases. |
| Heights | `Z_m = Z_file × unit_to_m(vertical_unit)`. **No datum conversion.** | Per the brief. A vertical offset from ellipsoid versus geoid heights is measured and corrected in S2's alignment check. S3 only warns (§8). |
| CRS | **Always confirmed by the operator.** The field is prefilled from the file (a GeoTIFF CRS, or LandXML `epsgCode`/`ogcWktCode`) or else from the target surface's CRS, and the preview states which. | LandXML `<CoordinateSystem>` is often absent or wrong, and DXF has none. |
| Axis order | LandXML `P` is read as **northing, easting, elevation** (x = 2nd value, y = 1st). A "Swap easting and northing" switch covers exporters that break the rule, and the preview suggests it automatically. | This is the LandXML rule, and the most common real-world mistake. |
| Commit gate | `createDesignSurface` requires a **ready preview** of the same inspection. If the preview has `warn` warnings it also needs `accept_warnings: true`. `block` warnings forbid the import outright. | The server enforces "look before you commit", so a skipped preview cannot slip past. |
| Mixed geometry | One import uses **either faces or points and lines**. A selection mixing the two is a `block` warning. | Merging a TIN with a triangulation has no single right answer. The operator imports two surfaces if they need both. |
| DWG | Rejected at `createDesignInspection` (extension `.dwg`, or an `AC10xx` magic number), with a message on how to save it as DXF | Per the brief: the ODA SDK is paid, and LibreDWG is GPL and weak. |
| Output CRS | Must be **projected, in metres**: `aligned_grid` refuses anything else (S2 §2 CRS row). A geographic or feet source (for example a 4326 DEM, or an EPSG:2229 design) is fine when a target gives a metric output CRS; without a target it is a `block` warning. | Volumes need planar cells in metres, and every Surface carries `cell_size_m`. |

## 3. Data model

There are no new tables. S3 writes `Surface` rows (brief, §Data model) with `kind = "design"`,
`point_cloud_id = null`, and these values:

| Field | Value for a design surface |
| --- | --- |
| `status` | `building` → `ready` / `failed` |
| `error` | readable text when failed. The column is S2's (`surface.error`, S2 §3), created by F0's migration. |
| `method` | `tin` (LandXML or DXF faces), `delaunay` (points or contours), `dem_resample`, or `dem_copy` |
| `crs_wkt`, `epsg` | the output CRS: the target's, or the operator's |
| `cell_size_m`, `width`, `height`, `geotransform`, `bounds_native` | the output grid |
| `z_min`, `z_max`, `coverage_fraction` | from the `SurfaceStats` that `SurfaceWriter.finish()` returns, or that `compute_stats` returns on the DEM copy path (valid cells ÷ grid cells) |
| `build_params`, `stats` | null (they describe cloud builds only) |
| `design_source` | the JSON `DesignSource` below |

**`design_source`** holds the brief's keys `path, format, units, sha256` plus these additions:

| Key | Meaning |
| --- | --- |
| `path`, `format` | the original file (never copied) and `geotiff` / `landxml` / `dxf` |
| `units` | the horizontal `LinearUnit`; null for `geotiff`, whose CRS defines it |
| `vertical_units` | the `LinearUnit` the heights were converted from |
| `sha256` | computed during `inspect` (streamed) |
| `candidates` | the chosen LandXML surface name, or the DXF layer names; `["band 1"]` for a DEM |
| `source_crs_wkt`, `source_epsg` | the CRS the operator confirmed for the file |
| `swap_xy` | whether easting and northing were swapped |
| `max_edge_m` | the maximum-edge rule actually used (Delaunay only), otherwise null |
| `aligned_to_surface_id` | the target cloud surface whose grid the output shares, or null |
| `accepted_warnings` | the warning codes the operator accepted |

**Storage**

```
<project>/surfaces/<surface_id>/surface.tif      # grid convention (NaN only, no internal mask); written by app.surfaces.grid.SurfaceWriter
<project>/surfaces/<surface_id>/source.json      # design_source + the preview numbers at commit time
<project>/cache/design-inspections/<inspection_id>/
  request.json          # path, job ids, created_at
  inspection.json       # the DesignInspection body once `inspect` finishes
  cand/<cid>/points.f64 # N×3 vertices, file units, x = easting (after the LandXML N/E rule)
  cand/<cid>/faces.i32  # M×3 vertex indices (faces geometry)
  cand/<cid>/runs.i64   # K+1 offsets of polyline vertex runs into points (points geometry; a POINT is a run of 1)
  cand/<cid>/meta.json  # counts, dtypes, bbox, z range
  thumbs/<cid>.png      # 160 px plan view
  previews/<pid>/preview.json, preview.png
```

The inspection folder is deleted when the build succeeds. When the build fails it is kept, so a
retry needs no re-parse, until the sweep removes it (§4.4).

## 4. Import flow and the `design_import` job

### 4.1 The three phases

| Phase | Params (verbatim) | Does | Result |
| --- | --- | --- | --- |
| `inspect` | `{"phase": "inspect", "inspection_id": "<uuid>", "path": "<abs path>"}` | Hashes the file (streamed, 64 MB chunks), detects format, units and CRS, parses every candidate into `cand/`, writes thumbnails, then `inspection.json`. | `{"inspection_id", "candidate_count"}` |
| `preview` | `{"phase": "preview", "inspection_id": "<uuid>", "preview_id": "<uuid>", "options": <DesignImportOptions>}` | Placement → triangulation (if points) → rasterisation onto the **preview grid**, then validation against the target (§8), then `preview.png` and `preview.json`. | `{"preview_id", "overlap_fraction"}` |
| `build` | `{"phase": "build", "surface_id": "<uuid>", "inspection_id": "<uuid>", "preview_id": "<uuid>"}` | The same pipeline with the preview's options on the **output grid**, written block by block through `grid.SurfaceWriter.write_block`, then `finish() -> SurfaceStats`, the `Surface` row, `source.json` and `surfaces.changed`. | `{"surface_id", "width", "height", "coverage_fraction"}` |

The **preview grid** is `aligned_grid(footprint_bounds, k × cell, …)` with the integer factor
k = ⌈max(w, h) / 512⌉ over the output grid's size. Both lattices are anchored at multiples of their
cell, so each preview cell is exactly k × k output cells (and k × k target cells), and polylines are
densified at 2 × the preview cell. The preview therefore costs about the same for
any design size, apart from the TIN itself.

### 4.2 Cancel, failure and restart

- Every phase calls `check_cancelled()` once per chunk, per block and per 64 k triangles.
- A cancelled or failed `inspect` leaves `inspection.json` with `state: failed` and a readable
  `error` (`JobFailure` text).
- A cancelled or failed `preview` writes `preview.json` with `state: failed`.
- A cancelled or failed `build` sets `Surface.status = failed` with an `error`. `SurfaceWriter`
  deletes its `.partial` on the exception, and `surfaces/<id>/` is deleted (the maps `_fail`
  pattern).
- A new `preview` for an inspection cancels that inspection's running preview job first. Only
  the newest preview is shown.
- `deleteDesignInspection` cancels a running `inspect` or `preview`. It returns `409 job_running`
  while a `build` holds the inspection.

### 4.3 Admission (RAM)

Before the heavy step of each phase, the job estimates its peak need and refuses with a
`JobFailure` when the estimate exceeds 60 % of `psutil.virtual_memory().available`. The message
states the need and the fix, for example "save only the surface layers to a new DXF", or "choose a
coarser cell".

| Step | Estimate |
| --- | --- |
| DXF load (`inspect`) | `DXF_RAM_FACTOR × file size`. The constant is 12, and U3 asserts it against a measured peak on a generated 20 MB DXF. |
| TIN arrays (`preview`/`build`) | `32 B × points + 12 B × faces` |
| Delaunay (`preview`/`build`, points geometry) | `QHULL_BYTES_PER_POINT × points`. The constant is 600; U5 asserts it on 1 M points. |
| Rasterise | fixed: one 2048² float32 block + a written-mask + batch buffers ≤ 64 MB, about 100 MB |
| Grid size | cells > `grid.MAX_CELLS` (5 × 10⁸, S2 §4, the one ceiling for every surface) is the `grid_too_large` `block` warning ("choose a coarser cell"). Cells > 2.5 × 10⁸ is the `large_grid` `info` warning ("takes a few minutes"). |

### 4.4 Startup and sweep

F0 wires the step into `project_opened()` as the no-op
`app/surfaces/design/startup.py::sweep_interrupted(handle, runner)` (S1 §5 item 5); U1 fills in
only its body. It deletes every
`cache/design-inspections/<id>/` whose jobs are not live (`runner.is_live`) **and** whose
`request.json` is more than 24 h old. As with every step there, a failure logs and continues.
Interrupted `building` design surfaces are swept by **S2's** surface sweep, which covers every
`kind` (S2 §3).

## 5. Placement: units, CRS, axis order, output grid

The inputs are the candidate's cached vertices (file units, file axes) and the `DesignImportOptions`.

1. **Swap.** If `swap_xy` is set, `x, y = y, x`. The LandXML N/E rule has already been applied
   in the cache, so this only corrects exporters that break it.
2. **Horizontal scale.** When the source CRS is projected, multiply XY by
   `unit_to_m(horizontal_unit) / unit_to_m(source_crs.axis_info[0].unit)`. The factor is
   exactly 1.0 when the two units are the same enum member, which avoids float drift. Units map
   as follows: `metre` = `m`, `international_foot` = `ft`, `us_survey_foot` = `US survey foot` /
   `ftUS`. A source CRS in a unit outside the enum is a `block` warning.
3. **Z** = `Z × unit_to_m(vertical_unit)`.
4. **Reproject.** If the source CRS ≠ the output CRS (compared with `pyproj.CRS.equals`), transform
   the vertices with `Transformer.from_crs(src, out, always_xy=True)` in chunks of 1 M. The
   transform is 2D; Z is untouched.
5. **Output grid.** `grid.aligned_grid(bounds_of_transformed_vertices, cell, out_crs_wkt, out_epsg)`.
   With a target, `out_crs` and `cell` are the target's (`target.spec.cell_size`; not editable), so
   `same_lattice(output, target.spec)` holds, and a test asserts it. Without one, `out_crs` is the
   source CRS and `cell` is `options.cell_size_m`. A `GridError` from `aligned_grid` (CRS not metric,
   too many cells) becomes the matching `block` warning.

The defaults the dialog prefills, and where each comes from:

| Option | GeoTIFF | LandXML | DXF |
| --- | --- | --- | --- |
| `source_crs` | the file's CRS; required from the operator if absent | `epsgCode` → `ogcWktCode` → else the target's CRS | the target's CRS. A `GEODATA` object's coordinate-system name, if present, is shown as an unverified hint |
| `horizontal_unit` | n/a (the CRS) | `<Metric linearUnit>` / `<Imperial linearUnit>`: `meter`, `millimeter`, `centimeter`, `foot` → international, `USSurveyFoot` → US survey | `$INSUNITS`: 6 → m, 4 → mm, 5 → cm, 2 → international_foot, 21 → us_survey_foot, 0 → metre with a `units_assumed` warning, others → `block` until changed |
| `vertical_unit` | the vertical CRS unit if the CRS is compound, else the horizontal CRS unit if it is a foot, else metre | `elevationUnit` if present, else the linear unit | the same as horizontal |
| `swap_xy` | false | false | false |
| `target_surface_id` | the newest `ready` `cloud_dsm` surface, or none | same | same |

## 6. DEM GeoTIFF

**Inspect**

- Open with rasterio. The candidate is `c0`, kind `dem`, carrying `raster` info (width, height,
  cell, dtype, nodata, band count).
- `band_count ≠ 1` is **rejected** at inspect. `uint8` with 3–4 bands gets the message "this is
  an image (an orthomosaic?), not a height model — import it under Maps".
- A missing or identity geotransform is rejected ("no georeferencing").
- A rotated geotransform is accepted; `WarpedVRT` makes the output north-up.
- **Nodata.** Use the declared nodata or the internal mask when present. When there is none, one
  decimated read (≤ 1024 px, from overviews when present) checks the minimum against the sentinels
  −9999, −32767, −32768, −3.4028235e38. If it matches, that sentinel is proposed as nodata with a
  `sentinel_nodata` warning. If none is found, a `nodata_unknown` info notes that every cell
  counts as data.
- Scale and offset tags are applied (`src.scales`, `src.offsets`).
- The thumbnail is `grid.hillshade` (S2 §4) of that same decimated read.

**Build**

- **Copy as-is** only when the copied file is guaranteed to be a valid surface on the aligned
  lattice, that is when all of these hold:
  - `grid.convention_problems(path) == []` (S2 §4). This covers float32, nodata NaN with **no
    internal mask**, tiling, compression, overviews, a metric projected CRS and an origin on the
    aligned lattice;
  - the source CRS equals the output CRS (with a target: the target's CRS);
  - with a target, `same_lattice(GridSpec.from_dataset(src), target.spec)` (so the cell size is
    the target's too); with no target, the source cell equals `options.cell_size_m`;
  - `vertical_unit = metre`, no scale or offset tag, and no sentinel remapping.

  The file is then copied in a stream (64 MB chunks, cancellable, into `surface.tif.partial`,
  then renamed). The Surface's grid columns come from `GridSpec.from_dataset(src)` (already on the
  lattice), and `grid.compute_stats(path)` returns the `SurfaceStats`. `method = dem_copy`.
- **Otherwise re-grid** onto the output grid from §5 (`aligned_grid`). Build a
  `WarpedVRT(src, crs=out_crs, transform=out_spec.transform, width, height, src_nodata,
  nodata=NaN, dtype=float32, resampling)`. An input mask or declared nodata is honoured on read
  and becomes NaN; the output never carries a mask.
  - Resampling is `bilinear` when the output cell ≤ 2 × the source cell, and `average` otherwise.
  - The build walks `grid.read_windows(out_spec)` (BLOCK-aligned, ≤ 2048²), reads each window
    from the VRT, scales it by the vertical factor, turns sentinel cells into NaN, and calls
    `SurfaceWriter.write_block(window, data)`.
  - Only windows that intersect the source footprint are visited; unwritten blocks read back as
    NaN.
  - `finish()` returns the `SurfaceStats`. `method = dem_resample`.
- No read is larger than 2048 × 2048. A test spy asserts this.

## 7. LandXML

### 7.1 Streamed parse (`inspect`)

- `iterparse(path, events=("start", "end"))`, matching elements by local name
  (`tag.rsplit("}", 1)[-1]`).
- The parser tracks the path `LandXML/Units`, `LandXML/CoordinateSystem` and
  `LandXML/Surfaces/Surface[@name]/Definition[@surfType]/{Pnts/P, Faces/F}`.
- **`P`**: the text is split into floats. **The order is N E Z**, so each point is stored as
  `(x=E, y=N, z=Z)`.
  - Its `id` attribute goes into an `int64` id array. A `P` without an id takes the 1-based
    sequence number, per LandXML.
  - A `P` with two values (no Z) is a failure: "surface '<name>' has points without elevations".
- **`F`**: three point ids. `i="1"` marks an invisible face (outside the surface boundary); it is
  skipped and counted. `n` (neighbours) is ignored.
- **Memory stays flat.** Values accumulate in Python lists and flush every 1 M rows to
  `points.f64` / `faces.i32` (faces are first stored as raw ids in a `faces_ids.i64` scratch
  file). Each `P` and `F` is `clear()`ed at its end event, and every 10 000 rows the parent
  `Pnts`/`Faces` element is `clear()`ed too, so iterparse's tree never holds the parsed children.
- **Resolving ids.** After a surface ends, its ids are argsorted (on-disk arrays, memory-mapped)
  and every face id is resolved with `np.searchsorted` into `faces.i32`.
  - A face id with no matching point fails the job: "surface '<name>': face refers to missing
    point <id>".
  - Duplicate point ids fail it the same way.
- A `Definition` whose `surfType` is not `TIN` becomes a candidate with a `block` note
  ("grid-type LandXML surfaces aren't supported").
- A `Surface` with no faces becomes a candidate with a `block` note ("points only — no
  triangles").
- **Several surfaces**: every surface becomes a candidate (`c0`, `c1`, … in file order), with
  its name, point and face counts, invisible-face count, bbox and z range. The operator picks
  exactly one per import. The default is the one with the most faces, and the dialog uses a
  `Select`.
- **Units and CRS** are read from `<Units>` and `<CoordinateSystem>` whichever order they appear
  in.
  - Recognised `CoordinateSystem` attributes: `epsgCode`, `ogcWktCode`, `name`,
    `horizontalCoordinateSystemName`, `verticalDatum`.
  - The detected values carry `crs_source`, for example `LandXML <CoordinateSystem epsgCode>`,
    and the CRS still has to be confirmed (§2).
- Other LandXML content (`CgPoints`, `Alignments`, `Parcels`, `PlanFeatures`) is skipped
  unread; it is out of scope.

### 7.2 Geometry

`faces` geometry. The TIN goes to the rasteriser (§9.2) as it is; `method = tin`.

## 8. DXF (ezdxf)

### 8.1 Inspect

- **DWG never gets here.** `createDesignInspection` answers `422 validation_error` with
  `details.reason = "dwg"` and the message: "DWG files can't be read. Open the drawing in your CAD
  program (or the free ODA File Converter) and save it as DXF, then import the DXF." A `.dxf`
  whose first bytes are `AC10` is really a DWG and gets the same answer.
- Admission (§4.3), then `ezdxf.recover.readfile(path)`. Unrecoverable structure errors become a
  `JobFailure` with ezdxf's message.
- The walk covers every entity in modelspace. `INSERT` is expanded recursively through
  `virtual_entities()` with its transformation applied. An entity on layer `0` inside a block
  counts on the `INSERT`'s layer, per the AutoCAD rule. Each layer is one candidate.
- Per layer, the entities are counted and cached in one of two geometry kinds:

| Entity | Geometry | Taken as |
| --- | --- | --- |
| `3DFACE` | faces | vtx0–3. A triangle when vtx3 == vtx2; a quad otherwise, split along its **shorter 3D diagonal** |
| `MESH` | faces | vertices + faces. n-gons fan-triangulated; subdivision levels ignored |
| `POLYLINE` polyface | faces | `Polyface` faces (the ezdxf `MeshBuilder.from_polyface` path) |
| `POLYLINE` polygon mesh (M×N) | faces | quads split as for `3DFACE` |
| `POLYLINE` 3D | points | one vertex run with each vertex's own Z |
| `POLYLINE` 2D, `LWPOLYLINE` | points | one vertex run at `dxf.elevation`. **OCS**: when the extrusion ≠ (0, 0, 1), vertices go through `entity.ocs().to_wcs()`. Bulges are ignored (arc segments are chorded) |
| `LINE` | points | a 2-vertex run |
| `POINT` | points | a run of 1 |
| anything else (text, hatches, `ACAD_PROXY_ENTITY`, `AECC_*`) | none | counted as `unsupported` |

- **Layer notes** shown in the dialog:
  - "all elevations are 0 — 2D linework?": every point Z = 0. The layer is not selected by
    default.
  - "N Civil 3D objects (AECC) can't be read — export the surface to LandXML, or explode it to
    3D faces": when proxy or AECC entities are present.
  - "N arcs were chorded": when bulges were dropped.
- **Default selection**:
  - If any layer has faces, every layer with faces is selected.
  - Otherwise, the layers with points whose Z takes at least 2 distinct values are selected.
  - A layer with both faces and points counts as faces; its lines are ignored with a note.
- **Units**: `$INSUNITS` per the §5 table. `$MEASUREMENT` is only shown next to it as a hint.

### 8.2 Geometry

- A **faces** selection concatenates the layers' faces (vertex indices offset per layer) and goes
  straight to the rasteriser; `method = tin`.
- A **points** selection goes through Delaunay (§9.1); `method = delaunay`.
- A selection mixing faces layers and points layers gets the `mixed_geometry` `block` warning.

## 9. Triangulation and rasterisation (shared)

### 9.1 Delaunay for points and contours (`triangulate.py`)

1. **Densify** every run's segments to a spacing ≤ `d = 2 × cell` (the preview's or the output's
   cell), with Z interpolated linearly along the segment. For an `LWPOLYLINE` this means constant
   Z.
2. **Deduplicate** XY. Keys are rounded to 1 mm in the output CRS; `np.unique` gives the
   inverse, and the Z values of each key are averaged. If more than 0 keys had a Z spread above
   1 mm, the `duplicate_points` info reads "N positions had different heights (crossing
   contours?) and were averaged".
3. **Delaunay.** Subtract the XY centroid first, for Qhull precision at UTM magnitudes, then call
   `scipy.spatial.Delaunay(xy, qhull_options="Qbb Qc Qz Q12")`. Fewer than 3 points, or all
   points collinear (`QhullError`), is a `block` warning: "the selected layers' points lie on a
   line — nothing to triangulate".
4. **Boundary-peeling maximum-edge rule.**
   - `L = options.max_edge_m`, or automatically `L = max(3 × P95(edge lengths), 10 × cell_size_m)`.
     `max_edge_m = 0` disables the rule.
   - Seed a queue with the triangles that have a hull edge (`neighbors == -1`).
   - Pop a triangle. If its longest horizontal edge is > L, remove it and push its not-yet-removed
     neighbours: they now touch the boundary.
   - This is O(M). Large interior triangles on flat ground are kept unless every triangle between
     them and the hull is long.
   - The automatic L is resolved **once, in `preview`**. It is stored in `preview.json` and
     reported as the `long_edges_removed` value, and `build` reuses it unchanged, so the build's
     finer densification cannot change the trimming the operator saw.
   - The count of removed triangles is reported as the `long_edges_removed` info.
5. The remaining triangles go to the rasteriser as a TIN.

**Breakline caveats**, which are also in §14:

- Densifying approximates a conforming triangulation. Triangles can still cross a contour where
  two contours run closer together than `d`.
- "Flat triangles" (all three vertices on one contour) make terraces at hilltops, valley floors
  and ridge lines. They are not repaired.

### 9.2 TIN rasteriser (`rasterise.py`)

The inputs are vertices V (N×3 float64, output CRS, Z in metres), triangles T (M×3 int32), the
grid's north-up affine and shape, and a list of windows. `rasterise.py` is pure and does not import
`grid.py` (so U5 does not wait on S2 V1); in the build (U7) the affine and shape come from the
output `GridSpec` and the windows are `grid.read_windows(spec)`: BLOCK-aligned, at most 2048², the
same windows `SurfaceWriter.write_block` accepts. Tests pass their own windows (for example 64²).

1. **Cell range per triangle.** Cell centres are at `(col + 0.5, row + 0.5)` through the
   geotransform. For each triangle, compute the inclusive range of centres inside its XY bbox:
   `c0 = ceil((minx − x0)/cell − 0.5)`, `c1 = floor((maxx − x0)/cell − 0.5)`, and rows the same
   way with y decreasing, clipped to the grid.
   - A triangle with an empty range covers no cell centre and is dropped. Every centre inside the
     TIN lies in some triangle, so nothing is lost.
   - Degenerate triangles (XY area < 1e-12 × bbox²) are dropped and counted.
2. **Binning.** A "block" here is one of the given windows, which tile the grid regularly (side
   2048 in the build, so a cell's block is `(row // 2048, col // 2048)`). Each triangle's cell
   range becomes a block range, and pairs
   `(block_id, triangle)` are produced with `np.repeat`, so **a triangle that spans several blocks
   appears in each one**. A stable argsort by block id gives CSR offsets. The index costs about
   12 B per pair.
3. **Per window** (row-major, only windows that have triangles; the others are never written,
   and `SurfaceWriter` reads them back as NaN):
   - `out = NaN (h×w float32)` and `hit = zeros(bool)`.
   - Triangles whose clipped range fits in 8 × 8 cells are processed in batches of ≤ 65 536:
     build an `(n, 8, 8)` candidate-centre grid and compute the edge-function barycentrics in
     float64, **relative to the block origin**, which avoids cancellation at UTM magnitudes.
   - Larger triangles are processed one at a time over their clipped range, in chunks of ≤ 4 M
     cells.
   - A centre is inside when every λ ≥ −1e-9. Its value is `z = λ·Z`.
   - A write to a cell already `hit`, with |Δz| > 1 mm, counts toward `overlapping_triangles`
     (a folded or bad TIN). The last write wins.
   - On a shared edge the two triangles give the same value within float rounding, so there are
     no cracks and no seams between blocks.
4. `rasterise_window(window)` returns `out`, or `None` when nothing was hit. The build calls
   `SurfaceWriter.write_block(window, out)` for each non-`None` result, then `finish()`, which
   returns the `SurfaceStats`. The output carries NaN only, never a mask.

## 10. Validation and preview (`validate.py`)

These steps run at the end of `preview` on the preview grid. Every read of the target is an
overview read through S2's interface (§13): on the preview grid it is
`grid.resample_onto(target_reader, preview_spec, window)`, which reads the target with
`SurfaceReader.read(window, out_shape=…)` averaged by k (case R2; the preview cells are exactly
k × k target cells); for the hypotheses and the preview image it is
`SurfaceReader.read(window, out_shape=…)` directly, with the longest side ≤ 512 px. No target
read exceeds `MAX_READ`.

| Check | How | Warning code (level) |
| --- | --- | --- |
| Overlap | Over the design's valid preview cells: `overlap_fraction = design ∩ target-valid / design-valid` and `target_covered_fraction = design ∩ target-valid / target-valid` | `no_overlap` (warn) when < 5 %; `low_overlap` (warn) when < 50 %; `no_target` (info) when there is no target |
| Hypotheses | Recomputed on the footprint's bbox and mask: swap XY; horizontal unit alternatives (m ↔ international ft, ↔ US ft, ↔ mm, ↔ cm). For each: `overlap_fraction` | a `DesignSuggestion` whenever an alternative reaches ≥ 50 % **and** beats the current value by ≥ 30 points. It carries an `options_patch` the dialog applies with one click and re-previews |
| Degrees | Source CRS projected but \|x\| ≤ 180 and \|y\| ≤ 90 | `looks_geographic` (warn) |
| Local grid | Target in a projected CRS, design max \|coordinate\| < 100 000 while the target's is > 100 000 | `looks_local` (warn): "coordinates look like a local site grid; site calibration isn't supported" |
| Foot ambiguity | Horizontal unit is a foot, or `$INSUNITS = 2` | `foot_ambiguity` (warn), including the magnitude: "survey vs international foot moves this design by up to X m" (X = max\|coordinate\| × 2 × 10⁻⁶ × 0.3048) |
| Units vs CRS | File unit ≠ source CRS axis unit | `units_mismatch_crs` (info): says the XY scale factor that was applied |
| Z offset | `dz = design − target` at cells where both are valid: median, P5, P95, n | `z_offset` (warn) when \|median dz\| > 15 m: "…ellipsoidal vs orthometric heights, or a units problem; S2's alignment check can measure and apply a vertical shift". The median is always shown |
| Z scale | Ratio of the design's to the target's P5–P95 range over the overlap, when both ranges are > 2 m | `z_units` (warn) when the ratio is within 15 % of 3.2808 or 0.3048 |
| CRS provenance | The source CRS was defaulted from the target | `crs_assumed` (info). When it came from the file: `crs_from_file` (info) |
| TIN quality | the counts from §9 | `overlapping_triangles` (warn), `long_edges_removed` (info), `duplicate_points` (info), `degenerate_triangles` (info) |
| Blocking | mixed geometry, nothing to triangulate, zero valid cells, output CRS geographic (`geographic_output`) or projected but not in metres (`non_metric_output`), a CRS unit outside the enum, grid too large (`aligned_grid`'s `MAX_CELLS`), a candidate note marked block | level `block`: the import is refused |

**The preview image** (`preview.png`, longest side ≤ 512 px) is drawn over the union of the
design and target bboxes on the preview grid:

- the target's hillshade in greys (`grid.hillshade`, S2 §4);
- the design's hillshade tinted in the Contour accent `#e5af64` at 60 % over it;
- the design footprint outlined in the accent and the target footprint in `#a3aea6`.

When the two bboxes are more than 10 × the larger extent apart, it draws two panels side by side
instead, labelled "N km apart". An axis swap then reads at a glance.

## 11. UI: Import design surface

`frontend/src/surfaces/ImportDesignDialog.tsx`: a `Dialog` with `width="lg"`, built only from the
`frontend/src/ui/` primitives, with `check-tokens` clean. The sections reveal progressively, per
DESIGN.md, in one scrolling dialog. It opens from an "Import design surface" button in S2's
Volumes screen surface list (S2 §9), which is the only edit S3 makes to an S2 file. S3 adds **no**
navigation entry and no route; the sidebar is F0's (S1 §5 item 7).

1. **File**
   - A path `Input` in monospace, with "Browse" (Tauri dialog, filters `dxf`, `xml`, `landxml`,
     `tif`, `tiff`).
   - "Read file" → `createDesignInspection`. Its job is tracked with `useTrackedJob`, showing a
     `Progress` and the job message.
   - The DWG 422 message shows inline in the `Field` error.
2. **Contents**
   - LandXML: a `Select` of the surfaces.
   - DXF: a list of layers with a `Checkbox` each.
   - Each row shows the thumbnail (`getDesignCandidateThumbnail`), the name, counts per entity
     kind in tabular numerals, the z range and the notes. A `block` note disables the row, with
     its reason.
   - A DEM shows one row, with no choice.
3. **Placement**
   - Target surface: a `Select` of the `ready` cloud DSMs plus "None".
   - Source CRS: an `Input` that takes `EPSG:32639` or WKT. The hint line says where the default
     came from.
   - Horizontal units and height units: two `Select`s, with both feet spelled out ("US survey
     foot (1200/3937 m)", "International foot (0.3048 m)").
   - "Swap easting and northing": a `Switch`. For LandXML its hint reads "LandXML stores northing
     first — already handled".
   - Cell size: only without a target.
   - Maximum edge length: points geometry only; the placeholder reads "automatic".
   - "Preview" → `createDesignPreview`. After the first preview, any change to an option shows a
     stale badge and re-enables "Preview". Previews are not re-run on every keystroke.
4. **Check**
   - The preview image.
   - Figures: overlap %, the share of the cloud surface covered, median / P5 / P95 dz, output
     cells and cell size, and the triangle count.
   - Warnings as `Alert`s: warn → `warn` tone, block → `danger` tone.
   - Each suggestion is an `Alert` with an "Apply" `Button`: it patches the options and runs a
     new preview.
   - When warn-level warnings exist, a `Checkbox` "Import despite these warnings".
   - A Name `Input`, defaulting to "<file stem> — <candidate names>".
   - Primary "Import surface" → `createDesignSurface`, then the dialog closes and the job toasts
     via `useJobToasts`.

Closing the dialog before "Import surface" calls `deleteDesignInspection`.

## 12. Contract surface for F0

F0 writes all of this into `contract/openapi.yaml` (tag `surfaces`; every path under
`/api/v1/projects/{projectId}`), regenerates `schema.d.ts`, routes each operation to a 501 stub,
and adds each operationId to `EXPECTED_STUBS`.

**Paths**

| Method | Path | operationId | Request | Responses |
| --- | --- | --- | --- | --- |
| POST | `/design-inspections` | `createDesignInspection` | `DesignInspectionCreate` | 202 `DesignInspectionWithJob`; 422 `validation_error` (file missing, unknown extension, DWG with `details.reason: "dwg"`) |
| GET | `/design-inspections/{inspectionId}` | `getDesignInspection` | none | 200 `DesignInspection`; 404 |
| DELETE | `/design-inspections/{inspectionId}` | `deleteDesignInspection` | none | 204; 409 `job_running` (a build uses it) |
| GET | `/design-inspections/{inspectionId}/candidates/{candidateId}/thumbnail` | `getDesignCandidateThumbnail` | none | 200 `image/png`; 204 (no thumbnail); 404 |
| POST | `/design-inspections/{inspectionId}/previews` | `createDesignPreview` | `DesignImportOptions` | 202 `DesignPreviewWithJob`; 409 `not_ready` (inspection or target not ready), 409 `job_running` (a build uses it); 422 `validation_error` (unknown candidate, unparseable CRS, a LandXML/DEM selection of ≠ 1 candidate) |
| GET | `/design-inspections/{inspectionId}/previews/{previewId}` | `getDesignPreview` | none | 200 `DesignPreview`; 404 |
| GET | `/design-inspections/{inspectionId}/previews/{previewId}/image` | `getDesignPreviewImage` | none | 200 `image/png`; 204 (not ready or failed); 404 |
| POST | `/design-surfaces` | `createDesignSurface` | `DesignSurfaceCreate` | 202 `SurfaceWithJob`; 409 `not_ready` (preview or target not ready), 409 `job_running` (already being imported), 409 `conflict` (not the newest, has `block` warnings, or has `warn` warnings without `accept_warnings`) |

The path parameters are components: `inspectionId` and `previewId` (`type: string`), and
`candidateId` (`type: string, pattern: "^c[0-9]{1,6}$"`).

**Schemas** (verbatim; `[T, "null"]` means nullable)

```yaml
DesignFormat: { type: string, enum: [geotiff, landxml, dxf] }
LinearUnit: { type: string, enum: [millimetre, centimetre, metre, international_foot, us_survey_foot] }
DesignGeometry: { type: string, enum: [faces, points, raster, none] }
DesignCandidateKind: { type: string, enum: [dem, tin_surface, dxf_layer] }
DesignWarningLevel: { type: string, enum: [info, warn, block] }
DesignInspectionCreate:
  type: object
  required: [path]
  properties:
    path: { type: string, minLength: 1, description: absolute path of a .tif/.tiff, .xml/.landxml or .dxf file }
DesignRasterInfo:
  type: object
  required: [width, height, cell_x, cell_y, dtype, nodata, band_count]
  properties:
    width: { type: integer }
    height: { type: integer }
    cell_x: { type: number }
    cell_y: { type: number }
    dtype: { type: string }
    nodata: { type: [number, "null"] }
    band_count: { type: integer }
DesignCandidate:
  type: object
  required: [id, kind, name, geometry, bounds_file, z_min, z_max, point_count, face_count, entity_counts, default_selected, notes, raster]
  properties:
    id: { type: string, pattern: "^c[0-9]{1,6}$" }
    kind: { $ref: "#/components/schemas/DesignCandidateKind" }
    name: { type: string }
    geometry: { $ref: "#/components/schemas/DesignGeometry" }
    bounds_file: { type: array, items: { type: number }, minItems: 4, maxItems: 4, description: "[minx, miny, maxx, maxy] in file units, x = easting (LandXML N/E already applied)" }
    z_min: { type: [number, "null"] }
    z_max: { type: [number, "null"] }
    point_count: { type: integer }
    face_count: { type: integer }
    entity_counts: { type: object, additionalProperties: { type: integer }, description: "DXF: 3dface, mesh, polyface, polymesh, polyline_3d, polyline_2d, lwpolyline, line, point, unsupported; LandXML: invisible_faces" }
    default_selected: { type: boolean }
    notes: { type: array, items: { $ref: "#/components/schemas/DesignWarning" } }
    raster: { oneOf: [{ $ref: "#/components/schemas/DesignRasterInfo" }, { type: "null" }] }
DesignDetected:
  type: object
  required: [horizontal_unit, vertical_unit, unit_source, crs_wkt, epsg, crs_source, crs_hint]
  properties:
    horizontal_unit: { oneOf: [{ $ref: "#/components/schemas/LinearUnit" }, { type: "null" }] }
    vertical_unit: { oneOf: [{ $ref: "#/components/schemas/LinearUnit" }, { type: "null" }] }
    unit_source: { type: string, description: "e.g. 'LandXML <Imperial linearUnit=USSurveyFoot>', 'DXF $INSUNITS=6', 'CRS axis unit', 'none'" }
    crs_wkt: { type: [string, "null"] }
    epsg: { type: [integer, "null"] }
    crs_source: { type: [string, "null"] }
    crs_hint: { type: [string, "null"], description: an unverified CRS name (DXF GEODATA, LandXML name) }
DesignInspection:
  type: object
  required: [id, state, error, job_id, path, format, file_size, sha256, detected, candidates, default_target_surface_id, created_at]
  properties:
    id: { type: string }
    state: { type: string, enum: [inspecting, ready, failed] }
    error: { type: [string, "null"] }
    job_id: { type: string }
    path: { type: string }
    format: { $ref: "#/components/schemas/DesignFormat" }
    file_size: { type: integer }
    sha256: { type: [string, "null"] }
    detected: { oneOf: [{ $ref: "#/components/schemas/DesignDetected" }, { type: "null" }] }
    candidates: { type: array, items: { $ref: "#/components/schemas/DesignCandidate" } }
    default_target_surface_id: { type: [string, "null"] }
    created_at: { type: string, format: date-time }
DesignInspectionWithJob:
  type: object
  required: [inspection, job]
  properties:
    inspection: { $ref: "#/components/schemas/DesignInspection" }
    job: { $ref: "#/components/schemas/Job" }
DesignImportOptions:
  type: object
  required: [candidate_ids, source_crs, horizontal_unit, vertical_unit]
  properties:
    candidate_ids: { type: array, minItems: 1, items: { type: string, pattern: "^c[0-9]{1,6}$" } }
    source_crs: { type: string, minLength: 1, description: "'EPSG:<code>' or WKT; parsed with pyproj.CRS.from_user_input" }
    horizontal_unit: { $ref: "#/components/schemas/LinearUnit" }
    vertical_unit: { $ref: "#/components/schemas/LinearUnit" }
    swap_xy: { type: boolean, description: "false when absent" }
    target_surface_id: { type: [string, "null"], description: "null when absent. A ready cloud_dsm surface; the output adopts its CRS and cell size on the aligned lattice (same_lattice with it)" }
    cell_size_m: { type: [number, "null"], exclusiveMinimum: 0, description: "null when absent; required when target_surface_id is null; ignored otherwise; default in the UI 0.25" }
    max_edge_m: { type: [number, "null"], minimum: 0, description: "null when absent. Points geometry only; null = automatic, 0 = off" }
DesignWarning:
  type: object
  required: [code, level, message]
  properties:
    code: { type: string, description: "no_overlap, low_overlap, no_target, looks_geographic, looks_local, foot_ambiguity, units_mismatch_crs, units_assumed, z_offset, z_units, crs_assumed, crs_from_file, overlapping_triangles, long_edges_removed, duplicate_points, degenerate_triangles, sentinel_nodata, nodata_unknown, no_heights, unsupported_entities, chorded_arcs, mixed_geometry, nothing_to_triangulate, empty_result, geographic_output, non_metric_output, unsupported_crs_unit, grid_too_large, large_grid, not_tin" }
    level: { $ref: "#/components/schemas/DesignWarningLevel" }
    message: { type: string }
DesignSuggestion:
  type: object
  required: [code, message, overlap_fraction, options_patch]
  properties:
    code: { type: string, enum: [swap_xy, horizontal_unit] }
    message: { type: string }
    overlap_fraction: { type: number }
    options_patch: { type: object, additionalProperties: true, description: keys of DesignImportOptions to overwrite }
DesignPreviewOutput:
  type: object
  required: [crs_wkt, epsg, cell_size_m, width, height, bounds_native, preview_cell_size_m]
  properties:
    crs_wkt: { type: string }
    epsg: { type: [integer, "null"] }
    cell_size_m: { type: number }
    width: { type: integer }
    height: { type: integer }
    bounds_native: { type: array, items: { type: number }, minItems: 4, maxItems: 4 }
    preview_cell_size_m: { type: number }
DesignZCheck:
  type: object
  required: [median_dz_m, p05_dz_m, p95_dz_m, n_samples, design_z_min_m, design_z_max_m]
  properties:
    median_dz_m: { type: number }
    p05_dz_m: { type: number }
    p95_dz_m: { type: number }
    n_samples: { type: integer }
    design_z_min_m: { type: number }
    design_z_max_m: { type: number }
DesignPreview:
  type: object
  required: [id, inspection_id, state, error, job_id, options, output, triangle_count, overlap_fraction, target_covered_fraction, design_area_m2, z_check, warnings, suggestions, created_at]
  properties:
    id: { type: string }
    inspection_id: { type: string }
    state: { type: string, enum: [running, ready, failed] }
    error: { type: [string, "null"] }
    job_id: { type: string }
    options: { $ref: "#/components/schemas/DesignImportOptions" }
    output: { oneOf: [{ $ref: "#/components/schemas/DesignPreviewOutput" }, { type: "null" }] }
    triangle_count: { type: [integer, "null"] }
    overlap_fraction: { type: [number, "null"] }
    target_covered_fraction: { type: [number, "null"] }
    design_area_m2: { type: [number, "null"] }
    z_check: { oneOf: [{ $ref: "#/components/schemas/DesignZCheck" }, { type: "null" }] }
    warnings: { type: array, items: { $ref: "#/components/schemas/DesignWarning" } }
    suggestions: { type: array, items: { $ref: "#/components/schemas/DesignSuggestion" } }
    created_at: { type: string, format: date-time }
DesignPreviewWithJob:
  type: object
  required: [preview, job]
  properties:
    preview: { $ref: "#/components/schemas/DesignPreview" }
    job: { $ref: "#/components/schemas/Job" }
DesignSurfaceCreate:
  type: object
  required: [inspection_id, preview_id]
  properties:
    inspection_id: { type: string }
    preview_id: { type: string }
    name: { type: string, minLength: 1, maxLength: 200 }
    accept_warnings: { type: boolean, description: "false when absent" }
DesignSource:
  type: object
  required: [path, format, units, vertical_units, sha256, candidates, source_crs_wkt, source_epsg, swap_xy, max_edge_m, aligned_to_surface_id, accepted_warnings]
  properties:
    path: { type: string }
    format: { $ref: "#/components/schemas/DesignFormat" }
    units: { oneOf: [{ $ref: "#/components/schemas/LinearUnit" }, { type: "null" }] }
    vertical_units: { $ref: "#/components/schemas/LinearUnit" }
    sha256: { type: string }
    candidates: { type: array, items: { type: string } }
    source_crs_wkt: { type: string }
    source_epsg: { type: [integer, "null"] }
    swap_xy: { type: boolean }
    max_edge_m: { type: [number, "null"] }
    aligned_to_surface_id: { type: [string, "null"] }
    accepted_warnings: { type: array, items: { type: string } }
```

Request properties carry no `default:`; defaults are stated in descriptions, per the ADR
`2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript` (the rule S2 §11 follows).

**Shared with S2 (resolved; one definition each, one owner):**

- `DesignSource` (above) is S3's. S2's `Surface.design_source` is `DesignSource | null`.
- `Surface`, `SurfaceKind` (`[cloud_dsm, design]`), `SurfaceMethod` and `SurfaceWithJob` are S2's
  (S2 §11.2). `Surface` carries `error: string | null` and `design_source`. `SurfaceMethod` is
  `[median, mean, max, min, tin, delaunay, dem_resample, dem_copy]`; S3 writes the last four.
  `createDesignSurface` returns S2's `SurfaceWithJob`.
- The tag of every path above is `surfaces`, shared with S2's paths 1–8; the path parameters
  `inspectionId`, `previewId` and `candidateId` are S3's alone (the full list is in S1 §5 item 1).

**Non-contract F0 items for S3** (all in F0's lists, S1 §5):

- `JobType` gains `design_import`. The frontend label is "Design surface import", with the
  `volume` icon of S2's surface jobs.
- The migration needs nothing S3-specific: `design_source` is the brief's JSON column and
  `surface.error` is S2's column (S2 §3).
- `ezdxf` is pinned direct.
- `scipy`, `shapely` and `psutil` become direct at the lock versions (scipy 1.17.1, shapely
  2.1.2, psutil 7.2.2).
- The package `app/surfaces/design/` with a stub `router.py`, a stub `jobs.py` registering
  `design_import`, the no-op `startup.py::sweep_interrupted` wired into `project_opened()`, and
  the `design-selftest` placeholder in `__main__.py`.
- No new event names. Builds publish `surfaces.changed {surface_ids}`. Inspections and previews
  are followed through their job (`job.state`), then a GET.

## 13. What S3 uses from `app/surfaces/grid.py` (S2 owns it)

S2 §4 is the canonical interface; S3 uses its names and never re-implements them. The three
functions S3 needed beyond S2's first draft (`convention_problems`, `compute_stats`, `hillshade`)
are now part of S2 §4, with tests in S2 §13.

| S2 §4 name | S3 uses it for |
| --- | --- |
| `BLOCK` (512), `MAX_READ` (2048), `MAX_CELLS` (5 × 10⁸) | window sizes; the `grid_too_large` block warning (§4.3) |
| `GridSpec` (`crs_wkt`, `epsg`, `cell_size`, `x0`, `y0`, `width`, `height`; `transform`, `geotransform`, `bounds`, `from_dataset`) | the output and preview grids; the Surface columns `cell_size_m`, `width`, `height`, `geotransform`, `bounds_native` |
| `aligned_grid(bounds, cell_size, crs_wkt, epsg)` | the output grid (§5) and the preview grid (§4.1); `GridError` → a `block` warning |
| `same_lattice(a, b)` | asserting the output shares the target's lattice (§5); the DEM copy test (§6) |
| `read_windows(spec)` | the rasteriser's windows (§9.2) and the DEM re-grid windows (§6) |
| `SurfaceWriter(path, spec, progress=, check_cancelled=)` with `write_block(window, data)` and `finish() -> SurfaceStats` | every design build (TIN and DEM re-grid); `.partial` removed on any exception |
| `SurfaceStats` (`z_min`, `z_max`, `valid_cells`, `coverage_fraction`, …) | the Surface columns `z_min`, `z_max`, `coverage_fraction` |
| `convention_problems(path) -> list[str]` | the DEM copy-as-is gate (§6) |
| `compute_stats(path) -> SurfaceStats` | the statistics of a copied DEM (§6) |
| `open_surface(path)` / `SurfaceReader.read(window, out_shape=…)` | decimated (overview) reads of the target for validation and the preview image (§10) |
| `resample_onto(src, dst, window)` | the target sampled on the preview grid (§10) |
| `hillshade(z, cell_x, cell_y, azimuth=315, altitude=45) -> uint8` | thumbnails (§6) and the preview image (§10) |

Also needed from S2, outside `grid.py`:

- `surface_dir(handle, id)` / `surface_path(handle, id)` (`app/surfaces/paths.py`);
- the interrupted-`building` sweep, which covers every `kind` (S2 §3);
- hillshade tiles, CRUD and delete that don't filter on `kind` (tiles tint design surfaces from
  `z_min…z_max`, since their `stats` is null; S2 §8);
- `SurfaceWithJob` (S2 §11.2).

**Ordering:** the S3 units that import `grid.py` (U4, U6, U7) are ordered after **S2 V1**, S2's
grid unit, which merges to `main` early; S3 rebases onto it first (S1 §15.3). U5 (the rasteriser
and triangulation) depends only on an affine, a shape and windows, so it does not wait.

## 14. Budget and execution DAG

### 14.1 Budget

- **Background jobs:** `design_import` in all three phases, each with progress and cancel.
  - `inspect`: a streamed hash and parse. Memory is O(1 M-row buffers), except ezdxf, which holds
    the DXF document and is admitted per §4.3.
  - `preview`: the memory-mapped TIN, Delaunay, and a preview grid ≤ 512 × 512.
  - `build`: the TIN plus one 2048² block and ≤ 64 MB of batch buffers; the DEM path uses 2048²
    windows only.
  - Every phase restarts cleanly. The sweeps are in §4.4.
- **Synchronous and bounded:** create and get inspection or preview (small JSON files),
  thumbnails and the preview image (pre-rendered files, O(1)), delete (a folder), and
  `createDesignSurface` (checks and a row insert).
- **Never loaded whole:** the XML tree (cleared as parsed), the output grid (blocks), a DEM (2048²
  windows), and the target DSM (decimated reads from its overviews). **Bounded by input, not by
  area:** the TIN arrays and Delaunay (admission check).

### 14.2 DAG

F0 (the shared foundation, S1 §5: contract, migration, JobType, stubs, deps, startup wiring)
precedes everything. After F0 merges, S3 is built in its own worktree, as S1 and S2 are. **S2 V1**
is S2's `app/surfaces/grid.py` unit; it merges to `main` early and S3 rebases onto it before U4.
**S2 V7** is S2's Volumes screen unit with the surface list. The cross-spec DAG is S1 §15.3.

| Unit | Contents | Depends on |
| --- | --- | --- |
| **U1** | `app/surfaces/design/`: `units.py` (the enum and factors), `store.py` (inspection folder, cache format writer and reader, JSON bodies), the body of F0's no-op `startup.py::sweep_interrupted` (§4.4), `jobs.py` (the `design_import` dispatcher by phase, admission helper), `router.py` + `schemas.py`, with `createDesignInspection` (incl. DWG 422), `getDesignInspection`, `deleteDesignInspection` and `getDesignCandidateThumbnail` live and the stubs removed | F0 |
| **U2** | `landxml.py`: streamed iterparse → candidates + cache, units, CRS, N/E rule, invisible faces, id resolution | U1 |
| **U3** | `dxf.py`: ezdxf reader, layers, entity table, INSERT expansion, OCS, quad split, INSUNITS, GEODATA hint, notes, `DXF_RAM_FACTOR` measurement; the body of F0's `design-selftest` placeholder + a `smoke_frozen.ps1` step (ezdxf read + Delaunay of 100 points; U7 adds a 64² `SurfaceWriter` write) | U1 |
| **U4** | `dem.py` inspect: band, CRS, georef, nodata, sentinels, scale/offset, thumbnail (`grid.hillshade`) | U1, S2 V1 |
| **U5** | `triangulate.py` (densify, dedupe, Delaunay, peeling) and `rasterise.py` (binning, block scan, stats); pure functions over an affine and a shape; `QHULL_BYTES_PER_POINT` measurement | F0 |
| **U6** | `placement.py` + `validate.py` + the `preview` phase: `createDesignPreview`, `getDesignPreview`, `getDesignPreviewImage`, warnings, suggestions, preview image | U2, U3, U4, U5, S2 V1 |
| **U7** | The `build` phase: `createDesignSurface` gate, TIN build through `SurfaceWriter`, DEM copy (`convention_problems`, `compute_stats`) and re-grid, Surface row, `source.json`, `surfaces.changed`, cancel and failure cleanup; the 64² `SurfaceWriter` write in `design-selftest` | U6, S2 V1 |
| **U8** | Frontend: `api/designSurfaces.ts`, `surfaces/designImport.ts` (state machine: options ↔ request, stale detection, suggestion patches, accept gating), `ImportDesignDialog.tsx`, and vitest, built against the Prism mock; the Volumes-screen button mount | F0 (dialog); S2 V7 (the mount only) |
| **U9** | e2e, `docs/progress.md` evidence, the real-file acceptance walkthrough (§15.4), ADR(s) for the traps found, `/wrapup` | U7, U8 |

- **Parallel batches:** {F0} → {S2 V1 (in S2's worktree), U1, U5, U8} → {U2, U3, U4} → {U6} →
  {U7} → {U9}. U8's mount waits on S2 V7, and it has slack against U7.
- **Critical path:** F0 → U1 → U3 → U6 → U7 → U9. U3 is the largest reader. S2 V1 must be on
  `main` before U4 and U6 start; if it lands later, U4, U6 and U7 slide with it and U1–U3, U5 and
  U8 are unaffected.
- **Shared-file edits:** `backend/scripts/smoke_frozen.ps1` (U3; S1 and S2 add their own steps
  next to it, so the adjacent lines merge trivially) and S2's Volumes screen (U8; one button).
  `app/__main__.py` (the `design-selftest` dispatch) and `app/main.py` `project_opened` (the
  design sweep step) are wired by F0; S3 units fill only their own modules.

## 15. Testing

Fixtures are generated at test time by `tests/designs.py`; no binaries are committed. Coordinates
sit at real UTM magnitudes (E ≈ 500 000, N ≈ 2 800 000), so float cancellation is exercised.

### 15.1 Analytic surfaces (closed-form oracles)

| Surface | Definition | Assertion |
| --- | --- | --- |
| Plane | `z = 10 + 0.02·(x−E0) − 0.01·(y−N0)`, as a TIN of 2 triangles and of 5 000 random triangles | every covered cell centre equals the plane within 1e-4 m, since linear interpolation of a plane is exact |
| Pyramid | a 40 × 40 base, apex 10 m, 4 planar faces | cells equal `10·(1 − max(\|dx\|, \|dy\|)/20)` within 1e-4 m; Σ cells × area = 5 333.3 m³ within 0.5 % (the volume check S2 will run) |
| Cone | `z = 20 − 0.5 r`, r ≤ 40, as a polar TIN (0.5 m rings, 128 sectors) | matches scipy `LinearNDInterpolator` on the same triangles within 1e-4 m (the oracle for linear interpolation); matches the closed form within 5 cm; volume π·40²·20/3 = 33 510 m³ within 1 % |
| Cone contours | circles at z = 0…19, radius 2(20−z), as DXF 3D polylines and as `LWPOLYLINE`+elevation | Delaunay result within 0.3 m of the closed form for r ≥ 4 m; for r < 4 m the flat top-contour terrace is **asserted** (z = 19 inside the top ring), which documents the caveat |

### 15.2 Rasteriser and triangulation mechanics

- **Seams.** One triangle spanning 3 × 3 blocks (windows forced to 64²) gives output bit-identical
  to a single-block run.
- **Edges.** Shared edges leave no NaN cracks. Degenerate and sub-cell triangles are handled, and
  every cell is written or legitimately NaN.
- **Bad input.** A folded TIN reports `overlapping_triangles`.
- **Peeling.** On an L-shaped 1 m grid of points with a 30 m notch, the notch's hull triangles are
  removed at the automatic L. An enclosed 25 m sparse interior patch keeps its triangles.
  `max_edge_m = 0` keeps everything.
- **Duplicates.** Crossing contours are averaged and counted. Collinear points give
  `nothing_to_triangulate`.
- **Memory.** A tracemalloc/psutil peak on a 1 M-triangle build stays under the arrays plus
  150 MB.

### 15.3 Readers, placement, validation, API

- **LandXML.**
  - Namespaces 1.0 / 1.2 / 2.0 and no namespace.
  - **N E Z order**: a fixture with an E range of 500 000–500 100 and an N range of
    2 800 000–2 800 050 gives `bounds_file` x in the E range.
  - Invisible faces are skipped and counted, and ids are non-contiguous.
  - A missing face id and duplicate ids are failures.
  - 2-value points; a grid surface gives a `not_tin` block; points only.
  - Two surfaces → two candidates.
  - `Metric` / `Imperial` `foot` / `USSurveyFoot`: Z of 100 → 30.48 m vs 30.480061 m, exact to
    1e-12 relative.
  - `CoordinateSystem` `epsgCode` / `ogcWktCode` / absent.
  - A 300 k-point file with a flat parse memory peak (tracemalloc < 50 MB beyond the output
    arrays).
- **DXF** (written with ezdxf in the test):
  - `3DFACE` triangles and non-planar quads (the shorter-diagonal split, checked by value);
  - `MESH` with a pentagon;
  - polyface and polymesh;
  - 3D `POLYLINE`; `LWPOLYLINE` with elevation, including an extrusion of (0, 0, −1), where x
    flips per OCS;
  - `LINE`, `POINT`;
  - an `INSERT` of a block of faces on layer 0 inside an `INSERT` on layer `TIN` → counted on
    `TIN`, with the transform applied;
  - an all-zero layer → the `no_heights` note, not selected by default;
  - a proxy entity → `unsupported`;
  - `$INSUNITS` 0/2/4/6/21 → defaults and warnings;
  - a binary DXF;
  - a mixed selection → `mixed_geometry` block;
  - `.dwg` and a `.dxf` holding `AC1032` bytes → 422 with `reason: dwg`.
- **DEM.**
  - A conforming float32 aligned to the target → `dem_copy`, with a byte-identical data read-back.
  - int16 with −32767 nodata; float32 with an undeclared −9999 sentinel; a scale/offset tag.
  - 3-band uint8 rejected; no geotransform rejected; a rotated geotransform accepted.
  - A plane in EPSG:32638 re-gridded to a 32639 target: each cell is checked against the oracle
    (transform the cell centre back with pyproj, evaluate the plane) within 1 mm.
  - Feet heights → metres.
  - A spy asserts that no read exceeds 2048².
- **Placement.**
  - A DXF in mm with an EPSG:32639 CRS → ×0.001.
  - An international-foot file with a ftUS CRS (EPSG:2229) → factor 0.999998.
  - Equal units → factor exactly 1.0.
  - Swap.
  - The output grid is `aligned_grid` (origin on multiples of the cell) and, with a target,
    `same_lattice(output, target)` is true.
- **Validation.**
  - The same design placed on the target: overlap ≥ 0.99, median dz ≈ the fixture offset.
  - An N/E-swapped LandXML → `no_overlap` + a `swap_xy` suggestion with ≥ 0.9.
  - A metres file read as international feet → a `horizontal_unit` suggestion.
  - A +45 m offset → `z_offset`.
  - A Z×3.2808 → `z_units`.
  - A foot unit → `foot_ambiguity` with the magnitude.
  - Degrees, local grid, no target.
  - The far-apart preview image has two panels.
- **API and jobs.**
  - The whole flow, inspect → preview → build, on a tiny fixture of each format.
  - 409 without a ready preview, with a superseded preview, with `block` warnings, and with
    `warn` warnings without `accept_warnings`.
  - Cancel in each phase → the states and folders from §4.2.
  - A new preview cancels the running one.
  - The sweep removes old inspections that no live job holds.
  - The Surface row holds the §3 values, and `surfaces.changed` is published.

### 15.4 Frontend, e2e, acceptance

- **vitest.**
  - Options ↔ request mapping; stale-preview detection after any option change.
  - A suggestion patch → a new preview request.
  - Import disabled on `block`, and needs the checkbox on `warn`.
  - Unit labels spell out both feet.
  - The DWG error shows inline.
- **e2e (Playwright).** The test writes a small LandXML text file to a temp folder. Then: import
  with no target (CRS EPSG:32639, cell 0.5 m) → the preview image shows → "Import surface" → the
  surface appears `ready` in the Volumes list. When S2's e2e seeding provides a cloud DSM, the
  second run uses it as the target and asserts the overlap figure.
- **Acceptance (the U9 walkthrough, not the unit gate).** On the real chimney file, via S1 import
  and the S2 DSM:
  1. A script samples the DSM onto a 2 m TIN and writes it as LandXML (N E Z, EPSG:32639,
     metres). Importing it gives overlap ≥ 95 % and |median dz| < 0.2 m.
  2. The same file written E N Z gives `no_overlap`; "Apply" on the swap suggestion fixes it.
  3. The same TIN as a `3DFACE` DXF and as 1 m contours gives the same checks, and the contour
     version shows its trimmed notches.
  4. The DSM itself exported as a 1 m DEM in EPSG:32638 re-grids onto the DSM grid.
  5. An S2 volume against each design runs.

The AGENTS.md §4 gates apply to every unit.

## 16. Success criteria

1. For every covered cell of the plane and pyramid fixtures, all three formats (LandXML faces, DXF
   faces, DEM) rasterise to the closed-form height within 1e-4 m (the DEM within 1 mm after
   re-gridding).
2. The LandXML N E Z rule is tested: the fixture with distinct E and N ranges lands with x = E,
   and the swapped fixture produces `no_overlap` plus a `swap_xy` suggestion of ≥ 90 %.
3. US survey foot and international foot give different metres, exact to 1e-12 relative, and a
   foot unit always shows `foot_ambiguity` with a magnitude.
4. With a target, a design surface's grid shares the target's CRS and cell size on the aligned
   lattice: `same_lattice(design, target)` is true, so S2's `resample_onto` takes case R1 (an
   integer-offset read, no interpolation).
5. No single read of a DEM or the output is larger than 2048 × 2048 (spy tests). The LandXML
   parse's memory peak is independent of file size (tracemalloc test). Build memory is the TIN
   arrays plus ≤ 150 MB.
6. A triangle spanning several blocks gives seam-free output, bit-identical to a single-block run.
7. Boundary peeling removes the notch triangles of the L fixture at the automatic L and keeps the
   enclosed interior triangles.
8. `createDesignSurface` refuses without a ready, newest preview, refuses on `block`, and needs
   `accept_warnings` on `warn`.
9. DWG gets a 422 that names the fix (save as DXF). No DWG parsing code exists.
10. Cancel, failure and restart leave no `.partial` file, no half-written surface folder and no
    `building` row. Inspection folders are swept.
11. On the operator's machine (the U9 walkthrough), a 1 M-point / 2 M-face LandXML inspects in
    < 60 s. Its build onto a 5 000 × 5 000 grid finishes in < 60 s, recorded in
    `docs/progress.md`.
12. The acceptance steps in §15.4 pass on the real chimney file.

## 17. Consequences the operator should know

- **The CRS is confirmed every time.** The dialog prefills it but never trusts a design file's
  CRS silently.
- **Overlap cannot catch every mistake.** Survey vs international foot, or a neighbouring UTM
  zone, can still overlap partly. The `foot_ambiguity` warning states how far such a design would
  move, so read it.
- **Heights are not datum-converted.** A design in orthometric heights (e.g. a geoid model) over a
  cloud in ellipsoidal heights, like the chimney file at ≈ −45 m, is offset. The preview shows the
  median difference, and S2's alignment check is where a vertical shift gets measured and applied.
- **Contour designs are an approximation of the designer's TIN.** They terrace at hilltops,
  valleys and ridges ("flat triangles"), and trimming follows the maximum edge length. When the
  designer can export LandXML or 3D faces, prefer that.
- **The design is stored on the cloud surface's grid**, so its file is about the size of the DSM.
  The original file is only read. A temporary geometry cache is kept under `cache/` until the
  import finishes, or for 24 h.
- **Civil 3D surface objects (AECC) inside a DXF can't be read.** Export LandXML from Civil 3D, or
  explode the surface to 3D faces first.

## 18. Risks

| Risk | Mitigation |
| --- | --- |
| ezdxf memory on very large DXFs | Admission with the measured `DXF_RAM_FACTOR`; the message says to save only the surface layers (WBLOCK) |
| Qhull time and memory on tens of millions of contour vertices | Admission with the measured `QHULL_BYTES_PER_POINT`. Densification is proportional to the cell size, so a coarser cell reduces it. Decimation is out of scope |
| The numpy rasteriser is too slow on dense TINs | Batched vectorised scans. The time criterion is §16.11. The fallback, if missed, is rasterising blocks on a small thread pool (numpy releases the GIL) with ordered writes, a local change inside `rasterise.py` |
| Exporter variety (LandXML dialects, broken ids, proxy objects) | Local-name matching, explicit failure messages per defect, fixtures for each dialect in §15.3 |
| The automatic maximum edge trims real design areas | Peeling only from the boundary; the value is shown and editable; the preview shows coverage before commit |
| A wrong CRS still overlaps partly | Hypothesis suggestions, `foot_ambiguity`, z checks, and the side-by-side image |
| Merge collisions with S1 and S2 in `__main__.py`, `smoke_frozen.ps1`, `main.py` and the Volumes screen | One-line additive edits, named in §14.2 |
| S2's `grid.py` changes after S3 starts | S2 §4 is frozen and S3 §13 uses its names; U4, U6 and U7 are ordered after S2 V1, which merges to `main` early |

## 19. Out of scope

- DWG in any form (the operator saves as DXF).
- IFC, and alignments, corridors and cross-sections (LandXML `Alignments`, `CrossSects`).
- Breakline-constrained triangulation beyond densification, including repairing flat triangles.
- LandXML grid surfaces (`surfType="grid"`), `Boundaries` clipping beyond invisible faces, and
  `CgPoints` as a surface source.
- Site calibration or localisation of local coordinates to a CRS.
- Vertical datum or geoid conversion (S2's vertical shift covers offsets).
- Merging several LandXML surfaces, or faces with contours, into one design.
- Editing, clipping or exporting design surfaces.
- Showing designs in the 3D cloud viewer (S1).
- Decimating huge TINs.
- XYZ/CSV point files, KML, SHP.
- Arc (bulge) tessellation in polylines.
