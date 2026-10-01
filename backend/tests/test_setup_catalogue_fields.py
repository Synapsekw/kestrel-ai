"""S1-U1: the catalogue endpoints carry `definition` and `severity_rules` (spec
2026-09-30-project-setup sections 5 and 9) before U2 stores them. Every answer has both keys, a
create or patch that sends them is taken rather than failing, and `origin=template` filters. U2
extends these tests when the service stores the two fields."""

TYPES = "/api/v1/catalogue/types"
RULES = [{"when": "Holes through the member", "severity": 4}]


def test_every_type_answer_carries_a_definition_and_rules(client):
    r = client.post(TYPES, json={"name": "Rust", "kind": "defect"})
    assert r.status_code == 201, r.text
    t = r.json()
    assert {"definition", "severity_rules"} <= set(t)
    assert client.get(f"{TYPES}/{t['id']}").json() == t
    assert all({"definition", "severity_rules"} <= set(i) for i in client.get(TYPES).json()["items"])


def test_a_create_or_patch_that_sends_them_is_taken(client):
    body = {"name": "Pitting", "kind": "defect", "definition": "Small cavities.", "severity_rules": RULES}
    r = client.post(TYPES, json=body)
    assert r.status_code == 201, r.text
    r = client.patch(f"{TYPES}/{r.json()['id']}", json={"definition": None, "severity_rules": RULES})
    assert r.status_code == 200, r.text
    assert {"definition", "severity_rules", "backfill_candidates"} <= set(r.json())


def test_a_rule_outside_the_schema_is_a_validation_error(client):
    for rules in ([{"when": "Holes", "severity": 10}], [{"when": "Holes", "severity": 2, "x": 1}], RULES * 9):
        r = client.post(TYPES, json={"name": "Dent", "severity_rules": rules})
        assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error"), rules


def test_the_list_filters_by_the_template_origin(client):
    client.post(TYPES, json={"name": "Moss"})
    r = client.get(TYPES, params={"origin": "template"})
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []
