"""Asset models in the project data list (spec §5)."""

from app.db.models import AssetModel


def _items(client, project_id):
    r = client.get(f"/api/v1/projects/{project_id}/data", params={"type": "asset_model"})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_asset_model_is_listed_as_a_data_item(client, handle, project_id):
    with handle.session() as s:
        s.add(AssetModel(name="Tank", status="empty"))
    (item,) = _items(client, project_id)
    assert item["type"] == "asset_model" and item["label"] == "Tank"
    assert item["status"] == "ready" and item["summary"]["versions"] == 0


def test_building_model_lists_as_importing(client, handle, project_id):
    with handle.session() as s:
        s.add(AssetModel(name="Tank", status="building"))
    assert _items(client, project_id)[0]["status"] == "importing"
