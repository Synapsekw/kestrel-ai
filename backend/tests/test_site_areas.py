"""Site areas (plan 2 unit A): CRUD, validation, and the `area_recount` job over every map run."""

from datetime import UTC, date, datetime

import pytest
from pyproj import CRS

from app.db.models import GeoMap, MapDetection, MapRun, SiteArea
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


def _add_map(s, map_id: str, *, georef: bool = True, when: date = date(2026, 4, 1)) -> None:
    s.add(
        GeoMap(
            id=map_id,
            name=map_id,
            status="ready",
            source_path=f"E:/nowhere/{map_id}.tif",
            source_size=1,
            width=1000,
            height=1000,
            geotransform=list(GT) if georef else None,
            crs_wkt=UTM33 if georef else None,
            captured_on=when,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
    )


def _add_run(s, run_id: str, map_id: str, detections: list[tuple[str, float, float, str]]) -> None:
    """detections: (class_id, centre x, centre y, review_state), 10x10 px boxes."""
    s.add(MapRun(id=run_id, map_id=map_id, kind="local_model", model_id="mod", model_name="mod", conf=0.25))
    s.flush()
    for i, (cls, cx, cy, state) in enumerate(detections):
        s.add(
            MapDetection(
                id=f"{run_id}-d{i}",
                run_id=run_id,
                class_id=cls,
                confidence=0.9,
                x=cx - 5,
                y=cy - 5,
                w=10,
                h=10,
                review_state=state,
            )
        )


@pytest.fixture
def two_maps(handle):
    with handle.session() as s:
        _add_map(s, "map-1")
        _add_map(s, "map-2", when=date(2026, 5, 1))
        _add_map(s, "map-flat", georef=False)
        _add_run(
            s,
            "run-1",
            "map-1",
            [("c1", 150, 150, "accepted"), ("c1", 160, 160, "unreviewed"), ("c2", 800, 800, "unreviewed")],
        )
        _add_run(s, "run-2", "map-2", [("c2", 120, 180, "unreviewed"), ("c1", 190, 110, "rejected")])


def _latest_recount(client, project_id: str, wait_job) -> dict:
    page = client.get(f"{BASE}/{project_id}/jobs", params={"type": "area_recount"}).json()
    assert page["items"], "no area_recount job was submitted"
    return wait_job(project_id, page["items"][0]["id"])


def _recount_jobs(client, project_id: str) -> int:
    return len(client.get(f"{BASE}/{project_id}/jobs", params={"type": "area_recount"}).json()["items"])


def test_create_list_rename_and_delete(client, project_id, wait_job):
    poly = _wgs(_square(100, 100, 200, 200))
    r = client.post(f"{BASE}/{project_id}/site-areas", json={"name": "Yard", "polygon_wgs84": poly})
    assert r.status_code == 201, r.text
    area = r.json()
    assert area["name"] == "Yard"
    assert area["polygon_wgs84"] == [pytest.approx(p) for p in poly]
    assert {"id", "created_at"} <= set(area)

    items = client.get(f"{BASE}/{project_id}/site-areas").json()["items"]
    assert [a["id"] for a in items] == [area["id"]]

    r = client.patch(f"{BASE}/{project_id}/site-areas/{area['id']}", json={"name": "North yard"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "North yard"
    assert r.json()["polygon_wgs84"] == area["polygon_wgs84"]

    r = client.delete(f"{BASE}/{project_id}/site-areas/{area['id']}")
    assert r.status_code == 204
    assert client.get(f"{BASE}/{project_id}/site-areas").json()["items"] == []
    assert client.delete(f"{BASE}/{project_id}/site-areas/{area['id']}").status_code == 404
    assert client.patch(f"{BASE}/{project_id}/site-areas/nope", json={"name": "x"}).status_code == 404
    _latest_recount(client, project_id, wait_job)


def test_a_polygon_drawn_on_a_map_is_stored_in_wgs84(client, project_id, two_maps):
    px = [[100, 100], [200, 100], [200, 200]]
    r = client.post(
        f"{BASE}/{project_id}/site-areas", json={"name": "A", "map_id": "map-1", "polygon_px": px}
    )
    assert r.status_code == 201, r.text
    got = r.json()["polygon_wgs84"]
    want = _wgs(px)
    for (lon, lat), (wlon, wlat) in zip(got, want, strict=True):
        assert lon == pytest.approx(wlon, abs=1e-9) and lat == pytest.approx(wlat, abs=1e-9)


@pytest.mark.parametrize(
    "body",
    [
        {"name": "two points", "polygon_wgs84": [[15.0, 45.0], [15.1, 45.0]]},
        {"name": "off the globe", "polygon_wgs84": [[15.0, 45.0], [15.1, 45.0], [15.1, 91.0]]},
        {"name": "lon too big", "polygon_wgs84": [[15.0, 45.0], [181.0, 45.0], [15.1, 45.1]]},
        {"name": "no outline"},
        {"name": "px without a map", "polygon_px": [[0, 0], [1, 0], [1, 1]]},
        {"name": "", "polygon_wgs84": [[15.0, 45.0], [15.1, 45.0], [15.1, 45.1]]},
    ],
)
def test_an_invalid_outline_is_refused(client, project_id, body):
    r = client.post(f"{BASE}/{project_id}/site-areas", json=body)
    assert r.status_code == 422, r.text
    assert client.get(f"{BASE}/{project_id}/site-areas").json()["items"] == []


def test_both_outlines_at_once_is_refused(client, project_id, two_maps):
    body = {
        "name": "both",
        "polygon_wgs84": _wgs(_square(1, 1, 2, 2)),
        "map_id": "map-1",
        "polygon_px": [[0, 0], [1, 0], [1, 1]],
    }
    assert client.post(f"{BASE}/{project_id}/site-areas", json=body).status_code == 422


def test_a_polygon_on_an_unknown_map_is_404(client, project_id):
    body = {"name": "A", "map_id": "nope", "polygon_px": [[0, 0], [1, 0], [1, 1]]}
    assert client.post(f"{BASE}/{project_id}/site-areas", json=body).status_code == 404


def test_a_polygon_on_a_map_without_georeference_is_refused(client, project_id, two_maps):
    body = {"name": "A", "map_id": "map-flat", "polygon_px": [[0, 0], [1, 0], [1, 1]]}
    r = client.post(f"{BASE}/{project_id}/site-areas", json=body)
    assert r.status_code == 422, r.text


def test_creating_an_area_recounts_every_map_run(client, project_id, handle, two_maps, wait_job):
    body = {"name": "A", "polygon_wgs84": _wgs(_square(100, 100, 200, 200))}
    area_id = client.post(f"{BASE}/{project_id}/site-areas", json=body).json()["id"]
    job = _latest_recount(client, project_id, wait_job)
    assert job["state"] == "succeeded", job
    with handle.session() as s:
        run1, run2 = s.get(MapRun, "run-1"), s.get(MapRun, "run-2")
        assert run1.area_counts == {area_id: {"c1": {"total": 2, "verified": 1}}}
        assert run2.area_counts == {area_id: {"c2": {"total": 1, "verified": 0}}}  # the rejected one is out
        assert run1.counts == {"c1": 2, "c2": 1}  # the recount keeps the totals right too


def test_redrawing_an_area_recounts_and_renaming_does_not(client, project_id, handle, two_maps, wait_job):
    body = {"name": "A", "polygon_wgs84": _wgs(_square(100, 100, 200, 200))}
    area_id = client.post(f"{BASE}/{project_id}/site-areas", json=body).json()["id"]
    _latest_recount(client, project_id, wait_job)
    assert _recount_jobs(client, project_id) == 1

    client.patch(f"{BASE}/{project_id}/site-areas/{area_id}", json={"name": "B"})
    assert _recount_jobs(client, project_id) == 1

    px = _square(700, 700, 900, 900)
    r = client.patch(
        f"{BASE}/{project_id}/site-areas/{area_id}",
        json={"map_id": "map-1", "polygon_px": [list(p) for p in px]},
    )
    assert r.status_code == 200, r.text
    assert _recount_jobs(client, project_id) == 2
    _latest_recount(client, project_id, wait_job)
    with handle.session() as s:
        assert s.get(MapRun, "run-1").area_counts == {area_id: {"c2": {"total": 1, "verified": 0}}}
        assert s.get(MapRun, "run-2").area_counts == {}


def test_deleting_an_area_drops_it_from_the_counts(client, project_id, handle, two_maps, wait_job):
    body = {"name": "A", "polygon_wgs84": _wgs(_square(100, 100, 200, 200))}
    area_id = client.post(f"{BASE}/{project_id}/site-areas", json=body).json()["id"]
    _latest_recount(client, project_id, wait_job)
    client.delete(f"{BASE}/{project_id}/site-areas/{area_id}")
    assert _recount_jobs(client, project_id) == 2
    _latest_recount(client, project_id, wait_job)
    with handle.session() as s:
        assert s.get(MapRun, "run-1").area_counts == {}
        assert s.get(SiteArea, area_id) is None


def test_a_review_write_during_the_recount_is_not_lost(
    client, project_id, handle, two_maps, wait_job, monkeypatch
):
    """The recount holds the write lock from its first read, so a review write that lands while it
    counts waits for it and applies on top, instead of being overwritten by the stale recount."""
    import threading

    from sqlalchemy import text

    import app.detect.counts as counts

    real = counts._grouped
    writers: list[threading.Thread] = []

    def review_write() -> None:  # a new unreviewed c1 detection on run-1, counted in SQL
        with handle.session() as s:
            s.add(
                MapDetection(
                    id="run-1-late",
                    run_id="run-1",
                    class_id="c1",
                    confidence=0.9,
                    x=500,
                    y=500,
                    w=10,
                    h=10,
                    review_state="unreviewed",
                )
            )
            s.execute(
                text(
                    "UPDATE map_run SET counts = json_set(counts, '$.c1', "
                    "coalesce(json_extract(counts, '$.c1'), 0) + 1) WHERE id = 'run-1'"
                )
            )

    def count_then_race(s, *args):
        out = real(s, *args)  # the recount has read run-1's counts and not yet written them
        if not writers:
            t = threading.Thread(target=review_write)
            writers.append(t)
            t.start()
            t.join(timeout=1.0)  # without the lock it commits here, and the recount overwrites it
        return out

    monkeypatch.setattr(counts, "_grouped", count_then_race)
    body = {"name": "A", "polygon_wgs84": _wgs(_square(100, 100, 200, 200))}
    client.post(f"{BASE}/{project_id}/site-areas", json=body)
    job = _latest_recount(client, project_id, wait_job)
    assert job["state"] == "succeeded", job
    writers[0].join(timeout=10)
    assert not writers[0].is_alive()
    with handle.session() as s:
        assert s.get(MapRun, "run-1").counts == {"c1": 3, "c2": 1}
