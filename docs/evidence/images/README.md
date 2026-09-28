# Images unit E evidence

Plan `docs/superpowers/plans/2026-09-27-images-e.md` (unit I-E), spec
`docs/superpowers/specs/2026-09-26-image-inspection-design.md` §17. Measured 2026-09-28 on
`task/i-e` (HEAD `5138939` plus a prettier-only commit), e2e ports 5590/5591, on the dev machine
(24 logical CPUs) while other units' worktrees shared it. The raw numbers are in the JSON files
next to this README: `frame-time.json` (flow 6, three runs), `map-scale.json` (capture map at 20k
and 100k points, three runs each), `scale.json` (flow 7). `flow1-map.png` is the screenshot flow 1
takes of the Map mode.

## 1. Flows

| Flow | e2e spec (`frontend/e2e/`) | What it proves | Same step on the real API (`backend/tests/`) |
| --- | --- | --- | --- |
| 1 | `images-flight.spec.ts` | a 3-frame DJI flight imports; Map mode shows 3 capture points and the current frame's footprint; the info chip shows "GSD 69.1 mm/px" | `test_images_journey.py::test_flow1_a_dji_flight_has_geo_points_a_footprint_and_a_gsd` |
| 2 | `images-annotate.spec.ts` | box, three-point rbox, polygon and point are drawn; **3** grades; Ctrl+Z/Ctrl+Y; a reload keeps all four; the Findings tab lists them; typing in the note does not switch tools | `test_images_journey.py::test_flow2_four_shapes_make_four_findings_and_a_grade_sticks` |
| 3 | `images-review.spec.ts` | **D** runs the (fake) model; **A** accepts into a finding, **3** grades it, **X** rejects, **Tab** moves to the next image with suggestions | `test_images_journey.py::test_flow3_detect_accept_makes_a_finding_and_clears_the_pending_flag` |
| 4 | `images-smart-measure.spec.ts` (test 1) | **S** warms the embedding, a click segments, **Enter** creates a polygon with `assist = sam` (fake SAM) | `test_images_journey.py::test_flow4_smart_polygon_with_the_fake_backend_creates_a_sam_polygon` |
| 5 | `images-smart-measure.spec.ts` (test 2) | **L** shows "… mm ± …" from the nadir distance; the mm agree (≤ 2 %) with the saved length × GSD | `test_images_journey.py::test_flow5_a_length_has_mm_and_sigma_from_the_nadir_distance` |
| 6 | `images-perf.spec.ts` | 500 annotations (300 polygons of 40 vertices + 200 boxes) panned and zoomed: ≤ 1 annotation draw per frame, no hit-graph rebuild during input; p95 frame budget under `e2e:perf` | none (frontend only) |
| 7 | `images-scale.spec.ts` | 20,000 images: index to caption ≤ 500 ms, ≤ 60 thumbs in the DOM on a full scroll, ≤ 8 thumbnails loading, #15,000 opens | none in the journey; the index SQL is timed by `test_images_scale.py` (`-m perf`, section 4) |

Supporting specs: `images-world.spec.ts` (the route-faked world serves the first DJI frame at its
stored size), `images-workspace.spec.ts` (Images tab lands on its first image; `/review` and
`/query` land in the workspace; cloud arrival ring; finding links), `images-layout.spec.ts` (the
canvas keeps its room and the shortcuts sheet stays in the viewport, successor of the deleted
contour spec), `images-map-scale.spec.ts` (capture map at 20k and 100k points, section 4).

## 2. Seams

**Ruling E1 — why e2e is route-faked.** The e2e suite never starts the backend:
`playwright.config.ts` runs only the Prism mock and Vite. Adding a uvicorn web server to Playwright
would need a data dir, a library and the SAM and YOLO seams inside a separate process, and would
run beside other units' suites on shared ports. So the flows run twice: in e2e against a small
stateful backend in the test process (`frontend/e2e/images/world.ts`), and on the real FastAPI app
in pytest (`backend/tests/test_images_journey.py`, flows 1–5). The two halves are pinned together
by the fixture: `frontend/e2e/fixtures/dji-flight.json` is **written by the real backend** —
`backend/tests/test_images_e2e_fixture.py` imports the same three DJI frames and compares every
camera and footprint number with the JSON (and rewrites it under `KESTREL_WRITE_E2E_FIXTURE=1`). A
change in I-BK's maths fails pytest until the fixture is regenerated.

**Ruling E2 — the seam per flow.** e2e: the fake provider is the `detectImage` route handler
(flow 3); fake SAM is the `prepareImageSegment`/`segmentImage` handlers answering a 24-vertex disc
of radius 40 px around the first positive point (flow 4); the thumbnail seam answers a 1×1 PNG
after `thumbDelayMs` (flow 7); flows 1, 2 and 5 use the world's stateful image, box, finding and
measurement routes. pytest: I-BS's `FakeFactory` on `app.state.segment_service` (flow 4), the
`app.providers.local_yolo._load` monkeypatch with `cuda_available` forced false (flow 3), real
thumbnails written at import. No seam needed production code.

## 3. Frame budget (flow 6)

`E2E_CAPTURE_EVIDENCE=1 pnpm -C frontend e2e:perf`, three runs back to back (one worker; the perf
config runs `images-perf` and `images-map-scale` only). 500 annotations, pan and wheel zoom for 3 s,
p50/p95/max of `requestAnimationFrame` intervals during the input.

| Run | CPU load at start | Frames | p50 / p95 / max (ms) | `sceneMsP95` (ms) | Annotation draws | Max draws per frame | Hit draws during input |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 23 % | 562 | 16.7 / 16.7 / 16.8 | 2.5 | 176 | 1 | 0 |
| 2 | 2 % | 555 | 16.7 / 16.7 / 16.8 | 2.5 | 176 | 1 | 0 |
| 3 | 20 % | 573 | 16.7 / 16.7 / 33.3 | 3.3 | 176 | 1 | 0 |

All three pass the budget (p95 ≤ 17.2 ms). Run 3 dropped a frame — max 33.3 ms (at least one
dropped frame) — with another unit's work on the machine; p95 is unaffected. CPU load is the Win32
processor `LoadPercentage` sampled just before each run.

Environment: `HeadlessChrome/153.0.8010.12` on Windows 10.0 x64, `hardwareConcurrency` 24,
viewport 1600×900 @1×.

**Ruling E3 — what the interval can and cannot show.** Headless Chromium paces
`requestAnimationFrame` at 60 Hz, so an undropped frame reads 16.6–16.8 ms; the harness asserts
`p95 ≤ 16.7 + 0.5` ms. A dropped frame reads ≥ 33 ms, so the 0.5 ms jitter tolerance cannot hide
one. The interval cannot show headroom — a frame that took 3 ms and one that took 15 ms both read
16.7 — so the annotation layer's own `drawScene` time is recorded as `sceneMsP95`: 2.5–3.3 ms, about
a fifth of the frame. It is recorded, not asserted.

**Ruling E4 — the CI proxy.** In every run (the gate too, not only `e2e:perf`) the spec asserts, from
the first input event to the last, at most one `drawScene` on the `annotations` layer between two
animation frames and no `drawHit` on `annotations` or `suggestions`. Both held in every run.

**Not a measurement of the app.** The shipped app runs in WebView2 with its own GPU process; these
runs are headless Chromium driven by Playwright. They show the canvas's work per frame fits, not
what the operator's machine will draw. The installed-build check is walkthrough step 8.

## 4. Scale (flow 7 and the capture map)

**Flow 7** (`scale.json`, `playwright test e2e/images-scale.spec.ts`, CPU load 40 % at start):

| Measure | Value | Budget |
| --- | --- | --- |
| Index to caption "20,000" (`indexMs`) | 78 ms | ≤ 500 ms |
| Grid tiles in the DOM, max over the scroll | 24 | — |
| Filmstrip thumbs in the DOM, max | 8 | — |
| Grid + filmstrip, max at any scroll step (`maxThumbs`) | 32 | ≤ 60 |
| ThumbLoader in flight, peak (`window.__kestrelThumbs`) | 8 | ≤ 8 |
| Thumbnail fetches in flight seen on the network (storm guard) | 16 | ≤ 24 |
| Ids per `listImages` call, max | 24 | ≤ 200 |
| Jump to #15,000 | opens, status "Image 15,000 / 20,000", tile in view | — |

**Backend index** (`pytest -m perf tests/test_images_scale.py -q -s`, CPU load 17 % at start): the
real SQL on 20,000 seeded rows through `TestClient`, `GET …/images/index?fields=geo`, five runs
`[111, 56, 50, 113, 51]` ms, **median 56 ms** (budget ≤ 500 ms).

**Ruling E5 — both halves.** "Index loads in ≤ 500 ms" is measured twice: (a) in e2e, from the
page's `fetch` of `…/images/index` to the grid caption showing the 20,000 total — client parse and
first render, against a route-faked answer — runs in every e2e run; (b) in pytest `-m perf`, the
real SQL, median of 5. (b) is deselected from the gate (`addopts` excludes `perf`): its timing under
a parallel gate would measure the machine, so it runs here.

**Ruling E6 as built.** The thumbnails are `blob:` URLs (the ThumbLoader fetches and hands the tile
an object URL), so the plan's `img[src*=/thumbnail]` selector matched nothing. "≤ 60 thumbs in the
DOM" is the sum of grid tiles (`data-testid="image-thumb"`) and filmstrip thumbs at every scroll
step. The ≤ 8 in flight is the app's concurrency budget, read from the loader itself through the
diagnostics hook `window.__kestrelThumbs` (flag `kestrel.diagnostics`, frozen object). The
network-side count is only a storm guard ≤ 24: a dev build under StrictMode double-mounts, and the
aborts of a previous batch reach CDP late, so the network sees up to 16 while the loader holds 8.

**The bug flow 7 found.** On the first run every one of the 20,000 tiles was in the DOM:
`BrowserPane.tsx`'s grid wrapper was not a flex column, so the grid was unbounded and virtualisation
rendered everything. I-E fixed it (commit `0a4b10f`, one class list, with a vitest pin); the numbers
above are after the fix.

**Capture map** (`map-scale.json`, three runs inside `e2e:perf`):

| Points | Ready (ms), runs 1 / 2 / 3 | Renderer | Pan/zoom phase |
| --- | --- | --- | --- |
| 20,000 | 276 / 317 / 378 | ANGLE Vulkan SwiftShader | skipped (software GL) |
| 100,000 | 1360 / 1386 / 1407 | ANGLE Vulkan SwiftShader | skipped (software GL) |

The point count and the ready time are asserted always (ready ≤ 5 s). Drag-panning a map of
≥ 10,000 points locks headless Chromium here; its WebGL is SwiftShader (a CPU profile at 5k points
is 69 % native, no JS hotspot; hover is already skipped while dragging). This is treated as a
software-GL artefact: the pan phase runs only on a hardware renderer and is skipped with an
annotation otherwise. **IMC-X must pan a 20k-point capture map on the installed WebView2 build**
(walkthrough, unit lines); if it degrades there, it is I-FB's (clustering / level of detail).

## 5. Operator walkthrough (run by IMC-X on its installed build; R9)

1. Open a project, **Add data → Photos**, choose a DJI flight folder. The Images tab shows the
   frames as a grid; **Shift+M** shows the capture points and the current frame's footprint; the
   info chip shows "GSD … mm/px" (or "GSD —" and "Set distance…" for a non-DJI camera).
2. Press **T**, pick Crack, press **B** and drag a box. The inspector shows the new finding;
   press **3**: it is Major. Draw a rotated box (**R**, three points), a polygon (**P**, clicks,
   Enter) and a point (**M**). **Ctrl+Z** removes the point, **Ctrl+Y** brings it back. The status
   bar says what each tool expects.
3. Reload the window: all four shapes are there. The **Findings** tab lists them.
4. Press **D**, choose a library model, press **D**: suggestions appear with a hint bar. **A**
   accepts one (it opens as a finding), **3** grades it, **X** rejects another, **Tab** jumps to the
   next image with suggestions.
5. Press **S** (if asked, "Get smart polygon model"), click a spall, press **Enter**: a polygon
   appears. Start a training run and try again: it still works, marked CPU.
6. Press **L**, click twice across a crack: the length reads "… mm ± …" with its distance source.
7. Open `/review`, `/query` and `/label` from an old bookmark: each lands in the workspace.
8. On a large flight, scroll the grid top to bottom and use ←/→: it stays smooth.

### Unit lines

Workspace and inspector (I-FW):

- Opening **Images**: the three panes rise once; the status bar reads "Image 1 / N · Reviewed … ·
  Saved"; a one-time toast says the keys changed. → and ← change the frame without replaying the
  panes.
- With nothing selected the inspector shows camera, distance with source and ±, GSD and footprint.
  Type 12 in **Subject distance**, Enter: the info chip's GSD changes; clearing restores the
  automatic value.
- Select a defect box: the finding inspector shows Measured size in mm ± and "from GSD … at … m
  (nadir approx.)"; **Show on image** pans to it. "Findings on this image" lists findings, then
  objects; a row click selects and pans.
- Below 1100 px wide the inspector hides (**Ctrl+]** shows it); below 960 px **Ctrl+[** shows the
  browser.
- `/p/<id>/images/<imageId>?at=2000,1300&r=40&from=cloud:<cloudId>`: a dashed ring and "Back to 3D"
  appear and the URL is cleaned; **Esc** removes the ring. With a cloud covering the flight, Image
  actions offers "Open in 3D · <cloud>".
- From the Findings tab, open a finding: its image opens with the finding selected. `/edit/<id>`
  opens that image; More → Review shows the detection runs picker. Under the Unlabeled filter, **N**
  keeps the frame open with no "deleted" toast.

Canvas tools (I-FC):

- **V**, drag the rotate handle with **Shift**: it snaps every 15°. **Alt+Shift+→** moves 10 px,
  **Alt+→** 1 px. **Alt+click** a polygon edge adds a point, **Alt+click** a point removes it; at
  three points a toast refuses.
- With nothing selected, **T** opens "Choose a type" at the cursor. **M** offers defect types only.
  The chosen type is remembered per tool.
- Select a shape whose finding has a note and press **Del**: "Delete this shape? F-0001 has a note,
  photos or comments…". **Keep** keeps it; **Delete** removes it; **Ctrl+Z** brings the shape back.
  Retyping a Crack to an object type asks "Change to an object type?" and names the finding.
- **Ctrl+Z** of a shape whose finding has since gained a note or photos refuses: "This finding has a
  note or photos; delete it from the inspector."
- Tab to a palette button and press **Space**: the button is pressed, the canvas does not pan.
- Zoom past about 51 %: the frame sharpens. **0** fits, **Shift+H** hides annotations, **G** toggles
  suggestions.

AI (I-FA, I-BP, I-BS):

- The **D** toast reads "<Model>: N new, M already covered", plus "· ran on CPU" while training
  holds the GPU. **]** hides weak suggestions and the hint bar says how many are hidden; the
  threshold is kept when the project is reopened. **Ctrl+Z** after an accept puts the suggestion
  back.
- **S** without the SAM weights offers "Get smart polygon model (≈78 MB)"; the download shows in
  Jobs. Shift+click excludes; **Esc** clears the points, a second Esc deselects. A click on empty
  ground says "Nothing found here, try another point".
- `…/images?batch=1`: "Detect on many images" queues a run; when it ends the toast offers "Review
  suggestions →".
- A detect run over a photo source with an OBB or segmentation model produces detections; over a
  map source it is refused.

Segmentation training (I-BT):

- Models → Datasets → New dataset, Task = Polygons: the preview says how many images are skipped
  (boxes or point markers); "Boxes as polygons" removes the skipped line. Training on it lists only
  segmentation models, progress shows "Mask mAP50", and the finished model lists Mask mAP50 and
  Mask mAP50-95, task "Polygons".
- Results → Export with YOLO-seg polygon labels: the export holds `labels_yolo_seg\<site>\*.txt`;
  COCO polygons carry `segmentation`.

Summary and index (I-BX, I-FB):

- An existing project with labelled images opens without a summary rebuild job; box and pending
  counts match before; point markers no longer count as labels. Drawing a box or reviewing a
  suggestion changes that image's counts at once.
- Changing a finding's severity sends one `PATCH` and one read each of findings, summary, activity
  and overview (no duplicate detail reads).

Scale and retired features (I-E):

- Open a flight of about 20,000 frames, **Shift+M**, and drag-pan and zoom the capture map: it must
  stay responsive (headless Chromium could not test this; see section 4).
- **Retired by operator decision 2026-09-28:** resuming an interrupted detection run and bulk-undo of
  accepted labels (unpromote) have no UI. Nothing to test; the Setup agent's "Resume first labeling"
  still works.

## 6. Findings

| Finding | Owner | State |
| --- | --- | --- |
| `BrowserPane.tsx` grid wrapper not a flex column, so virtualisation rendered all 20,000 tiles | I-FW (file) | fixed in I-E, `0a4b10f` |
| Capture-map drag-pan at ≥ 10k points locks headless Chromium (SwiftShader) | I-FB if it reproduces on WebView2 | open: IMC-X pans a 20k map on the installed build |
| `exports/rows.load` reads the whole project into memory (D5) — a known exception to bounded reads | IMC-X / next export work | open, recorded |
| Retired: resume-interrupted-detection-run and unpromote. Deleted unused client helpers `fetchQueryRun`, `fetchQueryRuns`, `promoteQueryRun`, `unpromoteQueryRun` (+ `PromoteResult`/`UnpromoteResult`); backend routes kept; `resumeQueryRun` kept (Setup agent calls it) | operator decision | done, `c6aa4d7` |
| Flakes named in the hand-offs (`training.spec.ts:4`, the old editor spec's successors, three backend load flakes) did not reproduce in 20–41 e2e runs or 3× alone; `test_exports_job.py` start waits raised 2 s → 20 s | I-E | done, `775dbcc` |

Cheap deferred minors of other I units fixed in I-E (Task 11b, `6de8260`, `f6a3b31`): stale module
names in the `app/detect/review.py` and `app/datasets/router.py` docstrings; the SAM `read_crop`
404 names the image id instead of leaking a local path; ASCII quotes in the `all_skipped` message;
a `camera_columns` docstring; a redundant `disabled?` field in `DatasetBuilder.tsx`; `group_key: ""`
(not null) in the `images-workspace.spec.ts` mock. Seven more were already fixed upstream.
