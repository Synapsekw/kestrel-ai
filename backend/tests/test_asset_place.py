# backend/tests/test_asset_place.py
"""asset_place geometry on hand-made scenes (plan 2026-10-03-asset-findings-j3 Tasks 2 and 3).

The scene: a camera at (0, 10, 0) looking along plant north (+X) at a 20 x 20 m wall at x = 10; a
1000 x 500 photo with a 60 degree horizontal field of view. Right in the photo is plant east (+Z)."""

import math

import numpy as np
import pytest
import trimesh

from app.asset_review import place
from app.asset_review.frame import Frame
from app.asset_review.place import SightingShape, camera_rays, place_sighting
from app.asset_review.poses import PoseIn
from app.asset_review.profiles import resolve

SIZE = (1000, 500)
HFOV = 60.0
VFOV = 2 * math.degrees(math.atan(math.tan(math.radians(HFOV / 2)) * SIZE[1] / SIZE[0]))
ORANGE = "#ff7a2d"
FRAME = Frame(height_m=20.0)


def pose(target=(10.0, 10.0, 0.0)) -> PoseIn:
    return PoseIn(
        position=[0.0, 10.0, 0.0],
        target=list(target),
        up=[0.0, 1.0, 0.0],
        hfov_deg=HFOV,
        vfov_deg=VFOV,
        source="manual",
        accuracy_m=None,
    )


def wall(x=10.0, z0=-10.0, z1=10.0, y0=0.0, y1=20.0, flip=False) -> trimesh.Trimesh:
    v = np.array([[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], float)
    faces = np.array([[0, 1, 2], [0, 2, 3]])
    return trimesh.Trimesh(v, faces[:, ::-1] if flip else faces, process=False)


def review(placement="point", grid=4):
    return resolve("stack", FRAME.height_m).model_copy(update={"placement": placement, "patch_grid": grid})


def run(mesh, shape, rv=None, photo=None, p=None):
    return place_sighting(
        mesh,
        np.zeros(len(mesh.faces), np.int32),
        p or pose(),
        shape,
        SIZE,
        rv or review(),
        photo,
        ORANGE,
        frame=FRAME,
    )


def test_camera_rays_centre_is_forward_and_edges_match_the_fov():
    origins, dirs, fwd = camera_rays(
        pose(), np.array([500.0, 1000.0, 500.0]), np.array([250.0, 250.0, 0.0]), SIZE
    )
    assert np.allclose(origins, [[0, 10, 0]] * 3)
    assert np.allclose(fwd, [1, 0, 0])
    assert np.allclose(dirs[0], [1, 0, 0])
    assert np.allclose(
        dirs[1], [math.cos(math.radians(30)), 0, math.sin(math.radians(30))]
    )  # right edge is +Z
    half_v = math.radians(VFOV / 2)
    assert np.allclose(dirs[2], [math.cos(half_v), math.sin(half_v), 0])  # the top edge


def test_ndc_comes_from_the_stored_image_size():
    a = camera_rays(pose(), np.array([250.0]), np.array([100.0]), (1000, 500))[1]
    b = camera_rays(pose(), np.array([1000.0]), np.array([400.0]), (4000, 2000))[1]
    assert np.allclose(a, b)


@pytest.mark.parametrize("flip", [False, True])
def test_a_pin_lands_on_the_wall_with_the_normal_toward_the_camera(flip):
    p = run(wall(flip=flip), SightingShape(450, 200, 100, 100))
    assert p.kind == "point" and p.patch is None
    assert p.center[0] == pytest.approx(10.0)
    assert abs(p.center[1] - 10.0) < 0.5 and abs(p.center[2]) < 0.5
    assert p.normal == pytest.approx((-1.0, 0.0, 0.0))
    assert p.part is None  # a hand-made mesh has no node names
    assert p.coverage == pytest.approx(100 * 100 / (1000 * 500))
    assert p.derived.height_m == pytest.approx(p.center[1])


def test_ray_miss_is_none_not_error():
    """Review Focus 2: a camera that looks away from the model places nothing, and says so."""
    p = run(wall(), SightingShape(450, 200, 100, 100), p=pose(target=(-10.0, 10.0, 0.0)))
    assert p.kind == "none"
    assert (p.center, p.normal, p.part, p.patch, p.derived) == (None, None, None, None, None)
    assert p.coverage == pytest.approx(0.02)


def test_a_point_annotation_is_one_ray_through_its_pixel():
    p = run(wall(), SightingShape(500, 250, 0, 0, kind="point"))
    assert p.center == pytest.approx((10.0, 10.0, 0.0))
    assert p.coverage == 0.0


def test_a_rotated_box_is_cast_over_its_envelope():
    shape = SightingShape(450, 200, 100, 60, angle=30, kind="rbox")
    x0, y0, x1, y1 = shape.bbox(SIZE)
    assert x0 < 450 and x1 > 550 and y0 < 200 and y1 > 260
    assert run(wall(), shape).kind == "point"


def test_every_ray_of_a_sighting_is_one_cast(monkeypatch):
    calls = []
    real = place.cast
    monkeypatch.setattr(place, "cast", lambda mesh, o, d: calls.append(len(o)) or real(mesh, o, d))
    run(wall(), SightingShape(450, 200, 100, 100))
    assert calls == [25]
