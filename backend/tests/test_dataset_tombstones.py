"""The sweep that settles dataset folders a pre-foundation delete left moved aside (plan BM Task 7)."""

import pytest

from app.db.models import Dataset

UUID_A = "3c6f1e0a-1b2c-4d5e-8f90-a1b2c3d4e5f6"


class _NoLiveJobs:
    def is_live(self, job_id):
        return False


@pytest.fixture
def labeled_dataset(handle, make_jpeg) -> dict:
    """A dataset folder and its row, exactly as the old per-project materialise left them."""
    folder = handle.datasets_dir / "v1"
    make_jpeg(folder / "images" / "train" / "a.jpg", 40, 30)
    row = Dataset(name="v1", classes=[], split_method="random", split_params={}, path="datasets/v1")
    with handle.session() as s:
        s.add(row)
        s.flush()
        return {"id": row.id, "path": row.path}


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
