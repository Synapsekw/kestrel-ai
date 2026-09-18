import shutil
import time
from pathlib import Path

import numpy as np
import piexif
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.health import GpuProbe
from app.main import create_app
from app.providers.keys import MemoryKeyStore

TOKEN = "test-token"
AHMADIA_RAW = Path(r"E:\Dev\Yolo\data\raw\ahmadia")
SAMPLE_FRAMES = 20
EIGHT_CLASSES = [
    "excavator",
    "wheel_loader",
    "bulldozer",
    "dump_truck",
    "crane",
    "concrete_mixer",
    "roller",
    "backhoe",
]
COLOURS = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(token=TOKEN, data_dir=tmp_path / "appdata", port=0)


@pytest.fixture
def app(settings):
    """A test app that touches nothing outside the process.

    Keys stay in memory (no test may reach Credential Manager) and the CUDA probe is a stub, so
    a health request does not import torch into the pytest process. `test_health.py` keeps one
    test for the real probe.
    """
    created = create_app(settings)
    created.state.keys = MemoryKeyStore()
    created.state.gpu_probe = GpuProbe(probe=lambda: {"available": False, "name": "test-gpu"})
    return created


@pytest.fixture
def client(app):
    with TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        yield c


@pytest.fixture
def anon(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def project_dir(tmp_path: Path) -> Path:
    d = tmp_path / "proj"
    d.mkdir()
    return d


@pytest.fixture(scope="session")
def backend_dir() -> Path:
    """The `backend/` folder: the working directory a worker subprocess needs to resolve `app`."""
    return Path(__file__).resolve().parents[1]


def _deg_to_dms_rational(value: float):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = round((value - d - m / 60) * 3600 * 10000)
    return ((d, 1), (m, 1), (s, 10000))


@pytest.fixture
def make_jpeg():
    """Write a seeded-noise JPEG, optionally with DateTimeOriginal and GPS lat/lon/alt EXIF."""

    def _make(path: Path, width: int, height: int, *, seed: int = 0, exif: dict | None = None) -> Path:
        rng = np.random.default_rng(seed)
        arr = rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8)
        im = Image.fromarray(arr, "RGB")
        kwargs: dict = {"quality": 90}
        if exif:
            zeroth: dict = {}
            exif_ifd: dict = {}
            gps: dict = {}
            if "DateTimeOriginal" in exif:
                exif_ifd[piexif.ExifIFD.DateTimeOriginal] = exif["DateTimeOriginal"]
            if "orientation" in exif:
                zeroth[piexif.ImageIFD.Orientation] = exif["orientation"]
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
    """The first 20 real frames, copied once per session. Originals are only ever read."""
    if not AHMADIA_RAW.is_dir():
        pytest.skip(f"{AHMADIA_RAW} not present")
    dest = tmp_path_factory.mktemp("ahmadia_sample")
    for src in sorted(AHMADIA_RAW.glob("*.jpg"))[:SAMPLE_FRAMES]:
        shutil.copy2(src, dest / src.name)
    return dest


@pytest.fixture
def wait_job(client):
    """Block until a job reaches a terminal state and return its JSON."""

    def _wait(project_id: str, job_id: str, timeout: float = 180.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            j = client.get(f"/api/v1/projects/{project_id}/jobs/{job_id}").json()
            if j["state"] in ("succeeded", "failed", "cancelled"):
                return j
            time.sleep(0.1)
        raise AssertionError(f"job {job_id} did not finish within {timeout}s")

    return _wait


@pytest.fixture
def import_source(client, wait_job):
    """Import a folder into a project and return the new source id."""

    def _import(project_id: str, folder: Path, **body) -> str:
        r = client.post(f"/api/v1/projects/{project_id}/sources", json={"folder": str(folder), **body})
        assert r.status_code == 202, r.text
        created = r.json()
        job = wait_job(project_id, created["job"]["id"])
        assert job["state"] == "succeeded", job
        return created["source"]["id"]

    return _import


@pytest.fixture
def project(client, project_dir) -> dict:
    """A project with the eight machinery classes (hotkeys 1-8)."""
    classes = [
        {"name": n, "colour": c, "hotkey": str(i + 1)}
        for i, (n, c) in enumerate(zip(EIGHT_CLASSES, COLOURS, strict=True))
    ]
    r = client.post("/api/v1/projects", json={"name": "T", "folder": str(project_dir), "classes": classes})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def project_id(project) -> str:
    return project["id"]


@pytest.fixture
def handle(app, project_id):
    """The open ProjectHandle behind `project_id` (folders, session)."""
    return app.state.projects.get(project_id)
