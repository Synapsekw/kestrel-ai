import pytest
from PIL import Image as PILImage

from app.db.models import Box


def _stats(client, pid, source_id=None):
    base = f"/api/v1/projects/{pid}"
    r = client.get(f"{base}/stats" if source_id is None else f"{base}/sources/{source_id}/stats")
    assert r.status_code == 200, r.text
    return r.json()


def test_empty_project_reports_zeros(client, project):
    s = _stats(client, project["id"])
    assert s["image_count"] == 0 and s["labeled_count"] == 0 and s["unlabeled_count"] == 0
    assert s["box_count"] == 0 and s["pending_review_count"] == 0 and s["duplicate_count"] == 0
    assert s["sources"] == [] and s["groups"] == [] and s["resolution_histogram"] == []
    assert s["capture_time_range"] is None and s["gps_bounds"] is None
    assert [c["count"] for c in s["boxes_per_class"]] == [0] * 8  # every class is listed


def test_stats_after_importing_the_sample(client, project, import_source, ahmadia_sample):
    pid = project["id"]
    source_id = import_source(pid, ahmadia_sample, site="ahmadia")
    s = _stats(client, pid)
    assert s["image_count"] == 20 and s["unlabeled_count"] == 20 and s["labeled_count"] == 0
    assert s["sources"] == [{"source_id": source_id, "site": "ahmadia", "image_count": 20}]
    assert s["groups"] == [{"group_key": "0031", "image_count": 20}]
    assert s["resolution_histogram"] == [{"width": 4000, "height": 2667, "count": 20}]
    assert s["capture_time_range"]["min"].startswith("2019-04-15T06:35:36")
    assert s["capture_time_range"]["max"] > s["capture_time_range"]["min"]
    bounds = s["gps_bounds"]
    assert 29.49 < bounds["min_lat"] <= bounds["max_lat"] < 29.50
    assert 47.76 < bounds["min_lon"] <= bounds["max_lon"] < 47.77


@pytest.fixture
def two_sources(client, project, import_source, tmp_path, make_jpeg):
    pid = project["id"]
    for name, seeds in (("a", (1, 2)), ("b", (3,))):
        for i in seeds:
            make_jpeg(tmp_path / name / f"{name.upper()}_000{i}_0001.jpg", 120, 90, seed=i)
    first = import_source(pid, tmp_path / "a")
    second = import_source(pid, tmp_path / "b")
    return {"pid": pid, "first": first, "second": second, "classes": project["classes"]}


def _proposal(client, pid, image_id, class_id, review_state="unreviewed"):
    """A model proposal, inserted straight through the model (S4 owns the API for these)."""
    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        s.add(
            Box(
                image_id=image_id,
                class_id=class_id,
                x=1,
                y=1,
                w=10,
                h=10,
                confidence=0.6,
                provenance_kind="local_model",
                review_state=review_state,
            )
        )


def test_box_counts_and_classes(client, two_sources):
    pid = two_sources["pid"]
    classes = two_sources["classes"]
    images = client.get(f"/api/v1/projects/{pid}/images").json()["items"]
    for class_id in (classes[0]["id"], classes[3]["id"]):
        client.post(
            f"/api/v1/projects/{pid}/images/{images[0]['id']}/boxes",
            json={"class_id": class_id, "x": 1, "y": 1, "w": 10, "h": 10},
        )
    _proposal(client, pid, images[1]["id"], classes[0]["id"], review_state="rejected")
    _proposal(client, pid, images[2]["id"], classes[0]["id"])

    s = _stats(client, pid)
    assert s["image_count"] == 3 and s["labeled_count"] == 1 and s["unlabeled_count"] == 2
    assert s["box_count"] == 2  # the rejected proposal is not ground truth
    assert s["pending_review_count"] == 1
    per_class = {c["class_name"]: c["count"] for c in s["boxes_per_class"]}
    assert per_class["excavator"] == 1 and per_class["dump_truck"] == 1 and per_class["crane"] == 0
    assert len(s["sources"]) == 2 and len(s["groups"]) == 3


def test_source_stats_only_count_their_own_images(client, two_sources):
    pid = two_sources["pid"]
    first = _stats(client, pid, two_sources["first"])
    assert first["image_count"] == 2 and len(first["sources"]) == 1
    assert first["sources"][0]["source_id"] == two_sources["first"]
    assert {g["group_key"] for g in first["groups"]} == {"0001", "0002"}
    second = _stats(client, pid, two_sources["second"])
    assert second["image_count"] == 1 and {g["group_key"] for g in second["groups"]} == {"0003"}
    assert second["capture_time_range"] is None and second["gps_bounds"] is None


def test_duplicate_count_comes_from_the_import(client, project, import_source, tmp_path):
    pid = project["id"]
    folder = tmp_path / "dup"
    folder.mkdir()
    gradient = PILImage.linear_gradient("L").convert("RGB").resize((200, 150))
    gradient.save(folder / "D_0001_0001.jpg", quality=95)
    PILImage.open(folder / "D_0001_0001.jpg").save(folder / "D_0001_0002.jpg", "JPEG", quality=70)
    source_id = import_source(pid, folder)
    assert _stats(client, pid)["duplicate_count"] == 1
    assert _stats(client, pid, source_id)["duplicate_count"] == 1
