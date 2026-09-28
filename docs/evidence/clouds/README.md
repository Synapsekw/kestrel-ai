# Point clouds (C): evidence

Unit C-G, run on `task/c-g` (cut from `main` at `81b0310`). Spec
`docs/superpowers/specs/2026-09-26-point-cloud-workspace-design.md` §13, §15, §16. Plan
`docs/superpowers/plans/2026-09-27-clouds-g.md`.

## e2e coverage (§15 items 1-13)

| Item | What                                                                                    | Owner                 | Spec file :: test                                                                                                                                                                                                                                                                                                                                                                                                           | Status                  |
| ---- | --------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1    | Layout: panels at mockup positions, canvas = viewport, callout never over the inspector | W1                    | `clouds-workspace.spec.ts :: "layout: every panel sits at its mockup position and the canvas fills the viewport (spec §15 e2e 1)"`                                                                                                                                                                                                                                                                                          | present                 |
| 2    | Tool keys arm tools, hint bar changes, Esc Esc → Orbit                                  | W1                    | `clouds-workspace.spec.ts :: "tool keys arm tools, the hint bar follows, Esc and Esc again return to Orbit (spec §15 e2e 2)"`                                                                                                                                                                                                                                                                                               | present                 |
| 3    | Pin flow: createFinding anchor keys, view3d meta `anchor_normal`, reload                | P1                    | `clouds-pins.spec.ts :: "pin flow: M, pick, choose a type, Enter creates with F's cloud anchor, the pin stays after reload"`                                                                                                                                                                                                                                                                                                | present*                |
| 4    | Occlusion: a pin behind the wall is `back` after settle                                 | P1                    | `clouds-pins.spec.ts :: "occlusion: a pin behind the wall gets back after settle, a pin in front stays visible"`                                                                                                                                                                                                                                                                                                            | present                 |
| 5    | Area: 4 picks, Enter, POST has 4 points and `mode`, row shows the area                  | M1                    | `clouds-measure.spec.ts :: "area: four picks and Enter save the outline with its mode (spec §15 e2e 5)"`                                                                                                                                                                                                                                                                                                                    | present                 |
| 6    | Cross-section: preview, Save → 202, `pointclouds.changed` → "Full resolution"           | M1                    | `clouds-measure.spec.ts :: "cross-section: preview, Save answers 202, then Full resolution on pointclouds.changed (spec §15 e2e 6)"`                                                                                                                                                                                                                                                                                        | present                 |
| 7    | Colour modes disabled/enabled by attributes                                             | V1                    | `clouds.spec.ts :: "colour modes: Intensity and Class are off for a cloud without those attributes"` and `"colour modes: a cloud with intensity and classification draws in both"`                                                                                                                                                                                                                                          | present**               |
| 8    | Cameras: glyphs, popover, Look through                                                  | L1                    | `clouds-cameras.spec.ts :: "cameras: the switch shows the glyphs, a glyph opens its popover, Look through frames the photo"`                                                                                                                                                                                                                                                                                                | present                 |
| 9    | Photo link: I, pick, list, click → images URL                                           | L1                    | `clouds-cameras.spec.ts :: "photo link: I, a pick, the list, and a click opens the image at the spot"`                                                                                                                                                                                                                                                                                                                      | present                 |
| 10   | Arrival: `?from_image=&px=` (posed, position-only), `?finding=`                         | L1 / G                | `clouds-cameras.spec.ts :: "arrival from a posed photo pixel looks through the drone and marks the hit"`, `"arrival from a position-only photo falls back to where the drone was"`, `"arrival from a photo that is not near the cloud says so"`; `clouds-gaps.spec.ts :: "item 10: ?finding= selects the finding and frames its pin"`, `"item 10: ?finding= for a finding outside the loaded 500 pins — today's behaviour"` | present (G gap-fill)*** |
| 11   | Idle: 0 rAF, no running animation 1 s after settle, 50 pins                             | P1                    | `clouds-pins.spec.ts :: "idle: 0 animation frames and no running animation 1 s after settle with 50 pins"`                                                                                                                                                                                                                                                                                                                  | present                 |
| 12a  | Report view PUT after a pin create, 1600×1000, `anchor_normal` in meta                  | G (controller update) | `clouds-journey.spec.ts` step 5                                                                                                                                                                                                                                                                                                                                                                                             | G: Task 4/5             |
| 12b  | Refresh view sends the on-screen camera pose                                            | G (controller update) | `clouds-journey.spec.ts` step 6b                                                                                                                                                                                                                                                                                                                                                                                            | G: Task 4/5             |
| 12c  | Capture missing views: progress, Cancel                                                 | R1                    | `cloud-report-views.spec.ts :: "Capture missing views saves a 1600 x 1000 PNG with its pose for each of 3 subjects"`, `"Cancel stops Capture missing views after the capture in flight"`                                                                                                                                                                                                                                    | present                 |
| 12d  | PNG decode (not uniform), pose meta                                                     | R1                    | `cloud-report-views.spec.ts :: "Capture missing views saves a 1600 x 1000 PNG with its pose for each of 3 subjects"`                                                                                                                                                                                                                                                                                                        | present                 |
| 13   | Frame-time harness, 200 pins, reported not asserted                                     | G                     | `clouds-frame-time.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                 | G: Task 4/5             |

\* The spec's item 3 also names "a `PUT …/view3d` carries `anchor_normal` in its meta"; the plan
already carves that specific observable out into item 12a (G's own task), so `clouds-pins.spec.ts`
is scored present for the rest of the flow (M, pick, callout, type choice, Enter → `createFinding`'s
anchor keys, the pin shown, reload, the pin persists). Its own comment notes it checks the
diagnostics pin's `normal` instead of an uploaded view, because C-R1 was not yet on `main` when C-P1
wrote it; C-R1 has since merged, but the test was not revisited — item 12a is where the view3d/
`anchor_normal` assertion actually lives.

\*\* Task 1 Step 4's owner note named `clouds-engine.spec.ts` for item 7; the real tests are in
`clouds.spec.ts` (code wins, ruling G3 extended to test locations, not just selectors).

\*\*\* The `?from_image=&px=` sub-cases (posed, position-only, and "not near the cloud") are e2e-tested
in `clouds-cameras.spec.ts`. The `?finding=` arrival case previously had **no e2e coverage** for the
point-cloud workspace (`useFindingArrival.ts` was exercised only by the vitest unit test
`frontend/src/clouds/pins/useFindingArrival.test.tsx`; `frontend/e2e/images-workspace.spec.ts:142`
uses a `?finding=` URL but for the _images_ workspace, not clouds) — Task 6 (C-G gap-fill) added
`clouds-gaps.spec.ts`'s two `item 10` tests to close it.

The second test documents a real gap, not just fills a scoring box: a `?finding=` link to a finding
outside the loaded 500-pin cap (`PIN_CAP`, `frontend/src/api/cloudFindings.ts`) still flies the camera
to the finding's anchor (`flyToPin` reads the finding document directly, not the pins list), but no
callout appears and the pin is never drawn, because `PinsLayerController`'s pin map only holds what the
capped list loaded (`placeCallout` bails out silently when the selected id has no entry). Reported to
the controller as a product gap worth a follow-up (a user who follows such a link gets no visible sign
of where they landed), not fixed here (no app-code edits in this task).

## Baseline (Task 1 Step 2, controller-scoped: point-cloud e2e specs only, ports 5600/5601)

Ran directly against `npx playwright test` (see "pnpm passthrough" note below) with
`E2E_WEB_PORT=5600`, `E2E_MOCK_PORT=5601`, restricted to the 9 point-cloud spec files:
`clouds.spec.ts clouds-cameras.spec.ts clouds-engine.spec.ts clouds-engine-v2.spec.ts
clouds-measure.spec.ts clouds-no-webgl.spec.ts clouds-pins.spec.ts clouds-workspace.spec.ts
cloud-report-views.spec.ts pointcloud-foundation.spec.ts`.

**52 passed, 0 failed, 0 skipped, 0 fixme** (47.6 s).

Note: `pnpm -C frontend e2e -- <files>` (as the brief's Step 2 command reads) did not narrow the
run on this machine — pnpm forwarded a literal `"--"` ahead of the file args into `playwright test`,
and Playwright then ran the whole e2e suite (121 passed, 0 failed, 0 skipped, 0 fixme, 1.1 min) rather
than the 9 files. Both runs are fully green; the `npx playwright test <files>` form above is the one
that actually narrows, and is what later G tasks should use for point-cloud-only runs.

## Step 3: S1 tests W1 parked (ruling G2)

```
git grep -n "test.fixme\|test.skip" -- frontend/e2e/clouds.spec.ts frontend/e2e/pointcloud-foundation.spec.ts frontend/e2e/clouds-no-webgl.spec.ts
```

Zero matches. W1 kept all three S1 specs green through its merge — no `test.fixme`/`test.skip` lines
exist to remove. (Confirms the controller's note that W1 kept the three S1 specs green.)

## Step 5: consumed interfaces vs the merged code

- `frameTimes()` and `pins()` are both declared on `CloudViewerDiagnostics`
  (`frontend/src/clouds/viewer/diagnostics.ts:55,117`) — G13 does not apply, G is not blocked.
  `pins(): PinDiag[]` (`diagnostics.ts:117`, `PinDiag` at `diagnostics.ts:161`), so `pinStates`
  uses `window.__kestrelCloudViewer?.pins() ?? []` directly, no cast, and `PinState` is `PinDiag`
  itself (id, x, y, state, occluded, normal, passMs) rather than the brief's narrower
  `{id,x,y,state}`. C-P1 hand-off: a `hidden` pin's `x`/`y` come back `NaN`; `pinStates` documents
  this and `visiblePins(page)` filters to `state !== "hidden"` rows with finite `x`/`y` for later
  tasks.
- I-FW has merged: `git grep -n "from=cloud\|fromCloud" -- frontend/src/images` finds
  `frontend/src/images/workspace/arrival.ts` parsing `from=cloud:` (ruling G10). The cloud → image
  arrival is live, not just the URL builder in `frontend/src/clouds/jump.ts`.
- Selector/name differences from the spec/brief (every one below is applied in `cloudWorkspace.ts`):

## Deviations (code wins over the spec's names; ruling G3)

| Spec name                                                       | Name on `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getByRole("toolbar", { name: "Tools" })`                       | `getByRole("toolbar", { name: "Point cloud tools" })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `frontend/src/clouds/workspace/Palette.tsx:19` (`FloatingToolbar label="Point cloud tools"`)                                                       |
| Tool name `"Pin finding"`                                       | `"Pin a finding"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `frontend/src/clouds/workspace/tools.ts` (`entry("pin", "Pin a finding", ...)`) — also its hotkey binding label in `frontend/src/ui/keymap.ts:206` |
| `getByTestId("pick-readout")`                                   | `getByTestId("cloud-readout")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `frontend/src/clouds/workspace/Readout.tsx:44`                                                                                                     |
| `getByTestId("cloud-hint-bar")`                                 | `getByTestId("cloud-hintbar")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `frontend/src/clouds/workspace/HintBar.tsx:40`                                                                                                     |
| `getByRole("region", { name: "Site map" })`                     | `getByTestId("cloud-minimap")` (no `region` role; the inner `<svg>` only has `role="img" aria-label="Site map: click to centre the view there"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `frontend/src/clouds/workspace/SiteMinimap.tsx:113-136`                                                                                            |
| `getByRole("button", { name: new RegExp(`^${cloudName}`) })`    | `getByRole("button", { name: new RegExp(`^Point cloud: ${cloudName}`) })` — the picker button's accessible name is `Point cloud: {name} · {date} · {count}. Choose another`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `frontend/src/clouds/workspace/CloudPanel.tsx` (`CloudPicker`, `aria-label={`Point cloud: ${title}. Choose another`}`)                             |
| `inspectorPanel: page.getByRole("tabpanel")`                    | `page.getByTestId("cloud-inspector")` — no `role="tabpanel"` exists anywhere in `frontend/src` (`git grep -n "tabpanel" -- frontend/src` is empty); `Tabs.tsx`'s tab buttons carry no `aria-controls`, and the active tab's body is a plain, unlabelled `<div>` inside the same `GlassPanel` as the tab bar. `cloud-inspector` is the closest real container (tab bar + body together); a caller after just the body scopes further into `findingsTab`/`measurementsTab`'s own named regions instead (`getByRole("list", { name: "Findings on this cloud" })`, `getByRole("list", { name: "Saved measurements" })`, or `getByTestId("cloud-findings-tab")`). Found in review round 1. | `frontend/src/clouds/workspace/Inspector.tsx:27` (`data-testid="cloud-inspector"`), `Inspector.tsx:46` (the unlabelled body `<div>`)               |
| `image-arrival-ring`                                            | `arrival-marker` — a hidden DOM probe standing in for the Konva ring; the test asserts its `data-at` attribute, not `toBeVisible`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `frontend/src/images/workspace` (I-FW's `ArrivalProbe`)                                                                                            |
| The brief's 1 x 1 grey PNG literal (Task 4 Step 3)              | Not a decodable PNG (`createImageBitmap` throws "could not be decoded"); replaced with a generated valid 1 x 1 grey PNG (Python zlib)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `frontend/e2e/clouds-journey.spec.ts`                                                                                                              |
| The brief's landing image (C-L1's `routeImageRow`, 2048 x 1536) | The journey routes its own image row at 4000 x 3000 (`nadirCamera()`'s size) — at 2048 x 1536 the pixel falls outside the image and I-FW's `withinImage` drops the arrival (and the Back to 3D chip with it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `frontend/e2e/clouds-journey.spec.ts`                                                                                                              |

Everything else in the brief's `ws()` (viewport/canvas/callout test ids, the Inspector tablist, the
Colour by radiogroup and its RGB/Elevation/Intensity/Class radios, Point budget/Point size sliders,
EDL shading and Show camera positions switches, the Top/Front/Side/Iso view buttons, the Photos
that saw this point list) matched the merged code exactly — confirmed by direct `git grep`/read
against the components, not carried over unchecked. `inspectorPanel` did not (review round 1
finding, above) and has been fixed.

## G5: per-pass function names for the driver defaults

- Pin projection pass: `projectPins` (`frontend/src/clouds/pins/project.ts:82`; there is also a
  single-pin `projectPin` at line 48, but the per-frame pass over every pin — the one the pin-pass
  timing budget applies to — is `projectPins`).
- Occlusion pass: `occlusion` — a method on the engine's returned handle
  (`frontend/src/clouds/viewer/engine.ts:170`, implementation around the engine's occlusion query),
  also exposed on the diagnostics hook as `occlusion(points, tolM)` (`diagnostics.ts:96`).
- Hover pick: `pickAtClient` (`frontend/src/clouds/viewer/engine.ts:138,624`; also on
  `CloudViewerHandle` at `frontend/src/clouds/CloudViewer.tsx:42,384`).
- Correction (Task 9): the app never calls `projectPins` (only its tests do); the per-frame pin pass
  is `PinsLayerController.frame` (`frontend/src/clouds/pins/pinsController.ts`, the span its own
  `lastPassMs` times). `measure-cloud-workspace.mjs` defaults to `frame@pinsController` (a
  function name narrowed to scripts whose url contains `pinsController`; `profileTotals` in
  `cloud-perf-lib.mjs`). The hover pick runs only while a picking tool is armed (engine.ts
  `pointermove`: `events.isArmed()`), so the driver arms Point for the hover window.

## Fixture adaptations (`cloudWorld.ts` vs the brief, checked against `contract/openapi.yaml` /

`contract/client/schema.d.ts`)

`CloudMeasurementOut`, `CloudViewOut`, `CloudCameraSet`, `Finding`/`FindingDetail` and
`FindingCloudAnchor` all matched the brief's literal fixture objects field-for-field on the merged
contract — no field renames were needed. The one behavioural change from the brief: the default
"no cameras" answer for `GET .../cameras` now reuses C-L1's `emptyCameras()`
(`frontend/e2e/fixtures/cameras.ts`) instead of an inline empty object, per the controller's
decision — Prism's own `CloudCameraSet` example draws a frustum and a warn-point glyph, which can
add a stray render frame or a stray drawn point to a spec that counts idle frames or samples
colours without caring about cameras.

## Task 3: `pointcloud-foundation.spec.ts` needs its own octree/camera fixtures (deviation)

The brief's literal script for `pointcloud-foundation.spec.ts` opens `/p/${P}/clouds` with no
routes stubbed at all, relying entirely on the Prism mock's own examples ("the Prism example cloud
is not drawn, only the routes and the workspace shell are checked"). Run as written, this fails:
Prism's `GET .../pointclouds` and `.../pointclouds/{id}` examples serve fine (`PointCloudOut`'s
`example:` block, id `c0000000-8888-4000-8000-000000000001`), but the octree binary endpoint has no
schema example, so Prism answers with its generic placeholder (`"string"`), which the viewer's
octree loader cannot parse (`Unexpected token 's', "string" is not valid JSON`). That sends
`CloudViewer` straight into its `loadError` state ("The 3D view could not be shown"), `hasView`
never becomes `true`, and the palette/toolbar this test checks never renders — confirmed by running
the brief's script unmodified and reading the failure's `error-context.md` snapshot.

Fix (test-only, no app code touched): route `GET .../pointclouds/{CLOUD}/octree/*` with a real
octree via `routeOctree`/`buildOctree`/`redGreenGrid` (`frontend/e2e/fixtures/potreeOctree.ts`,
the same helpers `clouds-workspace.spec.ts` uses) and `GET .../cameras` with C-L1's `emptyCameras()`
(`frontend/e2e/fixtures/cameras.ts`), both keyed on `CLOUD` from `frontend/e2e/fixtures/clouds.ts`
— which happens to equal Prism's own example id, so the `/pointclouds` list and detail routes are
still left unstubbed and served by Prism, keeping the spirit of "the routes are checked" while
supplying the one thing Prism cannot: real octree bytes. The mismatch between the octree's own
coordinate origin (`[243500, 3178000, 0]`, S1's fixture grid) and Prism's example `bounds_native`
(a different site, `[553012.4, 2847210.9, -52.3, …]`) does not matter here since the test never
asserts on visual framing or drawn content, only that the workspace shell (palette, tool state)
renders.

## Task 8: `cloud-ui.mjs` and `check:webview` (drivers only; IMC-X runs it — G11)

- `typeCombo` is not a `role="combobox"` named `"Type"` (the brief's draft): `PinCallout.tsx`'s
  `Combobox` trigger is a plain `<button>` with `aria-label="Type: <selected label or 'none'>"` —
  `role="combobox"` only exists on the popover's filter `<input>`, which isn't in the DOM until the
  trigger is clicked (`frontend/src/ui/Combobox.tsx`). `cloud-ui.mjs`'s `ui(page).typeCombo` is
  `callout.getByRole("button", { name: /^Type:/ })`, matching the real accessible name
  (`frontend/src/clouds/pins/PinCallout.test.tsx:186`).
- `palette` uses the real toolbar name `"Point cloud tools"` (already the fixture's name, see
  "Deviations" above) and `hint`/`hintCancel` use the real test id `cloud-hintbar`, not the brief's
  `cloud-hint-bar`/`"Tools"`.
- `hintCancel` targets `SavingViewsHint.tsx`'s progress-row `Cancel` button (plain text, no
  `KeyChord`), which is what's on screen while `w.captureMissing()`'s bulk capture runs
  (`frontend/src/clouds/views/SavingViewsHint.tsx:22-24`); scoped with `exact: true` since a
  tool's own `Cancel <KeyChord/>` in the hint bar (`HintBar.tsx:55-57`) would otherwise also match
  a loose `/Cancel/` regex if a tool happened to be active at the same time.
- Per the brief's instruction for spec §7 ("when EDL cannot render to a target … record
  `edl: false`"): C-V1 Ruling 3 / C-V2 Ruling 5 record `EDL_RENDERS_TO_TARGET = false` as a fixed
  potree-core 2.0.15 limitation (`frontend/src/clouds/viewer/edl.ts`), not a maybe — every capture's
  `render.edl` is `false` regardless of the on-screen EDL switch. `check-packaged-webview.mjs`
  therefore logs a `webview WARN` line instead of failing when `v.render.edl !== true`; it still
  fails on capture size, sha256 mismatch, and a blank/near-blank decode (≥ 2 distinct colours,
  non-background share > 1 %).
- `check-packaged-webview.ps1`'s project setup was already stale against the merged contract
  (`ProjectCreate` no longer has `classes`/`kind` — see `type_ids`, `contract/openapi.yaml`); Task 8
  replaces it with a `POST /catalogue/types` "Crack" defect type (idempotent: falls back to
  `GET /catalogue/types` on a 409) and `POST /projects` with `type_ids`, so the driver can create
  defect findings.
- Static checks only (`node --check` on both `.mjs`, a PowerShell `Parser.ParseFile` pass on the
  `.ps1`, a `node -e import()` smoke test) — G never runs `pnpm check:webview` or
  `build-installer.ps1` (ruling G11); IMC-X runs it against the packaged exe.

## Task 5 fix round 1: `clouds-frame-time.spec.ts` was reporting load-phase frames, not orbit frames

Review round 1 (Review Focus item 4 — "the drag never moved the camera") found that the harness's
original mouse drag, starting from the canvas's own centre pixel with 200 pins on screen
(`gridPins(200)`), could land on a pin's DOM element (`kp-pin-drop`/`kp-pin-head`,
`frontend/src/clouds/pins/pinsController.ts`) or a docked panel instead of the bare `<canvas>`
(`document.elementFromPoint` at the drag's start confirmed this). Pins intercept the pointer before
three.js's `OrbitControls` — which listens on the canvas element itself — ever sees it, so the
camera silently never moved. The old assertions could not catch this: the local rAF tick counter
runs on the browser's own clock regardless of camera motion, and V1's `FrameRing`
(`frontend/src/clouds/viewer/frameRing.ts`) is never cleared, so `frameTimes()` returning a handful
of load-phase frames alone was already enough to pass `render.samples > 0`. The original 3
evidence runs' `render.samples` (62, 70, 64) versus `raf.samples` (283, 282, 284) show this in
hindsight: `render` was scoring only leftover load-phase pushes, not 5 s of orbit.

Fix: the harness now drives the camera with the engine's own `scriptOrbit()` diagnostics hook
(already exercised by `clouds-engine.spec.ts` — "frame times fill during an orbit"), which steps
`camera.position` directly every tick and is immune to what's on top of the canvas. It also records
`cameraPose()` and `frameTimes().length` before the orbit and asserts the pose actually moved and
the ring grew by ≥ 30 frames during the orbit window, scoring `render` only over that tail
(`frameTimes()`'s ring caps at 600; 5 s at 60 Hz is ~300 pushes, so no wrap can occur mid-orbit).
`pins` in the evidence JSON is now the polled pin count, not the literal `200`.

The 3 runs originally captured under the buggy methodology were replaced (not appended to) with 3
fresh orbit-only runs; `render.samples` in the new runs (≈ 280–301) now tracks `raf.samples`
(≈ 280–283) as expected for a genuine ~5 s orbit.

# Task 11: acceptance (§16 items 1-10) and performance (§13), 2026-09-28

Everything below ran in **dev mode, in Edge 154.0.4258.37 on an RTX 5070 Ti** (ruling G1): the venv
backend, Vite, and Microsoft Edge over CDP. The launcher is
`frontend/scripts/run-dev-cloud-acceptance.ps1`, the driver `frontend/scripts/measure-cloud-workspace.mjs`,
and the API scenarios `backend/scripts/pointcloud_acceptance.py`. Work dir:
`D:\kestrel-acceptance\clouds` (not committed). Per-pass times (pin pass, occlusion, hover pick) are
**CPU-profile estimates at 100 µs sampling (G5)**, with precise-coverage call counting on. They are
cross-checked against the app's own timers: the pins layer's `passMs`, and the diagnostics hook's
timed `occlusion()` over the same shown pins. No credential value is in any file here (the Step 9 grep is below).

Verdict words: `pass`, `fail (<why>, reported to <unit>)`, `not run (<why>)`, `pending operator`.
Targets are applied literally.

## Data

| What             | Where                                                                                                                                          | Size / count                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Chimney LAS      | `D:\kestrel-acceptance\clouds-data\chimney.las` (S1's `Chimney stack 3D_group1_densified_point_cloud.las`)                                     | 21 697 184 points, 737 705 337 bytes, LAS 1.2 format 3, EPSG:32639                                                                     |
| 195 M LAZ        | `D:\kestrel-acceptance\clouds-data\big9.laz` (S1's `big9.las` tiled by `make_tiled_cloud.py`, compressed with laspy/lazrs in 2 M-point chunks) | 195 274 656 points, 1 386 992 714 bytes                                                                                                |
| Posed DJI flight | `\\DanNas\Work Data\Inspections\Kuwait\Chemney Stack POC\I2 3D Modeling\RAW Data`, read in place                                               | 420 `DJI_*.JPG`, DJI FC6540, 5248 × 3936, gimbal yaw/pitch/roll in XMP; 395 are near the cloud, and all 395 are posed (`cameras.json`) |
| S1 rim centre    | `docs/evidence/2026-09-24-point-clouds/rim.txt`                                                                                                | 243513.718, 3178242.151; top points z 189.264–189.554, so the brief's z = 189.3 is kept                                                |
| Staging record   | `D:\kestrel-acceptance\clouds-data\staging.json` (Step 1, done before this task)                                                               | all byte and point counts verified                                                                                                     |

The setup (the launcher's first run, `layout`) imported the cloud in **9.35 s** and the 420-photo
source in **77.6 s** (`layout/state.json`). The 195 M LAZ import (`import-195m.json`) took
**55.97 s**, with an octree of 1 234 976 658 bytes (ratio 0.89 of the LAZ).

## Environment

- Machine: 13th Gen Intel Core i7-13700K (16 cores, 24 threads), NVIDIA GeForce RTX 5070 Ti (driver
  32.0.15.9186), 63.8 GB RAM. Primary display 3440 × 1440 at 59/60 Hz; a second, virtual display
  (Meta Virtual Monitor) was attached.
- Browser: Microsoft Edge **154.0.4258.37**. WebGL renderer "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070
  Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)". Window 1440 × 900 at (0, 0); the page viewport
  is 1416 × 774.
- Build: dev (Vite, unminified), per ruling G1. The packaged re-run belongs to IMC-X.
- Load:
  - `\Processor(_Total)\% Processor Time` read 13–37 % just before each perf run.
  - Another session's backend `pytest -q` (PID 17572, started 13:25) was running throughout. Its
    process used about 1–2 cores.
  - Label Studio, the ML backend and a few static `http.server` processes were idle.
  - No other suite of this unit was running.
- Ports:
  - The launcher takes OS-assigned free ports for the backend (`APP_PORT=0`), Vite and CDP
    (Task 9's `Get-FreePort`), so it cannot collide with another unit.
  - Step 6's own API backend ran on 127.0.0.1:**5608** (the controller's 5600-5609 range), not the
    brief's 8799.

## Criterion 1 Layout

`layout/layout-side-by-side.jpg`: the app on the left, the mockup `ws-clouds.html` on the right, at
the same 1416 × 774 viewport. The single shots are `layout/layout-app.png` and
`layout/layout-mockup.jpg`; the boxes are in `layout/layout-full.json`.

| Panel               | Mockup CSS                                                          | Measured box (x, y, w, h)                                                           | Match                                                                            |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Viewport (3D area)  | `.vp`: fills `.main` beside the 64 px rail                          | 64, 56, 1352, 718                                                                   | yes: x = rail 64, fills to the right and bottom edges                            |
| Tool palette        | `.tools { left: 14px; top: 14px }`, 38 px tools                     | 78, 70, 50, 499                                                                     | yes: 64 + 14, 56 + 14                                                            |
| Cloud / layer panel | `.layer { left: 72px; top: 14px; width: 282px }`                    | not measured by the driver; on the screenshot it sits beside the palette at the top | position yes; content: see the defect below                                      |
| Inspector (tabs)    | `.insp { right: 14px; top: 14px; bottom: 204px; width: 330px }`     | tabs 1081, 79, 280, 41 (panel x = 1072)                                             | yes: 1072 + 330 = 1402 = 1416 − 14; the tabs sit inside the panel's 8 px padding |
| Site map            | `.mini { right: 14px; bottom: 14px; width: 330px; height: 178px }`  | 1072, 582, 330, 178                                                                 | yes: 1402 = 1416 − 14 and 760 = 774 − 14; 330 × 178 exactly                      |
| Readout             | `.readout { left: 50%; bottom: 14px; transform: translateX(-50%) }` | 494.0, 726, 491.9, 34                                                               | yes: centre x 740.0 = viewport centre 64 + 676; bottom 760 = 774 − 14            |
| View buttons + axes | `.views` 2 × 2 grid, bottom left                                    | bottom left, 2 × 2 (Top, Front, Side, Iso) with the axis gizmo                      | yes                                                                              |

Differences found by eye:

- **The cloud panel shows a horizontal scrollbar** under the camera-offset row ("− 0 m +") that the
  mockup does not have. It is visible in `layout/layout-app.png`, and in every later screenshot
  (`pins/*.png`, `clip/*.jpg`). The panel's content is wider than the panel. Reported to C-L1, whose
  `CamerasPanelRow` adds the offset row that probably overflows. Not diagnosed further here, since
  app code is out of scope.
- The mockup's project tab row (Overview, Images, … under the top bar) is not above the point-cloud
  workspace in the app. The app's navigation rail replaces it, so the viewport starts at y = 56
  instead of below a tab row. This is the app shell (not unit C) and every panel is placed relative
  to the viewport, so it is recorded but not scored.
- The camera glyph count reads "395 photos · 395 with angles". The mockup's content (a different
  site) is sample text.

**Verdict: fail** (the cloud panel's horizontal scrollbar is content the mockup does not have;
reported to C-L1). Every panel's **position** matches the mockup to the pixel as listed above.

## Criterion 2 Pins

`pins` mode arrives at S1's rim (`?at=243513.718,3178242.151`) and pins 5 Crack findings, at the
canvas centre and at the offsets (±60, 10), (20, 60) and (−20, −60) px. It then steps through
Top/Front/Side/Iso, and moves pin 1 with Move pin. `pins-check` then starts a fresh backend, Vite
and Edge (the restart), arrives at each finding with `?finding=` and re-picks at the canvas centre.

Runs (all recorded):

1. `pins`, attempt 1 (the committed driver): `measure FAIL no clear canvas point near (-60, 10)`,
   exit 1. The 200 perf pins from Step 3 were still on the cloud.
2. `pins`, attempt 2, after every finding was deleted through the API (a throwaway script, 202
   findings): the same `FAIL … (-60, 10)`, exit 1. A diagnostic screenshot showed the cause:
   **after Enter creates a pin, the new finding stays selected and its callout stays open**, left
   of the centre. The driver's single Escape does not close it, and the callout covers the next
   offset. This is a driver defect (Task 9), not an app bug. The app keeps the new finding selected
   on purpose.
3. `pins`, attempt 3: a copy of the driver with one change (after Escape, if the callout is still
   visible, click its **Close** button, then wait 300 ms), passed with `-Driver`. The findings from
   attempt 2 were deleted first. Result: `measure pins ok`. The copy is not committed; the committed
   driver needs this fix (reported to the C-G controller, Task 9's driver).
4. `pins-check`, committed driver: `measure PROBLEM pins-check 533a056c…: anchor moved 2.226 m across
the restart`, then `measure pins-check FAIL`, exit 1. Pin 1 is the pin that `pins` mode itself
   moved with Move pin **after** it recorded the anchors. `pins-check` compares against that pre-move
   anchor. This is a second driver defect (reported with the first), not a restart loss.

The five anchors and the restart (`pins/pins-full.json`, `pins/pins-check-full.json`):

| Pin (id)     | Anchor before (E, N, Z)          | u (m) | Anchor after restart             | d restart (m)           | Re-pick d (m) | tol (m) | Row `pass` |
| ------------ | -------------------------------- | ----- | -------------------------------- | ----------------------- | ------------- | ------- | ---------- |
| 1 `533a056c` | 243513.803, 3178241.789, 189.554 | 0.171 | 243514.864, 3178241.331, 187.651 | 2.226 (Move pin, see 4) | 0.442         | 0.171   | false      |
| 2 `0f8075a9` | 243519.493, 3178256.158, 173.836 | 0.086 | unchanged                        | 0                       | 0             | 0.086   | true       |
| 3 `f074a8f8` | 243483.456, 3178430.736, −7.393  | 0.343 | unchanged                        | 0                       | 0.184         | 0.343   | true       |
| 4 `c841bad4` | 243515.279, 3178239.938, 186.218 | 0.171 | unchanged                        | 0                       | 0.655         | 0.171   | false      |
| 5 `09119ca2` | 243503.553, 3178472.323, 3.498   | 0.343 | unchanged                        | 0                       | 0.686         | 0.343   | false      |

(Pins 3 and 5 are the offsets that fell past the stack onto the ground about 190-230 m north. They
are still valid cloud findings.)

- **Persistence:**
  - The four pins that were not moved come back with bit-identical anchors (d restart = 0).
  - Pin 1 comes back at its moved position, which is the anchor the backend served after the restart.
- **Re-pick at the arrival (the driver's `pass`):** 2 of 5 rows pass.
  - Pins 4 and 5: the canvas-centre pick lands 0.655 and 0.686 m from the anchor, against u = 0.171
    and 0.343 m. After `?finding=` the camera centres on the anchor, but the centre pixel picks a
    nearer or neighbouring point at that level of detail.
  - Pin 1: see run 4 above.
- **Far-side dimming (`byView`):** the far-side pins are `back` (dimmed) in every view, as required:
  - Top: pin 1 `visible`; pins 2-5 `back`.
  - Front, Side, Iso: all 5 `back` (`occluded: true`).

  The rim pin (1) dims in Front, Side and Iso even though it is the stack's highest point, and
  `pins/pins-front.png` shows nothing between it and the camera. This looks like an occlusion
  **false positive** when the whole cloud is in view (a pin about 0.5 m/px across, u = 0.17 m).
  Reported to C-P1 (`PinsLayer` settle-time occlusion) with `pins/pins-front.png` and
  `pins/pins-iso.png`.

**Verdict: fail**:

- 3 of 5 `pins-check` rows are `pass: false`. One is the driver comparing a moved pin with its
  pre-move anchor (reported to the C-G controller). Two are re-picks 0.655 and 0.686 m from anchors
  with u = 0.171 and 0.343 m (reported to C-P1 / C-L1 for the `?finding=` arrival framing).
- The near-side rim pin is dimmed in 3 of 4 views (reported to C-P1).
- The stored anchors themselves survive the restart exactly.

## Criteria 3-4 Area and rings

`shapes.json` comes from a synthetic LAS: a 2 × 1.5 m patch tilted 60°, and a 20 m cylinder leaning
1.000° towards grid east. The picks have seeded noise σ = 0.01 m (`default_rng(7)`, ruling G7).
`formulas-full.json` runs the same points through the client's `measureResults` in the browser,
through Vite.

| Check                   | Server                    | Client (browser) | Equal | Target              | Result                                         |
| ----------------------- | ------------------------- | ---------------- | ----- | ------------------- | ---------------------------------------------- |
| Area, surface           | 3.000 m²                  | 3.000 m²         | yes   | 3.000 ± 0.5 %       | pass                                           |
| Area, plan              | 1.500 m²                  | 1.500 m²         | yes   | 1.500 ± 0.5 %       | pass                                           |
| Rings, lean angle       | 0.99044°                  | 0.99044°         | yes   | 1.00 ± 0.01°        | pass (error 0.00956°)                          |
| Rings, lean azimuth     | **88.898°**               | 88.898°          | yes   | 90 ± 0.5°           | **fail (error 1.102°)**                        |
| Two-point, lean angle   | 0.98426° (error 0.01574°) | 0.98426°         | yes   | (ring error < this) | ring error 0.00956° < two-point 0.01574°: pass |
| Two-point, lean azimuth | 93.571°                   | 93.571°          | yes   | none                | recorded                                       |

Criterion 3: `checks.surface_3_000_within_0_5pct` and `plan_1_500_within_0_5pct` are true, and
server = client. **Verdict: pass.**

Criterion 4: `rings_angle_1_00_within_0_01` is true; `rings_azimuth_90_within_0_5` is **false**.
Server = client in every row, and the ring error is below the two-point error.

The azimuth miss is statistical, not a formula bug. The same noise model, re-run over 2 000 seeds
with a plain algebraic circle fit, gives an azimuth standard deviation of **1.28°**. It meets
± 0.5° in 31 % of seeds and ± 0.01° on the angle in 34 %. With σ = 0.01 m on 8 picks per ring and
a 0.31 m lean offset over 18 m, the target is out of reach of any fit. Seed 7 happens to meet the
angle and miss the azimuth.

The chimney row ("both methods recorded") needs the operator's hand measurement (Step 8), which is
pending.

**Verdict: fail** (azimuth 88.898°, 1.102° from 90° against ± 0.5°). Reported to the C-G controller
as a conflict between ruling G7's noise (σ = 0.01 m) and the spec's ± 0.5° / ± 0.01° targets; not a
B1 bug, since server and client agree. The chimney part is **pending operator**.

## Criterion 5 Profile

`profile-chimney.json` is a 0.2 m section from 8 m east of the rim centre to the centre (ruling
G6). `crosscheck-chimney.json` is the same slab cut from the source LAS by an independent script.
`profile-195m.json` is the same line on the 195 M cloud.

| Measure                                                   | Value                                    | Target                   | Result                   |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------ | ------------------------ |
| Chimney profile job                                       | `succeeded`, **1.07 s**                  | ≤ 10 s                   | pass                     |
| 195 M LAZ profile job                                     | `succeeded`, **9.40 s**                  | ≤ 90 s                   | pass                     |
| Top band (top 10 m below the rim, 0.1 m bins, n ≥ 5), app | median **0.439 m**, max 1.072 m, 21 bins | = crosscheck ± 0.02 m    | **fail**                 |
| Top band, crosscheck from the source LAS                  | median **0.652 m**, max 1.072 m, 20 bins | (reference)              |                          |
| `profile_width_max_m` (whole height)                      | **3.208 m** (1 144 points)               | = hand thickness ± 2 cm  | G6 deviation (see below) |
| Hand-measured shell thickness (Step 8)                    | pending operator                         | within 2 cm of the above | pending operator         |

Why the medians differ:

- Every 0.1 m bin the two share has the **same** point count and width to 1e-9 m.
- The app's profile holds 15 points more than the crosscheck (1 144 against 1 129).
  - In the top band, that is one point in bin z = 180.85 (5 points in the app, 4 in the crosscheck).
    It moves that bin across the `n ≥ 5` threshold.
  - The other extra point is bin 184.75 (1 point, below the threshold).
- The band's widths are bimodal, so one bin more moves the median from 0.652 to 0.439 m.
- The difference is a slab-edge point, one the app's section keeps and the crosscheck's
  `|t| ≤ thickness/2` drops, or the reverse. Float32 against float64, or `<` against `≤` at the
  boundary, are the likely causes.
- The statistic is fragile: the top band holds 1-14 points per bin, so its "width" is the spread of a
  few sparse points, not a clean shell thickness.

G6: `profile_width_max_m` = 3.208 m is far above the top band (0.44-0.65 m). Over the whole height,
the slab also crosses the ground and the structures at the base. This is **recorded as a spec
deviation**: §16.5's "`profile_width_max_m` equals the shell thickness" does not hold for a line
from outside the stack into the flue. The criterion is judged on the top band.

**Verdict: fail** (top-band median app 0.439 m against crosscheck 0.652 m, Δ 0.213 m > 0.02 m, from a
single slab-edge point; reported to C-B2 for the boundary rule and to the C-G controller for the
median statistic). Timings pass. The hand comparison is **pending operator** (Step 8).

## Criterion 6 Clip box

| Run                                                   | Clicks | Saved | Outside | No box | Exit                                                                       |
| ----------------------------------------------------- | ------ | ----- | ------- | ------ | -------------------------------------------------------------------------- |
| Default spread 0.40 (`clip/clip-full-spread040.json`) | 14     | 5     | 0       | 0      | 1: `clip: 14 of 20 clicks made (no canvas point clear of pins and panels)` |
| `KESTREL_CLIP_SPREAD=0.25` (`clip/clip-full.json`)    | **20** | **7** | **0**   | **0**  | 0, `measure clip ok`                                                       |

- The box is the app's default box (`defaultClipBox`) recentred on the rim: centre (243513.803,
  3178241.789, 189.554), size **343.3 × 350.7 × 332.7 m**, yaw 0, `show_inside`. That is half the
  cloud's extent in X and Y.
- The 13 clicks that saved nothing hit sky or clipped-away areas.
- The saved picks sit 120.6-157.4 m inside the nearest box face in the 0.25 run. The closest was
  7.2 m, in the 0.40 run.
- So no pick landed outside the box, but a scripted test with a box this large does not exercise
  the box's edge. A tighter test needs a resized box (a drag the driver does not script).

**Verdict: pass** (20 clicks, 0 outside, 0 without a box, at spread 0.25). The spec's default grid
(0.40) could make only 14 clicks, exit 1, recorded above. The test is weak for the reason above.

## Criteria 7-8 Photo link

See `photo-link.md` for the full table and the operator's steps. I-FW has merged (ruling G10), so
every `photolink-<k>-image.jpg` shows the images workspace with **I-FW's arrival ring** and the
**Back to 3D** chip.

- Criterion 7: `photolink` ran on the brief's 10 rim spots, with `measure photolink ok`.
  - 8 of 10 picks list photos (6-11 each, all "In frame"). **Picks 4 and 6 list none.**
  - Every first photo's spot is clamped to the top edge (`py = 0`). The flight stays below the rim
    (camera z median 98.0 m, p99 160.7 m; rim ≈ 189.3 m), so the rim is above these photos' frames.
  - The eye checks (does the ring contain the feature; is any listed photo from the far side) are
    **pending operator**.
  - **Verdict: pending operator.** The automated part already shows 2 of 10 picks with no photo,
    which the criterion does not allow. Recorded, not marked passed.
- Criterion 8: the operator's hand-picked run is **pending operator** (steps in `photo-link.md`).
  - An **automated self-consistency** round trip ran instead: 5 wall points projected with the app's
    own pinhole model, then taken back through the image → cloud arrival.
  - Result: **3 of 5 within 1 m** (0.09, 0.21, 0.25 m), with misses of 18.3 and 2.6 m, probably from
    how the points were chosen.
  - This is **not** the operator's eye check.
  - **Verdict: pending operator.**

## Criterion 9 Performance

Dev mode, Edge 154.0.4258.37, RTX 5070 Ti, budget 3 000 000 points. The chimney's framed view draws
0.40 M points (`visiblePoints` 404 407). Per-pass times are **CPU-profile estimates, 100 µs sampling
(G5)**; the app's own timers are shown beside them. Runs, all recorded in `perf/`:

| Run (file)                        | Pins | Effects | Orbit input | Note                                                                  |
| --------------------------------- | ---- | ------- | ----------- | --------------------------------------------------------------------- |
| `perf-full-500.json`              | 500  | Full    | mouse       | the controller's 500-pin run; the first run after creating 500 pins   |
| `perf-full-200.json` (**Full**)   | 200  | Full    | mouse       | the table's Full column (it also deleted the 300 surplus driver pins) |
| `perf-reduced.json` (**Reduced**) | 200  | Reduced | mouse       | the table's Reduced column                                            |
| `perf-full-500-script.json`       | 500  | Full    | script      | a diagnostic: is the 500-pin run's 30 Hz from the input path?         |
| `perf-full-200-repeat.json`       | 200  | Full    | mouse       | repeat, right after 300 pins were deleted                             |
| `perf-full-200-third.json`        | 200  | Full    | mouse       | repeat, no pin changes                                                |

Every run exited 0 with `problems: []`.

| §13 metric (target)                                | Full (200)                                             | Reduced (200)             | Other runs                                                                                                              | Verdict                 |
| -------------------------------------------------- | ------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Orbit render p50 ≤ 20 ms                           | 16.7 (607 frames, mouse)                               | 16.7 (606)                | 500 mouse **33.4**; 500 script 16.7; repeat 16.7; third 16.7                                                            | pass at 200             |
| Orbit render p95 ≤ 33 ms                           | 16.9                                                   | 16.9                      | 500 mouse **41.9**; 500 script 25.5; repeat 17.2; third 16.9                                                            | pass at 200             |
| Orbit rAF p50 / p95                                | 16.7 / 16.8                                            | 16.7 / 16.8               | 500 mouse 33.3 / 33.4 (the whole page at 30 Hz); 500 script 16.7 / 16.8                                                 | recorded                |
| Pin pass ≤ 1 ms at 200                             | **0.112** ms/frame (305 frames); hook `passMs` p95 0.3 | 0.088; hook p95 0.3       | repeat 0.159, third 0.104                                                                                               | pass                    |
| Pin pass ≤ 2.5 ms at 500                           | n/a                                                    | n/a                       | 500 mouse **0.414** (hook p95 1.0); 500 script 0.505 (hook p95 0.6)                                                     | pass                    |
| Occlusion ≤ 40 ms once per settle                  | **45.4** ms (1 call); hook 10.9 ms over 200 pins       | **60.1** ms; hook 10.6 ms | repeat 84.7 (hook 15.6); third 59.9 (hook 11.0); 500: 88.6 / 47.6 (hook 17.0 / 12.9); 0 calls while moving in every run | **fail** (estimate)     |
| Hover pick ≤ 10 Hz                                 | 9.18 Hz (median of 3 × 5 s)                            | 9.40 Hz                   | 500 mouse 5.58 Hz; 500 script 9.36 Hz; repeat 8.96; third 9.37                                                          | pass                    |
| Hover pick ≤ 8 ms                                  | 1.18 ms/call (median)                                  | 1.24 ms (one window 7.62) | 1.05-1.91                                                                                                               | pass                    |
| Idle: 0 frames 1 s after settle                    | 0 rAF calls, 0 renders, no animation                   | 0, 0, none                | 0, 0, none in every run; the orbit's own rAF calls (609) prove the counter worked                                       | pass                    |
| First points ≤ 1 s (cold open, HTTP cache cleared) | 445 ms                                                 | 399 ms                    | 500 mouse **1 005**; 500 script 600; **repeat 4 660**; third 439                                                        | pass at 200 (see below) |
| Settled ≤ 5 s                                      | 812 ms                                                 | 781 ms                    | 500 mouse 2 006; 500 script 1 049; **repeat 5 127**; third 806                                                          | pass at 200 (see below) |
| Capture ≤ 3 s, trigger to upload (Step 4)          | **10 255-10 910 ms** (5 pins)                          | n/a                       | every view `render.complete: false` (`views.json`)                                                                      | **fail**                |
| Webview memory ≤ 2.5 GB at 3 M (+ 50 MB)           | 1.61 GB (14 processes)                                 | 1.48 GB                   | 500 mouse 2.14; 500 script 1.69; repeat 1.60; third 1.48                                                                | pass                    |
| Reduced meets p95 when Full fails                  | Full meets p95                                         | 16.9                      | both recorded                                                                                                           | n/a                     |

Findings:

- **Occlusion:** the profiled `runOcclusion@PinsLayer` estimate is 45-89 ms per settle, above 40 ms
  in all 6 runs. The engine's `runOcclusion@viewer/occlusion` is nearly all of it (for example 44.9
  of 45.4 ms). The hook's own timed occlusion over the same shown pins gives 10.6-17.0 ms.
  - Each run records only **one** settle, and precise coverage plus the 100 µs profiler add
    instrumentation cost.
  - Judged literally on G5's estimate, this is a miss. Reported to C-P1 (the pins-layer occlusion
    pass) and to the C-G controller: which number is authoritative for the ≤ 40 ms line has to be
    decided, since the two differ by 3-5×.
- **Capture:** each of the 5 pins took 10.3-10.9 s from Enter to the `PUT …/view3d` answer, and
  every stored view has `render.complete: false`. `captureRun.ts` waits for the capture camera's
  nodes up to `CAPTURE_TIMEOUT_MS` = 10 000 ms (`viewer/capture.ts`), and on the chimney it never
  becomes "not busy", so every capture runs to the timeout. Presumably
  `r.nodeLoadPromises.length > 0 || r.exceededMaxLoadsToGPU` stays true at the capture pose; this
  was not instrumented. Reported to C-V2 (capture) with `pins/pins-full.json` and
  `views.json`.
- **30 Hz at 500 pins with the mouse:** the first 500-pin run orbited at 30 Hz (the page's rAF at
  33.3 ms, render p95 41.9). The same 500 pins with the script orbit ran at 60 Hz (render p95 25.5),
  and all four 200-pin mouse runs ran at 60 Hz. This matches Task 9's intermittent half rate under
  CDP mouse input. It is recorded, not judged: the ≤ 33 ms p95 target applies to the 200-pin runs.
- **First points after pin churn:** the repeat run started right after the driver deleted 300
  findings. It opened in 4.66 s to first points and 5.13 s to settled (both over target). The third
  run, with no pin changes, came back to 439 / 806 ms. The 500 run, right after creating 500 pins,
  opened in 1 005 ms. So a cold open straight after bulk finding writes is slow on this backend.
  Recorded; the Full/Reduced columns (no churn) pass.

**Verdict: fail**. The occlusion estimate is 45.4 ms (Full) and 60.1 ms (Reduced) against 40 ms, and
the capture takes 10.3-10.9 s against 3 s. Reported to C-P1, C-V2 and the C-G controller. Everything
else passes in both Full and Reduced at 200 pins, and the pin pass is 0.41 ms at 500.

## Criterion 10 Report views

`views.json` is read through the Step 6 backend after Steps 4-5. It covers 17 views: 5 findings and
12 point measurements from the clip run.

| Check                                                | Result                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Every view 1600 × 1000                               | 17 of 17                                                                             |
| sha256 of `GET …/view3d` = `listCloudViews`'s sha256 | 17 of 17 (`ok == count`)                                                             |
| After Move pin: re-captured, not stale               | `pins-full.json` `moved.stale: false`; `views.json` `stale` 0                        |
| Capture within 3 s                                   | **no**: 10 255, 10 258, 10 310, 10 685, 10 910 ms (`pins-full.json` `captureMs`)     |
| `render.complete`                                    | false for all 17 (the capture timed out waiting for nodes, see Criterion 9)          |
| `render.edl`                                         | false for all 17 (a known potree-core 2.0.15 limit, C-V1 Ruling 3; see Task 8 above) |
| "A report built by R shows the 3D figure"            | deferred to R's own acceptance (R9-C), per ruling G8; R is not in this wave          |

**Verdict: fail** (capture 10.3-10.9 s > 3 s, and every view incomplete; reported to C-V2). Sizes,
sha256 and staleness pass. The R-report sentence is deferred (G8).

## Frame time on SwiftShader

`frame-time-swiftshader.json` holds Task 5's three runs of `clouds-frame-time.spec.ts` (200 pins,
1280 × 720, `--use-angle=swiftshader-webgl`, script orbit). These are reported, never asserted
(§15 item 13).

| Run                  | rAF p50 / p95 (ms) | Render p50 / p95 (ms) | Render samples |
| -------------------- | ------------------ | --------------------- | -------------- |
| 2026-09-28 09:41:55Z | 16.7 / 16.7        | 16.8 / 19.1           | 297            |
| 2026-09-28 09:42:12Z | 16.7 / 16.7        | 16.9 / 18.1           | 301            |
| 2026-09-28 09:42:28Z | 16.7 / 16.8        | 16.8 / 17.7           | 301            |

## Step 8 hand measurements (criteria 4 chimney row, 5): pending operator

Run from the worktree root. Edge opens the chimney workspace and waits until you close the tab:

```powershell
.\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode hold
Copy-Item D:\kestrel-acceptance\clouds\out\hold-full.json docs\evidence\clouds\hand-measurements.json
```

In the Edge window:

1. Measure the stack's lean with Verticality in Points mode.
2. Measure it again in Rings mode: 8 picks per ring, N, Enter, at the same two heights.
3. Measure the shell thickness at the rim with two Distance picks, one on the outer edge and one on
   the inner edge.
4. Close the tab.

Then record:

- the two lean results (criterion 4: "on the chimney, both methods are recorded", in `docs/progress.md`);
- the hand thickness against `profile-chimney.json` `top_band.median_m` = 0.439 m, and the
  crosscheck's 0.652 m (criterion 5: within 2 cm).

## Summary of §16 verdicts (Task 11)

| #   | Criterion     | Verdict                                                                                                                                                                                                          |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Layout        | fail (horizontal scrollbar in the cloud panel, reported to C-L1); every panel position matches                                                                                                                   |
| 2   | Pins          | fail (3 of 5 re-picks miss u: one is a driver artefact, two are 0.655/0.686 m against u 0.171/0.343 m; the near-side rim pin dims; reported to C-P1 and the C-G controller); anchors survive the restart exactly |
| 3   | Area          | pass                                                                                                                                                                                                             |
| 4   | Rings         | fail (azimuth 88.898°, 1.102° against ± 0.5°; G7's noise makes the target unreachable, reported to the C-G controller); chimney row pending operator                                                             |
| 5   | Profile       | fail (top-band median 0.439 against 0.652 m, Δ 0.213 m; reported to C-B2 and the C-G controller); timings pass (1.07 s, 9.40 s); hand comparison pending operator                                                |
| 6   | Clip box      | pass (20 clicks, 0 outside, 0 no box, at spread 0.25; weak test, since the box is 343 × 351 × 333 m)                                                                                                             |
| 7   | Photo link    | pending operator (automated: 2 of 10 picks list no photo)                                                                                                                                                        |
| 8   | Image → cloud | pending operator (automated self-consistency: 3 of 5 within 1 m)                                                                                                                                                 |
| 9   | Performance   | fail (occlusion estimate 45.4 / 60.1 ms > 40, hook timer 10.6-10.9 ms; capture 10.3-10.9 s > 3 s; reported to C-P1, C-V2 and the C-G controller)                                                                 |
| 10  | Report views  | fail (capture > 3 s, every view incomplete; reported to C-V2); sizes, sha256 and staleness pass; R-report part deferred (G8)                                                                                     |

## Files

| File                                                                                                    | What it proves                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `README.md`                                                                                             | this record                                                                                 |
| `photo-link.md`                                                                                         | criteria 7-8: the operator's table (pending), the automated rows and the steps              |
| `frame-time-swiftshader.json`                                                                           | Task 5: SwiftShader frame times, reported only                                              |
| `layout/layout-side-by-side.jpg`                                                                        | criterion 1: the app beside the mockup at 1416 × 774                                        |
| `layout/layout-app.png`, `layout/layout-mockup.jpg`                                                     | criterion 1: the two single shots                                                           |
| `layout/layout-full.json`                                                                               | criterion 1: the measured panel boxes, viewport, GPU and user agent                         |
| `layout/state.json`                                                                                     | the setup: project, cloud and source ids, and the import wall times (9.35 s; photos 77.6 s) |
| `perf/perf-full-200.json`, `perf/perf-full-200.png`                                                     | criterion 9: the Full column (200 pins)                                                     |
| `perf/perf-reduced.json`, `perf/perf-reduced.png`                                                       | criterion 9: the Reduced column (200 pins)                                                  |
| `perf/perf-full-500.json`, `perf/perf-full-500.png`                                                     | §13 pin pass at 500 (0.414 ms); the 30 Hz mouse orbit                                       |
| `perf/perf-full-500-script.json`, `perf/perf-full-500-script.png`                                       | the 500-pin diagnostic with the script orbit (60 Hz)                                        |
| `perf/perf-full-200-repeat.json`, `perf/perf-full-200-repeat.png`                                       | a slow cold open straight after bulk finding deletes (4.66 s)                               |
| `perf/perf-full-200-third.json`, `perf/perf-full-200-third.png`                                         | a repeat with no pin changes (back to 439 ms)                                               |
| `pins/pins-full.json`                                                                                   | criteria 2 and 10: 5 anchors, capture times, `byView` states, Move pin not stale            |
| `pins/pins-{top,front,side,iso}.{png,jpg}`                                                              | criterion 2: the pins in each view (dimming)                                                |
| `pins/pins-check-full.json`, `pins/pins-after-restart.jpg`                                              | criterion 2: the restart comparison                                                         |
| `clip/clip-full.json`, `clip/clip.jpg`                                                                  | criterion 6: 20 clicks, 0 outside (spread 0.25)                                             |
| `clip/clip-full-spread040.json`, `clip/clip-spread040.jpg`                                              | criterion 6: the default-spread run, 14 clicks, exit 1                                      |
| `shapes.json`                                                                                           | criteria 3-4: the server's area and rings results on the synthetic shapes                   |
| `formulas-full.json`                                                                                    | criteria 3-4: the client's results, equal to the server's                                   |
| `profile-chimney.json`                                                                                  | criterion 5: the chimney profile (1.07 s), top band and `profile_width_max_m`               |
| `crosscheck-chimney.json`                                                                               | criterion 5: the independent top band from the source LAS                                   |
| `profile-195m.json`, `import-195m.json`                                                                 | criterion 5: the 195 M LAZ import (55.97 s) and profile (9.40 s)                            |
| `views.json`                                                                                            | criterion 10: 17 views, 1600 × 1000, sha256 ok, 0 stale, all incomplete                     |
| `cameras.json`                                                                                          | criteria 7-8: 395 cameras, all posed; z median 98.0 m                                       |
| `photolink/photolink-full.json`, `photolink/photolink-<k>.jpg`, `photolink/photolink-<k>-image.jpg`     | criterion 7: the 10 picks, their lists, and the opened photos with the arrival ring         |
| `photolink/image2cloud-full.json`, `photolink/image2cloud-<k>.jpg`, `photolink/image-px-automated.json` | criterion 8: the automated self-consistency round trip (not the eye check)                  |

Screenshots over 400 KB were converted to JPEG (quality 85, full resolution) so that the committed
evidence stays about 11 MB. The PNG originals are in `D:\kestrel-acceptance\clouds\out`.

Credential check (Step 9): the brief's `Select-String` over `docs/evidence/clouds/*` and `*/*`,
plus a search for the run's credential variable names. The result is recorded in the Task 11
report.
