"""Run files and the 64 x 64 bucket index (spec §8.1 storage, §15 "the bucket index returns exactly
the runs crossing a box (property test against brute force)"; plan Task 9)."""

import shutil

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from PIL import Image

from app.drawings import runs


def _write(folder, polylines, layers=None):
    w = runs.RunWriter(folder)
    for i, pl in enumerate(polylines):
        w.add(pl, 0 if layers is None else layers[i])
    return w.close()


def test_writer_round_trip_skips_short_and_non_finite_runs(tmp_path):
    meta = _write(
        tmp_path / "r",
        [[(0, 0), (1, 1)], [(5, 5)], [(0, 0), (np.nan, 1)], [(2, 2), (3, 0), (4, 4)]],
        [0, 0, 1, 1],
    )
    assert (meta["runs"], meta["vertices"]) == (2, 5) and meta["extent"] == [0.0, 0.0, 4.0, 4.0]
    rs = runs.RunStore.open(tmp_path / "r")
    assert list(rs.runs) == [0, 2, 5] and list(rs.layer) == [0, 1]
    assert rs.lines[2:5].tolist() == [[2, 2], [3, 0], [4, 4]]
    rs.release()


def test_copy_runs_filters_and_renumbers_layers(tmp_path):
    _write(tmp_path / "a", [[(0, 0), (1, 0)], [(0, 1), (1, 1)], [(0, 2), (1, 2)]], [0, 1, 2])
    meta = runs.copy_runs(
        tmp_path / "a", tmp_path / "b", np.array([-1, 0, 1], np.int32), check_cancelled=lambda: None
    )
    rs = runs.RunStore.open(tmp_path / "b")
    assert meta["runs"] == 2 and list(rs.layer) == [0, 1] and rs.lines[:, 1].tolist() == [1, 1, 2, 2]
    rs.release()


def _brute(bboxes, box):
    x0, y0, x1, y1 = box
    hit = (bboxes[:, 0] <= x1) & (bboxes[:, 2] >= x0) & (bboxes[:, 1] <= y1) & (bboxes[:, 3] >= y0)
    return np.flatnonzero(hit)


coord = st.floats(min_value=-500, max_value=1500, allow_nan=False, width=32)
polyline = st.lists(st.tuples(coord, coord), min_size=2, max_size=5)
box = st.tuples(coord, coord, coord, coord).map(
    lambda b: (min(b[0], b[2]), min(b[1], b[3]), max(b[0], b[2]), max(b[1], b[3]))
)


@settings(max_examples=60, deadline=None)
@given(st.lists(polyline, min_size=1, max_size=150), st.lists(box, min_size=1, max_size=8))
def test_the_index_returns_exactly_the_runs_whose_bbox_meets_the_box(tmp_path_factory, polylines, boxes):
    folder = tmp_path_factory.mktemp("idx")
    _write(folder, polylines)
    runs.build_index(folder)
    idx = runs.BucketIndex(folder)
    bboxes = np.array(
        [
            [min(p[0] for p in pl), min(p[1] for p in pl), max(p[0] for p in pl), max(p[1] for p in pl)]
            for pl in polylines
        ],
        float,
    )
    for b in boxes:
        assert idx.query(b).tolist() == _brute(bboxes, b).tolist()
    idx.release()


def test_a_degenerate_extent_still_indexes(tmp_path):
    _write(tmp_path / "v", [[(5, 0), (5, 10)], [(5, 20), (5, 30)]])
    runs.build_index(tmp_path / "v")
    idx = runs.BucketIndex(tmp_path / "v")
    assert idx.query((0, 15, 10, 35)).tolist() == [1] and idx.query((6, 0, 9, 40)).tolist() == []
    idx.release()


def test_thumbnail(tmp_path):
    _write(tmp_path / "t", [[(0, 0), (100, 50)], [(0, 50), (100, 0)]])
    runs.runs_thumbnail(tmp_path / "t", tmp_path / "t" / "thumb.png")
    im = Image.open(tmp_path / "t" / "thumb.png")
    assert max(im.size) == 160 and np.asarray(im)[..., 3].any()


def test_extent_with_labels():
    assert runs.extent_with_labels(None, [{"x": 1, "y": 2}, {"x": -1, "y": 5}]) == [-1.0, 2.0, 1.0, 5.0]
    assert runs.extent_with_labels([0, 0, 1, 1], [{"x": 3, "y": -2}]) == [0.0, -2.0, 3.0, 1.0]
    assert runs.extent_with_labels(None, []) is None


def test_bucket_index_release_allows_windows_delete(tmp_path):
    """F9: offsets must be a real copy, not a memmap view; release() must drop every memmap so the
    folder can be deleted (shutil.rmtree) right after, which fails on Windows if any file is still
    mapped."""
    folder = tmp_path / "w"
    _write(folder, [[(0, 0), (1, 1)], [(2, 2), (3, 3)]])
    runs.build_index(folder)
    idx = runs.BucketIndex(folder)
    assert idx.query((0, 0, 1, 1)).tolist() == [0]
    idx.release()
    assert idx.offsets is None
    shutil.rmtree(folder)


class _Stop(Exception):
    pass


def _cancel_on(n):
    calls = []

    def check():
        calls.append(1)
        if len(calls) == n:
            raise _Stop()

    return check


@pytest.mark.parametrize("call", [1, 2, 3])
def test_a_cancelled_index_leaves_the_folder_deletable(tmp_path, call):
    """Fix round 1: a cancel inside build_index must drop every memmap even while the exception (and
    its traceback) is still alive, so the job's cleanup can remove the folder on Windows."""
    folder = tmp_path / "c"
    _write(folder, [[(0, 0), (1, 1)], [(2, 2), (3, 3)], [(0, 3), (3, 0)]])
    with pytest.raises(_Stop) as caught:
        runs.build_index(folder, check_cancelled=_cancel_on(call))
    assert caught.value.__traceback__ is not None
    shutil.rmtree(folder)
    assert not folder.exists()


def test_a_cancelled_copy_leaves_both_folders_deletable(tmp_path):
    _write(tmp_path / "a", [[(0, 0), (1, 0)], [(0, 1), (1, 1)]], [0, 1])
    with pytest.raises(_Stop) as caught:
        runs.copy_runs(
            tmp_path / "a", tmp_path / "b", np.array([0, 1], np.int32), check_cancelled=_cancel_on(1)
        )
    assert caught.value.__traceback__ is not None
    shutil.rmtree(tmp_path / "a")
    shutil.rmtree(tmp_path / "b")


def test_copy_runs_releases_the_source_when_the_writer_cannot_start(tmp_path):
    _write(tmp_path / "a", [[(0, 0), (1, 0)]])
    with pytest.raises(FileNotFoundError):
        runs.copy_runs(
            tmp_path / "a", tmp_path / "missing" / "b", np.array([0], np.int32), check_cancelled=lambda: None
        )
    shutil.rmtree(tmp_path / "a")


def test_copy_and_index_report_progress(tmp_path):
    _write(tmp_path / "a", [[(0, 0), (1, 0)], [(0, 1), (1, 1)]], [0, 0])
    seen = []
    runs.copy_runs(
        tmp_path / "a",
        tmp_path / "b",
        np.array([0], np.int32),
        check_cancelled=lambda: None,
        progress=seen.append,
    )
    assert seen and seen[-1] == 1.0
    seen.clear()
    runs.build_index(tmp_path / "b", progress=seen.append)
    assert seen and seen == sorted(seen) and seen[-1] == 1.0
