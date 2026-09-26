# Detection workspace (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan runs as **parallel units in separate worktrees**. Each unit brief is self-contained: the files you own, the interfaces you consume and produce, the tests you write first, and your gate. Don't edit files another unit owns unless your brief says so.

**Goal:** Turn a detection project into a site workspace. Sources (photo batches and maps) carry a survey date. Runs pick a library model and map its classes onto the project's once. Detections are reviewed into verified counts. Site areas give per-area counts across surveys. An Analytics screen absorbs the survey timeline, and a CSV and a PDF report export the numbers.

**Architecture:**
- **One shared foundation unit (S).** It owns all schema changes (one migration), the counting rules (`app/detect/counts.py`) and the site-area geometry (`app/detect/areas.py`), so feature units never edit `db/models.py` or migrations in parallel.
- **The contract is a separate unit (C)** that runs alongside S.
- **Four full-stack feature units** (sources, runs, review, analytics) build in parallel on S and C. Export follows once analytics has merged.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, pyproj/Affine (already present), `reportlab` (new, BSD) for the PDF, React/TS/Vite, OpenLayers (present), vitest/RTL, Playwright + Prism.

**Spec:** `docs/superpowers/specs/2026-09-23-train-detect-split-and-model-library-design.md`, §7–§10 (units D, R, V, A, E). Plan 1 (`2026-09-23-model-library-and-project-kinds.md`) is on `main`, and so is the survey timeline (`2026-09-23-survey-timeline-design.md`).

## Deviations from the spec (decided while planning, binding here)

1. **Counts shape.** `MapRun.counts` keeps its `{class_id: n}` shape and now means *total* (not rejected). A new `verified_counts` column (`{class_id: n}`) and `area_counts` (`{area_id: {class_id: {"total": n, "verified": n}}}`) sit beside it. Nothing existing is rewritten, and the survey timeline keeps reading `counts`. (The spec's §9.2 had proposed changing the shape in place; this way needs no data rewrite in a migration.)
2. **Site-area membership** is a box-centre point-in-polygon test in map pixels, with no polygon clipping, so no `shapely`. An area is "partly covered" when any of its vertices falls outside the map's pixel bounds.
3. **Query runs stay open to both kinds.** Assisted labelling in training projects uses them (a Plan 1 finding). The new `/runs` API is detection-only.

## Global Constraints

- `contract/openapi.yaml` is the source of truth. Only unit **C** edits it. Regenerate the client with `pnpm -C contract generate`; never hand-edit it.
- Long work is a background job with progress: run creation (the existing `infer` / `map_detect` jobs), `accept_above`, `recount`, `area_recount`, `detect_export`.
- **Bounded reads:**
  - Analytics reads only run rows (`counts`, `verified_counts`, `area_counts`) and `Source` / `GeoMap` rows. It never scans `MapDetection` or `Box`.
  - Map review loads detections for a viewport (the existing `GET /map-runs/{id}/detections` paging).
  - Lists are paginated.
- Every review write and its count increment share **one** session transaction (`with handle.session() as s:` covering both).
- The app must start when anything fails. The migration only adds nullable or defaulted columns and new tables.
- UI copy uses plain words: "photos", "map", "survey", "objects", "detections", "verified", "site area". Photo batches report **detections**, never objects. Nothing names a domain (no "machinery").
- UI uses `DESIGN.md`, the `frontend/src/ui/` primitives and token classes only. `check-tokens.mjs` must pass.
- The backend interpreter is `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`. Stage by path. Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- New detect routes use `require_kind(("detect",))` for writes and `require_kind(("detect",), ANY_KIND)` where reads should work from past detections. The route-walk test (`tests/test_project_kinds.py`) must stay green.

## Budget

- **Background jobs:** `infer` / `map_detect` (runs, now class-mapped); `accept_above` (bulk accept on a run); `recount` (rebuilds one run's counts); `area_recount` (all map runs, after an area is added, edited or deleted); `detect_export` (CSV / PDF).
- **Bounded reads:**
  - Analytics is O(surveys + areas × classes).
  - Recount uses grouped `COUNT` queries, never materialised rows. The exception is area membership, which streams `MapDetection` rows through `yield_per(5000)`.
  - PDF overview images are read from the existing map preview / thumbnails, never the full raster.

## Execution DAG

```
C (contract) ─┐
S (schema+counts+areas) ─┴─► D (sources+nav) ─┐
                            R (runs+mapping) ─┼─► merge D→R→V→A ─► E (export) ─► merge ─► X (e2e, docs) ─► main
                            V (review) ───────┤
                            A (analytics+areas)┘
```

- **Batch 1:** C and S in parallel, merged into integration (C first, then S).
- **Batch 2:** D, R, V and A in parallel, each branched from integration after batch 1.
- **Merge wave:** D → R → V → A. Then an integration check.
- **Batch 3:** E. Then merge. Then X.
- **Critical path:** S → R → merge → A → E → X.
- **Worktrees:** `.claude/worktrees/dw-<unit>` on `task/dw-<unit>`. Integration: `.claude/worktrees/dw-integration` on `task/dw-integration`, cut from `main`.

---

## Unit C — Contract

**Owns:** `contract/openapi.yaml`, `contract/client/schema.d.ts`.

- [ ] **Schema changes** (examples on each; follow the existing conventions):
  - `SourceOut` gains `kind` (`images|map`), `label` (string|null), `captured_on` (date|null), `map_id` (string|null).
  - New `SourcePatch {label?: string|null, captured_on?: date|null}`.
  - `QueryRunOut` and `MapRunOut` gain `source_id` (string|null), `model_snapshot` (object), `class_map` (object of string→string|null), `pinned` (boolean), `verified_counts` (object of string→integer). `MapRunOut` also gains `area_counts`.
  - `MapDetectionOut` gains `review_state` (`unreviewed|accepted|rejected|edited`) and `provenance_kind` (`person|local_model|cloud_provider`).
  - `SurveyOut` gains `verified_counts` (object) and `pinned` (boolean).
- [ ] **New schemas:**
  - `RunSummary {id, kind: images|map, source_id, source_label, model_id|null, model_name|null, conf, job_state, pinned, counts, verified_counts, review: {total, reviewed}, created_at}`
  - `RunSummaryPage`
  - `RunCreate {source_ids: [string] minItems 1, model_id?: string, provider?: string, query?: string, conf: number (0..1, default 0.25), tiling?: TilingSettings, target_gsd_cm?: number|null}`
  - `RunCreated {runs: [{run_id, kind, job: Job}]}`
  - `RunPatch {pinned: boolean}`
  - `UnmappedClassesError`: the error envelope with `details: {model_id, unmapped: [string]}`
  - `ModelClassMapOut {model_id, model_classes: [string], mapping: {string: string|null}, unmapped: [string]}`
  - `ModelClassMapPut {mapping: {string: string|null}, new_classes: [string]}`, where `new_classes` are model class names to add as project classes and map to themselves
  - `MapDetectionReview {detection_ids: [string] minItems 1, action: accept|reject|unreview|reclass, class_id?: string}`
  - `MapDetectionReviewResult {updated}`
  - `MapDetectionCreate {class_id, x, y, w, h, angle?}`
  - `NextUnreviewed {detection: MapDetectionOut|null, remaining: integer}`
  - `AcceptAbove {min_confidence: number 0..1}`
  - `SiteArea {id, name, polygon_wgs84: [[lon, lat]] minItems 3, created_at}`; `SiteAreaCreate {name, polygon_wgs84?: [[lon, lat]], map_id?: string, polygon_px?: [[x, y]]}` (either `polygon_wgs84`, or `map_id` + `polygon_px`, which the server converts); `SiteAreaPatch {name?, polygon_wgs84?, map_id?, polygon_px?}`; `SiteAreaList`
  - `SourceAnalytics {source: SourceOut, unit: objects|detections, image_count: integer|null, run: RunSummary|null, classes: [{class_id, name, colour, total, verified}], review: {total, reviewed}}`
  - `AreaAnalytics {areas: [{id, name}], surveys: [{map_id, map_name, captured_on, state, per_area: {area_id: {partial: boolean, counts: {class_id: {total, verified}}}}}]}`
  - `PhotoBatchAnalytics {batches: [{source: SourceOut, run: RunSummary|null, classes: [{class_id, name, colour, total, verified}]}]}`
  - `DetectExportRequest {format: csv|pdf, source_id?: string|null}`
- [ ] **New paths** (all under `/projects/{projectId}`):

| Method + path | operationId | Body | Responses |
| --- | --- | --- | --- |
| `PATCH /sources/{sourceId}` | `updateSource` | `SourcePatch` | 200 `SourceOut`, 404, 409 |
| `GET /runs` | `listRuns` | query `source_id?`, `limit?`, `cursor?` | 200 `RunSummaryPage`, 409 |
| `POST /runs` | `createRuns` | `RunCreate` | 202 `RunCreated`, 404, 409, 422 (`unmapped_classes` or validation), 503 |
| `PATCH /runs/{runId}` | `updateRun` | `RunPatch` | 200 `RunSummary`, 404, 409 |
| `POST /runs/{runId}/accept-above` | `acceptRunAbove` | `AcceptAbove` | 202 `JobRef`, 404, 409 |
| `POST /runs/{runId}/recount` | `recountRun` | — | 202 `JobRef`, 404, 409 |
| `GET /model-class-maps/{modelId}` | `getModelClassMap` | — | 200 `ModelClassMapOut`, 404, 409, 503 |
| `PUT /model-class-maps/{modelId}` | `putModelClassMap` | `ModelClassMapPut` | 200 `ModelClassMapOut`, 404, 409, 422 |
| `POST /map-runs/{runId}/review` | `reviewMapDetections` | `MapDetectionReview` | 200 `MapDetectionReviewResult`, 404, 409 |
| `POST /map-runs/{runId}/detections` | `addMapDetection` | `MapDetectionCreate` | 201 `MapDetectionOut`, 404, 409 |
| `GET /map-runs/{runId}/next-unreviewed` | `nextUnreviewedMapDetection` | query `after_id?` | 200 `NextUnreviewed`, 404 |
| `GET/POST /site-areas` | `listSiteAreas` / `createSiteArea` | `SiteAreaCreate` | 200 `SiteAreaList` / 201 `SiteArea` (+ `area_recount` started), 409 |
| `PATCH/DELETE /site-areas/{areaId}` | `updateSiteArea` / `deleteSiteArea` | `SiteAreaPatch` | 200 / 204, 404, 409 |
| `GET /analytics/sources/{sourceId}` | `getSourceAnalytics` | — | 200 `SourceAnalytics`, 404, 409 |
| `GET /analytics/areas` | `getAreaAnalytics` | query `model_id?`, `conf?`, `verified_only?` | 200 `AreaAnalytics`, 409 |
| `GET /analytics/photo-batches` | `getPhotoBatchAnalytics` | — | 200 `PhotoBatchAnalytics`, 409 |
| `POST /detect-exports` | `createDetectExport` | `DetectExportRequest` | 202 `JobRef`, 404, 409 |

- [ ] **Changed operations:**
  - `GET /survey-timeline` gains `verified_only?: boolean`.
  - `MapExportRequest` is unchanged. Its GeoPackage description gains "includes review_state, the mapped class and a site_areas layer".
  - Add error codes `unmapped_classes` (422).
- [ ] **Prism examples:** a detection project's `GET /sources` example returns one `images` source and one `map` source; `GET /runs` returns two summaries; `GET /analytics/*` return plausible data. The e2e suite depends on these.
- [ ] `pnpm -C contract check` passes. Commit.

## Unit S — Schema, counting rules, site-area geometry

**Owns:** `backend/app/db/models.py` (the additions below only), the new `backend/app/db/migrations/versions/0008_detect_workspace.py` (revision `"0008"`, down_revision `"0007"`), the new `backend/app/detect/{__init__.py,counts.py,areas.py}`, `backend/app/maps/georef.py` (add the inverse), and the tests `test_detect_counts.py`, `test_detect_areas.py` and `test_migration_0008.py`.

**Produces** (every feature unit depends on these exact names):

```python
# db/models.py
Source:       kind: str = "images" (server_default); label: str | None; captured_on: date | None
GeoMap:       source_id: str | None  (FK source.id, ondelete SET NULL)
QueryRun:     source_id: str | None; model_snapshot: dict = {}; class_map: dict = {}; pinned: bool = False
              counts: dict = {}; verified_counts: dict = {}
MapRun:       source_id: str | None; model_snapshot: dict = {}; class_map: dict = {}; pinned: bool = False
              verified_counts: dict = {}; area_counts: dict = {}
MapDetection: review_state: str = "unreviewed" (server_default); provenance_kind: str = "local_model" (server_default)
              index ix_map_detection_run_state (run_id, review_state)
class ModelClassMap(Base):  # table model_class_map
    library_model_id: str (pk); mapping: dict  # {model_class_name: project_class_id | None}; updated_at
class SiteArea(Base):       # table site_area
    id: str; name: str; polygon_wgs84: list  # [[lon, lat], ...]; created_at

# detect/counts.py
VERIFIED_STATES = ("accepted", "edited")
Entry = tuple[str, str] | None                      # (class_id, review_state); None = absent
def apply_transition(counts: dict, verified: dict, old: Entry, new: Entry) -> None
    """In place. A rejected or absent entry counts nowhere; any other state adds 1 to counts[class];
    VERIFIED_STATES also add 1 to verified[class]. Keys whose value drops to 0 are removed."""
def apply_area_transition(area_counts: dict, area_ids: list[str], old: Entry, new: Entry) -> None
    """Same rule into area_counts[area_id][class_id] = {"total": n, "verified": n}."""
def recount_query_run(s: Session, run: QueryRun) -> None     # grouped COUNT over Box where query_run_id
def recount_map_run(s: Session, run: MapRun, areas: list["ProjectedArea"]) -> None
    """counts and verified_counts by grouped COUNT; area_counts by streaming (x, y, w, h, class_id,
    review_state) with yield_per(5000) and area_ids_for_point on the box centre."""

# detect/areas.py
@dataclass(frozen=True)
class ProjectedArea: area_id: str; polygon_px: list[tuple[float, float]]; partial: bool
def project_area(gmap: GeoMap, area: SiteArea) -> ProjectedArea | None   # None when no vertex and no map corner overlap
def areas_for_map(s: Session, gmap: GeoMap) -> list[ProjectedArea]
def area_ids_for_point(areas: list[ProjectedArea], x: float, y: float) -> list[str]

# maps/georef.py
Georef.wgs84_to_pixel(lon: float | Sequence, lat: float | Sequence) -> tuple   # inverse of pixel_to_wgs84
```

**Tests first:**
- [ ] `apply_transition`: None → (c, unreviewed) gives counts +1 and verified 0. unreviewed → accepted gives verified +1. accepted → rejected gives both −1, and the key is removed at 0. Reclass (c1, accepted) → (c2, accepted) moves both.
- [ ] **Property test:** a random sequence of 200 transitions over 3 classes, applied incrementally, equals a from-scratch count (`recount_*` over the same rows in a tmp project).
- [ ] `recount_map_run` on a fixture run with detections in and out of two areas gives the expected `area_counts`.
- [ ] `Georef.wgs84_to_pixel(pixel_to_wgs84(p)) ≈ p` within 1e-6 px on the UTM fixture and the rotated-geotransform fixture (`tests/geotiffs.py`; add a rotated one if it's missing).
- [ ] `project_area`: an area inside the map → `partial False`. An area crossing the edge → `partial True`. An area elsewhere on Earth → `None`.
- [ ] Migration: a project at `0007` with an existing `MapRun` (with counts) and `MapDetection` upgrades. The detection gets `review_state == "unreviewed"`, the run keeps its counts, and a new source defaults to `kind == "images"`.
- [ ] **Gate:** the backend gate is fully green, apart from `test_contract.py` failures caused by C's new paths, which is expected until D/R/V/A/E merge. List them.

---

## Unit D — Sources and detection navigation

**Owns:**
- Backend: `datasets/router.py` (`PATCH /sources/{id}` and the `SourceOut` fields), `datasets/importer.py` (`captured_on` = earliest `capture_time` date when the import finishes, if unset), `maps/service.py::create_map` and `maps/jobs_import.py` (create the linked `Source(kind="map", label=<map name>)` and set `GeoMap.source_id`; keep `Source.captured_on` equal to `GeoMap.captured_on`, including in `set_captured_on`), and `test_detect_sources.py`.
- Frontend: `app/pipeline.ts`, `app/Sidebar.tsx`, `routes.tsx`, `app/Header.tsx`, the new `screens/SourcesScreen.tsx` and `sources/**`, and `api/sources.ts`.

**Behaviour:**
- **Data rules:**
  - A photo source posted to a detection project gets `kind="images"`. A map import creates `kind="map"`.
  - `PATCH /sources/{id}` with `captured_on` on a map source also writes `GeoMap.captured_on`. Both stay equal.
  - Existing sources keep `kind="images"`. Existing maps have `source_id NULL` and show under Sources as "Maps", backed by the map row. For them, `SourcesScreen` lists `GET /maps` rows that have no source.
- **Detection navigation:** `DETECT_STEPS = ["sources", "runs", "review", "analytics", "export"]`.
  - Paths: sources → `sources`, runs → `runs`, review → `review`, analytics → `analytics`.
  - Lock rules: runs is locked with "Add photos or a map first" while there are no sources and no maps. Review and analytics are locked with "Run a model first" while there are no runs.
  - Below the divider: **Site areas** (`/p/:id/site-areas`), then Project settings. **Surveys** is removed from the sidebar; its route `/p/:id/surveys` redirects to `/p/:id/analytics`.
- **Routes (detection):**
  - `sources` → `SourcesScreen`
  - `runs` → `RunsScreen` (from `@/screens/RunsScreen`, unit R)
  - `review` → the existing `ReviewScreen`, which branches on kind; unit V adds the detection branch
  - `analytics` → `AnalyticsScreen` (unit A)
  - `site-areas` → `SiteAreasScreen` (unit A)
  - `maps/:mapId` → the existing `MapsScreen` viewer
  - `query` and `maps` (the list) are no longer steps in detection projects. Their routes remain for Past detections.

  D imports the R and A screens by these exact paths, and D's build fails only on those until merge. Report it.
- **SourcesScreen:**
  - One list of all sources, newest survey first: label, kind pill ("Photos" / "Map"), survey date with an inline edit (or "date not set"), image count or map size, and the latest run summary.
  - Actions: "Add photos" (the existing folder-import flow, `POST /sources`) and "Add a map" (the existing `ImportMapDialog`).
  - Row actions: "Run a model", which navigates to `/p/:id/runs?source=<id>`, and, for maps, "Open map".

**Tests first:** the PATCH keeps the map date in sync; image import sets `captured_on` from EXIF; a map import creates a map source; pipeline `stepStates` for detection; the Sidebar shows Sources, Runs, Review, Analytics, Export and Site areas; SourcesScreen renders both kinds and the date edit sends `PATCH`.

## Unit R — Runs and class mapping

**Owns:**
- Backend: the new `backend/app/detect/{runs.py,class_maps.py,router.py}`, which is included in `api.py` with `require_kind(("detect",))` for writes. `inference/jobs.py` and `maps/jobs_detect.py` change **only** to apply `run.class_map` (when non-empty) instead of `build_class_map`, to call `recount_query_run` / `recount_map_run` at job end (replacing `jobs_detect.py`'s counts block), and to fill `model_snapshot`. `maps/timeline.py` and `maps/service.py::timeline_rows` gain a pinned override and `verified_only`. Tests: `test_detect_runs.py`, `test_class_maps.py`.
- Frontend: the new `screens/RunsScreen.tsx`, `runs/**` (`RunDialog`, `ClassMappingStep`, `RunTable`), `api/runs.ts`, and the `maps/NewRunDialog.tsx` retirement (detection projects use `RunDialog`).

**Behaviour:**
1. **`class_maps.resolve(handle, lib_model) -> (mapping, unmapped)`.** The order is:
   - The project's `ModelClassMap` row, if present.
   - Otherwise an exact name match against project classes.
   - Then `lib_model.class_aliases` values that name a project class.
   - If the project has **no classes**, the first run seeds the project class list from the model's `class_names` (colours from the existing palette) and maps them all.
2. **`POST /runs`:**
   - Validate the model (`require_ready`; `503` if the library is down) and resolve the mapping.
   - If anything is unmapped and not present in a stored `ModelClassMap` → `422 unmapped_classes {model_id, unmapped}`, **before** any job is queued.
   - Otherwise, per source: an `images` source → a `QueryRun` over that source's image ids (the existing `infer` job, with tiling defaults from the project), and a `map` source → a `MapRun` (the existing `map_detect` job, `target_gsd_cm` defaulting to the model's `train_gsd_cm`).
   - Each run sets `source_id`, `model_snapshot={id, name, task, format, class_names, origin}` and `class_map`.
   - Cloud-provider runs (`provider` and `query`) skip mapping, as today.
3. **`GET/PUT /model-class-maps/{modelId}`:** `PUT` validates that every mapped id is a project class. `new_classes` appends project classes (unique names) and maps each to itself.
4. **`GET /runs`:** union both tables, ordered by `created_at desc, id desc`, with a cursor; `review.total` and `review.reviewed` come from grouped counts. **`PATCH /runs/{id}`:** `pinned=true` unpins the other runs of that source in the same transaction.
5. **Timeline:** `_pick` prefers a pinned run for the map, then the basis rule. `verified_only=true` builds `counts` from `verified_counts`.
6. **`POST /runs/{id}/recount`:** the `recount` job, using S's functions.
7. **RunsScreen:**
   - `RunTable` over `GET /runs`: source, model, confidence, state, counts as total (verified), review progress, and a pin toggle.
   - "New run" opens `RunDialog`: sources (multi-select, preselected from `?source=`), a model picker (library, filtered by task, showing classes and training GSD, with a >2× GSD warning for maps), confidence, and tiling or target GSD.
   - On `422 unmapped_classes` it shows `ClassMappingStep`, one row per unmapped class: Select a project class, "Add as a new class", or "Ignore". It then `PUT`s the mapping and retries the `POST`.

**Tests first:**
- [ ] The first run in an empty project seeds the classes.
- [ ] `422` lists the unmapped classes and no job row exists.
- [ ] After `PUT` the same `POST` succeeds, and the run's `class_map` is stored.
- [ ] An ignored class's detections aren't written.
- [ ] Pinning unpins the source's other runs.
- [ ] The timeline prefers pinned, and `verified_only` uses `verified_counts`.
- [ ] The runs list is a union across both tables.
- [ ] The frontend dialog goes through the mapping step and retries.

## Unit V — Review

**Owns:**
- Backend: the new `backend/app/detect/review.py` and its routes in a new `backend/app/detect/review_router.py`, which covers `/map-runs/{id}/review`, `/map-runs/{id}/detections` POST, `/map-runs/{id}/next-unreviewed` and `/runs/{id}/accept-above`, plus the `accept_above` job. `datasets/boxes.py` changes **only** so `review_boxes`, box create, delete and reclass apply `apply_transition` to the box's `QueryRun` (when `query_run_id` is set) in the same session. `maps/schemas.py`' `MapDetectionOut` gains its fields. Tests: `test_detect_review.py`.
- Frontend: `screens/ReviewScreen.tsx` (the detection branch), the new `review/DetectReview.tsx`, `maps/MapReviewPanel.tsx`, and the review mode in `MapsScreen` (a `mode="review"` query param); `api/review.ts`.

**Behaviour:**
- **Map review:**
  - For each detection, update `review_state` (reclass sets `class_id` and state `edited`), then `apply_transition` on the run's `counts` / `verified_counts`, and `apply_area_transition` with `area_ids_for_point` (from `areas_for_map`) on `area_counts`, all in one transaction.
  - A person-drawn detection is created with `provenance_kind="person"` and `review_state="accepted"`.
  - `next-unreviewed` returns the next unreviewed detection ordered by `(y, x)` after `after_id`, plus a count of what remains.
- **Accept above:** the `accept_above` job, in batches of 1000 ids per transaction, applies the same transitions and reports progress. For query runs it goes through `review_boxes`.
- **Detection review screen:**
  - Pick a source; its chosen run is the pinned one, else the newest.
  - A photo source uses the existing image review table filtered to `query_run_id`.
  - A map source opens the map viewer in review mode: `MapReviewPanel` with A accept, R reject, 1–9 reclass, N next (keyboard, shown with `Kbd`), a "Draw missed object" tool, and "Accept all at or above [0.80]".
  - Progress: "412 of 530 reviewed".

**Tests first:**
- [ ] Accept, reject and reclass update `review_state`, `counts`, `verified_counts` and `area_counts` exactly like a recount.
- [ ] A person detection counts as verified.
- [ ] `next-unreviewed` walks every pending detection once.
- [ ] `accept-above` is a job whose result matches a recount.
- [ ] Box review in a photo run updates `QueryRun.counts`.
- [ ] Frontend: the keyboard handlers send the right actions; the progress text.

## Unit A — Site areas and analytics

**Owns:**
- Backend: the new `backend/app/detect/{site_areas.py,analytics.py,analytics_router.py}` and the `area_recount` job. Tests: `test_site_areas.py`, `test_detect_analytics.py`.
- Frontend: the new `screens/AnalyticsScreen.tsx`, `screens/SiteAreasScreen.tsx`, `analytics/**`, `api/analytics.ts`, `api/siteAreas.ts`, and a site-area drawing layer for the map viewer (`maps/siteAreaLayer.ts`; the viewer mounts it in both normal and review mode). It reuses `surveys/SurveyChart.tsx`, `SurveyTable.tsx` and `chartPoints.ts` as they are, extending them for `verified_counts` if needed.

**Behaviour:**
- **Site area CRUD.**
  - It validates at least 3 points and finite lon/lat.
  - It stores WGS84.
  - Every create, update and delete submits one `area_recount` job, which calls `recount_map_run` for every `MapRun` with `areas_for_map`.
- **`analytics.source(handle, source_id)`:**
  - It picks the chosen run: for maps, the timeline rule plus pin; for photos, pinned else newest.
  - It returns class totals and verified counts from the run row.
  - `unit` is `objects` for maps and `detections` for photos.
- **`analytics.areas(handle, basis, verified_only)`:** per survey (from `build_timeline`), the run's `area_counts` plus `partial` from `project_area`. It returns surveys in timeline order and never touches detections.
- **`analytics.photo_batches`:** one row per images source.
- **AnalyticsScreen**, in four sections:
  1. **Surveys:** the existing chart and table, a verified-only `Switch`, and cells showing "6 (4 verified)".
  2. **Per source:** a `Select` of the source, and a class table showing total (verified) with the model, confidence, date and review progress.
  3. **Per site area:** an area × class table for the selected survey, plus a per-area trend. The per-area trend reuses `SurveyChart` with the area's counts.
  4. **Photo batches**, headed "Detections in photos (not object counts: the same object appears in several photos)".
- **SiteAreasScreen:** a list of areas with rename and delete. "Draw an area" opens the map viewer on the chosen map with the drawing layer. The drawn pixel polygon is sent as `map_id` + `polygon_px`, and the server converts it with `Georef.pixel_to_wgs84` (both shapes are in unit C's `SiteAreaCreate`).

**Tests first:**
- [ ] Area CRUD and validation.
- [ ] `area_recount` fills `area_counts` for every map.
- [ ] Source analytics gives `detections` for photos and `objects` for maps.
- [ ] Area analytics marks `partial`.
- [ ] Analytics issues no query against `map_detection`: assert through a SQLAlchemy `before_cursor_execute` listener.
- [ ] Frontend: the four sections render from mock data; the verified-only toggle changes the numbers; the photo-batch caption is present.

## Merge wave (serialized, `dw-integration`)

Merge the branches in the order **D → R → V → A**, with `git merge --no-ff`. After each merge, run the gates for the side the branch touched.

Known overlaps and how to resolve them:
- `routes.tsx` and `Sidebar.tsx`: D owns them.
- `MapsScreen.tsx`: V adds the review mode, A adds the area layer. Keep both.
- `api.py`: R and V both include routers. Keep both, each guarded.
- `maps/jobs_detect.py`: only R touches it.
- The `SiteAreaCreate` shape: see unit A.

After A, the backend gate must be fully green except `test_contract.py` for `/detect-exports`, which E owns. Record that exception.

## Unit E — Export

**Owns:** the new `backend/app/detect/{export_csv.py,export_pdf.py,export_job.py}` and the `/detect-exports` route; `maps/jobs_export.py` and `maps/geo_out.py` / `gpkg.py` (a GeoPackage `review_state`, mapped class name and a `site_areas` layer); `backend/requirements.txt` + `requirements-lock.txt` (add `reportlab`, pinned the way the lock file pins others; read how it's produced); `backend/kestrel_backend.spec` (add reportlab to the hidden imports or data if PyInstaller needs it); the frontend `screens/ExportScreen.tsx` detection branch, `exports/DetectExportForm.tsx` and `api/detectExports.ts`; tests `test_detect_export.py`.

**Behaviour:**
- **CSV:** `detect-<project-slug>-<date>.csv`, one row per source × class × area (area empty = whole source). The columns are `survey_date, source, source_kind, unit, model, confidence, class, area, total, verified`.
- **PDF:** reportlab platypus, A4, one per source (`detect-<source-slug>.pdf`).
  - Header: project, source, date, model and origin, confidence, review progress.
  - An overview image: the map preview or a 3×3 contact sheet of photo thumbnails, via Pillow.
  - A class table and a site-area table.
  - A method footnote, e.g. "Counts are objects on the orthomosaic detected by <model> at confidence ≥ <c>; verified means a person accepted or drew it". For photos: "Counts are detections across N photos; the same object can appear in several photos."
- **Delivery:** both are written by the `detect_export` job under `exports/` like results exports, and are listed and revealed by the existing exports UI.

**Tests first:**
- [ ] The CSV rows for a fixture project.
- [ ] The PDF is created, is non-empty, and opens with `reportlab`'s reader or starts with `%PDF`; its text contains the class names and the verified numbers (extract via `pypdf` only if it's already present, otherwise assert on the platypus story).
- [ ] The GeoPackage has a `site_areas` layer and a `review_state` column.
- [ ] The frontend form posts the right body.

## Unit X — End-to-end, docs, landing

- [ ] **e2e** (Prism plus `page.route`):
  - `sources.spec.ts`: both kinds are listed, and a date edit.
  - `runs.spec.ts`: a new run hits a 422 mapping step, then the retry succeeds.
  - `detect-review.spec.ts`: map review shortcuts.
  - `analytics.spec.ts`: the verified toggle and the photo caption.
  - `detect-export.spec.ts`.
  - Fix any Plan 1 spec that asserted the old detection steps.
- [ ] **Backend flow test** (`test_detect_flow.py`): a detection project → an images source and a map source (fixtures) → a run with the fake provider → review → analytics numbers equal a recount → a CSV export.
- [ ] **Docs:** a `docs/progress.md` ledger entry; `docs/usability/2026-09-23-detection-workspace-walkthrough.md` (numbered steps); an ADR in `vault/decisions/` titled "Counts live on run rows; review increments them in the same transaction"; and a note on the reportlab addition in `CONTRIBUTING.md` if packaging changed.
- [ ] **Full gate**, with e2e on free ports.
- [ ] Land with `scripts/finish-task.ps1` from `dw-integration`, check the main checkout first, then clean up the `dw-*` worktrees using the junction rule.
