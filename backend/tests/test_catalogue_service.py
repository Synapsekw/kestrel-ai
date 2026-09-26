"""Catalogue rules (spec 2026-09-26-foundation section 7.2): names match by normalise_name, types are
archived and never deleted, hotkeys are unique among live types, and the severity scale only grows
at the top or shrinks there when nothing uses the level."""

import pytest

from app.catalogue import service
from app.catalogue.handle import open_catalogue
from app.catalogue.names import normalise_name
from app.errors import AppError


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


@pytest.mark.parametrize(
    ("raw", "key"),
    [
        ("dump_truck", "dump truck"),
        ("  Dump   Truck ", "dump truck"),
        ("Dump-Truck", "dump truck"),
        ("DUMP__TRUCK", "dump truck"),
        ("Straße", "strasse"),
    ],
)
def test_normalise_name(raw, key):
    assert normalise_name(raw) == key


def test_a_name_that_normalises_to_an_existing_one_is_type_exists(cat):
    first = service.create_type(cat, name="dump_truck")
    e = _refused(service.create_type, cat, name="Dump truck")
    assert (e.code, e.status, e.details["type_id"]) == ("type_exists", 409, first.id)


def test_a_blank_name_is_refused(cat):
    e = _refused(service.create_type, cat, name="  _- ")
    assert (e.code, e.status) == ("type_name_blank", 409)


def test_an_archived_name_can_return_but_cannot_be_unarchived_into_a_clash(cat):
    old = service.create_type(cat, name="Crack", kind="defect")
    service.patch_type(cat, old.id, {"archived": True})
    new = service.create_type(cat, name="crack", kind="defect")
    assert new.id != old.id
    e = _refused(service.patch_type, cat, old.id, {"archived": False})
    assert (e.code, e.details["type_id"]) == ("type_exists", new.id)


def test_hotkeys_are_lower_case_and_unique_among_live_types(cat):
    crack = service.create_type(cat, name="Crack", kind="defect", hotkey="C")
    assert crack.hotkey == "c"
    e = _refused(service.create_type, cat, name="Corrosion", hotkey="c")
    assert (e.code, e.status, e.details["type_id"]) == ("hotkey_conflict", 409, crack.id)
    service.patch_type(cat, crack.id, {"archived": True})
    assert service.create_type(cat, name="Corrosion", hotkey="c").hotkey == "c"


def test_a_default_severity_must_be_on_the_scale(cat):
    e = _refused(service.create_type, cat, name="Crack", kind="defect", default_severity=7)
    assert (e.code, e.status) == ("severity_unknown", 422)
    assert service.create_type(cat, name="Crack", kind="defect", default_severity=4).default_severity == 4


def test_object_to_defect_offers_a_backfill_and_the_reverse_does_not(cat):
    t = service.create_type(cat, name="Pothole")
    ref, offer = service.patch_type(cat, t.id, {"kind": "defect"})
    assert (ref.kind, offer) == ("defect", True)
    ref, offer = service.patch_type(cat, t.id, {"kind": "object"})
    assert (ref.kind, offer) == ("object", False)


def test_patch_renames_recolours_and_regroups(cat):
    t = service.create_type(cat, name="Crack", kind="defect")
    ref, _ = service.patch_type(
        cat, t.id, {"name": "Hairline crack", "colour": "#AABBCC", "group": "Concrete"}
    )
    assert (ref.name, ref.colour, ref.group) == ("Hairline crack", "#aabbcc", "Concrete")


def test_resolve_types_looks_types_up_by_id(cat):
    t = service.create_type(cat, name="Crack", kind="defect")
    assert service.resolve_types(cat, [t.id, "nope"]) == {t.id: t}


def test_find_by_names_matches_by_normalised_name(cat):
    truck = service.create_type(cat, name="Dump truck")
    got = service.find_by_names(cat, ["dump_truck", "DUMP-TRUCK", "crane"])
    assert got["dump_truck"].id == truck.id == got["DUMP-TRUCK"].id
    assert "crane" not in got
    assert service.normalise_name is normalise_name  # BM imports it from the service


def test_ensure_types_creates_each_missing_type_once(cat):
    service.create_type(cat, name="Crane", hotkey="1")
    got = service.ensure_types(
        cat,
        ["Excavator", "excavator", "Crane"],
        origin="migrated",
        colours={"Excavator": "#123456"},
        hotkeys={"Excavator": "1"},
    )
    ex = got["Excavator"]
    assert got["excavator"].id == ex.id
    assert (ex.origin, ex.kind, ex.colour, ex.hotkey) == ("migrated", "object", "#123456", None)
    assert got["Crane"].origin == "user"
    types, _ = service.list_types(cat)
    assert sorted(t.name for t in types) == ["Crane", "Excavator"]


def test_ensure_types_creates_a_live_type_beside_an_archived_one(cat):
    old = service.create_type(cat, name="Roller")
    service.patch_type(cat, old.id, {"archived": True})
    assert service.find_by_names(cat, ["roller"]) == {}
    got = service.ensure_types(cat, ["roller"])
    assert got["roller"].id != old.id and not got["roller"].archived
    assert service.find_by_names(cat, ["Roller"])["Roller"].id == got["roller"].id


def test_list_types_filters_and_pages(cat):
    for name, kind in [
        ("Crack", "defect"),
        ("Crane", "object"),
        ("Dump truck", "object"),
        ("Spall", "defect"),
    ]:
        service.create_type(cat, name=name, kind=kind)
    gone = service.create_type(cat, name="Rust", kind="defect")
    service.patch_type(cat, gone.id, {"archived": True})
    first, cursor = service.list_types(cat, limit=2)
    second, end = service.list_types(cat, limit=2, cursor=cursor)
    assert [t.name for t in first + second] == ["Crack", "Crane", "Dump truck", "Spall"]
    assert cursor is not None and end is None
    assert [t.name for t in service.list_types(cat, kind="defect")[0]] == ["Crack", "Spall"]
    assert "Rust" in [t.name for t in service.list_types(cat, include_archived=True)[0]]
    assert [t.name for t in service.list_types(cat, q="truck")[0]] == ["Dump truck"]


def test_the_scale_takes_renames_recolours_and_a_new_top_level(cat):
    levels = _scale(cat)
    levels[0]["name"] = "Cosmetic"
    levels.append({"level": 5, "name": "Severe", "colour": "#990000"})
    out = service.put_scale(cat, levels, level_in_use=lambda level: [])
    assert [(lv.level, lv.name) for lv in out] == [
        (1, "Cosmetic"),
        (2, "Moderate"),
        (3, "Major"),
        (4, "Critical"),
        (5, "Severe"),
    ]


def test_removing_the_top_level_is_refused_while_a_project_uses_it(cat):
    e = _refused(
        service.put_scale, cat, _scale(cat)[:3], level_in_use=lambda lv: ["Bridge A"] if lv == 4 else []
    )
    assert (e.code, e.status, e.details) == ("severity_in_use", 409, {"level": 4, "projects": ["Bridge A"]})
    assert len(service.get_scale(cat)) == 4


def test_removing_an_unused_top_level_clears_defaults_that_pointed_at_it(cat):
    t = service.create_type(cat, name="Crack", kind="defect", default_severity=4)
    service.put_scale(cat, _scale(cat)[:3], level_in_use=lambda level: [])
    assert service.get_type(cat, t.id).default_severity is None


@pytest.mark.parametrize("numbers", [[1, 2, 4], [2, 3], [], list(range(1, 11))])
def test_the_scale_runs_1_to_n_without_gaps(cat, numbers):
    levels = [{"level": n, "name": f"L{n}", "colour": "#000000"} for n in numbers]
    e = _refused(service.put_scale, cat, levels, level_in_use=lambda level: [])
    assert (e.code, e.status) == ("invalid_scale", 422)


def test_scale_levels_fall_back_to_the_default_scale(cat):
    assert service.scale_levels(cat) == [1, 2, 3, 4]
    assert service.scale_levels(None) == [1, 2, 3, 4]


def test_meta_round_trips(cat):
    assert service.get_meta(cat, service.NEEDS_CLASSIFICATION) is None
    service.set_meta(cat, service.NEEDS_CLASSIFICATION, {"count": 12})
    assert service.get_meta(cat, service.NEEDS_CLASSIFICATION) == {"count": 12}
