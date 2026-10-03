# Findings on the asset (phase 1 of the artifact port)

Status: draft for operator review, 2026-10-02.

Parent plan: `docs/artifact-to-kestrel-plan.md` (decisions Q1 to Q7 in §9.2).

This spec also takes over M4 of the confined-space programme (spec
`2026-10-02-asset-model-builder-design.md` §3).

## 1. Goal

Turn an asset model into the place where findings live, as the EBSM flare and DAMAC facade reviews
do:
- A photo with a known pose looks at the model.
- Each defect sighting on that photo lands on the model as a pin or a textured patch.
- Repeat sightings of the same defect group into one finding.
- Every finding knows its height, side, zone and component.

The register, Overview, CSV and PDF all show these same numbers.

**Done means** both of the following run in the app from the operator's own data:
- The DAMAC review opens with its 656 defects (182 moderate, 474 minor).
- EBSM's 78 findings sit on the stack.

## 2. Scope

**In:**
- Importing an existing GLB as an asset model version, with a frame conversion.
- The asset frame: geographic origin, north, height, zones, sides, silhouette, levels, presets.
- Photo poses in the asset frame: imported, or estimated from EXIF and XMP.
- An `asset` anchor for findings, with sightings.
- Back-projection of sightings onto the model.
- Grouping sightings into findings, with merge and split.
- Photo review status: finding, none, uncertain, not assessed.
- Importing a kit job folder.
- Asset workspace additions:
  - pins and patches, camera glyphs, ghost see-through, auto-rotate, focus, street map ground;
  - split inspection (model beside photo) with polygon overlays and hold-to-compare.
- Register additions: columns, an asset source, a gallery mode.
- An asset hero and a findings map on the Overview.
- Report additions:
  - an asset findings map section and per-finding asset pages;
  - a sightings CSV in the kit's column set;
  - a `brand` entity applied to the PDF.
- Built-in review profiles: stack, building facade, tank, telecom tower, OHTL tower.

**Out, and where it goes:**
- The AI review job (contact sheets through the providers): later (plan Q5).
- The offline or hosted review package and an in-app PDF viewer: phase 2.
- Flights, video, POIs from Elios, f-theta projection: phase 4 (M2, M3, M6). The tank's 11 findings
  are entered or imported in this phase as plain sightings on its photos.
- Metashape or Pix4D camera import: later. The `image_pose.source` enum leaves room for it.
- Raster mask storage: none (plan Q3). Polygons are the truth.
- Kiosk layout: after phase 2 (plan Q7).

## 3. Dependencies

**Needs merged first (phase 0):**
- **M1 U5, U6, U7.** U6 supplies `frontend/src/assetmodels/viewer/engine.ts`, which this spec
  extends. U7 supplies the asset workspace this spec adds topics to.
- **The workspace rail.** The asset workspace uses the same rail, topic panel and inspector.

**Nothing in this spec blocks M2** (flight import). M2 can run in parallel.

## 4. Decisions

| # | Decision | Why |
| --- | --- | --- |
| A1 | A finding is a **defect**. Its evidence is one or more `finding_sighting` rows. | Plan Q1. DAMAC shows 656 findings over 1,441 sightings. |
| A2 | Sightings exist only for `asset` findings in this phase. Image, map and cloud findings keep their single anchor; the API presents them as one implicit sighting. | No data migration of existing findings; the shape is the same for the UI. |
| A3 | **Grouping runs as a job**: at import, and when the operator presses Regroup. It never runs silently on edit. Merge and split are explicit operator actions. | Grouping must not undo a person's review. |
| A4 | Polygons and boxes on `box` stay the stored truth. The photo overlay is drawn from them in Konva; patch textures are derived files. | Plan Q3. One truth; trainable as YOLO-seg. |
| A5 | "Uncertain", "none" and "not assessed" are **photo review statuses** (`image_review`), not severities. | Plan Q2. |
| A6 | Review profiles are **code constants** (`backend/app/asset_review/profiles.py`), chosen per asset model and stored as a resolved copy on it. They are not catalogue rows yet. | No catalogue migration; the five kit profiles are stable; a template link can come later. |
| A7 | The canonical frame is M1's: metres, Y up, X plant north, Z plant east, origin at the base centre on the ground datum. A GLB in another frame is converted once on import, and the converter is recorded in `meta`. | One frame for every later phase (plan R4). |
| A8 | Severity mapping on import: Light / Minor = 1, Moderate / Significant = 2, Heavy / Severe / Critical = 3. | Plan Q2. |
| A9 | The 3D image for a report page is rendered **server-side** with the existing numpy rasterizer (`backend/app/asset_models/raster.py`), extended to draw a pin or patch outline. No headless browser. | Reports stay reportlab and deterministic (ADR `2026-09-30-reports-use-reportlab-not-webview2-print`). |
| A10 | Customer data (DAMAC, EBSM, KOC) is **never committed**. Unit and e2e tests use the kit's synthetic tower and hand-made fixtures. The real jobs are acceptance runs that read the operator's folders read-only and record only numbers. | The repo is public. |

## 5. Data model

Project database migration **0016** (free on `main` and on every task branch, checked
2026-10-02). No catalogue migration.

### 5.1 `asset_model` gains two columns

| Column | Type | Notes |
| --- | --- | --- |
| `frame` | JSON, nullable | `{origin: {lat, lon, ground_alt_m} \| null, north_offset_deg, height_m, datum_label, datum_note, line_azimuth_deg \| null, silhouette: [[y, r]], levels: [y], presets: [{id, label, target[3], camera[3]}]}` |
| `review` | JSON, nullable | The resolved review profile (§7): `{profile_id, finding_unit, placement, patch_grid, cluster_m, zones: [{id, label, min_m, max_m}], sides: {type, labels, basis}, focus: {frustum, oblique_deg}, report: {pages, min_severity}}` |

`height_m` and `silhouette` default from the GLB: the radial silhouette is the 92nd percentile of
vertex radius in 160 height bins, smoothed over 5 (kit `records.py` `mesh_info`). The operator can
edit every field.

### 5.2 `asset_model_version` gains `kind = 'imported'`

- `spec` holds `{}`.
- `meta` holds `{source_name, sha256, bytes, node_count, frame_conversion: "none" | "x_east_minus_z_north" | ..., parts: [{node, name, group}]}`.
- The GLB is copied to `asset_models/<id>/v<n>.glb` and is never rewritten.
- The part list comes from the node names; glTF `extras` are kept in `meta.parts[].extras`. The
  phase 5 register builds on this.

### 5.3 `image_pose` (new)

One row per (image, asset model): where that photo was taken from, in that asset's frame.

| Column | Type | Notes |
| --- | --- | --- |
| `image_id` | FK image, CASCADE | PK part |
| `asset_model_id` | FK asset_model, CASCADE | PK part |
| `position` | JSON `[x, y, z]` | m, asset frame |
| `target` | JSON `[x, y, z]` | |
| `up` | JSON `[x, y, z]` | |
| `hfov_deg`, `vfov_deg` | float | |
| `source` | str | `kit` \| `exif_gimbal` \| `exif_axis_aim` \| `manual` (later: `metashape`, `pix4d`, `fitted`) |
| `accuracy_m` | float, nullable | The stated accuracy, shown in the UI |
| `sequence` | str, nullable | A flight or sequence label for filters and colours |
| `updated_at` | datetime | |

### 5.4 `image_review` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `image_id` | FK image, CASCADE, PK | |
| `status` | str | `finding` \| `none` \| `uncertain` \| `not_assessed` (CHECK) |
| `note` | text | |
| `coverage` | float, nullable | Share of the photo inside finding polygons (computed) |
| `uncertain_coverage` | float, nullable | |
| `updated_at` | datetime | |

`image.marked_empty` stays. Writing `none` sets it and writing anything else clears it, in the same
transaction, so the training-data path is unchanged.

### 5.5 `finding` gains the `asset` anchor

New nullable columns:

| Column | Notes |
| --- | --- |
| `asset_model_id`, `asset_version` | The model and version the placement was computed on |
| `ax`, `ay`, `az`, `an_x`, `an_y`, `an_z` | Representative point and normal (from the representative sighting) |
| `placement` | `point` \| `patch` \| `none` |
| `height_m`, `bearing_deg`, `side`, `zone`, `component` | Derived, written only by the placement and grouping jobs |
| `sighting_count` | int, default 0 |

- `ANCHOR_CHECK` (`backend/app/db/models.py:678`) gains a fourth branch: `anchor_kind = 'asset'`
  with `asset_model_id NOT NULL`, all image, map and cloud columns null, and `ax`, `ay`, `az` either
  all null or all set.
- `data_type` gains `asset_model`.
- The existing CHECK must be re-created through Alembic batch mode, as 0010 did. The migration is
  copy-first like every schema change since 0010.
- Indexes: `(anchor_kind, asset_model_id)` and `(asset_model_id, zone)`.
- `lon` and `lat` are filled from the frame origin when there is one, so the Overview's map pins
  keep working.

### 5.6 `finding_sighting` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | str(36) | |
| `finding_id` | FK finding, CASCADE | |
| `image_id` | FK image | |
| `annotation_id` | FK box, unique | Box, rbox, polygon or point on that image |
| `severity` | int, nullable | The sighting's own grade |
| `group_tag` | str, nullable | Kit `group`: forces sightings together |
| `placement` | str | `point` \| `patch` \| `none` \| `pending` |
| `cx`, `cy`, `cz`, `nx`, `ny`, `nz` | float, nullable | Hit point and normal |
| `part` | str, nullable | GLB node hit |
| `coverage` | float, nullable | Polygon area over the photo area |
| `patch_path` | str, nullable | `asset_models/<id>/placements/v<n>/<sighting>.bin` |
| `placed_version` | int, nullable | The model version the placement was computed on (staleness) |
| `created_at` | datetime | |

- The box row is still the geometry and is still counted by `image_summary`.
- Deleting the box deletes the sighting through `findings/annotations.py`, as today. A finding left
  with no sighting is closed, never silently deleted.

### 5.7 Derived files

`asset_models/<id>/placements/v<n>/` holds, per patch sighting:
- `<sighting>.bin`: little-endian Float32 positions, then uvs.
- `<sighting>.png`: texture with alpha, at most 512 px.
- `<sighting>.lbl`: uint8 label grid, at most 128 px, for pixel-exact picking.

Plus an `index.json`. All of these are rebuilt by the placement job and safe to delete.

### 5.8 `brand` (catalogue.db, catalogue migration 0004)

| Column | Notes |
| --- | --- |
| `id`, `name` | |
| `colors` | JSON: `{accent, accent_dark, navy, ink, pale, line}` (hex) |
| `font_text`, `font_numerals` | Paths to bundled or imported OFL TTFs, nullable (theme fonts if null) |
| `logo_on_light`, `logo_on_dark`, `logo_flat` | Report-asset ids, nullable |
| `website`, `owner`, `confidentiality`, `pdf_author` | `confidentiality` takes `{year}` and `{customer}` |
| `builtin` | bool |

- Built-ins seeded by 0004: **e&**, using the colours, Nunito Sans and Poppins (OFL, licence files
  shipped) from the kit's `brands/eand/brand.yaml`; and **White label** (Inter).
- The e& logos are customer-supplied: the operator imports them once through the brand editor.
  They are not committed (A10).
- `ReportConfig` gains `brand_id`, nullable (null = today's Kestrel theme). The theme fixture
  `contract/fixtures/report-theme.json` gains a `brand` overlay block, and the parity test covers
  it.

## 6. Jobs

All are background jobs on the existing runner, with progress, cancel and the restart sweep.

### 6.1 `asset_glb_import`

**Input:** a GLB path, an optional frame conversion, an optional geographic origin.

**Steps:**
1. Copy the file and hash it.
2. Parse the JSON chunk for nodes, names, extras and bounds. The binary chunk is copied, not
   decoded.
3. Check the file loads with trimesh. If it does not, the version is `failed` with the trimesh
   message.
4. Compute the silhouette and height.
5. Write a version with `kind = imported`.

**Bounded:** one file, streamed.

### 6.2 `asset_pose`

**Input:** an asset model and the images in scope.

**Two modes:**
- **`exif_gimbal`:** a port of kit `cameras.py` `pose`.
  - Flat-earth offset from the origin: X = dlat·R, Z = dlon·R·cos(lat), Y = alt minus ground
    altitude.
  - The view direction comes from gimbal yaw and pitch, and roll by Rodrigues about the view axis.
  - The target is the point on the view ray nearest the vertical axis.
  - The FOV comes from the 35 mm equivalent focal length, else focal length and sensor width, else
    70 degrees.
- **`exif_axis_aim`:** when there is no yaw, the camera aims at the asset axis.

It reads the pose columns already on `image` (migration 0011); no file is opened. Rows with
`source = kit` or `manual` are never overwritten.

### 6.3 `asset_place`

**Input:** an asset model version, and either all sightings or the dirty ones.

**Port of kit `project.py`:**
- **Rays:** the pinhole from position, target, up, hfov and vfov. A point (x, y) in normalised device
  coordinates gives direction f + x·tan(hfov/2)·r + y·tan(vfov/2)·u.
- **Ray casting:** trimesh `intersects_id`, first hit (rtree, embree when present).
- **Point placement:** the median-distance hit of a 5 by 5 grid in the central half of the box. The
  normal is the face normal, flipped toward the camera.
- **Patch placement:**
  - A `patch_grid` ray grid over the box. Adjacent hits form quads.
  - A quad is dropped when an edge exceeds 4 times the median step.
  - The patch is offset toward the camera by H·0.00025. UVs map back to the box crop.
  - The texture is the polygon filled in the type's severity colour over the photo crop. A box with
    no polygon gives a tinted box with a solid border.
- **Mixed:** a polygon sighting gives a patch, and a box-only sighting gives a pin.
- **`placement = none`:** when no ray hits.

**Derived fields per sighting:**
- `part`: the node name, through the profile's `component_map` when one is set.
- Height, bearing and side, from the profile (§7).

**Bounded:** one sighting at a time; the photo is read at preview size (2,048 px); the mesh is held
once.

### 6.4 `asset_group`

**Port of kit `records.py` lines 142 to 160:**
- Union-find over placed sightings of the same type: join when the 3D distance between centres is at
  most `cluster_m` (default max(0.75, 0.02·H)), or when the sightings share a `group_tag`.
- Unplaced sightings are singletons unless a tag joins them.
- A spatial hash keeps it O(n).

**Output:**
- **On first run:** creates findings ordered by placed first, then highest first, so new numbers read
  top-down.
- **On Regroup:**
  - A group that matches an existing finding's sightings exactly keeps that finding.
  - A merged group keeps the finding with the lowest number, and the others are closed with a
    comment naming the survivor.
  - A split creates new findings.
  - Status, notes, comments and attachments always stay with the surviving finding.

**Finding fields:**
- Severity is the maximum over its sightings, but only on creation. After that it is the operator's.
- The representative sighting (maximum severity, then placed, then largest coverage) gives the
  anchor point and the derived fields.

### 6.5 `review_kit_import`

**Input:** a kit job folder (`job.yaml`, `cameras.json`, `assessment.json`, `masks/`, optional
`merged.json`, `surface.json`, the GLB), an image source already imported in the project, and an
asset model to fill or create.

**Steps:**
1. **Profile and frame:** `job.yaml` and the profile name give `asset_model.frame` and `review`:
   zones, levels, silhouette, presets, line azimuth, basemap origin.
2. **Photos:**
   - Match kit photos to project images by `source_name` against `image.original_name`, then by
     capture time and size as a fallback.
   - Unmatched photos are listed in the job result; nothing is guessed.
3. **Poses:** `cameras.json` gives `image_pose` rows with `source = kit`.
4. **Review statuses:** `assessment.json` photo statuses give `image_review`.
5. **Sightings:**
   - **Region unit** (`findings[]`, DAMAC):
     - Each finding becomes a `box`: its polygon from `merged.json` when present, else its box.
       Coordinates are rescaled from the preview grid to the project image's pixels.
     - It also becomes a `finding_sighting` with severity, `group` and component.
     - Kit class keys map to catalogue types through a mapping the operator confirms before the job
       runs.
   - **Photo unit** (EBSM, no `findings[]`):
     - Each photo with status `finding` gets one sighting.
     - Its geometry is the vectorised mask: the class-index PNG becomes polygons, with
       Douglas-Peucker at 1.5 px and holes dropped.
6. **Placements:** with `surface.json` present, mode **replay** takes its placements as they are
   (points, patch geometry and textures) and marks them `placed_version = current`. Otherwise
   `asset_place` runs.
7. **Grouping:** `asset_group` runs.

**Bounded:** one photo and one mask at a time; `surface.json` (up to 20 MB) is streamed per patch
with ijson.

## 7. Review profiles

`backend/app/asset_review/profiles.py` holds five built-ins, ported from the kit's
`profiles/*.yaml`:

| Profile | Unit | Placement | Zones (fractions of H) | Sides |
| --- | --- | --- | --- | --- |
| `stack` | photo | patch | head 0.92 to 1, shaft 0.19 to 0.92, base 0 to 0.19 | compass, 8 points, from the hit bearing |
| `building_facade` | region | mixed, grid 14, cluster 1.5 m | roof, upper, middle, lower, podium (jobs replace with floors) | faces by surface normal relative to `line_azimuth_deg` |
| `tank` | region | patch | roof, shell, bottom | compass |
| `telecom_tower` | region | point | antenna, body, base | compass |
| `ohtl_tower` | region | point | peak, arms, body, legs | faces relative to the line azimuth |

**Rules:**
- **Bearing** = atan2(z, x) of the centre. With `basis: normal`, it comes from the normal when its
  horizontal part exceeds 0.3.
- **Height** = the centre's y. An unplaced sighting has **no height** (null); it never falls back to
  the camera's target height. This fixes the kit's 88.98 m on a 74.4 m building (plan R7).

Each profile also carries the report settings (pages per defect, minimum severity) and the
`limits` text for the report.

## 8. API

Contract first in `contract/openapi.yaml`, with the generated client committed in the same change.

| Operation | Notes |
| --- | --- |
| `POST /asset-models/{id}/versions:import-glb` | Starts `asset_glb_import` |
| `PATCH /asset-models/{id}` | Also `frame`, `review` (profile id or edited copy) |
| `GET /asset-models/{id}/poses` | Paged poses for the cameras layer: `[{image_id, position, target, up, hfov, vfov, sequence, outcome}]` |
| `POST /asset-models/{id}/poses:estimate` | Starts `asset_pose` |
| `PUT /asset-models/{id}/poses/{image_id}` | Manual pose |
| `GET /asset-models/{id}/placements` | Index for the version: `[{sighting_id, finding_id, kind, center, normal, size, severity, patch_url?}]`, paged |
| `GET /asset-models/{id}/placements/{sighting_id}/{mesh\|texture\|labels}` | Binary with ETag |
| `POST /asset-models/{id}/placements:compute` | Starts `asset_place`, then `asset_group` |
| `POST /asset-models/{id}/findings:regroup` | Starts `asset_group` |
| `POST /findings` | Accepts `anchor.kind = asset` with `{asset_model_id, sightings: [{image_id, box}]}` |
| `POST /findings/{id}:merge` | `{into: finding_id}` |
| `POST /findings/{id}:split` | `{sighting_ids}`; creates a finding from those sightings |
| `GET /findings/{id}/sightings` | |
| `GET`, `PUT /images/{id}/review` | Photo review status |
| `GET /findings` | Gains filters `asset_model_id`, `zone`, `side`, `component`, `placed`; sort keys `-height`, `zone` |
| `POST /review-imports` | Starts `review_kit_import`; a `dry_run` flag returns the class mapping and the photo match without writing |
| `GET`, `POST`, `PATCH`, `DELETE /brands` | |

`FindingOut` gains:
- the asset fields (`asset_model_id`, `height_m`, `bearing_deg`, `side`, `zone`, `component`,
  `placement`);
- `sighting_count`;
- `representative`: `{image_id, annotation_id}`.

## 9. UI

**Asset workspace** (on U7's rail). New topics:

**Findings:**
- The list with zone, side and height.
- Filters: severity, type, zone, side, placed.
- Focus button.
- Regroup.

**Photos:**
- Sequence filter, outcome colours, "include context photos".
- Cameras on or off; view cone.

**Engine additions** (`assetmodels/viewer/engine.ts`, not React):

| Method | What it does |
| --- | --- |
| `setPlacements(index)` | Patches as textured meshes (alphaTest 0.3, polygonOffset -4, renderOrder 3, pick through the label grid); pins as spheres held at about 6 px, lifted along the normal |
| `setCameras(poses)` | Wire pyramids; picking at 13 px screen distance |
| `focusFinding(id)` | Orthographic along the patch direction or pin normal, frustum and oblique angle from the profile |
| `setGhost(on)` | All model materials to opacity 0.25, depthWrite off |
| `setAutoRotate(on, speed)` | |
| `setGround(tiles)` | Basemap tiles from the existing proxy as a textured quad under the model, depthWrite off, renderOrder -10 |
| `viewFromPose(pose)` | The camera at the photo pose |

**Split inspection** (`/p/:id/asset-models/:modelId/inspect?finding=`):
- The asset stage on the left and the existing `ImageCanvas` on the right. The splitter runs 22 to 75%,
  is keyboard accessible, and is remembered per user.
- The right pane has three modes:
  - **Photo**;
  - **View from pose**;
  - **Model** (presets).
- **Overlay:** the finding polygons are filled with severity colours at an opacity slider value.
  "Hold to compare" (space) hides them.
- **HUD:** height, side and capture time.
- **Navigation:**
  - prev and next across the finding's sightings (arrow keys);
  - prev and next across findings (J/K, as the register does).

**Register** (`findings/FindingsScreen.tsx`):
- New columns: height, side, zone, component, sightings.
- An `asset` source chip.
- A **Gallery** mode: a virtualised grid of finding thumbnails from the representative sighting crop
  (`findings/thumbnails.py` already crops around the annotation).
- **Photo outcome chips:** Uncertain photos, No finding, All photos. These open the image browser
  filtered by `image_review.status`.

**Overview:**
- An asset hero: the live GLB auto-rotating, at the same size and with the same static fallback as
  `CloudPreview.tsx`.
- An **asset findings map** card.
- The outcome bar.

**Asset findings map** (`assetmodels/findingsMap/`):
- One SVG component. x is the side (compass bearings 0 to 360, or face labels); y is height.
- It draws the silhouette, levels and zone bands. Dots are coloured by severity.
- Hovering shows a tip; clicking opens the finding.
- The same geometry is computed by `backend/app/asset_review/findings_map.py` for the report. A
  shared fixture `contract/fixtures/asset-findings-map.json` pins both (the parity pattern of
  `report-theme.json`).

**Brand editor** (Settings, Reports section): name, colours, fonts, three logos and the text fields,
with a live cover preview.

Everything uses `frontend/src/ui` primitives and passes `check-tokens`. Severity colours are data
colours passed as `--c`.

## 10. Report

| Addition | Detail |
| --- | --- |
| Section `asset_summary` | Tiles (findings, by severity, sightings, uncertain photos), the findings map, and zone and side breakdown tables |
| `finding_pages` for asset findings | Kicker "Finding F-0042 · Level 07 · West elevation · seen in 3 photos". The page shows: the photo with the polygon overlay; a close-up crop; a 3D locator (A9: the rasterizer, orthographic along the normal, pin or patch outline in the severity colour); an SVG height locator on the silhouette; the facts table (profile `facts` order); the note |
| `finding_pages` option `min_severity` | DAMAC prints severity 2 and above; the register lists all |
| `findings_table` columns | `zone`, `side`, `height`, `sightings` added to `FindingsTableColumn` |
| CSV layout `asset_sightings` | The kit's 21 columns in order, UTF-8 with BOM, CRLF, RFC 4180, then photos without findings with empty ids (kit `records.csv_text`) |
| Brand | Cover colours and logo, header logo, footer website and confidentiality line replace the hard-coded footer (`backend/app/reports/pdf/canvas.py:80`), with brand fonts |

New report tests cover:
- the PDF rules the kit enforced: no em or en dashes in text, zero `/SMask` objects, fonts
  embedded;
- `qpdf --check` when qpdf is present; skipped, not failed, otherwise.

## 11. Budget and execution DAG

**Background jobs:** `asset_glb_import`, `asset_pose`, `asset_place`, `asset_group`,
`review_kit_import`, `report_render` (existing).

**Bounded reads:**
- Placement reads one photo at preview size and one mesh.
- Import reads one photo, one mask and one patch at a time.
- The placements index is paged.
- Patch binaries are fetched per visible patch.
- The register stays keyset-paged.

**Expected sizes:**

| Job | Sightings | Photos | Placements | Target time |
| --- | --- | --- | --- | --- |
| DAMAC | 1,441 | 4,538 | 715 patch files of at most 64 KB | `asset_place` under 5 min on this PC |
| EBSM | 78 | 299 | 78 patches | |

**Units:**

| Unit | Content | Depends on |
| --- | --- | --- |
| **C0** | Contract: all §8 operations as 501 stubs, schemas, generated client | none |
| **D1** | Migration 0016 (§5.1 to §5.6) and models | C0 |
| **D2** | Catalogue 0004 `brand`, brand API, theme overlay and parity | C0 |
| **P1** | Profiles, derivation rules (height, bearing, side, zone), findings map geometry and fixture | C0 |
| **J1** | `asset_glb_import` and frame | D1 |
| **J2** | `asset_pose` | D1, P1 |
| **J3** | `asset_place` (needs a model and poses to test) | J1, J2 |
| **J4** | `asset_group`, merge, split, regroup rules, finding service changes | D1, P1 |
| **J5** | `review_kit_import` (dry run, replay mode, vectorising) | J3, J4 |
| **U1** | Engine additions (placements, cameras, focus, ghost, auto-rotate, ground, view from pose) | C0 (fake data) |
| **U2** | Asset workspace topics (Findings, Photos) | U1 |
| **U3** | Split inspection with overlay and hold-to-compare | U1 |
| **U4** | Register columns, asset source, gallery, outcome chips | C0 |
| **U5** | Overview asset hero and findings map card | U1, P1 |
| **U6** | Brand editor | D2 |
| **R1** | Report sections, rasterizer locator, CSV layout, brand in PDF | D2, P1, J4 |
| **X** | Close-out: synthetic end-to-end, DAMAC and EBSM acceptance runs, evidence | all |

**Parallel batches:**
1. C0.
2. D1, D2, P1, U1, U4, in parallel.
3. J1, J2, J4, U2, U3, U5, U6, in parallel.
4. J3, R1.
5. J5.
6. X.

**Critical path:** C0 → D1 → J1/J2 → J3 → J5 → X.

## 12. Testing and acceptance

**Unit and contract** (pytest, vitest):
- **Frame conversion:** a golden test per converter.
- **Poses:** against kit `cameras.py` on hand-written EXIF records (yaw, pitch, roll, no-yaw axis
  aim, FOV fallbacks).
- **Placement** on the kit's **synthetic tower** (`examples/synthetic-tower`, generated at test time
  from its script, not customer data). Every truth finding is placed within 0.25 m of its truth
  point, and the side and zone match.
- **Grouping:**
  - union-find cases: chain, tag join, unplaced singleton;
  - Regroup keeps numbers, statuses and comments by the rules in §6.4.
- **Kit import:**
  - a hand-made three-photo kit folder in both units, with a mask PNG drawn in the test;
  - dry-run mapping;
  - unmatched photos reported.
- **CHECK constraint:** every anchor kind accepted, every mixed state rejected.
- **CSV:** byte-exact against a fixture.
- **Findings map:** parity between TS and Python on the shared fixture.
- **Engine:** pure functions tested (pin scale, focus frustum, label-grid picking); WebGL faked as
  today.

**e2e (Playwright on Prism):**
- asset workspace topics;
- split inspection with hold-to-compare;
- register gallery and filters;
- brand editor preview.

**Acceptance (the operator's data, read-only, numbers recorded in
`docs/evidence/asset-findings/`):**
1. **DAMAC, replay mode.** Import `_rebuild\job\` with its GLB and `surface.json`:
   - **656 findings: 182 at severity 2 and 474 at severity 1**;
   - 1,441 sightings; 715 patch and 625 point placements; 101 unplaced;
   - 45 uncertain photos;
   - the sightings CSV matches the kit CSV's rows on `finding_id` to `defect_id` grouping, class,
     severity, placement and side.
2. **DAMAC, recompute mode.** Re-run `asset_place`, then `asset_group`, on the imported poses:
   - patch, point and none counts each within 2% of the replay;
   - at least 98% of sightings get the same placement kind;
   - the finding count within 2% of 656;
   - median centre distance to the replay at most 0.10 m.
3. **EBSM, replay mode:** 78 findings (77 at severity 2, 1 at severity 1); 53 uncertain, 159 none, 9
   not assessed; 78 patches.
4. **A report** for each, with brand e&, renders. DAMAC prints one page per moderate finding plus
   the register. The PDF rules in §10 pass.
5. **Operator walkthrough** on the installed build (numbered steps written at close-out).

**Gate:** the full AGENTS.md gate on every unit.

## 13. Risks

- **Phase 0 slips.** U1 to U3 sit on code that is still on `task/am-u6`. Mitigation: C0, the D, J
  and P units, U4 and U6 do not touch the engine and can run first.
- **Recompute against replay drift.** The kit cast rays on the same GLB, but its patch textures came
  from raster masks and ours come from polygons. The acceptance bands in §12 allow for it. If drift
  is larger, the replay result stands as the reference and the gap is reported, not hidden.
- **Vectorising EBSM masks** loses hairline edges (plan Q3). The source PNGs are kept as finding
  attachments on import, so nothing is lost for the customer.
- **trimesh ray speed on Windows without embree.** If `asset_place` exceeds the 5-minute target on
  DAMAC, it batches rays per photo (one `intersects_id` call per photo grid), which is the documented
  fast path.
- **Grouping with operator edits** is the subtlest rule in the spec (§6.4). It gets its own review
  focus at close-out.
