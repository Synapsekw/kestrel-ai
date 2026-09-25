"""RAM and disk admission (spec §6.2): arithmetic, the refusal messages, the seams."""

import pytest

from app.jobs.cancellation import JobFailure
from app.pointclouds import admission

GB = 1_000_000_000


@pytest.fixture
def plenty(monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)


def test_ram_need_is_45_mb_per_million_points_plus_a_gib():
    assert admission.ram_needed(21_697_184) == int(45_000_000 * 21.697184) + 2**30
    assert admission.ram_needed(195_274_656) == 9_861_101_344


def test_disk_need_counts_the_work_copy_chunks_octree_and_margin():
    need = admission.disk_needed(point_count=1_000_000, source_size=34_000_000, record_len=34)
    assert need == 34_000_000 + 40 * 1_000_000 + int(0.25 * 1_000_000 * 34) + 2**30


def test_admits_when_both_fit(plenty, tmp_path):
    a = admission.assess(21_697_184, 738_000_000, 34, tmp_path)
    assert a.ok and a.reason is None and a.code is None
    admission.require(a)  # does not raise


def test_refuses_195m_points_with_4_gb_free(monkeypatch, tmp_path):
    monkeypatch.setattr(admission, "available_ram", lambda: 4 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)
    a = admission.assess(195_274_656, 6_200_000_000, 34, tmp_path)
    assert not a.ok and a.code == "insufficient_memory"
    assert a.reason == (
        "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again."
    )
    with pytest.raises(JobFailure) as e:
        admission.require(a)
    assert str(e.value) == a.reason


def test_refuses_when_the_project_drive_is_too_small(monkeypatch, tmp_path):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 5 * GB)
    a = admission.assess(195_274_656, 6_200_000_000, 34, tmp_path)
    assert a.code == "insufficient_disk"
    assert a.reason.startswith("This import needs about 16.")
    assert a.reason.endswith(
        "GB of free disk space on the project drive; 5.0 GB is free. Free some space and try again."
    )


def test_free_disk_walks_up_to_an_existing_folder(tmp_path):
    assert admission.free_disk(tmp_path / "not" / "yet" / "made") > 0


def test_as_dict_matches_the_contract_fields(plenty, tmp_path):
    d = admission.assess(10, 100, 34, tmp_path).as_dict()
    assert set(d) == {
        "ok",
        "ram_needed_bytes",
        "ram_available_bytes",
        "disk_needed_bytes",
        "disk_available_bytes",
        "reason",
    }
