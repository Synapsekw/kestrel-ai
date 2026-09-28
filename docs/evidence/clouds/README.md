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

| Spec name                                                                                       | Name on `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getByRole("toolbar", { name: "Tools" })`                                                       | `getByRole("toolbar", { name: "Point cloud tools" })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `frontend/src/clouds/workspace/Palette.tsx:19` (`FloatingToolbar label="Point cloud tools"`)                                                       |
| Tool name `"Pin finding"`                                                                       | `"Pin a finding"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `frontend/src/clouds/workspace/tools.ts` (`entry("pin", "Pin a finding", ...)`) — also its hotkey binding label in `frontend/src/ui/keymap.ts:206` |
| `getByTestId("pick-readout")`                                                                   | `getByTestId("cloud-readout")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `frontend/src/clouds/workspace/Readout.tsx:44`                                                                                                     |
| `getByTestId("cloud-hint-bar")`                                                                 | `getByTestId("cloud-hintbar")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `frontend/src/clouds/workspace/HintBar.tsx:40`                                                                                                     |
| `getByRole("region", { name: "Site map" })`                                                     | `getByTestId("cloud-minimap")` (no `region` role; the inner `<svg>` only has `role="img" aria-label="Site map: click to centre the view there"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `frontend/src/clouds/workspace/SiteMinimap.tsx:113-136`                                                                                            |
| `getByRole("button", { name: new RegExp(`^${cloudName}`) })`                                    | `getByRole("button", { name: new RegExp(`^Point cloud: ${cloudName}`) })` — the picker button's accessible name is `Point cloud: {name} · {date} · {count}. Choose another`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `frontend/src/clouds/workspace/CloudPanel.tsx` (`CloudPicker`, `aria-label={`Point cloud: ${title}. Choose another`}`)                             |
| `inspectorPanel: page.getByRole("tabpanel")`                                                    | `page.getByTestId("cloud-inspector")` — no `role="tabpanel"` exists anywhere in `frontend/src` (`git grep -n "tabpanel" -- frontend/src` is empty); `Tabs.tsx`'s tab buttons carry no `aria-controls`, and the active tab's body is a plain, unlabelled `<div>` inside the same `GlassPanel` as the tab bar. `cloud-inspector` is the closest real container (tab bar + body together); a caller after just the body scopes further into `findingsTab`/`measurementsTab`'s own named regions instead (`getByRole("list", { name: "Findings on this cloud" })`, `getByRole("list", { name: "Saved measurements" })`, or `getByTestId("cloud-findings-tab")`). Found in review round 1. | `frontend/src/clouds/workspace/Inspector.tsx:27` (`data-testid="cloud-inspector"`), `Inspector.tsx:46` (the unlabelled body `<div>`)               |
| `image-arrival-ring`                                                                            | `arrival-marker` — a hidden DOM probe standing in for the Konva ring; the test asserts its `data-at` attribute, not `toBeVisible`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `frontend/src/images/workspace` (I-FW's `ArrivalProbe`)                                                                                            |
| The brief's 1 x 1 grey PNG literal (Task 4 Step 3)                                              | Not a decodable PNG (`createImageBitmap` throws "could not be decoded"); replaced with a generated valid 1 x 1 grey PNG (Python zlib)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `frontend/e2e/clouds-journey.spec.ts`                                                                                                              |
| The brief's landing image (C-L1's `routeImageRow`, 2048 x 1536)                                 | The journey routes its own image row at 4000 x 3000 (`nadirCamera()`'s size) — at 2048 x 1536 the pixel falls outside the image and I-FW's `withinImage` drops the arrival (and the Back to 3D chip with it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `frontend/e2e/clouds-journey.spec.ts`                                                                                                              |
| §7 / C6 occlusion: a pin is occluded by "a drawn point more than max(0.3 m, 3u) in front of it" | A decoded point occludes the pin only when it is nearer **along the line of sight** by more than `tol + 2 × its distance from that line` (`OCCLUSION_CONE_SLOPE = 2`, tol = max(0.3 m, 3u) unchanged). Trade-off: at whole-cloud zoom (about 1.5-2 m per pixel), a far-side pin **without a stored normal** on a thin structure (so the facing test cannot dim it) may stay visible, because the wall in front of it is beside the line of sight rather than on it. Task 17 (C-G, for C-P1), commit `53736c91`; the controller may want this in the spec.                                                                                                                             | `frontend/src/clouds/viewer/occlusion.ts` (`isOccluded`)                                                                                           |
| (none: shared design-system primitives)                                                         | C-G Task 18 changed two shared primitives to remove the cloud panel's horizontal scrollbar (criterion 1): `Input`'s `fieldClass` skips its default `w-full` when the caller's `className` sets a width (as `Select` already did), and `Slider`'s thumb is placed with `left: pct%` instead of a full-track wrapper moved by `translateX`. Every `Input` with a width class and every `Slider` in the app is affected: **IMC-X to eyeball Images and Maps** (their sliders and sized inputs). Commit `063ae702`.                                                                                                                                                                       | `frontend/src/ui/Input.tsx`, `frontend/src/ui/Slider.tsx`                                                                                          |
| Criterion 5 top band: bins with n ≥ 5 points (Task 11's scenario)                               | Bins with **≥ 3 points** count towards the median (`MIN_BIN_POINTS = 3`), and the crosscheck uses the app's inclusive slab rule (`EPS = 1e-6` m from `profile_cut.py`), float32 `s`/`z` and `s` clipped to `[0, length]` before binning. Task 18, commits `063ae702` and `6c4b66a0`.                                                                                                                                                                                                                                                                                                                                                                                                  | `backend/scripts/pointcloud_acceptance.py` (`_summary`, `run_crosscheck`)                                                                          |

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

# Task 11 and 11b: acceptance (§16 items 1-10) and performance (§13), 2026-09-28

Everything below ran in **dev mode, in Edge 154.0.4258.37 on an RTX 5070 Ti** (ruling G1): the venv
backend, Vite, and Microsoft Edge over CDP. The launcher is
`frontend/scripts/run-dev-cloud-acceptance.ps1`, the driver `frontend/scripts/measure-cloud-workspace.mjs`,
and the API scenarios `backend/scripts/pointcloud_acceptance.py`. Work dir:
`D:\kestrel-acceptance\clouds` (not committed). Per-pass times (pin pass, occlusion, hover pick) are
**CPU-profile estimates at 100 µs sampling (G5)**, with precise-coverage call counting on. They are
cross-checked against the app's own timers: the pins layer's `passMs`, and the diagnostics hook's
timed `occlusion()` over the same shown pins. No credential value is in any file here (the grep is
at the end).

**Task 11b** (the same day, same machine and data) re-ran every step that four fixes made after Task
11 could change, and replaced those results in this folder:

| Fix                                                                                                                                                                                                       | Commit                 | Re-run                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- |
| Task 16 (C-V2): the report-view capture no longer spins to the 10 s timeout (potree's 2.0 `load()` returns `undefined`; `waitForNodes` now yields to the event loop)                                      | `7ddd9036`             | criteria 2, 9 (capture), 10         |
| Task 17 (C-P1): occlusion counts only points on the pin's line of sight; the pick no longer runs potree's `findHit`                                                                                       | `53736c91`             | criteria 2 (dimming), 9 (occlusion) |
| Task 18 (C-L1 and the driver): the cloud panel's scrollbar (`ui/Input`, `ui/Slider`); `pins` closes the callout; `pins-check` compares with the post-Move anchor; the crosscheck uses the app's slab rule | `063ae702`, `6c4b66a0` | criteria 1, 2, 5                    |
| Photo-link spots moved to the stack wall 15-30 m below the rim (the flight stays below the rim)                                                                                                           | (evidence only)        | criterion 7                         |

Not re-run (no fix touches them): criteria 3-4 (`shapes.json`, `formulas-full.json`), criterion 8's
automated round trip (`photolink/image2cloud-*`), the 195 M import (`import-195m.json`), and the
extra Task 11 perf runs (`perf/perf-full-500-script.*`, `perf-full-200-repeat.*`,
`perf-full-200-third.*`, which stay as "before the fixes" history). Task 11's own files for the
re-run steps are in git at commit `563fb623`; their numbers are kept below as "before the fixes".

Before the re-run, every finding on the chimney cloud (5) and every point measurement (12) was
deleted through the API, so every report view listed in `views.json` was captured by the fixed app
(re-created, not refreshed). The profile measurement was kept.

Verdict words: `pass`, `fail (<why>, reported to <unit>)`, `not run (<why>)`, `pending operator`.
Targets are applied literally.

## Data

| What             | Where                                                                                                                                          | Size / count                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Chimney LAS      | `D:\kestrel-acceptance\clouds-data\chimney.las` (S1's `Chimney stack 3D_group1_densified_point_cloud.las`)                                     | 21 697 184 points, 737 705 337 bytes, LAS 1.2 format 3, EPSG:32639                                                                     |
| 195 M LAZ        | `D:\kestrel-acceptance\clouds-data\big9.laz` (S1's `big9.las` tiled by `make_tiled_cloud.py`, compressed with laspy/lazrs in 2 M-point chunks) | 195 274 656 points, 1 386 992 714 bytes                                                                                                |
| Posed DJI flight | `\\DanNas\Work Data\Inspections\Kuwait\Chemney Stack POC\I2 3D Modeling\RAW Data`, read in place                                               | 420 `DJI_*.JPG`, DJI FC6540, 5248 × 3936, gimbal yaw/pitch/roll in XMP; 395 are near the cloud, and all 395 are posed (`cameras.json`) |
| S1 rim centre    | `docs/evidence/2026-09-24-point-clouds/rim.txt`                                                                                                | 243513.718, 3178242.151; top points z 189.264–189.554, so the brief's z = 189.3 is kept                                                |
| Staging record   | `D:\kestrel-acceptance\clouds-data\staging.json` (Step 1, done before Task 11)                                                                 | all byte and point counts verified                                                                                                     |

The setup (Task 11's first launcher run, `layout`) imported the cloud in **9.35 s** and the 420-photo
source in **77.6 s** (`layout/state.json`). The 195 M LAZ import (`import-195m.json`) took
**55.97 s**, with an octree of 1 234 976 658 bytes (ratio 0.89 of the LAZ).

## Environment

- Machine: 13th Gen Intel Core i7-13700K (16 cores, 24 threads), NVIDIA GeForce RTX 5070 Ti (driver
  32.0.15.9186), 63.8 GB RAM. Primary display 3440 × 1440 at 59/60 Hz; a second, virtual display
  (Meta Virtual Monitor) was attached.
- Browser: Microsoft Edge **154.0.4258.37**. WebGL renderer "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070
  Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)". Window 1440 × 900 at (0, 0); the page viewport
  is 1416 × 774. Node v24.11.0 runs the driver.
- Build: dev (Vite, unminified), per ruling G1. The packaged re-run belongs to IMC-X.
- Load:
  - Task 11: `\Processor(_Total)\% Processor Time` read 13–37 % before each perf run, with another
    session's backend `pytest -q` running throughout (about 1–2 cores).
  - Task 11b: 22–30 % before each perf run (three 2 s samples each); no test suite was running.
    Label Studio, the ML backend and a few static `http.server` processes were idle in both.
- Ports:
  - Task 11: the committed launcher takes OS-assigned free ports for the backend (`APP_PORT=0`), Vite
    and CDP (Task 9's `Get-FreePort`). Step 6's API backend ran on 127.0.0.1:**5608**.
  - Task 11b: the controller's range 5600-5609 only. The launcher runs were made with a scratch copy
    of the committed launcher whose only change is fixed ports (Vite 5600, CDP 5601, backend 5602,
    `$PSScriptRoot` spelled out); the committed driver ran unchanged. The API steps and the clean-up
    ran against a backend on 5608.

## Criterion 1 Layout

`layout/layout-side-by-side.jpg`: the app on the left, the mockup `ws-clouds.html` on the right, at
the same 1416 × 774 viewport. The single shots are `layout/layout-app.png` and
`layout/layout-mockup.jpg`; the boxes are in `layout/layout-full.json` (Task 11b, identical to Task
11's to the pixel).

| Panel               | Mockup CSS                                                          | Measured box (x, y, w, h)                                      | Match                                                                            |
| ------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Viewport (3D area)  | `.vp`: fills `.main` beside the 64 px rail                          | 64, 56, 1352, 718                                              | yes: x = rail 64, fills to the right and bottom edges                            |
| Tool palette        | `.tools { left: 14px; top: 14px }`, 38 px tools                     | 78, 70, 50, 499                                                | yes: 64 + 14, 56 + 14                                                            |
| Cloud / layer panel | `.layer { left: 72px; top: 14px; width: 282px }`                    | 136, 70, 282, 364 (`layout/layout-panel-overflow.json`)        | yes: 64 + 72, 56 + 14, 282 wide; no horizontal scrollbar (below)                 |
| Inspector (tabs)    | `.insp { right: 14px; top: 14px; bottom: 204px; width: 330px }`     | tabs 1081, 79, 280, 41 (panel x = 1072)                        | yes: 1072 + 330 = 1402 = 1416 − 14; the tabs sit inside the panel's 8 px padding |
| Site map            | `.mini { right: 14px; bottom: 14px; width: 330px; height: 178px }`  | 1072, 582, 330, 178                                            | yes: 1402 = 1416 − 14 and 760 = 774 − 14; 330 × 178 exactly                      |
| Readout             | `.readout { left: 50%; bottom: 14px; transform: translateX(-50%) }` | 494.0, 726, 491.9, 34                                          | yes: centre x 740.0 = viewport centre 64 + 676; bottom 760 = 774 − 14            |
| View buttons + axes | `.views` 2 × 2 grid, bottom left                                    | bottom left, 2 × 2 (Top, Front, Side, Iso) with the axis gizmo | yes                                                                              |

The scrollbar check (Task 11b): with the workspace open and settled (a `-Mode hold` session), a CDP
evaluate read the cloud panel (`data-testid="cloud-panel"`, `overflow-x: auto`): **scrollWidth 280 =
clientWidth 280**, overflow 0 px, and **0** descendants whose right edge passes the panel's
(`layout/layout-panel-overflow.json`). No other element inside the panel scrolls. The screenshot
`layout/layout-app.png` shows the offset row ("raw_data − 0 m +") with no scrollbar under it.

Other differences found by eye, not scored:

- The mockup's project tab row (Overview, Images, … under the top bar) is not above the point-cloud
  workspace in the app. The app's navigation rail replaces it, so the viewport starts at y = 56
  instead of below a tab row. This is the app shell (not unit C), and every panel is placed relative
  to the viewport.
- The camera count reads "395 photos · 395 with angles". The mockup's content (a different site) is
  sample text.

Before the fixes (Task 11): **fail**, the cloud panel showed a horizontal scrollbar under the
camera-offset row. Task 18 found the cause in two shared primitives (`ui/Input`'s `w-full` beating the
row's `w-20`, and `ui/Slider`'s thumb wrapper overflowing the track; see "Deviations").

**Verdict: pass** (every panel at its mockup position; the cloud panel's scrollWidth equals its
clientWidth).

## Criterion 2 Pins

`pins` mode arrives at S1's rim (`?at=243513.718,3178242.151`) and pins 5 Crack findings, at the
canvas centre and at the offsets (±60, 10), (20, 60) and (−20, −60) px. It steps through
Top/Front/Side/Iso, then moves pin 1 with Move pin and records its new anchor. `pins-check` then
starts a fresh backend, Vite and Edge (the restart), arrives at each finding with `?finding=` and
re-picks at the canvas centre.

Runs (Task 11b, all recorded):

1. `pins`, attempt 1: the five pins were created, the four views and Move pin ran, and
   `pins-full.json` was written, but node then died with exit code −1073740791 (0xC0000409). The
   launcher printed no driver output.
2. After deleting the 10 findings the two attempts had made (attempt 1 and a first repeat with the
   same crash), attempt 3 printed `measure pins ok …\pins-full.json`, then
   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` and the
   same exit code. The JSON is complete (`problems: []`); the crash is in `process.exit` after it is
   written (a libuv assertion on Windows, Node v24.11.0, likely an open `fetch` socket from the
   post-Move `GET /findings/{id}`). **Driver defect** (the exit code only), reported to the C-G
   controller. The Task 18 fixes themselves worked: the callout was closed after each create (no
   `no clear canvas point` failure), and pin 1's recorded anchor is the post-Move one.
3. `pins-check`: `measure pins-check ok`, exit 0, `problems: []`.

The five anchors and the restart (`pins/pins-full.json`, `pins/pins-check-full.json`):

| Pin (id)     | Anchor (E, N, Z) as recorded                      | u (m) | d restart (m) | Re-pick d (m) | tol (m) | Row `pass` | Capture (ms) |
| ------------ | ------------------------------------------------- | ----- | ------------- | ------------- | ------- | ---------- | ------------ |
| 1 `ec30f255` | 243514.864, 3178241.331, 187.651 (after Move pin) | 0.171 | 0             | 0.442         | 0.171   | false      | 874          |
| 2 `a63381aa` | 243519.493, 3178256.158, 173.836                  | 0.086 | 0             | 0             | 0.086   | true       | 507          |
| 3 `2770059e` | 243483.456, 3178430.736, −7.393                   | 0.343 | 0             | 0.184         | 0.343   | true       | 611          |
| 4 `47a8a5ad` | 243515.279, 3178239.938, 186.218                  | 0.171 | 0             | 0.655         | 0.171   | false      | 221          |
| 5 `e6fca62a` | 243503.553, 3178472.323, 3.498                    | 0.343 | 0             | 0.686         | 0.343   | false      | 331          |

The anchors are the same points Task 11 pinned (the driver clicks the same pixels on the same view);
pin 1 was created at 243513.803, 3178241.789, 189.554 on the rim, then moved. Pins 3 and 5 are
offsets that fell past the stack onto the ground about 190-230 m north.

- **Persistence:** all five stored anchors come back bit-identical after the restart (d restart = 0,
  `kept: true`), pin 1 included now that `pins-check` compares with its post-Move anchor.
- **Re-pick at the arrival (the driver's `pass`):** 2 of 5 rows pass. Pins 1, 4 and 5: after
  `?finding=` the camera centres on the anchor, but the canvas-centre pick lands 0.442, 0.655 and
  0.686 m away against u = 0.171, 0.171 and 0.343 m (a nearer or neighbouring point at the level of
  detail the arrival shows). Pins 4 and 5 are unchanged from Task 11; pin 1's row is now a real
  re-pick miss instead of the driver artefact.
- **Dimming by view (`byView`; `occluded` is the settle pass, `back` without it is the facing test):**

  | Pin                    | Top             | Front           | Side            | Iso             |
  | ---------------------- | --------------- | --------------- | --------------- | --------------- |
  | 1 rim (moved, 187.7 m) | visible         | back (facing)   | back (facing)   | visible         |
  | 2 wall (173.8 m)       | back (occluded) | back (occluded) | back (occluded) | visible         |
  | 3 ground north         | back (occluded) | back (occluded) | back (occluded) | back (occluded) |
  | 4 rim (186.2 m)        | visible         | visible         | back (facing)   | back (facing)   |
  | 5 ground north         | back (occluded) | back (occluded) | back (occluded) | back (occluded) |

  The far-side pins (the ground behind the stack, 3 and 5) are dimmed by occlusion in every view.
  The near-side rim pins are **never** dimmed by occlusion any more; where they are `back`, it is the
  facing test (their stored normals point up or away, and Front/Side put the camera 165 m below the
  rim), which Task 17 showed is correct. Screenshots: `pins/pins-{top,front,side,iso}.*`.

Before the fixes (Task 11): `pins` needed a scratch driver copy (the open callout), `pins-check`
failed on pin 1's pre-Move anchor (2.226 m), the rim pin was `occluded` in Front, Side and Iso, and the
capture took 10 255-10 910 ms per pin.

**Verdict: fail** (3 of 5 re-picks at the `?finding=` arrival land beyond u: 0.442, 0.655 and 0.686 m
against 0.171, 0.171 and 0.343 m; reported to C-P1 and C-L1 in Task 11, unchanged). The stored
anchors survive the restart exactly, the far-side pins dim, and the occlusion false positive is gone.
The driver's exit code after a good `pins` run is a separate driver defect (reported to the C-G
controller).

## Criteria 3-4 Area and rings

Not re-run in Task 11b (no fix touches them). `shapes.json` comes from a synthetic LAS: a 2 × 1.5 m
patch tilted 60°, and a 20 m cylinder leaning 1.000° towards grid east. The picks have seeded noise
σ = 0.01 m (`default_rng(7)`, ruling G7). `formulas-full.json` runs the same points through the
client's `measureResults` in the browser, through Vite.

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
Server = client in every row, and the ring error is below the two-point error. The azimuth miss is
statistical, not a formula bug: the same noise model over 2 000 seeds, with a plain algebraic circle
fit, gives an azimuth standard deviation of **1.28°**; it meets ± 0.5° in 31 % of seeds (and
± 0.01° on the angle in 34 %). With σ = 0.01 m on 8 picks per ring and a 0.31 m lean offset over
18 m, the target is out of reach of any fit.

**Verdict (as ruled by the controller): fail by test design** for the azimuth (88.898°, 1.102° from
90° against ± 0.5°, under G7's noise); the angle passes, and the rings beat the two-point method. The
chimney row ("both methods recorded") is **pending operator** (Step 8).

## Criterion 5 Profile

`profile-chimney.json` is a 0.2 m section from 8 m east of the rim centre to the centre (ruling G6).
`crosscheck-chimney.json` is the same slab cut from the source LAS by an independent script, which
now keeps the app's inclusive slab edges (`EPS = 1e-6` m), bins float32 `s`/`z` with `s` clipped to
the line as the app stores them, and counts a 0.1 m bin towards the top band's median when it holds
**at least 3 points** (Task 18). `profile-195m.json` is the same line on the 195 M cloud.

| Measure                                                        | Task 11b                                 | Before the fixes (Task 11) | Target                   | Result                   |
| -------------------------------------------------------------- | ---------------------------------------- | -------------------------- | ------------------------ | ------------------------ |
| Chimney profile job                                            | `succeeded`, **2.56 s**                  | 1.07 s                     | ≤ 10 s                   | pass                     |
| 195 M LAZ profile job                                          | `succeeded`, **12.04 s**                 | 9.40 s                     | ≤ 90 s                   | pass                     |
| Top band (top 10 m below the rim, 0.1 m bins, ≥ 3 points), app | median **0.301 m**, max 1.072 m, 42 bins | 0.439 m (21 bins, n ≥ 5)   | = crosscheck ± 0.02 m    | **pass (Δ 0)**           |
| Top band, crosscheck from the source LAS                       | median **0.301 m**, max 1.072 m, 42 bins | 0.652 m (20 bins, n ≥ 5)   | (reference)              |                          |
| Slab points, app / crosscheck                                  | 1 144 / 1 144                            | 1 144 / 1 129              | equal                    | pass                     |
| `profile_width_max_m` (whole height)                           | **3.208 m**                              | 3.208 m                    | = hand thickness ± 2 cm  | G6 deviation (see below) |
| Hand-measured shell thickness (Step 8)                         | pending operator                         |                            | within 2 cm of the above | pending operator         |

All 73 top-band rows match between the app and the crosscheck: the same bins, the same point count in
every bin, and widths within 4.3 × 10⁻⁷ m (float32 rounding). The 195 M profile gives the same 1 144
points and top band (the tiles outside the original chimney are not on the line). The chimney job
took 2.56 s against Task 11's 1.07 s; both are well inside the target, and nothing in the fixes
touches the profile job.

G6: `profile_width_max_m` = 3.208 m is far above the top band (0.30 m). Over the whole height, the
slab also crosses the ground and the structures at the base. This is **recorded as a spec
deviation**: §16.5's "`profile_width_max_m` equals the shell thickness" does not hold for a line
from outside the stack into the flue. The criterion is judged on the top band.

**Verdict: pending operator** (the hand thickness, Step 8). Every automated part passes: app =
crosscheck exactly (0.301 m), 2.56 s ≤ 10 s, 12.04 s ≤ 90 s.

## Criterion 6 Clip box

| Run                                                   | Clicks | Saved | Outside | No box | Saved picks' distance inside the nearest face | Exit                                                                       |
| ----------------------------------------------------- | ------ | ----- | ------- | ------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| Default spread 0.40 (`clip/clip-full-spread040.json`) | 14     | 3     | 0       | 0      | 7.2, 136.2, 142.7 m                           | 1: `clip: 14 of 20 clicks made (no canvas point clear of pins and panels)` |
| `KESTREL_CLIP_SPREAD=0.25` (`clip/clip-full.json`)    | **20** | **6** | **0**   | **0**  | 126.5-157.4 m                                 | 0, `measure clip ok`                                                       |

Task 11 had the same shape: 14 clicks / 5 saved at 0.40 (exit 1) and 20 / 7 / 0 / 0 at 0.25.

- The box is the app's default box (`defaultClipBox`) recentred on the rim: centre (243513.803,
  3178241.789, 189.554), size **343.3 × 350.7 × 332.7 m**, yaw 0, `show_inside`. That is half the
  cloud's extent in X and Y.
- The clicks that saved nothing hit sky or clipped-away areas.
- So no pick landed outside the box, but a scripted test with a box this large does not exercise the
  box's edge. A tighter test needs a resized box (a drag the driver does not script).

**Verdict: pass** (20 clicks, 0 outside, 0 without a box, at spread 0.25). The spec's default grid
(0.40) still makes only 14 clicks, exit 1, recorded above. The test is weak for the reason above.

## Criteria 7-8 Photo link

See `photo-link.md` for the full table and the operator's steps. I-FW has merged (ruling G10), so
every `photolink-<k>-image.jpg` shows the images workspace with **I-FW's arrival ring** and the
**Back to 3D** chip.

- Criterion 7 (Task 11b): the flight stays below the rim (camera z median 98.0 m, p99 160.7 m; rim
  ≈ 189.3 m), so the 10 spots were moved to the stack's wall **15-30 m below the rim** and derived
  from the source LAS (the rule and the spots are in `photo-link.md`).
  - `photolink` ran with `measure photolink ok`. **All 10 picks list photos** (the panel's heading
    reads 19-113 photos; the list shows up to 50 rows).
  - 7 picks landed on the wall at z 157.2-171.4 m (17.9-32.1 m below the rim). Picks 6 and 8 landed on
    the upper stack (182.2 and 180.8 m), and pick 9 hit the ground 184 m north of the stack.
  - For 8 of 10 picks the first photo's spot is inside the frame (py 379-1495). Only picks 6 and 8
    (the upper-stack hits) are clamped to the top edge (py = 0), against every pick in Task 11.
  - The eye checks (does the ring contain the feature; is any listed photo from the far side) are
    **pending operator**.
  - Before the fixes (Task 11, spots on a 1.5 m circle at the rim): 8 of 10 picks listed photos,
    and every first-photo spot was clamped to the top edge.
  - **Verdict: pending operator.**
- Criterion 8: the operator's hand-picked run is **pending operator** (steps in `photo-link.md`).
  - Task 11's **automated self-consistency** round trip is kept (not re-run): 3 of 5 within 1 m
    (0.09, 0.21, 0.25 m), misses of 18.3 and 2.6 m. This is **not** the operator's eye check.
  - **Verdict: pending operator.**

## Criterion 9 Performance

Dev mode, Edge 154.0.4258.37, RTX 5070 Ti, budget 3 000 000 points. The chimney's framed view draws
0.40 M points (`visiblePoints` 404 407). Per-pass times are **CPU-profile estimates, 100 µs sampling
(G5)**; the app's own timers are shown beside them. The occlusion line is judged on the profiled
whole settle pass (`runOcclusion@PinsLayer` per settle, controller ruling), with the hook's timer as
a cross-check.

Task 11b runs, in order (every run exited 0 with `problems: []`, mouse orbit at 60 Hz in all three):

| Run (file)                        | Pins | Effects | Note                                                                     |
| --------------------------------- | ---- | ------- | ------------------------------------------------------------------------ |
| `perf-full-500.json`              | 500  | Full    | the 500-pin run; created the 500 driver pins on a cloud with no findings |
| `perf-full-200.json` (**Full**)   | 200  | Full    | the table's Full column (it deleted the 300 surplus driver pins first)   |
| `perf-reduced.json` (**Reduced**) | 200  | Reduced | the table's Reduced column                                               |

| §13 metric (target)                                | Full (200)                                       | Reduced (200)       | 500 pins                             | Before the fixes (Task 11: Full / Reduced / 500) | Verdict  |
| -------------------------------------------------- | ------------------------------------------------ | ------------------- | ------------------------------------ | ------------------------------------------------ | -------- |
| Orbit render p50 ≤ 20 ms                           | 16.7 (608 frames)                                | 16.7 (611)          | 16.7                                 | 16.7 / 16.7 / 33.4 (mouse at 30 Hz)              | pass     |
| Orbit render p95 ≤ 33 ms                           | 17.0                                             | 17.0                | 26.0                                 | 16.9 / 16.9 / 41.9                               | pass     |
| Orbit rAF p50 / p95                                | 16.7 / 16.8                                      | 16.7 / 16.8         | 16.7 / 16.8                          | 16.7 / 16.8; 500: 33.3 / 33.4                    | recorded |
| Pin pass ≤ 1 ms at 200                             | **0.102** ms/frame (305 frames); hook p95 0.3    | 0.100; hook p95 0.3 | n/a                                  | 0.112 / 0.088                                    | pass     |
| Pin pass ≤ 2.5 ms at 500                           | n/a                                              | n/a                 | **0.202** (292 frames); hook p95 0.8 | 0.414                                            | pass     |
| Occlusion ≤ 40 ms once per settle (profiled pass)  | **13.95** ms (1 call); hook 8.8 ms over 200 pins | **10.05**; hook 8.3 | **11.20**; hook 8.4 over 500         | **45.4 / 60.1 / 88.6** (hook 10.9 / 10.6 / 17.0) | pass     |
| Occlusion or hover while moving                    | 0 calls                                          | 0                   | 0                                    | 0                                                | pass     |
| Hover pick ≤ 10 Hz                                 | 8.80 Hz (median of 3 × 5 s)                      | 8.76                | 8.99                                 | 9.18 / 9.40 / 5.58                               | pass     |
| Hover pick ≤ 8 ms                                  | 2.08 ms/call (median)                            | 1.91                | 2.06                                 | 1.18 / 1.24 / 1.25                               | pass     |
| Idle: 0 frames 1 s after settle                    | 0 rAF calls, 0 renders, no animation             | same                | same                                 | same                                             | pass     |
| First points ≤ 1 s (cold open, HTTP cache cleared) | 556 ms                                           | 547                 | 515                                  | 445 / 399 / 1 005                                | pass     |
| Settled ≤ 5 s                                      | 940 ms                                           | 947                 | 1 030                                | 812 / 781 / 2 006                                | pass     |
| Capture ≤ 3 s, trigger to upload (criterion 2 run) | **221-874 ms** (5 pins)                          | n/a                 | n/a                                  | **10 255-10 910 ms**                             | pass     |
| Webview memory ≤ 2.5 GB at 3 M (+ 50 MB)           | 1.61 GB (11 processes)                           | 1.51                | 1.78                                 | 1.61 / 1.48 / 2.14                               | pass     |
| Reduced meets p95 when Full fails                  | Full meets p95                                   | 17.0                |                                      |                                                  | n/a      |

Notes:

- **Occlusion:** the profiled pass fell from 45-89 ms to 10-14 ms per settle, now close to the hook's
  8.3-8.8 ms: Task 17 stopped the pick running potree's `findHit` scan, which the profiler made cost
  19-21 ms per window. Each run still records one settle.
- **Hover:** the profiled cost per pick rose from about 1.2 ms to about 2.0 ms and the rate is
  8.8-9.0 Hz. Both are well inside the targets. Nothing in the fixes adds work to the hover pick (it
  now skips `findHit`), so this is recorded, not explained.
- **Pins shown:** 97 of 200 pins are `visible` after the settle (Task 17 measured 38 → 94 with its fix).
- Task 11's extra runs (`perf-full-500-script`, `perf-full-200-repeat`, `perf-full-200-third`) are
  kept as before-the-fixes history. The repeat's slow cold open straight after 300 finding deletes
  (4 660 ms to first points) was not re-run; the 11b Full run also deleted 300 findings first and
  opened in 556 ms.

**Verdict: pass.** Every §13 target is met in Full at 200 pins, the pin pass is 0.20 ms at 500, and
the capture is 221-874 ms. Before the fixes (Task 11): fail on occlusion (45.4 / 60.1 ms) and capture
(10.3-10.9 s).

## Criterion 10 Report views

`views.json` is read through the Step 6 backend after the pins and clip runs. It covers **14 views**:
the 5 findings of the criterion 2 run and 9 point measurements from the two clip runs (3 at spread
0.40, 6 at 0.25). Every one was captured by the fixed app (the older findings and point measurements
were deleted first, see the top of this section).

| Check                                                | Result                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Every view 1600 × 1000                               | 14 of 14                                                                             |
| sha256 of `GET …/view3d` = `listCloudViews`'s sha256 | 14 of 14 (`ok == count`)                                                             |
| After Move pin: re-captured, not stale               | `pins-full.json` `moved.stale: false`; `views.json` `stale` 0                        |
| Capture within 3 s                                   | **yes**: 874, 507, 611, 221, 331 ms (`pins-full.json` `captureMs`)                   |
| `render.complete`                                    | **true for all 14** (`incomplete` 0)                                                 |
| `render.edl`                                         | false for all 14 (a known potree-core 2.0.15 limit, C-V1 Ruling 3; see Task 8 above) |
| "A report built by R shows the 3D figure"            | deferred to R's own acceptance (R9-C), per ruling G8; R is not in this wave          |

Before the fixes (Task 11): 17/17 views were the right size with sha256 ok and 0 stale, but the
capture took 10 255-10 910 ms and every view had `render.complete: false`.

**Verdict: pass** (sizes, sha256, staleness, every view complete, capture 221-874 ms ≤ 3 s). The
R-report sentence is deferred (G8).

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
- the hand thickness against `profile-chimney.json` `top_band.median_m` = **0.301 m** (the
  crosscheck agrees exactly) for criterion 5 (within 2 cm).

## Summary of §16 verdicts (Task 11b)

| #   | Criterion     | Verdict                                                                                                                                                                                                  | Before the fixes (Task 11)                                  |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Layout        | pass (every panel at its mockup position; cloud panel scrollWidth 280 = clientWidth 280)                                                                                                                 | fail (horizontal scrollbar)                                 |
| 2   | Pins          | fail (3 of 5 `?finding=` re-picks beyond u: 0.442 / 0.655 / 0.686 m against 0.171 / 0.171 / 0.343 m; C-P1 and C-L1); anchors survive the restart exactly; far-side pins dim; no occlusion false positive | fail (also the driver artefacts and the rim false positive) |
| 3   | Area          | pass (not re-run)                                                                                                                                                                                        | pass                                                        |
| 4   | Rings         | fail by test design, as ruled (azimuth 1.102° against ± 0.5° under G7's noise); angle pass; rings beat two-point; chimney row pending operator                                                           | same                                                        |
| 5   | Profile       | pending operator (hand thickness); automated parts pass: app = crosscheck 0.301 m, 2.56 s, 12.04 s                                                                                                       | fail (0.439 against 0.652 m)                                |
| 6   | Clip box      | pass (20 clicks, 0 outside, 0 no box, at spread 0.25; the default 0.40 makes 14 clicks; weak test)                                                                                                       | pass (same shape)                                           |
| 7   | Photo link    | pending operator (automated: 10 of 10 wall picks list photos, 8 of 10 first-photo spots inside the frame)                                                                                                | pending operator (2 of 10 rim picks listed nothing)         |
| 8   | Image → cloud | pending operator (automated self-consistency, not re-run: 3 of 5 within 1 m)                                                                                                                             | same                                                        |
| 9   | Performance   | pass (occlusion 13.95 / 10.05 / 11.20 ms, capture 221-874 ms, every other target met)                                                                                                                    | fail (occlusion 45.4 / 60.1 ms, capture 10.3-10.9 s)        |
| 10  | Report views  | pass (14 of 14 views 1600 × 1000, sha256 ok, 0 stale, all complete, capture ≤ 874 ms); R-report part deferred (G8)                                                                                       | fail (capture > 3 s, every view incomplete)                 |

§13 rows that changed from Task 11: occlusion (fail → pass), capture (fail → pass), pin pass at 500
(0.414 → 0.202 ms), 500-pin orbit (30 Hz → 60 Hz, render p95 41.9 → 26.0 ms), hover cost (about 1.2 →
2.0 ms, still pass).

## Files

| File                                                                                                    | What it proves                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                             | this record                                                                                                         |
| `photo-link.md`                                                                                         | criteria 7-8: the operator's table (pending), the Task 11b wall spots, the automated rows and the steps             |
| `frame-time-swiftshader.json`                                                                           | Task 5: SwiftShader frame times, reported only                                                                      |
| `layout/layout-side-by-side.jpg`                                                                        | criterion 1 (11b): the app beside the mockup at 1416 × 774                                                          |
| `layout/layout-app.png`, `layout/layout-mockup.jpg`                                                     | criterion 1 (11b): the two single shots, no scrollbar in the cloud panel                                            |
| `layout/layout-full.json`                                                                               | criterion 1 (11b): the measured panel boxes, viewport, GPU and user agent                                           |
| `layout/layout-panel-overflow.json`                                                                     | criterion 1 (11b): the cloud panel's box, scrollWidth = clientWidth, 0 descendants past its edge                    |
| `layout/state.json`                                                                                     | the setup (Task 11): project, cloud and source ids, and the import wall times (9.35 s; photos 77.6 s)               |
| `perf/perf-full-200.json`, `perf/perf-full-200.png`                                                     | criterion 9 (11b): the Full column (200 pins)                                                                       |
| `perf/perf-reduced.json`, `perf/perf-reduced.png`                                                       | criterion 9 (11b): the Reduced column (200 pins)                                                                    |
| `perf/perf-full-500.json`, `perf/perf-full-500.jpg`                                                     | criterion 9 (11b): pin pass at 500 (0.202 ms), occlusion 11.2 ms at 500                                             |
| `perf/perf-full-500-script.json`, `perf/perf-full-500-script.png`                                       | before the fixes (Task 11): the 500-pin diagnostic with the script orbit (60 Hz)                                    |
| `perf/perf-full-200-repeat.json`, `perf/perf-full-200-repeat.png`                                       | before the fixes (Task 11): a slow cold open straight after bulk finding deletes (4.66 s)                           |
| `perf/perf-full-200-third.json`, `perf/perf-full-200-third.png`                                         | before the fixes (Task 11): a repeat with no pin changes (439 ms)                                                   |
| `pins/pins-full.json`                                                                                   | criteria 2 and 10 (11b): 5 anchors (pin 1 post-Move), capture times 221-874 ms, `byView` states, Move pin not stale |
| `pins/pins-{top,front,side,iso}.{png,jpg}`                                                              | criterion 2 (11b): the pins in each view (dimming)                                                                  |
| `pins/pins-check-full.json`, `pins/pins-after-restart.jpg`                                              | criterion 2 (11b): the restart comparison, every anchor kept                                                        |
| `clip/clip-full.json`, `clip/clip.jpg`                                                                  | criterion 6 (11b): 20 clicks, 0 outside (spread 0.25)                                                               |
| `clip/clip-full-spread040.json`, `clip/clip-spread040.jpg`                                              | criterion 6 (11b): the default-spread run, 14 clicks, exit 1                                                        |
| `shapes.json`                                                                                           | criteria 3-4 (Task 11): the server's area and rings results on the synthetic shapes                                 |
| `formulas-full.json`                                                                                    | criteria 3-4 (Task 11): the client's results, equal to the server's                                                 |
| `profile-chimney.json`                                                                                  | criterion 5 (11b): the chimney profile (2.56 s), top band 0.301 m and `profile_width_max_m`                         |
| `crosscheck-chimney.json`                                                                               | criterion 5 (11b): the independent top band from the source LAS, equal to the app's                                 |
| `profile-195m.json`, `import-195m.json`                                                                 | criterion 5: the 195 M LAZ profile (11b, 12.04 s) and import (Task 11, 55.97 s)                                     |
| `views.json`                                                                                            | criterion 10 (11b): 14 views, 1600 × 1000, sha256 ok, 0 stale, all complete                                         |
| `cameras.json`                                                                                          | criteria 7-8 (11b, unchanged from Task 11): 395 cameras, all posed; z median 98.0 m, p99 160.7 m                    |
| `photolink/photolink-full.json`, `photolink/photolink-<k>.jpg`, `photolink/photolink-<k>-image.jpg`     | criterion 7 (11b): the 10 wall picks, their lists, and the opened photos with the arrival ring                      |
| `photolink/image2cloud-full.json`, `photolink/image2cloud-<k>.jpg`, `photolink/image-px-automated.json` | criterion 8 (Task 11): the automated self-consistency round trip (not the eye check)                                |

Screenshots over 400 KB were converted to JPEG (quality 85, full resolution) so that the committed
evidence stays about 12 MB. The PNG originals are in `D:\kestrel-acceptance\clouds\out` (Task 11's in
`out-task11`).

Credential check (Task 11 Step 9, repeated in Task 11b): the brief's `Select-String` over
`docs/evidence/clouds/*` and `*/*` for `Bearer|APP_TOKEN|token`, plus a search for the run's
credential variable names and for any 32-character alphanumeric run (the launcher's token shape). The
result is recorded in the Task 11 and Task 11b reports.
