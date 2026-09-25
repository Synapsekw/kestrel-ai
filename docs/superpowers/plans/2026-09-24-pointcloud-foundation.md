# Point-cloud Foundation (F0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the shared foundation F0 of the point-cloud (S1), volumes (S2) and design-surface (S3) specs on `main` — the whole contract, the one migration, the job types, the stubbed routes, the startup wiring, the dependency pins, the navigation and the test helpers — so the three specs can then be built in parallel worktrees without ever editing the same shared file.

**Architecture:** F0 writes every path and schema of S1 §4, S2 §11 and S3 §12 into `contract/openapi.yaml` and routes all 37 operations as 501 stubs through `app/stubs.py`, behind the project-kind guard. One Alembic revision creates `point_cloud`, `cloud_measurement`, `surface` and `volume_measurement`. Four new backend packages get a stub router, stub job modules (each fails with "not implemented") and a no-op startup sweep wired into `project_opened`. The frontend gets the viewer dependencies, the six new job types in every exhaustive job-type map, two icons, three lazy-loaded empty screens, two nav entries and an About link. Test helpers write tiny LAS/LAZ files and a real minimal Potree 2.0 octree, and the `app` fixture swaps PotreeConverter for an offline fake from day one.

**Tech Stack:** FastAPI, SQLAlchemy + Alembic (SQLite), the existing JobRunner, laspy 2.7.0 + lazrs 0.8.2, pytest + schemathesis; React 18 + react-router 6 (lazy routes), openapi-typescript, vitest, Playwright against the Prism mock; potree-core 2.0.15 + three 0.180.0 (installed, not yet imported).

**Spec:** `docs/superpowers/specs/2026-09-23-point-clouds-design.md` §5 (F0) and §15.3, with the contract surfaces of `docs/superpowers/specs/2026-09-23-volumes-design.md` §11 and `docs/superpowers/specs/2026-09-23-design-surfaces-design.md` §12. Executors read the spec sections their task names.

## Global Constraints

- `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts` is regenerated (`pnpm -C contract generate`) and committed in the same commit, never hand-edited.
- Every schema has exactly one owner and one definition: `Surface`, `SurfaceWithJob`, `SurfaceKind`, `SurfaceMethod`, `SurfaceBuildMethod` are S2's; `DesignSource` is S3's and `Surface.design_source` references it.
- Path parameters are `components/parameters`, one owner per name: `cloudId`, `cloudMeasurementId`, `octreeFile` (S1); `surfaceId`, `measurementId` (S2, which reuses the inline `z`/`x`/`y` exactly as `getMapTile` declares them); `inspectionId`, `previewId`, `candidateId` (S3).
- Tags: `pointclouds` (S1), `surfaces` (S2 paths 1–8 and every S3 path), `volumes` (S2 paths 9–17).
- Request properties carry no `default:`; defaults go in descriptions (ADR `2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript`).
- `JobType` gains exactly `pointcloud_import`, `pointcloud_export`, `surface_build`, `volume_calc`, `volume_export`, `design_import`. The `Event` enum gains `pointclouds.changed {cloud_ids}`, `surfaces.changed {surface_ids}`, `volumes.changed {measurement_ids}`.
- Every new operation answers 501 `not_implemented` through `app/stubs.py`, and its operationId is in `tests/test_contract.py::EXPECTED_STUBS`. Each later unit that builds one removes it from both.
- F0 also adds the **one** contract-test allowance for deliberate refusals, `tests/test_contract.py::REFUSES_VALID_DATA: dict[str, set[int]] = {}` (operationId → the statuses a schema-valid request may legitimately get, e.g. `{416}` or `{422}`). For those responses only schemathesis's positive-data-acceptance check is skipped, every conformance check still runs, and the error code must not be `validation_error`; a guard test requires each listed status to be declared for that operation in `openapi.yaml`. S1, S2 and S3 only **add entries**; none defines another mechanism.
- **One** Alembic revision holds every table, column, FK and index of S1–S3. Its id is the next after `main`'s head at build time: `main` is at `0008` today, so it is `0009` (not the spec's "after 0006"; see Deviations). No later S1–S3 unit adds a migration.
- The app must start even when startup work fails: each new router is included inside its own guard, and each new startup sweep runs in its own `try` step of `project_opened` and is imported inside that step.
- Python pins (exact): `laspy==2.7.0`, `lazrs==0.8.2`, `scipy==1.17.1`, `shapely==2.1.2`, `psutil==7.2.2`, `reportlab==5.0.1` (already pinned on `main`), `openpyxl==3.1.5`, `ezdxf==1.4.4`; the lock also gains `et-xmlfile==2.0.0` (openpyxl's). The ML stack pins are not touched.
- Frontend pins (exact, with the lockfile): `potree-core` `2.0.15`, `three` `0.180.0`, `@types/three` `0.180.0`.
- **The shared interpreter `E:\Dev\Yolo\app\backend\.venv` gets exactly one change, additive, in Task 10 Step 3** (operator decision: "additive install"): the five new packages at their pins with `--no-deps`, nothing upgraded or removed. Nothing else is ever installed into it. During development Task 1 builds a worktree-local overlay venv at `<worktree>\backend\.venv` (a real folder, no links; the shared site-packages are read through one `.pth` file). Every backend command runs from `backend/` in the worktree as `$PY = .\.venv\Scripts\python.exe`, which makes the AGENTS.md gate lines work verbatim. Never `rm -rf` a worktree (memory rule: links as links, then `git worktree remove`).
- Job labels, one per new type, in all eight exhaustive places (the six `Record<Job["type"], …>` maps plus the `resultTarget` and `jobToastText` switches):

  | Job type | Label | Verb (TYPE_VERB) | Icon |
  | --- | --- | --- | --- |
  | `pointcloud_import` | Point cloud import | Importing a point cloud | `cloud` |
  | `pointcloud_export` | Point cloud export | Exporting a point cloud | `cloud` |
  | `surface_build` | Build surface | Building a surface | `volume` |
  | `volume_calc` | Calculate volume | Calculating a volume | `volume` |
  | `volume_export` | Export volumes | Exporting volumes | `volume` |
  | `design_import` | Design surface import | Importing a design surface | `volume` |

- Header titles: "Point clouds" (`/p/:id/clouds…`), "Volumes" (`/p/:id/volumes…`), "About" (`/about`). The Clouds, Volumes and About screens are lazy-loaded.
- UI uses only the `frontend/src/ui/` primitives and tokens; `node scripts/check-tokens.mjs` (inside `pnpm -C frontend lint`) must pass. DESIGN.md is the design system; load the design skills before Task 9.
- Stage by path, never `git add -A`. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Deviations from the spec, decided while planning (recorded so reviewers don't flag them)

1. **Migration id `0009`, not "after 0006".** The spec was written when `main`'s head was `0006_map_captured_on`; `main` is at `0008_detect_workspace` now. The rule (next after `main`'s head, re-checked across every branch before merge) is kept; Task 10 re-checks it.
2. **Project kind.** The specs do not say which project kind the new routes serve; every route under `/projects/{projectId}` must declare one (`tests/test_project_kinds.py`). F0 includes all four routers with `require_kind(("detect",), ANY_KIND)`, exactly like the maps routes: detection projects create and change clouds, surfaces, volumes and designs; any project may read them (a training project simply has none). The screens are `KindRoute` detection-only.
3. **Sidebar placement.** The spec's "Maps → Point clouds → Volumes → Surveys" predates the detection workspace: `main` has no Maps or Surveys entries any more (maps are Sources; the survey timeline is inside Analytics). F0 keeps the spec's relative order and puts **Point clouds, then Volumes** below the divider of a detection project, right after Site areas. Training projects show neither.
4. **Eight job-type places, not six.** Besides the six `Record<Job["type"], …>` maps, `jobLabels.ts::resultTarget` and `useJobToasts.ts::jobToastText` are exhaustive `switch`es without a default; TypeScript fails the build unless they gain the six cases too. `resultTarget` links cloud jobs to `/p/:id/clouds` and surface/volume/design jobs to `/p/:id/volumes`.
5. **`cloudOctreeUrl(baseUrl, projectId, cloudId)`.** The spec writes `cloudOctreeUrl(projectId, cloudId)`; like every other helper it needs the base URL. It returns the URL **without** a token: the viewer's potree-core `RequestManager.getUrl` appends `?token=` (spec §7).
6. **`ConverterResult` fields.** The spec names the type only. F0 fixes `octree_dir: Path`, `log_tail: list[str]`, `command: list[str]`, `seconds: float`, plus the two S1 needs, with defaults: `encoding: str = "BROTLI"` (what `metadata.json` must say; S1 plan decision 2 — the fake reports `"DEFAULT"`, the encoding `write_fake_octree` writes) and `version: str = "2.1.5"` (the converter version for `source.json`). Unit I1 builds the runner in the same module and keeps this dataclass exactly; no later task edits it.
7. **Packaging lines.** `kestrel_backend.spec` gets `collect_submodules("laspy")` and the hidden import `lazrs`. The S2 and S3 packaging sections name no spec lines of their own (S2 V6 and S3 U3 verify the frozen bundle and add hidden imports with an ADR if needed), so F0 adds none for them. F0 does not run `build.ps1`; K1/K2 do.
8. **Venv.** CONTRIBUTING says a worktree has no venv of its own. F0 adds Python packages, so during development it uses an overlay venv (Task 1) that leaves the shared interpreter untouched while other worktrees test with it, and records that as an ADR plus a CONTRIBUTING note. At landing the operator chose the **additive install**: Task 10 Step 3 installs exactly the five new packages (laspy, lazrs, ezdxf, openpyxl, et-xmlfile at their pins, `--no-deps`) into the shared `backend/.venv` before the merge — safe even then, because the packages are new and nothing existing moves — so `scripts/finish-task.ps1` gates F0 normally, **without `-SkipGate`**, and S1/S2/S3 land with the normal gate too. The overlay venv stays the recipe for a worktree that adds packages later.
9. **Lazy screens module.** The three lazy components live in `frontend/src/app/lazyScreens.tsx`: declaring `lazy()` components inside `routes.tsx` (which also exports `router`) trips `react-refresh/only-export-components`.
10. **Selftest placeholders take argv, and there are three.** `pointcloud-selftest`, `design-selftest` and `volumes-selftest` receive `argv[2:]` (K2 adds `--write-fixture`) and ignore it; each prints `<name> not built` and returns 2. F0 dispatches all three from `app/__main__.py` (S2's plan needs `volumes-selftest`, spec S2 §12.2 V6), so S1, S2 and S3 only replace their own `selftest.py` and never edit `__main__.py`. Each removes its own line from the placeholder test's parametrize when it builds the real one.

## File map

**Backend: new**

| File | Responsibility |
| --- | --- |
| `app/pointclouds/__init__.py`, `app/surfaces/__init__.py`, `app/surfaces/design/__init__.py`, `app/volumes/__init__.py` | empty packages |
| `app/pointclouds/router.py`, `app/surfaces/router.py`, `app/surfaces/design/router.py`, `app/volumes/router.py` | the 37 operations as 501 stubs; each imports its stub job modules |
| `app/pointclouds/jobs_import.py`, `jobs_export.py`, `app/surfaces/jobs_build.py`, `app/volumes/jobs_calc.py`, `jobs_export.py`, `app/surfaces/design/jobs.py` | register the six job types; raise `JobFailure("not implemented")` |
| `app/pointclouds/startup.py`, `app/surfaces/startup.py`, `app/volumes/startup.py`, `app/surfaces/design/startup.py` | no-op `sweep_interrupted(handle, runner) -> list[str]` |
| `app/pointclouds/converter.py` | the seam: `ConverterResult`, `run_converter(...)` raising `NotImplementedError` |
| `app/pointclouds/selftest.py`, `app/surfaces/design/selftest.py`, `app/volumes/selftest.py` | placeholders: print "<name> not built", exit 2 |
| `app/db/migrations/versions/0009_pointclouds_surfaces_volumes.py` | the one migration |
| `tests/pointclouds.py` | `make_las`, `write_fake_octree`, `read_fake_octree`, `read_header_bounds`, `fake_run_converter` |
| `tests/test_dependency_pins.py`, `test_pointcloud_fixtures.py`, `test_migration_0009.py`, `test_pointcloud_stubs.py`, `test_pointcloud_router_guard.py`, `test_pointcloud_foundation.py` | tests |

**Backend: modified** — `app/db/models.py` (4 models), `app/api.py` (guarded routers), `app/main.py` (4 sweep steps, CORS), `app/__main__.py` (3 selftests), `app/events_util.py` (3 publishers), `app/projects/service.py` (3 dirs), `app/stubs.py` (docstring), `tests/conftest.py` (offline converter), `tests/test_contract.py` (EXPECTED_STUBS, the empty `REFUSES_VALID_DATA` allowance), `tests/test_cors.py`, `kestrel_backend.spec`, `requirements.txt`, `requirements-lock.txt`.

**Contract** — `contract/openapi.yaml`, `contract/client/schema.d.ts` (generated), `contract/client/index.ts` (4 URL helpers, 4 type aliases).

**Frontend: new** — `src/screens/CloudsScreen.tsx`, `VolumesScreen.tsx`, `AboutScreen.tsx`, `foundationScreens.test.tsx`; `src/app/lazyScreens.tsx` (+test); `src/app/viewerDeps.test.ts`; `src/api/viewerUrls.test.ts`; `src/jobs/foundationJobTypes.test.ts`; `e2e/pointcloud-foundation.spec.ts`.

**Frontend: modified** — `package.json`, `pnpm-lock.yaml`, `src/routes.tsx`, `src/app/Sidebar.tsx` (+test), `src/app/Header.tsx` (+test), `src/ui/Icon.tsx`, `src/jobs/jobLabels.ts`, `src/jobs/JobCard.tsx`, `src/screens/HomeScreen.tsx`, `src/ui/useJobToasts.ts`, `src/agent/project/ToolRow.tsx`, `src/screens/AppSettingsScreen.tsx` (+test), `e2e/projects.spec.ts`.

**Docs** — `vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`, `CONTRIBUTING.md` (one note), `docs/progress.md`.

## Budget and execution DAG

**Budget.** F0 adds no real long work: the six new job types are registered background jobs that fail at once with "not implemented", so the job UI, toasts and sweeps are exercised without doing anything. It adds no synchronous read of project data: every new route is a 501 stub. `write_fake_octree` and `fake_run_converter` hold their points in memory by design and are test-only, for fixtures of at most a few thousand points. The frontend adds about 1 MB of viewer dependencies that nothing imports yet; the three new screens are separate lazy chunks.

**DAG** (one worker, one worktree: run the tasks in numeric order, which respects every edge; the batches show what is independent for review and for recovery if a task is redone).

| Task | Depends on | Batch |
| --- | --- | --- |
| 1 Worktree, overlay venv, Python pins, spec lines, ADR | none | B0 |
| 2 Point-cloud test helpers | 1 | B1 |
| 3 Models + the one migration | 1 | B1 |
| 4 Contract, generated client, stub routers, stub jobs, EXPECTED_STUBS | 1 | B1 |
| 8 Frontend viewer dependencies | 1 | B1 |
| 5 Frontend: job types in the eight maps, two icons | 4 | B2 |
| 6 Client URL helpers and type aliases | 4 | B2 |
| 7 Backend scaffolding: sweeps, converter seam + fixture, selftests, events, dirs, CORS | 2, 4 | B2 |
| 9 Screens, lazy routes, nav, titles, About link, e2e | 5 | B3 |
| 10 Gate, ledger, migration-head re-check, merge, hand-off | all | B4 |

- **Critical path:** 1 → 4 → 5 → 9 → 10. Task 4 is the largest (the contract is about 1 600 YAML lines of transcription), and 9 is the only UI task.
- **Between Task 4 and Task 5 the frontend typecheck is red** by design: the regenerated `JobType` union has six members the frontend maps lack until Task 5. Task 4 runs only the backend and contract checks; Task 5 restores `pnpm -C frontend build`.

## Review Focus

1. **Another branch claims migration `0009` before F0 merges** (today `task/model-gsd` carries a `0007_model_train_gsd` that already collides with `main`'s `0007`) — the app would find two heads and no project would open. Pinned by `test_the_chain_has_one_head_and_it_is_this_revision` (Task 3) and the cross-branch re-check in Task 10.
2. **A broken native import in one of the four new routers** (for example laspy's lazrs DLL in a frozen build) must cost only that router's endpoints, never the backend. Pinned by `test_a_router_that_fails_to_import_costs_only_its_endpoints` (Task 4).
3. **A training project creating clouds, surfaces, volumes or designs** must be refused with `409 wrong_project_kind` while reads still answer. Pinned by `test_a_training_project_may_read_but_not_write` (Task 4).
4. **A startup sweep that raises** must neither stop the project from opening nor skip the other sweeps. Pinned by `test_project_opened_runs_all_four_sweeps_even_when_one_fails` (Task 7).
5. **The octree loader's cross-origin preflight from the packaged origin** (`Range` + `Content-Type` from `http://tauri.localhost`) must pass before routing, and responses must expose `Content-Range`. Pinned by the two new tests in `tests/test_cors.py` (Task 7).

---

### Task 1: Worktree, overlay venv, Python pins and packaging lines

**Files:**
- Create: `backend/tests/test_dependency_pins.py`
- Create: `vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`
- Modify: `backend/requirements.txt` (append after line 34, `reportlab==5.0.1`)
- Modify: `backend/requirements-lock.txt` (5 lines, alphabetical)
- Modify: `backend/kestrel_backend.spec:11` and `:52`
- Modify: `CONTRIBUTING.md` (the "A worktree has no venv of its own" bullet, around line 80)

**Interfaces:**
- Produces: the worktree `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation` on branch `task/pointcloud-foundation`; the overlay interpreter `backend\.venv\Scripts\python.exe` (called `$PY` from here on, run from `backend\`) with laspy 2.7.0, lazrs 0.8.2, ezdxf 1.4.4, openpyxl 3.1.5 and et-xmlfile 2.0.0 installed locally and everything else read from the shared venv.

- [ ] **Step 1: Create the worktree from `main`**

Run (PowerShell, from anywhere):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\Dev\Yolo\app\scripts\start-task.ps1 -Name pointcloud-foundation
cd E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation
git log -1 --oneline; git -C E:\Dev\Yolo\app log -1 --oneline main
```

Expected: `worktree ready on task/pointcloud-foundation`, and both `git log` lines name the same commit. Every later path in this plan is relative to this worktree.

- [ ] **Step 2: Build the overlay venv (nothing is written into the shared venv)**

```powershell
$wt = "E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation"
$shared = "E:\Dev\Yolo\app\backend\.venv"
$base = ((Get-Content "$shared\pyvenv.cfg" | Where-Object { $_ -like 'home = *' }) -replace '^home = ', '').Trim()
uv venv --python "$base\python.exe" "$wt\backend\.venv"
Set-Content -Encoding ascii -Path "$wt\backend\.venv\Lib\site-packages\_kestrel_shared_venv.pth" -Value "$shared\Lib\site-packages"
cd "$wt\backend"
$PY = ".\.venv\Scripts\python.exe"
& $PY -c "import numpy, fastapi, rasterio, pytest; print(numpy.__file__)"
@(Get-ChildItem "$wt\backend\.venv" -Recurse -Force -Directory | Where-Object LinkType).Count
```

Expected: `numpy` resolves to `E:\Dev\Yolo\app\backend\.venv\Lib\site-packages\numpy\__init__.py`, and the link count is `0` (the overlay is a real folder; `backend/.venv/` is already git-ignored). Python is 3.11.15, the shared venv's base.

- [ ] **Step 3: Write the failing test**

`backend/tests/test_dependency_pins.py`:

```python
"""The direct dependencies foundation F0 adds for the point-cloud, volumes and design specs.

Pinned in both requirements files and installed at exactly that version. On an interpreter that
lacks them this fails loudly by name, rather than as an ImportError deep inside a later unit.
"""

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PINS = {
    "laspy": "2.7.0",
    "lazrs": "0.8.2",
    "scipy": "1.17.1",
    "shapely": "2.1.2",
    "psutil": "7.2.2",
    "reportlab": "5.0.1",
    "openpyxl": "3.1.5",
    "ezdxf": "1.4.4",
}


def _lines(name: str) -> set[str]:
    return {line.strip() for line in (BACKEND / name).read_text("utf-8").splitlines()}


@pytest.mark.parametrize("requirements", ["requirements.txt", "requirements-lock.txt"])
def test_each_library_is_pinned_exactly(requirements):
    lines = _lines(requirements)
    missing = [f"{name}=={pin}" for name, pin in PINS.items() if f"{name}=={pin}" not in lines]
    assert not missing, f"{requirements} lacks {missing}"


def test_the_lock_carries_the_new_transitive_dependency():
    assert "et-xmlfile==2.0.0" in _lines("requirements-lock.txt")  # openpyxl's


@pytest.mark.parametrize(("name", "pin"), sorted(PINS.items()))
def test_the_interpreter_has_the_pinned_version(name, pin):
    try:
        installed = version(name)
    except PackageNotFoundError:
        pytest.fail(f"{name} is not installed; install backend/requirements-lock.txt ({name}=={pin})")
    assert installed == pin
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `& $PY -m pytest tests/test_dependency_pins.py -q`
Expected: FAIL — `requirements.txt lacks ['laspy==2.7.0', 'lazrs==0.8.2', 'scipy==1.17.1', 'shapely==2.1.2', 'psutil==7.2.2', 'openpyxl==3.1.5', 'ezdxf==1.4.4']`, the lock lacks five lines, and `laspy is not installed`.

- [ ] **Step 5: Pin the libraries and install the new ones into the overlay only**

Append to `backend/requirements.txt`, after the last line `reportlab==5.0.1`:

```
# point clouds, volumes, design surfaces (specs 2026-09-23, foundation F0). scipy, shapely and
# psutil were already transitive; they are direct now, at the same versions.
laspy==2.7.0
lazrs==0.8.2
scipy==1.17.1
shapely==2.1.2
psutil==7.2.2
openpyxl==3.1.5
ezdxf==1.4.4
```

Insert into `backend/requirements-lock.txt`, each where its name sorts (the file is alphabetical; `scipy`, `shapely`, `psutil` and `reportlab` are already there): `et-xmlfile==2.0.0` and `ezdxf==1.4.4` after `docstring-parser==0.18.0`; `laspy==2.7.0` and `lazrs==0.8.2` after `kiwisolver==1.5.1`; `openpyxl==3.1.5` after `opencv-python==5.0.0.93`.

Then install (resolved against the lock on 2026-09-24: these five are the only packages the lock lacks):

```powershell
uv pip install --python "$wt\backend\.venv\Scripts\python.exe" --no-deps laspy==2.7.0 lazrs==0.8.2 ezdxf==1.4.4 openpyxl==3.1.5 et-xmlfile==2.0.0
& "$shared\Scripts\python.exe" -c "import importlib.util as u; print(u.find_spec('laspy'))"
```

Expected: `Installed 5 packages`, and the shared interpreter still prints `None` (untouched).

- [ ] **Step 6: Run the test to confirm it passes, then the whole suite as a baseline**

Run: `& $PY -m pytest tests/test_dependency_pins.py -q`
Expected: PASS (11 tests).

Run: `& $PY -m pytest -q`
Expected: every test passes (about 10 minutes; GPU and live tests are deselected by `pyproject.toml`). This proves the overlay venv is equivalent to the shared one before anything else changes.

- [ ] **Step 7: Name laspy and lazrs for the frozen build**

In `backend/kestrel_backend.spec`, after line 11 `    + collect_submodules("ultralytics")` insert:

```python
    # point clouds (spec 2026-09-23-point-clouds section 5 item 6): laspy picks its LAZ backend
    # at runtime, so lazrs is named; PotreeConverter's own payload is added by unit K1.
    + collect_submodules("laspy")
```

and after line 52 `        "rasterio.serde",` insert `        "lazrs",`.

- [ ] **Step 8: Record the overlay venv (ADR and CONTRIBUTING)**

Create `vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`:

```markdown
---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, gotcha, venv, worktrees]
related: ["[[2026-09-18-gotcha-shared-venv-deleted-with-a-worktree]]", "[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]"]
---

# A unit that adds Python packages builds an overlay venv in its worktree

## Context

Worktrees run backend commands on the main checkout's interpreter (`backend/.venv`). Foundation
F0 of the point-cloud, volumes and design specs adds five packages (laspy, lazrs, ezdxf, openpyxl,
et-xmlfile). Installing them into the shared venv while the unit is still being built (and may yet
change its pins) would change the interpreter every other live worktree tests with, in the middle
of their work, before the pins that ask for them are ready to land.

## Decision

The unit builds `<worktree>/backend/.venv` as an **overlay**: `uv venv` from the shared venv's base
Python, one `_kestrel_shared_venv.pth` file pointing at the shared `Lib/site-packages`, and
`uv pip install --no-deps` of only the new packages. The shared site-packages are read, never
written; the new packages resolve first. The overlay is a real folder with no links, so the
junction-safe worktree removal deletes it like any file.

At landing the new packages go into the shared venv **additively** (operator decision, F0 Task
10): `uv pip install --python E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe --no-deps` of
exactly the new pins, with a `uv pip list` diff before and after that shows only those lines
added. New packages move nothing another worktree depends on, so this is safe before the merge,
and `scripts/finish-task.ps1` then gates the unit normally, never with `-SkipGate`.

## Consequences

- After F0 lands, the shared venv has laspy, lazrs, ezdxf, openpyxl and et-xmlfile, so S1, S2
  and S3 land through `finish-task.ps1` with the normal gate. Their worktrees may still build the
  overlay for isolation; it is no longer needed to pass the gate.
- If a later gate on the shared interpreter fails only because a package is missing, the unit
  stops and reports it; it never lands with `-SkipGate` to get around it.
- `tests/test_dependency_pins.py` turns "a package is missing" into one readable failure instead
  of an ImportError deep inside a later unit's test.
```

In `CONTRIBUTING.md`, at the end of the bullet that starts `- **A worktree has no venv of its own.**`, append this sentence on a new line indented two spaces:

```
  The one exception: a unit that adds Python packages builds an overlay venv in its worktree while
  it develops, and at landing installs only the new pins into the shared one, additively
  (`--no-deps`, a `uv pip list` diff before and after), then gates normally
  (`vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`).
```

- [ ] **Step 9: Lint and commit**

Run: `& $PY -m ruff check .; & $PY -m ruff format --check .`
Expected: `All checks passed!` and every file already formatted.

```powershell
cd ..
git add backend/tests/test_dependency_pins.py backend/requirements.txt backend/requirements-lock.txt backend/kestrel_backend.spec vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md CONTRIBUTING.md
git commit -m "build(pointclouds): pin laspy, lazrs, scipy, shapely, psutil, openpyxl and ezdxf for S1-S3" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Point-cloud test helpers

Shell: PowerShell in `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`; backend commands run from `backend\` with `$PY = ".\.venv\Scripts\python.exe"` (the overlay venv of Task 1).

**Files:**
- Create: `backend/tests/pointclouds.py`
- Test: `backend/tests/test_pointcloud_fixtures.py`

**Interfaces:**
- Consumes: laspy (Task 1).
- Produces (all in `tests/pointclouds.py`, imported by tests as `from pointclouds import …`):
  - `make_las(path, n, *, epsg=32639, rgb=True, compressed=False, header_shrink_mm=0.0, points=None, version="1.2", point_format=3) -> Path`
  - `write_fake_octree(points, out_dir, *, rgb=None, scale=0.001) -> Path` (a minimal Potree 2.0 octree, `DEFAULT` encoding)
  - `read_fake_octree(out_dir) -> tuple[dict, np.ndarray, np.ndarray]` (metadata, xyz, rgb)
  - `read_header_bounds(path) -> list[float]` (`[minx, miny, minz, maxx, maxy, maxz]` from bytes 179–226)
  - `default_points(n, seed=0)`, `west_red_east_green(xyz)`, constants `ORIGIN`, `SCALE`, `BOUNDS_OFFSET = 179`, `POINT_RECORD = 18`, `HIERARCHY_NODE = 22`
  - `fake_run_converter(input_path, out_dir, *, progress, check_cancelled) -> ConverterResult` — same signature as the seam in Task 7; it imports `app.pointclouds.converter` inside the function, so this module imports with numpy only.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_pointcloud_fixtures.py`:

```python
"""The point-cloud test helpers themselves (F0): tiny LAS/LAZ files and the fake Potree octree."""

import json
import struct

import laspy
import numpy as np
import pytest
from pointclouds import (
    HIERARCHY_NODE,
    POINT_RECORD,
    default_points,
    make_las,
    read_fake_octree,
    read_header_bounds,
    write_fake_octree,
)


def test_make_las_writes_a_readable_las_12_with_rgb_and_the_crs(tmp_path):
    path = make_las(tmp_path / "a.las", 500)
    las = laspy.read(path)
    assert len(las.points) == 500
    assert str(las.header.version) == "1.2"
    assert las.header.point_format.id == 3
    assert las.header.parse_crs().to_epsg() == 32639
    assert int(np.asarray(las.red).max()) == 65535 and int(np.asarray(las.green).max()) == 65535


def test_make_las_writes_laz_that_laspy_reads_back(tmp_path):
    path = make_las(tmp_path / "a.laz", 300, compressed=True)
    assert path.read_bytes()[:4] == b"LASF"
    las = laspy.read(path)
    assert las.header.are_points_compressed
    assert len(las.points) == 300


def test_make_las_keeps_given_points_to_the_file_scale(tmp_path):
    pts = np.array([[553100.0, 2847300.0, -45.0], [553101.2345, 2847302.5, -40.25]])
    las = laspy.read(make_las(tmp_path / "p.las", 0, points=pts))
    got = np.column_stack([las.x, las.y, las.z])
    assert np.allclose(got, pts, atol=0.0005)


def test_make_las_without_crs_or_rgb(tmp_path):
    las = laspy.read(make_las(tmp_path / "n.las", 10, epsg=None, rgb=False, point_format=1))
    assert las.header.parse_crs() is None
    assert "red" not in set(las.point_format.dimension_names)


def test_make_las_14_point_format_6_carries_the_crs_as_wkt(tmp_path):
    las = laspy.read(make_las(tmp_path / "v14.las", 50, version="1.4", point_format=6, rgb=False))
    assert str(las.header.version) == "1.4"
    assert las.header.point_format.id == 6
    assert las.header.parse_crs().to_epsg() == 32639


@pytest.mark.parametrize("compressed", [False, True])
def test_header_shrink_leaves_a_point_outside_the_header_bounds(tmp_path, compressed):
    path = make_las(tmp_path / "s.laz", 200, compressed=compressed, header_shrink_mm=0.3)
    true_max_x = float(np.asarray(laspy.read(path).x).max())
    header_max_x = read_header_bounds(path)[3]
    assert true_max_x - header_max_x == pytest.approx(0.0003, abs=1e-9)
    assert laspy.open(path).header.maxs[0] == pytest.approx(header_max_x)


def test_fake_octree_has_the_potree_2_layout(tmp_path):
    pts = default_points(1000)
    out = write_fake_octree(pts, tmp_path / "octree")
    meta = json.loads((out / "metadata.json").read_text("utf-8"))
    assert meta["version"] == "2.0" and meta["encoding"] == "DEFAULT"
    assert meta["points"] == 1000
    assert meta["hierarchy"]["firstChunkSize"] == HIERARCHY_NODE
    assert meta["spacing"] > 0
    assert [a["name"] for a in meta["attributes"]] == ["position", "rgb"]
    box_min, box_max = np.asarray(meta["boundingBox"]["min"]), np.asarray(meta["boundingBox"]["max"])
    assert np.all(box_min <= pts.min(axis=0)) and np.all(box_max >= pts.max(axis=0))
    size = box_max - box_min
    assert size[0] == pytest.approx(size[1]) == pytest.approx(size[2])  # a cube
    hierarchy = (out / "hierarchy.bin").read_bytes()
    assert len(hierarchy) == HIERARCHY_NODE
    node_type, child_mask, count, offset, size_bytes = struct.unpack("<BBIqq", hierarchy)
    assert (node_type, child_mask, count, offset) == (1, 0, 1000, 0)
    assert size_bytes == (out / "octree.bin").stat().st_size == POINT_RECORD * 1000


def test_fake_octree_decodes_back_to_the_points_and_colours(tmp_path):
    pts = default_points(64, seed=3)
    rgb = np.tile(np.array([[1, 2, 3]], dtype=np.uint16), (64, 1))
    _, xyz, colours = read_fake_octree(write_fake_octree(pts, tmp_path / "o", rgb=rgb))
    assert np.allclose(xyz, pts, atol=0.0005)
    assert (colours == rgb).all()


def test_fake_octree_refuses_no_points(tmp_path):
    with pytest.raises(ValueError, match="at least one point"):
        write_fake_octree(np.zeros((0, 3)), tmp_path / "o")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `& $PY -m pytest tests/test_pointcloud_fixtures.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pointclouds'`.

- [ ] **Step 3: Write the helpers**

`backend/tests/pointclouds.py`:

```python
"""Point-cloud test fixtures (spec 2026-09-23-point-clouds section 5 item 9), generated at test time.

`make_las` writes a tiny LAS or LAZ with laspy, optionally with header bounds deliberately too small
(the Pix4D trap: its "Chimney stack 3D" header misses the true max by 0.3 mm). `write_fake_octree`
writes a minimal valid Potree 2.0 octree: one leaf root node, `DEFAULT` encoding, position + rgb.
`fake_run_converter` is the offline stand-in for PotreeConverter that `conftest.app` installs.

laspy is imported inside the functions that need it, so importing this module (conftest does) costs
nothing and never fails on an interpreter without laspy.
"""

from __future__ import annotations

import json
import struct
import time
from pathlib import Path

import numpy as np

# The spike's fixture site: EPSG:32639 (UTM 39N) coordinates near the chimney file.
ORIGIN = (553_100.0, 2_847_300.0, -45.0)
EXTENT = (10.0, 10.0, 5.0)
SCALE = 0.001
# LAS header: max_x, min_x, max_y, min_y, max_z, min_z as little-endian doubles from byte 179,
# the same in LAS 1.0-1.4 and in LAZ (whose header is not compressed).
BOUNDS_OFFSET = 179
RGB_FORMATS = {2, 3, 5, 7, 8, 10}
POINT_RECORD = 18  # DEFAULT encoding: int32 x, y, z + uint16 r, g, b
HIERARCHY_NODE = 22  # type u8, childMask u8, numPoints u32, byteOffset i64, byteSize i64


def default_points(n: int, seed: int = 0) -> np.ndarray:
    """`n` points in a 10 x 10 x 5 m box at ORIGIN, float64 (n, 3), deterministic."""
    rng = np.random.default_rng(seed)
    return np.asarray(ORIGIN) + rng.random((n, 3)) * np.asarray(EXTENT)


def west_red_east_green(xyz: np.ndarray) -> np.ndarray:
    """uint16 (n, 3) colours: red in the west half, green in the east half (the check:webview fixture)."""
    mid = (xyz[:, 0].min() + xyz[:, 0].max()) / 2
    rgb = np.zeros((len(xyz), 3), dtype=np.uint16)
    west = xyz[:, 0] < mid
    rgb[west, 0] = 65535
    rgb[~west, 1] = 65535
    return rgb


def make_las(
    path: Path,
    n: int,
    *,
    epsg: int | None = 32639,
    rgb: bool = True,
    compressed: bool = False,
    header_shrink_mm: float = 0.0,
    points: np.ndarray | None = None,
    version: str = "1.2",
    point_format: int = 3,
) -> Path:
    """Write `n` points (or exactly `points`, float64 (n, 3)) to a LAS, or a LAZ when `compressed`.

    `epsg=None` writes no CRS. `rgb` fills the colour of a format that has one (red west, green
    east). `header_shrink_mm` moves the header's max X that far inwards after writing, so the header
    no longer contains every point. Classification is 2 (ground) for every point.
    """
    import laspy

    xyz = default_points(n) if points is None else np.asarray(points, dtype=np.float64)
    header = laspy.LasHeader(point_format=point_format, version=version)
    header.scales = np.array([SCALE, SCALE, SCALE])
    header.offsets = np.floor(xyz.min(axis=0)) if len(xyz) else np.zeros(3)
    if epsg is not None:
        from pyproj import CRS

        header.add_crs(CRS.from_epsg(epsg))
    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    las.classification = np.full(len(xyz), 2, dtype=np.uint8)
    if rgb and point_format in RGB_FORMATS:
        colours = west_red_east_green(xyz) if len(xyz) else np.zeros((0, 3), dtype=np.uint16)
        las.red, las.green, las.blue = colours[:, 0], colours[:, 1], colours[:, 2]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    las.write(path, do_compress=compressed)
    if header_shrink_mm:
        with path.open("r+b") as f:
            f.seek(BOUNDS_OFFSET)
            (max_x,) = struct.unpack("<d", f.read(8))
            f.seek(BOUNDS_OFFSET)
            f.write(struct.pack("<d", max_x - header_shrink_mm / 1000.0))
    return path


def read_header_bounds(path: Path) -> list[float]:
    """The header's [minx, miny, minz, maxx, maxy, maxz], read straight from bytes 179-226."""
    with Path(path).open("rb") as f:
        f.seek(BOUNDS_OFFSET)
        max_x, min_x, max_y, min_y, max_z, min_z = struct.unpack("<6d", f.read(48))
    return [min_x, min_y, min_z, max_x, max_y, max_z]


def write_fake_octree(
    points: np.ndarray, out_dir: Path, *, rgb: np.ndarray | None = None, scale: float = SCALE
) -> Path:
    """Write a minimal valid Potree 2.0 octree (metadata.json, hierarchy.bin, octree.bin) into `out_dir`.

    One leaf root node holds every point, `DEFAULT` encoding, attributes position (int32 x 3) and rgb
    (uint16 x 3), the layout potree-core 2.0.15's DEFAULT decoder reads: a point's coordinate is
    `int32 * scale + offset`. The bounding box is a cube from the points' min, as the converter
    writes it. Test-only: it holds the points in memory, so it is for tiny fixtures.
    """
    xyz = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    if len(xyz) == 0:
        raise ValueError("an octree needs at least one point")
    colours = west_red_east_green(xyz) if rgb is None else np.asarray(rgb, dtype=np.uint16).reshape(-1, 3)
    lo, hi = xyz.min(axis=0), xyz.max(axis=0)
    size = max(float((hi - lo).max()), scale)
    cube_max = lo + size
    ints = np.round((xyz - lo) / scale).astype("<i4")
    records = np.zeros(len(xyz), dtype=[("pos", "<i4", 3), ("rgb", "<u2", 3)])
    records["pos"], records["rgb"] = ints, colours
    body = records.tobytes()
    assert len(body) == POINT_RECORD * len(xyz)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "octree.bin").write_bytes(body)
    (out / "hierarchy.bin").write_bytes(struct.pack("<BBIqq", 1, 0, len(xyz), 0, len(body)))
    metadata = {
        "version": "2.0",
        "name": "fake",
        "description": "",
        "points": int(len(xyz)),
        "projection": "",
        "hierarchy": {"firstChunkSize": HIERARCHY_NODE, "stepSize": 4, "depth": 0},
        "offset": lo.tolist(),
        "scale": [scale, scale, scale],
        "spacing": size / 128.0,
        "boundingBox": {"min": lo.tolist(), "max": cube_max.tolist()},
        "encoding": "DEFAULT",
        "attributes": [
            {
                "name": "position",
                "description": "",
                "size": 12,
                "numElements": 3,
                "elementSize": 4,
                "type": "int32",
                "min": lo.tolist(),
                "max": hi.tolist(),
            },
            {
                "name": "rgb",
                "description": "",
                "size": 6,
                "numElements": 3,
                "elementSize": 2,
                "type": "uint16",
                "min": colours.min(axis=0).tolist(),
                "max": colours.max(axis=0).tolist(),
            },
        ],
    }
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2), "utf-8")
    return out


def read_fake_octree(out_dir: Path) -> tuple[dict, np.ndarray, np.ndarray]:
    """Decode an octree written by `write_fake_octree`: (metadata, xyz float64 (n, 3), rgb uint16 (n, 3))."""
    out = Path(out_dir)
    meta = json.loads((out / "metadata.json").read_text("utf-8"))
    kind, mask, count, offset, size = struct.unpack("<BBIqq", (out / "hierarchy.bin").read_bytes()[:22])
    raw = (out / "octree.bin").read_bytes()[offset : offset + size]
    records = np.frombuffer(raw, dtype=[("pos", "<i4", 3), ("rgb", "<u2", 3)], count=count)
    xyz = records["pos"] * np.asarray(meta["scale"]) + np.asarray(meta["offset"])
    return meta, xyz, records["rgb"].copy()


def fake_run_converter(input_path, out_dir, *, progress, check_cancelled):
    """The offline PotreeConverter: reads the LAS/LAZ with laspy, writes `write_fake_octree` output.

    Same signature and result type as `app.pointclouds.converter.run_converter`.
    """
    import laspy

    from app.pointclouds.converter import ConverterResult

    started = time.monotonic()
    check_cancelled()
    progress(0.0, "building the 3D view copy: INDEXING 0 %")
    las = laspy.read(input_path)
    xyz = np.column_stack([np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)])
    names = set(las.point_format.dimension_names)
    rgb = (
        np.column_stack([np.asarray(las.red), np.asarray(las.green), np.asarray(las.blue)])
        if {"red", "green", "blue"} <= names
        else np.full((len(xyz), 3), 65535, dtype=np.uint16)
    )
    write_fake_octree(xyz, Path(out_dir), rgb=rgb)
    check_cancelled()
    progress(1.0, "building the 3D view copy: DONE 100 %")
    return ConverterResult(
        octree_dir=Path(out_dir),
        log_tail=["fake converter: " + str(len(xyz)) + " points"],
        command=["fake-potreeconverter", str(input_path), "-o", str(out_dir)],
        seconds=time.monotonic() - started,
        encoding="DEFAULT",  # write_fake_octree's encoding; the real converter reports BROTLI
    )
```

The octree layout is the one potree-core 2.0.15's loader and `DEFAULT` decoder read (checked against its bundle): `hierarchy.bin` records are 22 bytes `<BBIqq` (type 1 = leaf, child mask, point count, byte offset, byte size), and a point is `int32 x, y, z` scaled by `scale` from `offset`, then `uint16 r, g, b`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `& $PY -m pytest tests/test_pointcloud_fixtures.py -q`
Expected: PASS (10 tests).

- [ ] **Step 5: Lint and commit**

Run: `& $PY -m ruff check tests; & $PY -m ruff format --check tests`

```powershell
cd ..
git add backend/tests/pointclouds.py backend/tests/test_pointcloud_fixtures.py
git commit -m "test(pointclouds): tiny LAS/LAZ writer with a too-small header option, and a minimal Potree 2.0 octree" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Models and the one migration

Shell: PowerShell in `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`; backend commands run from `backend\` with `$PY = ".\.venv\Scripts\python.exe"` (the overlay venv of Task 1).

**Files:**
- Modify: `backend/app/db/models.py` (append after the last line, 355)
- Create: `backend/app/db/migrations/versions/0009_pointclouds_surfaces_volumes.py`
- Test: `backend/tests/test_migration_0009.py`

**Interfaces:**
- Produces: `app.db.models.PointCloud` (`point_cloud`), `CloudMeasurement` (`cloud_measurement`), `Surface` (`surface`), `VolumeMeasurement` (`volume_measurement`) with exactly the columns of spec S1 §5 item 3; revision `"0009"`, `down_revision = "0008"`.

- [ ] **Step 1: Take the revision id**

Run: `& $PY -c "from alembic.config import Config; from alembic.script import ScriptDirectory; c=Config('app/db/migrations/alembic.ini'); c.set_main_option('script_location','app/db/migrations'); print(ScriptDirectory.from_config(c).get_heads())"`
Expected: `['0008']`. Then check what other branches claim:

```powershell
git log --all --oneline -- backend/app/db/migrations/versions/ | Select-Object -First 15
Get-ChildItem E:\Dev\Yolo\app\.claude\worktrees\*\backend\app\db\migrations\versions\0009_* -ErrorAction SilentlyContinue
```

Expected: no `0009_*` anywhere. If `main`'s head is not `0008`, or `0009` is taken, use the next free id throughout this task (file name, `revision`, `down_revision` = `main`'s head, and `REVISION` in the test).

- [ ] **Step 2: Write the failing test**

`backend/tests/test_migration_0009.py`:

```python
"""Migration 0009 (foundation F0): the four tables of the point-cloud, volumes and design specs.

A project at 0008 with a map upgrades without any row being rewritten; the foreign keys carry the
actions the specs name, and every model column exists in the migrated table.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.db.models import CloudMeasurement, GeoMap, PointCloud, Surface, VolumeMeasurement
from app.db.session import MIGRATIONS, make_session_factory, open_project_db

REVISION = "0009"
TABLES = {
    "point_cloud": PointCloud,
    "cloud_measurement": CloudMeasurement,
    "surface": Surface,
    "volume_measurement": VolumeMeasurement,
}


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _at_0008_with_a_map(folder):
    folder.mkdir()
    command.upgrade(_cfg(folder), "0008")
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO geo_map (id, name, status, source_path, source_size, source_sha256, width, height,"
        " band_count, dtype, stretch, labels_version, created_at) VALUES ('m1', 'April', 'ready',"
        " 'x.tif', 1, '', 100, 100, 3, 'uint8', '{}', 0, '2026-01-01 00:00:00.000000')"
    )
    con.commit()
    con.close()


def _opened(tmp_path):
    folder = tmp_path / "old"
    _at_0008_with_a_map(folder)
    return open_project_db(folder)


def test_the_chain_has_one_head_and_it_is_this_revision():
    heads = ScriptDirectory.from_config(_cfg()).get_heads()
    assert heads == [REVISION]


def test_upgrade_keeps_the_map_and_adds_the_four_tables(tmp_path):
    engine = _opened(tmp_path)
    try:
        with engine.connect() as c:
            tables = {r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
            for table, model in TABLES.items():
                cols = {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}
                assert cols == {col.name for col in model.__table__.columns}, table
        with make_session_factory(engine)() as s:
            assert s.get(GeoMap, "m1").name == "April"
    finally:
        engine.dispose()
    assert set(TABLES) <= tables


def test_foreign_keys_carry_the_spec_actions(tmp_path):
    engine = _opened(tmp_path)
    try:
        with engine.connect() as c:

            def fks(table):
                return {(r[3], r[2], r[6]) for r in c.exec_driver_sql(f"PRAGMA foreign_key_list({table})")}

            assert fks("point_cloud") == {("map_id", "geo_map", "SET NULL")}
            assert fks("cloud_measurement") == {("point_cloud_id", "point_cloud", "CASCADE")}
            assert fks("surface") == {("point_cloud_id", "point_cloud", "SET NULL")}
            assert fks("volume_measurement") == {("top_surface_id", "surface", "RESTRICT")}
            indexes = {
                table: {r[1] for r in c.exec_driver_sql(f"PRAGMA index_list({table})")}
                for table in ("cloud_measurement", "surface", "volume_measurement")
            }
    finally:
        engine.dispose()
    assert "ix_cloud_measurement_cloud" in indexes["cloud_measurement"]
    assert "ix_surface_status" in indexes["surface"]
    assert "ix_volume_measurement_top_surface" in indexes["volume_measurement"]


def test_the_delete_rules_hold_with_foreign_keys_on(tmp_path):
    engine = _opened(tmp_path)
    factory = make_session_factory(engine)
    try:
        with factory() as s:
            cloud = PointCloud(name="c", source_path="c.las", source_size=1, map_id="m1")
            s.add(cloud)
            s.flush()
            s.add(CloudMeasurement(point_cloud_id=cloud.id, kind="point", name="Point 1", points=[]))
            surface = Surface(name="s", kind="cloud_dsm", point_cloud_id=cloud.id)
            s.add(surface)
            s.flush()
            s.add(
                VolumeMeasurement(
                    name="v", polygon_native=[], top_surface_id=surface.id, base={"kind": "toe_plane"}
                )
            )
            s.commit()
            cloud_id, surface_id = cloud.id, surface.id
        with engine.begin() as c:
            c.exec_driver_sql("DELETE FROM geo_map WHERE id = 'm1'")  # SET NULL on the cloud's link
            assert c.exec_driver_sql("SELECT map_id FROM point_cloud").scalar_one() is None
            c.exec_driver_sql(f"DELETE FROM point_cloud WHERE id = '{cloud_id}'")
            assert c.exec_driver_sql("SELECT count(*) FROM cloud_measurement").scalar_one() == 0  # CASCADE
            assert c.exec_driver_sql("SELECT point_cloud_id FROM surface").scalar_one() is None  # SET NULL
        with pytest.raises(IntegrityError):  # RESTRICT: a surface in use cannot go
            with engine.begin() as c:
                c.exec_driver_sql(f"DELETE FROM surface WHERE id = '{surface_id}'")
    finally:
        engine.dispose()


def test_downgrade_to_0008_removes_only_the_new_tables(tmp_path):
    folder = tmp_path / "old"
    _at_0008_with_a_map(folder)
    command.upgrade(_cfg(folder), "head")
    command.downgrade(_cfg(folder), "0008")
    con = sqlite3.connect(folder / "project.db")
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert con.execute("SELECT name FROM geo_map").fetchone() == ("April",)
    finally:
        con.close()
    assert not set(TABLES) & tables
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `& $PY -m pytest tests/test_migration_0009.py -q`
Expected: FAIL with `ImportError: cannot import name 'CloudMeasurement' from 'app.db.models'`.

- [ ] **Step 4: Add the models**

Append to `backend/app/db/models.py` (every name it uses is already imported at the top of the file):

```python
class PointCloud(Base):
    """A LAS/LAZ point cloud and its Potree display copy (spec 2026-09-23-point-clouds section 3)."""

    __tablename__ = "point_cloud"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="importing")  # importing | ready | failed
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    source_path: Mapped[str] = mapped_column(String)  # absolute; only ever read, never kept
    source_size: Mapped[int] = mapped_column(Integer)
    source_sha256: Mapped[str | None] = mapped_column(String, nullable=True)  # streamed in the work copy
    source_mtime: Mapped[float | None] = mapped_column(Float, nullable=True)  # export refuses a change
    las_version: Mapped[str | None] = mapped_column(String, nullable=True)
    point_format: Mapped[int | None] = mapped_column(Integer, nullable=True)
    point_count: Mapped[int | None] = mapped_column(Integer, nullable=True)  # scanned, not the header's
    has_rgb: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    scale: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [sx, sy, sz]
    crs_wkt: Mapped[str | None] = mapped_column(String, nullable=True)  # horizontal; null = no coordinates
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    proj4: Mapped[str | None] = mapped_column(String, nullable=True)
    vertical_crs: Mapped[str | None] = mapped_column(String, nullable=True)  # null = heights as stored
    crs_source: Mapped[str | None] = mapped_column(String, nullable=True)  # file | assigned
    bounds_native: Mapped[list | None] = mapped_column(JSON, nullable=True)  # true bounds, 6 numbers
    bounds_repaired: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    bounds_wgs84: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [minlon, minlat, maxlon, maxlat]
    # The octree's ROOT node spacing from metadata.json, not the point spacing (the brief's spacing_m).
    octree_spacing_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    z_stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    class_counts: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {"<code>": n}
    octree_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    captured_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    map_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("geo_map.id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class CloudMeasurement(Base):
    """A saved pick-based measurement on a point cloud (spec 2026-09-23-point-clouds section 3)."""

    __tablename__ = "cloud_measurement"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    point_cloud_id: Mapped[str] = mapped_column(String(36), ForeignKey("point_cloud.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String)  # point | distance | height | vertical
    name: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    points: Mapped[list] = mapped_column(JSON)  # [{x, y, z, uncertainty_m}] in the cloud's native CRS
    results: Mapped[dict] = mapped_column(JSON, default=dict)  # computed by the server, never the client
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_cloud_measurement_cloud", "point_cloud_id"),)


class Surface(Base):
    """A gridded surface: a cloud DSM (S2) or an imported design (S3) (spec 2026-09-23-volumes section 3)."""

    __tablename__ = "surface"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # cloud_dsm | design
    status: Mapped[str] = mapped_column(String, default="building")  # building | ready | failed
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    # A surface's tif is self-contained, so it survives its cloud.
    point_cloud_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("point_cloud.id", ondelete="SET NULL"), nullable=True
    )
    design_source: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # DesignSource; null: cloud_dsm
    crs_wkt: Mapped[str | None] = mapped_column(String, nullable=True)  # null = local metres
    epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cell_size_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    geotransform: Mapped[list | None] = mapped_column(JSON, nullable=True)  # GDAL order, north-up
    bounds_native: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [minx, miny, maxx, maxy]
    z_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    z_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    coverage_fraction: Mapped[float | None] = mapped_column(Float, nullable=True)
    method: Mapped[str | None] = mapped_column(String, nullable=True)  # one SurfaceMethod value
    build_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # SurfaceBuildStats; null for design
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_surface_status", "status"),)


class VolumeMeasurement(Base):
    """Cut and fill over a polygon on a top surface (spec 2026-09-23-volumes section 3)."""

    __tablename__ = "volume_measurement"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    polygon_native: Mapped[list] = mapped_column(JSON)  # [[x, y], ...] in the top surface's CRS
    top_surface_id: Mapped[str] = mapped_column(String(36), ForeignKey("surface.id", ondelete="RESTRICT"))
    base: Mapped[dict] = mapped_column(JSON)  # {kind, z?, surface_id?}
    masks: Mapped[dict] = mapped_column(JSON, default=dict)
    alignment: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="calculating")  # calculating|ready|failed|stale
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    results: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # VolumeResults
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_volume_measurement_top_surface", "top_surface_id"),)
```

- [ ] **Step 5: Write the migration**

`backend/app/db/migrations/versions/0009_pointclouds_surfaces_volumes.py`:

```python
"""point clouds, cloud measurements, surfaces and volume measurements (foundation F0)

The one schema change for the point-cloud, volumes and design-surface specs (spec
2026-09-23-point-clouds section 5 item 3): no later unit of those three specs adds a migration.
Only new tables: nothing existing is rewritten, so this cannot fail on user data and cannot be the
reason a project does not open.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-24 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "point_cloud",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("source_path", sa.String(), nullable=False),
        sa.Column("source_size", sa.Integer(), nullable=False),
        sa.Column("source_sha256", sa.String(), nullable=True),
        sa.Column("source_mtime", sa.Float(), nullable=True),
        sa.Column("las_version", sa.String(), nullable=True),
        sa.Column("point_format", sa.Integer(), nullable=True),
        sa.Column("point_count", sa.Integer(), nullable=True),
        sa.Column("has_rgb", sa.Boolean(), nullable=True),
        sa.Column("scale", sa.JSON(), nullable=True),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("proj4", sa.String(), nullable=True),
        sa.Column("vertical_crs", sa.String(), nullable=True),
        sa.Column("crs_source", sa.String(), nullable=True),
        sa.Column("bounds_native", sa.JSON(), nullable=True),
        sa.Column("bounds_repaired", sa.Boolean(), nullable=True),
        sa.Column("bounds_wgs84", sa.JSON(), nullable=True),
        sa.Column("octree_spacing_m", sa.Float(), nullable=True),
        sa.Column("z_stats", sa.JSON(), nullable=True),
        sa.Column("class_counts", sa.JSON(), nullable=True),
        sa.Column("octree_bytes", sa.Integer(), nullable=True),
        sa.Column("captured_on", sa.Date(), nullable=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="SET NULL"), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "cloud_measurement",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "point_cloud_id",
            sa.String(36),
            sa.ForeignKey("point_cloud.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("points", sa.JSON(), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_cloud_measurement_cloud", "cloud_measurement", ["point_cloud_id"])
    op.create_table(
        "surface",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column(
            "point_cloud_id",
            sa.String(36),
            sa.ForeignKey("point_cloud.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("design_source", sa.JSON(), nullable=True),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("cell_size_m", sa.Float(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("geotransform", sa.JSON(), nullable=True),
        sa.Column("bounds_native", sa.JSON(), nullable=True),
        sa.Column("z_min", sa.Float(), nullable=True),
        sa.Column("z_max", sa.Float(), nullable=True),
        sa.Column("coverage_fraction", sa.Float(), nullable=True),
        sa.Column("method", sa.String(), nullable=True),
        sa.Column("build_params", sa.JSON(), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_surface_status", "surface", ["status"])
    op.create_table(
        "volume_measurement",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("polygon_native", sa.JSON(), nullable=False),
        sa.Column(
            "top_surface_id",
            sa.String(36),
            sa.ForeignKey("surface.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("base", sa.JSON(), nullable=False),
        sa.Column("masks", sa.JSON(), nullable=False),
        sa.Column("alignment", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("results", sa.JSON(), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_volume_measurement_top_surface", "volume_measurement", ["top_surface_id"])


def downgrade() -> None:
    op.drop_index("ix_volume_measurement_top_surface", table_name="volume_measurement")
    op.drop_table("volume_measurement")
    op.drop_index("ix_surface_status", table_name="surface")
    op.drop_table("surface")
    op.drop_index("ix_cloud_measurement_cloud", table_name="cloud_measurement")
    op.drop_table("cloud_measurement")
    op.drop_table("point_cloud")
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `& $PY -m pytest tests/test_migration_0009.py tests/test_migration_0008.py tests/test_db.py tests/test_project_kinds.py -q`
Expected: PASS. (`test_project_kinds.py` upgrades through 0005 → head too.)

- [ ] **Step 7: Lint and commit**

Run: `& $PY -m ruff check .; & $PY -m ruff format --check .`

```powershell
cd ..
git add backend/app/db/models.py backend/app/db/migrations/versions/0009_pointclouds_surfaces_volumes.py backend/tests/test_migration_0009.py
git commit -m "feat(db): point_cloud, cloud_measurement, surface and volume_measurement in one migration (0009)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The contract, the generated client, stub routers and stub jobs

Shell: PowerShell in `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`; backend commands run from `backend\` with `$PY = ".\.venv\Scripts\python.exe"` (the overlay venv of Task 1).

**Files:**
- Modify: `contract/openapi.yaml` (lines 44, 62, 2665, before 2316, after 2600, before 4983, 4985, 5061 — the line numbers are `main`'s at `cd41061`; find each by its quoted text)
- Regenerate: `contract/client/schema.d.ts`
- Create: `backend/app/pointclouds/__init__.py`, `backend/app/surfaces/__init__.py`, `backend/app/surfaces/design/__init__.py`, `backend/app/volumes/__init__.py` (all empty)
- Create: the four routers and six job modules listed below
- Modify: `backend/app/api.py:1` and append after line 98
- Modify: `backend/app/stubs.py:1-6` (docstring)
- Modify: `backend/tests/test_contract.py:52-54` (`EXPECTED_STUBS`), its checks import, the tail of `test_responses_conform`, plus the empty `REFUSES_VALID_DATA` allowance and its guard test
- Test: `backend/tests/test_pointcloud_stubs.py`, `backend/tests/test_pointcloud_router_guard.py`

**Interfaces:**
- Consumes: nothing from earlier tasks except the venv.
- Produces:
  - operationIds (all 501 for now): S1 `listPointClouds`, `createPointCloud`, `inspectPointCloudFile`, `getPointCloud`, `patchPointCloud`, `deletePointCloud`, `getPointCloudOctreeFile`, `listCloudMeasurements`, `createCloudMeasurement`, `updateCloudMeasurement`, `deleteCloudMeasurement`, `createPointCloudExport`; S2 `listSurfaces`, `createSurface`, `getSurface`, `patchSurface`, `deleteSurface`, `getSurfaceTile`, `getSurfaceOrthoTile`, `getSurfaceSample`, `listVolumeMeasurements`, `createVolumeMeasurement`, `getVolumeMeasurement`, `patchVolumeMeasurement`, `deleteVolumeMeasurement`, `calculateVolumeMeasurement`, `getVolumeDiffTile`, `getVolumeFootprints`, `createVolumeExport`; S3 `createDesignInspection`, `getDesignInspection`, `deleteDesignInspection`, `getDesignCandidateThumbnail`, `createDesignPreview`, `getDesignPreview`, `getDesignPreviewImage`, `createDesignSurface`.
  - `app.<pkg>.router.router` (an `APIRouter` with prefix `/projects/{projectId}`) and `STUBS: list[tuple[method, path, operationId]]` in each router; a unit that builds an operation deletes its tuple and its `EXPECTED_STUBS` entry.
  - Registered job functions: `run_pointcloud_import`, `run_pointcloud_export` (`app.pointclouds.jobs_import` / `jobs_export`), `run_surface_build` (`app.surfaces.jobs_build`), `run_volume_calc`, `run_volume_export` (`app.volumes.jobs_calc` / `jobs_export`), `run_design_import` (`app.surfaces.design.jobs`), each `(ctx: JobContext) -> dict`.
  - TypeScript: `components["schemas"]["PointCloudOut"]` etc., and `JobType` with the six new members.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_stubs.py`:

```python
"""Foundation F0: the 37 operations of the point-cloud, volumes and design specs are routed as 501
stubs behind the project-kind guard, and the six new job types are registered.

The 501 checks read each router's STUBS, and the stub-job check skips a job whose F0 body has been
replaced, so S1, S2 and S3 never edit this file: a unit that lands an operation deletes its tuple
from STUBS (and its EXPECTED_STUBS entry) and this test follows. GUARDED_WRITES stays fixed: the
kind guard sits where `app/api.py` includes the routers, so it answers 409 before a stub or a real
handler runs.
"""

import importlib
import inspect
import re

import pytest

from app.jobs.registry import get_job_type

ROUTERS = [
    "app.pointclouds.router",
    "app.surfaces.router",
    "app.volumes.router",
    "app.surfaces.design.router",
]
NEW_JOB_TYPES = [
    "pointcloud_import",
    "pointcloud_export",
    "surface_build",
    "volume_calc",
    "volume_export",
    "design_import",
]
GUARDED_WRITES = [
    ("post", "/pointclouds", {"path": "C:/x.las"}),
    ("post", "/pointclouds/inspect", {"path": "C:/x.las"}),
    ("patch", "/pointclouds/c1", {"name": "x"}),
    ("post", "/pointclouds/c1/exports", {"format": "laz"}),
    ("post", "/surfaces", {"point_cloud_id": "c1"}),
    ("post", "/volume-exports", {"measurement_ids": ["v1"], "formats": ["pdf"]}),
    ("post", "/design-inspections", {"path": "C:/x.dxf"}),
    ("post", "/design-surfaces", {"inspection_id": "i1", "preview_id": "p1"}),
]


def _stubs() -> list[tuple[str, str, str]]:
    """(method, concrete path, operationId) for every operation still routed as a 501 stub."""
    return [
        (method.lower(), re.sub(r"\{[^}]+\}", "x1", path), op_id)
        for module in ROUTERS
        for method, path, op_id in getattr(importlib.import_module(module), "STUBS", [])
    ]


def _project(client, tmp_path, kind):
    body = {"name": kind, "folder": str(tmp_path / kind), "classes": [], "kind": kind}
    r = client.post("/api/v1/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_the_six_job_types_are_registered(app):
    for job_type in NEW_JOB_TYPES:
        assert callable(get_job_type(job_type)), job_type


@pytest.mark.parametrize("job_type", NEW_JOB_TYPES)
def test_each_stub_job_fails_readably_until_its_unit_lands(
    app, client, handle, project_id, wait_job, job_type
):
    if 'raise JobFailure("not implemented")' not in inspect.getsource(get_job_type(job_type)):
        pytest.skip(f"{job_type} is built; its unit's tests cover it")
    job = app.state.jobs.submit(handle, job_type, {})
    done = wait_job(project_id, job.id, timeout=30)
    assert done["state"] == "failed"
    assert done["error"] == "not implemented"
    assert done["type"] == job_type


def test_a_detection_project_reaches_the_501_stubs(client, tmp_path):
    pid = _project(client, tmp_path, "detect")
    for method, path, op_id in _stubs():
        kwargs = {"json": {}} if method in ("post", "patch") else {}
        r = getattr(client, method)(f"/api/v1/projects/{pid}{path}", **kwargs)
        assert r.status_code == 501, (op_id, path, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_a_training_project_may_read_but_not_write(client, tmp_path):
    pid = _project(client, tmp_path, "train")
    assert client.get(f"/api/v1/projects/{pid}/pointclouds").status_code in (200, 501)  # stub or built
    for method, path, body in GUARDED_WRITES:
        r = getattr(client, method)(f"/api/v1/projects/{pid}{path}", json=body)
        assert r.status_code == 409, (path, r.text)
        assert r.json()["error"]["code"] == "wrong_project_kind"


def test_an_unknown_project_is_404(client):
    assert client.get("/api/v1/projects/nope/pointclouds").status_code == 404
```

`backend/tests/test_pointcloud_router_guard.py`:

```python
"""A new router whose import fails costs only its own endpoints, never the app (AGENTS.md invariant).

laspy, scipy and rasterio are native stacks; a broken one in the frozen bundle must not stop the
backend from starting. `app/api.py` includes the four F0 routers inside a guard, like the maps one.
"""

import importlib
import logging
import sys

from fastapi.testclient import TestClient

import app.api
from app.main import create_app


def test_a_router_that_fails_to_import_costs_only_its_endpoints(monkeypatch, settings, caplog):
    # A None entry in sys.modules makes `import app.pointclouds.router` raise ImportError.
    monkeypatch.setitem(sys.modules, "app.pointclouds.router", None)
    try:
        with caplog.at_level(logging.ERROR, logger="app.api"):
            importlib.reload(app.api)
        with TestClient(create_app(settings), headers={"Authorization": "Bearer test-token"}) as client:
            body = {
                "name": "d",
                "folder": str(settings.data_dir.parent / "d"),
                "classes": [],
                "kind": "detect",
            }
            pid = client.post("/api/v1/projects", json=body).json()["id"]
            assert client.get(f"/api/v1/projects/{pid}/pointclouds").status_code == 404
            assert client.get(f"/api/v1/projects/{pid}/surfaces").status_code == 501
            assert client.get("/api/v1/health").status_code == 200
    finally:
        monkeypatch.undo()
        importlib.reload(app.api)  # every later test gets the full router back
    assert "app.pointclouds.router failed to load" in caplog.text
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `& $PY -m pytest tests/test_pointcloud_stubs.py tests/test_pointcloud_router_guard.py -q`
Expected: FAIL — `validation_error: unknown job type 'pointcloud_import'`, `ModuleNotFoundError: No module named 'app.pointclouds'` from `_stubs()`, and 404s where 409 is expected.

- [ ] **Step 3: Edit the contract header: events, tags, error codes**

In `contract/openapi.yaml`, in the `x-websocket` description, after line 44 (the bullet for `map_labels.changed`) insert:

```yaml
    - `pointclouds.changed`: `payload` is `{cloud_ids: [...]}` after a point cloud is created, changes
      status, is patched or deleted, or one of its measurements changes.
    - `surfaces.changed`: `payload` is `{surface_ids: [...]}` after a surface (cloud DSM or design)
      is created, built, renamed or deleted.
    - `volumes.changed`: `payload` is `{measurement_ids: [...]}` after a volume measurement is
      created, calculated, changed, becomes stale or is deleted.
```

After line 62 (`  - name: detect`) insert:

```yaml
  - name: pointclouds
  - name: surfaces
  - name: volumes
```

In the `Error` schema's `code` description, replace its last line (2665, the one ending in `details {model_id, unmapped})` inside backticks) with:

```yaml
                remembered mapping; details `{model_id, unmapped}`), unsupported_point_cloud,
                insufficient_memory and insufficient_disk (422: a point cloud cannot be read or
                admitted), link_needs_coordinates, no_overlap and crs_already_set (422: a point
                cloud patch), grid_too_large (422: a surface grid over the cell ceiling),
                job_running (409: the resource's job is queued or running), not_ready (409:
                the resource has not finished importing), range_not_satisfiable (416)
```

- [ ] **Step 4: Add the paths**

Insert this block after the `detect-exports` path and its blank line, immediately before line 2316 `  # ------------------------------------------------------------------ exports`:

```yaml
  # ------------------------------------------------------------------ point clouds (S1)
  /api/v1/projects/{projectId}/pointclouds:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [pointclouds]
      operationId: listPointClouds
      summary: Every point cloud in the project, newest first.
      responses:
        "200":
          description: point clouds
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PointCloudList" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [pointclouds]
      operationId: createPointCloud
      summary: |
        Import a LAS or LAZ file (a `pointcloud_import` job). The source file is only read and is
        never kept in the project. Validation and the RAM and disk admission run again here; a
        refusal creates no row.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PointCloudCreate" }
      responses:
        "202":
          description: cloud created in `importing`, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PointCloudWithJob" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        "422":
          description: "the file is not a readable LAS/LAZ (`unsupported_point_cloud`), or the import needs more memory (`insufficient_memory`) or disk (`insufficient_disk`) than is free; `message` is the text the UI shows"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/pointclouds/inspect:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [pointclouds]
      operationId: inspectPointCloudFile
      summary: Read a LAS/LAZ file's header and VLRs (at most 1 MiB) and judge admission, without importing it.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PointCloudInspectRequest" }
      responses:
        "200":
          description: the header facts and the admission verdict
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PointCloudFileInfo" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        "422":
          description: "the file is not a readable LAS/LAZ (`unsupported_point_cloud`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/pointclouds/{cloudId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/cloudId"
    get:
      tags: [pointclouds]
      operationId: getPointCloud
      responses:
        "200":
          description: the point cloud
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PointCloudOut" }
        default: { $ref: "#/components/responses/Error" }
    patch:
      tags: [pointclouds]
      operationId: patchPointCloud
      summary: Rename, correct the survey date, link or unlink a map, or assign an EPSG to a cloud that has no CRS.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PointCloudPatch" }
      responses:
        "200":
          description: the updated point cloud
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PointCloudOut" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        "422":
          description: "a map link needs both entities to have a CRS (`link_needs_coordinates`) and overlapping WGS84 bounds (`no_overlap`); `assign_epsg` is refused when the file has a CRS (`crs_already_set`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [pointclouds]
      operationId: deletePointCloud
      summary: Delete the cloud, its measurements and its folder under `pointclouds/`. The source file is untouched.
      responses:
        "204": { description: deleted }
        "409":
          description: "its import or export job is queued or running (`code` is `job_running`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/pointclouds/{cloudId}/octree/{octreeFile}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/cloudId"
      - $ref: "#/components/parameters/octreeFile"
    get:
      tags: [pointclouds]
      operationId: getPointCloudOctreeFile
      summary: |
        One file of the cloud's Potree 2.0 display copy, for the 3D viewer. Exactly one byte range
        (`bytes=a-b`, `bytes=a-` or `bytes=-n`) of at most 64 MiB is answered 206; no `Range`
        answers the whole file with 200 only when it is at most 64 MiB. Multiple ranges, malformed
        syntax, a start at or past the end, a range over 64 MiB, or no `Range` on a bigger file
        answer 416 with `Content-Range: bytes */<size>`. The body streams in 1 MiB chunks.
        `Cache-Control: private, max-age=31536000, immutable`. The token goes in the `token`
        query parameter. The loader's CORS preflight (`Range` and `Content-Type` request headers)
        is answered by the CORS middleware before routing, so there is no OPTIONS operation.
      parameters:
        - name: Range
          in: header
          required: false
          description: one byte range, e.g. `bytes=0-21`
          schema: { type: string }
      responses:
        "200":
          description: the whole file (at most 64 MiB)
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
            application/json:
              schema: { type: object, additionalProperties: true, description: "`metadata.json`" }
        "206":
          description: the requested byte range
          headers:
            Content-Range: { schema: { type: string }, description: "bytes a-b/size" }
            Accept-Ranges: { schema: { type: string, enum: [bytes] } }
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
            application/json:
              schema: { type: string, format: binary, description: "a range of `metadata.json`" }
        "409":
          description: "the cloud is not `ready` (`code` is `not_ready`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "416":
          description: "the range cannot be served (`code` is `range_not_satisfiable`); `Content-Range: bytes */<size>`"
          headers:
            Content-Range: { schema: { type: string }, description: "bytes */size" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/pointclouds/{cloudId}/measurements:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/cloudId"
    get:
      tags: [pointclouds]
      operationId: listCloudMeasurements
      summary: The cloud's saved measurements, oldest first (at most 1 000).
      responses:
        "200":
          description: measurements
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CloudMeasurementList" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [pointclouds]
      operationId: createCloudMeasurement
      summary: Save a measurement. The server recomputes `results` from the points; a client never sends them.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CloudMeasurementCreate" }
      responses:
        "201":
          description: the saved measurement
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CloudMeasurementOut" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        "422":
          description: "the wrong number of points for the kind, a `vertical` check whose points are less than 0.5 m apart vertically, or the cloud already has 1 000 measurements (`code` is `validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/pointclouds/{cloudId}/measurements/{cloudMeasurementId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/cloudId"
      - $ref: "#/components/parameters/cloudMeasurementId"
    patch:
      tags: [pointclouds]
      operationId: updateCloudMeasurement
      summary: Rename a measurement or change its note.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CloudMeasurementUpdate" }
      responses:
        "200":
          description: the updated measurement
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CloudMeasurementOut" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [pointclouds]
      operationId: deleteCloudMeasurement
      responses:
        "204": { description: deleted }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/pointclouds/{cloudId}/exports:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/cloudId"
    post:
      tags: [pointclouds]
      operationId: createPointCloudExport
      summary: |
        Write a LAZ copy of the source file (a `pointcloud_export` job) into
        `exports/<stamp>-cloud-<name>/`, with `cloud.json` and, when asked and any exist,
        `measurements.csv`. The source must still be reachable, with its size and mtime unchanged.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PointCloudExportRequest" }
      responses:
        "202":
          description: job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        "409":
          description: "the cloud is not `ready` (`code` is `not_ready`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }

  # ------------------------------------------------------------------ surfaces (S2 paths 1-8)
  /api/v1/projects/{projectId}/surfaces:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [surfaces]
      operationId: listSurfaces
      summary: Every surface in the project, cloud DSMs and designs.
      responses:
        "200":
          description: surfaces
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SurfaceList" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [surfaces]
      operationId: createSurface
      summary: Build a surface from a ready point cloud (a `surface_build` job).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SurfaceBuildRequest" }
      responses:
        "202":
          description: surface created in `building`, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SurfaceWithJob" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        "422":
          description: "not enough free disk (`insufficient_disk`), a grid over the cell ceiling (`grid_too_large`), a cloud CRS the build cannot use, or an invalid request (`validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/surfaces/{surfaceId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/surfaceId"
    get:
      tags: [surfaces]
      operationId: getSurface
      responses:
        "200":
          description: the surface
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Surface" }
        default: { $ref: "#/components/responses/Error" }
    patch:
      tags: [surfaces]
      operationId: patchSurface
      summary: Rename a surface.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SurfacePatch" }
      responses:
        "200":
          description: the updated surface
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Surface" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [surfaces]
      operationId: deleteSurface
      summary: Delete the surface and its folder under `surfaces/`.
      responses:
        "204": { description: deleted }
        "409":
          description: "a volume measurement uses the surface or its job is queued or running (`code` is `conflict`; the message names them), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/surfaces/{surfaceId}/tiles/{z}/{x}/{y}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/surfaceId"
      - { name: z, in: path, required: true, schema: { type: integer, minimum: 0, maximum: 30 } }
      - { name: x, in: path, required: true, schema: { type: integer, minimum: 0 } }
      - { name: y, in: path, required: true, schema: { type: integer, minimum: 0 } }
    get:
      tags: [surfaces]
      operationId: getSurfaceTile
      summary: One 256 px hillshade tile in the surface's grid; one bounded read. NaN cells are transparent.
      parameters:
        - name: tint
          in: query
          required: false
          description: "multiply by a hypsometric ramp; false when absent"
          schema: { type: boolean }
      responses:
        "200":
          description: tile image
          content:
            image/png:
              schema: { type: string, format: binary }
        "204": { description: the tile is outside the grid or all nodata }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/surfaces/{surfaceId}/ortho-tiles/{z}/{x}/{y}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/surfaceId"
      - { name: z, in: path, required: true, schema: { type: integer, minimum: 0, maximum: 30 } }
      - { name: x, in: path, required: true, schema: { type: integer, minimum: 0 } }
      - { name: y, in: path, required: true, schema: { type: integer, minimum: 0 } }
    get:
      tags: [surfaces]
      operationId: getSurfaceOrthoTile
      summary: One 256 px tile of a map's display raster warped into this surface's grid, for the ortho underlay.
      parameters:
        - name: map_id
          in: query
          required: true
          schema: { type: string }
      responses:
        "200":
          description: tile image; PNG when it holds nodata
          content:
            image/jpeg:
              schema: { type: string, format: binary }
            image/png:
              schema: { type: string, format: binary }
        "204": { description: the map does not overlap this tile }
        "422":
          description: "the map or the surface has no CRS (`code` is `validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/surfaces/{surfaceId}/sample:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/surfaceId"
    get:
      tags: [surfaces]
      operationId: getSurfaceSample
      summary: The surface height at one native point (bilinear over 2 x 2 cells); `z` is null over nodata.
      parameters:
        - { name: x, in: query, required: true, schema: { type: number } }
        - { name: y, in: query, required: true, schema: { type: number } }
      responses:
        "200":
          description: the sample
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SurfaceSample" }
        default: { $ref: "#/components/responses/Error" }

  # ------------------------------------------------------------------ design surfaces (S3)
  /api/v1/projects/{projectId}/design-inspections:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [surfaces]
      operationId: createDesignInspection
      summary: Read a design file (a `design_import` job, phase `inspect`) - hash it, detect units and CRS, and list its candidate surfaces.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/DesignInspectionCreate" }
      responses:
        "202":
          description: inspection created in `inspecting`, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DesignInspectionWithJob" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        "422":
          description: "the file is missing, has an unknown extension, or is a DWG (`code` is `validation_error`; a DWG has `details.reason: \"dwg\"`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/design-inspections/{inspectionId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/inspectionId"
    get:
      tags: [surfaces]
      operationId: getDesignInspection
      responses:
        "200":
          description: the inspection
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DesignInspection" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [surfaces]
      operationId: deleteDesignInspection
      summary: Cancel a running inspect or preview and delete the inspection folder.
      responses:
        "204": { description: deleted }
        "409":
          description: "a build uses the inspection (`code` is `conflict`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/design-inspections/{inspectionId}/candidates/{candidateId}/thumbnail:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/inspectionId"
      - $ref: "#/components/parameters/candidateId"
    get:
      tags: [surfaces]
      operationId: getDesignCandidateThumbnail
      summary: A 160 px plan view of one candidate.
      responses:
        "200":
          description: thumbnail
          content:
            image/png:
              schema: { type: string, format: binary }
        "204": { description: the candidate has no thumbnail }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/design-inspections/{inspectionId}/previews:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/inspectionId"
    post:
      tags: [surfaces]
      operationId: createDesignPreview
      summary: Place, triangulate and rasterise the chosen candidates onto a coarse preview grid and validate them (a `design_import` job, phase `preview`). It cancels the inspection's running preview first.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/DesignImportOptions" }
      responses:
        "202":
          description: preview created in `running`, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DesignPreviewWithJob" }
        "409":
          description: "the inspection is not ready (`code` is `conflict`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "an unknown candidate, an unparseable CRS, or a LandXML or DEM selection of other than one candidate (`code` is `validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/design-inspections/{inspectionId}/previews/{previewId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/inspectionId"
      - $ref: "#/components/parameters/previewId"
    get:
      tags: [surfaces]
      operationId: getDesignPreview
      responses:
        "200":
          description: the preview
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DesignPreview" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/design-inspections/{inspectionId}/previews/{previewId}/image:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/inspectionId"
      - $ref: "#/components/parameters/previewId"
    get:
      tags: [surfaces]
      operationId: getDesignPreviewImage
      summary: The preview's plan image.
      responses:
        "200":
          description: preview image
          content:
            image/png:
              schema: { type: string, format: binary }
        "204": { description: the preview is not ready or failed }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/design-surfaces:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [surfaces]
      operationId: createDesignSurface
      summary: Build the design surface from a ready preview (a `design_import` job, phase `build`); the new `Surface` has `kind` `design`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/DesignSurfaceCreate" }
      responses:
        "202":
          description: surface created in `building`, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SurfaceWithJob" }
        "409":
          description: "the preview is not ready, is not the newest, has `block` warnings, or has `warn` warnings without `accept_warnings` (`code` is `conflict`); or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }

  # ------------------------------------------------------------------ volumes (S2 paths 9-17)
  /api/v1/projects/{projectId}/volumes:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [volumes]
      operationId: listVolumeMeasurements
      summary: Every volume measurement. Recomputes each fingerprint; a changed ready one becomes `stale`.
      responses:
        "200":
          description: measurements
          content:
            application/json:
              schema: { $ref: "#/components/schemas/VolumeMeasurementList" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [volumes]
      operationId: createVolumeMeasurement
      summary: Create a measurement and queue its `volume_calc` job.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/VolumeMeasurementCreate" }
      responses:
        "202":
          description: measurement created in `calculating`, job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/VolumeMeasurementWithJob" }
        "409": { $ref: "#/components/responses/WrongProjectKind" }
        "422":
          description: "a polygon the rules refuse (`invalid_geometry`: self-crossing, too small, too large or off the surface), a base that does not fit (`invalid_base`), or an invalid request (`validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/volumes/{measurementId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/measurementId"
    get:
      tags: [volumes]
      operationId: getVolumeMeasurement
      responses:
        "200":
          description: the measurement
          content:
            application/json:
              schema: { $ref: "#/components/schemas/VolumeMeasurement" }
        default: { $ref: "#/components/responses/Error" }
    patch:
      tags: [volumes]
      operationId: patchVolumeMeasurement
      summary: Change a measurement's inputs; any change other than `name` makes it `stale`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/VolumeMeasurementPatch" }
      responses:
        "200":
          description: the updated measurement
          content:
            application/json:
              schema: { $ref: "#/components/schemas/VolumeMeasurement" }
        "409":
          description: "the measurement is calculating (`code` is `conflict`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "changed inputs the rules refuse (`invalid_geometry`, `invalid_base`), or an invalid request (`validation_error`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [volumes]
      operationId: deleteVolumeMeasurement
      responses:
        "204": { description: deleted }
        "409":
          description: "the measurement is calculating (`code` is `conflict`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/volumes/{measurementId}/calculate:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/measurementId"
    post:
      tags: [volumes]
      operationId: calculateVolumeMeasurement
      summary: Recalculate a measurement (a `volume_calc` job).
      responses:
        "202":
          description: job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/VolumeMeasurementWithJob" }
        "409":
          description: "the measurement is already calculating (`code` is `conflict`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/volumes/{measurementId}/diff-tiles/{z}/{x}/{y}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/measurementId"
      - { name: z, in: path, required: true, schema: { type: integer, minimum: 0, maximum: 30 } }
      - { name: x, in: path, required: true, schema: { type: integer, minimum: 0 } }
      - { name: y, in: path, required: true, schema: { type: integer, minimum: 0 } }
    get:
      tags: [volumes]
      operationId: getVolumeDiffTile
      summary: One 256 px cut/fill tile in the top surface's grid (red below the base, blue above).
      parameters:
        - name: v
          in: query
          required: false
          description: "the results' `computed_at`, for cache busting"
          schema: { type: string }
      responses:
        "200":
          description: tile image
          content:
            image/png:
              schema: { type: string, format: binary }
        "204": { description: the tile is outside the measured cells }
        "409":
          description: "the measurement has no results (`code` is `conflict`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/volumes/{measurementId}/footprints:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/measurementId"
    get:
      tags: [volumes]
      operationId: getVolumeFootprints
      summary: The buffered detection footprints the measurement masks, in the surface CRS; at most 5 000.
      responses:
        "200":
          description: footprints
          content:
            application/json:
              schema: { $ref: "#/components/schemas/VolumeFootprints" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/volume-exports:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [volumes]
      operationId: createVolumeExport
      summary: Write PDF, GeoPackage with cut/fill GeoTIFF, CSV and/or XLSX to `exports/<stamp>-volumes-<title>/` (a `volume_export` job).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/VolumeExportRequest" }
      responses:
        "202":
          description: job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        "409":
          description: "a measurement is not `ready` (`code` is `conflict`), or the project is not a detection project (`code` is `wrong_project_kind`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 5: Add the path parameters**

In `components/parameters`, after the `areaId` parameter (lines 2596–2600) insert:

```yaml
    cloudId:
      name: cloudId
      in: path
      required: true
      schema: { type: string }
    cloudMeasurementId:
      name: cloudMeasurementId
      in: path
      required: true
      description: a point-cloud measurement; `measurementId` is a volume measurement
      schema: { type: string }
    octreeFile:
      name: octreeFile
      in: path
      required: true
      schema: { type: string, enum: [metadata.json, hierarchy.bin, octree.bin] }
    surfaceId:
      name: surfaceId
      in: path
      required: true
      schema: { type: string }
    measurementId:
      name: measurementId
      in: path
      required: true
      description: a volume measurement
      schema: { type: string }
    inspectionId:
      name: inspectionId
      in: path
      required: true
      schema: { type: string }
    previewId:
      name: previewId
      in: path
      required: true
      schema: { type: string }
    candidateId:
      name: candidateId
      in: path
      required: true
      schema: { type: string, pattern: "^c[0-9]{1,6}$" }
```

- [ ] **Step 6: Add the schemas, the job types and the event types**

Insert this block in `components/schemas` after the `RevealRequest` schema (its `example: { path: "exports/2026-09-19_101500" }` line) and immediately before line 4983 `    JobType:`:

```yaml
    # ------------------------------------------------------------ point clouds (S1)
    PointCloudZStats:
      type: object
      description: min, max and mean are exact; the percentiles come from a stride sample of at most 2 M points
      required: [min, max, mean, p01, p1, p5, p50, p95, p99, p999, sample_count]
      properties:
        min: { type: number }
        max: { type: number }
        mean: { type: number }
        p01: { type: number }
        p1: { type: number }
        p5: { type: number }
        p50: { type: number }
        p95: { type: number }
        p99: { type: number }
        p999: { type: number }
        sample_count: { type: integer }
    PointCloudOut:
      type: object
      required: [id, name, status, error, source_path, source_size, source_sha256, las_version, point_format, point_count, has_rgb, scale, crs_wkt, epsg, proj4, vertical_crs, crs_source, bounds_native, bounds_repaired, bounds_wgs84, octree_spacing_m, z_stats, class_counts, octree_bytes, captured_on, map_id, job_id, created_at]
      properties:
        id: { type: string }
        name: { type: string }
        status: { type: string, enum: [importing, ready, failed] }
        error: { type: [string, "null"], description: readable text when `failed` }
        source_path: { type: string, description: the original file; only ever read, never kept in the project }
        source_size: { type: integer, format: int64 }
        source_sha256: { type: [string, "null"], description: streamed while the work copy is made }
        las_version: { type: [string, "null"], description: "e.g. `1.2`" }
        point_format: { type: [integer, "null"] }
        point_count: { type: [integer, "null"], format: int64, description: the scanned count }
        has_rgb: { type: [boolean, "null"] }
        scale:
          type: [array, "null"]
          description: the header scales sx, sy, sz; the coordinate precision shown with every pick
          items: { type: number }
          minItems: 3
          maxItems: 3
        crs_wkt: { type: [string, "null"], description: the horizontal CRS; null means no coordinates }
        epsg: { type: [integer, "null"] }
        proj4: { type: [string, "null"], description: for client-side conversions }
        vertical_crs: { type: [string, "null"], description: the vertical CRS name; null means heights as stored, no vertical datum }
        crs_source:
          type: [string, "null"]
          enum: [file, assigned, null]
        bounds_native:
          type: [array, "null"]
          description: minx, miny, minz, maxx, maxy, maxz; the true bounds from the scan
          items: { type: number }
          minItems: 6
          maxItems: 6
        bounds_repaired: { type: [boolean, "null"], description: true when the header bounds did not contain every point }
        bounds_wgs84:
          type: [array, "null"]
          description: minlon, minlat, maxlon, maxlat
          items: { type: number }
          minItems: 4
          maxItems: 4
        octree_spacing_m: { type: [number, "null"], description: the octree root node's spacing, not the point spacing }
        z_stats: { oneOf: [{ $ref: "#/components/schemas/PointCloudZStats" }, { type: "null" }] }
        class_counts:
          type: [object, "null"]
          description: the ASPRS classification histogram, keyed by class code
          additionalProperties: { type: integer }
        octree_bytes: { type: [integer, "null"], format: int64 }
        captured_on: { type: [string, "null"], format: date, description: when the survey was flown }
        map_id: { type: [string, "null"], description: the linked orthomosaic }
        job_id: { type: [string, "null"] }
        created_at: { type: string, format: date-time }
      example:
        id: "c0000000-8888-4000-8000-000000000001"
        name: "Chimney stack 3D"
        status: ready
        error: null
        source_path: "\\\\DanNas\\surveys\\chimney.las"
        source_size: 773872531
        source_sha256: "9f2c0d8e7a1b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5"
        las_version: "1.2"
        point_format: 3
        point_count: 21697184
        has_rgb: true
        scale: [0.001, 0.001, 0.001]
        crs_wkt: "PROJCS[\"WGS 84 / UTM zone 39N\"]"
        epsg: 32639
        proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs"
        vertical_crs: null
        crs_source: file
        bounds_native: [553012.4, 2847210.9, -52.3, 553198.7, 2847402.1, 31.8]
        bounds_repaired: true
        bounds_wgs84: [51.5301, 25.7331, 51.5320, 25.7349]
        octree_spacing_m: 1.52
        z_stats: { min: -52.3, max: 31.8, mean: -41.2, p01: -46.1, p1: -45.9, p5: -45.6, p50: -44.8, p95: -30.2, p99: -5.1, p999: 20.4, sample_count: 1972472 }
        class_counts: { "0": 21697184 }
        octree_bytes: 137390210
        captured_on: "2026-09-10"
        map_id: null
        job_id: "j0000000-4444-4000-8000-000000000001"
        created_at: "2026-09-23T10:00:00Z"
    PointCloudList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/PointCloudOut" }
    PointCloudCreate:
      type: object
      required: [path]
      properties:
        path: { type: string, minLength: 1, description: absolute path of a .las or .laz file }
        name: { type: string, minLength: 1, maxLength: 200, description: the file stem when absent }
        map_id: { type: string, description: link this map on import; subject to the same checks as a PATCH }
    PointCloudWithJob:
      type: object
      required: [cloud, job]
      properties:
        cloud: { $ref: "#/components/schemas/PointCloudOut" }
        job: { $ref: "#/components/schemas/Job" }
    PointCloudPatch:
      type: object
      additionalProperties: false
      properties:
        name: { type: string, minLength: 1, maxLength: 200 }
        captured_on: { type: [string, "null"], format: date, description: when the survey was flown; null clears it }
        map_id: { type: [string, "null"], description: link a map; null unlinks }
        assign_epsg: { type: integer, description: only when the cloud has no CRS (`crs_wkt` is null); the cloud is never reprojected }
    PointCloudInspectRequest:
      type: object
      required: [path]
      properties:
        path: { type: string, minLength: 1, description: absolute path of a .las or .laz file }
    PointCloudAdmission:
      type: object
      required: [ok, ram_needed_bytes, ram_available_bytes, disk_needed_bytes, disk_available_bytes, reason]
      properties:
        ok: { type: boolean }
        ram_needed_bytes: { type: integer, format: int64 }
        ram_available_bytes: { type: integer, format: int64 }
        disk_needed_bytes: { type: integer, format: int64 }
        disk_available_bytes: { type: integer, format: int64 }
        reason: { type: [string, "null"], description: when `ok` is false, the message the UI shows verbatim }
    PointCloudFileInfo:
      type: object
      required: [path, size, compressed, las_version, point_format, point_count, has_rgb, header_bounds, crs_wkt, epsg, captured_on, admission]
      properties:
        path: { type: string }
        size: { type: integer, format: int64 }
        compressed: { type: boolean, description: true for LAZ }
        las_version: { type: string }
        point_format: { type: integer }
        point_count: { type: integer, format: int64, description: the header's count }
        has_rgb: { type: boolean }
        header_bounds:
          type: array
          description: minx, miny, minz, maxx, maxy, maxz as the header states them
          items: { type: number }
          minItems: 6
          maxItems: 6
        crs_wkt: { type: [string, "null"] }
        epsg: { type: [integer, "null"] }
        captured_on: { type: [string, "null"], format: date }
        admission: { $ref: "#/components/schemas/PointCloudAdmission" }
    CloudMeasurementKind:
      type: string
      enum: [point, distance, height, vertical]
    CloudMeasurementPoint:
      type: object
      required: [x, y, z, uncertainty_m]
      properties:
        x: { type: number, description: native CRS }
        y: { type: number }
        z: { type: number }
        uncertainty_m: { type: number, minimum: 0, description: the display spacing of the deepest loaded node that contains the pick }
    CloudMeasurementCreate:
      type: object
      required: [kind, points]
      properties:
        kind: { $ref: "#/components/schemas/CloudMeasurementKind" }
        points:
          type: array
          description: one point for `point`, two for the other kinds
          items: { $ref: "#/components/schemas/CloudMeasurementPoint" }
          minItems: 1
          maxItems: 2
        name: { type: string, minLength: 1, maxLength: 200, description: "\"Distance 3\"-style numbering when absent" }
        note: { type: string, maxLength: 2000 }
    CloudMeasurementUpdate:
      type: object
      additionalProperties: false
      properties:
        name: { type: string, minLength: 1, maxLength: 200 }
        note: { type: [string, "null"], maxLength: 2000, description: null clears it }
    CloudMeasurementResults:
      type: object
      description: computed by the server from the stored points; a quantity that does not apply to the kind is null
      required: [lon, lat, dx, dy, dz, distance_3d, distance_horizontal, distance_vertical, height_difference, lean_offset_m, lean_angle_deg, lean_azimuth_deg, lean_mm_per_m, uncertainty_m, angle_uncertainty_deg]
      properties:
        lon: { type: [number, "null"] }
        lat: { type: [number, "null"] }
        dx: { type: [number, "null"] }
        dy: { type: [number, "null"] }
        dz: { type: [number, "null"] }
        distance_3d: { type: [number, "null"] }
        distance_horizontal: { type: [number, "null"] }
        distance_vertical: { type: [number, "null"] }
        height_difference: { type: [number, "null"], description: second pick minus first, signed }
        lean_offset_m: { type: [number, "null"] }
        lean_angle_deg: { type: [number, "null"], description: degrees from vertical }
        lean_azimuth_deg: { type: [number, "null"], description: the top relative to the base, clockwise from grid north }
        lean_mm_per_m: { type: [number, "null"] }
        uncertainty_m: { type: [number, "null"] }
        angle_uncertainty_deg: { type: [number, "null"] }
    CloudMeasurementOut:
      type: object
      required: [id, point_cloud_id, kind, name, note, points, results, created_at, updated_at]
      properties:
        id: { type: string }
        point_cloud_id: { type: string }
        kind: { $ref: "#/components/schemas/CloudMeasurementKind" }
        name: { type: string }
        note: { type: [string, "null"] }
        points:
          type: array
          items: { $ref: "#/components/schemas/CloudMeasurementPoint" }
          minItems: 1
          maxItems: 2
        results: { $ref: "#/components/schemas/CloudMeasurementResults" }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    CloudMeasurementList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/CloudMeasurementOut" }
    PointCloudExportRequest:
      type: object
      required: [format]
      properties:
        format: { type: string, enum: [laz] }
        include_measurements: { type: boolean, description: "true when absent: write measurements.csv when the cloud has measurements" }
    # ------------------------------------------------------------ surfaces and volumes (S2)
    SurfaceKind:
      type: string
      enum: [cloud_dsm, design]
    SurfaceStatus:
      type: string
      enum: [building, ready, failed]
    SurfaceMethod:
      type: string
      description: "median, mean, max and min are cloud statistics (S2); tin, delaunay, dem_resample and dem_copy are design methods (S3)"
      enum: [median, mean, max, min, tin, delaunay, dem_resample, dem_copy]
    SurfaceBuildMethod:
      type: string
      enum: [median, mean, max, min]
    SurfaceBuildParams:
      type: object
      description: the build request with the defaults resolved
      required: [point_cloud_id, name, method, cell_size_m, auto_cell, hole_fill_max_gap_m, despike_m, z_clip, drop_noise_classes, assume_metres]
      properties:
        point_cloud_id: { type: string }
        name: { type: string }
        method: { $ref: "#/components/schemas/SurfaceBuildMethod" }
        cell_size_m: { type: number, description: the cell size actually used }
        auto_cell: { type: boolean }
        hole_fill_max_gap_m: { type: number }
        despike_m: { type: [number, "null"] }
        z_clip:
          type: [array, "null"]
          items: { type: number }
          minItems: 2
          maxItems: 2
        drop_noise_classes: { type: boolean }
        assume_metres: { type: boolean }
    SurfaceBuildStats:
      type: object
      required: [points_read, points_used, points_dropped, density_per_m2, spacing_m, auto_cell, cells_valid, cells_despiked, cells_filled, z_p02, z_p98, reprojected_from_epsg, build_s]
      properties:
        points_read: { type: integer }
        points_used: { type: integer }
        points_dropped:
          type: object
          required: [noise_class, withheld, z_clip]
          properties:
            noise_class: { type: integer }
            withheld: { type: integer }
            z_clip: { type: integer }
        density_per_m2: { type: [number, "null"] }
        spacing_m: { type: [number, "null"] }
        auto_cell: { type: boolean }
        cells_valid: { type: integer }
        cells_despiked: { type: integer }
        cells_filled: { type: integer }
        z_p02: { type: [number, "null"] }
        z_p98: { type: [number, "null"] }
        reprojected_from_epsg: { type: [integer, "null"] }
        build_s: { type: number }
    Surface:
      type: object
      required: [id, name, kind, status, error, point_cloud_id, design_source, crs_wkt, epsg, proj4, cell_size_m, width, height, geotransform, bounds_native, z_min, z_max, coverage_fraction, method, build_params, stats, captured_on, map_id, tile_grid, measurement_count, job_id, created_at]
      properties:
        id: { type: string }
        name: { type: string }
        kind: { $ref: "#/components/schemas/SurfaceKind" }
        status: { $ref: "#/components/schemas/SurfaceStatus" }
        error: { type: [string, "null"] }
        point_cloud_id: { type: [string, "null"] }
        design_source: { oneOf: [{ $ref: "#/components/schemas/DesignSource" }, { type: "null" }], description: null for cloud_dsm }
        crs_wkt: { type: [string, "null"], description: null means local metres }
        epsg: { type: [integer, "null"] }
        proj4: { type: [string, "null"], description: derived from crs_wkt at response time }
        cell_size_m: { type: [number, "null"], description: null while building }
        width: { type: [integer, "null"] }
        height: { type: [integer, "null"] }
        geotransform:
          type: [array, "null"]
          description: GDAL order, north-up
          items: { type: number }
          minItems: 6
          maxItems: 6
        bounds_native:
          type: [array, "null"]
          description: minx, miny, maxx, maxy of the grid
          items: { type: number }
          minItems: 4
          maxItems: 4
        z_min: { type: [number, "null"] }
        z_max: { type: [number, "null"] }
        coverage_fraction: { type: [number, "null"] }
        method: { oneOf: [{ $ref: "#/components/schemas/SurfaceMethod" }, { type: "null" }], description: null while building }
        build_params: { oneOf: [{ $ref: "#/components/schemas/SurfaceBuildParams" }, { type: "null" }], description: null for design }
        stats: { oneOf: [{ $ref: "#/components/schemas/SurfaceBuildStats" }, { type: "null" }], description: null for design }
        captured_on: { type: [string, "null"], format: date, description: read through from the cloud }
        map_id: { type: [string, "null"], description: read through from the cloud; the ortho of the same flight }
        tile_grid: { oneOf: [{ $ref: "#/components/schemas/TileGrid" }, { type: "null" }] }
        measurement_count: { type: integer }
        job_id: { type: [string, "null"] }
        created_at: { type: string, format: date-time }
    SurfaceList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/Surface" }
    SurfaceBuildRequest:
      type: object
      required: [point_cloud_id]
      properties:
        point_cloud_id: { type: string }
        name: { type: string }
        method: { $ref: "#/components/schemas/SurfaceBuildMethod" }
        cell_size_m: { type: [number, "null"], minimum: 0.01, maximum: 5, description: auto when absent or null }
        hole_fill_max_gap_m: { type: number, minimum: 0, maximum: 10, description: "1.0 when absent; 0 = off" }
        despike_m: { type: [number, "null"], minimum: 0.1, maximum: 100, description: "1.0 when absent; null = off" }
        z_clip:
          type: [array, "null"]
          items: { type: number }
          minItems: 2
          maxItems: 2
        drop_noise_classes: { type: boolean, description: true when absent }
        assume_metres: { type: boolean, description: false when absent }
    SurfacePatch:
      type: object
      properties:
        name: { type: string, minLength: 1 }
    SurfaceWithJob:
      type: object
      required: [surface, job]
      properties:
        surface: { $ref: "#/components/schemas/Surface" }
        job: { $ref: "#/components/schemas/Job" }
    SurfaceSample:
      type: object
      required: [x, y, z]
      properties:
        x: { type: number }
        y: { type: number }
        z: { type: [number, "null"], description: null over nodata }
    VolumeStatus:
      type: string
      enum: [calculating, ready, failed, stale]
    VolumeBaseKind:
      type: string
      enum: [toe_plane, toe_surface, flat, surface]
    VolumeBase:
      type: object
      required: [kind]
      description: z is required for flat and surface_id for surface; the server answers 422 otherwise
      properties:
        kind: { $ref: "#/components/schemas/VolumeBaseKind" }
        z: { type: [number, "null"] }
        surface_id: { type: [string, "null"] }
    VolumeRing:
      type: array
      description: "[x, y] vertices in the top surface's CRS"
      minItems: 3
      maxItems: 5000
      items:
        type: array
        items: { type: number }
        minItems: 2
        maxItems: 2
    ExclusionMode:
      type: string
      enum: [patch, exclude]
    ExclusionPolygon:
      type: object
      required: [id, ring, mode]
      properties:
        id: { type: string, description: client-generated (a UUID) so edits can target it }
        ring: { $ref: "#/components/schemas/VolumeRing" }
        mode: { $ref: "#/components/schemas/ExclusionMode" }
    VolumeMasks:
      type: object
      required: [detection_run_ids, class_ids, buffer_m, exclusion_polygons]
      properties:
        detection_run_ids: { type: array, items: { type: string } }
        class_ids: { type: [array, "null"], items: { type: string }, description: null means every class }
        buffer_m: { type: number, minimum: 0, maximum: 5 }
        exclusion_polygons: { type: array, items: { $ref: "#/components/schemas/ExclusionPolygon" } }
    VolumeMasksInput:
      type: object
      description: fields that are sent replace the stored ones
      properties:
        detection_run_ids: { type: array, items: { type: string }, description: "[] when absent" }
        class_ids: { type: [array, "null"], items: { type: string }, description: null when absent }
        buffer_m: { type: number, minimum: 0, maximum: 5, description: "1.0 when absent" }
        exclusion_polygons: { type: array, items: { $ref: "#/components/schemas/ExclusionPolygon" }, description: "[] when absent" }
    AlignmentMeasured:
      type: object
      required: [n_cells, median_dz, mad, sigma, tilt_mm_per_m, span_m]
      properties:
        n_cells: { type: integer }
        median_dz: { type: number }
        mad: { type: number }
        sigma: { type: number }
        tilt_mm_per_m: { type: number }
        span_m: { type: number }
    VolumeAlignment:
      type: object
      required: [stable_polygon, apply_shift, measured]
      properties:
        stable_polygon: { oneOf: [{ $ref: "#/components/schemas/VolumeRing" }, { type: "null" }] }
        apply_shift: { type: boolean }
        measured: { oneOf: [{ $ref: "#/components/schemas/AlignmentMeasured" }, { type: "null" }] }
    VolumeAlignmentInput:
      type: object
      properties:
        stable_polygon: { oneOf: [{ $ref: "#/components/schemas/VolumeRing" }, { type: "null" }], description: null when absent }
        apply_shift: { type: boolean, description: false when absent }
    VolumeWarningCode:
      type: string
      enum: [nodata_high, patch_too_large, patch_failed, edge_coverage_low, base_fit_poor, stable_area_small, no_stable_area, alignment_offset, alignment_datum, alignment_noisy, alignment_tilt, mask_other_flight]
    VolumeWarning:
      type: object
      required: [code, severity, message]
      properties:
        code: { $ref: "#/components/schemas/VolumeWarningCode" }
        severity: { type: string, enum: [warn, danger] }
        message: { type: string }
    VolumeTotals:
      type: object
      required: [fill_m3, cut_m3, net_m3]
      properties:
        fill_m3: { type: number }
        cut_m3: { type: number }
        net_m3: { type: number }
    BaseFit:
      type: object
      required: [kind, samples, rejected, usable_edge_fraction, rms_m, plane]
      properties:
        kind: { $ref: "#/components/schemas/VolumeBaseKind" }
        samples: { type: integer }
        rejected: { type: integer }
        usable_edge_fraction: { type: number }
        rms_m: { type: number }
        plane:
          type: [array, "null"]
          items: { type: number }
          minItems: 3
          maxItems: 3
    VolumeUncertainty:
      type: object
      required: [total_m3, base_m3, alignment_m3, cell_size_m3, nodata_m3, patch_m3, complete]
      properties:
        total_m3: { type: [number, "null"] }
        base_m3: { type: [number, "null"] }
        alignment_m3: { type: [number, "null"] }
        cell_size_m3: { type: [number, "null"] }
        nodata_m3: { type: [number, "null"] }
        patch_m3: { type: [number, "null"] }
        complete: { type: boolean }
    SurfaceRef:
      type: object
      description: a provenance snapshot of a surface at calculation time
      required: [id, name, kind, method, cell_size_m, captured_on, cloud_file, cloud_sha256]
      properties:
        id: { type: string }
        name: { type: string }
        kind: { $ref: "#/components/schemas/SurfaceKind" }
        method: { oneOf: [{ $ref: "#/components/schemas/SurfaceMethod" }, { type: "null" }] }
        cell_size_m: { type: number }
        captured_on: { type: [string, "null"], format: date }
        cloud_file: { type: [string, "null"] }
        cloud_sha256: { type: [string, "null"] }
    VolumeResults:
      type: object
      additionalProperties: false
      required: [fill_m3, cut_m3, net_m3, area_m2, polygon_area_m2, measured_area_m2, masked_area_m2, excluded_area_m2, nodata_area_m2, cell_size_m, areal_scale_factor, shift_applied_m, diff_scale_m, duration_s, footprints_used, patch_regions, unshifted, alignment, base_fit, uncertainty, warnings, top_surface, base_surface, inputs, inputs_fingerprint, engine_version, computed_at]
      properties:
        fill_m3: { type: number }
        cut_m3: { type: number }
        net_m3: { type: number }
        area_m2: { type: number }
        polygon_area_m2: { type: number }
        measured_area_m2: { type: number }
        masked_area_m2: { type: number }
        excluded_area_m2: { type: number }
        nodata_area_m2: { type: number }
        cell_size_m: { type: number }
        areal_scale_factor: { type: number }
        shift_applied_m: { type: number }
        diff_scale_m: { type: number }
        duration_s: { type: number }
        footprints_used: { type: integer }
        patch_regions: { type: integer }
        unshifted: { oneOf: [{ $ref: "#/components/schemas/VolumeTotals" }, { type: "null" }] }
        alignment: { oneOf: [{ $ref: "#/components/schemas/AlignmentMeasured" }, { type: "null" }] }
        base_fit: { oneOf: [{ $ref: "#/components/schemas/BaseFit" }, { type: "null" }] }
        uncertainty: { $ref: "#/components/schemas/VolumeUncertainty" }
        warnings: { type: array, items: { $ref: "#/components/schemas/VolumeWarning" } }
        top_surface: { $ref: "#/components/schemas/SurfaceRef" }
        base_surface: { oneOf: [{ $ref: "#/components/schemas/SurfaceRef" }, { type: "null" }] }
        inputs: { type: object, additionalProperties: true, description: a canonical snapshot of the inputs }
        inputs_fingerprint: { type: string, description: sha256 of the canonical JSON of `inputs` }
        engine_version: { type: integer }
        computed_at: { type: string, format: date-time }
    VolumeMeasurement:
      type: object
      required: [id, name, status, error, polygon_native, top_surface_id, base, masks, alignment, results, stale_reasons, job_id, created_at, updated_at]
      properties:
        id: { type: string }
        name: { type: string }
        status: { $ref: "#/components/schemas/VolumeStatus" }
        error: { type: [string, "null"] }
        polygon_native: { $ref: "#/components/schemas/VolumeRing" }
        top_surface_id: { type: string }
        base: { $ref: "#/components/schemas/VolumeBase" }
        masks: { $ref: "#/components/schemas/VolumeMasks" }
        alignment: { $ref: "#/components/schemas/VolumeAlignment" }
        results: { oneOf: [{ $ref: "#/components/schemas/VolumeResults" }, { type: "null" }] }
        stale_reasons: { type: array, items: { type: string }, description: "response only: the inputs that changed, e.g. \"masks: detection run deleted\"" }
        job_id: { type: [string, "null"] }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    VolumeMeasurementList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/VolumeMeasurement" }
    VolumeMeasurementCreate:
      type: object
      required: [name, polygon_native, top_surface_id, base]
      properties:
        name: { type: string, minLength: 1 }
        polygon_native: { $ref: "#/components/schemas/VolumeRing" }
        top_surface_id: { type: string }
        base: { $ref: "#/components/schemas/VolumeBase" }
        masks: { $ref: "#/components/schemas/VolumeMasksInput" }
        alignment: { $ref: "#/components/schemas/VolumeAlignmentInput" }
    VolumeMeasurementPatch:
      type: object
      minProperties: 1
      properties:
        name: { type: string, minLength: 1 }
        polygon_native: { $ref: "#/components/schemas/VolumeRing" }
        top_surface_id: { type: string }
        base: { $ref: "#/components/schemas/VolumeBase" }
        masks: { $ref: "#/components/schemas/VolumeMasksInput" }
        alignment: { $ref: "#/components/schemas/VolumeAlignmentInput" }
    VolumeMeasurementWithJob:
      type: object
      required: [measurement, job]
      properties:
        measurement: { $ref: "#/components/schemas/VolumeMeasurement" }
        job: { $ref: "#/components/schemas/Job" }
    VolumeFootprint:
      type: object
      required: [run_id, detection_id, class_id, ring]
      properties:
        run_id: { type: string }
        detection_id: { type: string }
        class_id: { type: string }
        ring: { $ref: "#/components/schemas/VolumeRing" }
    VolumeFootprints:
      type: object
      required: [items, truncated]
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/VolumeFootprint" } }
        truncated: { type: boolean, description: true past 5 000 footprints }
    VolumeExportFormat:
      type: string
      enum: [pdf, gpkg, csv, xlsx]
    VolumeExportRequest:
      type: object
      required: [measurement_ids, formats]
      properties:
        measurement_ids: { type: array, items: { type: string }, minItems: 1, uniqueItems: true }
        formats: { type: array, items: { $ref: "#/components/schemas/VolumeExportFormat" }, minItems: 1, uniqueItems: true }
        title: { type: string, maxLength: 200, description: the project name when absent }
    # ------------------------------------------------------------ design surfaces (S3)
    DesignFormat: { type: string, enum: [geotiff, landxml, dxf] }
    LinearUnit: { type: string, enum: [millimetre, centimetre, metre, international_foot, us_survey_foot] }
    DesignGeometry: { type: string, enum: [faces, points, raster, none] }
    DesignCandidateKind: { type: string, enum: [dem, tin_surface, dxf_layer] }
    DesignWarningLevel: { type: string, enum: [info, warn, block] }
    DesignInspectionCreate:
      type: object
      required: [path]
      properties:
        path: { type: string, minLength: 1, description: absolute path of a .tif/.tiff, .xml/.landxml or .dxf file }
    DesignRasterInfo:
      type: object
      required: [width, height, cell_x, cell_y, dtype, nodata, band_count]
      properties:
        width: { type: integer }
        height: { type: integer }
        cell_x: { type: number }
        cell_y: { type: number }
        dtype: { type: string }
        nodata: { type: [number, "null"] }
        band_count: { type: integer }
    DesignCandidate:
      type: object
      required: [id, kind, name, geometry, bounds_file, z_min, z_max, point_count, face_count, entity_counts, default_selected, notes, raster]
      properties:
        id: { type: string, pattern: "^c[0-9]{1,6}$" }
        kind: { $ref: "#/components/schemas/DesignCandidateKind" }
        name: { type: string }
        geometry: { $ref: "#/components/schemas/DesignGeometry" }
        bounds_file: { type: array, items: { type: number }, minItems: 4, maxItems: 4, description: "[minx, miny, maxx, maxy] in file units, x = easting (LandXML N/E already applied)" }
        z_min: { type: [number, "null"] }
        z_max: { type: [number, "null"] }
        point_count: { type: integer }
        face_count: { type: integer }
        entity_counts: { type: object, additionalProperties: { type: integer }, description: "DXF: 3dface, mesh, polyface, polymesh, polyline_3d, polyline_2d, lwpolyline, line, point, unsupported; LandXML: invisible_faces" }
        default_selected: { type: boolean }
        notes: { type: array, items: { $ref: "#/components/schemas/DesignWarning" } }
        raster: { oneOf: [{ $ref: "#/components/schemas/DesignRasterInfo" }, { type: "null" }] }
    DesignDetected:
      type: object
      required: [horizontal_unit, vertical_unit, unit_source, crs_wkt, epsg, crs_source, crs_hint]
      properties:
        horizontal_unit: { oneOf: [{ $ref: "#/components/schemas/LinearUnit" }, { type: "null" }] }
        vertical_unit: { oneOf: [{ $ref: "#/components/schemas/LinearUnit" }, { type: "null" }] }
        unit_source: { type: string, description: "e.g. 'LandXML <Imperial linearUnit=USSurveyFoot>', 'DXF $INSUNITS=6', 'CRS axis unit', 'none'" }
        crs_wkt: { type: [string, "null"] }
        epsg: { type: [integer, "null"] }
        crs_source: { type: [string, "null"] }
        crs_hint: { type: [string, "null"], description: an unverified CRS name (DXF GEODATA, LandXML name) }
    DesignInspection:
      type: object
      required: [id, state, error, job_id, path, format, file_size, sha256, detected, candidates, default_target_surface_id, created_at]
      properties:
        id: { type: string }
        state: { type: string, enum: [inspecting, ready, failed] }
        error: { type: [string, "null"] }
        job_id: { type: string }
        path: { type: string }
        format: { $ref: "#/components/schemas/DesignFormat" }
        file_size: { type: integer }
        sha256: { type: [string, "null"] }
        detected: { oneOf: [{ $ref: "#/components/schemas/DesignDetected" }, { type: "null" }] }
        candidates: { type: array, items: { $ref: "#/components/schemas/DesignCandidate" } }
        default_target_surface_id: { type: [string, "null"] }
        created_at: { type: string, format: date-time }
    DesignInspectionWithJob:
      type: object
      required: [inspection, job]
      properties:
        inspection: { $ref: "#/components/schemas/DesignInspection" }
        job: { $ref: "#/components/schemas/Job" }
    DesignImportOptions:
      type: object
      required: [candidate_ids, source_crs, horizontal_unit, vertical_unit]
      properties:
        candidate_ids: { type: array, minItems: 1, items: { type: string, pattern: "^c[0-9]{1,6}$" } }
        source_crs: { type: string, minLength: 1, description: "'EPSG:<code>' or WKT; parsed with pyproj.CRS.from_user_input" }
        horizontal_unit: { $ref: "#/components/schemas/LinearUnit" }
        vertical_unit: { $ref: "#/components/schemas/LinearUnit" }
        swap_xy: { type: boolean, description: "false when absent" }
        target_surface_id: { type: [string, "null"], description: "null when absent. A ready cloud_dsm surface; the output adopts its CRS and cell size on the aligned lattice (same_lattice with it)" }
        cell_size_m: { type: [number, "null"], exclusiveMinimum: 0, description: "null when absent; required when target_surface_id is null; ignored otherwise; default in the UI 0.25" }
        max_edge_m: { type: [number, "null"], minimum: 0, description: "null when absent. Points geometry only; null = automatic, 0 = off" }
    DesignWarning:
      type: object
      required: [code, level, message]
      properties:
        code: { type: string, description: "no_overlap, low_overlap, no_target, looks_geographic, looks_local, foot_ambiguity, units_mismatch_crs, units_assumed, z_offset, z_units, crs_assumed, crs_from_file, overlapping_triangles, long_edges_removed, duplicate_points, degenerate_triangles, sentinel_nodata, nodata_unknown, no_heights, unsupported_entities, chorded_arcs, mixed_geometry, nothing_to_triangulate, empty_result, geographic_output, non_metric_output, unsupported_crs_unit, grid_too_large, large_grid, not_tin" }
        level: { $ref: "#/components/schemas/DesignWarningLevel" }
        message: { type: string }
    DesignSuggestion:
      type: object
      required: [code, message, overlap_fraction, options_patch]
      properties:
        code: { type: string, enum: [swap_xy, horizontal_unit] }
        message: { type: string }
        overlap_fraction: { type: number }
        options_patch: { type: object, additionalProperties: true, description: keys of DesignImportOptions to overwrite }
    DesignPreviewOutput:
      type: object
      required: [crs_wkt, epsg, cell_size_m, width, height, bounds_native, preview_cell_size_m]
      properties:
        crs_wkt: { type: string }
        epsg: { type: [integer, "null"] }
        cell_size_m: { type: number }
        width: { type: integer }
        height: { type: integer }
        bounds_native: { type: array, items: { type: number }, minItems: 4, maxItems: 4 }
        preview_cell_size_m: { type: number }
    DesignZCheck:
      type: object
      required: [median_dz_m, p05_dz_m, p95_dz_m, n_samples, design_z_min_m, design_z_max_m]
      properties:
        median_dz_m: { type: number }
        p05_dz_m: { type: number }
        p95_dz_m: { type: number }
        n_samples: { type: integer }
        design_z_min_m: { type: number }
        design_z_max_m: { type: number }
    DesignPreview:
      type: object
      required: [id, inspection_id, state, error, job_id, options, output, triangle_count, overlap_fraction, target_covered_fraction, design_area_m2, z_check, warnings, suggestions, created_at]
      properties:
        id: { type: string }
        inspection_id: { type: string }
        state: { type: string, enum: [running, ready, failed] }
        error: { type: [string, "null"] }
        job_id: { type: string }
        options: { $ref: "#/components/schemas/DesignImportOptions" }
        output: { oneOf: [{ $ref: "#/components/schemas/DesignPreviewOutput" }, { type: "null" }] }
        triangle_count: { type: [integer, "null"] }
        overlap_fraction: { type: [number, "null"] }
        target_covered_fraction: { type: [number, "null"] }
        design_area_m2: { type: [number, "null"] }
        z_check: { oneOf: [{ $ref: "#/components/schemas/DesignZCheck" }, { type: "null" }] }
        warnings: { type: array, items: { $ref: "#/components/schemas/DesignWarning" } }
        suggestions: { type: array, items: { $ref: "#/components/schemas/DesignSuggestion" } }
        created_at: { type: string, format: date-time }
    DesignPreviewWithJob:
      type: object
      required: [preview, job]
      properties:
        preview: { $ref: "#/components/schemas/DesignPreview" }
        job: { $ref: "#/components/schemas/Job" }
    DesignSurfaceCreate:
      type: object
      required: [inspection_id, preview_id]
      properties:
        inspection_id: { type: string }
        preview_id: { type: string }
        name: { type: string, minLength: 1, maxLength: 200 }
        accept_warnings: { type: boolean, description: "false when absent" }
    DesignSource:
      type: object
      required: [path, format, units, vertical_units, sha256, candidates, source_crs_wkt, source_epsg, swap_xy, max_edge_m, aligned_to_surface_id, accepted_warnings]
      properties:
        path: { type: string }
        format: { $ref: "#/components/schemas/DesignFormat" }
        units: { oneOf: [{ $ref: "#/components/schemas/LinearUnit" }, { type: "null" }] }
        vertical_units: { $ref: "#/components/schemas/LinearUnit" }
        sha256: { type: string }
        candidates: { type: array, items: { type: string } }
        source_crs_wkt: { type: string }
        source_epsg: { type: [integer, "null"] }
        swap_xy: { type: boolean }
        max_edge_m: { type: [number, "null"] }
        aligned_to_surface_id: { type: [string, "null"] }
        accepted_warnings: { type: array, items: { type: string } }
```

Replace the `JobType` enum (line 4985) with:

```yaml
      enum: [import, dataset, train, infer, export, results_export, map_import, map_detect, map_export, library_import, library_export, library_starter, library_adopt, map_move, accept_above, recount, area_recount, detect_export, pointcloud_import, pointcloud_export, surface_build, volume_calc, volume_export, design_import]
```

In the `Event.type` enum, after line 5061 `              map_labels.changed,` insert:

```yaml
              pointclouds.changed,
              surfaces.changed,
              volumes.changed,
```

- [ ] **Step 7: Lint and regenerate the client**

```powershell
cd ..
pnpm -C contract lint
pnpm -C contract generate
git add contract/openapi.yaml contract/client/schema.d.ts
pnpm -C contract check
```

Expected: `No results with a severity of 'error' found!`, then the generator writes `client/schema.d.ts`, and `check` exits 0 (lint clean, the regenerated file equals the staged one). `schema.d.ts` now contains `PointCloudOut`, `Surface`, `DesignSource` and the six new `JobType` members.

- [ ] **Step 8: Create the packages, the stub job modules and the stub routers**

Create the four empty `__init__.py` files listed under **Files**. Then the job modules:

`backend/app/pointclouds/jobs_import.py`:

```python
"""The `pointcloud_import` job (spec 2026-09-23-point-clouds section 6).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until unit I2 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("pointcloud_import")
def run_pointcloud_import(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
```

`backend/app/pointclouds/jobs_export.py`:

```python
"""The `pointcloud_export` job (spec 2026-09-23-point-clouds section 11).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until unit E1 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("pointcloud_export")
def run_pointcloud_export(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
```

`backend/app/surfaces/jobs_build.py`:

```python
"""The `surface_build` job (spec 2026-09-23-volumes section 5).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until S2 unit V2 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("surface_build")
def run_surface_build(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
```

`backend/app/volumes/jobs_calc.py`:

```python
"""The `volume_calc` job (spec 2026-09-23-volumes section 6.8).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until S2 unit V5 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("volume_calc")
def run_volume_calc(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
```

`backend/app/volumes/jobs_export.py`:

```python
"""The `volume_export` job (spec 2026-09-23-volumes section 10).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until S2 unit V6 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("volume_export")
def run_volume_export(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
```

`backend/app/surfaces/design/jobs.py`:

```python
"""The `design_import` job (spec 2026-09-23-design-surfaces section 4).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until S3 unit U1 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("design_import")
def run_design_import(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
```

The routers:

`backend/app/pointclouds/router.py`:

```python
"""Point clouds: import, octree serving, measurements, LAZ export (spec 2026-09-23-point-clouds section 4).

Foundation F0 routes every operation as a 501 stub; each S1 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`). The project-kind guard is added where
`app/api.py` includes this router.
"""

from fastapi import APIRouter

from app.pointclouds.jobs_export import run_pointcloud_export  # noqa: F401 - registers `pointcloud_export`
from app.pointclouds.jobs_import import run_pointcloud_import  # noqa: F401 - registers `pointcloud_import`
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["pointclouds"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/pointclouds", "listPointClouds"),
    ("POST", "/pointclouds", "createPointCloud"),
    ("POST", "/pointclouds/inspect", "inspectPointCloudFile"),
    ("GET", "/pointclouds/{cloudId}", "getPointCloud"),
    ("PATCH", "/pointclouds/{cloudId}", "patchPointCloud"),
    ("DELETE", "/pointclouds/{cloudId}", "deletePointCloud"),
    ("GET", "/pointclouds/{cloudId}/octree/{octreeFile}", "getPointCloudOctreeFile"),
    ("GET", "/pointclouds/{cloudId}/measurements", "listCloudMeasurements"),
    ("POST", "/pointclouds/{cloudId}/measurements", "createCloudMeasurement"),
    ("PATCH", "/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", "updateCloudMeasurement"),
    ("DELETE", "/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", "deleteCloudMeasurement"),
    ("POST", "/pointclouds/{cloudId}/exports", "createPointCloudExport"),
]

add_stubs(router, STUBS)
```

`backend/app/surfaces/router.py`:

```python
"""Surfaces: build from a cloud, tiles, ortho underlay, sampling (spec 2026-09-23-volumes section 11.1, 1-8).

Foundation F0 routes every operation as a 501 stub; each S2 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`). Design-surface imports (S3) have their
own router in `app/surfaces/design/router.py`.
"""

from fastapi import APIRouter

from app.stubs import add_stubs
from app.surfaces.jobs_build import run_surface_build  # noqa: F401 - registers `surface_build`

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/surfaces", "listSurfaces"),
    ("POST", "/surfaces", "createSurface"),
    ("GET", "/surfaces/{surfaceId}", "getSurface"),
    ("PATCH", "/surfaces/{surfaceId}", "patchSurface"),
    ("DELETE", "/surfaces/{surfaceId}", "deleteSurface"),
    ("GET", "/surfaces/{surfaceId}/tiles/{z}/{x}/{y}", "getSurfaceTile"),
    ("GET", "/surfaces/{surfaceId}/ortho-tiles/{z}/{x}/{y}", "getSurfaceOrthoTile"),
    ("GET", "/surfaces/{surfaceId}/sample", "getSurfaceSample"),
]

add_stubs(router, STUBS)
```

`backend/app/surfaces/design/router.py`:

```python
"""Design surfaces: inspect, preview and import a DEM, LandXML or DXF (spec 2026-09-23-design-surfaces s12).

Foundation F0 routes every operation as a 501 stub; each S3 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`).
"""

from fastapi import APIRouter

from app.stubs import add_stubs
from app.surfaces.design.jobs import run_design_import  # noqa: F401 - registers `design_import`

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/design-inspections", "createDesignInspection"),
    ("GET", "/design-inspections/{inspectionId}", "getDesignInspection"),
    ("DELETE", "/design-inspections/{inspectionId}", "deleteDesignInspection"),
    (
        "GET",
        "/design-inspections/{inspectionId}/candidates/{candidateId}/thumbnail",
        "getDesignCandidateThumbnail",
    ),
    ("POST", "/design-inspections/{inspectionId}/previews", "createDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}", "getDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}/image", "getDesignPreviewImage"),
    ("POST", "/design-surfaces", "createDesignSurface"),
]

add_stubs(router, STUBS)
```

`backend/app/volumes/router.py`:

```python
"""Volume measurements: cut/fill, diff tiles, footprints, exports (spec 2026-09-23-volumes s11.1, 9-17).

Foundation F0 routes every operation as a 501 stub; each S2 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`).
"""

from fastapi import APIRouter

from app.stubs import add_stubs
from app.volumes.jobs_calc import run_volume_calc  # noqa: F401 - registers `volume_calc`
from app.volumes.jobs_export import run_volume_export  # noqa: F401 - registers `volume_export`

router = APIRouter(prefix="/projects/{projectId}", tags=["volumes"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/volumes", "listVolumeMeasurements"),
    ("POST", "/volumes", "createVolumeMeasurement"),
    ("GET", "/volumes/{measurementId}", "getVolumeMeasurement"),
    ("PATCH", "/volumes/{measurementId}", "patchVolumeMeasurement"),
    ("DELETE", "/volumes/{measurementId}", "deleteVolumeMeasurement"),
    ("POST", "/volumes/{measurementId}/calculate", "calculateVolumeMeasurement"),
    ("GET", "/volumes/{measurementId}/diff-tiles/{z}/{x}/{y}", "getVolumeDiffTile"),
    ("GET", "/volumes/{measurementId}/footprints", "getVolumeFootprints"),
    ("POST", "/volume-exports", "createVolumeExport"),
]

add_stubs(router, STUBS)
```

- [ ] **Step 9: Include the routers, guarded, and update the stubs docstring**

In `backend/app/api.py`, add `import importlib` above line 1 `import logging`, and append after the last line (98):

```python

# Point clouds, surfaces, volumes and design surfaces (foundation F0 of the 2026-09-23 point-cloud,
# volumes and design-surface specs). Guarded like the maps router: laspy, scipy and rasterio are
# native stacks, and a broken one must cost only its own endpoints, never the app. Detection
# projects create and change these; any project may read them (a training project has none).
for _module in (
    "app.pointclouds.router",
    "app.surfaces.router",
    "app.surfaces.design.router",
    "app.volumes.router",
):
    try:
        api_router.include_router(
            importlib.import_module(_module).router,
            dependencies=[Depends(require_kind(("detect",), ANY_KIND))],
        )
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)
```

Replace the docstring of `backend/app/stubs.py` (lines 1–6) with:

```python
"""Helper to mount 501 placeholders so the contract is fully routed before a sub-project lands.

Foundation F0 routes the point-cloud, volumes and design-surface operations through it
(`app/pointclouds/router.py`, `app/surfaces/router.py`, `app/surfaces/design/router.py`,
`app/volumes/router.py`); `tests/test_contract.py` lists them as expected 501s, and each unit that
builds an operation removes it from its router's STUBS and from EXPECTED_STUBS.
"""
```

- [ ] **Step 10: List the stubs in the contract test, and add the one refusal allowance**

In `backend/tests/test_contract.py`, replace lines 52–54:

```python
# Operations still served by 501 stubs: there are none left: any 501 now fails
# `test_responses_conform`.
EXPECTED_STUBS: set[str] = set()
```

with:

```python
# Operations still served by 501 stubs: every operation of the point-cloud (S1), volumes (S2) and
# design-surface (S3) specs, routed by foundation F0. Each unit that builds one removes it here and
# from its router's STUBS; any other 501 fails `test_responses_conform`.
EXPECTED_STUBS: set[str] = {
    # S1 point clouds (app/pointclouds/router.py)
    "listPointClouds",
    "createPointCloud",
    "inspectPointCloudFile",
    "getPointCloud",
    "patchPointCloud",
    "deletePointCloud",
    "getPointCloudOctreeFile",
    "listCloudMeasurements",
    "createCloudMeasurement",
    "updateCloudMeasurement",
    "deleteCloudMeasurement",
    "createPointCloudExport",
    # S2 surfaces (app/surfaces/router.py)
    "listSurfaces",
    "createSurface",
    "getSurface",
    "patchSurface",
    "deleteSurface",
    "getSurfaceTile",
    "getSurfaceOrthoTile",
    "getSurfaceSample",
    # S2 volumes (app/volumes/router.py)
    "listVolumeMeasurements",
    "createVolumeMeasurement",
    "getVolumeMeasurement",
    "patchVolumeMeasurement",
    "deleteVolumeMeasurement",
    "calculateVolumeMeasurement",
    "getVolumeDiffTile",
    "getVolumeFootprints",
    "createVolumeExport",
    # S3 design surfaces (app/surfaces/design/router.py)
    "createDesignInspection",
    "getDesignInspection",
    "deleteDesignInspection",
    "getDesignCandidateThumbnail",
    "createDesignPreview",
    "getDesignPreview",
    "getDesignPreviewImage",
    "createDesignSurface",
}

# Operations that may refuse a schema-valid request by design, because the schema cannot express
# the rule (a Range the file cannot satisfy, a point count a measurement kind does not take, an
# admission refusal, a self-crossing polygon): operationId -> the statuses such a request may get.
# For exactly those responses only schemathesis's positive-data-acceptance check is skipped; every
# conformance check still runs, and the answer must carry its own error code, never
# `validation_error` (FastAPI's malformed-request answer). This is the only allowance mechanism:
# S1, S2 and S3 add entries here and never loosen the test another way. Empty until a unit builds a
# refusing operation; each status must be declared for its operation in openapi.yaml (guarded below).
REFUSES_VALID_DATA: dict[str, set[int]] = {}
```

Add `positive_data_acceptance` to the `from schemathesis.specs.openapi.checks import (...)` list (alphabetical, between `negative_data_rejection` and `response_schema_conformance`), and in `test_responses_conform` replace the last two lines

```python
    excluded = [negative_data_rejection, unsupported_method, allow_header_conformance]
    case.validate_response(response, excluded_checks=excluded)
```

with

```python
    excluded = [negative_data_rejection, unsupported_method, allow_header_conformance]
    op_id = case.operation.definition.raw.get("operationId")
    if response.status_code in REFUSES_VALID_DATA.get(op_id, set()):
        # A deliberate refusal of a schema-valid request: skip only positive-data acceptance.
        code = response.json()["error"]["code"]
        assert code and code != "validation_error", response.text
        excluded.append(positive_data_acceptance)
    case.validate_response(response, excluded_checks=excluded)
```

Add a guard test directly after `test_stub_list_matches_routers`:

```python
def test_refusal_allowances_name_real_operations_and_declared_statuses():
    """Every REFUSES_VALID_DATA entry is a real operationId and each status is declared for it."""
    ops = {
        op["operationId"]: op
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS
    }
    for op_id, statuses in REFUSES_VALID_DATA.items():
        assert op_id in ops, op_id
        declared = {int(code) for code in ops[op_id]["responses"] if str(code).isdigit()}
        assert statuses <= declared, (op_id, sorted(statuses - declared))
```

(`REFUSES_VALID_DATA` is a module-level name defined further down the file, like `EXPECTED_STUBS`; the test reads it at call time.)

- [ ] **Step 11: Run the tests to confirm they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_stubs.py tests/test_pointcloud_router_guard.py tests/test_project_kinds.py tests/test_contract.py -q`
Expected: PASS. `test_contract.py` takes about 80 s (schemathesis calls every operation, 37 new ones answer 501 in the error envelope; in the training project the contract test uses, the new writes answer 409 `wrong_project_kind`, covered by `default`).

- [ ] **Step 12: Lint and commit**

Run: `& $PY -m ruff check .; & $PY -m ruff format --check .`

```powershell
cd ..
git add contract/openapi.yaml contract/client/schema.d.ts backend/app/api.py backend/app/stubs.py backend/tests/test_contract.py backend/tests/test_pointcloud_stubs.py backend/tests/test_pointcloud_router_guard.py backend/app/pointclouds/__init__.py backend/app/pointclouds/router.py backend/app/pointclouds/jobs_import.py backend/app/pointclouds/jobs_export.py backend/app/surfaces/__init__.py backend/app/surfaces/router.py backend/app/surfaces/jobs_build.py backend/app/surfaces/design/__init__.py backend/app/surfaces/design/router.py backend/app/surfaces/design/jobs.py backend/app/volumes/__init__.py backend/app/volumes/router.py backend/app/volumes/jobs_calc.py backend/app/volumes/jobs_export.py
git commit -m "feat(contract): point-cloud, surface, volume and design-surface operations as 501 stubs; six job types" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

The frontend typecheck is red from here until Task 5 ends (the new `JobType` members); that is expected.

---

### Task 5: The six job types in the frontend's eight exhaustive places, and two icons

Shell: PowerShell at the worktree root `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`.

**Files:**
- Modify: `frontend/src/ui/Icon.tsx:40-42` and `:89-91`
- Modify: `frontend/src/jobs/jobLabels.ts:21` and `:112-114`
- Modify: `frontend/src/jobs/JobCard.tsx:39`
- Modify: `frontend/src/app/Header.tsx:56`
- Modify: `frontend/src/screens/HomeScreen.tsx:63`
- Modify: `frontend/src/ui/useJobToasts.ts:24` and `:88-90`
- Modify: `frontend/src/agent/project/ToolRow.tsx:31`
- Test: `frontend/src/jobs/foundationJobTypes.test.ts`

**Interfaces:**
- Consumes: `Job["type"]` with the six new members (Task 4's `schema.d.ts`).
- Produces: `IconName` gains `"cloud"` and `"volume"` (used by Task 9's Sidebar and screens).

- [ ] **Step 1: Write the failing test**

`frontend/src/jobs/foundationJobTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { runningJob } from "@/test/fixtures";
import { jobToastText } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The six job types of the point-cloud, volumes and design specs (foundation F0). */
const NEW: [Job["type"], string, string][] = [
  ["pointcloud_import", "Point cloud import", "/p/p/clouds"],
  ["pointcloud_export", "Point cloud export", "/p/p/clouds"],
  ["surface_build", "Build surface", "/p/p/volumes"],
  ["volume_calc", "Calculate volume", "/p/p/volumes"],
  ["volume_export", "Export volumes", "/p/p/volumes"],
  ["design_import", "Design surface import", "/p/p/volumes"],
];

describe("the new job types", () => {
  it.each(NEW)("%s is titled %s and links to its screen", (type, label, to) => {
    const job = { ...runningJob, type, params: {} };
    expect(jobTitle(job)).toBe(label);
    expect(resultTarget({ ...job, state: "succeeded" }, "p")?.to).toBe(to);
  });

  it.each(NEW)("%s has a failure toast that names it", (type, label) => {
    const job = { ...runningJob, type, state: "failed" as const, error: "not implemented" };
    expect(jobToastText(job)).toBe(`${label} failed: not implemented`);
  });

  it("names the design import's phase when it succeeds", () => {
    const done = { ...runningJob, type: "design_import" as const, state: "succeeded" as const };
    expect(jobToastText({ ...done, params: { phase: "inspect" } })).toBe("Design file read");
    expect(jobToastText({ ...done, params: { phase: "preview" } })).toBe("Design preview ready");
    expect(jobToastText({ ...done, params: { phase: "build" } })).toBe("Design surface imported");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm -C frontend exec vitest run src/jobs/foundationJobTypes.test.ts`
Expected: FAIL — `jobTitle` returns `undefined` for `pointcloud_import`, and `resultTarget` returns `undefined`.

- [ ] **Step 3: Add the two icons**

In `frontend/src/ui/Icon.tsx`, replace `  | "trend"\n  | "minus";` (lines 41–42) with:

```ts
  | "trend"
  | "minus"
  | "cloud"
  | "volume";
```

and replace `  minus: "M5 12h14",\n};` (lines 90–91) with:

```ts
  minus: "M5 12h14",
  // A point cloud: a mound of survey points over the ground line.
  cloud: "M3 20h18M6 17h.01M9 14h.01M12 11h.01M15 14h.01M18 17h.01M9 18h.01M12 15h.01M15 18h.01M12 7h.01",
  // A stockpile with its height dimension: the volume icon of every surface and volume job.
  volume: "M3 20h18M5 20c2-6 4-9 7-9s5 3 7 9M12 3v5M10 6l2 2 2-2",
};
```

- [ ] **Step 4: Add the labels (three maps) and the verbs (two maps)**

In each of `frontend/src/jobs/jobLabels.ts` (TYPE_LABEL, line 21), `frontend/src/ui/useJobToasts.ts` (TYPE_NAME, line 24) and `frontend/src/agent/project/ToolRow.tsx` (JOB_NAME, line 31), replace `  detect_export: "Detection export",\n};` with:

```ts
  detect_export: "Detection export",
  pointcloud_import: "Point cloud import",
  pointcloud_export: "Point cloud export",
  surface_build: "Build surface",
  volume_calc: "Calculate volume",
  volume_export: "Export volumes",
  design_import: "Design surface import",
};
```

In each of `frontend/src/app/Header.tsx` (TYPE_VERB, line 56) and `frontend/src/screens/HomeScreen.tsx` (TYPE_VERB, line 63), replace `  detect_export: "Exporting counts",\n};` with:

```ts
  detect_export: "Exporting counts",
  pointcloud_import: "Importing a point cloud",
  pointcloud_export: "Exporting a point cloud",
  surface_build: "Building a surface",
  volume_calc: "Calculating a volume",
  volume_export: "Exporting volumes",
  design_import: "Importing a design surface",
};
```

- [ ] **Step 5: Add the icons map and the two switches**

In `frontend/src/jobs/JobCard.tsx` (TYPE_ICON, line 39), replace `  detect_export: "download",\n};` with:

```ts
  detect_export: "download",
  pointcloud_import: "cloud",
  pointcloud_export: "cloud",
  surface_build: "volume",
  volume_calc: "volume",
  volume_export: "volume",
  design_import: "volume",
};
```

In `frontend/src/jobs/jobLabels.ts::resultTarget`, replace

```ts
    case "detect_export":
      return { label: "Open export", to: `${p}/export` };
  }
```

with:

```ts
    case "detect_export":
      return { label: "Open export", to: `${p}/export` };
    case "pointcloud_import":
    case "pointcloud_export":
      return { label: "Open point clouds", to: `${p}/clouds` };
    case "surface_build":
    case "volume_calc":
    case "volume_export":
    case "design_import":
      return { label: "Open volumes", to: `${p}/volumes` };
  }
```

In `frontend/src/ui/useJobToasts.ts::jobToastText`, replace

```ts
    case "detect_export":
      return "Export finished";
  }
```

with:

```ts
    case "detect_export":
      return "Export finished";
    case "pointcloud_import":
      return "Point cloud imported";
    case "pointcloud_export":
      return "Point cloud export finished";
    case "surface_build":
      return "Surface built";
    case "volume_calc":
      return "Volume calculated";
    case "volume_export":
      return "Volume export finished";
    case "design_import":
      // One job type, three phases (spec 2026-09-23-design-surfaces section 4.1).
      if (job.params?.phase === "build") return "Design surface imported";
      if (job.params?.phase === "preview") return "Design preview ready";
      return "Design file read";
  }
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm -C frontend exec vitest run src/jobs src/ui src/app/Header.test.ts`
Expected: PASS.

Run: `pnpm -C frontend build`
Expected: `✓ built` — the typecheck is green again.

- [ ] **Step 7: Lint and commit**

Run: `pnpm -C frontend lint`
Expected: no errors (the one existing `MapView.tsx` exhaustive-deps warning stays), `All matched files use Prettier code style!`, `tokens ok`.

```powershell
git add frontend/src/ui/Icon.tsx frontend/src/jobs/jobLabels.ts frontend/src/jobs/JobCard.tsx frontend/src/app/Header.tsx frontend/src/screens/HomeScreen.tsx frontend/src/ui/useJobToasts.ts frontend/src/agent/project/ToolRow.tsx frontend/src/jobs/foundationJobTypes.test.ts
git commit -m "feat(jobs): label, verb, icon, toast and link for the six point-cloud, surface and volume job types" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Client URL helpers and type aliases

Shell: PowerShell at the worktree root `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`.

**Files:**
- Modify: `contract/client/index.ts:58` (aliases) and append at the end (helpers)
- Test: `frontend/src/api/viewerUrls.test.ts`

**Interfaces:**
- Consumes: the schemas from Task 4.
- Produces (exported from `@contract/client`):
  - `cloudOctreeUrl(baseUrl: string, projectId: string, cloudId: string): string` — `…/pointclouds/{cloudId}/octree/metadata.json`, no token
  - `surfaceTileUrl(baseUrl, token, projectId, surfaceId, tint = false): string` — template with `{z}/{x}/{y}`
  - `surfaceOrthoTileUrl(baseUrl, token, projectId, surfaceId, mapId): string`
  - `volumeDiffTileUrl(baseUrl, token, projectId, measurementId, v?: string): string`
  - types `PointCloud` (= `PointCloudOut`), `CloudMeasurement` (= `CloudMeasurementOut`), `Surface`, `VolumeMeasurement`

- [ ] **Step 1: Write the failing test**

`frontend/src/api/viewerUrls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cloudOctreeUrl, surfaceOrthoTileUrl, surfaceTileUrl, volumeDiffTileUrl } from "@contract/client";

const BASE = "http://127.0.0.1:8765/";

describe("viewer URL helpers (foundation F0)", () => {
  it("points the octree loader at metadata.json with no token, for the RequestManager to add", () => {
    const url = cloudOctreeUrl(BASE, "p1", "c1");
    expect(url).toBe("http://127.0.0.1:8765/api/v1/projects/p1/pointclouds/c1/octree/metadata.json");
    // potree-core derives the other two files this way; the base must survive it.
    expect(url.replace("/metadata.json", "/octree.bin")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/pointclouds/c1/octree/octree.bin",
    );
  });

  it("templates surface hillshade tiles, tinted on request", () => {
    expect(surfaceTileUrl(BASE, "t k", "p1", "s1")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/surfaces/s1/tiles/{z}/{x}/{y}?token=t+k",
    );
    expect(surfaceTileUrl(BASE, "t", "p1", "s1", true)).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/surfaces/s1/tiles/{z}/{x}/{y}?token=t&tint=true",
    );
  });

  it("templates the ortho underlay with its map", () => {
    expect(surfaceOrthoTileUrl(BASE, "t", "p1", "s1", "m1")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/surfaces/s1/ortho-tiles/{z}/{x}/{y}?token=t&map_id=m1",
    );
  });

  it("templates cut/fill tiles with the cache-busting version when there is one", () => {
    expect(volumeDiffTileUrl(BASE, "t", "p1", "v1")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/volumes/v1/diff-tiles/{z}/{x}/{y}?token=t",
    );
    expect(volumeDiffTileUrl(BASE, "t", "p1", "v1", "2026-09-24T10:00:00Z")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/volumes/v1/diff-tiles/{z}/{x}/{y}?token=t&v=2026-09-24T10%3A00%3A00Z",
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm -C frontend exec vitest run src/api/viewerUrls.test.ts`
Expected: FAIL — `cloudOctreeUrl is not a function`.

- [ ] **Step 3: Add the aliases and helpers**

In `contract/client/index.ts`, after line 58 `export type MapScore = Schemas["MapScore"];` insert:

```ts
export type PointCloud = Schemas["PointCloudOut"];
export type CloudMeasurement = Schemas["CloudMeasurementOut"];
export type Surface = Schemas["Surface"];
export type VolumeMeasurement = Schemas["VolumeMeasurement"];
```

Append at the end of the file, after `mapPreviewUrl`:

```ts
/**
 * The point cloud's Potree `metadata.json` URL, WITHOUT the token: the viewer's potree-core
 * RequestManager appends `?token=` to every URL it fetches, and the loader derives the
 * `hierarchy.bin` and `octree.bin` URLs with `.replace("/metadata.json", ...)`, which keeps it.
 */
export function cloudOctreeUrl(baseUrl: string, projectId: string, cloudId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/v1/projects/${projectId}/pointclouds/${cloudId}/octree/metadata.json`;
}

/** OpenLayers tile URL template for a surface's hillshade; `tint` adds the hypsometric ramp. */
export function surfaceTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  surfaceId: string,
  tint = false,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  if (tint) q.set("tint", "true");
  return `${base}/api/v1/projects/${projectId}/surfaces/${surfaceId}/tiles/{z}/{x}/{y}?${q}`;
}

/** OpenLayers tile URL template for a map's orthomosaic warped into a surface's grid. */
export function surfaceOrthoTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  surfaceId: string,
  mapId: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token, map_id: mapId });
  return `${base}/api/v1/projects/${projectId}/surfaces/${surfaceId}/ortho-tiles/{z}/{x}/{y}?${q}`;
}

/** OpenLayers tile URL template for a volume's cut/fill overlay; `v` busts the cache per calculation. */
export function volumeDiffTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  measurementId: string,
  v?: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  if (v) q.set("v", v);
  return `${base}/api/v1/projects/${projectId}/volumes/${measurementId}/diff-tiles/{z}/{x}/{y}?${q}`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm -C frontend exec vitest run src/api/viewerUrls.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

Run: `pnpm -C frontend lint; pnpm -C contract check`

```powershell
git add contract/client/index.ts frontend/src/api/viewerUrls.test.ts
git commit -m "feat(client): octree, surface, ortho-underlay and cut/fill tile URL helpers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Backend scaffolding — sweeps, converter seam, selftests, events, folders, CORS

Shell: PowerShell in `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`; backend commands run from `backend\` with `$PY = ".\.venv\Scripts\python.exe"` (the overlay venv of Task 1).

**Files:**
- Create: `backend/app/pointclouds/startup.py`, `backend/app/surfaces/startup.py`, `backend/app/volumes/startup.py`, `backend/app/surfaces/design/startup.py`
- Create: `backend/app/pointclouds/converter.py`, `backend/app/pointclouds/selftest.py`, `backend/app/surfaces/design/selftest.py`, `backend/app/volumes/selftest.py`
- Modify: `backend/app/main.py:21-48` (`project_opened`) and `:130` (CORS)
- Modify: `backend/app/__main__.py:1-3` and `:157-160`
- Modify: `backend/app/events_util.py` (append after line 207)
- Modify: `backend/app/projects/service.py:44`
- Modify: `backend/tests/conftest.py:10`, `:55`, `:67`
- Test: `backend/tests/test_pointcloud_foundation.py`; `backend/tests/test_cors.py` (append)

**Interfaces:**
- Consumes: `tests/pointclouds.py` (Task 2), the packages from Task 4.
- Produces:
  - `sweep_interrupted(handle: ProjectHandle, runner) -> list[str]` in `app.pointclouds.startup` (filled by S1 I2), `app.surfaces.startup` (S2 V2), `app.volumes.startup` (S2 V5), `app.surfaces.design.startup` (S3 U1); `project_opened` calls them in that order, each in its own step, imported inside the step.
  - `app.pointclouds.converter.ConverterResult(octree_dir: Path, log_tail: list[str], command: list[str], seconds: float, encoding: str = "BROTLI", version: str = "2.1.5")` and `run_converter(input_path, out_dir, *, progress: Callable[[float, str], None], check_cancelled: Callable[[], None]) -> ConverterResult`. **Callers resolve it at call time** (`converter.run_converter(...)` through the module): the `app` fixture replaces the module attribute with `fake_run_converter`, so a module-scope `from … import run_converter` or a default argument bound at import would silently keep the real one.
  - `app.pointclouds.selftest.main(argv: list[str] | None = None) -> int`, `app.surfaces.design.selftest.main(...)` and `app.volumes.selftest.main(...)`, dispatched by `python -m app pointcloud-selftest …` / `design-selftest …` / `volumes-selftest …`.
  - `publish_pointclouds_changed(request, handle, cloud_ids)`, `publish_surfaces_changed(request, handle, surface_ids)`, `publish_volumes_changed(request, handle, measurement_ids)` in `app.events_util` (nothing is published for an empty list).
  - `ProjectHandle.pointclouds_dir`, `.surfaces_dir`, `.volumes_dir`.
  - CORS: `allow_headers=["Authorization", "Content-Type", "Range"]`, `expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_foundation.py`:

```python
"""Foundation F0 of the point-cloud, volumes and design-surface specs: the shared scaffolding.

Project folders, the four startup sweeps, the change events, the selftest placeholders and the
PotreeConverter seam with its offline stand-in.
"""

import importlib
import logging
from types import SimpleNamespace

import pytest
from pointclouds import fake_run_converter, make_las, read_fake_octree

from app.__main__ import run
from app.events_util import publish_pointclouds_changed, publish_surfaces_changed, publish_volumes_changed
from app.main import project_opened
from app.pointclouds import converter

SWEEP_MODULES = [
    "app.pointclouds.startup",
    "app.surfaces.startup",
    "app.volumes.startup",
    "app.surfaces.design.startup",
]


class _Runner:
    def is_live(self, job_id):
        return False


# --- project folders -----------------------------------------------------------------------------


def test_project_handle_names_the_three_new_folders(handle):
    assert handle.pointclouds_dir == handle.folder / "pointclouds"
    assert handle.surfaces_dir == handle.folder / "surfaces"
    assert handle.volumes_dir == handle.folder / "volumes"


# --- startup sweeps ------------------------------------------------------------------------------


@pytest.mark.parametrize("module", SWEEP_MODULES)
def test_each_sweep_is_a_no_op_until_its_unit_lands(handle, module):
    assert importlib.import_module(module).sweep_interrupted(handle, _Runner()) == []


def test_project_opened_runs_all_four_sweeps_even_when_one_fails(handle, monkeypatch, caplog):
    called: list[str] = []

    def recorder(name, fail=False):
        def sweep(h, runner):
            assert h is handle
            called.append(name)
            if fail:
                raise RuntimeError("boom")
            return []

        return sweep

    monkeypatch.setattr("app.pointclouds.startup.sweep_interrupted", recorder("pointclouds", fail=True))
    monkeypatch.setattr("app.surfaces.startup.sweep_interrupted", recorder("surfaces"))
    monkeypatch.setattr("app.volumes.startup.sweep_interrupted", recorder("volumes"))
    monkeypatch.setattr("app.surfaces.design.startup.sweep_interrupted", recorder("design"))
    with caplog.at_level(logging.ERROR, logger="app.main"):
        project_opened(handle, _Runner())
    assert called == ["pointclouds", "surfaces", "volumes", "design"]
    assert "interrupted point cloud import sweep failed" in caplog.text


# --- events --------------------------------------------------------------------------------------


def _request():
    published: list[dict] = []
    events = SimpleNamespace(publish=published.append)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(events=events))), published


@pytest.mark.parametrize(
    ("publish", "event_type", "key"),
    [
        (publish_pointclouds_changed, "pointclouds.changed", "cloud_ids"),
        (publish_surfaces_changed, "surfaces.changed", "surface_ids"),
        (publish_volumes_changed, "volumes.changed", "measurement_ids"),
    ],
)
def test_change_events_carry_their_ids_and_skip_an_empty_list(publish, event_type, key):
    request, published = _request()
    handle = SimpleNamespace(id="p1")
    publish(request, handle, ["a", "b"])
    publish(request, handle, [])
    assert published == [
        {
            "type": event_type,
            "project_id": "p1",
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {key: ["a", "b"]},
        }
    ]


# --- selftest placeholders -----------------------------------------------------------------------


# One line per placeholder: the unit that builds a real selftest deletes its own line (S1 Task 15,
# S3 Task 8, S2 Task 13), so parallel branches rebase without touching each other's entries. When
# all three are gone the parametrize is empty and pytest skips the test.
@pytest.mark.parametrize(
    "command",
    [
        "pointcloud-selftest",
        "design-selftest",
        "volumes-selftest",
    ],
)
def test_selftest_placeholders_say_so_and_exit_2(capsys, command):
    assert run(["app.exe", command, "--write-fixture", "x.laz"], freeze_support=lambda: None) == 2
    assert capsys.readouterr().out.strip() == f"{command} not built"


# --- the converter seam --------------------------------------------------------------------------


def test_the_real_converter_is_not_built_yet(tmp_path):
    # No `app` fixture here, so the module still holds the real runner.
    assert converter.run_converter is not fake_run_converter
    with pytest.raises(NotImplementedError, match="unit I1"):
        converter.run_converter(
            tmp_path / "in.las", tmp_path / "out", progress=lambda f, m: None, check_cancelled=lambda: None
        )


def test_the_app_fixture_installs_the_offline_converter(app, tmp_path):
    assert converter.run_converter is fake_run_converter
    source = make_las(tmp_path / "in.laz", 400, compressed=True)
    seen: list[float] = []
    result = converter.run_converter(
        source, tmp_path / "octree", progress=lambda f, m: seen.append(f), check_cancelled=lambda: None
    )
    assert isinstance(result, converter.ConverterResult)
    assert result.encoding == "DEFAULT"  # what write_fake_octree writes; the real converter says BROTLI
    meta, xyz, rgb = read_fake_octree(result.octree_dir)
    assert meta["points"] == len(xyz) == 400
    assert seen[0] == 0.0 and seen[-1] == 1.0
    assert rgb[:, 0].max() == 65535 and rgb[:, 1].max() == 65535  # red west, green east


def test_the_offline_converter_paints_a_colourless_cloud_white(app, tmp_path):
    source = make_las(tmp_path / "grey.las", 50, rgb=False, point_format=1)
    result = converter.run_converter(
        source, tmp_path / "octree", progress=lambda f, m: None, check_cancelled=lambda: None
    )
    _, _, rgb = read_fake_octree(result.octree_dir)
    assert (rgb == 65535).all()
```

Append to `backend/tests/test_cors.py`:

```python


def test_preflight_for_the_octree_loader_allows_range_and_content_type(anon):
    """potree-core asks for byte ranges with a multipart content-type, which forces a preflight."""
    r = anon.options(
        "/api/v1/health",
        headers={
            "Origin": "http://tauri.localhost",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type,range",
        },
    )
    assert r.status_code == 200, r.text
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "range" in allowed and "content-type" in allowed


def test_responses_expose_the_range_headers_to_the_loader(client):
    r = client.get("/api/v1/health", headers={"Origin": "http://tauri.localhost"})
    exposed = {h.strip().lower() for h in r.headers["access-control-expose-headers"].split(",")}
    assert exposed == {"content-range", "accept-ranges", "content-length"}
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `& $PY -m pytest tests/test_pointcloud_foundation.py tests/test_cors.py -q`
Expected: FAIL — `ImportError: cannot import name 'publish_pointclouds_changed'` for the first file, and `400 Disallowed CORS headers` for the preflight.

- [ ] **Step 3: Write the four no-op sweeps**

`backend/app/pointclouds/startup.py`:

```python
"""Startup sweep, run by `app.main.project_opened` each time the project opens.

An `importing` cloud whose job this process does not hold becomes `failed`; every `.work/`
folder under `pointclouds/` and an interrupted import's partial `octree/` are removed
(spec 2026-09-23-point-clouds section 3).

Foundation F0 wires it in as a no-op; unit I2 fills in only this function's body and never edits
`app/main.py`. It must log and continue on its own failures: a failing sweep never blocks opening
the project.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    """Returns the ids of the rows it changed; none until unit I2 builds it."""
    return []
```

`backend/app/surfaces/startup.py`:

```python
"""Startup sweep, run by `app.main.project_opened` each time the project opens.

A `building` surface of any kind whose job is not live becomes `failed`; its `.build/` folder and
orphan `*.partial` files are removed (spec 2026-09-23-volumes section 3).

Foundation F0 wires it in as a no-op; S2 unit V2 fills in only this function's body and never edits
`app/main.py`. It must log and continue on its own failures: a failing sweep never blocks opening
the project.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    """Returns the ids of the rows it changed; none until S2 unit V2 builds it."""
    return []
```

`backend/app/volumes/startup.py`:

```python
"""Startup sweep, run by `app.main.project_opened` each time the project opens.

A `calculating` measurement whose job is not live becomes `stale` (earlier results) or `failed`;
orphan `*.partial` files are removed (spec 2026-09-23-volumes section 3).

Foundation F0 wires it in as a no-op; S2 unit V5 fills in only this function's body and never edits
`app/main.py`. It must log and continue on its own failures: a failing sweep never blocks opening
the project.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    """Returns the ids of the rows it changed; none until S2 unit V5 builds it."""
    return []
```

`backend/app/surfaces/design/startup.py`:

```python
"""Startup sweep, run by `app.main.project_opened` each time the project opens.

Design inspection folders under `cache/design-inspections/` whose jobs are not live and whose
`request.json` is more than 24 h old are removed (spec 2026-09-23-design-surfaces section 4.4).

Foundation F0 wires it in as a no-op; S3 unit U1 fills in only this function's body and never edits
`app/main.py`. It must log and continue on its own failures: a failing sweep never blocks opening
the project.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    """Returns the ids of the rows it changed; none until S3 unit U1 builds it."""
    return []
```

- [ ] **Step 4: Wire them into `project_opened` and widen CORS**

In `backend/app/main.py::project_opened`, replace the end of the docstring and the first import:

```python
    its own, so one failing never skips the others."""
    import logging
```

with:

```python
    its own, so one failing never skips the others.

    The point-cloud, surface, volume and design-inspection sweeps (foundation F0) are imported
    inside their own step: a module that fails to import costs only that step."""
    import importlib
    import logging
```

Replace

```python
    log = logging.getLogger(__name__)
    for step, run in (
```

with:

```python
    log = logging.getLogger(__name__)

    def sweep(module: str):
        return lambda: importlib.import_module(module).sweep_interrupted(handle, runner)

    for step, run in (
```

After the line `        ("interrupted map import sweep", lambda: maps_startup.sweep_interrupted_imports(handle, runner)),` insert:

```python
        ("interrupted point cloud import sweep", sweep("app.pointclouds.startup")),
        ("interrupted surface build sweep", sweep("app.surfaces.startup")),
        ("interrupted volume calculation sweep", sweep("app.volumes.startup")),
        ("stale design inspection sweep", sweep("app.surfaces.design.startup")),
```

In `create_app`, replace line 130 `        allow_headers=["Authorization", "Content-Type"],` with:

```python
        # Range: the point-cloud octree loader reads byte ranges, and its `Range` header triggers a
        # preflight that must pass here, before routing (spec 2026-09-23-point-clouds section 2).
        allow_headers=["Authorization", "Content-Type", "Range"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
```

- [ ] **Step 5: The converter seam and the offline fixture**

`backend/app/pointclouds/converter.py`:

```python
"""The PotreeConverter seam (spec 2026-09-23-point-clouds sections 2 and 6.7).

Foundation F0 fixes the signature so the test fixture can replace it from day one
(`tests/conftest.py::app` installs `tests/pointclouds.py::fake_run_converter`, per the ADR
2026-09-21-gotcha-contract-jobs-need-offline-seams). Unit I1 builds the real runner: subprocess,
Windows Job Object, progress parsing, the one-at-a-time lock and cancel.

Callers resolve it at call time through the module (`converter.run_converter(...)`), never with a
module-scope `from app.pointclouds.converter import run_converter` or a default argument bound at
import: either would keep the real runner after the fixture patched the module attribute.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ConverterResult:
    """What a finished conversion reports."""

    octree_dir: Path  # holds metadata.json, hierarchy.bin and octree.bin
    log_tail: list[str]  # the converter's last output lines, at most 200
    command: list[str]  # the command line, for source.json
    seconds: float
    encoding: str = "BROTLI"  # what metadata.json must say; the offline fake reports "DEFAULT"
    version: str = "2.1.5"  # the PotreeConverter version, for source.json


def run_converter(
    input_path: Path,
    out_dir: Path,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
) -> ConverterResult:
    """Convert the LAS/LAZ at `input_path` into a Potree 2.0 octree in `out_dir`."""
    raise NotImplementedError("the PotreeConverter runner is built in unit I1")
```

In `backend/tests/conftest.py`, after line 10 `from PIL import Image` insert:

```python
from pointclouds import fake_run_converter
```

In the `app` fixture's docstring, replace line 55 (`    exact command.`) with:

```python
    exact command. PotreeConverter is replaced by `tests/pointclouds.py::fake_run_converter`.
```

After line 67 `    monkeypatch.setattr("app.exports.reveal.launch", lambda command: None)` insert:

```python
    # PotreeConverter is an external exe: tests use a real, tiny Potree octree written in Python
    # (ADR 2026-09-21-gotcha-contract-jobs-need-offline-seams). The fake imports laspy only when
    # a job actually converts.
    monkeypatch.setattr("app.pointclouds.converter.run_converter", fake_run_converter)
```

- [ ] **Step 6: The selftest placeholders**

`backend/app/pointclouds/selftest.py`:

```python
"""`kestrel-backend.exe pointcloud-selftest`: the frozen-bundle check for the point-cloud stack.

A placeholder until unit K2 builds it (spec 2026-09-23-point-clouds section 14): it says so and
exits 2, so a smoke script that calls it before K2 fails loudly rather than passing on nothing.
"""

NAME = "pointcloud-selftest"


def main(argv: list[str] | None = None) -> int:
    print(f"{NAME} not built", flush=True)
    return 2
```

`backend/app/surfaces/design/selftest.py`:

```python
"""`kestrel-backend.exe design-selftest`: the frozen-bundle check for design-surface import.

A placeholder until S3 unit U3 builds it (spec 2026-09-23-design-surfaces section 14.2): it says so
and exits 2, so a smoke script that calls it before U3 fails loudly rather than passing on nothing.
"""

NAME = "design-selftest"


def main(argv: list[str] | None = None) -> int:
    print(f"{NAME} not built", flush=True)
    return 2
```

`backend/app/volumes/selftest.py`:

```python
"""`kestrel-backend.exe volumes-selftest`: the frozen-bundle check for the volume exports.

A placeholder until S2 Task 13 (unit V6) builds it (spec 2026-09-23-volumes section 12.2): it says
so and exits 2, so a smoke script that calls it before V6 fails loudly rather than passing on nothing.
"""

NAME = "volumes-selftest"


def main(argv: list[str] | None = None) -> int:
    print(f"{NAME} not built", flush=True)
    return 2
```

In `backend/app/__main__.py`, replace the module docstring (lines 1–3) with:

```python
"""Process entry point: `python -m app` serves the API, `python -m app worker ...` trains,
`python -m app geo-selftest` checks GDAL/PROJ, `pointcloud-selftest`, `design-selftest` and
`volumes-selftest` check the point-cloud, design-surface and volume-export stacks (placeholders until
S1 K2, S3 U3 and S2 V6 build them).
"""
```

and after the `geo-selftest` branch (`        return geo_selftest()`) insert:

```python
    if len(argv) > 1 and argv[1] == "pointcloud-selftest":
        from app.pointclouds.selftest import main as pointcloud_selftest

        return pointcloud_selftest(argv[2:])
    if len(argv) > 1 and argv[1] == "design-selftest":
        from app.surfaces.design.selftest import main as design_selftest

        return design_selftest(argv[2:])
    if len(argv) > 1 and argv[1] == "volumes-selftest":
        from app.volumes.selftest import main as volumes_selftest

        return volumes_selftest(argv[2:])
```

- [ ] **Step 7: The event publishers and the project folders**

Append to `backend/app/events_util.py`:

```python


def _publish_ids_changed(
    request: Request, handle: ProjectHandle, event_type: str, key: str, ids: list[str]
) -> None:
    """Publish `{key: ids}` as `event_type`; nothing when `ids` is empty."""
    if not ids:
        return
    request.app.state.events.publish(
        {
            "type": event_type,
            "project_id": handle.id,
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {key: list(ids)},
        }
    )


def publish_pointclouds_changed(request: Request, handle: ProjectHandle, cloud_ids: list[str]) -> None:
    """`pointclouds.changed {cloud_ids}` (spec 2026-09-23-point-clouds section 4.3)."""
    _publish_ids_changed(request, handle, "pointclouds.changed", "cloud_ids", cloud_ids)


def publish_surfaces_changed(request: Request, handle: ProjectHandle, surface_ids: list[str]) -> None:
    """`surfaces.changed {surface_ids}` (spec 2026-09-23-volumes section 11.3)."""
    _publish_ids_changed(request, handle, "surfaces.changed", "surface_ids", surface_ids)


def publish_volumes_changed(request: Request, handle: ProjectHandle, measurement_ids: list[str]) -> None:
    """`volumes.changed {measurement_ids}` (spec 2026-09-23-volumes section 11.3)."""
    _publish_ids_changed(request, handle, "volumes.changed", "measurement_ids", measurement_ids)
```

In `backend/app/projects/service.py`, after line 44 `    maps_dir = property(lambda s: s.folder / "maps")` insert:

```python
    pointclouds_dir = property(lambda s: s.folder / "pointclouds")
    surfaces_dir = property(lambda s: s.folder / "surfaces")
    volumes_dir = property(lambda s: s.folder / "volumes")
```

- [ ] **Step 8: Run the tests to confirm they pass**

Run: `& $PY -m pytest tests/test_pointcloud_foundation.py tests/test_cors.py tests/test_pointcloud_stubs.py tests/test_exports_job.py tests/test_maps_startup.py -q`
Expected: PASS.

- [ ] **Step 9: Lint and commit**

Run: `& $PY -m ruff check .; & $PY -m ruff format --check .`

```powershell
cd ..
git add backend/app/pointclouds/startup.py backend/app/surfaces/startup.py backend/app/volumes/startup.py backend/app/surfaces/design/startup.py backend/app/pointclouds/converter.py backend/app/pointclouds/selftest.py backend/app/surfaces/design/selftest.py backend/app/volumes/selftest.py backend/app/main.py backend/app/__main__.py backend/app/events_util.py backend/app/projects/service.py backend/tests/conftest.py backend/tests/test_pointcloud_foundation.py backend/tests/test_cors.py
git commit -m "feat(pointclouds): startup sweeps, converter seam with an offline fake, selftest placeholders, events, folders, Range CORS" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Frontend viewer dependencies

Shell: PowerShell at the worktree root `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`.

**Files:**
- Modify: `frontend/package.json`, `frontend/pnpm-lock.yaml`
- Test: `frontend/src/app/viewerDeps.test.ts`

**Interfaces:**
- Produces: `potree-core` 2.0.15, `three` 0.180.0 (dependencies) and `@types/three` 0.180.0 (devDependency), exact, for S1 V1. Nothing imports them yet.

- [ ] **Step 1: Write the failing test**

`frontend/src/app/viewerDeps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("3D viewer dependencies (foundation F0)", () => {
  it("pins potree-core, three and its types exactly: a three upgrade can break potree-core", () => {
    expect(pkg.dependencies["potree-core"]).toBe("2.0.15");
    expect(pkg.dependencies.three).toBe("0.180.0");
    expect(pkg.devDependencies["@types/three"]).toBe("0.180.0");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm -C frontend exec vitest run src/app/viewerDeps.test.ts`
Expected: FAIL — `expected undefined to be '2.0.15'`.

- [ ] **Step 3: Add the dependencies**

```powershell
pnpm -C frontend add --save-exact potree-core@2.0.15 three@0.180.0
pnpm -C frontend add --save-exact -D @types/three@0.180.0
```

Expected: `+ potree-core 2.0.15`, `+ three 0.180.0`, `+ @types/three 0.180.0`; `package.json` shows the three entries without a caret.

- [ ] **Step 4: Run the test and the build**

Run: `pnpm -C frontend exec vitest run src/app/viewerDeps.test.ts; pnpm -C frontend build`
Expected: PASS, and `✓ built` (nothing imports the packages yet, so the bundle does not change).

- [ ] **Step 5: Commit**

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/app/viewerDeps.test.ts
git commit -m "build(frontend): pin potree-core 2.0.15, three 0.180.0 and @types/three 0.180.0" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Empty screens, lazy routes, nav entries, titles and the About link

Shell: PowerShell at the worktree root `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation`.

Load the design skills and read DESIGN.md before this task (AGENTS.md §3). The screens use only `EmptyState` and tokens from `frontend/src/ui/`.

**Files:**
- Create: `frontend/src/screens/CloudsScreen.tsx`, `VolumesScreen.tsx`, `AboutScreen.tsx`, `foundationScreens.test.tsx`
- Create: `frontend/src/app/lazyScreens.tsx`, `lazyScreens.test.tsx`
- Modify: `frontend/src/routes.tsx`
- Modify: `frontend/src/app/Sidebar.tsx:149-151` and `:204-208`; `frontend/src/app/Sidebar.test.tsx` (append)
- Modify: `frontend/src/app/Header.tsx:23` and `:33`; `frontend/src/app/Header.test.ts` (append)
- Modify: `frontend/src/screens/AppSettingsScreen.tsx`; `AppSettingsScreen.test.tsx`
- Modify: `frontend/e2e/projects.spec.ts:9` and `:62`
- Test: `frontend/e2e/pointcloud-foundation.spec.ts`

**Interfaces:**
- Consumes: `IconName` `"cloud"`/`"volume"` (Task 5).
- Produces: routes `about`, `p/:projectId/clouds`, `p/:projectId/clouds/:cloudId`, `p/:projectId/volumes`, `p/:projectId/volumes/:measurementId`; `CloudsScreen`, `VolumesScreen`, `AboutScreen` (named exports in `src/screens/`, which S1 U1/A1 and S2 V7/V8 fill in); the lazy wrappers `CloudsScreen`, `VolumesScreen`, `AboutScreen` and `<Later>` in `src/app/lazyScreens.tsx`; the 3D-jump URL contract comment next to the clouds routes.

- [ ] **Step 1: Write the failing unit tests**

`frontend/src/screens/foundationScreens.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutScreen } from "./AboutScreen";
import { CloudsScreen } from "./CloudsScreen";
import { VolumesScreen } from "./VolumesScreen";

describe("the empty screens foundation F0 lands", () => {
  it("Point clouds says what it is for and that import is not here yet", () => {
    render(<CloudsScreen />);
    expect(screen.getByRole("heading", { name: "Point clouds" })).toBeInTheDocument();
    expect(screen.getByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
    expect(screen.getByText(/not available in this build yet/)).toBeInTheDocument();
  });

  it("Volumes says what it is for", () => {
    render(<VolumesScreen />);
    expect(screen.getByRole("heading", { name: "Volumes" })).toBeInTheDocument();
    expect(screen.getByText("Measure stockpiles and earthworks")).toBeInTheDocument();
  });

  it("About names the app", () => {
    render(<AboutScreen />);
    expect(screen.getByRole("heading", { name: "About Kestrel AI" })).toBeInTheDocument();
  });
});
```

`frontend/src/app/lazyScreens.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutScreen, CloudsScreen, Later, VolumesScreen } from "./lazyScreens";

describe("lazy screens (foundation F0)", () => {
  it.each([
    ["Point clouds", <CloudsScreen key="c" />],
    ["Volumes", <VolumesScreen key="v" />],
    ["About Kestrel AI", <AboutScreen key="a" />],
  ])("loads %s behind a placeholder", async (heading, element) => {
    render(<Later>{element}</Later>);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
  });
});
```

Append to `frontend/src/app/Sidebar.test.tsx`:

```tsx

describe("Sidebar: point clouds and volumes (foundation F0)", () => {
  beforeEach(() => {
    useProgressStore.setState({ byProject: {} });
  });

  it("a detection project lists Point clouds, then Volumes, after Site areas", () => {
    useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "detect" } });
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 12, models: 1 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="North site" />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    const nav = screen.getByRole("navigation");
    const order = ["Site areas", "Point clouds", "Volumes", "Project settings"].map((label) =>
      within(nav).getByText(label),
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(nav).getByRole("link", { name: "Point clouds" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/clouds`,
    );
    expect(within(nav).getByRole("link", { name: "Volumes" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/volumes`,
    );
    // Design surfaces are imported from the Volumes screen; they have no entry of their own.
    expect(within(nav).queryByRole("link", { name: /Design/ })).toBeNull();
  });

  it("a training project has neither", () => {
    useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "train" } });
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByRole("link", { name: "Point clouds" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Volumes" })).toBeNull();
  });
});
```

Append to `frontend/src/app/Header.test.ts`:

```ts

describe("screenName: foundation F0 screens", () => {
  it("names Point clouds, Volumes and About", () => {
    expect(screenName("/p/abc/clouds")).toBe("Point clouds");
    expect(screenName("/p/abc/clouds/c1")).toBe("Point clouds");
    expect(screenName("/p/abc/volumes")).toBe("Volumes");
    expect(screenName("/p/abc/volumes/v1")).toBe("Volumes");
    expect(screenName("/about")).toBe("About");
  });
});
```

In `frontend/src/screens/AppSettingsScreen.test.tsx`, add inside the `describe`, after the existing test:

```tsx

  it("links to About Kestrel AI", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/providers$/, body: { items: exampleProviders } }]);
    renderWithProviders(<AppSettingsScreen />, { api, route: "/settings", path: "/settings" });
    expect(screen.getByRole("link", { name: "About Kestrel AI" })).toHaveAttribute("href", "/about");
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm -C frontend exec vitest run src/screens/foundationScreens.test.tsx src/app/lazyScreens.test.tsx src/app/Sidebar.test.tsx src/app/Header.test.ts src/screens/AppSettingsScreen.test.tsx`
Expected: FAIL — the new screen modules do not exist, the Sidebar has no "Point clouds" link, `screenName("/about")` is `""`, and there is no "About Kestrel AI" link.

- [ ] **Step 3: The three empty screens and their lazy wrappers**

`frontend/src/screens/CloudsScreen.tsx`:

```tsx
import { EmptyState } from "@/ui";

/**
 * Point clouds: import a LAS/LAZ, view it in 3D, measure, link it to a map, export a LAZ (spec
 * 2026-09-23-point-clouds section 8). Lazy-loaded from routes.tsx, so three and potree-core load
 * only here. Foundation F0 lands it empty; S1 units U1, U2 and J1 build it.
 */
export function CloudsScreen() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Point clouds</h1>
      <EmptyState icon="cloud" title="Import a LAS or LAZ point cloud">
        See a drone survey&apos;s point cloud in 3D, measure it and link it to a map of the same flight.
        Importing is not available in this build yet.
      </EmptyState>
    </div>
  );
}
```

`frontend/src/screens/VolumesScreen.tsx`:

```tsx
import { EmptyState } from "@/ui";

/**
 * Volumes: surfaces from point clouds and designs, cut and fill over a polygon (spec
 * 2026-09-23-volumes section 9). Lazy-loaded from routes.tsx. Foundation F0 lands it empty; S2
 * units V7 and V8 build it, and S3 unit U8 mounts "Import design surface" in its surface list.
 */
export function VolumesScreen() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Volumes</h1>
      <EmptyState icon="volume" title="Measure stockpiles and earthworks">
        Build a surface from a point cloud, then measure cut and fill against a toe, a flat level, another
        survey or a design. Volumes are not available in this build yet.
      </EmptyState>
    </div>
  );
}
```

`frontend/src/screens/AboutScreen.tsx`:

```tsx
import { EmptyState } from "@/ui";

/**
 * About Kestrel AI: the app version and the licence notices of the components it ships (spec
 * 2026-09-23-point-clouds section 12). Lazy-loaded from routes.tsx. Foundation F0 lands it empty;
 * S1 unit A1 fills it from `src/about/notices.json`.
 */
export function AboutScreen() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">About Kestrel AI</h1>
        <p className="text-sm text-muted">
          The app&apos;s version and the licences of the components it uses.
        </p>
      </div>
      <EmptyState icon="info" title="Licence notices">
        The component list is not available in this build yet.
      </EmptyState>
    </section>
  );
}
```

`frontend/src/app/lazyScreens.tsx`:

```tsx
import { lazy, Suspense, type ReactNode } from "react";
import { Skeleton } from "@/ui";

// Lazy screens: the Clouds screen pulls in three and potree-core (about 1 MB), which the rest of
// the app never pays for (spec 2026-09-23-point-clouds section 2, "Viewer lifecycle").
export const CloudsScreen = lazy(() =>
  import("@/screens/CloudsScreen").then((m) => ({ default: m.CloudsScreen })),
);
export const VolumesScreen = lazy(() =>
  import("@/screens/VolumesScreen").then((m) => ({ default: m.VolumesScreen })),
);
export const AboutScreen = lazy(() =>
  import("@/screens/AboutScreen").then((m) => ({ default: m.AboutScreen })),
);

/** A lazy screen with a placeholder while its code loads. */
export function Later({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="flex max-w-3xl flex-col gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
```

- [ ] **Step 4: The routes**

In `frontend/src/routes.tsx`, after line 3 `import { KindRoute } from "@/app/KindRoute";` insert:

```tsx
import { AboutScreen, CloudsScreen, Later, VolumesScreen } from "@/app/lazyScreens";
```

After the `only` helper (line 31) insert:

```tsx

/** A detection-project screen whose code loads on its first visit. */
const detectLater = (screen: ReactNode) => only(DETECT, <Later>{screen}</Later>);
```

After `      { path: "settings", element: <AppSettingsScreen /> },` insert:

```tsx
      {
        path: "about",
        element: (
          <Later>
            <AboutScreen />
          </Later>
        ),
      },
```

Replace the comment line `      // Site areas below the divider. A map opens in the viewer from Sources.` with `      // Site areas, Point clouds and Volumes below the divider. A map opens in the viewer from Sources.`, and after `      { path: "p/:projectId/maps/:mapId", element: only(DETECT, <MapsScreen />) },` insert:

```tsx
      // The 3D jump contract (spec 2026-09-23-point-clouds section 10), used unchanged by the
      // maps -> 3D jump, the 3D -> map jump and the Volumes screen's "View in 3D":
      //   /p/:projectId/clouds/:cloudId?at=x,y[&fp=x1,y1;x2,y2;x3,y3;x4,y4]
      //   /p/:projectId/maps/:mapId?at=x,y
      // Coordinates are in the DESTINATION's native CRS; the source screen converts them with
      // proj4 (both entities carry `proj4`), so the destination never knows where the caller came
      // from. `fp` is a box footprint's four corners. The screen reads them once per navigation.
      { path: "p/:projectId/clouds", element: detectLater(<CloudsScreen />) },
      { path: "p/:projectId/clouds/:cloudId", element: detectLater(<CloudsScreen />) },
      { path: "p/:projectId/volumes", element: detectLater(<VolumesScreen />) },
      { path: "p/:projectId/volumes/:measurementId", element: detectLater(<VolumesScreen />) },
```

- [ ] **Step 5: The nav entries, the titles and the About link**

In `frontend/src/app/Sidebar.tsx`, replace the doc comment lines 150–151:

```tsx
 * The left rail: Projects and Library, then the open project's steps for its kind, then Site areas
 * (detection projects), Past detections (training projects that have some) and the settings.
```

with:

```tsx
 * The left rail: Projects and Library, then the open project's steps for its kind, then Site areas,
 * Point clouds and Volumes (detection projects), Past detections (training projects that have
 * some) and the settings.
```

and directly after the Site areas block (the `)}` that closes `{kind === "detect" && (… Site areas …)}`, line 208) insert:

```tsx
          {/* Point clouds, then Volumes: the one statement of this order is spec
              2026-09-23-point-clouds section 5 item 7. Design surfaces have no entry: they are
              imported from the Volumes screen's surface list. */}
          {kind === "detect" && (
            <PlainEntry to={`/p/${projectId}/clouds`} icon="cloud" compact={compact} shortLabel="Clouds">
              Point clouds
            </PlainEntry>
          )}
          {kind === "detect" && (
            <PlainEntry to={`/p/${projectId}/volumes`} icon="volume" compact={compact}>
              Volumes
            </PlainEntry>
          )}
```

In `frontend/src/app/Header.tsx`, after line 23 `  "site-areas": "Site areas",` insert:

```tsx
  clouds: "Point clouds",
  volumes: "Volumes",
```

and after line 33 `  if (parts[0] === "library") return "Library";` insert `  if (parts[0] === "about") return "About";`.

In `frontend/src/screens/AppSettingsScreen.tsx`, replace line 1 `import { ProvidersSection } from "@/settings/ProvidersSection";` with:

```tsx
import { Link } from "react-router-dom";
import { ProvidersSection } from "@/settings/ProvidersSection";
import { buttonClass } from "@/ui";
```

and replace

```tsx
        <ProvidersSection />
      </div>
```

with:

```tsx
        <ProvidersSection />
      </div>
      <div className="border-t border-line pt-4">
        <Link to="/about" className={buttonClass("secondary", "sm")}>
          About Kestrel AI
        </Link>
      </div>
```

- [ ] **Step 6: Run the unit tests to confirm they pass**

Run: `pnpm -C frontend format; pnpm -C frontend exec vitest run src/screens/foundationScreens.test.tsx src/app/lazyScreens.test.tsx src/app/Sidebar.test.tsx src/app/Header.test.ts src/screens/AppSettingsScreen.test.tsx`
Expected: PASS. (`format` lets prettier lay out the new route objects.)

- [ ] **Step 7: The e2e tests**

`frontend/e2e/pointcloud-foundation.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { asDetectionProject } from "./kinds";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("a detection project opens the empty Point clouds and Volumes screens from the rail", async ({
  page,
}) => {
  await asDetectionProject(page, P);
  await page.goto(`/p/${P}`);
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  await nav.getByRole("link", { name: "Point clouds", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds$`));
  await expect(page.getByRole("heading", { name: "Point clouds" })).toBeVisible();
  await expect(page.getByText("Import a LAS or LAZ point cloud")).toBeVisible();

  await nav.getByRole("link", { name: "Volumes", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/volumes$`));
  await expect(page.getByRole("heading", { name: "Volumes" })).toBeVisible();

  // A deep link with the 3D-jump parameters lands on the same screen.
  await page.goto(`/p/${P}/clouds/c1?at=553100.5,2847300.25`);
  await expect(page.getByRole("heading", { name: "Point clouds" })).toBeVisible();
});

test("a training project sends a Point clouds address Home", async ({ page }) => {
  await page.goto(`/p/${P}/clouds`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}$`));
});

test("App settings links to About Kestrel AI", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "About Kestrel AI" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About Kestrel AI" })).toBeVisible();
});
```

In `frontend/e2e/projects.spec.ts`, replace line 9 with:

```ts
const DETECT_STEPS = [
  "Sources",
  "Runs",
  "Review",
  "Analytics",
  "Export",
  "Site areas",
  "Point clouds",
  "Volumes",
];
```

and replace line 62 `  await expectSteps(page, TRAIN_STEPS, ["Sources", "Runs", "Analytics", "Site areas", "Detect", "Maps"]);` with:

```ts
  await expectSteps(page, TRAIN_STEPS, [
    "Sources",
    "Runs",
    "Analytics",
    "Site areas",
    "Detect",
    "Maps",
    "Point clouds",
    "Volumes",
  ]);
```

Run on free ports (another checkout may hold 1420/4010):

```powershell
$ports = 1..2 | ForEach-Object { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start(); $l.LocalEndpoint.Port; $l.Stop() }
$env:E2E_WEB_PORT = "$($ports[0])"; $env:E2E_MOCK_PORT = "$($ports[1])"
pnpm -C frontend exec playwright test e2e/pointcloud-foundation.spec.ts e2e/projects.spec.ts
Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
```

Expected: PASS (6 tests). The first one proves the lazy chunks load through the real router and that a `?at=` deep link lands on the Clouds screen.

- [ ] **Step 8: Lint, build and commit**

Run: `pnpm -C frontend lint; pnpm -C frontend test; pnpm -C frontend build`
Expected: no lint errors (only the existing `MapView.tsx` warning), `tokens ok`; every vitest passes; the build lists separate `CloudsScreen-*.js`, `VolumesScreen-*.js` and `AboutScreen-*.js` chunks.

```powershell
git add frontend/src/screens/CloudsScreen.tsx frontend/src/screens/VolumesScreen.tsx frontend/src/screens/AboutScreen.tsx frontend/src/screens/foundationScreens.test.tsx frontend/src/app/lazyScreens.tsx frontend/src/app/lazyScreens.test.tsx frontend/src/routes.tsx frontend/src/app/Sidebar.tsx frontend/src/app/Sidebar.test.tsx frontend/src/app/Header.tsx frontend/src/app/Header.test.ts frontend/src/screens/AppSettingsScreen.tsx frontend/src/screens/AppSettingsScreen.test.tsx frontend/e2e/pointcloud-foundation.spec.ts frontend/e2e/projects.spec.ts
git commit -m "feat(ui): Point clouds and Volumes in the detection rail, lazy empty screens, About link" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Gate, ledger, migration-head re-check, merge to `main`, hand-off

S1, S2 and S3 worktrees branch from `main` only after this task, so F0 is not done until it is on `main`.

**Files:**
- Modify: `docs/progress.md` (a new entry at the top, under the resume instructions)

**Interfaces:**
- Consumes: everything above.
- Produces: `task/pointcloud-foundation` merged into `main`, the worktree removed, the branch deleted, one alembic head on `main`.

- [ ] **Step 1: Bring the branch up to `main`**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation
if ((git branch -r) -match 'origin/main') { git fetch origin main; git -C E:\Dev\Yolo\app rev-parse main origin/main }
git rebase main
git merge-base --is-ancestor main HEAD; "main is an ancestor: $($LASTEXITCODE -eq 0)"
```

Expected: when `origin/main` exists, the two hashes are equal (if not, stop: the landing script would fast-forward `main` after the gate); the rebase succeeds; `main is an ancestor: True`. If `main` moved and brought a migration, go on to Step 2 before anything else.

- [ ] **Step 2: Re-check migration heads across every branch** (ADR `2026-09-23-gotcha-parallel-branches-collide-on-migration-ids`)

```powershell
git branch -a --format='%(refname:short)' | ForEach-Object {
  $b = $_
  git ls-tree --name-only $b backend/app/db/migrations/versions/ 2>$null |
    Where-Object { $_ -match '/0009_' } | ForEach-Object { "$b  $_" }
}
Get-ChildItem E:\Dev\Yolo\app\.claude\worktrees\*\backend\app\db\migrations\versions\0009_* -ErrorAction SilentlyContinue | ForEach-Object FullName
cd backend
& $PY -c "from alembic.config import Config; from alembic.script import ScriptDirectory; cfg=Config('app/db/migrations/alembic.ini'); cfg.set_main_option('script_location','app/db/migrations'); sd=ScriptDirectory.from_config(cfg); print(sd.get_heads(), [r.revision for r in sd.walk_revisions()][::-1])"
```

Expected: the only `0009_*` is `task/pointcloud-foundation  backend/app/db/migrations/versions/0009_pointclouds_surfaces_volumes.py` (plus this worktree's own file), and `['0009'] ['0001', …, '0008', '0009']`.

- If a `0009` is already on `main` (it arrived with the rebase): renumber F0's migration to the next free id — rename the file, set `revision` and `down_revision` to `main`'s head, set `REVISION` in `tests/test_migration_0009.py` (and rename that file to match), run `& $PY -m pytest tests/test_migration_0009.py -q`, commit "fix(db): renumber the F0 migration after <id>", and repeat this step.
- If another **unmerged** branch claims `0009`: F0 keeps it (the first to merge wins); name that branch in the hand-off (Step 9) so it renumbers when it merges. Today `task/model-gsd` carries `0007_model_train_gsd`, which already collides with `main`'s `0007` and must renumber after `0009`.

- [ ] **Step 3: Install the five new packages into the shared venv, additively** (operator decision "additive install"; Deviation 8)

The shared `E:\Dev\Yolo\app\backend\.venv` is a uv venv without pip, so `python -m pip` is not available there; `uv pip --python <shared python>` is the same install with the same flags. Only the five packages F0 adds, at the pins, with `--no-deps`: nothing else is upgraded, downgraded or removed. Safe before the merge: the packages are new, so no other worktree's imports change.

```powershell
$shared = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
$ev = "$env:TEMP\kestrel-f0-venv"; New-Item -ItemType Directory -Force $ev | Out-Null
& $shared -c "from importlib.metadata import version as v, PackageNotFoundError as E`nfor n in ('laspy','lazrs','ezdxf','openpyxl','et-xmlfile'):`n    try: print(n, v(n))`n    except E: print(n, 'absent')"
uv pip list --python $shared --format freeze | Out-File -Encoding utf8 "$ev\before.txt"
uv pip install --python $shared --no-deps laspy==2.7.0 lazrs==0.8.2 ezdxf==1.4.4 openpyxl==3.1.5 et-xmlfile==2.0.0
uv pip list --python $shared --format freeze | Out-File -Encoding utf8 "$ev\after.txt"
Compare-Object (Get-Content "$ev\before.txt") (Get-Content "$ev\after.txt") | Format-Table -AutoSize
```

Expected: the first command prints `absent` for all five (if any is present at a different version, stop and report: something else installed it and the operator decides); `Installed 5 packages`; and the diff shows exactly five `=>` lines — `et-xmlfile==2.0.0`, `ezdxf==1.4.4`, `laspy==2.7.0`, `lazrs==0.8.2`, `openpyxl==3.1.5` — and no `<=` line (nothing removed or changed). Any other line: stop and report; do not try to repair the shared venv by hand. Keep the two lists for the hand-off.

Then prove the shared interpreter now passes the pin test and the LAS-writing tests on this branch:

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation\backend
& $shared -m pytest tests/test_dependency_pins.py tests/test_pointcloud_fixtures.py tests/test_pointcloud_foundation.py -q
cd ..
```

Expected: PASS.

- [ ] **Step 4: Run the full gate with the overlay venv, for the ledger counts** (AGENTS.md §4; `finish-task.ps1` runs it again on the shared interpreter in Step 6)

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\pointcloud-foundation
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$ports = 1..2 | ForEach-Object { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start(); $l.LocalEndpoint.Port; $l.Stop() }
$env:E2E_WEB_PORT = "$($ports[0])"; $env:E2E_MOCK_PORT = "$($ports[1])"; pnpm -C frontend e2e; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
if (Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe) { & "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path frontend/src-tauri/Cargo.toml } else { "cargo test skipped: no frozen sidecar in this worktree" }
```

Expected: contract clean with `schema.d.ts` unchanged; ruff clean; pytest all pass (about 1 400 tests, about 10 minutes); frontend lint without errors and `tokens ok`; vitest all pass; build ok; every e2e test passes; `cargo test skipped` (a fresh worktree has no frozen sidecar). Record the counts for the ledger. Any failure: fix it (superpowers:systematic-debugging), commit, and run the whole gate again.

- [ ] **Step 5: The ledger entry**

In `docs/progress.md`, insert after the resume-instructions paragraph (before the first `## ` entry):

```markdown
## Point-cloud foundation F0 — 2026-09-24 (`task/pointcloud-foundation`, merged to `main`)

Spec `docs/superpowers/specs/2026-09-23-point-clouds-design.md` §5 (with S2 §11 and S3 §12), plan
`docs/superpowers/plans/2026-09-24-pointcloud-foundation.md`. The shared ground S1 (point clouds),
S2 (volumes) and S3 (design surfaces) build on in parallel worktrees.

What changed:

- **Contract:** every S1–S3 path and schema (37 operations; tags `pointclouds`, `surfaces`,
  `volumes`), the job types `pointcloud_import`, `pointcloud_export`, `surface_build`,
  `volume_calc`, `volume_export`, `design_import`, and the events `pointclouds.changed`,
  `surfaces.changed`, `volumes.changed`. Every operation answers 501 until its unit lands
  (`EXPECTED_STUBS`); writes are detection-project only.
- **Migration `0009_pointclouds_surfaces_volumes`** (add-only): `point_cloud`, `cloud_measurement`,
  `surface`, `volume_measurement`. The only migration of S1–S3.
- **Backend scaffolding:** four packages with stub routers and stub jobs, four no-op startup sweeps
  in `project_opened`, the PotreeConverter seam with an offline fake in the `app` fixture,
  `pointcloud-selftest` / `design-selftest` / `volumes-selftest` placeholders, CORS `Range` for the octree loader.
- **Dependencies:** laspy 2.7.0, lazrs 0.8.2, openpyxl 3.1.5, ezdxf 1.4.4 new; scipy, shapely,
  psutil now direct; potree-core 2.0.15, three 0.180.0, @types/three 0.180.0 exact.
- **UI:** Point clouds and Volumes below Site areas in a detection project (empty, lazy-loaded
  screens), "About Kestrel AI" on App settings.
- **Venv** (`vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`): built
  with an overlay venv; laspy, lazrs, ezdxf, openpyxl and et-xmlfile were then installed into the
  shared `backend/.venv` additively (`--no-deps`, nothing else changed), so the landing gate ran
  normally.

Verified on the rebased branch (2026-09-24) with the AGENTS.md gate: `pnpm -C contract check` clean;
ruff clean; pytest <N> passed; frontend lint clean, vitest <M> passed, build ok; e2e <K> passed;
cargo test skipped (no frozen sidecar in the worktree). Alembic heads on the merge result: `['0009']`.

Operator walkthrough: not user-observable beyond two empty screens and two nav entries — open a
detection project and click Point clouds, then Volumes; App settings → About Kestrel AI.
```

Replace `<N>`, `<M>` and `<K>` with the counts Step 4 printed, then:

```powershell
git add docs/progress.md
git commit -m "docs(progress): ledger entry for the point-cloud foundation F0, with the gate results" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Land with the finish flow**

`scripts/finish-task.ps1` syncs `main` with `origin/main`, rebases (a no-op after Step 1), runs the full gate with the shared interpreter (which has the new packages since Step 3), merges `--ff-only`, pushes when `origin` exists, and removes the worktree junction-safely. Run it normally — **no `-SkipGate`**:

```powershell
git status --porcelain   # must print nothing
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\finish-task.ps1
```

Expected: the gate passes, then `done: task/pointcloud-foundation merged into main, worktree removed, branch deleted.` The overlay venv is a real folder, so the removal deletes it with the worktree. If the gate fails only because a package is missing from the shared interpreter, stop and report it (with Step 3's two lists); never land with `-SkipGate` to get around it. Any other failure: fix it (superpowers:systematic-debugging), commit, re-run Step 4, then this step.

- [ ] **Step 7: Verify `main` after the merge, on the shared interpreter**

```powershell
cd E:\Dev\Yolo\app
git log -1 --oneline main
cd backend
& .\.venv\Scripts\python.exe -c "from alembic.config import Config; from alembic.script import ScriptDirectory; cfg=Config('app/db/migrations/alembic.ini'); cfg.set_main_option('script_location','app/db/migrations'); print(ScriptDirectory.from_config(cfg).get_heads())"
& .\.venv\Scripts\python.exe -m pytest tests/test_dependency_pins.py tests/test_pointcloud_fixtures.py tests/test_pointcloud_foundation.py -q
cd ..
pnpm -C frontend install --frozen-lockfile
Test-Path E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe
git worktree list
```

Expected: `main` is the ledger commit; heads `['0009']`; the pin test and the LAS-writing tests pass on `main` with the shared interpreter; the main checkout's `node_modules` gains potree-core and three (the ADR on parallel branches: a merge that changes `package.json` is not complete until the checkout it lands in is installed); `True` (the shared venv survived); no `pointcloud-foundation` worktree listed.

- [ ] **Step 8: The operator line**

Tell the operator, verbatim: "F0 is not user-observable beyond two empty screens and two nav entries: in a detection project the rail now shows Point clouds and Volumes below Site areas (each opens an empty screen), and App settings has an About Kestrel AI link."

- [ ] **Step 9: Hand-off to the coordinator**

Report: the merge commit; the gate counts; the alembic head; any branch that must renumber its migration (Step 2 — at least `task/model-gsd`); the `uv pip list` diff of Step 3 (exactly five added lines); and that **the shared `E:\Dev\Yolo\app\backend\.venv` now has laspy 2.7.0, lazrs 0.8.2, ezdxf 1.4.4, openpyxl 3.1.5 and et-xmlfile 2.0.0**, so S1, S2 and S3 land through `finish-task.ps1` with the normal gate (no `-SkipGate`); their worktrees may still build the overlay venv for isolation while they develop.
