# Point clouds (C): evidence

Unit C-G, run on `task/c-g` (cut from `main` at `81b0310`). Spec
`docs/superpowers/specs/2026-09-26-point-cloud-workspace-design.md` §13, §15, §16. Plan
`docs/superpowers/plans/2026-09-27-clouds-g.md`.

## e2e coverage (§15 items 1-13)

| Item | What                                                                                    | Owner                 | Spec file :: test                                                                                                                                                                                                                               | Status      |
| ---- | --------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1    | Layout: panels at mockup positions, canvas = viewport, callout never over the inspector | W1                    | `clouds-workspace.spec.ts :: "layout: every panel sits at its mockup position and the canvas fills the viewport (spec §15 e2e 1)"`                                                                                                              | present     |
| 2    | Tool keys arm tools, hint bar changes, Esc Esc → Orbit                                  | W1                    | `clouds-workspace.spec.ts :: "tool keys arm tools, the hint bar follows, Esc and Esc again return to Orbit (spec §15 e2e 2)"`                                                                                                                   | present     |
| 3    | Pin flow: createFinding anchor keys, view3d meta `anchor_normal`, reload                | P1                    | `clouds-pins.spec.ts :: "pin flow: M, pick, choose a type, Enter creates with F's cloud anchor, the pin stays after reload"`                                                                                                                    | present*    |
| 4    | Occlusion: a pin behind the wall is `back` after settle                                 | P1                    | `clouds-pins.spec.ts :: "occlusion: a pin behind the wall gets back after settle, a pin in front stays visible"`                                                                                                                                | present     |
| 5    | Area: 4 picks, Enter, POST has 4 points and `mode`, row shows the area                  | M1                    | `clouds-measure.spec.ts :: "area: four picks and Enter save the outline with its mode (spec §15 e2e 5)"`                                                                                                                                        | present     |
| 6    | Cross-section: preview, Save → 202, `pointclouds.changed` → "Full resolution"           | M1                    | `clouds-measure.spec.ts :: "cross-section: preview, Save answers 202, then Full resolution on pointclouds.changed (spec §15 e2e 6)"`                                                                                                            | present     |
| 7    | Colour modes disabled/enabled by attributes                                             | V1                    | `clouds.spec.ts :: "colour modes: Intensity and Class are off for a cloud without those attributes"` and `"colour modes: a cloud with intensity and classification draws in both"`                                                              | present**   |
| 8    | Cameras: glyphs, popover, Look through                                                  | L1                    | `clouds-cameras.spec.ts :: "cameras: the switch shows the glyphs, a glyph opens its popover, Look through frames the photo"`                                                                                                                    | present     |
| 9    | Photo link: I, pick, list, click → images URL                                           | L1                    | `clouds-cameras.spec.ts :: "photo link: I, a pick, the list, and a click opens the image at the spot"`                                                                                                                                          | present     |
| 10   | Arrival: `?from_image=&px=` (posed, position-only), `?finding=`                         | L1                    | `clouds-cameras.spec.ts :: "arrival from a posed photo pixel looks through the drone and marks the hit"`, `"arrival from a position-only photo falls back to where the drone was"`, `"arrival from a photo that is not near the cloud says so"` | MISSING***  |
| 11   | Idle: 0 rAF, no running animation 1 s after settle, 50 pins                             | P1                    | `clouds-pins.spec.ts :: "idle: 0 animation frames and no running animation 1 s after settle with 50 pins"`                                                                                                                                      | present     |
| 12a  | Report view PUT after a pin create, 1600×1000, `anchor_normal` in meta                  | G (controller update) | `clouds-journey.spec.ts` step 5                                                                                                                                                                                                                 | G: Task 4/5 |
| 12b  | Refresh view sends the on-screen camera pose                                            | G (controller update) | `clouds-journey.spec.ts` step 6b                                                                                                                                                                                                                | G: Task 4/5 |
| 12c  | Capture missing views: progress, Cancel                                                 | R1                    | `cloud-report-views.spec.ts :: "Capture missing views saves a 1600 x 1000 PNG with its pose for each of 3 subjects"`, `"Cancel stops Capture missing views after the capture in flight"`                                                        | present     |
| 12d  | PNG decode (not uniform), pose meta                                                     | R1                    | `cloud-report-views.spec.ts :: "Capture missing views saves a 1600 x 1000 PNG with its pose for each of 3 subjects"`                                                                                                                            | present     |
| 13   | Frame-time harness, 200 pins, reported not asserted                                     | G                     | `clouds-frame-time.spec.ts`                                                                                                                                                                                                                     | G: Task 4/5 |

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
in `clouds-cameras.spec.ts`. The `?finding=` arrival case has **no e2e coverage** for the point-cloud
workspace: `useFindingArrival.ts` is exercised only by the vitest unit test
`frontend/src/clouds/pins/useFindingArrival.test.tsx`. `frontend/e2e/images-workspace.spec.ts:142`
uses a `?finding=` URL but for the _images_ workspace, not clouds. Scored MISSING per the strict
rule (an item is present only if every observable it names is e2e-tested); a later G task should add
the clouds `?finding=` arrival case or this stays a real gap.

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

| Spec name                                                    | Name on `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getByRole("toolbar", { name: "Tools" })`                    | `getByRole("toolbar", { name: "Point cloud tools" })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `frontend/src/clouds/workspace/Palette.tsx:19` (`FloatingToolbar label="Point cloud tools"`)                                                       |
| Tool name `"Pin finding"`                                    | `"Pin a finding"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `frontend/src/clouds/workspace/tools.ts` (`entry("pin", "Pin a finding", ...)`) — also its hotkey binding label in `frontend/src/ui/keymap.ts:206` |
| `getByTestId("pick-readout")`                                | `getByTestId("cloud-readout")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `frontend/src/clouds/workspace/Readout.tsx:44`                                                                                                     |
| `getByTestId("cloud-hint-bar")`                              | `getByTestId("cloud-hintbar")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `frontend/src/clouds/workspace/HintBar.tsx:40`                                                                                                     |
| `getByRole("region", { name: "Site map" })`                  | `getByTestId("cloud-minimap")` (no `region` role; the inner `<svg>` only has `role="img" aria-label="Site map: click to centre the view there"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `frontend/src/clouds/workspace/SiteMinimap.tsx:113-136`                                                                                            |
| `getByRole("button", { name: new RegExp(`^${cloudName}`) })` | `getByRole("button", { name: new RegExp(`^Point cloud: ${cloudName}`) })` — the picker button's accessible name is `Point cloud: {name} · {date} · {count}. Choose another`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `frontend/src/clouds/workspace/CloudPanel.tsx` (`CloudPicker`, `aria-label={`Point cloud: ${title}. Choose another`}`)                             |
| `inspectorPanel: page.getByRole("tabpanel")`                 | `page.getByTestId("cloud-inspector")` — no `role="tabpanel"` exists anywhere in `frontend/src` (`git grep -n "tabpanel" -- frontend/src` is empty); `Tabs.tsx`'s tab buttons carry no `aria-controls`, and the active tab's body is a plain, unlabelled `<div>` inside the same `GlassPanel` as the tab bar. `cloud-inspector` is the closest real container (tab bar + body together); a caller after just the body scopes further into `findingsTab`/`measurementsTab`'s own named regions instead (`getByRole("list", { name: "Findings on this cloud" })`, `getByRole("list", { name: "Saved measurements" })`, or `getByTestId("cloud-findings-tab")`). Found in review round 1. | `frontend/src/clouds/workspace/Inspector.tsx:27` (`data-testid="cloud-inspector"`), `Inspector.tsx:46` (the unlabelled body `<div>`)               |
| `image-arrival-ring`                                          | `arrival-marker` — a hidden DOM probe standing in for the Konva ring; the test asserts its `data-at` attribute, not `toBeVisible`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `frontend/src/images/workspace` (I-FW's `ArrivalProbe`)                                                                                             |
| The brief's 1 x 1 grey PNG literal (Task 4 Step 3)            | Not a decodable PNG (`createImageBitmap` throws "could not be decoded"); replaced with a generated valid 1 x 1 grey PNG (Python zlib)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `frontend/e2e/clouds-journey.spec.ts`                                                                                                                |
| The brief's landing image (C-L1's `routeImageRow`, 2048 x 1536) | The journey routes its own image row at 4000 x 3000 (`nadirCamera()`'s size) — at 2048 x 1536 the pixel falls outside the image and I-FW's `withinImage` drops the arrival (and the Back to 3D chip with it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `frontend/e2e/clouds-journey.spec.ts`                                                                                                                |

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
