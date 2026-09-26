"""Review of detection runs (spec 2026-09-23 section 8, plan 2 unit V).

Every review write changes a detection's state and the run's counts in one transaction, so after
any sequence of actions the stored `counts`, `verified_counts` and `area_counts` equal a recount of
the same rows.
"""

from types import SimpleNamespace

import pytest
from pyproj import CRS
from sqlalchemy import select

from app.datasets import boxes
from app.db.models import Box, GeoMap, Image, MapDetection, MapRun, QueryRun, SiteArea, Source
from app.detect.areas import areas_for_map
from app.detect.counts import recount_map_run, recount_query_run
from app.maps.georef import Georef

BASE = "/api/v1/projects"
UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture
def cls(project) -> list[str]:
    """The project's class ids, in hotkey order."""
    return [c["id"] for c in project["classes"]]


def _square_area(area_id: str, x0: float, y0: float, x1: float, y1: float) -> SiteArea:
    g = Georef(GT, UTM33)
    pixels = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return SiteArea(id=area_id, name=area_id, polygon_wgs84=[list(g.pixel_to_wgs84(x, y)) for x, y in pixels])


def _det(det_id, class_id, cx, cy, conf=0.9, state="unreviewed") -> MapDetection:
    return MapDetection(
        id=det_id,
        run_id="r1",
        class_id=class_id,
        confidence=conf,
        x=cx - 5,
        y=cy - 5,
        w=10,
        h=10,
        review_state=state,
    )


@pytest.fixture
def map_run(handle, cls):
    """A 1000x1000 map with two site areas (west, north) and five detections in run r1."""
    with handle.session() as s:
        s.add(
            GeoMap(
                id="m1",
                name="m",
                status="ready",
                source_path="x",
                source_size=1,
                width=1000,
                height=1000,
                geotransform=list(GT),
                crs_wkt=UTM33,
            )
        )
        s.add(_square_area("west", 0, 0, 400, 1000))
        s.add(_square_area("north", 0, 0, 1000, 300))
        s.flush()
        s.add(MapRun(id="r1", map_id="m1", kind="local_model", conf=0.25))
        s.flush()
        s.add_all(
            [
                _det("d1", cls[0], 100, 100, 0.95),  # west and north
                _det("d2", cls[0], 100, 600, 0.85),  # west
                _det("d3", cls[1], 800, 100, 0.60),  # north
                _det("d4", cls[1], 800, 800, 0.40),  # neither
                _det("d5", cls[0], 300, 600, 0.82),  # west
            ]
        )
        s.flush()
        run = s.get(MapRun, "r1")
        recount_map_run(s, run, areas_for_map(s, s.get(GeoMap, "m1")))
    return "r1"


def _stored_and_recount(handle, run_id: str) -> tuple[tuple, tuple]:
    with handle.session() as s:
        run = s.get(MapRun, run_id)
        stored = (dict(run.counts), dict(run.verified_counts), dict(run.area_counts))
        fresh = SimpleNamespace(id=run_id)
        recount_map_run(s, fresh, areas_for_map(s, s.get(GeoMap, run.map_id)))
        s.rollback()
    return stored, (fresh.counts, fresh.verified_counts, fresh.area_counts)


def _state(handle, det_id: str) -> tuple[str, str]:
    with handle.session() as s:
        d = s.get(MapDetection, det_id)
        return d.class_id, d.review_state


def _review(client, project_id, run_id, ids, action, **extra):
    return client.post(
        f"{BASE}/{project_id}/map-runs/{run_id}/review",
        json={"detection_ids": ids, "action": action, **extra},
    )


# --- map review ----------------------------------------------------------------------------------


def test_accept_updates_state_and_verified_counts_like_a_recount(client, project_id, handle, map_run, cls):
    r = _review(client, project_id, map_run, ["d1", "d2"], "accept")
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 2}
    assert _state(handle, "d1") == (cls[0], "accepted")
    stored, fresh = _stored_and_recount(handle, map_run)
    assert stored == fresh
    counts, verified, areas = stored
    assert verified == {cls[0]: 2}
    assert areas["west"][cls[0]] == {"total": 3, "verified": 2}


def test_reject_takes_detections_out_of_every_count(client, project_id, handle, map_run, cls):
    assert _review(client, project_id, map_run, ["d3"], "reject").json() == {"updated": 1}
    stored, fresh = _stored_and_recount(handle, map_run)
    assert stored == fresh
    assert stored[0] == {cls[0]: 3, cls[1]: 1}
    assert "north" in stored[2] and cls[1] not in stored[2]["north"]


def test_reclass_sets_the_class_and_edited(client, project_id, handle, map_run, cls):
    r = _review(client, project_id, map_run, ["d4", "d1"], "reclass", class_id=cls[2])
    assert r.json() == {"updated": 2}
    assert _state(handle, "d4") == (cls[2], "edited")
    stored, fresh = _stored_and_recount(handle, map_run)
    assert stored == fresh
    assert stored[1] == {cls[2]: 2}


def test_unreview_and_a_mixed_sequence_stay_equal_to_a_recount(client, project_id, handle, map_run, cls):
    _review(client, project_id, map_run, ["d1", "d2", "d3"], "accept")
    _review(client, project_id, map_run, ["d2", "d4"], "reject")
    _review(client, project_id, map_run, ["d3"], "reclass", class_id=cls[0])
    _review(client, project_id, map_run, ["d2", "d3"], "unreview")
    assert _state(handle, "d2") == (cls[0], "unreviewed")
    assert _state(handle, "d3") == (cls[0], "unreviewed")
    stored, fresh = _stored_and_recount(handle, map_run)
    assert stored == fresh


def test_a_no_op_action_updates_nothing(client, project_id, map_run):
    _review(client, project_id, map_run, ["d1"], "accept")
    assert _review(client, project_id, map_run, ["d1"], "accept").json() == {"updated": 0}
    assert _review(client, project_id, map_run, ["d2"], "unreview").json() == {"updated": 0}


def test_ids_of_another_run_or_unknown_ids_are_ignored(client, project_id, handle, map_run):
    with handle.session() as s:
        s.add(MapRun(id="r2", map_id="m1", kind="local_model"))
        s.flush()
        s.add(MapDetection(id="x1", run_id="r2", class_id="c", confidence=0.9, x=0, y=0, w=1, h=1))
    r = _review(client, project_id, map_run, ["x1", "nope"], "accept")
    assert r.json() == {"updated": 0}
    assert _state(handle, "x1")[1] == "unreviewed"


def test_reclass_needs_a_known_class(client, project_id, map_run):
    assert _review(client, project_id, map_run, ["d1"], "reclass").status_code == 422
    assert _review(client, project_id, map_run, ["d1"], "reclass", class_id="nope").status_code == 422


def test_review_of_an_unknown_run_is_404(client, project_id, map_run):
    assert _review(client, project_id, "nope", ["d1"], "accept").status_code == 404


def test_detections_carry_their_review_state_and_provenance(client, project_id, map_run):
    _review(client, project_id, map_run, ["d1"], "accept")
    items = client.get(f"{BASE}/{project_id}/map-runs/{map_run}/detections").json()["items"]
    by_id = {d["id"]: d for d in items}
    assert by_id["d1"]["review_state"] == "accepted"
    assert by_id["d2"]["review_state"] == "unreviewed"
    assert by_id["d1"]["provenance_kind"] == "local_model"


# --- a person-drawn detection --------------------------------------------------------------------


def test_a_person_drawn_detection_counts_as_verified(client, project_id, handle, map_run, cls):
    body = {"class_id": cls[3], "x": 50, "y": 700, "w": 20, "h": 20}
    r = client.post(f"{BASE}/{project_id}/map-runs/{map_run}/detections", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["provenance_kind"] == "person" and d["review_state"] == "accepted"
    assert d["confidence"] == 1.0
    stored, fresh = _stored_and_recount(handle, map_run)
    assert stored == fresh
    assert stored[1] == {cls[3]: 1}
    assert stored[2]["west"][cls[3]] == {"total": 1, "verified": 1}


def test_a_drawn_detection_needs_a_known_class_and_its_centre_on_the_map(client, project_id, map_run, cls):
    url = f"{BASE}/{project_id}/map-runs/{map_run}/detections"
    assert client.post(url, json={"class_id": "nope", "x": 1, "y": 1, "w": 5, "h": 5}).status_code == 422
    off = {"class_id": cls[0], "x": 2000, "y": 1, "w": 5, "h": 5}
    assert client.post(url, json=off).status_code == 422
    missing = f"{BASE}/{project_id}/map-runs/nope/detections"
    assert client.post(missing, json={"class_id": cls[0], "x": 1, "y": 1, "w": 5, "h": 5}).status_code == 404


# --- next unreviewed -----------------------------------------------------------------------------


def test_next_unreviewed_walks_every_pending_detection_once_in_reading_order(client, project_id, map_run):
    _review(client, project_id, map_run, ["d5"], "accept")
    url = f"{BASE}/{project_id}/map-runs/{map_run}/next-unreviewed"
    seen: list[str] = []
    after = None
    while True:
        body = client.get(url, params={"after_id": after} if after else {}).json()
        assert body["remaining"] == 4
        if body["detection"] is None:
            break
        after = body["detection"]["id"]
        seen.append(after)
        assert len(seen) <= 4
    # (y, x): d1 (95,95), d3 (95,795), d2 (595,95), d4 (795,795); d5 is accepted
    assert seen == ["d1", "d3", "d2", "d4"]


def test_next_unreviewed_after_an_accept_moves_on(client, project_id, map_run):
    url = f"{BASE}/{project_id}/map-runs/{map_run}/next-unreviewed"
    first = client.get(url).json()["detection"]["id"]
    _review(client, project_id, map_run, [first], "accept")
    body = client.get(url, params={"after_id": first}).json()
    assert body["detection"]["id"] == "d3"
    assert body["remaining"] == 4


def test_next_unreviewed_of_an_unknown_run_is_404(client, project_id, map_run):
    assert client.get(f"{BASE}/{project_id}/map-runs/nope/next-unreviewed").status_code == 404


# --- accept above --------------------------------------------------------------------------------


def test_accept_above_is_a_job_whose_result_matches_a_recount(client, project_id, handle, map_run, wait_job):
    _review(client, project_id, map_run, ["d2"], "reject")
    r = client.post(f"{BASE}/{project_id}/runs/{map_run}/accept-above", json={"min_confidence": 0.8})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["type"] == "accept_above"
    states = {d: _state(handle, d)[1] for d in ("d1", "d2", "d3", "d4", "d5")}
    # d2 was rejected: accept-above only decides what is still unreviewed.
    assert states == {
        "d1": "accepted",
        "d2": "rejected",
        "d3": "unreviewed",
        "d4": "unreviewed",
        "d5": "accepted",
    }
    stored, fresh = _stored_and_recount(handle, map_run)
    assert stored == fresh


def test_accept_above_of_an_unknown_run_is_404(client, project_id):
    r = client.post(f"{BASE}/{project_id}/runs/nope/accept-above", json={"min_confidence": 0.5})
    assert r.status_code == 404


# --- photo runs ----------------------------------------------------------------------------------


@pytest.fixture
def photo_run(handle, cls):
    """A photo run q1 over one image, with three model boxes; counts start from a recount."""
    with handle.session() as s:
        s.add(Source(id="s1", folder="f", site="site"))
        s.flush()
        s.add(Image(id="i1", path="images/a.jpg", width=100, height=100, source_id="s1"))
        s.add(QueryRun(id="q1", kind="local_model", image_ids=["i1"]))
        s.flush()
        for box_id, class_id, conf in (("b1", cls[0], 0.9), ("b2", cls[0], 0.5), ("b3", cls[1], 0.85)):
            s.add(
                Box(
                    id=box_id,
                    image_id="i1",
                    class_id=class_id,
                    x=10,
                    y=10,
                    w=10,
                    h=10,
                    confidence=conf,
                    provenance_kind="local_model",
                    query_run_id="q1",
                    review_state="unreviewed",
                )
            )
        s.flush()
        recount_query_run(s, s.get(QueryRun, "q1"))
    return "q1"


def _query_counts(handle, run_id="q1") -> tuple[tuple, tuple]:
    with handle.session() as s:
        run = s.get(QueryRun, run_id)
        stored = (dict(run.counts), dict(run.verified_counts))
        fresh = SimpleNamespace(id=run_id)
        recount_query_run(s, fresh)
        s.rollback()
    return stored, (fresh.counts, fresh.verified_counts)


def test_box_review_in_a_photo_run_updates_the_run_counts(handle, photo_run, cls):
    assert boxes.review_boxes(handle, ["b1", "b3"], "accept") == 2
    stored, fresh = _query_counts(handle)
    assert stored == fresh == ({cls[0]: 2, cls[1]: 1}, {cls[0]: 1, cls[1]: 1})
    boxes.review_boxes(handle, ["b2", "b3"], "reject")
    stored, fresh = _query_counts(handle)
    assert stored == fresh == ({cls[0]: 1}, {cls[0]: 1})
    boxes.review_boxes(handle, ["b3"], "unreview")
    stored, fresh = _query_counts(handle)
    assert stored == fresh


def test_box_reclass_and_delete_in_a_photo_run_update_the_run_counts(handle, photo_run, cls):
    boxes.update_box(handle, "b2", class_id=cls[4])
    stored, fresh = _query_counts(handle)
    assert stored == fresh
    assert stored[1] == {cls[4]: 1}
    boxes.delete_box(handle, "b1")
    stored, fresh = _query_counts(handle)
    assert stored == fresh == ({cls[4]: 1, cls[1]: 1}, {cls[4]: 1})


def test_a_box_drawn_into_a_photo_run_counts_as_verified(handle, photo_run, cls):
    boxes.create_box(handle, "i1", cls[5], 50, 50, 10, 10, query_run_id="q1")
    stored, fresh = _query_counts(handle)
    assert stored == fresh
    assert stored[1] == {cls[5]: 1}


def test_boxes_outside_a_run_leave_run_counts_alone(handle, photo_run, cls):
    before = _query_counts(handle)[0]
    box = boxes.create_box(handle, "i1", cls[0], 50, 50, 10, 10)
    boxes.update_box(handle, box.id, class_id=cls[1])
    boxes.delete_box(handle, box.id)
    assert _query_counts(handle)[0] == before


def test_accept_above_on_a_photo_run_goes_through_box_review(
    client, project_id, handle, photo_run, wait_job, cls
):
    r = client.post(f"{BASE}/{project_id}/runs/{photo_run}/accept-above", json={"min_confidence": 0.8})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    with handle.session() as s:
        states = dict(s.execute(select(Box.id, Box.review_state)).all())
    assert states == {"b1": "accepted", "b2": "unreviewed", "b3": "accepted"}
    stored, fresh = _query_counts(handle)
    assert stored == fresh
    assert stored[1] == {cls[0]: 1, cls[1]: 1}


def test_accepting_a_photo_run_as_labels_and_undoing_it_keep_the_run_counts(handle, photo_run, cls):
    from app.inference import service as inference

    inference.promote(handle, photo_run, 0.8)
    stored, fresh = _query_counts(handle)
    assert stored == fresh
    assert stored[1] == {cls[0]: 1, cls[1]: 1}
    inference.unpromote(handle, photo_run)
    stored, fresh = _query_counts(handle)
    assert stored == fresh
    assert stored[1] == {}


def test_marking_an_image_empty_rejects_its_run_boxes_out_of_the_counts(handle, photo_run):
    from app.datasets import empties

    empties.set_marked_empty(handle, "i1", True)
    stored, fresh = _query_counts(handle)
    assert stored == fresh == ({}, {})


def test_bulk_marking_images_empty_keeps_the_run_counts(handle, photo_run):
    from app.datasets import empties

    empties.set_marked_empty(handle, "i1", False)
    empties.bulk_mark_empty(handle, ["i1"], True)
    stored, fresh = _query_counts(handle)
    assert stored == fresh == ({}, {})


def test_deleting_images_of_a_photo_run_updates_the_run_counts(handle, photo_run, cls):
    from app.datasets import images

    boxes.review_boxes(handle, ["b1"], "accept")
    assert images.bulk_delete(handle, ["i1"]) == 1
    stored, fresh = _query_counts(handle)
    assert stored == fresh == ({}, {})
