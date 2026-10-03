# backend/tests/test_asset_review_frame_io.py
"""Frame conversions, the kit silhouette, and how imports and PATCH change frame and review."""

import math

import numpy as np
import pytest
import trimesh

from app.asset_review import frame_io
from app.asset_review.frame import Frame
from app.errors import AppError

FRAME = {
    "origin": {"lat": 24.4539, "lon": 54.3773, "ground_alt_m": 5.0},
    "north_offset_deg": 0.0,
    "height_m": 42.0,
    "datum_label": "Ground",
    "datum_note": "",
    "line_azimuth_deg": None,
    "silhouette": [[0.0, 3.0], [42.0, 0.9]],
    "levels": [30.0, 36.0],
    "presets": [],
}


def _rings(rows):
    """A vertex-only mesh: rings of 8 points at (y, r) for each row."""
    v = []
    for y, r in rows:
        for k in range(8):
            t = k * math.pi / 4
            v.append([r * math.cos(t), y, r * math.sin(t)])
    return trimesh.Trimesh(vertices=np.array(v), faces=[[0, 1, 2]], process=False)


# ----- conversions: one golden test per converter (spec §12)


def test_conversion_none_is_identity():
    assert np.array_equal(frame_io.CONVERSIONS["none"], np.eye(4))
    assert frame_io.matrix_of("none") is None


def test_x_east_minus_z_north_golden():
    m = frame_io.CONVERSIONS["x_east_minus_z_north"]
    # KIPIC (x = east, y = up, z = -north) -> canonical (X north, Y up, Z east)
    assert (m @ [1, 2, 3, 1]).tolist() == [-3, 2, 1, 1]
    assert (m @ [0, 0, -1, 1]).tolist() == [1, 0, 0, 1]  # one metre north
    assert (m @ [1, 0, 0, 1]).tolist() == [0, 0, 1, 1]  # one metre east
    assert (m @ [0, 1, 0, 1]).tolist() == [0, 1, 0, 1]  # up stays up
    assert frame_io.matrix_of("x_east_minus_z_north") is m


@pytest.mark.parametrize("key", sorted(frame_io.CONVERSIONS))
def test_conversions_are_proper_rotations(key):
    r = frame_io.CONVERSIONS[key][:3, :3]
    assert np.allclose(r @ r.T, np.eye(3))
    assert np.linalg.det(r) == pytest.approx(1.0)


def test_enu_z_up_golden():
    m = frame_io.CONVERSIONS["enu_z_up"]
    # ENU (x = east, y = north, z = up) -> canonical (X north, Y up, Z east)
    assert (m @ [1, 2, 3, 1]).tolist() == [2, 3, 1, 1]
    assert (m @ [0, 1, 0, 1]).tolist() == [1, 0, 0, 1]  # one metre north
    assert (m @ [1, 0, 0, 1]).tolist() == [0, 0, 1, 1]  # one metre east
    assert (m @ [0, 0, 1, 1]).tolist() == [0, 1, 0, 1]  # up


def test_unknown_conversion_is_a_key_error():
    with pytest.raises(KeyError):
        frame_io.matrix_of("z_up")


# ----- silhouette (kit records.py mesh_info)


def test_silhouette_step_golden():
    # one ring per bin centre over [0, 10]: r = 1 below 5 m and 3 above, plus rings at y = 0 and 10 so
    # the bin edges are exactly linspace(0, 10, 161) and each ring sits in its own bin
    rows = [((b + 0.5) * 10 / 160, 1.0 if b < 80 else 3.0) for b in range(160)] + [(0.0, 1.0), (10.0, 3.0)]
    s = frame_io.silhouette_from_mesh(_rings(rows))
    assert len(s) == 160
    assert s[0] == (pytest.approx(0.031, abs=1e-3), 1.0)
    assert s[-1] == (pytest.approx(9.969, abs=1e-3), 3.0)
    # the 5-bin moving average with edge padding: (1*4+3)/5, (1*3+3*2)/5, (1*2+3*3)/5, (1+3*4)/5
    assert [r for _, r in s[77:83]] == [1.0, 1.4, 1.8, 2.2, 2.6, 3.0]
    assert s[80][0] == pytest.approx(5.031, abs=1e-3)


def test_silhouette_92nd_percentile_and_no_smoothing_under_six_bins():
    # bin 0 holds radii 1..100 at angle 0; np.percentile(range(1, 101), 92) = 92.08
    v = [[float(r), 0.0, 0.0] for r in range(1, 101)] + [[1.0, 10.0, 0.0]]
    mesh = trimesh.Trimesh(vertices=np.array(v), faces=[[0, 1, 2]], process=False)
    s = frame_io.silhouette_from_mesh(mesh)
    assert s == [(pytest.approx(0.031, abs=1e-3), 92.08), (pytest.approx(9.969, abs=1e-3), 1.0)]


def test_silhouette_starts_at_zero_when_the_mesh_floats_above_ground():
    s = frame_io.silhouette_from_mesh(_rings([(4.01, 2.0), (8.0, 2.0)]))
    # edges run from min(0, y0) = 0 to 8 in 0.05 m bins, so the first ring lands in bin 80 (centre 4.025)
    assert s[0][0] == pytest.approx(4.025, abs=1e-3) and s[-1][0] == pytest.approx(7.975, abs=1e-3)


# ----- frame after import


def test_first_import_creates_the_frame_from_the_glb():
    f = frame_io.frame_after_import(None, None, 42.05, [(0.031, 3.0), (41.9, 0.9)], None)
    frame = Frame.model_validate(f)
    assert frame.origin is None and frame.height_m == 42.05 and frame.north_offset_deg == 0.0
    assert [list(p) for p in frame.silhouette] == [[0.031, 3.0], [41.9, 0.9]]
    assert frame.levels == [] and frame.presets == []


def test_import_with_origin_sets_it():
    origin = {"lat": 1.5, "lon": 2.5, "ground_alt_m": 3.0}
    f = frame_io.frame_after_import(None, None, 10.0, [(0.0, 1.0)], origin)
    assert f["origin"]["lat"] == 1.5 and f["origin"]["ground_alt_m"] == 3.0
    kept = frame_io.frame_after_import(FRAME, None, 10.0, [(0.0, 1.0)], origin)
    assert kept["origin"]["lon"] == 54.3773 and kept["height_m"] == 42.0  # the operator's origin and height
    filled = frame_io.frame_after_import({**FRAME, "origin": None}, None, 10.0, [(0.0, 1.0)], origin)
    assert filled["origin"]["lon"] == 2.5


def test_reimport_replaces_an_untouched_silhouette_and_height():
    prev = {"height_m": 42.0, "silhouette": [[0.0, 3.0], [42.0, 0.9]]}
    f = frame_io.frame_after_import(FRAME, prev, 84.0, [(0.0, 6.0), (84.0, 1.8)], None)
    assert f["height_m"] == 84.0 and f["silhouette"] == [[0.0, 6.0], [84.0, 1.8]]
    assert f["levels"] == [30.0, 36.0]  # every other field is the operator's


def test_reimport_keeps_an_edited_frame():
    prev = {"height_m": 40.0, "silhouette": [[0.0, 3.0], [40.0, 0.9]]}  # the operator changed both since
    f = frame_io.frame_after_import(FRAME, prev, 84.0, [(0.0, 6.0)], None)
    assert f["height_m"] == 42.0 and f["silhouette"] == [[0.0, 3.0], [42.0, 0.9]]


def test_reimport_fills_an_empty_silhouette():
    f = frame_io.frame_after_import({**FRAME, "silhouette": []}, None, 50.0, [(0.0, 2.0)], None)
    assert f["silhouette"] == [[0.0, 2.0]] and f["height_m"] == 50.0


# ----- review rescale and resolve


def test_rescale_review_scales_zones_and_a_default_cluster():
    review = {
        "profile_id": "telecom_tower",
        "cluster_m": max(0.75, 0.02 * 42.0),
        "zones": [
            {"id": "antenna", "label": "Antenna zone", "min_m": 33.6, "max_m": 1e9},
            {"id": "body", "label": "Tower body", "min_m": 4.2, "max_m": 33.6},
            {"id": "base", "label": "Base", "min_m": -1e9, "max_m": 4.2},
        ],
    }
    out = frame_io.rescale_review(review, 42.0, 84.0)
    assert [(z["min_m"], z["max_m"]) for z in out["zones"]] == [(67.2, 1e9), (8.4, 67.2), (-1e9, 8.4)]
    assert out["cluster_m"] == pytest.approx(1.68)
    assert review["zones"][1]["min_m"] == 4.2  # the input is not mutated
    edited = frame_io.rescale_review({**review, "cluster_m": 2.5}, 42.0, 84.0)
    assert edited["cluster_m"] == 2.5  # an operator's cluster distance is kept


def test_resolve_review_needs_a_known_profile_and_a_frame():
    with pytest.raises(AppError) as e:
        frame_io.resolve_review({"profile_id": "no_such"}, FRAME)
    assert e.value.code == "unknown_profile" and e.value.status == 422
    with pytest.raises(AppError) as e:
        frame_io.resolve_review({"profile_id": ["stack"]}, FRAME)
    assert e.value.code == "unknown_profile"
    with pytest.raises(AppError) as e:
        frame_io.resolve_review({"profile_id": "stack"}, None)
    assert e.value.code == "frame_required"
    assert frame_io.resolve_review(None, FRAME) is None


def test_resolve_review_uses_the_frame_height():
    out = frame_io.resolve_review({"profile_id": "telecom_tower"}, FRAME)
    assert out["profile_id"] == "telecom_tower"
    body = next(z for z in out["zones"] if z["id"] == "body")
    assert body["min_m"] == pytest.approx(4.2) and body["max_m"] == pytest.approx(33.6)
