"""Counts for the comparison and object-counts sections (reports spec §3 row I/M counts, §7.2;
Rulings 13-15; ADR 2026-09-23-counts-live-on-run-rows)."""

from datetime import date

from reports_m_rows import add_geomap, map_run, photo_batch, site_area
from sqlalchemy import event

from app.reports.sections import survey_counts


def _classes(project):
    return {c["name"]: c["id"] for c in project["classes"]}


def _two_surveys(handle, project):
    c = _classes(project)
    exc, dump = c["excavator"], c["dump_truck"]
    aug = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 14))
    sep = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 21))
    map_run(handle, map_id=aug, counts={exc: 6, dump: 2}, verified={exc: 4})
    map_run(handle, map_id=sep, counts={exc: 8}, verified={exc: 8})
    return exc, dump


def test_the_class_table_prints_total_and_verified_per_survey(handle, project):
    _two_surveys(handle, project)
    data = survey_counts.load(handle)
    classes = survey_counts.chosen_classes(data, None)
    head, rows = survey_counts.class_table(data, classes, verified_only=False)
    assert head == ["Class", "14 Aug 2026", "21 Sep 2026"]
    assert sorted(rows) == sorted([["excavator", "6 (4)", "8 (8)"], ["dump_truck", "2 (0)", "0 (0)"]])
    assert [r[0] for r in rows] == [c.name for c in classes]  # the project's class order
    _, vrows = survey_counts.class_table(data, classes, verified_only=True)
    assert ["excavator", "4", "8"] in vrows


def test_type_ids_filter_the_classes(handle, project):
    exc, _ = _two_surveys(handle, project)
    data = survey_counts.load(handle)
    assert [c.id for c in survey_counts.chosen_classes(data, [exc])] == [exc]


def test_a_survey_on_another_model_is_marked_and_not_charted(handle, project):
    exc, _ = _two_surveys(handle, project)
    oct_ = add_geomap(handle, name="Oct", captured_on=date(2026, 10, 1))
    map_run(handle, map_id=oct_, counts={exc: 50}, model_id="other")
    data = survey_counts.load(handle)
    classes = survey_counts.chosen_classes(data, [exc])
    _, rows = survey_counts.class_table(data, classes, verified_only=False)
    assert rows[0][-1].endswith(" *")
    assert survey_counts.not_comparable_notes(data)[0].startswith("* 01 Oct 2026: different model")
    labels, series = survey_counts.chart_series(data, classes, verified_only=False)
    assert labels == ["14 Aug 2026", "21 Sep 2026", "01 Oct 2026"]
    assert series[0][2] == [6, 8, None]


def test_an_uncounted_survey_prints_a_dash(handle, project):
    _two_surveys(handle, project)
    add_geomap(handle, name="Nov", captured_on=date(2026, 11, 1))
    data = survey_counts.load(handle)
    _, rows = survey_counts.class_table(data, survey_counts.chosen_classes(data, None), False)
    assert rows[0][-1] == "—"


def test_per_area_uses_the_newest_counted_survey(handle, project):
    exc, _ = _two_surveys(handle, project)
    whole = site_area(handle, name="Whole", px=(0, 0, 500, 500))
    edge = site_area(handle, name="Edge", px=(900, 0, 1100, 500))
    with handle.session() as s:
        from sqlalchemy import select

        from app.db.models import MapRun

        order = select(MapRun).order_by(MapRun.created_at.desc(), MapRun.id.desc())
        newest = s.execute(order).scalars().first()
        for run in s.execute(select(MapRun)).scalars():
            run.area_counts = {
                whole: {exc: {"total": 5, "verified": 5}},
                edge: {exc: {"total": 1, "verified": 0}},
            }
        assert newest is not None
    data = survey_counts.load(handle)
    label, head, rows = survey_counts.area_table(handle, survey_counts.chosen_classes(data, None), False)
    assert label == "Sep · 21 Sep 2026"
    assert head == ["Area", "Class", "Total", "Verified"]
    assert ["Whole", "excavator", "5", "5"] in rows
    assert ["Edge (partly on this map)", "excavator", "1", "0"] in rows


def test_photo_batches_are_detections_and_uncounted_batches_say_so(handle, project):
    exc = _classes(project)["excavator"]
    photo_batch(handle, label="Flight A", captured_on=date(2026, 3, 1), counts={exc: 12}, verified={exc: 3})
    photo_batch(handle, label="Flight B", captured_on=date(2026, 3, 2), counts=None)
    head, rows = survey_counts.photo_table(handle, None, verified_only=False)
    assert head == ["Photo batch", "Captured", "Class", "Detections", "Verified"]
    assert rows == [
        ["Flight A", "01 Mar 2026", "excavator", "12", "3"],
        ["Flight B", "02 Mar 2026", "not counted", "", ""],
    ]
    assert "detections, not objects" in survey_counts.PHOTO_NOTE


def test_counts_never_read_a_detection_table(handle, project, app):
    _two_surveys(handle, project)
    seen: list[str] = []
    engine = handle.engine

    def spy(conn, cursor, statement, *a):
        seen.append(statement.lower())

    event.listen(engine, "before_cursor_execute", spy)
    try:
        data = survey_counts.load(handle)
        survey_counts.class_table(data, survey_counts.chosen_classes(data, None), False)
    finally:
        event.remove(engine, "before_cursor_execute", spy)
    assert seen and not any("map_detection" in q or " box" in q for q in seen)
