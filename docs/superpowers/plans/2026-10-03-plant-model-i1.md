# Plant model G1, unit I1 (intake) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page of a multi-page PDF imports in one background job, the build dialog picks whole drawing files, and it offers the project-folder drawings that were never imported with an "Import and include" action.

**Architecture:**
- Backend, `app/drawings/`:
  - a new `drawing_import` phase, `pages`, runs the existing `phase_build.run` once per page, in order, inside one job (`phase_pages.py`);
  - the new route `POST /drawings/pages` (`createDrawingPages`) creates one `Drawing` row per page and submits that job, under the same `_BUILD_LOCK` and `job_running` rule as `createDrawing`;
  - a bounded project-folder scan (`unimported.py`) backs `GET /drawings/unimported` (`listUnimportedDrawings`). It matches files to imported drawings by sha256, with a `(path, size, mtime_ns)` cache.
- Backend, M1's `list_sources` tool groups drawing pages by `source_sha256`.
- Frontend:
  - the drawing import dialog selects all pages of a multi-page PDF by default and sends one `createDrawingPages` request;
  - the asset model Build dialog lists drawings as whole files, plus a "Not imported yet" list whose "Import and include" inspects, imports and ticks the file.

**Tech Stack:** FastAPI, SQLAlchemy, pydantic v2, pypdfium2, reportlab (test fixtures only, already in the venv), pytest; React 18 + TS, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§8.1, §12, §13 "I1", §15). **Index:** `docs/superpowers/plans/2026-10-03-plant-model.md` ("Backend: intake (I1)" is binding).

**Unit:** I1. **Worktree:** `E:\Dev\Yolo\app\.claude\worktrees\pm-i1`, branch `task/pm-i1`. **Cut after:** F0 merged to `main`. **Merge position:** batch 2, any order relative to B1/B2/B3/A1/C1/K1/S1. It must merge before R1 (R1 is cut after I1).

## Global Constraints

Copied from the index; every task's requirements include them.

- `contract/openapi.yaml` is the source of truth. **F0 owns the contract**: I1 does not edit `openapi.yaml`. A defect found there is logged under "Rulings" and handed to the coordinator. `contract/client/schema.d.ts` is never hand-edited.
- Every contract operation is routed (`backend/tests/test_contract.py`). The owning unit deletes its 501 stub line from `app/asset_models/stubs_plant.py` in the same commit that lands the route.
- Path parameter names match the contract literally (`projectId`).
- Background jobs: `drawing_import` (all pages, one job). No route blocks on long work.
- Bounded reads: no route or tool loads a full image set, a full cloud or an unscaled page. PDF pages render in strips (existing `pdf.render_page_to_plan`).
- API keys: not touched by this unit. Logs carry names, states, durations and counts only.
- UI: sentence-case copy; no raw colours in TSX/CSS (`frontend/scripts/check-tokens.mjs`); motion via tokens only; respect reduced motion; use the `frontend/src/ui/` primitives. UI tasks load the design skills (`impeccable`, `emil-design-eng`) and `DESIGN.md` first.
- e2e navigation uses Main-navigation link selectors.
- Git: stage by path, never `git add -A`, never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identity "Danijel Jovanovic" / info@synapse-solutions.ai.
- Backend interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `E:\Dev\Yolo\app\.claude\worktrees\pm-i1\backend`. **Never install anything into the shared venv.** There are no new packages, Python or npm.

## Interfaces

### Provided (other units may rely on these exact names)

```python
# app/drawings/pages.py
MAX_PAGES = 500
def page_name(name: str, stem: str, page: int, page_count: int) -> str
def check_pages(insp: dict, body: DrawingPagesCreate, idir: Path) -> dict
    # {"pages": [(page, dpi), ...] in import order, "placement": {method, crs_wkt, epsg, units}}

# app/drawings/phase_pages.py  (drawing_import job, params["phase"] == "pages")
#   params: {"phase": "pages", "inspection_id": str, "placement": dict,
#            "items": [{"drawing_id": str, "page": int, "dpi": int}, ...]}
#   result: {"drawing_ids": [str, ...], "failed": [{"drawing_id", "page", "error"}, ...]}
def run(ctx) -> dict
def cancelled_before_start(ctx) -> None

# app/drawings/unimported.py
def scan_unimported(handle) -> list[dict]     # [{path, name, format, size, pages}] sorted by path, <= MAX_FILES
def cache_path(handle) -> Path               # <project>/cache/unimported.json

# app/asset_models/agent/tools.py
def group_drawing_sources(sources: list[dict]) -> list[dict]
    # [{"file": str, "facts": str, "pages": [{"id": str, "page": int | None, "label": str}]}]
```

Routes:
- `POST /api/v1/projects/{projectId}/drawings/pages` (`createDrawingPages`) → 202 `DrawingPagesWithJob {drawings: Drawing[], job: Job}`.
  - 404: unknown inspection.
  - 409 `not_ready`: the inspection is unread or failed.
  - 409 `job_running`: a build from this inspection is live; `details.job_id` names it.
  - 422 `validation_error`: `details.reason` is `pages` (not a PDF, or more than 500 pages) or `page` (a page past the end).
  - 422 `invalid_placement`: a placement a PDF cannot take.
- `GET /api/v1/projects/{projectId}/drawings/unimported` (`listUnimportedDrawings`) → 200 `{files: [{path, name, format, size, pages}]}`.

Frontend:

```ts
// frontend/src/api/drawings.ts
export type DrawingPagesCreate = S["DrawingPagesCreate"];
export type DrawingPagesWithJob = S["DrawingPagesWithJob"];
export type UnimportedDrawing = S["UnimportedDrawing"];
export function createDrawingPages(api: ApiClient, projectId: string, body: DrawingPagesCreate): Promise<DrawingPagesWithJob>
export function listUnimportedDrawings(api: ApiClient, projectId: string): Promise<UnimportedDrawing[]>

// frontend/src/mapws/drawings/drawingImport.ts
export function toDrawingPagesRequest(insp: DrawingInspection, f: DrawingForm):
  { ok: true; body: DrawingPagesCreate } | { ok: false; error: string }
export type AutoImport =
  | { kind: "pages"; body: DrawingPagesCreate }
  | { kind: "one"; body: DrawingCreate }
  | { kind: "error"; error: string };
export function autoImportRequest(insp: DrawingInspection): AutoImport

// frontend/src/setup/drawingSetup.ts
export async function settledInspection(api: ApiClient, projectId: string, inspectionId: string): Promise<DrawingInspection>

// frontend/src/assetmodels/run/drawingFiles.ts
export interface DrawingFile { key: string; label: string; meta: string | null; drawings: Drawing[]; refs: AssetSourceRef[]; status: "ready" | "importing" | "failed" }
export function groupDrawingFiles(drawings: readonly Drawing[]): DrawingFile[]

// frontend/src/assetmodels/run/importFile.ts
export async function importDrawingFile(api: ApiClient, projectId: string, path: string): Promise<{ drawings: Drawing[]; job: Job }>
```

### Consumed

| What | Where (on `main` or F0) |
| --- | --- |
| `createDrawingPages`, `listUnimportedDrawings` operations and their schemas; the TS client | F0 (`contract/openapi.yaml`, `contract/client/schema.d.ts`) |
| The two 501 stub lines | F0 `backend/app/asset_models/stubs_plant.py` |
| `phase_build.run(ctx)`, `phase_build._fail(ctx, did, message)`, `phase_build.CANCELLED` | `backend/app/drawings/phase_build.py` |
| `placement.check(insp, body, idir) -> {"page","dpi","layers","placement"}` | `backend/app/drawings/placement.py` |
| `pdf.DEFAULT_DPI`, `pdf.effective_dpi`, `pdf.open_pdf`, `pdf.unavailable_reason`, `pdf.render_page_to_plan` | `backend/app/drawings/pdf.py` |
| `detect.FORMATS` | `backend/app/drawings/detect.py` |
| `store.read_json`, `store.write_json`, `store.patch_json`, `store.sha256_file`, `store.require_inspection` | `backend/app/drawings/store.py` |
| `ID_RE` | `backend/app/surfaces/design/store.py` |
| `startup.sweep_interrupted(handle, runner)` | `backend/app/drawings/startup.py` |
| `_describe_sources(ctx, sources)`, `ListSources` | `backend/app/asset_models/agent/runner.py`, `tools.py` |
| `useTrackedJob`, `isActiveJob`, `useJobsStore`, `useChangesStore.mapWorkspaceRevision` | `frontend/src/jobs/useTrackedJob.ts`, `frontend/src/store/jobs.ts`, `frontend/src/store/changes.ts` |

**Assumed F0 schema names**, to be confirmed in Task 1:
- `DrawingPagesCreate` `{inspection_id, name, pages: "all" | int[], dpi?, placement, captured_on?}`;
- `DrawingPagesWithJob` `{drawings, job}`;
- `UnimportedDrawingList` `{files}`;
- `UnimportedDrawing` `{path, name, format, size, pages}`.

If F0 named them differently, Task 1 records the real names, and every later task uses those names in place of the assumed ones. Assertions stay the same.

## Budget

- **Background jobs:** `drawing_import`, phase `pages`. One job builds N pages in order. Each page renders in 1 024-row strips (existing `render_page_to_plan`), so at most one strip is in memory. The job is cancellable between and inside pages, and its progress runs page by page.
- **Bounded reads:**
  - `GET /drawings/unimported`:
    - reads at most 20 000 directory entries (`MAX_ENTRIES`), to depth 3, and answers at most 500 files (`MAX_FILES`);
    - hashes a file **only** when its size equals the size of an imported drawing;
    - caches hashes, LandXML sniffs and PDF page counts in `<project>/cache/unimported.json`, keyed by path and checked against size and mtime;
    - a LandXML sniff reads 4 KB.
  - `POST /drawings/pages` reads `pages.json`: one size entry per page, written by the inspect phase.
  - Build dialog: `GET /drawings` (the existing unpaged `DrawingList`; a project has tens to a few hundred drawings) and `GET /drawings/unimported` (≤ 500 rows).
- **Not a job, on purpose:** the unimported scan is a GET. It is bounded as above, and in steady state it does no hashing (cache hits, or no size match).

## Execution DAG

```
T1 align ─┬─ T2 pages module ── T3 pages job + route ─┐
          ├─ T4 unimported scan ── T5 unimported route┤
          ├─ T6 list_sources grouping ────────────────┤
          └─ T7 FE api + drawingImport ─┬─ T8 import dialog + setup ─┐
                                        └─ T9 build dialog files ── T10 not imported yet ─┼─ T11 e2e ─ T12 gate
```

- Parallel batches after T1:
  - {T2, T4, T6, T7};
  - then {T3, T5, T8, T9};
  - then T10, T11, T12.
- **Critical path:** T1 → T7 → T9 → T10 → T11 → T12.
- Backend tasks (T2 to T6) and frontend tasks (T7 to T11) touch disjoint files.

## Shared-file touches

Files outside I1's own new modules, with the anchor and the additive change:

| File | Anchor | Change |
| --- | --- | --- |
| `backend/app/drawings/schemas.py` | end of file | append `DrawingPagesCreate`, `DrawingPagesWithJob`, `UnimportedDrawingOut`, `UnimportedDrawingList` |
| `backend/app/drawings/jobs.py` | `PHASES` / `MESSAGES` dicts | add the `"pages"` entries |
| `backend/app/drawings/router.py` | the imports from `app.drawings.schemas`, and the line `@router.get("/drawings/{drawingId}", response_model=DrawingOut)` | new imports; `_require_ready` helper used by `create_drawing`; the two new routes, inserted **above** `get_drawing` so `/drawings/unimported` is not read as a `drawingId` |
| `backend/app/asset_models/stubs_plant.py` (F0) | the `createDrawingPages` and `listUnimportedDrawings` stub entries | delete those two lines |
| `backend/app/asset_models/agent/tools.py` | `class ListSources` | new `group_drawing_sources`; `ListSources.run` groups drawings |
| `backend/app/asset_models/agent/runner.py` | `_describe_sources`, `elif src["type"] == "drawing":` branch | add `file`, `sha256`, `page` keys |
| `backend/tests/test_asset_model_run_job.py` | after `test_sources_get_labels_and_facts` | one new test |
| `frontend/src/api/drawings.ts` | after `createDrawing` | two functions + three types |
| `frontend/src/mapws/drawings/drawingImport.ts` | `initialDrawingForm`, `toDrawingRequests` | all pages by default; `toDrawingPagesRequest`, `autoImportRequest`; `toDrawingRequests` and `withPageSuffix` removed |
| `frontend/src/mapws/drawings/ImportDrawingDialog.tsx` | `startImport`, footer | one request; the "Import all pages" button removed |
| `frontend/src/mapws/drawings/PdfPagePicker.tsx` | the `All` button | label "All pages" |
| `frontend/src/setup/drawingSetup.ts` | `autoDrawingRequest`, `settled`, `startDrawing` | multi-page PDFs import all pages; `settled` exported as `settledInspection` |
| `frontend/src/assetmodels/run/BuildDialog.tsx` | the drawings `DataGroup`, `GroupHead`, `SourceRow` | drawings by file + not imported yet; row parts move to `SourceRows.tsx` |
| `frontend/src/assetmodels/run/sources.ts` | end of file | `useProjectDrawings`, `useUnimportedDrawings` |
| `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx` | the three `path: /\/data$/` route blocks that serve drawings | add `/drawings$` and `/drawings/unimported$` routes |
| `frontend/e2e/fixtures/assetModels.ts` | `routeRuns` | `/drawings` and `/drawings/unimported` routes; new `routeDrawingIntake` |
| `frontend/e2e/drawings-import.spec.ts`, `frontend/e2e/models-build.spec.ts` | the PDF test; the end of the file | updated test + one new test each |

## Tests (added or changed)

- Added, backend:
  - `backend/tests/test_drawings_pages_contract.py`
  - `backend/tests/test_drawings_pages.py`
  - `backend/tests/test_drawings_pages_api.py`
  - `backend/tests/test_drawings_unimported.py`
  - `backend/tests/test_asset_model_list_sources.py`
- Changed, backend: `backend/tests/test_asset_model_run_job.py` (one test added).
- Added, frontend:
  - `frontend/src/assetmodels/run/drawingFiles.test.ts`
  - `frontend/src/assetmodels/run/importFile.test.ts`
- Changed, frontend:
  - `frontend/src/mapws/drawings/drawingImport.test.ts`
  - `frontend/src/mapws/drawings/ImportDrawingDialog.test.tsx`
  - `frontend/src/setup/drawingSetup.test.ts`
  - `frontend/src/assetmodels/run/BuildDialog.test.tsx`
  - `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx`
- e2e:
  - `frontend/e2e/drawings-import.spec.ts` (changed + 1 new);
  - `frontend/e2e/models-build.spec.ts` (+1 new);
  - `frontend/e2e/fixtures/assetModels.ts`.

## Gate (final task)

Run from `E:\Dev\Yolo\app\.claude\worktrees\pm-i1` in PowerShell:
```
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT=1473; $env:E2E_MOCK_PORT=4073; pnpm -C frontend e2e
```
`cargo test --manifest-path frontend/src-tauri/Cargo.toml` runs only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists. Otherwise it is skipped (and reported as skipped), not failed.

## Review Focus

The index's five Review Focus lines name no I1 test, so the five below are I1's own. Each has its test in the owning task.

1. **Importing a 29-page plot-plan set.** The old dialog sent one `createDrawing` per page. The second one got 409 `job_running` while the first page was still building, so only page 1 ever imported. All pages must queue in one request and one job.
   - T3 `test_all_pages_build_in_one_job_in_order`;
   - T8 vitest "imports every page by default in one request";
   - T11 e2e.
2. **The app closes in the middle of a 29-page import.** The pages already built stay ready. Every page left becomes `failed` ("interrupted") on the next open, and none is stuck `importing`.
   - T3 `test_startup_sweep_fails_every_page_left_of_an_interrupted_job`.
3. **A project folder holding thousands of drone JPGs and a 2 GB ortho GeoTIFF.** The "not imported yet" scan must answer fast. It must not hash gigabytes, list photos as drawings, or walk forever.
   - T4 `test_photo_folder_images_are_skipped`;
   - T4 `test_no_file_is_hashed_when_no_imported_size_matches`;
   - T4 `test_the_walk_stops_at_max_entries`.
4. **An imported PDF that was copied or renamed inside the project folder.** It must not show as "not imported yet" (sha256 match). A same-size file with other bytes must show.
   - T4 `test_an_imported_file_is_left_out_even_as_a_copy`;
   - T4 `test_a_same_size_file_with_other_bytes_is_listed`.
5. **One unreadable page in a long PDF.** The other pages still import, and the failed page says why. The job fails only when no page built.
   - T3 `test_one_bad_page_does_not_stop_the_rest`;
   - T3 `test_every_page_failing_fails_the_job`.

## Rulings

1. **A page that fails does not stop the job.** Its `Drawing` row becomes `failed`, with the reason `phase_build` gives, and the job goes on to the next page.
   - The job ends `succeeded` when at least one page built. Its result lists `failed`, and the final message reads "Imported 27 of 29 pages; 2 failed".
   - It ends `failed` when no page built.
   - A cancel fails the current page and every page left with "import cancelled".
2. **Page order.**
   - `pages: "all"` imports 1..N ascending.
   - An explicit list keeps the request's order and drops repeats (`[3, 1, 3]` → 3, 1).
   - At most `MAX_PAGES = 500` pages per request; more is 422 `validation_error` with reason `pages`.
3. **`createDrawingPages` is for PDFs only.** Another format is 422 `validation_error` with reason `pages` and the message "only a PDF has pages; import this file as one drawing".
4. **DPI per page** is `effective_dpi(body.dpi or 150, page size)`, the same cap as `createDrawing`. Each `Drawing.dpi` holds the page's own value.
5. **Names are "`<base> · p<k>`"** (see Deviation 1).
   - The base is `name.strip()`, with a trailing ` · p<n>` removed; it falls back to the file stem.
   - It is cut so the whole name stays ≤ 200 characters.
   - A one-page PDF gets no suffix.
6. **What counts as imported** for the scan: `Drawing` rows with `status in ("ready", "importing")`. A failed import leaves its file listed.
   - A file whose `(normcase(path), size)` equals an imported row's `(source_path, source_size)` is imported without hashing.
   - Otherwise a file is hashed only when its size equals some imported row's `source_size`. It is imported when its sha256 is in the imported set.
7. **Folders the scan skips:**
   - dot-folders;
   - folders whose name is a Kestrel id (`ID_RE`, UUID) at any depth, such as Kestrel's own `drawings/<uuid>/`;
   - at the project root only, case-insensitively: `asset_models backups cache datasets exports findings images labels maps models pointclouds reports runs surfaces volumes`.
   - The `drawings/` folder itself **is** scanned, because spec §8.1 names `Drawings/` as where operators keep plans.
8. **Depth.** Files in the project folder and in folders up to 3 levels below it are listed (`root/a/b/c/x.pdf` yes, `root/a/b/c/d/x.pdf` no).
9. **Extensions:** `.pdf .dxf .tif .tiff .png .jpg .jpeg .landxml .xml`.
   - `.jpeg` is added to the index's list because `detect.FORMATS` accepts it.
   - A `.xml` is listed only when its first 4 KB contain `landxml` (case-insensitive).
   - **Photo folders:** a folder that directly holds more than 20 PNG/JPG files is a photo folder, and its images are not listed. Its PDFs, DXFs and TIFs still are.
10. **The answer has no truncation flag.** The contract has only `files`. The walk stops after 20 000 directory entries, and the answer stops at 500 files (sorted by path, case-insensitive).
11. **The Build dialog groups drawings by `source_path`** (normalised: `/` → `\`, lower case), read from `GET /drawings`. `DrawingOut` has no `source_sha256`.
    - A file row is ticked when any of its pages is chosen. Ticking adds every ready page; unticking removes every page.
    - A partly chosen file shows "k of N pages".
    - A file with one drawing is labelled with the drawing's name. A file with several is labelled with the file name, and "N pages" appears as meta.
12. **Import and include.**
    - One file at a time; the other rows' buttons are disabled meanwhile.
    - It inspects the file, waits for the inspection the way setup does, and then:
      - a multi-page PDF imports all pages (`createDrawingPages`);
      - any other file imports with the Add data dialog's defaults (`createDrawing`).
    - A file that needs a choice (a world file without a CRS, a DXF with no visible layer) shows the reason on its row, so the operator can use Add data.
    - The new drawings are ticked at once. **Start build stays disabled while a chosen drawing is still importing**, with the hint "Waiting for N drawings to finish importing." (the server refuses a source that is not ready).
13. **`list_sources` text.**
    - Each source file is one line, `drawing file {"file":…,"facts":…,"pages":[{"id","page","label"}]}` (compact JSON), with pages in page order. The grouping key is `sha256`, else the drawing id; files keep first-seen order.
    - Point clouds and photos keep M1's line format.
    - `file` is the base name only, never a path (M1: "names only, no paths").

## Deviations (code differs from the index or the spec; the code wins)

1. **Index:** names `"<name> — p<k>"`, "matching the existing naming". The existing naming (`frontend/src/mapws/drawings/drawingImport.ts` `defaultDrawingName` / `withPageSuffix`) is `"<name> · p<k>"`, so I1 uses ` · p<k>`.
2. **Spec §8.1** scans only `Drawings/`/`drawings/` for PDF, DXF and TIF. The index (binding) scans the whole project folder to depth 3, with more extensions. I1 follows the index and adds Rulings 7 and 9 so the wider scan stays sane.
3. **The dialog's "Import all pages" footer button is removed.** All pages is now the default selection. The page picker's "All" button is renamed "All pages", and "None" stays.
4. **The setup wizard** (`startDrawing`) used to stop at a multi-page PDF with "Choose the page to import". It now imports all pages with `createDrawingPages`, as spec §8.1 says ("Importing a PDF creates one Drawing per page").

---

### Task 1: Align with merged F0

**Files:**
- Read: `contract/openapi.yaml` (paths `/api/v1/projects/{projectId}/drawings/pages` and `/drawings/unimported`, their schemas), `contract/client/schema.d.ts`, `backend/app/asset_models/stubs_plant.py`, `backend/tests/test_contract.py`
- Modify: `backend/app/drawings/schemas.py` (append)
- Test: `backend/tests/test_drawings_pages_contract.py`

**Interfaces:**
- Consumes: F0's contract and stub list.
- Produces: `DrawingPagesCreate`, `DrawingPagesWithJob`, `UnimportedDrawingOut`, `UnimportedDrawingList` (pydantic, `app.drawings.schemas`).

- [ ] **Step 1: Read F0 and write down the real names**

Run (PowerShell, worktree root):
```
git log --oneline -5 main
Select-String -Path contract/openapi.yaml -Pattern "createDrawingPages|listUnimportedDrawings" -Context 0,40
Select-String -Path contract/client/schema.d.ts -Pattern "DrawingPages|Unimported"
Select-String -Path backend/app/asset_models/stubs_plant.py -Pattern "drawings"
```
Expected:
- both operationIds exist, at `post /api/v1/projects/{projectId}/drawings/pages` and `get /api/v1/projects/{projectId}/drawings/unimported`;
- the stub file has one entry for each.

Write down:
1. the request and response schema names;
2. the property names and types of each;
3. the `pages` encoding (`"all"` or `int[]`) and its `maxItems`;
4. the `dpi` enum;
5. the declared status codes.

If any name differs from the assumed ones in this plan's "Interfaces", use F0's names in every later task. If an operation or schema is **missing**, stop and report `BLOCKED: F0 contract lacks <name>`.

- [ ] **Step 2: Write the failing mirror test**

```python
# backend/tests/test_drawings_pages_contract.py
"""I1's pydantic bodies mirror F0's contract schemas field for field (index "Backend: intake")."""

from pathlib import Path

import pytest
import yaml

from app.drawings.schemas import (
    DrawingPagesCreate,
    DrawingPagesWithJob,
    UnimportedDrawingList,
    UnimportedDrawingOut,
)

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
DOC = yaml.safe_load(SPEC.read_text("utf-8"))


def _props(name: str) -> set[str]:
    return set(DOC["components"]["schemas"][name]["properties"])


@pytest.mark.parametrize(
    ("model", "schema"),
    [
        (DrawingPagesCreate, "DrawingPagesCreate"),
        (DrawingPagesWithJob, "DrawingPagesWithJob"),
        (UnimportedDrawingList, "UnimportedDrawingList"),
        (UnimportedDrawingOut, "UnimportedDrawing"),
    ],
)
def test_models_mirror_the_contract(model, schema):
    assert set(model.model_fields) == _props(schema)


def test_operations_are_where_the_index_says():
    ops = {
        op["operationId"]: (method, path)
        for path, item in DOC["paths"].items()
        for method, op in item.items()
        if isinstance(op, dict) and "operationId" in op
    }
    assert ops["createDrawingPages"] == ("post", "/api/v1/projects/{projectId}/drawings/pages")
    assert ops["listUnimportedDrawings"] == ("get", "/api/v1/projects/{projectId}/drawings/unimported")


def test_pages_takes_all_or_a_list():
    assert DrawingPagesCreate.model_validate(
        {"inspection_id": "x", "name": "Set", "pages": "all", "placement": {"method": "none"}}
    ).pages == "all"
    assert DrawingPagesCreate.model_validate(
        {"inspection_id": "x", "name": "Set", "pages": [3, 1], "placement": {"method": "none"}}
    ).pages == [3, 1]
    with pytest.raises(ValueError):
        DrawingPagesCreate.model_validate(
            {"inspection_id": "x", "name": "Set", "pages": [0], "placement": {"method": "none"}}
        )
```

- [ ] **Step 3: Run it to see it fail**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_pages_contract.py -q` (from `backend`)
Expected: FAIL, `ImportError: cannot import name 'DrawingPagesCreate'`.

- [ ] **Step 4: Append the models to `backend/app/drawings/schemas.py`**

Match F0's property names exactly (Step 1). With the names assumed here:

```python
class DrawingPagesCreate(BaseModel):
    """createDrawingPages (plant-model spec §8.1): every chosen page of a PDF, one job."""

    inspection_id: str
    name: str = Field(min_length=1, max_length=200)
    pages: Literal["all"] | Annotated[list[Annotated[int, Field(ge=1)]], Field(min_length=1, max_length=500)]
    dpi: Literal[100, 150, 200, 300] | None = None
    placement: DrawingPlacementInput
    captured_on: date | None = None


class DrawingPagesWithJob(BaseModel):
    drawings: list[DrawingOut]
    job: JobOut


class UnimportedDrawingOut(BaseModel):
    path: str
    name: str
    format: DrawingFormatT
    size: int = Field(ge=0)
    pages: int | None = None


class UnimportedDrawingList(BaseModel):
    files: list[UnimportedDrawingOut] = Field(max_length=500)
```

If F0's `pages` list has a different `maxItems`, use F0's value in both this model and `pages.MAX_PAGES` (Task 2).

- [ ] **Step 5: Run it to see it pass**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_pages_contract.py -q`
Expected: `5 passed`.

- [ ] **Step 6: Commit**

```
git add backend/app/drawings/schemas.py backend/tests/test_drawings_pages_contract.py
git commit -m "feat(drawings): I1 request/response models for all-pages import and the unimported scan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Page plan and page names (`app/drawings/pages.py`)

**Files:**
- Create: `backend/app/drawings/pages.py`
- Test: `backend/tests/test_drawings_pages.py`

**Interfaces:**
- Consumes: `placement.check`, `pdf.DEFAULT_DPI`, `pdf.effective_dpi`, `store.read_json`, `DrawingPagesCreate` (Task 1).
- Produces: `MAX_PAGES`, `page_name(name, stem, page, page_count) -> str`, `check_pages(insp, body, idir) -> {"pages": [(page, dpi)], "placement": dict}`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_drawings_pages.py
"""Page plan and page names for createDrawingPages (I1 Rulings 2 to 5)."""

import pytest

from app.drawings import pages, store
from app.drawings.schemas import DrawingPagesCreate
from app.errors import AppError


def _body(**kw) -> DrawingPagesCreate:
    return DrawingPagesCreate.model_validate(
        {"inspection_id": "x", "name": "Set", "placement": {"method": "none"}, "pages": "all", **kw}
    )


def _idir(tmp_path, sizes):
    store.write_json(
        tmp_path / "pages.json",
        {"pages": [{"page": i + 1, "width_pt": w, "height_pt": h} for i, (w, h) in enumerate(sizes)]},
    )
    return tmp_path


PDF = {"format": "pdf", "layers": [], "embedded": None}


def test_all_is_every_page_ascending_with_its_own_dpi(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0), (14400.0, 1440.0), (300.0, 200.0)])
    plan = pages.check_pages(PDF, _body(dpi=300), idir)
    assert plan["pages"] == [(1, 300), (2, 100), (3, 300)]
    assert plan["placement"]["method"] == "none"


def test_a_list_keeps_its_order_and_drops_repeats(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 3)
    assert [p for p, _ in pages.check_pages(PDF, _body(pages=[3, 1, 3]), idir)["pages"]] == [3, 1]


def test_the_default_dpi_is_150(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 2)
    assert pages.check_pages(PDF, _body(), idir)["pages"] == [(1, 150), (2, 150)]


def test_a_page_past_the_end_is_refused(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 2)
    with pytest.raises(AppError) as e:
        pages.check_pages(PDF, _body(pages=[1, 3]), idir)
    assert (e.value.code, e.value.status, e.value.details) == ("validation_error", 422, {"reason": "page"})


def test_only_a_pdf_has_pages(tmp_path):
    with pytest.raises(AppError) as e:
        pages.check_pages({"format": "png", "layers": [], "embedded": None}, _body(), tmp_path)
    assert e.value.details == {"reason": "pages"} and "only a PDF has pages" in e.value.message


def test_more_than_max_pages_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(pages, "MAX_PAGES", 2)
    idir = _idir(tmp_path, [(300.0, 200.0)] * 3)
    with pytest.raises(AppError) as e:
        pages.check_pages(PDF, _body(), idir)
    assert e.value.details == {"reason": "pages"}


def test_a_crs_placement_is_refused_for_a_pdf(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 2)
    with pytest.raises(AppError) as e:
        pages.check_pages(PDF, _body(placement={"method": "crs", "crs": "EPSG:32639"}), idir)
    assert e.value.code == "invalid_placement"


@pytest.mark.parametrize(
    ("name", "page", "count", "want"),
    [
        ("Plot plan", 2, 29, "Plot plan · p2"),
        ("  Plot plan · p7 ", 3, 29, "Plot plan · p3"),
        ("   ", 1, 2, "T0005 · p1"),
        ("Plot plan", 1, 1, "Plot plan"),
    ],
)
def test_page_names(name, page, count, want):
    assert pages.page_name(name, "T0005", page, count) == want


def test_a_long_name_keeps_its_page_suffix():
    got = pages.page_name("x" * 200, "s", 12, 29)
    assert len(got) == 200 and got.endswith(" · p12")
```

`AppError` exposes `.code`, `.message`, `.status` and `.details`; check `backend/app/errors.py`. If an attribute name differs there, adapt only these assertions.

- [ ] **Step 2: Run them to see them fail**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_pages.py -q`
Expected: FAIL, `ImportError: cannot import name 'pages' from 'app.drawings'`.

- [ ] **Step 3: Write `backend/app/drawings/pages.py`**

```python
"""createDrawingPages: which pages, at which DPI, under which names (plant-model spec §8.1; plan
2026-10-03-plant-model-i1 Rulings 2 to 5). Light imports only: the router loads this module."""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

from app.drawings import placement as placing
from app.drawings import store
from app.errors import AppError

MAX_PAGES = 500
MAX_NAME = 200
_SUFFIX = re.compile(r" · p\d+$")


def page_name(name: str, stem: str, page: int, page_count: int) -> str:
    """`<base> · p<k>` (the dialog's own naming), the base cut so the whole stays <= 200 chars; a
    one-page PDF keeps its plain name."""
    base = _SUFFIX.sub("", name.strip()).strip() or stem
    if page_count <= 1:
        return base[:MAX_NAME]
    suffix = f" · p{page}"
    return base[: MAX_NAME - len(suffix)] + suffix


def _refuse(message: str, reason: str) -> AppError:
    return AppError("validation_error", message, 422, {"reason": reason})


def check_pages(insp: dict, body, idir: Path) -> dict:
    """The pages to build, in order, each with its capped DPI, and the checked placement."""
    if insp["format"] != "pdf":
        raise _refuse("only a PDF has pages; import this file as one drawing", "pages")
    from app.drawings.pdf import DEFAULT_DPI, effective_dpi

    sizes = store.read_json(idir / "pages.json")["pages"]
    if body.pages == "all":
        chosen = list(range(1, len(sizes) + 1))
    else:
        chosen = list(dict.fromkeys(body.pages))
        if any(p > len(sizes) for p in chosen):
            raise _refuse(f"this PDF has {len(sizes)} page(s)", "page")
    if len(chosen) > MAX_PAGES:
        raise _refuse(f"import at most {MAX_PAGES} pages at a time", "pages")
    one = SimpleNamespace(page=chosen[0], dpi=body.dpi, layers=None, placement=body.placement)
    placement = placing.check(insp, one, idir)["placement"]
    wanted = body.dpi or DEFAULT_DPI
    planned = [
        (p, effective_dpi(wanted, sizes[p - 1]["width_pt"], sizes[p - 1]["height_pt"])) for p in chosen
    ]
    return {"pages": planned, "placement": placement}
```

- [ ] **Step 4: Run them to see them pass**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_pages.py -q`
Expected: `12 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/drawings/pages.py backend/tests/test_drawings_pages.py
git commit -m "feat(drawings): page plan and page names for all-pages PDF import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `pages` job phase and `createDrawingPages`

**Files:**
- Create: `backend/app/drawings/phase_pages.py`
- Modify: `backend/app/drawings/jobs.py` (`PHASES`, `MESSAGES`)
- Modify: `backend/app/drawings/router.py` (imports; `_require_ready`; new route above `get_drawing`)
- Modify: `backend/app/asset_models/stubs_plant.py` (delete the `createDrawingPages` stub line)
- Test: `backend/tests/test_drawings_pages_api.py`

**Interfaces:**
- Consumes: `pages.check_pages`, `pages.page_name` (Task 2); `phase_build.run`, `phase_build._fail`, `phase_build.CANCELLED`; `DrawingPagesCreate`, `DrawingPagesWithJob` (Task 1).
- Produces:
  - `phase_pages.run(ctx) -> {"drawing_ids", "failed"}`;
  - `phase_pages.cancelled_before_start(ctx)`;
  - the `POST /drawings/pages` route; job params `{"phase": "pages", "inspection_id", "placement", "items": [{"drawing_id", "page", "dpi"}]}`.

- [ ] **Step 1: Write the failing API tests**

```python
# backend/tests/test_drawings_pages_api.py
"""createDrawingPages: every page of a PDF in one drawing_import job (plant-model spec §8.1; I1
Review Focus 1, 2 and 5)."""

import math
import time
import uuid

from drawings_helpers import BASE, build_drawing, inspect_ready, write_pdf, write_png

from app.db.models import Drawing
from app.drawings import pdf, phase_pages, startup, store
from app.jobs.cancellation import JobFailure


def _pages(client, project_id, inspection_id, **body):
    body = {"name": "Set", "placement": {"method": "none"}, "pages": "all", **body}
    return client.post(f"{BASE}/{project_id}/drawings/pages", json={**body, "inspection_id": inspection_id})


def _spy(monkeypatch, *, fail_page=None, block=False):
    calls = []
    real = pdf.render_page_to_plan

    def spy(path, page_n, dpi, dst, *, progress, check_cancelled, **kw):
        calls.append((page_n, dpi))
        if page_n == fail_page:
            raise JobFailure(f"page {page_n} is broken")
        while block:
            check_cancelled()
            time.sleep(0.01)
        return real(path, page_n, dpi, dst, progress=progress, check_cancelled=check_cancelled, **kw)

    monkeypatch.setattr(pdf, "render_page_to_plan", spy)
    return calls


def _get(client, project_id, did):
    return client.get(f"{BASE}/{project_id}/drawings/{did}").json()


def test_all_pages_build_in_one_job_in_order(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    src = write_pdf(tmp_path / "set.pdf", [(300.0, 200.0), (842.0, 595.0), (200.0, 300.0)])
    insp = inspect_ready(client, project_id, wait_job, src)
    calls = _spy(monkeypatch)
    r = _pages(client, project_id, insp["id"], dpi=100)
    assert r.status_code == 202, r.text
    body = r.json()
    assert [d["name"] for d in body["drawings"]] == ["Set · p1", "Set · p2", "Set · p3"]
    assert [d["page"] for d in body["drawings"]] == [1, 2, 3]
    assert {d["job_id"] for d in body["drawings"]} == {body["job"]["id"]}
    assert all(d["status"] == "importing" for d in body["drawings"])
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"] == {"drawing_ids": [d["id"] for d in body["drawings"]], "failed": []}
    assert [c[0] for c in calls] == [1, 2, 3]
    got = [_get(client, project_id, d["id"]) for d in body["drawings"]]
    assert all(d["status"] == "ready" for d in got)
    assert (got[1]["width"], got[1]["height"], got[1]["dpi"]) == (
        math.ceil(842 * 100 / 72),
        math.ceil(595 * 100 / 72),
        100,
    )
    with handle.session() as s:
        shas = {s.get(Drawing, d["id"]).source_sha256 for d in body["drawings"]}
    assert shas == {insp["sha256"]}


def test_explicit_pages_keep_their_order(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 3))
    calls = _spy(monkeypatch)
    body = _pages(client, project_id, insp["id"], pages=[3, 1, 3]).json()
    assert [d["page"] for d in body["drawings"]] == [3, 1]
    wait_job(project_id, body["job"]["id"])
    assert [c[0] for c in calls] == [3, 1]


def test_the_dpi_is_capped_per_page(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(
        client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(14400.0, 1440.0), (300.0, 200.0)])
    )
    _spy(monkeypatch, block=True)
    body = _pages(client, project_id, insp["id"], dpi=300).json()
    assert [d["dpi"] for d in body["drawings"]] == [100, 300]
    client.post(f"{BASE}/{project_id}/jobs/{body['job']['id']}/cancel")
    wait_job(project_id, body["job"]["id"])


def test_a_build_while_pages_run_is_409_both_ways(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 2))
    _spy(monkeypatch, block=True)
    first = _pages(client, project_id, insp["id"]).json()
    again = _pages(client, project_id, insp["id"])
    assert again.status_code == 409 and again.json()["error"]["code"] == "job_running"
    assert again.json()["error"]["details"]["job_id"] == first["job"]["id"]
    one = client.post(
        f"{BASE}/{project_id}/drawings",
        json={"inspection_id": insp["id"], "name": "P", "page": 1, "placement": {"method": "none"}},
    )
    assert one.status_code == 409 and one.json()["error"]["code"] == "job_running"
    client.post(f"{BASE}/{project_id}/jobs/{first['job']['id']}/cancel")
    wait_job(project_id, first["job"]["id"])


def test_cancel_fails_every_page_left(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 3))
    _spy(monkeypatch, block=True)
    body = _pages(client, project_id, insp["id"]).json()
    client.post(f"{BASE}/{project_id}/jobs/{body['job']['id']}/cancel")
    assert wait_job(project_id, body["job"]["id"])["state"] == "cancelled"
    for d in body["drawings"]:
        got = _get(client, project_id, d["id"])
        assert (got["status"], got["error"]) == ("failed", "import cancelled")
        assert not store.drawing_dir(handle, d["id"]).exists()


def test_one_bad_page_does_not_stop_the_rest(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 3))
    _spy(monkeypatch, fail_page=2)
    body = _pages(client, project_id, insp["id"]).json()
    job = wait_job(project_id, body["job"]["id"])
    ids = [d["id"] for d in body["drawings"]]
    assert job["state"] == "succeeded"
    assert job["result"] == {
        "drawing_ids": [ids[0], ids[2]],
        "failed": [{"drawing_id": ids[1], "page": 2, "error": "page 2 is broken"}],
    }
    assert job["message"] == "Imported 2 of 3 pages; 1 failed"
    statuses = [_get(client, project_id, i) for i in ids]
    assert [d["status"] for d in statuses] == ["ready", "failed", "ready"]
    assert statuses[1]["error"] == "page 2 is broken"


def test_every_page_failing_fails_the_job(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 2))
    monkeypatch.setattr(
        pdf, "render_page_to_plan", lambda *a, **k: (_ for _ in ()).throw(JobFailure("unreadable"))
    )
    body = _pages(client, project_id, insp["id"]).json()
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "failed"
    assert job["error"].startswith("none of the 2 pages could be imported")


def test_refusals(client, project_id, wait_job, tmp_path):
    png = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    r = _pages(client, project_id, png["id"])
    assert r.status_code == 422 and r.json()["error"]["details"] == {"reason": "pages"}
    two = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "t.pdf", [(100.0, 100.0)] * 2))
    r = _pages(client, project_id, two["id"], pages=[3])
    assert r.status_code == 422 and r.json()["error"]["details"] == {"reason": "page"}
    r = _pages(client, project_id, str(uuid.uuid4()))
    assert r.status_code == 404


def test_a_single_page_build_still_works_after(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 2))
    body = _pages(client, project_id, insp["id"], pages=[1]).json()
    wait_job(project_id, body["job"]["id"])
    d = build_drawing(client, project_id, wait_job, insp["id"], page=2)
    assert d["status"] == "ready" and d["page"] == 2


def test_startup_sweep_fails_every_page_left_of_an_interrupted_job(handle, app):
    dead = str(uuid.uuid4())
    with handle.session() as s:
        rows = [
            Drawing(
                name=f"Set · p{p}",
                format="pdf",
                source_path="C:/x/set.pdf",
                source_size=1,
                page=p,
                status="importing",
                job_id=dead,
            )
            for p in (2, 3)
        ]
        s.add_all(rows)
        s.flush()
        ids = {r.id for r in rows}
    assert set(startup.sweep_interrupted(handle, app.state.jobs)) == ids
    with handle.session() as s:
        assert {s.get(Drawing, i).status for i in ids} == {"failed"}


def test_cancelled_before_start_fails_every_page(handle):
    with handle.session() as s:
        rows = [
            Drawing(name="p", format="pdf", source_path="C:/x/s.pdf", source_size=1, page=p, status="importing")
            for p in (1, 2)
        ]
        s.add_all(rows)
        s.flush()
        ids = [r.id for r in rows]

    class Ctx:
        project = handle
        params = {"phase": "pages", "inspection_id": str(uuid.uuid4()), "placement": {"method": "none"},
                  "items": [{"drawing_id": i, "page": n + 1, "dpi": 150} for n, i in enumerate(ids)]}
        published: list = []

        def publish(self, type, payload):
            self.published.append((type, payload))

    phase_pages.cancelled_before_start(Ctx())
    with handle.session() as s:
        assert [(s.get(Drawing, i).status, s.get(Drawing, i).error) for i in ids] == [
            ("failed", "import cancelled"),
            ("failed", "import cancelled"),
        ]
```

`job["message"]` is the job's last progress message (`JobContext.last_message`, stored with the terminal state). If the jobs API names this field differently, read `backend/app/jobs/schemas.py` and use its name.

- [ ] **Step 2: Run them to see them fail**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_pages_api.py -q`
Expected: FAIL, `ImportError: cannot import name 'phase_pages'`.

- [ ] **Step 3: Write `backend/app/drawings/phase_pages.py`**

```python
"""The `pages` phase (plant-model spec §8.1): one drawing_import job builds every chosen PDF page in
order, each through the `build` phase. A failing page fails only its own drawing (plan I1 Ruling 1);
a cancel fails the page in hand and every page left."""

from __future__ import annotations

from app.drawings import phase_build
from app.jobs.cancellation import JobCancelled, JobFailure


class PageCtx:
    """What `phase_build.run` sees for one page: the job's project, cancel flag and events, this
    page's build params, and progress mapped into the page's share of the job."""

    def __init__(self, ctx, item: dict, k: int, n: int):
        self._ctx = ctx
        self.project, self.job_id, self.cancelled = ctx.project, ctx.job_id, ctx.cancelled
        self.params = {
            "phase": "build",
            "drawing_id": item["drawing_id"],
            "inspection_id": ctx.params["inspection_id"],
            "page": item["page"],
            "dpi": item["dpi"],
            "layers": None,
            "placement": ctx.params["placement"],
        }
        self._lo, self._hi = k / n, (k + 1) / n
        self._label = f"Page {item['page']} ({k + 1} of {n})"

    def check_cancelled(self) -> None:
        self._ctx.check_cancelled()

    def progress(self, fraction: float, message: str = "") -> None:
        f = max(0.0, min(1.0, float(fraction)))
        text = f"{self._label} · {message}" if message else self._label
        self._ctx.progress(self._lo + (self._hi - self._lo) * f, text)

    def publish(self, type: str, payload: dict) -> None:
        self._ctx.publish(type, payload)


def _fail_items(ctx, items: list[dict]) -> None:
    for item in items:
        phase_build._fail(ctx, item["drawing_id"], phase_build.CANCELLED)


def cancelled_before_start(ctx) -> None:
    _fail_items(ctx, ctx.params["items"])


def _reason(e: Exception) -> str:
    return str(e) if isinstance(e, JobFailure) else f"import failed: {type(e).__name__}"


def run(ctx) -> dict:
    items = list(ctx.params["items"])
    n = len(items)
    built: list[str] = []
    failed: list[dict] = []
    for k, item in enumerate(items):
        if ctx.cancelled.is_set():
            _fail_items(ctx, items[k:])
            raise JobCancelled()
        try:
            phase_build.run(PageCtx(ctx, item, k, n))
        except JobCancelled:
            _fail_items(ctx, items[k + 1 :])
            raise
        except Exception as e:  # phase_build already failed this page's row with the reason
            failed.append({"drawing_id": item["drawing_id"], "page": item["page"], "error": _reason(e)})
            continue
        built.append(item["drawing_id"])
    if not built:
        first = failed[0]
        raise JobFailure(f"none of the {n} pages could be imported; page {first['page']}: {first['error']}")
    ctx.progress(1.0, f"Imported {len(built)} of {n} pages" + (f"; {len(failed)} failed" if failed else ""))
    return {"drawing_ids": built, "failed": failed}
```

- [ ] **Step 4: Register the phase in `backend/app/drawings/jobs.py`**

Replace the two dicts:

```python
PHASES = {
    "inspect": "app.drawings.phase_inspect",
    "build": "app.drawings.phase_build",
    "pages": "app.drawings.phase_pages",
}
MESSAGES = {"inspect": "Reading drawing", "build": "Importing drawing", "pages": "Importing drawing pages"}
```

- [ ] **Step 5: Add the route to `backend/app/drawings/router.py`**

1. Extend the imports:

```python
from app.drawings import detect, footprint, pages, service, site, store, vtiles
from app.drawings.schemas import (
    DrawingCreate,
    DrawingGeorefPut,
    DrawingInspectionCreate,
    DrawingInspectionOut,
    DrawingInspectionWithJob,
    DrawingList,
    DrawingOut,
    DrawingPagesCreate,
    DrawingPagesWithJob,
    DrawingPatch,
    DrawingWithJob,
    GeorefFitOut,
    GeorefFitRequest,
)
```

2. Add a helper below `_BUILD_LOCK = ...`, and use it in `create_drawing` in place of its inline `if insp["state"] != "ready": ...` block (same messages):

```python
def _require_ready(insp: dict) -> None:
    if insp["state"] != "ready":
        message = (
            "the file is still being read"
            if insp["state"] == "inspecting"
            else "reading the file failed; choose it again"
        )
        raise AppError("not_ready", message, 409)


def _live_build(req: dict, runner) -> str | None:
    return next((j for j in req.get("build_job_ids", []) if runner.is_live(j)), None)
```

In `create_drawing`, replace `live = next((j for j in req.get("build_job_ids", []) if runner.is_live(j)), None)` with `live = _live_build(req, runner)`.

3. Insert the new route **directly above** `@router.get("/drawings/{drawingId}", response_model=DrawingOut)`:

```python
@router.post("/drawings/pages", response_model=DrawingPagesWithJob, status_code=202)
def create_drawing_pages(
    body: DrawingPagesCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> DrawingPagesWithJob:
    """Every chosen page of a PDF in one `drawing_import` job (phase `pages`), in order (plant-model
    spec §8.1). One Drawing per page, all sharing the file's sha256. Publishes `drawings.changed`."""
    idir = store.require_inspection(handle, body.inspection_id)
    insp = _read_or_404(idir / "inspection.json", "drawing inspection", body.inspection_id)
    _require_ready(insp)
    plan = pages.check_pages(insp, body, idir)
    stem = Path(insp["path"]).stem
    count = insp.get("page_count") or len(plan["pages"])
    runner = request.app.state.jobs
    with _BUILD_LOCK:
        req = _read_or_404(idir / "request.json", "drawing inspection", body.inspection_id)
        live = _live_build(req, runner)
        if live is not None:
            raise AppError("job_running", "a drawing is being imported from this file", 409, {"job_id": live})
        with handle.session() as s:
            rows = [
                Drawing(
                    name=pages.page_name(body.name, stem, page, count),
                    format="pdf",
                    source_path=insp["path"],
                    source_size=insp["file_size"],
                    source_sha256=insp["sha256"],
                    page=page,
                    status="importing",
                    units=None,
                    dpi=dpi,
                    extent_src=None,
                    layers=[],
                    georef=None,
                    georef_version=0,
                    bounds_site=None,
                    layer_state={"hidden_layers": [], "knockout_white": False},
                    captured_on=body.captured_on,
                )
                for page, dpi in plan["pages"]
            ]
            s.add_all(rows)
            s.flush()
            ids = [r.id for r in rows]
        items = [
            {"drawing_id": did, "page": page, "dpi": dpi}
            for did, (page, dpi) in zip(ids, plan["pages"], strict=True)
        ]
        job = runner.submit(
            handle,
            "drawing_import",
            {
                "phase": "pages",
                "inspection_id": body.inspection_id,
                "placement": plan["placement"],
                "items": items,
            },
        )
        store.patch_json(idir / "request.json", build_job_ids=[*req.get("build_job_ids", []), job.id])
    with handle.session() as s:
        outs = []
        for did in ids:
            row = service.require(s, did)
            row.job_id = job.id
            outs.append(service.to_out(row, None))
    publish_drawings_changed(request, handle, ids)
    return DrawingPagesWithJob(drawings=outs, job=JobOut.from_row(job, handle.id))
```

Note: the job may finish a fast page before `job_id` is written. That race already exists in `create_drawing` and is harmless: `phase_build` does not read `row.job_id`.

- [ ] **Step 6: Delete the stub line**

In `backend/app/asset_models/stubs_plant.py`, delete the entry for `createDrawingPages` (the `("POST", "/drawings/pages", ...)` line, or however F0 wrote it). Leave every other entry.

- [ ] **Step 7: Run the tests**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_pages_api.py tests/test_drawings_pdf.py tests/test_drawings_raster_build.py -q`
Expected: all pass (the new file has 12 tests).

- [ ] **Step 8: Run the contract test for these routes**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q -k "drawing or stub or routes"`
Expected: PASS.
- If schemathesis reports `createDrawingPages` refusing generated valid data with a declared status (404 for an unknown inspection), add `"createDrawingPages": {404, 409, 422}` to `REFUSES_VALID_DATA` in `backend/tests/test_contract.py`, next to `"createDrawingInspection": {422}`. Include only the statuses it reports that the contract declares.
- If a needed status is **not** declared in F0's contract, stop and log a Ruling: a contract defect, handed to the coordinator.

- [ ] **Step 9: Commit**

```
git add backend/app/drawings/phase_pages.py backend/app/drawings/jobs.py backend/app/drawings/router.py backend/app/asset_models/stubs_plant.py backend/tests/test_drawings_pages_api.py
git commit -m "feat(drawings): createDrawingPages builds every PDF page in one drawing_import job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Add `backend/tests/test_contract.py` to the `git add` only if Step 8 changed it.)

---

### Task 4: The unimported-drawings scan (`app/drawings/unimported.py`)

**Files:**
- Create: `backend/app/drawings/unimported.py`
- Test: `backend/tests/test_drawings_unimported.py`

**Interfaces:**
- Consumes: `Drawing` (ORM), `detect.FORMATS`, `store.read_json`/`write_json`/`sha256_file`, `pdf.open_pdf`/`unavailable_reason`, `ID_RE`.
- Produces:
  - `scan_unimported(handle) -> list[dict]` (keys `path, name, format, size, pages`);
  - `cache_path(handle) -> Path`;
  - module constants `MAX_FILES = 500`, `MAX_ENTRIES = 20_000`, `MAX_DEPTH = 3`, `PHOTO_FOLDER = 20`;
  - `_sha256(path) -> str | None`, the seam the tests count.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_drawings_unimported.py
"""Project-folder drawings never imported (plant-model spec §8.1; I1 Rulings 6 to 10; Review Focus 3, 4)."""

import hashlib
import os
import shutil
import uuid
from pathlib import Path

from drawings_helpers import write_pdf, write_png

from app.db.models import Drawing
from app.drawings import store, unimported


def _root(handle) -> Path:
    return Path(handle.folder)


def _write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def _import(handle, path: Path, *, status="ready", at: Path | None = None):
    """A Drawing row for `path`'s bytes (as if imported from `at`, default the same path)."""
    src = at or path
    with handle.session() as s:
        s.add(
            Drawing(
                name=path.stem,
                format="pdf",
                source_path=str(src),
                source_size=path.stat().st_size,
                source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                status=status,
            )
        )


def _names(handle) -> list[str]:
    return [f["name"] for f in unimported.scan_unimported(handle)]


def _count_hashes(monkeypatch) -> list[Path]:
    seen: list[Path] = []
    real = unimported._sha256

    def spy(path):
        seen.append(path)
        return real(path)

    monkeypatch.setattr(unimported, "_sha256", spy)
    return seen


def test_lists_a_new_pdf_with_its_page_count(handle):
    src = write_pdf(_root(handle) / "Drawings" / "T0005.pdf", [(200.0, 200.0)] * 3)
    files = unimported.scan_unimported(handle)
    assert files == [
        {"path": str(src), "name": "T0005.pdf", "format": "pdf", "size": src.stat().st_size, "pages": 3}
    ]


def test_an_imported_file_is_left_out_even_as_a_copy(handle):
    src = write_pdf(_root(handle) / "Drawings" / "T0005.pdf", [(200.0, 200.0)] * 2)
    _import(handle, src)
    (_root(handle) / "Old").mkdir()
    shutil.copyfile(src, _root(handle) / "Old" / "T0005-copy.pdf")
    assert _names(handle) == []


def test_a_same_size_file_with_other_bytes_is_listed(handle):
    a = _write(_root(handle) / "Drawings" / "a.pdf", b"%PDF-1.4 " + b"a" * 100)
    b = _write(_root(handle) / "Drawings" / "b.pdf", b"%PDF-1.4 " + b"b" * 100)
    _import(handle, a)
    files = unimported.scan_unimported(handle)
    assert [f["name"] for f in files] == ["b.pdf"]
    assert files[0]["pages"] is None  # not a readable PDF; still listed
    assert b.stat().st_size == a.stat().st_size


def test_no_file_is_hashed_when_no_imported_size_matches(handle, monkeypatch):
    seen = _count_hashes(monkeypatch)
    _write(_root(handle) / "Drawings" / "big.tif", b"II*\x00" + b"0" * 5000)
    imported = _write(_root(handle) / "elsewhere.pdf", b"%PDF " + b"z" * 10)
    _import(handle, imported, at=Path("C:/gone/elsewhere.pdf"))
    imported.unlink()
    assert _names(handle) == ["big.tif"]
    assert seen == []


def test_the_hash_is_cached_until_the_file_changes(handle, monkeypatch):
    a = _write(_root(handle) / "Drawings" / "a.pdf", b"%PDF " + b"a" * 50)
    b = _write(_root(handle) / "Drawings" / "b.pdf", b"%PDF " + b"b" * 50)
    _import(handle, a, at=Path("C:/elsewhere/a.pdf"))  # same size as b, another path: b must be hashed
    seen = _count_hashes(monkeypatch)
    assert sorted(_names(handle)) == ["b.pdf"]
    assert sorted(p.name for p in seen) == ["a.pdf", "b.pdf"]
    seen.clear()
    assert sorted(_names(handle)) == ["b.pdf"]
    assert seen == []  # both hashes came from the cache
    st = b.stat()
    os.utime(b, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert sorted(_names(handle)) == ["b.pdf"]
    assert [p.name for p in seen] == ["b.pdf"]
    cache = store.read_json(unimported.cache_path(handle))
    assert cache["version"] == 1 and str(b) in cache["entries"]


def test_skips_kestrel_folders_and_goes_three_deep(handle):
    root = _root(handle)
    for rel in (
        "cache/x.pdf",
        "images/x.png",
        "Maps/x.tif",
        ".git/x.pdf",
        f"drawings/{uuid.uuid4()}/plan.tif",
        f"Survey/{uuid.uuid4()}/thumb.png",
        "a/b/c/d/deep.pdf",
    ):
        _write(root / rel, b"%PDF x")
    _write(root / "a" / "b" / "c" / "ok.pdf", b"%PDF ok")
    _write(root / "drawings" / "T1.pdf", b"%PDF t1")
    _write(root / "top.dxf", b"0\nSECTION\n")
    assert sorted(_names(handle)) == ["T1.pdf", "ok.pdf", "top.dxf"]


def test_photo_folder_images_are_skipped(handle):
    root = _root(handle)
    for i in range(21):
        write_png(root / "Photos" / f"DJI_{i:04}.jpg", 4, 4)
    _write(root / "Photos" / "plan.pdf", b"%PDF p")
    write_png(root / "Site" / "a.png", 4, 4)
    write_png(root / "Site" / "b.png", 4, 4)
    assert sorted(_names(handle)) == ["a.png", "b.png", "plan.pdf"]


def test_xml_is_listed_only_when_it_is_landxml(handle):
    root = _root(handle)
    _write(root / "Drawings" / "survey.xml", b'<?xml version="1.0"?><LandXML version="1.2"></LandXML>')
    _write(root / "Drawings" / "meta.xml", b'<?xml version="1.0"?><rss></rss>')
    files = unimported.scan_unimported(handle)
    assert [(f["name"], f["format"]) for f in files] == [("survey.xml", "landxml")]


def test_answers_at_most_max_files(handle, monkeypatch):
    monkeypatch.setattr(unimported, "MAX_FILES", 2)
    for n in "abc":
        _write(_root(handle) / "Drawings" / f"{n}.pdf", f"%PDF {n}".encode())
    assert _names(handle) == ["a.pdf", "b.pdf"]


def test_the_walk_stops_at_max_entries(handle, monkeypatch):
    monkeypatch.setattr(unimported, "MAX_ENTRIES", 3)
    for n in range(10):
        _write(_root(handle) / f"f{n:02}" / "x.pdf", b"%PDF x")
    assert len(_names(handle)) < 10


def test_a_failed_drawing_does_not_hide_its_file(handle):
    src = _write(_root(handle) / "Drawings" / "f.pdf", b"%PDF f")
    _import(handle, src, status="failed")
    assert _names(handle) == ["f.pdf"]


def test_a_broken_cache_file_is_ignored_and_rewritten(handle):
    _write(_root(handle) / "Drawings" / "a.pdf", b"%PDF a")
    unimported.cache_path(handle).parent.mkdir(parents=True, exist_ok=True)
    unimported.cache_path(handle).write_text("{not json", "utf-8")
    assert _names(handle) == ["a.pdf"]
    assert store.read_json(unimported.cache_path(handle))["version"] == 1
```

- [ ] **Step 2: Run them to see them fail**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_unimported.py -q`
Expected: FAIL, `ImportError: cannot import name 'unimported'`.

- [ ] **Step 3: Write `backend/app/drawings/unimported.py`**

```python
"""Project-folder drawings that were never imported (plant-model spec §8.1; plan
2026-10-03-plant-model-i1 Rulings 6 to 10).

GET /drawings/unimported walks the project folder to depth 3 for drawing files, skipping the folders
Kestrel writes, and leaves out every file whose bytes match an imported drawing. Bounded: at most
MAX_ENTRIES directory entries are read and MAX_FILES files answered; a file is hashed only when its
size equals an imported drawing's size. Hashes, LandXML sniffs and PDF page counts are cached in
<project>/cache/unimported.json, keyed by path and checked against (size, mtime_ns).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from sqlalchemy import select

from app.db.models import Drawing
from app.drawings import store
from app.drawings.detect import FORMATS
from app.surfaces.design.store import ID_RE

EXTS = frozenset({".pdf", ".dxf", ".tif", ".tiff", ".png", ".jpg", ".jpeg", ".landxml", ".xml"})
IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg"})
MANAGED = frozenset(
    {
        "asset_models",
        "backups",
        "cache",
        "datasets",
        "exports",
        "findings",
        "images",
        "labels",
        "maps",
        "models",
        "pointclouds",
        "reports",
        "runs",
        "surfaces",
        "volumes",
    }
)
MAX_DEPTH = 3
MAX_FILES = 500
MAX_ENTRIES = 20_000
PHOTO_FOLDER = 20
SNIFF_BYTES = 4096
CACHE_VERSION = 1
log = logging.getLogger(__name__)


def cache_path(handle) -> Path:
    return Path(handle.folder) / "cache" / "unimported.json"


def _sha256(path: Path) -> str | None:
    try:
        return store.sha256_file(path, progress=lambda _f: None, check_cancelled=lambda: None)
    except OSError:
        return None


def _pdf_pages(path: Path) -> int | None:
    from app.drawings import pdf

    if pdf.unavailable_reason() is not None:
        return None
    try:
        with pdf.open_pdf(path) as doc:
            return len(doc)
    except Exception:  # an unreadable or locked PDF is still listed, without a page count
        return None


def _is_landxml(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return b"landxml" in f.read(SNIFF_BYTES).lower()
    except OSError:
        return False


def _imported(handle) -> tuple[set[str], set[int], set[tuple[str, int]]]:
    with handle.session() as s:
        rows = s.execute(
            select(Drawing.source_sha256, Drawing.source_size, Drawing.source_path).where(
                Drawing.status.in_(("ready", "importing"))
            )
        ).all()
    shas = {sha for sha, _, _ in rows if sha}
    sizes = {size for _, size, _ in rows}
    paths = {(os.path.normcase(path), size) for _, size, path in rows}
    return shas, sizes, paths


def _scannable(name: str, depth: int) -> bool:
    if name.startswith(".") or ID_RE.fullmatch(name):
        return False
    return not (depth == 0 and name.casefold() in MANAGED)


def _candidates(root: Path) -> list[Path]:
    """Drawing-like files, depth-first, at most MAX_ENTRIES directory entries read."""
    out: list[Path] = []
    stack: list[tuple[Path, int]] = [(root, 0)]
    read = 0
    while stack and read < MAX_ENTRIES:
        folder, depth = stack.pop()
        try:
            with os.scandir(folder) as it:
                entries = sorted(it, key=lambda e: e.name.casefold())
        except OSError:
            continue
        read += len(entries)
        files, dirs = [], []
        for e in entries:
            try:
                if e.is_file() and Path(e.name).suffix.lower() in EXTS:
                    files.append(e)
                elif depth < MAX_DEPTH and e.is_dir() and _scannable(e.name, depth):
                    dirs.append(e)
            except OSError:
                continue
        photos = sum(1 for e in files if Path(e.name).suffix.lower() in IMAGE_EXTS) > PHOTO_FOLDER
        out.extend(
            Path(e.path) for e in files if not (photos and Path(e.name).suffix.lower() in IMAGE_EXTS)
        )
        stack.extend((Path(e.path), depth + 1) for e in reversed(dirs))
    return sorted(out, key=lambda p: str(p).casefold())


def _read_cache(handle) -> dict:
    try:
        data = store.read_json(cache_path(handle))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
        return {}
    entries = data.get("entries")
    return entries if isinstance(entries, dict) else {}


def _write_cache(handle, entries: dict) -> None:
    path = cache_path(handle)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        store.write_json(path, {"version": CACHE_VERSION, "entries": entries})
    except OSError:
        log.warning("could not write the unimported-drawings cache in project %s", handle.id)


def scan_unimported(handle) -> list[dict]:
    shas, sizes, paths = _imported(handle)
    old = _read_cache(handle)
    new: dict[str, dict] = {}
    out: list[dict] = []
    for path in _candidates(Path(handle.folder)):
        if len(out) >= MAX_FILES:
            break
        try:
            st = path.stat()
        except OSError:
            continue
        key, ext = str(path), path.suffix.lower()
        if (os.path.normcase(key), st.st_size) in paths:
            continue
        entry = old.get(key)
        if not isinstance(entry, dict) or (entry.get("size"), entry.get("mtime_ns")) != (
            st.st_size,
            st.st_mtime_ns,
        ):
            entry = {"size": st.st_size, "mtime_ns": st.st_mtime_ns}
        new[key] = entry
        if ext == ".xml":
            if "landxml" not in entry:
                entry["landxml"] = _is_landxml(path)
            if not entry["landxml"]:
                continue
        if st.st_size in sizes:
            if entry.get("sha256") is None:
                entry["sha256"] = _sha256(path)
            if entry["sha256"] in shas:
                continue
        if ext == ".pdf" and "pages" not in entry:
            entry["pages"] = _pdf_pages(path)
        out.append(
            {
                "path": key,
                "name": path.name,
                "format": FORMATS[ext],
                "size": st.st_size,
                "pages": entry.get("pages") if ext == ".pdf" else None,
            }
        )
    _write_cache(handle, new)
    return out
```

Two details to keep:
- In `test_the_hash_is_cached_until_the_file_changes`, `a.pdf` itself is hashed too. Its `(path, size)` does not equal the row's (`C:/elsewhere/a.pdf`), its size matches, and its sha equals the row's, so it is hidden.
- `store.read_json` raises `json.JSONDecodeError` (a `ValueError`) on a broken file; `_read_cache` catches it.

- [ ] **Step 4: Run them to see them pass**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_unimported.py -q`
Expected: `13 passed`.

- [ ] **Step 5: Commit**

```
git add backend/app/drawings/unimported.py backend/tests/test_drawings_unimported.py
git commit -m "feat(drawings): bounded scan for project-folder drawings never imported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `listUnimportedDrawings` route

**Files:**
- Modify: `backend/app/drawings/router.py` (route above `get_drawing`, next to `create_drawing_pages`)
- Modify: `backend/app/asset_models/stubs_plant.py` (delete the `listUnimportedDrawings` stub line)
- Test: `backend/tests/test_drawings_unimported.py` (append)

**Interfaces:**
- Consumes: `unimported.scan_unimported` (Task 4); `UnimportedDrawingList`, `UnimportedDrawingOut` (Task 1).
- Produces: `GET /api/v1/projects/{projectId}/drawings/unimported` → `{files: [...]}`.

- [ ] **Step 1: Append the failing API test**

```python
def test_the_route_answers_and_is_not_read_as_a_drawing_id(client, project_id, handle):
    src = write_pdf(_root(handle) / "Drawings" / "T0006.pdf", [(200.0, 200.0)] * 2)
    r = client.get(f"/api/v1/projects/{project_id}/drawings/unimported")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "files": [
            {"path": str(src), "name": "T0006.pdf", "format": "pdf", "size": src.stat().st_size, "pages": 2}
        ]
    }
```

- [ ] **Step 2: Run it to see it fail**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_unimported.py -q -k route`
Expected: FAIL with 501 (F0's stub) or 404 (read as a `drawingId`).

- [ ] **Step 3: Add the route**

In `backend/app/drawings/router.py`:
- add `unimported` to `from app.drawings import ...`;
- add `UnimportedDrawingList, UnimportedDrawingOut` to the schemas import;
- insert directly above `@router.get("/drawings/{drawingId}", response_model=DrawingOut)`:

```python
@router.get("/drawings/unimported", response_model=UnimportedDrawingList)
def list_unimported_drawings(handle: ProjectHandle = Depends(get_project)) -> UnimportedDrawingList:
    """Drawing files in the project folder (depth 3) not matched by sha256 to an imported drawing
    (plant-model spec §8.1). Bounded: <= 20 000 entries read, <= 500 files, hashing only on a size
    match, cached in cache/unimported.json."""
    return UnimportedDrawingList(
        files=[UnimportedDrawingOut(**f) for f in unimported.scan_unimported(handle)]
    )
```

Then delete the `listUnimportedDrawings` entry in `backend/app/asset_models/stubs_plant.py`.

- [ ] **Step 4: Run the tests**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_drawings_unimported.py tests/test_contract.py -q`
Expected: all pass. If the stub list is now empty and F0's `stubs_plant.py` shape needs a non-empty list, keep the structure F0 wrote and leave the list empty.

- [ ] **Step 5: Commit**

```
git add backend/app/drawings/router.py backend/app/asset_models/stubs_plant.py backend/tests/test_drawings_unimported.py
git commit -m "feat(drawings): GET /drawings/unimported lists project-folder drawings not imported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `list_sources` groups drawing pages by source file

**Files:**
- Modify: `backend/app/asset_models/agent/runner.py` (`_describe_sources`, drawing branch)
- Modify: `backend/app/asset_models/agent/tools.py` (`group_drawing_sources`, `ListSources`)
- Test: `backend/tests/test_asset_model_list_sources.py` (new), `backend/tests/test_asset_model_run_job.py` (one test)

**Interfaces:**
- Consumes: `RunContext`, `run_tool` (M1 tools).
- Produces:
  - `group_drawing_sources(sources) -> [{"file", "facts", "pages": [{"id", "page", "label"}]}]`;
  - `_describe_sources` drawing entries gain `file` (base name), `sha256` and `page`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_list_sources.py
"""list_sources groups a PDF's pages by source file (index "Backend: intake"; I1 Ruling 13)."""

import json
import uuid

from app.asset_models.agent.tools import RunContext, group_drawing_sources, run_tool
from app.asset_models.spec import AssetSpec

SOURCES = [
    {"type": "drawing", "id": "a2", "label": "T5 · p2", "facts": "view: yes", "file": "T5.pdf", "sha256": "s1", "page": 2},
    {"type": "drawing", "id": "a1", "label": "T5 · p1", "facts": "view: yes", "file": "T5.pdf", "sha256": "s1", "page": 1},
    {"type": "drawing", "id": "b1", "label": "GA", "facts": "view: no, text: yes", "file": "GA.dxf", "sha256": "s2", "page": None},
    {"type": "drawing", "id": "gone", "label": "gone", "facts": "missing"},
    {"type": "point_cloud", "id": "c1", "label": "Scan", "facts": "12 points"},
]


def test_pages_of_one_file_group_by_sha_in_page_order():
    groups = group_drawing_sources(SOURCES)
    assert [g["file"] for g in groups] == ["T5.pdf", "GA.dxf", "gone"]
    assert groups[0] == {
        "file": "T5.pdf",
        "facts": "view: yes",
        "pages": [{"id": "a1", "page": 1, "label": "T5 · p1"}, {"id": "a2", "page": 2, "label": "T5 · p2"}],
    }
    assert groups[2]["pages"] == [{"id": "gone", "page": None, "label": "gone"}]


def test_the_tool_lists_one_line_per_file_then_the_other_sources(handle, tmp_path):
    ctx = RunContext(
        handle=handle,
        model_id=str(uuid.uuid4()),
        run_id=str(uuid.uuid4()),
        sources=SOURCES,
        spec=AssetSpec(),
        samples={},
    )
    ctx.run_dir = tmp_path
    out = run_tool(ctx, "list_sources", {})
    lines = out.text.splitlines()
    assert len(lines) == 4
    first = json.loads(lines[0].removeprefix("drawing file "))
    assert first["file"] == "T5.pdf" and [p["id"] for p in first["pages"]] == ["a1", "a2"]
    assert lines[3] == "point_cloud c1: Scan 12 points"
    assert out.summary == "Listed 5 sources"
    assert "\\" not in out.text and ":/" not in out.text
```

Append to `backend/tests/test_asset_model_run_job.py`, after `test_sources_get_labels_and_facts`:

```python
def test_drawing_sources_carry_file_name_sha_and_page(handle, app, seeded):
    from app.db.models import Drawing

    with handle.session() as s:
        d = Drawing(
            name="T5 · p3",
            format="pdf",
            source_path="E:\\LNG\\Drawings\\T5.pdf",
            source_size=1,
            source_sha256="abc",
            page=3,
        )
        s.add(d)
        s.flush()
        did = d.id
    out = R._describe_sources(Ctx(handle, app.state.jobs, {}), [{"type": "drawing", "id": did}])
    assert (out[0]["file"], out[0]["sha256"], out[0]["page"]) == ("T5.pdf", "abc", 3)
```

- [ ] **Step 2: Run them to see them fail**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_model_list_sources.py tests/test_asset_model_run_job.py -q -k "sources"`
Expected: FAIL, `ImportError: cannot import name 'group_drawing_sources'`, and `KeyError: 'file'`.

- [ ] **Step 3: Implement**

In `backend/app/asset_models/agent/runner.py`, `_describe_sources`, replace the drawing branch:

```python
            elif src["type"] == "drawing":
                out.append(
                    {
                        **src,
                        "label": row.name,
                        "facts": _DRAWING_FACTS.get(row.format, ""),
                        "file": str(row.source_path).replace("\\", "/").rsplit("/", 1)[-1],
                        "sha256": row.source_sha256,
                        "page": row.page,
                    }
                )
```

In `backend/app/asset_models/agent/tools.py`, above `class ListSources`, add:

```python
def group_drawing_sources(sources: list[dict]) -> list[dict]:
    """Drawing sources grouped by source file (`sha256`, else the drawing's own id), pages in page
    order, files in first-seen order: [{file, facts, pages: [{id, page, label}]}]. Names only."""
    groups: dict[str, dict] = {}
    for s in sources:
        if s["type"] != "drawing":
            continue
        g = groups.setdefault(
            s.get("sha256") or s["id"],
            {"file": s.get("file") or s.get("label") or s["id"], "facts": s.get("facts", ""), "pages": []},
        )
        g["pages"].append({"id": s["id"], "page": s.get("page"), "label": s.get("label", "")})
    for g in groups.values():
        g["pages"].sort(key=lambda p: (p["page"] is None, p["page"] or 0))
    return list(groups.values())
```

Replace `ListSources`:

```python
class ListSources:
    name, Args = "list_sources", NoArgs
    description = (
        "List the drawings, point clouds and photos chosen for this run, with ids and basic facts. "
        "Drawings are grouped by source file; each page of a PDF is its own drawing id."
    )

    def run(self, ctx, a):
        lines = [
            "drawing file " + json.dumps(g, separators=(",", ":"), ensure_ascii=False)
            for g in group_drawing_sources(ctx.sources)
        ]
        lines += [
            f"{s['type']} {s['id']}: {s.get('label', '')} {s.get('facts', '')}".strip()
            for s in ctx.sources
            if s["type"] != "drawing"
        ]
        return ToolOut("\n".join(lines) or "No sources.", f"Listed {len(ctx.sources)} sources")
```

- [ ] **Step 4: Run them to see them pass**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_model_list_sources.py tests/test_asset_model_run_job.py tests/test_asset_model_agent_tools.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/agent/runner.py backend/app/asset_models/agent/tools.py backend/tests/test_asset_model_list_sources.py backend/tests/test_asset_model_run_job.py
git commit -m "feat(asset-models): list_sources groups drawing pages by source file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend API and the all-pages request

**Files:**
- Modify: `frontend/src/api/drawings.ts`
- Modify: `frontend/src/mapws/drawings/drawingImport.ts`
- Test: `frontend/src/mapws/drawings/drawingImport.test.ts`

**Interfaces:**
- Consumes: the generated client from F0 (`components["schemas"]["DrawingPagesCreate" | "DrawingPagesWithJob" | "UnimportedDrawing"]`, the paths `/api/v1/projects/{projectId}/drawings/pages` and `/drawings/unimported`).
- Produces: `createDrawingPages`, `listUnimportedDrawings`, `DrawingPagesCreate`, `DrawingPagesWithJob`, `UnimportedDrawing`, `toDrawingPagesRequest`, `AutoImport`, `autoImportRequest`. `initialDrawingForm` now selects every PDF page. `toDrawingRequests` and `withPageSuffix` are removed.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/mapws/drawings/drawingImport.test.ts`:
- replace the test "builds one request per selected page, and one per page when importing the whole file" with the block below;
- update every expectation of `initialDrawingForm(pdfInspection).pages` from `[1]` to `[1, 2]` (search for `pages:` in the `initialDrawingForm and placement` block);
- drop `toDrawingRequests` from the import list, and add `toDrawingPagesRequest` and `autoImportRequest`.

```ts
const threePages: DrawingInspection = {
  ...pdfInspection,
  page_count: 3,
  pages: [...pdfInspection.pages, { page: 3, width_pt: 2384, height_pt: 1684 }],
};

describe("toDrawingPagesRequest (plant-model spec §8.1: all pages, one job)", () => {
  it("selects every page of a multi-page PDF by default and sends 'all'", () => {
    const f = initialDrawingForm(threePages);
    expect(f.pages).toEqual([1, 2, 3]);
    expect(toDrawingPagesRequest(threePages, f)).toEqual({
      ok: true,
      body: {
        inspection_id: threePages.id,
        name: "foundation-plan",
        pages: "all",
        dpi: 150,
        placement: { method: "none" },
      },
    });
  });

  it("sends the chosen pages in order and a custom name without its page suffix", () => {
    expect(
      toDrawingPagesRequest(threePages, {
        ...initialDrawingForm(threePages),
        pages: [3, 1, 3],
        name: " Plot plan · p3 ",
      }),
    ).toMatchObject({ ok: true, body: { name: "Plot plan", pages: [1, 3] } });
  });

  it("refuses no pages, a page out of range and an empty name", () => {
    const f = initialDrawingForm(threePages);
    expect(toDrawingPagesRequest(threePages, { ...f, pages: [] })).toEqual({
      ok: false,
      error: "Choose at least one page.",
    });
    expect(toDrawingPagesRequest(threePages, { ...f, pages: [1, 4] })).toEqual({
      ok: false,
      error: "Choose a page between 1 and 3.",
    });
    expect(toDrawingPagesRequest(threePages, { ...f, name: "  " })).toEqual({
      ok: false,
      error: "Give the drawing a name.",
    });
  });
});

describe("autoImportRequest (setup and Import and include)", () => {
  it("imports every page of a multi-page PDF", () => {
    expect(autoImportRequest(pdfInspection)).toMatchObject({ kind: "pages", body: { pages: "all" } });
  });
  it("imports a one-page PDF and a DXF as one drawing", () => {
    expect(autoImportRequest(bigPdfInspection)).toMatchObject({ kind: "one", body: { page: 1 } });
    expect(autoImportRequest(dxfInspection)).toMatchObject({ kind: "one", body: { layers: ["WALLS", "TEXT"] } });
  });
  it("names what the operator must choose", () => {
    expect(autoImportRequest(pngWorldFileInspection)).toMatchObject({
      kind: "error",
      error: expect.stringContaining("A world file has no CRS"),
    });
  });
});
```

Import `DrawingInspection` as a type from `@/api/drawings`, and the fixtures from `./testFixtures` (`pdfInspection`, `bigPdfInspection`, `dxfInspection`, `pngWorldFileInspection` already exist there).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/mapws/drawings/drawingImport.test.ts`
Expected: FAIL, `toDrawingPagesRequest is not a function` (or a TS import error).

- [ ] **Step 3: Add the API functions to `frontend/src/api/drawings.ts`**

After `export type DrawingVectorTile = ...`:

```ts
export type DrawingPagesCreate = S["DrawingPagesCreate"];
export type DrawingPagesWithJob = S["DrawingPagesWithJob"];
export type UnimportedDrawing = S["UnimportedDrawing"];
```

After `createDrawing`:

```ts
/** Every chosen page of a PDF, one `drawing_import` job (plant-model spec §8.1). */
export function createDrawingPages(
  api: ApiClient,
  projectId: string,
  body: DrawingPagesCreate,
): Promise<DrawingPagesWithJob> {
  return unwrap(api.POST(`${P}/drawings/pages`, { params: { path: { projectId } }, body }));
}

/** Drawing files in the project folder that were never imported (≤ 500). */
export async function listUnimportedDrawings(api: ApiClient, projectId: string): Promise<UnimportedDrawing[]> {
  return (await unwrap(api.GET(`${P}/drawings/unimported`, { params: { path: { projectId } } }))).files;
}
```

- [ ] **Step 4: Change `frontend/src/mapws/drawings/drawingImport.ts`**

1. Import types: `import type { DrawingCreate, DrawingFormat, DrawingInspection, DrawingPage, DrawingPagesCreate } from "@/api/drawings";`
2. In `initialDrawingForm`, replace `pages: [1],` with:
   ```ts
       pages: family === "pdf" ? allPdfPages(insp) : [1],
   ```
3. Delete `withPageSuffix` and `toDrawingRequests` (and their doc comments). Keep `PAGE_SUFFIX`.
4. Append:

```ts
export type DrawingPagesRequest = { ok: true; body: DrawingPagesCreate } | { ok: false; error: string };

/**
 * One request for several PDF pages (createDrawingPages): `"all"` when every page is chosen, else
 * the chosen pages in order. The server names each drawing `<name> · p<k>`, so a custom name loses
 * any page suffix of its own; the DPI is lowered per page on the server.
 */
export function toDrawingPagesRequest(insp: DrawingInspection, f: DrawingForm): DrawingPagesRequest {
  const count = insp.page_count ?? insp.pages.length;
  const pages = chosenPages(f.pages);
  if (pages.length === 0) return { ok: false, error: "Choose at least one page." };
  if (pages.some((p) => p < 1 || p > count))
    return { ok: false, error: `Choose a page between 1 and ${count}.` };
  const name = (f.name ?? stem(insp.path)).trim().replace(PAGE_SUFFIX, "").trim();
  if (!name) return { ok: false, error: "Give the drawing a name." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: "Keep the name under 200 characters." };
  return {
    ok: true,
    body: {
      inspection_id: insp.id,
      name,
      pages: pages.length === count ? "all" : pages,
      dpi: f.dpi,
      placement: { method: "none" },
    },
  };
}

export type AutoImport =
  | { kind: "pages"; body: DrawingPagesCreate }
  | { kind: "one"; body: DrawingCreate }
  | { kind: "error"; error: string };

/** What setup and "Import and include" send with no one at the dialog: every page of a PDF, else the dialog's defaults. */
export function autoImportRequest(insp: DrawingInspection): AutoImport {
  const form = initialDrawingForm(insp);
  if (familyOf(insp.format) === "pdf" && form.pages.length > 1) {
    const r = toDrawingPagesRequest(insp, form);
    return r.ok ? { kind: "pages", body: r.body } : { kind: "error", error: r.error };
  }
  const r = toDrawingRequest(insp, form);
  return r.ok ? { kind: "one", body: r.body } : { kind: "error", error: r.error };
}
```

`DrawingPagesCreate` has no `page`/`layers`, and a PDF's placement is always `none` (only DXF/LandXML take a CRS, only rasters take embedded). So `placement: { method: "none" }` is the only valid value.

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm -C frontend exec vitest run src/mapws/drawings/drawingImport.test.ts`
Expected: PASS. Then run `pnpm -C frontend exec tsc -b --noEmit`. It reports `ImportDrawingDialog.tsx` still importing `toDrawingRequests`; Task 8 fixes that. Note it and move on.

- [ ] **Step 6: Commit**

```
git add frontend/src/api/drawings.ts frontend/src/mapws/drawings/drawingImport.ts frontend/src/mapws/drawings/drawingImport.test.ts
git commit -m "feat(frontend): all-pages drawing request and the unimported-drawings client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Import dialog sends one all-pages request; setup imports all pages

**Files:**
- Modify: `frontend/src/mapws/drawings/ImportDrawingDialog.tsx`
- Modify: `frontend/src/mapws/drawings/PdfPagePicker.tsx` (the "All" button label)
- Modify: `frontend/src/setup/drawingSetup.ts`
- Test: `frontend/src/mapws/drawings/ImportDrawingDialog.test.tsx`, `frontend/src/setup/drawingSetup.test.ts`

**Interfaces:**
- Consumes: `createDrawingPages`, `toDrawingPagesRequest`, `autoImportRequest` (Task 7).
- Produces: `settledInspection(api, projectId, inspectionId)` exported from `frontend/src/setup/drawingSetup.ts` (Task 10 uses it). `autoDrawingRequest` is removed.

- [ ] **Step 0: Load the design context**

Invoke the skills `impeccable` and `emil-design-eng`, and read `DESIGN.md` and `frontend/src/ui/index.ts`. The change only reuses existing primitives (`Button`, `Alert`).

- [ ] **Step 1: Write the failing dialog tests**

In `frontend/src/mapws/drawings/ImportDrawingDialog.test.tsx`:
- add to `routes()` (before the `/\/drawings$/` route):
  ```ts
      {
        method: "POST",
        path: /\/drawings\/pages$/,
        status: 202,
        body: {
          drawings: [pdfDrawing, { ...pdfDrawing, id: "d-p1", page: 1, name: "foundation-plan · p1" }],
          job: drawingJob(BUILD_JOB, "queued"),
        },
      },
  ```
- in "inspects a PDF, picks page 2 at 300 dpi and queues the build", delete the line `fireEvent.click(page2);`. All pages start selected, so clicking Page 1 alone leaves page 2. Keep every assertion.
- replace the tests "imports every page of a multi-page PDF from one button" and "imports every page that was clicked, in one Start import" with:

```ts
  it("imports every page by default in one request", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient(routes(pdfInspection));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    await read("D:\\plans\\foundation-plan.pdf");
    expect(screen.getByRole("checkbox", { name: "Page 1" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Page 2" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "Import all pages" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(pdfDrawing));
    const sent = posts(requests).slice(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/\/drawings\/pages$/);
    expect(sent[0].body).toEqual({
      inspection_id: INSPECTION_ID,
      name: "foundation-plan",
      pages: "all",
      dpi: 150,
      placement: { method: "none" },
    });
  });

  it("sends the pages still ticked, and All pages ticks them again", async () => {
    const three = {
      ...pdfInspection,
      page_count: 3,
      pages: [...pdfInspection.pages, { page: 3, width_pt: 2384, height_pt: 1684 }],
    };
    const { api, requests } = fakeClient(routes(three));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await read("D:\\plans\\foundation-plan.pdf");
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    fireEvent.click(screen.getByRole("button", { name: "All pages" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Page 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(posts(requests)).toHaveLength(2));
    expect(posts(requests)[1].body).toMatchObject({ pages: [1, 3] });
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    const { api } = fakeClient(
      routes(pdfInspection, [
        {
          method: "POST",
          path: /\/drawings\/pages$/,
          status: 409,
          body: { error: { code: "job_running", message: "a drawing is being imported from this file", details: {} } },
        },
      ]),
    );
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await read("D:\\plans\\foundation-plan.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(await screen.findByText("a drawing is being imported from this file")).toBeInTheDocument();
  });
```

If `RecordedRequest` has no `url` field, assert on the path field it does have; see `frontend/src/test/fixtures.ts`.

- [ ] **Step 2: Write the failing setup test**

In `frontend/src/setup/drawingSetup.test.ts`:
- add a route to `serve()`:
  ```ts
      {
        method: "POST",
        path: /\/drawings\/pages$/,
        status: 202,
        body: { drawings: [{ id: "p1" }, { id: "p2" }], job: drawingJob(BUILD_JOB, "queued") },
      },
  ```
- replace "leaves a multi-page PDF to the operator and builds nothing" with:

```ts
  it("imports every page of a multi-page PDF in one job", async () => {
    const { api, requests } = serve(pdfInspection);
    await expect(startDrawing(api, PROJECT_ID, pdfInspection.path)).resolves.toEqual({
      state: "started",
      jobId: BUILD_JOB,
    });
    expect(short(requests.at(-1)!.url)).toBe("/drawings/pages");
    expect(requests.at(-1)?.body).toEqual({
      inspection_id: INSPECTION_ID,
      name: "foundation-plan",
      pages: "all",
      dpi: 150,
      placement: { method: "none" },
    });
  });
```

- [ ] **Step 3: Run both to see them fail**

Run: `pnpm -C frontend exec vitest run src/mapws/drawings/ImportDrawingDialog.test.tsx src/setup/drawingSetup.test.ts`
Expected: FAIL (the dialog still sends `POST /drawings` per page; setup answers `needs_choice`).

- [ ] **Step 4: Change `ImportDrawingDialog.tsx`**

1. Imports: replace `createDrawing,` with `createDrawing, createDrawingPages,`. From `./drawingImport`, import `drawingNameField, familyOf, initialDrawingForm, toDrawingPagesRequest, toDrawingRequest, type DrawingForm` (remove `allPdfPages`, `toDrawingRequests`).
2. State: `const [busy, setBusy] = useState<"read" | "import" | null>(null);`. Delete `importedPages` and `lastStarted` and the two lines in `readFile` that reset them.
3. Replace `startImport` and `submit`:

```tsx
  async function startImport() {
    if (inFlight.current || !inspection || inspection.state !== "ready" || !form) return;
    const pages = [...new Set(form.pages)].sort((a, b) => a - b);
    const pdf = familyOf(inspection.format) === "pdf";
    inFlight.current = true;
    setBusy("import");
    setError(null);
    try {
      if (pdf && pages.length > 1) {
        const built = toDrawingPagesRequest(inspection, form);
        if (!built.ok) return setError(built.error);
        const res = await createDrawingPages(api, projectId, built.body);
        useJobsStore.getState().upsert(res.job);
        onStarted(res.drawings[0]);
      } else {
        const built = toDrawingRequest(inspection, pdf ? { ...form, page: pages[0] ?? form.page } : form);
        if (!built.ok) return setError(built.error);
        const res = await createDrawing(api, projectId, built.body);
        useJobsStore.getState().upsert(res.job);
        onStarted(res.drawing);
      }
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void startImport();
  }

  const importing = busy === "import";
```

4. In the footer, delete the whole `{multiPdf && ready && (<Button ...>Import all pages</Button>)}` block. Keep the Start import button as it is.

- [ ] **Step 5: Rename the picker's All button**

In `frontend/src/mapws/drawings/PdfPagePicker.tsx`, change the first ghost button's text from `All` to `All pages`. Run `Select-String -Path frontend/src,frontend/e2e -Pattern '"All"' -SimpleMatch -Recurse`, and update any test that clicks a button named exactly "All" in the picker.

- [ ] **Step 6: Change `frontend/src/setup/drawingSetup.ts`**

1. Imports: replace the `drawingImport` import with `import { autoImportRequest } from "@/mapws/drawings/drawingImport";`. Add `createDrawingPages` to the `@/api/drawings` import. Drop `type DrawingRequest`, `familyOf`, `initialDrawingForm` and `toDrawingRequest` if they are now unused.
2. Delete `autoDrawingRequest`.
3. Rename `settled` to an exported `settledInspection` (same body), with this doc comment: `/** Polls an inspection (one small JSON read per drawingWait.intervalMs) until it is read or drawingWait.maxMs passes. */`
4. Replace the tail of `startDrawing` from `const request = autoDrawingRequest(insp);`:

```ts
  const request = autoImportRequest(insp);
  if (request.kind === "error") return { state: "needs_choice", error: request.error };
  const built =
    request.kind === "pages"
      ? await createDrawingPages(api, projectId, request.body)
      : await createDrawing(api, projectId, request.body);
  useJobsStore.getState().upsert(built.job);
  return { state: "started", jobId: built.job.id };
```

and `const insp = await settledInspection(api, projectId, inspection.id);`.

- [ ] **Step 7: Run the tests and the type check**

Run: `pnpm -C frontend exec vitest run src/mapws/drawings src/setup src/overview/SetupNotice.test.tsx`
Expected: PASS.
Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```
git add frontend/src/mapws/drawings/ImportDrawingDialog.tsx frontend/src/mapws/drawings/ImportDrawingDialog.test.tsx frontend/src/mapws/drawings/PdfPagePicker.tsx frontend/src/setup/drawingSetup.ts frontend/src/setup/drawingSetup.test.ts
git commit -m "feat(frontend): import every PDF page by default in one request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Add any other test file Step 5 changed.)

---

### Task 9: Build dialog picks whole drawing files

**Files:**
- Create: `frontend/src/assetmodels/run/drawingFiles.ts`, `frontend/src/assetmodels/run/drawingFiles.test.ts`
- Create: `frontend/src/assetmodels/run/SourceRows.tsx` (`GroupHead`, `SourceRow` moved out of `BuildDialog.tsx`, `SourceRow` gains `meta`)
- Create: `frontend/src/assetmodels/run/DrawingSources.tsx` (the file list; Task 10 adds the not-imported list)
- Modify: `frontend/src/assetmodels/run/sources.ts` (`useProjectDrawings`)
- Modify: `frontend/src/assetmodels/run/BuildDialog.tsx`
- Test: `frontend/src/assetmodels/run/BuildDialog.test.tsx`, `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx`

**Interfaces:**
- Consumes: `listDrawings` (existing), `Drawing`, `useChangesStore.mapWorkspaceRevision`.
- Produces: `groupDrawingFiles`, `DrawingFile`, `useProjectDrawings(projectId) -> { items: Drawing[] | null; error: string | null; reload(): void; add(ds: Drawing[]): void }`, `DrawingSources` props (below).

- [ ] **Step 0: Load the design context**

Invoke `impeccable` and `emil-design-eng`; read `DESIGN.md` and `frontend/src/ui/index.ts`.

- [ ] **Step 1: Write the failing grouping test**

```ts
// frontend/src/assetmodels/run/drawingFiles.test.ts
import { describe, expect, it } from "vitest";
import type { Drawing } from "@/api/drawings";
import { pdfDrawing } from "@/mapws/drawings/testFixtures";
import { groupDrawingFiles } from "./drawingFiles";

const d = (id: string, name: string, source_path: string, page: number | null, status: Drawing["status"] = "ready"): Drawing => ({
  ...pdfDrawing,
  id,
  name,
  source_path,
  page,
  status,
});

describe("groupDrawingFiles", () => {
  it("groups a PDF's pages by source file, pages in order, ready pages as refs", () => {
    const files = groupDrawingFiles([
      d("p2", "T5 · p2", "E:\\LNG\\T5.pdf", 2),
      d("ga", "GA drawing", "D:/plans/ga.dxf", null),
      d("p1", "T5 · p1", "e:/lng/t5.pdf", 1),
      d("p3", "T5 · p3", "E:\\LNG\\T5.pdf", 3, "failed"),
    ]);
    expect(files.map((f) => [f.label, f.meta, f.status])).toEqual([
      ["GA drawing", null, "ready"],
      ["T5.pdf", "3 pages · 1 failed", "ready"],
    ]);
    expect(files[1].drawings.map((x) => x.id)).toEqual(["p1", "p2", "p3"]);
    expect(files[1].refs).toEqual([
      { type: "drawing", id: "p1" },
      { type: "drawing", id: "p2" },
    ]);
  });

  it("a file with a page still importing is importing; one with every page failed is failed", () => {
    const files = groupDrawingFiles([
      d("a1", "A · p1", "C:\\a.pdf", 1),
      d("a2", "A · p2", "C:\\a.pdf", 2, "importing"),
      d("b1", "B", "C:\\b.png", null, "failed"),
    ]);
    expect(files.map((f) => f.status)).toEqual(["importing", "failed"]);
  });
});
```

The third drawing's path differs only in case and slashes, so it tests case-insensitive grouping.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/run/drawingFiles.test.ts`
Expected: FAIL, cannot resolve `./drawingFiles`.

- [ ] **Step 3: Write `frontend/src/assetmodels/run/drawingFiles.ts`**

```ts
import type { AssetSourceRef } from "@contract/client";
import type { Drawing } from "@/api/drawings";

export type FileStatus = "ready" | "importing" | "failed";

/** One source file and its drawings (a PDF imports one drawing per page; plan I1 Ruling 11). */
export interface DrawingFile {
  /** The normalised source path (Windows paths compare case-insensitively). */
  key: string;
  /** The drawing's own name for a one-drawing file; the file name for several pages. */
  label: string;
  /** "29 pages", "29 pages · 2 failed", or null for one drawing. */
  meta: string | null;
  /** Page order. */
  drawings: Drawing[];
  /** What a tick sends: every ready page. */
  refs: AssetSourceRef[];
  status: FileStatus;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const normal = (path: string) => path.replace(/\//g, "\\").toLowerCase();

export function groupDrawingFiles(drawings: readonly Drawing[]): DrawingFile[] {
  const byKey = new Map<string, Drawing[]>();
  for (const d of drawings) {
    const key = normal(d.source_path);
    byKey.set(key, [...(byKey.get(key) ?? []), d]);
  }
  const files: DrawingFile[] = [];
  for (const [key, list] of byKey) {
    const pages = [...list].sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.name.localeCompare(b.name));
    const ready = pages.filter((d) => d.status === "ready");
    const failed = pages.filter((d) => d.status === "failed").length;
    const status: FileStatus = pages.some((d) => d.status === "importing")
      ? "importing"
      : ready.length > 0
        ? "ready"
        : "failed";
    const one = pages.length === 1;
    files.push({
      key,
      label: one ? pages[0].name : fileName(pages[0].source_path),
      meta: one ? null : `${pages.length} pages${failed ? ` · ${failed} failed` : ""}`,
      drawings: pages,
      refs: ready.map((d) => ({ type: "drawing", id: d.id })),
      status,
    });
  }
  return files.sort((a, b) => a.label.localeCompare(b.label));
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/run/drawingFiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing dialog tests**

In `frontend/src/assetmodels/run/BuildDialog.test.tsx`:
- import `pdfDrawing` from `@/mapws/drawings/testFixtures`;
- replace the `drawings` constant and the drawings branch of `setup()`:

```ts
const drawing = (id: string, name: string, source_path: string, page: number | null, status: string) => ({
  ...pdfDrawing,
  id,
  name,
  source_path,
  page,
  status,
});
const drawingRows = {
  items: [
    drawing("d1", "GA drawing", "D:\\plans\\ga.pdf", 1, "ready"),
    drawing("d2", "Importing", "D:\\plans\\other.pdf", 1, "importing"),
  ],
};

function setup(extra: unknown[] = []) {
  return fakeClient([
    ...extra,
    { method: "GET", path: /\/providers$/, body: providers },
    { method: "GET", path: /\/drawings$/, body: drawingRows },
    { method: "GET", path: /\/drawings\/unimported$/, body: { files: [] } },
    {
      method: "GET",
      path: /\/data$/,
      body: (req: RecordedRequest) =>
        req.url.includes("type=point_cloud") ? clouds : { items: [], next_cursor: null },
    },
    { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
  ] as never);
}
```

Every existing test keeps its assertions. "GA drawing" and "Importing" are one-drawing files, so they are labelled by drawing name.

Add:

```ts
  it("shows a PDF's pages as one file and sends every page", async () => {
    const pages = {
      items: [
        drawing("p2", "T0005 · p2", "E:\\LNG\\T0005.pdf", 2, "ready"),
        drawing("p1", "T0005 · p1", "E:\\LNG\\T0005.pdf", 1, "ready"),
      ],
    };
    const { api, requests } = setup([
      { method: "GET", path: /\/drawings$/, body: pages },
      POSTED,
    ]);
    open(api);
    const file = await screen.findByRole("checkbox", { name: /T0005\.pdf/ });
    expect(screen.getByText("2 pages")).toBeInTheDocument();
    fireEvent.click(file);
    await waitFor(() => expect(screen.getByRole("button", { name: /start build/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect((requests.find((r) => r.method === "POST")!.body as { sources: unknown }).sources).toEqual([
      { type: "drawing", id: "p1" },
      { type: "drawing", id: "p2" },
    ]);
  });

  it("a refine that used one page shows the file partly chosen; unticking drops every page", async () => {
    const pages = {
      items: [
        drawing("p1", "T0005 · p1", "E:\\LNG\\T0005.pdf", 1, "ready"),
        drawing("p2", "T0005 · p2", "E:\\LNG\\T0005.pdf", 2, "ready"),
      ],
    };
    const { api } = setup([{ method: "GET", path: /\/drawings$/, body: pages }]);
    open(api, { initial: { sources: [{ type: "drawing", id: "p2" }] } });
    const file = await screen.findByRole("checkbox", { name: /T0005\.pdf/ });
    expect(file).toBeChecked();
    expect(screen.getByText("1 of 2 pages")).toBeInTheDocument();
    fireEvent.click(file);
    expect(file).not.toBeChecked();
  });
```

`POSTED` and `open(api, opts?)` are the file's existing helpers. Check their names near the "drops a seeded source" test and use them as they are.

In `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx`, in each of the three route lists that serve `path: /\/data$/` drawings to the build dialog, add before it:

```ts
          {
            method: "GET",
            path: /\/drawings$/,
            body: {
              items: [
                {
                  ...pdfDrawing,
                  id: "d1",
                  name: "GA drawing",
                  source_path: "D:\\plans\\ga.pdf",
                  page: 1,
                  status: "ready",
                },
              ],
            },
          },
          { method: "GET", path: /\/drawings\/unimported$/, body: { files: [] } },
```

and import `pdfDrawing` from `@/mapws/drawings/testFixtures`.

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/run/BuildDialog.test.tsx`
Expected: the two new tests FAIL (no file row). The old ones may fail too, because drawings no longer come from `/data`.

- [ ] **Step 7: Move the row parts into `SourceRows.tsx`**

Create `frontend/src/assetmodels/run/SourceRows.tsx` with `STATUS_TEXT`, `GroupHead` and `SourceRow`, cut from `BuildDialog.tsx` unchanged, plus a `meta` prop on `SourceRow`:

```tsx
import type { ReactNode } from "react";
import type { DataItem } from "@/api/dataItems";
import { Checkbox, Pill } from "@/ui";

type RowStatus = DataItem["status"];

const STATUS_TEXT: Record<RowStatus, string> = {
  ready: "Ready",
  importing: "Importing",
  failed: "Failed",
};

export function GroupHead({ title, chosen, total }: { title: string; chosen: number; total: number | null }) {
  return (
    <legend className="mb-1.5 flex w-full items-baseline gap-2 text-xs font-medium text-muted">
      <span className="text-ink">{title}</span>
      <span className="font-mono text-2xs tabular-nums text-dim">
        {chosen > 0 ? `${chosen} chosen · ` : ""}
        {total ?? "…"}
      </span>
    </legend>
  );
}

export function SourceRow({
  label,
  meta,
  status,
  checked,
  onChange,
}: {
  label: ReactNode;
  meta?: ReactNode;
  status?: RowStatus;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  const ready = !status || status === "ready";
  return (
    <li className="flex min-h-7 items-center rounded-sm px-1.5 hover:bg-hover">
      <Checkbox
        checked={checked}
        // A chosen source that is no longer ready stays untickable.
        disabled={!ready && !checked}
        onChange={(e) => onChange(e.target.checked)}
        className="min-w-0 flex-1"
        label={
          <span className="flex min-w-0 items-center gap-2">
            <span className={ready ? "truncate text-ink" : "truncate text-dim"}>{label}</span>
            {meta && <span className="shrink-0 font-mono text-2xs tabular-nums text-dim">{meta}</span>}
            {!ready && status && (
              <Pill size="sm" tone={status === "failed" ? "danger" : "warn"}>
                {STATUS_TEXT[status]}
              </Pill>
            )}
          </span>
        }
      />
    </li>
  );
}
```

In `BuildDialog.tsx`, delete `STATUS_TEXT`, `GroupHead` and `SourceRow`, and add `import { GroupHead, SourceRow } from "./SourceRows";`. Remove `Checkbox` and `Pill` from its `@/ui` import if they are now unused.

- [ ] **Step 8: Add `useProjectDrawings` to `frontend/src/assetmodels/run/sources.ts`**

Add the imports `import { listDrawings, type Drawing } from "@/api/drawings";` and `import { useChangesStore } from "@/store/changes";`, then append:

```ts
/**
 * Every drawing of the project (a PDF page each; a project has tens to a few hundred), re-read on
 * `drawings.changed` and on `reload()`. `add` shows drawings just created before the next read.
 */
export function useProjectDrawings(projectId: string) {
  const api = useApi();
  const revision = useChangesStore((s) => s.mapWorkspaceRevision);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ items: Drawing[] | null; error: string | null }>({
    items: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    listDrawings(api, projectId).then(
      (items) => live && setState({ items, error: null }),
      (e: unknown) =>
        live && setState((s) => ({ items: s.items ?? [], error: messageOf(e, "could not load the list") })),
    );
    return () => {
      live = false;
    };
  }, [api, projectId, revision, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const add = useCallback(
    (more: Drawing[]) =>
      setState((s) => ({
        ...s,
        items: [...(s.items ?? []).filter((d) => !more.some((m) => m.id === d.id)), ...more],
      })),
    [],
  );
  return { ...state, reload, add };
}
```

- [ ] **Step 9: Write `frontend/src/assetmodels/run/DrawingSources.tsx`** (files only; Task 10 adds the rest)

```tsx
import type { AssetSourceRef } from "@contract/client";
import { Skeleton } from "@/ui";
import type { DrawingFile } from "./drawingFiles";
import { GroupHead, SourceRow } from "./SourceRows";

const ref = (id: string): AssetSourceRef => ({ type: "drawing", id });

export interface DrawingSourcesProps {
  files: DrawingFile[] | null;
  error: string | null;
  isChosen(ref: AssetSourceRef): boolean;
  onToggleFile(file: DrawingFile, on: boolean): void;
}

/** The project's drawings as whole files (plant-model spec §8.1: the picker selects whole files). */
export function DrawingSources({ files, error, isChosen, onToggleFile }: DrawingSourcesProps) {
  const picked = (f: DrawingFile) => f.drawings.filter((d) => isChosen(ref(d.id))).length;
  const chosenFiles = files?.filter((f) => picked(f) > 0).length ?? 0;
  return (
    <fieldset className="min-w-0">
      <GroupHead title="Drawings" chosen={chosenFiles} total={files?.length ?? null} />
      {files === null ? (
        <Skeleton className="h-7 w-full" />
      ) : error ? (
        <p className="text-xs text-danger">{`The list could not be loaded: ${error}`}</p>
      ) : files.length === 0 ? (
        <p className="px-1.5 text-xs text-dim">No drawings in this project.</p>
      ) : (
        <ul className="flex max-h-32 flex-col overflow-y-auto">
          {files.map((f) => {
            const n = picked(f);
            const usable = f.drawings.filter((d) => d.status !== "failed").length;
            return (
              <SourceRow
                key={f.key}
                label={f.label}
                meta={n > 0 && n < usable ? `${n} of ${usable} pages` : f.meta}
                status={f.status}
                checked={n > 0}
                onChange={(on) => onToggleFile(f, on)}
              />
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 10: Wire it into `BuildDialog.tsx`**

1. Imports: `import { DrawingSources } from "./DrawingSources";` and `import { groupDrawingFiles, type DrawingFile } from "./drawingFiles";`. Extend the `./sources` import with `useProjectDrawings`.
2. Replace `const drawings = useDataSources(projectId, "drawing");` with:
   ```ts
     const drawingList = useProjectDrawings(projectId);
     const files = useMemo(() => (drawingList.items ? groupDrawingFiles(drawingList.items) : null), [drawingList.items]);
   ```
3. In the `chosen`/`dropped` memo, replace the `listed` helper body:
   ```ts
       const listed = (type: AssetSourceRef["type"]) => {
         if (type === "drawing")
           return !drawingList.items || drawingList.error ? null : new Set(drawingList.items.map((d) => d.id));
         return type === "point_cloud" && clouds.items && !clouds.error ? new Set(clouds.items.map((i) => i.id)) : null;
       };
   ```
   and change the memo's dependency list to `[seeded, drawingList.items, drawingList.error, clouds]`.
4. Below `onToggle`, add:
   ```ts
     const onToggleFile = (file: DrawingFile, on: boolean) => {
       const next = new Map(chosen);
       for (const d of file.drawings) next.delete(sourceKey({ type: "drawing", id: d.id }));
       if (on) for (const r of file.refs) next.set(sourceKey(r), r);
       setPicked(next);
     };
     const waiting = [...chosen.values()].filter(
       (r) => r.type === "drawing" && drawingList.items?.find((d) => d.id === r.id)?.status === "importing",
     ).length;
   ```
5. In `sourceName`, use `drawingList.items?.find((d) => d.id === r.id)?.name` for drawings, and `clouds.items` for clouds:
   ```ts
     const sourceName = (r: AssetSourceRef) => {
       const label =
         r.type === "drawing"
           ? drawingList.items?.find((d) => d.id === r.id)?.name
           : r.type === "point_cloud"
             ? clouds.items?.find((i) => i.id === r.id)?.label
             : undefined;
       return label ?? (r.type === "image" ? "A chosen photo" : r.type === "drawing" ? "A chosen drawing" : "A chosen point cloud");
     };
   ```
6. `const canStart = chosen.size > 0 && !tooMany && waiting === 0 && provider !== null && !busy;`
7. Replace the drawings `<DataGroup title="Drawings" ... />` with:
   ```tsx
             <DrawingSources
               files={files}
               error={drawingList.error}
               isChosen={isChosen}
               onToggleFile={onToggleFile}
             />
   ```
8. Below the `dropped > 0` paragraph, add:
   ```tsx
             {waiting > 0 && (
               <p className="text-xs text-muted">
                 {`Waiting for ${waiting} ${waiting === 1 ? "drawing" : "drawings"} to finish importing.`}
               </p>
             )}
   ```

`useDataSources` stays for point clouds; its doc comment keeps "drawings or point clouds" and still works for both.

- [ ] **Step 11: Run the tests**

Run: `pnpm -C frontend exec vitest run src/assetmodels`
Expected: PASS, including every pre-existing BuildDialog and AssetModelWorkspace test.

One test needs a note: "a chosen source that is not ready any more can still be unticked" seeds `d2` (importing). The file row is ticked and enabled; unticking leaves it disabled, as before. Start stays disabled while it is chosen (Ruling 12), which the test does not check.

- [ ] **Step 12: Commit**

```
git add frontend/src/assetmodels/run/drawingFiles.ts frontend/src/assetmodels/run/drawingFiles.test.ts frontend/src/assetmodels/run/SourceRows.tsx frontend/src/assetmodels/run/DrawingSources.tsx frontend/src/assetmodels/run/sources.ts frontend/src/assetmodels/run/BuildDialog.tsx frontend/src/assetmodels/run/BuildDialog.test.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx
git commit -m "feat(asset-models): build dialog picks whole drawing files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: "Not imported yet" with "Import and include"

**Files:**
- Create: `frontend/src/assetmodels/run/importFile.ts`, `frontend/src/assetmodels/run/importFile.test.ts`
- Modify: `frontend/src/assetmodels/run/sources.ts` (`useUnimportedDrawings`)
- Modify: `frontend/src/assetmodels/run/DrawingSources.tsx` (the not-imported list)
- Modify: `frontend/src/assetmodels/run/BuildDialog.tsx` (import state, job tracking)
- Test: `frontend/src/assetmodels/run/BuildDialog.test.tsx`

**Interfaces:**
- Consumes: `createDrawingInspection`, `createDrawing`, `createDrawingPages`, `listUnimportedDrawings`, `autoImportRequest` (Task 7), `settledInspection`/`drawingWait` (Task 8), `useTrackedJob`, `isActiveJob`, `useJobsStore`.
- Produces:
  - `importDrawingFile(api, projectId, path) -> { drawings, job }`;
  - `useUnimportedDrawings(projectId) -> { items: UnimportedDrawing[] | null; error: string | null; drop(path: string): void }`;
  - `DrawingSources` gains the props `unimported`, `unimportedError`, `importing`, `importErrors`, `onImport`.

- [ ] **Step 0: Load the design context**

Invoke `impeccable` and `emil-design-eng`; read `DESIGN.md`. Use only `Button` and the existing text tokens (`text-2xs`, `text-dim`, `text-muted`, `text-danger`, `border-line`, `hover:bg-hover`).

- [ ] **Step 1: Write the failing helper test**

```ts
// frontend/src/assetmodels/run/importFile.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { BUILD_JOB, drawingJob, INSPECT_JOB, pdfDrawing, pdfInspection, pngWorldFileInspection, bigPdfInspection } from "@/mapws/drawings/testFixtures";
import { drawingWait } from "@/setup/drawingSetup";
import { useJobsStore } from "@/store/jobs";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import type { DrawingInspection } from "@/api/drawings";
import { importDrawingFile } from "./importFile";

beforeEach(() => {
  drawingWait.sleep = async () => {};
  useJobsStore.setState({ jobs: {} });
});

function serve(insp: DrawingInspection) {
  return fakeClient([
    {
      method: "POST",
      path: /\/drawing-inspections$/,
      status: 202,
      body: { inspection: { ...insp, state: "inspecting" }, job: drawingJob(INSPECT_JOB, "running") },
    },
    { method: "GET", path: /\/drawing-inspections\/[^/]+$/, body: insp },
    {
      method: "POST",
      path: /\/drawings\/pages$/,
      status: 202,
      body: { drawings: [{ ...pdfDrawing, id: "p1", page: 1 }, { ...pdfDrawing, id: "p2", page: 2 }], job: drawingJob(BUILD_JOB, "queued") },
    },
    { method: "POST", path: /\/drawings$/, status: 202, body: { drawing: pdfDrawing, job: drawingJob(BUILD_JOB, "queued") } },
  ]);
}

describe("importDrawingFile", () => {
  it("imports every page of a multi-page PDF", async () => {
    const { api, requests } = serve(pdfInspection);
    const out = await importDrawingFile(api, PROJECT_ID, pdfInspection.path);
    expect(out.drawings.map((d) => d.id)).toEqual(["p1", "p2"]);
    expect(out.job.id).toBe(BUILD_JOB);
    expect(requests.at(-1)?.body).toMatchObject({ pages: "all", name: "foundation-plan" });
  });

  it("imports a one-page PDF as one drawing", async () => {
    const { api, requests } = serve(bigPdfInspection);
    const out = await importDrawingFile(api, PROJECT_ID, bigPdfInspection.path);
    expect(out.drawings).toEqual([pdfDrawing]);
    expect(requests.at(-1)?.body).toMatchObject({ page: 1 });
  });

  it("throws the reason when the file needs a choice", async () => {
    const { api } = serve(pngWorldFileInspection);
    await expect(importDrawingFile(api, PROJECT_ID, pngWorldFileInspection.path)).rejects.toThrow(
      /A world file has no CRS/,
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/run/importFile.test.ts`
Expected: FAIL, cannot resolve `./importFile`.

- [ ] **Step 3: Write `frontend/src/assetmodels/run/importFile.ts`**

```ts
import type { ApiClient, Job } from "@contract/client";
import {
  createDrawing,
  createDrawingInspection,
  createDrawingPages,
  type Drawing,
} from "@/api/drawings";
import { autoImportRequest } from "@/mapws/drawings/drawingImport";
import { settledInspection } from "@/setup/drawingSetup";
import { useJobsStore } from "@/store/jobs";

/**
 * "Import and include" (plan I1 Ruling 12): read the file, then import it as Add data would with no
 * one at the dialog: every page of a PDF in one job, any other file with the dialog's defaults.
 * Throws with the reason when the file needs a person's choice or cannot be read.
 */
export async function importDrawingFile(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<{ drawings: Drawing[]; job: Job }> {
  const { inspection, job: inspectJob } = await createDrawingInspection(api, projectId, path);
  useJobsStore.getState().upsert(inspectJob);
  const insp = await settledInspection(api, projectId, inspection.id);
  if (insp.state === "failed") throw new Error(insp.error ?? "Reading the drawing failed.");
  if (insp.state === "inspecting") throw new Error("The file is still being read. Try again in a minute.");
  const request = autoImportRequest(insp);
  if (request.kind === "error") throw new Error(`${request.error} Import it from Add data.`);
  if (request.kind === "pages") {
    const r = await createDrawingPages(api, projectId, request.body);
    return { drawings: r.drawings, job: r.job };
  }
  const r = await createDrawing(api, projectId, request.body);
  return { drawings: [r.drawing], job: r.job };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/run/importFile.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing dialog tests**

Append to `frontend/src/assetmodels/run/BuildDialog.test.tsx`. Import `drawingWait` from `@/setup/drawingSetup`, `pdfInspection`, `drawingJob`, `BUILD_JOB`, `INSPECT_JOB` from `@/mapws/drawings/testFixtures`, and `useJobsStore` from `@/store/jobs`.

```ts
describe("BuildDialog: drawings not imported yet", () => {
  beforeEach(() => {
    drawingWait.sleep = async () => {};
    useJobsStore.setState({ jobs: {} });
  });

  const T6 = { path: "E:\\LNG\\Drawings\\T0006.pdf", name: "T0006.pdf", format: "pdf", size: 2048, pages: 2 };

  function intake(opts: { inspectStatus?: number } = {}) {
    let imported = false;
    const made = (status: string) => [
      drawing("n1", "T0006 · p1", T6.path, 1, status),
      drawing("n2", "T0006 · p2", T6.path, 2, status),
    ];
    return [
      { method: "GET", path: /\/drawings\/unimported$/, body: () => ({ files: imported ? [] : [T6] }) },
      {
        method: "GET",
        path: /\/drawings$/,
        body: () => ({ items: [...drawingRows.items, ...(imported ? made("ready") : [])] }),
      },
      {
        method: "POST",
        path: /\/drawing-inspections$/,
        status: opts.inspectStatus ?? 202,
        body:
          (opts.inspectStatus ?? 202) === 202
            ? { inspection: { ...pdfInspection, path: T6.path, state: "inspecting" }, job: drawingJob(INSPECT_JOB, "running") }
            : { error: { code: "not_found", message: "drawing file not found", details: {} } },
      },
      { method: "GET", path: /\/drawing-inspections\/[^/]+$/, body: { ...pdfInspection, path: T6.path } },
      {
        method: "POST",
        path: /\/drawings\/pages$/,
        status: 202,
        body: () => {
          imported = true;
          return { drawings: made("importing"), job: drawingJob(BUILD_JOB, "succeeded") };
        },
      },
      { method: "GET", path: new RegExp(`/jobs/${BUILD_JOB}$`), body: drawingJob(BUILD_JOB, "succeeded") },
    ];
  }

  it("imports a file with Import and include, ticks its pages and sends them once ready", async () => {
    const { api, requests } = setup([...intake(), POSTED]);
    open(api);
    expect(await screen.findByText("T0006.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF · 2 pages")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /import and include T0006\.pdf/i }));
    const file = await screen.findByRole("checkbox", { name: /T0006\.pdf/ });
    await waitFor(() => expect(file).toBeChecked());
    await waitFor(() => expect(screen.getByRole("button", { name: /start build/i })).toBeEnabled());
    expect(screen.queryByRole("button", { name: /import and include/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && /\/runs$/.test(r.url))).toBe(true));
    const run = requests.find((r) => r.method === "POST" && /\/runs$/.test(r.url))!;
    expect((run.body as { sources: unknown }).sources).toEqual([
      { type: "drawing", id: "n1" },
      { type: "drawing", id: "n2" },
    ]);
    expect(requests.find((r) => /\/drawings\/pages$/.test(r.url))?.body).toMatchObject({ pages: "all" });
  });

  it("shows why a file could not be imported, on its row", async () => {
    const { api } = setup(intake({ inspectStatus: 404 }));
    open(api);
    fireEvent.click(await screen.findByRole("button", { name: /import and include T0006\.pdf/i }));
    expect(await screen.findByText("drawing file not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import and include T0006\.pdf/i })).toBeEnabled();
  });

  it("a folder scan that fails does not block the dialog", async () => {
    const { api } = setup([
      { method: "GET", path: /\/drawings\/unimported$/, status: 500, body: { error: { code: "internal", message: "disk", details: {} } } },
    ]);
    open(api);
    expect(await screen.findByText(/files not imported yet could not be listed/i)).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: /ga drawing/i })).toBeEnabled();
  });
});
```

`POSTED` is the existing `/runs` POST route helper in this test file. If its regex differs, keep the file's helper and adapt only the `requests.find` predicate. If `fakeClient` routes do not accept `body` as a function for POST, check the `FakeRoute.body` type (it accepts `(req) => FakeBody`).

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/run/BuildDialog.test.tsx -t "not imported yet"`
Expected: FAIL, "Unable to find an element with the text: T0006.pdf".

- [ ] **Step 7: Add `useUnimportedDrawings` to `sources.ts`**

Add `listUnimportedDrawings, type UnimportedDrawing` to the `@/api/drawings` import, then append:

```ts
/** Drawing files in the project folder never imported (GET /drawings/unimported, ≤ 500); `drop` hides one just imported. */
export function useUnimportedDrawings(projectId: string) {
  const api = useApi();
  const [state, setState] = useState<{ items: UnimportedDrawing[] | null; error: string | null }>({
    items: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    listUnimportedDrawings(api, projectId).then(
      (items) => live && setState({ items, error: null }),
      (e: unknown) => live && setState({ items: [], error: messageOf(e, "could not read the project folder") }),
    );
    return () => {
      live = false;
    };
  }, [api, projectId]);
  const drop = useCallback(
    (path: string) => setState((s) => ({ ...s, items: s.items?.filter((f) => f.path !== path) ?? null })),
    [],
  );
  return { ...state, drop };
}
```

- [ ] **Step 8: Extend `DrawingSources.tsx`**

Add the imports `import type { UnimportedDrawing } from "@/api/drawings";` and `Button` from `@/ui`. Extend the props and render the list below the files:

```tsx
export interface DrawingSourcesProps {
  files: DrawingFile[] | null;
  error: string | null;
  isChosen(ref: AssetSourceRef): boolean;
  onToggleFile(file: DrawingFile, on: boolean): void;
  unimported: UnimportedDrawing[] | null;
  unimportedError: string | null;
  /** The path being imported; the other rows wait (one import at a time). */
  importing: string | null;
  importErrors: Record<string, string>;
  onImport(file: UnimportedDrawing): void;
}

function unimportedMeta(f: UnimportedDrawing): string {
  const kind = f.format.toUpperCase();
  return f.pages && f.pages > 1 ? `${kind} · ${f.pages} pages` : kind;
}
```

Inside the `fieldset`, after the files block:

```tsx
      {unimported && unimported.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="mb-1 px-1.5 text-2xs font-medium text-muted">Not imported yet</p>
          <ul aria-label="Not imported yet" className="flex max-h-32 flex-col overflow-y-auto">
            {unimported.map((f) => (
              <li key={f.path} className="flex flex-col rounded-sm px-1.5 hover:bg-hover">
                <div className="flex min-h-7 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={f.path}>
                    {f.name}
                  </span>
                  <span className="shrink-0 font-mono text-2xs tabular-nums text-dim">{unimportedMeta(f)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="import"
                    aria-label={`Import and include ${f.name}`}
                    loading={importing === f.path}
                    disabled={importing !== null && importing !== f.path}
                    onClick={() => onImport(f)}
                  >
                    Import and include
                  </Button>
                </div>
                {importErrors[f.path] && <p className="pb-1 text-xs text-danger">{importErrors[f.path]}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unimportedError && (
        <p className="mt-1 px-1.5 text-xs text-dim">{`Files not imported yet could not be listed: ${unimportedError}`}</p>
      )}
```

Also change the empty-state condition to `files.length === 0 && !unimported?.length`, so "No drawings in this project." does not sit above a list of files waiting to be imported.

- [ ] **Step 9: Wire the import into `BuildDialog.tsx`**

Imports: `import type { UnimportedDrawing } from "@/api/drawings";`, `import { useTrackedJob } from "@/jobs/useTrackedJob";`, `import { isActiveJob } from "@/store/jobs";` (merge with the existing `useJobsStore` import), and `import { importDrawingFile } from "./importFile";`. Add `useUnimportedDrawings` to the `./sources` import.

After `const files = useMemo(...)`:

```tsx
  const unimported = useUnimportedDrawings(projectId);
  const [importing, setImporting] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<Record<string, string>>({});
  const [importJob, setImportJob] = useState<string | null>(null);
  const tracked = useTrackedJob(projectId, importJob);
  const { reload: reloadDrawings, add: addDrawings } = drawingList;
  useEffect(() => {
    if (tracked.job && !isActiveJob(tracked.job)) {
      setImportJob(null);
      reloadDrawings();
    }
  }, [tracked.job, reloadDrawings]);
```

After `onToggleFile`:

```tsx
  const onImport = async (file: UnimportedDrawing) => {
    if (importing) return;
    setImporting(file.path);
    setImportErrors(({ [file.path]: _gone, ...rest }) => rest);
    try {
      const { drawings: made, job } = await importDrawingFile(api, projectId, file.path);
      useJobsStore.getState().upsert(job);
      addDrawings(made);
      const next = new Map(chosen);
      for (const d of made) next.set(sourceKey({ type: "drawing", id: d.id }), { type: "drawing", id: d.id });
      setPicked(next);
      unimported.drop(file.path);
      setImportJob(job.id);
    } catch (e) {
      setImportErrors((m) => ({ ...m, [file.path]: messageOf(e, "The file could not be imported.") }));
    } finally {
      setImporting(null);
    }
  };
```

Pass the new props to `<DrawingSources>`:

```tsx
            <DrawingSources
              files={files}
              error={drawingList.error}
              isChosen={isChosen}
              onToggleFile={onToggleFile}
              unimported={unimported.items}
              unimportedError={unimported.error}
              importing={importing}
              importErrors={importErrors}
              onImport={(f) => void onImport(f)}
            />
```

If ESLint flags `_gone` as unused, write the removal as `setImportErrors((m) => { const next = { ...m }; delete next[file.path]; return next; })`.

- [ ] **Step 10: Run the tests, lint and tokens**

Run: `pnpm -C frontend exec vitest run src/assetmodels src/setup src/mapws/drawings`
Expected: PASS.
Run: `pnpm -C frontend lint`
Expected: no errors, and `check-tokens` passes.

- [ ] **Step 11: Commit**

```
git add frontend/src/assetmodels/run/importFile.ts frontend/src/assetmodels/run/importFile.test.ts frontend/src/assetmodels/run/sources.ts frontend/src/assetmodels/run/DrawingSources.tsx frontend/src/assetmodels/run/BuildDialog.tsx frontend/src/assetmodels/run/BuildDialog.test.tsx
git commit -m "feat(asset-models): build dialog offers drawings not imported yet with Import and include

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: e2e

**Files:**
- Modify: `frontend/e2e/drawings-import.spec.ts`
- Modify: `frontend/e2e/fixtures/assetModels.ts` (`routeRuns` gains `/drawings` + `/drawings/unimported`; new `routeDrawingIntake`)
- Modify: `frontend/e2e/models-build.spec.ts` (+1 test)

**Interfaces:**
- Consumes: the UI from Tasks 8 to 10.
- Produces: `routeDrawingIntake(page) -> Promise<{ pagesPosted: unknown[] }>` in `frontend/e2e/fixtures/assetModels.ts`.

- [ ] **Step 1: Update `drawings-import.spec.ts`**

1. In `routes()`, add a route:
   ```ts
     await page.route(`**/api/v1/projects/${P}/drawings/pages`, (r) =>
       r.fulfill(
         jsonReply(
           {
             drawings: [
               { id: "d1", name: "foundation-plan · p1", status: "importing" },
               { id: "d2", name: "foundation-plan · p2", status: "importing" },
             ],
             job: job(BJ, "queued"),
           },
           202,
         ),
       ),
     );
   ```
2. In "Add data → Drawing imports page 2 of a PDF in the background", delete `await dialog.getByRole("checkbox", { name: "Page 2" }).click();`. All pages now start ticked, so unticking Page 1 leaves page 2. Keep the assertions.
3. Add a test after it:

```ts
test("Add data → Drawing imports every page of a PDF in one request", async ({ page }) => {
  await routes(page);
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "Add data" }).first().click();
  await page.getByRole("dialog", { name: "Add data" }).getByRole("button", { name: /Drawing/ }).click();
  const dialog = page.getByRole("dialog", { name: "Import drawing" });
  await dialog.getByLabel("Drawing file").fill("D:\\plans\\foundation-plan.pdf");
  await dialog.getByRole("button", { name: "Read file" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Page 2" })).toHaveAttribute("aria-checked", "true");
  const post = page.waitForRequest((r) => r.url().endsWith(`/projects/${P}/drawings/pages`) && r.method() === "POST");
  await dialog.getByRole("button", { name: "Start import" }).click();
  expect((await post).postDataJSON()).toEqual({
    inspection_id: INSP,
    name: "foundation-plan",
    pages: "all",
    dpi: 150,
    placement: { method: "none" },
  });
  await expect(page.getByText(/Drawing import started/)).toBeVisible();
  await expect(dialog).toBeHidden();
});
```

- [ ] **Step 2: Extend the asset-model fixture**

In `frontend/e2e/fixtures/assetModels.ts`, add a drawing row helper near `modelJson`:

```ts
export const drawingJson = (id: string, name: string, source_path: string, page: number | null, status = "ready") => ({
  id,
  name,
  format: "pdf",
  kind: "raster",
  status,
  error: null,
  job_id: null,
  source_path,
  source_size: 2048,
  page,
  units: null,
  width: 100,
  height: 100,
  dpi: 150,
  extent_src: [0, -100, 100, 0],
  layers: [],
  georef: null,
  georef_version: 0,
  bounds_site: null,
  layer_state: { hidden_layers: [], knockout_white: false },
  captured_on: null,
  created_at: T,
  updated_at: T,
});
```

In `routeRuns`, after the `/data` route, add:

```ts
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/drawings`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      if (route.request().method() !== "GET") return route.fallback();
      return json(route, { items: [drawingJson("d1", "GA drawing", "D:\\plans\\ga.pdf", 1)] });
    },
  );
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/drawings/unimported`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      return json(route, { files: [] });
    },
  );
```

Then add the intake helper at the end of the file. It is registered after `routeRuns`, so it wins for the paths it serves:

```ts
/**
 * A project folder with one PDF never imported (T0006.pdf, 2 pages) and the import it starts: the
 * inspection reads at once, POST /drawings/pages answers a finished job, and /drawings then lists
 * both pages ready. Call after `routeRuns`.
 */
export async function routeDrawingIntake(page: Page): Promise<{ pagesPosted: unknown[] }> {
  const pagesPosted: unknown[] = [];
  const api = "/api/v1";
  const path = "E:\\LNG\\Drawings\\T0006.pdf";
  const INSP = "e0000000-2222-4000-8000-0000000000a6";
  const JOB = "j0000000-9999-4000-8000-0000000000a6";
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const preflight = (route: Route) => route.request().method() === "OPTIONS";
  const job = (id: string, state: string) => ({
    id,
    project_id: P,
    type: "drawing_import",
    state,
    progress: state === "succeeded" ? 1 : 0,
    message: "",
    log_path: "",
    params: {},
    result: null,
    error: null,
    created_at: T,
    started_at: null,
    finished_at: null,
  });
  const inspection = {
    id: INSP,
    state: "ready",
    error: null,
    job_id: "j-inspect",
    path,
    format: "pdf",
    file_size: 2048,
    sha256: "abc",
    units: null,
    units_source: null,
    crs_hint: null,
    extent_src: null,
    layers: [],
    page_count: 2,
    pages: [
      { page: 1, width_pt: 2384, height_pt: 1684 },
      { page: 2, width_pt: 2384, height_pt: 1684 },
    ],
    width: null,
    height: null,
    embedded: null,
    warnings: [],
    created_at: T,
  };
  const made = (status: string) => [
    drawingJson("n1", "T0006 · p1", path, 1, status),
    drawingJson("n2", "T0006 · p2", path, 2, status),
  ];
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/drawings/unimported`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      return json(route, {
        files: pagesPosted.length ? [] : [{ path, name: "T0006.pdf", format: "pdf", size: 2048, pages: 2 }],
      });
    },
  );
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/drawings`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      if (route.request().method() !== "GET") return route.fallback();
      return json(route, {
        items: [drawingJson("d1", "GA drawing", "D:\\plans\\ga.pdf", 1), ...(pagesPosted.length ? made("ready") : [])],
      });
    },
  );
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/drawing-inspections`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      return json(route, { inspection: { ...inspection, state: "inspecting" }, job: job("j-inspect", "running") }, 202);
    },
  );
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/drawing-inspections/${INSP}`,
    (route) => (preflight(route) ? route.fulfill({ status: 204, headers: CORS }) : json(route, inspection)),
  );
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/drawings/pages`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      pagesPosted.push(route.request().postDataJSON());
      return json(route, { drawings: made("importing"), job: job(JOB, "succeeded") }, 202);
    },
  );
  await page.route(
    (u) => u.pathname.startsWith(`${api}/projects/${P}/jobs/`),
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
      return json(route, job(id, "succeeded"));
    },
  );
  return { pagesPosted };
}
```

Use the file's existing `CORS`, `T`, `P`, `Page` and `Route` names. If `CORS` lacks a method the dialog uses, extend its `Access-Control-Allow-Methods` to `GET, POST, OPTIONS`; it already has those.

- [ ] **Step 3: Add the models-build e2e**

In `frontend/e2e/models-build.spec.ts`, import `routeDrawingIntake` and add:

```ts
test("include a drawing file that was never imported, then build from it", async ({ page }) => {
  await routeAssetModels(page, { empty: true });
  const runs = await routeRuns(page, { finishAfterPolls: 2 });
  const intake = await routeDrawingIntake(page);
  await page.goto(URL_);
  await page.getByRole("button", { name: /build with ai/i }).click();
  await expect(page.getByText("T0006.pdf")).toBeVisible();
  await page.getByRole("button", { name: /import and include T0006\.pdf/i }).click();
  await expect(page.getByRole("checkbox", { name: /T0006\.pdf/ })).toBeChecked();
  await expect(page.getByRole("button", { name: /start build/i })).toBeEnabled();
  await page.getByRole("button", { name: /start build/i }).click();
  await expect.poll(() => runs.started.length).toBe(1);
  expect(runs.started[0].sources).toEqual([
    { type: "drawing", id: "n1" },
    { type: "drawing", id: "n2" },
  ]);
  expect(intake.pagesPosted[0]).toMatchObject({ name: "T0006", pages: "all" });
});
```

The page is reached by its URL, as the existing tests in this spec do. The spec does not use Main-navigation links, and none are needed: no sidebar navigation happens here.

- [ ] **Step 4: Run the two specs**

Run (PowerShell, worktree root): `$env:E2E_WEB_PORT=1473; $env:E2E_MOCK_PORT=4073; pnpm -C frontend exec playwright test e2e/drawings-import.spec.ts e2e/models-build.spec.ts`
Expected: all pass (3 + 3 tests).

- [ ] **Step 5: Commit**

```
git add frontend/e2e/drawings-import.spec.ts frontend/e2e/fixtures/assetModels.ts frontend/e2e/models-build.spec.ts
git commit -m "test(e2e): all-pages drawing import and Import and include in the build dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Full gate and operator walkthrough

**Files:**
- Create: `E:\Dev\Yolo\app\.superpowers\sdd\pm-common\walkthroughs\i1.md` (git-ignored, not committed)

- [ ] **Step 1: Run the gate**

From `E:\Dev\Yolo\app\.claude\worktrees\pm-i1`:
```
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT=1473; $env:E2E_MOCK_PORT=4073; pnpm -C frontend e2e
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml } else { "cargo test skipped: no frozen sidecar" }
```
Expected:
- contract check clean;
- ruff clean;
- pytest all pass;
- lint, tokens, vitest and the build clean;
- e2e all pass;
- cargo either passes or prints the skip line.

If `ruff format --check` reports files, run `ruff format` on **only** this unit's files, re-run the gate, and commit them with `style: ruff format (I1)`.

- [ ] **Step 2: Write the operator walkthrough**

Write `E:\Dev\Yolo\app\.superpowers\sdd\pm-common\walkthroughs\i1.md`:

```
# I1 intake: how to test this

1. Open a project, then Add data → Drawing. Choose a multi-page PDF (for example one of the
   Al-Zour plot plans) and press Read file. Every page thumbnail is ticked, and the line under the
   grid reads "N of N pages selected".
2. Press Start import. The dialog closes with "Drawing import started". The Jobs list shows ONE
   "drawing_import" job whose message steps "Page 1 (1 of N) …", "Page 2 (2 of N) …".
3. When it finishes, the Map workspace's drawing list has one drawing per page, named
   "<file> · p1" … "<file> · pN".
4. Open Add data → Drawing on another PDF, untick some pages, press "None" then "All pages", untick
   one page, and import. Only the ticked pages are imported.
5. Copy a PDF you have NOT imported into the project folder (for example <project>\Drawings\new.pdf).
   Open Asset models → a model → Build with AI. Under Drawings, a "Not imported yet" list shows
   new.pdf with "PDF · N pages".
6. Press "Import and include" on it. Its pages appear as one ticked file row ("new.pdf", "N pages").
   Start build stays disabled with "Waiting for N drawings to finish importing." until the job ends,
   then it is enabled.
7. Close and reopen Build with AI: new.pdf is no longer under "Not imported yet". Copy the same PDF
   under another name in the project folder and reopen the dialog: the copy is not listed either.
8. Tick and untick the PDF's file row: it sends all its pages. A plain single drawing still shows
   under its own name.
9. Start a 20+ page PDF import and quit the app midway. Reopen: the pages already built are ready;
   the rest show as failed "import interrupted by application restart".
```

- [ ] **Step 3: Report**

The task ends here: no merge, push, installer or `/wrapup`. Report `READY_TO_MERGE` to the coordinator with the gate output summary, the commit list (`git log --oneline main..HEAD`) and the walkthrough path.

---

## Self-review notes (planner)

- **Spec coverage.**
  - §8.1 "Import all pages" is covered by T2, T3, T7, T8.
  - "`list_sources` groups pages by source file" is T6.
  - "build dialog source picker selects whole files" is T9.
  - "lists project-folder drawings never imported… Import and include" is T4, T5, T10.
  - §13 I1 tests: the multi-page fixture PDF (T3, built in the test with the existing reportlab helper `write_pdf`) and the unimported scan by sha256 (T4). Cache invalidation by mtime is T4 `test_the_hash_is_cached_until_the_file_changes`.
  - The e2e import flow update is T11.
- **Type consistency.**
  - `DrawingPagesCreate.pages: "all" | int[]` is used the same way in T1 (pydantic), T2 (`body.pages == "all"`) and T7 (`pages.length === count ? "all" : pages`).
  - Job items `{drawing_id, page, dpi}` are written in T3's route and read in `phase_pages.PageCtx`.
  - `DrawingFile.refs` is read in T9's `onToggleFile`.
  - `settledInspection` is exported in T8 and used in T10.
- **Open risk.** F0's real schema names. Task 1 checks them, and later tasks substitute names without changing assertions.
