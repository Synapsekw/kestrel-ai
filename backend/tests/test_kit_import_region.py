"""Region-unit sightings (spec §6.5 step 5, DAMAC's shape): boxes and polygons rescaled from the
kit's preview grid, sightings with severity, group and component, and the undo on cancel."""

import pytest
from kit_fixtures import (
    REGION_PHOTOS,
    REGION_SIZE,
    Ctx,
    kit_types,
    make_region_kit,
    seed_images,
    seed_ready_model,
    table_counts,
)
from sqlalchemy import select

from app.asset_review import kit_sightings
from app.asset_review.kit_import import run_kit_import
from app.db.models import Box, Finding, FindingSighting
from app.findings.backfill import findings_from_annotations
from app.jobs.cancellation import JobCancelled, JobFailure

S = 2000 / 2560  # stored image px per preview px (4000 px originals stored at half size)


def params_for(tmp_path, handle, types, **seed):
    # With surface.json: from Task 5 on, these runs replay it, so J3's ray casting (which reads the
    # photos these seeded rows do not have) never runs here.
    kit = make_region_kit(tmp_path / "kit")
    source_id, ids = seed_images(handle, REGION_PHOTOS, REGION_SIZE, **seed)
    mid = seed_ready_model(handle)
    return (
        {
            "folder": str(kit),
            "image_source_id": source_id,
            "asset_model_id": mid,
            "new_model_name": None,
            "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]},
            "dry_run": False,
        },
        ids,
        mid,
    )


def rows(handle):
    with handle.session() as s:
        q = select(FindingSighting, Box).join(Box, Box.id == FindingSighting.annotation_id)
        out = [(f, b) for f, b in s.execute(q).all()]
        for f, b in out:
            s.expunge(f)
            s.expunge(b)
        return out


def test_region_findings_become_boxes_and_sightings(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, ids, mid = params_for(tmp_path, handle, types)
    result = run_kit_import(Ctx(handle, params))
    assert result["sightings"] == 3 and result["skipped"] == []
    by = {(b.image_id, b.shape): (f, b) for f, b in rows(handle)}
    tri_f, tri = by[(ids["p01"], "polygon")]
    assert (tri.x, tri.y, tri.w, tri.h) == pytest.approx((100 * S, 200 * S, 400 * S, 400 * S), abs=0.11)
    assert tri.class_id == types["cladding"]["id"] and len(tri.points) == 3
    assert (tri_f.severity, tri_f.group_tag, tri_f.asset_model_id, tri_f.coverage) == (
        2,
        "g1",
        mid,
        pytest.approx(0.016276),
    )
    st_f, st = by[(ids["p01"], "box")]
    assert (st.x, st.y, st.w, st.h) == pytest.approx((1000 * S, 1000 * S, 200 * S, 300 * S))
    assert (st.class_id, st_f.severity, st_f.group_tag, st_f.coverage) == (
        types["staining"]["id"],
        1,
        None,
        pytest.approx(0.012207),
    )
    p2_f, p2 = by[(ids["p02"], "box")]
    assert (p2.x, p2.w) == pytest.approx((300 * S, 400 * S))
    assert (p2_f.part, p2_f.group_tag, p2.provenance_kind, p2.review_state) == (
        "Navy fin",
        "g1",
        "person",
        "accepted",
    )


def test_real_run_imports_matched_photos_and_reports_the_rest(tmp_path, client, project, handle):
    """Index Review Focus 3, real run: the unmatched photo's finding is skipped and reported."""
    types = kit_types(client, project)
    params, ids, _ = params_for(
        tmp_path, handle, types, rename={"p02": "other/IMG_2.JPG"}, retime={"p02": "2024:06:05 11:00:00"}
    )
    result = run_kit_import(Ctx(handle, params))
    assert result["unmatched"] == ["flight-a/DJI_0002.JPG"]
    assert result["unmatched_reasons"] == [
        {"kit_id": "p02", "source_name": "flight-a/DJI_0002.JPG", "reason": "not_found"}
    ]
    assert result["sightings"] == 2
    assert result["skipped"] == [{"kit_key": "p02-1", "reason": "photo_unmatched"}]
    assert {b.image_id for _, b in rows(handle)} == {ids["p01"]}


def test_cancel_while_writing_sightings_leaves_nothing_behind(tmp_path, client, project, handle, monkeypatch):
    types = kit_types(client, project)
    params, _, _ = params_for(tmp_path, handle, types)
    monkeypatch.setattr(kit_sightings, "CHUNK", 1)
    with pytest.raises(JobCancelled):
        run_kit_import(Ctx(handle, params, cancel_on="Writing sightings 1 /"))
    counts = table_counts(handle)
    assert (counts["box"], counts["finding_sighting"], counts["image_pose"]) == (0, 0, 0)


def test_imported_boxes_never_become_image_findings(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = params_for(tmp_path, handle, types)
    run_kit_import(Ctx(handle, params))
    assert findings_from_annotations(handle) == 0
    with handle.session() as s:
        assert s.scalar(select(Finding.id).where(Finding.anchor_kind == "image")) is None


def test_a_second_import_into_the_same_model_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = params_for(tmp_path, handle, types)
    run_kit_import(Ctx(handle, params))
    with pytest.raises(JobFailure, match="already holds 3 sightings"):
        run_kit_import(Ctx(handle, params))
