"""Stable-area alignment (spec 2026-09-23-volumes §6.7, tests in §13)."""

import numpy as np
import pytest
from shapely.geometry import box
from surfaces import EPSG, WKT

from app.surfaces.grid import GridSpec
from app.volumes.alignment import alignment_warnings, measure_alignment

SPEC = GridSpec(WKT, EPSG, 0.5, 500000.0, 3300000.0, 260, 60)  # 130 x 30 m
STRIP = [
    [500005.0, 3299990.0],
    [500115.0, 3299990.0],
    [500115.0, 3299975.0],
    [500005.0, 3299975.0],
]  # 110 x 15 m


def _run(d_fn, ring=STRIP, blocked=None, base_nan=None):
    def top(win):
        xs, ys = SPEC.cell_centres(win)
        return 10.0 + d_fn(xs, ys)

    def base(win):
        xs, _ = SPEC.cell_centres(win)
        b = np.full(xs.shape, 10.0)
        if base_nan is not None:
            b[base_nan(*SPEC.cell_centres(win))] = np.nan
        return b

    return measure_alignment(SPEC, top, base, ring, blocked)


def _codes(stats, apply_shift=False):
    return {w["code"] for w in alignment_warnings(stats, has_stable=True, apply_shift=apply_shift)}


def test_pure_shift_is_measured_exactly_and_is_not_a_tilt():
    stats = _run(lambda xs, ys: np.full(xs.shape, 0.07))
    assert stats.median_dz == pytest.approx(0.07) and stats.mad == 0.0 and stats.sigma == 0.0
    assert stats.tilt_mm_per_m < 1e-6 and stats.span_m == pytest.approx(np.hypot(109.5, 14.5), abs=0.5)
    assert stats.n_cells == 220 * 30
    assert _codes(stats) == {"alignment_offset"}
    assert _codes(stats, apply_shift=True) == set()


@pytest.mark.parametrize(("offset", "fires"), [(0.029, False), (0.031, True)])
def test_offset_threshold(offset, fires):
    assert ("alignment_offset" in _codes(_run(lambda xs, ys: np.full(xs.shape, offset)))) is fires


@pytest.mark.parametrize(("offset", "fires"), [(1.9, False), (2.1, True)])
def test_datum_threshold(offset, fires):
    stats = _run(lambda xs, ys: np.full(xs.shape, offset))
    assert ("alignment_datum" in _codes(stats, apply_shift=True)) is fires


@pytest.mark.parametrize(("amplitude", "fires"), [(0.033, False), (0.0345, True)])
def test_noisy_threshold(amplitude, fires):
    def checker(xs, ys):
        col = np.rint((xs - 500000.25) / 0.5).astype(int)
        return np.where(col % 2 == 0, amplitude, -amplitude)

    stats = _run(checker)
    assert stats.sigma == pytest.approx(1.4826 * amplitude)
    assert ("alignment_noisy" in _codes(stats)) is fires


@pytest.mark.parametrize(("mm_per_m", "fires"), [(0.4, False), (0.6, True)])
def test_tilt_over_a_hundred_metres(mm_per_m, fires):
    stats = _run(lambda xs, ys: mm_per_m / 1000.0 * (xs - 500060.0))
    assert stats.tilt_mm_per_m == pytest.approx(mm_per_m, rel=1e-3)
    assert ("alignment_tilt" in _codes(stats, apply_shift=True)) is fires


def test_small_or_blocked_stable_area_gives_no_statistics():
    tiny = [[500005.0, 3299990.0], [500010.0, 3299990.0], [500010.0, 3299985.0], [500005.0, 3299985.0]]
    assert _run(lambda xs, ys: xs * 0, ring=tiny) is None
    assert _run(lambda xs, ys: xs * 0, blocked=box(500000.0, 3299970.0, 500130.0, 3300000.0)) is None
    assert _run(lambda xs, ys: xs * 0, base_nan=lambda xs, ys: xs > 500010.0) is None
    assert _codes(None) == {"stable_area_small"}
    no_polygon = alignment_warnings(None, has_stable=False, apply_shift=False)
    assert [w["code"] for w in no_polygon] == ["no_stable_area"]
