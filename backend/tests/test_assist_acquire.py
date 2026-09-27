"""The assist_acquire library job (spec §10 Weights; C0 Ruling 8; ruling BS8)."""

from pathlib import Path

import pytest
from assist_fakes import fake_sam_spec
from library_helpers import wait_library_job

from app.assist import catalogue
from app.assist.jobs_acquire import live_acquire_id

GOOD = b"the real sam 2.1 tiny bytes"


@pytest.fixture
def target(client) -> Path:
    return catalogue.weights_path(client.app.state.library.folder, catalogue.get_spec(catalogue.SAM_KEY))


def _submit(client, **params) -> dict:
    app = client.app
    job = app.state.jobs.submit(app.state.library, "assist_acquire", {"key": "sam2.1_t", **params})
    return wait_library_job(client, job.id)


def _fake_download(content: bytes, calls: list):
    def download(ctx, target: Path) -> None:
        calls.append(target.name)
        target.write_bytes(content)

    return download


def test_download_verifies_and_publishes(client, monkeypatch, target):
    fake_sam_spec(monkeypatch, GOOD)
    calls: list = []
    monkeypatch.setattr("app.training.starter_download.download_weights", _fake_download(GOOD, calls))
    job = _submit(client)
    assert job["state"] == "succeeded", job
    assert job["type"] == "assist_acquire" and job["project_id"] == "library"
    assert job["result"] == {"key": "sam2.1_t"}
    assert calls == ["sam2.1_t.pt"]  # the asset name the v8.4.0 release serves
    assert target.read_bytes() == GOOD
    assert not any(p.name.startswith(".staging") for p in target.parent.iterdir())


def test_a_download_with_the_wrong_checksum_fails_and_publishes_nothing(client, monkeypatch, target):
    fake_sam_spec(monkeypatch, GOOD)
    monkeypatch.setattr(
        "app.training.starter_download.download_weights", _fake_download(b"x" * len(GOOD), [])
    )
    job = _submit(client)
    assert job["state"] == "failed" and "checksum" in job["error"]
    assert not target.exists()
    assert not any(p.name.startswith(".staging") for p in target.parent.iterdir())


def test_import_copies_a_file_and_leaves_the_source_alone(client, monkeypatch, target, tmp_path):
    fake_sam_spec(monkeypatch, GOOD)
    source = tmp_path / "usb" / "sam2.1_t.pt"
    source.parent.mkdir()
    source.write_bytes(GOOD)
    monkeypatch.setattr(
        "app.training.starter_download.download_weights", lambda *a: pytest.fail("import must not download")
    )
    job = _submit(client, path=str(source))
    assert job["state"] == "succeeded", job
    assert target.read_bytes() == GOOD and source.read_bytes() == GOOD


def test_a_wrong_file_never_replaces_the_existing_one(client, monkeypatch, target, tmp_path):
    fake_sam_spec(monkeypatch, GOOD)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = b"old but " + GOOD[8:]  # same size, wrong hash: present but invalid, so the job runs
    target.write_bytes(existing)
    wrong = tmp_path / "yolo11n.pt"
    wrong.write_bytes(b"a detector, not sam")
    job = _submit(client, path=str(wrong))
    assert job["state"] == "failed" and "checksum" in job["error"]
    assert target.read_bytes() == existing


def test_valid_weights_make_the_job_a_no_op(client, monkeypatch, target):
    fake_sam_spec(monkeypatch, GOOD)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(GOOD)
    monkeypatch.setattr(
        "app.training.starter_download.download_weights",
        lambda *a: pytest.fail("ready weights re-downloaded"),
    )
    job = _submit(client)
    assert job["state"] == "succeeded" and job["result"] == {"key": "sam2.1_t"}


def test_a_vanished_import_source_fails_readably(client, monkeypatch, tmp_path):
    fake_sam_spec(monkeypatch, GOOD)
    job = _submit(client, path=str(tmp_path / "gone.pt"))
    assert job["state"] == "failed" and "no longer exists" in job["error"]


def test_an_unknown_key_fails_readably(client):
    app = client.app
    job = app.state.jobs.submit(app.state.library, "assist_acquire", {"key": "sam3"})
    done = wait_library_job(client, job.id)
    assert done["state"] == "failed" and "smart polygon" in done["error"].lower()


def test_no_live_job_once_it_has_finished(client, monkeypatch):
    fake_sam_spec(monkeypatch, GOOD)
    monkeypatch.setattr("app.training.starter_download.download_weights", _fake_download(GOOD, []))
    _submit(client)
    assert live_acquire_id(client.app.state.library, "sam2.1_t") is None
