"""Import a GeoTIFF through the API, then read its metadata, preview and tiles (spec 4 and 5)."""

import pytest
from geotiffs import make_geotiff

BASE = "/api/v1/projects"


@pytest.fixture
def import_map(client, wait_job):
    def _import(project_id, path, **body):
        r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path), **body})
        assert r.status_code == 202, r.text
        job = wait_job(project_id, r.json()["job"]["id"])
        return r.json()["map"]["id"], job

    return _import


def test_import_utm_map(client, project_id, import_map, tmp_path, handle):
    src = make_geotiff(tmp_path / "site.tif", 1200, 700)
    map_id, job = import_map(project_id, src, name="Site")
    assert job["state"] == "succeeded", job
    m = client.get(f"{BASE}/{project_id}/maps/{map_id}").json()
    assert m["status"] == "ready" and m["name"] == "Site"
    assert (m["width"], m["height"], m["epsg"]) == (1200, 700, 32633)
    assert m["gsd_cm"] == pytest.approx(3.0)
    assert m["tile_grid"] == {"tile_size": 256, "max_zoom": 3}
    assert m["bounds_native"] == pytest.approx([500000, 4982979, 500036, 4983000])
    assert (handle.folder / "maps" / map_id / "map.tif").is_file()
    assert src.is_file()  # the source is only ever read
    items = client.get(f"{BASE}/{project_id}/maps").json()["items"]
    assert [i["id"] for i in items] == [map_id]


def test_preview_and_tiles(client, project_id, import_map, tmp_path):
    map_id, _ = import_map(project_id, make_geotiff(tmp_path / "a.tif", 1200, 700))
    r = client.get(f"{BASE}/{project_id}/maps/{map_id}/preview")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    t = client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/3/0/0")
    assert t.status_code == 200 and t.headers["content-type"] == "image/jpeg"
    assert "immutable" in t.headers["cache-control"]
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/3/40/40").status_code == 204
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/0/0/0").headers["content-type"] == "image/png"


def test_map_without_coordinates(client, project_id, import_map, tmp_path):
    map_id, job = import_map(project_id, make_geotiff(tmp_path / "plain.tif", 300, 300, crs=None))
    assert job["state"] == "succeeded"
    m = client.get(f"{BASE}/{project_id}/maps/{map_id}").json()
    assert m["crs_wkt"] is None and m["gsd_cm"] is None and m["bounds_wgs84"] is None


def test_unreadable_file_fails_the_map_with_a_reason(client, project_id, import_map, tmp_path, handle):
    bad = tmp_path / "bad.tif"
    bad.write_text("nope")
    map_id, job = import_map(project_id, bad)
    assert job["state"] == "failed" and "not a readable raster" in job["error"]
    m = client.get(f"{BASE}/{project_id}/maps/{map_id}").json()
    assert m["status"] == "failed" and "not a readable raster" in m["error"]
    assert not (handle.folder / "maps" / map_id).exists()


def test_missing_or_wrong_file_is_404(client, project_id, tmp_path):
    # 404, not 422: a well-formed path that is not a usable map file is a missing resource, not a
    # malformed request, and the contract's positive-data-acceptance check (test_contract.py) forbids
    # rejecting schema-valid bodies with 422 (see app/datasets/router.py::create_source, same rule).
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(tmp_path / "nope.tif")})
    assert r.status_code == 404
    (tmp_path / "x.png").write_bytes(b"x")
    assert client.post(f"{BASE}/{project_id}/maps", json={"path": str(tmp_path / "x.png")}).status_code == 404


def test_tiles_of_a_map_that_is_not_ready_are_409(client, project_id, handle):
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name="m", status="importing", source_path="x", source_size=1, width=10, height=10)
        s.add(row)
        s.flush()
        map_id = row.id
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}/tiles/0/0/0").status_code == 409


def test_delete_removes_the_folder(client, project_id, import_map, tmp_path, handle):
    map_id, _ = import_map(project_id, make_geotiff(tmp_path / "a.tif", 300, 300))
    assert client.delete(f"{BASE}/{project_id}/maps/{map_id}").status_code == 204
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}").status_code == 404
    assert not (handle.folder / "maps" / map_id).exists()


def test_captured_on_is_set_cleared_and_validated(client, project_id, handle):
    """The survey date: when the imagery was flown, which is not when the file was imported."""
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name="survey A", status="ready", source_path="E:/nowhere/a.tif", source_size=1)
        s.add(row)
        s.flush()
        map_id = row.id
    url = f"{BASE}/{project_id}/maps/{map_id}"
    assert client.get(url).json()["captured_on"] is None

    r = client.patch(url, json={"captured_on": "2026-04-15"})
    assert r.status_code == 200, r.text
    assert r.json()["captured_on"] == "2026-04-15"
    assert client.get(url).json()["captured_on"] == "2026-04-15"

    assert client.patch(url, json={"captured_on": None}).json()["captured_on"] is None
    assert client.patch(url, json={"captured_on": "15/04/2026"}).status_code == 422
