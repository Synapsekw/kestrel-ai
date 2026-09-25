"""The TIN rasteriser against closed forms (spec §15.1, §15.2, §16.1, §16.6)."""

import math
import tracemalloc

import numpy as np
import pytest
from designs import (
    CONE_CENTRE,
    E0,
    N0,
    cone_tin,
    cone_z,
    lattice_over,
    plane_z,
    pyramid_tin,
    pyramid_z,
    random_plane_tin,
    two_triangle_plane,
)
from rasterio.windows import Window
from scipy.interpolate import LinearNDInterpolator

from app.surfaces.design.rasterise import SimpleLattice, TinRasteriser, rasterise_to_array


def centres(lat):
    cols, rows = np.meshgrid(np.arange(lat.width), np.arange(lat.height))
    return lat.x0 + (cols + 0.5) * lat.cell_size, lat.y0 - (rows + 0.5) * lat.cell_size


def run_windows(v, t, lat, side):
    r = TinRasteriser(v, t, lat, side=side)
    out = np.full((lat.height, lat.width), np.nan, np.float32)
    for r0 in range(0, lat.height, side):
        for c0 in range(0, lat.width, side):
            w = Window(c0, r0, min(side, lat.width - c0), min(side, lat.height - r0))
            a = r.rasterise_window(w)
            if a is not None:
                out[r0 : r0 + w.height, c0 : c0 + w.width] = a
    return out, r.stats()


@pytest.mark.parametrize("tin", [two_triangle_plane, random_plane_tin])
def test_plane_is_exact_and_crack_free(tin):
    v, t = tin()
    lat = SimpleLattice(E0, N0 + 100, 1.0, 100, 100)
    out, stats = rasterise_to_array(v, t, lat)
    x, y = centres(lat)
    assert np.isfinite(out).all()  # every centre of the square is covered: no cracks on shared edges
    assert np.abs(out - plane_z(x, y)).max() < 1e-4
    assert stats.overlapping_triangles == 0


def test_pyramid_heights_and_volume():
    v, t = pyramid_tin()
    lat = lattice_over((E0, N0, E0 + 40, N0 + 40), 0.25)
    out, _ = rasterise_to_array(v, t, lat)
    x, y = centres(lat)
    ok = np.isfinite(out)
    assert np.abs(out[ok] - pyramid_z(x, y)[ok]).max() < 1e-4
    assert np.nansum(out) * 0.25**2 == pytest.approx(40 * 40 * 10 / 3, rel=0.005)


def test_cone_matches_linear_interpolation_and_closed_form():
    v, t, tri = cone_tin()
    lat = lattice_over(
        (CONE_CENTRE[0] - 40, CONE_CENTRE[1] - 40, CONE_CENTRE[0] + 40, CONE_CENTRE[1] + 40), 0.5
    )
    out, _ = rasterise_to_array(v, t, lat)
    x, y = centres(lat)
    oracle = LinearNDInterpolator(tri, v[:, 2])(x - CONE_CENTRE[0], y - CONE_CENTRE[1])
    both = np.isfinite(out) & np.isfinite(oracle)
    assert both.sum() > 0.7 * out.size
    assert np.abs(out[both] - oracle[both]).max() < 1e-4
    assert np.abs(out[both] - cone_z(x, y)[both]).max() < 0.05
    assert np.nansum(out) * 0.25 == pytest.approx(math.pi * 40**2 * 20 / 3, rel=0.01)


def test_a_triangle_across_nine_blocks_is_bit_identical_to_one_block():
    lat = SimpleLattice(E0, N0 + 192, 1.0, 192, 192)
    v = np.array([[E0 + 3, N0 + 2, 5.0], [E0 + 190, N0 + 30, 9.0], [E0 + 40, N0 + 189, 1.0]])
    t = np.array([[0, 1, 2]], np.int32)
    tiled, _ = run_windows(v, t, lat, 64)
    whole, _ = run_windows(v, t, lat, 192)
    assert np.array_equal(tiled, whole, equal_nan=True)
    assert np.isfinite(whole).sum() > 10_000


def test_many_triangles_across_uneven_blocks_leave_no_seams():
    v, t = random_plane_tin()
    lat = SimpleLattice(E0, N0 + 100, 0.5, 200, 200)
    tiled, _ = run_windows(v, t, lat, 64)  # 200 is not a multiple of 64: edge windows are narrower
    whole, _ = rasterise_to_array(v, t, lat)
    assert np.isfinite(tiled).all()
    np.testing.assert_allclose(tiled, whole, atol=1e-6)


def test_degenerate_and_sub_cell_triangles_are_counted_and_dropped():
    v, t = two_triangle_plane()
    extra = np.array(
        [
            [E0 + 10, N0 + 10, 1.0],
            [E0 + 20, N0 + 20, 1.0],
            [E0 + 30, N0 + 30, 1.0],  # collinear: degenerate
            [E0 + 50.1, N0 + 50.1, 1.0],
            [E0 + 50.2, N0 + 50.1, 1.0],
            [E0 + 50.1, N0 + 50.2, 1.0],  # between cell centres: covers none
        ]
    )
    v2 = np.vstack([v, extra])
    t2 = np.vstack([t, [[4, 5, 6], [7, 8, 9]]]).astype(np.int32)
    lat = SimpleLattice(E0, N0 + 100, 1.0, 100, 100)
    out, stats = rasterise_to_array(v2, t2, lat)
    assert stats.degenerate_triangles == 1 and stats.empty_triangles == 1
    x, y = centres(lat)
    assert np.abs(out - plane_z(x, y)).max() < 1e-4  # neither extra triangle wrote anything


def test_a_folded_tin_reports_overlapping_triangles():
    v, t = two_triangle_plane()
    lifted = v.copy()
    lifted[:, 2] += 1.0
    v2 = np.vstack([v, lifted])
    t2 = np.vstack([t, t + 4]).astype(np.int32)
    _, stats = rasterise_to_array(v2, t2, SimpleLattice(E0, N0 + 100, 1.0, 100, 100))
    assert stats.overlapping_triangles == 2


def test_a_window_off_the_block_lattice_is_refused():
    v, t = two_triangle_plane()
    r = TinRasteriser(v, t, SimpleLattice(E0, N0 + 100, 1.0, 100, 100), side=64)
    with pytest.raises(ValueError, match="not one of the 64-cell blocks"):
        r.rasterise_window(Window(10, 0, 64, 64))


def test_empty_windows_return_none():
    v, t = two_triangle_plane(size=10)
    r = TinRasteriser(v, t, SimpleLattice(E0, N0 + 100, 1.0, 128, 100), side=64)
    assert r.rasterise_window(Window(64, 0, 64, 64)) is None


def test_memory_of_a_million_triangles_stays_within_the_arrays_plus_150_mb():
    n = 708
    g = np.arange(n) * 2.0
    xx, yy = np.meshgrid(g + E0, g + N0)
    v = np.column_stack([xx.ravel(), yy.ravel(), plane_z(xx.ravel(), yy.ravel())])
    i = np.arange(n - 1)
    a = (i[:, None] * n + i[None, :]).ravel()
    t = np.vstack([np.column_stack([a, a + 1, a + n + 1]), np.column_stack([a, a + n + 1, a + n])]).astype(
        np.int32
    )
    assert len(t) > 999_000
    lat = lattice_over((E0, N0, E0 + g[-1], N0 + g[-1]), 1.0)
    tracemalloc.start()
    base = tracemalloc.get_traced_memory()[0]
    r = TinRasteriser(v, t, lat, side=512)
    for r0 in range(0, lat.height, 512):
        for c0 in range(0, lat.width, 512):
            r.rasterise_window(Window(c0, r0, min(512, lat.width - c0), min(512, lat.height - r0)))
    peak = tracemalloc.get_traced_memory()[1] - base
    tracemalloc.stop()
    assert peak < 150 * 2**20, f"peak {peak / 2**20:.0f} MB beyond the TIN arrays"


def test_check_cancelled_is_called_at_least_once_per_65536_triangles_while_indexing():
    """Pins RANGE_CHUNK specifically. Counts only the indexing pass (construction) and never
    calls rasterise_window, so a regression that doubles RANGE_CHUNK can't hide behind the
    window pass's BATCH-driven calls (as it did when this test first counted both phases:
    RANGE_CHUNK = 131_072 with this same fixture still cleared a from-both-phases floor)."""
    n = 264  # (n - 1) ** 2 * 2 triangles: ~138 k, comfortably > 2 * 65 536
    g = np.arange(n) * 2.0
    xx, yy = np.meshgrid(g + E0, g + N0)
    v = np.column_stack([xx.ravel(), yy.ravel(), plane_z(xx.ravel(), yy.ravel())])
    i = np.arange(n - 1)
    a = (i[:, None] * n + i[None, :]).ravel()
    t = np.vstack([np.column_stack([a, a + 1, a + n + 1]), np.column_stack([a, a + n + 1, a + n])]).astype(
        np.int32
    )
    assert len(t) > 2 * 65_536  # forces >= 3 indexing chunks at the shipped RANGE_CHUNK
    lat = lattice_over((E0, N0, E0 + g[-1], N0 + g[-1]), 1.0)
    calls = []
    TinRasteriser(v, t, lat, side=512, check_cancelled=lambda: calls.append(None))
    assert len(calls) >= math.ceil(len(t) / 65_536)
