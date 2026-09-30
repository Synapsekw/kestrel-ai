"""`POST /catalogue/types/ensure` (spec 2026-09-30-project-setup section 6; index ruling S-R2;
plan S1-U2 Task 2 and Rulings 2-7)."""

import pytest
from sqlalchemy import func, select

from app.catalogue import service, template_types
from app.catalogue.db import CatalogueType
from app.catalogue.handle import open_catalogue
from app.catalogue.schemas import CatalogueTypeSpec
from app.errors import AppError

ENSURE = "/api/v1/catalogue/types/ensure"


@pytest.fixture
def cat(tmp_path):
    handle = open_catalogue(tmp_path)
    yield handle
    handle.engine.dispose()


def spec(name: str, kind: str = "defect", **fields) -> CatalogueTypeSpec:
    return CatalogueTypeSpec(name=name, kind=kind, **fields)


def ensure(cat, *specs, dry_run=False):
    return template_types.ensure_template_types(cat, list(specs), dry_run=dry_run)


def _count(cat) -> int:
    with cat.session() as s:
        return s.execute(select(func.count()).select_from(CatalogueType)).scalar_one()


def _archived(cat, name: str, **fields):
    t = service.create_type(cat, name=name, **fields)
    service.patch_type(cat, t.id, {"archived": True})
    return t


def test_a_miss_creates_the_type_with_the_template_fields(cat):
    [item] = ensure(
        cat,
        spec(
            "Corrosion",
            colour="#FF9C3A",
            default_severity=2,
            hotkey="Q",
            definition="Rust on steel. ",
            severity_rules=[{"when": "flaking", "severity": 3}],
        ),
    )
    assert (item.name, item.created, item.conflict) == ("Corrosion", True, None)
    t = service.get_type(cat, item.id)
    assert (t.name, t.kind, t.colour, t.default_severity, t.hotkey, t.origin, t.definition) == (
        "Corrosion",
        "defect",
        "#ff9c3a",
        2,
        "q",
        "template",
        "Rust on steel.",
    )
    assert [(r.when, r.severity) for r in t.severity_rules] == [("flaking", 3)]


def test_a_match_by_normalised_name_reuses_the_type_and_reports_a_conflict(cat):
    bolt = service.create_type(cat, name="Loose / missing bolt", kind="object", colour="#123456")
    items = ensure(
        cat,
        spec("loose /  MISSING bolt", kind="defect", colour="#123456"),
        spec("Loose / missing bolt", kind="object", colour="#123456"),
    )
    assert [(i.id, i.created, i.name) for i in items] == [(bolt.id, False, "Loose / missing bolt")] * 2
    assert items[0].conflict.model_dump() == {"kind": "object", "colour": "#123456"}
    assert items[1].conflict is None
    assert service.get_type(cat, bolt.id) == bolt  # the Catalogue wins (S1-3)
    assert _count(cat) == 1


def test_a_colour_difference_alone_is_a_conflict_and_no_colour_never_is(cat):
    t = service.create_type(cat, name="Stockpile", colour="#3b82f6")
    a, b = ensure(cat, spec("Stockpile", kind="object", colour="#000000"), spec("stockpile", kind="object"))
    assert a.conflict.model_dump() == {"kind": "object", "colour": "#3b82f6"}
    assert b.conflict is None and a.id == b.id == t.id


def test_two_specs_that_normalise_alike_create_one_type(cat):
    a, b = ensure(cat, spec("Weld crack"), spec("weld_crack"))
    assert (a.created, b.created, a.id == b.id) == (True, False, True)
    assert _count(cat) == 1


def test_an_archived_match_comes_back_with_its_history_and_without_a_taken_hotkey(cat):
    old = _archived(cat, "Bird nest", hotkey="5")
    holder = service.create_type(cat, name="Crane", hotkey="5")
    [item] = ensure(cat, spec("bird nest", kind="object", hotkey="5"))
    assert (item.id, item.created, item.conflict) == (old.id, False, None)
    back = service.get_type(cat, old.id)
    assert (back.archived, back.hotkey, back.origin) == (False, None, "user")
    assert service.get_type(cat, holder.id).hotkey == "5"


def test_an_archived_match_keeps_a_free_hotkey(cat):
    old = _archived(cat, "Bird nest", hotkey="5")
    ensure(cat, spec("Bird nest", kind="object"))
    assert service.get_type(cat, old.id).hotkey == "5"


def test_a_template_hotkey_held_by_another_live_type_is_not_taken(cat):
    crane = service.create_type(cat, name="Crane", hotkey="1")
    a, b = ensure(cat, spec("Corrosion", hotkey="1"), spec("Coating damage", hotkey="2"))
    assert (a.created, service.get_type(cat, a.id).hotkey) == (True, None)
    assert service.get_type(cat, b.id).hotkey == "2"
    assert service.get_type(cat, crane.id).hotkey == "1"


def test_two_new_types_with_one_hotkey_keep_it_on_the_first(cat):
    a, b = ensure(cat, spec("Pitting", hotkey="3"), spec("Blistering", hotkey="3"))
    assert (service.get_type(cat, a.id).hotkey, service.get_type(cat, b.id).hotkey) == ("3", None)


def test_the_existing_ensure_types_still_creates_beside_an_archived_type(cat):
    """Ruling S-R2: only the new function unarchives."""
    old = _archived(cat, "Roller")
    assert service.ensure_types(cat, ["roller"])["roller"].id != old.id


def test_dry_run_writes_nothing(cat):
    old = _archived(cat, "Bird nest")
    live = service.create_type(cat, name="Crane", kind="object")
    before = _count(cat)
    items = ensure(
        cat, spec("New thing"), spec("bird nest", kind="object"), spec("crane", kind="defect"), dry_run=True
    )
    assert [(i.id, i.created) for i in items] == [(None, True), (old.id, False), (live.id, False)]
    assert items[0].name == "New thing"
    assert items[2].conflict.kind == "object"
    assert _count(cat) == before
    assert service.get_type(cat, old.id).archived is True


def test_an_invalid_spec_refuses_the_whole_request_before_writing(cat):
    old = _archived(cat, "Bird nest")
    before = _count(cat)
    with pytest.raises(AppError) as e:
        ensure(cat, spec("A"), spec("bird nest"), spec("C", severity_rules=[{"when": "x", "severity": 9}]))
    assert (e.value.code, e.value.status) == ("invalid_severity_rule", 422)
    assert e.value.details == {"index": 0, "severity": 9, "type_index": 2, "name": "C"}
    assert _count(cat) == before and service.get_type(cat, old.id).archived is True


def test_a_default_severity_off_the_scale_is_refused_even_on_a_match(cat):
    service.create_type(cat, name="Crack", kind="defect")
    with pytest.raises(AppError) as e:
        ensure(cat, spec("crack", default_severity=7))
    assert (e.value.code, e.value.details["type_index"]) == ("severity_unknown", 0)


def test_a_name_that_normalises_to_nothing_is_refused(cat):
    with pytest.raises(AppError) as e:
        ensure(cat, spec("Crack"), spec(" _- "))
    assert (e.value.code, e.value.status, e.value.details) == (
        "type_name_blank",
        422,
        {"type_index": 1, "name": " _- "},
    )
    assert _count(cat) == 0


def test_a_failure_halfway_leaves_nothing(cat, monkeypatch):
    old = _archived(cat, "Bird nest", hotkey="5")
    before = _count(cat)
    real = template_types._new_row
    calls: list[int] = []

    def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("disk trouble")
        return real(*args, **kwargs)

    monkeypatch.setattr(template_types, "_new_row", flaky)
    with pytest.raises(RuntimeError):
        ensure(cat, spec("First"), spec("bird nest", kind="object"), spec("Second"))
    assert len(calls) == 2
    assert _count(cat) == before
    back = service.get_type(cat, old.id)
    assert (back.archived, back.hotkey) == (True, "5")


def test_the_route_ensures_publishes_and_a_dry_run_publishes_nothing(client, monkeypatch):
    seen: list[dict] = []
    monkeypatch.setattr(client.app.state.events, "publish", seen.append)
    r = client.post(ENSURE, json={"types": [{"name": "Corrosion", "kind": "defect"}]})
    assert r.status_code == 200, r.text
    [item] = r.json()["items"]
    assert (item["name"], item["created"], item["conflict"]) == ("Corrosion", True, None)
    r = client.post(ENSURE, json={"types": [{"name": "corrosion", "kind": "object"}], "dry_run": True})
    again = r.json()["items"][0]
    assert (again["id"], again["created"], again["conflict"]["kind"]) == (item["id"], False, "defect")
    changed = [e["payload"] for e in seen if e["type"] == "catalogue.changed"]
    assert changed == [{"type_ids": [item["id"]]}]


def test_the_route_refuses_a_rule_off_the_scale(client):
    body = {"types": [{"name": "Crack", "kind": "defect", "severity_rules": [{"when": "x", "severity": 6}]}]}
    r = client.post(ENSURE, json=body)
    assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_severity_rule")


def test_the_route_takes_at_most_64_types(client):
    r = client.post(ENSURE, json={"types": [{"name": f"T{i}", "kind": "object"} for i in range(65)]})
    assert r.status_code == 422
    assert client.get("/api/v1/catalogue/types").json()["items"] == []


def test_without_the_catalogue_ensure_is_503(client):
    client.app.state.catalogue = None
    r = client.post(ENSURE, json={"types": [{"name": "Crack", "kind": "defect"}]})
    assert (r.status_code, r.json()["error"]["code"]) == (503, "catalogue_unavailable")
