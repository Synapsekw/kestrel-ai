"""Step 5: materialised project datasets become legacy library datasets, through BM's
`register_legacy_dataset` (spec §6.1, §11.4, §12.1; coordinator hand-off 4)."""

import json
import shutil

import pytest
from migration_helpers import (
    add_dataset,
    add_images_and_boxes,
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


def _legacy(stores):
    with stores.library.session() as ls:
        rows = ls.execute(
            text(
                "SELECT id, name, task, origin, state, export_state, legacy_path, legacy_dataset_id,"
                " classes, counts, filter FROM dataset WHERE origin = 'legacy' ORDER BY name"
            )
        ).mappings()
        return [dict(r) for r in rows]


def _sources(stores):
    with stores.library.session() as ls:
        rows = ls.execute(
            text(
                "SELECT dataset_id, project_id, project_folder, project_name, image_count FROM dataset_source"
            )
        ).mappings()
        return [dict(r) for r in rows]


def _migrate(handle, stores, origin=None):
    env = env_for(stores, origin or handle.folder)
    for fn in (steps.catalogue_merge, steps.rewrite_class_ids):
        run_step(handle, env, fn)
    return run_step(handle, env, steps.legacy_datasets)


def _project(tmp_path, name, pid, project_name="Legacy", materialised=True):
    folder = at_revision(tmp_path / name, "0009", pid=pid, name=project_name)
    add_images_and_boxes(folder)
    add_dataset(folder, materialised=materialised)
    return folder


def test_a_materialised_dataset_is_registered_as_legacy(tmp_path, stores):
    folder = _project(tmp_path, "p", "p1")
    h = open_handle(folder)
    detail = _migrate(h, stores)
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    [row] = _legacy(stores)
    assert detail["registered"] == 1 and detail["names"] == ["v1 (Legacy)"]
    assert (row["name"], row["task"], row["state"], row["export_state"]) == (
        "v1 (Legacy)",
        "detect",
        "ready",
        "ready",
    )
    assert row["legacy_path"] == str((folder / "datasets" / "v1").resolve())
    assert row["legacy_dataset_id"] == "ds-v1"
    assert json.loads(row["filter"]) is None  # a JSON column stores None as the JSON `null` literal
    assert json.loads(row["classes"]) == [
        {"type_id": ids["excavator"], "name": "excavator"},
        {"type_id": ids["dump_truck"], "name": "dump_truck"},
    ]
    assert json.loads(row["counts"]) == {
        "images": 1,
        "per_class": {ids["excavator"]: 1, ids["dump_truck"]: 1},
        "train": 1,
        "val": 0,
    }
    [source] = _sources(stores)
    assert (source["project_id"], source["project_name"], source["image_count"]) == ("p1", "Legacy", 1)
    assert source["project_folder"] == str(folder)


def test_a_dataset_never_built_on_disk_is_reported_not_registered(tmp_path, stores):
    h = open_handle(_project(tmp_path, "p", "p1", materialised=False))
    detail = _migrate(h, stores)
    assert detail["registered"] == 0 and _legacy(stores) == []
    assert any("v1" in w and "never built" in w for w in detail["warnings"])


def test_a_rerun_registers_nothing_twice(tmp_path, stores):
    h = open_handle(_project(tmp_path, "p", "p1"))
    _migrate(h, stores)
    again = run_step(h, env_for(stores, h.folder), steps.legacy_datasets)
    assert (again["registered"], again["already_registered"]) == (0, 1) and len(_legacy(stores)) == 1


def test_two_projects_with_the_same_name_get_distinct_dataset_names(tmp_path, stores):
    _migrate(open_handle(_project(tmp_path, "a", "pa", "Ahmadia")), stores)
    _migrate(open_handle(_project(tmp_path, "b", "pb", "Ahmadia")), stores)
    assert [r["name"] for r in _legacy(stores)] == ["v1 (Ahmadia)", "v1 (Ahmadia) 2"]


def test_a_dry_run_copy_registers_the_original_folder(tmp_path, stores):
    original = _project(tmp_path, "original", "p1")
    copy = tmp_path / "copy"
    copy.mkdir()
    shutil.copy2(original / "project.db", copy / "project.db")  # the database only, as the dry run does
    _migrate(open_handle(copy), stores, origin=original)
    [row] = _legacy(stores)
    assert row["legacy_path"] == str((original / "datasets" / "v1").resolve())
    [source] = _sources(stores)
    assert source["project_folder"] == str(original)


def test_a_crash_after_registering_still_fills_per_class_on_the_rerun(tmp_path, stores):
    """The process died after BM committed the dataset but before the per-class fill: the re-run
    takes the already-registered branch and fills the empty `per_class` there."""
    from app.library.datasets.legacy import register_legacy_dataset

    h = open_handle(_project(tmp_path, "p", "p1"))
    env = env_for(stores, h.folder)
    for fn in (steps.catalogue_merge, steps.rewrite_class_ids):
        run_step(h, env, fn)
    register_legacy_dataset(stores.library, steps._OriginHandle(h, h.folder), "ds-v1")  # then the crash
    assert not json.loads(_legacy(stores)[0]["counts"]).get("per_class")
    again = run_step(h, env, steps.legacy_datasets)
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    assert (again["registered"], again["already_registered"]) == (0, 1)
    [row] = _legacy(stores)
    assert json.loads(row["counts"])["per_class"] == {ids["excavator"]: 1, ids["dump_truck"]: 1}
