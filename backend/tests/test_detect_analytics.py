"""Detection analytics (plan 2 unit A): per source, per site area and per photo batch, from run rows."""

from datetime import UTC, date, datetime

import pytest
from pyproj import CRS
from sqlalchemy import event

from app.db.models import Box, GeoMap, Image, MapDetection, MapRun, QueryRun, SiteArea, Source
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
    """Project class name -> id."""
    return {c["name"]: c["id"] for c in project["classes"]}


@pytest.fixture
def site(handle, classes):
    """Two map surveys (April, May) and two photo batches, with runs and site areas.

    The "whole" area covers map pixels 0..500 on both maps; the "edge" area crosses the maps'
    right edge, so it is only partly covered.
    """
    exc, dump = classes["excavator"], classes["dump_truck"]
    with handle.session() as s:
        for i, (name, when) in enumerate([("April", date(2026, 4, 1)), ("May", date(2026, 5, 1))], start=1):
            s.add(Source(id=f"src-map-{i}", folder=f"E:/nowhere/{i}.tif", site=name, kind="map", label=name))
            s.flush()
            s.add(
                GeoMap(
                    id=f"map-{i}",
                    name=name,
                    status="ready",
                    source_path=f"E:/nowhere/{i}.tif",
                    source_size=1,
                    width=1000,
                    height=1000,
                    geotransform=list(GT),
                    crs_wkt=UTM33,
                    captured_on=when,
                    created_at=_at(i),
                    source_id=f"src-map-{i}",
                )
            )
        s.add(
            SiteArea(
                id="area-whole", name="Whole", polygon_wgs84=_wgs(_square(0, 0, 500, 500)), created_at=_at(1)
            )
        )
        s.add(
            SiteArea(
                id="area-edge", name="Edge", polygon_wgs84=_wgs(_square(900, 0, 1100, 500)), created_at=_at(2)
            )
        )
        s.flush()
        # April: one run; May: an old run and a newer one on the same model and confidence.
        s.add(
            MapRun(
                id="run-apr",
                map_id="map-1",
                source_id="src-map-1",
                kind="local_model",
                model_id="mod",
                model_name="mod",
                conf=0.25,
                counts={exc: 6, dump: 2},
                verified_counts={exc: 4},
                area_counts={"area-whole": {exc: {"total": 3, "verified": 2}}},
                created_at=_at(10),
            )
        )
        s.add(
            MapRun(
                id="run-may-old",
                map_id="map-2",
                source_id="src-map-2",
                kind="local_model",
                model_id="mod",
                model_name="mod",
                conf=0.25,
                counts={exc: 99},
                created_at=_at(11),
            )
        )
        s.add(
            MapRun(
                id="run-may",
                map_id="map-2",
                source_id="src-map-2",
                kind="local_model",
                model_id="mod",
                model_name="mod",
                conf=0.25,
                counts={exc: 8},
                verified_counts={exc: 8},
                area_counts={
                    "area-whole": {exc: {"total": 5, "verified": 5}},
                    "area-edge": {exc: {"total": 1, "verified": 1}},
                },
                created_at=_at(12),
            )
        )
        s.flush()
        # The April run's detections: 5 reviewed (4 accepted, 1 rejected), 3 still to do.
        states = ["accepted"] * 4 + ["rejected"] + ["unreviewed"] * 3
        for i, state in enumerate(states):
            s.add(
                MapDetection(
                    id=f"apr-d{i}",
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

        # Photos: batch A has two runs, the older one pinned; batch B has none.
        s.add(
            Source(
                id="src-photo-a",
                folder="E:/photos/a",
                site="a",
                kind="images",
                label="Flight A",
                captured_on=date(2026, 3, 1),
                image_count=12,
            )
        )
        s.add(Source(id="src-photo-b", folder="E:/photos/b", site="b", kind="images", image_count=4))
        s.flush()
        s.add(
            QueryRun(
                id="q-pinned",
                kind="local_model",
                model_id="mod",
                model_name="mod",
                source_id="src-photo-a",
                pinned=True,
                counts={exc: 31, dump: 9},
                verified_counts={exc: 12},
                created_at=_at(13),
            )
        )
        s.add(
            QueryRun(
                id="q-newer",
                kind="local_model",
                model_id="mod",
                model_name="mod",
                source_id="src-photo-a",
                counts={exc: 1},
                created_at=_at(14),
            )
        )
        s.add(Image(id="img-1", path="images/1.jpg", width=10, height=10, source_id="src-photo-a"))
        s.flush()
        for i, state in enumerate(["accepted", "unreviewed", "rejected"]):
            s.add(
                Box(
                    id=f"box-{i}",
                    image_id="img-1",
                    class_id=exc,
                    x=0,
                    y=0,
                    w=1,
                    h=1,
                    provenance_kind="local_model",
                    query_run_id="q-pinned",
                    review_state=state,
                )
            )


@pytest.fixture
def statements(handle):
    """Every SQL statement the project database runs while the test is recording."""
    seen: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        seen.append(statement)

    event.listen(handle.engine, "before_cursor_execute", record)
    yield seen
    event.remove(handle.engine, "before_cursor_execute", record)


def test_a_map_source_reports_objects_from_its_chosen_run(client, project_id, classes, site):
    body = client.get(f"{BASE}/{project_id}/analytics/sources/src-map-1").json()
    assert body["unit"] == "objects"
    assert body["image_count"] is None
    assert body["source"]["id"] == "src-map-1"
    assert body["source"]["kind"] == "map"
    assert body["source"]["map_id"] == "map-1"
    assert body["run"]["id"] == "run-apr"
    assert body["run"]["kind"] == "map"
    assert body["run"]["model_name"] == "mod"
    rows = {r["name"]: (r["total"], r["verified"]) for r in body["classes"]}
    assert rows == {"excavator": (6, 4), "dump_truck": (2, 0)}
    assert body["review"] == {"total": 8, "reviewed": 5}
    assert body["run"]["review"] == body["review"]


def test_the_newest_run_on_the_basis_speaks_for_a_map(client, project_id, site):
    body = client.get(f"{BASE}/{project_id}/analytics/sources/src-map-2").json()
    assert body["run"]["id"] == "run-may"


def test_a_pinned_map_run_takes_precedence(client, project_id, handle, site):
    with handle.session() as s:
        s.get(MapRun, "run-may-old").pinned = True
    body = client.get(f"{BASE}/{project_id}/analytics/sources/src-map-2").json()
    assert body["run"]["id"] == "run-may-old"
    assert body["run"]["pinned"] is True


def test_a_photo_source_reports_detections_from_the_pinned_run(client, project_id, site):
    body = client.get(f"{BASE}/{project_id}/analytics/sources/src-photo-a").json()
    assert body["unit"] == "detections"
    assert body["image_count"] == 12
    assert body["run"]["id"] == "q-pinned"
    assert body["run"]["kind"] == "images"
    assert body["run"]["source_label"] == "Flight A"
    rows = {r["name"]: (r["total"], r["verified"]) for r in body["classes"]}
    assert rows == {"excavator": (31, 12), "dump_truck": (9, 0)}
    assert body["review"] == {"total": 3, "reviewed": 2}


def test_without_a_pin_the_newest_photo_run_speaks(client, project_id, handle, site):
    with handle.session() as s:
        s.get(QueryRun, "q-pinned").pinned = False
    body = client.get(f"{BASE}/{project_id}/analytics/sources/src-photo-a").json()
    assert body["run"]["id"] == "q-newer"


def test_a_source_with_no_run_has_empty_counts(client, project_id, site):
    body = client.get(f"{BASE}/{project_id}/analytics/sources/src-photo-b").json()
    assert body["run"] is None
    assert body["classes"] == []
    assert body["review"] == {"total": 0, "reviewed": 0}


def test_an_unknown_source_is_404(client, project_id, site):
    assert client.get(f"{BASE}/{project_id}/analytics/sources/nope").status_code == 404


def test_area_analytics_follow_the_timeline_and_mark_partial_cover(client, project_id, classes, site):
    body = client.get(f"{BASE}/{project_id}/analytics/areas").json()
    exc = classes["excavator"]
    assert body["areas"] == [{"id": "area-whole", "name": "Whole"}, {"id": "area-edge", "name": "Edge"}]
    assert [s["map_name"] for s in body["surveys"]] == ["April", "May"]
    april, may = body["surveys"]
    assert april["captured_on"] == "2026-04-01"
    assert april["state"] == "ok"
    assert april["per_area"]["area-whole"] == {"partial": False, "counts": {exc: {"total": 3, "verified": 2}}}
    assert april["per_area"]["area-edge"] == {"partial": True, "counts": {}}
    assert may["per_area"]["area-edge"] == {"partial": True, "counts": {exc: {"total": 1, "verified": 1}}}
    assert may["per_area"]["area-whole"]["counts"] == {exc: {"total": 5, "verified": 5}}


def test_an_area_that_misses_a_map_has_no_cell(client, project_id, handle, site):
    far = [[100.0, 10.0], [100.1, 10.0], [100.1, 10.1]]
    with handle.session() as s:
        s.add(SiteArea(id="area-far", name="Far", polygon_wgs84=far, created_at=_at(3)))
    body = client.get(f"{BASE}/{project_id}/analytics/areas").json()
    assert {"id": "area-far", "name": "Far"} in body["areas"]
    assert all("area-far" not in s["per_area"] for s in body["surveys"])


def test_area_analytics_can_compare_on_another_basis(client, project_id, handle, site):
    body = client.get(f"{BASE}/{project_id}/analytics/areas", params={"model_id": "other"}).json()
    assert [s["state"] for s in body["surveys"]] == ["not_comparable", "not_comparable"]


def test_area_analytics_without_maps_is_empty(client, project_id):
    body = client.get(f"{BASE}/{project_id}/analytics/areas").json()
    assert body == {"areas": [], "surveys": []}


def test_photo_batches_list_every_photo_source(client, project_id, site):
    body = client.get(f"{BASE}/{project_id}/analytics/photo-batches").json()
    by_id = {b["source"]["id"]: b for b in body["batches"]}
    assert set(by_id) == {"src-photo-a", "src-photo-b"}
    assert by_id["src-photo-a"]["run"]["id"] == "q-pinned"
    assert {r["name"]: r["total"] for r in by_id["src-photo-a"]["classes"]} == {
        "excavator": 31,
        "dump_truck": 9,
    }
    assert by_id["src-photo-b"]["run"] is None
    assert by_id["src-photo-b"]["classes"] == []


def test_area_and_photo_analytics_never_read_detections(client, project_id, site, statements):
    client.get(f"{BASE}/{project_id}/analytics/areas")
    client.get(f"{BASE}/{project_id}/analytics/areas", params={"verified_only": True})
    client.get(f"{BASE}/{project_id}/analytics/photo-batches")
    assert statements, "the listener saw nothing"
    assert not [q for q in statements if "map_detection" in q]


def test_source_analytics_reads_detections_only_as_one_grouped_count(client, project_id, site, statements):
    """Review progress is an index-served grouped COUNT; no detection row is ever read."""
    client.get(f"{BASE}/{project_id}/analytics/sources/src-map-1")
    touching = [q for q in statements if "map_detection" in q]
    assert len(touching) == 1
    assert "count(" in touching[0].lower() and "group by" in touching[0].lower()


@pytest.mark.parametrize(
    ("path", "template"),
    [
        ("analytics/sources/src-map-1", "analytics/sources/{sourceId}"),
        ("analytics/sources/src-photo-a", "analytics/sources/{sourceId}"),
        ("analytics/sources/src-photo-b", "analytics/sources/{sourceId}"),
        ("analytics/areas", "analytics/areas"),
        ("analytics/photo-batches", "analytics/photo-batches"),
        ("site-areas", "site-areas"),
    ],
)
def test_responses_match_the_contract_in_a_detection_project(client, project_id, site, path, template):
    """test_contract.py calls these in a training project (409); here they answer with real data."""
    from test_contract import schema

    response = client.get(f"{BASE}/{project_id}/{path}")
    assert response.status_code == 200, response.text
    schema[f"/api/v1/projects/{{projectId}}/{template}"]["GET"].validate_response(response)
