# G2 Results Export — Implementation Report

Branch: `g2-results-export`, worktree `E:\Dev\Yolo\app\.worktrees\g2-results-export`.
Base (already on branch, not mine): `52e6ce9`/`920e32e` contract edits (`JobType` gains
`results_export`, `createResultsExport`, `revealInExplorer`, `RevealRequest`, `ResultsExport*`),
plus the whole `usability-wave1` wave merged at `90e325f`.

## Commits (this work), oldest first

| Commit | Subject |
|---|---|
| `23540e9` | feat(exports): export rows and CSV tables (G2) |
| `fd8d6f6` | feat(exports): YOLO and COCO label export (G2) |
| `e2cccea` | feat(exports): self-contained HTML report (G2) |
| `f715b03` | feat(exports): results_export job, routes, reveal in Explorer (G2) |
| `8d92e8a` | feat(export): Export screen, show in folder (G2, M3) |
| `8d7228d` | test(e2e): Export screen ticks YOLO and posts the chosen formats (G2) |

Range: `23540e9..8d7228d` (6 commits) on top of `90e325f`. Nothing merged, rebased or pushed.

## What was built

- **Backend** (`backend/app/exports/`):
  - `rows.py`: `ExportImage`/`ExportBox` dataclasses; `load(handle, include_unreviewed, image_ids)`
    reads every selected image (default: the whole project) with its qualifying boxes (`accepted`,
    `edited`, plus `unreviewed` on request; `rejected` never), joined to `Source.site` and the
    project's class list/order.
  - `csv_out.py`: `detections.csv` (BOM, `\r\n`, ISO timestamps, `person`/`local_model`/
    `cloud_provider` origin with `origin_name` = model name or `provider/model`),
    `counts_by_group.csv`, `counts_by_image.csv` (zero-count rows for images without qualifying
    boxes; a `marked_empty` column distinguishes a confirmed negative from "not looked at").
  - `yolo_out.py`: `labels_yolo/<stem>.txt` (normalised `cx cy w h`, 6 decimals; empty file for an
    image with no boxes) plus `classes.txt` in project class order.
  - `coco_out.py`: one `labels_coco.json`, stable 1..n category ids, `score` only when a box has a
    confidence.
  - `html_out.py`: one `report.html` — escaped project name, settings used, totals per class, a
    table per group, "N images checked, M with machinery" (checked = marked-empty OR has boxes),
    then a card per image with boxes (base64 JPEG thumbnail, boxes drawn in class colours with
    labels, per-class counts), capped at 300 cards with a note pointing to `detections.csv` for the
    rest. No external requests; the thumbnail source is injectable (`thumbnail_fn`) so the 300+-card
    test needs no real image files.
  - `job.py`: `@register_job_type("results_export")`; writes into
    `exports/<YYYY-MM-DD_HHMMSS>/` (`_2`, `_3`, ... on a same-second collision), checks
    cancellation between formats and every 50 HTML cards.
  - `reveal.py`: `reveal(handle, path)` resolves both sides and refuses anything that does not sit
    inside the project folder (`..`, absolute, UNC, drive-relative like `C:foo`) with 422; 404 when
    missing; starts Explorer via `launch()` → `subprocess.Popen([...], shell=False)` — never a
    shell, never a string command line.
  - `router.py`, `schemas.py`: `POST /projects/{projectId}/exports` (`createResultsExport`, 202
    `JobRef`) and `POST /projects/{projectId}/reveal` (`revealInExplorer`, 204/404/422). Duplicate
    or empty `formats` fail pydantic validation → 422 automatically.
  - `app/projects/service.py` gained `ProjectHandle.exports_dir`. `app/api.py` mounts the new
    router. `tests/conftest.py`'s `app` fixture now patches `app.exports.reveal.subprocess.Popen`
    to a no-op for every test (so schemathesis's generated `reveal` bodies in `test_contract.py`
    can never start real Explorer); `tests/test_reveal.py` re-patches the same seam per test to
    assert the exact `Popen` arguments.
- **Frontend**:
  - `api/exports.ts` (+test): `createResultsExport`, `revealInExplorer`, and a hand-typed
    `ResultsExportResult` (the job's `result` shape, described on the operation rather than a named
    schema, per the contract).
  - `jobs/jobLabels.ts` (+test): `results_export` → "Results export"; `resultTarget` returns `null`
    for it (it already lives on the Export screen); new `resultsExportSummary` ("N images, M
    boxes"), `resultsExportFiles`, `resultsExportFolder` helpers.
  - `exports/ExportForm.tsx` (+test): the "Results" section — CSV/YOLO/COCO/HTML checkboxes (CSV
    and HTML checked by default) each with an explaining sentence, "Include proposals nobody has
    reviewed yet (marked as such in the files)", the "Exports the accepted boxes of all N images (M
    boxes)." line from project stats, "Choose at least one format." validation, and the `Export`
    button that posts the job.
  - `exports/useResultsExportJobs.ts`, `exports/ExportJobs.tsx` (+test): "Past exports" — fetches
    `results_export` jobs, renders newest first from the shared jobs store (so a job started
    elsewhere in the same session shows up reactively); a running job renders as a `JobCard`, a
    finished one shows state, local time, the image/box summary, the file list and "Show in
    folder" (calls `revealInExplorer` with the job's `result.folder`).
  - `exports/ModelExportSection.tsx` (+test): "Model for other applications" — two sentences
    explaining ONNX vs `.pt`, a model picker (trained models first), "Export ONNX" (existing
    `exportModel` job/API), and the resulting or already-existing `exports.onnx` path with "Show in
    folder".
  - `exports/RevealButton.tsx` (+test): shared "Show in folder" button/alert, used by
    `ExportJobs`/`ModelExportSection` inline logic's sibling call sites and wired into
    `models/ModelDetail.tsx` (next to the weights path) and `models/ExportButtons.tsx` (next to
    each export) for M3.
  - `screens/ExportScreen.tsx` (+test), `routes.tsx` (`/p/:projectId/export`), `app/Shell.tsx`
    (+test): nav entry "Export" between Query and Settings.
  - `e2e/export.spec.ts`: opens the Export screen, ticks YOLO, clicks Export, asserts the POST body
    `{formats: ["csv","yolo","html"], include_unreviewed: false}`.

## Test counts

- Backend `python -m pytest -q` (cwd `backend/`): **534 passed, 9 deselected** (gpu/live marks,
  unaffected). New files: `test_exports_csv.py` (7), `test_exports_labels.py` (7),
  `test_exports_html.py` (8), `test_exports_job.py` (5), `test_reveal.py` (7) — **34 new tests**.
  `test_contract.py` (which was red at the start — the two new routes were unrouted) is fully
  green: **61 passed**.
- Backend `python -m ruff check .`: **All checks passed.**
- `contract/` `pnpm check` (spectral lint + regenerate + diff against `client/schema.d.ts`):
  **clean** — no contract files were edited by this work.
- Frontend `pnpm lint` (eslint + prettier): **clean**.
- Frontend `npx tsc --noEmit -p .`: **clean** (the pre-existing red — `jobLabels.ts` missing a
  `results_export` label — is fixed).
- Frontend `npx vitest run`: **403 passed** across **105 files**. New/updated: `api/exports.test.ts`
  (2), `jobs/jobLabels.test.ts` (+1, 4 total), `app/Shell.test.tsx` (5, updated order assertion),
  `exports/ExportForm.test.tsx` (3), `exports/ExportJobs.test.tsx` (4),
  `exports/ModelExportSection.test.tsx` (3), `exports/RevealButton.test.tsx` (2),
  `screens/ExportScreen.test.tsx` (2), `models/ModelDetail.test.tsx` (+1, 7 total).
- Frontend `pnpm build`: **succeeds** (pre-existing >500 kB chunk-size warning, unrelated).
- Frontend `E2E_WEB_PORT=1530 E2E_MOCK_PORT=4130 pnpm e2e`: **51 passed** (checked 1530/4130 were
  free before the run and that nothing was left `LISTENING` on either port afterwards — only
  expected `TIME_WAIT` remnants).

## Real export through a dev backend

Dev backend: port 8799, `APP_DATA_DIR` a fresh temp folder, started with
`APP_TOKEN=dev-token-g2 APP_PORT=8799 APP_DATA_DIR=<temp> python -m app`, stopped by its PID
(`taskkill /PID <pid> /F`) once done; confirmed the port was free afterwards. Project folder was a
separate temp folder (not `APP_DATA_DIR`); the 5 source frames were copied from
`E:\Dev\Yolo\data\raw\ahmadia` into a third temp folder first and imported from there (the original
folder was never touched or imported from directly).

Steps: created project `G2Verify` (2 classes: excavator, dump_truck) → imported 5 copied frames
(`IX-12-02491_0031_0001..0005.jpg`, all succeeded) → added 3 person-drawn, accepted boxes (2 on
image 1: excavator + dump_truck; 1 on image 2: excavator) → `POST /exports`
`{"formats":["csv","yolo","coco","html"],"include_unreviewed":false}` → job succeeded in ~0.2 s.

Job result: `{"folder":"exports/2026-09-19_142843","image_count":5,"box_count":3, "files": [...]}`.

Folder listing (`exports/2026-09-19_142843/`):

| File | Size |
|---|---|
| `detections.csv` | 710 B |
| `counts_by_group.csv` | 58 B |
| `counts_by_image.csv` | 664 B |
| `labels_coco.json` | 1522 B |
| `report.html` | 112,642 B |
| `labels_yolo/classes.txt` | 23 B |
| `labels_yolo/IX-12-02491_0031_0001.txt` | 78 B |
| `labels_yolo/IX-12-02491_0031_0002.txt` | 39 B |
| `labels_yolo/IX-12-02491_0031_0003.txt` | 0 B |
| `labels_yolo/IX-12-02491_0031_0004.txt` | 0 B |
| `labels_yolo/IX-12-02491_0031_0005.txt` | 0 B |

First 5 lines of `detections.csv` (BOM stripped for display):

```
image,source,group,capture_time,image_lat,image_lon,class,x,y,w,h,confidence,origin,origin_name,review_state,box_id
images/ahmadia/IX-12-02491_0031_0001.jpg,ahmadia,0031,2019-04-15T06:35:36Z,29.4946854625,47.7651314625,excavator,100.0,200.0,300.0,250.0,,person,,accepted,5bc4e8dd-83e0-4590-974c-f1e034b053f5
images/ahmadia/IX-12-02491_0031_0001.jpg,ahmadia,0031,2019-04-15T06:35:36Z,29.4946854625,47.7651314625,dump_truck,1000.0,800.0,400.0,300.0,,person,,accepted,cfe07f4f-931d-4a0a-9deb-95f8b08e6e03
images/ahmadia/IX-12-02491_0031_0002.jpg,ahmadia,0031,2019-04-15T06:35:39Z,29.494764195555558,47.76485509388889,excavator,500.0,500.0,200.0,200.0,,person,,accepted,1e0383a0-3dd1-4550-93a2-61e7f4b76af2
```

First 40 lines of `report.html`:

```
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>G2Verify — results export</title><style>body{font-family:sans-serif;background:#111;color:#eee;padding:16px}table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #555;padding:4px 8px;text-align:left}.cards{display:flex;flex-wrap:wrap;gap:12px}.card{border:1px solid #555;padding:8px;max-width:680px}.card img{max-width:640px;display:block}</style></head><body>
<h1>G2Verify</h1>
<p>Exported 2026-09-19T14:28+00:00</p>
<p>Formats: csv, yolo, coco, html. Included unreviewed proposals: no.</p>
<p>2 images checked, 2 with machinery.</p>
<h2>Totals</h2>
<table><thead><tr><th>Class</th><th>Count</th></tr></thead><tbody><tr><td>excavator</td><td>2</td></tr><tr><td>dump_truck</td><td>1</td></tr></tbody></table>
<h2>By group</h2>
<table><thead><tr><th>Group</th><th>Images</th><th>excavator</th><th>dump_truck</th><th>Total</th></tr></thead><tbody><tr><td>0031</td><td>5</td><td>2</td><td>1</td><td>3</td></tr></tbody></table>
<h2>Images</h2>
<div class="cards"><div class="card"><p class='path'>images/ahmadia/IX-12-02491_0031_0001.jpg</p><p class='counts'>excavator 1, dump_truck 1</p><img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wB...
</body></html>
```

(`report.html` is a single long line per `<div class="cards">` block, base64 thumbnail truncated
above for readability; the file itself is well-formed UTF-8 — verified the em dash in the title is
correctly encoded as `\xe2\x80\x94` in the raw bytes, a terminal-codepage artifact when it was
`print()`ed through this shell, not a file defect.)

`reveal` was not invoked against the real dev backend during this manual verification (it would
have opened a real Explorer window on this machine); it is covered by 7 backend unit tests
(`test_reveal.py`) plus the contract conformance test, all with `subprocess.Popen` patched.

## Deviations from the plan, with reasons

1. **`reveal`'s outside-the-project status code is 422, not 409.** The general hard rule in this
   task ("schema-valid bodies must never get 422") is superseded here by the contract itself:
   `revealInExplorer`'s summary explicitly documents "422 when it leaves the folder, 404 when it
   does not exist" (`contract/openapi.yaml` line 985), and the contract may not be edited. Since a
   `RevealRequest.path` can be any non-empty string, schemathesis's positive-data generation will
   routinely produce a value that resolves outside the project, and 422 for that case is the
   contracted, intended behaviour — the `default` response schema still validates it. Implemented
   exactly as specified in the contract.
2. **`counts_by_image.csv`'s `marked_empty` column placement**: the task brief said only "add a
   column `marked_empty` (true/false)" without specifying where. Placed it right after
   `image_lon` and before the per-class columns (`image,group,capture_time,image_lat,image_lon,
   marked_empty,<classes...>,total`) since that reads naturally as "identity, then status, then
   counts."
3. **`origin_name` format for a cloud-provider box**: not fully spelled out beyond "provider/model
   name" in the file map's prose. Implemented as `f"{provider}/{model_name}"` when both are
   present, falling back to whichever one is set, and `""` for a person-drawn box (`confidence`
   is also empty for those, per spec).
4. **HTML "N images checked, M with machinery"**: defined "checked" as marked-empty OR has
   qualifying boxes (i.e. images that have actually been looked at/labeled), not literally every
   image in the export — this matches the coordinator's framing ("the negatives the analyst
   confirmed" + "images with machinery") in the task brief; a totally unreviewed image lowers
   neither count.
5. **`resultTarget` for a `results_export` job returns `null`** (no "Open X" link): the job's
   output already lives on the screen that started it (Export), unlike `train`/`infer`/`dataset`
   which point elsewhere. `ExportJobs` renders its own "Show in folder" affordance instead.
6. **`ModelExportSection`'s ONNX export reuses the existing `export` job type** (not a new one);
   the plan explicitly calls for reusing "the existing ONNX export, made reachable from the new
   Export screen" — no backend change was needed there.

## Nothing else outstanding

All 5 plan tasks are complete and committed; each task's tests were written first, run and
observed failing for the expected reason (missing module/route/label), then made to pass. The
starting red state described in the brief — `test_contract.py`'s two unrouted operations and the
frontend `tsc` gap in `jobLabels.ts` — is fixed. No weights, databases, exports or API keys were
committed. No file outside the worktree was modified other than this report. `contract/openapi.yaml`
and `contract/client/schema.d.ts` were not touched.

## Fix round 1 (goal-owner review of `90e325f..8d7228d`)

Range `8d7228d..0da403e` (11 commits) on top of `1eafa8c` (the goal owner's contract change: reveal
answers 409, not 422). Every behavioural fix was test-first: the test was written or changed, run
and watched fail for the right reason (a stashed-and-restored old implementation, shown inline in
the session for anything not obvious), then the fix landed and the test re-run green.

| Finding | Commit(s) | Evidence |
|---|---|---|
| Important #1 (reveal 409, not 422) | `7684f18` | `test_reveal.py`: every outside-project case now asserts 409 `conflict`; `reveal.py`'s `_outside_project` raises `AppError("conflict", ..., 409)`. |
| Important #7 (Explorer command string) | `7684f18` | `EXPLORER = Path(os.environ.get("SystemRoot", ...)) / "explorer.exe"`; `launch(command: str)` calls `subprocess.Popen(command)` (shell=False by default). `test_the_command_quotes_a_path_with_a_comma_and_a_space` asserts the exact string. |
| Minor #3 (device name -> 404) | `7684f18` | `reveal()`: `if not (target.is_file() or target.is_dir()): raise not_found(...)`; `test_a_reserved_device_name_is_404_not_a_crash`. |
| Minor #4 (conftest patches `launch`, not global `Popen`) | `7684f18` | `tests/conftest.py`'s `app` fixture: `monkeypatch.setattr("app.exports.reveal.launch", ...)`; `test_reveal.py`'s `calls` fixture restores the real `launch` and patches `subprocess.Popen` locally. |
| Important #2 (YOLO mirrors the image tree per site) | `60fc1cb` | `yolo_out._label_path`: `images/<site>/<file>.jpg` -> `labels_yolo/<site>/<file>.txt`; reuses `app.datasets.materialise._label_text`. `test_yolo_mirrors_the_site_so_same_named_images_never_collide`: two sources' `DJI_0001.jpg` get two label files with their own boxes. |
| Important #3 (job result names the YOLO folder, not each file) | `60fc1cb`, `3dba585` | `yolo_out.write` returns `["labels_yolo", "labels_yolo/classes.txt"]`. `ExportJobs.tsx`: `MAX_FILES_SHOWN = 8`, "and N more"; `test_truncates_a_long_file_list_to_8_names_plus_and_N_more`. |
| Important #4 (Past exports scoped to the project) | `3dba585` | `useResultsExportJobs`'s `selectResultsExportJobs` filters `j.project_id === projectId`; `ExportScreen.test.tsx`: "never shows another project's results_export job under Past exports". |
| Minor #6 (Loading… / load error) | `3dba585` | `ExportJobs.tsx` takes `loading`/`error` props; `ExportJobs.test.tsx`: "shows Loading… while the list is loading", "shows the load error instead of the empty state". |
| Minor #7 (shared `RevealButton`) | `3dba585` | `ExportJobs.tsx` and `ModelExportSection.tsx` both render `<RevealButton projectId path />` instead of their own busy/error state; `RevealButton.tsx` already existed for M3. |
| Minor #12 (`ModelExportSection` reveal test actually reveals) | `3dba585` | Test renamed and completed: drives the tracked job to `succeeded` with `result.path`, then clicks "Show in folder" and asserts the POST body. |
| Important #5 (partial export folder) | `12c2929` | `job.py`: writes into `exports/.partial-<stamp>`, `os.replace` to the final name only on success; `except Exception: shutil.rmtree(partial, ignore_errors=True); raise`. `test_a_cancelled_export_leaves_no_partial_and_no_final_folder`, `test_a_failed_export_leaves_no_partial_folder`. |
| Minor #2 (mkdir loop, not check-then-create) | `12c2929` | `_reserve_partial_folder`: `partial.mkdir(parents=True)` inside a `try/except FileExistsError: n += 1; continue` loop — the reservation itself is the atomic step. |
| Minor #11 (plain-word progress messages) | `12c2929` | `FORMAT_LABEL` dict; `ctx.progress(..., f"{FORMAT_LABEL[fmt]} written ({done + 1} of {total})")`; html cards: `f"report: {card_done}/{card_total} images"`. Seen live in the real export below (`"message":"Tables written (1 of 4)"`). |
| Important #6 (unreviewed markers everywhere) | `b69d5b1` (CSV), `db1cf0e` (COCO), `144b89a` (HTML), `a9f3b4e` (form label) | `counts_by_group.csv`/`counts_by_image.csv` gain an `unreviewed` column (`test_counts_by_group_unreviewed_column_counts_them_while_classes_keep_counting_everything`). Every COCO annotation carries `"review_state"` (`test_coco_carries_review_state_on_every_annotation`). HTML draws a dashed outline + `"?"` suffix for an unreviewed box and a legend line only when one is present (`test_legend_line_appears_only_when_unreviewed_boxes_are_present`, `test_unreviewed_dashed_box_differs_from_an_accepted_solid_box`); deviation 4 implemented as `_is_checked` (`test_an_image_with_only_unreviewed_boxes_is_not_checked`). Checkbox label now names which formats can/can't mark a proposal (`ExportForm.test.tsx`: "labels the checkbox with what each format can and cannot mark"). |
| Minor #1 (CSV formula injection) | `b69d5b1` | `csv_out._text`: prefixes `'` for a value starting with `=+-@`, tab or CR, text columns only. `test_text_helper_prefixes_a_formula_looking_value_leaves_others_alone`, `test_formula_injection_is_neutralised_in_text_columns_only` (class `=1+1`, site `-evil`, group `-flight`). |
| Important #8 (HTML local export time + offset) | `144b89a` | `html_out._format_export_time`: `%Y-%m-%d %H:%M` + `UTC±HH:MM`. `test_export_time_is_local_with_the_offset`. Confirmed live below: `"Exported 2026-09-19 18:25 UTC+03:00"`. |
| Important #9 (thumbnail `draft()`, robustness, report progress) | `144b89a` | `draw_thumbnail` calls `src.draft("RGB", (max_side, max_side))` before `convert`, scales boxes from the stored `width`/`height` to whatever `draft` actually decoded, and catches `Exception` around the read (`test_an_unreadable_image_gives_none_instead_of_raising`, `test_draft_downscale_still_aligns_boxes`). Progress message format covered under Minor #11 above. |
| Minor #5 (export summary line) | `a9f3b4e` | `ExportForm.tsx`: "Exports {box_count} accepted boxes on {labeled_count} of {image_count} images" (+ " and {pending_review_count} unreviewed proposals" once ticked); `ExportForm.test.tsx` asserts both forms. |
| Minor #8 (dead code) | `e8c47c1` | `rows.py`: dropped the unreachable `class_names.get(b.class_id, b.class_id)` fallback (the surrounding filter already guarantees the key), replaced with `class_names[b.class_id]`. `class_counts` moved out of `csv_out.py`/`html_out.py`'s identical private copies into `rows.py`, imported by both. The stray `# noqa: FURB118` no longer exists (it was already gone by the time of this pass, from the html_out.py rewrite in `144b89a`). |
| Minor #9 (join instead of a huge `IN(...)`) | `e8c47c1` | `rows.load`'s box query is now `select(Box).join(Image, Image.id == Box.image_id).where(...)`, filtered by `Image.id.in_(image_ids)` only when `image_ids` is given; with no explicit selection (the whole-project case) there is no `IN(<every id>)` at all. |
| Minor #13 (backend test coverage) | `87cff32` | `test_full_export_succeeds_with_every_format` now asserts `"data:image/jpeg;base64," in report`. `test_cancellation_inside_the_html_cards_leaves_the_job_cancelled` (`CARD_PROGRESS_EVERY` forced to 1, a slowed `draw_thumbnail`, cancel lands mid-cards). `test_a_class_name_with_a_comma_and_a_quote_round_trips_through_csv_quoting`. `test_class_name_is_escaped_in_the_totals_and_group_tables`, `test_group_is_escaped_in_the_group_table`, `test_image_path_is_escaped_on_its_card`. |
| Minor #10 (singular/plural "N more images") | — | Already correct from the initial implementation (`f"{left_out} more image{'s' if left_out != 1 else ''} with machinery ..."`, covered by the existing `test_more_than_300_images_with_boxes_are_capped`); no change needed. |
| Found by the contract suite, not in the list (reveal 500 on an invalid path) | `0da403e` | `Path.resolve()` raises `ValueError` on a path with an embedded null byte, which schemathesis's random `reveal` bodies hit; `resolve_inside_project` now catches `(ValueError, OSError)` around `resolve()` and answers 409 instead of letting it surface as a 500. `test_a_path_with_an_embedded_null_byte_is_refused_not_a_500`; re-ran `test_contract.py` three times back to back (schemathesis reseeds each run) to build confidence, all green. |

### Verification after fix round 1

```
backend/  python -m pytest -q            -> 556 passed, 9 deselected   (exit 0)
backend/  python -m ruff check .         -> All checks passed          (exit 0)
contract/ pnpm check                     -> clean, no diff             (exit 0)
frontend/ pnpm lint                      -> clean                      (exit 0)
frontend/ npx tsc --noEmit -p .          -> clean                      (exit 0)
frontend/ npx vitest run                 -> 409 passed / 105 files     (exit 0)
frontend/ pnpm build                     -> succeeds (pre-existing >500kB chunk warning) (exit 0)
frontend/ E2E_WEB_PORT=1530 E2E_MOCK_PORT=4130 pnpm e2e -> 51 passed    (exit 0)
```

One flaky, unrelated failure was observed on the first full backend run:
`tests/test_trainer_launch.py::test_train_reports_progress_and_returns_artifacts` (a timing-sensitive
subprocess progress-ordering test in `app/training/`, a file this work never touches — confirmed with
`git diff 90e325f..HEAD -- backend/tests/test_trainer_launch.py backend/app/training/trainer.py`,
empty). Passed in isolation immediately after, and passed again in the next full run (556 passed).
1530/4130 were confirmed free before the e2e run and had nothing left `LISTENING` on either port
afterwards (only expected `TIME_WAIT` remnants).

### Real export through a dev backend (fix round 1 scenario: two same-named files, one unreviewed proposal, `include_unreviewed: true`)

Dev backend: port 8799, `APP_DATA_DIR` a fresh temp folder
(`.../scratchpad/g2verify2/appdata`), started with `APP_TOKEN=dev-token-g2b APP_PORT=8799
APP_DATA_DIR=<temp> python -m app`, stopped by its PID (`taskkill /PID 57324 /F`) once done;
confirmed port 8799 was free afterwards. Project folder was a separate temp folder. Two source
frames were copied from `E:\Dev\Yolo\data\raw\ahmadia` into two temp site folders, **both renamed to
`shared.jpg`** (never imported from the original folder).

Steps: created project `G2Verify2` (2 classes) → imported `siteA/shared.jpg` as source `sitea` and
`siteB/shared.jpg` as source `siteb` (both succeeded; the backend slugifies site names to
lowercase) → added one person-drawn, accepted `excavator` box on `sitea`'s image via the API → one
`dump_truck`, `unreviewed`, `cloud_provider`/`anthropic`/`claude-x` proposal (confidence 0.42) was
inserted directly into `project.db` for `siteb`'s image (there is no HTTP path to create an
unreviewed box without a query run against a real provider/model, which is out of scope for a
manual smoke check) → `POST /exports {"formats":["csv","yolo","coco","html"],
"include_unreviewed":true}` → job succeeded in ~0.08 s.

Job result: `{"folder":"exports/2026-09-19_152518","image_count":2,"box_count":2}`. Job `message`
at completion: `"Tables written (1 of 4)"` — the plain-word progress text works (Minor #11), though
because the job finished in under a second the DB-persisted `message` field is stuck at the first
format's write (the runner throttles progress DB writes to one per 250 ms and only sets `progress`,
not `message`, in its own terminal-state write); this is pre-existing `JobContext`/`JobRunner`
behaviour outside this sub-project's files, not a G2 regression.

Folder listing (`exports/2026-09-19_152518/`):

| File | Size |
|---|---|
| `detections.csv` | 534 B |
| `counts_by_group.csv` | 83 B |
| `counts_by_image.csv` | 319 B |
| `labels_coco.json` | 952 B |
| `report.html` | 110,014 B |
| `labels_yolo/classes.txt` | 23 B |
| `labels_yolo/sitea/shared.txt` | 39 B |
| `labels_yolo/siteb/shared.txt` | 39 B |

Both `shared.jpg` images produced their own label file under separate site subfolders — no
collision (Important #2).

`detections.csv` (BOM stripped):

```
image,source,group,capture_time,image_lat,image_lon,class,x,y,w,h,confidence,origin,origin_name,review_state,box_id
images/sitea/shared.jpg,sitea,tile_18512_13041,2019-04-15T06:35:36Z,29.4946854625,47.7651314625,excavator,100.0,150.0,300.0,250.0,,person,,accepted,7fb23da1-6f80-49fb-b4aa-e73e9756d9af
images/siteb/shared.jpg,siteb,tile_18512_13041,2019-04-15T06:35:39Z,29.494764195555558,47.76485509388889,dump_truck,500.0,400.0,350.0,300.0,0.42,cloud_provider,anthropic/claude-x,unreviewed,b7b90d0f-c4ca-4515-870d-151e7b0195cc
```

`counts_by_group.csv`:

```
group,images,excavator,dump_truck,unreviewed,total
tile_18512_13041,2,1,1,1,2
```

`counts_by_image.csv`:

```
image,group,capture_time,image_lat,image_lon,marked_empty,excavator,dump_truck,unreviewed,total
images/sitea/shared.jpg,tile_18512_13041,2019-04-15T06:35:36Z,29.4946854625,47.7651314625,false,1,0,0,1
images/siteb/shared.jpg,tile_18512_13041,2019-04-15T06:35:39Z,29.494764195555558,47.76485509388889,false,0,1,1,1
```

`labels_yolo/sitea/shared.txt`: `0 0.062500 0.103112 0.075000 0.093738`
`labels_yolo/siteb/shared.txt`: `1 0.168750 0.206224 0.087500 0.112486`

`labels_coco.json` annotations:

```json
{"id": 1, "image_id": 1, "category_id": 1, "bbox": [100.0, 150.0, 300.0, 250.0], "area": 75000.0, "iscrowd": 0, "review_state": "accepted"}
{"id": 2, "image_id": 2, "category_id": 2, "bbox": [500.0, 400.0, 350.0, 300.0], "area": 105000.0, "iscrowd": 0, "review_state": "unreviewed", "score": 0.42}
```

`report.html` head:

```
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>G2Verify2 — results export</title><style>...</style></head><body>
<h1>G2Verify2</h1>
<p>Exported 2026-09-19 18:25 UTC+03:00</p>
<p>Formats: csv, yolo, coco, html. Included unreviewed proposals: yes.</p>
<p>1 images checked, 2 with machinery.</p>
<p>A dashed box with "?" after the class name is an unreviewed proposal.</p>
<h2>Totals</h2>
<table><thead><tr><th>Class</th><th>Count</th></tr></thead><tbody><tr><td>excavator</td><td>1</td></tr><tr><td>dump_truck</td><td>1</td></tr></tbody></table>
<h2>By group</h2>
<table><thead><tr><th>Group</th><th>Images</th><th>excavator</th><th>dump_truck</th><th>Total</th></tr></thead><tbody><tr><td>tile_18512_13041</td><td>2</td><td>1</td><td>1</td><td>2</td></tr></tbody></table>
<h2>Images</h2>
```

Confirms: local time + offset (Important #8), unreviewed legend line (Important #6), "1 images
checked, 2 with machinery" — `siteb`'s image has only an unreviewed box so it does not count as
checked (deviation 4), while both images count "with machinery" since both have boxes.

### Anything not done

Nothing from the fix-round list was skipped. Minor #10 needed no change (already correct). The one
finding not on the list — the embedded-null-byte 500 on `reveal` — was found by re-running the
contract suite as instructed and fixed the same way as every other item (test-first, one commit).

## Fix round 2 (goal-owner review of `8d7228d..0da403e`)

Range `0da403e..05f04a2` (6 commits). Every behavioural fix was test-first: the test was written or
changed, run and watched fail for the right reason (a stashed-and-restored old implementation), then
the fix landed and the test re-run green.

| Finding | Commit(s) | Evidence |
|---|---|---|
| N1 (regression: two same-second exports collide) | `7ded79a` | `_reserve_partial_folder` now skips a candidate name when either its final folder *or* its partial folder exists (previously only the partial name was checked, so a second export could be handed a final name the first export had already been promoted to). `_promote()` retries `os.replace` up to 5 x 100 ms on `PermissionError`, and — since Windows raises the same `PermissionError` for "the destination already exists" as for "something has it briefly open" — checks `final.exists()` to tell a real collision (bump the suffix, fresh retry budget) from a transient lock (retry the same rename). Tests: `test_two_exports_in_the_same_frozen_second_get_stamp_and_stamp_2` (`_now_local` frozen, two sequential exports -> `<stamp>` and `<stamp>_2`, no `.partial-*` left), `test_a_rename_hit_by_permission_error_twice_then_succeeding_still_succeeds`, `test_a_rename_that_always_fails_leaves_no_partial_folder_and_the_job_failed`. |
| M1 (export folder stamp in local time) | `7ded79a` | `_now_local()` (`datetime.now().astimezone()`) is called once per job and threaded into both `_reserve_partial_folder` and the HTML report's `export_time`, so both name the same instant; the N1 tests exercise the same seam a DST repeated hour would hit (a collision on the computed name), so no separate DST test was needed. |
| N2 (sweep `.partial-*` left by a crash) | `1b73967` | `app.exports.job.sweep_partial_exports`, wired into `project_opened` (`app/main.py`) as its own try. Only removes an entry directly named `.partial-*` that is not a symlink and resolves to a direct child of the project's own `exports` folder; skips entirely while a `results_export` job for that project is queued or running. Tests: `test_project_opened_sweeps_a_leftover_partial_export_folder` (through `project_opened`/`ProjectRegistry`, the same pattern `test_dataset_delete.py` uses), `test_sweep_skips_while_a_results_export_job_is_active`, `test_sweep_only_removes_partial_directories_never_a_stray_file`, `test_sweep_does_nothing_with_no_exports_dir`. (No literal symlink was created in a test — the hard rule against creating symlinks/junctions applies to this session's own file operations; the "not a link" behaviour is covered by code review and the "must resolve to a direct child" check, exercised indirectly by the stray-file test.) |
| N3 (HTML summary: four disjoint counts) | `537e885` | `_bucket()` classifies every image as `confirmed` / `empty` / `proposals_only` / `untouched`; `_summary_html()` prints "Of {n} image(s), {checked} was/were checked by a person: {confirmed} with machinery, {empty} confirmed empty." plus, only when > 0, the proposals-only and untouched lines. Tests: `test_summary_counts_confirmed_empty_and_untouched`, `test_summary_sentence_pluralises_correctly_for_one_and_many` (both the n=1 case and a 6-image mix), `test_an_image_with_only_unreviewed_boxes_is_not_checked`. |
| N4 (HTML "of which unreviewed" column; card counts) | `537e885` | `_totals_table`/`_group_table` take a `has_unreviewed` flag and add the column only then; a card's summary reads `"dump_truck 1 (1 unreviewed)"`. Tests: `test_totals_table_gets_an_unreviewed_column_when_unreviewed_boxes_are_included`, `test_totals_table_has_no_unreviewed_column_without_any`, `test_group_table_gets_an_unreviewed_column`, `test_card_counts_show_unreviewed_alongside_the_class_count`. |
| M2 (formula guard: `-flight`/`-0031` round-trip) | `01d4ebf` | `_text()`'s leading-`-` check now fires only when the next character is *not* a letter or digit; docstring corrected (opening a plain CSV in Excel shows the `'` literally — it is not the hidden "treat as text" marker typed input gets). Tests: `test_text_helper_prefixes_a_formula_looking_value_leaves_others_alone` (`-flight`, `-0031`, `-1` round-trip; `-=x` still guarded), `test_formula_injection_is_neutralised_in_text_columns_only` (site `-evil`, group `-flight` unescaped end to end; class `=1+1` still guarded). |
| M3 (ExportForm summary line) | `05f04a2` | "Exports all {imageCount} image(s): {boxCount} accepted box(es) on the {labeledCount} checked image(s)" + " and {n} unreviewed proposal(s)" when ticked, via a local `plural()` helper. Tests: default (many), ticked (many), and a dedicated singular test (`labeledCount=boxCount=imageCount=pendingReviewCount=1`) for both the ticked and unticked sentence. |
| M4 (YOLO stem collision) | `da380ac` | `yolo_out._check_no_stem_collisions` runs before anything is written; two images in one site whose label paths collide (`x.jpg`/`x.jpeg`) raise a `ValueError` naming both. Test: `test_yolo_refuses_two_images_with_the_same_stem_in_one_site` (asserts both paths are named and that `labels_yolo/` was never created). |
| m10 (pluralisation everywhere) | `537e885`, `05f04a2` | HTML: the four-bucket summary, the "of which unreviewed" additions and the existing 300+-card overflow message all pluralise via `_plural()`. Frontend: `ExportForm`'s new summary line pluralises via a local `plural()` helper; `jobLabels.ts`'s `resultsExportSummary` and the HTML legend/overflow lines were already correct (checked, not changed). |

### Verification after fix round 2

```
backend/  python -m pytest -q            -> 569 passed, 9 deselected   (exit 0)
backend/  python -m ruff check .         -> All checks passed          (exit 0)
contract/ pnpm check                     -> clean, no diff             (exit 0)
frontend/ pnpm lint                      -> clean                      (exit 0)
frontend/ npx tsc --noEmit -p .          -> clean                      (exit 0)
frontend/ npx vitest run                 -> 410 passed / 105 files     (exit 0)
frontend/ pnpm build                     -> succeeds (pre-existing >500kB chunk warning) (exit 0)
frontend/ E2E_WEB_PORT=1530 E2E_MOCK_PORT=4130 pnpm e2e -> 51 passed    (exit 0)
```

One flaky, unrelated e2e failure was observed on the first e2e run:
`e2e/data-manager.spec.ts` "double-click opens a list row even though the first click selects it"
(a bounding-box `y` position mismatch, almost certainly parallel-worker resource contention — this
run used 12 workers). Confirmed unrelated: `git diff 90e325f..HEAD -- frontend/e2e/data-manager.spec.ts`
is empty, and the test passed both in isolation and in the very next full run (51/51). 1530/4130 were
confirmed free before the run and had nothing left `LISTENING` on either port afterwards.

### Real export through a dev backend (fix round 2 scenario: two same-named files, one unreviewed proposal, two exports fired back to back)

Dev backend: port 8799, `APP_DATA_DIR` a fresh temp folder (`.../scratchpad/g2verify3/appdata`),
started with `APP_TOKEN=dev-token-g2c APP_PORT=8799 APP_DATA_DIR=<temp> python -m app`, stopped by
its PID (`taskkill /PID 3764 /F`) once done; confirmed port 8799 was free afterwards. Two source
frames were copied from `E:\Dev\Yolo\data\raw\ahmadia` into two temp site folders, both renamed to
`shared.jpg` (never imported from the original folder).

Steps: created project `G2Verify3` (2 classes) → imported `siteA/shared.jpg` as source `sitea` and
`siteB/shared.jpg` as source `siteb` → added one person-drawn, accepted `excavator` box on `sitea`'s
image via the API → one `dump_truck`, `unreviewed`, `cloud_provider`/`anthropic`/`claude-x` proposal
(confidence 0.42) inserted directly into `project.db` for `siteb`'s image (same reason as fix round
1: no HTTP path creates an unreviewed box without a real provider/model query run) → **two**
`POST /exports {"formats":["csv","yolo","coco","html"],"include_unreviewed":true}` requests fired
back to back, neither awaited before the other was sent.

Both jobs succeeded:

```
job 1 result: {"folder":"exports/2026-09-19_185744",   "image_count":2,"box_count":2}
job 2 result: {"folder":"exports/2026-09-19_185744_2", "image_count":2,"box_count":2}
```

`exports/` afterwards contains exactly two folders, `2026-09-19_185744` and `2026-09-19_185744_2` —
**no leftover `.partial-*` folder and no collision** (the N1 regression this round fixed).

Folder listing (`exports/2026-09-19_185744/`, identical in `..._2`):

| File | Size |
|---|---|
| `detections.csv` | 534 B |
| `counts_by_group.csv` | 83 B |
| `counts_by_image.csv` | 319 B |
| `labels_coco.json` | 952 B |
| `report.html` | 110,222 B |
| `labels_yolo/classes.txt` | 23 B |
| `labels_yolo/sitea/shared.txt` | 39 B |
| `labels_yolo/siteb/shared.txt` | 39 B |

`detections.csv` (BOM stripped):

```
image,source,group,capture_time,image_lat,image_lon,class,x,y,w,h,confidence,origin,origin_name,review_state,box_id
images/sitea/shared.jpg,sitea,tile_18512_13041,2019-04-15T06:35:36Z,29.4946854625,47.7651314625,excavator,100.0,150.0,300.0,250.0,,person,,accepted,18c8b379-6183-4280-9922-f5f00d39afdc
images/siteb/shared.jpg,siteb,tile_18512_13041,2019-04-15T06:35:39Z,29.494764195555558,47.76485509388889,dump_truck,500.0,400.0,350.0,300.0,0.42,cloud_provider,anthropic/claude-x,unreviewed,4a4a323f-1654-4064-9fe6-3c8a2d51ab99
```

`counts_by_group.csv`:

```
group,images,excavator,dump_truck,unreviewed,total
tile_18512_13041,2,1,1,1,2
```

`report.html` — the new summary sentences, tables and card counts, exactly as specified:

```
<p>Exported 2026-09-19 18:57 UTC+03:00</p>
<p>Formats: csv, yolo, coco, html. Included unreviewed proposals: yes.</p>
<p>Of 2 images, 1 was checked by a person: 1 with machinery, 0 confirmed empty.</p><p>1 image has only unreviewed proposals (dashed boxes below).</p>
<p>A dashed box with "?" after the class name is an unreviewed proposal.</p>
<h2>Totals</h2>
<table><thead><tr><th>Class</th><th>Count</th><th>of which unreviewed</th></tr></thead><tbody><tr><td>excavator</td><td>1</td><td>0</td></tr><tr><td>dump_truck</td><td>1</td><td>1</td></tr></tbody></table>
<h2>By group</h2>
<table><thead><tr><th>Group</th><th>Images</th><th>excavator</th><th>dump_truck</th><th>of which unreviewed</th><th>Total</th></tr></thead><tbody><tr><td>tile_18512_13041</td><td>2</td><td>1</td><td>1</td><td>1</td><td>2</td></tr></tbody></table>
```

Card counts (`class='counts'` paragraphs):

```
excavator 1
dump_truck 1 (1 unreviewed)
```

Confirms: N1's fix (two folders, no collision, no leftover partial), N3's four-bucket summary
("1 was checked... 0 confirmed empty" / "1 image has only unreviewed proposals"), N4's "of which
unreviewed" columns on both tables, and the card-level "(1 unreviewed)" suffix.

### Anything not done

Nothing from the fix-round list was skipped.

## Fix round 3 (goal-owner review of `0da403e..05f04a2`)

Range `05f04a2..ceb599c` (6 commits). Every behavioural fix was test-first: the test was written or
changed, run and watched fail for the right reason (a stashed-and-restored old implementation), then
the fix landed and the test re-run green.

| Finding | Commit(s) | Evidence |
|---|---|---|
| I1 (sweep follows a junction, can delete a finished export) + m1 (never touch a young folder) | `1bc1c0b` | `_own_partial_folder` now requires the entry's name to match `^\.partial-\d{4}-\d{2}-\d{2}_\d{6}(_\d+)?$` *and* `resolve()` to land back on a same-named direct child of `exports_dir` — `is_symlink()` is False for a Windows junction, but a redirecting junction's resolved name differs from its own, which this catches; `rmtree` is always called on the entry itself, never the resolved path. A module-level `_PROCESS_STARTED_AT` (recorded when `app.exports.job` loads) additionally skips any partial folder younger than that. Tests: `test_sweep_does_not_follow_a_junction_and_delete_the_real_export` (a real junction via `_winapi.CreateJunction`, removed with `link.rmdir()` in a `finally`, `_PROCESS_STARTED_AT` patched to 0 to isolate this from the m1 guard), `test_sweep_leaves_a_users_own_dotfile_folder_alone`, `test_sweep_leaves_a_freshly_created_partial_folder_alone` (mtime set to "now"). The three pre-existing sweep tests from round 2 were updated to backdate their partial folders' mtime (`_age()`), since a freshly-created folder in a test is otherwise always "younger than the process" under the new m1 guard. |
| I2 (formula guard: whole-value match) | `d0bdc39` | `_text()` now leaves a leading `-` alone only when the *whole* value matches `^-\d+(\.\d+)?$` or `^-[A-Za-z0-9_]+$`; `-SUM(1,2)`, `-A1+1` and `-2+3+cmd\|' /C calc'!A0` are guarded, `-flight`/`-0031`/`-1.5` still round-trip. Test: `test_text_helper_prefixes_a_formula_looking_value_leaves_others_alone` (extended with the exact cases above, written with the Edit tool for the literal backslash/quote content). |
| m3 (plain YOLO error, no class prefix) | `dd4bc6f` | `yolo_out.check_no_stem_collisions` (renamed) raises `"x.jpeg and x.jpg in siteA would get the same YOLO label file. Export without YOLO labels, or delete one of the two images from the project."` `app/jobs/runner.py`'s `_run` now stores a `ValueError`'s message as-is (no `f"{type(e).__name__}: {e}"` prefix), treating `ValueError` as a job's own way of raising an already-complete, human-facing message; any other exception type is unchanged. Tests: `test_a_value_error_is_stored_without_the_class_name_prefix`, `test_a_runtime_error_still_keeps_its_class_name` (in `test_jobs.py`, general runner behaviour), `test_yolo_stem_collision_fails_before_anything_is_written` (the exact stored `job["error"]` text end to end). |
| m4 (check collisions before reserving a folder) | `dd4bc6f` | `run_export` calls `yolo_out.check_no_stem_collisions(images)` before `handle.exports_dir.mkdir(...)`/`_reserve_partial_folder` when `"yolo"` is among the requested formats. Test: `test_yolo_stem_collision_fails_before_anything_is_written` asserts `not handle.exports_dir.exists()` after the failure — not even the `exports/` folder itself was created. |
| m5 (unit test for the promote-collision branch) | `e2aff7a` | `test_promote_bumps_the_suffix_when_the_final_name_already_exists` calls `_reserve_partial_folder`/`_promote` directly (no job/API involved): reserve, create the final folder out from under it, confirm `_promote` lands on `<stamp>_2` with no partial folder left. No production change — this path was previously only exercised indirectly through the full two-exports-in-one-second job test. |
| m6 (By-group "of which unreviewed" after Total) | `923e9e1` | Column order swapped to `Group, Images, <classes...>, Total, of which unreviewed`, matching the Totals table's own count-then-breakdown order. Test: `test_group_table_gets_an_unreviewed_column_after_total` (checks both the `<th>` header order and a data row). |
| m7 (ExportForm: "Exports 1 image", no "all") | `ceb599c` | The summary line drops "all" when `imageCount === 1`: "Exports 1 image: ..." vs "Exports all 2 images: ...". Tests: the existing singular test updated, plus a new `"says 'Exports all' (not '1') once imageCount is more than 1 (m7)"`. |

### Verification after fix round 3

```
backend/  python -m pytest -q            -> 577 passed, 9 deselected   (exit 0)
backend/  python -m ruff check .         -> All checks passed          (exit 0)
contract/ pnpm check                     -> clean, no diff             (exit 0)
frontend/ pnpm lint                      -> clean                      (exit 0)
frontend/ npx tsc --noEmit -p .          -> clean                      (exit 0)
frontend/ npx vitest run                 -> 411 passed / 105 files     (exit 0)
frontend/ pnpm build                     -> succeeds (pre-existing >500kB chunk warning) (exit 0)
frontend/ E2E_WEB_PORT=1530 E2E_MOCK_PORT=4130 pnpm e2e -> 51 passed    (exit 0)
```

1530/4130 were confirmed free before the e2e run and had nothing left `LISTENING` on either port
afterwards. No flaky failures this round; every gate was green on the first run.

### Anything not done

Nothing from the fix-round list was skipped. No real dev-backend export re-run was requested this
round (none of the findings changed the on-disk output shape in a way the round 1/2 real-export
scenarios hadn't already covered — I1/m1 are crash-recovery/sweep-only code paths not reachable
through a normal export, and the formula-guard/YOLO-message/table-order changes are exercised
exactly by the updated unit tests above).
