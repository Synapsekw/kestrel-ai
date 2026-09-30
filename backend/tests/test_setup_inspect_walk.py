"""S1-U3 walk (spec §10 "The inspect walk stops at 50,000 files"): the cap, links and junctions,
vanishing folders, single files, duplicates. Files are empty: the walk opens none of them."""

import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.jobs.cancellation import JobCancelled
from app.setup import inspect_job
from app.setup.inspect_job import Skipped, walk


def touch(folder: Path, *names: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        (folder / name).write_bytes(b"")


def run_walk(*paths, check_cancelled=lambda: None):
    skipped = Skipped()
    walked = walk(
        [str(p) for p in paths], skipped, check_cancelled=check_cancelled, progress=lambda *a, **k: None
    )
    return walked, skipped


def names(walked) -> list[str]:
    return [e.path.name for entries in walked.folders.values() for e in entries]


def reasons(skipped) -> list[tuple[str, str]]:
    return [(s.name, s.reason) for s in skipped.samples]


def test_walks_depth_first_in_name_order_files_before_subfolders(tmp_path):
    touch(tmp_path / "b", "2.txt")
    touch(tmp_path / "a" / "deep", "3.txt")
    touch(tmp_path / "a", "1.txt")
    touch(tmp_path, "0.txt")
    walked, skipped = run_walk(tmp_path)
    assert names(walked) == ["0.txt", "1.txt", "3.txt", "2.txt"]
    assert list(walked.folders) == [tmp_path, tmp_path / "a", tmp_path / "a" / "deep", tmp_path / "b"]
    assert (walked.files, walked.truncated, skipped.count) == (4, False, 0)


def test_sizes_come_from_the_listing(tmp_path):
    (tmp_path / "a.tif").write_bytes(b"x" * 1234)
    walked, _ = run_walk(tmp_path)
    assert walked.folders[tmp_path][0].size == 1234


def test_the_file_cap_sets_truncated(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "MAX_FILES", 50)
    for d in range(3):
        touch(tmp_path / f"d{d}", *[f"{i:02d}.txt" for i in range(20)])
    walked, _ = run_walk(tmp_path)
    assert (walked.files, walked.truncated) == (50, True)


def test_exactly_the_cap_is_not_truncated(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "MAX_FILES", 50)
    touch(tmp_path, *[f"{i:02d}.txt" for i in range(50)])
    walked, _ = run_walk(tmp_path)
    assert (walked.files, walked.truncated) == (50, False)


def test_the_folder_cap_bounds_a_tree_of_empty_folders(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "MAX_FOLDERS", 5)
    for d in range(10):
        (tmp_path / f"empty{d}").mkdir()
    walked, _ = run_walk(tmp_path)
    assert (walked.folders_listed, walked.truncated) == (5, True)


class FakeEntry:
    """A DirEntry stand-in for a synthetic folder (no file on disk)."""

    def __init__(self, folder: str, name: str):
        self.name, self.path = name, os.path.join(folder, name)

    def is_dir(self, follow_symlinks=True):
        return False

    def is_file(self, follow_symlinks=True):
        return True

    def is_symlink(self):
        return False

    def stat(self, follow_symlinks=True):
        return SimpleNamespace(st_size=10, st_reparse_tag=0)


class FakeScandir:
    def __init__(self, entries):
        self.entries = entries

    def __enter__(self):
        return iter(self.entries)

    def __exit__(self, *exc):
        return False


def test_the_real_cap_on_a_synthetic_folder_of_50001_files(tmp_path, monkeypatch):
    """Real scale without 50,001 files on disk: the listing is fake, the cap and the islice are real."""
    listed = []

    def fake_scandir(folder):
        listed.append(folder)
        return FakeScandir([FakeEntry(str(folder), f"{i:05d}.txt") for i in range(50_001)])

    monkeypatch.setattr(inspect_job, "_scandir", fake_scandir)
    started = time.monotonic()
    walked, _ = run_walk(tmp_path)
    assert (walked.files, walked.truncated) == (50_000, True)
    assert names(walked)[-1] == "49999.txt"
    assert listed == [tmp_path]
    assert time.monotonic() - started < 20


def test_a_single_file_path_takes_only_that_file(tmp_path):
    """Review focus 3: a dropped file is sorted alone; its siblings are not pulled in."""
    touch(tmp_path, "ortho.tif", "other.tif", "DJI_0001_V.JPG")
    walked, _ = run_walk(tmp_path / "ortho.tif")
    assert walked.folders == {tmp_path: [inspect_job.FileEntry(tmp_path / "ortho.tif", 0)]}


def test_the_same_file_twice_counts_once(tmp_path):
    touch(tmp_path, "a.tif", "b.tif")
    walked, _ = run_walk(tmp_path, tmp_path / "a.tif")
    assert sorted(names(walked)) == ["a.tif", "b.tif"]


def test_nested_roots_walk_once(tmp_path):
    touch(tmp_path / "sub", "a.tif")
    walked, _ = run_walk(tmp_path, tmp_path / "sub")
    assert names(walked) == ["a.tif"]


def test_a_missing_path_is_reported_and_the_rest_is_walked(tmp_path):
    touch(tmp_path / "here", "a.tif")
    gone = tmp_path / "gone"
    walked, skipped = run_walk(gone, tmp_path / "here")
    assert names(walked) == ["a.tif"]
    assert reasons(skipped) == [(str(gone), inspect_job.NOT_FOUND)]


def test_a_relative_path_is_reported(tmp_path):
    skipped = Skipped()
    walk(["relative\\folder"], skipped, check_cancelled=lambda: None, progress=lambda *a, **k: None)
    assert reasons(skipped) == [("relative\\folder", inspect_job.NOT_ABSOLUTE)]


def test_a_folder_that_vanishes_mid_walk_is_reported_not_fatal(tmp_path, monkeypatch):
    """Review focus 4: a USB stick pulled while `B` is being listed."""
    touch(tmp_path / "A", "a.tif")
    touch(tmp_path / "B", "b.tif")
    touch(tmp_path / "C", "c.tif")
    real = inspect_job._scandir

    def flaky(folder):
        if Path(folder).name == "B":
            raise FileNotFoundError(2, "The system cannot find the path specified", str(folder))
        return real(folder)

    monkeypatch.setattr(inspect_job, "_scandir", flaky)
    walked, skipped = run_walk(tmp_path)
    assert names(walked) == ["a.tif", "c.tif"]
    assert reasons(skipped) == [(str(tmp_path / "B"), inspect_job.FOLDER_UNREADABLE)]
    assert walked.truncated is False


class StatFails:
    """A real DirEntry whose stat fails, as a file on a share that just dropped."""

    def __init__(self, entry):
        self._entry, self.name, self.path = entry, entry.name, entry.path

    def is_dir(self, follow_symlinks=True):
        return self._entry.is_dir(follow_symlinks=follow_symlinks)

    def is_file(self, follow_symlinks=True):
        return self._entry.is_file(follow_symlinks=follow_symlinks)

    def is_symlink(self):
        return self._entry.is_symlink()

    def stat(self, follow_symlinks=True):
        raise OSError(21, "The device is not ready", self.path)


def test_a_file_whose_stat_fails_is_reported(tmp_path, monkeypatch):
    touch(tmp_path, "a.tif", "b.tif")
    real = inspect_job._scandir

    class Wrapped:
        def __init__(self, folder):
            self._cm = real(folder)

        def __enter__(self):
            return (StatFails(e) if e.name == "b.tif" else e for e in self._cm.__enter__())

        def __exit__(self, *exc):
            return self._cm.__exit__(*exc)

    monkeypatch.setattr(inspect_job, "_scandir", Wrapped)
    walked, skipped = run_walk(tmp_path)
    assert names(walked) == ["a.tif"]
    assert reasons(skipped) == [("b.tif", inspect_job.FILE_UNREADABLE)]


@pytest.mark.skipif(sys.platform != "win32", reason="junctions are a Windows feature")
def test_a_junction_loop_is_walked_once(tmp_path):
    """Review focus 5: `loop` is a junction back to its own parent."""
    import _winapi

    touch(tmp_path / "site", "a.tif")
    loop = tmp_path / "site" / "loop"
    _winapi.CreateJunction(str(tmp_path / "site"), str(loop))
    try:
        walked, skipped = run_walk(tmp_path)
        assert names(walked) == ["a.tif"]
        assert reasons(skipped) == [("loop", inspect_job.LINK_SKIPPED)]
    finally:
        os.rmdir(loop)  # removes the junction itself, never its target


@pytest.mark.skipif(sys.platform != "win32", reason="junctions are a Windows feature")
def test_the_identity_guard_stops_a_loop_even_if_followed(tmp_path, monkeypatch):
    """Belt and braces: were links followed, the (device, file id) check still ends the loop."""
    import _winapi

    touch(tmp_path / "site", "a.tif")
    loop = tmp_path / "site" / "loop"
    _winapi.CreateJunction(str(tmp_path / "site"), str(loop))
    monkeypatch.setattr(inspect_job, "_is_link", lambda entry: False)
    try:
        walked, _ = run_walk(tmp_path)
        assert names(walked) == ["a.tif"]
    finally:
        os.rmdir(loop)


def test_a_symlink_loop_is_not_followed(tmp_path):
    touch(tmp_path / "site", "a.tif")
    link = tmp_path / "site" / "up"
    try:
        os.symlink(tmp_path, link, target_is_directory=True)
    except OSError:
        pytest.skip("creating a symbolic link needs Developer Mode or elevation on this machine")
    try:
        walked, skipped = run_walk(tmp_path)
        assert names(walked) == ["a.tif"]
        assert reasons(skipped) == [("up", inspect_job.LINK_SKIPPED)]
    finally:
        link.unlink()


def test_system_folders_of_a_usb_root_are_skipped_silently(tmp_path):
    touch(tmp_path / "System Volume Information", "IndexerVolumeGuid")
    touch(tmp_path / "$RECYCLE.BIN", "desktop.ini")
    touch(tmp_path / "DCIM", "DJI_0001_V.JPG")
    walked, skipped = run_walk(tmp_path)
    assert (names(walked), skipped.count) == (["DJI_0001_V.JPG"], 0)


def test_cancel_is_checked_per_folder(tmp_path):
    touch(tmp_path / "a", "1.txt")
    touch(tmp_path / "b", "2.txt")
    calls = []

    def check():
        calls.append(1)
        if len(calls) >= 2:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        run_walk(tmp_path, check_cancelled=check)


def test_not_recognised_samples_are_capped(monkeypatch):
    monkeypatch.setattr(inspect_job, "MAX_NOT_RECOGNISED", 3)
    skipped = Skipped()
    for i in range(10):
        skipped.add(f"f{i}", "unknown type")
    out = skipped.out()
    assert (out.count, [s.name for s in out.samples]) == (10, ["f0", "f1", "f2"])


def test_throttled_progress_never_goes_back_and_force_always_reports(monkeypatch):
    monkeypatch.setattr(inspect_job, "PROGRESS_INTERVAL_S", 3600)
    seen = []
    report = inspect_job.ThrottledProgress(lambda f, m: seen.append((f, m)))
    report(0.2, "a")
    report(0.1, "b")  # throttled, and lower: ignored
    report(0.5, "c")  # throttled
    report(1.0, "done", force=True)
    assert seen == [(0.2, "a"), (1.0, "done")]


@pytest.mark.perf
def test_a_real_tree_of_50001_empty_files_stops_at_the_cap(tmp_path):
    """Spec §12 at full scale on disk (run with -m perf): 51 folders, 50,001 empty files."""
    for d in range(51):
        touch(tmp_path / f"d{d:02d}", *[f"f{i:04d}.txt" for i in range(1000 if d < 50 else 1)])
    started = time.monotonic()
    walked, _ = run_walk(tmp_path)
    assert (walked.files, walked.truncated) == (50_000, True)
    assert time.monotonic() - started < 60
