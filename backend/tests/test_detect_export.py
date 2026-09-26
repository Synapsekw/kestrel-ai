"""Detection export (plan 2 unit E): the numbers CSV, the PDF report per source, the GeoPackage additions."""

import csv
import sqlite3
from datetime import UTC, date, datetime

import pytest
from geotiffs import make_geotiff
from PIL import Image as PILImage
from pyproj import CRS

from app.db.models import GeoMap, Image, MapDetection, MapRun, QueryRun, SiteArea, Source
from app.detect import export_csv, export_pdf
from app.maps.georef import Georef

BASE = "/api/v1/projects"
UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)
GEO = Georef(GT, UTM33)


@pytest.fixture
def project_kind() -> str:
    return "detect"


def _wgs(pixels):
    return [list(GEO.pixel_to_wgs84(x, y)) for x, y in pixels]


def _square(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _at(day: int) -> datetime:
    return datetime(2026, 2, day, tzinfo=UTC)


@pytest.fixture
def classes(project) -> dict[str, str]:
    return {c["name"]: c["id"] for c in project["classes"]}


@pytest.fixture
def site(handle, classes, tmp_path):
    """One map survey with two site areas (one only partly on the map) and one photo batch."""
    exc, dump = classes["excavator"], classes["dump_truck"]
    photos = tmp_path / "photos"
    photos.mkdir()
    with handle.session() as s:
        s.add(Source(id="src-map", folder="E:/nowhere/a.tif", site="April", kind="map", label="April flight"))
        s.flush()
        s.add(
            GeoMap(
                id="map-1",
                name="April flight",
                status="ready",
                source_path="E:/nowhere/a.tif",
                source_size=1,
                width=1000,
                height=1000,
                geotransform=list(GT),
                crs_wkt=UTM33,
                captured_on=date(2026, 4, 1),
                created_at=_at(1),
                source_id="src-map",
            )
        )
        s.get(Source, "src-map").captured_on = date(2026, 4, 1)
        s.add(
            SiteArea(
                id="area-yard", name="Yard", polygon_wgs84=_wgs(_square(0, 0, 500, 500)), created_at=_at(1)
            )
        )
        s.add(
            SiteArea(
                id="area-edge", name="Edge", polygon_wgs84=_wgs(_square(900, 0, 1100, 500)), created_at=_at(2)
            )
        )
        s.flush()
        s.add(
            MapRun(
                id="run-apr",
                map_id="map-1",
                source_id="src-map",
                kind="local_model",
                model_id="mod",
                model_name="mod",
                model_snapshot={"id": "mod", "name": "Site model v3", "origin": "trained"},
                conf=0.3,
                counts={exc: 6, dump: 2},
                verified_counts={exc: 4},
                area_counts={"area-yard": {exc: {"total": 3, "verified": 2}}},
                created_at=_at(10),
            )
        )
        s.flush()
        for i, state in enumerate(["accepted"] * 4 + ["rejected"] + ["unreviewed"] * 3):
            s.add(
                MapDetection(
                    id=f"d{i}",
                    run_id="run-apr",
                    class_id=exc,
                    confidence=0.9,
                    x=10 * i,
                    y=10,
                    w=5,
                    h=5,
                    review_state=state,
                )
            )
        s.add(
            Source(
                id="src-photo",
                folder=str(photos),
                site="a",
                kind="images",
                label="Flight A",
                captured_on=date(2026, 3, 1),
                image_count=2,
            )
        )
        s.flush()
        for i in range(2):
            rel = f"images/p{i}.jpg"
            (handle.folder / "images").mkdir(exist_ok=True)
            PILImage.new("RGB", (64, 48), (200, 180, 120)).save(handle.folder / rel)
            s.add(Image(id=f"img-{i}", path=rel, width=64, height=48, source_id="src-photo"))
        s.add(
            QueryRun(
                id="q-1",
                kind="local_model",
                model_id="mod",
                model_name="mod",
                model_snapshot={"id": "mod", "name": "Site model v3", "origin": "trained"},
                source_id="src-photo",
                conf=0.25,
                counts={exc: 31, dump: 9},
                verified_counts={exc: 12},
                created_at=_at(13),
            )
        )
    return {"exc": exc, "dump": dump}


# --- CSV ------------------------------------------------------------------------------------------


def test_csv_rows_are_one_per_source_class_and_area(handle, site):
    reports = export_csv.gather(handle)
    rows = [{k: str(v) for k, v in r.items()} for r in export_csv.rows(reports)]
    assert list(rows[0]) == export_csv.COLUMNS
    got = {(r["source"], r["class"], r["area"]): (r["total"], r["verified"]) for r in rows}
    assert got == {
        ("Flight A", "excavator", ""): ("31", "12"),
        ("Flight A", "dump_truck", ""): ("9", "0"),
        ("April flight", "excavator", ""): ("6", "4"),
        ("April flight", "dump_truck", ""): ("2", "0"),
        ("April flight", "excavator", "Yard"): ("3", "2"),
        ("April flight", "dump_truck", "Yard"): ("0", "0"),
        ("April flight", "excavator", "Edge"): ("0", "0"),
        ("April flight", "dump_truck", "Edge"): ("0", "0"),
    }
    photo = next(r for r in rows if r["source"] == "Flight A")
    assert photo["survey_date"] == "2026-03-01"
    assert photo["source_kind"] == "images" and photo["unit"] == "detections"
    assert photo["model"] == "Site model v3" and photo["confidence"] == "0.25"
    mapped = next(r for r in rows if r["source"] == "April flight")
    assert mapped["survey_date"] == "2026-04-01"
    assert mapped["source_kind"] == "map" and mapped["unit"] == "objects"
    # Oldest survey first.
    assert [r["source"] for r in rows][0] == "Flight A"


def test_csv_for_one_source_only(handle, site):
    rows = export_csv.rows(export_csv.gather(handle, "src-photo"))
    assert {r["source"] for r in rows} == {"Flight A"}


def test_a_source_without_a_run_writes_no_rows(handle, site):
    with handle.session() as s:
        s.add(Source(id="src-empty", folder="E:/x", site="x", kind="images", label="Empty"))
    rows = export_csv.rows(export_csv.gather(handle))
    assert "Empty" not in {r["source"] for r in rows}


def test_csv_export_job_writes_the_file(client, project_id, handle, wait_job, site):
    r = client.post(f"{BASE}/{project_id}/detect-exports", json={"format": "csv"})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["type"] == "detect_export"
    folder = handle.folder / job["result"]["folder"]
    assert job["result"]["folder"].startswith("exports/")
    [name] = job["result"]["files"]
    assert name.startswith("detect-t-") and name.endswith(".csv")
    with (folder / name).open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 8
    assert list(rows[0]) == export_csv.COLUMNS


@pytest.mark.parametrize("fmt", ["csv", "pdf"])
def test_an_export_with_no_run_yet_fails_plainly_and_leaves_no_folder(
    client, project_id, handle, wait_job, fmt
):
    r = client.post(f"{BASE}/{project_id}/detect-exports", json={"format": fmt})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "failed", job
    assert job["error"] == "No source has a detection run yet, so there is nothing to export."
    exports = handle.exports_dir
    assert not exports.exists() or not any(exports.iterdir())


def test_export_of_an_unknown_source_is_404(client, project_id, site):
    r = client.post(f"{BASE}/{project_id}/detect-exports", json={"format": "pdf", "source_id": "nope"})
    assert r.status_code == 404


def test_a_training_project_gets_409(client, project_dir, tmp_path):
    body = {"name": "Tr", "folder": str(tmp_path / "tr"), "classes": [], "kind": "train"}
    pid = client.post(f"{BASE}", json=body).json()["id"]
    r = client.post(f"{BASE}/{pid}/detect-exports", json={"format": "csv"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "wrong_project_kind"


# --- PDF ------------------------------------------------------------------------------------------


def _story_text(story) -> str:
    """Every paragraph's text and every table cell of a platypus story, as one string."""
    out: list[str] = []
    for flowable in story:
        if hasattr(flowable, "getPlainText"):
            out.append(flowable.getPlainText())
        for row in getattr(flowable, "_cellvalues", []) or []:
            for cell in row:
                out.append(cell.getPlainText() if hasattr(cell, "getPlainText") else str(cell))
    return "\n".join(out)


def test_pdf_story_for_a_map_names_the_classes_areas_and_verified_numbers(handle, site):
    [report] = export_csv.gather(handle, "src-map")
    text = _story_text(export_pdf.story(report, project_name="T", overview=None))
    assert "April flight" in text and "2026-04-01" in text
    assert "Site model v3" in text and "trained" in text
    assert "0.30" in text
    assert "5 of 8 reviewed" in text
    assert "excavator" in text and "dump_truck" in text
    assert "6" in text and "4" in text
    assert "Yard" in text and "Edge" in text and "partly" in text
    assert "objects on the orthomosaic" in text and "at confidence" in text


def test_pdf_story_for_photos_says_detections_across_photos(handle, site):
    [report] = export_csv.gather(handle, "src-photo")
    text = _story_text(export_pdf.story(report, project_name="T", overview=None))
    assert "detections across 2 photos" in text
    assert "same object can appear in several photos" in text
    assert "31" in text and "12" in text


def test_contact_sheet_is_three_across_from_thumbnails(handle, site):
    [report] = export_csv.gather(handle, "src-photo")
    sheet = export_pdf.overview_image(handle, report)
    assert sheet is not None
    # Three thumbnails to a row; two photos fill one row.
    assert sheet.size == (3 * export_pdf.CELL, export_pdf.CELL)


def test_pdf_export_job_writes_one_report_per_source(client, project_id, handle, wait_job, site):
    r = client.post(f"{BASE}/{project_id}/detect-exports", json={"format": "pdf"})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    files = sorted(job["result"]["files"])
    assert files == ["detect-april-flight.pdf", "detect-flight-a.pdf"]
    folder = handle.folder / job["result"]["folder"]
    for name in files:
        data = (folder / name).read_bytes()
        assert data.startswith(b"%PDF") and len(data) > 1000


def test_pdf_export_for_one_source(client, project_id, handle, wait_job, site):
    r = client.post(f"{BASE}/{project_id}/detect-exports", json={"format": "pdf", "source_id": "src-photo"})
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"]["files"] == ["detect-flight-a.pdf"]


# --- GeoPackage -----------------------------------------------------------------------------------


def test_geopackage_has_review_state_and_a_site_areas_layer(
    client, project_id, handle, wait_job, tmp_path, classes
):
    r = client.post(
        f"{BASE}/{project_id}/maps", json={"path": str(make_geotiff(tmp_path / "a.tif", 1000, 1000))}
    )
    map_id = r.json()["map"]["id"]
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    exc = classes["excavator"]
    with handle.session() as s:
        gmap = s.get(GeoMap, map_id)
        geo = Georef(gmap.geotransform, gmap.crs_wkt)
        poly = [list(geo.pixel_to_wgs84(x, y)) for x, y in _square(0, 0, 500, 500)]
        s.add(SiteArea(id="area-yard", name="Yard", polygon_wgs84=poly, created_at=_at(1)))
        s.add(
            MapRun(id="run-g", map_id=map_id, kind="local_model", model_name="m", conf=0.25, counts={exc: 2})
        )
        s.flush()
        s.add(MapDetection(id="g1", run_id="run-g", class_id=exc, confidence=0.9, x=10, y=10, w=5, h=5))
        s.add(
            MapDetection(
                id="g2",
                run_id="run-g",
                class_id=exc,
                confidence=0.8,
                x=50,
                y=10,
                w=5,
                h=5,
                review_state="accepted",
            )
        )
    body = {"map_id": map_id, "content": "run", "run_id": "run-g", "formats": ["gpkg"]}
    r = client.post(f"{BASE}/{project_id}/map-exports", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    path = handle.folder / job["result"]["folder"] / "map-a-detections.gpkg"
    con = sqlite3.connect(path)
    try:
        rows = dict(con.execute("SELECT box_id, review_state FROM detections").fetchall())
        assert rows == {"g1": "unreviewed", "g2": "accepted"}
        assert con.execute("SELECT DISTINCT class, class_id FROM detections").fetchall() == [
            ("excavator", exc)
        ]
        areas = con.execute("SELECT area_id, name, partial FROM site_areas").fetchall()
        assert areas == [("area-yard", "Yard", 0)]
        layers = {t for (t,) in con.execute("SELECT table_name FROM gpkg_contents")}
        assert "site_areas" in layers
    finally:
        con.close()
