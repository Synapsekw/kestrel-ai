# From six review artifacts to Kestrel AI: study and plan

Status: accepted by the operator 2026-10-02 (decisions in §9.2). No application code has changed.

Sources: the reference pack (`C:\Users\D\Claude_Workspace\outputs\Kestrel AI Reference Pack\`), the live
job folders on this PC and the NAS (read-only), and this repo at `main` `31a1a5ab` plus the unmerged
`task/am-u5`, `task/am-u6` and `task/workspace-rail` worktrees.

---

## 0. The short version

- The six artifacts are one product: **an asset or site review**. It has a model of the thing
  inspected, media with known poses (photos, video, LiDAR), findings anchored on that model, and the
  same numbers shown on a summary page, in a register, in a CSV and in a branded PDF. Three
  variants hang off that core: 3D asset (tank, flare stack, facade, plant), 2D linear asset (road),
  and 2.5D surface (stockpiles).
- Kestrel already has most of the plumbing:
  - one `Finding` entity with severity, status, attachments and comments;
  - posed photos;
  - tiled orthos, point clouds and surfaces;
  - a strong volume engine;
  - drawings with georeferencing;
  - reports as versioned background jobs;
  - asset models (M1, partly merged).

  The gaps are specific:
  - **findings anchored on a 3D asset model** (the heart of EBSM, DAMAC and the tank);
  - **sightings grouped into defects**;
  - **mask overlays**;
  - **video and flight playback**;
  - **PCI**;
  - **automatic stockpile segmentation**;
  - **an imported plant register**;
  - **per-client brands**;
  - **the offline review package**.
- **Recommended first slice: "findings on the asset", proven on DAMAC.** It merges the
  confined-space programme's M4 with the Asset Inspection Kit's back-projection and grouping, so the
  tank, the flare and the facade share one anchor model. DAMAC beats EBSM as the acceptance job
  because it exercises the whole automated chain:
  1. gimbal poses
  2. back-projection
  3. pins and patches
  4. grouping

  EBSM's placement was anchored by hand and its detection scripts are not in the pack, so it can only
  be imported, not reproduced. EBSM comes in the same slice as an import fixture.
- Your instinct holds for the core. I would change the order after it: the **offline review package
  is phase 2**, because every later vertical has to export through it, and it fixes the one
  architectural seam (how a viewer gets its data) that is expensive to retrofit. **Road and
  volumetrics are independent** of each other and can run as one parallel batch; if they must be
  serial, road first, because PCI is missing entirely while volumes already exist.

---

## 1. The six artifacts

### 1.1 HCl Tank 710-D-130335 (KOC, Elios 3 confined space)

**What the customer gets**
- The tank, rebuilt procedurally from the GA drawing. Every course, seam, nozzle and manhole is a
  selectable part with metadata.
- All ten Elios 3 flights replayed inside it:
  - the drone at true scale on its logged path;
  - video synced to the flight log, projected onto the wall through an f-theta fisheye model;
  - a drone's-eye camera;
  - each flight's LiDAR as an overlay.
- Eleven findings from the KOC observation report, pinned where each photo's line of sight meets the
  tank and linked to their photo, video moment and report page.
- A 16-page PDF and a CSV.

**How it was built**
- Each flight's SLAM map was fitted to the tank: a cylinder fit, the floor height, and a heading from
  the two dip pipes. Scale was fixed at 1.0074.
- Placement was checked with 370 POIs: ray-cast distance against the rangefinder, median 110 mm.
- Pipeline: `proc.py`, `align_pipes.py`, `align_all.py`, `align_flight.py`, `clouds.py`,
  `build_model.py` and `make.py` (in `app\source.zip`).
- **There is no geolocation.** The frame is the tank frame: Y up, X plant north, Z plant east. True
  north (23 degrees) is recorded but never applied.
- **Fixture:** 11 findings, F01 to F11, severity 3 to 5 (F01 bottom-plate crack, severity 5); 396
  POIs over 10 flights.

### 1.2 1st Ring Road Survey (MPW Kuwait)

**What the customer gets**
- A 7.55 km road review on a 1.25 cm orthomosaic (two BigTIFFs, 34 GB, UTM 38N).
- 2,115 pavement defect polygons in 10 types, each with a native-resolution close-up.
- A defect-density grid (10, 20 or 50 m cells; count or percent of pavement).
- An ASTM D6433 PCI per 15 m sample unit. It is computed three times (all Low, all Medium, all High),
  because severity cannot be measured from a 2D image.
- A click-to-zoom "Area" pane, chainage, a measure tool, and CSV and GeoJSON exports.

**How it was built**
- **The defect polygons are a hand-made ArcGIS deliverable. No model drew them.**
- The "stages" (Few, Intermediate, Extensive) are a polygon's share of its cluster area, not severity.
- Pipeline (in `_build\`): `tiler.py` (tifffile, no GDAL), `tile_index.py`, `basemap.py` (its own OSM
  renderer), `closeups.py` and `pci\grid_pci.py`.
- **Fixtures:**
  - 2,115 defects (Few 1,896, Intermediate 190, Extensive 29);
  - 30,068.8 m2 of defects on 420,493.8 m2 of pavement;
  - 1,783 sample units;
  - network PCI 94.8 / 87.6 / 77.5 (shown as 95 / 88 / 78);
  - unit classes at Medium: Good 1,183, Satisfactory 470, Fair 92, Poor 31, Very Poor 7.

### 1.3 EBSM Flare Inspection (EQUATE)

**What the customer gets**
- The kit's reference job: an 80 m flare stack photographed in 2019 with 299 photos.
- 78 photos carry candidate corrosion (77 moderate, 1 light). Each has a pixel class mask, a textured
  patch on a procedural Blender model of the stack, and a page in an 88-page PDF.
- Summary hero with the live auto-rotating stack.
- A height-by-bearing findings map drawn over the real shell silhouette.
- Zone and component breakdowns.
- A photo-first split view with mask overlay, opacity and hold-to-compare.

**How it was built**
- `finding_unit: photo`: one finding per photo.
- Poses come from EXIF GPS aimed at the stack axis (2.26 m median lateral error).
- **The patches are manually anchored to components.** They were not back-projected.
- **The detection was:**
  1. Claude triage polygons;
  2. a colour classifier;
  3. SAM 2.1 used as a background gate.

  Those scripts are not in `_rebuild`.
- **Fixtures:** 299 photos, 78 findings, 53 uncertain, 159 none, 9 not assessed, 897 mask layers, 78
  patches, 88 PDF pages.

### 1.4 DAMAC Hills residential tower facade

**What the customer gets**
- A 74 m, 15-floor tower, reviewed from 4,538 photos: P1 at 50 mm and 35 mm, and H20T thermal, wide
  and zoom.
- 1,441 boxed sightings, about half with polygons, grouped into **656 defects (182 moderate, 474
  minor)**. `SOURCES.md`'s 643/166/477 is stale; the HTML, the CSV and `START HERE.txt` all say 656.
- Sightings sit on a lightweight tower model as 715 patches and 625 pins (101 not placed), over a
  Mapbox dark street map.
- The summary is organised by floor (17 zones on a 3.40 m rhythm) and by elevation (faces by surface
  normal relative to 340.5 degrees).
- A 206-page PDF with one page per moderate defect.
- A portrait kiosk mode.

**How it was built**
- Poses: EXIF GPS, barometric altitude and gimbal XMP. Metashape was used only for the point cloud.
- Model: `build_model.py` (trimesh extrusion of point-cloud outlines).
- Detection: 16 parallel Claude reviewers over 787 contact sheets.
- Kit back-projection, then grouping by union-find (same class, within 1.5 m, or the same `group`
  tag).
- **Fixtures:** the counts above, plus by class `defect_class.all`: staining 211, soiling 196,
  cladding 155, object 34, sealant 31, corrosion 14, thermal 8, water 6, glazing 1.

### 1.5 Masafi Stockpile Review (two-date volumetrics)

**What the customer gets**
- An aggregate yard surveyed with Pix4D on 31 Dec 2020 and 10 Jan 2021 (1.69 cm GSD, UTM 39N).
- 19 piles segmented automatically on the envelope of both dates, so each pile keeps its ID and zone
  across dates.
- Volumes under four base methods: lowest toe, average toe, toe plane, and the "triangulated toe".
  The triangulated toe is actually a harmonic membrane solved with sparse Laplace, not a TIN.
- One three.js scene with lifted volume bodies, cut and fill bodies, sections and hover elevations.
- A per-point toe-line editor with live volume on 10 cm cells, edits persisted.
- A 26-page PDF.

**How it was built**
- Pipeline (in `build\`): `resample.py`, `pyramid.py`, `process.py`, `package.py`, `pack3d.py`,
  `build_viewer.py` and `report.py`.
- **Fixtures:**
  - triangulated toe base: 76,199.4 m3 (31 Dec) and 63,402.1 m3 (10 Jan); change -12,797.3;
  - inside pile zones: cut 22,597.7, fill 1,226.9;
  - whole yard: cut 24,297.1, fill 2,098.8;
  - lowest-toe base on 31 Dec: 99,295.5;
  - P02 on 31 Dec: 14,686.7.
- **Trap:** the browser editor's membrane differs from the Python one (SOR pinned on all outside
  ground, against an exact solve pinned on floor-touching toe cells). An untouched edited line can
  therefore read a few percent high (P16: 7,741 against 7,209).

### 1.6 KIPIC Al-Zour LNG plant model

**What the customer gets**
- The whole terminal modelled from four as-built plot plans: 885 items, 404 tagged, one glTF node
  per item.
- Each item carries tag, type, area, plant and UTM coordinates, footprint, elevation and a height
  source in `extras`. About 93% of heights are indicative.
- Camera presets, a plot-plan overlay, see-through, search and a click-to-select data panel.
- 25 Mavic 3 Cine videos placed and tracked on the plant from DJI `djmd` telemetry, with drape
  projection onto the ground.
- A local v1.4 adds a Mapbox street base and photos and panoramas at their poses.

**How it was built**
- **The model generator is not on this PC.** Only the GLB extras and the register CSV survive.
- **Frame:** X plant east, -Z plant north. **This is the opposite convention to the kit and the
  tank.** Plant grid origin UTM39 (244338.089, 3179515.690), rotated 17.9991 degrees.
- **Fixtures:**
  - 885 register rows: 824 indicative heights, 61 from the drawing;
  - 25 videos, 1,755.9 s.
- **Known bugs:**
  - two clips (DJI_0789, DJI_0794) are 60 fps but were parsed at 50 fps, so they are about 20% out
    of sync;
  - `video_pose.py` and the published tracks disagree on yaw (gimbal against drone);
  - take-off elevation is a placeholder (EL 100).

---

## 2. Product behaviour and packaging

Each item below was a workaround for the claude.ai static host or for `file://`. None of them is a
product feature.

| Workaround | Where | Kestrel instead |
| --- | --- | --- |
| Binaries as base64 `.txt` chunks, content-hashed, under 8 to 9 MB each | kit `viewer.py` `Out`, HCl clouds | Binary endpoints with HTTP Range from the sidecar |
| gzip plus `DecompressionStream` | kit `ui.js` `getData`, KIPIC `loadZipGlb` | HTTP compression or none (GLB with meshopt) |
| Tile packs renamed `.wasm`, pack index | Road `pack.py` | Site tile grid already served (`workspace/tiles.py`) |
| Mask and photo packs with `[pack, offset, len]` index | kit `viewer.py` | One file per mask or photo, served by id |
| Data through `<script>` tags (`__kitData`, `window.RR_DATA`, `VS_*`) | all six | API JSON. **Still needed in the offline package**, see §6 |
| Textures as data URIs, because WebGL refuses `file://` images | Masafi, kit | Real image URLs. **Still needed offline** |
| Store-only ZIP written in the browser | kit, HCl, KIPIC | The server writes the ZIP, or none is needed |
| `window.claude.use('downloads' / 'db')` | kit, Masafi edits | Native save dialog; edits stored in `project.db` |
| 60 s video segments, two `<video>` double buffer | HCl `SegPlayer` | One faststart proxy per flight with Range |
| pdf.js from cdnjs | kit, HCl, Masafi | Vendored pdf.js (the app CSP blocks CDNs anyway) |
| Pre-stitched, tinted Mapbox static tiles | DAMAC `basemap.py` | The existing basemap proxy (`backend/app/basemap/`) |
| `photos: findings`, 1,024 px repack, 15 MB caps | DAMAC artifact | All photos at 2,048 px preview plus original on demand (exists) |
| Resumable 150 to 170 s steps, `/home/claude` paths | every `_build` | Background jobs with progress and cancel (exists) |
| Kiosk CSS zoom maths | DAMAC | Keep kiosk as a layout of the exported review only |

**Real behaviour to keep:**
- one source of numbers, so the page, CSV and PDF always agree (kit `records.py`, Masafi
  `package.py`);
- severity colours are data colours that match the masks, and brand colours are chrome only;
- the asset frame: Y up, metres, X north, Z east;
- deep links (`#F12`, `#P07`, `#inspect/<fid>`);
- "hold to compare";
- the per-finding PDF page;
- the "draft, visual assessment" honesty labels;
- the narrative templates with count tokens.

---

## 3. The shared product underneath

| Building block | What it is | Used by |
| --- | --- | --- |
| **B1 Asset stage** | GLB in a local metric frame; presets, fit/reset, see-through, wireframe, cut, levels, auto-rotate; geolocated ground under it | HCl, EBSM, DAMAC, KIPIC, (Masafi terrain) |
| **B2 Posed media** | Photos (and video frames, POIs) with a pose in the asset frame; camera glyphs, view cone, "3D view" from the pose | all 3D ones |
| **B3 Asset findings** | A finding anchored on the model (point and normal), with height, bearing or side, zone and component derived; pins and textured patches | HCl, EBSM, DAMAC |
| **B4 Sightings to defects** | Several sightings of one defect grouped by class and distance or a tag | DAMAC (EBSM, HCl implicitly) |
| **B5 Photo inspector** | Pan/zoom, box and mask overlays, opacity, hold-to-compare, HUD, prev/next | EBSM, DAMAC, HCl, Road close-ups |
| **B6 Register and gallery** | Filter chips, search, sort, gallery or table, CSV with fixed columns | all six |
| **B7 Summary landing** | Navy hero with a live auto-rotating model or map, count-up figures, outcome bar, findings map, breakdowns, limits, files | all six |
| **B8 Findings map** | Height by bearing (stack), floors by elevation (facade), shell development plus roof/bottom plans (tank), chainage bars (road), plan (yard) | per vertical |
| **B9 2D site review** | Tiled ortho, polygons, density grid, PCI by sample unit, chainage, measure | Road |
| **B10 Volumetrics** | Two dates, pile identity on the envelope, four bases, cut/fill, editable toe line with live recompute, 3D bodies | Masafi |
| **B11 Flight playback** | Trajectory, synced video, drone marker and frustum, drone's-eye view, LiDAR per flight, video projected onto the asset | HCl, KIPIC |
| **B12 Asset register** | One node per tagged item with metadata, search, plot-plan overlay | KIPIC (HCl nozzle schedule) |
| **B13 Profiles** | Per-vertical classes, severity words, zones, sides, finding unit, placement, report options | kit: stack, telecom, OHTL, tank, facade |
| **B14 Brand kits** | Colours, fonts, logos, footer, confidentiality text | e&, white label |
| **B15 Report** | Cover, summary, register, one page per finding or defect, appendices; flattened, linearised | all six |
| **B16 Deliverable** | Hosted review plus an offline folder opened by double-click | all six |

---

## 4. Capability matrix

Legend for the artifact columns: **●** central to that artifact, **○** present but minor, blank means
absent.

Kestrel status:
- **E** exists on `main`;
- **P** partial;
- **M** missing;
- **B** on an unmerged branch.

| Capability | HCl | Road | EBSM | DAMAC | Masafi | KIPIC | Kestrel today |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| GLB asset model in a local metric frame | ● |  | ● | ● |  | ● | **P/B**. Spec-built GLB with part extras: `backend/app/asset_models/build.py`. Viewer engine on `task/am-u6`: `frontend/src/assetmodels/viewer/engine.ts`. No import of an existing GLB |
| Camera presets, fit, reset | ● |  | ● | ● | ● | ● | **E** for clouds: `frontend/src/clouds/viewer/engine.ts` `setView`, `goToPose`. **B** for GLB |
| See-through, wireframe, cut | ● |  | ○ |  |  | ● | **P**. Cloud clip box: `clouds/viewer/clipBox.ts`. am-u6 cut plane, head-off. No ghost opacity |
| Auto-rotate hero | ○ | ○ | ● | ● | ● |  | **P**. Live cloud hero: `overview/CloudPreview.tsx`. `scriptOrbit` exists but is not wired |
| Street basemap under 3D or map |  | ● | ○ | ● |  | ○ | **P**. Overview pane only: `overview/SiteLocation.tsx`, proxy `backend/app/basemap/` |
| Photos with poses | ● |  | ● | ● |  | ○ | **E** in geo terms: `image` pose columns (`db/models.py` around l.101 to 119). **M** in an asset frame |
| Photo linked to 3D, view from pose | ● |  | ● | ● |  | ○ | **E** for clouds: `clouds/cameras/*`, `viewer/lookThrough.ts`. **M** for a mesh |
| Box overlays on photos |  |  | ○ | ● |  |  | **E**. `images/canvas/ShapeLayer.tsx` |
| Mask overlays, opacity, hold to compare |  | ○ | ● | ● |  |  | **M**. Polygons only (SAM): `images/ai/sam/*` |
| Findings: severity, status, notes, attachments | ● | ● | ● | ● |  |  | **E**. `finding` (`db/models.py` l.691), `findings/*` |
| Finding anchored on the asset model (pin, patch) | ● |  | ● | ● |  |  | **M**. Anchors are image, map or cloud only (CHECK at `db/models.py` l.678 to 688). Planned as M4 |
| Height, bearing, side, zone, component on a finding | ● |  | ● | ● |  |  | **M**. A finding has only lon/lat; site areas are separate |
| Sightings grouped into defects |  |  | ○ | ● |  |  | **M** |
| Photo review status (finding, none, uncertain, not assessed) |  |  | ● | ● |  |  | **P**. Only `image.marked_empty` |
| Register, filters, search, sort | ● | ● | ● | ● | ● | ● | **E**. `findings/FindingsScreen.tsx`, `findings/filters.ts` |
| Findings gallery | ○ | ● | ● | ● |  |  | **M**. Table thumbnails only |
| CSV export | ● | ● | ● | ● | ● | ● | **E**. `backend/app/reports/writers/csv_out.py`. Kit column set not matched |
| Tiled ortho |  | ● |  |  | ○ | ○ | **E**. Site tile grid: `backend/app/workspace/tiles.py`, `mapws/` |
| Defect polygons on a map |  | ● |  |  |  |  | **P**. Hand-drawn map findings (GeoJSON Polygon). No polygon detections (`map_detection` is a box). No shapefile import |
| Density grid |  | ● |  |  |  |  | **P**. Only a scaling aid: `mapws/detect/DetectionMount.tsx` |
| PCI, ASTM D6433 |  | ● |  |  |  |  | **M** |
| Chainage, centreline |  | ● |  |  |  |  | **M** |
| Measure tool |  | ● |  |  | ○ |  | **E**. `mapws/tools/*`, `clouds/measuring/*` |
| DSM from survey, DEM import |  |  |  |  | ● |  | **E**. `surfaces/build.py`, `elevation_import` |
| Volume with base methods |  |  |  |  | ● |  | **E**. `volumes/engine.py`: toe_plane, toe_surface, flat, surface, toe_lowest. No average toe, no membrane |
| Two-date cut/fill |  |  |  |  | ● |  | **E**. Base kind `surface`, `alignment.py`, diff tiles |
| Editable toe line with recompute |  |  |  |  | ● |  | **E** in 2D. Polygon PATCH plus recalculate; `mapws/volume/VolumeMount.tsx`. Not live in the browser |
| Automatic pile segmentation, pile identity across dates |  |  |  |  | ● |  | **M** |
| 3D volume bodies scene |  |  |  |  | ● |  | **M** |
| Flight trajectory and playback | ● |  |  |  |  | ● | **M**. Planned as M2 |
| Synced video, drone's-eye view | ● |  |  |  |  | ● | **M**. `VIDEO_IMPORT_ENABLED = False` (`backend/app/setup/classify.py`) |
| LiDAR per flight | ● |  |  |  |  |  | **P**. Point clouds exist (Potree). No flight link or registration (M3) |
| Video projected onto the model or ground | ● |  |  |  |  | ● | **M**. Planned as M6 |
| Plant register from GLB extras, search | ○ |  |  |  |  | ● | **M**. The GLB writer emits extras; nothing reads an imported GLB |
| Plot-plan overlay | ○ |  |  |  |  | ● | **E** in 2D. Drawings with georef: `backend/app/drawings/*`. **M** in 3D |
| Summary landing with key figures | ● | ● | ● | ● | ● | ● | **E**. `overview/OverviewScreen.tsx` |
| Vertical findings map (height by bearing etc.) | ● | ● | ● | ● |  |  | **M** |
| In-page PDF viewer | ● | ○ | ● | ● | ● |  | **M**. Opens with `os.startfile` |
| Branded A4 PDF | ● | ● | ● | ● | ● |  | **P**. reportlab report jobs exist (`backend/app/reports/*`). Brand is fixed: footer hard-coded at `reports/pdf/canvas.py:80`; per-client themes deferred (reports spec §20) |
| One page per finding or defect, with 3D snapshot | ● |  | ● | ● | ○ |  | **P**. Per-finding pages exist. No asset 3D snapshot or defect grouping |
| Vertical profiles | ○ |  | ● | ● |  |  | **P**. Project templates seed types and slots (`backend/app/setup/builtins.py`). No zones, sides or placement rules |
| Brand kits |  | ● | ● | ● | ● | ● | **M** |
| Offline double-click deliverable | ● | ● | ● | ● | ● | ● | **M**. Only the HTML contact sheet (`backend/app/exports/html_out.py`). Planned as M6 |
| Hosted review | ● | ● | ● | ● | ● | ● | **M** |
| Kiosk, tall layout |  |  |  | ● |  |  | **M** |

---

## 5. Data model changes

These follow the house rules: contract first, migration IDs reserved up front, and app-wide things
in `catalogue.db`. Names are proposals.

### 5.1 Asset findings (B3, B4): the core

1. **`finding.anchor_kind = 'asset'`.** Columns:
   - `asset_model_id`, `asset_version`;
   - `asset_part` (GLB node);
   - `ax, ay, az` and normal `anx, any, anz`, in the asset frame.

   Extend the CHECK constraint.
   - **Derived and stored**, recomputed by a job and never hand-typed: `height_m`, `bearing_deg`,
     `side`, `zone_id`, `component`.
   - **Placement:** `point | patch | none`.
2. **`finding_sighting`**, the evidence for a finding. Each row is one of:
   - `image_id + annotation_id` (box or polygon);
   - `video_id + t`;
   - a POI.

   Each row has its own placement: hit point, patch file ref and coverage. In the register, a
   Kestrel finding is **a defect**, and its sightings are the photos. DAMAC's 1,441 sightings become
   656 findings. Today's image anchor is the one-sighting case, so existing data migrates as one
   sighting per finding. See question Q1.
3. **`image_review`**, per image and per review scope:
   - `status` finding, none, uncertain or not_assessed;
   - `note`, `coverage`, `uncertain_coverage`.

   This replaces the overloaded `marked_empty`, which stays as a computed view for the
   training-data path.
4. **Masks.** Keep polygons as the stored truth: Kestrel's existing `box.shape = polygon`, already
   trained as YOLO-seg. Kit class-index PNGs are imported by vectorising them. The rendered overlay
   and the patch texture are **derived cache files**: `cache/overlays/<image>.png` and
   `asset_models/<id>/placements/v<n>/`. See question Q3 on raster masks.
5. **`asset_zone`**, per asset model: `label`, `min_m`, `max_m` (height bands), or a polygon for plan
   zones. Plus `asset_frame` metadata on the asset model:
   - geographic origin (lat, lon, ground altitude);
   - north offset;
   - `line_azimuth_deg`;
   - `silhouette`, `levels` and `presets`.

   M1's frame (Y up, X plant north, Z plant east) is the canonical one. KIPIC's X-east/-Z-north scene
   is converted on import.
6. **`image_pose`**, the pose of a photo in an asset frame. One row per (image, asset model):
   - position, target and up, or a quaternion;
   - hfov, vfov and optional intrinsics;
   - `source`: exif_gimbal, exif_axis_aim, metashape, pix4d, fitted or manual;
   - `accuracy_m`.

   The geo pose stays on `image`.

### 5.2 Profiles and brands (B13, B14), in `catalogue.db`

7. **Profile fields on `project_template`**, which is already the vertical mechanism after F5 removed
   project kinds:
   - `finding_unit` (photo or region), `placement` (patch, point, mixed or none);
   - `cluster_m`, `patch_grid`;
   - `zones` as fractions;
   - `sides` (compass, faces by azimuth, faces by normal);
   - `breakdowns`, `ranking`, `limits`, `facts`;
   - `report` options: pages per defect and minimum severity.

   Kit profiles ship as built-in templates: stack, telecom tower, OHTL tower, tank, building facade,
   plus road and stockpile.
8. **`brand`**: colours (accent, navy and the rest, as in `brand.yaml`), text and numeral fonts (OFL
   files), logos (on light, on dark, flat), website, owner, confidentiality template, PDF author.
   Each report and each review export picks a brand, and the theme fixture gains a brand overlay. The
   built-ins are **e&** and **White label**. Kestrel violet stays the app chrome.

### 5.3 2D road (B9)

9. **Vector import** (shapefile, GeoJSON, GPKG) into **map findings** with polygon anchors. Type
   mapping goes through the catalogue. The source FID is kept as `external_id`.
10. **`alignment`**: a centreline polyline in the site CRS with a chainage origin. Each finding gets
    a derived `chainage_m` and `offset_m`.
11. **`pci_run`**:
    - parameters: unit size, minimum area, deduct-curve set and version, severity assumption;
    - a `results` file of units with cells, PCI at L/M/H and top deducts;
    - section and network roll-ups.

    Density grids are computed on request from the findings and cached, with no table.

### 5.4 Volumetrics (B10)

12. **`stockpile`**: a pile identity across surveys, with a zone polygon segmented on the envelope.
    Each survey keeps one `volume_measurement` row linked by `stockpile_id`. A new
    `boundary_origin` field records auto or edited.
13. **Base kinds**:
    - add `toe_average`;
    - add `toe_membrane` (the Masafi Laplace solve, pinned on floor-touching toe cells);
    - keep `toe_surface` (TIN).

    The browser preview and the server must use **one** membrane algorithm. See risk R6.

### 5.5 Flights and video (B11): the M2 data model, written for both Elios and DJI

14. **`video`**: source path, duration, fps (read, never assumed), resolution, proxy path, lens model
    (pinhole or f-theta, hfov).
15. **`flight`**:
    - kind (elios, dji);
    - source folder;
    - `video_offset`;
    - a samples file (t, position, camera quaternion, body quaternion, servo or gimbal) stored as
      binary in the project folder, not as rows;
    - its registration to an asset model or the site CRS (M3);
    - an optional linked `point_cloud`.
16. **`poi`**: flight, time, image, rangefinder distance, criticality, comment. A POI can become a
    finding sighting.

### 5.6 Plant register (B12)

17. **`asset_item`**:
    - `asset_model_id`, `node`, `tag`, `name`, `type`, `area`/`group`;
    - plant and UTM coordinates, `base_el`, `height_m`, `height_source`, `footprint`;
    - `source_sheet`, `extras`.

    Rows come from GLB extras or a CSV, and are indexed for search. An asset model then has two
    sources: **spec-built** (M1) or **imported GLB**, which is a new version kind.

### 5.7 Deliverables (B16)

18. **`review_export`**, versioned like `report_version`:
    - scope (which items, findings and report version);
    - brand, target (offline or hosted);
    - state, a folder `exports/reviews/<id>/vNNN/`;
    - a files manifest, stats, issued_at.

---

## 6. Processing jobs

Every one of these is a background job with progress and cancel (AGENTS.md invariant). None loads a
full image set or a full raster into memory.

| Job | What it does | Ports or replaces | Bounded how |
| --- | --- | --- | --- |
| `review_kit_import` | Imports a kit job folder (`job.yaml`, `cameras.json`, `assessment.json`, masks, `surface.json`, GLB) into a project. Used for the EBSM and DAMAC fixtures and for migrating past jobs | kit `adapters/review_package.py`, `adapters/detections.py` | Per photo; masks vectorised one at a time |
| `asset_glb_import` | Imports an existing GLB as an asset-model version; reads node extras into `asset_item`; converts the frame | KIPIC builder output; the tank and EBSM GLBs | Streams the JSON chunk; the binary chunk is copied, not parsed |
| `asset_pose` | Estimates `image_pose` in the asset frame from EXIF GPS, XMP gimbal, axis aim; later Metashape and Pix4D camera import | kit `cameras.py` | Header reads only |
| `asset_backproject` | Ray-casts sightings onto the GLB (trimesh); writes points, patches (mesh plus texture), unmapped; derives height, bearing, side, zone, component | kit `project.py`, HCl POI ray-cast | Per sighting; one preview-size mask in memory at a time |
| `finding_group` | Union-find of sightings into findings (same type, within `cluster_m`, or a shared group tag); stable numbering top-down | kit `records.py` l.142 to 160 | Spatial hash over placed sightings |
| `ai_review` (later) | Agent-driven visual review over contact sheets, through the existing providers, writing sightings for operator review | DAMAC `contact_sheets.py`, `REVIEW_BRIEF.md`, `sheetpx.py` | Sheet batches, spend-approved like the project agent |
| `vector_import` | Shapefile, GeoJSON or GPKG polygons become map findings | Road shapefile hand-off | Streamed records (pyshp, MIT) |
| `pci_compute` | Sample units from pavement footprint plus grid; distress quantities; deduct values, CDV iteration; roll-ups | Road `pci/grid_pci.py`, `pci_observed.json` | Row-block raster reads (as in the original) |
| `stockpile_detect` | Ground filter, envelope, hysteresis, watershed, filters; per-survey footprints; four bases; volumes | Masafi `process.py` (+ `package.py` volume recompute) | Windowed per pile; RAM admission as for clouds (~3 GB today) |
| `flight_import` (M2) | Elios: `.efly`, `livetraj.csv`, servo from the ROS bag, LAS. DJI: `djmd` track. Writes samples, POIs and a video proxy | HCl `proc.py`, `align_flight.py`; KIPIC `parse_dji_djmd_telemetry.py`, `video_pose.py` | Streams the 4 GB bag; fps read per clip (fixes the 60 fps bug) |
| `video_proxy` | One faststart H.264 proxy per video, plus thumbnails | HCl `proc.py videos()` | ffmpeg subprocess |
| `flight_register` (M3) | Fits a flight's SLAM cloud to the model or to the other flights; quality score; manual 3-point fallback | HCl `align_pipes.py`, `align_all.py`, `clouds.py` | Subsampled cloud (600k) |
| `report_render` (extended) | New sections: asset findings map, per-defect page with 3D view and mask, PCI, stockpile register, flight coverage, asset register; brand applied | kit `report/*`, HCl `build_report.py`, Masafi `report.py`; **stays reportlab**, no Playwright | As today; image size caps |
| `review_export` | Builds the offline folder or the hosted bundle (see §8) | kit `viewer.py`, Masafi `build_viewer.py`, HCl `make.py`, Road `viewer_src/build.py` | Copies files by streaming; no full-set load |

The tile, close-up and basemap scripts from the road and Masafi builds are not ported. Kestrel's site
tile grid, finding thumbnails and basemap proxy already do that work.

---

## 7. UI surfaces

**Shared across verticals** (built once, configured by the profile):

1. **Asset workspace.** It builds on the am-u6 engine and M1's U7 workspace, using the same
   rail, topic panel and inspector pattern as the workspace-rail spec. It adds:
   - ghost see-through;
   - a ground basemap quad from the existing proxy;
   - pins and patches;
   - camera glyphs and the view cone;
   - auto-rotate.

   Topics: Parts, Findings, Photos, Flights, Register.
2. **Split inspection.** The asset stage beside the existing Konva photo canvas. It adds:
   - a mask overlay layer;
   - opacity and hold-to-compare;
   - the HUD;
   - a "3D view from pose" mode.

   The splitter state is stored per user.
3. **Register.** The existing `FindingsScreen` gains:
   - zone, side, height, component and sightings columns;
   - a gallery mode;
   - outcome chips (finding, uncertain, none, all photos);
   - the kit CSV column set as an export preset.
4. **Overview.** An asset hero (live auto-rotating GLB) next to the existing map and cloud heroes; an
   outcome bar; profile-driven breakdowns.
5. **Report builder.** New section kinds and a brand picker. An in-app PDF preview pane with vendored
   pdf.js, replacing `os.startfile`.
6. **Deliverables.** Under Reports, a "Review package" tab that lists versions, has an Issue action,
   and opens the result.

**Vertical-specific** (a plug-in to the shared surfaces, like `mapws` layers today):

- **Findings maps:**
  - stack: height by compass bearing with silhouette;
  - facade: floors by elevation;
  - tank: shell development plus roof and bottom plans;
  - OHTL: faces relative to the line.

  One SVG component with a `sides`/`zones` profile drives all four.
- **Road:** PCI layer and card, density overlay, chainage bar chart, Area pane. These are map
  workspace layers and panels.
- **Volumetrics:** pile register, 3D yard scene (lifted bodies, cut and fill bodies, sections), and
  toe-line editing in 3D with a browser preview whose number is confirmed by the server job.
- **Flights:** playback bar, drone marker, synced video window, drone's-eye view, LiDAR per flight,
  projection.
- **Plant:** register rail with search, item data panel, plot-plan overlay in 3D.

---

## 8. How a deliverable comes out of Kestrel

**PDF and CSV.**
- They stay what they are today: a `report_render` job producing an immutable numbered version.
- What is new: brand, defect pages, vertical sections, and the kit CSV column set as a preset.
- The kit's post-processing rules (flatten transparency, embed fonts, linearise, zero SMasks, no em
  dashes) become report tests.
- reportlab already avoids Chromium's Type 3 font problem, which is one reason to stay off
  Playwright.

**Interactive review: one viewer, three hosts.**
- Build the review viewer as a **second Vite entry** (`review.html`), reusing the engines, the photo
  canvas and the preview blocks.
- The viewer reads everything through a **data-access seam** (`ReviewSource`) with three
  implementations:
  1. **In-app**: the sidecar API (what the app uses).
  2. **Hosted**: relative URLs to plain files (`manifest.json`, `glb`, `photos/`, `tiles/`, binary
     buffers). Any static host works.
  3. **Offline `file://`**: the same files, plus `.js` wrappers for the JSON and binary buffers and
     data URIs for 3D textures. Chromium blocks `fetch` and WebGL textures from `file://`.

**Can we keep the double-click package? Yes, with two limits.**
- What works: everything except video projection onto the model, plus anything that needs a live
  `fetch` of large files. That covers the summary, 3D, photos with overlays, register, PDF (opened
  natively) and CSV.
- Video plays in a plain `<video>` from `file://`. It cannot be uploaded to WebGL from `file://`,
  which is the HCl `serve.ps1` workaround.
- Options for full fidelity offline:
  - (a) accept that projection needs the hosted copy;
  - (b) ship a small read-only local launcher like `serve.ps1`;
  - (c) ship a signed mini viewer exe.

  I recommend (a) for v1 and (b) only if a customer needs projection offline.
- The `.js` wrapper and data-URI tricks are the **one** packaging habit we keep. They are confined
  to the export job, never used in the app.

**Hosted.** The export writes a self-contained static folder. Where it is published is an open
question (Q4).

---

## 9. Risks and open questions

### 9.1 Risks

- **R1 Licences and terms of third-party code, data and services:**

| Item | Licence | Action |
| --- | --- | --- |
| three.js 0.180 | MIT | Keep (already pinned for potree-core) |
| potree-core | BSD-2 | Keep |
| OpenLayers | BSD-2 | Keep. Do not add Leaflet (BSD-2): it duplicates OL |
| pdf.js | Apache-2.0 | Must be vendored; the CSP blocks cdnjs |
| Fonts (Nunito Sans, Poppins, Inter, Space Grotesk) | OFL 1.1 | Ship the licence files, which the kit does not |
| e& logos | Trademark | Customer-supplied brand assets |
| ffmpeg | LGPL or GPL by build | Use an LGPL build as a separate exe, not linked |
| rosbags | Apache-2.0 | Fine |
| trimesh | MIT | Fine |
| pyshp | MIT | Fine |
| scikit-image | BSD | Fine |

- **R2 ultralytics is AGPL-3.0.** This is an existing exposure in the public MIT repo, not new.
  Customer deliverables contain no ultralytics code, so the exported viewer is unaffected.
- **R3 PCI deduct curves.** The table comes from an MIT-licensed gem, but its points were digitised
  from ASTM D6433 charts, and ASTM holds copyright in the standard. MIT covers the gem, not
  necessarily ASTM's charts. A licensed copy of ASTM D6433 (or legal advice) is needed before PCI
  ships in a paid deliverable.
- **R3a Basemap terms:**
  - **OSM (ODbL):** attribution suffices for rendered tiles. The public tile servers' usage policy
    forbids heavy or bulk use, which matters if an export pre-renders many tiles.
  - **Mapbox (DAMAC, KIPIC v1.4):** the terms restrict storing or caching tiles and need an account
    and token. Pre-stitched images in an offline package are likely outside the terms, so do not
    port `basemap.py`.
  - **Esri World Imagery** (the current keyless proxy): Esri's terms expect an ArcGIS account for
    production use. This is an existing risk already on `main`.
  - **Recommendation:** export basemaps only from a source whose terms allow offline redistribution
    (self-rendered OSM, as the road did, is the clean option), and keep attribution in the viewer and
    the PDF.
- **R4 Frame conventions.** Kit and tank use X north, Z east; KIPIC uses X east, -Z north. One
  canonical frame (M1's) with explicit converters, plus a golden test per source.
- **R5 Severity scales.** Kit: 3 levels plus uncertain. HCl: 3 to 5. Road: Few/Intermediate/Extensive
  is not severity. Kestrel: an app-wide 1 to 4 scale. The import mapping changes what customers see
  (Q2).
- **R6 Two algorithms for one number.** Masafi's browser membrane does not match the Python one.
  Kestrel must use the server job for every reported figure, and the live browser number is a
  labelled preview.
- **R7 Pose quality.** Every 3D placement rests on non-RTK GPS, barometric height and gimbal angles
  ("good to a floor and a bay"). DAMAC's 101 unplaced sightings fall back to camera target height
  (F0001 at 88.98 m on a 74.4 m building) and each becomes its own defect, which inflates the count.
  Kestrel should show "not placed" honestly and keep unplaced sightings out of height and zone
  statistics. That will **change the 656 fixture**, so the fixture needs a "kit-compatible" mode.
- **R8 Things that cannot be reproduced** from what survives:
  - EBSM detection and patch anchoring;
  - DAMAC's outline fitting;
  - the HCl SIFT photo matching and frame search;
  - the KIPIC model generator;
  - parts of the road `_build`.

  For these the plan imports outputs as fixtures; it does not promise to regenerate them.
- **R9 Live source folders have drifted:**
  - EBSM and DAMAC moved to `\\DanNas\Work Data\Asset Inspections\...`;
  - the road's NAS folder lacks `ortho-hd\` and `basemap\`, so it opens without an ortho;
  - the EBSM NAS build predates the street map;
  - the DAMAC `_rebuild\job.yaml` lacks the basemap block that its HTML uses.

  `SOURCES.md` should be corrected.

### 9.2 Decisions (operator, 2026-10-02)

The operator accepted the recommendation on every question below. Where §9.2 had no recommendation,
the default chosen here is marked *(default)*.

| # | Decision |
| --- | --- |
| Q1 | A register row is a **defect**: one finding with one or more sightings (`finding_sighting`). DAMAC shows 656, not 1,441 |
| Q2 | "Uncertain" is a **photo review status** (`image_review`), not a severity. Import mapping: Light / Minor = 1, Moderate / Significant = 2, Heavy / Severe / Critical = 3; level 4 stays for the app's Critical. *(default)* HCl's 3 / 4 / 5 maps to 2 / 3 / 4, on the reading that it is a 1 to 5 scale; confirm when the KOC report scale is checked |
| Q3 | Polygons are the stored truth; kit raster masks are vectorised on import; overlays and patch textures are derived cache files |
| Q4 | *(default)* `review_export` produces a **host-neutral static folder** (relative URLs, no server code), so any static host works. Publishing to a particular host is a later, separate step |
| Q5 | Phase 1 starts from **imported and hand-drawn sightings**. The AI review job comes later |
| Q6 | Confined-space **M4 is folded into phase 1**. M2, M3, M5 and M6 continue as planned |
| Q7 | *(default)* Kiosk is an **optional layout of the exported review**, scheduled after phase 2, not part of the app |

### 9.3 Questions that would change the plan (as asked)

- **Q1 What is a row in the register?** A defect with its sightings (recommended; DAMAC 656), or each
  sighting (1,441)? This decides `finding_sighting`.
- **Q2 Severity.**
  - Map the kit's Light/Moderate/Heavy and Minor/Moderate/Severe onto the app scale 1 to 4?
  - Is "uncertain" a finding status, a severity, or a photo review status (recommended)?
  - What did the HCl report's 3 to 5 come from?
- **Q3 Masks.**
  - Polygons as the stored truth (recommended, trains YOLO-seg), or raster masks kept as raster?
  - EBSM's 897 masks are pixel classifier output; vectorising them is lossy at hairline edges.
- **Q4 Hosted.** Where does a hosted review live?
  - claude.ai artifacts;
  - a static host we run (Cloudflare Pages, S3);
  - the customer's SharePoint.

  This decides auth, size limits and whether "hosted" needs any packaging at all.
- **Q5 Detection in Kestrel.** None of the six used a trained model. Should the first slice include
  an AI review job (the contact-sheet method through the existing providers), or start from imported
  and hand-drawn sightings and add AI later (recommended)?
- **Q6 Programme merge.** OK to fold the confined-space M4 ("findings on the asset") into phase 1 so
  there is one asset-anchor model, with M2, M3, M5 and M6 continuing as planned?
- **Q7 Kiosk.** Is the DAMAC portrait kiosk a product requirement, or a one-off for that client?

---

## 10. Phased build order

### 10.1 Budget across the programme

**Background jobs:** every row of §6.

**Bounded reads:**
- photos are served at preview size;
- masks, patches and placements are per item;
- flight samples are per flight;
- LiDAR goes through the Potree octree (not the 140k-point base64 clouds);
- rasters are read windowed;
- exports stream.

**Large fixtures stay where they are and are read-only.** Tests use small checked-in excerpts:
- the pack's CSVs and JSON;
- one pile;
- one flight;
- the `grid.json` units.

### 10.2 Phases

**Phase 0, in flight. Land what the plan stands on.**
- M1 U5 to U7 (agent run, GLB viewer, asset workspace).
- The workspace rail.

**Phase 1, the first vertical slice: findings on the asset.**
- Units:
  - `asset_glb_import` (also covers the frame, so the DAMAC and EBSM GLBs open);
  - `asset_frame` and `asset_zone`;
  - `image_pose` plus `asset_pose`;
  - the asset anchor plus `finding_sighting`;
  - `asset_backproject`;
  - `finding_group`;
  - `image_review`;
  - a mask overlay layer;
  - split inspection;
  - register columns and gallery;
  - the asset findings map (stack and facade variants);
  - `review_kit_import`;
  - report sections (per-defect page, findings map) with the `brand` entity.
- **Acceptance on DAMAC:**
  - imported, back-projected and grouped;
  - 715 / 625 / 101 placements within tolerance;
  - 656 defects (182 / 474) in kit-compatible mode;
  - the CSV column set matches.
- **EBSM:** 78 findings, 53 uncertain, 159 none, 9 not assessed, imported through `surface.json`.
- **Why first:** three of the six artifacts and the tank's M4 depend on this anchor. It reuses the
  most existing code (findings, images, reports, M1). It answers the hardest data-model question
  (Q1) before anything else builds on findings.

**Phase 2: the review package.**
- `review.html` entry, `ReviewSource` seam, `review_export` job, offline and hosted targets, vendored
  pdf.js, in-app PDF preview.
- Acceptance: the phase 1 DAMAC review opens by double-click from a USB stick and from a UNC path,
  with no network.

**Phase 3, a parallel batch of two independent tracks:**
- **3a Road.**
  - Work: `vector_import`, `alignment` and chainage, `pci_compute`, density overlay, PCI card and
    Area pane, PCI and chainage report sections.
  - Acceptance: 2,115 defects; 1,783 units; network PCI 94.8 / 87.6 / 77.5; unit-class counts at
    Medium; density cell counts per size.
  - Prerequisite: Q3/R3 (curve licence).
- **3b Volumetrics.**
  - Work:
    - `stockpile_detect`;
    - `stockpile` identity;
    - `toe_average` and `toe_membrane` bases;
    - the 3D yard scene;
    - toe editing in 3D with a server-confirmed number;
    - stockpile register report section.
  - Acceptance: 19 piles; TIN 76,199.4 / 63,402.1; change -12,797.3; pile-zone cut/fill 22,597.7 /
    1,226.9; lowest 99,295.5; P02 14,686.7, each to within 0.1 m3 on the same inputs.

**Phase 4, flights and video.** M2 + M3 + M6 of the confined-space programme, written for both
Elios and DJI, sharing ffmpeg and `video` with setup S4.
- **Tank acceptance:**
  - 10 flights;
  - 396 POIs;
  - heading spread at most 1.7 degrees;
  - POI ray-cast against rangefinder: median at most 110 mm.
- **KIPIC acceptance:**
  - 25 videos;
  - 1,755.9 s;
  - DJI_0789 and DJI_0794 in sync (the 60 fps fix).
- Then video projection, see-through, M5 tank views (shell development, nozzle schedule).

**Phase 5, plant register.**
- Work: `asset_item` from GLB extras or CSV, register rail and search, plot-plan overlay in 3D,
  photos and panoramas at their poses.
- Acceptance: 885 items, 404 tagged, 824 / 61 height sources, UTM conversion against the root extras
  formula.

### 10.3 Execution DAG

```
P0 (M1 U5-U7, rail) ──► P1 ──► P2 ──┬──► P3a road
                                    ├──► P3b volumetrics
M2 (flight import, already planned, may start now) ──► P4 (needs P1 anchor for POI findings)
                                                              └──► P5 plant register
```

**Inside P1, three batches:**

| Batch | Units |
| --- | --- |
| A, in parallel after the contract unit | asset frame and zones; image_pose and asset_pose; glb import; image_review; mask overlay layer; brand |
| B | finding anchor and sightings, then backproject, then grouping |
| C, in parallel | split inspection; register columns and gallery; findings map; report sections; kit import |

- **Critical path:** contract, then anchor and sightings, then backproject, then grouping, then the
  report sections.
- **Across phases:**
  - P3a and P3b share nothing but the report builder, and both need P2 only for their exported
    review.
  - P4 can start its M2 import half in parallel with P1, because M2 is independent of M1 per the
    asset-model spec §3.

Each phase gets its own brainstorm, spec and plan before any code, as the working agreement
requires.
