# Foundation C0 (contract) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Where to work.** The executor builds in its own worktree, `E:\Dev\Yolo\app\.claude\worktrees\f-c0`, on branch `task/f-c0`, cut from the newest `main` with `scripts\start-task.ps1 f-c0` (Task 1, Step 1). Never build in the main checkout or in another unit's worktree. Commands are Windows PowerShell 5.1 unless a step says otherwise, run from the worktree root. Backend commands run from `<worktree>\backend` with the shared interpreter (a worktree has no venv of its own, `CONTRIBUTING.md` → "Testing").

**Goal:** Land the whole foundation contract (spec §13) on `main` in one unit, with the regenerated client, Prism examples, 501 stubs for every new operation, and the smallest frontend and test changes that keep every gate green, so the batch-2 units (DS, BK, BC, BM, MG) never edit `contract/openapi.yaml` except to retire what this unit deprecates.

**Architecture:** `contract/openapi.yaml` gains every new path and schema of foundation §13 in seven reviewable groups (projects, catalogue, findings, app jobs, data/overview/search/activity, models) and loses the project kind at once. Every new operation is routed to a 501 stub from one backend module, `app/foundation_stubs.py`, from which `tests/test_contract.py::EXPECTED_STUBS` is derived; two small allowances in that test (`BACKEND_PENDING`, `RETIRING`) carry the gap between a contract that is ahead and a backend that is not yet. The operations the foundation replaces stay in the contract, marked `deprecated: true` with an `x-retire-with` unit, until the unit that deletes their last caller removes them. The frontend reads the vanished `kind` only through one shim, `src/api/legacyKind.ts`, which unit SH deletes.

**Tech Stack:** OpenAPI 3.1 YAML, Spectral 6 (`spectral:oas`), openapi-typescript 7.13 (generated `schema.d.ts`), openapi-fetch 0.13, Prism 5 (the e2e mock); FastAPI 0.141 + schemathesis 4.27 (`tests/test_contract.py`), pytest, ruff; React 18 + TypeScript 5 + vitest 3 + Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (§13 is the API summary; §6.3, §7, §8, §9, §10, §11.3, §12 define each resource; §18 the DAG) under the umbrella `docs/superpowers/specs/2026-09-26-inspection-platform-design.md`. Executors read both, and the image-inspection spec §3 and §14 (the `image_id` filter) and point-cloud spec §11.4 and §12 (the `view3d` paths this unit leaves to C).

## Global Constraints

- `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit as the YAML, never hand-edited.
- No project kind anywhere in the contract: not `ProjectKind`, not `WrongProjectKind`, not `wrong_project_kind`, not "training project" or "detection project" in prose (spec F5, success criterion 1). `test_no_project_kind_is_left` greps for all four.
- Names are exactly as this plan writes them (operationIds, paths, schema names, parameter names, enum values). The sibling F plans (BK, BC, BM, MG, SH, S1, S2) and the I, M, C, R specs code against them.
- A request property never carries `default:`; the default goes in its `description` (ADR `2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript`). A response property with a default is also `required`.
- In a YAML flow mapping (`{ ... }`) a `description` that contains a comma or `": "` is double-quoted. Unquoted, the comma silently splits it into an extra key that Spectral does not report (found 24 times in today's contract while planning, see the ADR in Task 8).
- Every `*Page` schema carries an `example` whose `next_cursor` is `null`: without one Prism generates the string `"string"`, and a client that pages the mock (`collectPages`) never stops.
- Every new operation declares `default: { $ref: "#/components/responses/Error" }`, tags from `projects`, `catalogue`, `findings`, `data`, `jobs`, `library`, and answers 501 `not_implemented` from `backend/app/foundation_stubs.py` until its unit lands.
- An operation this unit replaces carries `deprecated: true` and `x-retire-with: F-<unit>`; it leaves the contract together with its last frontend caller and its backend route, in that unit.
- Frontend code reads or sends a project kind only through `frontend/src/api/legacyKind.ts`.
- The shared backend interpreter is `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`; in PowerShell steps `$PY` is that path, and backend commands run from `<worktree>\backend`. Nothing is installed into it.
- Stage by path, never `git add -A`, `git add .` or `git commit -a`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Line numbers below are `main`'s at `09fb538`; find each edit by the quoted text, which the plan always gives.

## Decisions taken while planning (recorded so reviewers don't flag them)

1. **C0 touches more than `contract/`.** Spec §18 says C0 touches `contract/` only, but the gate does not allow it. `backend/tests/test_contract.py` fails when a contract operation is not routed or a routed one is not in the contract, and it validates every response; `pnpm -C frontend build` type-checks against `schema.d.ts`; `pnpm -C frontend e2e` runs against Prism serving `openapi.yaml`. So C0 also adds `backend/app/foundation_stubs.py` (+2 import lines and one include block in `backend/app/api.py`), the transition allowances in `backend/tests/test_contract.py`, one line of `backend/tests/test_api_maps_guard.py` (it forbids any path containing "map" when the maps router is broken, and `/library/models/{modelId}/class-map` contains one), two new backend test files, the frontend kind shim with its call sites, the four new job types in the eight exhaustive frontend maps, the `segment` task label and test fixtures, and three ADRs. Nothing else of any unit's territory.
2. **`kind` goes at once; the frontend build does not break.** Leaving `pnpm -C frontend build` red "until SH lands" is not acceptable: C0 merges alone in batch 1 and DS, BK, BC, BM and MG all gate on `main` after it, so every one of them would fail its own gate for a reason it does not own. Instead the nine files that read or send `kind` go through `legacyKind.ts` (Task 2). It reads `kind` when a pre-BK backend still sends it and otherwise answers `train`, the value the Prism example project had before C0, so the e2e suite (95 specs, verified while planning) keeps its behaviour. SH deletes the shim with the kind UI.
3. **The replaced operations are deprecated, not removed.** §13 lists `PUT /projects/{id}/classes`, `/projects/{id}/datasets*`, `/projects/{id}/train` and `/projects/{id}/maps/{mapId}/move` as removed. Their callers (the Settings class list, the Datasets and Train screens, the Move map dialog) live until SH, S1 and S2 replace them, and the e2e suite drives them against Prism (the datasets, train, settings and past-detections specs), so removing the paths now breaks `tsc` and those specs. They stay with `deprecated: true` and `x-retire-with`: `updateClasses` → **F-S2** (it owns the project type list editor that replaces `ClassesSection`, the last caller; the index), the five dataset operations and `trainModel` → **F-S2** (the Models screens), `moveMapToProject` → **F-SH** (it deletes `MoveMapDialog`). A backend unit may delete such a route earlier (BK §6.1, BM §12): `RETIRING` in `test_contract.py` lets the contract keep a path whose route is gone.
4. **New fields on existing response schemas are `required`.** `Project.summary`/`migration`/`last_opened_at`, `ClassDef.kind`/`default_severity`/`group`, `LibraryModel.class_map` and `RunCreated.added_type_ids` are required, so S1 and S2 get non-optional types. The backend does not send them until BK, BC, MG and BM land, so the six operations whose responses fail conformance meanwhile (measured while planning: `listProjects`, `createProject`, `getProject`, `updateProject`, `updateClasses`, `listLibraryModels`) are listed in `BACKEND_PENDING`; for them the contract test still asserts "no 5xx". (`createRuns` never reaches a 202 in the contract test, so it needs no entry; BM fills `added_type_ids`.)
5. **Stubs carry `require_kind(ANY_KIND)` until BK.** Every route under `/projects/{projectId}` declares its kinds until BK removes the guard from every router. Note: on FastAPI 0.141 `app.routes` holds `_IncludedRouter` objects, not `APIRoute`s, so `test_project_kinds.py::test_every_project_route_declares_its_kinds` walks zero routes and passes vacuously; the spec's BK route walk ("no `require_kind` remains") must walk `app.openapi()` or `api_router` recursively, or it proves nothing (ADR in Task 8).
6. **I's addition is in, C's is not.** §13 names two agreed additions to F's `/findings` group. I's `image_id` filter on `GET /findings` is one query parameter of an F operation, so C0 declares it (BC's plan already builds it). C's `PUT`/`GET /findings/{findingId}/view3d` is **owned by C** (C §11.4, tag `pointclouds`) with C's multipart body and C's schemas (`CloudViewMeta`, `CloudViewOut`), which C's own C0 writes (C §17, rows 15–18). F-C0 does not add it; nothing in F's findings group collides with it.
7. **Names and shapes follow the sibling F plans where the spec leaves them open** (the coordinator's reconciliation, 2026-09-26). The operationIds are the ones BC, BM and MG code against: `putProjectTypes`, `patchCatalogueType`, `backfillCatalogueType`, `putSeverityScale`, `patchFinding`, `patchFindingComment`, `addFindingAttachment`, `putLibraryModelClassMap`, `startTrainingRun`, `retryProjectMigration`; path parameters match their routes (`/library/training-runs/{runId}`, `/library/datasets/{datasetId}`, `/catalogue/types/{typeId}`), because `test_every_spec_path_is_routed` compares path strings. Shapes match their pydantic models: `FindingSummary.open_by_severity` and each trend day's are maps `{"<level>": n}`, `by_type` is `[{type_id, n}]`; `ProjectOverview.latest_volume` is `{measurement_id, name, net_m3, previous_net_m3}` and a banner is `{kind, tone, message, action?}`; `CatalogueType` has no timestamps and `PATCH` answers it flat with `backfill_candidates`; `CatalogueTypeCreate` needs only `name`; comments are created from `{text}`; attachments list as `{items}` (not paged) and carry `path`; `MigrationState` requires only `state` (`job_id`, `error`, `code`, `step`, `backup_path`, `report_path` optional and nullable); `ProjectCreate.type_ids` is optional (empty when absent); the dataset, preview, item and training-run schemas are BM's (`DatasetPreview {images, boxes_per_type, projects}`, `LibraryDataset.counts.per_class` a map, `TrainingRunWithJob {training_run, job}`, `LibraryModelClassMapPut {mapping}` merged over the stored map); `catalogue.changed` carries `project_id: "library"`.
8. **Additions requested by the sibling plans, adopted:** `Project.availability` (`ProjectAvailability`: `ok | missing`; operator decision 2026-09-26: a recent project whose folder or `project.db` is gone is **listed** as "Folder not found", with Remove from list (`forgetProject`) and Locate folder… (`openProject`), built by MG, shown by S1; kept apart from `migration`, which says where an upgrade stands, not whether the folder exists); `GET/PUT /settings/operator` (`getOperatorSettings`/`putOperatorSettings`, the comment author's name, built by BC, written by S2); `Project.last_opened_at` (S1); `POST /projects/migrations/reveal-backup {folder}` → 204 (`revealProjectBackup`, S1's "Reveal backup", built by MG); `CatalogueTypePage.needs_classification` (optional) and `POST /catalogue/classification/done` → 204 (`completeCatalogueClassification`, S2, built by BC); `RunCreated.added_type_ids` (BM, spec §7.4 "the response says so"); `retryProjectMigration` answers 202 with the `MigrationState` (MG); error codes `severity_unknown` (BC) and `task_mismatch` (BM). **Not adopted:** a 409 response on every project-scoped operation for `project_upgrading`/`project_upgrade_failed` (MG) — every operation already declares `default: Error`, schemathesis accepts a 409 for valid data, and the codes are documented in `Error.code`, so ~120 identical response lines would add nothing; an optional `file_name` on image anchors (S1) — no backend unit fills it.
9. **`FindingAnchor` is a `kind`-discriminated union** (`image`, `map`, `cloud`), as M already writes it (`anchor = {kind: map, map_id, geometry}`, M §9) and BC returns it. The database column stays `anchor_kind` and so does the list filter. A create body uses `FindingAnchorInput`, whose image arm takes `annotation_id` **or** `box` (exactly one). A PATCH moves a map anchor by `geometry` and a cloud anchor by `x, y, z, uncertainty_m` (`FindingAnchorPatch`, flat, as BC reads it); §8.3 says "`anchor.geometry` for map/cloud", but a cloud anchor has no geometry. `createFinding` also accepts `lon`/`lat` (spec §8.5: "for a map anchor the caller supplies lon/lat"; M sends them).
10. **Severity levels are 1–9.** The keymap sets severity with the keys 1–9 (§5.6), so `SeverityScale.levels` has `maxItems: 9` and every severity field `minimum: 1, maximum: 9`.
11. **The findings list pages at 500** through its own parameter `findingsLimit` (`limit`, 1–500); search takes `q` (2–200 characters) and `limit` 1–20 (default 8). List filters repeat the key (`status=open&status=reviewed`); `severity` items are `1`–`9` or `none`.
12. **`FindingDetail` = `Finding` + `attachment_count`, `comment_count`** (§8.3 "detail with attachment and comment counts"); lists and search return `Finding`. Search returns whole `Finding` and `DataItem` rows (at most 20 each); the palette composes its line from them. `DataItem.summary` is one object with every type's optional fields (§6.3's table), so M adds drawing fields without a new union.
13. **Additions the spec implies but does not name:** `MigrationState.code`/`step`/`report_path` (§11.3's `migrations.json`, §15 "the flag carries the step and error"); `LibraryDataset.export_state` gains `failed` (§12.2 says the export "becomes failed"); a 409 `conflict` when `createFinding` names an annotation that already has a finding (`annotation_id` is unique, §8.1); `note` ≤ 20 000 characters.
14. **The four new job types in the frontend** get labels, verbs, icons and toasts in the eight exhaustive places the pointcloud foundation listed, and `resultTarget` answers `null` for them until S1/S2 give them a screen to link to.
15. **No `docs/progress.md` entry in C0.** Spec §18 gives the foundation's ledger entry to unit X, and five parallel units editing the top of that file would collide.

## Hand-off: what each later unit changes because of C0

| Unit | Deletes or changes |
| --- | --- |
| **BK** | Its tuples in `BK_PROJECT_STUBS`/`BK_APP_STUBS` as it builds `listDataItems`, `searchProject`, `listAppJobs`; the `dependencies=[Depends(require_kind(ANY_KIND))]` on the foundation stub include in `app/api.py` (with every other kind guard); in `BACKEND_PENDING`, the `listProjects`, `createProject`, `getProject`, `updateProject`, `updateClasses` entries once BK (summary, migration, `last_opened_at`, `ProjectCreate`), BC (`ClassDef` fields, the summary's finding counts) and MG (`migration`) are all on `main` (whichever lands last deletes them). It may delete the `moveMapToProject` route (`RETIRING` allows it); the path stays until SH. Its route walk must not rely on `app.routes` (Decision 5). |
| **BC** | Its tuples in `BC_PROJECT_STUBS`/`BC_APP_STUBS` (including `completeCatalogueClassification`, `getOperatorSettings` and `putOperatorSettings`). `REFUSES_VALID_DATA` entries for its schema-valid refusals: `putProjectTypes` {422 `unknown_type`}, `createFinding` {422}, `patchFinding` {422}, `backfillCatalogueType` {422}, `putSeverityScale` {422 `invalid_scale`}, `addFindingAttachment` {422}. It accepts `lon`/`lat` on `createFinding` (Decision 9). |
| **BM** | Its tuples in `BM_APP_STUBS`; the `listLibraryModels` entry of `BACKEND_PENDING` (it sends `class_map` and accepts `task=segment`); `RunCreated.added_type_ids`; `REFUSES_VALID_DATA` entries `exportLibraryDataset` {422}, `startTrainingRun` {422}, `putLibraryModelClassMap` {422}. It may delete the `/projects/{id}/datasets*` and `/train` routes (`RETIRING` allows it); the paths stay until S2. |
| **MG** | Its tuples in `MG_APP_STUBS`: `retryProjectMigration` and `revealProjectBackup` (an addition to MG's plan, requested by S1). |
| **SH** | Deletes `frontend/src/api/legacyKind.ts`, `legacyKind.test.ts` and every import of them with the kind UI; deletes the `moveMapToProject` path from `openapi.yaml` (and `MapMoveRequest`), its `RETIRING` entry, and the route if BK has not; regenerates the client. |
| **S1** | Nothing of C0's transition (it retires no deprecated path). |
| **S2** | Deletes the `updateClasses` path, `ClassDefInput` (if nothing else uses it) and its `RETIRING` entry, with `settings/ClassesSection.tsx` and `api/project.ts::saveClasses` (its Task 15); deletes the five `/projects/{projectId}/datasets*` operations, `trainModel`, the now unused `Dataset`, `DatasetCreate`, `DatasetWithJob`, `DatasetPage`, `DatasetStats` schemas and their `RETIRING` entries, with the old Datasets and Train screens. |
| **Last of BK, BC, BM, MG** | Deletes `backend/app/foundation_stubs.py`, its imports and include block in `app/api.py`, and `tests/test_foundation_stubs.py`; `EXPECTED_STUBS` goes back to `set()`. |

## Budget

**C0 adds no background job and no read.** Every new operation answers 501 from a stub; the kind shim is a pure function; the new frontend test and fixtures are test-only. The contract **encodes** the foundation's budget (spec §14) so the building units cannot drift from it:

- Long work answers `202` and runs as a job: `project_migrate` (`retryProjectMigration`, answering the `MigrationState` with its `job_id`), `findings_backfill` (`backfillCatalogueType`), `findings_recount` (`recountFindings`), `dataset_build` (`createLibraryDataset`), `dataset` (`exportLibraryDataset`), `train` (`startTrainingRun`). The one synchronous copy, an attachment, is capped at 50 MB and validated first (§14).
- Bounded reads: findings pages ≤ 500 (`findingsLimit`); every other list uses the existing `limit` ≤ 1000 with keyset `cursor`; search ≤ 20 per group; bulk ≤ 1000 ids; `FindingSummary.by_type` ≤ 10 and `trend` ≤ 60 days; overview and summary descriptions state "pre-aggregated rows only"; dataset preview is COUNT-only with a 2-second per-project timeout; `GET /jobs` is a keyset merge of `limit + 1` rows per source.

## Execution DAG

**Place in the Foundation DAG (spec §18).** C0 is **batch 1, alone**, and the first node of the critical path **C0 → DS → SH → S1 → X**. It needs nothing. DS, BK, BC, BM and MG-framework branch from `main` only after C0 is merged (batch 2); the backend chain C0 → BC → MG-steps hangs off it too.

**Inside C0** (one worker, one worktree; every task edits `openapi.yaml` and regenerates `schema.d.ts`, so the tasks run in numeric order, which respects every edge; the batches show what a reviewer can judge independently and what to redo if a task is redone):

| Task | Depends on | Batch |
| --- | --- | --- |
| 1 Projects without kind: enums, deprecations, stub module, transition allowances | none | B1 |
| 2 Frontend transition: kind shim, job maps, fixtures | 1 | B2 |
| 3 Catalogue and severity scale | 1 | B2 |
| 5 App-wide jobs | 1 | B2 |
| 7 Models: datasets, training runs, class map, `segment` | 1 | B2 |
| 4 Findings core (+ `updateBox` confirmation) | 3 | B3 |
| 6 Data list, overview, search, activity | 4 | B4 |
| 8 Whole-unit verification, Prism smoke, ADRs, merge, hand-off | all | B5 |

- **Critical path inside C0:** 1 → 3 → 4 → 6 → 8 (the findings schemas are the largest single block; overview and search reuse `FindingSummary`, `Finding` and `DataItemType`).
- **Between Task 1 and Task 2 the frontend type-check is red by design** (the contract dropped `kind` and widened `JobType`); Task 1 runs only the backend and contract checks, Task 2 restores `pnpm -C frontend build`. From Task 2 on every task leaves all gates green.

## Review Focus

1. **Creating a project against the real backend before and after BK lands, and against Prism.** A pre-BK backend still requires `kind` and `classes`; a post-BK backend reads `type_ids` and ignores the rest; Prism validates the body against `ProjectCreate`. The operator must be able to create a project from `main` at every point. Pinned by `legacyKind.test.ts` "builds a create body for the contract and for a pre-BK backend at once" (Task 2) and the updated `e2e/projects.spec.ts` body assertion.
2. **A project without `kind` on the kind screens.** Prism and a post-BK backend send no `kind`; the pre-SH screens must still open (as a training project) rather than hang on "loading kind". Pinned by `legacyKind.test.ts` "reads a project without a kind … as a training project" (Task 2) and the unchanged e2e suite.
3. **The mock paging forever.** A `*Page` example without `next_cursor: null` makes Prism answer `"string"` and `collectPages` loops. Pinned by `test_the_mock_has_an_example` checking `next_cursor is None` for every Page (Tasks 1, 3–7).
4. **List filters serialised the way FastAPI reads them.** `status`, `severity`, `anchor_kind`, `state`, `type` are arrays; openapi-fetch must send repeated keys, not `status=open,reviewed`. Pinned by `frontend/src/api/foundationQuery.test.ts` (Task 5).
5. **A retired operation disappearing out of order.** A backend unit deleting a deprecated route before the frontend caller is gone must not fail the gate, and a deprecated path must not linger unowned. Pinned by `test_transition_allowances_name_real_operations` (`RETIRING` equals the deprecated set with its units; Task 1) and `test_the_replaced_operations_are_deprecated_with_the_unit_that_removes_them`.

## File map

**Contract** — `contract/openapi.yaml` (every task), `contract/client/schema.d.ts` (regenerated every task), `contract/client/index.ts` (type aliases; `ProjectKind` removed).

**Backend: new** — `backend/app/foundation_stubs.py` (the 501 stubs, one list per unit), `backend/tests/test_foundation_contract.py` (the YAML says what §13 says), `backend/tests/test_foundation_stubs.py` (each stub answers 501 and matches the contract).

**Backend: modified** — `backend/app/api.py` (two imports, one include block), `backend/tests/test_contract.py` (`EXPECTED_STUBS` derived, `BACKEND_PENDING`, `RETIRING`, one guard test, the pending branch in `test_responses_conform`), `backend/tests/test_api_maps_guard.py` (the new `/class-map` path is not a map; Task 7).

**Frontend: new** — `frontend/src/api/legacyKind.ts`, `legacyKind.test.ts`, `foundationQuery.test.ts`.

**Frontend: modified** — `src/app/useProjectKind.ts`, `src/app/Shell.tsx`, `src/screens/HomeScreen.tsx`, `src/screens/ProjectsScreen.tsx`, `src/maps/MoveMapDialog.tsx`, `src/api/adoption.ts`, `src/agent/useSetupAgent.ts` (the kind shim); `src/jobs/jobLabels.ts`, `src/ui/useJobToasts.ts`, `src/agent/project/ToolRow.tsx`, `src/app/Header.tsx`, `src/jobs/JobCard.tsx` (and `src/screens/HomeScreen.tsx`) (job types); `src/library/modelLabels.ts` (`segment`); `src/test/fixtures.ts`, `src/maps/MoveMapDialog.test.tsx`, `src/api/adoption.test.ts`, `e2e/projects.spec.ts` (tests).

**Docs** — `vault/decisions/2026-09-26-foundation-contract-lands-before-its-backend.md`, `vault/decisions/2026-09-26-gotcha-yaml-flow-mapping-comma-splits-a-description.md`.

---

### Task 1: Projects without kind, the enum widenings, the deprecations, and the transition scaffolding

**Files:**
- Modify: `contract/openapi.yaml` — `x-websocket` event list (after line 51), `tags` (after line 72), `paths` (8 operations deprecated; the kind scrub across about 75 lines; 3 new paths before line 3330 `components:`), `components.responses` (lines 3471–3480 removed, one response added after line 3508), `components.schemas` (`Error` code list line 3540, `ClassDef` 3585–3595, `ProjectKind`/`Project`/`ProjectCreate` 3609–3664, the `Dataset` example line 4176, `JobType` 6686, `Job.result` 6707, `Event` 6765–6767, and new schemas appended after the last line)
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts:7` (five aliases after `Project`) and `:28` (`ProjectKind` removed)
- Create: `backend/app/foundation_stubs.py`
- Modify: `backend/app/api.py:9` and append after line 117
- Modify: `backend/tests/test_contract.py:17-20`, `:56-59`, `:70-73`, `:124-127`, `:137`
- Test: `backend/tests/test_foundation_contract.py`, `backend/tests/test_foundation_stubs.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Schemas `CatalogueKind` (`defect | object`), `ProjectSummary`, `ProjectCover`, `MigrationState` (`state` required; `job_id`, `error`, `code`, `step`, `backup_path`, `report_path` optional and nullable), `MigrationFolder` (`{folder}`), `ProjectTypesUpdate`; `ProjectAvailability` (`ok | missing`); changed `Project` (no `kind`; required `last_opened_at: string | null`, `summary: ProjectSummary | null`, `migration: MigrationState`, `availability: ProjectAvailability`), `ProjectCreate` (`{name, folder, type_ids?: string[]}`), `ClassDef` (+ required `kind`, `default_severity`, `group`); response `CatalogueUnavailable`.
  - Operations, all 501 stubs: `retryProjectMigration` (`POST /api/v1/projects/migrations/retry`, 202 → `MigrationState`) and `revealProjectBackup` (`POST /api/v1/projects/migrations/reveal-backup`, 204), both unit MG; `putProjectTypes` (`PUT /api/v1/projects/{projectId}/types` → `Project`), unit BC.
  - `JobType` + `project_migrate`, `findings_backfill`, `findings_recount`, `dataset_build`; `Event.type` + `findings.changed`, `data.changed`, `catalogue.changed`, `migration.changed`.
  - Deprecated with `x-retire-with`: `updateClasses`, `listDatasets`, `createDataset`, `getDataset`, `deleteDataset`, `getDatasetStats`, `trainModel` (F-S2), `moveMapToProject` (F-SH).
  - `backend/app/foundation_stubs.py`: `Stub = tuple[str, str, str]`; lists `BK_PROJECT_STUBS`, `BK_APP_STUBS`, `BC_PROJECT_STUBS`, `BC_APP_STUBS`, `BM_APP_STUBS`, `MG_APP_STUBS`; `PROJECT_STUBS`, `APP_STUBS`; routers `project_router`, `app_router`; `stub_operation_ids() -> set[str]`. Tasks 3–7 add tuples to these lists.
  - `backend/tests/test_contract.py`: `EXPECTED_STUBS = stub_operation_ids()`, `BACKEND_PENDING: dict[str, str]`, `RETIRING: dict[str, str]`.
  - `backend/tests/test_foundation_contract.py`: `P`, `FOUNDATION_OPERATIONS`, `EXAMPLED_SCHEMAS`, `spec` fixture, `_schemas`, `_operations`. Tasks 3–7 add rows, names and tests.
  - TypeScript aliases `ProjectCreate`, `ProjectSummary`, `MigrationState`, `ProjectTypesUpdate`, `CatalogueKind` from `@contract/client`; `ProjectKind` is gone from it.

- [ ] **Step 1: Cut the worktree and check the starting point**

```powershell
cd E:\Dev\Yolo\app
git log -1 --format="%h %s" main
.\scripts\start-task.ps1 f-c0
cd E:\Dev\Yolo\app\.claude\worktrees\f-c0
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
(Select-String -Path contract\openapi.yaml -SimpleMatch 'responses/WrongProjectKind').Count
(Select-String -Path contract\openapi.yaml -SimpleMatch 'wrong_project_kind').Count
```

Expected: `main` is at `09fb538` or later; `worktree ready on task/f-c0`; `49` and `27`. If `main` has moved and either count differs, the scrub in Step 6 will say which pattern moved: adjust that pattern's expected count after reading the new lines, never loosen it to "any".

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_foundation_contract.py`:

```python
"""Foundation unit C0: contract/openapi.yaml carries every path and schema of foundation spec §13.

The spec is docs/superpowers/specs/2026-09-26-foundation-design.md. These tests read only the YAML;
`test_contract.py` checks that the backend routes it and `pnpm -C contract check` lints it.
"""

from pathlib import Path

import pytest
import yaml

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")

P = "/api/v1/projects/{projectId}"

# operationId -> (method, path) of every operation the foundation adds.
FOUNDATION_OPERATIONS: dict[str, tuple[str, str]] = {
    # projects (Task 1)
    "retryProjectMigration": ("post", "/api/v1/projects/migrations/retry"),
    "revealProjectBackup": ("post", "/api/v1/projects/migrations/reveal-backup"),
    "putProjectTypes": ("put", P + "/types"),
}

# Response schemas the Prism mock serves: each carries its own example (spec §18 "Prism examples").
EXAMPLED_SCHEMAS = [
    "Project",
    "ProjectSummary",
    "MigrationState",
    "ClassDef",
]


@pytest.fixture(scope="module")
def spec() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


def _schemas(spec: dict) -> dict:
    return spec["components"]["schemas"]


def _operations(spec: dict) -> dict[str, tuple[str, str, dict]]:
    return {
        op["operationId"]: (method, path, op)
        for path, ops in spec["paths"].items()
        for method, op in ops.items()
        if method in METHODS
    }


# ------------------------------------------------------------------------------ Task 1


def test_no_project_kind_is_left():
    text = SPEC.read_text("utf-8")
    for word in ("ProjectKind", "wrong_project_kind", "training project", "detection project"):
        assert word not in text, word


def test_a_project_has_no_kind_but_a_summary_and_a_migration_state(spec):
    project = _schemas(spec)["Project"]
    assert "kind" not in project["properties"]
    assert {"summary", "migration", "last_opened_at", "availability"} <= set(project["required"])
    assert project["properties"]["availability"] == {"$ref": "#/components/schemas/ProjectAvailability"}
    assert _schemas(spec)["ProjectAvailability"]["enum"] == ["ok", "missing"]
    assert project["properties"]["migration"] == {"$ref": "#/components/schemas/MigrationState"}
    states = _schemas(spec)["MigrationState"]["properties"]["state"]["enum"]
    assert states == ["ok", "pending", "running", "failed"]
    assert _schemas(spec)["MigrationState"]["required"] == ["state"]  # MG may leave the rest out


def test_a_project_is_created_with_catalogue_type_ids(spec):
    create = _schemas(spec)["ProjectCreate"]
    assert create["required"] == ["name", "folder"]  # `type_ids` is empty when absent (BK)
    assert set(create["properties"]) == {"name", "folder", "type_ids"}
    assert "additionalProperties" not in create  # the kind shim's extra fields must stay accepted


def test_a_class_def_is_a_catalogue_type_snapshot(spec):
    class_def = _schemas(spec)["ClassDef"]
    assert {"kind", "default_severity", "group"} <= set(class_def["required"])
    assert _schemas(spec)["CatalogueKind"]["enum"] == ["defect", "object"]


def test_the_new_job_types_and_events(spec):
    job_types = _schemas(spec)["JobType"]["enum"]
    for job_type in ("project_migrate", "findings_backfill", "findings_recount", "dataset_build", "map_move"):
        assert job_type in job_types
    events = _schemas(spec)["Event"]["properties"]["type"]["enum"]
    for event in ("findings.changed", "data.changed", "catalogue.changed", "migration.changed"):
        assert event in events


def test_the_replaced_operations_are_deprecated_with_the_unit_that_removes_them(spec):
    ops = _operations(spec).items()
    retired = {op_id: op.get("x-retire-with") for op_id, (_, _, op) in ops if op.get("deprecated")}
    assert retired == {
        "updateClasses": "F-S2",
        "listDatasets": "F-S2",
        "createDataset": "F-S2",
        "getDataset": "F-S2",
        "deleteDataset": "F-S2",
        "getDatasetStats": "F-S2",
        "trainModel": "F-S2",
        "moveMapToProject": "F-SH",
    }


# ------------------------------------------------------------------------------ every task


@pytest.mark.parametrize("op_id", sorted(FOUNDATION_OPERATIONS))
def test_the_foundation_operation_exists(spec, op_id):
    ops = _operations(spec)
    assert op_id in ops, op_id
    method, path, op = ops[op_id]
    assert (method, path) == FOUNDATION_OPERATIONS[op_id]
    assert "default" in op["responses"], "every operation answers errors in the envelope"


@pytest.mark.parametrize("name", EXAMPLED_SCHEMAS)
def test_the_mock_has_an_example(spec, name):
    assert name in _schemas(spec), name
    example = _schemas(spec)[name].get("example")
    assert example is not None, name
    if name.endswith("Page"):
        # A generated cursor would be the string "string": a client paging the mock never stops.
        assert example["next_cursor"] is None, name
```

Create `backend/tests/test_foundation_stubs.py` (it never changes again in C0; it reads the stub lists):

```python
"""Foundation unit C0: every new foundation operation is routed and answers 501 until its unit lands.

The checks read `app.foundation_stubs`, so the backend units never edit this file: a unit that builds
an operation deletes its tuple there and this test follows.
"""

import re

import yaml
from test_contract import METHODS, SPEC

from app import foundation_stubs


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x1", path)


def _call(client, method: str, url: str):
    body = {} if method in ("POST", "PUT", "PATCH") else None
    return client.request(method, url, json=body)


def test_every_project_stub_answers_501_on_a_real_project(client, project_id):
    for method, path, op_id in foundation_stubs.PROJECT_STUBS:
        r = _call(client, method, f"/api/v1/projects/{project_id}{_concrete(path)}")
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_a_project_stub_answers_404_for_an_unknown_project(client):
    for method, path, op_id in foundation_stubs.PROJECT_STUBS:
        r = _call(client, method, f"/api/v1/projects/nope{_concrete(path)}")
        assert r.status_code == 404, (op_id, r.text)


def test_every_app_stub_answers_501(client):
    for method, path, op_id in foundation_stubs.APP_STUBS:
        r = _call(client, method, f"/api/v1{_concrete(path)}")
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_every_stub_is_a_contract_operation_at_its_path():
    contract = {
        op["operationId"]: (method.upper(), path)
        for path, ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].items()
        for method, op in ops.items()
        if method in METHODS
    }
    for method, path, op_id in foundation_stubs.PROJECT_STUBS:
        assert contract.get(op_id) == (method, f"/api/v1/projects/{{projectId}}{path}"), op_id
    for method, path, op_id in foundation_stubs.APP_STUBS:
        assert contract.get(op_id) == (method, f"/api/v1{path}"), op_id
```

In `backend/tests/test_contract.py`, make four edits.

(a) After the checks import (line 18, the closing parenthesis), import the stub list:

```python
    unsupported_method,
)

from app.foundation_stubs import stub_operation_ids

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
```

(b) Replace `test_every_spec_path_is_routed` (lines 56–59) with this version and the guard test after it:

```python
def test_every_spec_path_is_routed(app):
    paths = yaml.safe_load(SPEC.read_text("utf-8"))["paths"]
    retiring = {
        (m.upper(), p)
        for p, ops in paths.items()
        for m, op in ops.items()
        if m in METHODS and op["operationId"] in RETIRING
    }
    wanted = _operations(paths) - retiring
    have = _operations(app.openapi()["paths"])
    assert wanted <= have, sorted(wanted - have)


def test_transition_allowances_name_real_operations():
    """BACKEND_PENDING and RETIRING name real operations; RETIRING ones are deprecated with that unit."""
    ops = {
        op["operationId"]: op
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS
    }
    assert set(BACKEND_PENDING) <= set(ops), sorted(set(BACKEND_PENDING) - set(ops))
    assert not set(BACKEND_PENDING) & EXPECTED_STUBS, sorted(set(BACKEND_PENDING) & EXPECTED_STUBS)
    deprecated = {op_id: op.get("x-retire-with") for op_id, op in ops.items() if op.get("deprecated")}
    assert deprecated == RETIRING
```

(c) Replace the `EXPECTED_STUBS` block (lines 70–73, from `# Operations still served by 501 stubs: every operation of the point-cloud` to `EXPECTED_STUBS: set[str] = set()`) with:

```python
# Operations still served by 501 stubs: the inspection foundation's new operations (spec
# 2026-09-26-foundation-design §13), derived from app/foundation_stubs.py. A unit that builds one
# deletes its tuple there; any other 501 fails `test_responses_conform`.
EXPECTED_STUBS: set[str] = stub_operation_ids()

# Operations whose contract is ahead of the backend after foundation unit C0: the contract dropped
# the project kind and added `Project.summary`/`migration`, `ClassDef.kind`/`default_severity`/
# `group` and `LibraryModel.class_map`, which the backend fills only when the named units land.
# For these the request must still not crash (< 500); conformance is checked again once the entry
# is gone. The unit that lands last for an entry deletes it.
BACKEND_PENDING: dict[str, str] = {
    "listProjects": "BK, BC, MG",
    "createProject": "BK, BC",
    "getProject": "BK, BC",
    "updateProject": "BK, BC",
    "updateClasses": "BK, BC",
}

# Deprecated operations (`deprecated: true`, `x-retire-with`) that leave the contract with their
# last frontend caller, in the named unit. A backend unit may delete such a route earlier (spec
# §6.1, §12): `test_every_spec_path_is_routed` does not require it. The unit that deletes the path
# from openapi.yaml deletes the entry.
RETIRING: dict[str, str] = {
    "updateClasses": "F-S2",
    "listDatasets": "F-S2",
    "createDataset": "F-S2",
    "getDataset": "F-S2",
    "deleteDataset": "F-S2",
    "getDatasetStats": "F-S2",
    "trainModel": "F-S2",
    "moveMapToProject": "F-SH",
}
```

(d) In `test_responses_conform`, read the operation id once, right after the call, and let a pending operation through with the one check it can meet. Replace

```python
    response = case.call(headers=AUTH)
    if response.status_code == 501 and response.json()["error"]["code"] == "not_implemented":
        # S0 stub: the operation is routed but not built yet; it must still answer in the error envelope.
        op_id = case.operation.definition.raw.get("operationId")
        assert op_id in EXPECTED_STUBS, f"unexpected stub for {op_id}"
```

with

```python
    response = case.call(headers=AUTH)
    op_id = case.operation.definition.raw.get("operationId")
    if op_id in BACKEND_PENDING:
        # The contract is ahead of the backend until BACKEND_PENDING[op_id] lands.
        assert response.status_code < 500, response.text
        return
    if response.status_code == 501 and response.json()["error"]["code"] == "not_implemented":
        # A stub: the operation is routed but not built yet; it must still answer in the error envelope.
        assert op_id in EXPECTED_STUBS, f"unexpected stub for {op_id}"
```

and further down delete the now duplicate line `    op_id = case.operation.definition.raw.get("operationId")` that follows `    excluded = [negative_data_rejection, unsupported_method, allow_header_conformance]`.

- [ ] **Step 3: Run them to confirm they fail**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py tests/test_contract.py -q -x -k "not responses_conform"
```

Expected: FAIL — collection errors `ModuleNotFoundError: No module named 'app.foundation_stubs'` in `test_foundation_stubs.py` and `test_contract.py`. Then:

```powershell
& $PY -m pytest tests/test_foundation_contract.py -q
cd ..
```

Expected: FAIL — `test_no_project_kind_is_left` (`ProjectKind`), the Project/ProjectCreate/ClassDef/JobType/deprecation tests, `test_the_foundation_operation_exists[...]` for `retryProjectMigration`, `revealProjectBackup` and `putProjectTypes`, and `test_the_mock_has_an_example[ProjectSummary]`/`[MigrationState]`.

- [ ] **Step 4: Contract header — the four new events and three tags**

In `contract/openapi.yaml`, in the `x-websocket` description, after the `volumes.changed` bullet (it ends with the line `      with is reviewed, gets a drawn box, or is deleted (with its map or on its own).`), insert:

```yaml
    - `findings.changed`: `payload` is `{ids: [...]}` (at most 100 finding ids) or `{all: true}`
      after findings are created, changed or deleted, by a person, a box hook or a job.
    - `data.changed`: `payload` is `{types: [...]}` (data item types) after a data item of those
      types is created, changes status, is renamed or is deleted.
    - `catalogue.changed`: `project_id` is `library`; `payload` is `{type_ids: [...]}` after catalogue
      types change, or `{severity: true}` after the severity scale changes.
    - `migration.changed`: `project_id` is the migrated project's id; `payload` is
      `{folder, state, job_id}` whenever a project's migration state changes (`MigrationState`).
```

In `tags`, after `  - name: volumes` (the last tag, line 72), insert:

```yaml
  - name: catalogue
  - name: findings
  - name: data
```

- [ ] **Step 5: The three new project paths and the eight deprecations**

Insert this block immediately before the line `components:` (column 0, line 3330), keeping one blank line before and after it:

```yaml
  # ------------------------------------------------------------ foundation: projects (F-C0)
  /api/v1/projects/migrations/retry:
    post:
      tags: [projects]
      operationId: retryProjectMigration
      summary: |
        Submit a new `project_migrate` job (a library job) for a project folder whose upgrade
        failed or never started, and answer the project's migration state. The job resumes at the
        first data step not yet recorded; the backup taken before the schema upgrade is kept and
        never overwritten.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MigrationFolder" }
      responses:
        "202":
          description: migration job queued in the library runner
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MigrationState" }
              example: { state: running, job_id: "j0000000-4444-4000-8000-000000000040", error: null, code: null, step: null, backup_path: "E:\\Projects\\North\\backups\\project.db.v1-20260926T090000Z.bak", report_path: null }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a migration job for the folder is already queued or running (`code` is `job_running`, details `{job_id}`), or the project is already upgraded (`code` is `conflict`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/migrations/reveal-backup:
    post:
      tags: [projects]
      operationId: revealProjectBackup
      summary: |
        Show the pre-upgrade backup of a project folder in Explorer (the Projects card's "Reveal
        backup"). Only reads `migrations.json`; the project need not open, and nothing is
        restored: the operator restores a backup by hand.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MigrationFolder" }
      responses:
        "204":
          description: Explorer was started
        "404":
          description: "no backup is recorded for that folder, or its file is gone (`code` is `not_found`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/types:
    parameters:
      - $ref: "#/components/parameters/projectId"
    put:
      tags: [projects]
      operationId: putProjectTypes
      summary: |
        Replace the project's type list with catalogue types, in list order. `Project.classes` is
        derived from this list (`id` is the catalogue type id, `order` the position). `hotkeys`
        overrides a type's catalogue hotkey inside this project; null clears the override. Removing
        a type that still has annotations or findings fails with 409 `class_in_use`. A type id the
        catalogue does not know fails with 422 `unknown_type`: create it with `POST /catalogue/types`
        first. Replaces the deprecated `PUT /projects/{projectId}/classes`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ProjectTypesUpdate" }
      responses:
        "200":
          description: the project with its new type list
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Project" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a removed type still has annotations or findings (`code` is `class_in_use`, details `{type_id, box_count, finding_count}`), or a hotkey is taken in the project (`code` is `hotkey_conflict`, details `{type_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "a type id is not in the catalogue (`code` is `unknown_type`, details `{type_ids}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
```

Mark the eight replaced operations. Directly after each of these lines insert the two lines shown (same six-space indent as `operationId`):

| After the line | insert |
| --- | --- |
| `      operationId: updateClasses` | `      deprecated: true` / `      x-retire-with: F-S2` |
| `      operationId: listDatasets` | `      deprecated: true` / `      x-retire-with: F-S2` |
| `      operationId: createDataset` | `      deprecated: true` / `      x-retire-with: F-S2` |
| `      operationId: getDataset` | `      deprecated: true` / `      x-retire-with: F-S2` |
| `      operationId: deleteDataset` | `      deprecated: true` / `      x-retire-with: F-S2` |
| `      operationId: getDatasetStats` | `      deprecated: true` / `      x-retire-with: F-S2` |
| `      operationId: trainModel` | `      deprecated: true` / `      x-retire-with: F-S2` |
| `      operationId: moveMapToProject` | `      deprecated: true` / `      x-retire-with: F-SH` |

For example `updateClasses` then reads:

```yaml
    put:
      tags: [projects]
      operationId: updateClasses
      deprecated: true
      x-retire-with: F-S2
      summary: |
```

- [ ] **Step 6: Scrub every project-kind reference**

Save this script as `$env:TEMP\f-c0-scrub-kind.py` (outside the repo; it is run once and not committed):

```python
"""F-C0 Task 1, run once and never committed: remove every project-kind reference from openapi.yaml.

Usage: python f-c0-scrub-kind.py contract/openapi.yaml
Each replacement asserts how many times it matched, so a contract that moved since the plan was
written stops the script instead of being half-edited.
"""

import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text("utf-8")


def sub(pattern: str, repl: str, expected: int, *, regex: bool = False) -> None:
    global text
    if regex:
        text, n = re.subn(pattern, repl, text)
    else:
        n = text.count(pattern)
        text = text.replace(pattern, repl)
    assert n == expected, (pattern, n, expected)


# 1. The 49 `409` lines that only point at WrongProjectKind (each operation keeps its `default`).
sub('        "409": { $ref: "#/components/responses/WrongProjectKind" }\n', "", 49)
# 2. Inline 409 descriptions that name wrong_project_kind next to another code.
sub(
    r", or the project is not a (?:training|detection) project \(`code` is `wrong_project_kind`\)",
    "",
    15,
    regex=True,
)
sub(r"; or the project is not a detection project \(`code` is `wrong_project_kind`\)", "", 3, regex=True)
sub(
    r"the project is not a (?:training|detection) project \(`code` is `wrong_project_kind`, "
    r"details `\{kind, allowed\}`\), or ",
    "",
    5,
    regex=True,
)
sub(
    "this project is not a training project, or the target is not a detection project (`code` is "
    "`wrong_project_kind`, details `{kind, allowed}`); or the map",
    "the map",
    1,
)
sub("the message names them), its build job", "the message names them), or its build job", 1)
# 3. Prose that names a project kind.
sub("Plan a detection project with the configured cloud provider.", "Plan a project with the configured cloud provider.", 1)
sub("Start a training job in a training project. `base_model_id`", "Start a training job. `base_model_id`", 1)
sub("Progress of moving this training project's old models", "Progress of moving this project's old models", 1)
sub(
    "Copy a past map out of this training project into a detection project (a `map_move` job",
    "Copy a map out of this project into another project (a `map_move` job",
    1,
)
sub("map runs of a detection project in one list", "map runs of the project in one list", 1)
sub("an open or recently opened detection project", "an open or recently opened project", 1)
# 4. The error-code list in the Error schema.
sub(
    "                wrong_project_kind (409: the operation does not belong to this kind of project;\n"
    "                details `{kind, allowed}`), library_unavailable",
    "                library_unavailable",
    1,
)

path.write_text(text, "utf-8", newline="\n")
left = [ln.strip() for ln in text.splitlines() if re.search(r"wrong_project_kind|training project|detection project", ln)]
print(f"{len(left)} lines still name a project kind:")
print("\n".join(left))
```

Run it:

```powershell
& $PY "$env:TEMP\f-c0-scrub-kind.py" contract\openapi.yaml
```

Expected: no `AssertionError`, and `4 lines still name a project kind:` listing the `WrongProjectKind` response's description, `code: wrong_project_kind`, its message, and `description: a detection project may start with an empty list`. Steps 7 and 8 remove all four.

- [ ] **Step 7: `components.responses` — drop `WrongProjectKind`, add `CatalogueUnavailable`**

Delete this block (lines 3471–3480):

```yaml
    WrongProjectKind:
      description: "the operation does not belong to this kind of project (`code` is `wrong_project_kind`, details `{kind, allowed}`)"
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }
          example:
            error:
              code: wrong_project_kind
              message: "This is a detection project. Datasets belong in a training project."
              details: { kind: detect, allowed: [train] }
```

After the `UnmappedClasses` response in `components.responses` (its last line, line 3508 before this task's edits, is `              details: { model_id: "m0000000-2222-4000-8000-000000000001", unmapped: [crane, "concrete mixer"] }`; the same text recurs in a schema example further down, so take the first), before the blank line and `  schemas:`, insert:

```yaml
    CatalogueUnavailable:
      description: "the catalogue could not be opened at startup (`code` is `catalogue_unavailable`); projects still render from their type snapshots"
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }
          example:
            error:
              code: catalogue_unavailable
              message: "The catalogue could not be opened."
              details: {}
```

- [ ] **Step 8: `components.schemas` — the kind-free project, the catalogue fields, the enums**

(a) In `Error.error.code.description`, replace the line `                range_not_satisfiable (416)` (the last line of the list) with:

```yaml
                range_not_satisfiable (416), project_upgrading (409: the project's foundation
                upgrade is queued or running, or waits for the library or the catalogue; details
                `{job_id}`, null while waiting), project_upgrade_failed (409: the upgrade failed and
                the project stays closed; details `{error, backup_path}`), catalogue_unavailable
                (503: the catalogue could not be opened), unknown_type (422: a type id the
                catalogue does not know; details `{type_ids}`), type_exists (409: a catalogue type
                with that normalised name exists; details `{type_id}`), hotkey_conflict (409: the
                hotkey is taken; details `{type_id}` of the type holding it), severity_in_use (409:
                a severity level to remove is still used; details `{level, projects}` with project
                names), severity_unknown (422: a severity level not on the scale), invalid_scale
                (422: severity levels are not 1..n), not_a_defect (422: findings take defect types
                only; details `{type_id}`), invalid_transition (409: a finding status change that
                is not allowed), finding_would_be_deleted (409: reclassing the box to an object
                type deletes its finding; retry with `confirm_finding_delete=true`),
                attachment_invalid (422: not a JPEG, PNG or WebP, or over 50 MB; details
                `{reason}`), task_not_supported (422: a segment dataset cannot be exported yet),
                task_mismatch (422: the base model's task differs from the dataset's),
                class_in_use (409: also counts findings; details `{type_id, box_count,
                finding_count}`)
```

(b) Replace the whole `ClassDef` schema (from `    ClassDef:` to its `example:` line, just before `    ImportSettings:`) with:

```yaml
    ClassDef:
      type: object
      description: >-
        One entry of the project's type list, read from the project's snapshot of a catalogue type
        (foundation F2), so a project renders even when the catalogue cannot open. `id` is the
        catalogue type id, `order` the list position, and `hotkey` the project's override or else
        the catalogue hotkey.
      required: [id, name, colour, hotkey, order, kind, default_severity, group]
      properties:
        id: { type: string, description: the catalogue type id }
        name: { type: string }
        colour: { type: string }
        hotkey: { type: [string, "null"] }
        order: { type: integer }
        kind: { $ref: "#/components/schemas/CatalogueKind" }
        default_severity: { type: [integer, "null"], minimum: 1, maximum: 9 }
        group: { type: [string, "null"], description: "e.g. `Concrete defects`, shown as Catalogue › group" }
      example: { id: "c1a2b3c4-0000-4000-8000-000000000001", name: excavator, colour: "#f97316", hotkey: "1", order: 0, kind: object, default_severity: null, group: Machinery }
```

(c0) In `listProjects` (`/api/v1/projects` `get`), replace `summary: Recently opened projects, most recent first. Folders that no longer exist are skipped.` with `summary: "Recently opened projects, most recent first. A project whose folder or project.db no longer exists is listed with availability missing."`.

(c) Replace everything from `    ProjectKind:` down to (not including) `    ProjectOpen:` — that is `ProjectKind`, `Project` and `ProjectCreate` — with:

```yaml
    Project:
      type: object
      description: >-
        A project has no kind (foundation F5): every project may hold every data type and run every
        action. A project whose `migration.state` is not `ok` is still listed, but does not open
        (its project routes answer 409 `project_upgrading` or `project_upgrade_failed`); it is then
        built from its recent-list entry: `classes: []`, `schema_version: 0`, `summary: null`, and
        `created_at` equal to `last_opened_at`. A recent project whose folder or `project.db` is gone
        is listed too, with `availability: missing` (built the same way from its recent entry); it
        can only be removed from the list (`forgetProject`) or located again (`openProject` on its
        new folder, which replaces the stale recent entry of the same project id).
      required: [id, name, folder, classes, preannotation_model_id, import_defaults, schema_version, created_at, last_opened_at, summary, migration, availability]
      properties:
        id: { type: string }
        name: { type: string }
        folder: { type: string, description: absolute path of the project folder }
        classes:
          type: array
          description: the project's type list (`PUT /projects/{projectId}/types`), in list order
          items: { $ref: "#/components/schemas/ClassDef" }
        preannotation_model_id: { type: [string, "null"], description: a library model id }
        import_defaults: { $ref: "#/components/schemas/ImportSettings" }
        schema_version: { type: integer, description: "2 once the foundation migration has run" }
        created_at: { type: string, format: date-time }
        last_opened_at: { type: [string, "null"], format: date-time, description: "from the recent list; null when never opened here" }
        summary:
          oneOf:
            - $ref: "#/components/schemas/ProjectSummary"
            - type: "null"
          description: null while the project cannot be opened
        migration: { $ref: "#/components/schemas/MigrationState" }
        availability: { $ref: "#/components/schemas/ProjectAvailability" }
      example:
        id: "7f1c2e3a-1111-4000-8000-000000000001"
        name: Ahmadia
        folder: "E:\\Projects\\Ahmadia"
        classes:
          - { id: "c1a2b3c4-0000-4000-8000-000000000001", name: excavator, colour: "#f97316", hotkey: "1", order: 0, kind: object, default_severity: null, group: Machinery }
          - { id: "c1a2b3c4-0000-4000-8000-000000000002", name: wheel_loader, colour: "#eab308", hotkey: "2", order: 1, kind: object, default_severity: null, group: Machinery }
          - { id: "c1a2b3c4-0000-4000-8000-000000000003", name: bulldozer, colour: "#22c55e", hotkey: "3", order: 2, kind: object, default_severity: null, group: Machinery }
          - { id: "c1a2b3c4-0000-4000-8000-000000000004", name: dump_truck, colour: "#06b6d4", hotkey: "4", order: 3, kind: object, default_severity: null, group: Machinery }
          - { id: "c1a2b3c4-0000-4000-8000-000000000005", name: crane, colour: "#3b82f6", hotkey: "5", order: 4, kind: object, default_severity: null, group: Machinery }
          - { id: "c1a2b3c4-0000-4000-8000-000000000006", name: concrete_mixer, colour: "#a855f7", hotkey: "6", order: 5, kind: object, default_severity: null, group: Machinery }
          - { id: "c1a2b3c4-0000-4000-8000-000000000007", name: roller, colour: "#ec4899", hotkey: "7", order: 6, kind: object, default_severity: null, group: Machinery }
          - { id: "c1a2b3c4-0000-4000-8000-000000000008", name: backhoe, colour: "#ef4444", hotkey: "8", order: 7, kind: object, default_severity: null, group: Machinery }
        preannotation_model_id: "m0000000-2222-4000-8000-000000000001"
        import_defaults: { max_side: 4000, quality: 95, dedupe_threshold: 4, group_regex: "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)" }
        schema_version: 2
        created_at: "2026-09-17T10:00:00Z"
        last_opened_at: "2026-09-26T08:00:00Z"
        summary:
          image_count: 3299
          maps: 2
          point_clouds: 1
          elevations: 1
          open_findings: 47
          open_top_severity: 3
          cover: { kind: map, id: "a0000000-6666-4000-8000-000000000001" }
        migration: { state: ok, job_id: null, error: null, code: null, step: null, backup_path: "E:\\Projects\\Ahmadia\\backups\\project.db.v1-20260926T090000Z.bak", report_path: "E:\\Projects\\Ahmadia\\backups\\migration-v2.json" }
        availability: ok
    ProjectAvailability:
      type: string
      enum: [ok, missing]
      description: "`missing` when the recent project's folder or `project.db` no longer exists (the card reads \"Folder not found\")"
    ProjectCreate:
      type: object
      required: [name, folder]
      properties:
        name: { type: string, minLength: 1 }
        folder: { type: string, description: "absolute path; created when missing, must not already hold a project" }
        type_ids:
          type: array
          uniqueItems: true
          description: catalogue type ids to start with, in list order; empty when absent
          items: { type: string }
      example:
        name: Ahmadia
        folder: "E:\\Projects\\Ahmadia"
        type_ids: ["c1a2b3c4-0000-4000-8000-000000000001", "c1a2b3c4-0000-4000-8000-000000000009"]
```

(d) In the `Dataset` schema's example (the only remaining `ClassDef` example that lacks the new fields) replace

```yaml
          - { id: "c1a2b3c4-0000-4000-8000-000000000001", name: excavator, colour: "#f97316", hotkey: "1", order: 0 }
```

with

```yaml
          - { id: "c1a2b3c4-0000-4000-8000-000000000001", name: excavator, colour: "#f97316", hotkey: "1", order: 0, kind: object, default_severity: null, group: Machinery }
```

(e) In `JobType`, replace `volume_export, design_import]` with `volume_export, design_import, project_migrate, findings_backfill, findings_recount, dataset_build]`.

(f) In `Job.result.description`, replace `area_recount {runs}; detect_export {format, paths}"` with `area_recount {runs}; detect_export {format, paths}; project_migrate {folder, report_path}; findings_backfill {projects, created}; findings_recount {findings}; dataset_build {dataset_id}"`.

(g) In `Event`, replace

```yaml
              volumes.changed,
            ]
        project_id: { type: string, description: "the project id, or `library` for library jobs" }
```

with

```yaml
              volumes.changed,
              findings.changed,
              data.changed,
              catalogue.changed,
              migration.changed,
            ]
        project_id: { type: string, description: "the project id, or `library` for library jobs and `catalogue.changed`" }
```

(h) Append at the very end of the file (after the `Event` example's `payload: {}`):

```yaml
    # ------------------------------------------------------------ foundation: projects (F-C0)
    CatalogueKind:
      type: string
      enum: [defect, object]
      description: "`defect` types become findings; `object` types are counted, not tracked (umbrella D7)"
    ProjectCover:
      type: object
      required: [kind, id]
      properties:
        kind: { type: string, enum: [map, image] }
        id: { type: string, description: a map id or an image id }
      example: { kind: map, id: "a0000000-6666-4000-8000-000000000001" }
    ProjectSummary:
      type: object
      description: pre-aggregated counts for the Projects card (foundation §9.2); never a scan of findings, boxes or images
      required: [image_count, maps, point_clouds, elevations, open_findings, open_top_severity, cover]
      properties:
        image_count: { type: integer, minimum: 0 }
        maps: { type: integer, minimum: 0 }
        point_clouds: { type: integer, minimum: 0 }
        elevations: { type: integer, minimum: 0 }
        open_findings: { type: integer, minimum: 0 }
        open_top_severity: { type: integer, minimum: 0, description: open findings at the highest level of the severity scale }
        cover:
          oneOf:
            - $ref: "#/components/schemas/ProjectCover"
            - type: "null"
          description: the newest ready map, else the newest image; null for an empty project
      example: { image_count: 3299, maps: 2, point_clouds: 1, elevations: 1, open_findings: 47, open_top_severity: 3, cover: { kind: map, id: "a0000000-6666-4000-8000-000000000001" } }
    MigrationState:
      type: object
      description: >-
        The foundation upgrade of one project (foundation §11), from `migrations.json`. `pending`
        waits for its `project_migrate` job (or for the model library or the catalogue to open),
        `running` has a live job, `failed` keeps the reason, the failed step and the backup. Every
        field but `state` may be absent or null.
      required: [state]
      properties:
        state: { type: string, enum: [ok, pending, running, failed] }
        job_id: { type: [string, "null"], description: the `project_migrate` library job }
        error: { type: [string, "null"], description: readable text when `failed` }
        code: { type: [string, "null"], description: "why it failed: `backup_failed`, `step_failed`, `open_failed` or `cancelled`" }
        step: { type: [string, "null"], description: "the data step that failed, e.g. `rewrite_class_ids`" }
        backup_path: { type: [string, "null"], description: absolute path of the copy taken before the schema upgrade }
        report_path: { type: [string, "null"], description: "absolute path of `backups\\migration-v2.json`" }
      example: { state: failed, job_id: "j0000000-4444-4000-8000-000000000040", error: "database is locked", code: step_failed, step: rewrite_class_ids, backup_path: "E:\\Projects\\North\\backups\\project.db.v1-20260926T090000Z.bak", report_path: "E:\\Projects\\North\\backups\\migration-v2.json" }
    MigrationFolder:
      type: object
      required: [folder]
      properties:
        folder: { type: string, description: absolute path of the project folder }
      example: { folder: "E:\\Projects\\North" }
    ProjectTypesUpdate:
      type: object
      required: [type_ids]
      properties:
        type_ids:
          type: array
          uniqueItems: true
          maxItems: 500
          description: catalogue type ids, in list order
          items: { type: string }
        hotkeys:
          type: object
          description: type id to the project's hotkey override (a digit 1-9 or a letter); null clears it; a type left out keeps its override
          additionalProperties: { type: [string, "null"], pattern: "^[1-9A-Za-z]$" }
      example: { type_ids: ["c1a2b3c4-0000-4000-8000-000000000001", "c1a2b3c4-0000-4000-8000-000000000009"], hotkeys: { "c1a2b3c4-0000-4000-8000-000000000009": "c" } }
```

- [ ] **Step 9: Lint, regenerate, and the client aliases**

```powershell
pnpm -C contract lint
pnpm -C contract generate
```

Expected: `No results with a severity of 'error' found!`; `openapi.yaml → client/schema.d.ts`.

In `contract/client/index.ts` delete the line `export type ProjectKind = Schemas["ProjectKind"];` and, after `export type Project = Schemas["Project"];`, add:

```ts
export type ProjectAvailability = Schemas["ProjectAvailability"];
export type ProjectCreate = Schemas["ProjectCreate"];
export type ProjectSummary = Schemas["ProjectSummary"];
export type MigrationState = Schemas["MigrationState"];
export type ProjectTypesUpdate = Schemas["ProjectTypesUpdate"];
export type CatalogueKind = Schemas["CatalogueKind"];
```

- [ ] **Step 10: The stub module and its routing**

Create `backend/app/foundation_stubs.py`:

```python
"""501 placeholders for the foundation's new operations (spec 2026-09-26-foundation-design §13).

Unit C0 lands the whole foundation contract before any backend unit builds it, so every new
operation is routed here and answers 501 `not_implemented` until its unit lands. Each list belongs
to one unit of the foundation DAG (§18). A unit that builds an operation deletes its tuple here and
routes the real handler in its own module; `tests/test_contract.py::EXPECTED_STUBS` is derived from
these lists, so nothing else needs editing. When a list is empty its unit deletes it, and the last
unit to land deletes this module and its `include_router` lines in `app/api.py`.

Project-scoped paths are relative to `/projects/{projectId}` and resolve the project first (404 for
an unknown project). Within a list, a literal path precedes a parameter path of the same method
(`/findings/summary` before `/findings/{findingId}`), because routes match in order.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

# (method, path, operationId)
Stub = tuple[str, str, str]

# BK: the data list (§6.3), search (§10.3) and the app-wide jobs list (§10.1).
BK_PROJECT_STUBS: list[Stub] = []
BK_APP_STUBS: list[Stub] = []

# BC: project types (§7.3), findings core (§8.3), the overview (§9.1) and the catalogue (§7).
BC_PROJECT_STUBS: list[Stub] = [
    ("PUT", "/types", "putProjectTypes"),
]
BC_APP_STUBS: list[Stub] = []

# BM: datasets across projects, training runs and the model class map (§12, §7.4).
BM_APP_STUBS: list[Stub] = []

# MG: the migration's retry (§11.3) and the backup reveal on the Projects card (§9.2).
MG_APP_STUBS: list[Stub] = [
    ("POST", "/projects/migrations/retry", "retryProjectMigration"),
    ("POST", "/projects/migrations/reveal-backup", "revealProjectBackup"),
]

PROJECT_STUBS: list[Stub] = [*BK_PROJECT_STUBS, *BC_PROJECT_STUBS]
APP_STUBS: list[Stub] = [*BK_APP_STUBS, *BC_APP_STUBS, *BM_APP_STUBS, *MG_APP_STUBS]

project_router = APIRouter(prefix="/projects/{projectId}", tags=["foundation-stubs"])
add_stubs(project_router, PROJECT_STUBS)
app_router = APIRouter(tags=["foundation-stubs"])
add_stubs(app_router, APP_STUBS, project_scoped=False)


def stub_operation_ids() -> set[str]:
    """Every operation still answered by a foundation 501 stub."""
    return {op_id for _, _, op_id in (*PROJECT_STUBS, *APP_STUBS)}
```

In `backend/app/api.py`, after `from app.exports.router import router as exports_router` (line 9) add:

```python
from app.foundation_stubs import app_router as foundation_app_stubs
from app.foundation_stubs import project_router as foundation_project_stubs
```

and append at the end of the file (after the point-cloud router loop):

```python

# The foundation's new operations (spec 2026-09-26-foundation-design §13) answer 501 until their unit
# lands; each unit deletes its tuples from app/foundation_stubs.py. Any kind of project reaches them:
# unit BK removes the kind guard from every router, these included (decision F5).
api_router.include_router(foundation_project_stubs, dependencies=[Depends(require_kind(ANY_KIND))])
api_router.include_router(foundation_app_stubs)
```

- [ ] **Step 11: Run the backend tests to verify they pass**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py tests/test_pointcloud_stubs.py tests/test_project_kinds.py tests/test_pointcloud_schemas.py tests/test_api_maps_guard.py -q
& $PY -m pytest tests/test_contract.py -q
& $PY -m ruff check app/api.py app/foundation_stubs.py tests/test_contract.py tests/test_foundation_contract.py tests/test_foundation_stubs.py
& $PY -m ruff format --check app/api.py app/foundation_stubs.py tests/test_contract.py tests/test_foundation_contract.py tests/test_foundation_stubs.py
cd ..
```

Expected: all pass (the first run has 6 skips from `test_pointcloud_stubs.py`, as on `main`); `test_contract.py` all passed in about 2 minutes; ruff `All checks passed!` and `5 files already formatted`. A `test_responses_conform[...]` failure on an operation outside `BACKEND_PENDING` means the backend really disagrees with the new contract: stop and report it (do not add entries to make it pass).

- [ ] **Step 12: Commit** (the frontend type-check is red until Task 2, by design)

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/app/foundation_stubs.py backend/app/api.py backend/tests/test_contract.py backend/tests/test_foundation_contract.py backend/tests/test_foundation_stubs.py
git status --short
git commit -m "feat(contract): projects without kind, catalogue fields, migration state and 501 stubs (F-C0)" -m "Drops ProjectKind and WrongProjectKind, adds Project.summary/migration, ClassDef catalogue fields, the four foundation job types and events, deprecates the operations the foundation replaces, and routes the new operations to 501 stubs with the transition allowances in the contract test." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
pnpm -C contract check
```

Expected: `git status --short` shows only the eight staged paths (plus nothing unstaged); `pnpm -C contract check` ends with no diff (exit 0).

---

### Task 2: Frontend transition — the kind shim, the four job types, the fixtures

**Files:**
- Create: `frontend/src/api/legacyKind.ts`
- Test: `frontend/src/api/legacyKind.test.ts`
- Modify (kind reads and create bodies): `frontend/src/app/useProjectKind.ts:3-10,45`, `frontend/src/app/Shell.tsx:3,28`, `frontend/src/screens/HomeScreen.tsx:4,95`, `frontend/src/screens/ProjectsScreen.tsx:6,115,147,164,271-272`, `frontend/src/maps/MoveMapDialog.tsx:7,98`, `frontend/src/api/adoption.ts:2,41,46`, `frontend/src/agent/useSetupAgent.ts:15,206-215`
- Modify (job types): `frontend/src/jobs/jobLabels.ts:27,108-112`, `frontend/src/ui/useJobToasts.ts:30,104-107`, `frontend/src/agent/project/ToolRow.tsx:37`, `frontend/src/app/Header.tsx:65`, `frontend/src/screens/HomeScreen.tsx:69`, `frontend/src/jobs/JobCard.tsx:45`
- Modify (tests): `frontend/src/test/fixtures.ts:46-66`, `frontend/src/maps/MoveMapDialog.test.tsx:1-22,108-113`, `frontend/src/api/adoption.test.ts:47-52`, `frontend/e2e/projects.spec.ts:52-57`

**Interfaces:**
- Consumes: Task 1's generated types (`Project` without `kind`, `ProjectCreate`, `ClassDef` with `kind`/`default_severity`/`group`, `Project.summary`/`migration`/`last_opened_at`, `JobType` with four new members).
- Produces: `@/api/legacyKind` — `type ProjectKind = "train" | "detect"`, `legacyKind(project: Project): ProjectKind`, `withLegacyKind(project: Project, kind: ProjectKind): Project`, `legacyCreateBody(name: string, folder: string, kind: ProjectKind, classes: ClassDefInput[]): ProjectCreate`. `@/app/useProjectKind` re-exports `ProjectKind`, so its importers do not change. SH deletes all of it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/legacyKind.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleProject } from "@/test/fixtures";
import { legacyCreateBody, legacyKind, withLegacyKind } from "./legacyKind";

describe("legacyKind (transition shim until unit SH)", () => {
  it("reads a detection project that a pre-BK backend still marks", () => {
    expect(legacyKind(withLegacyKind(exampleProject, "detect"))).toBe("detect");
    expect(legacyKind(withLegacyKind(exampleProject, "train"))).toBe("train");
  });

  it("reads a project without a kind, as the contract now sends it, as a training project", () => {
    expect("kind" in exampleProject).toBe(false);
    expect(legacyKind(exampleProject)).toBe("train");
  });

  it("builds a create body for the contract and for a pre-BK backend at once", () => {
    const classes = [{ name: "excavator", colour: "#f97316", hotkey: "1" }];
    expect(legacyCreateBody("North", "E:/Projects/North", "detect", classes)).toEqual({
      name: "North",
      folder: "E:/Projects/North",
      type_ids: [],
      kind: "detect",
      classes,
    });
  });
});
```

- [ ] **Step 2: Run it and the type-check to confirm both fail**

```powershell
pnpm -C frontend exec vitest run src/api/legacyKind.test.ts
pnpm -C frontend exec tsc -p tsconfig.json --noEmit
```

Expected: vitest FAIL — `Failed to resolve import "./legacyKind"`. tsc: a list of errors, among them `Property 'kind' does not exist on type` in `useProjectKind.ts`, `Shell.tsx`, `HomeScreen.tsx`, `ProjectsScreen.tsx`, `MoveMapDialog.tsx`, `adoption.ts`; `'kind' does not exist in type '{ name: string; folder: string; type_ids: string[]; }'` in `useSetupAgent.ts`, `adoption.ts`, `ProjectsScreen.tsx`; `TS2739 … is missing the following properties … project_migrate, findings_backfill, findings_recount, dataset_build` in `ToolRow.tsx`, `Header.tsx`, `JobCard.tsx`, `jobLabels.ts`, `HomeScreen.tsx`, `useJobToasts.ts`; `TS2366 Function lacks ending return statement` in `jobLabels.ts` and `useJobToasts.ts`; and the fixtures in `src/test/fixtures.ts` and `src/maps/MoveMapDialog.test.tsx`. An error in `../contract/client/index.ts` means Task 1 Step 9 left `ProjectKind` there: fix it there first.

- [ ] **Step 3: The shim**

Create `frontend/src/api/legacyKind.ts`:

```ts
import type { ClassDefInput, Project, ProjectCreate } from "@contract/client";

/**
 * Transition shim, foundation unit C0 until unit SH (spec 2026-09-26-foundation-design, F5 and
 * §6.2). The contract has no project kind any more, but until SH deletes the kind UI (`KindRoute`,
 * `useProjectKind`, the sidebar steps, the kind pill) those screens still branch on it. A backend
 * from before unit BK still sends `kind`; the Prism mock and a backend after BK do not, and then a
 * project reads as `train`, which is what the mock's example project said before C0, so the e2e
 * suite keeps its behaviour. SH deletes this file together with every import of it.
 */
export type ProjectKind = "train" | "detect";

/** The kind the pre-foundation screens branch on. */
export function legacyKind(project: Project): ProjectKind {
  return (project as { kind?: unknown }).kind === "detect" ? "detect" : "train";
}

/** A project that reads as `kind` (test fixtures). */
export function withLegacyKind(project: Project, kind: ProjectKind): Project {
  return { ...project, kind } as Project;
}

/**
 * A create body both backends accept: `type_ids` for the contract and a backend after BK, `kind`
 * and `classes` for a backend before BK, which ignores `type_ids` (and BK ignores the other two).
 */
export function legacyCreateBody(
  name: string,
  folder: string,
  kind: ProjectKind,
  classes: ClassDefInput[],
): ProjectCreate {
  return { name, folder, type_ids: [], kind, classes } as ProjectCreate;
}
```

- [ ] **Step 4: Route every kind read and create body through it**

`frontend/src/app/useProjectKind.ts` — replace

```ts
import type { ApiClient, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProject } from "@/api/project";
```

with

```ts
import type { ApiClient } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { legacyKind, type ProjectKind } from "@/api/legacyKind";
import { fetchProject } from "@/api/project";
```

replace

```ts
/** `train` or `detect`, fixed when the project is created. */
export type ProjectKind = Project["kind"];
```

with

```ts
/** `train` or `detect`, until unit SH removes the kind UI (see `@/api/legacyKind`). */
export type { ProjectKind };
```

and replace `useProjectKindStore.getState().set(projectId, p.kind);` with `useProjectKindStore.getState().set(projectId, legacyKind(p));`.

`frontend/src/app/Shell.tsx` — after `import { useApi } from "@/api/client";` add `import { legacyKind } from "@/api/legacyKind";`, and replace `useProjectKindStore.getState().set(projectId, data.kind);` with `useProjectKindStore.getState().set(projectId, legacyKind(data));`.

`frontend/src/screens/HomeScreen.tsx` — after `import { useBackend } from "@/api/client";` add `import { legacyKind } from "@/api/legacyKind";`, and replace `const kind = project?.kind ?? null;` with `const kind = project ? legacyKind(project) : null;`.

`frontend/src/screens/ProjectsScreen.tsx` — after `import { messageOf, unwrap } from "@/api/errors";` add `import { legacyCreateBody, legacyKind } from "@/api/legacyKind";`, then:
- `filter === "all" || p.kind === filter` → `filter === "all" || legacyKind(p) === filter`
- `useProjectKindStore.getState().set(project.id, project.kind);` → `useProjectKindStore.getState().set(project.id, legacyKind(project));`
- `body: { name, folder, kind, classes: kind === "train" ? parseClasses(classes) : [] },` → `body: legacyCreateBody(name, folder, kind, kind === "train" ? parseClasses(classes) : []),`
- replace

```tsx
                      <Pill size="sm" tone={p.kind === "detect" ? "accent" : "neutral"}>
                        {KIND_PILL[p.kind]}
```

with

```tsx
                      <Pill size="sm" tone={legacyKind(p) === "detect" ? "accent" : "neutral"}>
                        {KIND_PILL[legacyKind(p)]}
```

`frontend/src/maps/MoveMapDialog.tsx` — after `import { messageOf } from "@/api/errors";` add `import { legacyKind } from "@/api/legacyKind";`, and replace `useProjectKindStore.getState().set(made.id, made.kind);` with `useProjectKindStore.getState().set(made.id, legacyKind(made));`.

`frontend/src/api/adoption.ts` — after `import { unwrap } from "./errors";` add `import { legacyCreateBody, legacyKind } from "./legacyKind";`, then:
- `return all.filter((p) => p.kind === "detect");` → `return all.filter((p) => legacyKind(p) === "detect");`
- `return unwrap(api.POST("/api/v1/projects", { body: { name, folder, kind: "detect", classes: [] } }));` → `return unwrap(api.POST("/api/v1/projects", { body: legacyCreateBody(name, folder, "detect", []) }));`

`frontend/src/agent/useSetupAgent.ts` — after `import { messageOf, unwrap } from "@/api/errors";` add `import { legacyCreateBody } from "@/api/legacyKind";`, and replace

```ts
            body: {
              name: plan.name.trim(),
              folder: folder.trim(),
              kind: "train",
              classes: plan.classes.map((name, i) => ({
                name: name.trim(),
                colour: COLOURS[i % COLOURS.length],
                hotkey: i < 9 ? String(i + 1) : null,
              })),
            },
```

with

```ts
            body: legacyCreateBody(
              plan.name.trim(),
              folder.trim(),
              "train",
              plan.classes.map((name, i) => ({
                name: name.trim(),
                colour: COLOURS[i % COLOURS.length],
                hotkey: i < 9 ? String(i + 1) : null,
              })),
            ),
```

- [ ] **Step 5: The four new job types in the eight exhaustive places**

| File | Map | Add after the `design_import` entry |
| --- | --- | --- |
| `src/jobs/jobLabels.ts` | `TYPE_LABEL` | `project_migrate: "Project upgrade",` `findings_backfill: "Findings from annotations",` `findings_recount: "Findings recount",` `dataset_build: "Dataset build",` |
| `src/ui/useJobToasts.ts` | `TYPE_NAME` | the same four labels |
| `src/agent/project/ToolRow.tsx` | `JOB_NAME` | the same four labels |
| `src/app/Header.tsx` | `TYPE_VERB` | `project_migrate: "Upgrading a project",` `findings_backfill: "Creating findings",` `findings_recount: "Recounting findings",` `dataset_build: "Building a dataset",` |
| `src/screens/HomeScreen.tsx` | `TYPE_VERB` | the same four verbs |
| `src/jobs/JobCard.tsx` | `TYPE_ICON` | `project_migrate: "folder",` `findings_backfill: "review",` `findings_recount: "refresh",` `dataset_build: "datasets",` |

Each entry goes on its own line with the map's two-space indent, e.g. in `jobLabels.ts`:

```ts
  design_import: "Design surface import",
  project_migrate: "Project upgrade",
  findings_backfill: "Findings from annotations",
  findings_recount: "Findings recount",
  dataset_build: "Dataset build",
};
```

In `src/jobs/jobLabels.ts`, `resultTarget`, replace

```ts
    case "design_import":
      return { label: "Open volumes", to: `${p}/volumes` };
  }
}
```

with

```ts
    case "design_import":
      return { label: "Open volumes", to: `${p}/volumes` };
    // Library jobs of the foundation: the Models and Catalogue sections that show their results
    // arrive with units S1 and S2, until then the job card has no link.
    case "project_migrate":
    case "findings_backfill":
    case "findings_recount":
    case "dataset_build":
      return null;
  }
}
```

In `src/ui/useJobToasts.ts`, `jobToastText`, replace

```ts
      return "Design file read";
  }
}
```

with

```ts
      return "Design file read";
    case "project_migrate":
      return "Project upgraded";
    case "findings_backfill":
      return "Findings created from annotations";
    case "findings_recount":
      return "Findings recounted";
    case "dataset_build":
      return "Dataset built";
  }
}
```

- [ ] **Step 6: The fixtures and the three create-body assertions**

`frontend/src/test/fixtures.ts` — in `exampleClasses`, replace

```ts
  hotkey: String(i + 1),
  order: i,
}));
```

with

```ts
  hotkey: String(i + 1),
  order: i,
  kind: "object",
  default_severity: null,
  group: null,
}));
```

in `exampleProject` delete the line `  kind: "train",`, and replace

```ts
  schema_version: 1,
  created_at: "2026-09-17T10:00:00Z",
};
```

with

```ts
  schema_version: 2,
  created_at: "2026-09-17T10:00:00Z",
  last_opened_at: "2026-09-26T08:00:00Z",
  summary: {
    image_count: 3299,
    maps: 0,
    point_clouds: 0,
    elevations: 0,
    open_findings: 0,
    open_top_severity: 0,
    cover: null,
  },
  migration: {
    state: "ok",
    job_id: null,
    error: null,
    code: null,
    step: null,
    backup_path: null,
    report_path: null,
  },
  availability: "ok",
};
```

`frontend/src/maps/MoveMapDialog.test.tsx` — add `import { withLegacyKind } from "@/api/legacyKind";` above the `@/test/fixtures` import, and replace

```ts
const NORTH: Project = {
  ...exampleProject,
  id: "d0000000-1111-4000-8000-000000000002",
  name: "North site",
  kind: "detect",
  classes: [],
};
const SOUTH: Project = {
  ...exampleProject,
  id: "d0000000-1111-4000-8000-000000000003",
  name: "South yard",
  kind: "detect",
  classes: [],
};
```

with

```ts
const NORTH: Project = withLegacyKind(
  { ...exampleProject, id: "d0000000-1111-4000-8000-000000000002", name: "North site", classes: [] },
  "detect",
);
const SOUTH: Project = withLegacyKind(
  { ...exampleProject, id: "d0000000-1111-4000-8000-000000000003", name: "South yard", classes: [] },
  "detect",
);
```

In the same file, and in `frontend/src/api/adoption.test.ts`, the create body assertion gains `type_ids: []`:

```ts
      name: "North site",
      folder: "E:/Projects/North",
      type_ids: [],
      kind: "detect",
      classes: [],
```

`frontend/e2e/projects.spec.ts` — the same in the `postDataJSON()` assertion:

```ts
  expect((await created).postDataJSON()).toEqual({
    name: "Ahmadia survey",
    folder: "E:\\Projects\\Ahmadia-survey",
    type_ids: [],
    kind: "detect",
    classes: [],
  });
```

- [ ] **Step 7: Run the frontend checks to verify they pass**

```powershell
pnpm -C frontend exec prettier --write src/api/legacyKind.ts src/api/legacyKind.test.ts src/test/fixtures.ts
pnpm -C frontend exec vitest run src/api/legacyKind.test.ts src/api/adoption.test.ts src/maps/MoveMapDialog.test.tsx src/screens/ProjectsScreen.test.tsx src/app/useProjectKind.test.tsx src/agent/SetupAgent.test.tsx
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
```

Expected: the six files pass (3 new tests in `legacyKind.test.ts`); lint clean with `tokens ok`; the whole vitest suite passes (about 1 010 tests at this point); `tsc -b && vite build` succeeds with no type errors.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/api/legacyKind.ts frontend/src/api/legacyKind.test.ts frontend/src/app/useProjectKind.ts frontend/src/app/Shell.tsx frontend/src/screens/HomeScreen.tsx frontend/src/screens/ProjectsScreen.tsx frontend/src/maps/MoveMapDialog.tsx frontend/src/api/adoption.ts frontend/src/agent/useSetupAgent.ts frontend/src/jobs/jobLabels.ts frontend/src/ui/useJobToasts.ts frontend/src/agent/project/ToolRow.tsx frontend/src/app/Header.tsx frontend/src/jobs/JobCard.tsx frontend/src/test/fixtures.ts frontend/src/maps/MoveMapDialog.test.tsx frontend/src/api/adoption.test.ts frontend/e2e/projects.spec.ts
git status --short
git commit -m "feat(frontend): read the retired project kind through one shim (F-C0)" -m "The contract has no kind any more; the pre-foundation screens read it through src/api/legacyKind.ts until unit SH deletes the kind UI. Adds the four foundation job types to the eight exhaustive job maps and the new Project/ClassDef fields to the fixtures." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Expected: only the eighteen paths above were staged.

---

### Task 3: The catalogue and the severity scale

**Files:**
- Modify: `contract/openapi.yaml` (paths before `components:`; one parameter; schemas appended)
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts` (aliases)
- Modify: `backend/app/foundation_stubs.py` (`BC_APP_STUBS`)
- Test: `backend/tests/test_foundation_contract.py` (rows, names, one test)

**Interfaces:**
- Consumes: `CatalogueKind`, `CatalogueUnavailable`, `JobRef`, `NotFound`, `limit`, `cursor` (Task 1 and `main`).
- Produces: operations `listCatalogueTypes`, `createCatalogueType`, `getCatalogueType`, `patchCatalogueType`, `backfillCatalogueType`, `getSeverityScale`, `putSeverityScale`, `completeCatalogueClassification` (`POST /catalogue/classification/done`, 204) (all 501 stubs, unit BC); parameter `typeId`; schemas `CatalogueType` (no timestamps), `CatalogueTypePage` (`{items, next_cursor, needs_classification?}`), `CatalogueTypeCreate` (only `name` required), `CatalogueTypePatch`, `CatalogueTypeUpdated` (`CatalogueType` + `backfill_candidates`, flat), `SeverityLevel` (`{level 1-9, name, colour}`), `SeverityScale` (`{levels: SeverityLevel[1..9]}`, used as both the GET answer and the PUT body); `getOperatorSettings` / `putOperatorSettings` (`GET`/`PUT /settings/operator`, unit BC, the reconciliation of 2026-09-26: the comment author's name lives in the backend's `settings.json`, S2 writes it, BC reads it) with schema `OperatorSettings` (`{operator_name: string | null}`, used as both the GET answer and the PUT body).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_foundation_contract.py`, add these rows at the end of `FOUNDATION_OPERATIONS` (before its closing `}`):

```python
    # catalogue (Task 3)
    "listCatalogueTypes": ("get", "/api/v1/catalogue/types"),
    "createCatalogueType": ("post", "/api/v1/catalogue/types"),
    "getCatalogueType": ("get", "/api/v1/catalogue/types/{typeId}"),
    "patchCatalogueType": ("patch", "/api/v1/catalogue/types/{typeId}"),
    "backfillCatalogueType": ("post", "/api/v1/catalogue/types/{typeId}/backfill"),
    "getSeverityScale": ("get", "/api/v1/catalogue/severity"),
    "putSeverityScale": ("put", "/api/v1/catalogue/severity"),
    "completeCatalogueClassification": ("post", "/api/v1/catalogue/classification/done"),
    "getOperatorSettings": ("get", "/api/v1/settings/operator"),
    "putOperatorSettings": ("put", "/api/v1/settings/operator"),
```

these names at the end of `EXAMPLED_SCHEMAS` (before its closing `]`):

```python
    "CatalogueType",
    "CatalogueTypePage",
    "CatalogueTypeUpdated",
    "SeverityScale",
    "OperatorSettings",
```

and append at the end of the file:

```python
# ------------------------------------------------------------------------------ Task 3


def test_the_severity_scale_has_at_most_nine_levels(spec):
    scale = _schemas(spec)["SeverityScale"]["properties"]["levels"]
    assert (scale["minItems"], scale["maxItems"]) == (1, 9)
    assert [lvl["name"] for lvl in _schemas(spec)["SeverityScale"]["example"]["levels"]] == [
        "Minor",
        "Moderate",
        "Major",
        "Critical",
    ]
```

- [ ] **Step 2: Run them to confirm they fail**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py -q
cd ..
```

Expected: FAIL — ten `test_the_foundation_operation_exists[...]` (`AssertionError: listCatalogueTypes` and so on), five `test_the_mock_has_an_example[...]`, and `test_the_severity_scale_has_at_most_nine_levels` with `KeyError: 'SeverityScale'`.

- [ ] **Step 3: The catalogue paths**

Insert immediately before the line `components:` (after Task 1's block), keeping one blank line before and after:

```yaml
  # ------------------------------------------------------------ foundation: catalogue (F-C0)
  /api/v1/catalogue/types:
    get:
      tags: [catalogue]
      operationId: listCatalogueTypes
      summary: |
        The app-wide catalogue of defect and object types, ordered by group then name. Archived
        types are left out unless `include_archived` is true. `needs_classification` is set after
        the foundation migration merged project classes in, until the operator has reviewed them.
      parameters:
        - { name: q, in: query, required: false, schema: { type: string, maxLength: 64 }, description: matches the normalised name or the group }
        - { name: kind, in: query, required: false, schema: { $ref: "#/components/schemas/CatalogueKind" } }
        - { name: origin, in: query, required: false, schema: { type: string, enum: [user, migrated] } }
        - { name: include_archived, in: query, required: false, schema: { type: boolean }, description: false when absent }
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: catalogue types
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CatalogueTypePage" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [catalogue]
      operationId: createCatalogueType
      summary: |
        Add a type. Names are unique among non-archived types after normalising (casefold, trim,
        `_` and `-` as spaces, runs of spaces collapsed), so "dump_truck" and "Dump truck" are the
        same type: a clash answers 409 `type_exists` with the existing id. A hotkey is a digit 1-9
        or a letter, unique among non-archived types. A missing `colour` is picked by the server; a
        missing `kind` is `object`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CatalogueTypeCreate" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CatalogueType" }
        "409":
          description: "the name exists (`code` is `type_exists`, details `{type_id}`), or the hotkey is taken (`code` is `hotkey_conflict`, details `{type_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/catalogue/types/{typeId}:
    parameters:
      - $ref: "#/components/parameters/typeId"
    get:
      tags: [catalogue]
      operationId: getCatalogueType
      responses:
        "200":
          description: the type
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CatalogueType" }
        "404": { $ref: "#/components/responses/NotFound" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    patch:
      tags: [catalogue]
      operationId: patchCatalogueType
      summary: |
        Rename, recolour, regroup, change the kind, default severity or hotkey, or archive. Types
        are never deleted: an archived type still renders everywhere but is not offered for new
        annotations or findings. The answer is the type plus `backfill_candidates`, true when the
        kind changed from `object` to `defect`, so the UI can offer `POST .../backfill`; from
        `defect` to `object` existing findings are kept and no new ones are created.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CatalogueTypePatch" }
      responses:
        "200":
          description: the updated type
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CatalogueTypeUpdated" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "the new name exists (`code` is `type_exists`, details `{type_id}`), or the hotkey is taken (`code` is `hotkey_conflict`, details `{type_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/catalogue/types/{typeId}/backfill:
    parameters:
      - $ref: "#/components/parameters/typeId"
    post:
      tags: [catalogue]
      operationId: backfillCatalogueType
      summary: |
        Create findings from the accepted and person-drawn annotations of this defect type in every
        recent project, one project at a time (a `findings_backfill` library job). Each becomes a
        `reviewed` finding without a severity. Idempotent: an annotation that already has a finding
        is skipped.
      responses:
        "202":
          description: backfill job queued in the library runner
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
              example:
                job:
                  id: "j0000000-4444-4000-8000-000000000041"
                  project_id: library
                  type: findings_backfill
                  state: queued
                  progress: 0
                  message: ""
                  log_path: "runs/j0000000-4444-4000-8000-000000000041/job.log"
                  params: { type_id: "c1a2b3c4-0000-4000-8000-000000000009" }
                  result: null
                  error: null
                  created_at: "2026-09-26T10:00:00Z"
                  started_at: null
                  finished_at: null
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a backfill of this type is already queued or running (`code` is `job_running`, details `{job_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the type is not a defect type (`code` is `not_a_defect`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503":
          description: "the catalogue (`code` is `catalogue_unavailable`) or the model library (`code` is `library_unavailable`) could not be opened"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/catalogue/severity:
    get:
      tags: [catalogue]
      operationId: getSeverityScale
      summary: The app-wide severity scale, level 1 first. A fresh catalogue holds 1 Minor, 2 Moderate, 3 Major, 4 Critical.
      responses:
        "200":
          description: the scale
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SeverityScale" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    put:
      tags: [catalogue]
      operationId: putSeverityScale
      summary: |
        Replace the scale. Levels must be exactly 1..n (422 `invalid_scale`). Names and colours may
        change freely and levels may be appended. Removing levels takes them from the top only, and
        only when no open project's findings use them (409 `severity_in_use`).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SeverityScale" }
      responses:
        "200":
          description: the new scale
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SeverityScale" }
        "409":
          description: "a level to remove is still used (`code` is `severity_in_use`, details `{level, projects}`, the names of the open projects that use it)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the levels are not 1..n (`code` is `invalid_scale`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/catalogue/classification/done:
    post:
      tags: [catalogue]
      operationId: completeCatalogueClassification
      summary: The operator has reviewed the types the migration merged in; clears `needs_classification` (the Catalogue banner's "Done").
      responses:
        "204":
          description: cleared
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/settings/operator:
    get:
      tags: [findings]
      operationId: getOperatorSettings
      summary: The operator's name, shown as the author of new finding comments (Settings, "Your name"). `operator_name` is null until it is set; comments then say "Operator".
      responses:
        "200":
          description: the operator settings
          content:
            application/json:
              schema: { $ref: "#/components/schemas/OperatorSettings" }
        default: { $ref: "#/components/responses/Error" }
    put:
      tags: [findings]
      operationId: putOperatorSettings
      summary: |
        Set the operator's name. It is trimmed; an empty or null name clears it. Stored as
        `operator_name` in the app-data `settings.json` (never a key); existing comments keep
        their author.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/OperatorSettings" }
      responses:
        "200":
          description: the stored operator settings
          content:
            application/json:
              schema: { $ref: "#/components/schemas/OperatorSettings" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 4: The parameter and the schemas**

In `components.parameters`, after the `candidateId` parameter (its last line is `      schema: { type: string, pattern: "^c[0-9]{1,6}$" }`), insert:

```yaml
    typeId:
      name: typeId
      in: path
      required: true
      description: a catalogue type id
      schema: { type: string }
```

Append at the end of the file:

```yaml
    # ------------------------------------------------------------ foundation: catalogue (F-C0)
    CatalogueType:
      type: object
      description: an app-wide defect or object type in `catalogue.db`; never deleted, only archived
      required: [id, name, colour, kind, default_severity, hotkey, group, archived, origin]
      properties:
        id: { type: string }
        name: { type: string }
        colour: { type: string, pattern: "^#[0-9a-fA-F]{6}$" }
        kind: { $ref: "#/components/schemas/CatalogueKind" }
        default_severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: the severity a new finding of this type starts with }
        hotkey: { type: [string, "null"], description: "live only inside a type picker, never at workspace level" }
        group: { type: [string, "null"] }
        archived: { type: boolean }
        origin: { type: string, enum: [user, migrated], description: "`migrated` when the foundation migration created it from a project class" }
      example: { id: "c1a2b3c4-0000-4000-8000-000000000009", name: crack, colour: "#ff5a4f", kind: defect, default_severity: 2, hotkey: "c", group: Concrete defects, archived: false, origin: user }
    CatalogueTypePage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/CatalogueType" }
        next_cursor: { type: [string, "null"] }
        needs_classification: { type: boolean, description: "true after migration merged project classes in as `object` types, until `POST /catalogue/classification/done`; absent means false" }
      example:
        items:
          - { id: "c1a2b3c4-0000-4000-8000-000000000009", name: crack, colour: "#ff5a4f", kind: defect, default_severity: 2, hotkey: "c", group: Concrete defects, archived: false, origin: user }
          - { id: "c1a2b3c4-0000-4000-8000-000000000001", name: excavator, colour: "#f97316", kind: object, default_severity: null, hotkey: "1", group: Machinery, archived: false, origin: migrated }
        next_cursor: null
        needs_classification: true
    CatalogueTypeCreate:
      type: object
      required: [name]
      properties:
        name: { type: string, minLength: 1, maxLength: 64, pattern: '\S', description: must contain a non-whitespace character }
        colour: { type: [string, "null"], pattern: "^#[0-9a-fA-F]{6}$", description: picked by the server when absent }
        kind: { $ref: "#/components/schemas/CatalogueKind" }
        default_severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: null when absent }
        hotkey: { type: [string, "null"], pattern: "^[1-9A-Za-z]$", description: null when absent }
        group: { type: [string, "null"], maxLength: 64, description: null when absent }
      example: { name: crack, colour: "#ff5a4f", kind: defect, default_severity: 2, hotkey: "c", group: Concrete defects }
    CatalogueTypePatch:
      type: object
      description: every field is optional; a field that is sent replaces the stored one
      properties:
        name: { type: string, minLength: 1, maxLength: 64, pattern: '\S' }
        colour: { type: string, pattern: "^#[0-9a-fA-F]{6}$" }
        kind: { $ref: "#/components/schemas/CatalogueKind" }
        default_severity: { type: [integer, "null"], minimum: 1, maximum: 9 }
        hotkey: { type: [string, "null"], pattern: "^[1-9A-Za-z]$" }
        group: { type: [string, "null"], maxLength: 64 }
        archived: { type: boolean }
      example: { kind: defect, default_severity: 2 }
    CatalogueTypeUpdated:
      description: the patched type, plus whether to offer the findings backfill
      allOf:
        - $ref: "#/components/schemas/CatalogueType"
        - type: object
          required: [backfill_candidates]
          properties:
            backfill_candidates: { type: boolean, description: "true when the kind changed from `object` to `defect`: offer `POST /catalogue/types/{typeId}/backfill`" }
      example: { id: "c1a2b3c4-0000-4000-8000-000000000009", name: crack, colour: "#ff5a4f", kind: defect, default_severity: 2, hotkey: "c", group: Concrete defects, archived: false, origin: migrated, backfill_candidates: true }
    SeverityLevel:
      type: object
      required: [level, name, colour]
      properties:
        level: { type: integer, minimum: 1, maximum: 9 }
        name: { type: string, minLength: 1, maxLength: 32, pattern: '\S' }
        colour: { type: string, pattern: "^#[0-9a-fA-F]{6}$" }
      example: { level: 4, name: Critical, colour: "#ff5a4f" }
    SeverityScale:
      type: object
      description: at most nine levels, because the keys 1-9 set a finding's severity
      required: [levels]
      properties:
        levels:
          type: array
          minItems: 1
          maxItems: 9
          items: { $ref: "#/components/schemas/SeverityLevel" }
      example:
        levels:
          - { level: 1, name: Minor, colour: "#3fb68e" }
          - { level: 2, name: Moderate, colour: "#e2bf2e" }
          - { level: 3, name: Major, colour: "#ff9c3a" }
          - { level: 4, name: Critical, colour: "#ff5a4f" }
    OperatorSettings:
      type: object
      description: app-wide operator settings kept in the backend's `settings.json`
      required: [operator_name]
      properties:
        operator_name: { type: [string, "null"], maxLength: 80, description: "the author of new finding comments; null means unset (comments say Operator)" }
      example: { operator_name: Danijel }
```

- [ ] **Step 5: The stubs**

In `backend/app/foundation_stubs.py`, replace `BC_APP_STUBS: list[Stub] = []` with:

```python
BC_APP_STUBS: list[Stub] = [
    ("GET", "/catalogue/types", "listCatalogueTypes"),
    ("POST", "/catalogue/types", "createCatalogueType"),
    ("GET", "/catalogue/types/{typeId}", "getCatalogueType"),
    ("PATCH", "/catalogue/types/{typeId}", "patchCatalogueType"),
    ("POST", "/catalogue/types/{typeId}/backfill", "backfillCatalogueType"),
    ("GET", "/catalogue/severity", "getSeverityScale"),
    ("PUT", "/catalogue/severity", "putSeverityScale"),
    ("POST", "/catalogue/classification/done", "completeCatalogueClassification"),
    ("GET", "/settings/operator", "getOperatorSettings"),
    ("PUT", "/settings/operator", "putOperatorSettings"),
]
```

- [ ] **Step 6: Lint, regenerate, aliases**

```powershell
pnpm -C contract lint
pnpm -C contract generate
```

Expected: no errors; the client regenerated. In `contract/client/index.ts`, after `export type VolumeMeasurement = Schemas["VolumeMeasurement"];` add:

```ts
export type CatalogueType = Schemas["CatalogueType"];
export type CatalogueTypePage = Schemas["CatalogueTypePage"];
export type CatalogueTypeCreate = Schemas["CatalogueTypeCreate"];
export type CatalogueTypePatch = Schemas["CatalogueTypePatch"];
export type CatalogueTypeUpdated = Schemas["CatalogueTypeUpdated"];
export type SeverityLevel = Schemas["SeverityLevel"];
export type SeverityScale = Schemas["SeverityScale"];
export type OperatorSettings = Schemas["OperatorSettings"];
```

- [ ] **Step 7: Run the tests to verify they pass**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py -q
& $PY -m pytest tests/test_contract.py -q -k "catalogue or routed or stub or allowances"
& $PY -m ruff check app/foundation_stubs.py tests/test_foundation_contract.py
& $PY -m ruff format --check app/foundation_stubs.py tests/test_foundation_contract.py
cd ..
pnpm -C frontend build
```

Expected: all pass; each catalogue operation's `test_responses_conform[...]` passes through the 501 stub branch; ruff clean; the frontend builds (new types only).

- [ ] **Step 8: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/app/foundation_stubs.py backend/tests/test_foundation_contract.py
git commit -m "feat(contract): the catalogue and the severity scale (F-C0)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
pnpm -C contract check
```

Expected: `pnpm -C contract check` exits 0.

---

### Task 4: Findings core

**Files:**
- Modify: `contract/openapi.yaml` (paths before `components:`; `updateBox` at lines 582–597; four parameters; schemas appended)
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts`
- Modify: `backend/app/foundation_stubs.py` (`BC_PROJECT_STUBS`)
- Test: `backend/tests/test_foundation_contract.py`

**Interfaces:**
- Consumes: `projectId`, `limit`, `cursor`, `NotFound`, `JobRef`, `Error` (`main`); `JobType.findings_recount` (Task 1).
- Produces:
  - Operations (all 501 stubs, unit BC): `listFindings`, `createFinding`, `getFindingSummary`, `bulkUpdateFindings`, `recountFindings`, `getFinding`, `patchFinding`, `deleteFinding`, `getFindingThumbnail`, `listFindingComments`, `createFindingComment`, `patchFindingComment`, `deleteFindingComment`, `listFindingAttachments` (not paged), `addFindingAttachment`, `deleteFindingAttachment`, `getFindingAttachmentFile`, `getFindingAttachmentThumbnail`.
  - `listFindings` query: `status[]` (`FindingStatus`), `severity[]` (`1`-`9` or `none`), `type_id[]`, `anchor_kind[]` (`FindingAnchorKind`), `data_id`, `image_id` (I's agreed addition), `created_by` (`human | model`), `q`, `updated_from`, `updated_to`, `has_location`, `sort` (`-severity` default, `number`, `-updated_at`, `type`), `limit` via `findingsLimit` (1–500), `cursor`.
  - Parameters `findingId`, `commentId`, `attachmentId`, `findingsLimit`.
  - Schemas `DataItemType`, `FindingStatus`, `FindingAnchorKind`, `GeoJsonPoint`, `GeoJsonPolygon`, `FindingGeometry`, `FindingBox`, `FindingImageAnchor`, `FindingMapAnchor`, `FindingCloudAnchor`, `FindingAnchor` (discriminator `kind`), `FindingImageAnchorInput`, `FindingAnchorInput`, `FindingAnchorPatch` (flat: `geometry` for a map anchor, `x`, `y`, `z`, `uncertainty_m` for a cloud anchor), `Finding`, `FindingDetail` (`Finding` + `attachment_count`, `comment_count`), `FindingPage`, `FindingCreate`, `FindingPatch`, `FindingBulkUpdate`, `FindingBulkResult`, `FindingTrendDay`, `FindingSummary` (`open_by_severity` a map `{"<level>": n}`, `by_type: [{type_id, n}]`), `FindingComment`, `FindingCommentCreate`, `FindingCommentUpdate`, `FindingCommentPage`, `FindingAttachment` (with `path`), `FindingAttachmentCreate`, `FindingAttachmentList` (`{items}`).
  - `updateBox` gains the query parameter `confirm_finding_delete` and a 409 `finding_would_be_deleted`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_foundation_contract.py`, after the line `P = "/api/v1/projects/{projectId}"` add:

```python
F = P + "/findings/{findingId}"
```

add these rows at the end of `FOUNDATION_OPERATIONS`:

```python
    # findings (Task 4)
    "listFindings": ("get", P + "/findings"),
    "createFinding": ("post", P + "/findings"),
    "getFindingSummary": ("get", P + "/findings/summary"),
    "bulkUpdateFindings": ("post", P + "/findings/bulk"),
    "recountFindings": ("post", P + "/findings/recount"),
    "getFinding": ("get", F),
    "patchFinding": ("patch", F),
    "deleteFinding": ("delete", F),
    "getFindingThumbnail": ("get", F + "/thumbnail"),
    "listFindingComments": ("get", F + "/comments"),
    "createFindingComment": ("post", F + "/comments"),
    "patchFindingComment": ("patch", F + "/comments/{commentId}"),
    "deleteFindingComment": ("delete", F + "/comments/{commentId}"),
    "listFindingAttachments": ("get", F + "/attachments"),
    "addFindingAttachment": ("post", F + "/attachments"),
    "deleteFindingAttachment": ("delete", F + "/attachments/{attachmentId}"),
    "getFindingAttachmentFile": ("get", F + "/attachments/{attachmentId}/file"),
    "getFindingAttachmentThumbnail": ("get", F + "/attachments/{attachmentId}/thumbnail"),
```

these names at the end of `EXAMPLED_SCHEMAS`:

```python
    "Finding",
    "FindingDetail",
    "FindingPage",
    "FindingSummary",
    "FindingComment",
    "FindingCommentPage",
    "FindingAttachment",
    "FindingAttachmentList",
```

and append at the end of the file:

```python
# ------------------------------------------------------------------------------ Task 4


def test_a_finding_anchor_is_one_of_three_kinds(spec):
    anchor = _schemas(spec)["FindingAnchor"]
    assert anchor["discriminator"]["propertyName"] == "kind"
    assert set(anchor["discriminator"]["mapping"]) == {"image", "map", "cloud"}
    cloud = _schemas(spec)["FindingCloudAnchor"]["properties"]
    assert set(cloud) == {"kind", "cloud_id", "x", "y", "z", "uncertainty_m"}  # C10: no normal here


def test_the_findings_list_filters_by_image_and_pages_at_500(spec):
    _, _, op = _operations(spec)["listFindings"]
    names = {p.get("name") for p in op["parameters"] if "name" in p}
    assert {"status", "severity", "type_id", "anchor_kind", "data_id", "image_id", "q", "sort"} <= names
    assert {"$ref": "#/components/parameters/findingsLimit"} in op["parameters"]
    assert spec["components"]["parameters"]["findingsLimit"]["schema"]["maximum"] == 500


def test_a_box_reclass_that_would_delete_a_finding_needs_confirmation(spec):
    _, _, op = _operations(spec)["updateBox"]
    assert any(p.get("name") == "confirm_finding_delete" for p in op["parameters"])
    assert "409" in op["responses"]
```

- [ ] **Step 2: Run them to confirm they fail**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py -q
cd ..
```

Expected: FAIL — eighteen `test_the_foundation_operation_exists[...]`, eight `test_the_mock_has_an_example[...]`, `KeyError: 'FindingAnchor'`, `KeyError: 'listFindings'`, and `test_a_box_reclass_that_would_delete_a_finding_needs_confirmation` with `KeyError: 'parameters'`.

- [ ] **Step 3: The findings paths**

Insert immediately before the line `components:`, keeping one blank line before and after:

```yaml
  # ------------------------------------------------------------ foundation: findings (F-C0)
  /api/v1/projects/{projectId}/findings:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [findings]
      operationId: listFindings
      summary: |
        The project's findings, keyset-paged over indexed filters. Repeat a list parameter to
        match any of its values (`status=open&status=reviewed`). The default sort is `-severity`:
        highest level first, findings without a severity last, then `-number`.
      parameters:
        - name: status
          in: query
          required: false
          schema: { type: array, items: { $ref: "#/components/schemas/FindingStatus" } }
        - name: severity
          in: query
          required: false
          description: a level, or `none` for findings without a severity
          schema: { type: array, items: { type: string, pattern: "^([1-9]|none)$" } }
        - name: type_id
          in: query
          required: false
          schema: { type: array, items: { type: string } }
        - name: anchor_kind
          in: query
          required: false
          schema: { type: array, items: { $ref: "#/components/schemas/FindingAnchorKind" } }
        - { name: data_id, in: query, required: false, schema: { type: string }, description: "the anchor's data item (an images source, a map, an elevation or a point cloud)" }
        - { name: image_id, in: query, required: false, schema: { type: string }, description: "image anchors on this image (image inspection spec §3, an agreed addition to this group)" }
        - { name: created_by, in: query, required: false, schema: { type: string, enum: [human, model] } }
        - { name: q, in: query, required: false, schema: { type: string, maxLength: 200 }, description: "matches the note, the type name, or a number written as `F-0123`" }
        - { name: updated_from, in: query, required: false, schema: { type: string, format: date-time } }
        - { name: updated_to, in: query, required: false, schema: { type: string, format: date-time } }
        - { name: has_location, in: query, required: false, schema: { type: boolean }, description: only findings with (true) or without (false) `lon`/`lat` }
        - { name: sort, in: query, required: false, schema: { type: string, enum: ["-severity", number, "-updated_at", type] }, description: "`-severity` when absent" }
        - $ref: "#/components/parameters/findingsLimit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: findings
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingPage" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [findings]
      operationId: createFinding
      summary: |
        Create a finding. An `image` anchor names an existing annotation (`annotation_id`) or
        carries `box` geometry, which creates the annotation in the same transaction. A map anchor
        should carry `lon`/`lat` (the anchor's WGS84 centroid). `severity` defaults to the type's
        `default_severity`, `status` to `open`. A type of kind `object` answers 422 `not_a_defect`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingCreate" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingDetail" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "the annotation already has a finding (`code` is `conflict`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the type is an object type (`code` is `not_a_defect`), the type is not in the catalogue (`code` is `unknown_type`), or the level is not on the scale (`code` is `severity_unknown`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/summary:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [findings]
      operationId: getFindingSummary
      summary: Counts for the dashboard, read only from the pre-aggregated `finding_count` and `finding_daily` tables, never from `finding` itself.
      responses:
        "200":
          description: the summary
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingSummary" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/bulk:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [findings]
      operationId: bulkUpdateFindings
      summary: Set the status, severity or type of up to 1000 findings in one transaction. A finding the change does not apply to (an invalid transition, an object type) is skipped with its code.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingBulkUpdate" }
      responses:
        "200":
          description: what changed and what was skipped
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingBulkResult" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/recount:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [findings]
      operationId: recountFindings
      summary: Rebuild `finding_count` and `finding_daily` from the findings (a `findings_recount` job in this project); the repair tool for the dashboard counts.
      responses:
        "202":
          description: recount job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
              example:
                job:
                  id: "j0000000-4444-4000-8000-000000000042"
                  project_id: "7f1c2e3a-1111-4000-8000-000000000001"
                  type: findings_recount
                  state: queued
                  progress: 0
                  message: ""
                  log_path: "runs/j0000000-4444-4000-8000-000000000042/job.log"
                  params: {}
                  result: null
                  error: null
                  created_at: "2026-09-26T11:00:00Z"
                  started_at: null
                  finished_at: null
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a recount is already queued or running (`code` is `job_running`, details `{job_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
    get:
      tags: [findings]
      operationId: getFinding
      responses:
        "200":
          description: the finding with its attachment and comment counts
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingDetail" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    patch:
      tags: [findings]
      operationId: patchFinding
      summary: |
        Change the type, severity, status or note, or move a map anchor (`anchor.geometry`) or a
        cloud anchor (`anchor.x`, `y`, `z`, `uncertainty_m`). Status changes follow foundation
        §8.2: closed to reviewed is refused with 409 `invalid_transition` (reopen first). Severity
        is never required.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingPatch" }
      responses:
        "200":
          description: the updated finding
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingDetail" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "the status change is not allowed (`code` is `invalid_transition`, details `{from, to}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the new type is an object type (`code` is `not_a_defect`), the level is not on the scale (`code` is `severity_unknown`), or `anchor` does not fit the finding's anchor kind; an image anchor moves with its annotation (`code` is `validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [findings]
      operationId: deleteFinding
      summary: Delete the finding with its comments and attachments; an image finding's annotation goes too (an annotation on a defect type is the finding's geometry). Attachment files move to `findings/_trash/` and are purged after 30 days.
      responses:
        "204":
          description: deleted
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/thumbnail:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
    get:
      tags: [findings]
      operationId: getFindingThumbnail
      summary: A 160 x 120 JPEG. Image findings get a crop around the annotation (cached); other findings the first attachment's thumbnail; else 404.
      responses:
        "200":
          description: the thumbnail
          content:
            image/jpeg:
              schema: { type: string, format: binary }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/comments:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
    get:
      tags: [findings]
      operationId: listFindingComments
      summary: The comment thread, oldest first.
      parameters:
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: comments
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingCommentPage" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [findings]
      operationId: createFindingComment
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingCommentCreate" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingComment" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/comments/{commentId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
      - $ref: "#/components/parameters/commentId"
    patch:
      tags: [findings]
      operationId: patchFindingComment
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingCommentUpdate" }
      responses:
        "200":
          description: the edited comment
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingComment" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [findings]
      operationId: deleteFindingComment
      responses:
        "204":
          description: deleted
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/attachments:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
    get:
      tags: [findings]
      operationId: listFindingAttachments
      summary: The finding's photos, oldest first; a finding holds a handful, so this list is not paged.
      responses:
        "200":
          description: attachments
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingAttachmentList" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [findings]
      operationId: addFindingAttachment
      summary: |
        Attach a local photo chosen in the Tauri file dialog. The server checks it with Pillow
        (JPEG, PNG or WebP, at most 50 MB), copies it into `findings/<findingId>/` and writes a
        256 px thumbnail. The source file is only read. This one copy is synchronous: it is capped
        and validated first, and takes well under a second.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingAttachmentCreate" }
      responses:
        "201":
          description: attached
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingAttachment" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422":
          description: "not a JPEG, PNG or WebP, over 50 MB, or unreadable (`code` is `attachment_invalid`, details `{reason}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/attachments/{attachmentId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
      - $ref: "#/components/parameters/attachmentId"
    delete:
      tags: [findings]
      operationId: deleteFindingAttachment
      responses:
        "204":
          description: deleted
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/attachments/{attachmentId}/file:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
      - $ref: "#/components/parameters/attachmentId"
    get:
      tags: [findings]
      operationId: getFindingAttachmentFile
      summary: The original photo, for the lightbox only.
      responses:
        "200":
          description: the file
          content:
            image/jpeg:
              schema: { type: string, format: binary }
            image/png:
              schema: { type: string, format: binary }
            image/webp:
              schema: { type: string, format: binary }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/attachments/{attachmentId}/thumbnail:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
      - $ref: "#/components/parameters/attachmentId"
    get:
      tags: [findings]
      operationId: getFindingAttachmentThumbnail
      summary: The 256 px JPEG thumbnail written at upload; lists and grids use it, never the original.
      responses:
        "200":
          description: the thumbnail
          content:
            image/jpeg:
              schema: { type: string, format: binary }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 4: `updateBox` needs a confirmation to delete a finding**

In the `PATCH /api/v1/projects/{projectId}/boxes/{boxId}` operation, replace

```yaml
      operationId: updateBox
      summary: Move, resize or reclassify. A proposal edited this way becomes `edited` (ground truth).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BoxUpdate" }
      responses:
        "200":
          description: updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Box" }
        default: { $ref: "#/components/responses/Error" }
```

with

```yaml
      operationId: updateBox
      summary: |
        Move, resize or reclassify. A proposal edited this way becomes `edited` (ground truth).
        The box of a finding keeps its finding (foundation §8.5): reclassing it to another defect
        type moves the finding to that type; reclassing it to an object type deletes the finding,
        so it needs `confirm_finding_delete=true` and otherwise answers 409
        `finding_would_be_deleted`.
      parameters:
        - { name: confirm_finding_delete, in: query, required: false, schema: { type: boolean }, description: false when absent }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BoxUpdate" }
      responses:
        "200":
          description: updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Box" }
        "409":
          description: "the reclass would delete the box's finding (`code` is `finding_would_be_deleted`, details `{finding_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 5: The parameters and the schemas**

In `components.parameters`, after the `typeId` parameter (Task 3), insert:

```yaml
    findingId:
      name: findingId
      in: path
      required: true
      schema: { type: string }
    commentId:
      name: commentId
      in: path
      required: true
      schema: { type: string }
    attachmentId:
      name: attachmentId
      in: path
      required: true
      schema: { type: string }
    findingsLimit:
      name: limit
      in: query
      description: findings pages hold at most 500
      schema: { type: integer, minimum: 1, maximum: 500, default: 100 }
```

Append at the end of the file:

```yaml
    # ------------------------------------------------------------ foundation: findings (F-C0)
    DataItemType:
      type: string
      enum: [image_set, map, elevation, drawing, point_cloud]
      description: "`drawing` is declared now; the map workspace adds its storage and provider"
    FindingStatus:
      type: string
      enum: [open, reviewed, closed]
    FindingAnchorKind:
      type: string
      enum: [image, map, cloud]
    GeoJsonPoint:
      type: object
      required: [type, coordinates]
      properties:
        type: { type: string, enum: [Point] }
        coordinates: { type: array, items: { type: number }, minItems: 2, maxItems: 3 }
      example: { type: Point, coordinates: [583120.4, 3265410.2] }
    GeoJsonPolygon:
      type: object
      required: [type, coordinates]
      properties:
        type: { type: string, enum: [Polygon] }
        coordinates:
          type: array
          minItems: 1
          items:
            type: array
            minItems: 4
            items: { type: array, items: { type: number }, minItems: 2, maxItems: 3 }
      example: { type: Polygon, coordinates: [[[583120.0, 3265410.0], [583130.0, 3265410.0], [583130.0, 3265420.0], [583120.0, 3265410.0]]] }
    FindingGeometry:
      description: a GeoJSON Point or Polygon in the anchor map's CRS
      oneOf:
        - $ref: "#/components/schemas/GeoJsonPoint"
        - $ref: "#/components/schemas/GeoJsonPolygon"
    FindingBox:
      type: object
      description: "a new annotation's box in image pixels, as `BoxCreate` (the type is the finding's); `angle` is 0 when absent"
      required: [x, y, w, h]
      properties:
        x: { type: number }
        y: { type: number }
        w: { type: number, exclusiveMinimum: 0 }
        h: { type: number, exclusiveMinimum: 0 }
        angle: { type: number }
      example: { x: 812, y: 404, w: 96, h: 40 }
    FindingImageAnchor:
      type: object
      required: [kind, image_id, annotation_id]
      properties:
        kind: { type: string, enum: [image] }
        image_id: { type: string }
        annotation_id: { type: string, description: "the annotation (`Box.id`) that is the finding's geometry" }
      example: { kind: image, image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
    FindingMapAnchor:
      type: object
      required: [kind, map_id, geometry]
      properties:
        kind: { type: string, enum: [map] }
        map_id: { type: string }
        geometry: { $ref: "#/components/schemas/FindingGeometry" }
      example: { kind: map, map_id: "a0000000-6666-4000-8000-000000000001", geometry: { type: Point, coordinates: [583120.4, 3265410.2] } }
    FindingCloudAnchor:
      type: object
      required: [kind, cloud_id, x, y, z, uncertainty_m]
      properties:
        kind: { type: string, enum: [cloud] }
        cloud_id: { type: string }
        x: { type: number }
        y: { type: number }
        z: { type: number }
        uncertainty_m: { type: [number, "null"], minimum: 0 }
      example: { kind: cloud, cloud_id: "p0000000-1111-4000-8000-000000000001", x: 583121.2, y: 3265411.8, z: 41.3, uncertainty_m: 0.05 }
    FindingAnchor:
      description: where the finding is; its kind never changes
      oneOf:
        - $ref: "#/components/schemas/FindingImageAnchor"
        - $ref: "#/components/schemas/FindingMapAnchor"
        - $ref: "#/components/schemas/FindingCloudAnchor"
      discriminator:
        propertyName: kind
        mapping:
          image: "#/components/schemas/FindingImageAnchor"
          map: "#/components/schemas/FindingMapAnchor"
          cloud: "#/components/schemas/FindingCloudAnchor"
    FindingImageAnchorInput:
      type: object
      description: exactly one of `annotation_id` (an existing annotation) and `box` (a new one)
      required: [kind, image_id]
      properties:
        kind: { type: string, enum: [image] }
        image_id: { type: string }
        annotation_id: { type: string }
        box: { $ref: "#/components/schemas/FindingBox" }
      oneOf:
        - required: [annotation_id]
        - required: [box]
      example: { kind: image, image_id: "10000000-5555-4000-8000-000000000001", box: { x: 812, y: 404, w: 96, h: 40 } }
    FindingAnchorInput:
      oneOf:
        - $ref: "#/components/schemas/FindingImageAnchorInput"
        - $ref: "#/components/schemas/FindingMapAnchor"
        - $ref: "#/components/schemas/FindingCloudAnchor"
      discriminator:
        propertyName: kind
        mapping:
          image: "#/components/schemas/FindingImageAnchorInput"
          map: "#/components/schemas/FindingMapAnchor"
          cloud: "#/components/schemas/FindingCloudAnchor"
    FindingAnchorPatch:
      type: object
      description: >-
        Moves a map anchor (`geometry`) or a cloud anchor (`x`, `y`, `z`, optional `uncertainty_m`);
        the map, cloud and anchor kind stay. An image anchor moves with its annotation
        (`PATCH /boxes/{boxId}`).
      properties:
        geometry: { $ref: "#/components/schemas/FindingGeometry" }
        x: { type: number }
        y: { type: number }
        z: { type: number }
        uncertainty_m: { type: [number, "null"], minimum: 0 }
      example: { geometry: { type: Point, coordinates: [583122.0, 3265412.5] } }
    Finding:
      type: object
      required: [id, number, type_id, severity, status, note, created_by, confidence, anchor, lon, lat, data_type, data_id, created_at, updated_at, reviewed_at, closed_at]
      properties:
        id: { type: string }
        number: { type: integer, minimum: 1, description: "the human number, shown as `F-` plus at least four digits (`F-0217`); never reused" }
        type_id: { type: string, description: a catalogue type id of kind `defect` }
        severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: "a severity scale level; null is \"No severity\"" }
        status: { $ref: "#/components/schemas/FindingStatus" }
        note: { type: string }
        created_by: { type: string, pattern: "^(human|model:.+)$", description: "`human`, or `model:<library model id>` for an accepted detection" }
        confidence: { type: [number, "null"], minimum: 0, maximum: 1 }
        anchor: { $ref: "#/components/schemas/FindingAnchor" }
        lon: { type: [number, "null"], description: "WGS84, for maps and dashboards" }
        lat: { type: [number, "null"] }
        data_type: { $ref: "#/components/schemas/DataItemType" }
        data_id: { type: string, description: "the anchor's data item: the image's source, the map or the point cloud" }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
        reviewed_at: { type: [string, "null"], format: date-time }
        closed_at: { type: [string, "null"], format: date-time }
      example:
        id: "f0000000-1212-4000-8000-000000000217"
        number: 217
        type_id: "c1a2b3c4-0000-4000-8000-000000000009"
        severity: 3
        status: open
        note: "Crack along the north parapet, about 40 cm."
        created_by: "model:m0000000-2222-4000-8000-000000000001"
        confidence: 0.87
        anchor: { kind: image, image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
        lon: 47.7625
        lat: 29.4951
        data_type: image_set
        data_id: "50000000-3333-4000-8000-000000000001"
        created_at: "2026-09-26T10:15:00Z"
        updated_at: "2026-09-26T10:20:00Z"
        reviewed_at: null
        closed_at: null
    FindingDetail:
      allOf:
        - $ref: "#/components/schemas/Finding"
        - type: object
          required: [attachment_count, comment_count]
          properties:
            attachment_count: { type: integer, minimum: 0 }
            comment_count: { type: integer, minimum: 0 }
      example:
        id: "f0000000-1212-4000-8000-000000000217"
        number: 217
        type_id: "c1a2b3c4-0000-4000-8000-000000000009"
        severity: 3
        status: open
        note: "Crack along the north parapet, about 40 cm."
        created_by: "model:m0000000-2222-4000-8000-000000000001"
        confidence: 0.87
        anchor: { kind: image, image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
        lon: 47.7625
        lat: 29.4951
        data_type: image_set
        data_id: "50000000-3333-4000-8000-000000000001"
        created_at: "2026-09-26T10:15:00Z"
        updated_at: "2026-09-26T10:20:00Z"
        reviewed_at: null
        closed_at: null
        attachment_count: 2
        comment_count: 3
    FindingPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/Finding" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - id: "f0000000-1212-4000-8000-000000000217"
            number: 217
            type_id: "c1a2b3c4-0000-4000-8000-000000000009"
            severity: 3
            status: open
            note: "Crack along the north parapet, about 40 cm."
            created_by: "model:m0000000-2222-4000-8000-000000000001"
            confidence: 0.87
            anchor: { kind: image, image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
            lon: 47.7625
            lat: 29.4951
            data_type: image_set
            data_id: "50000000-3333-4000-8000-000000000001"
            created_at: "2026-09-26T10:15:00Z"
            updated_at: "2026-09-26T10:20:00Z"
            reviewed_at: null
            closed_at: null
          - id: "f0000000-1212-4000-8000-000000000218"
            number: 218
            type_id: "c1a2b3c4-0000-4000-8000-000000000009"
            severity: null
            status: reviewed
            note: ""
            created_by: human
            confidence: null
            anchor: { kind: map, map_id: "a0000000-6666-4000-8000-000000000001", geometry: { type: Point, coordinates: [583120.4, 3265410.2] } }
            lon: 47.7631
            lat: 29.4948
            data_type: map
            data_id: "a0000000-6666-4000-8000-000000000001"
            created_at: "2026-09-26T10:30:00Z"
            updated_at: "2026-09-26T10:31:00Z"
            reviewed_at: "2026-09-26T10:31:00Z"
            closed_at: null
        next_cursor: null
    FindingCreate:
      type: object
      required: [type_id, anchor]
      properties:
        type_id: { type: string }
        anchor: { $ref: "#/components/schemas/FindingAnchorInput" }
        severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: "the type's `default_severity` when absent" }
        note: { type: string, maxLength: 20000, description: empty when absent }
        status: { $ref: "#/components/schemas/FindingStatus" }
        lon: { type: [number, "null"], description: "WGS84; map anchors send the anchor's centroid; image anchors take the image's GPS when absent" }
        lat: { type: [number, "null"] }
      example: { type_id: "c1a2b3c4-0000-4000-8000-000000000009", anchor: { kind: image, image_id: "10000000-5555-4000-8000-000000000001", box: { x: 812, y: 404, w: 96, h: 40 } }, severity: 3, note: "Crack along the north parapet." }
    FindingPatch:
      type: object
      description: every field is optional; a field that is sent replaces the stored one
      properties:
        type_id: { type: string }
        severity: { type: [integer, "null"], minimum: 1, maximum: 9 }
        status: { $ref: "#/components/schemas/FindingStatus" }
        note: { type: string, maxLength: 20000 }
        anchor: { $ref: "#/components/schemas/FindingAnchorPatch" }
      example: { severity: 4, status: reviewed }
    FindingBulkUpdate:
      type: object
      required: [ids, set]
      properties:
        ids:
          type: array
          minItems: 1
          maxItems: 1000
          uniqueItems: true
          items: { type: string }
        set:
          type: object
          minProperties: 1
          properties:
            status: { $ref: "#/components/schemas/FindingStatus" }
            severity: { type: [integer, "null"], minimum: 1, maximum: 9 }
            type_id: { type: string }
      example: { ids: ["f0000000-1212-4000-8000-000000000217", "f0000000-1212-4000-8000-000000000218"], set: { status: closed } }
    FindingBulkResult:
      type: object
      required: [updated, skipped]
      properties:
        updated: { type: integer, minimum: 0 }
        skipped:
          type: array
          items:
            type: object
            required: [id, code]
            properties:
              id: { type: string }
              code: { type: string, description: "`invalid_transition`, `not_a_defect` or `not_found`" }
      example: { updated: 1, skipped: [{ id: "f0000000-1212-4000-8000-000000000218", code: invalid_transition }] }
    FindingTrendDay:
      type: object
      required: [day, open, closed, open_by_severity]
      properties:
        day: { type: string, format: date }
        open: { type: integer, minimum: 0, description: open findings at the end of the day }
        closed: { type: integer, minimum: 0, description: findings closed that day }
        open_by_severity:
          type: object
          description: "severity level (as a string, `\"3\"`) to open findings at that level"
          additionalProperties: { type: integer, minimum: 0 }
    FindingSummary:
      type: object
      description: read only from `finding_count` and `finding_daily`
      required: [by_status, open_by_severity, open_no_severity, by_type, trend]
      properties:
        by_status:
          type: object
          required: [open, reviewed, closed]
          properties:
            open: { type: integer, minimum: 0 }
            reviewed: { type: integer, minimum: 0 }
            closed: { type: integer, minimum: 0 }
        open_by_severity:
          type: object
          description: "every level of the scale (as a string) to its open findings"
          additionalProperties: { type: integer, minimum: 0 }
        open_no_severity: { type: integer, minimum: 0 }
        by_type:
          type: array
          maxItems: 10
          description: the ten types with the most open findings, most first
          items:
            type: object
            required: [type_id, n]
            properties:
              type_id: { type: string }
              n: { type: integer, minimum: 0, description: open findings of the type }
        trend: { type: array, maxItems: 60, items: { $ref: "#/components/schemas/FindingTrendDay" }, description: "up to 60 days, oldest first" }
      example:
        by_status: { open: 47, reviewed: 12, closed: 88 }
        open_by_severity: { "1": 9, "2": 21, "3": 11, "4": 3 }
        open_no_severity: 3
        by_type: [{ type_id: "c1a2b3c4-0000-4000-8000-000000000009", n: 30 }]
        trend:
          - { day: "2026-09-25", open: 49, closed: 2, open_by_severity: { "4": 4 } }
          - { day: "2026-09-26", open: 47, closed: 3, open_by_severity: { "4": 3 } }
    FindingComment:
      type: object
      required: [id, finding_id, author, text, created_at, edited_at]
      properties:
        id: { type: string }
        finding_id: { type: string }
        author: { type: string }
        text: { type: string, maxLength: 4000 }
        created_at: { type: string, format: date-time }
        edited_at: { type: [string, "null"], format: date-time }
      example: { id: "k0000000-1313-4000-8000-000000000001", finding_id: "f0000000-1212-4000-8000-000000000217", author: Danijel, text: "Seen again on the May flight, slightly longer.", created_at: "2026-09-26T10:40:00Z", edited_at: null }
    FindingCommentCreate:
      type: object
      required: [text]
      properties:
        text: { type: string, minLength: 1, maxLength: 4000, pattern: '\S' }
      example: { text: "Seen again on the May flight, slightly longer." }
    FindingCommentUpdate:
      type: object
      required: [text]
      properties:
        text: { type: string, minLength: 1, maxLength: 4000, pattern: '\S' }
      example: { text: "Seen again on the May flight, about 45 cm now." }
    FindingCommentPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/FindingComment" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - { id: "k0000000-1313-4000-8000-000000000001", finding_id: "f0000000-1212-4000-8000-000000000217", author: Danijel, text: "Seen again on the May flight, slightly longer.", created_at: "2026-09-26T10:40:00Z", edited_at: null }
        next_cursor: null
    FindingAttachment:
      type: object
      required: [id, finding_id, path, original_name, width, height, bytes, created_at]
      properties:
        id: { type: string }
        finding_id: { type: string }
        path: { type: string, description: "project-relative: `findings/<finding_id>/<id>.<ext>`" }
        original_name: { type: string }
        width: { type: integer, minimum: 1 }
        height: { type: integer, minimum: 1 }
        bytes: { type: integer, minimum: 1, maximum: 52428800 }
        created_at: { type: string, format: date-time }
      example: { id: "h0000000-1414-4000-8000-000000000001", finding_id: "f0000000-1212-4000-8000-000000000217", path: "findings/f0000000-1212-4000-8000-000000000217/h0000000-1414-4000-8000-000000000001.jpg", original_name: "IMG_2041.JPG", width: 4000, height: 3000, bytes: 5242880, created_at: "2026-09-26T10:45:00Z" }
    FindingAttachmentCreate:
      type: object
      required: [path]
      properties:
        path: { type: string, minLength: 1, description: "absolute path of a local JPEG, PNG or WebP file; only read" }
      example: { path: "E:\\Site photos\\IMG_2041.JPG" }
    FindingAttachmentList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/FindingAttachment" }
      example:
        items:
          - { id: "h0000000-1414-4000-8000-000000000001", finding_id: "f0000000-1212-4000-8000-000000000217", path: "findings/f0000000-1212-4000-8000-000000000217/h0000000-1414-4000-8000-000000000001.jpg", original_name: "IMG_2041.JPG", width: 4000, height: 3000, bytes: 5242880, created_at: "2026-09-26T10:45:00Z" }
```

- [ ] **Step 6: The stubs**

In `backend/app/foundation_stubs.py`, add at the end of `BC_PROJECT_STUBS` (after `("PUT", "/types", "putProjectTypes"),`), keeping the literal paths before `{findingId}`:

```python
    ("GET", "/findings", "listFindings"),
    ("POST", "/findings", "createFinding"),
    ("GET", "/findings/summary", "getFindingSummary"),
    ("POST", "/findings/bulk", "bulkUpdateFindings"),
    ("POST", "/findings/recount", "recountFindings"),
    ("GET", "/findings/{findingId}", "getFinding"),
    ("PATCH", "/findings/{findingId}", "patchFinding"),
    ("DELETE", "/findings/{findingId}", "deleteFinding"),
    ("GET", "/findings/{findingId}/thumbnail", "getFindingThumbnail"),
    ("GET", "/findings/{findingId}/comments", "listFindingComments"),
    ("POST", "/findings/{findingId}/comments", "createFindingComment"),
    ("PATCH", "/findings/{findingId}/comments/{commentId}", "patchFindingComment"),
    ("DELETE", "/findings/{findingId}/comments/{commentId}", "deleteFindingComment"),
    ("GET", "/findings/{findingId}/attachments", "listFindingAttachments"),
    ("POST", "/findings/{findingId}/attachments", "addFindingAttachment"),
    ("DELETE", "/findings/{findingId}/attachments/{attachmentId}", "deleteFindingAttachment"),
    ("GET", "/findings/{findingId}/attachments/{attachmentId}/file", "getFindingAttachmentFile"),
    ("GET", "/findings/{findingId}/attachments/{attachmentId}/thumbnail", "getFindingAttachmentThumbnail"),
```

- [ ] **Step 7: Lint, regenerate, aliases**

```powershell
pnpm -C contract lint
pnpm -C contract generate
```

Expected: no errors. In `contract/client/index.ts`, after Task 3's aliases add:

```ts
export type DataItemType = Schemas["DataItemType"];
export type Finding = Schemas["Finding"];
export type FindingDetail = Schemas["FindingDetail"];
export type FindingPage = Schemas["FindingPage"];
export type FindingStatus = Schemas["FindingStatus"];
export type FindingAnchor = Schemas["FindingAnchor"];
export type FindingAnchorKind = Schemas["FindingAnchorKind"];
export type FindingAnchorInput = Schemas["FindingAnchorInput"];
export type FindingAnchorPatch = Schemas["FindingAnchorPatch"];
export type FindingCreate = Schemas["FindingCreate"];
export type FindingPatch = Schemas["FindingPatch"];
export type FindingSummary = Schemas["FindingSummary"];
export type FindingComment = Schemas["FindingComment"];
export type FindingAttachment = Schemas["FindingAttachment"];
```

- [ ] **Step 8: Run the tests to verify they pass**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py -q
& $PY -m pytest tests/test_contract.py -q -k "findings or boxes or routed or stub or allowances"
& $PY -m ruff check app/foundation_stubs.py tests/test_foundation_contract.py
& $PY -m ruff format --check app/foundation_stubs.py tests/test_foundation_contract.py
cd ..
pnpm -C frontend build
```

Expected: all pass. `PATCH /boxes/{boxId}` still conforms: the backend ignores the unknown query parameter and never answers the new 409 yet.

- [ ] **Step 9: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/app/foundation_stubs.py backend/tests/test_foundation_contract.py
git commit -m "feat(contract): findings, their anchors, comments, attachments and summary (F-C0)" -m "Also the image_id filter agreed with image inspection, and updateBox's confirm_finding_delete." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
pnpm -C contract check
```

Expected: `pnpm -C contract check` exits 0.

---

### Task 5: App-wide jobs, and the list-filter serialisation pin

**Files:**
- Modify: `contract/openapi.yaml`
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts`
- Modify: `backend/app/foundation_stubs.py` (`BK_APP_STUBS`)
- Test: `backend/tests/test_foundation_contract.py`, `frontend/src/api/foundationQuery.test.ts`

**Interfaces:**
- Consumes: `Job`, `JobState`, `JobType` (Task 1 widened), `limit`, `cursor`; `listFindings` (Task 4).
- Produces: operation `listAppJobs` (`GET /api/v1/jobs`, query `state[]`, `type[]`, `project_id`, `limit`, `cursor`; 501 stub, unit BK); schemas `AppJob` (`Job` + `project_name: string | null`), `AppJobPage`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_foundation_contract.py`, add at the end of `FOUNDATION_OPERATIONS`:

```python
    # app jobs (Task 5)
    "listAppJobs": ("get", "/api/v1/jobs"),
```

and at the end of `EXAMPLED_SCHEMAS`:

```python
    "AppJob",
    "AppJobPage",
```

Create `frontend/src/api/foundationQuery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApiClient } from "@contract/client";

/** The URL the typed client builds for a request (foundation unit C0; list filters repeat a key). */
async function urlOf(send: (api: ReturnType<typeof createApiClient>) => Promise<unknown>): Promise<URL> {
  let seen = "";
  const api = createApiClient({
    baseUrl: "http://fake",
    token: "t",
    fetch: async (input) => {
      seen = input instanceof Request ? input.url : String(input);
      return new Response(JSON.stringify({ items: [], next_cursor: null }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await send(api);
  return new URL(seen);
}

describe("foundation list filters through the typed client", () => {
  it("repeats each value of a findings filter, the form the backend reads", async () => {
    const url = await urlOf((api) =>
      api.GET("/api/v1/projects/{projectId}/findings", {
        params: {
          path: { projectId: "p1" },
          query: { status: ["open", "reviewed"], severity: ["none", "3"], anchor_kind: ["image"] },
        },
      }),
    );
    expect(url.pathname).toBe("/api/v1/projects/p1/findings");
    expect(url.searchParams.getAll("status")).toEqual(["open", "reviewed"]);
    expect(url.searchParams.getAll("severity")).toEqual(["none", "3"]);
    expect(url.searchParams.getAll("anchor_kind")).toEqual(["image"]);
  });

  it("repeats the job states and types of the app-wide jobs list", async () => {
    const url = await urlOf((api) =>
      api.GET("/api/v1/jobs", { params: { query: { state: ["running", "queued"], type: ["train"] } } }),
    );
    expect(url.searchParams.getAll("state")).toEqual(["running", "queued"]);
    expect(url.searchParams.getAll("type")).toEqual(["train"]);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py -q
cd ..
pnpm -C frontend exec tsc -p tsconfig.json --noEmit
```

Expected: pytest FAIL — `test_the_foundation_operation_exists[listAppJobs]` and two `test_the_mock_has_an_example[...]`. tsc FAIL — `src/api/foundationQuery.test.ts: Argument of type '"/api/v1/jobs"' is not assignable to parameter of type 'PathsWithMethod<paths, "get">'`.

- [ ] **Step 3: The path and the schemas**

Insert immediately before the line `components:`, keeping one blank line before and after:

```yaml
  # ------------------------------------------------------------ foundation: app jobs (F-C0)
  /api/v1/jobs:
    get:
      tags: [jobs]
      operationId: listAppJobs
      summary: |
        Every job in the app, newest first (`created_at desc, id desc`): the library runner's jobs
        and the jobs of every recent project that is open (only an open project can have a live
        job). A keyset merge that asks each source for `limit + 1` rows. Cancel and log use the
        per-project routes, or `/library/jobs/...` when `project_id` is `library`.
      parameters:
        - name: state
          in: query
          required: false
          schema: { type: array, items: { $ref: "#/components/schemas/JobState" } }
        - name: type
          in: query
          required: false
          schema: { type: array, items: { $ref: "#/components/schemas/JobType" } }
        - { name: project_id, in: query, required: false, schema: { type: string }, description: "one project's jobs, or `library`" }
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: jobs, newest first
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AppJobPage" }
        default: { $ref: "#/components/responses/Error" }
```

Append at the end of the file:

```yaml
    # ------------------------------------------------------------ foundation: app jobs (F-C0)
    AppJob:
      description: a job plus the name of its project; `project_name` is null for library jobs
      allOf:
        - $ref: "#/components/schemas/Job"
        - type: object
          required: [project_name]
          properties:
            project_name: { type: [string, "null"] }
      example:
        id: "j0000000-4444-4000-8000-000000000001"
        project_id: "7f1c2e3a-1111-4000-8000-000000000001"
        type: import
        state: running
        progress: 0.42
        message: "1386 / 3299 images"
        log_path: "runs/j0000000-4444-4000-8000-000000000001/job.log"
        params: { source_id: "50000000-3333-4000-8000-000000000001" }
        result: null
        error: null
        created_at: "2026-09-17T10:05:00Z"
        started_at: "2026-09-17T10:05:01Z"
        finished_at: null
        project_name: Ahmadia
    AppJobPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/AppJob" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - id: "j0000000-4444-4000-8000-000000000040"
            project_id: library
            type: project_migrate
            state: running
            progress: 0.5
            message: "step 4 of 8: library_class_maps"
            log_path: "runs/j0000000-4444-4000-8000-000000000040/job.log"
            params: { folder: "E:\\Projects\\Ahmadia" }
            result: null
            error: null
            created_at: "2026-09-26T09:00:00Z"
            started_at: "2026-09-26T09:00:01Z"
            finished_at: null
            project_name: null
          - id: "j0000000-4444-4000-8000-000000000001"
            project_id: "7f1c2e3a-1111-4000-8000-000000000001"
            type: import
            state: running
            progress: 0.42
            message: "1386 / 3299 images"
            log_path: "runs/j0000000-4444-4000-8000-000000000001/job.log"
            params: { source_id: "50000000-3333-4000-8000-000000000001" }
            result: null
            error: null
            created_at: "2026-09-17T10:05:00Z"
            started_at: "2026-09-17T10:05:01Z"
            finished_at: null
            project_name: Ahmadia
        next_cursor: null
```

- [ ] **Step 4: The stub**

In `backend/app/foundation_stubs.py`, replace `BK_APP_STUBS: list[Stub] = []` with:

```python
BK_APP_STUBS: list[Stub] = [
    ("GET", "/jobs", "listAppJobs"),
]
```

- [ ] **Step 5: Lint, regenerate, aliases**

```powershell
pnpm -C contract lint
pnpm -C contract generate
```

In `contract/client/index.ts`, after Task 4's aliases add:

```ts
export type AppJob = Schemas["AppJob"];
export type AppJobPage = Schemas["AppJobPage"];
```

- [ ] **Step 6: Run the tests to verify they pass**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py -q
& $PY -m pytest tests/test_contract.py -q -k "jobs or routed or stub or allowances"
& $PY -m ruff check app/foundation_stubs.py tests/test_foundation_contract.py
& $PY -m ruff format --check app/foundation_stubs.py tests/test_foundation_contract.py
cd ..
pnpm -C frontend exec prettier --check src/api/foundationQuery.test.ts
pnpm -C frontend exec vitest run src/api/foundationQuery.test.ts
pnpm -C frontend build
```

Expected: all pass; the two serialisation tests pass (`status=open&status=reviewed`, `severity=none&severity=3`, `state=running&state=queued`).

- [ ] **Step 7: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/app/foundation_stubs.py backend/tests/test_foundation_contract.py frontend/src/api/foundationQuery.test.ts
git commit -m "feat(contract): the app-wide jobs list (F-C0)" -m "Pins that the typed client repeats list filters, the form the backend reads." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
pnpm -C contract check
```

---

### Task 6: The data list, the overview, search and activity

**Files:**
- Modify: `contract/openapi.yaml`
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts`
- Modify: `backend/app/foundation_stubs.py` (`BK_PROJECT_STUBS`, `BC_PROJECT_STUBS`)
- Test: `backend/tests/test_foundation_contract.py`

**Interfaces:**
- Consumes: `DataItemType`, `Finding`, `FindingSummary` (Task 4); `SurfaceKind` (`main`).
- Produces: operations `listDataItems` (`GET …/data`, query `type[]`; unit BK), `searchProject` (`GET …/search`, `q` 2–200 chars, `limit` 1–20; unit BK), `getProjectOverview` (`GET …/overview`; unit BC), `listActivity` (`GET …/activity`, `subject_id`; unit BC); schemas `DataItemSummary`, `DataItem` (`{id, type, label, captured_on, status: importing|ready|failed, created_at, summary}`), `DataItemPage`, `OverviewDataCounts`, `OverviewVolume` (`{measurement_id, name, net_m3, previous_net_m3}`), `OverviewBanner` (`{kind, tone, message, action?}`), `ProjectOverview` (`{findings: FindingSummary, data, latest_volume, hero_map_id, banners}`), `ProjectSearchResult` (`{findings: Finding[], data: DataItem[]}`), `Activity`, `ActivityPage`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_foundation_contract.py`, add at the end of `FOUNDATION_OPERATIONS`:

```python
    # data, overview, search, activity (Task 6)
    "listDataItems": ("get", P + "/data"),
    "getProjectOverview": ("get", P + "/overview"),
    "searchProject": ("get", P + "/search"),
    "listActivity": ("get", P + "/activity"),
```

and at the end of `EXAMPLED_SCHEMAS`:

```python
    "DataItem",
    "DataItemPage",
    "ProjectOverview",
    "ProjectSearchResult",
    "ActivityPage",
```

- [ ] **Step 2: Run them to confirm they fail**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py -q
cd ..
```

Expected: FAIL — four `test_the_foundation_operation_exists[...]` and five `test_the_mock_has_an_example[...]`.

- [ ] **Step 3: The paths and the schemas**

Insert immediately before the line `components:`, keeping one blank line before and after:

```yaml
  # ------------------------------------------------------------ foundation: data, overview, search, activity (F-C0)
  /api/v1/projects/{projectId}/data:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [data]
      operationId: listDataItems
      summary: |
        Everything imported into the project in one list: image sets, maps, elevations, drawings and
        point clouds, newest capture first (`captured_on desc nulls last, created_at desc, id`). A
        view over each type's own table: a page asks each provider for `limit + 1` rows after the
        cursor and merges them. Each type keeps its own endpoints for everything else.
      parameters:
        - name: type
          in: query
          required: false
          schema: { type: array, items: { $ref: "#/components/schemas/DataItemType" } }
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: data items
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DataItemPage" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/overview:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [data]
      operationId: getProjectOverview
      summary: The Overview dashboard in one read. It reads only pre-aggregated rows and small-table counts, a fixed number of statements whatever the project's size; it never scans findings, boxes or images.
      responses:
        "200":
          description: the overview
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProjectOverview" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/search:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [data]
      operationId: searchProject
      summary: "The command palette's project search: findings by number (`F-0123` or `123`), note or type name, and data items by label; at most `limit` of each. It never scans images."
      parameters:
        - { name: q, in: query, required: true, schema: { type: string, minLength: 2, maxLength: 200 } }
        - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 20, default: 8 }, description: per group }
      responses:
        "200":
          description: the matches
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProjectSearchResult" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/activity:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [data]
      operationId: listActivity
      summary: The project's activity feed, newest first; `subject_id` narrows it to one finding or data item (the inspector's history).
      parameters:
        - { name: subject_id, in: query, required: false, schema: { type: string } }
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: activity, newest first
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ActivityPage" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
```

Append at the end of the file:

```yaml
    # ------------------------------------------------------------ foundation: data, overview, search, activity (F-C0)
    DataItemSummary:
      type: object
      description: >-
        The type's headline figures; each type fills its own fields. `image_set`: image_count,
        duplicate_count. `map`: gsd_cm, epsg, width, height. `elevation`: kind, cell_size_m, z_min,
        z_max. `point_cloud`: point_count, has_rgb, epsg. `drawing`: defined by the map workspace.
      properties:
        image_count: { type: integer, minimum: 0 }
        duplicate_count: { type: integer, minimum: 0 }
        gsd_cm: { type: [number, "null"] }
        epsg: { type: [integer, "null"] }
        width: { type: integer, minimum: 0 }
        height: { type: integer, minimum: 0 }
        kind: { $ref: "#/components/schemas/SurfaceKind" }
        cell_size_m: { type: [number, "null"] }
        z_min: { type: [number, "null"] }
        z_max: { type: [number, "null"] }
        point_count: { type: [integer, "null"] }
        has_rgb: { type: [boolean, "null"] }
    DataItem:
      type: object
      description: one thing imported into the project, a view over its own table (foundation §6.3)
      required: [id, type, label, captured_on, status, created_at, summary]
      properties:
        id: { type: string, description: "the id in the type's own table: a source, map, surface or point cloud id" }
        type: { $ref: "#/components/schemas/DataItemType" }
        label: { type: string }
        captured_on: { type: [string, "null"], format: date, description: the survey date; null when not set }
        status: { type: string, enum: [importing, ready, failed] }
        created_at: { type: string, format: date-time }
        summary: { $ref: "#/components/schemas/DataItemSummary" }
      example: { id: "50000000-3333-4000-8000-000000000001", type: image_set, label: "Flight 15 Apr", captured_on: "2019-04-15", status: ready, created_at: "2026-09-17T10:05:00Z", summary: { image_count: 3299, duplicate_count: 0 } }
    DataItemPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/DataItem" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - { id: "a0000000-6666-4000-8000-000000000001", type: map, label: "May survey", captured_on: "2026-05-02", status: ready, created_at: "2026-09-22T09:00:00Z", summary: { gsd_cm: 2.1, epsg: 32638, width: 24000, height: 18000 } }
          - { id: "p0000000-1111-4000-8000-000000000001", type: point_cloud, label: "May survey cloud", captured_on: "2026-05-02", status: importing, created_at: "2026-09-24T09:00:00Z", summary: { point_count: 41200000, has_rgb: true, epsg: 32638 } }
          - { id: "50000000-3333-4000-8000-000000000001", type: image_set, label: "Flight 15 Apr", captured_on: "2019-04-15", status: ready, created_at: "2026-09-17T10:05:00Z", summary: { image_count: 3299, duplicate_count: 0 } }
        next_cursor: null
    OverviewDataCounts:
      type: object
      required: [image_sets, images, maps, elevations, point_clouds, drawings]
      properties:
        image_sets: { type: integer, minimum: 0 }
        images: { type: integer, minimum: 0, description: "`SUM(source.image_count)`" }
        maps: { type: integer, minimum: 0 }
        elevations: { type: integer, minimum: 0 }
        point_clouds: { type: integer, minimum: 0 }
        drawings: { type: integer, minimum: 0, description: 0 until the map workspace adds drawings }
    OverviewVolume:
      type: object
      description: the newest ready volume measurement, and the net volume of the previous ready one over the same polygon (the KPI shows the difference)
      required: [measurement_id, name, net_m3, previous_net_m3]
      properties:
        measurement_id: { type: string }
        name: { type: string }
        net_m3: { type: [number, "null"] }
        previous_net_m3: { type: [number, "null"], description: null when there is no earlier measurement of the same polygon }
    OverviewBanner:
      type: object
      required: [kind, tone, message]
      properties:
        kind: { type: string, description: "`migration_warning`, `model_adoption` or `types_to_classify`" }
        tone: { type: string, enum: [info, warn, danger] }
        message: { type: string }
        action: { type: [string, "null"], description: "an in-app path the banner's button opens, or null" }
    ProjectOverview:
      type: object
      required: [findings, data, latest_volume, hero_map_id, banners]
      properties:
        findings: { $ref: "#/components/schemas/FindingSummary" }
        data: { $ref: "#/components/schemas/OverviewDataCounts" }
        latest_volume:
          oneOf:
            - $ref: "#/components/schemas/OverviewVolume"
            - type: "null"
        hero_map_id: { type: [string, "null"], description: "the newest ready map, shown as tiles only" }
        banners: { type: array, items: { $ref: "#/components/schemas/OverviewBanner" } }
      example:
        findings:
          by_status: { open: 47, reviewed: 12, closed: 88 }
          open_by_severity: { "1": 9, "2": 21, "3": 11, "4": 3 }
          open_no_severity: 3
          by_type: [{ type_id: "c1a2b3c4-0000-4000-8000-000000000009", n: 30 }]
          trend:
            - { day: "2026-09-25", open: 49, closed: 2, open_by_severity: { "4": 4 } }
            - { day: "2026-09-26", open: 47, closed: 3, open_by_severity: { "4": 3 } }
        data: { image_sets: 3, images: 3299, maps: 2, elevations: 1, point_clouds: 1, drawings: 0 }
        latest_volume: { measurement_id: "v0000000-1111-4000-8000-000000000001", name: "North stockpile", net_m3: 1520.4, previous_net_m3: 1307.6 }
        hero_map_id: "a0000000-6666-4000-8000-000000000001"
        banners:
          - { kind: types_to_classify, tone: info, message: "12 types came from your existing projects. Mark which are defects.", action: /catalogue }
    ProjectSearchResult:
      type: object
      required: [findings, data]
      properties:
        findings: { type: array, maxItems: 20, items: { $ref: "#/components/schemas/Finding" } }
        data: { type: array, maxItems: 20, items: { $ref: "#/components/schemas/DataItem" } }
      example:
        findings:
          - id: "f0000000-1212-4000-8000-000000000217"
            number: 217
            type_id: "c1a2b3c4-0000-4000-8000-000000000009"
            severity: 3
            status: open
            note: "Crack along the north parapet, about 40 cm."
            created_by: human
            confidence: null
            anchor: { kind: image, image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
            lon: 47.7625
            lat: 29.4951
            data_type: image_set
            data_id: "50000000-3333-4000-8000-000000000001"
            created_at: "2026-09-26T10:15:00Z"
            updated_at: "2026-09-26T10:20:00Z"
            reviewed_at: null
            closed_at: null
        data:
          - { id: "a0000000-6666-4000-8000-000000000001", type: map, label: "North parapet ortho", captured_on: "2026-05-02", status: ready, created_at: "2026-09-22T09:00:00Z", summary: { gsd_cm: 2.1, epsg: 32638, width: 24000, height: 18000 } }
    Activity:
      type: object
      required: [id, at, kind, subject_id, summary, payload]
      properties:
        id: { type: string }
        at: { type: string, format: date-time }
        kind: { type: string, description: "`finding.created`, `finding.status`, `finding.severity`, `finding.comment`, `data.imported`, `job.finished` or `detections.accepted`" }
        subject_id: { type: [string, "null"], description: the finding or data item it is about }
        summary: { type: string, description: a short human sentence }
        payload: { type: object, additionalProperties: true, description: "small, kind-specific" }
      example: { id: "e0000000-1515-4000-8000-000000000001", at: "2026-09-26T10:20:00Z", kind: finding.severity, subject_id: "f0000000-1212-4000-8000-000000000217", summary: "F-0217 set to Major", payload: { from: null, to: 3 } }
    ActivityPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/Activity" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - { id: "e0000000-1515-4000-8000-000000000001", at: "2026-09-26T10:20:00Z", kind: finding.severity, subject_id: "f0000000-1212-4000-8000-000000000217", summary: "F-0217 set to Major", payload: { from: null, to: 3 } }
        next_cursor: null
```

- [ ] **Step 4: The stubs**

In `backend/app/foundation_stubs.py`, replace `BK_PROJECT_STUBS: list[Stub] = []` with:

```python
BK_PROJECT_STUBS: list[Stub] = [
    ("GET", "/data", "listDataItems"),
    ("GET", "/search", "searchProject"),
]
```

and add at the end of `BC_PROJECT_STUBS` (after the findings tuples):

```python
    ("GET", "/overview", "getProjectOverview"),
    ("GET", "/activity", "listActivity"),
```

- [ ] **Step 5: Lint, regenerate, aliases**

```powershell
pnpm -C contract lint
pnpm -C contract generate
```

In `contract/client/index.ts`, after Task 5's aliases add:

```ts
export type DataItem = Schemas["DataItem"];
export type DataItemPage = Schemas["DataItemPage"];
export type ProjectOverview = Schemas["ProjectOverview"];
export type ProjectSearchResult = Schemas["ProjectSearchResult"];
export type Activity = Schemas["Activity"];
```

- [ ] **Step 6: Run the tests to verify they pass**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py -q
& $PY -m pytest tests/test_contract.py -q -k "data or overview or search or activity or routed or stub or allowances"
& $PY -m ruff check app/foundation_stubs.py tests/test_foundation_contract.py
& $PY -m ruff format --check app/foundation_stubs.py tests/test_foundation_contract.py
cd ..
pnpm -C frontend build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/app/foundation_stubs.py backend/tests/test_foundation_contract.py
git commit -m "feat(contract): the data list, the overview, project search and activity (F-C0)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
pnpm -C contract check
```

---

### Task 7: Models — datasets across projects, training runs, the class map, `segment`

**Files:**
- Modify: `contract/openapi.yaml` (paths; `listLibraryModels` `task` filter at line 813; `createRuns`' 202 example at line 1932; `LibraryModel` at 4301–4374 and its two examples; `LibraryModelPage` example at 4376–4438; `RunCreated` at 5523–5529; schemas appended)
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts`
- Modify: `backend/app/foundation_stubs.py` (`BM_APP_STUBS`), `backend/tests/test_contract.py` (`BACKEND_PENDING`), `backend/tests/test_api_maps_guard.py:36-37`
- Modify: `frontend/src/library/modelLabels.ts:9`, `frontend/src/test/fixtures.ts` (two `class_map`s)
- Test: `backend/tests/test_foundation_contract.py`

**Interfaces:**
- Consumes: `TrainRequest`, `SplitMethod`, `ModelMetrics`, `Job`, `JobRef`, `JobState`, `LibraryUnavailable`, `datasetId`, `modelId`, `runId` (`main`); `JobType.dataset_build` (Task 1).
- Produces: operations (501 stubs, unit BM) `putLibraryModelClassMap` (`PUT /library/models/{modelId}/class-map`, body `LibraryModelClassMapPut {mapping}` merged over the stored map → `LibraryModel`), `listLibraryDatasets`, `createLibraryDataset`, `previewLibraryDataset` (body `DatasetFilter`), `getLibraryDataset`, `deleteLibraryDataset`, `exportLibraryDataset`, `listLibraryDatasetItems`, `listTrainingRuns`, `startTrainingRun` (body `TrainRequest` → 202 `TrainingRunWithJob {training_run, job}`), `getTrainingRun` (`/library/training-runs/{runId}`); schemas `ModelTask` (`detect|obb|segment`), `LibraryModelClassMapPut`, `DatasetFilter` (`project_ids`, `type_ids` required; `captured_from`, `captured_to`, `reviewed_only` optional), `DatasetSource`, `LibraryDataset` (`origin: built|legacy`, `state: resolving|ready|failed`, `counts.per_class` a map, `export_state: none|building|ready|stale|failed`), `LibraryDatasetPage`, `LibraryDatasetCreate`, `LibraryDatasetWithJob`, `DatasetPreview` (`{images, boxes_per_type, projects}`), `LibraryDatasetItem`, `LibraryDatasetItemPage`, `TrainingRun`, `TrainingRunPage`, `TrainingRunWithJob`; `LibraryModel.task` is a `ModelTask`, `LibraryModel.class_map` (`{model class name: type id | null}`) is required; `RunCreated.added_type_ids` (`string[]`) is required.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_foundation_contract.py`, after the line `F = P + "/findings/{findingId}"` add:

```python
D = "/api/v1/library/datasets/{datasetId}"
```

add at the end of `FOUNDATION_OPERATIONS`:

```python
    # models (Task 7)
    "putLibraryModelClassMap": ("put", "/api/v1/library/models/{modelId}/class-map"),
    "listLibraryDatasets": ("get", "/api/v1/library/datasets"),
    "createLibraryDataset": ("post", "/api/v1/library/datasets"),
    "previewLibraryDataset": ("post", "/api/v1/library/datasets/preview"),
    "getLibraryDataset": ("get", D),
    "deleteLibraryDataset": ("delete", D),
    "exportLibraryDataset": ("post", D + "/export"),
    "listLibraryDatasetItems": ("get", D + "/items"),
    "listTrainingRuns": ("get", "/api/v1/library/training-runs"),
    "startTrainingRun": ("post", "/api/v1/library/training-runs"),
    "getTrainingRun": ("get", "/api/v1/library/training-runs/{runId}"),
```

at the end of `EXAMPLED_SCHEMAS`:

```python
    "LibraryDataset",
    "LibraryDatasetPage",
    "DatasetPreview",
    "LibraryDatasetItemPage",
    "TrainingRun",
    "TrainingRunPage",
```

and append at the end of the file:

```python
# ------------------------------------------------------------------------------ Task 7


def test_a_model_has_a_segment_task_and_a_class_map(spec):
    assert _schemas(spec)["ModelTask"]["enum"] == ["detect", "obb", "segment"]
    model = _schemas(spec)["LibraryModel"]
    assert model["properties"]["task"] == {"$ref": "#/components/schemas/ModelTask"}
    assert "class_map" in model["required"]
    assert "added_type_ids" in _schemas(spec)["RunCreated"]["required"]  # a run start says what it added
```

- [ ] **Step 2: Run them to confirm they fail**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py -q
cd ..
```

Expected: FAIL — eleven `test_the_foundation_operation_exists[...]`, six `test_the_mock_has_an_example[...]`, and `KeyError: 'ModelTask'`.

- [ ] **Step 3: The paths**

Insert immediately before the line `components:`, keeping one blank line before and after:

```yaml
  # ------------------------------------------------------------ foundation: models (F-C0)
  /api/v1/library/models/{modelId}/class-map:
    parameters:
      - $ref: "#/components/parameters/modelId"
    put:
      tags: [library]
      operationId: putLibraryModelClassMap
      summary: |
        Merge `mapping` into the model's app-wide class map: model class name to catalogue type id,
        or null to ignore that class; names not sent keep their entry. Run creation resolves a model
        class by exact normalised name against the catalogue first, then the model's
        `class_aliases`, then this map; leftovers still answer `422 unmapped_classes` before any job
        is queued.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/LibraryModelClassMapPut" }
      responses:
        "200":
          description: the updated library model
          content:
            application/json:
              schema: { $ref: "#/components/schemas/LibraryModel" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422":
          description: "a type id is not in the catalogue (`code` is `unknown_type`, details `{type_ids}`), or a key is not one of the model's class names (`code` is `validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503":
          description: "the model library (`code` is `library_unavailable`) or the catalogue (`code` is `catalogue_unavailable`) could not be opened"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/library/datasets:
    get:
      tags: [library]
      operationId: listLibraryDatasets
      summary: Training datasets built across projects (and the legacy per-project datasets the migration registered), newest first.
      parameters:
        - { name: task, in: query, required: false, schema: { $ref: "#/components/schemas/ModelTask" } }
        - { name: origin, in: query, required: false, schema: { type: string, enum: [built, legacy] } }
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: datasets
          content:
            application/json:
              schema: { $ref: "#/components/schemas/LibraryDatasetPage" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [library]
      operationId: createLibraryDataset
      summary: |
        Create a dataset from a filter over projects and a `dataset_build` library job that pages
        each project's matching images 500 at a time, freezes the items and their labels, and
        assigns splits (a flight never straddles train and val). No image is copied until an export
        is built.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/LibraryDatasetCreate" }
      responses:
        "202":
          description: dataset created in `resolving`, build job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/LibraryDatasetWithJob" }
        "409":
          description: "a dataset with that name exists (`code` is `already_exists`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/library/datasets/preview:
    post:
      tags: [library]
      operationId: previewLibraryDataset
      summary: |
        What a filter would hold, from COUNT queries only (images with ground truth, boxes per type)
        with a 2-second timeout per project; a project that timed out or could not be opened is
        flagged, never fatal. The builder calls it as the filter changes.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/DatasetFilter" }
      responses:
        "200":
          description: the counts
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DatasetPreview" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/library/datasets/{datasetId}:
    parameters:
      - $ref: "#/components/parameters/datasetId"
    get:
      tags: [library]
      operationId: getLibraryDataset
      responses:
        "200":
          description: the dataset with its sources and counts
          content:
            application/json:
              schema: { $ref: "#/components/schemas/LibraryDataset" }
        "404": { $ref: "#/components/responses/NotFound" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [library]
      operationId: deleteLibraryDataset
      summary: Delete the dataset row and its export folder. Project images are never touched; models trained on it are kept.
      responses:
        "204":
          description: deleted
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "its build or export job, or a training run that uses it, is queued or running (`code` is `job_running`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/library/datasets/{datasetId}/export:
    parameters:
      - $ref: "#/components/parameters/datasetId"
    post:
      tags: [library]
      operationId: exportLibraryDataset
      summary: |
        Build the YOLO export (`images/`, `labels/`, `data.yaml`) under `library\datasets\<slug>-<id8>\`
        through a `dataset` library job, hard-linking images on the same volume and copying
        otherwise. `detect` writes axis-aligned labels, `obb` rotated ones; `segment` answers 422
        `task_not_supported` until image inspection adds YOLO-seg. A missing source project fails
        the job with the list of missing projects.
      responses:
        "202":
          description: export job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "the dataset is not `ready` (`code` is `not_ready`), or its export is already building (`code` is `job_running`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "a `segment` dataset (`code` is `task_not_supported`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/library/datasets/{datasetId}/items:
    parameters:
      - $ref: "#/components/parameters/datasetId"
    get:
      tags: [library]
      operationId: listLibraryDatasetItems
      summary: The dataset's frozen items, for the detail screen's sample grid; thumbnails come from each project's own image thumbnail route.
      parameters:
        - { name: split, in: query, required: false, schema: { type: string, enum: [train, val] } }
        - { name: project_id, in: query, required: false, schema: { type: string } }
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: items
          content:
            application/json:
              schema: { $ref: "#/components/schemas/LibraryDatasetItemPage" }
        "404": { $ref: "#/components/responses/NotFound" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/library/training-runs:
    get:
      tags: [library]
      operationId: listTrainingRuns
      summary: Training runs, newest first.
      parameters:
        - { name: dataset_id, in: query, required: false, schema: { type: string } }
        - { name: state, in: query, required: false, schema: { $ref: "#/components/schemas/JobState" } }
        - $ref: "#/components/parameters/limit"
        - $ref: "#/components/parameters/cursor"
      responses:
        "200":
          description: training runs
          content:
            application/json:
              schema: { $ref: "#/components/schemas/TrainingRunPage" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [library]
      operationId: startTrainingRun
      summary: |
        Start a `train` library job on a library dataset. It builds the export first when the
        dataset's `export_state` is not `ready`, as a step of the same job. The run folder is
        `library\runs\<job_id>`. When it succeeds the model is registered in the library
        (`origin: trained`, the dataset's `task`, a `class_map` pre-filled from the dataset's
        classes) and `model_id` is set.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/TrainRequest" }
      responses:
        "202":
          description: run created, training job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/TrainingRunWithJob" }
        "404":
          description: the dataset or the base library model does not exist (`code` is `not_found`)
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "409":
          description: "the base model's weights file is missing (`code` is `model_unavailable`), or the dataset is not `ready` (`code` is `not_ready`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "a `segment` dataset (`code` is `task_not_supported`), or a base model whose task differs from the dataset's (`code` is `task_mismatch`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/library/training-runs/{runId}:
    parameters:
      - $ref: "#/components/parameters/runId"
    get:
      tags: [library]
      operationId: getTrainingRun
      summary: The run with its metrics; its curves and artefacts come from the registered model (`/library/models/{modelId}/artifacts/...`).
      responses:
        "200":
          description: the run
          content:
            application/json:
              schema: { $ref: "#/components/schemas/TrainingRun" }
        "404": { $ref: "#/components/responses/NotFound" }
        "503": { $ref: "#/components/responses/LibraryUnavailable" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 4: `segment` and the class map on the library model**

In `listLibraryModels`, replace

```yaml
        - name: task
          in: query
          schema: { type: string, enum: [detect, obb] }
```

with

```yaml
        - name: task
          in: query
          schema: { $ref: "#/components/schemas/ModelTask" }
```

In `LibraryModel`:
- in `required`, insert `class_map, ` after `class_aliases, `;
- replace `        task: { type: string, enum: [detect, obb], description: "`detect` for boxes, `obb` for rotated boxes" }` with `        task: { $ref: "#/components/schemas/ModelTask" }`;
- after the `class_aliases` property (its last line is `          additionalProperties: { type: string }`, right after the description `model class name to project class name (for COCO weights, …)`) insert:

```yaml
        class_map:
          type: object
          description: "app-wide: model class name to catalogue type id, or null when the class is ignored (`PUT /library/models/{modelId}/class-map`)"
          additionalProperties: { type: [string, "null"] }
```

- in its `example`, after `        class_aliases: {}` insert `        class_map: { excavator: "c1a2b3c4-0000-4000-8000-000000000001", dump_truck: "c1a2b3c4-0000-4000-8000-000000000004" }`.

In `LibraryModelPage`'s example, after the first item's `            class_aliases: {}` insert `            class_map: { excavator: "c1a2b3c4-0000-4000-8000-000000000001", dump_truck: "c1a2b3c4-0000-4000-8000-000000000004" }`, and after the second item's `            class_aliases: { truck: dump_truck }` insert `            class_map: { truck: "c1a2b3c4-0000-4000-8000-000000000004", person: null }`.

- [ ] **Step 5: `RunCreated` says which types a run added, and the schemas**

In `RunCreated` (line 5523), replace

```yaml
      required: [runs]
      properties:
        runs:
          type: array
          items: { $ref: "#/components/schemas/RunCreatedItem" }
```

with

```yaml
      required: [runs, added_type_ids]
      properties:
        runs:
          type: array
          items: { $ref: "#/components/schemas/RunCreatedItem" }
        added_type_ids:
          type: array
          description: catalogue types this run added to the project's type list (foundation §7.4); empty when none
          items: { type: string }
```

and in `createRuns`' 202 example (after `              schema: { $ref: "#/components/schemas/RunCreated" }` and `              example:`) insert `                added_type_ids: []` directly above `                runs:`.

Append at the end of the file:

```yaml
    # ------------------------------------------------------------ foundation: models (F-C0)
    ModelTask:
      type: string
      enum: [detect, obb, segment]
      description: "`detect` for boxes, `obb` for rotated boxes, `segment` for polygons (YOLO-seg, trained once image inspection lands)"
    LibraryModelClassMapPut:
      type: object
      required: [mapping]
      properties:
        mapping:
          type: object
          description: model class name to catalogue type id, or null to ignore the class; merged over the stored map
          additionalProperties: { type: [string, "null"] }
      example: { mapping: { truck: "c1a2b3c4-0000-4000-8000-000000000004", person: null } }
    DatasetFilter:
      type: object
      description: which annotated images a dataset takes, across projects
      required: [project_ids, type_ids]
      properties:
        project_ids: { type: array, minItems: 1, maxItems: 50, items: { type: string } }
        type_ids: { type: array, minItems: 1, maxItems: 200, items: { type: string }, description: "catalogue type ids; they fix the dataset's classes, in this order" }
        captured_from: { type: [string, "null"], format: date, description: null when absent }
        captured_to: { type: [string, "null"], format: date, description: null when absent }
        reviewed_only: { type: boolean, description: "only ground truth (accepted, edited or person-drawn annotations); false when absent" }
      example: { project_ids: ["7f1c2e3a-1111-4000-8000-000000000001", "7f1c2e3a-1111-4000-8000-000000000002"], type_ids: ["c1a2b3c4-0000-4000-8000-000000000001", "c1a2b3c4-0000-4000-8000-000000000004"], captured_from: null, captured_to: "2026-06-30", reviewed_only: true }
    DatasetSource:
      type: object
      required: [project_id, project_folder, project_name, image_count]
      properties:
        project_id: { type: string }
        project_folder: { type: string, description: at build time }
        project_name: { type: string, description: at build time }
        image_count: { type: integer, minimum: 0 }
    LibraryDataset:
      type: object
      required: [id, name, task, origin, filter, classes, split_method, split_params, state, counts, export_path, export_state, legacy_path, job_id, sources, created_at]
      properties:
        id: { type: string }
        name: { type: string }
        task: { $ref: "#/components/schemas/ModelTask" }
        origin: { type: string, enum: [built, legacy], description: "`legacy` is a project dataset the migration registered; it trains from its own `data.yaml`" }
        filter:
          oneOf:
            - $ref: "#/components/schemas/DatasetFilter"
            - type: "null"
          description: null for a legacy dataset
        classes:
          type: array
          description: frozen at creation; the order is the class index order
          items:
            type: object
            required: [type_id, name]
            properties:
              type_id: { type: string }
              name: { type: string }
        split_method: { type: string, description: "`by_group`, `by_tile` or `random`" }
        split_params: { type: object, description: "`val_fraction` and `seed`", additionalProperties: { type: number } }
        state: { type: string, enum: [resolving, ready, failed] }
        counts:
          type: object
          required: [images, train, val, per_class]
          properties:
            images: { type: integer, minimum: 0 }
            train: { type: integer, minimum: 0 }
            val: { type: integer, minimum: 0 }
            per_class: { type: object, description: type id to its label count, additionalProperties: { type: integer, minimum: 0 } }
        export_path: { type: [string, "null"], description: "absolute; `library\\datasets\\<slug>-<id8>`, null until built" }
        export_state: { type: string, enum: [none, building, ready, stale, failed] }
        legacy_path: { type: [string, "null"], description: "a legacy dataset's folder inside its project" }
        job_id: { type: [string, "null"], description: the latest build or export job }
        sources: { type: array, items: { $ref: "#/components/schemas/DatasetSource" } }
        created_at: { type: string, format: date-time }
      example:
        id: "d0000000-7777-4000-8000-000000000010"
        name: machinery-2026
        task: detect
        origin: built
        filter: { project_ids: ["7f1c2e3a-1111-4000-8000-000000000001", "7f1c2e3a-1111-4000-8000-000000000002"], type_ids: ["c1a2b3c4-0000-4000-8000-000000000001", "c1a2b3c4-0000-4000-8000-000000000004"], captured_from: null, captured_to: "2026-06-30", reviewed_only: true }
        classes: [{ type_id: "c1a2b3c4-0000-4000-8000-000000000001", name: excavator }, { type_id: "c1a2b3c4-0000-4000-8000-000000000004", name: dump_truck }]
        split_method: by_group
        split_params: { val_fraction: 0.2, seed: 42 }
        state: ready
        counts: { images: 412, train: 330, val: 82, per_class: { "c1a2b3c4-0000-4000-8000-000000000001": 750, "c1a2b3c4-0000-4000-8000-000000000004": 499 } }
        export_path: null
        export_state: none
        legacy_path: null
        job_id: "j0000000-4444-4000-8000-000000000043"
        sources:
          - { project_id: "7f1c2e3a-1111-4000-8000-000000000001", project_folder: "E:\\Projects\\Ahmadia", project_name: Ahmadia, image_count: 300 }
          - { project_id: "7f1c2e3a-1111-4000-8000-000000000002", project_folder: "E:\\Projects\\North", project_name: North site, image_count: 112 }
        created_at: "2026-09-26T12:00:00Z"
    LibraryDatasetPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/LibraryDataset" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - id: "d0000000-7777-4000-8000-000000000011"
            name: "v1 (Ahmadia)"
            task: detect
            origin: legacy
            filter: null
            classes: [{ type_id: "c1a2b3c4-0000-4000-8000-000000000001", name: excavator }]
            split_method: by_group
            split_params: { val_fraction: 0.2, seed: 42 }
            state: ready
            counts: { images: 30, train: 24, val: 6, per_class: { "c1a2b3c4-0000-4000-8000-000000000001": 40 } }
            export_path: null
            export_state: ready
            legacy_path: "E:\\Projects\\Ahmadia\\datasets\\v1"
            job_id: null
            sources: [{ project_id: "7f1c2e3a-1111-4000-8000-000000000001", project_folder: "E:\\Projects\\Ahmadia", project_name: Ahmadia, image_count: 30 }]
            created_at: "2026-09-17T12:00:00Z"
        next_cursor: null
    LibraryDatasetCreate:
      type: object
      required: [name, filter]
      properties:
        name: { type: string, minLength: 1, maxLength: 120 }
        task: { $ref: "#/components/schemas/ModelTask" }
        filter: { $ref: "#/components/schemas/DatasetFilter" }
        split_method: { $ref: "#/components/schemas/SplitMethod" }
        val_fraction: { type: number, minimum: 0.05, maximum: 0.5, description: 0.2 when absent }
        seed: { type: integer, description: 42 when absent }
      example:
        name: machinery-2026
        task: detect
        filter: { project_ids: ["7f1c2e3a-1111-4000-8000-000000000001", "7f1c2e3a-1111-4000-8000-000000000002"], type_ids: ["c1a2b3c4-0000-4000-8000-000000000001", "c1a2b3c4-0000-4000-8000-000000000004"], captured_from: null, captured_to: "2026-06-30", reviewed_only: true }
        split_method: by_group
        val_fraction: 0.2
    LibraryDatasetWithJob:
      type: object
      required: [dataset, job]
      properties:
        dataset: { $ref: "#/components/schemas/LibraryDataset" }
        job: { $ref: "#/components/schemas/Job" }
    DatasetPreview:
      type: object
      required: [images, boxes_per_type, projects]
      properties:
        images: { type: integer, minimum: 0, description: images with ground truth of the chosen types }
        boxes_per_type: { type: object, description: type id to its box count, additionalProperties: { type: integer, minimum: 0 } }
        projects:
          type: array
          items:
            type: object
            required: [project_id, project_name, images, boxes, state]
            properties:
              project_id: { type: string }
              project_name: { type: [string, "null"] }
              images: { type: integer, minimum: 0 }
              boxes: { type: integer, minimum: 0 }
              state: { type: string, enum: [ok, missing, unavailable, timed_out], description: "`timed_out` after 2 s, `missing` when not on the recent list, `unavailable` when it cannot be opened; its counts are 0" }
      example:
        images: 300
        boxes_per_type: { "c1a2b3c4-0000-4000-8000-000000000001": 750 }
        projects: [{ project_id: "7f1c2e3a-1111-4000-8000-000000000001", project_name: Ahmadia, images: 300, boxes: 750, state: ok }]
    LibraryDatasetItem:
      type: object
      required: [project_id, image_id, split, label_count]
      properties:
        project_id: { type: string }
        image_id: { type: string }
        split: { type: string, enum: [train, val] }
        label_count: { type: integer, minimum: 0 }
    LibraryDatasetItemPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/LibraryDatasetItem" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - { project_id: "7f1c2e3a-1111-4000-8000-000000000001", image_id: "10000000-5555-4000-8000-000000000001", split: train, label_count: 4 }
        next_cursor: null
    TrainingRun:
      type: object
      required: [id, name, dataset_id, base_model_id, params, job_id, state, model_id, metrics, created_at, finished_at]
      properties:
        id: { type: string }
        name: { type: string }
        dataset_id: { type: string }
        base_model_id: { type: string }
        params: { type: object, additionalProperties: true, description: "the `TrainRequest` the run started with" }
        job_id: { type: [string, "null"] }
        state: { $ref: "#/components/schemas/JobState" }
        model_id: { type: [string, "null"], description: "the registered library model, once the run succeeded" }
        metrics:
          oneOf:
            - $ref: "#/components/schemas/ModelMetrics"
            - type: "null"
          description: null until the model registers
        created_at: { type: string, format: date-time }
        finished_at: { type: [string, "null"], format: date-time }
      example:
        id: "u0000000-1616-4000-8000-000000000001"
        name: machinery-2026-n
        dataset_id: "d0000000-7777-4000-8000-000000000010"
        base_model_id: "m0000000-2222-4000-8000-000000000002"
        params: { name: machinery-2026-n, dataset_id: "d0000000-7777-4000-8000-000000000010", base_model_id: "m0000000-2222-4000-8000-000000000002", epochs: 50, imgsz: 1280, batch: null, patience: 50, augmentation: aerial, device: "0" }
        job_id: "j0000000-4444-4000-8000-000000000044"
        state: succeeded
        model_id: "m0000000-2222-4000-8000-000000000003"
        metrics: { map50: 0.71, map50_95: 0.44, precision: 0.78, recall: 0.66, per_class: [{ class_name: excavator, map50: 0.8, map50_95: 0.5, precision: 0.82, recall: 0.7 }] }
        created_at: "2026-09-26T12:30:00Z"
        finished_at: "2026-09-26T14:10:00Z"
    TrainingRunPage:
      type: object
      required: [items, next_cursor]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/TrainingRun" }
        next_cursor: { type: [string, "null"] }
      example:
        items:
          - id: "u0000000-1616-4000-8000-000000000001"
            name: machinery-2026-n
            dataset_id: "d0000000-7777-4000-8000-000000000010"
            base_model_id: "m0000000-2222-4000-8000-000000000002"
            params: { name: machinery-2026-n, dataset_id: "d0000000-7777-4000-8000-000000000010", base_model_id: "m0000000-2222-4000-8000-000000000002", epochs: 50 }
            job_id: "j0000000-4444-4000-8000-000000000044"
            state: running
            model_id: null
            metrics: null
            created_at: "2026-09-26T12:30:00Z"
            finished_at: null
        next_cursor: null
    TrainingRunWithJob:
      type: object
      required: [training_run, job]
      properties:
        training_run: { $ref: "#/components/schemas/TrainingRun" }
        job: { $ref: "#/components/schemas/Job" }
```

- [ ] **Step 6: Stubs, the pending library read, aliases, the frontend**

In `backend/app/foundation_stubs.py`, replace `BM_APP_STUBS: list[Stub] = []` with:

```python
BM_APP_STUBS: list[Stub] = [
    ("PUT", "/library/models/{modelId}/class-map", "putLibraryModelClassMap"),
    ("GET", "/library/datasets", "listLibraryDatasets"),
    ("POST", "/library/datasets", "createLibraryDataset"),
    ("POST", "/library/datasets/preview", "previewLibraryDataset"),
    ("GET", "/library/datasets/{datasetId}", "getLibraryDataset"),
    ("DELETE", "/library/datasets/{datasetId}", "deleteLibraryDataset"),
    ("POST", "/library/datasets/{datasetId}/export", "exportLibraryDataset"),
    ("GET", "/library/datasets/{datasetId}/items", "listLibraryDatasetItems"),
    ("GET", "/library/training-runs", "listTrainingRuns"),
    ("POST", "/library/training-runs", "startTrainingRun"),
    ("GET", "/library/training-runs/{runId}", "getTrainingRun"),
]
```

In `backend/tests/test_contract.py`, add the entry `    "listLibraryModels": "BM",` at the end of `BACKEND_PENDING` (the backend answers `task=segment` with 422 and sends no `class_map` until BM).

`backend/tests/test_api_maps_guard.py` asserts that with the maps router broken no path containing "map" is left, except the detect router's `/model-class-maps`; the new `/library/models/{modelId}/class-map` is a class map too. Replace

```python
    # `/model-class-maps` is the detect router's class mapping (a library model's classes), not a map.
    assert not any("map" in p.lower() and "model-class-maps" not in p for p in paths), paths
```

with

```python
    # `/model-class-maps` (the detect router) and `/library/models/{modelId}/class-map` (the model
    # library) map a model's classes, not a map.
    assert not any("map" in p.lower() and "class-map" not in p for p in paths), paths
```

```powershell
pnpm -C contract lint
pnpm -C contract generate
```

In `contract/client/index.ts`, after Task 6's aliases add:

```ts
export type ModelTask = Schemas["ModelTask"];
export type LibraryModelClassMapPut = Schemas["LibraryModelClassMapPut"];
export type LibraryDataset = Schemas["LibraryDataset"];
export type LibraryDatasetItem = Schemas["LibraryDatasetItem"];
export type DatasetFilter = Schemas["DatasetFilter"];
export type DatasetPreview = Schemas["DatasetPreview"];
export type TrainingRun = Schemas["TrainingRun"];
```

In `frontend/src/library/modelLabels.ts` replace

```ts
const TASK_LABEL: Record<LibraryModel["task"], string> = { detect: "Boxes", obb: "Rotated boxes" };
```

with

```ts
const TASK_LABEL: Record<LibraryModel["task"], string> = {
  detect: "Boxes",
  obb: "Rotated boxes",
  segment: "Polygons",
};
```

In `frontend/src/test/fixtures.ts`, after `  class_aliases: { truck: "dump_truck" },` (in `exampleModel`) and after the `  class_aliases: {},` that follows `  class_names: ["excavator", "dump_truck"],` (in `exampleTrainedModel`) add the line `  class_map: {},`.

- [ ] **Step 7: Run the tests to verify they pass**

```powershell
cd backend
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py -q
& $PY -m pytest tests/test_contract.py -q -k "library or runs or routed or stub or allowances"
& $PY -m pytest tests/test_api_maps_guard.py -q
& $PY -m ruff check app/foundation_stubs.py tests/test_contract.py tests/test_foundation_contract.py tests/test_api_maps_guard.py
& $PY -m ruff format --check app/foundation_stubs.py tests/test_contract.py tests/test_foundation_contract.py tests/test_api_maps_guard.py
cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
```

Expected: all pass. Without the `BACKEND_PENDING` entry, `test_responses_conform[GET /api/v1/library/models]` fails with `Input should be 'detect' or 'obb'` (that is the reason for the entry, not a bug to fix here).

- [ ] **Step 8: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/app/foundation_stubs.py backend/tests/test_contract.py backend/tests/test_foundation_contract.py backend/tests/test_api_maps_guard.py frontend/src/library/modelLabels.ts frontend/src/test/fixtures.ts
git commit -m "feat(contract): datasets across projects, training runs, the model class map and segment (F-C0)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
pnpm -C contract check
```

---

### Task 8: Whole-unit verification, the Prism smoke check, three ADRs, merge and hand-off

Batch 2 (DS, BK, BC, BM, MG) cuts its worktrees from `main` only after this task, so C0 is not done until it is merged.

**Files:**
- Create: `vault/decisions/2026-09-26-foundation-contract-lands-before-its-backend.md`
- Create: `vault/decisions/2026-09-26-gotcha-yaml-flow-mapping-comma-splits-a-description.md`
- Create: `vault/decisions/2026-09-26-gotcha-fastapi-app-routes-hides-included-routers.md`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: `task/f-c0` merged into `main`, the worktree removed, the branch deleted; the hand-off table (top of this plan) given to the operator.

- [ ] **Step 1: Coverage check against spec §13**

```powershell
cd backend
& $PY -c "import yaml; d=yaml.safe_load(open('../contract/openapi.yaml',encoding='utf-8')); s=d['components']['schemas']; need='CatalogueType SeverityLevel DataItem DataItemType Finding FindingAnchor FindingComment FindingAttachment FindingSummary Activity ProjectOverview ProjectSummary MigrationState AppJob LibraryDataset DatasetFilter TrainingRun'.split(); print('missing:', [n for n in need if n not in s]); print('ops:', sum(1 for p in d['paths'].values() for m in p if m in ('get','post','put','patch','delete')))"
& $PY -m pytest tests/test_foundation_contract.py tests/test_foundation_stubs.py -q
cd ..
```

Expected: `missing: []` (every schema §13 names), `ops: 203` (158 on `main` plus the 45 new ones), and `89 passed` (85 in `test_foundation_contract.py`, 4 in `test_foundation_stubs.py`).

- [ ] **Step 2: Bring the branch up to `main`**

```powershell
git -C E:\Dev\Yolo\app branch --show-current
git rebase main
git merge-base --is-ancestor main HEAD; "main is an ancestor: $($LASTEXITCODE -eq 0)"
```

Expected: the main checkout is on `main` (a parallel session may have switched it: stop and ask if not); the rebase succeeds; `main is an ancestor: True`. If `main` brought contract changes, re-run `pnpm -C contract generate` and Step 3 before going on; a conflict in `schema.d.ts` is resolved by regenerating, never by hand.

- [ ] **Step 3: The whole gate** (`AGENTS.md` §4, verbatim, e2e on free ports)

```powershell
pnpm -C contract check
cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$ports = 1..2 | ForEach-Object { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start(); $l.LocalEndpoint.Port; $l.Stop() }
$env:E2E_WEB_PORT = "$($ports[0])"; $env:E2E_MOCK_PORT = "$($ports[1])"; pnpm -C frontend e2e; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
if (Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe) { & "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path frontend/src-tauri/Cargo.toml } else { "cargo test skipped: no frozen sidecar in this worktree" }
```

Expected: contract clean and `schema.d.ts` unchanged; ruff clean; pytest all pass (about 2 150 tests, about 13 minutes); lint clean with `tokens ok`; vitest all pass; build ok; every e2e spec passes (95 at `09fb538`) (the create-body assertion in `projects.spec.ts` now includes `type_ids: []`); `cargo test skipped`. Any failure: superpowers:systematic-debugging, fix, commit, and run the whole gate again.

- [ ] **Step 4: Prism smoke check of the new surface**

```powershell
$port = 4917
Start-Process -WindowStyle Hidden -FilePath "pnpm.cmd" -ArgumentList "-C", "contract", "exec", "prism", "mock", "openapi.yaml", "--host", "127.0.0.1", "--port", "$port" | Out-Null
$base = "http://127.0.0.1:$port/api/v1"; $h = @{ Authorization = "Bearer mock" }
for ($i = 0; $i -lt 60; $i++) { try { Invoke-RestMethod "$base/health" -Headers $h | Out-Null; break } catch { Start-Sleep -Seconds 1 } }
$p = Invoke-RestMethod "$base/projects/p1" -Headers $h
"kind present: $($null -ne $p.PSObject.Properties['kind']); migration: $($p.migration.state); classes: $($p.classes.Count)"
"findings: $((Invoke-RestMethod "$base/projects/p1/findings?status=open&status=reviewed&severity=none" -Headers $h).items.Count)"
"first app job: $((Invoke-RestMethod "$base/jobs" -Headers $h).items[0].type)"
"datasets end: $($null -eq (Invoke-RestMethod "$base/library/datasets" -Headers $h).next_cursor)"
$shim = '{"name":"N","folder":"E:/x","type_ids":[],"kind":"detect","classes":[]}'
"shim body: $((Invoke-WebRequest "$base/projects" -Method Post -Headers $h -ContentType 'application/json' -Body $shim -UseBasicParsing).StatusCode)"
"retry: $((Invoke-RestMethod "$base/projects/migrations/retry" -Method Post -Headers $h -ContentType 'application/json' -Body '{"folder":"E:/x"}').state)"
"classification done: $((Invoke-WebRequest "$base/catalogue/classification/done" -Method Post -Headers $h -UseBasicParsing).StatusCode)"
try { Invoke-WebRequest "$base/catalogue/types" -Method Post -Headers $h -ContentType 'application/json' -Body '{"kind":"defect"}' -UseBasicParsing | Out-Null; "type without a name: accepted" } catch { "type without a name: $($_.Exception.Response.StatusCode.value__)" }
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Expected, line by line: `kind present: False; migration: ok; classes: 8`, `findings: 2`, `first app job: project_migrate`, `datasets end: True`, `shim body: 201` (the kind shim's body is a valid `ProjectCreate`), `retry: running`, `classification done: 204`, `type without a name: 422` (Prism validates request bodies against the new schemas).

- [ ] **Step 5: The three ADRs**

`vault/decisions/2026-09-26-foundation-contract-lands-before-its-backend.md`:

```markdown
---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, contract, foundation]
related: ["[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]", "[[2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript]]"]
---

# The foundation contract lands before its backend

## Context

The inspection foundation (spec `2026-09-26-foundation-design`, unit C0) lands its whole API in
one merge so that five units can then build in parallel without touching `openapi.yaml`. But the
gate runs against that file three ways: `backend/tests/test_contract.py` requires every contract
operation to be routed, no other route to exist, and every response to validate; `pnpm -C frontend
build` type-checks the generated client; and the e2e suite runs the UI against Prism serving the
contract. A contract that is ahead of both the backend and the UI fails all three.

## Decision

- Every new operation is routed to a 501 stub from `backend/app/foundation_stubs.py`, one list per
  building unit; `EXPECTED_STUBS` is derived from those lists, so a unit only deletes its tuple.
- `BACKEND_PENDING` in `test_contract.py` names the existing operations whose responses the backend
  cannot yet fill (new required fields); for them the test only asserts "no 5xx". The unit that
  lands last for an entry deletes it.
- Operations the foundation replaces stay in the contract with `deprecated: true` and
  `x-retire-with: F-<unit>` until that unit deletes their last caller; `RETIRING` lets a backend unit
  delete the route first.
- The project `kind` leaves the contract at once; the frontend reads it only through
  `src/api/legacyKind.ts` (absent means `train`), which unit SH deletes with the kind UI.

## Rationale

Main stays green after every merge, and each later unit's change is a deletion in a file C0 names,
never a new mechanism. Leaving the frontend build red "until SH" would have failed the gate of
every unit that merges before SH, for a reason none of them owns.

## Consequences

- Positive: batch-2 units code against final names and types from day one, and the Prism mock
  already serves every new endpoint with examples.
- Negative: three transitional allowances live in `test_contract.py` until the last backend unit
  lands, and a real backend after BK sends no `kind`, so the pre-SH screens treat every project as
  a training project until SH merges.
- Follow-ups: the hand-off table in `docs/superpowers/plans/2026-09-26-foundation-c0-contract.md`.

## Related

- [[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]] — the same "reserve up front" idea for migration ids
- [[2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript]]
```

`vault/decisions/2026-09-26-gotcha-yaml-flow-mapping-comma-splits-a-description.md`:

```markdown
---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, contract]
related: ["[[2026-09-26-foundation-contract-lands-before-its-backend]]"]
---

# Gotcha: a comma in a YAML flow mapping splits a description into an extra key

## Context

`contract/openapi.yaml` writes most properties as flow mappings:
`name: { type: string, description: absolute path; created when missing, must not already hold a project }`.
In a flow mapping a comma ends the entry, so YAML reads that as `description: "absolute path;
created when missing"` plus a second key, `must not already hold a project`, with a null value.
OpenAPI 3.1 schemas are JSON Schema, where unknown keywords are allowed, so Spectral reports
nothing, openapi-typescript ignores it, and the description is silently cut. Planning the
foundation contract found about two dozen such cut descriptions in the contract (for example
`SourceCreate.site`, `Image.path`, `LibraryModel.train_gsd_cm`, `PointCloudOut.source_path`), and
the foundation's own first draft added ten more.

## Decision

In a flow mapping, a `description` (or any scalar) that contains a comma or `": "` is
double-quoted. Block style (`description: >-` on its own lines) needs no quotes.

## Rationale

The failure is invisible to every tool in the gate; only reading the parsed YAML shows it. Quoting
is the one rule that makes it impossible.

## Consequences

- Positive: new contract text keeps its whole description.
- Negative: the existing cut descriptions stay until someone touches those schemas; a one-off scan
  (walk the parsed `components.schemas` and list keys that are not JSON Schema keywords) finds them.
- Open follow-ups: a Spectral custom rule could flag unknown schema keywords.

## Related

- [[2026-09-26-foundation-contract-lands-before-its-backend]]
```

`vault/decisions/2026-09-26-gotcha-fastapi-app-routes-hides-included-routers.md`:

```markdown
---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, backend, testing]
related: ["[[2026-09-26-foundation-contract-lands-before-its-backend]]"]
---

# Gotcha: on FastAPI 0.141 `app.routes` hides the routes of included routers

## Context

`backend/tests/test_project_kinds.py::test_every_project_route_declares_its_kinds` walks
`app.routes`, keeps the `APIRoute`s under `/api/v1/projects/{projectId}` and fails on one without a
`require_kind`. On FastAPI 0.141 an included router stays an `_IncludedRouter` object in
`app.routes` (the app's route list holds one `_IncludedRouter` and the websocket route), so the
walk finds zero `APIRoute`s and passes whatever the routers declare. Checked while planning the
foundation contract: a stub router included without any kind guard passed it.

## Decision

A test that must see every route walks `app.openapi()["paths"]` (as `test_contract.py` does), or
descends into included routers explicitly; it never trusts `app.routes` alone, and it asserts that
it found a plausible number of routes before asserting anything about them.

## Rationale

A walk that sees nothing proves nothing, and it looks green. The foundation's unit BK plans a route
walk that asserts "no `require_kind` remains" (spec §16), which would pass vacuously the same way.

## Consequences

- Positive: route-walk tests that count what they walked cannot pass empty.
- Negative: on FastAPI 0.141 `test_project_kinds.py` guards nothing; BK deletes
  it with the kind guard.

## Related

- [[2026-09-26-foundation-contract-lands-before-its-backend]]
```

```powershell
git add vault/decisions/2026-09-26-foundation-contract-lands-before-its-backend.md vault/decisions/2026-09-26-gotcha-yaml-flow-mapping-comma-splits-a-description.md vault/decisions/2026-09-26-gotcha-fastapi-app-routes-hides-included-routers.md
git commit -m "docs(vault): ADRs for the foundation contract's transition and two traps found planning it" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Merge to `main`**

```powershell
git status --short
git -C E:\Dev\Yolo\app branch --show-current
.\scripts\finish-task.ps1
```

Expected: a clean tree; the main checkout on `main`; `finish-task.ps1` rebases, runs the gate again, fast-forwards `main`, pushes it, removes the worktree and deletes the branch. It refuses while the main checkout has untracked files: on 2026-09-26 that checkout holds the operator's untracked `.superpowers/brainstorm/` mockups (the specs cite them). If it stops with `main checkout is dirty`, stop and ask the operator; never delete, move or commit those files yourself. Never delete the worktree folder by hand (memory rule: links as links, then `git worktree remove`).

- [ ] **Step 7: Hand-off and walkthrough**

Tell the operator, in this order:

1. **How to test this:** not user-observable in the app: projects, maps, clouds, runs and training behave exactly as before, because every new endpoint answers 501 and the screens are unchanged. What changed is the contract, the mock and the client types, checked by the gate and Step 4.
2. The hand-off table from the top of this plan (which unit deletes which stub, allowance and deprecated path), and the items for other units: BK's route walk must not use `app.routes` (ADR `2026-09-26-gotcha-fastapi-app-routes-hides-included-routers`); MG builds the new `revealProjectBackup` and BC the new `completeCatalogueClassification`; BC accepts `lon`/`lat` on `createFinding`; C's `view3d` paths belong in C's own C0.
3. Between BK/BC landing and SH landing, a project read from the real backend has no `kind` and the pre-SH screens treat it as a training project (detection-only screens send it Home). If the operator runs `main` for real work in that window, SH should merge right after BK and BC.

Then run `/wrapup` to log the session in `vault/sessions/` and bump `vault/00-north-star.md`.
