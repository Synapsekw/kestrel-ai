---
type: spec
date: 2026-09-26
status: proposed
tags: [spec, reports, pdf, export, inspection-platform]
related: ["[[2026-09-26-inspection-platform-design]]", "[[2026-09-23-train-detect-split-and-model-library-design]]", "[[2026-09-23-volumes-design]]", "[[2026-09-23-survey-timeline-design]]", "[[2026-09-23-object-counts-per-group-design]]"]
---

# Reports (sub-project R)

## 1. Goal

"Everything ends in a report" (umbrella §1). Step 6 of the programme's success run is: the
operator opens the project's **Reports** tab, picks a template, adjusts filters and sections while
watching a live preview, and renders a PDF (plus a findings CSV/XLSX). The PDF opens on any machine,
prints on white paper, and carries the brand. Today three separate PDFs exist
(`backend/app/detect/export_pdf.py`, `backend/app/volumes/report_pdf.py`, and the HTML contact
sheet in `backend/app/exports/html_out.py`), each reachable from a different screen. This spec
replaces them with one report builder, and keeps the data-shaped exports as **Data exports**.

Done means:

1. A project's Reports tab lists its reports, and each report has a version history.
2. The builder toggles and reorders eight section kinds, applies the filters, and previews live.
3. **Render** is a background job with progress and cancel. It produces a PDF, and optionally
   `findings.csv` and `findings.xlsx`, as an immutable numbered version.
4. A section layout can be saved as an app-wide template and reused in any project.
5. Rendering the same version inputs twice gives a byte-identical PDF.
6. No step of preview or render loads a full image set, a full map or a full cloud into memory.

## 2. Scope

**In:**

- The Reports tab: the list, the builder, the preview, and the history.
- The sections: cover, executive summary, findings table, per-finding pages, measurements and
  volumes, survey comparison, object counts, and the data-item appendix.
- The filters.
- The snapshot engine: image crop, map, elevation, and 3D-view consumption.
- The PDF renderer and the `report_render` job.
- Findings CSV/XLSX.
- Templates with built-in presets.
- The Data exports panel, which absorbs `ExportScreen`.

**Out, deferred (§20):**

- Word output.
- Server-side 3D rendering from the octree.
- In-app PDF viewing.
- Merged single PDFs above the part budget.
- Scheduled reports.
- Sharing and e-mail.
- PDF/A.
- Report languages other than English.

## 3. Depends on

R starts after at least I and M are merged (umbrella §6). The skeleton can start earlier (§19). R
consumes the entities below. Each item is an assumption about a sibling spec, and the unit that
uses it re-checks the assumption at rebase time. R may *add* fields, but never renames anything
(umbrella §3).

| From | Assumed shape R reads | If it differs |
|---|---|---|
| F | `Finding` as in umbrella §3, plus the per-project human number `number` (int, shown as `F-0042`). **F owns `number`** (F §8.1); R never adds or allocates it | — |
| F | `GET /projects/{id}/findings` with keyset paging and filters (type, severity, status, data item); F's indexes `(status, severity, number)`, `(type_id)`, `(data_id)` (F §8.1; one DB per project, so no project column) | R's `reports/query.py` builds its own SQLAlchemy query on the same table |
| F | Catalogue types and the severity scale in F's app-wide **`catalogue.db`** next to `library.db` (F §7.1, F1), with its own Alembic history `backend/app/catalogue/migrations` | — (settled: `report_template` lives in `catalogue.db`, §6.2) |
| F | The Data list: one endpoint and one service `data_items.list(project)` → `{id, type, label, captured_on, status}` | R reads the four type tables directly |
| F | The new shell's project tab route `/p/:id/reports` and the Aero glass primitives in `frontend/src/ui/` | — |
| I | A defect finding's `image` anchor points at an **Annotation** (the `box` row, F6) with `shape` (`box` \| `rbox` \| `polygon` \| `point`, I §8.1) in image pixels; a polygon's `x, y, w, h` is its envelope and `points` its ring; a point has `w = h = 0`. The existing `app.geometry.corners_of` still yields box corners | The image-crop renderer takes a polygon ring, so only the adapter changes; a point is drawn as a pin |
| F | Finding **attachments** (`finding_attachment`: files under `findings/<fid>/` with a 256 px thumbnail) and a **comment thread** (`finding_comment`: `author`, `text`, `created_at`, `edited_at`), F §8.1 | Photos and comments are optional blocks; they render nothing if absent |
| M | A `map` anchor is a GeoJSON point or polygon in the map CRS. Measurements (distance, area, profile) have geometry in a map's CRS; a profile has sampled `(s, z)` pairs | — |
| M | Optionally, a saved **compare view** `{item_a, item_b, bbox_wgs84, mode, split}` | R's comparison section defines the pair and the bbox itself (§7.6) |
| C | Each `cloud` finding and cloud measurement has a **stored report view** (C §11): a PNG (or JPEG over 6 MiB) captured by the Point cloud workspace at exactly 1600×1000 plus its camera pose, re-captured when the anchor moves. Served at `GET /projects/{id}/findings/{findingId}/view3d` and `GET /projects/{id}/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d` (`ETag` = sha256; 404 `no_view`); metadata (`subject_kind` `finding` \| `cloud_measurement`, `subject_id`, `sha256`, `stale`) in C's `cloud_view` table and `GET …/pointclouds/{cloudId}/views` | §9.4 fallback: a hillshade plan of an overlapping cloud-derived elevation item, else a placeholder |
| I/M | Object counts (D7) stay on run rows: `MapRun.counts` / `area_counts` as `{class_id: {total, verified}}` (`vault/decisions/2026-09-23-counts-live-on-run-rows.md`), read through `backend/app/maps/timeline.py`; image-source counts stay "detections", never objects | The object-counts section reads whatever service replaces the timeline, and keeps the units rule |

## 4. Decisions that shape everything

| Decision | Choice | Why |
|---|---|---|
| PDF technology | **Extend reportlab** in the sidecar (§5) | Already pinned (`backend/requirements.txt` `reportlab==5.0.1`), frozen (`backend/kestrel_backend.spec` `collect_data_files("reportlab")`), smoke-tested (`backend/app/volumes/selftest.py`). Runs inside the job runner with progress and cancel. Deterministic. |
| One content model | The backend **composes** a report into a `ReportDocument`: an ordered list of typed blocks. The React preview and the reportlab renderer both render that list | Content cannot drift between preview and PDF; only layout can |
| Preview fidelity | **Content-exact, layout-approximate.** Page breaks are only known after a render; the history shows the real PDF's page count | The price of not printing through a webview (§5) |
| Snapshots | **Rendered server-side, deterministically**, from a `SnapshotSpec`, and cached by content hash. 3D is the exception: C's stored view (§9.4) | The same PNG/JPEG feeds the preview and the PDF. Pytest-testable, and a job can run with no window open |
| Versions | Every render is an **immutable numbered version** with its frozen `document.json`. The operator marks one version **Issued** | History is exact, and "change since the last report" needs a stable baseline |
| Change baseline | The newest **issued** version of *this* report, else the newest issued version of any report in the project, else none ("First report") | A test render never pollutes the deltas |
| Templates | App-wide, in F's `catalogue.db` (§6.2). They store sections, options, paper and *portable* filters (severity, status, catalogue types, a relative date rule), never data-item ids | Catalogue type ids are app-wide (D2), so a template is valid in every project |
| Memory | Snapshots embedded as **JPEG passthrough** at print size. Above an image-byte budget the PDF is written in **parts** (§10.4) | reportlab keeps the whole document in memory until `save()` |
| Word | **Not in v1** (§11.3) | A third renderer, and a new dependency, for a need XLSX plus the in-app notes already meet |
| Existing exports | **Data exports** keep the data-shaped exports (labels, GeoPackage, LAZ, counts CSV, volume bundle). The detection per-source PDF and the HTML "Report" format leave the UI in favour of report templates | One place makes documents; the data formats stay where GIS users expect them |

## 5. Rendering technology

| Option | For | Against |
|---|---|---|
| **A. reportlab platypus (chosen)** | Already in the frozen bundle. Pure Python. Two reports already built on it; `volumes/report_pdf.py`'s measurement flowables are reused as-is. `rl_config.invariant = 1` gives byte-stable output. JPEG files are embedded without re-encoding. Runs in `JobRunner` threads (`backend/app/jobs/runner.py`) with `ctx.progress` / `ctx.check_cancelled`. Pytest covers it | Layout is written twice (React preview, platypus). Typography is less rich than CSS. The document is held in memory until `save()` |
| B. HTML → PDF through WebView2 `PrintToPdf` | Pixel-identical preview. CSS | Tauri 2 exposes no print-to-PDF API. It needs `with_webview` plus the `webview2-com` crate in `frontend/src-tauri`, and a hidden window alive for the whole render, so the job would live in the Rust shell, outside the Jobs section and outside pytest. Map/3D snapshots would need live WebGL in that hidden window, which is non-deterministic under the SwiftShader fallback (`vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md`). Headers and page numbers are limited. It is a new runtime capability (`capabilities/default.json` is a runtime allow-list) |
| C. Headless Chromium (Playwright/Puppeteer) or `msedge --headless --print-to-pdf` | CSS paged media, and a real browser | Bundled Chromium adds ~150 MB to an installer already past NSIS limits (`vault/decisions/2026-09-18-gotcha-inno-setup-because-nsis-and-msi-cap-at-2gb.md`). System Edge is an unpinned, auto-updating dependency outside our control |
| D. WeasyPrint / xhtml2pdf | HTML templates | WeasyPrint needs GTK/Pango DLLs in PyInstaller: another native stack like the rasterio one (`vault/decisions/2026-09-22-rasterio-in-the-frozen-sidecar.md`). xhtml2pdf is reportlab underneath with a CSS2 subset, so it drifts from the preview anyway |

A is chosen because the invariants weigh most:

- long work is a background job, and the desktop has no server to fall back on
- the app works offline
- the frozen sidecar must carry everything

The shared `ReportDocument` removes the one real drawback that matters, content drift. **Fonts:**
Space Grotesk and JetBrains Mono (both SIL OFL) ship as TTF files in `backend/app/reports/fonts/`,
are added to `datas` in `kestrel_backend.spec`, and are registered with `TTFont`. If registration
fails, the renderer falls back to Helvetica/Courier and logs; it never fails the job. This
supersedes the "Helvetica only" consequence in `vault/decisions/2026-09-24-pdf-and-xlsx-in-the-frozen-sidecar.md`,
and R writes a new ADR for it.

## 6. Data model

### 6.1 Project database (`project.db`, revision `0014_reports` per umbrella §6 "Migration ids", chained onto `main`'s head at merge)

**`report`**

| Column | Notes |
|---|---|
| `id`, `title`, `created_at`, `updated_at` | |
| `config` | JSON `ReportConfig` (§7.1), validated by pydantic on every write |
| `template_id` | nullable; the template it was created from, for display only |
| `archived` | bool |

**`report_version`**

| Column | Notes |
|---|---|
| `id`, `report_id`, `number` | `number` is 1, 2, … per report, allocated in the promote transaction |
| `state` | `rendering` \| `ready` \| `failed` |
| `issued_at` | nullable; set by "Mark as issued", cleared by "Unissue" |
| `job_id` | the `report_render` job |
| `folder` | project-relative, e.g. `reports/<rid>/v003` |
| `files` | JSON `[{name, kind: pdf\|csv\|xlsx, bytes, sha256, pages?}]` |
| `config` | JSON, a frozen copy of the config used |
| `baseline_version_id` | nullable; the version the deltas were computed against |
| `stats` | JSON: finding count, page count, part count, warnings |
| `created_at` | |

**`report_version_finding`**: the state of each finding in the report at render time. This is the
next version's baseline.

- Primary key: `(version_id, finding_id)`
- Columns: `type_id`, `severity`, `status`
- Index on `finding_id`

**`report_asset`**: logos.

- `id`, `kind` (`logo`), `path` (`reports/assets/logo-<sha8>.png`), `sha256`, `width`, `height`
- Imported from a path picked with the existing dialog plugin (`dialog:allow-open`), copied into
  the project, and down-scaled to at most 1200 px a side.

### 6.2 App-wide database (F's `catalogue.db`, catalogue revision `0002_report_templates`)

There is no `app.db`: the template table lives in F's `catalogue.db` (F §7.1), in the catalogue's
own Alembic history. When the catalogue is unavailable (F's 503 `catalogue_unavailable`), the four
built-ins are served from code (`reports/templates/builtins.py`, the same data the migration seeds),
and custom templates answer 503 with that code; reports that already exist keep working, because a
report's config is copied into `project.db`.

**`report_template`**

- `id`, `name`, `description`, `builtin` (bool), `config` (JSON `ReportConfig` with portable filters
  only), `created_at`, `updated_at`
- Built-ins are seeded by the migration and can be duplicated, not edited or deleted:
  1. **Full inspection report**: every section on.
  2. **Findings summary**: cover, summary, table.
  3. **Survey count report**: cover, comparison, object counts. It replaces the detection per-source
     PDF (§13).
  4. **Volumes report**: cover, measurements (volumes only), appendix.

### 6.3 Files

```
<project>\reports\
  <report_id>\v003\
    <project-slug>-<report-slug>-v003.pdf   # or -part1-of-2.pdf, -part2-of-2.pdf
    findings.csv  findings.xlsx
    document.json                           # the frozen ReportDocument (§8)
  assets\logo-<sha8>.png
  .cache\snapshots\<key>.jpg                # §9.5, pruned LRU to 1 GB
```

A version folder is written through the existing partial-folder mechanism:
`_reserve_partial_folder` / `_promote` in `backend/app/exports/job.py`, already reused by
`detect/export_job.py` and `volumes/jobs_export.py`. A partial folder never shows up as a version.
`sweep_partial_exports` gains the `reports/<rid>/` roots.

## 7. Report configuration and sections

### 7.1 `ReportConfig`

```yaml
ReportConfig:
  cover:   { title, subtitle?, site?, client?, author, logo_asset_id?, report_date? }   # date defaults to render day
  paper:   { size: A4 | Letter, orientation: portrait }   # landscape deferred
  filters:
    severity_min: int | null          # a level of the scale; null = include ungraded
    include_ungraded: bool            # default true when severity_min is null
    statuses: [open, reviewed, closed]        # default [open, reviewed]
    type_ids: [catalogue ids] | null          # null = every type the project uses
    data_item_ids: [ids] | null               # project-only; stripped when saved as a template
    date: { rule: all | range | last_days | since_last_issued, from?, to?, days? }
  sections: [ { key: SectionKey, enabled: bool, options: {...} } ]   # order = print order
```

The **date** a finding is filtered and sorted by is its **observed date**: the `captured_on` of its
host data item (image EXIF time for an image anchor), else the finding's `created_at`. It answers
"what did the site look like then".

### 7.2 Section catalogue

| `key` | Content | Options |
|---|---|---|
| `cover` | Gradient band, logo, title, site, client, author, report date, period, version and "Issued"/"Draft" mark, a map locator of the site (the first map item's `preview.jpg`) | `show_locator` |
| `summary` | KPI row (§8.3), a severity × status matrix, a bar per type (top 8), a delta strip vs the baseline, an optional narrative | `narrative` (plain text, paragraphs), `show_deltas` |
| `findings_table` | One row per finding: number, type, severity, status, data item, observed date, note excerpt | `columns[]`, `sort: severity_desc \| number \| type \| observed` |
| `finding_pages` | One page per finding (§7.3) | `snapshots: [image, map, cloud]`, `photos_max` (0–6, default 4), `comments: none \| last \| all`, `context_inset` |
| `measurements` | One table per kind (length, area, height, lean, profile, volume), then a snapshot per measurement; a volume uses the existing volume pages. Rows come from M's union `GET /measurements` service (M §12); the umbrella's words map to the stored kinds: length = map `distance`, cloud `distance`, image length (later); lean = cloud `vertical`; height = cloud `height`; area = map and cloud `area`; profile = map `profile`, cloud `profile` | `kinds[]`, `snapshots`, `measurement_ids?` |
| `comparison` | Per pair: a side-by-side pair and a swipe composite, date captions, then a counts-over-time chart | `pairs: auto \| [{item_a, item_b, bbox_wgs84?}]`, `mode: swipe \| side_by_side \| both`, `counts_chart` |
| `object_counts` | Per class: total (verified) per survey; per site area for the newest survey; a photo-batch table labelled "detections" | `type_ids`, `per_area`, `verified_only` |
| `appendix` | Every data item in the filter: type, label, captured on, size (images, GSD, points), CRS; the method notes; the model provenance of model-created findings | `include_methods` |

### 7.3 A per-finding page (A4 portrait, one page, never split)

```
┌ F-0042 · Crack                         ● Major   Open ┐  heading band
│ [ main snapshot 170×105 mm ]                          │  image crop, else map, else 3D view
│ [ secondary 83×52 ] [ secondary 83×52 ]               │  the other anchors' views, plus a locator inset
│ Data item · observed date · coordinates (WGS84)       │  key-value table
│ Created by model:yolo11s-… (0.87) · reviewed 24 Sep   │
│ Note ...                                              │
│ Photos: up to 4 thumbnails 40×30 mm                   │
│ Comments (last or all, 9 pt)                          │
└───────────────────────────────────── page n / N ─────┘
```

If the content is longer than one page (many comments), comments continue on the next page, and
the heading band repeats with "(cont.)".

## 8. Composition

### 8.1 `ReportDocument`

`backend/app/reports/compose.py` turns `(project, ReportConfig, baseline)` into:

```yaml
ReportDocument: { report_id, version?, generated_at, theme_version, sections: [Section] }
Section: { key, title, blocks: [Block] }
Block (oneOf, discriminator kind):
  heading   { level, text }
  para      { text, style: body | small | note }
  kv        { rows: [[label, value]] }
  kpis      { items: [{label, value, delta?, tone}] }
  table     { columns: [{key, label, align, width_mm}], rows: [[cell]], repeat_header }
  figure    { snapshot: SnapshotRef, caption, width_mm, height_mm }
  figure_row{ figures: [figure] }
  chart     { kind: bar | stacked_bar | line, series: [...], x_labels, unit }
  finding   { finding_id, number, head: {...}, figures, kv, note, photos, comments }
  page_break{}
SnapshotRef: { key, spec: SnapshotSpec, width_px, height_px, missing_reason? }
```

- Times are frozen once per compose. `generated_at` is the only clock read, so a re-compose of a
  version reproduces its document exactly.
- Text is escaped at the renderer (`xml.sax.saxutils.escape`, as `detect/export_pdf.py` does), and
  React escapes by default.

### 8.2 Algorithm

1. Validate the config, resolve the filters into one SQL `WHERE` over findings, and resolve the
   baseline (§4).
2. For each enabled section in order, call its composer `compose_<key>(ctx) -> Section`. The
   composers are pure functions over read-only repository calls, one module each in
   `backend/app/reports/sections/`.
3. Findings are iterated by keyset pages of 200 (`number` order, or the section's sort key with
   `id` as the tie-break). Nothing collects all findings as ORM objects. The table section emits
   plain string rows.
4. Snapshots are **referenced** (a spec plus its key), never rendered during compose. The preview
   fetches them lazily and the job renders them in bulk.
5. Warnings are collected on the side, for example "12 findings have no 3D view" or "3 findings
   are ungraded".

### 8.3 Summary KPIs and deltas

KPIs come from one `GROUP BY severity, status` and one `GROUP BY type_id` over the filtered
findings, and are aggregated in SQL. The items are:

- total
- per severity level, with "Ungraded" for null
- open / reviewed / closed

Deltas join the filtered current set to `report_version_finding` for the baseline:

- **new**: in current, not in baseline
- **closed**: closed now, not closed in baseline
- **escalated / de-escalated**: severity level up / down
- **reopened**: closed in baseline, not closed now
- **left the report**: in baseline, not in current. This is shown as a count only, because it can
  mean a filter change.

The result is `{new, closed, escalated, deescalated, reopened, left}` plus the baseline's number and
date. With no baseline, the strip reads "First report".

## 9. Snapshots

### 9.1 `SnapshotSpec` and the key

```yaml
SnapshotSpec (oneOf kind):
  image_crop { image_id, ring: [[x,y]...], colour, label, context: 3.0, out: [1200, 900], inset: bool }
  map        { item_id, geometry: GeoJSON (item CRS), colour, label?, min_extent_m: 40, out: [1200, 900],
               scale_bar: true, north: true, inset: bool }
  elevation  { item_id, geometry, overlay: none | diff(item_b), out }
  pair       { a: map|elevation spec, b: same with item_b, bbox_wgs84, mode: side_by_side | swipe, split: 0.5 }
  view3d     { subject_kind: finding | cloud_measurement, subject_id, cloud_id }   # C's stored view, passed through
  volume_plan{ measurement_id }                       # volumes/plan_image.render_plan_image, unchanged
  chart_png  —                                        # none: charts are vector (§10.2)
key = sha256(canonical_json(spec) + source_version + RENDERER_VERSION)[:32]
```

`source_version` is what makes a stale snapshot impossible:

| Kind | `source_version` |
|---|---|
| image | the file's size and mtime, plus the annotation's `updated_at` |
| map | the GeoTIFF's size and mtime |
| elevation | the surface file's size and mtime |
| view3d | the stored view's sha256 (`cloud_view.sha256`, the `ETag` of C's `GET …/view3d`) |
| volume plan | the measurement's `computed_at` |

`RENDERER_VERSION` is a constant in `reports/snapshots/__init__.py`, bumped whenever a drawing
changes.

### 9.2 Image crop (`reports/snapshots/image_crop.py`)

1. Take the annotation ring's bounding box, padded to `context`× its size, with a floor of 512
   source px and a ceiling of the image. Keep a 4:3 aspect, shifted inside the image rather than
   clipped.
2. Pick the JPEG decode reduction `r ∈ {1, 2, 4, 8}`: the largest one that keeps the crop at least
   `out` wide. Use Pillow's `Image.draft("RGB", (W/r, H/r))`, so a 20 MP photo decodes at 5 MP or
   less when the defect is large. For TIFF/PNG, decode full size. Pillow's `MAX_IMAGE_PIXELS` stays
   the guard: an image above it fails that snapshot only, with `missing_reason`.
3. Crop, then resize with LANCZOS to `out`.
4. Draw the ring in the type colour at 4 px with a 2 px white halo, and add a label tag
   `F-0042 · Crack` on a dark chip. A rotated box uses `app.geometry.corners_of`, as `html_out.py`
   does.
5. Optional locator inset: the image's existing thumbnail (`datasets.images.thumbnail`, never the
   original), with the crop rectangle drawn on it.

### 9.3 Map and elevation (`reports/snapshots/map_view.py`)

1. Take the geometry's bounds in the item CRS, padded 25 %, with a floor of `min_extent_m` a side
   and a 4:3 aspect.
2. Map it to a pixel window through `maps/georef.Georef` (the inverse affine). A rotated
   geotransform takes the four corners' pixel bbox.
3. Read with `maps.raster.read_rgb(src, x, y, w, h, out_w, out_h)`. This is the decimated windowed
   read the tile renderer already uses, so the read is bounded by `out`, never by the raster.
4. Paint nodata a neutral grey, as `raster.write_preview` does.
5. Draw a point as a severity-coloured pin with a white outline, and a polygon as a 3 px outline
   with a 15 % fill.
6. Add a scale bar and a north arrow, reusing `_nice()` and the drawing idiom of
   `volumes/plan_image.py`, and an attribution line (item label and date).
7. For elevation, use a hillshade from `surfaces.grid.SurfaceReader` + `hillshade`, exactly as
   `plan_image.render_plan_image` does, capped at `out`.

**Pair / swipe.** Both items are read over the same WGS84 bbox (by default the intersection of the
two footprints, shrunk to a 4:3 aspect around the centroid of the pair's findings, or the centre),
each projected into its own CRS. A `side_by_side` pair is two figures with date captions. A `swipe`
is one composite: columns `[0, split·W)` from A and `[split·W, W)` from B, with a 2 px white
divider and "A: 14 Sep · B: 21 Sep" chips. It is the printed form of M's swipe.

### 9.4 3D views

R does **not** render point clouds. It passes C's stored view through, re-encoded once as JPEG
(q 88) into the cache. The job reads the row and file in-process through C's
`app/pointclouds/views.py` (same `project.db`); the preview reads the same bytes over HTTP from
C's endpoints (§3): `GET /projects/{id}/findings/{findingId}/view3d` for a finding and
`GET /projects/{id}/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d` for a cloud
measurement. When the view is **stale** (`cloud_view.stale`, the anchor moved since capture), R
prints it and adds the builder warning "n 3D views are out of date", with the deep link. When a
cloud finding or cloud measurement has **no** stored view (404 `no_view`), R falls back in this
order:

1. a hillshade plan (§9.3 elevation) of a cloud-derived elevation item that covers the anchor (a
   measurement: its geometry's centroid), with the pin or the geometry
2. a placeholder figure reading "No 3D view saved. Open this finding in Point clouds to capture
   one", plus a builder warning with F's finding deep link `/p/:pid/clouds/:cloudId?finding=<fid>`
   (F §8.7), or for a measurement `/p/:pid/clouds/:cloudId`, where C's "Capture missing views"
   repairs it

Server-side rendering from the octree is deferred (§20): the octree is BROTLI-encoded
(`pointclouds/converter.py` `ENCODING = "BROTLI"`), and the source LAS is not kept in the project
(`PointCloud.source_path`, `pointclouds/workcopy.py`).

### 9.5 Cache, determinism, concurrency

- **Cache.** `reports/.cache/snapshots/<key>.jpg` holds JPEG q 85, 4:2:0, no EXIF, no timestamp.
  Pillow is pinned (`pillow==12.3.0`), so the bytes are stable. The cache is pruned LRU to 1 GB when
  the tab opens and after each render.
- **Serving.** `GET /projects/{id}/report-snapshots/{key}` serves from the cache. On a miss, it
  renders synchronously, bounded like a tile.
- **Concurrency.** A process-wide `Semaphore(2)` limits simultaneous snapshot renders. The preview
  requests only visible figures (`IntersectionObserver`). The spec travels in the query as
  base64url JSON; the server recomputes the key and refuses a mismatch (400).
- **Failure.** An unreadable source yields a grey placeholder with the reason. The job records a
  warning and never fails on one snapshot.

## 10. The PDF

### 10.1 Print design: echoes Aero glass, works on white paper

- **Paper.** Ink `#15142B`. Muted `#5E5C7A`. Rules `#DAD8EA`. Table head fill `#F3F1FC`.
- **Brand.** Violet `#6A5CFF`, printed as a darkened `#8F7BFF` for contrast on white. Teal `#0F8F76`,
  a print-safe `#5FE3C0`.
- **Cover.** A full-bleed band across the top 38 % of the page. It uses reportlab's
  `canvas.linearGradient` from `#3B2A7A` to `#6A5CFF` to `#0F5B66`, the D backdrop's radial colours
  flattened. White title in Space Grotesk 30 pt. Logo top right on a white rounded chip. Everything
  below the band is white.
- **Body.** Space Grotesk 9.5/13 pt, headings 18/14/11 pt. Numbers, ids and coordinates in
  JetBrains Mono 8.5 pt. Margins 18 mm, and 16 px radii become 3 mm on figure frames.
- **Severity.** Colours come from the app-wide scale. They are printed as a filled dot plus ink
  text, never as coloured text, because yellow on white fails contrast. A pill is a 12 % tint fill.
- **Page furniture.** The header carries the report title and the version. The footer carries
  `Kestrel AI · <project> · page n / N`, via the existing `_NumberedCanvas` idiom in
  `volumes/report_pdf.py`, generalised into `reports/pdf/canvas.py`.
- **Single source.** Every colour and size lives in `contract/fixtures/report-theme.json`, read by
  `backend/app/reports/theme.py` and `frontend/src/reports/printTheme.ts`. A parity test on both
  sides pins them, the pattern of `contract/fixtures/cloud-measure-vectors.json`.

### 10.2 Block → flowable (`reports/pdf/flowables.py`)

| Block | Rendered as |
|---|---|
| `heading`, `para` | `Paragraph` |
| `kv`, `table` | `Table` with `repeatRows=1`, the `_table` style of `detect/export_pdf.py` restyled |
| `kpis` | A one-row table of cards |
| `figure` | `Image(path, lazy=2)` on the cached JPEG, which reportlab embeds as DCT passthrough |
| `chart` | A `reportlab.graphics` `Drawing`: vector, no PNG |
| `finding` | `KeepTogether` of the page layout in §7.3, followed by `PageBreak` |
| volume measurement | `volumes/report_pdf._measurement(item)`, renamed to the public `measurement_flowables(item)` |

The page template is a `BaseDocTemplate` with `cover` and `body` frames. `afterFlowable` reports
progress and collects the TOC entries: the PDF has outline bookmarks per section and per finding.

### 10.3 Determinism

- `reportlab.rl_config.invariant = 1`
- a fixed `/CreationDate` from `document.generated_at`
- fonts subset deterministically
- snapshots byte-stable (§9.5)

A golden test renders a fixture report twice and compares sha256.

### 10.4 Memory budget and parts

reportlab keeps every object until `save()`. The job estimates the embedded bytes as the sum of the
cached JPEG sizes. When that estimate would exceed **`PART_BUDGET = 160 MB`**, the per-finding and
measurement sections are split at finding boundaries into `-part<k>-of-<n>.pdf`:

- Part 1 carries the cover, the summary and the table.
- Page numbering continues across parts ("page 212 / 530").
- Each part is rendered and saved before the next starts.

The job's peak is roughly one part plus one decoded source image (at most `MAX_IMAGE_PIXELS × 3`
bytes). A typical report of fewer than about 250 findings with three figures each is one file.

## 11. Findings CSV / XLSX, and Word

### 11.1 Columns (both formats, one row per finding in the filter, report order)

`number, type, type_kind, severity_level, severity_name, status, observed_on, data_item, data_item_type,
anchor_kind, image_file, px_x, px_y, map_x, map_y, map_crs, lon, lat, cloud_x, cloud_y, cloud_z,
uncertainty_m, area_m2, note, created_by, confidence, photos, comments, created_at, updated_at,
report_version`

The position fields are the anchor centroid. `area_m2` is filled for a polygon on a map, or for an
image polygon when the GSD is known.

### 11.2 Writers

- **CSV:** `utf-8-sig`, like `detect/export_csv.py`, streamed row by row.
- **XLSX:** openpyxl write-only (as `volumes/jobs_export.py`). Sheets:
  - Findings: frozen header, autofilter, severity cell filled with the scale colour
  - Measurements: one sheet, `kind` column
  - Counts: the object counts section's table, when enabled
  - Report: config, baseline, version

### 11.3 Word: not in v1

A `.docx` would be a third layout of the same content, and a new frozen dependency (`python-docx`
plus `lxml`). The editing need behind it is met by the narrative field, by notes edited in the app,
and by the XLSX. Deferred, with the `ReportDocument` as the input when it comes.

## 12. The Reports tab (frontend)

Route `/p/:projectId/reports`. The top of the tab is a `Segmented` control: **Reports | Data
exports**. Components live in `frontend/src/reports/`. They use F's Aero glass primitives, and
`useApi()` plus a new `frontend/src/api/reports.ts` over the generated client.

| Component | Does |
|---|---|
| `ReportsTab.tsx` | The segmented switch and the routes `/reports`, `/reports/:reportId`, `/reports/exports` |
| `ReportList.tsx` | Glass cards: title, template, last version with state, "Issued v3 · 24 Sep", page count, a thumbnail of the cover (the first figure of the document). **New report** opens `NewReportDialog` (pick a template, title). Duplicate, archive |
| `ReportBuilder.tsx` | Three panes: sections (left, 280 px), preview (centre, scrolls), settings (right, 320 px). The top bar has the title, a warnings chip, *Save as template*, *History*, and **Render** (a split button with the formats) |
| `SectionList.tsx` | One row per section: drag handle, `Switch`, name, and an options `Disclosure`. Reorder by drag or Alt+↑/↓, announced for screen readers. Cover is pinned first when enabled |
| `ReportSettings.tsx` | The cover fields (logo picker via `@tauri-apps/plugin-dialog` `open`, then `POST report-assets`), paper, and `ReportFilters` |
| `ReportFilters.tsx` | Severity ≥ (scale chips), status multi-select, catalogue type multi-select, date rule (all / range / last N days / since last issued), data items (the Data list with type icons). A live count: "38 findings match" |
| `ReportPreview.tsx` | Renders the outline as white A4 sheets (210:297) on the glass backdrop. Sections load their blocks lazily when near the viewport. A section heading click scrolls there. Figures are `<img>` on the snapshot endpoint with a skeleton. The page count after the last render is shown beside it |
| `preview/blocks/*.tsx` | One component per block kind, sized in mm through `printTheme.ts`; charts as inline SVG |
| `ReportHistory.tsx` | Drawer: versions with state, pages, parts, files; *Reveal* (the existing `RevealButton`), *Open PDF* (`POST /reveal`-style `open`, §14), *Mark as issued* / *Unissue*, *Delete version* (a draft only). A running render shows the `JobCard` |
| `SaveTemplateDialog.tsx` | Name and description. It says that data-item filters are not kept |

**Live preview loop.**

1. An edit updates local state immediately. The section list and the settings are optimistic.
2. Changes are debounced 400 ms, then sent as `PATCH /reports/{rid}` with the whole config.
3. The outline is refetched, and only the sections whose `etag` changed are re-requested.

Motion follows F's tokens: sections reorder over `--dur-base` with `--ease-out` (F reserves
`--ease-spring` for pin and badge pops), a toggled-off section's sheet collapses over `--dur-base`,
and `prefers-reduced-motion` turns both into instant changes. Sheets are plain
white cards with no backdrop blur, following umbrella §8's rule for long scroll containers.

## 13. Data exports (what becomes of `ExportScreen`)

`frontend/src/screens/ExportScreen.tsx` becomes `frontend/src/exports/DataExportsPanel.tsx` under
Reports → Data exports, and the `/p/:id/export` route redirects there.

| Today | After |
|---|---|
| `ExportForm` → `results_export` (CSV, YOLO, COCO, HTML) | Kept. The HTML format is relabelled "Image contact sheet (HTML)", and `FORMAT_LABEL["html"]` in `exports/job.py` changes to match. Training-data export also lives in Models → Datasets (D1); this one exports the project's annotations as they are |
| `DetectExportForm` → `detect_export` CSV | Kept (counts CSV) |
| `DetectExportForm` → `detect_export` PDF per source | Removed from the UI. It is replaced by a button that creates a report from the **Survey count report** template. The endpoint keeps `format: pdf` for one release, marked deprecated in `contract/openapi.yaml`; `detect/export_pdf.py` is deleted in the release after |
| Map export (`maps/ExportMapDialog.tsx` → `map-exports`) | Stays in the Map workspace (M). Listed here with a link |
| Volume export (`volume-exports`: PDF, GPKG, GeoTIFF, CSV, XLSX) | Stays as the technical volume bundle. Its PDF keeps its method pages. The report's measurements section reuses the same flowables, so they cannot disagree |
| Point cloud LAZ export (`pointclouds/{cloudId}/exports`) | Stays in the Point cloud workspace (C). Listed here |
| "Past exports" (`ExportJobs`, `useResultsExportJobs` `EXPORT_TYPES`) | Extended with `volume_export` and `pointcloud_export`. Report renders are not listed here; they live in report history |
| The train-only "Model for other applications" block | Removed: kinds are gone (umbrella §3). The library link lives in the Models section |

## 14. API (contract first; tag `reports`; R owns these paths and schemas)

| Endpoint | Purpose |
|---|---|
| `GET /projects/{id}/reports` | Paginated list: `{id, title, template_id, updated_at, last_version: {number, state, issued_at, pages}}` |
| `POST /projects/{id}/reports` | `{title, template_id?}` → `Report` (the config is copied from the template, and project-only filters are filled with defaults) |
| `GET / PATCH / DELETE /projects/{id}/reports/{rid}` | Detail. `PATCH {title?, config?}` returns 422 with a path per invalid field. `DELETE` archives, or deletes when there are no versions |
| `POST /projects/{id}/reports/{rid}/duplicate` | Copy the config into a new report |
| `GET /projects/{id}/reports/{rid}/outline` | `{sections: [{key, title, block_count, etag, estimated_pages}], finding_count, warnings[], baseline?}`. Bounded: aggregates only |
| `GET /projects/{id}/reports/{rid}/sections/{key}/blocks?cursor&limit≤50` | A page of `Block`s for one section, keyset-cursored |
| `GET /projects/{id}/report-snapshots/{key}?spec=` | `image/jpeg`. Rendered on a miss; `Cache-Control: immutable` |
| `POST /projects/{id}/reports/{rid}/renders` | `{formats: [pdf, csv, xlsx], label?}` → `202 JobRef` (`report_render`). Returns `409 render_running` if one is active for this report |
| `GET /projects/{id}/reports/{rid}/versions` | List of versions |
| `GET / PATCH / DELETE /projects/{id}/reports/{rid}/versions/{n}` | Detail with `files`. `PATCH {issued: bool}`. `DELETE` works only on a version that was never issued (`409 issued_version`) |
| `GET /projects/{id}/reports/{rid}/versions/{n}/document` | The frozen `ReportDocument` (paged like `blocks`), for viewing an old version in the preview |
| `POST /projects/{id}/open` | `{path}` → opens a file inside the project with its default application (`os.startfile`, behind the same `resolve_inside_project` guard as `exports/reveal.py`) |
| `POST /projects/{id}/report-assets` | `{path}` → a logo `ReportAsset` |
| `GET /report-templates`, `POST /report-templates` | App-wide list and create |
| `GET / PATCH / DELETE /report-templates/{tid}` | A built-in returns `409 builtin_template` on PATCH and DELETE |

Schemas: `Report`, `ReportConfig` (with `ReportFilters`, `ReportSection`, `SectionKey`, per-section
options as a `oneOf` on `key`), `ReportOutline`, `Block` (`oneOf` with the `kind` discriminator),
`SnapshotSpec`, `ReportVersion`, `ReportFile`, `ReportTemplate`, `ReportAsset`, `RenderRequest`.

- `schema.d.ts` is regenerated in the same change.
- No `default:` on a response field that must stay optional
  (`vault/decisions/2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript.md`).
- The render job gets an offline seam for contract tests
  (`vault/decisions/2026-09-21-gotcha-contract-jobs-need-offline-seams.md`).
- The reports router is registered in `api.py` inside a `try/except` like the maps and
  detect-export routers, so a broken reportlab costs reports, never the app.
- reportlab and openpyxl are imported inside the job only, as today.

## 15. Budget

**Background jobs:**

- `report_render`, which covers compose, snapshot bulk-render, PDF parts, CSV and XLSX. It has
  progress by phase:
  - compose: 5 %
  - snapshots: 55 %, per figure
  - PDF: 35 %, per flowable via `afterFlowable`
  - tables: 5 %
- Cancel is checked between figures, between flowables, and between parts.
- Logo import is small and synchronous, and is refused above 20 MB.

**Bounded reads:**

- Every list endpoint pages: reports, versions, blocks (≤ 50), templates.
- The outline and the KPIs are SQL aggregates, so they grow with the number of sections, not with
  the number of findings.
- Compose iterates findings in keyset pages of 200 and never holds all ORM rows.
- A snapshot reads at most:
  - an image: one source image, JPEG-draft reduced
  - a map or elevation: one decimated window of at most 1200×900 (a swipe: two)
  - a 3D view: one stored PNG
  - never a full raster, full image set or cloud
- Snapshot renders are capped at 2 concurrent. The preview requests only visible figures.
- Job peak memory is one PDF part (≤ 160 MB of embedded JPEG plus reportlab overhead) plus one
  decoded image.
- The snapshot cache is capped at 1 GB on disk.

## 16. Errors and edge cases

- **No findings match.** The builder says so, and the findings sections render "No findings match
  the filters". Rendering is still allowed: a report can be counts or volumes only.
- **A finding deleted between compose and render.** It is skipped with a warning. The version
  records the ids it actually printed.
- **Ungraded findings.** They show as "Ungraded" in grey. `severity_min` excludes them unless
  `include_ungraded`.
- **A source moved or unreadable (image, map, elevation).** A placeholder figure with the reason; a
  warning; the job succeeds.
- **A stale volume measurement.** The measurements section prints "stale, recalculate" instead of
  numbers. `volume_export`'s `409 not_ready` stays specific to that export.
- **A swipe pair with non-overlapping footprints.** Side-by-side only, over each item's own
  footprint, captioned "no common area".
- **Fonts failed to register (a broken build).** Helvetica fallback plus a log line.
  `reports-selftest` (§17) catches it in `smoke_frozen.ps1`.
- **Disk full while writing.** The partial folder is removed (the existing `_promote` path), the
  version is marked `failed` with the message, and nothing half-written is listed.
- **App closed during a render.** The job is marked failed at the next start (existing runner
  behaviour), and the sweep removes the partial folder.
- **Concurrent renders of two reports.** Allowed; both share the snapshot semaphore. Two renders of
  one report get `409 render_running`.
- **Catalogue type archived.** It still prints by name. A template referencing it keeps it and shows
  it as archived in the filter.

## 17. Testing

**Backend (pytest)**

- **Config:** validation, template portability (data-item ids stripped), date rules including
  `since_last_issued`.
- **Compose:**
  - the filter → SQL on a fixture project with every anchor kind
  - keyset paging across the page boundary (201 findings)
  - KPIs against a brute-force count
  - deltas for each of `new/closed/escalated/deescalated/reopened/left`, with and without a baseline
  - the issued-baseline selection order
- **Snapshots:**
  - image crop on a rotated box and a polygon near the image edge (shifted, not clipped)
  - JPEG draft chosen correctly
  - a map snapshot on a UTM and a rotated-geotransform fixture (`tests/geotiffs.py`)
  - the pair/swipe composite geometry
  - the key changes when the source mtime changes
  - byte-identical output for the same spec
  - a placeholder for a missing file
  - a memory test: a 60 MP fixture image with a `tracemalloc` peak under a set bound
- **PDF:**
  - a golden sha256 of a fixture report rendered twice
  - the page count
  - bookmarks present
  - the part split at a lowered `PART_BUDGET` with continuous numbering
  - the Helvetica fallback when the fonts are removed
  - the volume flowables reused unchanged (their existing tests still pass)
- **Job:** progress monotonic, cancel mid-snapshots removes the partial folder, the version number
  is allocated only on promote, a failed version is marked, and the CSV/XLSX columns and severity
  fills are correct.
- **Contract tests** for every endpoint, and the theme parity test against
  `contract/fixtures/report-theme.json`.
- **Frozen:** `kestrel-backend.exe reports-selftest`:
  - TTF fonts, a gradient, JPEG passthrough, a `Drawing` chart, write-only XLSX
  - added to `scripts/smoke_frozen.ps1` after `volumes-selftest`

**Frontend (vitest)**

- `SectionList` reorder by drag and by keyboard; toggle; the cover pinned first.
- `ReportFilters` builds the right config and shows the match count.
- Every block kind renders from a fixture outline.
- The debounced PATCH, with only changed sections refetched (etag).
- The history actions: issue, unissue, delete refused when issued.
- `DataExportsPanel` keeps the old `ExportScreen` tests passing, re-pointed.
- `printTheme.ts` parity with the fixture.

**Playwright e2e**

1. Seeded project with image, map and cloud findings → Reports → New from "Full inspection report"
   → toggle photos off, move Measurements above the table → the preview reflects both → Render PDF
   + XLSX → the job completes → the history shows v1 with pages and files → Mark as issued.
2. Close one finding, grade another higher, Render → the v2 summary shows "1 closed · 1 escalated
   since v1".
3. Save as template → create a report in a second project from it → the sections match, and the
   data-item filter is empty.
4. Data exports → a results export and a counts CSV still work; the old `/export` route redirects.

## 18. Success criteria

1. The success run's step 6 happens inside the project, with no other screen needed.
2. The preview and the PDF show the same findings, numbers and images for the same config.
3. The same inputs give a byte-identical PDF, and a changed source image changes its snapshot.
4. A 300-finding report renders as a job, with the UI responsive throughout, within the memory
   budget of §15.
5. The PDF reads well printed in greyscale: severity is always a word plus a dot, never colour
   alone.
6. Every earlier data export still works from Data exports or its workspace.

## 19. Execution DAG

**Units**

- **R0: contract**, per batch (a, b, c): the §14 paths for the batch, plus the regenerated client.
- **R1: storage and CRUD.** The `report`, `report_version`, `report_version_finding` and
  `report_asset` tables with project revision `0014`; `report_template` in `catalogue.db` (catalogue
  revision `0002`) with the built-ins and their in-code fallback; report, template and asset
  endpoints; `open`. Needs F (Finding, `catalogue.db`).
- **R2: compose core.** `ReportConfig`, the filters → SQL, the `ReportDocument` model, the section
  composers for `cover`, `summary` (KPIs and deltas), `findings_table` and `appendix`, and the
  outline and blocks endpoints. Needs F.
- **R3: snapshot engine.** `SnapshotSpec`, the keys, the cache and the endpoint;
  `image_crop` (on today's `Box` + `corners_of`, adapted to I's annotation shapes later);
  `map_view`, `elevation`, `pair`; `volume_plan` (existing). Needs nothing new from F for the
  renderers themselves. The endpoint needs R1.
- **R4: PDF renderer.** The theme fixture, the fonts plus `datas` in the spec, page templates, the
  gradient cover, block → flowable, charts, bookmarks, invariant mode, parts, and
  `reports-selftest`. **Needs nothing**: it runs on a hand-written `ReportDocument` fixture.
- **R5: render job and versions.** `report_render`, the phases and progress, the partial folder and
  promotion, versions and issue, CSV/XLSX writers. Needs R1, R2, R4.
- **R6: preview blocks.** `printTheme.ts`, `preview/blocks/*`, `ReportPreview` on a fixture outline
  against the Prism mock. Needs R0a only.
- **R7: builder UI.** `ReportsTab`, `ReportList`, `ReportBuilder`, `SectionList`, `ReportSettings`,
  `ReportFilters`, `ReportHistory`, `SaveTemplateDialog`. Needs R0a/b, F shell, R6.
- **R8: Data exports fold-in.** `DataExportsPanel`, the redirect, `EXPORT_TYPES`, the detect PDF
  removed from the UI, the relabel. Needs F shell only.
- **R9-I: per-finding pages for image anchors**, photos and comments. Needs I, R3, R5.
- **R9-M: map pins in finding pages, map/area/profile measurements, `comparison`,
  `object_counts`.** Needs M, R3, R5.
- **R9-C: 3D views in finding pages and cloud measurements**, with the fallbacks and the stale
  warning. Needs C (at least C's units B4, the view endpoints, and R1, the capture; C §17), R3, R5.
- **R10: e2e, walkthrough, ADRs** (fonts in the sidecar; reports use reportlab over WebView2 print),
  and the ledger entry. Needs everything.

**Parallel batches**

0. **Before F merges:** R4 (pure renderer), plus the R3 renderers as pure functions over today's
   `Box`, `GeoMap` and `Surface`.
1. **After F:** R0a, then R1, R2, R6 and R8 in parallel. R4 and R3 continue.
2. R0b, then R5 and R7 in parallel. The R3 endpoint lands.
3. **As each sibling merges:** R0c, then R9-I, R9-M and R9-C, each in its own worktree, with
   serialized merges (umbrella §6). R9-M carries the largest share: comparison plus counts.
4. R10.

**Critical path:** F → R2 → R5 → (the last of I/M/C to merge) → its R9 unit → R10. R4 is the
longest unit inside R, but it starts at batch 0, so it is off the critical path unless it slips past
R5. Shared files that need serial merging:

- `contract/openapi.yaml` (one batch at a time)
- `backend/app/api.py` (one router block)
- `kestrel_backend.spec` (R4 only)
- `scripts/smoke_frozen.ps1` (R4 only)

## 20. Deferred

- **Word (`.docx`) output** (§11.3).
- **Server-side 3D rendering** from the octree. It needs a BROTLI decoder (a new `brotli`
  dependency plus Potree 2's Morton-decoded positions) and a numpy z-buffer splatter under a point
  budget. It would remove the dependency on C's stored views.
- **In-app PDF viewer.** It needs `frame-src http://127.0.0.1:*` in the Tauri CSP
  (`frontend/src-tauri/tauri.conf.json`). Until then, *Open PDF* uses the OS viewer.
- **One merged PDF above the part budget.** This needs `pypdf` and a streaming merge.
- **Landscape pages, custom text sections beyond the summary narrative, per-client branding
  themes.**
- **Scheduled or recurring reports, e-mail, cloud sharing, digital signatures, PDF/A.**
- **Elevation difference (cut/fill) in the comparison section.** It is available through the
  volumes section today.
- **Deleting `detect/export_pdf.py`**, one release after R8.

## 21. Risks

1. **Preview/PDF layout drift.** Two renderers of one document. Mitigated by the shared blocks, the
   shared theme fixture with parity tests, mm-sized preview blocks, and the real page count shown
   after each render.
2. **C's stored 3D views may not exist, or may land late.** R9-C degrades to the fallback, and the
   warning chip deep-links to capture. Nothing else in R waits on C.
3. **reportlab memory on large reports.** Parts plus JPEG passthrough, a `tracemalloc` test, and
   `PART_BUDGET` as a single constant to tune.
4. **Fonts in the frozen sidecar** reverse an ADR consequence. Mitigated by the Helvetica fallback
   and `reports-selftest` in `smoke_frozen.ps1`.
5. **F's Finding shape changes during the parallel work.** Every assumption is listed in §3 with its
   fallback. R2 rebases onto F's merged models before it starts.
