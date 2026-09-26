"""The YOLO export of a dataset built across projects (foundation F §12.2 step 3; plan BM Task 7 and
decisions 4, 12 and 17; Review Focus 1, 2, 4 and 5)."""

import os
from pathlib import Path

import pytest
import yaml
from catalogue_fake import catalogue  # noqa: F401 - fixture
from library_datasets_helpers import LIB, build_dataset, create_body, two_projects
from library_helpers import wait_library_job

from app.db.models import Image, Job
from app.geometry import aabb_of, corners_of
from app.jobs.startup import sweep_orphans
from app.library.db import LibraryDataset


@pytest.fixture
def sites(app, tmp_path, make_jpeg, catalogue):  # noqa: F811
    return two_projects(app, tmp_path, make_jpeg, catalogue)


def _export(client, dataset_id) -> dict:
    r = client.post(f"{LIB}/datasets/{dataset_id}/export")
    assert r.status_code == 202, r.text
    assert r.json()["job"]["type"] == "dataset"
    return wait_library_job(client, r.json()["job"]["id"])


def _labels(folder: Path) -> dict[str, list[list[float]]]:
    out = {}
    for f in folder.glob("labels/*/*.txt"):
        out[f.stem] = [[float(x) for x in line.split()] for line in f.read_text("utf-8").splitlines()]
    return out


def test_export_writes_a_yolo_folder_under_the_library_hard_linking_images(client, app, sites):
    a, b, exc, truck = sites
    d = build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))
    done = _export(client, d["id"])
    assert done["state"] == "succeeded", done["error"]
    assert done["result"]["files"] == {"linked": 4} and done["result"]["skipped"] == 0

    d = client.get(f"{LIB}/datasets/{d['id']}").json()
    assert d["export_state"] == "ready"
    # Stored relative, served absolute (amendment A4).
    folder = app.state.library.datasets_dir / f"machines-{d['id'][:8]}"
    assert d["export_path"] == str(folder)
    names = sorted(p.name for p in folder.glob("images/*/*.jpg"))
    # the same relative path in two projects stays two files (Review Focus 4)
    assert names == sorted(f"{p.id[:8]}__site__DJI_000{i}.jpg" for p in (a, b) for i in (1, 2))
    data = yaml.safe_load((folder / "data.yaml").read_text("utf-8"))
    assert data["names"] == {0: "Excavator", 1: "Dump truck"} and Path(data["path"]) == folder
    rotated = _labels(folder)[f"{b.id[:8]}__site__DJI_0002"][0]
    x, y, w, h = aabb_of(50, 20, 60, 30, 30.0)  # detect writes the envelope of a rotated box
    assert rotated[0] == 1
    assert rotated[1:] == pytest.approx([(x + w / 2) / 200, (y + h / 2) / 100, w / 200, h / 100], abs=1e-5)


def test_the_export_copies_when_a_hard_link_is_impossible(client, sites, monkeypatch):
    a, b, exc, truck = sites
    d = build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))

    def no_links(src, dst):
        raise OSError(18, "Invalid cross-device link")

    monkeypatch.setattr(os, "link", no_links)
    done = _export(client, d["id"])
    assert done["state"] == "succeeded", done["error"]
    assert done["result"]["files"] == {"copied": 4}


def test_an_obb_dataset_writes_the_rotated_corners(client, app, sites):
    a, b, exc, truck = sites
    d = build_dataset(client, create_body("oriented", [b.id], [truck.id], task="obb"))
    assert _export(client, d["id"])["state"] == "succeeded"
    folder = Path(client.get(f"{LIB}/datasets/{d['id']}").json()["export_path"])
    line = _labels(folder)[f"{b.id[:8]}__site__DJI_0002"][0]
    assert line[0] == 0 and len(line) == 9
    expected = [v for px, py in corners_of(50, 20, 60, 30, 30.0) for v in (px / 200, py / 100)]
    assert line[1:] == pytest.approx([min(max(v, 0.0), 1.0) for v in expected], abs=1e-5)


def test_a_segment_dataset_is_built_but_its_export_is_refused(client, sites):
    a, _, exc, _ = sites
    d = build_dataset(client, create_body("masks", [a.id], [exc.id], task="segment"))
    r = client.post(f"{LIB}/datasets/{d['id']}/export")
    assert r.status_code == 422 and r.json()["error"]["code"] == "task_not_supported"
    assert client.get(f"{LIB}/jobs", params={"type": "dataset"}).json()["items"] == []


def test_an_export_is_refused_when_not_ready_already_building_or_legacy(client, app, sites):
    """409 `not_ready`, 409 `job_running` and 409 `conflict`, and no job queued (amendment A3)."""
    a, _, exc, _ = sites
    lib = app.state.library
    d = build_dataset(client, create_body("machines", [a.id], [exc.id]))
    from app.library.datasets import service

    with lib.session() as s:
        s.get(LibraryDataset, d["id"]).state = "failed"
    r = client.post(f"{LIB}/datasets/{d['id']}/export")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready", r.text

    with lib.session() as s:
        s.get(LibraryDataset, d["id"]).state = "ready"
        job = Job(type="dataset", state="running", params={"dataset_id": d["id"]}, log_path="")
        s.add(job)
        s.flush()
        job_id = job.id
    service.mark_export_queued(lib, d["id"], job_id)
    r = client.post(f"{LIB}/datasets/{d['id']}/export")
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running", r.text

    with lib.session() as s:
        row = s.get(LibraryDataset, d["id"])
        row.origin, row.export_state, row.export_job_id = "legacy", "none", None
    r = client.post(f"{LIB}/datasets/{d['id']}/export")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict", r.text
    assert [j["id"] for j in client.get(f"{LIB}/jobs", params={"type": "dataset"}).json()["items"]] == [
        job_id
    ]


def test_an_unknown_dataset_export_is_404(client):
    r = client.post(f"{LIB}/datasets/nope/export")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_a_missing_project_fails_the_export_and_keeps_the_dataset(client, app, sites):
    a, b, exc, truck = sites
    d = build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))
    app.state.projects.forget(b.id)
    os.replace(b.folder, b.folder.with_name("b-moved"))
    done = _export(client, d["id"])
    assert done["state"] == "failed" and "Site B" in done["error"]
    after = client.get(f"{LIB}/datasets/{d['id']}").json()
    assert after["state"] == "ready" and after["export_state"] == "failed"
    assert list(app.state.library.datasets_dir.iterdir()) == []  # no partial folder left behind


def test_an_image_deleted_after_the_build_is_skipped_not_fatal(client, app, sites):
    a, b, exc, truck = sites
    d = build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))
    with a.session() as s:
        image = s.query(Image).filter(Image.path == "images/site/DJI_0001.jpg").one()
        path = a.folder / image.path
        s.delete(image)
    path.unlink()
    done = _export(client, d["id"])
    assert done["state"] == "succeeded", done["error"]
    assert done["result"]["skipped"] == 1 and done["result"]["files"] == {"linked": 3}


def test_a_restart_during_the_export_shows_failed(client, app, sites):
    a, _, exc, _ = sites
    lib = app.state.library
    d = build_dataset(client, create_body("machines", [a.id], [exc.id]))
    from app.library.datasets import service

    with lib.session() as s:
        job = Job(type="dataset", state="running", params={"dataset_id": d["id"]}, log_path="")
        s.add(job)
        s.flush()
        job_id = job.id
    service.mark_export_queued(lib, d["id"], job_id)
    assert client.get(f"{LIB}/datasets/{d['id']}").json()["export_state"] == "building"
    sweep_orphans(lib, app.state.jobs)
    assert client.get(f"{LIB}/datasets/{d['id']}").json()["export_state"] == "failed"


def test_a_missing_data_yaml_reads_stale_and_a_new_export_rebuilds_it(client, app, sites):
    a, _, exc, _ = sites
    d = build_dataset(client, create_body("machines", [a.id], [exc.id]))
    assert _export(client, d["id"])["state"] == "succeeded"
    folder = Path(client.get(f"{LIB}/datasets/{d['id']}").json()["export_path"])
    (folder / "data.yaml").unlink()
    assert client.get(f"{LIB}/datasets/{d['id']}").json()["export_state"] == "stale"
    assert _export(client, d["id"])["state"] == "succeeded"
    assert client.get(f"{LIB}/datasets/{d['id']}").json()["export_state"] == "ready"
    assert (folder / "data.yaml").is_file()


def test_the_folder_name_is_safe_for_any_dataset_name(client, app, sites):
    a, _, exc, _ = sites
    d = build_dataset(client, create_body("Site: A/B", [a.id], [exc.id]))
    assert _export(client, d["id"])["state"] == "succeeded"
    d = client.get(f"{LIB}/datasets/{d['id']}").json()
    assert d["export_path"] == str(app.state.library.datasets_dir / f"site-a-b-{d['id'][:8]}")
    assert (Path(d["export_path"]) / "data.yaml").is_file()


def test_deleting_an_exported_dataset_removes_its_folder_and_no_project_image(client, app, sites):
    a, _, exc, _ = sites
    d = build_dataset(client, create_body("machines", [a.id], [exc.id]))
    assert _export(client, d["id"])["state"] == "succeeded"
    folder = Path(client.get(f"{LIB}/datasets/{d['id']}").json()["export_path"])
    assert (folder / "data.yaml").is_file()
    assert client.delete(f"{LIB}/datasets/{d['id']}").status_code == 204
    assert not folder.exists()
    assert list(app.state.library.datasets_dir.iterdir()) == []
    assert len(list((a.folder / "images" / "site").glob("*.jpg"))) == 2


def test_the_per_project_dataset_routes_are_gone(client, sites):
    a, _, _, _ = sites
    assert client.get(f"/api/v1/projects/{a.id}/datasets").status_code in (404, 405)
    assert client.post(f"/api/v1/projects/{a.id}/datasets", json={"name": "v1"}).status_code in (404, 405)
