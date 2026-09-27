# Foundation unit X evidence

The cross-unit journey is `frontend/e2e/foundation-journey.spec.ts`: one project goes from New
project through Add data (photos), the project's type list, an accepted Crack detection that becomes
finding F-0001, its severity set in the Findings tab's inspector, the Findings row and the Overview
severity bar, a dataset built in Models, to the training form starting a run on that dataset. Its
routes are a small stateful backend, so every step reads what the step before it wrote.

## Reads per finding edit

Measured 2026-09-27 on `task/f-x` (parent `main` 7477e3c plus the F-X index tasks), in the journey's
step 5: the finding is open in the Findings tab's inspector (`/p/{projectId}/findings/{findingId}`),
the page is let settle, and the severity is changed from 2 Moderate to 3 Major with a click (one
`PATCH /projects/{projectId}/findings/{findingId}` with `{"severity": 3}`). Counted: every GET the
app sent to the API from that click until nothing was in flight and nothing started for 1.5 s.

**5 reads**, the same list in every run (3 isolated runs and the full suite):

| # | Request (ids replaced by names) | Who reads it |
| --- | --- | --- |
| 1 | `GET /projects/{projectId}/overview` | the project tab counts (`useProjectCounts`) |
| 2 | `GET /projects/{projectId}/activity?subject_id={findingId}&limit=20` | the inspector's History |
| 3 | `GET /projects/{projectId}/findings/{findingId}` | the inspector's detail (`useFinding`) |
| 4 | `GET /projects/{projectId}/findings/summary` | the Findings filter counts (`useFindingSummary`) |
| 5 | `GET /projects/{projectId}/findings?sort=-severity&limit=200` | the Findings list, re-read (`useFindingsList`) |

All five come from one `bumpFindings()` after the PATCH answers: each hook keyed on
`findingsRevision` re-reads once (the list after its 300 ms debounce). Every read is bounded (a
detail, a summary, a limit of 20 or 200).

**The mock has no events socket.** This counts the client's own re-reads after its write only. In
the app the backend also publishes `findings.changed` for the same write (`app/findings/events.py`,
after commit); that bumps `findingsRevision` again, so the same five reads can follow a second time,
up to 10 in all when the event lands after the first re-reads (S1's estimate was about 9). The
detail read (#3) repeats what the PATCH's answer already carried.

The spec guards the number with `expect(reads.length).toBeLessThanOrEqual(5)` and attaches the list
to the test result as `reads-per-finding-edit.txt`.

## Frame time (effects Full)

Spec §16 item 5 asks for a p95 frame time of at most **20 ms at Full** on the Overview, the Findings
table scrolling 5k rows and a map under a floating glass panel. (Auto's own switch threshold is
`FRAME_BUDGET_MS = 24` ms, `frontend/src/app/effects.ts`.) The spec is
`frontend/e2e/effects.spec.ts`; the raw numbers of the three evidence runs are in `frame-time.json`
next to this file.

Measured 2026-09-27 on `task/f-x` (HEAD d5ac68f plus the spec), with
`E2E_CAPTURE_EVIDENCE=1 E2E_FRAME_BUDGET=1`, ports 52020/52021,
`pnpm -C frontend exec playwright test e2e/effects.spec.ts`, three runs back to back. `kestrel.effects`
is `full` before load. Each surface: `requestAnimationFrame` for 2 s after 300 ms of warm-up, gaps over
500 ms dropped, p95 as in `effects.ts` (the sorted sample at `ceil(n × 0.95) − 1`).

| Surface | What moves | Run 1 p50 / p95 / max | Run 2 | Run 3 | Frames | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Overview | nothing (after its entrances; what the Auto probe sees) | 16.7 / 16.7 / 16.8 | 16.7 / 16.7 / 16.8 | 16.7 / 16.7 / 16.8 | 120-121 | pass (≤ 20) |
| Findings, 5000 rows | the table scrolled 24 px per frame, all 25 pages loaded (200 per page, by cursor) | 16.7 / 16.7 / 16.8 | 16.7 / 16.8 / 16.8 | 16.7 / 16.7 / 16.8 | 120-121 | pass (≤ 20) |
| Map + floating glass | the Overview's map hero (tiles, pins, 3 `glass-float` panels) with the page scrolled 24 px per frame | 16.7 / 16.7 / 16.8 | 16.7 / 16.8 / 16.8 | 16.7 / 16.8 / 16.8 | 121-122 | pass (≤ 20) |

Values in ms.

**What these numbers can and cannot say.** Headless Chromium paces `requestAnimationFrame` at 60 Hz,
so 16.7 ms is the frame interval: every surface delivered every frame for 2 s in every run, with not
one dropped (max 16.8). That meets the ≤ 20 ms budget, but it measures dropped frames, not how much of
the 16.7 ms each frame used; headroom below one frame is invisible to this probe.

**Environment.** Headless Chromium through Playwright (`HeadlessChrome/153.0.8010.12`, Windows 10.0
x64, viewport 1280×720 at DPR 1, `hardwareConcurrency` 24), no GL flags (playwright.config.ts). The
page's WebGL renderer string is `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)
(0x0000C0DE)), SwiftShader driver)`: WebGL runs on SwiftShader in headless. Whether the compositor
(which draws the `backdrop-filter` blur) ran on the GPU cannot be read headless (no `chrome://gpu`);
the machine has an NVIDIA GeForce RTX 5070 Ti and an i7-13700K. The app itself runs in WebView2 with
its own GPU process; these runs are not a measurement of that.

**Machine load.** Not idle: a game (`WowB.exe`, World of Warcraft classic beta) was running and used
about 3 cores, and an unrelated `python.exe` about 1 core; total CPU load was 41-46 % at the start of
each run, and 44 node/python processes existed (other units' tooling). No other Playwright suite ran
on 52020/52021.

**Auto.** With `kestrel.effects` unset, the Overview came up `data-effects="reduced"` in all three
runs, with no probe and no toast: the WebGL renderer names SwiftShader, and spec §4.3 Auto step 1
starts reduced on a software renderer (`resolveEffects`). The probe's own decision (keep Full, or
reduce with "Visual effects reduced for smoother performance") is therefore not reached in headless;
the test asserts whichever of the three outcomes applies and records it as an annotation.

**Reduced.** With `kestrel.effects` = `reduced`, a scan of every element's (and `::before`/`::after`'s)
computed `backdrop-filter` on the Overview (map hero shown), the Findings inspector and the Add data
dialog finds none. The same scan at Full finds the hero's `glass-float` panels and the dialog, so the
check can fail; it did when the reduced rule in `src/ui/ui.css` was temporarily changed to `blur(1px)`.

**The real GPU check.** These headless measurements are accepted as evidence with their limits
stated above: 60 Hz headless frame pacing, WebGL on SwiftShader, a loaded machine, and Auto starting
Reduced under a software renderer. The real GPU check is the operator walkthrough step 8
(`docs/superpowers/plans/2026-09-26-foundation-index.md`, "Operator walkthrough") on the installed
WebView2 build: "Settings → Appearance: switch effects to Reduced. The glass becomes solid and the app
stays smooth."

The p95 ≤ 20 ms assertion runs only with `E2E_FRAME_BUDGET=1`: the gate runs the whole suite
headless in parallel, where a frame budget would measure the machine's load. The gate still asserts
at least 60 frames in each 2 s window and that the page is at Full.

## Build and smoke

Measured 2026-09-27 on `task/f-x`. The passing build/smoke/cargo-test/installer run below was made
from commit built `eca3d28` (the packaging fix; parent `04fdc5e`, which is `main` 7477e3c plus the
F-X index tasks). The first build, at `04fdc5e` itself (before the fix), built clean but **failed
smoke** on the missing catalogue migrations — see "Smoke found a packaging bug" below; `eca3d28` is
that fix. Disk free at the time: worktree drive E: 2251.5 GB, `%TEMP%` drive C: 1208.48 GB (both well
over the ~20 GB needed).

**Build.** `backend\scripts\build.ps1 -Venv E:\Dev\Yolo\app\backend\.venv` (the worktree has no
`.venv` of its own). First attempt failed before PyInstaller ran: no PotreeConverter payload at
`backend\third_party\potreeconverter` (git-ignored, fetched once per checkout like the venv); copied
it from the main checkout's `backend/third_party/potreeconverter` (already fetched there) rather than
re-downloading, same pattern as the shared venv. Rebuilt clean: **182.5 s**, `dist/kestrel-backend`
3,623.7 MB in 14,522 files, sidecar copied to `frontend/src-tauri/binaries/` (3.6 GB there).

**Smoke found a packaging bug, fixed in the build script.** `backend\scripts\smoke_frozen.ps1`
(defaults) failed at `POST /catalogue/types excavator`: 503 `catalogue_unavailable`. Reproduced
directly against the frozen exe; the traceback was `alembic.util.exc.CommandError: Path doesn't
exist: ...\dist\kestrel-backend\_internal\app\catalogue\migrations`.
`backend/kestrel_backend.spec`'s `datas` bundles `app/db/migrations` and `app/library/migrations`
(each opened the same way, via `command.upgrade(cfg, "head")`) but never gained a matching line for
`app/catalogue/migrations` when the catalogue subsystem was added (spec 2026-09-26-foundation). Added
the missing line, matching the existing two exactly. This is a one-line build-script fix, not an
application bug: the catalogue code itself is untouched. Rebuilt (warm PyInstaller cache): **46.7 s**,
`dist/kestrel-backend` 3,623.7 MB in 14,528 files (+6 for the migrations folder). Committed as
`backend/kestrel_backend.spec` only.

Re-ran the smoke test clean; it passed in full, **37.1 s**:

```
geo ok 32633 15.000325 45.000216
design ok 10 185 surface 64x64
volumes ok pdf 2038 xlsx 523.6 delaunay 2
pointcloud ok 50000 32639 BROTLI laz 50000
startup ok port 55028 pid 64520
health ok
cuda True NVIDIA GeForce RTX 5070 Ti
starter ok 3
library ok C:\Users\D\AppData\Local\Temp\kestrel-smoke-29d64b78\appdata\library
import ok 3 images
cloud ok 50000 206
model ok yolo11n-coco 80 classes
alias ok
predict ok 0 boxes
dataset ok train 2 val 1
worker ok mAP50 0.0
font ok C:\Users\D\AppData\Local\Temp\kestrel-smoke-29d64b78\appdata\ultralytics\Arial.ttf
export ok C:\Users\D\AppData\Local\Temp\kestrel-smoke-29d64b78\appdata\library\models\smoke-d3fc7efa\exports\weights.onnx 10.1 MB
keyring skip (a key is already stored for anthropic; not touching it)
smoke ok
```

`keyring skip` is the documented no-op path (a key was already stored on this machine; the script
does not touch it). Verdict: **smoke ok**, exit 0.

**cargo test.** `cargo test --manifest-path frontend/src-tauri/Cargo.toml` (frozen sidecar now
present): `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` (plus two empty
`0 passed` suites — the binary and doctests), in 78.4 s total.

**Installer.** `pnpm -C frontend build:installer` — Tauri release build (1m 28s) then the Inno Setup
6 compiler packing `frontend/src-tauri/binaries/` (not the Tauri output) — **502.3 s** end to end.
Warned `no MicrosoftEdgeWebview2Setup.exe found` (expected: none was staged for this run; the
installer simply won't carry the WebView2 bootstrapper). Coordinator ruling (binding): no WebView2
bootstrapper was staged, and that is acceptable because the operator's machine already has WebView2
(today's installed app runs on it).

| Field | Value |
| --- | --- |
| Path | `frontend/src-tauri/target/release/bundle/inno/Kestrel AI_0.1.0_x64-setup.exe` |
| Size | 1,973,227,855 bytes (1,881.8 MB) |
| SHA-256 | `e721c0e5d3a2f3774505a43f688be0bb78b7a7c2d484db6fae555cea6a01592d` |
| Built | 2026-09-27 07:06:33 +03:00 |

`git status` showed only `backend/kestrel_backend.spec` as a tracked change throughout; `dist/`,
`frontend/src-tauri/target/` and `frontend/src-tauri/binaries/*` (except `.gitkeep`) are git-ignored.

Not installed: the coordinator asks the operator before installing.
