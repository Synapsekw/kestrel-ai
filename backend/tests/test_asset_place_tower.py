# backend/tests/test_asset_place_tower.py
"""Placement accuracy on the kit's synthetic tower (spec 2026-10-02-asset-findings §12): every truth
finding placed within 0.25 m of its truth point, on the right side and in the right zone."""

from collections import defaultdict

import numpy as np
import pytest
from asset_place_helpers import diamond, pose_in, project_truth
from fixtures.synthetic_tower import CLASS_RGB, make_tower
from PIL import Image as PILImage

from app.asset_review import place
from app.asset_review.derive import derive
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.place import place_sighting
from app.asset_review.profiles import resolve


@pytest.fixture(scope="module")
def tower(tmp_path_factory):
    return make_tower(tmp_path_factory.mktemp("tower"), photos=False)


def test_every_truth_finding_is_placed_within_a_quarter_metre(tower):
    mesh, face_node = load_glb_mesh(tower.glb_path)
    review = resolve("telecom_tower", tower.frame.height_m)
    sightings = project_truth(tower, mesh)
    by_truth = defaultdict(list)
    for ts in sightings:
        p = place_sighting(
            mesh,
            face_node,
            pose_in(tower.poses[ts.pose_index]),
            ts.shape,
            tower.image_size,
            review,
            None,
            "#ff7a2d",
            frame=tower.frame,
        )
        assert p.kind == "point", (ts.truth_id, ts.pose_index)
        by_truth[ts.truth_id].append(p)
    assert set(by_truth) == {t.id for t in tower.truth}
    for t in tower.truth:
        median = np.median(np.array([p.center for p in by_truth[t.id]]), axis=0)
        assert np.linalg.norm(median - np.asarray(t.center)) <= 0.25, t.id
        got = derive(tuple(float(v) for v in median), None, review, tower.frame)
        want = derive(tuple(t.center), None, review, tower.frame)
        assert (got.side, got.zone) == (want.side, want.zone), t.id


def test_the_hit_node_names_the_component(tower):
    """D2 is a splice plate on leg 2: every pin on it names the leg (J1's node names)."""
    mesh, face_node = load_glb_mesh(tower.glb_path)
    review = resolve("telecom_tower", tower.frame.height_m)
    parts = {
        place_sighting(
            mesh,
            face_node,
            pose_in(tower.poses[ts.pose_index]),
            ts.shape,
            tower.image_size,
            review,
            None,
            "#ff7a2d",
            frame=tower.frame,
        ).part
        for ts in project_truth(tower, mesh)
        if ts.truth_id == "D2"
    }
    assert parts == {"Leg"}


def test_patch_texture_over_a_tower_photo_shows_the_class_colour(tmp_path):
    """Inside the polygon a texture pixel is photo * (1 - FILL_MIX) + colour * FILL_MIX, so the
    centre of a defect's crop, on its disc, shows the class colour under the orange fill."""
    tower = make_tower(tmp_path / "photo_tower", photos=True)
    mesh, _ = load_glb_mesh(tower.glb_path)
    cls = {t.id: t.cls for t in tower.truth}
    rgb = np.array((255, 122, 45), float)
    tried = 0
    for ts in project_truth(tower, mesh):
        shape = diamond(ts.shape)
        with PILImage.open(tower.photos_dir / tower.poses[ts.pose_index]["name"]) as photo:
            photo.load()
            cx, cy = int(shape.x + shape.w / 2), int(shape.y + shape.h / 2)
            want_disc = np.array(CLASS_RGB[cls[ts.truth_id]], float)
            if np.abs(np.asarray(photo.convert("RGB"))[cy, cx] - want_disc).max() > 12:
                tried += 1
                continue  # this camera's disc is hidden or off the centre: try the next sighting
            tex, _ = place.patch_texture(shape, tower.image_size, photo, "#ff7a2d")
        a = np.asarray(tex)
        got = a[a.shape[0] // 2, a.shape[1] // 2]
        want = want_disc * (1 - place.FILL_MIX) + rgb * place.FILL_MIX
        assert np.abs(got[:3].astype(float) - want).max() <= 12, (ts.truth_id, got, want)
        assert got[3] == place.FILL_ALPHA
        return
    pytest.fail(f"no truth sighting had its photo centre on the defect disc ({tried} skipped)")
