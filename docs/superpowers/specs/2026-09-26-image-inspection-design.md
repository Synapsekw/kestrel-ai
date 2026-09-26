---
type: spec
date: 2026-09-26
status: proposed
tags: [spec, inspection-platform, images, annotation, segmentation, sam, gsd]
related: ["[[2026-09-26-inspection-platform-design]]", "[[2026-09-26-foundation-design]]", "[[2026-09-20-rotated-boxes-design]]", "[[2026-09-23-train-detect-split-and-model-library-design]]", "[[2026-09-23-model-training-gsd-design]]"]
---

# Image inspection: the Images workspace (sub-project I)

## 1. Goal

A project's **Images** tab becomes one workspace in which the operator can:

- find the frames that matter, by list or by where they were taken
- mark defects and objects as boxes, rotated boxes, polygons and points, by hand or with AI
- grade findings and read their real size in millimetres
- review model suggestions at keyboard speed
- turn polygons into a segmentation model

The target layout is the approved mockup
`.superpowers/brainstorm/1481982-1790403567/content/ws-images.html` (umbrella D10). The workspace
replaces the Data Manager, Editor and image Review screens, which F keeps as interim screens.

Done means:

1. A DJI flight imports. The browser shows it as a grid and as a map of capture points, with the
   current frame's ground footprint drawn.
2. Every palette tool works from its shortcut, and undo covers all of them.
3. **D** runs a library model on the frame, **A** / **X** accept or reject each suggestion, and
   **1–4** grades the new finding. That is three keystrokes from suggestion to graded finding.
4. **S** plus one click outlines a spall. It works on the GPU, and on the CPU while training holds
   the GPU.
5. **L** measures a length in mm and shows its uncertainty.
6. Polygons export as YOLO-seg, build a `segment` dataset, and train a YOLO-seg model that lands
   in the library.
7. The canvas holds 60 fps with 500 annotations, and the browser scrolls 20,000 images smoothly.

## 2. Scope

**In:**

- The workspace: browser, canvas, palette, inspector integration and status bar.
- Reading DJI XMP at import, plus a backfill job.
- Footprint and GSD.
- The shapes `polygon` and `point`, and image length measurements.
- The smart polygon, as SAM 2.1 tiny in the sidecar.
- Interactive and batch detection.
- Suggestion review.
- The image side of segmentation: label writers, the inclusion rule, YOLO-seg and COCO polygon
  export, segment-model inference, seg starters, and the train-task check.
- The keymap, micro-animations and performance budgets.
- The fate of the secondary routes `/review` and `/query`, which F leaves to I.

**Out:**

- F owns the design system, shell, catalogue, severity scale, the Finding entity, API and
  inspector, the Findings tab, and the Models section, meaning cross-project datasets and training
  in `library.db`. F also owns migration and "Add data".
- M owns map review, segment models on orthomosaics, and the `/runs` route's map side.
- M owns the Measurements union endpoint (F§2, M§12), which may later list I's image lengths.

**Deferred:** see §20.

## 3. Depends on Foundation

I starts after F merges (umbrella §6). The interfaces below are taken from
`2026-09-26-foundation-design.md` (cited as F§n). I adds fields to F's paths and schemas only where
§14 says so, which F§13 allows.

| # | What I uses | Where F defines it |
|---|---|---|
| A1 | The `box` table **is** the annotation store, and it is not renamed. `box.class_id` holds a **catalogue type id**. `ProjectOut.classes` is derived from `project_type`, and `ClassDef` gains `kind`, `default_severity` and `group`. | F§3 F3/F6, F§7.3 |
| A2 | `finding` has an image anchor made of `image_id` and `annotation_id` (→ `box.id`, unique), indexed `(anchor_kind, image_id)`. Each finding has a `number` shown as `F-0217`. | F§8.1 |
| A3 | The annotation-to-finding invariant hooks in `findings/annotations.py` are called by the box service inside its transaction. A person-drawn box on a defect type gives a finding with status `open`. An accepted or edited proposal on a defect type gives a finding with status `reviewed`, `created_by: model:<id>` and `confidence`. Reclassing defect → object needs `confirm_finding_delete`. Deleting the box deletes the finding, and deleting the finding deletes the box. | F§8.5 |
| A4 | `FindingInspector {projectId, findingId, anchorSlot?, measureSlot?, onNavigate?}` inside `InspectorLayout`, which is 340 px wide and stacks below 1100 px. | F§8.7, F§4.4 |
| A5 | Primitives: `GlassPanel` (`pane` without blur, `float` with blur), `FloatingToolbar`/`ToolButton`/`useToolShortcuts`, `Segmented`, `SeverityPicker` (keyed 1–9), `TypeChip`, `Menu`, `Kbd`, `Tooltip{shortcut}`, `Toaster` and `Switch`. `useVirtualRows` moves to `ui/`. Data colours pass through `--c`. | F§4.4, F§4.5 |
| A6 | Motion tokens `--dur-fast` 120, `--dur-base` 180, `--dur-slow` 260 and `--dur-emphasis` 350 ms, with `--ease-out`. **Loops run only while real work runs.** The mockup's scan sweep is **not adopted**. Reduced motion zeroes everything but `--dur-fast`. | F§4.2 |
| A7 | Routes `/p/:id/images[/:imageId]`, and redirects `/label` → `images?filter=unlabeled` and `/edit/:id` → `images/:id`. The "Label next" action lives in `data/labelNext.ts`. The secondary routes `/review` and `/query` are I's to decide. | F§5.3 |
| A8 | Library `dataset` (`task: detect\|obb\|segment`, `filter`, frozen `classes`), `dataset_item.labels` (`[{type_id,x,y,w,h,angle}]`), and the export job (today's materialise, generalised), which refuses `segment` with `422 task_not_supported` "until I lands". Training runs on `LibraryHandle` and registers the dataset's `task`. `LibraryModel.task` gains `segment`, plus `class_map`. | F§12.1–12.3 |
| A9 | The model → catalogue class map resolves by exact name, then aliases, then `class_map`. Leftovers give `422 unmapped_classes`. | F§7.4 |
| A10 | Project migration `0010` is F's, and library `0002` is F's. I's migration is project `0011` (umbrella §6 "Migration ids"; M is `0012`, C `0013`, R `0014`), chained onto whatever head `main` has at merge. I claims no library or catalogue revision. | F§11.1, F§18 |

**One gap I fills.** F's `GET /findings` filters by `data_id`, not by image. I adds an `image_id`
query parameter, which is additive and uses F's `(anchor_kind, image_id)` index.

## 4. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| I-D1 | How does the browser address 20k images? | One **columnar index** request per filter change (ids plus compact per-row fields). Details are fetched by `ids=` for the visible window only. | Scroll jumps, "212 / 312", the filmstrip and the map all need ordinals, which keyset paging cannot give. At about 30 B a row the response stays bounded. |
| I-D2 | Where do per-image aggregates come from? | Annotation aggregates come from an **`image_summary`** table, recomputed for one image inside every box write. Finding aggregates come from one `GROUP BY` over `finding WHERE anchor_kind='image'`. | Group-by over every box per request (`datasets/images._box_stats` today) does not scale. Findings are few, and F's hooks need no extra call from I. |
| I-D3 | Footprint | **Flat ground at take-off height**, projected through gimbal pitch/yaw and lens intrinsics. It falls back to a wedge, then a point. | DJI XMP carries what is needed. DSM ground is deferred. |
| I-D4 | Distance for GSD | The operator's override → LRF distance → nadir relative altitude (within 15°) → none, meaning px only | Oblique inspection shots are common. A wrong mm is worse than no mm. |
| I-D5 | Smart polygon model | **SAM 2.1 tiny** (`sam2.1_t.pt`) through `ultralytics.models.sam.SAM2Predictor`. `ultralytics==8.4.154` is already pinned. GPU when free, CPU otherwise. | No new ML dependency, one prompt decoder per click, and the tiny encoder is tolerable on CPU. |
| I-D6 | SAM input | The **visible viewport crop** (at least 512 px of source) resized to 1024 | Hairline cracks disappear when a whole frame is squeezed to 1024. Zoom decides the detail. |
| I-D7 | Point markers | Shape `point` on the `box` table, **defect types only**, never trained | A finding needs an image anchor (A2). A point teaches a detector nothing. |
| I-D8 | Rotated box drawing | **Three-point**: drag along one edge, move to set the width, click | Faster than draw-then-rotate, and it is the CVAT/Roboflow pattern. |
| I-D9 | Keys | Digits set **severity**, letters choose **tools**, reject moves from R to **X**, and type is chosen with **T**. These are F's app-wide review keys (F§5.6); I's tool keys are registered in F's keymap table | Types are a catalogue, not 9 classes. Grading is the frequent act (as in the mockup's status bar). |
| I-D10 | Dataset inclusion per task | An image enters only if **every** annotation of a selected type can be expressed in the task. Otherwise it is skipped and counted. | Dropping one label silently teaches the model that the object is background. |
| I-D11 | Canvas renderer | Keep **Konva** (react-konva 18), split into four layers, with polygon LOD | This reuses `editor/BoxLayer.tsx`, its Transformer and its tests. 500 shapes fit Konva when layers are split. |
| I-D12 | Capture map | **OpenLayers** (`ol` 10, already a dependency) with a WebGL points layer. The project ortho is the background when it covers the points; otherwise there is none. | Offline-safe. Tiles come from existing map endpoints. |
| I-D13 | Interactive detect with a busy GPU | That one image runs on **CPU**, and the result says so | Training can hold the card for hours. One frame on CPU takes seconds. |

## 5. What exists and what happens to it

| Today | Fate |
|---|---|
| `frontend/src/editor/geometry.ts`, `history.ts`, `commands.ts` (`enqueue`, `tracked`, undo/redo) | **Reused**. The commands are generalised to shapes (`cmdCreateShape`, `cmdUpdateShape`, `cmdSetType`, `cmdReview`). |
| `editor/BoxLayer.tsx` (Transformer, 15° snaps, screen-px strokes) | **Reused** for box and rbox inside `images/canvas/ShapeLayer.tsx` |
| `editor/EditorCanvas.tsx` (window-level middle-button pan, wheel zoom, Space pan) | **Rewritten** as `images/canvas/ImageCanvas.tsx` with four layers and a two-level image. The pan code is kept. |
| `editor/useKonvaImage.ts` | Extended to a preview → full swap using `createImageBitmap` and an LRU |
| `editor/hotkeys.ts`, `useEditorHotkeys.ts` | **Deleted**. I's entries go into `images/workspace/keymap.ts` (§13), registered into F's `ui/keymap.ts`. `isTypingTarget` now lives in `ui/keymap.ts` (F§5.6), where M and C import it too. |
| `editor/ConfidenceFloor.tsx` | Reused as the suggestion threshold |
| `editor/EditorToolbar`, `EditorInspector`, `ClassSidebar`, `EmptyToggle`, `BackLink`, `RegionList`; `store/editor.ts` | **Deleted** and replaced by the palette, `FindingInspector`, the T picker, N, and `FindingsOnImage`. The store becomes `store/imagesWorkspace.ts`. |
| `frontend/src/data/selection.ts`, `bulkActions.ts`, `labelNext.ts` (F) | Reused by the grid |
| `data/ImageGrid`, `FilterBar`, `useImageList`, `ImageTable` | Rewritten as `images/browser/{BrowserGrid,BrowserFilters,useImageIndex}`. `ImageTable` is deleted, because the table view is F's Findings tab. |
| `screens/EditorScreen`, `DataManagerScreen`, `ReviewScreen`, `QueryScreen`; `review/ImageReviewQueue` | **Deleted**. `/review` → `images?filter=suggestions`, and `/query` → `images?batch=1`. The map branch of `review/DetectReview.tsx` goes to M. |
| `backend/app/datasets/prepare.py` (`read_exif`: capture time, lat, lon, alt) | Gains `read_xmp`, EXIF intrinsics and a thumbnail at import |
| `datasets/importer.py` `_write_rows` | Writes the camera columns and `original_name` |
| `datasets/boxes.py` (bounds, review transitions, `_count_transition`, F's hooks) | **Moved** to `imagery/annotations.py` and generalised to shapes. F's hooks are called unchanged. |
| `datasets/images.py` (keyset listing, per-request `_box_stats`) | The listing reads `image_summary`. `imagery/index.py` is new. |
| `datasets/materialise.py` `detect_boxes` / `_label_text` (moved by F into the library export) | They become the `detect` writer in `imagery/labels.py`. The `obb` and `segment` writers are added. |
| `inference/service.preannotate` (sync, `TRAIN_ONLY`, 2 s GPU timeout, `_write_proposals` idempotence) | **Rewritten** as `detect_one` with a CPU fallback. `/preannotate` is removed. |
| `providers/base.Detection`, `providers/tiling.py`, `inference/jobs._write_boxes` | `Detection` gains `angle` and `polygon`. Tiling offsets polygons. The job writes shapes. |
| `providers/local_yolo._from_result` (reads `result.boxes` only) | Reads `result.obb` and `result.masks` too. This fixes a live bug: an OBB model returns no detections today. |
| `library/gsd.py` (`Intrinsics`, `intrinsics_from_exif`, `image_gsd_cm`) | **Reused** for GSD |
| `training/starter.py` (detect families only), `trainer.epoch_message` (reads `mAP50(B)`) | Seg starters are added. The message shows mask mAP `(M)`. |
| `exports/yolo_out.py`, `exports/coco_out.py` | The `yolo_seg` format is added. COCO writes polygon `segmentation`. |

New backend packages:

- `backend/app/imagery/`: `camera`, `footprint`, `summary`, `index`, `annotations`, `labels`,
  `measurements`, `router`
- `backend/app/assist/`: `sam`, `weights`, `router`

New frontend folders: `frontend/src/images/{workspace,browser,canvas,tools,ai}/`.

## 6. The workspace (the mockup, precisely)

F's rail (64 px), top bar and project tabs stay visible. The Images workspace is **not
full-bleed**, so the tabs do not hide as they do on a map or cloud (F§5.2). Below the tabs:

```
┌ 280 ──────────────────┐┌ 1fr ─────────────────────────────────────┐┌ 340 (F) ─────────┐
│ Images     [Grid|Map] ││[pal] [info chip ...................] [− 74% + Fit]│ Selected finding │
│ [Flight 14 Sep · 312 ▾]││  │                                         ││ F-0217           │
│ (● Has findings)[All ▾]││  │  canvas            [AI bar · detecting] ││ type · severity  │
│ [Crit][Major][Mod][Min]││  │                                         ││ status · size    │
│ 205–222 of 312 · time ↓││  │   [● 2 AI suggestions · A · X · Tab]    ││ provenance, note │
│ ▢▢▢  3 cols, 4:3      ││├─────────────────────────────────────────┤│ photos, comments │
│ [mini-map 168 · ⤢]     ││[‹] ▢▢▣▢▢ filmstrip ▢▢ [›]     212 / 312  ││ Findings on image│
└────────────────────────┘└─────────────────────────────────────────┘└──────────────────┘
 V select  B box  P polygon  S smart  L measure  Space pan  ←→ image  1–4 severity │ Image 212/312  Reviewed 198 ▭  ● Saved
```

- **Grid:** `280px 1fr 340px`, gap 12 px, padding `12px 14px 10px`. The mockup's 320 px inspector
  becomes F's 340 px `InspectorLayout`.
  - Panes are `GlassPanel variant="pane"`, which has no blur. Only the overlays floating on the
    canvas are `variant="float"` (F7).
  - Below 1100 px the inspector overlays the canvas (toggle **Ctrl+]**).
  - Below 960 px the browser does the same (toggle **Ctrl+[**). Plain `[` / `]` step the threshold
    (§11.4).
- **Entrance:** panes rise with F's stagger on the tab's first mount only, never on image change.

### 6.1 Left pane: the browser

- **Header:** "Images" and a `Segmented` Grid | Map (**Shift+M**).
- **Filters:**
  - Row 1: a source/flight `Select` showing label · count.
  - Row 2: a `Switch` for "Has findings", and a finding-status select (All, Open, Reviewed,
    Closed).
  - Row 3: severity chips from the scale, worst first. Each has a `--c` dot, a short name and a
    count, and toggles.
  - A "More" disclosure: type (multi), Has suggestions, Reviewed / Not reviewed, Unlabeled (A7),
    and the sort (capture time, name, worst severity, suggestion confidence) with its direction.
- **Grid:**
  - A mono caption ("205–222 of 312", "by capture time ↓"), then 3 columns of 4:3 thumbs with a
    7 px gap.
  - Each thumb has a top-right badge (finding count on the worst severity's colour), a bottom
    gradient bar with the file stem, and a teal ✓ when reviewed.
  - The current thumb has an accent border and a 3 px ring. Hover lifts it (−2 px, scale 1.03,
    `--dur-base`).
- **Mini-map:** 168 px at the foot of grid mode. Chips: "GPS · EXIF · N pts" and ⤢, which opens
  Map.
- **Map mode:** fills the pane. Chips: "Capture points · N" and "Footprint on/off". A severity
  legend runs along the bottom.

### 6.2 Centre pane

Glass `float` overlays sit on the canvas:

- **Palette:** top-left, vertical, 38×36 `ToolButton`s. Each tooltip shows the name, a sub-line
  ("Click to segment with AI", "mm from GSD") and the `Kbd`.
- **Info chip:** file name · "Captured" date and time · lat/lon to 5 decimals · "Alt 38.4 m AGL"
  · "GSD 1.8 mm/px". With no distance it shows "GSD —" and a "Set distance…" link.
- **Zoom cluster:** top-right: −, a mono %, +, Fit.
- **AI bar:** top-centre, only while detecting. It has a live dot, "Model · detecting…" and a
  progress bar. There is **no scan sweep** (A6).
- **Hint bar:** bottom-centre, while suggestions are pending. It reads "N AI suggestions on this
  image", with **A** accept, **X** reject, **Tab** next, and the threshold.
- **Toasts.**

Below the canvas is the **filmstrip** (64 px): a prev button, a masked strip of 60×44 thumbs (the
current one is 72 px wide with the accent border, and each has a severity dot bottom-left), a next
button, and "212 / 312".

### 6.3 Right pane: the inspector

`images/workspace/InspectorColumn.tsx` shows one of four things:

- **A selected finding:** F's `FindingInspector` under the header "Selected finding · F-0217".
  `measureSlot` is `<MeasuredSize/>` (§9.2). `anchorSlot` is "Show on image", which pans the shape
  into view.
- **A selected accepted object:** an object card with `TypeChip`, confidence, provenance and
  delete. Objects are counted, not findings (D7).
- **A focused suggestion:** a suggestion card with the type (T to change), a confidence bar, the
  model, and Accept / Reject.
- **Nothing selected:** the image panel, with camera metadata, the distance source, the
  subject-distance field, the footprint kind, and "Nothing to report" (N).

Below it is always **Findings on this image · N** with "Open in Findings →".

- Each row shows a `--c` square, the type, "F-id · shape · status", a Defect/Object tag and the
  severity name.
- Accepted objects are listed with the Object tag and their confidence.
- Rows and canvas selection sync both ways. Selecting a row off-screen pans to it in
  `--dur-slow`.
- The data comes from `GET /findings?image_id=` (§3) plus the image's boxes, which are already
  loaded.

### 6.4 Status bar (30 px)

- **Left:** key hints for the active tool, rendered from the keymap. For example, with Polygon:
  "Click add point · Enter close · Backspace remove point · Esc cancel".
- **Right:** "Image 212 / 312", then "Reviewed 198" with a bar, then the save state.
  - The save state is ● Saved, ◌ Saving… (while `enqueue` has work) or ▲ Save failed · Retry.
  - *Reviewed* is derived: no pending suggestions, and either an accepted annotation or
    `marked_empty`.

### 6.5 Arrival parameters (deep links into an image)

`images/workspace/arrival.ts` parses these on `/p/:pid/images/:imageId`. Malformed values are
ignored silently and the image opens normally (S1's jump rule).

| Query | Source | Arrival |
|---|---|---|
| `?finding=<fid>` | F's uniform finding deep link (F§8.7), the Findings tab, R | Select the finding's annotation, pan it into view in `--dur-slow`, show `FindingInspector`. A finding anchored on another image redirects to that image. |
| `?at=px,py&r=rpx&from=cloud:<cloudId>` | C's cloud → image jump (C§10.4) | Centre the canvas on `(px, py)` in **stored-image pixels** (the space of `image.width/height`) and zoom so the `rpx` circle fills about a third of the canvas. Draw an **arrival marker**: a dashed accent ring of radius `rpx` with a centre dot, on the interaction layer, static (no pulse, A6), not saved, cleared by Esc or the next image. Show a glass "Back to 3D" chip under the info chip linking `/p/:pid/clouds/<cloudId>`. `r` defaults to 24 px; `from` is optional (without it there is no chip). |

Both parameters are dropped from the URL (`replace`) once handled, so ← / → do not carry them to
the next image. The image → cloud direction is C's (`/clouds/:cloudId?from_image=<imageId>&px=u,v`,
C§10.4); I offers it as "Open in 3D" in the image panel's menu only when the project has a cloud
whose bounds contain the image's GPS point.

## 7. The browser in detail

### 7.1 Columnar index

`GET /projects/{id}/images/index` takes the `listImages` filters, the new ones (§14) and `sort`.
It returns parallel arrays:

```json
{ "total": 312, "ids": ["…"], "sev": [4,0,2], "count": [5,0,1], "flags": [3,0,1],
  "lon": [55.29218, null, …], "lat": [25.26412, null, …] }
```

- `flags` bits: 1 reviewed, 2 pending suggestions, 4 has GPS, 8 marked empty.
- `lon`/`lat` are present only with `fields=geo`.
- The response is capped at 100,000 rows. Above the cap it answers `422 too_many_images`.
- **Query:**
  - `image` ⋈ `image_summary`, left-joined to one `GROUP BY image_id` over
    `finding WHERE anchor_kind='image'`, which gives count, worst severity and the per-status
    worst severity.
  - Severity plus status filters are an `EXISTS` on the **same** finding row.
  - Type filters are an `EXISTS` on `box(image_id, class_id)`.
- `useImageIndex` feeds the grid, filmstrip, prev/next, map dots and "N / M" from this one array.
- **Cell details** (stem, capture time) come from `GET /images?ids=` for the visible window plus
  overscan, in batches of at most 200. They are kept in an LRU of 2,000 records.

**`image_summary`** (I-D2) has these columns:

- `image_id` PK
- `annotation_count` (accepted or edited, not points)
- `pending_count`, `max_pending_conf`
- `updated_at`

`imagery/summary.touch(session, image_id)` recomputes one image from its boxes. It is called by
every box write, review action and the `infer` write. A `summary_rebuild` job seeds the table in
migration `0011` and serves as the repair tool.

### 7.2 Grid

- It virtualises rows with `computeWindow` (from `ui/useVirtualRows`). Row height is
  `(width − gutters)/3 · 3/4 + gap`, with overscan of 3 rows.
- Thumbnails come from the existing `…/thumbnail` (256 px, `cache/thumbs/`), which is now
  **generated during import**.
  - `<img decoding="async">`, at most 8 fetches in flight.
  - A row that scrolls out aborts its fetch (`AbortController`).
  - A missing thumbnail shows a `Skeleton` tile.
- Click opens the frame. Shift/Ctrl-click multi-selects (`selection.ts`), and the bar then offers
  Detect on selection, Nothing to report, and Delete.
- Navigation keeps the current thumb visible, scrolling smoothly only when the jump is under 3
  rows.

### 7.3 Camera metadata (XMP)

`prepare.read_xmp` reads `opened.info["xmp"]` from the **source** file. Pillow sets it from the
APP1 XMP packet, and the prepared JPEG keeps EXIF but drops XMP. Two regexes cover the attribute
form (`drone-dji:Key="+38.40"`) and the element form. No XML library is needed.

| XMP key | `image` column |
|---|---|
| `RelativeAltitude` | `rel_alt` (m above take-off) |
| `GimbalPitchDegree`, `GimbalYawDegree`, `GimbalRollDegree` | `gimbal_pitch` (−90 = nadir), `gimbal_yaw` (from north, clockwise), `gimbal_roll` |
| `FlightYawDegree` | `flight_yaw` (the yaw fallback) |
| `LRFTargetDistance`, when `LRFStatus` is `Normal` | `lrf_distance_m` (H20/H30/M30/M3T-class) |
| `CalibratedFocalLength` | `focal_px`, in pixels of the original frame (M3E, P4 RTK) |

From EXIF, through `library/gsd.intrinsics_from_exif`: `focal_mm`, `sensor_w_mm`, `orig_w`,
`orig_h` (`ExifImageWidth/Height`) and `camera_model`.

Also added:

- `original_name` (relative to `Source.folder`)
- `subject_distance_m` (the operator's value)
- `footprint` (JSON `[[lon,lat],…]`)
- `footprint_kind` (`trapezoid|wedge|point|none`)
- `metadata_version`

**Backfill:** the `image_metadata` job (`POST /images/metadata-refresh`), which is submitted once
per project after migration `0011`.

- It re-reads the originals. Old rows have no `original_name`, so it takes a unique stem match
  from one `list_images` listing per source.
- An ambiguous or missing original keeps the EXIF-only metadata.
- It is idempotent through `metadata_version`, and it never blocks opening.

### 7.4 Footprint (I-D3)

`imagery/footprint.py` computes it once, at import or backfill. The inputs:

- h = `rel_alt`
- θ = pitch
- ψ = gimbal yaw, falling back to flight yaw
- f = `focal_mm`
- W = `sensor_w_mm`
- H = W · orig_h / orig_w

Roll is ignored. The frame is ENU with the camera at the origin:

```
fwd=(sin ψ, cos ψ, 0)  right=(cos ψ, −sin ψ, 0)  up=(0,0,1)
F  = cos θ·fwd + sin θ·up        # optical axis
Dn = sin θ·fwd − cos θ·up        # image "down"
corner (u,v) ∈ {(−W/2,−H/2),(W/2,−H/2),(W/2,H/2),(−W/2,H/2)}:
  r = u·right + v·Dn + f·F ; valid if r.z < −1e−3 and horizontal range of t=−h/r.z ≤ 10·h
  ground = t·(r.x, r.y)                      # metres east, north
lat = lat0 + n/111320 ; lon = lon0 + e/(111320·cos lat0)
```

At θ = −90 this is a W·h/f × H·h/f rectangle rotated by ψ, with image-top toward ψ.

- **Four valid corners:** `trapezoid`.
- **Only the two bottom corners valid:** `wedge`. The top rays are clamped to 3·h.
- **Otherwise:** `point`, with a heading tick when ψ is known.
- **No GPS:** `none`.
- **Yaw sanity check:** if pitch < −80° and |gimbal_yaw − flight_yaw| > 90°, flight yaw is used.
  Some airframes report gimbal yaw relative to the body.

Only the **current** image's footprint is sent (`ImageDetail`). It is a visual aid and is never
used to measure.

### 7.5 Capture map and mini-map

- There is one OpenLayers `Map` per mode, in EPSG:3857, fed from the index (`fields=geo`), with no
  request per point.
- **Points:** a `WebGLVector` layer, coloured by worst severity (grey when there is none). The
  radius is 2.6 px with findings and 1.4 px without.
  - Hover shows a tooltip (stem, count, worst severity), throttled to 30 Hz.
  - Click navigates.
  - Shift+drag lassoes a set for batch detection.
- **Map mode only:** a faint flight path in capture order, the current frame's footprint as an
  accent polygon, and the current point as a static accent ring. There is no pulse (A6).
- **Background:** the newest `map` data item whose extent covers more than half the points, drawn
  from the existing tile endpoint. Otherwise a neutral ground with a scale bar. There are no
  online tiles.

## 8. Annotations

### 8.1 Storage (project migration `0011`)

`box` (A1) gains these columns:

| Column | Notes |
|---|---|
| `shape` | `box` \| `rbox` \| `polygon` \| `point`, non-null, default `box`. The migration sets `rbox` where `angle ≠ 0`. |
| `points` | JSON `[[x,y],…]` in stored-image px, for polygons only. Implicitly closed, CCW, 3–2,000 vertices, one ring. |
| `assist` | `sam` \| null |
| `area_px` | cached area; 0 for a point |
| `updated_at` | |

**Polygons keep `x, y, w, h` as their axis-aligned envelope, with `angle = 0`.** So every reader
of the rectangle fields keeps working unchanged: NMS, counts, F's finding thumbnail crop (F§8.3),
the COCO bbox and `accept_above`. A point stores `x, y` with `w = h = 0`, and readers that need an
extent skip points.

New indexes: `box(image_id, class_id)` and `box(image_id, review_state)`.

New tables:

- `image_summary` (§7.1)
- `image_measurement(id, image_id FK cascade, x1, y1, x2, y2, label, created_at)`. The length is
  computed on read, so it follows later distance changes.

### 8.2 Validation (`imagery/annotations.py`; the server is the only judge)

- **box / rbox:** today's `boxes._check_bounds`.
- **polygon:**
  - It needs at least 3 distinct vertices, an area of at least 4 px², and at most 2,000 vertices.
  - Shapely 2.1 (already pinned) normalises it: `make_valid`, keep the largest part,
    `clip_by_rect` to the image, orient CCW, round to 0.1 px.
  - A changed geometry returns `repaired: true`, and the UI toasts it. Nothing left after the
    clip is `422 empty_polygon`.
- **point:** inside the image. The type must have `kind = defect`, otherwise
  `422 point_needs_defect_type`.
- **type:** in the project list and not archived (F§7.2).
- **per-image cap:** 5,000 boxes, otherwise `422 too_many_annotations`. This keeps per-image reads
  bounded.

### 8.3 Review and the D7 rule

F's invariant (A3) decides the finding side, and I does not restate it. On top of it, I adds:

- **Accept response:** `POST /projects/{id}/boxes/review` returns `{changed,
  finding_ids_created, finding_ids_deleted}`, so the workspace updates without a refetch. An
  accepted **object** increments run counts through `detect/counts.py`, as today, and creates no
  finding.
- **Undo of an accept (`unreview`):** it returns the proposal to `unreviewed` and deletes the
  finding F created, but only while that finding is untouched. Untouched means no note, no
  attachments, no comments, severity still the default, and status still `reviewed`. Otherwise it
  answers `409 finding_has_content`.
- **`marked_empty`:** accepting on a `marked_empty` image clears the mark, as today
  (`empties.clear_mark_for_ground_truth`).
- **Create response:** a person's create on a defect type returns `{box, finding_id, repaired}`.

## 9. The canvas, tools and measurement

### 9.1 Rendering (I-D11)

The stage's world coordinates are stored-image pixels, as today. It has four layers:

1. **Image:** a single `KonvaImage`, `listening(false)`.
2. **Annotations:** accepted shapes and measurements.
   - `perfectDrawEnabled(false)` and `shadowForStrokeEnabled(false)`.
   - `strokeScaleEnabled={false}`, as in `BoxLayer`.
   - Labels only on the selected and hovered shapes, or on shapes at least 48 screen px tall.
3. **Suggestions:** a static teal dash. There are no marching ants (A6).
4. **Interaction:** the draft, handles, Transformer, the selection glow (static), the SAM preview,
   and the measure line.

**Pan and zoom:** layers 2 and 3 go `listening(false)`, so no hit graph is rebuilt, until 120 ms
after the last wheel or drag event.

**Polygon LOD:** Douglas–Peucker to 0.75 screen px for the zoom bucket (powers of √2), memoised
per `(id, bucket)`.

**Image:** a two-level load.

- The preview is `…/file?max_side=2048`. The full stored frame (≤ 4,000 px by the import default)
  is swapped in without a flash once scale > 2048/long side, or 400 ms after navigation.
- Decoding uses `createImageBitmap`. An LRU keeps the current full frame and 4 previews, and
  `close()` runs on eviction.
- The neighbouring previews are prefetched.
- An image change is a 120 ms crossfade and a refit, unless "Keep zoom" is on (the zoom menu).

### 9.2 Tools

| Tool | Key | Interaction |
|---|---|---|
| Select | **V** | Click, or Shift-click to add. Drag moves; handles resize. The rotate handle snaps to 15° with Shift (the `BoxLayer` Transformer). On polygons: drag a vertex, Alt+click an edge to insert, Alt+click a vertex to delete (minimum 3). |
| Pan | **H**, or hold Space | Middle-button pan works in every tool. |
| Box | **B** | Drag with the active type. |
| Rotated box | **R** | Three-point (I-D8): drag A→B along an edge (angle and length), release, move perpendicular for the width, click. Shift snaps to 15°. |
| Polygon | **P** | Click adds a vertex. Click-drag streams vertices every 4 screen px. Backspace removes the last. Enter, or a click on the first vertex, closes. Esc cancels. |
| Smart polygon | **S** | §10. Click is positive, Shift+click negative, drag is a box prompt. Enter commits, Esc cancels. |
| Point marker | **M** | Click. Offers defect types only. |
| Measure length | **L** | Click, click. Live `mm ± σ`. Shift constrains to 0/45/90°. The line is saved as an `image_measurement`. |
| Delete | **Del** | Deletes the selection, confirming when a finding with content goes too. |
| AI detect | **D** | Opens the model menu (§11.2). **D** or Enter runs it. |
| Show/hide annotations | **Shift+H** | Toggles layers 2 and 4. |
| AI suggestions | **G** | Toggles layer 3 and the A/X targets. |

The toggles have a dimmed "off" state. The AI button carries a teal dot while a model is chosen.

**Type choice:** **T** opens a filterable picker at the cursor.

- A type's catalogue `hotkey` picks it directly while the picker is open, and Enter picks the
  highlighted one.
- With a selection, the picker retypes it; F's `confirm_finding_delete` dialog appears on defect →
  object.
- Without one, the picker sets the **active type**, shown as a chip under the palette.
- The last type per tool is remembered per project in `localStorage` (try/catch).

### 9.3 Distance, GSD and measured size

`imagery/camera.distance(image)` returns `(D, σ_D, source)`, taking the first rule that applies:

1. `subject_distance_m`, the operator's value: σ = 0, source `manual`.
2. `lrf_distance_m`: σ = 0.2 m + 0.2 %, source `lrf`.
3. |θ + 90°| ≤ 15°: D = `rel_alt` / cos(θ + 90°), σ = 1.0 m (barometer plus terrain), source
   `rel_alt`, shown as "nadir approx.".
4. Otherwise none: "GSD —", with px only.

The GSD per **stored** pixel, which stays correct after the import downscale
(`ImportSettings.max_side` 4000):

```
gsd_mm = D·1000 / f_px_stored
f_px_stored = focal_px · stored_long / orig_long           # CalibratedFocalLength present
            = focal_mm · stored_long / sensor_w_mm         # else; the library/gsd.py convention
```

`images/tools/measure.ts` (unit tested) turns geometry and `gsd_mm` into the `MeasuredSize`
tiles:

| Shape | Primary | Secondary |
|---|---|---|
| box / rbox | area w·h·gsd² (m²) | length = long side, width = short side (mm) |
| polygon | area by the shoelace formula (m²) | max length = max Feret diameter (rotating calipers on the hull); min width = min Feret |
| point | none | "Point marker" |

Below the tiles: "from GSD 1.8 mm/px · ±4 mm at 38.4 m", where σ_L = L·σ_D/D + √2·gsd and
σ_A ≈ 2A·σ_D/D. With no GSD the tiles show px and px².

## 10. Smart polygon (SAM 2.1 tiny)

- **Model:**
  - `sam2.1_t.pt`, about 39 M parameters. The checkpoint is about 150 MB in fp32; the exact size
    and sha256 are pinned in the assist catalogue.
  - `SAM2Predictor.set_image` computes the embedding once. Each prompt runs only the mask
    decoder.
- **Weights:**
  - The `assist_acquire` **library job** downloads them, reusing `training/starter_download.py`.
    They are stored at `<library_root>/assist/sam2.1_t.pt`.
  - Import from a file is supported for air-gapped machines.
  - Until the weights are present, S shows "Get smart polygon model (≈150 MB)".
- **Device:**
  - Each call tries `hold_gpu(timeout=0.2)` (`jobs/gpu.py`) and runs on CUDA if it gets it.
  - Otherwise it runs on CPU with `torch.set_num_threads(max(2, cores//2))`, so the API stays
    responsive.
  - The result reports `device`.
- **Memory:**
  - The model has its own slot, not the YOLO `_MODEL` cache, taking about 0.5 GB of VRAM while in
    use.
  - It unloads after 10 minutes idle.
  - The embedding cache is an LRU of 2 keyed by `(image_id, crop)`.
- **Input (I-D6):** the viewport rectangle in source px, at least 512 px per side, clipped to the
  image and quantised to 64 px so that small pans reuse the embedding. The server crops the stored
  frame and resizes the long side to 1024.
- **Flow:**
  1. Choosing S calls `…/segment/prepare {crop}` to warm the embedding. A thin progress edge on
     the viewport runs until it is ready; that loop is tied to real work (A6).
  2. Every click sends **all** points so far. Only one request is in flight, and the newest
     supersedes a queued one.
  3. The server runs `multimask_output=True` and keeps the best score.
  4. It takes `cv2.findContours(RETR_EXTERNAL)` and the largest contour, then
     `approxPolyDP(ε = max(0.75 px, 0.002·perimeter))`, doubling ε until there are at most 256
     vertices.
  5. The result is mapped back to image px as `{polygon|null, score, device, encode_ms,
     decode_ms}`.
  6. The preview is dashed teal. **Enter** creates a `polygon` with `assist = sam` through the
     normal create path, so F's invariant applies.
- **Targets:**
  - GPU (RTX 3060 class): encode ≤ 150 ms, decode ≤ 40 ms per click.
  - CPU (8-core laptop): encode ≤ 3.5 s per crop, decode ≤ 300 ms.

## 11. AI detection and segmentation

### 11.1 Label writers (`imagery/labels.py`, used by F's dataset export and by `exports/`)

| Task | Line | Source shapes |
|---|---|---|
| `detect` | `cls cx cy w h` | today's `detect_boxes` + `_label_text`, verbatim, with per-edge clipping. Polygons contribute their envelope. |
| `obb` | `cls x1 y1 … x4 y4` | box/rbox corners. Polygons use shapely `minimum_rotated_rectangle`. |
| `segment` | `cls x1 y1 … xn yn` | polygons after `clip_by_rect`: one line per part, parts under 3 vertices dropped. Boxes and rboxes are written as 4-point polygons **only** with `boxes_as_polygons`. |

All coordinates are normalised to [0, 1].

**Inclusion (I-D10):** `labels.expressible(task, labels, options)` decides whether an image
enters.

- An image with a selected-type label the task cannot express is **skipped and counted**, for
  example "37 images skipped: boxes of selected types in a segment dataset".
- Points are never expressible.
- `marked_empty` images enter as negatives.

**The F-side additions I makes:**

- `dataset_item.labels` entries gain `shape` and `points` (A8).
- `dataset.filter` gains `boxes_as_polygons`.
- The builder's preview counts include "skipped by task".
- The export's `task_not_supported` refusal is removed.

**Exports:** `yolo_out` gains `yolo_seg`. `coco_out` writes polygon `segmentation`, with the
envelope as bbox and `area_px` as area.

### 11.2 Interactive detection

- **The model menu** is a 244 px `float` overlay with the title "Run a library model on this
  image". It lists:
  - Library models (A8) with `task ∈ {detect, obb, segment}` whose class map reaches at least one
    project type. Each shows its name, "Segmentation · cracks, spalling" and mAP in mono.
  - A confidence control, defaulting to the model's last use or else 0.25.
  - The primary button "Detect on DJI_0612 **D**".
- **`POST /images/{id}/detect {model_id, conf, imgsz?}`**, rewritten from `preannotate`, runs
  synchronously:
  1. It tiles with `make_tiles` when the long side exceeds 2 × imgsz, capped at 64 tiles.
     Otherwise it runs on the whole frame.
  2. GPU with a 2 s wait, else CPU (I-D13).
  3. Classes resolve through A9. With none mapped it answers `422 unmapped_classes`.
  4. Suggestions overlapping an accepted box of the same type at IoU ≥ 0.5 are dropped and
     counted as **already covered**.
  5. It replaces that model's earlier `unreviewed` suggestions on the image (the
     `_write_proposals` idempotence) and calls `summary.touch`.
  6. It returns `{suggestions, new, already_covered, device, elapsed_ms}`, for the toast
     "Crack-seg v4: 2 new, 5 already covered".
- **UI:** the AI bar shows for the request's life. Esc discards the result client-side.

### 11.3 Batch detection (background job)

- **`POST /images/detect-batch {model_id | provider, conf, tiling, scope}`**:
  - `scope` is one of `{image_ids}`, `{source_id}` or `{filter}`. A filter is resolved to ids
    server-side at creation.
  - It creates a `QueryRun` (`image_ids`, `source_id`, `model_snapshot`, `class_map`) and queues
    the existing **`infer`** job. Resume, cancel and progress are unchanged.
  - Cloud providers remain available under "More", which is why `/query` folds in here.
- **The job's write path:**
  - `_write_boxes` becomes `_write_shapes` and calls `summary.touch` per image.
  - `Detection` gains `angle: float = 0.0` and `polygon: tuple[...] | None`.
  - `tiling.to_full_image` offsets polygons. NMS stays on envelopes.
- **`local_yolo._from_result`:**
  - `result.obb.xywhr` → rbox, with the angle normalised to [0, 180).
  - `result.masks.xy[i]` → polygon, simplified as in §10 to at most 256 vertices.
  - `result.boxes` otherwise.
- **Accept above threshold** across a run keeps `POST /runs/{runId}/accept-above`. It goes through
  the box service, so F's invariant creates findings in the job's batches.
- The job shows in F's Jobs section and as a workspace toast with "Review suggestions →".

### 11.4 Suggestion review

- **Styling:** each suggestion has a dashed teal outline and a chip (✦ type · mono confidence ·
  **Accept A** · **Reject X**) under the shape, as in the mockup.
- **Threshold:** `ConfidenceFloor` in the hint bar. **[** / **]** step it by 0.05, and it is kept
  per project. Anything below it is hidden and is not targeted by A, X or Tab.
- **Tab / Shift+Tab:** walk pending suggestions by descending confidence, then the image's
  findings. After the last pending suggestion, Tab moves to the next image in the index with flag
  2 set, which is the review queue that replaces `ImageReviewQueue`.
- **A / X:** accept or reject the focused suggestion, or the top one if none is focused.
  **Shift+A** / **Shift+X** act on all visible suggestions, confirming above 20.
- **Accept:** the outline tweens to the solid type colour (`--dur-base`), and the inspector opens
  the new finding with the severity row ready. So **A, 3** means accept and grade. Toast:
  "✓ Accepted as finding F-0231".
- **Reject:** fades over `--dur-fast`. Toast: "✕ Rejected · kept as a training negative".

### 11.5 Segmentation training (only I's part; F moved training to the library)

- `training/starter.py` entries gain a `task`, and the file adds `yolo11n-seg`, `yolo11s-seg` and
  `yolo11m-seg`. `StarterModelOut.task` becomes `detect|obb|segment`.
- Starting a training run with a base model whose `task` ≠ the dataset's `task` gives
  `422 task_mismatch`. The model picker filters by task.
- `ModelMetrics` gains `mask_map50` and `mask_map50_95` (nullable), read from `metrics/mAP50(M)`
  and `metrics/mAP50-95(M)`. `trainer.epoch_message` shows mask mAP when present.
- Ultralytics infers the task from the weights, so the trainer's subprocess command does not
  change. Registration with `task = dataset.task` is F's (A8).

## 12. Motion

All motion uses F's tokens. Nothing blocks input, and nothing on an interaction path runs longer
than 400 ms (umbrella §8).

- Tool activation: a gradient fill over `--dur-fast`, with press scale .92.
- Hover lifts on thumbs, filmstrip and list rows.
- `SeverityPicker` lift and glow (F).
- The accept morph and the reject fade.
- Grid ⇄ Map: scale .97 → 1 over `--dur-slow`.
- Toast rise, and the save dot.
- Allowed loops, tied to real work: the AI bar's live dot while detecting, and the SAM warm-up
  edge.

Under reduced motion, transitions become opacity over `--dur-fast`.

## 13. Keyboard-first workflow

`images/workspace/keymap.ts` is a single table `{keys, when, action, help}`, registered into F's
app-wide keymap (F§5.6). The global keys (Esc, Enter, Backspace, Del, Ctrl+Z/Y, Space, V, H, F,
+/−, ?, Ctrl+K) and the review keys (A, X, Shift+A/X, 1–9, T, Tab/Shift+Tab) are F's and mean the
same here; the rows below repeat them for the sheet. F's vitest checks that no I tool key equals a
global or review key, and I's own test that no two entries collide within one `when`. The status
bar and the **?** sheet render from it. It binds through F's `useToolShortcuts`, so keys typed into
inputs are ignored.

| Keys | Action |
|---|---|
| V H B R P S M L | tools (§9.2); Space held = pan |
| Del · Backspace | delete the selection · remove the last vertex while drawing |
| D · G · Shift+H | AI detect · suggestions toggle · annotations toggle |
| A · X · Shift+A · Shift+X | accept · reject · all visible |
| Tab · Shift+Tab | next / previous suggestion → finding → next image with suggestions |
| [ · ] | threshold −/+ 0.05 |
| Ctrl+[ · Ctrl+] | toggle the browser pane · the inspector pane (narrow windows, §6) |
| 1–9 | severity level on the selected finding (beyond the scale: ignored) |
| T · N · C | type picker · "nothing to report" (today's `marked_empty`) · focus the comment box (Ctrl+Enter posts) |
| ← · → | previous / next image; auto-repeat is ignored while a frame loads |
| Shift+← / Shift+→ · Alt+arrows | rotate the rbox by 1° (kept) · nudge 1 px (with Shift: 10 px) |
| + · − · 0 or F · Ctrl+1 | zoom in, out, fit, 1:1 |
| Enter · Esc | commit / cancel the draft; Esc also deselects |
| Ctrl+Z · Ctrl+Y · Ctrl+D | undo · redo (`History`, extended to shape, type and review commands) · duplicate |
| Shift+M · ? | Grid ⇄ Map · shortcut sheet (global, F§5.6) |

## 14. API (contract first)

`contract/openapi.yaml` changes first, and `contract/client/schema.d.ts` is regenerated in the
same change. I owns the tags `images`, `boxes`, `image-detect` and `assist`, and adds fields to
F's schemas only as listed.

| Endpoint | Purpose |
|---|---|
| `GET /projects/{id}/images/index` | columnar index (§7.1). Filters: `source_id`, `has_findings`, `severity` (csv), `finding_status`, `type_ids` (csv), `has_suggestions`, `reviewed`, `unlabeled`, `search`. Plus `sort` (+ `worst_severity`), `order`, `fields=geo` |
| `GET /projects/{id}/images` | the same new filters. `Image` gains `finding_count`, `worst_severity`, `reviewed` |
| `GET /projects/{id}/images/{imageId}` | returns `ImageDetail`: `Image` + `camera {rel_alt, gimbal_pitch, gimbal_yaw, focal_mm, focal_px, sensor_w_mm, lrf_distance_m, subject_distance_m, distance_m, distance_sigma_m, distance_source, gsd_mm, camera_model}` + `footprint` (GeoJSON or null) + `footprint_kind` |
| `PATCH /projects/{id}/images/{imageId}` | gains `subject_distance_m` (nullable) |
| `POST /projects/{id}/images/metadata-refresh` | the `image_metadata` job |
| `GET/POST /projects/{id}/images/{imageId}/boxes`, `PATCH/DELETE /projects/{id}/boxes/{boxId}` | **kept paths**. `Box`/`BoxCreate`/`BoxUpdate` gain `shape`, `points`, `assist`, `area_px` and `updated_at`. Create and update return `repaired`; create returns `finding_id` |
| `POST /projects/{id}/boxes/review` | `BoxReviewResult` gains `finding_ids_created` and `finding_ids_deleted` (§8.3) |
| `GET/POST /projects/{id}/images/{imageId}/measurements`, `DELETE /projects/{id}/image-measurements/{mid}` | length measurements |
| `POST /projects/{id}/images/{imageId}/detect` | interactive detection (§11.2) |
| `POST /projects/{id}/images/detect-batch` | returns `{query_run, job}` (§11.3) |
| `POST /projects/{id}/images/{imageId}/segment/prepare`, `…/segment` | SAM warm-up and prompt (§10). `409 assist_model_missing` without weights |
| `GET /library/assist-models`, `POST /library/assist-models/{key}/acquire`, `…/import` | the assist catalogue, the download job, file import |
| `POST /projects/{id}/image-summary/rebuild` | the repair job |
| `GET /projects/{id}/findings` (F) | gains the `image_id` filter (§3) |
| `StarterModel.task`, `ModelMetrics`, `ExportRequest.format` | `detect\|obb\|segment`; mask mAP fields; `yolo_seg` |

**Removed:** `POST /images/{id}/preannotate`.

Every new schema property with a `default` is also listed in `required`
(`vault/decisions/2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript.md`).

## 15. Budget

**Background jobs** (progress, cancel, F's Jobs section):

- import (existing, now with XMP and thumbnails)
- `image_metadata` backfill
- `summary_rebuild`
- batch detection (`infer`)
- `accept_above`, including the findings F's invariant creates
- the `segment`/`obb` dataset export (F's job, I's writers)
- seg training
- `yolo_seg`/COCO export
- `assist_acquire`

**Synchronous, bounded by one image:**

- Box CRUD and review. Each write recomputes one image's summary.
- `detect`: at most 64 tiles, a 2 s GPU wait, then CPU.
- `segment`: one crop at 1024² model input, with the embedding cached.
- `ImageDetail`, and an image's boxes (at most 5,000).

**Bounded reads:**

- **Index:** at most 100k rows, about 30 B a row, one query on indexed columns. The finding
  `GROUP BY` is bounded by the number of findings, not images.
- **Details:** at most 200 ids per request, for the visible window only.
- **Thumbnails:** 256 px, pre-generated, at most 8 in flight, aborted when they scroll out.
- **Canvas:** one full frame (≤ 4,000 px) and ≤ 4 previews at 2048, in an LRU with `close()`.
- **Map:** points from the index only, the current footprint only, and the background as tiles.
- **Backfill:** one directory listing per source, then one original per image, streamed.
- **Models:** one SAM model and two embeddings resident, and the existing one-model YOLO cache.

## 16. Errors and edge cases

- **No GPS:** a "no location" glyph on the thumb, "N of M without location" on the map, and
  `footprint_kind = none`.
- **No XMP** (non-DJI): intrinsics come from EXIF. GSD is "—" until the operator sets a distance.
  Measure works in px.
- **Pitch near the horizon, or LRF status not Normal:** a wedge or point footprint, and the next
  distance rule.
- **Frame deleted while open:** the workspace moves to the next index entry and toasts.
- **GPU busy:** detect and SAM run on CPU, with a "CPU" chip. Nothing fails.
- **SAM weights missing or failing the sha256 check:** S is disabled with the reason and "Get
  model". The other tools are unaffected.
- **SAM modules missing in the frozen sidecar:** `assist` imports lazily. The tool is marked
  unavailable, the error is logged, and the app still starts (AGENTS invariant).
- **Empty SAM mask:** "Nothing found here, try another point".
- **Invalid polygon:** repaired and flagged. Nothing left gives `422 empty_polygon`.
- **Undo of an accept on an edited finding:** `409 finding_has_content`, with the message "This
  finding has a note or photos; delete it from the inspector."
- **Types:** archived types render but are not offered. Kind changes follow F§7.2, and accept
  routes by the kind at accept time.
- **`422 unmapped_classes`:** links to the model's class map in Models (F§7.4).
  **`409 model_unavailable`:** returned before any work.
- **Tile seams:** a crack across tiles gives two polygons, which are not merged (§20). Seg models
  run on the whole frame when the long side is ≤ 2 × imgsz.
- **Index over 100k rows:** `422 too_many_images`, and the UI asks for a source filter.

## 17. Testing

**Backend (pytest)**

- **XMP:** attribute and element forms, signs, absent XMP and `LRFStatus`, from canned packets
  (M3E, H20T and Mini-style). The import stores the columns. The backfill matches a unique stem
  and skips ambiguous ones.
- **Footprint:**
  - nadir at ψ = 0 is an axis-aligned W·h/f × H·h/f rectangle
  - ψ = 90 rotates it
  - θ = −45 gives a trapezoid
  - θ = −5 gives a wedge or point
  - the yaw sanity rule
  - lat/lon within 0.1 m at 50° latitude
- **Distance and GSD:** rule order, σ, `focal_px` scaling, and agreement with
  `library/gsd.image_gsd_cm`.
- **Boxes:**
  - shape validation, repair and clip, point-needs-defect, the 5,000 cap
  - migration `0011` sets `rbox`
  - the review response ids
  - unreview deletes an untouched finding and refuses one with content
  - F's invariant rows for polygons and points
- **Summary:** a property test. Random sequences of create, update, review and delete give a
  `image_summary` equal to a recompute.
- **Index:** filter and sort parity with `listImages`. Severity and status combine on the same
  finding. The cap.
- **Label writers:** detect edge-clip parity with today's `_label_text`, obb corners, a segment
  multipart clip, `boxes_as_polygons`, and inclusion counts.
- **Providers:** `_from_result` with fake Ultralytics results (boxes, obb, masks). Polygon tile
  offsets. `infer` writes shapes.
- **`detect_one`:** a held GPU lock gives CPU, "already covered" is counted, and the replace is
  idempotent.
- **SAM:** a `SegmentBackend` seam with a fake disc mask
  (`vault/decisions/2026-09-21-gotcha-contract-jobs-need-offline-seams.md`). Contour to at most
  256 vertices, crop mapping, quantised cache hits.
- **Training:** `task_mismatch`, and `(M)` metric parsing from a canned `results.csv`.
- **Contract tests** for every new or changed endpoint.
- **`-m gpu`:** real `sam2.1_t` on a real frame, with IoU ≥ 0.8 against a hand-drawn spall. One
  epoch of `yolo11n-seg` on a 6-image fixture registers a `segment` model.

**Frontend (vitest)**

- The keymap has no collisions.
- Tool state machines: polygon, three-point rbox, measure constrain, the T picker.
- LOD per bucket. `measure.ts` (Feret on a known hexagon, σ).
- `useImageIndex` window batching and LRU.
- The grid window at 20k.
- Filters → query.
- Accept: the store updates and the inspector opens the new finding. **A, 3** sets severity.
- The threshold hides and skips targets. Tab crosses images.
- Arrival (§6.5): `?finding=` selects and pans; `?at=&r=&from=cloud:` centres, draws the static
  ring and the "Back to 3D" chip; malformed values are ignored; the params are dropped after use.

**Playwright e2e** (real backend where the suite already uses it, plus fake seams)

1. Import a 3-frame DJI fixture. Map mode shows 3 points and the footprint polygon, and the info
   chip shows the GSD.
2. Draw a box, a three-point rbox, a polygon and a point. **3** grades. Reload, and everything
   persists; the findings appear in the Findings tab.
3. **D** with the fixture model (a fake provider). **A** accepts and **X** rejects, and Tab moves
   to the next image with suggestions.
4. **S**, a click, **Enter**: a polygon with `assist = sam` (fake SAM).
5. **L** shows mm ± σ.
6. **Frame budget:** 500 annotations (300 polygons of 40 vertices, 200 boxes), panned and zoomed
   for 3 s.
   - `pnpm -C frontend e2e:perf` asserts p95 frame ≤ 16.7 ms locally.
   - CI runs software GL (`vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md`), so it
     asserts the structural proxy: at most one annotation-layer draw per animation frame while
     panning, and no hit-graph rebuild during a pan.
7. **Scale:** a seeded 20,000-image project with a placeholder thumbnail through a seam. The index
   loads in ≤ 500 ms, a top-to-bottom scroll keeps ≤ 60 thumbs in the DOM, and jumping to
   #15,000 renders it.

## 18. Success criteria

1. A DJI flight appears as a grid and a map, with footprints where the gimbal data allows and a
   point otherwise.
2. Every tool works from its key, undo covers every tool, and the status bar says what the tool
   expects.
3. **D → A → 3** makes a graded finding. Objects are accepted and counted without becoming
   findings.
4. Smart polygon works while training runs (on CPU) and is fast on a free GPU.
5. Every mm figure shows its distance source and ± value. With no trustworthy distance, the
   workspace shows px and never an invented mm.
6. Polygons export (YOLO-seg, COCO), build a segment dataset without silent label loss, and train
   a `segment` library model.
7. No full image set is held in memory, and no UI wait is longer than one image's work.
8. 60 fps with 500 annotations on the reference laptop. 20k images scroll without hitching.
9. The Data Manager, Editor, Review and Query screens are gone, and their routes land in the
   workspace.

## 19. Execution DAG

**Units**

- **C0 (contract and schema):**
  - all of §14 and the regenerated client
  - **the one project migration `0011`** (§7.3 columns, §8.1 columns and tables)
  - the `summary.touch` stub
  - the `SegmentBackend` and `labels.write_labels` signatures

  One migration owner avoids the parallel-id trap
  (`vault/decisions/2026-09-23-gotcha-parallel-branches-collide-on-migration-ids.md`). Needs F
  merged.
- **Backend:**
  - **BA (boxes):** `imagery/annotations.py` (moved from `datasets/boxes.py`), shapes,
    validation, the review extras (§8.3), measurements, routes. Needs C0.
  - **BK (camera):** `read_xmp`, the import columns and thumbnails, `camera.py`, `footprint.py`,
    the backfill job, `ImageDetail`. Needs C0.
  - **BX (index):** `summary.py`, `summary_rebuild`, `index.py`, the list filters, and F's
    `image_id` filter. Needs C0.
  - **BS (assist):** the SAM service and seam, the weights catalogue, the acquire and import
    jobs, the segment routes. Needs C0.
  - **BP (detection):** `Detection` shapes, `local_yolo` obb and masks, tiling polygons,
    `_write_shapes`, `detect_one`, `detect-batch`. Needs BA.
  - **BT (segmentation):** `labels.py`, inclusion, F's export and builder hooks, exports, starters,
    `task_mismatch`, `(M)` metrics. Needs BA.
- **Frontend** (against Prism until the backend merges):
  - **FC (canvas core):** `ImageCanvas` layers, the two-level image, LOD, `ShapeLayer`, the tools
    V H B R P M L Del and T, the keymap, commands and history, `store/imagesWorkspace`. Needs C0.
  - **FB (browser):** `useImageIndex`, grid, filters, filmstrip, the OpenLayers map and mini-map,
    footprint. Needs C0.
  - **FA (AI UX):** model menu, AI bar, suggestions layer, hint bar, threshold, A/X/Tab, the S
    tool UI. Needs FC.
  - **FW (assembly):** the three panes, `InspectorColumn`, `MeasuredSize`, the image panel, status
    bar, routes and redirects, the arrival parameters and marker (§6.5), deleting the old screens,
    motion. Needs FC, FB and FA.
- **E (evidence):** e2e flows 1–7, the perf harness, the walkthrough, the `docs/progress.md`
  entry. Needs all.

**Parallel batches** (one worktree per unit; merges into `main` serialized with a rebase and the
gate)

1. **C0**
2. **BA ∥ BK ∥ BX ∥ BS ∥ FC ∥ FB**: six worktrees, with disjoint packages and folders
3. **BP ∥ BT ∥ FA**
4. **FW**
5. **E**

**Critical path:** C0 → FC → FA → FW → E. FC is the largest unit: the canvas rewrite plus five
tool machines.

The backend chain C0 → BA → BP must merge before FA's integration tests move off Prism, and it has
about one unit of slack. BS and BT are off the critical path. Either can slip to a follow-up
release without blocking the workspace: S then shows "not available", and segment export keeps
F's `task_not_supported`.

## 20. Deferred

- **DSM-based AGL** for GSD and footprints, which removes the flat-ground assumption. It waits for
  M's elevation sampling.
- **Crack width by skeletonisation**, for a true max width rather than min Feret.
- **Polygon holes and multipolygons**, and brush/eraser mask editing.
- **Merging polygons across tile seams.**
- **SAM 3** text prompts ("segment all spalling") and automatic everything-segmentation. The
  weights are about 3 GB.
- **Copying annotations** to the next frame, and propagation across overlapping frames.
- **Lens distortion correction** (`DewarpData`) before measuring.
- **An online basemap** option.
- **Same-spot comparison across flights.**
- **Segment models on orthomosaics** (M).
- **Image lengths in the Measurements union**, as a fourth provider on M's `GET /measurements`
  (M owns the endpoint), in a later change.

## 21. Risks

1. **F interfaces move during F's build**, especially A1 (`box` stays the annotation store), A3
   (the invariant's statuses) and A8 (the dataset label JSON). Mitigation: C0 is written against
   merged F code, and §3 is the checklist.
2. **SAM in the frozen sidecar.** Ultralytics' SAM2 modules may need PyInstaller hidden imports
   (`vault/decisions/2026-09-25-gotcha-dynamically-loaded-routers-need-hiddenimports.md`), and the
   CPU latency on the operator's laptop is unmeasured. Mitigation:
   - a lazy import with disablement
   - a `smoke_frozen.ps1` segment call
   - BS measures the CPU target before FA builds the UX on it
3. **Trust in mm and footprints.** Barometric altitude over sloped ground, and yaw conventions,
   mislead. Mitigation:
   - the source and ± are always shown
   - mm are shown only under I-D4
   - the footprint is labelled a visual aid
   - DSM AGL is deferred, not ignored
4. **`image_summary` is a copy of box state.** Mitigation: a per-image recompute in the writing
   transaction (never increments), a property test, and a rebuild job. Finding aggregates are not
   copied.
5. **The keyboard remap:** R was reject and digits were classes. Mitigation:
   - the **?** sheet and the status-bar hints
   - a one-time "keys changed" toast
   - A and X both sit under the left hand
6. **60 fps next to glass on a laptop GPU.** Mitigation:
   - panes without blur (F7)
   - no animation loops on the canvas
   - layer split and LOD
   - the local perf gate
   - F's reduced-effects mode
