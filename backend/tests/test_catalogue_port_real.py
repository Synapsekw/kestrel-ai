"""The models backend on BC's real catalogue (plan BM Task 11): datasets, class maps and runs
resolve real catalogue types, and a catalogue that failed to open is a 503."""

from catalogue_fake import create_type
from library_datasets_helpers import (
    LIB,
    add_box,
    add_image,
    add_source,
    build_dataset,
    create_body,
    make_project,
)
from library_helpers import add_library_model

from app.library.catalogue_port import CatalogueAdapter, catalogue_of


def test_the_app_uses_bcs_catalogue(app, client):
    assert isinstance(catalogue_of(app.state), CatalogueAdapter)


def test_a_dataset_resolves_real_catalogue_types(client, app, tmp_path, make_jpeg):
    excavator = create_type(client, "Excavator")
    handle = make_project(app, tmp_path / "a", "Site A")
    add_box(handle, add_image(handle, make_jpeg, add_source(handle), "a.jpg"), excavator["id"])
    d = build_dataset(client, create_body("machines", [handle.id], [excavator["id"]]))
    assert d["classes"] == [{"type_id": excavator["id"], "name": "Excavator"}]


def test_class_names_match_real_types_by_normalised_name(client, app, tmp_path):
    truck = create_type(client, "Dump truck")
    m = add_library_model(app, tmp_path, class_names=["dump_truck", "crane"])
    handle = make_project(app, tmp_path / "p", "P")
    got = client.get(f"/api/v1/projects/{handle.id}/model-class-maps/{m.id}").json()
    assert got["mapping"] == {"dump_truck": truck["id"]} and got["unmapped"] == ["crane"]
    r = client.put(f"{LIB}/models/{m.id}/class-map", json={"mapping": {"crane": None}})
    assert r.status_code == 200 and r.json()["class_map"] == {"crane": None}


def test_new_classes_through_a_project_create_object_types(client, app, tmp_path):
    m = add_library_model(app, tmp_path, class_names=["tower crane"])
    handle = make_project(app, tmp_path / "p", "P")
    body = {"mapping": {}, "new_classes": ["tower crane"]}
    r = client.put(f"/api/v1/projects/{handle.id}/model-class-maps/{m.id}", json=body)
    assert r.status_code == 200, r.text
    types = client.get("/api/v1/catalogue/types").json()["items"]
    created = next(t for t in types if t["name"] == "tower crane")
    assert created["kind"] == "object" and r.json()["mapping"] == {"tower crane": created["id"]}


def test_a_catalogue_that_did_not_open_is_a_503(client, app, tmp_path):
    handle = make_project(app, tmp_path / "a", "Site A")
    app.state.catalogue = None
    r = client.post(f"{LIB}/datasets", json=create_body("x", [handle.id], ["any"]))
    assert r.status_code == 503 and r.json()["error"]["code"] == "catalogue_unavailable"
