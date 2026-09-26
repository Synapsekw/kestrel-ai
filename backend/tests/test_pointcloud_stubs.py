"""Foundation F0: the operations of the point-cloud, volumes and design specs were routed as 501
stubs, and the six new job types are registered.

The 501 checks read each router's STUBS, and the stub-job check skips a job whose F0 body has been
replaced, so S1, S2 and S3 never edit this file: a unit that lands an operation deletes its tuple
from STUBS (and its EXPECTED_STUBS entry) and this test follows.
"""

import importlib
import inspect
import re

import pytest
import yaml
from project_factory import new_project

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


def _stubs() -> list[tuple[str, str, str]]:
    """(method, concrete path, operationId) for every operation still routed as a 501 stub."""
    return [
        (method.lower(), re.sub(r"\{[^}]+\}", "x1", path), op_id)
        for module in ROUTERS
        for method, path, op_id in getattr(importlib.import_module(module), "STUBS", [])
    ]


def _project(client, tmp_path, name="p") -> str:
    return new_project(client, tmp_path / name, name=name)["id"]


def test_expected_stubs_match_the_routers_stubs():
    """EXPECTED_STUBS' point-cloud, surface and volume entries are exactly the four routers' STUBS.

    Only the operations tagged `pointclouds`, `surfaces` or `volumes` (every one of them lives in
    the four routers) are compared, so an unrelated EXPECTED_STUBS entry never trips this."""
    from test_contract import EXPECTED_STUBS, METHODS, SPEC

    ours = {
        op["operationId"]
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS and set(op.get("tags", [])) & {"pointclouds", "surfaces", "volumes"}
    }
    routed = {op_id for _, _, op_id in _stubs()}
    assert routed <= ours, sorted(routed - ours)
    assert EXPECTED_STUBS & ours == routed, {
        "expected but not a router stub": sorted((EXPECTED_STUBS & ours) - routed),
        "a router stub but not expected": sorted(routed - EXPECTED_STUBS),
    }


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


def test_a_project_reaches_the_501_stubs(client, tmp_path):
    pid = _project(client, tmp_path)
    for method, path, op_id in _stubs():
        kwargs = {"json": {}} if method in ("post", "patch") else {}
        r = getattr(client, method)(f"/api/v1/projects/{pid}{path}", **kwargs)
        assert r.status_code == 501, (op_id, path, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_an_unknown_project_is_404(client):
    assert client.get("/api/v1/projects/nope/pointclouds").status_code == 404
