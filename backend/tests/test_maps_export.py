"""Coordinates out of a map: CSV, GeoJSON, GeoPackage, summary (spec section 9)."""

import csv
import json
import sqlite3
import struct

import pytest
from geotiffs import make_geotiff
from pyproj import CRS, Transformer

from app.maps import geo_out, gpkg
from app.maps.georef import Georef

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
    assert float(row["width_m"]) == pytest.approx(3.0) and float(row["area_m2"]) == pytest.approx(4.5)


def test_csv_without_coordinates_keeps_pixels_only(tmp_path):
    geo_out.write_csv(tmp_path / "b.csv", [BOX], None, None)
    row = next(csv.DictReader((tmp_path / "b.csv").open(encoding="utf-8")))
    assert row["px_x"] == "1000.0" and row["cx"] == "" and row["clon"] == ""


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
