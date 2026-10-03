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
    {
        "id": "p01",
        "name": "DJI_0001.JPG",
        "source_name": "flight-a/DJI_0001.JPG",
        "time": "2024:06:05 08:24:24",
        "sequence": "1",
    },
    {
        "id": "p02",
        "name": "DJI_0002.JPG",
        "source_name": "flight-a/DJI_0002.JPG",
        "time": "2024:06:05 08:24:30",
        "sequence": "1",
    },
    {
        "id": "p03",
        "name": "DJI_0003.JPG",
        "source_name": "flight-b/DJI_0003.JPG",
        "time": "2024:06:05 09:10:00",
        "sequence": "2",
    },
]
PHOTO_PHOTOS = [
    {
        "id": "p001",
        "name": "1 (1).JPG",
        "source_name": "1 (1).JPG",
        "time": "2019:01:24 11:45:58",
        "sequence": "1",
    },
    {
        "id": "p002",
        "name": "1 (2).JPG",
        "source_name": "1 (2).JPG",
        "time": "2019:01:24 11:46:10",
        "sequence": "1",
    },
    {
        "id": "p003",
        "name": "1 (3).JPG",
        "source_name": "1 (3).JPG",
        "time": "2019:01:24 11:46:20",
        "sequence": "3",
    },
]
TRIANGLE = [[100.0, 600.0], [300.0, 200.0], [500.0, 600.0]]  # merged.json polygon of p01-1 (preview px)
REGION_FINDINGS = [
    {
        "id": "p01-1",
        "photo": "p01",
        "class": "cladding",
        "severity": 2,
        "bbox": [100.0, 200.0, 500.0, 600.0],
        "note": "Chipped cladding panel",
        "confidence": None,
        "component": None,
        "group": "g1",
    },
    {
        "id": "p01-2",
        "photo": "p01",
        "class": "staining",
        "severity": 1,
        "bbox": [1000.0, 1000.0, 1200.0, 1300.0],
        "note": "Run-off staining",
        "confidence": None,
        "component": None,
        "group": None,
    },
    {
        "id": "p02-1",
        "photo": "p02",
        "class": "cladding",
        "severity": 2,
        "bbox": [300.0, 300.0, 700.0, 700.0],
        "note": "Chipped cladding panel",
        "confidence": None,
        "component": "Navy fin",
        "group": "g1",
    },
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
        "job": {
            "id": "test-facade",
            "title": "Test facade",
            "profile": "building-facade",
            "brand": "whitelabel",
        },
        "inputs": {
            "model": "model.glb",
            "cameras": "cameras.json",
            "assessment": "assessment.json",
            "masks": "masks",
            "surface": "surface.json",
        },
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
        [
            {
                "image": "p01",
                "class": "cladding",
                "severity": 2,
                "bbox": [100.0, 200.0, 500.0, 600.0],
                "space": "preview",
                "note": "Chipped cladding panel",
                "polygon": TRIANGLE,
            }
        ],
    )
    if surface:
        _write_json(
            root / "surface.json",
            {
                "version": 1,
                "method": "test",
                "patches": [
                    kit_patch(
                        {"finding": "p01-1", "photo": "p01"}, [1.0, 20.0, 2.0], [0.0, 0.0, 1.0], "Crown"
                    )
                ],
                "points": [
                    {
                        "finding": "p02-1",
                        "photo": "p02",
                        "center": [1.5, 20.5, 2.0],
                        "normal": [0.0, 0.0, 1.0],
                        "component": "Crown",
                    }
                ],
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
        "inputs": {
            "model": "model.glb",
            "cameras": "cameras.json",
            "assessment": "assessment.json",
            "masks": "masks",
            "surface": "surface.json",
        },
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
        {
            "photos": cams,
            "alignment": {
                "reference_latitude": 29.0,
                "reference_longitude": 48.0,
                "ground_altitude_assumed": 31.7,
                "stack_center_EN": [0.0, 0.0],
            },
        },
    )
    _write_json(
        root / "assessment.json",
        {
            "method": "test",
            "photos": {
                "p001": {
                    "status": "finding",
                    "severity": 2,
                    "note": "Rust at the seam",
                    "coverage": 1.25,
                    "uncertain": 0.5,
                },
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
                "patches": [
                    kit_patch(
                        {"photo": "p001", "name": "1 (1).JPG", "grade": 2},
                        [0.5, 40.0, -1.0],
                        [0.3, 0.0, -0.95],
                        "Stack cladding / seam",
                    )
                ],
                "unmapped": [],
            },
        )
    return root


def seed_images(
    handle,
    photos: list[dict],
    size: tuple[int, int],
    *,
    rename: dict | None = None,
    retime: dict | None = None,
    scale: float = 0.5,
) -> tuple[str, dict[str, str]]:
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
        s.add(
            AssetModelVersion(
                model_id=m.id,
                version=1,
                spec={},
                kind="imported",
                glb_status="ready",
                meta={},
                source_ids=[],
                part_count=0,
            )
        )
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
