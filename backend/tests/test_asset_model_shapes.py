# backend/tests/test_asset_model_shapes.py
"""Shape builders: bounds and volumes against hand-computed values (spec §6.2)."""

import math

import pytest

from app.asset_models import spec as s
from app.asset_models.shapes import build_shape, head_height, head_surface_y, segments_for

REL = 0.01  # tessellation keeps volumes within 1 %


def vol_annulus(ri, ro, h, sweep=360):
    return math.pi * (ro**2 - ri**2) * h * sweep / 360


def test_cylinder_shell_volume_and_bounds():
    m = build_shape("cylinder", s.CylinderParams(id=4000, thickness=8, height=3000))
    assert m.is_watertight
    assert m.volume == pytest.approx(vol_annulus(2000, 2008, 3000), rel=REL)
    lo, hi = m.bounds
    assert lo[1] == pytest.approx(0) and hi[1] == pytest.approx(3000)
    assert hi[0] == pytest.approx(2008, rel=1e-3)


def test_partial_sweep_halves_the_volume():
    full = build_shape("cylinder", s.CylinderParams(id=1000, thickness=10, height=100))
    half = build_shape("cylinder", s.CylinderParams(id=1000, thickness=10, height=100, sweep_deg=180))
    assert half.volume == pytest.approx(full.volume / 2, rel=REL)


def test_cone_frustum_volume():
    m = build_shape("cone", s.ConeParams(d_bottom=2000, d_top=1000, thickness=10, height=1000))

    # outer frustum minus inner frustum, inner radii reduced by the wall thickness
    def frustum(r1, r2, h):
        return math.pi * h * (r1**2 + r1 * r2 + r2**2) / 3

    expected = frustum(1000, 500, 1000) - frustum(990, 490, 1000)
    assert m.volume == pytest.approx(expected, rel=0.03)


def test_torispherical_head_height_matches_hcl_tank():
    p = s.TorisphericalParams(id=4000, thickness=8, crown_r=4000, knuckle_r=400)
    # crown centre 3224.9 mm below the tangent line -> crown height R - 3224.9 = 775.1 mm
    assert head_height(p) == pytest.approx(775.1, abs=0.5)
    m = build_shape("head_torispherical", p)
    assert m.is_watertight
    assert m.bounds[1][1] == pytest.approx(775.1 + 8, abs=2)
    assert head_surface_y(p, 0) == pytest.approx(775.1 + 8, abs=1)
    assert head_surface_y(p, 2008) == pytest.approx(0, abs=1)


def test_head_facing_down_mirrors():
    up = build_shape("head_ellipsoidal", s.EllipsoidalParams(id=2000, thickness=10))
    down = build_shape("head_ellipsoidal", s.EllipsoidalParams(id=2000, thickness=10, facing="down"))
    assert down.bounds[0][1] == pytest.approx(-up.bounds[1][1], abs=1e-6)
    assert down.volume == pytest.approx(up.volume, rel=1e-6)


def test_ellipsoidal_2_to_1_height_is_quarter_diameter():
    assert head_height(s.EllipsoidalParams(id=2000, thickness=10)) == pytest.approx(500)


def test_hemispherical_volume():
    m = build_shape("head_hemispherical", s.HemisphericalParams(id=1000, thickness=10))
    expected = 2 / 3 * math.pi * (510**3 - 500**3)
    assert m.volume == pytest.approx(expected, rel=REL)


def test_flat_plate_round_and_sloped():
    flat = build_shape("flat_plate", s.FlatPlateParams(d=4116, thickness=10))
    assert flat.volume == pytest.approx(math.pi * 2058**2 * 10, rel=REL)
    cone_up = build_shape("flat_plate", s.FlatPlateParams(d=4116, thickness=10, slope=120))
    assert cone_up.bounds[1][1] == pytest.approx(2058 / 120 + 10, abs=0.5)


def test_box_is_centred_on_axis_with_base_at_zero():
    m = build_shape("box", s.BoxParams(w=200, l=400, h=100))
    assert m.volume == pytest.approx(200 * 400 * 100)
    lo, hi = m.bounds
    assert lo.tolist() == pytest.approx([-100, 0, -200]) and hi.tolist() == pytest.approx([100, 100, 200])


def test_nozzle_runs_along_y_with_flange_at_the_end():
    m = build_shape("nozzle", s.NozzleParams(dn=50, od=60.3, projection=200, flange_od=165, flange_t=20))
    lo, hi = m.bounds
    assert lo[1] == pytest.approx(0) and hi[1] == pytest.approx(200)
    assert hi[0] == pytest.approx(82.5, rel=1e-2)


def test_pipe_run_spans_its_points():
    m = build_shape("pipe_run", s.PipeRunParams(od=84, points_mm=[[0, 0, 0], [0, 7000, 0], [500, 7000, 0]]))
    lo, hi = m.bounds
    assert hi[1] == pytest.approx(7042, abs=1)
    assert hi[0] == pytest.approx(542, abs=1)


def test_lathe_and_extrusion_and_sweep():
    lathe = build_shape("lathe", s.LatheParams(profile_mm=[[0, 0], [100, 0], [100, 50], [0, 50]]))
    assert lathe.volume == pytest.approx(math.pi * 100**2 * 50, rel=REL)
    ext = build_shape(
        "extrusion", s.ExtrusionParams(outline_mm=[[0, 0], [100, 0], [100, 10], [0, 10]], height=500)
    )
    assert ext.volume == pytest.approx(100 * 10 * 500)
    assert ext.bounds[1][1] == pytest.approx(500)
    sw = build_shape("sweep", s.SweepParams(section="circle", r=10, path_mm=[[0, 0, 0], [0, 0, 1000]]))
    assert sw.volume == pytest.approx(math.pi * 100 * 1000, rel=0.02)


def test_segment_count_follows_chord_tolerance():
    assert segments_for(5) == 16
    assert segments_for(2000) > segments_for(200)
    assert segments_for(1e6) == 256
