# Images (sub-project I): execution index

> **For agentic workers:** this is the coordinator's map of the twelve Images unit plans. Each unit
> is executed with superpowers:subagent-driven-development in its own worktree. Read the unit plan
> you were given, this index, the spec and the programme rulings. Do not execute this index itself.

**Spec:** `docs/superpowers/specs/2026-09-26-image-inspection-design.md` (umbrella:
`2026-09-26-inspection-platform-design.md` §6, §7, §10; Foundation names:
`2026-09-26-foundation-design.md` and `docs/evidence/foundation/rulings.md`).
**Binding programme rulings:** `.superpowers/sdd/imc-common/programme-rulings.md` (R1–R10). They win
over the spec; the code on `main` (`4ebcac1`) wins over any spec text.

**Goal:** land the Images workspace on `main`: the browser (grid, capture map, footprints), the
canvas with every palette tool and undo, polygons and points, image lengths in mm ± σ, SAM 2.1 tiny
smart polygon, interactive and batch detection with keyboard review, the segmentation path
(YOLO-seg labels, export, training), and the removal of the Data Manager, Editor, Review and Query
screens.

## Unit plans

| Unit | Plan | Worktree / branch | Cut after | Size |
|---|---|---|---|---|
| I-C0 contract, migration `0011`, stubs, seams | `2026-09-27-images-c0.md` | `i-c0` / `task/i-c0` | F on `main` (`4ebcac1`) | 7 tasks |
| I-BA boxes, shapes, review extras, measurements | `2026-09-27-images-ba.md` | `i-ba` / `task/i-ba` | I-C0, M-C0, C-C0 on `main` | 6 tasks |
| I-BK XMP, camera, footprint, thumbnails, `ImageDetail` | `2026-09-27-images-bk.md` | `i-bk` / `task/i-bk` | all three C0s | 7 tasks |
| I-BX `image_summary`, columnar index, list filters | `2026-09-27-images-bx.md` | `i-bx` / `task/i-bx` | all three C0s | 8 tasks |
| I-BS SAM 2.1 tiny assist service, weights, segment routes | `2026-09-27-images-bs.md` | `i-bs` / `task/i-bs` | all three C0s | 8 tasks |
| I-BP detection shapes, `detect_one`, `detect-batch` | `2026-09-27-images-bp.md` | `i-bp` / `task/i-bp` | I-BA **and I-BX** on `main` (BP T5 uses BX's filters) | 7 tasks |
| I-BT label writers, seg export/datasets/training | `2026-09-27-images-bt.md` | `i-bt` / `task/i-bt` | I-BA on `main` | 8 tasks |
| I-FC canvas core, tools, keymap, store | `2026-09-27-images-fc.md` | `i-fc` / `task/i-fc` | all three C0s | 11 tasks |
| I-FB browser, capture map; finding-edit echo dedupe (R8) | `2026-09-27-images-fb.md` | `i-fb` / `task/i-fb` | all three C0s | 11 tasks |
| I-FA AI UX: detect, suggestions, A/X/Tab, S tool | `2026-09-27-images-fa.md` | `i-fa` / `task/i-fa` | I-FC on `main` | 12 tasks |
| I-FW workspace assembly, arrival, routes, deletions | `2026-09-27-images-fw.md` | `i-fw` / `task/i-fw` | I-FC, I-FB, I-FA on `main` | 13 tasks |
| I-E evidence: e2e flows 1–7, perf, walkthrough, progress | `2026-09-27-images-e.md` | `i-e` / `task/i-e` | every other I unit on `main` | 10 tasks |

No two units share a plan file.

## Execution DAG

**Independent units and parallel batches** (worktrees in one batch build concurrently; merges into
`main` are serialized by the coordinator, each unit rebased on the new `main` before its gate, R5):

1. **I-C0** alone. It merges first of the three C0s (R3: I-C0 → M-C0 → C-C0).
2. **I-BA ∥ I-BK ∥ I-BX ∥ I-BS ∥ I-FC ∥ I-FB** — cut after all three C0s are on `main`.
   Merge order: **BA, BX, BK, BS, FC, FB** (BA first: BP and BT wait on it; BX second: BP T5 needs
   its filters; FC as soon as ready, it gates the critical path — FC may merge ahead of BK/BS/FB).
3. **I-BP ∥ I-BT ∥ I-FA** — BP and BT cut after BA (+BX for BP), FA after FC. Merge order: **BP, BT,
   FA** (any order is safe; FA is on the critical path, so it goes whenever it is ready).
4. **I-FW** alone (after FC, FB, FA).
5. **I-E** last.

**Critical path:** I-C0 → (M-C0, C-C0 merged) → **I-FC** (largest unit, 11 tasks) → **I-FA** →
**I-FW** → **I-E**. The backend chain C0 → BA → BP must merge before FA's integration moves off
Prism; it has about one unit of slack. BS and BT are off the critical path; either can slip without
blocking the workspace (S shows its `reason`; segment export keeps F's refusal).

**Within-I merge order:** C0; BA, BX, BK, BS, FC, FB; BP, BT, FA; FW; E.

## Budget (AGENTS.md item 6)

**Background jobs (progress + cancel, F's Jobs section):** import (existing, now writes XMP camera
columns and 256 px thumbnails — BK); `image_metadata` backfill (BK, new JobType); `summary_rebuild`
(BX, new JobType; the migration seeds the table, the job repairs); batch detection via `infer` (BP);
`accept_above` (existing); segment/obb dataset build and export (F's jobs, BT's writers); seg
training via `train` (BT); `yolo_seg`/COCO results export (BT); `assist_acquire` for SAM weights
download and import (BS, new JobType).

**Synchronous, bounded by one image:** box CRUD and review (≤ 5,000 annotations per image; each
write recomputes one image's summary); `detect` (≤ 64 tiles, 2 s GPU wait then CPU); `segment` (one
crop at 1024² model input, embedding cached; ≤ 64 points); `ImageDetail`; image measurements (≤ 500
per image, one unpaged list).

**Bounded reads:** index ≤ 100,000 rows (`422 too_many_images`), ~30 B a row, one query; details
≤ 200 ids per call for the visible window; thumbnails 256 px, ≤ 8 in flight, aborted on scroll-out;
canvas one full frame + ≤ 4 previews in an LRU with `close()`; capture map points from the index
only; backfill one directory listing per source, one original per image, streamed; one SAM model and
two embeddings resident.

## Rules while Images is in flight

- **No installer is built** from `main` for this wave (R9); IMC-X builds one after I, M and C merge.
- `scripts\start-task.ps1` / `finish-task.ps1` are not used (R10); the coordinator cuts and merges
  by hand. Backend commands use `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` from
  `<worktree>\backend`. No unit adds a Python package (BS confirmed Ultralytics 8.4.154 carries
  SAM 2.1; `kestrel_backend.spec` already collects it).
- **Only I-C0 edits `contract/openapi.yaml` and writes a migration** (`0011`, `down_revision =
  "0010"`, R4; its merge step re-checks `alembic heads`). Every other unit consumes C0's names and
  its Task 1 verifies them on `main`, reporting BLOCKED on a mismatch rather than improvising.
- **Stub and allowance hand-offs:** each unit deletes only its own lines in
  `backend/tests/test_contract.py` (`EXPECTED_STUBS`, `BACKEND_PENDING`, `RETIRING`,
  `REFUSES_VALID_DATA`) as the C0 plan's hand-off table lists.
- **Deprecated `preannotateImage`:** BP deletes the backend route and the interim editor's call,
  and sets `BACKEND_PENDING["preannotateImage"]` to `"I-FW"`; FW deletes the contract path, its two
  schemas, the frontend helper and the `RETIRING` entry, and regenerates the client (a contract edit
  outside C0, allowed only for this deletion).
- **Between C0 and FW** the old Editor/Data Manager screens stay on `main` and must keep working
  (C0's `test_images_c0_compat.py`; BA/BK/BX keep the kept paths answering). FA and BP make
  one-line edits to `EditorScreen.tsx`/`useEditorImage.ts` that FW then deletes.
- **Keys:** FC owns tool keys in `images/workspace/keymap.ts`; FA owns D, A, X, Tab, S, G and the
  **1–9 severity keys** (R-FA3), registered through FC's `registerKeyRows`/`FA_ACTIONS`; FW owns
  ← / →, Shift+M, N, C, Ctrl+[ / Ctrl+]. Nobody else binds 1–9.
- **Finding links:** FC's store `findingOf` (`linkFindings`/`unlinkFinding`) is the single box →
  finding map; FA writes it on accept, FW fills it from `GET /findings?image_id=`.
- **UI primitives:** no unit adds a `ui/` primitive in this wave. FC adds four `Alt+Shift+Arrow`
  chords to the existing `nudge` entry of `ui/keymap.ts` (one line).
- **e2e ports:** each unit's dispatch gets its own range from the coordinator (R10).

## Shared-file touches

Files outside Images' own packages (`backend/app/imagery/`, `backend/app/assist/`,
`frontend/src/images/`, `frontend/src/store/imagesWorkspace.ts`, new test files). One line per
touch; anchors are in the unit plans.

| File | Unit | Anchor | What |
|---|---|---|---|
| `contract/openapi.yaml`, `contract/client/schema.d.ts`, `contract/client/index.ts` | C0 (FW: preannotate deletion only) | I's path groups; `components/parameters` after `cloudMeasurementId`; schemas after `BoxReviewResult`; `JobType` enum | 13 ops, widened image/box schemas, 3 JobTypes, F-schema fields (§11), regenerated client |
| `backend/app/api.py` | C0 | right after `api_router = APIRouter(prefix="/api/v1", …)` | one guarded loop including `app.imagery.router` and `app.assist.router` **before** `datasets_router` |
| `backend/app/db/models.py` | C0 | `class Image`, `class Box`, after `class Box` | columns; `ImageSummary`, `ImageMeasurement` |
| `backend/app/db/migrations/versions/0011_images.py` | C0 | new | the migration |
| `backend/app/jobs/registry.py` (via job modules) | C0 | per-unit `imagery/jobs_*.py`, `assist/jobs_acquire.py` | 3 JobTypes registered with stub bodies |
| `backend/tests/test_contract.py` | C0 then BA, BK, BX, BS, BP, BT, FW | `EXPECTED_STUBS`, `BACKEND_PENDING`, `RETIRING`, `REFUSES_VALID_DATA` | C0 adds; each unit deletes its own lines |
| `backend/tests/test_foundation_contract.py` | C0 | the retired-operations test | scope the assertion to `F-` units |
| `frontend/src/jobs/jobLabels.ts`, `app/jobVerbs.ts`, `jobs/JobCard.tsx`, `agent/project/ToolRow.tsx` | C0 | after each `dataset_build:` entry | 3 lines each |
| `frontend/src/test/fixtures.ts`, `test/appSectionFixtures.ts` | C0 (BT: `task` on TrainableDataset fixtures) | `exampleImage*`, `personBox`, `proposalBox`, `examplePreview` | new required fields |
| `frontend/src/exports/ExportForm.tsx` | C0, BT | `DEFAULT_SELECTED` (C0); `OPTIONS` (BT) | `yolo_seg: false`; the `yolo_seg` option row |
| `backend/app/datasets/boxes.py` | BA | whole file | `git mv` → `imagery/annotations.py` |
| `backend/app/datasets/router.py` | BA, BK, BX | BA: box routes + imports; BK: `get_image`/`update_image`; BX: `list_images` | BA and BK delete their moved routes; BX adds filter params |
| `backend/app/datasets/schemas.py` | BA, BX, BP | BA: `Provenance`…`BoxReviewResult` block → re-export line; BX: `ImageSort`, `ImageOut`; BP: deletes BA's re-export line when unused | distinct hunks |
| `backend/app/datasets/empties.py` | BA | `_reject_pending`, `bulk_mark_empty` | `summary.touch` per image |
| `backend/app/datasets/images.py` | BX | `_box_stats`, `_sort_expression`, `_filtered`, `list_images`, `get_image` | reads `image_summary`; `ImageRow` NamedTuple |
| `backend/app/datasets/prepare.py`, `datasets/importer.py` | BK | module; `_run_import`, `_prepare_all`, `_write_rows` | XMP/EXIF camera, thumbnails, camera columns |
| `backend/app/datasets/materialise.py` | BT | `detect_boxes`, `_label_text`, `_clip01` | moved to `imagery/labels.py` |
| `backend/app/detect/review.py` | BA | line 20 import; `review_boxes` call | import path; `.changed` |
| `backend/app/detect/runs.py` | BP | `if model.task == "segment":` in `create_runs` | refuse segment/obb only for map targets |
| `backend/app/findings/service.py` | BA | three lazy `from app.datasets import boxes` | import path |
| `backend/app/main.py` | BK, BX | `project_opened` step tuple: BK after `("model adoption", …)`, BX before it | one step each |
| `backend/app/projects/service.py` | BX | `ProjectHandle.__init__` after `make_session_factory` | `image_summary.install(self._factory)` |
| `backend/app/providers/{base,tiling,local_yolo}.py` | BP | `Detection`; `to_full_image`, `iou`; `_load`, `detect_tile`, `_from_result` | shapes, polygon offsets, obb/masks, CPU slot |
| `backend/app/inference/{jobs,service,router,schemas}.py` | BP | `_write_boxes` → `_write_shapes`; preannotate code | shapes; delete `/preannotate` |
| `backend/app/library/datasets/{selection,build,export,service,router,schemas}.py` | BT | see BT header | inclusion rule, `skipped`, segment export, `task` preview param |
| `backend/app/training/{runs,starter,starter_download,schemas,trainer,worker}.py` | BT | see BT Task 5 | seg starters, mask metrics, lift segment refusal |
| `backend/app/exports/{rows,yolo_out,coco_out,job,schemas}.py` | BT | see BT Task 2 | shape fields, `yolo_seg`, COCO polygons |
| `backend/tests/*` (existing) | BA, BP, BT | `test_boxes.py`, `test_findings_invariant.py`, `test_detect_review.py`, `test_project_types.py`, `test_detect_runs.py`, `test_no_project_kind.py`, `test_inference_gpu.py`, `test_preannotate.py` (deleted), `library_datasets_helpers.py`, `test_library_dataset_export.py`, `test_starter.py` | per the owning plan |
| `backend/tests/test_packaging_spec.py`, `backend/scripts/smoke_frozen.ps1` | BS | after the hiddenimports test; `param(` and step 7 | SAM coverage test; `sam ok` step (run by IMC-X) |
| `backend/pyproject.toml` | E | `[tool.pytest.ini_options]` | `perf` marker, deselected by default |
| `frontend/src/ui/keymap.ts` | FC | the `nudge` entry | four `Alt+Shift+Arrow` chords |
| `frontend/src/editor/{geometry,history}.ts` | FC | whole files | moved into `images/canvas/` with re-export shims (FW deletes) |
| `frontend/src/editor/ConfidenceFloor.tsx` (+test) | FA | whole files | `git mv` → `images/ai/` |
| `frontend/src/screens/EditorScreen.tsx` | BP, FA (then FW deletes) | `useEditorImage(…)` call (BP); `ConfidenceFloor` import (FA) | drop 3rd argument; new import path |
| `frontend/src/editor/useEditorImage.ts` (+test) | BP | pre-annotate branch | delete branch |
| `frontend/src/store/changes.ts` (+ new `changesEcho.ts`, `changesOwnWrite.ts`) | FB | `applyEvent`'s `findings.changed` branch | own-write echo ledger (R8) |
| `frontend/src/findings/inspector/{useFinding,NoteField,Comments,Attachments}.tsx`, `findings/{BulkBar,FindingsScreen}.tsx` | FB | each finding write | wrap in `ownFindingsWrite` |
| `frontend/src/models/*`, `api/libraryDatasets.ts`, `train/*`, `library/ModelDetail.tsx`, `jobs/logLines.ts` | BT | see BT header | polygons enabled, `task` preview, mask mAP |
| `frontend/src/api/images.ts` | FW | after `setMarkedEmpty` | `ImageDetail` types, `fetchImageDetail`, `setSubjectDistance` |
| `frontend/src/app/routeModel.ts` (+test) | FW | `layoutOf` images branch | images tab is always `workspace` |
| `frontend/src/routes/{projectRoutes,legacyRedirects}.tsx`, new `routes/ReviewRoute.tsx` | FW | the images/label/edit/review/query routes | one `images/:imageId?` route and the redirects |
| `frontend/src/review/DetectReview.tsx` (+test) | FW | `PhotoReview` and its imports | photo branch → "Review in Images" link; M keeps the map branch |
| deletions: `screens/{EditorScreen,DataManagerScreen,ReviewScreen,QueryScreen}`, `review/ImageReviewQueue`, `editor/*`, `data/{ImageGrid,FilterBar,useImageList,ImageTable}`, `store/editor.ts` | FW | whole files | deleted |
| `frontend/e2e/{editor,data-manager,review,query,contour}.spec.ts` | FW | whole files | deleted; `boot`, `shell`, `foundation-journey` step 4 ported |
| `frontend/package.json`, `playwright.perf.config.ts`, `tsconfig.node.json` | E | `scripts` after `"e2e"`; `include` | `e2e:perf` |
| `docs/progress.md` | E | top, above `## Foundation lands` | one entry |
| `vault/decisions/2026-09-27-sam-embeddings-on-cpu-device-per-call.md` | BS | new | ADR |

**Same-file pairs inside a batch** (distinct hunks; the later merge rebases trivially):
batch 2 — `datasets/router.py` (BA, BK, BX), `datasets/schemas.py` (BA, BX), `main.py` (BK, BX),
`test_contract.py` (all); batch 3 — `EditorScreen.tsx` (BP, FA), `test_contract.py` (BP, BT).

## Cross-sub-project edges (R7)

- **C reads I's pose columns** (`0011`): `rel_alt`, `gimbal_pitch`, `gimbal_yaw`, `gimbal_roll`,
  `flight_yaw`, `lrf_distance_m`, `focal_px`, `focal_mm`, `sensor_w_mm`, `orig_w`, `orig_h`,
  `camera_model` on `image`, all nullable — **exactly spec §7.3's names**, no deviation. C's
  `app/pointclouds/cameras.py:_pose_columns` reads them after I-C0 is on `main`. BK also exports
  `app.imagery.footprint.effective_yaw(pitch, gimbal_yaw, flight_yaw)` if C wants the same yaw rule.
- **C → I arrival:** `/p/:pid/images/:imageId?at=px,py&r=rpx&from=cloud:<cloudId>` (and `?finding=`)
  exactly as spec §6.5, parsed by `images/workspace/arrival.ts` (I-FW: `parseArrival`,
  `imageArrivalHref`). `px, py, r` are stored-image pixels; `r` defaults to 24. FW renders a static
  ring and a "Back to 3D" chip to `/p/:pid/clouds/<cloudId>`. C's e2e asserts only the URL until
  I-FW merges.
- **I → C:** FW's image panel offers "Open in 3D" linking `/p/:pid/clouds/:cloudId?from_image=<imageId>&px=u,v`
  (C §10.4) when a cloud's bounds contain the image's GPS point. C must keep that query shape.
- **M:** `GET /measurements` is M's (M-B4); image lengths stay out of it (I §20). `review/DetectReview.tsx`
  keeps its map branch for M; FW changes only the photo branch. `detect/runs.py` `create_runs`: BP
  lets segment/obb models run on **image** sources and keeps the refusal for map targets — M's segment
  models on orthomosaics lift the rest.
- **Shared anchors other C0s must rebase over:** `openapi.yaml` `JobType` enum and
  `components/parameters`; `api.py` router block (I-C0 adds one guarded loop right after
  `api_router = APIRouter(…)`); `test_contract.py` allowance dicts; the four frontend job label
  maps (`dataset_build:` anchor). I-C0 merges first, so M-C0 and C-C0 add after I's lines.
- **Keymap:** `isTypingTarget` stays in `ui/keymap.ts`; I adds no scope there, only FC's `nudge` chords.
- **Finding-edit echo (R8)** is I-FB's: `store/changes.ts` and the findings inspector writes. M and C
  pages that write findings should wrap them in `ownFindingsWrite` (from `store/changesOwnWrite.ts`)
  once FB is on `main`; un-wrapped writes still work (one extra bounded re-read).

## Unit I-E: evidence (R9)

I-E writes the e2e flows 1–7 (spec §17; mock-backed Playwright with route fakes in
`e2e/images/world.ts`, plus `backend/tests/test_images_journey.py` against the real API), the perf
harness (`pnpm -C frontend e2e:perf`, p95 ≤ 16.7 ms locally with 0.5 ms timer jitter allowed; the
software-GL structural proxy in the normal gate), the 20k-image scale check, the operator
walkthrough and the `docs/progress.md` entry. It does **not** build or install an installer;
IMC-X runs the full gate, freezes the sidecar, runs `smoke_frozen.ps1` (including BS's `sam ok`
step), builds the installer and walks E's walkthrough on it.

## Controller rulings (binding on executors)

1. **Router split:** C0 creates `imagery/router.py` aggregating `routes_boxes.py` (BA),
   `routes_camera.py` (BK), `routes_index.py` (BX), `routes_detect.py` (BP) and `assist/router.py`
   (BS), each with its unit's 501 stubs, so batch-2 units never edit one route file.
2. **Seams (C0):** `imagery/summary.touch(s: Session, image_id)`; `imagery/camera.scale(image) ->
   Scale | None` (frozen dataclass `distance_m, distance_sigma_m, distance_source, gsd_mm`);
   `imagery/labels.write_labels(...)` / `expressible(...)`; `assist/sam.SegmentBackend` Protocol.
   A signature test pins each; implementers must not change them.
3. **`createBox`/`updateBox` answer a flat `BoxWriteResult`** (Box + `repaired` + `finding_id`);
   `BoxReviewResult` keeps `updated`; `BoxCreate` requires only `class_id`.
4. **Image measurements:** ≤ 500 per image; `length_mm`/`sigma_mm` from `camera.scale`, null until
   BK lands; σ_L = L·σ_D/D + √2·gsd (BA inlines it; BK's `length_sigma_mm` must agree).
5. **`image_summary` is seeded by migration `0011`**; BX's `touch` recomputes exactly the seed's rule;
   BX also installs session events as a safety net (idempotent with BA's explicit calls).
6. **Finding aggregates** count non-closed findings; `finding_status` is a filter only.
7. **Assist model state** is `missing | ready | invalid | unavailable` with a `reason`; S stays
   selectable and shows the reason and "Get model" (FA R-FA7); weights ≈ 78 MB.
8. **1–9 severity keys belong to FA** (R-FA3); FC and FW do not bind them.
9. **The finding-edit echo (R8) is FB's** Tasks 1–2, with `findings/echoRereads.test.tsx` counting
   re-reads after one edit.
10. **No I unit writes a migration other than `0011`**, and none edits another sub-project's paths.

## Reconciliation log (2026-09-27)

One line per change: what, and which plan files.

1. `index`, all plans — controller rulings 1–10 written to the planners' common dispatch before
   planning (router split, seam names, `0011`, JobTypes, frontend ownership, keymap ownership).
2. `ba`, `bk`, `bx`, `bs` — the batch-2 backend plans were written before C0's plan existed; each
   planner was resumed and rewrote its names to C0's (operationIds, schemas, ORM columns, stub
   modules, job modules, hand-off lines). Each Task 1 now verifies rather than discovers.
3. `ba` — measurement cap 1,000 → 500 (C0 ruling 7); lengths in mm via `camera.scale` instead of
   "px only"; bounds refusals renamed `out_of_bounds`; polygon errors split `invalid_shape` /
   `empty_polygon` per C0.
4. `bk` — its NamedTuple `Scale` replaced by C0's frozen dataclass; job module renamed to C0's
   `jobs_metadata.py:run_image_metadata`; `distance_source` is `"none"`, never null; refresh while
   running answers `409 job_running`.
5. `bx` — `image_summary` columns and semantics adopted from C0 ruling 4; finding counts exclude
   closed findings (C0 ruling 5); severity filter `1–9` only; api.py route order is verify-only.
6. `c0` — Task 5 rewords the stale `task_not_supported` descriptions on the library dataset export
   and training operations (BT lifts the segment refusal).
7. `c0` — `updateBox` 422 description names `point_needs_defect_type` and rectangle fields on a
   polygon/point; `reviewBoxes` 409 details are `{finding_id, finding_ids}` (from BA).
8. `c0`, `bs` — `AssistModel` gains `reason` and state `unavailable`; `segmentImage` declares
   `422 points_outside_crop`; size ≈ 78 MB (BS measured 78,105,722 bytes).
9. `bs` — SAM request/response names follow C0 (`positive`, `path`, `SegmentPrepared`, job result
   `{key}`).
10. `fa` — final SAM/assist and box-write shapes sent to FA before it finished; FA adopted them.
11. `fa`, `fw` — FC's real names replace their guesses (`suggestions`/`overlay` slots, tool registry,
    keymap, store); FC's store `findingOf` is the one box → finding map.
12. `fc`, `fw` — adopt I-E's test hooks (`image-canvas`, `data-tool`, `data-shape-count`, layer
    names, `image-info-chip`, `images-status-bar`, …); `data-point-count` and `data-footprint-kind`
    sit on FW's wrapper `data-testid="capture-map-host"`, and E's `ui.ts` points there.
16. `fw` — "Open in Findings" keeps `anchor_kind=image` (F's Findings screen reads no `image_id` URL
    param; not edited in this wave); a frame counts as deleted only when it drops out of the index.
17. `fc` — `cmdReview`'s undo also calls `unlinkFinding` for each id (from FA): an undone accept
    deletes its finding, so a stale link would let **3** grade a deleted finding. FA's Task 4 pins it.
18. `fw` — key layer order is `[FA, FC canvas, FW]` (FA R-FA15; FA's `cancel` returns false unless a
    detection runs, so Esc still reaches FC). FA's layer is `useAiWorkspace(...).keyHandlers`, and
    `AiDetectButton` goes in `ToolPalette`'s children; FW's `seams.tsx` guesses (`useAiKeyLayer`,
    `useSuggestionActions`) are resolved against FA's merged `images/ai/index.ts` in FW Task 1.
13. `fw` — deletes/ports the Playwright specs of the deleted screens (`editor`, `data-manager`,
    `review`, `query`, `contour`; ports `boot`, `shell`, `foundation-journey` step 4);
    `detect-review.spec.ts` is map-only and stays.
14. `index`, `bp` — BP is cut after BA **and BX** (its T5 filter scope uses BX's `ImageFilters`).
15. `bp` — deletes the backend `/preannotate` route and sets `BACKEND_PENDING["preannotateImage"]`
    to `"I-FW"`; FW deletes the contract path (C0 ruling 3).
