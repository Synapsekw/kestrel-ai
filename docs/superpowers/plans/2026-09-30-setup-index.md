# Project setup (sub-project S1): execution index

> **For agentic workers:** this is the coordinator's map of the S1 unit plans. Each unit is
> executed with superpowers:subagent-driven-development in its own worktree. Read the unit plan you
> were given, this index, the spec and the programme rulings. Do not execute this index itself.

**Spec:** `docs/superpowers/specs/2026-09-30-project-setup-design.md` (operator-approved 2026-09-30).
Written against `main` at `35534daf` (Reports R0 and R8 merged; catalogue migration head `0002`).
**Binding, in order:** this index's "Interface decisions" and "Coordinator rulings", then
`.superpowers/sdd/imc-common/programme-rulings.md` (R1, R5, R6, R10 apply unchanged), then the spec.
The index wins over a unit plan where they differ; it is what lets the plans be written in parallel.

**Goal:** land the new-project setup page (layout A) on `main`: project templates (three built-ins
plus user templates), a `setup_inspect` job that sorts a dropped folder into the template's slots
from headers only, create-then-import through the existing importers, and catalogue types with a
`definition` and `severity_rules`.

## Unit plans

| Unit | Plan | Worktree / branch | e2e ports | Cut after |
| --- | --- | --- | --- | --- |
| S1-U1 contract (all of spec §9), catalogue migration `0003` (columns, `project_template`, built-in seed), ORM, pydantic schemas, 501 stubs, `setup_inspect` job type name | `2026-09-30-setup-u1.md` | `s-u1` / `task/s-u1` | 5800–5809 | `main` now |
| S1-U2 template service + CRUD, `POST /catalogue/types/ensure`, `definition`/`severity_rules` through the catalogue service and CRUD, `ProjectCreate.hotkeys` | `2026-09-30-setup-u2.md` | `s-u2` / `task/s-u2` | 5810–5819 | U1 |
| S1-U3 `setup_inspect` job, classifier, `POST /setup/inspect` | `2026-09-30-setup-u3.md` | `s-u3` / `task/s-u3` | 5820–5829 | U1 |
| S1-U4 Catalogue `TypeEditor`: definition and severity rules | `2026-09-30-setup-u4.md` | `s-u4` / `task/s-u4` | 5830–5839 | U1 |
| S1-U5 the setup page (`frontend/src/setup/`, route `/projects/new`), against the Prism mock | `2026-09-30-setup-u5.md` | `s-u5` / `task/s-u5` | 5840–5849 | U1 |
| S1-U6 create-then-import dispatch, the Overview setup notice, e2e journey, evidence (walkthrough, `docs/progress.md`, ADRs) | `2026-09-30-setup-u6.md` | `s-u6` / `task/s-u6` | 5850–5859 | U2, U3, U5 |

## Execution DAG, batches and merge order

```
batch 0:  U1
batch 1:  (cut after U1)  U2 ∥ U3 ∥ U4 ∥ U5
batch 2:  (cut after U2, U3, U5)  U6
```

Merge order in batch 1: U2, U3, U4, U5, each in the order it is ready. U5 codes against the U1
contract and the Prism mock, and never against U2/U3 internals, so it may merge before them.
**Critical path:** U1 → U3 (the classifier and its fixtures are the largest backend unit) → U6.
**Near-critical:** U1 → U5 (the largest frontend unit) → U6.

S4 (video import) is a separate sub-project running in parallel. Its only contact with S1 is the
`video` route: `SlotRoute` already contains `video` (U1), U3's classifier maps `.mp4/.mov` to
*not supported yet* until S4 merges, and whichever of S4 and S1-U3 merges second switches it on.

## Interface decisions (binding; the unit plans implement these names)

### Contract (U1 writes all of it; nobody else edits `contract/openapi.yaml` in S1)

New tag `setup`. All new request schemas have `additionalProperties: false`. There is **no
`default:`** in any new schema (ADR `2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript`);
a request default goes in the description. Descriptions in flow mappings are double-quoted (ADR
`2026-09-26-gotcha-yaml-flow-mapping-comma-splits-a-description`).

| operationId | Method and path | Request → response | Errors |
| --- | --- | --- | --- |
| `listProjectTemplates` | `GET /api/v1/project-templates` | → `ProjectTemplatePage` | 503 `catalogue_unavailable` |
| `createProjectTemplate` | `POST /api/v1/project-templates` | `ProjectTemplateCreate` → 201 `ProjectTemplate` | 409 `template_name_taken`, 422 `invalid_template`, 503 |
| `patchProjectTemplate` | `PATCH /api/v1/project-templates/{templateId}` | `ProjectTemplatePatch` → `ProjectTemplate` | 404, 409 `template_builtin`, 409 `template_name_taken`, 422 `invalid_template`, 503 |
| `deleteProjectTemplate` | `DELETE /api/v1/project-templates/{templateId}` | → 204 | 404, 409 `template_builtin`, 503 |
| `ensureCatalogueTypes` | `POST /api/v1/catalogue/types/ensure` (tag `catalogue`) | `EnsureTypesRequest` → `EnsureTypesResult` | 422 `invalid_severity_rule`, 503 |
| `startSetupInspect` | `POST /api/v1/setup/inspect` | `SetupInspectRequest` → 202 `JobRef` | 422, 503 `library_unavailable` |
| (existing) `createProject` | `POST /api/v1/projects` | `ProjectCreate` gains optional `hotkeys` | 422 for an invalid hotkey, before the folder is touched |

Schemas (exact names and properties):

- `SeverityRule` `{ when: string (1–200), severity: integer (1–9) }`, both required.
- `CatalogueType` gains required `definition: string | null` (maxLength 1000) and required
  `severity_rules: SeverityRule[]` (maxItems 8). `origin` enum becomes `[user, migrated, template]`.
  `CatalogueTypeCreate` and `CatalogueTypePatch` gain optional `definition` (nullable) and
  `severity_rules`.
- `CatalogueTypeSpec` `{ name (1–64), kind: CatalogueKind, colour: hex | null, default_severity: 1–9 | null,
  hotkey: string | null (pattern `^[1-9A-Za-z]$`), definition: string | null (≤1000),
  severity_rules: SeverityRule[] (≤8) }`; `name` and `kind` required in requests; every property
  required when it appears inside `ProjectTemplate` (a response).
- `EnsureTypesRequest` `{ types: CatalogueTypeSpec[] (1–64), dry_run?: boolean }` ("false when absent").
- `TypeConflict` `{ kind: CatalogueKind, colour: string }`.
- `EnsuredType` `{ name: string, id: string | null, created: boolean, conflict: TypeConflict | null }`
  (`id` is null only for a dry-run miss).
- `EnsureTypesResult` `{ items: EnsuredType[] }` (same order as the request).
- `SlotRoute` enum `[images, map, elevation, pointcloud, drawing, video]`.
- `SlotMatch` `{ raster?: "ortho" | "elevation", thermal?: boolean }`.
- `TemplateSlot` `{ key: string (pattern `^[a-z][a-z0-9_]{0,31}$`), label: string (1–48),
  route: SlotRoute, required: boolean, accepts: string[] (1–12, lower-case extensions without the
  dot), match: SlotMatch | null }`.
- `TemplateConfig` `{ config_version: 1 (const), slots: TemplateSlot[] (≤16), types: CatalogueTypeSpec[] (≤64) }`.
- `ProjectTemplate` `{ id, name, description, builtin, config: TemplateConfig, created_at, updated_at }`.
- `ProjectTemplatePage` `{ items: ProjectTemplate[] }` (built-ins first, then by name).
- `ProjectTemplateCreate` `{ name (1–80), description? (≤300, "empty when absent"), config }`.
- `ProjectTemplatePatch` `{ name?, description?, config? }`.
- `SetupInspectRequest` `{ paths: string[] (1–16, absolute), template_id?: string }`.
- `InspectBucket` `{ route: SlotRoute, match: SlotMatch, slot_key: string | null, folder: string,
  files: string[] (≤200; empty for `images`, which import by folder), count: integer, bytes: integer,
  samples: string[] (≤200 file names), crs: string | null }`.
- `InspectSkipped` `{ name: string, reason: string }`.
- `InspectNotRecognised` `{ count: integer, samples: InspectSkipped[] (≤50) }`.
- `InspectResult` `{ buckets: InspectBucket[], not_recognised: InspectNotRecognised,
  suggested_template_id: string | null, truncated: boolean }`. The `Job.result` description names it
  as the result of `setup_inspect`.
- `JobType` enum gains `setup_inspect` (append only).
- `ProjectCreate.hotkeys` `{ [typeId]: string | null }`, same meaning as `PUT /projects/{id}/types`.

Error codes (append to the `Error.code` description): `template_builtin`, `template_name_taken`,
`invalid_template`, `invalid_severity_rule`.

### Backend

| Module | Owner | Provides |
| --- | --- | --- |
| `app/catalogue/db.py` | U1 | `CatalogueType.definition: Mapped[str | None]` (`Text`), `CatalogueType.severity_rules: Mapped[list]` (`JSON`, default `[]`, server default `'[]'`); origin check `('user', 'migrated', 'template')`; new ORM `ProjectTemplate` (`project_template`: `id String(64)`, `name`, `name_key` (unique index), `description` (default `""`), `builtin` (default false), `config JSON`, `created_at`, `updated_at`) |
| `app/catalogue/migrations/versions/0003_project_setup.py` | U1 | `revision = "0003"`, `down_revision = "0002"`; adds the two columns (batch mode), widens the origin check, creates `project_template`, seeds the 3 built-ins from a frozen literal copy of `app/setup/builtins.py`; imports nothing from `app.*` |
| `app/setup/builtins.py` | U1 | `BUILTIN_TEMPLATES: list[dict]` with ids `builtin-mapping`, `builtin-vertical`, `builtin-confined` (slots and types per spec §5.1, every type with a 1–2 sentence `definition`, empty `severity_rules`) |
| `app/catalogue/schemas.py` | U1 | `SeverityRule`, `CatalogueTypeSpec`, `EnsureTypesRequest`, `TypeConflict`, `EnsuredType`, `EnsureTypesResult`; `CatalogueTypeOut`/`Create`/`Patch` + `definition`, `severity_rules`; `TypeOrigin` + `"template"` |
| `app/setup/schemas.py` | U1 | `SlotRoute`, `SlotMatch`, `TemplateSlot`, `TemplateConfig`, `ProjectTemplateOut`, `ProjectTemplatePage`, `ProjectTemplateCreate`, `ProjectTemplatePatch`, `SetupInspectRequest`, `InspectBucket`, `InspectSkipped`, `InspectNotRecognised`, `InspectResult` |
| `app/setup/router.py` | U1 stubs (501) → U2 (template routes), U3 (inspect route) | an aggregating `APIRouter` including `routes_templates.py` (U2) and `routes_inspect.py` (U3); registered in `app/api.py` in one guarded `try/except` block like Reports |
| `app/catalogue/router.py` `ensure` route | U1 stub → U2 | `POST /catalogue/types/ensure` |
| `app/catalogue/service.py` | U2 | `CatalogueTypeRef` gains `definition: str | None = None`, `severity_rules: tuple = ()` (appended last, defaulted); `create_type`/`patch_type` accept both; `_check_rules(s, rules)` → 422 `invalid_severity_rule` when a level is not on the current scale |
| `app/catalogue/template_types.py` | U2 | `ensure_template_types(cat, specs: Sequence[CatalogueTypeSpec], *, dry_run: bool) -> list[EnsuredType]`: match by `normalise_name` including archived (an archived match is unarchived, its catalogue hotkey cleared if now taken), create on a miss with `origin="template"`, report `TypeConflict` on a kind or colour difference, one transaction. The existing `ensure_types` is **not** changed |
| `app/setup/templates.py` | U2 | `list_templates(cat)`, `create_template(cat, body)`, `patch_template(cat, id, body)`, `delete_template(cat, id)`; `validate_config(config)` → 422 `invalid_template` for duplicate slot keys, duplicate type names (by `normalise_name`) or duplicate hotkeys |
| `app/projects/*` | U2 | `ProjectCreate.hotkeys`; `ProjectRegistry.create(name, folder, type_ids, hotkeys=None)` applies them in the same session through `project_types.set_types`; hotkeys are validated before the folder is touched |
| `app/setup/classify.py` | U3 | `classify(path: Path, reader: HeaderReader) -> Classified` (`route: SlotRoute | None`, `match: dict`, `crs: str | None`, `reason: str | None`); `HeaderReader` protocol with `raster(path)`, `image_meta(path)`, `las(path)`, `xml_root(path)` so tests inject fakes and count reads |
| `app/setup/inspect_job.py` | U3 | `@register_job_type("setup_inspect")`; constants `MAX_FILES = 50_000`, `HEADER_SAMPLE_PER_FOLDER = 20`, `MAX_SAMPLES = 200`, `MAX_NOT_RECOGNISED = 50`; `assign_slots(buckets, config) -> buckets` and `suggest_template(buckets, templates) -> str | None` (pure, reused by nothing else in S1 but kept public for S3) |
| `app/setup/routes_inspect.py` | U3 | `POST /setup/inspect` submits on the **library handle** (`app.library.handle.get_library`); the job is read through the existing `GET /library/jobs/{jobId}` |

### Frontend

| Path | Owner | Provides |
| --- | --- | --- |
| `frontend/src/catalogue/TypeEditor.tsx` (+ `SeverityRulesEditor.tsx`) | U4 | the definition field and the rules list (add, reorder, remove, severity picker per rule) |
| `frontend/src/setup/api.ts` | U5 | typed wrappers: `listTemplates`, `createTemplate`, `patchTemplate`, `deleteTemplate`, `ensureTypes`, `startInspect`, `readInspectJob` (via `GET /library/jobs/{jobId}`, casting `result` to `InspectResult`) |
| `frontend/src/setup/draftStore.ts` | U5 | zustand store `useSetupDraft` with `SetupDraft { templateId: string \| null; name: string; folder: string; slots: TemplateSlot[]; buckets: DraftBucket[]; types: DraftType[]; typesEdited: boolean }`, `DraftBucket = InspectBucket & { id: string; skipped: boolean }`, `DraftType = CatalogueTypeSpec & { key: string }`; actions `chooseTemplate(t, mode: "replace" \| "keep")`, `setBuckets`, `moveBucket(id, slotKey \| null)`, `skipBucket(id)`, `setType`, `addType`, `removeType`, `discard()` |
| `frontend/src/setup/remap.ts` | U5 | `remap(buckets: DraftBucket[], slots: TemplateSlot[]): DraftBucket[]` (pure; route + match decide) |
| `frontend/src/setup/SetupPage.tsx` and the cards | U5 | route `projects/new` in `frontend/src/routes/tree.tsx`; **Create project** calls `onCreate(draft)` from `SummaryCard`, which U5 wires to a placeholder that only calls `ensureTypes` + `POST /projects` and navigates; U6 replaces it |
| `frontend/src/setup/dispatch.ts` | U6 | `runSetup(api, draft): Promise<{ projectId: string }>` (ensure → create → navigate) and a `useSetupImports` store that starts each bucket's import and keeps `SlotImport { slotKey; state: "pending" \| "started" \| "failed"; error?: string }` per project |
| `frontend/src/overview/SetupNotice.tsx` | U6 | "Setup: n import(s) failed · Retry" on the project Overview |
| `frontend/src/screens/projects/NewProjectDialog.tsx` | U5 deletes | ProjectsScreen's **New project** navigates to `/projects/new`; the command palette gains "New project" |

## Budget (spec §10; each unit plan restates its share)

- **Background jobs:** `setup_inspect` (U3, new). On create, U6 starts the existing `import`,
  `map_import`, `elevation_import`, `pointcloud_import` and `drawing_import` jobs. No S1 request does
  long work inside the request.
- **Bounded reads:** the walk stops at 50,000 files (`truncated: true`); headers only, at most 20
  image files per folder (EXIF/XMP, never pixels), one rasterio header per GeoTIFF, one LAS header per
  cloud, the root element of an `.xml`; `InspectResult` keeps ≤200 samples and ≤200 files per bucket
  and ≤50 not-recognised samples; `ensure` ≤64 types; a template ≤16 slots and ≤64 types. The
  frontend never lists a folder itself.

## Shared-file touches (outside `backend/app/setup/`, `frontend/src/setup/`)

| File | Unit | Touch |
| --- | --- | --- |
| `contract/openapi.yaml`, `contract/client/schema.d.ts` | U1 | append only: tag, paths, schemas, `JobType`, `Error.code`, `Job.result` descriptions; `CatalogueType*` and `ProjectCreate` properties |
| `backend/app/api.py` | U1 | one guarded include of `app.setup.router` |
| `backend/app/catalogue/db.py`, `schemas.py` | U1 | columns and schemas as above |
| `backend/app/catalogue/service.py`, `router.py` | U2 | ref fields, rules check, the `ensure` route |
| `backend/app/projects/schemas.py`, `service.py`, `router.py` | U2 | `hotkeys` |
| `frontend/src/routes/tree.tsx` | U5 | the `projects/new` route |
| `frontend/src/screens/ProjectsScreen.tsx` | U5 | New project navigates |
| `frontend/src/overview/*` | U6 | mounts `SetupNotice` |
| `frontend/src/catalogue/TypeEditor.tsx` | U4 | definition + rules |
| `docs/progress.md`, `vault/decisions/` | U6 | evidence entry, ADRs |

## Coordinator rulings

- **S-R1. Built-ins are seeded by migration `0003`**, from a frozen literal copy of
  `app/setup/builtins.py`, like `0002` seeds report templates. The spec's §5 said `handle.py`; the
  migration is the codebase's pattern and runs exactly once per database. A test pins that the
  migration's copy equals `BUILTIN_TEMPLATES`.
- **S-R2. `ensure` is a new function**, `ensure_template_types`. The existing `ensure_types` (used by
  the Setup agent, class maps, the library port and MG) keeps its behaviour, including "an archived
  name gets a new live type". Spec §6 (unarchive on match) applies only to the new function.
- **S-R3. `setup_inspect` runs on the library handle** because no project exists yet. When the
  library is unavailable the Data card says so and offers no drop area; the project can still be
  created and data imported later from its tabs.
- **S-R4. Thermal and visual images in one folder** are sorted into two buckets with the same
  `folder`; on create they produce **one** `POST /sources` (U6 de-duplicates by folder). Spec §7.4.
- **S-R5. U5 ships a working Create** (ensure + create + navigate, no imports) so the page is usable
  when U5 merges before U6; U6 replaces the handler and adds the imports.
- **S-R6. `video` buckets** are shown and never dispatched until S4 lands (U6 skips `route ===
  "video"` with the slot note "Video import is coming").

## Unit S1-U6: evidence and close-out

U6 is the last unit: the e2e journey (spec §12), the operator walkthrough ("how to test this"), a
`docs/progress.md` entry, and ADRs for any trap found during the build. It does not build an
installer (programme ruling R9).

## Reconciliation log (planning, 2026-09-30; binding over the unit plans)

- **S-R7** Shrinking the severity scale drops severity rules above the new top level and keeps the
  rest in order (mirrors how `put_scale` clears a `default_severity`). U2.
- **S-R8** `listCatalogueTypes` `origin` filter accepts `template`; `ensureCatalogueTypes` declares
  422 `type_name_blank`; `SlotMatch` never serialises `None` keys. U1 (contract), U2 (route).
- **S-R9** `ProjectRegistry.create` keeps `add_types` for the initial list and calls `set_types` only
  when `hotkeys` is given, so a plain create never gains a new 409. A hotkey for a type id not in
  `type_ids` is 422 `hotkey_invalid`. U2.
- **S-R10** `.dng` is Not recognised (the images importer cannot read it) and is not in any slot's
  `accepts`. Every GeoTIFF gets its one header read (ortho vs elevation is per file; bounded by
  `MAX_FILES`). `MAX_FOLDERS = 10_000` also sets `truncated`. U1, U3.
- **S-R11** `remap.ts` (U5) uses exactly `assign_slots`'s (U3) fit rule: equal route; every key the
  slot's `match` names equals the bucket's (missing `thermal` = false); `match: null` takes all of its
  route; most keys named wins; ties go to template order. U1 adds the `setup_inspect` entries to every
  frontend `Record<Job["type"], …>` label map in the JobType commit.
- **S-R12** `POST /sources` is recursive: U6 dispatches photos once per top-most folder, and does not
  start a photo folder with a map/elevation bucket in or under it (the importer would take GeoTIFFs as
  photos); that slot shows as failed with a fix-and-Retry message. Drawings build unattended with the
  Add data defaults; a multi-page PDF or a request the defaults refuse ends in `needs_choice` with
  **Finish drawing import**. Elevations import as DSM. `SlotImport` gains `label`, `failed` and state
  `needs_choice`.
- **S-R13** U5's Data card has a text field "Folder or file path" and a button "Sort files" (always
  shown; e2e drives it). Files past a bucket's 200-path list are reported in the notice ("<n> more
  files in <folder> were not started — import them from the <tab> tab"), never silently skipped.
- **S-R14** Buckets move with pointer events plus a **Move** menu: Tauri's `dragDropEnabled` (needed
  for OS folder drops) blocks HTML5 drag in WebView2. Follow-up outside S1: map-layer reordering
  (`mapws/chrome/LayerRowView.tsx`) likely has the same problem in the installed app.
- **S-R15** U6 imports a bucket through its **slot's** route (a GeoTIFF moved to the Elevation slot
  goes to `/elevations`) and reads only `slots`, `buckets`, `types` from the draft (U5 adds more
  fields). U6 wires U4's `SeverityRulesEditor` into `TypeRow` if U5 shipped rules read-only.
- **S-R16** `InspectResult.buckets` `maxItems: 500`; U3 `MAX_BUCKETS = 500` sets `truncated`. U2
  deletes U1's `exclude` of the new fields in `create_catalogue_type`. `CatalogueTypeSpec` optional
  fields are read with `?? null` in the frontend. S4 flips the Confined template's video slot to
  required in its own catalogue revision (`0003` is frozen).

Additional shared-file touches: `frontend/src/app/routeModel.ts`, `frontend/src/app/paletteCommands.ts`,
`frontend/src/test/render.tsx`, `frontend/e2e/projects.spec.ts`, `frontend/e2e/foundation-journey.spec.ts`
(U5); every frontend job-label map (U1); `frontend/src/test/appSectionFixtures.ts` (U1);
`backend/app/datasets/prepare.py` (`xmp_fields` split out, U3); `frontend/src/app/Banners.tsx` (U6).
Live hand-off list: `.superpowers/sdd/setup-common/handoffs.md` (git-ignored).
