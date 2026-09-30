"""`GET /overview/site` (spec 2026-09-30-project-landing section 4.2): the site's bounds by priority
map > point cloud > photo GPS, and a photo-point sample that is one bounded primary-key read."""

import re
from datetime import date

from sqlalchemy import event

from app.db.models import GeoMap, Image, PointCloud, Source

API = "/api/v1"
IMAGE_READ = re.compile(r"\bFROM\s+\"?image\"?\b", re.IGNORECASE)


def _site(client, project) -> dict:
    r = client.get(f"{API}/projects/{project['id']}/overview/site")
    assert r.status_code == 200, r.text
    return r.json()


def _images(handle, n: int, *, gps: bool = True) -> None:
    with handle.session() as s:
        src = Source(folder="C:/f", site="A", image_count=n)
        s.add(src)
        s.flush()
        s.add_all(
            Image(
                path=f"images/{i}.jpg",
                width=10,
                height=10,
                source_id=src.id,
                lon=20.0 + (i % 50) * 1e-4 if gps else None,
                lat=44.0 + (i // 50) * 1e-4 if gps else None,
            )
            for i in range(n)
        )


def test_an_empty_project_has_no_site(client, project):
    assert _site(client, project) == {
        "center": None,
        "bounds_wgs84": None,
        "source": None,
        "area_m2": None,
        "photo_points": [],
        "photo_points_total": 0,
    }


def test_site_without_gps(client, project, handle):
    _images(handle, 20, gps=False)
    out = _site(client, project)
    assert (out["center"], out["source"], out["photo_points"], out["photo_points_total"]) == (
        None,
        None,
        [],
        0,
    )


def test_photos_give_the_bounds_when_there_is_no_map_or_cloud(client, project, handle):
    _images(handle, 100)
    out = _site(client, project)
    assert out["source"] == "images"
    assert out["photo_points_total"] == 100
    assert len(out["photo_points"]) == 100
    minlon, minlat, maxlon, maxlat = out["bounds_wgs84"]
    assert (round(minlon, 4), round(minlat, 4), round(maxlon, 4), round(maxlat, 4)) == (
        20.0,
        44.0,
        20.0049,
        44.0001,
    )
    assert out["center"] == [(minlon + maxlon) / 2, (minlat + maxlat) / 2]
    assert out["area_m2"] > 0


def test_a_cloud_beats_photos_and_a_map_beats_a_cloud(client, project, handle):
    _images(handle, 10)
    with handle.session() as s:
        s.add(
            PointCloud(
                name="c",
                status="ready",
                source_path="C:/c.laz",
                source_size=1,
                bounds_wgs84=[20.1, 44.1, 20.2, 44.2],
            )
        )
    assert _site(client, project)["source"] == "point_cloud"
    with handle.session() as s:
        s.add(
            GeoMap(
                name="m",
                status="ready",
                source_path="C:/m.tif",
                source_size=1,
                captured_on=date(2026, 4, 1),
                bounds_wgs84=[20.3, 44.3, 20.4, 44.4],
            )
        )
    out = _site(client, project)
    assert out["source"] == "map"
    assert out["bounds_wgs84"] == [20.3, 44.3, 20.4, 44.4]
    assert len(out["photo_points"]) == 10  # the photo points come whatever gives the bounds


def test_site_sample_is_bounded(client, project, handle):
    _images(handle, 5000)
    seen: list[str] = []

    def before(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(handle.engine, "before_cursor_execute", before)
    try:
        out = _site(client, project)
    finally:
        event.remove(handle.engine, "before_cursor_execute", before)
    assert len(out["photo_points"]) == 500
    assert 4900 <= out["photo_points_total"] <= 5000
    image_reads = [st for st in seen if IMAGE_READ.search(st)]
    # max(rowid) and one keyed IN-list read: never a scan that grows with the project
    assert len(image_reads) == 2, image_reads
    assert any("max(rowid)" in st.lower() for st in image_reads)
