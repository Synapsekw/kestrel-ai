"""The counting rules (spec 2026-09-23 section 9.1, plan 2 deviation 1).

A detection counts in `counts` unless it is rejected (or gone); accepted and edited ones also count
in `verified_counts`. Every review write applies one transition; a recount rebuilds the same numbers
from the rows, so the two must always agree.
"""

import random

import pytest
from pyproj import CRS
from sqlalchemy import select

from app.db.models import Box, GeoMap, Image, MapDetection, MapRun, QueryRun, SiteArea, Source
from app.db.session import make_session_factory, open_project_db
from app.detect.areas import area_ids_for_point, areas_for_map
from app.detect.counts import (
    VERIFIED_STATES,
    apply_area_transition,
    apply_transition,
    recount_map_run,
    recount_query_run,
)
from app.maps.georef import Georef

UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)
CLASSES = ["c1", "c2", "c3"]
STATES = ["unreviewed", "accepted", "rejected", "edited"]


# --- apply_transition ----------------------------------------------------------------------------


def test_verified_states():
    assert VERIFIED_STATES == ("accepted", "edited")


def test_a_new_unreviewed_detection_counts_but_is_not_verified():
    counts, verified = {}, {}
    apply_transition(counts, verified, None, ("c1", "unreviewed"))
    assert counts == {"c1": 1} and verified == {}


def test_accepting_adds_to_verified_only():
    counts, verified = {"c1": 1}, {}
    apply_transition(counts, verified, ("c1", "unreviewed"), ("c1", "accepted"))
    assert counts == {"c1": 1} and verified == {"c1": 1}


def test_rejecting_an_accepted_detection_takes_it_out_of_both_and_drops_the_key():
    counts, verified = {"c1": 1, "c2": 3}, {"c1": 1}
    apply_transition(counts, verified, ("c1", "accepted"), ("c1", "rejected"))
    assert counts == {"c2": 3} and verified == {}


def test_reclass_moves_both():
    counts, verified = {"c1": 2}, {"c1": 2}
    apply_transition(counts, verified, ("c1", "accepted"), ("c2", "accepted"))
    assert counts == {"c1": 1, "c2": 1} and verified == {"c1": 1, "c2": 1}


def test_edited_is_verified_and_a_person_drawn_detection_counts():
    counts, verified = {}, {}
    apply_transition(counts, verified, None, ("c1", "accepted"))
    apply_transition(counts, verified, ("c1", "accepted"), ("c1", "edited"))
    assert counts == {"c1": 1} and verified == {"c1": 1}


def test_rejected_and_absent_count_nowhere():
    counts, verified = {}, {}
    apply_transition(counts, verified, None, ("c1", "rejected"))
    apply_transition(counts, verified, ("c1", "rejected"), None)
    assert counts == {} and verified == {}


def test_unreviewing_a_rejected_detection_counts_it_again():
    counts, verified = {}, {}
    apply_transition(counts, verified, ("c1", "rejected"), ("c1", "unreviewed"))
    assert counts == {"c1": 1} and verified == {}


def test_area_transition_writes_total_and_verified_into_each_area():
    area_counts: dict = {}
    apply_area_transition(area_counts, ["a1", "a2"], None, ("c1", "unreviewed"))
    assert area_counts == {
        "a1": {"c1": {"total": 1, "verified": 0}},
        "a2": {"c1": {"total": 1, "verified": 0}},
    }
    apply_area_transition(area_counts, ["a1", "a2"], ("c1", "unreviewed"), ("c1", "accepted"))
    assert area_counts["a1"] == {"c1": {"total": 1, "verified": 1}}
    apply_area_transition(area_counts, ["a1", "a2"], ("c1", "accepted"), ("c1", "rejected"))
    assert area_counts == {}


def test_area_transition_with_no_areas_is_a_no_op():
    area_counts = {"a1": {"c1": {"total": 1, "verified": 0}}}
    apply_area_transition(area_counts, [], ("c1", "unreviewed"), None)
    assert area_counts == {"a1": {"c1": {"total": 1, "verified": 0}}}


# --- recount against the rows --------------------------------------------------------------------


@pytest.fixture
def factory(tmp_path):
    engine = open_project_db(tmp_path)
    yield make_session_factory(engine)
    engine.dispose()


def _square_area(area_id: str, x0: float, y0: float, x1: float, y1: float) -> SiteArea:
    g = Georef(GT, UTM33)
    pixels = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return SiteArea(id=area_id, name=area_id, polygon_wgs84=[list(g.pixel_to_wgs84(x, y)) for x, y in pixels])


def _map_fixture(s) -> tuple[GeoMap, MapRun]:
    gmap = GeoMap(
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
    run = MapRun(id="r1", map_id="m1", kind="local_model", counts={"stale": 9})
    s.add_all([gmap, run])
    s.add(_square_area("west", 0, 0, 400, 1000))
    s.add(_square_area("north", 0, 0, 1000, 300))
    s.flush()
    return gmap, run


def _det(det_id, class_id, cx, cy, state="unreviewed", run_id="r1") -> MapDetection:
    return MapDetection(
        id=det_id,
        run_id=run_id,
        class_id=class_id,
        confidence=0.9,
        x=cx - 5,
        y=cy - 5,
        w=10,
        h=10,
        review_state=state,
    )


def test_recount_map_run_counts_detections_in_and_out_of_two_areas(factory):
    with factory() as s, s.begin():
        gmap, run = _map_fixture(s)
        s.add_all(
            [
                _det("d1", "c1", 100, 100, "accepted"),  # west and north
                _det("d2", "c1", 100, 600),  # west only
                _det("d3", "c2", 800, 100, "edited"),  # north only
                _det("d4", "c2", 800, 800),  # neither
                _det("d5", "c1", 100, 100, "rejected"),  # counts nowhere
            ]
        )
        s.add(MapRun(id="other", map_id="m1", kind="local_model"))
        s.flush()
        s.add(_det("x1", "c1", 100, 100, run_id="other"))
        s.flush()
        recount_map_run(s, run, areas_for_map(s, gmap))
    with factory() as s:
        run = s.get(MapRun, "r1")
        assert run.counts == {"c1": 2, "c2": 2}
        assert run.verified_counts == {"c1": 1, "c2": 1}
        assert run.area_counts == {
            "west": {"c1": {"total": 2, "verified": 1}},
            "north": {"c1": {"total": 1, "verified": 1}, "c2": {"total": 1, "verified": 1}},
        }


def test_recount_query_run_counts_its_own_boxes(factory):
    with factory() as s, s.begin():
        s.add(Source(id="s1", folder="f", site="site"))
        s.flush()  # no ORM relationships, so the unit of work does not order the inserts
        s.add(Image(id="i1", path="images/a.jpg", width=10, height=10, source_id="s1"))
        run = QueryRun(id="q1", kind="local_model", counts={"stale": 1}, verified_counts={"stale": 1})
        s.add(run)
        s.flush()
        for i, (cls, state, qid) in enumerate(
            [
                ("c1", "unreviewed", "q1"),
                ("c1", "accepted", "q1"),
                ("c2", "rejected", "q1"),
                ("c2", "edited", "q2"),
            ]
        ):
            s.add(_box(f"b{i}", cls, state, qid))
        s.flush()
        recount_query_run(s, run)
    with factory() as s:
        run = s.get(QueryRun, "q1")
        assert run.counts == {"c1": 2}
        assert run.verified_counts == {"c1": 1}


def _box(box_id, class_id, state, query_run_id="q1") -> Box:
    return Box(
        id=box_id,
        image_id="i1",
        class_id=class_id,
        x=0.1,
        y=0.1,
        w=0.1,
        h=0.1,
        confidence=0.5,
        provenance_kind="local_model",
        query_run_id=query_run_id,
        review_state=state,
    )


def _random_step(rng: random.Random, rows: dict[str, tuple[str, str]], n: int) -> tuple[str, tuple | None]:
    """One review action as (row id, new entry); a new id adds a row, None deletes one."""
    if not rows or rng.random() < 0.25:
        return f"n{n}", (rng.choice(CLASSES), rng.choice(["unreviewed", "accepted"]))
    row_id = rng.choice(sorted(rows))
    cls, state = rows[row_id]
    roll = rng.random()
    if roll < 0.1:
        return row_id, None
    if roll < 0.35:
        return row_id, (rng.choice(CLASSES), state)  # reclass
    return row_id, (cls, rng.choice(STATES))


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_incremental_map_counts_equal_a_recount(factory, seed):
    rng = random.Random(seed)
    counts: dict = {}
    verified: dict = {}
    area_counts: dict = {}
    rows: dict[str, tuple[str, str]] = {}
    with factory() as s, s.begin():
        gmap, run = _map_fixture(s)
        areas = areas_for_map(s, gmap)
        centres: dict[str, tuple[float, float]] = {}
        for n in range(200):
            row_id, new = _random_step(rng, rows, n)
            old = rows.get(row_id)
            if old is None:
                centres[row_id] = (rng.uniform(10, 990), rng.uniform(10, 990))
                s.add(_det(row_id, new[0], *centres[row_id], state=new[1]))
            elif new is None:
                s.delete(s.get(MapDetection, row_id))
            else:
                det = s.get(MapDetection, row_id)
                det.class_id, det.review_state = new
            apply_transition(counts, verified, old, new)
            apply_area_transition(area_counts, area_ids_for_point(areas, *centres[row_id]), old, new)
            if new is None:
                del rows[row_id]
            else:
                rows[row_id] = new
        s.flush()
        recount_map_run(s, run, areas)
        assert run.counts == counts
        assert run.verified_counts == verified
        assert run.area_counts == area_counts
    assert counts  # the sequence left something to count


@pytest.mark.parametrize("seed", [4, 5])
def test_incremental_photo_counts_equal_a_recount(factory, seed):
    rng = random.Random(seed)
    counts: dict = {}
    verified: dict = {}
    rows: dict[str, tuple[str, str]] = {}
    with factory() as s, s.begin():
        s.add(Source(id="s1", folder="f", site="site"))
        s.flush()  # no ORM relationships, so the unit of work does not order the inserts
        s.add(Image(id="i1", path="images/a.jpg", width=10, height=10, source_id="s1"))
        run = QueryRun(id="q1", kind="local_model")
        s.add(run)
        s.flush()
        for n in range(200):
            row_id, new = _random_step(rng, rows, n)
            old = rows.get(row_id)
            if old is None:
                s.add(_box(row_id, *new))
            elif new is None:
                s.delete(s.get(Box, row_id))
            else:
                box = s.get(Box, row_id)
                box.class_id, box.review_state = new
            apply_transition(counts, verified, old, new)
            if new is None:
                del rows[row_id]
            else:
                rows[row_id] = new
        s.flush()
        recount_query_run(s, run)
        assert run.counts == counts
        assert run.verified_counts == verified
    with factory() as s:  # and what was written is what a reader sees
        assert s.execute(select(QueryRun.counts)).scalar_one() == counts
