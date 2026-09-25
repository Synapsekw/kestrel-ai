"""Validation of the converter's output (spec §6.8): each defect fails readably."""

import json

import pytest

from app.jobs.cancellation import JobFailure
from app.pointclouds.validate import validate_octree

BOUNDS = [0.0, 0.0, 0.0, 10.0, 10.0, 5.0]


def _octree(tmp_path, **meta_overrides):
    d = tmp_path / "octree"
    d.mkdir()
    meta = {
        "version": "2.0",
        "encoding": "BROTLI",
        "points": 1000,
        "spacing": 0.5,
        "boundingBox": {"min": [-0.001, -0.001, -0.001], "max": [10.001, 10.001, 10.001]},
        "hierarchy": {"firstChunkSize": 22, "stepSize": 4, "depth": 1},
    }
    meta.update(meta_overrides)
    (d / "metadata.json").write_text(json.dumps(meta), "utf-8")
    (d / "hierarchy.bin").write_bytes(b"\0" * 22)
    (d / "octree.bin").write_bytes(b"\0" * 100)
    return d


def test_a_good_octree_passes(tmp_path):
    assert validate_octree(_octree(tmp_path), points=1000, bounds=BOUNDS, encoding="BROTLI")["spacing"] == 0.5


@pytest.mark.parametrize(
    ("override", "fragment"),
    [
        ({"points": 999}, "999 points, expected 1000"),
        ({"encoding": "DEFAULT"}, "encoding 'DEFAULT', expected 'BROTLI'"),
        ({"version": "1.8"}, "version '1.8', expected '2.0'"),
        ({"spacing": 0}, "spacing 0"),
        ({"boundingBox": {"min": [0, 0, 0], "max": [9, 10, 10]}}, "bounding box does not contain the cloud"),
    ],
)
def test_each_defect_fails_readably(tmp_path, override, fragment):
    with pytest.raises(JobFailure) as e:
        validate_octree(_octree(tmp_path, **override), points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert str(e.value).startswith("the 3D view copy failed its checks: ") and fragment in str(e.value)


@pytest.mark.parametrize("name", ["metadata.json", "hierarchy.bin", "octree.bin"])
def test_missing_files_fail(tmp_path, name):
    d = _octree(tmp_path)
    (d / name).unlink()
    with pytest.raises(JobFailure) as e:
        validate_octree(d, points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert name in str(e.value)


def test_short_hierarchy_fails(tmp_path):
    d = _octree(tmp_path)
    (d / "hierarchy.bin").write_bytes(b"\0" * 10)
    with pytest.raises(JobFailure) as e:
        validate_octree(d, points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert "hierarchy.bin is 10 bytes, shorter than its first chunk (22)" in str(e.value)


def test_top_level_list_fails_readably(tmp_path):
    """A parseable but non-object metadata.json must not raise AttributeError."""
    d = tmp_path / "octree"
    d.mkdir()
    (d / "metadata.json").write_text(json.dumps([1, 2, 3]), "utf-8")
    (d / "hierarchy.bin").write_bytes(b"\0" * 22)
    (d / "octree.bin").write_bytes(b"\0" * 100)
    with pytest.raises(JobFailure) as e:
        validate_octree(d, points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert str(e.value).startswith("the 3D view copy failed its checks: ")


@pytest.mark.parametrize(
    ("override", "fragment"),
    [
        # boundingBox.min with fewer than 3 entries: must not raise IndexError.
        ({"boundingBox": {"min": [0, 0], "max": [10, 10, 5]}}, "bounding box does not contain the cloud"),
        # non-numeric coordinates: must not raise TypeError comparing str to float.
        (
            {"boundingBox": {"min": ["a", 0, 0], "max": [10, 10, 5]}},
            "bounding box does not contain the cloud",
        ),
        # non-numeric firstChunkSize: must not raise ValueError/TypeError from int(...).
        (
            {"hierarchy": {"firstChunkSize": "not-a-number"}},
            "firstChunkSize is missing or not a positive number ('not-a-number')",
        ),
        # firstChunkSize <= 0 gets its own message, not "shorter than its first chunk (0)".
        ({"hierarchy": {"firstChunkSize": 0}}, "firstChunkSize is missing or not a positive number (0)"),
        # firstChunkSize missing entirely.
        ({"hierarchy": {}}, "firstChunkSize is missing or not a positive number (None)"),
    ],
)
def test_malformed_but_parseable_metadata_fails_readably(tmp_path, override, fragment):
    with pytest.raises(JobFailure) as e:
        validate_octree(_octree(tmp_path, **override), points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert str(e.value).startswith("the 3D view copy failed its checks: ") and fragment in str(e.value)
