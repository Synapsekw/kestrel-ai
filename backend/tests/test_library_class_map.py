"""A model's classes mapped onto catalogue types, once, app-wide (foundation F §7.4 and F10; plan BM
Task 3), and segmentation models in the library (spec §12.3)."""

import pytest
from catalogue_fake import catalogue  # noqa: F401 - fixture
from library_helpers import LIB, add_library_model, fake_weights, stub_checkpoint, wait_library_job

from app.detect import class_maps
from app.library import service


def test_a_model_starts_with_an_empty_class_map(client, app, tmp_path):
    m = add_library_model(app, tmp_path)
    body = client.get(f"{LIB}/models/{m.id}").json()
    assert body["class_map"] == {} and body["task"] == "detect"


def test_put_merges_over_the_stored_map(client, app, tmp_path, catalogue):  # noqa: F811
    excavator = catalogue.add("Excavator")
    m = add_library_model(app, tmp_path, class_names=["excavator", "crane"])
    r = client.put(f"{LIB}/models/{m.id}/class-map", json={"mapping": {"excavator": excavator.id}})
    assert r.status_code == 200, r.text
    r = client.put(f"{LIB}/models/{m.id}/class-map", json={"mapping": {"crane": None}})
    assert r.json()["class_map"] == {"excavator": excavator.id, "crane": None}
    assert client.get(f"{LIB}/models/{m.id}").json()["class_map"] == {
        "excavator": excavator.id,
        "crane": None,
    }


@pytest.mark.parametrize(
    ("mapping", "code", "detail"),
    [
        ({"not-a-class": None}, "validation_error", "names"),
        ({"excavator": "no-such-type"}, "unknown_type", "type_ids"),
        ({"excavator": "ARCHIVED"}, "unknown_type", "type_ids"),
    ],
)
def test_put_refuses_foreign_names_and_unusable_types(
    client,
    app,
    tmp_path,
    catalogue,  # noqa: F811
    mapping,
    code,
    detail,
):
    archived = catalogue.add("Digger", archived=True)
    mapping = {k: (archived.id if v == "ARCHIVED" else v) for k, v in mapping.items()}
    m = add_library_model(app, tmp_path, class_names=["excavator"])
    r = client.put(f"{LIB}/models/{m.id}/class-map", json={"mapping": mapping})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == code
    assert detail in r.json()["error"]["details"]
    assert client.get(f"{LIB}/models/{m.id}").json()["class_map"] == {}


def test_put_on_an_unknown_model_is_404(client, catalogue):  # noqa: F811
    r = client.put(f"{LIB}/models/nope/class-map", json={"mapping": {}})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_resolution_prefers_exact_names_then_aliases_then_the_stored_map(client, app, tmp_path, catalogue):  # noqa: F811
    excavator = catalogue.add("Excavator")
    truck = catalogue.add("Dump truck")
    crane = catalogue.add("Crane")
    m = add_library_model(
        app,
        tmp_path,
        class_names=["excavator", "truck", "crane", "car"],
        class_aliases={"truck": "dump_truck"},
    )
    # "crane" matches a catalogue type by name; the stored map cannot override that (spec §7.4).
    class_maps.put_map(app.state.library, catalogue, m.id, {"crane": None})
    mapping, unmapped = class_maps.resolve_for_model(catalogue, service.get_model(app.state.library, m.id))
    assert mapping == {"excavator": excavator.id, "truck": truck.id, "crane": crane.id}
    assert unmapped == ["car"]


def test_a_stored_type_that_was_archived_falls_back_to_the_name(client, app, tmp_path, catalogue):  # noqa: F811
    old = catalogue.add("Digger", archived=True)
    excavator = catalogue.add("Excavator")
    m = add_library_model(app, tmp_path, class_names=["excavator"], class_map={"excavator": old.id})
    assert class_maps.resolve_for_model(catalogue, m) == ({"excavator": excavator.id}, [])


def test_a_segmentation_checkpoint_is_imported_with_its_task(client, tmp_path, monkeypatch):
    stub_checkpoint(monkeypatch, task="segment")
    body = {"name": "seg", "weights_path": str(fake_weights(tmp_path))}
    r = client.post(f"{LIB}/models/import", json=body)
    assert r.status_code == 202, r.text
    done = wait_library_job(client, r.json()["job"]["id"])
    assert done["state"] == "succeeded", done["error"]
    assert client.get(f"{LIB}/models/{done['result']['model_id']}").json()["task"] == "segment"
    listed = client.get(f"{LIB}/models", params={"task": "segment"}).json()["items"]
    assert [m["task"] for m in listed] == ["segment"]
