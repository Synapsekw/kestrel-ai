"""Asset models and versions over HTTP (spec §5, §9)."""

import pytest

BASE = "/api/v1/projects/{pid}/asset-models"

SPEC = {
    "asset": {"tag": "T-1"},
    "parts": [
        {
            "id": "shell",
            "name": "Shell",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 4000, "thickness": 8, "height": 8000},
            "source": {"kind": "drawing", "id": "d1"},
        },
    ],
}


@pytest.fixture
def base(project_id):
    return BASE.format(pid=project_id)


def create(client, base, **body):
    r = client.post(base, json={"name": "HCl tank", **body})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_list_get_patch(client, base):
    m = create(client, base, tag="710-D-130335")
    assert m["status"] == "empty" and m["current_version"] is None and m["live_run_id"] is None
    assert [x["id"] for x in client.get(base).json()["items"]] == [m["id"]]
    r = client.patch(f"{base}/{m['id']}", json={"name": "Tank A"})
    assert r.status_code == 200 and r.json()["name"] == "Tank A"
    assert client.get(f"{base}/missing").status_code == 404


def test_manual_version_queues_a_glb_and_marks_ready(client, base, project_id, wait_job):
    m = create(client, base)
    r = client.post(f"{base}/{m['id']}/versions", json={"spec": SPEC, "note": "first"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"]["version"] == 1 and body["version"]["kind"] == "manual"
    assert body["version"]["part_count"] == 1
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded"
    v = client.get(f"{base}/{m['id']}/versions/1").json()
    assert v["glb_status"] == "ready" and v["spec"]["parts"][0]["id"] == "shell"
    assert v["meta"]["top_m"] == pytest.approx(8.0)
    glb = client.get(f"{base}/{m['id']}/versions/1/glb")
    assert glb.status_code == 200 and glb.content[:4] == b"glTF"
    assert glb.headers["content-type"].startswith("model/gltf-binary")
    model = client.get(f"{base}/{m['id']}").json()
    assert model["status"] == "ready" and model["current_version"] == 1


def test_invalid_spec_is_422_with_errors(client, base):
    m = create(client, base)
    bad = {"parts": [SPEC["parts"][0], SPEC["parts"][0]]}  # duplicate id
    r = client.post(f"{base}/{m['id']}/versions", json={"spec": bad})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_spec"
    assert err["details"]["errors"][0]["code"] == "duplicate_id"
    assert client.get(f"{base}/{m['id']}/versions").json()["items"] == []


def test_pydantic_level_spec_error_is_invalid_spec_not_validation_error(client, base):
    m = create(client, base)
    part = {**SPEC["parts"][0], "placement": {"axis": [0, 0, 0]}}
    r = client.post(f"{base}/{m['id']}/versions", json={"spec": {"parts": [part]}})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_spec"
    assert err["details"]["errors"][0]["part_id"] == "shell"


def test_versions_are_never_overwritten_and_restore_adds_one(client, base, project_id, wait_job):
    m = create(client, base)
    v1 = client.post(f"{base}/{m['id']}/versions", json={"spec": SPEC}).json()
    wait_job(project_id, v1["job"]["id"])
    taller = {**SPEC, "parts": [{**SPEC["parts"][0], "params": {"id": 4000, "thickness": 8, "height": 9000}}]}
    v2 = client.post(f"{base}/{m['id']}/versions", json={"spec": taller}).json()
    wait_job(project_id, v2["job"]["id"])
    r = client.post(f"{base}/{m['id']}/versions/1/restore")
    assert r.status_code == 201
    v3 = r.json()["version"]
    assert v3["version"] == 3 and v3["note"] == "Restored from version 1"
    items = client.get(f"{base}/{m['id']}/versions").json()["items"]
    assert [i["version"] for i in items] == [3, 2, 1]
    assert client.get(f"{base}/{m['id']}/versions/2").json()["spec"]["parts"][0]["params"]["height"] == 9000


def test_glb_not_ready_is_409(client, base, handle):
    from app.db.models import AssetModelVersion

    m = create(client, base)
    with handle.session() as s:  # a version whose GLB job has not run
        s.add(
            AssetModelVersion(
                model_id=m["id"],
                version=1,
                spec=SPEC,
                kind="manual",
                glb_status="pending",
                source_ids=[],
                part_count=1,
            )
        )
    r = client.get(f"{base}/{m['id']}/versions/1/glb")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_delete_removes_rows_and_folder(client, base, handle, project_id, wait_job):
    m = create(client, base)
    v = client.post(f"{base}/{m['id']}/versions", json={"spec": SPEC}).json()
    wait_job(project_id, v["job"]["id"])
    folder = handle.asset_models_dir / m["id"]
    assert folder.exists()
    assert client.delete(f"{base}/{m['id']}").status_code == 204
    assert not folder.exists()
    assert client.get(f"{base}/{m['id']}").status_code == 404


def test_run_operations_are_501_until_u5(client, base):
    m = create(client, base)
    r = client.get(f"{base}/{m['id']}/runs")
    assert r.status_code == 501
