"""Images unit I-C0: every new operation is routed as a 501 stub in the route module of the unit
that builds it (plan 2026-09-27-images-c0). A unit that lands an operation deletes its tuple from
its module's STUBS and its EXPECTED_STUBS entry; this test follows without an edit."""

import importlib
import inspect
import re

import pytest
import yaml
from project_factory import new_project

from app.jobs.registry import get_job_type

PROJECT_MODULES = [
    "app.imagery.routes_index",
    "app.imagery.routes_camera",
    "app.imagery.routes_boxes",
    "app.imagery.routes_detect",
    "app.assist.router",
]
I_TAGS = {"images", "boxes", "image-detect", "assist"}
NEW_JOB_TYPES = ["image_metadata", "summary_rebuild", "assist_acquire"]


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x1", path)


def _stubs(project_id: str) -> list[tuple[str, str, str]]:
    """(method, concrete URL, operationId) for every operation still routed as a 501 stub."""
    out = [
        (method.lower(), f"/api/v1/projects/{project_id}{_concrete(path)}", op_id)
        for module in PROJECT_MODULES
        for method, path, op_id in getattr(importlib.import_module(module), "STUBS", [])
    ]
    assist = importlib.import_module("app.assist.router")
    out += [
        (method.lower(), f"/api/v1/library{_concrete(path)}", op_id)
        for method, path, op_id in getattr(assist, "LIBRARY_STUBS", [])
    ]
    return out


def test_expected_stubs_match_the_modules_stubs():
    """EXPECTED_STUBS' images entries are exactly the modules' STUBS (only I-tagged operations)."""
    from test_contract import EXPECTED_STUBS, METHODS, SPEC

    ours = {
        op["operationId"]
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS and set(op.get("tags", [])) & I_TAGS
    }
    routed = {op_id for _, _, op_id in _stubs("p")}
    assert routed <= ours, sorted(routed - ours)
    assert EXPECTED_STUBS & ours == routed, {
        "expected but not a stub": sorted((EXPECTED_STUBS & ours) - routed),
        "a stub but not expected": sorted(routed - EXPECTED_STUBS),
    }


def test_every_stub_answers_501_in_the_envelope(client, tmp_path):
    pid = new_project(client, tmp_path / "p", name="p")["id"]
    for method, url, op_id in _stubs(pid):
        kwargs = {"json": {}} if method in ("post", "patch") else {}
        r = getattr(client, method)(url, **kwargs)
        assert r.status_code == 501, (op_id, url, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_literal_image_paths_are_not_swallowed_by_the_image_id_route(client, tmp_path):
    """`/images/index` must reach its own route, never getImage("index") (a 404 "image not found")."""
    pid = new_project(client, tmp_path / "p", name="p")["id"]
    r = client.get(f"/api/v1/projects/{pid}/images/index")
    assert r.status_code in (200, 501), r.text
    r = client.post(f"/api/v1/projects/{pid}/images/metadata-refresh")
    assert r.status_code in (202, 409, 501), r.text


def test_an_unknown_project_is_404(client):
    assert client.get("/api/v1/projects/nope/images/index").status_code == 404


def test_the_three_job_types_are_registered(app):
    for job_type in NEW_JOB_TYPES:
        assert callable(get_job_type(job_type)), job_type


@pytest.mark.parametrize("job_type", NEW_JOB_TYPES)
def test_each_stub_job_fails_readably_until_its_unit_lands(app, handle, project_id, wait_job, job_type):
    if 'raise JobFailure("not implemented")' not in inspect.getsource(get_job_type(job_type)):
        pytest.skip(f"{job_type} is built; its unit's tests cover it")
    job = app.state.jobs.submit(handle, job_type, {})
    done = wait_job(project_id, job.id, timeout=30)
    assert (done["state"], done["error"], done["type"]) == ("failed", "not implemented", job_type)
