"""Foundation F0: the 37 operations of the point-cloud, volumes and design specs are routed as 501
stubs behind the project-kind guard, and the six new job types are registered.

The 501 checks read each router's STUBS, and the stub-job check skips a job whose F0 body has been
replaced, so S1, S2 and S3 never edit this file: a unit that lands an operation deletes its tuple
from STUBS (and its EXPECTED_STUBS entry) and this test follows. GUARDED_WRITES stays fixed: the
kind guard sits where `app/api.py` includes the routers, so it answers 409 before a stub or a real
handler runs.
"""

import importlib
import inspect
import re

import pytest

from app.jobs.registry import get_job_type

ROUTERS = [
    "app.pointclouds.router",
    "app.surfaces.router",
    "app.volumes.router",
    "app.surfaces.design.router",
]
NEW_JOB_TYPES = [
    "pointcloud_import",
    "pointcloud_export",
    "surface_build",
    "volume_calc",
    "volume_export",
    "design_import",
]
GUARDED_WRITES = [
    ("post", "/pointclouds", {"path": "C:/x.las"}),
    ("post", "/pointclouds/inspect", {"path": "C:/x.las"}),
    ("patch", "/pointclouds/c1", {"name": "x"}),
    ("post", "/pointclouds/c1/exports", {"format": "laz"}),
    ("post", "/surfaces", {"point_cloud_id": "c1"}),
    ("post", "/volume-exports", {"measurement_ids": ["v1"], "formats": ["pdf"]}),
    ("post", "/design-inspections", {"path": "C:/x.dxf"}),
    ("post", "/design-surfaces", {"inspection_id": "i1", "preview_id": "p1"}),
]


def _stubs() -> list[tuple[str, str, str]]:
    """(method, concrete path, operationId) for every operation still routed as a 501 stub."""
    return [
        (method.lower(), re.sub(r"\{[^}]+\}", "x1", path), op_id)
        for module in ROUTERS
        for method, path, op_id in getattr(importlib.import_module(module), "STUBS", [])
    ]


def _project(client, tmp_path, kind):
    body = {"name": kind, "folder": str(tmp_path / kind), "classes": [], "kind": kind}
    r = client.post("/api/v1/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_the_six_job_types_are_registered(app):
    for job_type in NEW_JOB_TYPES:
        assert callable(get_job_type(job_type)), job_type


@pytest.mark.parametrize("job_type", NEW_JOB_TYPES)
def test_each_stub_job_fails_readably_until_its_unit_lands(
    app, client, handle, project_id, wait_job, job_type
):
    if 'raise JobFailure("not implemented")' not in inspect.getsource(get_job_type(job_type)):
        pytest.skip(f"{job_type} is built; its unit's tests cover it")
    job = app.state.jobs.submit(handle, job_type, {})
    done = wait_job(project_id, job.id, timeout=30)
    assert done["state"] == "failed"
    assert done["error"] == "not implemented"
    assert done["type"] == job_type


def test_a_detection_project_reaches_the_501_stubs(client, tmp_path):
    pid = _project(client, tmp_path, "detect")
    for method, path, op_id in _stubs():
        kwargs = {"json": {}} if method in ("post", "patch") else {}
        r = getattr(client, method)(f"/api/v1/projects/{pid}{path}", **kwargs)
        assert r.status_code == 501, (op_id, path, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_a_training_project_may_read_but_not_write(client, tmp_path):
    pid = _project(client, tmp_path, "train")
    assert client.get(f"/api/v1/projects/{pid}/pointclouds").status_code in (200, 501)  # stub or built
    for method, path, body in GUARDED_WRITES:
        r = getattr(client, method)(f"/api/v1/projects/{pid}{path}", json=body)
        assert r.status_code == 409, (path, r.text)
        assert r.json()["error"]["code"] == "wrong_project_kind"


def test_an_unknown_project_is_404(client):
    assert client.get("/api/v1/projects/nope/pointclouds").status_code == 404
