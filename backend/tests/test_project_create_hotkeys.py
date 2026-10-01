"""`POST /projects` with `hotkeys` (spec 2026-09-30-project-setup S1-8 and section 12; plan S1-U2
Task 4 and Ruling 10). Every refusal comes before the folder is touched."""

import pytest
from findings_helpers import add_type

from app.catalogue import project_types

API = "/api/v1"


def _create(client, folder, type_ids, hotkeys=None):
    body: dict = {"name": "P", "folder": str(folder), "type_ids": type_ids}
    if hotkeys is not None:
        body["hotkeys"] = hotkeys
    return client.post(f"{API}/projects", json=body)


def _keys(r) -> list[tuple[str, str | None]]:
    return [(c["id"], c["hotkey"]) for c in r.json()["classes"]]


def _error(r) -> dict:
    return r.json()["error"]


def test_hotkeys_set_the_project_overrides_and_leave_the_catalogue_alone(client, tmp_path):
    a = add_type(client, "Corrosion", hotkey="1")
    b = add_type(client, "Bird nest", kind="object")
    r = _create(client, tmp_path / "p", [a["id"], b["id"]], {a["id"]: "C", b["id"]: "5"})
    assert r.status_code == 201, r.text
    assert _keys(r) == [(a["id"], "c"), (b["id"], "5")]
    assert client.get(f"{API}/catalogue/types/{a['id']}").json()["hotkey"] == "1"  # spec section 16


def test_null_leaves_the_catalogue_hotkey_and_a_type_left_out_keeps_it(client, tmp_path):
    a = add_type(client, "Corrosion", hotkey="1")
    b = add_type(client, "Rust", hotkey="2")
    r = _create(client, tmp_path / "p", [a["id"], b["id"]], {a["id"]: None})
    assert r.status_code == 201, r.text
    assert _keys(r) == [(a["id"], "1"), (b["id"], "2")]


def test_a_hotkey_for_a_type_not_in_the_list_is_422_before_the_folder_is_touched(client, tmp_path):
    a = add_type(client, "Corrosion")
    b = add_type(client, "Rust")
    r = _create(client, tmp_path / "p", [a["id"]], {a["id"]: "1", b["id"]: "2"})
    assert (r.status_code, _error(r)["code"], _error(r)["details"]) == (
        422,
        "hotkey_invalid",
        {"type_ids": [b["id"]]},
    )
    assert not (tmp_path / "p").exists()


def test_hotkeys_without_types_are_422(client, tmp_path):
    r = _create(client, tmp_path / "p", [], {"x": "1"})
    assert (r.status_code, _error(r)["code"]) == (422, "hotkey_invalid")
    assert not (tmp_path / "p").exists()


@pytest.mark.parametrize("bad", ["!!", "0", "ab", " "])
def test_a_value_that_is_not_a_hotkey_is_422_before_the_folder_is_touched(client, tmp_path, bad):
    a = add_type(client, "Corrosion")
    r = _create(client, tmp_path / "p", [a["id"]], {a["id"]: bad})
    assert (r.status_code, _error(r)["code"]) == (422, "hotkey_invalid")
    assert not (tmp_path / "p").exists()


def test_two_types_on_one_hotkey_is_409_before_the_folder_is_touched(client, tmp_path):
    a = add_type(client, "Corrosion", hotkey="1")
    b = add_type(client, "Rust")
    r = _create(client, tmp_path / "p", [a["id"], b["id"]], {b["id"]: "1"})
    assert (r.status_code, _error(r)["code"], _error(r)["details"]["type_ids"]) == (
        409,
        "hotkey_conflict",
        [a["id"], b["id"]],
    )
    assert not (tmp_path / "p").exists()


def test_an_override_gives_a_cleared_type_a_key_of_its_own(client, tmp_path):
    """An archived type may hold the key a live one took since: `add_types` clears the later one,
    and an override gives it its own key."""
    old = add_type(client, "old crack", hotkey="q")
    client.patch(f"{API}/catalogue/types/{old['id']}", json={"archived": True})
    new = add_type(client, "crack", hotkey="q")
    r = _create(client, tmp_path / "p", [new["id"], old["id"]], {old["id"]: "w"})
    assert r.status_code == 201, r.text
    assert _keys(r) == [(new["id"], "q"), (old["id"], "w")]


def test_null_on_a_cleared_type_brings_its_catalogue_key_back_and_clashes(client, tmp_path):
    """Ruling 10: null means what it means on PUT /types - no override, the catalogue's key."""
    old = add_type(client, "old crack", hotkey="q")
    client.patch(f"{API}/catalogue/types/{old['id']}", json={"archived": True})
    new = add_type(client, "crack", hotkey="q")
    r = _create(client, tmp_path / "p", [new["id"], old["id"]], {old["id"]: None})
    assert (r.status_code, _error(r)["code"]) == (409, "hotkey_conflict")
    assert not (tmp_path / "p").exists()


def test_without_hotkeys_set_types_is_never_called(client, tmp_path, monkeypatch):
    a = add_type(client, "Corrosion", hotkey="1")

    def boom(*args, **kwargs):
        raise AssertionError("set_types must not run without hotkeys")

    monkeypatch.setattr(project_types, "set_types", boom)
    r = _create(client, tmp_path / "p", [a["id"]])
    assert r.status_code == 201, r.text
    assert _keys(r) == [(a["id"], "1")]


def test_a_failure_while_applying_hotkeys_leaves_no_project(client, tmp_path, monkeypatch):
    a = add_type(client, "Corrosion")

    def boom(*args, **kwargs):
        raise RuntimeError("disk trouble")

    monkeypatch.setattr(project_types, "set_types", boom)
    with pytest.raises(RuntimeError):
        client.app.state.projects.create("P", tmp_path / "p", [a["id"]], hotkeys={a["id"]: "1"})
    assert not (tmp_path / "p").exists()
