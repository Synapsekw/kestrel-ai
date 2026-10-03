# Findings on the asset (artifact port phase 1): implementation plan index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **How the plan is laid out.** Each unit has its own plan file (table below). A unit is built in its own worktree (`scripts\start-task.ps1 -Name af-<unit>`) and merged to `main` before any unit that needs it starts.

**Goal:** Findings live on an asset model, as the EBSM and DAMAC reviews do:
- posed photos look at a GLB;
- each sighting lands as a pin or a textured patch;
- repeat sightings group into one finding, with height, side, zone and component;
- the register, Overview, CSV and branded PDF show the same numbers.

**Architecture:**
- **New backend package `backend/app/asset_review/`**, with one module per concern:
  - profiles, frame, derivation and findings-map geometry;
  - one module per job: GLB import, poses, placement, grouping, kit import;
  - a router.
- **Data layer.** Project migration `0016` extends `asset_model`, `asset_model_version` and `finding`, and adds `image_pose`, `image_review` and `finding_sighting`. Catalogue migration `0004` adds `brand` (package `backend/app/brands/`).
- **Frontend.**
  - The M1 GLB engine (`frontend/src/assetmodels/viewer/engine.ts`) gains placements, cameras, focus, ghost, auto-rotate, ground and view-from-pose.
  - New UI: topics in the asset workspace, a split inspection route, register columns and gallery, an Overview hero and findings-map card, and a brand editor.
- **Reports.** They gain an `asset_summary` section, asset finding pages with a rasterised 3D locator, an `asset_sightings` CSV layout, and brand overlays.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy, Alembic (per-project SQLite plus `catalogue.db`), pytest; `trimesh` (loading only; rtree is not installed, so ray casting is our own numpy caster `app.asset_review.raycast`, see amendments), numpy, scipy, Pillow, reportlab (all present); `ijson` (new, BSD).
- Frontend: React 18 and TypeScript, three 0.180 (pinned), react-konva, Vitest and Testing Library, Playwright on the Prism mock.

**Spec:** `docs/superpowers/specs/2026-10-02-asset-findings-design.md`. Parent plan: `docs/artifact-to-kestrel-plan.md`.

## Unit plans

| Unit | File | Builds |
| --- | --- | --- |
| C0 | `2026-10-03-asset-findings-c0.md` | Contract: every §8 operation and schema, 501 stubs, generated client, URL builders |
| D1 | `2026-10-03-asset-findings-d1.md` | Migration 0016, ORM models, anchor CHECK, finding schema/serialiser changes, `image_review` API |
| D2 | `2026-10-03-asset-findings-d2.md` | Catalogue 0004 `brand`, brands API, built-ins, report theme brand overlay and parity |
| P1 | `2026-10-03-asset-findings-p1.md` | Review profiles, frame model, derivation (height, bearing, side, zone), findings-map geometry and fixture |
| J1 | `2026-10-03-asset-findings-j1.md` | `asset_glb_import` job, frame conversions, silhouette, `PATCH` frame/review |
| J2 | `2026-10-03-asset-findings-j2.md` | `asset_pose` job, poses API |
| J3 | `2026-10-03-asset-findings-j3.md` | `asset_place` job, patch files, placements API |
| J4 | `2026-10-03-asset-findings-j4.md` | `asset_group` job, asset findings create/merge/split/regroup, sightings API, finding filters |
| J5 | `2026-10-03-asset-findings-j5.md` | `review_kit_import` job (dry run, replay, mask vectorising) |
| U1 | `2026-10-03-asset-findings-u1.md` | Engine additions |
| U2 | `2026-10-03-asset-findings-u2.md` | Asset workspace topics: Findings, Photos |
| U3 | `2026-10-03-asset-findings-u3.md` | Split inspection route |
| U4 | `2026-10-03-asset-findings-u4.md` | Register columns, asset source, gallery, outcome chips |
| U5 | `2026-10-03-asset-findings-u5.md` | Overview asset hero, findings map component and card |
| U6 | `2026-10-03-asset-findings-u6.md` | Brand editor |
| R1 | `2026-10-03-asset-findings-r1.md` | Report sections, 3D locator, CSV layout, brand in the PDF |
| X | this file, section "Close-out" | Synthetic end to end, acceptance runs, evidence, walkthrough |

## Global Constraints

These apply to every task in every unit.

**Contract and API**
- `contract/openapi.yaml` is the source of truth. Regenerate `contract/client/schema.d.ts` with `pnpm -C contract generate` and commit it in the same commit; never hand-edit it. `oas3-unused-component` is an error.
- Nullable contract types use `type: [X, "null"]`. Paths are `/api/v1/projects/{projectId}/...`. Path parameter names in FastAPI match the contract literally: `projectId`, `assetModelId`, `imageId`, `findingId`, `sightingId`, `brandId`.
- **Action paths are slash verbs**, as in the repo (`/findings/recount`, `/versions/{version}/restore`). This amends spec §8, which wrote `:verb`.
- Every new route is in the contract and every contract operation is routed (`backend/tests/test_contract.py`). Until its unit lands, an operation is a 501 stub in `backend/app/asset_review/stubs.py` or `backend/app/brands/stubs.py`, through `app.stubs.add_stubs`. The owning unit removes its stubs.

**Jobs and memory**
- Long work is a background job on the existing runner (`backend/app/jobs/`): `asset_glb_import`, `asset_pose`, `asset_place`, `asset_group`, `review_kit_import`. No route blocks on mesh loading, ray casting, mask reading or file copying. Each job reports progress at most every 0.25 s through `ctx.progress`, checks `ctx.check_cancelled()` per item, and is covered by the restart sweep.
- **Bounded reads:**
  - Photos are read at preview size: 2,048 px long side, through `app.imagery` helpers, never the original.
  - One mask, one photo and one patch in memory at a time.
  - `surface.json` is streamed with `ijson`.
  - The GLB's binary chunk is copied, never decoded, by `asset_glb_import`.
  - The placements index and the poses list are keyset-paged, at most 2,000 rows per page.
  - Nothing loads a whole image set.

**Frame and units**
- The asset frame is metres, Y up, X plant north, Z plant east, origin at the base centre on the ground datum.
- Bearing θ = `atan2(z, x)` in degrees, normalised to [0, 360), clockwise from plant north.
- Every stored point and normal is in this frame.

**Data rules**
- Severity import mapping: Light / Minor = 1, Moderate / Significant = 2, Heavy / Severe / Critical = 3.
- An unplaced sighting has `height_m = null`, `zone = null` and `side = null`. It never falls back to the camera target.
- **Customer data is never committed.** No file from DAMAC, EBSM or KOC (photos, masks, JSON, GLB, logos, CSV) goes into the repo. Tests use the kit's synthetic tower, generated at test time by `backend/tests/fixtures/synthetic_tower.py` (owned by P1), or hand-made fixtures.

**UI**
- Copy is sentence case, with no em or en dashes in UI copy, docs or PDF text.
- No raw colours in TSX or CSS (`frontend/scripts/check-tokens.mjs`); motion via tokens; panels use `GlassPanel`; `frontend/src/ui` primitives only. Severity colours are data, passed as `--c`.
- The three.js screens stay lazy-loaded (`src/app/lazyScreens.tsx`). `three` stays pinned at 0.180.0.

**Git and environment**
- Stage by path, never `git add -A`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend commands use `$PY = E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `backend/`.
- J5 adds `ijson`. It follows the overlay-venv rule (`vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`), adds the package to `backend/requirements.txt` and `backend/kestrel_backend.spec` with a comment, and runs `backend\scripts\build.ps1` and `backend\scripts\smoke_frozen.ps1` before merge.

**Gate before every merge** (`scripts\finish-task.ps1`):
- `pnpm -C contract check`
- `ruff check .`
- `ruff format --check .`
- `pytest`
- `pnpm -C frontend lint`
- `pnpm -C frontend test`
- `pnpm -C frontend build`
- `pnpm -C frontend e2e`

## Review Focus

These are the five inputs or conditions most likely to bite the operator that no happy-path test reaches. Each line names the test that pins it and the unit that owns it.

1. **The operator edits a finding, then presses Regroup.** The finding keeps its number, status, note, comments and attachments if it survives. If it is merged away, it is closed with a comment naming the survivor, and nothing is deleted. Pinned in J4 Task 3 (`test_regroup_preserves_operator_edits`, `test_regroup_merge_closes_with_comment`).
2. **A photo with no GPS or no gimbal yaw, or a GLB whose ray never hits.** `asset_pose` skips the photo and reports it in the job result, or aims at the axis when only yaw is missing. `asset_place` marks the sighting `none`, never a fake hit. Neither job fails as a whole. Pinned in J2 Task 2 (`test_pose_without_gps_is_skipped_and_reported`, `test_pose_without_yaw_aims_at_axis`) and J3 Task 2 (`test_ray_miss_is_none_not_error`).
3. **A kit folder whose photo names do not match the project's images,** for example images imported from a different folder or renamed. The dry run lists the unmatched photos and writes nothing, and the real run imports only the matched ones and reports the rest. Pinned in J5 Task 1 (`test_dry_run_reports_unmatched_and_writes_nothing`).
4. **Deleting the box behind a sighting, or deleting an image or an asset model that findings point at.**
   - Deleting a box removes the sighting; a finding left with none is closed, not deleted.
   - Deleting an image cascades its sightings the same way.
   - Deleting an asset model is refused with 409 `has_findings` while findings reference it.

   Pinned in J4 Task 4 (`test_box_delete_closes_empty_finding`, `test_image_delete_closes_empty_findings`) and D1 Task 3 (`test_asset_model_delete_refused_with_findings`).
5. **A 4,500-photo job in the browser.** The cameras layer, the placements index and the register stay responsive: paged fetches, at most 2,000 per page, one instanced mesh for camera glyphs, and patch binaries fetched only when visible. Pinned in U1 Task 3 (`placements.test.ts` "loads only visible patch binaries") and U2 Task 2 (`PhotosTopic.test.tsx` "pages poses").

## Spec amendments made while planning

These are folded into the spec in the same commit as this plan.

- **Action paths:** slash verbs (see Global Constraints).
- **Shared fixtures:**
  - The synthetic tower is a test-time generator (`backend/tests/fixtures/synthetic_tower.py`), ported from the kit's `examples/synthetic-tower/` (the operator's own code, no customer data). It writes a GLB, a `cameras.json`-shaped pose list and truth findings into `tmp_path`.
  - The findings-map parity fixture is `contract/fixtures/asset-findings-map.json`, owned by P1.
- **Merge and split** are synchronous routes, because they touch at most a few dozen rows. Regroup is the job.
- **Ray casting** uses a numpy first-hit caster with a cached acceleration grid (`app.asset_review.raycast`, owned by J3), not trimesh's `mesh.ray`, because `rtree` is not installed and adding it (plus embree) to the frozen sidecar buys nothing a vectorised Moller-Trumbore cannot. This amends spec §6.3 and §13.
- **Profiles and frame (from P1):** `ReviewConfig` carries the extra profile fields §7 implies (`name`, nouns, `component_map`, `facts`, `limits`, `breakdowns`, `footer_disclaimer`); `north_offset_deg` and `line_azimuth_deg` are true bearings, stored `bearing_deg` is a plant bearing, compass sides use the true bearing; zone open ends are `null`.
- **`asset_model` delete** answers 409 `has_findings` while any finding **or ungrouped sighting** references it, rather than cascading findings away.

**Rulings made while the unit plans were written** (each unit plan carries the detail):

**Data model and migration**
- **Ungrouped sightings.** `finding_sighting.finding_id` is nullable, and `finding_sighting.asset_model_id` is NOT NULL (FK RESTRICT, indexed). Sightings exist ungrouped between import or creation and grouping (D1, J4).
- **Migration 0016 rebuilds `finding` with foreign keys off,** behind a guard that refuses to run otherwise. With them on, the batch rebuild silently deletes every comment and attachment. 0016 also writes its own copy-first backup (`backups/project.db.r0016-<stamp>.bak`); before this, a backup was only taken when crossing 0010 (D1 Tasks 1 and 2, plus an ADR).

**Photo review status**
- **One effective status rule** (`app.asset_review.effective`): the review row's status, else `none` when the photo is marked empty, else `not_assessed`. The GET and the image index `review_status` filter both use it.
- **D1 owns the backend filter.** U4 Task 1 is already covered by C0 and U4 Task 8 by D1; both are skipped when found done.

**Grouping and import**
- **Photo-unit grouping:** when `review.finding_unit` is `photo`, sightings group by **photo and defect type**, never by distance or tag, in both the job and Regroup (J4).
- **Photo-unit masks** (EBSM) give one sighting per outer region:
  - regions count from 0.02% of the photo, at most 50 per photo, largest first;
  - all regions join one finding per photo;
  - in replay, the largest region carries the patch and the others are `none`;
  - each sighting's coverage is its own region; `image_review.coverage` is the whole mask's (J5).
- **The kit import groups in-process** with J4's functions instead of queuing `asset_group`, so the kit notes and the EBSM mask attachments land on the findings it creates (J5).
- **The kit import has a UI:** an "Import inspection review" dialog with a dry-run preview and class mapping (U2).

**Placement and its accuracy**
- **Placement accuracy is judged per finding.** The median of a defect's pins must be within 0.25 m of its truth centre. A single pin lands anywhere on the defect's visible surface, so a per-sighting bound cannot hold (J3 Task 4). This amends spec §12.
- **Patch file format:**
  - `.bin` is a uint32 vertex count, then Float32 positions, then Float32 uvs, little endian.
  - `.lbl` is a uint16 width and a uint16 height, then a uint8 grid with row 0 at the top (J3, U1).
- **The stored GLB is rewritten once on import:** a `kestrel_frame` root node carries the frame conversion, and the binary chunk is copied unchanged. "Never rewritten" in spec §5.2 means after import (J1).

**Brands**
- **Brand logos are app-level files** (`<catalogue root>/brand-assets/`), with `getBrandLogo`, `setBrandLogo` and `clearBrandLogo` on `/api/v1/brands/{brandId}/logos/{slot}`. They are not report assets, which belong to one project.
- **Brand fonts** are the bundled families only: Nunito Sans, Poppins and Inter (OFL, licences shipped).
- **`get_brand` takes the catalogue handle:** `get_brand(cat, brand_id)` (D2).

**Reports**
- **Report contract split:** C0 lands only `ReportConfig.brand_id`. R1 lands `csv_layout`, `asset_summary`, the four table columns and `FindingPagesOptions.min_severity` (the real schema name) in one commit with the reports code (C0 Appendix A).
- **No em or en dashes in report UI copy:** R1 fixes the source strings in `backend/app/reports/**` and `frontend/src/reports/**`, with a grep test, and keeps a draw-time `undash` as a safety net. It also stops the unembedded Helvetica and Times-Roman fonts leaking into tables and charts.

**Frontend routes and links**
- **Frontend route prefix is `models`:** split inspection is `/p/:projectId/models/:modelId/inspect?finding=`. API paths stay `asset-models`. U3 moves `findingHref` for asset findings to that route.
- **Hold-to-compare:** Space is already the global hold-to-pan key, so hold-to-compare uses its own `useHoldKey` hook on the inspection route (U3).

**PDF checks at close-out**
- `pypdf`, `pikepdf` and `qpdf` are not installed. Text is checked with `pypdfium2` and `/SMask` by a raw byte scan (reportlab writes no object streams), and the `qpdf --check` test skips.

## Execution DAG

```
C0 ──┬──> D1 ──┬──> J1 (+P1) ─┐
     │         ├──> J2 (+P1) ─┼──> J3 ──> J5 ──> X
     │         └──> J4 (+P1) ─┴──────────────┘
     ├──> D2 ──┬──> U6
     │         └──────────────────> R1 (needs D2, P1, J4; J3 for the patch outline)
     ├──> P1
     ├──> U4 (fixtures, findingHref) ──┐
     └──> U1 ──┬──> U2 (+U4) ──────────┤
               ├──> U3 (+U4) ──────────┤
               └──> U5 (+P1, D1, U4) ──┘
```

**Batches:**

| Batch | Units | Runs |
| --- | --- | --- |
| 1 | C0 | alone |
| 2 | D1, D2, P1, U1, U4 | in parallel |
| 3 | J1, J2, J4, U2, U3, U5, U6 | in parallel |
| 4 | J3, then R1 (R1's locator task reads J3's patch files; its other tasks can start with batch 3) | J3 first |
| 5 | J5 | alone |
| 6 | X | alone |

**Critical path:** C0, D1, J2, J3, J5, X.

**Phase 0 prerequisite: met.** M1 U6 and U7 and the workspace rail are merged on `main` (`8340215a`). U2 moves the asset workspace onto `WorkspaceRail` (M1 left it on floating panels).

**File ownership** (where two units could touch one file, one owns it):
- **C0** owns `contract/openapi.yaml` and `contract/client/*` for this phase. A later unit that finds a contract gap adds to it in its own commit, regenerates, and notes it in its ledger.
- **D1** owns `backend/app/db/models.py` and migration `0016`.
- **J4** owns `backend/app/findings/service.py`, `anchors.py` and `query.py` changes.
- **R1** owns `backend/app/reports/*` and `frontend/src/reports/*`, except the theme overlay and `withBrand` (D2) and the brand picker and preview cover (U6).
- **U4** owns `frontend/src/test/assetFindingFixtures.ts`; U2 and U3 add exports to it, and whichever lands second keeps one copy.

## Interfaces between units

Each unit file has the full signatures; this table is the contract between units. Python names are importable paths. TypeScript names are module exports.

**Contract (C0)**

| Producer | Name | Used by |
| --- | --- | --- |
| C0 | `importAssetModelGlb` POST `/asset-models/{assetModelId}/versions/import-glb` → 202 `AssetModelVersionWithJob` | J1, U2 |
| C0 | `patchAssetModel` (existing) gains `frame: AssetFrame \| null`, `review: AssetReviewConfig \| null`; `AssetModel` gains the same two fields | J1, P1, U2 |
| C0 | `listImagePoses` GET `/asset-models/{assetModelId}/poses?after&limit&sequence` → `ImagePoseList {items: ImagePose[], next: string \| null}` | J2, U2, U3 |
| C0 | `estimateImagePoses` POST `/asset-models/{assetModelId}/poses/estimate` `{image_ids?: string[]}` → 202 `JobRef` | J2, U2 |
| C0 | `putImagePose` PUT `/asset-models/{assetModelId}/poses/{imageId}` `ImagePoseIn` → `ImagePose` | J2 |
| C0 | `listPlacements` GET `/asset-models/{assetModelId}/placements?after&limit` → `PlacementList {version, items: Placement[], next}` | J3, U1, U2 |
| C0 | `getPlacementMesh`, `getPlacementTexture`, `getPlacementLabels` GET `/asset-models/{assetModelId}/placements/{sightingId}/mesh` (octet-stream), `/texture` (png), `/labels` (octet-stream) | J3, U1 |
| C0 | `computePlacements` POST `/asset-models/{assetModelId}/placements/compute` `{only_dirty?: boolean}` → 202 `JobRef` | J3, U2 |
| C0 | `regroupAssetFindings` POST `/asset-models/{assetModelId}/findings/regroup` → 202 `JobRef` | J4, U2 |
| C0 | `createFinding` (existing) accepts `anchor: {kind: "asset", asset_model_id, sightings: [{image_id, box: {x,y,w,h,angle}, points?: number[][]}]}` | J4, U3 |
| C0 | `mergeFinding` POST `/findings/{findingId}/merge` `{into: string}` → `Finding`; `splitFinding` POST `/findings/{findingId}/split` `{sighting_ids: string[]}` → `Finding` (the new one) | J4, U3 |
| C0 | `listFindingSightings` GET `/findings/{findingId}/sightings` → `FindingSightingList` | J4, U3 |
| C0 | `getImageReview`, `putImageReview` GET/PUT `/images/{imageId}/review` → `ImageReview` | D1, U3, U4 |
| C0 | `listFindings` gains `asset_model_id`, `zone`, `side`, `component`, `placed` (bool) filters and sorts `-height`, `zone`; `source` filter accepts `asset` | J4, U4 |
| C0 | `startReviewImport` POST `/review-imports` `ReviewImportRequest {folder, image_source_id, asset_model_id?: string, new_model_name?: string, class_map?: {[kitKey]: typeId}, dry_run: boolean}` → 202 `JobRef` (dry run result in job `result`: `ReviewImportPreview`) | J5 |
| C0 | `listBrands`, `createBrand`, `patchBrand`, `deleteBrand` on `/api/v1/brands[/{brandId}]` (app level, not per project) → `Brand`, `BrandList` | D2, U6, R1 |
| C0 | `ReportConfig.brand_id: string \| null`; `ReportFileKind` unchanged; `ReportConfig.csv_layout: "findings" \| "asset_sightings"` (default `findings`) | D2, R1 |
| C0 | `FindingsTableColumn` += `zone`, `side`, `height`, `sightings`; `SectionKey` += `asset_summary`; `FindingPagesSection.min_severity: int \| null` | R1 |
| C0 | `Finding` (out) += `asset_model_id, height_m, bearing_deg, side, zone, component, placement, sighting_count, representative: {image_id, annotation_id} \| null`; `FindingAnchorKind` += `asset`; `DataItemType` unchanged (`asset_model` exists) | D1, J4, U4 |
| C0 | `JobType` += `asset_glb_import`, `asset_pose`, `asset_place`, `asset_group`, `review_kit_import` | all jobs |
| C0 | client URL builders in `contract/client/index.ts`: `placementMeshUrl(base, token, projectId, assetModelId, sightingId)`, `placementTextureUrl(...)`, `placementLabelsUrl(...)` | U1 |

**Backend (D1, D2, P1, J1 to J5)**

| Producer | Name | Used by |
| --- | --- | --- |
| D1 | ORM `ImagePose`, `ImageReview`, `FindingSighting` in `app.db.models`; `Finding` asset columns as spec §5.5 (normal columns `an_x, an_y, an_z`); `AssetModel.frame`, `AssetModel.review` | all J |
| D1 | `app.asset_review.review_status.set_status(s: Session, image_id: str, status: str, note: str = "") -> ImageReview` (keeps `marked_empty` in step) | J5, U3 via API |
| D2 | `app.brands.store.get_brand(cat: CatalogueHandle \| None, brand_id: str \| None) -> BrandRow \| None`; `app.reports.theme.with_brand(theme: dict, brand: BrandRow \| None) -> dict` | R1 |
| P1 | `app.asset_review.frame.Frame` (pydantic: `origin: Origin \| None, north_offset_deg: float, height_m: float, datum_label: str, datum_note: str, line_azimuth_deg: float \| None, silhouette: list[tuple[float,float]], levels: list[float], presets: list[Preset]`) | J1, J2, J3, J5, R1 |
| P1 | `app.asset_review.profiles.PROFILES: dict[str, Profile]`; `resolve(profile_id: str, height_m: float, overrides: dict \| None = None) -> ReviewConfig` (pydantic, fields as spec §5.1 `review`) | J1, J3, J4, J5, R1 |
| P1 | `app.asset_review.derive.derive(center: tuple[float,float,float] \| None, normal: tuple[float,float,float] \| None, review: ReviewConfig, frame: Frame) -> Derived(height_m, bearing_deg, side, zone)` (all `None` when `center` is `None`) | J3, J4, J5 |
| P1 | `app.asset_review.findings_map.geometry(review: ReviewConfig, frame: Frame, dots: list[MapDot]) -> dict` (JSON-able; the fixture shape); TS twin `frontend/src/assetmodels/findingsMap/geometry.ts` `geometry(review, frame, dots)` | U5, R1 |
| P1 | test fixture `backend/tests/fixtures/synthetic_tower.py`: `make_tower(tmp_path) -> Tower(glb_path, frame: Frame, poses: list[dict], truth: list[TruthFinding])` | J2, J3, J4, J5, X |
| J1 | `app.asset_review.frame_io.silhouette_from_mesh(mesh: trimesh.Trimesh) -> list[tuple[float,float]]`; `CONVERSIONS: dict[str, np.ndarray]` (4x4); job `asset_glb_import` | J5 |
| J1 | `app.asset_review.meshes.load_version_mesh(handle, asset_model_id: str, version: int) -> tuple[trimesh.Trimesh, np.ndarray]` (one concatenated mesh plus a per-face node index; cached per process by GLB sha256) | J3 |
| J2 | `app.asset_review.poses.pose_from_exif(image: Image, frame: Frame) -> PoseIn \| None`; `PoseIn(position, target, up, hfov_deg, vfov_deg, source, accuracy_m)` | J5 |
| J3 | `app.asset_review.place.place_sighting(mesh, face_node, pose: PoseIn, shape: SightingShape, image_size: tuple[int,int], review: ReviewConfig, photo: PIL.Image.Image \| None, colour: str) -> Placement` (`kind`, `center`, `normal`, `part`, `coverage`, `patch: PatchData \| None`); `write_patch(dir, sighting_id, patch) -> str` | J5 |
| J3 | job `asset_place` with params `{asset_model_id, only_dirty}`; on success it **enqueues `asset_group`** for the same model | J5, U2 |
| J4 | `app.asset_review.group.group_sightings(items: list[GroupItem], cluster_m: float) -> list[list[str]]` (pure); `apply_groups(s, handle, asset_model_id, groups) -> GroupResult(created, kept, merged, split)`; `merge(s, handle, finding_id, into_id)`; `split(s, handle, finding_id, sighting_ids) -> Finding` | J5 |
| J5 | job `review_kit_import` | X |

**Frontend (U1 to U6)**

| Producer | Name | Used by |
| --- | --- | --- |
| U1 | `ModelEngine` gains `setPlacements(items: PlacementItem[], fetchPatch: (id) => Promise<PatchBuffers>)`, `setCameras(poses: CameraPose[], colourOf: (p) => string)`, `focusFinding(findingId: string)`, `setGhost(on: boolean)`, `setAutoRotate(on: boolean, speed?: number)`, `setGround(tiles: GroundTile[] \| null)`, `viewFromPose(pose: CameraPose \| null)`, `onPick(cb: (hit: {kind: "finding" \| "camera" \| "part", id: string}) => void)` | U2, U3, U5 |
| U1 | `frontend/src/api/assetReview.ts`: `usePoses(modelId)`, `usePlacements(modelId)`, `useSightings(findingId)`, `estimatePoses`, `computePlacements`, `regroup`, `mergeFinding`, `splitFinding`, `getImageReview`, `putImageReview` | U2, U3, U4, U5 |
| U4 | `frontend/src/findings/filters.ts` `SourceKind` += `"asset"`; `FindingFilters` += `zone`, `side`, `placed`, `assetModelId` | U2 |
| U5 | `frontend/src/assetmodels/findingsMap/FindingsMap.tsx` `<FindingsMap review frame dots onOpen />` | U2 |
| D2/U6 | `frontend/src/api/brands.ts`: `useBrands()`, `createBrand`, `patchBrand`, `deleteBrand` | R1's builder UI (brand picker in `reports/ReportSettings.tsx`) |

## Close-out (X)

Run after J5 merges, in worktree `af-x`.

- [ ] **Step 1: Synthetic end to end (e2e, real backend).** Create `frontend/e2e/asset-findings-real-backend.spec.ts` under the existing `playwright.real-backend` config. It runs these steps and asserts each one:
  1. generate the synthetic tower;
  2. import its photos;
  3. import its GLB;
  4. estimate poses;
  5. draw two boxes on one photo and one on another, all of one defect;
  6. compute placements;
  7. expect **one** finding with three sightings, and its zone and side equal to the truth;
  8. render a report with brand White label;
  9. expect the PDF to exist with pages at least 3.

  Run: `pnpm -C frontend exec playwright test --config playwright.real-backend.config.ts asset-findings`. Expected: PASS.
- [ ] **Step 2: DAMAC replay acceptance (local only).**
  1. In a scratch project under `C:\Users\D\Claude_Workspace\outputs\Kestrel AI Reference Pack\_work\af-acceptance\`, import the photos from `\\DanNas\Work Data\Asset Inspections\Buildings\Residential Tower Facade Inspection\` (the four frame folders `_rebuild\photo_map.json` points at).
  2. Run `review_kit_import` on `...\DAMAC Hills Tower Facade Digital Report\_rebuild\job\` with `surface.json`.
  3. Record the counts in `docs/evidence/asset-findings/damac-replay.md`.

  Expected: 656 findings (182 at severity 2, 474 at severity 1), 1,441 sightings, 715 patch, 625 point, 101 none, 45 uncertain photos. Then compare the sightings CSV with the kit CSV, matching rows on the photo, the kit class mapped through the import mapping, and the box centre within 2 px; grouping, severity, placement and side must agree for every matched row.
- [ ] **Step 3: DAMAC recompute acceptance.** Run `computePlacements` (all) on the same project and record in `damac-recompute.md`. Expected:
  - patch, point and none counts each within 2% of Step 2;
  - at least 98% of sightings get the same kind;
  - the finding count within 2% of 656;
  - the median centre distance to the replay at most 0.10 m.

  If it fails, record the numbers and stop for a ruling. Do not tune constants to pass.
- [ ] **Step 4: EBSM replay acceptance.** Run `review_kit_import` on `\\DanNas\Work Data\Asset Inspections\Oil and Gas\EBSM FLare Stack Inspection\EBSM Digital Report\_rebuild\job\` against photos imported from `..\GEOTAGED\`. Record in `ebsm-replay.md`. Expected: 78 findings (77 at severity 2, 1 at severity 1), 53 uncertain, 159 none, 9 not assessed, 78 patches. The sighting count is higher than 78 (one per mask region) and is recorded, not pinned.
- [ ] **Step 5: Reports.**
  1. Render a report for each acceptance project with brand e& (the operator imports the logos first).
  2. Check the DAMAC PDF has one page per severity 2 finding plus the register.
  3. Extract the text with `pypdfium2` and search it for em and en dashes; expect none.
  4. Count `/SMask` with a raw byte scan of the PDF; expect 0.
  5. Record the results in `reports.md`.
- [ ] **Step 6: Gate on `main`**, then build and install (`backend\scripts\build.ps1`, then `pnpm -C frontend build:installer`). Write the operator's numbered walkthrough into `docs/evidence/asset-findings/walkthrough.md` and the session wrap-up (`/wrapup`).
- [ ] **Step 7: Commit the evidence** (numbers and text only, no customer files) by path.
