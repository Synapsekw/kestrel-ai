# G1 Starter Weights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new user can add a base model with one click: the installer ships `yolo11n.pt`, `yolo11s.pt` and `yolo11m.pt`, the Models screen offers them, and the Train and Query screens point to them when the registry is empty.

**Architecture:** The frozen backend carries a `starter_weights/` data folder. A small module lists the fixed catalogue and imports one entry through the existing `registry.import_model` (so a starter model is an ordinary `imported` Model). Two contract operations expose it (`listStarterModels`, `importStarterModel`; already in `contract/openapi.yaml` on this branch, client regenerated). The frontend adds a "Starter models" section to the Models screen and empty-registry hints to Train and Query.

**Tech Stack:** FastAPI, pydantic-settings, pytest; React 18 + TypeScript, Vitest, Playwright against Prism; PyInstaller spec, PowerShell build scripts.

**Spec:** `docs/usability/2026-09-19-walkthrough.md` item G1 and the owner ruling ("bundle `yolo11n/s/m.pt` in the installer"); design spec `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` sections 7 and 10.

## Global Constraints

- Interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, cwd inside this worktree. Never install packages, never `git clean`, never create links or junctions to the shared venv.
- Never modify anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`. `E:\Dev\Yolo\models\*.pt` may be read (copied from).
- The contract is already edited by the goal owner. Do not edit `contract/openapi.yaml`; if something in it blocks you, stop and report.
- `*.pt` is git-ignored: weights are never committed. Tests never need real weights (fake `read_class_names` as `tests/test_registry.py` does).
- Bash heredocs on this machine collapse `\\` to `\`: write files that contain Windows paths with the Write/Edit tools.
- TDD in every task: failing test first, watch it fail, minimal code, watch it pass, commit. One commit per task at least.
- Suites that must be green at the end: backend `python -m pytest -q` and `python -m ruff check .`; `pnpm --dir contract check`; frontend `pnpm lint`, `npx vitest run`, `pnpm build`, `pnpm e2e`.
- Copy rules: plain language for an analyst; never the words "Label Studio".

## File map

| File | Responsibility |
|---|---|
| `backend/app/training/starter.py` (new) | catalogue, folder resolution, `list_starters`, `import_starter` |
| `backend/app/training/starter_router.py` (new) | `GET /starter-models` (global) and `POST /projects/{p}/models/import-starter` |
| `backend/app/config.py` | `starter_weights_dir: Path \| None` |
| `backend/app/api.py` | mount the new router |
| `backend/tests/test_starter.py` (new) | unit + API tests |
| `backend/scripts/fetch_starter_weights.ps1` (new) | fills `backend/starter_weights/` |
| `backend/machinery_backend.spec`, `backend/scripts/build.ps1`, `backend/scripts/smoke_frozen.ps1` | bundle and prove the weights |
| `frontend/src/api/starterModels.ts` (+ test) | typed calls |
| `frontend/src/models/StarterModels.tsx` (+ test) | the section on the Models screen |
| `frontend/src/screens/ModelsScreen.tsx`, `frontend/src/train/TrainForm.tsx`, `frontend/src/query/SourcePicker.tsx` | wiring and empty-registry hints |
| `frontend/e2e/models.spec.ts` | one e2e flow |
| `README.md` | build step and troubleshooting line |

---

### Task 1: Backend catalogue and import

**Files:** Create `backend/app/training/starter.py`, `backend/tests/test_starter.py`; modify `backend/app/config.py`.

**Interfaces:**
- Produces: `starter.CATALOGUE: list[StarterSpec]`, `starter.weights_dir(settings) -> Path`, `starter.list_starters(folder: Path) -> list[dict]`, `starter.import_starter(handle, folder: Path, key: str, name: str | None) -> Model`.
- Consumes: `app.training.registry.import_model(handle, name, weights_path, class_aliases)`, `handle.session()`, `handle.row(s).classes` (list of dicts with `name`).

- [ ] **Step 1: failing tests** (`backend/tests/test_starter.py`). Fixtures `handle`, `tmp_path`, `monkeypatch` exist in `conftest.py`.

```python
from pathlib import Path

import pytest

from app.errors import AppError
from app.training import starter


@pytest.fixture
def folder(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "starter_weights"
    d.mkdir()
    (d / "yolo11n.pt").write_bytes(b"x" * 2_000_000)
    monkeypatch.setattr("app.training.registry.read_class_names", lambda path: ["person", "truck"])
    return d


def test_the_catalogue_lists_three_sizes_smallest_first_and_marks_missing_files(folder):
    items = starter.list_starters(folder)
    assert [i["key"] for i in items] == ["yolo11n", "yolo11s", "yolo11m"]
    assert items[0]["available"] is True and items[0]["size_mb"] == pytest.approx(1.9, abs=0.1)
    assert items[1]["available"] is False and items[1]["size_mb"] == 0
    assert all(i["name"] and i["description"] for i in items)


def test_import_registers_an_imported_model_with_the_truck_alias(handle, folder):
    row = starter.import_starter(handle, folder, "yolo11n", None)
    assert row.kind == "imported" and row.name == "yolo11n-coco"
    assert row.class_aliases == {"truck": "dump_truck"}  # the default project has dump_truck
    assert (handle.folder / row.weights_path).is_file()
    assert (folder / "yolo11n.pt").is_file()  # the bundled file stays


def test_import_without_a_dump_truck_class_sets_no_alias(handle, folder, monkeypatch):
    monkeypatch.setattr(starter, "project_class_names", lambda h: ["excavator"])
    assert starter.import_starter(handle, folder, "yolo11n", "mine").class_aliases == {}


def test_a_missing_file_is_a_404_that_names_the_fix(handle, folder):
    with pytest.raises(AppError) as e:
        starter.import_starter(handle, folder, "yolo11m", None)
    assert e.value.status == 404 and "not part of this build" in e.value.message


def test_weights_dir_prefers_the_setting_then_the_frozen_bundle_then_the_checkout(tmp_path, monkeypatch, settings):
    assert starter.weights_dir(settings.model_copy(update={"starter_weights_dir": tmp_path})) == tmp_path
    monkeypatch.setattr("sys._MEIPASS", str(tmp_path / "bundle"), raising=False)
    monkeypatch.setattr("sys.frozen", True, raising=False)
    assert starter.weights_dir(settings) == tmp_path / "bundle" / "starter_weights"
    monkeypatch.setattr("sys.frozen", False, raising=False)
    assert starter.weights_dir(settings).name == "starter_weights"
    assert starter.weights_dir(settings).parent.name == "backend"
```

If the `settings` fixture is not a pydantic object with `model_copy`, read `conftest.py` and adapt the first assertion (construct `Settings(token="t", starter_weights_dir=tmp_path)`).

- [ ] **Step 2:** run `python -m pytest tests/test_starter.py -q`; expected: import error for `app.training.starter`.

- [ ] **Step 3: implement**

`backend/app/config.py`: add to `Settings`:

```python
    # Folder with the bundled starter weights; None = next to the frozen exe, else backend/starter_weights.
    starter_weights_dir: Path | None = None
```

`backend/app/training/starter.py`:

```python
"""Starter weights that ship with the app (usability gap G1): COCO YOLO11 in three sizes."""

import sys
from dataclasses import dataclass
from pathlib import Path

from app.config import Settings
from app.db.models import Model
from app.errors import AppError
from app.projects.service import ProjectHandle
from app.training import registry


@dataclass(frozen=True)
class StarterSpec:
    key: str
    name: str
    description: str


CATALOGUE = [
    StarterSpec("yolo11n", "YOLO11 nano", "Fastest to train and run; the right first choice for a new project."),
    StarterSpec("yolo11s", "YOLO11 small", "A little slower, usually more accurate once a few hundred images are labeled."),
    StarterSpec("yolo11m", "YOLO11 medium", "Slowest of the three; best accuracy with a large labeled set and for pre-annotation."),
]

# COCO has no construction classes; its `truck` is the closest to a dump truck.
DEFAULT_ALIASES = {"truck": "dump_truck"}


def weights_dir(settings: Settings) -> Path:
    if settings.starter_weights_dir is not None:
        return settings.starter_weights_dir
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "starter_weights"
    return Path(__file__).resolve().parents[2] / "starter_weights"


def list_starters(folder: Path) -> list[dict]:
    items = []
    for spec in CATALOGUE:
        f = folder / f"{spec.key}.pt"
        ok = f.is_file()
        items.append(
            {
                "key": spec.key,
                "name": spec.name,
                "description": spec.description,
                "size_mb": round(f.stat().st_size / 1_048_576, 1) if ok else 0,
                "available": ok,
            }
        )
    return items


def project_class_names(handle: ProjectHandle) -> list[str]:
    with handle.session() as s:
        return [str(c.get("name")) for c in (handle.row(s).classes or [])]


def import_starter(handle: ProjectHandle, folder: Path, key: str, name: str | None) -> Model:
    f = folder / f"{key}.pt"
    if key not in {s.key for s in CATALOGUE} or not f.is_file():
        raise AppError(
            "not_found",
            f"starter weights {key} are not part of this build; run backend/scripts/fetch_starter_weights.ps1",
            404,
        )
    names = set(project_class_names(handle))
    aliases = {src: dst for src, dst in DEFAULT_ALIASES.items() if dst in names}
    return registry.import_model(handle, name or f"{key}-coco", str(f.resolve()), aliases)
```

Check the real attribute names first (`handle.row`, `classes` shape: see `app/inference/service.py::class_names` and `app/projects/service.py`) and adapt; keep the public names above.

- [ ] **Step 4:** run the tests, expected PASS; `python -m ruff check .` clean.
- [ ] **Step 5:** commit `feat(models): starter weights catalogue and import (G1)`.

### Task 2: Backend routes

**Files:** Create `backend/app/training/starter_router.py`; modify `backend/app/api.py`; extend `backend/tests/test_starter.py`.

**Interfaces:** Consumes Task 1. Produces the two contract operations: `GET /api/v1/starter-models` -> `{items, next_cursor: null}`; `POST /api/v1/projects/{projectId}/models/import-starter` body `{key, name?}` -> 201 `Model` (same `ModelOut` as `importModel`).

- [ ] **Step 1: failing API tests** appended to `tests/test_starter.py` (the `client` fixture sends the token; `BASE = "/api/v1/projects"` as in the other test modules; point the app at the fake folder with `monkeypatch.setattr(starter, "weights_dir", lambda settings: folder)`):

```python
def test_the_api_lists_and_imports(client, project_id, folder, monkeypatch):
    monkeypatch.setattr(starter, "weights_dir", lambda settings: folder)
    r = client.get("/api/v1/starter-models")
    assert r.status_code == 200, r.text
    assert [i["available"] for i in r.json()["items"]] == [True, False, False]
    assert r.json()["next_cursor"] is None

    r = client.post(f"/api/v1/projects/{project_id}/models/import-starter", json={"key": "yolo11n"})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "imported" and r.json()["name"] == "yolo11n-coco"

    r = client.post(f"/api/v1/projects/{project_id}/models/import-starter", json={"key": "yolo11m"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.post(f"/api/v1/projects/{project_id}/models/import-starter", json={"key": "yolo99"})
    assert r.status_code == 422
```

- [ ] **Step 2:** run, expected 404 on the first GET.
- [ ] **Step 3: implement** `starter_router.py` with two `APIRouter`s or one router without a prefix; pydantic models `StarterModelOut`, `StarterModelPage`, `StarterModelImport(key: Literal["yolo11n","yolo11s","yolo11m"], name: str | None = Field(None, min_length=1))` in `app/training/schemas.py`; read settings from `request.app.state.settings` (check `app/main.py` for the real attribute; providers' router shows the pattern for a global, non-project route). Call `starter.weights_dir(...)` through the module (`starter.weights_dir`) so the monkeypatch works. Mount in `app/api.py`.
- [ ] **Step 4:** `python -m pytest -q` (the whole suite: `tests/test_contract.py` checks that every contract path is routed and every response conforms; it fails on this branch until this task is done) and `ruff check`.
- [ ] **Step 5:** commit `feat(models): starter-models endpoints (G1)`.

### Task 3: Fetch script, bundle, smoke test

**Files:** Create `backend/scripts/fetch_starter_weights.ps1`; modify `backend/machinery_backend.spec`, `backend/scripts/build.ps1`, `backend/scripts/smoke_frozen.ps1`, `README.md`.

- [ ] **Step 1: fetch script.** For each of `yolo11n`, `yolo11s`, `yolo11m`: skip when `backend\starter_weights\<key>.pt` exists and is larger than 1 MB; else copy `E:\Dev\Yolo\models\<key>.pt` when it exists; else download `https://github.com/ultralytics/assets/releases/download/v8.3.0/<key>.pt` with `Invoke-WebRequest -OutFile` to a `.part` file and rename on success. Print one line per file (`copied`, `downloaded`, `present`) with the size; exit 1 if any file is missing or smaller than 1 MB at the end. `$ErrorActionPreference = "Stop"`.
- [ ] **Step 2: run it** (`powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_starter_weights.ps1`) and record the three sizes in your report. Then verify each file loads: `python -c "from ultralytics import YOLO; import sys; print(len(YOLO(sys.argv[1]).names))" backend\starter_weights\yolo11s.pt` must print `80`.
- [ ] **Step 3: spec.** In `machinery_backend.spec` add to `datas`: `+ [(str(p), "starter_weights") for p in sorted(Path("starter_weights").glob("yolo11*.pt"))]` (import `Path`).
- [ ] **Step 4: build.ps1.** Before PyInstaller: fail with `throw "starter weights missing: run scripts\fetch_starter_weights.ps1"` unless all three files exist. After the copy: assert `dist\machinery-backend\_internal\starter_weights\yolo11n.pt` exists.
- [ ] **Step 5: smoke_frozen.ps1.** After health: `GET /starter-models` must report three available items (print `starter ok 3`); replace the `models/import` call that uses `$Weights` with `models/import-starter` `{ key = "yolo11n" }` and keep the prediction check. Keep the `$Weights` parameter for compatibility but unused is not allowed: remove it and its doc line.
- [ ] **Step 6:** Do NOT run `build.ps1` or the installer build (the goal owner does; it takes minutes and 4 GB). Do run the backend in dev (`APP_TOKEN=dev APP_PORT=8799 python -m app` from `backend/`, stop it afterwards by PID) and `curl` the two endpoints against a temp project to prove the dev path with the real files; put the responses in the report.
- [ ] **Step 7: README.** Build section: step 0 "fetch the starter weights"; layout table line; troubleshooting line for "starter weights ... are not part of this build".
- [ ] **Step 8:** commit `build: bundle the starter weights and prove them in the frozen smoke test (G1)`.

### Task 4: Frontend API and the Starter models section

**Files:** Create `frontend/src/api/starterModels.ts`, `frontend/src/api/starterModels.test.ts`, `frontend/src/models/StarterModels.tsx`, `frontend/src/models/StarterModels.test.tsx`; modify `frontend/src/screens/ModelsScreen.tsx`, `frontend/src/screens/ModelsScreen.test.tsx`.

**Interfaces:**
- Produces: `listStarterModels(api): Promise<StarterModel[]>`, `importStarterModel(api, projectId, key): Promise<Model>`; `<StarterModels projectId onImported={(m: Model) => void} existingNames={string[]} />`.
- Consumes: `unwrap` from `@/api/errors`, `useApi` from `@/api/client`, test helpers `fakeClient`, `renderWithProviders`, `exampleModel` from `@/test/fixtures`.

- [ ] **Step 1: failing tests.** API test mirrors `src/api/models.test.ts`. Component test:

```tsx
it("lists the three sizes, adds one with a click and reports it", async () => {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
    { method: "POST", path: /\/models\/import-starter$/, status: 201, body: { ...exampleModel, name: "yolo11n-coco" } },
  ]);
  const onImported = vi.fn();
  renderWithProviders(<StarterModels projectId={PROJECT_ID} existingNames={[]} onImported={onImported} />, { api });
  expect(await screen.findByText("YOLO11 nano")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add YOLO11 medium" })).toBeDisabled(); // available: false
  expect(screen.getByText(/not part of this build/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add YOLO11 nano" }));
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ name: "yolo11n-coco" })));
  expect(requests.at(-1)).toMatchObject({ method: "POST", body: { key: "yolo11n" } });
});

it("marks a size that is already in the registry and shows the envelope message on failure", async () => {
  const { api } = fakeClient([
    { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
    { method: "POST", path: /\/models\/import-starter$/, status: 404, body: errorBody("not_found", "starter weights yolo11s are not part of this build") },
  ]);
  renderWithProviders(<StarterModels projectId={PROJECT_ID} existingNames={["yolo11n-coco"]} onImported={() => {}} />, { api });
  const nano = await screen.findByTestId("starter-yolo11n");
  expect(within(nano).getByText("In the registry")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add YOLO11 small" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not part of this build"));
});
```

with `starters` = three items (`yolo11n` and `yolo11s` available, `yolo11m` not). "Already added" = `existingNames` contains `<key>-coco`: the button reads "Add again" is NOT wanted; show a small "In the registry" badge and keep the button enabled with the label `Add YOLO11 nano`.

- [ ] **Step 2:** run `npx vitest run src/models/StarterModels.test.tsx src/api/starterModels.test.ts`, expected failures for missing modules.
- [ ] **Step 3: implement.** Section heading "Starter models", one sentence: "General-purpose weights that ship with the app. Add one to use it as the base model for training; on aerial imagery they find little by themselves." Three cards in a row (name, size, description, button). Errors in `role="alert"`. Models screen: render the section above the table; change the empty text to "No models yet. Add a starter model above, or import your own weights."; after `onImported` select the model (reuse `onImported` that the import form uses).
- [ ] **Step 4:** unit suite, `pnpm lint`.
- [ ] **Step 5:** commit `feat(models): starter models on the Models screen (G1)`.

### Task 5: Empty-registry hints in Train and Query, e2e

**Files:** modify `frontend/src/train/TrainForm.tsx` (+ `TrainForm.test.tsx`), `frontend/src/query/SourcePicker.tsx` (+ its test or `QueryScreen.test.tsx`), `frontend/e2e/models.spec.ts`.

- [ ] **Step 1: failing tests.** TrainForm with `models={[]}` and `modelsUnavailable={false}` shows a link "Add a starter model" to `/p/${PROJECT_ID}/models` inside the Base model help text; with models present it shows the old help text. SourcePicker (local model, no models) shows the same link. SourcePicker may need a `projectId` prop: thread it from `QueryScreen`.
- [ ] **Step 2:** watch them fail. **Step 3:** implement. **Step 4:** unit suite green.
- [ ] **Step 5: e2e** in `e2e/models.spec.ts` against Prism (the contract example makes `yolo11n` available): open `/p/<P>/models`, expect heading "Starter models", click "Add YOLO11 nano", expect a POST to `/models/import-starter` with `{ key: "yolo11n" }` (use `page.waitForRequest` as the other specs do).
- [ ] **Step 6:** `pnpm lint`, `npx vitest run`, `pnpm build`, `pnpm e2e`; backend `pytest -q`, `ruff check .`; `pnpm --dir contract check`.
- [ ] **Step 7:** commit `feat(train,query): point to the starter models when the registry is empty (G1)`.

## Report

Write `.superpowers/sdd/usability/g1-report.md` (git-ignored): commits, test counts per suite, the fetch script output, the dev-backend curl responses, anything you could not do, and every deviation from this plan with its reason.
