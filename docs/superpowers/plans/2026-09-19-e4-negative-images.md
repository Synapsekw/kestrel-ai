# E4 Negative Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An analyst can say "there is no machinery on this image": the image then counts as labeled, leaves the to-do list, and enters datasets as a negative example.

**Architecture:** One boolean on the image row, `marked_empty`, owned by the backend. `labeled` becomes "has a ground-truth box OR is marked empty". Marking empty rejects the image's unreviewed proposals in the same transaction and is refused while ground-truth boxes exist; any new ground truth (a drawn box, an accepted or edited proposal, a promotion) clears the mark, so the two states can never contradict. Two contract operations (`updateImage`, `bulkMarkEmpty`) are already in `contract/openapi.yaml` on this branch. The editor gets a "No machinery" action (hotkey N), the Data Manager a bulk action and an "empty" label.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic (SQLite), pytest + schemathesis contract test; React 18, TypeScript, zustand, Vitest, Playwright against Prism.

**Spec:** `docs/usability/2026-09-19-walkthrough.md` item E4 (owner ruling: blocking); design spec `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` sections 4, 5, 6.

## Global Constraints

- Interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, cwd inside this worktree. Never install packages, never `git clean`, never create links or junctions, never `rm -rf` outside files you created.
- Never modify anything under `E:\Dev\Yolo` outside this worktree. Test images: the existing fixtures (`make_jpeg`, `frames`, `ahmadia_sample` in `backend/tests/conftest.py`).
- The contract is already edited by the goal owner; do not edit `contract/openapi.yaml` or `contract/client/schema.d.ts`. `contract/client/index.ts` (hand-written re-exports) may be extended.
- If you start a dev backend: port 8799, `APP_DATA_DIR` set to a temp folder, stop it by PID. Never ports 8080/9090. Leave running `machinery-app` / `machinery-backend` processes alone.
- Bash heredocs collapse `\\` to `\` here: use Write/Edit for files with backslashes.
- TDD in every task; commit per task. Existing project databases must keep opening: the migration is additive with a server default.
- Green at the end: backend `python -m pytest -q`, `python -m pytest -m gpu -q` is NOT required (no GPU code changes), `python -m ruff check .`; `pnpm check` in `contract/`; frontend `pnpm lint`, `npx vitest run`, `pnpm build`, `pnpm e2e`.
- Copy: plain words. The action is called "No machinery"; the state is shown as "empty".

## Contract (already on the branch, for reference)

- `Image.marked_empty: boolean` (required). `Image.labeled` = has an accepted or edited box, or `marked_empty`.
- `PATCH /api/v1/projects/{projectId}/images/{imageId}` `updateImage`, body `ImageUpdate {marked_empty: boolean}` -> 200 `Image`. 409 `conflict` when `marked_empty: true` and the image has accepted or edited boxes. 404 unknown image.
- `POST /api/v1/projects/{projectId}/images/bulk-mark-empty` `bulkMarkEmpty`, body `BulkMarkEmpty {image_ids: string[] (minItems 1), marked_empty: boolean}` -> 200 `BulkMarkEmptyResult {updated: integer, skipped: integer}`; images with ground-truth boxes are skipped, never an error; unknown ids are ignored.
- Both publish the websocket event `images.changed` (payload `{image_ids}`) like `bulk-delete` does; marking empty also publishes `boxes.changed` for images whose proposals were rejected.

## File map

| File | Responsibility |
|---|---|
| `backend/app/db/models.py`, `backend/app/db/migrations/versions/0002_image_marked_empty.py` | column `image.marked_empty` (Boolean, not null, server default false) |
| `backend/app/datasets/empties.py` (new) | `set_marked_empty`, `bulk_mark_empty`, `clear_mark_for_ground_truth` |
| `backend/app/datasets/images.py`, `schemas.py`, `stats.py`, `materialise.py` | `labeled` semantics, filter, sort, stats, default dataset selection |
| `backend/app/datasets/boxes.py`, `backend/app/inference/service.py` | clear the mark when ground truth appears |
| `backend/app/datasets/router.py` | the two routes |
| `backend/tests/test_empties.py` (new) | all backend behaviour |
| `frontend/src/api/images.ts` (+test) | `setMarkedEmpty`, `bulkMarkEmpty` |
| `frontend/src/store/editor.ts`, `frontend/src/editor/hotkeys.ts`, `frontend/src/screens/EditorScreen.tsx`, `frontend/src/editor/RegionList.tsx` | editor action, hotkey N, state badge |
| `frontend/src/data/SelectionBar.tsx`, `frontend/src/data/columns.tsx` (or where `DATA_COLUMNS` lives), `frontend/src/data/ImageGrid.tsx` | bulk action, "empty" in the Labeled column, grid badge |
| `frontend/src/data/AddToDatasetDialog.tsx` | says how many of the selected images are negatives |
| `frontend/e2e/editor.spec.ts`, `frontend/e2e/data-manager.spec.ts` | one flow each |

---

### Task 1: Column, migration, `labeled` semantics

**Files:** models, migration, `images.py`, `schemas.py`, `stats.py`, `tests/test_empties.py`.

**Interfaces:** Produces `Image.marked_empty: bool`; `ImageOut.marked_empty`; `ImageOut.labeled == (box_count > 0 or marked_empty)`; list filter `labeled=true|false` and sort key `labeled` follow the same rule; project stats `labeled_count` / `unlabeled_count` follow it.

- [ ] **Step 1: failing tests** (`backend/tests/test_empties.py`; `BASE = "/api/v1/projects"`; fixtures `client`, `project_id`, `handle`, `import_source`/`frames` as used by `tests/test_images.py`: read that file first and reuse its helper that yields a project with imported images):

```python
def _mark(handle, image_id, value=True):
    from app.db.models import Image
    with handle.session() as s:
        s.get(Image, image_id).marked_empty = value


def test_a_marked_image_counts_as_labeled_everywhere(client, project_id, handle, image_ids):
    _mark(handle, image_ids[0])
    row = client.get(f"{BASE}/{project_id}/images/{image_ids[0]}").json()
    assert row["marked_empty"] is True and row["labeled"] is True and row["box_count"] == 0
    other = client.get(f"{BASE}/{project_id}/images/{image_ids[1]}").json()
    assert other["marked_empty"] is False and other["labeled"] is False

    labeled = client.get(f"{BASE}/{project_id}/images", params={"labeled": "true"}).json()
    assert [i["id"] for i in labeled["items"]] == [image_ids[0]]
    unlabeled = client.get(f"{BASE}/{project_id}/images", params={"labeled": "false"}).json()
    assert image_ids[0] not in [i["id"] for i in unlabeled["items"]]

    stats = client.get(f"{BASE}/{project_id}/stats").json()
    assert stats["labeled_count"] == 1
    assert stats["unlabeled_count"] == len(image_ids) - 1


def test_an_existing_database_gains_the_column_with_false(tmp_path):
    """Open a project created at revision 0001, upgrade, and read `marked_empty` = 0 for old rows."""
```

Write the second test for real: create an SQLite file, run `alembic upgrade 0001` through the same helper `app/db/session.py` uses (read it; if it only upgrades to head, call `alembic.command.upgrade(cfg, "0001")` with the same `Config`), insert a source and an image with raw SQL, upgrade to head, `SELECT marked_empty FROM image` must return `0`. `image_ids` is a fixture you add: ids of the imported images ordered by path.

- [ ] **Step 2:** run, expect failures (unknown attribute / missing key).
- [ ] **Step 3: implement.** Model: `marked_empty: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa.false())`. Migration `0002` (`down_revision = "0001"`): `op.add_column("image", sa.Column("marked_empty", sa.Boolean(), nullable=False, server_default=sa.false()))`; downgrade drops it with `batch_alter_table`. `images.py`: replace every `box_count > 0` labeled expression with `or_(box_count > 0, Image.marked_empty)` (sort expression, `_filtered`'s `has_gt`), `schemas.py` `ImageOut.from_row`: `labeled=box_count > 0 or image.marked_empty`, plus the new field. `stats.py`: count images that have ground truth or the mark.
- [ ] **Step 4:** `python -m pytest -q` (the contract test must pass: `marked_empty` is required in `Image`), ruff.
- [ ] **Step 5:** commit `feat(images): marked_empty column; labeled means boxes or marked empty (E4)`.

### Task 2: Marking service and routes

**Files:** `backend/app/datasets/empties.py`, `router.py`, tests.

**Interfaces:**
- `set_marked_empty(handle, image_id: str, value: bool) -> tuple[ImageRow, list[str]]` (the row tuple `images.py` uses for `ImageOut.from_row`, and the ids of images whose proposals were rejected). Raises `not_found("image", id)`, `AppError("conflict", "the image has N accepted boxes; delete them first or leave it labeled", 409)`.
- `bulk_mark_empty(handle, image_ids: list[str], value: bool) -> tuple[int, int, list[str]]` = updated, skipped, ids with rejected proposals.

- [ ] **Step 1: failing tests:**

```python
def test_marking_rejects_the_pending_proposals_and_unmarking_keeps_them_rejected(client, project_id, handle, image_ids, add_proposal):
    box_id = add_proposal(image_ids[0], confidence=0.4)
    r = client.patch(f"{BASE}/{project_id}/images/{image_ids[0]}", json={"marked_empty": True})
    assert r.status_code == 200, r.text
    assert r.json()["marked_empty"] is True and r.json()["pending_count"] == 0
    assert state_of(handle, box_id) == "rejected"
    r = client.patch(f"{BASE}/{project_id}/images/{image_ids[0]}", json={"marked_empty": False})
    assert r.json()["marked_empty"] is False and r.json()["labeled"] is False
    assert state_of(handle, box_id) == "rejected"


def test_an_image_with_ground_truth_cannot_be_marked_empty(client, project_id, image_ids, add_person_box):
    add_person_box(image_ids[0])
    r = client.patch(f"{BASE}/{project_id}/images/{image_ids[0]}", json={"marked_empty": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert "accepted box" in r.json()["error"]["message"]
    assert client.patch(f"{BASE}/{project_id}/images/nope", json={"marked_empty": True}).status_code == 404


def test_bulk_marks_the_empty_ones_and_skips_images_with_ground_truth(client, project_id, image_ids, add_person_box):
    add_person_box(image_ids[1])
    r = client.post(f"{BASE}/{project_id}/images/bulk-mark-empty",
                    json={"image_ids": [image_ids[0], image_ids[1], "unknown"], "marked_empty": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 1, "skipped": 1}
    r = client.post(f"{BASE}/{project_id}/images/bulk-mark-empty",
                    json={"image_ids": [image_ids[0]], "marked_empty": True})
    assert r.json() == {"updated": 0, "skipped": 0}  # already marked: nothing changed
```

`add_proposal`, `add_person_box`, `state_of` are small fixtures/helpers you write in the test module (insert `Box` rows through `handle.session()`; person box via `POST .../boxes`). Add an events test modelled on the one for `bulk-delete` (find it with `grep -rn "images.changed" backend/tests`).

- [ ] **Step 2:** watch them fail (405/404). **Step 3:** implement service and routes (`bulk-mark-empty` must be declared before `/{imageId}` routes, as `bulk-delete` is). **Step 4:** full suite + ruff. **Step 5:** commit `feat(images): mark images empty, single and bulk (E4)`.

### Task 3: Ground truth clears the mark; datasets take negatives

**Files:** `boxes.py`, `inference/service.py` (`promote`), `materialise.py`, tests.

- [ ] **Step 1: failing tests:** (a) `POST .../boxes` on a marked image -> image `marked_empty` false; (b) `boxes/review` accept of a proposal on a marked image -> false; reject leaves it true; (c) `PATCH /boxes/{id}` that edits a proposal (state becomes `edited`) -> false; (d) promoting a query run that accepts a box on a marked image -> false (reuse the fakes of `tests/test_query_runs.py`: `FakeProvider`, `run_and_wait`); (e) dataset creation WITHOUT `image_ids` includes the marked image, its label file exists and is empty, `image_count` counts it; with explicit `image_ids` behaviour is unchanged. For (e) read `tests/test_datasets.py` for the helpers that wait for the dataset job and locate the materialised folder.
- [ ] **Step 2:** fail. **Step 3:** implement `empties.clear_mark_for_ground_truth(s, image_ids: Iterable[str]) -> None` (one UPDATE) and call it inside the existing sessions of `create_box`, `update_box` (when the state becomes `edited`), `review_boxes` (accept), `inference.service.promote` (not on a dry run). `materialise._select_images` default: images with ground truth OR `marked_empty`.
- [ ] **Step 4:** full suite, ruff. **Step 5:** commit `feat(datasets): negatives enter datasets; new ground truth clears the empty mark (E4)`.

### Task 4: Frontend API, editor action

**Files:** `frontend/src/api/images.ts` (+test), `store/editor.ts`, `editor/hotkeys.ts` (+ its test), `screens/EditorScreen.tsx`, `editor/RegionList.tsx` (+test), `e2e/editor.spec.ts`.

**Interfaces:** `setMarkedEmpty(api, projectId, imageId, value): Promise<ImageRow>`; `bulkMarkEmpty(api, projectId, imageIds, value): Promise<{updated: number; skipped: number}>`; editor store gains `setImage(image)` if it has no way to replace the loaded image record (read the store first).

Behaviour:
- Toolbar (in the `reviewControls` group of `EditorScreen.tsx`): button "No machinery (N)"; when the image is marked it reads "Marked empty - undo (N)" with `aria-pressed="true"`. Disabled with `title="Delete or reject the boxes first"` when the image has accepted or edited boxes in the store.
- On success: replace the image in the store, set every unreviewed box in the store to `rejected` (the backend did the same), notice "Marked as empty: this image counts as labeled and enters datasets as a negative example."; undo notice "No longer marked empty."
- On 409: show the backend message as the editor error.
- Hotkey `N` (not while typing in an input; follow how `A`/`R` are handled in `useEditorHotkeys`), and one line in `HOTKEY_HELP`: `{ keys: "N", does: "no machinery on this image (mark empty / undo)" }`.
- Drawing a box on a marked image: after the create succeeds set `image.marked_empty = false` in the store (the backend cleared it).
- `RegionList` empty text: marked -> "Marked empty: no machinery on this image."; else the existing sentence plus " Nothing here? Press N."

- [ ] Steps: failing unit tests for the API functions (mirror `images.test.ts`), for the hotkey map, for `RegionList` texts, and a component-level test of the toggle (if `EditorScreen` cannot be rendered in jsdom because of Konva, extract the button into `frontend/src/editor/EmptyToggle.tsx` with props `{image, hasGroundTruth, busy, onToggle}` and test that); implement; e2e: open the editor route used by the existing editor specs, press N, expect the PATCH with `{marked_empty: true}` and the pressed state; commit `feat(editor): No machinery action with hotkey N (E4)`.

### Task 5: Data Manager and dataset dialog

**Files:** `SelectionBar.tsx` (+test), the column definitions (+test), `ImageGrid.tsx` (+test), `AddToDatasetDialog.tsx` (+test), `DataManagerScreen.tsx` wiring, `e2e/data-manager.spec.ts`.

Behaviour:
- Labeled column: `yes` (boxes), `empty` (marked), `no`. Grid: a slate badge "empty" where the green "N boxes" badge would be.
- Selection bar: "Mark as empty" -> `bulkMarkEmpty(..., true)`; result message "`{updated}` marked as empty" + (when `skipped > 0`) ", `{skipped}` skipped because they have accepted boxes". The list reloads (it already reloads on `images.changed`; verify, otherwise call the list's reload).
- `AddToDatasetDialog` receives the selected rows' `marked_empty` count (prop `emptyCount: number`) and says: "Freeze the accepted boxes of N images (M of them marked empty, used as negative examples) into a new dataset".

- [ ] Steps: failing tests first for each component, implement, e2e for the bulk action (expect the POST body), all suites, commit `feat(data): mark selected images empty; empty shows in the list, grid and dataset dialog (E4)`.

## Report

`E:\Dev\Yolo\app\.superpowers\sdd\usability\e4-report.md`: commits, test counts per suite, deviations with reasons, anything not done.
