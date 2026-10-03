"""`POST /review-imports` with `dry_run` (spec §6.5, §8; index Review Focus 3)."""

from kit_fixtures import REGION_PHOTOS, REGION_SIZE, kit_types, make_region_kit, seed_images, table_counts

API = "/api/v1/projects"


def test_dry_run_reports_unmatched_and_writes_nothing(tmp_path, client, project, handle, wait_job):
    """Images imported from elsewhere or renamed: the dry run lists the photos it cannot match and
    leaves the project exactly as it was, with no asset model created."""
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(
        handle,
        REGION_PHOTOS,
        REGION_SIZE,
        rename={"p03": "other/IMG_9999.JPG"},
        retime={"p03": "2024:06:05 10:00:00"},
    )
    before = table_counts(handle)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "new_model_name": "Tower", "dry_run": True},
    )
    assert r.status_code == 202, r.text
    job = wait_job(project["id"], r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    res = job["result"]
    assert res["dry_run"] is True
    assert (res["unit"], res["profile"], res["profile_id"]) == (
        "region",
        "building-facade",
        "building_facade",
    )
    assert (res["photos"], res["matched"], res["matched_by"]) == (3, 2, {"path": 2})
    assert res["unmatched"] == ["flight-b/DJI_0003.JPG"] and res["unmatched_count"] == 1
    assert res["unmatched_reasons"] == [
        {"kit_id": "p03", "source_name": "flight-b/DJI_0003.JPG", "reason": "not_found"}
    ]
    assert res["statuses"] == {"finding": 2, "none": 0, "uncertain": 0, "not_assessed": 0}
    assert {c["key"]: (c["count"], c["type_id"]) for c in res["classes"]} == {
        "cladding": (2, types["cladding"]["id"]),
        "staining": (1, types["staining"]["id"]),
    }
    assert res["sightings"] == 3
    assert (res["has_surface"], res["has_glb"], res["has_merged"]) == (True, False, True)
    assert res["model"] == {"ready_version": None, "existing_sightings": 0}
    assert table_counts(handle) == before


def test_class_map_in_the_request_wins_over_the_suggestion(tmp_path, client, project, handle, wait_job):
    types = kit_types(client, project)
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={
            "folder": str(kit),
            "image_source_id": source_id,
            "new_model_name": "Tower",
            "dry_run": True,
            "class_map": {"staining": types["cladding"]["id"]},
        },
    )
    res = wait_job(project["id"], r.json()["job"]["id"])["result"]
    assert {c["key"]: c["type_id"] for c in res["classes"]}["staining"] == types["cladding"]["id"]


def test_a_folder_without_job_yaml_is_refused(tmp_path, client, project, handle):
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={
            "folder": str(tmp_path),
            "image_source_id": source_id,
            "new_model_name": "Tower",
            "dry_run": True,
        },
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "kit_invalid"


def test_exactly_one_of_model_and_name(tmp_path, client, project, handle):
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "dry_run": True},
    )
    err = r.json()["error"]
    assert r.status_code == 422 and err["code"] == "invalid_import"
    assert err["details"]["errors"][0]["path"] == "asset_model_id"


def test_dry_run_is_required(tmp_path, client, project, handle):
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "new_model_name": "Tower"},
    )
    assert r.status_code == 422


def test_class_map_is_capped_at_200_entries(tmp_path, client, project, handle):
    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={
            "folder": str(kit),
            "image_source_id": source_id,
            "new_model_name": "Tower",
            "dry_run": True,
            "class_map": {f"k{i}": "t" for i in range(201)},
        },
    )
    assert r.status_code == 422


def test_a_second_real_import_is_409_while_one_is_live(tmp_path, client, project, handle):
    from app.db.models import Job

    kit = make_region_kit(tmp_path / "kit")
    source_id, _ = seed_images(handle, REGION_PHOTOS, REGION_SIZE)
    with handle.session() as s:
        s.add(Job(type="review_kit_import", params={"dry_run": False}, state="running"))
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": source_id, "new_model_name": "Tower", "dry_run": False},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"


def test_unknown_image_source_is_404(tmp_path, client, project):
    kit = make_region_kit(tmp_path / "kit")
    r = client.post(
        f"{API}/{project['id']}/review-imports",
        json={"folder": str(kit), "image_source_id": "nope", "new_model_name": "Tower", "dry_run": True},
    )
    assert r.status_code == 404
