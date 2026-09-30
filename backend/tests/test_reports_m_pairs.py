"""Survey pairs for the comparison section (reports spec §9.3 pair/swipe, §16; Rulings 10-12)."""

import math
from datetime import date

import pytest
from reports_m_rows import UTM33, add_geomap, make_ctx, map_finding

from app.reports.figures import map_geo
from app.reports.sections import survey_pairs
from app.workspace.frame import WGS84


def test_survey_maps_are_ready_maps_in_date_order(handle):
    sep = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    aug = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    add_geomap(handle, name="Broken", captured_on=date(2026, 8, 15), status="failed")
    maps = survey_pairs.survey_maps(handle)
    assert [m.id for m in maps] == [aug, sep]
    assert [(a.id, b.id) for a, b in survey_pairs.auto_pairs(maps)] == [(aug, sep)]


def test_three_surveys_make_two_consecutive_pairs(handle):
    ids = [
        add_geomap(handle, name=n, captured_on=date(2026, m, 1)) for n, m in (("A", 7), ("B", 8), ("C", 9))
    ]
    pairs = survey_pairs.auto_pairs(survey_pairs.survey_maps(handle))
    assert [(a.id, b.id) for a, b in pairs] == [(ids[0], ids[1]), (ids[1], ids[2])]


def test_explicit_pairs_skip_a_missing_map(handle):
    a = add_geomap(handle, name="A", captured_on=date(2026, 8, 1))
    b = add_geomap(handle, name="B", captured_on=date(2026, 9, 1))
    maps = survey_pairs.survey_maps(handle)
    pairs, missing = survey_pairs.explicit_pairs(
        maps, [{"item_a": a, "item_b": b}, {"item_a": a, "item_b": "gone", "bbox_wgs84": None}]
    )
    assert [(p[0].id, p[1].id, p[2]) for p in pairs] == [(a, b, None)] and missing == 1


def test_overlapping_maps_frame_a_4_3_window_inside_the_common_area(handle):
    add_geomap(handle, name="A", captured_on=date(2026, 8, 1))
    add_geomap(handle, name="B", captured_on=date(2026, 9, 1), x0=500050.0)  # half overlap
    a, b = survey_pairs.survey_maps(handle)
    box = survey_pairs.frame(a, b, None, None)
    common = map_geo.intersect(a.bounds, b.bounds)
    assert box[0] >= common[0] - 1e-12 and box[2] <= common[2] + 1e-12
    k = math.cos(math.radians((box[1] + box[3]) / 2))
    assert (box[2] - box[0]) * k / (box[3] - box[1]) == pytest.approx(4 / 3, rel=1e-6)


def test_the_frame_centres_on_the_pairs_findings(handle, project):
    a_id = add_geomap(handle, name="A", captured_on=date(2026, 8, 1))
    add_geomap(handle, name="B", captured_on=date(2026, 9, 1))
    lon, lat = map_geo.to_crs([[500090.0, 4982950.0]], UTM33, WGS84)[0]
    map_finding(
        handle,
        map_id=a_id,
        geometry=map_geo.point(500090.0, 4982950.0),
        number=1,
        type_id=project["classes"][0]["id"],
        lon=lon,
        lat=lat,
    )
    a, b = survey_pairs.survey_maps(handle)
    centre = survey_pairs.finding_centre(handle, a.id, b.id)
    assert centre == pytest.approx((lon, lat))
    box = survey_pairs.frame(a, b, None, centre)
    assert box[2] == pytest.approx(a.bounds[2])  # pushed to the right edge, clamped inside


def test_non_overlapping_maps_have_no_frame_and_print_side_by_side(handle):
    add_geomap(handle, name="A", captured_on=date(2026, 8, 1))
    add_geomap(handle, name="B", captured_on=date(2026, 9, 1), x0=501000.0)  # 1 km east
    a, b = survey_pairs.survey_maps(handle)
    assert survey_pairs.frame(a, b, None, None) is None
    ctx = make_ctx(handle)
    [row] = survey_pairs.pair_blocks(ctx, a, b, None, "swipe")
    assert row.kind == "figure_row" and len(row.figures) == 2
    assert all(f.caption.endswith("— no common area") for f in row.figures)
    assert row.figures[0].snapshot.spec.item_id == a.id
    assert row.figures[0].snapshot.spec.geometry.type == "Polygon"


def test_modes(handle):
    add_geomap(handle, name="Aug", captured_on=date(2026, 8, 14))
    add_geomap(handle, name="Sep", captured_on=date(2026, 9, 21))
    a, b = survey_pairs.survey_maps(handle)
    box = survey_pairs.frame(a, b, None, None)
    ctx = make_ctx(handle)
    [swipe] = survey_pairs.pair_blocks(ctx, a, b, box, "swipe")
    assert swipe.snapshot.spec.mode == "swipe"
    assert swipe.caption == "A: Aug · 14 Aug 2026   B: Sep · 21 Sep 2026"
    [side] = survey_pairs.pair_blocks(ctx, a, b, box, "side_by_side")
    assert side.snapshot.spec.mode == "side_by_side"
    both = survey_pairs.pair_blocks(ctx, a, b, box, "both")
    assert [f.snapshot.spec.mode for f in both] == ["swipe", "side_by_side"]


def test_an_explicit_bbox_is_clipped_to_the_common_area(handle):
    add_geomap(handle, name="A", captured_on=date(2026, 8, 1))
    add_geomap(handle, name="B", captured_on=date(2026, 9, 1))
    a, b = survey_pairs.survey_maps(handle)
    far = (a.bounds[2] + 1, a.bounds[1], a.bounds[2] + 2, a.bounds[3])
    assert survey_pairs.frame(a, b, far, None) is None
    inner = (a.bounds[0], a.bounds[1], (a.bounds[0] + a.bounds[2]) / 2, a.bounds[3])
    assert survey_pairs.frame(a, b, inner, None) == pytest.approx(inner)
