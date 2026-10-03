"""The items, item and CSV routes (spec §10; plan A1 task 8)."""

from pathlib import Path

import pytest
import yaml
from plant_fixture import fixture_plant_spec, synthetic_plant
from plant_helpers import Ctx, seed_version

from app.asset_models.jobs_glb import run_glb
from app.asset_models.schemas_plant import AssetItemRowOut

CONTRACT = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"


@pytest.fixture
def plant(handle):
    spec = fixture_plant_spec()
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    return mid, spec


def url(pid, mid, tail="", version=1):
    return f"/api/v1/projects/{pid}/asset-models/{mid}/versions/{version}{tail}"


def ids_of(client, u, **params):
    r = client.get(u, params={"limit": 500, **params})
    assert r.status_code == 200, r.text
    return [i["node"] for i in r.json()["items"]]


def test_row_fields_match_the_contract():
    doc = yaml.safe_load(CONTRACT.read_text("utf-8"))
    assert set(doc["components"]["schemas"]["AssetItemRow"]["properties"]) == set(
        AssetItemRowOut.model_fields
    )


def test_pages_follow_the_cursor_in_node_order(client, project_id, plant):
    mid, spec = plant
    page = client.get(url(project_id, mid, "/items"), params={"limit": 20}).json()
    assert len(page["items"]) == 20 and page["next_cursor"] == page["items"][-1]["node"]
    seen = [i["node"] for i in page["items"]]
    while page["next_cursor"]:
        page = client.get(
            url(project_id, mid, "/items"), params={"limit": 20, "cursor": page["next_cursor"]}
        ).json()
        seen += [i["node"] for i in page["items"]]
    assert seen == sorted(i["id"] for i in spec["items"])


def test_limit_is_capped_at_500(client, project_id, plant):
    mid, _ = plant
    assert client.get(url(project_id, mid, "/items"), params={"limit": 501}).status_code == 422


def test_filters(client, project_id, plant):
    mid, spec = plant
    u = url(project_id, mid, "/items")
    items = spec["items"]
    tanks = sorted(i["id"] for i in items if i["type"] == "tank_lng")
    assert ids_of(client, u, q="20-t") == tanks
    assert ids_of(client, u, q="control building") == [i["id"] for i in items if i["type"] == "building"][:1]
    assert ids_of(client, u, type="pump") == sorted(i["id"] for i in items if i["type"] == "pump")
    assert ids_of(client, u, area="80") == sorted(i["id"] for i in items if i["area"] == "80")
    assert ids_of(client, u, flag="height_mismatch") == [next(i["id"] for i in items if i["type"] == "pump")]
    assert ids_of(client, u, bbox="1200,500,1500,700") == tanks
    assert ids_of(client, u, q="100%_") == []


def test_bad_bbox_and_cursor_are_422(client, project_id, plant):
    mid, _ = plant
    u = url(project_id, mid, "/items")
    for bbox in ("1,2,3", "a,b,c,d"):  # rejected by the contract's pattern, before the handler
        assert client.get(u, params={"bbox": bbox}).status_code == 422, bbox
    for params, code in (
        ({"bbox": "5,0,1,1"}, "invalid_bbox"),
        ({"cursor": "bad cursor!"}, "invalid_cursor"),
    ):
        r = client.get(u, params=params)
        assert r.status_code == 422 and r.json()["error"]["code"] == code, params


def test_unknown_model_or_version_is_404(client, project_id, plant):
    mid, _ = plant
    assert client.get(url(project_id, "missing", "/items")).status_code == 404
    assert client.get(url(project_id, mid, "/items", version=9)).status_code == 404
    assert client.get(url(project_id, mid, "/csv", version=9)).status_code == 404


def test_rows_carry_the_index_values(client, project_id, plant):
    mid, _ = plant
    [row] = client.get(url(project_id, mid, "/items"), params={"q": "20-T-0001"}).json()["items"]
    assert row["tag"] == "20-T-0001" and row["type"] == "tank_lng" and row["area"] == "20"
    assert row["site_x"] is not None and 28 < row["lat"] < 29.5 and row["has_geometry"] in (True, False)


def test_get_item_returns_the_spec_item(client, project_id, plant):
    mid, _ = plant
    r = client.get(url(project_id, mid, "/items/20-T-0001"))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "20-T-0001" and body["footprint"]["kind"] == "circle"
    assert client.get(url(project_id, mid, "/items/nope")).status_code == 404


def test_csv_route(client, project_id, plant, handle):
    mid, spec = plant
    r = client.get(url(project_id, mid, "/csv"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.content.decode("utf-8").splitlines()
    assert lines[0].startswith("node,tag,name,type,area,group,plant_E,plant_N,utm39_E,utm39_N")
    assert len(lines) == 1 + len(spec["items"])
    seed_version(handle, spec, model_id=mid, version=2)  # pending: no files yet
    r2 = client.get(url(project_id, mid, "/csv", version=2))
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "not_ready"
    assert client.get(url(project_id, mid, "/items", version=2)).json() == {"items": [], "next_cursor": None}


def test_version_detail_of_a_large_spec_does_not_validate(client, project_id, handle, monkeypatch):
    import app.asset_models.service as service

    mid = seed_version(handle, synthetic_plant(250, types=("other",)))
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))

    def boom(_spec):
        raise AssertionError("validate ran in the request")

    monkeypatch.setattr(service, "validate", boom)
    r = client.get(f"/api/v1/projects/{project_id}/asset-models/{mid}/versions/1")
    assert r.status_code == 200 and isinstance(r.json()["warnings"], list)
