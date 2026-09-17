# S1: Dataset Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the S0 501 stubs for `sources`, `images`, `boxes` and `datasets` with the real dataset subsystem: import job (convert, downscale, dedupe, group, EXIF), image listing with filters and keyset pagination, image file and thumbnail serving, box CRUD and review, dataset freeze/split/materialise, and statistics.

**Architecture:** Everything lives in `backend/app/datasets/`. Long work runs through the S0 job runner (`register_job_type`), one job type `import` and one `dataset`. Image preparation is a pure module ported from `E:\Dev\Yolo\scripts\prepare_images.py` and runs in a `ProcessPoolExecutor`; the job thread batches DB writes every 50 images and publishes `images.changed`. Queries use SQLAlchemy 2 against the per-project SQLite engine through `ProjectHandle.session()`.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2, Pillow 12, ImageHash 4.3.2, pytest, schemathesis (existing `tests/test_contract.py`).

**Spec:** `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` section 5 (owned), plus sections 4, 6 (box semantics), 9 and 12. Contract: `contract/openapi.yaml` (source of truth; do not edit it).

## Global Constraints

- Contract paths carry `/api/v1`; response shapes must match `contract/openapi.yaml` exactly. Do not edit the contract; if you need a change, stop and report it (the goal owner edits the contract).
- Boxes are image pixels `x, y, w, h`. `review_state` in {unreviewed, accepted, rejected, edited}; accepted and edited are ground truth. Person-created boxes: `provenance.kind = person`, `review_state = accepted`.
- Every list endpoint paginates with `limit` (default 100, max 1000) and `cursor` via `app.pagination.encode_cursor/decode_cursor/clamp_limit`.
- Errors use `AppError` (`app.errors`): `not_found`, `validation_error` (422), `already_exists` (409), `conflict` (409).
- Import defaults (spec 5): JPEG quality 95, EXIF rotation applied and EXIF preserved, downscale when the long side exceeds 4000 px, phash Hamming distance <= 4 is a duplicate (later file is the duplicate), group key priority: filename regex `flight` group, then 250 m geographic tile from GPS, then the source site. Originals are never modified. Re-import picks up new files only.
- Tests use a temporary project folder per test (fixtures in `tests/conftest.py`). Real frames come from `E:\Dev\Yolo\data\raw\ahmadia` (copy 20, never point at the originals under `E:\Dev\Yolo\Ahmadia Construction Data`); skip those tests when the folder is absent. Never modify anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`.
- Ground truth for assertions: `E:\Dev\Yolo\data\manifests\ahmadia.csv` (prepared width 4000, height 2667, phash per file, e.g. `IX-12-02491_0031_0001.jpg` -> `82a81f67f94615ae`) and `E:\Dev\Yolo\ahmadia_inventory.csv` (EXIF `datetime_original` `2019:04:15 06:35:36`, lat 29.49469, lon 47.76513, alt 191.3 for that frame; 3299 frames, 7 flights 0031, 0033, 0034, 0035, 0038, 0040, 0042 across two cameras `IX-12-02491` and `IX-12-65292`).
- Shared files S1 may touch: `app/datasets/**` (owned), `app/projects/router.py` only the `project_stats` function, `tests/test_contract.py` only the `EXPECTED_STUBS` set, `tests/conftest.py` (add fixtures only). Nothing else outside `app/datasets` and `tests/`.
- Job functions must call `ctx.check_cancelled()` at least every few seconds and never block without polling `ctx.cancelled`.
- TDD for every task: failing test first, run it, implement, run again, commit. Lint: `ruff check` and `ruff format --check` clean. Commands run from `backend/` with `.\.venv\Scripts\python.exe`.

## Interfaces from S0 you build on (read these files first)

- `app/projects/service.py`: `ProjectHandle` (`id`, `folder`, `images_dir`, `labels_dir`, `datasets_dir`, `runs_dir`, `thumbs_dir`, `session()` context manager, `row(s)`), `get_project` dependency (`Depends(get_project)` on path param `projectId`).
- `app/db/models.py`: `Source`, `Image`, `Box`, `Dataset`, `DatasetImage`, `Project` columns. `Image.path` is relative to the project folder with forward slashes. `Image.phash` is the 16-hex-char phash string.
- `app/jobs/registry.py`: `@register_job_type("import")`. `app/jobs/runner.py`: `JobContext` (`project`, `params`, `log`, `progress(fraction, message)`, `check_cancelled()`, `publish(type, payload)`); `request.app.state.jobs.submit(handle, "import", params) -> Job`.
- `app/jobs/schemas.py`: `JobOut.from_row(row, project_id)` for the `job` part of `SourceWithJob` and `DatasetWithJob`.
- `app/pagination.py`: `encode_cursor(**kv)`, `decode_cursor(s, *required)`, `clamp_limit(limit)`.
- `app/projects/schemas.py`: `ImportSettings`, `Stats`, `CountByClass`, `SourceCount`, `GroupCount`, `ResolutionBucket`, `TimeRange`, `GpsBounds`, `ClassDef`.
- `app/stubs.py` / `app/datasets/router.py`: the current stub router you replace entirely.

## File structure

```
backend/app/datasets/
  __init__.py
  router.py        FastAPI routes for sources, images, boxes, datasets (replaces the stub file)
  schemas.py       pydantic models for every request/response of those resources (contract shapes)
  prepare.py       pure image preparation: list files, convert/downscale, phash, EXIF (port of prepare_images.py)
  grouping.py      duplicate detection and group-key derivation (regex, 250 m tile, source)
  importer.py      the "import" job: process pool, batching, DB writes, duplicates file, events
  images.py        image queries: filters, sort, keyset pagination, counts, file/thumbnail serving, bulk delete
  boxes.py         box create/update/delete/review with provenance and review-state rules
  splits.py        train/val assignment: by_group, by_tile, random (seeded)
  materialise.py   the "dataset" job: hard links or copies, YOLO label files, data.yaml
  stats.py         project, source and dataset statistics
backend/tests/
  conftest.py      (+) sample_frames, make_jpeg, project fixtures
  test_prepare.py  test_grouping.py  test_import.py  test_images.py  test_boxes.py  test_datasets.py  test_stats.py
```

---

### Task 1: Test fixtures (sample frames and synthetic JPEGs)

**Files:**
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_fixtures.py`

**Interfaces:**
- Produces: fixture `ahmadia_sample(n=20) -> Path` (session-scoped copy of the first `n` files of `E:\Dev\Yolo\data\raw\ahmadia` into a session temp dir; `pytest.skip` when the folder is missing); fixture `make_jpeg` returning `make_jpeg(path: Path, width: int, height: int, *, seed: int = 0, exif: dict | None = None) -> Path` that writes a JPEG with random noise (seeded) and optional EXIF (`DateTimeOriginal`, `lat`, `lon`, `alt`); fixture `project(client, project_dir) -> dict` creating a project with the eight classes and returning the JSON.

- [ ] **Step 1: Failing test**

```python
# tests/test_fixtures.py
from PIL import Image


def test_make_jpeg_writes_exif(make_jpeg, tmp_path):
    p = make_jpeg(tmp_path / "a.jpg", 640, 480, exif={"DateTimeOriginal": "2019:04:15 06:35:36", "lat": 29.5, "lon": 47.7, "alt": 191.0})
    im = Image.open(p)
    assert im.size == (640, 480)
    assert im.getexif().get_ifd(0x8769).get(36867) == "2019:04:15 06:35:36"


def test_ahmadia_sample_has_twenty_frames(ahmadia_sample):
    files = sorted(ahmadia_sample.glob("*.jpg"))
    assert len(files) == 20 and files[0].name == "IX-12-02491_0031_0001.jpg"
```

- [ ] **Step 2: Run** `.\.venv\Scripts\python.exe -m pytest -q tests/test_fixtures.py` -> fails (fixture not found).

- [ ] **Step 3: Implement in `tests/conftest.py`**

```python
import shutil
from pathlib import Path

import numpy as np
import piexif
import pytest
from PIL import Image

AHMADIA_RAW = Path(r"E:\Dev\Yolo\data\raw\ahmadia")
EIGHT_CLASSES = ["excavator", "wheel_loader", "bulldozer", "dump_truck", "crane", "concrete_mixer", "roller", "backhoe"]
COLOURS = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"]


def _deg_to_dms_rational(value: float):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = round((value - d - m / 60) * 3600 * 10000)
    return ((d, 1), (m, 1), (s, 10000))


@pytest.fixture
def make_jpeg():
    def _make(path: Path, width: int, height: int, *, seed: int = 0, exif: dict | None = None) -> Path:
        rng = np.random.default_rng(seed)
        arr = rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8)
        im = Image.fromarray(arr, "RGB")
        kwargs = {"quality": 90}
        if exif:
            zeroth, exif_ifd, gps = {}, {}, {}
            if "DateTimeOriginal" in exif:
                exif_ifd[piexif.ExifIFD.DateTimeOriginal] = exif["DateTimeOriginal"]
            if "lat" in exif:
                gps[piexif.GPSIFD.GPSLatitudeRef] = "N" if exif["lat"] >= 0 else "S"
                gps[piexif.GPSIFD.GPSLatitude] = _deg_to_dms_rational(exif["lat"])
                gps[piexif.GPSIFD.GPSLongitudeRef] = "E" if exif["lon"] >= 0 else "W"
                gps[piexif.GPSIFD.GPSLongitude] = _deg_to_dms_rational(exif["lon"])
            if "alt" in exif:
                gps[piexif.GPSIFD.GPSAltitudeRef] = 0
                gps[piexif.GPSIFD.GPSAltitude] = (int(exif["alt"] * 100), 100)
            kwargs["exif"] = piexif.dump({"0th": zeroth, "Exif": exif_ifd, "GPS": gps})
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, "JPEG", **kwargs)
        return path

    return _make


@pytest.fixture(scope="session")
def ahmadia_sample(tmp_path_factory) -> Path:
    if not AHMADIA_RAW.is_dir():
        pytest.skip("E:\\Dev\\Yolo\\data\\raw\\ahmadia not present")
    dest = tmp_path_factory.mktemp("ahmadia_sample")
    for src in sorted(AHMADIA_RAW.glob("*.jpg"))[:20]:
        shutil.copy2(src, dest / src.name)
    return dest


@pytest.fixture
def project(client, project_dir) -> dict:
    classes = [{"name": n, "colour": c, "hotkey": str(i + 1)} for i, (n, c) in enumerate(zip(EIGHT_CLASSES, COLOURS))]
    r = client.post("/api/v1/projects", json={"name": "T", "folder": str(project_dir), "classes": classes})
    assert r.status_code == 201, r.text
    return r.json()
```

`piexif` is in `requirements.txt` (S0 added it); `numpy` too. Keep the existing fixtures (`settings`, `app`, `client`, `anon`, `project_dir`) untouched.

- [ ] **Step 4: Run** the two tests -> pass. **Step 5: Commit** `git commit -m "test(datasets): fixtures for sample frames and synthetic jpegs"`.

---

### Task 2: Image preparation core (`prepare.py`)

**Files:**
- Create: `backend/app/datasets/prepare.py`, `backend/tests/test_prepare.py`

**Interfaces:**
- Produces:
  - `IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}`
  - `list_images(folder: Path) -> list[Path]` sorted recursive listing of files with those extensions.
  - `unique_dest(dest_dir: Path, stem: str, taken: set[str]) -> Path` (`a.png` and `a.jpg` do not collide; appends `_1`, `_2`).
  - `@dataclass Prepared: dest: str; width: int; height: int; phash: str; capture_time: datetime | None; lat: float | None; lon: float | None; alt: float | None; action: str ("converted" | "downscaled" | "existing" | "failed"); error: str`
  - `process_one(src: str, dest: str, max_side: int, quality: int) -> Prepared` (runs in a worker process; returns `action="failed"` with `error=repr(e)` instead of raising; if `dest` exists it only reads size/phash/EXIF and reports `existing`).
  - `read_exif(im: Image.Image) -> tuple[datetime | None, float | None, float | None, float | None]` (DateTimeOriginal parsed as naive local time and returned as UTC-aware by assuming UTC; GPS DMS rationals to decimal degrees with N/S E/W sign; altitude rational to metres).

- [ ] **Step 1: Failing tests**

```python
# tests/test_prepare.py
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image

from app.datasets.prepare import list_images, process_one, read_exif, unique_dest


def test_list_images_filters_and_sorts(tmp_path, make_jpeg):
    make_jpeg(tmp_path / "b.jpg", 8, 8)
    make_jpeg(tmp_path / "sub" / "a.JPG", 8, 8)
    (tmp_path / "notes.txt").write_text("x")
    assert [p.name for p in list_images(tmp_path)] == ["b.jpg", "a.JPG"] or [p.name for p in list_images(tmp_path)] == ["a.JPG", "b.jpg"]
    assert all(p.suffix.lower() == ".jpg" for p in list_images(tmp_path))


def test_unique_dest_avoids_collisions(tmp_path):
    taken: set[str] = set()
    assert unique_dest(tmp_path, "a", taken).name == "a.jpg"
    assert unique_dest(tmp_path, "a", taken).name == "a_1.jpg"
    assert unique_dest(tmp_path, "A", taken).name == "A_2.jpg"  # case-insensitive filesystem


def test_process_one_downscales_and_keeps_exif(tmp_path, make_jpeg):
    src = make_jpeg(tmp_path / "src.jpg", 6000, 4000, exif={"DateTimeOriginal": "2019:04:15 06:35:36", "lat": 29.49469, "lon": 47.76513, "alt": 191.3})
    out = process_one(str(src), str(tmp_path / "out.jpg"), max_side=4000, quality=95)
    assert out.action == "downscaled" and (out.width, out.height) == (4000, 2667)
    assert out.capture_time == datetime(2019, 4, 15, 6, 35, 36, tzinfo=UTC)
    assert abs(out.lat - 29.49469) < 1e-4 and abs(out.lon - 47.76513) < 1e-4 and abs(out.alt - 191.3) < 0.01
    assert len(out.phash) == 16
    with Image.open(tmp_path / "out.jpg") as im:
        assert im.getexif().get_ifd(0x8769).get(36867) == "2019:04:15 06:35:36"


def test_process_one_converts_png_without_downscale(tmp_path):
    Image.new("RGBA", (300, 200), (10, 20, 30, 255)).save(tmp_path / "x.png")
    out = process_one(str(tmp_path / "x.png"), str(tmp_path / "x.jpg"), 4000, 95)
    assert out.action == "converted" and (out.width, out.height) == (300, 200) and out.capture_time is None


def test_process_one_reports_failure_instead_of_raising(tmp_path):
    (tmp_path / "bad.jpg").write_bytes(b"not an image")
    out = process_one(str(tmp_path / "bad.jpg"), str(tmp_path / "bad_out.jpg"), 4000, 95)
    assert out.action == "failed" and out.error


def test_process_one_existing_dest_is_reused(tmp_path, make_jpeg):
    src = make_jpeg(tmp_path / "s.jpg", 100, 50)
    dest = tmp_path / "d.jpg"
    first = process_one(str(src), str(dest), 4000, 95)
    second = process_one(str(src), str(dest), 4000, 95)
    assert second.action == "existing" and second.phash == first.phash


def test_real_frame_matches_manifest(ahmadia_sample, tmp_path):
    out = process_one(str(ahmadia_sample / "IX-12-02491_0031_0001.jpg"), str(tmp_path / "o.jpg"), 4000, 95)
    assert (out.width, out.height) == (4000, 2667) and out.phash == "82a81f67f94615ae"
    assert out.capture_time == datetime(2019, 4, 15, 6, 35, 36, tzinfo=UTC)
    assert abs(out.lat - 29.49469) < 1e-4 and abs(out.lon - 47.76513) < 1e-4
```

- [ ] **Step 2: Run** -> ImportError. **Step 3: Implement `prepare.py`**

```python
"""Image preparation ported from E:\\Dev\\Yolo\\scripts\\prepare_images.py. Pure functions, process-pool safe."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import imagehash
from PIL import Image, ImageOps

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
EXIF_IFD, GPS_IFD = 0x8769, 0x8825
TAG_DATETIME_ORIGINAL = 36867


def list_images(folder: Path) -> list[Path]:
    return sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS)


def unique_dest(dest_dir: Path, stem: str, taken: set[str]) -> Path:
    name, i = f"{stem}.jpg", 1
    while name.lower() in taken:
        name = f"{stem}_{i}.jpg"
        i += 1
    taken.add(name.lower())
    return dest_dir / name


@dataclass
class Prepared:
    dest: str
    width: int = 0
    height: int = 0
    phash: str = ""
    capture_time: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    alt: float | None = None
    action: str = "failed"
    error: str = ""


def _dms(value) -> float:
    d, m, s = (float(v) for v in value)
    return d + m / 60 + s / 3600


def read_exif(im: Image.Image):
    exif = im.getexif()
    capture = lat = lon = alt = None
    raw = exif.get_ifd(EXIF_IFD).get(TAG_DATETIME_ORIGINAL)
    if raw:
        try:
            capture = datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S").replace(tzinfo=UTC)
        except ValueError:
            capture = None
    gps = exif.get_ifd(GPS_IFD)
    if gps.get(2) and gps.get(4):
        lat = _dms(gps[2]) * (-1 if gps.get(1) == "S" else 1)
        lon = _dms(gps[4]) * (-1 if gps.get(3) == "W" else 1)
    if gps.get(6) is not None:
        alt = float(gps[6]) * (-1 if gps.get(5) == 1 else 1)
    return capture, lat, lon, alt


def process_one(src: str, dest: str, max_side: int, quality: int) -> Prepared:
    out = Prepared(dest=dest)
    try:
        if Path(dest).exists():
            with Image.open(dest) as im:
                out.width, out.height = im.size
                out.phash = str(imagehash.phash(im))
                out.capture_time, out.lat, out.lon, out.alt = read_exif(im)
            out.action = "existing"
            return out
        with Image.open(src) as im:
            out.capture_time, out.lat, out.lon, out.alt = read_exif(im)
            exif_bytes = im.info.get("exif")
            im = ImageOps.exif_transpose(im)
            if im.mode != "RGB":
                im = im.convert("RGB")
            w, h = im.size
            if max(w, h) > max_side:
                scale = max_side / max(w, h)
                im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
                out.action = "downscaled"
            else:
                out.action = "converted"
            out.width, out.height = im.size
            out.phash = str(imagehash.phash(im))
            kwargs = {"quality": quality, "optimize": True}
            if exif_bytes:
                kwargs["exif"] = exif_bytes
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "JPEG", **kwargs)
    except Exception as e:  # reported, never raised: the pool must keep going
        out.action, out.error = "failed", repr(e)
    return out
```

Note: `exif_transpose` drops the orientation tag when it rotates; saving the original EXIF bytes back keeps the orientation tag too, which would double-rotate viewers. Handle it: after `exif_transpose`, if the original orientation tag (`0x0112`) was not 1, strip it with `piexif.remove`-style editing: load `exif_bytes` with `piexif.load`, set `piexif.ImageIFD.Orientation = 1`, `piexif.dump` back. Add a test with a synthetic image whose EXIF orientation is 6 (rotated) and assert the saved file has orientation 1 and swapped width/height.

- [ ] **Step 4: Run** all `test_prepare.py` -> pass. Also run `ruff`. **Step 5: Commit** `feat(datasets): image preparation core`.

---

### Task 3: Duplicates and grouping (`grouping.py`)

**Files:**
- Create: `backend/app/datasets/grouping.py`, `backend/tests/test_grouping.py`

**Interfaces:**
- Produces:
  - `find_duplicates(items: list[tuple[str, str]], threshold: int) -> dict[str, tuple[str, int]]`: input `(key, phash_hex)` in filename order; returns `{duplicate_key: (kept_key, hamming)}`; the earliest kept item wins (same rule as `prepare_images.find_duplicates`).
  - `tile_key(lat: float, lon: float, size_m: float = 250.0) -> str` -> `"tile_{x}_{y}"` with equirectangular metres (`x = floor(lon * 111320 * cos(radians(lat)) / size_m)`, `y = floor(lat * 110540 / size_m)`).
  - `group_key(file_name: str, regex: str, lat: float | None, lon: float | None, site: str) -> str`: if `re.match(regex, file_name)` has a `flight` group -> that value; else if it matches at all -> the whole match; else if lat/lon -> `tile_key`; else `site`. An invalid regex counts as no match (log a warning once).

- [ ] **Step 1: Failing tests**

```python
from app.datasets.grouping import find_duplicates, group_key, tile_key

RX = r"^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\d+)_(?P<frame>\d+)"


def test_find_duplicates_keeps_earliest():
    dups = find_duplicates([("a", "0000000000000000"), ("b", "0000000000000001"), ("c", "ffffffffffffffff"), ("d", "0000000000000003")], 4)
    assert dups == {"b": ("a", 1), "d": ("a", 2)}


def test_group_key_uses_flight_number():
    assert group_key("IX-12-02491_0031_0001.jpg", RX, None, None, "ahmadia") == "0031"
    assert group_key("IX-12-65292_0031_0009.jpg", RX, None, None, "ahmadia") == "0031"  # two cameras, one flight


def test_group_key_falls_back_to_tile_then_site():
    assert group_key("DJI_0001.JPG", RX, 29.49469, 47.76513, "ahmadia") == tile_key(29.49469, 47.76513)
    assert group_key("DJI_0001.JPG", RX, None, None, "ahmadia") == "ahmadia"
    assert group_key("x.jpg", "([", None, None, "site") == "site"  # bad regex -> no match


def test_tile_key_changes_every_250m():
    a = tile_key(29.5, 47.7)
    assert tile_key(29.5, 47.7 + 0.001) == a  # ~97 m east, same tile most of the time
    assert tile_key(29.5, 47.7 + 0.01) != a  # ~970 m east
```

- [ ] **Step 2: Run** -> ImportError. **Step 3: Implement** (straightforward; Hamming via `int(h, 16)` xor `bit_count()`; O(n^2) is fine for 3299 items).
- [ ] **Step 4: Run** -> pass. **Step 5: Commit** `feat(datasets): duplicate detection and group keys`.

---

### Task 4: Import job and sources endpoints

**Files:**
- Create: `backend/app/datasets/importer.py`, `backend/app/datasets/schemas.py` (Source models), `backend/tests/test_import.py`
- Modify: `backend/app/datasets/router.py` (replace the stub file with a real router; keep the stub registrations for the resources not yet implemented until their task, using `add_stubs` for the remaining paths so the contract test keeps passing)

**Interfaces:**
- Produces:
  - `POST /api/v1/projects/{p}/sources` body `SourceCreate {folder, site?, settings?}` -> 202 `SourceWithJob`. Validation: `folder` must be an absolute existing directory (422 `validation_error` otherwise); `site` defaults to `slugify(folder.name)`; `settings` merges over the project's `import_defaults`. If a Source with the same resolved folder exists, reuse it (re-import) and start a new job; otherwise insert. The job params are `{"source_id": ...}`.
  - `GET /sources` (paginated, created_at asc), `GET /sources/{sourceId}` (404), `GET /sources/{sourceId}/stats` (Task 8; until then it returns `Stats()` zeros restricted to the source).
  - Job type `import` (`run_import(ctx)`): reads the Source row and settings; `list_images(folder)`; skips files already imported (an Image row exists whose `path` equals the planned dest relative path, or the dest file exists); plans dests under `images/<site>/` with `unique_dest`; runs `process_one` in a `ProcessPoolExecutor(max_workers=os.cpu_count())` (chunks of 50 submitted at a time so cancellation is responsive); after all results: `find_duplicates` over (dest, phash) including phashes of previously imported images of the same source (they take precedence as "earlier"); deletes duplicate dest files; writes `images/<site>/.duplicates.json` (`{dest_name: {"duplicate_of": kept_name, "hamming": n}}`); inserts Image rows in batches of 50 inside one session per batch (`path` = `images/<site>/<name>` with forward slashes, `group_key` via `group_key(...)`), calling `ctx.progress(done/total, f"{done} / {total} images")` and `ctx.publish("images.changed", {"source_id": sid, "count": batch})` per batch; finally updates `Source.image_count`, `duplicate_count`, `imported_at`, `job_id`; returns `{"source_id", "imported", "duplicates", "failed", "skipped"}`.
  - `ctx.check_cancelled()` between chunks; on cancel, rows already written stay (the import is resumable by re-posting the source).
- Consumes: `register_job_type`, `JobContext`, `JobOut`.

- [ ] **Step 1: Failing tests** (`tests/test_import.py`)

```python
import time

from app.db.models import Image, Source

RX_DEFAULT = r"^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\d+)_(?P<frame>\d+)"


def _wait(client, pid, jid, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/v1/projects/{pid}/jobs/{jid}").json()
        if j["state"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.2)
    raise AssertionError("import did not finish")


def test_import_sample_frames(client, project, ahmadia_sample, project_dir):
    pid = project["id"]
    r = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(ahmadia_sample), "site": "ahmadia"})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["source"]["site"] == "ahmadia" and body["job"]["type"] == "import"
    job = _wait(client, pid, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"]["imported"] == 20 and job["result"]["duplicates"] == 0 and job["result"]["failed"] == 0
    src = client.get(f"/api/v1/projects/{pid}/sources/{body['source']['id']}").json()
    assert src["image_count"] == 20 and src["duplicate_count"] == 0 and src["imported_at"]
    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        imgs = s.query(Image).order_by(Image.path).all()
        assert len(imgs) == 20
        first = imgs[0]
        assert first.path == "images/ahmadia/IX-12-02491_0031_0001.jpg"
        assert (first.width, first.height, first.phash, first.group_key) == (4000, 2667, "82a81f67f94615ae", "0031")
        assert first.capture_time.year == 2019 and abs(first.lat - 29.49469) < 1e-4
    assert (project_dir / "images" / "ahmadia" / "IX-12-02491_0031_0001.jpg").exists()
    assert (project_dir / "images" / "ahmadia" / ".duplicates.json").exists()


def test_reimport_adds_only_new_files(client, project, ahmadia_sample, tmp_path, make_jpeg):
    import shutil

    folder = tmp_path / "src"
    folder.mkdir()
    for f in sorted(ahmadia_sample.glob("*.jpg"))[:3]:
        shutil.copy2(f, folder / f.name)
    pid = project["id"]
    first = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder)}).json()
    assert _wait(client, pid, first["job"]["id"])["result"]["imported"] == 3
    make_jpeg(folder / "ZZ_0099_0001.jpg", 800, 600, seed=7)
    second = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder)}).json()
    assert second["source"]["id"] == first["source"]["id"]
    res = _wait(client, pid, second["job"]["id"])["result"]
    assert res["imported"] == 1 and res["skipped"] == 3
    assert client.get(f"/api/v1/projects/{pid}/sources/{first['source']['id']}").json()["image_count"] == 4


def test_near_duplicates_are_recorded_not_imported(client, project, tmp_path, make_jpeg, project_dir):
    folder = tmp_path / "dup"
    a = make_jpeg(folder / "A_0001_0001.jpg", 640, 480, seed=1)
    from PIL import Image as PILImage

    im = PILImage.open(a)
    im.save(folder / "A_0001_0002.jpg", "JPEG", quality=70)  # re-encoded copy: same phash
    make_jpeg(folder / "A_0001_0003.jpg", 640, 480, seed=2)
    pid = project["id"]
    body = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder), "settings": {"dedupe_threshold": 4}}).json()
    res = _wait(client, pid, body["job"]["id"])["result"]
    assert res["imported"] == 2 and res["duplicates"] == 1
    site = body["source"]["site"]
    assert not (project_dir / "images" / site / "A_0001_0002.jpg").exists()
    import json

    dups = json.loads((project_dir / "images" / site / ".duplicates.json").read_text())
    assert dups["A_0001_0002.jpg"]["duplicate_of"] == "A_0001_0001.jpg"


def test_group_falls_back_to_tile_and_site(client, project, tmp_path, make_jpeg):
    folder = tmp_path / "g"
    make_jpeg(folder / "DJI_0001.jpg", 100, 80, exif={"lat": 29.5, "lon": 47.7})
    make_jpeg(folder / "DJI_0002.jpg", 100, 80)
    pid = project["id"]
    body = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder), "site": "site_x"}).json()
    _wait(client, pid, body["job"]["id"])
    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        keys = {i.path.split("/")[-1]: i.group_key for i in s.query(Image).all()}
    assert keys["DJI_0001.jpg"].startswith("tile_") and keys["DJI_0002.jpg"] == "site_x"


def test_source_folder_must_exist_and_be_absolute(client, project, tmp_path):
    pid = project["id"]
    assert client.post(f"/api/v1/projects/{pid}/sources", json={"folder": "relative/x"}).status_code == 422
    assert client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(tmp_path / "missing")}).status_code == 422


def test_cancel_import(client, project, ahmadia_sample):
    pid = project["id"]
    body = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(ahmadia_sample), "settings": {"max_side": 1000}}).json()
    client.post(f"/api/v1/projects/{pid}/jobs/{body['job']['id']}/cancel")
    j = _wait(client, pid, body["job"]["id"])
    assert j["state"] in ("cancelled", "succeeded")  # a fast machine may finish first; either way nothing crashed
    assert client.get(f"/api/v1/projects/{pid}/sources").status_code == 200


def test_sources_list_paginates(client, project, tmp_path, make_jpeg):
    pid = project["id"]
    for i in range(3):
        f = tmp_path / f"s{i}"
        make_jpeg(f / "a.jpg", 10, 10)
        client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(f)})
    page = client.get(f"/api/v1/projects/{pid}/sources", params={"limit": 2}).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    page2 = client.get(f"/api/v1/projects/{pid}/sources", params={"limit": 2, "cursor": page["next_cursor"]}).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None
```

Replace the weak assertion in `test_cancel_import` with a deterministic one if you can make the import slow enough (for example by monkeypatching `process_one` to sleep 0.2 s per image in that test); the plan requires a decisive test.

- [ ] **Step 2: Run** -> 501/ImportError failures. **Step 3: Implement** `schemas.py` (`SourceOut.from_row`, `SourceCreate` with an absolute-and-exists validator producing 422, `SourceWithJob`, `SourcePage`), `importer.py` as specified, and the sources routes in `router.py`. Process-pool note: `process_one` must be importable at module level (`app.datasets.prepare.process_one`) for pickling; when frozen by PyInstaller, `multiprocessing.freeze_support()` is needed in `app/__main__.py` (S6 handles it; note it in your report).

Keyset pagination for sources: cursor `{created_at, id}` like `app/jobs/router.py` (ascending).

- [ ] **Step 4: Run** `tests/test_import.py` -> pass; run the whole suite (`pytest -q`): the contract test still passes because the remaining stubs are still mounted. **Step 5: Commit** `feat(datasets): import job and sources api`.

---

### Task 5: Images API (list, get, file, thumbnail, bulk delete)

**Files:**
- Create: `backend/app/datasets/images.py`, `backend/tests/test_images.py`
- Modify: `backend/app/datasets/router.py`, `backend/app/datasets/schemas.py` (Image models)

**Interfaces:**
- Produces:
  - `list_images(handle, *, source_id, group_key, labeled, has_pending, search, ids, sort, order, limit, cursor) -> tuple[list[ImageRow], str | None, int]` where `ImageRow` is `(Image, box_count, pending_count, max_pending_confidence)`; sort keys exactly the contract enum; keyset cursor `{k, id}`; `total` counts the filtered set (ignoring cursor).
  - `get_image(handle, image_id) -> ImageRow` (404).
  - `image_file(handle, image_id, max_side: int | None) -> Path`: original path when `max_side` is None or >= long side; otherwise a JPEG (quality 85) cached at `cache/resized/{image_id}_{max_side}.jpg` created on first request.
  - `thumbnail(handle, image_id) -> Path`: 256 px long side at `cache/thumbs/{image_id}.jpg`.
  - `bulk_delete(handle, image_ids) -> int`: deletes Box rows (FK cascade), Image rows, the image file under `images/` and cached derivatives; never touches the source folder.
  - Routes: `GET /images` (`ImagePage {items, next_cursor, total}`), `GET /images/{imageId}`, `GET /images/{imageId}/file` (FileResponse `image/jpeg`), `GET /images/{imageId}/thumbnail`, `POST /images/bulk-delete` -> `{deleted}`.
  - `ImageOut.from_row(image, box_count, pending_count, max_pending_confidence)` with `file_name = path.rsplit("/", 1)[-1]`, `labeled = box_count > 0`.

Query sketch for the computed columns (put it in `images.py`):

```python
from sqlalchemy import case, func, select
from sqlalchemy.orm import aliased

def _box_stats():
    accepted = case((Box.review_state.in_(("accepted", "edited")), 1), else_=0)
    pending = case((Box.review_state == "unreviewed", 1), else_=0)
    pending_conf = case((Box.review_state == "unreviewed", Box.confidence), else_=None)
    return (
        select(
            Box.image_id.label("image_id"),
            func.sum(accepted).label("box_count"),
            func.sum(pending).label("pending_count"),
            func.max(pending_conf).label("max_pending_confidence"),
        )
        .group_by(Box.image_id)
        .subquery()
    )

SORT_COLUMNS = {  # name -> (expression builder, cursor codec)
    "path": lambda img, bs: img.path,
    "source_id": lambda img, bs: img.source_id,
    "group_key": lambda img, bs: img.group_key,
    "created_at": lambda img, bs: img.created_at,
    "capture_time": lambda img, bs: func.coalesce(img.capture_time, datetime(1970, 1, 1, tzinfo=UTC)),
    "labeled": lambda img, bs: case((func.coalesce(bs.c.box_count, 0) > 0, 1), else_=0),
    "box_count": lambda img, bs: func.coalesce(bs.c.box_count, 0),
    "pending_count": lambda img, bs: func.coalesce(bs.c.pending_count, 0),
    "max_pending_confidence": lambda img, bs: func.coalesce(bs.c.max_pending_confidence, -1.0),
}
```

Keyset: order by `(sort_expr, Image.id)` asc or desc; cursor carries the last row's sort value (serialised with `default=str`; datetimes as isoformat and parsed back with `datetime.fromisoformat`) and id; the `where` uses `tuple_(sort_expr, Image.id) > (v, id)` for asc and `<` for desc. `ids` (comma-separated) overrides other filters. `search` is `Image.path.ilike(f"%{search}%")`. `labeled=true` -> `coalesce(box_count,0) > 0`; `has_pending=true` -> `pending_count > 0`.

- [ ] **Step 1: Failing tests** covering: list after import returns `total == 20`, `file_name`, `labeled=false`; sort by `path` desc and cursor pagination with `limit=7` yields 7+7+6 with no duplicates and stable order; filter `group_key`, `search`, `ids`; after inserting boxes directly via the models (one accepted, one unreviewed with confidence 0.8 on image 1): `labeled=true` returns 1, `has_pending=true` returns 1, sort `max_pending_confidence` desc puts image 1 first, `box_count == 1`, `pending_count == 1`; `GET /file` returns `image/jpeg` with the original size and `?max_side=800` returns an 800 px wide JPEG and creates `cache/resized/...`; thumbnail is 256 px on the long side and cached; `bulk-delete` of two ids returns `{deleted: 2}`, removes the files under `images/` and the thumbs, keeps the source folder intact, and a later `GET` is 404; unknown image -> 404; `max_side=10` -> 422 (contract minimum 64).

- [ ] **Step 2: Run** -> fail. **Step 3: Implement.** **Step 4: Run** -> pass. **Step 5: Commit** `feat(datasets): images api with keyset pagination, file and thumbnail serving`.

---

### Task 6: Boxes API

**Files:**
- Create: `backend/app/datasets/boxes.py`, `backend/tests/test_boxes.py`
- Modify: `backend/app/datasets/router.py`, `backend/app/datasets/schemas.py` (Box models)

**Interfaces:**
- Produces:
  - `create_box(handle, image_id, class_id, x, y, w, h) -> Box`: validates the image exists (404), the class id is in the project's classes (422), the box lies within the image (`x >= 0, y >= 0, x + w <= width, y + h <= height`, 422 otherwise); `provenance_kind="person"`, `review_state="accepted"`, `reviewed_at=now`.
  - `update_box(handle, box_id, **fields) -> Box`: same validation; if the box was `unreviewed` or `rejected` it becomes `edited` with `reviewed_at=now`; accepted stays accepted; person boxes stay accepted.
  - `delete_box(handle, box_id) -> None` (404 when missing).
  - `review_boxes(handle, box_ids, action) -> int`: sets `accepted` or `rejected` and `reviewed_at` on the ids that exist and are currently `unreviewed` or `rejected`/`accepted` (idempotent), returns the number changed; unknown ids are ignored (count excludes them).
  - `BoxOut.from_row(box)` building `provenance {kind, model_id, provider, model_name, query_run_id}`.
  - Routes: `GET /images/{imageId}/boxes` -> `BoxList` ordered by `created_at`, `POST` -> 201, `PATCH /boxes/{boxId}`, `DELETE /boxes/{boxId}` -> 204, `POST /boxes/review` -> `{updated}`.

- [ ] **Step 1: Failing tests** covering: create returns person/accepted with `reviewed_at`; out-of-bounds 422; unknown class 422; unknown image 404; list order; patch moves and reclassifies; patch on an unreviewed proposal (inserted via the model with `provenance_kind="local_model"`, `confidence=0.7`) turns it `edited`; delete 204 then 404; review accept and reject counts, idempotence, unknown ids ignored; the `Image` list reflects `box_count`/`pending_count` after these changes (one assertion through `GET /images/{id}`).
- [ ] **Step 2-5:** run (fail), implement, run (pass), commit `feat(datasets): boxes api with review states`.

---

### Task 7: Datasets (freeze, split, materialise, stats)

**Files:**
- Create: `backend/app/datasets/splits.py`, `backend/app/datasets/materialise.py`, `backend/tests/test_datasets.py`
- Modify: `backend/app/datasets/router.py`, `backend/app/datasets/schemas.py` (Dataset models)

**Interfaces:**
- Produces:
  - `assign_splits(images: list[tuple[str, str]], method: str, val_fraction: float, seed: int) -> dict[str, str]`: input `(image_id, group_key)`; `by_group` and `by_tile` treat `group_key` as the unit (for `by_tile` the caller passes tile keys computed from lat/lon when available, else the group key): sort groups by size descending, assign whole groups to `val` (starting from the smallest groups, deterministic with `seed` for ties) until `val_count >= round(val_fraction * n)`, the rest `train`; every group lands entirely in one split; if there is only one group, fall back to `random`. `random`: `random.Random(seed).shuffle` then the first `round(val_fraction * n)` are val. At least one train image when n >= 2.
  - `POST /datasets` (`DatasetCreate`): name unique (409 `already_exists` on duplicate); image set = `image_ids` if given else every image with at least one accepted/edited box; 422 when the set is empty; freezes `DatasetImage` rows with `boxes = [{class_id, x, y, w, h}]` (accepted and edited boxes only, class must still exist), `classes` snapshot from the project (ordered), `split_params = {val_fraction, seed}`, `path = datasets/<name>`; submits job `dataset` with `{"dataset_id"}`; responds 202 `DatasetWithJob` with counts.
  - Job `dataset` (`materialise(ctx)`): creates `datasets/<name>/images/{train,val}` and `labels/{train,val}`; for each image tries `os.link(src, dst)` and falls back to `shutil.copy2` (record which in the job log); writes `<stem>.txt` with lines `class_index cx cy w h` normalised to [0, 1] (class index = position in the dataset's class snapshot); writes `data.yaml` (`path` absolute dataset folder, `train: images/train`, `val: images/val`, `names: {0: excavator, ...}`); progress per 50; returns `{"dataset_id", "train", "val"}`. Datasets are immutable: no update endpoint; deleting is out of scope.
  - `GET /datasets` (paginated, created_at desc), `GET /datasets/{datasetId}` (404), `GET /datasets/{datasetId}/stats` (`DatasetStats`: image/train/val counts, boxes per class split by train/val from the frozen boxes, groups with their split).

- [ ] **Step 1: Failing tests**: `assign_splits` unit tests (whole groups in one split, fraction within one group of the target, deterministic for the same seed, random method exact count, single-group fallback); API flow: import 20 sample frames, create 12 boxes over 6 images through the boxes API (two flights: the sample is one flight, so make 3 extra synthetic images named `IX-12-02491_0033_000{1,2,3}.jpg` in a second source and label them), create dataset `v1` by_group -> 202, wait for the job, assert `datasets/v1/images/train`, `images/val`, `labels/train/*.txt` content (`0 0.5 0.5 0.1 0.2` style lines with the right class index), `data.yaml` parses and lists eight names in project order, `train_count + val_count == image_count`, stats per class; duplicate name -> 409; empty selection -> 422; explicit `image_ids` subset; unlabeled images are excluded by default.
- [ ] **Step 2-5:** run, implement, run, commit `feat(datasets): dataset freeze, split and yolo materialisation`.

---

### Task 8: Statistics

**Files:**
- Create: `backend/app/datasets/stats.py`, `backend/tests/test_stats.py`
- Modify: `backend/app/projects/router.py` (only `project_stats` calls `compute_stats(handle, source_id=None)`), `backend/app/datasets/router.py` (source stats)

**Interfaces:**
- Produces: `compute_stats(handle, source_id: str | None) -> Stats` (`app.projects.schemas.Stats`): counts, `boxes_per_class` (accepted/edited boxes joined to the project's class names; classes with zero boxes included with count 0), `sources` (one entry per source, or only the selected one), `groups`, `resolution_histogram` (group by width, height), `capture_time_range` (min/max over non-null), `gps_bounds` (min/max lat/lon over non-null), `duplicate_count` from the Source rows, `pending_review_count`.

- [ ] **Step 1: Failing tests**: zeros on an empty project; after importing the sample: `image_count == 20`, one source, one group `0031`, histogram `[{4000, 2667, 20}]`, capture range within 2019-04-15, gps bounds around (29.49, 47.76); after adding boxes: `labeled_count`, `box_count`, `pending_review_count`, `boxes_per_class`; source stats for a second source only count its own images.
- [ ] **Step 2-5:** run, implement, run, commit `feat(datasets): project and source statistics`.

---

### Task 9: Retire the stubs and finish the contract test

**Files:**
- Modify: `backend/app/datasets/router.py` (no `add_stubs` calls remain), `backend/tests/test_contract.py` (`EXPECTED_STUBS` loses `listSources, createSource, getSource, getSourceStats, listImages, bulkDeleteImages, getImage, getImageFile, getImageThumbnail, listBoxes, createBox, updateBox, deleteBox, reviewBoxes, listDatasets, createDataset, getDataset, getDatasetStats`; `preannotateImage` stays, it is S4's)

- [ ] **Step 1:** Run `pytest -q tests/test_contract.py` before editing: it fails with "unexpected stub" or route-set differences once the real routes exist. **Step 2:** Edit both files. **Step 3:** Run the full suite three times (`pytest -q -p no:cacheprovider`), `ruff check .`, `ruff format --check .`: all green, no flakes. Schemathesis will now generate random ids and bodies against the real handlers: any 500 fails the test (`assert response.status_code < 500`), so validation must convert bad input into 404/422 (for example a `sort` value outside the enum is rejected by FastAPI's `Literal`/enum typing; an `ids` list with unknown ids returns an empty page).
- [ ] **Step 4: Commit** `test(datasets): retire S0 stubs, contract conformance on real endpoints`.

---

### Task 10: Smoke script for the real backend (goal-owner checkpoint aid)

**Files:**
- Create: `backend/scripts/smoke_import.py`

A small CLI (`python scripts/smoke_import.py --base http://127.0.0.1:8765 --token X --project-folder E:\tmp\proj --source E:\Dev\Yolo\data\raw\ahmadia`) that creates a project, posts the source, polls the job printing progress, then prints the stats and the first page of images. No tests required (it is a manual aid), but it must run without error against the dev backend on the 20-frame sample. Commit `chore(datasets): smoke import script`.

---

## Self-review checklist (run before reporting)

- Spec section 5 coverage: import job (T4), dedupe (T3/T4), grouping (T3/T4), split (T7), materialise (T7), statistics endpoint (T8). Section 6 box behaviours the API must support: T6. Section 9 resources: sources, images, boxes, datasets (T4-T7).
- No placeholder steps; every task has the test code or an exact description of each assertion, and the interface signatures used in later tasks match.
- Type consistency: `ImageRow` tuple order `(Image, box_count, pending_count, max_pending_confidence)` everywhere; `assign_splits` signature identical in T7's unit tests and the router.
