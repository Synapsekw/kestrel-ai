"""Mapping a library model's classes onto a detection project's classes (spec 2026-09-23 section 7.3,
plan 2 unit R): the remembered mapping, exact names, aliases, seeding an empty project, and the
`GET/PUT /model-class-maps/{modelId}` routes."""

import pytest
from library_helpers import add_library_model

from app.db.models import ModelClassMap
from app.detect import class_maps

BASE = "/api/v1/projects"


def _project(client, tmp_path, classes, kind="detect", name="Site") -> dict:
    body = {"name": name, "folder": str(tmp_path / name), "classes": classes, "kind": kind}
    r = client.post(BASE, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def site(client, tmp_path) -> dict:
    return _project(
        client,
        tmp_path,
        [{"name": "excavator", "colour": "#ff0000"}, {"name": "dump_truck", "colour": "#00ff00"}],
    )


def _ids(project: dict) -> dict[str, str]:
    return {c["name"]: c["id"] for c in project["classes"]}


def test_exact_names_then_aliases_map_and_the_rest_is_unmapped(app, tmp_path, site):
    handle = app.state.projects.get(site["id"])
    m = add_library_model(
        app, tmp_path, class_names=["excavator", "truck", "crane"], class_aliases={"truck": "dump_truck"}
    )
    mapping, unmapped = class_maps.resolve(handle, m)
    ids = _ids(site)
    assert mapping == {"excavator": ids["excavator"], "truck": ids["dump_truck"]}
    assert unmapped == ["crane"]


def test_the_remembered_mapping_wins_and_an_ignored_class_counts_as_mapped(app, tmp_path, site):
    handle = app.state.projects.get(site["id"])
    ids = _ids(site)
    m = add_library_model(app, tmp_path, class_names=["excavator", "crane"])
    with handle.session() as s:
        s.add(ModelClassMap(library_model_id=m.id, mapping={"excavator": ids["dump_truck"], "crane": None}))
    mapping, unmapped = class_maps.resolve(handle, m)
    assert mapping == {"excavator": ids["dump_truck"], "crane": None}
    assert unmapped == []


def test_a_remembered_id_of_a_deleted_class_falls_back_to_the_name(app, tmp_path, site):
    handle = app.state.projects.get(site["id"])
    m = add_library_model(app, tmp_path, class_names=["excavator", "crane"])
    with handle.session() as s:
        s.add(ModelClassMap(library_model_id=m.id, mapping={"excavator": "gone", "crane": "gone"}))
    mapping, unmapped = class_maps.resolve(handle, m)
    assert mapping == {"excavator": _ids(site)["excavator"]}
    assert unmapped == ["crane"]


def test_an_empty_project_is_seeded_from_the_model(client, app, tmp_path):
    empty = _project(client, tmp_path, [], name="Empty")
    handle = app.state.projects.get(empty["id"])
    m = add_library_model(app, tmp_path, class_names=["car", "truck"])

    mapping, unmapped = class_maps.resolve(handle, m, seed=True)

    classes = client.get(f"{BASE}/{empty['id']}").json()["classes"]
    assert [c["name"] for c in classes] == ["car", "truck"]
    assert all(c["colour"].startswith("#") for c in classes)
    assert mapping == {c["name"]: c["id"] for c in classes}
    assert unmapped == []


def test_without_seed_an_empty_project_reports_everything_unmapped(client, app, tmp_path):
    empty = _project(client, tmp_path, [], name="Empty")
    handle = app.state.projects.get(empty["id"])
    m = add_library_model(app, tmp_path, class_names=["car", "truck"])
    assert class_maps.resolve(handle, m) == ({}, ["car", "truck"])
    assert client.get(f"{BASE}/{empty['id']}").json()["classes"] == []


# ------------------------------------------------------------------------ routes


def test_get_reports_mapping_and_unmapped(client, app, tmp_path, site):
    m = add_library_model(app, tmp_path, class_names=["excavator", "crane"])
    r = client.get(f"{BASE}/{site['id']}/model-class-maps/{m.id}")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "model_id": m.id,
        "model_classes": ["excavator", "crane"],
        "mapping": {"excavator": _ids(site)["excavator"]},
        "unmapped": ["crane"],
    }


def test_put_stores_the_mapping_and_adds_new_classes(client, app, tmp_path, site):
    m = add_library_model(app, tmp_path, class_names=["excavator", "crane", "car"])
    ids = _ids(site)
    body = {"mapping": {"excavator": ids["dump_truck"], "car": None}, "new_classes": ["crane"]}
    r = client.put(f"{BASE}/{site['id']}/model-class-maps/{m.id}", json=body)
    assert r.status_code == 200, r.text
    classes = client.get(f"{BASE}/{site['id']}").json()["classes"]
    crane = next(c for c in classes if c["name"] == "crane")
    assert r.json()["mapping"] == {"excavator": ids["dump_truck"], "car": None, "crane": crane["id"]}
    assert r.json()["unmapped"] == []
    # remembered: a second read says the same
    assert client.get(f"{BASE}/{site['id']}/model-class-maps/{m.id}").json() == r.json()


def test_put_of_an_existing_name_reuses_that_class(client, app, tmp_path, site):
    m = add_library_model(app, tmp_path, class_names=["excavator"])
    body = {"mapping": {}, "new_classes": ["excavator"]}
    r = client.put(f"{BASE}/{site['id']}/model-class-maps/{m.id}", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["mapping"] == {"excavator": _ids(site)["excavator"]}
    assert len(client.get(f"{BASE}/{site['id']}").json()["classes"]) == 2


@pytest.mark.parametrize(
    "body",
    [
        {"mapping": {"excavator": "not-a-class"}},
        {"mapping": {"not-a-model-class": None}},
        {"mapping": {}, "new_classes": ["not-a-model-class"]},
    ],
)
def test_put_refuses_unknown_ids_and_names(client, app, tmp_path, site, body):
    m = add_library_model(app, tmp_path, class_names=["excavator"])
    r = client.put(f"{BASE}/{site['id']}/model-class-maps/{m.id}", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"


def test_an_unknown_model_is_404_and_no_library_is_503(client, app, site):
    assert client.get(f"{BASE}/{site['id']}/model-class-maps/nope").status_code == 404
    app.state.library = None
    r = client.get(f"{BASE}/{site['id']}/model-class-maps/nope")
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"


def test_a_training_project_is_refused(client, app, tmp_path):
    train = _project(client, tmp_path, [], kind="train", name="Train")
    m = add_library_model(app, tmp_path)
    r = client.get(f"{BASE}/{train['id']}/model-class-maps/{m.id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"
