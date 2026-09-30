# Reports (sub-project R): execution index

> **For agentic workers:** this is the coordinator's map of the Reports unit plans. Each unit is
> executed with superpowers:subagent-driven-development in its own worktree. Read the unit plan you
> were given, this index, the spec and the programme rulings. Do not execute this index itself.

**Spec:** `docs/superpowers/specs/2026-09-26-reports-design.md` (umbrella:
`2026-09-26-inspection-platform-design.md`). Written against `main` at `07beeac` (I, M and C all
merged; project migration head `0013`, catalogue head `0001`).
**Binding rulings:** `.superpowers/sdd/imc-common/programme-rulings.md` (R1–R10), with R2 naming
applied as below. They win over the spec. **This index's "Interface decisions" section wins over
each unit plan where they differ** (it is what lets the plans be written in parallel).

**Goal:** land the Reports tab on `main`: the list, the builder with a live preview, templates, the
`report_render` job producing immutable numbered versions (PDF, optional CSV/XLSX), the snapshot
engine, and Data exports absorbing `ExportScreen`.

## Unit plans

| Unit | Plan | Worktree / branch | e2e ports | Cut after |
| --- | --- | --- | --- | --- |
| R0 contract, both migrations, ORM, pydantic schemas, 501 stubs, `report_render` job type name | `2026-09-30-reports-r0.md` | `r-r0` / `task/r-r0` | 5650–5659 | `main` now |
| R4 PDF renderer: theme fixture, fonts, canvas, cover, block → flowable, charts, bookmarks, parts, `reports-selftest` | `2026-09-30-reports-r4.md` | `r-r4` / `task/r-r4` | 5670–5679 | `main` now (tasks that import `app.reports.schemas` wait for R0) |
| R3 snapshot engine: `SnapshotSpec` rendering, keys, cache, semaphore, endpoint; `image_crop` (all of I's shapes), `map`, `elevation`, `pair`, `volume_plan`, placeholders | `2026-09-30-reports-r3.md` | `r-r3` / `task/r-r3` | 5660–5669 | `main` now (the endpoint and schema imports wait for R0) |
| R8 Data exports fold-in | `2026-09-30-reports-r8.md` | `r-r8` / `task/r-r8` | 5680–5689 | `main` now |
| R1 storage services + CRUD: reports, templates (catalogue + built-in fallback), logo assets, `POST /open` | `2026-09-30-reports-r1.md` | `r-r1` / `task/r-r1` | 5690–5699 | R0 |
| R2 compose core: config validation, filters → SQL, observed date, baseline + deltas, `ReportDocument`, composers `cover`/`summary`/`findings_table`/`appendix`, `finding_pages` skeleton, stubs for the R9 sections, outline + blocks endpoints | `2026-09-30-reports-r2.md` | `r-r2` / `task/r-r2` | 5700–5709 | R0 |
| R6 preview: `printTheme.ts`, `api/reports.ts`, `preview/blocks/*`, `ReportPreview` | `2026-09-30-reports-r6.md` | `r-r6` / `task/r-r6` | 5710–5719 | R0 |
| R5 render job + versions: `report_render`, phases/progress/cancel, partial folder + promote, versions/issue/delete/document endpoints, CSV/XLSX writers, sweep | `2026-09-30-reports-r5.md` | `r-r5` / `task/r-r5` | 5720–5729 | R1, R2, R3, R4 |
| R7 builder UI: `ReportsTab`, list, builder, sections, settings, filters, history, templates | `2026-09-30-reports-r7.md` | `r-r7` / `task/r-r7` | 5730–5739 | R1, R6, R8 |
| R9-I image figures in finding pages, photos, comments | `2026-09-30-reports-r9i.md` | `r-r9i` / `task/r-r9i` | 5740–5749 | R2, R3 |
| R9-M map figures in finding pages, `measurements`, `comparison`, `object_counts` sections | `2026-09-30-reports-r9m.md` | `r-r9m` / `task/r-r9m` | 5750–5759 | R2, R3 |
| R9-C 3D views: `view3d` snapshot passthrough, cloud figures for findings and measurements, fallbacks, stale warning | `2026-09-30-reports-r9c.md` | `r-r9c` / `task/r-r9c` | 5760–5769 | R2, R3 |
| R10 evidence: the four e2e flows, walkthrough, ADRs, progress entry. **R-X** (coordinator's close-out) in the same file | `2026-09-30-reports-r10.md` | `r-r10` / `task/r-r10`; `r-x` / `task/r-x` | 5770–5779; 5780–5789 | every unit above; R-X after R10 |

## Execution DAG, batches and merge order

All of R's dependencies (F, I, M, C) are on `main`, so the spec's "as each sibling merges" gates are
gone. Because every sibling is merged, **R0 is one contract unit for all of §14** (the spec's
R0a/b/c split existed only to wait for siblings). Units in the same batch build concurrently;
merges into `main` are serialized by the coordinator (`merge-batch.sh`).

```
batch 0:  R0 ─┬───────────────────────────────┐
          R4 ─┼─(waits R0 for schema tasks)───┤
          R3 ─┼─(waits R0 for endpoint)───────┤
          R8 ─┘                               │
batch 1:  (cut after R0)  R1 ∥ R2 ∥ R6        │
batch 2:  R5 (after R1,R2,R3,R4) ∥ R7 (after R1,R6,R8) ∥ R9-I ∥ R9-M ∥ R9-C (after R2,R3)
batch 3:  R10  →  R-X
```

Merge order inside a batch: **batch 0:** R0 first (everything else consumes it), then R8, R3, R4 in
the order they are ready. **Batch 1:** R2, R1, R6 in the order ready. **Batch 2:** R9-I, R9-C, R9-M,
R5, R7 in the order ready; R9 units touch only their own modules, so they do not depend on R5.
**Batch 3:** R10, then R-X.

**Critical path:** R0 → R2 → R9-M (comparison + counts + measurements: the largest R9) → R10 → R-X.
**Near-critical:** R0 → R2 → R5 → R10 (R5 also needs R4, which starts at once and should be ready
before R2). R7 is the largest frontend unit; it is off the critical path only if R6 merges early.

## Interface decisions (binding; the unit plans implement these names)

### Backend package `backend/app/reports/`

| Module | Owner | Provides |
| --- | --- | --- |
| `schemas.py` | R0 | pydantic v2 models for every §14 schema: `ReportConfig` (`cover`, `paper`, `filters: ReportFilters`, `sections: list[ReportSection]`), `SectionKey` (`cover, summary, findings_table, finding_pages, measurements, comparison, object_counts, appendix`), per-section options models, `Block` (discriminated union on `kind`), `SnapshotSpec` (discriminated union on `kind`), `SnapshotRef`, `ReportDocument`, `ReportSectionDoc` (`key, title, blocks`), `ReportOutline`, `OutlineSection`, `DeltaSummary`, `ReportWarning`, `Report`, `ReportListItem`, `ReportPage`, `ReportVersion`, `ReportFile`, `ReportTemplate`, `ReportAsset`, `RenderRequest`, `BlockPage` |
| `models.py` | R0 | SQLAlchemy ORM: `Report`, `ReportVersion`, `ReportVersionFinding`, `ReportAsset` (project DB) |
| `app/catalogue/…` ORM row `ReportTemplate` | R0 | in the catalogue's models module, next to the existing catalogue tables |
| `db/migrations/versions/0014_reports.py` | R0 | `down_revision = "0013"` |
| `catalogue/migrations/versions/0002_report_templates.py` | R0 | seeds the 4 built-ins from a literal copy of `templates/builtins.py` data |
| `templates/builtins.py` | R0 | `BUILTIN_TEMPLATES: list[ReportTemplate]` with fixed ids `builtin-full`, `builtin-findings-summary`, `builtin-survey-counts`, `builtin-volumes` |
| `router.py` | R0 | aggregating `APIRouter` that includes the per-owner route modules below; registered in `app/api.py` in one guarded `try/except` block |
| `routes_reports.py`, `routes_templates.py`, `routes_assets.py`, `routes_open.py` | R0 stubs (501) → **R1** replaces | reports CRUD + duplicate; templates CRUD; `POST report-assets`; `POST /projects/{id}/open` |
| `routes_outline.py` | R0 stubs → **R2** | `GET …/outline`, `GET …/sections/{key}/blocks` |
| `routes_snapshots.py` | R0 stub → **R3** | `GET /projects/{id}/report-snapshots/{key}?spec=` |
| `routes_versions.py` | R0 stubs → **R5** | renders, versions list/detail/PATCH/DELETE, `…/versions/{n}/document` |
| `service.py`, `templates/service.py`, `assets.py`, `open_file.py` | R1 | `get_report(handle, rid)`, `update_config(...)`, template CRUD with 503 `catalogue_unavailable` fallback to built-ins |
| `filters.py`, `observed.py`, `baseline.py`, `compose.py`, `outline.py` | R2 | `compose(handle, config, *, report_id, baseline, generated_at) -> ReportDocument`; `ComposeContext`; `SECTION_COMPOSERS: dict[SectionKey, Callable[[ComposeContext], ReportSectionDoc]]`; `iter_findings(ctx, order) -> Iterator[FindingRow]` (keyset pages of 200); `resolve_baseline(handle, report_id)`; `deltas(...) -> DeltaSummary` |
| `sections/cover.py`, `summary.py`, `findings_table.py`, `appendix.py` | R2 | the four composers |
| `sections/finding_pages.py` | R2 | the per-finding `finding` block (head, kv, note) calling the figure/photo/comment hooks below |
| `figures/image.py` | R2 stub → **R9-I** | `finding_figures(ctx, finding) -> list[Figure]`; `photos(ctx, finding, max_n) -> list[Figure]`; `comments(ctx, finding, mode) -> list[Comment]` |
| `figures/map.py` | R2 stub → **R9-M** | `finding_figures(ctx, finding) -> list[Figure]` |
| `figures/cloud.py` | R2 stub → **R9-C** | `finding_figures(ctx, finding) -> list[Figure]`; `measurement_figure(ctx, row) -> Figure` |
| `sections/measurements.py`, `sections/comparison.py`, `sections/object_counts.py` | R2 stubs (a section with a "No data" para) → **R9-M** | the three composers |
| `snapshots/__init__.py`, `snapshots/keys.py`, `snapshots/cache.py`, `snapshots/render.py` | R3 | `RENDERER_VERSION`; `snapshot_key(handle, spec) -> str`; `render_to_cache(handle, spec) -> Path` (uses `Semaphore(2)`, writes JPEG q85 4:2:0, returns the cached path; placeholder on failure); `prune(handle, cap_bytes=1<<30)`; `RENDERERS: dict[kind, fn]` |
| `snapshots/image_crop.py`, `map_view.py` (map, elevation, pair), `volume_plan.py`, `placeholder.py` | R3 | the renderers; image crop handles `box`, `rbox`, `polygon`, `point` (I is merged) |
| `snapshots/attachment.py` | R3 stub → **R9-I** | renders a finding attachment (photo) at print size |
| `snapshots/view3d.py` | R3 stub → **R9-C** | passthrough of C's stored view via `app.pointclouds.views.stored_view(handle, subject_kind, subject_id)` |
| `theme.py` + `contract/fixtures/report-theme.json` | R4 | colours and sizes, parity-tested |
| `pdf/fonts.py`, `pdf/canvas.py`, `pdf/styles.py`, `pdf/flowables.py`, `pdf/charts.py`, `pdf/document.py` | R4 | `render_pdf(doc: ReportDocument, out_dir: Path, base_name: str, *, snapshot_path: Callable[[SnapshotRef], Path], volume_flowables: Callable[[VolumeBlock], list] | None, progress: Callable[[float], None], check_cancelled: Callable[[], None], part_budget: int = PART_BUDGET) -> list[PdfPart]` where `PdfPart = {name, path, pages, bytes, sha256}` |
| `selftest.py` + `reports-selftest` in `app/__main__.py` | R4 | fonts, gradient, JPEG passthrough, `Drawing` chart, write-only XLSX |
| `render_job.py`, `versions.py`, `writers/csv_out.py`, `writers/xlsx_out.py` | R5 | `register_job_type("report_render")`, the job, version allocation on promote, `report_version_finding` rows |

### Block kinds (R0 pins them in the contract; R2/R9 produce; R4 and R6 render)

`heading{level,text}`, `para{text,style}`, `kv{rows}`, `kpis{items}`, `table{columns,rows,repeat_header}`,
`figure{snapshot: SnapshotRef, caption, width_mm, height_mm}`, `figure_row{figures}`,
`chart{chart: bar|stacked_bar|line, series, x_labels, unit}` (field named `chart`, since `kind` is
the discriminator), `finding{finding_id, number, head{type_name, type_colour, severity_level?, severity_name?, severity_colour?, status}, figures, kv, note, photos, comments[{author, text, created_at}]}`,
`page_break{}`, and one addition to the spec: **`volume{measurement_id, title, rows, figure?, stale}`**.
The preview (R6) renders `volume` as a kv table plus its figure; the PDF (R4) renders it through the
injected `volume_flowables` hook, which R5 wires to `volumes.report_pdf.measurement_flowables`
(R4 adds that public name as the renamed `_measurement`). Without the hook R4 renders the generic
kv + figure form.

### SnapshotSpec kinds (R0 pins; R3 renders)

`image_crop`, `map`, `elevation`, `pair`, `view3d`, `volume_plan` as in spec §9.1, plus one
addition: **`attachment{finding_id, attachment_id, out}`** (R9-I renders photos through the cache
like every other figure, so the PDF embeds a print-size JPEG, never the original). A `SnapshotRef`
carries `{key, spec, width_px, height_px, missing_reason?}`. The preview URL is
`/projects/{id}/report-snapshots/{key}?spec=<base64url(canonical JSON)>`; the canonical JSON is
`json.dumps(spec, sort_keys=True, separators=(",", ":"))` on the backend and a sorted-key
stringify in `frontend/src/api/reports.ts` (R6), parity-tested by a fixture
`contract/fixtures/report-snapshot-keys.json` (R3 writes it).

### Frontend

| Path | Owner |
| --- | --- |
| `frontend/src/api/reports.ts` (every reports query/mutation hook over the generated client, and `snapshotUrl(projectId, ref)`) | R6 creates; R7 may add hooks |
| `frontend/src/reports/printTheme.ts` (+ parity test with `report-theme.json`) | R6 |
| `frontend/src/reports/preview/blocks/*.tsx`, `ReportPreview.tsx` (props: `projectId`, `outline`, `loadBlocks(key, cursor)`, `pageCount?`) | R6 |
| `ReportsTab.tsx`, `ReportList.tsx`, `NewReportDialog.tsx`, `ReportBuilder.tsx`, `SectionList.tsx`, `ReportSettings.tsx`, `ReportFilters.tsx`, `ReportHistory.tsx`, `SaveTemplateDialog.tsx` | R7 (deletes `ReportsPlaceholder.tsx`) |
| `frontend/src/exports/DataExportsPanel.tsx`; route `reports/exports`; `/p/:id/export` redirect; `EXPORT_TYPES` gains `volume_export`, `pointcloud_export`; detect PDF removed from the UI with a "Create a Survey count report" link to `/p/:id/reports?new=builtin-survey-counts` | R8 (R7 wraps the panel in `ReportsTab`'s `Segmented` and honours `?new=`) |

## Budget (spec §15; every unit plan restates its share)

**Background jobs:** `report_render` only (R5): compose 5 %, snapshots 55 % per figure, PDF 35 % per
flowable (`afterFlowable`), tables 5 %; cancel between figures, flowables and parts. Logo import is
small and synchronous, refused above 20 MB (R1). The snapshot endpoint renders synchronously on a
miss, bounded like a tile (R3).

**Bounded reads:** every list pages (reports, versions, blocks ≤ 50, templates). Outline and KPIs are
SQL aggregates (R2). Compose iterates findings in keyset pages of 200 and never holds all ORM rows
(R2, R9). A snapshot reads at most one source image (JPEG-draft reduced), one decimated window
≤ 1200×900 (a swipe: two), or one stored PNG (R3, R9-C). Renders capped at 2 concurrent; the
preview requests only visible figures (R6). Job peak is one PDF part (`PART_BUDGET = 160 MB` of
embedded JPEG) plus one decoded image (R4, R5). Snapshot cache capped at 1 GB, LRU (R3).

## Shared-file touches (outside `backend/app/reports/`, `frontend/src/reports/`)

| File | Unit | Anchor | What |
| --- | --- | --- | --- |
| `contract/openapi.yaml`, `contract/client/schema.d.ts` | R0 | tag `reports`; `JobType` enum; `DetectExportRequest` | every §14 path and schema; `report_render` job type; `deprecated: true` on detect `format: pdf` |
| `backend/app/api.py` | R0 | after the detect-export guarded block | one guarded `include_router(app.reports.router)` block |
| `backend/tests/test_contract.py` `EXPECTED_STUBS` | R0 adds; R1, R2, R3, R5 each delete their own lines | the reports group | list-ish, `resolve_lists.py` merges it |
| `backend/app/db/migrations/versions/0014_reports.py`, `catalogue/migrations/versions/0002_report_templates.py`, catalogue ORM module | R0 | — | new files / one added class |
| frontend job label map(s) | R0 | the `JobType` label record | one entry `report_render: "Report"` |
| `backend/app/volumes/report_pdf.py` | R4 | `_measurement` | public alias `measurement_flowables`; existing tests unchanged |
| `backend/kestrel_backend.spec` | R4 | `datas` | the TTF fonts; hiddenimports for `app.reports` if needed |
| `backend/scripts/smoke_frozen.ps1` | R4 | after `volumes-selftest` | `reports-selftest`, expects `reports ok` |
| `backend/app/__main__.py` | R4 | the selftest dispatch | `reports-selftest` |
| `backend/app/exports/job.py` | R8 (`FORMAT_LABEL["html"]`), R5 (`sweep_partial_exports` gains `reports/<rid>/`) | named lines | different batches |
| `frontend/src/routes/projectRoutes.tsx` | R8 (`export` redirect, `reports/exports`), R7 (`reports`, `reports/:reportId`) | the `reports` / `export` lines | different batches |
| `frontend/src/exports/*`, `frontend/src/screens/ExportScreen.tsx` | R8 | — | panel moves; old screen deleted, tests re-pointed |
| `frontend/src/ui/*` | any | — | **add-only**; a new primitive is named in the plan that adds it |
| `docs/progress.md`, `vault/decisions/*` | R10, R-X | — | evidence and ADRs |

## Rules while Reports is in flight

- The **merged contract wins** over a plan written before it (unit-controller brief). A unit that
  genuinely needs a contract change makes the minimal edit, regenerates `schema.d.ts`, and lists it
  as a hand-off.
- No unit edits another unit's module in the tables above; the stub → owner pattern exists so that
  batch-2 units never share a file.
- UI units (R6, R7, R8) load the design skills with `DESIGN.md` and use only `frontend/src/ui/`
  primitives; `check-tokens.mjs` stays green; motion uses F's tokens and honours reduced motion.
- e2e ports: each unit uses only its block above. No wall-clock budgets in the normal e2e suite
  (perf config or `E2E_FRAME_BUDGET=1` only). e2e waits on real ready signals, never on timers.
- reportlab and openpyxl are imported inside functions (job, selftest, renderer entry), never at
  module import of a router.
- Full suites only in a unit's final gate task; per-task steps run focused tests.

## Coordinator rulings

1. **One R0.** All §14 endpoints are contracted at once (siblings are merged).
2. **`volume` block and `attachment` snapshot kind** are added to the spec's lists (above).
3. **Stub → owner modules** (above) replace the spec's single `sections/` and router files so batch-2
   units never touch the same file.
4. **R3 handles I's annotation shapes directly** (I is merged); R9-I is figures + photos + comments.
5. **R9 units do not wait on R5.** They produce blocks; R4 renders every block kind generically.
6. **Measurements section is R9-M's** (every kind, from M's union `app.measurements.union.list_page`);
   cloud rows take their figure from `figures/cloud.measurement_figure` (R9-C), stubbed by R2.
7. **R8 → R7 hand-off by URL:** R8's "Create a Survey count report" navigates to
   `/p/:id/reports?new=builtin-survey-counts`; R7's list opens `NewReportDialog` preselected.
8. **Versions endpoints are R5's** (the spec gives R1 "report, template and asset endpoints").
9. **Worktree names** are `r-<unit>` with the unit id lower-cased (`r-r0`, `r-r9m`), plan files
   `2026-09-30-reports-<unit>.md` (`-r9i`, `-r9m`, `-r9c`).

## Unit R10 and R-X: evidence and close-out (R9 of the programme rulings)

R10 writes the spec §17 e2e flows 1–4, the operator walkthrough, the ADRs (fonts in the frozen
sidecar, superseding the "Helvetica only" consequence; reports use reportlab, not WebView2 print)
and the `docs/progress.md` entry. R-X (coordinator) runs the full gate, freezes the sidecar, runs
`smoke_frozen.ps1` (with `reports ok`), `cargo test`, `check:webview`, builds one installer (built,
not installed), writes the combined walkthrough and runs `/wrapup`.

## Reconciliation log (2026-09-30)

Binding on every controller; where a plan still says otherwise, this log wins.

1. **Block list amended:** R0 adds a `cover` block (shape as in the R2 and R4 plans: title, subtitle,
   rows, `logo {asset_id, path (project-relative), width_px, height_px}` or null, `locator` figure or
   null). `ReportDocument` gains `paper {size, orientation}`; R4 uses it instead of hard-coded A4, R6
   sizes sheets from it.
2. **Logo read endpoint:** R0 contracts `GET /projects/{projectId}/report-assets/{assetId}`
   (`getReportAsset`, image/png, immutable) as a stub in `routes_assets.py`. **R1 implements it**
   (14 operations, not 13). **R6 renders the cover logo** from it (the R6 plan predates this).
3. **R2's names are the ones R5/R9 already assumed:** `ComposeContext(handle=, config=, report_id=,
   baseline=, generated_at=)`, `ctx.warn(code, message, *, count=None, link=None)`, `FindingRow.from_finding`,
   `iter_findings(ctx, "number")`, `resolve_baseline(...).version_id`, section stubs `compose(ctx)`.
   R5 uses `compose_in(ctx)` to read warnings.
4. **R5 reuses R2's `observed.py`** (`observed_day`, `host_label`, `area_m2`) for CSV/XLSX columns
   instead of computing `observed_on`/`area_m2` locally (R5 plan ruling 5 is overridden).
   `area_m2` is map polygons in metre CRSs only (R2 ruling 10).
5. **`report_version.number` is nullable** (R0), allocated on promote (R5).
6. **R2's `measurement_figure` may return `None`**; R9-M skips the figure then.
7. **R3 renderer contract** (`source_version`, `render`, `LookupError` → placeholder, per-module
   `JPEG_QUALITY`) is what R9-I (`attachment`) and R9-C (`view3d`, q88) implement. R3 draws
   LineString (R9-M), the `inset` locator and one-vertex pins (R9-I). Snapshot-key fixture shape
   `{"cases":[{name, spec, canonical, param, source_version, key}]}`; the endpoint re-parses into
   R0's models and accepts unpadded base64url (R6).
8. **Cache pruning:** R3's hand-off asking R1 to prune in the list route is dropped. R3's endpoint
   prunes on misses; R5 prunes after each render.
9. **Smoke script path** is `backend/scripts/smoke_frozen.ps1` (the table above said `scripts/`). R4
   adds only the `reports-selftest` line; R-X adds the real render step.
10. **R7 wires what its plan left out:** a section-heading click in the section list scrolls the
    preview there (`ReportPreview`'s `scrollToSection`, spec §12), and History's version rows open that
    version read-only in the preview through `versionBlocksLoader` (R6) and
    `…/versions/{n}/document` (R5; test against the mock until R5 merges). The list card's gradient
    chip instead of a cover thumbnail is accepted.
11. **UI names for e2e:** R10's `reportsUi.ts` takes the accessible names from R6 ("Preview" region,
    section regions titled by the outline, `article` "F-0042 Crack") and R7 (the table in its
    "Interfaces provided"). Where the merged code differs, only `reportsUi.ts` changes.
12. **R8 → R7:** R7 replaces `ReportsPlaceholder` on both `reports` and `reports/exports`, deletes it
    and `ReportsPlaceholder.test.tsx`, and honours `?new=builtin-survey-counts`.
13. **R4/R3 start before R0 merges** (their schema-dependent tasks wait); R8 needs no contract.
14. **Controllers merge `main` in (`git merge --no-ff main`) when resumed after a WAITING**, not
    rebase, so review history stays intact.
