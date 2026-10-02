# Asset model U4 — look functions (drawings, clouds, photos)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bounded, pure-ish functions that let the agent read the project's drawings, point clouds and photos: an image of a drawing region, the drawing's vector text, a sampled cloud with slices and fits, and a photo crop.

**Architecture:** One package, `app/asset_models/look/`, with three modules. None of them knows about the agent. U5 wraps each one in a tool.
- `drawing.py` reads the rendered `plan.tif` for images, and the source PDF (pypdfium2 text pages) or DXF (ezdxf) for text.
- `cloud.py` builds a per-run **sample** of at most 2 M points in one streamed laspy pass and saves it as `.npz`. Slices and fits run on that sample.
- `photo.py` uses the existing resized-image cache and crops with Pillow.

**Tech Stack:** rasterio, pypdfium2, ezdxf, laspy, numpy and Pillow (all existing); pytest.

**Spec:** §7.3 (as amended in the index: per-run cloud sample; one page per drawing). Index and Global Constraints: `docs/superpowers/plans/2026-10-02-asset-model-builder.md`.

**Needs:** nothing from other units: `ProjectHandle.asset_models_dir` isn't used here, because callers pass destination paths. **Worktree:** `scripts\start-task.ps1 -Name am-u4`.

**Shared result types** (in `app/asset_models/look/__init__.py`):

```python
@dataclass(frozen=True)
class LookImage:
    jpeg: bytes          # JPEG, longest side <= the caller's max
    width: int
    height: int
    note: str = ""       # e.g. "region clipped to the page"
```

---

### Task 1: Drawings — `drawing_view` and `drawing_text`

**Files:**
- Create: `backend/app/asset_models/look/__init__.py`, `backend/app/asset_models/look/drawing.py`
- Create: `backend/tests/look_helpers.py` (fixture builders)
- Test: `backend/tests/test_asset_model_look_drawing.py`

**Interfaces:**
- Consumes:
  - `app.drawings.store.plan_path(handle, drawing_id) -> Path` (the stored RGBA `plan.tif`)
  - `app.drawings.raster_io.read_rgba(src, window=None, out_shape=None) -> np.ndarray` ((4, h, w) uint8)
  - `app.drawings.pdf.open_pdf(path)` (a context manager)
  - the `Drawing` row (`format`, `source_path`, `page`, `extent_src`, `status`)
- Produces:
  - `drawing_view(handle, drawing_id: str, region: list[float] | None = None, *, max_side: int = 1600) -> LookImage`
  - `drawing_text(handle, drawing_id: str, region: list[float] | None = None, *, max_spans: int = 4000) -> TextResult`
  - `TextResult(spans: list[dict], note: str, truncated: bool)`, where each span is `{"text": str, "box": [x0, y0, x1, y1]}` in page fractions with (0, 0) at top-left
  - `LookError(Exception)` with `.message` (e.g. "That drawing is still importing.")

- [ ] **Step 1: Write the fixture helpers**

```python
# backend/tests/look_helpers.py
"""Small drawings, clouds and photos for the look tests (U4)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from reportlab.pdfgen import canvas


def vector_pdf(path: Path) -> Path:
    """A 400 x 200 pt page with a title block text and a dimension."""
    c = canvas.Canvas(str(path), pagesize=(400, 200))
    c.setFont("Helvetica", 10)
    c.drawString(300, 20, "P-00212-DW-MD-143TD1")
    c.drawString(40, 150, "ID 4000")
    c.line(40, 140, 200, 140)
    c.showPage()
    c.save()
    return path


def raster_pdf(path: Path) -> Path:
    """A page carrying only an image (a scan): no text layer."""
    from PIL import Image

    img = path.with_suffix(".png")
    Image.new("RGB", (400, 200), (255, 255, 255)).save(img)
    c = canvas.Canvas(str(path), pagesize=(400, 200))
    c.drawImage(str(img), 0, 0, 400, 200)
    c.showPage()
    c.save()
    return path


def las_cylinder(path: Path, n: int, radius: float = 2.0, height: float = 8.0, origin=(500000.0, 4000000.0, 10.0),
                 seed: int = 0) -> Path:
    import laspy

    rng = np.random.default_rng(seed)
    a = rng.uniform(0, 2 * np.pi, n)
    z = rng.uniform(0, height, n)
    r = radius + rng.normal(0, 0.003, n)
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = [0.001, 0.001, 0.001]
    header.offsets = list(origin)
    las = laspy.LasData(header)
    las.x = origin[0] + r * np.cos(a)
    las.y = origin[1] + r * np.sin(a)
    las.z = origin[2] + z
    las.write(str(path))
    return path
```

Drawing rows in tests: import the drawing through the real API with the existing `drawings_helpers.build_drawing` helper (see `tests/test_drawings_lists.py`), so `plan.tif`, `page` and `extent_src` are real. If `build_drawing` takes a path, pass `vector_pdf(tmp_path / "v.pdf")`.

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_asset_model_look_drawing.py
"""drawing_view / drawing_text (spec §7.3; Review Focus 1)."""

import io

import pytest
from drawings_helpers import build_drawing  # existing helper: imports a file and waits until ready
from look_helpers import raster_pdf, vector_pdf
from PIL import Image

from app.asset_models.look.drawing import LookError, drawing_text, drawing_view


def test_view_whole_page_is_bounded(client, project_id, handle, tmp_path):
    did = build_drawing(client, project_id, vector_pdf(tmp_path / "v.pdf"))
    img = drawing_view(handle, did, max_side=300)
    assert max(img.width, img.height) == 300
    assert Image.open(io.BytesIO(img.jpeg)).size == (img.width, img.height)


def test_view_region_crops(client, project_id, handle, tmp_path):
    did = build_drawing(client, project_id, vector_pdf(tmp_path / "v.pdf"))
    full = drawing_view(handle, did, max_side=1600)
    crop = drawing_view(handle, did, [0.5, 0.5, 1.0, 1.0], max_side=1600)
    assert crop.width / crop.height == pytest.approx(full.width / full.height, rel=0.05)


def test_text_finds_title_block_with_positions(client, project_id, handle, tmp_path):
    did = build_drawing(client, project_id, vector_pdf(tmp_path / "v.pdf"))
    result = drawing_text(handle, did)
    texts = {s["text"].strip(): s["box"] for s in result.spans}
    assert "P-00212-DW-MD-143TD1" in texts
    x0, y0, x1, y1 = texts["P-00212-DW-MD-143TD1"]
    assert x0 > 0.7 and y0 > 0.8          # bottom-right, measured from the top-left
    region = drawing_text(handle, did, [0.0, 0.0, 0.6, 0.5])
    assert [s["text"].strip() for s in region.spans] == ["ID 4000"]


def test_drawing_text_raster_pdf_is_empty_with_note(client, project_id, handle, tmp_path):
    did = build_drawing(client, project_id, raster_pdf(tmp_path / "scan.pdf"))
    result = drawing_text(handle, did)
    assert result.spans == []
    assert "no text layer" in result.note


def test_text_is_capped(client, project_id, handle, tmp_path):
    did = build_drawing(client, project_id, vector_pdf(tmp_path / "v.pdf"))
    result = drawing_text(handle, did, max_spans=1)
    assert len(result.spans) == 1 and result.truncated


def test_unknown_drawing_raises(handle):
    with pytest.raises(LookError):
        drawing_view(handle, "00000000-0000-0000-0000-000000000000")
```

- [ ] **Step 3: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_look_drawing.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Implement**

```python
# backend/app/asset_models/look/__init__.py
"""What the build agent can look at (spec 2026-10-02 §7.3). Every read is bounded."""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image


@dataclass(frozen=True)
class LookImage:
    jpeg: bytes
    width: int
    height: int
    note: str = ""


class LookError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def to_jpeg(img: Image.Image, max_side: int, note: str = "") -> LookImage:
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return LookImage(buf.getvalue(), img.width, img.height, note)


def clamp_region(region) -> tuple[list[float] | None, str]:
    if region is None:
        return None, ""
    x0, y0, x1, y1 = (min(max(float(v), 0.0), 1.0) for v in region)
    if x1 - x0 < 1e-3 or y1 - y0 < 1e-3:
        raise LookError("The region is empty. Give [x0, y0, x1, y1] as fractions with x1 > x0 and y1 > y0.")
    note = "region clipped to the page" if [x0, y0, x1, y1] != list(map(float, region)) else ""
    return [x0, y0, x1, y1], note
```

```python
# backend/app/asset_models/look/drawing.py
"""Drawing images from the rendered plan.tif; text from the source PDF or DXF (spec §7.3)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from app.asset_models.look import LookError, LookImage, clamp_region, to_jpeg
from app.db.models import Drawing
from app.drawings import store as dstore


class TextResult:
    def __init__(self, spans: list[dict], note: str = "", truncated: bool = False):
        self.spans, self.note, self.truncated = spans, note, truncated


def _drawing(handle, drawing_id: str) -> Drawing:
    with handle.session() as s:
        row = s.get(Drawing, drawing_id)
        if row is None:
            raise LookError("There is no drawing with that id in this project.")
        if row.status != "ready":
            raise LookError("That drawing is still importing." if row.status == "importing" else "That drawing failed to import.")
        s.expunge(row)
        return row


def drawing_view(handle, drawing_id: str, region=None, *, max_side: int = 1600) -> LookImage:
    import rasterio
    from rasterio.windows import Window

    from app.drawings.raster_io import read_rgba

    _drawing(handle, drawing_id)
    region, note = clamp_region(region)
    with rasterio.open(dstore.plan_path(handle, drawing_id)) as src:
        W, H = src.width, src.height
        x0, y0, x1, y1 = region or [0.0, 0.0, 1.0, 1.0]
        win = Window(int(x0 * W), int(y0 * H), max(1, int((x1 - x0) * W)), max(1, int((y1 - y0) * H)))
        scale = min(1.0, max_side / max(win.width, win.height))
        out_shape = (max(1, round(win.height * scale)), max(1, round(win.width * scale)))
        rgba = read_rgba(src, window=win, out_shape=out_shape)        # (4, h, w), decimated by GDAL
    rgb = np.moveaxis(rgba[:3], 0, -1)
    alpha = rgba[3][..., None] / 255.0
    flat = (rgb * alpha + 255 * (1 - alpha)).astype(np.uint8)        # transparent -> white paper
    return to_jpeg(Image.fromarray(flat, "RGB"), max_side, note)


def _overlaps(box, region) -> bool:
    return region is None or not (box[2] < region[0] or box[0] > region[2] or box[3] < region[1] or box[1] > region[3])


def _pdf_spans(path: Path, page_n: int) -> list[dict]:
    from app.drawings.pdf import open_pdf

    spans = []
    with open_pdf(path) as pdf:
        page = pdf[page_n - 1]
        w, h = page.get_size()
        tp = page.get_textpage()
        for i in range(tp.count_rects()):
            left, bottom, right, top = tp.get_rect(i)
            text = tp.get_text_bounded(left, bottom, right, top).strip()
            if text:
                spans.append({"text": text, "box": [round(left / w, 4), round(1 - top / h, 4),
                                                     round(right / w, 4), round(1 - bottom / h, 4)]})
        tp.close()
        page.close()
    return spans


def _dxf_spans(path: Path, extent) -> list[dict]:
    import ezdxf

    doc = ezdxf.readfile(str(path))
    minx, miny, maxx, maxy = extent
    sx, sy = (maxx - minx) or 1.0, (maxy - miny) or 1.0
    spans = []
    for e in doc.modelspace().query("TEXT MTEXT"):
        text = (e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text).strip()
        if not text:
            continue
        x, y = e.dxf.insert.x, e.dxf.insert.y
        fx, fy = (x - minx) / sx, 1 - (y - miny) / sy
        spans.append({"text": text, "box": [round(fx, 4), round(fy, 4), round(fx, 4), round(fy, 4)]})
    return spans


def drawing_text(handle, drawing_id: str, region=None, *, max_spans: int = 4000) -> TextResult:
    d = _drawing(handle, drawing_id)
    region, _ = clamp_region(region)
    src = Path(d.source_path)
    if d.format not in ("pdf", "dxf"):
        return TextResult([], "This drawing is a raster image with no text layer - read it with drawing_view.")
    if not src.exists():
        return TextResult([], "The drawing's source file is not reachable - read it with drawing_view.")
    spans = _pdf_spans(src, d.page or 1) if d.format == "pdf" else _dxf_spans(src, d.extent_src or [0, 0, 1, 1])
    spans = [sp for sp in spans if _overlaps(sp["box"], region)]
    if not spans:
        return TextResult([], "This page has no text layer (a scan?) - read it with drawing_view.")
    return TextResult(spans[:max_spans], "", truncated=len(spans) > max_spans)
```

Notes for the implementer:
- If `read_rgba`'s signature differs from `read_rgba(src, window=None, out_shape=None)`, adapt the call, not the test.
- If pypdfium2 5.13's `PdfTextPage` names differ (`count_rects`/`get_rect`/`get_text_bounded`), check with `dir(tp)` and adapt.
- The DXF branch is covered by the existing DXF fixtures in `tests/drawings_helpers.py`. Add a `test_text_from_dxf` that uses one of them, and assert at least one span when the fixture has a TEXT entity. If none of the fixtures has one, add a TEXT entity to a new tiny fixture built with `ezdxf.new()`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_look_drawing.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/look/__init__.py backend/app/asset_models/look/drawing.py backend/tests/look_helpers.py backend/tests/test_asset_model_look_drawing.py
git commit -m "feat(asset-models): drawing view and vector text for the build agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Clouds — sample, slice, fit

**Files:**
- Create: `backend/app/asset_models/look/cloud.py`
- Test: `backend/tests/test_asset_model_look_cloud.py`

**Interfaces:**
- Consumes: `app.pointclouds.rows.get_cloud(handle, cloud_id)`, `rows.require_ready(cloud)`, `app.pointclouds.export.check_source(cloud) -> Path`.
- Produces:
  - `MAX_SAMPLE = 2_000_000`, `CHUNK = 2_000_000`
  - `CloudSample(offset: np.ndarray (3,) float64, xyz: np.ndarray (N,3) float32, total: int)`, with `.points() -> np.ndarray` (float64 absolute coordinates) and `.save(path)` / `CloudSample.load(path)`
  - `sample_cloud(source: Path, *, max_points=MAX_SAMPLE, progress=lambda done, total: None, check_cancelled=lambda: None) -> CloudSample`
  - `source_of(handle, cloud_id) -> Path` (raises `LookError` if not ready or unreachable)
  - `cloud_slice(sample, axis: Literal["x","y","z"], at_m: float, thickness_m: float, *, max_points=5000, image_px=1024) -> SliceResult(png: bytes, points: list[list[float]], in_slab: int, note: str)`
  - `cloud_fit(sample, kind: Literal["circle","cylinder_vertical","plane"], region: list[float] | None, *, max_points=200_000) -> dict`
  - Coordinates in and out are the cloud's own (absolute) metres, with Z up.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_look_cloud.py
"""Cloud sample, slice and fit (spec §7.3 as amended; Review Focus 2)."""

import io

import numpy as np
import pytest
from look_helpers import las_cylinder
from PIL import Image

from app.asset_models.look.cloud import CloudSample, cloud_fit, cloud_slice, sample_cloud
from app.jobs.cancellation import JobCancelled

ORIGIN = (500000.0, 4000000.0, 10.0)


@pytest.fixture(scope="module")
def las(tmp_path_factory):
    return las_cylinder(tmp_path_factory.mktemp("c") / "c.las", 300_000, origin=ORIGIN)


def test_sample_is_bounded_and_single_pass(las, monkeypatch):
    import laspy

    opened = []
    real_open = laspy.open
    monkeypatch.setattr(laspy, "open", lambda *a, **k: opened.append(1) or real_open(*a, **k))
    calls = []
    s = sample_cloud(las, max_points=50_000, progress=lambda d, t: calls.append((d, t)))
    assert len(s.xyz) <= 50_000 and len(s.xyz) > 40_000
    assert s.total == 300_000
    assert len(opened) == 1
    assert calls and calls[-1][0] == calls[-1][1]
    assert s.points()[:, 2].min() >= ORIGIN[2] - 0.01


def test_sample_honours_cancel(las):
    def stop():
        raise JobCancelled()

    with pytest.raises(JobCancelled):
        sample_cloud(las, check_cancelled=stop)


def test_sample_round_trips(las, tmp_path):
    s = sample_cloud(las, max_points=10_000)
    s.save(tmp_path / "s.npz")
    t = CloudSample.load(tmp_path / "s.npz")
    assert np.array_equal(s.xyz, t.xyz) and np.array_equal(s.offset, t.offset)


def test_slice_returns_a_ring_image_and_bounded_points(las):
    s = sample_cloud(las, max_points=100_000)
    r = cloud_slice(s, "z", ORIGIN[2] + 4.0, 0.2, max_points=500)
    assert len(r.points) == 500 and r.in_slab > 500
    pts = np.array(r.points)
    radius = np.hypot(pts[:, 0] - ORIGIN[0], pts[:, 1] - ORIGIN[1])
    assert np.median(radius) == pytest.approx(2.0, abs=0.01)
    assert Image.open(io.BytesIO(r.png)).size[0] <= 1024


def test_fit_circle_and_vertical_cylinder(las):
    s = sample_cloud(las, max_points=200_000)
    box = [ORIGIN[0] - 3, ORIGIN[1] - 3, ORIGIN[2] + 2, ORIGIN[0] + 3, ORIGIN[1] + 3, ORIGIN[2] + 6]
    c = cloud_fit(s, "circle", box)
    assert c["radius"] == pytest.approx(2.0, abs=0.005)
    assert c["center"] == pytest.approx([ORIGIN[0], ORIGIN[1]], abs=0.005)
    assert c["inlier_share"] > 0.95
    cyl = cloud_fit(s, "cylinder_vertical", box)
    assert cyl["radius"] == pytest.approx(2.0, abs=0.005)
    assert abs(cyl["tilt_per_m"][0]) < 0.002 and abs(cyl["tilt_per_m"][1]) < 0.002


def test_fit_plane():
    rng = np.random.default_rng(0)
    xyz = np.column_stack([rng.uniform(0, 4, 5000), rng.uniform(0, 4, 5000), np.full(5000, 0.5)])
    s = CloudSample(np.zeros(3), xyz.astype(np.float32), 5000)
    p = cloud_fit(s, "plane", None)
    assert abs(p["normal"][2]) == pytest.approx(1.0, abs=1e-3)
    assert p["rms_m"] < 1e-4


def test_fit_with_too_few_points_says_so(las):
    s = sample_cloud(las, max_points=10_000)
    r = cloud_fit(s, "circle", [0, 0, 0, 1, 1, 1])
    assert r["n"] < 3 and "too few points" in r["note"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_look_cloud.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/look/cloud.py
"""A per-run cloud sample (<= 2 M points, one streamed pass) and the slices/fits the agent reads.

No server-side octree reader exists (the octree only serves byte ranges to the viewer), so each run
streams the source LAS/LAZ once in 2 M-point chunks, keeps a random share, and saves an .npz the
tools then query. Coordinates are the cloud's own metres, Z up.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.look import LookError

MAX_SAMPLE = 2_000_000
CHUNK = 2_000_000
SEED = 3
AXES = {"x": 0, "y": 1, "z": 2}


@dataclass
class CloudSample:
    offset: np.ndarray
    xyz: np.ndarray
    total: int

    def points(self) -> np.ndarray:
        return self.xyz.astype(np.float64) + self.offset

    def save(self, path: Path) -> None:
        tmp = path.with_name(path.name + ".tmp.npz")
        np.savez(tmp, offset=self.offset, xyz=self.xyz, total=np.array([self.total]))
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> CloudSample:
        with np.load(path) as d:
            return cls(d["offset"], d["xyz"], int(d["total"][0]))


def source_of(handle, cloud_id: str) -> Path:
    from app.errors import AppError
    from app.jobs.cancellation import JobFailure
    from app.pointclouds import export, rows

    try:
        cloud = rows.get_cloud(handle, cloud_id)
        rows.require_ready(cloud)
        return export.check_source(cloud)
    except (AppError, JobFailure) as e:
        raise LookError(f"That point cloud can't be read: {getattr(e, 'message', str(e))}") from None


def sample_cloud(source: Path, *, max_points: int = MAX_SAMPLE, progress=lambda d, t: None,
                 check_cancelled=lambda: None) -> CloudSample:
    import laspy

    rng = np.random.default_rng(SEED)
    parts: list[np.ndarray] = []
    with laspy.open(str(source)) as reader:
        total = int(reader.header.point_count)
        offset = np.asarray(reader.header.mins, dtype=np.float64)
        keep = min(1.0, max_points / max(total, 1))
        done = 0
        for chunk in reader.chunk_iterator(CHUNK):
            check_cancelled()
            n = len(chunk)
            mask = rng.random(n) < keep
            if mask.any():
                xyz = np.column_stack([np.asarray(chunk.x)[mask], np.asarray(chunk.y)[mask], np.asarray(chunk.z)[mask]])
                parts.append((xyz - offset).astype(np.float32))
            done += n
            progress(done, total)
    xyz = np.concatenate(parts) if parts else np.zeros((0, 3), np.float32)
    if len(xyz) > max_points:
        xyz = xyz[np.sort(rng.choice(len(xyz), max_points, replace=False))]
    progress(total, total)
    return CloudSample(offset, xyz, total)


def _in_box(pts: np.ndarray, region) -> np.ndarray:
    if region is None:
        return pts
    lo, hi = np.asarray(region[:3]), np.asarray(region[3:])
    return pts[np.all((pts >= lo) & (pts <= hi), axis=1)]


def _cap(pts: np.ndarray, n: int) -> np.ndarray:
    if len(pts) <= n:
        return pts
    rng = np.random.default_rng(SEED)
    return pts[np.sort(rng.choice(len(pts), n, replace=False))]


@dataclass(frozen=True)
class SliceResult:
    png: bytes
    points: list[list[float]]
    in_slab: int
    note: str = ""


def _nice_step(span: float) -> float:
    raw = span / 6
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    return next(m * mag for m in (1, 2, 5, 10) if m * mag >= raw)


def cloud_slice(sample: CloudSample, axis: str, at_m: float, thickness_m: float, *, max_points: int = 5000,
                image_px: int = 1024) -> SliceResult:
    k = AXES[axis]
    pts = sample.points()
    slab = pts[np.abs(pts[:, k] - at_m) <= thickness_m / 2]
    if len(slab) == 0:
        blank = Image.new("RGB", (256, 64), (20, 26, 36))
        buf = io.BytesIO()
        blank.save(buf, "PNG")
        return SliceResult(buf.getvalue(), [], 0, "no points in that slab - check at_m against the cloud's bounds")
    a, b = [i for i in range(3) if i != k]
    u, v = slab[:, a], slab[:, b]
    span = max(float(np.ptp(u)), float(np.ptp(v))) or 1.0
    size = min(image_px, 1024)
    margin = 48
    scale = (size - 2 * margin) / span
    img = Image.new("RGB", (size, size), (20, 26, 36))
    draw = ImageDraw.Draw(img)
    px = margin + (u - u.min()) * scale
    py = size - margin - (v - v.min()) * scale
    for x, y in zip(px[:200_000], py[:200_000]):
        draw.point((float(x), float(y)), fill=(120, 200, 255))
    font = ImageFont.load_default()
    step = _nice_step(span)
    names = "xyz"
    for t in np.arange(math.ceil(u.min() / step) * step, u.max() + 1e-9, step):
        x = margin + (t - u.min()) * scale
        draw.line([(x, size - margin), (x, size - margin + 5)], fill=(200, 200, 200))
        draw.text((x, size - margin + 8), f"{t:.2f}", fill=(200, 200, 200), font=font, anchor="mt")
    for t in np.arange(math.ceil(v.min() / step) * step, v.max() + 1e-9, step):
        y = size - margin - (t - v.min()) * scale
        draw.line([(margin - 5, y), (margin, y)], fill=(200, 200, 200))
        draw.text((margin - 8, y), f"{t:.2f}", fill=(200, 200, 200), font=font, anchor="rm")
    draw.text((margin, 8), f"slice {names[k]} = {at_m:.3f} m +/- {thickness_m / 2:.3f} m; "
                           f"horizontal {names[a]}, vertical {names[b]}", fill=(230, 230, 230), font=font)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    out = _cap(slab, max_points)
    return SliceResult(buf.getvalue(), np.round(out, 3).tolist(), int(len(slab)))


def _kasa(xy: np.ndarray) -> tuple[np.ndarray, float]:
    A = np.column_stack([2 * xy, np.ones(len(xy))])
    sol = np.linalg.lstsq(A, (xy**2).sum(1), rcond=None)[0]
    c = sol[:2]
    return c, float(math.sqrt(max(sol[2] + c @ c, 0.0)))


def _ransac_circle(xy: np.ndarray, thr: float = 0.02, iters: int = 500):
    rng = np.random.default_rng(SEED)
    best = None
    for _ in range(iters):
        s = xy[rng.choice(len(xy), 3, replace=False)]
        try:
            c, r = _kasa(s)
        except np.linalg.LinAlgError:
            continue
        inl = np.abs(np.linalg.norm(xy - c, axis=1) - r) < thr
        if best is None or inl.sum() > best.sum():
            best = inl
    c, r = _kasa(xy[best])
    resid = np.linalg.norm(xy[best] - c, axis=1) - r
    return c, r, float(np.sqrt((resid**2).mean())), float(best.mean())


def cloud_fit(sample: CloudSample, kind: str, region, *, max_points: int = 200_000) -> dict:
    pts = _cap(_in_box(sample.points(), region), max_points)
    if len(pts) < 3 or (kind == "cylinder_vertical" and len(pts) < 30):
        return {"kind": kind, "n": int(len(pts)), "note": "too few points in that region to fit"}
    if kind == "plane":
        centroid = pts.mean(0)
        _, _, vt = np.linalg.svd(pts - centroid, full_matrices=False)
        normal = vt[2]
        resid = (pts - centroid) @ normal
        return {"kind": kind, "n": int(len(pts)), "normal": np.round(normal, 5).tolist(),
                "point": np.round(centroid, 4).tolist(), "rms_m": float(np.sqrt((resid**2).mean())), "note": ""}
    if kind == "circle":
        c, r, rms, share = _ransac_circle(pts[:, :2])
        return {"kind": kind, "n": int(len(pts)), "center": np.round(c, 4).tolist(), "radius": round(r, 4),
                "rms_m": round(rms, 5), "inlier_share": round(share, 4), "note": "fitted in plan (x, y)"}
    # cylinder_vertical: circle centres per 0.5 m slab, then a line through them
    z = pts[:, 2]
    zs, cs, rs = [], [], []
    for z0 in np.arange(z.min(), z.max(), 0.5):
        sl = pts[(z >= z0) & (z < z0 + 0.5)]
        if len(sl) >= 30:
            c, r, _, share = _ransac_circle(sl[:, :2], iters=200)
            if share > 0.5:
                zs.append(z0 + 0.25)
                cs.append(c)
                rs.append(r)
    if len(zs) < 2:
        return {"kind": kind, "n": int(len(pts)), "note": "too few points per height band to fit a cylinder"}
    zs, cs = np.array(zs), np.array(cs)
    slope = np.polyfit(zs, cs, 1)[0]
    base = cs.mean(0) - slope * (zs.mean() - z.min())
    return {"kind": kind, "n": int(len(pts)), "axis_point": np.round([*base, z.min()], 4).tolist(),
            "tilt_per_m": np.round(slope, 5).tolist(), "radius": round(float(np.median(rs)), 4),
            "radius_spread_m": round(float(np.ptp(rs)), 4), "bands": int(len(zs)), "note": ""}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_look_cloud.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/look/cloud.py backend/tests/test_asset_model_look_cloud.py
git commit -m "feat(asset-models): bounded cloud sample, slices and fits for the build agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Photos — `photo_view`

**Files:**
- Create: `backend/app/asset_models/look/photo.py`
- Test: `backend/tests/test_asset_model_look_photo.py`

**Interfaces:**
- Consumes: `app.datasets.images.image_file(handle, image_id, max_side: int | None) -> Path`.
- Produces: `photo_view(handle, image_id: str, region: list[float] | None = None, *, max_side: int = 1600) -> LookImage`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_model_look_photo.py
import io

import pytest
from PIL import Image

from app.asset_models.look import LookError
from app.asset_models.look.photo import photo_view


def test_whole_photo_is_downscaled(client, project_id, handle, make_jpeg, tmp_path):
    image_id = make_jpeg(client, project_id, size=(4000, 3000))  # existing conftest helper: imports one photo
    img = photo_view(handle, image_id, max_side=800)
    assert (img.width, img.height) == (800, 600)


def test_region_crop_keeps_detail(client, project_id, handle, make_jpeg):
    image_id = make_jpeg(client, project_id, size=(4000, 3000))
    img = photo_view(handle, image_id, [0.0, 0.0, 0.25, 0.25], max_side=1600)
    assert (img.width, img.height) == (1000, 750)
    Image.open(io.BytesIO(img.jpeg)).verify()


def test_unknown_photo(handle):
    with pytest.raises(LookError):
        photo_view(handle, "nope")
```

If `make_jpeg`'s signature differs (check `conftest.py`), adapt the calls so that a 4000×3000 photo is imported into the project. Keep the assertions.

- [ ] **Step 2: Run it to verify it fails**

Run: `$PY -m pytest tests/test_asset_model_look_photo.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/look/photo.py
"""Photos for the build agent: the cached downscale for a whole view, the original for a crop."""

from __future__ import annotations

from PIL import Image

from app.asset_models.look import LookError, LookImage, clamp_region, to_jpeg
from app.errors import AppError


def photo_view(handle, image_id: str, region=None, *, max_side: int = 1600) -> LookImage:
    from app.datasets.images import image_file

    region, note = clamp_region(region)
    try:
        path = image_file(handle, image_id, None if region else max_side)
    except AppError:
        raise LookError("There is no photo with that id in this project.") from None
    with Image.open(path) as img:
        if region:
            W, H = img.size
            box = (int(region[0] * W), int(region[1] * H), int(region[2] * W), int(region[3] * H))
            img.draft("RGB", (box[2] - box[0], box[3] - box[1]))  # JPEG: decode no larger than needed
            W2, H2 = img.size
            if (W2, H2) != (W, H):
                box = tuple(int(c * W2 / W) if i % 2 == 0 else int(c * H2 / H) for i, c in enumerate(box))
            img = img.crop(box)
        return to_jpeg(img, max_side, note)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `$PY -m pytest tests/test_asset_model_look_photo.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/look/photo.py backend/tests/test_asset_model_look_photo.py
git commit -m "feat(asset-models): photo view for the build agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Land

- [ ] **Step 1:** `$PY -m ruff check app/asset_models tests; $PY -m ruff format --check app/asset_models tests; $PY -m pytest tests/test_asset_model_look_*.py -q`. Expected: clean.
- [ ] **Step 2:** `scripts\finish-task.ps1`, or the manual fallback described in U1 Task 6.
