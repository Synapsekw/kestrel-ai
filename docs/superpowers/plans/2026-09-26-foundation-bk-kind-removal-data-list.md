# Foundation BK: kind removal, Data list, search and app jobs. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the project kind and its server-side guard out of the backend end to end, and add the three read endpoints F's screens need: the project Data list (`GET /projects/{id}/data`), in-project search (`GET /projects/{id}/search`) and the app-wide jobs list (`GET /api/v1/jobs`).

**Architecture:** The kind guard (`app/projects/kinds.py`) and every `require_kind` dependency are deleted, so every router is included plainly. `kind` leaves the project API, the registry and the recent list. "Move map", whose only purpose was the split, goes too. The `project.kind` **column** stays in the database until BC's migration `0010` drops it; the ORM simply stops mapping it. A new package `app/data_items/` holds one provider per data item type. Each provider pages its own table in one shared sort order. The Data list and the data half of search merge the providers' pages with a keyset cursor. `app/jobs/app_router.py` merges the library runner's jobs with those of every open recent project in the same way.

**Tech Stack:** FastAPI, SQLAlchemy 2 (SQLite), pydantic 2, pytest, schemathesis (the existing contract test). There is no frontend work and no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (F): §6.1, §6.3, §10.1, §10.3, §13, §14, §15, §16, §18 (unit **BK**). Umbrella: `docs/superpowers/specs/2026-09-26-inspection-platform-design.md` §3 (Project, Data item).

**Where this runs:** in its own worktree `E:\Dev\Yolo\app\.claude\worktrees\f-bk` on `task/f-bk`, cut from `main` **after unit C0 (contract) has merged**. C0's plan is `docs/superpowers/plans/2026-09-26-foundation-c0-contract.md`. It did not exist when this plan was written, so this plan uses the spec §13 names verbatim. Task 0 checks them against what C0 actually landed. Where C0 differs, **C0 wins**: you rename the field or parameter in this plan's code before writing its test.

**DAG position (spec §18):** BK is in **batch 2** (`DS ∥ BK ∥ BC ∥ BM ∥ MG-framework`), after C0. Its files do not overlap the other batch-2 units' files, except for a one-line removal in `app/db/models.py` (BC's area, see Global Constraints). **BK merges first in batch 2**, because it removes the `kind` guard that BC's, BM's and MG's tests would otherwise hit. Then MG-framework, BC and BM (the index's order, which supersedes spec §18; DS any time). S1 (Overview, Add data, palette search) and S2 (Jobs screen) consume BK's endpoints in batch 4.

**Budget (AGENTS.md §6):**
- **Background jobs:** none are added. BK adds three synchronous reads and deletes one job type's producer (`map_move`).
- **Bounded reads:**
  - **Data list:** at most 4 providers (5 once M adds `drawing`), each answering `limit + 1` rows from its own small table. That is ≤ 5 × (limit + 1) rows and one statement per provider per page, pinned by a statement-count test.
  - **Search:** each provider answers `LIMIT limit` (default 8, capped at 20), and the findings group gets the same limit. The `image` table is never read, pinned by a test.
  - **App jobs:** 1 library source plus ≤ `MAX_RECENT` (20) open recent projects, each answering `limit + 1` rows through `ix_job_created`. That is ≤ 21 × (limit + 1) rows.
  - No endpoint loads an image set, a box table or a full job history.

## Global Constraints

- **C0 is merged first.** `contract/openapi.yaml` already has (spec §13):
  - `/projects/{projectId}/data`, `/projects/{projectId}/search` and `/jobs`
  - `DataItem`, `DataItemType` (`image_set | map | elevation | point_cloud | drawing`) and `AppJob`
  - no `ProjectKind`, no `WrongProjectKind`, no `kind` on `Project`/`ProjectCreate`
  - `ProjectCreate {name, folder, type_ids[]}`
  - `/projects/{id}/maps/{mapId}/move` (`moveMapToProject`) still in the contract, `deprecated: true` with `x-retire-with: F-SH`, and listed in `RETIRING` in `tests/test_contract.py`. BK deletes the backend route; the path, `MapMoveRequest` and the `RETIRING` entry stay until SH deletes them with `MoveMapDialog` (the index, "Deprecated contract paths").
  - `JobType` still lists `map_move`

  **No task here edits `contract/openapi.yaml` or `contract/client/schema.d.ts`.** If a contract change turns out to be needed, stop and raise it with the coordinator (it is a C0 change).
- **BK writes no migration.** Project `0010` belongs to BC, library `0002` to BM and catalogue `0001` to BC (spec §11.1). The `project.kind` column stays in `project.db` until BC's `0010` drops it. Its `server_default 'train'` fills it on insert, so the ORM can stop mapping it now.
- **The one edit outside BK's listed folders** is removing the `Project.kind` mapping (two lines) from `backend/app/db/models.py`. BC owns that file in batch 2 and rebases onto BK, which merges first.
- **Not BK's (leave alone):**
  - `PUT /projects/{id}/classes` → `/types` and the `project_type` table (BC)
  - `/projects/{id}/datasets*` and `/projects/{id}/train` deletion (BM deletes them when the Models routes replace them; BK only takes their guard off)
  - `ProjectOut.summary` and `.migration` (BC and MG)
  - `list_projects` per-project isolation (MG)
  - the findings half of search (BC registers it, Task 4)
  - every frontend file (SH)
- **`type_ids` on create is accepted and not yet stored** (Task 2). The `project_type` table arrives with BC's `0010`, and BC makes `ProjectRegistry.create` write it. No interim UI sends `type_ids` (the type picker is S1's).
- **Interim `main`:** between BK's merge and SH's merge, the real app's frontend still reads `project.kind`, and its `KindRoute` screens show a loading placeholder. No installer is built from `main` in that window. The Playwright e2e runs against the Prism mock, so the gate is unaffected by BK.
- **Retired vocabulary.** After Task 2, none of these appear anywhere under `backend/app` or `backend/tests`, except in the test that lists them:
  - the names `require_kind`, `project_kind`, `wrong_project_kind`, `ProjectKind`, `ANY_KIND`, `TRAIN_ONLY`, `DETECT_ONLY`, `DETECT_WRITE`, `BOTH_KINDS`, `QUERY_RUN_KINDS`
  - a literal `"kind": "train"` or `"detect"` (or `kind="train"` / `kind="detect"`)

  This is spec §17 criterion 1 for the backend. `run_kind`, `Source.kind`, `Surface.kind`, `QueryRun.kind` and `provenance_kind` are other things and stay.
- **The Data list order** is `captured_on` descending, then undated items (`captured_on` null) last, then `created_at` descending, then `id` ascending. The spec says only "id", so this plan picks ascending. Every provider sorts in exactly this order, and `SortKey.order()` mirrors it in Python.
- **Status mapping** (spec §6.3):
  - `surface.status = building` → `importing`.
  - An image set is `importing` while its import job is `queued`/`running`. Otherwise it is `ready` once `Source.imported_at` is set, and `failed` if it never finished an import. A failed *re*-import over a good import keeps the set `ready`, because its images are still there.
  - Maps and point clouds pass their `status` through.
- **Search input:** `q` is trimmed. Below 2 characters the answer is two empty groups (not an error). LIKE wildcards in `q` are matched literally (escaped with `\`). Matching is case-insensitive (SQLite `lower() LIKE lower()`).
- **Limits are lenient in, clamped inside.** `limit` parameters declare only `ge=1`, and the handler clamps: the Data list and jobs to `MAX_LIMIT = 1000` (default 100, `app/pagination.py`), search to 20 (default 8). A value above C0's declared maximum is then never answered with 422. `negative_data_rejection` is already excluded in `tests/test_contract.py`.
- **Interpreter:** the worktree has no venv (CONTRIBUTING.md, "A worktree has no venv of its own"). Every backend command runs from `E:\Dev\Yolo\app\.claude\worktrees\f-bk\backend` with:
  ```powershell
  $PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
  ```
  Nothing is installed.
- **Git:** stage by path, never `git add -A`. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. The commit identity is pinned by `scripts\start-task.ps1`.
- **The gate** (AGENTS.md §4), in full before the merge:
  ```powershell
  pnpm -C contract check
  cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest
  pnpm -C frontend lint
  pnpm -C frontend test
  pnpm -C frontend build
  pnpm -C frontend e2e  # scripts\finish-task.ps1 runs it on free ports
  cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if the frozen sidecar is present
  ```

## Review Focus

These are the five inputs the spec implies but no spec test names, most likely to bite first. Each one has a pinning test in the task named.

1. **An import finishes while the operator is scrolling the Data list.** A new item lands between page 1 and page 2. Expected: page 2 continues exactly where page 1 stopped, with no item repeated and none skipped. The new item shows on the next fresh first page. Pinned in Task 3 (`test_an_item_added_between_pages_neither_repeats_nor_skips`).
2. **A search containing `%`, `_` or `\`** (the operator types a site code such as `ZG_04` or `50%`). Expected: a literal match, never a wildcard that returns everything. Pinned in Task 4 (`test_like_wildcards_in_the_query_match_literally`).
3. **The interim frontend still sends `kind` and `classes`, and no `type_ids`, on create** (SH has not merged yet). Expected: `201`, not `422`. The kind is ignored, and the extra `classes` are ignored until BC. Pinned in Task 2 (`test_an_old_client_create_body_is_not_refused`).
4. **The library is unavailable, or one open project's database fails, while the Jobs screen loads.** Expected: `GET /jobs` still answers with every other source. The failure is logged, never a 500 for the whole list. Pinned in Task 5 (`test_a_failing_source_is_left_out`, `test_no_library_still_lists_project_jobs`).
5. **Data items with equal dates and equal `created_at`**, for example two surfaces built by one request, or rows written in the same microsecond. Also items with no capture date. Expected: a stable order by `id` that never loses a row at a page boundary, with undated items after dated ones. Pinned in Task 3 (`test_ties_break_by_id_across_a_page_boundary`, `test_items_from_every_type_merge_in_one_order`).

## Spec ambiguities resolved while planning

These are recorded here so reviewers do not flag them. Each one is also in the report to the coordinator.

1. **Who deletes `/projects/{id}/datasets*` and `/train`?** Spec §6.1 lists them, but their replacements are BM's (§12), and deleting them before BM lands would leave no way to train. **BK takes their guard off, and BM deletes them.**
2. **`ProjectRegistry.create(name, folder, type_ids)` before `project_type` exists.** BK changes the signature and the body (`type_ids`, default `[]`) and stores nothing. **BC** makes `create` write `project_type` in `0010`.
3. **`type_ids` defaults to `[]` in the backend** even if C0 marks it required, so the interim frontend's create body is not refused (Review Focus 3).
4. **Tests that need classes** get them from a new `tests/project_factory.py::new_project`. It writes `Project.classes` directly, with the same `normalise_classes` that `PUT /classes` uses, so the tests do not depend on C0's or BC's route decisions. BC changes only this helper when classes become derived from `project_type`.
5. **The findings group of search** needs BC's `finding` and `project_type` tables. BK ships the endpoint with a registration seam (`register_finding_search`), and the group is empty until **BC registers** its search on import.
6. **Image set status** has no status column. It is derived from the import job and `imported_at` (Global Constraints). A re-import that fails over a good import stays `ready`.
7. **`id` direction in the sort** is ascending (the spec says only "id").
8. **Indexes on `captured_on`:** the spec says "small indexed queries", but BK may not write a migration. The four data tables hold tens to hundreds of rows per project (one per import, not one per image). The queries are bounded by `LIMIT`, and the statement count is pinned. If BC wants indexes, they belong in `0010`.
9. **`GET /jobs?project_id=`**:
   - For an open or recent project, it reads that project, opening it if it is recent but closed (one project, bounded).
   - `library` reads only the library.
   - An unknown id is an empty page with `200`, not a `404` the contract may not declare.
   - Without `project_id`, only projects that are **already open** are read (spec §10.1).
10. **`project_name`** is read from the project row in the same session as its jobs, not from `recent_projects.json`. The recent list keeps the old name after a rename.
11. **`data.changed` events** (`Event.type`, §13) are not published by BK. Publishing them means editing four importers outside BK's files. Screens refresh on `job.finished` until a later unit adds it.
12. **Model adoption now runs for every project** (spec §6.1, `project_opened`). A project with no old models has nothing pending, so no job is queued.

---

## File map

| File | Task | Change |
| --- | --- | --- |
| `backend/app/projects/kinds.py` | 1 | **deleted** |
| `backend/app/api.py` | 1, 3, 4, 5 | every router included plainly; later three new routers |
| `backend/app/datasets/router.py` | 1 | router and routes lose their guard |
| `backend/app/inference/router.py` | 1 | same |
| `backend/app/maps/router.py`, `backend/app/maps/schemas.py` | 1 | guard off; `/maps/{mapId}/move` and `MapMoveRequest` deleted |
| `backend/app/maps/move.py` | 1 | **deleted** |
| `backend/app/project_agent/router.py` | 1 | guard off |
| `backend/app/projects/router.py` | 1, 2 | `BOTH_KINDS` off; create takes `type_ids` |
| `backend/app/library/adoption.py`, `adoption_router.py` | 1 | kind check and "training-only" wording off |
| `backend/app/detect/router.py`, `analytics_router.py`, `export_router.py`, `review_router.py` | 1 | docstrings no longer describe a guard |
| `backend/app/main.py` | 1 | docstring and the `map_move` comment |
| `backend/app/projects/service.py` | 1, 2, 5 | `_kind` off (1); `create(name, folder, type_ids)`, no kind (2); `open_recent()` (5) |
| `backend/app/projects/schemas.py` | 2 | `ProjectKind`, `kind` off; `ProjectCreate.type_ids` |
| `backend/app/appdata.py` | 2 | `remember()` loses `kind` |
| `backend/app/db/models.py` | 2 | `Project.kind` mapping off (the column stays) |
| `backend/app/data_items/__init__.py`, `schemas.py`, `providers.py`, `router.py` | 3 | **new**: Data list |
| `backend/app/data_items/search.py` | 4 | **new**: search and the findings seam |
| `backend/app/jobs/app_router.py` | 5 | **new**: app jobs |
| `backend/tests/test_no_project_kind.py` | 1, 2 | **new** |
| `backend/tests/project_factory.py` | 2 | **new**: `new_project` |
| `backend/tests/data_rows.py` | 3 | **new**: row builders for the four data types |
| `backend/tests/test_data_items.py`, `test_search.py`, `test_app_jobs.py` | 3, 4, 5 | **new** |
| `backend/tests/test_project_kinds.py`, `test_maps_move.py` | 1 | **deleted** |
| about 30 existing test modules | 1, 2 | refusal tests deleted (1); `project_kind` fixtures and kind/classes create bodies replaced (2) |
| `backend/tests/test_contract.py` | 2–5 | fixture uses `new_project`; BK's operations leave C0's stub list |

**Execution DAG inside BK:** T0 → T1 → T2 → (T3 → T4) ∥ T5 → T6.
- T1 and T2 both rewrite the test suite, so they run in sequence.
- T3/T4 and T5 share only one line each in `api.py` and `test_contract.py`.
- The critical path is T0 → T1 → T2 → T3 → T4 → T6.
- One executor runs them in order. T5 may start as soon as T2 has landed.

---

### Task 0: Preflight (no code, no commit)

**Files:** none changed.

**Interfaces:**
- Produces: the names table below, confirmed or corrected, which Tasks 3–5 use.

- [ ] **Step 1: Confirm C0 is on `main`**

Run (PowerShell, from `E:\Dev\Yolo\app`):
```powershell
git log --oneline main -15
Select-String -Path contract\openapi.yaml -Pattern "^  /projects/\{projectId\}/data:|^  /projects/\{projectId\}/search:|^  /jobs:|ProjectKind|/move:"
```
Expected: C0's merge commit in the log. The three new paths are printed. `ProjectKind` is **not** printed. `/move:` **is** printed (C0 keeps it deprecated until SH). If any new path is missing, stop: C0 has not landed.

- [ ] **Step 2: Cut the worktree**

```powershell
scripts\start-task.ps1 f-bk
cd E:\Dev\Yolo\app\.claude\worktrees\f-bk
git branch --show-current
```
Expected: `task/f-bk`.

- [ ] **Step 3: Read C0's names and fill the table**

Open `contract/openapi.yaml` in the worktree and read the three operations and the `DataItem`, `AppJob` and `ProjectCreate` schemas. Confirm or correct each row:

| What | This plan assumes (spec §13 verbatim) |
| --- | --- |
| Data list | `GET /projects/{projectId}/data`, query `type` (array of `DataItemType`), `limit`, `cursor`; returns `{items: DataItem[], next_cursor: string \| null}` |
| `DataItem` | `{id, type, label, captured_on (date \| null), status (importing \| ready \| failed), created_at, summary (object)}` |
| Search | `GET /projects/{projectId}/search`, query `q`, `limit`; returns `{findings: Finding[], data: DataItem[]}` |
| App jobs | `GET /jobs`, query `state` (array), `type` (array), `project_id`, `limit`, `cursor`; returns `{items: AppJob[], next_cursor}` where `AppJob = Job + {project_name: string \| null}` |
| `ProjectCreate` | `{name, folder, type_ids: string[]}` |

A field that C0 named differently is renamed in Tasks 3–5's code **and** tests before you write them. Note the three operationIds (`grep -n "operationId" -B3`).

- [ ] **Step 4: Find how C0 routed the unbuilt and retired operations**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-bk\backend
Select-String -Path app\*.py,app\*\*.py -Pattern '"/data"|"/search"|prefix="/jobs"|add_stubs'
Select-String -Path tests\test_contract.py -Pattern "EXPECTED_STUBS|RETIRING|BACKEND_PENDING|move|classes"
```
Record:
- (a) the module and the `STUBS` tuples, if any, that C0 used to route the three BK operations as 501 stubs. Each task deletes its tuple and its `EXPECTED_STUBS` entry.
- (b) C0's `RETIRING` allowance (deprecated operations whose route may be deleted before their path leaves the contract): `moveMapToProject` → F-SH, `updateClasses` → F-S1, the dataset operations and `trainModel` → F-S2. **BK keeps every `RETIRING` entry**, including `moveMapToProject`: the path stays in the contract until SH, and `RETIRING` is what lets BK delete the route now.

- [ ] **Step 5: Baseline**

```powershell
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
& $PY -m pytest -q -x
```
Expected: all pass (the suite on `main` after C0). If it does not, stop and report. BK does not start on a red `main`.

---

### Task 1: Delete the kind guard and "Move map"

**Files:**
- Delete: `backend/app/projects/kinds.py`, `backend/app/maps/move.py`, `backend/tests/test_project_kinds.py`, `backend/tests/test_maps_move.py`
- Modify: `backend/app/api.py` (whole file)
- Modify: `backend/app/datasets/router.py:45-54,170,310-364`
- Modify: `backend/app/inference/router.py:22-31,47-121`
- Modify: `backend/app/maps/router.py:11,32,50-58` (+ every `dependencies=DETECT_WRITE`, and the `move_map` route at 132-148)
- Modify: `backend/app/maps/schemas.py:121-...` (`MapMoveRequest`)
- Modify: `backend/app/project_agent/router.py:12-19`
- Modify: `backend/app/projects/router.py:6,25-26` (+ `dependencies=BOTH_KINDS` on five routes)
- Modify: `backend/app/projects/service.py:34,160-162`
- Modify: `backend/app/library/adoption.py:1,27,95-105`, `backend/app/library/adoption_router.py:1-2`
- Modify: `backend/app/detect/router.py:1-4`, `analytics_router.py:1-5`, `export_router.py:1-5`, `review_router.py:1-5`
- Modify: `backend/app/main.py:21-27,100`
- Test: `backend/tests/test_no_project_kind.py` (new)
- Test: delete the refusal tests listed in Step 6

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - No route carries a kind dependency.
  - `app.projects.kinds` does not exist.
  - `ProjectHandle` has no `_kind`.
  - `api_router` includes every router without `dependencies=`.
  - `app.maps.move` and `POST /projects/{id}/maps/{mapId}/move` do not exist. Old `map_move` job rows still list.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_no_project_kind.py`:

```python
"""A project has no kind (spec 2026-09-26-foundation sections 6.1, 16 and 17): no guard is left, and
work that used to belong to one kind of project runs in any project."""

import importlib.util
import re
from pathlib import Path

import pytest
from fastapi.routing import APIRoute

from app.db.models import Job

BACKEND = Path(__file__).resolve().parents[1]
BASE = "/api/v1/projects"
# The retired guard's vocabulary. `run_kind`, `Source.kind`, `Surface.kind` and `provenance_kind`
# are other things and stay.
RETIRED = re.compile(
    r"\b(require_kind|project_kind|wrong_project_kind|ProjectKind|ANY_KIND|TRAIN_ONLY|DETECT_ONLY"
    r"|DETECT_WRITE|BOTH_KINDS|QUERY_RUN_KINDS)\b"
)
SCANNED = ("app",)


@pytest.fixture(params=["train", "detect"])
def project_kind(request) -> str:
    """Until Task 2 the create body still carries a kind: run each case as both old kinds."""
    return request.param


def _calls(dependant):
    for d in dependant.dependencies:
        yield d.call
        yield from _calls(d)


def test_the_kind_module_is_gone():
    assert importlib.util.find_spec("app.projects.kinds") is None


def test_no_route_carries_a_kind_guard(app):
    guarded = sorted(
        route.path
        for route in app.routes
        if isinstance(route, APIRoute)
        and any(getattr(c, "__name__", "") in {"_check_kind", "_any_kind"} for c in _calls(route.dependant))
    )
    assert guarded == []


def test_no_source_file_names_the_retired_guard():
    hits = []
    for folder in SCANNED:
        for path in sorted((BACKEND / folder).rglob("*.py")):
            if path.name == Path(__file__).name:
                continue
            for n, line in enumerate(path.read_text("utf-8").splitlines(), 1):
                if RETIRED.search(line):
                    hits.append(f"{path.relative_to(BACKEND)}:{n}: {line.strip()}")
    assert hits == []


WRITES = [
    # (method, path, body factory, status, error code): the project's own answer, never the guard's.
    ("post", "/images/nope/preannotate", lambda tmp: {}, 404, "not_found"),  # was training-only
    ("post", "/datasets", lambda tmp: {"name": "ds"}, 409, "conflict"),  # was training-only
    ("post", "/maps", lambda tmp: {"path": str(tmp / "missing.tif")}, 404, "not_found"),  # detection
    ("patch", "/sources/nope", lambda tmp: {"label": "x"}, 404, "not_found"),  # was detection-only
]


@pytest.mark.parametrize(("method", "path", "body", "status", "code"), WRITES)
def test_work_that_belonged_to_one_kind_runs_in_any_project(
    client, project_id, tmp_path, method, path, body, status, code
):
    r = getattr(client, method)(f"{BASE}/{project_id}{path}", json=body(tmp_path))
    assert (r.status_code, r.json()["error"]["code"]) == (status, code), r.text


@pytest.mark.parametrize(
    "path",
    ["/agent", "/adoption", "/datasets", "/runs", "/site-areas", "/analytics/areas", "/maps", "/surfaces"],
)
def test_reads_that_belonged_to_one_kind_answer_in_any_project(client, project_id, path):
    r = client.get(f"{BASE}/{project_id}{path}")
    assert r.status_code == 200, (path, r.text)


def test_the_move_map_route_is_gone(client, project_id):
    r = client.post(f"{BASE}/{project_id}/maps/m1/move", json={"target_project_id": "x"})
    assert r.status_code in (404, 405), r.text
    assert importlib.util.find_spec("app.maps.move") is None


def test_an_old_map_move_job_row_still_lists(client, handle, project_id):
    """`JobType` keeps `map_move` so jobs from before the split still validate (spec 6.1)."""
    with handle.session() as s:
        s.add(Job(type="map_move", state="succeeded", params={"source_project_id": "p", "map_id": "m"}))
    items = client.get(f"{BASE}/{project_id}/jobs").json()["items"]
    assert [j["type"] for j in items] == ["map_move"]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& $PY -m pytest tests/test_no_project_kind.py -v`
Expected: FAIL.
- `test_the_kind_module_is_gone` fails with `assert ModuleSpec(name='app.projects.kinds', ...) is None`.
- `test_no_route_carries_a_kind_guard` fails listing `/api/v1/projects/{projectId}/...` paths.
- `test_no_source_file_names_the_retired_guard` fails listing `app/api.py:17: from app.projects.kinds import ...` and others.
- The `detect` case of `/images/nope/preannotate` and `/datasets` fails with `(409, 'wrong_project_kind')`.
- The `train` case of `/maps` and `/sources/nope` fails with `(409, 'wrong_project_kind')`.
- `test_the_move_map_route_is_gone` fails with a status other than 404/405.

- [ ] **Step 3: Rewrite `backend/app/api.py`**

Replace the whole file with:

```python
import importlib
import logging

from fastapi import APIRouter, Depends

from app.agent.router import router as agent_router
from app.auth import require_token
from app.datasets.router import router as datasets_router
from app.exports.router import router as exports_router
from app.health import router as health_router
from app.inference.router import router as inference_router
from app.jobs.router import router as jobs_router
from app.library.adoption_router import router as adoption_router
from app.library.router import project_router as train_router
from app.library.router import router as library_router
from app.project_agent.router import router as project_agent_router
from app.projects.router import router as projects_router
from app.providers.router import router as providers_router
from app.training.starter_router import router as starter_router

log = logging.getLogger(__name__)

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])
# A project has no kind (spec 2026-09-26-foundation section 6.1): every project may do everything,
# so every router is included plainly.
for r in (
    agent_router,
    health_router,
    projects_router,
    library_router,
    datasets_router,
    starter_router,
    providers_router,
    inference_router,
    project_agent_router,
    jobs_router,
    exports_router,
    train_router,
    adoption_router,
):
    api_router.include_router(r)

# Detection runs and class mapping (plan 2 unit R). Its jobs (`infer`, `map_detect`) import
# rasterio, so it is guarded like the maps router below.
try:
    from app.detect.router import router as detect_router

    api_router.include_router(detect_router)
except Exception:
    log.exception("detect router failed to load; run endpoints will be unavailable")

# The maps router's import chain pulls in `rasterio` at module scope (router -> service/tiles ->
# raster, the job modules). A broken GDAL in the frozen bundle must not stop the whole backend from
# starting (AGENTS.md: "the app must start even when startup work fails") - so this import is
# guarded the same way the other heavy native deps are kept out of module scope elsewhere
# (`providers/local_yolo.py`, `library/service.py`). On failure the map endpoints simply 404
# instead of existing, and the rest of the app works normally.
try:
    from app.maps.router import router as maps_router

    api_router.include_router(maps_router)
except Exception:
    log.exception("maps router failed to load; map endpoints will be unavailable")

# Site areas and analytics (plan 2 unit A). Guarded like the maps router: the site-area geometry
# needs pyproj, and a broken native dependency must not stop the backend.
try:
    from app.detect.analytics_router import router as detect_analytics_router

    api_router.include_router(detect_analytics_router)
except Exception:
    log.exception("site-area and analytics router failed to load; those endpoints will be unavailable")

# Detection exports, CSV and PDF (plan 2 unit E). Guarded like analytics, which it reads; reportlab
# itself is imported only inside the job, when a PDF is asked for.
try:
    from app.detect.export_router import router as detect_export_router

    api_router.include_router(detect_export_router)
except Exception:
    log.exception("detection export router failed to load; detection exports will be unavailable")

# Reviewing detection runs (plan 2 unit V). It serves map runs and imports the map schemas, so it
# goes with the maps router: a broken native stack costs the review endpoints, never the app.
try:
    if "maps_router" not in globals():
        raise ImportError("the maps router did not load")
    from app.detect.review_router import router as review_router

    api_router.include_router(review_router)
except Exception:
    log.exception("review router failed to load; review endpoints will be unavailable")

# Point clouds, surfaces, volumes and design surfaces (foundation F0 of the 2026-09-23 point-cloud,
# volumes and design-surface specs). Guarded like the maps router: laspy, scipy and rasterio are
# native stacks, and a broken one must cost only its own endpoints, never the app.
for _module in (
    "app.pointclouds.router",
    "app.surfaces.router",
    "app.surfaces.design.router",
    "app.volumes.router",
):
    try:
        api_router.include_router(importlib.import_module(_module).router)
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)
```

If C0's Task 0 Step 4 (a) showed C0 including a stub module for BK's three operations in `api.py`, keep that include exactly as C0 wrote it. Tasks 3–5 remove its tuples.

- [ ] **Step 4: Take the guard off each router**

1. `backend/app/datasets/router.py`:
   - Delete the import `from app.projects.kinds import ANY_KIND, require_kind` and the lines `TRAIN_ONLY = ...` and `DETECT_ONLY = ...`.
   - Replace the router declaration (and its comment) with:
     ```python
     router = APIRouter(prefix="/projects/{projectId}", tags=["datasets"])
     ```
   - Delete `, dependencies=DETECT_ONLY` (on `@router.patch("/sources/{sourceId}"...)`) and every `, dependencies=TRAIN_ONLY` (the five `/datasets` routes).
2. `backend/app/inference/router.py`:
   - Delete the `kinds` import, the four comment lines above `QUERY_RUN_KINDS`, and the lines `QUERY_RUN_KINDS = ...` and `TRAIN_ONLY = ...`.
   - Delete every `, dependencies=QUERY_RUN_KINDS` and `, dependencies=TRAIN_ONLY`. On the multi-line `resume` decorator, also delete the trailing comma it leaves.
3. `backend/app/maps/router.py`:
   - Change `from app.maps import move, service, timeline` to `from app.maps import service, timeline`. Delete `MapMoveRequest,` from the schemas import and the `kinds` import.
   - Delete the two comment lines and the `DETECT_WRITE = ...` line, keeping `IMMUTABLE = ...`.
   - Delete every `, dependencies=DETECT_WRITE`.
   - Delete the whole `@router.post("/maps/{mapId}/move", ...)` decorator and the `move_map` function.
4. `backend/app/maps/schemas.py`: delete `class MapMoveRequest` (and its body).
5. `backend/app/project_agent/router.py`: delete the `kinds` import and make the router
   ```python
   router = APIRouter(prefix="/projects/{projectId}/agent", tags=["agent"])
   ```
   Drop `Depends` from the fastapi import only if ruff reports it unused.
6. `backend/app/projects/router.py`: delete the `kinds` import, the comment and `BOTH_KINDS = ...`, and every `, dependencies=BOTH_KINDS`.
7. Delete the files:
   ```powershell
   git rm backend/app/projects/kinds.py backend/app/maps/move.py backend/tests/test_project_kinds.py backend/tests/test_maps_move.py
   ```

- [ ] **Step 5: Kind reads outside the routers**

1. `backend/app/projects/service.py`:
   - Delete the line `self._kind: str | None = None  # cached by app.projects.kinds.project_kind; never changes` in `ProjectHandle.__init__`.
   - Delete `h._kind = kind` in `_cache`. The `kind` parameters stay until Task 2.
2. `backend/app/library/adoption.py`:
   - Delete `from app.projects.kinds import TRAIN, project_kind` and the two lines
     ```python
         if project_kind(handle) != TRAIN:
             return None
     ```
   - Replace the docstring's first line with `"""Adopting a project's old models into the app-wide library (spec 2026-09-23 section 6).`
   - In the same docstring, change "When a training project with such rows is opened" to "When a project with such rows is opened".
   - Replace the `submit_if_pending` docstring's first two paragraphs with:
     ```python
         """On open: queue the adoption job for a project that still has unadopted models.

         Nothing happens without a library, with nothing pending, or while an adoption job is
         already queued or running. Returns the job, or None.
         """
     ```
3. `backend/app/library/adoption_router.py`: replace the module docstring with
   ```python
   """`/projects/{id}/adoption`: how far a project's old models are into the library (spec 2026-09-23
   section 6)."""
   ```
4. Docstrings that describe the guard:
   - `app/detect/router.py`: replace the second paragraph (`` `api.py` includes this router with ... ``) with `Any project may create and read runs (spec 2026-09-26-foundation section 6.1).`
   - `app/detect/analytics_router.py` and `app/detect/export_router.py`: replace "Detection projects only: a training project answers `409 wrong_project_kind` (the guard is on the router, where `api.py` includes it)." with `Any project may use these routes (spec 2026-09-26-foundation section 6.1).`
   - `app/detect/review_router.py`: replace "Included in `app/api.py` with ... past detections." with `Any project may review its runs (spec 2026-09-26-foundation section 6.1).`
5. `backend/app/main.py`:
   - In the `project_opened` docstring, change "and start moving a training project's old models into the library" to "and start moving the project's old models into the library".
   - Replace the comment `# A \`map_move\` job runs in the target project and reads the map from the source project.` with `# Jobs that reach other projects find the registry on the runner.` Keep the line `app.state.jobs.projects = app.state.projects`.

- [ ] **Step 6: Delete the refusal tests the guard made**

These tests assert `wrong_project_kind` or a training-project 409. Delete each function (or class) whole:

| File | Delete |
| --- | --- |
| `tests/test_class_maps.py` | `test_a_training_project_is_refused` |
| `tests/test_design_api_inspect.py` | `test_a_training_project_may_read_but_not_inspect`, `test_a_training_project_may_not_delete_a_design_inspection` |
| `tests/test_design_build.py` | `test_a_training_project_may_not_import_a_design` |
| `tests/test_design_preview.py` | `test_a_training_project_may_not_preview` |
| `tests/test_detect_analytics.py` | `class TestTrainingProject` |
| `tests/test_detect_export.py` | `test_a_training_project_gets_409` |
| `tests/test_detect_review.py` | `test_review_is_refused_in_a_training_project` |
| `tests/test_detect_runs.py` | `test_a_training_project_is_refused` |
| `tests/test_detect_sources.py` | `test_patch_source_in_a_training_project_is_409`, `test_a_moved_map_gets_its_own_map_source` |
| `tests/test_library_adoption.py` | `test_submit_if_pending_does_nothing_for_a_detect_project`, `test_adoption_routes_are_training_only` |
| `tests/test_pointcloud_stubs.py` | `test_a_training_project_may_read_but_not_write` and the `GUARDED_WRITES` list |
| `tests/test_site_areas.py` | `class TestTrainingProject` |

In `tests/test_pointcloud_stubs.py`, also replace the module docstring's first sentence with `"""Foundation F0: the operations of the point-cloud, volumes and design specs were routed as 501 stubs, and the six new job types are registered.` Delete the docstring's last sentence ("GUARDED_WRITES stays fixed: ... runs.").

Keep the `moveMapToProject` entry of `RETIRING` in `tests/test_contract.py` (Task 0 Step 4 b): SH removes it with the path.

Then run the linter's autofix for imports these deletions leave unused:
```powershell
& $PY -m ruff check --fix tests app; & $PY -m ruff format tests app
```

- [ ] **Step 7: Run the new test and the whole suite**

Run: `& $PY -m pytest tests/test_no_project_kind.py -v`
Expected: PASS, 31 passed. That is 3 unparametrized tests, plus 4 writes, 8 reads and 2 move/job tests, each run for both old kinds.

Run: `& $PY -m pytest -q`
Expected: all pass. A failure naming `wrong_project_kind` or `/move` means Step 6 missed a test. Search for it with `Select-String -Path tests\*.py -Pattern "wrong_project_kind|/move"` and delete it.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/api.py backend/app/datasets/router.py backend/app/inference/router.py backend/app/maps/router.py backend/app/maps/schemas.py backend/app/project_agent/router.py backend/app/projects/router.py backend/app/projects/service.py backend/app/library/adoption.py backend/app/library/adoption_router.py backend/app/detect/router.py backend/app/detect/analytics_router.py backend/app/detect/export_router.py backend/app/detect/review_router.py backend/app/main.py backend/tests/test_no_project_kind.py backend/tests/test_class_maps.py backend/tests/test_design_api_inspect.py backend/tests/test_design_build.py backend/tests/test_design_preview.py backend/tests/test_detect_analytics.py backend/tests/test_detect_export.py backend/tests/test_detect_review.py backend/tests/test_detect_runs.py backend/tests/test_detect_sources.py backend/tests/test_library_adoption.py backend/tests/test_pointcloud_stubs.py backend/tests/test_site_areas.py backend/tests/test_contract.py
git commit -m "feat(backend): every project may do everything - the kind guard and Move map are gone

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(`git rm` in Step 4 already staged the four deleted files.)

---

### Task 2: Take `kind` out of the project model and API

**Files:**
- Modify: `backend/app/projects/schemas.py:46-55,69-92`
- Modify: `backend/app/projects/service.py:110-170`
- Modify: `backend/app/projects/router.py:50-55`
- Modify: `backend/app/appdata.py:30-42`
- Modify: `backend/app/db/models.py:22-23`
- Create: `backend/tests/project_factory.py`
- Modify: `backend/tests/conftest.py:195-211`, `backend/tests/test_projects.py`, `backend/tests/test_no_project_kind.py`
- Modify (create bodies → `new_project`): `tests/test_contract.py`, `test_class_maps.py`, `test_detect_runs.py`, `test_exports_csv.py`, `test_exports_job.py`, `test_jobs.py`, `test_library_adoption.py`, `test_library_jobs.py`, `test_pointcloud_router_guard.py`, `test_pointcloud_stubs.py`, `test_reveal.py`, `test_setup_workflow.py`
- Modify (fixture removal, scripted): every `tests/*.py` that defines a `project_kind` fixture

**Interfaces:**
- Consumes: Task 1's guard-free app.
- Produces:
  - `ProjectCreate {name: str, folder: str, type_ids: list[str] = []}`
  - `ProjectOut` without `kind`
  - `ProjectRegistry.create(name: str, folder: Path, type_ids: list[str]) -> ProjectHandle`
  - `AppData.remember(project_id: str, name: str, folder: str) -> None`
  - `tests/project_factory.py::new_project(client, folder: Path, *, name: str = "T", classes: list[dict] | None = None) -> dict` (the `ProjectOut` JSON)
  - the conftest `project` fixture: eight classes, no kind

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_no_project_kind.py`, and change `SCANNED` and `RETIRED` at the top:

```python
RETIRED = re.compile(
    r"\b(require_kind|project_kind|wrong_project_kind|ProjectKind|ANY_KIND|TRAIN_ONLY|DETECT_ONLY"
    r"|DETECT_WRITE|BOTH_KINDS|QUERY_RUN_KINDS)\b"
    r"|[\"']kind[\"']\s*:\s*[\"'](train|detect)[\"']|\bkind=[\"'](train|detect)[\"']"
)
SCANNED = ("app", "tests")
```

Add `import json` to the file's import block. Then add this at the end of the file:

```python
# The body the interim frontend still sends until SH lands: a kind and classes, no type_ids.
OLD_CLIENT_BODY = {"name": "A", "kind": "detect", "classes": [{"name": "x", "colour": "#ff0000"}]}


def test_a_project_has_no_kind(client, settings, tmp_path):
    r = client.post(BASE, json={"name": "A", "folder": str(tmp_path / "a"), "type_ids": []})
    assert r.status_code == 201, r.text
    created = r.json()
    assert "kind" not in created
    assert "kind" not in client.get(f"{BASE}/{created['id']}").json()
    assert all("kind" not in p for p in client.get(BASE).json()["items"])
    recent = json.loads((settings.data_dir / "recent_projects.json").read_text("utf-8"))
    assert recent[0]["id"] == created["id"] and "kind" not in recent[0]


def test_create_takes_type_ids_and_starts_with_no_classes(client, tmp_path):
    body = {"name": "A", "folder": str(tmp_path / "a"), "type_ids": ["t-1", "t-2"]}
    r = client.post(BASE, json=body)
    assert r.status_code == 201, r.text
    assert r.json()["classes"] == []


def test_an_old_client_create_body_is_not_refused(client, tmp_path):
    r = client.post(BASE, json={**OLD_CLIENT_BODY, "folder": str(tmp_path / "old")})
    assert r.status_code == 201, r.text
    assert "kind" not in r.json() and r.json()["classes"] == []


def test_recent_entries_written_with_a_kind_still_list(client, settings, tmp_path):
    pid = client.post(BASE, json={"name": "A", "folder": str(tmp_path / "a"), "type_ids": []}).json()["id"]
    path = settings.data_dir / "recent_projects.json"
    entries = json.loads(path.read_text("utf-8"))
    path.write_text(json.dumps([{**e, "kind": "detect"} for e in entries]), "utf-8")
    assert [p["id"] for p in client.get(BASE).json()["items"]] == [pid]
    client.post(f"{BASE}/open", json={"folder": str(tmp_path / "a")})
    assert "kind" not in json.loads(path.read_text("utf-8"))[0]
```

The `project_kind` fixture at the top of this file stays for now. Step 5's script removes it with all the others.

In `backend/tests/test_projects.py`, replace `_create` and its two literal bodies:

```python
from project_factory import new_project

CLASSES = [
    {"name": "excavator", "colour": "#ff0000", "hotkey": "1"},
    {"name": "dump_truck", "colour": "#00ff00", "hotkey": "2"},
]


def _create(client, folder, name="Ahmadia"):
    return new_project(client, folder, name=name, classes=CLASSES)
```
- In `test_create_in_folder_with_existing_project_is_409` the body becomes `{"name": "B", "folder": str(project_dir), "type_ids": []}`.
- In `test_relative_folder_is_422` it becomes `{"name": "A", "folder": "relative/dir", "type_ids": []}`.

Create `backend/tests/project_factory.py`:

```python
"""Creating a project in a test (plan BK; spec 2026-09-26-foundation section 6.1).

A project is created with `{name, folder, type_ids}`: no kind and no classes. Until unit BC lands
the project type list, a test that needs classes writes them straight into the project row with the
normalisation `PUT /projects/{id}/classes` uses. BC changes only this helper.
"""

from pathlib import Path

from app.projects.service import normalise_classes

BASE = "/api/v1/projects"


def new_project(client, folder: Path, *, name: str = "T", classes: list[dict] | None = None) -> dict:
    r = client.post(BASE, json={"name": name, "folder": str(folder), "type_ids": []})
    assert r.status_code == 201, r.text
    project = r.json()
    if classes:
        handle = client.app.state.projects.get(project["id"])
        with handle.session() as s:
            handle.row(s).classes = normalise_classes(classes)
        project = client.get(f"{BASE}/{project['id']}").json()
    return project
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& $PY -m pytest tests/test_no_project_kind.py tests/test_projects.py -v`
Expected: FAIL.
- `test_a_project_has_no_kind` fails with `assert 'kind' not in {... 'kind': 'train' ...}`.
- `test_create_takes_type_ids_and_starts_with_no_classes` fails with `422` (`kind` and `classes` are required).
- `test_no_source_file_names_the_retired_guard` fails listing `tests/conftest.py:...: def project_kind() -> str:` and the create bodies.

- [ ] **Step 3: Implement**

1. `backend/app/projects/schemas.py`:
   - Delete `ProjectKind = Literal["train", "detect"]` (and `Literal` from the typing import if it is then unused).
   - Replace `ProjectCreate` with:
     ```python
     class ProjectCreate(BaseModel):
         """`type_ids` are the catalogue types the project starts with (spec 2026-09-26-foundation
         section 9.2). It defaults to empty so a client from before the catalogue is not refused."""

         name: str = Field(min_length=1)
         folder: str
         type_ids: list[str] = []

         _folder_abs = field_validator("folder")(_absolute)
     ```
   - Delete `kind: ProjectKind` from `ProjectOut` and `kind=row.kind,` from `ProjectOut.from_row`.
2. `backend/app/projects/service.py`, `ProjectRegistry`: replace `create`, `open`, `_name_and_kind` and `_cache` with:
   ```python
       def create(self, name: str, folder: Path, type_ids: list[str]) -> ProjectHandle:
           """Create a project folder. `type_ids` are catalogue type ids: the project type list that
           stores them arrives with unit BC (migration 0010), and until then the project starts with
           no classes."""
           folder = folder.resolve()
           with self._lock:
               if (folder / "project.db").exists():
                   raise AppError("already_exists", f"{folder} already contains a project", 409)
               for sub in SUBDIRS:
                   (folder / sub).mkdir(parents=True, exist_ok=True)
               engine = open_project_db(folder)
               row = Project(name=name, classes=[], import_defaults=dict(DEFAULT_IMPORT_SETTINGS))
               with make_session_factory(engine)() as s:
                   s.add(row)
                   s.commit()
                   pid = row.id
               return self._cache(pid, folder, engine, name, remember=True)

       def open(self, folder: Path, remember: bool = True) -> ProjectHandle:
           """Open a project folder. `remember` moves it to the top of the recent list (a user action)."""
           folder = folder.resolve()
           if not (folder / "project.db").exists():
               raise not_found("project folder", str(folder))
           with self._lock:
               for h in self._handles.values():
                   if h.folder == folder:
                       if remember:
                           self.appdata.remember(h.id, self._name(h), str(folder))
                       return h
               engine = open_project_db(folder)
               with make_session_factory(engine)() as s:
                   row = s.execute(select(Project)).scalar_one()
                   pid, name = row.id, row.name
               return self._cache(pid, folder, engine, name, remember)

       @staticmethod
       def _name(h: ProjectHandle) -> str:
           with h.session() as s:
               return h.row(s).name

       def _cache(self, pid: str, folder: Path, engine, name: str, remember: bool) -> ProjectHandle:
           h = ProjectHandle(pid, folder, engine)
           self._handles[pid] = h
           if remember:
               self.appdata.remember(pid, name, str(folder))
           if self.on_open is not None:
               try:
                   self.on_open(h)
               except Exception:  # opening the project is what the operator asked for
                   log.exception("on_open hook failed for project %s at %s", pid, folder)
           return h
   ```
   `normalise_classes` stays (the classes route, `detect/class_maps.py` and the test helper use it).
3. `backend/app/projects/router.py`, `create_project`:
   ```python
   @router.post("", response_model=ProjectOut, status_code=201)
   def create_project(body: ProjectCreate, request: Request) -> ProjectOut:
       return _out(_registry(request).create(body.name, Path(body.folder), body.type_ids))
   ```
4. `backend/app/appdata.py`, `remember`:
   ```python
       def remember(self, project_id: str, name: str, folder: str) -> None:
           """Move a project to the top of the recent list. Entries written before the project kind
           was removed may still carry a `kind` key; `recent()` ignores it and this rewrite drops it."""
           items = [r for r in self.recent() if r["folder"].lower() != folder.lower()]
           items.insert(
               0,
               {
                   "id": project_id,
                   "name": name,
                   "folder": folder,
                   "last_opened_at": datetime.now(UTC).isoformat(),
               },
           )
           self._write(self._recent, items[:MAX_RECENT])
   ```
5. `backend/app/db/models.py`, class `Project`: delete the two lines
   ```python
       # "train" | "detect": set at creation, never changed (spec 2026-09-23 section 5.1).
       kind: Mapped[str] = mapped_column(String, default="train", server_default="train")
   ```
   Put this comment in their place:
   ```python
       # The `kind` column (migration 0007) is no longer mapped; its server default fills it until
       # migration 0010 drops it (spec 2026-09-26-foundation section 6.1).
   ```

- [ ] **Step 4: The conftest `project` fixture**

In `backend/tests/conftest.py`:
- Add `from project_factory import new_project` to the imports, next to `from local_paths import FRAMES_DIR`.
- Replace the `project` fixture with the one below. The `project_kind` fixture above it is removed by Step 5's script.

```python
@pytest.fixture
def project(client, project_dir) -> dict:
    """A project with the eight machinery classes (hotkeys 1-8)."""
    classes = [
        {"name": n, "colour": c, "hotkey": str(i + 1)}
        for i, (n, c) in enumerate(zip(EIGHT_CLASSES, COLOURS, strict=True))
    ]
    return new_project(client, project_dir, classes=classes)
```

- [ ] **Step 5: Remove every `project_kind` fixture (scripted)**

Write this file to your scratchpad as `strip_kind_fixtures.py` (use the Write tool: a bash heredoc collapses the `\n` escapes):

```python
"""One-off (plan BK Task 2): delete every `project_kind` pytest fixture under ./tests."""

import re
from pathlib import Path


def strip(text: str) -> str:
    lines = text.split("\n")
    out, i = [], 0
    while i < len(lines):
        if (
            lines[i].lstrip().startswith("@pytest.fixture")
            and i + 1 < len(lines)
            and re.match(r"\s*def project_kind\(", lines[i + 1])
        ):
            indent = len(lines[i + 1]) - len(lines[i + 1].lstrip())
            i += 2
            while i < len(lines) and (
                len(lines[i]) - len(lines[i].lstrip()) > indent
                or (lines[i].strip() == "" and i + 1 < len(lines) and lines[i + 1].startswith(" " * (indent + 1)))
            ):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return re.sub(r"\n{4,}", "\n\n\n", "\n".join(out))


for path in sorted(Path("tests").glob("*.py")):
    text = path.read_text("utf-8")
    new = strip(text)
    if new != text:
        path.write_text(new, "utf-8")
        print(path)
```

Run from the worktree's `backend` folder:
```powershell
& $PY <scratchpad>\strip_kind_fixtures.py
& $PY -m ruff check --fix tests; & $PY -m ruff format tests
```
Expected: it prints `tests\conftest.py`, `tests\test_no_project_kind.py` and the ~28 modules that set `project_kind` (`test_design_*`, `test_detect_*`, `test_maps_*`, `test_pointcloud_*`, `test_surfaces_*`, `test_volumes_*`, `test_site_areas.py`). Ruff then removes any `import pytest` left unused.

- [ ] **Step 6: Replace the remaining create bodies with `new_project`**

Each of these posts `{..., "classes": ..., "kind": ...}` itself. Import `from project_factory import new_project` in each file and replace the create with the call shown. The folder, name and classes are unchanged. Keep `["id"]` where the old code took the id.

| File | Replace | With |
| --- | --- | --- |
| `tests/test_contract.py` | the `project_id` fixture's body and post | `return new_project(client, project_dir, name="A", classes=[{"name": "excavator", "colour": "#ff0000"}])["id"]` |
| `tests/test_class_maps.py` | `_project(client, tmp_path, classes, kind="detect", name="Site")` | `def _project(client, tmp_path, classes, name="Site") -> dict: return new_project(client, tmp_path / name, name=name, classes=classes)` |
| `tests/test_detect_runs.py` | the `Empty` body and post in `test_the_first_run_in_an_empty_project_seeds_its_classes` | `project = new_project(client, tmp_path / "empty", name="Empty")` |
| `tests/test_exports_csv.py`, `tests/test_exports_job.py` | the `project_id` fixture's body and post | `return new_project(client, project_dir, classes=[{"name": n, "colour": c} for n, c in zip(CLASSES, ["#ff0000", "#00ff00"], strict=True)])["id"]` |
| `tests/test_jobs.py` | `_project(client, project_dir)` body | `return new_project(client, project_dir, name="A")["id"]` |
| `tests/test_library_adoption.py` | `_new_project(client, folder, kind="train")` | `def _new_project(client, folder: Path) -> str: classes = [...unchanged...]; return new_project(client, folder, name=f"P {folder.name}", classes=classes)["id"]` |
| `tests/test_library_jobs.py` | the `train_project` fixture body; the `detect_project` fixture body | `return new_project(client, tmp_path / "train-proj", name="Ahmadia")`; `return new_project(client, tmp_path / "detect-proj", name="Site", classes=[{"name": "excavator", "colour": "#ff0000"}])` |
| `tests/test_pointcloud_router_guard.py` | the inline body and post | `pid = new_project(client, settings.data_dir.parent / "d", name="d")["id"]` |
| `tests/test_pointcloud_stubs.py` | `_project(client, tmp_path, kind)` | `def _project(client, tmp_path, name="p") -> str: return new_project(client, tmp_path / name, name=name)["id"]`. Rename `test_a_detection_project_reaches_the_501_stubs` to `test_a_project_reaches_the_501_stubs` and call `_project(client, tmp_path)` |
| `tests/test_reveal.py` | the `project_id` fixture | `return new_project(client, project_dir, classes=[{"name": "excavator", "colour": "#ff0000"}])["id"]` |
| `tests/test_setup_workflow.py` | the `created = client.post(...)` block and its status assert | `project_id = new_project(client, tmp_path / "survey", name=draft["name"], classes=[{"name": n, "colour": "#e5af64"} for n in draft["classes"]])["id"]`, deleting the old `project_id = created.json()["id"]` line |

In `test_library_adoption.py`, the remaining calls pass only `(client, folder)`. Remove a `kind=` argument wherever one is left.

- [ ] **Step 7: Run the tests**

Run: `& $PY -m pytest tests/test_no_project_kind.py tests/test_projects.py -v`
Expected: PASS. `test_no_source_file_names_the_retired_guard` passing proves the sweep is complete. If it fails, it prints each remaining `file:line`; fix those lines the same way.

Run: `& $PY -m pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/projects/schemas.py backend/app/projects/service.py backend/app/projects/router.py backend/app/appdata.py backend/app/db/models.py backend/tests/project_factory.py backend/tests/conftest.py
git add -u backend/tests
git status --short
git commit -m "feat(backend): a project has no kind; create takes type_ids

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
`git add -u backend/tests` stages only modifications to **tracked** files under `backend/tests` (the fixture sweep touches ~40 of them). It is not `git add -A`. Check `git status --short` before committing: it must list only `backend/` paths.

---

### Task 3: The Data list, `GET /projects/{id}/data`

**Files:**
- Create: `backend/app/data_items/__init__.py`, `backend/app/data_items/schemas.py`, `backend/app/data_items/providers.py`, `backend/app/data_items/router.py`
- Modify: `backend/app/api.py` (include the router)
- Create: `backend/tests/data_rows.py`, `backend/tests/test_data_items.py`
- Modify: `backend/tests/test_contract.py` (remove the operation from `EXPECTED_STUBS` if C0 listed it), plus C0's stub tuple (Task 0 Step 4 a)

**Interfaces:**
- Consumes: `app.pagination.clamp_limit/encode_cursor/decode_cursor`; `app.projects.service.get_project`; the ORM models `Source`, `Job`, `GeoMap`, `Surface`, `PointCloud`; the `project_id`/`handle` fixtures from Task 2.
- Produces (Task 4 and BC's Overview rely on these):
  - `app.data_items.schemas.DataItem` (pydantic): `id: str, type: DataItemType, label: str, captured_on: date | None, status: Literal["importing","ready","failed"], created_at: datetime, summary: dict[str, Any]`
  - `DataItemPage {items: list[DataItem], next_cursor: str | None}`
  - `app.data_items.providers.SortKey(captured_on, created_at, id)` with `.order() -> tuple` and `SortKey.of(item: DataItem) -> SortKey`
  - `encode_key(SortKey) -> str`, `decode_key(str | None) -> SortKey | None` (422 `validation_error` on a bad cursor)
  - `PROVIDERS: dict[str, Provider]`, keyed `image_set`, `map`, `elevation`, `point_cloud`, in that order. Each `Provider` has:
    - `.page(s: Session, after: SortKey | None, limit: int) -> list[DataItem]`
    - `.count(s: Session) -> int`
    - `.search(s: Session, pattern: str, limit: int) -> list[DataItem]` (`pattern` is a ready LIKE pattern with `\` as the escape)
  - `app.data_items.router.router` serving `GET /projects/{projectId}/data`

- [ ] **Step 1: Write the row builders**

Create `backend/tests/data_rows.py`:

```python
"""Rows for the Data list and search tests (plan BK): one builder per data item type, inserted
directly. No file on disk is needed; the Data list reads rows only."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.db.models import GeoMap, Job, PointCloud, Source, Surface

T0 = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)


def at(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


def add_image_set(
    handle,
    *,
    site: str,
    label: str | None = None,
    captured_on: date | None = None,
    created_at: datetime = T0,
    job_state: str | None = "succeeded",
    imported: bool = True,
    kind: str = "images",
    image_count: int = 12,
    duplicate_count: int = 1,
) -> str:
    with handle.session() as s:
        job_id = None
        if job_state is not None:
            job = Job(type="import", state=job_state)
            s.add(job)
            s.flush()
            job_id = job.id
        row = Source(
            folder=f"D:/photos/{site}",
            site=site,
            label=label,
            kind=kind,
            captured_on=captured_on,
            created_at=created_at,
            job_id=job_id,
            imported_at=T0 if imported else None,
            image_count=image_count,
            duplicate_count=duplicate_count,
        )
        s.add(row)
        s.flush()
        return row.id


def add_map(
    handle, *, name: str = "ortho", captured_on: date | None = None, created_at: datetime = T0, status: str = "ready"
) -> str:
    with handle.session() as s:
        row = GeoMap(
            name=name,
            status=status,
            source_path="D:/orthos/site.tif",
            source_size=1,
            width=100,
            height=80,
            gsd_cm=2.5,
            epsg=32633,
            captured_on=captured_on,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def add_cloud(
    handle, *, name: str = "cloud", captured_on: date | None = None, created_at: datetime = T0, status: str = "ready"
) -> str:
    with handle.session() as s:
        row = PointCloud(
            name=name,
            status=status,
            source_path="D:/clouds/site.laz",
            source_size=1,
            point_count=1000,
            has_rgb=True,
            epsg=32633,
            captured_on=captured_on,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def add_surface(
    handle,
    *,
    name: str = "dsm",
    kind: str = "design",
    cloud_id: str | None = None,
    created_at: datetime = T0,
    status: str = "ready",
) -> str:
    with handle.session() as s:
        row = Surface(
            name=name,
            kind=kind,
            status=status,
            point_cloud_id=cloud_id,
            cell_size_m=0.1,
            z_min=1.0,
            z_max=5.0,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_data_items.py`:

```python
"""The Data list (spec 2026-09-26-foundation sections 6.3, 14 and 16): the union of image sets,
maps, elevation and point clouds in one keyset-paged order."""

from datetime import date

import pytest
from data_rows import T0, add_cloud, add_image_set, add_map, add_surface, at
from sqlalchemy import event

from app.data_items.providers import PROVIDERS

BASE = "/api/v1/projects"


def _page(client, pid, **params) -> dict:
    r = client.get(f"{BASE}/{pid}/data", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _all(client, pid, cursor: str | None = None, **params) -> list[dict]:
    """Every item from `cursor` (the start when None) to the end, page by page."""
    items = []
    while True:
        page = _page(client, pid, **params, **({"cursor": cursor} if cursor else {}))
        items += page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            return items


def test_an_empty_project_has_no_data(client, project_id):
    assert _page(client, project_id) == {"items": [], "next_cursor": None}


def test_an_unknown_project_is_404(client):
    assert client.get(f"{BASE}/nope/data").status_code == 404


def test_items_from_every_type_merge_in_one_order(client, handle, project_id):
    newest_set = add_image_set(handle, site="a", captured_on=date(2026, 9, 20), created_at=at(1))
    cloud = add_cloud(handle, captured_on=date(2026, 9, 20), created_at=at(5))
    ortho = add_map(handle, captured_on=date(2026, 9, 10), created_at=at(9))
    dsm = add_surface(handle, kind="cloud_dsm", cloud_id=cloud, created_at=at(2))  # the cloud's date
    design = add_surface(handle, name="design", kind="design", created_at=at(8))  # never dated
    undated_set = add_image_set(handle, site="b", captured_on=None, created_at=at(3))

    items = _page(client, project_id)["items"]

    assert [(i["type"], i["id"]) for i in items] == [
        ("point_cloud", cloud),  # 2026-09-20, created at(5)
        ("elevation", dsm),  # 2026-09-20 from its cloud, at(2)
        ("image_set", newest_set),  # 2026-09-20, at(1)
        ("map", ortho),  # 2026-09-10
        ("elevation", design),  # undated, at(8)
        ("image_set", undated_set),  # undated, at(3)
    ]
    assert items[1]["captured_on"] == "2026-09-20" and items[4]["captured_on"] is None


def test_paging_walks_every_item_once(client, handle, project_id):
    for n in range(4):
        add_map(handle, name=f"m{n}", captured_on=date(2026, 9, n + 1), created_at=at(n))
        add_image_set(handle, site=f"s{n}", captured_on=None, created_at=at(n))
    whole = [i["id"] for i in _page(client, project_id)["items"]]
    paged = [i["id"] for i in _all(client, project_id, limit=3)]
    assert paged == whole and len(set(paged)) == 8


def test_ties_break_by_id_across_a_page_boundary(client, handle, project_id):
    ids = sorted(add_map(handle, name=f"m{n}", captured_on=date(2026, 9, 1), created_at=T0) for n in range(3))
    ids += sorted(add_image_set(handle, site=f"u{n}", created_at=T0) for n in range(2))  # undated: after
    assert [i["id"] for i in _all(client, project_id, limit=1)] == ids


def test_an_item_added_between_pages_neither_repeats_nor_skips(client, handle, project_id):
    for n in range(4):
        add_map(handle, name=f"m{n}", captured_on=date(2026, 9, n + 1), created_at=at(n))
    before = [i["id"] for i in _page(client, project_id)["items"]]
    first = _page(client, project_id, limit=2)
    newest = add_cloud(handle, captured_on=date(2026, 9, 30), created_at=at(20))
    rest = _all(client, project_id, limit=2, cursor=first["next_cursor"])
    assert [i["id"] for i in first["items"]] + [i["id"] for i in rest] == before
    assert _page(client, project_id, limit=1)["items"][0]["id"] == newest


def test_type_filter_restricts_the_providers(client, handle, project_id):
    ortho = add_map(handle)
    dsm = add_surface(handle)
    add_image_set(handle, site="a")
    add_cloud(handle)
    assert [i["id"] for i in _page(client, project_id, type="map")["items"]] == [ortho]
    got = {i["id"] for i in _page(client, project_id, type=["map", "elevation"])["items"]}
    assert got == {ortho, dsm}
    assert _page(client, project_id, type="drawing") == {"items": [], "next_cursor": None}


def test_map_sources_are_not_listed_their_map_is(client, handle, project_id):
    add_image_set(handle, site="ortho-source", kind="map")
    ortho = add_map(handle)
    assert [(i["type"], i["id"]) for i in _page(client, project_id)["items"]] == [("map", ortho)]


@pytest.mark.parametrize(
    ("job_state", "imported", "status"),
    [
        ("running", False, "importing"),
        ("queued", False, "importing"),
        ("running", True, "importing"),  # a re-import in progress
        ("succeeded", True, "ready"),
        ("failed", False, "failed"),
        ("cancelled", False, "failed"),
        ("failed", True, "ready"),  # a failed re-import keeps the images it had
        (None, True, "ready"),
    ],
)
def test_image_set_status_follows_its_import(client, handle, project_id, job_state, imported, status):
    add_image_set(handle, site="a", job_state=job_state, imported=imported)
    assert _page(client, project_id)["items"][0]["status"] == status


def test_a_building_surface_is_importing(client, handle, project_id):
    add_surface(handle, status="building")
    add_map(handle, status="failed")
    add_cloud(handle, status="importing")
    statuses = {i["type"]: i["status"] for i in _page(client, project_id)["items"]}
    assert statuses == {"elevation": "importing", "map": "failed", "point_cloud": "importing"}


def test_labels_and_summaries(client, handle, project_id):
    add_image_set(handle, site="zagreb-north", label=None, created_at=at(1))
    add_image_set(handle, site="x", label="Flight 14 Sep", created_at=at(2))
    add_map(handle, name="Ortho May", created_at=at(3))
    add_surface(handle, name="Design v2", created_at=at(4))
    add_cloud(handle, name="Cloud May", created_at=at(5))
    items = {i["label"]: i for i in _page(client, project_id)["items"]}
    assert set(items) == {"zagreb-north", "Flight 14 Sep", "Ortho May", "Design v2", "Cloud May"}
    assert items["zagreb-north"]["summary"] == {"image_count": 12, "duplicate_count": 1}
    assert items["Ortho May"]["summary"] == {"gsd_cm": 2.5, "epsg": 32633, "width": 100, "height": 80}
    assert items["Design v2"]["summary"] == {"kind": "design", "cell_size_m": 0.1, "z_min": 1.0, "z_max": 5.0}
    assert items["Cloud May"]["summary"] == {"point_count": 1000, "has_rgb": True, "epsg": 32633}


def test_a_malformed_cursor_is_422(client, project_id):
    r = client.get(f"{BASE}/{project_id}/data", params={"cursor": "not-a-cursor"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_count_per_provider(handle):
    add_image_set(handle, site="a")
    add_image_set(handle, site="b", kind="map")
    add_map(handle)
    with handle.session() as s:
        counts = {t: p.count(s) for t, p in PROVIDERS.items()}
    assert counts == {"image_set": 1, "map": 1, "elevation": 0, "point_cloud": 0}


@pytest.mark.parametrize("rows", [1, 25])
def test_a_page_costs_one_statement_per_provider(client, handle, project_id, rows):
    """Spec 14: <= 5 x (limit + 1) indexed rows, one query per provider, whatever the project holds."""
    for n in range(rows):
        add_map(handle, name=f"m{n}", created_at=at(n))
        add_image_set(handle, site=f"s{n}", created_at=at(n))
        add_surface(handle, name=f"d{n}", created_at=at(n))
        add_cloud(handle, name=f"c{n}", created_at=at(n))
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(handle.engine, "before_cursor_execute", record)
    try:
        _page(client, project_id, limit=10)
        full = len(statements)
        statements.clear()
        _page(client, project_id, limit=10, type="map")
        one = len(statements)
    finally:
        event.remove(handle.engine, "before_cursor_execute", record)
    assert (full, one) == (4, 1)
```

- [ ] **Step 3: Run them to verify they fail**

Run: `& $PY -m pytest tests/test_data_items.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.data_items'`.

- [ ] **Step 4: Implement the schemas and providers**

`backend/app/data_items/__init__.py`:
```python
"""The project Data list and search (spec 2026-09-26-foundation sections 6.3 and 10.3)."""
```

`backend/app/data_items/schemas.py`:
```python
"""A data item: a view over one row of a type's own table (spec 2026-09-26-foundation section 6.3,
contract `DataItem`). Nothing is stored for it."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel

DataItemType = Literal["image_set", "map", "elevation", "point_cloud", "drawing"]
DataItemStatus = Literal["importing", "ready", "failed"]


class DataItem(BaseModel):
    id: str
    type: DataItemType
    label: str
    captured_on: date | None
    status: DataItemStatus
    created_at: datetime
    summary: dict[str, Any]


class DataItemPage(BaseModel):
    items: list[DataItem]
    next_cursor: str | None
```

`backend/app/data_items/providers.py`:
```python
"""One provider per data item type (spec 2026-09-26-foundation section 6.3).

Every provider pages its own table in the one Data list order - `captured_on` descending with
undated rows last, then `created_at` descending, then `id` ascending - so their pages merge with a
keyset cursor. A page is one statement per provider, `limit` rows at most. `drawing` has no
provider until unit M adds its table.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.data_items.schemas import DataItem
from app.db.models import GeoMap, Job, PointCloud, Source, Surface
from app.errors import AppError
from app.pagination import decode_cursor, encode_cursor

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
LIVE_JOB_STATES = ("queued", "running")


@dataclass(frozen=True)
class SortKey:
    captured_on: date | None
    created_at: datetime
    id: str

    def order(self) -> tuple:
        """The Python mirror of the SQL order, used to merge provider pages."""
        undated = self.captured_on is None
        day = 0 if undated else -self.captured_on.toordinal()
        micros = (self.created_at - EPOCH) // timedelta(microseconds=1)
        return (undated, day, -micros, self.id)

    @classmethod
    def of(cls, item: DataItem) -> SortKey:
        return cls(item.captured_on, item.created_at, item.id)


def encode_key(key: SortKey) -> str:
    return encode_cursor(
        captured_on=key.captured_on.isoformat() if key.captured_on else None,
        created_at=key.created_at.isoformat(),
        id=key.id,
    )


def decode_key(cursor: str | None) -> SortKey | None:
    c = decode_cursor(cursor, "captured_on", "created_at", "id")
    if not c:
        return None
    try:
        day = date.fromisoformat(c["captured_on"]) if c["captured_on"] is not None else None
        created = datetime.fromisoformat(str(c["created_at"]))
    except (TypeError, ValueError):
        raise AppError("validation_error", "invalid cursor", 422) from None
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return SortKey(day, created, str(c["id"]))


def _after(captured, created, id_col, key: SortKey):
    """Rows strictly after `key` in the Data list order."""
    tail = or_(created < key.created_at, and_(created == key.created_at, id_col > key.id))
    if key.captured_on is None:
        return and_(captured.is_(None), tail)
    return or_(captured.is_(None), captured < key.captured_on, and_(captured == key.captured_on, tail))


class _Provider:
    """Shared paging and search; a subclass names its columns, its select and its item."""

    type: str

    def columns(self):
        """(captured_on, created_at, id, label) column expressions."""
        raise NotImplementedError

    def base(self):
        raise NotImplementedError

    def count_query(self):
        raise NotImplementedError

    def item(self, row) -> DataItem:
        raise NotImplementedError

    def _run(self, s: Session, q, limit: int) -> list[DataItem]:
        captured, created, id_col, _ = self.columns()
        q = q.order_by(captured.is_(None), captured.desc(), created.desc(), id_col.asc()).limit(limit)
        return [self.item(row) for row in s.execute(q).all()]

    def page(self, s: Session, after: SortKey | None, limit: int) -> list[DataItem]:
        captured, created, id_col, _ = self.columns()
        q = self.base()
        if after is not None:
            q = q.where(_after(captured, created, id_col, after))
        return self._run(s, q, limit)

    def search(self, s: Session, pattern: str, limit: int) -> list[DataItem]:
        label = self.columns()[3]
        return self._run(s, self.base().where(label.ilike(pattern, escape="\\")), limit)

    def count(self, s: Session) -> int:
        return s.execute(self.count_query()).scalar_one()


def image_set_status(job_state: str | None, imported_at: datetime | None) -> str:
    if job_state in LIVE_JOB_STATES:
        return "importing"
    return "ready" if imported_at is not None else "failed"


class ImageSets(_Provider):
    type = "image_set"
    _is_images = func.coalesce(Source.kind, "images") == "images"

    def columns(self):
        label = func.coalesce(func.nullif(Source.label, ""), Source.site)
        return Source.captured_on, Source.created_at, Source.id, label

    def base(self):
        return select(Source, Job.state).outerjoin(Job, Job.id == Source.job_id).where(self._is_images)

    def count_query(self):
        return select(func.count()).select_from(Source).where(self._is_images)

    def item(self, row) -> DataItem:
        src, job_state = row
        return DataItem(
            id=src.id,
            type="image_set",
            label=src.label or src.site,
            captured_on=src.captured_on,
            status=image_set_status(job_state, src.imported_at),
            created_at=src.created_at,
            summary={"image_count": src.image_count, "duplicate_count": src.duplicate_count},
        )


class Maps(_Provider):
    type = "map"

    def columns(self):
        return GeoMap.captured_on, GeoMap.created_at, GeoMap.id, GeoMap.name

    def base(self):
        return select(GeoMap)

    def count_query(self):
        return select(func.count()).select_from(GeoMap)

    def item(self, row) -> DataItem:
        (m,) = row
        return DataItem(
            id=m.id,
            type="map",
            label=m.name,
            captured_on=m.captured_on,
            status=m.status,
            created_at=m.created_at,
            summary={"gsd_cm": m.gsd_cm, "epsg": m.epsg, "width": m.width, "height": m.height},
        )


class Elevations(_Provider):
    """Surfaces: a cloud DSM is dated by its cloud, a design surface is never dated."""

    type = "elevation"
    _day = case((Surface.kind == "cloud_dsm", PointCloud.captured_on), else_=None)

    def columns(self):
        return self._day, Surface.created_at, Surface.id, Surface.name

    def base(self):
        return select(Surface, self._day.label("day")).outerjoin(
            PointCloud, PointCloud.id == Surface.point_cloud_id
        )

    def count_query(self):
        return select(func.count()).select_from(Surface)

    def item(self, row) -> DataItem:
        surface, day = row
        return DataItem(
            id=surface.id,
            type="elevation",
            label=surface.name,
            captured_on=day,
            status="importing" if surface.status == "building" else surface.status,
            created_at=surface.created_at,
            summary={
                "kind": surface.kind,
                "cell_size_m": surface.cell_size_m,
                "z_min": surface.z_min,
                "z_max": surface.z_max,
            },
        )


class PointClouds(_Provider):
    type = "point_cloud"

    def columns(self):
        return PointCloud.captured_on, PointCloud.created_at, PointCloud.id, PointCloud.name

    def base(self):
        return select(PointCloud)

    def count_query(self):
        return select(func.count()).select_from(PointCloud)

    def item(self, row) -> DataItem:
        (c,) = row
        return DataItem(
            id=c.id,
            type="point_cloud",
            label=c.name,
            captured_on=c.captured_on,
            status=c.status,
            created_at=c.created_at,
            summary={"point_count": c.point_count, "has_rgb": c.has_rgb, "epsg": c.epsg},
        )


PROVIDERS: dict[str, _Provider] = {
    p.type: p for p in (ImageSets(), Maps(), Elevations(), PointClouds())
}


def merge(pages: list[list[DataItem]], limit: int) -> tuple[list[DataItem], SortKey | None]:
    """The first `limit` items of the merged pages, and the key to continue after (None at the end)."""
    items = sorted((i for page in pages for i in page), key=lambda i: SortKey.of(i).order())
    if len(items) <= limit:
        return items, None
    items = items[:limit]
    return items, SortKey.of(items[-1])
```

If the `case(...)` result comes back as a string rather than a `date` (it did not while planning this, but SQLite typing through `CASE` depends on the SQLAlchemy version), add `type_=Date` to `case` (`from sqlalchemy import Date`) and rerun the merge test.

- [ ] **Step 5: Implement the router and include it**

`backend/app/data_items/router.py`:
```python
"""`GET /projects/{id}/data`: every data item of a project, newest capture first (spec
2026-09-26-foundation section 6.3). Bounded: one statement per provider, `limit + 1` rows each."""

from fastapi import APIRouter, Depends, Query

from app.data_items.providers import PROVIDERS, decode_key, encode_key, merge
from app.data_items.schemas import DataItemPage, DataItemType
from app.pagination import clamp_limit
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["data"])


@router.get("/data", response_model=DataItemPage)
def list_data(
    handle: ProjectHandle = Depends(get_project),
    type: list[DataItemType] | None = Query(None),  # noqa: A002 - the contract's parameter name
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
) -> DataItemPage:
    n = clamp_limit(limit)
    after = decode_key(cursor)
    chosen = [p for t, p in PROVIDERS.items() if not type or t in type]
    with handle.session() as s:
        pages = [p.page(s, after, n + 1) for p in chosen]
    items, last = merge(pages, n)
    return DataItemPage(items=items, next_cursor=encode_key(last) if last else None)
```
Ruff's `A` rules are not enabled (`select = ["E", "F", "I", "B", "UP"]`). If ruff reports the `noqa` as unused (`RUF100` is not enabled either), leave it.

In `backend/app/api.py`, add the import `from app.data_items.router import router as data_router` in sorted position, and add `data_router,` to the plain `for r in (...)` tuple after `projects_router,`.

If Task 0 Step 4 (a) found a stub tuple for this operation, delete it from C0's `STUBS`. Also delete its operationId from `EXPECTED_STUBS` in `tests/test_contract.py`.

- [ ] **Step 6: Run the tests**

Run: `& $PY -m pytest tests/test_data_items.py -v`
Expected: PASS, 22 passed.

Run: `& $PY -m pytest tests/test_contract.py -q`
Expected: PASS. `test_responses_conform[GET /projects/{projectId}/data]` validates against C0's `DataItem`. A schema mismatch here means a field name differs from C0's. Fix the field (Task 0 table) and rerun.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/data_items/__init__.py backend/app/data_items/schemas.py backend/app/data_items/providers.py backend/app/data_items/router.py backend/app/api.py backend/tests/data_rows.py backend/tests/test_data_items.py backend/tests/test_contract.py
git commit -m "feat(backend): the project Data list - image sets, maps, elevation and clouds in one keyset page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
Also add C0's stub module by path if Step 5 edited it.

---

### Task 4: Search, `GET /projects/{id}/search`

**Files:**
- Create: `backend/app/data_items/search.py`
- Modify: `backend/app/api.py` (include the router)
- Create: `backend/tests/test_search.py`
- Modify: `backend/tests/test_contract.py` (stub entry, if any)

**Interfaces:**
- Consumes: `PROVIDERS`, `SortKey`, `merge`, `DataItem` (Task 3).
- Produces:
  - `app.data_items.search.router` serving `GET /projects/{projectId}/search?q=&limit=`
  - `register_finding_search(fn: Callable[[Session, str, int], list[dict]] | None) -> None`. **BC** calls it once on import of its findings module. `fn(session, q, limit)` receives the trimmed query text (not a LIKE pattern) and returns at most `limit` findings as dicts in the contract's `Finding` shape.
  - `like_pattern(q: str) -> str` (reusable by BC)
  - `MIN_QUERY = 2`, `DEFAULT_LIMIT = 8`, `MAX_LIMIT = 20`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_search.py`:

```python
"""In-project search for the command palette (spec 2026-09-26-foundation sections 5.4 and 10.3)."""

import re

from data_rows import add_cloud, add_image_set, add_map, at
from sqlalchemy import event

from app.data_items import search

BASE = "/api/v1/projects"


def _search(client, pid, **params) -> dict:
    r = client.get(f"{BASE}/{pid}/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_data_labels_match_case_insensitively_across_types(client, handle, project_id):
    s1 = add_image_set(handle, site="x", label="North pit flight", created_at=at(1))
    m1 = add_map(handle, name="north pit ortho", created_at=at(2))
    add_cloud(handle, name="South cloud", created_at=at(3))
    got = _search(client, project_id, q="NORTH PIT")
    assert {d["id"] for d in got["data"]} == {s1, m1}
    assert got["findings"] == []


def test_the_site_is_the_label_of_an_unlabelled_image_set(client, handle, project_id):
    sid = add_image_set(handle, site="zagreb-east", label=None)
    assert [d["id"] for d in _search(client, project_id, q="zagreb")["data"]] == [sid]


def test_like_wildcards_in_the_query_match_literally(client, handle, project_id):
    exact = add_map(handle, name="ZG_04 50% done", created_at=at(1))
    add_map(handle, name="ZGx04 500 done", created_at=at(2))
    add_map(handle, name="back\\slash", created_at=at(3))
    assert [d["id"] for d in _search(client, project_id, q="ZG_04")["data"]] == [exact]
    assert [d["id"] for d in _search(client, project_id, q="50%")["data"]] == [exact]
    assert [d["label"] for d in _search(client, project_id, q="k\\s")["data"]] == ["back\\slash"]


def test_a_query_under_two_characters_returns_nothing(client, handle, project_id):
    add_map(handle, name="a")
    assert _search(client, project_id, q="a") == {"findings": [], "data": []}
    assert _search(client, project_id, q="  a  ") == {"findings": [], "data": []}
    assert _search(client, project_id) == {"findings": [], "data": []}


def test_each_group_is_limited(client, handle, project_id):
    for n in range(10):
        add_map(handle, name=f"Flight {n}", created_at=at(n))
        add_image_set(handle, site=f"s{n}", label=f"Flight set {n}", created_at=at(n))
    assert len(_search(client, project_id, q="flight")["data"]) == 8
    assert len(_search(client, project_id, q="flight", limit=3)["data"]) == 3
    assert len(_search(client, project_id, q="flight", limit=500)["data"]) == search.MAX_LIMIT


def test_search_never_reads_images(client, handle, project_id):
    add_image_set(handle, site="north")
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(handle.engine, "before_cursor_execute", record)
    try:
        _search(client, project_id, q="north")
    finally:
        event.remove(handle.engine, "before_cursor_execute", record)
    assert statements and not any(re.search(r"\b(FROM|JOIN)\s+image\b", st) for st in statements)


def test_findings_come_from_the_registered_search(client, handle, project_id, monkeypatch):
    monkeypatch.setattr(search, "_finding_search", None)
    seen = []

    def fake(session, q, limit):
        seen.append((q, limit))
        return [{"id": f"f{n}"} for n in range(limit + 5)]

    search.register_finding_search(fake)
    got = _search(client, project_id, q="  crack ", limit=4)
    assert seen == [("crack", 4)]
    assert [f["id"] for f in got["findings"]] == ["f0", "f1", "f2", "f3"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& $PY -m pytest tests/test_search.py -v`
Expected: FAIL at collection with `ImportError: cannot import name 'search' from 'app.data_items'`.

- [ ] **Step 3: Implement**

`backend/app/data_items/search.py`:
```python
"""`GET /projects/{id}/search` (spec 2026-09-26-foundation section 10.3): the command palette's
in-project search.

Two groups, each at most `limit` rows. Data items match on their label through the Data list
providers. Findings come from the search the findings module registers (unit BC); until then that
group is empty. Neither group reads the image table.
"""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.data_items.providers import PROVIDERS, merge
from app.data_items.schemas import DataItem
from app.projects.service import ProjectHandle, get_project

MIN_QUERY = 2
DEFAULT_LIMIT = 8
MAX_LIMIT = 20

FindingSearch = Callable[[Session, str, int], list[dict[str, Any]]]
_finding_search: FindingSearch | None = None


def register_finding_search(fn: FindingSearch | None) -> None:
    """Called by the findings module on import: `fn(session, q, limit)` gets the trimmed query and
    returns at most `limit` findings in the contract's `Finding` shape. None unregisters."""
    global _finding_search
    _finding_search = fn


def like_pattern(q: str) -> str:
    """`q` as a LIKE pattern matched anywhere, with `\\`, `%` and `_` taken literally (ESCAPE '\\')."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class SearchResult(BaseModel):
    findings: list[dict[str, Any]]
    data: list[DataItem]


router = APIRouter(prefix="/projects/{projectId}", tags=["data"])


@router.get("/search", response_model=SearchResult)
def search_project(
    handle: ProjectHandle = Depends(get_project),
    q: str = Query("", max_length=200),
    limit: int = Query(DEFAULT_LIMIT, ge=1),
) -> SearchResult:
    text = q.strip()
    if len(text) < MIN_QUERY:
        return SearchResult(findings=[], data=[])
    n = min(limit, MAX_LIMIT)
    pattern = like_pattern(text)
    with handle.session() as s:
        pages = [p.search(s, pattern, n) for p in PROVIDERS.values()]
        findings = _finding_search(s, text, n)[:n] if _finding_search is not None else []
    data, _ = merge(pages, n)
    return SearchResult(findings=findings, data=data)
```

In `backend/app/api.py`, add `from app.data_items.search import router as search_router` in sorted position, and add `search_router,` to the plain tuple after `data_router,`. Remove C0's stub tuple and `EXPECTED_STUBS` entry for this operation if Task 0 found them.

If C0 declared `q` with `minLength` or `maxLength`, keep `max_length=200` only if C0's `maxLength` is ≥ 200. Otherwise use C0's value.

- [ ] **Step 4: Run the tests**

Run: `& $PY -m pytest tests/test_search.py tests/test_contract.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/data_items/search.py backend/app/api.py backend/tests/test_search.py backend/tests/test_contract.py
git commit -m "feat(backend): in-project search over data items, with a seam for findings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: App-wide jobs, `GET /api/v1/jobs`

**Files:**
- Create: `backend/app/jobs/app_router.py`
- Modify: `backend/app/projects/service.py` (`ProjectRegistry.open_recent`)
- Modify: `backend/app/api.py` (include the router)
- Create: `backend/tests/test_app_jobs.py`
- Modify: `backend/tests/test_contract.py` (stub entry, if any)

**Interfaces:**
- Consumes: `JobOut` (`app/jobs/schemas.py`); `LibraryHandle` (`app.state.library`, may be None); `ProjectRegistry` (`app.state.projects`); `new_project` (Task 2).
- Produces:
  - `ProjectRegistry.open_recent() -> list[ProjectHandle]` (recent-list order, open only)
  - `app.jobs.app_router.AppJob(JobOut)` with `project_name: str | None`
  - `AppJobPage {items: list[AppJob], next_cursor: str | None}`
  - `router` serving `GET /api/v1/jobs?state=&type=&project_id=&limit=&cursor=`
  - Library jobs keep `project_id = "library"`, as `/library/jobs` returns them, and have `project_name = null`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_app_jobs.py`:

```python
"""Every job in the app (spec 2026-09-26-foundation sections 10.1 and 16): the library runner's and
every open recent project's, merged newest first."""

from data_rows import at
from project_factory import new_project

from app.db.models import Job

JOBS = "/api/v1/jobs"


def _add(handle, type_: str, state: str, minutes: int) -> str:
    with handle.session() as s:
        job = Job(type=type_, state=state, created_at=at(minutes))
        s.add(job)
        s.flush()
        return job.id


def _page(client, **params) -> dict:
    r = client.get(JOBS, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _all(client, **params) -> list[dict]:
    items, cursor = [], None
    while True:
        page = _page(client, **params, **({"cursor": cursor} if cursor else {}))
        items += page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            return items


def _two_projects(app, client, tmp_path):
    a = new_project(client, tmp_path / "a", name="Quarry")
    b = new_project(client, tmp_path / "b", name="Bridge")
    reg = app.state.projects
    return reg.get(a["id"]), reg.get(b["id"])


def test_jobs_merge_across_the_library_and_open_projects(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    j1 = _add(ha, "import", "succeeded", 1)
    j2 = _add(app.state.library, "library_import", "succeeded", 2)
    j3 = _add(hb, "map_import", "running", 3)
    j4 = _add(ha, "infer", "failed", 4)
    items = _page(client)["items"]
    assert [(j["id"], j["project_id"], j["project_name"]) for j in items] == [
        (j4, ha.id, "Quarry"),
        (j3, hb.id, "Bridge"),
        (j2, "library", None),
        (j1, ha.id, "Quarry"),
    ]


def test_paging_walks_every_job_once(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    ids = [_add(h, "import", "succeeded", n) for n, h in enumerate([ha, hb, app.state.library] * 3)]
    assert [j["id"] for j in _all(client, limit=2)] == list(reversed(ids))


def test_filters(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    running = _add(ha, "import", "running", 1)
    queued = _add(hb, "train", "queued", 2)
    _add(hb, "import", "failed", 3)
    lib = _add(app.state.library, "library_import", "succeeded", 4)
    assert {j["id"] for j in _page(client, state=["running", "queued"])["items"]} == {running, queued}
    assert [j["id"] for j in _page(client, type="train")["items"]] == [queued]
    assert [j["id"] for j in _page(client, project_id=ha.id)["items"]] == [running]
    assert [j["id"] for j in _page(client, project_id="library")["items"]] == [lib]
    assert _page(client, project_id="no-such-project") == {"items": [], "next_cursor": None}


def test_a_recent_project_that_is_not_open_is_not_read(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    kept = _add(ha, "import", "succeeded", 1)
    _add(hb, "import", "succeeded", 2)
    app.state.projects._handles.pop(hb.id)
    hb.engine.dispose()
    assert [j["id"] for j in _page(client)["items"]] == [kept]


def test_no_library_still_lists_project_jobs(app, client, tmp_path):
    ha, _ = _two_projects(app, client, tmp_path)
    job = _add(ha, "import", "succeeded", 1)
    app.state.library = None
    assert [j["id"] for j in _page(client)["items"]] == [job]
    assert _page(client, project_id="library")["items"] == []


def test_a_failing_source_is_left_out(app, client, tmp_path, monkeypatch, caplog):
    ha, hb = _two_projects(app, client, tmp_path)
    kept = _add(ha, "import", "succeeded", 1)
    _add(hb, "import", "succeeded", 2)

    def broken():
        raise RuntimeError("disk gone")

    monkeypatch.setattr(hb, "session", broken)
    assert [j["id"] for j in _page(client)["items"]] == [kept]
    assert "disk gone" in caplog.text


def test_a_malformed_cursor_is_422(client):
    r = client.get(JOBS, params={"cursor": "nope"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_open_recent_keeps_recent_order_and_skips_closed(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)  # b was created last: first in the recent list
    assert [h.id for h in app.state.projects.open_recent()] == [hb.id, ha.id]
    app.state.projects._handles.pop(ha.id)
    ha.engine.dispose()
    assert [h.id for h in app.state.projects.open_recent()] == [hb.id]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& $PY -m pytest tests/test_app_jobs.py -v`
Expected: FAIL. The endpoint tests get `404` (`assert 404 == 200`), or C0's stub `501` if Task 0 found one. `test_open_recent_...` fails with `AttributeError: 'ProjectRegistry' object has no attribute 'open_recent'`.

- [ ] **Step 3: Implement**

In `backend/app/projects/service.py`, add to `ProjectRegistry` after `recent()`:
```python
    def open_recent(self) -> list[ProjectHandle]:
        """The recent projects open in this process, in recent-list order (at most MAX_RECENT).
        Only an open project can have a live job; opening one sweeps its orphans."""
        ids = [r["id"] for r in self.appdata.recent()]
        with self._lock:
            return [self._handles[i] for i in ids if i in self._handles]
```

`backend/app/jobs/app_router.py`:
```python
"""`GET /api/v1/jobs` (spec 2026-09-26-foundation section 10.1): every job in the app, newest first.

The sources are the library runner's jobs and the jobs of every recent project open in this
process. Each source answers `limit + 1` rows in `(created_at desc, id desc)` order through
`ix_job_created`, and the pages are merged: a page costs at most 1 + MAX_RECENT small queries. A
source that fails is logged and left out; it never fails the list. Cancel and log stay on the
per-project and `/library/jobs` routes, chosen by `project_id`.
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, tuple_

from app.db.models import Job
from app.errors import AppError
from app.jobs.schemas import JobOut
from app.pagination import clamp_limit, decode_cursor, encode_cursor

log = logging.getLogger(__name__)
LIBRARY = "library"

router = APIRouter(prefix="/jobs", tags=["jobs"])


class AppJob(JobOut):
    project_name: str | None


class AppJobPage(BaseModel):
    items: list[AppJob]
    next_cursor: str | None


def _after(cursor: str | None) -> tuple[datetime, str] | None:
    c = decode_cursor(cursor, "created_at", "id")
    if not c:
        return None
    try:
        at = datetime.fromisoformat(str(c["created_at"]))
    except ValueError:
        raise AppError("validation_error", "invalid cursor", 422) from None
    return (at if at.tzinfo else at.replace(tzinfo=UTC)), str(c["id"])


def _sources(request: Request, project_id: str | None) -> list:
    registry = request.app.state.projects
    library = getattr(request.app.state, "library", None)
    if project_id == LIBRARY:
        return [library] if library is not None else []
    if project_id is not None:
        try:
            return [registry.get(project_id)]
        except AppError:  # not a known project: an empty page, not an error
            return []
        except Exception:
            log.exception("could not open project %s for the jobs list", project_id)
            return []
    return ([library] if library is not None else []) + registry.open_recent()


def _read(handle, state, type_, after, n: int) -> list[AppJob]:
    q = select(Job).order_by(Job.created_at.desc(), Job.id.desc())
    if state:
        q = q.where(Job.state.in_(state))
    if type_:
        q = q.where(Job.type.in_(type_))
    if after is not None:
        q = q.where(tuple_(Job.created_at, Job.id) < after)
    with handle.session() as s:
        rows = list(s.execute(q.limit(n)).scalars())
        for r in rows:
            s.expunge(r)
        name = None if handle.id == LIBRARY or not rows else handle.row(s).name
    return [AppJob(**JobOut.from_row(r, handle.id).model_dump(), project_name=name) for r in rows]


@router.get("", response_model=AppJobPage)
def list_app_jobs(
    request: Request,
    state: list[str] | None = Query(None),
    type: list[str] | None = Query(None),  # noqa: A002 - the contract's parameter name
    project_id: str | None = None,
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
) -> AppJobPage:
    n = clamp_limit(limit)
    after = _after(cursor)
    items: list[AppJob] = []
    for handle in _sources(request, project_id):
        try:
            items += _read(handle, state, type, after, n + 1)
        except Exception:
            log.exception("jobs of %s could not be read; left out of the jobs list", handle.id)
    items.sort(key=lambda j: (j.created_at, j.id), reverse=True)
    next_cursor = None
    if len(items) > n:
        items = items[:n]
        next_cursor = encode_cursor(created_at=items[-1].created_at.isoformat(), id=items[-1].id)
    return AppJobPage(items=items, next_cursor=next_cursor)
```

In `backend/app/api.py`, add `from app.jobs.app_router import router as app_jobs_router` in sorted position, and add `app_jobs_router,` to the plain tuple after `jobs_router,`. Remove C0's stub tuple and `EXPECTED_STUBS` entry for this operation if Task 0 found them.

- [ ] **Step 4: Run the tests**

Run: `& $PY -m pytest tests/test_app_jobs.py tests/test_contract.py tests/test_jobs.py tests/test_library_jobs.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/jobs/app_router.py backend/app/projects/service.py backend/app/api.py backend/tests/test_app_jobs.py backend/tests/test_contract.py
git commit -m "feat(backend): GET /jobs lists the library's and every open project's jobs in one page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verify, gate and hand off

**Files:** none new. This task runs only verification commands, unless a gate step fails.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: a green `task/f-bk`, ready for its merge slot (first in batch 2).

- [ ] **Step 1: The no-kind check outside the test**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-bk
Select-String -Path backend\app\*.py,backend\app\*\*.py,backend\app\*\*\*.py -Pattern "require_kind|project_kind|wrong_project_kind|ProjectKind|training project|detection project|kinds import"
```
Expected: no output. A remaining "training project" or "detection project" phrase in a docstring is prose left over from the split. Reword it to "project" and rerun.

- [ ] **Step 2: Rebase on `main` and run the whole gate**

```powershell
git fetch . main:main 2>$null; git rebase main
pnpm -C contract check
cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
if (Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```
Expected: every step passes. BK touches no frontend or contract file, so a frontend or contract failure there is pre-existing on `main`. Stop and report it rather than fixing it here.

- [ ] **Step 3: Merge in BK's slot**

When the coordinator gives BK its merge slot (first in batch 2), run `scripts\finish-task.ps1` from the worktree. It gates again, merges `task/f-bk` into `main`, removes the worktree and deletes the branch. Never use `-SkipGate`.

- [ ] **Step 4: Operator walkthrough (post with the merge)**

BK is not visible in the UI. The screens that use it arrive with SH, S1 and S2, and until SH merges, no installer is built from `main`. For the reviewer:
1. `cd backend; & $PY -m pytest tests/test_no_project_kind.py -v`: no guard, no kind, and an old create body is still accepted.
2. `& $PY -m pytest tests/test_data_items.py tests/test_search.py -v`: the Data list order, paging, filters, statuses, the statement budget, literal search and "never reads images".
3. `& $PY -m pytest tests/test_app_jobs.py -v`: library and project jobs in one page, filters, and a failing source left out.

- [ ] **Step 5: Report to the coordinator**

Send:
- the merged commit range
- the Task 0 names table as confirmed
- the hand-offs:
  - **BC** must make `ProjectRegistry.create` write `type_ids` into `project_type`, call `register_finding_search` from its findings module, and update `tests/project_factory.py::new_project` to use types.
  - **BM** deletes `/projects/{id}/datasets*` and `/train`.
  - **SH** deletes the frontend kind code, which reads `kind` from a backend that no longer sends it.
- the ambiguities resolved in this plan's "Spec ambiguities resolved while planning" section.
