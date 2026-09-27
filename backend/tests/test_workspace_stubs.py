"""M-C0: the map-workspace operations are routed as 501 stubs until their unit lands.

A unit that builds an operation deletes its tuple from `app/workspace/stubs.py` (and its route
goes live), and these tests follow because they read the lists. The option-guard tests that
remain cover M-B2's `guard_surface_patch` in `app/workspace/pending.py`; M-B2 deletes them with it.
"""

import re

import yaml
from test_contract import EXPECTED_STUBS, METHODS, OPTION_STUBS, SPEC
from test_workspace_contract import WORKSPACE_OPERATIONS

from app.workspace import stubs

UNIT_LISTS = {
    "M-B1": stubs.B1_STUBS,
    "M-B2": stubs.B2_STUBS,
    "M-B3": stubs.B3_STUBS,
    "M-B4": stubs.B4_STUBS,
}


def _workspace_ops() -> set[str]:
    spec = yaml.safe_load(SPEC.read_text("utf-8"))
    return {
        op["operationId"]
        for ops in spec["paths"].values()
        for m, op in ops.items()
        if m in METHODS and "workspace" in op.get("tags", [])
    }


def test_expected_stubs_match_the_workspace_stub_lists():
    ours = _workspace_ops()
    routed = stubs.stub_operation_ids()
    assert routed <= ours, sorted(routed - ours)
    assert EXPECTED_STUBS & ours == routed, {
        "expected but not a stub": sorted((EXPECTED_STUBS & ours) - routed),
        "a stub but not expected": sorted(routed - EXPECTED_STUBS),
    }


def test_each_stub_sits_in_its_units_list_with_the_contract_path():
    for unit, listed in UNIT_LISTS.items():
        for method, path, op_id in listed:
            assert WORKSPACE_OPERATIONS[op_id] == (
                method.lower(),
                "/api/v1/projects/{projectId}" + path,
                unit,
            )


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def test_a_project_reaches_the_501_stubs(client, project_id):
    for method, path, op_id in stubs.STUBS:
        kwargs = {"json": {}} if method in ("POST", "PUT", "PATCH") else {}
        r = client.request(method, f"/api/v1/projects/{project_id}{_concrete(path)}", **kwargs)
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_an_unknown_project_is_404_before_any_stub(client):
    for method, path, op_id in stubs.STUBS:
        kwargs = {"json": {}} if method in ("POST", "PUT", "PATCH") else {}
        r = client.request(method, f"/api/v1/projects/nope{_concrete(path)}", **kwargs)
        assert r.status_code == 404, (op_id, r.text)


WGS = [[15.0, 44.99], [15.01, 44.99], [15.01, 44.995]]


def test_frame_site_is_ignored_until_m_b1(client, project_id):
    """M-B1 turns this into a test that `polygon_site` is filled."""
    url = f"/api/v1/projects/{project_id}/site-areas"
    assert client.post(url, json={"name": "Yard", "polygon_wgs84": WGS}).status_code == 201
    (area,) = client.get(url, params={"frame": "site"}).json()["items"]
    assert area["category"] == "general"
    assert "polygon_site" not in area


def _option(r, unit: str) -> str:
    assert r.status_code == 501, r.text
    error = r.json()["error"]
    assert error["code"] == "not_implemented"
    assert error["details"]["unit"] == unit
    return error["details"]["option"]


def test_option_stubs_name_real_operations():
    """The last unit to delete its guards deletes this test and `_option` with them."""
    spec = yaml.safe_load(SPEC.read_text("utf-8"))
    ids = {op["operationId"] for ops in spec["paths"].values() for m, op in ops.items() if m in METHODS}
    assert set(OPTION_STUBS) <= ids
    assert set(OPTION_STUBS.values()) <= {"M-B2"}
    assert not set(OPTION_STUBS) & EXPECTED_STUBS


def test_a_surface_date_or_role_patch_answers_501_until_m_b2(client, project_id):
    """M-B2 deletes this test with `guard_surface_patch`."""
    url = f"/api/v1/projects/{project_id}/surfaces/any"
    assert _option(client.patch(url, json={"captured_on": "2026-09-14"}), "M-B2") == "captured_on"
    assert _option(client.patch(url, json={"elevation_role": "dtm"}), "M-B2") == "elevation_role"


# ------------------------------------------- volumes: a request without any polygon (M-C0 contract)


def test_a_volume_without_a_polygon_is_invalid_geometry(client, project_id):
    body = {"name": "Pile", "top_surface_id": "s1", "base": {"kind": "toe_plane"}}
    r = client.post(f"/api/v1/projects/{project_id}/volumes", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_geometry"
