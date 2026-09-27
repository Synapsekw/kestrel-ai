# I-BP ledger — Task 1 Step 1 names check

Read what C0, BA and BX merged to `main` and confirmed the plan's names against the merged
contract/code. Table is *plan name → merged name* (merged name blank when identical).

## (a) routes_detect.py / router.py / stub metadata

| Plan name | Merged name | Match? |
| --- | --- | --- |
| `router = APIRouter(prefix="/projects/{projectId}", tags=["image-detect"])` | same | yes |
| `STUBS` entries `("POST", "/images/{imageId}/detect", "detectImage")`, `("POST", "/images/detect-batch", "detectImageBatch")` | same | yes |
| `add_stubs(router, STUBS)` | same | yes |
| `app/imagery/router.py` includes `app.imagery.routes_detect` in `ROUTE_MODULES`, each module guarded by `try/except` | same | yes |
| `app/imagery/__init__.py` | empty file, no imports | yes — no circular-import risk; (g) below N/A |

## (b) Contract schema fields (`DetectRequest`, `DetectResult`, `ComputeDevice`, `DetectBatchRequest`, `DetectBatchScope`, `ImageFilter`)

All read directly from `contract/openapi.yaml` (this task does not write `detect_schemas.py`; recorded here for T4/T5).

- `ComputeDevice`: `type: string, enum: [cuda, cpu]` — matches AGENTS "device is cuda or cpu, never gpu".
- `DetectRequest`: required `[model_id]`; `model_id: string`; `conf: number 0..1` (0.25 default, per description); `imgsz: integer 320..6400` (model's training size default, per description). Matches global-constraints verbatim.
- `DetectResult`: required `[model_id, suggestions, new, already_covered, device, elapsed_ms]`; `suggestions: [Box]`; `new: integer >=0`; `already_covered: integer >=0`; `device: ComputeDevice`; `elapsed_ms: integer >=0`. Matches brief's shape.
- `DetectBatchScope`: `oneOf` of three objects, each `additionalProperties: false`: `{image_ids: [string], minItems 1, maxItems 100000}`, `{source_id: string}`, `{filter: ImageFilter}`. Matches R-BP7.
- `DetectBatchRequest`: required `[kind, scope]`; `kind: QueryRunKind`; `model_id: string` (required for local_model, not enforced by schema); `provider: ProviderName`; `query: string minLength 1`; `conf: number 0..1`; `tiling: Tiling`; `scope: DetectBatchScope`. Matches D2 (kind + query added beyond spec §11.3).
- `ImageFilter`: `source_id: string`, `has_findings: boolean`, `severity: [integer 1..9] uniqueItems`, `finding_status: [FindingStatus] uniqueItems`, `type_ids: [string]`, `has_suggestions: boolean`, `reviewed: boolean`, `unlabeled: boolean`, `search: string`. Matches R-BP7 (severity is an *array* of ints 1..9, finding_status an array of the enum — BP's batch converts to BX's singular string filter fields per R-BP7).

## (c) Declared responses

| Operation | Declared | Matches brief? |
| --- | --- | --- |
| `detectImage` | 200 DetectResult, 404 NotFound, 409 Error (`model_unavailable`), 422 UnmappedClassesError (covers `unmapped_classes` and `validation_error`), 503 LibraryUnavailable, default Error | yes — 404/409/422/503 all declared |
| `detectImageBatch` | 202 QueryRunWithJob, 409 Error (`model_unavailable`), 422 UnmappedClassesError (covers `unmapped_classes`, `model_or_provider_required`, `query_required`, `no_images`, `too_many_images`, `validation_error`), 503 LibraryUnavailable, default Error | **no 404 declared** |

**UNDECLARED_REFUSALS**: `detectImageBatch` has no `404` response block in the contract, although
R-BP7 and the brief's summary require 404 for unknown image ids / unknown `source_id` / unknown
`model_id` in the batch scope. Flagged for the controller / T5 (whoever writes `detect_schemas.py`
and the route): either the contract needs a 404 added (contract owned by C0) or T5's route answers
404 anyway and relies on the `default: Error` catch-all passing `test_contract.py`'s schemathesis
conformance check. Not this task's file to fix (BP does not edit `contract/`).

## (d) detect-batch 2xx

`detectImageBatch` `202` response schema is `QueryRunWithJob` — matches (d) and D4.

## (e) `preannotateImage` retirement bookkeeping

- Contract: path `/api/v1/projects/{projectId}/images/{imageId}/preannotate` still present,
  `operationId: preannotateImage`, `deprecated: true` (implied by `x-retire-with`), `x-retire-with: I-FW`.
- `backend/tests/test_contract.py` `RETIRING = {"preannotateImage": "I-FW"}` — present.
- `backend/tests/test_contract.py` `BACKEND_PENDING = {..., "preannotateImage": "I-BP", ...}` —
  present, current value `"I-BP"` (Task 6 changes it to `"I-FW"` once the route is deleted, per the
  brief's shared-file-touches table).

All three confirmed present, matching (e) and R-BP9.

## (f) I-BA / I-BX exact signatures

- `app/imagery/shapes.py`: `shape_fields(width, height, *, shape, x, y, w, h, angle, points) ->
  ShapeFields` at line 176 — signature present (not printed here verbatim; confirmed by name/anchor
  match against the plan). Also has its own `MAX_VERTICES = 2000` (annotation-storage polygon cap,
  `class ShapeFields`) — **not the same constant** as this task's `polygons.MAX_VERTICES = 256`
  (mask-simplification cap for provider output, spec §10/§11.3). Two different caps for two
  different purposes; no collision (different modules, different names in scope).
- `app/imagery/annotations.py`: `check_cap(s, image_id: str, adding: int = 1) -> None`,
  `PER_IMAGE_CAP = 5000` — matches brief.
- `app/imagery/schemas.py`: **`BoxOut.from_row(cls, row: Box) -> "BoxOut"`** — takes only `row`,
  *not* `from_row(row, *, finding_id=None, repaired=False)` as the global-constraints doc's
  "Interfaces consumed" section describes. The `finding_id`/`repaired` fields are produced by a
  separate subclass method: `BoxWriteResult.from_written(cls, w) -> "BoxWriteResult"`, which reads
  `w.box`, `w.repaired`, `w.finding_id` from a write-result wrapper. **Recorded difference; not
  used by this task** (Task 1 never calls `BoxOut.from_row`).
- `app/imagery/index.py`: `INDEX_CAP = 100_000`, `build_index(handle, f: ImageFilters, *, sort: str,
  order: str, geo: bool) -> dict` — matches brief (Task 5 dependency only).
- `app/imagery/filters.py`: `class ImageFilters` present — matches brief (Task 5 dependency only).

## (g) `app/imagery/__init__.py` circular-import check

File is empty (no imports at all). No circular-import risk between `app.inference.jobs` and
`app.imagery.detections` from this file. Task 3's Step 5 import check and the lazy-import fallback
described in the brief are not needed for this reason, but Task 3 should still re-verify once
`app/imagery/detections.py` exists.

## Summary for later tasks

- Every top-level name the brief assumes exists and matches, **except**:
  1. `detectImageBatch` has no declared `404` response in the contract (UNDECLARED_REFUSALS, see
     (c) above) — for the final report and for T5.
  2. `BoxOut.from_row` takes only `row`; `finding_id`/`repaired` come from
     `BoxWriteResult.from_written(w)` instead — for the final report; does not affect Task 1.
- `app/imagery/shapes.py` already defines a module-level `MAX_VERTICES = 2000` for a different
  purpose (annotation polygon storage cap) than this task's `app/providers/polygons.py`
  `MAX_VERTICES = 256` (provider mask-simplification cap). Names do not collide (different modules)
  but both should be kept straight in review.
