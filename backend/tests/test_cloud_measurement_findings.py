"""C-B1: attach a cloud measurement to a finding (workspace spec 2026-09-26 sections 8.1, 8.5, 12
rows 3 and 5, 14): only a finding pinned on the same cloud; a deleted finding unlinks (SET NULL)."""

import pytest
from findings_helpers import insert_box
from pointclouds import insert_cloud

from app.findings import service
from app.findings.anchors import AnchorIn

BASE = "/api/v1/projects"
P = lambda x, y, z, u=0.01: {"x": x, "y": y, "z": z, "uncertainty_m": u}  # noqa: E731
DIST = {"kind": "distance", "points": [P(243500, 3178000, 0), P(243503, 3178004, 0)]}


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def murl(project_id, cloud_id, mid=""):
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/measurements" + (f"/{mid}" if mid else "")


def pin(handle, crack, cloud_id) -> str:
    anchor = AnchorIn(kind="cloud", cloud_id=cloud_id, x=243550.0, y=3178050.0, z=10.0)
    return service.create_finding(handle, type_id=crack["id"], anchor=anchor).id


def test_create_attached_to_a_finding(client, project_id, handle, crack, cloud_id):
    fid = pin(handle, crack, cloud_id)
    r = client.post(murl(project_id, cloud_id), json={**DIST, "finding_id": fid})
    assert r.status_code == 201, r.text
    assert r.json()["finding_id"] == fid


def test_attach_and_detach_with_patch(client, project_id, handle, crack, cloud_id):
    fid = pin(handle, crack, cloud_id)
    m = client.post(murl(project_id, cloud_id), json=DIST).json()
    r = client.patch(murl(project_id, cloud_id, m["id"]), json={"finding_id": fid})
    assert r.status_code == 200 and r.json()["finding_id"] == fid and r.json()["name"] == "Distance 1"
    r = client.patch(murl(project_id, cloud_id, m["id"]), json={"name": "Stack to gate"})
    assert r.json()["finding_id"] == fid  # a PATCH without finding_id keeps the link
    r = client.patch(murl(project_id, cloud_id, m["id"]), json={"finding_id": None})
    assert r.status_code == 200 and r.json()["finding_id"] is None


def _image_finding(handle, crack) -> str:
    image_id, box_id = insert_box(handle, crack["id"])
    anchor = AnchorIn(kind="image", image_id=image_id, annotation_id=box_id)
    return service.create_finding(handle, type_id=crack["id"], anchor=anchor).id


@pytest.mark.parametrize("which", ["unknown", "image finding", "another cloud"])
def test_a_wrong_finding_is_refused(client, project_id, handle, crack, cloud_id, which):
    """Review Focus 4."""
    if which == "unknown":
        fid = "f-does-not-exist"
    elif which == "image finding":
        fid = _image_finding(handle, crack)
    else:
        fid = pin(handle, crack, insert_cloud(handle, name="Other"))
    r = client.post(murl(project_id, cloud_id), json={**DIST, "finding_id": fid})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_finding"
    assert r.json()["error"]["message"] == "attach the measurement to a finding pinned on this point cloud"
    m = client.post(murl(project_id, cloud_id), json=DIST).json()
    r = client.patch(murl(project_id, cloud_id, m["id"]), json={"finding_id": fid})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_finding"
    assert client.get(murl(project_id, cloud_id)).json()["items"][0]["finding_id"] is None


def test_an_unknown_cloud_is_404_before_the_finding_check(client, project_id):
    r = client.post(murl(project_id, "nope"), json={**DIST, "finding_id": "f-does-not-exist"})
    assert r.status_code == 404


def test_deleting_the_finding_unlinks_the_measurement(client, project_id, handle, crack, cloud_id):
    """Review Focus 4 / spec §14: the measurement stays, `finding_id` becomes null (SET NULL)."""
    fid = pin(handle, crack, cloud_id)
    m = client.post(murl(project_id, cloud_id), json={**DIST, "finding_id": fid}).json()
    assert client.delete(f"{BASE}/{project_id}/findings/{fid}").status_code == 204
    items = client.get(murl(project_id, cloud_id)).json()["items"]
    assert [(i["id"], i["finding_id"]) for i in items] == [(m["id"], None)]
