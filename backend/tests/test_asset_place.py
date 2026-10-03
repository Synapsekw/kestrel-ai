# backend/tests/test_asset_place.py
"""asset_place geometry on hand-made scenes (plan 2026-10-03-asset-findings-j3 Tasks 2 and 3).

The scene: a camera at (0, 10, 0) looking along plant north (+X) at a 20 x 20 m wall at x = 10; a
1000 x 500 photo with a 60 degree horizontal field of view. Right in the photo is plant east (+Z)."""

import json
import math
import struct

import numpy as np
import pytest
import trimesh
from PIL import Image as PILImage

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


POLY = SightingShape(400, 200, 200, 100, kind="polygon", points=((400, 200), (600, 200), (600, 300)))
BOX = SightingShape(400, 200, 200, 100)


def test_a_patch_is_lifted_toward_the_camera_with_uvs_over_the_crop():
    p = run(wall(), BOX, rv=review("patch", 4))
    assert p.kind == "patch"
    pos, uv = p.patch.positions, p.patch.uvs
    assert pos.dtype == np.float32 and pos.shape == (18, 3)  # a 4 x 2 grid: 3 quads, 2 triangles each
    assert np.allclose(pos[:, 0], 10.0 - FRAME.height_m * place.OFFSET_FRACTION)
    assert uv.min() == 0.0 and uv.max() == 1.0
    assert np.allclose(uv[:6], [[0, 1], [1 / 3, 1], [1 / 3, 0], [0, 1], [1 / 3, 0], [0, 0]])
    assert p.patch.crop == (400, 200, 600, 300)
    assert p.patch.direction == pytest.approx((-1.0, 0.0, 0.0))
    width = 2 * 10 * math.tan(math.radians(30)) * 0.2  # the box spans a fifth of the photo's width
    assert p.patch.size[0] == pytest.approx(width, rel=1e-4)


def test_a_patch_drops_quads_that_span_a_depth_jump():
    step = trimesh.util.concatenate([wall(10.0, -10.0, 0.0), wall(30.0, 0.0, 10.0)])
    p = run(step, SightingShape(450, 200, 100, 100), rv=review("patch", 8))
    tris = p.patch.positions.reshape(-1, 3, 3)
    assert len(tris) == 2 * 7 * 6  # 7 x 7 quads, one column of 7 across the step dropped
    assert np.linalg.norm(tris - np.roll(tris, -1, axis=1), axis=2).max() < 1.0


def test_a_patch_with_no_surviving_quad_is_none():
    """A 0.2 m strip: the pin grid's centre column hits, no two neighbouring patch rays do. The kit
    leaves such a patch unmapped, and so do we."""
    p = run(wall(10.0, -0.1, 0.1), BOX, rv=review("patch", 4))
    assert p.kind == "none" and p.center is None and p.patch is None


def test_mixed_gives_a_polygon_a_patch_and_a_box_a_pin():
    assert run(wall(), POLY, rv=review("mixed", 4)).kind == "patch"
    assert run(wall(), BOX, rv=review("mixed", 4)).kind == "point"
    assert run(wall(), SightingShape(500, 250, 0, 0, kind="point"), rv=review("patch", 4)).kind == "point"
    assert run(wall(), POLY, rv=review("point", 4)).kind == "point"


def test_a_polygon_texture_is_the_colour_over_the_photo_inside_and_clear_outside():
    photo = PILImage.new("RGB", (2000, 1000), (0, 0, 255))  # a preview twice the stored size
    p = run(wall(), POLY, rv=review("mixed", 4), photo=photo)
    tex = np.asarray(p.patch.texture)
    assert p.patch.texture.mode == "RGBA" and tex.shape == (100, 200, 4)
    inside = (
        np.array([0, 0, 255]) * (1 - place.FILL_MIX) + np.array([255, 122, 45]) * place.FILL_MIX
    ).astype(np.uint8)
    assert tex[5, -5, :3].tolist() == inside.tolist() and tex[5, -5, 3] == place.FILL_ALPHA
    assert tex[-5, 5].tolist() == [0, 0, 0, 0]
    labels = p.patch.labels
    assert labels.shape == (64, 128) and labels[1, -2] == 1 and labels[-2, 1] == 0
    assert set(np.unique(labels).tolist()) == {0, 1}


def test_a_box_patch_is_a_tinted_box_with_a_solid_border():
    p = run(wall(), BOX, rv=review("patch", 4))
    tex = np.asarray(p.patch.texture)
    assert tex[50, 100].tolist() == [255, 122, 45, place.TINT_ALPHA]
    assert tex[0, 100, 3] == 255 and tex[50, 0, 3] == 255
    assert (p.patch.labels == 1).all()


def test_a_rotated_box_patch_fills_only_its_corners():
    p = run(wall(), SightingShape(450, 200, 100, 60, angle=30, kind="rbox"), rv=review("patch", 4))
    tex = np.asarray(p.patch.texture)
    assert tex[0, 0, 3] == 0 and tex[tex.shape[0] // 2, tex.shape[1] // 2, 3] == place.FILL_ALPHA


def test_texture_and_labels_are_bounded():
    tex, labels = place.patch_texture(SightingShape(0, 0, 4000, 3000), (4000, 3000), None, ORANGE)
    assert tex.size == (512, 384)  # the crop at preview size (2048 x 1536), fitted into 512
    assert labels.shape == (96, 128)


def test_write_patch_files_and_their_byte_layout(tmp_path):
    p = run(wall(), BOX, rv=review("patch", 4))
    assert place.write_patch(tmp_path, "s1", p.patch) == str(tmp_path / "s1.bin")
    assert sorted(f.name for f in tmp_path.iterdir()) == ["s1.bin", "s1.lbl", "s1.png"]
    data = (tmp_path / "s1.bin").read_bytes()
    assert struct.unpack_from("<I", data, 0) == (18,)
    assert len(data) == 4 + 18 * 12 + 18 * 8
    assert np.array_equal(np.frombuffer(data, "<f4", 54, 4).reshape(18, 3), p.patch.positions)
    assert np.array_equal(np.frombuffer(data, "<f4", 36, 4 + 18 * 12).reshape(18, 2), p.patch.uvs)
    pos, uv = place.decode_patch(data)
    assert np.array_equal(pos, p.patch.positions) and np.array_equal(uv, p.patch.uvs)
    lbl = (tmp_path / "s1.lbl").read_bytes()
    assert struct.unpack_from("<HH", lbl, 0) == (128, 64) and len(lbl) == 4 + 128 * 64
    assert np.array_equal(place.decode_labels(lbl), p.patch.labels)
    with PILImage.open(tmp_path / "s1.png") as im:
        assert im.mode == "RGBA" and im.size == (200, 100)
    with pytest.raises(ValueError):
        place.decode_patch(data[:-4])


def test_the_index_round_trips_and_a_broken_one_reads_empty(tmp_path):
    p = run(wall(), BOX, rv=review("patch", 4))
    place.write_index(tmp_path, "m1", 3, {"s1": place.index_entry(p.patch)})
    body = json.loads((tmp_path / "index.json").read_text("utf-8"))
    assert (body["format"], body["asset_model_id"], body["version"]) == (1, "m1", 3)
    entry = place.read_index(tmp_path)["s1"]
    assert (
        entry["vertex_count"] == 18
        and entry["texture_size"] == [200, 100]
        and entry["label_size"] == [128, 64]
    )
    assert entry["size"] == pytest.approx([2.3094, 1.1547], abs=1e-4)
    (tmp_path / "index.json").write_text("{not json", "utf-8")
    assert place.read_index(tmp_path) == {}
    assert place.read_index(tmp_path / "absent") == {}


def test_a_patch_sighting_is_still_one_cast(monkeypatch):
    calls = []
    real = place.cast
    monkeypatch.setattr(place, "cast", lambda mesh, o, d: calls.append(len(o)) or real(mesh, o, d))
    run(wall(), BOX, rv=review("patch", 4))
    assert calls == [25 + 4 * 2]
