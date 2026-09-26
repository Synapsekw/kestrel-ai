"""Toe bases from the polygon edge (spec 2026-09-23-volumes §6.3, §7.2)."""

import math

import numpy as np
import pytest
from shapely.geometry import box
from surfaces import CX, CY, X0, Y1, circle, fixture_spec, plane, write_surface

from app.surfaces.grid import open_surface
from app.volumes.bases import (
    MAX_EDGE_SAMPLES,
    BaseFitError,
    EdgeSamples,
    densify_ring,
    fit_toe_plane,
    fit_toe_surface,
    flat_fit,
    robust_plane,
    sample_edge,
)


def _edge(xs, ys, zs) -> EdgeSamples:
    return EdgeSamples(np.asarray(xs), np.asarray(ys), np.asarray(zs), len(xs), 0.0)


def test_densify_ring_steps_one_cell_and_caps_the_count():
    ring = circle(CX, CY, 12.0)
    xs, ys, perimeter = densify_ring(ring, 0.1)
    assert perimeter == pytest.approx(2 * math.pi * 12, rel=1e-3)
    assert xs.size == pytest.approx(perimeter / 0.1, abs=1)
    assert np.hypot(xs - CX, ys - CY).min() > 11.99
    xs, _, _ = densify_ring(ring, 0.0001)
    assert xs.size <= MAX_EDGE_SAMPLES
    closed = ring + [ring[0]]
    assert densify_ring(closed, 0.1)[0].size == densify_ring(ring, 0.1)[0].size


def test_densify_ring_does_not_drop_an_unclosed_vertex_at_utm_scale():
    # Northing ~5e6: np.allclose's default relative tolerance (1e-5) treats an unclosed vertex a
    # few metres from the first as "closed" and drops it — the fix must use an absolute tolerance.
    ring = [
        [500000, 5_000_000],
        [500100, 5_000_000],
        [500100, 5_000_100],
        [500000, 5_000_100],
        [500003, 5_000_030],  # ~30 m from the first vertex: not closed
    ]
    _, _, perimeter = densify_ring(ring, 0.5)
    assert perimeter == pytest.approx(400.214, abs=1e-2)
    closed_ring = ring + [ring[0]]
    _, _, closed_perimeter = densify_ring(closed_ring, 0.5)
    assert closed_perimeter == pytest.approx(perimeter, abs=1e-9)


@pytest.mark.parametrize("pattern", ["spread", "arc"])
def test_toe_plane_recovers_the_plane_with_ten_percent_pushed(pattern):
    xs, ys, _ = densify_ring(circle(CX, CY, 12.0), 0.1)
    zs = plane(xs, ys)
    pushed = np.arange(0, xs.size, 10) if pattern == "spread" else np.arange(xs.size // 10)
    zs[pushed] += 0.8  # a pile bleeding over the edge
    fitted, fit = fit_toe_plane(_edge(xs, ys, zs))
    assert fitted.a == pytest.approx(0.02, abs=1e-4) and fitted.b == pytest.approx(-0.013, abs=1e-4)
    want_c = plane(np.array([fitted.cx]), np.array([fitted.cy]))[0]
    assert fitted.c == pytest.approx(want_c, abs=0.005)
    assert fit.rejected == pushed.size and fit.samples == xs.size and fit.rms_m < 1e-6


def test_toe_plane_refuses_a_straight_or_short_edge():
    ring = [[X0, Y1 - 10], [X0 + 50, Y1 - 10], [X0 + 50, Y1 - 10.2], [X0, Y1 - 10.2]]
    xs, ys, _ = densify_ring(ring, 0.1)
    with pytest.raises(BaseFitError, match="too straight"):
        fit_toe_plane(_edge(xs, ys, plane(xs, ys)))
    with pytest.raises(BaseFitError, match="too straight"):
        robust_plane(xs[:5], ys[:5], plane(xs[:5], ys[:5]))


def test_toe_surface_is_exact_on_a_plane_and_falls_back_outside_the_hull():
    xs, ys, _ = densify_ring(circle(CX, CY, 12.0), 0.1)
    model, fit = fit_toe_surface(_edge(xs, ys, plane(xs, ys)))
    rng = np.random.default_rng(1)
    px, py = CX + rng.uniform(-8, 8, 200), CY + rng.uniform(-8, 8, 200)
    assert np.abs(model.z_at(px, py) - plane(px, py)).max() < 1e-6
    far = model.z_at(np.array([CX + 30.0]), np.array([CY]))
    assert far[0] == pytest.approx(plane(np.array([CX + 30.0]), np.array([CY]))[0], abs=1e-6)
    assert fit.kind == "toe_surface" and fit.rms_m < 1e-3 and fit.plane is None


def test_toe_surface_follows_a_hillside_toe_better_than_a_plane():
    xs, ys, _ = densify_ring(circle(CX, CY, 12.0), 0.1)

    def hill(x, y):
        return plane(x, y) + 0.004 * (x - CX) ** 2  # a toe that curves across the pile

    edge = _edge(xs, ys, hill(xs, ys))
    tin, _ = fit_toe_surface(edge)
    flat_plane, plane_fit = fit_toe_plane(edge)
    px, py = np.array([CX, CX + 6]), np.array([CY, CY - 3])
    assert (
        np.abs(tin.z_at(px, py) - hill(px, py)).max() < np.abs(flat_plane.z_at(px, py) - hill(px, py)).max()
    )
    assert plane_fit.rms_m > 0.1  # base_fit_poor territory for the plane


def test_sample_edge_drops_nodata_and_masked_samples(tmp_path):
    spec = fixture_spec(0.1)

    def west_missing(xs, ys):
        z = plane(xs, ys)
        z[xs < CX - 12 + 7.2] = np.nan  # the western strip: about a quarter of the ring
        return z

    write_surface(tmp_path / "s.tif", spec, west_missing)
    ring = circle(CX, CY, 12.0)
    with open_surface(tmp_path / "s.tif") as top:
        edge = sample_edge(top, ring)
        assert 0.5 < edge.usable_fraction < 0.8
        blocked = box(CX, CY - 20, CX + 20, CY + 20)  # the whole east half
        with pytest.raises(BaseFitError, match="m of missing or masked ground"):
            sample_edge(top, ring, blocked)
        info = sample_edge(top, ring, blocked, require=False)
        assert info.usable_fraction < 0.5
    fit = flat_fit(edge, 50.0)
    assert fit.kind == "flat" and fit.rejected == 0 and fit.rms_m > 0
