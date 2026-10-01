"""Project templates (spec 2026-09-30-project-setup sections 4 S1-4, 5, 9, 11, 12; plan S1-U2
Task 3 and Rulings 8, 9, 11)."""

import pytest

from app.catalogue.db import ProjectTemplate
from app.setup.builtins import BUILTIN_TEMPLATES
from app.setup.schemas import TemplateConfig
from app.setup.templates import validate_config

TEMPLATES = "/api/v1/project-templates"
BUILTIN_IDS = {"builtin-mapping", "builtin-vertical", "builtin-confined"}


def config(**over) -> dict:
    base = {
        "config_version": 1,
        "slots": [
            {
                "key": "photos",
                "label": "Photos",
                "route": "images",
                "required": True,
                "accepts": ["jpg", "jpeg"],
                "match": None,
            },
            {
                "key": "ortho",
                "label": "Orthomosaic",
                "route": "map",
                "required": False,
                "accepts": ["tif"],
                "match": {"raster": "ortho"},
            },
        ],
        "types": [
            {
                "name": "Corrosion",
                "kind": "defect",
                "colour": "#ff9c3a",
                "default_severity": 2,
                "hotkey": "1",
                "definition": "Rust.",
                "severity_rules": [],
            },
            {
                "name": "Bird nest",
                "kind": "object",
                "colour": None,
                "default_severity": None,
                "hotkey": "2",
                "definition": None,
                "severity_rules": [{"when": "on a live antenna", "severity": 3}],
            },
        ],
    }
    base.update(over)
    return base


SLOT = config()["slots"][0]
TYPE = config()["types"][0]


def _with(slots=(), types=()) -> dict:
    c = config()
    c["slots"] += list(slots)
    c["types"] += list(types)
    return c


def _post(client, name="Bridge deck", **body):
    return client.post(TEMPLATES, json={"name": name, "config": body.pop("config", config()), **body})


def _items(client) -> list[dict]:
    return client.get(TEMPLATES).json()["items"]


def _error(r) -> dict:
    return r.json()["error"]


def test_the_list_has_the_three_builtins_first_then_by_name(client):
    for name in ("zeta", "Alpha"):
        assert _post(client, name=name).status_code == 201
    items = _items(client)
    assert {t["id"] for t in items[:3]} == BUILTIN_IDS and all(t["builtin"] for t in items[:3])
    assert [(t["name"], t["builtin"]) for t in items[3:]] == [("Alpha", False), ("zeta", False)]


def test_create_round_trips_the_config(client):
    r = _post(client, description="  Deck and bearings  ")
    assert r.status_code == 201, r.text
    t = r.json()
    assert (t["name"], t["description"], t["builtin"]) == ("Bridge deck", "Deck and bearings", False)
    assert t["config"]["types"] == config()["types"]
    assert [(s["key"], s["route"], s["required"]) for s in t["config"]["slots"]] == [
        ("photos", "images", True),
        ("ortho", "map", False),
    ]
    assert t["config"]["slots"][1]["match"]["raster"] == "ortho"
    assert t["config"]["slots"][1]["match"] == {"raster": "ortho"}  # no null key for the absent `thermal`
    assert next(i for i in _items(client) if i["id"] == t["id"]) == t


def test_a_name_is_unique_by_normalised_name_including_builtins(client):
    assert _post(client, name="Bridge deck").status_code == 201
    r = _post(client, name="  bridge_DECK ")
    assert (r.status_code, _error(r)["code"]) == (409, "template_name_taken")
    builtin = next(t for t in _items(client) if t["id"] == "builtin-mapping")
    r = _post(client, name=builtin["name"].upper())
    assert (r.status_code, _error(r)["code"], _error(r)["details"]) == (
        409,
        "template_name_taken",
        {"template_id": "builtin-mapping"},
    )


def test_a_blank_template_name_is_422(client):
    r = _post(client, name="   ")  # the schema's not-blank pattern refuses it
    assert (r.status_code, _error(r)["code"]) == (422, "validation_error")
    r = _post(client, name=" _-_ ")  # passes the schema, normalises to nothing
    assert (r.status_code, _error(r)["code"]) == (422, "invalid_template")
    assert _error(r)["details"]["errors"] == [{"path": "name", "message": "A template name cannot be blank."}]


@pytest.mark.parametrize(
    ("cfg", "path"),
    [
        (_with(slots=[{**SLOT, "label": "Again"}]), "config.slots.2.key"),
        (_with(types=[{**TYPE, "name": "corrosion ", "hotkey": None}]), "config.types.2.name"),
        (
            _with(
                types=[
                    {**TYPE, "name": "Weld_Crack", "hotkey": None},
                    {**TYPE, "name": "weld crack", "hotkey": None},
                ]
            ),
            "config.types.3.name",
        ),
        (
            _with(
                types=[
                    {**TYPE, "name": "Pitting", "hotkey": "Q"},
                    {**TYPE, "name": "Deposits", "hotkey": "q"},
                ]
            ),
            "config.types.3.hotkey",
        ),
        (_with(types=[{**TYPE, "name": " _ ", "hotkey": None}]), "config.types.2.name"),
    ],
)
def test_an_invalid_config_is_422_invalid_template_with_a_path(client, cfg, path):
    r = _post(client, config=cfg)
    assert (r.status_code, _error(r)["code"]) == (422, "invalid_template")
    assert [e["path"] for e in _error(r)["details"]["errors"]] == [path]
    assert len(_items(client)) == 3


def test_rule_levels_are_not_checked_against_the_scale_on_save(client):
    """Ruling 8: a template outlives scale edits; `ensure` checks levels when it is used."""
    cfg = _with(
        types=[{**TYPE, "name": "Leak", "hotkey": None, "severity_rules": [{"when": "x", "severity": 9}]}]
    )
    assert _post(client, config=cfg).status_code == 201


def test_patch_renames_redescribes_and_replaces_the_config(client):
    t = _post(client).json()
    new = config(slots=[config()["slots"][1]], types=[])
    r = client.patch(
        f"{TEMPLATES}/{t['id']}", json={"name": "Bridge deck v2", "description": "x", "config": new}
    )
    assert r.status_code == 200, r.text
    got = r.json()
    assert (
        got["name"],
        got["description"],
        [s["key"] for s in got["config"]["slots"]],
        got["config"]["types"],
    ) == (
        "Bridge deck v2",
        "x",
        ["ortho"],
        [],
    )
    r = client.patch(f"{TEMPLATES}/{t['id']}", json={"name": "BRIDGE DECK V2"})  # its own name, recased
    assert (r.status_code, r.json()["name"]) == (200, "BRIDGE DECK V2")


def test_patch_refuses_a_taken_name_and_an_invalid_config(client):
    a = _post(client, name="A").json()
    assert _post(client, name="B").status_code == 201
    r = client.patch(f"{TEMPLATES}/{a['id']}", json={"name": "b"})
    assert (r.status_code, _error(r)["code"]) == (409, "template_name_taken")
    r = client.patch(f"{TEMPLATES}/{a['id']}", json={"config": _with(slots=[SLOT])})
    assert (r.status_code, _error(r)["code"]) == (422, "invalid_template")
    assert next(i for i in _items(client) if i["id"] == a["id"]) == a


@pytest.mark.parametrize("builtin_id", sorted(BUILTIN_IDS))
def test_builtins_refuse_patch_and_delete(client, builtin_id):
    r = client.patch(f"{TEMPLATES}/{builtin_id}", json={"name": "Mine"})
    assert (r.status_code, _error(r)["code"]) == (409, "template_builtin")
    r = client.delete(f"{TEMPLATES}/{builtin_id}")
    assert (r.status_code, _error(r)["code"]) == (409, "template_builtin")
    assert builtin_id in {t["id"] for t in _items(client)}


def test_delete_removes_a_user_template_and_frees_its_name(client):
    t = _post(client).json()
    assert client.delete(f"{TEMPLATES}/{t['id']}").status_code == 204
    assert t["id"] not in {i["id"] for i in _items(client)}
    for r in (client.delete(f"{TEMPLATES}/{t['id']}"), client.patch(f"{TEMPLATES}/nope", json={"name": "x"})):
        assert (r.status_code, _error(r)["code"]) == (404, "not_found")
    assert _post(client).status_code == 201


def test_a_damaged_stored_template_is_left_out_of_the_list(client):
    with client.app.state.catalogue.session() as s:
        s.add(
            ProjectTemplate(
                id="broken",
                name="Broken",
                name_key="broken",
                description="",
                builtin=False,
                config={"config_version": 99},
            )
        )
    ids = {t["id"] for t in _items(client)}
    assert "broken" not in ids and BUILTIN_IDS <= ids


def test_without_the_catalogue_every_template_endpoint_is_503(client):
    client.app.state.catalogue = None
    for r in (
        client.get(TEMPLATES),
        _post(client),
        client.patch(f"{TEMPLATES}/x", json={"name": "y"}),
        client.delete(f"{TEMPLATES}/x"),
    ):
        assert (r.status_code, _error(r)["code"]) == (503, "catalogue_unavailable")


def test_the_builtins_pass_the_rules_a_saved_template_must():
    for t in BUILTIN_TEMPLATES:
        validate_config(TemplateConfig.model_validate(t["config"]))
