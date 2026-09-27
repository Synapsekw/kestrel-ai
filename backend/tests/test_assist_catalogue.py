"""The assist catalogue (spec 2026-09-26-image-inspection §10, §16): pinned weights and their state."""

import os

import pytest
from assist_fakes import fake_sam_spec

from app.assist import catalogue
from app.errors import AppError

AM_FIELDS = {
    "key",
    "name",
    "description",
    "size_mb",
    "sha256",
    "state",
    "reason",
    "job_id",
}  # C0's AssistModel


def test_sam_2_1_tiny_is_pinned():
    spec = catalogue.get_spec("sam2.1_t")
    assert spec.file_name == "sam2.1_t.pt"
    assert spec.size_bytes == 78_105_722
    assert spec.sha256 == "3c1e81ca9b037dd39d70a014ddb9a813d6c4c4e12555420db7eaff31689bd4e3"
    assert catalogue.SAM_KEY == "sam2.1_t" and catalogue.ASSIST_SAM == "sam"


def test_unknown_key_is_not_found():
    with pytest.raises(AppError) as e:
        catalogue.get_spec("sam3")
    assert e.value.status == 404 and e.value.code == "not_found"


def test_weights_live_in_the_library_assist_folder(tmp_path):
    spec = catalogue.get_spec(catalogue.SAM_KEY)
    assert catalogue.weights_path(tmp_path, spec) == tmp_path / "assist" / "sam2.1_t.pt"


def test_status_has_exactly_the_contract_fields(tmp_path):
    row = catalogue.status(catalogue.get_spec(catalogue.SAM_KEY), tmp_path, None)
    assert set(row) == AM_FIELDS
    assert row["size_mb"] == 78.1 and row["name"] == "SAM 2.1 tiny" and row["description"]


def _write(tmp_path, content: bytes):
    path = catalogue.weights_path(tmp_path, catalogue.get_spec(catalogue.SAM_KEY))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def test_missing_ready_and_invalid_states(tmp_path, monkeypatch):
    spec = fake_sam_spec(monkeypatch, b"good weights")
    assert catalogue.status(spec, tmp_path, None)["state"] == "missing"
    _write(tmp_path, b"good weights")
    assert catalogue.status(spec, tmp_path, "job-1") == {
        **catalogue.status(spec, tmp_path, None),
        "job_id": "job-1",
    }
    ready = catalogue.status(spec, tmp_path, None)
    assert ready["state"] == "ready" and ready["reason"] is None
    _write(tmp_path, b"short")
    catalogue.forget_verified()
    assert catalogue.status(spec, tmp_path, None)["state"] == "invalid"


def test_unavailable_wins_and_carries_the_reason(tmp_path, monkeypatch):
    spec = fake_sam_spec(monkeypatch, b"good weights")
    _write(tmp_path, b"good weights")
    row = catalogue.status(
        spec, tmp_path, None, "ModuleNotFoundError: No module named 'ultralytics.models.sam'"
    )
    assert row["state"] == "unavailable" and "ultralytics.models.sam" in row["reason"]
    missing = catalogue.status(spec, tmp_path / "elsewhere", None)
    assert missing["state"] == "missing" and missing["reason"] == catalogue.MESSAGES["missing"]


def test_same_size_wrong_content_is_invalid(tmp_path, monkeypatch):
    spec = fake_sam_spec(monkeypatch, b"good weights")
    _write(tmp_path, b"evil weights")  # same length, different bytes
    assert catalogue.status(spec, tmp_path, None)["state"] == "invalid"


def test_the_hash_runs_once_per_file_version(tmp_path, monkeypatch):
    spec = fake_sam_spec(monkeypatch, b"good weights")
    path = _write(tmp_path, b"good weights")
    calls = []
    real = catalogue.sha256_file
    monkeypatch.setattr(catalogue, "sha256_file", lambda p: calls.append(p) or real(p))
    assert catalogue.file_ok(path, spec) and catalogue.file_ok(path, spec)
    assert len(calls) == 1
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    assert catalogue.file_ok(path, spec)
    assert len(calls) == 2


def test_a_size_mismatch_is_invalid_without_hashing(tmp_path, monkeypatch):
    spec = fake_sam_spec(monkeypatch, b"good weights")
    path = _write(tmp_path, b"much longer than the pinned weights")
    monkeypatch.setattr(catalogue, "sha256_file", lambda p: pytest.fail("hashed a wrong-size file"))
    assert not catalogue.file_ok(path, spec)


def test_require_ready_raises_assist_model_missing(tmp_path, monkeypatch):
    fake_sam_spec(monkeypatch, b"good weights")
    with pytest.raises(AppError) as e:
        catalogue.require_ready(tmp_path, None)
    assert (e.value.status, e.value.code) == (409, "assist_model_missing")
    assert e.value.details == {"key": "sam2.1_t", "state": "missing"}
    path = _write(tmp_path, b"good weights")
    assert catalogue.require_ready(tmp_path, None) == path
    with pytest.raises(AppError) as e:
        catalogue.require_ready(tmp_path, "RuntimeError: boom")
    assert e.value.details["state"] == "unavailable" and "boom" in e.value.message
