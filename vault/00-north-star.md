---
type: north-star
status: active
last-updated: 2026-10-03
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
| Design surfaces (S3) — import a DEM/LandXML/DXF design as a surface | merged/pushed to `main` (`23c1ca6`); installed 2026-09-26 (build of `3ad69e4`) | acceptance on the chimney site passes all five §15.4 steps headless (LandXML 98.4 % overlap, median dz +0.005 m; swap fix; 3D faces; contours; EPSG:32638 DEM; S2 volume against each); 1 M-point LandXML inspects in 7.9 s and builds 4996² in 8.4 s. 1969 backend, 982 frontend, 91 browser tests. **Not driven through the UI or installed.** See [[2026-09-26-0144-design-surfaces]] |
| Point clouds (S1) — import LAS/LAZ, 3D viewer, measurements, map ↔ 3D, LAZ export | merged/pushed to `main` (`0af7084`), acceptance + fixes `ab3fa34`; CI green; installed 2026-09-26 (build of `3ad69e4`) | chimney import 9.5 s; 195 M points in 58.9 s (converter peak 8.98 GB); viewer settled < 0.7 s; picks within 0.002 mm; LAZ export 1.8 s. §17.10 rim u 0.171 m vs ≤ 0.05 m (data-limited, operator decision). 1974 backend, 995 frontend, 93 browser, 8 Rust tests. See [[2026-09-26-0404-point-clouds-s1]] |
| Foundation of the inspection platform (F): Aero glass UI, projects without kind, catalogue, findings, Models section, migration | merged/pushed to `main` (`09fb538..f3ff568`); installed 2026-09-27 | 11 units via parallel worktrees. 2576 backend, 1622 frontend, 103 browser, 8 Rust tests; smoke ok (CUDA); the smoke run caught and fixed an unbundled catalogue migration. Migration dry run on copies of AHTest, Ahmadia and acceptance: all reach `0010`/v2, 120,278 boxes rewritten, 0 unmapped, originals unchanged. **Not yet opened by the operator.** See [[2026-09-27-1030-foundation-inspection-platform]] |
| I/M/C wave: Images, Maps and Point clouds workspaces (39 units + IMC-X) | merged/pushed to `main` (`4ebcac1..ad4e548`); installer built (`c4080c7`), **not installed** | all 39 units plus the IMC-X close-out merged via per-unit worktrees. IMC-X gate: 3946 backend, 3535 frontend, 162 browser, 8 Rust; frozen smoke ok (SAM on CUDA, drawings, pypdfium2). **CI frontend e2e red on `main` since `81b0310` (perf budgets on the slow runner); fix in flight.** See [[2026-09-27-2140-imc-wave-part-1]], [[2026-09-28-1905-imc-wave-part-2]] |
| Reports (R): builder, live preview, render job with versions, templates, Data exports | merged/pushed to `main` (`07beeac..cd7c59d`); installer built (`8aead7b`), **not installed** | 13 units in parallel worktrees + R-X close-out; gate 5181 backend, 4065 frontend, 178 browser, cargo 8/8; frozen smoke renders a real report. See [[2026-10-01-2205-reports-wave]] |
| Project landing (Overview v2): viewport-filling, data-driven Overview | merged/pushed to `main` (`35534daf..335c37fb`); installed (`8aead7b`), operator walkthrough passed 2026-10-02 | 9 SDD tasks (5 in parallel worktrees) and a final opus review; the fix wave closed 1 critical and 6 important findings; gate 4787 backend / 3769 frontend / 167 browser; Location pane got a keyless cached basemap 2026-10-03 (`31a1a5ab`, [[2026-10-03-0723-site-basemap]]) |
| Public repo, Obsidian dev memory & the working agreement | complete 2026-09-21 | published to [`Synapsekw/kestrel-ai`](https://github.com/Synapsekw/kestrel-ai) (PUBLIC, MIT, 4 branches); vault + 24 ADRs; `AGENTS.md`/`CONTRIBUTING.md`; worktree scripts and `/wrapup` proven end to end (spec §7.5); fresh-clone test passed. Owed: Obsidian GUI check (§7.3) |
| M1 asset model builder (confined-space programme M1–M6) | merged 2026-10-02 (`914c4d5b`) | all 7 units green; frozen smoke `asset-models ok`; installer not built (app was running); HCl acceptance owed |

Plans (`docs/superpowers/plans/`): [[2026-09-17-s0-contract-and-scaffolding]],
[[2026-09-17-s1-dataset-backend]], [[2026-09-17-s2-annotation-ui]],
[[2026-09-17-s3-training-backend]], [[2026-09-18-s4-inference-providers]],
[[2026-09-18-s5-training-inference-ui]], [[2026-09-18-s6-packaging-acceptance]],
[[2026-09-19-u2-site-office-ui]], [[2026-09-20-kestrel-ai-rename]],
[[2026-09-20-rotated-boxes-wave-1]]. Full index: [[roadmap]].

## 4. Now

**Shipped last:** **Site basemap under the Overview's Location pane** (2026-10-03, `31a1a5ab`, on `main`, pushed). Keyless Esri satellite / OSM street tiles, proxied and cached by the backend (`GET /basemap/{source}/{z}/{x}/{y}`), drawn inside the existing SVG with a Satellite/Map switch. Offline falls back to the plain outline. Gate green (5313 backend, 587 vitest files, 180 browser). The installer was rebuilt from `31a1a5ab` and **installed**; it has M1 am-u1..u4 but **not** am-u5..u7. Nobody has looked at it with real tiles yet. See [[2026-10-03-0723-site-basemap]].

Before that: **M1 asset model builder** (2026-10-02, `1b392b1a..914c4d5b`, 7 unit merges on `main`, pushed). Asset models tab: Build with AI (Claude, OpenAI or Gemini) reads drawings, clouds and photos into a versioned part spec and a GLB; edit parts as new versions, compare and restore, download GLB/JSON; runs stop, draft and survive restarts. Frozen sidecar at `914c4d5b` passes smoke (`asset-models ok`); the installer was **not** built (`check-packaged-webview` refused while Kestrel AI was running). Walkthrough: `docs/evidence/2026-10-02-asset-model-m1/walkthrough.md`. See [[2026-10-02-2300-asset-model-builder-m1]] and [[2026-10-02-gotcha-shared-venv-install-while-python-runs]].

Before that: **Point-cloud RAM admission at the measured plateau** (2026-10-02, `4a4e4d8d`, on `main`). The 842 M-point LNG cloud was refused at "39.0 GB needed"; PotreeConverter measured 10.3 GB peak on it, so the need is now min(45 MB/Mpt, 9 GB + 2.5 MB/Mpt) + 1 GiB (12.2 GB at 842 M). The installer was rebuilt from `4a4e4d8d` and **installed** (it supersedes `3c6b04bc` and still contains S1 and Reports; not the am-u1/am-u4 merges); the operator imported the cloud on it: "works great". See [[2026-10-02-1650-cloud-ram-admission]] and [[2026-10-02-gotcha-potreeconverter-ram-plateaus]].

Before that: **Native icons on the brand gradient** (2026-10-02, `3c6b04bc`, on `main`). The desktop/taskbar icon moved from amber to the violet → teal `grad-brand`, matching the rail tile. The installer was rebuilt from `3c6b04bc` with a freshly frozen backend and **installed**; the operator confirmed the app opens. That build therefore contains S1 and Reports; neither walkthrough has been run on it yet. See [[2026-10-02-1441-native-icons-brand-gradient]].

Previously: **Reports (R) complete on `main`** (2026-10-01, `07beeac..cd7c59d`, 13 units + close-out, pushed).
- Project → **Reports**: a report list, a three-pane builder with a live A4 preview, filters, templates, and **Render** as a background job producing numbered versions (PDF, optional CSV/XLSX), with issue/unissue and history.
- Snapshots are rendered server-side (image crops, maps, swipe pairs, volume plans) and C's stored 3D views are passed through with fallbacks; the PDF is reportlab with bundled fonts and is byte-stable.
- Data exports moved under Reports (`/export` redirects).
- R10's evidence runs fixed a PDF memory peak (+609 → +314 MB for 300 findings) and preview scroll jank (p95 166 → 16.8 ms).
- Gate at `8aead7b`: 5181 backend, 4065 frontend, 178 browser, cargo 8/8; frozen smoke renders a real report (`report ok v1 8 pages pdf xlsx`).
- Installer `E:\Dev\Yolo\installers\Kestrel AI_0.1.0_x64-setup-8aead7b.exe` (**not installed**; predates S1-U6). Walkthrough: `docs/evidence/reports/combined-walkthrough.md`.
See [[2026-10-01-2205-reports-wave]].

Previously: **New-project setup (S1) on `main`** (2026-10-01, `ea5d13cb..7bfb2b5b`, 6 units, pushed).
- New project is now a full page at `/projects/new`.
- Templates: Mapping, Vertical asset, Confined space, Blank, and your own saved ones.
- Data: drop a folder and it is sorted into slots from headers only (bounded `setup_inspect` job).
- Anomaly types land in the Catalogue, which gains a definition and severity rules.
- Create imports each slot through the existing importers, and the Overview shows a notice if any fail.
- Gate: 5170 backend; after the last merge, 4116 frontend and 180 browser tests. **No installer built.**
- Walkthrough: `docs/evidence/setup/walkthrough.md`.
- S2 (AI Describe it), S3 (AI Show it) and S4 (video import) are designed but not built.
See [[2026-10-01-2131-s1-project-setup-wave]].

Previously: **Project landing (Overview v2) on `main`** (2026-10-01, `35534daf..335c37fb`, pushed).
- The Overview now fills the window. A data-driven grid (`composeOverview`) picks the hero (map, then point cloud, then photo mosaic, then drawing) and drops any pane that has nothing to show.
- New panes: a header with coordinates and only non-zero figures, an offline site-location SVG, a budgeted live 3D preview with a static fallback, latest imagery, a Status pane, and a first-data screen for empty projects.
- Backend: `ProjectOverview.hero` and `GET /overview/site`, which reads at most 500 photo points by rowid and never scans `image`.
- Gate: 4787 backend, 3769 frontend and 167 browser tests. **No installer built.**
See [[2026-10-01-1842-overview-landing]].

Previously: **I/M/C wave complete on `main`** (2026-09-28, `4f68d13..ad4e548`, 15 merges, pushed). The CI flakes were fixed first (`c1bdc0b`; one was a real `useUrlState` race). Then the remaining 12 units merged: M-W3/W4/W5/W6, C-R1/M1/P1/L1, I-FW, and the evidence units I-E, M-X and C-G. IMC-X (`ad4e548`) closed the programme with contract prose fixes, the full gate (3946 backend, 3535 frontend, 162 browser, cargo 8/8), a frozen sidecar smoke (SAM on CUDA, `drawings ok`) and one installer, `E:\Dev\Yolo\installers\Kestrel AI_0.1.0_x64-setup-c4080c7.exe` (**not installed**). Combined walkthrough: `docs/evidence/imc/walkthrough.md`. Operator retired resume-interrupted-run and bulk-undo of accepted labels. See [[2026-09-28-1905-imc-wave-part-2]].

Previously: **I/M/C wave, part 1** — plans for 39 units and 27 units merged (`4ebcac1..7c1200b`). See [[2026-09-27-2140-imc-wave-part-1]].

Before that: **Foundation of the inspection platform, complete on `main` and installed** (2026-09-27, `09fb538..f3ff568`, 231 commits). The operator chose the Aero glass direction and one project for every kind of drone data (umbrella spec `2026-09-26-inspection-platform-design.md`). Foundation's 11 units ran in parallel worktrees under per-unit controllers: C0 `8df7682`, BK `cae9491`, DS `fd55985`, MG-framework `23512f1`, SH `f448175`, BC `825c874`, BM `ebb5143`, S1 `54126d1`, MG-steps `822e095`, S2 `7477e3c`, X `16b484e`. Final gate: 2576 backend, 1622 frontend, 103 browser and 8 Rust tests. Smoke ok with CUDA. The migration dry run on copies of all 3 real projects passed, with the originals hash-identical. Installer `dist/Kestrel AI_0.1.0_Foundation_2026-09-27_x64-setup.exe` installed 2026-09-27. Every ruling: `docs/evidence/foundation/rulings.md`. See [[2026-09-27-1030-foundation-inspection-platform]].

**In flight (M1):** close Kestrel AI, build the installer from `main`, install, then the HCl acceptance (§5 Owed). The other session's artifact-port plan treats M1 as P0.

**In flight:** nothing for Overview v2: the operator checked it on the installed `8aead7b` (2026-10-02, "all good, all working"). Reports is merged; nothing of it is in flight. Earlier: CI on `main` was green 3 runs in a row at `a57d619` (run 36605136991, attempts 1–3; ~18 min per run after the backend was split into 5 shards).  See [[2026-09-30-0900-ci-green-after-imc]].

**Next (S1):** The operator runs `docs/evidence/setup/walkthrough.md` on a real delivery. Then brainstorm S4 (video import, which unblocks the Confined template) or S2 (AI Describe it plus severity pre-fill).

**Next:** The operator installs `8aead7b` and runs `docs/evidence/reports/combined-walkthrough.md` (Reports plus the open I/M/C checks; it supersedes installing `c4080c7`). For one build with S1 too, rebuild the installer from current `main`; the Foundation walkthrough is still owed (§5).

Before that: **Train/Detect split, an app-wide model library, and the detection workspace**. Plan 1 is `d01a7cb..c9f88e2` (71 commits) and Plan 2 is `c9f88e2..f7d7ab6` (61 commits), both built by parallel agents in `tds-*`/`dw-*` worktrees, merged serially into an integration branch, landed and pushed. All of those worktrees are removed.
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

Earlier (2026-09-26, now merged at `23c1ca6`): **Design surfaces (S3)** — Task 17 (acceptance, walkthrough, evidence, ledger) done on `task/design-surfaces` at `2633708`, gate green. See [[2026-09-26-0144-design-surfaces]].

Earlier (now merged at `798c0c3`): **Volumes (S2)** — surfaces (the grid convention, the build pipeline with
median/mean/max/min, despike, hole-fill, auto cell, hillshade + zoom tiles), the volume engine
(fill/cut/net against a toe-plane, fitted toe surface, flat level or another survey/design surface,
clutter masks from detection runs and hand-drawn exclusions, a two-surface alignment/shift check, a
full uncertainty budget), the `volume_calc`/`volume_export` jobs and the Volumes screen — on
`task/volumes`, gated at `94c4e8b` (contract check, ruff, ruff format, pytest 1543 passed/3
skipped/9 deselected, frontend lint, 848/848 unit, build and 80/80 e2e all green). **Not merged
yet:** a final-review fix wave (five Important findings plus cheap minors from the whole-branch
review) is running in a separate worktree `volumes-tfx`, and `finish-task.ps1` re-runs the full gate
before the merge to `main`. This block (Task 17) wrote the module-level acceptance evidence
(`docs/evidence/volumes-acceptance.md`), the CloudCompare cross-check template
(`docs/evidence/volumes-crosscheck.md`, rows still open — CloudCompare isn't installed here) and the
walkthrough (`docs/usability/2026-09-24-volumes-walkthrough.md`), plus the top ledger entry in
`docs/progress.md`; see [[2026-09-25-2244-volumes-task17-docs]]. Point-cloud foundation F0 (the
shared scaffolding S1/S2/S3 build on) is already merged to `main` (`754c741`, 2026-09-24). Other
sessions may still hold `model-gsd`, `pointcloud-specs` and `pointcloud-spike`; their state is not
recorded here.

Earlier next-steps (the rebuild and install is done — 2026-09-26, build of `3ad69e4`, which carries the survey timeline and the train/detect work). Still to do from them: run `docs/usability/2026-09-23-library-walkthrough.md` and
`docs/usability/2026-09-23-detection-workspace-walkthrough.md` on the installed app, with a **backup
copy** of a real training project (to watch adoption) and a real orthomosaic, and dispatch CI
`sidecar-smoke` (the packaging gained `reportlab`). Then the ONNX model-import spec, the
**de-machinery pass**, and patching `finish-task.ps1` per
[[2026-09-24-gotcha-finish-task-rebase-drops-merge-resolutions]]. Still open from before: the maps
walkthrough on a real orthomosaic, with the GeoPackage opened in QGIS; the point cloud viewer
(unstarted); rotated boxes wave 2 (unplanned); the prepared folder rename (§5).

## 5. Owed

### Site basemap (opened 2026-10-03)

- **Operator check:** the 7-step walkthrough in [[2026-10-03-0723-site-basemap]] on the installed `31a1a5ab` build. This is the first view with real tiles (e2e uses Prism).
- **Known gaps:** the basemap disk cache has no size cap; Esri's terms strictly expect an ArcGIS account (OSM behind the Map switch is the clean option).

### M1 asset model builder (opened 2026-10-02)

- **Installer:** not built from `914c4d5b` (the app was running). `pnpm -C frontend build:installer`, then install.
- **Acceptance (spec §11):** needs the HCl GA drawing (P-00212-DW-MD-143TD1 rev 3) as `backend/tests/data/asset_models/hcl-tank-ga.pdf`; the live test's bearing/elevation table must be transcribed from `source_2/model_meta.json` first.
- **Gemini:** default model id `gemini-2.5-pro` unconfirmed; one live Test in App settings.
- **Known gaps:** DXF/LandXML drawings have no image view for the agent; compare is unsigned distance; 2 000-part validate is ~8 s synchronous; unsaved Part edits drop silently. Full deferred lists in `.superpowers/sdd/am-common/ledgers/` (git-ignored).

### Reports R (opened 2026-10-01)

- **Operator check:** (the installed `3c6b04bc` build, 2026-10-02, includes Reports, so it can stand in for `8aead7b`) run `docs/evidence/reports/combined-walkthrough.md` (26 Reports steps incl. "Checks only you can do", plus 4 carried I/M/C checks). Nothing in Reports has been run by the operator yet.
- **Parked follow-ups:** History drawer covers "Back to draft" at 1280 px; templates keep `measurement_ids`/comparison pairs (portability over-claimed); ReportFilters' chip duplicates `ToggleChip`; R3 `compact_geometry` drops polygon holes; Space Grotesk lacks Cyrillic/CJK/emoji (no fallback font); `app.pointclouds.views` imports PIL eagerly and reads views one at a time; smoke does not yet assert the XLSX file or report image.
- **Deferred by spec (§20):** Word output, server-side 3D rendering, in-app PDF viewer, merged PDF above the part budget, landscape, deleting `detect/export_pdf.py` one release after R8.

### New-project setup S1 (opened 2026-10-01)

- **Operator check:** the 37-step walkthrough on real drone deliveries. The installed build from `3c6b04bc` (2026-10-02) contains S1; the walkthrough has not been run on it.
- **Not built:** S2, S3 and S4. S4 must flip the Confined video slot to required in a new catalogue revision and set `VIDEO_IMPORT_ENABLED`.
- **Known gaps:**
  - Photo import is per folder and recursive. A skipped nested photo bucket is still imported. Fix: a file list on `POST /sources`.
  - Map-layer reordering likely broken in the installed app ([[2026-10-01-gotcha-tauri-drag-drop-blocks-html5-drag]]).
  - Ensure returns 500 for a legacy type with a non-hex colour.
- **Parked minors:** the follow-up list in `docs/evidence/setup/walkthrough.md`.

### Overview v2 (opened 2026-10-01)

- ~~**Operator walkthrough on the installed build**~~: done 2026-10-02 on `8aead7b`. The operator reported "it's all good, it's all working". That accepts the design as built:
  - D7: one Status pane.
  - Coordinates only in the header.
  - RecentFindings scrolls inside its pane.
- **Possible follow-up, not requested:** a place name in the header (reverse geocoding).
- **Parked:**
  - There are no Prism examples for the four Overview data states.
  - The imagery pane flashes for one frame when the images read comes back empty.
  - `site.py` sets `source` for a map with null bounds. The result is still correct.
  - Antimeridian area.
  - Untested: SummaryHero "No data yet." and the RunningJobs `bare` defaults.
- **Check to automate:** add the U+FFFD byte grep to `frontend lint` ([[2026-10-01-gotcha-subagent-non-ascii-commits-as-replacement-char]]).

### I/M/C wave (opened 2026-09-27)

- ~~**CI on `main` is red intermittently**~~ (schemathesis ReadTimeout, agent e2e PermissionError, MapWorkspace keys, query.spec): fixed 2026-09-28 in `c1bdc0b`; 3 green runs followed (`c1bdc0b`, `a88b936`, `f6e984d`).
- ~~**CI frontend e2e red again since `81b0310`**~~: fixed 2026-09-28/29 (`a988b1d` idle-timer fix + perf budgets moved to the perf config; `a57d619` e2e runs against the built bundle instead of `vite dev`, which removed the runner's `ERR_NO_BUFFER_SPACE` blank-page failures; Accept/Type wait for the project types). 3 green `main` runs in a row at `a57d619`.
- ~~**12 units not built yet**~~: all merged 2026-09-28, IMC-X included ([[2026-09-28-1905-imc-wave-part-2]]).
- ~~**Contract prose fixes**~~: done in IMC-X (`333207a`).
- **Unverified:** the seg GPU training epoch (no `yolo11n-seg.pt` locally) and the seg starter download URL; a real DXF or PDF drawing import through the UI. ~~pypdfium2 bundled~~: `drawings ok` in the frozen smoke.
- **Installer `c4080c7` not installed; the I/M/C walkthrough has not been run by the operator.** The checks only the operator can do: C-G criteria 4/5/7/8 (4 azimuth is a fail by test design); M-X real-data checks; DXF click-to-select; pan a 20k-point capture map on the real GPU; the Input fields resized by C-G's ui/Input and ui/Slider fix.
- **Follow-ups:** 3 of 5 `?finding=` cloud arrival re-picks miss by 0.44–0.69 m (C-P1/C-L1); no `at` marker after a 3D→map jump; two quick far clicks can finish a map line.
- ~~**Backend CI takes ~55 min**~~: backend split into 5 xdist shards (`65c8f8f`); a whole CI run is now ~18 min. `sidecar-smoke` still fails on manual dispatch (PotreeConverter payload missing on CI).
- **Camera z assumes metres**, so it is wrong for a cloud whose vertical unit is feet (C-B3; spec follow-up).
- **`CloudCameraSet.sources` has no maxItems**; `delete_cloud` has a race on a NULL job_id (C-G parked).
- **Leftover locked folders:** `.claude/worktrees/m-b2`, `c-p1`, `i-e`.

### Foundation (opened 2026-09-27)

- **Operator walkthrough on the installed build** (9 steps in [[2026-09-27-1030-foundation-inspection-platform]]). Step 8, the glass frame rate on the real GPU, is unproven: the headless evidence is SwiftShader at 60 Hz.
- **Classify the migrated catalogue types**: all 8 start as Object, and defects must be marked by hand (Catalogue banner → backfill).
- ~~**A finding edit can trigger up to 10 re-reads**~~ — closed 2026-09-27 by I-FB (`8e80b38`): `ownFindingsWrite` dedupes the echo; `findings/echoRereads.test.tsx` counts the re-reads. Maps and clouds finding writes adopt it in M-W3/C-P1/C-L1.
- **Contract gaps:** `createCatalogueType`, `patchCatalogueType` and `createProject` return 422 refusals the contract does not declare (`UNDECLARED_REFUSALS` in `test_contract.py`).
- **Search matches case-insensitively for ASCII letters only** (Č/Ć/Š/Ž/Đ).
- **`scripts/start-task.ps1` and `finish-task.ps1` throw under PowerShell 5.1** (git writes progress to stderr). Merges were done by hand this block.
- **Leftover locked, unregistered folders:** `.claude/worktrees/f-c0`, `f-ds`, `f-bm`.
- **Load-only flakes:** `lazyScreens.test`, `MapReviewPanel.test`, `test_import_sample_frames`, `test_project_agent_e2e`, `clouds.spec`.

### Point-cloud programme: cross-cutting (opened 2026-09-26)

- **CI `sidecar-smoke` fails on every `workflow_dispatch` run:** `build.ps1` needs the git-ignored
  PotreeConverter payload, which CI never fetches (push runs skip the job, so `main` shows green).
  Fix: run `fetch_potreeconverter.ps1` in that job — needs an MSVC runtime on the runner.
- **Maps' live-job refusals still answer `conflict`** (resume, delete-run, delete-map); point clouds,
  surfaces, volumes and design now answer `job_running` (`2a1f634`). Align when maps is next touched.
- **Every existing masked volume measurement turns stale once** after `2a1f634` (fingerprint format
  changed; reason reads "masks: detection run changed") — expected, one recalculation each.
- **Leftover, unregistered folders** in `.claude/worktrees` (`design-surfaces-t5`,
  `pointcloud-foundation`, `pointcloud-foundation-t8`, `volumes`) and ~1.4 GB of acceptance data in
  `D:\kestrel-acceptance` — safe to delete by hand (no links inside, none registered with git).
- **`task/model-gsd` (another session) carries `0007_model_train_gsd`,** which collides with `main`'s
  `0007`; `main`'s head is now `0009` — renumber before merging it.
- **COPC export was deliberately dropped** (potree-core can't read COPC; LAZ opens in QGIS and
  CloudCompare, QGIS builds its own index). Revisit only if a client asks for COPC.
- **The installer bundles no WebView2 bootstrapper** — fine on this machine, not on a clean one.
- **RAM admission past 842 M points is extrapolated** (2026-10-02, `4a4e4d8d`): the converter
  plateau was measured once (842 M → 10.3 GB, 24 threads); re-measure on a bigger cloud or new
  hardware ([[2026-10-02-gotcha-potreeconverter-ram-plateaus]]). Heavy imports (cloud, ortho,
  training) still share the 2-worker pool, and a refusal still comes only after copy + scan.
- **`scripts/start-task.ps1` throws on PS 5.1** at `git fetch origin main` (stderr becomes a
  NativeCommandError under `$ErrorActionPreference = 'Stop'`); cut the worktree by hand meanwhile.

### Point clouds (S1): operator checks (opened 2026-09-26)

- **Walk** `docs/usability/2026-09-24-point-clouds-walkthrough.md` in the installed app (installed
  2026-09-26): map right-click → 3D precision (§17.12), the LAZ in QGIS, the warn-tone screenshot.
- **Decide §17.10:** close-range pick u on the chimney rim is 0.171 m vs ≤ 0.05 m; the rim's own
  point spacing is 0.074 m.
- **Z refine over noise:** the top-surface refine lands on airborne points over one open-ground spot.
- **Re-import clouds imported before `430a726`** — their octrees decode 1 mm low.

### Design surfaces (S3): live walkthrough (opened 2026-09-26; merged `23c1ca6`)

- **Walk `docs/usability/2026-09-24-design-surfaces-walkthrough.md` in the app** — the acceptance ran
  headless through the API only.
- **Suggestion overlap is scored on file vertices, not the footprint** (spec §10): on the chimney TIN
  it says 67 % where applying gives 98.4 % (repro in `docs/evidence/design-surfaces/README.md`).

### Volumes (S2): acceptance ran at module level (opened 2026-09-25; merged `798c0c3`)

Merged after its final-review fix wave; the detection-review fingerprint gap was closed again,
properly, in `2a1f634` (exact masked box set, stale on review, stale export refused). Owed:
- **Run the deferred in-app steps** (S1's import UI is on `main` and installed): repeat the
  task-17 brief's Steps 1–7 through the real UI (import the chimney/+0.100 mm/195 M clouds, re-run
  `docs/usability/2026-09-24-volumes-walkthrough.md` live), then install CloudCompare 2.13 and fill
  in `docs/evidence/volumes-crosscheck.md`'s open rows, plus the QGIS/PDF/XLSX export review.
- **Profile `app/surfaces/build.py`'s memory growth with site size** before accepting larger sites:
  peak working set grew 2.9× (625 MiB → 1 818 MiB) across a 9× site though a single block should set
  the ceiling; passes the ≤ 2 GB acceptance bound but misses the 1.5 GB target.
- **Frozen `volumes-selftest` passed** in the 2026-09-26 rebuild (`volumes ok pdf 2038 xlsx 523.6
  delaunay 2`); close the ADR's open hidden-import question with that evidence.

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
