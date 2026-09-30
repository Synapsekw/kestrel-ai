"""Reports CRUD over HTTP (plan R1 Task 4; spec §14, §16, §17 e2e 3)."""

from pathlib import Path

from project_factory import new_project
from reports_helpers import TEMPLATES, add_version, config_json, create_report, reports_url


def test_create_list_get(client, project_id):
    r = create_report(client, project_id, title="North wall", template_id="builtin-findings-summary")
    assert r["template_id"] == "builtin-findings-summary" and r["config"]["cover"]["title"] == "North wall"
    page = client.get(reports_url(project_id)).json()
    assert [i["id"] for i in page["items"]] == [r["id"]] and page["next_cursor"] is None
    assert page["items"][0]["last_version"] is None
    assert client.get(f"{reports_url(project_id)}/{r['id']}").json()["id"] == r["id"]


def test_list_shows_last_version(client, project_id, handle):
    r = create_report(client, project_id)
    add_version(handle, r["id"], number=1, pages=7)
    item = client.get(reports_url(project_id)).json()["items"][0]
    assert item["last_version"]["number"] == 1 and item["last_version"]["pages"] == 7
    assert item["last_version"]["state"] == "ready"


def test_patch_config_round_trips(client, project_id):
    r = create_report(client, project_id)
    raw = config_json()
    raw["sections"] = list(reversed(raw["sections"]))
    resp = client.patch(f"{reports_url(project_id)}/{r['id']}", json={"config": raw})
    assert resp.status_code == 200, resp.text
    assert [s["key"] for s in resp.json()["config"]["sections"]] == [s["key"] for s in raw["sections"]]


def test_patch_422_lists_a_path_per_invalid_field(client, project_id):
    r = create_report(client, project_id)
    raw = config_json()
    raw["paper"]["size"] = "A0"
    raw["filters"]["date"] = {"rule": "last_days", "days": 0}
    resp = client.patch(f"{reports_url(project_id)}/{r['id']}", json={"title": " ", "config": raw})
    assert (resp.status_code, resp.json()["error"]["code"]) == (422, "invalid_report")
    paths = {e["path"] for e in resp.json()["error"]["details"]["errors"]}
    assert "title" in paths
    assert any(p.startswith("config.paper.size") for p in paths), paths
    # a schema error stops before the semantic pass, so the date rule may or may not be listed
    assert client.get(f"{reports_url(project_id)}/{r['id']}").json()["title"] == "Site A"  # nothing written


def test_patch_semantic_error_path(client, project_id):
    r = create_report(client, project_id)
    raw = config_json()
    raw["filters"]["date"] = {"rule": "range", "from": "2026-09-20", "to": "2026-09-01"}
    resp = client.patch(f"{reports_url(project_id)}/{r['id']}", json={"config": raw})
    assert resp.status_code == 422
    assert [e["path"] for e in resp.json()["error"]["details"]["errors"]] == ["config.filters.date.to"]


def test_create_blank_title_is_422(client, project_id):
    resp = client.post(reports_url(project_id), json={"title": "   "})
    assert (resp.status_code, resp.json()["error"]["code"]) == (422, "invalid_report")


def test_delete_deletes_or_archives(client, project_id, handle):
    a = create_report(client, project_id, title="A")
    b = create_report(client, project_id, title="B")
    add_version(handle, b["id"], number=1)
    assert client.delete(f"{reports_url(project_id)}/{a['id']}").status_code == 204
    assert client.get(f"{reports_url(project_id)}/{a['id']}").status_code == 404
    assert client.delete(f"{reports_url(project_id)}/{b['id']}").status_code == 204
    assert client.get(f"{reports_url(project_id)}/{b['id']}").json()["archived"] is True
    assert client.get(reports_url(project_id)).json()["items"] == []
    shown = client.get(reports_url(project_id), params={"include_archived": True}).json()["items"]
    assert [i["id"] for i in shown] == [b["id"]]


def test_duplicate(client, project_id):
    r = create_report(client, project_id, title="A")
    resp = client.post(f"{reports_url(project_id)}/{r['id']}/duplicate")
    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == "A (copy)" and resp.json()["config"] == r["config"]


def test_unknown_report_is_404(client, project_id):
    base = f"{reports_url(project_id)}/nope"
    assert client.get(base).status_code == 404
    assert client.patch(base, json={"title": "x"}).status_code == 404
    assert client.delete(base).status_code == 404
    assert client.post(f"{base}/duplicate").status_code == 404


def test_report_from_custom_template_in_second_project(client, project_id, tmp_path: Path):
    raw = config_json()
    raw["filters"]["data_item_ids"] = ["item-in-project-1"]
    raw["sections"] = list(reversed(raw["sections"]))
    tpl = client.post(TEMPLATES, json={"name": "Weekly", "config": raw}).json()
    other_dir = tmp_path / "second"
    other_dir.mkdir()
    other = new_project(client, other_dir, name="Second")["id"]
    r = create_report(client, other, title="From template", template_id=tpl["id"])
    assert r["config"]["filters"]["data_item_ids"] is None
    assert [s["key"] for s in r["config"]["sections"]] == [s["key"] for s in raw["sections"]]


def test_create_from_builtin_without_catalogue(client, project_id):
    tpl = client.post(TEMPLATES, json={"name": "Custom", "config": config_json()}).json()
    client.app.state.catalogue = None
    assert create_report(client, project_id, template_id="builtin-full")["template_id"] == "builtin-full"
    assert create_report(client, project_id)["template_id"] is None
    resp = client.post(reports_url(project_id), json={"title": "x", "template_id": tpl["id"]})
    assert (resp.status_code, resp.json()["error"]["code"]) == (503, "catalogue_unavailable")
