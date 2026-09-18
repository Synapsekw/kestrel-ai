import io

import pytest
from PIL import Image as PILImage

from app.db.models import Box

FLIGHTS = ("0001", "0002")


@pytest.fixture
def imported(client, project, import_source, tmp_path, make_jpeg):
    """20 synthetic frames in two flights: S_0001_0001..0010 and S_0002_0001..0010."""
    folder = tmp_path / "frames"
    for i in range(20):
        flight, frame = FLIGHTS[i // 10], i % 10 + 1
        make_jpeg(folder / f"S_{flight}_{frame:04d}.jpg", 320, 240, seed=i)
    source_id = import_source(project["id"], folder)
    return {"pid": project["id"], "source_id": source_id, "classes": project["classes"]}


def _list(client, pid, **params):
    r = client.get(f"/api/v1/projects/{pid}/images", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _add_boxes(client, pid, image_id, class_id):
    """Two boxes straight through the model: one accepted ground truth, one pending proposal."""
    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        s.add(
            Box(
                image_id=image_id,
                class_id=class_id,
                x=1,
                y=2,
                w=3,
                h=4,
                provenance_kind="person",
                review_state="accepted",
            )
        )
        s.add(
            Box(
                image_id=image_id,
                class_id=class_id,
                x=5,
                y=6,
                w=7,
                h=8,
                confidence=0.8,
                provenance_kind="local_model",
                review_state="unreviewed",
            )
        )


def test_list_images_after_import(imported, client):
    page = _list(client, imported["pid"])
    assert page["total"] == 20 and len(page["items"]) == 20 and page["next_cursor"] is None
    first = page["items"][0]
    assert first["path"] == "images/frames/S_0001_0001.jpg"
    assert first["file_name"] == "S_0001_0001.jpg"
    assert (first["width"], first["height"]) == (320, 240)
    assert first["source_id"] == imported["source_id"] and first["group_key"] == "0001"
    assert first["labeled"] is False and first["box_count"] == 0 and first["pending_count"] == 0
    assert first["max_pending_confidence"] is None


def test_keyset_pagination_is_stable_and_complete(imported, client):
    seen: list[str] = []
    cursor = None
    for expected in (7, 7, 6):
        params = {"limit": 7, "sort": "path", "order": "desc"}
        if cursor:
            params["cursor"] = cursor
        page = _list(client, imported["pid"], **params)
        assert len(page["items"]) == expected and page["total"] == 20
        seen += [i["file_name"] for i in page["items"]]
        cursor = page["next_cursor"]
    assert cursor is None
    assert len(set(seen)) == 20
    assert seen == sorted(seen, reverse=True)


def test_filters_by_group_search_and_ids(imported, client):
    pid = imported["pid"]
    assert _list(client, pid, group_key="0002")["total"] == 10
    assert _list(client, pid, search="s_0001_000")["total"] == 9  # case-insensitive, 0001..0009
    ids = [i["id"] for i in _list(client, pid, limit=3)["items"]]
    page = _list(client, pid, ids=",".join(ids), group_key="0002")  # ids override other filters
    assert page["total"] == 3 and {i["id"] for i in page["items"]} == set(ids)
    assert _list(client, pid, ids="no-such-id")["total"] == 0


def test_filters_and_sorts_on_box_counts(imported, client):
    pid = imported["pid"]
    target = _list(client, pid, limit=1)["items"][0]
    _add_boxes(client, pid, target["id"], imported["classes"][0]["id"])

    labeled = _list(client, pid, labeled="true")
    assert labeled["total"] == 1 and labeled["items"][0]["id"] == target["id"]
    assert _list(client, pid, labeled="false")["total"] == 19
    pending = _list(client, pid, has_pending="true")
    assert pending["total"] == 1 and pending["items"][0]["id"] == target["id"]

    top = _list(client, pid, sort="max_pending_confidence", order="desc")["items"][0]
    assert top["id"] == target["id"]
    assert top["box_count"] == 1 and top["pending_count"] == 1 and top["max_pending_confidence"] == 0.8
    assert top["labeled"] is True

    single = client.get(f"/api/v1/projects/{pid}/images/{target['id']}").json()
    assert single["box_count"] == 1 and single["pending_count"] == 1 and single["labeled"] is True


def test_sort_by_capture_time_tolerates_missing_exif(imported, client):
    page = _list(client, imported["pid"], sort="capture_time", order="desc")
    assert page["total"] == 20 and all(i["capture_time"] is None for i in page["items"])


def test_image_file_is_served_and_downscaled(imported, client, project_dir):
    pid = imported["pid"]
    image = _list(client, pid, limit=1)["items"][0]
    full = client.get(f"/api/v1/projects/{pid}/images/{image['id']}/file")
    assert full.status_code == 200 and full.headers["content-type"] == "image/jpeg"
    assert PILImage.open(io.BytesIO(full.content)).size == (320, 240)

    small = client.get(f"/api/v1/projects/{pid}/images/{image['id']}/file", params={"max_side": 160})
    assert small.status_code == 200 and PILImage.open(io.BytesIO(small.content)).size == (160, 120)
    assert (project_dir / "cache" / "resized" / f"{image['id']}_160.jpg").exists()
    # a second request is served from the cache
    assert (
        client.get(f"/api/v1/projects/{pid}/images/{image['id']}/file", params={"max_side": 160}).content
        == small.content
    )
    # asking for more than the image has returns the original, not an upscale
    big = client.get(f"/api/v1/projects/{pid}/images/{image['id']}/file", params={"max_side": 4000})
    assert PILImage.open(io.BytesIO(big.content)).size == (320, 240)


def test_thumbnail_is_256_and_cached(imported, client, project_dir):
    pid = imported["pid"]
    image = _list(client, pid, limit=1)["items"][0]
    r = client.get(f"/api/v1/projects/{pid}/images/{image['id']}/thumbnail")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert max(PILImage.open(io.BytesIO(r.content)).size) == 256
    assert (project_dir / "cache" / "thumbs" / f"{image['id']}.jpg").exists()


def test_max_side_below_the_contract_minimum_is_rejected(imported, client):
    pid = imported["pid"]
    image = _list(client, pid, limit=1)["items"][0]
    r = client.get(f"/api/v1/projects/{pid}/images/{image['id']}/file", params={"max_side": 10})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_unknown_image_is_not_found(imported, client):
    pid = imported["pid"]
    assert client.get(f"/api/v1/projects/{pid}/images/nope").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/images/nope/file").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/images/nope/thumbnail").status_code == 404


def test_bulk_delete_removes_rows_files_and_caches(imported, client, project_dir, tmp_path):
    pid = imported["pid"]
    items = _list(client, pid, limit=2)["items"]
    ids = [i["id"] for i in items]
    _add_boxes(client, pid, ids[0], imported["classes"][0]["id"])
    client.get(f"/api/v1/projects/{pid}/images/{ids[0]}/thumbnail")

    r = client.post(f"/api/v1/projects/{pid}/images/bulk-delete", json={"image_ids": ids})
    assert r.status_code == 200 and r.json() == {"deleted": 2}
    for item in items:
        assert not (project_dir / item["path"]).exists()
        assert client.get(f"/api/v1/projects/{pid}/images/{item['id']}").status_code == 404
    assert not (project_dir / "cache" / "thumbs" / f"{ids[0]}.jpg").exists()
    assert _list(client, pid)["total"] == 18
    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        assert s.query(Box).count() == 0  # boxes go with their image
    assert len(list((tmp_path / "frames").glob("*.jpg"))) == 20  # the source folder is untouched


def test_bulk_delete_ignores_unknown_ids(imported, client):
    r = client.post(f"/api/v1/projects/{imported['pid']}/images/bulk-delete", json={"image_ids": ["nope"]})
    assert r.status_code == 200 and r.json() == {"deleted": 0}


def test_real_frames_list_with_capture_time_and_gps(client, project, import_source, ahmadia_sample):
    pid = project["id"]
    import_source(pid, ahmadia_sample, site="ahmadia")
    page = _list(client, pid, sort="capture_time", order="asc", limit=1)
    assert page["total"] == 20
    first = page["items"][0]
    assert first["file_name"] == "IX-12-02491_0031_0001.jpg"
    assert first["capture_time"].startswith("2019-04-15T06:35:36")
    assert abs(first["lat"] - 29.49469) < 1e-4 and first["phash"] == "82a81f67f94615ae"
