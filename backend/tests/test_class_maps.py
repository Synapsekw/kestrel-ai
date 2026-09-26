"""Model classes onto catalogue types (foundation F §7.4, plan BM Task 4): the per-project
model-class-map routes are views over the app-wide map on the library model."""

import pytest
from catalogue_fake import create_type
from library_datasets_helpers import make_project
from library_helpers import LIB, add_library_model

BASE = "/api/v1/projects"


@pytest.fixture
def site(app, client, tmp_path):
    return make_project(app, tmp_path / "site", "Site"), client


def test_get_reports_the_app_wide_mapping(client, app, tmp_path, site):
    handle, _ = site
    excavator = create_type(client, "Excavator")
    m = add_library_model(app, tmp_path, class_names=["excavator", "crane"])
    r = client.get(f"{BASE}/{handle.id}/model-class-maps/{m.id}")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "model_id": m.id,
        "model_classes": ["excavator", "crane"],
        "mapping": {"excavator": excavator["id"]},
        "unmapped": ["crane"],
    }


def test_a_put_through_one_project_is_the_mapping_of_every_project(client, app, tmp_path, site):
    handle, _ = site
    other = make_project(app, tmp_path / "other", "Other")
    truck = create_type(client, "Dump truck")
    m = add_library_model(app, tmp_path, class_names=["excavator", "car"])
    body = {"mapping": {"excavator": truck["id"], "car": None}}
    assert client.put(f"{BASE}/{handle.id}/model-class-maps/{m.id}", json=body).status_code == 200
    seen = client.get(f"{BASE}/{other.id}/model-class-maps/{m.id}").json()
    assert seen["mapping"] == {"excavator": truck["id"], "car": None} and seen["unmapped"] == []
    assert client.get(f"{LIB}/models/{m.id}").json()["class_map"] == {"excavator": truck["id"], "car": None}


def test_new_classes_become_catalogue_types(client, app, tmp_path, site):
    handle, _ = site
    m = add_library_model(app, tmp_path, class_names=["crane"])
    body = {"mapping": {}, "new_classes": ["crane"]}
    r = client.put(f"{BASE}/{handle.id}/model-class-maps/{m.id}", json=body)
    assert r.status_code == 200, r.text
    types = client.get("/api/v1/catalogue/types").json()["items"]
    crane = next(t for t in types if t["name"] == "crane")
    assert crane["kind"] == "object"
    assert r.json()["mapping"] == {"crane": crane["id"]} and r.json()["unmapped"] == []


@pytest.mark.parametrize(
    "body",
    [
        {"mapping": {"excavator": "not-a-type"}},
        {"mapping": {"not-a-model-class": None}},
        {"mapping": {}, "new_classes": ["not-a-model-class"]},
    ],
)
def test_put_refuses_unknown_types_and_names(client, app, tmp_path, site, body):
    handle, _ = site
    m = add_library_model(app, tmp_path, class_names=["excavator"])
    r = client.put(f"{BASE}/{handle.id}/model-class-maps/{m.id}", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"


def test_an_unknown_model_is_404_and_no_library_is_503(client, app, site):
    handle, _ = site
    assert client.get(f"{BASE}/{handle.id}/model-class-maps/nope").status_code == 404
    app.state.library = None
    r = client.get(f"{BASE}/{handle.id}/model-class-maps/nope")
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"
