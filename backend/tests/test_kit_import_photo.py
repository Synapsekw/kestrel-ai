"""Photo-unit sightings (spec §6.5 step 5, EBSM's shape): one per mask region of a finding photo."""

from pathlib import Path

import pytest
from kit_fixtures import (
    PHOTO_PHOTOS,
    PHOTO_SIZE,
    Ctx,
    draw_mask,
    kit_types,
    make_photo_kit,
    seed_images,
    seed_ready_model,
)
from PIL import Image
from sqlalchemy import select

from app.asset_review.kit_import import run_kit_import
from app.db.models import Box, FindingSighting


def photo_params(tmp_path, client, project, handle, **kit_kw):
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit", **kit_kw)
    source_id, ids = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    params = {
        "folder": str(kit),
        "image_source_id": source_id,
        "asset_model_id": mid,
        "new_model_name": None,
        "class_map": {"moderate": types["corrosion"]["id"]},
        "dry_run": False,
    }
    return params, ids, types


def test_one_sighting_per_mask_region(tmp_path, client, project, handle):
    """Coordinator ruling on N7: each region of at least 0.02% of the photo is a sighting, largest
    first; the uncertain block and the hole are never geometry."""
    params, ids, types = photo_params(tmp_path, client, project, handle)
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 2 and result["skipped"] == []
    with handle.session() as s:
        rows = s.execute(
            select(FindingSighting, Box)
            .join(Box, Box.id == FindingSighting.annotation_id)
            .order_by(Box.w.desc())
        ).all()
        (big, big_box), (small, small_box) = rows
        assert {b.image_id for _, b in rows} == {ids["p001"]}
        assert {b.class_id for _, b in rows} == {types["corrosion"]["id"]}
        # the 200 x 100 region, preview px (100.5 .. 299.5) at half scale; then the 20 x 20 one
        assert (big_box.x, big_box.y, big_box.w, big_box.h) == pytest.approx(
            (50.25, 50.25, 99.5, 49.5), abs=0.11
        )
        assert (small_box.x, small_box.y, small_box.w, small_box.h) == pytest.approx(
            (300.25, 200.25, 9.5, 9.5), abs=0.11
        )
        assert (big.severity, small.severity) == (2, 2)
        assert big.coverage == pytest.approx(199 * 99 / 750000) and small.coverage == pytest.approx(
            19 * 19 / 750000
        )


def test_regions_under_the_threshold_are_not_sightings(tmp_path, client, project, handle):
    """0.02% of a 1000 x 750 photo is 150 px²: a 10 x 10 region is dropped."""
    params, _, _ = photo_params(tmp_path, client, project, handle)
    mask = draw_mask()
    mask[400:420, 600:620] = 0
    mask[400:410, 600:610] = 2
    Image.fromarray(mask).save(Path(params["folder"]) / "masks" / "p001.png")
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 1


def test_a_finding_photo_without_a_mask_is_skipped_and_reported(tmp_path, client, project, handle):
    params, _, _ = photo_params(tmp_path, client, project, handle, mask=False)
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 0
    assert result["skipped"] == [{"kit_key": "p001", "reason": "no_mask"}]
