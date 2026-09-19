# S2 Datasets Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Datasets become visible: a screen lists them with their split and class counts, creates one from every labeled image, deletes one, and leads to training.

**Architecture:** Frontend-first on the existing `listDatasets`, `getDataset`, `getDatasetStats`, `createDataset` operations. One new contract operation, `deleteDataset` (already in `contract/openapi.yaml` on this branch). A new route `/p/:projectId/datasets` and a sidebar entry between Review and Models.

**Tech Stack:** FastAPI + SQLAlchemy + pytest; React 18, TypeScript, Vitest, Playwright against Prism.

**Spec:** `docs/usability/2026-09-19-walkthrough.md` items S2 and S3 (owner ruling: S2 blocks); design spec sections 4 (Dataset is immutable after creation) and 5.

## Global Constraints

- Interpreter `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, cwd in this worktree; no installs, no `git clean`, no links/junctions, no `rm -rf` outside files you created; nothing outside the worktree is modified; no contract edits (`contract/client/index.ts` re-exports may be extended).
- Dev backend only on port 8799 with `APP_DATA_DIR` in a temp folder, stopped by PID. Ports 8080/9090 untouched. Running `machinery-app`/`machinery-backend` processes are not yours.
- Write/Edit tools for files with backslashes. TDD, commit per task.
- Green at the end: backend `pytest -q`, `ruff check .`; `pnpm check` in `contract/`; frontend `pnpm lint`, `npx vitest run`, `pnpm build`, `pnpm e2e`.
- Datasets stay immutable: the screen never edits one. Deleting removes the materialised folder and the rows; models trained on it keep working and show "deleted dataset".

## Contract (on the branch)

`DELETE /api/v1/projects/{projectId}/datasets/{datasetId}` `deleteDataset` -> 204. 404 unknown id. 409 `conflict` while a `train` job that uses the dataset, or the dataset's own `dataset` job, is queued or running.

## File map

| File | Responsibility |
|---|---|
| `backend/app/datasets/materialise.py` (or a new `backend/app/datasets/delete.py`) | `delete_dataset(handle, dataset_id)` |
| `backend/app/datasets/router.py` | the DELETE route |
| `backend/tests/test_dataset_delete.py` (new) | behaviour |
| `frontend/src/api/datasets.ts` (+test) | `deleteDataset`, `fetchDatasetStats` if missing |
| `frontend/src/datasets/DatasetList.tsx`, `DatasetDetail.tsx`, `NewDatasetForm.tsx`, `splitAdvice.ts` (+tests) | the screen's parts |
| `frontend/src/screens/DatasetsScreen.tsx` (+test), `frontend/src/routes.tsx`, `frontend/src/app/Shell.tsx` (+ `Shell.test.tsx`) | route and nav entry "Datasets" |
| `frontend/src/data/AddToDatasetDialog.tsx` (+test) | after success: link "Open dataset"; split advice |
| `frontend/src/train/TrainForm.tsx` (+test) | "Create dataset" link goes to the Datasets screen |
| `frontend/e2e/datasets.spec.ts` (new) | list, detail, delete |

---

### Task 1: Backend delete

- [ ] **Failing tests** (`backend/tests/test_dataset_delete.py`; reuse the helpers of `tests/test_datasets.py` that create a labeled project and wait for the dataset job):

```python
def test_delete_removes_the_folder_and_the_rows_and_keeps_the_images(client, project_id, handle, labeled_dataset):
    ds = labeled_dataset  # dict from POST /datasets after the job succeeded
    folder = handle.folder / ds["path"]
    assert folder.is_dir()
    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    assert r.status_code == 204, r.text
    assert not folder.exists()
    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 404
    assert client.get(f"{BASE}/{project_id}/datasets").json()["items"] == []
    assert client.get(f"{BASE}/{project_id}/images").json()["total"] > 0
    # the name is free again
    assert client.post(f"{BASE}/{project_id}/datasets", json={"name": ds["name"]}).status_code == 202


def test_delete_is_refused_while_a_training_job_uses_the_dataset(client, project_id, handle, labeled_dataset):
    # insert a Job row of type "train", state "running", params {"dataset_id": ds["id"]} through handle.session()
    ...
    r = client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_a_model_trained_on_a_deleted_dataset_still_lists(client, project_id, handle, labeled_dataset):
    # insert a Model row with dataset_id = ds id, delete the dataset, GET /models -> 200, dataset_id unchanged
    ...

def test_delete_unknown_is_404(client, project_id):
    assert client.delete(f"{BASE}/{project_id}/datasets/nope").status_code == 404
```

Replace each `...` with real row inserts (read `app/db/models.py` for `Job` and `Model` columns). Folder removal must not follow links: use `shutil.rmtree` only after checking `folder.resolve()` is inside `handle.folder / "datasets"`; refuse otherwise (500-free: `AppError("conflict", ...)`). Hard-linked images inside the dataset folder are safe to unlink (the originals under `images/` keep their data).

- [ ] Implement, full suite (contract test covers the new route), ruff, commit `feat(datasets): delete a dataset (S2)`.

### Task 2: API helpers and split advice

- `deleteDataset(api, projectId, datasetId): Promise<void>`; `fetchDatasetStats(api, projectId, datasetId)` (check `src/api/datasets.ts` first).
- `splitAdvice(dataset: {image_count, train_count, val_count, split_method, split_params}): string | null` in `frontend/src/datasets/splitAdvice.ts`:
  - `val_count === 0` -> "No validation images: training cannot measure the model. Use the random split or a larger fraction."
  - achieved fraction `val_count / image_count` differs from `split_params.val_fraction` by more than 0.1 and `split_method !== "random"` -> "`{val}` of `{n}` images (`{pct}` %) went to validation although `{requested}` % was asked: whole flights stay together, and this selection has few of them. With so few groups the random split gives a fairer measure."
  - else `null`.
- [ ] Failing unit tests with the numbers of the walk-through (14 images, 8/6, by_group, 0.2 -> the second message with 43 %), a clean case (30 images, 24/6 -> null), the zero-val case. Implement. Commit `feat(datasets): api helpers and split advice (S2, S3)`.

### Task 3: The screen

Layout (one column, like the Models screen): heading "Datasets" with the count; `NewDatasetForm` (collapsed behind a button "New dataset from all labeled images": name with the allowed-characters hint and the same client-side check as `AddToDatasetDialog`, split method, validation fraction, seed; on success the job card as in the dialog, and the list reloads when the job finishes: use `useOnJobsFinished("dataset", reload)` from `@/jobs/useOnJobsFinished`); table (name, images, train / val, split, created in local time via `formatLocalDate`); selecting a row (click, or Enter on the focused row: rows are `tabIndex=0`) shows `DatasetDetail`: the split advice if any (amber), boxes per class table (train / val) from `getDatasetStats`, groups table, folder path, buttons "Train on this dataset" (link to `/p/:id/train?dataset=<id>`; check how the dataset job card's "Train on it" link is built and reuse it) and "Delete dataset" with an inline confirmation ("Delete dataset v1? The frozen copy under datasets/v1 is removed. Images, labels and trained models are kept.") and the 409 message shown as an alert.

Empty state: "No datasets yet. A dataset is a frozen copy of the labeled images that training reads. Label some images first, then create one here or from a selection in the Data Manager." with links to Data.

- [ ] Failing component tests for: list renders rows and the empty state; detail shows advice + per-class counts; delete asks, sends DELETE, removes the row, shows a 409 message; new-dataset form validates the name and posts `{name, split_method, val_fraction, seed}` without `image_ids`. Implement. `Shell.test.tsx`: nav has "Datasets" linking to `/p/<id>/datasets`. Commit `feat(datasets): Datasets screen (S2)`.

### Task 4: Links and e2e

- `AddToDatasetDialog`: when the job succeeded show the split advice (needs the dataset: refetch `getDataset` after the job ends) and a link "Open dataset" to `/p/:id/datasets?dataset=<id>`; `TrainForm`'s "Create dataset" link targets the Datasets screen; the parenthetical becomes "(or select images in the Data Manager and use Add to dataset)".
- `e2e/datasets.spec.ts` against Prism: list shows the example dataset `v1`, open it, per-class table visible, delete -> DELETE request seen.
- [ ] All suites; commit `feat(datasets): links from the dataset dialog and the Train form; e2e (S2)`.

## Report

`E:\Dev\Yolo\app\.superpowers\sdd\usability\s2-report.md`: commits, test counts, deviations, open points.
