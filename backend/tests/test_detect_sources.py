"""Detection sources (plan 2026-09-23-detection-workspace, unit D; spec section 7.1).

Photo sources carry the earliest EXIF capture date; a map import creates a `map` source whose survey
date mirrors `GeoMap.captured_on`, and a PATCH on either side keeps the two equal.
"""

from datetime import date

import pytest
from geotiffs import make_geotiff

from app.db.models import GeoMap, Source

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture
def import_map(client, wait_job):
    def _import(project_id, path, **body):
        r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path), **body})
        assert r.status_code == 202, r.text
        job = wait_job(project_id, r.json()["job"]["id"])
        assert job["state"] == "succeeded", job
        return r.json()["map"]["id"]

    return _import


def _map_source(handle, map_id: str) -> Source:
    with handle.session() as s:
        gmap = s.get(GeoMap, map_id)
        assert gmap.source_id is not None
        row = s.get(Source, gmap.source_id)
        s.expunge(row)
        return row


def test_photo_import_is_an_images_source_dated_by_the_earliest_capture(
    client, project_id, import_source, tmp_path, make_jpeg
):
    folder = tmp_path / "flight"
    make_jpeg(folder / "a.jpg", 64, 48, seed=1, exif={"DateTimeOriginal": "2026:09:15 10:00:00"})
    make_jpeg(folder / "b.jpg", 64, 48, seed=2, exif={"DateTimeOriginal": "2026:09:14 09:30:00"})
    make_jpeg(folder / "c.jpg", 64, 48, seed=3)
    source_id = import_source(project_id, folder)

    out = client.get(f"{BASE}/{project_id}/sources/{source_id}").json()
    assert out["kind"] == "images"
    assert out["captured_on"] == "2026-09-14"
    assert out["map_id"] is None
    assert out["label"] is None


def test_import_never_overwrites_a_date_the_operator_set(
    client, project_id, import_source, tmp_path, make_jpeg
):
    folder = tmp_path / "flight"
    make_jpeg(folder / "a.jpg", 64, 48, seed=1, exif={"DateTimeOriginal": "2026:09:15 10:00:00"})
    source_id = import_source(project_id, folder)
    r = client.patch(f"{BASE}/{project_id}/sources/{source_id}", json={"captured_on": "2026-01-02"})
    assert r.status_code == 200, r.text
    import_source(project_id, folder)  # a re-import of the same folder
    assert client.get(f"{BASE}/{project_id}/sources/{source_id}").json()["captured_on"] == "2026-01-02"


def test_photos_without_exif_leave_the_date_unset(client, project_id, import_source, tmp_path, make_jpeg):
    folder = tmp_path / "plain"
    make_jpeg(folder / "a.jpg", 64, 48, seed=1)
    source_id = import_source(project_id, folder)
    assert client.get(f"{BASE}/{project_id}/sources/{source_id}").json()["captured_on"] is None


def test_map_import_creates_a_linked_map_source(client, project_id, import_map, tmp_path, handle):
    map_id = import_map(project_id, make_geotiff(tmp_path / "site.tif", 300, 200), name="May survey")
    src = _map_source(handle, map_id)
    assert src.kind == "map"
    assert src.label == "May survey"

    items = client.get(f"{BASE}/{project_id}/sources").json()["items"]
    [listed] = [i for i in items if i["id"] == src.id]
    assert listed["kind"] == "map"
    assert listed["map_id"] == map_id
    assert listed["label"] == "May survey"
    gmap = client.get(f"{BASE}/{project_id}/maps/{map_id}").json()
    assert listed["captured_on"] == gmap["captured_on"]


def test_patch_on_a_map_source_writes_the_map_date(client, project_id, import_map, tmp_path, handle):
    map_id = import_map(project_id, make_geotiff(tmp_path / "site.tif", 300, 200))
    src = _map_source(handle, map_id)

    r = client.patch(
        f"{BASE}/{project_id}/sources/{src.id}", json={"captured_on": "2026-05-20", "label": "May"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["captured_on"] == "2026-05-20"
    assert r.json()["label"] == "May"
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}").json()["captured_on"] == "2026-05-20"

    r = client.patch(f"{BASE}/{project_id}/sources/{src.id}", json={"captured_on": None})
    assert r.status_code == 200, r.text
    assert r.json()["captured_on"] is None
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}").json()["captured_on"] is None


def test_patch_on_the_map_writes_the_source_date(client, project_id, import_map, tmp_path, handle):
    map_id = import_map(project_id, make_geotiff(tmp_path / "site.tif", 300, 200))
    src = _map_source(handle, map_id)
    r = client.patch(f"{BASE}/{project_id}/maps/{map_id}", json={"captured_on": "2026-06-01"})
    assert r.status_code == 200, r.text
    assert _map_source(handle, map_id).captured_on == date(2026, 6, 1)
    assert client.get(f"{BASE}/{project_id}/sources/{src.id}").json()["captured_on"] == "2026-06-01"


def test_patch_leaves_unsent_fields_alone(client, project_id, import_source, tmp_path, make_jpeg):
    folder = tmp_path / "flight"
    make_jpeg(folder / "a.jpg", 64, 48, seed=1, exif={"DateTimeOriginal": "2026:09:15 10:00:00"})
    source_id = import_source(project_id, folder)
    r = client.patch(f"{BASE}/{project_id}/sources/{source_id}", json={"label": "Flight 15 Sep"})
    assert r.status_code == 200, r.text
    assert r.json()["captured_on"] == "2026-09-15"
    assert r.json()["label"] == "Flight 15 Sep"


def test_patch_unknown_source_is_404(client, project_id):
    r = client.patch(f"{BASE}/{project_id}/sources/nope", json={"label": "x"})
    assert r.status_code == 404, r.text


def test_patch_rejects_unknown_fields(client, project_id, import_source, tmp_path, make_jpeg):
    make_jpeg(tmp_path / "f" / "a.jpg", 64, 48, seed=1)
    source_id = import_source(project_id, tmp_path / "f")
    r = client.patch(f"{BASE}/{project_id}/sources/{source_id}", json={"kind": "map"})
    assert r.status_code == 422, r.text


def test_patch_source_in_a_training_project_is_409(client, tmp_path, import_source, make_jpeg):
    body = {"name": "Train", "folder": str(tmp_path / "t"), "classes": [], "kind": "train"}
    pid = client.post(BASE, json=body).json()["id"]
    make_jpeg(tmp_path / "f" / "a.jpg", 64, 48, seed=1)
    source_id = import_source(pid, tmp_path / "f")
    r = client.patch(f"{BASE}/{pid}/sources/{source_id}", json={"label": "x"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "wrong_project_kind"


def test_a_moved_map_gets_its_own_map_source(app, client, tmp_path, wait_job):
    """A past map moved out of a training project becomes a source in the detection project."""
    from app.maps import service as maps_service
    from app.maps.schemas import GeoMapCreate

    train = client.post(
        BASE, json={"name": "Old", "folder": str(tmp_path / "old"), "classes": [], "kind": "train"}
    ).json()
    old = app.state.projects.get(train["id"])
    row = maps_service.create_map(
        old, GeoMapCreate(path=str(make_geotiff(tmp_path / "s.tif", 300, 200)), name="Site")
    )
    job = app.state.jobs.submit(old, "map_import", {"map_id": row.id, "name": row.name})
    assert wait_job(old.id, job.id)["state"] == "succeeded"
    maps_service.set_captured_on(old, row.id, date(2026, 4, 1))

    target = client.post(
        BASE, json={"name": "New", "folder": str(tmp_path / "new"), "classes": [], "kind": "detect"}
    ).json()["id"]
    r = client.post(f"{BASE}/{train['id']}/maps/{row.id}/move", json={"target_project_id": target})
    assert r.status_code == 202, r.text
    assert wait_job(target, r.json()["job"]["id"])["state"] == "succeeded"

    items = client.get(f"{BASE}/{target}/sources").json()["items"]
    assert [(i["kind"], i["label"], i["map_id"], i["captured_on"]) for i in items] == [
        ("map", "Site", row.id, "2026-04-01")
    ]


def test_deleting_a_map_removes_its_map_source(client, project_id, import_map, tmp_path, handle):
    map_id = import_map(project_id, make_geotiff(tmp_path / "site.tif", 300, 200))
    src = _map_source(handle, map_id)
    assert client.delete(f"{BASE}/{project_id}/maps/{map_id}").status_code == 204
    assert client.get(f"{BASE}/{project_id}/sources/{src.id}").status_code == 404
