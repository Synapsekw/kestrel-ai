"""Densify, dedupe, Delaunay and boundary peeling (spec §9.1, §15.1 cone contours, §15.2)."""

import threading
import time

import numpy as np
import psutil
import pytest
from designs import (
    CONE_CENTRE,
    E0,
    N0,
    cone_contour_runs,
    cone_z,
    crossing_runs,
    l_shape_points,
    lattice_over,
)
from scipy.spatial import Delaunay

from app.jobs.cancellation import JobFailure
from app.surfaces.design import triangulate as tr
from app.surfaces.design.rasterise import rasterise_to_array


def no_admit(*args, **kwargs):
    return None


def centroids(t):
    return t.vertices[t.triangles].mean(1) - [E0, N0, 0]


def test_densify_keeps_runs_apart_and_interpolates_z():
    pts = np.array([[0, 0, 0], [10, 0, 10], [100, 100, 3], [103, 100, 3]], float)
    out = tr.densify(pts, np.array([0, 2, 4]), 1.0)
    assert len(out) == 4 + 9 + 2
    mid = out[(out[:, 0] == 5.0) & (out[:, 1] == 0.0)]
    assert mid[0, 2] == pytest.approx(5.0)
    assert not ((out[:, 0] > 10) & (out[:, 0] < 100)).any()  # never bridges two runs


def test_dedupe_does_not_overflow_or_merge_a_distant_outlier():
    """A far outlier (e.g. an E/N-swapped vertex) must stay its own vertex: the old scalar key
    (kx * (ky.max() + 1) + ky) could overflow int64 and wrap two distant cells onto the same key,
    silently merging them — exactly the bad input S3 exists to catch."""
    near = np.array(
        [
            [E0, N0, 5.0],
            [E0 + 0.0001, N0, 5.0],  # within 1 mm of the point above: must merge with it
            [E0 + 10.0, N0, 6.0],  # 10 m away: must stay distinct
        ]
    )
    outlier = np.array([[5_000_000.0, 500_000.0, 9.0]])  # kilometres away, E/N magnitudes swapped
    xyz = np.vstack([near, outlier])
    out, duplicates = tr.dedupe(xyz)
    assert len(out) == 3
    assert duplicates == 0  # the merged pair's Z values agreed (both 5.0)
    assert np.any(np.all(np.isclose(out[:, :2], outlier[0, :2]), axis=1))
    assert np.any(np.all(np.isclose(out[:, :2], near[2, :2]), axis=1))


def test_crossing_contours_are_averaged_and_counted():
    pts, runs = crossing_runs()
    t = tr.triangulate(pts, runs, spacing=1.0, max_edge_m=0, auto_floor=5.0, admit=no_admit)
    at = t.vertices[(np.abs(t.vertices[:, 0] - (E0 + 5)) < 1e-6) & (np.abs(t.vertices[:, 1] - N0) < 1e-6)]
    assert len(at) == 1 and at[0, 2] == pytest.approx(6.0)
    assert t.duplicate_positions == 1


def test_collinear_points_are_nothing_to_triangulate():
    pts = np.column_stack([np.arange(10.0) + E0, np.arange(10.0) + N0, np.zeros(10)])
    with pytest.raises(tr.NothingToTriangulate, match="lie on a line"):
        tr.triangulate(pts, np.arange(11), spacing=1.0, max_edge_m=None, auto_floor=5.0, admit=no_admit)
    with pytest.raises(tr.NothingToTriangulate):
        tr.triangulate(pts[:2], np.arange(3), spacing=100.0, max_edge_m=None, auto_floor=5.0, admit=no_admit)


def test_peeling_removes_the_notch_and_keeps_the_enclosed_patch():
    pts, runs = l_shape_points()
    t = tr.triangulate(pts, runs, spacing=2.0, max_edge_m=None, auto_floor=10.0, admit=no_admit)
    assert t.max_edge_m == pytest.approx(10.0)  # 3 x P95 (about 4.2 m) is below the 10 x cell floor
    assert t.long_edges_removed > 0
    c = centroids(t)
    # Triangles with every edge <= L may still bridge the notch's inner corner (within ~L of it);
    # nothing reaches deeper into the notch. Every notch-boundary vertex lies on x=70 or y=70, so
    # `(cx > 80) & (cy > 80)` is geometrically unreachable regardless of peeling; the brief's bound
    # is replaced with a diagonal one (x, y > 70 and x + y > 160) that a bridge must actually cross
    # to reach past the notch's midpoint (controller ruling, verified against this fixture).
    assert not ((c[:, 0] > 70) & (c[:, 1] > 70) & (c[:, 0] + c[:, 1] > 160)).any()
    v = t.vertices[t.triangles]
    area = 0.5 * np.abs(
        (v[:, 1, 0] - v[:, 0, 0]) * (v[:, 2, 1] - v[:, 0, 1])
        - (v[:, 2, 0] - v[:, 0, 0]) * (v[:, 1, 1] - v[:, 0, 1])
    )
    inside = (c[:, 0] > 21) & (c[:, 0] < 44) & (c[:, 1] > 21) & (c[:, 1] < 44)
    assert area[inside].sum() > 500  # the 25 m sparse patch keeps its big triangles


def test_max_edge_zero_keeps_everything():
    pts, runs = l_shape_points()
    t = tr.triangulate(pts, runs, spacing=2.0, max_edge_m=0, auto_floor=10.0, admit=no_admit)
    assert t.long_edges_removed == 0
    c = centroids(t)
    # `(cx > 80) & (cy > 80)` is geometrically unreachable here (every notch-boundary vertex lies on
    # x=70 or y=70); replaced with the same diagonal bound as the peeling test (controller ruling,
    # verified against this fixture): without peeling, some triangle does bridge past the notch's
    # midpoint, unlike the peeled case above.
    assert ((c[:, 0] > 70) & (c[:, 1] > 70) & (c[:, 0] + c[:, 1] > 160)).any()


def test_admission_is_asked_for_the_qhull_estimate():
    pts, runs = l_shape_points(hole=False)
    seen = []
    tr.triangulate(
        pts, runs, spacing=2.0, max_edge_m=None, auto_floor=10.0, admit=lambda need, *a: seen.append(need)
    )
    assert seen == [tr.QHULL_BYTES_PER_POINT * len(pts)]

    def refuse(need, what, fix):
        raise JobFailure(fix)

    with pytest.raises(JobFailure, match="coarser cell"):
        tr.triangulate(pts, runs, spacing=2.0, max_edge_m=None, auto_floor=10.0, admit=refuse)


def test_cone_contours_match_the_cone_and_terrace_at_the_top():
    pts, runs = cone_contour_runs()
    t = tr.triangulate(pts, runs, spacing=1.0, max_edge_m=None, auto_floor=5.0, admit=no_admit)
    cx, cy = CONE_CENTRE
    lat = lattice_over((cx - 40, cy - 40, cx + 40, cy + 40), 0.5)
    out, _ = rasterise_to_array(t.vertices, t.triangles, lat)
    cols, rows = np.meshgrid(np.arange(lat.width), np.arange(lat.height))
    x, y = lat.x0 + (cols + 0.5) * 0.5, lat.y0 - (rows + 0.5) * 0.5
    r = np.hypot(x - cx, y - cy)
    ok = np.isfinite(out)
    outer = ok & (r >= 4) & (r <= 39)
    assert outer.sum() > 10_000
    assert np.abs(out[outer] - cone_z(x, y)[outer]).max() < 0.3
    top = ok & (r < 1.9)
    assert top.sum() > 30
    assert np.abs(out[top] - 19.0).max() < 1e-5  # the flat top-contour terrace (spec §9.1 caveat)


def test_qhull_bytes_per_point_holds_for_a_million_points():
    rng = np.random.default_rng(0)
    xy = rng.uniform(0, 1000, (1_000_000, 2))
    proc = psutil.Process()
    base = proc.memory_info().rss
    peak, done = [base], threading.Event()

    def sample():
        while not done.is_set():
            peak[0] = max(peak[0], proc.memory_info().rss)
            time.sleep(0.005)

    th = threading.Thread(target=sample)
    th.start()
    try:
        tri = Delaunay(xy - xy.mean(0), qhull_options="Qbb Qc Qz Q12")
    finally:
        done.set()
        th.join()
    assert len(tri.simplices) > 1_900_000
    per_point = (peak[0] - base) / 1_000_000
    assert per_point <= tr.QHULL_BYTES_PER_POINT, f"measured {per_point:.0f} B per point"
