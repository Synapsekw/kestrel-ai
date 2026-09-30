"""The object counts section (reports spec §7.2 row `object_counts`; Rulings 13-15; units rule)."""

from datetime import date

from reports_m_rows import add_geomap, make_ctx, map_run, photo_batch, site_area

from app.reports.sections import object_counts


def _texts(doc):
    return [getattr(b, "text", "") for b in doc.blocks]


def _tables(doc):
    return [b for b in doc.blocks if b.kind == "table"]


def test_per_class_per_survey_then_per_area_then_photo_batches(handle, project):
    exc = project["classes"][0]["id"]
    whole = site_area(handle, name="Whole", px=(0, 0, 500, 500))
    gm = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    map_run(
        handle,
        map_id=gm,
        counts={exc: 4},
        verified={exc: 2},
        area_counts={whole: {exc: {"total": 3, "verified": 1}}},
    )
    photo_batch(handle, label="Flight A", captured_on=date(2026, 3, 1), counts={exc: 9})
    doc = object_counts.compose(make_ctx(handle, "object_counts", per_area=True, verified_only=False))
    assert doc.key == "object_counts"
    surveys, areas, photos = _tables(doc)
    assert surveys.rows == [[project["classes"][0]["name"], "4 (2)"]]
    assert areas.rows == [["Whole", project["classes"][0]["name"], "3", "1"]]
    assert photos.rows[0][:4] == ["Flight A", "01 Mar 2026", project["classes"][0]["name"], "9"]


def test_photo_batches_are_detections_never_objects(handle, project):
    exc = project["classes"][0]["id"]
    photo_batch(handle, label="Flight A", captured_on=date(2026, 3, 1), counts={exc: 9})
    doc = object_counts.compose(make_ctx(handle, "object_counts"))
    texts = _texts(doc)
    assert "Photo batches — detections" in texts
    assert any("detections, not objects" in t for t in texts)
    [photos] = _tables(doc)
    assert "Objects" not in [c.label for c in photos.columns]
    assert "Detections" in [c.label for c in photos.columns]


def test_per_area_off_and_verified_only(handle, project):
    exc = project["classes"][0]["id"]
    whole = site_area(handle, name="Whole", px=(0, 0, 500, 500))
    gm = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    map_run(
        handle,
        map_id=gm,
        counts={exc: 4},
        verified={exc: 2},
        area_counts={whole: {exc: {"total": 3, "verified": 1}}},
    )
    doc = object_counts.compose(make_ctx(handle, "object_counts", per_area=False, verified_only=True))
    [surveys] = _tables(doc)
    assert surveys.rows == [[project["classes"][0]["name"], "2"]]


def test_type_ids_filter_every_table(handle, project):
    a, b = project["classes"][0]["id"], project["classes"][1]["id"]
    gm = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    map_run(handle, map_id=gm, counts={a: 1, b: 2})
    photo_batch(handle, label="Flight A", captured_on=None, counts={a: 5, b: 6})
    doc = object_counts.compose(make_ctx(handle, "object_counts", type_ids=[b]))
    surveys, photos = _tables(doc)
    assert [r[0] for r in surveys.rows] == [project["classes"][1]["name"]]
    assert [r[2] for r in photos.rows] == [project["classes"][1]["name"]]


def test_nothing_counted_says_so(handle):
    doc = object_counts.compose(make_ctx(handle, "object_counts"))
    assert "No counts yet: run detection on a map or a photo batch." in _texts(doc)
