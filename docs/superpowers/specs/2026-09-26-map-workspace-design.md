---
type: spec
date: 2026-09-26
status: draft
tags: [spec, inspection-platform, maps, workspace, drawings, georeferencing, measurements, volumes, findings]
related: ["[[2026-09-26-inspection-platform-design]]", "[[2026-09-22-geotiff-maps-design]]", "[[2026-09-23-volumes-design]]", "[[2026-09-23-design-surfaces-design]]", "[[2026-09-23-survey-timeline-design]]", "[[2026-09-23-train-detect-split-and-model-library-design]]"]
---

# Map workspace (sub-project M)

## 1. Goal

The Maps tab of a project becomes one full-bleed workspace. Every 2D georeferenced item in the
project is shown in it, in one coordinate frame: orthomosaics by date, elevation models, CAD and
PDF plans, findings, AI detections, site areas and measurements. The operator works on the site
without leaving the map. They can:

- compare two survey dates in four ways;
- measure a distance, an area or an elevation profile;
- compute a stockpile volume on the existing S2 engine;
- drop a finding;
- draw a zone;
- georeference a drawing;
- run AI detection over a region.

Every control floats over the map as Aero glass (umbrella D9, D10). The target layout is the
approved mockup `.superpowers/brainstorm/1481982-1790403567/content/ws-maps.html`, described in §5.

Done means that, on one real project with two orthos, their DSMs, a DXF site plan and a PDF
foundation plan, the operator can do all of the following:

1. Open Maps and see everything aligned.
2. Swipe from August to September.
3. Georeference the PDF with three control points.
4. Measure a stockpile against the August DSM.
5. Accept a defect detection as a finding.
6. Draw a profile across the pit.

All of it happens on one screen, and no step blocks the UI.

## 2. Scope

**In:**

- **The workspace screen.** Layers panel, compare modes, tool palette, inspector, timeline
  scrubber, coordinate readout, scale bar, north arrow, zoom and minimap.
- **The site frame.** A project-level display CRS, with server-side tiles warped into it.
- **Elevation.** A plain DSM/DTM GeoTIFF import, which does not exist today, and elevation
  rendering modes.
- **Drawings.** DXF, PDF, PNG/JPG and LandXML linework: import, georeferencing, and rendering as
  vector or raster overlays.
- **Map measurements.** Distance, area and profile, stored as §3 Measurement kinds.
- **Volumes in the workspace.** Adds a new "lowest point" base and material density.
- **Map findings.** Created with tools or from accepted defect detections, through F's API.
- **AI detections.** A detection layer, review in the inspector, and region-scoped AI runs.
- **Zones.** Site areas gain a category.

**Out, each deferred with a reason:**

- **Change detection between two surveys.** A DSM-of-difference layer, change polygons and a
  change report are **deferred**. The four compare modes cover visual change, and a volume against
  an earlier survey covers measured change. A later spec can add a `dsm_diff` site-tile kind on
  §6's renderer.
- **Georeferencing an orthomosaic that has no CRS.** Such maps stay in the pixel viewer (§11). The
  §8 fitting code could be reused later.
- **Per-survey horizontal registration correction** (a nudge offset between two orthos).
  Misregistration is shown, never corrected.
- **GeoPDF and embedded PDF georeferencing.** A PDF is always placed with control points.
- **DWG.** It is refused with the S3 message.
- **3D surface area, slope maps and contour export.**
- **Map labelling and P/R/F1 scoring inside the workspace.** These stay on the retained pixel
  screen (§11).
- **GCP and accuracy reports from photogrammetry.** The mockup's "6 GCPs, RMSE 1.8 cm" is not
  stored anywhere today. The inspector shows GSD and the S2 uncertainty only.

## 3. Decisions

| # | Decision | Choice | Why (rejected options) |
|---|---|---|---|
| M1 | Display space | **A project "site frame"**: one projected CRS in metres. An OpenLayers `View` in that CRS is registered through `proj4` and `ol/proj/proj4`. | Two orthos with different CRSs or extents, DSMs and drawings must line up. Rejected: today's per-map pixel view (`maps/MapView.tsx`), which cannot hold two maps. Rejected: Web Mercator, which scales metres by 1/cos(lat) and would make every on-screen measurement a conversion. |
| M2 | Raster layers in the frame | **Warped server-side** into a fixed site tile grid (§6). This generalises `surfaces/tiles.render_ortho_tile` (WarpedVRT from one overview level). | This is the volumes spec's rule (S2 §2 "Display space"): no client-side raster reprojection in the WebView, and the output can be tested in pytest. |
| M3 | Site CRS choice | Automatic: the CRS of the **first georeferenced map or surface**. A geographic CRS is replaced by the UTM zone of its centre (`pyproj` `query_utm_crs_info`). The operator can change it in a workspace menu. A project whose items all have no CRS gets a **local-metres frame** instead. | Most sites have one CRS. Keeping the source CRS means no reprojection in the common case, where the warp is just a resample. Stored geometries never depend on this choice (M5), so changing it is safe. |
| M4 | Vector coordinates | **The server converts.** Every vector endpoint that the workspace reads takes `frame=site` and returns site-frame coordinates. Every write takes site coordinates and stores them in the entity's own CRS. There is one module: `backend/app/workspace/frame.py`. | pyproj lives on one side, and it is tested against the rotated-geotransform fixtures in `tests/geotiffs.py`. The client only needs proj4 for the WGS84 part of the readout (which already exists, `maps/coords.ts`). Rejected: client-side proj4 for boxes, which would duplicate `georef.py` in TypeScript. |
| M5 | Storage CRS | **Unchanged per entity:** detections stay in map pixels, findings in the map CRS (umbrella §3), volume polygons in the top surface CRS, site areas in WGS84, and drawings in their own coordinates plus a georef. Map measurements store their CRS explicitly. | No migration of existing geometry, and the umbrella's anchor definition is kept. |
| M6 | Compare alignment | **By georeference only.** Both sides render in the site frame, so different CRSs and extents align automatically. Outside a side's footprint, the tiles are transparent (204) over the backdrop. | Honest: a real misregistration stays visible. A correction is deferred (§2). |
| M7 | Swipe, side-by-side and blend | Swipe: one `Map` with the right layer clipped in `prerender`/`postrender` (canvas `clip`). Side-by-side: two `Map`s sharing **one `View` instance** (synced by construction), with a ghost crosshair. Blend: the right layer's opacity. | These are standard OpenLayers patterns and need no new dependency. A shared View cannot drift. |
| M8 | Plain DSM/DTM import | A new `Surface.kind = "dem"` with `elevation_role` `dsm`/`dtm` and `captured_on`. A new `elevation_import` job reuses S3's DEM path (`surfaces/design/dem.py`, `dem_build.py`: copy when conforming, else an exact-warp re-grid onto `aligned_grid`). There is no preview gate. | A Pix4D DSM is a measured survey, not a design. S3's "look before you commit" gate protects against CAD-unit mistakes that a GeoTIFF with a CRS does not have. It reuses the tested code, including the `tolerance=1e-9` warp (ADR 2026-09-24). |
| M9 | PDF rendering | **`pypdfium2`** (Apache-2.0/BSD; wheels bundle PDFium), rendered in strips. | Rejected: PyMuPDF (AGPL). Rejected: Ghostscript (AGPL, external binary). The overlay-venv rule for new dependencies applies (CONTRIBUTING, ADR 2026-09-24), and the frozen sidecar must be smoke-tested. |
| M10 | Drawing rendering | DXF and LandXML: **vector tiles**. These are compact JSON per site tile, simplified to the tile's resolution, served from a bucket index built at import. Raster plans: a tiled RGBA GeoTIFF whose geotransform *is* the georef, warped like an ortho. | Vector DXF stays sharp at every zoom. A per-tile response is bounded whatever the file size. Rejected: sending the whole DXF as GeoJSON, which is unbounded (200 MB DXFs exist, S3 §2). Rejected: MVT, which needs a new encoder dependency. |
| M11 | Georef models | **Similarity** (4 parameters, 2 or more points) or **affine** (6 parameters, 3 or more points), fitted by least squares. RMSE and per-point residuals are reported in metres. A reflection is refused. | The umbrella's "2–4 control points, affine or similarity". Similarity is the default because a PDF plan is not skewed. |
| M12 | Volumes in the workspace | The S2 engine is **unchanged** except for one new base `toe_lowest` (a flat base at the minimum observed edge sample). A change of input **auto-recalculates** (an inspector switch, on by default). | The mockup's four bases map to `toe_lowest`, `toe_plane`, `surface`(design) and `surface`(earlier DSM). Numbers still come only from a `volume_calc` job (S2 §2). |
| M13 | Distance and area | Computed **on the server**, on the ellipsoid (`pyproj.Geod` on the WGS84 image of the vertices), with the grid value and the 3D slope distance (when a DSM covers the line) as secondary figures. The client shows "≈ grid" while drawing. | The cloud-measurement rule: results are computed by the server, never by the client (`CloudMeasurement.results`). |
| M14 | Region AI runs | `RunCreate` gains an optional `region` (site polygon). The `map_detect` job plans windows only inside it. The run has `scope = region` and **never represents a survey** in the timeline or analytics. | A partial run's counts are not the site's counts. This is the same honesty rule as the comparison basis (timeline §4). |
| M15 | Zones | The **Z tool draws `SiteArea`** (WGS84, project-wide), which gains `category` (`general`, `laydown`, `exclusion`, `excavation`, `other`). `MapZone` (pixel evaluation zones) is not shown in the workspace. | Site areas already mean "a place on site" across surveys, and they feed per-area counts. `MapZone` exists only for scoring (§11). |
| M16 | What replaces what | `MapsScreen` results and review, and volume **creation and editing**, move into the workspace. The pixel `MapsScreen` survives, trimmed, as `MapEvaluateScreen` (labels and scoring), and serves maps that have no CRS. `VolumesScreen` stays as F's interim Measurements host until the Measurements tab is rebuilt. | Keeps working, tested code for the one feature the workspace does not need, and does not pull the Measurements tab out from under F. |

## 4. Depends on Foundation (F)

This section is checked against `2026-09-26-foundation-design.md`, which was drafted in parallel.
Section numbers below are F's. Anything F does not state explicitly is marked **assumption**. If F
changes, M's plan adapts; M's own decisions do not change.

1. **Design system** (F §4, `frontend/src/ui/`):
   - `GlassPanel variant="float"` is the only place blur is allowed (F7), with `--blur-md`.
   - Motion tokens (`--dur-*`) and the reduced-effects mode, which drops blur.
   - `Segmented`, `Slider`, `Switch`, `Kbd`, `Tooltip`, `SeverityPill`, `TypeChip`, and
     `InspectorLayout`/`InspectorSection`.

   M builds map chrome from these in `frontend/src/mapws/`, never with raw colours, so
   `check-tokens.mjs` passes. Data colours (hillshade, tint, cut/fill) come from the server as PNG,
   as today. **Assumption:** `InspectorLayout` can be hosted inside a floating `GlassPanel` at the
   mockup's 318 px width. F's default is a 340 px right pane.
2. **Shell and routes** (F §5.3–5.4):
   - F routes `/p/:projectId/maps` to an interim `maps/MapDataList.tsx`, and `/maps/:mapId` to
     the unchanged `MapsScreen`. M replaces the first with the workspace.
   - M turns the second into a redirect to `maps?map=<id>`, keeping `?at=` (§5), for old links and
     S1's cloud → map jump. F's `FindingInspector` `anchorSlot` uses F's uniform finding deep link
     `maps?map=<mapId>&finding=<fid>` (F §8.7), which M handles (§5).
   - M adds routes only through F's `routes/projectRoutes.tsx` table (F risk 5).
   - F leaves `/review`, `/analytics` and `/site-areas` as secondary routes, "I and M decide".
     M's decision: map review moves into the workspace, and `review/DetectReview.tsx` links
     `maps?map=<id>&sel=run:<rid>`. Analytics and Site areas stay as secondary routes.
   - The command palette registry (`app/commands.ts`, `useCommands`): M registers the workspace
     tools, layers, and "Go to finding on map".
3. **Project without kind.** F deletes `projects/kinds.py` and every `require_kind`. M adds no kind
   checks.
4. **Catalogue and severity scale** (F §7): catalogue types with `kind` defect|object, `colour`
   and `hotkey`; the severity levels with colours. A map run's `class_map` maps onto catalogue
   type ids.
5. **Finding core** (F §8):
   - The `finding` table's map anchor is `map_id` + `geometry` (GeoJSON in the map CRS), with
     `lon`/`lat` and `data_type`/`data_id`.
   - `POST /findings` with `{type_id, anchor, severity?}`. An `object` type gets 422 `not_a_defect`.
   - `findings/counts.py` is called inside the finding write's transaction.
   - F explicitly leaves **accepting map detections as findings to M** (F §2).
   - F's `findings/service.create_in_session` is public so that M can call it inside the review
     transaction, as `findings/annotations.py` does for image boxes (F §8.5, confirmed).
   - For map anchors, the caller supplies `lon`/`lat` (the anchor centroid in WGS84); M computes it
     with `frame.py` (F §8.5, confirmed).
   - An accepted defect detection becomes a finding with status `reviewed` (F §8.5), as in §9.3.
6. **Shared inspector** (F §8.7): `<FindingInspector projectId findingId anchorSlot? measureSlot?
   onNavigate?>`. M fills `measureSlot` with the polygon area or the point's elevation, and
   `anchorSlot` with "Show on other survey".
7. **Data list** (F §6.3): F declares `drawing` in the contract enum with **no provider**, and M
   adds the table and the provider. F's `elevation` provider covers `cloud_dsm` and `design`, and
   M extends it to `dem`, with `captured_on` from the new column (§7).
8. **Measurements** (F §2): **M owns the union endpoint** `GET /measurements`. F hosts the
   Measurements tab on the interim `VolumesScreen`. M ships it with one provider per kind: cloud
   (the existing `cloud_measurement`, `sub_kind` = its `kind`), volume, and map. C adds only the
   headline and status mapping for its new cloud kinds `area` and `profile` (and `computing` →
   `status`) to M's cloud provider (C §12); until C merges they list with the generic headline.
   The Measurements tab UI that replaces the interim host is out of M's scope (§11).
9. **Migration.** F's migration lands first. M's project revision is **`0012`** (umbrella §6
   "Migration ids"), chained onto the head on `main` at merge time (ADR 2026-09-23 on migration id
   collisions).

## 5. The workspace layout (the approved mockup, precisely)

The route is `/p/:projectId/maps`, with the view state in the query string:

- `?l=<date>&r=<date>&mode=single|swipe|side|blend&sel=<kind>:<id>`
- `?at=x,y&map=<id>` for deep links from clouds (native CRS of that map, as `clouds/jump.ts` does
  today)
- `?map=<mapId>&finding=<fid>`, F's uniform finding deep link (F §8.7): equivalent to
  `sel=finding:<fid>` with that map's date as `r`; the view centres on the anchor geometry and the
  inspector opens. A finding anchored on another map redirects to its own map.

The legacy `/p/:projectId/maps/:mapId` redirects to `?map=<id>`, which selects that map's date as
`r`.

The stage fills the content area (F's `--bg` token behind the tiles, crosshair cursor). All
panels are `GlassPanel variant="float"`s at `z-index: 10` with 16 px insets and `rounded-panel`:

| Panel | Position and size | Contents |
|---|---|---|
| **Tool palette** | left 16, top 16; vertical; F's `FloatingToolbar` (`rounded-panel`) | The tools of §5.1 in four groups separated by rules. Each tool is a `ToolButton` with a tooltip "Name `Key`". The active tool has the primary gradient. |
| **Layers** | left 72, top 16; width 290; max-height `100% − 140px`; collapsible from the header (chevron rotates, height animates to 50 px) | Header: icon, "Layers", a count, and "+" (a menu: Import orthomosaic, Import elevation, Build DSM from cloud, Import drawing). Groups, each with an eyebrow: **Base maps**, **Elevation**, **Drawings** (with "+ Import"), **Annotations** (Findings, AI detections, Site areas & zones, Measurements). Rows are described in §5.2. |
| **Compare** | top 16, centred; `rounded-panel` | F's `Segmented`: Single / Swipe / Side-by-side / Blend. Two date chips ("Left", "Right", each with a colour dot and a caret opening the list of survey dates). In Blend, a slider "Aug ⟷ Sep" (0–100). |
| **Tool hint** | top 70, centred; pill | The active tool's icon, bold name, then its instruction, e.g. "Volume · Click to add vertices · double-click to close · Esc cancels". It flashes on tool change. |
| **Inspector** | right 16, top 16; width 318; max-height `100% − 150px`; scrolls with a hidden scrollbar | Context-dependent (§5.3). Hidden when nothing is selected. |
| **Coordinates** | left 16, bottom 16; min-width 360 | Row 1: CRS chip (`EPSG:32638 · WGS 84 / UTM 38N`, or "Local metres") and the scale bar (0, a four-segment bar, round length). Row 2: `E`, `N` (mono, 2 decimals) and `Z` (teal; the topmost visible elevation layer of the right date, sampled every 150 ms; hidden without one). Clicking the chip toggles WGS84 lon/lat. |
| **Timeline** | bottom 16, centred; width 540 | A round play button, "Survey timeline · N flights, M planned", and the range text "14 Aug → 14 Sep · 31 days". A track with one tick per survey date positioned by time; planned dates are dashed and unselectable. `L` and `R` markers and the range bar between them. |
| **North arrow** | right 244, bottom 16; 40 px circle | Rotates with the view. A click, or `Shift+N`, resets north. |
| **Zoom** | right 198, bottom 16 | `+`, a percentage (100% = one screen pixel per ground pixel of the right date's ortho), `−`. |
| **Minimap** | right 16, bottom 16; 172 × 110 | The OpenLayers `OverviewMap` control in a custom target, fed by the right ortho's site tiles at a low zoom. It shows the viewport rectangle (white, glow) and the label "Site overview". A click or drag recentres the map. |

In **Side-by-side** the layers panel collapses, and is restored on leaving. A 1 px midline and two
labels ("◀ 14 Aug 2026 · Ortho", "14 Sep 2026 · Ortho ▶") appear. The cursor's crosshair shows on
one side and a ghost crosshair at the same coordinate on the other. In **Swipe**, a vertical
divider with a round gradient handle (38 px, `ew-resize`) and date labels under the handle is
dragged between 2% and 98%. The position is kept in the view state.

Motion follows the umbrella (§8): panel entry is staggered and at most 360 ms each; the pill slide
and the collapse take at most 400 ms; the new finding pin drops with a ring pulse. Everything is
off under `prefers-reduced-motion`. Backdrop blur applies only to these panels, never to the map
canvas.

### 5.1 Tools and shortcuts

| Tool | Key | Behaviour | Saves |
|---|---|---|---|
| Select | `V` | Click a feature → inspector. `Del` deletes the selection (with confirm for findings). | – |
| Pan | `H` | Drag pans. Holding `Space` pans from any tool. | – |
| Measure distance | `L` | Click vertices; double-click or `Enter` finishes; `Backspace` removes the last vertex. A live "≈ 48.20 m grid" label. | `map_measurement` distance (§9.1) |
| Measure area | `Q` | Polygon, closed by double-click. Live "≈ m² · perim m". | `map_measurement` area |
| Elevation profile | `E` | A two-click (or multi-vertex) line → chart in the inspector (§9.2). | `map_measurement` profile |
| Volume | `U` | Polygon → `POST /volumes` on the right date's DSM (§10). | `volume_measurement` |
| Add finding point | `M` | One click → a type picker popover (F's `Combobox` over the project type list, defects only; type hotkeys are live inside it) → F's API with a `map` anchor. | Finding |
| Add finding polygon | `G` | Polygon → the same popover. | Finding |
| Zone | `Z` | Polygon → name and category popover. | `SiteArea` (§9.4) |
| Align drawing | `K` | Only with a drawing selected. Click on the drawing, then on the map; pairs accumulate (§8.3). | drawing georef |
| AI detect region | `D` | Drag a box → popover with model (default: the last used) and confidence → Run. | a `MapRun` with `scope=region` (§9.3) |

The keymap is F's app-wide one (F §5.6). Its **global keys** mean the same here: `Esc` cancels the
drawing, then deselects; `Enter` finishes; `Backspace` removes the last vertex; `Del` deletes;
`Ctrl+Z` undoes the last vertex while drawing; `Space` held pans; `V`/`H` select/pan; `F` fits the
site extent; `+`/`-` zoom; `?` the sheet. M's own **workspace keys**, registered in F's table:

- `Shift+N` north up.
- `[` / `]` step `r` to the previous or next survey.
- `P` play/pause through the surveys (900 ms per step).
- `C` cycles the compare mode.

Typing targets are ignored (`isTypingTarget`, now in F's `ui/keymap.ts`).

**Review keys** are F's (F §5.6) and the same as in Images: while a detection or finding is
selected, `A` accepts and `X` rejects a pending detection, `Shift+A`/`Shift+X` act on all visible
pending detections, `1`–`9` set the severity of the selected finding (so `A`, `3` accepts and
grades), `T` opens the type picker (reclass a detection, retype a finding), and `Tab`/`Shift+Tab`
move to the next/previous pending detection. No M tool key uses these letters, so no precedence
mode is needed. The hint pill shows "Reviewing · A accept · X reject · Tab next" while a pending
detection is selected. (Today's `MapReviewPanel` keys R reject, 1–9 reclass and N next are
retired.)

The mockup labels Play as `Space`. That conflicts with "`Space` to pan from any tool", which is
also in the mockup, so Play moves to `P`. The mockup's `D` distance, `A` area, `F` finding and `R`
region become `L`, `Q`, `M` and `D`, to keep the app-wide meanings (F §5.6).

### 5.2 Layer rows

Each row is a grid of: grip (visible on hover; drag to reorder **within its group**), eye
(visibility), swatch, and a name with an optional badge (`GEO` = georeferenced drawing). Under the
name are a meta line and an opacity slider (0–100). Hidden rows fade to 45%. The group stacking is
fixed, bottom to top: base maps, elevation, drawings, annotations.

| Group | Rows | Meta line | Row menu (⋯) |
|---|---|---|---|
| Base maps | One per ready `GeoMap` with a CRS, newest first ("Orthomosaic · 14 Sep 2026") | GSD, file size | Rename, set date, run AI on whole map, open evaluation (§11), delete |
| Elevation | One per ready `Surface` (`cloud_dsm`, `dem`, `design`) | z range ("598.1 – 624.8 m") or "from Site plan rev C" | Render: hillshade / tint + hillshade / contours (with interval); set date and role; delete |
| Drawings | One per `Drawing` | "4 control pts · RMSE 6 cm", or "not placed" | Align (`K`), DXF layer list (per-layer toggles), knock out white (raster), re-import, delete |
| Annotations | Findings, AI detections, Site areas & zones, Measurements | "47 · 5 critical", "12 · Aerial-machinery v3", "3 zones", "9 · 3 on this map" | Filters: severity/status (findings), pending/accepted/class and "all surveys" (detections), category (zones) |

**Date scoping.** Base-map and elevation rows carry a survey date:

- **Single mode:** visible dated layers render with the chosen `r` date's layers on top of their
  group.
- **Compare modes:** the left side renders the dated layers of `l` and the right side those of
  `r`. A dated row that is neither date renders nowhere, and its eye shows a dimmed "not in
  compare" state.
- **Undated overlays** (drawings, designs, zones, measurements) render over both sides.

Findings and detections default to "selected surveys": the anchors or runs of the maps of `l` and
`r`, each on its own side in Side-by-side. A switch widens this to "all surveys".

The layer state (visibility, opacity, order, render mode, DXF layer toggles, compare mode and
dates, blend, and the last view) is persisted per project through `PUT /map-workspace`, debounced
by 1 s.

### 5.3 Inspector contents

| Selection | Inspector |
|---|---|
| Volume measurement | The mockup exactly (§10): badge, eyebrow "Volume measurement", name, material and age. Base surface options (4 cards). Net volume with cut and fill and a cut/fill bar. Stats (footprint area, perimeter, max height, tonnage @ density). Uncertainty note (± from `results`, GSD). "Cut / fill heatmap" switch with legend. Actions: Add to report (R; hidden until R lands), Export CSV (`volume_export` with `formats:[csv]`), View in 3D (existing `viewIn3dHref`). |
| Distance / area | Name, note, primary value (ellipsoidal), grid value and scale factor, 3D length when a DSM covers the line, vertex count, the CRS. Rename and delete. |
| Profile | Name, a chart (§9.2) with expand-to-sheet, the surfaces drawn, min/max/Δz, and cut/fill area between two series. |
| Finding | F's `FindingInspector`, plus a map strip: the anchor map's date and "Show on other survey". |
| Detection | Class, confidence, model, map date, review state, and the accept/reject/reclass buttons of `MapReviewPanel` (ported). Accepting a `defect` type creates a finding (§9.3). |
| Drawing | Georef method, control-point table (drawing coordinates → map E/N, residual in m, delete), model Segmented (Similarity / Affine), RMSE and warnings, "Save placement". |
| Zone | Name, category, area, and per-survey counts from `/analytics/areas` (existing). |

## 6. The site frame and site tiles

**Frame state** lives in a new one-row table `map_workspace`:

| Column | Meaning |
|---|---|
| `frame_kind` | `crs` \| `local` |
| `crs_wkt`, `epsg` | the site CRS; null for `local` |
| `state` | JSON view state (§5.2), at most 64 KB |
| `planned_surveys` | JSON `[{date, note}]`, shown as dashed ticks |
| `updated_at` | |

It is created lazily by `GET /map-workspace` using the M3 rule. A project that has both
georeferenced and local-metre items can switch frames from the CRS chip ("Local metres · 2
surfaces"). Each frame shows only its own items.

**Tile grid.** The grid is fixed and independent of content, so it never changes when data is
added:

- origin `(0, 0)` in site CRS units;
- `res(z) = 1024 / 2^z` m/px for `z` = 0…20 (z 17 ≈ 0.78 cm);
- 256 px tiles;
- tile column `x = floor(E / (256·res))`, row `y = floor(−N / (256·res))`, which may be negative.

`frontend/src/mapws/view/siteGrid.ts` mirrors `backend/app/workspace/grid.py`, and both are tested
on the same vectors. A layer's `max_zoom` is the smallest `z` with `res(z) ≤ native/2`. The client
overzooms beyond that.

**Renderer.** This is `backend/app/workspace/tiles.py`, generalised from
`surfaces/tiles.render_ortho_tile`. For a layer `(kind, id, version)` and a tile:

1. Transform the tile's bounds into the source CRS. If they do not intersect `bounds_native`,
   return 204. This check is cheap and needs no I/O.
2. Open the source at the overview level whose resolution is at or below the tile's.
3. Read one `WarpedVRT(crs=site, transform=tile, 256×256, resampling=bilinear)`. For hillshade the
   read is 258×258 with a 1 px border.
4. Render by kind:
   - `map`: RGB, with masked pixels transparent. The output is PNG, because site tiles must be
     transparent outside the footprint for compare.
   - `surface`: `grid.hillshade` with the effective cell = tile resolution, or a tint over
     `stats.z_p02…z_p98` (else `z_min…z_max`), or **contours**. A pixel is on a contour when
     `floor(z/interval)` differs from a 4-neighbour. The default interval is the nice number
     nearest `(z_p98 − z_p02)/20`, and the lines are drawn 1 px in white at 55%.
   - `volume_diff`: `diff.tif` with the existing diverging ramp (`render_diff_tile`).
   - `drawing_raster`: the RGBA plan. When `knockout_white` is set, pixels with
     `min(R,G,B) ≥ 245` get alpha 0.

   NaN and masked pixels are transparent.
5. The result goes into an LRU of 1024 tiles, keyed by `(kind, id, version, frame_epsg, z, x, y,
   style)`. The response carries `Cache-Control: immutable`, because `version` changes whenever
   the input changes (a map re-import is a new id; the drawing georef bumps `georef_version`; the
   diff uses `computed_at`).

When the source is already in the site CRS and north-up, the VRT is only a resample. The existing
per-map and per-surface pixel tile endpoints stay, for `MapEvaluateScreen` and exports.

## 7. Elevation import (plain DSM/DTM GeoTIFF)

`POST /elevations {path, name, role: dsm|dtm, captured_on?, align_to_surface_id?, cell_size_m?}`
creates a `Surface(kind="dem", status="building")` and submits `elevation_import`
(`backend/app/surfaces/elevation_import.py`). The job:

1. **Inspects** with S3's `design/dem.py`:
   - A single band is required. RGB gets the existing "this is an image — import it under Maps"
     message.
   - Sentinel nodata detection and scale/offset tags are applied.
   - **A CRS is required.** A file with no CRS fails: "this elevation file has no coordinates".
   - The date comes from `TIFFTAG_DATETIME` when `captured_on` is not given.
2. **Chooses the grid.** With `align_to_surface_id`, the output uses that surface's CRS and cell
   (`same_lattice`). Otherwise it uses the source CRS and `cell_size_m`, defaulting to the source
   cell snapped to the S2 ladder. A geographic or feet CRS without a target is refused with the S3
   `block` text.
3. **Builds** through `dem_build.py`: **copy** when `convention_problems == []` and the grid
   matches, else a **re-grid** with `tolerance=1e-9` and the coverage-mask erosion.
4. **Finishes** with `SurfaceWriter.finish()` stats and publishes `surfaces.changed`.

The dialog is F's `surfaces/ImportElevationDialog.tsx` (F §6.4, extracted from `VolumesScreen`),
**extended** with a "DSM / DTM GeoTIFF" mode; M creates no second dialog. That mode asks for:

- the file (Tauri dialog, `.tif`/`.tiff`);
- the name;
- the role (Segmented "DSM — surface incl. objects" / "DTM — bare ground");
- the survey date (prefilled from the file);
- "Align to" (a Select of ready surfaces, defaulting to the newest `cloud_dsm` or `dem` whose
  footprint overlaps).

A `dem` surface is a valid `top` or `base` everywhere S2 accepts a surface. `Surface.captured_on`
becomes a real column: for `cloud_dsm` it is filled from the cloud at build time (today it is
derived in `surfaces/service.py`), so the timeline can group surfaces by date.

## 8. Drawings

### 8.1 Data

The `drawing` table:

| Column | Meaning |
|---|---|
| `id`, `name`, `created_at`, `updated_at` | identity |
| `format` | `dxf` \| `pdf` \| `png` \| `jpg` \| `tif` \| `landxml` |
| `source_path`, `source_size`, `source_sha256` | the original file, never copied or modified (as `GeoMap`) |
| `page` | the PDF page (1-based); null otherwise |
| `status`, `error`, `job_id` | `importing` / `ready` / `failed` |
| `units` | DXF/LandXML `LinearUnit` (S3 enum); null for raster |
| `width`, `height`, `dpi` | raster: rendered pixels and DPI |
| `extent_src` | `[minx, miny, maxx, maxy]` in drawing coordinates (raster: pixels, y up = −row) |
| `layers` | DXF/LandXML: `[{name, colour, entity_count, visible_default}]` |
| `georef` | `{method: "crs" \| "control_points" \| "embedded" \| null, crs_wkt?, epsg?, model?: "similarity" \| "affine", points: [{id, src: [x, y], dst: [e, n]}], dst_crs_wkt, transform: [a, b, c, d, e, f], rmse_m, residuals_m: [...], warnings: [...]}` |
| `georef_version` | integer, bumped on every georef save; part of the tile cache key |
| `bounds_site` | cached footprint in the current site frame |
| `layer_state` | per-DXF-layer visibility and `knockout_white` (raster) |
| `captured_on` | nullable; a revision date shown in the row |

Storage in `<project>/drawings/<id>/`:

- `plan.tif`: raster; RGBA 8-bit, tiled 512, DEFLATE, overviews.
- `lines.f64` + `runs.i64` + `runlayer.i32`: flattened polylines in drawing coordinates.
- `labels.json`: text, capped at 20 000.
- `buckets.i64`: bucket index, a 64×64 grid over `extent_src` with the run ids per cell.
- `thumb.png`: 160 px.
- `source.json`.

### 8.2 Import (`drawing_import` job, two phases like S3)

`POST /drawing-inspections {path}` → phase `inspect`:

- **DXF:** RAM admission, then `ezdxf.recover.readfile`, with `virtual_entities()` exploding
  `INSERT`s (S3 §8.1 rules). The result per layer is the entity count and colour (ACI → RGB, or
  true colour). `$INSUNITS` gives the units. A `GEODATA` hint is shown as unverified, as in S3.
  DWG is refused with the S3 message.
- **PDF:** `pypdfium2` gives the page count, the page sizes in points, and a 160 px thumbnail per
  page (at most 50).
- **PNG/JPG/TIF:** size. A `.pgw`/`.jgw`/`.tfw` world file, or an embedded GeoTIFF CRS, offers
  `embedded` placement; the CRS for a world file must be confirmed.
- **LandXML:** a streamed `iterparse` (S3 §7 reader) collecting **linework only**: `Breakline`s,
  `PlanFeature` and `Alignment` `CoordGeom` `Line`/`Curve`/`Spiral` (curves chorded at 0.05 m),
  and each TIN surface's outer boundary (`<Boundary>`, or else hull edges). Surfaces themselves are
  imported as elevation through S3, and the dialog links there.

`POST /drawings {inspection_id, name, page?, dpi?, layers?, placement}` → phase `build`:

- **DXF/LandXML:**
  - Flatten entities to polylines in drawing coordinates: `LINE`, `LWPOLYLINE`/`POLYLINE` with
    bulges as arcs, `ARC`, `CIRCLE`, `ELLIPSE` and `SPLINE` via `ezdxf.path` flattening at a
    sagitta of 1 cm in metres; `HATCH` boundaries as outlines; `TEXT`/`MTEXT` as label points.
  - Write the binary run files in a stream, then build the bucket index in one pass over the
    memory-mapped runs.
- **PDF:** render the page with `page.render(scale=dpi/72, crop=…)` in **strips of 1024 rows**,
  each written as a window into `plan.tif`. The default DPI is 150 (choices 100/150/200/300).
  Output is capped at 20 000 px on the longest side and 300 MP; the dialog lowers the DPI to fit.
- **PNG/JPG/TIF:** copy into `plan.tif` window by window through rasterio. There is no whole-image
  decode.
- **Overviews and thumbnail.** Then `ready`, and `drawings.changed`.
- **Placement at build time:**
  - `crs` (DXF/LandXML: EPSG plus units);
  - `embedded` (world file or GeoTIFF);
  - `none`, which means "place with control points next". An unplaced drawing appears in the
    layers panel as "not placed". Selecting it enables the `K` tool.

### 8.3 Georeferencing by control points (the `K` tool)

- **Provisional placement.** An unplaced drawing is placed on screen with a provisional
  similarity: fit to 60% of the viewport, centred, north up, at 50% opacity.
- **Picking pairs.**
  1. The first click hit-tests the drawing layer and records `src` through the inverse of the
     current (provisional or fitted) transform.
  2. The second click records `dst` in site coordinates.
  3. The pair appears in the inspector table and on the map as numbered cyan bubbles joined by a
     dashed residual line.
- **Live fit.** Once the model's minimum is reached (2 for similarity, 3 for affine),
  `mapws/georef/fit.ts` refits live on every pair change, and the overlay snaps. This is a
  client-side preview only.
- **Save.** "Save placement" sends `PUT /drawings/{id}/georef {model, points, dst_frame:
  "site"}`. The server refits in `backend/app/workspace/georef.py` (authoritative), stores
  `dst_crs_wkt`, bumps `georef_version` and, for rasters, rewrites `plan.tif`'s geotransform and
  CRS in place (rasterio `r+`; a metadata write, so the overviews stay valid).

**Fitting maths.** Raster sources use `src = (col, −row)`, so that both spaces are y-up and a
similarity cannot need a reflection.

- **Similarity:** `E = a·x − b·y + c`, `N = b·x + a·y + f`. Linear least squares on the 4 unknowns
  over n ≥ 2 pairs, with coordinates centred on the src and dst means for conditioning.
- **Affine:** `E = a·x + b·y + c`, `N = d·x + e·y + f`, by `numpy.linalg.lstsq`, n ≥ 3.
- **Residuals.** RMSE is `sqrt(mean(|residual|²))` in metres. With exactly the minimum number of
  pairs, RMSE is 0, and the UI says "Add a point to check the fit".
- **Warnings (stored and shown; they never block):**
  - `rmse_high`: RMSE > 0.25 m.
  - `scale_mismatch`: for a vector drawing with known units, the fitted scale differs from the
    unit scale by more than 2% ("wrong units or the wrong point?").
  - `shear`: for affine, the singular values of the 2×2 part differ by more than 2%, or the axes
    are more than 1° from orthogonal ("use Similarity unless the scan is skewed").
- **Refusals:**
  - `reflection`: determinant < 0 (422, "points picked in mirrored order").
  - Collinear points for affine (422).
- **Limits.** More than 12 pairs is refused. The UI guides 2–4 pairs.

**A change of site CRS.** Points keep their `dst_crs_wkt`, and the tile path composes the fitted
transform with a pyproj transform from `dst_crs` to the site CRS.

### 8.4 Drawing tiles

- **Vector:** `GET /drawings/{id}/vtiles/{z}/{x}/{y}?v=`.
  1. Map the tile bounds (densified edges) into drawing coordinates, through the inverse affine or
     the inverse pyproj transform.
  2. Query the buckets, and clip the runs to the box plus a 2% buffer
     (`shapely.clip_by_rect`).
  3. Transform to site coordinates, and simplify with a tolerance of `res(z)/2`.
  4. Return `{layers: [{name, colour, lines: [[x0, y0, x1, y1, …]]}], labels: [{text, x, y,
     height_m, rotation}], truncated}`, capped at 20 000 vertices per tile. Past the cap, the
     shortest runs are dropped first and `truncated` is set. Labels are sent only when
     `height_m / res(z) ≥ 6` px.
- **Rendering on the client.** OpenLayers renders these with a `VectorTile` source on the site
  tile grid, with a custom `tileLoadFunction` that parses the JSON into features. It is styled
  cyan at the row's opacity and filtered by `layer_state` without refetching.
- **Raster:** a site tile of kind `drawing_raster` (§6).

## 9. Map measurements, findings, detections and zones

### 9.1 `map_measurement`

| Column | Meaning |
|---|---|
| `id`, `name`, `note`, `created_at`, `updated_at` | identity |
| `kind` | `distance` \| `area` \| `profile` |
| `crs_wkt`, `epsg` | the frame the geometry was drawn in (the site CRS at creation, or `local`) |
| `geometry` | a LineString (distance, profile) or a Polygon ring (area): ≥ 2 / ≥ 3 vertices, ≤ 5 000, and simple for area |
| `surface_ids` | profile: 1–3 surfaces drawn; distance: the optional DSM for the 3D length |
| `map_id` | the map of the `r` date at creation (context for reports) |
| `results` | computed by the server on create and PATCH |

`results` holds, per kind:

- **distance:** `length_m` (ellipsoidal, `Geod.line_length`), `grid_length_m`,
  `scale_factor`, `length_3d_m` (null without a DSM; the line densified at the cell size and
  sampled; NaN gaps reported as `nodata_fraction`).
- **area:** `area_m2` (`Geod.polygon_area_perimeter`, absolute), `perimeter_m`, `grid_area_m2`,
  `areal_scale_factor`.
- **profile:** see §9.2.

In a `local` frame, grid values only are given, labelled "local".

### 9.2 Elevation profile

The profile is **synchronous and bounded**, computed by `backend/app/workspace/profile.py`:

1. The line is densified to `n = min(2000, ceil(length / cell))` stations.
2. Each surface is converted to its CRS, and its window is read **per segment chunk** (≤ 2048²),
   at the overview level whose cell is ≥ the station step.
3. Values come from `sample_bilinear`, with strict NaN.
4. Results per surface: `{surface_id, label, date, z: [..]}`, plus `stations_m` (chainage),
   `z_min`, `z_max`, and for two series `cut_area_m2` and `fill_area_m2` between them
   (trapezoidal).

The chart is `mapws/inspect/ProfileChart.tsx`, an inline SVG in the pattern of
`surveys/SurveyChart.tsx` (no chart dependency):

- chainage on x, height on y with a vertical-exaggeration label;
- one line per surface in the date colours (left = blue, right = violet, design = dashed grey);
- the cut and fill between two series shaded red and teal;
- NaN gaps drawn as breaks.

Hovering the chart moves a marker on the map line, and hovering the line moves the chart cursor.
"Expand" opens a bottom sheet the width of the stage above the timeline.

Profile is the default tool for "what does this section look like", while cross-sections in 3D
belong to sub-project C.

### 9.3 Detections and AI

**The layer.** The AI detections layer is today's `maps/runLayer.ts`, ported to the site frame:

- `GET /map-runs/{id}/detections?bbox=…&frame=site` returns `corners` (4 site points) instead of,
  or in addition to, `x, y, w, h`.
- Below the size threshold, `density?frame=site` returns cell centres in site coordinates.
- Runs shown per visible map are the survey basis run (timeline §4, `pinned` first).
- Object types are drawn as class-colour boxes with a "Class 0.96" tag. Pending defects are drawn
  as violet dashed boxes. Accepted defects are hidden, because they are findings now.

**Review.** Review is in the inspector with the existing endpoints (`POST /map-runs/{id}/review`,
`next-unreviewed`). `Tab` (F's review key) pans to the next pending detection's cluster.

**Accepting a defect.** In `detect/review.py`, accepting a detection whose mapped catalogue type
is a `defect` also calls F's finding service in the **same transaction** as the review write and
the count increment. This mirrors F §8.5 for image boxes. The finding gets:

- `anchor = {kind: map, map_id, geometry: Polygon}`, the box's 4 corners through `Georef` into the
  map CRS, with the centroid's `lon`/`lat`;
- `created_by = model:<library_model_id>`;
- `confidence`;
- status `reviewed`, as F's image rule has it;
- the type's `default_severity`, which may be null (D4).

A new `map_detection.finding_id` column (nullable, unique) links the two, so a repeated accept
never creates a second finding. Reclassing to another defect type makes the finding's type follow.
Reject, unaccept, or a reclass to an `object` type delete the finding, using F's pattern: the API
requires `?confirm_finding_delete=true`, and otherwise answers 409 `finding_would_be_deleted`.
Deleting the finding from the inspector leaves the detection `rejected`.

**AI detect region.** `RunCreate.region = {map_id, polygon_site}`:

- The server converts the polygon to map pixels, and `plan_windows` keeps the windows that
  intersect it (with the run's overlap).
- `MapRun` gains `scope` (`map` | `region`, default `map`) and `region_px`.
- The timeline (`maps/timeline.py`), `/analytics/*` and `recount` **skip `scope = region`**. A
  test pins this.
- The job type is unchanged (`map_detect`), with the usual progress, cancel and resume. The region
  outline shows while the run is going.

### 9.4 Findings and zones on the map

**Findings.** `GET /map-workspace/findings?bbox=&map_ids=&frame=site` reads F's findings through
F's service and returns `{id, number, type_id, severity, status, created_by, geometry_site}` (F's
field names; the title is composed on the client from the type name), at most 5 000, with
`truncated`. Pins are drawn in severity colour with a static ring; the highest level gets a
thicker ring, not a loop. A pin pulses only once (at most 3 cycles) when it is created or selected
(F §4.2: no indefinite loops on static data; nothing under reduced motion). Polygons are filled at
12%. Hover shows the mockup tooltip: severity pill, type name, "F-0031 · AI + reviewed".

**Creating a finding from a tool** calls F's create endpoint with `anchor.map_id` set to the
**topmost visible ortho of the `r` date covering the click**. The geometry goes through
`POST /map-workspace/anchor {map_id, geometry_site}` → the map CRS. If no georeferenced ortho covers
the point, the tool refuses with "Findings need an orthomosaic under them".

**Zones.** The `Z` tool posts `SiteArea` with `polygon_wgs84`, converted from site coordinates by
`frame.py`, and a `category`. The existing `area_recount` job runs as today. Styles by category:
`exclusion` is hatched warn with its name in caps, as in "CRANE EXCLUSION · 35 m"; the others use
a dashed outline in the accent.

## 10. Volume in the workspace

The `U` tool draws a polygon. The server converts it with `frame=site` into the top surface CRS and
creates the measurement through the existing `POST /volumes`, which starts `volume_calc`.

**The top surface** is the elevation layer of the `r` date that covers the polygon, in the order
`cloud_dsm`, then `dem` with role `dsm`. With none, the tool is disabled with the hint "No DSM for
14 Sep 2026 — import one or build it from a point cloud".

**The four base cards** (the mockup's `opts`):

| Card | Stored `base` | Sub-label |
|---|---|---|
| Lowest point | `{kind: "toe_lowest"}`, **new** | "flat at toe min" |
| Best-fit plane | `{kind: "toe_plane"}` | "through toe vertices" |
| Design DTM | `{kind: "surface", surface_id: <design>}` (a Select when several) | the design name |
| Earlier survey | `{kind: "surface", surface_id: <DSM of l, or the newest earlier>}` | "DSM 14 Aug 2026" |

"More bases" shows `toe_surface` and `flat` as today (`volumes/MeasurePanel.tsx`). Cards without an
available surface are disabled with the reason.

**`toe_lowest`** in `volumes/bases.py` uses the same edge samples and exclusions as `toe_plane`
(S2 §6.3). The base is `z = min(kept samples)`, after rejecting the lowest 1% as outliers when
n ≥ 100. The fit output is `{samples, rejected, z}`. Neither `engine_version` nor the fingerprint
of existing results changes, because this is a new kind.

**Material.** `VolumeMeasurement.material = {name, density_t_m3}` is nullable and is not an input
to the calculation, so it does not make results stale. Tonnage is `net × density`, shown in the
inspector and added as a column to the CSV/XLSX export.

**Auto-recalculate.** An inspector switch, on by default. A change of polygon, base or masks is
PATCHed, then `POST /volumes/{id}/calculate`. While `calculating`, the numbers dim and a progress
line shows. They are never estimated client-side.

**Heatmap.** The cut/fill heatmap is a `volume_diff` site tile clipped to the polygon.

Clutter masks, exclusions and the stable area keep their S2 behaviour. They are reached from a
"Masks & alignment" disclosure in the inspector, which ports `volumeLayers.ts` roles
`stable`/`exclusion` to the site frame.

## 11. What is reused, rewritten or deleted

| Code | Fate |
|---|---|
| `frontend/src/maps/grid.ts` `scaleBar`, `maps/coords.ts` `formatNative`/`formatLonLat`, `maps/styles.ts` `tokenColour`, `maps/detectionMark.ts`, `maps/runModel.ts`, `maps/MapReviewPanel.tsx` logic, `maps/ImportMapDialog.tsx`, `maps/ExportMapDialog.tsx`, `runs/RunDialog` | **Reused** as they are, or restyled with F's primitives |
| `maps/runLayer.ts`, `maps/siteAreaLayer.ts`, `volumes/volumeLayers.ts`, `volumes/diffLayer.ts` | **Rewritten** as `mapws/layers/*` in the site frame (`frame=site` endpoints, no pixel projection) |
| `volumes/MeasurePanel.tsx`, `VolumeResultsPanel.tsx`, `model.ts`, `BuildSurfaceDialog.tsx`, `ExportVolumesDialog.tsx`, `surfaces/ImportDesignDialog.tsx` (and parts) | **Reused** inside the inspector and dialogs; `MeasurePanel` gains the base cards |
| `maps/MapView.tsx`, `MapOverlay.tsx`, `labelLayers.ts`, `LabelPanel.tsx`, `ScorePanel.tsx`, `scoreView.ts`, `labelModel.ts` | **Kept** only for `MapEvaluateScreen` |
| `screens/MapsScreen.tsx` (1 090 lines) | **Trimmed and renamed** to `screens/MapEvaluateScreen.tsx` at `/p/:projectId/maps/:mapId/evaluate`: labels, evaluation zones and score for one map in pixels, plus the "no coordinates" maps. The results, review and compare parts are deleted (they are in the workspace). |
| `screens/VolumesScreen.tsx`, `volumes/SurfaceView.tsx`, `volumes/SurfaceOverlay.tsx`, `volumes/VolumeToolbar.tsx`, `volumes/SurfaceList.tsx` | **Kept, unchanged**, as F's interim Measurements host (F §5.3). They gain one link per volume row, "Open in map" (`maps?sel=volume:<id>`). They are deleted by whichever later change rebuilds the Measurements tab on M's `GET /measurements`. New volumes are drawn in the workspace. |
| `screens/SurveysScreen.tsx` (dead code, not routed) | **Deleted** |
| `screens/SiteAreasScreen.tsx`, `AnalyticsScreen.tsx` | **Unchanged** in M. Placing them in the new shell is F's; "Draw an area" deep-links to `maps?tool=zone` instead of `?draw=site-area`. |
| Backend `app/maps`, `app/surfaces` (grid, tiles, design), `app/volumes` engine, `app/detect` | **Reused.** The additions are listed in §12. Nothing is deleted. |

The tests of deleted files are deleted with them. `e2e/maps.spec.ts` is rewritten against the
workspace (§15). `e2e/volumes.spec.ts` stays, because it still covers the interim host.

## 12. API (contract first)

`contract/openapi.yaml` is edited first, and `contract/client/schema.d.ts` is regenerated in the
same change. M owns the new tag **`workspace`** and the path groups `/map-workspace*`,
`/site-tiles/*`, `/drawing-inspections*`, `/drawings*`, `/elevations`, `/map-measurements*`. It
makes additive edits to `maps`, `surfaces`, `volumes` and `detect` operations. All paths are under
`/api/v1/projects/{projectId}`.

| Method + path | operationId | Purpose |
|---|---|---|
| `GET /map-workspace` / `PUT /map-workspace` | getMapWorkspace / putMapWorkspace | frame, persisted state, planned surveys |
| `PUT /map-workspace/frame` | setSiteFrame | change the site CRS or switch to local (`{epsg}` \| `{kind: local}`) |
| `GET /map-workspace/surveys` | listWorkspaceSurveys | `[{date, date_is_import_date, maps: [...], surfaces: [...], planned}]` for the scrubber and date chips |
| `GET /map-workspace/layers` | listWorkspaceLayers | every layer with kind, id, version, date, footprint in the site frame, `max_zoom`, meta line |
| `GET /site-tiles/{kind}/{id}/{z}/{x}/{y}?v=&style=&interval=` | getSiteTile | §6; `kind` = `map` \| `surface` \| `volume_diff` \| `drawing_raster`; PNG or 204 |
| `POST /map-workspace/anchor` | convertAnchor | site geometry → map-CRS GeoJSON for F's finding create |
| `GET /map-workspace/findings` | listMapFindingsInView | §9.4 |
| `POST /map-workspace/sample` | sampleInFrame | `{x, y, surface_ids}` in site coordinates → `z` per surface (the readout) |
| `POST /elevations` | importElevation | §7 → `SurfaceWithJob` |
| `POST /drawing-inspections` / `GET /drawing-inspections/{id}` / `GET …/pages/{n}/thumbnail` | createDrawingInspection / getDrawingInspection / getDrawingPageThumbnail | §8.2 inspect |
| `GET /drawings` / `POST /drawings` | listDrawings / createDrawing | list, build job |
| `GET /drawings/{id}` / `PATCH /drawings/{id}` / `DELETE /drawings/{id}` | getDrawing / patchDrawing / deleteDrawing | name, `layer_state`, `captured_on` |
| `PUT /drawings/{id}/georef` / `DELETE /drawings/{id}/georef` | putDrawingGeoref / clearDrawingGeoref | §8.3 |
| `POST /drawings/georef-fit` | fitDrawingGeoref | a dry-run fit (the same maths) for tests and for the dialog's embedded check |
| `GET /drawings/{id}/vtiles/{z}/{x}/{y}?v=` | getDrawingVectorTile | §8.4 |
| `GET /drawings/{id}/thumbnail` | getDrawingThumbnail | PNG |
| `GET /measurements` | listMeasurements | **M owns it.** The union for the Measurements tab and the palette (§4 item 8): `{kind: cloud\|volume\|map, sub_kind, id, name, headline, unit, data_type, data_id, status, updated_at}`, keyset-paged over the three providers. C adds the headline/status mapping for its `area` and `profile` sub-kinds to the cloud provider (C §12) |
| `GET /map-measurements` / `POST /map-measurements` | listMapMeasurements / createMapMeasurement | `?frame=site` for display |
| `GET /map-measurements/{id}` / `PATCH /map-measurements/{id}` / `DELETE /map-measurements/{id}` | getMapMeasurement / patchMapMeasurement / deleteMapMeasurement | PATCH recomputes `results` |

Additive edits to existing operations:

- `listMapDetections`, `getMapDensity`, `listSiteAreas`, `getVolumeFootprints` and
  `getVolumeMeasurement` gain `frame=site`.
- `createVolumeMeasurement` and `patchVolumeMeasurement` accept `polygon_site` as an alternative
  to `polygon_native`.
- `VolumeBaseKind` gains `toe_lowest`, and `VolumeMeasurement` gains `material`.
- `Surface.kind` gains `dem`, with `elevation_role` and `captured_on`.
- `RunCreate` gains `region`, and `MapRun` gains `scope` and `region_px`.
- `SiteArea` gains `category`.
- `reviewMapDetections` gains `confirm_finding_delete` and the `409 finding_would_be_deleted` response.

New job types are `elevation_import` and `drawing_import`. The new events are `drawings.changed`,
`map_measurements.changed` and `map_workspace.changed`.

**Schema and migration.** There is one project migration, `0012_map_workspace.py` (the id reserved
in umbrella §6 "Migration ids"; `down_revision` set to `main`'s head at merge), checked against
every live branch (ADR 2026-09-23):

- new tables `map_workspace`, `drawing` and `map_measurement`;
- new nullable columns `surface.elevation_role`, `surface.captured_on`,
  `volume_measurement.material`, `map_run.scope` (default `'map'`), `map_run.region_px`,
  `map_detection.finding_id` (unique) and `site_area.category`;
- a backfill of `surface.captured_on` from `point_cloud.captured_on`, which is best-effort: a
  failure logs and leaves it null.

`ProjectHandle.drawings_dir` is added. The startup sweep marks `importing` drawings and `building`
dem surfaces as failed ("interrupted"), and never blocks.

## 13. Budget

**Background jobs:**

- `elevation_import` (copy or re-grid);
- `drawing_import` (inspect and build: DXF parse and flatten, LandXML parse, PDF strip render,
  raster copy, overviews);
- `volume_calc`, `volume_export` (existing);
- `map_detect`, including region runs;
- `area_recount` after a zone change (existing);
- `surface_build` (existing).

Nothing else is a job. Each job has progress, cancel and a partial-output cleanup.

**Bounded synchronous reads:**

| Request | Bound |
|---|---|
| Site tile | one warped read of ≤ 258² from one overview level; LRU of 1024 |
| Drawing vector tile | a bucket lookup; ≤ 20 000 vertices out; clip and simplify on the lookup's runs only |
| Detections, findings, zones in view | bbox query, ≤ 5 000 per response, density grid below that |
| Profile | ≤ 2 000 stations × ≤ 3 surfaces; each read ≤ 2048², at an overview matching the step |
| Distance/area | ≤ 5 000 vertices, `Geod` only; the 3D length samples ≤ 20 000 points in windowed reads |
| Georef fit | ≤ 12 pairs; closed-form least squares |
| Sample (readout) | 2 × 2 cells per surface, throttled to one per 150 ms by the client |
| Surveys, layers | one row per map, surface or drawing (tens) |
| Workspace state | ≤ 64 KB JSON |

**Memory:**

- **PDF:** a strip of 1024 rows × ≤ 20 000 px × 4 B ≈ 80 MB peak.
- **DXF:** S3's RAM admission applies before `readfile` (the one step that holds the document).
  Flattening streams to files, and the index is built over memory-mapped runs.
- **Rasters:** never a whole-image decode.
- **Client:** tiles only; vectors per viewport; no full detection or finding set. Side-by-side
  doubles the tile requests but not the resolution.

**Frame budget.** F's e2e frame-time harness gets an M scenario: pan and zoom in Swipe with 4
layers visible, and divider drags. It must keep the umbrella's laptop target. Blur is on the ≤ 10
glass panels only.

## 14. Errors and edge cases

- **A map with no CRS:** not in the site frame. The Base maps group lists it greyed ("no
  coordinates — open in evaluation view"), linking to `MapEvaluateScreen`.
- **A project with no georeferenced data:** an empty state with "Import an orthomosaic", "Import
  elevation" and "Import drawing".
- **A local-only project:** the local frame. Findings are unavailable (they need a map CRS), and so
  are Geod values.
- **A site CRS change** re-fetches all tiles and vectors. Stored geometry is untouched (M5).
  `map_measurement` rows keep their own CRS and are shown converted.
- **Compare with only one survey:** the compare pill is disabled except Single, with the tooltip
  "One survey so far".
- **Dates:** two items with the same date share one tick. A null date sorts by import date and
  shows "date not set" with an inline edit (timeline §3.1). Planned dates cannot be selected.
- **Footprints that do not overlap** in compare: the empty side shows the backdrop and a centred
  glass note "No 14 Aug data here".
- **Tile of a failed or deleted layer:** 404. The client drops the layer and toasts once.
- **Drawings:**
  - A DXF with no usable entities: `drawing_import` fails, "no lines, arcs or text found".
  - All-zero extents: "empty drawing".
  - A PDF that is encrypted or has no pages: a readable failure.
  - A PDF over the pixel cap: the DPI is lowered automatically, and the dialog says so.
- **Georef:** the warnings and refusals of §8.3. Deleting the georef returns the drawing to "not
  placed".
- **Profile:** a line with no DSM under it returns 422 `no_surface_under_line`. A partial cover
  returns NaN gaps and `nodata_fraction`.
- **Volume:** no DSM for `r` (tool disabled); a polygon crossing the DSM edge (S2's nodata
  reporting); a base card without a surface (disabled). Deleting a surface used by a measurement
  returns S2's 409.
- **Review:** rejecting, unaccepting or reclassing to an object type an accepted defect answers 409 `finding_would_be_deleted` unless it is confirmed (F §8.5 pattern).
- **Region run:** a region with no unmasked window gives 422 `empty_region` before any job is
  queued.
- **pypdfium2 missing** in a broken frozen build: the drawings router loads inside the existing
  try/except in `api.py`. PDF import is disabled with the reason, and DXF and raster still work.
- **The app must start:** the migration is additive and nullable, and the sweeps log and continue.

## 15. Testing

**Backend (pytest):**

- **`workspace/grid.py`:**
  - tile ↔ bounds with negative indices;
  - `max_zoom` choice;
  - shared vectors with `siteGrid.ts` (a JSON fixture).
- **`workspace/frame.py`:**
  - round trips site ↔ map pixels ↔ map CRS ↔ WGS84 on the UTM, **rotated-geotransform** and
    UTM 38 → 39 fixtures (`tests/geotiffs.py`);
  - a box becomes a quadrilateral across CRSs.
- **Site tiles:**
  - a map in another CRS lands where pyproj says (a checkerboard fixture, ≤ 0.5 px);
  - 204 outside the footprint without I/O (a spy);
  - one read per tile (a spy);
  - transparency outside the footprint;
  - the contour renderer on an analytic plane (lines every `interval`);
  - knockout white.
- **Elevation import:**
  - the copy path and the re-grid path (reusing the S3 DEM fixtures);
  - no CRS refused;
  - RGB refused;
  - the date from the TIFF tag;
  - `same_lattice` with `align_to`;
  - a `dem` surface as a volume top and base.
- **Drawings:**
  - DXF flatten (arc, bulge, circle, spline sagitta ≤ 1 cm; INSERT nesting; OCS);
  - the bucket index returns exactly the runs crossing a box (property test against brute force);
  - vtile vertex cap and `truncated`;
  - simplify tolerance;
  - LandXML breaklines and alignments, including the northing-first rule;
  - PDF strip render equals a one-shot render on a small page (pixel-exact);
  - peak memory under the strip bound (tracemalloc on a large synthetic page);
  - encrypted PDF;
  - world file placement.
- **Georef:**
  - similarity and affine recover known transforms exactly (to 1e-9) from 2, 3 and 4 points;
  - RMSE with noise;
  - reflection refused;
  - collinear refused;
  - `scale_mismatch` and `shear` warnings;
  - `(col, −row)` handedness;
  - `plan.tif` geotransform rewritten in place, with overviews still valid;
  - the Python and TS fits agree on shared fixtures.
- **Measurements:**
  - Geod length and area against known geodesics;
  - grid versus ground scale factor on UTM;
  - 3D length on a plane (closed form);
  - the profile on a plane and a cone (closed form), with NaN gaps, the chunked read spy, and
    cut/fill areas between two planes;
  - the `GET /measurements` keyset merge across the cloud, volume and map providers, with its
    cursor and `kind` filter.
- **Volumes:** `toe_lowest` on a cone on a tilted plane (equals the analytic lowest edge height);
  outlier rejection; material does not make a result stale; `polygon_site` conversion.
- **Detect:**
  - a region run plans only intersecting windows;
  - **timeline, analytics and recount ignore `scope=region`**;
  - accepting a defect creates exactly one finding in the same transaction (a rollback test);
  - accepting an object creates none;
  - unaccept rules and the 409.
- **Contract:** `test_contract.py` covers every new operation. The migration test covers `0012`
  up from F's head, with the backfill failure tolerated.

**Frontend (vitest):**

- the tool state machine and shortcut table, registered in F's keymap (F's collision test passes:
  no M tool key equals a global or review key), and `Space` pan;
- the `?finding=` arrival (centres on the anchor, opens the inspector, redirects to the anchor's
  map);
- layer ordering within a group and the date-scoping rules;
- the compare-mode reducer (restoring the layers panel after Side-by-side);
- the timeline selection rules (planned ticks ignored, `L < R` kept);
- the swipe clip maths;
- `ProfileChart` scales and gaps;
- `georef/fit.ts`;
- `siteGrid.ts`;
- the inspector for each selection kind;
- the base cards (disabled reasons);
- `ImportDrawingDialog` and `ImportElevationDialog` steps.

**Playwright e2e** (Prism mock, then one real-backend flow):

1. Open Maps → two orthos aligned → Swipe, drag the divider → Side-by-side, where the crosshair
   shows on both → Blend slider.
2. Import a DXF with a CRS and a PDF → align the PDF with 3 points → the RMSE shows → save → the
   overlay renders.
3. Measure a distance and an area → a profile with the chart → they appear in the Measurements
   union.
4. Volume on a stockpile → switch the base cards → the numbers change after the job → heatmap
   toggle.
5. Select a pending defect detection → `A` → a finding pin appears and F's inspector opens.
6. Zone tool → a site area with a category.
7. The frame-time scenario (§13).

**Acceptance (the operator, real data):**

- the operator's two orthos plus their DSMs;
- a real DXF site plan in the site CRS (offset ≤ 0.1 m against visible features);
- a scanned PDF placed with 4 points (RMSE reported);
- one stockpile against each of the four bases;
- a cross-check of the new DSM import against the same DSM built from the cloud (median dz
  ≤ 0.02 m).

## 16. Success criteria

1. Every georeferenced ortho, elevation model and drawing in a project renders aligned in one frame,
   whatever its CRS.
2. The four compare modes work between any two survey dates. Side-by-side views stay in sync, and
   the crosshair mirrors across.
3. A DSM/DTM GeoTIFF imports as elevation with no preview step. It serves as a volume top or base
   and as a profile surface.
4. A DXF, a PDF page, a PNG and LandXML linework import and are placed by CRS or by 2–12 control
   points, with RMSE and residuals shown.
5. Distance, area and profile measurements are computed by the server, stored, and listed with the
   cloud and volume measurements.
6. The volume tool gives server-computed numbers against lowest point, best-fit plane, design DTM
   and earlier survey, on the unchanged S2 engine.
7. A finding can be dropped as a point or a polygon, and an accepted defect detection becomes a
   finding, both with a map-CRS anchor.
8. A region AI run never changes a survey count.
9. No request grows with the size of a raster, drawing or detection set. Every import is a job,
   and nothing blocks the UI.
10. The mockup's layout, shortcuts (with the `P` for Play change) and motion are implemented, and
    `check-tokens` passes.

## 17. Execution DAG

**Units:**

| Unit | Content | Needs |
|---|---|---|
| **C0** | The contract for all of §12, `schema.d.ts`, the migration `0012` with its model classes, `drawings_dir`, and the startup sweeps. One worktree, solo, so that only one unit owns the migration. | F merged |
| **B1** | `workspace/grid.py`, `frame.py`, `tiles.py`, the `/site-tiles` and `/map-workspace*` endpoints, `frame=site` on the existing vector endpoints, sample in frame | C0 |
| **B2** | `elevation_import` job and `POST /elevations`; the `Surface` columns in the service | C0 |
| **B3** | Drawings: inspect and build job (DXF/LandXML flatten and index, PDF strips via `pypdfium2`, raster copy), `georef.py`, vtiles, drawing raster tiles through B1's renderer interface (a stub until B1 lands) | C0 |
| **B4** | `map_measurement` CRUD, Geod maths, `profile.py`, the `GET /measurements` union with its three providers | C0 |
| **B5** | `toe_lowest`, `material`, `polygon_site`; region runs (`scope`, `region_px`, the timeline/analytics skip); accepting a defect → F finding; `SiteArea.category` | C0 |
| **W1** | Workspace shell: `MapWorkspace.tsx`, `SiteMap` (proj4 registration, site tile grid), all glass chrome (§5 panels), the tool store and shortcuts, `siteGrid.ts`. Built against the Prism mock. | C0 |
| **W2** | Base map and elevation layers, compare modes (swipe clip, shared View, blend), timeline scrubber, minimap, readout Z | W1, B1 |
| **W3** | Distance/area/profile tools and inspectors, `ProfileChart`, the zone tool, finding point/polygon tools with F's inspector | W1, B4 (B1 for real anchors) |
| **W4** | The volume tool and inspector (base cards, auto-recalculate, heatmap, masks port), the detection layer and review, the AI region tool | W1, B5 |
| **W5** | `ImportDrawingDialog` (and enabling F's Add data Drawing tile on it, F §6.4), drawing layers (vector tiles, raster), the align tool with `fit.ts`, the DSM/DTM mode added to F's `surfaces/ImportElevationDialog.tsx` | W1, B3, B2 |
| **X** | Trim `MapsScreen` into `MapEvaluateScreen`, delete `SurveysScreen`, add the redirects and the "Open in map" links (§11); rewrite `maps.spec`; the e2e flows and the frame scenario; acceptance evidence, walkthrough and ledger | all |

**Parallel batches** (one worktree per unit; merges into the integration branch serialized, with a
rebase and gate between each):

1. **C0** alone.
2. **B1, B2, B3, B4, B5, W1** in parallel. The five backend units touch disjoint modules. The
   shared file is `api.py` router wiring, and each unit adds one line. W1 is frontend only.
3. **W2, W3, W4, W5** in parallel, each after its backend units have merged. They share only
   `mapws/tools/toolStore.ts` and `MapWorkspace.tsx` layer registration. W1 fixes both as
   extension points (a tool registry and a layer registry), so W2–W5 add files, not edits.
4. **X.**

**Critical path:** C0 → B3 (drawings, the largest backend unit: three formats, the index,
georeferencing) → W5 → X. The near-critical branch is C0 → W1 → W2 (the compare modes and the
frame-time check). If B3 slips, W5's raster-only half (PNG/PDF with control points) can merge
first and the DXF vector tiles after it.

## 18. Risks

1. **Warped site tiles cost CPU per request** compared with today's plain windowed reads, and
   Side-by-side doubles the load. Mitigations: the overview-level read, the 204 bounds check before
   any I/O, the LRU, immutable caching, and the frame-time e2e. The fallback is to pre-render the
   site tiles of the `r` ortho in a background job if the measurements say so.
2. **Every map layer hook is rewritten for the site frame** (`runLayer`, `siteAreaLayer`,
   `volumeLayers`). The review and volume behaviours must not regress. Mitigation: the ported
   hooks keep their pure models (`runModel.ts`, `volumes/model.ts`) and their tests, and the old
   e2e flows are rewritten rather than dropped.
3. **`pypdfium2` is a new native dependency in the frozen sidecar.** Mitigations: the overlay venv
   while developing, a frozen smoke test (`smoke_frozen.ps1` renders one page), and the router
   isolation in `api.py` so that a broken PDFium only disables PDF import.
4. **Keyboard changes** against the mockup and today's `MapReviewPanel` (Play off `Space`; `L`,
   `Q`, `M`, `D` tools; `X` reject, `Tab` next, digits = severity). Mitigation: F's one app-wide
   keymap with its collision test (F §5.6), the hint pill, the `?` sheet, and an operator
   walkthrough check.
5. **Accept → finding coupling to F's API.** If F's finding service cannot join the review
   transaction, counts and findings could diverge. Mitigation: agree on it in F's spec (§4 item
   5). The fallback is an idempotent "sync findings from accepted defects" repair, keyed by
   detection id.
6. **Parallel sessions.** I and C also edit `openapi.yaml`, `api.py` and the router. C0 claims M's
   paths and migration id up front, and merges are serialized (umbrella §6).
