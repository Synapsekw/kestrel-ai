---
type: spec
date: 2026-09-23
status: proposed
tags: [spec, models, library, projects, detect, analytics, migration]
related: ["[[2026-09-17-kestrel-ai-app-design]]", "[[2026-09-19-site-office-ui-design]]", "[[2026-09-22-geotiff-maps-design]]", "[[2026-09-23-survey-timeline-design]]", "[[2026-09-23-object-counts-per-group-design]]"]
---

# Train / Detect split and an app-wide model library

## 1. Goal

Today every project does everything: one linear pipeline (Images → Label → Datasets → Train →
Detect → Review → Export) with Maps and Models on the side, and each project keeps its own model
list in its own `project.db`. A model trained in one project cannot be used in another without
re-importing its file.

The operator wants two clearly different kinds of work:

- **Train** — build a model: images, labels, datasets, training. Every model produced goes into a
  shared **model library**.
- **Detect** — analyse a site: add sources (drone image batches, GeoTIFF maps; video later), run a
  model **picked from the library**, review the detections, read the analytics, export a report.

Done means:

1. The Projects screen offers **New training project** and **New detection project**; each kind
   shows only its own screens.
2. A model trained in any training project, or imported from a file, appears once in the
   **Library** and can be run in any detection project.
3. A detection project monitored over several surveys shows counts per class per survey, per site
   area, with verified vs unverified numbers, and exports a CSV and a PDF report.
4. Every existing project keeps opening; its models land in the library, its past detections stay
   readable.

## 2. Scope

**In:** the app-wide model library; project `kind`; the kind guard; kind-specific navigation;
migration of existing projects and models; detection sources with a survey date; runs that pick a
library model, with per-project class mapping; review of map and image detections with verified
counts; per-site-area counts; the Analytics screen (absorbing the survey timeline); CSV and PDF
export.

**Out, each with its own later spec:**

- **ONNX model import.** The library records `format` so it fits without schema change.
  Ultralytics-exported ONNX carries class names and a known output layout; foreign ONNX needs a
  supplied class list and a layout check. Not in this spec.
- **Video sources.** `Source.kind` reserves `video`; frame sampling and tracking are their own design.
- **Model comparison on one source** (disagreement view).
- **Sending reviewed detections to a training project.** Designed-for: reviewed boxes keep
  class, geometry and provenance so a later "Send to training project" can copy them.
- **A library on a shared or network folder.** The library root is resolved in one function.

**Depends on:** `2026-09-23-survey-timeline-design.md` merged first (`GeoMap.captured_on`, the
comparison-basis rule, the timeline service). This spec extends it rather than running beside it.

## 3. Decisions that shape everything

| Decision | Choice | Why |
| --- | --- | --- |
| Model identity | **Standalone library models**, each with its own class list and provenance | "Pick a model, run it" works in any project; no taxonomy lock-in. |
| Library location | `%APPDATA%\kestrel-ai\library\` beside the existing app data | Always available, one machine. A chosen/shared folder is a later setting. |
| Project split | **One project type with `kind: train \| detect`**, fixed at creation | Reuses the project folder, jobs, image import and the maps pipeline. A separate subsystem would duplicate them. |
| Existing projects | Become `train`; their models are adopted into the library | The operator's projects today are training projects; nothing is lost. |
| Detection project | **A site monitored over time**: sources carry a survey date | Covers a one-off delivery as the one-source case. |
| Class names in analytics | **Per-project class list**; each model's classes are mapped once and remembered | Trends survive a model change (`Bagger` → `excavator`). |
| Which run counts | The survey timeline's **comparison basis** (same model and confidence), with a manual pin as override | A model change must never masquerade as a change on the ground. |
| Image-source counts | **Detections (sightings), never objects**; excluded from trends | Overlapping frames count one object several times; projection-based de-duplication failed on real data (`2026-09-23-object-counts-per-group-design.md`). Orthomosaics have already solved it. |
| Count storage | **`MapRun.counts` stays the one place**, extended with verified counts and per-area counts | The timeline's rule: no second copy of the numbers to go stale. |
| Areas across surveys | **Site areas in WGS84**, projected onto each map | Existing `MapZone` is in one map's pixels and is for scoring, not reporting. |

## 4. The model library

### 4.1 Storage

```
%APPDATA%\kestrel-ai\library\
  library.db                      # SQLite, Alembic-managed like project databases
  models\<slug>-<id8>\
    weights.pt | weights.onnx
    exports\                      # onnx / engine exports
    artifacts\                    # results.png, confusion matrix, args.yaml
```

`library_root()` in `backend/app/library/paths.py` is the only place that knows this path.

### 4.2 `LibraryModel` (in `library.db`)

| Column | Notes |
| --- | --- |
| `id`, `name`, `notes` | |
| `task` | `detect` \| `obb` |
| `format` | `pt` today; `onnx` reserved for the ONNX import spec |
| `weights_path`, `exports`, `artifacts` | relative to the model folder |
| `class_names` | the model's own classes, in index order |
| `class_aliases` | carried over from today's import |
| `origin` | `trained` \| `imported` \| `starter` |
| `provenance` | JSON copy taken at registration: source project name and folder, dataset name, run id, base weights, hyperparameters, metrics. A snapshot, not a link. |
| `supplier` | optional free text for imported models ("Client X", "Partner Y") |
| `train_gsd_cm` | nullable; used by map runs as the default target GSD |
| `sha256` | of the weights file; a second import of the same file is detected and refused with a link to the existing model |
| `state` | `ready` \| `unavailable` (weights file missing) |
| `created_at` | |

`library.db` also has a `library_job` table with the same shape as a project's `Job`, run by the
existing job runner, so the Header's job indicator lists library jobs beside project jobs.

### 4.3 Getting models in

1. **Training finishes** in a training project → the train job registers `best.pt` and artefacts
   into the library (replaces `training/registry.py`'s copy into `<project>/models`).
2. **Import from file** (`.pt`) → a library import job: hash, copy, load-check with Ultralytics,
   read `task` and `class_names`, register.
3. **Starter models** → imported through the same path.

### 4.4 Using models

- `providers/factory.get_provider` resolves weights through the library instead of the project
  folder. The one-model cache in `local_yolo.py` is unchanged.
- Cloud vision providers (OpenAI/Anthropic) stay available in detection runs as today. They are
  not library models.
- **Library screen** at app level (`/library`), beside Projects: list with task/class filter, detail
  (provenance, metrics, artefacts), rename, notes, supplier, export to ONNX/TensorRT, import, delete.
- **Delete** of a model referenced by a known project asks for confirmation. References are found
  by scanning the recent-projects list. Unknown projects can still hold references, which is why
  every run keeps its own model snapshot (§7.1) and never needs the library row to render.

## 5. Project kinds

### 5.1 Data

`Project.kind`: `train` \| `detect`, non-null, set at creation, never changed. `recent_projects.json`
entries gain `kind` so the Projects list shows and filters by kind without opening each project.

### 5.2 The kind guard

A FastAPI dependency `require_kind(*kinds)` is attached **per router** in `api.py`. A wrong-kind
request gets `409 wrong_project_kind` with a readable message. Every project router declares its
kinds in one table, and a test fails if a router under `/projects/{id}/` has none.

| Kind | Routers |
| --- | --- |
| `train` | labels and training review, datasets, training, pre-annotation, project agent |
| `detect` | sources (detection), runs, detection review, analytics, site areas |
| both | image storage and thumbnails, jobs, exports, project settings |
| `train` read-only | past detections (`QueryRun`, `MapRun` and maps created before migration) |

### 5.3 Navigation

- **App level:** Projects, **Library**, App settings.
- **Train:** Home, Images, Label, Datasets, Train, Export; below the divider Past detections (only
  when present), Project settings. The pipeline lock rules of the site-office spec still apply.
- **Detect:** Home, Sources, Runs, Review, Analytics, Export; below the divider Site areas,
  Project settings. No step locks: an empty screen says what to add first.
- The Models entry and the in-project Maps entry leave the training sidebar. Maps live under
  Sources in detection projects.

## 6. Migration

Both steps run per project, when the project is opened, and never stop the app from opening.

1. **Schema:** a project migration adds `Project.kind` with every existing row set to `train`, and
   adds the columns in §7 and §8 (all nullable or defaulted). It chains onto whatever head is on
   `main` at merge time.
2. **Library adoption** runs when a training project still has rows in its old `models` table:
   - Each model's weights and artefacts are copied into the library. If the `sha256` is already
     there, the existing library model is reused.
   - The old-id → library-id map is written to `project.model_adoption`.
   - `preannotation_model_id`, `QueryRun.model_id`, `MapRun.model_id` and `Box.model_id` are
     rewritten to library ids.
   - A row whose weights file is missing is skipped. It is logged and listed in a Home banner
     with "Retry".
   - The step can be re-run safely: adopted rows are skipped by id, copies by hash. More than a few
     files runs as a job with progress.
   - The old `models` table stays read-only for one release, and the project's own `models\`
     folder is **never deleted** by the app.
3. **Past detections:** existing detection runs and maps stay viewable and exportable read-only
   under Past detections. **"Move map to a detection project"** creates a new detection project,
   or picks an existing one, and copies the GeoTIFF, its derived overview and tiles, its
   `captured_on` and its evaluation zones. The map's runs are not copied; it is re-run there with
   a library model.

## 7. Detection projects: sources and runs

### 7.1 Sources

`Source` gains:

- `kind`: `images` \| `map`, with `video` reserved
- `label`, e.g. "Flight 14 Sep"
- `captured_on` (Date, nullable)

An `images` source owns the images from one import, as today. Its `captured_on` is filled from the
earliest `Image.capture_time` (EXIF) in the import, and is editable.

A `map` source owns one `GeoMap`, through a new `GeoMap.source_id`. **For map sources the survey
date is `GeoMap.captured_on`** (survey timeline §3.1), and the source mirrors it. There is one
field to edit and one truth. A missing date shows "date not set" with an inline edit and is never
guessed.

### 7.2 Runs

The two run tables stay: `QueryRun` for image sources and `MapRun` for map sources. They gain:

- `source_id`
- `model_snapshot`: name, task, format, class names and origin at run time. Old runs render even
  after the library model is deleted.
- `class_map`: model class index → project class id, or `null` for ignored
- `pinned`: bool, the operator's override of the comparison basis for that source

`GET /projects/{id}/runs` lists both kinds in one paginated shape (source, model, conf, state,
counts, review progress).

### 7.3 Starting a run

1. Pick one or more sources. Each source gets its own run.
2. Pick a library model, or a cloud provider. The picker is filtered to task, and shows each
   model's classes and `train_gsd_cm`. It warns when a map's GSD differs from the model's by more
   than 2×.
3. Settings: confidence; tiling (on by default for large images, always on for maps); target GSD
   for maps, defaulting to the model's.
4. **Class mapping**, only when needed:
   - The first run in an empty project **seeds the project class list** from the model.
   - Later runs map automatically by exact name, then by the model's aliases, then by this
     project's remembered mapping.
   - Anything left over gets a one-time step: map it to a project class, add it as a new class, or
     ignore it.
   - The choice is saved in `ModelClassMap(library_model_id, mapping)`. The run request is refused
     with `422 unmapped_classes` (listing them) if the map is incomplete, before any job is queued.
5. Start. It runs as a background job with progress (`infer` / `map_detect`).

### 7.4 Which run counts

For map sources this is the survey timeline's comparison basis (timeline §4) unchanged: the newest
run matching the chosen model and confidence represents the survey, and mismatches are marked
not comparable. A **pinned** run takes precedence for its source and is marked "pinned" in the
table.

For image sources the same rule picks the run shown on the Analytics screen, but image sources
never enter trends (§9).

## 8. Review

- **Images:** the existing review screen, scoped to the chosen run of a source. Each box can be
  accepted, rejected or reclassed, and a missed object can be drawn in (`provenance_kind=person`).
- **Maps:** the same actions in the map viewer, plus a "next unreviewed" jump that moves the
  viewport to the next cluster of pending detections. `MapDetection` gains `review_state`
  (`pending` \| `accepted` \| `rejected`), and person-drawn detections are `MapDetection` rows with
  `provenance_kind=person`.
- **Keyboard:** A accept, R reject, 1–9 reclass, N next.
- **Accept all pending at or above a confidence**, as a job for large maps.
- **Progress per source:** "412 of 530 reviewed".

Reviewed detections keep class, geometry, provenance and the source image or map window. This is
what a later "Send to training project" needs.

## 9. Analytics

### 9.1 What a count is

A detection counts when it is in the chosen run, at or above the run's confidence, not rejected,
and its class maps to a project class. Person-drawn detections count too. Every number is shown as
**total (verified)**. Verified means accepted or person-drawn, e.g. "6 (4 verified)".

- **Map sources** report **objects**, because an orthomosaic has no overlap.
- **Image sources** report **detections across N photos** in their own clearly labelled table.
  They are never summed into an object count, and never enter a trend or a delta.

### 9.2 Storage

`MapRun.counts` changes shape from `{class_id: n}` to
`{class_id: {total, verified}}`. A new `MapRun.area_counts`,
`{area_id: {class_id: {total, verified}}}`, holds the per-area counts.

- Both are written when the run completes. Each review action applies an increment through one
  `counts` module, which is also used by the job.
- A **Recount** job rebuilds both from `MapDetection` if they are ever suspected stale.
- The shape change is migrated in place: `n` becomes `{total: n, verified: 0}`.
- The survey timeline service reads `total` (and `verified` when asked for verified-only). That is
  the one change to its code.
- `QueryRun` gains the same `counts` field, labelled detections in the UI.

### 9.3 Site areas

`SiteArea(id, name, polygon_wgs84, created_at)` is a project-level area, drawn on any map and stored
in WGS84. On each map it is projected into the map's pixel space with the map's CRS and geotransform
(`maps/georef.py`), and cached per map.

- A detection counts in an area when its box centre falls inside the projected polygon.
- An area that doesn't overlap a map simply has no row for that map.
- Existing `MapZone` evaluation zones are untouched: they stay per map and are used for P/R/F1
  scoring.

### 9.4 The Analytics screen (`/p/:id/analytics`, detection projects)

1. **Surveys:** the survey timeline's chart and table, moved from the Surveys entry into this
   screen. There is a verified-only toggle, and each cell shows total (verified).
2. **Per source:** for the selected source, class × count (total and verified), with the model,
   confidence, date and review progress.
3. **Per site area:** an area × class table for the selected survey, plus a trend per area across
   comparable surveys.
4. **Photo batches:** image sources with detections per class, labelled as detections, not objects.

In training projects the survey timeline's Surveys entry is not shown. Surveys are detection work,
and past maps in training projects are read-only.

## 10. Export

Every export runs as a background job with progress.

- **CSV:** one row per source × class × area (area empty for the whole source). Columns: date, source
  label, source kind, model, confidence, total, verified, and a unit column (`objects` for maps,
  `detections` for photos).
- **PDF report per source:**
  - header: project, source, date, model and origin, confidence, review progress
  - an overview (map overview or a contact sheet of the first photos)
  - the class counts table and the per-area table
  - a method footnote saying what was counted and how
- **GeoPackage:** as today for maps, with `review_state`, the mapped project class, and a site-areas
  layer added.

## 11. API (contract first)

`contract/openapi.yaml` first, `contract/client/schema.d.ts` regenerated in the same change, per unit.

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /library/models`, `GET/PATCH/DELETE /library/models/{id}` | list, import (job), detail, rename/notes/supplier, delete |
| `POST /library/models/{id}/export` | ONNX/TensorRT export job |
| `GET /library/jobs`, `GET /library/jobs/{id}` | library jobs |
| `POST /projects` | gains required `kind` |
| `GET/POST /projects/{id}/sources`, `PATCH /projects/{id}/sources/{sid}` | detection sources, label, `captured_on` |
| `GET/POST /projects/{id}/runs` | unified list; create (one run per source) |
| `PATCH /projects/{id}/runs/{rid}` | pin / unpin |
| `GET/PUT /projects/{id}/model-class-maps/{modelId}` | remembered class mapping |
| `POST /projects/{id}/runs/{rid}/review` | batch accept/reject/reclass; accept-above-threshold (job) |
| `GET/POST/PATCH/DELETE /projects/{id}/site-areas` | site areas |
| `GET /projects/{id}/analytics/source/{sid}`, `/analytics/areas` | per-source and per-area counts |
| `POST /projects/{id}/runs/{rid}/recount` | recount job |
| `POST /projects/{id}/maps/{mapId}/move` | move a past map into a detection project (job) |

The survey timeline endpoint keeps its path and gains `verified_only`.

## 12. Budget

- **Background jobs:** library import, training (with registration), ONNX/TensorRT export,
  adoption above a few files, source import (images and maps), detection runs, accept-above-
  threshold, recount, move-map, CSV/PDF/GeoPackage export.
- **Bounded reads:**
  - Analytics reads only `counts` / `area_counts` on run rows. A request grows with the number of
    surveys, never with the number of detections.
  - The library list, runs list, sources list and review queue are paginated.
  - Map review loads detections for the viewport only.
  - Image review loads one image's boxes at a time.
  - Site-area projection works on polygons, never on rasters.
  - No step loads a source's images or detections into memory whole.

## 13. Errors and edge cases

- **Library folder unreadable or `library.db` corrupt:** the app starts. The Library screen shows a
  blocking error with "Reveal folder". Projects open; run creation is disabled with that reason.
- **Model weights missing:** the model is `unavailable`, and a run with it is refused with
  `409 model_unavailable` before any job is queued.
- **Adoption fails for one project:** the error is logged, the project shows a Home banner with
  Retry, and the rest of the project works.
- **Wrong kind:** `409 wrong_project_kind`. The UI never offers such actions.
- **Unmapped classes at run start:** `422 unmapped_classes`, naming them.
- **Deleted library model:** runs render from `model_snapshot`, and review and analytics are
  unaffected. Re-running shows "model no longer in library".
- **Duplicate import:** refused with a link to the existing model (same `sha256`).
- **A site area crossing a map edge:** it is clipped to the map footprint, and the table says
  "partly covered".
- **Counts drift** (crash between a review write and its increment): the review write and the
  increment share one transaction. Recount is the repair tool.

## 14. Testing

**Backend (pytest)**

- Library:
  - import, duplicate refusal, `unavailable` state, delete with snapshots intact
  - `get_provider` resolves library paths
  - the train job registers into the library
- Kind guard: every project router declares its kinds; wrong kind returns 409.
- Adoption:
  - happy path
  - a missing weights file
  - a second run is a no-op
  - id rewrite across `Box`, `QueryRun`, `MapRun` and `preannotation_model_id`
- Class mapping: exact match, then alias, then remembered map; `422` listing the leftovers; first
  run seeds the project classes.
- Counts:
  - after random sequences of accept, reject, reclass and add, the increments equal a full recount
  - the `{n}` → `{total, verified}` migration
  - area membership by box centre, including an area crossing the map edge
- Site areas: WGS84 → pixel projection on a UTM and a rotated-geotransform fixture
  (`tests/geotiffs.py`).
- Survey timeline: still passes, and `verified_only` works.
- Contract tests for every new endpoint.

**Frontend (vitest)**

- The sidebar for each kind.
- The class-mapping step (auto-mapped, leftovers, add as new, ignore).
- Total (verified) rendering, with the "detections" unit for photo batches.
- The library list and its filters.

**Playwright e2e**

1. New training project → train the starter model on the tiny fixture → the model appears in the
   Library.
2. New detection project → add a map source and an image source → run with the library model
   (mapping step shown) → review a few detections → Analytics shows the counts including the
   verified numbers → CSV export.
3. Open a pre-migration project fixture → its models are in the Library and its past runs open
   read-only.

## 15. Success criteria

1. A new project is either a training or a detection project, and each shows only its own screens.
2. Every trained or imported model appears once in the Library and runs in any detection project.
3. Existing projects open unchanged in content; their models are in the Library and their past
   detections are readable.
4. A detection project's Analytics screen shows counts per class per survey and per site area, as
   total (verified). A change of model or confidence is never presented as a change on site.
5. Photo batches are never reported as object counts.
6. No analytics request grows with the number of detections, and no step blocks the UI.
7. Nothing on any new screen assumes the objects are machinery.

## 16. Execution DAG

**Units**

- **C — contract**, split per batch: the §11 endpoints for the units in that batch, plus the
  regenerated client.
- **L — library:**
  - `library.db` and its migrations, `LibraryModel`, `library_job`
  - `/library/*`, the import/export jobs, `get_provider` resolution
  - the train job registering into the library
  - the Library screen
- **K — project kind:** the `kind` column and migration, `recent_projects.json` kind, `require_kind`
  with the router table and its test, the two sidebars, the create flow.
- **M — migration:** adoption and id rewrite, the Home banner, Past detections, move-map. Needs L, K.
- **D — detection sources:** `Source.kind/label/captured_on`, `GeoMap.source_id`, the Sources screen
  (images and map import). Needs K.
- **R — runs:** `model_snapshot`, `class_map`, `pinned`, `ModelClassMap`, the unified runs list, the
  run dialog with the mapping step, and the shared **`counts` module** with the new `counts` shape.
  Needs L, D.
- **V — review:** `MapDetection.review_state`, map and image review with increments,
  accept-above-threshold. Needs R.
- **A — analytics:** site areas and their projection, `area_counts`, the analytics endpoints, the
  Analytics screen absorbing Surveys, `verified_only`. Needs R.
- **E — export:** CSV, PDF, GeoPackage additions. Needs A.
- **X — e2e and evidence:** the three flows, walkthrough, ledger entry. Needs everything.

**Parallel batches**

1. C1, then L and K in parallel.
2. C2, then M and D in parallel.
3. C3, then R.
4. C4, then V and A in parallel. Both use R's `counts` module and don't edit it.
5. C5, then E.
6. X.

**Critical path:** R starts when both L and K → D are done, so the path is (L ∥ K → D) → R → A → E → X.
L is expected to be the longer branch. M is off the critical path.

## 17. Risks

- **Adoption touches every existing project.** Mitigations:
  - it can be re-run safely
  - it never deletes anything
  - the old table stays for one release
  - the migration e2e runs on a copy of a real project
- **Counts drift under review.** Mitigations: the increments and the review write share one
  transaction; the property test compares increments with a recount; Recount exists.
- **The survey timeline is in flight** in another worktree. This spec builds on it after it merges.
  The `counts` shape change and `verified_only` are the only edits to its code, and they are done
  in unit R/A after rebasing on `main`.
- **Site-area projection** on unusual CRSs. It uses the same `georef.py` paths the maps feature
  already tests, and adds a rotated-geotransform fixture.
- **Scope.** This is the largest change since v1. If it has to be cut, L + K + M are shippable on
  their own (library and split), with D–E following as a second release.
