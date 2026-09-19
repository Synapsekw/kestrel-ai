# G2 Results Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewed detections leave the app: an Export screen writes CSV tables, YOLO and COCO labels and a self-contained HTML report into the project folder, opens the folder in Explorer, and offers the trained model as an ONNX file for other applications.

**Architecture:** A new job type `results_export` writes `exports/<YYYY-MM-DD_HHMMSS>/` inside the project folder from the Box/Image tables (pure functions per format, one orchestrating job). A small `reveal` endpoint opens Explorer on a path inside the project (Windows-only product; no new Tauri plugin). The Export screen is a form plus the list of past export jobs. The owner asked for: detections + counts CSV, YOLO / COCO labels, HTML report, an option to include unreviewed proposals, and "a model file I can use in a different application" (= the existing ONNX export, made reachable from this screen).

**Tech Stack:** FastAPI, SQLAlchemy, Pillow (already a dependency; draws the report thumbnails), pytest; React 18, TypeScript, Vitest, Playwright against Prism.

**Spec:** `docs/usability/2026-09-19-walkthrough.md` items G2 and M3 with the owner ruling; design spec sections 1 ("a trained detector and a report"), 4, 7.

## Global Constraints

- Interpreter `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, cwd in this worktree; no installs (Pillow, csv, json, html are all available), no `git clean`, no links/junctions, no `rm -rf` outside files you created; nothing outside the worktree modified; no contract edits (`contract/client/index.ts` re-exports may be extended).
- Dev backend only on port 8799 with `APP_DATA_DIR` in a temp folder, stopped by PID. Never ports 8080/9090.
- Exports never touch `images/`, `labels/`, `datasets/`, `models/`: they only write under `exports/`.
- `reveal` must refuse any path that does not resolve inside the project folder (no `..`, no absolute paths, no UNC) and must never pass the path through a shell: `subprocess.Popen(["explorer.exe", f"/select,{path}"])` with a list, `shell=False`. In tests `subprocess.Popen` is replaced; the real Explorer is never started by a test.
- CSV: UTF-8 with BOM (Excel), comma separator, `\r\n`, header row, ISO timestamps; numbers with `.` decimal.
- HTML report: one file, no external requests (inline CSS, thumbnails as base64 JPEG, no scripts from the network), every text value escaped with `html.escape`.
- Write/Edit tools for files with backslashes. TDD, commit per task.
- Green at the end: backend `pytest -q`, `ruff check .`; `pnpm check` in `contract/`; frontend `pnpm lint`, `npx vitest run`, `pnpm build`, `pnpm e2e`.

## Contract (on the branch)

- `JobType` gains `results_export`.
- `POST /api/v1/projects/{projectId}/exports` `createResultsExport`, body `ResultsExportRequest { formats: ("csv" | "yolo" | "coco" | "html")[] (minItems 1, unique), include_unreviewed: boolean = false, image_ids?: string[] }` -> 202 `JobRef`. The job's `result` is `ResultsExportResult { folder: string (project-relative, forward slashes), files: string[], image_count: integer, box_count: integer }`.
- `POST /api/v1/projects/{projectId}/reveal` `revealInExplorer`, body `{ path: string (project-relative, minLength 1) }` -> 204; 404 when the path does not exist; 422 `validation_error` when it leaves the project folder.

## Output (exact)

`exports/<stamp>/` with, per requested format:

- csv: `detections.csv` columns `image,source,group,capture_time,image_lat,image_lon,class,x,y,w,h,confidence,origin,origin_name,review_state,box_id` (pixels, top-left origin; `origin` = person | local_model | cloud_provider; `origin_name` = model or provider/model name; confidence empty for person boxes); `counts_by_group.csv` (`group,images,<one column per project class in order>,total`); `counts_by_image.csv` (`image,group,capture_time,image_lat,image_lon,<classes...>,total`), images without boxes included with zeros.
- yolo: `labels_yolo/<image stem>.txt` (class index in project class order, normalised cx cy w h, 6 decimals; an empty file for an image without boxes) and `labels_yolo/classes.txt`.
- coco: `labels_coco.json` (`images` with `file_name,width,height,id`; `categories` ids 1..n in class order; `annotations` with `bbox [x,y,w,h]`, `area`, `iscrowd 0`, `score` when the box has a confidence).
- html: `report.html`: project name, export time (local), settings used, totals per class, table per group, then one card per image that has boxes (thumbnail max side 640 with the boxes and class names drawn in the class colours, per-class counts). More than 300 images with boxes: the first 300 by path get a card, a line says how many were left out and points to the CSV.
- Which boxes: `accepted` and `edited`; with `include_unreviewed` also `unreviewed` (never `rejected`). `review_state` is a column so nobody mistakes a proposal for a label.

## File map

| File | Responsibility |
|---|---|
| `backend/app/exports/__init__.py`, `rows.py` | load the export rows (`ExportImage`, `ExportBox` dataclasses) from the DB |
| `backend/app/exports/csv_out.py`, `yolo_out.py`, `coco_out.py`, `html_out.py` | one writer per format, pure: `(rows, classes, folder) -> list[str]` of files written |
| `backend/app/exports/job.py` | `@register_job_type("results_export")`, progress per format, cancellation between formats and every 50 report cards |
| `backend/app/exports/router.py`, `reveal.py`, `schemas.py` | the two routes |
| `backend/app/projects/service.py` | `exports_dir` property |
| `backend/app/api.py` | mount |
| `backend/tests/test_exports_*.py` | per writer + job + reveal |
| `frontend/src/api/exports.ts` (+test) | `createResultsExport`, `revealInExplorer` |
| `frontend/src/exports/ExportForm.tsx`, `ExportJobs.tsx`, `ModelExportSection.tsx` (+tests) | screen parts |
| `frontend/src/screens/ExportScreen.tsx` (+test), `routes.tsx`, `Shell.tsx` (+test) | route `/p/:projectId/export`, nav entry "Export" after Query |
| `frontend/src/jobs/jobLabels.ts` (+test) | label "Results export", result summary line |
| `frontend/src/models/ModelDetail.tsx` (+test) | "Show in folder" next to the weights path and each export (M3) |
| `frontend/e2e/export.spec.ts` | one flow |

---

### Task 1: Rows and the CSV writer

- [ ] Failing tests with a project that has 2 images (one with GPS and capture time), boxes: person/accepted, local_model/edited, cloud/unreviewed, one rejected. Assert exact CSV text for `detections.csv` without and with `include_unreviewed` (the rejected box never appears), the BOM, and both count tables including the zero row. Build the fixture with `handle.session()` inserts (see `tests/test_query_runs.py::boxes_of` and `tests/test_boxes.py` for Box columns and provenance fields).
- [ ] Implement `rows.load(handle, include_unreviewed, image_ids) -> tuple[list[ExportImage], list[ClassDef]]` and `csv_out.write(...)`. Commit `feat(exports): export rows and CSV tables (G2)`.

### Task 2: YOLO and COCO writers

- [ ] Failing tests: exact text of one YOLO file for a known box on a known image size (e.g. 4000x3000, box 1000,600,400,300 -> `0 0.300000 0.250000 0.100000 0.100000`), empty file for the image without boxes, `classes.txt`; COCO structure validated field by field, category ids stable, `score` only when confidence is not null. Implement. Commit `feat(exports): YOLO and COCO label export (G2)`.

### Task 3: HTML report

- [ ] Failing tests: the report contains the project name escaped (use a project name with `<b>`), totals per class, one `<img src="data:image/jpeg;base64,` per image with boxes, no `http://` or `https://` substring anywhere, the 300-card cap message when 301 images have boxes (build rows in memory for this test; inject the thumbnail function so no 301 files are needed), and a drawn thumbnail differs from the undrawn one (pixel check at the box edge on a synthetic image from `make_jpeg`). Implement with Pillow `ImageDraw`. Commit `feat(exports): self-contained HTML report (G2)`.

### Task 4: Job, routes, reveal

- [ ] Failing tests: `POST /exports` with `{"formats": ["csv","yolo","coco","html"]}` -> 202, job succeeds (`wait_job` fixture), `result.folder` starts with `exports/`, every listed file exists, `image_count`/`box_count` right; empty `formats` -> 422; duplicate formats -> 422; a project without any box still succeeds with zero-row tables; cancellation between formats leaves the job `cancelled` (follow the pattern of the cancel test for imports). Reveal: a path inside the project calls `Popen` once with `["explorer.exe", "/select,<absolute path>"]` (monkeypatch `app.exports.reveal.subprocess.Popen`), `../outside`, an absolute path and a UNC path -> 422 without calling `Popen`, a missing file -> 404, a folder path uses `["explorer.exe", "<folder>"]`.
- [ ] Implement; full suite (the contract test now covers both routes; make sure the conformance run does not start Explorer: in `tests/conftest.py` the app fixture patches `app.exports.reveal.launch` to a no-op for every test, and the reveal tests patch `Popen` explicitly). Commit `feat(exports): results_export job, routes, reveal in Explorer (G2)`.

### Task 5: Frontend

- Export screen, heading "Export". Section 1 "Results": checkboxes "Tables for Excel (CSV)" (checked), "Labels in YOLO format", "Labels in COCO format", "Report (HTML, printable)" (checked), each with one explaining sentence; a checkbox "Include proposals nobody has reviewed yet (marked as such in the files)"; the line "Exports the accepted boxes of all N images" from project stats (`labeled_count`, box totals); button "Export"; validation "Choose at least one format." Below: "Past exports" = jobs of type `results_export` from the jobs store / `fetchJobs(type)`, newest first, each with state, local time, `N images, M boxes`, the file list and "Show in folder" (calls `revealInExplorer(result.folder)`); a running export shows the job card.
- Section 2 "Model for other applications": explains in two sentences that ONNX is the file format other tools load (OpenCV, ONNX Runtime, most inference servers) and that the `.pt` weights are for Ultralytics/PyTorch; a model picker (trained models first), button "Export ONNX" (existing `exportModel` API, existing job), then the path and "Show in folder"; if the model already has `exports.onnx` show it immediately.
- `ModelDetail`: "Show in folder" next to the weights path and next to each export.
- Reveal failures surface as an alert with the backend message; in the browser (mock mode) the button still calls the API.
- [ ] Failing tests per component first (form validation and request body; past exports render result and call reveal with the folder; model section posts the ONNX export and shows the existing export), then implement; `Shell.test.tsx` gets the "Export" entry; e2e: open `/p/<P>/export`, tick YOLO, click Export, expect the POST body `{formats: ["csv","yolo","html"], include_unreviewed: false}`. Commit `feat(export): Export screen, show in folder (G2, M3)`.

## Report

`E:\Dev\Yolo\app\.superpowers\sdd\usability\g2-report.md`: commits, test counts, a listing of one real export folder produced through the dev backend on a temp project with a few boxes (file names and sizes, first 5 lines of `detections.csv`), deviations, open points.
