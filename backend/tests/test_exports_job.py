"""The `results_export` job and its routes (G2, plan Task 4)."""

import threading
import time

import pytest

from app.db.models import Box, Image, Source

BASE = "/api/v1/projects"
CLASSES = ["excavator", "dump_truck"]


@pytest.fixture
def project_id(client, project_dir) -> str:
    body = {
        "name": "T",
        "folder": str(project_dir),
        "classes": [{"name": n, "colour": c} for n, c in zip(CLASSES, ["#ff0000", "#00ff00"], strict=True)],
    }
    r = client.post("/api/v1/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def handle(app, project_id):
    return app.state.projects.get(project_id)


@pytest.fixture
def with_boxes(handle, project_dir, make_jpeg):
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="siteA")
        s.add(source)
        s.flush()
        img = Image(path="images/a.jpg", width=2000, height=1000, source_id=source.id, group_key="g1")
        s.add(img)
        s.flush()
        make_jpeg(project_dir / "images" / "a.jpg", 2000, 1000, seed=1)
        class_id = handle.row(s).classes[0]["id"]
        s.add(
            Box(
                image_id=img.id,
                class_id=class_id,
                x=10,
                y=10,
                w=100,
                h=100,
                provenance_kind="person",
                review_state="accepted",
            )
        )
    return img.id


def test_full_export_succeeds_with_every_format(client, project_id, with_boxes, handle, wait_job):
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv", "yolo", "coco", "html"]})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    result = job["result"]
    assert result["folder"].startswith("exports/")
    assert result["image_count"] == 1
    assert result["box_count"] == 1
    assert set(result["files"]) == {
        "detections.csv",
        "counts_by_group.csv",
        "counts_by_image.csv",
        "labels_yolo",
        "labels_yolo/classes.txt",
        "labels_coco.json",
        "report.html",
    }
    for name in result["files"]:
        assert (handle.folder / result["folder"] / name).exists(), name
    assert (handle.folder / result["folder"] / "labels_yolo" / "a.txt").is_file()


def test_empty_formats_is_422(client, project_id):
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": []})
    assert r.status_code == 422, r.text


def test_duplicate_formats_is_422(client, project_id):
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv", "csv"]})
    assert r.status_code == 422, r.text


def test_a_project_without_any_box_still_succeeds_with_zero_row_tables(
    client, project_id, handle, project_dir, make_jpeg, wait_job
):
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="siteA")
        s.add(source)
        s.flush()
        s.add(Image(path="images/only.jpg", width=100, height=100, source_id=source.id, group_key="g1"))
    make_jpeg(project_dir / "images" / "only.jpg", 100, 100)
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv"]})
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"]["image_count"] == 1
    assert job["result"]["box_count"] == 0
    text = (handle.folder / job["result"]["folder"] / "counts_by_image.csv").read_text("utf-8-sig")
    assert "images/only.jpg" in text


def test_cancellation_between_formats_leaves_the_job_cancelled(
    client, project_id, with_boxes, monkeypatch, wait_job
):
    started = threading.Event()
    real_write = __import__("app.exports.csv_out", fromlist=["write"]).write

    def slow_write(images, classes, folder):
        started.set()
        time.sleep(0.5)
        return real_write(images, classes, folder)

    monkeypatch.setattr("app.exports.job.csv_out.write", slow_write)
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv", "yolo"]})
    job_id = r.json()["job"]["id"]
    assert started.wait(2), "the csv writer never started"
    client.post(f"{BASE}/{project_id}/jobs/{job_id}/cancel")
    job = wait_job(project_id, job_id)
    assert job["state"] == "cancelled", job


def _no_stamp_or_partial_folders_left(handle) -> bool:
    exports_dir = handle.exports_dir
    if not exports_dir.is_dir():
        return True
    return list(exports_dir.iterdir()) == []


def test_a_cancelled_export_leaves_no_partial_and_no_final_folder(
    client, project_id, with_boxes, handle, monkeypatch, wait_job
):
    started = threading.Event()
    real_write = __import__("app.exports.csv_out", fromlist=["write"]).write

    def slow_write(images, classes, folder):
        started.set()
        time.sleep(0.5)
        return real_write(images, classes, folder)

    monkeypatch.setattr("app.exports.job.csv_out.write", slow_write)
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv", "yolo"]})
    job_id = r.json()["job"]["id"]
    assert started.wait(2), "the csv writer never started"
    client.post(f"{BASE}/{project_id}/jobs/{job_id}/cancel")
    job = wait_job(project_id, job_id)
    assert job["state"] == "cancelled", job
    assert _no_stamp_or_partial_folders_left(handle)


def test_a_failed_export_leaves_no_partial_folder(
    client, project_id, with_boxes, handle, monkeypatch, wait_job
):
    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.exports.job.html_out.write", boom)
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv", "html"]})
    job_id = r.json()["job"]["id"]
    job = wait_job(project_id, job_id)
    assert job["state"] == "failed", job
    assert _no_stamp_or_partial_folders_left(handle)
