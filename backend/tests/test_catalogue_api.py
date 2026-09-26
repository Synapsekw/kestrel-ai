"""The catalogue endpoints (spec 2026-09-26-foundation sections 7.1-7.2, 13, 15)."""

from app.db.models import FindingCount

API = "/api/v1"
TYPES = f"{API}/catalogue/types"
SCALE = f"{API}/catalogue/severity"


def _post(client, **body):
    return client.post(TYPES, json=body)


def _error(r) -> dict:
    return r.json()["error"]


def test_create_list_and_get(client):
    r = _post(
        client,
        name="Crack",
        kind="defect",
        colour="#FF0000",
        hotkey="C",
        default_severity=2,
        group="Concrete",
    )
    assert r.status_code == 201, r.text
    t = r.json()
    shown = {
        k: t[k]
        for k in ("name", "kind", "colour", "hotkey", "default_severity", "group", "archived", "origin")
    }
    assert shown == {
        "name": "Crack",
        "kind": "defect",
        "colour": "#ff0000",
        "hotkey": "c",
        "default_severity": 2,
        "group": "Concrete",
        "archived": False,
        "origin": "user",
    }
    assert client.get(f"{TYPES}/{t['id']}").json() == t
    assert [i["id"] for i in client.get(TYPES, params={"kind": "defect"}).json()["items"]] == [t["id"]]


def test_a_name_clash_answers_type_exists_with_the_existing_id(client):
    first = _post(client, name="dump_truck").json()
    r = _post(client, name="Dump truck")
    assert r.status_code == 409
    assert (_error(r)["code"], _error(r)["details"]["type_id"]) == ("type_exists", first["id"])


def test_marking_an_object_type_a_defect_offers_the_backfill(client):
    t = _post(client, name="Pothole").json()
    r = client.patch(f"{TYPES}/{t['id']}", json={"kind": "defect"})
    assert r.status_code == 200, r.text
    assert (r.json()["kind"], r.json()["backfill_candidates"]) == ("defect", True)
    r = client.patch(f"{TYPES}/{t['id']}", json={"colour": "#000000"})
    assert r.json()["backfill_candidates"] is False


def test_archived_types_are_listed_only_on_request(client):
    t = _post(client, name="Rust", kind="defect").json()
    client.patch(f"{TYPES}/{t['id']}", json={"archived": True})
    assert client.get(TYPES).json()["items"] == []
    listed = client.get(TYPES, params={"include_archived": "true"}).json()["items"]
    assert [(i["id"], i["archived"]) for i in listed] == [(t["id"], True)]


def test_the_scale_round_trips(client):
    levels = client.get(SCALE).json()["levels"]
    assert [lv["name"] for lv in levels] == ["Minor", "Moderate", "Major", "Critical"]
    levels.append({"level": 5, "name": "Severe", "colour": "#990000"})
    r = client.put(SCALE, json={"levels": levels})
    assert r.status_code == 200, r.text
    assert [lv["level"] for lv in client.get(SCALE).json()["levels"]] == [1, 2, 3, 4, 5]


def test_the_top_level_stays_while_an_open_project_uses_it(client, project, handle):
    with handle.session() as s:
        s.add(FindingCount(status="closed", severity=4, type_id="t1", n=1))
    levels = client.get(SCALE).json()["levels"][:3]
    r = client.put(SCALE, json={"levels": levels})
    assert r.status_code == 409
    assert (_error(r)["code"], _error(r)["details"]) == (
        "severity_in_use",
        {"level": 4, "projects": [project["name"]]},
    )


def test_a_project_whose_counts_cannot_be_read_still_counts_as_using_the_level(
    client, project, handle, monkeypatch
):
    """`projects_using_level` fails closed (controller ruling): a project it could not check for
    findings on the level is still counted as using it, not silently skipped, so an operator never
    removes a level a project it could not read still relies on. No FindingCount row exists for this
    project at all; the refusal fires purely because the project's counts could not be read."""

    def _boom():
        raise RuntimeError("project.db is locked")

    monkeypatch.setattr(handle, "session", _boom)
    levels = client.get(SCALE).json()["levels"][:3]
    r = client.put(SCALE, json={"levels": levels})
    assert r.status_code == 409
    assert (_error(r)["code"], _error(r)["details"]) == (
        "severity_in_use",
        {"level": 4, "projects": [project["name"]]},
    )


def test_catalogue_edits_publish_catalogue_changed(client, monkeypatch):
    seen: list[dict] = []
    monkeypatch.setattr(client.app.state.events, "publish", seen.append)
    t = _post(client, name="Crack", kind="defect").json()
    client.patch(f"{TYPES}/{t['id']}", json={"colour": "#000000"})
    client.put(SCALE, json={"levels": client.get(SCALE).json()["levels"]})
    changed = [(e["project_id"], e["payload"]) for e in seen if e["type"] == "catalogue.changed"]
    assert changed == [
        ("library", {"type_ids": [t["id"]]}),
        ("library", {"type_ids": [t["id"]]}),
        ("library", {"severity": True}),
    ]


def test_the_classification_flag_is_listed_and_cleared(client):
    from app.catalogue import service

    assert client.get(TYPES).json().get("needs_classification", False) is False
    service.set_meta(client.app.state.catalogue, service.NEEDS_CLASSIFICATION, {"count": 12})
    assert client.get(TYPES).json()["needs_classification"] is True
    assert client.post(f"{API}/catalogue/classification/done").status_code == 204
    assert client.get(TYPES).json()["needs_classification"] is False


def test_without_the_catalogue_every_catalogue_endpoint_is_503(client):
    client.app.state.catalogue = None
    for r in (
        client.get(TYPES),
        _post(client, name="Crack"),
        client.get(f"{TYPES}/x"),
        client.patch(f"{TYPES}/x", json={"name": "y"}),
        client.get(SCALE),
        client.post(f"{API}/catalogue/classification/done"),
    ):
        assert (r.status_code, _error(r)["code"]) == (503, "catalogue_unavailable")
