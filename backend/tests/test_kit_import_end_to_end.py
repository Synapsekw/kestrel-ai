"""The whole import through the API and the job runner (spec §6.5 steps 1 to 7, §12 "Kit import")."""

import json
import shutil

import numpy as np
import pytest
import yaml
from fixtures.synthetic_tower import make_tower
from kit_fixtures import (
    PHOTO_PHOTOS,
    PHOTO_SIZE,
    REGION_PHOTOS,
    REGION_SIZE,
    Ctx,
    draw_mask,
    kit_patch,
    kit_types,
    make_photo_kit,
    make_region_kit,
    seed_images,
    seed_ready_model,
    table_counts,
)
from PIL import Image
from sqlalchemy import func, select

from app.asset_review.kit_import import run_kit_import
from app.asset_review.kit_masks import load_mask
from app.db.models import AssetModel, Finding, FindingSighting, ImagePose
from app.findings import attachments
from app.jobs.cancellation import JobCancelled, JobFailure

API = "/api/v1/projects"


def start(client, project, wait_job, **body):
    r = client.post(f"{API}/{project['id']}/review-imports", json={"dry_run": False, **body})
    assert r.status_code == 202, r.text
    job = wait_job(project["id"], r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    return job["result"]


def findings_of(handle, mid):
    with handle.session() as s:
        rows = (
            s.execute(
                select(Finding)
                .where(Finding.asset_model_id == mid, Finding.status != "closed")
                .order_by(Finding.number)
            )
            .scalars()
            .all()
        )
        for f in rows:
            s.expunge(f)
        return rows


def test_region_kit_becomes_grouped_findings_with_the_kits_notes(tmp_path, client, project, handle, wait_job):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    mid = seed_ready_model(handle)
    res = start(
        client,
        project,
        wait_job,
        folder=str(kit),
        image_source_id=source_id,
        asset_model_id=mid,
        class_map={"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]},
    )
    assert res["sightings"] == 3 and res["placement"]["mode"] == "replay"
    assert res["grouping"] == {"created": 2, "kept": 0, "merged": 0, "split": 0}
    assert res["findings"] == {"total": 2, "by_severity": {"1": 1, "2": 1}} and res["notes"] == 2
    by_sev = {f.severity: f for f in findings_of(handle, mid)}
    assert (by_sev[2].sighting_count, by_sev[2].note, by_sev[2].type_id) == (
        2,
        "Chipped cladding panel",
        types["cladding"]["id"],
    )
    assert (by_sev[1].sighting_count, by_sev[1].note) == (1, "Run-off staining")
    with handle.session() as s:
        assert s.scalar(select(FindingSighting.id).where(FindingSighting.finding_id.is_(None))) is None


def test_photo_kit_finding_keeps_its_source_mask(tmp_path, client, project, handle, wait_job):
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    res = start(
        client,
        project,
        wait_job,
        folder=str(kit),
        image_source_id=source_id,
        asset_model_id=mid,
        class_map={"moderate": types["corrosion"]["id"]},
    )
    assert res["sightings"] == 2  # one per mask region
    assert res["findings"] == {"total": 1, "by_severity": {"2": 1}} and res["attachments"] == 1
    (finding,) = findings_of(handle, mid)
    assert (finding.note, finding.sighting_count, finding.placement) == ("Rust at the seam", 2, "patch")
    (att,) = attachments.list_for(handle, finding.id)
    assert att.original_name == "p001 mask.png"
    with Image.open(handle.folder / att.path) as im:
        assert im.mode == "P"
    assert np.array_equal(load_mask(handle.folder / att.path), draw_mask())


def test_photo_unit_sightings_are_never_clustered(tmp_path, client, project, handle, wait_job):
    """Two photos of one spot stay two findings; each photo's regions are one finding."""
    types = kit_types(client, project)
    kit = make_photo_kit(tmp_path / "kit")
    ass = json.loads((kit / "assessment.json").read_text("utf-8"))
    ass["photos"]["p002"] = {
        "status": "finding",
        "severity": 2,
        "note": "Rust again",
        "coverage": 1.0,
        "uncertain": 0.0,
    }
    (kit / "assessment.json").write_text(json.dumps(ass), "utf-8")
    shutil.copy(kit / "masks" / "p001.png", kit / "masks" / "p002.png")
    surface = json.loads((kit / "surface.json").read_text("utf-8"))
    surface["patches"].append(kit_patch({"photo": "p002"}, [0.55, 40.05, -1.0], [0.3, 0.0, -0.95], "Stack"))
    (kit / "surface.json").write_text(json.dumps(surface), "utf-8")
    source_id, _ = seed_images(handle, PHOTO_PHOTOS, PHOTO_SIZE)
    mid = seed_ready_model(handle, "Flare")
    res = start(
        client,
        project,
        wait_job,
        folder=str(kit),
        image_source_id=source_id,
        asset_model_id=mid,
        class_map={"moderate": types["corrosion"]["id"]},
    )
    assert (res["sightings"], res["findings"]["total"], res["attachments"]) == (4, 2, 2)


def test_without_surface_json_asset_place_runs_inside_the_import(tmp_path, client, project, handle, wait_job):
    """P1's synthetic tower: a new model from the kit's GLB, J3's placement, then grouping; no other
    job is queued (the import runs them in its own thread)."""
    types = kit_types(client, project)
    tower = make_tower(tmp_path / "tower", photos=False)
    by_name = {p["name"]: p for p in tower.poses}
    sightings = [(by_name[s.image_name], s.box) for t in tower.truth for s in t.sightings][:3]
    photos, findings = [], []
    for i, (pose, (x, y, w, h)) in enumerate(sightings):
        kid = f"t{i + 1}"
        photos.append(
            {
                "id": kid,
                "name": pose["name"],
                "source_name": f"tower/{kid}_{pose['name']}",
                "time": pose["time"],
                "sequence": "1",
                "width": tower.image_size[0],
                "height": tower.image_size[1],
                "position": list(pose["position"]),
                "target": list(pose["target"]),
                "up": list(pose["up"]),
                "hfov": pose["hfov"],
                "vfov": pose["vfov"],
            }
        )
        findings.append(
            {
                "id": f"{kid}-1",
                "photo": kid,
                "class": "corrosion",
                "severity": 2,
                "bbox": [x, y, x + w, y + h],
                "note": "Rust on a leg",
            }
        )
    kit = tmp_path / "kit"
    kit.mkdir()
    (kit / "job.yaml").write_text(
        yaml.safe_dump(
            {
                "job": {"id": "tower", "profile": "telecom-tower"},
                "asset": {"height": tower.frame.height_m},
            }
        ),
        "utf-8",
    )
    origin = tower.frame.origin
    (kit / "cameras.json").write_text(
        json.dumps(
            {
                "photos": photos,
                "alignment": {"origin": [origin.lat, origin.lon, origin.ground_alt_m]},
            }
        ),
        "utf-8",
    )
    (kit / "assessment.json").write_text(
        json.dumps(
            {
                "photos": {p["id"]: {"status": "finding", "note": ""} for p in photos},
                "findings": findings,
            }
        ),
        "utf-8",
    )
    shutil.copy(tower.glb_path, kit / "model.glb")
    source_id, _ = seed_images(handle, photos, tower.image_size, scale=1.0)
    res = start(
        client,
        project,
        wait_job,
        folder=str(kit),
        image_source_id=source_id,
        new_model_name="Synthetic tower",
        class_map={"corrosion": types["corrosion"]["id"]},
    )
    assert res["placement"]["mode"] == "computed" and res["placement"]["pending"] == 0
    assert res["sightings"] == 3 and 1 <= res["findings"]["total"] <= 3
    with handle.session() as s:
        m = s.get(AssetModel, res["asset_model_id"])
        assert (m.name, m.current_version) == ("Synthetic tower", 1)
        assert s.scalar(select(FindingSighting.id).where(FindingSighting.finding_id.is_(None))) is None
    jobs = client.get(f"{API}/{project['id']}/jobs").json()["items"]
    assert not {j["type"] for j in jobs} & {"asset_glb_import", "asset_place", "asset_group"}


def _params(tmp_path, handle, types, kit):
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    return {
        "folder": str(kit),
        "image_source_id": source_id,
        "asset_model_id": seed_ready_model(handle),
        "new_model_name": None,
        "dry_run": False,
        "class_map": {"cladding": types["cladding"]["id"], "staining": types["staining"]["id"]},
    }


def _nothing_left(handle):
    counts = table_counts(handle)
    with handle.session() as s:
        poses = s.scalar(select(func.count()).select_from(ImagePose).where(ImagePose.source == "kit"))
    assert (counts["box"], counts["finding_sighting"], poses) == (0, 0, 0)


def test_cancel_during_the_replay_undoes_the_records(tmp_path, client, project, handle):
    types = kit_types(client, project)
    params = _params(tmp_path, handle, types, make_region_kit(tmp_path / "kit"))
    with pytest.raises(JobCancelled):
        run_kit_import(Ctx(handle, params, cancel_on="Replaying the kit"))
    _nothing_left(handle)


def test_a_truncated_surface_json_fails_the_job_and_undoes_the_records(tmp_path, client, project, handle):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    text = (kit / "surface.json").read_text("utf-8")
    (kit / "surface.json").write_text(text[: len(text) // 2], "utf-8")
    params = _params(tmp_path, handle, types, kit)
    with pytest.raises(JobFailure, match="surface.json"):
        run_kit_import(Ctx(handle, params))
    _nothing_left(handle)
