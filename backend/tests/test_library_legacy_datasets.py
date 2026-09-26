"""Per-project datasets registered in the library as read-only legacy datasets (foundation F §6.1
and §11.4 step 5; plan BM Task 8 and decision 6, amendment A12). MG's `legacy_datasets` step calls
`register_legacy_dataset` once per project dataset."""

from library_datasets_helpers import LIB, legacy_project_dataset, make_project
from sqlalchemy import func, select

from app.library.datasets.legacy import register_legacy_dataset
from app.library.db import LibraryDataset


def test_a_materialised_project_dataset_is_registered_once(client, app, tmp_path, make_jpeg):
    handle = make_project(app, tmp_path / "old", "Ahmadia")
    project_dataset = legacy_project_dataset(handle, make_jpeg, name="v1", images=4)
    lib = app.state.library

    first = register_legacy_dataset(lib, handle, project_dataset)
    again = register_legacy_dataset(lib, handle, project_dataset)

    assert first is not None and again == first
    with lib.session() as s:
        assert s.execute(select(func.count()).select_from(LibraryDataset)).scalar_one() == 1
    d = client.get(f"{LIB}/datasets/{first}").json()
    assert d["name"] == "v1 (Ahmadia)" and d["origin"] == "legacy" and d["task"] == "detect"
    assert d["filter"] is None and d["state"] == "ready" and d["export_state"] == "ready"
    assert d["legacy_path"] == str((handle.folder / "datasets" / "v1").resolve())
    assert d["classes"] == [{"type_id": "c1", "name": "excavator"}, {"type_id": "c2", "name": "dump_truck"}]
    assert d["counts"] == {"images": 4, "train": 2, "val": 2, "per_class": {}}
    assert [(s["project_id"], s["project_name"], s["image_count"]) for s in d["sources"]] == [
        (handle.id, "Ahmadia", 4)
    ]
    assert client.get(f"{LIB}/datasets/{first}/items").json()["items"] == []


def test_colliding_names_get_a_number(client, app, tmp_path, make_jpeg):
    lib = app.state.library
    names = []
    for folder in ("one", "two"):
        handle = make_project(app, tmp_path / folder, "Site")
        dataset_id = register_legacy_dataset(lib, handle, legacy_project_dataset(handle, make_jpeg))
        with lib.session() as s:
            names.append(s.get(LibraryDataset, dataset_id).name)
    assert names == ["v1 (Site)", "v1 (Site) 2"]


def test_a_dataset_without_data_yaml_is_not_registered(client, app, tmp_path, make_jpeg):
    handle = make_project(app, tmp_path / "old", "Old")
    project_dataset = legacy_project_dataset(handle, make_jpeg)
    (handle.datasets_dir / "v1" / "data.yaml").unlink()
    assert register_legacy_dataset(app.state.library, handle, project_dataset) is None
    with app.state.library.session() as s:
        assert s.execute(select(func.count()).select_from(LibraryDataset)).scalar_one() == 0


def test_a_legacy_dataset_is_read_only(client, app, tmp_path, make_jpeg):
    handle = make_project(app, tmp_path / "old", "Old")
    dataset_id = register_legacy_dataset(app.state.library, handle, legacy_project_dataset(handle, make_jpeg))
    r = client.post(f"{LIB}/datasets/{dataset_id}/export")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    (handle.datasets_dir / "v1" / "data.yaml").rename(handle.datasets_dir / "v1" / "data.yaml.bak")
    assert client.get(f"{LIB}/datasets/{dataset_id}").json()["export_state"] == "stale"
    assert client.delete(f"{LIB}/datasets/{dataset_id}").status_code == 204
    assert (handle.datasets_dir / "v1" / "images").is_dir()  # the project's folder is never removed
