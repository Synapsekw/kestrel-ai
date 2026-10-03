"""Replay mode (spec §6.5 step 6): surface.json's patches, points and unplaced keys as they are."""

import json

import numpy as np
import pytest
from kit_fixtures import (
    PATCH_POSITIONS,
    PATCH_UVS,
    PHOTO_PHOTOS,
    PHOTO_SIZE,
    REGION_PHOTOS,
    REGION_SIZE,
    Ctx,
    kit_patch,
    kit_types,
    make_photo_kit,
    make_region_kit,
    seed_images,
    seed_ready_model,
)
from sqlalchemy import select

from app.asset_review import jobs_place, place
from app.asset_review.kit_format import KitError
from app.asset_review.kit_import import run_kit_import
from app.asset_review.kit_replay import patch_from_kit
from app.db.models import Box, FindingSighting


def test_patch_from_kit_decodes_geometry_texture_and_labels():
    patch = patch_from_kit(kit_patch({"finding": "f"}, [0, 0, 0], [0, 0, 1], "Crown"))
    assert patch.positions.dtype == np.float32 and patch.positions.tolist() == PATCH_POSITIONS
    assert patch.uvs.tolist() == PATCH_UVS
    assert (patch.texture.mode, patch.texture.size) == ("RGBA", (8, 8))
    assert patch.labels.shape == (4, 4) and patch.labels.min() == 1


def test_label_grids_over_128_px_are_downscaled():
    patch = patch_from_kit(kit_patch({"photo": "p"}, [0, 0, 0], [0, 0, 1], "x", label_w=512, label_h=197))
    assert patch.labels.shape == (49, 128) and patch.labels.dtype == np.uint8


def test_a_patch_of_the_wrong_length_is_refused():
    item = kit_patch({"finding": "f"}, [0, 0, 0], [0, 0, 1], "x")
    item["vertexCount"] = 9
    with pytest.raises(KitError):
        patch_from_kit(item)


def _rows(handle):
    with handle.session() as s:
        q = select(FindingSighting, Box.image_id, Box.shape).join(
            Box, Box.id == FindingSighting.annotation_id
        )
        out = []
        for f, image_id, shape in s.execute(q).all():
            s.expunge(f)
            out.append((f, image_id, shape))
        return out


def test_replay_places_patches_points_and_unplaced(tmp_path, client, project, handle):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, ids = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    mid = seed_ready_model(handle)
    params = {
        "folder": str(kit),
        "image_source_id": source_id,
        "asset_model_id": mid,
        "new_model_name": None,
        "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]},
        "dry_run": False,
    }
    result = run_kit_import(Ctx(handle, params))
    assert result["placement"] == {
        "mode": "replay",
        "patch": 1,
        "point": 1,
        "none": 1,
        "pending": 0,
        "orphans": 0,
        "bad": 0,
    }
    by = {(image_id, shape): f for f, image_id, shape in _rows(handle)}
    patch = by[(ids["p01"], "polygon")]
    assert (patch.placement, patch.cx, patch.cy, patch.cz, patch.nz) == ("patch", 1.0, 20.0, 2.0, 1.0)
    assert (patch.part, patch.placed_version) == ("Crown", 1)
    assert (handle.folder / patch.patch_path).is_file()
    point = by[(ids["p02"], "box")]
    assert (point.placement, point.cx, point.cy, point.part, point.patch_path) == (
        "point",
        1.5,
        20.5,
        "Navy fin",
        None,
    )
    none = by[(ids["p01"], "box")]
    assert (none.placement, none.cx, none.placed_version) == ("none", None, 1)
    # J3's placements index stays in step: the viewer lists each replayed patch with its size
    index = place.read_index(jobs_place.placements_dir(handle, mid, 1))
    assert set(index) == {patch.id}
    assert index[patch.id]["vertex_count"] == len(PATCH_POSITIONS)
    assert all(index[patch.id]["size"]) and index[patch.id]["texture_size"] == [8, 8]


def test_photo_unit_patches_key_on_the_photo(tmp_path, client, project, handle):
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    params = {
        "folder": str(kit),
        "image_source_id": source_id,
        "asset_model_id": mid,
        "new_model_name": None,
        "class_map": {"moderate": types["corrosion"]["id"]},
        "dry_run": False,
    }
    result = run_kit_import(Ctx(handle, params))
    assert (result["placement"]["patch"], result["placement"]["none"], result["placement"]["pending"]) == (
        1,
        1,
        0,
    )
    rows = sorted((f for f, _, _ in _rows(handle)), key=lambda f: -f.coverage)
    assert (rows[0].placement, rows[0].part, rows[0].cy) == ("patch", "Stack cladding / seam", 40.0)
    assert (rows[1].placement, rows[1].cx, rows[1].placed_version) == ("none", None, 1)


def test_entries_for_unknown_keys_are_counted_not_placed(tmp_path, client, project, handle):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    surface = json.loads((kit / "surface.json").read_text("utf-8"))
    surface["unmapped"].append("p99-1")
    surface["patches"].append({**surface["patches"][0], "finding": "p01-2", "vertexCount": 9})
    (kit / "surface.json").write_text(json.dumps(surface), "utf-8")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    params = {
        "folder": str(kit),
        "image_source_id": source_id,
        "asset_model_id": seed_ready_model(handle),
        "new_model_name": None,
        "dry_run": False,
        "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]},
    }
    result = run_kit_import(Ctx(handle, params))
    assert (result["placement"]["orphans"], result["placement"]["bad"]) == (1, 1)
    assert (
        result["placement"]["none"] == 1
    )  # p01-2: the bad patch is skipped, its unmapped entry still counts
