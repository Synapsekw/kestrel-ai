"""The pure import pipeline (spec §6): no database, the same code the job and the selftest run."""

import errno
import io
import json
import threading
import time

import pytest
from pointclouds import fake_run_converter, make_las

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import admission, converter, converter_path, workcopy
from app.pointclouds.importer import import_cloud
from app.pointclouds.lasfile import inspect_file

GB = 1_000_000_000


@pytest.fixture(autouse=True)
def plenty(monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)


def fake_converter(calls=None, points_delta=0):
    """F0's offline converter (a real DEFAULT octree), recording its arguments, optionally corrupted."""

    def run(input_path, out_dir, *, progress, check_cancelled):
        if calls is not None:
            calls.append((input_path, out_dir))
        result = fake_run_converter(input_path, out_dir, progress=progress, check_cancelled=check_cancelled)
        if points_delta:
            meta = json.loads((out_dir / "metadata.json").read_text("utf-8"))
            meta["points"] += points_delta
            (out_dir / "metadata.json").write_text(json.dumps(meta), "utf-8")
        return result

    return run


def _run(src, cloud_dir, **kw):
    seen: list[tuple[float, str]] = []
    result = import_cloud(
        src, cloud_dir, progress=lambda f, m: seen.append((f, m)), check_cancelled=lambda: None, **kw
    )
    return result, seen


def test_imports_a_pix4d_style_las(tmp_path):
    src = make_las(tmp_path / "src" / "chimney.las", 5_000, header_shrink_mm=0.3)
    cloud_dir = tmp_path / "proj" / "pointclouds" / "c1"
    calls = []
    r, seen = _run(src, cloud_dir, converter=fake_converter(calls))
    assert r.point_count == 5_000 and r.bounds_repaired is True and r.crs.epsg == 32639
    assert (r.las_version, r.point_format, r.has_rgb, r.scale) == ("1.2", 3, True, [0.001, 0.001, 0.001])
    assert (
        r.octree_spacing_m > 0 and r.octree_bytes > 0 and r.encoding == "DEFAULT"
    )  # F0's fake writes DEFAULT
    assert len(r.bounds_wgs84) == 4 and r.z_stats["sample_count"] == 5_000
    assert (cloud_dir / "octree" / "metadata.json").is_file()
    assert not (cloud_dir / ".work").exists()
    assert (
        calls[0][0].name == "input.las"
        and calls[0][1].name == "octree"
        and calls[0][0].parent.name == ".work"
    )
    fractions = [f for f, _ in seen]
    assert fractions == sorted(fractions) and fractions[-1] == pytest.approx(0.99)
    assert any(m.startswith("copying ") for _, m in seen) and any(m.startswith("scanning ") for _, m in seen)
    record = json.loads((cloud_dir / "source.json").read_text("utf-8"))
    assert (
        record["path"] == str(src)
        and record["sha256"] == r.source_sha256
        and record["bounds_repaired"] is True
    )
    assert record["header"]["point_count"] == 5_000
    assert record["converter"]["log_tail"] == ["fake converter: 5000 points"]
    assert set(record["timings"]) >= {"copy_s", "scan_s", "convert_s", "validate_s"}
    assert src.stat().st_size == r.source_size  # the source is only ever read


def test_imports_a_laz(tmp_path):
    src = make_las(tmp_path / "c.laz", 3_000, compressed=True)
    r, _ = _run(src, tmp_path / "pc" / "c2", converter=fake_converter())
    assert r.point_count == 3_000 and r.bounds_repaired is False


def test_paths_with_spaces_and_non_ascii(tmp_path):
    """Review Focus 1."""
    src = make_las(tmp_path / "Chimney stack 3D — Kuwait" / "جديد" / "Chimney stack 3D_group1.las", 1_000)
    cloud_dir = tmp_path / "مشروع" / "pointclouds" / "c3"
    calls = []
    r, _ = _run(src, cloud_dir, converter=fake_converter(calls))
    assert r.point_count == 1_000 and calls[0][0].name == "input.las"


def test_refused_up_front_without_touching_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 1 * GB)
    src = make_las(tmp_path / "c.las", 1_000)
    cloud_dir = tmp_path / "pc" / "c4"
    with pytest.raises(JobFailure) as e:
        _run(src, cloud_dir, converter=fake_converter())
    assert "of free memory" in str(e.value)
    assert not (cloud_dir / ".work").exists()


def test_admission_is_checked_again_right_before_the_converter(tmp_path, monkeypatch):
    answers = iter([64 * GB, 1 * GB])
    monkeypatch.setattr(admission, "available_ram", lambda: next(answers))
    calls = []
    cloud_dir = tmp_path / "pc" / "c5"
    with pytest.raises(JobFailure):
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=fake_converter(calls))
    assert calls == [] and not (cloud_dir / ".work").exists()


def test_converter_failure_cleans_up(tmp_path):
    def broken(input_path, out_dir, **_):
        out_dir.mkdir()
        (out_dir / "chunks").mkdir()  # a half-written converter output
        raise JobFailure("the point-cloud converter stopped: ERROR(x)")

    cloud_dir = tmp_path / "pc" / "c6"
    with pytest.raises(JobFailure):
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=broken)
    assert not (cloud_dir / ".work").exists() and not (cloud_dir / "octree").exists()


def test_validation_failure_cleans_up(tmp_path):
    cloud_dir = tmp_path / "pc" / "c7"
    with pytest.raises(JobFailure) as e:
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=fake_converter(points_delta=-1))
    assert "999 points, expected 1000" in str(e.value)
    assert not (cloud_dir / ".work").exists() and not (cloud_dir / "octree").exists()


def test_cancel_during_the_scan_cleans_up(tmp_path):
    cloud_dir = tmp_path / "pc" / "c8"
    state = {"scanning": False}

    def progress(_f, m):
        state["scanning"] = state["scanning"] or m.startswith("scanning")

    def check():
        if state["scanning"]:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        import_cloud(
            make_las(tmp_path / "c.las", 5_000),
            cloud_dir,
            progress=progress,
            check_cancelled=check,
            converter=fake_converter(),
        )
    assert not (cloud_dir / ".work").exists()


class _Flaky(io.BytesIO):
    def read(self, n=-1):
        if self.tell() > 0:
            raise OSError(errno.EIO, "The specified network name is no longer available")
        return super().read(n)


def test_source_vanishing_mid_copy_cleans_up(tmp_path, monkeypatch):
    """Review Focus 2."""
    src = make_las(tmp_path / "c.las", 50_000)
    monkeypatch.setattr(workcopy, "_open_source", lambda p: _Flaky(p.read_bytes()))
    cloud_dir = tmp_path / "pc" / "c9"
    with pytest.raises(JobFailure) as e:
        _run(src, cloud_dir, converter=fake_converter())
    assert str(e.value).startswith("could not read the source file:")
    assert not (cloud_dir / ".work").exists()


def test_full_drive_cleans_up(tmp_path, monkeypatch):
    """Review Focus 3."""

    class Full(io.BytesIO):
        def write(self, b):
            raise OSError(errno.ENOSPC, "There is not enough space on the disk")

    monkeypatch.setattr(workcopy, "_open_dest", lambda p: Full())
    cloud_dir = tmp_path / "pc" / "c10"
    with pytest.raises(JobFailure) as e:
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=fake_converter())
    assert str(e.value) == "the project drive is full; free some space and import again"
    assert not (cloud_dir / ".work").exists()


@pytest.mark.potreeconverter
@pytest.mark.skipif(converter_path.converter_exe() is None, reason="PotreeConverter payload not fetched")
def test_the_real_converter_on_a_pix4d_style_laz(tmp_path):
    src = make_las(tmp_path / "fixture.laz", 50_000, compressed=True, header_shrink_mm=0.3)
    r, _ = _run(src, tmp_path / "pc" / "real")
    meta = json.loads((tmp_path / "pc" / "real" / "octree" / "metadata.json").read_text("utf-8"))
    assert (r.bounds_repaired, r.crs.epsg, meta["points"], meta["encoding"]) == (
        True,
        32639,
        50_000,
        "BROTLI",
    )


def _bytes_under(folder):
    return sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()) if folder.exists() else 0


def test_the_disk_re_check_does_not_count_the_work_copy_twice(tmp_path, monkeypatch):
    """Final review B1: the work copy is already on the project drive when the job re-checks."""
    src = make_las(tmp_path / "src" / "c.las", 20_000)
    cloud_dir = tmp_path / "pc" / "c11"
    info = inspect_file(src)
    budget = admission.disk_needed(info.point_count, src.stat().st_size, info.record_len) + 1_000
    # A drive with just enough room at submit, shrinking by whatever the job writes into .work.
    monkeypatch.setattr(admission, "free_disk", lambda folder: budget - _bytes_under(cloud_dir / ".work"))
    calls = []
    r, _ = _run(src, cloud_dir, converter=fake_converter(calls))
    assert r.point_count == 20_000 and len(calls) == 1


def test_the_re_check_waits_for_the_converter_slot(tmp_path, monkeypatch):
    """Final review B2 (spec §6.7): a second import waits for the slot, then re-checks and runs."""
    ram_calls: list[float] = []

    def ram():
        ram_calls.append(time.monotonic())
        return 64 * GB

    monkeypatch.setattr(admission, "available_ram", ram)
    held, release = threading.Event(), threading.Event()

    def holder():
        with converter.slot(lambda *_: None, lambda: None):
            held.set()
            release.wait(10)

    h = threading.Thread(target=holder)
    h.start()
    assert held.wait(5)
    seen: list[tuple[float, str]] = []
    calls, errors = [], []
    src = make_las(tmp_path / "c.las", 1_000)

    def b():
        try:
            import_cloud(
                src,
                tmp_path / "pc" / "c12",
                progress=lambda f, m: seen.append((f, m)),
                check_cancelled=lambda: None,
                converter=fake_converter(calls),
            )
        except BaseException as e:  # noqa: BLE001 - the test inspects it
            errors.append(e)

    t = threading.Thread(target=b)
    t.start()
    deadline = time.monotonic() + 10
    while converter.WAITING not in [m for _, m in seen] and time.monotonic() < deadline:
        time.sleep(0.02)
    assert converter.WAITING in [m for _, m in seen]
    time.sleep(0.3)
    assert calls == [] and len(ram_calls) == 1  # only the up-front check so far
    released_at = time.monotonic()
    release.set()
    h.join(5)
    t.join(15)
    assert errors == [] and len(calls) == 1
    assert len(ram_calls) == 2 and ram_calls[1] >= released_at  # re-checked after the slot came free
    fractions = [f for f, _ in seen]
    assert fractions == sorted(fractions)


def test_a_cancel_while_waiting_for_the_slot_never_converts(tmp_path):
    held, release = threading.Event(), threading.Event()

    def holder():
        with converter.slot(lambda *_: None, lambda: None):
            held.set()
            release.wait(10)

    h = threading.Thread(target=holder)
    h.start()
    assert held.wait(5)
    state = {"waiting": False}

    def progress(_f, m):
        state["waiting"] = state["waiting"] or m == converter.WAITING

    def check():
        if state["waiting"]:
            raise JobCancelled()

    calls = []
    cloud_dir = tmp_path / "pc" / "c13"
    try:
        with pytest.raises(JobCancelled):
            import_cloud(
                make_las(tmp_path / "c.las", 1_000),
                cloud_dir,
                progress=progress,
                check_cancelled=check,
                converter=fake_converter(calls),
            )
    finally:
        release.set()
        h.join(5)
    assert calls == [] and not (cloud_dir / ".work").exists()


def test_an_unreadable_source_header_is_a_job_failure(tmp_path, monkeypatch):
    """Final review B4: a sharing violation / NAS drop while reading the header."""
    from app.pointclouds import importer

    def locked(path):
        raise PermissionError(13, "The process cannot access the file because it is being used", str(path))

    monkeypatch.setattr(importer, "inspect_file", locked)
    src = make_las(tmp_path / "c.las", 100)
    with pytest.raises(JobFailure) as e:
        _run(src, tmp_path / "pc" / "c14", converter=fake_converter())
    assert str(e.value) == (
        f"could not read the source file: {src} (The process cannot access the file because it is being used)"
    )
