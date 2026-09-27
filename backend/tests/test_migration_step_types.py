"""Step 3 (project_type from class_id_map) and step 4 (class maps into the library), spec §11.4."""

import json

import pytest
from migration_helpers import (
    add_detect_rows,
    add_library_model,
    at_revision,
    catalogue_types,
    env_for,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.migration import steps


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _cls(cid, name, hotkey=None, order=0):
    return {"id": cid, "name": name, "colour": "#06b6d4", "hotkey": hotkey, "order": order}


def _types(handle):
    with handle.session() as s:
        return [
            dict(r)
            for r in s.execute(
                text(
                    "SELECT type_id, position, hotkey_override, name, kind, hotkey FROM project_type"
                    " ORDER BY position"
                )
            ).mappings()
        ]


def _through(handle, stores, *fns):
    env = env_for(stores, handle.folder)
    return [run_step(handle, env, fn) for fn in fns]


def test_types_keep_the_old_order_and_carry_snapshots(tmp_path, stores):
    classes = [_cls("c2", "roller", "2", 1), _cls("c1", "excavator", "1", 0)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    *_, detail = _through(h, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    assert detail == {"types": 2, "hotkey_overrides": 0, "warnings": []}
    assert [(t["type_id"], t["position"], t["name"], t["kind"], t["hotkey"]) for t in _types(h)] == [
        (ids["excavator"], 0, "excavator", "object", "1"),
        (ids["roller"], 1, "roller", "object", "2"),
    ]


def test_a_project_keeps_its_own_hotkey_when_it_clashes_with_nothing(tmp_path, stores):
    first = open_handle(at_revision(tmp_path / "a", "0009", pid="pa", classes=[_cls("a1", "crane", "4")]))
    _through(first, stores, steps.catalogue_merge)
    second = open_handle(
        at_revision(
            tmp_path / "b", "0009", pid="pb", classes=[_cls("b1", "crane", "5"), _cls("b2", "roller", "4", 1)]
        )
    )
    *_, detail = _through(second, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)
    rows = {t["name"]: t for t in _types(second)}
    assert rows["crane"]["hotkey"] == "4" and rows["crane"]["hotkey_override"] == "5"
    assert rows["roller"]["hotkey"] is None and rows["roller"]["hotkey_override"] is None  # "4" is crane's
    assert detail["hotkey_overrides"] == 1 and any("roller" in w for w in detail["warnings"])


def test_duplicate_types_get_one_row_in_the_old_order(tmp_path, stores):
    classes = [_cls("old", "Dump truck"), _cls("x", "excavator", order=1), _cls("new", "dump_truck", order=2)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    _through(h, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)
    assert [t["name"] for t in _types(h)] == ["Dump truck", "excavator"]


def test_existing_project_type_rows_are_kept(tmp_path, stores):
    classes = [_cls("c1", "excavator"), _cls("c2", "crane", order=1)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    _through(h, stores, steps.catalogue_merge)
    crane = catalogue_types(stores)["crane"]["id"]
    with h.session() as s:  # written by BC's create before this unit armed
        s.execute(
            text(
                "INSERT INTO project_type (type_id, position, hotkey_override, name, colour, kind,"
                " default_severity, hotkey, \"group\", refreshed_at) VALUES (:t, 0, '9', 'crane',"
                " '#000000', 'object', NULL, NULL, NULL, '2026-01-01 00:00:00.000000')"
            ),
            {"t": crane},
        )
    *_, detail = _through(h, stores, steps.rewrite_class_ids, steps.project_types)
    rows = {t["name"]: t for t in _types(h)}
    assert detail["types"] == 1
    assert rows["crane"]["hotkey_override"] == "9" and rows["excavator"]["position"] == 1
    assert _through(h, stores, steps.project_types)[0]["types"] == 0  # a rerun adds nothing


def test_a_new_types_catalogue_hotkey_taken_by_an_existing_override_is_dropped(tmp_path, stores):
    """BC-era rule (`project_types.add_types`): a migrated type's own catalogue hotkey can still
    collide with another row's `hotkey_override`, which is a project-only string never checked
    against the catalogue's uniqueness. That row gets `hotkey_override = ""` ("no hotkey in this
    project"), not the clashing key, and a warning."""
    classes = [_cls("c1", "crane"), _cls("c2", "roller", "4", 1)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    _through(h, stores, steps.catalogue_merge)
    crane = catalogue_types(stores)["crane"]["id"]
    with h.session() as s:  # a BC-era row whose override "4" equals roller's own catalogue hotkey
        s.execute(
            text(
                "INSERT INTO project_type (type_id, position, hotkey_override, name, colour, kind,"
                " default_severity, hotkey, \"group\", refreshed_at) VALUES (:t, 0, '4', 'crane',"
                " '#000000', 'object', NULL, NULL, NULL, '2026-01-01 00:00:00.000000')"
            ),
            {"t": crane},
        )
    *_, detail = _through(h, stores, steps.rewrite_class_ids, steps.project_types)
    rows = {t["name"]: t for t in _types(h)}
    assert rows["roller"]["hotkey"] == "4" and rows["roller"]["hotkey_override"] == ""
    assert detail["hotkey_overrides"] == 0 and any("roller" in w for w in detail["warnings"])


def test_the_old_hotkey_is_normalised_before_it_becomes_an_override(tmp_path, stores):
    """An upper-case old key equal to the catalogue's lower-case one is no override; a free upper-case
    key is stored lower case; an invalid key is no override and a warning."""
    classes = [_cls("c1", "crane", "A"), _cls("c2", "roller", "F1", 1), _cls("c3", "grader", None, 2)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    _through(h, stores, steps.catalogue_merge)
    with stores.catalogue.session() as cs:  # grader's catalogue key differs from the project's wish
        cs.execute(text("UPDATE catalogue_type SET hotkey = 'g' WHERE name = 'grader'"))
    with h.session() as s:
        s.execute(
            text("UPDATE project SET classes = :c"),
            {"c": json.dumps([*classes[:2], _cls("c3", "grader", "B", 2)])},
        )
    *_, detail = _through(h, stores, steps.rewrite_class_ids, steps.project_types)
    rows = {t["name"]: t for t in _types(h)}
    assert rows["crane"]["hotkey"] == "a" and rows["crane"]["hotkey_override"] is None
    assert rows["roller"]["hotkey"] is None and rows["roller"]["hotkey_override"] is None
    assert rows["grader"]["hotkey"] == "g" and rows["grader"]["hotkey_override"] == "b"
    assert detail["hotkey_overrides"] == 1
    assert detail["warnings"] == ["hotkey 'F1' of roller is not a valid hotkey; it uses no hotkey"]


def test_old_and_catalogue_hotkey_both_taken_is_one_warning(tmp_path, stores):
    """Roller's old key 5 and its catalogue key 4 are both another row's override: one warning that
    says what happens (no hotkey), not two contradictory ones."""
    first = open_handle(at_revision(tmp_path / "a", "0009", pid="pa", classes=[_cls("a1", "roller", "4")]))
    _through(first, stores, steps.catalogue_merge)
    classes = [_cls("c1", "crane"), _cls("c2", "excavator", order=1), _cls("c3", "roller", "5", 2)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    _through(h, stores, steps.catalogue_merge)
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    with h.session() as s:  # BC-era rows holding 4 and 5 as project-only overrides
        for pos, (name, key) in enumerate((("crane", "4"), ("excavator", "5"))):
            s.execute(
                text(
                    "INSERT INTO project_type (type_id, position, hotkey_override, name, colour, kind,"
                    " default_severity, hotkey, \"group\", refreshed_at) VALUES (:t, :p, :k, :n,"
                    " '#000000', 'object', NULL, NULL, NULL, '2026-01-01 00:00:00.000000')"
                ),
                {"t": ids[name], "p": pos, "k": key, "n": name},
            )
    *_, detail = _through(h, stores, steps.rewrite_class_ids, steps.project_types)
    rows = {t["name"]: t for t in _types(h)}
    assert rows["roller"]["hotkey"] == "4" and rows["roller"]["hotkey_override"] == ""
    assert detail["warnings"] == [
        "hotkey 5 of roller is taken in this project, and so is its catalogue hotkey 4; it uses no hotkey"
    ]


def test_model_class_maps_move_into_the_library_first_mapping_wins(tmp_path, stores):
    add_library_model(stores.library, "lib-m1", {"bird": "t-bird"})
    a = at_revision(tmp_path / "a", "0009", pid="pa")
    add_detect_rows(a)
    ha = open_handle(a)
    *_, detail = _through(
        ha, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.library_class_maps
    )
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    with stores.library.session() as ls:
        merged = json.loads(
            ls.execute(text("SELECT class_map FROM library_model WHERE id = 'lib-m1'")).scalar_one()
        )
    assert merged == {"bird": "t-bird", "excavator": ids["excavator"], "truck": ids["dump_truck"]}
    assert (detail["names_added"], detail["conflicts"]) == (2, 1)  # "bird": None here vs t-bird
    again = _through(ha, stores, steps.library_class_maps)[0]
    assert (again["names_added"], again["conflicts"]) == (0, 1)


def test_a_model_missing_from_the_library_is_reported(tmp_path, stores):
    a = at_revision(tmp_path / "a", "0009")
    add_detect_rows(a)
    h = open_handle(a)
    *_, detail = _through(h, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.library_class_maps)
    assert detail["models"] == 1
    assert any("lib-m1" in w and "not in the library" in w for w in detail["warnings"])
