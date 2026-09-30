"""Report templates (plan R1 Task 2; spec §6.2, §14 report-templates rows, §16 archived type)."""

import pytest
from reports_helpers import TEMPLATES, config_json

from app.pagination import encode_cursor

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


def _errors(r):
    return r.json()["error"]["details"]["errors"]


def test_blank_name_is_one_entry_on_create_and_patch(client):
    t = _post(client).json()
    for blank in ("", "   "):
        for r in (_post(client, name=blank), client.patch(f"{TEMPLATES}/{t['id']}", json={"name": blank})):
            assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_template")
            assert _errors(r) == [{"path": "name", "message": "Give a name."}]


def test_long_name_is_one_entry_and_a_padded_fitting_name_is_stored_stripped(client):
    t = _post(client).json()
    long = "x" * 121
    for r in (_post(client, name=long), client.patch(f"{TEMPLATES}/{t['id']}", json={"name": long})):
        assert r.status_code == 422
        assert _errors(r) == [{"path": "name", "message": "Keep it to 120 characters."}]
    padded = "  " + "y" * 120 + "  "
    r = _post(client, name=padded)
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "y" * 120
    r = client.patch(f"{TEMPLATES}/{t['id']}", json={"name": padded})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "y" * 120


def test_unknown_key_is_refused_with_its_path(client):
    t = _post(client).json()
    body = {"name": "A", "config": config_json(), "bogus": 1}
    for r in (client.post(TEMPLATES, json=body), client.patch(f"{TEMPLATES}/{t['id']}", json={"bogus": 1})):
        assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_template")
        assert [e["path"] for e in _errors(r)] == ["bogus"]


def test_one_entry_per_path_with_the_semantic_message_preferred(client):
    raw = config_json()
    raw["filters"]["statuses"] = ["open", "open"]
    r = _post(client, name="", config=raw)
    paths = [e["path"] for e in _errors(r)]
    assert len(paths) == len(set(paths)) and "name" in paths and "config.filters.statuses.1" in paths


def test_patch_answers_409_503_404_before_422(client):
    bad = {"name": "", "bogus": 1}
    assert client.patch(f"{TEMPLATES}/builtin-full", json=bad).status_code == 409
    assert client.patch(f"{TEMPLATES}/nope", json=bad).status_code == 404
    custom = _post(client).json()
    client.app.state.catalogue = None
    r = client.patch(f"{TEMPLATES}/{custom['id']}", json=bad)
    assert (r.status_code, r.json()["error"]["code"]) == (503, "catalogue_unavailable")


@pytest.mark.parametrize("cursor", [{"r": "abc", "n": "x", "id": "y"}, {"r": [1], "n": "x", "id": "y"}])
def test_a_cursor_with_wrong_value_types_is_422(client, cursor):
    r = client.get(TEMPLATES, params={"cursor": encode_cursor(**cursor)})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error")
