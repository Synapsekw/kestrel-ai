"""Running PotreeConverter (spec §6.7): progress parsing, failures, cancel, the lock, the Job Object."""

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil
import pytest

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import converter

FAKE = Path(__file__).resolve().parent / "fake_potreeconverter.py"


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(converter, "_exe_prefix", lambda: [sys.executable, str(FAKE)])

    def use(mode: str, **env):
        monkeypatch.setenv("FAKE_PC_MODE", mode)
        for k, v in env.items():
            monkeypatch.setenv(k, str(v))

    return use


def _work(tmp_path: Path, name: str = "work") -> tuple[Path, Path]:
    work = tmp_path / name
    work.mkdir(parents=True)
    (work / "input.las").write_bytes(b"LASF")
    return work / "input.las", work / "octree"


def _never():
    return None


def _alive(pid: int) -> bool:
    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def test_parse_progress_on_recorded_spike_lines():
    line = "[67%, 1s], [DISTRIBUTING: 100%, duration: 0s, throughput: 73MPs][RAM: 0.2GB, CPU: 39%]"
    assert converter.parse_progress(line) == (0.67, "building the 3D view copy: DISTRIBUTING 100 %")
    assert converter.parse_progress("[80%, 3s], [INDEXING: 39%, duration: 1s, throughput: 8MPs]") == (
        0.80,
        "building the 3D view copy: INDEXING 39 %",
    )
    for line in ["sampling: 2.992121s", "#points: 21'697'184", "", "[80%, 3s]"]:
        assert converter.parse_progress(line) is None


def test_a_run_reports_progress_and_keeps_the_log(fake, tmp_path):
    fake("ok")
    src, out = _work(tmp_path)
    seen: list[tuple[float, str]] = []
    result = converter.run_converter(
        src, out, progress=lambda f, m: seen.append((f, m)), check_cancelled=_never
    )
    assert (out / "done.txt").read_text("utf-8") == "ok"
    assert seen[-1] == (0.97, "building the 3D view copy: INDEXING 96 %")
    assert result.log_tail[-1] == "metadata & hierarchy: 7.890049s" and result.encoding == "BROTLI"
    assert result.command[-5:] == ["input.las", "-o", "octree", "--encoding", "BROTLI"]
    assert result.octree_dir == out and result.seconds > 0


def test_argv_is_relative_ascii_from_the_work_folder(fake, tmp_path):
    """Review Focus 1: the project path has spaces and non-ASCII characters."""
    record = tmp_path / "argv.json"
    fake("argv", FAKE_PC_ARGV=record)
    src, out = _work(tmp_path / "Chimney stack 3D — Kuwait" / "جديد", ".work")
    converter.run_converter(src, out, progress=lambda *_: None, check_cancelled=_never)
    got = json.loads(record.read_text("utf-8"))
    assert got["argv"] == ["input.las", "-o", "octree", "--encoding", "BROTLI"]
    assert Path(got["cwd"]) == src.parent


def test_nonzero_exit_is_a_readable_failure(fake, tmp_path):
    fake("fail")
    src, out = _work(tmp_path)
    with pytest.raises(JobFailure) as e:
        converter.run_converter(src, out, progress=lambda *_: None, check_cancelled=_never)
    assert str(e.value) == (
        "the point-cloud converter stopped: "
        "ERROR(chunker_countsort_laszip.cpp:248): encountered point outside bounding box."
    )
    assert isinstance(e.value, converter.ConverterStopped)
    assert e.value.log_tail[-1] == "PotreeConverter requires a valid bounding box to operate."


def test_cancel_kills_the_whole_tree(fake, tmp_path):
    pids_file = tmp_path / "pids.json"
    fake("sleep", FAKE_PC_PIDS=pids_file)
    src, out = _work(tmp_path)
    cancel = threading.Event()

    def check():
        if cancel.is_set():
            raise JobCancelled()

    errors: list[BaseException] = []
    t = threading.Thread(
        target=lambda: _capture(
            errors, lambda: converter.run_converter(src, out, progress=lambda *_: None, check_cancelled=check)
        )
    )
    t.start()
    deadline = time.time() + 20
    while not pids_file.exists() and time.time() < deadline:
        time.sleep(0.05)
    pids = json.loads(pids_file.read_text("utf-8"))
    cancel.set()
    t.join(15)
    assert errors and isinstance(errors[0], JobCancelled)
    deadline = time.time() + 5
    while any(_alive(p) for p in pids) and time.time() < deadline:
        time.sleep(0.1)
    assert not any(_alive(p) for p in pids)


def _capture(errors, fn):
    try:
        fn()
    except BaseException as e:  # noqa: BLE001 - the test inspects it
        errors.append(e)


def test_the_lock_serialises_two_imports(fake, tmp_path):
    times = tmp_path / "times.txt"
    fake("slow", FAKE_PC_TIMES=times)
    a = _work(tmp_path, "a")
    b = _work(tmp_path, "b")
    threads = [
        threading.Thread(
            target=converter.run_converter,
            args=w,
            kwargs={"progress": lambda *_: None, "check_cancelled": _never},
        )
        for w in (a, b)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    (s1, e1), (s2, e2) = sorted(
        tuple(map(float, line.split())) for line in times.read_text("utf-8").splitlines()
    )
    assert s2 >= e1


def test_a_waiting_import_can_be_cancelled(fake, tmp_path):
    record = tmp_path / "argv.json"
    fake("argv", FAKE_PC_ARGV=record)
    src, out = _work(tmp_path)
    messages: list[str] = []
    started = time.monotonic()

    def cancel_after_half_a_second():
        if time.monotonic() - started > 0.5:
            raise JobCancelled()

    converter._LOCK.acquire()
    try:
        with pytest.raises(JobCancelled):
            converter.run_converter(
                src, out, progress=lambda f, m: messages.append(m), check_cancelled=cancel_after_half_a_second
            )
    finally:
        converter._LOCK.release()
    assert messages == ["waiting for another point-cloud import"]
    assert not record.exists()


PARENT = """
import json, sys
sys.path.insert(0, {backend!r})
from pathlib import Path
from app.pointclouds import converter
converter._exe_prefix = lambda: [sys.executable, {fake!r}]
converter.run_converter(Path({src!r}), Path({out!r}), progress=lambda *a: None, check_cancelled=lambda: None)
"""


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object")
def test_killing_the_parent_kills_the_converter(tmp_path, backend_dir, monkeypatch):
    pids_file = tmp_path / "pids.json"
    src, out = _work(tmp_path)
    env = {**os.environ, "FAKE_PC_MODE": "sleep", "FAKE_PC_PIDS": str(pids_file)}
    code = PARENT.format(backend=str(backend_dir), fake=str(FAKE), src=str(src), out=str(out))
    parent = subprocess.Popen([sys.executable, "-c", code], cwd=backend_dir, env=env)
    deadline = time.time() + 30
    while not pids_file.exists() and time.time() < deadline:
        time.sleep(0.05)
    converter_pid, _grandchild = json.loads(pids_file.read_text("utf-8"))
    parent.kill()  # like a sidecar crash: no finally block runs
    parent.wait(10)
    deadline = time.time() + 5
    while _alive(converter_pid) and time.time() < deadline:
        time.sleep(0.1)
    assert not _alive(converter_pid)
