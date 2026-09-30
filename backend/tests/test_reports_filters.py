"""Observed date, host label and filters → SQL (spec §7.1, §8.2 step 1, plan R2 Task 1)."""

from datetime import UTC, date, datetime

import pytest
from reports_rows import add_cloud, add_finding, add_image, add_map, add_type, config
from sqlalchemy import select

from app.db.models import Finding
from app.reports.filters import date_window, finding_where
from app.reports.observed import area_m2, data_label, host_label, observed_day, observed_on

TODAY = date(2026, 9, 30)


def _numbers(handle, cfg, since=None):
    where = finding_where(cfg.filters, today=TODAY, since=since)
    with handle.session() as s:
        return sorted(s.execute(select(Finding.number).where(where)).scalars())


def test_observed_date_is_exif_then_item_day_then_created(handle):
    t = add_type(handle, "crack")
    img, _ = add_image(
        handle, captured_on=date(2026, 9, 3), capture_time=datetime(2026, 9, 2, 23, 30, tzinfo=UTC)
    )
    img2, _ = add_image(handle, captured_on=date(2026, 9, 4))
    m = add_map(handle, captured_on=date(2026, 9, 5))
    c = add_cloud(handle)  # undated
    add_finding(handle, t, anchor="image", target=img)
    add_finding(handle, t, anchor="image", target=img2)
    add_finding(handle, t, anchor="map", target=m)
    add_finding(handle, t, anchor="cloud", target=c, created_at=datetime(2026, 9, 7, 8, tzinfo=UTC))
    with handle.session() as s:
        rows = s.execute(select(Finding.number, observed_on(), data_label()).order_by(Finding.number)).all()
        py = [
            (observed_day(s, f).isoformat(), host_label(s, f))
            for f in s.execute(select(Finding).order_by(Finding.number)).scalars()
        ]
    assert [(n, o) for n, o, _ in rows] == [
        (1, "2026-09-02"),
        (2, "2026-09-04"),
        (3, "2026-09-05"),
        (4, "2026-09-07"),
    ]
    assert [lbl for *_, lbl in rows] == ["Flight", "Flight", "Ortho", "Scan"]
    assert py == [(o, lbl) for _, o, lbl in rows]  # the Python rule R5 reuses agrees with the SQL


def test_area_is_the_polygon_area_on_a_metre_map_else_none(handle):
    from pyproj import CRS

    t = add_type(handle, "crack")
    m = add_map(handle, crs_wkt=CRS.from_epsg(32633).to_wkt())
    square = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]]}
    add_finding(handle, t, anchor="map", target=m, geometry=square)
    add_finding(handle, t, anchor="map", target=m)  # a point
    with handle.session() as s:
        a, b = s.execute(select(Finding).order_by(Finding.number)).scalars()
        assert area_m2(s, a) == pytest.approx(50.0)
        assert area_m2(s, b) is None


@pytest.fixture
def mixed(handle):
    crack, rust = add_type(handle, "crack"), add_type(handle, "rust")
    img, src = add_image(handle, captured_on=date(2026, 9, 10))
    m = add_map(handle, captured_on=date(2026, 9, 20))
    c = add_cloud(handle, captured_on=date(2026, 9, 29))
    add_finding(handle, crack, severity=None, anchor="image", target=img)  # 1
    add_finding(handle, crack, severity=2, anchor="map", target=m)  # 2
    add_finding(handle, rust, severity=4, status="closed", anchor="cloud", target=c)  # 3
    add_finding(handle, rust, severity=1, status="reviewed", anchor="cloud", target=c)  # 4
    return {"crack": crack, "rust": rust, "src": src, "map": m, "cloud": c}


def test_defaults_take_every_anchor_kind(handle, mixed):
    assert _numbers(handle, config()) == [1, 2, 3, 4]


def test_status_filter(handle, mixed):
    assert _numbers(handle, config(filters={"statuses": ["open", "reviewed"]})) == [1, 2, 4]
    assert _numbers(handle, config(filters={"statuses": []})) == []


def test_severity_min_keeps_ungraded_only_when_asked(handle, mixed):
    assert _numbers(handle, config(filters={"severity_min": 2, "include_ungraded": True})) == [1, 2, 3]
    assert _numbers(handle, config(filters={"severity_min": 2, "include_ungraded": False})) == [2, 3]
    assert _numbers(handle, config(filters={"severity_min": None, "include_ungraded": False})) == [2, 3, 4]
    assert _numbers(handle, config(filters={"severity_min": 9})) == [1]  # off-scale still compares


def test_types_and_data_items(handle, mixed):
    assert _numbers(handle, config(filters={"type_ids": [mixed["rust"]]})) == [3, 4]
    assert _numbers(handle, config(filters={"type_ids": []})) == []
    assert _numbers(handle, config(filters={"data_item_ids": [mixed["src"], mixed["map"]]})) == [1, 2]
    assert _numbers(handle, config(filters={"data_item_ids": ["gone"]})) == []


@pytest.mark.parametrize(
    ("rule", "since", "expected"),
    [
        ({"rule": "all"}, None, [1, 2, 3, 4]),
        ({"rule": "range", "from": "2026-09-10", "to": "2026-09-20"}, None, [1, 2]),
        ({"rule": "range", "from": "2026-09-21", "to": "2026-09-28"}, None, []),
        ({"rule": "last_days", "days": 2}, None, [3, 4]),
        ({"rule": "last_days", "days": 1}, None, []),
        ({"rule": "since_last_issued"}, date(2026, 9, 20), [2, 3, 4]),
        ({"rule": "since_last_issued"}, None, [1, 2, 3, 4]),
    ],
)
def test_date_rules(handle, mixed, rule, since, expected):
    assert _numbers(handle, config(filters={"date": rule}), since=since) == expected


def test_date_window_is_inclusive():
    cfg = config(filters={"date": {"rule": "last_days", "days": 7}})
    w = date_window(cfg.filters.date, today=TODAY, since=None)
    assert (w.start, w.end) == (date(2026, 9, 24), None)
