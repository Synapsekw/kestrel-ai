# Asset model U3 — contract, tables, models and versions API, GLB job

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every M1 operation in the contract, persist asset models and their versions, serve GLBs built by a background job, and list asset models as a data item. Run operations answer 501 until U5.

**Architecture:**
- The contract comes first, with `schema.d.ts` regenerated in the same commit.
- Migration `0015` adds `asset_model`, `asset_model_version` and `asset_model_run`. The ORM classes live in `app/db/models.py`, the one module Alembic's env imports.
- `app/asset_models/store.py` owns rows and folders.
- `app/asset_models/service.py` owns "add a version and queue its GLB".
- The `asset_model_glb` job builds with U1's `build_glb` and writes `v<n>.glb` atomically.
- `router.py` serves models, versions and GLBs. `stubs.py` routes the five run operations as 501.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest; the OpenAPI 3.1 contract, Spectral and openapi-typescript.

**Spec:** §5, §8 (data list), §9. Index and Global Constraints: `docs/superpowers/plans/2026-10-02-asset-model-builder.md`.

**Needs:** nothing for Tasks 1–3. Task 4 (GLB job) imports U1's `build_glb`. If U1 hasn't merged when you reach Task 4, rebase onto `main` once it has. **Worktree:** `scripts\start-task.ps1 -Name am-u3`.

---

### Task 1: Contract

**Files:**
- Modify: `contract/openapi.yaml`
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/client/index.ts` (type aliases and `assetModelGlbUrl`)
- Modify (only to keep `pnpm -C frontend build` green): `frontend/src/app/paletteCommands.ts`, `frontend/src/reports/ReportFilters.tsx`, and any other `Record<DataItemType | JobType, …>` that `tsc` reports.
- Test: `contract` check, and `frontend` build.

**Interfaces:**
- Produces, over HTTP (all under `/api/v1/projects/{projectId}`):

| Method | Path | operationId | Success |
| --- | --- | --- | --- |
| GET | `/asset-models` | `listAssetModels` | 200 `AssetModelList` |
| POST | `/asset-models` | `createAssetModel` | 201 `AssetModel` |
| GET | `/asset-models/{assetModelId}` | `getAssetModel` | 200 `AssetModel` |
| PATCH | `/asset-models/{assetModelId}` | `patchAssetModel` | 200 `AssetModel` |
| DELETE | `/asset-models/{assetModelId}` | `deleteAssetModel` | 204; 409 `job_running` |
| GET | `/asset-models/{assetModelId}/versions` | `listAssetModelVersions` | 200 `AssetModelVersionList` |
| POST | `/asset-models/{assetModelId}/versions` | `createAssetModelVersion` | 201 `AssetModelVersionWithJob`; 422 `invalid_spec` |
| GET | `/asset-models/{assetModelId}/versions/{version}` | `getAssetModelVersion` | 200 `AssetModelVersionDetail` |
| POST | `/asset-models/{assetModelId}/versions/{version}/restore` | `restoreAssetModelVersion` | 201 `AssetModelVersionWithJob` |
| GET | `/asset-models/{assetModelId}/versions/{version}/glb` | `getAssetModelGlb` | 200 `model/gltf-binary`; 409 `not_ready` |
| POST | `/asset-models/{assetModelId}/runs` | `startAssetModelRun` | 202 `AssetModelRunWithJob`; 409 `job_running` / `provider_key_missing`; 422 `no_sources` |
| GET | `/asset-models/{assetModelId}/runs` | `listAssetModelRuns` | 200 `AssetModelRunList` |
| GET | `/asset-models/{assetModelId}/runs/{runId}` | `getAssetModelRun` | 200 `AssetModelRun` |
| POST | `/asset-models/{assetModelId}/runs/{runId}/stop` | `stopAssetModelRun` | 202 `AssetModelRun` |
| GET | `/asset-models/{assetModelId}/runs/{runId}/steps/{step}/thumb` | `getAssetModelRunThumb` | 200 `image/png`; 204 |
| GET | `/asset-models/{assetModelId}/runs/{runId}/overlay/{cloudId}` | `getAssetModelRunOverlay` | 200 `application/octet-stream`; 204 |

- Enum additions:
  - `DataItemType` += `asset_model`
  - `JobType` += `asset_model_glb`, `asset_model_run`
  - `Event.type` += `asset_models.changed`
  - new `KeyedProviderName: [openai, anthropic, gemini]`, referenced by the run schemas only (U5 moves `/providers` to it)
- Client: `assetModelGlbUrl(baseUrl, token, projectId, assetModelId, version) -> string` (`?token=` like `imageFileUrl`); `assetModelOverlayUrl(baseUrl, token, projectId, assetModelId, runId, cloudId) -> string`; type aliases `AssetModel`, `AssetModelVersion`, `AssetModelVersionDetail`, `AssetSpec`, `AssetPart`, `AssetModelRun`, `AssetModelRunStep`, `AssetModelRunStart`, `KeyedProviderName`, `SpecIssue`.

- [ ] **Step 1: Add the paths**

Add a section after the drawings paths (search `operationId: listDrawings`, then the end of that path group). Each operation uses `tags: [assetmodels]` and ends with `default: { $ref: "#/components/responses/Error" }`. Add one new shared parameter set under `components/parameters` next to `projectId`:

```yaml
    assetModelId:
      name: assetModelId
      in: path
      required: true
      schema: { type: string }
    assetModelVersion:
      name: version
      in: path
      required: true
      schema: { type: integer, minimum: 1 }
    assetModelRunId:
      name: runId
      in: path
      required: true
      schema: { type: string }
```

Paths (write them out in full in the file, in this shape):

```yaml
  # ----- asset models (spec 2026-10-02-asset-model-builder §9)
  /api/v1/projects/{projectId}/asset-models:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [assetmodels]
      operationId: listAssetModels
      summary: Every asset model, newest first (tens).
      responses:
        "200":
          description: asset models
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetModelList" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [assetmodels]
      operationId: createAssetModel
      summary: Create an empty asset model (no version yet). Publishes `asset_models.changed`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/AssetModelCreate" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetModel" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
    get:
      tags: [assetmodels]
      operationId: getAssetModel
      summary: One asset model.
      responses:
        "200":
          description: the asset model
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetModel" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    patch:
      tags: [assetmodels]
      operationId: patchAssetModel
      summary: Rename or retag. Publishes `asset_models.changed`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/AssetModelPatch" }
      responses:
        "200":
          description: updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetModel" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [assetmodels]
      operationId: deleteAssetModel
      summary: Delete the model, its versions, runs and files. Refused while a run or GLB job is live.
      responses:
        "204": { description: deleted }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: a run or GLB job is live (`code` is `job_running`)
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
```

Continue in the same style for:
- `…/versions` (GET `listAssetModelVersions` → `AssetModelVersionList`; POST `createAssetModelVersion`, body `AssetModelVersionCreate`, 201 `AssetModelVersionWithJob`, 422 "the spec has errors (`code` is `invalid_spec`; `details.errors` lists them)" → `Error`)
- `…/versions/{version}` (GET `getAssetModelVersion` → `AssetModelVersionDetail`)
- `…/versions/{version}/restore` (POST, no body, 201 `AssetModelVersionWithJob`)
- `…/versions/{version}/glb` (GET; 200 `content: model/gltf-binary: schema: { type: string, format: binary }`; 409 "the GLB is still building or failed (`code` is `not_ready`)")
- `…/runs` (GET `listAssetModelRuns` → `AssetModelRunList`; POST `startAssetModelRun`, body `AssetModelRunStart`, 202 `AssetModelRunWithJob`; 409 "a run is already live (`job_running`) or the provider has no key (`provider_key_missing`)"; 422 "a source is missing or not ready (`code` is `no_sources`), or refine was asked of a model with no version (`nothing_to_refine`)")
- `…/runs/{runId}` (GET `getAssetModelRun` → `AssetModelRun`)
- `…/runs/{runId}/stop` (POST `stopAssetModelRun`, 202 `AssetModelRun`; summary "Ask the run to stop; it writes a draft version if it has parts.")
- `…/runs/{runId}/steps/{step}/thumb` (parameter `step` integer ≥ 1; 200 `image/png` binary; 204 "the step has no render")
- `…/runs/{runId}/overlay/{cloudId}` (parameter `cloudId` string; 200 `application/octet-stream` binary, description "little-endian float32 xyz triples in the asset frame, metres, ≤ 300 000 points"; 204 "no overlay for this cloud")

Every path adds a 404 `NotFound`.

- [ ] **Step 2: Add the schemas**

Under `components/schemas`, near `DrawingWithJob`:

```yaml
    KeyedProviderName:
      type: string
      enum: [openai, anthropic, gemini]
      description: A provider with a key in Credential Manager. Detection still uses `ProviderName`.
    AssetModelStatus:
      type: string
      enum: [empty, building, ready]
    AssetModel:
      type: object
      required: [id, name, asset_type, tag, status, current_version, live_run_id, captured_on, created_at, updated_at]
      properties:
        id: { type: string }
        name: { type: string }
        asset_type: { type: [string, "null"] }
        tag: { type: [string, "null"] }
        status: { $ref: "#/components/schemas/AssetModelStatus" }
        current_version: { type: [integer, "null"] }
        live_run_id: { type: [string, "null"] }
        captured_on: { type: [string, "null"], format: date }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    AssetModelList:
      type: object
      required: [items]
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/AssetModel" } }
    AssetModelCreate:
      type: object
      additionalProperties: false
      required: [name]
      properties:
        name: { type: string, minLength: 1, maxLength: 120 }
        asset_type: { type: [string, "null"], maxLength: 80 }
        tag: { type: [string, "null"], maxLength: 80 }
    AssetModelPatch:
      type: object
      additionalProperties: false
      properties:
        name: { type: string, minLength: 1, maxLength: 120 }
        asset_type: { type: [string, "null"], maxLength: 80 }
        tag: { type: [string, "null"], maxLength: 80 }
        captured_on: { type: [string, "null"], format: date }
    AssetPartPlacement:
      type: object
      additionalProperties: false
      properties:
        origin_mm: { type: array, items: { type: number }, minItems: 3, maxItems: 3 }
        axis: { type: array, items: { type: number }, minItems: 3, maxItems: 3 }
        host: { type: [string, "null"] }
        bearing_deg: { type: [number, "null"] }
        elevation_mm: { type: [number, "null"] }
        e_mm: { type: [number, "null"] }
        n_mm: { type: [number, "null"] }
    AssetPartSource:
      type: object
      additionalProperties: false
      required: [kind]
      properties:
        kind: { type: string, enum: [drawing, cloud, photo, assumed] }
        id: { type: [string, "null"] }
        region:
          type: [array, "null"]
          items: { type: number, minimum: 0, maximum: 1 }
          minItems: 4
          maxItems: 4
        note: { type: [string, "null"], maxLength: 500 }
    AssetPart:
      type: object
      additionalProperties: false
      required: [id, name, group, shape, params, source]
      properties:
        id: { type: string, pattern: "^[A-Za-z0-9_.\\-]{1,64}$" }
        name: { type: string, minLength: 1, maxLength: 120 }
        group: { type: string, enum: [Shell, Head, Bottom, Nozzle, Manway, Support, Access, Internal, Lining, Other] }
        shape:
          type: string
          enum: [cylinder, cone, head_torispherical, head_ellipsoidal, head_hemispherical, flat_plate, box, nozzle, pipe_run, lathe, extrusion, sweep]
        params:
          type: object
          additionalProperties: true
          description: Shape-specific, millimetres and degrees (spec §6.2). Validated server-side per shape.
        placement: { $ref: "#/components/schemas/AssetPartPlacement" }
        material: { type: string, enum: [paint, steel, rubber, concrete, grating, galvanised, glass, other] }
        source: { $ref: "#/components/schemas/AssetPartSource" }
        confidence: { type: string, enum: [high, medium, low] }
        note: { type: [string, "null"], maxLength: 500 }
    AssetInfo:
      type: object
      additionalProperties: false
      properties:
        tag: { type: [string, "null"], maxLength: 80 }
        type: { type: [string, "null"], maxLength: 80 }
        name: { type: [string, "null"], maxLength: 120 }
        frame_note: { type: [string, "null"], maxLength: 500 }
        plant_to_true_north_deg: { type: [number, "null"] }
        attributes: { type: object, additionalProperties: { type: string } }
    AssetSpec:
      type: object
      additionalProperties: false
      properties:
        asset: { $ref: "#/components/schemas/AssetInfo" }
        parts: { type: array, maxItems: 2000, items: { $ref: "#/components/schemas/AssetPart" } }
    SpecIssue:
      type: object
      required: [code, part_id, message]
      properties:
        code: { type: string }
        part_id: { type: [string, "null"] }
        message: { type: string }
    AssetSourceRef:
      type: object
      additionalProperties: false
      required: [type, id]
      properties:
        type: { type: string, enum: [drawing, point_cloud, image] }
        id: { type: string }
    AssetModelVersion:
      type: object
      required: [id, model_id, version, kind, glb_status, source_ids, run_id, note, part_count, meta, created_at]
      properties:
        id: { type: string }
        model_id: { type: string }
        version: { type: integer }
        kind: { type: string, enum: [agent, manual, draft] }
        glb_status: { type: string, enum: [pending, ready, failed] }
        source_ids: { type: array, items: { $ref: "#/components/schemas/AssetSourceRef" } }
        run_id: { type: [string, "null"] }
        note: { type: [string, "null"] }
        part_count: { type: integer }
        meta:
          type: [object, "null"]
          description: "`build_glb` meta: bounds_m, top_m, triangles, parts[{id,name,group,triangles}]"
        created_at: { type: string, format: date-time }
    AssetModelVersionList:
      type: object
      required: [items]
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/AssetModelVersion" } }
    AssetModelVersionDetail:
      allOf:
        - $ref: "#/components/schemas/AssetModelVersion"
        - type: object
          required: [spec, warnings]
          properties:
            spec: { $ref: "#/components/schemas/AssetSpec" }
            warnings: { type: array, items: { $ref: "#/components/schemas/SpecIssue" } }
    AssetModelVersionCreate:
      type: object
      additionalProperties: false
      required: [spec]
      properties:
        spec: { $ref: "#/components/schemas/AssetSpec" }
        note: { type: [string, "null"], maxLength: 500 }
    AssetModelVersionWithJob:
      type: object
      required: [version, job]
      properties:
        version: { $ref: "#/components/schemas/AssetModelVersion" }
        job: { $ref: "#/components/schemas/Job" }
    AssetModelRunStep:
      type: object
      required: [n, tool, ok, summary, has_thumb]
      properties:
        n: { type: integer }
        tool: { type: string }
        ok: { type: boolean }
        summary: { type: string }
        has_thumb: { type: boolean }
    AssetModelRun:
      type: object
      required: [id, model_id, job_id, provider, model_name, mode, notes, state, stop_reason, phase, steps, summary,
                 open_questions, usage, sources, version, comparison, started_at, ended_at]
      properties:
        id: { type: string }
        model_id: { type: string }
        job_id: { type: string }
        provider: { $ref: "#/components/schemas/KeyedProviderName" }
        model_name: { type: string }
        mode: { type: string, enum: [build, refine] }
        notes: { type: [string, "null"] }
        state: { type: string, enum: [running, finished, stopped, failed] }
        stop_reason: { type: [string, "null"], enum: [budget, timeout, user, provider_error, interrupted, null] }
        phase: { type: string, enum: [sampling, reading, building, checking, done] }
        steps: { type: array, items: { $ref: "#/components/schemas/AssetModelRunStep" } }
        summary: { type: [string, "null"] }
        open_questions: { type: array, items: { type: string } }
        usage:
          type: object
          required: [input_tokens, output_tokens]
          properties:
            input_tokens: { type: integer }
            output_tokens: { type: integer }
        sources: { type: array, items: { $ref: "#/components/schemas/AssetSourceRef" } }
        version: { type: [integer, "null"], description: the version this run wrote (agent or draft) }
        comparison:
          type: [object, "null"]
          description: >-
            The last compare_to_cloud result: {cloud_id, transform {origin, yaw_deg}, overall {n, median_mm,
            p95_mm}, parts [{id, n, median_mm, p95_mm}], inlier_share, points_used}.
        started_at: { type: string, format: date-time }
        ended_at: { type: [string, "null"], format: date-time }
    AssetModelRunList:
      type: object
      required: [items]
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/AssetModelRun" } }
    AssetModelRunStart:
      type: object
      additionalProperties: false
      required: [mode, sources, provider]
      properties:
        mode: { type: string, enum: [build, refine] }
        sources: { type: array, minItems: 1, maxItems: 50, items: { $ref: "#/components/schemas/AssetSourceRef" } }
        provider: { $ref: "#/components/schemas/KeyedProviderName" }
        model_name: { type: [string, "null"], maxLength: 120 }
        notes: { type: [string, "null"], maxLength: 4000 }
    AssetModelRunWithJob:
      type: object
      required: [run, job]
      properties:
        run: { $ref: "#/components/schemas/AssetModelRun" }
        job: { $ref: "#/components/schemas/Job" }
```

Then:
- add `asset_model` to `DataItemType`'s enum;
- add `asset_model_glb, asset_model_run` to the end of `JobType`'s enum, and extend `Job.result`'s description: "`asset_model_glb` {model_id, version}; `asset_model_run` {run_id, version}";
- add `asset_models.changed` to `Event.type`'s enum, and name its payload `{asset_model_ids: [...]}` in that schema's description.

- [ ] **Step 3: Lint, regenerate, and update the client helpers**

Run: `pnpm -C contract lint`
Expected: 0 errors. If `oas3-unused-component` flags a schema, it isn't referenced: fix the reference rather than adding an override.

Run: `pnpm -C contract generate`

Add to `contract/client/index.ts`, next to the other aliases and URL helpers (follow `imageFileUrl`'s exact style for the token query):

```ts
export type KeyedProviderName = Schemas["KeyedProviderName"];
export type AssetModel = Schemas["AssetModel"];
export type AssetModelVersion = Schemas["AssetModelVersion"];
export type AssetModelVersionDetail = Schemas["AssetModelVersionDetail"];
export type AssetSpec = Schemas["AssetSpec"];
export type AssetPart = Schemas["AssetPart"];
export type SpecIssue = Schemas["SpecIssue"];
export type AssetSourceRef = Schemas["AssetSourceRef"];
export type AssetModelRun = Schemas["AssetModelRun"];
export type AssetModelRunStep = Schemas["AssetModelRunStep"];
export type AssetModelRunStart = Schemas["AssetModelRunStart"];

export function assetModelGlbUrl(baseUrl: string, token: string, projectId: string, assetModelId: string, version: number): string {
  const p = `/api/v1/projects/${encodeURIComponent(projectId)}/asset-models/${encodeURIComponent(assetModelId)}`;
  return `${baseUrl}${p}/versions/${version}/glb?token=${encodeURIComponent(token)}`;
}

export function assetModelOverlayUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, runId: string, cloudId: string,
): string {
  const p = `/api/v1/projects/${encodeURIComponent(projectId)}/asset-models/${encodeURIComponent(assetModelId)}`;
  return `${baseUrl}${p}/runs/${encodeURIComponent(runId)}/overlay/${encodeURIComponent(cloudId)}?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Keep the frontend compiling**

Run: `pnpm -C frontend build`
Expected: `tsc` errors only where a `Record<DataItemType, …>` or `Record<JobType, …>` is now missing a key. Add the entries:
- `src/app/paletteCommands.ts`: `DATA_LABEL.asset_model = "Asset model"`, `DATA_ICON.asset_model = "layers"` (U6 swaps in a `cube` icon), and in `dataHref` the case `asset_model` → `` `/p/${projectId}/models/${id}` `` (the route arrives in U6).
- `src/reports/ReportFilters.tsx`: `DATA_ICON.asset_model = "layers"`.
- `src/jobs/JobCard.tsx` (if its map is exhaustive): `asset_model_glb: "layers"`, `asset_model_run: "layers"`.
- Any other file `tsc` names: add the same kind of entry. Don't widen types to `Partial`.

Re-run `pnpm -C frontend build` and `pnpm -C frontend test`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts frontend/src/app/paletteCommands.ts frontend/src/reports/ReportFilters.tsx
# plus each other frontend file Step 4 touched, by path
git commit -m "feat(contract): asset models, versions and runs (M1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tables, migration, folder helper

**Files:**
- Modify: `backend/app/db/models.py` (three classes after `Drawing`)
- Create: `backend/app/db/migrations/versions/0015_asset_models.py`
- Modify: `backend/app/projects/service.py` (`asset_models_dir` property next to `drawings_dir`)
- Test: `backend/tests/test_migration_0015.py`

**Interfaces:**
- Produces: ORM classes `AssetModel`, `AssetModelVersion`, `AssetModelRun`; `ProjectHandle.asset_models_dir -> Path` (`<project>/asset_models`).

- [ ] **Step 1: Write the failing test** (copy `tests/test_migration_0014.py`'s three tests and adapt)

```python
# backend/tests/test_migration_0015.py
"""Migration 0015 (asset models): single head, up/down keeps rows, ORM matches the migration."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory

from app.db.models import AssetModel, AssetModelRun, AssetModelVersion  # noqa: F401 - ORM registered
# Reuse 0014's helpers for config/engine; import them the way test_migration_0014.py builds them.
from test_migration_0014 import alembic_config, project_engine  # noqa: F401  (adapt names to that file)


def test_single_head_is_0015():
    heads = ScriptDirectory.from_config(alembic_config()).get_heads()
    assert heads == ["0015"]


def test_tables_exist_after_upgrade(tmp_path):
    engine = project_engine(tmp_path)  # upgraded to head
    names = set(engine.dialect.get_table_names(engine.connect()))
    assert {"asset_model", "asset_model_version", "asset_model_run"} <= names


def test_orm_matches_migration(tmp_path):
    from app.db.base import Base

    engine = project_engine(tmp_path)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    ours = [d for d in diff if "asset_model" in str(d)]
    assert ours == []
```

If `test_migration_0014.py` builds its config and engine inline rather than through importable helpers, copy those few lines into this file instead of importing. Keep the three assertions.

- [ ] **Step 2: Run it to verify it fails**

Run: `$PY -m pytest tests/test_migration_0015.py -v`
Expected: FAIL on `ImportError: cannot import name 'AssetModel'`

- [ ] **Step 3: Implement the ORM classes** (append after `Drawing` in `app/db/models.py`)

```python
class AssetModel(Base):
    """A part-by-part model of an inspected asset (spec 2026-10-02-asset-model-builder §5)."""

    __tablename__ = "asset_model"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    asset_type: Mapped[str | None] = mapped_column(String, nullable=True)
    tag: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="empty")  # empty | building | ready
    current_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    live_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    captured_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_asset_model_created", "created_at", "id"),)


class AssetModelVersion(Base):
    """One immutable spec of an asset model, and its GLB (spec §5). Never overwritten."""

    __tablename__ = "asset_model_version"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("asset_model.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    spec: Mapped[dict] = mapped_column(JSON)
    kind: Mapped[str] = mapped_column(String)  # agent | manual | draft
    glb_status: Mapped[str] = mapped_column(String, default="pending")  # pending | ready | failed
    glb_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source_ids: Mapped[list] = mapped_column(JSON, default=list)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    part_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("model_id", "version", name="uq_asset_model_version"),)


class AssetModelRun(Base):
    """One agent run over an asset model (spec §5). Steps hold tool names and app-written summaries
    only - never prompts, model output or tool payloads."""

    __tablename__ = "asset_model_run"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("asset_model.id", ondelete="CASCADE"))
    job_id: Mapped[str] = mapped_column(String(36))
    provider: Mapped[str] = mapped_column(String)
    model_name: Mapped[str] = mapped_column(String)
    mode: Mapped[str] = mapped_column(String)  # build | refine
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    state: Mapped[str] = mapped_column(String, default="running")  # running | finished | stopped | failed
    stop_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    phase: Mapped[str] = mapped_column(String, default="sampling")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    open_questions: Mapped[list] = mapped_column(JSON, default=list)
    usage: Mapped[dict] = mapped_column(JSON, default=lambda: {"input_tokens": 0, "output_tokens": 0})
    sources: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comparison: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # last compare_to_cloud result
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (Index("ix_asset_model_run_model", "model_id", "started_at"),)
```

Add `ForeignKey` and `UniqueConstraint` to the `sqlalchemy` import if they aren't already there.

In `app/projects/service.py`, next to `drawings_dir`:

```python
    asset_models_dir = property(lambda s: s.folder / "asset_models")
```

- [ ] **Step 4: Write the migration** (`0015_asset_models.py`, in 0014's exact header style)

```python
"""asset models (spec 2026-10-02-asset-model-builder §5)

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-02
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_model",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("asset_type", sa.String(), nullable=True),
        sa.Column("tag", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=True),
        sa.Column("live_run_id", sa.String(36), nullable=True),
        sa.Column("captured_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_asset_model_created", "asset_model", ["created_at", "id"])
    op.create_table(
        "asset_model_version",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("model_id", sa.String(36), sa.ForeignKey("asset_model.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("spec", sa.JSON(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("glb_status", sa.String(), nullable=False),
        sa.Column("glb_job_id", sa.String(36), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column("source_ids", sa.JSON(), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("part_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("model_id", "version", name="uq_asset_model_version"),
    )
    op.create_table(
        "asset_model_run",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("model_id", sa.String(36), sa.ForeignKey("asset_model.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model_name", sa.String(), nullable=False),
        sa.Column("mode", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("stop_reason", sa.String(), nullable=True),
        sa.Column("phase", sa.String(), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("summary", sa.String(), nullable=True),
        sa.Column("open_questions", sa.JSON(), nullable=False),
        sa.Column("usage", sa.JSON(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=True),
        sa.Column("comparison", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_asset_model_run_model", "asset_model_run", ["model_id", "started_at"])


def downgrade() -> None:
    op.drop_index("ix_asset_model_run_model", table_name="asset_model_run")
    op.drop_table("asset_model_run")
    op.drop_table("asset_model_version")
    op.drop_index("ix_asset_model_created", table_name="asset_model")
    op.drop_table("asset_model")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_migration_0015.py tests/test_migration_0014.py -v`
Expected: PASS. 0014's single-head test now fails because the head is 0015: update its assertion to look for 0014 among the history rather than as the head, in the same way 0014 updated 0013's test (check `git log -p tests/test_migration_0013.py` for the precedent).

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0015_asset_models.py backend/app/projects/service.py backend/tests/test_migration_0015.py backend/tests/test_migration_0014.py
git commit -m "feat(asset-models): tables and migration 0015

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store, service, schemas, models and versions routes, run stubs

**Files:**
- Create: `backend/app/asset_models/schemas.py`, `store.py`, `service.py`, `router.py`, `stubs.py`
- Modify: `backend/app/api.py` (add `"app.asset_models.router"` and `"app.asset_models.stubs"` to the guarded `for _module in (...)` loop that holds pointclouds, each on its own line with a comment)
- Modify: `backend/app/events_util.py` (`publish_asset_models_changed`)
- Modify: `backend/tests/test_contract.py` (`EXPECTED_STUBS |= asset_models_stub_operation_ids()`)
- Test: `backend/tests/test_asset_models_api.py`

**Interfaces:**
- Consumes: `AssetSpec` and `validate` (U1). If U1 isn't merged yet, Tasks 3's spec validation imports from `app.asset_models.spec`/`validate`: rebase onto `main` after U1 lands, before running this task's tests.
- Produces:
  - `store.model_dir(handle, model_id) -> Path`; `store.version_glb_path(handle, model_id, version) -> Path`; `store.run_dir(handle, model_id, run_id) -> Path`
  - `store.get_model(s, model_id) -> AssetModel` (404 `not_found`); `store.get_version(s, model_id, version) -> AssetModelVersion` (404)
  - `store.next_version_number(s, model_id) -> int`
  - `service.add_version(handle, runner, model_id, spec: AssetSpec, *, kind, note=None, source_ids=(), run_id=None) -> tuple[AssetModelVersion, Job]`: validates, inserts, sets `current_version` and `status="ready"` (unless a run is live, which keeps `building`), and submits `asset_model_glb`. Raises `AppError("invalid_spec", …, 422, {"errors": [...]})`.
  - `service.refresh_status(model) -> None`: `building` if `live_run_id`, else `ready` if `current_version`, else `empty`. It mutates the row; the caller's session commits it.
  - `service.issues(list[Issue]) -> list[dict]`
  - `events_util.publish_asset_models_changed(request_or_ctx, handle, ids)`
  - `stubs.stub_operation_ids() -> set[str]`
  - API schemas mirroring the contract: `AssetModelOut`, `AssetModelCreate`, `AssetModelPatch`, `AssetModelVersionOut`, `AssetModelVersionDetailOut`, `AssetModelVersionCreate`, `AssetModelVersionWithJob`, `SpecIssueOut`, `AssetSourceRef`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_models_api.py
"""Asset models and versions over HTTP (spec §5, §9)."""

import pytest

BASE = "/api/v1/projects/{pid}/asset-models"

SPEC = {"asset": {"tag": "T-1"}, "parts": [
    {"id": "shell", "name": "Shell", "group": "Shell", "shape": "cylinder",
     "params": {"id": 4000, "thickness": 8, "height": 8000}, "source": {"kind": "drawing", "id": "d1"}},
]}


@pytest.fixture
def base(project_id):
    return BASE.format(pid=project_id)


def create(client, base, **body):
    r = client.post(base, json={"name": "HCl tank", **body})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_list_get_patch(client, base):
    m = create(client, base, tag="710-D-130335")
    assert m["status"] == "empty" and m["current_version"] is None and m["live_run_id"] is None
    assert [x["id"] for x in client.get(base).json()["items"]] == [m["id"]]
    r = client.patch(f"{base}/{m['id']}", json={"name": "Tank A"})
    assert r.status_code == 200 and r.json()["name"] == "Tank A"
    assert client.get(f"{base}/missing").status_code == 404


def test_manual_version_queues_a_glb_and_marks_ready(client, base, project_id, wait_job):
    m = create(client, base)
    r = client.post(f"{base}/{m['id']}/versions", json={"spec": SPEC, "note": "first"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"]["version"] == 1 and body["version"]["kind"] == "manual"
    assert body["version"]["part_count"] == 1
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded"
    v = client.get(f"{base}/{m['id']}/versions/1").json()
    assert v["glb_status"] == "ready" and v["spec"]["parts"][0]["id"] == "shell"
    assert v["meta"]["top_m"] == pytest.approx(8.0)
    glb = client.get(f"{base}/{m['id']}/versions/1/glb")
    assert glb.status_code == 200 and glb.content[:4] == b"glTF"
    assert glb.headers["content-type"].startswith("model/gltf-binary")
    model = client.get(f"{base}/{m['id']}").json()
    assert model["status"] == "ready" and model["current_version"] == 1


def test_invalid_spec_is_422_with_errors(client, base):
    m = create(client, base)
    bad = {"parts": [SPEC["parts"][0], SPEC["parts"][0]]}  # duplicate id
    r = client.post(f"{base}/{m['id']}/versions", json={"spec": bad})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_spec"
    assert err["details"]["errors"][0]["code"] == "duplicate_id"
    assert client.get(f"{base}/{m['id']}/versions").json()["items"] == []


def test_versions_are_never_overwritten_and_restore_adds_one(client, base, project_id, wait_job):
    m = create(client, base)
    v1 = client.post(f"{base}/{m['id']}/versions", json={"spec": SPEC}).json()
    wait_job(project_id, v1["job"]["id"])
    taller = {**SPEC, "parts": [{**SPEC["parts"][0], "params": {"id": 4000, "thickness": 8, "height": 9000}}]}
    v2 = client.post(f"{base}/{m['id']}/versions", json={"spec": taller}).json()
    wait_job(project_id, v2["job"]["id"])
    r = client.post(f"{base}/{m['id']}/versions/1/restore")
    assert r.status_code == 201
    v3 = r.json()["version"]
    assert v3["version"] == 3 and v3["note"] == "Restored from version 1"
    items = client.get(f"{base}/{m['id']}/versions").json()["items"]
    assert [i["version"] for i in items] == [3, 2, 1]
    assert client.get(f"{base}/{m['id']}/versions/2").json()["spec"]["parts"][0]["params"]["height"] == 9000


def test_glb_not_ready_is_409(client, base, handle):
    from app.db.models import AssetModelVersion

    m = create(client, base)
    with handle.session() as s:  # a version whose GLB job has not run
        s.add(AssetModelVersion(model_id=m["id"], version=1, spec=SPEC, kind="manual", glb_status="pending",
                                source_ids=[], part_count=1))
    r = client.get(f"{base}/{m['id']}/versions/1/glb")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_delete_removes_rows_and_folder(client, base, handle, project_id, wait_job):
    m = create(client, base)
    v = client.post(f"{base}/{m['id']}/versions", json={"spec": SPEC}).json()
    wait_job(project_id, v["job"]["id"])
    folder = handle.asset_models_dir / m["id"]
    assert folder.exists()
    assert client.delete(f"{base}/{m['id']}").status_code == 204
    assert not folder.exists()
    assert client.get(f"{base}/{m['id']}").status_code == 404


def test_run_operations_are_501_until_u5(client, base):
    m = create(client, base)
    r = client.get(f"{base}/{m['id']}/runs")
    assert r.status_code == 501
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_models_api.py -v`
Expected: FAIL with 404s (no routes)

- [ ] **Step 3: Implement `schemas.py`**

```python
# backend/app/asset_models/schemas.py
"""API shapes for asset models (contract: AssetModel*, SpecIssue, AssetSourceRef)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.asset_models.spec import AssetSpec
from app.jobs.schemas import JobOut


class AssetSourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["drawing", "point_cloud", "image"]
    id: str


class AssetModelOut(BaseModel):
    id: str
    name: str
    asset_type: str | None
    tag: str | None
    status: Literal["empty", "building", "ready"]
    current_version: int | None
    live_run_id: str | None
    captured_on: date | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, row) -> AssetModelOut:
        return cls.model_validate(row, from_attributes=True)


class AssetModelList(BaseModel):
    items: list[AssetModelOut]


class AssetModelCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    asset_type: str | None = Field(None, max_length=80)
    tag: str | None = Field(None, max_length=80)


class AssetModelPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=120)
    asset_type: str | None = Field(None, max_length=80)
    tag: str | None = Field(None, max_length=80)
    captured_on: date | None = None


class SpecIssueOut(BaseModel):
    code: str
    part_id: str | None
    message: str


class AssetModelVersionOut(BaseModel):
    id: str
    model_id: str
    version: int
    kind: Literal["agent", "manual", "draft"]
    glb_status: Literal["pending", "ready", "failed"]
    source_ids: list[AssetSourceRef]
    run_id: str | None
    note: str | None
    part_count: int
    meta: dict | None
    created_at: datetime

    @classmethod
    def of(cls, row) -> AssetModelVersionOut:
        return cls.model_validate(row, from_attributes=True)


class AssetModelVersionList(BaseModel):
    items: list[AssetModelVersionOut]


class AssetModelVersionDetailOut(AssetModelVersionOut):
    spec: AssetSpec
    warnings: list[SpecIssueOut]


class AssetModelVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    spec: AssetSpec
    note: str | None = Field(None, max_length=500)


class AssetModelVersionWithJob(BaseModel):
    version: AssetModelVersionOut
    job: JobOut
```

- [ ] **Step 4: Implement `store.py` and `service.py`**

```python
# backend/app/asset_models/store.py
"""Rows and folders for asset models (spec §5). `<project>/asset_models/<model_id>/v<n>.glb`,
`<project>/asset_models/<model_id>/runs/<run_id>/`."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import AssetModel, AssetModelVersion
from app.errors import not_found
from app.surfaces.design.store import ID_RE


def model_dir(handle, model_id: str) -> Path:
    if not ID_RE.fullmatch(model_id or ""):
        raise not_found("asset model", model_id)
    return Path(handle.asset_models_dir) / model_id


def version_glb_path(handle, model_id: str, version: int) -> Path:
    return model_dir(handle, model_id) / f"v{int(version)}.glb"


def run_dir(handle, model_id: str, run_id: str) -> Path:
    if not ID_RE.fullmatch(run_id or ""):
        raise not_found("asset model run", run_id)
    return model_dir(handle, model_id) / "runs" / run_id


def get_model(s: Session, model_id: str) -> AssetModel:
    row = s.get(AssetModel, model_id)
    if row is None:
        raise not_found("asset model", model_id)
    return row


def get_version(s: Session, model_id: str, version: int) -> AssetModelVersion:
    row = s.scalar(select(AssetModelVersion).where(
        AssetModelVersion.model_id == model_id, AssetModelVersion.version == version))
    if row is None:
        raise not_found("asset model version", f"{model_id}/v{version}")
    return row


def next_version_number(s: Session, model_id: str) -> int:
    return (s.scalar(select(func.max(AssetModelVersion.version)).where(AssetModelVersion.model_id == model_id)) or 0) + 1
```

```python
# backend/app/asset_models/service.py
"""Adding versions (spec §5, D6): validate, insert, point the model at it, queue its GLB."""

from __future__ import annotations

from app.asset_models import store
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate
from app.db.models import AssetModelVersion
from app.errors import AppError

GLB_JOB = "asset_model_glb"


def issues(report_list) -> list[dict]:
    return [{"code": i.code, "part_id": i.part_id, "message": i.message} for i in report_list]


def refresh_status(model) -> None:
    model.status = "building" if model.live_run_id else ("ready" if model.current_version else "empty")


def add_version(handle, runner, model_id: str, spec: AssetSpec, *, kind: str, note: str | None = None,
                source_ids=(), run_id: str | None = None):
    report = validate(spec)
    if not report.ok:
        raise AppError("invalid_spec", "The model spec has errors.", 422, {"errors": issues(report.errors)})
    with handle.session() as s:
        model = store.get_model(s, model_id)
        n = store.next_version_number(s, model_id)
        row = AssetModelVersion(
            model_id=model_id, version=n, spec=spec.model_dump(mode="json"), kind=kind, glb_status="pending",
            source_ids=[dict(x) for x in source_ids], run_id=run_id, note=note, part_count=len(spec.parts),
        )
        s.add(row)
        model.current_version = n
        refresh_status(model)
        s.flush()
        s.expunge(row)
    job = runner.submit(handle, GLB_JOB, {"model_id": model_id, "version": n})
    with handle.session() as s:
        store.get_version(s, model_id, n).glb_job_id = job.id
    return row, job
```

- [ ] **Step 5: Implement `router.py` and `stubs.py`**

```python
# backend/app/asset_models/router.py
"""Asset models and versions (spec §9). Runs are routed by `stubs.py` until U5."""

from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.asset_models import jobs_glb as _jobs  # noqa: F401 - registers `asset_model_glb`
from app.asset_models import service, store
from app.asset_models.schemas import (
    AssetModelCreate, AssetModelList, AssetModelOut, AssetModelPatch, AssetModelVersionCreate,
    AssetModelVersionDetailOut, AssetModelVersionList, AssetModelVersionOut, AssetModelVersionWithJob, SpecIssueOut,
)
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate
from app.db.models import AssetModel, AssetModelVersion
from app.errors import AppError
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
P = "/asset-models"


@router.get(P, response_model=AssetModelList)
def list_asset_models(handle: ProjectHandle = Depends(get_project)):
    with handle.session() as s:
        rows = s.scalars(select(AssetModel).order_by(AssetModel.created_at.desc(), AssetModel.id)).all()
        return AssetModelList(items=[AssetModelOut.of(r) for r in rows])


@router.post(P, response_model=AssetModelOut, status_code=201)
def create_asset_model(body: AssetModelCreate, request: Request, handle: ProjectHandle = Depends(get_project)):
    with handle.session() as s:
        row = AssetModel(name=body.name, asset_type=body.asset_type, tag=body.tag, status="empty")
        s.add(row)
        s.flush()
        out = AssetModelOut.of(row)
    publish_asset_models_changed(request, handle, [out.id])
    return out


@router.get(P + "/{assetModelId}", response_model=AssetModelOut)
def get_asset_model(assetModelId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        return AssetModelOut.of(store.get_model(s, assetModelId))


@router.patch(P + "/{assetModelId}", response_model=AssetModelOut)
def patch_asset_model(assetModelId: str, body: AssetModelPatch, request: Request,  # noqa: N803
                      handle: ProjectHandle = Depends(get_project)):
    with handle.session() as s:
        row = store.get_model(s, assetModelId)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(row, k, v)
        s.flush()
        out = AssetModelOut.of(row)
    publish_asset_models_changed(request, handle, [assetModelId])
    return out


@router.delete(P + "/{assetModelId}", status_code=204)
def delete_asset_model(assetModelId: str, request: Request, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    jobs = request.app.state.jobs
    with handle.session() as s:
        row = store.get_model(s, assetModelId)
        live = [j for j in s.scalars(select(AssetModelVersion.glb_job_id).where(
            AssetModelVersion.model_id == assetModelId)) if j and jobs.is_live(j)]
        if row.live_run_id or live:
            raise AppError("job_running", "A run or GLB build is in progress for this model.", 409,
                           {"job_id": live[0] if live else None})
        s.delete(row)
    shutil.rmtree(store.model_dir(handle, assetModelId), ignore_errors=True)
    publish_asset_models_changed(request, handle, [assetModelId])
    return Response(status_code=204)


@router.get(P + "/{assetModelId}/versions", response_model=AssetModelVersionList)
def list_asset_model_versions(assetModelId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        store.get_model(s, assetModelId)
        rows = s.scalars(select(AssetModelVersion).where(AssetModelVersion.model_id == assetModelId)
                         .order_by(AssetModelVersion.version.desc())).all()
        return AssetModelVersionList(items=[AssetModelVersionOut.of(r) for r in rows])


@router.post(P + "/{assetModelId}/versions", response_model=AssetModelVersionWithJob, status_code=201)
def create_asset_model_version(assetModelId: str, body: AssetModelVersionCreate, request: Request,  # noqa: N803
                               handle: ProjectHandle = Depends(get_project)):
    row, job = service.add_version(handle, request.app.state.jobs, assetModelId, body.spec, kind="manual", note=body.note)
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelVersionWithJob(version=AssetModelVersionOut.of(row), job=JobOut.from_row(job, handle.id))


@router.get(P + "/{assetModelId}/versions/{version}", response_model=AssetModelVersionDetailOut)
def get_asset_model_version(assetModelId: str, version: int, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        row = store.get_version(s, assetModelId, version)
        spec = AssetSpec.model_validate(row.spec)
        warnings = [SpecIssueOut(**i) for i in service.issues(validate(spec).warnings)]
        base = AssetModelVersionOut.of(row).model_dump()
        return AssetModelVersionDetailOut(**base, spec=spec, warnings=warnings)


@router.post(P + "/{assetModelId}/versions/{version}/restore", response_model=AssetModelVersionWithJob, status_code=201)
def restore_asset_model_version(assetModelId: str, version: int, request: Request,  # noqa: N803
                                handle: ProjectHandle = Depends(get_project)):
    with handle.session() as s:
        old = store.get_version(s, assetModelId, version)
        spec = AssetSpec.model_validate(old.spec)
        sources = list(old.source_ids)
    row, job = service.add_version(handle, request.app.state.jobs, assetModelId, spec, kind="manual",
                                   note=f"Restored from version {version}", source_ids=sources)
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelVersionWithJob(version=AssetModelVersionOut.of(row), job=JobOut.from_row(job, handle.id))


@router.get(P + "/{assetModelId}/versions/{version}/glb", response_class=FileResponse)
def get_asset_model_glb(assetModelId: str, version: int, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        row = store.get_version(s, assetModelId, version)
        ready = row.glb_status == "ready"
    path = store.version_glb_path(handle, assetModelId, version)
    if not ready or not path.exists():
        raise AppError("not_ready", "The 3D model for this version is not built yet.", 409)
    return FileResponse(path, media_type="model/gltf-binary", headers={"Cache-Control": "private, max-age=3600"})
```

```python
# backend/app/asset_models/stubs.py
"""501 placeholders for the run operations until U5 (Foundation's contract-first pattern).
U5 deletes this module, its line in app/api.py and the EXPECTED_STUBS line in test_contract.py."""

from fastapi import APIRouter

from app.stubs import add_stubs

M = "/asset-models/{assetModelId}/runs"
STUBS: list[tuple[str, str, str]] = [
    ("POST", M, "startAssetModelRun"),
    ("GET", M, "listAssetModelRuns"),
    ("GET", M + "/{runId}", "getAssetModelRun"),
    ("POST", M + "/{runId}/stop", "stopAssetModelRun"),
    ("GET", M + "/{runId}/steps/{step}/thumb", "getAssetModelRunThumb"),
    ("GET", M + "/{runId}/overlay/{cloudId}", "getAssetModelRunOverlay"),
]

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
add_stubs(router, STUBS)


def stub_operation_ids() -> set[str]:
    return {name for _, _, name in STUBS}
```

`events_util.py`, next to `publish_drawings_changed`:

```python
def publish_asset_models_changed(request, handle, ids) -> None:
    _publish_ids_changed(request, handle, "asset_models.changed", "asset_model_ids", ids)
```

`app/api.py`: add both modules to the guarded loop at about lines 146–155, each on its own line with the comment `# asset models (spec 2026-10-02); trimesh is native`.

`tests/test_contract.py`:
- Import `from app.asset_models.stubs import stub_operation_ids as asset_models_stub_operation_ids` and add `EXPECTED_STUBS |= asset_models_stub_operation_ids()  # asset models U3; U5 removes`.
- Add to `REFUSES_VALID_DATA` (business-rule refusals of schema-valid requests; every status is declared in the contract):
  - `"createAssetModelVersion": {422}` (a schema-valid spec with duplicate ids is `invalid_spec`)
  - `"getAssetModelGlb": {409}`
  - `"deleteAssetModel": {409}`
  - U5 adds `"startAssetModelRun": {409, 422}`.

- [ ] **Step 6: Run the API tests**

Run: `$PY -m pytest tests/test_asset_models_api.py -v`
Expected: every test except the GLB-dependent ones passes. Those need Task 4.

- [ ] **Step 7: Commit (together with Task 4 if both are green; otherwise commit after Task 4)**

---

### Task 4: GLB job, startup sweep, data item

**Files:**
- Create: `backend/app/asset_models/jobs_glb.py`, `backend/app/asset_models/startup.py`
- Modify: `backend/app/main.py` (sweep list: `("interrupted asset model sweep", sweep("app.asset_models.startup"))` after the drawings entry)
- Modify: `backend/app/data_items/providers.py` (`AssetModels` provider), `backend/app/data_items/schemas.py` (`DataItemType` += `"asset_model"`)
- Modify: every backend place that enumerates data item types next to `point_cloud`. Find them with `grep -rn "point_cloud" backend/app/overview backend/app/reports/sections/appendix.py backend/app/setup/builtins.py`, and add `asset_model` alongside where the code needs one entry per type: counts, labels, icons. Setup slots don't take asset models: leave `builtins.py` alone unless a type-completeness test fails.
- Test: `backend/tests/test_asset_models_glb_job.py`, `backend/tests/test_asset_models_data_item.py`

**Interfaces:**
- Produces:
  - job type `asset_model_glb`, params `{model_id, version}`, result `{model_id, version}`. On success: `glb_status="ready"`, `meta` set, `v<n>.glb` written atomically, `asset_models.changed` published. On failure: `glb_status="failed"`, the job failed with message "The 3D model could not be built: <reason>".
  - `startup.sweep_interrupted(handle, runner)`: a `pending` version whose `glb_job_id` isn't live becomes `failed`, and its model status is recomputed. U5 extends it for runs.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_models_glb_job.py
"""The asset_model_glb job (spec §6.4): atomic file, meta, failure state, restart sweep."""

from app.asset_models import startup, store
from app.asset_models.jobs_glb import run_glb
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelVersion

SPEC = {"parts": [{"id": "s", "name": "s", "group": "Shell", "shape": "cylinder",
                   "params": {"id": 1000, "thickness": 10, "height": 2000}, "source": {"kind": "assumed"}}]}


class Ctx:
    def __init__(self, handle, params):
        self.project, self.params, self.job_id = handle, params, "job-glb"
        self.published = []

    def progress(self, *_a):
        pass

    def publish(self, type, payload):
        self.published.append((type, payload))

    def check_cancelled(self):
        pass


def seed(handle, spec=SPEC, glb_job_id=None):
    with handle.session() as s:
        m = AssetModel(name="m", status="ready", current_version=1)
        s.add(m)
        s.flush()
        s.add(AssetModelVersion(model_id=m.id, version=1, spec=spec, kind="manual", glb_status="pending",
                                source_ids=[], part_count=len(spec["parts"]), glb_job_id=glb_job_id))
        return m.id


def test_job_writes_glb_and_meta(handle):
    mid = seed(handle)
    ctx = Ctx(handle, {"model_id": mid, "version": 1})
    assert run_glb(ctx) == {"model_id": mid, "version": 1}
    path = store.version_glb_path(handle, mid, 1)
    assert path.read_bytes()[:4] == b"glTF"
    assert not list(path.parent.glob("*.tmp"))
    with handle.session() as s:
        v = store.get_version(s, mid, 1)
        assert v.glb_status == "ready" and v.meta["top_m"] == 2.0
    assert ("asset_models.changed", {"asset_model_ids": [mid]}) in ctx.published


def test_job_failure_marks_version_failed(handle, monkeypatch):
    mid = seed(handle)
    import app.asset_models.jobs_glb as jg

    def boom(_spec):
        raise RuntimeError("no mesh")

    monkeypatch.setattr(jg, "build_glb", boom)
    try:
        run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    except Exception as e:  # JobFailure
        assert "could not be built" in str(e)
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"


def test_sweep_fails_orphaned_pending_glb(handle, app):
    mid = seed(handle, glb_job_id="gone")
    startup.sweep_interrupted(handle, app.state.jobs)
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"


def test_spec_used_is_the_stored_one(handle):
    assert AssetSpec.model_validate(SPEC).parts[0].id == "s"
```

```python
# backend/tests/test_asset_models_data_item.py
"""Asset models in the project data list (spec §5)."""


def test_asset_model_is_listed_as_a_data_item(client, project_id):
    client.post(f"/api/v1/projects/{project_id}/asset-models", json={"name": "Tank"})
    items = client.get(f"/api/v1/projects/{project_id}/data", params={"type": "asset_model"}).json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["type"] == "asset_model" and item["label"] == "Tank"
    assert item["status"] == "ready" and item["summary"]["versions"] == 0
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_models_glb_job.py tests/test_asset_models_data_item.py -v`
Expected: FAIL (`ModuleNotFoundError`, and an unknown data type)

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/jobs_glb.py
"""`asset_model_glb` (spec §6.4): build the GLB of one stored version, atomically."""

from __future__ import annotations

import os

from app.asset_models import store
from app.asset_models.build import build_glb
from app.asset_models.spec import AssetSpec
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

GLB_JOB = "asset_model_glb"


@register_job_type(GLB_JOB)
def run_glb(ctx) -> dict:
    mid, n = ctx.params["model_id"], int(ctx.params["version"])
    ctx.progress(0, f"Building the 3D model for version {n}")
    with ctx.project.session() as s:
        spec = AssetSpec.model_validate(store.get_version(s, mid, n).spec)
    out = store.version_glb_path(ctx.project, mid, n)
    try:
        glb, meta = build_glb(spec)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(out.name + ".tmp")
        tmp.write_bytes(glb)
        os.replace(tmp, out)
    except Exception as e:
        with ctx.project.session() as s:
            store.get_version(s, mid, n).glb_status = "failed"
        ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
        raise JobFailure(f"The 3D model could not be built: {type(e).__name__}") from None
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        v.glb_status, v.meta = "ready", meta
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Built version {n}: {meta['triangles']:,} triangles")
    return {"model_id": mid, "version": n}
```

The failure message carries the exception type only. A trimesh message could include file paths, and the job error is shown in the UI.

```python
# backend/app/asset_models/startup.py
"""Restart sweep for asset models (spec §7.2 step 5; Review Focus 4). Called on project open."""

from __future__ import annotations

from sqlalchemy import select

from app.asset_models.service import refresh_status
from app.db.models import AssetModel, AssetModelVersion


def sweep_interrupted(handle, runner) -> None:
    with handle.session() as s:
        touched = set()
        for v in s.scalars(select(AssetModelVersion).where(AssetModelVersion.glb_status == "pending")):
            if not (v.glb_job_id and runner.is_live(v.glb_job_id)):
                v.glb_status = "failed"
                touched.add(v.model_id)
        for m in s.scalars(select(AssetModel).where(AssetModel.id.in_(touched))):
            refresh_status(m)
```

Data item provider (append to `app/data_items/providers.py`, after `Drawings`):

```python
class AssetModels(_Provider):
    type = "asset_model"

    def columns(self):
        return AssetModel.captured_on, AssetModel.created_at, AssetModel.id, AssetModel.name

    def base(self):
        return select(AssetModel)

    def count_query(self):
        return select(func.count()).select_from(AssetModel)

    def item(self, row) -> DataItem:
        (m,) = row
        status = "importing" if m.status == "building" else "ready"
        return DataItem(id=m.id, type="asset_model", label=m.name, captured_on=m.captured_on, status=status,
                        created_at=m.created_at,
                        summary={"versions": m.current_version or 0, "tag": m.tag, "asset_type": m.asset_type})


PROVIDERS["asset_model"] = AssetModels()
```

Add `AssetModel` to the models import, and `"asset_model"` to `DataItemType` in `app/data_items/schemas.py`. In `main.py`'s `project_opened` sweep list, add the asset models entry after the drawings one.

- [ ] **Step 4: Run all U3 tests and the contract test**

Run: `$PY -m pytest tests/test_asset_models_*.py tests/test_migration_0015.py tests/test_contract.py -v`
Expected: PASS. If schemathesis finds a 500 on a generated spec body (e.g. a nozzle with a `host` that makes placement raise a non-`PlacementError`), fix it in U1's validation and add the failing example as a U1 test. Never add a schemathesis exclusion for a 500.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/schemas.py backend/app/asset_models/store.py backend/app/asset_models/service.py backend/app/asset_models/router.py backend/app/asset_models/stubs.py backend/app/asset_models/jobs_glb.py backend/app/asset_models/startup.py backend/app/api.py backend/app/main.py backend/app/events_util.py backend/app/data_items/providers.py backend/app/data_items/schemas.py backend/tests/test_asset_models_api.py backend/tests/test_asset_models_glb_job.py backend/tests/test_asset_models_data_item.py backend/tests/test_contract.py
# plus the overview/report files Step 4 of Task 4 touched, by path
git commit -m "feat(asset-models): models and versions API, GLB job, data item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Land

- [ ] **Step 1:** Run the full gate: `pnpm -C contract check`; `ruff check .`; `ruff format --check .`; `pytest`; `pnpm -C frontend lint`; `pnpm -C frontend test`; `pnpm -C frontend build`; `pnpm -C frontend e2e`. Expected: all green.
- [ ] **Step 2:** Grep the packaging scripts for nothing retired: this unit adds routes and renames none, so `backend/scripts/*.ps1` needs no change (ADR 2026-09-28 retired-routes). Confirm with `git diff main --stat -- backend/scripts`, which should be empty.
- [ ] **Step 3:** `scripts\finish-task.ps1`, or the manual fallback described in U1 Task 6.
