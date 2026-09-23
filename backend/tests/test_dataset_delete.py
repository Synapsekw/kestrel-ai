"""Deleting a dataset (S2): the folder and rows go, images/labels/models stay."""

from pathlib import Path

import pytest

from app.db.models import Job

BASE = "/api/v1/projects"
FLIGHTS = {"0031": 6, "0033": 3}
WIDTH, HEIGHT = 400, 300


@pytest.fixture
def labeled_dataset(client, project, import_source, tmp_path, make_jpeg, wait_job):
    """A dataset frozen from nine labelled frames in two flights (mirrors test_datasets.labelled_project)."""
    pid = project["id"]
    folder = tmp_path / "frames"
    seed = 0
    for flight, count in FLIGHTS.items():
        for i in range(1, count + 1):
            seed += 1
            make_jpeg(folder / f"IX-12-02491_{flight}_{i:04d}.jpg", WIDTH, HEIGHT, seed=seed)
    import_source(pid, folder)
    classes = [c["id"] for c in project["classes"]]
    images = client.get(f"{BASE}/{pid}/images", params={"limit": 100}).json()["items"]
    for image in images:
        r = client.post(
            f"{BASE}/{pid}/images/{image['id']}/boxes",
            json={"class_id": classes[0], "x": 100, "y": 60, "w": 40, "h": 60},
        )
        assert r.status_code == 201, r.text
    created = client.post(f"{BASE}/{pid}/datasets", json={"name": "v1"}).json()
    finished = wait_job(pid, created["job"]["id"])
    assert finished["state"] == "succeeded", finished
    return client.get(f"{BASE}/{pid}/datasets/{created['dataset']['id']}").json()


def test_delete_removes_the_folder_and_the_rows_and_keeps_the_images(
    client, project_id, handle, labeled_dataset
):
    ds = labeled_dataset
    folder = handle.folder / ds["path"]
    assert folder.is_dir()
    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    assert r.status_code == 204, r.text
    assert not folder.exists()
    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 404
    assert client.get(f"{BASE}/{project_id}/datasets").json()["items"] == []
    assert client.get(f"{BASE}/{project_id}/images").json()["total"] > 0
    # the name is free again
    assert client.post(f"{BASE}/{project_id}/datasets", json={"name": ds["name"]}).status_code == 202


def test_delete_is_refused_while_a_training_job_uses_the_dataset(client, project_id, handle, labeled_dataset):
    with handle.session() as s:
        s.add(
            Job(
                type="train",
                state="running",
                params={"dataset_id": labeled_dataset["id"]},
            )
        )
    r = client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    # the folder is untouched
    assert (handle.folder / labeled_dataset["path"]).is_dir()


def test_a_model_trained_on_a_deleted_dataset_stays_in_the_library(
    client, app, tmp_path, project_id, labeled_dataset
):
    """Library models keep a provenance snapshot, never a link: deleting the dataset changes nothing."""
    from library_helpers import add_library_model

    m = add_library_model(
        app,
        tmp_path,
        origin="trained",
        provenance={"dataset_id": labeled_dataset["id"], "dataset_name": labeled_dataset["name"]},
    )
    r = client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}")
    assert r.status_code == 204, r.text
    got = client.get(f"/api/v1/library/models/{m.id}").json()
    assert got["state"] == "ready"
    assert got["provenance"]["dataset_id"] == labeled_dataset["id"]


def test_delete_unknown_is_404(client, project_id):
    assert client.delete(f"{BASE}/{project_id}/datasets/nope").status_code == 404


# ------------------------------------------------------------------ folder safety
# Deleting removes a folder on the operator's disk. Whatever the row says, nothing outside
# `<project>/datasets/<something>` may ever be removed, and a refusal must change nothing.


def _set_path(handle, dataset_id, path):
    from app.db.models import Dataset

    with handle.session() as s:
        s.get(Dataset, dataset_id).path = path


@pytest.mark.parametrize("bad_path", ["datasets", "datasets/", ".", "", "datasets/../images", "../outside"])
def test_a_row_that_points_anywhere_else_is_refused_and_nothing_changes(
    client, project_id, handle, labeled_dataset, bad_path
):
    ds = labeled_dataset
    real_folder = handle.folder / ds["path"]
    outside = handle.folder.parent / "outside"
    outside.mkdir(exist_ok=True)
    (outside / "keep.txt").write_text("keep")
    _set_path(handle, ds["id"], bad_path)

    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "conflict"
    assert real_folder.is_dir() and any(real_folder.rglob("*.jpg"))  # every dataset is still there
    assert handle.datasets_dir.is_dir() and handle.images_dir.is_dir()
    assert (outside / "keep.txt").read_text() == "keep"
    # The refusal happened before anything was deleted: the row is still listed.
    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 200


def test_a_dataset_folder_that_is_a_junction_to_elsewhere_is_refused(
    client, project_id, handle, labeled_dataset
):
    import _winapi

    ds = labeled_dataset
    target = handle.folder.parent / "elsewhere"
    target.mkdir()
    (target / "keep.txt").write_text("keep")
    link = handle.datasets_dir / "linked"
    _winapi.CreateJunction(str(target), str(link))
    try:
        _set_path(handle, ds["id"], "datasets/linked")
        r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
        assert r.status_code == 409, r.text
        assert (target / "keep.txt").read_text() == "keep"
        assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 200
    finally:
        link.rmdir()  # removes the link, never the target


def test_a_junction_inside_the_dataset_folder_is_unlinked_not_followed(
    client, project_id, handle, labeled_dataset
):
    import _winapi

    ds = labeled_dataset
    target = handle.folder.parent / "elsewhere"
    target.mkdir()
    (target / "keep.txt").write_text("keep")
    _winapi.CreateJunction(str(target), str(handle.folder / ds["path"] / "stray-link"))

    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")

    assert r.status_code == 204, r.text
    assert not (handle.folder / ds["path"]).exists()
    assert (target / "keep.txt").read_text() == "keep"


def test_the_images_a_dataset_hard_links_survive_its_deletion(client, project_id, handle, labeled_dataset):
    ds = labeled_dataset
    originals = sorted(handle.images_dir.rglob("*.jpg"))
    sizes = [p.stat().st_size for p in originals]
    assert client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 204
    assert [p.stat().st_size for p in sorted(handle.images_dir.rglob("*.jpg"))] == sizes
    assert all(p.read_bytes()[:2] == b"\xff\xd8" for p in originals)  # still JPEGs, not truncated


def test_an_absolute_path_in_the_row_is_refused(client, project_id, handle, labeled_dataset, tmp_path):
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.txt").write_text("keep")
    _set_path(handle, labeled_dataset["id"], str(victim))
    r = client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}")
    assert r.status_code == 409, r.text
    assert (victim / "keep.txt").read_text() == "keep"


def test_a_row_that_aliases_another_datasets_folder_is_refused(client, project_id, handle, labeled_dataset):
    """`datasets/V1` is the folder of `v1` on Windows: deleting the alias must not take v1's files."""
    from app.db.models import Dataset

    with handle.session() as s:
        s.add(
            Dataset(
                name="V1-alias",
                classes=[],
                split_method="random",
                split_params={"val_fraction": 0.2, "seed": 1},
                path="datasets/V1",
            )
        )
        s.flush()
        alias_id = s.execute(
            __import__("sqlalchemy").select(Dataset.id).where(Dataset.name == "V1-alias")
        ).scalar_one()
    r = client.delete(f"{BASE}/{project_id}/datasets/{alias_id}")
    assert r.status_code == 409, r.text
    assert any((handle.folder / labeled_dataset["path"]).rglob("*.jpg"))


def test_delete_is_refused_while_the_datasets_own_job_is_queued_even_before_job_id_is_set(
    client, project_id, handle, labeled_dataset
):
    from app.db.models import Dataset

    ds = labeled_dataset
    with handle.session() as s:
        s.get(Dataset, ds["id"]).job_id = None  # the window between freeze and _set_job_id
        s.add(Job(type="dataset", state="queued", progress=0, message="", params={"dataset_id": ds["id"]}))
    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_a_finished_training_job_does_not_block_the_delete(client, project_id, handle, labeled_dataset):
    ds = labeled_dataset
    with handle.session() as s:
        s.add(Job(type="train", state="succeeded", progress=1, message="", params={"dataset_id": ds["id"]}))
    assert client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 204


def test_a_folder_that_cannot_be_moved_aside_refuses_the_delete_and_changes_nothing(
    client, project_id, handle, labeled_dataset, monkeypatch
):
    def locked(src, dst):
        raise PermissionError(5, "Access is denied", str(src))

    monkeypatch.setattr("app.datasets.materialise.os.replace", locked)
    ds = labeled_dataset
    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    assert r.status_code == 409, r.text
    assert "in use" in r.json()["error"]["message"]
    assert any((handle.folder / ds["path"]).rglob("*.jpg"))
    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 200


def test_a_removal_that_fails_half_way_still_frees_the_name(
    client, project_id, handle, labeled_dataset, monkeypatch, wait_job
):
    def half_way(path, *a, **k):
        raise PermissionError(5, "Access is denied", str(path))

    monkeypatch.setattr("app.datasets.materialise.shutil.rmtree", half_way)
    ds = labeled_dataset
    assert client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 204
    assert not (handle.folder / ds["path"]).exists()  # moved aside atomically before the rows went
    monkeypatch.undo()
    again = client.post(f"{BASE}/{project_id}/datasets", json={"name": ds["name"]})
    assert again.status_code == 202, again.text
    assert wait_job(project_id, again.json()["job"]["id"])["state"] == "succeeded"
    # The next delete sweeps the leftover of the failed removal.
    assert client.delete(f"{BASE}/{project_id}/datasets/{again.json()['dataset']['id']}").status_code == 204
    assert [p.name for p in handle.datasets_dir.iterdir()] == []


@pytest.mark.parametrize("name", ["...", "v1.", ".hidden", "CON", "nul", "com1", "V1"])
def test_names_that_are_not_safe_folder_names_or_collide_by_case_are_refused(
    client, project_id, labeled_dataset, name
):
    r = client.post(f"{BASE}/{project_id}/datasets", json={"name": name})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] in ("conflict", "already_exists")


# ------------------------------------------------ crash windows (re-review of 8299964)


def _second_dataset(client, project_id, wait_job, name="v2"):
    created = client.post(f"{BASE}/{project_id}/datasets", json={"name": name}).json()
    assert wait_job(project_id, created["job"]["id"])["state"] == "succeeded"
    return created["dataset"]


def test_a_commit_that_fails_after_the_move_puts_the_folder_back(
    client, project_id, handle, labeled_dataset, monkeypatch
):
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Session

    real_commit = Session.commit
    calls = {"n": 0}

    def failing_once(self):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OperationalError("COMMIT", {}, Exception("disk I/O error"))
        return real_commit(self)

    monkeypatch.setattr(Session, "commit", failing_once)
    ds = labeled_dataset
    with pytest.raises(OperationalError):  # the test client re-raises what the app answers 500 for
        client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    monkeypatch.undo()

    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 200
    assert any((handle.folder / ds["path"]).rglob("*.jpg"))
    assert not list(handle.datasets_dir.glob(".deleting-*"))


def test_a_tombstone_whose_dataset_still_exists_is_restored_never_destroyed(
    client, project_id, handle, labeled_dataset, wait_job
):
    """A kill between the move and the commit leaves the row and a tombstone: the data comes back."""
    import os

    ds = labeled_dataset
    other = _second_dataset(client, project_id, wait_job)
    folder = handle.folder / ds["path"]
    os.replace(folder, folder.with_name(f".deleting-{ds['id']}"))

    # Deleting an unrelated dataset sweeps tombstones; it must give v1 its folder back, not remove it.
    assert client.delete(f"{BASE}/{project_id}/datasets/{other['id']}").status_code == 204
    assert any(folder.rglob("*.jpg"))
    assert not list(handle.datasets_dir.glob(".deleting-*"))


def test_opening_a_project_restores_a_tombstone_left_by_a_crash(handle, labeled_dataset):
    import os

    from app.datasets.materialise import reconcile_tombstones

    folder = handle.folder / labeled_dataset["path"]
    os.replace(folder, folder.with_name(f".deleting-{labeled_dataset['id']}"))
    reconcile_tombstones(handle)
    assert any(folder.rglob("*.jpg"))


def test_a_tombstone_without_a_row_is_removed(handle, labeled_dataset):
    from app.datasets.materialise import reconcile_tombstones

    leftover = handle.datasets_dir / ".deleting-0b9f1d2e-8c1a-4a57-9d8e-2f4c6b7a1e30"
    leftover.mkdir()
    (leftover / "a.txt").write_text("x")
    reconcile_tombstones(handle)
    assert not leftover.exists()
    assert any((handle.folder / labeled_dataset["path"]).rglob("*.jpg"))


def test_deleting_works_when_the_project_folder_is_reached_through_a_junction(
    handle, labeled_dataset, tmp_path
):
    import _winapi

    from app.datasets.materialise import delete_dataset
    from app.projects.service import ProjectHandle

    link = tmp_path / "project-link"
    _winapi.CreateJunction(str(handle.folder), str(link))
    try:
        through_link = ProjectHandle(handle.id, link, handle.engine)
        delete_dataset(through_link, labeled_dataset["id"])
        assert not (handle.folder / labeled_dataset["path"]).exists()
        assert handle.images_dir.is_dir()
    finally:
        link.rmdir()  # removes the link, never the project


def test_discarding_a_failed_dataset_never_removes_more_than_its_own_folder(handle, labeled_dataset):
    from app.datasets.materialise import discard

    _set_path(handle, labeled_dataset["id"], "datasets")
    discard(handle, labeled_dataset["id"])
    assert handle.datasets_dir.is_dir()
    assert any(handle.datasets_dir.rglob("*.jpg"))


@pytest.mark.parametrize("name", [".", ".."])
def test_dot_names_are_refused_like_every_other_unusable_name(client, project_id, labeled_dataset, name):
    r = client.post(f"{BASE}/{project_id}/datasets", json={"name": name})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict", r.text


# ------------------------------------------ second re-review of the deletion (355430f)

UUID_A = "3c6f1e0a-1b2c-4d5e-8f90-a1b2c3d4e5f6"


def test_a_discarded_folder_is_out_of_the_way_before_its_files_are_removed(
    handle, labeled_dataset, monkeypatch
):
    """A retry under the same name must never write into a folder that is still being removed."""
    import shutil

    from app.datasets import materialise

    folder = handle.folder / labeled_dataset["path"]
    real_rmtree = shutil.rmtree  # the patch below replaces it on the one shared shutil module
    seen = []

    def spy(path, *a, **k):
        seen.append((Path(path).name, folder.exists(), materialise._FOLDER_LOCK.locked()))
        return real_rmtree(path, *a, **k)

    monkeypatch.setattr("app.datasets.materialise.shutil.rmtree", spy)
    materialise.discard(handle, labeled_dataset["id"])

    assert seen, "the folder was not removed"
    name, original_still_there, locked = seen[0]
    assert name.startswith(".deleting-") and not original_still_there
    assert not locked  # the files go without blocking other deletes or opening projects
    assert not folder.exists() and not list(handle.datasets_dir.glob(".deleting-*"))


def test_a_deletes_files_are_removed_outside_the_lock(
    client, project_id, handle, labeled_dataset, monkeypatch
):
    import shutil

    from app.datasets import materialise

    real_rmtree = shutil.rmtree  # the patch below replaces it on the one shared shutil module
    held = []

    def spy(path, *a, **k):
        held.append(materialise._FOLDER_LOCK.locked())
        return real_rmtree(path, *a, **k)

    monkeypatch.setattr("app.datasets.materialise.shutil.rmtree", spy)
    assert client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}").status_code == 204
    assert held == [False]


def test_a_legacy_dataset_whose_name_looks_like_a_tombstone_is_left_alone(handle, labeled_dataset):
    from app.datasets.materialise import reconcile_tombstones
    from app.db.models import Dataset

    for name in (".deleting-legacy", f".deleting-{UUID_A}"):
        folder = handle.datasets_dir / name
        folder.mkdir()
        (folder / "keep.txt").write_text("keep")
        with handle.session() as s:
            s.add(
                Dataset(
                    name=name, classes=[], split_method="random", split_params={}, path=f"datasets/{name}"
                )
            )
    reconcile_tombstones(handle)
    for name in (".deleting-legacy", f".deleting-{UUID_A}"):
        assert (handle.datasets_dir / name / "keep.txt").read_text() == "keep"


def test_a_tombstone_that_is_a_file_is_left_alone(handle, labeled_dataset):
    from app.datasets.materialise import reconcile_tombstones

    stray = handle.datasets_dir / f".deleting-{UUID_A}"
    stray.write_text("not a folder")
    reconcile_tombstones(handle)
    assert stray.read_text() == "not a folder"


def test_a_committed_delete_answers_204_even_if_the_sweep_cannot_list(
    client, project_id, handle, labeled_dataset, monkeypatch
):
    def unreadable(handle):
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr("app.datasets.materialise._leftovers", unreadable)
    assert client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}").status_code == 204
    assert client.get(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}").status_code == 404


class _NoLiveJobs:
    def is_live(self, job_id):
        return False


def test_opening_a_project_restores_a_tombstone_even_when_the_job_sweep_fails(
    handle, labeled_dataset, monkeypatch, tmp_path
):
    import os

    from app.main import project_opened
    from app.projects.service import ProjectRegistry

    folder = handle.folder / labeled_dataset["path"]
    os.replace(folder, folder.with_name(f".deleting-{labeled_dataset['id']}"))

    def locked_db(*a, **k):
        raise RuntimeError("database is locked")

    monkeypatch.setattr("app.jobs.startup.sweep_orphans", locked_db)
    registry = ProjectRegistry(tmp_path / "appdata", on_open=lambda h: project_opened(h, _NoLiveJobs()))
    registry.open(handle.folder, remember=False)

    assert any(folder.rglob("*.jpg"))


def test_a_sweep_waits_for_a_delete_in_progress(handle, labeled_dataset):
    import threading
    import time

    from app.datasets import materialise

    done = threading.Event()
    with materialise._FOLDER_LOCK:
        t = threading.Thread(target=lambda: (materialise.reconcile_tombstones(handle), done.set()))
        t.start()
        time.sleep(0.3)
        assert not done.is_set()
    t.join(5)
    assert done.is_set()


# --------------------------------------------- third review of the deletion (5f678af)


def test_a_discard_that_cannot_move_the_folder_keeps_the_dataset(
    client, project_id, handle, labeled_dataset, monkeypatch
):
    """The half-written folder must not stay behind under a free name: the dataset stays listed
    (its failed job marks it incomplete) and the ordinary delete removes it later."""
    from app.datasets import materialise

    def locked(folder, dataset_id):
        raise PermissionError(5, "Access is denied", str(folder))

    monkeypatch.setattr(materialise, "_move_aside", locked)
    materialise.discard(handle, labeled_dataset["id"])

    assert client.get(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}").status_code == 200
    assert any((handle.folder / labeled_dataset["path"]).rglob("*.jpg"))


def test_a_name_whose_folder_is_still_on_disk_is_refused(client, project_id, handle, labeled_dataset):
    stale = handle.datasets_dir / "v9"
    stale.mkdir()
    (stale / "old.txt").write_text("from an earlier dataset")
    r = client.post(f"{BASE}/{project_id}/datasets", json={"name": "V9"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_exists", r.text
    assert "folder" in r.json()["error"]["message"]
    assert (stale / "old.txt").exists()


@pytest.mark.parametrize(
    "suffix",
    [
        "{3c6f1e0a-1b2c-4d5e-8f90-a1b2c3d4e5f6}",
        "urn:uuid:3c6f1e0a-1b2c-4d5e-8f90-a1b2c3d4e5f6".replace(":", "_"),
        "3c6f1e0a1b2c4d5e8f90a1b2c3d4e5f6",
        "3C6F1E0A-1B2C-4D5E-8F90-A1B2C3D4E5F6",
    ],
)
def test_only_canonical_tombstone_names_are_swept(handle, labeled_dataset, suffix):
    from app.datasets.materialise import reconcile_tombstones

    folder = handle.datasets_dir / f".deleting-{suffix}"
    folder.mkdir()
    (folder / "keep.txt").write_text("keep")
    reconcile_tombstones(handle)
    assert (folder / "keep.txt").read_text() == "keep"


def test_removing_a_tombstone_that_is_already_gone_is_silent(tmp_path, caplog):
    import logging

    from app.datasets.materialise import _remove_quietly

    with caplog.at_level(logging.WARNING, logger="app.datasets.materialise"):
        _remove_quietly(tmp_path / ".deleting-gone")
    assert caplog.records == []


def test_one_unreadable_entry_does_not_stop_the_sweep(handle, labeled_dataset, monkeypatch):
    from pathlib import Path as P

    from app.datasets.materialise import reconcile_tombstones

    bad = handle.datasets_dir / f".deleting-{UUID_A}"
    good = handle.datasets_dir / ".deleting-0b9f1d2e-8c1a-4a57-9d8e-2f4c6b7a1e30"
    for f in (bad, good):
        f.mkdir()
    real_is_dir = P.is_dir

    def flaky(self):
        if self.name == bad.name:
            raise PermissionError(5, "Access is denied")
        return real_is_dir(self)

    monkeypatch.setattr(P, "is_dir", flaky)
    reconcile_tombstones(handle)
    monkeypatch.undo()
    assert not good.exists()
