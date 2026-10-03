# Asset findings J5: review kit import

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One background job, `review_kit_import`, turns a review kit job folder (DAMAC facade, EBSM flare, or any kit job) into an asset model of this project:
- its frame and review profile;
- photos matched to an image set already imported;
- camera poses (`source = kit`);
- photo review statuses;
- sightings as boxes or polygons;
- placements replayed from `surface.json` or computed;
- findings grouped from the sightings, carrying the kit's notes and, for the photo unit, its source masks.

A dry run shows the photo match and the class keys and writes nothing.

**Architecture:**
- **Reading the kit:** `backend/app/asset_review/kit_format.py`. It reads `job.yaml` (PyYAML, already a dependency), `cameras.json`, `assessment.json` and `merged.json` whole; they are at most a few MB. It never opens `surface.json`.
- **Photo matching:** `kit_match.py`, a pure matcher with its tests. It matches by source path, then path suffix, then file name, then capture time and size. It never guesses.
- **Writes:**
  - `kit_records.py`: frame, review, poses, statuses;
  - `kit_sightings.py`: boxes and sightings through J4's `add_sighting`, plus the undo;
  - `kit_masks.py`: mask vectorising with `cv2.findContours` and `approxPolyDP`, and the palette PNG for attachments;
  - `kit_replay.py`: `surface.json` streamed with `ijson` into J3's `write_patch`;
  - `kit_finish.py`: in-process grouping, notes, attachments, counts.
- **Other jobs run inside the import:** `kit_children.py` runs J1's `asset_glb_import` and J3's `asset_place` in the import's own thread, through a child context. Progress maps into a slice of the import's bar, and cancelling the import cancels the child.
- **The job and route:** `kit_import.py` holds the job and the request check. `kit_routes.py` holds `POST /review-imports`.

**Tech Stack:** FastAPI, SQLAlchemy, pytest; PyYAML 6.0.3, opencv-python 5.0.0.93, numpy, Pillow (all present); `ijson==3.5.1` (new, BSD-3, a C backend `yajl2_c` in the cp311 wheel).

**Spec sections covered:** §6.5 (all seven steps), §8 `POST /review-imports` with `dry_run`, §11 (import budget), §12 "Kit import" tests, §13 (vectorising loss: source masks kept as attachments).

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs (merged to `main` first):**
- C0: the `startReviewImport` operation and its 501 stub;
- D1: `ImagePose`, `ImageReview`, `FindingSighting`, `AssetModel.frame` and `.review`, and `set_status`;
- P1: `Frame`, `Origin`, `profiles.resolve`, `make_tower`;
- J1: `glb_import.start_import`, `check_source`;
- J3: `place.PatchData`, `write_patch`, the job `asset_place`;
- J4: `findings.sightings.add_sighting`, `group.load_items`, `cluster_m_for`, `group_sightings`, `apply_groups`, and the backfill exclusion.

**Worktree:** `scripts\start-task.ps1 -Name af-j5`

## Budget

- **Background job:** `review_kit_import` (one job; dry run and real run). It runs J1's GLB import and J3's placement in-process, as child steps of the same job, never blocking a request.
- **Bounded reads:**
  - `cameras.json`, `assessment.json` and `merged.json` are parsed whole: 2.6 MB, 0.8 MB and 0.5 MB on DAMAC.
  - `surface.json` (up to 20 MB) is streamed with `ijson`, one patch in memory at a time, in three passes (`patches`, `points`, `unmapped`).
  - One mask PNG at a time (photo unit), decoded, vectorised and dropped.
  - Preview sizes come from image headers only (`PIL.Image.open(...).size`), never pixels.
  - The image set's rows are read as small tuples (id, names, sizes, time); DAMAC has 4,538 of them. No image file is opened.
- **Transactions:** at most 200 sightings, 500 poses or 500 statuses per commit, so the project database is never locked for long. On cancel or failure while records are written, the job deletes its own sightings, boxes and kit poses again (`undo_records`).
- **Expected sizes:**
  - DAMAC: 4,538 photos, 1,441 sightings, 715 patches.
  - EBSM: 299 photos, 78 sightings, 78 patches, 78 masks.

## Task DAG

```
T1 (read, match, dry run, route) ──> T2 (frame, poses, statuses, GLB) ──> T3 (region sightings, undo)
     ──┬──> T4 (photo unit masks) ──┐
       └──> T5 (replay, ijson) ─────┴──> T6 (placement fallback, grouping, notes, attachments) ──> T7 (landing)
```

- T4 and T5 are independent in code (`kit_masks.py`, `kit_replay.py`). Both edit `kit_import._import` in one place, so they run one after the other in this worktree; a second worktree is not worth it.
- **Critical path:** T1, T2, T3, T5, T6, T7.

**Formatting:** the code blocks below are written for reading. Before each commit, run `ruff format` on the files the task creates or changes, then the `ruff check` and `ruff format --check` gate commands.

## File map

| File | Task | Role |
| --- | --- | --- |
| `backend/app/asset_review/kit_format.py` | 1 | Kit folder reader, kit classes, preview grid |
| `backend/app/asset_review/kit_match.py` | 1 | Photo matching (pure) and the candidate loader |
| `backend/app/asset_review/kit_import.py` | 1, 2, 3, 5, 6 | The job, the request check, the dry-run preview |
| `backend/app/asset_review/kit_routes.py` | 1 | `POST /projects/{projectId}/review-imports` |
| `backend/app/asset_review/kit_records.py` | 2 | Frame, review, poses, statuses |
| `backend/app/asset_review/kit_children.py` | 2 | Child context and inline runner |
| `backend/app/asset_review/kit_sightings.py` | 3, 4 | Planning and writing sightings, undo |
| `backend/app/asset_review/kit_masks.py` | 4 | Vectorise, mask coverage, palette PNG |
| `backend/app/asset_review/kit_replay.py` | 5 | `surface.json` replay |
| `backend/app/asset_review/kit_selftest.py` | 5 | `review-import-selftest` for the frozen bundle |
| `backend/app/asset_review/kit_finish.py` | 6 | Grouping, notes, attachments, counts |
| `backend/tests/kit_fixtures.py` | 1 | Hand-made kit folders, seeds, fake job context |

---

### Task 1: Read a kit folder, match photos, dry run

**Files:**
- Create: `backend/app/asset_review/kit_format.py`
- Create: `backend/app/asset_review/kit_match.py`
- Create: `backend/app/asset_review/kit_import.py`
- Create: `backend/app/asset_review/kit_routes.py`
- Modify: `backend/app/asset_review/stubs.py` (delete J5's stub tuple)
- Modify: `backend/app/api.py` (route the module)
- Create: `backend/tests/kit_fixtures.py`
- Test: `backend/tests/test_kit_format.py`, `backend/tests/test_kit_match.py`, `backend/tests/test_kit_import_dry_run.py`

**Interfaces:**
- Consumes:
  - `app.db.models.Image`, `Source`, `ProjectType`, `AssetModel`, `AssetModelVersion`, and D1's `FindingSighting` (with `asset_model_id`);
  - `app.asset_models.store.get_model`;
  - `app.jobs.registry.register_job_type`;
  - `app.jobs.cancellation.JobFailure`;
  - `app.training.schemas.JobRef`, `app.jobs.schemas.JobOut`.
- Produces:
  - **`kit_format`:**
    - `read_kit(folder: Path) -> Kit`;
    - `preview_size(kit: Kit, photo: KitPhoto) -> tuple[int, int]`;
    - `severity_of(value) -> int | None`;
    - `number(value) -> float | None`;
    - the types `Kit`, `KitPhoto`, `KitFinding`, `KitClass`, `KitError`;
    - constants `KIT_CLASSES`, `PROFILE_IDS`, `STATUSES`, `UNCLASSIFIED`.
  - **`kit_match`:**
    - `Candidate`, `Match(image_id, width, height, by)`, `MatchResult(matched, unmatched)`;
    - `load_candidates(s, source_id) -> list[Candidate]`;
    - `match_photos(photos, candidates) -> MatchResult`.
  - **`kit_import`:**
    - `JOB = "review_kit_import"`;
    - `check_request(handle, body: dict) -> dict` (the job params);
    - `prepare(ctx, kit) -> Prepared`;
    - `sighting_keys(kit, matches) -> Counter`;
    - `build_preview(handle, kit, prep, params) -> dict`;
    - the registered job `run_kit_import(ctx) -> dict`.
  - **Over HTTP:** `POST /api/v1/projects/{projectId}/review-imports`, body `ReviewImportRequest`, 202 `JobRef`. It answers 422 `kit_invalid` for a folder that is not a folder or has no `job.yaml`, 422 `validation_error` unless exactly one of `asset_model_id` and `new_model_name` is given, and 404 for an unknown image source or asset model.
  - **The dry-run result** is C0's `ReviewImportPreview`, the job's `result`. Its required fields:
    - `unit`, `profile` (the job.yaml name) and `profile_id`;
    - `photos` and `matched` (counts);
    - `unmatched_count`, and `unmatched`: kit source names, at most 500;
    - `classes`: `[{key, label, count, type_id | null}]`;
    - `statuses`: `{finding, none, uncertain, not_assessed}`, over the matched photos;
    - `has_surface`, `has_glb`, `has_merged`.

    J5 adds these fields, which the schema allows:
    - `dry_run: true`;
    - `matched_by` (`{path?, suffix?, name?, time_size?}`);
    - `unmatched_reasons`: `[{kit_id, source_name, reason: "not_found" | "ambiguous" | "duplicate" | "size_mismatch"}]`, at most 2,000;
    - `sightings`;
    - `model`: `{ready_version | null, existing_sightings}`.

    A real run's result carries the same photo fields.
  - **A second live real import** in the project answers 409 `job_running` (C0 lists it).

- [ ] **Step 1: Write the kit fixtures**

`backend/tests/kit_fixtures.py`:

```python
"""Hand-made review kit folders for the `review_kit_import` tests (spec 2026-10-02-asset-findings
§6.5, §12): three photos per unit, synthetic numbers, a mask drawn here. No customer file is read
or copied (spec A10)."""

from __future__ import annotations

import base64
import io
import json
import logging
import math
import threading
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import trimesh
import yaml
from PIL import Image

from app.jobs.cancellation import JobCancelled

REGION_SIZE = (4000, 3000)  # originals; the kit's preview grid is 2560 x 1920
PHOTO_SIZE = (1000, 750)  # under 2560 px, so the preview grid is the original size
REGION_PHOTOS = [
    {"id": "p01", "name": "DJI_0001.JPG", "source_name": "flight-a/DJI_0001.JPG", "time": "2024:06:05 08:24:24", "sequence": "1"},
    {"id": "p02", "name": "DJI_0002.JPG", "source_name": "flight-a/DJI_0002.JPG", "time": "2024:06:05 08:24:30", "sequence": "1"},
    {"id": "p03", "name": "DJI_0003.JPG", "source_name": "flight-b/DJI_0003.JPG", "time": "2024:06:05 09:10:00", "sequence": "2"},
]
PHOTO_PHOTOS = [
    {"id": "p001", "name": "1 (1).JPG", "source_name": "1 (1).JPG", "time": "2019:01:24 11:45:58", "sequence": "1"},
    {"id": "p002", "name": "1 (2).JPG", "source_name": "1 (2).JPG", "time": "2019:01:24 11:46:10", "sequence": "1"},
    {"id": "p003", "name": "1 (3).JPG", "source_name": "1 (3).JPG", "time": "2019:01:24 11:46:20", "sequence": "3"},
]
TRIANGLE = [[100.0, 600.0], [300.0, 200.0], [500.0, 600.0]]  # merged.json polygon of p01-1 (preview px)
REGION_FINDINGS = [
    {"id": "p01-1", "photo": "p01", "class": "cladding", "severity": 2, "bbox": [100.0, 200.0, 500.0, 600.0],
     "note": "Chipped cladding panel", "confidence": None, "component": None, "group": "g1"},
    {"id": "p01-2", "photo": "p01", "class": "staining", "severity": 1, "bbox": [1000.0, 1000.0, 1200.0, 1300.0],
     "note": "Run-off staining", "confidence": None, "component": None, "group": None},
    {"id": "p02-1", "photo": "p02", "class": "cladding", "severity": 2, "bbox": [300.0, 300.0, 700.0, 700.0],
     "note": "Chipped cladding panel", "confidence": None, "component": "Navy fin", "group": "g1"},
]
PATCH_POSITIONS = [[0, 19, 2], [2, 19, 2], [2, 21, 2], [0, 19, 2], [2, 21, 2], [0, 21, 2]]
PATCH_UVS = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data), "utf-8")


def _f32(values) -> str:
    return base64.b64encode(np.asarray(values, dtype="<f4").tobytes()).decode()


def png_data_url(w: int = 8, h: int = 8) -> str:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (255, 122, 45, 160)).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def kit_patch(keys: dict, center, direction, component, *, label_w: int = 4, label_h: int = 4) -> dict:
    """One `surface.json` patch in the kit's own shape (kit/project.py `run`)."""
    return {
        "id": "surface-" + str(keys.get("finding") or keys.get("photo")),
        **keys,
        "component": component,
        "textureData": png_data_url(),
        "labelWidth": label_w,
        "labelHeight": label_h,
        "labels": base64.b64encode(bytes([1]) * (label_w * label_h)).decode(),
        "sourceCrop": [0, 0, 10, 10],
        "sourceGrid": [2560, 1920],
        "center": center,
        "direction": direction,
        "size": [2.0, 2.0],
        "positions": _f32(PATCH_POSITIONS),
        "uvs": _f32(PATCH_UVS),
        "vertexCount": 6,
    }


def _camera(p: dict, size: tuple[int, int], i: int) -> dict:
    a = i * 0.5
    return {
        **p,
        "file": f"photos/{p['id']}.jpg",
        "subject": "",
        "context": False,
        "latitude": 25.0,
        "longitude": 55.0,
        "altitude": 10.0,
        "width": size[0],
        "height": size[1],
        "position": [round(20 * math.cos(a), 4), 10.0, round(20 * math.sin(a), 4)],
        "target": [0.0, 10.0, 0.0],
        "up": [0, 1, 0],
        "hfov": 40.0,
        "vfov": 30.0,
    }


def make_region_kit(root: Path, *, surface: bool = True, glb: Path | None = None) -> Path:
    """A building-facade kit (region unit): p01 has two findings (one with a merged.json polygon),
    p02 one, p03 is uncertain. surface.json places p01-1 as a patch, p02-1 as a point and leaves
    p01-2 unplaced."""
    root.mkdir(parents=True, exist_ok=True)
    job = {
        "job": {"id": "test-facade", "title": "Test facade", "profile": "building-facade", "brand": "whitelabel"},
        "inputs": {"model": "model.glb", "cameras": "cameras.json", "assessment": "assessment.json",
                   "masks": "masks", "surface": "surface.json"},
        "asset": {
            "height": 30.0,
            "datum_label": "street level",
            "datum_note": "Synthetic datum",
            "line_azimuth_deg": 340.5,
            "zones": [
                {"id": "top", "label": "Top floors", "min": 20.0},
                {"id": "mid", "label": "Middle floors", "min": 10.0, "max": 20.0},
                {"id": "low", "label": "Low floors", "max": 10.0},
            ],
            "levels": [10.0, 20.0],
            "silhouette": [[0, 5.0], [30.0, 5.0]],
            "presets": [{"id": "top", "label": "Top", "target": [0, 25, 0], "camera": [30, 30, 30]}],
        },
        "sequences": {"1": "Flight A", "2": "Flight B"},
        "profile": {},
    }
    (root / "job.yaml").write_text(yaml.safe_dump(job, sort_keys=False), "utf-8")
    cams = [_camera(p, REGION_SIZE, i) for i, p in enumerate(REGION_PHOTOS)]
    _write_json(root / "cameras.json", {"photos": cams, "alignment": {"origin": [25.0, 55.0, 0.0]}})
    _write_json(
        root / "assessment.json",
        {
            "method": "test",
            "photos": {
                "p01": {"status": "finding", "note": "Two defects"},
                "p02": {"status": "finding", "note": "One defect"},
                "p03": {"status": "uncertain", "note": "Reflection"},
            },
            "findings": REGION_FINDINGS,
        },
    )
    _write_json(
        root / "merged.json",
        [{"image": "p01", "class": "cladding", "severity": 2, "bbox": [100.0, 200.0, 500.0, 600.0],
          "space": "preview", "note": "Chipped cladding panel", "polygon": TRIANGLE}],
    )
    if surface:
        _write_json(
            root / "surface.json",
            {
                "version": 1,
                "method": "test",
                "patches": [kit_patch({"finding": "p01-1", "photo": "p01"}, [1.0, 20.0, 2.0], [0.0, 0.0, 1.0], "Crown")],
                "points": [{"finding": "p02-1", "photo": "p02", "center": [1.5, 20.5, 2.0], "normal": [0.0, 0.0, 1.0],
                            "component": "Crown"}],
                "unmapped": ["p01-2"],
            },
        )
    if glb is not None:
        (root / "model.glb").write_bytes(glb.read_bytes())
    return root


def draw_mask() -> np.ndarray:
    """A 1000 x 750 class-index mask: a 200 x 100 region of class 2 with a hole, a 20 x 20 region
    of class 2 and a block of class 4 (uncertain, never a polygon)."""
    m = np.zeros((750, 1000), np.uint8)
    m[100:200, 100:300] = 2
    m[140:160, 180:220] = 0
    m[400:420, 600:620] = 2
    m[600:650, 800:900] = 4
    return m


def make_photo_kit(root: Path, *, surface: bool = True, mask: bool = True) -> Path:
    """A stack kit (photo unit): p001 is a finding with a mask, p002 none, p003 not assessed."""
    root.mkdir(parents=True, exist_ok=True)
    job = {
        "job": {"id": "test-flare", "title": "Test flare", "profile": "stack", "brand": "whitelabel"},
        "inputs": {"model": "model.glb", "cameras": "cameras.json", "assessment": "assessment.json",
                   "masks": "masks", "surface": "surface.json"},
        "asset": {
            "height": 80.0,
            "datum_note": "Assumed ground datum",
            "zones": [
                {"id": "head", "label": "Flare head", "min": 74},
                {"id": "stack", "label": "Stack", "min": 15, "max": 74},
                {"id": "base", "label": "Base", "max": 15},
            ],
            "silhouette": [[0.5, 2.2], [75.8, 0.87]],
            "levels": [1.5, 75.2],
            "presets": [{"id": "head", "label": "Head", "target": [0, 77.4, 0], "camera": [6.8, 84, 10.4]}],
        },
        "sequences": {"1": "Flight 1", "3": "Flight 3"},
        "profile": {"ranking": {"title": "Largest marked areas"}},
    }
    (root / "job.yaml").write_text(yaml.safe_dump(job, sort_keys=False), "utf-8")
    cams = [_camera(p, PHOTO_SIZE, i) for i, p in enumerate(PHOTO_PHOTOS)]
    _write_json(
        root / "cameras.json",
        {"photos": cams, "alignment": {"reference_latitude": 29.0, "reference_longitude": 48.0,
                                       "ground_altitude_assumed": 31.7, "stack_center_EN": [0.0, 0.0]}},
    )
    _write_json(
        root / "assessment.json",
        {
            "method": "test",
            "photos": {
                "p001": {"status": "finding", "severity": 2, "note": "Rust at the seam", "coverage": 1.25, "uncertain": 0.5},
                "p002": {"status": "none", "severity": 0, "note": ""},
                "p003": {"status": "not-assessed", "note": ""},
            },
            "findings": [],
        },
    )
    if mask:
        (root / "masks").mkdir(exist_ok=True)
        Image.fromarray(draw_mask()).save(root / "masks" / "p001.png")
    if surface:
        _write_json(
            root / "surface.json",
            {
                "version": 1,
                "method": "test",
                "patches": [kit_patch({"photo": "p001", "name": "1 (1).JPG", "grade": 2}, [0.5, 40.0, -1.0],
                                      [0.3, 0.0, -0.95], "Stack cladding / seam")],
                "unmapped": [],
            },
        )
    return root


def seed_images(handle, photos: list[dict], size: tuple[int, int], *, rename: dict | None = None,
                retime: dict | None = None, scale: float = 0.5) -> tuple[str, dict[str, str]]:
    """An image source whose images stand for the kit's photos, stored at `scale` of the original
    (as a downscaling import stores them). Returns (source id, {kit photo id: image id})."""
    from app.db.models import Image as ImageRow
    from app.db.models import Source

    rename, retime = rename or {}, retime or {}
    w, h = size
    with handle.session() as s:
        src = Source(folder="C:/kit-photos", site="Kit")
        s.add(src)
        s.flush()
        ids = {}
        for p in photos:
            t = datetime.strptime(retime.get(p["id"], p["time"]), "%Y:%m:%d %H:%M:%S").replace(tzinfo=UTC)
            row = ImageRow(
                path=f"images/{src.id[:8]}/{p['id']}.jpg",
                width=round(w * scale),
                height=round(h * scale),
                source_id=src.id,
                capture_time=t,
                original_name=rename.get(p["id"], p["source_name"]),
                orig_w=w,
                orig_h=h,
            )
            s.add(row)
            s.flush()
            ids[p["id"]] = row.id
        return src.id, ids


def seed_ready_model(handle, name: str = "Tower") -> str:
    """An asset model with an `imported` version 1 whose GLB (a 10 x 30 x 10 m box) is ready."""
    from app.asset_models import store
    from app.db.models import AssetModel, AssetModelVersion

    with handle.session() as s:
        m = AssetModel(name=name, status="ready", current_version=1)
        s.add(m)
        s.flush()
        s.add(AssetModelVersion(model_id=m.id, version=1, spec={}, kind="imported", glb_status="ready",
                                meta={}, source_ids=[], part_count=0))
        mid = m.id
    path = store.version_glb_path(handle, mid, 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(trimesh.creation.box(extents=(10, 30, 10)).export(file_type="glb"))
    return mid


def seed_empty_model(handle, name: str = "Empty") -> str:
    from app.db.models import AssetModel

    with handle.session() as s:
        m = AssetModel(name=name, status="empty")
        s.add(m)
        s.flush()
        return m.id


def kit_types(client, project) -> dict[str, dict]:
    """Three defect types in the catalogue and at the end of the project's type list."""
    from findings_helpers import add_type, use_types

    types = {
        "cladding": add_type(client, "Kit cladding", colour="#e94b9a", default_severity=2),
        "staining": add_type(client, "Kit staining", colour="#c9a227", default_severity=1),
        "corrosion": add_type(client, "Kit corrosion", colour="#ff7a2d", default_severity=2),
    }
    use_types(client, project, *types.values())
    return types


def table_counts(handle) -> dict[str, int]:
    from sqlalchemy import func, select

    from app.db.models import AssetModel, Box, Finding, FindingSighting, ImagePose, ImageReview

    with handle.session() as s:
        return {
            m.__tablename__: s.scalar(select(func.count()).select_from(m))
            for m in (AssetModel, Box, Finding, FindingSighting, ImagePose, ImageReview)
        }


class FakeRunner:
    def __init__(self):
        self.submitted: list[tuple[str, dict]] = []

    def submit(self, project, type, params):
        self.submitted.append((type, params))
        return SimpleNamespace(id="queued-" + type, type=type, state="queued")


class Ctx:
    """The job context a test hands `run_kit_import` directly. `cancel_on`: the first
    `check_cancelled()` after a progress message starting with it raises JobCancelled."""

    def __init__(self, handle, params: dict, *, cancel_on: str | None = None):
        self.project, self.params, self.job_id = handle, params, "job-kit"
        self.log = logging.getLogger("test.kit_import")
        self.cancelled = threading.Event()
        self.runner = FakeRunner()
        self.messages: list[tuple[float, str]] = []
        self.published: list[tuple[str, dict]] = []
        self._cancel_on = cancel_on

    def progress(self, fraction: float, message: str = "") -> None:
        self.messages.append((fraction, message))

    def publish(self, type: str, payload: dict) -> None:
        self.published.append((type, payload))

    def check_cancelled(self) -> None:
        if self._cancel_on and any(m.startswith(self._cancel_on) for _, m in self.messages):
            raise JobCancelled()
```

- [ ] **Step 2: Write the failing reader tests**

`backend/tests/test_kit_format.py`:

```python
"""Reading a review kit folder (spec 2026-10-02-asset-findings §6.5 steps 1, 2)."""

import json

import pytest
from kit_fixtures import TRIANGLE, make_photo_kit, make_region_kit

from app.asset_review.kit_format import KitError, preview_size, read_kit, severity_of


def test_reads_a_region_kit(tmp_path):
    kit = read_kit(make_region_kit(tmp_path / "kit"))
    assert (kit.kit_profile, kit.profile_id, kit.unit) == ("building-facade", "building_facade", "region")
    assert [p.id for p in kit.photos] == ["p01", "p02", "p03"]
    assert kit.photos[0].source_name == "flight-a/DJI_0001.JPG" and kit.photos[0].hfov == 40.0
    f1, f2, f3 = kit.findings
    assert (f1.key, f1.cls, f1.severity, f1.group, f1.polygon) == ("p01-1", "cladding", 2, "g1", TRIANGLE)
    assert f2.polygon is None and f2.bbox == (1000.0, 1000.0, 1200.0, 1300.0)
    assert f3.component == "Navy fin" and f3.order == 2
    assert kit.statuses["p03"]["status"] == "uncertain"
    assert kit.sequences == {"1": "Flight A", "2": "Flight B"}
    assert kit.surface_path.name == "surface.json" and kit.glb_path is None and kit.mask_dir is None
    assert kit.alignment["origin"] == [25.0, 55.0, 0.0]


def test_reads_a_photo_kit(tmp_path):
    kit = read_kit(make_photo_kit(tmp_path / "kit"))
    assert (kit.profile_id, kit.unit, kit.findings) == ("stack", "photo", [])
    assert kit.statuses["p001"] == {"status": "finding", "note": "Rust at the seam", "severity": 2,
                                    "coverage": 1.25, "uncertain": 0.5}
    assert kit.statuses["p002"]["severity"] is None  # the kit writes 0 for "no grade"
    assert kit.statuses["p003"]["status"] == "not_assessed"
    assert kit.mask_path("p001").name == "p001.png" and kit.mask_path("p002") is None
    assert kit.photo_unit_key(2) == "moderate" and kit.photo_unit_key(None) == "light"
    assert kit.finding_class_ids() == {1, 2, 3} and kit.uncertain_class_ids() == {4}


def test_preview_grid_prefers_the_mask_then_the_long_edge_rule(tmp_path):
    region = read_kit(make_region_kit(tmp_path / "r"))
    assert preview_size(region, region.photos[0]) == (2560, 1920)
    photo = read_kit(make_photo_kit(tmp_path / "p"))
    assert preview_size(photo, photo.photos[0]) == (1000, 750)  # the mask's own size
    assert preview_size(photo, photo.photos[1]) == (1000, 750)  # no mask: under 2560 px, unchanged


def test_damac_sized_photo_rounds_like_the_kit(tmp_path):
    kit = read_kit(make_region_kit(tmp_path / "kit"))
    big = kit.photos[0].__class__(id="x", name="x", source_name="x", width=8192, height=5460)
    assert preview_size(kit, big) == (2560, 1706)  # DAMAC's P1 frames, kit/cameras.py rounding


def test_unknown_profile_is_refused(tmp_path):
    root = make_region_kit(tmp_path / "kit")
    text = (root / "job.yaml").read_text("utf-8").replace("building-facade", "bridge-deck")
    (root / "job.yaml").write_text(text, "utf-8")
    with pytest.raises(KitError, match="bridge-deck"):
        read_kit(root)


def test_missing_cameras_is_refused(tmp_path):
    root = make_region_kit(tmp_path / "kit")
    (root / "cameras.json").unlink()
    with pytest.raises(KitError, match="cameras.json"):
        read_kit(root)


def test_merged_entries_match_on_photo_class_and_box(tmp_path):
    root = make_region_kit(tmp_path / "kit")
    merged = json.loads((root / "merged.json").read_text("utf-8"))
    merged[0]["bbox"] = [100.0, 200.0, 500.0, 600.05]  # rounds to the same 0.1 px key
    (root / "merged.json").write_text(json.dumps(merged), "utf-8")
    assert read_kit(root).findings[0].polygon == TRIANGLE


@pytest.mark.parametrize(
    ("value", "level"),
    [(2, 2), ("3", 3), ("Moderate", 2), ("light", 1), ("Severe", 3), ("Critical", 3), (0, None), (None, None), ("x", None)],
)
def test_severity_mapping(value, level):
    assert severity_of(value) == level
```

- [ ] **Step 3: Run them to see them fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_format.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.asset_review.kit_format'`.

- [ ] **Step 4: Implement the reader**

`backend/app/asset_review/kit_format.py`:

```python
"""Read a review kit job folder (spec 2026-10-02-asset-findings §6.5).

The folder holds `job.yaml`, `cameras.json`, `assessment.json`, and optionally `merged.json`,
`sequences.json`, `masks/<photo>.png`, `surface.json` and the GLB. The formats are the kit's own
(`kit/config.py`, `kit/records.py`, `kit/adapters/*` in the asset-inspection kit, the operator's
code). Everything here is a read. The JSON files are a few MB at most and are parsed whole;
`surface.json` (up to 20 MB) is never opened here, `kit_replay` streams it.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from PIL import Image as PILImage

KIT_PREVIEW_LONG_EDGE = 2560  # the kit's review copies (kit/cameras.py `from_exif`)
UNCLASSIFIED = "unclassified"  # the class key of a kit finding with no class
PROFILE_IDS = {
    "stack": "stack",
    "building-facade": "building_facade",
    "tank": "tank",
    "telecom-tower": "telecom_tower",
    "ohtl-tower": "ohtl_tower",
}
FINDING_UNIT = {
    "stack": "photo",
    "building-facade": "region",
    "tank": "region",
    "telecom-tower": "region",
    "ohtl-tower": "region",
}
STATUS = {
    "finding": "finding",
    "none": "none",
    "uncertain": "uncertain",
    "not-assessed": "not_assessed",
    "not_assessed": "not_assessed",
    # the older review-package spellings (kit/adapters/review_package.py STATUS)
    "corrosion-candidate": "finding",
    "uncertain-only": "uncertain",
    "no-confident-finding": "none",
}
STATUSES = ("finding", "none", "uncertain", "not_assessed")
SEVERITY_WORDS = {  # spec A8
    "light": 1,
    "minor": 1,
    "moderate": 2,
    "significant": 2,
    "heavy": 3,
    "severe": 3,
    "critical": 3,
}


class KitError(ValueError):
    """A kit folder this import cannot read. The message is written for the operator."""


@dataclass(frozen=True)
class KitClass:
    id: int  # the value in the class-index masks
    key: str
    label: str
    severity: int | None
    color: str
    uncertain: bool = False


# The kit's profiles/*.yaml classes. A job's `profile.classes` replaces the list (kit deep_merge).
KIT_CLASSES: dict[str, tuple[KitClass, ...]] = {
    "stack": (
        KitClass(1, "light", "Light visual staining / surface oxidation", 1, "#fad34b"),
        KitClass(2, "moderate", "Moderate visible rust", 2, "#ff7a2d"),
        KitClass(3, "heavy", "Heavy visible deterioration", 3, "#ee3f4b"),
        KitClass(4, "uncertain", "Uncertain / heat affected", None, "#b68ef8", True),
    ),
    "building-facade": (
        KitClass(1, "glazing", "Glazing damage", 3, "#ee3f4b"),
        KitClass(2, "sealant", "Sealant or gasket failure", 2, "#ff7a2d"),
        KitClass(3, "cladding", "Cladding or coating damage", 2, "#e94b9a"),
        KitClass(4, "staining", "Staining or run-off", 1, "#c9a227"),
        KitClass(5, "soiling", "Glazing soiling (clean)", 1, "#fad34b"),
        KitClass(6, "corrosion", "Corrosion on metalwork", 2, "#b5651d"),
        KitClass(7, "balustrade", "Balustrade or handrail defect", 2, "#34a6d9"),
        KitClass(8, "object", "Loose or foreign object", 2, "#7cc46b"),
        KitClass(9, "water", "Water or damp marks", 2, "#2f7fd8"),
        KitClass(10, "thermal", "Thermal anomaly", 1, "#ff4fd8"),
        KitClass(99, "uncertain", "Uncertain", None, "#b68ef8", True),
    ),
    "tank": (
        KitClass(1, "coating", "Coating breakdown / blistering", None, "#fad34b"),
        KitClass(2, "corrosion", "Visible corrosion", None, "#ff7a2d"),
        KitClass(3, "seam", "Weld or seam staining / weeping", None, "#ee3f4b"),
        KitClass(4, "deformation", "Dent, bulge or deformation", None, "#e94b9a"),
        KitClass(5, "fitting", "Nozzle, stair, handrail or fitting damage", None, "#34a6d9"),
        KitClass(6, "insulation", "Insulation or cladding damage", None, "#7cc46b"),
        KitClass(9, "uncertain", "Uncertain, needs a closer look", None, "#b68ef8", True),
    ),
    "telecom-tower": (
        KitClass(1, "corrosion", "Corrosion on steelwork or fasteners", None, "#ff7a2d"),
        KitClass(2, "fastener", "Missing or loose fastener", None, "#ee3f4b"),
        KitClass(3, "antenna", "Antenna or mount misalignment / damage", None, "#e94b9a"),
        KitClass(4, "cable", "Cable, tray or clamp issue", None, "#34a6d9"),
        KitClass(5, "coating", "Paint / galvanising breakdown", None, "#fad34b"),
        KitClass(6, "foreign", "Bird nest or foreign object", None, "#7cc46b"),
        KitClass(7, "lighting", "Aviation light or earthing defect", None, "#9d7bea"),
        KitClass(9, "uncertain", "Uncertain, needs a closer look", None, "#b68ef8", True),
    ),
    "ohtl-tower": (
        KitClass(1, "insulator", "Insulator damage (chipped, flashover, broken shed)", None, "#ee3f4b"),
        KitClass(2, "conductor", "Conductor / jumper damage or broken strands", None, "#e94b9a"),
        KitClass(3, "hardware", "Fittings, clamps, dampers displaced or missing", None, "#ff7a2d"),
        KitClass(4, "member", "Missing, bent or damaged tower member", None, "#c0392b"),
        KitClass(5, "corrosion", "Corrosion on steelwork or bolts", None, "#fad34b"),
        KitClass(6, "nest", "Bird nest or foreign object", None, "#7cc46b"),
        KitClass(7, "vegetation", "Vegetation encroachment", None, "#2e9e6a"),
        KitClass(8, "signage", "Missing danger plate, number plate or anti-climb", None, "#34a6d9"),
        KitClass(9, "uncertain", "Uncertain, needs a closer look", None, "#b68ef8", True),
    ),
}


@dataclass(frozen=True)
class KitPhoto:
    id: str
    name: str
    source_name: str
    width: int
    height: int
    time: str | None = None
    sequence: str = "1"
    position: tuple[float, float, float] | None = None
    target: tuple[float, float, float] | None = None
    up: tuple[float, float, float] = (0.0, 1.0, 0.0)
    hfov: float | None = None
    vfov: float | None = None
    file: str | None = None


@dataclass(frozen=True)
class KitFinding:
    key: str
    photo: str
    cls: str | None
    severity: int | None
    bbox: tuple[float, float, float, float] | None  # preview px, x0 y0 x1 y1
    polygon: list[list[float]] | None  # preview px, from merged.json
    note: str = ""
    component: str | None = None
    group: str | None = None
    order: int = 0


DEFAULT_STATUS: dict[str, Any] = {"status": "not_assessed", "note": "", "severity": None, "coverage": None, "uncertain": None}


@dataclass
class Kit:
    folder: Path
    kit_profile: str
    profile_id: str
    unit: str  # region | photo
    profile_overrides: dict[str, Any]
    classes: tuple[KitClass, ...]
    asset: dict[str, Any]
    sequences: dict[str, str]
    alignment: dict[str, Any]
    photos: list[KitPhoto]
    statuses: dict[str, dict[str, Any]]
    findings: list[KitFinding]
    mask_dir: Path | None
    surface_path: Path | None
    glb_path: Path | None

    def mask_path(self, photo_id: str) -> Path | None:
        if self.mask_dir is None:
            return None
        p = self.mask_dir / f"{photo_id}.png"
        return p if p.is_file() else None

    def photo_file(self, photo: KitPhoto) -> Path | None:
        if not photo.file:
            return None
        p = Path(photo.file)
        p = p if p.is_absolute() else self.folder / p
        return p if p.is_file() else None

    def class_by_key(self, key: str) -> KitClass | None:
        return next((c for c in self.classes if c.key == key), None)

    def finding_class_ids(self) -> set[int]:
        return {c.id for c in self.classes if not c.uncertain}

    def uncertain_class_ids(self) -> set[int]:
        return {c.id for c in self.classes if c.uncertain}

    def status_of(self, photo_id: str) -> dict[str, Any]:
        return self.statuses.get(photo_id) or dict(DEFAULT_STATUS)

    def photo_unit_key(self, severity: int | None) -> str:
        """The class key a photo-unit finding maps through: the graded class of its severity,
        else the first graded class."""
        graded = [c for c in self.classes if not c.uncertain]
        for c in graded:
            if c.severity == severity:
                return c.key
        return graded[0].key if graded else UNCLASSIFIED


def number(value) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def severity_of(value) -> int | None:
    """A kit grade as 1..3 (spec A8), or None for "no grade"."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        n = int(value)
        return n if 1 <= n <= 3 else None
    word = str(value).strip().lower()
    if word.isdigit():
        return severity_of(int(word))
    return SEVERITY_WORDS.get(word)


def _text(value) -> str | None:
    if value is None:
        return None
    t = str(value).strip()
    return t or None


def _vec3(value) -> tuple[float, float, float] | None:
    try:
        x, y, z = (float(c) for c in value)
    except (TypeError, ValueError):
        return None
    return (x, y, z) if all(math.isfinite(c) for c in (x, y, z)) else None


def _bbox(value) -> tuple[float, float, float, float] | None:
    try:
        x0, y0, x1, y1 = (float(c) for c in value)
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(c) for c in (x0, y0, x1, y1)):
        return None
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def _points(value) -> list[list[float]] | None:
    try:
        pts = [[float(p[0]), float(p[1])] for p in value]
    except (TypeError, ValueError, IndexError):
        return None
    if len(pts) < 3 or not all(math.isfinite(c) for p in pts for c in p):
        return None
    return pts


def merged_key(photo: str, cls: str | None, bbox: tuple[float, float, float, float]) -> tuple:
    return (photo, cls, tuple(round(c, 1) for c in bbox))


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except FileNotFoundError:
        raise KitError("The kit folder has no job.yaml.") from None
    except (OSError, yaml.YAMLError) as e:
        raise KitError(f"job.yaml could not be read: {type(e).__name__}.") from None
    if not isinstance(data, dict):
        raise KitError("job.yaml is not a kit job file.")
    return data


def _load_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise KitError(f"The kit folder has no {label}.") from None
    except (OSError, ValueError) as e:
        raise KitError(f"{label} could not be read: {type(e).__name__}.") from None


def _class_of(c: dict) -> KitClass:
    try:
        return KitClass(
            int(c["id"]),
            str(c["key"]),
            str(c.get("label") or c["key"]),
            severity_of(c.get("severity")),
            str(c.get("color") or "#ff7a2d"),
            bool(c.get("uncertain")),
        )
    except (KeyError, TypeError, ValueError):
        raise KitError("job.yaml lists a profile class without an id or key.") from None


def _photo(c: dict) -> KitPhoto:
    try:
        return KitPhoto(
            id=str(c["id"]),
            name=str(c.get("name") or ""),
            source_name=str(c.get("source_name") or c.get("name") or ""),
            width=int(c["width"]),
            height=int(c["height"]),
            time=_text(c.get("time")),
            sequence=str(c.get("sequence") or "1"),
            position=_vec3(c.get("position")),
            target=_vec3(c.get("target")),
            up=_vec3(c.get("up")) or (0.0, 1.0, 0.0),
            hfov=number(c.get("hfov")),
            vfov=number(c.get("vfov")),
            file=_text(c.get("file")),
        )
    except (KeyError, TypeError, ValueError):
        raise KitError(f"cameras.json has a photo without an id, width or height ({c.get('id')!r}).") from None


def _status(value) -> dict[str, Any]:
    v = value if isinstance(value, dict) else {}
    return {
        "status": STATUS.get(str(v.get("status") or ""), "not_assessed"),
        "note": str(v.get("note") or ""),
        "severity": severity_of(v.get("severity")),
        "coverage": number(v.get("coverage")),
        "uncertain": number(v.get("uncertain")),
    }


def _merged_polygons(data) -> dict[tuple, list[list[float]]]:
    out: dict[tuple, list[list[float]]] = {}
    for m in data if isinstance(data, list) else []:
        if not isinstance(m, dict) or not m.get("polygon") or m.get("space", "preview") != "preview":
            continue
        bbox, poly = _bbox(m.get("bbox")), _points(m["polygon"])
        if bbox is None or poly is None:
            continue
        cls = None if m.get("class") is None else str(m["class"])
        out[merged_key(str(m.get("image") or ""), cls, bbox)] = poly
    return out


def _finding(f: dict, i: int, polygons: dict, class_keys: dict[int, str]) -> KitFinding:
    photo = str(f.get("photo") or "")
    cls = f.get("class")
    if isinstance(cls, int) and not isinstance(cls, bool):
        cls = class_keys.get(cls)  # kit/records.py accepts a class id too
    cls = None if cls in (None, "") else str(cls)
    bbox = _bbox(f.get("bbox"))
    return KitFinding(
        key=str(f.get("id") or f"{photo}#{i}"),
        photo=photo,
        cls=cls,
        severity=severity_of(f.get("severity")),
        bbox=bbox,
        polygon=polygons.get(merged_key(photo, cls, bbox)) if bbox is not None else None,
        note=str(f.get("note") or ""),
        component=_text(f.get("component")),
        group=_text(f.get("group")),
        order=i,
    )


def _sequences(folder: Path, raw: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    side = folder / "sequences.json"
    if side.is_file():
        data = _load_json(side, "sequences.json")
        if isinstance(data, dict):
            out.update({str(k): str(v) for k, v in data.items()})
    out.update({str(k): str(v) for k, v in (raw.get("sequences") or {}).items()})
    return out


def read_kit(folder: Path) -> Kit:
    folder = Path(folder)
    raw = _load_yaml(folder / "job.yaml")
    job = raw.get("job") or {}
    kit_profile = str(job.get("profile") or job.get("asset_type") or "stack")
    if kit_profile not in PROFILE_IDS:
        raise KitError(f"The kit profile {kit_profile!r} has no built-in review profile in Kestrel.")
    overrides = raw.get("profile") or {}
    inputs = raw.get("inputs") or {}

    def resolve(key: str, default: str) -> Path:
        q = Path(str(inputs.get(key) or default))
        return q if q.is_absolute() else folder / q

    classes = tuple(_class_of(c) for c in overrides["classes"]) if overrides.get("classes") else KIT_CLASSES[kit_profile]
    unit = str(overrides.get("finding_unit") or FINDING_UNIT[kit_profile])
    if unit not in ("region", "photo"):
        raise KitError(f"The kit's finding unit {unit!r} is neither region nor photo.")
    cams = _load_json(resolve("cameras", "cameras.json"), "cameras.json")
    ass = _load_json(resolve("assessment", "assessment.json"), "assessment.json")
    if not isinstance(cams, dict) or not isinstance(ass, dict):
        raise KitError("cameras.json or assessment.json is not a kit file.")
    photos = [_photo(c) for c in cams.get("photos") or []]
    if len({p.id for p in photos}) != len(photos):
        raise KitError("cameras.json lists a photo id twice.")
    findings: list[KitFinding] = []
    if unit == "region":
        merged = folder / "merged.json"
        polygons = _merged_polygons(_load_json(merged, "merged.json")) if merged.is_file() else {}
        class_keys = {c.id: c.key for c in classes}
        findings = [_finding(f, i, polygons, class_keys) for i, f in enumerate(ass.get("findings") or [])]
    mask_dir, surface, glb = resolve("masks", "masks"), resolve("surface", "surface.json"), resolve("model", "model.glb")
    return Kit(
        folder=folder,
        kit_profile=kit_profile,
        profile_id=PROFILE_IDS[kit_profile],
        unit=unit,
        profile_overrides=dict(overrides),
        classes=classes,
        asset=dict(raw.get("asset") or {}),
        sequences=_sequences(folder, raw),
        alignment=dict(cams.get("alignment") or {}),
        photos=photos,
        statuses={str(k): _status(v) for k, v in (ass.get("photos") or {}).items()},
        findings=findings,
        mask_dir=mask_dir if mask_dir.is_dir() else None,
        surface_path=surface if surface.is_file() else None,
        glb_path=glb if glb.is_file() else None,
    )


def preview_size(kit: Kit, photo: KitPhoto) -> tuple[int, int]:
    """The kit's preview grid for one photo: the mask's size, else the review copy's, else the
    2,560 px long-edge rule of kit/cameras.py. Headers only; no pixels are decoded."""
    for path in (kit.mask_path(photo.id), kit.photo_file(photo)):
        if path is None:
            continue
        try:
            with PILImage.open(path) as im:
                return im.size
        except OSError:
            continue
    s = min(1.0, KIT_PREVIEW_LONG_EDGE / max(photo.width, photo.height))
    return round(photo.width * s), round(photo.height * s)
```

- [ ] **Step 5: Run the reader tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_format.py -q`
Expected: PASS (16 passed).

- [ ] **Step 6: Write the failing matcher tests**

`backend/tests/test_kit_match.py`:

```python
"""Matching kit photos to project images (spec §6.5 step 2): nothing is guessed."""

from datetime import UTC, datetime

from app.asset_review.kit_format import KitPhoto
from app.asset_review.kit_match import Candidate, match_photos


def cand(image_id, name, *, w=4000, h=3000, time="2024:06:05 08:00:00", orig=True):
    t = datetime.strptime(time, "%Y:%m:%d %H:%M:%S").replace(tzinfo=UTC)
    return Candidate(image_id, name, w // 2, h // 2, w if orig else None, h if orig else None, t)


def kp(kit_id, source_name, *, w=4000, h=3000, time="2024:06:05 09:00:00"):
    return KitPhoto(id=kit_id, name=source_name.rsplit("/", 1)[-1], source_name=source_name, width=w, height=h, time=time)


def test_path_then_suffix_then_name_then_time_and_size():
    photos = [
        kp("a", "flight-a/DJI_0001.JPG"),
        kp("b", "p1 50mm/flight-a/DJI_0002.JPG"),
        kp("c", "x/DJI_0003.JPG"),
        kp("d", "renamed.JPG", time="2024:06:05 08:30:00"),
    ]
    cands = [
        cand("i1", "Flight-A\\DJI_0001.jpg"),  # case and slashes do not matter
        cand("i2", "flight-a/DJI_0002.JPG"),
        cand("i3", "y/DJI_0003.JPG"),
        cand("i4", "IMG_0004.JPG", time="2024:06:05 08:30:00"),
    ]
    r = match_photos(photos, cands)
    assert {k: (m.image_id, m.by) for k, m in r.matched.items()} == {
        "a": ("i1", "path"),
        "b": ("i2", "suffix"),
        "c": ("i3", "name"),
        "d": ("i4", "time_size"),
    }
    assert r.unmatched == []
    assert (r.matched["a"].width, r.matched["a"].height) == (2000, 1500)


def test_two_images_with_one_name_fall_back_to_time_and_size():
    photos = [kp("p001", "1 (1).JPG", time="2019:01:24 11:45:58")]
    cands = [
        cand("i1", "GEOTAGED/1 (1).JPG", time="2019:01:24 11:45:58"),
        cand("i2", "OTHER/1 (1).JPG", time="2019:01:24 12:00:00"),
    ]
    r = match_photos(photos, cands)
    assert r.matched["p001"].image_id == "i1" and r.matched["p001"].by == "time_size"


def test_ambiguous_is_unmatched_not_guessed():
    photos = [kp("p001", "1 (1).JPG", time="2019:01:24 11:45:58")]
    cands = [
        cand("i1", "a/1 (1).JPG", time="2019:01:24 11:45:58"),
        cand("i2", "b/1 (1).JPG", time="2019:01:24 11:45:58"),
    ]
    r = match_photos(photos, cands)
    assert r.matched == {}
    assert r.unmatched == [{"kit_id": "p001", "source_name": "1 (1).JPG", "reason": "ambiguous"}]


def test_size_must_agree_for_the_time_fallback():
    photos = [kp("d", "renamed.JPG", w=5184, h=3888, time="2024:06:05 08:30:00")]
    r = match_photos(photos, [cand("i4", "IMG_0004.JPG", time="2024:06:05 08:30:00")])
    assert r.unmatched[0]["reason"] == "not_found"


def test_an_image_is_claimed_once():
    photos = [kp("a", "flight-a/DJI_0001.JPG"), kp("a2", "other/DJI_0001.JPG")]
    r = match_photos(photos, [cand("i1", "flight-a/DJI_0001.JPG")])
    assert r.matched["a"].image_id == "i1"
    assert r.unmatched == [{"kit_id": "a2", "source_name": "other/DJI_0001.JPG", "reason": "duplicate"}]


def test_without_original_size_the_aspect_decides():
    photos = [kp("d", "renamed.JPG", time="2024:06:05 08:30:00")]
    r = match_photos(photos, [cand("i4", "IMG_0004.JPG", time="2024:06:05 08:30:00", orig=False)])
    assert r.matched["d"].by == "time_size"
```

- [ ] **Step 7: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_match.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.asset_review.kit_match'`.

- [ ] **Step 8: Implement the matcher**

`backend/app/asset_review/kit_match.py`:

```python
"""Match kit photos to a project's images (spec 2026-10-02-asset-findings §6.5 step 2).

In order: the kit's `source_name` equals `image.original_name` (both relative paths, compared
without case or slash style); one path is a suffix of the other on a folder boundary; the file
names are equal; then the capture time to the second and the original size. A step that finds
more than one candidate never picks one: the photo is reported, nothing is guessed. An image is
claimed by one kit photo at most.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.asset_review.kit_format import KitPhoto
from app.db.models import Image

KIT_TIME = "%Y:%m:%d %H:%M:%S"
ASPECT_SLACK = 0.005  # without the original size, the stored copy's aspect stands in for it


@dataclass(frozen=True)
class Candidate:
    image_id: str
    name: str  # Image.original_name (relative to the source folder), else the stored file name
    width: int
    height: int
    orig_w: int | None
    orig_h: int | None
    capture_time: datetime | None


@dataclass(frozen=True)
class Match:
    image_id: str
    width: int  # the stored image's pixels: what box rows are in
    height: int
    by: str  # path | suffix | name | time_size


@dataclass
class MatchResult:
    matched: dict[str, Match] = field(default_factory=dict)
    unmatched: list[dict] = field(default_factory=list)


def norm(path: str | None) -> str:
    p = (path or "").replace("\\", "/").strip().lower()
    while p.startswith("./"):
        p = p[2:]
    return p.lstrip("/")


def _naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.astimezone(UTC).replace(tzinfo=None) if dt.tzinfo else dt


def kit_time(text: str | None) -> datetime | None:
    """The kit writes EXIF DateTimeOriginal as is; the importer stores it as UTC (prepare.read_exif)."""
    try:
        return datetime.strptime(str(text).strip(), KIT_TIME)
    except (TypeError, ValueError):
        return None


def load_candidates(s: Session, source_id: str) -> list[Candidate]:
    """One image set's rows as small tuples (DAMAC: 4,538). No image file is opened."""
    q = select(
        Image.id, Image.original_name, Image.path, Image.width, Image.height, Image.orig_w, Image.orig_h, Image.capture_time
    ).where(Image.source_id == source_id)
    return [
        Candidate(i, original or PurePosixPath(path).name, w, h, ow, oh, t)
        for i, original, path, w, h, ow, oh, t in s.execute(q).all()
    ]


def _suffix(a: str, b: str) -> bool:
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def _same_size(c: Candidate, p: KitPhoto) -> bool:
    if c.orig_w and c.orig_h:
        return (c.orig_w, c.orig_h) == (p.width, p.height)
    return abs(c.width * p.height - c.height * p.width) <= ASPECT_SLACK * c.width * p.height


def _one(cands: list[Candidate]) -> tuple[Candidate | None, bool]:
    """(the candidate, False) when exactly one; (None, ambiguous) otherwise."""
    if len(cands) == 1:
        return cands[0], False
    return None, len(cands) > 1


def _find(p: KitPhoto, by_path, by_name, by_time) -> tuple[Candidate | None, str, bool]:
    key = norm(p.source_name or p.name)
    ambiguous = False
    c, amb = _one(by_path.get(key, []))
    if c is not None:
        return c, "path", False
    ambiguous |= amb
    if not amb:
        same = by_name.get(key.rsplit("/", 1)[-1], [])
        c, amb = _one([x for x in same if _suffix(norm(x.name), key)])
        if c is not None:
            return c, "suffix", False
        ambiguous |= amb
        if not amb:
            c, amb = _one(same)
            if c is not None:
                return c, "name", False
            ambiguous |= amb
    t = kit_time(p.time)
    if t is not None:
        c, amb = _one([x for x in by_time.get(t, []) if _same_size(x, p)])
        if c is not None:
            return c, "time_size", False
        ambiguous |= amb
    return None, "", ambiguous


def match_photos(photos: list[KitPhoto], candidates: list[Candidate]) -> MatchResult:
    by_path: dict[str, list[Candidate]] = defaultdict(list)
    by_name: dict[str, list[Candidate]] = defaultdict(list)
    by_time: dict[datetime, list[Candidate]] = defaultdict(list)
    for c in candidates:
        key = norm(c.name)
        by_path[key].append(c)
        by_name[key.rsplit("/", 1)[-1]].append(c)
        t = _naive_utc(c.capture_time)
        if t is not None:
            by_time[t].append(c)
    out = MatchResult()
    claimed: set[str] = set()
    for p in photos:
        found, by, ambiguous = _find(p, by_path, by_name, by_time)
        if found is None:
            reason = "ambiguous" if ambiguous else "not_found"
            out.unmatched.append({"kit_id": p.id, "source_name": p.source_name, "reason": reason})
        elif found.image_id in claimed:
            out.unmatched.append({"kit_id": p.id, "source_name": p.source_name, "reason": "duplicate"})
        else:
            claimed.add(found.image_id)
            out.matched[p.id] = Match(found.image_id, found.width, found.height, by)
    return out
```

- [ ] **Step 9: Run the matcher tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_match.py -q`
Expected: PASS (6 passed).

- [ ] **Step 10: Write the failing dry-run and route tests**

`backend/tests/test_kit_import_dry_run.py`:

```python
"""`POST /review-imports` with `dry_run` (spec §6.5, §8; index Review Focus 3)."""

from kit_fixtures import REGION_PHOTOS, REGION_SIZE, kit_types, make_region_kit, seed_images, table_counts

API = "/api/v1/projects"


def test_dry_run_reports_unmatched_and_writes_nothing(tmp_path, client, project, handle, wait_job):
    """Images imported from elsewhere or renamed: the dry run lists the photos it cannot match and
    leaves the project exactly as it was, with no asset model created."""
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(
        handle, REGION_PHOTOS, REGION_SIZE,
        rename={"p03": "other/IMG_9999.JPG"}, retime={"p03": "2024:06:05 10:00:00"},
    )
    before = table_counts(handle)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "new_model_name": "Tower", "dry_run": True},
    )
    assert r.status_code == 202, r.text
    job = wait_job(project["id"], r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    res = job["result"]
    assert res["dry_run"] is True
    assert (res["unit"], res["profile"], res["profile_id"]) == ("region", "building-facade", "building_facade")
    assert (res["photos"], res["matched"], res["matched_by"]) == (3, 2, {"path": 2})
    assert res["unmatched"] == ["flight-b/DJI_0003.JPG"] and res["unmatched_count"] == 1
    assert res["unmatched_reasons"] == [{"kit_id": "p03", "source_name": "flight-b/DJI_0003.JPG", "reason": "not_found"}]
    assert res["statuses"] == {"finding": 2, "none": 0, "uncertain": 0, "not_assessed": 0}
    assert {c["key"]: (c["count"], c["type_id"]) for c in res["classes"]} == {
        "cladding": (2, types["cladding"]["id"]),
        "staining": (1, types["staining"]["id"]),
    }
    assert res["sightings"] == 3
    assert (res["has_surface"], res["has_glb"], res["has_merged"]) == (True, False, True)
    assert res["model"] == {"ready_version": None, "existing_sightings": 0}
    assert table_counts(handle) == before


def test_class_map_in_the_request_wins_over_the_suggestion(tmp_path, client, project, handle, wait_job):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "new_model_name": "Tower", "dry_run": True,
              "class_map": {"staining": types["cladding"]["id"]}},
    )
    res = wait_job(project["id"], r.json()["job"]["id"])["result"]
    assert {c["key"]: c["type_id"] for c in res["classes"]}["staining"] == types["cladding"]["id"]


def test_a_folder_without_job_yaml_is_refused(tmp_path, client, project, handle):
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(tmp_path), "image_source_id": source_id, "new_model_name": "Tower", "dry_run": True},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "kit_invalid"


def test_exactly_one_of_model_and_name(tmp_path, client, project, handle):
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "dry_run": True},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_a_second_real_import_is_409_while_one_is_live(tmp_path, client, project, handle):
    from app.db.models import Job

    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    with handle.session() as s:
        s.add(Job(type="review_kit_import", params={"dry_run": False}, state="running"))
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "new_model_name": "Tower", "dry_run": False},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"


def test_unknown_image_source_is_404(tmp_path, client, project):
    kit = make_region_kit(tmp_path / "kit")
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": "nope", "new_model_name": "Tower", "dry_run": True},
    )
    assert r.status_code == 404
```

- [ ] **Step 11: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_import_dry_run.py -q`
Expected: FAIL. `test_dry_run_reports_unmatched_and_writes_nothing` gets 501 `not_implemented` from C0's stub (`assert 501 == 202`).

- [ ] **Step 12: Implement the job (dry run) and the route**

`backend/app/asset_review/kit_import.py`:

```python
"""`review_kit_import` (spec 2026-10-02-asset-findings §6.5): a review kit's job folder into an
asset model of this project.

`POST /review-imports` checks the request and queues this job. Every run first reads the kit and
matches its photos to the chosen image set (one header read per matched photo, no pixels). A dry
run stops there and returns the preview as the job result, writing nothing (index Review Focus 3).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import func, select

from app.asset_models import store as asset_store
from app.asset_review.kit_format import STATUSES, UNCLASSIFIED, Kit, KitError, preview_size, read_kit
from app.asset_review.kit_match import Match, load_candidates, match_photos
from app.db.models import AssetModel, AssetModelVersion, FindingSighting, Job, ProjectType, Source
from app.errors import AppError, not_found
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

JOB = "review_kit_import"
MAX_LISTED = 2000  # unmatched reasons and skipped lists in a job result; the counts are always whole
MAX_NAMES = 500  # C0's `ReviewImportPreview.unmatched` maxItems
LIVE_STATES = ("queued", "running")
ASPECT_TOLERANCE = 0.02  # a matched image whose aspect differs more than this is not the kit's photo


@dataclass
class Prepared:
    matches: dict[str, Match] = field(default_factory=dict)
    unmatched: list[dict] = field(default_factory=list)
    previews: dict[str, tuple[int, int]] = field(default_factory=dict)


def check_request(handle, body: dict) -> dict:
    """The route's cheap checks; returns the job params. The kit itself is read by the job."""
    folder = Path(str(body.get("folder") or ""))
    if not folder.is_absolute() or not folder.is_dir():
        raise AppError("kit_invalid", f"{folder} is not a folder on this PC.", 422, {"missing": []})
    if not (folder / "job.yaml").is_file():
        raise AppError(
            "kit_invalid", "The folder has no job.yaml. Pick the kit's job folder.", 422, {"missing": ["job.yaml"]}
        )
    model_id = body.get("asset_model_id") or None
    name = (body.get("new_model_name") or "").strip() or None
    if bool(model_id) == bool(name):
        raise AppError("validation_error", "Give either an asset model to fill or a name for a new one.", 422)
    with handle.session() as s:
        if s.get(Source, body["image_source_id"]) is None:
            raise not_found("image source", body["image_source_id"])
        if model_id:
            asset_store.get_model(s, model_id)
        if not body.get("dry_run"):
            live = s.execute(select(Job.id, Job.params).where(Job.type == JOB, Job.state.in_(LIVE_STATES))).all()
            for job_id, job_params in live:
                if not (job_params or {}).get("dry_run"):
                    raise AppError(
                        "job_running", "A review kit import is already running in this project.", 409, {"job_id": job_id}
                    )
    return {
        "folder": str(folder),
        "image_source_id": body["image_source_id"],
        "asset_model_id": model_id,
        "new_model_name": name,
        "class_map": {str(k): str(v) for k, v in (body.get("class_map") or {}).items()},
        "dry_run": bool(body.get("dry_run")),
    }


def prepare(ctx, kit: Kit) -> Prepared:
    """Match the kit's photos and read each matched photo's preview grid (headers only)."""
    with ctx.project.session() as s:
        candidates = load_candidates(s, ctx.params["image_source_id"])
    result = match_photos(kit.photos, candidates)
    photos = {p.id: p for p in kit.photos}
    prep = Prepared(unmatched=list(result.unmatched))
    total = max(1, len(result.matched))
    for i, (kit_id, m) in enumerate(result.matched.items()):
        if i % 200 == 0:
            ctx.check_cancelled()
            ctx.progress(0.01 + 0.03 * i / total, f"Matching photos {i:,} / {total:,}")
        pw, ph = preview_size(kit, photos[kit_id])
        sx, sy = m.width / pw, m.height / ph
        if abs(sx / sy - 1) > ASPECT_TOLERANCE:
            prep.unmatched.append({"kit_id": kit_id, "source_name": photos[kit_id].source_name, "reason": "size_mismatch"})
            continue
        prep.matches[kit_id] = m
        prep.previews[kit_id] = (pw, ph)
    return prep


def sighting_keys(kit: Kit, matches) -> Counter:
    """How many sightings each kit class key would give, over the matched photos only."""
    keys: Counter = Counter()
    if kit.unit == "region":
        for f in kit.findings:
            if f.photo in matches:
                keys[f.cls or UNCLASSIFIED] += 1
    else:
        for kit_id in matches:
            st = kit.status_of(kit_id)
            if st["status"] == "finding":
                keys[kit.photo_unit_key(st["severity"])] += 1
    return keys


def defect_types(s) -> list[tuple[str, str]]:
    q = select(ProjectType.type_id, ProjectType.name).where(ProjectType.kind == "defect").order_by(ProjectType.position)
    return [(tid, name) for tid, name in s.execute(q).all()]


def suggest_type(key: str, label: str, types: list[tuple[str, str]]) -> str | None:
    """A defect type whose name is the key or the label, else one with the key as a word."""
    k, lab = key.lower(), label.lower()
    for tid, name in types:
        if name.lower() in (k, lab):
            return tid
    for tid, name in types:
        if k in name.lower().split():
            return tid
    return None


def ready_version(s, asset_model_id: str) -> int | None:
    model = s.get(AssetModel, asset_model_id)
    if model is None or model.current_version is None:
        return None
    v = s.scalar(
        select(AssetModelVersion).where(
            AssetModelVersion.model_id == asset_model_id, AssetModelVersion.version == model.current_version
        )
    )
    return model.current_version if v is not None and v.glb_status == "ready" else None


def existing_sightings(s, asset_model_id: str) -> int:
    q = select(func.count()).select_from(FindingSighting).where(FindingSighting.asset_model_id == asset_model_id)
    return int(s.scalar(q) or 0)


def build_preview(handle, kit: Kit, prep: Prepared, params: dict) -> dict:
    statuses = Counter(kit.status_of(k)["status"] for k in prep.matches)
    keys = sighting_keys(kit, prep.matches)
    labels = {c.key: c.label for c in kit.classes}
    class_map = params.get("class_map") or {}
    mid = params.get("asset_model_id")
    with handle.session() as s:
        types = defect_types(s)
        ready = ready_version(s, mid) if mid else None
        existing = existing_sightings(s, mid) if mid else 0
    return {
        "dry_run": True,
        **photo_fields(kit, prep),
        "statuses": {st: statuses.get(st, 0) for st in STATUSES},
        "classes": [
            {
                "key": k,
                "label": labels.get(k, k),
                "count": n,
                "type_id": class_map.get(k) or suggest_type(k, labels.get(k, k), types),
            }
            for k, n in keys.most_common()
        ],
        "sightings": sum(keys.values()),
        "has_surface": kit.surface_path is not None,
        "has_glb": kit.glb_path is not None,
        "has_merged": (kit.folder / "merged.json").is_file(),
        "model": {"ready_version": ready, "existing_sightings": existing},
    }


def photo_fields(kit: Kit, prep: Prepared) -> dict:
    """The photo match as C0's `ReviewImportPreview` names it, plus the reasons (J5's addition)."""
    return {
        "unit": kit.unit,
        "profile": kit.kit_profile,
        "profile_id": kit.profile_id,
        "photos": len(kit.photos),
        "matched": len(prep.matches),
        "matched_by": dict(Counter(m.by for m in prep.matches.values())),
        "unmatched_count": len(prep.unmatched),
        "unmatched": [u["source_name"] for u in prep.unmatched[:MAX_NAMES]],
        "unmatched_reasons": prep.unmatched[:MAX_LISTED],
    }


@register_job_type(JOB)
def run_kit_import(ctx) -> dict:
    ctx.progress(0, "Reading the kit folder")
    try:
        kit = read_kit(Path(ctx.params["folder"]))
    except KitError as e:
        raise JobFailure(str(e)) from None
    prep = prepare(ctx, kit)
    if ctx.params.get("dry_run"):
        ctx.progress(1, f"Matched {len(prep.matches):,} of {len(kit.photos):,} kit photos")
        return build_preview(ctx.project, kit, prep, ctx.params)
    raise JobFailure("This build can only preview a kit import.")
```

The last line is replaced in Task 2.

`backend/app/asset_review/kit_routes.py`:

```python
"""`POST /projects/{projectId}/review-imports` (spec 2026-10-02-asset-findings §8): checks the
request and queues `review_kit_import`. A dry run's preview is the job's result."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.asset_review import kit_import
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])


class ReviewImportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    folder: str = Field(min_length=1, max_length=1024)
    image_source_id: str = Field(min_length=1, max_length=36)
    asset_model_id: str | None = Field(None, max_length=36)
    new_model_name: str | None = Field(None, min_length=1, max_length=120)
    class_map: dict[str, str] = Field(default_factory=dict)
    dry_run: bool = False


@router.post("/review-imports", response_model=JobRef, status_code=202)
def start_review_import(
    body: ReviewImportIn, request: Request, handle: ProjectHandle = Depends(get_project)
) -> JobRef:
    params = kit_import.check_request(handle, body.model_dump())
    job = request.app.state.jobs.submit(handle, kit_import.JOB, params)
    return JobRef(job=JobOut.from_row(job, handle.id))
```

In `backend/app/asset_review/stubs.py`, delete J5's tuple: the list that holds `("POST", "/review-imports", "startReviewImport")`. Keep the list name with `[]` if other lists still reference it, as `app/workspace/stubs.py` does. If every list in the module is now empty (J1 to J4 merged before J5), delete the module instead, together with:
- its line in `backend/app/api.py`;
- its `EXPECTED_STUBS |= ...` line and import in `backend/tests/test_contract.py`.

In `backend/app/api.py`, add `"app.asset_review.kit_routes",` on its own line, in the same `for _module in (...)` tuple as C0's asset review modules, directly above `"app.asset_review.stubs"`. If that line was deleted above, add it at the end of that tuple. Add the comment `# review kit import (spec 2026-10-02-asset-findings §6.5)`.

- [ ] **Step 13: Run Task 1's tests and the contract test**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_format.py tests/test_kit_match.py tests/test_kit_import_dry_run.py tests/test_contract.py -q`
Expected: PASS. `startReviewImport` is no longer an expected stub, and the path is routed.

- [ ] **Step 14: Lint and commit**

```powershell
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check . ; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; cd ..
git add backend/app/asset_review/kit_format.py backend/app/asset_review/kit_match.py backend/app/asset_review/kit_import.py backend/app/asset_review/kit_routes.py backend/app/asset_review/stubs.py backend/app/api.py backend/tests/kit_fixtures.py backend/tests/test_kit_format.py backend/tests/test_kit_match.py backend/tests/test_kit_import_dry_run.py
git commit -m "feat(asset-review): read review kit folders, match photos, dry-run import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If the stubs module was deleted, stage the deletion and `backend/tests/test_contract.py` by path as well (`git add backend/app/asset_review/stubs.py backend/tests/test_contract.py`).

---

### Task 2: Frame, review, poses, photo statuses, and the kit's GLB

**Files:**
- Create: `backend/app/asset_review/kit_records.py`
- Create: `backend/app/asset_review/kit_children.py`
- Modify: `backend/app/asset_review/kit_import.py` (the real run, up to the photo statuses)
- Test: `backend/tests/test_kit_import_records.py`

**Interfaces:**
- Consumes:
  - **P1:** `app.asset_review.frame.Frame`, `Origin`; `app.asset_review.profiles.resolve(profile_id, height_m, overrides) -> ReviewConfig`. Overrides deep-merge; `zones` accepts the kit's `min`/`max` with open ends.
  - **D1:** `app.asset_review.review_status.set_status(s, image_id, status, note="") -> ImageReview`; ORM `ImagePose` (PK `image_id`, `asset_model_id`) and `ImageReview.coverage`, `.uncertain_coverage`.
  - **J1:** `app.asset_review.glb_import.check_source(path)` (422 `AppError` `invalid_glb`); `start_import(handle, runner, model_id, *, path, conversion, origin, note=None, source_name=None) -> (version_row, job)`.
  - `app.jobs.registry.get_job_type`.
- Produces:
  - **`kit_records`:**
    - `kit_origin(alignment: dict) -> Origin | None`;
    - `frame_from_kit(kit, existing: dict | None) -> Frame`;
    - `review_from_kit(kit, height_m) -> ReviewConfig`;
    - `write_frame(handle, asset_model_id, kit) -> tuple[Frame, ReviewConfig]`;
    - `write_poses(handle, ctx, asset_model_id, kit, matches, pose_ids: list[str]) -> {written, kept_manual, missing}`;
    - `write_statuses(handle, ctx, kit, matches) -> {finding, none, uncertain, not_assessed}`.
  - **`kit_children`:**
    - `ChildContext(parent, params, lo, hi, swallow=frozenset())`;
    - `InlineRunner(ctx, lo, hi)`, whose `submit(project, type, params)` runs that job now and returns `SimpleNamespace(id=None, ...)`;
    - `run_child(ctx, job_type, params, lo, hi, swallow=frozenset()) -> dict`.
  - **The real run checks before any write, in this order:**
    1. at least one photo matched;
    2. every class key mapped to a defect type of the project;
    3. the target model holds no sightings yet;
    4. the model has a ready 3D model, or the kit folder has `model.glb`.

    Each failure is a `JobFailure` with an operator message.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_kit_import_records.py`:

```python
"""Frame, review, poses and statuses from a kit (spec §6.5 steps 1, 3, 4) and the refusals that
come before any write."""

import math

import pytest
import trimesh
from kit_fixtures import (
    PHOTO_PHOTOS,
    PHOTO_SIZE,
    REGION_PHOTOS,
    REGION_SIZE,
    Ctx,
    kit_types,
    make_photo_kit,
    make_region_kit,
    seed_empty_model,
    seed_images,
    seed_ready_model,
    table_counts,
)

from app.asset_review.kit_children import ChildContext
from app.asset_review.kit_import import run_kit_import
from app.asset_review.kit_records import EARTH_RADIUS_M, kit_origin
from app.db.models import AssetModel, AssetModelVersion, Image, ImagePose, ImageReview
from app.jobs.cancellation import JobFailure


def region_params(tmp_path, handle, types, *, kit=None, model=None, **seed):
    kit = kit or make_region_kit(tmp_path / "kit")
    source_id, ids = seed_images(handle, REGION_PHOTOS, REGION_SIZE, **seed)
    mid = model or seed_ready_model(handle)
    params = {
        "folder": str(kit), "image_source_id": source_id, "asset_model_id": mid, "new_model_name": None,
        "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]}, "dry_run": False,
    }
    return params, ids, mid


def photo_params(tmp_path, handle, types, **kit_kw):
    kit = make_photo_kit(tmp_path / "kit", **kit_kw)
    source_id, ids = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    params = {
        "folder": str(kit), "image_source_id": source_id, "asset_model_id": mid, "new_model_name": None,
        "class_map": {"moderate": types["corrosion"]["id"]}, "dry_run": False,
    }
    return params, ids, mid


def test_frame_and_review_come_from_job_yaml(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, mid = region_params(tmp_path, handle, types)
    result = run_kit_import(Ctx(handle, params))
    assert result["dry_run"] is False and result["version"] == 1 and result["asset_model_id"] == mid
    with handle.session() as s:
        m = s.get(AssetModel, mid)
        frame, review = m.frame, m.review
    assert (frame["origin"]["lat"], frame["origin"]["lon"], frame["origin"]["ground_alt_m"]) == (25.0, 55.0, 0.0)
    assert frame["height_m"] == 30.0 and frame["line_azimuth_deg"] == 340.5
    assert frame["levels"] == [10.0, 20.0] and [list(p) for p in frame["silhouette"]] == [[0.0, 5.0], [30.0, 5.0]]
    assert frame["presets"][0]["id"] == "top" and frame["datum_label"] == "street level"
    assert review["profile_id"] == "building_facade"
    assert [(z["id"], z["min_m"], z["max_m"]) for z in review["zones"]] == [
        ("top", 20.0, None), ("mid", 10.0, 20.0), ("low", None, 10.0)
    ]


def test_poses_are_kit_poses_and_manual_poses_are_kept(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, ids, mid = region_params(tmp_path, handle, types)
    with handle.session() as s:
        s.add(ImagePose(image_id=ids["p02"], asset_model_id=mid, position=[9, 9, 9], target=[0, 9, 0], up=[0, 1, 0],
                        hfov_deg=50.0, vfov_deg=40.0, source="manual"))
    result = run_kit_import(Ctx(handle, params))
    assert result["poses"] == {"written": 2, "kept_manual": 1, "missing": 0}
    with handle.session() as s:
        p1 = s.get(ImagePose, {"image_id": ids["p01"], "asset_model_id": mid})
        p2 = s.get(ImagePose, {"image_id": ids["p02"], "asset_model_id": mid})
        p3 = s.get(ImagePose, {"image_id": ids["p03"], "asset_model_id": mid})
        assert (p1.source, p1.position, p1.target, p1.hfov_deg, p1.sequence) == ("kit", [20.0, 10.0, 0.0], [0.0, 10.0, 0.0], 40.0, "Flight A")
        assert p3.sequence == "Flight B"
        assert (p2.source, p2.position) == ("manual", [9, 9, 9])


def test_review_statuses_follow_the_assessment(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, ids, _ = photo_params(tmp_path, handle, types)
    result = run_kit_import(Ctx(handle, params))
    assert result["statuses"] == {"finding": 1, "none": 1, "uncertain": 0, "not_assessed": 1}
    with handle.session() as s:
        r1, r2, r3 = (s.get(ImageReview, ids[k]) for k in ("p001", "p002", "p003"))
        assert (r1.status, r1.note, r1.coverage, r1.uncertain_coverage) == ("finding", "Rust at the seam", 0.0125, 0.005)
        assert (r2.status, r3.status) == ("none", "not_assessed")
        assert s.get(Image, ids["p002"]).marked_empty is True


def test_unmapped_classes_are_refused_before_any_write(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, mid = region_params(tmp_path, handle, types)
    params["class_map"] = {"cladding": types["cladding"]["id"]}
    before = table_counts(handle)
    with pytest.raises(JobFailure, match="staining"):
        run_kit_import(Ctx(handle, params))
    assert table_counts(handle) == before
    with handle.session() as s:
        assert s.get(AssetModel, mid).frame is None


def test_a_type_that_is_not_a_defect_type_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = region_params(tmp_path, handle, types)
    params["class_map"]["staining"] = "not-a-type"
    with pytest.raises(JobFailure, match="not a defect type"):
        run_kit_import(Ctx(handle, params))


def test_a_model_without_a_3d_model_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = region_params(tmp_path, handle, types, model=seed_empty_model(handle))
    with pytest.raises(JobFailure, match="no 3D model"):
        run_kit_import(Ctx(handle, params))


def test_no_matched_photo_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = region_params(
        tmp_path, handle, types,
        rename={k: f"x/{k}.JPG" for k in ("p01", "p02", "p03")},
        retime={k: "2020:01:01 00:00:00" for k in ("p01", "p02", "p03")},
    )
    with pytest.raises(JobFailure, match="No kit photo matches"):
        run_kit_import(Ctx(handle, params))


def test_new_model_imports_the_kits_glb_in_the_same_job(tmp_path, client, project, handle):
    types = kit_types(client, project)
    glb = tmp_path / "tower.glb"
    glb.write_bytes(trimesh.creation.box(extents=(10, 30, 10)).export(file_type="glb"))
    kit = make_region_kit(tmp_path / "kit", glb=glb)
    params, _, _ = region_params(tmp_path, handle, types, kit=kit)
    params["asset_model_id"], params["new_model_name"] = None, "Kit tower"
    ctx = Ctx(handle, params)
    result = run_kit_import(ctx)
    with handle.session() as s:
        m = s.get(AssetModel, result["asset_model_id"])
        v = s.query(AssetModelVersion).filter_by(model_id=m.id, version=1).one()
        assert (m.name, m.asset_type, m.current_version) == ("Kit tower", "building-facade", 1)
        assert (v.kind, v.glb_status) == ("imported", "ready")
        assert m.frame["height_m"] == 30.0  # the kit's height wins over the mesh's
    assert ctx.runner.submitted == []  # the GLB import ran inside this job, nothing was queued


def test_origin_from_a_reference_point_and_the_stack_centre():
    o = kit_origin({"reference_latitude": 29.0, "reference_longitude": 48.0, "ground_altitude_assumed": 31.7,
                    "stack_center_EN": [100.0, 200.0]})
    lat = 29.0 + math.degrees(200.0 / EARTH_RADIUS_M)
    assert o.lat == pytest.approx(lat)
    assert o.lon == pytest.approx(48.0 + math.degrees(100.0 / (EARTH_RADIUS_M * math.cos(math.radians(lat)))))
    assert o.ground_alt_m == 31.7
    assert kit_origin({}) is None


def test_child_context_scales_progress_and_swallows_chained_jobs(handle):
    parent = Ctx(handle, {})
    child = ChildContext(parent, {"a": 1}, 0.5, 0.8, swallow=frozenset({"asset_group"}))
    child.progress(0.5, "half")
    assert parent.messages[-1] == (pytest.approx(0.65), "half")
    assert child.runner.submit(handle, "asset_group", {"asset_model_id": "m"}).id is None
    child.runner.submit(handle, "other", {"x": 1})
    assert parent.runner.submitted == [("other", {"x": 1})]
    assert child.params == {"a": 1} and child.project is handle and child.cancelled is parent.cancelled
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_import_records.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.asset_review.kit_children'`.

- [ ] **Step 3: Implement the child context**

`backend/app/asset_review/kit_children.py`:

```python
"""Run another job type inside the kit import (spec 2026-10-02-asset-findings §6.5 steps 6, 7).

The import attaches the kit's notes and source masks to the findings that grouping creates, so it
cannot hand the rest to queued jobs and finish first. It runs J1's `asset_glb_import` and J3's
`asset_place` in its own thread instead, through a child context:
- progress maps into a slice of the import's bar;
- cancel is the import's;
- a job the child would chain is swallowed, because the import runs that step itself next.
  `asset_place` queues `asset_group` through `jobs_group.submit_group`.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.errors import AppError
from app.jobs.cancellation import JobFailure
from app.jobs.registry import get_job_type


class _ChainGuard:
    """The child's runner: the import's runner, minus the job types the import runs itself."""

    def __init__(self, runner, swallow: frozenset[str]):
        self._runner, self._swallow = runner, swallow
        self.swallowed: list[str] = []

    def submit(self, project, type: str, params: dict):
        if type in self._swallow:
            self.swallowed.append(type)
            return SimpleNamespace(id=None, type=type, state="skipped")
        return self._runner.submit(project, type, params)

    def __getattr__(self, name):
        return getattr(self._runner, name)


class ChildContext:
    def __init__(self, parent, params: dict, lo: float, hi: float, swallow: frozenset[str] = frozenset()):
        self.project, self.job_id, self.log = parent.project, parent.job_id, parent.log
        self.cancelled = parent.cancelled
        self.params = dict(params)
        self.runner = _ChainGuard(parent.runner, swallow)
        self.last_message: str | None = None
        self._parent, self._lo, self._hi = parent, lo, hi

    def check_cancelled(self) -> None:
        self._parent.check_cancelled()

    def progress(self, fraction: float, message: str = "") -> None:
        f = max(0.0, min(1.0, float(fraction)))
        self.last_message = message
        self._parent.progress(self._lo + (self._hi - self._lo) * f, message)

    def publish(self, type: str, payload: dict) -> None:
        self._parent.publish(type, payload)


def run_child(ctx, job_type: str, params: dict, lo: float, hi: float, swallow: frozenset[str] = frozenset()) -> dict:
    try:
        fn = get_job_type(job_type)
    except AppError:
        raise JobFailure(f"This build has no {job_type} step, so the kit import cannot finish.") from None
    return fn(ChildContext(ctx, params, lo, hi, swallow)) or {}


class InlineRunner:
    """For a service that queues its job (J1's `start_import`): `submit` runs the job now, in this
    thread, inside the import. A failure raises out of `submit`, as a queue failure would."""

    def __init__(self, ctx, lo: float, hi: float):
        self._ctx, self._lo, self._hi = ctx, lo, hi

    def submit(self, project, type: str, params: dict):
        run_child(self._ctx, type, params, self._lo, self._hi)
        return SimpleNamespace(id=None, type=type, state="succeeded")
```

- [ ] **Step 4: Implement the records**

`backend/app/asset_review/kit_records.py`:

```python
"""Frame, review profile, camera poses and photo statuses from a kit (spec 2026-10-02-asset-findings
§6.5 steps 1, 3 and 4). Writes go in chunks of at most 500 rows per commit."""

from __future__ import annotations

import math

from app.asset_models import store as asset_store
from app.asset_review import profiles
from app.asset_review.frame import Frame, Origin
from app.asset_review.kit_format import STATUSES, Kit, number
from app.asset_review.kit_match import Match
from app.asset_review.review_status import set_status
from app.db.base import utcnow
from app.db.models import ImagePose

EARTH_RADIUS_M = 6378137.0  # kit/cameras.py
DEFAULT_HEIGHT_M = 50.0  # kit/records.py, when neither the job nor the model gives a height
POSE_CHUNK = 500
STATUS_CHUNK = 500
NOTE_MAX = 2000


def kit_origin(alignment: dict) -> Origin | None:
    """The base centre in WGS84. DAMAC's kit writes `origin: [lat, lon, ground_alt]`. EBSM's
    review package writes a reference point and the stack centre's east and north offset from it,
    in metres; its model frame has the stack axis at x = z = 0."""
    o = alignment.get("origin")
    if isinstance(o, list | tuple) and len(o) >= 2:
        return Origin(lat=float(o[0]), lon=float(o[1]), ground_alt_m=float(o[2]) if len(o) > 2 else 0.0)
    if alignment.get("reference_latitude") is not None and alignment.get("reference_longitude") is not None:
        lat, lon = float(alignment["reference_latitude"]), float(alignment["reference_longitude"])
        east, north = (float(v) for v in list(alignment.get("stack_center_EN") or (0.0, 0.0))[:2])
        lat += math.degrees(north / EARTH_RADIUS_M)
        lon += math.degrees(east / (EARTH_RADIUS_M * math.cos(math.radians(lat))))
        return Origin(lat=lat, lon=lon, ground_alt_m=float(alignment.get("ground_altitude_assumed") or 0.0))
    return None


def _preset(p: dict) -> dict:
    return {
        "id": str(p["id"]),
        "label": str(p.get("label") or p["id"]),
        "target": [float(v) for v in p["target"]],
        "camera": [float(v) for v in p["camera"]],
    }


def frame_from_kit(kit: Kit, existing: dict | None) -> Frame:
    """The kit's `job.asset` over the model's current frame (J1 wrote the mesh's height and
    silhouette on import); a field the kit does not give keeps the model's value."""
    base = dict(existing or {})
    a = kit.asset
    silhouette = (
        [[float(y), float(r)] for y, r in a["silhouette"]] if a.get("silhouette") else list(base.get("silhouette") or [])
    )
    height = (
        number(a.get("height"))
        or number(base.get("height_m"))
        or (max(float(y) for y, _ in silhouette) if silhouette else None)
        or DEFAULT_HEIGHT_M
    )
    origin = kit_origin(kit.alignment)
    data = {
        "origin": origin.model_dump() if origin is not None else base.get("origin"),
        "north_offset_deg": float(base.get("north_offset_deg") or 0.0),
        "height_m": float(height),
        "datum_label": str(a.get("datum_label") or base.get("datum_label") or "Ground"),
        "datum_note": str(a.get("datum_note") or base.get("datum_note") or ""),
        "line_azimuth_deg": (
            number(a["line_azimuth_deg"]) if a.get("line_azimuth_deg") is not None else base.get("line_azimuth_deg")
        ),
        "silhouette": silhouette,
        "levels": [float(v) for v in (a.get("levels") or base.get("levels") or [])],
        "presets": [_preset(p) for p in a["presets"]] if a.get("presets") else list(base.get("presets") or []),
    }
    return Frame.model_validate(data)


def review_from_kit(kit: Kit, height_m: float) -> profiles.ReviewConfig:
    """The built-in profile for the kit's profile, with the job's zones (metres, open ends allowed)
    and the job's `profile.cluster_m` and `profile.patch_grid` when it sets them."""
    overrides: dict = {}
    if kit.asset.get("zones"):
        overrides["zones"] = [dict(z) for z in kit.asset["zones"]]
    for key in ("cluster_m", "patch_grid"):
        if kit.profile_overrides.get(key) is not None:
            overrides[key] = kit.profile_overrides[key]
    return profiles.resolve(kit.profile_id, height_m, overrides or None)


def write_frame(handle, asset_model_id: str, kit: Kit) -> tuple[Frame, profiles.ReviewConfig]:
    with handle.session() as s:
        model = asset_store.get_model(s, asset_model_id)
        frame = frame_from_kit(kit, model.frame)
        review = review_from_kit(kit, frame.height_m)
        model.frame = frame.model_dump(mode="json")
        model.review = review.model_dump(mode="json")
    return frame, review


def write_poses(handle, ctx, asset_model_id: str, kit: Kit, matches: dict[str, Match], pose_ids: list[str]) -> dict:
    """`cameras.json` poses as `image_pose` rows with `source = kit` (spec §6.5 step 3). A manual
    pose is the operator's and is kept. `pose_ids` collects the images written, for the undo."""
    photos = {p.id: p for p in kit.photos}
    items = list(matches.items())
    out = {"written": 0, "kept_manual": 0, "missing": 0}
    for start in range(0, len(items), POSE_CHUNK):
        ctx.check_cancelled()
        with handle.session() as s:
            for kit_id, m in items[start : start + POSE_CHUNK]:
                p = photos[kit_id]
                if p.position is None or p.target is None or p.hfov is None or p.vfov is None:
                    out["missing"] += 1
                    continue
                row = s.get(ImagePose, {"image_id": m.image_id, "asset_model_id": asset_model_id})
                if row is not None and row.source == "manual":
                    out["kept_manual"] += 1
                    continue
                if row is None:
                    row = ImagePose(image_id=m.image_id, asset_model_id=asset_model_id)
                    s.add(row)
                row.position, row.target, row.up = list(p.position), list(p.target), list(p.up)
                row.hfov_deg, row.vfov_deg = p.hfov, p.vfov
                row.source, row.accuracy_m = "kit", None
                row.sequence = kit.sequences.get(p.sequence, p.sequence)
                row.updated_at = utcnow()
                pose_ids.append(m.image_id)
                out["written"] += 1
        done = min(start + POSE_CHUNK, len(items))
        ctx.progress(0.12 + 0.03 * done / max(1, len(items)), f"Writing camera poses {done:,} / {len(items):,}")
    return out


def _fraction(percent: float | None) -> float | None:
    return None if percent is None else round(float(percent) / 100.0, 6)


def write_statuses(handle, ctx, kit: Kit, matches: dict[str, Match]) -> dict[str, int]:
    """`assessment.json` photo statuses as `image_review` rows (spec §6.5 step 4). A matched photo
    the assessment does not list is `not_assessed`, as the kit reads it. Coverage is stored as a
    share (the kit writes percent)."""
    items = list(matches.items())
    counts = dict.fromkeys(STATUSES, 0)
    for start in range(0, len(items), STATUS_CHUNK):
        ctx.check_cancelled()
        with handle.session() as s:
            for kit_id, m in items[start : start + STATUS_CHUNK]:
                st = kit.status_of(kit_id)
                row = set_status(s, m.image_id, st["status"], st["note"][:NOTE_MAX])
                row.coverage = _fraction(st["coverage"])
                row.uncertain_coverage = _fraction(st["uncertain"])
                counts[st["status"]] += 1
        done = min(start + STATUS_CHUNK, len(items))
        ctx.progress(0.45 + 0.05 * done / max(1, len(items)), f"Writing photo statuses {done:,} / {len(items):,}")
    ctx.publish("images.changed", {})
    return counts
```

- [ ] **Step 5: Implement the real run up to the statuses**

In `backend/app/asset_review/kit_import.py`:

Add the imports:

```python
from app.asset_review import glb_import
from app.asset_review.kit_children import InlineRunner
from app.asset_review.kit_records import write_frame, write_poses, write_statuses
```

Replace the last line of `run_kit_import` (`raise JobFailure("This build can only preview a kit import.")`) with `return _import(ctx, kit, prep)`. Then add:

```python
def _validate(handle, kit: Kit, prep: Prepared, params: dict) -> dict[str, str]:
    """Everything that can refuse the import, before any write. Returns the class map for the
    keys this kit uses."""
    if not prep.matches:
        raise JobFailure("No kit photo matches an image in this image set. Run a dry run to see why.")
    keys = sighting_keys(kit, prep.matches)
    class_map = params.get("class_map") or {}
    missing = sorted(k for k in keys if k not in class_map)
    if missing:
        raise JobFailure("Map every kit class to a defect type first: " + ", ".join(missing) + ".")
    mid = params.get("asset_model_id")
    with handle.session() as s:
        defect = {tid for tid, _ in defect_types(s)}
        if {class_map[k] for k in keys} - defect:
            raise JobFailure("The class mapping names a type that is not a defect type in this project.")
        ready = None
        if mid:
            if s.get(AssetModel, mid) is None:
                raise JobFailure("The asset model was deleted before the import started.")
            n = existing_sightings(s, mid)
            if n:
                raise JobFailure(
                    f"This asset model already holds {n:,} sightings from an earlier import. "
                    "Import into a new asset model."
                )
            ready = ready_version(s, mid)
    if ready is None and kit.glb_path is None:
        raise JobFailure(
            "The asset model has no 3D model yet and the kit folder has no model.glb. "
            "Import the GLB into the asset model first."
        )
    return {k: class_map[k] for k in keys}


def _target_model(handle, params: dict, kit: Kit) -> str:
    if params.get("asset_model_id"):
        return params["asset_model_id"]
    with handle.session() as s:
        row = AssetModel(name=params["new_model_name"], asset_type=kit.kit_profile, status="empty")
        s.add(row)
        s.flush()
        return row.id


def _ensure_version(ctx, asset_model_id: str, kit: Kit) -> int:
    """The model's ready version; without one, the kit's model.glb is imported here, in this job,
    through J1's `start_import` (spec §6.1). The kit's frame is the canonical one (X north, Y up,
    Z east), so the conversion is `none`."""
    with ctx.project.session() as s:
        v = ready_version(s, asset_model_id)
    if v is not None:
        return v
    try:
        glb_import.check_source(kit.glb_path)
    except AppError as e:
        raise JobFailure(f"The kit's model.glb cannot be imported: {e.message}") from None
    ctx.progress(0.05, "Importing the kit's 3D model")
    glb_import.start_import(
        ctx.project,
        InlineRunner(ctx, 0.05, 0.11),
        asset_model_id,
        path=kit.glb_path,
        conversion="none",
        origin=None,
        note="Imported with a review kit",
        source_name=kit.glb_path.name,
    )
    with ctx.project.session() as s:
        v = ready_version(s, asset_model_id)
    if v is None:
        raise JobFailure("The kit's model.glb could not be imported as the asset model's 3D model.")
    return v


def _result(kit: Kit, prep: Prepared, asset_model_id: str, version: int, **parts) -> dict:
    return {
        "dry_run": False,
        "asset_model_id": asset_model_id,
        "version": version,
        **photo_fields(kit, prep),
        **parts,
    }


def _import(ctx, kit: Kit, prep: Prepared) -> dict:
    handle, params = ctx.project, ctx.params
    _validate(handle, kit, prep, params)
    mid = _target_model(handle, params, kit)
    version = _ensure_version(ctx, mid, kit)
    ctx.progress(0.12, "Writing the asset frame and review profile")
    write_frame(handle, mid, kit)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    pose_ids: list[str] = []
    poses = write_poses(handle, ctx, mid, kit, prep.matches, pose_ids)
    statuses = write_statuses(handle, ctx, kit, prep.matches)
    ctx.progress(1, f"Imported {len(prep.matches):,} photos")
    return _result(kit, prep, mid, version, poses=poses, statuses=statuses)
```

- [ ] **Step 6: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_import_records.py tests/test_kit_import_dry_run.py -q`
Expected: PASS (10 + 6 passed).

- [ ] **Step 7: Lint and commit**

```powershell
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check . ; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; cd ..
git add backend/app/asset_review/kit_records.py backend/app/asset_review/kit_children.py backend/app/asset_review/kit_import.py backend/tests/test_kit_import_records.py
git commit -m "feat(asset-review): kit import writes frame, review, poses and photo statuses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Region-unit sightings, and the undo

**Files:**
- Create: `backend/app/asset_review/kit_sightings.py`
- Modify: `backend/app/asset_review/kit_import.py` (`_import`)
- Test: `backend/tests/test_kit_import_region.py`

**Interfaces:**
- Consumes:
  - **J4:** `app.findings.sightings.add_sighting(s, handle, *, asset_model_id, finding_id, image_id, type_id, box=None, points=None, severity=None, group_tag=None) -> FindingSighting`. It draws a person-drawn accepted box through `create_shape_in_session` with no finding hook, touches the image summary, and adds the sighting as `pending`.
  - J4's backfill exclusion (index note N6).
  - `app.imagery.summary.touch_many`.
- Produces:
  - **`kit_sightings`:**
    - `Planned`, `Written` (frozen dataclasses);
    - `plan_region(kit, matches, previews, class_map, skipped) -> list[Planned]`;
    - `plan_sightings(ctx, kit, matches, previews, class_map, skipped) -> list[Planned]`;
    - `write_sightings(handle, ctx, asset_model_id, planned, written, skipped) -> None`;
    - `undo_records(handle, asset_model_id, written, pose_ids) -> None`;
    - `CHUNK = 200`.
  - **Geometry:** a region finding's geometry is its `merged.json` polygon when it has one, else its box. Both are rescaled from the preview grid to the stored image: sx = image.width / preview width, and sy likewise.
  - **Coverage:** the shape's preview-pixel area over the preview area (a share).
  - **Severity:** the finding's own, else the class default, else the photo's, else 1 (kit `records.build`).
  - **Part:** the kit finding's `component` (a given component wins over the GLB node later).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_kit_import_region.py`:

```python
"""Region-unit sightings (spec §6.5 step 5, DAMAC's shape): boxes and polygons rescaled from the
kit's preview grid, sightings with severity, group and component, and the undo on cancel."""

import pytest
from kit_fixtures import REGION_PHOTOS, REGION_SIZE, Ctx, kit_types, make_region_kit, seed_images, seed_ready_model, table_counts
from sqlalchemy import select

from app.asset_review import kit_sightings
from app.asset_review.kit_import import run_kit_import
from app.db.models import Box, Finding, FindingSighting
from app.findings.backfill import findings_from_annotations
from app.jobs.cancellation import JobCancelled, JobFailure

S = 2000 / 2560  # stored image px per preview px (4000 px originals stored at half size)


def params_for(tmp_path, handle, types, **seed):
    # With surface.json: from Task 5 on, these runs replay it, so J3's ray casting (which reads the
    # photos these seeded rows do not have) never runs here.
    kit = make_region_kit(tmp_path / "kit")
    source_id, ids = seed_images(handle, REGION_PHOTOS, REGION_SIZE, **seed)
    mid = seed_ready_model(handle)
    return {
        "folder": str(kit), "image_source_id": source_id, "asset_model_id": mid, "new_model_name": None,
        "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]}, "dry_run": False,
    }, ids, mid


def rows(handle):
    with handle.session() as s:
        q = select(FindingSighting, Box).join(Box, Box.id == FindingSighting.annotation_id)
        out = [(f, b) for f, b in s.execute(q).all()]
        for f, b in out:
            s.expunge(f)
            s.expunge(b)
        return out


def test_region_findings_become_boxes_and_sightings(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, ids, mid = params_for(tmp_path, handle, types)
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 3 and result["skipped"] == []
    by = {(b.image_id, b.shape): (f, b) for f, b in rows(handle)}
    tri_f, tri = by[(ids["p01"], "polygon")]
    assert (tri.x, tri.y, tri.w, tri.h) == pytest.approx((100 * S, 200 * S, 400 * S, 400 * S), abs=0.11)
    assert tri.class_id == types["cladding"]["id"] and len(tri.points) == 3
    assert (tri_f.severity, tri_f.group_tag, tri_f.asset_model_id, tri_f.coverage) == (2, "g1", mid, pytest.approx(0.016276))
    st_f, st = by[(ids["p01"], "box")]
    assert (st.x, st.y, st.w, st.h) == pytest.approx((1000 * S, 1000 * S, 200 * S, 300 * S))
    assert (st.class_id, st_f.severity, st_f.group_tag, st_f.coverage) == (types["staining"]["id"], 1, None, pytest.approx(0.012207))
    p2_f, p2 = by[(ids["p02"], "box")]
    assert (p2.x, p2.w) == pytest.approx((300 * S, 400 * S))
    assert (p2_f.part, p2_f.group_tag, p2.provenance_kind, p2.review_state) == ("Navy fin", "g1", "person", "accepted")


def test_real_run_imports_matched_photos_and_reports_the_rest(tmp_path, client, project, handle):
    """Index Review Focus 3, real run: the unmatched photo's finding is skipped and reported."""
    types = kit_types(client, project)
    params, ids, _ = params_for(
        tmp_path, handle, types, rename={"p02": "other/IMG_2.JPG"}, retime={"p02": "2024:06:05 11:00:00"}
    )
    result = run_kit_import(Ctx(handle, params))
    assert result["unmatched"] == ["flight-a/DJI_0002.JPG"]
    assert result["unmatched_reasons"] == [{"kit_id": "p02", "source_name": "flight-a/DJI_0002.JPG", "reason": "not_found"}]
    assert result["sightings"] == 2
    assert result["skipped"] == [{"kit_key": "p02-1", "reason": "photo_unmatched"}]
    assert {b.image_id for _, b in rows(handle)} == {ids["p01"]}


def test_cancel_while_writing_sightings_leaves_nothing_behind(tmp_path, client, project, handle, monkeypatch):
    types = kit_types(client, project)
    params, _, _ = params_for(tmp_path, handle, types)
    monkeypatch.setattr(kit_sightings, "CHUNK", 1)
    with pytest.raises(JobCancelled):
        run_kit_import(Ctx(handle, params, cancel_on="Writing sightings 1 /"))
    counts = table_counts(handle)
    assert (counts["box"], counts["finding_sighting"], counts["image_pose"]) == (0, 0, 0)


def test_imported_boxes_never_become_image_findings(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = params_for(tmp_path, handle, types)
    run_kit_import(Ctx(handle, params))
    assert findings_from_annotations(handle) == 0
    with handle.session() as s:
        assert s.scalar(select(Finding.id).where(Finding.anchor_kind == "image")) is None


def test_a_second_import_into_the_same_model_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = params_for(tmp_path, handle, types)
    run_kit_import(Ctx(handle, params))
    with pytest.raises(JobFailure, match="already holds 3 sightings"):
        run_kit_import(Ctx(handle, params))
```

- [ ] **Step 2: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_import_region.py -q`
Expected: FAIL, `ImportError: cannot import name 'kit_sightings'`.

- [ ] **Step 3: Implement the sightings**

`backend/app/asset_review/kit_sightings.py`:

```python
"""Sightings from a kit (spec 2026-10-02-asset-findings §6.5 step 5).

Each becomes a `box` row (a polygon or a rectangle, rescaled from the kit's preview grid to the
stored image's pixels) and a `finding_sighting` with no finding yet: grouping makes the findings.
Writes go through J4's `add_sighting`, at most CHUNK per commit. `undo_records` removes what this
job wrote when it is cancelled or fails before the records are complete.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete

from app.asset_review.kit_format import UNCLASSIFIED, Kit
from app.asset_review.kit_match import Match
from app.db.models import Box, FindingSighting, ImagePose
from app.errors import AppError
from app.findings import sightings
from app.imagery import summary

CHUNK = 200
DELETE_CHUNK = 500
PART_MAX = 200


@dataclass(frozen=True)
class Planned:
    kit_key: str  # the kit finding id (region unit) or the kit photo id (photo unit)
    kit_photo: str
    image_id: str
    type_id: str
    severity: int
    group_tag: str | None
    part: str | None
    note: str
    order: int
    polygon: list[list[float]] | None  # stored-image px
    rect: tuple[float, float, float, float] | None  # x, y, w, h in stored-image px
    coverage: float | None
    mask_path: Path | None = None  # photo unit: the source mask, kept as a finding attachment
    primary: bool = True  # photo unit: the photo's largest region (it takes the replayed patch)


@dataclass(frozen=True)
class Written:
    sighting_id: str
    box_id: str
    image_id: str
    kit_key: str
    kit_photo: str
    severity: int
    note: str
    order: int
    mask_path: Path | None
    primary: bool = True


def shoelace(points: list[list[float]]) -> float:
    n = len(points)
    return abs(sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n))) / 2


def scale_points(points: list[list[float]], sx: float, sy: float) -> list[list[float]]:
    return [[x * sx, y * sy] for x, y in points]


def rect_in_image(bbox, sx: float, sy: float, width: int, height: int) -> tuple[float, float, float, float] | None:
    """A preview-px box (x0, y0, x1, y1) as a stored-image rectangle clamped to the image; None
    when less than a pixel is left."""
    x0, y0, x1, y1 = bbox
    x0, x1 = max(0.0, min(width, x0 * sx)), max(0.0, min(width, x1 * sx))
    y0, y1 = max(0.0, min(height, y0 * sy)), max(0.0, min(height, y1 * sy))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return (x0, y0, x1 - x0, y1 - y0)


def plan_region(
    kit: Kit, matches: dict[str, Match], previews: dict[str, tuple[int, int]], class_map: dict[str, str], skipped: list
) -> list[Planned]:
    classes = {c.key: c for c in kit.classes}
    planned: list[Planned] = []
    for f in kit.findings:
        m = matches.get(f.photo)
        if m is None:
            skipped.append({"kit_key": f.key, "reason": "photo_unmatched"})
            continue
        key = f.cls or UNCLASSIFIED
        pw, ph = previews[f.photo]
        sx, sy = m.width / pw, m.height / ph
        polygon = scale_points(f.polygon, sx, sy) if f.polygon else None
        rect = rect_in_image(f.bbox, sx, sy, m.width, m.height) if f.bbox else None
        if polygon is None and rect is None:
            skipped.append({"kit_key": f.key, "reason": "no_geometry"})
            continue
        if f.polygon:
            area = shoelace(f.polygon)
        else:
            x0, y0, x1, y1 = f.bbox
            area = (x1 - x0) * (y1 - y0)
        cdef = classes.get(key)
        severity = f.severity or (cdef.severity if cdef else None) or kit.status_of(f.photo)["severity"] or 1
        planned.append(
            Planned(
                kit_key=f.key,
                kit_photo=f.photo,
                image_id=m.image_id,
                type_id=class_map[key],
                severity=int(severity),
                group_tag=f.group,
                part=f.component,
                note=f.note,
                order=f.order,
                polygon=polygon,
                rect=rect,
                coverage=round(area / (pw * ph), 6),
            )
        )
    return planned


def plan_sightings(ctx, kit: Kit, matches, previews, class_map, skipped) -> list[Planned]:
    """Region unit: one sighting per kit finding. (Task 4 adds the photo unit.)"""
    return plan_region(kit, matches, previews, class_map, skipped)


def _add(s, handle, asset_model_id: str, p: Planned) -> FindingSighting | None:
    kw = {
        "asset_model_id": asset_model_id,
        "finding_id": None,
        "image_id": p.image_id,
        "type_id": p.type_id,
        "severity": p.severity,
        "group_tag": p.group_tag,
    }
    if p.polygon is not None:
        try:
            return sightings.add_sighting(s, handle, points=p.polygon, **kw)
        except AppError:
            pass  # a polygon the shape rules reject (empty after clipping): its box stands in
    if p.rect is not None:
        x, y, w, h = p.rect
        try:
            return sightings.add_sighting(s, handle, box={"x": x, "y": y, "w": w, "h": h, "angle": 0.0}, **kw)
        except AppError:
            return None
    return None


def write_sightings(handle, ctx, asset_model_id: str, planned: list[Planned], written: list[Written], skipped: list) -> None:
    """At most CHUNK sightings per commit; `written` grows as each commits, for the undo."""
    chunk = CHUNK
    total = len(planned)
    for start in range(0, total, chunk):
        ctx.check_cancelled()
        batch: list[Written] = []
        images: set[str] = set()
        with handle.session() as s:
            for p in planned[start : start + chunk]:
                row = _add(s, handle, asset_model_id, p)
                if row is None:
                    skipped.append({"kit_key": p.kit_key, "reason": "invalid_geometry"})
                    continue
                row.part = p.part[:PART_MAX] if p.part else None
                row.coverage = p.coverage
                batch.append(
                    Written(
                        row.id, row.annotation_id, p.image_id, p.kit_key, p.kit_photo, p.severity, p.note, p.order,
                        p.mask_path, p.primary,
                    )
                )
                images.add(p.image_id)
        written.extend(batch)
        ctx.publish("boxes.changed", {"image_ids": sorted(images)})
        done = min(start + chunk, total)
        ctx.progress(0.16 + 0.29 * done / max(1, total), f"Writing sightings {done:,} / {total:,}")


def undo_records(handle, asset_model_id: str, written: list[Written], pose_ids: list[str]) -> None:
    """Delete this job's sightings, their boxes and its kit poses again."""
    sids = [w.sighting_id for w in written]
    bids = [w.box_id for w in written]
    with handle.session() as s:
        for i in range(0, len(sids), DELETE_CHUNK):
            s.execute(delete(FindingSighting).where(FindingSighting.id.in_(sids[i : i + DELETE_CHUNK])))
        for i in range(0, len(bids), DELETE_CHUNK):
            s.execute(delete(Box).where(Box.id.in_(bids[i : i + DELETE_CHUNK])))
        summary.touch_many(s, {w.image_id for w in written})
        for i in range(0, len(pose_ids), DELETE_CHUNK):
            s.execute(
                delete(ImagePose).where(
                    ImagePose.asset_model_id == asset_model_id,
                    ImagePose.source == "kit",
                    ImagePose.image_id.in_(pose_ids[i : i + DELETE_CHUNK]),
                )
            )
```

`write_sightings` reads `CHUNK` inside the function body, not as a default argument, so a test can monkeypatch it.

- [ ] **Step 4: Wire the sightings into the import**

In `backend/app/asset_review/kit_import.py`, add the import:

```python
from app.asset_review.kit_sightings import Written, plan_sightings, undo_records, write_sightings
```

Replace `_import` with:

```python
def _import(ctx, kit: Kit, prep: Prepared) -> dict:
    handle, params = ctx.project, ctx.params
    class_map = _validate(handle, kit, prep, params)
    mid = _target_model(handle, params, kit)
    version = _ensure_version(ctx, mid, kit)
    ctx.progress(0.12, "Writing the asset frame and review profile")
    write_frame(handle, mid, kit)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    pose_ids: list[str] = []
    written: list[Written] = []
    skipped: list[dict] = []
    try:
        poses = write_poses(handle, ctx, mid, kit, prep.matches, pose_ids)
        planned = plan_sightings(ctx, kit, prep.matches, prep.previews, class_map, skipped)
        write_sightings(handle, ctx, mid, planned, written, skipped)
        statuses = write_statuses(handle, ctx, kit, prep.matches)
    except Exception:
        undo_records(handle, mid, written, pose_ids)  # cancel included: JobCancelled is an Exception
        raise
    ctx.progress(1, f"Imported {len(written):,} sightings")
    return _result(
        kit, prep, mid, version, poses=poses, statuses=statuses, sightings=len(written), skipped=skipped[:MAX_LISTED]
    )
```

- [ ] **Step 5: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_import_region.py tests/test_kit_import_records.py -q`
Expected: PASS.

`test_imported_boxes_never_become_image_findings` depends on J4's backfill exclusion (J4 index note N6). If it fails with `findings_from_annotations(handle) == 3`, J4 has not landed the exclusion. Stop and report it to the coordinator; do not add it here, because J4 owns `findings/backfill.py`.

- [ ] **Step 6: Lint and commit**

```powershell
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check . ; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; cd ..
git add backend/app/asset_review/kit_sightings.py backend/app/asset_review/kit_import.py backend/tests/test_kit_import_region.py
git commit -m "feat(asset-review): kit import writes region sightings, undoes on cancel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Photo-unit sightings from class-index masks

**Files:**
- Create: `backend/app/asset_review/kit_masks.py`
- Modify: `backend/app/asset_review/kit_sightings.py` (`plan_photo`, and `plan_sightings` dispatches on the unit)
- Test: `backend/tests/test_kit_masks.py`, `backend/tests/test_kit_import_photo.py`

**Interfaces:**
- Consumes: `cv2.findContours` with `RETR_EXTERNAL` and `CHAIN_APPROX_NONE`, and `cv2.approxPolyDP` (opencv-python 5.0.0.93, already in the bundle); Pillow; numpy.
- Produces:
  - **`kit_masks`:**
    - `load_mask(path) -> np.ndarray` (uint8 class indices; for a "P" PNG, the palette index is the class id);
    - `vectorise(mask, class_ids, *, epsilon=1.5, min_area=16.0) -> list[list[list[float]]]`: outer rings only, largest first; a contour pixel (x, y) becomes the point (x + 0.5, y + 0.5);
    - `mask_coverage(mask, class_ids) -> float`;
    - `write_palette_png(mask, classes, dest) -> Path`: a "P" PNG whose pixel values are the class ids unchanged, coloured with the kit's class colours, and with index 0 transparent.
  - **`kit_sightings.plan_photo(ctx, kit, matches, class_map, skipped) -> list[Planned]`** (coordinator ruling on N7). Each matched photo with status `finding` gives **one sighting per mask region**:
    - a region is an outer contour of the graded classes, holes dropped; uncertain classes are never geometry;
    - only regions of at least 0.02% of the photo (preview px) count, at most 50 per photo, largest first;
    - the largest region's sighting is the photo's **primary**. Its `kit_key` is the kit photo id, so a replayed patch lands on it, and it alone carries `mask_path` (one attachment per photo). The others get `kit_key` `<photo>#<n>` and `primary = False`;
    - every region's type is `class_map[kit.photo_unit_key(status severity)]`;
    - every region's severity is the status grade, else the highest graded class present in the mask, else 1;
    - each sighting's coverage is its region's area over the photo area. The photo's `image_review.coverage` stays the whole mask's (Task 2);
    - `order = photo index x 100 + region index`, so the largest region is the representative for the note.
  - All of a photo's sightings join one finding. J4 groups photo-unit sightings by photo, never by distance; `kit_finish.group_imported` does the same.
  - A finding photo without a mask is skipped as `no_mask`; one with no region over the threshold is skipped as `empty_mask`.
  - `kit_masks.vectorise` gains `max_regions: int | None = None`.

- [ ] **Step 1: Write the failing mask tests**

`backend/tests/test_kit_masks.py`:

```python
"""Class-index masks: vectorising (spec §6.5 step 5, Douglas-Peucker 1.5 px, holes dropped) and the
lossless palette PNG kept as the finding attachment (spec §13)."""

import numpy as np
import pytest
from kit_fixtures import draw_mask
from PIL import Image

from app.asset_review.kit_format import KIT_CLASSES
from app.asset_review.kit_masks import load_mask, mask_coverage, vectorise, write_palette_png
from app.asset_review.kit_sightings import shoelace


def test_outer_rings_largest_first_holes_and_uncertain_dropped():
    rings = vectorise(draw_mask(), {1, 2, 3})
    assert len(rings) == 2
    assert sorted(map(tuple, rings[0])) == sorted([(100.5, 100.5), (100.5, 199.5), (299.5, 199.5), (299.5, 100.5)])
    assert sorted(map(tuple, rings[1])) == sorted([(600.5, 400.5), (600.5, 419.5), (619.5, 419.5), (619.5, 400.5)])


def test_a_disc_is_simplified_but_keeps_its_area():
    yy, xx = np.mgrid[0:200, 0:200]
    mask = (((xx - 100) ** 2 + (yy - 100) ** 2) <= 60**2).astype(np.uint8) * 3
    (ring,) = vectorise(mask, {3})
    assert 8 < len(ring) < 60
    assert shoelace(ring) == pytest.approx(int((mask > 0).sum()), rel=0.05)


def test_specks_below_the_minimum_area_are_dropped():
    mask = np.zeros((50, 50), np.uint8)
    mask[10:13, 10:13] = 1
    assert vectorise(mask, {1}) == []


def test_at_most_max_regions_largest_first():
    mask = np.zeros((200, 400), np.uint8)
    for k in range(60):
        r, c = divmod(k, 15)
        size = 5 + k % 7
        mask[10 + r * 40 : 10 + r * 40 + size, 10 + c * 25 : 10 + c * 25 + size] = 1
    rings = vectorise(mask, {1}, max_regions=50)
    areas = [shoelace(r) for r in rings]
    assert len(rings) == 50 and areas == sorted(areas, reverse=True)


def test_mask_coverage_counts_graded_pixels_only():
    assert mask_coverage(draw_mask(), {1, 2, 3}) == pytest.approx((200 * 100 - 40 * 20 + 400) / (1000 * 750))


def test_palette_png_keeps_the_class_indices(tmp_path):
    mask = draw_mask()
    out = write_palette_png(mask, KIT_CLASSES["stack"], tmp_path / "m.png")
    with Image.open(out) as im:
        assert im.mode == "P" and im.info.get("transparency") == 0
        assert im.getpalette()[6:9] == [255, 122, 45]  # class 2, the kit's "moderate" colour
    assert np.array_equal(load_mask(out), mask)
```

- [ ] **Step 2: Write the failing photo-unit import tests**

`backend/tests/test_kit_import_photo.py`:

```python
"""Photo-unit sightings (spec §6.5 step 5, EBSM's shape): one per finding photo, from its mask."""

from pathlib import Path

import pytest
from kit_fixtures import PHOTO_PHOTOS, PHOTO_SIZE, Ctx, draw_mask, kit_types, make_photo_kit, seed_images, seed_ready_model
from PIL import Image
from sqlalchemy import select

from app.asset_review.kit_import import run_kit_import
from app.db.models import Box, FindingSighting


def photo_params(tmp_path, client, project, handle, **kit_kw):
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit", **kit_kw)
    source_id, ids = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    params = {
        "folder": str(kit), "image_source_id": source_id, "asset_model_id": mid, "new_model_name": None,
        "class_map": {"moderate": types["corrosion"]["id"]}, "dry_run": False,
    }
    return params, ids, types


def test_one_sighting_per_mask_region(tmp_path, client, project, handle):
    """Coordinator ruling on N7: each region of at least 0.02% of the photo is a sighting, largest
    first; the uncertain block and the hole are never geometry."""
    params, ids, types = photo_params(tmp_path, client, project, handle)
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 2 and result["skipped"] == []
    with handle.session() as s:
        rows = s.execute(
            select(FindingSighting, Box).join(Box, Box.id == FindingSighting.annotation_id).order_by(Box.w.desc())
        ).all()
        (big, big_box), (small, small_box) = rows
        assert {b.image_id for _, b in rows} == {ids["p001"]}
        assert {b.class_id for _, b in rows} == {types["corrosion"]["id"]}
        # the 200 x 100 region, preview px (100.5 .. 299.5) at half scale; then the 20 x 20 one
        assert (big_box.x, big_box.y, big_box.w, big_box.h) == pytest.approx((50.25, 50.25, 99.5, 49.5), abs=0.11)
        assert (small_box.x, small_box.y, small_box.w, small_box.h) == pytest.approx((300.25, 200.25, 9.5, 9.5), abs=0.11)
        assert (big.severity, small.severity) == (2, 2)
        assert big.coverage == pytest.approx(199 * 99 / 750000) and small.coverage == pytest.approx(19 * 19 / 750000)


def test_regions_under_the_threshold_are_not_sightings(tmp_path, client, project, handle):
    """0.02% of a 1000 x 750 photo is 150 px²: a 10 x 10 region is dropped."""
    params, _, _ = photo_params(tmp_path, client, project, handle)
    mask = draw_mask()
    mask[400:420, 600:620] = 0
    mask[400:410, 600:610] = 2
    Image.fromarray(mask).save(Path(params["folder"]) / "masks" / "p001.png")
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 1


def test_a_finding_photo_without_a_mask_is_skipped_and_reported(tmp_path, client, project, handle):
    params, _, _ = photo_params(tmp_path, client, project, handle, mask=False)
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 0
    assert result["skipped"] == [{"kit_key": "p001", "reason": "no_mask"}]
```

- [ ] **Step 3: Run them to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_masks.py tests/test_kit_import_photo.py -q`
Expected: FAIL. `test_kit_masks.py` fails with `ModuleNotFoundError: No module named 'app.asset_review.kit_masks'`. `test_kit_import_photo.py` fails `assert 0 == 2` (the photo unit plans nothing yet).

- [ ] **Step 4: Implement the masks**

`backend/app/asset_review/kit_masks.py`:

```python
"""Class-index masks for the photo unit (spec 2026-10-02-asset-findings §6.5 step 5, §13).

The kit's masks are preview-sized PNGs whose pixel values are profile class ids (0 = unmarked).
Polygons are the stored truth (spec A4), so a mask is vectorised: outer rings only (holes
dropped), Douglas-Peucker at 1.5 px, specks under 16 px² dropped. That loses hairline detail, so
the source is kept, losslessly, as a palette PNG attachment. One mask is in memory at a time;
cv2 is already in the bundle.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image as PILImage

from app.asset_review.kit_format import KitClass

EPSILON_PX = 1.5
MIN_REGION_PX = 16.0  # preview px²: below this a region is noise, not a defect outline
UNMARKED_RGB = (32, 32, 32)
OTHER_RGB = (128, 128, 128)


def load_mask(path: Path) -> np.ndarray:
    """uint8 class indices; a "P" PNG's palette index is its class id (kit/masks.py `load`)."""
    with PILImage.open(path) as im:
        if im.mode not in ("L", "P"):
            im = im.convert("L")
        return np.array(im, dtype=np.uint8)


def vectorise(
    mask: np.ndarray,
    class_ids: set[int],
    *,
    epsilon: float = EPSILON_PX,
    min_area: float = MIN_REGION_PX,
    max_regions: int | None = None,
) -> list[list[list[float]]]:
    m = np.isin(mask, list(class_ids)).astype(np.uint8)
    if not m.any():
        return []
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    rings: list[tuple[float, list[list[float]]]] = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area < min_area:
            continue
        pts = cv2.approxPolyDP(c, epsilon, True).reshape(-1, 2)
        if len(pts) < 3:
            continue
        rings.append((area, [[float(x) + 0.5, float(y) + 0.5] for x, y in pts]))
    rings.sort(key=lambda r: -r[0])
    return [ring for _, ring in rings[:max_regions]]


def mask_coverage(mask: np.ndarray, class_ids: set[int]) -> float:
    return float(np.isin(mask, list(class_ids)).sum()) / float(mask.size)


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except (ValueError, IndexError):
        return OTHER_RGB


def write_palette_png(mask: np.ndarray, classes: tuple[KitClass, ...], dest: Path) -> Path:
    palette = list(UNMARKED_RGB) + list(OTHER_RGB) * 255
    for c in classes:
        if 0 < c.id < 256:
            palette[c.id * 3 : c.id * 3 + 3] = _rgb(c.color)
    h, w = mask.shape
    im = PILImage.frombytes("P", (w, h), np.ascontiguousarray(mask, dtype=np.uint8).tobytes())
    im.putpalette(palette)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", transparency=0)
    return dest
```

- [ ] **Step 5: Implement `plan_photo`**

In `backend/app/asset_review/kit_sightings.py`, add the imports:

```python
import numpy as np

from app.asset_review.kit_masks import MIN_REGION_PX, load_mask, vectorise
```

Add `plan_photo`, and replace `plan_sightings`:

```python
REGION_MIN_SHARE = 0.0002  # a mask region counts from 0.02% of the photo (coordinator ruling on N7)
MAX_REGIONS = 50  # per photo, largest first


def plan_photo(ctx, kit: Kit, matches: dict[str, Match], class_map: dict[str, str], skipped: list) -> list[Planned]:
    """One sighting per mask region of each matched finding photo (spec §6.5 step 5, photo unit,
    with the coordinator's ruling on N7). The largest region is the photo's primary sighting: it
    takes the replayed patch and the mask attachment, and its note is the finding's."""
    graded = kit.finding_class_ids()
    grade_of = {c.id: c.severity for c in kit.classes if not c.uncertain and c.severity}
    todo = [k for k in matches if kit.status_of(k)["status"] == "finding"]
    planned: list[Planned] = []
    for i, kit_id in enumerate(todo):
        ctx.check_cancelled()
        ctx.progress(0.15 + 0.01 * i / max(1, len(todo)), f"Reading masks {i:,} / {len(todo):,}")
        path = kit.mask_path(kit_id)
        if path is None:
            skipped.append({"kit_key": kit_id, "reason": "no_mask"})
            continue
        m, st = matches[kit_id], kit.status_of(kit_id)
        mask = load_mask(path)
        ph, pw = mask.shape
        sx, sy = m.width / pw, m.height / ph
        min_area = max(MIN_REGION_PX, REGION_MIN_SHARE * pw * ph)
        rings = vectorise(mask, graded, min_area=min_area, max_regions=MAX_REGIONS)
        if not rings:
            skipped.append({"kit_key": kit_id, "reason": "empty_mask"})
            continue
        present = {int(v) for v in np.unique(mask)}
        mask_grade = max((grade_of[c] for c in present if c in grade_of), default=None)
        severity = int(st["severity"] or mask_grade or 1)
        type_id = class_map[kit.photo_unit_key(st["severity"])]
        for n, ring in enumerate(rings):
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            planned.append(
                Planned(
                    kit_key=kit_id if n == 0 else f"{kit_id}#{n}",
                    kit_photo=kit_id,
                    image_id=m.image_id,
                    type_id=type_id,
                    severity=severity,
                    group_tag=None,
                    part=None,
                    note=st["note"],
                    order=i * 100 + n,
                    polygon=scale_points(ring, sx, sy),
                    rect=rect_in_image((min(xs), min(ys), max(xs), max(ys)), sx, sy, m.width, m.height),
                    coverage=round(shoelace(ring) / (pw * ph), 6),
                    mask_path=path if n == 0 else None,
                    primary=n == 0,
                )
            )
    return planned


def plan_sightings(ctx, kit: Kit, matches, previews, class_map, skipped) -> list[Planned]:
    if kit.unit == "photo":
        return plan_photo(ctx, kit, matches, class_map, skipped)
    return plan_region(kit, matches, previews, class_map, skipped)
```

- [ ] **Step 6: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_kit_masks.py tests/test_kit_import_photo.py tests/test_kit_import_records.py tests/test_kit_import_region.py -q`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```powershell
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check . ; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; cd ..
git add backend/app/asset_review/kit_masks.py backend/app/asset_review/kit_sightings.py backend/tests/test_kit_masks.py backend/tests/test_kit_import_photo.py
git commit -m "feat(asset-review): photo-unit kit sightings from vectorised class masks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Replay `surface.json` (ijson), the dependency and its frozen selftest

**Files:**
- Create: `backend/app/asset_review/kit_replay.py`
- Create: `backend/app/asset_review/kit_selftest.py`
- Modify: `backend/app/asset_review/kit_import.py` (`run_kit_import` wraps `KitError`; `_import` replays)
- Modify: `backend/requirements.txt`, `backend/requirements-lock.txt`, `backend/tests/test_dependency_pins.py`
- Modify: `backend/kestrel_backend.spec`, `backend/app/__main__.py`, `backend/scripts/smoke_frozen.ps1`, `CONTRIBUTING.md`
- Test: `backend/tests/test_kit_replay.py`, `backend/tests/test_kit_selftest.py`

**Interfaces:**
- Consumes:
  - **J3:** `app.asset_review.place.PatchData(positions, uvs, texture, labels, crop, direction, size)`: float32 n x 3 in the asset frame; float32 n x 2 with v = 1 at the top of the crop (the kit's convention too); PIL RGBA at most 512 px; uint8 h x w at most 128 px, 1 = the finding, row 0 at the top; the crop (x0, y0, x1, y1) in stored-image px (the kit's `sourceCrop` times the preview scale); the unit `direction`; the `size` (m); `write_patch(dir: Path, sighting_id: str, patch: PatchData) -> str` (the path it wrote, absolute or relative to the project folder).
  - `ijson.items(file, prefix, use_float=True)`.
- Produces:
  - **`kit_replay`:**
    - `patch_from_kit(item: dict) -> PatchData`;
    - `texture_from_data_url(url) -> PIL.Image`;
    - `labels_from_kit(item) -> np.ndarray`;
    - `replay(handle, ctx, asset_model_id, version, kit, keys: dict[str, str], lo, hi) -> {orphans, bad}`;
    - `placement_counts(handle, sighting_ids) -> {patch, point, none, pending}`.
  - **What a replayed sighting gets:**
    - `placement` (`patch`, `point` or `none`);
    - `cx..cz` and `nx..nz`: the patch's `direction` is its normal, as kit `records.build` reads it;
    - `part`: the kit's component when the sighting has none;
    - `patch_path` (patch only);
    - `placed_version = version`.
  - **Keys:** patches key on `finding` (region unit) or `photo` (photo unit); points key on `finding`; `unmapped` entries are keys.
  - **The photo unit's other regions:** a photo's patch lands on its primary (largest) sighting. Its other region sightings get `placement = none` and `placed_version`, through `mark_unplaced(handle, sighting_ids, version)`, as the coordinator ruled. The finding's derived fields come from the representative, the largest region.
  - **The selftest:** `kestrel-backend.exe review-import-selftest` prints `review-import ok <ijson backend> 2 2`.

- [ ] **Step 1: Build the overlay venv with ijson (overlay-venv rule)**

The worktree must not change the shared interpreter while other worktrees test with it (`vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`). From the worktree root:

```powershell
$cfg = Get-Content E:\Dev\Yolo\app\backend\.venv\pyvenv.cfg | Where-Object { $_ -like 'home*' }
$base = ($cfg -split '=', 2)[1].Trim() + '\python.exe'
uv venv backend\.venv --python $base
Set-Content -Path backend\.venv\Lib\site-packages\_kestrel_shared_venv.pth -Value 'E:\Dev\Yolo\app\backend\.venv\Lib\site-packages' -Encoding ascii
uv pip install --python backend\.venv\Scripts\python.exe --no-deps ijson==3.5.1
backend\.venv\Scripts\python.exe -c "import ijson, cv2, fastapi, trimesh; print(ijson.backend)"
```

Expected: `yajl2_c`. From here to the end of Task 6, run backend commands from `backend/` with the overlay: `$PY = (Resolve-Path .\.venv\Scripts\python.exe)`. `backend/.venv` is git-ignored; never stage it.

- [ ] **Step 2: Pin the dependency (failing pins test first)**

In `backend/tests/test_dependency_pins.py`, add to `PINS`:

```python
    "ijson": "3.5.1",  # asset findings J5: streams the review kit's surface.json (spec 2026-10-02 §6.5)
```

Run: `& $PY -m pytest tests/test_dependency_pins.py -q`
Expected: FAIL, `requirements.txt lacks ['ijson==3.5.1']`.

In `backend/requirements.txt`, after the `google-genai==1.75.0` line, add:

```
ijson==3.5.1  # review kit import streams surface.json, up to 20 MB (spec 2026-10-02-asset-findings §6.5); BSD-3
```

In `backend/requirements-lock.txt`, add `ijson==3.5.1` on its own line directly after `idna==3.4`.

Run: `& $PY -m pytest tests/test_dependency_pins.py -q`
Expected: PASS.

- [ ] **Step 3: Write the failing replay tests**

`backend/tests/test_kit_replay.py`:

```python
"""Replay mode (spec §6.5 step 6): surface.json's patches, points and unplaced keys as they are."""

import json

import numpy as np
import pytest
from kit_fixtures import (
    PATCH_POSITIONS,
    PATCH_UVS,
    PHOTO_PHOTOS,
    PHOTO_SIZE,
    REGION_PHOTOS,
    REGION_SIZE,
    Ctx,
    kit_patch,
    kit_types,
    make_photo_kit,
    make_region_kit,
    seed_images,
    seed_ready_model,
)
from sqlalchemy import select

from app.asset_review.kit_format import KitError
from app.asset_review.kit_import import run_kit_import
from app.asset_review.kit_replay import patch_from_kit
from app.db.models import Box, FindingSighting


def test_patch_from_kit_decodes_geometry_texture_and_labels():
    patch = patch_from_kit(kit_patch({"finding": "f"}, [0, 0, 0], [0, 0, 1], "Crown"))
    assert patch.positions.dtype == np.float32 and patch.positions.tolist() == PATCH_POSITIONS
    assert patch.uvs.tolist() == PATCH_UVS
    assert (patch.texture.mode, patch.texture.size) == ("RGBA", (8, 8))
    assert patch.labels.shape == (4, 4) and patch.labels.min() == 1


def test_label_grids_over_128_px_are_downscaled():
    patch = patch_from_kit(kit_patch({"photo": "p"}, [0, 0, 0], [0, 0, 1], "x", label_w=512, label_h=197))
    assert patch.labels.shape == (49, 128) and patch.labels.dtype == np.uint8


def test_a_patch_of_the_wrong_length_is_refused():
    item = kit_patch({"finding": "f"}, [0, 0, 0], [0, 0, 1], "x")
    item["vertexCount"] = 9
    with pytest.raises(KitError):
        patch_from_kit(item)


def _rows(handle):
    with handle.session() as s:
        q = select(FindingSighting, Box.image_id, Box.shape).join(Box, Box.id == FindingSighting.annotation_id)
        out = []
        for f, image_id, shape in s.execute(q).all():
            s.expunge(f)
            out.append((f, image_id, shape))
        return out


def test_replay_places_patches_points_and_unplaced(tmp_path, client, project, handle):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, ids = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    mid = seed_ready_model(handle)
    params = {"folder": str(kit), "image_source_id": source_id, "asset_model_id": mid, "new_model_name": None,
              "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]}, "dry_run": False}
    result = run_kit_import(Ctx(handle, params))
    assert result["placement"] == {"mode": "replay", "patch": 1, "point": 1, "none": 1, "pending": 0, "orphans": 0, "bad": 0}
    by = {(image_id, shape): f for f, image_id, shape in _rows(handle)}
    patch = by[(ids["p01"], "polygon")]
    assert (patch.placement, patch.cx, patch.cy, patch.cz, patch.nz) == ("patch", 1.0, 20.0, 2.0, 1.0)
    assert (patch.part, patch.placed_version) == ("Crown", 1)
    assert (handle.folder / patch.patch_path).is_file()
    point = by[(ids["p02"], "box")]
    assert (point.placement, point.cx, point.cy, point.part, point.patch_path) == ("point", 1.5, 20.5, "Navy fin", None)
    none = by[(ids["p01"], "box")]
    assert (none.placement, none.cx, none.placed_version) == ("none", None, 1)


def test_photo_unit_patches_key_on_the_photo(tmp_path, client, project, handle):
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    params = {"folder": str(kit), "image_source_id": source_id, "asset_model_id": mid, "new_model_name": None,
              "class_map": {"moderate": types["corrosion"]["id"]}, "dry_run": False}
    result = run_kit_import(Ctx(handle, params))
    assert (result["placement"]["patch"], result["placement"]["none"], result["placement"]["pending"]) == (1, 1, 0)
    rows = sorted((f for f, _, _ in _rows(handle)), key=lambda f: -f.coverage)
    assert (rows[0].placement, rows[0].part, rows[0].cy) == ("patch", "Stack cladding / seam", 40.0)
    assert (rows[1].placement, rows[1].cx, rows[1].placed_version) == ("none", None, 1)


def test_entries_for_unknown_keys_are_counted_not_placed(tmp_path, client, project, handle):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    surface = json.loads((kit / "surface.json").read_text("utf-8"))
    surface["unmapped"].append("p99-1")
    surface["patches"].append({**surface["patches"][0], "finding": "p01-2", "vertexCount": 9})
    (kit / "surface.json").write_text(json.dumps(surface), "utf-8")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    params = {"folder": str(kit), "image_source_id": source_id, "asset_model_id": seed_ready_model(handle),
              "new_model_name": None, "dry_run": False,
              "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]}}
    result = run_kit_import(Ctx(handle, params))
    assert (result["placement"]["orphans"], result["placement"]["bad"]) == (1, 1)
    assert result["placement"]["none"] == 1  # p01-2: the bad patch is skipped, its unmapped entry still counts
```

- [ ] **Step 4: Run them to see them fail**

Run: `& $PY -m pytest tests/test_kit_replay.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.asset_review.kit_replay'`.

- [ ] **Step 5: Implement the replay**

`backend/app/asset_review/kit_replay.py`:

```python
"""Replay a kit's `surface.json` (spec 2026-10-02-asset-findings §6.5 step 6, mode replay).

The kit already cast its rays on the same GLB, so its points, patches (geometry, texture, label
grid) and unplaced keys are taken as they are, written through J3's patch format, and marked
`placed_version = current`. The file (up to 20 MB on DAMAC) is streamed with ijson in three passes
(`patches`, `points`, `unmapped`): one patch in memory at a time, at most CHUNK sighting updates
per commit.
"""

from __future__ import annotations

import base64
import io
import math
from collections import Counter
from pathlib import Path

import ijson
import numpy as np
from PIL import Image as PILImage
from sqlalchemy import func, select

from app.asset_models import store as asset_store
from app.asset_review.kit_format import Kit, KitError
from app.asset_review.place import PatchData, write_patch
from app.db.models import FindingSighting

TEXTURE_MAX_PX = 512  # spec §5.7
LABELS_MAX_PX = 128
CHUNK = 50
PART_MAX = 200


def _items(path: Path, prefix: str):
    try:
        with path.open("rb") as f:
            yield from ijson.items(f, prefix, use_float=True)
    except ijson.JSONError as e:
        raise KitError(f"surface.json could not be read: {type(e).__name__}.") from None


def _vec3(value) -> tuple[float, float, float] | None:
    try:
        x, y, z = (float(c) for c in value)
    except (TypeError, ValueError):
        return None
    return (x, y, z) if all(math.isfinite(c) for c in (x, y, z)) else None


def texture_from_data_url(url: str) -> PILImage.Image:
    head, _, b64 = str(url).partition(",")
    if not head.startswith("data:image/") or not b64:
        raise KitError("A surface.json patch has no texture image.")
    try:
        with PILImage.open(io.BytesIO(base64.b64decode(b64))) as im:
            tex = im.convert("RGBA")
    except (OSError, ValueError) as e:
        raise KitError("A surface.json patch texture could not be read.") from e
    if max(tex.size) > TEXTURE_MAX_PX:
        tex.thumbnail((TEXTURE_MAX_PX, TEXTURE_MAX_PX), PILImage.NEAREST)
    return tex


def labels_from_kit(item: dict) -> np.ndarray:
    """The kit's label grid (one byte per cell, nonzero = marked) at most 128 px on its long side."""
    w, h = int(item["labelWidth"]), int(item["labelHeight"])
    raw = np.frombuffer(base64.b64decode(item["labels"]), dtype=np.uint8)
    if w <= 0 or h <= 0 or raw.size != w * h:
        raise KitError("A surface.json patch has a label grid of the wrong size.")
    lab = (raw.reshape(h, w) > 0).astype(np.uint8)
    if max(w, h) > LABELS_MAX_PX:
        s = LABELS_MAX_PX / max(w, h)
        small = PILImage.fromarray(lab * 255).resize((max(1, round(w * s)), max(1, round(h * s))), PILImage.NEAREST)
        lab = (np.asarray(small) > 0).astype(np.uint8)
    return lab


def patch_from_kit(item: dict, sx: float = 1.0, sy: float = 1.0) -> PatchData:
    """`sx`, `sy`: stored-image px per kit preview px, for the crop (J3 keeps it in image px)."""
    n = int(item["vertexCount"])
    pos = np.frombuffer(base64.b64decode(item["positions"]), dtype="<f4")
    uvs = np.frombuffer(base64.b64decode(item["uvs"]), dtype="<f4")
    if n <= 0 or n % 3 or pos.size != n * 3 or uvs.size != n * 2:
        raise KitError("A surface.json patch has positions or uvs of the wrong length.")
    return PatchData(
        positions=pos.reshape(n, 3).astype(np.float32),
        uvs=uvs.reshape(n, 2).astype(np.float32),
        texture=texture_from_data_url(item["textureData"]),
        labels=labels_from_kit(item),
        crop=_crop(item.get("sourceCrop"), sx, sy),
        direction=_vec3(item.get("direction")) or (0.0, 0.0, 1.0),
        size=_size(item.get("size")),
    )


def _crop(value, sx: float, sy: float) -> tuple[float, float, float, float]:
    try:
        x0, y0, x1, y1 = (float(c) for c in value)
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0, 0.0)
    return (x0 * sx, y0 * sy, x1 * sx, y1 * sy)


def _size(value) -> tuple[float, float]:
    try:
        w, h = (float(c) for c in value)
    except (TypeError, ValueError):
        return (0.0, 0.0)
    return (w, h)


def _rel(handle, path) -> str:
    p = Path(path)
    return p.relative_to(handle.folder).as_posix() if p.is_absolute() else p.as_posix()


def _placed(kind: str, center, normal, part, patch_path: str | None, version: int) -> dict:
    c = _vec3(center) if kind != "none" else None
    if c is None:
        kind = "none"
    n = _vec3(normal) if c is not None else None
    return {
        "placement": kind,
        "cx": c[0] if c else None,
        "cy": c[1] if c else None,
        "cz": c[2] if c else None,
        "nx": n[0] if n else None,
        "ny": n[1] if n else None,
        "nz": n[2] if n else None,
        "patch_path": patch_path if kind == "patch" else None,
        "placed_version": int(version),
        "part": part,
    }


def replay(
    handle, ctx, asset_model_id: str, version: int, kit: Kit, keys: dict[str, str], lo: float, hi: float,
    scales: dict[str, tuple[float, float]] | None = None,
) -> dict:
    """`keys`: kit key (finding id, or photo id for the photo unit) -> sighting id. `scales`:
    sighting id -> stored-image px per preview px (for the patch crop; 1:1 when absent)."""
    scales = scales or {}
    out_dir = asset_store.model_dir(handle, asset_model_id) / "placements" / f"v{int(version)}"
    out_dir.mkdir(parents=True, exist_ok=True)
    key_field = "finding" if kit.unit == "region" else "photo"
    done: set[str] = set()
    pending: list[tuple[str, dict]] = []
    counts: Counter = Counter()
    total = max(1, len(keys))

    def flush() -> None:
        if pending:
            with handle.session() as s:
                for sid, fields in pending:
                    row = s.get(FindingSighting, sid)
                    if row is None:
                        continue
                    part = fields.pop("part")
                    for name, value in fields.items():
                        setattr(row, name, value)
                    if part and not row.part:
                        row.part = str(part)[:PART_MAX]
            pending.clear()
        ctx.progress(lo + (hi - lo) * len(done) / total, f"Placing sightings {len(done):,} / {len(keys):,}")

    def take(key) -> str | None:
        sid = keys.get(str(key or ""))
        if sid is None or sid in done:
            counts["orphans"] += 1
            return None
        return sid

    for item in _items(kit.surface_path, "patches.item"):
        ctx.check_cancelled()
        sid = take(item.get(key_field))
        if sid is None:
            continue
        try:
            patch = patch_from_kit(item, *scales.get(sid, (1.0, 1.0)))
        except (KitError, KeyError, TypeError, ValueError):
            counts["bad"] += 1  # the sighting stays pending; computing placements fills it later
            continue
        path = write_patch(out_dir, sid, patch)
        done.add(sid)
        pending.append(
            (sid, _placed("patch", item.get("center"), item.get("direction"), item.get("component"), _rel(handle, path), version))
        )
        if len(pending) >= CHUNK:
            flush()
    for item in _items(kit.surface_path, "points.item"):
        ctx.check_cancelled()
        sid = take(item.get("finding") or item.get(key_field))
        if sid is None:
            continue
        done.add(sid)
        pending.append((sid, _placed("point", item.get("center"), item.get("normal"), item.get("component"), None, version)))
        if len(pending) >= CHUNK:
            flush()
    for key in _items(kit.surface_path, "unmapped.item"):
        ctx.check_cancelled()
        sid = take(key)
        if sid is None:
            continue
        done.add(sid)
        pending.append((sid, _placed("none", None, None, None, None, version)))
        if len(pending) >= CHUNK:
            flush()
    flush()
    return {"orphans": counts["orphans"], "bad": counts["bad"]}


def mark_unplaced(handle, sighting_ids: list[str], version: int) -> None:
    """Replay mode, photo unit: a photo's regions other than the largest carry no placement of
    their own (coordinator ruling on N7); its finding takes the largest region's patch."""
    ids = list(sighting_ids)
    with handle.session() as s:
        for i in range(0, len(ids), 500):
            for row in s.execute(select(FindingSighting).where(FindingSighting.id.in_(ids[i : i + 500]))).scalars():
                row.placement, row.placed_version = "none", int(version)
                row.cx = row.cy = row.cz = row.nx = row.ny = row.nz = None
                row.patch_path = None


def placement_counts(handle, sighting_ids: list[str]) -> dict[str, int]:
    out = dict.fromkeys(("patch", "point", "none", "pending"), 0)
    ids = list(sighting_ids)
    with handle.session() as s:
        for i in range(0, len(ids), 500):
            q = (
                select(FindingSighting.placement, func.count())
                .where(FindingSighting.id.in_(ids[i : i + 500]))
                .group_by(FindingSighting.placement)
            )
            for kind, n in s.execute(q).all():
                out[kind] = out.get(kind, 0) + int(n)
    return out
```

In `test_entries_for_unknown_keys_are_counted_not_placed`, two entries are not placed:
- the bad patch for `p01-2` counts in `bad`. `p01-2` is not marked done, so its `unmapped` entry still places it `none`;
- `p99-1` counts in `orphans`.

- [ ] **Step 6: Wire the replay into the import**

In `backend/app/asset_review/kit_import.py`, add the import:

```python
from app.asset_review.kit_replay import mark_unplaced, placement_counts, replay
```

Add the helper:

```python
def _scales(prep: Prepared, written: list[Written]) -> dict[str, tuple[float, float]]:
    """Stored-image px per kit preview px, per sighting (for J3's patch crop)."""
    out = {}
    for w in written:
        m, (pw, ph) = prep.matches[w.kit_photo], prep.previews[w.kit_photo]
        out[w.sighting_id] = (m.width / pw, m.height / ph)
    return out
```

Replace `run_kit_import` with:

```python
@register_job_type(JOB)
def run_kit_import(ctx) -> dict:
    ctx.progress(0, "Reading the kit folder")
    try:
        kit = read_kit(Path(ctx.params["folder"]))
        prep = prepare(ctx, kit)
        if ctx.params.get("dry_run"):
            ctx.progress(1, f"Matched {len(prep.matches):,} of {len(kit.photos):,} kit photos")
            return build_preview(ctx.project, kit, prep, ctx.params)
        return _import(ctx, kit, prep)
    except KitError as e:
        raise JobFailure(str(e)) from None
```

In `_import`, replace the last three lines, from `ctx.progress(1, f"Imported {len(written):,} sightings")` to the end of the function, with:

```python
    ids = [w.sighting_id for w in written]
    placement: dict = {"mode": "none"}
    if kit.surface_path is not None:
        ctx.progress(0.5, "Replaying the kit's placements")
        keys = {w.kit_key: w.sighting_id for w in written if w.primary}
        extra = replay(handle, ctx, mid, version, kit, keys, 0.5, 0.8, scales=_scales(prep, written))
        mark_unplaced(handle, [w.sighting_id for w in written if not w.primary], version)
        placement = {"mode": "replay", **extra}
    placement.update(placement_counts(handle, ids))
    ctx.progress(1, f"Imported {len(written):,} sightings")
    return _result(
        kit, prep, mid, version, poses=poses, statuses=statuses, sightings=len(written),
        skipped=skipped[:MAX_LISTED], placement=placement,
    )
```

- [ ] **Step 7: The frozen selftest (failing test first)**

`backend/tests/test_kit_selftest.py`:

```python
from app.asset_review.kit_selftest import main


def test_selftest_streams_json_and_vectorises(capsys):
    assert main() == 0
    line = capsys.readouterr().out.strip().splitlines()[-1]
    assert line.startswith("review-import ok ") and line.endswith(" 2 2")
```

Run: `& $PY -m pytest tests/test_kit_selftest.py -q`
Expected: FAIL, `ModuleNotFoundError`.

`backend/app/asset_review/kit_selftest.py`:

```python
"""`kestrel-backend.exe review-import-selftest`: proves the frozen bundle carries ijson (and names
the backend it chose; the cp311 wheel's compiled `yajl2_c` is expected) and the cv2 contour
functions the review kit import uses. Prints `review-import ok <backend> <items> <rings>`."""

from __future__ import annotations


def main() -> int:
    import io

    import ijson
    import numpy as np

    from app.asset_review.kit_masks import vectorise

    doc = b'{"patches": [{"photo": "p1", "center": [1.5, 2.0, 3.0]}, {"photo": "p2", "center": [0, 0, 0]}]}'
    items = list(ijson.items(io.BytesIO(doc), "patches.item", use_float=True))
    mask = np.zeros((40, 60), np.uint8)
    mask[5:15, 5:25] = 2
    mask[25:35, 30:55] = 1
    rings = vectorise(mask, {1, 2, 3})
    print(f"review-import ok {ijson.backend} {len(items)} {len(rings)}")
    return 0
```

In `backend/app/__main__.py`:
- In the module docstring, change `` `asset-models-selftest` checks the trimesh GLB builder.`` to `` `asset-models-selftest` checks the trimesh GLB builder and `review-import-selftest` ijson and the cv2 contours of the review kit import.``
- After the `asset-models-selftest` branch (ending `return asset_models_selftest()`), add:

```python
    if len(argv) > 1 and argv[1] == "review-import-selftest":
        from app.asset_review.kit_selftest import main as review_import_selftest

        return review_import_selftest()
```

In `backend/kestrel_backend.spec`, after the line `+ collect_submodules("google.genai")`, add:

```python
    # ijson picks its parser backend by name at import (the compiled yajl2_c, else pure Python), so
    # PyInstaller cannot see it; the review kit import streams surface.json with it (asset findings J5).
    + collect_submodules("ijson")
```

In `backend/scripts/smoke_frozen.ps1`, after the `Complete-Step "asset-models"` line, add:

```powershell

# ijson (compiled backend) + cv2 contours inside the bundle (plan 2026-10-03-asset-findings-j5 Task 5).
$ri = & $exe review-import-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $ri -notmatch "review-import ok yajl2_c 2 2") { throw "review-import selftest failed: $ri" }
Write-Host ($ri.Trim().Split("`n")[-1])
Complete-Step "review-import"
```

In `CONTRIBUTING.md`, after the pypdfium2 paragraph (the one ending "DXF and raster drawings still work."), add:

```markdown
**ijson (the review kit import).** `ijson==3.5.1` (BSD-3) streams a review kit's `surface.json`
(up to 20 MB) one patch at a time (spec 2026-10-02-asset-findings §6.5). It landed through the
overlay-venv rule; a shared venv built before asset findings J5 needs
`uv pip install --python backend\.venv\Scripts\python.exe --no-deps ijson==3.5.1` once before
`pytest` passes. `kestrel_backend.spec` collects `ijson`'s submodules (its backend is chosen by
name at import), and `smoke_frozen.ps1` runs `review-import-selftest` ("review-import ok yajl2_c 2 2").
```

- [ ] **Step 8: Run the tests**

Run: `& $PY -m pytest tests/test_kit_replay.py tests/test_kit_selftest.py tests/test_dependency_pins.py tests/test_kit_import_region.py tests/test_kit_import_photo.py tests/test_kit_import_records.py -q`
Expected: PASS. Then run `& $PY -m app review-import-selftest`. Expected: `review-import ok yajl2_c 2 2`.

- [ ] **Step 9: Lint and commit**

```powershell
& $PY -m ruff check . ; & $PY -m ruff format --check .; cd ..
git add backend/app/asset_review/kit_replay.py backend/app/asset_review/kit_selftest.py backend/app/asset_review/kit_import.py backend/requirements.txt backend/requirements-lock.txt backend/tests/test_dependency_pins.py backend/kestrel_backend.spec backend/app/__main__.py backend/scripts/smoke_frozen.ps1 CONTRIBUTING.md backend/tests/test_kit_replay.py backend/tests/test_kit_selftest.py
git commit -m "feat(asset-review): replay kit surface.json with ijson; review-import selftest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Placement without `surface.json`, grouping, notes and mask attachments

**Files:**
- Create: `backend/app/asset_review/kit_finish.py`
- Modify: `backend/app/asset_review/kit_import.py` (`_import` complete)
- Test: `backend/tests/test_kit_import_end_to_end.py`

**Interfaces:**
- Consumes:
  - **J3:** the job `asset_place` with params `{asset_model_id, only_dirty}`. It queues `asset_group` through `jobs_group.submit_group(handle, runner, ...)` on success; the child context swallows that.
  - **J4:** `app.asset_review.group.load_items(s, asset_model_id)`, `cluster_m_for(model)`, `group_sightings(items, cluster_m)`, `apply_groups(s, handle, asset_model_id, groups) -> GroupResult` (a dataclass: `created`, `kept`, `merged`, `split`).
  - `app.findings.attachments.add(handle, finding_id, source) -> FindingAttachment`; `app.findings.events.mark_changed`.
  - **P1:** `fixtures.synthetic_tower.make_tower(tmp_path, *, photos=False) -> Tower`.
- Produces:
  - **`kit_finish`:**
    - `group_imported(handle, asset_model_id, unit) -> dict` (GroupResult as a dict). The region unit clusters with J4's rule. The photo unit makes one finding per photo, joining all of that photo's region sightings and never clustering by distance (coordinator ruling; J4 groups photo-unit models the same way). EBSM's 78 findings are its 78 finding photos.
    - `finish_findings(handle, ctx, kit, written) -> {notes, attachments}`. A finding with an empty note gets the kit note of its representative sighting (highest severity, then kit order). Each photo-unit sighting's source mask becomes an attachment on its finding, as a lossless palette PNG.
    - `finding_counts(handle, asset_model_id) -> {total, by_severity}` (closed findings excluded).
  - **The final job result:**

    ```
    {dry_run: false, asset_model_id, version, unit, profile, profile_id, photos, matched, matched_by,
     unmatched_count, unmatched, unmatched_reasons,
     poses, statuses, sightings, skipped,
     placement: {mode: "replay" | "computed", patch, point, none, pending, orphans?, bad?},
     grouping: {created, kept, merged, split}, findings: {total, by_severity}, notes, attachments}
    ```

- [ ] **Step 1: Write the failing end-to-end tests**

`backend/tests/test_kit_import_end_to_end.py`:

```python
"""The whole import through the API and the job runner (spec §6.5 steps 1 to 7, §12 "Kit import")."""

import json
import shutil

import numpy as np
import yaml
from fixtures.synthetic_tower import make_tower
from kit_fixtures import (
    PHOTO_PHOTOS,
    PHOTO_SIZE,
    REGION_PHOTOS,
    REGION_SIZE,
    draw_mask,
    kit_patch,
    kit_types,
    make_photo_kit,
    make_region_kit,
    seed_images,
    seed_ready_model,
)
from PIL import Image
from sqlalchemy import select

from app.asset_review.kit_masks import load_mask
from app.db.models import AssetModel, Finding, FindingSighting
from app.findings import attachments

API = "/api/v1/projects"


def start(client, project, wait_job, **body):
    r = client.post(f"{API}/{project['id']}/review-imports", json={"dry_run": False, **body})
    assert r.status_code == 202, r.text
    job = wait_job(project["id"], r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    return job["result"]


def findings_of(handle, mid):
    with handle.session() as s:
        rows = s.execute(
            select(Finding).where(Finding.asset_model_id == mid, Finding.status != "closed").order_by(Finding.number)
        ).scalars().all()
        for f in rows:
            s.expunge(f)
        return rows


def test_region_kit_becomes_grouped_findings_with_the_kits_notes(tmp_path, client, project, handle, wait_job):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    mid = seed_ready_model(handle)
    res = start(client, project, wait_job, folder=str(kit), image_source_id=source_id, asset_model_id=mid,
                class_map={"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]})
    assert res["sightings"] == 3 and res["placement"]["mode"] == "replay"
    assert res["grouping"] == {"created": 2, "kept": 0, "merged": 0, "split": 0}
    assert res["findings"] == {"total": 2, "by_severity": {"1": 1, "2": 1}} and res["notes"] == 2
    by_sev = {f.severity: f for f in findings_of(handle, mid)}
    assert (by_sev[2].sighting_count, by_sev[2].note, by_sev[2].type_id) == (2, "Chipped cladding panel", types["cladding"]["id"])
    assert (by_sev[1].sighting_count, by_sev[1].note) == (1, "Run-off staining")
    with handle.session() as s:
        assert s.scalar(select(FindingSighting.id).where(FindingSighting.finding_id.is_(None))) is None


def test_photo_kit_finding_keeps_its_source_mask(tmp_path, client, project, handle, wait_job):
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    res = start(client, project, wait_job, folder=str(kit), image_source_id=source_id, asset_model_id=mid,
                class_map={"moderate": types["corrosion"]["id"]})
    assert res["sightings"] == 2  # one per mask region
    assert res["findings"] == {"total": 1, "by_severity": {"2": 1}} and res["attachments"] == 1
    (finding,) = findings_of(handle, mid)
    assert (finding.note, finding.sighting_count, finding.placement) == ("Rust at the seam", 2, "patch")
    (att,) = attachments.list_for(handle, finding.id)
    assert att.original_name == "p001 mask.png"
    with Image.open(handle.folder / att.path) as im:
        assert im.mode == "P"
    assert np.array_equal(load_mask(handle.folder / att.path), draw_mask())


def test_photo_unit_sightings_are_never_clustered(tmp_path, client, project, handle, wait_job):
    """Two photos of one spot stay two findings; each photo's regions are one finding."""
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit")
    ass = json.loads((kit / "assessment.json").read_text("utf-8"))
    ass["photos"]["p002"] = {"status": "finding", "severity": 2, "note": "Rust again", "coverage": 1.0, "uncertain": 0.0}
    (kit / "assessment.json").write_text(json.dumps(ass), "utf-8")
    shutil.copy(kit / "masks" / "p001.png", kit / "masks" / "p002.png")
    surface = json.loads((kit / "surface.json").read_text("utf-8"))
    surface["patches"].append(kit_patch({"photo": "p002"}, [0.55, 40.05, -1.0], [0.3, 0.0, -0.95], "Stack"))
    (kit / "surface.json").write_text(json.dumps(surface), "utf-8")
    source_id, _ = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    res = start(client, project, wait_job, folder=str(kit), image_source_id=source_id, asset_model_id=mid,
                class_map={"moderate": types["corrosion"]["id"]})
    assert (res["sightings"], res["findings"]["total"], res["attachments"]) == (4, 2, 2)


def test_without_surface_json_asset_place_runs_inside_the_import(tmp_path, client, project, handle, wait_job):
    """P1's synthetic tower: a new model from the kit's GLB, J3's placement, then grouping; no other
    job is queued (the import runs them in its own thread)."""
    types = kit_types(client, project)
    tower = make_tower(tmp_path / "tower", photos=False)
    by_name = {p["name"]: p for p in tower.poses}
    sightings = [(by_name[s.image_name], s.box) for t in tower.truth for s in t.sightings][:3]
    photos, findings = [], []
    for i, (pose, (x, y, w, h)) in enumerate(sightings):
        kid = f"t{i + 1}"
        photos.append({
            "id": kid, "name": pose["name"], "source_name": f"tower/{kid}_{pose['name']}", "time": pose["time"],
            "sequence": "1", "width": tower.image_size[0], "height": tower.image_size[1],
            "position": list(pose["position"]), "target": list(pose["target"]), "up": list(pose["up"]),
            "hfov": pose["hfov"], "vfov": pose["vfov"],
        })
        findings.append({"id": f"{kid}-1", "photo": kid, "class": "corrosion", "severity": 2,
                         "bbox": [x, y, x + w, y + h], "note": "Rust on a leg"})
    kit = tmp_path / "kit"
    kit.mkdir()
    (kit / "job.yaml").write_text(yaml.safe_dump({
        "job": {"id": "tower", "profile": "telecom-tower"},
        "asset": {"height": tower.frame.height_m},
    }), "utf-8")
    origin = tower.frame.origin
    (kit / "cameras.json").write_text(json.dumps({
        "photos": photos, "alignment": {"origin": [origin.lat, origin.lon, origin.ground_alt_m]},
    }), "utf-8")
    (kit / "assessment.json").write_text(json.dumps({
        "photos": {p["id"]: {"status": "finding", "note": ""} for p in photos}, "findings": findings,
    }), "utf-8")
    shutil.copy(tower.glb_path, kit / "model.glb")
    source_id, _ = seed_images(handle, photos, tower.image_size, scale=1.0)
    res = start(client, project, wait_job, folder=str(kit), image_source_id=source_id,
                new_model_name="Synthetic tower", class_map={"corrosion": types["corrosion"]["id"]})
    assert res["placement"]["mode"] == "computed" and res["placement"]["pending"] == 0
    assert res["sightings"] == 3 and 1 <= res["findings"]["total"] <= 3
    with handle.session() as s:
        m = s.get(AssetModel, res["asset_model_id"])
        assert (m.name, m.current_version) == ("Synthetic tower", 1)
        assert s.scalar(select(FindingSighting.id).where(FindingSighting.finding_id.is_(None))) is None
    jobs = client.get(f"{API}/{project['id']}/jobs").json()["items"]
    assert not {j["type"] for j in jobs} & {"asset_glb_import", "asset_place", "asset_group"}
```

- [ ] **Step 2: Run them to see them fail**

Run: `& $PY -m pytest tests/test_kit_import_end_to_end.py -q`
Expected: FAIL. The first test fails with `KeyError: 'grouping'`, and the tower test with `assert 'none' == 'computed'`.

- [ ] **Step 3: Implement the finishing steps**

`backend/app/asset_review/kit_finish.py`:

```python
"""After the sightings are placed (spec 2026-10-02-asset-findings §6.5 step 7): group them into
findings, then give the new findings the kit's notes and, for the photo unit, the source masks.

Grouping runs here, in the import's thread, through J4's own functions rather than a queued
`asset_group` job, because the notes and the attachments need the findings it creates (ruling N2).
The photo unit is grouped by photo, never by distance: a photo's region sightings are one finding,
and EBSM's 78 findings are its 78 finding photos.
"""

from __future__ import annotations

from dataclasses import asdict

from sqlalchemy import func, select

from app.asset_review import group
from app.asset_review.kit_format import Kit
from app.asset_review.kit_masks import load_mask, write_palette_png
from app.asset_review.kit_sightings import Written
from app.db.models import AssetModel, Finding, FindingSighting
from app.findings import attachments, events

NOTE_MAX = 20000
READ_CHUNK = 500


def _by_photo(s, asset_model_id: str, items) -> list[list[str]]:
    """One group per photo; groups ordered as J4 numbers them: placed first, then highest first."""
    image_of = dict(
        s.execute(
            select(FindingSighting.id, FindingSighting.image_id).where(FindingSighting.asset_model_id == asset_model_id)
        ).all()
    )
    groups: dict[str, list] = {}
    for it in items:
        groups.setdefault(image_of[it.id], []).append(it)

    def key(members) -> tuple:
        ys = [it.center[1] for it in members if it.center is not None]
        return (not ys, -max(ys) if ys else 0.0, min(it.id for it in members))

    return [sorted(it.id for it in g) for g in sorted(groups.values(), key=key)]


def group_imported(handle, asset_model_id: str, unit: str) -> dict:
    with handle.session() as s:
        model = s.get(AssetModel, asset_model_id)
        items = group.load_items(s, asset_model_id)
        if unit == "photo":
            groups = _by_photo(s, asset_model_id, items)
        else:
            groups = group.group_sightings(items, group.cluster_m_for(model))
        result = group.apply_groups(s, handle, asset_model_id, groups)
    return asdict(result)


def finish_findings(handle, ctx, kit: Kit, written: list[Written]) -> dict[str, int]:
    by_id = {w.sighting_id: w for w in written}
    finding_of: dict[str, str] = {}
    ids = list(by_id)
    with handle.session() as s:
        for i in range(0, len(ids), READ_CHUNK):
            q = select(FindingSighting.id, FindingSighting.finding_id).where(FindingSighting.id.in_(ids[i : i + READ_CHUNK]))
            for sid, fid in s.execute(q).all():
                if fid:
                    finding_of[sid] = fid
        best: dict[str, Written] = {}
        for sid, fid in finding_of.items():
            w, cur = by_id[sid], best.get(fid)
            if cur is None or (-w.severity, w.order) < (-cur.severity, cur.order):
                best[fid] = w
        noted = []
        for fid, w in best.items():
            f = s.get(Finding, fid)
            if f is not None and not f.note and w.note:
                f.note = w.note[:NOTE_MAX]
                noted.append(fid)
        events.mark_changed(s, handle.id, noted)
    attached = 0
    tmp_dir = handle.runs_dir / str(ctx.job_id) / "kit-masks"
    masked = [(sid, fid) for sid, fid in finding_of.items() if by_id[sid].mask_path is not None]
    for i, (sid, fid) in enumerate(masked):
        ctx.check_cancelled()
        ctx.progress(0.92 + 0.07 * i / max(1, len(masked)), f"Attaching masks {i:,} / {len(masked):,}")
        w = by_id[sid]
        tmp = write_palette_png(load_mask(w.mask_path), kit.classes, tmp_dir / f"{w.kit_photo} mask.png")
        try:
            attachments.add(handle, fid, str(tmp))
            attached += 1
        finally:
            tmp.unlink(missing_ok=True)
    if tmp_dir.is_dir() and not any(tmp_dir.iterdir()):
        tmp_dir.rmdir()
    return {"notes": len(noted), "attachments": attached}


def finding_counts(handle, asset_model_id: str) -> dict:
    with handle.session() as s:
        q = (
            select(Finding.severity, func.count())
            .where(Finding.asset_model_id == asset_model_id, Finding.status != "closed")
            .group_by(Finding.severity)
        )
        rows = s.execute(q).all()
    return {
        "total": int(sum(n for _, n in rows)),
        "by_severity": {str(sev): int(n) for sev, n in rows if sev is not None},
    }
```

`attachments.add` stores `original_name` as the temp file's name, so the attachment reads `p001 mask.png`.

- [ ] **Step 4: Complete `_import`**

In `backend/app/asset_review/kit_import.py`, add the imports:

```python
from app.asset_review.kit_children import InlineRunner, run_child
from app.asset_review.kit_finish import finding_counts, finish_findings, group_imported
```

(`InlineRunner` is already imported; merge the two lines into one.) Add the constants:

```python
PLACE_JOB = "asset_place"  # J3
GROUP_JOB = "asset_group"  # J4: asset_place queues it; the import groups in-process instead
```

Add `_place`:

```python
def _place(ctx, asset_model_id: str, version: int, kit: Kit, prep: Prepared, written: list[Written]) -> dict:
    """Replay the kit's placements when it has surface.json (spec §6.5 step 6), else run J3's
    `asset_place` here, in this job, with its chained grouping swallowed."""
    ids = [w.sighting_id for w in written]
    if kit.surface_path is not None:
        ctx.progress(0.5, "Replaying the kit's placements")
        keys = {w.kit_key: w.sighting_id for w in written if w.primary}
        extra = replay(ctx.project, ctx, asset_model_id, version, kit, keys, 0.5, 0.8, scales=_scales(prep, written))
        mark_unplaced(ctx.project, [w.sighting_id for w in written if not w.primary], version)
        return {"mode": "replay", **placement_counts(ctx.project, ids), **extra}
    ctx.progress(0.5, "Placing the sightings on the model")
    run_child(
        ctx, PLACE_JOB, {"asset_model_id": asset_model_id, "only_dirty": False}, 0.5, 0.8, swallow=frozenset({GROUP_JOB})
    )
    return {"mode": "computed", **placement_counts(ctx.project, ids)}
```

Replace `_import` with its final form:

```python
def _import(ctx, kit: Kit, prep: Prepared) -> dict:
    handle, params = ctx.project, ctx.params
    class_map = _validate(handle, kit, prep, params)
    mid = _target_model(handle, params, kit)
    version = _ensure_version(ctx, mid, kit)
    ctx.progress(0.12, "Writing the asset frame and review profile")
    write_frame(handle, mid, kit)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    pose_ids: list[str] = []
    written: list[Written] = []
    skipped: list[dict] = []
    try:
        poses = write_poses(handle, ctx, mid, kit, prep.matches, pose_ids)
        planned = plan_sightings(ctx, kit, prep.matches, prep.previews, class_map, skipped)
        write_sightings(handle, ctx, mid, planned, written, skipped)
        statuses = write_statuses(handle, ctx, kit, prep.matches)
    except Exception:
        undo_records(handle, mid, written, pose_ids)  # cancel included: JobCancelled is an Exception
        raise
    # From here the records stand: a later failure leaves sightings pending or ungrouped, and
    # "Compute placements" or "Regroup" finishes them.
    placement = _place(ctx, mid, version, kit, prep, written)
    ctx.check_cancelled()
    ctx.progress(0.8, "Grouping sightings into findings")
    grouping = group_imported(handle, mid, kit.unit)
    finished = finish_findings(handle, ctx, kit, written)
    ctx.publish("findings.changed", {"all": True})
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    findings = finding_counts(handle, mid)
    ctx.progress(1, f"Imported {len(written):,} sightings as {findings['total']:,} findings")
    return _result(
        kit, prep, mid, version, poses=poses, statuses=statuses, sightings=len(written),
        skipped=skipped[:MAX_LISTED], placement=placement, grouping=grouping, findings=findings, **finished,
    )
```

- [ ] **Step 5: Run the unit's tests**

Run: `& $PY -m pytest tests/test_kit_import_end_to_end.py tests/test_kit_replay.py tests/test_kit_import_region.py tests/test_kit_import_photo.py tests/test_kit_import_records.py tests/test_kit_import_dry_run.py tests/test_kit_masks.py tests/test_kit_match.py tests/test_kit_format.py tests/test_kit_selftest.py -q`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```powershell
& $PY -m ruff check . ; & $PY -m ruff format --check .; cd ..
git add backend/app/asset_review/kit_finish.py backend/app/asset_review/kit_import.py backend/tests/test_kit_import_end_to_end.py
git commit -m "feat(asset-review): kit import places, groups, keeps notes and source masks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Landing: shared venv, frozen build and smoke, ADR, gate, merge

**Files:**
- Create: `vault/decisions/2026-10-03-ijson-in-the-frozen-sidecar.md`
- No code changes.

- [ ] **Step 1: Install ijson into the shared venv, additively and safely**

This follows the ADRs `2026-09-24-worktree-overlay-venv-for-new-dependencies` and `2026-10-02-gotcha-shared-venv-install-while-python-runs`. First, list every python running from the shared venv:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq 'E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe' } | Select-Object ProcessId, CommandLine
```

Expected: no rows. If any are listed, wait until they finish and run the check again; never install while one runs. Then install:

```powershell
uv pip freeze --python E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe > $env:TEMP\af-j5-before.txt
uv pip install --python E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe --no-deps ijson==3.5.1
uv pip freeze --python E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe > $env:TEMP\af-j5-after.txt
Compare-Object (Get-Content $env:TEMP\af-j5-before.txt) (Get-Content $env:TEMP\af-j5-after.txt)
```

Expected: exactly one line, `ijson==3.5.1 =>`.

- [ ] **Step 2: Frozen build and smoke**

```powershell
powershell -ExecutionPolicy Bypass -File backend\scripts\build.ps1 -Venv E:\Dev\Yolo\app\backend\.venv
powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1
```

Expected: the smoke prints `review-import ok yajl2_c 2 2` and ends `smoke ok`. If the backend reads `python` rather than `yajl2_c`, the compiled module was not collected. Check `collect_submodules("ijson")` in the spec, rebuild, and do not relax the smoke pattern.

- [ ] **Step 3: Record the ADR**

`vault/decisions/2026-10-03-ijson-in-the-frozen-sidecar.md`:

```markdown
---
type: adr
date: 2026-10-03
status: accepted
tags: [decision, frozen-sidecar, dependencies]
related: ["[[2026-09-24-worktree-overlay-venv-for-new-dependencies]]", "[[2026-09-24-pdf-and-xlsx-in-the-frozen-sidecar]]"]
---

# ijson in the frozen sidecar

## Context

The review kit import (asset findings J5) replays a kit's `surface.json`, 20 MB on DAMAC, with
715 base64 patches. Loading it whole would hold the whole file and its decoded strings in memory
at once, against the bounded-read rule.

## Decision

`ijson==3.5.1` (BSD-3) streams it one patch at a time. The cp311 Windows wheel carries a compiled
backend (`ijson.backends._yajl2`, chosen as `yajl2_c`). ijson picks its backend by name at import,
so `kestrel_backend.spec` collects `collect_submodules("ijson")`. `review-import-selftest`
prints the backend it chose, and `smoke_frozen.ps1` requires `yajl2_c`, so a bundle that silently
fell back to the pure Python parser fails the smoke.

## Consequences

- One new direct dependency, no transitive ones; pinned in both requirements files and in
  `tests/test_dependency_pins.py`.
- A shared venv built before J5 needs the one `uv pip install --no-deps ijson==3.5.1` (CONTRIBUTING).
```

```powershell
git add vault/decisions/2026-10-03-ijson-in-the-frozen-sidecar.md
git commit -m "docs(vault): ADR ijson in the frozen sidecar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: The full gate** (from the worktree root; backend commands now on the shared interpreter)

```powershell
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
cargo test --manifest-path frontend/src-tauri/Cargo.toml  # the frozen sidecar exists after Step 2
```

Expected: all green. `cargo` may not be on PATH; then use `%USERPROFILE%\.cargo\bin\cargo.exe` (CONTRIBUTING).

- [ ] **Step 5: Merge and clean up**

Run `scripts\finish-task.ps1 -Name af-j5`. If it fails on Windows PowerShell 5.1, merge by hand:
1. `git -C E:\Dev\Yolo\app merge --no-ff task/af-j5`, run on `main` in the main checkout after checking the branch with `git branch --show-current`;
2. re-run the backend gate on `main`;
3. remove the worktree by the junction-safe procedure (memory "Worktree removal without losing the venv"). The overlay `backend\.venv` is a real folder with no links;
4. delete `task/af-j5`.

- [ ] **Step 6: Operator walkthrough (how to test this)**

J5 adds no screen; the import runs from the API until a UI unit adds one (see Index notes).
1. Start the app with `pnpm -C frontend dev`. Open a scratch project, and import the EBSM photos (`...\EBSM FLare Stack Inspection\GEOTAGED\`) as an image set.
2. Create an asset model "EBSM flare", and import the EBSM GLB into it from the asset workspace (J1).
3. Send `POST /api/v1/projects/<id>/review-imports` with `{"folder": "<...>\\EBSM Digital Report\\_rebuild\\job", "image_source_id": "<set>", "asset_model_id": "<model>", "dry_run": true}`. Use `Invoke-RestMethod` with the dev token, as `backend/scripts/smoke_import.py` does.
4. In the Jobs panel, open the job: its result lists 299 kit photos, how many matched and how, the unmatched ones with reasons, and the class key `moderate`. Nothing appears in the register.
5. Send the same request with `"dry_run": false` and `"class_map": {"moderate": "<Corrosion type id>"}`, plus `"light"` if the preview listed it. Watch the progress go through matching, poses, sightings, statuses, placing, grouping and masks.
6. Open the register: 78 findings (77 moderate, 1 light), each with its photo note, and 78 patches on the stack. A finding usually has several sightings, one per marked region of its photo (regions from 0.02% of the photo, at most 50). Open one: it has one attachment, the colour mask.
7. Open the image browser filtered by review status: 53 uncertain, 159 no finding, 9 not assessed.
8. Run the same request again: the job fails with "This asset model already holds 78 sightings ...".

---

## Self-review

**Spec coverage (§6.5):**

| Spec step | Where |
| --- | --- |
| Step 1: profile and frame | Task 2 (`frame_from_kit`, `review_from_kit`, `kit_origin`). Zones, levels, silhouette, presets, line azimuth and the origin are covered. The kit's basemap layers are not imported: the app's own basemap proxy works from the origin. |
| Step 2: photo match | Task 1: path, suffix, name, then time and size. Nothing is guessed; unmatched photos are listed with a reason in the dry run and the real run (Review Focus 3: `test_dry_run_reports_unmatched_and_writes_nothing`, `test_real_run_imports_matched_photos_and_reports_the_rest`). |
| Step 3: poses `source = kit` | Task 2. Manual poses are kept. |
| Step 4: review statuses | Task 2, via D1's `set_status`, so `marked_empty` follows. |
| Step 5: region unit | Task 3: `merged.json` polygon else box, rescaled from the preview grid, with severity, group and component. |
| Step 5: photo unit | Task 4: vectorised mask, Douglas-Peucker 1.5 px, holes dropped, one sighting per region (ruling on N7), one finding per photo. |
| Step 5: class mapping confirmed before the job | Dry-run suggestions in Task 1; the real run refuses unmapped keys in Task 2. |
| Step 6: replay | Task 5. |
| Step 6: `asset_place` | Task 6. |
| Step 7: grouping | Task 6. |
| §13: source masks kept as attachments | Task 6. |
| Budget | Bounded reads: streamed `surface.json`, one mask at a time, header-only preview sizes. Chunked commits, and the undo on cancel. |

**Gate:** Task 7 runs the full AGENTS.md gate, plus the frozen build and smoke, because the unit adds a packaged dependency.

**Placeholders:** none. The conditional steps say what to do in each case:
- the stubs module is deleted only if it is empty;
- if J4's backfill exclusion is missing, stop and report it.

## Index notes

- **N1 (J3, checked against J3's plan).** J5 builds J3's `PatchData(positions, uvs, texture, labels, crop, direction, size)` and calls `write_patch(dir, sighting_id, patch) -> str`, writing into `asset_models/<id>/placements/v<n>/`. It runs the job `asset_place` with `{asset_model_id, only_dirty}` and expects it to queue `asset_group` through `submit_group(handle, runner, ...)`; the import's child runner swallows that call. If J3's names differ, only `kit_replay.patch_from_kit` and `kit_import._place` change. J3 also owns `index.json` in that folder; if the placements API reads it rather than the database, J3 must expose a rebuild that J5 calls after the replay.
- **N2 (accepted by the coordinator).** J5 groups in-process with J4's `load_items`, `cluster_m_for`, `group_sightings` and `apply_groups`, because the kit's notes and the EBSM source masks go on the findings grouping creates. J1's GLB import and J3's placement run in-process for the same reason, through `kit_children` (J1 through its own `start_import` with an inline runner).
- **N3 (for J4; J4 is being updated).** Photo-unit models group by photo, never by distance. `kit_finish.group_imported` does the same at import, so EBSM's 78 findings hold after a Regroup too.
- **N4 (for J4, annotations hooks).** An operator's geometry edit on a sighting's box goes through `findings/annotations.on_box_changed`. That hook finds no finding with `annotation_id == box.id` and would **create an image finding** for this accepted person box. J4's note N3 says a geometry edit sets the sighting pending again; the same change must also stop `on_box_changed` from creating a finding when the box has a sighting.
- **N5 (C0, checked against C0's plan).** J5's dry-run result follows C0's `ReviewImportPreview` field for field, and adds `dry_run`, `matched_by`, `unmatched_reasons`, `sightings` and `model`; C0's schema leaves extra properties open. J5 differs from C0's prose in three ways:
  - **An unknown kit profile** fails the dry run as well (`KitError`, so a failed job with the message) rather than returning `profile_id: null`. The kit refuses unknown profiles too.
  - **A real run's refusals** (unmapped classes, a model that already has sightings, no 3D model) are job failures with an operator message, not a synchronous 422 `invalid_import`. They need the kit read, which is the job's work.
  - **409 `job_running`** is answered for a second live real import in the project.
- **N6 (ruled: U2 gets the import dialog).** U2 builds the folder pick, dry-run preview, class-mapping confirmation and Import. J5 serves it through `POST /review-imports` and the job result.
- **N7 (ruled).** Photo-unit masks give one sighting per outer region, from 0.02% of the photo, at most 50 per photo, largest first. All of a photo's sightings join one finding.
  - In replay mode, the photo's `surface.json` patch goes to the largest region's sighting; the others are `none`.
  - Each sighting's coverage is its region's share of the photo, while `image_review.coverage` is the whole mask's.
  - The lossless mask attachment stays, one per photo.
  - EBSM still expects 78 findings (77 moderate, 1 light) and 78 patches. The sighting count is now higher than 78 and is recorded, not pinned.
- **N8 (spec additions J5 makes).**
  - **Kit notes become finding notes** (the representative sighting's note, only when the finding's note is empty). The spec is silent, but the report pages print the note.
  - **Refusals:** an import into a model that already holds sightings is refused, so a re-run cannot duplicate 1,441 boxes. An import is also refused without a ready 3D model or a `model.glb` in the folder; EBSM's `_rebuild\job` has no GLB, so the operator imports it first (J1).
  - **Cancel undoes** this job's sightings, boxes and kit poses.
- **N9 (EBSM origin).** EBSM's alignment gives a reference point and `stack_center_EN`. J5 reads the offset as [east, north] metres from the reference to the stack axis (the model's x = z = 0, since the kit's camera targets sit there). The acceptance run should check that the Overview map pin lands on the flare.
