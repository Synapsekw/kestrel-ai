"""The setup page's Create call sequence against the real backend (spec 2026-09-30-project-setup
sections 6 and 7.4 step 1; plan S1-U2 Task 5): template -> ensure (dry run, then for real) ->
POST /projects with type_ids and hotkeys."""

API = "/api/v1"


def _template(client, template_id: str) -> dict:
    return next(t for t in client.get(f"{API}/project-templates").json()["items"] if t["id"] == template_id)


def _ensure(client, specs: list[dict], dry_run: bool = False) -> list[dict]:
    r = client.post(f"{API}/catalogue/types/ensure", json={"types": specs, "dry_run": dry_run})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_a_builtin_template_becomes_a_project_with_its_types_and_hotkeys(client, tmp_path):
    crane = client.post(
        f"{API}/catalogue/types", json={"name": "Crane", "kind": "object", "hotkey": "1"}
    ).json()
    specs = _template(client, "builtin-vertical")["config"]["types"]
    preview = _ensure(client, specs, dry_run=True)
    assert all(i["id"] is None and i["created"] for i in preview)
    items = _ensure(client, specs)
    ids = [i["id"] for i in items]
    hotkeys = {i: s["hotkey"] for i, s in zip(ids, specs, strict=True)}
    r = client.post(
        f"{API}/projects",
        json={"name": "Tower 7", "folder": str(tmp_path / "tower"), "type_ids": ids, "hotkeys": hotkeys},
    )
    assert r.status_code == 201, r.text
    classes = r.json()["classes"]
    assert [c["name"] for c in classes] == [s["name"] for s in specs]
    assert [c["hotkey"] for c in classes] == [s["hotkey"].lower() for s in specs]
    catalogue = {
        t["id"]: t for t in client.get(f"{API}/catalogue/types", params={"limit": 100}).json()["items"]
    }
    assert all(catalogue[i]["origin"] == "template" and catalogue[i]["definition"] for i in ids)
    on_one = next(i for i, s in zip(ids, specs, strict=True) if s["hotkey"] == "1")
    assert catalogue[on_one]["hotkey"] is None  # Crane keeps the catalogue's key ...
    assert catalogue[crane["id"]]["hotkey"] == "1"  # ... and the project has its own (spec section 16)


def test_a_second_project_from_the_same_template_reuses_every_type(client, tmp_path):
    specs = _template(client, "builtin-mapping")["config"]["types"]
    first = _ensure(client, specs)
    second = _ensure(client, specs)
    assert [i["id"] for i in second] == [i["id"] for i in first]
    assert not any(i["created"] or i["conflict"] for i in second)
