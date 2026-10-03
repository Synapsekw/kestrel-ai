"""Frame, review, poses and statuses from a kit (spec §6.5 steps 1, 3, 4) and the refusals that
come before any write."""

import math

import pytest
import trimesh
from kit_fixtures import (
    PHOTO_PHOTOS,
    PHOTO_SIZE,
    REGION_PHOTOS,
    REGION_SIZE,
    Ctx,
    kit_types,
    make_photo_kit,
    make_region_kit,
    seed_empty_model,
    seed_images,
    seed_ready_model,
    table_counts,
)

from app.asset_review.kit_children import ChildContext
from app.asset_review.kit_import import run_kit_import
from app.asset_review.kit_records import EARTH_RADIUS_M, kit_origin
from app.db.models import AssetModel, AssetModelVersion, Box, Image, ImagePose, ImageReview
from app.jobs.cancellation import JobFailure


def region_params(tmp_path, handle, types, *, kit=None, model=None, **seed):
    kit = kit or make_region_kit(tmp_path / "kit")
    source_id, ids = seed_images(handle, REGION_PHOTOS, REGION_SIZE, **seed)
    mid = model or seed_ready_model(handle)
    params = {
        "folder": str(kit),
        "image_source_id": source_id,
        "asset_model_id": mid,
        "new_model_name": None,
        "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]},
        "dry_run": False,
    }
    return params, ids, mid


def photo_params(tmp_path, handle, types, **kit_kw):
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
    return params, ids, mid


def test_frame_and_review_come_from_job_yaml(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, mid = region_params(tmp_path, handle, types)
    result = run_kit_import(Ctx(handle, params))
    assert result["dry_run"] is False and result["version"] == 1 and result["asset_model_id"] == mid
    with handle.session() as s:
        m = s.get(AssetModel, mid)
        frame, review = m.frame, m.review
    assert (frame["origin"]["lat"], frame["origin"]["lon"], frame["origin"]["ground_alt_m"]) == (
        25.0,
        55.0,
        0.0,
    )
    assert frame["height_m"] == 30.0 and frame["line_azimuth_deg"] == 340.5
    assert frame["levels"] == [10.0, 20.0] and [list(p) for p in frame["silhouette"]] == [
        [0.0, 5.0],
        [30.0, 5.0],
    ]
    assert frame["presets"][0]["id"] == "top" and frame["datum_label"] == "street level"
    assert review["profile_id"] == "building_facade"
    assert [(z["id"], z["min_m"], z["max_m"]) for z in review["zones"]] == [
        ("top", 20.0, None),
        ("mid", 10.0, 20.0),
        ("low", None, 10.0),
    ]


def test_poses_are_kit_poses_and_manual_poses_are_kept(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, ids, mid = region_params(tmp_path, handle, types)
    with handle.session() as s:
        s.add(
            ImagePose(
                image_id=ids["p02"],
                asset_model_id=mid,
                position=[9, 9, 9],
                target=[0, 9, 0],
                up=[0, 1, 0],
                hfov_deg=50.0,
                vfov_deg=40.0,
                source="manual",
            )
        )
    result = run_kit_import(Ctx(handle, params))
    assert result["poses"] == {"written": 2, "kept_manual": 1, "missing": 0}
    with handle.session() as s:
        p1 = s.get(ImagePose, {"image_id": ids["p01"], "asset_model_id": mid})
        p2 = s.get(ImagePose, {"image_id": ids["p02"], "asset_model_id": mid})
        p3 = s.get(ImagePose, {"image_id": ids["p03"], "asset_model_id": mid})
        assert (p1.source, p1.position, p1.target, p1.hfov_deg, p1.sequence) == (
            "kit",
            [20.0, 10.0, 0.0],
            [0.0, 10.0, 0.0],
            40.0,
            "Flight A",
        )
        assert p3.sequence == "Flight B"
        assert (p2.source, p2.position) == ("manual", [9, 9, 9])


def test_review_statuses_follow_the_assessment(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, ids, _ = photo_params(tmp_path, handle, types)
    result = run_kit_import(Ctx(handle, params))
    assert result["statuses"] == {"finding": 1, "none": 1, "uncertain": 0, "not_assessed": 1}
    with handle.session() as s:
        r1, r2, r3 = (s.get(ImageReview, ids[k]) for k in ("p001", "p002", "p003"))
        assert (r1.status, r1.note, r1.coverage, r1.uncertain_coverage) == (
            "finding",
            "Rust at the seam",
            0.0125,
            0.005,
        )
        assert (r2.status, r3.status) == ("none", "not_assessed")
        assert s.get(Image, ids["p002"]).marked_empty is True


def test_a_none_status_on_a_photo_with_ground_truth_is_skipped_not_fatal(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, ids, _ = photo_params(tmp_path, handle, types)
    with handle.session() as s:
        s.add(
            Box(
                image_id=ids["p002"],
                class_id=types["corrosion"]["id"],
                x=1,
                y=1,
                w=5,
                h=5,
                provenance_kind="person",
                review_state="accepted",
            )
        )
    result = run_kit_import(Ctx(handle, params))
    assert result["skipped"] == [{"kit_key": "p002", "reason": "status_conflict"}]
    assert result["statuses"] == {"finding": 1, "none": 0, "uncertain": 0, "not_assessed": 1}
    with handle.session() as s:
        assert s.get(ImageReview, ids["p001"]).status == "finding"
        assert s.get(Image, ids["p002"]).marked_empty is False


def test_unmapped_classes_are_refused_before_any_write(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, mid = region_params(tmp_path, handle, types)
    params["class_map"] = {"cladding": types["cladding"]["id"]}
    before = table_counts(handle)
    with pytest.raises(JobFailure, match="staining"):
        run_kit_import(Ctx(handle, params))
    assert table_counts(handle) == before
    with handle.session() as s:
        assert s.get(AssetModel, mid).frame is None


def test_a_type_that_is_not_a_defect_type_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = region_params(tmp_path, handle, types)
    params["class_map"]["staining"] = "not-a-type"
    with pytest.raises(JobFailure, match="not a defect type"):
        run_kit_import(Ctx(handle, params))


def test_a_model_without_a_3d_model_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = region_params(tmp_path, handle, types, model=seed_empty_model(handle))
    with pytest.raises(JobFailure, match="no 3D model"):
        run_kit_import(Ctx(handle, params))


def test_no_matched_photo_is_refused(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params, _, _ = region_params(
        tmp_path,
        handle,
        types,
        rename={k: f"x/{k}.JPG" for k in ("p01", "p02", "p03")},
        retime={k: "2020:01:01 00:00:00" for k in ("p01", "p02", "p03")},
    )
    with pytest.raises(JobFailure, match="No kit photo matches"):
        run_kit_import(Ctx(handle, params))


def test_new_model_imports_the_kits_glb_in_the_same_job(tmp_path, client, project, handle):
    types = kit_types(client, project)
    glb = tmp_path / "tower.glb"
    glb.write_bytes(trimesh.creation.box(extents=(10, 30, 10)).export(file_type="glb"))
    kit = make_region_kit(tmp_path / "kit", glb=glb)
    params, _, _ = region_params(tmp_path, handle, types, kit=kit)
    params["asset_model_id"], params["new_model_name"] = None, "Kit tower"
    ctx = Ctx(handle, params)
    result = run_kit_import(ctx)
    with handle.session() as s:
        m = s.get(AssetModel, result["asset_model_id"])
        v = s.query(AssetModelVersion).filter_by(model_id=m.id, version=1).one()
        assert (m.name, m.asset_type, m.current_version) == ("Kit tower", "building-facade", 1)
        assert (v.kind, v.glb_status) == ("imported", "ready")
        assert m.frame["height_m"] == 30.0  # the kit's height wins over the mesh's
    assert ctx.runner.submitted == []  # the GLB import ran inside this job, nothing was queued


def test_origin_from_a_reference_point_and_the_stack_centre():
    o = kit_origin(
        {
            "reference_latitude": 29.0,
            "reference_longitude": 48.0,
            "ground_altitude_assumed": 31.7,
            "stack_center_EN": [100.0, 200.0],
        }
    )
    lat = 29.0 + math.degrees(200.0 / EARTH_RADIUS_M)
    assert o.lat == pytest.approx(lat)
    assert o.lon == pytest.approx(48.0 + math.degrees(100.0 / (EARTH_RADIUS_M * math.cos(math.radians(lat)))))
    assert o.ground_alt_m == 31.7
    assert kit_origin({}) is None


def test_child_context_scales_progress_and_swallows_chained_jobs(handle):
    parent = Ctx(handle, {})
    child = ChildContext(parent, {"a": 1}, 0.5, 0.8, swallow=frozenset({"asset_group"}))
    child.progress(0.5, "half")
    assert parent.messages[-1] == (pytest.approx(0.65), "half")
    assert child.runner.submit(handle, "asset_group", {"asset_model_id": "m"}).id is None
    child.runner.submit(handle, "other", {"x": 1})
    assert parent.runner.submitted == [("other", {"x": 1})]
    assert child.params == {"a": 1} and child.project is handle and child.cancelled is parent.cancelled
