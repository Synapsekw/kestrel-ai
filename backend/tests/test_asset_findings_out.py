"""Asset findings C0: every finding and asset model answer carries the fields spec
2026-10-02-asset-findings §8 adds (plan 2026-10-03-asset-findings-c0, Task 3). Until D1 adds the
asset columns, a finding answers them for its own kind: an image finding is its one implicit
sighting, and map and cloud findings have no sighting to show."""

from datetime import UTC, datetime

from findings_helpers import insert_box, insert_cloud

from app.asset_models.schemas import AssetModelVersionOut

API = "/api/v1"
ASSET_FIELDS = ["asset_model_id", "height_m", "bearing_deg", "side", "zone", "component", "placement"]


def _create(client, project_id: str, body: dict) -> dict:
    r = client.post(f"{API}/projects/{project_id}/findings", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_an_image_finding_is_its_own_representative_sighting(client, project_id, handle, crack):
    image_id, box_id = insert_box(handle, crack["id"])
    anchor = {"kind": "image", "image_id": image_id, "annotation_id": box_id}
    f = _create(client, project_id, {"type_id": crack["id"], "anchor": anchor})
    assert f["representative"] == {"image_id": image_id, "annotation_id": box_id}
    assert f["sighting_count"] == 1
    assert {k: f[k] for k in ASSET_FIELDS} == dict.fromkeys(ASSET_FIELDS)
    listed = client.get(f"{API}/projects/{project_id}/findings").json()["items"]
    assert [(x["representative"], x["sighting_count"]) for x in listed] == [(f["representative"], 1)]
    got = client.get(f"{API}/projects/{project_id}/findings/{f['id']}").json()
    assert got["representative"] == f["representative"]


def test_a_cloud_finding_has_no_representative(client, project_id, handle, crack):
    cloud_id = insert_cloud(handle)
    anchor = {"kind": "cloud", "cloud_id": cloud_id, "x": 1.0, "y": 2.0, "z": 3.0}
    f = _create(client, project_id, {"type_id": crack["id"], "anchor": anchor})
    assert (f["representative"], f["sighting_count"]) == (None, 1)
    assert {k: f[k] for k in ASSET_FIELDS} == dict.fromkeys(ASSET_FIELDS)


def test_an_asset_model_answers_its_frame_and_review_as_null(client, project_id):
    r = client.post(f"{API}/projects/{project_id}/asset-models", json={"name": "Stack"})
    assert r.status_code == 201, r.text
    assert (r.json()["frame"], r.json()["review"]) == (None, None)
    listed = client.get(f"{API}/projects/{project_id}/asset-models").json()["items"]
    assert [(m["frame"], m["review"]) for m in listed] == [(None, None)]


def test_a_version_may_be_imported():
    v = AssetModelVersionOut.model_validate(
        {
            "id": "v1",
            "model_id": "m1",
            "version": 1,
            "kind": "imported",
            "glb_status": "pending",
            "source_ids": [],
            "run_id": None,
            "note": None,
            "part_count": 0,
            "meta": None,
            "created_at": datetime(2026, 10, 3, tzinfo=UTC),
        }
    )
    assert v.kind == "imported"
