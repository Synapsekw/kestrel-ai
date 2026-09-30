"""Report templates (plan R1 Task 2; spec §6.2, §14 report-templates rows, §16 archived type)."""

from reports_helpers import TEMPLATES, config_json

BUILTINS = {"builtin-full", "builtin-findings-summary", "builtin-survey-counts", "builtin-volumes"}


def _post(client, name="Weekly", config=None, description="d"):
    return client.post(
        TEMPLATES, json={"name": name, "description": description, "config": config or config_json()}
    )


def test_list_has_the_four_builtins_first(client):
    r = _post(client, name="Aaa custom")
    assert r.status_code == 201, r.text
    items = client.get(TEMPLATES).json()["items"]
    assert {t["id"] for t in items[:4]} == BUILTINS
    assert all(t["builtin"] for t in items[:4])
    assert items[4]["name"] == "Aaa custom" and items[4]["builtin"] is False


def test_list_pages_with_a_cursor(client):
    for i in range(3):
        assert _post(client, name=f"T{i}").status_code == 201
    first = client.get(TEMPLATES, params={"limit": 5}).json()
    assert len(first["items"]) == 5 and first["next_cursor"]
    rest = client.get(TEMPLATES, params={"limit": 5, "cursor": first["next_cursor"]}).json()
    assert [t["name"] for t in rest["items"]] == ["T1", "T2"] and rest["next_cursor"] is None


def test_create_get_patch_delete_a_custom_template(client):
    t = _post(client).json()
    assert client.get(f"{TEMPLATES}/{t['id']}").json()["name"] == "Weekly"
    r = client.patch(f"{TEMPLATES}/{t['id']}", json={"name": "  Monthly  ", "description": "x"})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["description"]) == ("Monthly", "x")
    assert client.delete(f"{TEMPLATES}/{t['id']}").status_code == 204
    assert client.get(f"{TEMPLATES}/{t['id']}").status_code == 404


def test_template_from_report_config_is_portable(client):
    raw = config_json()
    raw["filters"]["data_item_ids"] = ["item-1"]
    raw["cover"]["logo_asset_id"] = "asset-1"
    body = _post(client, config=raw).json()
    assert body["config"]["filters"]["data_item_ids"] is None
    assert body["config"]["cover"]["logo_asset_id"] is None
    r = client.patch(f"{TEMPLATES}/{body['id']}", json={"config": raw})
    assert r.json()["config"]["filters"]["data_item_ids"] is None


def test_builtins_refuse_patch_and_delete(client):
    for tid in BUILTINS:
        r = client.patch(f"{TEMPLATES}/{tid}", json={"name": "x"})
        assert (r.status_code, r.json()["error"]["code"]) == (409, "builtin_template")
        r = client.delete(f"{TEMPLATES}/{tid}")
        assert (r.status_code, r.json()["error"]["code"]) == (409, "builtin_template")


def test_invalid_config_and_blank_name_list_every_path(client):
    raw = config_json()
    raw["paper"]["size"] = "A0"
    r = client.post(TEMPLATES, json={"name": "  ", "config": raw})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_template")
    paths = {e["path"] for e in r.json()["error"]["details"]["errors"]}
    assert "name" in paths and any(p.startswith("config.paper.size") for p in paths)


def test_unknown_template_is_404(client):
    assert client.get(f"{TEMPLATES}/nope").status_code == 404
    assert client.patch(f"{TEMPLATES}/nope", json={"name": "x"}).status_code == 404
    assert client.delete(f"{TEMPLATES}/nope").status_code == 404


def test_catalogue_unavailable_serves_builtins(client):
    custom = _post(client).json()
    client.app.state.catalogue = None
    r = client.get(TEMPLATES)
    assert r.status_code == 200
    assert {t["id"] for t in r.json()["items"]} == BUILTINS and r.json()["next_cursor"] is None
    assert client.get(f"{TEMPLATES}/builtin-volumes").status_code == 200
    for resp in (
        client.get(f"{TEMPLATES}/{custom['id']}"),
        _post(client),
        client.patch(f"{TEMPLATES}/{custom['id']}", json={"name": "x"}),
        client.delete(f"{TEMPLATES}/{custom['id']}"),
    ):
        assert (resp.status_code, resp.json()["error"]["code"]) == (503, "catalogue_unavailable")
    r = client.patch(f"{TEMPLATES}/builtin-full", json={"name": "x"})
    assert r.status_code == 409  # Ruling 9: the built-in check comes first


def test_template_keeps_an_archived_catalogue_type(client):
    t = client.post(
        "/api/v1/catalogue/types", json={"name": "spalling", "colour": "#3b82f6", "kind": "defect"}
    ).json()
    raw = config_json()
    raw["filters"]["type_ids"] = [t["id"]]
    tpl = _post(client, config=raw).json()
    assert client.patch(f"/api/v1/catalogue/types/{t['id']}", json={"archived": True}).status_code == 200
    assert client.get(f"{TEMPLATES}/{tpl['id']}").json()["config"]["filters"]["type_ids"] == [t["id"]]
