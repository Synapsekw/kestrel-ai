"""The timeline's judgement: which run speaks for a survey, and what may be subtracted."""

from datetime import UTC, date, datetime

from app.db.models import GeoMap, MapRun
from app.maps.timeline import Basis, build_timeline, choose_basis


def _map(name, captured=None, created=1):
    return GeoMap(
        id=f"m-{name}",
        name=name,
        status="ready",
        source_path="x",
        source_size=1,
        captured_on=captured,
        created_at=datetime(2026, 1, created, tzinfo=UTC),
    )


def _run(map_id, model_id="mod-a", conf=0.25, counts=None, created=1, name="v1"):
    return MapRun(
        id=f"r-{map_id}-{created}",
        map_id=map_id,
        kind="local_model",
        model_id=model_id,
        model_name=name,
        conf=conf,
        counts=counts or {},
        created_at=datetime(2026, 2, created, tzinfo=UTC),
    )


def test_basis_is_the_newest_runs_model_and_confidence():
    runs = [_run("a", model_id="old", conf=0.4, created=1), _run("b", model_id="new", conf=0.25, created=9)]
    assert choose_basis(runs) == Basis(model_id="new", model_name="v1", conf=0.25)


def test_no_runs_at_all_has_no_basis():
    assert choose_basis([]) is None


def test_surveys_are_ordered_oldest_first_and_deltas_follow_the_order():
    maps = [_map("april", date(2026, 4, 1)), _map("may", date(2026, 5, 1))]
    runs = {"m-april": [_run("m-april", counts={"c1": 5})], "m-may": [_run("m-may", counts={"c1": 8})]}
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert [s.map_name for s in out] == ["april", "may"]
    assert out[0].deltas == {}
    assert out[1].deltas == {"c1": 3}


def test_a_run_on_another_model_is_marked_and_skipped_by_deltas():
    maps = [_map("april", date(2026, 4, 1)), _map("may", date(2026, 5, 1)), _map("june", date(2026, 6, 1))]
    runs = {
        "m-april": [_run("m-april", counts={"c1": 5})],
        "m-may": [_run("m-may", model_id="other", name="v2", counts={"c1": 50})],
        "m-june": [_run("m-june", counts={"c1": 6})],
    }
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert out[1].state == "not_comparable"
    assert "different model" in out[1].reason
    assert out[1].deltas == {}
    # June compares with April, the previous comparable survey - never with the odd one out.
    assert out[2].deltas == {"c1": 1}


def test_a_matching_run_wins_over_a_newer_run_on_another_model():
    maps = [_map("april", date(2026, 4, 1))]
    runs = {
        "m-april": [
            _run("m-april", counts={"c1": 5}, created=1),
            _run("m-april", model_id="other", counts={"c1": 99}, created=5),
        ]
    }
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert out[0].state == "ok"
    assert out[0].counts == {"c1": 5}


def test_a_confidence_mismatch_says_so():
    maps = [_map("april", date(2026, 4, 1))]
    runs = {"m-april": [_run("m-april", conf=0.4, counts={"c1": 5})]}
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert out[0].state == "not_comparable"
    assert "0.4" in out[0].reason
    assert "0.25" in out[0].reason


def test_a_map_with_no_runs_is_not_counted_yet():
    out = build_timeline([_map("april", date(2026, 4, 1))], {}, Basis("mod-a", "v1", 0.25))
    assert out[0].state == "not_counted"
    assert out[0].counts == {}
    assert out[0].run_id is None


def test_a_map_without_a_survey_date_falls_back_to_its_import_date():
    out = build_timeline([_map("april", None, created=7)], {}, Basis("mod-a", "v1", 0.25))
    assert out[0].captured_on == date(2026, 1, 7)
    assert out[0].date_is_import_date is True


def test_a_class_absent_from_the_earlier_survey_has_no_delta():
    maps = [_map("april", date(2026, 4, 1)), _map("may", date(2026, 5, 1))]
    runs = {
        "m-april": [_run("m-april", counts={"c1": 5})],
        "m-may": [_run("m-may", counts={"c1": 5, "c2": 3})],
    }
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    # c2 did not exist to be counted in April, so it gets no delta rather than "+3".
    assert out[1].deltas == {"c1": 0}


def test_two_surveys_on_the_same_day_keep_their_import_order():
    maps = [_map("first", date(2026, 4, 1), created=1), _map("second", date(2026, 4, 1), created=2)]
    runs = {
        "m-first": [_run("m-first", counts={"c1": 1})],
        "m-second": [_run("m-second", counts={"c1": 4})],
    }
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert [s.map_name for s in out] == ["first", "second"]
    assert out[1].deltas == {"c1": 3}
