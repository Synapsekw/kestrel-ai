---
type: spec
date: 2026-09-30
status: proposed
tags: [spec, projects, setup, templates, import, catalogue]
related: ["[[2026-09-26-inspection-platform-design]]", "[[2026-09-26-foundation-design]]"]
---

# Project setup (sub-project S1)

## 1. Goal

Creating a project today is a dialog with a name, a folder and an optional list of catalogue types
(`frontend/src/screens/projects/NewProjectDialog.tsx`, F §9.2). Data is brought in afterwards, one
import at a time, from the tabs. The operator wants creation to be the place where the job is set
up: choose what is being inspected, drop the delivery folder, and decide which anomalies to look
for, in one screen.

The operator chose layout **A** from the brainstorm mockups (artifact "Kestrel New Project Setup",
2026-09-30): a template row, then one page with Basics, Data and Anomalies, and a summary that stays
in view.

Done means:

1. **New project** opens a full page at `/projects/new` with four cards (Template, Basics, Data,
   Anomalies) and a summary.
2. Three built-in templates exist (Mapping and survey, Vertical asset inspection, Confined space
   inspection), plus Blank and any templates the operator saved.
3. Dropping a folder starts a background inspect job that sorts its files into the template's slots
   by extension and header, without loading any image.
4. **Create project** creates the project and starts the existing import job for each slot. The
   project opens at once, with the imports running.
5. The anomaly list comes from the template, and can be edited, added to from the Catalogue, or
   extended with new types. Every type lands in the app-wide Catalogue.
6. **Save as my template** stores the template, slots and types as a reusable preset.
7. Catalogue types carry a `definition` and ordered `severity_rules`, editable in the Catalogue.

## 2. Scope

**In:** the setup page; project templates (storage, built-ins, user templates); the `setup_inspect`
job and its file classifier; the create-then-import dispatch; the catalogue `definition` and
`severity_rules` fields and their editor; resolving template types against the Catalogue.

**Out (separate sub-projects, each with its own spec):**

| Id | Sub-project | Relation to S1 |
|---|---|---|
| S2 | AI "Describe it" (text → types with definitions and rules), and rules that pre-fill severity in AI detection | Adds a panel to the Anomalies card; fills the fields S1 adds |
| S3 | AI "Show it" (vision model on a bounded image sample → proposed types) | Adds a second action to the same panel; reuses S2's proposal format |
| S4 | Video import (frame extraction, timecodes, flight-log link) | Adds the `video` import route; S1's classifier routes to it once merged |

**Also out:** project metadata fields (CRS, asset id, previous inspection) shown in the mockup;
slots with no importer today (ground control points, UT readings, previous report, KML boundary);
E57 point clouds; thermal R-JPEG decoding (S1 only *recognises* DJI thermal files); the Setup
agent opening this page pre-filled (the agent stays as it is).

## 3. Depends on

- F (merged): the no-kind project model (F5, §6), `catalogue.db` and `project_types`, `POST /projects`
  with `type_ids`.
- The existing importers: `POST /projects/{id}/sources` (`import`), `/maps` (`map_import`),
  `/elevations` (`elevation_import`), `/pointclouds` (`pointcloud_import`),
  `/drawing-inspections` + `/drawings` (`drawing_import`).
- The library handle for app-level jobs (`jobs/app_router.py` `_sources`), which S1's inspect job
  uses because no project exists yet.

## 4. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| S1-1 | Is the template a project kind? | **No.** It pre-fills the page and is not stored on the project. | F5 removed kind on purpose; a tower project must still take an orthomosaic later. |
| S1-2 | Where do template types live? | In the app-wide **Catalogue**. Templates name types; on create each name is resolved by `name_key` (reuse on a match, create on a miss with `origin = "template"`). | Umbrella decision "one catalogue"; findings across projects stay comparable. |
| S1-3 | On a name match with a different kind or colour | The **Catalogue wins**. The row shows "Already in your Catalogue as Object" before create. | Changing a shared type from setup would silently restyle other projects. |
| S1-4 | Where are templates stored? | A `project_template` table in `catalogue.db`, next to `report_template`. | Same lifetime and backup as the Catalogue; one pattern already exists. |
| S1-5 | What may a slot promise? | Only data Kestrel can import today (plus `video` after S4). | A slot with no importer is a false promise. |
| S1-6 | Does an empty required slot block Create? | **No.** It warns. Only name and folder are required. | Data often arrives later; the project must be creatable now. |
| S1-7 | What if one import fails after create? | The project and other imports stay; the slot shows the error and **Retry**. | Create and imports are separate jobs; rolling back a created project would lose work. |
| S1-8 | Hotkeys from the template | `ProjectCreate` gains an optional `hotkeys` map (same shape as `PUT /projects/{id}/types`). | Create stays one atomic call; no second request that can fail on its own. |

## 5. Data model (catalogue migration `0003`)

Catalogue migration `0003` (the catalogue's own Alembic history, after `0002`):

**`catalogue_type`** gains:

| Column | Type | Notes |
|---|---|---|
| `definition` | `Text`, nullable | What the anomaly looks like; at most 1000 characters (validated in the schema). |
| `severity_rules` | `JSON`, default `[]` | Ordered list of `{ "when": str (≤ 200), "severity": int }`; `severity` must be a level on the current scale; at most 8 rules. |

The `origin` check constraint widens to `('user', 'migrated', 'template')`.

**`project_template`** (new):

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | UUID; built-ins use fixed ids `builtin-mapping`, `builtin-vertical`, `builtin-confined`. |
| `name` | `String(80)` | Unique by `name_key`. |
| `description` | `String(300)` | Shown on the template card. |
| `builtin` | `Boolean` | Built-ins are read-only (409 `template_builtin` on PATCH/DELETE). |
| `config` | `JSON` | `TemplateConfig`, below. |
| `created_at`, `updated_at` | timestamps | |

`TemplateConfig` (versioned so later sub-projects can add to it):

```jsonc
{
  "config_version": 1,
  "slots": [
    { "key": "ortho", "label": "Orthomosaic", "route": "map", "required": true,
      "accepts": ["tif", "tiff"], "match": { "raster": "ortho" } }
  ],
  "types": [
    { "name": "Erosion / washout", "kind": "defect", "colour": "#ff9c3a",
      "default_severity": 3, "hotkey": "2",
      "definition": "…", "severity_rules": [ { "when": "…", "severity": 4 } ] }
  ]
}
```

`route` is one of `images`, `map`, `elevation`, `pointcloud`, `drawing`, and after S4 `video`. It
names the existing importer a slot feeds. `match` narrows the classifier within a route (§7.2).

Seeding: `catalogue/handle.py` seeds the three built-ins once, the same way it seeds the severity
scale. A built-in with a fixed id that already exists is left untouched, so a seed runs at most once
per id. If migration `0003` fails, the app logs it and opens (AGENTS.md invariant); templates are
then hidden and the page shows Blank only.

### 5.1 Built-in templates

| Template | Slots (route · required) | Types (kind · default severity · hotkey) |
|---|---|---|
| **Mapping and survey** | Orthomosaic (map · req), Elevation DSM/DTM (elevation), Design surface / CAD (drawing), Raw drone images (images) | Stockpile (object · 1 · 1), Erosion / washout (defect · 3 · 2), Standing water (defect · 2 · 3), Unapproved machinery (object · 2 · 4), Slope failure (defect · 4 · 5), Vegetation encroachment (defect · 1 · 6) |
| **Vertical asset inspection** | Visual photos (images · req), Thermal photos (images, `match.thermal`), 3D point cloud (pointcloud), Asset drawings (drawing) | Corrosion (defect · 2 · 1), Coating damage (defect · 1 · 2), Loose / missing bolt (defect · 3 · 3), Antenna misalignment (defect · 3 · 4), Bird nest (object · 2 · 5), Thermal hot spot (defect · 4 · 6), Cracked weld (defect · 4 · 7) |
| **Confined space inspection** | Inspection video (video · req, *after S4*), Stills (images), LiDAR scan (pointcloud), Structure drawings (drawing) | Pitting corrosion (defect · 3 · 1), Weld crack (defect · 4 · 2), Liner blistering (defect · 2 · 3), Deposits / scale (defect · 1 · 4), Wall deformation (defect · 3 · 5), Leak / seepage (defect · 4 · 6), Debris / foreign object (object · 1 · 7) |

Every built-in type ships with a one- or two-sentence `definition`; severity rules are left empty in
S1 (S2 fills them). Until S4 merges, the Confined template's video slot is shown disabled with
"Video import is coming", and Stills is the required slot.

## 6. Resolving template types

`POST /catalogue/types/ensure` with `{ types: TemplateType[] }` (at most 64) returns
`{ items: [{ name, id, created: bool, conflict: null | { kind, colour } }] }`.

- The match is on `name_key` (`catalogue/names.py`), including archived types, which are unarchived.
- A miss creates the type with the template's fields and `origin = "template"`.
- A match leaves the catalogue row unchanged and reports any kind or colour difference as `conflict`
  (S1-3).
- It runs in one catalogue transaction: all types or none.

The page calls `ensure` when the operator presses **Create**, then passes the ids and hotkeys to
`POST /projects`. A preview call with `dry_run: true` runs when the anomaly list settles (300 ms
debounce), so conflicts show before create.

## 7. Drop-folder sorting

### 7.1 The job

`POST /setup/inspect` with `{ paths: string[] (1–16 absolute paths, files or folders), template_id? }`
returns 202 with a `Job` on the library handle, type `setup_inspect`. Progress is reported per
folder walked and per header read. The result lands in `Job.result` as `InspectResult`.

### 7.2 The classifier (`backend/app/setup/classify.py`)

A pure function per file, fed only by the extension and, where needed, a header read:

| Evidence | Route | Header read |
|---|---|---|
| `.tif/.tiff` with 3–4 bands of `uint8` | `map` (`match.raster = "ortho"`) | rasterio header only (bands, dtype, CRS) |
| `.tif/.tiff` with 1 band of float or `int16` | `elevation` | same |
| `.jpg/.jpeg/.dng` | `images`; `thermal` when the DJI name ends `_T` or the XMP says thermal | EXIF + DJI XMP (`datasets/prepare.py`) on a sample of 20 files per folder; the rest follow the filename pattern |
| `.las/.laz` | `pointcloud` | the existing LAS header inspect (`pointclouds/service.py`) |
| `.pdf/.dxf/.xml` (LandXML root) | `drawing` | for `.xml`, the root element only |
| `.mp4/.mov` | `video` after S4; before that, *Not supported yet* | none |
| anything else, or a header that fails to read | *Not recognised* (with reason) | — |

The `images` route groups files by folder. One source per folder, the same rule `POST /sources` uses
today.

### 7.3 The result

```jsonc
{
  "buckets": [
    { "route": "images", "match": { "thermal": true }, "slot_key": "thermal",
      "folder": "E:\\DCIM\\100MEDIA", "count": 88, "bytes": 412000000,
      "samples": ["DJI_0001_T.JPG", "…"], "crs": null }
  ],
  "not_recognised": { "count": 2, "samples": [ { "name": "Thumbs.db", "reason": "unknown type" } ] },
  "suggested_template_id": "builtin-vertical",
  "truncated": false
}
```

`slot_key` is assigned when `template_id` was given; the page re-assigns buckets to slots locally when
the template changes (routes and `match` are enough, no second job). `suggested_template_id` is the
built-in whose required slots are filled by the most buckets; it is shown only when the chosen
template is Blank or has an empty required slot while another template's is filled.

### 7.4 Create and import

On **Create project**, the page:

1. calls `ensure` (§6), then `POST /projects` with `{ name, folder, type_ids, hotkeys }`;
2. navigates to the new project's Overview;
3. for every bucket assigned to a slot, calls that route's existing import endpoint (images: one
   `POST /sources` per folder; map, elevation, point cloud: one call per file; drawing: inspect then
   build).

`POST /sources` imports whole folders, and a DJI M30T writes its `_V` and `_T` photos into the same
folder. So in S1 the visual/thermal split is a sorting and display distinction only: when both kinds
share a folder, the two slots show their own counts, but the folder is imported once, as one source,
and the Data card says "Visual and thermal photos in the same folder are imported together". Keeping
thermal images apart inside a project (a per-image flag, or a file list on `POST /sources`) is
deferred (§15).

Steps 2 and 3 do not wait on each other. The dispatcher lives in a small store
(`frontend/src/setup/dispatch.ts`) so that it keeps running across navigation. Each call's failure
is kept against its slot; the Overview shows a "Setup: 1 import failed · Retry" notice until it is
retried or dismissed.

## 8. The setup page (frontend)

Route `/projects/new`, reached from Projects → **New project** and the command palette ("New
project"). `NewProjectDialog.tsx` and its test are deleted; the name and folder checks and their
tests move to the page. Built only from `frontend/src/ui` primitives (UI work loads the design skills
and `DESIGN.md` first, AGENTS.md rule 3).

```
frontend/src/setup/
  SetupPage.tsx          route component: the grid of cards + summary
  TemplateCard.tsx       built-ins, saved templates, Blank
  BasicsCard.tsx         name, folder (reuses FolderField)
  DataCard.tsx           drop area, inspect job state, slot grid, per-slot picker
  AnomaliesCard.tsx      rows, expand for definition/rules, add from Catalogue, new type
  SummaryCard.tsx        checklist, Create, Save as my template
  draftStore.ts          the draft (survives navigation until Create or Discard)
  remap.ts               buckets → slots for a template (pure)
  dispatch.ts            create-then-import (pure sequencing + store)
```

Behaviour:

- **Template.** Selecting a template fills slots and types. If the operator has edited the anomaly
  list, an inline choice appears: *Replace the anomaly list* / *Keep mine and add the new ones*.
  Sorted buckets are remapped with `remap.ts`. Buckets that fit no slot of the new template are
  listed under "Not used by this template" and can be dragged to any slot.
- **Data.** Dropping or browsing a folder starts `setup_inspect`; the card shows the job's progress
  and then the slots with count, size and a Ready state. A bucket can be dragged to another slot or
  skipped. Each slot also has **Browse** for picking files into just that slot (the same inspect job
  with one path).
- **Anomalies.** Rows show colour, name, kind, a severity picker, a hotkey, and a conflict note
  (S1-3). A row expands to show and edit `definition` and `severity_rules`. **Add from Catalogue**
  uses the Combobox over catalogue types; **New type** opens an inline form (name, kind, colour,
  severity, hotkey). Hotkey clashes inside the list are flagged before create.
- **Summary.** Template ✓, Name and folder ✓, "n of m slots" with a warning for each empty required
  slot, "n anomaly types". **Create project** is enabled when name and folder are valid.
  **Save as my template** asks for a name inline and saves slots and types (never the name, folder
  or files). A saved template can be renamed or deleted from its card's menu.
- **Below 1100 px** the summary becomes a sticky bottom bar with the checklist in a Popover.
- **Catalogue unavailable:** only Blank is offered, with today's message; the page still creates the
  project (types can be added later).

The Catalogue screen's `TypeEditor` gains the `definition` field and a rules list (add, reorder,
remove; severity picker per rule).

## 9. API (contract first; tag `setup` plus changes under `catalogue` and `projects`)

| Method and path | Body → response | Notes |
|---|---|---|
| `GET /project-templates` | → `{ items: ProjectTemplate[] }` | built-ins first, then by name |
| `POST /project-templates` | `ProjectTemplateCreate` → `ProjectTemplate` (201) | 409 `template_name_taken` |
| `PATCH /project-templates/{id}` | `{ name?, description?, config? }` → `ProjectTemplate` | 409 `template_builtin` |
| `DELETE /project-templates/{id}` | → 204 | 409 `template_builtin` |
| `POST /catalogue/types/ensure` | `{ types, dry_run? }` → `EnsureTypesResult` | §6 |
| `POST /setup/inspect` | `{ paths, template_id? }` → 202 `{ job }` | result schema `InspectResult` |
| `POST /projects` | `ProjectCreate` + optional `hotkeys` | S1-8 |
| `CatalogueType`, `CatalogueTypeCreate`, `CatalogueTypeUpdate` | + `definition`, `severity_rules` | |

`contract/client/schema.d.ts` is regenerated and committed in the same change as `openapi.yaml`.

## 10. Budget

**Background jobs:** `setup_inspect` (new), and the existing `import`, `map_import`,
`elevation_import`, `pointcloud_import`, `drawing_import` jobs started on create. No request in S1
does long work in the request.

**Bounded reads:**

- The inspect walk stops at **50,000 files** and sets `truncated: true`; the page says "Stopped at
  50,000 files. Drop a narrower folder."
- Header reads: at most 20 image files per folder (EXIF/XMP only, never pixel data); one rasterio
  header per GeoTIFF; one LAS header per point cloud; the root element for `.xml`. No image, raster
  or cloud body is read.
- `InspectResult` keeps at most **200 sample names per bucket** and 50 not-recognised samples; counts
  and bytes are totals.
- `ensure` takes at most 64 types; a template holds at most 64 types and 16 slots.

## 11. Errors and edge cases

| Case | Behaviour |
|---|---|
| Catalogue unavailable | Blank only, with the existing message; create still works with no types. |
| Migration `0003` fails | Logged; app opens; templates hidden; `definition`/`severity_rules` absent from the editor. |
| A dropped path does not exist or is unreadable | The job skips it and lists it under Not recognised with the reason. |
| A file's header fails to read | Not recognised, reason "could not read header"; the rest continues. |
| The operator cancels the inspect job | The Data card returns to its empty state; nothing was copied. |
| The folder is changed after inspect | The buckets stay; they point at the original files, which the imports copy. |
| `ensure` fails | Create stops before `POST /projects`; the error shows in the summary; nothing was created. |
| `POST /projects` fails after `ensure` created types | The new catalogue types stay (they are valid types); the error shows; retry reuses them. |
| One import fails | S1-7: that slot shows the error and Retry, in the setup notice on the Overview. |
| Hotkey clash in the list | Flagged on the row; Create is blocked until resolved. |
| A saved template's name is taken | Inline error on the save field. |

## 12. Testing

**Backend (pytest):**

- Migration `0003` upgrades a `0002` catalogue with types and keeps them; downgrade drops the new
  table and columns.
- Built-ins are seeded once; a second start does not duplicate or overwrite them.
- Template CRUD; built-ins refuse PATCH/DELETE; name uniqueness by `name_key`.
- `ensure`: reuse on match (including archived → unarchived), create on miss with
  `origin = "template"`, conflict reported on kind or colour, all-or-nothing on a failure, `dry_run`
  writes nothing.
- The classifier on small fixtures: a 3-band `uint8` GeoTIFF, a 1-band float GeoTIFF, a LAS, a DJI
  `_V`/`_T` JPEG pair with XMP, a PDF, a LandXML, a DXF, a `.mp4`, and junk.
- The inspect job: the 50,000-file cap sets `truncated` (with a generated tree of empty files), the
  20-per-folder header sample (the reader is counted), the 200-sample cap, an unreadable path.
- `POST /projects` with `hotkeys` sets them; an invalid hotkey is 422 before the folder is touched.
- Severity rule validation: a level not on the scale is 422; more than 8 rules is 422.

**Frontend (vitest):**

- `remap.ts`: every built-in pair of templates, including buckets that fit no slot.
- The replace-or-keep choice on a template switch.
- `draftStore`: survives unmounting; cleared by Create and Discard.
- `dispatch.ts`: order (ensure → create → imports), one failing import keeps the others and records
  the failure, Retry re-runs only that slot.
- Summary: Create enablement, required-slot warnings, hotkey clash blocking.
- `TypeEditor`: definition and rules editing.

**e2e (Playwright, `pnpm -C frontend e2e`):** open New project → choose Vertical asset → drop the
fixture folder → buckets appear in Visual and Thermal → Create → the project's Overview opens with
the import jobs running → the Catalogue shows the template's types.

**Contract:** `pnpm -C contract check` (Spectral lint, generated client up to date).

## 13. Success criteria

1. From the Projects screen, a vertical asset project with visual and thermal photos and 7 anomaly
   types is created in one page, and its imports run in the background.
2. The same delivery folder dropped with the Mapping template sorts the ortho and DSM into their
   slots with no manual moves.
3. No step reads image pixels, a raster body or a point body before the import jobs run.
4. A saved template reproduces its slots and types in a new project.
5. All the gates in AGENTS.md rule 4 pass.

## 14. Execution DAG

Units (each a task worktree, SDD):

| Unit | Content | Depends on |
|---|---|---|
| **U1** | Catalogue migration `0003`, the models, and the whole §9 contract (+ regenerated client) | — |
| **U2** | Template API, built-in seeding, `ensure` | U1 |
| **U3** | `setup_inspect` job and classifier | U1 |
| **U4** | Catalogue `TypeEditor`: definition and rules | U1 |
| **U5** | The setup page (§8), against the Prism mock until U2/U3 merge | U1 |
| **U6** | Create-then-import dispatch, the Overview notice, e2e | U2, U3, U5 |

Parallel batches: **[U1] → [U2, U3, U4, U5] → [U6]**.
Critical path: **U1 → U3 → U6** (U5 runs alongside U3 on the mock).

S4 (video) runs in parallel with all of S1 in its own worktree. Its only contact with S1 is the
`video` route: whichever merges second adds the classifier row and enables the Confined template's
video slot.

## 15. Deferred

- S2, S3, S4 (§2).
- Project metadata (asset id, CRS override, previous inspection link).
- Importers for GCP, UT readings, previous reports, KML boundaries, E57.
- The Setup agent opening this page pre-filled.
- Keeping visual and thermal images from one folder apart (a per-image thermal flag or a file list on
  `POST /sources`).
- Sharing templates between machines (export/import of a template file).

## 16. Risks

- **Misclassification.** A 3-band `uint16` GeoTIFF or a DSM stored as `uint8` lands in the wrong
  slot. Mitigation: buckets are draggable, and the classifier's rules are table-driven so a new case
  is one row and one fixture.
- **Catalogue growth.** Every template create can add types. Mitigation: reuse by `name_key`, and
  `origin = "template"` so the Catalogue can filter them.
- **Two sources of truth for hotkeys** (catalogue type hotkey vs project hotkey). S1 writes only the
  project hotkey on create; the catalogue hotkey of a reused type is not changed.
