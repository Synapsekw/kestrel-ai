"""Coordinates out of a map: CSV, GeoJSON, GeoPackage, summary (spec section 9)."""

import csv
import json
import sqlite3
import struct

import pytest
from geotiffs import make_geotiff
from pyproj import CRS, Transformer

from app.maps import geo_out, gpkg, service
from app.maps.georef import Georef, box_corners

UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)
BOX = geo_out.ExportBox("detection", "d1", "excavator", 0.9, "tp", "", 1000.0, 2000.0, 100.0, 50.0, None)
REF = Transformer.from_crs("EPSG:32633", "EPSG:4326", always_xy=True)


def test_csv_has_native_and_wgs84_corners(tmp_path):
    geo_out.write_csv(tmp_path / "b.csv", [BOX], Georef(GT, UTM33), 32633)
    row = next(csv.DictReader((tmp_path / "b.csv").open(encoding="utf-8")))
    assert list(row) == geo_out.CSV_COLUMNS
    cx, cy = 500000 + 1050 * 0.03, 4983000 - 2025 * 0.03
    assert float(row["cx"]) == pytest.approx(cx) and float(row["cy"]) == pytest.approx(cy)
    assert float(row["x1"]) == pytest.approx(500030.0) and float(row["y1"]) == pytest.approx(4982940.0)
    lon, lat = REF.transform(cx, cy)
    assert float(row["clon"]) == pytest.approx(lon, abs=1e-9) and float(row["clat"]) == pytest.approx(
        lat, abs=1e-9
    )
    assert row["epsg"] == "32633"
    # Geodesic size vs. the naive planar (native-CRS-unit) size differ by UTM's central-meridian
    # scale factor k0=0.9996 (the box sits ~30 m from the zone's central meridian, essentially at
    # k0): true ground width = 3.0 / 0.9996 (~0.04% larger), true area = 4.5 / 0.9996**2 (~0.08%
    # larger). rel=2e-3 comfortably covers that well-understood, exact effect.
    assert float(row["width_m"]) == pytest.approx(3.0, rel=2e-3)
    assert float(row["area_m2"]) == pytest.approx(4.5, rel=2e-3)


def test_csv_without_coordinates_keeps_pixels_only(tmp_path):
    geo_out.write_csv(tmp_path / "b.csv", [BOX], None, None)
    row = next(csv.DictReader((tmp_path / "b.csv").open(encoding="utf-8")))
    assert row["px_x"] == "1000.0" and row["cx"] == "" and row["clon"] == ""


def test_csv_threads_rotation_through_the_four_corners(tmp_path):
    """A rotated box (OBB wave 2): the exported corners must be the *rotated* ones, not the
    axis-aligned box's, cross-checked against `box_corners` plus an independent `Transformer`."""
    rotated = geo_out.ExportBox("detection", "d2", "dozer", 0.8, "", "", 1000.0, 2000.0, 100.0, 50.0, 30.0)
    georef = Georef(GT, UTM33)
    geo_out.write_csv(tmp_path / "r.csv", [rotated], georef, 32633)
    row = next(csv.DictReader((tmp_path / "r.csv").open(encoding="utf-8")))
    expected_native = [
        georef.pixel_to_native(px, py) for px, py in box_corners(1000.0, 2000.0, 100.0, 50.0, 30.0)
    ]
    for i, (nx, ny) in enumerate(expected_native, start=1):
        assert float(row[f"x{i}"]) == pytest.approx(nx)
        assert float(row[f"y{i}"]) == pytest.approx(ny)
        lon, lat = REF.transform(nx, ny)
        assert float(row[f"lon{i}"]) == pytest.approx(lon, abs=1e-9)
        assert float(row[f"lat{i}"]) == pytest.approx(lat, abs=1e-9)
    # The rotated box's corners must differ from the axis-aligned ones (angle actually threaded).
    axis_aligned = [
        georef.pixel_to_native(px, py) for px, py in box_corners(1000.0, 2000.0, 100.0, 50.0, None)
    ]
    assert expected_native != axis_aligned


def test_csv_size_is_measured_on_the_ellipsoid_not_native_crs_units(
    client, project_id, wait_job, tmp_path, handle
):
    """EPSG:2278 (NAD83 / Texas South Central, US survey feet): a native-CRS-unit distance is in
    feet, not metres, so `math.dist` over native corners would report a size about 3.28x too
    large if mislabelled as metres. 1 US survey foot = 1200/3937 m exactly (0.3048006096012192...).
    A 100 x 50 px box at 2.0 ftUS/px is 200 x 100 ftUS = (200, 100) * 1200/3937 m in truth.

    The raster is placed near this CRS's own false origin (1968500, 13123333 ftUS, lat_0=27.83,
    lon_0=-99: the projection's own reference point), where the Lambert Conformal Conic's scale
    distortion is at its minimum by construction (State Plane zones are designed for <1:10000
    distortion inside their true extent) -- placing it at an arbitrary UTM-style coordinate like
    (500000, 4983000) instead would put the box hundreds of kilometres outside the zone's actual
    area of use, where the projection is still mathematically defined but genuinely distorts by
    several percent, which would make this test's "expected" arithmetic itself unreliable."""
    pixel_ft = 2.0
    path = make_geotiff(
        tmp_path / "tx.tif", 300, 300, crs="EPSG:2278", pixel=pixel_ft, origin=(1968500.0, 13200000.0)
    )
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path)})
    map_id = r.json()["map"]["id"]
    wait_job(project_id, r.json()["job"]["id"])
    gmap = service.get_map(handle, map_id)
    georef = Georef(gmap.geotransform, gmap.crs_wkt)
    box = geo_out.ExportBox("detection", "d3", "excavator", 0.9, "tp", "", 0.0, 0.0, 100.0, 50.0, None)
    out = tmp_path / "tx.csv"
    geo_out.write_csv(out, [box], georef, gmap.epsg)
    row = next(csv.DictReader(out.open(encoding="utf-8")))
    ftus_to_m = 1200 / 3937  # the exact US survey foot, ~0.3048006096012192 m
    expected_w = 100 * pixel_ft * ftus_to_m
    expected_h = 50 * pixel_ft * ftus_to_m
    assert float(row["width_m"]) == pytest.approx(expected_w, rel=1e-3)
    assert float(row["height_m"]) == pytest.approx(expected_h, rel=1e-3)
    # The old (buggy) native-unit reading would have been ~3.28x these values; assert we are not it.
    assert float(row["width_m"]) < expected_w * 1.5


def test_geojson_is_wgs84_closed_polygons(tmp_path):
    zone = ("z1", "Zone 1", [[0, 0], [100, 0], [100, 100]])
    geo_out.write_geojson(tmp_path / "b.geojson", [BOX], [zone], Georef(GT, UTM33))
    fc = json.loads((tmp_path / "b.geojson").read_text("utf-8"))
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) == 2
    ring = fc["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 5
    assert ring[0] == pytest.approx(list(REF.transform(500030.0, 4982940.0)), abs=1e-9)
    assert fc["features"][0]["properties"] == {
        "kind": "detection",
        "id": "d1",
        "class": "excavator",
        "confidence": 0.9,
        "match": "tp",
        "source": "",
    }
    assert fc["features"][1]["properties"]["kind"] == "zone"


def _blob(con, table):
    return con.execute(f"SELECT geom FROM {table}").fetchone()[0]


def test_geopackage_structure_and_geometry(tmp_path):
    ring = [(1.0, 2.0), (3.0, 2.0), (3.0, 4.0), (1.0, 4.0)]
    layer = gpkg.Layer(
        "detections",
        [("class", "TEXT"), ("confidence", "REAL")],
        [(ring, {"class": "excavator", "confidence": 0.9})],
    )
    path = tmp_path / "x.gpkg"
    gpkg.write_gpkg(
        path,
        [layer],
        srs_id=32633,
        srs_name="WGS 84 / UTM zone 33N",
        organization="EPSG",
        organization_id=32633,
        wkt=UTM33,
    )
    con = sqlite3.connect(path)
    assert con.execute("PRAGMA application_id").fetchone()[0] == 0x47504B47
    assert (
        con.execute("SELECT srs_id FROM gpkg_contents WHERE table_name='detections'").fetchone()[0] == 32633
    )
    assert con.execute("SELECT min_x, max_y FROM gpkg_contents").fetchone() == (1.0, 4.0)
    assert con.execute("SELECT geometry_type_name FROM gpkg_geometry_columns").fetchone()[0] == "POLYGON"
    blob = _blob(con, "detections")
    assert blob[:2] == b"GP" and blob[3] == 0b011  # little endian, xy envelope
    assert struct.unpack("<i", blob[4:8])[0] == 32633
    assert struct.unpack("<4d", blob[8:40]) == (1.0, 3.0, 2.0, 4.0)
    wkb = blob[40:]
    assert wkb[0] == 1 and struct.unpack("<III", wkb[1:13]) == (3, 1, 5)  # polygon, 1 ring, 5 points
    assert struct.unpack("<2d", wkb[13:29]) == (1.0, 2.0)
    assert con.execute("SELECT class, confidence FROM detections").fetchone() == ("excavator", 0.9)


BASE = "/api/v1/projects"


def test_export_job_writes_every_format(client, project_id, wait_job, tmp_path, handle, project):
    r = client.post(
        f"{BASE}/{project_id}/maps", json={"path": str(make_geotiff(tmp_path / "a.tif", 3000, 3000))}
    )
    map_id = r.json()["map"]["id"]
    wait_job(project_id, r.json()["job"]["id"])
    cls = project["classes"][0]["id"]
    client.post(
        f"{BASE}/{project_id}/maps/{map_id}/zones",
        json={"name": "Z", "polygon": [[0, 0], [3000, 0], [3000, 3000]]},
    )
    client.post(
        f"{BASE}/{project_id}/maps/{map_id}/labels",
        json={"class_id": cls, "x": 1000, "y": 2000, "w": 100, "h": 50},
    )
    body = {"map_id": map_id, "content": "labels", "formats": ["geojson", "gpkg", "csv"]}
    r = client.post(f"{BASE}/{project_id}/map-exports", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    folder = handle.folder / job["result"]["folder"]
    names = sorted(p.name for p in folder.iterdir())
    assert names == ["map-a-labels.csv", "map-a-labels.geojson", "map-a-labels.gpkg", "map-a-summary.json"]
    assert job["result"]["box_count"] == 1
    summary = json.loads((folder / "map-a-summary.json").read_text("utf-8"))
    assert summary["map"]["epsg"] == 32633 and summary["counts"] == {"excavator": 1}


def test_geo_formats_need_coordinates(client, project_id, wait_job, tmp_path):
    r = client.post(
        f"{BASE}/{project_id}/maps", json={"path": str(make_geotiff(tmp_path / "p.tif", 300, 300, crs=None))}
    )
    map_id = r.json()["map"]["id"]
    wait_job(project_id, r.json()["job"]["id"])
    bad = client.post(
        f"{BASE}/{project_id}/map-exports",
        json={"map_id": map_id, "content": "labels", "formats": ["geojson"]},
    )
    assert bad.status_code == 422 and "no coordinates" in bad.json()["error"]["message"]
    ok = client.post(
        f"{BASE}/{project_id}/map-exports", json={"map_id": map_id, "content": "labels", "formats": ["csv"]}
    )
    assert ok.status_code == 202


def test_run_content_needs_a_run_of_this_map(client, project_id, wait_job, tmp_path):
    r = client.post(
        f"{BASE}/{project_id}/maps", json={"path": str(make_geotiff(tmp_path / "a.tif", 300, 300))}
    )
    map_id = r.json()["map"]["id"]
    wait_job(project_id, r.json()["job"]["id"])
    bad = client.post(
        f"{BASE}/{project_id}/map-exports", json={"map_id": map_id, "content": "run", "formats": ["csv"]}
    )
    assert bad.status_code == 422
