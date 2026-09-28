"""The e2e DJI fixture is what the real backend answers (plan 2026-09-27-images-e, Task 2, ruling E1).

`frontend/e2e/fixtures/dji-flight.json` holds the three frames the e2e world serves. This test
imports the same three frames through the real import and compares every number. Set
KESTREL_WRITE_E2E_FIXTURE=1 to rewrite the JSON after an intended change in the camera maths.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

from imagery_camera_helpers import dji_jpeg

FIXTURE = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "dji-flight.json"
# Three nadir M3E frames 20 m apart northwards (about 0.00018 deg of latitude).
FRAMES = [("DJI_0001.jpg", 25.26412, 1), ("DJI_0002.jpg", 25.26430, 2), ("DJI_0003.jpg", 25.26448, 3)]
LON = 55.29218
KEEP = ("file_name", "width", "height", "lat", "lon", "capture_time")


def _fixed_id(n: int) -> str:
    return f"10000000-5555-4000-8000-{n:012d}"


def _served(client, project_id: str) -> list[dict]:
    items = client.get(f"/api/v1/projects/{project_id}/images", params={"limit": 10}).json()["items"]
    out = []
    for n, item in enumerate(sorted(items, key=lambda i: i["file_name"]), start=1):
        d = client.get(f"/api/v1/projects/{project_id}/images/{item['id']}").json()
        out.append(
            {
                "id": _fixed_id(n),
                **{k: d[k] for k in KEEP},
                "camera": d["camera"],
                "footprint": d["footprint"],
                "footprint_kind": d["footprint_kind"],
            }
        )
    return out


def _close(a, b, path="$") -> None:
    if isinstance(a, float) or isinstance(b, float):
        assert a is not None and b is not None, path
        assert math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-9), f"{path}: {a} != {b}"
    elif isinstance(a, dict):
        assert a.keys() == b.keys(), path
        for k in a:
            _close(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            _close(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"


def test_e2e_fixture_is_what_the_backend_answers(client, project, import_source, tmp_path):
    folder = tmp_path / "flight"
    for name, lat, seed in FRAMES:
        dji_jpeg(folder / name, seed=seed, lat=lat, lon=LON)
    import_source(project["id"], folder)
    served = _served(client, project["id"])

    if os.environ.get("KESTREL_WRITE_E2E_FIXTURE") == "1":
        FIXTURE.write_text(json.dumps({"frames": served}, indent=2) + "\n", encoding="utf-8")
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))["frames"]
    _close(served, committed)
    # The facts the e2e flows assert (ruling E8): nadir frames, rel_alt distance, a trapezoid.
    assert all(f["camera"]["distance_source"] == "rel_alt" for f in served)
    assert all(f["footprint_kind"] == "trapezoid" for f in served)
    assert math.isclose(served[0]["camera"]["gsd_mm"], 69.12, rel_tol=1e-3)
