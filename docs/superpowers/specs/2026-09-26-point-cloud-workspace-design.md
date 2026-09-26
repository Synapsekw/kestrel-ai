---
type: spec
date: 2026-09-26
status: draft
tags: [spec, inspection-platform, pointclouds, workspace, findings, measurement, photo-link, potree]
related: ["[[2026-09-26-inspection-platform-design]]", "[[2026-09-26-foundation-design]]", "[[2026-09-26-image-inspection-design]]", "[[2026-09-26-reports-design]]", "[[2026-09-23-point-clouds-design]]", "[[2026-09-23-volumes-design]]", "[[2026-09-26-gotcha-swiftshader-compositing]]", "[[2026-09-23-gotcha-packaged-webview-needs-worker-src-blob]]", "[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]"]
---

# Point cloud workspace (sub-project C)

This is sub-project **C** of the inspection programme
([[2026-09-26-inspection-platform-design]]). The umbrella's decisions D1–D11 and its §3 domain model
bind this spec: **Finding**, **cloud anchor**, **Measurement**, **Catalogue type** and **Severity
scale** keep the names and meanings given there. C builds on S1
([[2026-09-23-point-clouds-design]]), which is merged. S1 already provides import, the octree, the
viewer, the point/distance/height/vertical measurements, the map↔3D jump and LAZ export. C turns that
screen into the full-bleed workspace from the approved mockup and adds 3D findings, new measurement
kinds and the photo link.

## 1. Goal

The operator opens a project's point cloud and inspects a structure without leaving the 3D view:

1. They orbit, pan or fly around the cloud and colour it by RGB, elevation, intensity or
   classification, with eye-dome lighting.
2. They measure a point, a distance, a height, a lean (from two picks, or from two fitted rings), an
   area on the surface, and a cross-section profile. Each result is stored and computed by the
   server.
3. They cut the view with a clipping box to see inside a structure.
4. They **pin a finding** on the cloud: a defect type from the catalogue, a severity, a note,
   photos and comments. The pin stays attached to its 3D spot, dims when the structure hides it, and
   opens a callout card.
5. They see where the drone was when each photo was taken. Clicking a spot lists the photos that
   most likely show it, and opens the best one in the Images workspace at that spot.
6. Every cloud finding and cloud measurement keeps a **stored report view**: a 1600 × 1000 PNG of the
   3D view and its camera pose. Reports (R) prints this image, because the backend cannot render
   3D.

The workspace runs smoothly on the operator's laptop with every glass panel and up to 200 pins on
screen.

## 2. Scope

**In:**

- The full-bleed workspace from the mockup (§6): tool palette, cloud panel, inspector, view gizmo,
  pick readout and minimap. All of them float over the view as glass.
- Viewer engine additions (§7): pan and fly modes, intensity and classification colour, EDL, a
  clipping box, a per-frame hook, a camera pose from a photo, and a top-down snapshot.
- Measurements (§8): the existing four kinds are kept. New are the **area** kind, the **profile**
  kind (as a background job) and a **rings** method for the vertical kind. A measurement can be
  linked to a finding.
- 3D findings (§9): the cloud anchor, HTML pins, occlusion dimming, the callout, the Findings tab
  through F's shared inspector, attachments from disk or from project images, and comments.
- Photo link (§10): drone camera positions in the cloud, the "photos that saw this point" query,
  and the image↔cloud jump contract.
- Stored report views (§11): capture, storage, the upload and serve endpoints, staleness, and
  "Refresh view".
- Performance targets and their checks (§13).

**Out (deferred, §19):** several clouds in one view and 3D survey comparison; 3D AI detection;
automatic projection of image findings into 3D; lens distortion and geoid models; saved named views;
pin clustering; draping a photo onto the cloud; exporting a clipped cloud; project-agent tools for
the workspace.

**Depends on:** Foundation F (§4, merged first), and on Image inspection I for two small things
(§4.2). S2 volumes are untouched: volumes are still never measured in the viewer (S1 §2).

## 3. Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| C1 | Screen structure | The three-column `CloudsScreen` is **replaced** by `CloudWorkspace`, with the viewer filling the whole tab area. Every control is an absolutely positioned glass panel. The route `/p/:projectId/clouds/:cloudId?` is kept. | D10. The route is the S1 jump contract, which S2 and `check:webview` already use. |
| C2 | Area geometry | **Both** areas are computed and stored: the **surface area** on the polygon's best-fit plane (the default), and the **plan area** projected horizontally. The tool's mode only picks which one is primary. The math is Newell's vector area. | A spalled patch on a chimney wall needs the surface area. A roof or slab footprint needs the plan area. Newell's method gives both from the same vertices, needs no iteration, and can be matched to 1e-9 on client and server. |
| C3 | Profile source | While drawing, the **preview** comes from the displayed octree points on the client. On **Save**, a `pointcloud_profile` background job cuts the slab from the **source file**. The stored profile and its numbers come only from the job. | Displayed points are a level-of-detail subset, the same trap S1 names for volumes. A saved profile must not depend on the camera. |
| C4 | Lean method | The vertical kind gains `params.method = "rings"`. Each end is a circle fitted in XY (Kåsa algebraic fit) to three or more picks at about one height. The lean runs between the two ring centres. `points` (the S1 method) stays the default. | The mockup asks for "two rings on the structure axis". A chimney's axis is not on its surface, so two surface picks measure the lean of one face line, not of the axis. |
| C5 | Pin rendering | **HTML pins in one absolutely positioned layer.** Positions are written as `transform: translate3d` by direct DOM writes inside the viewer's frame hook, never through a React render per frame. | This matches the mockup (glass pin heads, labels, drop animation). 500 transform writes cost well under 1 ms. A React render per frame would not. |
| C6 | Pin occlusion | There are **two tests.** Each frame, a pin whose surface normal faces away from the camera is dimmed. When the view settles, one **occlusion pass** runs: one pick render and one read-back, decoding only the pixels near each pin, and it dims any pin with a drawn point more than `max(0.3 m, 3u)` in front of it. The pass never runs while the camera moves. | Reading the depth of a potree render needs a pick render. One render when the view settles is affordable; one per pin per frame is not. The normal test covers the common case, the far side of a structure, at no cost. |
| C7 | Photo-link method | The query runs **on the client** over the cameras payload. Cameras whose orientation is known get a **frustum test** (position, gimbal yaw/pitch/roll, FOV, plus an angular tolerance for GPS and gimbal error) and a **facing test** against the picked surface normal. Cameras with position only get a **distance-ranked fallback** inside a flight-height radius. Every result says which method produced it. | There are ≤ 20 000 cameras, so one O(n) scan per click takes about 2 ms and needs no endpoint. The facing test removes the photos taken from the far side of the chimney, which pass the frustum test. |
| C8 | Camera heights | A camera's Z is EXIF GPS altitude + a **per image-set height offset** (default 0) that the operator can edit. The workspace warns when the cameras look implausible against the cloud's Z statistics. No geoid model is used. | DJI altitudes and cloud heights often use different vertical datums (the chimney cloud is ellipsoidal). S1 deferred geoid work. With about 60 m of standoff the angular tolerance absorbs a few metres. A wrong offset stays visible, not silent. |
| C9 | Image↔cloud jump | Cloud → image uses `/p/:pid/images/:imageId?at=px,py&r=rpx&from=cloud:<cloudId>`, where the pixel is in the stored image. Image → cloud uses `/p/:pid/clouds/:cid?from_image=<imageId>&px=u,v`: the viewer takes the drone's pose and picks at that pixel. `?finding=<id>` opens a pin. The S1 `?at=&fp=` contract is unchanged. | This follows S1's pattern: the coordinates are in the destination's native space and the destination needs no knowledge of its caller. Looking through the drone camera reuses `pickAtClient`, so no new ray caster is needed. |
| C10 | Anchor extras | F's anchor columns (`cloud_id, x, y, z, uncertainty_m`, F §8.1) are **not changed**. The surface `normal` at the pin and the camera pose live in C's own table **`cloud_view`** (§11), one row per cloud finding or cloud measurement. | The normal drives the facing test, the occlusion dimming and the "NE face" label. The pose makes "Fly to" reproduce the saved view. Neither is read by F, and F's anchor has a CHECK constraint, so C keeps its data in a table it owns. |
| C15 | Report views | The **workspace** captures a 1600 × 1000 PNG with its pose in two cases: automatically after a create or an anchor move, and on demand with "Refresh view". It uploads the PNG to `PUT …/view3d`, and the server stores it under the cloud folder. R reads `GET …/view3d`. | The octree is BROTLI and the source LAS is not kept, so the backend cannot render 3D (R §9.4). The client already has the loaded octree and the GPU. |
| C11 | Minimap source | The minimap shows the linked map's `getMapPreview` JPEG, placed by transforming its corners into the cloud CRS. Without a link, it shows a **top-down snapshot** of the cloud, rendered once when the view first settles. | The mockup shows an ortho. The snapshot means the minimap always works, including for clouds with no map. |
| C12 | Cloud details | S1's `CloudDetails` (CRS, map link, export LAZ, assign CRS, delete) moves into a **Details dialog** opened from the cloud picker. Nothing in it is lost. | The inspector now holds Findings and Measurements only, as in the mockup. |
| C13 | EDL | Uses potree-core 2.0.15's `PotreeRenderer` with `edl.enabled`. It is on by default and turned off in F's reduced-effects mode. | It is already in the pinned package (`dist/rendering/potree-renderer.d.ts`), so no new dependency is needed. |
| C14 | Cloud delete with findings | `deletePointCloud` answers `409 cloud_has_findings` unless called with `delete_findings=true`. The UI asks "Delete the cloud and its N findings". | A finding is inspection evidence. It must not disappear as a side effect. |

## 4. Depends on Foundation (and on Images)

C **consumes** what F ([[2026-09-26-foundation-design]]) specifies. The names below are taken from
F's spec. If F's build renames something, unit C0 (§17) adapts the imports. If a **semantic** below
is missing from F's build, that is a blocker to raise before C0 starts, not something C works
around.

### 4.1 From F

| # | What C uses | F's shape (F section) |
| --- | --- | --- |
| F-a | Aero glass primitives (F §4.4) | `GlassPanel variant="float"` (the frosted, absolutely positionable surface). `FloatingToolbar` + `ToolButton {icon, label, shortcut, active}` + `useToolShortcuts(tools)` for the palette. `Tabs` with `count` and the ink bar, `Segmented`, `Switch`, `Tooltip shortcut`, `Kbd`, `Menu`, `Dialog`, `Textarea`, `SeverityPill`, `SeverityPicker`, `TypeChip`, `StatusDot`, `Toaster`. Icons `pin`, `measure`, `layers`. Motion tokens (F §4.2). Reduced effects is `<html data-effects="reduced">` from `app/effects.ts` (F §4.3), and reduced motion is a separate setting. `Slider` (discrete stops), `Combobox` (catalogue picker) and `Popover` are **F's** primitives (F §4.4, unit DS); C does not add them. The keymap is F's (F §5.6). |
| F-b | Shell and routes (F §5.2–5.3) | The project tabs with counts; they hide on the cloud workspace, which is full-bleed (F §5.2). `/p/:projectId/clouds` and `/clouds/:cloudId` keep **`CloudsScreen`** and the exact `?at=x,y[&fp=…]` shape. C replaces the screen's body behind the same routes. F's uniform finding deep link for a cloud anchor is `/p/:pid/clouds/:cloudId?finding=<fid>` (F §8.7), which C implements (§10.4). |
| F-c | Catalogue and severity (F §7) | The project type list filtered to `kind = defect` (id, name, colour, default severity), and `useSeverityScale()`. |
| F-d | Finding core API (F §8.3) | `GET /findings?anchor_kind[]=cloud&data_id=<cloudId>&sort=-severity&limit=500` (keyset-paged). `POST /findings {type_id, anchor, severity?, note?}`, where `severity` defaults to the type's default. `PATCH` accepts `anchor.geometry` for cloud anchors, which C uses for **Move pin**. `DELETE`. Attachments are `POST …/attachments {path}` (a local file, which F copies into `findings/<fid>/`). Comments. `findings.changed {ids}`. `number` is shown as `F-0217`. |
| F-e | Shared inspector (F §8.7) | `FindingInspector {projectId, findingId, anchorSlot?, measureSlot?, onNavigate?}`. It renders type, severity, status, the note, attachments, comments and history itself. C fills `anchorSlot` (§9.4) and `measureSlot` (the linked measurements). |
| F-f | Data list (F §6.3) | Clouds are `point_cloud` data items whose `data_id` is the cloud id. The picker also keeps S1's `ImportCloudDialog`. |
| F-g | Migration (F §11) | `point_cloud` and `cloud_measurement` rows carry over untouched. F claims project revision `0010`; umbrella §6 "Migration ids" fixes I `0011`, M `0012`, **C `0013`**, R `0014` (F §11.1). |
| F-h | Frame-time evidence (F §4.3, §16 `effects.spec.ts`) | F's rAF frame-time probe. C extends it to the scripted orbit in §13. |

**Attaching a project image.** F's attachment POST takes a local `{path}`. C passes the project
image's absolute path (the project folder plus `image.path`), and F copies it. That meets "photos
from project images" with no change to F, at the cost of one copy per attachment.

**The anchor.** C uses F's cloud anchor columns as they are: `cloud_id, x, y, z, uncertainty_m`.
The normal and the camera pose are C's own data in `cloud_view` (C10, §11).

### 4.2 From Images (I)

- **Pose columns** (I §7.3, migration `0011`, with the `image_metadata` backfill job). I reads them
  from the **source** file's XMP, because the prepared JPEG keeps EXIF but drops XMP:
  - `gimbal_yaw` (clockwise from north), `gimbal_pitch` (−90 = nadir), `gimbal_roll`;
  - `flight_yaw`, used as the yaw fallback under I's sanity rule;
  - `rel_alt`;
  - `focal_px`, `focal_mm`, `sensor_w_mm`, `orig_w`, `orig_h`.

  All are nullable. Without them, C runs position-only (C7 fallback). C reads them in one function,
  `app/pointclouds/cameras.py:_pose_columns`, which applies I's yaw fallback rule. A rename then
  touches one place.
- **Arrival** at `/p/:pid/images/:imageId?at=px,py&r=rpx&from=cloud:<cid>`, defined by **I §6.5**.
  - The image is centred on `(px, py)` in stored-image pixels, and zoomed so that the `r` circle fills
    about a third of the canvas.
  - A static dashed ring marks the spot, and a "Back to 3D" chip returns to `/p/:pid/clouds/<cid>`.
  - Without `at`, the image opens normally. Until I's arrival merges, the parameters are ignored
    and the image still opens.
  - I owns this code, and C's e2e only asserts the URL.

## 5. What exists, and what happens to it

S1 is complete in `frontend/src/clouds/`, `frontend/src/screens/CloudsScreen.tsx` and
`backend/app/pointclouds/`.

| Existing | Where | Fate |
| --- | --- | --- |
| Import (work copy, scan, CRS, header repair, converter, validate) | `backend/app/pointclouds/{importer,workcopy,scan,crs,lasbounds,converter,validate,admission,jobs_import}.py` | **Kept unchanged** |
| Octree serving with Range | `routes_octree.py`, `octree.py`; client `viewer/requestManager.ts` | **Kept unchanged** |
| LAZ export | `export.py`, `jobs_export.py` | **Kept**. `measurements.csv` gains `vertex_count`, `geometry_wkt` (`POINT Z`/`LINESTRING Z`/`POLYGON Z`) and the new result columns. `x1…u2` stay for the 1–2-point kinds. |
| Measurement formulas | `measure.py` ≡ `clouds/measure.ts`, pinned by `contract/fixtures/cloud-measure-vectors.json` | **Extended** (§8). The four existing kinds are byte-identical. |
| Measurement CRUD | `measurements.py`, `routes_measurements.py`, `schemas.py` | **Extended**: new kinds, `params`, `status`/`job_id`/`error`, `finding_id` |
| Viewer | `CloudViewer.tsx` (627 lines): potree-core + three, idle loop, `pickAtClient`, `pickDown`, `project`, `setOverlay`, uncertainty, diagnostics, context-loss and no-WebGL alerts | **Refactored**: the imperative engine moves to `viewer/engine.ts`, and the component becomes a thin React shell. The bottom status bar is **deleted** (the readout pill replaces it). Every existing handle method and `data-testid` is kept. |
| Viewer helpers | `viewer/{camera,materialOptions,overlay,pickAll,topmost,uncertainty,budget,idle,dispose,diagnostics}.ts` | **Kept**. `camera.ts` gains `frontView`/`sideView`/`isoView`/`poseView`. `materialOptions.ts` gains colour modes 4 (INTENSITY) and 8 (CLASSIFICATION). `pickAll.ts` gains an optional pixel filter for the occlusion pass. |
| Measure tool state | `useMeasureTool.ts` (1–2 picks) | **Rewritten** as `useCloudTool.ts`: N-pick tools, polygon close, rings grouping, profile line |
| Measure panel | `MeasurePanel.tsx` | **Split**: the arming buttons go to the palette, live results go to the hint bar and 3D labels, and the saved list goes to `MeasurementsTab.tsx`. "Copy all as CSV" (`measureCsv.ts`) is kept. |
| Jump | `jump.ts`, `useJumpArrival.ts` (S1 §10) | **Kept and extended**: `from_image`, `px`, `finding`, plus the cloud→image builder |
| Screen | `CloudsScreen.tsx` (3 columns), `CloudList.tsx`, `ViewPanel.tsx` | `CloudsScreen.tsx` becomes a 20-line route shim that renders `CloudWorkspace`. `CloudList.tsx` and `ViewPanel.tsx` are **deleted** (replaced by the picker and `CloudPanel`). |
| Details, import, export watch | `CloudDetails.tsx`, `ImportCloudDialog.tsx`, `ExportWatch.tsx`, `link.ts`, `readout.ts`, `format.ts` | **Reused as they are**. `CloudDetails` is shown inside `CloudDetailsDialog`. |
| e2e | `e2e/clouds.spec.ts`, `pointcloud-foundation.spec.ts`, `clouds-no-webgl.spec.ts` | **Rewritten** for the new layout. The SwiftShader flags from [[2026-09-26-gotcha-swiftshader-compositing]] and the "no rAF after settle" assertion are kept. |
| Image GPS | `backend/app/datasets/prepare.py:read_exif` → `image.lat/lon/alt` (degrees, metres, sign from `GPSAltitudeRef`) | **Read-only input** to the cameras endpoint (§10.1) |

## 6. Workspace layout (the approved mockup)

`ws-clouds.html`, D9 Aero glass. The viewport (`.vp`) is `position: relative; flex: 1` below F's
top bar (the project tabs hide on this full-bleed surface, F §5.2). The canvas fills it (`absolute; inset: 0`), and the renderer clear colour is the
backdrop token. The layers, bottom to top:

1. the canvas (z 0);
2. the pins layer and the 3D labels layer (z 5, `pointer-events: none` except on the pin heads);
3. the glass panels (z 10);
4. the callout (z 12);
5. the hint bar and toasts (z 20).

Every panel is an F `GlassPanel` with 14 px outer gaps and 16 px radius. Panels enter with the
mockup's staggered slide (`in-l`/`in-r`/`in-u`), timed by F's tokens (`--dur-base`, `--stagger-step`
40 ms, at most 8 steps; ≤ 400 ms; none under reduced motion) rather than the mockup's 0.10–0.38 s
delays.

| Panel | Position (mockup CSS) | Contents |
| --- | --- | --- |
| **Tool palette** | `left 14, top 14`, vertical, 38 px buttons, 6 px padding | Orbit **O** (or **V**), Pan **H**, Fly **W** · Point **P**, Distance **L**, Height **Z**, Verticality **U**, Area **Q**, Cross-section **E** · Clipping box **C** · Pin finding **M**, Photo link **I**. The three separators follow the mockup. A tooltip to the right shows the name and `Kbd`. The active tool has the accent state. The mockup's digit keys 1–6, Pan **P** and Pin **N** are replaced so that digits stay severity and the letters keep their app-wide meaning (F §5.6). |
| **Cloud panel** | `left 72, top 14`, width 282, 12 px padding, 11 px gap | (1) **Picker row**: a swatch, "*name* · *captured_on* · *n* M pts", the file/format subtitle and a chevron. It opens a `Popover` listing the project's clouds (status pill, point count) with the footer actions "Import point cloud…" (`ImportCloudDialog`) and "Details…" (`CloudDetailsDialog`). (2) **Colour by** `Segmented` RGB / Elevation / Intensity / Class. (3) Ramp bar and legend: the elevation range in m; intensity min–max; per-class chips with counts from `class_counts`, where clicking a chip toggles that class's visibility; for RGB, "True colour". (4) **Point size** slider, 0.5–4 px. (5) **Point budget** slider with stops 1 / 2 / 3 / 5 / 8 M, showing "3.0 M shown". The key `kestrel.clouds.pointBudget` is kept. (6) **EDL shading** switch. (7) **Show camera positions** switch, with "*n* photos · *m* with angles" and the height-offset control below it (§10.2). |
| **Inspector** | `right 14, top 14, bottom 204`, width 330 | `Tabs` **Findings *n*** \| **Measurements *n***, with a scrolling body (§9.4, §8.5) |
| **View gizmo** | `left 72, bottom 14` | A 64 px SVG axis gizmo: X (E) pink, Y (N) blue, Z (up) teal. Axes pointing away are drawn at 45 % opacity, and it is redrawn from the camera quaternion on each frame. Clicking an axis head looks along it. Next to it is a 2×2 grid: **Top / Front / Side / Iso**. |
| **Pick readout** | `bottom 14`, centred pill | A live dot, **E**, **N** and **Z** (mono, 2 decimals in the pill; the full 3 decimals appear in the inspector), then **Spacing** (the pick uncertainty *u* at the cursor, in the warn tone above 0.10 m), then "EPSG:*n* · m". It shows `—` while idle. |
| **Minimap** | `right 14, bottom 14`, 330 × 178 | Header "Site map" and the source label ("Ortho · *date*" or "Cloud · top view"). It shows the underlay (C11), the cloud bounds outline, finding dots in severity colours, the clip-box footprint, the profile line, and the camera dot with a view cone of half-angle hfov/2, 70 px long. Clicking recentres the orbit target on that XY and keeps the distance. |
| **Hint bar** | `top 14`, centred pill | Shown while a tool is armed: the tool name, its hint (the mockup's `HINT` strings) and `Kbd`. It also carries the tool's options (area Surface/Plan, profile thickness, lean Points/Rings), the live result, and **Save** (Enter) / **Cancel** (Esc). For orbit/pan/fly it fades after 2.4 s. |
| **Callout** | Anchored to the selected pin, width 290 | §9.3 |
| **Profile panel** | Bottom, between the gizmo and the minimap (`left 72+gizmo+14 … right 358`), height 220, collapsible | §8.3 |

**Keyboard.** The keymap is F's app-wide one (F §5.6). The keys only work when focus is not in a
text field (`isTypingTarget`, from F's `ui/keymap.ts`) and no modifier other than the ones shown is
held.

- The tool keys are listed in the palette row above; the view presets are **Alt+1** Top,
  **Alt+2** Front, **Alt+3** Side, **Alt+4** Iso.
- **F** fits the whole cloud (global). S1's **T** top view moves to **Alt+1**, because T is the
  app-wide type picker.
- **Esc** cancels the active tool, and a second Esc returns to Orbit.
- **Enter** saves the tool's result.
- **Backspace** removes the last vertex.
- **Del** deletes the selected pin, after confirmation.
- **Space** held pans temporarily from any tool (global).
- The review keys apply to the selected finding: **1–9** set its severity and **T** opens the type
  picker. **A**/**X** have nothing to act on in C (there are no 3D detections) and are reserved.
- In fly mode (pointer lock), **W A S D** move, **Q E** move down and up, **Shift** is fast, and
  **Esc** leaves fly mode. This is F's one sanctioned exception: the review keys are suspended
  while fly mode is active.

F's keymap vitest pins that no C tool key equals a global or review key; C's own test pins that no
two C tools share a key.

**Empty and non-ready states** keep S1's copy: no clouds shows the `EmptyState` "Import a LAS or LAZ
point cloud". An importing cloud shows a centred glass card with the import progress
(`useTrackedJob`). A failed cloud shows its `error` with "Import again" and "Delete". The floating
panels that need a ready cloud are not rendered in these states.

## 7. Viewer engine

`viewer/engine.ts` owns the renderer, scene, camera, controls, potree, the overlay group and the
render loop. The idle rule of S1 still holds: the loop runs while nodes load or for 1 s after input,
then stops. `CloudViewer.tsx` keeps its forward-ref handle, and the handle gains the members below.

- **Navigation modes** `setNavMode("orbit" | "pan" | "fly")`:
  - **orbit** is S1's `OrbitControls` (Z up, `zoomToCursor`, double-click retargets).
  - **pan** swaps the mouse buttons so a left drag pans.
  - **fly** is `viewer/flyControls.ts`, about 120 lines and written here. It uses pointer-lock mouse
    look with no roll, and moves with WASD/QE at a speed of `clamp(distanceToTarget, 1, siteDiagonal)
    / 4` m/s (Shift × 4). It keeps the loop alive while a key is held. Leaving fly mode sets the orbit
    target 10 m ahead of the camera. three's `FlyControls` was rejected because it rolls.
- **Views**: `setView("top" | "front" | "side" | "iso" | "fit")`.
  - Front looks north from the south, Side looks west from the east, and Iso looks from the
    south-east at 35° elevation.
  - The distance is `1.1 × siteDiagonal`, as `wholeSiteView` uses.
  - The move is a 350 ms ease-out tween of position and target, and an instant jump under reduced
    motion.
- **Colour**: `pointColorType` is RGB 0, HEIGHT 3, INTENSITY 4 or CLASSIFICATION 8.
  - The modes available come from `pco.pcoGeometry.pointAttributes`: a mode whose attribute is
    missing is disabled with the tooltip "this cloud has no intensity".
  - The intensity range is p2–p98 of a ≤ 100 k sample taken from the visible nodes' `intensity`
    arrays at the first settle. No backend change is needed.
  - Class visibility uses `material.classification[code].visible`, with ASPRS standard colours
    (`viewer/classes.ts`: 2 Ground, 3–5 Vegetation, 6 Building, 9 Water, 17 Bridge, and so on).
- **EDL**: `PotreeRenderer({edl: {enabled, strength: 1, radius: 1.4}})` replaces
  `renderer.render(scene, camera)`. The overlay group and camera glyphs stay on layer 0, so they draw
  in the first pass.
- **Clipping box**: `setClipBox({centre, size, yawDeg} | null, mode)`.
  - It uses `createClipBox` with a Z rotation matrix, `material.setClipBoxes`, and `clipMode`:
    `CLIP_OUTSIDE` (show inside), `HIGHLIGHT_INSIDE`, or `DISABLED`.
  - **Picks respect the box.** Hits from `pickAllPoints` outside the box are dropped before
    `nearestToCentre`.
  - If the potree picker still renders clipped points (they would occlude the points behind them),
    the engine copies the clip boxes onto the picker's material while wrapping the picker statics, as
    `pickAll.ts` already does. A vitest on a synthetic hollow box pins this behaviour.
- **Frame hook**: `onFrame(cb: (cam: FrameCamera) => void): () => void`. It is called after each
  render with the view-projection matrix, the canvas rect, the camera position and the camera
  direction. Pins, 3D labels, the gizmo and the minimap cone all use it. Nothing runs while the loop
  is idle.
- **Pose camera**: `lookThrough(pose)` places the camera at a drone pose (position, forward, up),
  sets the vertical FOV so that the photo's frame fits inside the canvas (letterboxed), and returns
  a `toCanvas(u, v)` mapper from photo pixels to canvas client coordinates.
- **Slab sampler**: `sampleSlab(a, b, thicknessM, maxPoints = 300_000)`.
  - It reads the CPU-side position (and rgb) arrays of the visible nodes, offset by each node's
    world matrix in float64.
  - It keeps the points with `|t| ≤ thickness/2` and `0 ≤ s ≤ |b − a|`.
  - It returns `{s, z, rgb}` typed arrays. It is throttled to 5 Hz while a line end is dragged.
- **Snapshot**: `topSnapshot(px = 512)` renders one frame into a render target with an orthographic
  camera looking straight down (the `pickDown` setup) and returns an `ImageBitmap` for the minimap.
- **Occlusion pass**: `occlusion(points: Vec3[], tolM: number[]): boolean[]`.
  - It projects the points, runs one `pickAllPoints` render per canvas half with its window sized to
    the half's short side, and decodes only the pixels within 3 px of each projected point.
  - It returns `true` when a decoded point is nearer the camera by more than `tolM[i]`.
  - It is called only when the loop goes idle, and at most once per settle.
- **Capture**: `capture(pose, marks, {timeoutMs = 10_000}): Promise<Blob>` produces the report view
  (§11).
  1. It freezes the visible view behind a "Saving view…" chip.
  2. It drives `potree.updatePointClouds` with a capture camera (the pose, aspect 1.6) until
     `nodesLoading == 0` or the timeout, at the current point budget.
  3. It draws `marks` as temporary WebGL overlay shapes, because HTML pins are not in the canvas. A
     finding is a screen-constant pin sprite in the accent colour with a white ring, deliberately
     **not** the severity colour, so a regrade never makes the image stale. A measurement is its
     overlay geometry.
  4. It renders once into a 1600 × 1000 `WebGLRenderTarget` through the same `PotreeRenderer` (so
     EDL is on when it is on screen), reads the pixels, flips them, and encodes a PNG with
     `OffscreenCanvas.convertToBlob`.
  5. It restores the camera, removes the marks and unfreezes the view.

  A timeout still captures, and the upload then says `complete: false`. When EDL cannot render to a
  target (checked in V1), captures are taken without EDL and record `edl: false`.
- **Diagnostics hook** (S1). It gains `frameTimes()` (a ring buffer of the last 600 frame
  durations), `pins()` (the projected pins with their dimmed state) and
  `setNavMode`/`setView`/`scriptOrbit(seconds)`, which the e2e and acceptance runs use.

## 8. Measurements

### 8.1 Storage (extends `cloud_measurement`, S1 §3; umbrella §3 Measurement)

| Column | Change |
| --- | --- |
| `kind` | + `area`, `profile`. The enum is `point \| distance \| height \| vertical \| area \| profile`. |
| `points` | JSON `[{x, y, z, uncertainty_m, group?}]`. The counts are: point 1; distance, height and vertical (points) 2; vertical (rings) 6–64, with `group` 0 or 1 and at least 3 per group; area 3–200; profile 2 (the section line). |
| **+** `params` | JSON, nullable. Area: `{mode: "surface" \| "plan"}`. Vertical: `{method: "points" \| "rings"}`. Profile: `{thickness_m, max_points}`. |
| **+** `status` | `ready` \| `computing` \| `failed`, default `ready`. Only a profile is ever `computing`. |
| **+** `error`, `job_id` | Nullable. Set for profile jobs. |
| **+** `finding_id` | Nullable FK to F's `finding.id`, `ON DELETE SET NULL`. Filled by "Attach to finding…". |

It is **one** Alembic revision, `0013_cloud_workspace`. It holds these columns, `cloud_camera_offset`
(§10.1) and `cloud_view` (§11.2).

- F reserves `0010`. Umbrella §6 "Migration ids" fixes I `0011`, M `0012` (M §12), **C `0013`**
  and R `0014`; the numbers are reservations, not a merge order.
- `down_revision` is set at build time to the actual head.
- Heads are re-checked across every branch before merging, per
  [[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]].

Existing rows get `status = 'ready'` and `params = null`. The cap of 1 000 measurements per cloud
stays.

### 8.2 Formulas (`measure.py` ≡ `measure.ts`, extended vectors file)

The S1 formulas are unchanged. New results fields, all nullable numbers:

- **Area** (vertices P₀…Pₙ₋₁ in native coordinates, the polygon closed implicitly). The vertices
  are first translated to their centroid, to avoid float cancellation at UTM magnitudes.
  - **N** = ½ Σ Pᵢ × Pᵢ₊₁ (Newell).
  - `area_surface_m2 = ‖N‖`, `area_plan_m2 = |N_z|`.
  - `perimeter_m = Σ‖Pᵢ₊₁ − Pᵢ‖`.
  - n̂ = N/‖N‖; `plane_rms_m = √(mean((Pᵢ − C)·n̂)²)`.
  - `plane_tilt_deg = acos(|n̂_z|)` (0 = horizontal, 90 = a vertical wall).
  - `plane_azimuth_deg`: the grid bearing of the horizontal part of n̂, oriented towards the camera
    side. That orientation is taken from `params.view_dir`.
  - `area_m2` equals the mode's primary value.
  - `uncertainty_m2 = perimeter × rms(uᵢ)`, a band estimate.
  - The server refuses (422) fewer than 3 or more than 200 vertices (`wrong_point_count`), a polygon
    that self-intersects when projected onto the plane (`self_intersecting`), and a surface area
    below 1e-4 m² (`degenerate_polygon`).
  - `plane_rms_m > max(0.05, 0.05·√area)` is not refused. The UI shows "vertices are not coplanar;
    the surface area is the largest projected area".
- **Vertical, rings.** For each group, a Kåsa least-squares circle is fitted in XY to the group's
  picks, with z = the mean of the group's z.
  - The fit gives `ring_radius_{lower,upper}_m` and `ring_rms_{lower,upper}_m` (the RMS radial
    residual).
  - The two centres, each with uncertainty `√(rms² + mean(uᵢ²)/k)`, feed the S1 vertical formulas
    unchanged.
  - The server refuses fewer than 3 picks in a group, collinear picks (condition number > 1e8), and
    a vertical span between the centres below 0.5 m (the existing `vertical_span_too_small`).
- **Profile.** The section frame is the line A→B, with s along the line from A, t across it and
  z up.
  - The job fills `profile_length_m`, `profile_z_min`, `profile_z_max` and `profile_point_count`.
    It also fills `profile_width_max_m`: the largest horizontal extent of the points at any one
    height in 0.1 m bins, which is the shell thickness in a chimney section.
  - The server refuses a line under 0.1 m or over 2 000 m, and `thickness_m` outside 0.01–5 m.

`contract/fixtures/cloud-measure-vectors.json` gains area cases: a unit square, a tilted
rectangle, a vertical wall patch, a non-planar quad and a 200-vertex circle. It also gains rings
cases, including a synthetic 1.000° leaning cylinder. vitest and pytest read the same file and agree
to 1e-9.

### 8.3 Tools

The tools are armed from the palette or by their keys. `useCloudTool.ts` holds the picks, and the
3D overlay goes through `setOverlay("tool", …)` using the existing `overlay.ts` shapes. A 3D label
pill (the mockup's `.mlabel`, for example "**12.84 m** · Δz 11.02 m") is placed at the segment or
polygon centroid through the frame hook.

- **Point, Distance, Height, Verticality (points)**: these behave as in S1 §9.1. Hover picking
  stays at ≤ 10 Hz.
- **Verticality (rings)**: the operator picks three or more points around the lower ring, presses
  **N** (next ring; Space is F's global hold-to-pan) to start the upper ring, picks three or more
  points there, and presses Enter. Each ring is
  drawn as a fitted circle, with its centre and the axis line between the centres.
- **Area**: each click adds a vertex. Clicking the first vertex, double-clicking or pressing Enter
  closes the polygon. The overlay draws a closed line and a translucent fill (a new `polygon` shape
  in `overlay.ts`, triangulated in the plane). The hint bar switches between **Surface** and
  **Plan**.
- **Cross-section**: the operator clicks A, then B. B's height is taken from A, so the line is
  horizontal in 3D.
  - The slab (the thickness from the hint bar, default 0.20 m) is shown by setting the clip box to
    the slab with `HIGHLIGHT_INSIDE`, rotated to the line's bearing.
  - The **profile panel** opens with the preview from `sampleSlab`. It draws an s–z scatter on a 2D
    canvas in the display colours, with an aspect-true toggle (1:1 metres), a metre grid, and pan
    and zoom.
  - Inside the panel, two clicks give a distance, Δs and Δz between points of the profile. These are
    client-only helpers, and "Save as distance" turns one into a normal 2-point measurement at the
    corresponding 3D points (s, t = 0, z).
  - **Save** creates the measurement (`status: computing`) and starts the job. The panel then
    shows "Preview · display points" until `cloud_measurements.changed` reports it `ready`, and then
    loads the stored profile, labelled "Full resolution · *n* points".

### 8.4 `pointcloud_profile` job (`app/pointclouds/profile.py`, `jobs_profile.py`)

1. **Pre-check.** The source must be reachable with an unchanged size and mtime, exactly as the S1
   export pre-check. Otherwise the job fails with the same messages, and the measurement is set to
   `failed` with that `error`.
2. **Stream.** `laspy.open(source).chunk_iterator(2_000_000)`. For each chunk, s and t are computed
   in float64 relative to A, and the points with `|t| ≤ thickness/2 ∧ 0 ≤ s ≤ L` are kept as float32
   (s, z) plus uint8 rgb. Progress is reported by points, and cancellation is checked between chunks.
3. **Bound.** When the kept buffer passes 2 M points, it is thinned in place on a 2D (s, z) grid.
   The cell is `max(scale, L / 4000)`, and the point nearest each cell centre is kept. The final
   output is thinned to `max_points` (default 200 000, maximum 500 000).
4. **Write.** The job writes `<cloud>/profiles/<measurement_id>.json`: `{s, z, rgb}` rounded to the
   millimetre, a header with the parameters, and the source sha256. It fills `results`, sets
   `ready`, and publishes `pointclouds.changed`.
5. **Sweep.** `app/pointclouds/startup.py` gains one step: a `computing` measurement whose job this
   process does not hold becomes `failed` with "interrupted by application restart; save the profile
   again", and orphan `profiles/*.partial` files are removed. The step logs and continues.

Measured budget (to be confirmed in G): the chimney LAS (21.7 M) takes about 3 s, and 195 M LAZ
takes about 60 s. Peak memory is about 250 MB for the chunk plus ≤ 2 M × 11 B.

### 8.5 Measurements tab

This tab is the saved list for this cloud, from `listCloudMeasurements` (at most 1 000 rows, so it
is not paged).

- Each row (the mockup's `.li`) shows the kind label, the name, the primary value and a subtitle.
  A `computing` row shows a spinner, and a `failed` row shows its error with a Retry action (which
  re-posts the job for the same measurement).
- Selecting a row flies to the measurement (the pose in its `cloud_view`, else `lookAt` its centroid
  at 30 m) and shows the geometry.
- The details section shows:
  - the vertex coordinates (E N Z, 3 decimals), and every result with its uncertainty;
  - rename and the note;
  - **Attach to finding…** (a `Combobox` of this cloud's findings, which sets `finding_id`);
  - the **report view** thumbnail with **Refresh view** (§11.3), and a "stale" pill when there is one;
  - Delete, and "Copy all as CSV".
- A finding's callout and inspector list the measurements linked to it.

## 9. 3D findings

### 9.1 Anchor

A pin is a Finding (umbrella §3, F-d) with F's cloud anchor `{cloud_id, x, y, z, uncertainty_m}`,
plus C's `cloud_view` row (§11).

- `x, y, z` is the picked source point in the cloud's native CRS, never a display-space position.
  `uncertainty_m` is S1's `u` at pick time.
- The **normal** (`cloud_view.anchor_normal`) is estimated at pick time by PCA over the
  `pickAllPoints` hits inside the 15 px pick window that lie within `3u` of the pick.
  - It is the smallest-eigenvalue eigenvector, oriented towards the camera.
  - It is null with fewer than 8 hits, or when λ₁/λ₂ > 0.3 (no clear surface).
  - A pin whose view has not been saved yet, or whose view upload failed, has no normal. It is never
    dimmed by the facing test, only by the occlusion pass.

### 9.2 Pins

- **Data.** Two calls:
  - `GET /findings?anchor_kind[]=cloud&data_id=<cloudId>&sort=-severity&limit=500`. Beyond 500, the
    Findings tab says "500 of *N* pins shown" (clustering is deferred).
  - `GET …/pointclouds/{cloudId}/views`, which returns the normals, poses and staleness for every
    finding and measurement of the cloud (§11.2).

  Both refetch on `findings.changed` and on `pointclouds.changed`.
- **DOM.** One absolutely positioned `div` per pin inside `#pins`, with the mockup markup: a `.drop`
  with a rotated glass head in the severity colour, a `.shadow`, a `.ring` and a `.plab` label
  "Severity · Type" shown on hover. A finding with no severity uses the neutral colour and the label
  "Ungraded".
- **Per frame** (frame hook, C5). Each pin is projected in float64 relative to the overlay origin.
  If it is behind the camera or outside the canvas → `hidden`. If it is outside an active clip box
  in show-inside mode → `hidden`. If its normal faces away (`(camera − P)·n < 0`) → `back`
  (opacity 0.38, the mockup's `.pin.back`). Otherwise the transform is written. The per-frame pass
  keeps no state between frames beyond each element's last written class.
- **On settle.** The occlusion pass (§7) runs over the visible pins, with tolerance `max(0.3, 3u)`,
  and adds `back` to the occluded ones. The first camera change clears the flag.
- **Motion.** The drop animation plays once, when a pin is created or first loaded. The `.ring`
  pulse plays **three cycles**, only on the selected or newly created pin. The mockup's infinite
  pulse is not used, because it would repaint under the glass panels for as long as the view is
  open ([[2026-09-26-gotcha-swiftshader-compositing]]). There is no motion under reduced motion.
- **Click** selects the pin: the inspector switches to Findings with this row, and the callout
  opens.

### 9.3 Callout

The mockup's `.callout`: a 290 px glass card placed beside the selected pin.

- **Placement.** It goes 30 px to the right of the pin, unless it would pass `canvas width − 360`
  (the inspector), in which case it goes to the left. Its top is clamped to
  `[12, height − h − 70]`. The arrow points at the pin, and the card is hidden while the pin is
  hidden.
- **Header.** The reference and a derived location ("Z 52.0 m · NE face", from `z` and the compass
  of `normal`'s horizontal part, or "Z 52.0 m" without a normal), the type and a severity pill, and a
  close button.
- **Body.**
  - The note, clamped to 4 lines.
  - Two thumbnails: the first two attachments, or, when there are none, the top two photo-link hits
    (§10.3) labelled "Likely views", each with "Attach".
  - The footer shows the comment count and **Open in image →**, which is the cloud→image jump for
    the top photo-link hit, or the first attached project image.

### 9.4 Creation and the Findings tab

- **Pin tool (M).** A click picks and estimates the normal, and then:
  - A **draft pin** (dashed head) appears, and the callout opens in create mode. The create mode has
    a `Combobox` of the project's defect types (F-c) with the type used last preselected, a severity
    `Segmented` (default: the type's default severity, else none), a note, and **Create** (Enter).
  - Nothing is persisted until Create, because `type_id` is required. Esc discards the draft.
  - After Create succeeds, the report view is captured automatically (§11.3). The pin is usable at
    once, and the capture runs behind it.
  - A repeat pin of the same type takes two actions: a click, then Enter.
- **Findings tab.** The rows are C's compact list rows for this cloud's findings: a `TypeChip`, a
  `SeverityPill`, `F-0217` · location, and a `StatusDot`.
  - The selected finding opens F's `FindingInspector` below the list.
  - C's **`anchorSlot`** shows:
    - "Position · EPSG:*n*" with E/N/Z to 3 decimals;
    - "Uncertainty ±*u* · seen in *k* photos" (*k* is the photo-link count);
    - **Fly to** (the `cloud_view` pose, else `lookAt(P, 20 m)`);
    - **Move pin**: the next click re-picks the anchor, PATCHes `anchor.geometry`, and then
      re-captures the view;
    - "Show on map" when `map_id` is set (S1);
    - the **report view**: a 240 × 150 thumbnail of the stored PNG (or "No report view"), a "stale"
      pill when there is one, and **Refresh view** (§11.3);
    - **Likely views**: the ranked photo-link hits for P as thumbnails, each with **Attach**, which
      goes through F's attachment POST with the image's absolute path (§4.1). F's own attachment
      section adds files from disk.
  - C's **`measureSlot`** lists the linked measurements, each with "Go to".

## 10. Photo link

### 10.1 Cameras endpoint (`app/pointclouds/cameras.py`)

`GET …/pointclouds/{cloudId}/cameras` needs a cloud with a CRS (otherwise 409 `needs_coordinates`).

1. **Select.** The query reads `image.id, source_id, width, height, lat, lon, alt` plus the pose
   columns (§4.2) for the images with `lat/lon` inside `bounds_wgs84`, buffered by
   `max(100 m, 0.5 × horizontal diagonal)`. It is one column-only query and loads no image files.
   It is capped at 20 000 rows, ordered by `capture_time`, with `truncated: true` beyond the cap.
2. **Reproject.** `Transformer.from_crs(4326, cloud CRS, always_xy=True)` is applied over the arrays
   at once. `z = alt + offset(source_id)`, and a null `alt` gives `z = null` (drawn at the cloud's
   `z_stats.p99 + 30 m`, flagged).
3. **Grid yaw.** `yaw_grid = gimbal_yaw − γ`, where γ is the meridian convergence from
   `pyproj.Proj(crs).get_factors(lon, lat).meridian_convergence` at the camera. Its sign is pinned
   by a test that walks two points along a true meridian in UTM 39N.
4. **FOV.** The first available of these is used:
   - `hfov = 2·atan(orig_w / (2·focal_px))`;
   - `2·atan(sensor_w_mm / (2·focal_mm))`;
   - an assumed 84° diagonal (DJI's common wide lens), with `fov_assumed: true`.

   vfov follows from the image aspect. The FOV does not change with the prepared image's downscale.
5. **Payload** (compact arrays, never one record per image):
   - `image_id[]`, `source_idx[]`, `x[]`, `y[]`, `z[]`;
   - `yaw[]`, `pitch[]`, `roll[]` (null without a pose);
   - `hfov[]`, `vfov[]`, `width[]`, `height[]`;
   - `sigma_m[]`: 3.0. I records no RTK flag, so the value is constant for now. It is an array so
     that an RTK flag can tighten it later with no contract change;
   - `sources: [{id, label, count, height_offset_m, posed_count}]`;
   - `truncated`, and the cloud's `z_stats.p1`/`p99` echoed back for the plausibility check.

   20 000 cameras come to about 2 MB of JSON.

`PUT …/pointclouds/{cloudId}/cameras/offsets/{sourceId}` with `{height_offset_m}` (−500…500) stores
the offset in a new table, `cloud_camera_offset(point_cloud_id FK CASCADE, source_id FK CASCADE,
height_offset_m, PK both)`, in the same migration as §8.1. It publishes `pointclouds.changed`.

### 10.2 Cameras in the view

- **Show camera positions** (a cloud panel switch, default on when any camera exists).
  - Posed cameras are drawn as frustum glyphs: one `LineSegments` draw call, apex at the camera, a
    rectangle 3 m ahead scaled by hfov/vfov, in the accent colour at 65 %.
  - Position-only cameras are one `THREE.Points` draw call.
  - Both sit in the overlay group relative to the local origin (`overlay.ts`, float32-safe).
- **Glyph clicks.** A click within 8 px of a projected camera centre (a CPU scan over the cameras on
  click only) opens a popover with the thumbnail (`/images/{id}/thumbnail`), the file name, the
  capture time, **Open in Images**, and **Look through**, which calls `lookThrough` and draws the
  photo frame. Esc returns to the previous view.
- **Height offset.** A numeric input with ±1 m nudges, per image set, and a live update. A warning
  pill shows when the median camera z is below `p50` or above `p99 + 1 000 m`: "Camera heights look
  off; set a height offset".

### 10.3 "Which photos saw this point" (`clouds/photoLink.ts`, pure)

The input is the pick P with its `u`, the normal n (nullable) and the cameras payload. For each
camera c:

1. `v = P − C`, and `d = ‖v‖`.
   - With a normal, a camera with `v·n > −0.05d` is **rejected**, because the surface faces away
     from the camera.
2. **Posed** (`yaw` known). The ENU frame for yaw ψ (grid) and pitch θ is:
   - `f = (sin ψ cos θ, cos ψ cos θ, sin θ)`;
   - `r₀ = (cos ψ, −sin ψ, 0)`, rotated about f by roll φ to give r;
   - `up = r × f`.

   Then `x = v·r / v·f` and `y = v·up / v·f` (rejected when `v·f ≤ 0`). The angular tolerance is
   `α = atan(σ / d) + 2°` (gimbal yaw error). The camera is **in frustum** when
   `|atan x| ≤ hfov/2 + α` and `|atan y| ≤ vfov/2 + α`. The pixel in the stored image is
   `px = W/2 + x · (W/2)/tan(hfov/2)` and `py = H/2 − y · (H/2)/tan(vfov/2)`. The radius is
   `rpx = tan(α) · (W/2)/tan(hfov/2)`, at least 12 px. The score is
   `d · (1 + 0.5·ρ²)`, where ρ is the normalised radial pixel position (0 at the centre, 1 at a
   corner). A lower score is better.
3. **Position-only.** The camera is a candidate when the horizontal distance is at most
   `max(30 m, 1.5 · |C_z − P_z|)`. The score is d, and there is no pixel.
4. The result is the posed hits by score, then the position-only hits by score, **at most 50**, each
   with `method: "frustum" | "distance"`. The total candidate count is also returned.

When the photo-link tool (I) is active, a click runs this query. A toast says "**14 photos** saw this
point · DJI_0712 closest (9.4 m)", and a glass list popover near the click shows thumbnails with
distance and method. Clicking one runs the cloud→image jump. The Findings anchor section and the
callout use the same function. Performance: 20 000 cameras take ≤ 3 ms on the operator's laptop
(vitest benchmark, reported, not asserted).

**Accuracy stated in the UI.** A frustum hit means "likely in frame". Its ring radius covers GPS
error (±3 m) and a 2° gimbal error. Lens distortion is ignored, so near the frame
corners the mark can be off by more. "By distance" hits carry no spot.

### 10.4 Image↔cloud jump (`clouds/jump.ts`)

| Direction | URL | Arrival |
| --- | --- | --- |
| cloud → image | `/p/:pid/images/:imageId?at=px,py&r=rpx&from=cloud:<cloudId>` (the pixel is in stored-image space, so it matches `image.width/height`) | I's workspace (§4.2) |
| image → cloud | `/p/:pid/clouds/:cloudId?from_image=<imageId>&px=u,v` | `useJumpArrival`. It fetches the cameras. When the image is posed, it waits for points, calls `lookThrough(pose)` and waits for the view to settle (S1's settled-ticks rule). It then maps `(u, v)` with `toCanvas`, picks there, and targets the orbit on the hit with a pin-style marker. With no pose or no hit, it falls back to `?at=` at the camera's XY (S1 behaviour) with the toast "Camera angles unknown: showing where the drone was". |
| finding → cloud | `/p/:pid/clouds/:cloudId?finding=<id>` | Flies to the `cloud_view` pose (else `?at=` behaviour at the anchor) and opens the callout. This is the cloud row of **F's uniform finding deep link** (F §8.7, `findingHref`), which `FindingInspector`'s default `anchorSlot`, the Findings tab and R's deep links use. |
| map ↔ cloud | S1 `?at=x,y[&fp=…]` | Unchanged |

The parse and serialise helpers extend `jump.ts`. Parameters are ignored silently when malformed
(S1's rule), and `routes.tsx` documents the full contract next to the clouds route.

## 11. Stored report views

The backend cannot render 3D (R §9.4): the octree is BROTLI and the source LAS is not kept. So
every cloud finding and every cloud measurement keeps a picture the **workspace** took, together
with the pose that took it, so that the picture can be taken again.

### 11.1 What a view is

- **Image.** PNG, exactly **1600 × 1000** (R's print size, aspect 1.6), sRGB, no metadata.
- **Size cap.** 6 MiB. A PNG over the cap is re-encoded by the client as JPEG q 0.92, and the
  server accepts both.
- **Content.** The cloud in the colour mode and at the point budget on screen, EDL as on screen, the
  subject's marks (§7 Capture), and no HTML chrome.
- **Pose.** `{position: [x,y,z], target: [x,y,z], up: [x,y,z], fov_deg}` in the cloud's native CRS.
  `fov_deg` is vertical, and the aspect is fixed at 1.6.
- **Render settings.** `{colour_mode, point_budget, point_size, edl, clip_box | null,
  complete: bool}`, so a re-capture reproduces the view.

### 11.2 Storage

- **Table `cloud_view`** (C's migration, §8.1). The columns:
  - `id`;
  - `point_cloud_id` (FK, CASCADE);
  - `finding_id` (FK → F's `finding.id`, CASCADE, UNIQUE, nullable) and `cloud_measurement_id`
    (FK, CASCADE, UNIQUE, nullable), with a CHECK that exactly one is set. The API exposes them as
    `subject_kind` + `subject_id`;
  - `anchor_normal` (JSON number[3], nullable; findings only, §9.1);
  - `pose` (JSON), `render` (JSON);
  - `path` (relative: `pointclouds/<cloud_id>/views/<subject_kind>-<subject_id>.png` or `.jpg`);
  - `sha256`, `bytes`, `width`, `height`;
  - `anchor_hash`: the sha256 of the subject's geometry at capture, meaning a finding's `x,y,z`
    rounded to the millimetre, or a measurement's `points`;
  - `captured_at`.
- **Consistency.** The FK cascades remove the row when F deletes a finding or C deletes a
  measurement, so F's service needs no knowledge of `cloud_view`. The **file** left behind is
  removed by C's measurement delete directly. For findings, `app/pointclouds/views.py` sweeps any
  `views/*` file with no row, at project open (the startup step) and after each
  `listCloudViews`. A cloud delete removes the whole `views/` folder with the cloud folder.
- **Staleness.** `stale = anchor_hash ≠ hash(current geometry)`. It is computed on read, never
  stored.
- **Write.** The file goes to `views/.partial-<id>` and is then atomically replaced, followed by the
  row upsert. The startup sweep removes `views/.partial-*`.

### 11.3 When it is captured

| Trigger | Pose used |
| --- | --- |
| A finding is created (§9.4) | **Auto framing**: the current view direction, re-targeted on the anchor, at distance `clamp(current distance, 6 m, 60 m)`, fov 50° |
| A pin is moved (Move pin) | Auto framing, on the new anchor |
| A measurement is saved (any kind, including a profile at `computing`) | Auto framing of the geometry: the current view direction, fitting the geometry's bounding sphere × 1.4 |
| **Refresh view** (inspector, measurement details) | **Exactly the current camera** as on screen (what you see is what gets printed), with the aspect cropped to 1.6 |
| **Capture missing views** (a Findings-tab menu action) | For each of this cloud's findings and measurements with no view or a stale one: the stored pose when there is one (re-targeted on a moved anchor), else auto framing |

- Automatic captures run one at a time from a queue in the workspace, after the triggering request
  succeeds.
- A failed capture or upload leaves the subject without a view and shows a quiet warning toast. The
  inspector then shows "No report view · Capture".
- Leaving the workspace cancels queued captures. They are not lost: the subject simply has no view,
  or a stale one, which R reports (R §9.4) and "Capture missing views" repairs.
- **Capture missing views** is the one long-running operation that cannot be a backend job, because
  only the webview can render. It runs in the foreground with a progress bar in the hint bar
  ("Saving views 12 / 40") and Cancel. It is bounded by the 500-pin and 1 000-measurement caps, and
  takes about 2 s per view.

### 11.4 Endpoints

| Operation | Path | Behaviour |
| --- | --- | --- |
| `putFindingView3d` | `PUT /projects/{id}/findings/{findingId}/view3d` | multipart `{image, meta: CloudViewMeta}`. Pillow checks the format (PNG or JPEG), the size (exactly 1600 × 1000) and the bytes (≤ 6 MiB). 409 `not_a_cloud_finding` for other anchor kinds. 422 `bad_view_image`. → 200 `CloudViewOut` |
| `getFindingView3d` | `GET /projects/{id}/findings/{findingId}/view3d` | → 200 `image/png` or `image/jpeg`, with `ETag: "<sha256>"` and `Cache-Control: private, no-cache`. 404 `no_view`. This is R's `view3d` source (R §9.1, `source_version` = sha256). |
| `putCloudMeasurementView3d` / `getCloudMeasurementView3d` | `…/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d` | The same, for measurements |
| `listCloudViews` | `GET …/pointclouds/{cloudId}/views` | → 200 `CloudViewList {items: CloudViewOut[]}`: the metadata for every view in the cloud, with no image bytes. At most 1 500 rows. |

`CloudViewMeta` is `{pose, render, anchor_normal?}`. `CloudViewOut` is `{subject_kind, subject_id,
pose, render, anchor_normal, sha256, bytes, width, height, captured_at, stale}`. The two
`…/findings/{findingId}/view3d` paths sit under F's findings path group. They are owned by C, tagged
`pointclouds`, and named in R's spec. F's own finding routes are untouched. `pointclouds.changed`
fires after each PUT, so R's preview and open inspectors refresh.

## 12. API (contract first)

`contract/openapi.yaml` is edited first, and `contract/client/schema.d.ts` is regenerated in the
same commit by unit C0. Everything stays under `/api/v1/projects/{projectId}` with tag
`pointclouds`. C owns only these paths and schemas (umbrella §6).

| # | Change | Detail |
| --- | --- | --- |
| 1 | `CloudMeasurementKind` | + `area`, `profile` |
| 2 | `CloudMeasurementPoint` | + `group` (int 0–1, optional) |
| 3 | `CloudMeasurementCreate` | `points` maxItems 2 → 200. + `params: CloudMeasurementParams` (nullable). + `finding_id` (nullable). |
| 4 | `CloudMeasurementParams` (new) | `mode` enum `[surface, plan]`?, `method` enum `[points, rings]`?, `thickness_m`?, `max_points`? (int ≤ 500 000), `view_dir`? number[3] (the camera direction at save, used only to orient `plane_azimuth_deg`) |
| 5 | `CloudMeasurementUpdate` | + `finding_id` (nullable; null unlinks) |
| 6 | `CloudMeasurementResults` | + `area_m2`, `area_surface_m2`, `area_plan_m2`, `perimeter_m`, `plane_rms_m`, `plane_tilt_deg`, `plane_azimuth_deg`, `uncertainty_m2`, `ring_radius_lower_m`, `ring_radius_upper_m`, `ring_rms_lower_m`, `ring_rms_upper_m`, `profile_length_m`, `profile_z_min`, `profile_z_max`, `profile_width_max_m`, `profile_point_count` (all nullable) |
| 7 | `CloudMeasurementOut` | + `params`, `status` enum `[ready, computing, failed]`, `error`?, `job_id`?, `finding_id`? |
| 8 | `POST …/measurements` | A `profile` answers **202** `CloudMeasurementWithJob {measurement, job}`. The other kinds keep 201. New 422 codes: `self_intersecting`, `degenerate_polygon`, `ring_needs_three_points`, `collinear_ring`, `profile_out_of_range`. 409 `not_ready`. |
| 9 | `POST …/measurements/{cloudMeasurementId}/retry` (`retryCloudProfile`) | → 202 `JobRef`. Only for a `failed` profile, otherwise 409 `not_retryable`. |
| 10 | `GET …/measurements/{cloudMeasurementId}/profile` (`getCloudProfile`) | → 200 `CloudProfile {s: number[], z: number[], rgb: int[] \| null, count, thickness_m, length_m}`. 409 `not_ready` while `computing`. The body is ≤ 500 000 points (about 7 MB), gzip-compressed on the wire (`GZipMiddleware`, minimum 64 KiB; see Risks) |
| 11 | `GET …/pointclouds/{cloudId}/cameras` (`getCloudCameras`) | → 200 `CloudCameraSet` (§10.1). 409 `needs_coordinates`. |
| 12 | `PUT …/pointclouds/{cloudId}/cameras/offsets/{sourceId}` (`setCloudCameraOffset`) | `{height_offset_m}` → 200 `CloudCameraSource`. 404 when the source is unknown. 422 when out of range. |
| 13 | `DELETE …/pointclouds/{cloudId}` | + query `delete_findings` (bool, default false). 409 `cloud_has_findings {count}` when false and findings exist. |
| 14 | `JobType` | + `pointcloud_profile`, label "Cross-section profile", icon `cloud`, added to the six label maps S1 §5.8 lists. F may consolidate them. |
| 15 | `PUT`/`GET /projects/{id}/findings/{findingId}/view3d` (`putFindingView3d`, `getFindingView3d`) | §11.4. multipart in, `image/png` or `image/jpeg` out. 404 `no_view`, 409 `not_a_cloud_finding`, 422 `bad_view_image`. |
| 16 | `PUT`/`GET …/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d` (`putCloudMeasurementView3d`, `getCloudMeasurementView3d`) | The same, for measurements |
| 17 | `GET …/pointclouds/{cloudId}/views` (`listCloudViews`) | → 200 `CloudViewList`. Schemas `CloudViewMeta`, `CloudViewOut`, `CloudViewPose`, `CloudViewRender`. |
| 18 | `CloudMeasurementOut` | + `view: CloudViewOut \| null`, so the Measurements tab needs no second call |
| 19 | M's `GET /projects/{id}/measurements` (M owns it, M §12) | No path or schema change. C's B1 adds, in M's cloud provider, the `headline`/`unit` for the `area` (`area_m2`, m²) and `profile` (`profile_length_m`, m) sub-kinds, the rings method label for `vertical`, and `status` from `cloud_measurement.status`. Whichever of M's B4 and C's B1 merges second makes this one edit |

F's finding schemas and anchor are **not** edited (C10). No new event is added: profile
completion, camera offsets and view uploads reuse `pointclouds.changed {cloud_ids}`, and pins reuse
F's `findings.changed`. Every new operationId starts as a 501 stub in
`app/stubs.py` and `EXPECTED_STUBS`, and each unit removes its own stub (the S1 F0 pattern).

## 13. Budget

**Background jobs:**

- `pointcloud_profile`, which streams the source. It has progress, cancel and a restart sweep.
- The existing `pointcloud_import` and `pointcloud_export`, unchanged.

Every other request is a bounded read or a single-row write. The one exception is **Capture missing
views** (§11.3). It is GPU work that only the webview can do, so it cannot be a backend job. It is
cancellable, shows progress, and is bounded by the caps. The rest of the app stays usable while it
runs, and only the 3D view is frozen.

**Bounded reads:**

- Octree: streamed nodes under the point budget (1–8 M, default 3 M) and S1's Range endpoint.
- Cameras: one column-only query capped at 20 000 rows, returned as compact arrays of about 2 MB.
  It is fetched once per cloud open and on `images.changed`.
- Pins: F's paged findings list, capped at 500 drawn.
- Measurements: at most 1 000 rows per cloud (S1 cap).
- Profile body: at most 500 000 points.
- Photo link: O(cameras), on the client, per click.
- Slab preview: at most 300 000 points from already-loaded nodes, throttled to 5 Hz.
- Minimap: one map preview JPEG (about 1024 px) or one 512 px snapshot.
- Report views:
  - One upload of ≤ 6 MiB per PUT, checked by Pillow (a header read, then one decode of a
    1600 × 1000 image, which is bounded).
  - `listCloudViews` returns metadata only, ≤ 1 500 rows.
  - The capture holds one 1600 × 1000 RGBA read-back of 6.4 MB.
  - Disk is about 1.5–3 MB per PNG, so 100 findings take about 250 MB. It is stated in the
    Details dialog as "Report views: *n* · *size*".
- **No** request or step loads the image set or the point set into memory. The profile job holds
  one 2 M-point chunk plus a buffer capped at 2 M points.

**Performance targets** (the operator's laptop, packaged app, chimney cloud, 3 M budget, EDL on,
every panel shown, 200 pins, measured through `frameTimes()` over CDP):

| Metric | Target |
| --- | --- |
| Orbit frame time | p50 ≤ 20 ms, p95 ≤ 33 ms (S1 had p50 ≤ 20 ms without panels) |
| Pin pass per frame (200 pins) | ≤ 1 ms. 500 pins ≤ 2.5 ms. |
| Occlusion pass | ≤ 40 ms, once per settle, never during motion |
| Hover pick | ≤ 10 Hz, ≤ 8 ms each, never while dragging |
| Idle | 0 animation frames and no running CSS animation 1 s after settle (S1's assertion, extended to the pins layer) |
| First points / settled | ≤ 1 s / ≤ 5 s (S1, unchanged by the workspace) |
| Report view capture | ≤ 3 s from trigger to upload on the chimney (the node loading for the capture pose dominates). The visible view is frozen for no longer than that. |
| Webview memory | ≤ 2.5 GB peak at 3 M (S1) plus ≤ 50 MB for the workspace (cameras, pins, profile) |
| Reduced effects | When the p95 target fails with blur, F's reduced-effects mode (opaque 92 % glass, no EDL) must meet it. Both runs are recorded. |

## 14. Errors and edge cases

- **Cloud with no CRS.** Pins and measurements that need no distances work. Distances, area and
  profile keep S1's projected-CRS rule (422 `needs_projected_crs` for a geographic CRS). Cameras give
  409 `needs_coordinates`, and the switch says "Assign a CRS to place the drone photos". A cloud in
  degrees gives the same refusals as S1.
- **Images without GPS** are excluded from the payload. The cloud panel shows "*n* photos without
  GPS". No images near the cloud: the switch is disabled with the reason "no photos near this
  cloud".
- **No pose columns** (I not merged, or a non-DJI camera): the cameras are position-only, the
  results say "by distance", and jumps open the image without a spot.
- **Cameras implausible** against Z: the warning pill appears (§10.2). The results still show,
  because the tolerance absorbs moderate errors.
- **The clip box hides a pin's point**: the pin is hidden in show-inside mode and dimmed in highlight
  mode.
- **A pin's cloud is deleted**: C14's 409 `cloud_has_findings`. With `delete_findings=true`, the
  findings go through F's delete (attachments and comments included). Linked measurements go with
  the cloud (CASCADE).
- **A finding is deleted** in another view: `findings.changed` removes the pin, and
  `cloud_measurement.finding_id` becomes null (SET NULL).
- **A linked image is deleted**: the attachment reference is F's concern. The cameras payload
  refetches on `images.changed`.
- **Profile source unreachable or changed**: the measurement is `failed` with S1's export messages,
  and the preview stays on screen. Retry is allowed once the source is back.
- **Profile of empty space** (0 points in the slab): the job completes with `profile_point_count: 0`,
  and the panel says "No points in this slab; widen the thickness".
- **Context loss**: the pins layer and callout are hidden, S1's "Reload view" remounts, and the
  tool state and selection survive.
- **No WebGL**: S1's alert. The Findings and Measurements tabs still work as lists, and the panels
  that need the view are not rendered.
- **Jump to a finding in another cloud**: `?finding=` whose anchor names another cloud redirects to
  that cloud's URL.
- **Jump from an image outside the cloud**: S1's toast "This spot is outside the cloud".
- **Draft pin with no type**: Create is disabled. Leaving the workspace discards the draft silently,
  because nothing was persisted.
- **Report view missing** (a migrated finding, a failed upload, or the operator left before the
  queue ran): the inspector shows "No report view · Capture", R falls back (R §9.4), and "Capture
  missing views" repairs it in bulk.
- **Report view stale** (the anchor moved and the capture failed, or the geometry changed in
  another session): the "stale" pill shows, and R still prints the old image and warns. Refresh
  view, or the bulk action, fixes it.
- **Capture timeout** (nodes still loading after 10 s, for example a NAS-slow octree): the view is
  saved with `render.complete = false`, and the inspector says "saved before the view finished
  loading · Refresh".
- **Upload refused** (a wrong size or over the cap): this is a client bug, so it is logged and a
  warning toast shows. A pin or measurement never fails because of its view.
- **Context lost during a capture**: the capture rejects, the queue stops, and it resumes after
  "Reload view".
- **1 000-measurement cap and 500-pin cap**: each is stated where it bites (a 422 message, or the
  "500 of *N*" note).

## 15. Testing

**Backend (pytest).** Fixtures come from `tests/pointclouds.py` (`make_las`, `write_fake_octree`).

- **Vectors.** Area (Newell, rms, tilt, both modes, centroid translation at UTM magnitudes), rings
  (Kåsa on exact circles and on noisy circles; a leaning cylinder at 1.000°) and the unchanged S1
  cases, all against the shared JSON file to 1e-9.
- **CRUD.**
  - Each new 422 code.
  - The cap.
  - `params` round-trips.
  - `finding_id` set and unset, and SET NULL on finding delete (with F's model).
  - Existing rows migrated to `status=ready`.
- **Profile job.**
  - A synthetic LAS (a vertical wall plus ground, a known thickness) gives the expected
    `profile_width_max_m` within one scale step.
  - Slab filtering at the edges, including |t| exactly at thickness/2.
  - Thinning keeps ≤ `max_points` and preserves the z extremes.
  - Chunk boundaries (n = 2 M + 1).
  - Cancel removes the partial file.
  - Unreachable or changed source → `failed`.
  - The restart sweep.
- **Cameras.**
  - Reprojection against an independent pyproj call.
  - The meridian-convergence sign.
  - The FOV from f35, and the assumed FOV.
  - The buffer filter.
  - The 20 000 cap and `truncated`.
  - Offsets PUT and range.
  - A null `alt`.
  - The query touches no image file (a spy on `open`).
- **Delete** with findings: the 409, then `delete_findings=true`.
- **Report views.**
  - PUT accepts a PNG and a JPEG of 1600 × 1000. It refuses other sizes, other formats, more than
    6 MiB, and a non-cloud finding.
  - The file is written atomically, and a second PUT replaces it with a new sha256.
  - GET returns the ETag and the bytes, and 404 without a view.
  - Deleting a finding (through F's service) cascades the row, and the sweep removes the file.
    Deleting a measurement removes both.
  - `stale` flips when a finding's anchor is PATCHed.
  - `listCloudViews` returns no bytes.
  - A `.partial-*` file is swept at startup.
- **Migration** upgrade and downgrade on a copy of an S1 database.

**Frontend (vitest).**

- **`photoLink.ts`.** A synthetic nadir camera over P (P at the centre pixel within 0.5 px). An
  oblique camera. Behind the camera. Just outside the FOV but within tolerance. The facing test
  rejecting the far side of a cylinder. The distance fallback ordering. Roll sign. The 50 cap.
- **`measure.ts`** against the shared vectors.
- **`useCloudTool`.** Polygon close by first-vertex click, double-click and Enter. Backspace. Rings
  grouping with N. The profile line takes A's Z.
- **Engine pure parts.** `camera.ts` front/side/iso/pose views; the `toCanvas` letterbox mapping;
  the clip-box matrix; pick-hit filtering by the box; the intensity p2–p98 from a sample; the class
  LUT.
- **Pins pure pass** (`pins/project.ts`): hidden/back/visible classification from a matrix, and
  normal-facing.
- **Callout placement**: the left/right flip and clamping.
- **Jump parse/serialise** for `from_image`, `px`, `finding` and cloud→image. Malformed input is
  ignored.
- **Keyboard map**: unique C keys, and F's collision test passes (no C tool key equals a global or
  review key, F §5.6); fly mode suspends the review keys.
- **Minimap**: the corner transform of a map in another CRS, and the cone geometry.
- **`measureCsv.ts`**: WKT for area and profile.

**e2e (Playwright, Prism mock plus `page.route`, the in-memory octree fixture, the SwiftShader
flags per the ADR).**

1. Layout: every panel is at its mockup position, the canvas box equals the viewport box, and the
   callout never overlaps the inspector.
2. Tool keys arm tools and the hint bar text changes. Esc and Esc again returns to Orbit.
3. Pin flow: M, a scripted pick, the draft callout, choosing a type, Enter → `createFinding` called
   with F's cloud anchor (`cloud_id, x, y, z, uncertainty_m`, no extra fields, C10) → a
   `PUT …/view3d` carries `anchor_normal` in its meta → the pin is shown → reload → the pin comes
   back.
4. Occlusion: a pin behind the fixture's wall gets `back` after settle.
5. Area: 4 picks, Enter → the POST body has 4 points and `mode` → the row shows the area.
6. Cross-section: two picks → the profile panel shows the preview → Save → 202 → a mocked
   `pointclouds.changed` → "Full resolution".
7. Colour modes: Intensity and Class are disabled when the fixture lacks the attributes, and enabled
   with a fixture that has them.
8. Cameras: the switch shows glyphs, a glyph click opens the popover, and "Look through" changes the
   camera.
9. Photo link: I, a pick → the list → a click navigates to `/images/<id>?at=…&r=…&from=cloud:…`.
10. Arrival from `?from_image=&px=` (posed and position-only) and from `?finding=`.
11. Idle: 0 rAF and no running animations 1 s after settle with 50 pins.
12. Report view:
    - After a pin is created, a `PUT …/view3d` arrives with a 1600 × 1000 PNG (decoded in the test)
      and meta `pose`.
    - Refresh view sends the current camera's pose.
    - "Capture missing views" walks 3 subjects with progress and stops on Cancel.
    - The capture image is not uniform (the pixel sample of `sampleColours` on the blob), which
      guards against a blank render-target read-back.
13. The frame-time harness (F-h) runs a scripted orbit with 200 pins. It is reported on
    SwiftShader, not asserted there.

**Packaged.** `check:webview` (S1 §13) gains EDL on and 50 pins, and its colour and pick assertions
are kept. The acceptance frame-time run (§16) uses the packaged exe on the operator's laptop.

The AGENTS.md §4 gate applies to every unit, and `check-tokens` must be clean.

## 16. Success criteria

1. On the chimney cloud, every panel matches the mockup's position and content. A side-by-side
   screenshot against `ws-clouds.html` is recorded in `docs/evidence/`.
2. **Pins.** Five findings are pinned on the chimney, the app is restarted, and each pin reappears
   within its `u` of the original spot. Pins on the far side dim when the stack hides them.
3. **Area.** A synthetic 2 m × 1.5 m patch tilted 60° reports a surface area of 3.000 m² ± 0.5 % and
   a plan area of 1.500 m² ± 0.5 %. The server and client values are equal.
4. **Rings.** On the synthetic cylinder leaning 1.000° towards grid east, the ring method reports
   1.00° ± 0.01° and direction 90° ± 0.5°, which is tighter than the two-point method's ± 0.02° on the
   same data. On the chimney, both methods are recorded in `docs/progress.md`.
5. **Profile.** A 0.2 m section across the chimney stack completes in ≤ 10 s from local SSD, and
   `profile_width_max_m` equals the shell thickness measured by hand with S1 distances within 2 cm.
   195 M LAZ takes ≤ 90 s.
6. **Clip box.** With show-inside, picks never land outside the box (20 scripted picks).
7. **Photo link.** On a real posed DJI flight over a structure (the operator's data; the chimney
   flight if its photos are available), 10 picks each list at least one photo whose opened spot
   ring, checked by eye, contains the picked feature. The facing test removes every far-side photo
   in those lists.
8. **Image → cloud.** From 5 photo pixels on the structure, the arrival pick lands within 1 m of the
   same feature picked by hand in 3D (posed images).
9. **Performance.** §13's targets are met, with or without reduced effects, and both runs are
   recorded.
10. **Report views.**
    - Every finding and measurement created during acceptance has a 1600 × 1000 view within 3 s.
    - After Move pin, the view is re-captured and no longer stale.
    - R's `GET …/view3d` serves the bytes whose sha256 is in `listCloudViews`.
    - A report built by R on the chimney shows the 3D figure for each cloud finding with no
      placeholder.
11. **Gate.** The full gate passes, and the walkthrough covers every tool.

## 17. Execution DAG

**Units** (each in its own worktree under `.claude/worktrees/c-<unit>`; the migration and contract
are only edited in C0):

| Unit | Contents | Needs |
| --- | --- | --- |
| **C0** | Contract rows 1–18 (§12), the migration `0013` (§8.1: `cloud_measurement` columns, `cloud_camera_offset`, `cloud_view`), 501 stubs and `EXPECTED_STUBS`, `JobType` and label maps, `jobs_profile.py` registered as a stub, the empty startup sweep steps, adapting to F's final names (§4) | F merged |
| **B1** | `measure.py` area and rings, vectors file, CRUD extensions, `finding_id`, CSV columns, the `area`/`profile` headline mapping in M's measurements cloud provider (§12 row 19, when M's B4 is on `main`) | C0 |
| **B2** | `profile.py`, `jobs_profile.py`, the profile and retry routes, sweep | C0 |
| **B3** | `cameras.py`, cameras and offset routes, delete `delete_findings` | C0 |
| **B4** | `views.py`: the view3d PUT/GET routes for findings and measurements, `listCloudViews`, the staleness hash, atomic writes, file sweep | C0 |
| **X1** | Pure TS: `measure.ts` extension (area and rings; reads B1's vectors when merged, until then its own copy of the new cases, reconciled in M1), `photoLink.ts`, `pins/project.ts`, callout placement, jump extensions, keyboard map | C0 |
| **V1** | Engine split (`viewer/engine.ts`), frame hook, views and tween, colour modes, class LUT, EDL, snapshot, `frameTimes()` | C0 |
| **V2** | Clip box (including the picker check), fly controls, pose camera `lookThrough`, `sampleSlab`, occlusion pass, `capture()` (render target, EDL-to-target check, PNG encode) | V1 |
| **W1** | `CloudWorkspace` layout: palette, hint bar, cloud panel with picker and Details dialog, gizmo, readout, minimap, empty and non-ready states; deletes `CloudList`, `ViewPanel` and the old layout | V1, X1 |
| **R1** | The report-view client: `useViewCapture` queue, the auto-framing poses, Refresh view, "Capture missing views" with progress and cancel, and the `ReportViewCard` (thumbnail, stale pill, actions) that P1 and M1 render | W1, V2, B4 |
| **M1** | Measure tools UI: `useCloudTool`, area, rings, cross-section and profile panel, Measurements tab (renders `ReportViewCard`), attach to finding | W1, V2, B1, B2 |
| **P1** | Pins layer, occlusion dimming (normals from `listCloudViews`), callout, pin tool and draft flow, Findings tab with `FindingInspector` `anchorSlot`/`measureSlot`, `?finding=` arrival | W1, V2, X1, B4 |
| **L1** | Cameras layer, glyph popover, offsets UI, photo-link tool and list, cloud→image and image→cloud jumps, the `LikelyViews` component | W1, V2, B3, X1 |
| **G** | e2e rewrite and additions, `check:webview` additions, acceptance on the chimney and a posed flight, performance runs, `docs/progress.md`, walkthrough, `/wrapup` | all |

**Parallel batches:**

1. {C0}
2. {B1, B2, B3, B4, X1, V1}: six in parallel.
3. {V2, W1}: W1 needs V1 and X1; V2 needs V1.
4. {M1, P1, L1, R1}: four in parallel.
5. {G}

P1's `anchorSlot` renders L1's `LikelyViews` and R1's `ReportViewCard` through props, and M1
renders `ReportViewCard` too. So no two batch-4 units edit the same file. The last merged of P1, L1
and R1 wires the components in (one line each). The automatic captures after create and move are
calls into R1's `useViewCapture`: P1 and M1 call a no-op stub until R1 merges. Merges into the
programme branch are serialized with a rebase and gate between them (umbrella §6).

**Critical path:** F → C0 → V1 → V2 → P1 → G. P1 carries the pins, the occlusion pass integration,
the callout and the F inspector integration, which makes it the largest UI unit.

**Near-critical:**

- V1 → V2 → R1 → G. The capture must work before R can print cloud findings, so **the Reports
  sub-project's R9-C acceptance waits on C's unit R1** (and on B4).
- V1 → W1 → M1, where M1 also waits on B2.

B1, B3, B4 and X1 have slack. The cross-project edge: L1's cloud→image arrival is verified in G
only when I has merged its arrival (§4.2). Otherwise G asserts the URL only.

## 18. Risks

| Risk | Mitigation |
| --- | --- |
| **F's build differs from F's spec** (inspector slots, the `data_id` filter, attachments by path) | §4 cites F's spec by section. C0 adapts the names. A missing semantic is raised before C0 starts, not worked around in C. |
| **Report-view capture** differs from the screen, or reads back blank (the render target with EDL, the flip, the colour encoding: the S1 white-colour trap) | V2 tests the capture on the fixture: it must not be uniform and must have the red/green split of `check:webview`. `check:webview` gains one capture assertion on the packaged exe. When EDL cannot render to a target, captures are taken without it and `render.edl=false` is recorded. |
| **The capture freezes the view** for up to 3 s after each create | The capture is queued behind the create and shows a "Saving view…" chip, and the pin is usable at once. The 10 s timeout saves an incomplete view instead of hanging. Refresh view fixes that. |
| **Report views take disk** (about 2.5 MB per PNG) | Stated in the Details dialog. JPEG is accepted when a PNG passes 6 MiB. |
| **Backdrop blur over a WebGL canvas** re-blurs six panels each orbit frame on a laptop GPU | The panels are small and fixed, and nothing animates infinitely. The frame-time targets are measured with and without F's reduced-effects mode. The workspace may default to reduced effects on low-end GPUs (F's switch). |
| **EDL moves point clouds to another layer** (`point-cloud-octree.d.ts` notes raycaster layers), which might break `pickAllPoints` | V1 runs the S1 pick tests and the hollow-stack e2e with EDL on. If they fail, picks render with EDL disabled for that one pick render. |
| **The potree picker ignores clip boxes** | V2 checks it on a synthetic hollow box first. The fallback copies the clip uniforms onto the picker material (§7). |
| **Camera heights and orientation are only approximate** (non-RTK GPS, DJI altitude datum, gimbal yaw drift) | The angular tolerance, the facing test, the ring radius shown in the image, the per-set offset with a warning, and each result's method stated in the UI. Geoid and lens models are deferred. |
| **I does not deliver the pose columns in time** | C runs position-only. Everything works with "by distance" results, and frustum hits turn on when the columns appear, with no C change. |
| **The occlusion pass read-back stalls** on a big canvas | It runs once per settle only, decodes only the pixels near pins, and has a measured ≤ 40 ms target. If that fails, the pass is limited to 64 pins nearest the centre. |
| **The profile body size** (500 k points of JSON) | The default is 200 k, with gzip on the wire. If `GZipMiddleware` is not already installed, B2 adds it scoped to this route's response instead of changing app-wide middleware. |
| **The route shape changes under F** | F-b requires the path, or a redirect that keeps the query. The `check:webview` path and the S1 and S2 jumps depend on it. |
| **A migration id collision** with F, I or M, all adding revisions in parallel | The id is taken at build time and heads are re-checked across branches before merge (ADR). |

## 19. Deferred

- **Comparing survey dates in 3D.** This covers several clouds in one view and cloud-to-cloud
  distance. Map compare is M's.
- **3D AI detection**, and automatically lifting image findings into 3D through the photo link
  (the image→cloud jump is the manual form).
- **Lens distortion, geoid and RTK-precise poses.** A pose refinement from a Pix4D/Metashape
  camera export is the natural next step.
- **Saved named views and saved clip boxes.** The clip box is session state per cloud, remembered in
  try/catch-wrapped `localStorage`.
- **Pin clustering** beyond 500 pins.
- **Classification editing**, and exporting a clipped or thinned cloud.
- **Draping a photo onto the cloud** (projective texturing).
- **An ortho minimap underlay precisely warped** across CRSs. The corner transform is used.
- **Project-agent tools** for pins and cloud measurements (umbrella §4 says a later sub-spec).
- **The project-level Measurements tab** (the union list). It is not C's. M owns the union
  endpoint `GET /measurements`, whose cloud provider reads `cloud_measurement`; C only adds its
  new kinds' headline mapping (§12 row 19).
