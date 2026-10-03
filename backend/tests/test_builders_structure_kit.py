"""Structure kit (B1): footprint runs, members, handrails, pipes."""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.asset_models.builders import structure_kit as k
from app.asset_models.builders.base import BuildCtx, Instanced
from app.asset_models.spec import Item

CTX = BuildCtx(grid=None)


def item(fp) -> Item:
    return Item.model_validate(
        {"id": "k", "name": "k", "type": "other", "footprint": fp, "source": {"kind": "assumed"}}
    )


def test_line_footprint_gives_one_run_per_segment_and_skips_zero_length():
    it = item({"kind": "line", "pts": [[0, 0], [0, 10], [0, 10], [10, 10]], "width": 4})
    rs = k.runs(it, CTX)
    assert [round(r.length, 6) for r in rs] == [10.0, 10.0]
    assert all(r.width == 4 for r in rs)
    assert np.allclose(rs[0].u, [1, 0])  # first leg runs north = local +x
    assert np.allclose(rs[1].u, [0, 1])  # second leg runs east = local +z


def test_zero_length_line_raises():
    with pytest.raises(ValueError, match="no length"):
        k.runs(item({"kind": "line", "pts": [[3, 3], [3, 3]], "width": 2}), CTX)


@pytest.mark.parametrize(
    ("size", "rot", "u"), [((10, 2), 0, (1, 0)), ((10, 2), 90, (0, 1)), ((2, 10), 0, (0, 1))]
)
def test_rect_run_follows_the_longer_side_clockwise_from_north(size, rot, u):
    (r,) = k.runs(item({"kind": "rect", "center": [5, 5], "size": list(size), "rot_deg": rot}), CTX)
    assert r.length == pytest.approx(10) and r.width == pytest.approx(2)
    assert np.allclose(np.abs(r.u), np.abs(u), atol=1e-9)
    assert np.allclose((r.p0 + r.p1) / 2, [0, 0], atol=1e-9)  # centred on the footprint ref


def test_polygon_run_is_its_minimum_rectangle_long_axis():
    it = item({"kind": "polygon", "pts": [[0, 0], [4, 0], [4, 20], [0, 20]]})
    (r,) = k.runs(it, CTX)
    assert r.length == pytest.approx(20) and r.width == pytest.approx(4)
    assert abs(r.u[0]) == pytest.approx(1)  # along north


def test_outline_is_counter_clockwise_and_rejects_no_area():
    ring = k.outline(item({"kind": "rect", "center": [0, 0], "size": [4, 2], "rot_deg": 0}), CTX)
    x, z = ring[:, 0], ring[:, 1]
    assert 0.5 * np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z) > 0
    with pytest.raises(ValueError):
        k.outline(item({"kind": "polygon", "pts": [[0, 0], [1, 1], [2, 2]]}), CTX)


def test_stations_never_exceed_the_spacing():
    s = k.stations(30.0, 6.0)
    assert s[0] == 0 and s[-1] == 30 and len(s) == 6
    assert np.diff(s).max() <= 6.0 + 1e-9
    assert len(k.stations(1.0, 6.0)) == 2
    s = k.stations(30.0, 6.0, inset=1.0)
    assert s[0] == 1 and s[-1] == 29


def test_member_is_8_triangles_level_across_and_deep_in_the_vertical_plane():
    m = k.member((0, 1, 0), (10, 1, 0), 0.2, 0.6)
    assert len(m.faces) == 8
    ext = m.extents
    assert ext[0] == pytest.approx(10) and ext[1] == pytest.approx(0.6) and ext[2] == pytest.approx(0.2)
    centre = m.vertices.mean(axis=0)
    assert (np.einsum("ij,ij->i", m.face_normals, m.triangles_center - centre) > 0).all()  # outward


def test_column_mesh_stands_on_the_origin():
    m = k.column_mesh(4.0, 0.3)
    assert m.bounds[0][1] == pytest.approx(0) and m.bounds[1][1] == pytest.approx(4)
    assert m.extents[0] == pytest.approx(0.3) and m.extents[2] == pytest.approx(0.3)


def test_posed_points_local_x_along_u():
    u = np.array([0.6, 0.8])
    xf = k.posed(np.array([[1.0, 2.0, 3.0]]), u)[0]
    assert np.allclose(xf[:3, :3] @ [1, 0, 0], [0.6, 0, 0.8])
    assert np.allclose(xf[:3, 3], [1, 2, 3])
    assert np.linalg.det(xf[:3, :3]) == pytest.approx(1)


def test_along_maps_the_unit_tube_onto_the_segment():
    t = k.tube(0.2, 8)
    assert len(t.faces) == 16
    xf = k.along(np.array([0.0, 1.0, 0.0]), np.array([0.0, 1.0, 12.0]))
    m = t.copy()
    m.apply_transform(xf)
    assert m.bounds[0][2] == pytest.approx(0) and m.bounds[1][2] == pytest.approx(12)
    assert m.extents[0] == pytest.approx(0.4, abs=1e-6)


def test_handrail_posts_are_instanced_at_the_spacing():
    nodes = k.handrail(
        np.array([[0.0, 0.0], [10.0, 0.0]]), 2.0, height=1.1, spacing=2.5, closed=False, lod=1.0
    )
    posts, rails = nodes
    assert posts.name == "handrail_posts" and isinstance(posts.geometry, Instanced)
    assert len(posts.geometry.transforms) == 5
    assert np.allclose(posts.geometry.transforms[:, 1, 3], 2.0)
    assert rails.name == "handrail_rails" and len(rails.geometry.faces) == 16  # top + knee rail


def test_closed_handrail_does_not_double_corner_posts():
    sq = np.array([[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]])
    posts = k.handrail(sq, 0.0, height=1.1, spacing=2.0, closed=True, lod=1.0)[0]
    assert len(posts.geometry.transforms) == 8


def test_pipe_nodes_group_by_diameter_and_insulation():
    a, b = np.zeros(3), np.array([10.0, 0, 0])
    nodes = k.pipe_nodes([(0.3, False, a, b), (0.3, False, a + 1, b + 1), (0.6, True, a, b)], CTX)
    assert [(n.name, n.material, len(n.geometry.transforms)) for n in nodes] == [
        ("pipes_300", "Pipe", 2),
        ("pipes_ins_600", "Pipe_Insulated", 1),
    ]


def test_grid_rows_stay_inside_and_keep_edge_rows():
    ring = np.array([[0.0, 0.0], [20.0, 0.0], [20.0, 8.0], [0.0, 8.0]])
    run = k.rect_run(ring)
    rows = k.grid_rows(ring, run, 7.5, 7.5, 0.6)
    pts = np.vstack(rows)
    assert len(rows) == 4 and all(len(r) == 2 for r in rows)
    assert pts[:, 0].min() >= 0.6 - 1e-9 and pts[:, 0].max() <= 19.4 + 1e-9


def test_perimeter_points_for_a_circle():
    ring = np.array(
        [[4 * math.cos(a), 4 * math.sin(a)] for a in np.linspace(0, 2 * math.pi, 48, endpoint=False)]
    )
    pts = k.perimeter_points(ring, 8.0, 0.15)
    assert len(pts) == 4  # 24.2 m round at 8 m spacing
    assert np.allclose(np.linalg.norm(pts, axis=1), 3.85, atol=0.05)


def test_lod_scales_segment_counts_with_a_floor():
    assert k.segs(0.55, BuildCtx(grid=None, lod=0.1)) == k.MIN_SEG
    assert k.segs(0.55, BuildCtx(grid=None, lod=1.0)) >= k.segs(0.55, BuildCtx(grid=None, lod=0.5))


def test_triangles_counts_instances():
    nodes = k.handrail(
        np.array([[0.0, 0.0], [10.0, 0.0]]), 0.0, height=1.1, spacing=2.5, closed=False, lod=1.0
    )
    assert k.triangles(nodes) == 5 * 8 + 16
