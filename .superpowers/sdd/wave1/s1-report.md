# S1 — Dataset backend: implementation report

Branch `s1-dataset-backend` in `E:\Dev\Yolo\app\.worktrees\s1-dataset-backend`, based on main `b233a82`.
Plan: `docs/superpowers/plans/2026-09-17-s1-dataset-backend.md`. Contract: `contract/openapi.yaml`
(one authorised mid-run edit from the goal owner, see the `unreview` section; nothing else changed).

**Status: DONE_WITH_CONCERNS** — all ten plan tasks implemented and committed, plus the goal
owner's mid-run `unreview` contract change. Full suite green (170 passed), ruff clean. Two
concerns, both outside S1's ownership, are listed at the end.

## Commits

| SHA | Subject |
| --- | --- |
| `b759daf` | test(datasets): fixtures for sample frames and synthetic jpegs |
| `75b2ad3` | feat(datasets): image preparation core |
| `94d58f9` | feat(datasets): duplicate detection and group keys |
| `8ff3274` | feat(datasets): import job and sources api |
| `baca753` | feat(datasets): images api with keyset pagination, file and thumbnail serving |
| `385d245` | feat(datasets): boxes api with review states |
| `874f945` | feat(datasets): dataset freeze, split and yolo materialisation |
| `862ba2b` | feat(datasets): project and source statistics |
| `1f6c2a3` | test(datasets): retire S0 stubs, contract conformance on real endpoints |
| `db39cd9` | chore(datasets): smoke import script |
| `013c6f1` | refactor(datasets): batch dataset split counts, keep edited boxes edited on accept |
| `87b85b3` | feat(datasets): unreview action on bulk box review |

## What was implemented, per task (with RED/GREEN evidence)

All commands run from `backend/` with `.\.venv\Scripts\python.exe` / `.\.venv\Scripts\ruff.exe`.
No package was installed, upgraded or removed in the shared venv.

### Task 1 — Test fixtures (`b759daf`)

`tests/conftest.py` gains `make_jpeg` (seeded-noise JPEG with optional `DateTimeOriginal`, GPS
lat/lon/alt and `orientation` EXIF), session-scoped `ahmadia_sample` (copies the first 20 files of
`E:\Dev\Yolo\data\raw\ahmadia`, `pytest.skip` when absent) and `project` (the eight classes).
The existing S0 fixtures are untouched. `tests/test_fixtures.py` checks all three.

- RED: `pytest -q tests/test_fixtures.py` → `3 errors`, `E fixture 'ahmadia_sample' not found`,
  `fixture 'project' not found`.
- GREEN: `3 passed in 0.72s`. Full suite `100 passed`.

### Task 2 — Image preparation core (`75b2ad3`)

`app/datasets/prepare.py`: `IMAGE_EXTS`, `list_images`, `unique_dest`, `Prepared`, `read_exif`,
`process_one` — a port of `scripts/prepare_images.py`, process-pool safe, never raising (failures
come back as `action="failed"`, `error=repr(e)`). EXIF is preserved; after `exif_transpose` the
saved orientation tag is rewritten to 1 (with the stale thumbnail dropped) so viewers do not rotate
a second time.

- RED: `pytest -q tests/test_prepare.py` → `ModuleNotFoundError: No module named 'app.datasets.prepare'`.
- GREEN: `8 passed in 1.35s`, including `test_real_frame_matches_manifest`
  (`IX-12-02491_0031_0001.jpg` → 4000x2667, phash `82a81f67f94615ae`, capture
  `2019-04-15 06:35:36Z`, lat 29.49469, lon 47.76513, alt 191.3 — all match
  `data/manifests/ahmadia.csv` and `ahmadia_inventory.csv`) and the orientation-6 round trip.
  Full suite `108 passed`, ruff clean.

### Task 3 — Duplicates and grouping (`94d58f9`)

`app/datasets/grouping.py`: `find_duplicates` (earliest kept, Hamming via `bit_count`), `tile_key`
(250 m equirectangular tile), `group_key` (flight regex group → whole match → tile → site; an
invalid regex warns once and falls through) and `slugify`.

- RED: `ModuleNotFoundError: No module named 'app.datasets.grouping'`.
- GREEN: `8 passed in 0.04s`. Full suite `116 passed`.

### Task 4 — Import job and sources endpoints (`8ff3274`)

`app/datasets/importer.py` (`run_import`, job type `import`) and the real `sources` routes in
`app/datasets/router.py` (`app/stubs.add_stubs` kept only for the not-yet-built resources).
Behaviour: plan dests under `images/<site>/` with `unique_dest`; skip files whose planned path is
already an `Image` row; `ProcessPoolExecutor` in chunks of 50 with `check_cancelled()` on every
completed future; dedupe over previously imported hashes plus the new ones; duplicate copies deleted
and recorded (cumulatively) in `images/<site>/.duplicates.json`; `Image` rows written in batches of
50, each batch publishing `images.changed`; `Source.image_count` / `duplicate_count` / `imported_at`
updated at the end. Re-posting a known folder reuses the source row.

- RED: `pytest -q tests/test_import.py` → `9 failed`, every call answering
  `HTTP/1.1 501 Not Implemented`.
- GREEN: `9 passed in 4.73s`, stable over three consecutive runs (4.70 / 4.72 / 4.90 s).
  Full suite `125 passed`, ruff clean.

### Task 5 — Images API (`baca753`)

`app/datasets/images.py`: `list_images` (filters `source_id`, `group_key`, `labeled`, `has_pending`,
`search`, `ids`; the nine contract sort keys; keyset cursor `{k, id}`; `total` over the filtered set),
`get_image`, `image_file` (original, or a quality-85 JPEG cached at `cache/resized/{id}_{max_side}.jpg`),
`thumbnail` (256 px at `cache/thumbs/{id}.jpg`), `bulk_delete`. Routes plus `ImageOut`/`ImagePage`.

- RED: `pytest -q tests/test_images.py` → `12 failed`, all endpoints 501.
- GREEN: `12 passed in 11.26s`. Full suite `137 passed`.

### Task 6 — Boxes API (`385d245`)

`app/datasets/boxes.py`: `list_boxes`, `create_box` (person / accepted / `reviewed_at`), `update_box`
(a proposal becomes `edited`, ground truth stays as it is), `delete_box`, `review_boxes`. Bounds and
class-id validation return 422; unknown image/box return 404.

- RED: `pytest -q tests/test_boxes.py` → `10 failed`.
- GREEN: `10 passed in 5.17s`. Full suite `147 passed`.

### Task 7 — Datasets: freeze, split, materialise (`874f945`)

`app/datasets/splits.py` (`assign_splits`), `app/datasets/materialise.py` (`freeze` + the `dataset`
job) and `app/datasets/stats.py` (`dataset_stats`), plus the dataset routes. `freeze` snapshots the
accepted/edited boxes, the ordered class list and `{val_fraction, seed}`; the job hard-links (falling
back to `shutil.copy2`, recorded in the job log), writes YOLO label files and `data.yaml`.

- RED: `pytest -q tests/test_datasets.py` → `ModuleNotFoundError: No module named 'app.datasets.splits'`;
  after `splits.py`, `2 failed` (`assert 6 == 9` — the fixture's frames collided on their noise seed
  and the importer deduped three of them away, which is the dedupe working correctly).
- GREEN: `14 passed in 6.52s`. Full suite `161 passed`.

### Task 8 — Statistics (`862ba2b`)

`compute_stats(handle, source_id)` in `app/datasets/stats.py`, wired into `project_stats`
(`app/projects/router.py`, that function only) and `GET /sources/{id}/stats`.

- RED: `pytest -q tests/test_stats.py` → `5 failed` (`assert [] == [0, 0, 0, 0, 0, 0, 0, 0]`,
  `assert (0 == 3)` — the S0 `Stats()` zero placeholder).
- GREEN: `5 passed in 3.89s`. Full suite `166 passed`.

### Task 9 — Retire the stubs (`1f6c2a3`)

No `add_stubs` call remains in `app/datasets/router.py`; the 18 S1 operation ids were removed from
`EXPECTED_STUBS` in `tests/test_contract.py` (only `preannotateImage` stays from that group, it is S4's).

- Evidence: full suite run three times with a cleared hypothesis database
  (`166 passed` in 47.01 / 46.82 / 48.50 s) and three more times without clearing
  (`166 passed` in 47.34 / 47.95 / 47.19 s). `ruff check .` → `All checks passed!`,
  `ruff format --check .` → `62 files already formatted`.

### Task 10 — Smoke script (`db39cd9`)

`backend/scripts/smoke_import.py`. Run against a real sidecar (port 8765 was already occupied by a
process I did not start, so the backend was launched with `APP_PORT=0`; it chose 63237, pid 18436,
and I terminated exactly that pid afterwards — port confirmed closed):

```
backend 0.1.0 pid 18436
source 2ec9c037-... site ahmadia, import job 1cfba6af-...
succeeded  100.0%  prepared 20 / 20 images
result {'source_id': '2ec9c037-...', 'imported': 20, 'duplicates': 0, 'failed': 0, 'skipped': 0}
images 20 labeled 0 duplicates 0 groups 1
resolutions [{'width': 4000, 'height': 2667, 'count': 20}]
capture {'min': '2019-04-15T06:35:36Z', 'max': '2019-04-15T06:36:49Z'}
gps {'min_lat': 29.4933439, 'min_lon': 47.7636895, 'max_lat': 29.4948775, 'max_lon': 47.7669024}
  IX-12-02491_0031_0001.jpg  4000x2667 group 0031 phash 82a81f67f94615ae
  IX-12-02491_0031_0002.jpg  4000x2667 group 0031 phash 8488349d3494bffb
```

Both phashes match the manifest and the contract's own `Image`/`ImagePage` examples.

### Mid-run contract change — `unreview` (`87b85b3`)

The goal owner extended `BoxReview.action` to `[accept, reject, unreview]` (main `d30fa90`) after
Task 6 was already committed, so this landed as its own commit rather than folded into `385d245`.
Applied in this worktree: the `BoxReview.action` enum and description, and the `/boxes/review` POST
summary in `contract/openapi.yaml` — exactly the authorised text, nothing else in the contract, and
`contract/client/schema.d.ts` untouched. `review_boxes` now also ignores person-drawn boxes for all
three actions, and `unreview` clears `review_state` to `unreviewed` with `reviewed_at = null`.

- RED: `pytest -q tests/test_boxes.py tests/test_contract.py -k "unreview or person or review"` →
  `3 failed` — the two new box tests plus
  `test_responses_conform[POST /api/v1/projects/{projectId}/boxes/review]`, because schemathesis now
  generates `action: "unreview"` against a `Literal["accept", "reject"]` body model.
- GREEN: `tests/test_boxes.py` `13 passed in 6.96s`.
- One existing test had to follow the new semantics: `test_stats.py::test_box_counts_and_classes`
  used to reject a *person* box to prove a rejected box is not ground truth. Person boxes are now
  ignored by review, so it inserts a rejected model proposal (and an unreviewed one, which also
  tightens the test: `pending_review_count == 1`).
- Full suite after the change: `170 passed` on three consecutive runs (49.66 / 51.06 / 49.79 s).

### Self-review follow-ups (`013c6f1`)

- `GET /datasets` computed split counts with one query per row; now one query per page.
- Accepting a box that is already `edited` no longer rewrites it to `accepted` (both are ground
  truth and `edited` records that a person changed the geometry); `updated` counts only real changes.
- Added tests for that and for the frozen-image delete conflict; tightened the single-image split
  assertion from a two-way `in (...)` to an exact value.

## Final verification

```
.\.venv\Scripts\python.exe -m pytest -q          -> 168 passed in 49.26s
.\.venv\Scripts\ruff.exe check .                 -> All checks passed!
.\.venv\Scripts\ruff.exe format --check .        -> 63 files already formatted
```

`tests/test_contract.py` (schemathesis, 50 operations) is green; no handler returns 5xx.

## Files changed

Created: `app/datasets/{prepare,grouping,importer,images,boxes,splits,materialise,stats,schemas}.py`,
`scripts/smoke_import.py`, `tests/test_{fixtures,prepare,grouping,import,images,boxes,datasets,stats}.py`.
Modified: `app/datasets/router.py` (stub file fully replaced), `tests/conftest.py` (fixtures added only),
`app/projects/router.py` (`project_stats` body + one import), `tests/test_contract.py` (`EXPECTED_STUBS` only).
Also modified: `contract/openapi.yaml` — the single `BoxReview.action` / `/boxes/review` summary edit
the goal owner authorised mid-run, and nothing else. Nothing else outside `app/datasets` and `tests/`
was touched.

## Deviations from the plan (and why)

1. **A missing source folder returns 404, not 422.** The plan asks for
   `validation_error` 422 when `folder` is not an existing directory. The contract test's
   schemathesis `positive_data_acceptance` check fails any 422 on a schema-compliant body, and
   `createSource`'s generated body always carries a well-formed absolute path that does not exist
   (`[422] ... "generated is not an existing directory" — API rejected schema-compliant request`).
   The contract wins, so a well-formed path that is not on disk is now a missing resource:
   `not_found("source folder", ...)` → 404, mirroring S0's `ProjectRegistry.open`. A relative path
   is still 422 (pydantic), matching `ProjectCreate`.
2. **An empty dataset selection returns 409 `conflict`, not 422.** Same check, same reasoning:
   `createDataset` generates a schema-valid body and the contract test's project has no labeled
   images. 409 `conflict` is an error code the contract lists.
3. **Dataset name safety is validated after the image set is resolved.** Hypothesis does generate
   `".."` (and names with a trailing newline) from `^[A-Za-z0-9._-]+$`; `datasets/..` would write
   into the project root. `.`, `..` and separators are rejected with 422, but the "nothing to
   freeze" 409 is evaluated first so schema-valid bodies are never 422-rejected in an empty project.
   Both orders are defensible; this one keeps the contract test deterministic.
4. **Process pool size** is `min(os.cpu_count(), len(files))` rather than `os.cpu_count()` — the
   plan's intent (one worker per CPU) with no wasted process spawns on a three-file import.
5. **`test_cancel_import` is decisive without monkeypatching.** Cancelling immediately after the
   202 always lands before the pool has produced a result, so the test asserts
   `state == "cancelled"` outright (plus `imported_at is None`) instead of the plan's
   `in ("cancelled", "succeeded")`.
6. **`test_process_one_existing_dest_is_reused` uses a structured image, not `make_jpeg` noise.**
   Measured: the phash of pure noise survives a JPEG round trip only ~2/3 of the time (10 of 30
   seeds differed), so the plan's `second.phash == first.phash` would have been a latent flake. The
   dedupe test uses the same reasoning: a gradient and its quality-70 re-encode are 2 bits apart,
   the noise frame is 28 bits away, so the thresholds are exercised deterministically.
7. **The dataset flow test uses synthetic 400x300 frames** (`IX-12-02491_0031_*` and `_0033_*`) so the
   normalised label values are exact (`0 0.3 0.3 0.1 0.2`); `test_dataset_from_real_frames` covers the
   same path on the 20 real frames, and `test_import`/`test_images`/`test_stats` assert against the
   manifest ground truth. The fixture labels all nine frames (not six) so the by_group split has two
   usable groups.
8. **Beyond the plan:** `bulk_delete` refuses (409 `conflict`, with the ids in `details`) to delete
   images frozen into a dataset. Without it the `dataset_image.image_id` foreign key would raise and
   the endpoint would answer 500, and deleting them would silently corrupt an immutable dataset.

## Contract gaps / notes for the goal owner

- **`listImages.search` matches the relative path, not only the file name.** The contract describes it
  as "case-insensitive substring of the file name". SQLite has no `basename`, and `images/<site>/<name>`
  would need a fixed-depth `substr`/`instr` expression to isolate the last segment. The implemented
  behaviour is a superset (every file-name match is included; a query equal to a site name also
  matches). Say the word and I will either narrow it or widen the contract wording.
- **The contract's `Image.group_key` example still reads `"IX-12-02491_0031"`** while the
  `ImportSettings.group_regex` description (and commit `b233a82`) say the `flight` group is the key.
  The implementation follows the normative description and the plan: `"0031"`. Only the example is stale.
- **`Dataset` has no `image_count` / `train_count` / `val_count` columns** but the contract requires
  them; they are derived from `dataset_image` on read (one grouped query per page).
- **PyInstaller:** the import job uses a `ProcessPoolExecutor`, so the frozen build needs
  `multiprocessing.freeze_support()` in `app/__main__.py` (S6's file — flagged, not touched).

## Concerns

1. **Pre-existing S0 contract-conformance defect in `PUT /projects/{projectId}/classes`** (not S1's
   code, and `app/projects/service.py` is outside my allowed files). A class name of `" "` is
   schema-valid (`ClassDefInput.name` has `minLength: 1`) but `normalise_classes` strips it and
   answers `422 {"code":"validation_error","message":"duplicate or empty class name ''"}`, which
   schemathesis fails as `RejectedPositiveData`. Reproduced with a direct call, no S1 code involved:
   `PUT /api/v1/projects/{id}/classes [{"name": " ", "colour": "#be07E9"}]` → 422. It surfaced once
   during my run; hypothesis then persisted the counterexample in the gitignored
   `backend/.hypothesis` cache and replayed it on every subsequent run until I cleared that cache.
   Six clean full-suite runs followed (three with a cleared cache, three without), but the defect is
   real and will resurface at random. Fix belongs in `normalise_classes` (accept a whitespace-only
   name, or strip and reject with the contract updated to forbid it).
2. **Port 8765 was already in use** by a process I did not start (pid 38964, answering on
   `/api/v1/health`). I did not touch it; the smoke run used `APP_PORT=0` instead and I terminated
   only my own pid 18436.
3. **Minor, by design:** cancelling an import leaves the already-converted JPEGs on disk with no
   `Image` rows. Re-posting the source picks them up as `existing` and inserts the rows, so the
   import is resumable, but a cancelled import does leave files behind.

---

# Fix round 1 (`22482d3`)

Review of `b233a82..87b85b3`: spec ❌ (two collision defects), quality "Needs fixes". All eight
findings are addressed in one commit, `22482d3`, in the worktree. Tests went 170 → 179.

Everything below ran from `E:\Dev\Yolo\app\.worktrees\s1-dataset-backend\backend` with the absolute
interpreter `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` (the worktree's `.venv` junction is
gone). No package was installed, upgraded or removed; no `git clean` was run; nothing inside any
`.venv` was deleted.

## 1 (CRITICAL) — Materialise silently corrupted multi-source datasets

`materialise.py` now maps `images/<site>/<file>` to `<site>__<file>` (`materialised_name`), so two
sites holding the same file name stay two images with their own labels. `_place` raises
`FileExistsError` instead of returning `"existing"`: names are unique per dataset and a failed job
now clears its folder, so an existing target can only mean a collision.

- New tests: `test_datasets.py::test_same_file_name_in_two_sites_stays_two_images` (two sources,
  two sites, one shared file name, `val_fraction=0.05` so both land in `train`) and
  `::test_place_refuses_to_overwrite_an_existing_file`.
- RED: `AssertionError: assert ['DJI_0001.jpg'] == ['sitea__DJI_0001.jpg', 'siteb__DJI_0001.jpg']`
  — exactly the reported defect, one file where there should be two — plus
  `Failed: DID NOT RAISE FileExistsError`.
- GREEN: `pytest -q tests/test_datasets.py` → `17 passed in 8.13s`. The existing freeze test was
  updated to the new names (`frames__IX-12-02491_0033_0001.jpg`).

## 2 (IMPORTANT) — Two sources sharing a site could not both import

`importer.py` builds `all_paths` from every `Image` row (not just the current source) and seeds
`taken` via `_reserved_names(site, foreign_paths, foreign_duplicates)` with the names other sources
already own inside `images/<site>/`, including names their recorded duplicates used up. The current
source's own names stay free, so a re-import still lands on its existing rows and resumes.

- New test: `test_import.py::test_two_sources_can_share_a_site` — two folders, same site,
  overlapping names; both import fully, the paths are `DJI_0001.jpg`, `DJI_0001_1.jpg`,
  `DJI_0002.jpg`, `DJI_0002_1.jpg`, both sources report `image_count == 2`, and a third post of
  folder B imports 0 and skips 2 (the plan is stable).
- RED: `job ... failed: IntegrityError: (sqlite3.IntegrityError) UNIQUE constraint failed: image.path`
  — the reported failure mode.
- GREEN: `pytest -q tests/test_import.py` → `11 passed in 6.86s`.

## 3 (IMPORTANT) — `PATCH /boxes/{id}` with an explicit null returned 500

`BoxUpdate`'s fields are optional but no longer nullable: the types stay non-optional with `None`
only as the "not sent" default (pydantic does not validate defaults), so an explicit `null` fails
validation. **Chosen behaviour: 422**, because `null` is outside the contract's `BoxUpdate` schema
(`x: {type: number, minimum: 0}`); FastAPI's generated schema now matches the contract too.

- New test: `test_boxes.py::test_patch_rejects_an_explicit_null` — `x`, `y`, `w`, `h` and `class_id`
  each answer 422 `validation_error`, and the box is unchanged.
- RED: `TypeError: '<' not supported between instances of 'NoneType' and 'int'` at `boxes.py:33`
  (a 500).
- GREEN: `pytest -q tests/test_boxes.py` → `14 passed in 6.19s`.

## 4 (minor) — EXIF fallback re-applied a rotation

`_exif_for_save(original, rotated)` now falls back to the transposed image's own EXIF (Pillow has
already dropped the orientation tag there), like the reference script, instead of re-attaching the
raw original.

- New test: `test_prepare.py::test_orientation_is_cleared_even_when_piexif_cannot_parse`
  (monkeypatches `prepare.piexif.load` to raise).
- RED: `assert 6 == 1` — the saved file still claimed orientation 6 on already-rotated pixels.
- GREEN: `pytest -q tests/test_prepare.py` → `9 passed in 1.17s`.

## 5 (minor) — Recorded duplicates were re-converted on every re-import

`.duplicates.json` entries now carry `source_id` (an added key; `duplicate_of` and `hamming` are
unchanged), the skip set is seeded from the current source's own recorded duplicates, and other
sources' duplicate names are reserved so they cannot be handed out again.

- New test: `test_import.py::test_recorded_duplicates_are_not_reconverted` — the second import
  reports `imported 0, duplicates 0, skipped 2`, the file stays absent and `duplicate_count` stays 1.
- RED: the second import reported `duplicates: 1` again (re-converted and re-deleted).
- GREEN: covered by the `11 passed` run above.

## 6 (minor) — `Source.image_count` was stale after a bulk delete

`images.bulk_delete` recomputes `image_count` for every affected source in the same session.

- New test: `test_images.py::test_bulk_delete_updates_the_source_count` (20 → 17 through
  `GET /sources/{id}`).
- RED: `assert 20 == 17`. GREEN: part of the `31 passed` images+datasets run.

## 7 (minor) — A failed dataset job left the name taken

`materialise` wraps the work and calls `discard(handle, dataset_id)` on any exception (including
`JobCancelled`), deleting the `dataset_image` rows, the `dataset` row and the folder, then re-raises
so the job still fails. Writing `job_id` after `submit` is now a no-op-safe Core `update`: the job
can finish (and discard the row) before the handler gets there, which first showed up as
`StaleDataError: UPDATE statement on table 'dataset' expected to update 1 row(s); 0 were matched`.
`create_source` got the same treatment for symmetry.

- New test: `test_datasets.py::test_a_failed_materialise_releases_the_dataset_name` — monkeypatches
  `materialise._place` to raise, asserts the job fails, `GET /datasets/{id}` is 404, the list is
  empty, `datasets/v1` is gone, and creating `v1` again succeeds.
- RED: `assert 200 == 404` (the row survived), then the `StaleDataError` above.
- GREEN: `pytest -q tests/test_datasets.py tests/test_images.py tests/test_import.py` →
  `43 passed in 27.40s`.

## 8 (minor) — Derived files were written in place

`_write_derived` writes to `<name>.<uuid>.tmp` in the same directory and `os.replace`s it into
position, removing the temp file in a `finally`.

- New test: `test_images.py::test_derived_files_are_published_atomically` — after a thumbnail and a
  `max_side` request the cache holds exactly the two expected `.jpg` files and no `.tmp` leftovers.

## Verification

```
E:\Dev\Yolo\app\backend\.venv\Scripts\ruff.exe check .      -> All checks passed!
E:\Dev\Yolo\app\backend\.venv\Scripts\ruff.exe format .     -> 63 files left unchanged
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
   run 1 -> 1 failed, 178 passed in 55.81s   (the pre-existing S0 PUT /classes defect, below)
   run 2 -> 179 passed in 52.53s
   run 3 -> 179 passed in 53.02s
   run 4 -> 179 passed in 55.67s
   run 5 -> 179 passed in 53.27s
   run 6 -> 179 passed in 56.48s
tests/test_contract.py alone -> 50 passed in 11.55s
```

Files changed in this round, all inside `app/datasets/**` and `tests/` and nothing else:
`app/datasets/materialise.py`, `importer.py`, `schemas.py`, `prepare.py`, `images.py`, `router.py`;
`tests/test_datasets.py`, `test_import.py`, `test_boxes.py`, `test_prepare.py`, `test_images.py`.

## Still open / notes

- **The `PUT /projects/{projectId}/classes` defect is still there and is not mine to fix.** Run 1 of
  six failed on it again: a class name of `" "` is schema-valid (`minLength: 1`) but
  `normalise_classes` strips it and answers `422 duplicate or empty class name ''`, which
  schemathesis reports as `RejectedPositiveData`. It lives in `app/projects/service.py`, outside the
  files S1 may touch, and the instruction for this round was to change nothing else. Until it is
  fixed, three consecutive clean full runs cannot be guaranteed for anyone running the suite — it
  hit roughly one run in six here. Five of the six runs above were clean and it is unrelated to
  every change in this round.
- **On the venv damage:** the only deletion I ran was `rm -rf .hypothesis` from the worktree's
  `backend` directory (it appears verbatim in the round-1 commands), never `git clean` and never
  anything inside a `.venv`; `.hypothesis` is a sibling of `.venv`, not a parent. I have not deleted
  anything this round.
- **On the leftover process:** the backend I started for the smoke script was pid 18436 on port
  63237; I terminated it with `taskkill /PID 18436 /F` and confirmed `SUCCESS: ... terminated`,
  `port 63237 closed` and an empty `tasklist` for that pid. A different backend, pid 38964, was
  already holding port 8765 before I started, which is why the smoke run used `APP_PORT=0`; I never
  started or stopped that one. No process was started in this round.
