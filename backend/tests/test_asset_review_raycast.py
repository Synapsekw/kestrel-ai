# backend/tests/test_asset_review_raycast.py
"""The numpy first-hit ray caster (plan 2026-10-03-asset-findings-j3 Task 1). The tiled, culled path
must give exactly what testing every triangle gives."""

import numpy as np
import pytest
import trimesh

from app.asset_review import raycast


def brute(vertices, faces, origins, directions):
    t = np.full(len(origins), np.inf)
    f = np.full(len(origins), -1, dtype=np.int64)
    raycast._blocks(
        np.asarray(vertices, float),
        np.asarray(faces, np.int64),
        np.arange(len(faces)),
        np.asarray(origins, float),
        np.asarray(directions, float),
        np.arange(len(origins)),
        t,
        f,
    )
    return t, f


def scene() -> trimesh.Trimesh:
    """A sphere, a box behind it and a floor: occlusion, misses and shared edges."""
    parts = [trimesh.creation.icosphere(subdivisions=3, radius=2.0), trimesh.creation.box(extents=[1, 6, 6])]
    parts[1].apply_translation([-6.0, 0, 0])
    floor = trimesh.creation.box(extents=[30, 0.2, 30])
    floor.apply_translation([0, -3.0, 0])
    return trimesh.util.concatenate([*parts, floor])


def camera_grid(origin, target, n=40, spread=0.35):
    o = np.asarray(origin, float)
    f = np.asarray(target, float) - o
    f /= np.linalg.norm(f)
    r = np.cross(f, [0.0, 1.0, 0.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    a, b = np.meshgrid(np.linspace(-spread, spread, n), np.linspace(-spread, spread, n))
    d = f[None] + a.ravel()[:, None] * r[None] + b.ravel()[:, None] * u[None]
    return np.repeat(o[None], len(d), 0), d


@pytest.mark.parametrize("origin", [(12.0, 1.0, 0.5), (0.5, 4.0, 14.0), (-12.0, 2.0, -3.0)])
def test_the_culled_cast_equals_testing_every_triangle(origin):
    mesh = scene()
    o, d = camera_grid(origin, (0.0, 0.0, 0.0))
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, o, d)
    bt, bf = brute(mesh.vertices, mesh.faces, o, d)
    assert np.array_equal(face, bf)
    assert np.allclose(t[np.isfinite(bt)], bt[np.isfinite(bt)])
    assert (face >= 0).any() and (face < 0).any()  # the grid sees both the scene and the sky


def test_the_hit_is_the_nearest_surface_along_the_ray():
    mesh = trimesh.creation.box(extents=[2, 2, 2])  # faces at x = +-1
    t, face = raycast.first_hits(
        mesh.vertices, mesh.faces, np.array([[5.0, 0.1, 0.2]]), np.array([[-2.0, 0, 0]])
    )
    assert t[0] == pytest.approx(2.0)  # 4 m at 2 m per unit of direction
    assert face[0] >= 0


def test_a_ray_pointing_away_misses():
    mesh = trimesh.creation.box(extents=[2, 2, 2])
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, np.array([[5.0, 0, 0]]), np.array([[1.0, 0, 0]]))
    assert np.isinf(t[0]) and face[0] == -1


def test_a_triangle_crossing_the_camera_plane_is_still_found():
    """The floor runs under and behind the camera: its projection is unbounded, so it is kept."""
    floor = trimesh.Trimesh([[-50, 0, -50], [50, 0, -50], [50, 0, 50], [-50, 0, 50]], [[0, 1, 2], [0, 2, 3]])
    o, d = camera_grid((0.0, 2.0, 0.0), (10.0, 0.0, 0.0), n=10, spread=0.1)
    t, face = raycast.first_hits(floor.vertices, floor.faces, o, d)
    assert (face >= 0).all()
    hits = o + d * t[:, None]
    assert np.allclose(hits[:, 1], 0.0)


def test_rays_from_different_origins_fall_back_to_every_triangle():
    mesh = scene()
    o = np.array([[12.0, 0, 0], [0, 12.0, 0], [0, 0, 12.0]])
    d = -o
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, o, d)
    bt, bf = brute(mesh.vertices, mesh.faces, o, d)
    assert np.array_equal(face, bf) and np.allclose(t, bt)


def test_no_rays_or_no_faces_return_empty_misses():
    t, face = raycast.first_hits(np.zeros((0, 3)), np.zeros((0, 3), int), np.zeros((2, 3)), np.ones((2, 3)))
    assert np.isinf(t).all() and (face == -1).all()
    t, face = raycast.first_hits(np.zeros((3, 3)), np.array([[0, 1, 2]]), np.zeros((0, 3)), np.zeros((0, 3)))
    assert len(t) == 0 and len(face) == 0
