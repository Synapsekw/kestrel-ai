# Contour implementation evidence — 2026-09-21

These are screenshots of the real React application, captured through Chromium at 1440×960 and
1024×768. They are development-browser evidence, not an installed Tauri/WebView2 walkthrough.
The installed desktop build has not been rebuilt or replaced in this task.

## Fixture provenance

The existing Prism contract examples supply project names, filenames, counts, jobs, models and other
metadata. One operator-local aerial photograph supplies image pixels; two explicit box coordinates
align the example regions with that photograph. They are illustrative regions, not new detections.
The preparation helper mirrors the existing backend's 256px thumbnails and 1024px Home display bound,
JPEG 85 quality and Lanczos scaling. The editor uses the original 4000px image within its existing
4096px cap. No source photograph, credentials or generated fixture files
are committed. Screenshots are committed for visual review.

## Views

| Screenshot | What to inspect |
|---|---|
| [Projects](01-projects.png) | Dark shared theme, typography, project entry |
| [Home](02-home.png) | Real next-step hierarchy, bounded project imagery, actual progress |
| [Expanded navigation](03-expanded-navigation.png) | Full route labels and counts |
| [Images](04-images.png) | Filters, keyboard focus, thumbnail/caption separation |
| [Label](05-label.png) | Single inspector, large canvas, quiet toolbar |
| [Label at 1024×768](06-label-laptop.png) | 632×611 canvas with persistent class/review controls |
| [Train](07-train.png) | Dark form controls and warning contrast |
| [Review](08-review.png) | Review queue and row hierarchy |
| [Jobs](09-jobs.png) | Drawer, progress, log/cancel controls |
| [Project settings](10-settings.png) | Class colors and settings structure |
| [App settings](11-app-settings.png) | Shared form controls; provider state is mocked |
| [Shortcut help](12-shortcuts-laptop.png) | Entire panel visible at laptop width |
| [Locked-step help](13-locked-step.png) | Explanation escapes the scrolling rail |

## Browser verification

Final application source: `b8c658f` (with initial implementation `4783855`), built on local main
`43483af`. Validation:

| Gate | Result |
|---|---|
| Contract check | Pass; no contract/generated client diff |
| Backend Ruff | Pass |
| Backend pytest | 620 passed, 9 deselected in 196.10s |
| Frontend lint | Pass, including formatting and semantic-token check |
| Frontend unit tests | 122 files / 517 tests passed in 30.34s on the final source |
| Frontend build | Pass |
| Browser regression suite | 57 passed in 33.4s, one worker on 1421/4011 |
| Rust tests | Skipped: frozen `kestrel-backend-*.exe` absent from this fresh worktree |
| Captures | 13 views; no JavaScript page errors |

The first backend run passed 619 tests but missed an intermediate epoch in one timing-sensitive
trainer-progress assertion. The isolated trainer-launch module then passed 12/12, and a single full
rerun passed 620/620. No backend source was changed. Existing React Router/mock Konva warnings,
the existing Vite bundle-size warning, and Playwright's terminal color-environment warning remain.

`frontend/e2e/contour.spec.ts` checks compact/expanded navigation, current route, useful laptop canvas
area, persistent drawing class, class hotkeys, expanded class/region availability, bounded Home
metadata requests and preview failure. Review added regressions for clipped shortcut help and locked
navigation explanations; both failed on the initial implementation before the fixes.

The broader browser suite exercises import, image selection/filtering, annotation/save/undo/redo,
proposal decisions, confidence filtering, training, models, detection, export, jobs and settings.
Two preexisting stale assertions were corrected: rotated-box duplication includes angle 0, and the
dataset Export button now needs an exact label match because Export ONNX also exists. Production
annotation and export semantics were not changed for these tests.

The capture driver independently checks 140ms primary-action hover, readable amber foreground,
visible keyboard focus, 220ms Jobs drawer entry and reduced-motion overrides. Screenshots wait for
data, image decoding, fonts and finite transitions. No JavaScript page errors occurred.
See [capture-results.txt](capture-results.txt) for measured canvas geometry and interaction results.

## Reproduce

Use the worktree's existing Vite/Prism setup on 1421/4011. For the browser suite set E2E_WEB_PORT=1421
and E2E_MOCK_PORT=4011, then run `pnpm -C frontend exec playwright test --workers=1`.
To capture pictures, run the preparation helper with the backend's Python/Pillow environment:

```text
python docs/evidence/ui/2026-09-21-contour/prepare-fixtures.py <local-photo.jpg> <private-fixture-directory>
node docs/evidence/ui/2026-09-21-contour/capture.cjs <local-photo.jpg> <private-fixture-directory>
```

Start Vite with VITE_MOCK_URL=http://127.0.0.1:4011 and VITE_DEV_PORT=1421.
The supplied photograph must match the example's 4000×2667 geometry for the capture assertions.

## Decisions carried into the implementation

- The selected concept's sample statistics are not production data. Home uses the existing next-step
  calculation and a single limit 3 metadata request; no cursor traversal or invented flight aggregates.
- The hero uses one existing display URL bounded to 1024px; its two smaller previews use thumbnails.
  This raises one preview's pixel budget from 256px to 1024px to avoid visible upscaling blur.
- Existing annotation shortcuts retain their meanings: A/R act on visible proposals.
- Source/dev UI is the delivery scope. Installer rebuilding and installed-app validation remain a
  separate follow-up; launching the older installed executable will not display Contour yet.
- Worktree setup initially selected older origin/main. It was rebased onto the more recent local main
  before implementation so the shipped rotated-box work is retained.

## How to test this

1. Open the updated development app, open a project, and inspect Home's next action and imagery.
2. Expand/collapse the navigation. Focus a locked step in a project without its prerequisite and
   confirm its explanation is readable outside the rail.
3. Open Images, switch Grid/List, filter and select images, then open one in Label.
4. Change Drawing class, expand All classes, and review a suggestion. Check keyboard shortcuts,
   undo/redo, pan and fit. Shrink the window to 1024×768 and confirm the inspector remains usable.
5. Open Jobs and settings. Check keyboard focus and enable the system's reduced-motion preference.
