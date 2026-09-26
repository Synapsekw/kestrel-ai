---
type: spec
date: 2026-09-23
status: proposed
tags: [spec, pointclouds, potree, las, laz, measurement, packaging, csp]
related: ["[[2026-09-22-geotiff-maps-design]]", "[[2026-09-23-volumes-design]]", "[[2026-09-23-design-surfaces-design]]", "[[2026-09-23-survey-timeline-design]]", "[[2026-09-22-rasterio-in-the-frozen-sidecar]]", "[[2026-09-20-gotcha-tauri-capability-allowlist-is-runtime]]", "[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]"]
---

# Point clouds: import, view in 3D, measure, link to maps, export

This is S1 of three sibling specs: S1 point clouds (this one), S2 volumes
([[2026-09-23-volumes-design]]) and S3 design surfaces ([[2026-09-23-design-surfaces-design]]).
It also defines the **shared foundation unit F0** (§5), which is built first, by one worker, before
S1, S2 and S3 fan out.

## 1. Goal

The operator imports a LAS or LAZ point cloud from a drone survey. It can have tens of millions of
points, or ~200 M in the worst case. They look at it in 3D in the app, and measure what they need
to inspect a structure: a point's coordinates, a distance, a height difference, and whether a
chimney or mast is plumb. From a detection on the orthomosaic of the same flight they jump to the
same spot in 3D, and back. A LAZ copy goes to a client. The cloud stays usable in the rest of the
app. S2 builds surfaces and volumes from it.

Done means the following, on the operator's real file (Pix4D "Chimney stack 3D", 21 697 184 points,
738 MB, LAS 1.2, EPSG:32639) and on a synthetic 195 M-point cloud (the chimney tiled 3 × 3, 6.2 GB):

1. The file is imported, including the Pix4D file whose header bounding box is 0.3 mm too small.
2. The cloud opens in the Clouds screen. The first points show within 1 s, and the view is settled
   within 5 s at the default 3 M point budget. Orbiting runs at 60 fps with true RGB colours.
3. The operator picks the chimney's base and top, and reads the vertical-line check: horizontal
   offset, lean angle, lean direction and uncertainty.
4. The operator clicks a detection on the linked orthomosaic, lands on the same spot in 3D, and
   jumps back.
5. The operator exports a LAZ that opens in QGIS with the right CRS.
6. The app never runs out of memory. An import that would need more RAM than is free is refused up
   front, with a clear message.
7. The installer build refuses to produce an installer whose packaged viewer is blank.

**Why it matters.** Earthworks volumes are the paid work (S2), and they need a cloud in the project.
Structure inspection and client hand-off need the cloud to be seen and measured. None of that can be
checked or shown without a trustworthy 3D view. The spike (2026-09-23) proved the view works in the
packaged app, but it also found three silent traps: a blank viewer caused by the CSP, white colours,
and a converter abort on real files. This spec turns each trap into a failing check.

## 2. Decisions that shape everything

The brief fixes the data model, the job budget, F0 and the spike facts. The rows below are this
spec's own decisions.

| Decision | Choice | Why |
| --- | --- | --- |
| 3D viewer | **potree-core 2.0.15** (MIT) + **three 0.180.0** (MIT), pinned exact | Spike: 60 fps in the packaged WebView2 at 1/3/8 M budgets, no context loss, no float jitter at UTM coordinates. It is a library, not an app, so it embeds in a React screen. |
| Rejected | The Potree 1.8 full viewer app | It needs jQuery and its own page, and its UI can't be restyled to DESIGN.md. |
| Rejected | COPC in the browser, or backend-rendered image tiles | potree-core cannot load COPC. Image tiles lose true 3D picking. |
| Display copy | **PotreeConverter 2.1.5, `--encoding BROTLI`**, default attributes and sampling | Spike: 21.7 M points in 9 s at 1.2 GB RAM, 195 M in 52 s at 8.7 GB. The output is 0.186 × the input. Writing our own Python octree builder would take weeks of work for a slower result. |
| Rejected | `DEFAULT` (uncompressed) encoding | It is larger on disk and over the wire, and brings no gain once brotli.js is in the workers. |
| Bounds repair | **Always stream a transient local work copy** of the source into `<cloud>/.work/`, hashing while copying. Scan the copy, then overwrite its header min/max (LAS header offset 179, identical in LAS 1.0–1.4 and in LAZ) with the scanned true bounds, widened by one scale step each side. | One uniform path for LAS and LAZ. The source (often on `\\DanNas`) is read over the network exactly once. The scan and the converter then read local disk. The source itself is never modified. The spike proved that exact scanned bounds pass. The one-step widening is margin against the converter's own quantisation. |
| Rejected | Patching only when the header is wrong | That is two code paths, the NAS source is read two or three times, and the common Pix4D case needs the copy anyway. |
| Rejected | Rewriting the file through laspy | About 3 × slower than a byte copy, with nothing gained. |
| CRS | laspy `header.parse_crs()`. For a compound CRS, the horizontal part gives `epsg`/`proj4` and the vertical part's name goes in `vertical_crs`. When the file has no CRS, the operator may **assign** an EPSG (`crs_source = "assigned"`). The cloud is never reprojected. | PotreeConverter drops the CRS (spike), so it is stored ourselves. Pix4D writes GeoKeys, and the spike's LAS 1.2 parsed to 32639. |
| RAM admission | Need = **45 MB per million points + 1 GiB**, compared with `psutil.virtual_memory().available`. Checked when the file is inspected, when the import is submitted, and again right before the converter starts. | 45 MB/Mpt is the spike's measurement (8.7 GB for 195 M). The check runs three times because free RAM changes between the dialog and the job. |
| Converter concurrency | **One PotreeConverter at a time, per process** (a module lock). A second import waits, cancellably, showing "waiting for another point-cloud import". | The job pool has 2 workers. Two converters could each pass admission and then exhaust RAM together. |
| Orphan converters | The converter runs inside a **Windows Job Object** with `KILL_ON_JOB_CLOSE` (ctypes). Cancelling uses `taskkill /T /F` (the trainer's `_terminate_tree`). | If the sidecar crashes, the converter dies with it, so the startup sweep never deletes a folder that a live orphan is still writing. |
| Octree serving | A **backend endpoint with HTTP Range**, restricted to exactly three filenames (an enum). The token goes in a query param, appended by a potree-core `RequestManager.getUrl`. | The loader asks for `…/metadata.json` and then derives the other two URLs with `.replace("/metadata.json", "/octree.bin")`, so a `?token=` query survives (checked in potree-core 2.0.15's bundle). The existing auth accepts `?token=`, as map tiles already do. |
| Rejected | Tauri asset protocol / `convertFileSrc` | It needs a new capability scope and a CSP change, and its Range behaviour is unproven. |
| Rejected | A second local static server | One more port and process, and no auth. |
| CORS | The existing `CORSMiddleware` answers the loader's preflight. F0 adds `Range` to `allow_headers` (`Content-Type` is already there) and exposes `Content-Range`, `Accept-Ranges` and `Content-Length`. | The loader's `content-type: multipart/byteranges` + `Range` headers trigger a preflight (spike). The middleware answers it before routing, so there is no auth hop and no OPTIONS route in the contract. |
| Picking | Client-side `PointCloudOctree.pick`. Every pick is shown with an **uncertainty equal to the display spacing of the deepest loaded node that contains it** (`octree_spacing_m / 2^level`). | The picked point is a real source point, exact to the file's scale (1 mm here). What is uncertain is whether it is the point the operator meant, because the true surface point can be up to one displayed spacing away. Zooming in loads deeper nodes, which shrinks the uncertainty. |
| Measurements | **Persisted** (`cloud_measurement`). The server recomputes the results from the stored points with the same formulas the client previews with, and both are pinned by shared test vectors. | Inspection results go to clients (CSV in the LAZ export, copy to clipboard). A number the server did not compute is not the stored number. |
| Volumes | **Never measured in the viewer.** Volumes come only from S2's `volume_calc` over full-resolution surfaces. | Displayed points are a level-of-detail subset, so a volume integrated from them would silently depend on the camera. |
| Map link | `point_cloud.map_id`, nullable. Linking needs both entities to have a CRS and overlapping WGS84 bounds. The picker ranks maps by overlap and marks "likely same flight" at ≥ 50 % overlap plus the same `captured_on`. | S2 uses the link for the ortho underlay and for detection masks. A link with no geometry behind it would be a lie. |
| 3D jump URL | `/p/:projectId/clouds/:cloudId?at=x,y[&fp=x,y;x,y;…]` and `/p/:projectId/maps/:mapId?at=x,y`. The coordinates are in the **destination's native CRS**, converted by the source screen with proj4 (both entities carry `proj4`). | One contract serves the maps→3D jump, the 3D→map jump and S2's "view in 3D". The destination needs no knowledge of where the caller came from. |
| LAZ export | Built from the **source file** (laspy + lazrs, streamed), never from the octree. The source must still be reachable, with an unchanged size and mtime. | The octree is a display copy. Rebuilding LAS records from BROTLI nodes would be new, fragile code. |
| Viewer lifecycle | The Clouds screen is **lazy-loaded** (three + potree-core only load there). Rendering runs continuously while nodes load or the camera moves, and stops after 1 s idle until the next input or resize. One cloud is shown at a time. | The rest of the app doesn't pay about 1 MB of JS for this screen, and an idle 3D view doesn't hold the GPU. |
| Packaged-webview check | `frontend/scripts/check-packaged-webview.{ps1,mjs}`. It starts the frozen backend itself and launches the release exe with `APP_BACKEND_URL`/`APP_BACKEND_TOKEN` (existing `sidecar.rs` override), `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<free>` and a temporary `WEBVIEW2_USER_DATA_FOLDER`. It then drives the page over CDP. `build-installer.ps1` runs it before Inno Setup. | `pnpm dev` and `tauri dev` both render with the broken CSP (spike). Only the packaged exe shows the trap, so only a check on the packaged exe catches it. |
| Licence notices | An **About** screen at `/about`, driven by `frontend/src/about/notices.json`, with full licence texts as committed `.txt` files imported `?raw`. | The operator wants notices, not a compliance process. The screen is data-driven, so other components can be added later without UI work. |

## 3. Data model

These are brief names. The one rename, `spacing_m` → `octree_spacing_m`, is a coordinator ruling
(below). Columns marked **+** are added by this spec. F0 creates every table (§5).

**`PointCloud` (`point_cloud`)**

| Field | Type / meaning |
| --- | --- |
| `id`, `name`, `created_at` | identity |
| `status` | `importing` / `ready` / `failed` |
| **+** `error` | readable text when `failed`; null otherwise |
| `source_path`, `source_size`, `source_sha256` | the original file. It is only read and never kept in the project. The sha256 is streamed during the work copy. |
| **+** `source_mtime` | float epoch seconds at import; export refuses a changed source |
| `las_version`, `point_format`, `point_count` | from the scan (the header count is kept in `source.json` if it differs) |
| `has_rgb` | point formats 2, 3, 5, 7, 8, 10 |
| **+** `scale` | JSON `[sx, sy, sz]` from the header: the coordinate precision shown with every pick |
| `crs_wkt`, `epsg` | horizontal CRS, both nullable. Null means "no coordinates". |
| **+** `proj4` | nullable. Used for client-side conversions, as with `GeoMap.proj4`. |
| **+** `vertical_crs` | nullable name of the vertical CRS. Null means "heights as stored, no vertical datum" (the chimney case: ellipsoidal). |
| **+** `crs_source` | `file` / `assigned` / null |
| `bounds_native` | JSON `[minx, miny, minz, maxx, maxy, maxz]`, **true** bounds from the scan |
| **+** `bounds_repaired` | true when the header bounds did not contain every point |
| `bounds_wgs84` | JSON `[minlon, minlat, maxlon, maxlat]`, the bbox edges densified with 21 points each, then transformed |
| `octree_spacing_m` | the **root** `spacing` from the converter's `metadata.json`: the octree's root-node spacing, **not** the point spacing (S2 measures that itself). Renamed from the brief's `spacing_m` so the two are never confused. |
| `z_stats` | JSON `{min, max, mean, p01, p1, p5, p50, p95, p99, p999, sample_count}`. Min, max and mean are exact. The percentiles come from a stride sample of ≤ 2 M points. |
| **+** `class_counts` | JSON `{"<code>": n}`, the ASPRS classification histogram (256 bins, exact) |
| **+** `octree_bytes` | total bytes in `octree/` |
| `captured_on` | nullable date. Taken from the header's creation day/year when present. Editable. Re-import never overwrites a date set by hand. |
| `map_id` | nullable FK to `geo_map.id`. Deleting the map nulls it (explicitly in `maps.service.delete_map`, and `ON DELETE SET NULL` in the migration). |
| `job_id` | the import job |

**+ `CloudMeasurement` (`cloud_measurement`)**

| Field | Type / meaning |
| --- | --- |
| `id`, `point_cloud_id` | FK, `ON DELETE CASCADE` |
| `kind` | `point` / `distance` / `height` / `vertical` |
| `name`, `note` | name defaults to "Distance 3"-style numbering. Note is free text. |
| `points` | JSON `[{x, y, z, uncertainty_m}]` in the cloud's native CRS: 1 point for `point`, 2 for the others |
| `results` | JSON, computed by the server (§9.3) |
| `created_at`, `updated_at` | timestamps |

At most 1 000 measurements per cloud; the next create returns 422.

**Storage**

```
<project>/pointclouds/<cloud_id>/
  source.json      # path, size, mtime, sha256, header summary (version, format, header count,
                   # scales, offsets, header bounds), true bounds, bounds_repaired, VLR list, CRS WKT,
                   # converter version + command line, stage timings, last 200 converter log lines
  octree/          # metadata.json, hierarchy.bin, octree.bin (Potree 2.0, BROTLI), never modified
  .work/           # transient: input.las|laz work copy + converter output; deleted in every outcome
```

`ProjectHandle.pointclouds_dir` returns `folder / "pointclouds"` (F0).

**Startup sweep** (`app/pointclouds/startup.py`, wired into `project_opened()` by F0). A cloud in
`importing` whose job this process does not hold becomes `failed` with "import interrupted by
application restart; import the file again". Any `.work/` folder under `pointclouds/` is removed
(`ignore_errors=True`). An `importing` cloud's partial `octree/` is removed too. Each step logs and
continues, so a failing sweep never blocks opening the project.

## 4. Contract surface (S1)

Every path is under `/api/v1/projects/{projectId}`, with tag `pointclouds`. F0 writes all of them
(§5), plus S2's and S3's.

### 4.1 Paths and operationIds

| # | Method + path | operationId | Request → response |
| --- | --- | --- | --- |
| 1 | `GET /pointclouds` | `listPointClouds` | → 200 `PointCloudList` (newest first) |
| 2 | `POST /pointclouds` | `createPointCloud` | `PointCloudCreate` → 202 `PointCloudWithJob`. 422 `unsupported_point_cloud` / `insufficient_memory` / `insufficient_disk` (no row is created) |
| 3 | `POST /pointclouds/inspect` | `inspectPointCloudFile` | `PointCloudInspectRequest` → 200 `PointCloudFileInfo`. Reads the header + VLRs only (≤ 1 MiB). 422 `unsupported_point_cloud` |
| 4 | `GET /pointclouds/{cloudId}` | `getPointCloud` | → 200 `PointCloudOut` |
| 5 | `PATCH /pointclouds/{cloudId}` | `patchPointCloud` | `PointCloudPatch` → 200 `PointCloudOut`. 422 `link_needs_coordinates` / `no_overlap` / `crs_already_set` |
| 6 | `DELETE /pointclouds/{cloudId}` | `deletePointCloud` | → 204. 409 `job_running` while its import or export is live |
| 7 | `GET /pointclouds/{cloudId}/octree/{octreeFile}` | `getPointCloudOctreeFile` | optional `Range` header → 200 (whole file ≤ 64 MiB) / 206 `application/octet-stream` (`application/json` for `metadata.json`). 416 `range_not_satisfiable`. 409 `not_ready` |
| 8 | `GET /pointclouds/{cloudId}/measurements` | `listCloudMeasurements` | → 200 `CloudMeasurementList` |
| 9 | `POST /pointclouds/{cloudId}/measurements` | `createCloudMeasurement` | `CloudMeasurementCreate` → 201 `CloudMeasurementOut`. 422 on a wrong point count, a vertical span < 0.5 m for `vertical`, or the 1 000 cap |
| 10 | `PATCH /pointclouds/{cloudId}/measurements/{cloudMeasurementId}` | `updateCloudMeasurement` | `CloudMeasurementUpdate` → 200 `CloudMeasurementOut` |
| 11 | `DELETE /pointclouds/{cloudId}/measurements/{cloudMeasurementId}` | `deleteCloudMeasurement` | → 204 |
| 12 | `POST /pointclouds/{cloudId}/exports` | `createPointCloudExport` | `PointCloudExportRequest` → 202 `JobRef`. 409 `not_ready` |

**Parameters** (components): `cloudId` (string), `cloudMeasurementId` (string; deliberately not
`measurementId`, which S2 uses for volume measurements), and `octreeFile` (string enum
`[metadata.json, hierarchy.bin, octree.bin]`).

Preflight `OPTIONS` requests are answered by `CORSMiddleware`. This is stated in operation 7's
description, and there is no OPTIONS operation.

### 4.2 Schemas

| Schema | Fields |
| --- | --- |
| `PointCloudOut` | `id`, `name`, `status` enum `[importing, ready, failed]`, `error`?, `source_path`, `source_size` int64, `source_sha256`?, `las_version`?, `point_format`?, `point_count`? int64, `has_rgb`?, `scale`? number[3], `crs_wkt`?, `epsg`?, `proj4`?, `vertical_crs`?, `crs_source`? enum `[file, assigned]`, `bounds_native`? number[6], `bounds_repaired`?, `bounds_wgs84`? number[4], `octree_spacing_m`?, `z_stats`? `PointCloudZStats`, `class_counts`? object<string,int>, `octree_bytes`? int64, `captured_on`? date, `map_id`?, `job_id`?, `created_at` date-time (`?` = nullable) |
| `PointCloudZStats` | `min`, `max`, `mean`, `p01`, `p1`, `p5`, `p50`, `p95`, `p99`, `p999` (numbers), `sample_count` int |
| `PointCloudList` | `items: PointCloudOut[]` |
| `PointCloudCreate` | `path` (required), `name`? (defaults to the file stem), `map_id`? |
| `PointCloudWithJob` | `cloud: PointCloudOut`, `job: Job` |
| `PointCloudPatch` | `name`?, `captured_on`? (nullable date), `map_id`? (nullable; null unlinks), `assign_epsg`? int (only when `crs_wkt` is null) |
| `PointCloudInspectRequest` | `path` |
| `PointCloudFileInfo` | `path`, `size` int64, `compressed` bool, `las_version`, `point_format`, `point_count` int64, `has_rgb`, `header_bounds` number[6], `crs_wkt`?, `epsg`?, `captured_on`?, `admission: PointCloudAdmission` |
| `PointCloudAdmission` | `ok` bool, `ram_needed_bytes`, `ram_available_bytes`, `disk_needed_bytes`, `disk_available_bytes` (int64), `reason`? (the message the UI shows verbatim) |
| `CloudMeasurementKind` | enum `[point, distance, height, vertical]` |
| `CloudMeasurementPoint` | `x`, `y`, `z`, `uncertainty_m` (numbers, native CRS) |
| `CloudMeasurementCreate` | `kind`, `points: CloudMeasurementPoint[]` (1–2), `name`?, `note`? |
| `CloudMeasurementUpdate` | `name`?, `note`? |
| `CloudMeasurementResults` | all nullable numbers: `lon`, `lat` (point), `dx`, `dy`, `dz`, `distance_3d`, `distance_horizontal`, `distance_vertical`, `height_difference`, `lean_offset_m`, `lean_angle_deg`, `lean_azimuth_deg`, `lean_mm_per_m`, `uncertainty_m`, `angle_uncertainty_deg` |
| `CloudMeasurementOut` | `id`, `point_cloud_id`, `kind`, `name`, `note`?, `points`, `results: CloudMeasurementResults`, `created_at`, `updated_at` |
| `CloudMeasurementList` | `items: CloudMeasurementOut[]` |
| `PointCloudExportRequest` | `format` enum `[laz]`, `include_measurements` bool (default true) |

### 4.3 Jobs and events

- `JobType` gains `pointcloud_import` and `pointcloud_export`. The other four come from S2/S3, and
  F0 adds all six.
- The `x-websocket` event `pointclouds.changed` has payload `{cloud_ids: [...]}`. It fires after
  create, a status change, patch, delete and a measurement change.

## 5. Shared foundation (F0)

F0 is one unit, built by one worker in one worktree, merged to `main` **before any S1, S2 or S3
unit starts**. Its purpose is that no two parallel units edit `openapi.yaml`, a migration, the job
enum, the router/startup wiring, the dependency pins or the navigation at the same time. It
delivers the following.

1. **Contract.** `contract/openapi.yaml` gets:
   - every path and schema in S1 §4, S2 §11 "Contract surface for F0" of
     [[2026-09-23-volumes-design]] and S3 §12 "Contract surface for F0" of
     [[2026-09-23-design-surfaces-design]]. Each schema has exactly one owner and one definition:
     `Surface`, `SurfaceWithJob`, `SurfaceKind`, `SurfaceMethod` and `SurfaceBuildMethod` are S2's
     (S2 §11.2); `DesignSource` is S3's (S3 §12), and S2's `Surface.design_source` references it;
   - the `JobType` values `pointcloud_import`, `pointcloud_export`, `surface_build`, `volume_calc`,
     `volume_export` and `design_import`;
   - the `x-websocket` events `pointclouds.changed {cloud_ids}`, `surfaces.changed {surface_ids}`
     and `volumes.changed {measurement_ids}`, added to the `Event` type enum;
   - three tags: `pointclouds` (S1 §4), `surfaces` (S2 paths 1–8 **and** every S3 design path) and
     `volumes` (S2 paths 9–17);
   - the path parameters as `components/parameters`, each name used by exactly one spec: `cloudId`,
     `cloudMeasurementId` and `octreeFile` (S1); `surfaceId` and `measurementId` (S2, which also
     reuses the existing `z`/`x`/`y`); `inspectionId`, `previewId` and `candidateId` (S3).

   `contract/client/schema.d.ts` is regenerated in the same commit, and `pnpm -C contract check`
   passes.
2. **Stubs.** Every new operation is routed as a 501 through `app/stubs.py`, and all of their
   operationIds go into `EXPECTED_STUBS` in `tests/test_contract.py`. Each unit that lands an
   operation removes its own stub.
3. **Models + one migration.** SQLAlchemy models go in `app/db/models.py`. This is the **complete**
   schema change for S1–S3; no later unit adds a migration.

   | Table | Columns |
   | --- | --- |
   | `point_cloud` | the brief's `id`, `name`, `status`, `source_path`, `source_size`, `source_sha256`, `las_version`, `point_format`, `point_count`, `has_rgb`, `crs_wkt`, `epsg`, `bounds_native`, `bounds_wgs84`, `octree_spacing_m` (the brief's `spacing_m`, renamed), `z_stats`, `captured_on`, `map_id`, `job_id`, `created_at`; plus S1's `error`, `source_mtime`, `scale`, `proj4`, `vertical_crs`, `crs_source`, `bounds_repaired`, `class_counts`, `octree_bytes` (S1 §3) |
   | `cloud_measurement` | `id`, `point_cloud_id`, `kind`, `name`, `note`, `points`, `results`, `created_at`, `updated_at` (S1 §3) |
   | `surface` | the brief's `id`, `name`, `kind`, `status`, `point_cloud_id`, `design_source`, `crs_wkt`, `epsg`, `cell_size_m`, `width`, `height`, `geotransform`, `bounds_native`, `z_min`, `z_max`, `coverage_fraction`, `method`, `job_id`, `created_at`; plus S2's `error`, `build_params`, `stats` (S2 §3). S3 needs no column of its own: `design_source` and `error` cover it (S3 §3). |
   | `volume_measurement` | the brief's `id`, `name`, `polygon_native`, `top_surface_id`, `base`, `masks`, `alignment`, `status`, `results`, `job_id`, `created_at`, `updated_at`; plus S2's `error` (S2 §3) |

   - The FKs are `point_cloud.map_id → geo_map.id` (ON DELETE SET NULL),
     `cloud_measurement.point_cloud_id → point_cloud.id` (CASCADE),
     `surface.point_cloud_id → point_cloud.id` (SET NULL) and
     `volume_measurement.top_surface_id → surface.id` (RESTRICT).
   - The indexes are `surface.status` and `volume_measurement.top_surface_id` (S2 §11.3), and
     `cloud_measurement.point_cloud_id`.
   - It is **one** Alembic revision. Its id is taken at build time as the next revision after
     `main`'s head (today `0006_map_captured_on`), not fixed in advance. Immediately before merging
     F0, heads are re-checked across **every** branch (`git branch -a`, then `alembic heads` on the
     merge result), because other branch families claim ids too (`task/tds-*` claims a 0006). On a
     collision the revision is renumbered per
     [[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]].
   - A failed migration logs and the app continues, per the invariant.
4. **Project paths.** `ProjectHandle.pointclouds_dir` (`<project>/pointclouds`),
   `ProjectHandle.surfaces_dir` (`<project>/surfaces`) and `ProjectHandle.volumes_dir`
   (`<project>/volumes`).
5. **Backend wiring** (shared files, edited only here):
   - Packages `app/pointclouds/`, `app/surfaces/`, `app/surfaces/design/` and `app/volumes/`.
   - `api.py` includes four routers, each starting as stubs: `app/pointclouds/router.py`,
     `app/surfaces/router.py`, `app/surfaces/design/router.py` (S3) and `app/volumes/router.py`.
   - Stub job modules that register each new type and raise `JobFailure("not implemented")`,
     imported wherever the maps job modules are: `app/pointclouds/jobs_import.py` and
     `jobs_export.py` (S1), `app/surfaces/jobs_build.py`, `app/volumes/jobs_calc.py` and
     `app/volumes/jobs_export.py` (S2), and `app/surfaces/design/jobs.py` (S3).
   - `main.project_opened()` gains **all four** startup steps, each a no-op
     `sweep_interrupted(handle, runner) -> list[str]` in its own `try` like the existing steps:

     | Module | Filled in by | Does |
     | --- | --- | --- |
     | `app/pointclouds/startup.py` | S1 I2 | interrupted imports → `failed`; `.work/` removed (§3) |
     | `app/surfaces/startup.py` | S2 V2 | interrupted `building` surfaces of **every kind** (S2 builds and S3 design builds) → `failed`; `.build/` and orphan `*.partial` removed (S2 §3) |
     | `app/volumes/startup.py` | S2 V5 | interrupted `calculating` measurements → `stale`/`failed`; orphan partials (S2 §3) |
     | `app/surfaces/design/startup.py` | S3 U1 | stale design inspection and preview folders under `cache/design-inspections/` (S3 §4.4) |

     A later unit fills in only its own function body and never edits `main.py`.
   - In `main.py`, `CORSMiddleware` gets `allow_headers=["Authorization", "Content-Type", "Range"]`
     and `expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"]`.
   - `events_util.py` gets `publish_pointclouds_changed`, `publish_surfaces_changed` and
     `publish_volumes_changed`.
   - `__main__.py` dispatches `pointcloud-selftest` to `app.pointclouds.selftest:main` and
     `design-selftest` to `app.surfaces.design.selftest:main`. Each placeholder prints "<name> not
     built" and exits 2. S1's K2 and S3's U3 fill them in.
   - `app/pointclouds/converter.py` exists with the seam signature
     `run_converter(input_path, out_dir, *, progress, check_cancelled) -> ConverterResult` raising
     `NotImplementedError`, so the test fixture can replace it from day one.
6. **Dependencies**, pinned in `backend/requirements.txt` and `requirements-lock.txt`. This is the
   whole direct-dependency change for S1–S3:
   - `laspy==2.7.0` and `lazrs==0.8.2` (S1);
   - `scipy==1.17.1` and `shapely==2.1.2` (S2/S3: already transitive, made direct at the same
     versions);
   - `psutil==7.2.2` (S1 and S3 admission: already transitive, made direct);
   - `reportlab` and `openpyxl` (S2) and `ezdxf` (S3), at the versions current when F0 is built.

   `backend/kestrel_backend.spec` gets the collection lines for all of them:
   `collect_submodules("laspy")`, the hidden import `lazrs`, and whatever the S2/S3 packaging
   sections name. S1's converter payload is **not** in F0 (unit K1).

   Frontend dependencies: `potree-core` 2.0.15, `three` 0.180.0 and `@types/three` 0.180.0, all
   exact, with the lockfile.
7. **Navigation and routes.**
   - `routes.tsx` gets `p/:projectId/clouds`, `p/:projectId/clouds/:cloudId`, `p/:projectId/volumes`,
     `p/:projectId/volumes/:measurementId` and `/about`. Each is a lazy empty screen:
     `CloudsScreen`, `VolumesScreen` and `AboutScreen`.
   - **Sidebar order: Maps → Point clouds → Volumes → Surveys.** This is the one statement of it;
     S2 and S3 refer here. Design surfaces get **no** nav entry: they are imported from the
     Volumes screen's surface list (S3 §11). Two icons are added to `ui/Icon`: `cloud` and `volume`.
   - The Header `SCREEN` titles are "Point clouds", "Volumes" and "About".
   - An "About Kestrel AI" link goes on the App settings screen.
   - The 3D-jump URL contract (§10: `/p/:projectId/clouds/:cloudId?at=x,y[&fp=…]`, coordinates in
     the destination's native CRS) is documented in `routes.tsx` next to the clouds route. S2's
     "View in 3D" uses it unchanged.
   - Client URL helpers in the generated-client module, next to `mapTileUrl`: `cloudOctreeUrl`
     (S1 §7), `surfaceTileUrl`, `surfaceOrthoTileUrl` and `volumeDiffTileUrl` (S2 §8).
8. **Job label maps.** All six `Record<Job["type"], …>` maps get the six new types:
   - `jobs/jobLabels.ts` TYPE_LABEL;
   - `jobs/JobCard.tsx` TYPE_ICON;
   - `app/Header.tsx` TYPE_VERB;
   - `screens/HomeScreen.tsx` TYPE_VERB;
   - `ui/useJobToasts.ts` TYPE_NAME;
   - `agent/project/ToolRow.tsx` JOB_NAME.

   | Job type | Label | Icon |
   | --- | --- | --- |
   | `pointcloud_import` | "Point cloud import" | `cloud` |
   | `pointcloud_export` | "Point cloud export" | `cloud` |
   | `surface_build` | "Build surface" | `volume` |
   | `volume_calc` | "Calculate volume" | `volume` |
   | `volume_export` | "Export volumes" | `volume` |
   | `design_import` | "Design surface import" | `volume` (the icon of S2's surface jobs) |

   The verb maps (TYPE_VERB) use the same wording in their own grammatical form.
9. **Test helpers.**
   - `backend/tests/pointclouds.py` has:
     - `make_las(path, n, *, epsg=32639, rgb=True, compressed=False, header_shrink_mm=0.0,
       points=None, version="1.2", point_format=3)`. It writes a tiny LAS or LAZ with laspy, with
       optional deliberately-too-small header bounds (the Pix4D trap).
     - `write_fake_octree(points, out_dir)`: a minimal valid Potree 2.0 octree (one leaf root node,
       `DEFAULT` encoding, position + rgb) that potree-core can render.
   - The `app` fixture in `conftest.py` replaces `run_converter` with a fake built on
     `write_fake_octree`, per [[2026-09-21-gotcha-contract-jobs-need-offline-seams]].

F0 has no user-observable behaviour except three empty screens and two nav entries. Its walkthrough
is one line saying so.

## 6. Import (`pointcloud_import` job)

1. **Pick.** The Tauri open dialog is filtered to `*.las;*.laz`. The dialog calls `inspectPointCloudFile`
   and shows the header facts and the admission verdict. When admission fails, the Import button is
   disabled and the reason is shown verbatim, e.g. "This cloud needs about 9.8 GB of free memory;
   6.1 GB is free. Close other programs and try again."
   - The operator sets a name (defaults to the stem) and an optional map link.
   - `createPointCloud` re-runs validation and admission. It creates the row (`importing`), submits
     the job, stores `job_id` and publishes `pointclouds.changed`.
2. **Admission** (`app/pointclouds/admission.py`, pure, with `available_ram()` and `free_disk()`
   seams):

   ```
   ram_needed  = 45 MB × point_count/1e6 + 1 GiB
   disk_needed = source_size                       (work copy)
               + 40 B × point_count                (converter temporary chunks)
               + 0.25 × point_count × record_len   (octree; measured 0.186×)
               + 1 GiB
   ```

   Disk is measured on the project folder's volume. The check runs at inspect, at submit, and again
   in the job just before the converter starts. The job-time failure fails the job with the same
   message.
3. **Work copy + hash** (0–30 % of the bar). The source is copied to `.work/input.<ext>` in 64 MiB
   chunks, updating sha256 as it goes, and checking cancellation between chunks. The progress text
   reads "copying 1.2 / 6.2 GB".
4. **Scan** (30–45 %). `laspy.open(work_copy).chunk_iterator(2_000_000)` computes:
   - the exact count, min/max per axis (from the scaled coordinates) and Z mean;
   - the class histogram (`np.bincount`, 256 bins);
   - a Z stride sample: every `ceil(n / 2 000 000)`-th point by global index, so ≤ 2 M float64
     values (16 MB), which feed the percentiles.

   Peak Python RAM is about 250 MB whatever the file size. The progress text reads
   "scanning 40 M / 195 M points". A count of 0 fails with "the file has no points". A scanned count
   that differs from the header's is recorded in `source.json`, and the scanned count wins.
5. **CRS.** `header.parse_crs()` runs inside a try/except: a parse error means no CRS, with a warning
   in `source.json`. It yields `crs_wkt`, `epsg` (`to_epsg()` of the horizontal part), `proj4`,
   `vertical_crs`, then `bounds_wgs84`, and `captured_on` from the header date.
6. **Header repair.** If the scanned bounds are not inside the header bounds, `bounds_repaired` is
   set to true. In all cases, the work copy's six header doubles at offset 179 are overwritten with
   the scanned bounds widened by one scale step on each side. A reopen with laspy then asserts that
   the header now contains the scanned bounds.
7. **Convert** (45–97 %). This step first acquires the converter lock, cancellably. Then:
   - Run `PotreeConverter.exe <work copy> -o .work/octree --encoding BROTLI` with
     `CREATE_NO_WINDOW`, inside the Job Object, cwd = `.work`.
   - Stdout is read line by line. Lines matching
     `^\[(\d+)%, (\d+)s\], \[([A-Z]+): (\d+)%` map the overall percentage onto the bar, and the
     progress text becomes "building the 3D view copy: INDEXING 63 %".
   - The last 200 lines are kept in a ring buffer. They go to the job log and to `source.json`.
   - Cancelling kills the process tree (`taskkill /T /F`). A non-zero exit becomes a readable
     failure, "the point-cloud converter stopped: <last error line>".
8. **Validate** (97–99 %). `metadata.json` must parse and must have:
   - `version == "2.0"`, `encoding == "BROTLI"`;
   - `points ==` the scanned count;
   - a `boundingBox` containing the scanned bounds;
   - `spacing > 0`.

   `hierarchy.bin` must be ≥ `hierarchy.firstChunkSize` bytes, and `octree.bin` must be > 0 bytes.
   Then `.work/octree` is renamed to `<cloud>/octree` (same volume, atomic), and `.work` is deleted.
9. **Finish.** This step:
   - writes `source.json`;
   - fills the row, sets `status=ready`, and never overwrites a hand-set `captured_on`;
   - publishes `pointclouds.changed`;
   - returns `{cloud_id, point_count, epsg, octree_bytes, seconds}`.
10. **Failure / cancel.** Every exit path deletes `.work` and any partial `octree/`, sets `failed`
    with a readable `error` ("import cancelled" on cancel), and publishes. The maps `_fail` pattern
    is used.

The pure pipeline is `app/pointclouds/importer.py:import_cloud(source, cloud_dir, *, progress,
check_cancelled, converter=run_converter) -> ImportResult`, and it does not touch the database. Both
the job wrapper (`jobs_import.py`) and `pointcloud-selftest` call it, so the selftest exercises the
real code path.

## 7. Octree serving

`GET …/pointclouds/{cloudId}/octree/{octreeFile}`:

- **Path safety.** `octreeFile` is a validated enum, so any other name is a 422 before any
  filesystem access. The folder is derived from the database row's id, never from request text.
  The resolved path must have `<cloud>/octree` as its parent.
- **Readiness.** An unknown cloud is a 404. A cloud that isn't `ready` is a 409 `not_ready`.
- **Range.**
  - Exactly one range, in the form `bytes=a-b`, `bytes=a-` or `bytes=-n`. The answer is 206 with
    `Content-Range`, `Content-Length` and `Accept-Ranges: bytes`.
  - Multiple ranges, malformed syntax, `a ≥ size`, or a range longer than 64 MiB get a 416 with
    `Content-Range: bytes */<size>`.
  - A request with no Range gets 200 with the whole file only when the file is ≤ 64 MiB (metadata
    and hierarchy in practice). Otherwise it gets a 416.
- **Bounded.** The body is streamed in 1 MiB chunks from one file handle, so memory per request is
  about 1 MiB whatever the file size.
- **Caching.** `Cache-Control: private, max-age=31536000, immutable`, because an octree never changes
  under a cloud id.
- **Auth.** The `?token=` query param, as for map tiles.
- **Frontend.** `cloudOctreeUrl(projectId, cloudId)` returns `…/octree/metadata.json`. The
  `RequestManager` is `{ getUrl: async u => withToken(u), fetch: (i, init) => fetch(i, init) }`.

## 8. Clouds screen

The Clouds screen copies the MapsScreen work-surface layout. It is built only from `frontend/src/ui/`
primitives and DESIGN.md (Contour), and `check-tokens` must stay clean.

- **Left column** (`w-52 xl:w-64`).
  - An Import button.
  - The cloud list. Each row shows the name, "21.7 M points", the size, `EPSG:32639` or "no
    coordinates", `captured_on`, the linked map name and a status pill.
  - A `Progress` bar while importing, from `useTrackedJob`. `useOnJobsFinished("pointcloud_import")`
    reloads the list.
  - A failed cloud shows its `error` in an `Alert`, with "Import again" (same path) and "Delete".
  - With no clouds, an `EmptyState` says "Import a LAS or LAZ point cloud".
- **Centre**: `CloudViewer` (`frontend/src/clouds/CloudViewer.tsx`).
  - It is a `relative flex-1 min-h-0 min-w-0` container with the canvas `absolute inset-0 bg-canvas`,
    sized by a `ResizeObserver` (renderer size + camera aspect, pixel ratio `min(devicePixelRatio, 2)`).
    An e2e test asserts that the canvas box equals the centre box, so the "collapsing work area" bug
    fixed for maps in `8dbb55e` can't come back.
  - A bottom bar overlay shows the points shown, the nodes loading, and the last pick's coordinates.
- **Right `aside`** (`w-72 xl:w-80`) with `Segmented` tabs **Details | View | Measure**:
  - **Details.** A facts list:
    - points, file, size, LAS version/format;
    - CRS (EPSG + name), heights ("as stored, no vertical datum" when `vertical_crs` is null);
    - bounds, octree spacing, Z p1–p99;
    - a "header bounds repaired" note.

    Below it:
    - the `captured_on` date input;
    - **Linked map**: a `Select` of the project's ready maps with a CRS, ranked by overlap, with a
      "likely same flight" `Pill`, and an "Unlink" option;
    - **Export LAZ**, which starts the job and ends with a toast whose action reveals the folder;
    - **Assign CRS**: an EPSG input, shown only when there are no coordinates;
    - **Delete**, behind a confirming `Dialog`.
  - **View.**
    - Point budget: a `Select` of 1 / 2 / 3 / 5 / 8 M, default 3 M, kept in `localStorage`
      `kestrel.clouds.pointBudget`. Access is try/catch-wrapped, so a failed read falls back to 3 M.
    - Colour: `Segmented` **RGB | Elevation**. RGB is disabled when `has_rgb` is false, and the
      default then is Elevation.
    - Elevation range: two number inputs, defaulting to `z_stats.p1`–`p99`, plus "Reset". The
      default ignores the 0.009 % noise the spike found below −52 m.
    - Point size: 0.5–3, adaptive.
    - "Fit view" (key F) and "Top view" (key T).

**Viewer mechanics.**

- **Material.** `material.inputColorEncoding = material.outputColorEncoding = 1` (the white-colour
  trap), set by `makeMaterialOptions()`, which a unit test pins. `PointSizeType.ADAPTIVE`. Colour
  mode `RGB` or `HEIGHT` with a viridis gradient over the elevation range.
- **Placement.** The cloud sits at its native offset, with no recentring. potree offsets each node,
  and the spike saw no jitter at UTM coordinates.
- **Navigation.** `OrbitControls` with Z up and `zoomToCursor`. Left drag orbits, right drag pans,
  and the wheel zooms. A double-click retargets the orbit to the picked point. Near/far are set
  every frame from the distance to the target (near = max(0.05, d / 2000), far = 20 × site
  diagonal). The initial view is from the south, above the site, as in the spike.
- **Loop.** `potree.updatePointClouds` and render run while `nodesLoading > 0` or the controls
  changed in the last 1 s. After that the loop idles until input or a resize. It pauses when the
  document is hidden. On unmount it disposes the cloud, renderer and controls.
- **Context loss.** `webglcontextlost` shows an `Alert`, "The 3D view lost its graphics context",
  with a "Reload view" button that remounts the viewer.
- **Diagnostics hook.** When `localStorage["kestrel.diagnostics"] === "1"`, the viewer exposes a
  read-only `window.__kestrelCloudViewer` with:
  - `stats()`: `numVisiblePoints`, `visibleNodes`, `nodesLoading`, `firstPointsMs`, `settledMs`,
    `errors[]`, `contextLost`;
  - `sampleColours()`: renders one frame, `readPixels`, and returns the counts of background, red-dominant,
    green-dominant and pure-white (all channels ≥ 250) pixels;
  - `pickCenter()`.

  The packaged check (§13) and the acceptance measurements use it. It is never on by default.

## 9. Measurements

### 9.1 Tools

Measure tab tools: **Point**, **Distance**, **Height difference** and **Vertical check**. Esc
cancels the active tool.

- **Arming.** Arming a tool enables hover picking, throttled to ≤ 10 Hz, with a cursor marker.
  Otherwise the viewer picks only on click, so the idle GPU cost stays at zero.
- **Committing.** A click commits a pick (`pickWindowSize` 15 px). A 3D overlay (three
  `Line`/`Points` in accent colours) draws the picks, the segment, and for Vertical check the plumb
  line through the lower point plus the horizontal offset.
- **Result.** The last result shows live in the panel. **Save** stores it through
  `createCloudMeasurement`. The saved list below it lets the operator rename, add a note, delete,
  "Fly to", and "Copy all as CSV" to the clipboard.

### 9.2 Coordinate readout (every pick, and the Point tool)

- `E`, `N`, `Z` in the native CRS to 3 decimals (mm), with `EPSG:xxxx`.
- WGS84 latitude and longitude to 8 decimals, via proj4 from `proj4`. This line is hidden when there
  are no coordinates.
- The Z label says "as stored (no vertical datum)" or names `vertical_crs`.
- Precision line: "point exact to 1 mm (file scale) · pick ± 3.2 cm at this zoom". The first figure
  is `max(scale)`. The second is the uncertainty *u* (§2 Picking): the level comes from the deepest
  *visible* node whose bounding box contains the pick, and *u* = `octree_spacing_m / 2^level`. When
  *u* > 0.10 m, the line shows in the `warn` tone with "zoom in to refine".

### 9.3 Formulas (`frontend/src/clouds/measure.ts` ≡ `backend/app/pointclouds/measure.py`)

For picks A and B: d = B − A, and uncertainty `u = √(u_A² + u_B²)`.

| Quantity | Definition |
| --- | --- |
| 3D distance | `‖d‖` |
| Horizontal distance | `√(dx² + dy²)` |
| Vertical distance | `abs(dz)` |
| Height difference | `dz`, signed (B minus A: the second pick relative to the first) |
| Vertical check: points | A = the lower pick, B = the upper pick (sorted by Z). Refused when `abs(dz) < 0.5 m` ("pick points further apart vertically"). |
| Lean offset | `h = √(dx² + dy²)` |
| Lean angle | `atan2(h, abs(dz))` in degrees from vertical |
| Lean direction | `(atan2(dx, dy) · 180/π + 360) mod 360`: the grid bearing of the top relative to the base, clockwise from **grid** north (labelled as such) |
| Lean ratio | `1000 · h / abs(dz)` mm per m |
| Angle uncertainty | `atan(u / abs(dz))` in degrees |

Both implementations are tested against one shared vectors file,
`contract/fixtures/cloud-measure-vectors.json`, to 1e-9.

**Scope of accuracy, stated in the panel's help text.** These measurements are for inspection. A
pick is a real point, but the true surface point can be up to *u* away. Volumes never come from the
viewer (S2).

## 10. Linking to a map and jumping between 2D and 3D

- **Link.** `patchPointCloud {map_id}`. The server requires both entities to have a CRS
  (else 422 `link_needs_coordinates`) and a non-empty intersection of `bounds_wgs84`
  (else 422 `no_overlap`). The map may be in a different CRS from the cloud.
- **Map to 3D** (MapsScreen changes, unit J1):
  - The detection/label popover gets **"Open in 3D"** when at least one ready cloud has
    `map_id == this map`. With several, it offers a short menu, newest first.
  - Right-clicking the map opens a one-item context menu, **"Open this spot in 3D"**.
  - The conversion runs pixel → map native (full affine from `geotransform`) → cloud native
    (`proj4(map.proj4, cloud.proj4)`, the identity when the EPSGs match). The screen then navigates
    to `/p/:pid/clouds/:cid?at=x,y`. A box sends its 4 corners too: `&fp=x1,y1;x2,y2;x3,y3;x4,y4`.
- **Arriving in 3D.** The Clouds screen reads `at`/`fp` once per navigation.
  - If the point is outside `bounds_native` (x, y), the screen shows the toast "This spot is outside
    the cloud" and stays put.
  - Otherwise it sets the orbit target to `(x, y, z_stats.p50)` and puts the camera 45° oblique from
    the south, at a distance of `max(40 m, 3 × footprint diagonal)`.
  - It draws a **vertical pin**: an accent line from `minz` to `maxz` at (x, y). The pin shows the
    spot even before Z is known.
  - Once `nodesLoading == 0`, it picks at the pin's screen position. A hit within 2 m horizontally
    retargets Z to the hit's Z and draws the footprint `fp` as a closed line at that Z.
- **3D to map.** After any pick, **"Show on map"** appears when `map_id` is set. It converts cloud
  native → map native and navigates to `/p/:pid/maps/:mapId?at=x,y`. MapsScreen reads `at`,
  inverts the geotransform to pixels, centres there at full resolution (1 map px per screen px) and
  drops a marker feature. A point outside the map extent gets the toast "This spot is outside the
  map".
- **S2** uses the same `?at=&fp=` contract for its "view in 3D" jump.

## 11. LAZ export (`pointcloud_export` job)

`createPointCloudExport {format: "laz", include_measurements}` writes into
`<project>/exports/<stamp>-cloud-<name>/`. It follows the `.partial-<stamp>` → `<stamp>` pattern
(`_reserve_partial_folder` / `_promote` from `app/exports/job.py`), and the existing
partial-export sweep covers crashes.

1. **Pre-check.** The source must exist, and its size and mtime must equal `source_size` and
   `source_mtime`. Otherwise the job fails with "the source file is not reachable: <path>" or "the
   source file changed since import; import it again".
2. **Write.**
   - `laspy.open(source)` → `laspy.open(dst, "w", header=<copy of the source header>,
     do_compress=True, laz_backend=LazBackend.LazrsParallel)`.
   - The points are copied through `chunk_iterator(2_000_000)`, with progress by points and a
     cancellation check between chunks.
   - The header bounds are set to the scanned true bounds (widened one scale step), so the export
     never carries the Pix4D bbox defect.
   - When `crs_source == "assigned"`, the CRS is written with `header.add_crs(...)`.
3. **Verify.** The output is reopened. Its point count must equal `point_count`, and its
   `parse_crs()` EPSG must equal `epsg`.
4. **Sidecar files.**
   - `cloud.json`: name, CRS WKT/EPSG, vertical CRS, count, bounds, source path + sha256, and the
     app version.
   - `measurements.csv` when `include_measurements` is set and measurements exist. Its columns are
     id, name, kind, note, x1, y1, z1, u1, x2, y2, z2, u2 and every results field.
5. **Finish.** A cancel or a failure deletes the partial folder.

Measured budget (spike): 21.7 M points took 1.5 s and came out 0.21 × the size.

## 12. About screen and licence notices

`/about` shows the app name and version (Tauri `getVersion()`, falling back to the package
version), then a table with the columns Component | Version | Licence | Used for. Each row opens a
`Disclosure` with the full licence text. The data is `frontend/src/about/notices.json`, and the
texts are `frontend/src/about/licences/*.txt`, copied from the upstream packages and the converter
zip's `licenses/` folder.

| Component | Licence | Used for |
| --- | --- | --- |
| potree-core 2.0.15 | MIT. Its bundled notices: Potree (BSD-2-Clause), plasio (MIT) | 3D viewer |
| three 0.180.0 | MIT | WebGL rendering |
| brotli.js (bundled in potree-core's decoder worker) | MIT | Decoding the octree |
| PotreeConverter 2.1.5 | BSD-2-Clause | Building the 3D view copy |
| laszip.dll (shipped with PotreeConverter) | LGPL-2.1 | Reading LAS/LAZ in the converter |
| brotli (C, in PotreeConverter) | MIT | Octree compression |
| nlohmann/json (in PotreeConverter) | MIT | Converter metadata |
| laspy 2.7.0 | BSD-2-Clause | Reading and writing LAS/LAZ |
| lazrs 0.8.2 | MIT | LAZ compression |

The laszip row adds this note: "used unmodified and loaded dynamically by PotreeConverter.exe; it
can be replaced with a compatible build; source: github.com/LASzip/LASzip".

- A vitest checks that every row has non-empty text, and that the potree-core and three versions
  equal `package.json`.
- A pytest checks the laspy and lazrs versions against the installed metadata, and the
  PotreeConverter version against the pin in the fetch script.
- The converter's own licence files are also shipped next to it in the bundle (§14).

Other components (OpenLayers, proj4, rasterio/GDAL, Ultralytics…) can be appended to
`notices.json` later without UI work. Doing that is out of scope here.

## 13. CSP, its ADR, and the packaged-webview check

- **CSP change.** The change to `tauri.conf.json` is one directive, `worker-src blob:`, and nothing
  else: no `'unsafe-eval'`, no `'wasm-unsafe-eval'`, no new origins. The octree requests already
  pass `connect-src http://127.0.0.1:*`.
- **CSP test.** `src/app/csp.test.ts` gains two tests:
  - `worker-src` equals `["blob:"]`;
  - `default-src`, `script-src` (absent) and `connect-src` are unchanged. The existing allow-list
    test stays.
- **ADR** `vault/decisions/2026-09-23-gotcha-packaged-webview-needs-worker-src-blob.md`. It records
  three things:
  - potree-core spawns inline blob workers. Without `worker-src blob:`, the packaged app is silently
    blank: `nodesLoading` is stuck at 1, and the CSP violation shows in the console only. `pnpm dev`
    and `tauri dev` render fine with the old CSP.
  - The loader's Range + `content-type` headers need the CORS preflight headers from F0.
  - Colours need encoding 1.

  It links the check below as the permanent guard.
- **Packaged-webview check**
  (`frontend/scripts/check-packaged-webview.ps1` + `check-packaged-webview.mjs`, exposed as
  `pnpm -C frontend check:webview`). The steps:
  1. Refuse to run while any `kestrel-ai.exe` is running. A WebView2 profile can't be shared across
     different browser arguments.
  2. Make a temp dir T. Start `frontend/src-tauri/binaries/kestrel-backend-x86_64-pc-windows-msvc.exe`
     with a free `APP_PORT`, a random `APP_TOKEN` and `APP_DATA_DIR=T\appdata`, exactly as
     `smoke_frozen.ps1` does, and parse its startup line.
  3. Run `kestrel-backend.exe pointcloud-selftest --write-fixture T\fixture.laz`: 50 000 points,
     red in the west half, green in the east half, EPSG:32639, header shrunk 0.3 mm.
  4. Over the API: create a project in `T\project`, `createPointCloud`, and wait for `ready`.
  5. Launch `frontend/src-tauri/target/release/kestrel-ai.exe` with `APP_BACKEND_URL`,
     `APP_BACKEND_TOKEN`, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<free>` and
     `WEBVIEW2_USER_DATA_FOLDER=T\webview`. Wait for `/json/version`.
  6. Node (playwright-core, already a dev dependency via `@playwright/test`) connects with
     `connectOverCDP`. It enables `Log`, `Runtime` and `Network`, sets
     `localStorage["kestrel.diagnostics"]="1"`, and navigates in-app with `history.pushState` +
     `popstate` to `/p/<pid>/clouds/<cid>`.
  7. **Assert**, failing with a named reason:
     - `stats().numVisiblePoints > 0` and `nodesLoading == 0` within 30 s;
     - no console or Log entry matching `/Content Security Policy|Refused to/`;
     - no `/octree/` response ≥ 400 and no `Network.loadingFailed` (preflight failures show here);
     - `sampleColours()`: red-dominant ≥ 1 % and green-dominant ≥ 1 % of the canvas;
     - `pickCenter()` returns a point inside the fixture bounds.

     On success it prints `webview ok points=<n> red=<f> green=<f>`.
  8. Kill the app and backend trees and remove T.

  `scripts/build-installer.ps1` runs the check after the Tauri release build and **before** Inno
  Setup, so a failure means no installer. **Negative proof (W1, once):** build with `worker-src
  blob:` removed, show that the check fails on the CSP assertion, restore it, and record both
  outputs in the ADR.

## 14. PotreeConverter in the frozen sidecar

- **Fetch** (`backend/scripts/fetch_potreeconverter.ps1`, like `fetch_starter_weights.ps1`).
  1. Download the GitHub release asset `PotreeConverter_2.1.5_x64_windows.zip` from
     `potree/PotreeConverter`, with the URL and SHA-256 pinned
     (`a05bc3a936e41705649dc41b9ae4300ee5273ed23a3f1845e94690ca142e6248`, the spike's copy).
  2. Extract `PotreeConverter.exe`, `laszip.dll` and `licenses/` into
     `backend/third_party/potreeconverter/`, which is git-ignored. The `resources/` folder is only
     for `--generate-page` and is not taken.
  3. Copy `msvcp140.dll`, `msvcp140_atomic_wait.dll`, `vcruntime140.dll` and `vcruntime140_1.dll`
     from `%VCToolsRedistDir%x64\Microsoft.VC14*.CRT\`.
  4. Run `dumpbin /dependents` on the exe and on `laszip.dll`. Fail if any non-system import is
     missing from the folder.
  5. Write `MANIFEST.json`: name, size and sha256 per file, plus the converter version.
- **Spec.** `kestrel_backend.spec` adds every file of that folder as **datas** into
  `potreeconverter/`, so the folder layout is kept and PyInstaller doesn't relocate the DLLs.
  `build.ps1` throws when the folder or any manifest file is missing, before PyInstaller runs and
  again in `dist`.
- **Resolver** (`app/pointclouds/converter_path.py`).
  - Frozen: `Path(sys._MEIPASS) / "potreeconverter" / "PotreeConverter.exe"`, and nothing else.
  - Dev: `KESTREL_POTREECONVERTER`, else `backend/third_party/potreeconverter/PotreeConverter.exe`.
  - Missing: the import fails with "the point-cloud converter is not installed (run
    backend\scripts\fetch_potreeconverter.ps1)", and inspect reports the same.
- **Selftest** (`kestrel-backend.exe pointcloud-selftest`, `app/pointclouds/selftest.py`). It:
  1. verifies `MANIFEST.json` sha256 for every file in the bundled folder. The build machine has
     the VC++ runtime installed system-wide, so a missing DLL would otherwise go unnoticed.
  2. writes the fixture LAZ through **lazrs** (50 000 points, PF3 RGB, EPSG:32639 GeoKeys, header
     max X shrunk 0.3 mm);
  3. runs the **real** `importer.import_cloud` into a temp cloud folder. That covers the work copy,
     hash, scan, CRS, header repair, real admission, the bundled converter through laszip.dll
     decompressing LAZ, and validation.
  4. asserts `bounds_repaired`, EPSG 32639, `points == 50000` and `encoding == BROTLI`;
  5. runs the real export writer to a LAZ and re-counts it.

  It prints `pointcloud ok 50000 32639 BROTLI laz 50000` and exits 0; anything else exits 1.
  `--write-fixture <path>` only writes the fixture, for §13.
- **Smoke.** `smoke_frozen.ps1` runs `pointcloud-selftest` right after `geo-selftest` and prints its
  line. After the project exists it adds an API step: write the fixture, `createPointCloud`, wait
  for `ready`, then GET `octree/hierarchy.bin` with `Range: bytes=0-21` → 206 with 22 bytes. That
  step prints `cloud ok 50000 206`.
- **ADR** `vault/decisions/2026-09-23-potreeconverter-in-the-frozen-sidecar.md` records the MSVC
  DLLs missing from the zip, the system-wide-runtime masking trap, the Pix4D bbox abort and its
  repair, the dropped CRS, and the bundle size delta (about +4 MB converter payload, plus
  laspy/lazrs).

Tauri needs no change here: `bundle.resources` already ships `binaries/_internal/`, and the
converter is started by the sidecar, not by Tauri, so `capabilities/default.json` is untouched.

## 15. Budget and execution DAG

### 15.1 Budget

- **Background jobs** (progress, cancellation and a restart-clean sweep for each):
  - `pointcloud_import`: copy + hash, scan, CRS, repair, convert, validate.
  - `pointcloud_export`: streamed LAS/LAZ → LAZ.
- **Synchronous and bounded:**
  - inspect: header + VLRs, ≤ 1 MiB read;
  - octree serving: one file handle, ≤ 64 MiB per response, streamed in 1 MiB chunks;
  - cloud CRUD, and the link check (bounds only);
  - measurement CRUD: 2 points per row, ≤ 1 000 rows per cloud;
  - picking is client-side.
- **Never in memory:**
  - The point set. Scan and export hold one 2 M-point chunk, about 250 MB peak. The percentile
    sample is ≤ 2 M floats. The class histogram is 256 ints. The copy buffer is 64 MiB.
  - The converter runs out of process. It is admitted at 45 MB/Mpt + 1 GiB, and only one runs at a
    time.
  - In the webview, the point budget (≤ 8 M) bounds memory. The spike measured a peak of about
    1.6 GB at 3 M and 2.1 GB at 8 M.
- **Disk:** a transient work copy the size of the source, the converter's temporary chunks, and an
  octree of about 0.19 × the LAS size. All three are admitted before starting.

### 15.2 DAG (S1 units after F0)

S1's V1 below is the cloud viewer; S2's V1 (§15.3) is a different unit.

| Unit | Contents | Depends on |
| --- | --- | --- |
| **F0** | Shared foundation (§5) | none |
| **K1** | Converter payload: fetch script, manifest, dumpbin closure check, spec datas, `build.ps1` checks, `converter_path.py` | F0 |
| **I1** | Import core: `admission.py`, `workcopy.py`, `scan.py`, `crs.py`, `converter.py` (subprocess, Job Object, progress parse, lock, cancel), validation, `importer.import_cloud`; a `@pytest.mark.potreeconverter` integration test that runs when the payload exists | F0 |
| **O1** | Octree endpoint (Range, 416 rules, enum, streaming, cache headers), CORS preflight tests | F0 |
| **M1** | `measure.py`, the shared vectors file, measurement CRUD | F0 |
| **E1** | `pointcloud_export` job + writer | F0 |
| **V1** | `CloudViewer`: RequestManager, material options, budget, colour modes, navigation, pick + uncertainty, idle loop, context loss, diagnostics hook; e2e octree fixture (`e2e/fixtures/potreeOctree.ts` with a Range-aware `page.route`) | F0 |
| **A1** | About screen, `notices.json`, licence texts, version tests | F0 |
| **I2** | Import job wrapper, create/inspect/get/patch/delete routes, link validation, `delete_map` nulling, startup sweep, events | I1 |
| **K2** | `pointcloud-selftest` + `--write-fixture`, the `smoke_frozen.ps1` steps, the converter ADR | K1, I1, E1 |
| **U1** | Clouds screen: list, import dialog with inspect/admission, Details + View tabs, link picker, export button | V1 |
| **U2** | Measure tab: tools, overlay, live results, saved list, CSV copy | V1, M1 |
| **J1** | Map ↔ 3D jumps: MapsScreen popover item, context menu and `?at=` handling; Clouds `?at=&fp=` handling, pin, Z refine | U1, U2 |
| **W1** | CSP directive + `csp.test.ts`, packaged-webview check, `build-installer.ps1` wiring, negative proof, CSP ADR | V1, O1, I2, K2, U1 |
| **G** | Full e2e, acceptance on the chimney + 195 M + synthetic ortho, `docs/progress.md`, walkthrough, `/wrapup` | all |

- **Parallel batches:** {F0} → {K1, I1, O1, M1, E1, V1, A1} → {I2, K2, U1, U2} → {J1, W1} → {G}.
  Each unit gets its own worktree. Two implementers never share one (see the migration-ids ADR).
- **Critical path:** F0 → I1 → K2 → W1 → G. I1 is the largest backend unit, and W1 needs a real
  frozen and packaged build.
- **Near-critical:** F0 → V1 → U1 → J1 → G. O1, M1, E1 and A1 have slack.
- F0 precedes everything. No S1 unit edits `openapi.yaml`, a migration, `api.py`,
  `main.project_opened`, the dependency pins, the routes or the job maps.

### 15.3 Cross-spec DAG (S1, S2, S3)

After F0 merges to `main`, S1, S2 and S3 are each built in **their own worktree** (and each of
their units in its own, per the batches in each spec). S2's V1 (`app/surfaces/grid.py`, S2 §4) is
small and merges to `main` **early**; S3 rebases onto it before starting any unit that imports
`grid.py`.

```
F0 ─┬─> S1 batch 1 {K1, I1, O1, M1, E1, V1, A1} ─> … ─> S1 G
    ├─> S2 V1 (grid.py; merged to main early) ─┬─> S2 {V2, V3, V4} ─> … ─> S2 V9
    │                                          └─> S3 {U4, U6, U7} (after S3 rebases onto main)
    └─> S3 batch 1 {U1, U5, U8} (no grid.py) ─> {U2, U3, U4} ─> U6 ─> U7 ─> U9
```

| Spec | Critical path |
| --- | --- |
| S1 | F0 → I1 → K2 → W1 → G |
| S2 | F0 → V1 → V4 → V5 → V6 → V8 → V9 (S2 §12.2) |
| S3 | F0 → U1 → U3 → U6 → U7 → U9, with U6 and U7 also gated on S2 V1 (S3 §14.2) |

Cross-spec edges: S3 U4, U6 and U7 need S2 V1; S3 U8's button mount needs S2 V7 (the Volumes
screen surface list); S2's "View in 3D" and S2 V9's acceptance need S1's import (a ready cloud);
S2's clutter masks read existing map detection runs only. Nothing in S1 waits on S2 or S3.

## 16. Testing

**Backend (pytest).** Fixtures come from `tests/pointclouds.py` at test time; nothing binary is
committed.

- **Admission.** Arithmetic on known counts; a refusal with the RAM seam at 4 GB for 195 M points
  (the message names both figures); the disk refusal; the re-check inside the job.
- **Work copy.** The hash equals `hashlib` over the source. Cancelling mid-copy removes `.work`. The
  source's bytes and mtime are unchanged afterwards.
- **Scan.** Exact min/max/count/mean on a known point set. The percentiles land within one sample
  stride of numpy's on the full array. The class histogram. A chunk-boundary case (n = 2 M + 1).
  The count-mismatch record.
- **Repair.** With `header_shrink_mm=0.3`, `bounds_repaired` is set and a laspy reopen of the work
  copy contains every point. An already-correct header still gets the widened bounds.
  Byte-offset 179 is correct for LAS 1.2, LAS 1.4 PF6 and LAZ.
- **CRS.** EPSG from GeoKeys (1.2) and from WKT (1.4). A compound CRS gives a horizontal EPSG and a
  vertical name. No CRS means nulls. A corrupt VLR means nulls plus a warning. `bounds_wgs84`
  matches an independent pyproj result.
- **Converter.**
  - The progress regex runs on recorded spike lines, including interleaved "processed points" lines.
  - A non-zero exit gives a readable error.
  - Cancel kills the tree: a fake long-running child process, and no process left afterwards.
  - The lock serialises two imports and a waiting import cancels.
  - The Job Object is asserted by killing the parent test subprocess and checking the child is gone.
- **Validation.** Mismatched points, wrong encoding, missing files, a bounding box not containing
  the bounds. Each fails readably.
- **Job + API.** It uses the fake converter seam (a real, tiny Potree octree).
  - The create → ready flow, events, `failed` + cleanup on every failure path.
  - The startup sweep: `importing` becomes `failed`, and `.work` is removed.
  - Delete: 409 while a job is live; cascades measurements; removes the folder.
  - The link rules (no CRS, no overlap, a different CRS that does overlap). Map delete nulls the
    link. `assign_epsg` only when the CRS is null.
- **Octree endpoint.** 206 bytes equal a direct slice, for `a-b`, `a-` and `-n`. 416 for multi-range,
  malformed, `a ≥ size`, > 64 MiB, and a no-Range request on a big file. 422 for `../x` and other
  names; a spy asserts `open()` is never called. 409 when not ready. Cache headers. A preflight from
  `http://tauri.localhost` with `Access-Control-Request-Headers: content-type,range` returns 200 and
  echoes both.
- **Measurements.** The shared vectors file (the same one vitest reads). The `vertical` 0.5 m
  refusal. The 1 000 cap. The server recomputes results and ignores any client `results`.
- **Export.** The count, EPSG, header bounds containing all points and the LAZ ratio. `measurements.csv`
  columns. Refusals for a missing or changed source. Cancel removes the partial folder.
- **Integration** (`@pytest.mark.potreeconverter`, skipped without the payload): the real converter
  on the fixture, with the same assertions as the selftest.

**Frontend (vitest).**

- `measure.ts` against the shared vectors.
- The uncertainty from (`octree_spacing_m`, level).
- The coordinate formatting, and the WGS84 line hidden without a CRS.
- `makeMaterialOptions()` pins encoding 1/1.
- The RequestManager appends the token, and `.replace("/metadata.json", …)` keeps it.
- The budget `localStorage` fallback.
- The map ↔ cloud transforms: an affine with rotation terms; the identity for equal EPSG; a 32639 ↔
  32638 round trip within 1 mm.
- The `at`/`fp` parse and serialise.
- Link ranking and the "likely same flight" rule.
- `notices.json` completeness and versions.
- `csp.test.ts`.

**e2e (Playwright, Prism mock plus `page.route`)**, using the in-memory octree fixture served with
Range:

1. Import dialog → inspect → admission refusal shown → an admissible file → the list shows
   "importing" then "ready" (mocked events).
2. Open the cloud. The canvas fills the centre box, and `stats().numVisiblePoints > 0`.
3. Budget and colour switches.
4. The Distance tool on two scripted picks (diagnostics hook) → Save → the list → Copy CSV.
5. A map detection → "Open in 3D" → URL `?at=&fp=` → pin shown.
6. "Show on map" → the MapsScreen marker.
7. Export LAZ → the job toast.
8. The About screen lists every row.

**Frozen and packaged.** `pointcloud-selftest`, the `smoke_frozen.ps1` steps and `check:webview`
(§13, §14). The AGENTS.md §4 gate applies to every unit. Packaging units (K1, K2, W1) also run
`build.ps1`, `smoke_frozen.ps1` and `build:installer`.

## 17. Success criteria

1. **Chimney import.**
   - The import completes with status `ready`, `point_count` 21 697 184, EPSG 32639,
     `bounds_repaired` true, and `bounds_native` equal to an independent laspy scan to the file
     scale.
   - The octree `metadata.json` has 21 697 184 points and `octree_bytes` ≤ 0.25 × 738 MB.
   - Wall time is ≤ 60 s from a local-SSD copy. The time from `\\DanNas` is recorded in
     `docs/progress.md`.
2. **195 M synthetic cloud** (3 × 3 tiles of the chimney, 195 274 656 points, 6.2 GB).
   - Admission passes on the operator's machine, and the import completes in ≤ 5 min from local SSD.
   - Converter peak RSS is ≤ 10 GB, and the backend process's RSS grows by ≤ 1 GB during the import.
3. **Admission refusal.** With the RAM seam reporting 4 GB free, `createPointCloud` for 195 M points
   returns 422 `insufficient_memory`. The message states about 9.8 GB needed and 4.0 GB free, and no
   row is created.
4. **Cancel.** Cancelling during conversion leaves no `PotreeConverter.exe` process within 5 s. The
   cloud folder is gone, and the status is `failed` with "import cancelled".
5. **Crash.** Killing the sidecar mid-conversion kills the converter (Job Object). Restarting marks
   the cloud `failed` "interrupted", and `.work` is gone.
6. **Packaged viewer performance**, measured with the diagnostics hook over CDP.
   - Chimney at 3 M: first points ≤ 1 s, settled ≤ 5 s, orbit p50 frame ≤ 20 ms, webview peak
     ≤ 2.5 GB.
   - Chimney at 8 M: webview peak ≤ 3 GB.
   - 195 M at 3 M: settled ≤ 8 s, orbit p50 frame ≤ 20 ms.
7. **Colours.** The chimney renders in true RGB, not white: in `sampleColours()`, pure-white
   pixels are < 5 % of the non-background pixels. The white-colour trap paints every point pure
   white, so it would read about 100 %. The fixture passes the red/green assertion in
   `check:webview`.
8. **Packaged check.** `check:webview` passes on the release build, and fails with the CSP reason on
   a build without `worker-src blob:` (the negative proof recorded in the ADR). `build:installer`
   stops when the check fails.
9. **Picks are real points.** 10 picks on the chimney, saved as Point measurements, each match a
   source point within 1 mm (`backend/scripts/check_picks.py`: a laspy chunked nearest search over
   the exported `measurements.csv`).
10. **Uncertainty.** Every pick shows *u*. On the chimney, the same spot on the stack rim is picked
    twice: once from the whole-site view, and once after zooming until `nodesLoading == 0` at
    ≤ 30 m range. The close-up *u* is ≤ 0.05 m and at least 4 × smaller than the whole-site *u*.
    Any *u* > 0.10 m shows in the warn tone.
11. **Formulas.**
    - Both implementations match the shared vectors to 1e-9.
    - A synthetic pole leaning exactly 1.000° towards grid east reports 1.00° ± 0.02°, direction 90°
      ± 1°, and 17.5 mm/m ± 0.4.
    - `vertical` with abs(dz) < 0.5 m is refused.
12. **Map ↔ 3D.** The acceptance uses a synthetic ortho rasterised from the chimney's RGB
    (`backend/scripts/make_test_ortho.py`: 5 cm, EPSG:32639, highest point per cell), imported as a
    map and linked.
    - "Open this spot in 3D" puts the pin within 0.01 m (x, y) of the transformed position.
    - The Z refine lands on the surface.
    - "Show on map" puts the marker within 1 map pixel of the pick.
    - The unit tests cover a map in a different CRS.
13. **LAZ export.**
    - The chimney export is ≤ 0.25 × the source size, has the same count and EPSG 32639, has header
      bounds that contain every point, takes ≤ 30 s, and opens in QGIS in the right place (a
      walkthrough step).
    - The 195 M export takes ≤ 3 min.
14. **Octree endpoint.** Every rule in §7 is covered by a passing test. No filename outside the
    enum reaches the filesystem.
15. **Frozen bundle.**
    - `kestrel-backend.exe pointcloud-selftest` prints `pointcloud ok 50000 32639 BROTLI laz 50000`.
    - `smoke_frozen.ps1` prints `cloud ok 50000 206` and `smoke ok`.
    - `build.ps1` fails when any manifest file is missing.
16. **About.** `/about` lists all nine rows with full texts, and the version tests pass.
17. **Gate.** The AGENTS.md §4 gate passes on every unit, and `check-tokens` is clean.

## 18. Consequences the operator should know

- **The source must stay reachable.** Like maps, the source file is not kept in the project. The 3D
  view does not need it, but LAZ export does, and S2's surface build reads it too. If the NAS is
  offline, or the file was moved or edited, those jobs fail with the path.
- **Import needs temporary disk.** About the source size, for the work copy, on the project's drive,
  plus about 0.2 × for the permanent octree. A 6 GB LAS needs about 16 GB free during import, and
  about 1.2 GB after.
- **Imports run one at a time.** A second import waits for the first. On the operator's machine a
  200 M-point cloud takes about 1–3 minutes plus the time to copy it off the NAS.
- **Measurements are for inspection.** Each one carries its uncertainty, and it gets smaller as you
  zoom in. Volumes are never taken from the 3D view.
- **Heights are as stored.** Pix4D's chimney file has ellipsoidal heights (ground ≈ −45 m). The app
  labels them "no vertical datum" and does not convert them.
- **Lean direction is grid-relative.** It is given against grid north of the cloud's CRS, not true
  north.
- **Building the installer needs a closed app.** The installer build now launches the packaged app
  for about 30 s to prove the 3D view renders, and it refuses to run while Kestrel AI is open.

## 19. Risks

| Risk | Mitigation |
| --- | --- |
| potree-core is a small community package, and a three upgrade may break it | Both are pinned exact. The packaged check and e2e fail loudly on a broken render. |
| A WebView2 runtime update changes the CSP or GPU behaviour | `check:webview` runs on every installer build |
| The MSVC runtime is missing on another machine, masked by the build box's system-wide install | The manifest + dumpbin closure check at fetch time, and the manifest sha check in the selftest |
| PotreeConverter fails on unusual files (waveform PF 4/5/9/10, exotic extra bytes) | A readable failure with the converter's last lines in the job log and `source.json`. PF 0–3 and 6–8 are tested. |
| Copying from the NAS dominates import time | The copy is read once and shown as its own progress stage. The consequence is stated above. |
| The token in the query string lands in the access logs | Same exposure as map tiles already. The token is per launch. |
| A pick hits a foreground point, not the intended one | The uncertainty readout, "zoom in to refine", and the pick window of 15 px picking the nearest point to the camera |
| RAM admission is too optimistic for odd point formats | The 1 GiB margin, the job-time re-check, and one converter at a time |

## 20. Out of scope

- COPC, E57, PLY and XYZ import. Reprojecting a cloud. Vertical datum or geoid conversion.
- Showing several clouds in one view, or clouds overlaid on the ortho in 3D.
- Clipping boxes, section/profile views and classification editing. A clipping box is the natural
  inspection follow-up.
- 3D detection, and meshing.
- Volumes and surfaces in this screen (S2), and design surfaces (S3).
- Exporting a cropped or thinned cloud. Exporting from the octree when the source is gone.
- Licence notices for the rest of the app's components (the table is ready for them).
