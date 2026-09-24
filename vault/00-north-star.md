---
type: north-star
status: active
last-updated: 2026-09-24
tags: [project/kestrel-ai, north-star]
---

# Kestrel AI — North star

This is the Obsidian homepage for the Kestrel AI vault. Read this first, on any machine.

## 1. Pitch

**Kestrel AI** is a Windows desktop app that takes a construction team from a folder of aerial
drone frames to a trained machinery detector and reviewed counts, without a terminal and without
reading documentation. It covers dataset preparation, bounding-box annotation, YOLO training with a
model registry, and inference with either local models or OpenAI/Anthropic vision models — replacing
Label Studio, ad-hoc scripts and the Ultralytics CLI (`PRODUCT.md`).

Stack (`README.md`):

| Part | What | Tooling |
|---|---|---|
| `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference | Python 3.11.15, uv, pytest, ruff, PyInstaller |
| `frontend/` | Tauri 2 shell with the React/TypeScript/Vite UI | pnpm, Vitest, Playwright, Rust stable MSVC |
| `contract/` | `openapi.yaml` (source of truth), generated TS client, Prism mock server | pnpm |

Master spec: [[2026-09-17-kestrel-ai-app-design]]. Product context: [[product]]. Architecture map:
[[architecture]].

## 2. Where we are

Renamed from "Machinery Detection" / `machinery-app` to **Kestrel AI** / `kestrel-ai` on
2026-09-20 (full name map: `docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` §2.1).
The evidence and checkpoints below predate the rename and keep the old names on purpose — that is
deliberate history, not an error.

All of the core-pipeline waves (S0–S6) are merged to `main`:

- Wave 0 (S0 contract and scaffolding) — merged, checkpoint 1 passed.
- Wave 1 (S1 dataset backend, S2 annotation UI, S3 training backend and registry) — merged,
  checkpoint 2 passed (backend and editor halves), GPU training verified on `main`.
- Wave 2 (S4 inference and providers, S5 training/inference UI) — merged after 2 fix rounds each,
  checkpoint 3 passed.
- Wave 3 (S6 packaging and acceptance) — merged after 2 fix rounds, checkpoint 4 passed.

Last verified checkpoint: 4, re-verified after usability wave 1 on main `88d9216` (installed app),
2026-09-19 (`docs/progress.md:59`).

On top of that, the Phase 2 usability wave and the site-office UI redesign are also merged to
`main`, and acceptance step 7 has since closed 8/8 on the installed app at `177f68b` (2026-09-20) —
see §3 for the breakdown and §5 for why that figure is not the last word.

## 3. Phases

| Phase | Status | Outcome |
|---|---|---|
| Wave 0 — S0 contract & scaffolding | merged | checkpoint 1 passed |
| Wave 1 — S1 dataset backend, S2 annotation UI, S3 training backend & registry | merged | checkpoint 2 passed (backend + editor); GPU training verified on `main` |
| Wave 2 — S4 inference & providers, S5 training/inference UI | merged (2 fix rounds each) | checkpoint 3 passed |
| Wave 3 — S6 packaging & acceptance | merged (2 fix rounds) | checkpoint 4 passed; acceptance run passed, step 7 skipped (no provider key at the time) |
| Phase 2: usability (goal 2) — friction-list fixes, starter weights, negative images, Datasets screen, results export | merged to `main` | acceptance closed 8/8 on the installed app (`177f68b`), step 7 with a stored provider key; friction list closed except G3 and G2/M3 (see §5) |
| Site office UI redesign (U2) | merged to `main` (`2bc15a4`) | every screen restyled on `frontend/src/ui/`; walk-through 12 steps / 66 checks against the real backend |
| Contour UI redesign | merged to `main` (`50c5e0d`); installed verification `5555557` | selected direction implemented; 517 frontend, 620 backend, 57 browser tests; rebuilt/installed 2026-09-21, fresh GPU smoke and 8 Rust tests, 13 installed checks and 6 native screenshots |
| Kestrel A identity | merged/pushed to `main` (`33f1c28`); rebuilt and installed | approved bird shared across sidebar/splash and 17 native assets; app/setup icon resources match at 16px/32px; 15 installed checks passed |
| Setup agent and YOLO catalog | merged/pushed to `main` (`89de91b`); rebuilt and installed (`f15f89b`) | conversational project setup through first labeling/review; 44 detection starters across eight families; 666 backend, 533 frontend and 59 browser tests; fresh GPU smoke, 8 Rust tests and 16 installed checks passed |
| Kestrel AI rename | naming and code renamed 2026-09-20 | acceptance **8/8** on the renamed installed build `8823d95` (2026-09-22, evidence `93892bd`); rename plan Task 11 Steps 5-6 closed |
| Rotated boxes (OBB) wave 1 — annotate, store, export | merged to `main` (`249262b`) | gate green on the merged result; 2 cross-cutting defects found by the whole-branch review and fixed before merge; wave 2 (OBB training) unplanned |
| Cleanup batch A | merged/pushed to `main` (`8823d95`); rebuilt, installed, acceptance at `93892bd` | Select width fix (cramped class fields), G3 report label tags, CI actions on Node 24 majors, portable GPU-test paths; G2/M3 ledger closed. See [[2026-09-22-1758-cleanup-a-and-acceptance]] |
| CI green (GitHub Actions `ci`) | merged/pushed to `main` (`afba411`) | red on all 14 push runs since publishing; four stacked causes fixed and the local gate now runs `ruff format --check` and e2e as CI does; 3/3 dispatch runs green on all four jobs including `sidecar-smoke`. See [[2026-09-21-gotcha-ci-ran-checks-the-local-gate-did-not]] |
| Project agent (in-project AI drawer with tool access) | merged to `main` (`b606360`); rebuilt and installed 2026-09-22 | plain-language operation of the app through ~35 tools over the existing API, approvals for spend/train/delete; 854 backend, 564 frontend, 62 browser and 8 Rust tests; frozen-sidecar route smoke and an installed-build CDP check. No live provider turn yet. See [[2026-09-22-1930-project-agent]] |
| GeoTIFF maps — import, view, detect, label, score, export | merged to `main` (`759015a`, + `8dbb55e` layout fix); rebuilt and installed 2026-09-23 | an orthomosaic of any size and projection: bounded 256 px tiles, whole-map detection (windowed, resumable, seam-merged) with counts per class, evaluation zones and labels, precision/recall/F1 and count error, and GeoJSON/GeoPackage/CSV export with coordinates. 973 backend, 634 frontend, 63 browser and 8 Rust tests on the merged tree; frozen smoke green including `geo ok`. **Unrun on a real orthomosaic; the GeoPackage has never been opened by GIS software.** See [[2026-09-23-1655-geotiff-maps]] |
| Survey timeline — counts over time across a site's maps | merged/pushed to `main` (`ddc95f6`) | a map carries the date it was flown (read from `TIFFTAG_DATETIME`, correctable); `GET /survey-timeline` gives each survey's counts and the change since the previous **comparable** one; a Surveys screen draws the chart and table. A survey counted with another model or confidence is marked and excluded from the deltas. 995 backend, 644 frontend, 65 browser tests. **Not in any installed build, and never run on two real orthomosaics.** Superseded the frame-projection design with measurements. See [[2026-09-23-1703-survey-timeline]] |
| Train/Detect split, model library and detection workspace | merged/pushed to `main` (`c9f88e2`, then `f7d7ab6`); **not installed** | app-wide model Library, `train`/`detect` project kinds with a server-side guard, old models adopted into the library; detection projects get Sources, Runs with class mapping, Review with verified counts, Site areas, Analytics (absorbing Surveys) and CSV/PDF export. 1269 backend, 796 frontend, 76 browser tests at landing. **Frozen sidecar with `reportlab` never built; adoption never run on a real project.** See [[2026-09-24-0622-train-detect-split-and-library]] |
| Public repo, Obsidian dev memory & the working agreement | complete 2026-09-21 | published to [`Synapsekw/kestrel-ai`](https://github.com/Synapsekw/kestrel-ai) (PUBLIC, MIT, 4 branches); vault + 24 ADRs; `AGENTS.md`/`CONTRIBUTING.md`; worktree scripts and `/wrapup` proven end to end (spec §7.5); fresh-clone test passed. Owed: Obsidian GUI check (§7.3) |

Plans (`docs/superpowers/plans/`): [[2026-09-17-s0-contract-and-scaffolding]],
[[2026-09-17-s1-dataset-backend]], [[2026-09-17-s2-annotation-ui]],
[[2026-09-17-s3-training-backend]], [[2026-09-18-s4-inference-providers]],
[[2026-09-18-s5-training-inference-ui]], [[2026-09-18-s6-packaging-acceptance]],
[[2026-09-19-u2-site-office-ui]], [[2026-09-20-kestrel-ai-rename]],
[[2026-09-20-rotated-boxes-wave-1]]. Full index: [[roadmap]].

## 4. Now

**Shipped last:** **Train/Detect split, an app-wide model library, and the detection workspace**. Plan 1 is `d01a7cb..c9f88e2` (71 commits) and Plan 2 is `c9f88e2..f7d7ab6` (61 commits), both built by parallel agents in `tds-*`/`dw-*` worktrees, merged serially into an integration branch, landed and pushed. All of those worktrees are removed.
- **Library:** every model now lives once in `%APPDATA%\kestrel-ai\library`, with its provenance.
- **Project kinds:** projects are `train` or `detect`, enforced per route.
- **Adoption:** existing projects became training projects, and their models are adopted into the library by a background job (nothing is deleted).
- **Detection projects:** Sources (photos and maps with a survey date), Runs (a library model plus a one-time class mapping), Review (counts increment in the same transaction), Site areas in WGS84, Analytics showing total (verified) and absorbing Surveys, and CSV/PDF export.
- **Photo batches** report detections, never objects.

Gate at landing: 1269 backend, 796 frontend, 76 browser. **Not installed yet,** and the frozen sidecar with the new `reportlab` has never been built. See [[2026-09-24-0622-train-detect-split-and-library]].

Previously shipped: **The survey timeline — counts over time across a site's maps** —
`d92441d..ddc95f6`. A map carries the date it was flown, `GET /survey-timeline` gives the change since
the previous comparable survey, and a Surveys screen (now the Surveys section of Analytics in
detection projects) draws it. See [[2026-09-23-1703-survey-timeline]].

Previously shipped: **GeoTIFF maps — judge a model on the artefact the customer delivers** —
`cf01fa8..449ecd3` (32 commits in a task worktree, merged `759015a`, worktree removed and branch
deleted, not pushed), plus `8dbb55e` after the operator found the map squished in the installed
build. Import an orthomosaic of any size and projection; every tile is one bounded windowed read,
so a 3 GB map costs what a small one costs. A run walks the map in overlapping windows through the
existing provider interface, resumes from per-window checkpoints, skips nodata, and merges boxes
across seams; counts land per class. Evaluation zones plus labels give precision, recall, F1 and
count error, with mistakes coloured on the map and a stepper that flies to each. Export writes
GeoJSON (WGS84), GeoPackage (map CRS) and CSV (both). Reviews caught five silent defects before
merge — the one worth remembering is that a machine at the edge of coverage was dropped entirely,
because the window that would have reported it whole had been skipped as nodata. The merge was not
a fast-forward: the project agent had landed, and both branches had claimed migration `0004`
([[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]). Gate green on the merged tree;
sidecar re-frozen and its smoke green including `geo ok`; installer rebuilt and handed over.
**Nothing has been run against a real orthomosaic, and no GIS tool has opened the GeoPackage.**
See [[2026-09-23-1655-geotiff-maps]].

Previously shipped: **Project agent — an in-project AI drawer that operates the app** —
`fcb9420..ef2ef21` (21 commits, worktree removed, branch deleted, not yet pushed). The turn loop
runs in the sidecar so keys stay in Credential Manager; ~35 tools call the existing API routes
in-process, so validation, background jobs and events are the UI's own. Image work is selected by
a server-resolved selector, so "the first 500 images" never sends 500 ids through the model. Cloud
labeling, training and deletes pause with an Approve/Deny card carrying the cost estimate. Four
real defects were caught by review before merge (a hard kill broke the conversation permanently; a
model-chosen `..` id reached `DELETE /projects/{id}`; an approval card could dead-end without a
key; a 120 s model timeout). Gate green, installer rebuilt and installed, drawer verified in the
installed build over CDP. **No live provider turn has run yet.** See [[2026-09-22-1930-project-agent]].

Previously shipped: **Cleanup batch A, rebuilt, installed and accepted 8/8** — `f59007b..93892bd`
(10 commits, two task worktrees, both removed). Fixed the cramped class-name fields (`Select`
dropped the caller's width because `cx()` does not resolve Tailwind conflicts), made HTML-report
labels readable filled tags (G3), moved every CI action to its Node 24 major, and made the GPU/live
tests read `KESTREL_MODELS_DIR`/`KESTREL_FRAMES_DIR`. Rebuilt from `8823d95` and installed with
verified hashes; the installed app now carries the `afba411` editor/train fixes too. Acceptance
**8/8** on the installed renamed build, step 7 on the stored Anthropic key. The run needed four
passes because the operator used the driver's window and step 3 wrote into their project (repaired
with consent); the driver now guards against that. See [[2026-09-22-1758-cleanup-a-and-acceptance]]
and [[2026-09-22-gotcha-acceptance-window-looks-like-the-operators-app]].

Previously shipped: **Windows icon reference refreshed locally**. The Start shortcut points to an
explicit verified bird ICO. See [[2026-09-22-0627-windows-icon-refresh]].

Previously shipped: **CI green**, merged/pushed at `afba411` (11 commits from `bcba190`). GitHub Actions had
failed every run since publishing. The causes were stacked: unformatted backend files; registry tests
reading `E:/Dev/Yolo/models`; a starter-weights script that died without an `E:` drive; and three
real input bugs that e2e only exposed on the slower runner. The bugs: two editor hotkey races that
dropped a key on a just-loaded image, and a train form that refilled a cleared model name. Each bug
has a regression test that fails without its fix. `finish-task.ps1` now runs `ruff format --check`
and e2e too. Three dispatch runs on `afba411` passed contract, backend, frontend and sidecar-smoke.
Those UI fixes are not in the installed app yet. See [[2026-09-21-2139-ci-green]] and
[[2026-09-21-gotcha-ci-ran-checks-the-local-gate-did-not]].

Previously installed: **Setup agent desktop rebuilt and installed**, evidence merged/pushed at `f15f89b`.
Application source `75aa11b` preserves the previously verified setup-agent/catalog trees. Fresh GPU
smoke, 8 Rust tests, native installer and 16 installed WebView2 checks passed. Both executable hashes
match the build; actual YOLO26 download, cache reuse and prediction worked. First Projects 3.052s,
final verification 1.966s, warm 2.443s. The updated app is open for the operator. Worktree/branch
removed and shared Python environment intact. See [[2026-09-21-2003-setup-agent-desktop]].

Feature source: [[2026-09-21-1920-setup-agent]], merged at `89de91b`; contract/Ruff, 666 backend,
frontend lint/533 unit/build and 59 browser checks passed. GPT/Claude planning guides project creation,
import, a bounded first labeling batch and review. Source evidence: `docs/evidence/setup-agent/README.md`.

Previously installed: **A / Kestrel bird implemented, rebuilt and installed**; merged/pushed at `33f1c28`.
The operator selected A from the prior exploration. One SVG master now supplies sidebar/splash branding
and all 17 native icon files, including app, installer, shortcut and uninstall display surfaces.
Installed app/sidecar hashes match the new build. Full required gates, fresh CUDA smoke, native icon
resource checks and 15 installed UI/lifecycle checks passed; first Projects 3.053s, warm 2.459s.
The desktop app is open for the operator. See [[2026-09-21-1905-kestrel-a-identity]].

Previously installed: **Contour desktop rebuild**, evidence `5555557`, application source `54b5e29`.
See [[2026-09-21-1826-contour-desktop-rebuild]] and [[2026-09-21-1753-contour-ui]]. The directions
explored before those builds were chosen: [[2026-09-21-1706-ui-design-directions]] (UI, which led to
Contour) and [[2026-09-21-1834-logo-directions]] (logo, which led to Kestrel A).

Previously shipped: **the task-worktree workflow, proven end to end** — `start-task.ps1` →
`finish-task.ps1` ran the full gate, merged, pushed `0ce41f5..7288966`, and tore the worktree down
by the junction-safe path with `backend/.venv` verified intact afterwards. Spec §7.5 met; the
repo-and-dev-memory plan is complete. Three earlier attempts each exposed a defect that static
review had passed (see §5). Details: [[2026-09-21-1216-round-trip-proven]].

Before that: **rotated bounding boxes, wave 1** — merged to `main` as `249262b`
(2026-09-20, 18 commits `bb99feb`..`03fce8f`, 40 files). An annotator can rotate a box on the
canvas; the angle is stored, survives a reload, and reaches CSV, COCO, HTML and YOLO exports.
Training on the angle is wave 2 and the dataset form says so. Also adds middle-button panning of the
canvas. Gate green **on the merged result**: contract check, ruff, 620 pytest, frontend lint, 497
vitest, frontend build; `cargo test` skipped (sidecar absent — see the ADR). Worktree removed,
branch deleted, `backend/.venv` verified intact. Details: [[2026-09-20-1814-rotated-boxes-wave-1]]. **Rebuilt, installed and walked through on
the operator's machine the same evening — all 11 steps pass, including the two the test suite
cannot reach (middle-button panning, resize-with-rotation).**
Before that: the repo was published to
[`github.com/Synapsekw/kestrel-ai`](https://github.com/Synapsekw/kestrel-ai) and the fresh-clone
verification (Task 12 Steps 1-3) passed.

**In flight:** nothing from this block. Other sessions hold `model-gsd`, `pointcloud-specs` and
`pointcloud-spike`; their state is not recorded here. A rebuild was started at the wrap-up and
stopped at the operator's request before it changed anything. The operator will rebuild and install
once the other session lands.

**Next:** rebuild and install. The installed build has neither the survey timeline nor the train/detect
work. Then run `docs/usability/2026-09-23-library-walkthrough.md` and
`docs/usability/2026-09-23-detection-workspace-walkthrough.md` on the installed app, with a **backup
copy** of a real training project (to watch adoption) and a real orthomosaic, and dispatch CI
`sidecar-smoke` (the packaging gained `reportlab`). Then the ONNX model-import spec, the
**de-machinery pass**, and patching `finish-task.ps1` per
[[2026-09-24-gotcha-finish-task-rebase-drops-merge-resolutions]]. Still open from before: the maps
walkthrough on a real orthomosaic, with the GeoPackage opened in QGIS; the point cloud viewer
(unstarted); rotated boxes wave 2 (unplanned); the prepared folder rename (§5).

## 5. Owed

### Train/Detect split and detection workspace: not installed, adoption unproven (opened 2026-09-24)

Merged and pushed at `f7d7ab6`. Owed:
- **Rebuild:** freeze the sidecar (first build with `reportlab`), run `smoke_frozen.ps1`, install, and dispatch CI `sidecar-smoke`.
- **Adoption on a real project:** open a backup copy of a real training project on the new build and check that its models appear in the Library and its past runs open. Tests used fixtures built at revision 0005.
- **The PDF report** has been checked only in pytest; open one from the installed app.
- **`GET /survey-timeline`** still answers in training projects, while the UI shows Surveys only in detection projects. It's a small inconsistency, left as is.
- **Not built:** ONNX import, video sources, and "Send to training project".

### Survey timeline: not installed, and unproven on real surveys (opened 2026-09-23)

Merged and pushed at `ddc95f6`; the installed build predates it. Owed:
- Rebuild and install once `pointcloud-spike` and `train-detect-spec` land (the operator's decision).
- Put two real orthomosaics of one site in a project, run the same model over both, and read the
  trend. Every test so far uses synthetic rows or the Prism mock.
- The comparison basis defaults to the newest run's model, so importing an older map after training a
  newer model marks it not comparable until it is re-run. Honest, but watch whether it surprises.

### The app still assumes construction machinery (opened 2026-09-23)

The operator's instruction: the app is for any detector — machinery today, plants or trees or
power-line anomalies next. These still name the domain and were agreed as a separate pass after the
survey timeline: the editor's "No machinery (N)" toolbar action and hotkey text
(`frontend/src/editor/EmptyToggle.tsx`, `RegionList.tsx`), the eight preset classes on the Projects
screen (`frontend/src/screens/ProjectsScreen.tsx`), the agent placeholders
(`frontend/src/agent/*`, `backend/app/project_agent/tools.py`) and `AddToDatasetDialog`'s wording.
`PRODUCT.md` also describes only the construction audience.

### GeoTIFF maps: a real orthomosaic, a GIS check, and a CI dispatch (opened 2026-09-23)

The feature is merged and installed, but every test used synthetic GeoTIFFs, a fake provider and
the Prism mock. Owed:
- The operator walkthrough on a real multi-GB ortho:
  `docs/usability/2026-09-22-maps-walkthrough.md`.
- **Open the exported `.gpkg` in QGIS.** No QGIS or `ogrinfo` exists on this machine, so the
  GeoPackage writer is verified only byte-by-byte against the OGC layout by
  `test_geopackage_structure_and_geometry`. This is the feature's biggest untested assumption.
- Dispatch CI `sidecar-smoke`: packaging changed (rasterio's GDAL and PROJ are now in the bundle).
- Parked minors, triaged can-wait, are listed in
  `.superpowers/sdd/2026-09-22-geotiff-maps/progress.md` — the one an operator would notice is a
  map with >20 000 labels showing a toast that fades rather than a persistent error.

### Project agent: a live turn, and a push (opened 2026-09-22)

The feature is merged and installed, but every test fakes the provider SDKs, so no real model has
ever driven the loop. Owed:
- One live turn on the installed build against a small batch (read-only question first, then
  "label the first 20 images…" through the approval card), watching what the model actually calls.
- ~~`git push`~~ — closed: `origin/main` is at `ddc95f6` and `main` is 0 ahead (checked
  2026-09-23), so the agent work, the maps merge and the survey timeline are all pushed. Pushed by
  another session, not this one.
- Deferred minors, triaged can-wait, are listed in
  `.superpowers/sdd/2026-09-22-project-agent/progress.md`.

### Setup agent/catalog desktop distribution — CLOSED; live provider check remains

Rebuilt from `75aa11b` and installed with matching hashes, fresh GPU/Rust/native checks and 16
installed UI checks. Both stored providers report ready; the real YOLO26 download and bundled
prediction worked. Evidence `f15f89b`: `docs/evidence/setup-agent-desktop/README.md`.
No paid planner/vision call was made. A live setup conversation and labeling of an operator-selected
batch remain outside this focused rebuild verification, as does the broader historical acceptance debt.

### CI follow-ups (opened 2026-09-21)

`ci` is green as of `afba411` (see [[2026-09-21-gotcha-ci-ran-checks-the-local-gate-did-not]]).
Still owed:
- `sidecar-smoke` runs only on `workflow_dispatch`. Dispatch it after packaging changes.
- ~~GPU tests hardcode `E:/Dev/Yolo/models`~~ — closed 2026-09-22 (`fde7f8f`): they read
  `KESTREL_MODELS_DIR` / `KESTREL_FRAMES_DIR`, same defaults.
- ~~CI actions on Node 20~~ — closed 2026-09-22 (`be87fda`, `a4eb3c9`): Node 24 majors; `setup-uv`
  is pinned to `v10.2.0` because it has no moving major tag. Dispatch on the branch green on all
  four jobs.

### ~~Contour installed-build verification~~ — CLOSED 2026-09-21

Rebuilt from `54b5e29`, installed with matching executable hashes, and checked through the actual
installed WebView2/bundled backend. Fresh GPU smoke, native build and lifecycle checks passed.
Six native screenshots supplement the original development captures. Evidence:
`docs/evidence/ui/2026-09-21-contour-installed/README.md` (`5555557`). The full cloud-provider
acceptance run remains separately owed below; this UI walkthrough does not close it.

### ~~Cramped class-name fields in project settings~~ — CLOSED 2026-09-22 (`add5c20`, `3015f99`)

Cause: `Select`'s wrapper carried both `w-full` and the caller's `w-[4.5rem]`; `cx()` only joins
classes and Tailwind emits `w-full` later. Installed in the `8823d95` build. Original finding:


Native visual inspection found class-name inputs squeezed to a narrow sliver beside wide hotkey
dropdowns. Also visible in the earlier development screenshot `2026-09-21-contour/10-settings.png`;
`ClassesSection.tsx` has not changed since the Site office restyle (`f48d3a1`). Investigate the Select
wrapper's default `w-full` versus supplied `w-[4.5rem]` and the adjacent flex input. No source fix was
included in the packaging-only rebuild. Native evidence: `2026-09-21-contour-installed/06-project-settings.png`.

### ~~Round trip incomplete~~ — CLOSED 2026-09-21, spec §7.5 MET

Task 12 is complete. The fourth attempt ran `start-task.ps1` → trivial commit → `finish-task.ps1`
end to end against a live `origin`: gate green (contract check, ruff, **620 pytest in 152.46s**,
frontend lint, **497 vitest across 119 files**, frontend build, `cargo test` **skipped with its
reason printed**), then `merge --ff-only`, then `push 0ce41f5..7288966 main -> main`, then the
junction-safe teardown, then `Deleted branch task/smoke-check`.

**The teardown was proven against the real failure mode.** `git worktree remove` printed
`error: failed to delete ...: Directory not empty` — the exact refusal the script is written
around — and the cleanup unlinked junctions as links rather than following them. Verified
afterwards: worktree gone from disk and deregistered, branch deleted, and **`backend/.venv` intact
(3.8 GB, torch 2.14.0+cu130, cuda True, ultralytics 8.4.154)**. That is the 2026-09-18 incident
replayed and survived — see [[2026-09-18-gotcha-shared-venv-deleted-with-a-worktree]].

Getting there took three failed attempts, each of which found something static review had passed:
`cargo test` cannot run in a worktree at all
([[2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar]]); the rebase base was wrong whenever the
remote was *behind* local `main`
([[2026-09-21-gotcha-rebase-base-must-be-the-most-advanced-main]]); and one run wedged for 16h57m
from an unconfirmed cause
([[2026-09-21-gotcha-concurrent-gate-runs-may-starve-the-job-runner]] — still `proposed`).
`start-task.ps1` and `finish-task.ps1` may now be treated as proven end to end. Details:
[[2026-09-21-1216-round-trip-proven]].

### ~~Unpushed commits on local `main`~~ — CLOSED 2026-09-21

`origin/main` and local `main` are in sync at `7288966`; `git log origin/main..main` is empty. The
push carried 28 commits: the OBB spec, plan and the whole of rotated boxes wave 1, this plan's gate
fixes, and the vault. A second machine cloning now gets everything, including the conditional-gate
fix.

One consequence of the long unpushed period is worth keeping: `git branch -d` measures "merged"
against the tracked upstream, not local `main`, so while `main` was unpushed it refused to delete
task branches that *were* fully contained in local `main`, and the wave-1 teardown needed `-D`.
With the remote in sync this should no longer occur.

### Rotated boxes wave 2 unplanned, and wave 1's deferred minors

Spec `docs/superpowers/specs/2026-09-20-rotated-boxes-design.md` §5 describes wave 2 — YOLO-OBB
label format, `yolo11{n,s,m}-obb` starter weights, training task guards, `result.obb` parsing — but
no plan exists. The packaging cost of the OBB checkpoints (§5.3) is still unmeasured; `list_starters`
tolerates a missing `.pt`, so fetch-on-demand is the fallback if the installer grows too much.

13 minors were deferred from wave 1 and triaged by the whole-branch review. Two are worth acting on:

- Nothing tests **resize+rotate in one gesture**. `BoxLayer.test.tsx` mocks react-konva wholesale,
  so `commit()` — the centre-pivot transform — has no unit coverage at all and cannot get any
  without a real stage. Verified by hand instead; it is step 6 of the wave-1 walkthrough.
- `_dashed_polygon` changed the dash phase on **unrotated** HTML thumbnails (each edge now starts
  its dash at its own leading corner). Visual only and pinned by no test — noted so nobody later
  "fixes" it back without knowing it was deliberate.

Also: spec §4.7 promised an angle in the HTML report's row detail and it was **not** built, correctly
— that report has no per-box rows. CSV is the only export where the number is readable. Recorded so
it is not later logged as a missing wave-1 item.

### ~~Obsidian GUI verification~~ — CLOSED 2026-09-21, spec §7.3 MET

The operator opened the vault in the Obsidian app and confirmed it works. That was the last
verification the repo-and-dev-memory plan was waiting on, so **every criterion in spec §7 is now
met**.

The vault currently appears as **"app"**, because Obsidian names a vault after its folder and this
one is `E:\Dev\Yolo\app` — the registry stores only `path`, so there is no display-name setting.
Spec §2 originally accepted that cost; the operator has since decided to rename the folder to
`kestrel-ai`. See the pending item below.

### Folder rename to `kestrel-ai` — prepared, not yet run

`scripts/rename-project.ps1` and `docs/superpowers/plans/2026-09-21-rename-project-folder.md` cover
it. The rename cannot be performed from inside a Claude session living in the folder, and it
requires that no worktree other than the main checkout is registered — worktree `gitdir` pointers
are absolute and would break. It also invalidates `backend/.venv`, both `node_modules` trees and
`frontend/src-tauri/target/`, all of which the script rebuilds.

Prerequisite already done: the legacy `.worktrees/wave1` worktree was removed on 2026-09-21 by the
junction-safe path (2106 reparse points, 0 escaping, no venv junction present; `backend/.venv`
verified intact afterwards). Branch `wave1-s2-trial` is untouched and still on the remote.

### ~~Stale acceptance run~~ — CLOSED 2026-09-22: 8/8 on the installed renamed build `8823d95`

Evidence `docs/evidence/acceptance/2026-09-22-installed-8823d95/` (merged `93892bd`). The text below is
the original entry.


`docs/progress.md` records an **8/8 PASS** for the acceptance run (spec 13.5) at main `177f68b`
(2026-09-20, the U2 site-office build; evidence `docs/evidence/acceptance/2026-09-20-installed-177f68b/`,
driver run committed at `df39048`). That build **predates the Kestrel AI rename** — every rename
commit lands after it. **It has not been re-run against the renamed, installed Kestrel AI build.**
Do not read the 8/8 as a current PASS. This is tracked as **Task 11 Step 5** of
`docs/superpowers/plans/2026-09-20-kestrel-ai-rename.md` ("Re-run acceptance ... The previous 8/8
was measured on the old build and is stale until this passes").

(The earlier run at main `9a2e20d` (installer built at `9f3aa01`), 2026-09-18, is a different,
earlier result: 7/8, step 7 skipped for lack of a provider key — not the run the 8/8 figure
belongs to.)

### Stale files in the install folder (opened 2026-09-22)

Inno Setup leaves files a newer build stopped shipping: 45 `api-ms-win-*` forwarders and 4
`__pycache__` from the 2026-09-21 install remain in `%LOCALAPPDATA%\Programs\Kestrel AI\_internal`.
Harmless on Windows 11. An `[InstallDelete]` of `{app}\_internal` in `kestrel-ai.iss` would clear
them if one ever shadows a new file. See [[2026-09-22-gotcha-acceptance-window-looks-like-the-operators-app]].

### ~~Other open items found while reading `docs/progress.md`~~ — CLOSED 2026-09-22

G3 fixed in `6b04cd1` and confirmed in the frozen build; M3 had been closed at `efa614a` and only the
ledger row was stale (`8823d95`). Original entry:


- **G3** (class labels on report thumbnails) — noted open after usability wave 1
  ("`G3 (class labels on report thumbnails) after this wave`"); no later entry in `docs/progress.md`
  records it closed.
- **G2/M3** — a minor item deferred within the results-export work
  ("`every item closed except G2/M3 (in G2) and H2`"); H2 (acceptance step 7) has since closed
  (2026-09-20), but `docs/progress.md` records no resolution for G2/M3.

## See also

- [[product]] — product purpose, users, tone, design language
- [[architecture]] — where each part of the app lives
- [[roadmap]] — phases and plans, indexed
- [[specs]] — the spec documents, live
- [[operations]] — build, freeze, installer, acceptance
- [[memory]] — how this vault's memory is layered
