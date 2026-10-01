"""Catalogue types carry a definition and ordered severity rules (spec 2026-09-30-project-setup
sections 5 and 12; plan S1-U2 Task 1, Ruling 1 for the scale shrink)."""

import pytest

from app.catalogue import service
from app.catalogue.handle import open_catalogue
from app.errors import AppError

API = "/api/v1/catalogue"
TYPES = f"{API}/types"
RULES = [{"when": "  crack wider than 2 mm ", "severity": 3}, {"when": "any rust staining", "severity": 1}]


@pytest.fixture
def cat(tmp_path):
    handle = open_catalogue(tmp_path)
    yield handle
    handle.engine.dispose()


def _refused(fn, *args, **kwargs) -> AppError:
    with pytest.raises(AppError) as e:
        fn(*args, **kwargs)
    return e.value


def _scale(cat) -> list[dict]:
    return [{"level": lv.level, "name": lv.name, "colour": lv.colour} for lv in service.get_scale(cat)]


def test_a_type_keeps_its_definition_and_rules_in_order(cat):
    t = service.create_type(
        cat, name="Crack", kind="defect", definition="  A visible fracture. ", severity_rules=RULES
    )
    assert t.definition == "A visible fracture."
    assert [(r.when, r.severity) for r in t.severity_rules] == [
        ("crack wider than 2 mm", 3),
        ("any rust staining", 1),
    ]
    assert service.get_type(cat, t.id) == t


def test_a_type_without_them_has_no_definition_and_no_rules(cat):
    t = service.create_type(cat, name="Crane")
    assert (t.definition, t.severity_rules) == (None, ())


def test_a_blank_definition_is_no_definition(cat):
    assert service.create_type(cat, name="Crack", definition="   ").definition is None


def test_a_rule_level_must_be_on_the_scale(cat):
    e = _refused(service.create_type, cat, name="Crack", severity_rules=[{"when": "x", "severity": 5}])
    assert (e.code, e.status, e.details) == ("invalid_severity_rule", 422, {"index": 0, "severity": 5})
    assert service.list_types(cat)[0] == []


def test_at_most_eight_rules(cat):
    rules = [{"when": f"case {i}", "severity": 1} for i in range(9)]
    e = _refused(service.create_type, cat, name="Crack", severity_rules=rules)
    assert (e.code, e.status, e.details) == ("invalid_severity_rule", 422, {"count": 9, "max": 8})
    assert len(service.create_type(cat, name="Crack", severity_rules=rules[:8]).severity_rules) == 8


def test_a_blank_condition_is_refused(cat):
    e = _refused(service.create_type, cat, name="Crack", severity_rules=[{"when": "  ", "severity": 1}])
    assert (e.code, e.details) == ("invalid_severity_rule", {"index": 0})


def test_patch_sets_keeps_and_clears_definition_and_rules(cat):
    t = service.create_type(cat, name="Crack", kind="defect")
    ref, _ = service.patch_type(cat, t.id, {"definition": "Fracture.", "severity_rules": RULES[1:]})
    assert (ref.definition, [r.severity for r in ref.severity_rules]) == ("Fracture.", [1])
    ref, _ = service.patch_type(cat, t.id, {"name": "Cracking"})  # not sent: kept
    assert (ref.definition, len(ref.severity_rules)) == ("Fracture.", 1)
    ref, _ = service.patch_type(cat, t.id, {"definition": None, "severity_rules": []})
    assert (ref.definition, ref.severity_rules) == (None, ())


def test_a_refused_patch_changes_nothing(cat):
    t = service.create_type(cat, name="Crack", severity_rules=RULES)
    e = _refused(
        service.patch_type, cat, t.id, {"name": "Split", "severity_rules": [{"when": "x", "severity": 9}]}
    )
    assert e.code == "invalid_severity_rule"
    assert service.get_type(cat, t.id) == t


def test_shrinking_the_scale_drops_rules_above_the_new_top_and_keeps_the_rest(cat):
    rules = [
        {"when": "through-wall", "severity": 4},
        {"when": "surface only", "severity": 2},
        {"when": "worst case", "severity": 4},
    ]
    t = service.create_type(cat, name="Crack", kind="defect", default_severity=4, severity_rules=rules)
    other = service.create_type(
        cat, name="Rust", kind="defect", severity_rules=[{"when": "any", "severity": 3}]
    )
    service.put_scale(cat, _scale(cat)[:3], level_in_use=lambda level: [])
    got = service.get_type(cat, t.id)
    assert got.default_severity is None
    assert [(r.when, r.severity) for r in got.severity_rules] == [("surface only", 2)]
    assert [r.severity for r in service.get_type(cat, other.id).severity_rules] == [3]


def test_growing_or_renaming_the_scale_keeps_every_rule(cat):
    t = service.create_type(cat, name="Crack", severity_rules=RULES)
    levels = [{**lv, "name": lv["name"] + "!"} for lv in _scale(cat)]
    service.put_scale(cat, levels + [{"level": 5, "name": "Extreme", "colour": "#000000"}], lambda level: [])
    assert service.get_type(cat, t.id).severity_rules == t.severity_rules


def test_the_api_round_trips_definition_and_rules(client):
    r = client.post(
        TYPES,
        json={
            "name": "Crack",
            "kind": "defect",
            "definition": "A fracture.",
            "severity_rules": [{"when": "wider than 2 mm", "severity": 3}],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["definition"], body["severity_rules"], body["origin"]) == (
        "A fracture.",
        [{"when": "wider than 2 mm", "severity": 3}],
        "user",
    )
    assert client.get(f"{TYPES}/{body['id']}").json()["severity_rules"] == body["severity_rules"]
    r = client.patch(f"{TYPES}/{body['id']}", json={"severity_rules": [], "definition": None})
    assert r.status_code == 200, r.text
    assert (r.json()["definition"], r.json()["severity_rules"]) == (None, [])
    listed = client.get(TYPES).json()["items"][0]
    assert (listed["definition"], listed["severity_rules"]) == (None, [])


def test_the_api_refuses_a_rule_off_the_scale_and_nine_rules(client):
    r = client.post(TYPES, json={"name": "Crack", "severity_rules": [{"when": "x", "severity": 7}]})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_severity_rule")
    nine = [{"when": f"c{i}", "severity": 1} for i in range(9)]
    r = client.post(TYPES, json={"name": "Crack", "severity_rules": nine})
    assert r.status_code == 422  # the schema's maxItems answers first (validation_error)
    assert client.get(TYPES).json()["items"] == []
