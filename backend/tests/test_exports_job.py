"""The `results_export` job and its routes (G2, plan Task 4)."""

import os
import threading
import time

import pytest

from app.db.models import Box, Image, Source

OLD_MTIME = 0  # 1970-01-01: always before this (or any) process started


def _age(path) -> None:
    """Backdates `path`'s mtime so the sweep's m1 "not younger than this process" guard never
    itself hides a bug in the other checks a test is aimed at."""
    os.utime(path, (OLD_MTIME, OLD_MTIME))


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
    report = (handle.folder / result["folder"] / "report.html").read_text("utf-8")
    assert "data:image/jpeg;base64," in report  # a real thumbnail, drawn from the real jpeg on disk


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


@pytest.fixture
def stem_collision_images(handle, project_dir, make_jpeg):
    """Two images in one site, same stem, different extensions: x.jpg and x.jpeg (m3, m4)."""
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="siteA")
        s.add(source)
        s.flush()
        class_id = handle.row(s).classes[0]["id"]
        for ext in ("jpg", "jpeg"):
            img = Image(
                path=f"images/siteA/x.{ext}", width=100, height=100, source_id=source.id, group_key="g1"
            )
            s.add(img)
            s.flush()
            make_jpeg(project_dir / "images" / "siteA" / f"x.{ext}", 100, 100)
            s.add(
                Box(
                    image_id=img.id,
                    class_id=class_id,
                    x=1,
                    y=1,
                    w=10,
                    h=10,
                    provenance_kind="person",
                    review_state="accepted",
                )
            )


def test_yolo_stem_collision_fails_before_anything_is_written(
    client, project_id, stem_collision_images, handle, wait_job
):
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv", "yolo"]})
    job_id = r.json()["job"]["id"]
    job = wait_job(project_id, job_id)
    assert job["state"] == "failed", job
    # rows.load orders images by path, and "x.jpeg" sorts before "x.jpg".
    assert job["error"] == (
        "x.jpeg and x.jpg in siteA would get the same YOLO label file. Export without YOLO "
        "labels, or delete one of the two images from the project."
    )
    # m4: the collision is caught before an export folder (even a partial one) is ever created.
    assert not handle.exports_dir.exists()


def test_promote_bumps_the_suffix_when_the_final_name_already_exists(tmp_path):
    """m5: a unit-level test of _promote's collision branch, isolated from the job/API pipeline."""
    from datetime import datetime

    from app.exports.job import _promote, _reserve_partial_folder

    base = tmp_path
    partial, stamp, n = _reserve_partial_folder(base, datetime(2026, 9, 19, 10, 15, 0))
    # Simulate another export having finished into the reserved final name in the meantime.
    (base / stamp).mkdir()

    final = _promote(base, partial, stamp, n)

    assert final == base / f"{stamp}_2"
    assert final.is_dir()
    assert not partial.exists()
    assert list(base.glob(".partial-*")) == []


def test_two_exports_in_the_same_frozen_second_get_stamp_and_stamp_2(
    client, project_id, with_boxes, handle, monkeypatch, wait_job
):
    """N1 regression: the first export's folder must not be handed out again to the second."""
    from datetime import UTC, datetime

    frozen = datetime(2026, 9, 19, 10, 15, 0, tzinfo=UTC).astimezone()
    monkeypatch.setattr("app.exports.job._now_local", lambda: frozen)

    r1 = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv"]})
    job1 = wait_job(project_id, r1.json()["job"]["id"])
    assert job1["state"] == "succeeded", job1

    r2 = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv"]})
    job2 = wait_job(project_id, r2.json()["job"]["id"])
    assert job2["state"] == "succeeded", job2

    stamp = frozen.strftime("%Y-%m-%d_%H%M%S")
    assert job1["result"]["folder"] == f"exports/{stamp}"
    assert job2["result"]["folder"] == f"exports/{stamp}_2"
    names = sorted(p.name for p in handle.exports_dir.iterdir())
    assert names == [stamp, f"{stamp}_2"]  # no leftover .partial-* folder


def test_a_rename_hit_by_permission_error_twice_then_succeeding_still_succeeds(
    client, project_id, with_boxes, wait_job, monkeypatch
):
    real_replace = __import__("os").replace
    calls = {"n": 0}

    def flaky_replace(src, dst):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise PermissionError("Access is denied")
        return real_replace(src, dst)

    monkeypatch.setattr("app.exports.job.os.replace", flaky_replace)
    monkeypatch.setattr("app.exports.job.RENAME_RETRY_DELAY_S", 0.01)
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv"]})
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert calls["n"] == 3


def test_a_rename_that_always_fails_leaves_no_partial_folder_and_the_job_failed(
    client, project_id, with_boxes, handle, wait_job, monkeypatch
):
    def always_fails(src, dst):
        raise PermissionError("Access is denied")

    monkeypatch.setattr("app.exports.job.os.replace", always_fails)
    monkeypatch.setattr("app.exports.job.RENAME_RETRY_DELAY_S", 0.01)
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["csv"]})
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "failed", job
    assert _no_stamp_or_partial_folders_left(handle)


def test_cancellation_inside_the_html_cards_leaves_the_job_cancelled(
    client, project_id, handle, project_dir, make_jpeg, monkeypatch, wait_job
):
    """CARD_PROGRESS_EVERY normally checks every 50 cards; forced to 1 here so 3 images are enough."""
    monkeypatch.setattr("app.exports.job.CARD_PROGRESS_EVERY", 1)
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="siteA")
        s.add(source)
        s.flush()
        class_id = handle.row(s).classes[0]["id"]
        for i in range(3):
            img = Image(path=f"images/{i}.jpg", width=200, height=200, source_id=source.id, group_key="g1")
            s.add(img)
            s.flush()
            make_jpeg(project_dir / "images" / f"{i}.jpg", 200, 200, seed=i)
            s.add(
                Box(
                    image_id=img.id,
                    class_id=class_id,
                    x=1,
                    y=1,
                    w=10,
                    h=10,
                    provenance_kind="person",
                    review_state="accepted",
                )
            )

    started = threading.Event()
    real_draw = __import__("app.exports.html_out", fromlist=["draw_thumbnail"]).draw_thumbnail

    def slow_draw(*a, **k):
        started.set()
        time.sleep(0.5)
        return real_draw(*a, **k)

    monkeypatch.setattr("app.exports.html_out.draw_thumbnail", slow_draw)
    r = client.post(f"{BASE}/{project_id}/exports", json={"formats": ["html"]})
    job_id = r.json()["job"]["id"]
    assert started.wait(2), "the first thumbnail was never drawn"
    client.post(f"{BASE}/{project_id}/jobs/{job_id}/cancel")
    job = wait_job(project_id, job_id)
    assert job["state"] == "cancelled", job
    assert _no_stamp_or_partial_folders_left(handle)


def test_project_opened_sweeps_a_leftover_partial_export_folder(project_id, handle, tmp_path):
    """N2: a crash-left .partial-<stamp> folder is removed the next time the project opens."""
    from app.main import project_opened
    from app.projects.service import ProjectRegistry

    partial = handle.exports_dir / ".partial-2026-09-19_101500"
    partial.mkdir(parents=True)
    (partial / "detections.csv").write_text("x", "utf-8")
    _age(partial)

    class _NoLiveJobs:
        def is_live(self, job_id):
            return False

    registry = ProjectRegistry(tmp_path / "appdata2", on_open=lambda h: project_opened(h, _NoLiveJobs()))
    registry.open(handle.folder, remember=False)

    assert not partial.exists()


def test_sweep_skips_while_a_results_export_job_is_active(handle):
    from app.db.models import Job
    from app.exports.job import sweep_partial_exports

    partial = handle.exports_dir / ".partial-2026-09-19_101500"
    partial.mkdir(parents=True)
    _age(partial)
    with handle.session() as s:
        s.add(Job(type="results_export", state="running"))

    sweep_partial_exports(handle)
    assert partial.exists()


def test_sweep_only_removes_partial_directories_never_a_stray_file(handle):
    from app.exports.job import sweep_partial_exports

    handle.exports_dir.mkdir(parents=True, exist_ok=True)
    stray_file = handle.exports_dir / ".partial-not-a-folder"
    stray_file.write_text("x", "utf-8")
    _age(stray_file)

    sweep_partial_exports(handle)
    assert stray_file.exists()


def test_sweep_does_nothing_with_no_exports_dir(handle):
    from app.exports.job import sweep_partial_exports

    assert not handle.exports_dir.exists()
    sweep_partial_exports(handle)  # must not raise


def test_sweep_leaves_a_users_own_dotfile_folder_alone(handle):
    """I1: only the exact `.partial-<stamp>[_n]` shape this code writes is ever a candidate."""
    from app.exports.job import sweep_partial_exports

    handle.exports_dir.mkdir(parents=True, exist_ok=True)
    notes = handle.exports_dir / ".partial-notes"
    notes.mkdir()
    _age(notes)

    sweep_partial_exports(handle)
    assert notes.is_dir()


def test_sweep_leaves_a_freshly_created_partial_folder_alone(handle):
    """m1: a partial folder younger than this process must never be swept — it could belong to an
    export this very process is still writing."""
    from app.exports.job import sweep_partial_exports

    partial = handle.exports_dir / ".partial-2026-09-19_101500"
    partial.mkdir(parents=True)
    now = time.time()
    os.utime(partial, (now, now))  # explicitly "now", not backdated like the other tests here

    sweep_partial_exports(handle)
    assert partial.exists()


def test_sweep_does_not_follow_a_junction_and_delete_the_real_export(handle, monkeypatch):
    """I1 regression: `is_symlink()` is False for a Windows junction, so a junction named
    `.partial-<stamp>` pointing at a finished export must still never be followed and removed.
    """
    import _winapi

    import app.exports.job as job_module

    monkeypatch.setattr(job_module, "_PROCESS_STARTED_AT", 0)  # isolate this from the m1 mtime guard

    real_export = handle.exports_dir / "2026-09-19_101500"
    real_export.mkdir(parents=True)
    (real_export / "detections.csv").write_text("x", "utf-8")

    link = handle.exports_dir / ".partial-2026-09-19_120000"
    _winapi.CreateJunction(str(real_export), str(link))
    try:
        job_module.sweep_partial_exports(handle)
        assert real_export.is_dir()
        assert (real_export / "detections.csv").read_text("utf-8") == "x"
    finally:
        link.rmdir()
