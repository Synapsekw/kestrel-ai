"""Synchronous pre-annotation when the editor opens an image (spec section 7)."""

import pytest

from app.db.models import Box, Image, Model, Source

BASE = "/api/v1/projects"


class FakeRow:
    def __init__(self, xyxy, cls, conf):
        self.xyxy = [xyxy]
        self.cls = [cls]
        self.conf = [conf]


class FakeResult:
    def __init__(self, rows):
        self.boxes = rows


class FakeYolo:
    def __init__(self, names, rows):
        self.names = names
        self.rows = rows
        self.calls: list[dict] = []

    def predict(self, source, **kwargs):
        self.calls.append(kwargs)
        return [FakeResult(self.rows)]


@pytest.fixture
def fake_yolo(monkeypatch):
    fake = FakeYolo(
        {0: "truck", 1: "excavator"},
        [FakeRow([10, 20, 110, 140], 0.0, 0.9), FakeRow([200, 200, 260, 280], 1.0, 0.7)],
    )
    monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: fake)
    return fake


@pytest.fixture
def image_id(project_id, project_dir, handle, make_jpeg) -> str:
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="test")
        s.add(source)
        s.flush()
        make_jpeg(project_dir / "images" / "f0.jpg", 2000, 1280, seed=1)
        row = Image(path="images/f0.jpg", width=2000, height=1280, source_id=source.id)
        s.add(row)
        s.flush()
        return row.id


@pytest.fixture
def model_id(handle) -> str:
    with handle.session() as s:
        row = Model(
            name="coco",
            kind="imported",
            weights_path="models/coco.pt",
            class_names=["truck", "excavator"],
            class_aliases={"truck": "dump_truck"},
        )
        s.add(row)
        s.flush()
        return row.id


@pytest.fixture
def selected(client, project_id, model_id) -> str:
    r = client.patch(f"{BASE}/{project_id}", json={"preannotation_model_id": model_id})
    assert r.status_code == 200, r.text
    return model_id


def test_the_first_call_writes_proposals_from_the_selected_model(
    client, project_id, image_id, selected, fake_yolo, handle
):
    r = client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json={})
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["skipped"] is False
    assert body["model_id"] == selected
    assert len(body["items"]) == 2
    classes = {c["name"]: c["id"] for c in client.get(f"{BASE}/{project_id}").json()["classes"]}
    assert {i["class_id"] for i in body["items"]} == {classes["dump_truck"], classes["excavator"]}
    for item in body["items"]:
        assert item["provenance"] == {
            "kind": "local_model",
            "model_id": selected,
            "provider": None,
            "model_name": "coco",
            "query_run_id": None,
        }
        assert item["review_state"] == "unreviewed"
    assert {(i["x"], i["y"], i["w"], i["h"]) for i in body["items"]} == {
        (10.0, 20.0, 100.0, 120.0),
        (200.0, 200.0, 60.0, 80.0),
    }


def test_it_runs_untiled_at_the_requested_image_size(client, project_id, image_id, selected, fake_yolo):
    client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json={})
    assert len(fake_yolo.calls) == 1  # one whole-image prediction, no tiling
    assert fake_yolo.calls[0]["imgsz"] == 2560
    assert fake_yolo.calls[0]["conf"] == 0.25


def test_imgsz_and_conf_can_be_overridden(client, project_id, image_id, selected, fake_yolo):
    body = {"imgsz": 1280, "conf": 0.4}
    client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json=body)
    assert fake_yolo.calls[0]["imgsz"] == 1280
    assert fake_yolo.calls[0]["conf"] == 0.4


def test_a_second_call_is_skipped_and_returns_the_same_boxes(
    client, project_id, image_id, selected, fake_yolo
):
    first = client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json={}).json()
    second = client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json={}).json()

    assert second["skipped"] is True
    assert [i["id"] for i in second["items"]] == [i["id"] for i in first["items"]]
    assert len(fake_yolo.calls) == 1  # the model was not asked twice


def test_an_explicit_model_id_overrides_the_project_setting(
    client, project_id, image_id, selected, handle, fake_yolo
):
    with handle.session() as s:
        other = Model(name="other", kind="imported", weights_path="models/o.pt", class_names=["excavator"])
        s.add(other)
        s.flush()
        other_id = other.id

    body = client.post(
        f"{BASE}/{project_id}/images/{image_id}/preannotate", json={"model_id": other_id}
    ).json()
    assert body["model_id"] == other_id
    assert {i["provenance"]["model_name"] for i in body["items"]} == {"other"}


def test_without_a_selected_model_it_is_a_422(client, project_id, image_id, model_id, fake_yolo):
    r = client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json={})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"
    assert "no pre-annotation model selected" in r.json()["error"]["message"]


def test_an_unknown_image_or_model_is_a_404(client, project_id, image_id, selected, fake_yolo):
    assert client.post(f"{BASE}/{project_id}/images/ghost/preannotate", json={}).status_code == 404
    r = client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json={"model_id": "ghost"})
    assert r.status_code == 404


def test_boxes_from_another_model_do_not_count_as_done(
    client, project_id, image_id, selected, handle, fake_yolo
):
    with handle.session() as s:
        s.add(
            Box(
                image_id=image_id,
                class_id="whatever",
                x=1,
                y=1,
                w=2,
                h=2,
                provenance_kind="local_model",
                model_id="a-different-model",
                review_state="unreviewed",
            )
        )
    body = client.post(f"{BASE}/{project_id}/images/{image_id}/preannotate", json={}).json()
    assert body["skipped"] is False
    assert len(body["items"]) == 2
